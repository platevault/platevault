//! Inventory projection repository (spec 006).
//!
//! Produces `InventorySource[]` by joining `library_root`,
//! `acquisition_session`, and `calibration_session` tables.  Filters are
//! applied server-side so the wire payload is small.
//!
//! No new tables are introduced — inventory is a read-only projection.
//!
//! Spec 041 FR-051 (T076, Phase 13): sessions no longer carry a review-state
//! column — they are derived, already-confirmed inventory. The `state`
//! projection column and `review_state` filter were removed.

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

/// List ALL `LibraryRoot` rows (regardless of session presence).
///
/// Used by spec 011 cwd-containment check (R-CwdContain, FR-010).
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_all_roots(pool: &SqlitePool) -> DbResult<Vec<LibraryRootRow>> {
    let rows = sqlx::query_as::<_, LibraryRootRow>(
        "SELECT id, current_path, kind, state FROM library_root ORDER BY current_path ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// List sessions under a given `LibraryRoot` with optional filters applied.
///
/// Calibration sessions expose `kind` as the `frame_type`.
/// `target_name` is always `None` — gen-1 `target` table is unreferenced
/// (spec 036, T007); the gen-3 `canonical_target` is the live store.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_sessions_for_root(
    pool: &SqlitePool,
    root_id: &str,
    filters: &InventoryFilters,
) -> DbResult<Vec<SessionProjectionRow>> {
    let frame_filter = filters.frame_type.as_deref();

    // Acquisition sessions — target_name is always NULL (gen-1 `target`
    // table is unreferenced per spec 036 T007; gen-3 canonical_target is
    // the live store and is not part of the inventory projection).
    let acq_rows: Vec<SessionProjectionRow> = sqlx::query_as(
        r"
        SELECT
            acs.id                          AS id,
            acs.session_key                 AS session_key,
            acs.root_id                     AS root_id,
            'acquisition'                   AS session_kind,
            'light'                         AS frame_type,
            acs.frame_ids                   AS frame_ids,
            acs.target_id                   AS target_id,
            NULL                            AS target_name,
            acs.created_at                  AS created_at
        FROM acquisition_session acs
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

    // Apply post-fetch frame_type filter — cannot be trivially done in a
    // single UNION query with dynamic placeholders.
    let filtered =
        all.into_iter().filter(|row| frame_filter.is_none_or(|ff| row.frame_type == ff)).collect();

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

/// Session context enrichment row (spec P9): resolved target/filter/night/
/// frame-count for a light (`acquisition_session`) row, keyed by session id.
///
/// `target_name` prefers the user-owned `display_alias` over
/// `primary_designation` (same effective-label rule as the Targets surface).
/// `filter` and `acquisition_night` come from `acquisition_fingerprint`
/// (absent until the metadata extraction pipeline populates a fingerprint
/// row). `frame_count` is derived from `json_array_length(frame_ids)` and is
/// always present for a matched row (the column is `NOT NULL DEFAULT '[]'`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SessionContextRow {
    pub id: String,
    pub target_name: Option<String>,
    pub filter: Option<String>,
    pub acquisition_night: Option<String>,
    pub frame_count: i64,
}

/// Batch-load session context for calibration match-suggest enrichment
/// (spec P9). One query for the whole `session_ids` set — callers MUST NOT
/// call this per-row (N+1).
///
/// Only `acquisition_session` (light) rows are covered; calibration sessions
/// have no target/filter/night context to enrich. Ids with no matching row
/// (unknown session, or a calibration session id) are simply absent from the
/// returned `Vec` — callers treat a missing id as "no context available".
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn get_session_context_by_ids(
    pool: &SqlitePool,
    session_ids: &[String],
) -> DbResult<Vec<SessionContextRow>> {
    if session_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = vec!["?"; session_ids.len()].join(",");
    let sql = format!(
        "SELECT
             acs.id                                              AS id,
             COALESCE(ct.display_alias, ct.primary_designation)  AS target_name,
             af.filter_name                                      AS filter,
             af.observing_night_date                             AS acquisition_night,
             json_array_length(acs.frame_ids)                    AS frame_count
         FROM acquisition_session acs
         LEFT JOIN canonical_target ct ON ct.id = acs.canonical_target_id
         LEFT JOIN acquisition_fingerprint af ON af.id = acs.id
         WHERE acs.id IN ({placeholders})"
    );

    // SQL is built only from a fixed `?` placeholder count (no user strings
    // in the text); every id flows through `bind`. Same pattern as the
    // dynamic `IN (?, …)` lists in `inbox.rs` / `lifecycle.rs`.
    let mut q = sqlx::query_as::<_, SessionContextRow>(sqlx::AssertSqlSafe(sql));
    for id in session_ids {
        q = q.bind(id);
    }
    let rows = q.fetch_all(pool).await?;
    Ok(rows)
}

/// Set `root_id` on an `acquisition_session` row (T036, FR-012).
///
/// Called when the inbox confirm pipeline resolves the root for a session.
/// Only updates rows where `root_id IS NULL` to avoid overwriting a correctly
/// set root with a different one.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn update_acquisition_session_root_id(
    pool: &SqlitePool,
    session_id: &str,
    root_id: &str,
) -> DbResult<()> {
    sqlx::query(
        "UPDATE acquisition_session SET root_id = ? \
         WHERE id = ? AND root_id IS NULL",
    )
    .bind(root_id)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Set `root_id` on a `calibration_session` row (T036, FR-012).
///
/// See [`update_acquisition_session_root_id`] for semantics.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn update_calibration_session_root_id(
    pool: &SqlitePool,
    session_id: &str,
    root_id: &str,
) -> DbResult<()> {
    sqlx::query(
        "UPDATE calibration_session SET root_id = ? \
         WHERE id = ? AND root_id IS NULL",
    )
    .bind(root_id)
    .bind(session_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Look up the absolute `current_path` of a `library_root` row (T023a).
///
/// Returns `Some(path_string)` when found, `None` when not found.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn get_library_root_path(pool: &SqlitePool, root_id: &str) -> DbResult<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT current_path FROM library_root WHERE id = ?")
            .bind(root_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(p,)| p))
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
    async fn get_library_root_state_returns_none_for_unknown() {
        let db = setup().await;
        let result = get_library_root_state(db.pool(), "00000000-0000-0000-0000-000000000000")
            .await
            .unwrap();
        assert!(result.is_none());
    }

    // ── get_session_context_by_ids (spec P9) ──────────────────────────────────

    #[tokio::test]
    async fn session_context_empty_ids_returns_empty_without_querying() {
        let db = setup().await;
        let rows = get_session_context_by_ids(db.pool(), &[]).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn session_context_batches_multiple_ids_in_one_call() {
        let db = setup().await;

        sqlx::query(
            "INSERT INTO canonical_target
                (id, simbad_oid, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at, display_alias)
             VALUES ('t-1', NULL, 'M 31', 'galaxy', 10.68, 41.27, 'seed', '2026-01-01T00:00:00Z', 'Andromeda')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at, canonical_target_id) \
             VALUES ('acq-1', 'M31/L/2026-03-01', '[\"f1\",\"f2\",\"f3\"]', '2026-03-01T00:00:00Z', 't-1')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO acquisition_fingerprint (id, filter_name, observing_night_date) \
             VALUES ('acq-1', 'Ha', '2026-03-01')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        // A second session with no fingerprint and no canonical target link —
        // context fields resolve to None, but frame_count is still derived.
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at) \
             VALUES ('acq-2', 'unknown/L/2026-03-02', '[\"f4\"]', '2026-03-02T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let ids = vec!["acq-1".to_owned(), "acq-2".to_owned(), "missing-id".to_owned()];
        let mut rows = get_session_context_by_ids(db.pool(), &ids).await.unwrap();
        rows.sort_by(|a, b| a.id.cmp(&b.id));

        // Unknown session ids are simply absent — no error, no phantom row.
        assert_eq!(rows.len(), 2, "missing-id must not produce a row");

        assert_eq!(rows[0].id, "acq-1");
        assert_eq!(rows[0].target_name.as_deref(), Some("Andromeda"), "display_alias wins");
        assert_eq!(rows[0].filter.as_deref(), Some("Ha"));
        assert_eq!(rows[0].acquisition_night.as_deref(), Some("2026-03-01"));
        assert_eq!(rows[0].frame_count, 3);

        assert_eq!(rows[1].id, "acq-2");
        assert_eq!(rows[1].target_name, None);
        assert_eq!(rows[1].filter, None);
        assert_eq!(rows[1].acquisition_night, None);
        assert_eq!(rows[1].frame_count, 1);
    }

    #[tokio::test]
    async fn session_context_falls_back_to_primary_designation_without_display_alias() {
        let db = setup().await;

        sqlx::query(
            "INSERT INTO canonical_target
                (id, simbad_oid, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at)
             VALUES ('t-2', NULL, 'NGC 7000', 'nebula', 20.0, 30.0, 'seed', '2026-01-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at, canonical_target_id) \
             VALUES ('acq-3', 'NGC7000/L/2026-04-01', '[]', '2026-04-01T00:00:00Z', 't-2')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let rows = get_session_context_by_ids(db.pool(), &["acq-3".to_owned()]).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].target_name.as_deref(), Some("NGC 7000"));
        assert_eq!(rows[0].frame_count, 0);
    }
}
