// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Equipment use cases (spec 030, T017).
//!
//! CRUD orchestration for cameras, telescopes, optical trains, and filters.
//! Includes `find_or_create_by_alias` for auto-detection workflows where
//! equipment seen in FITS headers is created on demand.

use audit::bus::EventBus;
use audit::event_bus::Source;
use audit::{AuditLogEntry, Outcome, Severity};
use contracts_core::equipment::{
    Camera, CreateCamera, CreateFilter, CreateOpticalTrain, CreateTelescope, Filter,
    FilterCategory, OpticalTrain, Telescope, UpdateCamera, UpdateFilter, UpdateOpticalTrain,
    UpdateTelescope,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
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

/// Render an `ErrorCode` as its dotted wire string, for use as an audit
/// `reason_code`.
fn error_code_str(code: ErrorCode) -> String {
    serde_json::to_string(&code)
        .map_or_else(|_| "internal.error".to_owned(), |s| s.trim_matches('"').to_owned())
}

/// Deterministic `entity_id` for an equipment audit row: parses `id` as a
/// real UUID when possible (every persisted camera/telescope/train/filter id
/// is one), falling back to a stable UUIDv5 derivation for attempted-but-not-
/// yet-created items (e.g. a failed `create` has no id) so repeated attempts
/// with the same name still correlate under one `entity_id`.
fn equipment_entity_id(id: &str) -> EntityId {
    uuid::Uuid::parse_str(id).map_or_else(
        |_| {
            let ns = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, b"astro-plan.audit.equipment");
            EntityId::from_uuid(uuid::Uuid::new_v5(&ns, id.as_bytes()))
        },
        EntityId::from_uuid,
    )
}

/// Write a durable audit row for an equipment CRUD attempt (T124,
/// FR-130/FR-131). `id_seed` is the item's real id on success/update/delete,
/// or its attempted `name` on a failed `create` (no id exists yet). User-
/// initiated CRUD is `actor="user"`/`Severity::Workflow` per the data-model
/// severity table; see [`write_equipment_system_audit`] for the
/// system-initiated auto-detect variant.
async fn write_equipment_audit(
    bus: &EventBus,
    action: &str,
    id_seed: &str,
    outcome: Outcome,
    reason_code: Option<&str>,
    payload: serde_json::Value,
) -> Result<(), ContractError> {
    write_equipment_audit_as(
        bus,
        "user",
        Severity::Workflow,
        Source::User,
        action,
        id_seed,
        outcome,
        reason_code,
        payload,
    )
    .await
}

/// System-initiated variant of [`write_equipment_audit`] for auto-detect
/// creates (`find_or_create_*_by_alias`/`_by_name`) — `actor="system"`,
/// `Severity::Diagnostic` per data-model.md's severity-per-mutation-class
/// table (review round 1 #4: "system/periodic = diagnostic").
async fn write_equipment_system_audit(
    bus: &EventBus,
    action: &str,
    id_seed: &str,
    outcome: Outcome,
    reason_code: Option<&str>,
    payload: serde_json::Value,
) -> Result<(), ContractError> {
    write_equipment_audit_as(
        bus,
        "system",
        Severity::Diagnostic,
        Source::System,
        action,
        id_seed,
        outcome,
        reason_code,
        payload,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn write_equipment_audit_as(
    bus: &EventBus,
    actor: &str,
    severity: Severity,
    source: Source,
    action: &str,
    id_seed: &str,
    outcome: Outcome,
    reason_code: Option<&str>,
    payload: serde_json::Value,
) -> Result<(), ContractError> {
    let mut entry = AuditLogEntry::new(
        EntityType::Equipment,
        equipment_entity_id(id_seed),
        action,
        actor,
        outcome,
        severity,
        EntityId::new(),
    )
    .with_payload(payload);
    if let Some(code) = reason_code {
        entry = entry.with_reason_code(code.to_owned());
    }
    bus.write_audit(
        entry,
        "equipment.changed",
        source,
        serde_json::json!({"action": action, "outcome": outcome.as_str()}),
    )
    .await
    .map_err(|e| {
        ContractError::new(ErrorCode::InternalDatabase, e.to_string(), ErrorSeverity::Fatal, true)
    })?;
    Ok(())
}

/// Shared `delete_*` tail: audits `result` (already run against the repo)
/// as `Applied`/`Failed`, then returns it as a `ContractError` result. All
/// four equipment kinds share the same `(pool, id) -> DbResult<()>` delete
/// shape, so this is the one place that maps outcome → audit row for all of
/// them (T124).
async fn delete_equipment(
    bus: &EventBus,
    action: &str,
    id: &str,
    result: Result<(), persistence_db::DbError>,
) -> Result<(), ContractError> {
    match result {
        Ok(()) => {
            write_equipment_audit(bus, action, id, Outcome::Applied, None, serde_json::json!({}))
                .await?;
            Ok(())
        }
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_audit(
                bus,
                action,
                id,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({}),
            )
            .await?;
            Err(err)
        }
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

/// Resolve a raw fingerprint equipment string (as captured from a FITS
/// header) to the registered camera's user-facing name.
///
/// Matching is case- and surrounding-whitespace-insensitive against each
/// camera's name and its aliases: capture programs write the same physical
/// camera with differing case and spacing, and `find_or_create_camera_by_alias`
/// stores whichever spelling was seen first.
///
/// Returns `None` when no registered camera claims the string, so callers fall
/// back to the raw value instead of synthesizing an absent one (Q16 / FR-136).
#[must_use]
pub fn resolve_camera_display_name(cameras: &[Camera], raw: &str) -> Option<String> {
    let needle = raw.trim();
    if needle.is_empty() {
        return None;
    }
    cameras
        .iter()
        .find(|c| {
            std::iter::once(&c.name)
                .chain(c.aliases.iter())
                .any(|candidate| candidate.trim().eq_ignore_ascii_case(needle))
        })
        .map(|c| c.name.clone())
}

/// Create a new camera.
///
/// # Errors
///
/// Returns `ContractError` on duplicate or database failure.
pub async fn create_camera(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &CreateCamera,
) -> Result<Camera, ContractError> {
    match repo::create_camera(pool, req).await {
        Ok(camera) => {
            write_equipment_audit(
                bus,
                "equipment.camera.create",
                &camera.id,
                Outcome::Applied,
                None,
                serde_json::json!({"name": camera.name}),
            )
            .await?;
            // The masters snapshot embeds resolved camera names, so a new
            // camera can change how an already-cached fingerprint renders.
            crate::caches::invalidate_calibration_masters();
            Ok(camera)
        }
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_audit(
                bus,
                "equipment.camera.create",
                &req.name,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": req.name}),
            )
            .await?;
            Err(err)
        }
    }
}

/// Update an existing camera.
///
/// # Errors
///
/// Returns `ContractError` if the camera is not found.
pub async fn update_camera(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &UpdateCamera,
) -> Result<Camera, ContractError> {
    match repo::update_camera(pool, req).await {
        Ok(camera) => {
            write_equipment_audit(
                bus,
                "equipment.camera.update",
                &camera.id,
                Outcome::Applied,
                None,
                serde_json::json!({"name": camera.name}),
            )
            .await?;
            // A rename changes every master fingerprint that resolves to this
            // camera; the cached snapshot would otherwise serve the old name.
            crate::caches::invalidate_calibration_masters();
            Ok(camera)
        }
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_audit(
                bus,
                "equipment.camera.update",
                &req.id,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": req.name}),
            )
            .await?;
            Err(err)
        }
    }
}

/// Delete a camera by ID.
///
/// # Errors
///
/// Returns `ContractError` if the camera is not found.
pub async fn delete_camera(
    pool: &SqlitePool,
    bus: &EventBus,
    id: &str,
) -> Result<(), ContractError> {
    delete_equipment(bus, "equipment.camera.delete", id, repo::delete_camera(pool, id).await)
        .await?;
    // Master fingerprints that resolved to this camera revert to their raw
    // header string.
    crate::caches::invalidate_calibration_masters();
    Ok(())
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
    bus: &EventBus,
    alias: &str,
) -> Result<Camera, ContractError> {
    if let Some(camera) = repo::find_camera_by_alias(pool, alias).await.map_err(db_to_contract)? {
        return Ok(camera);
    }

    // Create as auto-detected — the alias becomes both the name and the sole
    // alias. Sensor type stays unknown (= mono behavior, FR-038) until the
    // user sets it in Settings → Equipment.
    let req = CreateCamera {
        name: alias.to_owned(),
        aliases: vec![alias.to_owned()],
        sensor_type: None,
        passband: None,
    };
    let mut camera = match repo::create_camera(pool, &req).await {
        Ok(camera) => camera,
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_system_audit(
                bus,
                "equipment.camera.create",
                alias,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": alias, "autoDetected": true}),
            )
            .await?;
            return Err(err);
        }
    };
    camera.auto_detected = true;

    // Mark auto_detected in the database.
    q_calibration::mark_camera_auto_detected(pool, &camera.id).await.map_err(db_to_contract)?;

    // Review round 1 #4: auto-detect creates a durable equipment row via a
    // system-initiated mutation — audited at Severity::Diagnostic (data-model
    // severity table), not Severity::Workflow like explicit user CRUD.
    write_equipment_system_audit(
        bus,
        "equipment.camera.create",
        &camera.id,
        Outcome::Applied,
        None,
        serde_json::json!({"name": camera.name, "autoDetected": true}),
    )
    .await?;

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
    bus: &EventBus,
    req: &CreateTelescope,
) -> Result<Telescope, ContractError> {
    match repo::create_telescope(pool, req).await {
        Ok(scope) => {
            write_equipment_audit(
                bus,
                "equipment.telescope.create",
                &scope.id,
                Outcome::Applied,
                None,
                serde_json::json!({"name": scope.name}),
            )
            .await?;
            Ok(scope)
        }
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_audit(
                bus,
                "equipment.telescope.create",
                &req.name,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": req.name}),
            )
            .await?;
            Err(err)
        }
    }
}

/// Update an existing telescope.
///
/// # Errors
///
/// Returns `ContractError` if the telescope is not found.
pub async fn update_telescope(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &UpdateTelescope,
) -> Result<Telescope, ContractError> {
    match repo::update_telescope(pool, req).await {
        Ok(scope) => {
            write_equipment_audit(
                bus,
                "equipment.telescope.update",
                &scope.id,
                Outcome::Applied,
                None,
                serde_json::json!({"name": scope.name}),
            )
            .await?;
            Ok(scope)
        }
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_audit(
                bus,
                "equipment.telescope.update",
                &req.id,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": req.name}),
            )
            .await?;
            Err(err)
        }
    }
}

/// Delete a telescope by ID.
///
/// # Errors
///
/// Returns `ContractError` if the telescope is not found.
pub async fn delete_telescope(
    pool: &SqlitePool,
    bus: &EventBus,
    id: &str,
) -> Result<(), ContractError> {
    delete_equipment(bus, "equipment.telescope.delete", id, repo::delete_telescope(pool, id).await)
        .await
}

/// Find a telescope by alias, or create one if not found.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn find_or_create_telescope_by_alias(
    pool: &SqlitePool,
    bus: &EventBus,
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
    let mut scope = match repo::create_telescope(pool, &req).await {
        Ok(scope) => scope,
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_system_audit(
                bus,
                "equipment.telescope.create",
                alias,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": alias, "autoDetected": true}),
            )
            .await?;
            return Err(err);
        }
    };
    scope.auto_detected = true;

    q_calibration::mark_telescope_auto_detected(pool, &scope.id).await.map_err(db_to_contract)?;

    write_equipment_system_audit(
        bus,
        "equipment.telescope.create",
        &scope.id,
        Outcome::Applied,
        None,
        serde_json::json!({"name": scope.name, "autoDetected": true}),
    )
    .await?;

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
    bus: &EventBus,
    req: &CreateOpticalTrain,
) -> Result<OpticalTrain, ContractError> {
    match repo::create_optical_train(pool, req).await {
        Ok(train) => {
            write_equipment_audit(
                bus,
                "equipment.train.create",
                &train.id,
                Outcome::Applied,
                None,
                serde_json::json!({"name": train.name}),
            )
            .await?;
            Ok(train)
        }
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_audit(
                bus,
                "equipment.train.create",
                &req.name,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": req.name}),
            )
            .await?;
            Err(err)
        }
    }
}

/// Update an existing optical train.
///
/// # Errors
///
/// Returns `ContractError` if the optical train is not found.
pub async fn update_optical_train(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &UpdateOpticalTrain,
) -> Result<OpticalTrain, ContractError> {
    match repo::update_optical_train(pool, req).await {
        Ok(train) => {
            write_equipment_audit(
                bus,
                "equipment.train.update",
                &train.id,
                Outcome::Applied,
                None,
                serde_json::json!({"name": train.name}),
            )
            .await?;
            Ok(train)
        }
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_audit(
                bus,
                "equipment.train.update",
                &req.id,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({}),
            )
            .await?;
            Err(err)
        }
    }
}

/// Delete an optical train by ID.
///
/// # Errors
///
/// Returns `ContractError` if the optical train is not found.
pub async fn delete_optical_train(
    pool: &SqlitePool,
    bus: &EventBus,
    id: &str,
) -> Result<(), ContractError> {
    delete_equipment(bus, "equipment.train.delete", id, repo::delete_optical_train(pool, id).await)
        .await
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
pub async fn create_filter(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &CreateFilter,
) -> Result<Filter, ContractError> {
    match repo::create_filter(pool, req).await {
        Ok(filter) => {
            write_equipment_audit(
                bus,
                "equipment.filter.create",
                &filter.id,
                Outcome::Applied,
                None,
                serde_json::json!({"name": filter.name}),
            )
            .await?;
            Ok(filter)
        }
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_audit(
                bus,
                "equipment.filter.create",
                &req.name,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": req.name}),
            )
            .await?;
            Err(err)
        }
    }
}

/// Update an existing filter.
///
/// # Errors
///
/// Returns `ContractError` if the filter is not found.
pub async fn update_filter(
    pool: &SqlitePool,
    bus: &EventBus,
    req: &UpdateFilter,
) -> Result<Filter, ContractError> {
    match repo::update_filter(pool, req).await {
        Ok(filter) => {
            write_equipment_audit(
                bus,
                "equipment.filter.update",
                &filter.id,
                Outcome::Applied,
                None,
                serde_json::json!({"name": filter.name}),
            )
            .await?;
            Ok(filter)
        }
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_audit(
                bus,
                "equipment.filter.update",
                &req.id,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": req.name}),
            )
            .await?;
            Err(err)
        }
    }
}

/// Delete a filter by ID.
///
/// # Errors
///
/// Returns `ContractError` if the filter is not found.
pub async fn delete_filter(
    pool: &SqlitePool,
    bus: &EventBus,
    id: &str,
) -> Result<(), ContractError> {
    delete_equipment(bus, "equipment.filter.delete", id, repo::delete_filter(pool, id).await).await
}

/// Find a filter by exact name match, or create one as auto-detected custom.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn find_or_create_filter_by_name(
    pool: &SqlitePool,
    bus: &EventBus,
    name: &str,
) -> Result<Filter, ContractError> {
    // Try exact name match in the existing list.
    let filters = repo::list_filters(pool).await.map_err(db_to_contract)?;
    if let Some(filter) = filters.into_iter().find(|f| f.name == name) {
        return Ok(filter);
    }

    // Create as auto-detected custom filter.
    let req = CreateFilter { name: name.to_owned(), category: FilterCategory::Custom };
    let mut filter = match repo::create_filter(pool, &req).await {
        Ok(filter) => filter,
        Err(e) => {
            let err = db_to_contract(e);
            write_equipment_system_audit(
                bus,
                "equipment.filter.create",
                name,
                Outcome::Failed,
                Some(&error_code_str(err.code)),
                serde_json::json!({"name": name, "autoDetected": true}),
            )
            .await?;
            return Err(err);
        }
    };
    filter.auto_detected = true;

    q_calibration::mark_filter_auto_detected(pool, &filter.id).await.map_err(db_to_contract)?;

    write_equipment_system_audit(
        bus,
        "equipment.filter.create",
        &filter.id,
        Outcome::Applied,
        None,
        serde_json::json!({"name": filter.name, "autoDetected": true}),
    )
    .await?;

    Ok(filter)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;

    async fn setup() -> (Database, EventBus) {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    fn camera(name: &str, aliases: &[&str]) -> Camera {
        Camera {
            id: "cam-1".to_owned(),
            name: name.to_owned(),
            aliases: aliases.iter().map(|a| (*a).to_owned()).collect(),
            auto_detected: false,
            sensor_type: None,
            passband: None,
        }
    }

    /// #879: an alias hit resolves to the camera's user-facing name.
    #[test]
    fn resolve_camera_display_name_maps_alias_to_registered_name() {
        let cams = vec![camera("Main Imaging Rig", &["ASI2600MM"])];
        assert_eq!(
            resolve_camera_display_name(&cams, "ASI2600MM"),
            Some("Main Imaging Rig".to_owned())
        );
    }

    /// #879: the camera's own name resolves too, not only its aliases.
    #[test]
    fn resolve_camera_display_name_matches_the_name_itself() {
        let cams = vec![camera("ZWO ASI2600MM", &[])];
        assert_eq!(
            resolve_camera_display_name(&cams, "ZWO ASI2600MM"),
            Some("ZWO ASI2600MM".to_owned())
        );
    }

    /// #879: capture programs differ in case and padding for one camera.
    #[test]
    fn resolve_camera_display_name_ignores_case_and_surrounding_whitespace() {
        let cams = vec![camera("Main Imaging Rig", &["ASI2600MM"])];
        assert_eq!(
            resolve_camera_display_name(&cams, " asi2600mm  "),
            Some("Main Imaging Rig".to_owned())
        );
    }

    /// #879: unknown and blank strings stay unresolved so callers can fall
    /// back to the raw header value rather than inventing a name.
    #[test]
    fn resolve_camera_display_name_returns_none_when_unclaimed_or_blank() {
        let cams = vec![camera("Main Imaging Rig", &["ASI2600MM"])];
        assert_eq!(resolve_camera_display_name(&cams, "Some Other Cam"), None);
        assert_eq!(resolve_camera_display_name(&cams, "   "), None);
        assert_eq!(resolve_camera_display_name(&[], "ASI2600MM"), None);
    }

    /// T124/SC-009: `create_camera` writes a durable `Outcome::Applied`
    /// `audit_log_entry` row tagged `EntityType::Equipment` (previously no
    /// audit emission at all).
    #[tokio::test]
    async fn create_camera_writes_durable_applied_audit_row() {
        let (db, bus) = setup().await;
        let req = CreateCamera {
            name: "ZWO ASI2600MM".to_owned(),
            aliases: vec![],
            sensor_type: None,
            passband: None,
        };
        let camera = create_camera(db.pool(), &bus, &req).await.unwrap();

        let row: (String, String) = sqlx::query_as(
            "SELECT entity_type, outcome FROM audit_log_entry WHERE trigger = 'equipment.camera.create'",
        )
        .fetch_one(db.pool())
        .await
        .expect("create_camera must write a durable audit row");
        assert_eq!(row.0, "equipment");
        assert_eq!(row.1, "applied");
        assert!(!camera.id.is_empty());
    }

    /// T127 "equipment failed": deleting a nonexistent camera writes a
    /// durable `Outcome::Failed` row with a reason_code (FR-130).
    #[tokio::test]
    async fn delete_camera_missing_writes_durable_failed_row() {
        let (db, bus) = setup().await;
        let err = delete_camera(db.pool(), &bus, "does-not-exist").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::EquipmentNotFound);

        let row: (String, String, Option<String>) = sqlx::query_as(
            "SELECT entity_type, outcome, reason_code FROM audit_log_entry WHERE trigger = 'equipment.camera.delete'",
        )
        .fetch_one(db.pool())
        .await
        .expect("failed delete_camera must write a durable audit row");
        assert_eq!(row.0, "equipment");
        assert_eq!(row.1, "failed");
        assert_eq!(row.2.as_deref(), Some("equipment.not_found"));
    }

    /// Review round 1 #4: `find_or_create_camera_by_alias` auto-detect create
    /// writes a durable row at `Severity::Diagnostic` with `actor="system"`
    /// (system-initiated), not `Severity::Workflow`/`"user"` like explicit
    /// CRUD (data-model.md severity-per-mutation-class table).
    #[tokio::test]
    async fn find_or_create_camera_by_alias_writes_diagnostic_system_audit_row() {
        let (db, bus) = setup().await;
        let camera =
            find_or_create_camera_by_alias(db.pool(), &bus, "ASI294MM Auto").await.unwrap();
        assert!(camera.auto_detected);

        let row: (String, String, String) = sqlx::query_as(
            "SELECT actor, severity, outcome FROM audit_log_entry WHERE trigger = 'equipment.camera.create'",
        )
        .fetch_one(db.pool())
        .await
        .expect("find_or_create_camera_by_alias must write a durable audit row");
        assert_eq!(row.0, "system");
        assert_eq!(row.1, "diagnostic");
        assert_eq!(row.2, "applied");
    }

    /// Update/delete round trip for optical trains and filters, spot-checking
    /// that every equipment kind (not just cameras) writes durable rows.
    #[tokio::test]
    async fn optical_train_and_filter_crud_write_durable_rows() {
        let (db, bus) = setup().await;

        let train = create_optical_train(
            db.pool(),
            &bus,
            &CreateOpticalTrain {
                name: "Main rig".to_owned(),
                telescope_id: None,
                camera_id: None,
                focal_length_mm: 800,
            },
        )
        .await
        .unwrap();
        delete_optical_train(db.pool(), &bus, &train.id).await.unwrap();

        // "Custom-Ha-7nm"/"Custom-Ha-3nm": migration 0007 seeds standard names
        // ("Ha", "SII", "L", ...); avoid colliding with the seeded rows.
        let filter = create_filter(
            db.pool(),
            &bus,
            &CreateFilter {
                name: "Custom-Ha-7nm".to_owned(),
                category: FilterCategory::Narrowband,
            },
        )
        .await
        .unwrap();
        update_filter(
            db.pool(),
            &bus,
            &UpdateFilter {
                id: filter.id.clone(),
                name: "Custom-Ha-3nm".to_owned(),
                category: FilterCategory::Narrowband,
            },
        )
        .await
        .unwrap();

        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM audit_log_entry WHERE entity_type = 'equipment' AND outcome = 'applied'",
        )
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(count.0, 4, "create+delete train and create+update filter = 4 applied rows");
    }
}
