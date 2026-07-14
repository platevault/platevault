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
            CalibrationKind::Dark => "dark",
            CalibrationKind::Flat => "flat",
            CalibrationKind::Bias => "bias",
            CalibrationKind::DarkFlat => "dark_flat",
            CalibrationKind::BadPixelMap => "bad_pixel_map",
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
            "dark" => Ok(CalibrationKind::Dark),
            "flat" => Ok(CalibrationKind::Flat),
            "bias" => Ok(CalibrationKind::Bias),
            "dark_flat" | "flat_dark" => Ok(CalibrationKind::DarkFlat),
            "bad_pixel_map" => Ok(CalibrationKind::BadPixelMap),
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
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationFingerprint {
    pub camera: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sensor_mode: Option<String>,
    pub exposure_s: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temp_c: Option<f64>,
    pub gain: f64,
    pub binning: String,
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
    pub source_session_id: String,
    pub created_at: String,
    pub age_days: u32,
    pub size_bytes: u64,
    pub used_by_session_ids: Vec<String>,
    pub used_by_project_ids: Vec<String>,
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
    pub source_session_id: String,
    pub created_at: String,
    pub age_days: u32,
    pub size_bytes: u64,
    pub used_by_session_ids: Vec<String>,
    pub used_by_project_ids: Vec<String>,
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
