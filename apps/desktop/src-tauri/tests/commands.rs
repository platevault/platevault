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
use desktop_shell::commands::projects::{projects_create_plan, projects_get, projects_list};
use desktop_shell::commands::review::review_queue;
use desktop_shell::commands::roots::{
    equipment_list, roots_list, roots_remap, roots_remap_apply, scan_start,
};
use desktop_shell::commands::search::search_global;
use desktop_shell::commands::sessions::{
    sessions_calendar, sessions_get, sessions_list, sessions_merge, sessions_split,
    sessions_transition,
};

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

#[tokio::test]
async fn stub_sessions_list() {
    let res = sessions_list().await;
    assert!(res.is_ok(), "sessions_list failed: {res:?}");
    assert!(!res.unwrap().is_empty(), "sessions_list should return fixtures");
}

#[tokio::test]
async fn stub_sessions_get() {
    let res = sessions_get("ses-001".to_owned()).await;
    assert!(res.is_ok(), "sessions_get failed: {res:?}");
    assert_eq!(res.unwrap().id, "ses-001");
}

#[tokio::test]
async fn stub_sessions_calendar() {
    let res = sessions_calendar("2026-05".to_owned(), "2026-06".to_owned()).await;
    assert!(res.is_ok(), "sessions_calendar failed: {res:?}");
    assert!(!res.unwrap().months.is_empty());
}

#[tokio::test]
async fn stub_sessions_transition() {
    let res = sessions_transition("ses-001".to_owned(), "confirm".to_owned(), None).await;
    assert!(res.is_ok(), "sessions_transition failed: {res:?}");
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

#[tokio::test]
async fn stub_calibration_masters_list() {
    let res = calibration_masters_list().await;
    assert!(res.is_ok(), "calibration_masters_list failed: {res:?}");
    assert!(!res.unwrap().is_empty());
}

#[tokio::test]
async fn stub_calibration_masters_get() {
    let res = calibration_masters_get("master-001".to_owned()).await;
    assert!(res.is_ok(), "calibration_masters_get failed: {res:?}");
    assert_eq!(res.unwrap().id, "master-001");
}

#[tokio::test]
async fn stub_calibration_matches() {
    let res = calibration_matches("ses-001".to_owned()).await;
    assert!(res.is_ok(), "calibration_matches failed: {res:?}");
    assert!(!res.unwrap().is_empty());
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

// ─── Projects (3 commands) ──────────────────────────────────────────────────

#[tokio::test]
async fn stub_projects_list() {
    let res = projects_list(None).await;
    assert!(res.is_ok(), "projects_list failed: {res:?}");
    assert!(!res.unwrap().is_empty());
}

#[tokio::test]
async fn stub_projects_get() {
    let res = projects_get("proj-001".to_owned()).await;
    assert!(res.is_ok(), "projects_get failed: {res:?}");
    assert_eq!(res.unwrap().id, "proj-001");
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
    assert_eq!(res.unwrap_err().code, "plan.not_found");
}

#[tokio::test]
async fn plans_discard_returns_not_found() {
    let state = make_plans_state().await;
    // plans_discard is now a real command; call use case directly to avoid State injection.
    let res = app_core::plans::discard_plan(state.repo.pool(), &state.bus, "missing").await;
    assert!(res.is_err());
    assert_eq!(res.unwrap_err().code, "plan.not_found");
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
    assert_eq!(res.unwrap_err().code, "parent.not_terminal");

    // Also verify the import of plans_retry compiles.
    let _ = plans_retry;
    let _ = plans_discard;
}

// ─── Audit (2 commands) ─────────────────────────────────────────────────────

#[tokio::test]
async fn stub_audit_list() {
    let res = audit_list(None, None).await;
    assert!(res.is_ok(), "audit_list failed: {res:?}");
    assert!(!res.unwrap().entries.is_empty());
}

#[tokio::test]
async fn stub_audit_export() {
    let res = audit_export(None).await;
    assert!(res.is_ok(), "audit_export failed: {res:?}");
    assert!(!res.unwrap().is_empty());
}

// ─── Review (1 command) ─────────────────────────────────────────────────────

#[tokio::test]
async fn stub_review_queue() {
    let res = review_queue(None).await;
    assert!(res.is_ok(), "review_queue failed: {res:?}");
    assert!(!res.unwrap().is_empty());
}

// ─── Roots & Scan & Equipment (6 commands) ──────────────────────────────────

#[tokio::test]
async fn stub_roots_list() {
    let res = roots_list().await;
    assert!(res.is_ok(), "roots_list failed: {res:?}");
    assert!(!res.unwrap().is_empty());
}

// `roots_register` now requires `State<'_, AppState>` (spec 003 real impl).
// Tested at the use-case layer below alongside other stateful commands.

#[tokio::test]
async fn roots_register_via_use_case() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");

    let req = contracts_core::first_run::RegisterSourceRequest {
        kind: contracts_core::first_run::SourceKind::LightFrames,
        path: "/tmp".to_owned(),
        kind_subtype: None,
        scan_depth: contracts_core::first_run::ScanDepth::Recursive,
    };

    let resp = app_core::first_run::register_source(db.pool(), &req).await;
    assert!(resp.is_ok(), "register_source failed: {resp:?}");
    let resp = resp.unwrap();
    assert_eq!(resp.kind, contracts_core::first_run::SourceKind::LightFrames);
    assert_eq!(resp.path, "/tmp");
}

#[tokio::test]
async fn stub_roots_remap() {
    let res = roots_remap("root-001".to_owned(), "/new/path".to_owned()).await;
    assert!(res.is_ok(), "roots_remap failed: {res:?}");
    assert!(res.unwrap().all_verified);
}

#[tokio::test]
async fn stub_roots_remap_apply() {
    let res = roots_remap_apply("root-001".to_owned(), true).await;
    assert!(res.is_ok(), "roots_remap_apply failed: {res:?}");
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

#[tokio::test]
async fn stub_search_global() {
    let res = search_global("M31".to_owned()).await;
    assert!(res.is_ok(), "search_global failed: {res:?}");
    assert!(!res.unwrap().is_empty());
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
