// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Developer-diagnostics contract DTOs (spec 021).
//!
//! These types are the Rust mirrors of the JSON Schemas in
//! `specs/021-developer-contract-diagnostics/contracts/` (mirrored to
//! `packages/contracts/dev/`).
//!
//! **IMPORTANT**: These types are used exclusively from the `dev-tools` feature
//! path in `desktop_shell`. They are compiled unconditionally in
//! `contracts_core` so that the specta builder can reference them in
//! `#[cfg(feature = "dev-tools")]` blocks without the contracts crate needing
//! its own feature flag.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::JsonAny;

// ── ContractMeta ──────────────────────────────────────────────────────────────

/// Metadata for a single registered contract (spec 021, US1).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContractMeta {
    /// Operation name, e.g. `plan.create`.
    pub name: String,
    /// Semantic version of the contract shape.
    pub version: String,
    /// Absolute path to the JSON Schema file backing this contract.
    pub schema_path: String,
    /// `"ui-to-core"` or `"core-to-ui"`.
    pub direction: String,
    /// `true` only for read-only contracts that opt in. Default `false`.
    pub replay_safe: bool,
    /// JSON Pointer paths whose values are redacted before storage.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sensitive_fields: Vec<String>,
    /// SHA-256 of the TypeScript-side schema declaration (absent when unknown).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ts_hash: Option<String>,
    /// SHA-256 of the Rust-side schema declaration (absent when unknown).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rust_hash: Option<String>,
    /// `true` when both hashes are present and differ.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mismatch: Option<bool>,
}

// ── ContractCall ──────────────────────────────────────────────────────────────

/// A single request/response pair captured by the recording proxy (spec 021, US2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContractCall {
    /// Monotonic session-scoped id. Used as the row key.
    pub id: String,
    /// Operation name at call time.
    pub contract: String,
    /// Operation version at call time (pinned per call).
    pub contract_version: String,
    /// Sanitized request payload. Sensitive fields and filesystem paths redacted.
    pub request: JsonAny,
    /// Response payload on success. Absent when the call errored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<JsonAny>,
    /// Error envelope on failure. Absent on success.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ContractCallError>,
    /// Wall-clock UTC start time (ISO-8601).
    pub started_at: String,
    /// Monotonic elapsed time in milliseconds from dispatch to response or error.
    pub duration_ms: f64,
    /// `true` when the recorder truncated the stored request or response above
    /// the 64 KB threshold.
    pub payload_truncated: bool,
}

/// Error details stored on a failed call.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ContractCallError {
    pub code: String,
    pub message: String,
}

// ── dev.contracts.list request/response ──────────────────────────────────────

/// Request for `dev.contracts.list`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DevContractsListRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// Response for `dev.contracts.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DevContractsListResponse {
    pub contracts: Vec<ContractMeta>,
}

// ── dev.calls.list request/response ──────────────────────────────────────────

/// Request for `dev.calls.list`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DevCallsListRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// Max rows to return. Defaults to the full buffer (100). Clamped to 100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

/// Response for `dev.calls.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DevCallsListResponse {
    /// Newest-first list of recorded calls.
    pub calls: Vec<ContractCall>,
}

// ── dev.export request/response ───────────────────────────────────────────────

/// Request for `dev.export`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DevExportRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// Absolute filesystem path where the JSON export should be written.
    pub output_path: String,
    /// When `false` (default), filesystem paths in the export are replaced with
    /// `${LIBRARY_ROOT}/...` placeholders. When `true`, verbatim paths are included.
    #[serde(default)]
    pub include_verbatim_paths: bool,
    /// Include the full contract registry list in the export (default `true`).
    #[serde(default = "default_true")]
    pub include_contracts: bool,
    /// Include the recent-calls buffer in the export (default `true`).
    #[serde(default = "default_true")]
    pub include_calls: bool,
}

fn default_true() -> bool {
    true
}

/// Response for `dev.export`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DevExportResponse {
    /// Absolute path of the written export file.
    pub written_path: String,
    /// Number of call records included in the export.
    pub call_count: u32,
    /// Number of contract records included in the export.
    pub contract_count: u32,
}

// ── dev.schema.get request/response ──────────────────────────────────────────

/// Request for `dev.schema.get` — read a JSON Schema file by path.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DevSchemaGetRequest {
    /// Absolute filesystem path to the JSON Schema file.
    pub schema_path: String,
}

/// Response for `dev.schema.get`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DevSchemaGetResponse {
    /// `true` when the file was found and read successfully.
    pub found: bool,
    /// Pretty-printed JSON Schema content (two-space indent). Absent when `found` is false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}
