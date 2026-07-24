// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Inventory contract DTOs for the Tauri IPC surface (spec 006).
//!
//! These types mirror the JSON Schema contracts in
//! `specs/006-inventory-library-lifecycle/contracts/`. They are the canonical
//! Rust-side DTO boundary for `inventory.list`.
//!
//! The UI-visible `InventorySource` / `InventorySession` types are **read-only
//! projections** — no new persisted entities are introduced by spec 006.
//!
//! Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
//! inventory. The review-state machine (`InventorySessionState`) and the
//! `inventory.session.review` command that wrapped the spec-002
//! `lifecycle.transition` use case were removed; there is no longer a
//! review-state mutation on this surface. Session metadata remains editable
//! post-hoc via the inbox per-file metadata/override tables.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::sessions::SessionCalibrationMatch;

// ── FrameType ────────────────────────────────────────────────────────────────

/// Frame type for an inventory session.
/// `DarkFlat` is reserved but never returned in v1.
/// (`Mixed` removed 2026-07-03: Inbox single-type ingest — spec 041 — splits
/// mixed folders into single-type items at ingest, so a session is never mixed.)
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum InventoryFrameType {
    Light,
    Dark,
    Flat,
    Bias,
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
///
/// Spec 041 FR-051: no `state` field — sessions are derived, already-confirmed
/// inventory with no review lifecycle.
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
    /// The session's frame folder, relative to its source root
    /// (`source_id`'s `current_path`). The reveal action joins the root path
    /// with this so it opens the session's actual frame folder instead of the
    /// library root (#567). `None` when no frame `file_record` resolves a
    /// path (legacy/unscanned sessions) — the UI then falls back to the root.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    /// User-editable free-text notes (#773). `None` when never set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Calibration masters assigned to this session (`calibration_assignment`
    /// rows), reusing the same DTO the (frontend-unused) `sessions_get`
    /// contract already carries. Empty for calibration sessions (dark/flat/
    /// bias) — assignment links a light session to its calibration masters,
    /// never the reverse — and for a light session with no assignment yet;
    /// the UI renders both as an explicit "no calibration match" state
    /// rather than omitting the section (#772).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub calibration_matches: Vec<SessionCalibrationMatch>,
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
    /// Maximum sessions returned per source root (default 1 000 server-side
    /// when omitted). Existing callers that omit the field keep working.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// Sessions to skip before applying `limit` (0-based, per source root).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
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

// ── inventory.session.notes.update request / response (#773) ───────────────────

/// Request for `inventory.session.notes.update`. Mirrors the
/// `target.note.update` shape (spec 023 US4) — empty/whitespace-only `notes`
/// clears the field (stores NULL).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionNotesUpdateRequest {
    pub session_id: String,
    pub notes: String,
}

/// Response for `inventory.session.notes.update`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionNotesUpdateResult {
    /// Notes after the update, or `null` when cleared.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}
