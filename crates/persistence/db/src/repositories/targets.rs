//! Repository methods for spec 013 target identity tables.
//!
//! Operates on `targets`, `target_catalog_refs`, and `catalog_equivalences`
//! from migration 0017.

use sqlx::SqlitePool;
use time::OffsetDateTime;

use crate::{DbError, DbResult};

// ── Row types ─────────────────────────────────────────────────────────────────

/// Stored row from the `targets` table.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TargetRow {
    pub id: String,
    pub primary_designation: String,
    pub created_at: String,
}

/// Stored row from `target_catalog_refs`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogRefRow {
    pub target_id: String,
    pub catalog_id: String,
    pub catalog_display: String,
    pub designation: String,
}

/// Stored row from `catalog_equivalences`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EquivalenceRow {
    pub id: String,
    pub canonical_target_id: String,
    pub catalog_id: String,
    pub designation: String,
    pub is_primary: bool,
    pub created_at: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

// ── targets ───────────────────────────────────────────────────────────────────

/// List all target rows ordered by primary designation.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_targets(pool: &SqlitePool) -> DbResult<Vec<TargetRow>> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, primary_designation, created_at
         FROM targets
         ORDER BY primary_designation ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, primary_designation, created_at)| TargetRow {
            id,
            primary_designation,
            created_at,
        })
        .collect())
}

/// Get a single target row by id.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] when no row exists.
/// Returns [`DbError::Database`] on query failure.
pub async fn get_target(pool: &SqlitePool, id: &str) -> DbResult<TargetRow> {
    let row: Option<(String, String, String)> =
        sqlx::query_as("SELECT id, primary_designation, created_at FROM targets WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;

    match row {
        None => Err(DbError::NotFound(format!("target '{id}'"))),
        Some((id, primary_designation, created_at)) => {
            Ok(TargetRow { id, primary_designation, created_at })
        }
    }
}

/// Upsert a target row (insert or update on conflict by id).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn upsert_target(pool: &SqlitePool, row: &TargetRow) -> DbResult<()> {
    let created_at = if row.created_at.is_empty() { now_iso() } else { row.created_at.clone() };

    sqlx::query(
        "INSERT INTO targets (id, primary_designation, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
             primary_designation = excluded.primary_designation",
    )
    .bind(&row.id)
    .bind(&row.primary_designation)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(())
}

/// Return the count of target rows.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn count_targets(pool: &SqlitePool) -> DbResult<i64> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM targets").fetch_one(pool).await?;
    Ok(count)
}

// ── target_catalog_refs ───────────────────────────────────────────────────────

/// List all catalog ref rows for a given target.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_catalog_refs(pool: &SqlitePool, target_id: &str) -> DbResult<Vec<CatalogRefRow>> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT target_id, catalog_id, catalog_display, designation
         FROM target_catalog_refs
         WHERE target_id = ?
         ORDER BY catalog_id ASC",
    )
    .bind(target_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(target_id, catalog_id, catalog_display, designation)| CatalogRefRow {
            target_id,
            catalog_id,
            catalog_display,
            designation,
        })
        .collect())
}

/// List all catalog ref rows across all targets.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_all_catalog_refs(pool: &SqlitePool) -> DbResult<Vec<CatalogRefRow>> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT target_id, catalog_id, catalog_display, designation
         FROM target_catalog_refs
         ORDER BY catalog_id ASC, designation ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(target_id, catalog_id, catalog_display, designation)| CatalogRefRow {
            target_id,
            catalog_id,
            catalog_display,
            designation,
        })
        .collect())
}

/// Upsert a catalog ref row (insert or ignore on conflict by catalog_id + designation).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn upsert_catalog_ref(pool: &SqlitePool, row: &CatalogRefRow) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO target_catalog_refs (target_id, catalog_id, catalog_display, designation)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(catalog_id, designation) DO UPDATE SET
             target_id       = excluded.target_id,
             catalog_display = excluded.catalog_display",
    )
    .bind(&row.target_id)
    .bind(&row.catalog_id)
    .bind(&row.catalog_display)
    .bind(&row.designation)
    .execute(pool)
    .await?;

    Ok(())
}

// ── catalog_equivalences ──────────────────────────────────────────────────────

/// List all equivalence rows ordered by canonical_target_id then catalog_id.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_equivalences(pool: &SqlitePool) -> DbResult<Vec<EquivalenceRow>> {
    let rows: Vec<(String, String, String, String, i64, String)> = sqlx::query_as(
        "SELECT id, canonical_target_id, catalog_id, designation, is_primary, created_at
         FROM catalog_equivalences
         ORDER BY canonical_target_id ASC, catalog_id ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, canonical_target_id, catalog_id, designation, is_primary, created_at)| {
            EquivalenceRow {
                id,
                canonical_target_id,
                catalog_id,
                designation,
                is_primary: is_primary != 0,
                created_at,
            }
        })
        .collect())
}

/// Upsert an equivalence row (insert or update on conflict by catalog_id + designation).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn upsert_equivalence(pool: &SqlitePool, row: &EquivalenceRow) -> DbResult<()> {
    let created_at = if row.created_at.is_empty() { now_iso() } else { row.created_at.clone() };
    let is_primary = i64::from(row.is_primary);

    sqlx::query(
        "INSERT INTO catalog_equivalences
             (id, canonical_target_id, catalog_id, designation, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(catalog_id, designation) DO UPDATE SET
             canonical_target_id = excluded.canonical_target_id,
             is_primary          = excluded.is_primary",
    )
    .bind(&row.id)
    .bind(&row.canonical_target_id)
    .bind(&row.catalog_id)
    .bind(&row.designation)
    .bind(is_primary)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(())
}

/// Return the count of equivalence rows.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn count_equivalences(pool: &SqlitePool) -> DbResult<i64> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM catalog_equivalences").fetch_one(pool).await?;
    Ok(count)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    fn m31_target() -> TargetRow {
        TargetRow {
            id: "550e8400-e29b-41d4-a716-446655440099".into(),
            primary_designation: "M 31".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn m31_messier_ref() -> CatalogRefRow {
        CatalogRefRow {
            target_id: "550e8400-e29b-41d4-a716-446655440099".into(),
            catalog_id: "messier".into(),
            catalog_display: "Messier".into(),
            designation: "M31".into(),
        }
    }

    fn m31_equivalence() -> EquivalenceRow {
        EquivalenceRow {
            id: "660e8400-e29b-41d4-a716-446655440001".into(),
            canonical_target_id: "550e8400-e29b-41d4-a716-446655440099".into(),
            catalog_id: "messier".into(),
            designation: "M31".into(),
            is_primary: true,
            created_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[tokio::test]
    async fn list_targets_returns_empty_initially() {
        let db = setup().await;
        let rows = list_targets(db.pool()).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn upsert_and_list_target() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        let rows = list_targets(db.pool()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].primary_designation, "M 31");
    }

    #[tokio::test]
    async fn upsert_target_updates_designation_on_conflict() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        let updated = TargetRow { primary_designation: "Andromeda Galaxy".into(), ..m31_target() };
        upsert_target(db.pool(), &updated).await.unwrap();
        let rows = list_targets(db.pool()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].primary_designation, "Andromeda Galaxy");
    }

    #[tokio::test]
    async fn get_target_returns_not_found_for_unknown_id() {
        let db = setup().await;
        let result = get_target(db.pool(), "no-such-id").await;
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    #[tokio::test]
    async fn get_target_returns_row_by_id() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        let row = get_target(db.pool(), &m31_target().id).await.unwrap();
        assert_eq!(row.primary_designation, "M 31");
    }

    #[tokio::test]
    async fn count_targets_reflects_inserts() {
        let db = setup().await;
        assert_eq!(count_targets(db.pool()).await.unwrap(), 0);
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        assert_eq!(count_targets(db.pool()).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn upsert_and_list_catalog_ref() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        upsert_catalog_ref(db.pool(), &m31_messier_ref()).await.unwrap();
        let refs = list_catalog_refs(db.pool(), &m31_target().id).await.unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].designation, "M31");
    }

    #[tokio::test]
    async fn list_all_catalog_refs_returns_all() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        upsert_catalog_ref(db.pool(), &m31_messier_ref()).await.unwrap();
        let ngc_ref = CatalogRefRow {
            catalog_id: "openngc".into(),
            catalog_display: "OpenNGC".into(),
            designation: "NGC 224".into(),
            ..m31_messier_ref()
        };
        upsert_catalog_ref(db.pool(), &ngc_ref).await.unwrap();
        let all = list_all_catalog_refs(db.pool()).await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn upsert_and_list_equivalence() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        upsert_equivalence(db.pool(), &m31_equivalence()).await.unwrap();
        let rows = list_equivalences(db.pool()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].is_primary);
    }

    #[tokio::test]
    async fn equivalence_upsert_is_idempotent() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        upsert_equivalence(db.pool(), &m31_equivalence()).await.unwrap();
        upsert_equivalence(db.pool(), &m31_equivalence()).await.unwrap();
        assert_eq!(count_equivalences(db.pool()).await.unwrap(), 1);
    }
}
