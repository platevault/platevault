// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Log stream and export contract DTOs (spec 019).
//!
//! Mirrors the JSON Schemas in `specs/019-bottom-log-viewer/contracts/`.
//!
//! `LogEntry` is the projection of an audit event (or a diagnostic event) into
//! the UI stream. `LogStreamRequest` / `LogStreamEvent` cover the stream
//! subscription contract. `LogExportRequest` / `LogExportResponse` cover the
//! export contract.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Schema version for this `LogEntry` shape (H1).
pub const LOG_ENTRY_CONTRACT_VERSION: &str = "2.0.0";

/// Source of a log entry: derived from the spec 002 event-bus topic prefix.
///
/// Closed enum aligned to the `source` field in `log.stream.json`
/// (R-SourceEnum). `Diagnostic` entries bypass audit and are never persisted.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum LogEntrySource {
    Audit,
    Diagnostic,
    Catalog,
    Plan,
    Workflow,
    Lifecycle,
    Inventory,
    Settings,
    Project,
    Target,
    Tool,
}

impl LogEntrySource {
    /// Derive the source tag from an event-bus topic string.
    ///
    /// Returns `None` when the topic does not match any known prefix; callers
    /// should fall back to `LogEntrySource::Audit`.
    #[must_use]
    pub fn from_topic(topic: &str) -> Option<Self> {
        if topic.starts_with("catalog.") {
            Some(Self::Catalog)
        } else if topic.starts_with("plan.") || topic.starts_with("archive.") {
            Some(Self::Plan)
        } else if topic.starts_with("workflow.") || topic.starts_with("artifact.") {
            Some(Self::Workflow)
        } else if topic.starts_with("lifecycle.") {
            Some(Self::Lifecycle)
        } else if topic.starts_with("inventory.") {
            Some(Self::Inventory)
        } else if topic.starts_with("settings.") {
            Some(Self::Settings)
        } else if topic.starts_with("project.") {
            Some(Self::Project)
        } else if topic.starts_with("target.") {
            Some(Self::Target)
        } else if topic.starts_with("tool.") {
            Some(Self::Tool)
        } else if topic.starts_with("audit.")
            || topic.starts_with("native.")
            || topic.starts_with("first_run.")
            || topic.starts_with("protection.")
        {
            Some(Self::Audit)
        } else {
            None
        }
    }
}

/// Minimum log level filter.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    /// Numeric rank; higher = more severe (for `level_min` filtering).
    #[must_use]
    pub const fn rank(self) -> u8 {
        match self {
            Self::Debug => 0,
            Self::Info => 1,
            Self::Warn => 2,
            Self::Error => 3,
        }
    }

    /// Derive a level from an event-bus topic or payload inspection.
    /// Defaults to `Info` for unknown topics.
    #[must_use]
    pub fn from_topic_and_payload(topic: &str, payload: &serde_json::Value) -> Self {
        // Error-indicator suffixes (dot-separated topic segments, not file extensions).
        #[allow(clippy::case_sensitive_file_extension_comparisons)]
        let is_error_topic =
            topic.ends_with(".failed") || topic.ends_with(".error") || topic.ends_with(".denied");
        if is_error_topic {
            return Self::Error;
        }
        // Warn-indicator suffixes.
        #[allow(clippy::case_sensitive_file_extension_comparisons)]
        let is_warn_topic = topic.ends_with(".warn")
            || topic.ends_with(".repair")
            || topic.ends_with(".missing")
            || topic.ends_with(".stale")
            || topic.ends_with(".lagged")
            || topic.ends_with(".invalid");
        if is_warn_topic {
            return Self::Warn;
        }
        // Debug-indicator suffixes.
        if topic.ends_with(".progress") || topic.ends_with(".snapshot") {
            return Self::Debug;
        }
        // Check payload for explicit level fields.
        if let Some(level_str) = payload.get("level").and_then(|v| v.as_str()) {
            match level_str {
                "error" => return Self::Error,
                "warn" => return Self::Warn,
                "debug" | "trace" => return Self::Debug,
                _ => {}
            }
        }
        Self::Info
    }
}

/// A projected log entry sent to the frontend.
///
/// Stable shape; `contractVersion` is always `"2.0.0"` for this spec version (H1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Stable prefixed id: `aud:<event_id>` for audit-sourced entries,
    /// `dia:<monotonic_n>` for diagnostic entries (A1).
    pub id: String,
    /// Schema version. Always `"2.0.0"`.
    pub contract_version: String,
    /// ISO-8601 UTC timestamp at server-side emission.
    pub time: String,
    pub level: LogLevel,
    pub source: LogEntrySource,
    /// Single-line human-readable summary. No newlines.
    pub message: String,
    /// Operation id correlating one user intent across multiple events.
    /// Required for workflow events; optional for diagnostics.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// Referenced entity kind (e.g. `"plan"`, `"project"`, `"session"`).
    /// Omitted for diagnostics and events without an entity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    /// Stable id of the referenced entity. Present when `entity_type` is present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,
}

impl LogEntry {
    /// Build a minimal `LogEntry` for an audit-sourced event.
    #[must_use]
    pub fn from_event_bus(
        aud_id: i64,
        topic: &str,
        emitted_at: &str,
        payload: &serde_json::Value,
    ) -> Self {
        let level = LogLevel::from_topic_and_payload(topic, payload);
        let source = LogEntrySource::from_topic(topic).unwrap_or(LogEntrySource::Audit);
        let message = extract_message(topic, payload);
        let request_id = extract_request_id(payload);
        let (entity_type, entity_id) = extract_entity(topic, payload);

        Self {
            id: format!("aud:{aud_id}"),
            contract_version: LOG_ENTRY_CONTRACT_VERSION.to_owned(),
            time: emitted_at.to_owned(),
            level,
            source,
            message,
            request_id,
            entity_type,
            entity_id,
        }
    }

    /// Build a diagnostic `LogEntry` that never reaches audit.
    #[must_use]
    pub fn diagnostic(seq: u64, level: LogLevel, message: impl Into<String>) -> Self {
        Self {
            id: format!("dia:{seq}"),
            contract_version: LOG_ENTRY_CONTRACT_VERSION.to_owned(),
            time: chrono_now_utc(),
            level,
            source: LogEntrySource::Diagnostic,
            message: message.into(),
            request_id: None,
            entity_type: None,
            entity_id: None,
        }
    }
}

// ── Projection helpers ────────────────────────────────────────────────────────

fn extract_message(topic: &str, payload: &serde_json::Value) -> String {
    // Check common message fields in payload first.
    for field in &["message", "msg", "summary", "detail", "reason", "error_code"] {
        if let Some(s) = payload.get(*field).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return s.to_owned();
            }
        }
    }
    // Fallback: derive from topic.
    topic_to_human(topic)
}

fn topic_to_human(topic: &str) -> String {
    // Replace dots with spaces and dots-separated last segment.
    topic.replace('.', " ")
}

fn extract_request_id(payload: &serde_json::Value) -> Option<String> {
    for field in &["request_id", "requestId", "run_id", "runId", "launch_id", "launchId"] {
        if let Some(s) = payload.get(*field).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return Some(s.to_owned());
            }
        }
    }
    None
}

fn extract_entity(topic: &str, payload: &serde_json::Value) -> (Option<String>, Option<String>) {
    // Try explicit entity_type / entity_id first.
    let et = payload
        .get("entity_type")
        .or_else(|| payload.get("entityType"))
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    let ei = payload
        .get("entity_id")
        .or_else(|| payload.get("entityId"))
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    if et.is_some() && ei.is_some() {
        return (et, ei);
    }

    // Try well-known id fields.
    let plan_id = payload.get("plan_id").or_else(|| payload.get("planId")).and_then(|v| v.as_str());
    if let Some(id) = plan_id {
        return (Some("plan".to_owned()), Some(id.to_owned()));
    }
    let project_id =
        payload.get("project_id").or_else(|| payload.get("projectId")).and_then(|v| v.as_str());
    if let Some(id) = project_id {
        return (Some("project".to_owned()), Some(id.to_owned()));
    }
    let artifact_id =
        payload.get("artifact_id").or_else(|| payload.get("artifactId")).and_then(|v| v.as_str());
    if let Some(id) = artifact_id {
        return (Some("artifact".to_owned()), Some(id.to_owned()));
    }
    let catalog_id =
        payload.get("catalog_id").or_else(|| payload.get("catalogId")).and_then(|v| v.as_str());
    if let Some(id) = catalog_id {
        return (Some("catalog".to_owned()), Some(id.to_owned()));
    }

    // Fall back to topic-based inference.
    let entity_type = if topic.starts_with("plan.") || topic.starts_with("archive.") {
        Some("plan".to_owned())
    } else if topic.starts_with("catalog.") {
        Some("catalog".to_owned())
    } else if topic.starts_with("artifact.") || topic.starts_with("workflow.") {
        Some("artifact".to_owned())
    } else {
        None
    };
    (entity_type, None)
}

/// ISO-8601 UTC timestamp, whole-second precision: `YYYY-MM-DDTHH:MM:SSZ`.
fn chrono_now_utc() -> String {
    let now = time::OffsetDateTime::now_utc()
        // Match the previous whole-seconds-only output (no subsecond noise
        // in log entries); 0 is always a valid nanosecond value.
        .replace_nanosecond(0)
        .expect("0 is always a valid nanosecond");
    now.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

// ── Stream request / event types ──────────────────────────────────────────────

/// Request to open a log stream subscription.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogStreamRequest {
    pub contract_version: String,
    pub request_id: String,
    /// Opaque cursor of the last received `LogEntry.id`. Omit for the most
    /// recent window (up to `window_size`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Minimum level filter (server-side). Defaults to `debug`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_min: Option<LogLevel>,
    /// Include `source = "diagnostic"` entries. Defaults to `true` for the
    /// live stream; defaults to `false` for export.
    #[serde(default = "default_true")]
    pub include_diagnostics: bool,
    /// Filter to specific sources. Omit to receive all sources.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_filter: Option<Vec<LogEntrySource>>,
    /// Initial window size on a no-cursor subscription. Max 500.
    #[serde(default = "default_window_size")]
    pub window_size: usize,
}

fn default_true() -> bool {
    true
}

fn default_window_size() -> usize {
    500
}

/// Streamed event pushed from the backend to the frontend.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogStreamEvent {
    pub contract_version: String,
    pub added: Vec<LogEntry>,
    /// True when the requested cursor predates the oldest retained entry
    /// (audit vacuum gap). The UI renders an inline "History gap" marker (A4).
    #[serde(default)]
    pub truncated: bool,
    /// Estimated count of entries before the oldest retained entry.
    /// `None` when the audit vacuum does not record counts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated_count: Option<i64>,
}

// ── Recent entries query ───────────────────────────────────────────────────────

/// Response from `log.recent` (pull rather than stream).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogRecentResponse {
    pub contract_version: String,
    pub entries: Vec<LogEntry>,
    #[serde(default)]
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated_count: Option<i64>,
}

// ── Export request / response ─────────────────────────────────────────────────

/// Request to export log entries to a file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogExportRequest {
    pub contract_version: String,
    pub request_id: String,
    /// Absolute path where the JSON file should be written.
    pub file_path: String,
    /// Fixed to `"json"` in v1.
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_min: Option<LogLevel>,
    /// ISO-8601 lower bound on entry time (inclusive).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    /// ISO-8601 upper bound on entry time (exclusive).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    /// Include `source = "diagnostic"` entries. Defaults to `false` for
    /// exports (A2).
    #[serde(default)]
    pub include_diagnostics: bool,
}

/// Success response from `log.export`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LogExportResponse {
    /// Outcome discriminator. Always `"success"` when the Tauri command returns `Ok`.
    pub status: String,
    pub contract_version: String,
    pub request_id: String,
    /// Absolute path of the written file.
    pub file_path: String,
    /// Number of `LogEntry` rows written.
    pub count: usize,
    /// Byte size of the written file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
}

/// Error codes for `log.export`.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum LogExportErrorCode {
    PathWriteDenied,
    PathParentMissing,
    RangeInvalid,
    FormatUnsupported,
}

impl std::fmt::Display for LogExportErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::PathWriteDenied => "path.write.denied",
            Self::PathParentMissing => "path.parent.missing",
            Self::RangeInvalid => "range.invalid",
            Self::FormatUnsupported => "format.unsupported",
        };
        f.write_str(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn log_entry_source_from_topic_plan() {
        assert_eq!(LogEntrySource::from_topic("plan.approved"), Some(LogEntrySource::Plan));
        assert_eq!(LogEntrySource::from_topic("archive.sent_to_trash"), Some(LogEntrySource::Plan));
    }

    #[test]
    fn log_entry_source_from_topic_catalog() {
        assert_eq!(
            LogEntrySource::from_topic("catalog.download.started"),
            Some(LogEntrySource::Catalog)
        );
    }

    #[test]
    fn log_entry_source_from_topic_workflow() {
        assert_eq!(
            LogEntrySource::from_topic("workflow.run_completed"),
            Some(LogEntrySource::Workflow)
        );
        assert_eq!(LogEntrySource::from_topic("artifact.detected"), Some(LogEntrySource::Workflow));
    }

    #[test]
    fn log_entry_source_from_topic_settings() {
        assert_eq!(LogEntrySource::from_topic("settings.changed"), Some(LogEntrySource::Settings));
    }

    #[test]
    fn log_entry_source_from_topic_lifecycle() {
        assert_eq!(
            LogEntrySource::from_topic("lifecycle.transition.applied"),
            Some(LogEntrySource::Lifecycle)
        );
    }

    #[test]
    fn log_entry_source_from_topic_tool() {
        assert_eq!(LogEntrySource::from_topic("tool.launch"), Some(LogEntrySource::Tool));
    }

    #[test]
    fn log_entry_source_from_topic_native() {
        assert_eq!(LogEntrySource::from_topic("native.picker.failed"), Some(LogEntrySource::Audit));
    }

    #[test]
    fn log_entry_source_from_topic_unknown() {
        assert_eq!(LogEntrySource::from_topic("unknown.topic"), None);
    }

    #[test]
    fn log_level_from_topic_failed_suffix() {
        let level = LogLevel::from_topic_and_payload("catalog.download.failed", &json!({}));
        assert_eq!(level, LogLevel::Error);
    }

    #[test]
    fn log_level_from_topic_progress_suffix() {
        let level = LogLevel::from_topic_and_payload("plan.item.progress", &json!({}));
        assert_eq!(level, LogLevel::Debug);
    }

    #[test]
    fn log_level_from_topic_warn_suffix() {
        let level = LogLevel::from_topic_and_payload("settings.repair", &json!({}));
        assert_eq!(level, LogLevel::Warn);
    }

    #[test]
    fn log_level_rank_ordering() {
        assert!(LogLevel::Debug.rank() < LogLevel::Info.rank());
        assert!(LogLevel::Info.rank() < LogLevel::Warn.rank());
        assert!(LogLevel::Warn.rank() < LogLevel::Error.rank());
    }

    #[test]
    fn from_event_bus_builds_entry_with_plan_id() {
        let payload = json!({ "plan_id": "plan-abc", "actor": "user", "approved_at": "2026-01-01T00:00:00Z" });
        let entry = LogEntry::from_event_bus(42, "plan.approved", "2026-01-01T00:00:00Z", &payload);
        assert_eq!(entry.id, "aud:42");
        assert_eq!(entry.contract_version, "2.0.0");
        assert_eq!(entry.source, LogEntrySource::Plan);
        assert_eq!(entry.entity_type, Some("plan".to_owned()));
        assert_eq!(entry.entity_id, Some("plan-abc".to_owned()));
    }

    #[test]
    fn from_event_bus_extracts_message_field() {
        let payload = json!({ "message": "Catalog downloaded", "catalog_id": "ngc" });
        let entry = LogEntry::from_event_bus(
            7,
            "catalog.download.completed",
            "2026-01-01T00:00:00Z",
            &payload,
        );
        assert_eq!(entry.message, "Catalog downloaded");
    }

    #[test]
    fn diagnostic_entry_has_dia_prefix() {
        let entry = LogEntry::diagnostic(5, LogLevel::Warn, "cursor.invalid recovered");
        assert_eq!(entry.id, "dia:5");
        assert_eq!(entry.source, LogEntrySource::Diagnostic);
        assert!(entry.entity_type.is_none());
        assert!(entry.entity_id.is_none());
    }

    #[test]
    fn log_entry_serialises_without_none_fields() {
        let entry = LogEntry::diagnostic(1, LogLevel::Info, "test");
        let v = serde_json::to_value(&entry).unwrap();
        assert!(v.get("requestId").is_none(), "requestId should be absent when None");
        assert!(v.get("entityType").is_none(), "entityType should be absent when None");
        assert!(v.get("entityId").is_none(), "entityId should be absent when None");
    }

    #[test]
    fn log_entry_source_serialises_as_snake_case() {
        assert_eq!(
            serde_json::to_value(LogEntrySource::Workflow).unwrap(),
            serde_json::json!("workflow")
        );
        assert_eq!(
            serde_json::to_value(LogEntrySource::Diagnostic).unwrap(),
            serde_json::json!("diagnostic")
        );
    }

    #[test]
    fn log_stream_event_deserialises_truncated_fields() {
        let json_str = r#"{
            "contractVersion": "2.0.0",
            "added": [],
            "truncated": true,
            "truncatedCount": 42
        }"#;
        let event: LogStreamEvent = serde_json::from_str(json_str).unwrap();
        assert!(event.truncated);
        assert_eq!(event.truncated_count, Some(42));
    }

    #[test]
    fn chrono_now_utc_is_whole_second_iso8601() {
        // #922: replaced the hand-rolled Gregorian conversion with the `time`
        // crate; assert the output shape is unchanged (no fractional
        // seconds — a bare Rfc3339 format of `now_utc()` would include them).
        let ts = chrono_now_utc();
        assert_eq!(ts.len(), "2026-01-01T00:00:00Z".len(), "unexpected length: {ts}");
        assert!(ts.ends_with('Z'), "must end in Z: {ts}");
        let format = time::format_description::well_known::Rfc3339;
        assert!(time::OffsetDateTime::parse(&ts, &format).is_ok(), "not valid Rfc3339: {ts}");
    }
}
