// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `framing.list` / `framing.merge` / `framing.split` / `framing.reassign`
//! use cases (spec 008 Q27, F-Framing-3, US5, FR-015).
//!
//! Membership-only mutations: merge/split/reassign only ever touch a
//! framing's `sessionIds` and flip its `clustering` to `"user_adjusted"`.
//! They never recompute or rewrite `targetId`/`opticTrainKey`/`pointing`/
//! `rotation`/`tolerance` (those stay a snapshot of the last real
//! tolerance-clustering pass, F-Framing-2) and never touch the filesystem —
//! framing membership is database metadata (data-model.md §Framing).
//!
//! Every mutation writes a durable audit row via the spec-030 Q15
//! `EventBus::write_audit` write-through helper, following the pattern
//! `crates/app/core/src/protection.rs` established, tagged
//! `EntityType::Framing` so per-entity audit consumers (e.g. the archive
//! store's `entityType: 'project'` query) don't silently swallow framing
//! events under the wrong entity type.

use audit::bus::EventBus;
use audit::event_bus::Source;
use audit::{AuditLogEntry, Outcome, Severity};
use contracts_core::framing::{
    FramingClustering, FramingDto, FramingListRequest, FramingListResponse, FramingMergeRequest,
    FramingMergeResult, FramingPointingDto, FramingReassignRequest, FramingReassignResult,
    FramingSplitRequest, FramingSplitResult, FramingToleranceDto,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::{new_id, EntityId};
use domain_core::lifecycle::data_asset::EntityType;
use persistence_plans::repositories::projects as projects_repo;
use persistence_targets::repositories::framing as framing_repo;
use sqlx::SqlitePool;

use crate::errors::bus_err;

// ── Error helpers ─────────────────────────────────────────────────────────

/// Local `DbError` → `ContractError` mapper: routes a missing framing to the
/// domain-specific `framing.not_found` code, matching
/// `project_setup.rs::db_err`'s precedent for `project.not_found`.
fn db_err(e: persistence_core::DbError) -> ContractError {
    match e {
        persistence_core::DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::FramingNotFound, msg, ErrorSeverity::Blocking, false)
        }
        other => crate::errors::db_err(other),
    }
}

fn project_not_found_err(e: persistence_core::DbError) -> ContractError {
    match e {
        persistence_core::DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::ProjectNotFound, msg, ErrorSeverity::Blocking, false)
        }
        other => crate::errors::db_err(other),
    }
}

fn project_mismatch_err(framing_id: &str) -> ContractError {
    ContractError::new(
        ErrorCode::FramingProjectMismatch,
        format!("framing {framing_id} does not belong to the requested project"),
        ErrorSeverity::Blocking,
        false,
    )
    .with_details(serde_json::json!({ "framingId": framing_id }))
}

async fn ensure_project_exists(pool: &SqlitePool, project_id: &str) -> Result<(), ContractError> {
    projects_repo::get_project(pool, project_id).await.map_err(project_not_found_err)?;
    Ok(())
}

/// Deterministic `entity_id` for a framing audit row: parses `id` as a real
/// UUID (every persisted framing id is one — `domain_core::ids::new_id`) so
/// the audit row's `entity_id` matches the framing's actual identity, falling
/// back to a stable UUIDv5 derivation only if that ever fails (defence in
/// depth, mirrors `app_core_calibration::equipment::equipment_entity_id`).
fn framing_entity_id(id: &str) -> EntityId {
    uuid::Uuid::parse_str(id).map_or_else(
        |_| {
            let ns = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, b"astro-plan.audit.framing");
            EntityId::from_uuid(uuid::Uuid::new_v5(&ns, id.as_bytes()))
        },
        EntityId::from_uuid,
    )
}

async fn write_framing_audit(
    bus: &EventBus,
    framing_id: &str,
    action: &str,
    payload: serde_json::Value,
) -> Result<String, ContractError> {
    let entry = AuditLogEntry::new(
        EntityType::Framing,
        framing_entity_id(framing_id),
        action,
        "user",
        Outcome::Applied,
        Severity::Workflow,
        EntityId::new(),
    )
    .with_payload(payload.clone());
    bus.write_audit(entry, action, Source::User, payload)
        .await
        .map(|id| id.as_uuid().to_string())
        .map_err(bus_err)
}

// ── DTO mapping ──────────────────────────────────────────────────────────

async fn row_to_dto(
    pool: &SqlitePool,
    row: framing_repo::FramingRow,
) -> Result<FramingDto, ContractError> {
    let session_ids =
        framing_repo::list_session_ids_for_framing(pool, &row.id).await.map_err(db_err)?;
    Ok(FramingDto {
        id: row.id,
        project_id: row.project_id,
        target_id: row.target_id,
        optic_train_key: row.optic_train_key,
        pointing: FramingPointingDto { ra: row.pointing_ra_deg, dec: row.pointing_dec_deg },
        rotation: row.rotation_deg,
        tolerance: FramingToleranceDto {
            pointing: row.tolerance_pointing,
            rotation: row.tolerance_rotation_deg,
        },
        session_ids,
        clustering: FramingClustering::from_db_str(&row.clustering),
    })
}

// ── framing.list ─────────────────────────────────────────────────────────

/// List a project's framings (US5, data-model.md `framing.list`).
///
/// # Errors
/// Returns `"project.not_found"` when `req.project_id` does not exist, or
/// `ContractError` on internal database failure.
pub async fn list(
    pool: &SqlitePool,
    req: &FramingListRequest,
) -> Result<FramingListResponse, ContractError> {
    ensure_project_exists(pool, &req.project_id).await?;

    let rows =
        framing_repo::list_framings_by_project(pool, &req.project_id).await.map_err(db_err)?;
    let mut framings = Vec::with_capacity(rows.len());
    for row in rows {
        framings.push(row_to_dto(pool, row).await?);
    }
    Ok(FramingListResponse { framings })
}

// ── framing.merge ────────────────────────────────────────────────────────

/// Fold `req.merge_framing_ids` into `req.primary_framing_id` (US5 AS2,
/// FR-015). Membership-only: every merged-away framing's sessions become
/// members of the primary, the merged-away framing rows are deleted, and the
/// primary flips to `"user_adjusted"`.
///
/// # Errors
/// - `"framing.merge.requires_two"` — `merge_framing_ids` is empty or
///   contains `primary_framing_id`.
/// - `"framing.not_found"` — a referenced framing does not exist.
/// - `"framing.project_mismatch"` — a referenced framing belongs to a
///   different project than `req.project_id`.
/// - `ContractError` on internal database or audit failure.
pub async fn merge(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &FramingMergeRequest,
) -> Result<FramingMergeResult, ContractError> {
    ensure_project_exists(pool, &req.project_id).await?;

    if req.merge_framing_ids.is_empty()
        || req.merge_framing_ids.iter().any(|id| id == &req.primary_framing_id)
    {
        return Err(ContractError::new(
            ErrorCode::FramingMergeRequiresTwo,
            "framing.merge requires at least one framing, distinct from the primary, to merge in.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Reject duplicates up front: without this, a second occurrence of the
    // same id would hit an already-deleted framing (NotFound) after the
    // first occurrence already moved its sessions and deleted the row —
    // partial-mutation state with no transaction to roll it back.
    let mut seen_merge_ids: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
    if !req.merge_framing_ids.iter().all(|id| seen_merge_ids.insert(id.as_str())) {
        return Err(ContractError::new(
            ErrorCode::FramingMergeDuplicateId,
            "framing.merge received the same framing id more than once in mergeFramingIds.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let primary = framing_repo::get_framing(pool, &req.primary_framing_id).await.map_err(db_err)?;
    if primary.project_id != req.project_id {
        return Err(project_mismatch_err(&req.primary_framing_id));
    }

    let mut removed_framing_ids = Vec::with_capacity(req.merge_framing_ids.len());
    for merge_id in &req.merge_framing_ids {
        let merged = framing_repo::get_framing(pool, merge_id).await.map_err(db_err)?;
        if merged.project_id != req.project_id {
            return Err(project_mismatch_err(merge_id));
        }

        let session_ids =
            framing_repo::list_session_ids_for_framing(pool, merge_id).await.map_err(db_err)?;
        for session_id in &session_ids {
            framing_repo::remove_session_from_framing(pool, merge_id, session_id)
                .await
                .map_err(db_err)?;
            framing_repo::add_session_to_framing(pool, &req.primary_framing_id, session_id)
                .await
                .map_err(db_err)?;
        }
        framing_repo::delete_framing(pool, merge_id).await.map_err(db_err)?;
        removed_framing_ids.push(merge_id.clone());
    }

    framing_repo::update_framing_clustering(pool, &req.primary_framing_id, "user_adjusted")
        .await
        .map_err(db_err)?;

    let updated = framing_repo::get_framing(pool, &req.primary_framing_id).await.map_err(db_err)?;
    let framing = row_to_dto(pool, updated).await?;

    let audit_id = write_framing_audit(
        bus,
        &req.primary_framing_id,
        "framing.merge",
        serde_json::json!({
            "projectId": req.project_id,
            "primaryFramingId": req.primary_framing_id,
            "mergedFramingIds": removed_framing_ids,
        }),
    )
    .await?;

    Ok(FramingMergeResult {
        project_id: req.project_id.clone(),
        framing,
        removed_framing_ids,
        audit_id,
    })
}

// ── framing.split ────────────────────────────────────────────────────────

/// Move `req.session_ids` (a non-empty proper subset of
/// `req.source_framing_id`'s members) into a brand-new framing (US5 AS2,
/// FR-015). The new framing inherits the source's target/optic-train/
/// pointing/rotation/tolerance snapshot unchanged; both the source and the
/// new framing flip to `"user_adjusted"`.
///
/// # Errors
/// - `"framing.split.empty_selection"` — `session_ids` is empty.
/// - `"framing.split.invalid_session"` — a requested session is not a
///   current member of `source_framing_id`.
/// - `"framing.split.would_empty_source"` — every current member was
///   selected, which would leave the source framing empty.
/// - `"framing.not_found"` / `"framing.project_mismatch"` / `ContractError`
///   as in [`merge`].
pub async fn split(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &FramingSplitRequest,
) -> Result<FramingSplitResult, ContractError> {
    ensure_project_exists(pool, &req.project_id).await?;

    if req.session_ids.is_empty() {
        return Err(ContractError::new(
            ErrorCode::FramingSplitEmptySelection,
            "framing.split requires at least one session to move into the new framing.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let source = framing_repo::get_framing(pool, &req.source_framing_id).await.map_err(db_err)?;
    if source.project_id != req.project_id {
        return Err(project_mismatch_err(&req.source_framing_id));
    }

    let current_members = framing_repo::list_session_ids_for_framing(pool, &req.source_framing_id)
        .await
        .map_err(db_err)?;

    // Dedup the requested ids (preserving order) and validate membership.
    let mut requested: Vec<&str> = Vec::with_capacity(req.session_ids.len());
    for id in &req.session_ids {
        if !current_members.iter().any(|m| m == id) {
            return Err(ContractError::new(
                ErrorCode::FramingSplitInvalidSession,
                format!("session {id} is not a member of framing {}", req.source_framing_id),
                ErrorSeverity::Blocking,
                false,
            )
            .with_details(serde_json::json!({ "sessionId": id })));
        }
        if !requested.contains(&id.as_str()) {
            requested.push(id.as_str());
        }
    }

    if requested.len() >= current_members.len() {
        return Err(ContractError::new(
            ErrorCode::FramingSplitWouldEmptySource,
            "framing.split must leave at least one session in the source framing.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let new_framing_id = new_id();
    framing_repo::insert_framing(
        pool,
        &framing_repo::InsertFraming {
            id: &new_framing_id,
            project_id: &source.project_id,
            target_id: source.target_id.as_deref(),
            optic_train_key: &source.optic_train_key,
            pointing_ra_deg: source.pointing_ra_deg,
            pointing_dec_deg: source.pointing_dec_deg,
            rotation_deg: source.rotation_deg,
            tolerance_pointing: source.tolerance_pointing,
            tolerance_rotation_deg: source.tolerance_rotation_deg,
            clustering: "user_adjusted",
        },
    )
    .await
    .map_err(db_err)?;

    for session_id in &requested {
        framing_repo::remove_session_from_framing(pool, &req.source_framing_id, session_id)
            .await
            .map_err(db_err)?;
        framing_repo::add_session_to_framing(pool, &new_framing_id, session_id)
            .await
            .map_err(db_err)?;
    }

    framing_repo::update_framing_clustering(pool, &req.source_framing_id, "user_adjusted")
        .await
        .map_err(db_err)?;

    let source_updated =
        framing_repo::get_framing(pool, &req.source_framing_id).await.map_err(db_err)?;
    let new_row = framing_repo::get_framing(pool, &new_framing_id).await.map_err(db_err)?;
    let source_framing = row_to_dto(pool, source_updated).await?;
    let new_framing = row_to_dto(pool, new_row).await?;

    let audit_id = write_framing_audit(
        bus,
        &new_framing_id,
        "framing.split",
        serde_json::json!({
            "projectId": req.project_id,
            "sourceFramingId": req.source_framing_id,
            "newFramingId": new_framing_id,
            "sessionIds": requested,
        }),
    )
    .await?;

    Ok(FramingSplitResult {
        project_id: req.project_id.clone(),
        source_framing,
        new_framing,
        audit_id,
    })
}

// ── framing.reassign ─────────────────────────────────────────────────────

/// Move `req.session_ids` into `req.target_framing_id` (US5 AS2, FR-015),
/// whether each currently belongs to another framing of the same project or
/// to none. `target_framing_id` flips to `"user_adjusted"`, as does any
/// framing a session was moved out of.
///
/// # Errors
/// - `"framing.reassign.empty_selection"` — `session_ids` is empty.
/// - `"framing.not_found"` / `"framing.project_mismatch"` / `ContractError`
///   as in [`merge`].
pub async fn reassign(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &FramingReassignRequest,
) -> Result<FramingReassignResult, ContractError> {
    ensure_project_exists(pool, &req.project_id).await?;

    if req.session_ids.is_empty() {
        return Err(ContractError::new(
            ErrorCode::FramingReassignEmptySelection,
            "framing.reassign requires at least one session to move.",
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let target = framing_repo::get_framing(pool, &req.target_framing_id).await.map_err(db_err)?;
    if target.project_id != req.project_id {
        return Err(project_mismatch_err(&req.target_framing_id));
    }

    let mut affected: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    affected.insert(req.target_framing_id.clone());

    for session_id in &req.session_ids {
        if let Some(current_framing_id) =
            framing_repo::get_framing_id_for_session(pool, session_id).await.map_err(db_err)?
        {
            if current_framing_id == req.target_framing_id {
                // Already a member — nothing to move.
                continue;
            }
            let current =
                framing_repo::get_framing(pool, &current_framing_id).await.map_err(db_err)?;
            if current.project_id != req.project_id {
                return Err(project_mismatch_err(&current_framing_id));
            }
            framing_repo::remove_session_from_framing(pool, &current_framing_id, session_id)
                .await
                .map_err(db_err)?;
            framing_repo::update_framing_clustering(pool, &current_framing_id, "user_adjusted")
                .await
                .map_err(db_err)?;
            affected.insert(current_framing_id);
        }
        framing_repo::add_session_to_framing(pool, &req.target_framing_id, session_id)
            .await
            .map_err(db_err)?;
    }

    framing_repo::update_framing_clustering(pool, &req.target_framing_id, "user_adjusted")
        .await
        .map_err(db_err)?;

    let updated_target =
        framing_repo::get_framing(pool, &req.target_framing_id).await.map_err(db_err)?;
    let target_framing = row_to_dto(pool, updated_target).await?;

    let audit_id = write_framing_audit(
        bus,
        &req.target_framing_id,
        "framing.reassign",
        serde_json::json!({
            "projectId": req.project_id,
            "targetFramingId": req.target_framing_id,
            "sessionIds": req.session_ids,
            "affectedFramingIds": affected.iter().collect::<Vec<_>>(),
        }),
    )
    .await?;

    Ok(FramingReassignResult {
        project_id: req.project_id.clone(),
        target_framing,
        affected_framing_ids: affected.into_iter().collect(),
        audit_id,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_core::Database;
    use persistence_targets::repositories::framing::InsertFraming;

    async fn setup() -> (Database, EventBus) {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    async fn insert_project(pool: &SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO projects (id, name, tool, lifecycle, path, notes, channel_drift, is_mosaic, created_at, updated_at) \
             VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(id)
        .bind(format!("Project {id}"))
        .bind("PixInsight")
        .bind("ready")
        .bind(format!("projects/{id}"))
        .bind::<Option<String>>(None)
        .bind(false)
        .bind(false)
        .bind("2026-01-01T00:00:00Z")
        .bind("2026-01-01T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_session(pool: &SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at) \
             VALUES (?, ?, '[]', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(format!("session-key-{id}"))
        .execute(pool)
        .await
        .unwrap();
    }

    fn insert_data<'a>(id: &'a str, project_id: &'a str) -> InsertFraming<'a> {
        InsertFraming {
            id,
            project_id,
            target_id: None,
            optic_train_key: "scope-a|cam-a",
            pointing_ra_deg: 10.0,
            pointing_dec_deg: 20.0,
            rotation_deg: 0.0,
            tolerance_pointing: 0.1,
            tolerance_rotation_deg: 3.0,
            clustering: "suggested",
        }
    }

    // ── framing.list ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_returns_project_framings_with_members() {
        let (db, _bus) = setup().await;
        insert_project(db.pool(), "proj-1").await;
        insert_session(db.pool(), "sess-1").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-1", "proj-1")).await.unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-1", "sess-1").await.unwrap();

        let resp =
            list(db.pool(), &FramingListRequest { project_id: "proj-1".to_owned() }).await.unwrap();

        assert_eq!(resp.framings.len(), 1);
        assert_eq!(resp.framings[0].id, "framing-1");
        assert_eq!(resp.framings[0].session_ids, vec!["sess-1".to_owned()]);
        assert_eq!(resp.framings[0].clustering, FramingClustering::Suggested);
    }

    #[tokio::test]
    async fn list_unknown_project_returns_not_found() {
        let (db, _bus) = setup().await;
        let err = list(db.pool(), &FramingListRequest { project_id: "nope".to_owned() })
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::ProjectNotFound);
    }

    // ── framing.merge ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn merge_folds_sessions_and_deletes_merged_framings() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-m").await;
        insert_session(db.pool(), "sess-a").await;
        insert_session(db.pool(), "sess-b").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-a", "proj-m")).await.unwrap();
        framing_repo::insert_framing(db.pool(), &insert_data("framing-b", "proj-m")).await.unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-a", "sess-a").await.unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-b", "sess-b").await.unwrap();

        let result = merge(
            db.pool(),
            &bus,
            &FramingMergeRequest {
                request_id: "req-1".to_owned(),
                project_id: "proj-m".to_owned(),
                primary_framing_id: "framing-a".to_owned(),
                merge_framing_ids: vec!["framing-b".to_owned()],
            },
        )
        .await
        .unwrap();

        assert_eq!(result.removed_framing_ids, vec!["framing-b".to_owned()]);
        assert_eq!(result.framing.clustering, FramingClustering::UserAdjusted);
        let mut members = result.framing.session_ids.clone();
        members.sort();
        assert_eq!(members, vec!["sess-a".to_owned(), "sess-b".to_owned()]);
        assert!(!result.audit_id.is_empty());

        // The merged-away framing row is gone.
        assert!(matches!(
            framing_repo::get_framing(db.pool(), "framing-b").await.unwrap_err(),
            persistence_core::DbError::NotFound(_)
        ));

        // Durable audit row exists.
        let row: (String, String) =
            sqlx::query_as("SELECT entity_type, outcome FROM audit_log_entry WHERE audit_id = ?")
                .bind(&result.audit_id)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(row.0, "framing");
        assert_eq!(row.1, "applied");
    }

    #[tokio::test]
    async fn merge_requires_at_least_one_distinct_framing() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-m2").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-x", "proj-m2"))
            .await
            .unwrap();

        let err = merge(
            db.pool(),
            &bus,
            &FramingMergeRequest {
                request_id: "req-2".to_owned(),
                project_id: "proj-m2".to_owned(),
                primary_framing_id: "framing-x".to_owned(),
                merge_framing_ids: vec![],
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::FramingMergeRequiresTwo);
    }

    /// A duplicate id in `merge_framing_ids` must be rejected before any
    /// mutation happens — without this upfront check, the second occurrence
    /// would hit an already-deleted framing (NotFound) after the first
    /// occurrence had already moved its sessions and deleted the row,
    /// leaking partial state (no transaction wraps the merge loop).
    #[tokio::test]
    async fn merge_rejects_duplicate_merge_framing_id_with_no_partial_mutation() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-m4").await;
        insert_session(db.pool(), "sess-a").await;
        insert_session(db.pool(), "sess-b").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-primary", "proj-m4"))
            .await
            .unwrap();
        framing_repo::insert_framing(db.pool(), &insert_data("framing-dup", "proj-m4"))
            .await
            .unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-primary", "sess-a").await.unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-dup", "sess-b").await.unwrap();

        let err = merge(
            db.pool(),
            &bus,
            &FramingMergeRequest {
                request_id: "req-dup".to_owned(),
                project_id: "proj-m4".to_owned(),
                primary_framing_id: "framing-primary".to_owned(),
                merge_framing_ids: vec!["framing-dup".to_owned(), "framing-dup".to_owned()],
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::FramingMergeDuplicateId);

        // No partial mutation: both framings still exist with their original
        // membership and clustering, untouched by the rejected request.
        let primary_row = framing_repo::get_framing(db.pool(), "framing-primary").await.unwrap();
        assert_eq!(primary_row.clustering, "suggested");
        assert_eq!(
            framing_repo::list_session_ids_for_framing(db.pool(), "framing-primary").await.unwrap(),
            vec!["sess-a".to_owned()]
        );
        let dup_row = framing_repo::get_framing(db.pool(), "framing-dup").await.unwrap();
        assert_eq!(dup_row.clustering, "suggested");
        assert_eq!(
            framing_repo::list_session_ids_for_framing(db.pool(), "framing-dup").await.unwrap(),
            vec!["sess-b".to_owned()]
        );
    }

    #[tokio::test]
    async fn merge_rejects_framing_from_another_project() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-m3").await;
        insert_project(db.pool(), "proj-other").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-p3", "proj-m3"))
            .await
            .unwrap();
        framing_repo::insert_framing(db.pool(), &insert_data("framing-other", "proj-other"))
            .await
            .unwrap();

        let err = merge(
            db.pool(),
            &bus,
            &FramingMergeRequest {
                request_id: "req-3".to_owned(),
                project_id: "proj-m3".to_owned(),
                primary_framing_id: "framing-p3".to_owned(),
                merge_framing_ids: vec!["framing-other".to_owned()],
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::FramingProjectMismatch);
    }

    // ── framing.split ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn split_moves_selected_sessions_into_a_new_framing() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-s").await;
        insert_session(db.pool(), "sess-1").await;
        insert_session(db.pool(), "sess-2").await;
        insert_session(db.pool(), "sess-3").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-s", "proj-s")).await.unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-s", "sess-1").await.unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-s", "sess-2").await.unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-s", "sess-3").await.unwrap();

        let result = split(
            db.pool(),
            &bus,
            &FramingSplitRequest {
                request_id: "req-4".to_owned(),
                project_id: "proj-s".to_owned(),
                source_framing_id: "framing-s".to_owned(),
                session_ids: vec!["sess-2".to_owned(), "sess-3".to_owned()],
            },
        )
        .await
        .unwrap();

        assert_eq!(result.source_framing.session_ids, vec!["sess-1".to_owned()]);
        assert_eq!(result.source_framing.clustering, FramingClustering::UserAdjusted);
        let mut new_members = result.new_framing.session_ids.clone();
        new_members.sort();
        assert_eq!(new_members, vec!["sess-2".to_owned(), "sess-3".to_owned()]);
        assert_eq!(result.new_framing.clustering, FramingClustering::UserAdjusted);
        // Membership-only: the new framing inherits the source's geometry snapshot.
        assert_eq!(result.new_framing.optic_train_key, "scope-a|cam-a");
        assert!((result.new_framing.pointing.ra - 10.0).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn split_rejects_empty_selection() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-s2").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-s2", "proj-s2"))
            .await
            .unwrap();

        let err = split(
            db.pool(),
            &bus,
            &FramingSplitRequest {
                request_id: "req-5".to_owned(),
                project_id: "proj-s2".to_owned(),
                source_framing_id: "framing-s2".to_owned(),
                session_ids: vec![],
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::FramingSplitEmptySelection);
    }

    #[tokio::test]
    async fn split_rejects_session_not_a_member() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-s3").await;
        insert_session(db.pool(), "sess-1").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-s3", "proj-s3"))
            .await
            .unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-s3", "sess-1").await.unwrap();

        let err = split(
            db.pool(),
            &bus,
            &FramingSplitRequest {
                request_id: "req-6".to_owned(),
                project_id: "proj-s3".to_owned(),
                source_framing_id: "framing-s3".to_owned(),
                session_ids: vec!["sess-unknown".to_owned()],
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::FramingSplitInvalidSession);
    }

    #[tokio::test]
    async fn split_rejects_selection_that_would_empty_the_source() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-s4").await;
        insert_session(db.pool(), "sess-1").await;
        insert_session(db.pool(), "sess-2").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-s4", "proj-s4"))
            .await
            .unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-s4", "sess-1").await.unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-s4", "sess-2").await.unwrap();

        let err = split(
            db.pool(),
            &bus,
            &FramingSplitRequest {
                request_id: "req-7".to_owned(),
                project_id: "proj-s4".to_owned(),
                source_framing_id: "framing-s4".to_owned(),
                session_ids: vec!["sess-1".to_owned(), "sess-2".to_owned()],
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::FramingSplitWouldEmptySource);
    }

    // ── framing.reassign ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn reassign_moves_session_between_framings() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-r").await;
        insert_session(db.pool(), "sess-1").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-r1", "proj-r"))
            .await
            .unwrap();
        framing_repo::insert_framing(db.pool(), &insert_data("framing-r2", "proj-r"))
            .await
            .unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-r1", "sess-1").await.unwrap();

        let result = reassign(
            db.pool(),
            &bus,
            &FramingReassignRequest {
                request_id: "req-8".to_owned(),
                project_id: "proj-r".to_owned(),
                session_ids: vec!["sess-1".to_owned()],
                target_framing_id: "framing-r2".to_owned(),
            },
        )
        .await
        .unwrap();

        assert_eq!(result.target_framing.session_ids, vec!["sess-1".to_owned()]);
        assert_eq!(result.target_framing.clustering, FramingClustering::UserAdjusted);
        let mut affected = result.affected_framing_ids.clone();
        affected.sort();
        assert_eq!(affected, vec!["framing-r1".to_owned(), "framing-r2".to_owned()]);

        // The source framing lost its member and is itself flagged user_adjusted.
        let source_row = framing_repo::get_framing(db.pool(), "framing-r1").await.unwrap();
        assert_eq!(source_row.clustering, "user_adjusted");
        assert!(framing_repo::list_session_ids_for_framing(db.pool(), "framing-r1")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn reassign_attaches_a_previously_unassigned_session() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-r2").await;
        insert_session(db.pool(), "sess-orphan").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-r3", "proj-r2"))
            .await
            .unwrap();

        let result = reassign(
            db.pool(),
            &bus,
            &FramingReassignRequest {
                request_id: "req-9".to_owned(),
                project_id: "proj-r2".to_owned(),
                session_ids: vec!["sess-orphan".to_owned()],
                target_framing_id: "framing-r3".to_owned(),
            },
        )
        .await
        .unwrap();

        assert_eq!(result.target_framing.session_ids, vec!["sess-orphan".to_owned()]);
        assert_eq!(result.affected_framing_ids, vec!["framing-r3".to_owned()]);
    }

    #[tokio::test]
    async fn reassign_rejects_empty_selection() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-r4").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-r4", "proj-r4"))
            .await
            .unwrap();

        let err = reassign(
            db.pool(),
            &bus,
            &FramingReassignRequest {
                request_id: "req-10".to_owned(),
                project_id: "proj-r4".to_owned(),
                session_ids: vec![],
                target_framing_id: "framing-r4".to_owned(),
            },
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::FramingReassignEmptySelection);
    }

    #[tokio::test]
    async fn reassign_is_idempotent_for_a_session_already_in_the_target() {
        let (db, bus) = setup().await;
        insert_project(db.pool(), "proj-r5").await;
        insert_session(db.pool(), "sess-1").await;
        framing_repo::insert_framing(db.pool(), &insert_data("framing-r5", "proj-r5"))
            .await
            .unwrap();
        framing_repo::add_session_to_framing(db.pool(), "framing-r5", "sess-1").await.unwrap();

        let result = reassign(
            db.pool(),
            &bus,
            &FramingReassignRequest {
                request_id: "req-11".to_owned(),
                project_id: "proj-r5".to_owned(),
                session_ids: vec!["sess-1".to_owned()],
                target_framing_id: "framing-r5".to_owned(),
            },
        )
        .await
        .unwrap();

        assert_eq!(result.target_framing.session_ids, vec!["sess-1".to_owned()]);
    }
}
