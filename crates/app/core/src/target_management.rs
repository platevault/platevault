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

use sqlx::SqlitePool;
use uuid::Uuid;

use contracts_core::targets::{
    AliasKind as ContractAliasKind, TargetAliasAddRequest, TargetAliasAddResult, TargetAliasDto,
    TargetAliasRemoveRequest, TargetAliasRemoveResult, TargetDetailV3,
    TargetDisplayAliasClearRequest, TargetDisplayAliasSetRequest, TargetGetRequest, TargetListItem,
    TargetOpError,
};
use targeting::resolver::cache::{self, CachedTarget, TargetListRow};
use targeting::resolver::AliasKind;

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
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, alias, kind
         FROM target_alias
         WHERE target_id = ?
         ORDER BY alias ASC",
    )
    .bind(target_id_str)
    .fetch_all(pool)
    .await
    .map_err(|e| TargetOpError {
        code: "internal.database".to_owned(),
        message: format!("{e}"),
        details: None,
    })?;

    Ok(rows
        .into_iter()
        .map(|(id, alias, kind)| TargetAliasDto {
            id,
            alias,
            kind: map_alias_kind(AliasKind::from_wire(&kind)),
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
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM canonical_target WHERE id = ?")
        .bind(uuid.to_string())
        .fetch_optional(pool)
        .await
        .map_err(|e| TargetOpError {
            code: "internal.database".to_owned(),
            message: format!("{e}"),
            details: None,
        })?;
    if exists.is_none() {
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
    let row: Option<(String,)> =
        sqlx::query_as("SELECT kind FROM target_alias WHERE id = ? AND target_id = ?")
            .bind(&req.alias_id)
            .bind(&req.target_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| TargetOpError {
                code: "internal.database".to_owned(),
                message: format!("{e}"),
                details: None,
            })?;

    match row {
        None => Err(TargetOpError {
            code: "alias.not_found".to_owned(),
            message: format!("Alias '{}' not found on target '{}'.", req.alias_id, req.target_id),
            details: None,
        }),
        Some((kind,)) if kind != "user" => Err(alias_not_removable()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;
    use targeting::resolver::cache::upsert_resolved;
    use targeting::resolver::ObjectType;
    use targeting::resolver::{
        AliasKind as CacheKind, ResolvedAlias, ResolvedIdentity, TargetSource,
    };

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
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
}
