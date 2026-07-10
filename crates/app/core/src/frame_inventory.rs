//! Per-frame inventory use cases (spec 048 T006/T015).
//!
//! `list_frames` backs `inventory.frame.list`: a read-only projection of
//! `file_record` rows for a session or root.
//!
//! `run_reconcile` backs `inventory.reconcile.run` for the `on_demand`
//! trigger: it walks the root's on-disk state (via
//! `fs_inventory::reconcile::reconcile_root`, gated by the root's
//! `detection.follow_symlinks` setting — spec 048 T003/T004), corrects any
//! present record whose recorded size is stale or `0` (FR-006/FR-012, T015 —
//! emitting `frame.size_backfilled`), and marks newly-absent records
//! `missing` / newly-present records recovered (FR-007/FR-009/FR-011),
//! emitting `frame.missing`/`frame.recovered`. It NEVER creates, deletes, or
//! moves a file (FR-008/INV-2) — only `file_record` rows are written.
//!
//! Applying a root's `reconcile.mode` to session `frame_ids` array membership
//! (dropping a missing id from the array in auto-reconcile mode, FR-010) is
//! left for the full US2 T021 implementation: this pass always retains the
//! id in the array and relies on the existing `state != 'missing'` filter
//! (`app_core::sessions::active_frame_summary`) to exclude it from active
//! counts/totals, which already satisfies FR-009's flag-missing behaviour.

use std::path::Path;

use contracts_core::error_code::ErrorCode;
use contracts_core::inventory_frame::{
    FramePresenceState, InventoryFrame, InventoryFrameListRequest, InventoryFrameListResponse,
    InventoryReconcileRunRequest, InventoryReconcileRunResponse, RawFrameType, ReconcileMode,
};
use contracts_core::{ContractError, ErrorSeverity};
use fs_inventory::reconcile::{reconcile_root, FrameOutcome, KnownFrame};
use sqlx::SqlitePool;

use app_core_errors::db_err;
use app_core_targets::frame_writer::upsert_frame_record;

fn internal(msg: impl std::fmt::Display) -> ContractError {
    ContractError::new(ErrorCode::InternalDatabase, msg.to_string(), ErrorSeverity::Fatal, true)
}

/// Raw row shape shared by both list paths.
struct FrameRow {
    id: String,
    root_id: String,
    relative_path: String,
    size_bytes: i64,
    state: String,
}

fn presence_state(state: &str) -> FramePresenceState {
    match state {
        "missing" => FramePresenceState::Missing,
        "protected" => FramePresenceState::Protected,
        _ => FramePresenceState::Present,
    }
}

/// `calibration_session.kind` → [`RawFrameType`]. `flat_dark` frames are a
/// dark exposure taken at flat settings; they are classified as `Dark` here
/// since there is no dedicated wire variant (documented simplification).
fn raw_frame_type_from_calibration_kind(kind: &str) -> RawFrameType {
    match kind {
        "flat" => RawFrameType::Flat,
        "bias" => RawFrameType::Bias,
        _ => RawFrameType::Dark, // "dark" | "flat_dark"
    }
}

async fn frame_ids_for_session(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Option<(Vec<String>, RawFrameType)>, ContractError> {
    if let Some(frame_ids_json) =
        persistence_db::repositories::q_core::get_acquisition_session_frame_ids(pool, session_id)
            .await
            .map_err(db_err)?
    {
        let ids: Vec<String> = serde_json::from_str(&frame_ids_json).unwrap_or_default();
        return Ok(Some((ids, RawFrameType::Light)));
    }

    if let Some((frame_ids_json, kind)) =
        persistence_db::repositories::q_core::get_calibration_session_frame_ids_and_kind(
            pool, session_id,
        )
        .await
        .map_err(db_err)?
    {
        let ids: Vec<String> = serde_json::from_str(&frame_ids_json).unwrap_or_default();
        return Ok(Some((ids, raw_frame_type_from_calibration_kind(&kind))));
    }

    Ok(None)
}

fn frame_row_from_repo_row(r: persistence_db::repositories::q_core::FileRecordRow) -> FrameRow {
    FrameRow {
        id: r.id,
        root_id: r.root_id,
        relative_path: r.relative_path,
        size_bytes: r.size_bytes,
        state: r.state,
    }
}

async fn rows_by_ids(pool: &SqlitePool, ids: &[String]) -> Result<Vec<FrameRow>, ContractError> {
    let rows = persistence_db::repositories::q_core::file_records_by_ids(pool, ids)
        .await
        .map_err(db_err)?;
    Ok(rows.into_iter().map(frame_row_from_repo_row).collect())
}

async fn rows_by_root(pool: &SqlitePool, root_id: &str) -> Result<Vec<FrameRow>, ContractError> {
    let rows = persistence_db::repositories::q_core::file_records_by_root(pool, root_id)
        .await
        .map_err(db_err)?;
    Ok(rows.into_iter().map(frame_row_from_repo_row).collect())
}

/// Best-effort reverse lookup: which session (if any) references `frame_id`,
/// and that session's frame type. Used only for the root-scoped list, where
/// `file_record` itself carries no frame-type column. A frame referenced by
/// no session (e.g. never joined, or a future hard-delete edge case) falls
/// back to `Light` — documented limitation of this scaffold; session-scoped
/// listing (the common case per contracts/operations.md) does not need this
/// fallback at all.
async fn owning_session_frame_type(
    pool: &SqlitePool,
    frame_id: &str,
) -> Result<(Option<String>, RawFrameType), ContractError> {
    let like = format!("%\"{frame_id}\"%");

    if let Some(session_id) =
        persistence_db::repositories::q_core::find_acquisition_session_id_by_frame_like(pool, &like)
            .await
            .map_err(db_err)?
    {
        return Ok((Some(session_id), RawFrameType::Light));
    }

    if let Some((session_id, kind)) =
        persistence_db::repositories::q_core::find_calibration_session_by_frame_like(pool, &like)
            .await
            .map_err(db_err)?
    {
        return Ok((Some(session_id), raw_frame_type_from_calibration_kind(&kind)));
    }

    Ok((None, RawFrameType::Light))
}

/// `inventory.frame.list` — list per-frame inventory entries for a session or
/// root (spec 048 T006/T014). `present_*` totals exclude `missing` frames.
///
/// # Errors
///
/// Returns `ContractError` (`internal.database`) on a query failure, or
/// `internal.error` when neither `session_id` nor `root_id` is set.
pub async fn list_frames(
    pool: &SqlitePool,
    req: &InventoryFrameListRequest,
) -> Result<InventoryFrameListResponse, ContractError> {
    let include_missing = req.include_missing.unwrap_or(false);

    let mut frames = Vec::new();

    if let Some(session_id) = &req.scope.session_id {
        let Some((ids, frame_type)) = frame_ids_for_session(pool, session_id).await? else {
            return Ok(InventoryFrameListResponse {
                frames: Vec::new(),
                present_count: 0,
                present_size_bytes: 0,
            });
        };
        for row in rows_by_ids(pool, &ids).await? {
            let state = presence_state(&row.state);
            if !include_missing && state == FramePresenceState::Missing {
                continue;
            }
            frames.push(InventoryFrame {
                frame_id: row.id,
                root_id: row.root_id,
                relative_path: row.relative_path,
                frame_type,
                size_bytes: row.size_bytes,
                state,
                session_id: Some(session_id.clone()),
            });
        }
    } else if let Some(root_id) = &req.scope.root_id {
        for row in rows_by_root(pool, root_id).await? {
            let state = presence_state(&row.state);
            if !include_missing && state == FramePresenceState::Missing {
                continue;
            }
            let (session_id, frame_type) = owning_session_frame_type(pool, &row.id).await?;
            frames.push(InventoryFrame {
                frame_id: row.id,
                root_id: row.root_id,
                relative_path: row.relative_path,
                frame_type,
                size_bytes: row.size_bytes,
                state,
                session_id,
            });
        }
    } else {
        return Err(ContractError::new(
            ErrorCode::InternalError,
            "inventory.frame.list: scope must set session_id or root_id".to_owned(),
            ErrorSeverity::Warning,
            false,
        ));
    }

    let present_count =
        u32::try_from(frames.iter().filter(|f| f.state != FramePresenceState::Missing).count())
            .unwrap_or(u32::MAX);
    let present_size_bytes = frames
        .iter()
        .filter(|f| f.state != FramePresenceState::Missing)
        .map(|f| f.size_bytes)
        .sum();

    Ok(InventoryFrameListResponse { frames, present_count, present_size_bytes })
}

fn iso_now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Iso8601::DEFAULT)
        .unwrap_or_default()
}

/// Running tallies accumulated across a reconcile pass.
#[derive(Default)]
struct ReconcileTally {
    present: u32,
    newly_missing: u32,
    recovered: u32,
    size_backfilled: u32,
}

/// Apply a single `Present` outcome: correct `size_bytes` when it changed
/// (including the `0` placeholder backfill, T015) and/or flip a previously
/// `missing` record back to `classified` (FR-011), emitting the matching
/// audit events. A no-op when nothing changed.
async fn apply_present_outcome(
    pool: &SqlitePool,
    bus: &audit::bus::EventBus,
    row: &FrameRow,
    real_size_bytes: i64,
    was_missing: bool,
    tally: &mut ReconcileTally,
) -> Result<(), ContractError> {
    tally.present += 1;
    if row.size_bytes == real_size_bytes && !was_missing {
        return Ok(());
    }

    let now = iso_now();
    upsert_frame_record(
        pool,
        &row.root_id,
        &row.relative_path,
        real_size_bytes,
        &now,
        "classified",
    )
    .await
    .map_err(|e| internal(e.message))?;

    if row.size_bytes == 0 {
        tally.size_backfilled += 1;
        bus.publish(
            audit::event_bus::TOPIC_FRAME_SIZE_BACKFILLED,
            audit::event_bus::Source::System,
            audit::event_bus::FrameSizeBackfilled {
                frame_id: row.id.clone(),
                root_id: row.root_id.clone(),
                relative_path: row.relative_path.clone(),
                prior_size_bytes: row.size_bytes,
                size_bytes: real_size_bytes,
                at: now.clone(),
            },
        )
        .await
        .map_err(internal)?;
    }

    if was_missing {
        tally.recovered += 1;
        bus.publish(
            audit::event_bus::TOPIC_FRAME_RECOVERED,
            audit::event_bus::Source::System,
            audit::event_bus::FrameRecovered {
                frame_id: row.id.clone(),
                root_id: row.root_id.clone(),
                relative_path: row.relative_path.clone(),
                at: now,
            },
        )
        .await
        .map_err(internal)?;
    }

    Ok(())
}

/// Apply a single `Missing` outcome: mark the record `missing` when it
/// wasn't already (FR-007/FR-009), emitting `frame.missing`. Applying the
/// root's `reconcile.mode` to session `frame_ids` array membership (FR-010)
/// is left to the full US2 T021 implementation — see module docs.
async fn apply_missing_outcome(
    pool: &SqlitePool,
    bus: &audit::bus::EventBus,
    row: &FrameRow,
    was_missing: bool,
    reason: &str,
    tally: &mut ReconcileTally,
) -> Result<(), ContractError> {
    if was_missing {
        return Ok(());
    }
    tally.newly_missing += 1;
    let now = iso_now();
    persistence_db::repositories::q_core::mark_file_record_missing(pool, &row.id)
        .await
        .map_err(db_err)?;

    bus.publish(
        audit::event_bus::TOPIC_FRAME_MISSING,
        audit::event_bus::Source::System,
        audit::event_bus::FrameMissing {
            frame_id: row.id.clone(),
            root_id: row.root_id.clone(),
            relative_path: row.relative_path.clone(),
            reason: reason.to_owned(),
            at: now,
        },
    )
    .await
    .map_err(internal)?;

    Ok(())
}

/// `inventory.reconcile.run` — on-demand reconcile pass over a root (spec 048
/// T003/T015/US2 groundwork). See module docs for exactly what this pass
/// does and does not apply yet.
///
/// # Errors
///
/// Returns `ContractError` (`root.unavailable`) when the root is not
/// registered; database errors otherwise. A root whose directory does not
/// currently exist on disk is NOT an error — every known frame is reported
/// `missing` (e.g. a disconnected removable drive), matching the spec's
/// "never treat storage-absent as permanently deleted" edge case.
pub async fn run_reconcile(
    pool: &SqlitePool,
    bus: &audit::bus::EventBus,
    req: &InventoryReconcileRunRequest,
) -> Result<InventoryReconcileRunResponse, ContractError> {
    let root_path_str =
        persistence_db::repositories::inventory::get_library_root_path(pool, &req.root_id)
            .await
            .map_err(db_err)?
            .ok_or_else(|| {
                ContractError::new(
                    ErrorCode::RootUnavailable,
                    format!("library root {} is not registered", req.root_id),
                    ErrorSeverity::Blocking,
                    false,
                )
            })?;
    let root_path = Path::new(&root_path_str);

    let config = app_core_settings::root_config::get_root_config(pool, &req.root_id).await?;

    let known_rows = rows_by_root(pool, &req.root_id).await?;
    let known: Vec<KnownFrame> = known_rows
        .iter()
        .map(|r| KnownFrame {
            id: r.id.clone(),
            relative_path: r.relative_path.clone(),
            recorded_size_bytes: r.size_bytes,
        })
        .collect();

    let report = reconcile_root(root_path, &known, config.detection.follow_symlinks);
    let reason = format!("{:?}", req.reason).to_lowercase();

    let mut tally = ReconcileTally::default();
    let mut scanned: u32 = 0;

    for entry in &report.entries {
        scanned += 1;
        let Some(row) = known_rows.iter().find(|r| r.id == entry.id) else { continue };
        let was_missing = row.state == "missing";

        match entry.outcome {
            FrameOutcome::Present { real_size_bytes } => {
                apply_present_outcome(pool, bus, row, real_size_bytes, was_missing, &mut tally)
                    .await?;
            }
            FrameOutcome::Missing => {
                apply_missing_outcome(pool, bus, row, was_missing, &reason, &mut tally).await?;
                // `reconcile.mode` is loaded above (`config`) so a future US2
                // T021 patch can drop the id from the owning session's
                // `frame_ids` array in auto-reconcile mode without
                // re-plumbing this function's signature.
                let _ = matches!(config.reconcile_mode, ReconcileMode::AutoReconcile);
            }
        }
    }

    Ok(InventoryReconcileRunResponse {
        scanned,
        present: tally.present,
        newly_missing: tally.newly_missing,
        recovered: tally.recovered,
        size_backfilled: tally.size_backfilled,
        progress_pct: 100,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts_core::inventory_frame::{InventoryFrameListScope, ReconcileReason};
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    async fn insert_root(pool: &SqlitePool, id: &str, path: &str) {
        sqlx::query(
            "INSERT INTO library_root (id, label, current_path, kind, state, created_at)
             VALUES (?, ?, ?, 'local', 'active', datetime('now'))",
        )
        .bind(id)
        .bind(id)
        .bind(path)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_acquisition_session(pool: &SqlitePool, id: &str, frame_ids: &[&str]) {
        let frame_ids_json = serde_json::to_string(frame_ids).unwrap();
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at)
             VALUES (?, '{}', ?, datetime('now'))",
        )
        .bind(id)
        .bind(frame_ids_json)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn list_frames_by_session_excludes_missing_by_default() {
        let db = test_db().await;
        insert_root(db.pool(), "root-1", "/tmp").await;
        let f1 = upsert_frame_record(db.pool(), "root-1", "a.fits", 100, "t0", "classified")
            .await
            .unwrap();
        let f2 =
            upsert_frame_record(db.pool(), "root-1", "b.fits", 200, "t0", "missing").await.unwrap();
        insert_acquisition_session(db.pool(), "sess-1", &[&f1, &f2]).await;

        let req = InventoryFrameListRequest {
            scope: InventoryFrameListScope { session_id: Some("sess-1".to_owned()), root_id: None },
            include_missing: None,
        };
        let resp = list_frames(db.pool(), &req).await.unwrap();

        assert_eq!(resp.frames.len(), 1);
        assert_eq!(resp.present_count, 1);
        assert_eq!(resp.present_size_bytes, 100);
    }

    #[tokio::test]
    async fn list_frames_by_session_includes_missing_when_requested() {
        let db = test_db().await;
        insert_root(db.pool(), "root-1", "/tmp").await;
        let f1 =
            upsert_frame_record(db.pool(), "root-1", "a.fits", 100, "t0", "missing").await.unwrap();
        insert_acquisition_session(db.pool(), "sess-1", &[&f1]).await;

        let req = InventoryFrameListRequest {
            scope: InventoryFrameListScope { session_id: Some("sess-1".to_owned()), root_id: None },
            include_missing: Some(true),
        };
        let resp = list_frames(db.pool(), &req).await.unwrap();

        assert_eq!(resp.frames.len(), 1);
        assert_eq!(resp.frames[0].state, FramePresenceState::Missing);
        assert_eq!(resp.present_count, 0);
    }

    #[tokio::test]
    async fn reconcile_run_backfills_zero_size_and_reports_missing() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("present.fits"), vec![0u8; 1024]).unwrap();
        // "deleted.fits" intentionally not written — simulates an external delete.

        let db = test_db().await;
        insert_root(db.pool(), "root-1", dir.path().to_str().unwrap()).await;
        let bus = audit::bus::EventBus::with_pool(db.pool().clone());

        upsert_frame_record(db.pool(), "root-1", "present.fits", 0, "t0", "classified")
            .await
            .unwrap();
        upsert_frame_record(db.pool(), "root-1", "deleted.fits", 4096, "t0", "classified")
            .await
            .unwrap();

        let req = InventoryReconcileRunRequest {
            root_id: "root-1".to_owned(),
            reason: ReconcileReason::OnDemand,
        };
        let resp = run_reconcile(db.pool(), &bus, &req).await.unwrap();

        assert_eq!(resp.scanned, 2);
        assert_eq!(resp.present, 1);
        assert_eq!(resp.newly_missing, 1);
        assert_eq!(resp.size_backfilled, 1);

        let (size, state): (i64, String) =
            sqlx::query_as("SELECT size_bytes, state FROM file_record WHERE relative_path = ?")
                .bind("present.fits")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(size, 1024);
        assert_eq!(state, "classified");

        let (deleted_state,): (String,) =
            sqlx::query_as("SELECT state FROM file_record WHERE relative_path = ?")
                .bind("deleted.fits")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(deleted_state, "missing");
    }

    #[tokio::test]
    async fn reconcile_run_recovers_previously_missing_frame() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("back.fits"), vec![0u8; 512]).unwrap();

        let db = test_db().await;
        insert_root(db.pool(), "root-1", dir.path().to_str().unwrap()).await;
        let bus = audit::bus::EventBus::with_pool(db.pool().clone());

        upsert_frame_record(db.pool(), "root-1", "back.fits", 512, "t0", "missing").await.unwrap();

        let req = InventoryReconcileRunRequest {
            root_id: "root-1".to_owned(),
            reason: ReconcileReason::OnDemand,
        };
        let resp = run_reconcile(db.pool(), &bus, &req).await.unwrap();

        assert_eq!(resp.recovered, 1);

        let (state,): (String,) =
            sqlx::query_as("SELECT state FROM file_record WHERE relative_path = ?")
                .bind("back.fits")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(state, "classified");
    }

    #[tokio::test]
    async fn reconcile_run_unregistered_root_returns_root_unavailable() {
        let db = test_db().await;
        let bus = audit::bus::EventBus::with_pool(db.pool().clone());
        let req = InventoryReconcileRunRequest {
            root_id: "no-such-root".to_owned(),
            reason: ReconcileReason::OnDemand,
        };
        let err = run_reconcile(db.pool(), &bus, &req).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::RootUnavailable);
    }
}
