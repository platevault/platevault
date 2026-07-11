//! Equipment use cases (spec 030, T017).
//!
//! CRUD orchestration for cameras, telescopes, optical trains, and filters.
//! Includes `find_or_create_by_alias` for auto-detection workflows where
//! equipment seen in FITS headers is created on demand.

use contracts_core::equipment::{
    Camera, CreateCamera, CreateFilter, CreateOpticalTrain, CreateTelescope, Filter,
    FilterCategory, OpticalTrain, Telescope, UpdateCamera, UpdateFilter, UpdateOpticalTrain,
    UpdateTelescope,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use persistence_db::repositories::equipment as repo;
use persistence_db::repositories::q_calibration;
use sqlx::SqlitePool;

// ── Error mapping ──────────────────────────────────────────────────────────

fn db_to_contract(e: persistence_db::DbError) -> ContractError {
    let msg = e.to_string();
    drop(e);
    if msg.contains("not found") {
        ContractError::new(ErrorCode::EquipmentNotFound, msg, ErrorSeverity::Blocking, false)
    } else if msg.contains("UNIQUE constraint failed") {
        ContractError::new(ErrorCode::EquipmentDuplicate, msg, ErrorSeverity::Warning, false)
    } else {
        ContractError::new(ErrorCode::InternalDatabase, msg, ErrorSeverity::Fatal, true)
    }
}

// ── Camera use cases ───────────────────────────────────────────────────────

/// List all cameras.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list_cameras(pool: &SqlitePool) -> Result<Vec<Camera>, ContractError> {
    repo::list_cameras(pool).await.map_err(db_to_contract)
}

/// Create a new camera.
///
/// # Errors
///
/// Returns `ContractError` on duplicate or database failure.
pub async fn create_camera(pool: &SqlitePool, req: &CreateCamera) -> Result<Camera, ContractError> {
    repo::create_camera(pool, req).await.map_err(db_to_contract)
}

/// Update an existing camera.
///
/// # Errors
///
/// Returns `ContractError` if the camera is not found.
pub async fn update_camera(pool: &SqlitePool, req: &UpdateCamera) -> Result<Camera, ContractError> {
    repo::update_camera(pool, req).await.map_err(db_to_contract)
}

/// Delete a camera by ID.
///
/// # Errors
///
/// Returns `ContractError` if the camera is not found.
pub async fn delete_camera(pool: &SqlitePool, id: &str) -> Result<(), ContractError> {
    repo::delete_camera(pool, id).await.map_err(db_to_contract)
}

/// Find a camera by alias, or create one if not found.
///
/// Used by auto-detection workflows: when a FITS header names an instrument,
/// this either returns the matching camera or creates a new auto-detected one.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn find_or_create_camera_by_alias(
    pool: &SqlitePool,
    alias: &str,
) -> Result<Camera, ContractError> {
    if let Some(camera) = repo::find_camera_by_alias(pool, alias).await.map_err(db_to_contract)? {
        return Ok(camera);
    }

    // Create as auto-detected — the alias becomes both the name and the sole alias.
    let req = CreateCamera { name: alias.to_owned(), aliases: vec![alias.to_owned()] };
    let mut camera = repo::create_camera(pool, &req).await.map_err(db_to_contract)?;
    camera.auto_detected = true;

    // Mark auto_detected in the database.
    q_calibration::mark_camera_auto_detected(pool, &camera.id).await.map_err(db_to_contract)?;

    Ok(camera)
}

// ── Telescope use cases ────────────────────────────────────────────────────

/// List all telescopes.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list_telescopes(pool: &SqlitePool) -> Result<Vec<Telescope>, ContractError> {
    repo::list_telescopes(pool).await.map_err(db_to_contract)
}

/// Create a new telescope.
///
/// # Errors
///
/// Returns `ContractError` on duplicate or database failure.
pub async fn create_telescope(
    pool: &SqlitePool,
    req: &CreateTelescope,
) -> Result<Telescope, ContractError> {
    repo::create_telescope(pool, req).await.map_err(db_to_contract)
}

/// Update an existing telescope.
///
/// # Errors
///
/// Returns `ContractError` if the telescope is not found.
pub async fn update_telescope(
    pool: &SqlitePool,
    req: &UpdateTelescope,
) -> Result<Telescope, ContractError> {
    repo::update_telescope(pool, req).await.map_err(db_to_contract)
}

/// Delete a telescope by ID.
///
/// # Errors
///
/// Returns `ContractError` if the telescope is not found.
pub async fn delete_telescope(pool: &SqlitePool, id: &str) -> Result<(), ContractError> {
    repo::delete_telescope(pool, id).await.map_err(db_to_contract)
}

/// Find a telescope by alias, or create one if not found.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn find_or_create_telescope_by_alias(
    pool: &SqlitePool,
    alias: &str,
) -> Result<Telescope, ContractError> {
    if let Some(scope) = repo::find_telescope_by_alias(pool, alias).await.map_err(db_to_contract)? {
        return Ok(scope);
    }

    let req = CreateTelescope {
        name: alias.to_owned(),
        aliases: vec![alias.to_owned()],
        focal_length_mm: None,
    };
    let mut scope = repo::create_telescope(pool, &req).await.map_err(db_to_contract)?;
    scope.auto_detected = true;

    q_calibration::mark_telescope_auto_detected(pool, &scope.id).await.map_err(db_to_contract)?;

    Ok(scope)
}

// ── Optical Train use cases ────────────────────────────────────────────────

/// List all optical trains.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list_optical_trains(pool: &SqlitePool) -> Result<Vec<OpticalTrain>, ContractError> {
    repo::list_optical_trains(pool).await.map_err(db_to_contract)
}

/// Create a new optical train.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn create_optical_train(
    pool: &SqlitePool,
    req: &CreateOpticalTrain,
) -> Result<OpticalTrain, ContractError> {
    repo::create_optical_train(pool, req).await.map_err(db_to_contract)
}

/// Update an existing optical train.
///
/// # Errors
///
/// Returns `ContractError` if the optical train is not found.
pub async fn update_optical_train(
    pool: &SqlitePool,
    req: &UpdateOpticalTrain,
) -> Result<OpticalTrain, ContractError> {
    repo::update_optical_train(pool, req).await.map_err(db_to_contract)
}

/// Delete an optical train by ID.
///
/// # Errors
///
/// Returns `ContractError` if the optical train is not found.
pub async fn delete_optical_train(pool: &SqlitePool, id: &str) -> Result<(), ContractError> {
    repo::delete_optical_train(pool, id).await.map_err(db_to_contract)
}

// ── Filter use cases ───────────────────────────────────────────────────────

/// List all filters.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list_filters(pool: &SqlitePool) -> Result<Vec<Filter>, ContractError> {
    repo::list_filters(pool).await.map_err(db_to_contract)
}

/// Create a new filter.
///
/// # Errors
///
/// Returns `ContractError` on duplicate name or database failure.
pub async fn create_filter(pool: &SqlitePool, req: &CreateFilter) -> Result<Filter, ContractError> {
    repo::create_filter(pool, req).await.map_err(db_to_contract)
}

/// Update an existing filter.
///
/// # Errors
///
/// Returns `ContractError` if the filter is not found.
pub async fn update_filter(pool: &SqlitePool, req: &UpdateFilter) -> Result<Filter, ContractError> {
    repo::update_filter(pool, req).await.map_err(db_to_contract)
}

/// Delete a filter by ID.
///
/// # Errors
///
/// Returns `ContractError` if the filter is not found.
pub async fn delete_filter(pool: &SqlitePool, id: &str) -> Result<(), ContractError> {
    repo::delete_filter(pool, id).await.map_err(db_to_contract)
}

/// Find a filter by exact name match, or create one as auto-detected custom.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn find_or_create_filter_by_name(
    pool: &SqlitePool,
    name: &str,
) -> Result<Filter, ContractError> {
    // Try exact name match in the existing list.
    let filters = repo::list_filters(pool).await.map_err(db_to_contract)?;
    if let Some(filter) = filters.into_iter().find(|f| f.name == name) {
        return Ok(filter);
    }

    // Create as auto-detected custom filter.
    let req = CreateFilter { name: name.to_owned(), category: FilterCategory::Custom };
    let mut filter = repo::create_filter(pool, &req).await.map_err(db_to_contract)?;
    filter.auto_detected = true;

    q_calibration::mark_filter_auto_detected(pool, &filter.id).await.map_err(db_to_contract)?;

    Ok(filter)
}
