//! Inbox plan-state listener (spec 005, T030).
//!
//! Subscribes to the audit event bus and transitions `InboxItem.state` when a
//! linked plan reaches a terminal state:
//!
//! - `plan.applying.completed` with `terminal_state = "applied"` →
//!   `InboxItem.state = "resolved"` + delete `inbox_plan_links` row.
//! - `plan.applying.completed` with any other terminal
//!   (`partially_applied`, `failed`, `cancelled`) →
//!   `InboxItem.state = "classified"` + delete `inbox_plan_links` row.
//! - `plan.discarded` →
//!   `InboxItem.state = "classified"` + delete `inbox_plan_links` row.
//!
//! The listener is started once at application startup via
//! [`start_inbox_plan_listener`] which spawns a detached `tokio::task`. It is
//! NOT the only safety mechanism — [`crate::inbox::repair::run_repair`]
//! provides a periodic background sweep for items whose plan closed while the
//! listener was not running (crash, restart, missed event).
//!
//! # Event bus limitations
//!
//! The tokio broadcast channel drops lagged receivers; if the app is under
//! heavy load and a `plan.applying.completed` event is dropped, the repair
//! sweep will catch it within 5 minutes. This is documented in the spec
//! (Ref: R-PlanOpen) as the expected degraded-mode behaviour.
#![allow(clippy::doc_markdown)]

use audit::bus::EventBus;
use audit::event_bus::{
    PlanApplyingCompleted, PlanDiscarded, TOPIC_PLAN_APPLYING_COMPLETED, TOPIC_PLAN_DISCARDED,
};
use persistence_db::repositories::inbox as inbox_repo;
use sqlx::SqlitePool;
use tokio::sync::broadcast;

// ── Public entry point ────────────────────────────────────────────────────────

/// Spawn a detached background task that listens for plan terminal events and
/// updates the corresponding `InboxItem` state.
///
/// Call this once at application startup, after the `SqlitePool` is available.
///
/// The `EventBus` is cloned into the task so the spec-035 light-frame ingest
/// (`handle_plan_completed` → `ingest_light_frames`) can emit `target.resolved`
/// events for inline cache hits.
pub fn start_inbox_plan_listener(pool: SqlitePool, bus: &EventBus) {
    let mut rx = bus.subscribe();
    let bus = bus.clone();
    tokio::spawn(async move {
        run_listener_loop(pool, bus, &mut rx).await;
    });
}

// ── Listener loop ─────────────────────────────────────────────────────────────

async fn run_listener_loop(
    pool: SqlitePool,
    bus: EventBus,
    rx: &mut broadcast::Receiver<audit::event_bus::EventEnvelope<serde_json::Value>>,
) {
    loop {
        match rx.recv().await {
            Ok(envelope) => {
                if let Err(e) = handle_event(&pool, &bus, &envelope).await {
                    tracing::warn!("inbox plan_listener: error handling event: {e}");
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                // Missed n events. The repair sweep will pick up any orphaned
                // inbox items within the next 5-minute window.
                tracing::warn!(
                    "inbox plan_listener: lagged {n} events — repair sweep will reconcile"
                );
            }
            Err(broadcast::error::RecvError::Closed) => {
                // Event bus shut down — task can exit.
                tracing::info!("inbox plan_listener: event bus closed, stopping");
                break;
            }
        }
    }
}

// ── Event handler ─────────────────────────────────────────────────────────────

async fn handle_event(
    pool: &SqlitePool,
    bus: &EventBus,
    envelope: &audit::event_bus::EventEnvelope<serde_json::Value>,
) -> Result<(), String> {
    match envelope.topic.as_str() {
        TOPIC_PLAN_APPLYING_COMPLETED => {
            if let Ok(payload) =
                serde_json::from_value::<PlanApplyingCompleted>(envelope.payload.clone())
            {
                handle_plan_completed(pool, bus, &payload).await?;
            }
        }
        TOPIC_PLAN_DISCARDED => {
            if let Ok(payload) = serde_json::from_value::<PlanDiscarded>(envelope.payload.clone()) {
                handle_plan_discarded(pool, &payload.plan_id).await?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Called when a plan reaches a terminal apply state.
async fn handle_plan_completed(
    pool: &SqlitePool,
    bus: &EventBus,
    payload: &PlanApplyingCompleted,
) -> Result<(), String> {
    let new_state = if payload.terminal_state == "applied" {
        // spec 041 US4/T032: master registration is relocated here from the old
        // confirm-time fast path. When the applied plan belongs to a detected
        // calibration master inbox item, register the master now — this applies
        // whether the master was catalogued (organized source) or moved
        // (unorganized source). Registration happens before the resolved
        // transition so a failure leaves the item recoverable.
        register_master_if_applicable(pool, &payload.plan_id).await?;
        // spec 035 US4/T042: fold the plan's applied light frames into
        // acquisition sessions grouped by capture identity, linking the resolved
        // canonical target (FR-016). Calibration frames are excluded (handled by
        // the master path above). Idempotent (R12); a failure here is logged but
        // does not block the inbox item's resolved transition — the frames can be
        // re-ingested by re-applying or a future repair sweep.
        ingest_light_frames_if_applicable(pool, bus, &payload.plan_id).await;
        "resolved"
    } else {
        // partially_applied, failed, cancelled → allow re-split
        "classified"
    };

    transition_via_plan_id(pool, &payload.plan_id, new_state).await
}

/// Ingest the applied light frames of a completed plan into acquisition sessions
/// (spec 035 US4/T042). A sibling of [`register_master_if_applicable`]: it runs
/// for every applied plan, but [`app_core_targets::ingest_sessions::
/// ingest_light_frames`] processes only `move`/`catalogue` items whose FITS
/// header marks them as light frames, so non-inbox and calibration plans are
/// no-ops. Errors are logged rather than propagated so a metadata/IO problem on
/// one frame never blocks the inbox lifecycle transition.
async fn ingest_light_frames_if_applicable(pool: &SqlitePool, bus: &EventBus, plan_id: &str) {
    match app_core_targets::ingest_sessions::ingest_light_frames(pool, Some(bus), plan_id).await {
        Ok(summary) if summary.ingested > 0 || summary.skipped > 0 => {
            tracing::info!(
                plan_id,
                ingested = summary.ingested,
                skipped = summary.skipped,
                "inbox plan_listener: ingested light frames into acquisition sessions"
            );
        }
        Ok(_) => {}
        Err(e) => {
            tracing::warn!(plan_id, "inbox plan_listener: light-frame ingest failed: {e:?}");
        }
    }
}

/// Register a calibration master at plan-apply completion (spec 041 US4/T032).
///
/// Looks up the inbox item linked to `plan_id`; if it is a detected master
/// (`is_master_item != 0`), inserts the `calibration_session` +
/// `calibration_fingerprint` rows that the deleted confirm-time fast path used
/// to write (same SQL/semantics). Idempotent on the apply path because a plan
/// reaches `applied` exactly once and the link is deleted on transition.
///
/// Non-master items and plans with no linked inbox item are a no-op.
async fn register_master_if_applicable(pool: &SqlitePool, plan_id: &str) -> Result<(), String> {
    let link = inbox_repo::get_plan_link_by_plan_id(pool, plan_id)
        .await
        .map_err(|e| format!("get_plan_link_by_plan_id({plan_id}): {e}"))?;
    let Some(link) = link else {
        // No inbox item linked — non-inbox plan; nothing to register.
        return Ok(());
    };

    let item = inbox_repo::get_inbox_item(pool, &link.inbox_item_id)
        .await
        .map_err(|e| format!("get_inbox_item({}): {e}", link.inbox_item_id))?;

    if item.is_master_item == 0 {
        return Ok(());
    }

    // Idempotency guard: skip if a session already references this inbox item.
    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM calibration_session WHERE source_inbox_item_id = ? LIMIT 1")
            .bind(&item.id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("check existing calibration_session: {e}"))?;
    if existing.is_some() {
        return Ok(());
    }

    let frame_type_str = item.master_frame_type.as_deref().unwrap_or("dark");
    let cal_kind = match frame_type_str {
        "flat" => "flat",
        "bias" => "bias",
        _ => "dark",
    };

    let session_id = uuid::Uuid::new_v4().to_string();
    let session_key =
        format!("{}-{}", cal_kind, item.master_frame_type.as_deref().unwrap_or("unknown"));

    // spec 048 US1/T012: write a `file_record` for the applied master frame
    // (real on-disk size, via the shared writer) and reference it in
    // `frame_ids` instead of the historical `'[]'` placeholder. A resolution
    // failure (destination path not found / stat failure) is logged and
    // leaves `frame_ids` empty — never blocks master registration.
    let frame_id = match resolve_applied_frame_path(pool, plan_id).await {
        Ok(Some((root_id, relative_path))) => {
            match write_calibration_frame_record(pool, &root_id, &relative_path).await {
                Ok(id) => Some(id),
                Err(e) => {
                    tracing::warn!(
                        plan_id,
                        "inbox plan_listener: failed to write calibration file_record: {e}"
                    );
                    None
                }
            }
        }
        Ok(None) => {
            tracing::warn!(
                plan_id,
                "inbox plan_listener: no applied path found for master item; frame_ids empty"
            );
            None
        }
        Err(e) => {
            tracing::warn!(plan_id, "inbox plan_listener: resolve applied frame path failed: {e}");
            None
        }
    };
    let frame_ids_json = match &frame_id {
        Some(id) => serde_json::to_string(std::slice::from_ref(id))
            .map_err(|e| format!("serialize frame_ids: {e}"))?,
        None => "[]".to_owned(),
    };

    sqlx::query(
        "INSERT INTO calibration_session
            (id, session_key, frame_ids, kind, state, created_at, source_inbox_item_id)
         VALUES (?, ?, ?, ?, 'confirmed', datetime('now'), ?)",
    )
    .bind(&session_id)
    .bind(&session_key)
    .bind(&frame_ids_json)
    .bind(cal_kind)
    .bind(&item.id)
    .execute(pool)
    .await
    .map_err(|e| format!("insert calibration_session: {e}"))?;

    sqlx::query(
        "INSERT INTO calibration_fingerprint
            (id, calibration_type, exposure_s, filter_name)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&session_id)
    .bind(cal_kind)
    .bind(item.master_exposure_s)
    .bind(item.master_filter.as_deref())
    .execute(pool)
    .await
    .map_err(|e| format!("insert calibration_fingerprint: {e}"))?;

    tracing::info!(
        inbox_item_id = %item.id,
        plan_id,
        cal_kind,
        "inbox plan_listener: registered calibration master at apply completion"
    );

    Ok(())
}

/// Resolve the applied destination `(root_id, relative_path)` for a plan's
/// first successful move/catalogue item (spec 048 T012). Master items are a
/// single stacked file, so a plan applying one has exactly one such item;
/// catalogue-in-place items carry no `to_root_id`, so the source
/// (`from_root_id`/`from_relative_path`) is used, matching
/// `app_core_targets::ingest_sessions`' resolution order (T013: moved and
/// catalogued frames are recorded identically).
async fn resolve_applied_frame_path(
    pool: &SqlitePool,
    plan_id: &str,
) -> Result<Option<(String, String)>, String> {
    let row: Option<(Option<String>, String, Option<String>, String)> = sqlx::query_as(
        "SELECT to_root_id, to_relative_path, from_root_id, from_relative_path
         FROM plan_items
         WHERE plan_id = ?
           AND action IN ('move', 'catalogue')
           AND item_state = 'succeeded'
         ORDER BY item_index ASC
         LIMIT 1",
    )
    .bind(plan_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("query plan_items: {e}"))?;

    let Some((to_root_id, to_rel, from_root_id, from_rel)) = row else {
        return Ok(None);
    };
    Ok(match (to_root_id, from_root_id) {
        (Some(r), _) if !to_rel.is_empty() => Some((r, to_rel)),
        (_, Some(r)) => Some((r, from_rel)),
        _ => None,
    })
}

/// Write the calibration master's `file_record` with its real on-disk size
/// (spec 048 T012), reusing the shared writer (`crate::frame_writer` via
/// `app_core_targets`, T002). Resolves `root_id` the same way light-frame
/// ingest does (`registered_sources` mirrored into `library_root`) so the
/// `file_record.root_id` FK holds.
async fn write_calibration_frame_record(
    pool: &SqlitePool,
    root_id: &str,
    relative_path: &str,
) -> Result<String, String> {
    let root_path = app_core_targets::ingest_sessions::ensure_library_root(pool, root_id)
        .await
        .map_err(|e| format!("ensure_library_root: {e:?}"))?
        .ok_or_else(|| format!("root {root_id} not resolvable to a library_root"))?;

    let abs_path = std::path::Path::new(&root_path).join(relative_path);
    let (size_bytes, mtime) = app_core_targets::frame_writer::stat_frame(&abs_path)
        .ok_or_else(|| format!("stat failed for {}", abs_path.display()))?;

    app_core_targets::frame_writer::upsert_frame_record(
        pool,
        root_id,
        relative_path,
        size_bytes,
        &mtime,
        "classified",
    )
    .await
    .map_err(|e| format!("upsert_frame_record: {e:?}"))
}

/// Called when a plan is discarded (any state → discarded).
async fn handle_plan_discarded(pool: &SqlitePool, plan_id: &str) -> Result<(), String> {
    transition_via_plan_id(pool, plan_id, "classified").await
}

/// Find the InboxItem linked to `plan_id`, transition it to `new_state`,
/// and delete the plan link row.
async fn transition_via_plan_id(
    pool: &SqlitePool,
    plan_id: &str,
    new_state: &str,
) -> Result<(), String> {
    // Find the inbox item linked to this plan.
    let link = inbox_repo::get_plan_link_by_plan_id(pool, plan_id)
        .await
        .map_err(|e| format!("get_plan_link_by_plan_id({plan_id}): {e}"))?;

    let Some(link) = link else {
        // No inbox item is linked to this plan — normal (non-inbox plans).
        return Ok(());
    };

    // Update inbox item state.
    inbox_repo::update_inbox_item_state(pool, &link.inbox_item_id, new_state)
        .await
        .map_err(|e| format!("update_inbox_item_state({}): {e}", link.inbox_item_id))?;

    // Delete the plan link so the item can accept a new plan in the future.
    inbox_repo::delete_plan_link(pool, &link.inbox_item_id)
        .await
        .map_err(|e| format!("delete_plan_link({}): {e}", link.inbox_item_id))?;

    tracing::info!(
        inbox_item_id = %link.inbox_item_id,
        plan_id,
        new_state,
        "inbox plan_listener: inbox item transitioned"
    );

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use audit::bus::EventBus;
    use audit::event_bus::{PlanApplyingCompleted, Source};
    use persistence_db::repositories::inbox::InsertInboxItem;
    use persistence_db::repositories::plans;
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    fn make_bus(db: &Database) -> EventBus {
        EventBus::with_pool(db.pool().clone())
    }

    async fn setup_item_with_plan(db: &Database, item_id: &str, plan_id: &str) {
        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: "test",
                file_count: 1,
                content_signature: Some("sig"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        inbox_repo::upsert_classification(
            db.pool(),
            &inbox_repo::UpsertClassification {
                inbox_item_id: item_id,
                result: "single_type",
                frame_type: Some("light"),
                content_signature: "sig",
                unclassified_file_count: 0,
            },
        )
        .await
        .unwrap();

        inbox_repo::update_inbox_item_state(db.pool(), item_id, "plan_open").await.unwrap();

        let plan = plans::InsertPlan {
            id: plan_id,
            title: "Test plan",
            origin: "inbox",
            origin_path: None,
            plan_type: "split",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        };
        plans::insert_plan(db.pool(), &plan).await.unwrap();

        inbox_repo::insert_plan_link(db.pool(), item_id, plan_id).await.unwrap();
    }

    #[tokio::test]
    async fn applied_plan_transitions_to_resolved() {
        let db = test_db().await;
        let bus = make_bus(&db);
        setup_item_with_plan(&db, "item-t1", "plan-t1").await;

        start_inbox_plan_listener(db.pool().clone(), &bus);

        let payload = PlanApplyingCompleted {
            plan_id: "plan-t1".to_owned(),
            run_id: "run-1".to_owned(),
            terminal_state: "applied".to_owned(),
            items_applied: 1,
            items_failed: 0,
            items_skipped: 0,
            items_cancelled: 0,
            at: "2025-10-10T22:00:00Z".to_owned(),
        };

        bus.publish(TOPIC_PLAN_APPLYING_COMPLETED, Source::System, payload).await.unwrap();

        // Give the background task time to process.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let item = inbox_repo::get_inbox_item(db.pool(), "item-t1").await.unwrap();
        assert_eq!(item.state, "resolved");

        let link = inbox_repo::get_plan_link(db.pool(), "item-t1").await.unwrap();
        assert!(link.is_none(), "plan link should be deleted after resolution");
    }

    #[tokio::test]
    async fn failed_plan_transitions_back_to_classified() {
        let db = test_db().await;
        let bus = make_bus(&db);
        setup_item_with_plan(&db, "item-t2", "plan-t2").await;

        start_inbox_plan_listener(db.pool().clone(), &bus);

        let payload = PlanApplyingCompleted {
            plan_id: "plan-t2".to_owned(),
            run_id: "run-2".to_owned(),
            terminal_state: "failed".to_owned(),
            items_applied: 0,
            items_failed: 1,
            items_skipped: 0,
            items_cancelled: 0,
            at: "2025-10-10T22:00:00Z".to_owned(),
        };

        bus.publish(TOPIC_PLAN_APPLYING_COMPLETED, Source::System, payload).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let item = inbox_repo::get_inbox_item(db.pool(), "item-t2").await.unwrap();
        assert_eq!(item.state, "classified");
    }

    #[tokio::test]
    async fn discarded_plan_transitions_to_classified() {
        let db = test_db().await;
        let bus = make_bus(&db);
        setup_item_with_plan(&db, "item-t3", "plan-t3").await;

        start_inbox_plan_listener(db.pool().clone(), &bus);

        let payload = audit::event_bus::PlanDiscarded {
            plan_id: "plan-t3".to_owned(),
            prior_state: "ready_for_review".to_owned(),
            discarded_at: "2025-10-10T22:00:00Z".to_owned(),
        };

        bus.publish(TOPIC_PLAN_DISCARDED, Source::User, payload).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let item = inbox_repo::get_inbox_item(db.pool(), "item-t3").await.unwrap();
        assert_eq!(item.state, "classified");
    }

    // ── spec 048 US1/T012: calibration master frame_ids population ─────────────

    /// Set up a real-file, applied (`item_state='succeeded'`) master-item plan
    /// linked to `item_id`/`plan_id`, with the master file written under
    /// `tmp`/`rel` at `size` bytes. Returns `(root_id, rel)`.
    async fn setup_master_item_plan(
        db: &Database,
        tmp: &std::path::Path,
        item_id: &str,
        plan_id: &str,
        size: usize,
    ) -> (&'static str, &'static str) {
        let root_id = "cal-root";
        let rel = "master_dark.fits";
        std::fs::write(tmp.join(rel), vec![0u8; size]).unwrap();

        sqlx::query(
            "INSERT INTO registered_sources (id, kind, path, scan_depth, created_at, created_via)
             VALUES (?, 'calibration', ?, 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
        )
        .bind(root_id)
        .bind(tmp.to_str().unwrap())
        .execute(db.pool())
        .await
        .unwrap();

        inbox_repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id,
                relative_path: rel,
                file_count: 1,
                content_signature: Some("sig"),
                lane: "fits",
            },
        )
        .await
        .unwrap();
        sqlx::query(
            "UPDATE inbox_items SET is_master_item = 1, master_frame_type = 'dark' WHERE id = ?",
        )
        .bind(item_id)
        .execute(db.pool())
        .await
        .unwrap();
        inbox_repo::update_inbox_item_state(db.pool(), item_id, "plan_open").await.unwrap();

        plans::insert_plan(
            db.pool(),
            &plans::InsertPlan {
                id: plan_id,
                title: "Master apply",
                origin: "inbox",
                origin_path: None,
                plan_type: "split",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();
        plans::insert_plan_item(
            db.pool(),
            &plans::InsertPlanItem {
                id: "master-plan-1-item-0",
                plan_id,
                item_index: 0,
                name: "[DARK MASTER] master_dark.fits",
                action: "catalogue",
                from_root_id: Some(root_id),
                from_relative_path: rel,
                to_root_id: Some(root_id),
                to_relative_path: rel,
                reason: "inbox_master",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: None,
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();
        sqlx::query("UPDATE plan_items SET item_state = 'succeeded' WHERE plan_id = ?")
            .bind(plan_id)
            .execute(db.pool())
            .await
            .unwrap();

        inbox_repo::insert_plan_link(db.pool(), item_id, plan_id).await.unwrap();
        (root_id, rel)
    }

    /// A completed master-item plan must write a real-sized `file_record` for
    /// the applied master file and reference it in `calibration_session.
    /// frame_ids`, replacing the historical `'[]'` placeholder.
    #[tokio::test]
    async fn master_item_apply_writes_frame_record_and_frame_ids() {
        let db = test_db().await;
        let bus = make_bus(&db);
        let tmp = tempfile::tempdir().unwrap();
        let item_id = "master-item-1";
        let plan_id = "master-plan-1";
        let size: usize = 4096;
        let (root_id, rel) = setup_master_item_plan(&db, tmp.path(), item_id, plan_id, size).await;

        start_inbox_plan_listener(db.pool().clone(), &bus);

        let payload = PlanApplyingCompleted {
            plan_id: plan_id.to_owned(),
            run_id: "run-master-1".to_owned(),
            terminal_state: "applied".to_owned(),
            items_applied: 1,
            items_failed: 0,
            items_skipped: 0,
            items_cancelled: 0,
            at: "2026-07-04T00:00:00Z".to_owned(),
        };
        bus.publish(TOPIC_PLAN_APPLYING_COMPLETED, Source::System, payload).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let (frame_ids_json,): (String,) = sqlx::query_as(
            "SELECT frame_ids FROM calibration_session WHERE source_inbox_item_id = ?",
        )
        .bind(item_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        let frame_ids: Vec<String> = serde_json::from_str(&frame_ids_json).unwrap();
        assert_eq!(frame_ids.len(), 1, "frame_ids must reference the applied master file_record");

        let (size_bytes, stored_root, stored_rel): (i64, String, String) = sqlx::query_as(
            "SELECT size_bytes, root_id, relative_path FROM file_record WHERE id = ?",
        )
        .bind(&frame_ids[0])
        .fetch_one(db.pool())
        .await
        .unwrap();
        let expected_size = i64::try_from(size).unwrap();
        assert_eq!(size_bytes, expected_size, "real on-disk size, never 0");
        assert_eq!(stored_root, root_id);
        assert_eq!(stored_rel, rel);
    }
}
