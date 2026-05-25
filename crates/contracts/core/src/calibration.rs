//! Calibration contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `CalibrationMaster`,
//! `MasterDetail`, and `MatchCandidate` in `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Kind of calibration master frame.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationKind {
    Dark,
    Flat,
    Bias,
    DarkFlat,
    BadPixelMap,
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
