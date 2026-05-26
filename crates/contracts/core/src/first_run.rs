//! First-run wizard and source registration contract DTOs.
//!
//! Covers the `roots.register`, `roots.register.batch`, `firstrun.complete`,
//! `firstrun.restart`, and `firstrun.state` command surfaces (spec 003).

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::JsonAny;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Kind of a registered source directory.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Raw,
    Calibration,
    Project,
    Inbox,
}

/// Scan depth strategy for a registered source.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "lowercase")]
pub enum ScanDepth {
    Recursive,
    Single,
}

/// Overall batch operation status.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "lowercase")]
pub enum BatchStatus {
    Success,
    Partial,
    Failure,
}

/// Per-item status within a batch operation.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Success,
    Failure,
}

// ── Request/Response types ──────────────────────────────────────────────────

/// Request payload for `roots.register`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSourceRequest {
    pub kind: SourceKind,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind_subtype: Option<String>,
    pub scan_depth: ScanDepth,
}

/// Response payload for `roots.register`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSourceResponse {
    pub source_id: String,
    pub kind: SourceKind,
    pub path: String,
    pub created_at: String,
}

/// Request payload for `roots.register.batch`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSourceBatchRequest {
    pub sources: Vec<RegisterSourceRequest>,
}

/// Response payload for `roots.register.batch`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSourceBatchResponse {
    pub status: BatchStatus,
    pub items: Vec<BatchItem>,
}

/// Individual item result within a batch registration.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BatchItem {
    pub index: usize,
    pub status: ItemStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<JsonAny>,
}

/// Response payload for `firstrun.complete`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunCompleteResponse {
    pub completed_at: String,
}

/// Response payload for `firstrun.restart`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunRestartResponse {
    pub prefilled_sources: Vec<RegisterSourceResponse>,
}

/// Response payload for `firstrun.state`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunStateResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub last_step: String,
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn source_kind_serializes_lowercase() {
        assert_eq!(serde_json::to_value(SourceKind::Raw).unwrap(), json!("raw"));
        assert_eq!(serde_json::to_value(SourceKind::Calibration).unwrap(), json!("calibration"));
        assert_eq!(serde_json::to_value(SourceKind::Project).unwrap(), json!("project"));
        assert_eq!(serde_json::to_value(SourceKind::Inbox).unwrap(), json!("inbox"));
    }

    #[test]
    fn scan_depth_serializes_lowercase() {
        assert_eq!(serde_json::to_value(ScanDepth::Recursive).unwrap(), json!("recursive"));
        assert_eq!(serde_json::to_value(ScanDepth::Single).unwrap(), json!("single"));
    }

    #[test]
    fn register_source_request_camel_case() {
        let req = RegisterSourceRequest {
            kind: SourceKind::Raw,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
        };
        let value = serde_json::to_value(req).unwrap();
        assert_eq!(value["scanDepth"], json!("recursive"));
        assert!(value.get("kindSubtype").is_none()); // skip_serializing_if
    }

    #[test]
    fn batch_response_partial_status() {
        let resp = RegisterSourceBatchResponse {
            status: BatchStatus::Partial,
            items: vec![
                BatchItem {
                    index: 0,
                    status: ItemStatus::Success,
                    source_id: Some("id-1".to_owned()),
                    error: None,
                    error_detail: None,
                },
                BatchItem {
                    index: 1,
                    status: ItemStatus::Failure,
                    source_id: None,
                    error: Some("path.not_exists".to_owned()),
                    error_detail: None,
                },
            ],
        };
        let value = serde_json::to_value(resp).unwrap();
        assert_eq!(value["status"], json!("partial"));
        assert_eq!(value["items"][1]["status"], json!("failure"));
    }
}
