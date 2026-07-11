//! Gen-3 target management use cases (spec 036).
//!
//! Implements `target.get`, `target.list`, `target.alias.add`,
//! `target.alias.remove`, `target.display_alias.set`, and
//! `target.display_alias.clear` against the `canonical_target` / `target_alias`
//! tables (migration 0031).
//!
//! ## Constitution
//!
//! - §I No filesystem mutations: read/write SQLite metadata only.
//! - §III Metadata/identity only — no image processing.
//! - §V SQLite (resolution cache / canonical_target) is the durable record.

use audit::bus::EventBus;
use audit::event_bus::{Source, TargetNoteUpdated, TOPIC_TARGET_NOTE_UPDATED};
use sqlx::SqlitePool;
use uuid::Uuid;

use contracts_core::targets::{
    AliasKind as ContractAliasKind, TargetAliasAddRequest, TargetAliasAddResult, TargetAliasDto,
    TargetAliasRemoveRequest, TargetAliasRemoveResult, TargetDetailV3,
    TargetDisplayAliasClearRequest, TargetDisplayAliasSetRequest, TargetGetRequest, TargetListItem,
    TargetNoteGetRequest, TargetNoteGetResult, TargetNoteUpdateRequest, TargetNoteUpdateResult,
    TargetOpError, TargetProjectItem, TargetProjectsListRequest, TargetSessionItem,
    TargetSessionsListRequest,
};
use domain_core::ids::Timestamp;
use targeting_resolver::cache::{self, CachedTarget, TargetListRow};
use targeting_resolver::AliasKind;

// ── Constants ─────────────────────────────────────────────────────────────────

/// Maximum UTF-8 byte length for a target observing note (FR-004 / spec 023).
const MAX_NOTE_BYTES: usize = 16_384;

// ── Error helpers ────────────────────────────────────────────────────────────

fn not_found(id: &str) -> TargetOpError {
    TargetOpError {
        code: "target.not_found".to_owned(),
        message: format!("Target '{id}' not found."),
        details: None,
    }
}

fn db_err(e: &cache::CacheError) -> TargetOpError {
    TargetOpError { code: "internal.database".to_owned(), message: format!("{e}"), details: None }
}

/// Map a [`persistence_db::DbError`] from a `q_targets_mgmt` repository call to
/// the `internal.database` op-error shape (mirrors [`db_err`] for `CacheError`).
fn persist_err(e: &persistence_db::DbError) -> TargetOpError {
    TargetOpError { code: "internal.database".to_owned(), message: format!("{e}"), details: None }
}

fn invalid_id(id: &str) -> TargetOpError {
    TargetOpError {
        code: "target.invalid_id".to_owned(),
        message: format!("'{id}' is not a valid target id."),
        details: None,
    }
}

fn alias_not_removable() -> TargetOpError {
    TargetOpError {
        code: "alias.not_removable".to_owned(),
        message: "Only user-added aliases (kind='user') can be removed.".to_owned(),
        details: None,
    }
}

// ── Enum mapping ─────────────────────────────────────────────────────────────

fn map_alias_kind(k: AliasKind) -> ContractAliasKind {
    match k {
        AliasKind::Designation => ContractAliasKind::Designation,
        AliasKind::CommonName => ContractAliasKind::CommonName,
        AliasKind::User => ContractAliasKind::User,
    }
}

// ── Conversion helpers ───────────────────────────────────────────────────────

/// Load all alias rows for a target (with their persisted ids) and map to DTOs.
async fn load_alias_dtos(
    pool: &SqlitePool,
    target_id_str: &str,
) -> Result<Vec<TargetAliasDto>, TargetOpError> {
    let rows =
        persistence_db::repositories::q_targets_mgmt::list_target_aliases(pool, target_id_str)
            .await
            .map_err(|e| persist_err(&e))?;

    Ok(rows
        .into_iter()
        .map(|r| TargetAliasDto {
            id: r.id,
            alias: r.alias,
            kind: map_alias_kind(AliasKind::from_wire(&r.kind)),
        })
        .collect())
}

fn cached_to_detail(target: CachedTarget, aliases: Vec<TargetAliasDto>) -> TargetDetailV3 {
    let effective_label =
        target.display_alias.clone().unwrap_or_else(|| target.primary_designation.clone());
    TargetDetailV3 {
        id: target.id.to_string(),
        primary_designation: target.primary_designation,
        display_alias: target.display_alias,
        effective_label,
        object_type: target.object_type.as_wire().to_owned(),
        ra_deg: target.ra_deg,
        dec_deg: target.dec_deg,
        simbad_oid: target.simbad_oid,
        source: target.source.as_wire().to_owned(),
        aliases,
    }
}

fn list_row_to_item(row: TargetListRow) -> TargetListItem {
    let effective_label = row.display_alias.unwrap_or_else(|| row.primary_designation.clone());
    TargetListItem {
        id: row.id.to_string(),
        effective_label,
        primary_designation: row.primary_designation,
        object_type: row.object_type,
        ra_deg: row.ra_deg,
        dec_deg: row.dec_deg,
        constellation: row.constellation,
        magnitude: row.magnitude,
        aliases: row.aliases,
    }
}

// ── Use cases ────────────────────────────────────────────────────────────────

/// `target.get` — return full detail (gen-3).
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `target.not_found`, `target.invalid_id`,
/// or `internal.database`.
pub async fn get(
    pool: &SqlitePool,
    req: &TargetGetRequest,
) -> Result<TargetDetailV3, TargetOpError> {
    let uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    let target = cache::get_by_id(pool, uuid).await.map_err(|e| db_err(&e))?;
    match target {
        None => Err(not_found(&req.target_id)),
        Some(t) => {
            let id_str = t.id.to_string();
            let aliases = load_alias_dtos(pool, &id_str).await?;
            Ok(cached_to_detail(t, aliases))
        }
    }
}

/// `target.list` — list all canonical targets (gen-3), ordered by
/// `primary_designation`.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `internal.database`.
pub async fn list(pool: &SqlitePool) -> Result<Vec<TargetListItem>, TargetOpError> {
    let rows = cache::list_all(pool).await.map_err(|e| db_err(&e))?;
    Ok(rows.into_iter().map(list_row_to_item).collect())
}

/// `target.alias.add` — add a user alias to a target (gen-3).
///
/// The alias is normalized before storage; a duplicate (same normalized form)
/// is returned idempotently.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `target.not_found`, `target.invalid_id`,
/// `alias.blank`, or `internal.database`.
pub async fn alias_add(
    pool: &SqlitePool,
    req: &TargetAliasAddRequest,
) -> Result<TargetAliasAddResult, TargetOpError> {
    let uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;

    // Verify the target exists.
    let exists =
        persistence_db::repositories::q_targets_mgmt::target_exists(pool, &uuid.to_string())
            .await
            .map_err(|e| persist_err(&e))?;
    if !exists {
        return Err(not_found(&req.target_id));
    }

    if req.alias.trim().is_empty() {
        return Err(TargetOpError {
            code: "alias.blank".to_owned(),
            message: "Alias must not be blank.".to_owned(),
            details: None,
        });
    }

    let result = cache::insert_user_alias(pool, uuid, &req.alias).await.map_err(|e| db_err(&e))?;

    match result {
        None => Err(TargetOpError {
            code: "alias.blank".to_owned(),
            message: "Alias normalizes to empty string.".to_owned(),
            details: None,
        }),
        Some((alias_id, alias_display)) => Ok(TargetAliasAddResult {
            alias: TargetAliasDto {
                id: alias_id,
                alias: alias_display,
                kind: ContractAliasKind::User,
            },
        }),
    }
}

/// `target.alias.remove` — remove a user alias by id (gen-3).
///
/// Only aliases with `kind='user'` are removable; attempting to remove a
/// SIMBAD designation or common name returns `alias.not_removable`.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `alias.not_found`, `alias.not_removable`,
/// or `internal.database`.
pub async fn alias_remove(
    pool: &SqlitePool,
    req: &TargetAliasRemoveRequest,
) -> Result<TargetAliasRemoveResult, TargetOpError> {
    // First check whether the alias exists at all (to distinguish "not found"
    // from "not removable").
    let row = persistence_db::repositories::q_targets_mgmt::get_alias_kind(
        pool,
        &req.alias_id,
        &req.target_id,
    )
    .await
    .map_err(|e| persist_err(&e))?;

    match row {
        None => Err(TargetOpError {
            code: "alias.not_found".to_owned(),
            message: format!("Alias '{}' not found on target '{}'.", req.alias_id, req.target_id),
            details: None,
        }),
        Some(kind) if kind != "user" => Err(alias_not_removable()),
        Some(_) => {
            let deleted =
                cache::delete_user_alias(pool, &req.alias_id).await.map_err(|e| db_err(&e))?;
            Ok(TargetAliasRemoveResult { removed: deleted })
        }
    }
}

/// `target.display_alias.set` — set the user presentation label (gen-3, FR-012).
///
/// Blank input is treated as a clear (sets `display_alias = NULL`).
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `target.not_found`, `target.invalid_id`,
/// or `internal.database`.
pub async fn display_alias_set(
    pool: &SqlitePool,
    req: &TargetDisplayAliasSetRequest,
) -> Result<TargetDetailV3, TargetOpError> {
    let uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    let updated =
        cache::set_display_alias(pool, uuid, &req.display_alias).await.map_err(|e| db_err(&e))?;
    if !updated {
        return Err(not_found(&req.target_id));
    }
    // Re-fetch and return the updated detail.
    get(pool, &TargetGetRequest { target_id: req.target_id.clone() }).await
}

/// `target.display_alias.clear` — clear the user presentation label (gen-3, FR-012).
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `target.not_found`, `target.invalid_id`,
/// or `internal.database`.
pub async fn display_alias_clear(
    pool: &SqlitePool,
    req: &TargetDisplayAliasClearRequest,
) -> Result<TargetDetailV3, TargetOpError> {
    let uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    let updated = cache::clear_display_alias(pool, uuid).await.map_err(|e| db_err(&e))?;
    if !updated {
        return Err(not_found(&req.target_id));
    }
    get(pool, &TargetGetRequest { target_id: req.target_id.clone() }).await
}

// ── Spec 023 US2/US3/US4 use cases ───────────────────────────────────────────

/// `target.sessions.list` — list acquisition sessions linked to a target (spec 023 US2).
///
/// Returns sessions ordered newest first.  Returns an empty list when the
/// target exists but has no linked sessions; returns `target.not_found` when
/// `target_id` does not exist in `canonical_target`.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `target.not_found`, `target.invalid_id`,
/// or `internal.database`.
pub async fn sessions_list(
    pool: &SqlitePool,
    req: &TargetSessionsListRequest,
) -> Result<Vec<TargetSessionItem>, TargetOpError> {
    let _uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    // Verify the target exists.
    let exists = persistence_db::repositories::q_targets_mgmt::target_exists(pool, &req.target_id)
        .await
        .map_err(|e| persist_err(&e))?;
    if !exists {
        return Err(not_found(&req.target_id));
    }
    let rows =
        persistence_db::repositories::targets::list_sessions_for_target(pool, &req.target_id)
            .await
            .map_err(|e| TargetOpError {
                code: "internal.database".to_owned(),
                message: format!("{e}"),
                details: None,
            })?;
    Ok(rows
        .into_iter()
        .map(|r| TargetSessionItem {
            id: r.id,
            session_key: r.session_key,
            created_at: r.created_at,
            frame_count: r.frame_count,
        })
        .collect())
}

/// `target.projects.list` — list projects linked to a target (spec 023 US3).
///
/// Returns projects ordered alphabetically by name.  Returns an empty list
/// when the target exists but has no linked projects; returns `target.not_found`
/// when `target_id` does not exist.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `target.not_found`, `target.invalid_id`,
/// or `internal.database`.
pub async fn projects_list(
    pool: &SqlitePool,
    req: &TargetProjectsListRequest,
) -> Result<Vec<TargetProjectItem>, TargetOpError> {
    let _uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    let exists = persistence_db::repositories::q_targets_mgmt::target_exists(pool, &req.target_id)
        .await
        .map_err(|e| persist_err(&e))?;
    if !exists {
        return Err(not_found(&req.target_id));
    }
    let rows =
        persistence_db::repositories::targets::list_projects_for_target(pool, &req.target_id)
            .await
            .map_err(|e| TargetOpError {
                code: "internal.database".to_owned(),
                message: format!("{e}"),
                details: None,
            })?;
    Ok(rows
        .into_iter()
        .map(|r| TargetProjectItem { id: r.id, name: r.name, lifecycle: r.lifecycle })
        .collect())
}

/// `target.note.get` — read the observing notes for a target (spec 023 US4).
///
/// Returns `notes: null` when no notes are stored.  Returns `target.not_found`
/// when the target does not exist.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `target.not_found`, `target.invalid_id`,
/// or `internal.database`.
pub async fn note_get(
    pool: &SqlitePool,
    req: &TargetNoteGetRequest,
) -> Result<TargetNoteGetResult, TargetOpError> {
    let _uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    let exists = persistence_db::repositories::q_targets_mgmt::target_exists(pool, &req.target_id)
        .await
        .map_err(|e| persist_err(&e))?;
    if !exists {
        return Err(not_found(&req.target_id));
    }
    let notes = persistence_db::repositories::targets::get_target_notes(pool, &req.target_id)
        .await
        .map_err(|e| TargetOpError {
            code: "internal.database".to_owned(),
            message: format!("{e}"),
            details: None,
        })?;
    Ok(TargetNoteGetResult { notes })
}

/// `target.note.update` — write observing notes for a target (spec 023 US4).
///
/// Empty or whitespace-only `notes` clears the field (stores NULL).
/// Returns the stored value after the update.
/// Notes exceeding 16 384 UTF-8 bytes (after trimming) are rejected with
/// `note.content_too_large` (FR-004).
///
/// Emits a `target.note.updated` audit event after a successful DB write.
/// Bus publish failures are logged at `warn` but do NOT fail the operation.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `target.not_found`, `target.invalid_id`,
/// `note.content_too_large`, or `internal.database`.
pub async fn note_update(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &TargetNoteUpdateRequest,
) -> Result<TargetNoteUpdateResult, TargetOpError> {
    let _uuid = Uuid::parse_str(&req.target_id).map_err(|_| invalid_id(&req.target_id))?;
    let exists = persistence_db::repositories::q_targets_mgmt::target_exists(pool, &req.target_id)
        .await
        .map_err(|e| persist_err(&e))?;
    if !exists {
        return Err(not_found(&req.target_id));
    }
    // Blank/whitespace → store NULL (clear).
    let trimmed = req.notes.trim();
    // FR-004: reject notes exceeding 16 KB UTF-8.
    if trimmed.len() > MAX_NOTE_BYTES {
        return Err(TargetOpError {
            code: "note.content_too_large".to_owned(),
            message: format!(
                "Note body exceeds the 16 384-byte limit ({} bytes supplied).",
                trimmed.len()
            ),
            details: None,
        });
    }
    let stored: Option<&str> = if trimmed.is_empty() { None } else { Some(trimmed) };
    let updated =
        persistence_db::repositories::targets::set_target_notes(pool, &req.target_id, stored)
            .await
            .map_err(|e| TargetOpError {
                code: "internal.database".to_owned(),
                message: format!("{e}"),
                details: None,
            })?;
    if !updated {
        // Should not happen (we verified existence above), but be defensive.
        return Err(not_found(&req.target_id));
    }

    // Emit audit event — bus failure is non-fatal.
    if let Err(e) = bus
        .publish(
            TOPIC_TARGET_NOTE_UPDATED,
            Source::User,
            TargetNoteUpdated {
                target_id: req.target_id.clone(),
                has_notes: stored.is_some(),
                at: Timestamp::now_iso(),
            },
        )
        .await
    {
        tracing::warn!(target_id = %req.target_id, error = %e, "audit bus publish failed for target.note.updated");
    }

    Ok(TargetNoteUpdateResult { notes: stored.map(str::to_owned) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use audit::bus::EventBus;
    use persistence_db::Database;
    use targeting_resolver::cache::upsert_resolved;
    use targeting_resolver::ObjectType;
    use targeting_resolver::{
        AliasKind as CacheKind, ResolvedAlias, ResolvedIdentity, TargetSource,
    };

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    fn make_bus(db: &Database) -> EventBus {
        EventBus::with_pool(db.pool().clone())
    }

    fn m31() -> ResolvedIdentity {
        ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "M 31".to_owned(),
            common_name: Some("Andromeda Galaxy".to_owned()),
            object_type: ObjectType::Galaxy,
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            aliases: vec![
                ResolvedAlias::new("M 31", CacheKind::Designation),
                ResolvedAlias::new("NGC 224", CacheKind::Designation),
                ResolvedAlias::new("Andromeda Galaxy", CacheKind::CommonName),
            ],
            source: TargetSource::Resolved,
        }
    }

    async fn seed_m31(db: &Database) -> Uuid {
        let (id, _) = upsert_resolved(db.pool(), &m31()).await.unwrap();
        id
    }

    // ── target.get ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn get_returns_detail_with_aliases() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let req = TargetGetRequest { target_id: id.to_string() };
        let detail = get(db.pool(), &req).await.unwrap();
        assert_eq!(detail.primary_designation, "M 31");
        assert_eq!(detail.object_type, "galaxy");
        assert_eq!(detail.source, "resolved");
        assert!(detail.simbad_oid.is_some());
        assert!(detail.display_alias.is_none());
        assert_eq!(detail.effective_label, "M 31");
        assert_eq!(detail.aliases.len(), 3);
    }

    #[tokio::test]
    async fn get_not_found_returns_error() {
        let db = setup().await;
        let req = TargetGetRequest { target_id: Uuid::new_v4().to_string() };
        let err = get(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "target.not_found");
    }

    #[tokio::test]
    async fn get_invalid_id_returns_error() {
        let db = setup().await;
        let req = TargetGetRequest { target_id: "not-a-uuid".to_owned() };
        let err = get(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "target.invalid_id");
    }

    // ── target.list ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_returns_all_targets() {
        let db = setup().await;
        seed_m31(&db).await;
        let items = list(db.pool()).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].primary_designation, "M 31");
        assert_eq!(items[0].object_type, "galaxy");
        assert_eq!(items[0].effective_label, "M 31");
    }

    #[tokio::test]
    async fn list_empty_when_no_targets() {
        let db = setup().await;
        let items = list(db.pool()).await.unwrap();
        assert!(items.is_empty());
    }

    /// `target.list` must carry `ra_deg` and `dec_deg` sourced from
    /// `canonical_target` — these are always non-null per the schema constraint.
    #[tokio::test]
    async fn list_item_carries_ra_dec() {
        let db = setup().await;
        seed_m31(&db).await;
        let items = list(db.pool()).await.unwrap();
        assert_eq!(items.len(), 1);
        // M31 fixture values from m31() above (ra=10.684708, dec=41.26875).
        assert!(
            (items[0].ra_deg - 10.684_708).abs() < 1e-6,
            "ra_deg mismatch: {}",
            items[0].ra_deg
        );
        assert!(
            (items[0].dec_deg - 41.268_75).abs() < 1e-6,
            "dec_deg mismatch: {}",
            items[0].dec_deg
        );
    }

    /// `constellation` and `magnitude` are `None` for entries that pre-date
    /// migration 0046 (the columns were added as nullable).  Seeding via
    /// `upsert_resolved` does not populate them yet, so they must be `None`.
    #[tokio::test]
    async fn list_item_constellation_and_magnitude_none_when_not_stored() {
        let db = setup().await;
        seed_m31(&db).await;
        let items = list(db.pool()).await.unwrap();
        assert_eq!(items.len(), 1);
        assert!(
            items[0].constellation.is_none(),
            "constellation must be None when not stored, got {:?}",
            items[0].constellation
        );
        assert!(
            items[0].magnitude.is_none(),
            "magnitude must be None when not stored, got {:?}",
            items[0].magnitude
        );
    }

    /// `target.list` must carry all alias display forms so clients can perform
    /// alias search (e.g. "Andromeda" → M31) without a separate round-trip.
    #[tokio::test]
    async fn list_item_carries_aliases() {
        let db = setup().await;
        seed_m31(&db).await;
        let items = list(db.pool()).await.unwrap();
        assert_eq!(items.len(), 1);
        // M31 fixture aliases: "M 31", "NGC 224", "Andromeda Galaxy".
        assert_eq!(
            items[0].aliases.len(),
            3,
            "expected 3 aliases in list item, got {:?}",
            items[0].aliases
        );
        assert!(
            items[0].aliases.contains(&"Andromeda Galaxy".to_owned()),
            "alias search pivot 'Andromeda Galaxy' missing from list item"
        );
        assert!(
            items[0].aliases.contains(&"NGC 224".to_owned()),
            "alias 'NGC 224' missing from list item"
        );
    }

    /// `aliases` must be empty (not absent/null) for targets with no alias rows.
    #[tokio::test]
    async fn list_item_aliases_empty_when_no_aliases_stored() {
        let db = setup().await;
        // Insert a bare canonical_target with no aliases.
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO canonical_target
             (id, simbad_oid, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at)
             VALUES (?, NULL, 'Bare Target', 'galaxy', 0.0, 0.0, 'seed', '2026-01-01T00:00:00Z')",
        )
        .bind(&id)
        .execute(db.pool())
        .await
        .expect("direct insert failed");

        let items = list(db.pool()).await.unwrap();
        assert_eq!(items.len(), 1);
        assert!(
            items[0].aliases.is_empty(),
            "aliases must be empty vec, got {:?}",
            items[0].aliases
        );
    }

    /// When `constellation` and `magnitude` are written directly to the DB they
    /// are returned by `target.list`.
    #[tokio::test]
    async fn list_item_returns_stored_constellation_and_magnitude() {
        let db = setup().await;
        let id = seed_m31(&db).await;

        // Write constellation + magnitude directly (simulates a future resolver
        // or seed that populates these fields).
        sqlx::query("UPDATE canonical_target SET constellation = ?, magnitude = ? WHERE id = ?")
            .bind("And")
            .bind(3.44_f64)
            .bind(id.to_string())
            .execute(db.pool())
            .await
            .expect("direct constellation/magnitude update failed");

        let items = list(db.pool()).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].constellation.as_deref(), Some("And"), "constellation mismatch");
        assert!(
            items[0].magnitude.is_some_and(|m| (m - 3.44).abs() < 1e-6),
            "magnitude mismatch: {:?}",
            items[0].magnitude
        );
    }

    // ── target.alias.add ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn alias_add_inserts_user_alias() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let req =
            TargetAliasAddRequest { target_id: id.to_string(), alias: "Andromeda".to_owned() };
        let result = alias_add(db.pool(), &req).await.unwrap();
        assert_eq!(result.alias.alias, "Andromeda");
        assert_eq!(result.alias.kind, ContractAliasKind::User);
        assert!(!result.alias.id.is_empty());
    }

    #[tokio::test]
    async fn alias_add_idempotent_for_duplicate() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let req =
            TargetAliasAddRequest { target_id: id.to_string(), alias: "Andromeda".to_owned() };
        let r1 = alias_add(db.pool(), &req).await.unwrap();
        let r2 = alias_add(db.pool(), &req).await.unwrap();
        assert_eq!(r1.alias.id, r2.alias.id);
    }

    #[tokio::test]
    async fn alias_add_blank_returns_error() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let req = TargetAliasAddRequest { target_id: id.to_string(), alias: "   ".to_owned() };
        let err = alias_add(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "alias.blank");
    }

    #[tokio::test]
    async fn alias_add_target_not_found() {
        let db = setup().await;
        let req = TargetAliasAddRequest {
            target_id: Uuid::new_v4().to_string(),
            alias: "Foo".to_owned(),
        };
        let err = alias_add(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "target.not_found");
    }

    // ── target.alias.remove ───────────────────────────────────────────────────

    #[tokio::test]
    async fn alias_remove_deletes_user_alias() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let add_req = TargetAliasAddRequest { target_id: id.to_string(), alias: "Andy".to_owned() };
        let added = alias_add(db.pool(), &add_req).await.unwrap();

        let rem_req =
            TargetAliasRemoveRequest { target_id: id.to_string(), alias_id: added.alias.id };
        let result = alias_remove(db.pool(), &rem_req).await.unwrap();
        assert!(result.removed);
    }

    #[tokio::test]
    async fn alias_remove_simbad_alias_is_not_removable() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        // Get a designation alias id.
        let aliases = load_alias_dtos(db.pool(), &id.to_string()).await.unwrap();
        let designation =
            aliases.iter().find(|a| a.kind == ContractAliasKind::Designation).unwrap();

        let rem_req = TargetAliasRemoveRequest {
            target_id: id.to_string(),
            alias_id: designation.id.clone(),
        };
        let err = alias_remove(db.pool(), &rem_req).await.unwrap_err();
        assert_eq!(err.code, "alias.not_removable");
    }

    #[tokio::test]
    async fn alias_remove_not_found_returns_error() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let rem_req = TargetAliasRemoveRequest {
            target_id: id.to_string(),
            alias_id: Uuid::new_v4().to_string(),
        };
        let err = alias_remove(db.pool(), &rem_req).await.unwrap_err();
        assert_eq!(err.code, "alias.not_found");
    }

    // ── target.display_alias.set / clear ─────────────────────────────────────

    #[tokio::test]
    async fn display_alias_set_updates_effective_label() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let req = TargetDisplayAliasSetRequest {
            target_id: id.to_string(),
            display_alias: "Andromeda".to_owned(),
        };
        let detail = display_alias_set(db.pool(), &req).await.unwrap();
        assert_eq!(detail.display_alias.as_deref(), Some("Andromeda"));
        assert_eq!(detail.effective_label, "Andromeda");
    }

    #[tokio::test]
    async fn display_alias_clear_restores_primary_designation() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        // Set first.
        let set_req = TargetDisplayAliasSetRequest {
            target_id: id.to_string(),
            display_alias: "Andromeda".to_owned(),
        };
        display_alias_set(db.pool(), &set_req).await.unwrap();

        // Then clear.
        let clear_req = TargetDisplayAliasClearRequest { target_id: id.to_string() };
        let detail = display_alias_clear(db.pool(), &clear_req).await.unwrap();
        assert!(detail.display_alias.is_none());
        assert_eq!(detail.effective_label, "M 31");
    }

    #[tokio::test]
    async fn display_alias_set_not_found_returns_error() {
        let db = setup().await;
        let req = TargetDisplayAliasSetRequest {
            target_id: Uuid::new_v4().to_string(),
            display_alias: "X".to_owned(),
        };
        let err = display_alias_set(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "target.not_found");
    }

    #[tokio::test]
    async fn upsert_does_not_overwrite_display_alias() {
        let db = setup().await;
        let id = seed_m31(&db).await;

        // Set a display alias.
        let set_req = TargetDisplayAliasSetRequest {
            target_id: id.to_string(),
            display_alias: "My Andromeda".to_owned(),
        };
        display_alias_set(db.pool(), &set_req).await.unwrap();

        // Re-resolve (simulate SIMBAD refresh) — must NOT clear display_alias.
        upsert_resolved(db.pool(), &m31()).await.unwrap();

        let get_req = TargetGetRequest { target_id: id.to_string() };
        let detail = get(db.pool(), &get_req).await.unwrap();
        assert_eq!(
            detail.display_alias.as_deref(),
            Some("My Andromeda"),
            "FR-012: display_alias must survive re-resolution"
        );
    }

    // ── target.sessions.list (spec 023 US2) ──────────────────────────────────

    async fn insert_session_linked_to(db: &Database, session_id: &str, target_id: Uuid) {
        sqlx::query(
            r#"INSERT INTO acquisition_session
               (id, session_key, frame_ids, created_at, canonical_target_id)
               VALUES (?, '{"target":"M 31","filter":"Ha","binning":"1","gain":"0","date":"2026-01-01"}',
                       '[1,2,3]', '2026-01-01T00:00:00Z', ?)"#,
        )
        .bind(session_id)
        .bind(target_id.to_string())
        .execute(db.pool())
        .await
        .expect("insert session failed");
    }

    async fn insert_project_linked_to(db: &Database, project_id: &str, target_id: Uuid) {
        // Path must be unique per project (UNIQUE constraint on projects.path).
        sqlx::query(
            "INSERT INTO projects
             (id, name, tool, lifecycle, path, canonical_target_id, channel_drift, created_at, updated_at)
             VALUES (?, 'Test Project', 'PixInsight', 'ready', ?, ?, 0,
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(project_id)
        .bind(format!("projects/{project_id}"))
        .bind(target_id.to_string())
        .execute(db.pool())
        .await
        .expect("insert project failed");
    }

    #[tokio::test]
    async fn sessions_list_returns_linked_sessions() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        insert_session_linked_to(&db, "s-001", id).await;
        let req = TargetSessionsListRequest { target_id: id.to_string() };
        let items = sessions_list(db.pool(), &req).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "s-001");
        assert_eq!(items[0].frame_count, 3);
    }

    #[tokio::test]
    async fn sessions_list_empty_for_target_with_no_sessions() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let req = TargetSessionsListRequest { target_id: id.to_string() };
        let items = sessions_list(db.pool(), &req).await.unwrap();
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn sessions_list_not_found_for_unknown_target() {
        let db = setup().await;
        let req = TargetSessionsListRequest { target_id: Uuid::new_v4().to_string() };
        let err = sessions_list(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "target.not_found");
    }

    #[tokio::test]
    async fn sessions_list_invalid_id_returns_error() {
        let db = setup().await;
        let req = TargetSessionsListRequest { target_id: "not-a-uuid".to_owned() };
        let err = sessions_list(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "target.invalid_id");
    }

    // ── target.projects.list (spec 023 US3) ──────────────────────────────────

    #[tokio::test]
    async fn projects_list_returns_linked_projects() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        insert_project_linked_to(&db, "p-001", id).await;
        let req = TargetProjectsListRequest { target_id: id.to_string() };
        let items = projects_list(db.pool(), &req).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "p-001");
        assert_eq!(items[0].lifecycle, "ready");
    }

    #[tokio::test]
    async fn projects_list_empty_for_target_with_no_projects() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let req = TargetProjectsListRequest { target_id: id.to_string() };
        let items = projects_list(db.pool(), &req).await.unwrap();
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn projects_list_not_found_for_unknown_target() {
        let db = setup().await;
        let req = TargetProjectsListRequest { target_id: Uuid::new_v4().to_string() };
        let err = projects_list(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "target.not_found");
    }

    // ── target.note.get / target.note.update (spec 023 US4) ──────────────────

    #[tokio::test]
    async fn note_get_returns_none_when_no_note_set() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let req = TargetNoteGetRequest { target_id: id.to_string() };
        let result = note_get(db.pool(), &req).await.unwrap();
        assert!(result.notes.is_none());
    }

    #[tokio::test]
    async fn note_update_and_get_roundtrip() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let bus = make_bus(&db);

        let upd_req = TargetNoteUpdateRequest {
            target_id: id.to_string(),
            notes: "Great seeing.".to_owned(),
        };
        let upd_result = note_update(db.pool(), &bus, &upd_req).await.unwrap();
        assert_eq!(upd_result.notes.as_deref(), Some("Great seeing."));

        let get_req = TargetNoteGetRequest { target_id: id.to_string() };
        let get_result = note_get(db.pool(), &get_req).await.unwrap();
        assert_eq!(get_result.notes.as_deref(), Some("Great seeing."));
    }

    #[tokio::test]
    async fn note_update_whitespace_clears_note() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let bus = make_bus(&db);

        // Set a note first.
        note_update(
            db.pool(),
            &bus,
            &TargetNoteUpdateRequest { target_id: id.to_string(), notes: "Initial.".to_owned() },
        )
        .await
        .unwrap();

        // Whitespace-only update should clear.
        let clear_result = note_update(
            db.pool(),
            &bus,
            &TargetNoteUpdateRequest { target_id: id.to_string(), notes: "   ".to_owned() },
        )
        .await
        .unwrap();
        assert!(clear_result.notes.is_none(), "whitespace should clear notes");

        let get_result =
            note_get(db.pool(), &TargetNoteGetRequest { target_id: id.to_string() }).await.unwrap();
        assert!(get_result.notes.is_none());
    }

    #[tokio::test]
    async fn note_get_not_found_returns_error() {
        let db = setup().await;
        let req = TargetNoteGetRequest { target_id: Uuid::new_v4().to_string() };
        let err = note_get(db.pool(), &req).await.unwrap_err();
        assert_eq!(err.code, "target.not_found");
    }

    #[tokio::test]
    async fn note_update_not_found_returns_error() {
        let db = setup().await;
        let bus = make_bus(&db);
        let req = TargetNoteUpdateRequest {
            target_id: Uuid::new_v4().to_string(),
            notes: "x".to_owned(),
        };
        let err = note_update(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, "target.not_found");
    }

    // ── SC-003 / US4-AS3: note survives alias mutations ───────────────────────

    /// A stored note must be unchanged after a user alias is added and then
    /// removed on the same target (SC-003 / US4-AS3).
    #[tokio::test]
    async fn note_survives_alias_add_and_remove() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let bus = make_bus(&db);

        // Step 1: store a note.
        let upd = TargetNoteUpdateRequest {
            target_id: id.to_string(),
            notes: "Best viewed in autumn.".to_owned(),
        };
        note_update(db.pool(), &bus, &upd).await.unwrap();

        // Step 2: add a user alias.
        let add_req =
            TargetAliasAddRequest { target_id: id.to_string(), alias: "Andromeda".to_owned() };
        let added = alias_add(db.pool(), &add_req).await.unwrap();

        // Step 3: remove that alias.
        let rem_req =
            TargetAliasRemoveRequest { target_id: id.to_string(), alias_id: added.alias.id };
        alias_remove(db.pool(), &rem_req).await.unwrap();

        // Step 4: note must still be intact.
        let get_req = TargetNoteGetRequest { target_id: id.to_string() };
        let result = note_get(db.pool(), &get_req).await.unwrap();
        assert_eq!(
            result.notes.as_deref(),
            Some("Best viewed in autumn."),
            "SC-003: note must survive alias add + remove"
        );
    }

    // ── FR-004: 16 KB note size cap ───────────────────────────────────────────

    /// A note exceeding 16 384 UTF-8 bytes (after trimming) must be rejected
    /// with error code `note.content_too_large` (FR-004).
    #[tokio::test]
    async fn note_update_over_16kb_rejected() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let bus = make_bus(&db);

        // 16 385 ASCII bytes (one byte over the 16 384-byte cap).
        let oversized = "x".repeat(MAX_NOTE_BYTES + 1);
        let req = TargetNoteUpdateRequest { target_id: id.to_string(), notes: oversized };
        let err = note_update(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, "note.content_too_large", "FR-004: notes >16 KB must be rejected");
    }

    /// A note exactly at the 16 384-byte limit must be accepted.
    #[tokio::test]
    async fn note_update_exactly_16kb_accepted() {
        let db = setup().await;
        let id = seed_m31(&db).await;
        let bus = make_bus(&db);

        let at_limit = "x".repeat(MAX_NOTE_BYTES);
        let req = TargetNoteUpdateRequest { target_id: id.to_string(), notes: at_limit.clone() };
        let result = note_update(db.pool(), &bus, &req).await.unwrap();
        assert_eq!(result.notes.as_deref(), Some(at_limit.as_str()));
    }
}
