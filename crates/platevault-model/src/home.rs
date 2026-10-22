// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home's records (spec 065 PRJ-FR-17, PRJ-FR-18, PRJ-FR-19, PRJ-FR-32,
//! root FR-020, D-W27, D-W35, D-W39, D-W48, D-W96, D-W100): its own actions,
//! each open Project's row with its pending changes and its one Next action,
//! the rows of the new-sessions groups, the target status and the running
//! work. [`ProjectWait`] names what keeps a Project waiting on the user
//! (PRJ-FR-18 rule 2) and the step it opens at.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ApplyOutcome, GoalProgress, GoalSpec, Microseconds, NativePath, ProjectOperation,
    ProjectSuggestion, ProjectSummary, ReviewContext, ReviewFilter, RunCounters, ScanProgress,
    StorageOperationKind,
};

/// Home's first section (PRJ-FR-17 section 1).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum HomeAction {
    Import,
    NewProject,
    PlanTonight,
}

impl HomeAction {
    /// Import, New Project and Plan tonight, in order.
    pub const ALL: [Self; 3] = [Self::Import, Self::NewProject, Self::PlanTonight];
}

/// The Project step a waiting Project opens at (PRJ-FR-18 rule 2).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ProjectStep {
    Sessions,
    View,
}

/// What keeps an open Project waiting on the user (PRJ-FR-18 rule 2,
/// provisional), in rule order.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ProjectWait {
    /// A session the Project suggests needs calibration before it can join
    /// ("Choose its flats first", PRJ-AC-23).
    SuggestionNeedsCalibration { session_id: Uuid },
    /// The Project's latest Apply failed or was canceled.
    ApplyNotFinished { operation_id: Uuid, outcome: ApplyOutcome },
    /// `View (previous)/` holds `files` the user hasn't reviewed (D-W110).
    PreviousViewHolds { files: u64 },
}

impl ProjectWait {
    /// The step the waiting Project opens at.
    #[must_use]
    pub const fn step(&self) -> ProjectStep {
        match self {
            Self::SuggestionNeedsCalibration { .. } => ProjectStep::Sessions,
            Self::ApplyNotFinished { .. } | Self::PreviousViewHolds { .. } => ProjectStep::View,
        }
    }
}

/// A Project's one Next action: the first rule of PRJ-FR-18 that applies.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum NextAction {
    /// Rule 1, "Review N new frames": the Project's candidates hold `frames`
    /// Unreviewed frames; it opens frame review on them filtered to
    /// Unreviewed (PIX-FR-18).
    ReviewNewFrames { frames: u64, context: ReviewContext, filter: ReviewFilter },
    /// Rule 2: the Project waits on the user and opens at `step`, the step of
    /// the first wait.
    WaitsOnUser { step: ProjectStep, waits: Vec<ProjectWait> },
    /// Rule 3, "Plan tonight": the subjects' Targets with a goal unmet in
    /// project and an observing window tonight (PLAN-FR-11), in subject order.
    PlanTonight { target_ids: Vec<Uuid> },
    /// Rule 4, "Apply N changes" (provisional copy).
    ApplyChanges { changes: u64 },
    /// Rule 4, "Open in {app}" once the View exists (provisional copy).
    OpenView,
    /// Rule 4, "Add sessions" before the first Apply (provisional copy).
    AddSessions,
}

/// One open Project on Home (PRJ-FR-17 section 3, PRJ-FR-32).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct HomeProject {
    pub project: ProjectSummary,
    /// "in project" and "captured" of each integration and frame-count goal,
    /// in goal order.
    pub goals: Vec<GoalProgress>,
    /// How many changes wait for the next Apply.
    pub pending_changes: u64,
    pub next: NextAction,
}

/// A new-sessions row's one-click action (PRJ-FR-17 section 2, PRJ-FR-19).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
    /// A session an open Project suggests: open that Project's suggestions
    /// (PRJ-FR-19). Nothing is added until the user adds it.
    OpenSuggestions { project_id: Uuid },
}

/// A candidate session of an open Project with Unreviewed frames in it.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct UnreviewedSession {
    pub project_id: Uuid,
    pub session_id: Uuid,
    /// Its frames outside the Trash that read Unreviewed in the Project.
    pub frames: u64,
    pub actions: Vec<SessionAction>,
}

/// A session an open Project suggests and doesn't hold (PRJ-FR-09,
/// PRJ-FR-19), with what keeps it out for now, such as calibration that
/// isn't settled ("Choose its flats first").
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ReadyToAdd {
    pub project_id: Uuid,
    pub suggestion: ProjectSuggestion,
    pub actions: Vec<SessionAction>,
}

/// What an unmet goal still needs in project.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct UnmetGoal {
    pub project_id: Uuid,
    pub project_name: String,
    pub progress: GoalProgress,
    pub still_needed: GoalShortfall,
}

/// A Target's unmet goals across the open Projects (PRJ-FR-17 section 5).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TargetStatus {
    pub target_id: Uuid,
    pub designation: String,
    /// By Project name, then goal order.
    pub goals: Vec<UnmetGoal>,
}

/// One Running operation (PRJ-FR-17 section 4). Each feature's own status
/// read names the rest.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
    Import {
        import_id: Uuid,
        source_path: NativePath,
        updated_at: String,
    },
    /// A Project's one running operation (Apply, Copy to Output, or a Wrap up
    /// step), listed once with its Project's name (PREP-FR-19).
    Project {
        operation: ProjectOperation,
        project_name: String,
    },
    /// A storage operation no Project operation above carries.
    Storage {
        operation_id: Uuid,
        /// OS Trash, copy or move.
        action: StorageOperationKind,
        items: u64,
        updated_at: String,
    },
}
