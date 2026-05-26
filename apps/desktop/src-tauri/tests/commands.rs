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
use desktop_shell::commands::plans::{
    plans_apply, plans_approve, plans_discard, plans_get, plans_list,
};
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
use desktop_shell::commands::settings::{settings_get, settings_update};
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

// ─── Plans (5 commands) ─────────────────────────────────────────────────────

#[tokio::test]
async fn stub_plans_list() {
    let res = plans_list(None).await;
    assert!(res.is_ok(), "plans_list failed: {res:?}");
    assert!(!res.unwrap().is_empty());
}

#[tokio::test]
async fn stub_plans_get() {
    let res = plans_get("plan-001".to_owned()).await;
    assert!(res.is_ok(), "plans_get failed: {res:?}");
    assert_eq!(res.unwrap().id, "plan-001");
}

#[tokio::test]
async fn stub_plans_approve() {
    let res = plans_approve("plan-001".to_owned(), None).await;
    assert!(res.is_ok(), "plans_approve failed: {res:?}");
}

#[tokio::test]
async fn stub_plans_apply() {
    let res = plans_apply("plan-001".to_owned()).await;
    assert!(res.is_ok(), "plans_apply failed: {res:?}");
}

#[tokio::test]
async fn stub_plans_discard() {
    let res = plans_discard("plan-001".to_owned()).await;
    assert!(res.is_ok(), "plans_discard failed: {res:?}");
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

// ─── Settings (2 commands) ──────────────────────────────────────────────────

#[tokio::test]
async fn stub_settings_get() {
    let res = settings_get("global".to_owned()).await;
    assert!(res.is_ok(), "settings_get failed: {res:?}");
    assert_eq!(res.unwrap().scope, "global");
}

#[tokio::test]
async fn stub_settings_update() {
    let vals = contracts_core::JsonAny::from(serde_json::json!({"key": "value"}));
    let res = settings_update("global".to_owned(), vals).await;
    assert!(res.is_ok(), "settings_update failed: {res:?}");
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
