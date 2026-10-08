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
    Availability, CalibrationPolicy, CaptureMetadata, ErrorResponse, ExpectedAsset, FileIdentity,
    LibraryError, NativePath, ObservationFingerprint, PanelRunState, Revision,
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

/// The key of a run's light group (CAL-FR-09, CAL-FR-10): the light sessions
/// that share settings, channel and geometry. The camera is not part of it,
/// because a run uses one rig (D-W37). `None` is the unknown value, never a
/// default.
#[derive(Clone, Debug, Default, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightGroupKey {
    pub exposure: Option<String>,
    pub gain: Option<String>,
    pub offset: Option<String>,
    pub set_temperature: Option<String>,
    /// The filter.
    pub channel: Option<String>,
    /// `<width>x<height>`.
    pub dimensions: Option<String>,
    /// `<x>x<y>`.
    pub binning: Option<String>,
    /// `false` for sessions whose own type is unknown; they never share a
    /// group with known lights.
    pub light_type_known: bool,
}

impl LightGroupKey {
    #[must_use]
    pub fn of(light: &LightBasis) -> Self {
        let capture = &light.evidence.capture;
        let value = |field| capture.get(field).map(|v| v.value.clone());
        let pair = |a, b| Some(format!("{}x{}", value(a)?, value(b)?));
        Self {
            exposure: value(EvidenceField::Exposure),
            gain: value(EvidenceField::Gain),
            offset: value(EvidenceField::Offset),
            set_temperature: value(EvidenceField::SetTemperature),
            channel: value(EvidenceField::Filter),
            dimensions: pair(EvidenceField::Width, EvidenceField::Height),
            binning: pair(EvidenceField::BinningX, EvidenceField::BinningY),
            light_type_known: light.light_type_known,
        }
    }
}

/// One light group of a committed revision: its sessions in id order.
#[derive(Clone, Debug)]
pub struct LightGroup<'a> {
    pub key: LightGroupKey,
    pub lights: Vec<&'a LightBasis>,
}

impl LightGroup<'_> {
    #[must_use]
    pub fn session_ids(&self) -> Vec<Uuid> {
        self.lights.iter().map(|light| light.evidence.session_id).collect()
    }

    /// Every included member copy of every session of the group.
    #[must_use]
    pub fn asset_ids(&self) -> BTreeSet<Uuid> {
        self.lights.iter().flat_map(|light| light.included_assets.iter().copied()).collect()
    }
}

/// The light groups of `lights` in key order; products carry no requirement.
#[must_use]
pub fn light_groups(lights: &[LightBasis]) -> Vec<LightGroup<'_>> {
    let mut groups: BTreeMap<LightGroupKey, Vec<&LightBasis>> = BTreeMap::new();
    for light in lights.iter().filter(|light| !light.product) {
        groups.entry(LightGroupKey::of(light)).or_default().push(light);
    }
    groups
        .into_iter()
        .map(|(key, mut lights)| {
            lights.sort_by_key(|light| light.evidence.session_id);
            LightGroup { key, lights }
        })
        .collect()
}

/// Everything the pure planner reads, gathered in one catalog snapshot.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationViewBasis {
    pub view_id: Uuid,
    pub view_revision: Revision,
    pub plan: CalibrationPlan,
    /// One light per included session; for a run each carries the run's rig
    /// as its Confirmed Equipment.
    pub lights: Vec<LightBasis>,
    pub candidates: Vec<InputCandidate>,
    /// The latest decision per light group and kind, any run revision,
    /// withdrawals included.
    pub decisions: Vec<CalibrationDecision>,
}

// ── Plans and decisions ──────────────────────────────────────────────────────

/// A run's calibration plan: the kinds it requires and its policy (D-W55).
/// A run without a plan row reads revision 0 with the default kinds dark and
/// flat; the policy is the run's own setting.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationPlan {
    pub view_id: Uuid,
    pub revision: Revision,
    pub required_kinds: Vec<InputKind>,
    #[serde(default)]
    pub policy: CalibrationPolicy,
    pub updated_at: Option<String>,
}

impl CalibrationPlan {
    #[must_use]
    pub fn unplanned(view_id: Uuid) -> Self {
        Self {
            view_id,
            revision: 0,
            required_kinds: InputKind::DEFAULT_REQUIRED.to_vec(),
            policy: CalibrationPolicy::Automatic,
            updated_at: None,
        }
    }
}

/// How a requirement was resolved. `automatic` is the match the product
/// assigned; `accepted` is the user's choice in Review matches, a replacement
/// of an automatic assignment included; `excluded` takes the requirement out
/// without an input; `withdrawn` ends the previous decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Resolution {
    Automatic,
    Accepted,
    Exception,
    Excluded,
    Withdrawn,
}

impl Resolution {
    /// The resolutions that name an input and bind its hashed files.
    #[must_use]
    pub const fn binds_input(self) -> bool {
        matches!(self, Self::Automatic | Self::Accepted | Self::Exception)
    }
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

/// An append-only decision row; the latest per run, light group and kind is effective.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationDecision {
    pub id: Uuid,
    pub view_id: Uuid,
    /// The committed membership revision the decision was made at.
    pub view_revision: Revision,
    pub light_group: LightGroupKey,
    /// The group's light sessions at that revision.
    pub light_session_ids: BTreeSet<Uuid>,
    /// The group's exact included asset IDs at that revision.
    pub light_asset_ids: BTreeSet<Uuid>,
    pub kind: InputKind,
    pub resolution: Resolution,
    /// `None` for an exclusion or a withdrawal.
    pub input: Option<InputRef>,
    /// Every file the input binds, each with the SHA-256 hashed for it.
    pub inputs: Vec<CalibrationInputFile>,
    /// The criteria snapshot the decision was made on.
    pub criteria: Vec<CriterionResult>,
    pub reason: Option<String>,
    pub plan_revision: Revision,
    pub decided_at: String,
}

/// One requirement's resolution request: a light group, a kind and an input.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionItem {
    pub light_group: LightGroupKey,
    pub kind: InputKind,
    pub input: InputRef,
}

impl DecisionItem {
    /// Validate a batch of decision items.
    ///
    /// # Errors
    /// `InvalidInput` naming `items` for an empty batch or a requirement named
    /// twice, and naming `input` for a nil identity.
    pub fn validate(items: &[Self]) -> Result<(), LibraryError> {
        if items.is_empty() {
            return Err(invalid("items is empty".into()));
        }
        let mut seen = BTreeSet::new();
        for item in items {
            if item.input.id().is_nil() {
                return Err(invalid("input names a nil identity".into()));
            }
            if !seen.insert((&item.light_group, item.kind)) {
                return Err(invalid(format!(
                    "items name {} for one light group twice",
                    item.kind.as_str()
                )));
            }
        }
        Ok(())
    }
}

/// One requirement of a run: a light group and a kind.
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementKey {
    pub light_group: LightGroupKey,
    pub kind: InputKind,
}

impl RequirementKey {
    /// Validate a batch of requirement keys.
    ///
    /// # Errors
    /// `InvalidInput` naming `items` for an empty batch or a requirement named twice.
    pub fn validate(items: &[Self]) -> Result<(), LibraryError> {
        if items.is_empty() {
            return Err(invalid("items is empty".into()));
        }
        let mut seen = BTreeSet::new();
        if let Some(twice) = items.iter().find(|item| !seen.insert(*item)) {
            return Err(invalid(format!(
                "items name {} for one light group twice",
                twice.kind.as_str()
            )));
        }
        Ok(())
    }
}

/// Validate a scoped exception's or an exclusion's reason: trimmed and never blank.
///
/// # Errors
/// `InvalidInput` naming `reason` when it is empty or whitespace only.
pub fn exception_reason(reason: &str) -> Result<String, LibraryError> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(invalid("reason is blank; an exception needs a reason".into()));
    }
    Ok(reason.to_owned())
}

/// A requirement's state in the run's requirement table (CAL-FR-09).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RequirementState {
    /// The single fully compatible top input, assigned automatically.
    Automatic,
    /// A fully compatible top input not assigned: the policy is off, matching
    /// has not run yet, or the user withdrew the previous decision.
    Suggested,
    /// The user's fully compatible choice.
    Accepted,
    /// The user's choice with a scoped exception and its reason.
    Excepted,
    /// Explicitly taken out by the user.
    Excluded,
    /// No single fully compatible input is assigned: unknown, incompatible,
    /// missing, tied or drifted, or a decision that no longer applies.
    NeedsReview,
}

impl RequirementState {
    /// Automatic or Accepted: the group has a fully compatible assignment.
    #[must_use]
    pub const fn matched(self) -> bool {
        matches!(self, Self::Automatic | Self::Accepted)
    }

    /// How far the state is from resolved: a group reads its least resolved requirement.
    const fn rank(self) -> u8 {
        match self {
            Self::NeedsReview => 0,
            Self::Suggested => 1,
            Self::Excepted => 2,
            Self::Excluded => 3,
            Self::Accepted => 4,
            Self::Automatic => 5,
        }
    }
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
    /// Two or more fully compatible inputs rank equal: no single top input.
    RankingTie,
    /// The only fully compatible input is an adopted master that drifted
    /// from its adoption digest.
    MasterDrifted,
}

/// A candidate evaluated against one requirement.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateEvaluation {
    pub candidate: CandidateRef,
    pub kind: InputKind,
    /// Every criterion across the group's sessions: compatible only when it is
    /// for every session.
    pub evaluation: Evaluation,
    /// The largest absolute night distance in days to any session of the
    /// group; `None` when any night is unknown.
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

/// One light group of a committed run revision paired with one required kind.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Requirement {
    pub light_group: LightGroupKey,
    /// The group's light sessions in id order.
    pub light_session_ids: Vec<Uuid>,
    /// The group's included members at this revision.
    pub light_asset_ids: BTreeSet<Uuid>,
    pub kind: InputKind,
    pub state: RequirementState,
    pub reason: Option<UnresolvedReason>,
    /// The single fully compatible top input; it reads suggested until assigned.
    pub preselected: Option<CandidateRef>,
    /// The input the automatic match records: the preselected input while the
    /// policy is automatic and no decision holds the group's current members.
    pub automatic: Option<InputRef>,
    /// Reusable candidates of the run's camera in R10 order.
    pub candidates: Vec<CandidateEvaluation>,
    /// Detected masters awaiting adoption; never preselected.
    pub unadopted: Vec<CandidateEvaluation>,
    pub effective: Option<EffectiveDecision>,
}

impl Requirement {
    #[must_use]
    pub fn key(&self) -> RequirementKey {
        RequirementKey { light_group: self.light_group.clone(), kind: self.kind }
    }

    /// Missing calibration (PRJ-FR-11): no listed input is fully compatible.
    #[must_use]
    pub fn missing_input(&self) -> bool {
        !self.candidates.iter().any(|c| c.evaluation.verdict == Verdict::Compatible)
    }

    /// The dark candidates whose only possible incompatibility is exposure,
    /// with their exposure rows.
    fn exposure_rows(&self) -> Vec<&CriterionResult> {
        if self.kind != InputKind::Dark {
            return Vec::new();
        }
        self.candidates
            .iter()
            .filter(|c| {
                c.evaluation.criteria.iter().all(|row| {
                    row.criterion == CriterionId::Exposure || row.verdict != Verdict::Incompatible
                })
            })
            .filter_map(|c| {
                c.evaluation.criteria.iter().find(|row| row.criterion == CriterionId::Exposure)
            })
            .collect()
    }

    /// Exposure mismatch (PRJ-FR-11): among the darks with no incompatible
    /// criterion other than exposure there is at least one, and every one of
    /// them has an incompatible exposure.
    #[must_use]
    pub fn exposure_mismatch(&self) -> bool {
        let rows = self.exposure_rows();
        !rows.is_empty() && rows.iter().all(|row| row.verdict == Verdict::Incompatible)
    }

    /// The light and dark exposures of an exposure mismatch, canonical text.
    #[must_use]
    pub fn mismatched_exposures(&self) -> (BTreeSet<String>, BTreeSet<String>) {
        if !self.exposure_mismatch() {
            return (BTreeSet::new(), BTreeSet::new());
        }
        let rows = self.exposure_rows();
        let light = rows.iter().filter_map(|row| row.light_value.clone()).collect();
        let dark = rows.iter().filter_map(|row| row.input_value.clone()).collect();
        (light, dark)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationViewPlan {
    pub view_id: Uuid,
    pub view_revision: Revision,
    pub plan_revision: Revision,
    pub policy: CalibrationPolicy,
    pub required_kinds: Vec<InputKind>,
    /// By light group, then kind.
    pub requirements: Vec<Requirement>,
}

/// A requirement PREP cannot prepare yet, with its reason.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedRequirement {
    pub light_group: LightGroupKey,
    pub light_session_ids: Vec<Uuid>,
    pub kind: InputKind,
    pub reason: UnresolvedReason,
}

/// An automatic, accepted or excepted requirement as PREP reads it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffAssignment {
    /// The effective decision's identity.
    pub id: Uuid,
    pub light_group: LightGroupKey,
    pub light_session_ids: Vec<Uuid>,
    pub kind: InputKind,
    pub form: InputForm,
    pub resolution: Resolution,
    pub decided_at_revision: Revision,
    pub criteria: Vec<CriterionResult>,
    pub reason: Option<String>,
    pub inputs: Vec<CalibrationInputFile>,
}

/// A requirement the user excluded: PREP prepares the group without that kind.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffExclusion {
    /// The effective decision's identity.
    pub id: Uuid,
    pub light_group: LightGroupKey,
    pub light_session_ids: Vec<Uuid>,
    pub kind: InputKind,
    pub reason: Option<String>,
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
    pub excluded: Vec<HandoffExclusion>,
    pub unresolved: Vec<UnresolvedRequirement>,
}

/// One light group on the readiness line, read as its least resolved requirement.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupReadiness {
    pub light_group: LightGroupKey,
    pub light_session_ids: Vec<Uuid>,
    pub state: RequirementState,
    /// Why the group needs review, from its first requirement that does.
    pub reason: Option<UnresolvedReason>,
}

/// The Calibrate step's readiness line (CAL-FR-09): light groups matched
/// (automatic or accepted), suggested, needing review, excepted and excluded.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationReadiness {
    pub view_id: Uuid,
    pub view_revision: Revision,
    pub plan_revision: Revision,
    pub groups: Vec<GroupReadiness>,
    pub matched: u64,
    pub suggested: u64,
    pub needs_review: u64,
    pub excepted: u64,
    pub excluded: u64,
    /// Every group matched, excepted or excluded.
    pub ready: bool,
}

/// The run blocker calibration feeds (Home's blocked run, PRJ-AC-23): groups
/// that still need a review or an acceptance.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationNeedsReview {
    pub view_id: Uuid,
    pub view_revision: Revision,
    pub groups: u64,
}

impl CalibrationReadiness {
    /// `Some` while any group needs review or a suggestion awaits acceptance.
    #[must_use]
    pub const fn needs_review_blocker(&self) -> Option<CalibrationNeedsReview> {
        let groups = self.needs_review + self.suggested;
        if groups == 0 {
            return None;
        }
        Some(CalibrationNeedsReview {
            view_id: self.view_id,
            view_revision: self.view_revision,
            groups,
        })
    }
}

/// One panel run's readiness line in its run group (CAL-FR-11). A panel run
/// in the Project's Trash is listed as Trashed and counts toward no group
/// aggregate (D-W75).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelCalibrationReadiness {
    pub panel_id: Uuid,
    pub number: u32,
    pub view_id: Uuid,
    pub state: PanelRunState,
    /// The readiness of the panel run's latest committed membership revision;
    /// `None` until the panel run is first saved, as nothing is matched yet.
    pub readiness: Option<CalibrationReadiness>,
}

/// A run group's calibration (CAL-FR-11, PREP-FR-12): the one policy its
/// panel runs share and each panel run's readiness, by panel number. Each
/// panel run is matched on its own lights and keeps its own assignments,
/// exceptions and exclusions.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupCalibrationReadiness {
    pub group_id: Uuid,
    pub group_revision: Revision,
    pub policy: CalibrationPolicy,
    pub panels: Vec<PanelCalibrationReadiness>,
}

fn count(items: usize) -> u64 {
    u64::try_from(items).unwrap_or(u64::MAX)
}

impl CalibrationViewPlan {
    /// Project automatic, accepted and excepted assignments, exclusions and
    /// every unresolved entry; a suggested requirement reads
    /// `suggestion_unaccepted`. Ready only when nothing is unresolved.
    #[must_use]
    pub fn handoff(&self) -> CalibrationHandoff {
        let mut assignments = Vec::new();
        let mut excluded = Vec::new();
        let mut unresolved = Vec::new();
        for requirement in &self.requirements {
            let unresolved_as = |reason| UnresolvedRequirement {
                light_group: requirement.light_group.clone(),
                light_session_ids: requirement.light_session_ids.clone(),
                kind: requirement.kind,
                reason,
            };
            let applicable =
                requirement.effective.as_ref().filter(|effective| effective.applicable);
            match (requirement.state, applicable) {
                (
                    RequirementState::Automatic
                    | RequirementState::Accepted
                    | RequirementState::Excepted,
                    Some(effective),
                ) => {
                    let decision = &effective.decision;
                    let Some(input) = decision.input else {
                        unresolved.push(unresolved_as(UnresolvedReason::NoCandidate));
                        continue;
                    };
                    assignments.push(HandoffAssignment {
                        id: decision.id,
                        light_group: requirement.light_group.clone(),
                        light_session_ids: requirement.light_session_ids.clone(),
                        kind: decision.kind,
                        form: input.form(),
                        resolution: decision.resolution,
                        decided_at_revision: effective.decided_at_revision,
                        criteria: decision.criteria.clone(),
                        reason: decision.reason.clone(),
                        inputs: decision.inputs.clone(),
                    });
                }
                (RequirementState::Excluded, Some(effective)) => excluded.push(HandoffExclusion {
                    id: effective.decision.id,
                    light_group: requirement.light_group.clone(),
                    light_session_ids: requirement.light_session_ids.clone(),
                    kind: requirement.kind,
                    reason: effective.decision.reason.clone(),
                }),
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
            excluded,
            unresolved,
        }
    }

    /// The readiness line: each light group reads its least resolved requirement.
    #[must_use]
    pub fn readiness(&self) -> CalibrationReadiness {
        let mut groups: Vec<GroupReadiness> = Vec::new();
        for requirement in &self.requirements {
            let needs = (requirement.state == RequirementState::NeedsReview)
                .then(|| requirement.reason.unwrap_or(UnresolvedReason::NoCandidate));
            match groups.iter_mut().find(|group| group.light_group == requirement.light_group) {
                Some(group) => {
                    if requirement.state.rank() < group.state.rank() {
                        group.state = requirement.state;
                    }
                    group.reason = group.reason.or(needs);
                }
                None => groups.push(GroupReadiness {
                    light_group: requirement.light_group.clone(),
                    light_session_ids: requirement.light_session_ids.clone(),
                    state: requirement.state,
                    reason: needs,
                }),
            }
        }
        let with = |test: fn(RequirementState) -> bool| {
            count(groups.iter().filter(|group| test(group.state)).count())
        };
        let matched = with(RequirementState::matched);
        let suggested = with(|state| state == RequirementState::Suggested);
        let needs_review = with(|state| state == RequirementState::NeedsReview);
        let excepted = with(|state| state == RequirementState::Excepted);
        let excluded = with(|state| state == RequirementState::Excluded);
        CalibrationReadiness {
            view_id: self.view_id,
            view_revision: self.view_revision,
            plan_revision: self.plan_revision,
            ready: needs_review == 0 && suggested == 0,
            groups,
            matched,
            suggested,
            needs_review,
            excepted,
            excluded,
        }
    }
}

/// One requirement the automatic match could not assign, with the refusal of
/// reading its top input.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedRequirement {
    pub requirement: RequirementKey,
    pub error: ErrorResponse,
}

/// What one automatic match did: the requirements it assigned, the adopted
/// masters it found drifted, and the requirements whose top input could not
/// be read. The plan is the run's plan after it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationAssignment {
    pub plan: CalibrationViewPlan,
    pub assigned: Vec<RequirementKey>,
    pub drifted: Vec<Uuid>,
    pub blocked: Vec<BlockedRequirement>,
}

/// Calibration-matching evidence of a Project's candidate sessions for one
/// subject and channel (CAL-FR-12, PRJ-FR-11). It assigns nothing.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectChannelEvidence {
    pub subject_id: Uuid,
    pub channel: Option<String>,
    pub rig_ids: Vec<Uuid>,
    pub light_session_ids: Vec<Uuid>,
    /// The kinds some light group has no fully compatible input for.
    pub missing: Vec<InputKind>,
    /// Darks that differ only in exposure exist and none matches it.
    pub exposure_mismatch: bool,
    pub light_exposures: Vec<String>,
    pub dark_exposures: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCalibrationEvidence {
    pub project_id: Uuid,
    /// By subject order, then channel.
    pub rows: Vec<SubjectChannelEvidence>,
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
