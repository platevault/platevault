//! Repository methods for the projects store (spec 008).
//!
//! Operates on the `projects`, `project_sources`, and `project_channels`
//! tables from migration 0018.
//!
//! Constitution I: paths stored as library-root-relative strings.
//! Constitution V: SQLite is the durable record; snapshot fields on
//! `project_sources` denormalize Inventory data at link time.

use sqlx::SqlitePool;
use time::OffsetDateTime;

use crate::{DbError, DbResult};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

// ── Row types ─────────────────────────────────────────────────────────────────

/// Flat row from the `projects` table.
#[derive(Clone, Debug)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub tool: String,
    pub lifecycle: String,
    pub path: String,
    pub notes: Option<String>,
    pub channel_drift: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Flat row from the `project_sources` table.
#[derive(Clone, Debug)]
pub struct ProjectSourceRow {
    pub id: String,
    pub project_id: String,
    pub inventory_session_id: String,
    pub name_snapshot: String,
    pub frames_snapshot: i64,
    pub filter_snapshot: String,
    pub exposure_snapshot: String,
    pub linked_at: String,
}

/// Flat row from the `project_channels` table.
#[derive(Clone, Debug)]
pub struct ProjectChannelRow {
    pub project_id: String,
    pub label: String,
    pub source: String,
    pub added_at: String,
}

// ── Insert helpers ────────────────────────────────────────────────────────────

/// Data required to insert a new project row.
#[derive(Clone, Debug)]
pub struct InsertProject<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub tool: &'a str,
    pub lifecycle: &'a str,
    pub path: &'a str,
    pub notes: Option<&'a str>,
    /// Optional spec-035 `canonical_target` id (additive; nullable). Coexists
    /// with the legacy spec-013 `target_id` column.
    pub canonical_target_id: Option<&'a str>,
}

/// Data required to insert a project source link.
#[derive(Clone, Debug)]
pub struct InsertProjectSource<'a> {
    pub id: &'a str,
    pub project_id: &'a str,
    pub inventory_session_id: &'a str,
    pub name_snapshot: &'a str,
    pub frames_snapshot: i64,
    pub filter_snapshot: &'a str,
    pub exposure_snapshot: &'a str,
    pub linked_at: &'a str,
}

// ── projects CRUD ─────────────────────────────────────────────────────────────

/// Insert a new project row. Returns `DbError::Database` (UNIQUE violation) when
/// the name or path is already taken.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation or query failure.
pub async fn insert_project(pool: &SqlitePool, data: &InsertProject<'_>) -> DbResult<String> {
    let now = now_iso();
    sqlx::query(
        "INSERT INTO projects (id, name, tool, lifecycle, path, notes, canonical_target_id, channel_drift, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(data.id)
    .bind(data.name)
    .bind(data.tool)
    .bind(data.lifecycle)
    .bind(data.path)
    .bind(data.notes)
    .bind(data.canonical_target_id)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(now)
}

/// Fetch a single project row by id.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] when no project with the given id exists.
/// Returns [`DbError::Database`] on query failure.
pub async fn get_project(pool: &SqlitePool, id: &str) -> DbResult<ProjectRow> {
    let row: Option<(String, String, String, String, String, Option<String>, i64, String, String)> =
        sqlx::query_as(
            "SELECT id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at
             FROM projects WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

    let (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) =
        row.ok_or_else(|| DbError::NotFound(format!("project {id}")))?;

    Ok(ProjectRow {
        id,
        name,
        tool,
        lifecycle,
        path,
        notes,
        channel_drift: channel_drift != 0,
        created_at,
        updated_at,
    })
}

/// Read the spec-035 `canonical_target_id` association for a project (spec 035
/// US1 #2). Returns `Ok(None)` when the project has no canonical target set, or
/// when the project id does not exist.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_project_canonical_target_id(
    pool: &SqlitePool,
    id: &str,
) -> DbResult<Option<String>> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT canonical_target_id FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|(ctid,)| ctid))
}

/// A project's associated spec-035 canonical target, resolved via LEFT JOIN
/// (spec 035 US1 #2). `None` when the project has no `canonical_target_id` set
/// (or the join finds no matching row).
#[derive(Clone, Debug)]
pub struct ProjectCanonicalTargetRow {
    pub id: String,
    pub primary_designation: String,
    pub common_name: Option<String>,
}

/// Read a project's associated canonical target (id, primary designation, and
/// a `common_name` alias when present) via LEFT JOIN on
/// `projects.canonical_target_id`. Returns `Ok(None)` when there is no
/// association.
///
/// The common name is the first `kind = 'common_name'` alias for the target
/// (alphabetical), or `None` when the target has no common-name alias.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_project_canonical_target(
    pool: &SqlitePool,
    id: &str,
) -> DbResult<Option<ProjectCanonicalTargetRow>> {
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT ct.id, ct.primary_designation,
                (SELECT ta.alias FROM target_alias ta
                  WHERE ta.target_id = ct.id AND ta.kind = 'common_name'
                  ORDER BY ta.alias ASC LIMIT 1) AS common_name
         FROM projects p
         JOIN canonical_target ct ON ct.id = p.canonical_target_id
         WHERE p.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, primary_designation, common_name)| ProjectCanonicalTargetRow {
        id,
        primary_designation,
        common_name,
    }))
}

/// List all projects ordered by updated_at descending.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_projects(pool: &SqlitePool) -> DbResult<Vec<ProjectRow>> {
    let rows: Vec<(String, String, String, String, String, Option<String>, i64, String, String)> =
        sqlx::query_as(
            "SELECT id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at
             FROM projects ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at)| {
            ProjectRow {
                id,
                name,
                tool,
                lifecycle,
                path,
                notes,
                channel_drift: channel_drift != 0,
                created_at,
                updated_at,
            }
        })
        .collect())
}

/// Check whether a project with the given name already exists (excluding a
/// specific id — used by update to allow rename to same value).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn name_exists(
    pool: &SqlitePool,
    name: &str,
    exclude_id: Option<&str>,
) -> DbResult<Option<String>> {
    let row: Option<(String,)> = match exclude_id {
        Some(excl) => {
            sqlx::query_as("SELECT id FROM projects WHERE name = ? AND id != ?")
                .bind(name)
                .bind(excl)
                .fetch_optional(pool)
                .await?
        }
        None => {
            sqlx::query_as("SELECT id FROM projects WHERE name = ?")
                .bind(name)
                .fetch_optional(pool)
                .await?
        }
    };
    Ok(row.map(|(id,)| id))
}

/// Check whether a project with the given path already exists.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn path_exists(
    pool: &SqlitePool,
    path: &str,
    exclude_id: Option<&str>,
) -> DbResult<Option<String>> {
    let row: Option<(String,)> = match exclude_id {
        Some(excl) => {
            sqlx::query_as("SELECT id FROM projects WHERE path = ? AND id != ?")
                .bind(path)
                .bind(excl)
                .fetch_optional(pool)
                .await?
        }
        None => {
            sqlx::query_as("SELECT id FROM projects WHERE path = ?")
                .bind(path)
                .fetch_optional(pool)
                .await?
        }
    };
    Ok(row.map(|(id,)| id))
}

/// Update whitelisted metadata fields on a project (name, tool, notes).
/// Always bumps `updated_at`. Returns the new `updated_at` timestamp.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn update_project_fields(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    tool: Option<&str>,
    notes: Option<&str>,
) -> DbResult<String> {
    // Build a dynamic update; at least one field must be supplied (enforced by caller).
    let now = now_iso();
    // Fetch the current row so we can patch only what changed.
    let current = get_project(pool, id).await?;
    let new_name = name.unwrap_or(&current.name);
    let new_tool = tool.unwrap_or(&current.tool);
    let new_notes: Option<&str> = notes.or(current.notes.as_deref());

    sqlx::query("UPDATE projects SET name = ?, tool = ?, notes = ?, updated_at = ? WHERE id = ?")
        .bind(new_name)
        .bind(new_tool)
        .bind(new_notes)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;

    Ok(now)
}

/// Update a project's lifecycle state. Returns the new `updated_at` timestamp.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn update_project_lifecycle(
    pool: &SqlitePool,
    id: &str,
    lifecycle: &str,
) -> DbResult<String> {
    let now = now_iso();
    sqlx::query("UPDATE projects SET lifecycle = ?, updated_at = ? WHERE id = ?")
        .bind(lifecycle)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(now)
}

/// Set channel_drift flag on a project.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn set_channel_drift(pool: &SqlitePool, id: &str, has_drift: bool) -> DbResult<()> {
    let now = now_iso();
    sqlx::query("UPDATE projects SET channel_drift = ?, updated_at = ? WHERE id = ?")
        .bind(i64::from(has_drift))
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── project_sources CRUD ──────────────────────────────────────────────────────

/// Insert a project source link row.
///
/// Returns `DbError::Database` (UNIQUE violation) when the
/// `(project_id, inventory_session_id)` pair already exists.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation or query failure.
pub async fn insert_project_source(
    pool: &SqlitePool,
    data: &InsertProjectSource<'_>,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO project_sources
            (id, project_id, inventory_session_id,
             name_snapshot, frames_snapshot, filter_snapshot, exposure_snapshot, linked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(data.id)
    .bind(data.project_id)
    .bind(data.inventory_session_id)
    .bind(data.name_snapshot)
    .bind(data.frames_snapshot)
    .bind(data.filter_snapshot)
    .bind(data.exposure_snapshot)
    .bind(data.linked_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a project source link by its row id (the `inventory_session_id` UUID).
///
/// Returns the number of rows deleted (0 if the source was not found).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn delete_project_source(
    pool: &SqlitePool,
    project_id: &str,
    inventory_session_id: &str,
) -> DbResult<u64> {
    let result = sqlx::query(
        "DELETE FROM project_sources WHERE project_id = ? AND inventory_session_id = ?",
    )
    .bind(project_id)
    .bind(inventory_session_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Fetch all sources for a project, ordered by linked_at ascending.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_project_sources(
    pool: &SqlitePool,
    project_id: &str,
) -> DbResult<Vec<ProjectSourceRow>> {
    let rows: Vec<(String, String, String, String, i64, String, String, String)> = sqlx::query_as(
        "SELECT id, project_id, inventory_session_id,
                    name_snapshot, frames_snapshot, filter_snapshot, exposure_snapshot, linked_at
             FROM project_sources WHERE project_id = ? ORDER BY linked_at ASC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                project_id,
                inventory_session_id,
                name_snapshot,
                frames_snapshot,
                filter_snapshot,
                exposure_snapshot,
                linked_at,
            )| {
                ProjectSourceRow {
                    id,
                    project_id,
                    inventory_session_id,
                    name_snapshot,
                    frames_snapshot,
                    filter_snapshot,
                    exposure_snapshot,
                    linked_at,
                }
            },
        )
        .collect())
}

/// Get a single project source row by project_id + inventory_session_id.
///
/// # Errors
///
/// Returns [`DbError::NotFound`] when not found.
pub async fn get_project_source(
    pool: &SqlitePool,
    project_id: &str,
    inventory_session_id: &str,
) -> DbResult<ProjectSourceRow> {
    let row: Option<(String, String, String, String, i64, String, String, String)> =
        sqlx::query_as(
            "SELECT id, project_id, inventory_session_id,
                    name_snapshot, frames_snapshot, filter_snapshot, exposure_snapshot, linked_at
             FROM project_sources WHERE project_id = ? AND inventory_session_id = ?",
        )
        .bind(project_id)
        .bind(inventory_session_id)
        .fetch_optional(pool)
        .await?;

    let (
        id,
        project_id,
        inventory_session_id,
        name_snapshot,
        frames_snapshot,
        filter_snapshot,
        exposure_snapshot,
        linked_at,
    ) = row.ok_or_else(|| {
        DbError::NotFound(format!("project_source {inventory_session_id} on {project_id}"))
    })?;

    Ok(ProjectSourceRow {
        id,
        project_id,
        inventory_session_id,
        name_snapshot,
        frames_snapshot,
        filter_snapshot,
        exposure_snapshot,
        linked_at,
    })
}

// ── project_channels CRUD ─────────────────────────────────────────────────────

/// Replace all channels for a project atomically (delete + insert in one tx).
///
/// # Errors
///
/// Returns [`DbError::Database`] on transaction failure.
pub async fn replace_project_channels(
    pool: &SqlitePool,
    project_id: &str,
    channels: &[(&str, &str)], // (label, source)
) -> DbResult<()> {
    let now = now_iso();
    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM project_channels WHERE project_id = ?")
        .bind(project_id)
        .execute(&mut *tx)
        .await?;

    for (label, source) in channels {
        sqlx::query(
            "INSERT INTO project_channels (project_id, label, source, added_at)
             VALUES (?, ?, ?, ?)",
        )
        .bind(project_id)
        .bind(label)
        .bind(source)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Fetch all channels for a project, ordered by label ascending.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_project_channels(
    pool: &SqlitePool,
    project_id: &str,
) -> DbResult<Vec<ProjectChannelRow>> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT project_id, label, source, added_at
         FROM project_channels WHERE project_id = ? ORDER BY label ASC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(project_id, label, source, added_at)| ProjectChannelRow {
            project_id,
            label,
            source,
            added_at,
        })
        .collect())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    fn project_a(id: &str) -> InsertProject<'_> {
        InsertProject {
            id,
            name: "NGC 7000 NB",
            tool: "PixInsight",
            lifecycle: "setup_incomplete",
            path: "projects/NGC7000_NB",
            notes: None,
            canonical_target_id: None,
        }
    }

    #[tokio::test]
    async fn insert_and_get_project() {
        let db = setup().await;
        insert_project(db.pool(), &project_a("p1")).await.unwrap();
        let row = get_project(db.pool(), "p1").await.unwrap();
        assert_eq!(row.name, "NGC 7000 NB");
        assert_eq!(row.tool, "PixInsight");
        assert_eq!(row.lifecycle, "setup_incomplete");
        assert!(!row.channel_drift);
    }

    #[tokio::test]
    async fn list_projects_returns_all() {
        let db = setup().await;
        insert_project(db.pool(), &project_a("p1")).await.unwrap();
        insert_project(
            db.pool(),
            &InsertProject {
                id: "p2",
                name: "M31 LRGB",
                tool: "Siril",
                lifecycle: "ready",
                path: "projects/M31_LRGB",
                notes: Some("test notes"),
                canonical_target_id: None,
            },
        )
        .await
        .unwrap();
        let rows = list_projects(db.pool()).await.unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn name_exists_detects_duplicate() {
        let db = setup().await;
        insert_project(db.pool(), &project_a("p1")).await.unwrap();
        let conflict = name_exists(db.pool(), "NGC 7000 NB", None).await.unwrap();
        assert_eq!(conflict, Some("p1".to_owned()));
        let no_conflict = name_exists(db.pool(), "M31", None).await.unwrap();
        assert!(no_conflict.is_none());
    }

    #[tokio::test]
    async fn update_project_fields_changes_name() {
        let db = setup().await;
        insert_project(db.pool(), &project_a("p1")).await.unwrap();
        update_project_fields(db.pool(), "p1", Some("M31 LRGB"), None, None).await.unwrap();
        let row = get_project(db.pool(), "p1").await.unwrap();
        assert_eq!(row.name, "M31 LRGB");
    }

    #[tokio::test]
    async fn insert_and_list_project_sources() {
        let db = setup().await;
        insert_project(db.pool(), &project_a("p1")).await.unwrap();
        let now = "2026-06-01T00:00:00Z";
        insert_project_source(
            db.pool(),
            &InsertProjectSource {
                id: "src-1",
                project_id: "p1",
                inventory_session_id: "inv-001",
                name_snapshot: "NGC7000 Ha",
                frames_snapshot: 18,
                filter_snapshot: "Ha",
                exposure_snapshot: "120s",
                linked_at: now,
            },
        )
        .await
        .unwrap();
        let sources = list_project_sources(db.pool(), "p1").await.unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].filter_snapshot, "Ha");
    }

    #[tokio::test]
    async fn duplicate_source_link_rejected() {
        let db = setup().await;
        insert_project(db.pool(), &project_a("p1")).await.unwrap();
        let now = "2026-06-01T00:00:00Z";
        let src = InsertProjectSource {
            id: "src-1",
            project_id: "p1",
            inventory_session_id: "inv-001",
            name_snapshot: "Ha",
            frames_snapshot: 10,
            filter_snapshot: "Ha",
            exposure_snapshot: "60s",
            linked_at: now,
        };
        insert_project_source(db.pool(), &src).await.unwrap();
        // Second insert with same (project_id, inventory_session_id) must fail
        let result =
            insert_project_source(db.pool(), &InsertProjectSource { id: "src-2", ..src }).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn replace_channels_is_idempotent() {
        let db = setup().await;
        insert_project(db.pool(), &project_a("p1")).await.unwrap();
        replace_project_channels(db.pool(), "p1", &[("Ha", "inferred"), ("OIII", "inferred")])
            .await
            .unwrap();
        replace_project_channels(db.pool(), "p1", &[("Ha", "inferred"), ("SII", "manual")])
            .await
            .unwrap();
        let ch = list_project_channels(db.pool(), "p1").await.unwrap();
        assert_eq!(ch.len(), 2);
        let labels: Vec<&str> = ch.iter().map(|r| r.label.as_str()).collect();
        assert!(labels.contains(&"Ha"));
        assert!(labels.contains(&"SII"));
    }

    #[tokio::test]
    async fn delete_project_source_removes_row() {
        let db = setup().await;
        insert_project(db.pool(), &project_a("p1")).await.unwrap();
        let now = "2026-06-01T00:00:00Z";
        insert_project_source(
            db.pool(),
            &InsertProjectSource {
                id: "src-1",
                project_id: "p1",
                inventory_session_id: "inv-001",
                name_snapshot: "Ha",
                frames_snapshot: 10,
                filter_snapshot: "Ha",
                exposure_snapshot: "60s",
                linked_at: now,
            },
        )
        .await
        .unwrap();
        let affected = delete_project_source(db.pool(), "p1", "inv-001").await.unwrap();
        assert_eq!(affected, 1);
        let sources = list_project_sources(db.pool(), "p1").await.unwrap();
        assert!(sources.is_empty());
    }
}
