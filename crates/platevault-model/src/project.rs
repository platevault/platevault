// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Optional Projects and their capture checklist (spec 065).
//!
//! A Project is a Tier 1 catalog record: confirmed Target framing, optional mosaic
//! panels, the equipment chosen for session preselection, an ordered checklist,
//! explicit session links and Project-scoped rejections. It has no capture site and
//! no lifecycle state. Progress is computed on read from library records and is
//! never stored; evaluating it changes no Project field.

use std::collections::BTreeSet;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use crate::{
    Association, Availability, ExpectedSession, LibraryError, ObservationFingerprint, Provenance,
    Revision, SessionSummary, SkyCoordinates,
};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

/// Exposure in whole microseconds. Each frame is rounded once and totals are
/// integer sums, so whether a goal is met never depends on floating-point
/// summation. The wire carries seconds.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct Microseconds(pub u64);

impl Microseconds {
    pub const PER_SECOND: u64 = 1_000_000;

    /// One frame's exposure rounded to whole microseconds; `None` unless it is a
    /// finite, non-negative duration. Durations beyond `u64` microseconds saturate.
    #[must_use]
    pub fn from_seconds(seconds: f64) -> Option<Self> {
        if !seconds.is_finite() || seconds < 0.0 {
            return None;
        }
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "finite, non-negative and rounded; the float-to-int cast saturates"
        )]
        let micros = (seconds * 1e6).round() as u64;
        Some(Self(micros))
    }

    /// A whole-second goal; `None` when it exceeds `u64` microseconds.
    #[must_use]
    pub const fn from_whole_seconds(seconds: u64) -> Option<Self> {
        match seconds.checked_mul(Self::PER_SECOND) {
            Some(micros) => Some(Self(micros)),
            None => None,
        }
    }

    /// Seconds for display; comparisons use the integer microseconds.
    #[must_use]
    pub fn seconds(self) -> f64 {
        #[expect(clippy::cast_precision_loss, reason = "display only; totals compare as integers")]
        let micros = self.0 as f64;
        micros / 1e6
    }

    #[must_use]
    pub const fn saturating_add(self, other: Self) -> Self {
        Self(self.0.saturating_add(other.0))
    }
}

impl Serialize for Microseconds {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_f64(self.seconds())
    }
}

impl<'de> Deserialize<'de> for Microseconds {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let seconds = f64::deserialize(deserializer)?;
        Self::from_seconds(seconds).ok_or_else(|| {
            serde::de::Error::custom(format!("{seconds} is not a non-negative number of seconds"))
        })
    }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/// A saved Target the user confirms as framing, at the revision they saw.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetFraming {
    pub target_id: Uuid,
    pub expected_revision: Revision,
}

/// An explicit mosaic panel: an ICRS center and extent. A missing `id` creates a
/// panel; an existing `id` keeps its identity and links. A missing orientation is
/// unknown, never zero.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelInput {
    #[serde(default)]
    pub id: Option<Uuid>,
    pub name: String,
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub width_deg: f64,
    pub height_deg: f64,
    #[serde(default)]
    pub position_angle_deg: Option<f64>,
}

fn require_angle(
    panel: &str,
    field: &str,
    value: f64,
    valid: bool,
    range: &str,
) -> Result<(), LibraryError> {
    if value.is_finite() && valid {
        Ok(())
    } else {
        Err(invalid(format!("panel {panel:?}: {field} {value} must be a finite angle in {range}")))
    }
}

impl PanelInput {
    /// Validate the panel's name and ICRS geometry: `raDeg` in [0, 360), `decDeg`
    /// in [-90, 90], `widthDeg` and `heightDeg` in (0, 180] and an optional
    /// `positionAngleDeg` in [0, 360).
    ///
    /// # Errors
    /// `InvalidInput` naming the field for a blank name or a non-finite or
    /// out-of-range angle.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let name = self.name.trim();
        if name.is_empty() {
            return Err(invalid("panel name is empty".into()));
        }
        let (ra, dec, width, height) = (self.ra_deg, self.dec_deg, self.width_deg, self.height_deg);
        require_angle(name, "raDeg", ra, (0.0..360.0).contains(&ra), "[0, 360)")?;
        require_angle(name, "decDeg", dec, (-90.0..=90.0).contains(&dec), "[-90, 90]")?;
        require_angle(name, "widthDeg", width, width > 0.0 && width <= 180.0, "(0, 180]")?;
        require_angle(name, "heightDeg", height, height > 0.0 && height <= 180.0, "(0, 180]")?;
        if let Some(angle) = self.position_angle_deg {
            let valid = (0.0..360.0).contains(&angle);
            require_angle(name, "positionAngleDeg", angle, valid, "[0, 360)")?;
        }
        Ok(())
    }
}

/// Fields of a Project create or update. `targets` lists the prefilled Target
/// first; framing always holds at least one Target or panel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub name: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub targets: Vec<TargetFraming>,
    #[serde(default)]
    pub panels: Vec<PanelInput>,
    #[serde(default)]
    pub equipment_ids: Vec<Uuid>,
}

impl ProjectInput {
    /// Validate everything that needs no catalog read.
    ///
    /// # Errors
    /// `InvalidInput` naming the field for a blank name, empty framing, a Target,
    /// panel name, panel id or equipment id given twice, or an invalid panel.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.name.trim().is_empty() {
            return Err(invalid("project name is empty".into()));
        }
        if self.targets.is_empty() && self.panels.is_empty() {
            return Err(invalid(
                "project framing needs at least one entry in targets or panels".into(),
            ));
        }
        let mut targets = BTreeSet::new();
        if let Some(twice) = self.targets.iter().find(|item| !targets.insert(item.target_id)) {
            return Err(invalid(format!("targets frame Target {} twice", twice.target_id)));
        }
        let mut names = BTreeSet::new();
        let mut ids = BTreeSet::new();
        for panel in &self.panels {
            panel.validate()?;
            if !names.insert(panel.name.trim()) {
                return Err(invalid(format!("panels use the name {:?} twice", panel.name.trim())));
            }
            if let Some(id) = panel.id.filter(|id| !ids.insert(*id)) {
                return Err(invalid(format!("panels name panel {id} twice")));
            }
        }
        let mut equipment = BTreeSet::new();
        if let Some(twice) = self.equipment_ids.iter().find(|id| !equipment.insert(**id)) {
            return Err(invalid(format!("equipmentIds name equipment {twice} twice")));
        }
        Ok(())
    }
}

/// Calibration frame kinds a missing-calibration item can name.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationKind {
    Dark,
    Flat,
    Bias,
    DarkFlat,
}

/// A checklist item's kind and criterion. Channels match the effective FILTER
/// text exactly; goals are whole seconds or whole logical light frames.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ChecklistKind {
    /// Met when Project-accepted integration of `channel` reaches the goal.
    Integration { channel: String, goal_seconds: u64 },
    /// Met when Project-accepted logical light frames of `channel` reach the goal.
    FrameCount { channel: String, goal_frames: u64 },
    /// Evidence only: each linked session's effective exposure against this value.
    ExposurePreference {
        exposure_seconds: f64,
        #[serde(default)]
        channel: Option<String>,
    },
    /// Evidence only: the linked sessions assigned to each Project panel.
    PanelCoverage,
    /// Evidence only: each linked session's equipment association.
    Equipment { equipment_id: Uuid },
    /// Evidence only: unknown until calibration matching (068) exists.
    MissingCalibration {
        calibration: CalibrationKind,
        #[serde(default)]
        channel: Option<String>,
    },
}

fn require_channel(kind: &str, channel: &str) -> Result<(), LibraryError> {
    if channel.trim().is_empty() {
        return Err(invalid(format!("{kind} channel is blank")));
    }
    Ok(())
}

/// A checklist item to set; items without `id` get one, and omitted items are removed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItemInput {
    #[serde(default)]
    pub id: Option<Uuid>,
    #[serde(flatten)]
    pub criterion: ChecklistKind,
}

impl ChecklistItemInput {
    /// Validate the criterion against the Project's current `panels`.
    ///
    /// # Errors
    /// `InvalidInput` naming the field for a zero or unrepresentable goal, an
    /// exposure that is not a finite duration above zero, a blank channel, or panel
    /// coverage on a Project without panels.
    pub fn validate(&self, panels: &[ProjectPanel]) -> Result<(), LibraryError> {
        match &self.criterion {
            ChecklistKind::Integration { channel, goal_seconds } => {
                require_channel("integration", channel)?;
                if *goal_seconds == 0 {
                    return Err(invalid("integration goalSeconds must be at least 1".into()));
                }
                if Microseconds::from_whole_seconds(*goal_seconds).is_none() {
                    return Err(invalid(format!(
                        "integration goalSeconds {goal_seconds} is too large"
                    )));
                }
            }
            ChecklistKind::FrameCount { channel, goal_frames } => {
                require_channel("frame_count", channel)?;
                if *goal_frames == 0 {
                    return Err(invalid("frame_count goalFrames must be at least 1".into()));
                }
            }
            ChecklistKind::ExposurePreference { exposure_seconds, channel } => {
                if Microseconds::from_seconds(*exposure_seconds).is_none_or(|micros| micros.0 == 0)
                {
                    return Err(invalid(format!(
                        "exposure_preference exposureSeconds {exposure_seconds} must be a finite \
                         duration above 0"
                    )));
                }
                if let Some(channel) = channel {
                    require_channel("exposure_preference", channel)?;
                }
            }
            ChecklistKind::PanelCoverage => {
                if panels.is_empty() {
                    return Err(invalid("panel_coverage needs a Project with panels".into()));
                }
            }
            ChecklistKind::Equipment { .. } => {}
            ChecklistKind::MissingCalibration { channel, .. } => {
                if let Some(channel) = channel {
                    require_channel("missing_calibration", channel)?;
                }
            }
        }
        Ok(())
    }
}

/// Link one session through the exact session record the user saw, optionally
/// assigned to a Project panel. Linking a linked session reassigns its panel.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLinkInput {
    pub session: ExpectedSession,
    #[serde(default)]
    pub panel_id: Option<Uuid>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectQuery {
    /// Only the Projects framing this Target.
    #[serde(default)]
    pub target_id: Option<Uuid>,
    pub offset: u32,
    pub limit: u32,
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/// A confirmed framing Target: the snapshot taken at `confirmedRevision`. Reads
/// add the Target's current revision; `framingChanged` means the Target changed
/// after confirmation and the snapshot stands until the user confirms again.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTarget {
    pub target_id: Uuid,
    pub confirmed_revision: Revision,
    pub designation: String,
    pub coordinates: Option<SkyCoordinates>,
    pub provenance: Provenance,
    pub current_revision: Revision,
    pub framing_changed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPanel {
    pub id: Uuid,
    pub name: String,
    pub ra_deg: f64,
    pub dec_deg: f64,
    pub width_deg: f64,
    pub height_deg: f64,
    pub position_angle_deg: Option<f64>,
}

/// A stored checklist item; its id stays across edits, its position is its order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: Uuid,
    #[serde(flatten)]
    pub criterion: ChecklistKind,
}

/// Current while the linked session is current. A correction that supersedes it
/// makes the link `NeedsReview`: it stays recorded, contributes no progress and is
/// resolved only by an explicit link or unlink.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkState {
    Current,
    NeedsReview,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionLink {
    pub session_id: Uuid,
    pub panel_id: Option<Uuid>,
    /// The session's grouping revision when it was linked.
    pub grouping_revision: Revision,
    pub linked_at: String,
    pub state: LinkState,
    /// Lineage successors of a superseded session.
    pub successors: Vec<Uuid>,
}

/// The latest Project rejection decision of one asset. Decisions are append-only;
/// a withdrawal is a later decision with `rejected` false.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRejection {
    pub asset_id: Uuid,
    pub rejected: bool,
    /// The asset's observation when decided, kept as history.
    pub fingerprint: ObservationFingerprint,
    /// The Project revision this decision wrote.
    pub project_revision: Revision,
    pub decided_at: String,
}

/// A Project as committed. It has no capture-site field and no lifecycle state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub notes: Option<String>,
    pub revision: Revision,
    pub created_at: String,
    pub updated_at: String,
    pub targets: Vec<ProjectTarget>,
    pub panels: Vec<ProjectPanel>,
    /// Ordered, unique saved equipment that View selection preselects.
    pub equipment_ids: Vec<Uuid>,
    pub checklist: Vec<ChecklistItem>,
    pub links: Vec<ProjectSessionLink>,
    /// The latest decision per asset, ordered by asset id.
    pub rejections: Vec<ProjectRejection>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub revision: Revision,
    pub target_designations: Vec<String>,
    pub panel_count: u64,
    pub linked_session_count: u64,
    pub checklist_item_count: u64,
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/// Captured light frames of one channel at one availability: offline captures
/// keep their last-observed contribution, labelled.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityShare {
    pub availability: Availability,
    pub captured_seconds: Microseconds,
    pub captured_frames: u64,
}

/// Progress of one exact channel over the current members of Current links, each
/// logical capture once. Captured counts every light capture; usable those whose
/// applicable quality is Usable as of the last completed verification; accepted
/// the usable ones with no effective Project rejection on any copy.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelProgress {
    /// Exact effective FILTER text; `None` is the unknown-channel row, which no
    /// goal reads.
    pub channel: Option<String>,
    pub captured_seconds: Microseconds,
    pub captured_frames: u64,
    pub usable_seconds: Microseconds,
    pub usable_frames: u64,
    pub accepted_seconds: Microseconds,
    pub accepted_frames: u64,
    pub unreviewed_seconds: Microseconds,
    /// Light captures with an effective rejection for this Project.
    pub rejected_frames: u64,
    /// Light captures without a known exposure: counted, never added as zero.
    pub unknown_exposure_count: u64,
    /// Captures of unknown image type, outside every other count.
    pub unknown_image_type_count: u64,
    pub drifted_decisions: u64,
    pub verification_pending: u64,
    pub conflicting_decisions: u64,
    pub conflicting_copies: u64,
    pub duplicate_candidates: u64,
    /// Oldest last completed verification behind the usable totals (D19).
    pub usable_last_verified_at: Option<String>,
    /// Oldest last completed verification behind the accepted totals (D19).
    pub accepted_last_verified_at: Option<String>,
    pub availability: Vec<AvailabilityShare>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProgress {
    /// Known channels in text order.
    pub channels: Vec<ChannelProgress>,
    /// Captures without a FILTER, when there are any.
    pub unknown_channel: Option<ChannelProgress>,
    /// A covered location's latest scan is unfinished, a decided capture awaits
    /// its rehash, or a duplicate candidate is unhashed.
    pub provisional: bool,
    pub covered_location_ids: Vec<Uuid>,
}

/// Distinct observed site coordinates of a linked session, with logical captures.
/// No clustering tolerance applies.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSite {
    pub latitude_deg: f64,
    pub longitude_deg: f64,
    pub frames: u64,
}

/// One effective channel and exposure of a linked session's logical captures.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExposure {
    pub channel: Option<String>,
    /// `None` when the exposure is unknown.
    pub exposure_seconds: Option<Microseconds>,
    pub frames: u64,
}

/// A linked session as the library records it; the Project stores none of these
/// values.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedSessionEvidence {
    pub session_id: Uuid,
    pub panel_id: Option<Uuid>,
    pub state: LinkState,
    pub successors: Vec<Uuid>,
    pub summary: SessionSummary,
    pub capture_sites: Vec<CaptureSite>,
    pub unknown_site_frames: u64,
    pub exposures: Vec<SessionExposure>,
    /// The session's equipment association with its state and provenance.
    pub equipment: Option<Association>,
}

/// An effective rejection: the asset, the linked session holding it, if any, and
/// the decision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveRejection {
    pub asset_id: Uuid,
    pub session_id: Option<Uuid>,
    pub decided_at: String,
    pub project_revision: Revision,
}

/// Everything checklist evaluation reads, from one catalog snapshot of the
/// Project at `project_revision`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProgressBasis {
    pub project_id: Uuid,
    pub project_revision: Revision,
    pub progress: ProjectProgress,
    /// Every link in Project order, Current and `NeedsReview`.
    pub sessions: Vec<LinkedSessionEvidence>,
    pub rejections: Vec<EffectiveRejection>,
}

/// What a checklist item's progress is measured on.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChecklistBasis {
    AcceptedIntegration,
    AcceptedFrames,
    SessionExposure,
    PanelAssignment,
    SessionEquipment,
    CalibrationMatching,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceState {
    Matches,
    SuggestedMatch,
    Differs,
    Unknown,
    NoLinkedSession,
}

/// Evidence for one linked session or one panel, with a reason code.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistEvidence {
    pub session_id: Option<Uuid>,
    pub panel_id: Option<Uuid>,
    /// The linked sessions assigned to a panel.
    pub session_ids: Vec<Uuid>,
    pub state: EvidenceState,
    pub reason: String,
}

/// Goal progress of integration and frame-count items, or evidence of the other
/// kinds. `met` compares accepted integers with the goal.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "progress", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ChecklistOutcome {
    Seconds {
        captured: Microseconds,
        usable: Microseconds,
        accepted: Microseconds,
        goal: Microseconds,
        met: bool,
    },
    Frames {
        captured: u64,
        usable: u64,
        accepted: u64,
        goal: u64,
        met: bool,
    },
    Evidence {
        evidence: Vec<ChecklistEvidence>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistProgress {
    pub item: ChecklistItem,
    pub basis: ChecklistBasis,
    #[serde(flatten)]
    pub outcome: ChecklistOutcome,
}

/// A Project with its linked sessions, progress, checklist and effective
/// rejections, read without changing anything.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: Project,
    pub links: Vec<LinkedSessionEvidence>,
    pub progress: ProjectProgress,
    pub checklist: Vec<ChecklistProgress>,
    pub rejections: Vec<EffectiveRejection>,
}
