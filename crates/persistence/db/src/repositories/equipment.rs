//! Repository methods for equipment management (spec 030, T016).
//!
//! CRUD operations for cameras, telescopes, optical trains, and filters.
//! Operates on `cameras`, `telescopes`, `optical_trains`, and `filters`
//! tables (migration 0007).

use contracts_core::equipment::{
    Camera, CreateCamera, CreateFilter, CreateOpticalTrain, CreateTelescope, Filter,
    FilterCategory, OpticalTrain, Telescope, UpdateCamera, UpdateFilter, UpdateOpticalTrain,
    UpdateTelescope,
};
use sqlx::SqlitePool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{DbError, DbResult};

// ── Helpers ─────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

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
        "other" => FilterCategory::Other,
        "custom" => FilterCategory::Custom,
        _ => FilterCategory::Other,
    }
}

fn parse_aliases(json_str: &str) -> Vec<String> {
    serde_json::from_str(json_str).unwrap_or_default()
}

fn encode_aliases(aliases: &[String]) -> String {
    serde_json::to_string(aliases).unwrap_or_else(|_| "[]".to_owned())
}

// ── Camera ──────────────────────────────────────────────────────────────────

/// List all cameras.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_cameras(pool: &SqlitePool) -> DbResult<Vec<Camera>> {
    let rows: Vec<(String, String, String, i32)> =
        sqlx::query_as("SELECT id, name, aliases, auto_detected FROM cameras ORDER BY name ASC")
            .fetch_all(pool)
            .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, aliases, auto_detected)| Camera {
            id,
            name,
            aliases: parse_aliases(&aliases),
            auto_detected: auto_detected != 0,
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
    let created_at = now_iso();

    sqlx::query(
        "INSERT INTO cameras (id, name, aliases, auto_detected, created_at) VALUES (?, ?, ?, 0, ?)",
    )
    .bind(&id)
    .bind(&req.name)
    .bind(&aliases_json)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(Camera { id, name: req.name.clone(), aliases: req.aliases.clone(), auto_detected: false })
}

/// Update an existing camera.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn update_camera(pool: &SqlitePool, req: &UpdateCamera) -> DbResult<Camera> {
    let aliases_json = encode_aliases(&req.aliases);

    let result = sqlx::query("UPDATE cameras SET name = ?, aliases = ? WHERE id = ?")
        .bind(&req.name)
        .bind(&aliases_json)
        .bind(&req.id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("camera {} not found", req.id)));
    }

    // Fetch the full row to return auto_detected.
    let row: (i32,) =
        sqlx::query_as("SELECT auto_detected FROM cameras WHERE id = ?")
            .bind(&req.id)
            .fetch_one(pool)
            .await?;

    Ok(Camera {
        id: req.id.clone(),
        name: req.name.clone(),
        aliases: req.aliases.clone(),
        auto_detected: row.0 != 0,
    })
}

/// Delete a camera by ID.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] if the ID does not exist.
pub async fn delete_camera(pool: &SqlitePool, id: &str) -> DbResult<()> {
    let result =
        sqlx::query("DELETE FROM cameras WHERE id = ?").bind(id).execute(pool).await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("camera {id} not found")));
    }

    Ok(())
}

/// Find a camera by alias. Searches the JSON aliases array using LIKE.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn find_camera_by_alias(pool: &SqlitePool, alias: &str) -> DbResult<Option<Camera>> {
    // SQLite JSON: search for the alias string within the aliases JSON array.
    // We use json_each to properly match exact alias values.
    let row: Option<(String, String, String, i32)> = sqlx::query_as(
        "SELECT c.id, c.name, c.aliases, c.auto_detected \
         FROM cameras c, json_each(c.aliases) j \
         WHERE j.value = ? \
         LIMIT 1",
    )
    .bind(alias)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, name, aliases, auto_detected)| Camera {
        id,
        name,
        aliases: parse_aliases(&aliases),
        auto_detected: auto_detected != 0,
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
    let created_at = now_iso();

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

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("telescope {} not found", req.id)));
    }

    let row: (i32,) =
        sqlx::query_as("SELECT auto_detected FROM telescopes WHERE id = ?")
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
    let result =
        sqlx::query("DELETE FROM telescopes WHERE id = ?").bind(id).execute(pool).await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("telescope {id} not found")));
    }

    Ok(())
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
    let created_at = now_iso();

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

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("optical train {} not found", req.id)));
    }

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

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("optical train {id} not found")));
    }

    Ok(())
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
    let created_at = now_iso();

    sqlx::query(
        "INSERT INTO filters (id, name, category, auto_detected, created_at) VALUES (?, ?, ?, 0, ?)",
    )
    .bind(&id)
    .bind(&req.name)
    .bind(category_str)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(Filter {
        id,
        name: req.name.clone(),
        category: req.category,
        auto_detected: false,
    })
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

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("filter {} not found", req.id)));
    }

    let row: (i32,) =
        sqlx::query_as("SELECT auto_detected FROM filters WHERE id = ?")
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
    let result =
        sqlx::query("DELETE FROM filters WHERE id = ?").bind(id).execute(pool).await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("filter {id} not found")));
    }

    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use contracts_core::equipment::{
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
            &CreateCamera { name: "ASI2600MM".to_owned(), aliases: vec!["ZWO 2600".to_owned()] },
        )
        .await
        .unwrap();
        assert_eq!(camera.name, "ASI2600MM");
        assert!(!camera.auto_detected);

        let all = list_cameras(&pool).await.unwrap();
        assert_eq!(all.len(), 1);

        let updated = update_camera(
            &pool,
            &UpdateCamera {
                id: camera.id.clone(),
                name: "ASI2600MM Pro".to_owned(),
                aliases: vec!["ZWO 2600".to_owned(), "ASI2600".to_owned()],
            },
        )
        .await
        .unwrap();
        assert_eq!(updated.name, "ASI2600MM Pro");
        assert_eq!(updated.aliases.len(), 2);

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
