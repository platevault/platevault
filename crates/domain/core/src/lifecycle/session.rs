//! Acquisition and calibration session lifecycle state model.
//! Spec 002 data-model.md §AcquisitionSession, §CalibrationSession.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ids::{EntityId, Timestamp};
use crate::lifecycle::provenance::ProvenancedValue;

/// Shared lifecycle state for both `AcquisitionSession` and `CalibrationSession`.
///
/// 6 variants per spec 002 §SessionState and research.md §2.3.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Discovered,
    Candidate,
    NeedsReview,
    Confirmed,
    Rejected,
    Ignored,
}

impl SessionState {
    /// Soft-terminal states: re-openable to `needs_review`.
    #[must_use]
    pub const fn is_soft_terminal(self) -> bool {
        matches!(self, Self::Confirmed | Self::Rejected)
    }
}

/// Calibration frame kind.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
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
    pub state: SessionState,
    /// Observer location with full provenance trail (R-Obs).
    pub observer_location: Option<ProvenancedValue<ObserverLocation>>,
    pub review_snapshot_id: Option<EntityId>,
    pub created_at: Timestamp,
}

/// Calibration session — grouping of calibration frames sharing equipment + exposure metadata.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CalibrationSession {
    pub id: EntityId,
    pub session_key: String,
    pub frame_ids: Vec<EntityId>,
    pub kind: CalibrationKind,
    pub state: SessionState,
    pub review_snapshot_id: Option<EntityId>,
    pub created_at: Timestamp,
}
