// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Processing runs (spec 066, amended D-W1..D-W74). A run is a View: a Tier 1
//! catalog record inside one Project, on one subject and one rig, both fixed
//! at creation. It holds immutable committed membership revisions and at most
//! one durable draft. Membership is exact: chosen sessions with their reasons,
//! and logical captures (D16) with their recorded copies, each included or
//! excluded with a reason. The picker offers only the subject's candidates on
//! the run's rig. Candidate evidence, summaries and refresh differences are
//! computed on read and never stored as totals: unknown geometry stays
//! unknown, never zero.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ApplicableQuality, Asset, Availability, ExpectedAsset, ExpectedSession, LibraryError,
    Microseconds, NativePath, ObservationFingerprint, ProjectRejection, Quality, RejectionMark,
    Revision, SkyCoordinates,
};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/// A run's pipeline step (VSEL-FR-02, PRJ-FR-20). Clean up follows Complete.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStage {
    Select,
    Review,
    Calibrate,
    Prepare,
    Results,
    Done,
    CleanUp,
}

/// Whether a run is still open or marked Complete (RES-FR-06). A Complete run
/// accepts no membership change until it is reopened (VSEL-FR-17).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunCompletion {
    Open,
    Complete,
}

/// Calibration assignment policy of a run (D-W55): automatic assignment on by
/// default, or manual.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationPolicy {
    #[default]
    Automatic,
    Manual,
}

/// The run header. Its Project, subject, rig, run group and panel never
/// change after creation; `revision` is the latest committed membership
/// revision, 0 until the first Save.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: Uuid,
    pub project_id: Uuid,
    pub subject_id: Uuid,
    /// The rig (saved equipment) every raw session of the run comes from.
    pub rig_id: Uuid,
    /// The mosaic run group a panel run belongs to.
    pub group_id: Option<Uuid>,
    /// The mosaic panel a panel run covers.
    pub panel_id: Option<Uuid>,
    pub stage: RunStage,
    pub completion: RunCompletion,
    /// The stage a Complete run returns to on Reopen.
    pub stage_before_complete: Option<RunStage>,
    /// When the run was moved to the Project's Trash; `None` while it is not.
    pub trashed_at: Option<String>,
    /// The PREP handoff profile, once chosen.
    pub profile_id: Option<Uuid>,
    pub calibration_policy: CalibrationPolicy,
    pub revision: Revision,
    pub created_at: String,
    pub updated_at: String,
}

/// The candidate rule a membership revision was saved under: the subject's
/// Target on the run's rig, and the panel of a panel run.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewCriteria {
    pub target_id: Uuid,
    pub rig_id: Uuid,
    pub panel_id: Option<Uuid>,
}

/// A committed membership revision's header. Committed rows never change.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewRevisionHeader {
    pub view_id: Uuid,
    pub revision: Revision,
    pub name: String,
    pub criteria: ViewCriteria,
    /// The committed revision the draft started from: 0 for the first revision.
    pub based_on: Revision,
    pub refresh_review_id: Option<Uuid>,
    pub committed_at: String,
}

/// Recoverable unsaved work. A draft whose base differs from the latest
/// committed revision is `stale`: Save refuses it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewDraftHeader {
    pub view_id: Uuid,
    pub draft_revision: Revision,
    pub base_revision: Revision,
    pub name: String,
    pub criteria: ViewCriteria,
    pub refresh_review_id: Option<Uuid>,
    pub updated_at: String,
    pub stale: bool,
}

/// A run with its latest committed revision and its draft, read separately.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewRecord {
    pub view: View,
    pub revision: Option<ViewRevisionHeader>,
    pub draft: Option<ViewDraftHeader>,
}

/// A run for lists: no summary totals are computed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewListing {
    pub id: Uuid,
    pub name: String,
    pub project_id: Uuid,
    pub subject_id: Uuid,
    pub rig_id: Uuid,
    pub group_id: Option<Uuid>,
    pub panel_id: Option<Uuid>,
    pub stage: RunStage,
    pub completion: RunCompletion,
    pub revision: Revision,
    pub committed_at: Option<String>,
    pub has_draft: bool,
    pub draft_stale: bool,
}

/// Runs outside the Project's Trash, by name.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewQuery {
    /// Only the runs of this Project.
    #[serde(default)]
    pub project_id: Option<Uuid>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default)]
    pub limit: u32,
}

/// A Project member (VSEL-FR-16, PRJ-FR-08): a session selected in the latest
/// committed revision of at least one of the Project's runs outside the Trash.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMember {
    pub session_id: Uuid,
    /// The runs holding the session, by id.
    pub view_ids: Vec<Uuid>,
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

/// Why a session is chosen.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SelectionReason {
    /// A candidate the run started with (D-W49): its confirmed Target is the
    /// subject's Target and its confirmed rig is the run's rig. Never an
    /// OBJECT-only match.
    Candidate {
        target_id: Uuid,
        rig_id: Uuid,
    },
    /// A candidate added by accepting a refresh review.
    RefreshMatch {
        review_id: Uuid,
    },
    /// A panel run's session whose pointing lies in the run's panel and in no
    /// other (VSEL-FR-18): `separation_deg` of its mean pointing from the
    /// panel centre names the evidence the group's panel decision records.
    PanelPointing {
        target_id: Uuid,
        rig_id: Uuid,
        panel_id: Uuid,
        separation_deg: f64,
    },
    Manual,
    SelectMatching {
        filters: Box<CandidateFilters>,
    },
}

impl SelectionReason {
    /// Manual and select-matching choices are manual inclusions: a refresh
    /// never deselects them unless the user accepts the removal (D09).
    #[must_use]
    pub const fn is_pinned(&self) -> bool {
        matches!(self, Self::Manual | Self::SelectMatching { .. })
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
    /// The geometry evidence a refresh addition was reviewed with.
    pub evidence: Option<GeometryEvidence>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberState {
    Included,
    Excluded,
}

/// Whose rejection removed a member from the draft (D-W42, D-W54).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectScope {
    /// Marked Unusable in the library (X).
    Library,
    /// Rejected for this Project only.
    Project,
}

/// Why a member is included or excluded. The starting reason comes from the
/// capture's applicable quality when chosen (D02); later edits set the others.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum MemberReason {
    Initial,
    LibraryUnusable,
    QualityNeedsReview {
        quality: ApplicableQuality,
    },
    ViewExclusion,
    ExplicitInclusion,
    Restored,
    RefreshAdded {
        review_id: Uuid,
    },
    /// Rejected in the run's Review step; un-rejecting restores the member.
    Rejected {
        scope: RejectScope,
    },
}

/// The D02 starting state of a logical capture entering a draft.
#[must_use]
pub const fn initial_member_state(quality: &ApplicableQuality) -> (MemberState, MemberReason) {
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
    /// The committed revision that first held this member: `None` only for a
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

/// The member observations a refresh addition was computed from, as
/// `SuggestedAssociation` binds association evidence (R11).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessedMembers {
    /// Asset id -> fingerprint of each current member asset.
    pub observations: std::collections::BTreeMap<Uuid, ObservationFingerprint>,
    /// Asset id -> decision revision.
    pub decisions: std::collections::BTreeMap<Uuid, Revision>,
    /// Asset id -> observation revision (recorded header evidence sequence).
    pub observation_revisions: std::collections::BTreeMap<Uuid, Revision>,
}

/// Start a single run on one subject and one of the Project's rigs (VSEL-FR-01).
/// It starts with every available candidate of the subject on the rig selected.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewView {
    pub project_id: Uuid,
    /// The Project subject: the Target, never a mosaic (a mosaic takes a run group).
    pub subject_id: Uuid,
    pub rig_id: Uuid,
    pub name: String,
}

impl NewView {
    /// # Errors
    /// `InvalidInput` for a blank name.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.name.trim().is_empty() {
            return Err(invalid("run name is blank".into()));
        }
        Ok(())
    }
}

/// One edit of a run's unsaved work.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum DraftEdit {
    /// Rename the run. Selects nothing.
    Details { name: String },
    /// Choose these candidates as `manual`, with their members under D02.
    SelectSessions { sessions: Vec<ExpectedSession> },
    /// Choose these candidates as `select_matching` with the filters that matched them.
    SelectMatching { filters: Box<CandidateFilters>, sessions: Vec<ExpectedSession> },
    /// Remove these choices and their members; a criteria-based choice becomes
    /// a session exclusion.
    DeselectSessions { session_ids: Vec<Uuid> },
    /// Leave no selected session; criteria-based choices become exclusions.
    ClearSelection,
    /// Set these members included or excluded.
    SetFrames { member_keys: Vec<Uuid>, state: MemberState },
}

/// One mark of a run's Review step (D-W54, PIX-FR-14). Each mark writes its
/// decision and the draft member of the marked frame in one transaction.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ReviewMark {
    /// P, X or U: the frame copy's library quality decision.
    Library { asset: ExpectedAsset, quality: Quality },
    /// Reject for this Project only, or its withdrawal (`rejected` false).
    Project { mark: RejectionMark },
}

/// The decision a review mark wrote.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ReviewDecision {
    Library { asset: Box<Asset> },
    Project { rejection: ProjectRejection },
}

/// A review mark's outcome: the decision and the draft member it moved.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewMarkOutcome {
    pub record: ViewRecord,
    pub decision: ReviewDecision,
    pub member: ViewMember,
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

/// Browsing filters over the run's candidates. Absent fields do not filter;
/// filters never change the selection and are never saved. The run's rig fixes
/// the camera and optical train, so there is no equipment or camera filter.
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
    /// Sessions with at least one capture in one of these states.
    pub quality_states: Vec<QualityState>,
    pub location_ids: Vec<Uuid>,
    pub availability: Vec<Availability>,
    /// Case-insensitive substring of a light frame's OBJECT.
    pub object_text: Option<String>,
    /// Sessions with a light frame that has no OBJECT.
    pub missing_object: bool,
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
    Frames,
    Integration,
    Availability,
    SkyDistance,
    /// Footprints holding the subject's Target first.
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
    /// Without a sort, candidates come in geometry order: framed first, then
    /// by angular separation, unknown geometry last.
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

/// The subject's Target a run's candidates are ordered against.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramingTarget {
    pub target_id: Uuid,
    pub designation: String,
    /// `None` stays unknown: no candidate gets a distance.
    pub coordinates: Option<SkyCoordinates>,
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

/// A rotated field rectangle on the sky, for linked sky coverage. Nothing is
/// stitched.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FootprintEvidence {
    /// The frame the footprint belongs to.
    pub asset_id: Uuid,
    pub centre: SkyPoint,
    pub corners: Vec<SkyPoint>,
    pub position_angle_deg: f64,
}

/// Geometry of one candidate session against the subject's Target, computed on
/// read. Unknown values stay `None`: no distance reads 0.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryEvidence {
    pub class: GeometryClass,
    pub unknown: Vec<GeometryUnknown>,
    pub light_frames: u64,
    pub frames_with_pointing: u64,
    pub frames_without_pointing: u64,
    pub mean_pointing: Option<SkyPoint>,
    /// Separation of the mean pointing from the subject's Target.
    pub distance_deg: Option<f64>,
    /// Largest separation of a frame pointing from the mean pointing.
    pub pointing_spread_deg: Option<f64>,
    /// Field of view of the representative frame.
    pub fov: Option<FovEvidence>,
    /// The frame nearest the mean pointing.
    pub footprint: Option<FootprintEvidence>,
    /// Whether every footprint holds the subject's Target; `None` without
    /// footprints or Target coordinates.
    pub framed: Option<bool>,
}

/// Captures of one quality state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCount {
    pub state: QualityState,
    pub count: u64,
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
/// derived on read: neither changes the stored state.
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

/// Captures excluded for one reason.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
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
    Rejected,
}

impl ExclusionReason {
    /// The summary reason of an excluded member.
    #[must_use]
    pub const fn of(reason: &MemberReason) -> Self {
        match reason {
            MemberReason::LibraryUnusable => Self::LibraryUnusable,
            MemberReason::QualityNeedsReview { .. } => Self::QualityNeedsReview,
            MemberReason::Rejected { .. } => Self::Rejected,
            _ => Self::ViewExclusion,
        }
    }
}

/// Intended included frames and integration of one exact channel.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSummary {
    /// Exact effective FILTER text: `None` is the unknown-channel row.
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

/// Included members of one session, location and availability with no
/// Available copy. A member with copies at several locations is named under
/// each; its last-observed values count once, and they are never verified
/// counts.
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
    /// A candidate of the run's subject on its rig that no revision chose.
    AddedSession,
    /// Captures that joined a selected session.
    AddedCaptures,
    /// A selected session that is no longer a candidate: its Target was
    /// re-confirmed or its rig changed. It stays a member until the user
    /// accepts its removal (D-W45).
    NoLongerMatchesSubject,
    Regrouped,
    Unavailable,
    KeptExclusion,
}

impl RefreshItemKind {
    /// Whether accepting the item changes membership.
    #[must_use]
    pub const fn actionable(self) -> bool {
        matches!(
            self,
            Self::AddedSession
                | Self::AddedCaptures
                | Self::NoLongerMatchesSubject
                | Self::Regrouped
        )
    }
}

/// One difference between the reviewed membership and the current library.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshItem {
    pub id: Uuid,
    pub kind: RefreshItemKind,
    pub session_id: Uuid,
    /// The session as reviewed, for added, regrouped and no-longer-matching items.
    pub session: Option<ExpectedSession>,
    /// Member observations of an added session or added captures.
    pub assessed: Option<AssessedMembers>,
    pub evidence: Option<GeometryEvidence>,
    /// The choice's reason, for a kept exclusion or a session no longer matching.
    pub reason: Option<SelectionReason>,
    /// Added capture keys, unavailable or excluded members.
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
    Project { project_id: Uuid, name: String },
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
    /// For Reject for this Project only: one mark per accepted copy at its
    /// current Project-only decision revision.
    pub marks: Vec<RejectionMark>,
}
