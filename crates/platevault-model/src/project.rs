// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Projects (spec 065): the processing unit (D-W93).
//!
//! A Project names its subjects (Targets), the rigs taking part and goals per
//! subject and channel, or per panel group of a mosaic. It is open until Wrap
//! up closes it and has no capture site. Its suggested sessions are derived
//! on read from confirmed Target and confirmed rig and are never stored; the
//! sessions it holds are its inputs (`project_inputs`). Writing a Project
//! changes no file, no library quality decision and no session record.

use std::collections::BTreeSet;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use crate::{LibraryError, ProjectLifecycle, Revision};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

/// Exposure in whole microseconds. Each frame is rounded once and totals are
/// integer sums, so whether a goal is met never depends on floating-point
/// summation. The wire carries seconds.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Ord, PartialOrd, Hash)]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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

/// A subject: a saved Target, which identifies the subject within its
/// Project across edits. `name` is an optional label; the Target's
/// designation is always shown beside it. A mosaic is not a subject kind: its
/// panels are the Project's panel groups (PRJ-FR-27).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SubjectInput {
    pub target_id: Uuid,
    #[serde(default)]
    pub name: Option<String>,
}

impl SubjectInput {
    /// The label as given; blank labels are refused by [`Self::validate`].
    #[must_use]
    pub fn label(&self) -> Option<&str> {
        self.name.as_deref().map(str::trim)
    }

    /// # Errors
    /// `InvalidInput` naming the Target for a blank label.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.label().is_some_and(str::is_empty) {
            return Err(invalid(format!("subject {}: name is blank", self.target_id)));
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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

/// A goal to set, naming its subject by Target and, for a mosaic panel, the
/// Project's panel group by id (PRJ-FR-03/29): groups, not names, scope panel
/// goals. A quality bar without a group applies to every panel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct GoalInput {
    pub target_id: Uuid,
    #[serde(default)]
    pub group_id: Option<Uuid>,
    #[serde(flatten)]
    pub goal: GoalSpec,
}

/// Validate goal values and refuse the same goal twice for one subject or
/// panel group. Which subjects and groups exist is checked against the
/// Project's records.
///
/// # Errors
/// `InvalidInput` for an invalid value or a repeated goal.
pub fn validate_goals(goals: &[GoalInput]) -> Result<(), LibraryError> {
    let mut seen = BTreeSet::new();
    for item in goals {
        item.goal.validate()?;
        if !seen.insert((item.target_id, item.group_id, item.goal.identity())) {
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
    /// Also list the Projects Wrap up closed (Closing, Closed, Archived);
    /// only open ones otherwise.
    #[serde(default)]
    pub include_closed: bool,
    pub offset: u32,
    pub limit: u32,
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/// A stored subject; `designation` is its Target's current designation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectSubject {
    pub id: Uuid,
    pub target_id: Uuid,
    pub designation: String,
    pub name: Option<String>,
}

/// A stored goal; its id stays across edits while its subject, panel group,
/// kind and channel (or criterion) stay.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectGoal {
    pub id: Uuid,
    pub subject_id: Uuid,
    /// The mosaic panel group the goal belongs to (PRJ-FR-29).
    #[serde(default)]
    pub group_id: Option<Uuid>,
    #[serde(flatten)]
    pub goal: GoalSpec,
}

/// A Project as committed. It has no capture-site field; its sessions keep their
/// own sites.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub notes: Option<String>,
    /// Open until Wrap up closes it (PRJ-FR-32); there is no Reopen.
    pub lifecycle: ProjectLifecycle,
    /// When Close project… confirmed; set exactly when not open.
    pub closed_at: Option<String>,
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub lifecycle: ProjectLifecycle,
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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

/// A built-in or user goal template. Applying it copies its values.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct GoalTemplate {
    pub id: Uuid,
    pub name: String,
    pub builtin: bool,
    pub revision: Revision,
    pub goals: Vec<GoalSpec>,
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/// The frames of one goal's subject, panel and channel, each content-identical
/// frame once (PRJ-FR-04). Light frames count in `frames` and their known
/// exposure in `seconds`; an unknown value is counted apart, never as zero.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct GoalProgress {
    pub goal: ProjectGoal,
    /// The frames of the Project's own sessions on the goal's subject (in
    /// its panel group for a panel goal) that its next View places, each
    /// content-identical frame once: the Project's exclusions, frames the
    /// Library no longer has Usable unless explicitly included, Trashed
    /// frames and frames a quality bar does not admit are left out. Each
    /// Project counts its own sessions (D-W96).
    pub in_project: GoalTally,
    /// The frames the Project holds on the subject, placed or not, plus the
    /// frames of its suggestions on the subject, settled or not
    /// (provisional), Trashed frames aside (D-W66).
    pub captured: GoalTally,
    pub met: bool,
    /// The quality bars of the goal's subject or panel; a frame counts in
    /// project only when every one admits it.
    pub quality_bars: Vec<QualityCriterion>,
    /// Frames otherwise in project that a bar cannot judge because the
    /// measurement it needs is missing; they count toward no goal.
    pub unknown_for_bar: u64,
}

/// An automatic warning per subject, rig and channel, computed from the
/// Project's sessions (PRJ-FR-11, CAL-FR-12, D-W29). It is never a goal and
/// never blocks Apply.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ProjectWarning {
    /// The Project's light sessions on the subject on `rig_id` in `channel`
    /// find darks that differ from them only in exposure: every dark not
    /// incompatible on another criterion has another exposure. Exposures are
    /// canonical decimal seconds, ascending.
    ExposureMismatch {
        subject_id: Uuid,
        rig_id: Uuid,
        channel: Option<String>,
        light_exposures: Vec<String>,
        dark_exposures: Vec<String>,
    },
}

/// A Project's goal progress, in goal order, and its warnings at its revision.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
