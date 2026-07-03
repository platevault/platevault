//! Acquisition and calibration session model.
//! Spec 002 data-model.md §AcquisitionSession, §CalibrationSession.
//!
//! Spec 041 FR-051 (T076, Phase 13): the review-state machine formerly
//! defined here (`SessionState`, `TRANSITIONS`, `is_allowed`) was removed.
//! Acquisition and calibration sessions are derived, already-confirmed
//! inventory — like calibration masters — with no review gate. Session
//! metadata remains editable post-hoc via the inbox per-file
//! metadata/override tables.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ids::{EntityId, Timestamp};
use crate::lifecycle::provenance::ProvenancedValue;

/// Calibration frame kind.
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
    JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationKind {
    Dark,
    Flat,
    Bias,
    FlatDark,
}

/// Geographic observer location at acquisition time. Carried as
/// `ProvenancedValue<ObserverLocation>` on `AcquisitionSession` (R-Obs).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
pub struct ObserverLocation {
    /// IANA timezone identifier (e.g. `"Europe/Amsterdam"`).
    pub tz: String,
    /// Latitude in degrees (−90..90). Extracted from `OBSGEO-B` or `SITELAT`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    /// Longitude in degrees (−180..180). Extracted from `OBSGEO-L` or `SITELONG`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
}

/// Acquisition session — grouping of light frames sharing a metadata-derived session key.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AcquisitionSession {
    pub id: EntityId,
    pub session_key: String,
    pub target_id: Option<EntityId>,
    pub frame_ids: Vec<EntityId>,
    /// Observer location with full provenance trail (R-Obs).
    pub observer_location: Option<ProvenancedValue<ObserverLocation>>,
    pub created_at: Timestamp,
}

/// Calibration session — grouping of calibration frames sharing equipment + exposure metadata.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CalibrationSession {
    pub id: EntityId,
    pub session_key: String,
    pub frame_ids: Vec<EntityId>,
    pub kind: CalibrationKind,
    pub created_at: Timestamp,
}
