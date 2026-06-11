//! SQLite-backed catalog loader (spec 013, T004 + T005).
//!
//! Reads `targets`, `target_catalog_refs`, and `catalog_equivalences` rows
//! from SQLite into an in-memory [`TargetCatalog`]. Called at startup and
//! on `catalog.download.completed` events.
//!
//! The loader does NOT depend on real downloaded catalog files — only on the
//! SQLite rows seeded by the `catalog.download` flow (spec 014, T010-eq).

use std::collections::HashMap;

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::catalog::{CatalogEntry, CatalogId, CatalogRef, TargetCatalog};

/// Error type for catalog loading.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("catalog tables are empty — first-run catalog download not yet completed")]
    CatalogNotInstalled,
    #[error("failed to parse target uuid '{0}': {1}")]
    InvalidUuid(String, uuid::Error),
}

/// Load the in-memory [`TargetCatalog`] from the SQLite pool.
///
/// Returns `Ok(catalog)` with zero entries when the `targets` table is empty
/// (the `CatalogNotInstalled` sentinel is deferred to the use-case layer which
/// checks `catalog.is_empty()`).
///
/// # Errors
///
/// Returns [`LoadError::Database`] on any SQLite query failure.
pub async fn load_from_db(pool: &SqlitePool) -> Result<TargetCatalog, LoadError> {
    // Load all targets.
    let target_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, primary_designation FROM targets ORDER BY primary_designation ASC",
    )
    .fetch_all(pool)
    .await?;

    if target_rows.is_empty() {
        return Ok(TargetCatalog::new());
    }

    // Load all catalog refs.
    let ref_rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT target_id, catalog_id, catalog_display, designation
         FROM target_catalog_refs
         ORDER BY catalog_id ASC",
    )
    .fetch_all(pool)
    .await?;

    // Group refs by target_id.
    let mut refs_by_target: HashMap<String, Vec<CatalogRef>> = HashMap::new();
    for (target_id, catalog_id_str, catalog_display, designation) in ref_rows {
        let r = CatalogRef {
            catalog_id: CatalogId::from_slug(&catalog_id_str),
            catalog_display,
            designation,
        };
        refs_by_target.entry(target_id).or_default().push(r);
    }

    // Build entries, choosing the precedence-winning catalog for display.
    let mut entries = Vec::with_capacity(target_rows.len());
    for (id_str, primary_designation) in target_rows {
        let target_id =
            Uuid::parse_str(&id_str).map_err(|e| LoadError::InvalidUuid(id_str.clone(), e))?;

        let refs = refs_by_target.remove(&id_str).unwrap_or_default();

        // Pick the precedence-winning catalog ref for the display name.
        let primary_catalog_display = refs
            .iter()
            .min_by_key(|r| r.catalog_id.precedence())
            .map_or_else(|| "Unknown".to_owned(), |r| r.catalog_display.clone());

        entries.push(CatalogEntry {
            target_id,
            primary_designation,
            primary_catalog_display,
            refs,
        });
    }

    Ok(TargetCatalog::from_entries(entries))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ::persistence_db::repositories::targets as repo;
    use ::persistence_db::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    #[tokio::test]
    async fn load_empty_db_returns_empty_catalog() {
        let db = setup().await;
        let cat = load_from_db(db.pool()).await.unwrap();
        assert!(cat.is_empty());
    }

    #[tokio::test]
    async fn load_single_target_with_ref() {
        let db = setup().await;
        let target_id_str = crate::identity::target_id("messier", "M31").to_string();

        repo::upsert_target(
            db.pool(),
            &repo::TargetRow {
                id: target_id_str.clone(),
                primary_designation: "M 31".into(),
                created_at: "2026-01-01T00:00:00Z".into(),
            },
        )
        .await
        .unwrap();

        repo::upsert_catalog_ref(
            db.pool(),
            &repo::CatalogRefRow {
                target_id: target_id_str.clone(),
                catalog_id: "messier".into(),
                catalog_display: "Messier".into(),
                designation: "M31".into(),
            },
        )
        .await
        .unwrap();

        let cat = load_from_db(db.pool()).await.unwrap();
        assert_eq!(cat.len(), 1);

        let norm_m31 = crate::normalize::normalize("M31");
        let entry = cat.exact_lookup(&norm_m31).unwrap();
        assert_eq!(entry.primary_designation, "M 31");
    }

    #[tokio::test]
    async fn load_cross_catalog_equivalence_groups_aliases() {
        let db = setup().await;
        let tid = crate::identity::target_id("messier", "M31").to_string();

        repo::upsert_target(
            db.pool(),
            &repo::TargetRow {
                id: tid.clone(),
                primary_designation: "M 31".into(),
                created_at: "2026-01-01T00:00:00Z".into(),
            },
        )
        .await
        .unwrap();

        // Messier ref.
        repo::upsert_catalog_ref(
            db.pool(),
            &repo::CatalogRefRow {
                target_id: tid.clone(),
                catalog_id: "messier".into(),
                catalog_display: "Messier".into(),
                designation: "M31".into(),
            },
        )
        .await
        .unwrap();

        // OpenNGC ref.
        repo::upsert_catalog_ref(
            db.pool(),
            &repo::CatalogRefRow {
                target_id: tid.clone(),
                catalog_id: "openngc".into(),
                catalog_display: "OpenNGC".into(),
                designation: "NGC 224".into(),
            },
        )
        .await
        .unwrap();

        let cat = load_from_db(db.pool()).await.unwrap();

        let m31 = cat.exact_lookup(&crate::normalize::normalize("M31"));
        let ngc = cat.exact_lookup(&crate::normalize::normalize("NGC 224"));
        assert!(m31.is_some());
        assert!(ngc.is_some());
        assert_eq!(m31.unwrap().target_id, ngc.unwrap().target_id);
    }
}
