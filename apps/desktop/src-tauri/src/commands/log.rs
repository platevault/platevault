//! Log stream and export Tauri commands (spec 019).
//!
//! ## Commands
//! - `log.recent` — pull the most-recent log entries from the durable events
//!   table (initial hydration window). Returns up to 500 entries oldest-first.
//! - `log.export` — write a filtered window of log entries to a JSON file.
//!
//! ## Live streaming
//! The bus→frontend forwarding is implemented via `start_log_forwarder`, which
//! is called from app setup and subscribes to the `EventBus` broadcast channel,
//! projecting each event to a `LogEntry` and emitting it as a `log:entry` Tauri
//! event. The frontend subscribes with `listen("log:entry", ...)`.
//!
//! **Startup seam note (deferred)**: the forwarder needs `AppHandle` (for
//! `emit`) and the `EventBus` (for `subscribe`). The current setup wires both
//! in `run_app`; see `start_log_forwarder` below. If the handle is not yet
//! available at state-init time, callers can defer the spawn until the first
//! window is created (`RunEvent::WindowEvent`). The pull path (`log.recent`)
//! is always real and delivers durable entries at any time.

use app_core::log_stream::{self, ExportOptions, RecentOptions};
use contracts_core::log::{
    LogEntry, LogEntrySource, LogExportResponse, LogLevel, LogRecentResponse,
    LOG_ENTRY_CONTRACT_VERSION,
};
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;

// ── log.recent ────────────────────────────────────────────────────────────────

/// `log.recent` — return the most-recent log entries (initial hydration window).
///
/// Accepts optional `cursor`, `level_min`, `include_diagnostics`, and
/// `source_filter` parameters.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn log_recent(
    state: State<'_, AppState>,
    cursor: Option<String>,
    level_min: Option<LogLevel>,
    include_diagnostics: Option<bool>,
    source_filter: Option<Vec<LogEntrySource>>,
    window_size: Option<usize>,
) -> Result<LogRecentResponse, ContractError> {
    let pool = state.repo.pool();

    // Parse the cursor into an event_id.
    let since_event_id: Option<i64> =
        cursor.as_deref().and_then(|c| c.strip_prefix("aud:").and_then(|n| n.parse::<i64>().ok()));

    // We need owned source_filter for the lifetime in options.
    let owned_filter: Vec<LogEntrySource> = source_filter.unwrap_or_default();
    let opts_window = window_size.unwrap_or(log_stream::LOG_BUFFER_SIZE);
    let opts_level_min = level_min;
    let opts_include_diag = include_diagnostics.unwrap_or(true);

    let options = RecentOptions {
        window_size: opts_window,
        level_min: opts_level_min,
        include_diagnostics: opts_include_diag,
        source_filter: &owned_filter,
        since_event_id,
    };

    let result = log_stream::recent_entries(pool, options).await.map_err(ContractError::from)?;

    Ok(LogRecentResponse {
        contract_version: LOG_ENTRY_CONTRACT_VERSION.to_owned(),
        truncated: result.truncated,
        truncated_count: result.truncated_count,
        entries: result.entries,
    })
}

// ── log.export ────────────────────────────────────────────────────────────────

/// `log.export` — export filtered log entries to a JSON file.
///
/// # Errors
/// Returns `Err(String)` with code `"path.parent.missing"`, `"path.write.denied"`,
/// `"range.invalid"`, or `"format.unsupported"`.
#[tauri::command]
#[specta::specta]
pub async fn log_export(
    state: State<'_, AppState>,
    request_id: String,
    file_path: String,
    format: Option<String>,
    level_min: Option<LogLevel>,
    since: Option<String>,
    until: Option<String>,
    include_diagnostics: Option<bool>,
) -> Result<LogExportResponse, ContractError> {
    // Validate format field (fixed to "json" in v1).
    if let Some(ref fmt) = format {
        if fmt != "json" {
            return Err(ContractError::new(
                contracts_core::error_code::ErrorCode::FormatUnsupported,
                "only \"json\" format is supported",
                contracts_core::ErrorSeverity::Blocking,
                false,
            ));
        }
    }

    // Validate time range when both bounds are provided.
    if let (Some(ref s), Some(ref u)) = (&since, &until) {
        if s >= u {
            return Err(ContractError::new(
                contracts_core::error_code::ErrorCode::RangeInvalid,
                "since must be before until",
                contracts_core::ErrorSeverity::Blocking,
                false,
            ));
        }
    }

    let pool = state.repo.pool();
    let options = ExportOptions {
        file_path: file_path.clone(),
        level_min,
        since,
        until,
        include_diagnostics: include_diagnostics.unwrap_or(false),
    };

    let (out_path, count, bytes) =
        log_stream::export_entries(pool, options).await.map_err(ContractError::from)?;

    Ok(LogExportResponse {
        status: "success".to_owned(),
        contract_version: LOG_ENTRY_CONTRACT_VERSION.to_owned(),
        request_id,
        file_path: out_path,
        count,
        bytes: Some(bytes),
    })
}

// ── Live bus→frontend forwarder ───────────────────────────────────────────────

/// Spawn a background task that subscribes to the `EventBus` broadcast channel
/// and emits each new event as a `log:entry` Tauri event.
///
/// On each broadcast signal the forwarder queries the `events` table for all
/// rows since its last-seen cursor, projecting them to `LogEntry` and emitting
/// them. This guarantees the correct `event_id` (and thus the correct `aud:<n>`
/// id) for every entry, matching what `log.recent` returns.
///
/// **Startup seam**: call this from `run_app` after both `AppHandle` and
/// `EventBus` are ready. Events emitted before this task starts are durably
/// stored and available via `log.recent` with no cursor.
pub fn start_log_forwarder(
    app_handle: tauri::AppHandle,
    bus: &audit::bus::EventBus,
    log_level: LogLevel,
    pool: sqlx::SqlitePool,
) {
    let mut rx = bus.subscribe();

    tokio::spawn(async move {
        let mut cursor: i64 = 0;
        let mut diag_seq: u64 = 0;

        // Initialise cursor to the current max event_id so we only emit new events.
        if let Ok((max_id,)) =
            sqlx::query_as::<_, (i64,)>("SELECT COALESCE(MAX(event_id), 0) FROM events")
                .fetch_one(&pool)
                .await
        {
            cursor = max_id;
        }

        loop {
            match rx.recv().await {
                Ok(_envelope) => {
                    // Query all new rows since cursor.
                    let rows: Result<Vec<(i64, String, String, String)>, _> =
                        sqlx::query_as::<_, (i64, String, String, String)>(
                            "SELECT event_id, topic, emitted_at, payload \
                             FROM events WHERE event_id > ? ORDER BY event_id ASC",
                        )
                        .bind(cursor)
                        .fetch_all(&pool)
                        .await;

                    match rows {
                        Ok(rows) => {
                            for (event_id, topic, emitted_at, payload_json) in rows {
                                cursor = cursor.max(event_id);
                                let entry = app_core::log_stream::project_event(
                                    event_id,
                                    &topic,
                                    &emitted_at,
                                    &payload_json,
                                );

                                // Gate on configured log level.
                                if entry.level.rank() < log_level.rank() {
                                    continue;
                                }

                                // Emit to the webview.
                                let _ = tauri::Emitter::emit(&app_handle, "log:entry", &entry);
                            }
                        }
                        Err(e) => {
                            tracing::warn!("log forwarder: db query failed: {e}");
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    tracing::debug!("log forwarder: broadcast channel closed");
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("log forwarder: lagged by {n} events");
                    // Emit a diagnostic entry for the lag gap.
                    diag_seq += 1;
                    let diag = LogEntry::diagnostic(
                        diag_seq,
                        LogLevel::Warn,
                        format!("Log stream lagged: {n} events dropped. Refresh to reload."),
                    );
                    let _ = tauri::Emitter::emit(&app_handle, "log:entry", &diag);
                }
            }
        }
    });
}
