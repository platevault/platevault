//! Repository methods for the guided first-project-flow state (spec 010, T003).
//!
//! Operates on the `guided_flow_state` singleton table from migration 0030.

use domain_core::ids::Timestamp;
use sqlx::SqlitePool;

use crate::DbResult;

// ── Row type ─────────────────────────────────────────────────────────────────

/// Raw persisted row from `guided_flow_state`.
#[derive(Clone, Debug)]
pub struct GuidedFlowRow {
    pub current_step_id: Option<String>,
    /// JSON-encoded array of completed step ids.
    pub completed_step_ids_json: String,
    pub dismissed: bool,
    pub dismissed_at: Option<String>,
    pub updated_at: String,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Public API ────────────────────────────────────────────────────────────────

/// Load the guided-flow state row.  Returns `None` when no row exists (first
/// app start before any guided-flow command runs).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn load(pool: &SqlitePool) -> DbResult<Option<GuidedFlowRow>> {
    let row: Option<(Option<String>, String, i64, Option<String>, String)> = sqlx::query_as(
        "SELECT current_step_id, completed_step_ids, dismissed, dismissed_at, updated_at \
         FROM guided_flow_state WHERE singleton_id = 'guided_flow'",
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(
        |(current_step_id, completed_step_ids_json, dismissed, dismissed_at, updated_at)| {
            GuidedFlowRow {
                current_step_id,
                completed_step_ids_json,
                dismissed: dismissed != 0,
                dismissed_at,
                updated_at,
            }
        },
    ))
}

/// Upsert the full guided-flow state row (used after every transition).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn upsert(
    pool: &SqlitePool,
    current_step_id: Option<&str>,
    completed_step_ids_json: &str,
    dismissed: bool,
    dismissed_at: Option<&str>,
) -> DbResult<String> {
    let now = Timestamp::now_iso();
    let dismissed_int = i64::from(dismissed);

    sqlx::query(
        "INSERT INTO guided_flow_state \
         (singleton_id, current_step_id, completed_step_ids, dismissed, dismissed_at, updated_at) \
         VALUES ('guided_flow', ?, ?, ?, ?, ?) \
         ON CONFLICT(singleton_id) DO UPDATE SET \
             current_step_id     = excluded.current_step_id, \
             completed_step_ids  = excluded.completed_step_ids, \
             dismissed           = excluded.dismissed, \
             dismissed_at        = excluded.dismissed_at, \
             updated_at          = excluded.updated_at",
    )
    .bind(current_step_id)
    .bind(completed_step_ids_json)
    .bind(dismissed_int)
    .bind(dismissed_at)
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(now)
}

/// Overwrite the row with a fresh Idle state (used after corruption recovery).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn reset_to_idle(pool: &SqlitePool) -> DbResult<()> {
    upsert(pool, None, "[]", false, None).await.map(|_| ())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;

    async fn setup() -> SqlitePool {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db.pool().clone()
    }

    #[tokio::test]
    async fn load_returns_none_when_no_row_exists() {
        let pool = setup().await;
        let row = load(&pool).await.unwrap();
        assert!(row.is_none());
    }

    #[tokio::test]
    async fn upsert_and_load_roundtrip() {
        let pool = setup().await;
        upsert(&pool, Some("inbox.confirm_first"), "[]", false, None).await.unwrap();
        let row = load(&pool).await.unwrap().expect("row should exist");
        assert_eq!(row.current_step_id.as_deref(), Some("inbox.confirm_first"));
        assert_eq!(row.completed_step_ids_json, "[]");
        assert!(!row.dismissed);
        assert!(row.dismissed_at.is_none());
    }

    #[tokio::test]
    async fn upsert_overwrites_on_conflict() {
        let pool = setup().await;
        upsert(&pool, Some("inbox.confirm_first"), "[]", false, None).await.unwrap();
        upsert(&pool, None, "[\"inbox.confirm_first\"]", false, None).await.unwrap();
        let row = load(&pool).await.unwrap().expect("row should exist");
        assert!(row.current_step_id.is_none());
        assert_eq!(row.completed_step_ids_json, "[\"inbox.confirm_first\"]");
    }

    #[tokio::test]
    async fn upsert_dismissed_state() {
        let pool = setup().await;
        let dismissed_at = "2026-06-11T12:00:00Z";
        upsert(&pool, None, "[\"inbox.confirm_first\"]", true, Some(dismissed_at)).await.unwrap();
        let row = load(&pool).await.unwrap().expect("row should exist");
        assert!(row.dismissed);
        assert_eq!(row.dismissed_at.as_deref(), Some(dismissed_at));
    }

    #[tokio::test]
    async fn reset_to_idle_clears_state() {
        let pool = setup().await;
        upsert(&pool, Some("project.create_first"), "[\"inbox.confirm_first\"]", false, None)
            .await
            .unwrap();
        reset_to_idle(&pool).await.unwrap();
        let row = load(&pool).await.unwrap().expect("row should exist after reset");
        assert!(row.current_step_id.is_none());
        assert_eq!(row.completed_step_ids_json, "[]");
        assert!(!row.dismissed);
    }
}
