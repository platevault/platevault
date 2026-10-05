// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Views: reviewed session selection and frame membership (spec 066).
//!
//! A View is a Tier 1 catalog record with immutable committed membership
//! revisions and at most one durable draft. Membership is exact: chosen
//! sessions with their reasons, and logical captures (D16) with their recorded
//! copies, each included or excluded with a reason. Candidate evidence,
//! summaries and refresh differences are computed on read and never stored as
//! totals; unknown geometry stays unknown, never zero.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ApplicableQuality, Association, Availability, Equipment, ExpectedAsset, ExpectedSession,
    LibraryError, Microseconds, NativePath, ObservationFingerprint, Revision, SessionSummary,
    SkyCoordinates,
};

/// Default lowest per-frame panel coverage a footprint match needs (R7).
pub const DEFAULT_MIN_FOOTPRINT_COVERAGE: f64 = 0.5;
/// Default radius around a framing centre within which a pointing-only session
/// is listed as a suggestion (R8).
pub const DEFAULT_SUGGESTION_RADIUS_DEG: f64 = 2.0;

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/// Where a View started. It never changes.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewOrigin {
    Project,
    Target,
    Sessions,
}

/// The View header: origin and the latest committed revision, 0 until the first Save.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: Uuid,
    pub origin: ViewOrigin,
    pub origin_project_id: Option<Uuid>,
    pub origin_target_id: Option<Uuid>,
    pub revision: Revision,
    pub created_at: String,
    pub updated_at: String,
}

/// A committed membership revision's header. Committed rows never change.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewRevisionHeader {
    pub view_id: Uuid,
    pub revision: Revision,
    pub name: String,
    pub project_id: Option<Uuid>,
    pub criteria: ViewCriteria,
    /// The committed revision the draft started from; 0 for the first revision.
    pub based_on: Revision,
    pub refresh_review_id: Option<Uuid>,
    pub committed_at: String,
}

/// Recoverable unsaved work. A draft whose base differs from the latest
/// committed revision is `stale`: Save refuses it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewDraftHeader {
    pub view_id: Uuid,
    pub draft_revision: Revision,
    pub base_revision: Revision,
    /// May be blank until Save.
    pub name: String,
    pub project_id: Option<Uuid>,
    pub criteria: ViewCriteria,
    pub refresh_review_id: Option<Uuid>,
    pub updated_at: String,
    pub stale: bool,
}

/// A View with its latest committed revision and its draft, read separately.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewRecord {
    pub view: View,
    pub revision: Option<ViewRevisionHeader>,
    pub draft: Option<ViewDraftHeader>,
}

/// A View summary for lists; no summary totals are computed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewListing {
    pub id: Uuid,
    pub name: String,
    pub origin: ViewOrigin,
    pub project_id: Option<Uuid>,
    pub target_id: Option<Uuid>,
    pub revision: Revision,
    pub committed_at: Option<String>,
    pub has_draft: bool,
    pub draft_stale: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewQuery {
    /// Only Views whose latest revision, or draft before the first Save, names this Project.
    #[serde(default)]
    pub project_id: Option<Uuid>,
    /// Only Views that started from this Target.
    #[serde(default)]
    pub target_id: Option<Uuid>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default)]
    pub limit: u32,
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FramingSource {
    Project,
    Target,
    None,
}

/// A framing Target at the revision snapshotted; null coordinates stay unknown.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramingTarget {
    pub target_id: Uuid,
    pub revision: Revision,
    pub designation: String,
    pub coordinates: Option<SkyCoordinates>,
}

/// A mosaic panel; a null orientation is unknown and gives no footprint.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramingPanel {
    pub id: Uuid,
    pub name: String,
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub width_deg: f64,
    pub height_deg: f64,
    pub position_angle_deg: Option<f64>,
}

/// The framing the View's suggestions were computed against. It comes from
/// the origin and is never client-supplied.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramingSnapshot {
    pub source: FramingSource,
    /// The Project revision when the source is a Project.
    pub project_revision: Option<Revision>,
    pub targets: Vec<FramingTarget>,
    pub panels: Vec<FramingPanel>,
}

impl FramingSnapshot {
    /// No framing: a Sessions-origin View.
    #[must_use]
    pub const fn none() -> Self {
        Self {
            source: FramingSource::None,
            project_revision: None,
            targets: Vec::new(),
            panels: Vec::new(),
        }
    }
}

/// Saved criteria: the framing and equipment snapshots with the overlap and
/// radius settings. Browsing filters are never saved.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewCriteria {
    pub framing: FramingSnapshot,
    /// Equipment ids that qualify a session for preselection (Project snapshot).
    pub equipment_ids: Vec<Uuid>,
    pub min_footprint_coverage: f64,
    pub suggestion_radius_deg: f64,
}

/// Client-settable criteria. The framing and equipment snapshots come from the origin.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriteriaInput {
    #[serde(default = "default_coverage")]
    pub min_footprint_coverage: f64,
    #[serde(default = "default_radius")]
    pub suggestion_radius_deg: f64,
}

const fn default_coverage() -> f64 {
    DEFAULT_MIN_FOOTPRINT_COVERAGE
}

const fn default_radius() -> f64 {
    DEFAULT_SUGGESTION_RADIUS_DEG
}

impl Default for CriteriaInput {
    fn default() -> Self {
        Self {
            min_footprint_coverage: DEFAULT_MIN_FOOTPRINT_COVERAGE,
            suggestion_radius_deg: DEFAULT_SUGGESTION_RADIUS_DEG,
        }
    }
}

impl CriteriaInput {
    /// # Errors
    /// `InvalidInput` naming the field when `minFootprintCoverage` is outside
    /// (0, 1] or `suggestionRadiusDeg` outside (0, 180], or either is not finite.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let coverage = self.min_footprint_coverage;
        if !(coverage.is_finite() && coverage > 0.0 && coverage <= 1.0) {
            return Err(invalid(format!("minFootprintCoverage {coverage} must be in (0, 1]")));
        }
        let radius = self.suggestion_radius_deg;
        if !(radius.is_finite() && radius > 0.0 && radius <= 180.0) {
            return Err(invalid(format!("suggestionRadiusDeg {radius} must be in (0, 180]")));
        }
        Ok(())
    }

    /// These settings over the origin's snapshots.
    #[must_use]
    pub fn criteria(&self, framing: FramingSnapshot, equipment_ids: Vec<Uuid>) -> ViewCriteria {
        ViewCriteria {
            framing,
            equipment_ids,
            min_footprint_coverage: self.min_footprint_coverage,
            suggestion_radius_deg: self.suggestion_radius_deg,
        }
    }
}

impl ViewCriteria {
    /// The client-settable part of these criteria.
    #[must_use]
    pub const fn input(&self) -> CriteriaInput {
        CriteriaInput {
            min_footprint_coverage: self.min_footprint_coverage,
            suggestion_radius_deg: self.suggestion_radius_deg,
        }
    }
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionChoiceState {
    Selected,
    /// An explicit session exclusion: refresh keeps it instead of proposing
    /// the session again.
    Excluded,
}

/// Why a session is chosen, or which suggestion an exclusion declined (R12).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SelectionReason {
    GeometrySuggestion,
    RefreshMatch { review_id: Uuid },
    Manual,
    SelectMatching { filters: Box<CandidateFilters> },
    OriginSessions,
}

impl SelectionReason {
    /// Manual, select-matching and origin-session choices are manual inclusions:
    /// refresh never proposes removing them for falling outside the criteria.
    #[must_use]
    pub const fn is_pinned(&self) -> bool {
        matches!(self, Self::Manual | Self::SelectMatching { .. } | Self::OriginSessions)
    }
}

/// One chosen or excluded session of a membership.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionChoice {
    pub session_id: Uuid,
    /// The session's grouping revision when chosen.
    pub grouping_revision: Revision,
    pub state: SessionChoiceState,
    pub reason: SelectionReason,
    /// The evidence that qualified a criteria-based choice (R11).
    pub evidence: Option<GeometryEvidence>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberState {
    Included,
    Excluded,
}

/// Why a member is included or excluded. The starting reason comes from the
/// capture's applicable quality when chosen (D02); later edits set the others.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum MemberReason {
    Initial,
    LibraryUnusable,
    QualityNeedsReview { quality: ApplicableQuality },
    ViewExclusion,
    ExplicitInclusion,
    Restored,
    RefreshAdded { review_id: Uuid },
}

/// The D02 starting state of a logical capture entering a draft (R14).
#[must_use]
pub fn initial_member_state(quality: &ApplicableQuality) -> (MemberState, MemberReason) {
    match quality {
        ApplicableQuality::Unreviewed | ApplicableQuality::Usable => {
            (MemberState::Included, MemberReason::Initial)
        }
        ApplicableQuality::Unusable => (MemberState::Excluded, MemberReason::LibraryUnusable),
        ApplicableQuality::ChangedContent { .. }
        | ApplicableQuality::VerificationPending { .. }
        | ApplicableQuality::Conflicting
        | ApplicableQuality::ConflictingCopies => {
            (MemberState::Excluded, MemberReason::QualityNeedsReview { quality: *quality })
        }
    }
}

/// A recorded copy of a member: the review basis PREP re-verifies.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberCopy {
    pub asset_id: Uuid,
    pub decision_revision: Revision,
    pub fingerprint: ObservationFingerprint,
}

/// One logical capture (D16) of a membership with its recorded copies, ordered
/// by asset id. The member key is the smallest copy asset id when chosen.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewMember {
    pub member_key: Uuid,
    /// The session the capture was chosen through.
    pub session_id: Uuid,
    pub state: MemberState,
    pub reason: MemberReason,
    pub quality_when_chosen: ApplicableQuality,
    /// The committed revision that first held this member; `None` only for a
    /// draft addition not saved yet.
    pub added_in_revision: Option<Revision>,
    pub copies: Vec<MemberCopy>,
}

/// An immutable committed revision with every choice, member and copy.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewRevision {
    #[serde(flatten)]
    pub header: ViewRevisionHeader,
    pub sessions: Vec<SessionChoice>,
    pub members: Vec<ViewMember>,
}

/// Which membership a read or scoped action uses: the draft, or the latest
/// committed revision.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Membership {
    Draft,
    Committed,
}

// ---------------------------------------------------------------------------
// Inputs and edits
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ViewOriginInput {
    /// A saved Project: its framing, panels and equipment become the criteria.
    Project { project_id: Uuid },
    /// A saved Target at the revision the user saw.
    Target { target_id: Uuid, expected_revision: Revision },
    /// Exactly these sessions, chosen as `origin_sessions`.
    Sessions { sessions: Vec<ExpectedSession> },
}

/// The member observations a criteria-based choice was computed from, as
/// `SuggestedAssociation` binds association evidence (R11).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessedMembers {
    /// Asset id → fingerprint of each current member asset.
    pub observations: BTreeMap<Uuid, ObservationFingerprint>,
    /// Asset id → decision revision.
    pub decisions: BTreeMap<Uuid, Revision>,
    /// Asset id → observation revision (recorded header evidence sequence).
    pub observation_revisions: BTreeMap<Uuid, Revision>,
}

/// A criteria-based session choice with the evidence and member basis it was
/// computed from; the catalog refuses it with Conflict when either changed.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedChoice {
    pub session: ExpectedSession,
    pub reason: SelectionReason,
    pub evidence: GeometryEvidence,
    pub assessed: AssessedMembers,
}

/// A View create: the origin, an optional name, criteria settings and the
/// preselected suggestions of a Project origin.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewView {
    pub origin: ViewOriginInput,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub criteria: CriteriaInput,
    /// For a Project origin: the Project revision the suggestions were
    /// computed against; a different current revision is Conflict.
    #[serde(default)]
    pub framing_revision: Option<Revision>,
    #[serde(default)]
    pub suggestions: Vec<SuggestedChoice>,
}

/// One edit of a View's unsaved work.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum DraftEdit {
    /// Name, Project association and criteria settings. Selects nothing.
    Details { name: String, project_id: Option<Uuid>, criteria: CriteriaInput },
    /// Choose these sessions as `manual`, with their members under D02.
    SelectSessions { sessions: Vec<ExpectedSession> },
    /// Choose these sessions as `select_matching` with the filters that matched them.
    SelectMatching { filters: Box<CandidateFilters>, sessions: Vec<ExpectedSession> },
    /// Remove these choices and their members; a criteria-based choice becomes
    /// a session exclusion.
    DeselectSessions { session_ids: Vec<Uuid> },
    /// Leave no selected session; criteria-based choices become exclusions.
    ClearSelection,
    /// Set these members included or excluded.
    SetFrames { member_keys: Vec<Uuid>, state: MemberState },
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/// A capture's applicable quality without its previous decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualityState {
    Unreviewed,
    Usable,
    Unusable,
    ChangedContent,
    VerificationPending,
    Conflicting,
    ConflictingCopies,
}

impl QualityState {
    #[must_use]
    pub const fn of(quality: &ApplicableQuality) -> Self {
        match quality {
            ApplicableQuality::Unreviewed => Self::Unreviewed,
            ApplicableQuality::Usable => Self::Usable,
            ApplicableQuality::Unusable => Self::Unusable,
            ApplicableQuality::ChangedContent { .. } => Self::ChangedContent,
            ApplicableQuality::VerificationPending { .. } => Self::VerificationPending,
            ApplicableQuality::Conflicting => Self::Conflicting,
            ApplicableQuality::ConflictingCopies => Self::ConflictingCopies,
        }
    }
}

/// Browsing filters. Absent fields do not filter; filters never change the
/// selection and are never saved.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CandidateFilters {
    /// Earliest capture date, an ISO date or date-time prefix compared as text.
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    /// Observing night, `YYYY-MM-DD`.
    pub night: Option<String>,
    /// Exact effective FILTER text.
    pub channels: Vec<String>,
    pub exposure_min: Option<f64>,
    pub exposure_max: Option<f64>,
    pub equipment_ids: Vec<Uuid>,
    /// Sessions with at least one capture in one of these states.
    pub quality_states: Vec<QualityState>,
    pub location_ids: Vec<Uuid>,
    pub availability: Vec<Availability>,
    /// Case-insensitive substring of a light frame's OBJECT.
    pub object_text: Option<String>,
    /// Sessions with a light frame that has no OBJECT.
    pub missing_object: bool,
    pub target_ids: Vec<Uuid>,
    pub cameras: Vec<String>,
    pub gain_min: Option<f64>,
    pub gain_max: Option<f64>,
    pub offset_min: Option<i64>,
    pub offset_max: Option<i64>,
    pub binning: Vec<u32>,
    /// Cooler setpoint range in °C.
    pub set_temperature_min: Option<f64>,
    pub set_temperature_max: Option<f64>,
}

fn require_range<T: PartialOrd + std::fmt::Display>(
    field: &str,
    min: Option<T>,
    max: Option<T>,
) -> Result<(), LibraryError> {
    if let (Some(min), Some(max)) = (min, max) {
        if min > max {
            return Err(invalid(format!("{field} range {min} to {max} is inverted")));
        }
    }
    Ok(())
}

fn require_finite(field: &str, value: Option<f64>) -> Result<(), LibraryError> {
    match value {
        Some(value) if !value.is_finite() => {
            Err(invalid(format!("{field} {value} must be a finite number")))
        }
        _ => Ok(()),
    }
}

impl CandidateFilters {
    /// # Errors
    /// `InvalidInput` naming the field for an inverted or non-finite range or a
    /// blank `objectText`.
    pub fn validate(&self) -> Result<(), LibraryError> {
        for (field, value) in [
            ("exposureMin", self.exposure_min),
            ("exposureMax", self.exposure_max),
            ("gainMin", self.gain_min),
            ("gainMax", self.gain_max),
            ("setTemperatureMin", self.set_temperature_min),
            ("setTemperatureMax", self.set_temperature_max),
        ] {
            require_finite(field, value)?;
        }
        require_range("exposure", self.exposure_min, self.exposure_max)?;
        require_range("gain", self.gain_min, self.gain_max)?;
        require_range("offset", self.offset_min, self.offset_max)?;
        require_range("setTemperature", self.set_temperature_min, self.set_temperature_max)?;
        require_range("date", self.date_from.as_deref(), self.date_to.as_deref())?;
        for (field, text) in [
            ("objectText", &self.object_text),
            ("dateFrom", &self.date_from),
            ("dateTo", &self.date_to),
            ("night", &self.night),
        ] {
            if text.as_deref().is_some_and(|text| text.trim().is_empty()) {
                return Err(invalid(format!("{field} is blank")));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CandidateSortKey {
    Date,
    Night,
    Channel,
    Exposure,
    Camera,
    Frames,
    Integration,
    Availability,
    SkyDistance,
    Overlap,
    /// Any key this contract version does not define; `validate` refuses it.
    #[serde(other)]
    Unsupported,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    #[default]
    Asc,
    Desc,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSort {
    pub key: CandidateSortKey,
    #[serde(default)]
    pub direction: SortDirection,
}

/// Largest candidate page.
pub const MAX_CANDIDATE_PAGE: u32 = 1000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateQuery {
    pub membership: Membership,
    #[serde(default)]
    pub filters: CandidateFilters,
    #[serde(default)]
    pub sort: Option<CandidateSort>,
    /// List only the selected sessions, whatever the filters.
    #[serde(default)]
    pub selected_only: bool,
    #[serde(default)]
    pub offset: u32,
    pub limit: u32,
}

impl CandidateQuery {
    /// # Errors
    /// `InvalidInput` for a limit of 0 or above [`MAX_CANDIDATE_PAGE`], an
    /// unsupported sort key, or invalid filters.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.limit == 0 || self.limit > MAX_CANDIDATE_PAGE {
            return Err(invalid(format!(
                "limit {} must be in 1..={MAX_CANDIDATE_PAGE}",
                self.limit
            )));
        }
        if self.sort.is_some_and(|sort| sort.key == CandidateSortKey::Unsupported) {
            return Err(invalid("sort key is not supported".into()));
        }
        self.filters.validate()
    }
}

/// Header evidence of one logical capture, projected from its effective
/// metadata for geometry and filtering. Geometry never reads `object`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameEvidence {
    /// The copy this evidence was read from.
    pub asset_id: Uuid,
    /// From the effective IMAGETYP; `None` when unknown.
    pub light: Option<bool>,
    pub object: Option<String>,
    pub filter: Option<String>,
    pub exposure_seconds: Option<f64>,
    pub camera: Option<String>,
    pub telescope: Option<String>,
    pub gain: Option<f64>,
    pub offset: Option<i64>,
    pub binning_x: Option<u32>,
    pub binning_y: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub set_temperature_c: Option<f64>,
    pub date_obs: Option<String>,
    pub date_local: Option<String>,
    pub ra_deg: Option<f64>,
    pub dec_deg: Option<f64>,
    pub wcs_ra_deg: Option<f64>,
    pub wcs_dec_deg: Option<f64>,
    /// Sky position angle east of north: the WCS rotation, else OBJCTROT.
    pub sky_rotation_deg: Option<f64>,
    pub focal_length_mm: Option<f64>,
    pub pixel_size_um: Option<f64>,
}

/// A recorded copy of a candidate capture with its live state.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureCopy {
    pub asset_id: Uuid,
    pub location_id: Uuid,
    pub availability: Availability,
    pub decision_revision: Revision,
    pub fingerprint: ObservationFingerprint,
}

/// One logical capture of a candidate session.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateCapture {
    /// The smallest copy asset id: the member key this capture would get.
    pub member_key: Uuid,
    pub copies: Vec<CaptureCopy>,
    pub quality: ApplicableQuality,
    pub frame: FrameEvidence,
}

/// One current light or unknown-image-type session from the candidate snapshot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSession {
    pub summary: SessionSummary,
    pub captures: Vec<CandidateCapture>,
    pub associations: Vec<Association>,
    /// The member observations this evidence describes.
    pub assessed: AssessedMembers,
}

impl CandidateSession {
    #[must_use]
    pub fn expected(&self) -> ExpectedSession {
        ExpectedSession {
            session_id: self.summary.session.id,
            grouping_revision: self.summary.session.grouping_revision,
            decision_revision: self.summary.session.decision_revision,
        }
    }
}

/// Everything candidate evaluation reads, from one catalog snapshot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateBasis {
    pub sessions: Vec<CandidateSession>,
    /// Every equipment record a candidate's association references.
    pub equipment: Vec<Equipment>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeometryClass {
    /// Every light frame has pointing, orientation and field of view.
    Footprint,
    /// Every light frame has pointing; some lack field of view or orientation.
    PointingOnly,
    /// A light frame lacks pointing.
    PositionUnknown,
}

/// Geometry a session lacks.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeometryUnknown {
    PointingUnknown,
    OrientationUnknown,
    FovUnknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum FovSource {
    Header,
    Equipment { equipment_id: Uuid },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FovField {
    FocalLengthMm,
    PixelSizeUm,
    BinningX,
    BinningY,
    Width,
    Height,
}

/// One field-of-view input with its source (R6).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FovInput {
    pub field: FovField,
    pub value: f64,
    #[serde(flatten)]
    pub source: FovSource,
}

/// A frame's field of view with every input that produced it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FovEvidence {
    pub width_deg: f64,
    pub height_deg: f64,
    pub inputs: Vec<FovInput>,
}

/// A sky position in ICRS degrees.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkyPoint {
    pub ra_deg: f64,
    pub dec_deg: f64,
}

/// A framing element: a Target's coordinates or a mosaic panel.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum FramingElement {
    Target { target_id: Uuid },
    Panel { panel_id: Uuid },
}

/// A rotated field rectangle on the sky, for linked sky coverage. Nothing is stitched.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FootprintEvidence {
    /// The frame the footprint belongs to; `None` for a framing panel.
    pub asset_id: Option<Uuid>,
    pub centre: SkyPoint,
    pub corners: Vec<SkyPoint>,
    pub position_angle_deg: f64,
}

/// Every light frame matches this framing element (R7).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramingMatch {
    pub element: FramingElement,
    /// For a panel: the lowest normalized coverage across frames.
    pub coverage: Option<f64>,
}

/// Geometry of one session against the criteria framing, computed on read.
/// Unknown values stay `None`; no distance or coverage reads 0.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryEvidence {
    pub class: GeometryClass,
    pub unknown: Vec<GeometryUnknown>,
    pub light_frames: u64,
    pub frames_with_pointing: u64,
    pub frames_without_pointing: u64,
    pub mean_pointing: Option<SkyPoint>,
    /// Separation of the mean pointing from the nearest framing centre.
    pub distance_deg: Option<f64>,
    pub nearest: Option<FramingElement>,
    /// Largest separation of a frame pointing from the mean pointing.
    pub pointing_spread_deg: Option<f64>,
    /// Field of view of the representative frame.
    pub fov: Option<FovEvidence>,
    /// The frame nearest the mean pointing.
    pub footprint: Option<FootprintEvidence>,
    pub matched: Option<FramingMatch>,
    /// Lowest per-frame coverage of the best panel, when any panel was compared.
    pub coverage: Option<f64>,
    /// Pointing-only and within `suggestionRadiusDeg` of a framing centre.
    pub within_radius: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionState {
    /// Footprint match with a Confirmed association to Project-snapshot equipment.
    Preselectable,
    /// Footprint match that does not qualify for preselection.
    Suggested,
    /// Pointing-only within the suggestion radius; never preselected.
    PointingOnly,
    None,
}

/// Captures of one quality state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCount {
    pub state: QualityState,
    pub count: u64,
}

/// One candidate session with evidence and its selection state.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateRow {
    pub session: SessionSummary,
    /// Earliest capture start (DATE-OBS, else DATE-LOC).
    pub date: Option<String>,
    pub night: Option<String>,
    pub channel: Option<String>,
    pub exposure_seconds: Option<f64>,
    pub camera: Option<String>,
    pub telescope: Option<String>,
    /// The equipment association with its state, if any.
    pub equipment: Option<Association>,
    /// Light frames: logical captures whose image type is light.
    pub frames: u64,
    pub captures: u64,
    pub unknown_image_type_count: u64,
    pub unknown_exposure_count: u64,
    pub integration: Microseconds,
    pub quality_counts: Vec<QualityCount>,
    pub geometry: GeometryEvidence,
    pub suggestion: SuggestionState,
    /// This session's choice in the chosen membership, if any.
    pub selection: Option<SessionChoice>,
    /// PIX (067) measurement summary; `None` reads Not measured.
    pub measurements: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidatePage {
    pub rows: Vec<CandidateRow>,
    pub match_count: u64,
    pub selected_count: u64,
    pub selected_outside_filters: u64,
}

// ---------------------------------------------------------------------------
// Membership basis and summaries
// ---------------------------------------------------------------------------

/// A member copy's live state.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyState {
    pub asset_id: Uuid,
    pub location_id: Uuid,
    pub location_name: String,
    pub path: NativePath,
    pub availability: Availability,
    /// The location's recorded access failure, if any.
    pub failure_reason: Option<String>,
    pub last_observed_at: String,
    /// The copy's current decision revision and fingerprint.
    pub current: ExpectedAsset,
}

/// A member with its live state. Unresolved and changed since review are
/// derived on read; neither changes the stored state.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberBasis {
    pub member: ViewMember,
    pub copies: Vec<CopyState>,
    /// The capture's current applicable quality.
    pub quality: ApplicableQuality,
    pub frame: FrameEvidence,
    /// Included and no copy is Available (R15).
    pub unresolved: bool,
    /// A copy's current fingerprint differs from its recorded basis (R16).
    pub changed_since_review: bool,
}

/// A session choice with the session as the library records it now.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceBasis {
    pub choice: SessionChoice,
    /// Current summary, with successors when superseded.
    pub current: SessionSummary,
}

/// A membership (draft or committed revision) with live member state, from one
/// catalog snapshot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipBasis {
    pub view_id: Uuid,
    pub membership: Membership,
    /// The committed revision, or the draft revision.
    pub revision: Revision,
    pub project_id: Option<Uuid>,
    pub criteria: ViewCriteria,
    pub sessions: Vec<ChoiceBasis>,
    pub members: Vec<MemberBasis>,
}

/// Captures excluded for one reason.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExclusionCount {
    pub reason: ExclusionReason,
    pub count: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExclusionReason {
    LibraryUnusable,
    QualityNeedsReview,
    ViewExclusion,
}

impl ExclusionReason {
    /// The summary reason of an excluded member.
    #[must_use]
    pub const fn of(reason: &MemberReason) -> Self {
        match reason {
            MemberReason::LibraryUnusable => Self::LibraryUnusable,
            MemberReason::QualityNeedsReview { .. } => Self::QualityNeedsReview,
            _ => Self::ViewExclusion,
        }
    }
}

/// Intended included frames and integration of one exact channel.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSummary {
    /// Exact effective FILTER text; `None` is the unknown-channel row.
    pub channel: Option<String>,
    pub included_frames: u64,
    pub included_seconds: Microseconds,
    pub unreviewed_frames: u64,
    pub usable_frames: u64,
    pub unknown_exposure_count: u64,
    pub unknown_image_type_count: u64,
    pub excluded: Vec<ExclusionCount>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnresolvedAction {
    Reconnect,
    Locate,
    Remove,
}

/// Included members of one session and location with no Available copy. The
/// last-observed values are never verified counts.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedSource {
    pub session_id: Uuid,
    pub location_id: Uuid,
    pub location_name: String,
    pub availability: Availability,
    pub failure_reason: Option<String>,
    pub member_keys: Vec<Uuid>,
    pub paths: Vec<NativePath>,
    pub last_observed_frames: u64,
    pub last_observed_seconds: Microseconds,
    pub verified: bool,
    pub actions: Vec<UnresolvedAction>,
}

/// The summary of one membership, computed on read (R19).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipSummary {
    pub channels: Vec<ChannelSummary>,
    pub unknown_channel: Option<ChannelSummary>,
    pub included_frames: u64,
    pub included_seconds: Microseconds,
    pub unresolved: Vec<UnresolvedSource>,
    /// Member keys whose copies changed since review; they leave the totals.
    pub changed_since_review: Vec<Uuid>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenChoiceKind {
    UnsavedDraft,
    StaleDraft,
    UnresolvedMembers,
    QualityNeedsReview,
    ChangedSinceReview,
    ProjectContextChanged,
    ProfileUnset,
}

/// A choice Review preparation gathers before handoff.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenChoice {
    pub kind: OpenChoiceKind,
    pub count: u64,
}

// ---------------------------------------------------------------------------
// Refresh and quality
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefreshItemKind {
    AddedSession,
    AddedCaptures,
    Removed,
    Regrouped,
    Unavailable,
    ManualInclusion,
    KeptExclusion,
}

impl RefreshItemKind {
    /// Whether accepting the item changes membership.
    #[must_use]
    pub const fn actionable(self) -> bool {
        matches!(self, Self::AddedSession | Self::AddedCaptures | Self::Removed | Self::Regrouped)
    }
}

/// One difference between the reviewed membership and the current library.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshItem {
    pub id: Uuid,
    pub kind: RefreshItemKind,
    pub session_id: Uuid,
    /// The session as reviewed, for added and regrouped items.
    pub session: Option<ExpectedSession>,
    /// Member observations of an added session or added captures.
    pub assessed: Option<AssessedMembers>,
    pub evidence: Option<GeometryEvidence>,
    /// The pinned reason of a manual inclusion, or the declined suggestion.
    pub reason: Option<SelectionReason>,
    /// Added capture keys, removed, unavailable or excluded members.
    pub member_keys: Vec<Uuid>,
    /// Current successors of a regrouped session.
    pub successors: Vec<ExpectedSession>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefreshState {
    Reviewed,
    Applied,
}

/// A durable refresh review against a committed revision (R24).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshReview {
    pub id: Uuid,
    pub view_id: Uuid,
    pub base_revision: Revision,
    pub criteria: ViewCriteria,
    pub items: Vec<RefreshItem>,
    pub state: RefreshState,
    pub created_at: String,
    pub applied_at: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QualityAction {
    MarkUsable,
    MarkUnusable,
    RejectForProject,
}

/// Whose decision a quality action writes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ScopeOwner {
    Library,
    Project { project_id: Uuid, name: String, revision: Revision },
}

/// Frames and integration of one channel within a quality scope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeChannel {
    pub channel: Option<String>,
    pub frames: u64,
    pub seconds: Microseconds,
}

/// The named scope of a quality action, shown before confirmation (R18).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityScope {
    pub action: QualityAction,
    pub owner: ScopeOwner,
    pub frames: u64,
    pub sessions: u64,
    pub channels: Vec<ScopeChannel>,
    /// Asked keys that are not members the action accepts.
    pub refused: Vec<Uuid>,
    /// Current expectations of every copy of the accepted members.
    pub expected: Vec<ExpectedAsset>,
}

/// A session choice of the detail with the session as recorded now.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    #[serde(flatten)]
    pub choice: SessionChoice,
    pub current: SessionSummary,
}

/// The View review surface's backend read.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewDetail {
    pub view: View,
    pub revision: Option<ViewRevisionHeader>,
    pub draft: Option<ViewDraftHeader>,
    /// PREP (069) handoff profile; `None` in version 1.
    pub profile: Option<serde_json::Value>,
    /// Session choices of the draft when one exists, else of the revision.
    pub sessions: Vec<SessionDetail>,
    pub revision_summary: Option<MembershipSummary>,
    pub draft_summary: Option<MembershipSummary>,
    /// Unresolved sources of the draft when one exists, else of the revision.
    pub unresolved: Vec<UnresolvedSource>,
    pub project_context_changed: bool,
    pub open_choices: Vec<OpenChoice>,
}
