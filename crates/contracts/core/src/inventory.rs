//! Inventory contract DTOs for the Tauri IPC surface (spec 006).
//!
//! These types mirror the JSON Schema contracts in
//! `specs/006-inventory-library-lifecycle/contracts/`. They are the canonical
//! Rust-side DTO boundary for `inventory.list` and `inventory.session.review`.
//!
//! The UI-visible `InventorySource` / `InventorySession` types are **read-only
//! projections** — no new persisted entities are introduced by spec 006. All
//! state mutations go through `inventory_session_review` which wraps the
//! spec-002 `lifecycle.transition` use case.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::JsonAny;

// ── SessionState ─────────────────────────────────────────────────────────────

/// Canonical spec 002 session state. Six values; no presentational projection.
/// UI maps display labels locally: `discovered` and `candidate` → "Needs review".
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum InventorySessionState {
    Discovered,
    Candidate,
    NeedsReview,
    Confirmed,
    Rejected,
    Ignored,
}

// ── FrameType ────────────────────────────────────────────────────────────────

/// Frame type for an inventory session.
/// `DarkFlat` is reserved but never returned in v1.
/// `Mixed` is a server-derived sentinel for post-promotion regressions.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum InventoryFrameType {
    Light,
    Dark,
    Flat,
    Bias,
    Mixed,
}

// ── SourceKind / SourceState ─────────────────────────────────────────────────

/// Library root media kind (refined from `LibraryRoot.kind`).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum InventorySourceKind {
    LocalDisk,
    ExternalDisk,
    Removable,
    NetworkShare,
}

/// Library root connectivity state (mirrors `LibraryRoot.state` from spec 002).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum InventorySourceState {
    Active,
    Missing,
    Disabled,
    ReconnectRequired,
}

// ── Provenance / Linked ──────────────────────────────────────────────────────

/// Provenance summary for the detail drawer. MUST NOT include
/// confidence/evidence detail (spec 002 FR-006). Summary only.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventoryProvenanceSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inferred: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmed_by: Option<String>,
}

/// Lightweight project stub in the linked section.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkedProjectRef {
    pub id: String,
    pub name: String,
}

/// Outbound references shown in the drawer's "Linked" section.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventoryLinkedRefs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projects: Option<Vec<LinkedProjectRef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration: Option<String>,
}

// ── InventorySession ─────────────────────────────────────────────────────────

/// One row in the inventory ledger. Projects one `AcquisitionSession` OR one
/// `CalibrationSession` into a unified DTO.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventorySession {
    pub id: String,
    pub name: String,
    pub source_id: String,
    pub frames: u32,
    #[serde(rename = "type")]
    pub frame_type: InventoryFrameType,
    pub target: Option<String>,
    pub filter: Option<String>,
    pub exposure: Option<String>,
    pub state: InventorySessionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set_temp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<InventoryProvenanceSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked: Option<InventoryLinkedRefs>,
}

// ── InventorySource ──────────────────────────────────────────────────────────

/// One group header in the inventory ledger. One per `LibraryRoot` that has at
/// least one session under it.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventorySource {
    pub id: String,
    pub path: String,
    pub kind: InventorySourceKind,
    pub state: InventorySourceState,
    pub sessions: Vec<InventorySession>,
}

// ── inventory.list request / response ────────────────────────────────────────

/// Optional filters for `inventory.list`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventoryListFilters {
    /// When set, limits the response to a single `LibraryRoot`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_filter: Option<String>,
    /// When set, limits sessions to the given frame type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_filter: Option<InventoryFrameType>,
    /// When set, limits sessions to the given canonical state.
    /// `ignored` sessions are excluded from the default ledger.
    /// Use `reviewFilter=ignored` to surface them (FR-010).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_filter: Option<String>,
}

/// Request envelope for `inventory.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventoryListRequest {
    pub contract_version: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filters: Option<InventoryListFilters>,
}

/// Successful response payload for `inventory.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventoryListResponse {
    pub status: String,
    pub contract_version: String,
    pub request_id: String,
    pub generated_at: String,
    pub sources: Vec<InventorySource>,
}

// ── inventory.session.review request / response ───────────────────────────────

/// Request envelope for `inventory.session.review`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventorySessionReviewRequest {
    pub contract_version: String,
    pub request_id: String,
    pub session_id: String,
    /// Target canonical state. When equal to current state → noop (no error).
    pub next_state: InventorySessionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_label: Option<String>,
    /// "user" or "system"
    pub actor: String,
}

/// Response envelope for `inventory.session.review`.
/// Status is "success", "noop", or "error".
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventorySessionReviewResponse {
    pub status: String,
    pub contract_version: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applied_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_state: Option<InventorySessionState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_state: Option<InventorySessionState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audit_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<InventoryReviewError>,
}

/// Error payload for `inventory.session.review`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InventoryReviewError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<JsonAny>,
}

impl InventorySessionReviewResponse {
    /// Construct a success response.
    #[must_use]
    pub fn success(
        request_id: String,
        applied_at: String,
        entity_type: String,
        prior_state: InventorySessionState,
        new_state: InventorySessionState,
        audit_id: String,
    ) -> Self {
        Self {
            status: "success".to_owned(),
            contract_version: "2.0.0".to_owned(),
            request_id,
            applied_at: Some(applied_at),
            entity_type: Some(entity_type),
            prior_state: Some(prior_state),
            new_state: Some(new_state),
            audit_id: Some(audit_id),
            error: None,
        }
    }

    /// Construct a noop response (state unchanged).
    #[must_use]
    pub fn noop(request_id: String) -> Self {
        Self {
            status: "noop".to_owned(),
            contract_version: "2.0.0".to_owned(),
            request_id,
            applied_at: None,
            entity_type: None,
            prior_state: None,
            new_state: None,
            audit_id: None,
            error: None,
        }
    }

    /// Construct an error response.
    #[must_use]
    pub fn error(request_id: String, code: &str, message: String) -> Self {
        Self {
            status: "error".to_owned(),
            contract_version: "2.0.0".to_owned(),
            request_id,
            applied_at: None,
            entity_type: None,
            prior_state: None,
            new_state: None,
            audit_id: None,
            error: Some(InventoryReviewError { code: code.to_owned(), message, details: None }),
        }
    }

    /// Construct an error response with structured details.
    #[must_use]
    pub fn error_with_details(
        request_id: String,
        code: &str,
        message: String,
        details: JsonAny,
    ) -> Self {
        Self {
            status: "error".to_owned(),
            contract_version: "2.0.0".to_owned(),
            request_id,
            applied_at: None,
            entity_type: None,
            prior_state: None,
            new_state: None,
            audit_id: None,
            error: Some(InventoryReviewError {
                code: code.to_owned(),
                message,
                details: Some(details),
            }),
        }
    }
}
