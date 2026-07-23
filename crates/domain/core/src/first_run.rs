// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! First-run wizard and source registration contract DTOs.
//!
//! Covers the `roots.register`, `roots.register.batch`, `firstrun.complete`,
//! `firstrun.restart`, and `firstrun.state` command surfaces (spec 003).

use serde::{Deserialize, Serialize};
use specta::Type;
use strum::{EnumString, IntoStaticStr};

use crate::JsonAny;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Kind of a registered source directory.
///
/// `Calibration` replaces the former `Dark`, `Flat`, and `Bias` variants.
/// Per-image frame type (light / dark / flat / bias) is detected from image
/// metadata (FITS `IMAGETYP` header) during scan/ingest — the source-folder
/// kind is only a user-facing folder category.
///
/// The `strum` `serialize_all` mirrors the serde `rename_all`, so the
/// `FromStr` / `Into<&'static str>` conversions produce byte-identical persisted
/// strings (`light_frames`, `calibration`, `project`, `inbox`).
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SourceKind {
    LightFrames,
    Calibration,
    Project,
    Inbox,
}

/// Organization state of a registered source (spec 041, R-7).
///
/// `Organized` — files are already in their final location; confirm produces
/// only `catalogue` (record-in-place) plan actions; no file moves.
///
/// `Unorganized` — files should be moved to pattern-resolved destinations on
/// confirm. `Inbox` sources are always `Unorganized`.
///
/// Serializes as `"organized"` / `"unorganized"` (lowercase) to match the
/// DB CHECK constraint and the IPC camelCase surface.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "lowercase")]
pub enum OrganizationState {
    Organized,
    Unorganized,
}

// ── Error code constants ────────────────────────────────────────────────────

/// Error code returned when `inbox` kind is registered as `organized`, or an
/// invalid `organization_state` value is supplied.
pub const ERR_SOURCE_INVALID_ORGANIZATION_STATE: &str = "source.invalid_organization_state";

/// Scan depth strategy for a registered source.
///
/// `strum` `serialize_all` mirrors the serde `rename_all` (`recursive`,
/// `single`).
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
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
///
/// `organization_state` is required for non-inbox sources (the UI forces an
/// explicit choice). For `inbox` kind the value MUST be `unorganized`;
/// supplying `organized` returns `source.invalid_organization_state`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSourceRequest {
    pub kind: SourceKind,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind_subtype: Option<String>,
    pub scan_depth: ScanDepth,
    /// Organization state for this source (spec 041 R-7).
    /// Inbox sources MUST be `unorganized`; non-inbox sources must be explicit.
    pub organization_state: OrganizationState,
}

/// Response payload for `roots.register`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSourceResponse {
    pub source_id: String,
    pub kind: SourceKind,
    pub path: String,
    pub created_at: String,
    /// Organization state persisted for this source (spec 041 R-7).
    pub organization_state: OrganizationState,
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

// ── sources.set_organization_state (spec 041) ────────────────────────────────

/// Request payload for `sources.set_organization_state`.
///
/// Changes a source's organization state after registration. Affects only
/// future confirms; does not move already-planned files.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetSourceOrganizationStateRequest {
    pub source_id: String,
    pub organization_state: OrganizationState,
}

/// Response payload for `sources.set_organization_state`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetSourceOrganizationStateResponse {
    pub source_id: String,
    pub organization_state: OrganizationState,
}

// ── Source summary (sources.list) ─────────────────────────────────────────────

/// One source entry returned by `sources.list`.
///
/// Extends the registration response with `organization_state` so the UI can
/// show move-vs-catalogue intent per source (spec 041).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub source_id: String,
    pub kind: SourceKind,
    pub path: String,
    pub created_at: String,
    /// Organization state for this source (spec 041 R-7).
    pub organization_state: OrganizationState,
}

/// Response payload for `sources.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceListResponse {
    pub sources: Vec<SourceSummary>,
}

// ── Root dependents (P6b — `roots.delete`) ───────────────────────────────────

/// Counts of records that reference a registered source by root/source id,
/// checked before `roots.delete` is allowed to proceed (decision D8).
///
/// `registered_sources` has no FK cascade: deleting a root's registration
/// must never silently orphan or nullify history it left behind (constitution
/// §I/§II). When [`Self::total`] is non-zero the delete is blocked with
/// `root.has_dependents`; the caller can use the individual fields to explain
/// which records still remain.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RootDependencyCounts {
    /// Rows in `inbox_items` with `root_id` equal to this source's id.
    pub inbox_items: u32,
    /// Rows in `plan_items` with `source_id` equal to this source's id.
    pub plan_items: u32,
    /// Rows in `file_record` with `root_id` equal to this source's id.
    pub file_records: u32,
    /// Rows in `acquisition_session` with `root_id` equal to this source's id.
    pub acquisition_sessions: u32,
    /// Rows in `calibration_session` with `root_id` equal to this source's id.
    pub calibration_sessions: u32,
}

impl RootDependencyCounts {
    /// Total number of dependent records across every category.
    #[must_use]
    pub fn total(&self) -> u32 {
        self.inbox_items
            + self.plan_items
            + self.file_records
            + self.acquisition_sessions
            + self.calibration_sessions
    }

    /// `true` when no dependent records exist anywhere — the delete may proceed.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.total() == 0
    }
}

// ── firstrun.complete ─────────────────────────────────────────────────────────

/// Response payload for `firstrun.complete`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunCompleteResponse {
    pub completed_at: String,
    pub registered_source_count: usize,
}

/// Request payload for `firstrun.restart`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunRestartRequest {
    pub confirm: bool,
}

/// Response payload for `firstrun.restart`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunRestartResponse {
    pub restarted_at: String,
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
    fn source_kind_serializes_snake_case() {
        assert_eq!(serde_json::to_value(SourceKind::LightFrames).unwrap(), json!("light_frames"));
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
    fn organization_state_serializes_lowercase() {
        assert_eq!(serde_json::to_value(OrganizationState::Organized).unwrap(), json!("organized"));
        assert_eq!(
            serde_json::to_value(OrganizationState::Unorganized).unwrap(),
            json!("unorganized")
        );
    }

    #[test]
    fn register_source_request_camel_case() {
        let req = RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/lights".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        };
        let value = serde_json::to_value(req).unwrap();
        assert_eq!(value["scanDepth"], json!("recursive"));
        assert_eq!(value["kind"], json!("light_frames"));
        assert_eq!(value["organizationState"], json!("organized"));
        assert!(value.get("kindSubtype").is_none()); // skip_serializing_if

        // Inbox kind with unorganized
        let inbox_req = RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/astro/inbox".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        };
        let inbox_value = serde_json::to_value(inbox_req).unwrap();
        assert_eq!(inbox_value["kind"], json!("inbox"));
        assert_eq!(inbox_value["organizationState"], json!("unorganized"));
    }

    #[test]
    fn set_source_organization_state_round_trips() {
        let req = SetSourceOrganizationStateRequest {
            source_id: "src-1".to_owned(),
            organization_state: OrganizationState::Organized,
        };
        let value = serde_json::to_value(&req).unwrap();
        assert_eq!(value["sourceId"], json!("src-1"));
        assert_eq!(value["organizationState"], json!("organized"));

        let resp = SetSourceOrganizationStateResponse {
            source_id: "src-1".to_owned(),
            organization_state: OrganizationState::Organized,
        };
        let resp_value = serde_json::to_value(resp).unwrap();
        assert_eq!(resp_value["organizationState"], json!("organized"));
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
