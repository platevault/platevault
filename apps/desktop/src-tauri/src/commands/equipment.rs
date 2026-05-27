//! Spec 030 equipment Tauri commands (T018).
//!
//! CRUD commands for cameras, telescopes, optical trains, and filters.
//! Delegates to `app_core::equipment` use cases.

use contracts_core::equipment::{
    Camera, CreateCamera, CreateFilter, CreateOpticalTrain, CreateTelescope, Filter, OpticalTrain,
    Telescope, UpdateCamera, UpdateFilter, UpdateOpticalTrain, UpdateTelescope,
};
use tauri::State;

use crate::commands::lifecycle::AppState;

// ── Camera commands ─────────────────────────────────────────────────────────

/// `equipment.cameras.list` — list all cameras.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "equipment.cameras.list")]
pub async fn equipment_cameras_list(state: State<'_, AppState>) -> Result<Vec<Camera>, String> {
    tracing::debug!("equipment.cameras.list");
    app_core::equipment::list_cameras(state.repo.pool()).await.map_err(|e| e.message)
}

/// `equipment.cameras.create` — create a new camera.
///
/// # Errors
/// Returns `Err(String)` on duplicate or database failure.
#[tauri::command]
#[specta::specta(rename = "equipment.cameras.create")]
pub async fn equipment_cameras_create(
    state: State<'_, AppState>,
    request: CreateCamera,
) -> Result<Camera, String> {
    tracing::debug!("equipment.cameras.create name={}", request.name);
    app_core::equipment::create_camera(state.repo.pool(), &request).await.map_err(|e| e.message)
}

/// `equipment.cameras.update` — update an existing camera.
///
/// # Errors
/// Returns `Err(String)` if the camera is not found.
#[tauri::command]
#[specta::specta(rename = "equipment.cameras.update")]
pub async fn equipment_cameras_update(
    state: State<'_, AppState>,
    request: UpdateCamera,
) -> Result<Camera, String> {
    tracing::debug!("equipment.cameras.update id={}", request.id);
    app_core::equipment::update_camera(state.repo.pool(), &request).await.map_err(|e| e.message)
}

/// `equipment.cameras.delete` — delete a camera by ID.
///
/// # Errors
/// Returns `Err(String)` if the camera is not found.
#[tauri::command]
#[specta::specta(rename = "equipment.cameras.delete")]
pub async fn equipment_cameras_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    tracing::debug!("equipment.cameras.delete id={id}");
    app_core::equipment::delete_camera(state.repo.pool(), &id).await.map_err(|e| e.message)
}

// ── Telescope commands ──────────────────────────────────────────────────────

/// `equipment.telescopes.list` — list all telescopes.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "equipment.telescopes.list")]
pub async fn equipment_telescopes_list(
    state: State<'_, AppState>,
) -> Result<Vec<Telescope>, String> {
    tracing::debug!("equipment.telescopes.list");
    app_core::equipment::list_telescopes(state.repo.pool()).await.map_err(|e| e.message)
}

/// `equipment.telescopes.create` — create a new telescope.
///
/// # Errors
/// Returns `Err(String)` on duplicate or database failure.
#[tauri::command]
#[specta::specta(rename = "equipment.telescopes.create")]
pub async fn equipment_telescopes_create(
    state: State<'_, AppState>,
    request: CreateTelescope,
) -> Result<Telescope, String> {
    tracing::debug!("equipment.telescopes.create name={}", request.name);
    app_core::equipment::create_telescope(state.repo.pool(), &request).await.map_err(|e| e.message)
}

/// `equipment.telescopes.update` — update an existing telescope.
///
/// # Errors
/// Returns `Err(String)` if the telescope is not found.
#[tauri::command]
#[specta::specta(rename = "equipment.telescopes.update")]
pub async fn equipment_telescopes_update(
    state: State<'_, AppState>,
    request: UpdateTelescope,
) -> Result<Telescope, String> {
    tracing::debug!("equipment.telescopes.update id={}", request.id);
    app_core::equipment::update_telescope(state.repo.pool(), &request).await.map_err(|e| e.message)
}

/// `equipment.telescopes.delete` — delete a telescope by ID.
///
/// # Errors
/// Returns `Err(String)` if the telescope is not found.
#[tauri::command]
#[specta::specta(rename = "equipment.telescopes.delete")]
pub async fn equipment_telescopes_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    tracing::debug!("equipment.telescopes.delete id={id}");
    app_core::equipment::delete_telescope(state.repo.pool(), &id).await.map_err(|e| e.message)
}

// ── Optical Train commands ──────────────────────────────────────────────────

/// `equipment.trains.list` — list all optical trains.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "equipment.trains.list")]
pub async fn equipment_trains_list(
    state: State<'_, AppState>,
) -> Result<Vec<OpticalTrain>, String> {
    tracing::debug!("equipment.trains.list");
    app_core::equipment::list_optical_trains(state.repo.pool()).await.map_err(|e| e.message)
}

/// `equipment.trains.create` — create a new optical train.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "equipment.trains.create")]
pub async fn equipment_trains_create(
    state: State<'_, AppState>,
    request: CreateOpticalTrain,
) -> Result<OpticalTrain, String> {
    tracing::debug!("equipment.trains.create name={}", request.name);
    app_core::equipment::create_optical_train(state.repo.pool(), &request)
        .await
        .map_err(|e| e.message)
}

/// `equipment.trains.update` — update an existing optical train.
///
/// # Errors
/// Returns `Err(String)` if the optical train is not found.
#[tauri::command]
#[specta::specta(rename = "equipment.trains.update")]
pub async fn equipment_trains_update(
    state: State<'_, AppState>,
    request: UpdateOpticalTrain,
) -> Result<OpticalTrain, String> {
    tracing::debug!("equipment.trains.update id={}", request.id);
    app_core::equipment::update_optical_train(state.repo.pool(), &request)
        .await
        .map_err(|e| e.message)
}

/// `equipment.trains.delete` — delete an optical train by ID.
///
/// # Errors
/// Returns `Err(String)` if the optical train is not found.
#[tauri::command]
#[specta::specta(rename = "equipment.trains.delete")]
pub async fn equipment_trains_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    tracing::debug!("equipment.trains.delete id={id}");
    app_core::equipment::delete_optical_train(state.repo.pool(), &id).await.map_err(|e| e.message)
}

// ── Filter commands ─────────────────────────────────────────────────────────

/// `equipment.filters.list` — list all filters.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta(rename = "equipment.filters.list")]
pub async fn equipment_filters_list(state: State<'_, AppState>) -> Result<Vec<Filter>, String> {
    tracing::debug!("equipment.filters.list");
    app_core::equipment::list_filters(state.repo.pool()).await.map_err(|e| e.message)
}

/// `equipment.filters.create` — create a new filter.
///
/// # Errors
/// Returns `Err(String)` on duplicate name or database failure.
#[tauri::command]
#[specta::specta(rename = "equipment.filters.create")]
pub async fn equipment_filters_create(
    state: State<'_, AppState>,
    request: CreateFilter,
) -> Result<Filter, String> {
    tracing::debug!("equipment.filters.create name={}", request.name);
    app_core::equipment::create_filter(state.repo.pool(), &request).await.map_err(|e| e.message)
}

/// `equipment.filters.update` — update an existing filter.
///
/// # Errors
/// Returns `Err(String)` if the filter is not found.
#[tauri::command]
#[specta::specta(rename = "equipment.filters.update")]
pub async fn equipment_filters_update(
    state: State<'_, AppState>,
    request: UpdateFilter,
) -> Result<Filter, String> {
    tracing::debug!("equipment.filters.update id={}", request.id);
    app_core::equipment::update_filter(state.repo.pool(), &request).await.map_err(|e| e.message)
}

/// `equipment.filters.delete` — delete a filter by ID.
///
/// # Errors
/// Returns `Err(String)` if the filter is not found.
#[tauri::command]
#[specta::specta(rename = "equipment.filters.delete")]
pub async fn equipment_filters_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    tracing::debug!("equipment.filters.delete id={id}");
    app_core::equipment::delete_filter(state.repo.pool(), &id).await.map_err(|e| e.message)
}
