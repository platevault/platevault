// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Projects (spec 065, amended D-W1..D-W74): the required container for
//! processing runs.
//!
//! A Project names its subjects (Targets, or mosaics of a Target with panels by
//! centre and rotation), the rigs taking part and goals per subject and channel,
//! or per panel of a mosaic subject. It has an open or Done state and no capture
//! site. Its candidate sessions are derived on read from confirmed Target and
//! confirmed rig and are never stored. Writing a Project changes no file, no
//! library quality decision and no session record. A Project-only reject is a
//! separate decision per asset that never changes library quality.

use std::collections::BTreeSet;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use crate::{LibraryError, ObservationFingerprint, Revision};

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

/// One mosaic panel by its ICRS centre and rotation. `number` is the panel's
/// "Panel N" and keeps its identity across edits. A missing rotation is
/// unknown, never zero.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelInput {
    pub number: u32,
    pub ra_deg: f64,
    pub dec_deg: f64,
    #[serde(default)]
    pub rotation_deg: Option<f64>,
}

fn require_angle(
    number: u32,
    field: &str,
    value: f64,
    valid: bool,
    range: &str,
) -> Result<(), LibraryError> {
    if value.is_finite() && valid {
        Ok(())
    } else {
        Err(invalid(format!("panel {number}: {field} {value} must be a finite angle in {range}")))
    }
}

impl PanelInput {
    /// Validate the panel: `number` at least 1, `raDeg` in [0, 360), `decDeg` in
    /// [-90, 90] and an optional `rotationDeg` in [0, 360).
    ///
    /// # Errors
    /// `InvalidInput` naming the panel and field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let number = self.number;
        if number == 0 {
            return Err(invalid("panel numbers start at 1".into()));
        }
        let (ra, dec) = (self.ra_deg, self.dec_deg);
        require_angle(number, "raDeg", ra, (0.0..360.0).contains(&ra), "[0, 360)")?;
        require_angle(number, "decDeg", dec, (-90.0..=90.0).contains(&dec), "[-90, 90]")?;
        if let Some(rotation) = self.rotation_deg {
            let valid = (0.0..360.0).contains(&rotation);
            require_angle(number, "rotationDeg", rotation, valid, "[0, 360)")?;
        }
        Ok(())
    }
}

/// A subject: a saved Target, or a mosaic of that Target with its panels. The
/// Target identifies the subject within its Project across edits. `name` is an
/// optional label; the Target's designation is always shown beside it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectInput {
    pub target_id: Uuid,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub mosaic: bool,
    #[serde(default)]
    pub panels: Vec<PanelInput>,
}

impl SubjectInput {
    /// The label as given; blank labels are refused by [`Self::validate`].
    #[must_use]
    pub fn label(&self) -> Option<&str> {
        self.name.as_deref().map(str::trim)
    }

    /// Validate the label and panels: a mosaic has at least one panel, each
    /// number once; a single-Target subject has none.
    ///
    /// # Errors
    /// `InvalidInput` naming the Target and the reason.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let target = self.target_id;
        if self.label().is_some_and(str::is_empty) {
            return Err(invalid(format!("subject {target}: name is blank")));
        }
        if !self.mosaic && !self.panels.is_empty() {
            return Err(invalid(format!("subject {target} is not a mosaic and has no panels")));
        }
        if self.mosaic && self.panels.is_empty() {
            return Err(invalid(format!("mosaic subject {target} needs at least one panel")));
        }
        let mut numbers = BTreeSet::new();
        for panel in &self.panels {
            panel.validate()?;
            if !numbers.insert(panel.number) {
                return Err(invalid(format!(
                    "subject {target} lists panel {} twice",
                    panel.number
                )));
            }
        }
        Ok(())
    }
}

/// Validate a full subject list: at least one subject, each Target once.
///
/// # Errors
/// `InvalidInput` for an empty list, a repeated Target or an invalid subject.
pub fn validate_subjects(subjects: &[SubjectInput]) -> Result<(), LibraryError> {
    if subjects.is_empty() {
        return Err(invalid("a Project needs at least one subject".into()));
    }
    let mut targets = BTreeSet::new();
    for subject in subjects {
        subject.validate()?;
        if !targets.insert(subject.target_id) {
            return Err(invalid(format!("Target {} is a subject twice", subject.target_id)));
        }
    }
    Ok(())
}

/// Validate a full rig list: at least one rig, each once.
///
/// # Errors
/// `InvalidInput` for an empty list or a repeated rig.
pub fn validate_rigs(rig_ids: &[Uuid]) -> Result<(), LibraryError> {
    if rig_ids.is_empty() {
        return Err(invalid("a Project needs at least one rig".into()));
    }
    let mut seen = BTreeSet::new();
    if let Some(twice) = rig_ids.iter().find(|id| !seen.insert(**id)) {
        return Err(invalid(format!("rig {twice} is listed twice")));
    }
    Ok(())
}

/// The one criterion a quality bar names. A member without the measurement the
/// criterion needs reads unknown and counts toward no goal (PV-PRJ progress).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "criterion", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum QualityCriterion {
    /// Only frames whose applicable library quality is Usable count.
    UsableOnly,
    /// Only frames whose measured median FWHM is at most `max_px` pixels count.
    MaxFwhmMedian { max_px: f64 },
}

impl QualityCriterion {
    const fn name(&self) -> &'static str {
        match self {
            Self::UsableOnly => "usable_only",
            Self::MaxFwhmMedian { .. } => "max_fwhm_median",
        }
    }
}

/// One goal's kind and value. A channel is the frames' effective FILTER text;
/// `None` is the channel of frames that record no FILTER, as one-shot-colour
/// frames usually do. Goals are whole seconds or whole light frames. There is
/// no exposure-preference, equipment, Moon or spread goal (D-W29).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum GoalSpec {
    Integration {
        channel: Option<String>,
        goal_seconds: u64,
    },
    FrameCount {
        channel: Option<String>,
        goal_frames: u64,
    },
    /// Applies to every goal of its subject, or of its panel.
    QualityBar {
        criterion: QualityCriterion,
    },
}

/// What identifies a goal among the goals of one subject or panel.
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct GoalIdentity {
    pub kind: &'static str,
    /// The trimmed channel, or the quality bar's criterion name.
    pub key: Option<String>,
}

impl GoalSpec {
    /// The stored kind name.
    #[must_use]
    pub const fn kind_name(&self) -> &'static str {
        match self {
            Self::Integration { .. } => "integration",
            Self::FrameCount { .. } => "frame_count",
            Self::QualityBar { .. } => "quality_bar",
        }
    }

    /// The trimmed channel of an integration or frame-count goal.
    #[must_use]
    pub fn channel(&self) -> Option<&str> {
        match self {
            Self::Integration { channel, .. } | Self::FrameCount { channel, .. } => {
                channel.as_deref().map(str::trim)
            }
            Self::QualityBar { .. } => None,
        }
    }

    /// Integration and frame-count goals count frames; a quality bar only limits
    /// which frames count.
    #[must_use]
    pub const fn counts_frames(&self) -> bool {
        !matches!(self, Self::QualityBar { .. })
    }

    /// Whether `in_project` meets this integration or frame-count goal. Goal
    /// met reads "in project" only (D-W36); a quality bar is never met.
    #[must_use]
    pub fn met_by(&self, in_project: &GoalTally) -> bool {
        match self {
            Self::Integration { goal_seconds, .. } => {
                Microseconds::from_whole_seconds(*goal_seconds)
                    .is_some_and(|goal| in_project.seconds >= goal)
            }
            Self::FrameCount { goal_frames, .. } => in_project.frames >= *goal_frames,
            Self::QualityBar { .. } => false,
        }
    }

    #[must_use]
    pub fn identity(&self) -> GoalIdentity {
        let key = match self {
            Self::QualityBar { criterion } => Some(criterion.name().to_owned()),
            _ => self.channel().map(str::to_owned),
        };
        GoalIdentity { kind: self.kind_name(), key }
    }

    /// The same goal with its channel trimmed, as it is stored.
    #[must_use]
    pub fn normalized(&self) -> Self {
        let channel = self.channel().map(str::to_owned);
        match self {
            Self::Integration { goal_seconds, .. } => {
                Self::Integration { channel, goal_seconds: *goal_seconds }
            }
            Self::FrameCount { goal_frames, .. } => {
                Self::FrameCount { channel, goal_frames: *goal_frames }
            }
            Self::QualityBar { criterion } => Self::QualityBar { criterion: criterion.clone() },
        }
    }

    /// Validate the value: a non-blank channel when given, at least one second or
    /// frame within the catalog's integer range, a positive finite FWHM limit.
    ///
    /// # Errors
    /// `InvalidInput` naming the kind and field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let kind = self.kind_name();
        if self.channel().is_some_and(str::is_empty) {
            return Err(invalid(format!("{kind} channel is blank")));
        }
        let in_range = |value: u64| value >= 1 && i64::try_from(value).is_ok();
        match self {
            Self::Integration { goal_seconds, .. } => {
                if !in_range(*goal_seconds)
                    || Microseconds::from_whole_seconds(*goal_seconds).is_none()
                {
                    return Err(invalid(format!(
                        "integration goalSeconds {goal_seconds} is out of range"
                    )));
                }
            }
            Self::FrameCount { goal_frames, .. } => {
                if !in_range(*goal_frames) {
                    return Err(invalid(format!(
                        "frame_count goalFrames {goal_frames} is out of range"
                    )));
                }
            }
            Self::QualityBar { criterion: QualityCriterion::MaxFwhmMedian { max_px } } => {
                if !max_px.is_finite() || *max_px <= 0.0 {
                    return Err(invalid(format!("quality bar maxPx {max_px} must be above 0")));
                }
            }
            Self::QualityBar { criterion: QualityCriterion::UsableOnly } => {}
        }
        Ok(())
    }
}

/// A goal to set, naming its subject by Target and, on a mosaic subject, its
/// panel by number. Integration and frame-count goals of a mosaic subject name a
/// panel; a quality bar without a panel applies to every panel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalInput {
    pub target_id: Uuid,
    #[serde(default)]
    pub panel: Option<u32>,
    #[serde(flatten)]
    pub goal: GoalSpec,
}

/// Validate goal values and refuse the same goal twice for one subject or panel.
/// Which subjects and panels exist is checked against the Project's records.
///
/// # Errors
/// `InvalidInput` for an invalid value or a repeated goal.
pub fn validate_goals(goals: &[GoalInput]) -> Result<(), LibraryError> {
    let mut seen = BTreeSet::new();
    for item in goals {
        item.goal.validate()?;
        if !seen.insert((item.target_id, item.panel, item.goal.identity())) {
            return Err(invalid(format!(
                "Target {} lists the {} goal {:?} twice",
                item.target_id,
                item.goal.kind_name(),
                item.goal.identity().key
            )));
        }
    }
    Ok(())
}

/// Fields of a new Project: a name, optional notes, one or more subjects, one or
/// more rigs and any goals. Opening New Project from a Target lists it first.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub name: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub subjects: Vec<SubjectInput>,
    pub rig_ids: Vec<Uuid>,
    #[serde(default)]
    pub goals: Vec<GoalInput>,
}

/// Refuse a blank Project name.
///
/// # Errors
/// `InvalidInput` for a blank name.
pub fn validate_project_name(name: &str) -> Result<(), LibraryError> {
    if name.trim().is_empty() {
        return Err(invalid("project name is empty".into()));
    }
    Ok(())
}

impl ProjectInput {
    /// Validate everything that needs no catalog read.
    ///
    /// # Errors
    /// `InvalidInput` naming the field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        validate_project_name(&self.name)?;
        validate_subjects(&self.subjects)?;
        validate_rigs(&self.rig_ids)?;
        validate_goals(&self.goals)
    }
}

/// One "Reject for this Project only" mark or its withdrawal (`rejected` false).
/// It checks only this asset's latest decision in the Project: `expected_revision`
/// is the decision revision the user saw, 0 when the asset had none, and
/// `fingerprint` the observation they reviewed.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectionMark {
    pub asset_id: Uuid,
    pub fingerprint: ObservationFingerprint,
    pub expected_revision: Revision,
    pub rejected: bool,
}

/// A user goal template to save: `id` is absent on create.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalTemplateInput {
    #[serde(default)]
    pub id: Option<Uuid>,
    pub name: String,
    pub goals: Vec<GoalSpec>,
}

impl GoalTemplateInput {
    /// A template has a name and at least one goal, each once.
    ///
    /// # Errors
    /// `InvalidInput` naming the field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.name.trim().is_empty() {
            return Err(invalid("goal template name is empty".into()));
        }
        if self.goals.is_empty() {
            return Err(invalid("a goal template needs at least one goal".into()));
        }
        let mut seen = BTreeSet::new();
        for goal in &self.goals {
            goal.validate()?;
            if !seen.insert(goal.identity()) {
                return Err(invalid(format!(
                    "goal template lists the {} goal twice",
                    goal.kind_name()
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectQuery {
    /// Only the Projects with this Target as a subject.
    #[serde(default)]
    pub target_id: Option<Uuid>,
    /// "Show done": also list Done Projects; only open ones otherwise.
    #[serde(default)]
    pub show_done: bool,
    pub offset: u32,
    pub limit: u32,
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectState {
    Open,
    Done,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectPanel {
    pub id: Uuid,
    pub number: u32,
    pub ra_deg: f64,
    pub dec_deg: f64,
    /// Unknown when `None`, never zero.
    pub rotation_deg: Option<f64>,
}

/// A stored subject; `designation` is its Target's current designation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSubject {
    pub id: Uuid,
    pub target_id: Uuid,
    pub designation: String,
    pub name: Option<String>,
    pub mosaic: bool,
    /// By panel number.
    pub panels: Vec<SubjectPanel>,
}

/// A stored goal; its id stays across edits while its subject, panel, kind and
/// channel (or criterion) stay.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGoal {
    pub id: Uuid,
    pub subject_id: Uuid,
    pub panel_id: Option<Uuid>,
    #[serde(flatten)]
    pub goal: GoalSpec,
}

/// A Project as committed. It has no capture-site field; its sessions keep their
/// own sites.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub notes: Option<String>,
    pub state: ProjectState,
    pub done_at: Option<String>,
    pub revision: Revision,
    pub created_at: String,
    pub updated_at: String,
    /// In order; each Target once.
    pub subjects: Vec<ProjectSubject>,
    /// The rigs (saved equipment) taking part, in order.
    pub rig_ids: Vec<Uuid>,
    /// In order.
    pub goals: Vec<ProjectGoal>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub state: ProjectState,
    pub revision: Revision,
    /// Each subject's label, or its Target's designation, in order.
    pub subjects: Vec<String>,
    pub rig_count: u64,
    pub goal_count: u64,
}

/// A derived candidate session: its confirmed Target is the subject's Target and
/// its confirmed rig is one of the Project's rigs. Nothing of it is stored.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCandidate {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    pub decision_revision: Revision,
    pub date_basis: Option<String>,
    pub subject_id: Uuid,
    pub rig_id: Uuid,
    /// The session's frames outside the Trash, in id order.
    pub asset_ids: Vec<Uuid>,
}

/// The latest Project-only decision of one asset. Decisions are append-only;
/// `revision` counts this asset's decisions in this Project.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRejection {
    pub asset_id: Uuid,
    pub revision: Revision,
    pub rejected: bool,
    /// The observation the user decided on.
    pub fingerprint: ObservationFingerprint,
    pub decided_at: String,
}

/// A built-in or user goal template. Applying it copies its values.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalTemplate {
    pub id: Uuid,
    pub name: String,
    pub builtin: bool,
    pub revision: Revision,
    pub goals: Vec<GoalSpec>,
}

/// A Project with its derived candidates and the latest Project-only decision
/// of each asset, all read from one catalog snapshot.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: Project,
    pub candidates: Vec<ProjectCandidate>,
    pub rejections: Vec<ProjectRejection>,
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/// The frames of one goal's subject, panel and channel, each content-identical
/// frame once (PRJ-FR-04). Light frames count in `frames` and their known
/// exposure in `seconds`; an unknown value is counted apart, never as zero.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalTally {
    pub frames: u64,
    pub seconds: Microseconds,
    /// Light frames in `frames` whose exposure is unknown; they add no seconds.
    pub unknown_exposure_frames: u64,
    /// Frames whose image type is unknown; never in `frames`.
    pub unknown_image_type_frames: u64,
}

impl GoalTally {
    /// Count one frame by its image type (`None` when unknown) and exposure.
    /// A frame known not to be a light counts nowhere.
    pub fn count(&mut self, light: Option<bool>, exposure: Option<Microseconds>) {
        match light {
            Some(false) => {}
            None => self.unknown_image_type_frames += 1,
            Some(true) => {
                self.frames += 1;
                match exposure {
                    Some(exposure) => self.seconds = self.seconds.saturating_add(exposure),
                    None => self.unknown_exposure_frames += 1,
                }
            }
        }
    }
}

/// Progress of one integration or frame-count goal as two labelled numbers,
/// "in project" and "captured" (PRJ-FR-04, PRJ-FR-21, D-W36, D-W66).
/// `in_project` never exceeds `captured`, and `met` reads `in_project` only.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgress {
    pub goal: ProjectGoal,
    /// The latest saved memberships of the Project's runs outside its Trash,
    /// minus each run's exclusions, frames rejected for this Project, Trashed
    /// frames, frames whose bytes changed since their run chose them and
    /// frames a quality bar does not admit. A member stays after it stops
    /// being a candidate (D-W45).
    pub in_project: GoalTally,
    /// The candidates on the goal's subject plus the members of those runs,
    /// Trashed frames aside (D-W66, D-W72).
    pub captured: GoalTally,
    pub met: bool,
    /// The quality bars of the goal's subject or panel; a frame counts in
    /// project only when every one admits it.
    pub quality_bars: Vec<QualityCriterion>,
    /// Frames otherwise in project that a bar cannot judge because the
    /// measurement it needs is missing; they count toward no goal.
    pub unknown_for_bar: u64,
}

/// An automatic warning per subject and channel, read from calibration-matching
/// evidence (PRJ-FR-11, CAL-FR-12, D-W29). It is never a goal and never blocks
/// a run.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ProjectWarning {
    /// The subject's candidate lights in `channel` find darks that differ from
    /// them only in exposure: every dark not incompatible on another criterion
    /// has another exposure. Exposures are canonical decimal seconds, ascending.
    ExposureMismatch {
        subject_id: Uuid,
        channel: Option<String>,
        light_exposures: Vec<String>,
        dark_exposures: Vec<String>,
    },
}

/// A Project's goal progress, in goal order, and its warnings at its revision.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProgress {
    pub project_id: Uuid,
    pub revision: Revision,
    pub goals: Vec<GoalProgress>,
    pub warnings: Vec<ProjectWarning>,
}

const HOUR: u64 = 3600;

fn hours(channel: Option<&str>, count: u64) -> GoalSpec {
    GoalSpec::Integration { channel: channel.map(str::to_owned), goal_seconds: count * HOUR }
}

/// The built-in goal templates (D-W47), in display order. Their ids are fixed
/// and they are never stored, edited or deleted. One-shot-colour frames record
/// no FILTER, so both OSC templates set the no-filter channel; every copied value
/// stays editable in the Project.
#[must_use]
pub fn builtin_goal_templates() -> Vec<GoalTemplate> {
    let template = |id: u128, name: &str, goals: Vec<GoalSpec>| GoalTemplate {
        id: Uuid::from_u128(id),
        name: name.to_owned(),
        builtin: true,
        revision: 1,
        goals,
    };
    vec![
        template(
            0x0650_7e00_0000_4000_8000_0000_0000_0001,
            "HOO",
            vec![hours(Some("Ha"), 10), hours(Some("OIII"), 10)],
        ),
        template(
            0x0650_7e00_0000_4000_8000_0000_0000_0002,
            "SHO",
            vec![hours(Some("Ha"), 10), hours(Some("OIII"), 10), hours(Some("SII"), 10)],
        ),
        template(
            0x0650_7e00_0000_4000_8000_0000_0000_0003,
            "LRGB",
            vec![
                hours(Some("L"), 6),
                hours(Some("R"), 2),
                hours(Some("G"), 2),
                hours(Some("B"), 2),
            ],
        ),
        template(0x0650_7e00_0000_4000_8000_0000_0000_0004, "OSC broadband", vec![hours(None, 10)]),
        template(0x0650_7e00_0000_4000_8000_0000_0000_0005, "OSC dual-band", vec![hours(None, 15)]),
    ]
}
