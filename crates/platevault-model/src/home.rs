// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home's records (spec 065 PRJ-FR-17, PRJ-FR-18, PRJ-FR-19, root FR-020,
//! D-W27, D-W35, D-W39, D-W48): its own actions, each Project's row with its
//! one Next action, the rows of the new-sessions groups, the target status and
//! the running work. [`RunBlocker`] gathers the three sources of a blocked
//! run (PRJ-FR-18 rule 2) without changing how any of them is computed.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    CalibrationNeedsReview, GoalProgress, GoalSpec, Microseconds, NativePath, PreparationFailed,
    ProjectCandidate, ProjectSummary, ReviewContext, ReviewFilter, RunCounters, RunStage,
    ScanProgress, StorageOperationKind, ViewListing,
};

/// Home's first section (PRJ-FR-17 section 1).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HomeAction {
    Import,
    NewProject,
    PlanTonight,
}

impl HomeAction {
    /// Import, New Project and Plan tonight, in order.
    pub const ALL: [Self; 3] = [Self::Import, Self::NewProject, Self::PlanTonight];
}

/// What keeps a run waiting on the user (PRJ-FR-18 rule 2). Each variant is
/// its owning feature's own blocker: VSEL's unresolved inputs, CAL's
/// readiness line and PREP's latest revision.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum RunBlocker {
    /// `members` chosen members have no Available copy: offline, missing,
    /// unreadable or retired sources to reconnect, locate or remove
    /// (VSEL-FR-09).
    UnresolvedInputs { view_id: Uuid, members: u64 },
    /// Light groups whose calibration needs a review or an acceptance
    /// (CAL-FR-09, PRJ-AC-23).
    CalibrationNeedsReview(CalibrationNeedsReview),
    /// The latest preparation revision Failed, is Partial, or holds entries
    /// Open found changed (PREP-FR-09, PREP-FR-10).
    PreparationFailed(PreparationFailed),
}

impl RunBlocker {
    /// The stage the blocked run opens at.
    #[must_use]
    pub const fn stage(&self) -> RunStage {
        match self {
            Self::UnresolvedInputs { .. } => RunStage::Select,
            Self::CalibrationNeedsReview(_) => RunStage::Calibrate,
            Self::PreparationFailed(_) => RunStage::Prepare,
        }
    }
}

/// A Project's one Next action: the first rule of PRJ-FR-18 that applies.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum NextAction {
    /// Rule 1, "Review N new frames": the Project's candidates hold `frames`
    /// Unreviewed frames; it opens frame review on them filtered to
    /// Unreviewed (PIX-FR-18).
    ReviewNewFrames { frames: u64, context: ReviewContext, filter: ReviewFilter },
    /// Rule 2: the first blocked run outside the Trash by name, opened at the
    /// stage of its first blocker.
    OpenBlockedRun { view_id: Uuid, name: String, stage: RunStage, blockers: Vec<RunBlocker> },
    /// Rule 3, "Plan tonight": the subjects' Targets with a goal unmet in
    /// project and an observing window tonight (PLAN-FR-11), in subject order.
    PlanTonight { target_ids: Vec<Uuid> },
    /// Rule 4, "Start a processing run".
    StartRun,
}

/// One Project on Home (PRJ-FR-17 section 2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeProject {
    pub project: ProjectSummary,
    /// "in project" and "captured" of each integration and frame-count goal,
    /// in goal order.
    pub goals: Vec<GoalProgress>,
    /// Each run outside the Project's Trash with its stage, by name.
    pub stages: Vec<ViewListing>,
    pub next: NextAction,
}

/// A new-sessions row's one-click action (PRJ-FR-17 section 3, PRJ-FR-19).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SessionAction {
    /// Needs a Target: choose or confirm the session's Target.
    ChooseTarget,
    /// Not in a Project: Create Project prefilled from the session.
    CreateProject,
    /// Not in a Project: Add to Project, adding its Target and, when the
    /// Project lacks it, its rig, named by a note before saving (LIB-FR-17).
    AddToProject,
    /// Unreviewed: frame review of the Project's candidates filtered to
    /// Unreviewed.
    ReviewFrames { context: ReviewContext, filter: ReviewFilter },
    /// Ready to add: the open run on the session's subject and rig.
    AddToRun { view_id: Uuid },
    /// Ready to add: the run group holding open panel runs on the session's
    /// mosaic subject and rig.
    AddToRunGroup { group_id: Uuid },
    /// Ready to add, with no open run on the session's subject and rig.
    StartRun { project_id: Uuid, subject_id: Uuid, rig_id: Uuid },
}

/// A candidate session of an open Project with Unreviewed frames in it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnreviewedSession {
    pub project_id: Uuid,
    pub session_id: Uuid,
    /// Its frames outside the Trash that read Unreviewed in the Project.
    pub frames: u64,
    pub actions: Vec<SessionAction>,
}

/// A candidate of an open Project that is a member of none of its runs
/// (PRJ-FR-19).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyToAdd {
    pub project_id: Uuid,
    pub candidate: ProjectCandidate,
    pub actions: Vec<SessionAction>,
}

/// What an unmet goal still needs in project.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum GoalShortfall {
    Integration { seconds: Microseconds },
    FrameCount { frames: u64 },
}

impl GoalShortfall {
    /// What `progress` still needs in project; `None` once it is met, as
    /// goal met reads "in project" only (D-W36).
    #[must_use]
    pub fn of(progress: &GoalProgress) -> Option<Self> {
        if progress.met {
            return None;
        }
        match progress.goal.goal {
            GoalSpec::Integration { goal_seconds, .. } => {
                let goal = Microseconds::from_whole_seconds(goal_seconds)
                    .unwrap_or(Microseconds(u64::MAX));
                let seconds = Microseconds(goal.0.saturating_sub(progress.in_project.seconds.0));
                Some(Self::Integration { seconds })
            }
            GoalSpec::FrameCount { goal_frames, .. } => Some(Self::FrameCount {
                frames: goal_frames.saturating_sub(progress.in_project.frames),
            }),
            GoalSpec::QualityBar { .. } => None,
        }
    }
}

/// One unmet goal of an open Project and what its channel still needs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmetGoal {
    pub project_id: Uuid,
    pub project_name: String,
    pub progress: GoalProgress,
    pub still_needed: GoalShortfall,
}

/// A Target's unmet goals across the open Projects (PRJ-FR-17 section 5).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetStatus {
    pub target_id: Uuid,
    pub designation: String,
    /// By Project name, then goal order.
    pub goals: Vec<UnmetGoal>,
}

/// One Running operation (PRJ-FR-17 section 6). Each feature's own status
/// read names the rest.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum RunningWork {
    Scan {
        operation_id: Uuid,
        location_id: Uuid,
        progress: ScanProgress,
        started_at: String,
    },
    Measurement {
        operation_id: Uuid,
        counters: RunCounters,
        started_at: String,
    },
    Prepare {
        preparation_id: Uuid,
        view_id: Uuid,
        number: u32,
        folder: NativePath,
        started_at: String,
    },
    Import {
        import_id: Uuid,
        source_path: NativePath,
        updated_at: String,
    },
    Storage {
        operation_id: Uuid,
        /// OS Trash, copy or move.
        action: StorageOperationKind,
        items: u64,
        updated_at: String,
    },
}
