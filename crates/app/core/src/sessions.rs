//! Session split and merge use cases.
//!
//! Stub implementations that will be wired to real persistence when the
//! session repository and domain logic are built.

use sqlx::SqlitePool;

/// Split a session by a given property, producing multiple new sessions.
///
/// # Errors
///
/// Currently returns a `NotImplemented` error. The real implementation will
/// split the session's framesets based on the given property (e.g. filter,
/// night, gain) and create new session records in the database.
#[allow(clippy::unused_async)] // will await DB queries when wired
pub async fn split_session(
    _pool: &SqlitePool,
    _session_id: &str,
    _split_property: &str,
) -> Result<Vec<String>, String> {
    Err("session.split: not yet implemented".to_owned())
}

/// Merge multiple sessions into a single combined session.
///
/// # Errors
///
/// Currently returns a `NotImplemented` error. The real implementation will
/// combine framesets from all source sessions, recalculate aggregates, and
/// persist the merged session.
#[allow(clippy::unused_async)] // will await DB queries when wired
pub async fn merge_sessions(_pool: &SqlitePool, _session_ids: &[String]) -> Result<String, String> {
    Err("session.merge: not yet implemented".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn split_session_returns_not_implemented() {
        // We cannot construct a real pool without a database, but we can
        // verify the stub contract by checking the error message pattern.
        // A real pool would be needed for integration tests.
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory pool");
        let result = split_session(&pool, "ses-001", "filter").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not yet implemented"));
    }

    #[tokio::test]
    async fn merge_sessions_returns_not_implemented() {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory pool");
        let ids = vec!["ses-001".to_owned(), "ses-002".to_owned()];
        let result = merge_sessions(&pool, &ids).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not yet implemented"));
    }
}
