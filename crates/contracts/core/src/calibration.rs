// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `CalibrationMaster`,
//! `MasterDetail`, and `MatchCandidate` in `apps/desktop/src/api/types.ts`.

use std::str::FromStr;

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Kind of calibration master frame.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationKind {
    Dark,
    Flat,
    Bias,
    DarkFlat,
    BadPixelMap,
}

impl CalibrationKind {
    /// Canonical persisted/serialized string for this kind.
    ///
    /// These values MUST stay byte-identical to the `#[serde(rename_all =
    /// "snake_case")]` output and the stored DB / IPC strings.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dark => "dark",
            Self::Flat => "flat",
            Self::Bias => "bias",
            Self::DarkFlat => "dark_flat",
            Self::BadPixelMap => "bad_pixel_map",
        }
    }
}

/// Error returned when a string cannot be parsed into a [`CalibrationKind`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParseCalibrationKindError(pub String);

impl std::fmt::Display for ParseCalibrationKindError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown calibration kind: {}", self.0)
    }
}

impl std::error::Error for ParseCalibrationKindError {}

/// Single canonical, strict parser for [`CalibrationKind`].
///
/// Accepts the canonical serde strings plus the legacy `flat_dark` alias for
/// `DarkFlat`. Unknown values are rejected (no silent fallback); callers that
/// need a fallback apply it explicitly (e.g. `.unwrap_or(CalibrationKind::Dark)`
/// or `.ok()`), which keeps the fallback policy visible at each call site.
impl FromStr for CalibrationKind {
    type Err = ParseCalibrationKindError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "dark" => Ok(Self::Dark),
            "flat" => Ok(Self::Flat),
            "bias" => Ok(Self::Bias),
            "dark_flat" | "flat_dark" => Ok(Self::DarkFlat),
            "bad_pixel_map" => Ok(Self::BadPixelMap),
            other => Err(ParseCalibrationKindError(other.to_owned())),
        }
    }
}

impl TryFrom<&str> for CalibrationKind {
    type Error = ParseCalibrationKindError;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        s.parse()
    }
}

// ── Structs ─────────────────────────────────────────────────────────────────

/// Sensor/optical fingerprint that determines calibration compatibility.
///
/// Every field is `Option` (Q16 / #620, FR-135/FR-136): extraction may leave
/// any of these unresolved, and the contract MUST carry that absence as
/// `null` rather than a synthesized value (empty string, fabricated `"1x1"`
/// binning, or a defaulted `0.0`) — the missing/real-zero distinction is
/// unrecoverable once a sentinel overwrites it at this hop.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationFingerprint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sensor_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposure_s: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temp_c: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
}

/// A calibration master as seen in list views.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationMaster {
    pub id: String,
    pub kind: CalibrationKind,
    pub fingerprint: CalibrationFingerprint,
    /// `None` when the originating session is unresolved (Q16 / FR-136) —
    /// never self-referentially defaulted to this master's own id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_session_id: Option<String>,
    pub created_at: String,
    pub age_days: u32,
    /// `None` when file size is unresolved (Q16 / FR-136) — never a
    /// sentinel 0.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    pub used_by_session_ids: Vec<String>,
    pub used_by_project_ids: Vec<String>,
    /// #642: the master's owning library root id. `None` alongside
    /// `relative_path` when the master frame was never resolved to a
    /// `file_record` (legacy/unresolved masters) — never guessed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
    /// #642: root-relative path of the master's own file, for Reveal /
    /// archive-plan generation. Resolve to an absolute path by joining with
    /// the `root_id`'s current library root path (roots stay modeled
    /// separately per Constitution I, so a moved/remapped root still
    /// resolves correctly).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
}

/// A compatible session entry within a master detail view.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CompatibleSessionEntry {
    pub session_id: String,
    pub score: f64,
    pub soft_mismatches: Vec<String>,
}

/// Usage statistics for a calibration master.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MasterUsageStats {
    pub session_count: u32,
    pub project_count: u32,
}

/// Derived "source missing / unverifiable" flag on a calibration match
/// (spec 048 US5, FR-024/025). Computed live from current presence state —
/// never persisted — so it clears automatically once the referenced
/// frame/artifact returns to present. The match itself is NEVER
/// auto-invalidated or removed when this is set (FR-024).
///
/// Two distinct trigger paths carry distinct user-facing wording because
/// they point the user at different problems:
/// - `MasterMissing`: the generated master file this match relies on
///   (tracked via `calibration_master.artifact_id` → spec-012
///   `processing_artifacts.state`) is gone.
/// - `SourceSubsMissing`: a raw calibration sub-frame that makes up this
///   master's own session is missing, so the master's provenance can't be
///   verified even though nothing about the master file itself changed.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationMatchMissingFlag {
    MasterMissing,
    SourceSubsMissing,
}

/// Extended detail view of a calibration master.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MasterDetail {
    // Flattened base fields from CalibrationMaster.
    pub id: String,
    pub kind: CalibrationKind,
    pub fingerprint: CalibrationFingerprint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_session_id: Option<String>,
    pub created_at: String,
    pub age_days: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    pub used_by_session_ids: Vec<String>,
    pub used_by_project_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    // Detail-only fields.
    pub compatible_sessions: Vec<CompatibleSessionEntry>,
    pub usage_stats: MasterUsageStats,
    /// spec 048 US5: `None` when no matches using this master are flagged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_flag: Option<CalibrationMatchMissingFlag>,
}

/// A candidate match between a session and a calibration master.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MatchCandidate {
    pub master_id: String,
    pub kind: CalibrationKind,
    pub score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    pub soft_mismatches: Vec<String>,
}
