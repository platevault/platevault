//! Free-fn repository queries backing `app_core::frame_inventory`,
//! `app_core::search`, and `app_core::sessions` (db-boundary-zero drain).
//!
//! Grouped by the app-layer module each function set backs. Business logic
//! (DTO mapping, filtering, presence-state derivation) stays in `app_core`;
//! this module only executes SQL and returns typed rows.

use sqlx::SqlitePool;

use crate::DbResult;

// ── frame_inventory ─────────────────────────────────────────────────────────

/// `frame_ids` JSON string for an `acquisition_session`, if it exists.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn get_acquisition_session_frame_ids(
    pool: &SqlitePool,
    session_id: &str,
) -> DbResult<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT frame_ids FROM acquisition_session WHERE id = ?")
            .bind(session_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(f,)| f))
}

/// `(frame_ids, kind)` for a `calibration_session`, if it exists.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn get_calibration_session_frame_ids_and_kind(
    pool: &SqlitePool,
    session_id: &str,
) -> DbResult<Option<(String, String)>> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT frame_ids, kind FROM calibration_session WHERE id = ?")
            .bind(session_id)
            .fetch_optional(pool)
            .await?;
    Ok(row)
}

/// A `file_record` row (spec 048 per-frame inventory).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FileRecordRow {
    pub id: String,
    pub root_id: String,
    pub relative_path: String,
    pub size_bytes: i64,
    pub state: String,
}

/// `file_record` rows matching a set of ids. Empty `ids` short-circuits
/// without querying.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn file_records_by_ids(
    pool: &SqlitePool,
    ids: &[String],
) -> DbResult<Vec<FileRecordRow>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT id, root_id, relative_path, size_bytes, state FROM file_record WHERE id IN (",
    );
    let mut separated = builder.separated(", ");
    for id in ids {
        separated.push_bind(id);
    }
    separated.push_unseparated(")");
    let rows = builder.build_query_as::<FileRecordRow>().fetch_all(pool).await?;
    Ok(rows)
}

/// `file_record` rows for a given root.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn file_records_by_root(
    pool: &SqlitePool,
    root_id: &str,
) -> DbResult<Vec<FileRecordRow>> {
    let rows = sqlx::query_as::<_, FileRecordRow>(
        "SELECT id, root_id, relative_path, size_bytes, state FROM file_record WHERE root_id = ?",
    )
    .bind(root_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Id of the `acquisition_session` whose `frame_ids` JSON array contains a
/// given frame id, matched via `LIKE`.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn find_acquisition_session_id_by_frame_like(
    pool: &SqlitePool,
    like_pattern: &str,
) -> DbResult<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT id FROM acquisition_session WHERE frame_ids LIKE ? LIMIT 1")
            .bind(like_pattern)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(id,)| id))
}

/// `(session id, kind)` of the `calibration_session` whose `frame_ids` JSON
/// array contains a given frame id, matched via `LIKE`.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn find_calibration_session_by_frame_like(
    pool: &SqlitePool,
    like_pattern: &str,
) -> DbResult<Option<(String, String)>> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT id, kind FROM calibration_session WHERE frame_ids LIKE ? LIMIT 1")
            .bind(like_pattern)
            .fetch_optional(pool)
            .await?;
    Ok(row)
}

/// Mark a `file_record` row `missing`. Preserves the original call site's
/// `last_seen_at = last_seen_at` no-op assignment (leaves the column
/// untouched while still forming a valid `UPDATE`).
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn mark_file_record_missing(pool: &SqlitePool, id: &str) -> DbResult<()> {
    sqlx::query(
        "UPDATE file_record SET state = 'missing', last_seen_at = last_seen_at WHERE id = ?",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// `(session id, frame_ids JSON)` rows from `acquisition_session` whose
/// `frame_ids` array contains a given frame id, matched via `LIKE` (spec 048
/// T021 auto-reconcile membership drop).
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn acquisition_sessions_by_frame_like(
    pool: &SqlitePool,
    like_pattern: &str,
) -> DbResult<Vec<(String, String)>> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id, frame_ids FROM acquisition_session WHERE frame_ids LIKE ?")
            .bind(like_pattern)
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

/// Same as [`acquisition_sessions_by_frame_like`] for `calibration_session`.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn calibration_sessions_by_frame_like(
    pool: &SqlitePool,
    like_pattern: &str,
) -> DbResult<Vec<(String, String)>> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id, frame_ids FROM calibration_session WHERE frame_ids LIKE ?")
            .bind(like_pattern)
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

/// Overwrite an `acquisition_session`'s `frame_ids` JSON array.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn update_acquisition_session_frame_ids(
    pool: &SqlitePool,
    id: &str,
    frame_ids_json: &str,
) -> DbResult<()> {
    sqlx::query("UPDATE acquisition_session SET frame_ids = ? WHERE id = ?")
        .bind(frame_ids_json)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Overwrite a `calibration_session`'s `frame_ids` JSON array.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn update_calibration_session_frame_ids(
    pool: &SqlitePool,
    id: &str,
    frame_ids_json: &str,
) -> DbResult<()> {
    sqlx::query("UPDATE calibration_session SET frame_ids = ? WHERE id = ?")
        .bind(frame_ids_json)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// `file_record.content_hash` for a frame id. Assumes the row exists (the
/// caller already resolved it via [`file_records_by_ids`]); errors if it
/// does not.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn get_file_record_content_hash(pool: &SqlitePool, id: &str) -> DbResult<Option<String>> {
    let hash: Option<String> =
        sqlx::query_scalar("SELECT content_hash FROM file_record WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await?;
    Ok(hash)
}

/// Re-home a `file_record` after a confirmed relink: update its path,
/// content hash, and last-seen timestamp, and flip its state back to
/// `classified` (spec 048 T025).
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn relink_file_record(
    pool: &SqlitePool,
    id: &str,
    relative_path: &str,
    content_hash: &str,
    last_seen_at: &str,
) -> DbResult<()> {
    sqlx::query(
        "UPDATE file_record \
         SET relative_path = ?, content_hash = ?, state = 'classified', last_seen_at = ? \
         WHERE id = ?",
    )
    .bind(relative_path)
    .bind(content_hash)
    .bind(last_seen_at)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

// ── search ───────────────────────────────────────────────────────────────────

/// Row from the target search query: id, resolved label, and the best
/// matching alias (if the match came via an alias rather than the primary
/// designation).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TargetSearchRow {
    pub id: String,
    pub label: String,
    pub alias_match: Option<String>,
}

/// Search `canonical_target` by primary designation or alias, `like_pattern`
/// already wrapped in `%...%`.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn search_targets_by_like(
    pool: &SqlitePool,
    like_pattern: &str,
) -> DbResult<Vec<TargetSearchRow>> {
    let rows = sqlx::query_as::<_, TargetSearchRow>(
        // spec 036 reconciliation: query the gen-3 canonical_target / target_alias
        // tables (the legacy spec-013 targets / target_aliases were retired).
        "SELECT t.id, COALESCE(t.display_alias, t.primary_designation) AS label,
                (SELECT ta.alias FROM target_alias ta
                 WHERE ta.target_id = t.id
                   AND ta.normalized LIKE ?
                 LIMIT 1) AS alias_match
         FROM canonical_target t
         WHERE LOWER(t.primary_designation) LIKE ?
            OR EXISTS (
                SELECT 1 FROM target_alias ta2
                WHERE ta2.target_id = t.id
                  AND ta2.normalized LIKE ?
            )
         ORDER BY t.primary_designation ASC
         LIMIT 10",
    )
    .bind(like_pattern)
    .bind(like_pattern)
    .bind(like_pattern)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A generic `(id, label)` row shared by the recent-target, session-search,
/// recent-session, and recent-project queries.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IdLabelRow {
    pub id: String,
    pub label: String,
}

/// Most-recently-resolved `canonical_target` rows.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn recent_targets(pool: &SqlitePool) -> DbResult<Vec<IdLabelRow>> {
    let rows = sqlx::query_as::<_, IdLabelRow>(
        "SELECT id, COALESCE(display_alias, primary_designation) AS label FROM canonical_target \
         ORDER BY resolved_at DESC LIMIT 5",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Search `acquisition_session` by `session_key`, `like_pattern` already
/// wrapped in `%...%`.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn search_sessions_by_like(
    pool: &SqlitePool,
    like_pattern: &str,
) -> DbResult<Vec<IdLabelRow>> {
    let rows = sqlx::query_as::<_, IdLabelRow>(
        "SELECT id, session_key AS label
         FROM acquisition_session
         WHERE LOWER(session_key) LIKE ?
         ORDER BY created_at DESC
         LIMIT 10",
    )
    .bind(like_pattern)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Most-recently-created `acquisition_session` rows.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn recent_sessions(pool: &SqlitePool) -> DbResult<Vec<IdLabelRow>> {
    let rows = sqlx::query_as::<_, IdLabelRow>(
        "SELECT id, session_key AS label
         FROM acquisition_session
         ORDER BY created_at DESC
         LIMIT 5",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Row from the project search query.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ProjectSearchRow {
    pub id: String,
    pub name: String,
    pub lifecycle: String,
}

/// Search `projects` by `name`, `like_pattern` already wrapped in `%...%`.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn search_projects_by_like(
    pool: &SqlitePool,
    like_pattern: &str,
) -> DbResult<Vec<ProjectSearchRow>> {
    let rows = sqlx::query_as::<_, ProjectSearchRow>(
        "SELECT id, name, lifecycle
         FROM projects
         WHERE LOWER(name) LIKE ?
         ORDER BY name ASC
         LIMIT 10",
    )
    .bind(like_pattern)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Most-recently-created `projects` rows.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn recent_projects(pool: &SqlitePool) -> DbResult<Vec<IdLabelRow>> {
    let rows = sqlx::query_as::<_, IdLabelRow>(
        "SELECT id, name AS label FROM projects ORDER BY created_at DESC LIMIT 5",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── sessions ─────────────────────────────────────────────────────────────────

/// `acquisition_session` row joined with its canonical target (spec 035
/// US4/T044). Shared by `sessions.list` and `sessions.get`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct SessionJoinRow {
    pub id: String,
    pub session_key: String,
    pub target_id: Option<String>,
    pub frame_ids: String,
    pub created_at: String,
    pub canonical_target_id: Option<String>,
    pub canonical_target_name: Option<String>,
}

/// All `acquisition_session` rows, newest first.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn list_sessions_joined(pool: &SqlitePool) -> DbResult<Vec<SessionJoinRow>> {
    let rows = sqlx::query_as::<_, SessionJoinRow>(
        "SELECT s.id, s.session_key, s.target_id, s.frame_ids, s.created_at,
                s.canonical_target_id, ct.primary_designation AS canonical_target_name
         FROM acquisition_session s
         LEFT JOIN canonical_target ct ON ct.id = s.canonical_target_id
         ORDER BY s.created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A single `acquisition_session` row by id.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn get_session_joined(pool: &SqlitePool, id: &str) -> DbResult<Option<SessionJoinRow>> {
    let row = sqlx::query_as::<_, SessionJoinRow>(
        "SELECT s.id, s.session_key, s.target_id, s.frame_ids, s.created_at,
                s.canonical_target_id, ct.primary_designation AS canonical_target_name
         FROM acquisition_session s
         LEFT JOIN canonical_target ct ON ct.id = s.canonical_target_id
         WHERE s.id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Row from `acquisition_fingerprint` supplementary metadata dimensions.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FingerprintRow {
    pub gain: Option<f64>,
    pub filter_name: Option<String>,
    pub binning: Option<String>,
    pub optic_train: Option<String>,
    pub observing_night_date: Option<String>,
}

/// `acquisition_fingerprint` row for a session, if present.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn get_fingerprint(
    pool: &SqlitePool,
    session_id: &str,
) -> DbResult<Option<FingerprintRow>> {
    let row = sqlx::query_as::<_, FingerprintRow>(
        "SELECT gain, filter_name, binning, optic_train, observing_night_date
         FROM acquisition_fingerprint
         WHERE id = ?",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Active (non-`missing`) `(count, total_size_bytes)` for a set of
/// `file_record` ids (spec 048 US1, INV-5). Empty `ids` short-circuits to
/// `(0, 0)` without querying.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn active_frame_summary(pool: &SqlitePool, ids: &[String]) -> DbResult<(i64, i64)> {
    if ids.is_empty() {
        return Ok((0, 0));
    }
    let mut builder = sqlx::QueryBuilder::new(
        "SELECT COUNT(*), COALESCE(SUM(size_bytes), 0) FROM file_record \
         WHERE state != 'missing' AND id IN (",
    );
    let mut separated = builder.separated(", ");
    for id in ids {
        separated.push_bind(id);
    }
    separated.push_unseparated(")");
    let (count, total): (i64, i64) = builder.build_query_as().fetch_one(pool).await?;
    Ok((count, total))
}

/// `project_id`s linked to a session via `project_sources`.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn project_ids_for_session(pool: &SqlitePool, session_id: &str) -> DbResult<Vec<String>> {
    let ids = sqlx::query_scalar::<_, String>(
        "SELECT project_id FROM project_sources WHERE inventory_session_id = ?",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    Ok(ids)
}

/// A `calibration_assignment` row.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct CalibrationAssignmentRow {
    pub master_id: String,
    pub calibration_type: String,
    pub confidence: f64,
    pub mismatched_dimensions: String,
}

/// Calibration matches assigned to a session.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn calibration_matches_for_session(
    pool: &SqlitePool,
    session_id: &str,
) -> DbResult<Vec<CalibrationAssignmentRow>> {
    let rows = sqlx::query_as::<_, CalibrationAssignmentRow>(
        "SELECT master_id, calibration_type, confidence, mismatched_dimensions
         FROM calibration_assignment
         WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A session's `audit_log_entry` history row.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AuditHistoryRow {
    pub at: String,
    pub trigger: String,
    pub actor: String,
}

/// Audit history for a session (`entity_type = 'acquisition_session'`),
/// oldest first.
///
/// # Errors
/// Returns [`crate::DbError::Database`] on query failure.
pub async fn session_history(
    pool: &SqlitePool,
    session_id: &str,
) -> DbResult<Vec<AuditHistoryRow>> {
    let rows = sqlx::query_as::<_, AuditHistoryRow>(
        "SELECT at, trigger, actor
         FROM audit_log_entry
         WHERE entity_type = 'acquisition_session' AND entity_id = ?
         ORDER BY at ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── Tests ────────────────────────────────────────────────────────────────────

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
    async fn frame_ids_absent_session_returns_none() {
        let db = setup().await;
        assert!(get_acquisition_session_frame_ids(db.pool(), "no-such").await.unwrap().is_none());
        assert!(get_calibration_session_frame_ids_and_kind(db.pool(), "no-such")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn file_records_by_ids_empty_short_circuits() {
        let db = setup().await;
        let rows = file_records_by_ids(db.pool(), &[]).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn active_frame_summary_empty_ids_short_circuits() {
        let db = setup().await;
        let (count, total) = active_frame_summary(db.pool(), &[]).await.unwrap();
        assert_eq!((count, total), (0, 0));
    }

    #[tokio::test]
    async fn mark_file_record_missing_updates_state() {
        let db = setup().await;
        sqlx::query(
            "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
             VALUES ('root-1', 'root-1', '/tmp', 'local', 'active', datetime('now'))",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO file_record \
                (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
             VALUES ('f-1', 'root-1', 'a.fits', 100, 't0', 'classified', 't0', 't0')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        mark_file_record_missing(db.pool(), "f-1").await.unwrap();

        let rows = file_records_by_root(db.pool(), "root-1").await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].state, "missing");
    }

    #[tokio::test]
    async fn search_and_recent_targets_roundtrip() {
        let db = setup().await;
        sqlx::query(
            "INSERT INTO canonical_target
                (id, simbad_oid, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at) \
             VALUES ('t-1', NULL, 'NGC 7000', 'nebula', 10.0, 20.0, 'seed', '2026-01-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let found = search_targets_by_like(db.pool(), "%ngc%").await.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, "t-1");

        let recent = recent_targets(db.pool()).await.unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].label, "NGC 7000");
    }

    #[tokio::test]
    async fn list_and_get_session_joined_roundtrip() {
        let db = setup().await;
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at) \
             VALUES ('s-1', '{}', '[]', '2026-01-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let all = list_sessions_joined(db.pool()).await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "s-1");

        let one = get_session_joined(db.pool(), "s-1").await.unwrap();
        assert!(one.is_some());
        assert!(get_session_joined(db.pool(), "missing").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn project_ids_for_session_empty_when_unlinked() {
        let db = setup().await;
        let ids = project_ids_for_session(db.pool(), "no-such").await.unwrap();
        assert!(ids.is_empty());
    }
}
