// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Repository methods for equipment management (spec 030, T016).
//!
//! CRUD operations for cameras, telescopes, optical trains, and filters.
//! Operates on `cameras`, `telescopes`, `optical_trains`, and `filters`
//! tables (migration 0007).

use domain_core::equipment::{
    Camera, CreateCamera, CreateFilter, CreateOpticalTrain, CreateTelescope, Filter,
    FilterCategory, OpticalTrain, SensorType, Telescope, UpdateCamera, UpdateFilter,
    UpdateOpticalTrain, UpdateTelescope,
};
use domain_core::ids::Timestamp;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{DbError, DbResult};

// ── Helpers ─────────────────────────────────────────────────────────────────

fn category_to_str(cat: FilterCategory) -> &'static str {
    match cat {
        FilterCategory::Narrowband => "narrowband",
        FilterCategory::Broadband => "broadband",
        FilterCategory::DualBand => "dual_band",
        FilterCategory::Other => "other",
        FilterCategory::Custom => "custom",
    }
}

fn str_to_category(s: &str) -> FilterCategory {
    match s {
        "narrowband" => FilterCategory::Narrowband,
        "broadband" => FilterCategory::Broadband,
        "dual_band" => FilterCategory::DualBand,
        "custom" => FilterCategory::Custom,
        // "other" and any unknown value default to Other.
        _ => FilterCategory::Other,
    }
}

// Camera sensor type (spec 044 iteration 2026-07-15, FR-035/migration 0066):
// stored as TEXT 'mono'|'osc'; NULL/unknown values read back as None so
// unknown always behaves as mono downstream (FR-038).
fn sensor_type_to_str(sensor: SensorType) -> &'static str {
    match sensor {
        SensorType::Mono => "mono",
        SensorType::Osc => "osc",
    }
}

fn str_to_sensor_type(s: &str) -> Option<SensorType> {
    match s {
        "mono" => Some(SensorType::Mono),
        "osc" => Some(SensorType::Osc),
        _ => None,
    }
}

/// Passband is stored like `aliases`: a JSON string array (`["Ha","OIII"]`);
/// NULL = plain color camera ('rgb' default, FR-035).
fn parse_passband(json_str: Option<&str>) -> Option<Vec<String>> {
    json_str.and_then(|s| serde_json::from_str(s).ok())
}

fn parse_aliases(json_str: &str) -> Vec<String> {
    serde_json::from_str(json_str).unwrap_or_default()
}

fn encode_aliases(aliases: &[String]) -> String {
    serde_json::to_string(aliases).unwrap_or_else(|_| "[]".to_owned())
}

/// Shared NotFound-check for every `update_*`/`delete_*` below: all four
/// entity kinds (Camera/Telescope/OpticalTrain/Filter) key their mutation on
/// `id` and treat "no row touched" as `DbError::NotFound`.
fn ensure_row_affected(rows_affected: u64, entity: &str, id: &str) -> DbResult<()> {
    if rows_affected == 0 {
        return Err(DbError::NotFound(format!("{entity} {id} not found")));
    }
    Ok(())
}

// ── Camera ──────────────────────────────────────────────────────────────────

/// List all cameras.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_cameras(pool: &SqlitePool) -> DbResult<Vec<Camera>> {
    let rows: Vec<(String, String, String, i32, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, name, aliases, auto_detected, sensor_type, passband FROM cameras ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, aliases, auto_detected, sensor_type, passband)| Camera {
            id,
            name,
            aliases: parse_aliases(&aliases),
            auto_detected: auto_detected != 0,
            sensor_type: sensor_type.as_deref().and_then(str_to_sensor_type),
            passband: parse_passband(passband.as_deref()),
        })
        .collect())
}

/// Create a new camera.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation.
pub async fn create_camera(pool: &SqlitePool, req: &CreateCamera) -> DbResult<Camera> {
    let id = Uuid::new_v4().to_string();
    let aliases_json = encode_aliases(&req.aliases);
    let created_at = Timestamp::now_iso();
    let sensor_type_str = req.sensor_type.map(sensor_type_to_str);
    let passband_json = req.passband.as_deref().map(encode_aliases);

    sqlx::query(
        "INSERT INTO cameras (id, name, aliases, auto_detected, created_at, sensor_type, passband) VALUES (?, ?, ?, 0, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&req.name)
    .bind(&aliases_json)
    .bind(&created_at)
    .bind(sensor_type_str)
    .bind(&passband_json)
    .execute(pool)
    .await?;

    Ok(Camera {
        id,
        name: req.name.clone(),
        aliases: req.aliases.clone(),
        auto_detected: false,
        sensor_type: req.sensor_type,
        passband: req.passband.clone(),
    })
}

/// Update an existing camera.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn update_camera(pool: &SqlitePool, req: &UpdateCamera) -> DbResult<Camera> {
    let aliases_json = encode_aliases(&req.aliases);
    let sensor_type_str = req.sensor_type.map(sensor_type_to_str);
    let passband_json = req.passband.as_deref().map(encode_aliases);

    let result = sqlx::query(
        "UPDATE cameras SET name = ?, aliases = ?, sensor_type = ?, passband = ? WHERE id = ?",
    )
    .bind(&req.name)
    .bind(&aliases_json)
    .bind(sensor_type_str)
    .bind(&passband_json)
    .bind(&req.id)
    .execute(pool)
    .await?;

    ensure_row_affected(result.rows_affected(), "camera", &req.id)?;

    // Fetch the full row to return auto_detected.
    let row: (i32,) = sqlx::query_as("SELECT auto_detected FROM cameras WHERE id = ?")
        .bind(&req.id)
        .fetch_one(pool)
        .await?;

    Ok(Camera {
        id: req.id.clone(),
        name: req.name.clone(),
        aliases: req.aliases.clone(),
        auto_detected: row.0 != 0,
        sensor_type: req.sensor_type,
        passband: req.passband.clone(),
    })
}

/// Delete a camera by ID.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn delete_camera(pool: &SqlitePool, id: &str) -> DbResult<()> {
    let result = sqlx::query("DELETE FROM cameras WHERE id = ?").bind(id).execute(pool).await?;

    ensure_row_affected(result.rows_affected(), "camera", id)
}

/// Find a camera by alias. Searches the JSON aliases array using LIKE.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn find_camera_by_alias(pool: &SqlitePool, alias: &str) -> DbResult<Option<Camera>> {
    // SQLite JSON: search for the alias string within the aliases JSON array.
    // We use json_each to properly match exact alias values.
    let row: Option<(String, String, String, i32, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT c.id, c.name, c.aliases, c.auto_detected, c.sensor_type, c.passband \
             FROM cameras c, json_each(c.aliases) j \
             WHERE j.value = ? \
             LIMIT 1",
        )
        .bind(alias)
        .fetch_optional(pool)
        .await?;

    Ok(row.map(|(id, name, aliases, auto_detected, sensor_type, passband)| Camera {
        id,
        name,
        aliases: parse_aliases(&aliases),
        auto_detected: auto_detected != 0,
        sensor_type: sensor_type.as_deref().and_then(str_to_sensor_type),
        passband: parse_passband(passband.as_deref()),
    }))
}

// ── Telescope ───────────────────────────────────────────────────────────────

/// List all telescopes.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_telescopes(pool: &SqlitePool) -> DbResult<Vec<Telescope>> {
    let rows: Vec<(String, String, String, Option<i32>, i32)> = sqlx::query_as(
        "SELECT id, name, aliases, focal_length_mm, auto_detected FROM telescopes ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, aliases, focal_length_mm, auto_detected)| Telescope {
            id,
            name,
            aliases: parse_aliases(&aliases),
            focal_length_mm,
            auto_detected: auto_detected != 0,
        })
        .collect())
}

/// Create a new telescope.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation.
pub async fn create_telescope(pool: &SqlitePool, req: &CreateTelescope) -> DbResult<Telescope> {
    let id = Uuid::new_v4().to_string();
    let aliases_json = encode_aliases(&req.aliases);
    let created_at = Timestamp::now_iso();

    sqlx::query(
        "INSERT INTO telescopes (id, name, aliases, focal_length_mm, auto_detected, created_at) \
         VALUES (?, ?, ?, ?, 0, ?)",
    )
    .bind(&id)
    .bind(&req.name)
    .bind(&aliases_json)
    .bind(req.focal_length_mm)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(Telescope {
        id,
        name: req.name.clone(),
        aliases: req.aliases.clone(),
        focal_length_mm: req.focal_length_mm,
        auto_detected: false,
    })
}

/// Update an existing telescope.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn update_telescope(pool: &SqlitePool, req: &UpdateTelescope) -> DbResult<Telescope> {
    let aliases_json = encode_aliases(&req.aliases);

    let result = sqlx::query(
        "UPDATE telescopes SET name = ?, aliases = ?, focal_length_mm = ? WHERE id = ?",
    )
    .bind(&req.name)
    .bind(&aliases_json)
    .bind(req.focal_length_mm)
    .bind(&req.id)
    .execute(pool)
    .await?;

    ensure_row_affected(result.rows_affected(), "telescope", &req.id)?;

    let row: (i32,) = sqlx::query_as("SELECT auto_detected FROM telescopes WHERE id = ?")
        .bind(&req.id)
        .fetch_one(pool)
        .await?;

    Ok(Telescope {
        id: req.id.clone(),
        name: req.name.clone(),
        aliases: req.aliases.clone(),
        focal_length_mm: req.focal_length_mm,
        auto_detected: row.0 != 0,
    })
}

/// Delete a telescope by ID.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn delete_telescope(pool: &SqlitePool, id: &str) -> DbResult<()> {
    let result = sqlx::query("DELETE FROM telescopes WHERE id = ?").bind(id).execute(pool).await?;

    ensure_row_affected(result.rows_affected(), "telescope", id)
}

/// Find a telescope by alias. Searches the JSON aliases array.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn find_telescope_by_alias(
    pool: &SqlitePool,
    alias: &str,
) -> DbResult<Option<Telescope>> {
    let row: Option<(String, String, String, Option<i32>, i32)> = sqlx::query_as(
        "SELECT t.id, t.name, t.aliases, t.focal_length_mm, t.auto_detected \
         FROM telescopes t, json_each(t.aliases) j \
         WHERE j.value = ? \
         LIMIT 1",
    )
    .bind(alias)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, name, aliases, focal_length_mm, auto_detected)| Telescope {
        id,
        name,
        aliases: parse_aliases(&aliases),
        focal_length_mm,
        auto_detected: auto_detected != 0,
    }))
}

// ── Optical Train ───────────────────────────────────────────────────────────

/// List all optical trains.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_optical_trains(pool: &SqlitePool) -> DbResult<Vec<OpticalTrain>> {
    let rows: Vec<(String, String, Option<String>, Option<String>, i32)> = sqlx::query_as(
        "SELECT id, name, telescope_id, camera_id, focal_length_mm \
         FROM optical_trains ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, telescope_id, camera_id, focal_length_mm)| OpticalTrain {
            id,
            name,
            telescope_id,
            camera_id,
            focal_length_mm,
        })
        .collect())
}

/// Create a new optical train.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation.
pub async fn create_optical_train(
    pool: &SqlitePool,
    req: &CreateOpticalTrain,
) -> DbResult<OpticalTrain> {
    let id = Uuid::new_v4().to_string();
    let created_at = Timestamp::now_iso();

    sqlx::query(
        "INSERT INTO optical_trains (id, name, telescope_id, camera_id, focal_length_mm, created_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&req.name)
    .bind(&req.telescope_id)
    .bind(&req.camera_id)
    .bind(req.focal_length_mm)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(OpticalTrain {
        id,
        name: req.name.clone(),
        telescope_id: req.telescope_id.clone(),
        camera_id: req.camera_id.clone(),
        focal_length_mm: req.focal_length_mm,
    })
}

/// Update an existing optical train.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn update_optical_train(
    pool: &SqlitePool,
    req: &UpdateOpticalTrain,
) -> DbResult<OpticalTrain> {
    let result = sqlx::query(
        "UPDATE optical_trains SET name = ?, telescope_id = ?, camera_id = ?, focal_length_mm = ? \
         WHERE id = ?",
    )
    .bind(&req.name)
    .bind(&req.telescope_id)
    .bind(&req.camera_id)
    .bind(req.focal_length_mm)
    .bind(&req.id)
    .execute(pool)
    .await?;

    ensure_row_affected(result.rows_affected(), "optical train", &req.id)?;

    Ok(OpticalTrain {
        id: req.id.clone(),
        name: req.name.clone(),
        telescope_id: req.telescope_id.clone(),
        camera_id: req.camera_id.clone(),
        focal_length_mm: req.focal_length_mm,
    })
}

/// Delete an optical train by ID.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn delete_optical_train(pool: &SqlitePool, id: &str) -> DbResult<()> {
    let result =
        sqlx::query("DELETE FROM optical_trains WHERE id = ?").bind(id).execute(pool).await?;

    ensure_row_affected(result.rows_affected(), "optical train", id)
}

// ── Filter ──────────────────────────────────────────────────────────────────

/// List all filters.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_filters(pool: &SqlitePool) -> DbResult<Vec<Filter>> {
    let rows: Vec<(String, String, String, i32)> =
        sqlx::query_as("SELECT id, name, category, auto_detected FROM filters ORDER BY name ASC")
            .fetch_all(pool)
            .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, category, auto_detected)| Filter {
            id,
            name,
            category: str_to_category(&category),
            auto_detected: auto_detected != 0,
        })
        .collect())
}

/// Create a new filter.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation (e.g. duplicate name).
pub async fn create_filter(pool: &SqlitePool, req: &CreateFilter) -> DbResult<Filter> {
    let id = Uuid::new_v4().to_string();
    let category_str = category_to_str(req.category);
    let created_at = Timestamp::now_iso();

    sqlx::query(
        "INSERT INTO filters (id, name, category, auto_detected, created_at) VALUES (?, ?, ?, 0, ?)",
    )
    .bind(&id)
    .bind(&req.name)
    .bind(category_str)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(Filter { id, name: req.name.clone(), category: req.category, auto_detected: false })
}

/// Update an existing filter.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn update_filter(pool: &SqlitePool, req: &UpdateFilter) -> DbResult<Filter> {
    let category_str = category_to_str(req.category);

    let result = sqlx::query("UPDATE filters SET name = ?, category = ? WHERE id = ?")
        .bind(&req.name)
        .bind(category_str)
        .bind(&req.id)
        .execute(pool)
        .await?;

    ensure_row_affected(result.rows_affected(), "filter", &req.id)?;

    let row: (i32,) = sqlx::query_as("SELECT auto_detected FROM filters WHERE id = ?")
        .bind(&req.id)
        .fetch_one(pool)
        .await?;

    Ok(Filter {
        id: req.id.clone(),
        name: req.name.clone(),
        category: req.category,
        auto_detected: row.0 != 0,
    })
}

/// Delete a filter by ID.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn delete_filter(pool: &SqlitePool, id: &str) -> DbResult<()> {
    let result = sqlx::query("DELETE FROM filters WHERE id = ?").bind(id).execute(pool).await?;

    ensure_row_affected(result.rows_affected(), "filter", id)
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use domain_core::equipment::{
        CreateCamera, CreateFilter, CreateOpticalTrain, CreateTelescope, FilterCategory,
        UpdateCamera, UpdateFilter, UpdateOpticalTrain, UpdateTelescope,
    };
    use sqlx::SqlitePool;

    use super::*;
    use crate::Database;

    async fn setup_db() -> SqlitePool {
        let db = Database::in_memory().await.expect("in-memory connect");
        db.migrate().await.expect("migrations");
        db.pool().clone()
    }

    // ── Camera tests ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn camera_crud() {
        let pool = setup_db().await;

        let camera = create_camera(
            &pool,
            &CreateCamera {
                name: "ASI2600MM".to_owned(),
                aliases: vec!["ZWO 2600".to_owned()],
                sensor_type: None,
                passband: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(camera.name, "ASI2600MM");
        assert!(!camera.auto_detected);
        // FR-038: sensor type is unknown until the user sets it.
        assert_eq!(camera.sensor_type, None);
        assert_eq!(camera.passband, None);

        let all = list_cameras(&pool).await.unwrap();
        assert_eq!(all.len(), 1);

        // FR-035 round-trip: set OSC + a dual-band passband on update.
        let updated = update_camera(
            &pool,
            &UpdateCamera {
                id: camera.id.clone(),
                name: "ASI2600MM Pro".to_owned(),
                aliases: vec!["ZWO 2600".to_owned(), "ASI2600".to_owned()],
                sensor_type: Some(SensorType::Osc),
                passband: Some(vec!["Ha".to_owned(), "OIII".to_owned()]),
            },
        )
        .await
        .unwrap();
        assert_eq!(updated.name, "ASI2600MM Pro");
        assert_eq!(updated.aliases.len(), 2);
        assert_eq!(updated.sensor_type, Some(SensorType::Osc));
        assert_eq!(updated.passband, Some(vec!["Ha".to_owned(), "OIII".to_owned()]));

        // The persisted row (not just the returned DTO) carries the fields.
        let listed = list_cameras(&pool).await.unwrap();
        assert_eq!(listed[0].sensor_type, Some(SensorType::Osc));
        assert_eq!(listed[0].passband, Some(vec!["Ha".to_owned(), "OIII".to_owned()]));

        delete_camera(&pool, &camera.id).await.unwrap();
        assert!(list_cameras(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn camera_find_by_alias() {
        let pool = setup_db().await;

        create_camera(
            &pool,
            &CreateCamera {
                name: "ASI2600MM".to_owned(),
                aliases: vec!["ZWO 2600".to_owned(), "ASI2600".to_owned()],
                sensor_type: None,
                passband: None,
            },
        )
        .await
        .unwrap();

        let found = find_camera_by_alias(&pool, "ZWO 2600").await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "ASI2600MM");

        let not_found = find_camera_by_alias(&pool, "nonexistent").await.unwrap();
        assert!(not_found.is_none());
    }

    #[tokio::test]
    async fn camera_delete_nonexistent() {
        let pool = setup_db().await;
        let result = delete_camera(&pool, "nonexistent").await;
        assert!(result.is_err());
    }

    /// `aliases` is a named graceful-degradation site (spec `n4_jsoncodec`,
    /// duplication-and-abstraction-audit.md T2-d): a row with a corrupt
    /// `aliases` cell (hand-edited DB) must still list, with an empty
    /// alias list, not fail the whole query.
    #[tokio::test]
    async fn list_cameras_degrades_on_corrupt_aliases_cell() {
        let pool = setup_db().await;
        sqlx::query(
            "INSERT INTO cameras (id, name, aliases, auto_detected, created_at) \
             VALUES ('cam-corrupt', 'Corrupt Cam', 'not valid json', 0, '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let cameras = list_cameras(&pool).await.unwrap();
        let corrupt = cameras.iter().find(|c| c.id == "cam-corrupt").expect("row present");
        assert!(corrupt.aliases.is_empty(), "corrupt aliases cell must degrade, not error");
    }

    // ── Telescope tests ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn telescope_crud() {
        let pool = setup_db().await;

        let scope = create_telescope(
            &pool,
            &CreateTelescope {
                name: "Esprit 100ED".to_owned(),
                aliases: vec!["SW Esprit".to_owned()],
                focal_length_mm: Some(550),
            },
        )
        .await
        .unwrap();
        assert_eq!(scope.name, "Esprit 100ED");
        assert_eq!(scope.focal_length_mm, Some(550));

        let updated = update_telescope(
            &pool,
            &UpdateTelescope {
                id: scope.id.clone(),
                name: "Esprit 100ED f/5.5".to_owned(),
                aliases: vec!["SW Esprit".to_owned()],
                focal_length_mm: Some(550),
            },
        )
        .await
        .unwrap();
        assert_eq!(updated.name, "Esprit 100ED f/5.5");

        delete_telescope(&pool, &scope.id).await.unwrap();
        assert!(list_telescopes(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn telescope_find_by_alias() {
        let pool = setup_db().await;

        create_telescope(
            &pool,
            &CreateTelescope {
                name: "Esprit 100ED".to_owned(),
                aliases: vec!["SW Esprit".to_owned()],
                focal_length_mm: Some(550),
            },
        )
        .await
        .unwrap();

        let found = find_telescope_by_alias(&pool, "SW Esprit").await.unwrap();
        assert!(found.is_some());

        let not_found = find_telescope_by_alias(&pool, "missing").await.unwrap();
        assert!(not_found.is_none());
    }

    // ── Optical Train tests ─────────────────────────────────────────────────

    #[tokio::test]
    async fn optical_train_crud() {
        let pool = setup_db().await;

        let train = create_optical_train(
            &pool,
            &CreateOpticalTrain {
                name: "Main imaging".to_owned(),
                telescope_id: None,
                camera_id: None,
                focal_length_mm: 550,
            },
        )
        .await
        .unwrap();
        assert_eq!(train.name, "Main imaging");
        assert_eq!(train.focal_length_mm, 550);

        let updated = update_optical_train(
            &pool,
            &UpdateOpticalTrain {
                id: train.id.clone(),
                name: "Main imaging (updated)".to_owned(),
                telescope_id: None,
                camera_id: None,
                focal_length_mm: 600,
            },
        )
        .await
        .unwrap();
        assert_eq!(updated.focal_length_mm, 600);

        delete_optical_train(&pool, &train.id).await.unwrap();
        assert!(list_optical_trains(&pool).await.unwrap().is_empty());
    }

    // ── Filter tests ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn filter_crud() {
        let pool = setup_db().await;

        // The migration seeds predefined filters; count them.
        let seeded = list_filters(&pool).await.unwrap();
        let initial_count = seeded.len();
        assert!(initial_count > 0, "migration should seed predefined filters");

        let filter = create_filter(
            &pool,
            &CreateFilter { name: "Custom UV".to_owned(), category: FilterCategory::Custom },
        )
        .await
        .unwrap();
        assert_eq!(filter.category, FilterCategory::Custom);

        let updated = update_filter(
            &pool,
            &UpdateFilter {
                id: filter.id.clone(),
                name: "Custom UV-IR".to_owned(),
                category: FilterCategory::Other,
            },
        )
        .await
        .unwrap();
        assert_eq!(updated.name, "Custom UV-IR");
        assert_eq!(updated.category, FilterCategory::Other);

        delete_filter(&pool, &filter.id).await.unwrap();
        let after = list_filters(&pool).await.unwrap();
        assert_eq!(after.len(), initial_count);
    }
}
