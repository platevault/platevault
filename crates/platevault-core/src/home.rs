// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home (spec 065 PRJ-FR-17, PRJ-FR-18, PRJ-FR-19, PRJ-FR-32, PRJ-AC-18/19/
//! 20/22/23, PV-PRJ-SC-05, root FR-020, LIB-AC-09; D-W27, D-W35, D-W39,
//! D-W48, D-W96, D-W100) on the [`Library`] facade: the top line and the six
//! sections in order, composed from each feature's own reads. The top line is
//! the Sessions filters' counts, so it always equals them. Home lists the open
//! Projects only, each with its pending changes and its Next action, the first
//! rule of PRJ-FR-18 that applies. Rule 2 names what keeps the Project waiting
//! on the user, in [`ProjectWait`] order: a suggestion that needs calibration,
//! the latest Apply ending Failed or Canceled, and leftovers in
//! `View (previous)/` still waiting for review. Everything is read from the
//! local catalog: no account, no network and no image file. Read-only.

use std::collections::BTreeMap;

use persistence_library::{SessionFilter, SessionQuery, SessionSummary};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::library::Library;
use crate::tonight::{Tonight, TonightQuery};
use crate::{
    AdmissionBlocker, ApplyJournal, ApplyOutcome, GoalProgress, GoalShortfall, HomeAction,
    HomeProject, ImportState, LibraryError, NextAction, PreviousItemReview, Project,
    ProjectCandidate, ProjectQuery, ProjectSuggestion, ProjectWait, QualityLabel, ReadyToAdd,
    ReviewContext, ReviewFilter, RunState, RunningWork, ScanState, SessionAction,
    SessionFilterCounts, StorageOperationState, TargetStatus, UnmetGoal, UnreviewedSession,
};

/// Home (PRJ-FR-17, root FR-020): the top line, then its six sections in
/// order.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct HomeDashboard {
    /// "N sessions need a Target · M not in any Project" (PRJ-FR-19).
    pub top_line: SessionFilterCounts,
    /// 1. Import, New Project and Plan tonight.
    pub actions: Vec<HomeAction>,
    /// 2. The open Projects by name (PRJ-FR-32).
    pub projects: Vec<HomeProject>,
    /// 3. New sessions needing work.
    pub new_sessions: NewSessions,
    /// 4. Tonight at the default site (PLAN-FR-11).
    pub tonight: Tonight,
    /// 5. Every Target with an unmet goal in an open Project, by designation.
    pub target_status: Vec<TargetStatus>,
    /// 6. Running scans, measurement runs, imports, each Project's one
    ///    operation (Apply, Copy to Output or a Wrap up step) and the storage
    ///    operations no Project operation carries, in that order.
    pub running_work: Vec<RunningWork>,
}

/// Home's new-sessions section (PRJ-FR-17 section 3), in group order.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct NewSessions {
    /// The Sessions "Needs a Target" list.
    pub needs_target: Vec<HomeSession>,
    /// The Sessions "Not in any Project" list.
    pub not_in_project: Vec<HomeSession>,
    /// Candidates of open Projects with Unreviewed frames, by Project.
    pub unreviewed: Vec<UnreviewedSession>,
    /// Sessions open Projects suggest and don't hold, by Project.
    pub ready_to_add: Vec<ReadyToAdd>,
}

/// A Sessions row with its one-click actions.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct HomeSession {
    pub session: SessionSummary,
    pub actions: Vec<SessionAction>,
}

/// One open Project's reads that Home composes.
struct ProjectReads {
    project: Project,
    goals: Vec<GoalProgress>,
    candidates: Vec<ProjectCandidate>,
    /// Unreviewed frames per candidate session.
    unreviewed: BTreeMap<Uuid, u64>,
    suggestions: Vec<ProjectSuggestion>,
    pending_changes: u64,
    /// The latest Apply, settled or not; `None` before the first.
    latest_apply: Option<ApplyJournal>,
    /// Leftovers in `View (previous)/` still waiting for review.
    unreviewed_leftovers: u64,
}

impl ProjectReads {
    /// Whether the Project has a View: an Apply installed one, or the
    /// latest Apply found one in place when it started.
    fn view_exists(&self) -> bool {
        self.latest_apply.as_ref().is_some_and(|journal| {
            journal.outcome == Some(ApplyOutcome::Applied) || journal.expected.view.is_some()
        })
    }
}

fn count(items: usize) -> u64 {
    u64::try_from(items).unwrap_or(u64::MAX)
}

impl Library {
    /// Home: the top line, then Actions, the open Projects, New sessions,
    /// Tonight for `tonight`, Target status and Running work. Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for invalid Tonight criteria; `PersistenceFailure` when
    /// the catalog cannot be read.
    pub async fn home_dashboard(
        &self,
        tonight: &TonightQuery,
    ) -> Result<HomeDashboard, LibraryError> {
        let catalog = self.catalog();
        let top_line = catalog.session_filter_counts().await?;
        let needs_target =
            self.home_sessions(SessionFilter::NeedsTarget, &[SessionAction::ChooseTarget]).await?;
        let not_in_project = self
            .home_sessions(
                SessionFilter::NotInAnyProject,
                &[SessionAction::CreateProject, SessionAction::AddToProject],
            )
            .await?;
        let tonight = self.tonight(tonight).await?;
        let mut projects = Vec::new();
        let mut unreviewed = Vec::new();
        let mut ready_to_add = Vec::new();
        let mut status: BTreeMap<(String, Uuid), Vec<UnmetGoal>> = BTreeMap::new();
        for summary in catalog.list_projects(&ProjectQuery::default()).await? {
            let reads = self.project_reads(summary.id).await?;
            unreviewed.extend(unreviewed_sessions(&reads));
            ready_to_add.extend(ready_to_add_sessions(&reads));
            for (target, goal) in unmet_goals(&reads) {
                status.entry(target).or_default().push(goal);
            }
            projects.push(HomeProject {
                project: summary,
                pending_changes: reads.pending_changes,
                next: next_action(&reads, &tonight),
                goals: reads.goals,
            });
        }
        let target_status = status
            .into_iter()
            .map(|((designation, target_id), goals)| TargetStatus { target_id, designation, goals })
            .collect();
        Ok(HomeDashboard {
            top_line,
            actions: HomeAction::ALL.to_vec(),
            projects,
            new_sessions: NewSessions { needs_target, not_in_project, unreviewed, ready_to_add },
            tonight,
            target_status,
            running_work: self.running_work().await?,
        })
    }

    async fn home_sessions(
        &self,
        filter: SessionFilter,
        actions: &[SessionAction],
    ) -> Result<Vec<HomeSession>, LibraryError> {
        let query = SessionQuery { filter: Some(filter), ..SessionQuery::default() };
        let listed = self.catalog().list_sessions(&query).await?;
        Ok(listed
            .into_iter()
            .map(|session| HomeSession { session, actions: actions.to_vec() })
            .collect())
    }

    async fn project_reads(&self, id: Uuid) -> Result<ProjectReads, LibraryError> {
        let catalog = self.catalog();
        let project = catalog.project(id).await?;
        let goals = self.project_progress(id).await?.goals;
        let candidates = catalog.project_candidates(id).await?;
        let basis =
            catalog.review_basis(ReviewContext::ProjectCandidates { project_id: id }).await?;
        let mut unreviewed = BTreeMap::new();
        for capture in &basis.captures {
            if QualityLabel::of(&capture.quality) == QualityLabel::Unreviewed {
                *unreviewed.entry(capture.session_id).or_default() += 1;
            }
        }
        let suggestions = catalog.project_suggestions(id).await?;
        let pending_changes = count(catalog.project_pending_changes(id).await?.len());
        let latest_apply = catalog.latest_apply_journal(id).await?;
        let leftovers = catalog.previous_items(id).await?;
        let unreviewed_leftovers = count(
            leftovers.iter().filter(|item| item.review == PreviousItemReview::Pending).count(),
        );
        Ok(ProjectReads {
            project,
            goals,
            candidates,
            unreviewed,
            suggestions,
            pending_changes,
            latest_apply,
            unreviewed_leftovers,
        })
    }

    /// Every Running operation, each kind through its feature's own read; one
    /// that ended since the snapshot is left out. A Project's operation is
    /// listed once, with the storage operation it carries.
    async fn running_work(&self) -> Result<Vec<RunningWork>, LibraryError> {
        let catalog = self.catalog();
        let running = catalog.running_operations().await?;
        let mut work = Vec::new();
        for id in running.scans {
            let scan = catalog.scan_status(id).await?;
            if scan.state == ScanState::Running {
                work.push(RunningWork::Scan {
                    operation_id: scan.id,
                    location_id: scan.location_id,
                    progress: scan.progress,
                    started_at: scan.started_at,
                });
            }
        }
        for id in running.measurements {
            let run = catalog.measurement_run(id).await?;
            if run.state == RunState::Running {
                work.push(RunningWork::Measurement {
                    operation_id: run.operation_id,
                    counters: run.counters,
                    started_at: run.started_at,
                });
            }
        }
        for id in running.imports {
            let import = catalog.import_record(id).await?;
            if import.state == ImportState::Running {
                work.push(RunningWork::Import {
                    import_id: import.id,
                    source_path: import.source_path,
                    updated_at: import.updated_at,
                });
            }
        }
        for running in running.projects {
            work.push(RunningWork::Project {
                operation: running.operation,
                project_name: running.project_name,
            });
        }
        for id in running.storage {
            let operation = catalog.storage_operation(id).await?;
            if operation.state == StorageOperationState::Running {
                work.push(RunningWork::Storage {
                    operation_id: operation.id,
                    action: operation.kind,
                    items: count(operation.items.len()),
                    updated_at: operation.updated_at,
                });
            }
        }
        Ok(work)
    }
}

/// The first rule of PRJ-FR-18 that applies to the open Project.
fn next_action(reads: &ProjectReads, tonight: &Tonight) -> NextAction {
    let frames: u64 = reads.unreviewed.values().sum();
    if frames > 0 {
        return NextAction::ReviewNewFrames {
            frames,
            context: ReviewContext::ProjectCandidates { project_id: reads.project.id },
            filter: ReviewFilter::Unreviewed,
        };
    }
    let waits = project_waits(reads);
    if let Some(first) = waits.first() {
        return NextAction::WaitsOnUser { step: first.step(), waits };
    }
    let target_ids: Vec<Uuid> = reads
        .project
        .subjects
        .iter()
        .filter(|subject| {
            reads.goals.iter().any(|goal| goal.goal.subject_id == subject.id && !goal.met)
                && tonight.has_window(subject.target_id)
        })
        .map(|subject| subject.target_id)
        .collect();
    if !target_ids.is_empty() {
        return NextAction::PlanTonight { target_ids };
    }
    if reads.pending_changes > 0 {
        NextAction::ApplyChanges { changes: reads.pending_changes }
    } else if reads.view_exists() {
        NextAction::OpenView
    } else {
        NextAction::AddSessions
    }
}

/// What keeps the Project waiting on the user (PRJ-FR-18 rule 2), in rule
/// order: each suggestion whose calibration isn't settled or drifted, the
/// latest Apply when it ended Failed or Canceled, and the leftovers in
/// `View (previous)/` the user hasn't reviewed.
fn project_waits(reads: &ProjectReads) -> Vec<ProjectWait> {
    let mut waits: Vec<ProjectWait> = reads
        .suggestions
        .iter()
        .filter(|suggestion| {
            suggestion.blockers.iter().any(|blocker| {
                matches!(
                    blocker,
                    AdmissionBlocker::CalibrationUnsettled { .. }
                        | AdmissionBlocker::CalibrationDrifted { .. }
                )
            })
        })
        .map(|suggestion| ProjectWait::SuggestionNeedsCalibration {
            session_id: suggestion.session_id,
        })
        .collect();
    if let Some(journal) = &reads.latest_apply {
        if let Some(outcome @ (ApplyOutcome::Failed | ApplyOutcome::Canceled)) = journal.outcome {
            waits.push(ProjectWait::ApplyNotFinished {
                operation_id: journal.operation_id,
                outcome,
            });
        }
    }
    if reads.unreviewed_leftovers > 0 {
        waits.push(ProjectWait::PreviousViewHolds { files: reads.unreviewed_leftovers });
    }
    waits
}

/// The Project's candidate sessions with Unreviewed frames, in candidate
/// order.
fn unreviewed_sessions(reads: &ProjectReads) -> Vec<UnreviewedSession> {
    let project_id = reads.project.id;
    let review = SessionAction::ReviewFrames {
        context: ReviewContext::ProjectCandidates { project_id },
        filter: ReviewFilter::Unreviewed,
    };
    reads
        .candidates
        .iter()
        .filter_map(|candidate| {
            let frames = *reads.unreviewed.get(&candidate.session_id)?;
            Some(UnreviewedSession {
                project_id,
                session_id: candidate.session_id,
                frames,
                actions: vec![review],
            })
        })
        .collect()
}

/// The Project's suggestions (PRJ-FR-09, PRJ-FR-19): Ready sessions it
/// doesn't hold, each offered as opening the Project's suggestions with what
/// keeps it out for now. A suggestion is never added by itself.
fn ready_to_add_sessions(reads: &ProjectReads) -> Vec<ReadyToAdd> {
    let project_id = reads.project.id;
    reads
        .suggestions
        .iter()
        .map(|suggestion| ReadyToAdd {
            project_id,
            suggestion: suggestion.clone(),
            actions: vec![SessionAction::OpenSuggestions { project_id }],
        })
        .collect()
}

/// Each unmet goal with what it still needs, keyed by its subject Target's
/// designation and id.
fn unmet_goals(reads: &ProjectReads) -> Vec<((String, Uuid), UnmetGoal)> {
    reads
        .goals
        .iter()
        .filter_map(|progress| {
            let still_needed = GoalShortfall::of(progress)?;
            let subject = reads
                .project
                .subjects
                .iter()
                .find(|subject| subject.id == progress.goal.subject_id)?;
            let goal = UnmetGoal {
                project_id: reads.project.id,
                project_name: reads.project.name.clone(),
                progress: progress.clone(),
                still_needed,
            };
            Some(((subject.designation.clone(), subject.target_id), goal))
        })
        .collect()
}
