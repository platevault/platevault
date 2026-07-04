//! Shared per-frame `file_record` writer (spec 048 T002).
//!
//! Light-frame ingest ([`crate::ingest_sessions`]) and calibration-frame apply
//! (`app_core_inbox::plan_listener::register_master_if_applicable`) both need
//! to upsert a `file_record` row keyed by its UNIQUE `(root_id,
//! relative_path)`, capturing the REAL on-disk size and mtime at apply time
//! (spec 048 FR-001/FR-002) instead of the historical `size_bytes = 0`
//! placeholder. This module is the single writer both call so the fix lands
//! once and stays consistent (moved vs. catalogued vs. calibration frames are
//! recorded identically — spec 048 US1/T013).

use std::path::Path;

use sqlx::SqlitePool;
use time::format_description::well_known::Iso8601;
use time::OffsetDateTime;
use uuid::Uuid;

use contracts_core::error_code::ErrorCode;
use contracts_core::{ContractError, ErrorSeverity};

fn db_err(e: impl std::fmt::Display) -> ContractError {
    ContractError::new(ErrorCode::InternalDatabase, e.to_string(), ErrorSeverity::Fatal, true)
}

/// Stat `abs_path` for its real byte size and mtime (ISO-8601), used at apply
/// time so a frame is never recorded with `size_bytes = 0` (spec 048 FR-001).
///
/// Returns `None` if the file cannot be stat'd (e.g. removed between apply and
/// this call) — callers fall back to `0`/now rather than failing the frame;
/// reconciliation (US2) will correct it later.
#[must_use]
pub fn stat_frame(abs_path: &Path) -> Option<(i64, String)> {
    let meta = std::fs::metadata(abs_path).ok()?;
    let size = i64::try_from(meta.len()).unwrap_or(0);
    let mtime = meta
        .modified()
        .ok()
        .map(OffsetDateTime::from)
        .and_then(|t| t.format(&Iso8601::DEFAULT).ok())
        .unwrap_or_else(|| OffsetDateTime::now_utc().format(&Iso8601::DEFAULT).unwrap_or_default());
    Some((size, mtime))
}

/// Upsert a `file_record` by its UNIQUE `(root_id, relative_path)`, returning
/// its id. Reuses an existing row's id; (re)writes `state`, `size_bytes`, and
/// `mtime` to the given real (stat-based) values.
///
/// `size_bytes` MUST be the real on-disk size (via [`stat_frame`] or
/// equivalent) — never a `0` placeholder for a present frame (spec 048
/// FR-001/FR-002).
///
/// # Errors
///
/// Returns [`ContractError`] (`internal.database`) on a query failure.
pub async fn upsert_frame_record(
    pool: &SqlitePool,
    root_id: &str,
    relative_path: &str,
    size_bytes: i64,
    mtime: &str,
    state: &str,
) -> Result<String, ContractError> {
    if let Some((id,)) = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM file_record WHERE root_id = ? AND relative_path = ?",
    )
    .bind(root_id)
    .bind(relative_path)
    .fetch_optional(pool)
    .await
    .map_err(db_err)?
    {
        sqlx::query(
            "UPDATE file_record
             SET state = ?, size_bytes = ?, mtime = ?, last_seen_at = ?
             WHERE id = ?",
        )
        .bind(state)
        .bind(size_bytes)
        .bind(mtime)
        .bind(OffsetDateTime::now_utc().format(&Iso8601::DEFAULT).unwrap_or_default())
        .bind(&id)
        .execute(pool)
        .await
        .map_err(db_err)?;
        return Ok(id);
    }

    let id = Uuid::new_v4().to_string();
    let now = OffsetDateTime::now_utc().format(&Iso8601::DEFAULT).unwrap_or_default();
    sqlx::query(
        "INSERT INTO file_record
            (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(root_id)
    .bind(relative_path)
    .bind(size_bytes)
    .bind(mtime)
    .bind(state)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(db_err)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    async fn insert_root(pool: &SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO library_root (id, label, current_path, kind, state, created_at)
             VALUES (?, ?, '/tmp', 'local', 'active', datetime('now'))",
        )
        .bind(id)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn insert_writes_real_size_never_zero_placeholder() {
        let db = test_db().await;
        insert_root(db.pool(), "root-1").await;

        let id = upsert_frame_record(
            db.pool(),
            "root-1",
            "a.fits",
            12345,
            "2026-01-01T00:00:00Z",
            "classified",
        )
        .await
        .unwrap();

        let (size, state): (i64, String) =
            sqlx::query_as("SELECT size_bytes, state FROM file_record WHERE id = ?")
                .bind(&id)
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(size, 12345);
        assert_eq!(state, "classified");
    }

    #[tokio::test]
    async fn upsert_reuses_id_and_updates_size() {
        let db = test_db().await;
        insert_root(db.pool(), "root-1").await;

        let id1 = upsert_frame_record(db.pool(), "root-1", "a.fits", 100, "t0", "classified")
            .await
            .unwrap();
        let id2 = upsert_frame_record(db.pool(), "root-1", "a.fits", 200, "t1", "classified")
            .await
            .unwrap();
        assert_eq!(id1, id2);

        let (size,): (i64,) = sqlx::query_as("SELECT size_bytes FROM file_record WHERE id = ?")
            .bind(&id1)
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(size, 200);
    }
}
