//! Project Tauri commands (spec 008 F-5).
//!
//! Provides real implementations for:
//!   - `projects.list`         — list project summaries from DB.
//!   - `projects.get`          — get project detail (sources + channels) from DB.
//!   - `projects.create`       — create a project via the use case.
//!   - `projects.update`       — update name/tool/notes via the use case.
//!   - `projects.source.add`   — link an Inventory session.
//!   - `projects.source.remove` — unlink a source.
//!   - `projects.channels.reinfer`      — re-infer channels.
//!   - `projects.channels.dismiss_drift` — dismiss channel drift banner.
//!
//! Stub commands that remain until spec 025/003 integration completes:
//!   - `projects.create_plan`  — retained for UI compatibility (returns fixture).
//!
//! `projects.list` and `projects.get` retain their original specta rename strings
//! so the existing TypeScript surface is not broken.

use app_core::project_setup;
use contracts_core::lifecycle::PlanState;
use contracts_core::plans::{
    DestructiveDestination, PlanDetail, PlanItemAction, PlanItemDetail, PlanItemProtection,
    PlanItemState, PlanOrigin, PlanType,
};
use contracts_core::projects_v2::{
    ProjectChannelsDismissDriftRequest, ProjectChannelsDismissDriftResult,
    ProjectChannelsReinferRequest, ProjectChannelsReinferResult, ProjectCreateRequest,
    ProjectCreateResult, ProjectDetailDto, ProjectSourceAddRequest, ProjectSourceAddResult,
    ProjectSourceRemoveRequest, ProjectSourceRemoveResult, ProjectSummaryDto, ProjectUpdateRequest,
    ProjectUpdateResult,
};
use contracts_core::ContractError;
use contracts_core::JsonAny;
use tauri::State;

use crate::commands::lifecycle::AppState;

// ── projects.list ─────────────────────────────────────────────────────────────

/// `projects.list` — list all projects from the database.
///
/// # Errors
///
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn projects_list(
    state: State<'_, AppState>,
    _filters: Option<JsonAny>,
) -> Result<Vec<ProjectSummaryDto>, ContractError> {
    project_setup::list(state.repo.pool()).await
}

// ── projects.get ──────────────────────────────────────────────────────────────

/// `projects.get` — get a single project with sources and channels.
///
/// # Errors
///
/// Returns `Err(String)` with `"project.not_found"` when the project does not
/// exist.
#[tauri::command]
#[specta::specta]
pub async fn projects_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<ProjectDetailDto, ContractError> {
    project_setup::get(state.repo.pool(), &id).await
}

// ── projects.create ───────────────────────────────────────────────────────────

/// `projects.create` — create a new project.
///
/// Routes through `app_core::project_create` so the folder-scaffolding plan
/// is auto-applied when it is mkdir-only (user decision 2026-07-04); the
/// result's `scaffold_applied` reports the outcome. The plan + audit records
/// are still written either way (constitution II).
///
/// # Errors
///
/// Returns `Err(String)` with the error code on validation or database failure.
#[tauri::command]
#[specta::specta]
pub async fn projects_create(
    state: State<'_, AppState>,
    req: ProjectCreateRequest,
) -> Result<ProjectCreateResult, ContractError> {
    app_core::project_create::create(state.repo.pool(), &state.bus, &req).await
}

// ── projects.update ───────────────────────────────────────────────────────────

/// `projects.update` — update name, tool, or notes on an existing project.
///
/// # Errors
///
/// Returns `Err(String)` on validation failure or when the project is not found.
#[tauri::command]
#[specta::specta]
pub async fn projects_update(
    state: State<'_, AppState>,
    req: ProjectUpdateRequest,
) -> Result<ProjectUpdateResult, ContractError> {
    project_setup::update(state.repo.pool(), &state.bus, &req).await
}

// ── projects.source.add ───────────────────────────────────────────────────────

/// `projects.source.add` — link an Inventory session to a project.
///
/// # Errors
///
/// Returns `Err(String)` on validation failure or duplicate link.
#[tauri::command]
#[specta::specta]
pub async fn projects_source_add(
    state: State<'_, AppState>,
    req: ProjectSourceAddRequest,
) -> Result<ProjectSourceAddResult, ContractError> {
    project_setup::add_source(state.repo.pool(), &state.bus, &req).await
}

// ── projects.source.remove ────────────────────────────────────────────────────

/// `projects.source.remove` — unlink a source from a project.
///
/// # Errors
///
/// Returns `Err(String)` when lifecycle is locked or source not found.
#[tauri::command]
#[specta::specta]
pub async fn projects_source_remove(
    state: State<'_, AppState>,
    req: ProjectSourceRemoveRequest,
) -> Result<ProjectSourceRemoveResult, ContractError> {
    project_setup::remove_source(state.repo.pool(), &state.bus, &req).await
}

// ── projects.channels.reinfer ─────────────────────────────────────────────────

/// `projects.channels.reinfer` — re-infer channels from all linked sources.
///
/// # Errors
///
/// Returns `Err(String)` when the project is not found or archived.
#[tauri::command]
#[specta::specta]
pub async fn projects_channels_reinfer(
    state: State<'_, AppState>,
    req: ProjectChannelsReinferRequest,
) -> Result<ProjectChannelsReinferResult, ContractError> {
    project_setup::reinfer_channels(state.repo.pool(), &state.bus, &req).await
}

// ── projects.channels.dismiss_drift ──────────────────────────────────────────

/// `projects.channels.dismiss_drift` — dismiss the channel drift banner.
///
/// # Errors
///
/// Returns `Err(String)` when the project is not found.
#[tauri::command]
#[specta::specta]
pub async fn projects_channels_dismiss_drift(
    state: State<'_, AppState>,
    req: ProjectChannelsDismissDriftRequest,
) -> Result<ProjectChannelsDismissDriftResult, ContractError> {
    project_setup::dismiss_drift(state.repo.pool(), &state.bus, &req).await
}

// ── projects.create_plan (stub retained for spec 025 compatibility) ───────────

/// `projects.create_plan` — create a filesystem plan from wizard state.
///
/// This stub is retained for UI compatibility until spec 025 folder-plan
/// integration is wired into `project_setup::create`. The real flow will
/// build on `domain_core::lifecycle::plan::FilesystemPlan` +
/// `persistence_db::repositories::plans` and return a live `PlanDetail`.
///
/// # Errors
///
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta]
pub async fn projects_create_plan(wizard_state: JsonAny) -> Result<PlanDetail, ContractError> {
    tracing::debug!("stub: projects.create_plan wizard_state={wizard_state:?}");
    Ok(PlanDetail {
        id: "plan-new-001".to_owned(),
        number: 1,
        title: "Create project folder structure".to_owned(),
        origin: PlanOrigin::Project,
        origin_path: None,
        state: PlanState::ReadyForReview,
        plan_type: PlanType::SourceMap,
        destructive_destination: DestructiveDestination::Archive,
        parent_plan_id: None,
        items_total: 2,
        items_applied: 0,
        items_failed: 0,
        items_skipped: 0,
        items_cancelled: 0,
        items_pending: 2,
        total_bytes_required: 0,
        approved_at: None,
        discarded_at: None,
        created_at: "2026-05-25T12:00:00Z".to_owned(),
        items: vec![
            PlanItemDetail {
                id: "item-001".to_owned(),
                index: 1,
                name: "project_folder".to_owned(),
                action: PlanItemAction::Link,
                from: String::new(),
                to: "projects/new_project".to_owned(),
                reason: "Create project folder".to_owned(),
                protection: PlanItemProtection::Normal,
                linked: None,
                state: PlanItemState::Pending,
                failure_reason: None,
                provenance: None,
                approved_mtime: None,
                approved_size_bytes: None,
                archive_path: None,
            },
            PlanItemDetail {
                id: "item-002".to_owned(),
                index: 2,
                name: ".astro-plan-project.json".to_owned(),
                action: PlanItemAction::Link,
                from: String::new(),
                to: "projects/new_project/.astro-plan-project.json".to_owned(),
                reason: "Write project marker file".to_owned(),
                protection: PlanItemProtection::Normal,
                linked: None,
                state: PlanItemState::Pending,
                failure_reason: None,
                provenance: None,
                approved_mtime: None,
                approved_size_bytes: None,
                archive_path: None,
            },
        ],
    })
}
