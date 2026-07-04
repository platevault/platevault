//! Integration tests for all 31 Tauri stub commands.
//!
//! **Stub commands (28)** are tested by calling the command functions directly
//! — they are plain `pub async fn`s returning `Result<T, String>`.
//!
//! **Lifecycle commands (4)** require `State<'_, AppState>` injected by the
//! Tauri runtime. Tauri 2's mock runtime ACL (`Resolved::default()`) blocks
//! all IPC calls, so these are tested at the application-use-case layer with
//! an in-memory `SQLite` database. A separate test verifies the mock app builds
//! successfully with managed `AppState`, proving the wiring compiles.

use std::sync::Arc;

use audit::bus::EventBus;
use contracts_core::lifecycle::{
    ProjectState, ProjectTransitionRequest, TransitionActor, TransitionRequest,
};
use contracts_core::provenance::{AssetType, ProvenanceReadRequest};
use persistence_db::repositories::lifecycle::SqliteLifecycleRepository;
use persistence_db::Database;
use tauri::Manager;

use desktop_shell::commands::audit::{audit_export, audit_list};
use desktop_shell::commands::calibration::{
    calibration_masters_get, calibration_masters_list, calibration_matches,
};
use desktop_shell::commands::lifecycle::AppState;
use desktop_shell::commands::plan_apply::plans_apply_real;
use desktop_shell::commands::plans::{plans_discard, plans_retry};
use desktop_shell::commands::preferences::{preferences_get, preferences_set};
use desktop_shell::commands::projects::projects_create_plan;
use desktop_shell::commands::review::review_queue;
use desktop_shell::commands::roots::{
    equipment_list, roots_list, roots_remap, roots_remap_apply, scan_start,
};
use desktop_shell::commands::search::search_global;
use desktop_shell::commands::sessions::{
    sessions_calendar, sessions_get, sessions_list, sessions_merge, sessions_split,
};

use contracts_core::error_code::ErrorCode;
use desktop_shell::commands::targets::{targets_get, targets_list};
use desktop_shell::commands::tour::tour_complete_step;

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Build a mock Tauri app with the lifecycle commands and managed `AppState`
/// backed by an in-memory `SQLite` database.
async fn mock_lifecycle_app() -> tauri::App<tauri::test::MockRuntime> {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());
    let repo = Arc::new(SqliteLifecycleRepository::new(pool, bus.clone()));
    let state = AppState::new(repo, bus);

    let app = tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![
            desktop_shell::commands::lifecycle::provenance_read,
            desktop_shell::commands::lifecycle::lifecycle_transition_apply,
            desktop_shell::commands::lifecycle::lifecycle_transition_preview,
            desktop_shell::commands::lifecycle::lifecycle_ledger_list,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");

    app.manage(state);
    app
}

// ─── Sessions (6 commands) ──────────────────────────────────────────────────

// sessions_list / sessions_get now require AppState (spec 037 de-stub, 4dd335f):
// they query real acquisition_session rows. Real runtime coverage lives in
// crates/app/core/tests/sessions_integration.rs. The command imports are kept
// here to prove the new signatures compile.
#[allow(dead_code)]
fn _sessions_list_compiles_check() {
    let _ = sessions_list;
}
#[allow(dead_code)]
fn _sessions_get_compiles_check() {
    let _ = sessions_get;
}

#[tokio::test]
async fn stub_sessions_calendar() {
    let res = sessions_calendar("2026-05".to_owned(), "2026-06".to_owned()).await;
    assert!(res.is_ok(), "sessions_calendar failed: {res:?}");
    assert!(!res.unwrap().months.is_empty());
}

#[tokio::test]
async fn stub_sessions_split() {
    let res = sessions_split("ses-001".to_owned(), 10).await;
    assert!(res.is_ok(), "sessions_split failed: {res:?}");
    let split = res.unwrap();
    assert_eq!(split.original.frame_count, 10);
}

#[tokio::test]
async fn stub_sessions_merge() {
    let res = sessions_merge(vec!["ses-001".to_owned(), "ses-002".to_owned()]).await;
    assert!(res.is_ok(), "sessions_merge failed: {res:?}");
}

// ─── Calibration (3 commands) ───────────────────────────────────────────────
//
// calibration_masters_list / calibration_masters_get now require AppState.
// We test the use-case layer directly (same pattern as plans tests above).
// The command import is kept to prove the new signature compiles.
#[allow(dead_code)]
fn _calibration_masters_list_compiles_check() {
    let _ = calibration_masters_list;
}
#[allow(dead_code)]
fn _calibration_masters_get_compiles_check() {
    let _ = calibration_masters_get;
}

/// T037: calibration.masters.list returns real rows from DB (empty on fresh DB, not fixtures).
#[tokio::test]
async fn calibration_masters_list_returns_real_rows() {
    let state = make_plans_state().await;
    let res = app_core::calibration::masters_list(state.repo.pool()).await;
    assert!(res.is_ok(), "masters_list failed: {res:?}");
    // Fresh DB has no calibration sessions → empty list (not fixtures).
    assert!(res.unwrap().is_empty(), "fresh DB must return empty masters list — not fixture stubs");
}

/// T037: calibration.masters.get returns error for unknown id.
#[tokio::test]
async fn calibration_masters_get_returns_not_found() {
    let state = make_plans_state().await;
    let res = app_core::calibration::masters_get(state.repo.pool(), "nonexistent").await;
    assert!(res.is_err(), "expected error for nonexistent master");
    assert!(res.unwrap_err().contains("master.not_found"), "error must contain master.not_found");
}

#[tokio::test]
async fn stub_calibration_matches() {
    let res = calibration_matches("ses-001".to_owned()).await;
    assert!(res.is_ok(), "calibration_matches failed: {res:?}");
    // calibration_matches now returns empty (stub replaced by calibration.match.suggest).
    assert!(
        res.unwrap().is_empty(),
        "calibration_matches must return empty; use calibration.match.suggest for real results"
    );
}

// ─── Targets (2 commands) ───────────────────────────────────────────────────

#[tokio::test]
async fn stub_targets_list() {
    let res = targets_list(None).await;
    assert!(res.is_ok(), "targets_list failed: {res:?}");
    assert!(!res.unwrap().is_empty());
}

#[tokio::test]
async fn stub_targets_get() {
    let res = targets_get("target-001".to_owned()).await;
    assert!(res.is_ok(), "targets_get failed: {res:?}");
    assert_eq!(res.unwrap().id, "target-001");
}

// ─── Projects (spec 008 — real implementation with in-memory DB) ────────────

/// Build an `AppState` backed by an in-memory `SQLite` database (projects tests).
async fn make_projects_state() -> AppState {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());
    let repo = Arc::new(SqliteLifecycleRepository::new(pool, bus.clone()));
    AppState::new(repo, bus)
}

#[tokio::test]
async fn projects_list_returns_empty_initially() {
    let state = make_projects_state().await;
    let res = app_core::project_setup::list(state.repo.pool()).await;
    assert!(res.is_ok(), "project list failed: {res:?}");
    assert!(res.unwrap().is_empty());
}

#[tokio::test]
async fn projects_get_returns_not_found() {
    let state = make_projects_state().await;
    let res = app_core::project_setup::get(state.repo.pool(), "nonexistent").await;
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code, ErrorCode::ProjectNotFound);
}

#[tokio::test]
async fn projects_create_and_list() {
    let state = make_projects_state().await;
    let req = contracts_core::projects_v2::ProjectCreateRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        name: "NGC 7000 NB".to_owned(),
        tool: contracts_core::projects_v2::ProjectTool::PixInsight,
        path: "projects/NGC7000_NB".to_owned(),
        initial_sources: vec![],
        notes: None,
        canonical_target_id: None,
    };
    let result = app_core::project_setup::create(state.repo.pool(), &state.bus, &req).await;
    assert!(result.is_ok(), "create failed: {result:?}");
    assert_eq!(result.unwrap().lifecycle, "setup_incomplete");

    let list = app_core::project_setup::list(state.repo.pool()).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "NGC 7000 NB");
}

#[tokio::test]
async fn stub_projects_create_plan() {
    let wizard = contracts_core::JsonAny::from(serde_json::json!({"target": "NGC 7000"}));
    let res = projects_create_plan(wizard).await;
    assert!(res.is_ok(), "projects_create_plan failed: {res:?}");
}

// ─── Plans (spec 017 — real implementation with in-memory DB) ───────────────

/// Build an `AppState` backed by an in-memory `SQLite` database.
async fn make_plans_state() -> AppState {
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());
    let repo = Arc::new(SqliteLifecycleRepository::new(pool, bus.clone()));
    AppState::new(repo, bus)
}

#[tokio::test]
async fn plans_list_returns_empty_when_no_plans() {
    let state = make_plans_state().await;
    let res = app_core::plans::list_plans(
        state.repo.pool(),
        &contracts_core::plans::PlanListRequest {
            created_after: Some("1970-01-01T00:00:00Z".to_owned()),
            ..Default::default()
        },
    )
    .await;
    assert!(res.is_ok(), "list_plans failed: {res:?}");
    assert!(res.unwrap().plans.is_empty());
}

#[tokio::test]
async fn plans_get_returns_not_found() {
    let state = make_plans_state().await;
    let res = app_core::plans::get_plan(state.repo.pool(), "nonexistent").await;
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code, ErrorCode::PlanNotFound);
}

#[tokio::test]
async fn plans_discard_returns_not_found() {
    let state = make_plans_state().await;
    // plans_discard is now a real command; call use case directly to avoid State injection.
    let res = app_core::plans::discard_plan(state.repo.pool(), &state.bus, "missing").await;
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code, ErrorCode::PlanNotFound);
}

// plans.apply (spec 025) — tested by the compilation smoke test only.
// The import is kept to verify the real function signature compiles.
#[allow(dead_code)]
fn _plans_apply_compiles_check() {
    // Verify plans_apply_real is importable; State injection cannot be tested outside Tauri app.
    let _ = plans_apply_real;
}

#[tokio::test]
async fn plans_retry_requires_terminal_parent() {
    let state = make_plans_state().await;
    // Insert a draft plan (non-terminal).
    persistence_db::repositories::plans::insert_plan(
        state.repo.pool(),
        &persistence_db::repositories::plans::InsertPlan {
            id: "parent-draft",
            title: "Draft plan",
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

    let res = app_core::plans::retry_plan(
        state.repo.pool(),
        &state.bus,
        "parent-draft",
        contracts_core::plans::RetryItemsFilter::Failed,
    )
    .await;
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code, ErrorCode::ParentNotTerminal);

    // Also verify the import of plans_retry compiles.
    let _ = plans_retry;
    let _ = plans_discard;
}

// ─── Audit (2 commands) ─────────────────────────────────────────────────────
//
// `audit_list` / `audit_export` moved off the spec-029 fixture stub onto real
// `audit_log_entry` reads (crates/persistence/db/src/repositories/audit.rs).
// Both commands now take `State<'_, AppState>`, so — like the other
// state-backed lifecycle commands in this file — they are exercised against
// `mock_lifecycle_app()`'s in-memory `SQLite` database rather than by calling
// them with no state at all.

async fn insert_audit_row(
    pool: &sqlx::SqlitePool,
    audit_id: &str,
    entity_type: &str,
    entity_id: &str,
    trigger: &str,
) {
    sqlx::query(
        "INSERT INTO audit_log_entry \
         (audit_id, entity_type, entity_id, from_state, to_state, trigger, actor, \
          outcome, severity, request_id, at, payload) \
         VALUES (?, ?, ?, NULL, NULL, ?, 'user', 'applied', 'workflow', 'req-1', \
                 '2026-01-01T00:00:00Z', NULL)",
    )
    .bind(audit_id)
    .bind(entity_type)
    .bind(entity_id)
    .bind(trigger)
    .execute(pool)
    .await
    .expect("insert audit_log_entry row");
}

#[tokio::test]
async fn audit_list_reads_real_audit_log_entry_rows() {
    let app = mock_lifecycle_app().await;
    let state = app.state::<AppState>();
    insert_audit_row(state.repo.pool(), "a1", "session", "ses-1", "Confirm session").await;

    let res = audit_list(state, None, None).await.expect("audit_list ok");
    assert_eq!(res.total, 1);
    assert_eq!(res.entries.len(), 1);
    let entry = &res.entries[0];
    assert_eq!(entry.id, "a1");
    assert_eq!(entry.entity_type, "session");
    assert_eq!(entry.entity_id, "ses-1");
    assert_eq!(entry.event_type, "Confirm session");
    // No `payload` on this row — `detail` falls back to the `trigger` text.
    assert_eq!(entry.detail, "Confirm session");
}

#[tokio::test]
async fn audit_list_empty_db_returns_empty_response() {
    let app = mock_lifecycle_app().await;
    let state = app.state::<AppState>();

    let res = audit_list(state, None, None).await.expect("audit_list ok");
    assert_eq!(res.total, 0);
    assert!(res.entries.is_empty());
}

#[tokio::test]
async fn audit_list_filters_by_entity_type() {
    let app = mock_lifecycle_app().await;
    let state = app.state::<AppState>();
    insert_audit_row(state.repo.pool(), "a1", "session", "ses-1", "Confirm session").await;
    insert_audit_row(state.repo.pool(), "a2", "plan", "plan-1", "Approve plan").await;

    let filters = desktop_shell::commands::audit::AuditFilterDto {
        entity_type: Some("plan".to_owned()),
        ..Default::default()
    };
    let res = audit_list(state, Some(filters), None).await.expect("audit_list ok");
    assert_eq!(res.total, 1);
    assert_eq!(res.entries[0].entity_id, "plan-1");
}

#[tokio::test]
async fn audit_export_returns_ndjson_of_real_rows() {
    let app = mock_lifecycle_app().await;
    let state = app.state::<AppState>();
    insert_audit_row(state.repo.pool(), "a1", "session", "ses-1", "Confirm session").await;

    let res = audit_export(state, None).await.expect("audit_export ok");
    let lines: Vec<&str> = res.lines().collect();
    assert_eq!(lines.len(), 1);
    let parsed: serde_json::Value = serde_json::from_str(lines[0]).expect("valid ndjson line");
    assert_eq!(parsed["id"], "a1");
    assert_eq!(parsed["entityId"], "ses-1");
}

// ─── Review (1 command) ─────────────────────────────────────────────────────

#[tokio::test]
async fn stub_review_queue() {
    let res = review_queue(None).await;
    assert!(res.is_ok(), "review_queue failed: {res:?}");
    assert!(!res.unwrap().is_empty());
}

// ─── Roots & Scan & Equipment (6 commands) ──────────────────────────────────

// `roots_list` now requires `State<'_, AppState>` (spec 003 real impl). Real
// runtime coverage lives in the use-case tests below; the command import is
// kept to prove the new signature compiles.
#[allow(dead_code)]
fn _roots_list_compiles_check() {
    let _ = roots_list;
}

// `roots_register` now requires `State<'_, AppState>` (spec 003 real impl).
// Tested at the use-case layer below alongside other stateful commands.

#[tokio::test]
async fn roots_register_via_use_case() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");

    // Path must be absolute on the host OS (validate_path rejects POSIX-style
    // paths on Windows).
    #[cfg(windows)]
    let source_path = "C:\\Temp";
    #[cfg(not(windows))]
    let source_path = "/tmp";

    let req = contracts_core::first_run::RegisterSourceRequest {
        kind: contracts_core::first_run::SourceKind::LightFrames,
        path: source_path.to_owned(),
        kind_subtype: None,
        scan_depth: contracts_core::first_run::ScanDepth::Recursive,
        organization_state: contracts_core::first_run::OrganizationState::Organized,
    };

    let resp = app_core::first_run::register_source(db.pool(), &req).await;
    assert!(resp.is_ok(), "register_source failed: {resp:?}");
    let resp = resp.unwrap();
    assert_eq!(resp.kind, contracts_core::first_run::SourceKind::LightFrames);
    assert_eq!(resp.path, source_path);
}

// `roots_remap`/`roots_remap_apply` now require `State<'_, AppState>` (P6a real
// impl). Tested at the use-case layer below alongside other stateful commands;
// the command imports are kept to prove the new signatures compile.
#[allow(dead_code)]
fn _roots_remap_compiles_check() {
    let _ = roots_remap;
    let _ = roots_remap_apply;
}

#[tokio::test]
async fn roots_remap_via_use_case() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");

    // Paths must be absolute on the host OS (validate_path rejects POSIX-style
    // paths on Windows).
    #[cfg(windows)]
    let (source_path, new_path) = ("C:\\Temp", "C:\\Windows");
    #[cfg(not(windows))]
    let (source_path, new_path) = ("/tmp", "/var/tmp");

    let req = contracts_core::first_run::RegisterSourceRequest {
        kind: contracts_core::first_run::SourceKind::LightFrames,
        path: source_path.to_owned(),
        kind_subtype: None,
        scan_depth: contracts_core::first_run::ScanDepth::Recursive,
        organization_state: contracts_core::first_run::OrganizationState::Organized,
    };
    let resp = app_core::first_run::register_source(db.pool(), &req)
        .await
        .expect("register_source failed");

    let preview = app_core::first_run::remap_root(db.pool(), &resp.source_id, new_path)
        .await
        .expect("remap_root failed");
    assert_eq!(preview.original_path, source_path);
    assert_eq!(preview.new_path, new_path);
    assert!(preview.all_verified, "no sample file_record rows means verified-by-existence alone");
}

#[tokio::test]
async fn roots_remap_apply_via_use_case() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let bus = EventBus::with_pool(db.pool().clone());

    #[cfg(windows)]
    let (source_path, new_path) = ("C:\\Temp", "C:\\Windows");
    #[cfg(not(windows))]
    let (source_path, new_path) = ("/tmp", "/var/tmp");

    let req = contracts_core::first_run::RegisterSourceRequest {
        kind: contracts_core::first_run::SourceKind::Project,
        path: source_path.to_owned(),
        kind_subtype: None,
        scan_depth: contracts_core::first_run::ScanDepth::Recursive,
        organization_state: contracts_core::first_run::OrganizationState::Organized,
    };
    let resp = app_core::first_run::register_source(db.pool(), &req)
        .await
        .expect("register_source failed");

    app_core::first_run::apply_root_remap(db.pool(), &bus, &resp.source_id, new_path, true)
        .await
        .expect("apply_root_remap failed");

    let (_, path) = persistence_db::repositories::first_run::get_source_kind_and_path(
        db.pool(),
        &resp.source_id,
    )
    .await
    .expect("query failed")
    .expect("source not found");
    assert_eq!(path, new_path);
}

#[tokio::test]
async fn stub_scan_start() {
    let res = scan_start(None).await;
    assert!(res.is_ok(), "scan_start failed: {res:?}");
}

#[tokio::test]
async fn stub_equipment_list() {
    let res = equipment_list().await;
    assert!(res.is_ok(), "equipment_list failed: {res:?}");
    assert!(!res.unwrap().is_empty());
}

// ─── Settings (spec 018) ─────────────────────────────────────────────────────

#[tokio::test]
async fn settings_get_returns_defaults() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let bus = EventBus::with_pool(db.pool().clone());
    let resp = app_core::settings::get_settings(db.pool(), &bus).await;
    assert!(resp.is_ok(), "settings_get failed: {resp:?}");
    let state = resp.unwrap().settings;
    assert_eq!(state.log_level, "info");
    assert!(!state.follow_symlinks);
}

#[tokio::test]
async fn settings_update_and_persist() {
    use contracts_core::settings::{SettingsUpdateRequest, SettingsUpdateStatus};
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let bus = EventBus::with_pool(db.pool().clone());
    let req = SettingsUpdateRequest {
        key: "logLevel".to_owned(),
        value: contracts_core::JsonAny::from(serde_json::json!("debug")),
    };
    let resp = app_core::settings::update_setting(db.pool(), &bus, &req).await;
    assert!(resp.is_ok(), "settings_update failed: {resp:?}");
    assert_eq!(resp.unwrap().status, SettingsUpdateStatus::Success);
}

#[tokio::test]
async fn settings_scope_roundtrip_via_usecase() {
    // Proves: write { scope="advanced", values={logLevel:"debug"} } persists
    // logLevel=debug, and a subsequent get of the "advanced" scope returns the
    // updated value. This simulates the stable transport (T015).
    use contracts_core::settings::{SettingsUpdateRequest, SettingsUpdateStatus};
    use persistence_db::repositories::settings as repo;

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let bus = EventBus::with_pool(db.pool().clone());

    // 1. Write logLevel via the per-key use case (same path as settings.update).
    let req = SettingsUpdateRequest {
        key: "logLevel".to_owned(),
        value: contracts_core::JsonAny::from(serde_json::json!("debug")),
    };
    let resp = app_core::settings::update_setting(db.pool(), &bus, &req).await.unwrap();
    assert_eq!(resp.status, SettingsUpdateStatus::Success);

    // 2. Read back via resolve_setting (same path as settings.get per-key resolution).
    let resolved = app_core::settings::resolve_setting(db.pool(), "logLevel", None).await.unwrap();
    assert_eq!(resolved, serde_json::json!("debug"));

    // 3. Verify the raw stored row is correct (proves persistence, not just in-memory).
    let raw = repo::get_raw(db.pool(), "logLevel").await.unwrap();
    assert_eq!(raw, Some(serde_json::json!("debug")));

    // 4. Write rememberFollowLogs (noisy key — same scope, no audit_id).
    let req2 = SettingsUpdateRequest {
        key: "rememberFollowLogs".to_owned(),
        value: contracts_core::JsonAny::from(serde_json::json!(true)),
    };
    let resp2 = app_core::settings::update_setting(db.pool(), &bus, &req2).await.unwrap();
    assert_eq!(resp2.status, SettingsUpdateStatus::Success);
    assert!(resp2.audit_id.is_none(), "noisy key must not emit per-change audit_id");

    // 5. Restore logLevel to default — scope round-trip complete.
    let restore_req =
        contracts_core::settings::RestoreDefaultsRequest { keys: vec!["logLevel".to_owned()] };
    let restore_resp =
        app_core::settings::restore_defaults(db.pool(), &bus, &restore_req).await.unwrap();
    assert!(restore_resp.restored.contains(&"logLevel".to_owned()));
    let after_restore =
        app_core::settings::resolve_setting(db.pool(), "logLevel", None).await.unwrap();
    assert_eq!(after_restore, serde_json::json!("info"), "logLevel must be back to default");
}

// ─── Preferences (2 commands) ───────────────────────────────────────────────

#[tokio::test]
async fn stub_preferences_get() {
    let res = preferences_get().await;
    assert!(res.is_ok(), "preferences_get failed: {res:?}");
}

#[tokio::test]
async fn stub_preferences_set() {
    let val = contracts_core::JsonAny::from(serde_json::json!(true));
    let res = preferences_set("sidebar_collapsed".to_owned(), val).await;
    assert!(res.is_ok(), "preferences_set failed: {res:?}");
}

// ─── Search (1 command) ─────────────────────────────────────────────────────
//
// search_global now requires AppState (real cross-entity DB query, T039).
// We test the use-case layer directly and keep the command import to prove
// the new signature compiles.
#[allow(dead_code)]
fn _search_global_compiles_check() {
    let _ = search_global;
}

/// T034 / T039: search.global queries the real DB and reflects the query string.
#[tokio::test]
async fn search_global_queries_real_db() {
    let state = make_plans_state().await;
    // Empty query on a fresh DB: must return empty without error.
    let res = app_core::search::search_global(state.repo.pool(), "").await;
    assert!(res.is_ok(), "search_global empty query failed: {res:?}");

    // Query for something that doesn't exist: must return empty (not fixtures).
    let res = app_core::search::search_global(state.repo.pool(), "M31").await;
    assert!(res.is_ok(), "search_global M31 query failed: {res:?}");
    assert!(
        res.unwrap().is_empty(),
        "search_global must return empty on fresh DB (no fixture data injected)"
    );
}

// ─── Tour (1 command) ───────────────────────────────────────────────────────

#[tokio::test]
async fn stub_tour_complete_step() {
    let res = tour_complete_step("step1".to_owned()).await;
    assert!(res.is_ok(), "tour_complete_step failed: {res:?}");
}

// ─── Lifecycle commands (4 commands) ─────────────────────────────────────────
//
// These commands require `State<'_, AppState>` which is injected by the Tauri
// runtime. The mock IPC runtime's default ACL blocks all commands
// (`Resolved::default()` grants no permissions), so we test the underlying
// use-case functions directly with an in-memory database. This validates that
// `AppState` construction and the persistence layer work correctly.
//
// Additionally, we verify that the mock Tauri app with managed `AppState` can
// be built — this proves the command handler wiring compiles and the state
// management layer accepts our `AppState`.

#[tokio::test]
async fn lifecycle_app_state_construction() {
    // Verify mock app builds successfully with managed AppState.
    // This proves the Tauri command wiring compiles and state is accepted.
    let _app = mock_lifecycle_app().await;
}

#[tokio::test]
async fn lifecycle_provenance_read() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");

    let request =
        ProvenanceReadRequest::new(uuid::Uuid::new_v4(), uuid::Uuid::new_v4(), AssetType::Project);

    let response = app_core::provenance_use_case::read_provenance(db.pool(), request).await;
    // Even for a non-existent entity, read_provenance returns a valid response
    // (not a panic or unrecoverable error).
    assert!(!response.contract_version.is_empty());
}

#[tokio::test]
async fn lifecycle_transition_preview() {
    let request = TransitionRequest::Project(ProjectTransitionRequest::new(
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
        ProjectState::Ready,
        ProjectState::Processing,
        TransitionActor::User,
    ));

    let response = app_core::transition_use_case::preview_transition(request);
    // Preview is a pure function — no DB needed. It returns a valid response.
    assert!(!response.contract_version.is_empty());
}

#[tokio::test]
async fn lifecycle_transition_apply() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());
    let repo = Arc::new(SqliteLifecycleRepository::new(pool, bus.clone()));
    let state = AppState::new(repo, bus);

    let request = TransitionRequest::Project(ProjectTransitionRequest::new(
        uuid::Uuid::new_v4(),
        uuid::Uuid::new_v4(),
        ProjectState::Ready,
        ProjectState::Processing,
        TransitionActor::User,
    ));

    let response = app_core::transition_use_case::apply_transition(
        state.repo.as_ref(),
        &state.bus,
        request,
        &state.edge_table,
    )
    .await;
    // The entity doesn't exist so the transition will be refused, but the
    // command infrastructure should not panic.
    assert!(!response.contract_version.is_empty());
}

#[tokio::test]
async fn lifecycle_ledger_list() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());
    let repo = Arc::new(SqliteLifecycleRepository::new(pool, bus.clone()));

    let filter = persistence_db::repositories::lifecycle::LedgerFilter::default();

    let result = app_core::ledger_use_case::list_assets_ledger(repo.as_ref(), filter).await;
    assert!(result.is_ok(), "ledger_list failed: {result:?}");
    // Empty DB yields empty list — no panic.
    assert!(result.unwrap().is_empty());
}
