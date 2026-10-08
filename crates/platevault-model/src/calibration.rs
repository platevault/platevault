// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inputs (spec 068): raw sets, detected and adopted masters, the
//! D13 criteria that explain every match, per-View plans and decisions, and the
//! reviewed master adoption.
//!
//! A calibration plan and its decisions are Tier 1 catalog records bound to a
//! committed View revision. Candidates, evaluations, requirement states and the
//! handoff are recomputed on read and never stored. Every comparison is exact on
//! canonical text or decimals with tolerance `none`; a value missing on either
//! side reads `unknown`, never compatible.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    Availability, CaptureMetadata, ErrorResponse, ExpectedAsset, FileIdentity, LibraryError,
    NativePath, ObservationFingerprint, Revision,
};

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
pub enum InputKind {
    Bias,
    Dark,
    Flat,
}

impl InputKind {
    /// The kinds a View requires until its plan is changed explicitly (R11).
    pub const DEFAULT_REQUIRED: [Self; 2] = [Self::Dark, Self::Flat];

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

/// Validate a View's required kinds; an empty set is allowed and recorded.
///
/// # Errors
/// `InvalidInput` naming `kinds` when a kind appears twice.
pub fn required_kinds(kinds: &[InputKind]) -> Result<Vec<InputKind>, LibraryError> {
    let mut seen = BTreeSet::new();
    if let Some(twice) = kinds.iter().find(|kind| !seen.insert(**kind)) {
        return Err(invalid(format!("kinds name {} twice", twice.as_str())));
    }
    Ok(seen.into_iter().collect())
}

/// How an input reaches PREP.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
pub struct MasterEvidence {
    pub basis: MasterBasis,
    pub stack_count: Option<u32>,
    /// The `calibration_master_detect` detector that supplied the base kind.
    pub detector: String,
}

/// A calibration file's kind and whether it is a raw frame or a master.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
pub struct SourcedValue {
    pub value: String,
    pub source: String,
}

/// One side of a comparison: canonical values with their sources, plus the
/// Confirmed Equipment association when one exists. Suggested associations are
/// never carried.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
pub enum Verdict {
    Compatible,
    Incompatible,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
}

/// Exact comparison only (D13); the wire states it on every row.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tolerance {
    #[default]
    None,
}

/// One "Why this match" row.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// Where a master came from (R17).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum MasterOrigin {
    /// An indexed file: its location and path.
    Location { location_id: Uuid, location_name: String, relative_path: NativePath },
    /// A RES output of a View (070 seam).
    View { view_id: Uuid, view_name: String },
}

/// Current availability of an input's files, counted per logical capture.
/// Offline members keep their last-observed state and are never absence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputState {
    pub availability: Availability,
    /// Logical captures that are inputs (Library-Unusable members left out).
    pub members: u64,
    pub available_members: u64,
    /// Library-Unusable logical captures, listed as excluded (R3).
    pub excluded_members: u64,
    /// The raw-set Session was superseded by a regroup, or the master's location retired.
    pub superseded: bool,
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

/// One light Session of a committed View revision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightBasis {
    pub evidence: LightEvidence,
    /// The Session's included members at this View revision (VSEL seam).
    pub included_assets: BTreeSet<Uuid>,
    /// The Session's own type: `false` when its effective IMAGETYP is unknown.
    pub light_type_known: bool,
    /// A processed product: products carry no requirement (RES-FR-05).
    #[serde(default)]
    pub product: bool,
}

/// Everything the pure planner reads, gathered in one catalog snapshot.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationViewBasis {
    pub view_id: Uuid,
    pub view_revision: Revision,
    pub plan: CalibrationPlan,
    pub lights: Vec<LightBasis>,
    pub candidates: Vec<InputCandidate>,
    /// The effective (latest) decision per light Session and kind, any View revision.
    pub decisions: Vec<CalibrationDecision>,
}

// ── Plans and decisions ──────────────────────────────────────────────────────

/// A View's calibration plan. A View without a row reads revision 0 with the
/// default kinds dark and flat.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationPlan {
    pub view_id: Uuid,
    pub revision: Revision,
    pub required_kinds: Vec<InputKind>,
    pub updated_at: Option<String>,
}

impl CalibrationPlan {
    #[must_use]
    pub fn unplanned(view_id: Uuid) -> Self {
        Self {
            view_id,
            revision: 0,
            required_kinds: InputKind::DEFAULT_REQUIRED.to_vec(),
            updated_at: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Resolution {
    Accepted,
    Exception,
    Withdrawn,
}

/// One handed-off file: `assetId` for a raw-set member, `masterId` for an
/// adopted master, with the fingerprint whose SHA-256 was hashed at decision time.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationInputFile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub master_id: Option<Uuid>,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
}

/// An append-only decision row; the latest per View, light Session and kind is effective.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationDecision {
    pub id: Uuid,
    pub view_id: Uuid,
    /// The committed View revision the decision was made at.
    pub view_revision: Revision,
    pub light_session_id: Uuid,
    pub grouping_revision: Revision,
    /// The light Session's exact included asset IDs at that revision.
    pub light_asset_ids: BTreeSet<Uuid>,
    pub kind: InputKind,
    pub resolution: Resolution,
    /// `None` for a withdrawal.
    pub input: Option<InputRef>,
    pub inputs: Vec<CalibrationInputFile>,
    /// The criteria snapshot the decision was made on.
    pub criteria: Vec<CriterionResult>,
    pub reason: Option<String>,
    pub plan_revision: Revision,
    pub decided_at: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequirementState {
    Suggested,
    Accepted,
    Excepted,
    Unresolved,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnresolvedReason {
    NoCandidate,
    SuggestionUnaccepted,
    CriterionUnknown,
    CriterionIncompatible,
    LightMembershipChanged,
    InputEvidenceChanged,
    InputUnavailable,
    LightTypeUnknown,
}

/// A candidate evaluated against one requirement.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateEvaluation {
    pub candidate: CandidateRef,
    pub kind: InputKind,
    pub evaluation: Evaluation,
    /// Absolute night distance in days; `None` when either night is unknown.
    pub night_distance_days: Option<u32>,
    pub state: InputState,
    pub preselected: bool,
    #[serde(default)]
    pub master: Option<MasterEvidence>,
    #[serde(default)]
    pub origin: Option<MasterOrigin>,
}

/// The effective decision of a requirement and whether it applies at this revision (R13).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveDecision {
    pub decision: CalibrationDecision,
    pub decided_at_revision: Revision,
    pub applicable: bool,
}

/// One light Session of a committed View revision paired with one required kind.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Requirement {
    pub light_session_id: Uuid,
    pub grouping_revision: Revision,
    pub kind: InputKind,
    pub state: RequirementState,
    pub reason: Option<UnresolvedReason>,
    /// The preselected suggestion; it reads suggested until accepted.
    pub preselected: Option<CandidateRef>,
    /// Reusable candidates in R10 order.
    pub candidates: Vec<CandidateEvaluation>,
    /// Detected masters awaiting adoption; never preselected.
    pub unadopted: Vec<CandidateEvaluation>,
    pub effective: Option<EffectiveDecision>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationViewPlan {
    pub view_id: Uuid,
    pub view_revision: Revision,
    pub plan_revision: Revision,
    pub required_kinds: Vec<InputKind>,
    pub requirements: Vec<Requirement>,
}

/// A requirement PREP cannot prepare yet, with its reason.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedRequirement {
    pub light_session_id: Uuid,
    pub kind: InputKind,
    pub reason: UnresolvedReason,
}

/// An accepted or excepted requirement as PREP reads it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffAssignment {
    /// The effective decision's identity.
    pub id: Uuid,
    pub light_session_id: Uuid,
    pub kind: InputKind,
    pub form: InputForm,
    pub resolution: Resolution,
    pub decided_at_revision: Revision,
    pub criteria: Vec<CriterionResult>,
    pub reason: Option<String>,
    pub inputs: Vec<CalibrationInputFile>,
}

/// The PREP read: suggestions never appear as assignments.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationHandoff {
    pub view_id: Uuid,
    pub view_revision: Revision,
    pub plan_revision: Revision,
    pub ready: bool,
    pub assignments: Vec<HandoffAssignment>,
    pub unresolved: Vec<UnresolvedRequirement>,
}

impl CalibrationViewPlan {
    /// Project accepted and excepted assignments plus every unresolved entry; a
    /// suggested requirement reads `suggestion_unaccepted`. Ready only when no
    /// requirement is suggested or unresolved.
    #[must_use]
    pub fn handoff(&self) -> CalibrationHandoff {
        let mut assignments = Vec::new();
        let mut unresolved = Vec::new();
        for requirement in &self.requirements {
            let unresolved_as = |reason| UnresolvedRequirement {
                light_session_id: requirement.light_session_id,
                kind: requirement.kind,
                reason,
            };
            match (requirement.state, &requirement.effective) {
                (RequirementState::Accepted | RequirementState::Excepted, Some(effective))
                    if effective.applicable =>
                {
                    let decision = &effective.decision;
                    let Some(input) = decision.input else {
                        unresolved.push(unresolved_as(UnresolvedReason::NoCandidate));
                        continue;
                    };
                    assignments.push(HandoffAssignment {
                        id: decision.id,
                        light_session_id: decision.light_session_id,
                        kind: decision.kind,
                        form: input.form(),
                        resolution: decision.resolution,
                        decided_at_revision: effective.decided_at_revision,
                        criteria: decision.criteria.clone(),
                        reason: decision.reason.clone(),
                        inputs: decision.inputs.clone(),
                    });
                }
                (RequirementState::Suggested, _) => {
                    unresolved.push(unresolved_as(UnresolvedReason::SuggestionUnaccepted));
                }
                _ => unresolved.push(unresolved_as(
                    requirement.reason.unwrap_or(UnresolvedReason::NoCandidate),
                )),
            }
        }
        CalibrationHandoff {
            view_id: self.view_id,
            view_revision: self.view_revision,
            plan_revision: self.plan_revision,
            ready: unresolved.is_empty(),
            assignments,
            unresolved,
        }
    }
}

// ── Master adoption ──────────────────────────────────────────────────────────

/// The file a review adopts: an indexed asset at its expected revision, or a
/// RES output once 070 lands.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum AdoptionSource {
    Asset { asset_id: Uuid, expected: ExpectedAsset },
    Result { result_id: Uuid },
}

/// A new file below a registered Calibration location.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
pub enum ReviewState {
    Open,
    Adopted,
}

/// The reviewed source bytes: identity, path and the SHA-256 hashed at review.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedSource {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_id: Option<Uuid>,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
    pub sha256: String,
}

/// A durable adoption review; it writes no file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
pub enum AdoptionState {
    Running,
    Completed,
    Failed,
    Interrupted,
}

/// Lifecycle phases, each committed before the next file effect.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
pub struct CreatedFile {
    pub relative_path: NativePath,
    pub identity: FileIdentity,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
pub enum CustodyKind {
    CandidateMaster,
    AdoptedMaster,
    GeneratedSource,
}

/// The verified kept copy of a retained generated source: the adopted master
/// that holds the same bytes. Distinct from the storage journal's `KeptCopy`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterKeptCopy {
    pub master_id: Uuid,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
}

/// A calibration file STO keeps in protected Keep, with its no-follow fingerprint.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustodyFact {
    pub kind: CustodyKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub master_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_id: Option<Uuid>,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub fingerprint: ObservationFingerprint,
    #[serde(default)]
    pub kept_copy: Option<MasterKeptCopy>,
}

// ── Rules ────────────────────────────────────────────────────────────────────

/// Pure calibration semantics, passed to the catalog as a trait object the way
/// grouping is: classification, criterion evaluation and plan assembly. It never
/// reads storage, the clock or settings.
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
    /// Build requirements, order and preselect candidates, and apply decisions.
    fn plan(&self, basis: &CalibrationViewBasis) -> CalibrationViewPlan;
}
