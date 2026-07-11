//! Repository methods for the projects store (spec 008).
//!
//! Operates on the `projects`, `project_sources`, and `project_channels`
//! tables from migration 0018.
//!
//! Constitution I: paths stored as library-root-relative strings.
//! Constitution V: SQLite is the durable record; snapshot fields on
//! `project_sources` denormalize Inventory data at link time.

use domain_core::ids::Timestamp;
use sqlx::{SqliteConnection, SqlitePool};

use crate::repositories::plans::{self, InsertPlan, InsertPlanItem};
use crate::{DbError, DbResult};

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    /// FR-020: typed blocked reason kind (migration 0037).
    /// Populated when lifecycle == "blocked"; NULL otherwise.
    pub blocked_reason_kind: Option<String>,
    /// FR-020: free-form blocked reason note (migration 0037).
    pub blocked_reason_note: Option<String>,
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

// ── Type aliases for complex query row types ──────────────────────────────────

/// Row tuple returned by `get_project` and `list_projects` queries.
/// Factored out to satisfy clippy::type_complexity.
type ProjectRowTuple = (
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    i64,
    String,
    String,
    Option<String>,
    Option<String>,
);

// ── projects CRUD ─────────────────────────────────────────────────────────────

/// Insert a new project row. Returns `DbError::Database` (UNIQUE violation) when
/// the name or path is already taken.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation or query failure.
pub async fn insert_project(pool: &SqlitePool, data: &InsertProject<'_>) -> DbResult<String> {
    let mut conn = pool.acquire().await?;
    insert_project_conn(&mut conn, data).await
}

/// Connection-level variant of [`insert_project`]: takes `&mut SqliteConnection`
/// (works against a plain connection or a `Transaction` deref) so composite
/// `*_tx` functions (e.g. [`create_project_tx`]) can compose it with other
/// writes in one transaction. See `with_transaction` in the crate root.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation or query failure.
async fn insert_project_conn(
    conn: &mut SqliteConnection,
    data: &InsertProject<'_>,
) -> DbResult<String> {
    let now = Timestamp::now_iso();
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
    .execute(&mut *conn)
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
    let row: Option<ProjectRowTuple> = sqlx::query_as(
        "SELECT id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at,
                blocked_reason_kind, blocked_reason_note
         FROM projects WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    let (
        id,
        name,
        tool,
        lifecycle,
        path,
        notes,
        channel_drift,
        created_at,
        updated_at,
        blocked_reason_kind,
        blocked_reason_note,
    ) = row.ok_or_else(|| DbError::NotFound(format!("project {id}")))?;

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
        blocked_reason_kind,
        blocked_reason_note,
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

/// Set a project's spec-035 `canonical_target_id` association, but only if it
/// is currently unset.
///
/// Spec 041 R-17/FR-052: called when a light's resolved target propagates from
/// its acquisition session to a linked project. This never overwrites an
/// existing value — whether it was set manually at project creation
/// (spec-035 US1 #2) or by an earlier propagation — so a project's canonical
/// target is first-write-wins, not last-write-wins.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn set_project_canonical_target_id(
    pool: &SqlitePool,
    id: &str,
    canonical_target_id: &str,
) -> DbResult<()> {
    let now = Timestamp::now_iso();
    sqlx::query(
        "UPDATE projects SET canonical_target_id = ?, updated_at = ? \
         WHERE id = ? AND canonical_target_id IS NULL",
    )
    .bind(canonical_target_id)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// List all projects ordered by updated_at descending.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_projects(pool: &SqlitePool) -> DbResult<Vec<ProjectRow>> {
    let rows: Vec<ProjectRowTuple> = sqlx::query_as(
        "SELECT id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at,
                blocked_reason_kind, blocked_reason_note
         FROM projects ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                name,
                tool,
                lifecycle,
                path,
                notes,
                channel_drift,
                created_at,
                updated_at,
                blocked_reason_kind,
                blocked_reason_note,
            )| {
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
                    blocked_reason_kind,
                    blocked_reason_note,
                }
            },
        )
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
    let now = Timestamp::now_iso();
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
    let now = Timestamp::now_iso();
    sqlx::query("UPDATE projects SET lifecycle = ?, updated_at = ? WHERE id = ?")
        .bind(lifecycle)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(now)
}

/// Update a project's lifecycle to "blocked" and persist the typed blocked reason.
///
/// FR-020 / T053: stores `blocked_reason_kind` and `blocked_reason_note` so the
/// `BlockedBanner` DTO can surface the real reason instead of a hardcoded value.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn update_project_lifecycle_blocked(
    pool: &SqlitePool,
    id: &str,
    reason_kind: &str,
    reason_note: Option<&str>,
) -> DbResult<String> {
    let now = Timestamp::now_iso();
    sqlx::query(
        "UPDATE projects SET lifecycle = 'blocked', \
         blocked_reason_kind = ?, blocked_reason_note = ?, updated_at = ? \
         WHERE id = ?",
    )
    .bind(reason_kind)
    .bind(reason_note)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(now)
}

/// Update a project's lifecycle state and clear the blocked reason columns.
///
/// FR-020 / T053: should be called when transitioning OUT of "blocked" so that
/// stale blocked_reason_kind/note are not left behind.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn update_project_lifecycle_unblock(
    pool: &SqlitePool,
    id: &str,
    lifecycle: &str,
) -> DbResult<String> {
    let now = Timestamp::now_iso();
    sqlx::query(
        "UPDATE projects SET lifecycle = ?, \
         blocked_reason_kind = NULL, blocked_reason_note = NULL, updated_at = ? \
         WHERE id = ?",
    )
    .bind(lifecycle)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(now)
}

/// Record the archive plan that drove a project into the `archived` lifecycle
/// state (spec 017 C5, migration 0053). Idempotent overwrite; does not touch
/// `updated_at` so the archived timestamp set by the lifecycle transition is
/// preserved.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn set_archived_via_plan_id(
    pool: &SqlitePool,
    project_id: &str,
    plan_id: &str,
) -> DbResult<()> {
    sqlx::query("UPDATE projects SET archived_via_plan_id = ? WHERE id = ?")
        .bind(plan_id)
        .bind(project_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// One archived-project row for the Archive surface (spec 017 `archive.list`).
///
/// Joined with the owning archive plan so the row can surface the plan title
/// (as the archive reason) and the bytes moved into the app-managed archive.
#[derive(Debug, Clone)]
pub struct ArchivedProjectRow {
    pub id: String,
    pub name: String,
    pub path: String,
    /// `updated_at` at the time the project reached `archived`.
    pub archived_at: String,
    pub archived_via_plan_id: Option<String>,
    /// Owning plan's title, when the plan row still exists.
    pub plan_title: Option<String>,
    /// Bytes the owning plan moved into the archive (`total_bytes_required`).
    pub archived_bytes: Option<i64>,
}

type ArchivedProjectTuple =
    (String, String, String, String, Option<String>, Option<String>, Option<i64>);

/// List every project currently in the `archived` lifecycle state, most-recent
/// first (spec 017 C5 — projects-only Archive surface).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_archived_projects(pool: &SqlitePool) -> DbResult<Vec<ArchivedProjectRow>> {
    let rows: Vec<ArchivedProjectTuple> = sqlx::query_as(
        "SELECT p.id, p.name, p.path, p.updated_at, p.archived_via_plan_id, \
                pl.title, pl.total_bytes_required \
         FROM projects p \
         LEFT JOIN plans pl ON pl.id = p.archived_via_plan_id \
         WHERE p.lifecycle = 'archived' \
         ORDER BY p.updated_at DESC, p.id ASC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, name, path, archived_at, archived_via_plan_id, plan_title, archived_bytes)| {
            ArchivedProjectRow {
                id,
                name,
                path,
                archived_at,
                archived_via_plan_id,
                plan_title,
                archived_bytes,
            }
        })
        .collect())
}

/// Set channel_drift flag on a project.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn set_channel_drift(pool: &SqlitePool, id: &str, has_drift: bool) -> DbResult<()> {
    let now = Timestamp::now_iso();
    sqlx::query("UPDATE projects SET channel_drift = ?, updated_at = ? WHERE id = ?")
        .bind(i64::from(has_drift))
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── project_sources CRUD ──────────────────────────────────────────────────────

/// List the ids of every project linked (via `project_sources`) to a given
/// `inventory_session_id` (an `acquisition_session.id`).
///
/// Spec 041 R-17/FR-052: the read side of target propagation — a session with
/// no linked project simply returns an empty vec (not an error).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_project_ids_for_session(
    pool: &SqlitePool,
    inventory_session_id: &str,
) -> DbResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT project_id FROM project_sources WHERE inventory_session_id = ?",
    )
    .bind(inventory_session_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

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
    let mut conn = pool.acquire().await?;
    insert_project_source_conn(&mut conn, data).await
}

/// Connection-level variant of [`insert_project_source`]. See
/// [`insert_project_conn`].
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation or query failure.
async fn insert_project_source_conn(
    conn: &mut SqliteConnection,
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
    .execute(&mut *conn)
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
    let now = Timestamp::now_iso();
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

/// Insert a single project-channel row (no delete). Only used by
/// [`create_project_tx`]: a brand-new project has no prior channel rows, so
/// the delete-then-insert [`replace_project_channels`] does is unnecessary.
async fn insert_project_channel_conn(
    conn: &mut SqliteConnection,
    project_id: &str,
    label: &str,
    source: &str,
    added_at: &str,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO project_channels (project_id, label, source, added_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(project_id)
    .bind(label)
    .bind(source)
    .bind(added_at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// ── Composite atomic create (T2-a) ──────────────────────────────────────────

/// Input for [`create_project_tx`]: the project row, its initial source
/// links, inferred channels, and the Constitution II folder-structure plan —
/// everything `app_projects::project_setup::create` must persist as one
/// atomic unit.
///
/// Folder-plan item resolution (`project_structure::required_folders`) stays
/// in the app layer; this struct only carries the already-resolved plan rows,
/// so `persistence_db` does not gain a dependency on `project_structure`.
pub struct CreateProjectInput<'a> {
    pub project: InsertProject<'a>,
    pub sources: &'a [InsertProjectSource<'a>],
    /// `(label, source)` pairs, already inferred by
    /// `domain_core::project::channels` (persistence does not infer).
    pub channels: &'a [(&'a str, &'a str)],
    /// Timestamp shared by every channel row's `added_at`.
    pub channels_added_at: &'a str,
    pub plan: InsertPlan<'a>,
    pub plan_items: &'a [InsertPlanItem<'a>],
}

/// Atomically create a project: the project row, its initial source links,
/// inferred channels, and the Constitution II folder-structure plan (+ items,
/// advanced to `ready_for_review`) — all in one transaction. A mid-sequence
/// failure rolls back everything; no half-built project is left behind (see
/// `docs/development/duplication-and-abstraction-audit.md` T2-a).
///
/// Composed via a direct `pool.begin()`/`tx.commit()` (matching every other
/// multi-statement transaction in this crate, e.g. `plan_apply.rs`,
/// [`replace_project_channels`]) rather than `crate::with_transaction`: that
/// combinator's `for<'c> FnOnce(&'c mut SqliteConnection) -> TxFuture<'c, _>`
/// closure is universally quantified over `'c`, so it cannot soundly capture
/// `input`'s externally-borrowed `&str` fields (the borrow checker would
/// require `input: 'static`). `with_transaction` stays available for callers
/// whose transaction body doesn't need to capture caller-borrowed data.
///
/// # Errors
///
/// Returns [`DbError::Database`] on constraint violation or query failure.
/// On error the transaction is rolled back and no rows from this call persist.
pub async fn create_project_tx(pool: &SqlitePool, input: &CreateProjectInput<'_>) -> DbResult<()> {
    let mut tx = pool.begin().await?;

    insert_project_conn(&mut tx, &input.project).await?;

    for source in input.sources {
        insert_project_source_conn(&mut tx, source).await?;
    }

    for (label, source) in input.channels {
        insert_project_channel_conn(
            &mut tx,
            input.project.id,
            label,
            source,
            input.channels_added_at,
        )
        .await?;
    }

    plans::insert_plan_conn(&mut tx, &input.plan).await?;
    for item in input.plan_items {
        plans::insert_plan_item_conn(&mut tx, item).await?;
    }
    plans::update_plan_state_conn(&mut tx, input.plan.id, "ready_for_review").await?;

    tx.commit().await?;
    Ok(())
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

    // ── create_project_tx: atomicity (T2-a) ────────────────────────────────

    #[tokio::test]
    async fn create_project_tx_persists_project_sources_channels_and_plan() {
        let db = setup().await;
        let sources = [InsertProjectSource {
            id: "src-1",
            project_id: "px",
            inventory_session_id: "inv-1",
            name_snapshot: "",
            frames_snapshot: 0,
            filter_snapshot: "",
            exposure_snapshot: "",
            linked_at: "2026-01-01T00:00:00Z",
        }];
        let plan_items = [InsertPlanItem {
            id: "item-1",
            plan_id: "plan-x",
            item_index: 0,
            name: "lights",
            action: "mkdir",
            from_root_id: None,
            from_relative_path: "",
            to_root_id: None,
            to_relative_path: "projects/px/lights",
            reason: "Create project sub-folder",
            protection: "normal",
            linked_entity: Some("px"),
            provenance_json: None,
            archive_path: None,
            source_id: None,
            category: None,
        }];
        let input = CreateProjectInput {
            project: project_a("px"),
            sources: &sources,
            channels: &[("Ha", "inferred")],
            channels_added_at: "2026-01-01T00:00:00Z",
            plan: InsertPlan {
                id: "plan-x",
                title: "Create project folder structure",
                origin: "project",
                origin_path: Some("projects/px"),
                plan_type: "project_create",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
            plan_items: &plan_items,
        };

        create_project_tx(db.pool(), &input).await.unwrap();

        let row = get_project(db.pool(), "px").await.unwrap();
        assert_eq!(row.name, "NGC 7000 NB");
        let sources = list_project_sources(db.pool(), "px").await.unwrap();
        assert_eq!(sources.len(), 1);
        let channels = list_project_channels(db.pool(), "px").await.unwrap();
        assert_eq!(channels.len(), 1);
        let plan = crate::repositories::plans::get_plan(db.pool(), "plan-x", false).await.unwrap();
        assert_eq!(plan.state, "ready_for_review");
        let items = crate::repositories::plans::list_plan_items(db.pool(), "plan-x").await.unwrap();
        assert_eq!(items.len(), 1);
    }

    #[tokio::test]
    async fn create_project_tx_rolls_back_all_writes_on_mid_sequence_failure() {
        let db = setup().await;
        // Two sources sharing the same primary key: the second insert violates
        // `project_sources.id`'s PRIMARY KEY, forcing a failure *after* the
        // project row and the first source row have already been written
        // inside the same transaction.
        let sources = [
            InsertProjectSource {
                id: "dupe-src",
                project_id: "px",
                inventory_session_id: "inv-1",
                name_snapshot: "",
                frames_snapshot: 0,
                filter_snapshot: "",
                exposure_snapshot: "",
                linked_at: "2026-01-01T00:00:00Z",
            },
            InsertProjectSource {
                id: "dupe-src",
                project_id: "px",
                inventory_session_id: "inv-2",
                name_snapshot: "",
                frames_snapshot: 0,
                filter_snapshot: "",
                exposure_snapshot: "",
                linked_at: "2026-01-01T00:00:00Z",
            },
        ];
        let plan_items: [InsertPlanItem; 0] = [];
        let input = CreateProjectInput {
            project: project_a("px"),
            sources: &sources,
            channels: &[("Ha", "inferred")],
            channels_added_at: "2026-01-01T00:00:00Z",
            plan: InsertPlan {
                id: "plan-x",
                title: "Create project folder structure",
                origin: "project",
                origin_path: Some("projects/px"),
                plan_type: "project_create",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
            plan_items: &plan_items,
        };

        let err = create_project_tx(db.pool(), &input).await.unwrap_err();
        assert!(matches!(err, DbError::Database(_)), "expected a UNIQUE constraint violation");

        // Full rollback: neither the project row, the first (successfully
        // inserted-then-rolled-back) source row, the channel row, nor the plan
        // row — none of which were ever reached after the failing statement —
        // may persist.
        let project_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ?")
            .bind("px")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(
            project_count, 0,
            "the project row must not persist after a mid-sequence failure"
        );

        let source_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM project_sources WHERE project_id = ?")
                .bind("px")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(source_count, 0, "no partial source rows may persist");

        let channel_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM project_channels WHERE project_id = ?")
                .bind("px")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(channel_count, 0, "no channel rows may persist");

        let plan_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plans WHERE id = ?")
            .bind("plan-x")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(plan_count, 0, "the plan row (never reached) must not persist");
    }
}
