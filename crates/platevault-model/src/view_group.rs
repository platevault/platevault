// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Mosaic run groups (spec 066 VSEL-FR-05/07/08/18/19, D-W38, D-W41, D-W73).
//!
//! A run on a mosaic subject is a run group: one panel run (a [`crate::View`]
//! with a group and a panel) per panel the user confirmed at creation, and no
//! whole-mosaic run. Each session is assigned to a panel by its pointing,
//! checked against the panel's centre and rotation over the rig's field of
//! view. A session in more than one panel, outside every panel, without
//! pointing, or on a rig with no known field of view is flagged and joins no
//! panel run until the user assigns a panel or leaves it out. The group holds
//! one shared setup that every panel run takes; each panel run keeps its own
//! status, and a group action reports its outcome per panel.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    CalibrationPolicy, ExpectedSession, FieldOfView, LibraryError, Revision, SkyPoint,
    SubjectPanel, View, ViewRecord,
};

/// How a preparation presents its inputs to the processing tool (PREP-FR-04).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputMode {
    LinkedView,
    DirectSource,
    Copy,
    Clone,
}

/// The setup a run group shares with every panel run (D-W38).
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSetup {
    /// The PREP handoff profile, once chosen.
    #[serde(default)]
    pub profile_id: Option<Uuid>,
    /// Unset until chosen; PREP suggests one per profile.
    #[serde(default)]
    pub input_mode: Option<InputMode>,
    #[serde(default)]
    pub calibration_policy: CalibrationPolicy,
}

/// A run group: its Project, mosaic subject and rig never change.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewGroup {
    pub id: Uuid,
    pub project_id: Uuid,
    pub subject_id: Uuid,
    pub rig_id: Uuid,
    /// The mosaic's name: the `<Mosaic>` of its prepared and Results folders.
    pub name: String,
    pub setup: GroupSetup,
    /// Bumped by every setup change and panel decision.
    pub revision: Revision,
    pub created_at: String,
    pub updated_at: String,
}

/// Start a run group on a mosaic subject. `panels` are the subject's panels
/// exactly as the creation step listed them by centre and rotation: creation
/// refuses a list that is stale or misses one (D-W73).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewViewGroup {
    pub project_id: Uuid,
    pub subject_id: Uuid,
    pub rig_id: Uuid,
    pub name: String,
    pub panels: Vec<SubjectPanel>,
}

impl NewViewGroup {
    /// # Errors
    /// `InvalidInput` for a blank name.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.name.trim().is_empty() {
            return Err(LibraryError::InvalidInput("run group name is blank".into()));
        }
        Ok(())
    }
}

/// Who decided a session's panel.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelBasis {
    /// Its pointing: assigned when exactly one panel holds it, else flagged.
    Pointing,
    /// The user assigned the panel.
    User,
    /// The user left the session out of every panel run.
    LeftOut,
}

/// Why pointing assigned a session to no panel; it waits for the user.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelFlag {
    /// More than one panel holds it, or its frames fall in different panels.
    Ambiguous,
    /// No panel holds any of its frames.
    OffPanel,
    /// A light frame lacks pointing.
    NoPointing,
    /// The rig's field of view is unknown, so no panel has an extent.
    FovUnknown,
}

/// A session's pointing against one panel, as checked.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelCheck {
    pub panel_id: Uuid,
    pub number: u32,
    /// The panel centre and rotation the check used.
    pub centre: SkyPoint,
    /// `None` is unknown: the check then used the circle the field holds at
    /// any rotation.
    pub rotation_deg: Option<f64>,
    /// Separation of the session's mean pointing from the panel centre.
    pub separation_deg: Option<f64>,
    /// Light frames whose pointing lies inside the panel; `None` without a
    /// panel extent or pointing.
    pub frames_inside: Option<u64>,
}

/// The pointing evidence a panel decision names.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelEvidence {
    pub light_frames: u64,
    pub frames_with_pointing: u64,
    pub mean_pointing: Option<SkyPoint>,
    /// The rig's field of view: the extent of every panel around its centre.
    pub extent: Option<FieldOfView>,
    /// One check per panel, by number.
    pub checks: Vec<PanelCheck>,
}

/// What pointing says about one session: its panel when exactly one panel
/// holds every light frame, otherwise a flag.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointingAssessment {
    pub session: ExpectedSession,
    pub panel_id: Option<Uuid>,
    pub flag: Option<PanelFlag>,
    pub evidence: PanelEvidence,
}

/// A recorded panel decision of one group session. `flag` stays the flag its
/// pointing raised, also after the user decided.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelAssignment {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    pub panel_id: Option<Uuid>,
    pub basis: PanelBasis,
    pub flag: Option<PanelFlag>,
    pub evidence: PanelEvidence,
    pub decided_at: String,
}

/// The user's panel for one session.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum PanelChoice {
    Panel { panel_id: Uuid },
    LeftOut,
}

/// One user decision: a flagged, new or assigned session goes to a panel or is
/// left out.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelDecision {
    pub session_id: Uuid,
    pub choice: PanelChoice,
}

/// A run group with its panel runs by panel number and its recorded panel
/// decisions by session.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewGroupRecord {
    pub group: ViewGroup,
    pub runs: Vec<ViewRecord>,
    pub assignments: Vec<PanelAssignment>,
}

/// One panel run's outcome of a group action. One panel's refusal never
/// changes another panel (VSEL-FR-19).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum PanelResult {
    Applied,
    /// The panel run already had it.
    Unchanged,
    /// The panel run was left as it was, for `reason`.
    Refused {
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelOutcome {
    pub panel_id: Uuid,
    pub number: u32,
    pub view_id: Uuid,
    pub result: PanelResult,
}

/// A group action's result: the group after it and each panel's outcome, by
/// panel number.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupActionOutcome {
    pub group: ViewGroup,
    pub panels: Vec<PanelOutcome>,
}

/// Where a panel run stands in its run group (D-W75). A panel run in the
/// Project's Trash stays listed with its group as Trashed: its frames leave
/// every group count and summary, and group actions skip it. Restore returns
/// it; Empty Trash removes its record, and the group has one panel fewer.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelRunState {
    Live,
    Trashed,
}

impl PanelRunState {
    /// The state of panel run `view`.
    #[must_use]
    pub const fn of(view: &View) -> Self {
        if view.trashed_at.is_some() {
            Self::Trashed
        } else {
            Self::Live
        }
    }
}

/// The run group's Panel filter (VSEL-FR-05): the sessions of one panel, the
/// flagged ones, or the new ones no decision covers yet.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum PanelFilter {
    Panel { number: u32 },
    Flagged,
    New,
}
