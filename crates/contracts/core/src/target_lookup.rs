//! Contract DTOs for spec 013 — Target Lookup From FITS OBJECT.
#![allow(clippy::doc_markdown)] // spec/domain terminology (§-refs, UUIDv5, SQLite) not suitable for backticks
//!
//! Mirrors the JSON Schema contracts in:
//! - `specs/013-target-lookup-from-fits-object/contracts/target.lookup.json`
//! - `specs/013-target-lookup-from-fits-object/contracts/target.resolve.json`
//!
//! These types are separate from `targets.rs` which holds the spec-029 target
//! identity view types. This module owns the lookup and resolve surface.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Shared enums ──────────────────────────────────────────────────────────────

/// Confidence bucket for a target match (research.md R2, R3).
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum LookupConfidence {
    High,
    Medium,
    Low,
}

/// Which matching strategy produced the score.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum LookupStrategy {
    Exact,
    TokenSet,
    EditDistance,
}

// ── target.lookup contract ────────────────────────────────────────────────────

/// Evidence for a single match (data-model.md §MatchEvidence).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LookupMatchEvidence {
    pub matched_alias: String,
    pub normalized_query: String,
    pub strategy: LookupStrategy,
    /// Raw similarity score in `[0, 100]`.
    pub score: f64,
}

/// A single candidate match in the `target.lookup` response.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LookupTargetMatch {
    /// Stable UUIDv5 target identifier.
    pub target_id: String,
    /// Canonical display designation chosen by precedence table (R6).
    pub primary_designation: String,
    /// Human-readable name of the precedence-winning catalog.
    pub catalog_display: String,
    pub confidence: LookupConfidence,
    /// Raw similarity score in `[0, 100]`.
    pub score: f64,
    pub evidence: LookupMatchEvidence,
}

/// Request for `target.lookup` (target.lookup.json §Request).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetLookupRequest {
    pub contract_version: String,
    pub request_id: String,
    /// Free-form lookup query (typically the raw FITS OBJECT value).
    pub query: String,
    /// Maximum number of matches to return, ranked by confidence then score.
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    10
}

/// Error codes for `target.lookup` and `target.resolve`.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum LookupErrorCode {
    /// Missing or whitespace-only query.
    QueryEmpty,
    /// Catalog index failed to build from SQLite.
    CatalogUnavailable,
    /// First-run catalog download not yet completed.
    CatalogNotInstalled,
}

impl LookupErrorCode {
    /// Return the wire-format string for this error code.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::QueryEmpty => "query.empty",
            Self::CatalogUnavailable => "catalog.unavailable",
            Self::CatalogNotInstalled => "catalog.not_installed",
        }
    }
}

/// Error item in a `target.lookup` or `target.resolve` error response.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LookupError {
    pub code: String,
    pub message: String,
}

impl LookupError {
    #[must_use]
    pub fn new(code: LookupErrorCode, message: impl Into<String>) -> Self {
        Self { code: code.as_str().to_owned(), message: message.into() }
    }
}

/// Response for `target.lookup`.
///
/// `status = "success"` when `matches` is populated (may be empty when no
/// candidates are above the discard threshold).
/// `status = "error"` when `errors` is populated.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetLookupResponse {
    pub status: String,
    pub contract_version: String,
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matches: Option<Vec<LookupTargetMatch>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<LookupError>>,
}

impl TargetLookupResponse {
    /// Build a success response.
    #[must_use]
    pub fn success(request_id: String, matches: Vec<LookupTargetMatch>) -> Self {
        Self {
            status: "success".to_owned(),
            contract_version: "1.0".to_owned(),
            request_id,
            matches: Some(matches),
            errors: None,
        }
    }

    /// Build an error response.
    #[must_use]
    pub fn error(request_id: String, errors: Vec<LookupError>) -> Self {
        Self {
            status: "error".to_owned(),
            contract_version: "1.0".to_owned(),
            request_id,
            matches: None,
            errors: Some(errors),
        }
    }
}

// ── target.resolve contract ───────────────────────────────────────────────────

/// Discriminated status for `target.resolve` (target.resolve.json §ResolveStatus).
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum ResolveStatus {
    /// Single confident match.
    Resolved,
    /// Multiple candidates within the gap rule.
    Ambiguous,
    /// No candidate above the discard threshold.
    Unresolved,
    /// Catalog unavailable or request invalid.
    Error,
}

/// Abbreviated candidate summary for the `ambiguous` response (target.resolve.json).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSummary {
    pub target_id: String,
    pub primary_designation: String,
    pub catalog_display: String,
    pub score: f64,
}

/// Request for `target.resolve` (target.resolve.json §Request).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetResolveRequest {
    pub contract_version: String,
    pub request_id: String,
    /// Raw FITS OBJECT header value as extracted from the light frame.
    pub fits_object_value: String,
}

/// Response for `target.resolve`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetResolveResponse {
    pub status: ResolveStatus,
    pub contract_version: String,
    pub request_id: String,
    /// Present when `status = resolved`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    /// Present when `status = resolved`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_designation: Option<String>,
    /// Present when `status = resolved`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_display: Option<String>,
    /// Present when `status = resolved`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<LookupConfidence>,
    /// Present when `status = ambiguous`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidates: Option<Vec<CandidateSummary>>,
    /// Present when `status = error`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<LookupError>>,
}

impl TargetResolveResponse {
    /// Build a `resolved` response.
    #[must_use]
    pub fn resolved(
        request_id: String,
        target_id: String,
        primary_designation: String,
        catalog_display: String,
        confidence: LookupConfidence,
    ) -> Self {
        Self {
            status: ResolveStatus::Resolved,
            contract_version: "1.0".to_owned(),
            request_id,
            target_id: Some(target_id),
            primary_designation: Some(primary_designation),
            catalog_display: Some(catalog_display),
            confidence: Some(confidence),
            candidates: None,
            errors: None,
        }
    }

    /// Build an `ambiguous` response.
    #[must_use]
    pub fn ambiguous(request_id: String, candidates: Vec<CandidateSummary>) -> Self {
        Self {
            status: ResolveStatus::Ambiguous,
            contract_version: "1.0".to_owned(),
            request_id,
            target_id: None,
            primary_designation: None,
            catalog_display: None,
            confidence: None,
            candidates: Some(candidates),
            errors: None,
        }
    }

    /// Build an `unresolved` response.
    #[must_use]
    pub fn unresolved(request_id: String) -> Self {
        Self {
            status: ResolveStatus::Unresolved,
            contract_version: "1.0".to_owned(),
            request_id,
            target_id: None,
            primary_designation: None,
            catalog_display: None,
            confidence: None,
            candidates: None,
            errors: None,
        }
    }

    /// Build an `error` response.
    #[must_use]
    pub fn error(request_id: String, errors: Vec<LookupError>) -> Self {
        Self {
            status: ResolveStatus::Error,
            contract_version: "1.0".to_owned(),
            request_id,
            target_id: None,
            primary_designation: None,
            catalog_display: None,
            confidence: None,
            candidates: None,
            errors: Some(errors),
        }
    }
}
