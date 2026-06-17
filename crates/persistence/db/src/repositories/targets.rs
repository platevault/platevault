//! Repository methods for spec 013 + spec 023 target identity tables.
//!
//! Operates on `targets`, `target_catalog_refs`, `catalog_equivalences`
//! (migration 0017) and `target_aliases` (migration 0027).
//!
//! Spec 023 additions:
//! - [`TargetRow`] gains `notes` and `updated_at` optional fields (migration 0027 columns).
//! - [`TargetAliasRow`] + CRUD helpers for `target_aliases`.
//! - [`update_target_notes`] — replace the per-target note body.
//! - [`update_target_primary`] — swap primary designation (provenance swap).
//! - [`get_target_full`] — fetch target + aliases + catalog refs in one call.

use sqlx::SqlitePool;
use time::OffsetDateTime;

use crate::{DbError, DbResult};

// ── Row types ─────────────────────────────────────────────────────────────────

/// Stored row from the `targets` table (spec 013 + spec 023 columns).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TargetRow {
    pub id: String,
    pub primary_designation: String,
    pub created_at: String,
    // spec 023 additions (migration 0027):
    pub notes: Option<String>,
    pub updated_at: Option<String>,
}

/// Stored row from `target_aliases` (migration 0027, spec 023).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TargetAliasRow {
    pub id: String,
    pub target_id: String,
    pub alias_display: String,
    pub alias_normalized: String,
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
    let rows: Vec<(String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, primary_designation, created_at, notes, updated_at
         FROM targets
         ORDER BY primary_designation ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, primary_designation, created_at, notes, updated_at)| TargetRow {
            id,
            primary_designation,
            created_at,
            notes,
            updated_at,
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
    let row: Option<(String, String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, primary_designation, created_at, notes, updated_at FROM targets WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    match row {
        None => Err(DbError::NotFound(format!("target '{id}'"))),
        Some((id, primary_designation, created_at, notes, updated_at)) => {
            Ok(TargetRow { id, primary_designation, created_at, notes, updated_at })
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
        "INSERT INTO targets (id, primary_designation, created_at, notes, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
             primary_designation = excluded.primary_designation,
             notes               = excluded.notes,
             updated_at          = excluded.updated_at",
    )
    .bind(&row.id)
    .bind(&row.primary_designation)
    .bind(&created_at)
    .bind(&row.notes)
    .bind(&row.updated_at)
    .execute(pool)
    .await?;

    Ok(())
}

/// Update only the `notes` and `updated_at` fields on a target row.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] when the target does not exist.
/// Returns [`DbError::Database`] on query failure.
pub async fn update_target_notes(
    pool: &SqlitePool,
    target_id: &str,
    notes: Option<&str>,
    updated_at: &str,
) -> DbResult<()> {
    let affected = sqlx::query("UPDATE targets SET notes = ?, updated_at = ? WHERE id = ?")
        .bind(notes)
        .bind(updated_at)
        .bind(target_id)
        .execute(pool)
        .await?
        .rows_affected();

    if affected == 0 {
        return Err(DbError::NotFound(format!("target '{target_id}'")));
    }
    Ok(())
}

/// Rename the primary designation: write the new value and bump `updated_at`.
///
/// Does NOT validate that the new name is an existing alias — that guard lives
/// in the use-case layer.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] when the target does not exist.
/// Returns [`DbError::Database`] on query failure.
pub async fn update_target_primary(
    pool: &SqlitePool,
    target_id: &str,
    new_primary: &str,
    updated_at: &str,
) -> DbResult<()> {
    let affected =
        sqlx::query("UPDATE targets SET primary_designation = ?, updated_at = ? WHERE id = ?")
            .bind(new_primary)
            .bind(updated_at)
            .bind(target_id)
            .execute(pool)
            .await?
            .rows_affected();

    if affected == 0 {
        return Err(DbError::NotFound(format!("target '{target_id}'")));
    }
    Ok(())
}

// ── target_aliases (spec 023, migration 0027) ─────────────────────────────────

/// List all alias rows for a target, ordered by alias_display.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_aliases(pool: &SqlitePool, target_id: &str) -> DbResult<Vec<TargetAliasRow>> {
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, target_id, alias_display, alias_normalized, created_at
         FROM target_aliases
         WHERE target_id = ?
         ORDER BY alias_display ASC",
    )
    .bind(target_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, target_id, alias_display, alias_normalized, created_at)| TargetAliasRow {
            id,
            target_id,
            alias_display,
            alias_normalized,
            created_at,
        })
        .collect())
}

/// Look up a single alias row by its normalized form (global uniqueness check).
///
/// Returns `None` when not found.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn find_alias_by_normalized(
    pool: &SqlitePool,
    alias_normalized: &str,
) -> DbResult<Option<TargetAliasRow>> {
    let row: Option<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, target_id, alias_display, alias_normalized, created_at
         FROM target_aliases
         WHERE alias_normalized = ?",
    )
    .bind(alias_normalized)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, target_id, alias_display, alias_normalized, created_at)| TargetAliasRow {
        id,
        target_id,
        alias_display,
        alias_normalized,
        created_at,
    }))
}

/// Insert a new alias row (fails if `alias_normalized` already exists globally).
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation (duplicate normalized alias).
pub async fn insert_alias(pool: &SqlitePool, row: &TargetAliasRow) -> DbResult<()> {
    let created_at = if row.created_at.is_empty() { now_iso() } else { row.created_at.clone() };

    sqlx::query(
        "INSERT INTO target_aliases (id, target_id, alias_display, alias_normalized, created_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&row.id)
    .bind(&row.target_id)
    .bind(&row.alias_display)
    .bind(&row.alias_normalized)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(())
}

/// Delete an alias row by its normalized form on a specific target.
///
/// Returns the number of rows deleted (0 when not found on this target).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn delete_alias_by_normalized(
    pool: &SqlitePool,
    target_id: &str,
    alias_normalized: &str,
) -> DbResult<u64> {
    let affected =
        sqlx::query("DELETE FROM target_aliases WHERE target_id = ? AND alias_normalized = ?")
            .bind(target_id)
            .bind(alias_normalized)
            .execute(pool)
            .await?
            .rows_affected();

    Ok(affected)
}

/// Count alias rows for a specific target.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn count_aliases(pool: &SqlitePool, target_id: &str) -> DbResult<i64> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM target_aliases WHERE target_id = ?")
            .bind(target_id)
            .fetch_one(pool)
            .await?;
    Ok(count)
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

// ── Session / project target FK helpers (T038, FR-014) ────────────────────────

/// Set `acq_target_id` on an `acquisition_session` row (T038, FR-014).
///
/// Uses `acq_target_id` (the spec-023 FK) rather than the legacy `target_id`.
/// Only updates rows where `acq_target_id IS NULL` so existing links are not
/// overwritten.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn set_session_acq_target_id(
    pool: &SqlitePool,
    session_id: &str,
    target_id: &str,
) -> DbResult<()> {
    sqlx::query(
        "UPDATE acquisition_session SET acq_target_id = ? \
         WHERE id = ? AND acq_target_id IS NULL",
    )
    .bind(target_id)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// List sessions linked to a target via `acq_target_id` (T038, FR-014).
///
/// Returns lightweight session rows for the `target.get` aggregate.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_sessions_for_target(
    pool: &SqlitePool,
    target_id: &str,
) -> DbResult<Vec<(String, Option<String>, Option<String>)>> {
    // Returns (session_id, session_key, created_at)
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, session_key, created_at
         FROM acquisition_session
         WHERE acq_target_id = ?
         ORDER BY created_at DESC",
    )
    .bind(target_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, key, at)| (id, Some(key), Some(at))).collect())
}

/// List projects linked to a target via `target_id` (T038, FR-014).
///
/// Returns (project_id, name, lifecycle, tool_id) rows for the `target.get` aggregate.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_projects_for_target(
    pool: &SqlitePool,
    target_id: &str,
) -> DbResult<Vec<(String, String, String, Option<String>)>> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, name, lifecycle, tool
         FROM projects
         WHERE target_id = ?
         ORDER BY lifecycle ASC, name ASC",
    )
    .bind(target_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id, name, lc, tool)| (id, name, lc, Some(tool))).collect())
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
            notes: None,
            updated_at: None,
        }
    }

    fn m31_alias(display: &str, normalized: &str) -> TargetAliasRow {
        TargetAliasRow {
            id: format!("alias-{normalized}"),
            target_id: "550e8400-e29b-41d4-a716-446655440099".into(),
            alias_display: display.into(),
            alias_normalized: normalized.into(),
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

    // ── spec 023: notes ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn update_notes_persists_content() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        update_target_notes(
            db.pool(),
            &m31_target().id,
            Some("Great galaxy"),
            "2026-06-01T00:00:00Z",
        )
        .await
        .unwrap();
        let row = get_target(db.pool(), &m31_target().id).await.unwrap();
        assert_eq!(row.notes.as_deref(), Some("Great galaxy"));
        assert_eq!(row.updated_at.as_deref(), Some("2026-06-01T00:00:00Z"));
    }

    #[tokio::test]
    async fn update_notes_clears_when_none() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        update_target_notes(db.pool(), &m31_target().id, Some("note"), "2026-06-01T00:00:00Z")
            .await
            .unwrap();
        update_target_notes(db.pool(), &m31_target().id, None, "2026-06-02T00:00:00Z")
            .await
            .unwrap();
        let row = get_target(db.pool(), &m31_target().id).await.unwrap();
        assert!(row.notes.is_none());
    }

    #[tokio::test]
    async fn update_notes_returns_not_found_for_unknown_target() {
        let db = setup().await;
        let result =
            update_target_notes(db.pool(), "no-such-id", Some("note"), "2026-06-01T00:00:00Z")
                .await;
        assert!(matches!(result, Err(DbError::NotFound(_))));
    }

    // ── spec 023: primary rename ──────────────────────────────────────────────

    #[tokio::test]
    async fn update_primary_persists_new_name() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        update_target_primary(
            db.pool(),
            &m31_target().id,
            "Andromeda Galaxy",
            "2026-06-01T00:00:00Z",
        )
        .await
        .unwrap();
        let row = get_target(db.pool(), &m31_target().id).await.unwrap();
        assert_eq!(row.primary_designation, "Andromeda Galaxy");
    }

    // ── spec 023: aliases ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn insert_and_list_alias() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        insert_alias(db.pool(), &m31_alias("Andromeda Galaxy", "andromeda galaxy")).await.unwrap();
        let aliases = list_aliases(db.pool(), &m31_target().id).await.unwrap();
        assert_eq!(aliases.len(), 1);
        assert_eq!(aliases[0].alias_display, "Andromeda Galaxy");
    }

    #[tokio::test]
    async fn find_alias_by_normalized_returns_row() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        insert_alias(db.pool(), &m31_alias("Andromeda Galaxy", "andromeda galaxy")).await.unwrap();
        let found = find_alias_by_normalized(db.pool(), "andromeda galaxy").await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().alias_display, "Andromeda Galaxy");
    }

    #[tokio::test]
    async fn find_alias_by_normalized_returns_none_when_absent() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        let found = find_alias_by_normalized(db.pool(), "nonexistent").await.unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn insert_alias_duplicate_normalized_fails() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        insert_alias(db.pool(), &m31_alias("Andromeda Galaxy", "andromeda galaxy")).await.unwrap();
        // Second insert with same normalized form must fail.
        let result =
            insert_alias(db.pool(), &m31_alias("Andromeda galaxy", "andromeda galaxy")).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn delete_alias_removes_row() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        insert_alias(db.pool(), &m31_alias("Andromeda Galaxy", "andromeda galaxy")).await.unwrap();
        let deleted = delete_alias_by_normalized(db.pool(), &m31_target().id, "andromeda galaxy")
            .await
            .unwrap();
        assert_eq!(deleted, 1);
        assert_eq!(count_aliases(db.pool(), &m31_target().id).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn delete_alias_returns_zero_when_not_found() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        let deleted =
            delete_alias_by_normalized(db.pool(), &m31_target().id, "nonexistent").await.unwrap();
        assert_eq!(deleted, 0);
    }

    #[tokio::test]
    async fn count_aliases_reflects_inserts() {
        let db = setup().await;
        upsert_target(db.pool(), &m31_target()).await.unwrap();
        assert_eq!(count_aliases(db.pool(), &m31_target().id).await.unwrap(), 0);
        insert_alias(db.pool(), &m31_alias("Andromeda Galaxy", "andromeda galaxy")).await.unwrap();
        assert_eq!(count_aliases(db.pool(), &m31_target().id).await.unwrap(), 1);
    }
}
