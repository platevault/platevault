use super::*;
use audit::EventBus;
use persistence_db::repositories::audit::{
    count_audit_entries, list_audit_entries, AuditLogFilter,
};
use persistence_db::repositories::plans as repo;
use persistence_db::Database;
use uuid::Uuid;

async fn setup() -> (Database, EventBus) {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    let bus = EventBus::with_pool(db.pool().clone());
    (db, bus)
}

async fn insert_approved_plan_with_items(db: &Database, plan_id: &str, item_count: usize) {
    repo::insert_plan(
        db.pool(),
        &repo::InsertPlan {
            id: plan_id,
            title: "Test",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .unwrap();

    for i in 0..item_count {
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: &format!("{plan_id}-item-{i}"),
                plan_id,
                item_index: i64::try_from(i + 1).unwrap(),
                name: "file.fits",
                action: "move",
                from_root_id: None,
                // Plan-scoped paths: tests share the process-global
                // ACTIVE_RUNS registry and run in parallel, so identical
                // relative paths across tests would trip the FR-017
                // overlap guard non-deterministically.
                from_relative_path: &format!("{plan_id}/raw/file-{i}.fits"),
                to_root_id: None,
                to_relative_path: &format!("{plan_id}/archive/file-{i}.fits"),
                reason: "test",
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
    }

    repo::update_plan_state(db.pool(), plan_id, "ready_for_review").await.unwrap();
    repo::set_approved(db.pool(), plan_id, "2026-06-01T00:00:00Z", "test-token").await.unwrap();
}

/// Regression (FIX review, priority-check #2): `resolve_root_path`'s
/// `registered_sources` read-through must never resurface a
/// pre-remap path after `apply_root_remap` commits the new one.
#[tokio::test]
async fn resolve_root_path_reflects_remap_not_stale_cache() {
    use contracts_core::first_run::{
        OrganizationState, RegisterSourceRequest, ScanDepth, SourceKind,
    };

    // Needs two real, existing directories; "/tmp" and "/var/tmp" are Unix-only.
    if !cfg!(unix) {
        return;
    }

    let (db, bus) = setup().await;

    let reg = crate::first_run::register_source(
        db.pool(),
        &bus,
        &RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/tmp".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    // Populate the cache via the same registered_sources fallback branch
    // apply_plan's root_map build resolves through.
    let resolved = resolve_root_path(db.pool(), &reg.source_id).await;
    assert_eq!(resolved.as_deref(), Some("/tmp"), "must resolve the registered path");

    // Remap must invalidate the cache entry after its DB write commits.
    crate::first_run::apply_root_remap(db.pool(), &bus, &reg.source_id, "/var/tmp", true)
        .await
        .unwrap();

    let after_remap = resolve_root_path(db.pool(), &reg.source_id).await;
    assert_eq!(
        after_remap.as_deref(),
        Some("/var/tmp"),
        "resolve_root_path must return the remapped path, not a stale cached one"
    );
}

#[tokio::test]
async fn apply_plan_rejects_wrong_state() {
    let (db, bus) = setup().await;
    repo::insert_plan(
        db.pool(),
        &repo::InsertPlan {
            id: "p-draft",
            title: "Test",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .unwrap();

    let err = apply_plan(db.pool(), &bus, "p-draft", "tok", None).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::PlanInvalidState);
}

#[tokio::test]
async fn apply_plan_rejects_wrong_token() {
    let (db, bus) = setup().await;
    insert_approved_plan_with_items(&db, "p1", 1).await;

    let err = apply_plan(db.pool(), &bus, "p1", "wrong-token", None).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::PlanApprovalStale);
}

#[tokio::test]
async fn apply_plan_starts_successfully() {
    let (db, bus) = setup().await;
    insert_approved_plan_with_items(&db, "p1", 1).await;

    let resp = apply_plan(db.pool(), &bus, "p1", "test-token", None).await.unwrap();
    assert_eq!(resp.plan_id, "p1");
    assert_eq!(resp.new_state, "applying");
    assert!(!resp.run_id.is_empty());

    // The background executor is spawned via `tokio::spawn`, and the
    // `#[tokio::test]` current-thread runtime only gives it a chance to
    // run at the next `.await` yield point — which is the `get_plan`
    // call right below. On a fast/loaded runner the executor can win that
    // race and finish (this test's item has no real file on disk, so it
    // resolves to a terminal `failed` state) before this read, which is
    // not a bug in `apply_plan` (the CAS to "applying" already succeeded,
    // per `resp.new_state` above) — it's a timing artifact of reading
    // back a state the caller does not otherwise synchronize on. Accept
    // either the transient "applying" state or a terminal state the
    // now-raced-ahead executor already reached.
    let plan = repo::get_plan(db.pool(), "p1", false).await.unwrap();
    assert!(
        matches!(plan.state.as_str(), "applying" | "completed" | "failed"),
        "unexpected plan state after apply_plan: {}",
        plan.state
    );

    // Wait briefly for the background task to complete.
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
}

/// T240 (spec 042 US16): a subscribed sink receives the long-op lifecycle —
/// a `Started` (ItemStarted carrying the running handle), per-item events,
/// then a terminal `Completed`/`Failed` carrying a terminal handle, with a
/// strictly increasing `sequence`. The durable audit rows are still written
/// (asserted separately) — the sink is an additive live projection (§II).
#[tokio::test]
async fn apply_plan_streams_operation_events() {
    use std::sync::Mutex;

    let (db, bus) = setup().await;
    insert_approved_plan_with_items(&db, "p-evt", 1).await;

    let captured: Arc<Mutex<Vec<OperationEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_store = captured.clone();
    let sink: OperationEventSink = Arc::new(move |event: OperationEvent| {
        sink_store.lock().unwrap().push(event);
    });

    let resp = apply_plan(db.pool(), &bus, "p-evt", "test-token", Some(sink)).await.unwrap();

    // Let the background executor run to completion.
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let events = captured.lock().unwrap().clone();
    assert!(!events.is_empty(), "sink must receive long-op events");

    // First event is the Started projection carrying a Running handle.
    let first = &events[0];
    assert_eq!(first.event_type, OperationEventType::ItemStarted);
    assert_eq!(first.operation_id, OperationId(resp.run_id.clone()));
    assert_eq!(first.sequence, 0);

    // Sequence is strictly increasing across the run.
    for window in events.windows(2) {
        assert!(window[1].sequence > window[0].sequence, "sequence must be monotonic");
    }

    // The run terminates with a Completed (or Failed) event carrying a
    // terminal handle.
    let last = events.last().unwrap();
    assert!(
        matches!(last.event_type, OperationEventType::Completed | OperationEventType::Failed),
        "last event must be a terminal Completed/Failed, got {:?}",
        last.event_type
    );

    // Durable audit trail is retained: the DB still holds run events.
    let plan = repo::get_plan(db.pool(), "p-evt", false).await.unwrap();
    assert_ne!(plan.state, "approved", "plan must have progressed past approved in the DB");
}

// ── Spec 017 C5: archive lifecycle closure ──────────────────────────────

/// The finalize helper drives a completed project into `archived` and records
/// the owning plan id — the legitimate closure of the requires-plan gate.
#[tokio::test]
async fn finalize_archive_lifecycle_archives_completed_project() {
    use persistence_db::repositories::projects as projects_repo;

    let (db, bus) = setup().await;
    let project_id = Uuid::new_v4().to_string();
    projects_repo::insert_project(
        db.pool(),
        &projects_repo::InsertProject {
            id: &project_id,
            name: "M31 LRGB",
            tool: "PixInsight",
            lifecycle: "completed",
            path: "projects/M31_LRGB",
            notes: None,
            canonical_target_id: None,
            is_mosaic: false,
        },
    )
    .await
    .unwrap();

    finalize_archive_lifecycle(db.pool(), &bus, "plan-arch-1", &project_id).await;

    let project = projects_repo::get_project(db.pool(), &project_id).await.unwrap();
    assert_eq!(project.lifecycle, "archived", "project must be driven to archived");

    // The link is recorded so archive-management commands act O(1).
    let archived = projects_repo::list_archived_projects(db.pool()).await.unwrap();
    assert_eq!(archived.len(), 1);
    assert_eq!(archived[0].archived_via_plan_id.as_deref(), Some("plan-arch-1"));
}

/// #665: a fully-applied `project_create` plan must fire the `Created`
/// manifest trigger — previously there was no emitter at all for it.
#[tokio::test]
async fn finalize_project_create_manifest_writes_created_manifest() {
    use persistence_db::repositories::manifests::list_manifests_for_project;
    use persistence_db::repositories::projects as projects_repo;

    let (db, bus) = setup().await;
    let dir = tempfile::tempdir().unwrap();
    let project_id = Uuid::new_v4().to_string();
    projects_repo::insert_project(
        db.pool(),
        &projects_repo::InsertProject {
            id: &project_id,
            name: "M31 LRGB",
            tool: "PixInsight",
            lifecycle: "setup_incomplete",
            path: dir.path().to_str().unwrap(),
            notes: None,
            canonical_target_id: None,
            is_mosaic: false,
        },
    )
    .await
    .unwrap();

    finalize_project_create_manifest(db.pool(), &bus, dir.path().to_str().unwrap()).await;

    let (rows, _) = list_manifests_for_project(db.pool(), &project_id, None, 10).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].reason, "created");
    let manifest =
        app_core_projects::project_manifests::get(db.pool(), &rows[0].id).await.unwrap();
    assert_eq!(manifest.manifest.body.lifecycle_state, "setup_incomplete");
}

/// An already-archived project is idempotent: the closure only (re)records
/// the plan link and never errors.
#[tokio::test]
async fn finalize_archive_lifecycle_is_idempotent_for_archived_project() {
    use persistence_db::repositories::projects as projects_repo;

    let (db, bus) = setup().await;
    let project_id = Uuid::new_v4().to_string();
    projects_repo::insert_project(
        db.pool(),
        &projects_repo::InsertProject {
            id: &project_id,
            name: "M31",
            tool: "PixInsight",
            lifecycle: "archived",
            path: "projects/M31",
            notes: None,
            canonical_target_id: None,
            is_mosaic: false,
        },
    )
    .await
    .unwrap();

    finalize_archive_lifecycle(db.pool(), &bus, "plan-arch-2", &project_id).await;

    let project = projects_repo::get_project(db.pool(), &project_id).await.unwrap();
    assert_eq!(project.lifecycle, "archived");
    let archived = projects_repo::list_archived_projects(db.pool()).await.unwrap();
    assert_eq!(archived[0].archived_via_plan_id.as_deref(), Some("plan-arch-2"));
}

/// A non-UUID project id must not panic (best-effort logging only).
#[tokio::test]
async fn finalize_archive_lifecycle_non_uuid_is_noop() {
    let (db, bus) = setup().await;
    finalize_archive_lifecycle(db.pool(), &bus, "plan-x", "not-a-uuid").await;
    // No panic, no rows.
    let archived = persistence_db::repositories::projects::list_archived_projects(db.pool())
        .await
        .unwrap();
    assert!(archived.is_empty());
}

/// Edge-legality guard (Constitution §II): if an archive plan somehow targets
/// a project that is NOT in a legal `* → archived` source state
/// (`completed`/`blocked`), the closure must refuse — leaving the lifecycle
/// unchanged and recording no archive link — rather than CAS an illegal edge
/// into `archived`.
#[tokio::test]
async fn finalize_archive_lifecycle_refuses_illegal_source_state() {
    use persistence_db::repositories::projects as projects_repo;

    let (db, bus) = setup().await;
    let project_id = Uuid::new_v4().to_string();
    projects_repo::insert_project(
        db.pool(),
        &projects_repo::InsertProject {
            id: &project_id,
            name: "M31 Ready",
            tool: "PixInsight",
            lifecycle: "ready",
            path: "projects/M31_Ready",
            notes: None,
            canonical_target_id: None,
            is_mosaic: false,
        },
    )
    .await
    .unwrap();

    finalize_archive_lifecycle(db.pool(), &bus, "plan-arch-bad", &project_id).await;

    // Lifecycle untouched — no illegal edge recorded.
    let project = projects_repo::get_project(db.pool(), &project_id).await.unwrap();
    assert_eq!(
        project.lifecycle, "ready",
        "illegal archive source must leave lifecycle unchanged"
    );
    // No archive link recorded.
    let archived = projects_repo::list_archived_projects(db.pool()).await.unwrap();
    assert!(archived.is_empty(), "no archive link may be recorded for a refused closure");
}

// ── #885: restore lifecycle closure ──────────────────────────────────────

/// Happy path: an archived project's finalize_restore_lifecycle drives it
/// back to `ready` and clears `archived_via_plan_id` (also exercises
/// `clear_archived_via_plan_id`, persistence_db repositories/projects.rs).
#[tokio::test]
async fn finalize_restore_lifecycle_restores_archived_project() {
    use persistence_db::repositories::projects as projects_repo;

    let (db, bus) = setup().await;
    let project_id = Uuid::new_v4().to_string();
    projects_repo::insert_project(
        db.pool(),
        &projects_repo::InsertProject {
            id: &project_id,
            name: "M31 LRGB",
            tool: "PixInsight",
            lifecycle: "archived",
            path: "projects/M31_LRGB",
            notes: None,
            canonical_target_id: None,
            is_mosaic: false,
        },
    )
    .await
    .unwrap();
    projects_repo::set_archived_via_plan_id(db.pool(), &project_id, "plan-arch-1")
        .await
        .unwrap();

    finalize_restore_lifecycle(db.pool(), &bus, &project_id).await;

    let project = projects_repo::get_project(db.pool(), &project_id).await.unwrap();
    assert_eq!(project.lifecycle, "ready", "project must be driven to ready (R-Unarchive)");

    let link: Option<String> =
        sqlx::query_scalar("SELECT archived_via_plan_id FROM projects WHERE id = ?")
            .bind(&project_id)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(link, None, "archived_via_plan_id must be cleared on restore");
}

/// Edge-legality guard: the only legal source for R-Unarchive is `archived`
/// itself — a project in any other state must be left unchanged.
#[tokio::test]
async fn finalize_restore_lifecycle_refuses_non_archived_source_state() {
    use persistence_db::repositories::projects as projects_repo;

    let (db, bus) = setup().await;
    let project_id = Uuid::new_v4().to_string();
    projects_repo::insert_project(
        db.pool(),
        &projects_repo::InsertProject {
            id: &project_id,
            name: "M31 Completed",
            tool: "PixInsight",
            lifecycle: "completed",
            path: "projects/M31_Completed",
            notes: None,
            canonical_target_id: None,
            is_mosaic: false,
        },
    )
    .await
    .unwrap();

    finalize_restore_lifecycle(db.pool(), &bus, &project_id).await;

    let project = projects_repo::get_project(db.pool(), &project_id).await.unwrap();
    assert_eq!(
        project.lifecycle, "completed",
        "illegal restore source must leave lifecycle unchanged"
    );
}

/// A non-UUID project id must not panic (best-effort logging only).
#[tokio::test]
async fn finalize_restore_lifecycle_non_uuid_is_noop() {
    let (db, bus) = setup().await;
    // No panic; nothing to assert beyond "returns".
    finalize_restore_lifecycle(db.pool(), &bus, "not-a-uuid").await;
}

// ── #886: calibration master archive lifecycle closure ──────────────────

async fn seed_calibration_master(db: &Database, id: &str) {
    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, created_at) \
         VALUES (?, 'k', 'dark', '2026-06-01T00:00:00Z')",
    )
    .bind(id)
    .execute(db.pool())
    .await
    .unwrap();
}

#[tokio::test]
async fn finalize_calibration_master_archive_records_flag_and_plan_link() {
    use persistence_db::repositories::q_calibration;

    let (db, _bus) = setup().await;
    seed_calibration_master(&db, "m-arch-1").await;

    finalize_calibration_master_archive(db.pool(), "plan-m-arch-1", "m-arch-1").await;

    let row =
        q_calibration::get_calibration_master(db.pool(), "m-arch-1").await.unwrap().unwrap();
    assert!(row.archived_at.is_some());
    assert_eq!(row.archived_via_plan_id.as_deref(), Some("plan-m-arch-1"));
}

#[tokio::test]
async fn finalize_calibration_master_restore_clears_flag() {
    use persistence_db::repositories::q_calibration;

    let (db, _bus) = setup().await;
    seed_calibration_master(&db, "m-rest-1").await;
    finalize_calibration_master_archive(db.pool(), "plan-m-rest-1", "m-rest-1").await;

    finalize_calibration_master_restore(db.pool(), "m-rest-1").await;

    let row =
        q_calibration::get_calibration_master(db.pool(), "m-rest-1").await.unwrap().unwrap();
    assert_eq!(row.archived_at, None);
    assert_eq!(row.archived_via_plan_id, None);
}

/// Regression: `calibration.masters.list` reads through
/// `app_core_calibration`'s process-global no-TTL snapshot cache
/// (`crates/app/cache/src/lib.rs` F0 contract — callers MUST invalidate
/// at write sites). The two tests above assert the DB write via
/// `q_calibration` directly, which bypasses the cache entirely and would
/// pass even if the finalize closures never invalidated it. This test
/// goes through the actual cache-backed read path
/// (`crate::calibration::masters_list`) both before and after
/// each closure, so a missing `invalidate_calibration_masters()` call
/// fails it (an archived master would incorrectly stay visible; a
/// restored one would incorrectly stay hidden).
#[tokio::test]
async fn finalize_calibration_master_archive_and_restore_invalidate_the_masters_cache() {
    let (db, _bus) = setup().await;
    seed_calibration_master(&db, "m-cache-1").await;

    // Defensive: this test is the only app_core (as opposed to
    // app_core_calibration) test touching the process-global cache
    // static today, but start from a known-clean slate regardless.
    crate::calibration::caches::invalidate_calibration_masters();

    // Prime the cache with the pre-archive snapshot (master visible).
    let before = crate::calibration::masters_list(db.pool()).await.unwrap();
    assert!(before.iter().any(|m| m.id == "m-cache-1"));

    finalize_calibration_master_archive(db.pool(), "plan-m-cache-1", "m-cache-1").await;

    let after_archive = crate::calibration::masters_list(db.pool()).await.unwrap();
    assert!(
        !after_archive.iter().any(|m| m.id == "m-cache-1"),
        "archived master must disappear from the CACHED masters.list read, not just the \
         direct q_calibration read — missing invalidate_calibration_masters() call"
    );

    finalize_calibration_master_restore(db.pool(), "m-cache-1").await;

    let after_restore = crate::calibration::masters_list(db.pool()).await.unwrap();
    assert!(
        after_restore.iter().any(|m| m.id == "m-cache-1"),
        "restored master must reappear in the CACHED masters.list read"
    );
}

#[tokio::test]
async fn cancel_plan_rejects_non_applying() {
    let (db, _bus) = setup().await;
    repo::insert_plan(
        db.pool(),
        &repo::InsertPlan {
            id: "p2",
            title: "Test",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .unwrap();

    let err = cancel_plan(db.pool(), "p2").await.unwrap_err();
    assert_eq!(err.code, ErrorCode::PlanNotInApply);
}

#[tokio::test]
async fn skip_item_rejects_when_not_applying() {
    let (db, _bus) = setup().await;
    insert_approved_plan_with_items(&db, "p3", 1).await;

    let err = skip_plan_item(db.pool(), "p3", "p3-item-0").await.unwrap_err();
    assert_eq!(err.code, ErrorCode::PlanNotInApply);
}

/// Register a minimal `ActiveRun` directly in the process-global
/// registry, bypassing `apply_plan`/`resume_plan`'s executor spawn.
/// `retry_plan_item` requires a live entry before it will mutate any DB
/// state (review fix — see its doc comment); tests that exercise the
/// success path without driving a real executor need one of these.
/// Callers own removing it (or rely on process exit — the registry is a
/// `static`, so a leaked test entry cannot affect other plan ids).
fn register_fake_active_run(plan_id: &str) {
    active_runs().insert(
        plan_id.to_owned(),
        ActiveRun {
            cancel_token: CancellationToken::new(),
            skip_set: SkipSet::new(),
            retry_queue: RetryQueue::new(),
            run_id: "fake-run".to_owned(),
            path_set: crate::path_set::PlanPathSet::new(),
        },
    );
}

/// T038 gap-fill: `retry_plan_item`'s success path had zero coverage at
/// any level prior to this test (only the not-applying rejection was
/// tested). Drives the item failed -> applying transition directly
/// (bypassing the real executor, but with a fake `ActiveRun` registered
/// so the review-fix "run must be active" gate passes) and asserts both
/// the response and the persisted item state.
#[tokio::test]
async fn retry_plan_item_transitions_failed_item_to_applying() {
    let (db, _bus) = setup().await;
    insert_approved_plan_with_items(&db, "p-retry", 1).await;
    plans_repo::update_plan_state(db.pool(), "p-retry", "applying").await.unwrap();
    apply_repo::item_failed(db.pool(), "p-retry-item-0", "p-retry", "permission.denied")
        .await
        .unwrap();
    register_fake_active_run("p-retry");

    let resp = retry_plan_item(db.pool(), "p-retry", "p-retry-item-0").await.unwrap();
    assert_eq!(resp.item_id, "p-retry-item-0");
    assert_eq!(resp.new_state, "applying");

    let items = plans_repo::list_plan_items(db.pool(), "p-retry").await.unwrap();
    let item = items.iter().find(|i| i.id == "p-retry-item-0").unwrap();
    assert_eq!(item.item_state, "applying", "retried item must move failed -> applying in DB");
}

/// Review fix: a retry attempted after the run has already finished
/// (no `ActiveRun` registered) must be rejected outright, not silently
/// flip the item to `applying` with nothing left to ever resolve it.
#[tokio::test]
async fn retry_plan_item_rejects_when_no_active_run() {
    let (db, _bus) = setup().await;
    insert_approved_plan_with_items(&db, "p-retry-no-run", 1).await;
    plans_repo::update_plan_state(db.pool(), "p-retry-no-run", "applying").await.unwrap();
    apply_repo::item_failed(
        db.pool(),
        "p-retry-no-run-item-0",
        "p-retry-no-run",
        "permission.denied",
    )
    .await
    .unwrap();
    // Deliberately NOT registering an ActiveRun.

    let err = retry_plan_item(db.pool(), "p-retry-no-run", "p-retry-no-run-item-0")
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::RunNotFound);

    // The DB write must never have happened — item stays failed, not
    // stuck applying with nothing to resolve it.
    let items = plans_repo::list_plan_items(db.pool(), "p-retry-no-run").await.unwrap();
    let item = items.iter().find(|i| i.id == "p-retry-no-run-item-0").unwrap();
    assert_eq!(item.item_state, "failed", "rejected retry must not mutate item state");
}

#[tokio::test]
async fn retry_plan_item_rejects_non_failed_item() {
    let (db, _bus) = setup().await;
    insert_approved_plan_with_items(&db, "p-retry2", 1).await;
    plans_repo::update_plan_state(db.pool(), "p-retry2", "applying").await.unwrap();

    // Item is still `pending` (never failed) — retry must reject it
    // before reaching the active-run check (which runs after).
    let err = retry_plan_item(db.pool(), "p-retry2", "p-retry2-item-0").await.unwrap_err();
    assert_eq!(err.code, ErrorCode::ItemNotFailed);
}

#[tokio::test]
async fn confirm_plan_destructive_items_rejects_unknown_plan() {
    let (db, _bus) = setup().await;
    let err = confirm_plan_destructive_items(db.pool(), "missing-plan").await.unwrap_err();
    assert_eq!(err.code, ErrorCode::PlanNotFound);
}

#[tokio::test]
async fn confirm_plan_destructive_items_persists_flag() {
    let (db, _bus) = setup().await;
    repo::insert_plan(
        db.pool(),
        &repo::InsertPlan {
            id: "p-del",
            title: "Test",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "trash",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .unwrap();
    repo::insert_plan_item(
        db.pool(),
        &repo::InsertPlanItem {
            id: "p-del-item-0",
            plan_id: "p-del",
            item_index: 1,
            name: "junk.fits",
            action: "delete",
            from_root_id: None,
            from_relative_path: "p-del/raw/junk.fits",
            to_root_id: None,
            to_relative_path: "",
            reason: "test",
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

    let before = repo::list_plan_items(db.pool(), "p-del").await.unwrap();
    assert_eq!(before[0].destructive_confirmed, 0);

    let confirmed = confirm_plan_destructive_items(db.pool(), "p-del").await.unwrap();
    assert_eq!(confirmed, 1);

    let after = repo::list_plan_items(db.pool(), "p-del").await.unwrap();
    assert_eq!(after[0].destructive_confirmed, 1);

    // Idempotent second call.
    let confirmed_again = confirm_plan_destructive_items(db.pool(), "p-del").await.unwrap();
    assert_eq!(confirmed_again, 0);
}

/// End-to-end regression for issue #741: before this fix, a delete item
/// was refused *permanently* at apply time (`destructive_confirmed` had
/// no writer anywhere). Confirming via the new write path must let a
/// subsequent apply actually delete the file on disk.
#[tokio::test]
async fn confirm_then_apply_executes_previously_refused_delete_item() {
    let dir = tempfile::tempdir().unwrap();
    let file_path = dir.path().join("junk.fits");
    std::fs::write(&file_path, b"data").unwrap();
    let abs = file_path.to_str().unwrap();

    let (db, bus) = setup().await;
    repo::insert_plan(
        db.pool(),
        &repo::InsertPlan {
            id: "p-e2e",
            title: "Test",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "trash",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .unwrap();
    repo::insert_plan_item(
        db.pool(),
        &repo::InsertPlanItem {
            id: "p-e2e-item-0",
            plan_id: "p-e2e",
            item_index: 1,
            name: "junk.fits",
            action: "delete",
            // No from_root_id: item_row_to_executor_item leaves
            // library_root None, so `from_relative_path` is used as-is —
            // an absolute temp-file path works (mirrors the executor
            // crate's own "legacy" no-root test items).
            from_root_id: None,
            from_relative_path: abs,
            to_root_id: None,
            to_relative_path: "",
            reason: "test",
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

    confirm_plan_destructive_items(db.pool(), "p-e2e").await.unwrap();

    repo::update_plan_state(db.pool(), "p-e2e", "ready_for_review").await.unwrap();
    repo::set_approved(db.pool(), "p-e2e", "2026-06-01T00:00:00Z", "test-token").await.unwrap();

    apply_plan(db.pool(), &bus, "p-e2e", "test-token", None).await.unwrap();
    tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

    assert!(!file_path.exists(), "confirmed delete item must actually execute");
    let plan = repo::get_plan(db.pool(), "p-e2e", false).await.unwrap();
    assert_eq!(plan.state, "applied");

    // #766: a real, successful plan apply must write a durable
    // audit_log_entry row per succeeded plan_item — not just the
    // separate plan-apply run-events table.
    let audit_count = count_audit_entries(db.pool(), &AuditLogFilter::default()).await.unwrap();
    assert!(audit_count > 0, "apply_plan must write at least one durable audit_log_entry row");
}

/// Removes `ALM_E2E_OS_TRASH_FAKE` on drop (including panic unwind) so a
/// failed assertion in the test body can never leak the var into other
/// tests in this binary (this crate has no other test that exercises the
/// `Trash` executor action, so the var is otherwise untouched here).
struct EnvVarGuard(&'static str);
impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        std::env::remove_var(self.0);
    }
}

/// Regression for the "trash destination is dead code" finding: both
/// `cleanup_generator` and `archive_generator` always store
/// `action = "archive"` for a destructive-but-reversible item; the
/// user's plan-level "System trash" choice (`plans.destructive_destination`)
/// was never consulted at apply time, so it silently archived into
/// `.astro-plan-archive` regardless of what the user picked in review.
/// `ALM_E2E_OS_TRASH_FAKE` (headless-safe OS-trash double, added for the
/// e2e harness) makes the OS-trash outcome deterministic here too.
#[tokio::test]
async fn archive_action_item_with_trash_destination_really_trashes() {
    std::env::set_var("ALM_E2E_OS_TRASH_FAKE", "1");
    let _env_guard = EnvVarGuard("ALM_E2E_OS_TRASH_FAKE");

    let dir = tempfile::tempdir().unwrap();
    let file_path = dir.path().join("intermediate.fits");
    std::fs::write(&file_path, b"data").unwrap();
    let abs = file_path.to_str().unwrap();

    let (db, bus) = setup().await;
    repo::insert_plan(
        db.pool(),
        &repo::InsertPlan {
            id: "p-trash-e2e",
            title: "Test",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "trash",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .unwrap();
    repo::insert_plan_item(
        db.pool(),
        &repo::InsertPlanItem {
            id: "p-trash-e2e-item-0",
            plan_id: "p-trash-e2e",
            item_index: 1,
            name: "intermediate.fits",
            action: "archive",
            from_root_id: None,
            from_relative_path: abs,
            to_root_id: None,
            to_relative_path: "",
            reason: "test",
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

    repo::update_plan_state(db.pool(), "p-trash-e2e", "ready_for_review").await.unwrap();
    repo::set_approved(db.pool(), "p-trash-e2e", "2026-06-01T00:00:00Z", "test-token")
        .await
        .unwrap();

    apply_plan(db.pool(), &bus, "p-trash-e2e", "test-token", None).await.unwrap();
    tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

    assert!(
        !file_path.exists(),
        "an archive-action item under a trash-destination plan must actually be removed via trash"
    );
    assert!(
        !dir.path().join(".astro-plan-archive").exists(),
        "a trash-destination item must not fall through to the app archive folder"
    );
    let plan = repo::get_plan(db.pool(), "p-trash-e2e", false).await.unwrap();
    assert_eq!(plan.state, "applied");
    let items = repo::list_plan_items(db.pool(), "p-trash-e2e").await.unwrap();
    assert_eq!(items[0].item_state, "succeeded");
}

/// Sibling of the trash-routing regression above, guarding the inverse:
/// a plan whose `destructive_destination` stays `"archive"` must still
/// route its `action = "archive"` item through `ExecutorItemAction::Archive`
/// (file lands under the archive path, never removed). Without this, a
/// guard bug matching plain `"archive"` (routing every archive item to
/// Trash regardless of `destructive_destination`) would pass the trash
/// test above undetected — no existing `item_row_to_executor_item` test
/// asserts on `item.action`.
#[tokio::test]
async fn archive_action_item_with_archive_destination_stays_archived() {
    let dir = tempfile::tempdir().unwrap();
    let file_path = dir.path().join("intermediate.fits");
    std::fs::write(&file_path, b"data").unwrap();
    let abs = file_path.to_str().unwrap();
    let archive_dest_path = dir.path().join(".astro-plan-archive/p-archive-e2e-item-0.fits");
    let archive_dest = archive_dest_path.to_str().unwrap();

    let (db, bus) = setup().await;
    repo::insert_plan(
        db.pool(),
        &repo::InsertPlan {
            id: "p-archive-e2e",
            title: "Test",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .unwrap();
    repo::insert_plan_item(
        db.pool(),
        &repo::InsertPlanItem {
            id: "p-archive-e2e-item-0",
            plan_id: "p-archive-e2e",
            item_index: 1,
            name: "intermediate.fits",
            action: "archive",
            from_root_id: None,
            from_relative_path: abs,
            to_root_id: None,
            to_relative_path: "",
            reason: "test",
            protection: "normal",
            linked_entity: None,
            provenance_json: None,
            archive_path: Some(archive_dest),
            source_id: None,
            category: None,
        },
    )
    .await
    .unwrap();

    repo::update_plan_state(db.pool(), "p-archive-e2e", "ready_for_review").await.unwrap();
    repo::set_approved(db.pool(), "p-archive-e2e", "2026-06-01T00:00:00Z", "test-token")
        .await
        .unwrap();

    apply_plan(db.pool(), &bus, "p-archive-e2e", "test-token", None).await.unwrap();
    tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

    assert!(!file_path.exists(), "source must be gone after a successful archive move");
    assert!(
        archive_dest_path.exists(),
        "an archive-destination plan's archive-action item must land at the archive path, not be trashed/deleted"
    );
    let plan = repo::get_plan(db.pool(), "p-archive-e2e", false).await.unwrap();
    assert_eq!(plan.state, "applied");
    let items = repo::list_plan_items(db.pool(), "p-archive-e2e").await.unwrap();
    assert_eq!(items[0].item_state, "succeeded");
}

/// #766: one durable `audit_log_entry` row per succeeded plan_item
/// (query DB, not the live EventBus) — the exact SUCCESS criterion from
/// the issue repro.
#[tokio::test]
async fn n766_apply_writes_one_durable_audit_row_per_succeeded_item() {
    let (db, bus) = setup().await;
    insert_approved_plan_with_items(&db, "p-audit", 2).await;

    apply_plan(db.pool(), &bus, "p-audit", "test-token", None).await.unwrap();
    tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

    let plan = repo::get_plan(db.pool(), "p-audit", false).await.unwrap();
    // Items have no real file on disk (from_root_id: None, relative path
    // used as-is) so they resolve to a terminal `failed` state — still a
    // real "attempted action and outcome" that must be audited (§II).
    assert_eq!(plan.items_total, 2);

    let audit_count = count_audit_entries(db.pool(), &AuditLogFilter::default()).await.unwrap();
    assert!(
        i64::from(audit_count) >= plan.items_total,
        "expected at least one audit_log_entry row per plan item ({} items), got {audit_count}",
        plan.items_total
    );

    let entries = list_audit_entries(
        db.pool(),
        &AuditLogFilter {
            entity_type: Some("filesystem_plan".to_owned()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(
        entries.iter().any(|e| e.trigger.starts_with("plan_item.")),
        "expected a plan_item.* durable audit trigger"
    );
}

/// #750: `audit_item_cancelled` (the per-item write both bulk-cancel
/// paths — happy-path pending list and orphaned-`applying` sweep — funnel
/// through) must write a durable `audit_log_entry` row, not just a
/// run-events row, for each cancelled item.
#[tokio::test]
async fn n750_audit_item_cancelled_writes_durable_audit_row() {
    let (db, bus) = setup().await;
    insert_approved_plan_with_items(&db, "p-cancel", 1).await;
    repo::update_plan_state(db.pool(), "p-cancel", "applying").await.unwrap();

    audit_item_cancelled(
        db.pool(),
        &bus,
        "run-cancel",
        "p-cancel",
        "p-cancel-item-0",
        "pending",
        "2026-06-01T00:00:00Z",
    )
    .await;

    let audit_count = count_audit_entries(db.pool(), &AuditLogFilter::default()).await.unwrap();
    assert_eq!(audit_count, 1, "one durable audit_log_entry row per cancelled item");

    let entries = list_audit_entries(db.pool(), &AuditLogFilter::default()).await.unwrap();
    assert_eq!(entries[0].trigger, "plan_item.cancelled");
    assert_eq!(entries[0].outcome, "refused");
    assert_eq!(entries[0].to_state.as_deref(), Some("cancelled"));
}

#[tokio::test]
async fn get_apply_status_returns_plan_state() {
    let (db, _bus) = setup().await;
    insert_approved_plan_with_items(&db, "p4", 2).await;

    let status = get_apply_status(db.pool(), "p4").await.unwrap();
    assert_eq!(status.plan_id, "p4");
    assert_eq!(status.plan_state, "approved");
    assert_eq!(status.items_total, 2);
    assert!(status.run_id.is_none());
}

#[tokio::test]
async fn verify_approval_token_rejects_mismatched_token() {
    let result = verify_approval_token(Some("stored-token"), "different-token");
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert_eq!(err.code, ErrorCode::PlanApprovalStale);
}

#[tokio::test]
async fn verify_approval_token_rejects_missing_token() {
    let result = verify_approval_token(None, "any-token");
    assert!(result.is_err());
}

#[tokio::test]
async fn verify_approval_token_accepts_matching_token() {
    let result = verify_approval_token(Some("tok-abc"), "tok-abc");
    assert!(result.is_ok());
}

// ── T023a tests ───────────────────────────────────────────────────────────

/// T023a: item_row_to_executor_item sets library_root from the root_map
/// so the path-gate fires on real plan items.
#[test]
fn t023a_library_root_resolved_from_map() {
    let row = plans_repo::PlanItemRow {
        id: "item-1".to_owned(),
        plan_id: "plan-1".to_owned(),
        item_index: 1,
        name: "file.fits".to_owned(),
        action: "move".to_owned(),
        from_root_id: Some("root-001".to_owned()),
        from_relative_path: "raw/file.fits".to_owned(),
        to_root_id: Some("root-001".to_owned()),
        to_relative_path: "archive/file.fits".to_owned(),
        reason: "test".to_owned(),
        protection: "normal".to_owned(),
        linked_entity: None,
        item_state: "pending".to_owned(),
        failure_reason: None,
        provenance: None,
        approved_mtime: None,
        approved_size_bytes: None,
        archive_path: None,
        created_at: "2026-06-17T00:00:00Z".to_owned(),
        source_id: None,
        category: None,
        requires_destructive_confirm: Some(0),
        resolved_pattern: None,
        destructive_confirmed: 0,
    };

    let mut root_map = HashMap::new();
    root_map.insert("root-001".to_owned(), Utf8PathBuf::from("/mnt/library"));

    let item = item_row_to_executor_item(&row, &root_map, "archive");
    assert_eq!(
        item.library_root,
        Some(Utf8PathBuf::from("/mnt/library")),
        "library_root must be populated from the root_map so the path gate fires"
    );
}

/// T023a: item without from_root_id gets library_root = None (legacy/unknown mode).
#[test]
fn t023a_no_root_id_gives_none_library_root() {
    let row = plans_repo::PlanItemRow {
        id: "item-2".to_owned(),
        plan_id: "plan-1".to_owned(),
        item_index: 1,
        name: "file.fits".to_owned(),
        action: "move".to_owned(),
        from_root_id: None,
        from_relative_path: "raw/file.fits".to_owned(),
        to_root_id: None,
        to_relative_path: "archive/file.fits".to_owned(),
        reason: "test".to_owned(),
        protection: "normal".to_owned(),
        linked_entity: None,
        item_state: "pending".to_owned(),
        failure_reason: None,
        provenance: None,
        approved_mtime: None,
        approved_size_bytes: None,
        archive_path: None,
        created_at: "2026-06-17T00:00:00Z".to_owned(),
        source_id: None,
        category: None,
        requires_destructive_confirm: Some(0),
        resolved_pattern: None,
        destructive_confirmed: 0,
    };

    let root_map: HashMap<String, Utf8PathBuf> = HashMap::new();
    let item = item_row_to_executor_item(&row, &root_map, "archive");
    assert_eq!(item.library_root, None);
}

/// #765: a cross-root item (`to_root_id != from_root_id`) must resolve
/// `destination_root` from `to_root_id`, independent of `library_root`
/// (which stays resolved from `from_root_id`) — otherwise the executor
/// joins the destination path against the wrong (source) root.
#[test]
fn n765_destination_root_resolves_independently_from_to_root_id() {
    let row = plans_repo::PlanItemRow {
        id: "item-cross-root".to_owned(),
        plan_id: "plan-1".to_owned(),
        item_index: 1,
        name: "file.fits".to_owned(),
        action: "move".to_owned(),
        from_root_id: Some("inbox-root".to_owned()),
        from_relative_path: "M51/LUM/file.fits".to_owned(),
        to_root_id: Some("lights-root".to_owned()),
        to_relative_path: "M51/LUM/file.fits".to_owned(),
        reason: "test".to_owned(),
        protection: "normal".to_owned(),
        linked_entity: None,
        item_state: "pending".to_owned(),
        failure_reason: None,
        provenance: None,
        approved_mtime: None,
        approved_size_bytes: None,
        archive_path: None,
        created_at: "2026-06-17T00:00:00Z".to_owned(),
        source_id: None,
        category: None,
        requires_destructive_confirm: Some(0),
        resolved_pattern: None,
        destructive_confirmed: 0,
    };

    let mut root_map = HashMap::new();
    root_map.insert("inbox-root".to_owned(), Utf8PathBuf::from("/mnt/inbox"));
    root_map.insert("lights-root".to_owned(), Utf8PathBuf::from("/mnt/lights/1"));

    let item = item_row_to_executor_item(&row, &root_map, "archive");
    assert_eq!(
        item.library_root,
        Some(Utf8PathBuf::from("/mnt/inbox")),
        "library_root (source) must resolve from from_root_id"
    );
    assert_eq!(
        item.destination_root,
        Some(Utf8PathBuf::from("/mnt/lights/1")),
        "destination_root must resolve from to_root_id, not from_root_id"
    );
}

/// #765: when `to_root_id` is absent or unresolvable, `destination_root`
/// falls back to `library_root` (same-root actions: archive/trash/
/// catalogue, or legacy rows without a recorded destination root).
#[test]
fn n765_destination_root_falls_back_to_library_root_when_to_root_id_absent() {
    let row = plans_repo::PlanItemRow {
        id: "item-same-root".to_owned(),
        plan_id: "plan-1".to_owned(),
        item_index: 1,
        name: "file.fits".to_owned(),
        action: "archive".to_owned(),
        from_root_id: Some("root-001".to_owned()),
        from_relative_path: "raw/file.fits".to_owned(),
        to_root_id: None,
        to_relative_path: "archive/file.fits".to_owned(),
        reason: "test".to_owned(),
        protection: "normal".to_owned(),
        linked_entity: None,
        item_state: "pending".to_owned(),
        failure_reason: None,
        provenance: None,
        approved_mtime: None,
        approved_size_bytes: None,
        archive_path: None,
        created_at: "2026-06-17T00:00:00Z".to_owned(),
        source_id: None,
        category: None,
        requires_destructive_confirm: Some(0),
        resolved_pattern: None,
        destructive_confirmed: 0,
    };

    let mut root_map = HashMap::new();
    root_map.insert("root-001".to_owned(), Utf8PathBuf::from("/mnt/library"));

    let item = item_row_to_executor_item(&row, &root_map, "archive");
    assert_eq!(item.destination_root, item.library_root);
    assert_eq!(item.destination_root, Some(Utf8PathBuf::from("/mnt/library")));
}

/// T023a: root-escaping relative path is refused by the gate when library_root is set.
/// This proves the gate is active on real plan items (not inert).
#[test]
fn t023a_root_escape_gate_fires_when_library_root_is_set() {
    use fs_executor::ops::path_gate;

    let root = Utf8PathBuf::from("/mnt/library");
    // A path that escapes the root via ".." — must be refused.
    let escaping_relative = Utf8PathBuf::from("../../etc/passwd");

    let result = path_gate::resolve_and_validate(&root, &escaping_relative);
    assert!(result.is_err(), "root-escaping path must be refused when library_root is set");
    let failure = result.unwrap_err();
    assert_eq!(failure.code.as_str(), "root_escape", "failure code must be root_escape");
}

/// T023a: destructive_confirmed is now a real DB column (migration 0033),
/// read directly (not defaulted via #[sqlx(default)]).
#[test]
fn t023a_destructive_confirmed_reads_from_db_column() {
    let row = plans_repo::PlanItemRow {
        id: "item-3".to_owned(),
        plan_id: "plan-1".to_owned(),
        item_index: 1,
        name: "file.fits".to_owned(),
        action: "delete".to_owned(),
        from_root_id: None,
        from_relative_path: "raw/file.fits".to_owned(),
        to_root_id: None,
        to_relative_path: String::new(),
        reason: "test".to_owned(),
        protection: "normal".to_owned(),
        linked_entity: None,
        item_state: "pending".to_owned(),
        failure_reason: None,
        provenance: None,
        approved_mtime: None,
        approved_size_bytes: None,
        archive_path: None,
        created_at: "2026-06-17T00:00:00Z".to_owned(),
        source_id: None,
        category: None,
        requires_destructive_confirm: Some(1),
        resolved_pattern: None,
        destructive_confirmed: 1, // user confirmed
    };

    let root_map: HashMap<String, Utf8PathBuf> = HashMap::new();
    let item = item_row_to_executor_item(&row, &root_map, "archive");
    assert!(item.destructive_confirmed, "destructive_confirmed=1 in DB must be read as true");
    assert!(
        item.requires_destructive_confirm,
        "delete action must require destructive confirm"
    );
}

// ── FR-017: panic-safe registry removal (US12) ──────────────────────────────

/// Build an [`ActiveRun`] with no control wiring of consequence — the guard
/// test only cares about presence/absence of the entry by key.
fn dummy_active_run() -> ActiveRun {
    ActiveRun {
        cancel_token: CancellationToken::new(),
        skip_set: SkipSet::new(),
        retry_queue: RetryQueue::new(),
        run_id: "run-guard-test".to_owned(),
        path_set: PlanPathSet::new(),
    }
}

/// FR-017: on a *normal* scope exit the guard's `Drop` removes the entry
/// exactly once. This is the Completed / Cancelled / Paused path.
#[test]
fn active_run_guard_removes_entry_on_normal_drop() {
    let registry: Arc<DashMap<String, ActiveRun>> = Arc::new(DashMap::new());
    let plan_id = "plan-guard-normal";
    registry.insert(plan_id.to_owned(), dummy_active_run());
    assert!(registry.contains_key(plan_id), "entry present after insert");

    {
        let _guard = ActiveRunGuard { registry: registry.clone(), plan_id: plan_id.to_owned() };
        // entry still present while the guard is held
        assert!(registry.contains_key(plan_id), "entry present while guard held");
    } // guard drops here

    assert!(
        !registry.contains_key(plan_id),
        "guard Drop must remove the entry on normal scope exit"
    );
}

/// FR-017 acceptance scenario 2: a plan run that panics mid-apply must still
/// have its registry entry removed. The guard is owned by the same scope
/// that runs `execute_plan`; a panic there unwinds that scope, running the
/// guard's `Drop`. We model that scope with `catch_unwind` around a panic
/// that occurs *after* the guard is constructed and the entry inserted —
/// exactly the shape of `tokio::spawn(async move { let _g = guard; execute_plan().await })`
/// when `execute_plan` panics.
#[test]
fn active_run_guard_removes_entry_when_scope_panics() {
    let registry: Arc<DashMap<String, ActiveRun>> = Arc::new(DashMap::new());
    let plan_id = "plan-guard-panic";
    registry.insert(plan_id.to_owned(), dummy_active_run());
    assert!(registry.contains_key(plan_id), "entry present after insert");

    let registry_for_scope = registry.clone();
    let plan_id_owned = plan_id.to_owned();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        // Guard is owned by this scope, mirroring the spawned task.
        let _guard = ActiveRunGuard { registry: registry_for_scope, plan_id: plan_id_owned };
        // Stand-in for `execute_plan(...).await` panicking mid-apply.
        panic!("execute_plan panicked mid-apply");
    }));

    assert!(result.is_err(), "the scope must have panicked");
    assert!(
        !registry.contains_key(plan_id),
        "FR-017: guard Drop must remove the registry entry even when the scope unwinds from a panic"
    );
}

// ── FR-017: cross-plan path-set overlap guard (R-Concur-1) ──────────────────

/// Build a fake active run claiming the given path prefixes.
fn fake_active_run(run_id: &str, prefixes: &[&str]) -> ActiveRun {
    ActiveRun {
        cancel_token: CancellationToken::new(),
        skip_set: SkipSet::new(),
        retry_queue: RetryQueue::new(),
        run_id: run_id.to_owned(),
        path_set: prefixes.iter().map(Utf8PathBuf::from).collect(),
    }
}

/// FR-017: a pending apply whose (source ∪ destination) path set overlaps
/// an active run's path set is rejected with `plan.conflict.overlap`,
/// the state CAS never runs (plan stays `approved`), and no registry
/// entry is leaked for the rejected plan.
#[tokio::test]
async fn apply_plan_rejects_overlapping_active_plan() {
    let (db, bus) = setup().await;
    // Items claim "p-ovl-b/raw/file-0.fits" + "p-ovl-b/archive/file-0.fits"
    // (unrooted).
    insert_approved_plan_with_items(&db, "p-ovl-b", 1).await;

    // Another plan's active run claims the "p-ovl-b/raw" subtree — an
    // ancestor of this plan's source path at subtree-prefix granularity.
    let registry = active_runs();
    registry.insert("p-ovl-a".to_owned(), fake_active_run("run-ovl-a", &["p-ovl-b/raw"]));

    let result = apply_plan(db.pool(), &bus, "p-ovl-b", "test-token", None).await;
    registry.remove("p-ovl-a");

    let err = result.unwrap_err();
    assert_eq!(err.code, ErrorCode::PlanConflictOverlap);
    assert!(!registry.contains_key("p-ovl-b"), "rejected plan must not leak a registry entry");

    // The CAS never ran: the plan is untouched and can be applied later.
    let plan = repo::get_plan(db.pool(), "p-ovl-b", false).await.unwrap();
    assert_eq!(plan.state, "approved");
}

/// FR-017: disjoint path sets may apply concurrently — the guard only
/// rejects overlap, not concurrency itself.
#[tokio::test]
async fn apply_plan_allows_disjoint_active_plan() {
    let (db, bus) = setup().await;
    insert_approved_plan_with_items(&db, "p-dis-b", 1).await;

    let registry = active_runs();
    registry.insert("p-dis-a".to_owned(), fake_active_run("run-dis-a", &["/somewhere/else"]));

    let result = apply_plan(db.pool(), &bus, "p-dis-b", "test-token", None).await;
    registry.remove("p-dis-a");

    let resp = result.unwrap();
    assert_eq!(resp.new_state, "applying");

    // Let the background executor finish so the run's own registry entry
    // is dropped before other tests run.
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
}

/// FR-017: the claimed path set resolves item paths against the root map
/// the same way the executor does, and claims absolute archive paths
/// verbatim.
#[test]
fn compute_plan_path_set_resolves_roots_and_archive() {
    let row = plans_repo::PlanItemRow {
        id: "item-ps".to_owned(),
        plan_id: "plan-ps".to_owned(),
        item_index: 1,
        name: "file.fits".to_owned(),
        action: "archive".to_owned(),
        from_root_id: Some("root-001".to_owned()),
        from_relative_path: "raw/./file.fits".to_owned(),
        to_root_id: None,
        to_relative_path: "sorted/file.fits".to_owned(),
        reason: "test".to_owned(),
        protection: "normal".to_owned(),
        linked_entity: None,
        item_state: "pending".to_owned(),
        failure_reason: None,
        provenance: None,
        approved_mtime: None,
        approved_size_bytes: None,
        archive_path: Some("/vault/archive/file.fits".to_owned()),
        created_at: "2026-06-17T00:00:00Z".to_owned(),
        source_id: None,
        category: None,
        requires_destructive_confirm: Some(0),
        resolved_pattern: None,
        destructive_confirmed: 0,
    };

    let mut root_map = HashMap::new();
    root_map.insert("root-001".to_owned(), Utf8PathBuf::from("/mnt/library"));

    let set = compute_plan_path_set(std::slice::from_ref(&row), &root_map);
    assert_eq!(set.len(), 3);

    // Source: rooted + lexically normalized. Destination: falls back to
    // the source root (over-claiming, the safe direction). Archive:
    // absolute, claimed verbatim.
    let source: PlanPathSet =
        [Utf8PathBuf::from("/mnt/library/raw/file.fits")].into_iter().collect();
    let dest: PlanPathSet =
        [Utf8PathBuf::from("/mnt/library/sorted/file.fits")].into_iter().collect();
    let archive: PlanPathSet = [Utf8PathBuf::from("/vault/archive")].into_iter().collect();
    assert!(set.overlaps(&source), "source path must be claimed under its root");
    assert!(set.overlaps(&dest), "destination must fall back to the source root");
    assert!(set.overlaps(&archive), "absolute archive path must be claimed verbatim");

    let disjoint: PlanPathSet = [Utf8PathBuf::from("/elsewhere")].into_iter().collect();
    assert!(!set.overlaps(&disjoint));
}
