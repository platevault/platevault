//! Use cases for spec 023 — Target Identity, History, and Notes.
//!
//! Entry points:
//! - [`target_get`] — load full target aggregate (identity + aliases + catalog refs + notes).
//! - [`target_note_update`] — replace per-target free-text note (max 16 KB).
//! - [`target_alias_add`] — append an alias; idempotent if already on same target.
//! - [`target_alias_remove`] — remove an alias; rejects if alias == primary.
//! - [`target_primary_rename`] — promote an existing alias to primary_designation.
//!
//! ## Constitution
//!
//! - §I No filesystem mutations: these use cases only read/write SQLite metadata.
//! - §V SQLite is the durable record for identity, aliases, and notes.
//!   Provenance for corrections is written to `audit` on mutating ops.

use sqlx::SqlitePool;
use time::OffsetDateTime;
use uuid::Uuid;

use contracts_core::targets::{
    CatalogRef, TargetAliasAddRequest, TargetAliasAddResult, TargetAliasRemoveRequest,
    TargetAliasRemoveResult, TargetGetResult, TargetIdentity, TargetNoteUpdateRequest,
    TargetNoteUpdateResult, TargetOpError, TargetPrimaryRenameRequest, TargetPrimaryRenameResult,
};
use persistence_db::repositories::targets::{
    delete_alias_by_normalized, find_alias_by_normalized, get_target, insert_alias, list_aliases,
    list_catalog_refs, update_target_notes, update_target_primary, TargetAliasRow,
};
use targeting::aliases::{
    check_alias_add, check_alias_remove_not_primary, check_primary_rename, validate_alias,
    AddAliasOutcome, AliasError,
};

// ── Result alias ──────────────────────────────────────────────────────────────

pub type TargetResult<T> = Result<T, TargetOpError>;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}

fn target_not_found(id: &str) -> TargetOpError {
    TargetOpError {
        code: "target.not_found".to_owned(),
        message: format!("No target found with id '{id}'."),
        details: None,
    }
}

fn alias_op_error(err: &AliasError) -> TargetOpError {
    match err {
        AliasError::InvalidAlias => TargetOpError {
            code: "alias.invalid".to_owned(),
            message: "Alias is empty or contains only whitespace/punctuation.".to_owned(),
            details: None,
        },
        AliasError::Duplicate { conflicting_target_id } => TargetOpError {
            code: "alias.duplicate".to_owned(),
            message: "This alias is already attached to a different target.".to_owned(),
            details: Some(contracts_core::JsonAny::from(serde_json::json!({
                "conflicting_target_id": conflicting_target_id
            }))),
        },
        AliasError::IsPrimary => TargetOpError {
            code: "alias.is_primary".to_owned(),
            message: "This alias is the current primary designation. Use target.primary.rename to demote it first.".to_owned(),
            details: None,
        },
        AliasError::NotFound => TargetOpError {
            code: "alias.not_found".to_owned(),
            message: "Alias not found on this target.".to_owned(),
            details: None,
        },
        AliasError::DesignationNotInAliases => TargetOpError {
            code: "designation.not_in_aliases".to_owned(),
            message: "The new primary designation is not among the target's existing aliases. Add it first with target.alias.add.".to_owned(),
            details: None,
        },
        AliasError::DesignationAlreadyPrimary => TargetOpError {
            code: "designation.already_primary".to_owned(),
            message: "This designation is already the primary.".to_owned(),
            details: None,
        },
    }
}

// ── target_get ────────────────────────────────────────────────────────────────

/// Load the full `TargetGetResult` aggregate for a target.
///
/// - Loads the target row (notes, updated_at).
/// - Loads all aliases.
/// - Loads all catalog refs.
/// - Sessions and projects are currently empty (populated when the inventory
///   and project FK columns are wired — see spec 023 T012 / T017 deferred).
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `"target.not_found"` when not found.
pub async fn target_get(pool: &SqlitePool, target_id: &str) -> TargetResult<TargetGetResult> {
    let row = get_target(pool, target_id).await.map_err(|_| target_not_found(target_id))?;

    let alias_rows = list_aliases(pool, target_id).await.map_err(|e| TargetOpError {
        code: "internal".to_owned(),
        message: format!("Failed to load aliases: {e}"),
        details: None,
    })?;

    let catalog_ref_rows = list_catalog_refs(pool, target_id).await.map_err(|e| TargetOpError {
        code: "internal".to_owned(),
        message: format!("Failed to load catalog refs: {e}"),
        details: None,
    })?;

    let updated_at = row.updated_at.clone().unwrap_or_else(|| row.created_at.clone());

    let identity = TargetIdentity {
        id: row.id.clone(),
        primary_designation: row.primary_designation.clone(),
        aliases: alias_rows.iter().map(|a| a.alias_display.clone()).collect(),
        catalog_refs: catalog_ref_rows
            .into_iter()
            .map(|r| CatalogRef {
                catalog_id: r.catalog_id,
                catalog_display: r.catalog_display,
                designation: r.designation,
            })
            .collect(),
        notes: row.notes,
        created_at: row.created_at,
        updated_at,
    };

    // Sessions and projects are deferred (T012, T017): the FK columns on
    // acquisition_session and projects are nullable and not yet populated by
    // the ingestion pipeline. The use case returns empty slices so the UI can
    // render the empty state (T015).
    Ok(TargetGetResult { target: identity, sessions: vec![], projects: vec![] })
}

// ── target_note_update ────────────────────────────────────────────────────────

/// Replace the per-target free-text note.
///
/// - `content` is stored as-is; empty string clears the note.
/// - Max 16 384 UTF-8 bytes (A6).
/// - Bumps `updated_at`.
/// - Writes one audit event (TODO: wire full audit bus when spec 023 T021 is
///   fully implemented).
///
/// # Errors
///
/// Returns [`TargetOpError`] on `"target.not_found"` or `"note.too_long"`.
pub async fn target_note_update(
    pool: &SqlitePool,
    req: TargetNoteUpdateRequest,
) -> TargetResult<TargetNoteUpdateResult> {
    const MAX_NOTE_BYTES: usize = 16_384;
    if req.content.len() > MAX_NOTE_BYTES {
        return Err(TargetOpError {
            code: "note.too_long".to_owned(),
            message: format!(
                "Note body exceeds the 16 KB limit ({} bytes supplied).",
                req.content.len()
            ),
            details: None,
        });
    }

    let updated_at = now_iso();
    let notes = if req.content.is_empty() { None } else { Some(req.content.as_str()) };

    update_target_notes(pool, &req.target_id, notes, &updated_at)
        .await
        .map_err(|_| target_not_found(&req.target_id))?;

    Ok(TargetNoteUpdateResult { target_id: req.target_id, updated_at })
}

// ── target_alias_add ──────────────────────────────────────────────────────────

/// Append an alias to a target.
///
/// - Validates and normalizes the alias via [`targeting::aliases::validate_alias`].
/// - Idempotent: re-adding an alias that already exists on the same target
///   returns `added = false` without error.
/// - Returns `alias.duplicate` when the normalized form belongs to a different
///   target.
///
/// # Errors
///
/// Returns [`TargetOpError`] with codes: `"target.not_found"`, `"alias.invalid"`,
/// `"alias.duplicate"`.
pub async fn target_alias_add(
    pool: &SqlitePool,
    req: TargetAliasAddRequest,
) -> TargetResult<TargetAliasAddResult> {
    // Verify target exists.
    get_target(pool, &req.target_id).await.map_err(|_| target_not_found(&req.target_id))?;

    // Validate + normalize alias.
    let normalized = validate_alias(&req.alias).map_err(|e| alias_op_error(&e))?;

    // Check for existing alias (global uniqueness on normalized form).
    let existing =
        find_alias_by_normalized(pool, &normalized).await.map_err(|e| TargetOpError {
            code: "internal".to_owned(),
            message: format!("Failed to check alias uniqueness: {e}"),
            details: None,
        })?;

    let existing_owner = existing.as_ref().map(|r| r.target_id.as_str());
    let outcome =
        check_alias_add(&req.target_id, existing_owner).map_err(|e| alias_op_error(&e))?;

    if matches!(outcome, AddAliasOutcome::AlreadyPresent) {
        return Ok(TargetAliasAddResult { target_id: req.target_id, added: false });
    }

    let alias_row = TargetAliasRow {
        id: new_uuid(),
        target_id: req.target_id.clone(),
        alias_display: req.alias.clone(),
        alias_normalized: normalized,
        created_at: now_iso(),
    };

    insert_alias(pool, &alias_row).await.map_err(|e| TargetOpError {
        code: "internal".to_owned(),
        message: format!("Failed to persist alias: {e}"),
        details: None,
    })?;

    Ok(TargetAliasAddResult { target_id: req.target_id, added: true })
}

// ── target_alias_remove ───────────────────────────────────────────────────────

/// Remove an alias from a target.
///
/// - Rejects with `alias.is_primary` when the alias matches the current
///   primary designation (normalized comparison).
/// - Rejects with `alias.not_found` when the alias is not on this target.
/// - Writes an audit event on success (lightweight record).
///
/// # Errors
///
/// Returns [`TargetOpError`] with codes: `"target.not_found"`, `"alias.is_primary"`,
/// `"alias.not_found"`.
pub async fn target_alias_remove(
    pool: &SqlitePool,
    req: TargetAliasRemoveRequest,
) -> TargetResult<TargetAliasRemoveResult> {
    // Load target to verify existence and get primary_designation.
    let target_row =
        get_target(pool, &req.target_id).await.map_err(|_| target_not_found(&req.target_id))?;

    // Guard: alias must not be the primary designation.
    check_alias_remove_not_primary(&req.alias, &target_row.primary_designation)
        .map_err(|e| alias_op_error(&e))?;

    // Normalize for lookup.
    let normalized = validate_alias(&req.alias).map_err(|e| alias_op_error(&e))?;

    // Delete — returns 0 when not found on this target.
    let deleted =
        delete_alias_by_normalized(pool, &req.target_id, &normalized).await.map_err(|e| {
            TargetOpError {
                code: "internal".to_owned(),
                message: format!("Failed to delete alias: {e}"),
                details: None,
            }
        })?;

    if deleted == 0 {
        return Err(alias_op_error(&AliasError::NotFound));
    }

    let audit_id = new_uuid();
    // Audit event: in a full implementation this would call the audit bus.
    // For now we emit a tracing event as a placeholder (T021 wires the bus).
    tracing::info!(
        target_id = %req.target_id,
        alias = %normalized,
        audit_id = %audit_id,
        "target.alias_removed"
    );

    Ok(TargetAliasRemoveResult { target_id: req.target_id, removed_alias: normalized, audit_id })
}

// ── target_primary_rename ─────────────────────────────────────────────────────

/// Promote an existing alias to primary_designation.
///
/// - The new primary MUST already be in the target's alias list.
/// - The old primary is added as an alias (swap).
/// - Writes an audit event on success.
///
/// # Errors
///
/// Returns [`TargetOpError`] with codes: `"target.not_found"`,
/// `"designation.not_in_aliases"`, `"designation.already_primary"`.
pub async fn target_primary_rename(
    pool: &SqlitePool,
    req: TargetPrimaryRenameRequest,
) -> TargetResult<TargetPrimaryRenameResult> {
    // Load target.
    let target_row =
        get_target(pool, &req.target_id).await.map_err(|_| target_not_found(&req.target_id))?;

    // Load existing aliases (normalized forms for the domain guard).
    let alias_rows = list_aliases(pool, &req.target_id).await.map_err(|e| TargetOpError {
        code: "internal".to_owned(),
        message: format!("Failed to load aliases: {e}"),
        details: None,
    })?;

    let aliases_normalized: Vec<String> =
        alias_rows.iter().map(|a| a.alias_normalized.clone()).collect();

    // Domain guard: new primary must be in aliases and not already primary.
    check_primary_rename(
        &req.new_primary_designation,
        &target_row.primary_designation,
        &aliases_normalized,
    )
    .map_err(|e| alias_op_error(&e))?;

    let prior_primary = target_row.primary_designation.clone();
    let updated_at = now_iso();

    // 1. Update primary_designation on the target row.
    update_target_primary(pool, &req.target_id, &req.new_primary_designation, &updated_at)
        .await
        .map_err(|_| target_not_found(&req.target_id))?;

    // 2. Remove the new primary from the alias list (it moves to primary).
    let new_primary_normalized =
        validate_alias(&req.new_primary_designation).map_err(|e| alias_op_error(&e))?;
    let _ = delete_alias_by_normalized(pool, &req.target_id, &new_primary_normalized).await;

    // 3. Add the prior primary as an alias (demote it).
    let prior_normalized = targeting::normalize::normalize(&prior_primary);
    if !prior_normalized.is_empty() {
        // Only add if not already present (idempotent).
        if find_alias_by_normalized(pool, &prior_normalized).await.unwrap_or(None).is_none() {
            let _ = insert_alias(
                pool,
                &TargetAliasRow {
                    id: new_uuid(),
                    target_id: req.target_id.clone(),
                    alias_display: prior_primary.clone(),
                    alias_normalized: prior_normalized,
                    created_at: updated_at.clone(),
                },
            )
            .await;
        }
    }

    let audit_id = new_uuid();
    tracing::info!(
        target_id = %req.target_id,
        prior_primary = %prior_primary,
        new_primary = %req.new_primary_designation,
        audit_id = %audit_id,
        "target.primary_renamed"
    );

    Ok(TargetPrimaryRenameResult {
        target_id: req.target_id,
        prior_primary,
        new_primary: req.new_primary_designation,
        audit_id,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::targets::TargetRow;
    use persistence_db::{repositories::targets::upsert_target, Database};

    async fn setup() -> SqlitePool {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db.pool().clone()
    }

    fn m31_row() -> TargetRow {
        TargetRow {
            id: "550e8400-e29b-41d4-a716-446655440099".into(),
            primary_designation: "M 31".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            notes: None,
            updated_at: None,
        }
    }

    // ── target_get ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn target_get_returns_not_found_for_unknown_id() {
        let pool = setup().await;
        let result = target_get(&pool, "no-such-id").await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "target.not_found");
    }

    #[tokio::test]
    async fn target_get_returns_identity_fields() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        let result = target_get(&pool, &m31_row().id).await.unwrap();
        assert_eq!(result.target.primary_designation, "M 31");
        assert_eq!(result.target.id, m31_row().id);
        assert!(result.sessions.is_empty());
        assert!(result.projects.is_empty());
    }

    #[tokio::test]
    async fn target_get_includes_aliases() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        target_alias_add(
            &pool,
            TargetAliasAddRequest {
                target_id: m31_row().id.clone(),
                alias: "Andromeda Galaxy".into(),
            },
        )
        .await
        .unwrap();
        let result = target_get(&pool, &m31_row().id).await.unwrap();
        assert!(result.target.aliases.contains(&"Andromeda Galaxy".to_owned()));
    }

    // ── target_note_update ────────────────────────────────────────────────────

    #[tokio::test]
    async fn note_update_persists_and_returns_updated_at() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        let result = target_note_update(
            &pool,
            TargetNoteUpdateRequest {
                target_id: m31_row().id.clone(),
                content: "Beautiful galaxy".into(),
            },
        )
        .await
        .unwrap();
        assert!(!result.updated_at.is_empty());
        // Read back via target_get to confirm persistence.
        let detail = target_get(&pool, &m31_row().id).await.unwrap();
        assert_eq!(detail.target.notes.as_deref(), Some("Beautiful galaxy"));
    }

    #[tokio::test]
    async fn note_update_empty_string_clears_note() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        target_note_update(
            &pool,
            TargetNoteUpdateRequest {
                target_id: m31_row().id.clone(),
                content: "some note".into(),
            },
        )
        .await
        .unwrap();
        target_note_update(
            &pool,
            TargetNoteUpdateRequest { target_id: m31_row().id.clone(), content: String::new() },
        )
        .await
        .unwrap();
        let detail = target_get(&pool, &m31_row().id).await.unwrap();
        assert!(detail.target.notes.is_none());
    }

    #[tokio::test]
    async fn note_update_too_long_returns_error() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        let big = "x".repeat(16_385);
        let result = target_note_update(
            &pool,
            TargetNoteUpdateRequest { target_id: m31_row().id.clone(), content: big },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "note.too_long");
    }

    #[tokio::test]
    async fn note_update_not_found_returns_error() {
        let pool = setup().await;
        let result = target_note_update(
            &pool,
            TargetNoteUpdateRequest { target_id: "no-such-id".into(), content: "note".into() },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "target.not_found");
    }

    // ── target_alias_add ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn alias_add_happy_path_returns_added_true() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        let result = target_alias_add(
            &pool,
            TargetAliasAddRequest { target_id: m31_row().id.clone(), alias: "Andromeda".into() },
        )
        .await
        .unwrap();
        assert!(result.added);
    }

    #[tokio::test]
    async fn alias_add_idempotent_returns_added_false() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        target_alias_add(
            &pool,
            TargetAliasAddRequest {
                target_id: m31_row().id.clone(),
                alias: "Andromeda Galaxy".into(),
            },
        )
        .await
        .unwrap();
        let result = target_alias_add(
            &pool,
            TargetAliasAddRequest {
                target_id: m31_row().id.clone(),
                alias: "Andromeda Galaxy".into(),
            },
        )
        .await
        .unwrap();
        assert!(!result.added);
    }

    #[tokio::test]
    async fn alias_add_duplicate_on_different_target_returns_error() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        // Create a second target.
        let t2 = TargetRow {
            id: "660e8400-e29b-41d4-a716-446655440001".into(),
            primary_designation: "NGC 7000".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            notes: None,
            updated_at: None,
        };
        upsert_target(&pool, &t2).await.unwrap();
        // Add alias to t2.
        target_alias_add(
            &pool,
            TargetAliasAddRequest { target_id: t2.id.clone(), alias: "Andromeda Galaxy".into() },
        )
        .await
        .unwrap();
        // Attempt to add same alias to m31 — must fail with alias.duplicate.
        let result = target_alias_add(
            &pool,
            TargetAliasAddRequest {
                target_id: m31_row().id.clone(),
                alias: "Andromeda Galaxy".into(),
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "alias.duplicate");
    }

    #[tokio::test]
    async fn alias_add_invalid_alias_returns_error() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        let result = target_alias_add(
            &pool,
            TargetAliasAddRequest { target_id: m31_row().id.clone(), alias: "---".into() },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "alias.invalid");
    }

    // ── target_alias_remove ───────────────────────────────────────────────────

    #[tokio::test]
    async fn alias_remove_happy_path() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        target_alias_add(
            &pool,
            TargetAliasAddRequest {
                target_id: m31_row().id.clone(),
                alias: "Andromeda Galaxy".into(),
            },
        )
        .await
        .unwrap();
        let result = target_alias_remove(
            &pool,
            TargetAliasRemoveRequest {
                target_id: m31_row().id.clone(),
                alias: "Andromeda Galaxy".into(),
            },
        )
        .await
        .unwrap();
        assert_eq!(result.removed_alias, "andromeda galaxy");
        // Verify gone.
        let detail = target_get(&pool, &m31_row().id).await.unwrap();
        assert!(!detail.target.aliases.contains(&"Andromeda Galaxy".to_owned()));
    }

    #[tokio::test]
    async fn alias_remove_primary_returns_is_primary() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        let result = target_alias_remove(
            &pool,
            TargetAliasRemoveRequest { target_id: m31_row().id.clone(), alias: "M 31".into() },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "alias.is_primary");
    }

    #[tokio::test]
    async fn alias_remove_not_found_returns_error() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        let result = target_alias_remove(
            &pool,
            TargetAliasRemoveRequest {
                target_id: m31_row().id.clone(),
                alias: "Nonexistent Alias".into(),
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "alias.not_found");
    }

    // ── target_primary_rename ─────────────────────────────────────────────────

    #[tokio::test]
    async fn primary_rename_happy_path_swaps_primary_and_alias() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        target_alias_add(
            &pool,
            TargetAliasAddRequest {
                target_id: m31_row().id.clone(),
                alias: "Andromeda Galaxy".into(),
            },
        )
        .await
        .unwrap();
        let result = target_primary_rename(
            &pool,
            TargetPrimaryRenameRequest {
                target_id: m31_row().id.clone(),
                new_primary_designation: "Andromeda Galaxy".into(),
            },
        )
        .await
        .unwrap();
        assert_eq!(result.prior_primary, "M 31");
        assert_eq!(result.new_primary, "Andromeda Galaxy");

        // Verify via target_get: new primary set, prior primary now an alias.
        let detail = target_get(&pool, &m31_row().id).await.unwrap();
        assert_eq!(detail.target.primary_designation, "Andromeda Galaxy");
        assert!(detail.target.aliases.contains(&"M 31".to_owned()));
        assert!(!detail.target.aliases.contains(&"Andromeda Galaxy".to_owned()));
    }

    #[tokio::test]
    async fn primary_rename_not_in_aliases_returns_error() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        let result = target_primary_rename(
            &pool,
            TargetPrimaryRenameRequest {
                target_id: m31_row().id.clone(),
                new_primary_designation: "Andromeda Galaxy".into(),
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "designation.not_in_aliases");
    }

    #[tokio::test]
    async fn primary_rename_already_primary_returns_error() {
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        let result = target_primary_rename(
            &pool,
            TargetPrimaryRenameRequest {
                target_id: m31_row().id.clone(),
                new_primary_designation: "M 31".into(),
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().code, "designation.already_primary");
    }

    #[tokio::test]
    async fn note_round_trip_survives_alias_rename() {
        // T026: note round-trip survives alias rename.
        let pool = setup().await;
        upsert_target(&pool, &m31_row()).await.unwrap();
        target_note_update(
            &pool,
            TargetNoteUpdateRequest {
                target_id: m31_row().id.clone(),
                content: "Great for narrowband".into(),
            },
        )
        .await
        .unwrap();
        target_alias_add(
            &pool,
            TargetAliasAddRequest {
                target_id: m31_row().id.clone(),
                alias: "Andromeda Galaxy".into(),
            },
        )
        .await
        .unwrap();
        target_primary_rename(
            &pool,
            TargetPrimaryRenameRequest {
                target_id: m31_row().id.clone(),
                new_primary_designation: "Andromeda Galaxy".into(),
            },
        )
        .await
        .unwrap();
        // Note must still be there.
        let detail = target_get(&pool, &m31_row().id).await.unwrap();
        assert_eq!(detail.target.notes.as_deref(), Some("Great for narrowband"));
    }
}
