//! Inventory projection repository (spec 006).
//!
//! Produces `InventorySource[]` by joining `library_root`,
//! `acquisition_session`, and `calibration_session` tables.  Filters are
//! applied server-side so the wire payload is small.
//!
//! No new tables are introduced — inventory is a read-only projection.

use sqlx::SqlitePool;

use crate::DbResult;

// ── Domain Row types returned by the projection query ─────────────────────────

/// A library root row from the projection.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct LibraryRootRow {
    pub id: String,
    pub current_path: String,
    pub kind: String,
    pub state: String,
}

/// A session row (acquisition or calibration) from the projection.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SessionProjectionRow {
    pub id: String,
    pub session_key: String,
    pub root_id: String,
    /// "acquisition" or "calibration"
    pub session_kind: String,
    /// Frame type string: "light", "dark", "flat", "bias", or derived "mixed".
    pub frame_type: String,
    /// JSON array of frame ids.
    pub frame_ids: String,
    pub state: String,
    /// Target id (acquisition sessions only; NULL for calibration).
    pub target_id: Option<String>,
    /// Target primary designation when linked.
    pub target_name: Option<String>,
    pub created_at: String,
}

/// A project reference row for the `linked.projects` lookup.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ProjectLinkRow {
    pub project_id: String,
    pub project_name: String,
    pub session_id: String,
}

/// Filters accepted by the inventory projection.
#[derive(Debug, Clone, Default)]
pub struct InventoryFilters {
    /// When `Some`, restrict to a single `LibraryRoot`.
    pub source_id: Option<String>,
    /// When `Some`, restrict to sessions with the given frame type.
    /// `"mixed"` matches heterogeneous sessions.
    pub frame_type: Option<String>,
    /// When `Some`, restrict to sessions in the given canonical state.
    /// By default (no filter), `ignored` sessions are excluded.
    pub review_state: Option<String>,
}

/// List all `LibraryRoot` rows that have at least one session under them.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_roots_with_sessions(pool: &SqlitePool) -> DbResult<Vec<LibraryRootRow>> {
    let rows = sqlx::query_as::<_, LibraryRootRow>(
        r"
        SELECT DISTINCT lr.id, lr.current_path, lr.kind, lr.state
        FROM library_root lr
        WHERE EXISTS (
            SELECT 1 FROM acquisition_session acs
            WHERE acs.root_id = lr.id
        ) OR EXISTS (
            SELECT 1 FROM calibration_session cs
            WHERE cs.root_id = lr.id
        )
        ORDER BY lr.current_path ASC
        ",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// List sessions under a given `LibraryRoot` with optional filters applied.
///
/// Acquisition sessions are joined with `target` for `target_name`.
/// Calibration sessions expose `kind` as the `frame_type`.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_sessions_for_root(
    pool: &SqlitePool,
    root_id: &str,
    filters: &InventoryFilters,
) -> DbResult<Vec<SessionProjectionRow>> {
    // Default exclusion: ignored sessions are filtered out unless explicitly
    // requested (FR-010: Cmd+K "Show ignored items" → reviewFilter=ignored).
    let exclude_ignored = filters.review_state.as_deref() != Some("ignored");
    let state_filter = filters.review_state.as_deref();
    let frame_filter = filters.frame_type.as_deref();

    // Acquisition sessions
    let acq_rows: Vec<SessionProjectionRow> = sqlx::query_as(
        r"
        SELECT
            acs.id                          AS id,
            acs.session_key                 AS session_key,
            acs.root_id                     AS root_id,
            'acquisition'                   AS session_kind,
            'light'                         AS frame_type,
            acs.frame_ids                   AS frame_ids,
            acs.state                       AS state,
            acs.target_id                   AS target_id,
            t.primary_designation           AS target_name,
            acs.created_at                  AS created_at
        FROM acquisition_session acs
        LEFT JOIN target t ON t.id = acs.target_id
        WHERE acs.root_id = ?
        ORDER BY acs.created_at DESC
        ",
    )
    .bind(root_id)
    .fetch_all(pool)
    .await?;

    // Calibration sessions
    let cal_rows: Vec<SessionProjectionRow> = sqlx::query_as(
        r"
        SELECT
            cs.id                           AS id,
            cs.session_key                  AS session_key,
            cs.root_id                      AS root_id,
            'calibration'                   AS session_kind,
            cs.kind                         AS frame_type,
            cs.frame_ids                    AS frame_ids,
            cs.state                        AS state,
            NULL                            AS target_id,
            NULL                            AS target_name,
            cs.created_at                   AS created_at
        FROM calibration_session cs
        WHERE cs.root_id = ?
        ORDER BY cs.created_at DESC
        ",
    )
    .bind(root_id)
    .fetch_all(pool)
    .await?;

    let all: Vec<SessionProjectionRow> = acq_rows.into_iter().chain(cal_rows).collect();

    // Apply post-fetch filters (state and frame_type) — these cannot be
    // trivially done in a single UNION query with dynamic placeholders.
    let filtered = all
        .into_iter()
        .filter(|row| {
            // Exclude ignored sessions unless review_filter=ignored
            if exclude_ignored && row.state == "ignored" {
                return false;
            }
            // State filter
            if let Some(sf) = state_filter {
                if row.state != sf {
                    return false;
                }
            }
            // Frame type filter
            if let Some(ff) = frame_filter {
                if row.frame_type != ff {
                    return false;
                }
            }
            true
        })
        .collect();

    Ok(filtered)
}

/// A project row used only for session-link lookup.
#[derive(Debug, sqlx::FromRow)]
struct ProjectSourcesRow {
    pub id: String,
    pub name: String,
    pub inventory_session_id: String,
}

/// Load project links for a set of session IDs.
///
/// Returns rows where each `ProjectLinkRow.session_id` is the session being
/// linked and `.project_id` / `.project_name` identify the project.  The
/// caller maps these into `InventoryLinkedRefs.projects`.
///
/// Implementation: fetches all `project_sources` rows whose
/// `inventory_session_id` is in the supplied set.  This is safe for the
/// expected cardinality (a few hundred sessions per root at most).
///
/// # Errors
/// Returns [`crate::DbResult`] on query failure.
pub async fn list_project_links_for_sessions(
    pool: &SqlitePool,
    session_ids: &[String],
) -> DbResult<Vec<ProjectLinkRow>> {
    if session_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Fetch all project sources in one pass, then filter in Rust.
    // Avoids dynamic SQL injection and is safe for small session sets.
    let all_sources: Vec<ProjectSourcesRow> = sqlx::query_as(
        r"
        SELECT ps.inventory_session_id, p.id, p.name
        FROM project_sources ps
        JOIN projects p ON p.id = ps.project_id
        ORDER BY p.name ASC
        ",
    )
    .fetch_all(pool)
    .await?;

    let id_set: std::collections::HashSet<&String> = session_ids.iter().collect();

    let rows = all_sources
        .into_iter()
        .filter(|r| id_set.contains(&r.inventory_session_id))
        .map(|r| ProjectLinkRow {
            project_id: r.id,
            project_name: r.name,
            session_id: r.inventory_session_id,
        })
        .collect();

    Ok(rows)
}

/// Look up the current state of an `acquisition_session` row.
///
/// Returns `Some((state, root_id))` when found, `None` when not found.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn get_acquisition_session_state(
    pool: &SqlitePool,
    session_id: &str,
) -> DbResult<Option<(String, String)>> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT state, root_id FROM acquisition_session WHERE id = ?")
            .bind(session_id)
            .fetch_optional(pool)
            .await?;
    Ok(row)
}

/// Look up the current state of a `calibration_session` row.
///
/// Returns `Some((state, root_id))` when found, `None` when not found.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn get_calibration_session_state(
    pool: &SqlitePool,
    session_id: &str,
) -> DbResult<Option<(String, String)>> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT state, root_id FROM calibration_session WHERE id = ?")
            .bind(session_id)
            .fetch_optional(pool)
            .await?;
    Ok(row)
}

/// Look up the `state` of a `library_root` row.
///
/// Returns `Some(state)` when found, `None` when not found.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn get_library_root_state(pool: &SqlitePool, root_id: &str) -> DbResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT state FROM library_root WHERE id = ?")
        .bind(root_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(s,)| s))
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

    #[tokio::test]
    async fn list_roots_with_sessions_returns_empty_initially() {
        let db = setup().await;
        let roots = list_roots_with_sessions(db.pool()).await.unwrap();
        assert!(roots.is_empty(), "expected no roots with sessions on a fresh db");
    }

    #[tokio::test]
    async fn list_sessions_for_root_returns_empty_on_unknown_root() {
        let db = setup().await;
        let filters = InventoryFilters::default();
        let sessions =
            list_sessions_for_root(db.pool(), "00000000-0000-0000-0000-000000000000", &filters)
                .await
                .unwrap();
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn project_links_empty_for_empty_session_ids() {
        let db = setup().await;
        let links = list_project_links_for_sessions(db.pool(), &[]).await.unwrap();
        assert!(links.is_empty());
    }

    #[tokio::test]
    async fn get_acquisition_session_state_returns_none_for_unknown() {
        let db = setup().await;
        let result =
            get_acquisition_session_state(db.pool(), "00000000-0000-0000-0000-000000000000")
                .await
                .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn get_calibration_session_state_returns_none_for_unknown() {
        let db = setup().await;
        let result =
            get_calibration_session_state(db.pool(), "00000000-0000-0000-0000-000000000000")
                .await
                .unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn get_library_root_state_returns_none_for_unknown() {
        let db = setup().await;
        let result = get_library_root_state(db.pool(), "00000000-0000-0000-0000-000000000000")
            .await
            .unwrap();
        assert!(result.is_none());
    }
}
