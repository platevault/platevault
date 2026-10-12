// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Log stream and export Tauri commands (spec 019).
//!
//! ## Commands
//! - `log.recent` — pull the most-recent log entries from the durable events
//!   table (initial hydration window). Returns up to 500 entries oldest-first.
//! - `log.export` — write a filtered window of log entries to a JSON file.
//!
//! ## Live streaming
//! `desktop_services::log_stream::LogFeed` projects each durable event to a
//! `LogEntry`; `run_app` forwards that feed as the [`LOG_ENTRY_EVENT`] Tauri
//! event. The frontend subscribes with `listen("log:entry", ...)`. The pull
//! path (`log.recent`) is always real and delivers durable entries at any
//! time.

use app_core::log_stream::{self, ExportOptions, RecentOptions};
use contracts_core::log::{
    LogEntrySource, LogExportResponse, LogLevel, LogRecentResponse, LOG_ENTRY_CONTRACT_VERSION,
};
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;

/// Tauri event carrying one live `LogEntry`.
pub const LOG_ENTRY_EVENT: &str = "log:entry";

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
/// Returns `Err(ContractError)` with code `path.parent.missing`,
/// `path.write.denied`, `range.invalid`, or `format.unsupported`.
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
