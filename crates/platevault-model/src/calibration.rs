// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inputs (spec 068): raw sets, detected and adopted masters, the
//! D13 criteria that explain every match, and the reviewed master adoption.
//! A light session's calibration is matched at ingestion and pinned on the
//! session (`session_calibration`, `session_matching`). Every comparison is
//! exact on canonical text or decimals with tolerance `none`; a value missing
//! on either side reads `unknown`, never compatible.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    Availability, CaptureMetadata, ErrorResponse, ExpectedAsset, FileIdentity, LibraryError,
    NativePath, ObservationFingerprint, Revision,
};

/// The capture age of a dark or bias master, and whether it exceeds the Old threshold.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CalibrationMasterAge {
    pub days: u32,
    pub old: bool,
}

impl CalibrationMasterAge {
    /// Compute age from the capture date, never from import time.
    #[must_use]
    pub fn from_capture_date(
        captured: Option<time::Date>,
        today: time::Date,
        old_after_days: u32,
    ) -> Option<Self> {
        let days = u32::try_from((today - captured?).whole_days().max(0)).ok()?;
        Some(Self { days, old: days > old_after_days })
    }
}

#[cfg(test)]
mod master_age_tests {
    use super::CalibrationMasterAge;
    use time::{macros::date, Duration};

    #[test]
    fn age_badge_boundary_is_configured_day_and_one_day_either_side() {
        let today = date!(2026 - 10 - 30);
        let age = |days, threshold| {
            CalibrationMasterAge::from_capture_date(
                Some(today - Duration::days(days)),
                today,
                threshold,
            )
            .unwrap()
        };

        assert_eq!(age(89, 90), CalibrationMasterAge { days: 89, old: false });
        assert_eq!(age(90, 90), CalibrationMasterAge { days: 90, old: false });
        assert_eq!(age(91, 90), CalibrationMasterAge { days: 91, old: true });
    }

    #[test]
    fn age_badge_respects_a_changed_setting_and_unknown_dates() {
        let today = date!(2026 - 10 - 30);
        let captured = Some(today - Duration::days(91));

        assert!(CalibrationMasterAge::from_capture_date(captured, today, 90).unwrap().old);
        assert!(!CalibrationMasterAge::from_capture_date(captured, today, 91).unwrap().old);
        assert_eq!(CalibrationMasterAge::from_capture_date(None, today, 90), None);
        assert_eq!(
            CalibrationMasterAge::from_capture_date(Some(today + Duration::days(1)), today, 0),
            Some(CalibrationMasterAge { days: 0, old: false }),
        );
    }
}

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

// ── Kinds and forms ──────────────────────────────────────────────────────────

/// The calibration kinds CAL matches (R2). Dark flats stay outside matching:
/// the shared v1 IMAGETYP table reserves them and D13 names no criterion that
/// pairs a dark flat with a flat set. 065's `missing_calibration` item keeps its
/// own kind set and reads unknown for dark flats.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum InputKind {
    Bias,
    Dark,
    Flat,
}

impl InputKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bias => "bias",
            Self::Dark => "dark",
            Self::Flat => "flat",
        }
    }

    /// The calibration kind of a canonical frame type; lights and dark flats have none.
    #[must_use]
    pub const fn from_frame_type(frame: metadata_core::FrameType) -> Option<Self> {
        match frame {
            metadata_core::FrameType::Bias => Some(Self::Bias),
            metadata_core::FrameType::Dark => Some(Self::Dark),
            metadata_core::FrameType::Flat => Some(Self::Flat),
            metadata_core::FrameType::Light | metadata_core::FrameType::DarkFlat => None,
        }
    }
}

/// How an input reaches PREP.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum InputForm {
    /// A current Session of raw calibration frames from an indexed location.
    RawSet,
    /// A master adopted into a registered Calibration location.
    Master,
    /// A detected master that is never reusable until it is adopted.
    Candidate,
}

/// A reusable input a decision can name. A candidate is never an input.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(tag = "form", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum InputRef {
    RawSet { session_id: Uuid, grouping_revision: Revision },
    Master { master_id: Uuid, revision: Revision },
}

impl InputRef {
    #[must_use]
    pub const fn form(&self) -> InputForm {
        match self {
            Self::RawSet { .. } => InputForm::RawSet,
            Self::Master { .. } => InputForm::Master,
        }
    }
    #[must_use]
    pub const fn id(&self) -> Uuid {
        match self {
            Self::RawSet { session_id: id, .. } | Self::Master { master_id: id, .. } => *id,
        }
    }
    #[must_use]
    pub const fn revision(&self) -> Revision {
        match self {
            Self::RawSet { grouping_revision: revision, .. } | Self::Master { revision, .. } => {
                *revision
            }
        }
    }
}

/// The evidence a master determination rests on (R4).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum MasterBasis {
    /// A present `STACKCNT` or `NCOMBINE` above 1.
    HeaderStackCount,
    /// No count; the effective IMAGETYP carries the token `master`.
    HeaderImagetyp,
    /// No count and no IMAGETYP token: a labelled naming inference.
    NameOnly,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct MasterEvidence {
    pub basis: MasterBasis,
    pub stack_count: Option<u32>,
    /// The `calibration_master_detect` detector that supplied the base kind.
    pub detector: String,
}

/// A calibration file's kind and whether it is a raw frame or a master.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Classification {
    pub kind: InputKind,
    /// `None` for a raw frame.
    pub master: Option<MasterEvidence>,
}

impl Classification {
    /// Raw frames form raw sets; a detected master is a candidate until adopted.
    #[must_use]
    pub const fn form(&self) -> InputForm {
        if self.master.is_some() {
            InputForm::Candidate
        } else {
            InputForm::RawSet
        }
    }
}

// ── Evidence ─────────────────────────────────────────────────────────────────

/// A capture value the criteria compare or show.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum EvidenceField {
    ImageType,
    Camera,
    CameraId,
    Width,
    Height,
    BinningX,
    BinningY,
    Gain,
    Offset,
    Exposure,
    SetTemperature,
    Filter,
    Telescope,
    FocalLength,
    MeasuredTemperature,
    ReadoutMode,
    Night,
}

/// A canonical value and where it came from: a header keyword, a reviewed
/// catalog correction or the Session key.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SourcedValue {
    pub value: String,
    pub source: String,
}

/// One side of a comparison: canonical values with their sources, plus the
/// Confirmed Equipment association when one exists. Suggested associations are
/// never carried.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CaptureEvidence {
    pub values: BTreeMap<EvidenceField, SourcedValue>,
    pub confirmed_equipment: Option<Uuid>,
}

/// Canonical decimal text: `300` and `300.0` read the same; negative zero is zero.
#[must_use]
pub fn canonical_decimal(value: f64) -> String {
    if value == 0.0 {
        return "0".into();
    }
    format!("{value}")
}

impl CaptureEvidence {
    /// Canonical evidence of effective metadata. `corrected` holds the camelCase
    /// `CaptureMetadata` fields a reviewed correction set; `night` is the Session
    /// key's night.
    #[must_use]
    pub fn from_metadata(
        effective: &CaptureMetadata,
        corrected: &BTreeSet<String>,
        night: Option<&str>,
        confirmed_equipment: Option<Uuid>,
    ) -> Self {
        let mut values = BTreeMap::new();
        let mut put = |field: EvidenceField, value: Option<String>, name: &str, header: &str| {
            let Some(value) = value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty()) else {
                return;
            };
            let source =
                if corrected.contains(name) { format!("correction:{name}") } else { header.into() };
            values.insert(field, SourcedValue { value, source });
        };
        let text = |value: &Option<String>| value.clone();
        put(EvidenceField::ImageType, text(&effective.image_type), "imageType", "IMAGETYP");
        put(EvidenceField::Camera, text(&effective.camera), "camera", "INSTRUME");
        put(EvidenceField::CameraId, text(&effective.camera_id), "cameraId", "CAMERAID");
        put(EvidenceField::Width, effective.width.map(|v| v.to_string()), "width", "NAXIS1");
        put(EvidenceField::Height, effective.height.map(|v| v.to_string()), "height", "NAXIS2");
        put(
            EvidenceField::BinningX,
            effective.binning_x.map(|v| v.to_string()),
            "binningX",
            "XBINNING",
        );
        put(
            EvidenceField::BinningY,
            effective.binning_y.map(|v| v.to_string()),
            "binningY",
            "YBINNING",
        );
        put(EvidenceField::Gain, effective.gain.map(canonical_decimal), "gain", "GAIN");
        put(EvidenceField::Offset, effective.offset.map(|v| v.to_string()), "offset", "OFFSET");
        put(
            EvidenceField::Exposure,
            effective.exposure_seconds.map(canonical_decimal),
            "exposureSeconds",
            "EXPTIME",
        );
        put(
            EvidenceField::SetTemperature,
            effective.set_temperature_c.map(canonical_decimal),
            "setTemperatureC",
            "SET-TEMP",
        );
        put(EvidenceField::Filter, text(&effective.filter), "filter", "FILTER");
        put(EvidenceField::Telescope, text(&effective.telescope), "telescope", "TELESCOP");
        put(
            EvidenceField::FocalLength,
            effective.focal_length_mm.map(canonical_decimal),
            "focalLengthMm",
            "FOCALLEN",
        );
        put(
            EvidenceField::MeasuredTemperature,
            effective.measured_temperature_c.map(canonical_decimal),
            "measuredTemperatureC",
            "CCD-TEMP",
        );
        put(EvidenceField::ReadoutMode, text(&effective.readout_mode), "readoutMode", "READOUTM");
        put(EvidenceField::Night, night.map(str::to_owned), "night", "session key");
        Self { values, confirmed_equipment }
    }

    #[must_use]
    pub fn get(&self, field: EvidenceField) -> Option<&SourcedValue> {
        self.values.get(&field)
    }
}

/// The light side of a requirement: one light Session at its grouping revision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightEvidence {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    pub capture: CaptureEvidence,
}

/// The input side of a comparison.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputEvidence {
    pub kind: InputKind,
    pub form: InputForm,
    pub capture: CaptureEvidence,
}

// ── Criteria ─────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum Verdict {
    Compatible,
    Incompatible,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum CriterionId {
    ImageType,
    Camera,
    Dimensions,
    Binning,
    Gain,
    Offset,
    Exposure,
    SetTemperature,
    Channel,
    OpticalTrain,
    /// F4 flats: the rig version the flats were taken with is the lights'
    /// (CAL-FR-19); any new version, a remount included, is incompatible.
    RigVersion,
    /// F4 flats: the ROTATANG difference against the thresholds in Settings
    /// (CAL-FR-20).
    Rotation,
    /// F4 darks and bias: the readout mode, compared when recorded (CAL-FR-21).
    ReadoutMode,
}

/// Exact comparison only (D13); the wire states it on every row.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum Tolerance {
    #[default]
    None,
}

/// One "Why this match" row.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CriterionResult {
    pub criterion: CriterionId,
    pub verdict: Verdict,
    pub light_value: Option<String>,
    pub input_value: Option<String>,
    pub light_source: Option<String>,
    pub input_source: Option<String>,
    #[serde(default)]
    pub tolerance: Tolerance,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum EvidenceId {
    MeasuredTemperature,
    ReadoutMode,
    NightDistance,
    Availability,
    Quality,
}

/// Evidence shown beside the criteria without a verdict.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct EvidenceRow {
    pub evidence: EvidenceId,
    pub light_value: Option<String>,
    pub input_value: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Every criterion of a kind with the overall verdict: compatible only when every
/// criterion is, incompatible when any is, unknown otherwise.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Evaluation {
    pub verdict: Verdict,
    pub criteria: Vec<CriterionResult>,
    pub evidence: Vec<EvidenceRow>,
}

impl Evaluation {
    #[must_use]
    pub fn new(criteria: Vec<CriterionResult>, evidence: Vec<EvidenceRow>) -> Self {
        Self { verdict: overall_verdict(&criteria), criteria, evidence }
    }

    /// The criteria that keep this evaluation from being compatible.
    #[must_use]
    pub fn blocking(&self) -> Vec<CriterionId> {
        self.criteria
            .iter()
            .filter(|row| row.verdict != Verdict::Compatible)
            .map(|row| row.criterion)
            .collect()
    }
}

#[must_use]
pub fn overall_verdict(criteria: &[CriterionResult]) -> Verdict {
    if criteria.iter().any(|row| row.verdict == Verdict::Incompatible) {
        Verdict::Incompatible
    } else if criteria.iter().all(|row| row.verdict == Verdict::Compatible) {
        Verdict::Compatible
    } else {
        Verdict::Unknown
    }
}

// ── Inputs and candidates ────────────────────────────────────────────────────

/// Any listed input, reusable or not.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(tag = "form", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum CandidateRef {
    RawSet { session_id: Uuid, grouping_revision: Revision },
    Master { master_id: Uuid, revision: Revision },
    Candidate { asset_id: Uuid },
}

impl CandidateRef {
    #[must_use]
    pub const fn form(&self) -> InputForm {
        match self {
            Self::RawSet { .. } => InputForm::RawSet,
            Self::Master { .. } => InputForm::Master,
            Self::Candidate { .. } => InputForm::Candidate,
        }
    }
    #[must_use]
    pub const fn id(&self) -> Uuid {
        match self {
            Self::RawSet { session_id: id, .. }
            | Self::Master { master_id: id, .. }
            | Self::Candidate { asset_id: id } => *id,
        }
    }
    /// The decision input this candidate is, if it is reusable at all.
    #[must_use]
    pub const fn input(&self) -> Option<InputRef> {
        match *self {
            Self::RawSet { session_id, grouping_revision } => {
                Some(InputRef::RawSet { session_id, grouping_revision })
            }
            Self::Master { master_id, revision } => Some(InputRef::Master { master_id, revision }),
            Self::Candidate { .. } => None,
        }
    }
}

impl From<InputRef> for CandidateRef {
    fn from(input: InputRef) -> Self {
        match input {
            InputRef::RawSet { session_id, grouping_revision } => {
                Self::RawSet { session_id, grouping_revision }
            }
            InputRef::Master { master_id, revision } => Self::Master { master_id, revision },
        }
    }
}

/// Where a master came from (R17): an indexed file, its location and path.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum MasterOrigin {
    Location { location_id: Uuid, location_name: String, relative_path: NativePath },
}

/// Current availability of an input's files, counted per logical capture.
/// Offline members keep their last-observed state and are never absence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct InputState {
    pub availability: Availability,
    /// Logical captures that are inputs (Library-Unusable members left out).
    pub members: u64,
    pub available_members: u64,
    /// Library-Unusable logical captures, listed as excluded (R3).
    pub excluded_members: u64,
    /// The raw-set Session was superseded by a regroup, or the master's location retired.
    pub superseded: bool,
    /// An adopted master whose library copy last hashed against a different
    /// digest than its adoption recorded (CAL-AC-10). It is never assigned,
    /// suggested or accepted while it reads drifted.
    #[serde(default)]
    pub drifted: bool,
}

impl InputState {
    /// Fully available: every member readable now and nothing superseded.
    #[must_use]
    pub fn available(&self) -> bool {
        !self.superseded
            && self.availability == Availability::Available
            && self.available_members == self.members
            && self.members > 0
    }
}

/// One candidate input as the plan sees it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputCandidate {
    pub candidate: CandidateRef,
    pub evidence: InputEvidence,
    pub state: InputState,
    #[serde(default)]
    pub master: Option<MasterEvidence>,
    #[serde(default)]
    pub origin: Option<MasterOrigin>,
}

// ── Master adoption ──────────────────────────────────────────────────────────

/// The file a review adopts: an indexed asset at its expected revision.
/// Adopting a master `Processing/` offered is an open CAL item.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged, rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum AdoptionSource {
    Asset { asset_id: Uuid, expected: ExpectedAsset },
}

/// A new file below a registered Calibration location.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct AdoptionDestination {
    pub location_id: Uuid,
    pub relative_path: NativePath,
}

impl AdoptionDestination {
    /// Validate the destination path, keeping its native encoding.
    ///
    /// # Errors
    /// `InvalidInput` naming `relativePath` for an absolute path, parent
    /// traversal, the location root itself or an empty file name.
    pub fn validate(&self) -> Result<PathBuf, LibraryError> {
        let refuse = |why: &str| invalid(format!("relativePath {why}"));
        let path = self.relative_path.to_path_buf().map_err(|_| refuse("is not a native path"))?;
        if path.components().any(|part| matches!(part, Component::Prefix(_) | Component::RootDir)) {
            return Err(refuse("is absolute"));
        }
        if path.components().any(|part| matches!(part, Component::ParentDir)) {
            return Err(refuse("traverses a parent folder"));
        }
        if path.components().all(|part| matches!(part, Component::CurDir)) {
            return Err(refuse("names the location root"));
        }
        let ends_in_separator = match &self.relative_path {
            NativePath::UnixBytes(bytes) => bytes.last() == Some(&b'/'),
            NativePath::WindowsUtf16(units) => {
                matches!(units.last(), Some(&unit) if unit == u16::from(b'/') || unit == u16::from(b'\\'))
            }
        };
        let last_dot = path.as_os_str().as_encoded_bytes().ends_with(b"/.")
            || path.as_os_str().as_encoded_bytes().ends_with(b"\\.");
        if ends_in_separator || last_dot || path.file_name().is_none() {
            return Err(refuse("has an empty file name"));
        }
        Ok(path)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ReviewState {
    Open,
    Adopted,
}

/// The reviewed source bytes: identity, path and the SHA-256 hashed at review.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ReviewedSource {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<Uuid>,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
    pub sha256: String,
}

/// A durable adoption review; it writes no file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct AdoptionReview {
    pub id: Uuid,
    pub revision: Revision,
    pub state: ReviewState,
    pub source: ReviewedSource,
    pub classification: Classification,
    pub observed: CaptureMetadata,
    pub origin: MasterOrigin,
    pub destination: AdoptionDestination,
    pub created_at: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum AdoptionState {
    Running,
    Completed,
    Failed,
    Interrupted,
}

/// Lifecycle phases, each committed before the next file effect.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum AdoptionPhase {
    Intent,
    TempCreated,
    Copied,
    Installed,
    Verified,
    Registered,
}

/// A file the adoption created, by location-relative path and identity.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CreatedFile {
    pub relative_path: NativePath,
    pub identity: FileIdentity,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct AdoptionOperation {
    pub id: Uuid,
    pub review_id: Uuid,
    pub state: AdoptionState,
    pub phase: AdoptionPhase,
    pub temporary: Option<CreatedFile>,
    pub installed: Option<CreatedFile>,
    pub error: Option<ErrorResponse>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub master_id: Option<Uuid>,
    /// The registered master once the operation completed.
    #[serde(default)]
    pub master: Option<AdoptedMaster>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct MasterProvenance {
    pub review_id: Uuid,
    pub source: ReviewedSource,
    pub origin: MasterOrigin,
    pub adopted_at: String,
}

/// A master adopted into a Calibration location. Library corrections of the
/// source are not carried (R16).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct AdoptedMaster {
    pub id: Uuid,
    pub revision: Revision,
    pub kind: InputKind,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
    pub classification: Classification,
    pub observed: CaptureMetadata,
    pub provenance: MasterProvenance,
    /// The indexed destination asset, once a scan indexed the copy.
    #[serde(default)]
    pub asset_id: Option<Uuid>,
}

// ── Custody (STO seam) ───────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum CustodyKind {
    CandidateMaster,
    AdoptedMaster,
    GeneratedSource,
}

/// The verified kept copy of a retained generated source: the adopted master
/// that holds the same bytes. Distinct from the storage journal's `KeptCopy`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct MasterKeptCopy {
    pub master_id: Uuid,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
}

/// A calibration file STO keeps in protected Keep, with its no-follow fingerprint.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CustodyFact {
    pub kind: CustodyKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub master_id: Option<Uuid>,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
    #[serde(default)]
    pub kept_copy: Option<MasterKeptCopy>,
}

// ── Rules ────────────────────────────────────────────────────────────────────

/// Pure calibration semantics, passed to the catalog as a trait object the way
/// grouping is: classification and criterion evaluation. It never reads
/// storage, the clock or settings.
pub trait CalibrationRules: Send + Sync {
    /// Classify a file by its effective IMAGETYP, stack count and path; `None`
    /// for lights, dark flats, light masters and unclassified frames.
    fn classify(
        &self,
        effective: &CaptureMetadata,
        relative_path: &NativePath,
    ) -> Option<Classification>;
    /// Evaluate one input against one light Session for a kind.
    fn evaluate(&self, kind: InputKind, light: &LightEvidence, input: &InputEvidence)
        -> Evaluation;
    /// F4 session matching (CAL-FR-19 to CAL-FR-21): every input of `kind`
    /// that passes the hard checks against one light session, best first,
    /// with the cautions that keep each from being pinned automatically.
    /// The thresholds and windows are the caller's workflow settings.
    fn match_session(
        &self,
        kind: InputKind,
        light: &crate::SessionLight,
        inputs: &[crate::SessionInput],
        settings: &crate::WorkflowSettings,
    ) -> crate::KindMatch;
}
