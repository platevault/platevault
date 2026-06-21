//! Log stream and export use-case (spec 019).
//!
//! Provides:
//! - `recent_entries`: pull the N most-recent log entries from the durable
//!   `events` table (for the initial hydration window).
//! - `project_event`: projection helper mapping an event-bus row to a
//!   `LogEntry` (pure, deterministic, no I/O).
//! - `export_entries`: reads entries from the `events` table respecting
//!   `level_min`, `since`, `until`, and `include_diagnostics`, then writes
//!   a JSON file atomically (temp-file + rename).
//!
//! The live bus→frontend forwarding is handled by the Tauri adapter in
//! `apps/desktop/src-tauri/src/commands/log.rs` which subscribes to the
//! `EventBus` broadcast channel and emits `log:entry` Tauri events.
//!
//! Constitution V compliance: the `events` table is the durable record.
//! `LogEntry` is a derived projection; no new schema is introduced.

//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b) as a pure
//! leaf: it has zero `crate::` references and nothing else in `app_core`
//! references it. `app_core` re-exports this crate at `app_core::log_stream` so the
//! public surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use contracts_core::log::{LogEntry, LogEntrySource, LogExportErrorCode, LogLevel};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use sqlx::SqlitePool;

/// Size of the initial hydration window (matches the UI ring buffer).
pub const LOG_BUFFER_SIZE: usize = 500;

/// Contract error returned by use-case functions.
#[derive(Debug, thiserror::Error)]
pub enum LogError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialisation error: {0}")]
    Serialise(#[from] serde_json::Error),
    #[error("{code}: {message}")]
    Export { code: LogExportErrorCode, message: String },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl LogError {
    #[must_use]
    pub fn code_str(&self) -> &'static str {
        match self {
            Self::Export { code, .. } => match code {
                LogExportErrorCode::PathWriteDenied => "path.write.denied",
                LogExportErrorCode::PathParentMissing => "path.parent.missing",
                LogExportErrorCode::RangeInvalid => "range.invalid",
                LogExportErrorCode::FormatUnsupported => "format.unsupported",
            },
            Self::Database(_) => "database.error",
            Self::Serialise(_) => "serialise.error",
            Self::Io(_) => "io.error",
        }
    }
}

/// Convert a `LogError` to a `ContractError`.
impl From<LogError> for ContractError {
    fn from(e: LogError) -> Self {
        match e {
            LogError::Export { code, message } => {
                let error_code = match code {
                    LogExportErrorCode::FormatUnsupported => ErrorCode::FormatUnsupported,
                    LogExportErrorCode::RangeInvalid => ErrorCode::RangeInvalid,
                    LogExportErrorCode::PathWriteDenied => ErrorCode::PathWriteDenied,
                    LogExportErrorCode::PathParentMissing => ErrorCode::PathParentMissing,
                };
                ContractError::new(error_code, message, ErrorSeverity::Blocking, false)
            }
            LogError::Database(db_err) => ContractError::new(
                ErrorCode::DatabaseError,
                db_err.to_string(),
                ErrorSeverity::Fatal,
                true,
            ),
            LogError::Serialise(e) => ContractError::new(
                ErrorCode::SerialiseError,
                e.to_string(),
                ErrorSeverity::Fatal,
                false,
            ),
            LogError::Io(e) => {
                ContractError::new(ErrorCode::IoError, e.to_string(), ErrorSeverity::Fatal, false)
            }
        }
    }
}

// ── Level ordering ────────────────────────────────────────────────────────────

fn level_passes(entry_level: LogLevel, level_min: Option<LogLevel>) -> bool {
    match level_min {
        None => true,
        Some(min) => entry_level.rank() >= min.rank(),
    }
}

fn source_passes(entry_source: LogEntrySource, source_filter: &[LogEntrySource]) -> bool {
    if source_filter.is_empty() {
        return true;
    }
    source_filter.contains(&entry_source)
}

// ── Projection ────────────────────────────────────────────────────────────────

/// Project one row from the `events` table into a `LogEntry`.
///
/// `event_id` is the SQLite rowid; it becomes the `aud:<n>` id.
///
/// This function is pure and deterministic — no I/O.
#[must_use]
pub fn project_event(event_id: i64, topic: &str, emitted_at: &str, payload_json: &str) -> LogEntry {
    let payload: serde_json::Value = serde_json::from_str(payload_json)
        .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));
    LogEntry::from_event_bus(event_id, topic, emitted_at, &payload)
}

// ── Recent entries (pull) ─────────────────────────────────────────────────────

/// Options for pulling recent entries.
pub struct RecentOptions<'a> {
    pub window_size: usize,
    pub level_min: Option<LogLevel>,
    pub include_diagnostics: bool,
    pub source_filter: &'a [LogEntrySource],
    /// If `Some`, only entries with `event_id > cursor_event_id` are returned.
    pub since_event_id: Option<i64>,
}

impl Default for RecentOptions<'_> {
    fn default() -> Self {
        Self {
            window_size: LOG_BUFFER_SIZE,
            level_min: None,
            include_diagnostics: true,
            source_filter: &[],
            since_event_id: None,
        }
    }
}

/// Pull the most-recent log entries from the `events` table.
///
/// Returns at most `options.window_size` entries (default 500), ordered
/// oldest-first for UI appending.
///
/// When `options.since_event_id` is set, only entries with
/// `event_id > since_event_id` are returned (cursor-based resume).
///
/// # Errors
/// Returns `LogError::Database` if the query fails.
pub async fn recent_entries(
    pool: &SqlitePool,
    options: RecentOptions<'_>,
) -> Result<Vec<LogEntry>, LogError> {
    let limit = i64::try_from(options.window_size.min(LOG_BUFFER_SIZE)).unwrap_or(500);
    let since_id = options.since_event_id.unwrap_or(0);

    // Fetch the most recent N rows ordered by event_id descending, then
    // reverse for oldest-first output.
    let rows: Vec<(i64, String, String, String)> =
        sqlx::query_as::<_, (i64, String, String, String)>(
            "SELECT event_id, topic, emitted_at, payload \
         FROM events \
         WHERE event_id > ? \
         ORDER BY event_id DESC \
         LIMIT ?",
        )
        .bind(since_id)
        .bind(limit)
        .fetch_all(pool)
        .await?;

    let mut entries: Vec<LogEntry> = rows
        .into_iter()
        .rev() // oldest-first
        .map(|(eid, topic, emitted_at, payload_json)| {
            project_event(eid, &topic, &emitted_at, &payload_json)
        })
        .filter(|e| {
            // Apply level filter.
            if !level_passes(e.level, options.level_min) {
                return false;
            }
            // Apply source filter.
            if !source_passes(e.source, options.source_filter) {
                return false;
            }
            // Apply diagnostics gate.
            if !options.include_diagnostics && e.source == LogEntrySource::Diagnostic {
                return false;
            }
            true
        })
        .collect();

    // Truncate to window_size after filtering.
    let cap = options.window_size.min(LOG_BUFFER_SIZE);
    if entries.len() > cap {
        let drain_count = entries.len() - cap;
        entries.drain(0..drain_count);
    }

    Ok(entries)
}

// ── Export ────────────────────────────────────────────────────────────────────

/// Options for exporting log entries.
pub struct ExportOptions {
    pub file_path: String,
    pub level_min: Option<LogLevel>,
    /// ISO-8601 lower bound (inclusive).
    pub since: Option<String>,
    /// ISO-8601 upper bound (exclusive).
    pub until: Option<String>,
    pub include_diagnostics: bool,
}

/// Export matching log entries to a JSON file at `options.file_path`.
///
/// Writes atomically: entries are serialised to a temp file in the same parent
/// directory, then renamed into place.
///
/// # Errors
/// Returns `LogError::Export` for filesystem / format problems.
/// Returns `LogError::Database` on query failure.
pub async fn export_entries(
    pool: &SqlitePool,
    options: ExportOptions,
) -> Result<(String, usize, u64), LogError> {
    use std::io::Write;
    use std::path::Path;

    let dest = Path::new(&options.file_path);

    // Validate parent directory.
    let parent = dest.parent().ok_or_else(|| LogError::Export {
        code: LogExportErrorCode::PathParentMissing,
        message: format!("No parent directory for path {}", dest.display()),
    })?;
    if !parent.exists() {
        return Err(LogError::Export {
            code: LogExportErrorCode::PathParentMissing,
            message: format!("Parent directory does not exist: {}", parent.display()),
        });
    }

    // Build query with optional time bounds.
    let rows: Vec<(i64, String, String, String)> = match (&options.since, &options.until) {
        (Some(s), Some(u)) => {
            sqlx::query_as::<_, (i64, String, String, String)>(
                "SELECT event_id, topic, emitted_at, payload \
             FROM events WHERE emitted_at >= ? AND emitted_at < ? \
             ORDER BY event_id ASC",
            )
            .bind(s)
            .bind(u)
            .fetch_all(pool)
            .await?
        }
        (Some(s), None) => {
            sqlx::query_as::<_, (i64, String, String, String)>(
                "SELECT event_id, topic, emitted_at, payload \
             FROM events WHERE emitted_at >= ? \
             ORDER BY event_id ASC",
            )
            .bind(s)
            .fetch_all(pool)
            .await?
        }
        (None, Some(u)) => {
            sqlx::query_as::<_, (i64, String, String, String)>(
                "SELECT event_id, topic, emitted_at, payload \
             FROM events WHERE emitted_at < ? \
             ORDER BY event_id ASC",
            )
            .bind(u)
            .fetch_all(pool)
            .await?
        }
        (None, None) => {
            sqlx::query_as::<_, (i64, String, String, String)>(
                "SELECT event_id, topic, emitted_at, payload \
             FROM events ORDER BY event_id ASC",
            )
            .fetch_all(pool)
            .await?
        }
    };

    let entries: Vec<LogEntry> = rows
        .into_iter()
        .map(|(eid, topic, emitted_at, payload_json)| {
            project_event(eid, &topic, &emitted_at, &payload_json)
        })
        .filter(|e| {
            if !level_passes(e.level, options.level_min) {
                return false;
            }
            if !options.include_diagnostics && e.source == LogEntrySource::Diagnostic {
                return false;
            }
            true
        })
        .collect();

    let count = entries.len();

    // Serialise to JSON array.
    let json_bytes = serde_json::to_vec_pretty(&entries).map_err(LogError::Serialise)?;

    // Write to temp file then rename (atomic write).
    let tmp_path = format!("{}.tmp", options.file_path);
    let mut tmp_file = std::fs::File::create(&tmp_path).map_err(|_e| LogError::Export {
        code: LogExportErrorCode::PathWriteDenied,
        message: format!("Cannot write to path: {}", dest.display()),
    })?;
    tmp_file.write_all(&json_bytes).map_err(LogError::Io)?;
    drop(tmp_file);

    std::fs::rename(&tmp_path, dest).map_err(|_e| LogError::Export {
        code: LogExportErrorCode::PathWriteDenied,
        message: format!("Cannot rename temp file to: {}", dest.display()),
    })?;

    let bytes = u64::try_from(json_bytes.len()).unwrap_or(0);
    Ok((options.file_path, count, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    async fn make_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory pool");
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS events (\
             event_id INTEGER PRIMARY KEY AUTOINCREMENT,\
             topic TEXT NOT NULL,\
             source TEXT NOT NULL DEFAULT 'system',\
             emitted_at TEXT NOT NULL,\
             payload TEXT NOT NULL\
             )",
        )
        .execute(&pool)
        .await
        .expect("create events table");
        pool
    }

    async fn insert_event(pool: &SqlitePool, topic: &str, payload_json: &str) {
        sqlx::query("INSERT INTO events (topic, source, emitted_at, payload) VALUES (?, 'system', '2026-01-01T00:00:00Z', ?)")
            .bind(topic)
            .bind(payload_json)
            .execute(pool)
            .await
            .expect("insert event");
    }

    #[tokio::test]
    async fn recent_entries_returns_oldest_first() {
        let pool = make_pool().await;
        insert_event(&pool, "plan.approved", r#"{"plan_id":"p1"}"#).await;
        insert_event(&pool, "settings.changed", r#"{"key":"logLevel"}"#).await;

        let entries = recent_entries(&pool, RecentOptions::default()).await.unwrap();
        assert_eq!(entries.len(), 2);
        // Oldest first: plan.approved came first.
        assert_eq!(entries[0].source, LogEntrySource::Plan);
        assert_eq!(entries[1].source, LogEntrySource::Settings);
    }

    #[tokio::test]
    async fn recent_entries_respects_level_min() {
        let pool = make_pool().await;
        insert_event(&pool, "plan.approved", "{}").await; // info
        insert_event(&pool, "catalog.download.failed", r#"{"message":"net error"}"#).await; // error

        let entries = recent_entries(
            &pool,
            RecentOptions { level_min: Some(LogLevel::Warn), ..Default::default() },
        )
        .await
        .unwrap();

        // Only error-level entry should pass warn+ filter.
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, LogLevel::Error);
    }

    #[tokio::test]
    async fn recent_entries_respects_window_size() {
        let pool = make_pool().await;
        for i in 0..10 {
            insert_event(&pool, "plan.approved", &format!(r#"{{"plan_id":"p{i}"}}"#)).await;
        }

        let entries = recent_entries(&pool, RecentOptions { window_size: 3, ..Default::default() })
            .await
            .unwrap();
        assert_eq!(entries.len(), 3);
    }

    #[tokio::test]
    async fn recent_entries_cursor_resume() {
        let pool = make_pool().await;
        insert_event(&pool, "plan.approved", r#"{"plan_id":"p1"}"#).await;
        insert_event(&pool, "plan.approved", r#"{"plan_id":"p2"}"#).await;
        insert_event(&pool, "plan.approved", r#"{"plan_id":"p3"}"#).await;

        // Get first two entries.
        let all = recent_entries(&pool, RecentOptions::default()).await.unwrap();
        assert_eq!(all.len(), 3);

        // Parse cursor from second entry id: "aud:2"
        let cursor_id: i64 = all[1].id.strip_prefix("aud:").unwrap().parse().unwrap();

        let resumed = recent_entries(
            &pool,
            RecentOptions { since_event_id: Some(cursor_id), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(resumed.len(), 1);
        assert_eq!(resumed[0].id, format!("aud:{}", cursor_id + 1));
    }

    #[tokio::test]
    async fn project_event_plan_approved() {
        let payload = r#"{"plan_id":"abc","actor":"user","approved_at":"2026-01-01T00:00:00Z"}"#;
        let entry = project_event(10, "plan.approved", "2026-01-01T00:00:00Z", payload);
        assert_eq!(entry.id, "aud:10");
        assert_eq!(entry.source, LogEntrySource::Plan);
        assert_eq!(entry.level, LogLevel::Info);
        assert_eq!(entry.entity_type, Some("plan".to_owned()));
        assert_eq!(entry.entity_id, Some("abc".to_owned()));
    }

    #[tokio::test]
    async fn project_event_failed_topic_gives_error_level() {
        let payload =
            r#"{"catalog_id":"ngc","error_code":"network_timeout","message":"timed out"}"#;
        let entry = project_event(5, "catalog.download.failed", "2026-01-01T00:00:00Z", payload);
        assert_eq!(entry.level, LogLevel::Error);
        assert_eq!(entry.source, LogEntrySource::Catalog);
        assert_eq!(entry.message, "timed out");
    }

    #[tokio::test]
    async fn project_event_settings_changed_has_settings_source() {
        let payload = r#"{"key":"logLevel","prior_value":"info","new_value":"debug","at":"2026-01-01T00:00:00Z"}"#;
        let entry = project_event(3, "settings.changed", "2026-01-01T00:00:00Z", payload);
        assert_eq!(entry.source, LogEntrySource::Settings);
    }

    #[tokio::test]
    async fn source_filter_applied() {
        let pool = make_pool().await;
        insert_event(&pool, "plan.approved", "{}").await;
        insert_event(&pool, "settings.changed", "{}").await;
        insert_event(&pool, "catalog.download.started", "{}").await;

        let entries = recent_entries(
            &pool,
            RecentOptions { source_filter: &[LogEntrySource::Plan], ..Default::default() },
        )
        .await
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, LogEntrySource::Plan);
    }

    #[tokio::test]
    async fn export_entries_writes_json_file() {
        let pool = make_pool().await;
        insert_event(&pool, "plan.approved", r#"{"plan_id":"p1"}"#).await;
        insert_event(&pool, "plan.approved", r#"{"plan_id":"p2"}"#).await;

        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("export.json").to_string_lossy().into_owned();

        let (out_path, count, bytes) = export_entries(
            &pool,
            ExportOptions {
                file_path: path.clone(),
                level_min: None,
                since: None,
                until: None,
                include_diagnostics: false,
            },
        )
        .await
        .unwrap();

        assert_eq!(out_path, path);
        assert_eq!(count, 2);
        assert!(bytes > 0);

        let content = std::fs::read_to_string(&path).unwrap();
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed.len(), 2);
    }

    #[tokio::test]
    async fn export_entries_level_min_filter() {
        let pool = make_pool().await;
        insert_event(&pool, "plan.approved", "{}").await; // info
        insert_event(&pool, "catalog.download.failed", r#"{"message":"err"}"#).await; // error

        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("export_warn.json").to_string_lossy().into_owned();

        let (_out_path, count, _bytes) = export_entries(
            &pool,
            ExportOptions {
                file_path: path,
                level_min: Some(LogLevel::Warn),
                since: None,
                until: None,
                include_diagnostics: false,
            },
        )
        .await
        .unwrap();

        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn export_entries_parent_missing_returns_error() {
        let pool = make_pool().await;
        let result = export_entries(
            &pool,
            ExportOptions {
                file_path: "/nonexistent/path/export.json".to_owned(),
                level_min: None,
                since: None,
                until: None,
                include_diagnostics: false,
            },
        )
        .await;
        assert!(result.is_err());
        if let Err(LogError::Export { code, .. }) = result {
            assert_eq!(code, LogExportErrorCode::PathParentMissing);
        } else {
            panic!("expected LogError::Export");
        }
    }
}
