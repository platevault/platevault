// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home (spec 065 PRJ-FR-17, PRJ-FR-18, PRJ-FR-19, PRJ-AC-18/19/20/22/23,
//! PV-PRJ-SC-05, root FR-020, LIB-AC-09; D-W27, D-W35, D-W39, D-W48) on the
//! [`Library`] facade: the top line and the six sections in order, composed
//! from each feature's own reads. The top line is the Sessions filters'
//! counts, so it always equals them. A Project's Next action is the first
//! rule of PRJ-FR-18 that applies; rule 2 gathers a run's [`RunBlocker`]s
//! from VSEL's unresolved inputs, CAL's readiness line and PREP's latest
//! revision, unchanged. Everything is read from the local catalog: no
//! account, no network and no image file. Read-only.

use std::collections::{BTreeMap, BTreeSet};

use persistence_library::{RunningStorage, SessionFilter, SessionQuery, SessionSummary};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::library::Library;
use crate::tonight::{Tonight, TonightQuery};
use crate::{
    ArchiveState, CleanupState, GoalProgress, GoalShortfall, HomeAction, HomeProject, ImportState,
    LibraryError, NextAction, OpenChoiceKind, PreparationState, Project, ProjectCandidate,
    ProjectMember, ProjectQuery, ProjectState, QualityLabel, ReadyToAdd, ReviewContext,
    ReviewFilter, RunBlocker, RunCompletion, RunStage, RunState, RunningWork, ScanState,
    SessionAction, SessionFilterCounts, StorageOperationState, TargetStatus, UnmetGoal,
    UnreviewedSession, ViewListing, ViewQuery,
};

/// Home (PRJ-FR-17, root FR-020): the top line, then its six sections in
/// order.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeDashboard {
    /// "N sessions need a Target · M not in any Project" (PRJ-FR-19).
    pub top_line: SessionFilterCounts,
    /// 1. Import, New Project and Plan tonight.
    pub actions: Vec<HomeAction>,
    /// 2. The open Projects by name, and the Done ones under "Show done".
    pub projects: Vec<HomeProject>,
    /// 3. New sessions needing work.
    pub new_sessions: NewSessions,
    /// 4. Tonight at the default site (PLAN-FR-11).
    pub tonight: Tonight,
    /// 5. Every Target with an unmet goal in an open Project, by designation.
    pub target_status: Vec<TargetStatus>,
    /// 6. Running scans, measurement runs, preparations, Prepare all of run
    ///    groups, imports, run Clean ups and Empty Trashes, archive transfers,
    ///    Done / Archive trash moves and other storage operations, in that
    ///    order.
    pub running_work: Vec<RunningWork>,
}

/// Home's new-sessions section (PRJ-FR-17 section 3), in group order.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessions {
    /// The Sessions "Needs a Target" list.
    pub needs_target: Vec<HomeSession>,
    /// The Sessions "Not in any Project" list.
    pub not_in_project: Vec<HomeSession>,
    /// Candidates of open Projects with Unreviewed frames, by Project.
    pub unreviewed: Vec<UnreviewedSession>,
    /// Candidates of open Projects that are no member of their runs.
    pub ready_to_add: Vec<ReadyToAdd>,
}

/// A Sessions row with its one-click actions.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeSession {
    pub session: SessionSummary,
    pub actions: Vec<SessionAction>,
}

/// One Project's reads that Home composes.
struct ProjectReads {
    project: Project,
    goals: Vec<GoalProgress>,
    runs: Vec<ViewListing>,
    candidates: Vec<ProjectCandidate>,
    /// Unreviewed frames per candidate session.
    unreviewed: BTreeMap<Uuid, u64>,
}

impl Library {
    /// Home: the top line, then Actions, Projects (Done ones only with
    /// `show_done`), New sessions, Tonight for `tonight`, Target status and
    /// Running work. Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for invalid Tonight criteria; `PersistenceFailure` when
    /// the catalog cannot be read.
    pub async fn home_dashboard(
        &self,
        show_done: bool,
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
        let query = ProjectQuery { target_id: None, show_done, offset: 0, limit: 0 };
        let mut projects = Vec::new();
        let mut unreviewed = Vec::new();
        let mut ready_to_add = Vec::new();
        let mut status: BTreeMap<(String, Uuid), Vec<UnmetGoal>> = BTreeMap::new();
        for summary in catalog.list_projects(&query).await? {
            let reads = self.project_reads(summary.id).await?;
            let next = self.next_action(&reads, &tonight).await?;
            if reads.project.state == ProjectState::Open {
                unreviewed.extend(unreviewed_sessions(&reads));
                let members = catalog.project_members(summary.id).await?;
                ready_to_add.extend(ready_to_add_sessions(&reads, &members));
                for (target, goal) in unmet_goals(&reads) {
                    status.entry(target).or_default().push(goal);
                }
            }
            projects.push(HomeProject {
                project: summary,
                goals: reads.goals,
                stages: reads.runs,
                next,
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

    /// What keeps run `id` waiting on the user (PRJ-FR-18 rule 2): its
    /// unresolved inputs, its calibration needing review once it reached
    /// Calibrate, and its failed preparation, in that order. A run in the
    /// Project's Trash or marked Complete is never blocked. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; `PersistenceFailure` when the catalog
    /// cannot be read.
    pub async fn run_blockers(&self, id: Uuid) -> Result<Vec<RunBlocker>, LibraryError> {
        let view = self.catalog().view(id).await?.view;
        if view.trashed_at.is_some() || view.completion == RunCompletion::Complete {
            return Ok(Vec::new());
        }
        let mut blockers = Vec::new();
        let unresolved = self
            .view_detail(id)
            .await?
            .open_choices
            .iter()
            .find(|choice| choice.kind == OpenChoiceKind::UnresolvedMembers)
            .map_or(0, |choice| choice.count);
        if unresolved > 0 {
            blockers.push(RunBlocker::UnresolvedInputs { view_id: id, members: unresolved });
        }
        if view.revision > 0 && reached_calibrate(view.stage) {
            let readiness = self.calibration_readiness(id, view.revision).await?;
            if let Some(blocker) = readiness.needs_review_blocker() {
                blockers.push(RunBlocker::CalibrationNeedsReview(blocker));
            }
        }
        if let Some(blocker) = self.preparation_blocker(id).await? {
            blockers.push(RunBlocker::PreparationFailed(blocker));
        }
        Ok(blockers)
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
        let runs =
            catalog.list_views(&ViewQuery { project_id: Some(id), offset: 0, limit: 0 }).await?;
        let candidates = catalog.project_candidates(id).await?;
        let basis =
            catalog.review_basis(ReviewContext::ProjectCandidates { project_id: id }).await?;
        let mut unreviewed = BTreeMap::new();
        for capture in &basis.captures {
            if QualityLabel::of(&capture.quality, capture.project_rejected)
                == QualityLabel::Unreviewed
            {
                *unreviewed.entry(capture.session_id).or_default() += 1;
            }
        }
        Ok(ProjectReads { project, goals, runs, candidates, unreviewed })
    }

    /// The first rule of PRJ-FR-18 that applies to the Project.
    async fn next_action(
        &self,
        reads: &ProjectReads,
        tonight: &Tonight,
    ) -> Result<NextAction, LibraryError> {
        let frames: u64 = reads.unreviewed.values().sum();
        if frames > 0 {
            return Ok(NextAction::ReviewNewFrames {
                frames,
                context: ReviewContext::ProjectCandidates { project_id: reads.project.id },
                filter: ReviewFilter::Unreviewed,
            });
        }
        for run in &reads.runs {
            let blockers = self.run_blockers(run.id).await?;
            if let Some(first) = blockers.first() {
                return Ok(NextAction::OpenBlockedRun {
                    view_id: run.id,
                    name: run.name.clone(),
                    stage: first.stage(),
                    blockers,
                });
            }
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
            return Ok(NextAction::PlanTonight { target_ids });
        }
        Ok(NextAction::StartRun)
    }

    /// Every Running operation, each kind through its feature's own read; one
    /// that ended since the snapshot is left out.
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
        for id in running.preparations {
            let revision = catalog.preparation(id).await?.revision;
            if revision.state == PreparationState::Running {
                work.push(RunningWork::Prepare {
                    preparation_id: revision.id,
                    view_id: revision.view_id,
                    number: revision.n,
                    folder: revision.folder,
                    started_at: revision.started_at,
                });
            }
        }
        for id in running.group_preparations {
            let preparation = catalog.group_preparation(id).await?.preparation;
            if preparation.outcome == PreparationState::Running {
                work.push(RunningWork::PrepareAll {
                    group_preparation_id: preparation.id,
                    group_id: preparation.group_id,
                    number: preparation.n,
                    folder: preparation.folder,
                    started_at: preparation.started_at,
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
        self.storage_work(running.storage, &mut work).await?;
        Ok(work)
    }

    /// Running run Clean ups and Empty Trashes, archive transfers, trash
    /// moves, then every other Running storage operation, each listed once.
    async fn storage_work(
        &self,
        running: RunningStorage,
        work: &mut Vec<RunningWork>,
    ) -> Result<(), LibraryError> {
        let catalog = self.catalog();
        let count = |items: usize| u64::try_from(items).unwrap_or(u64::MAX);
        for id in running.cleanups {
            let cleanup = catalog.run_cleanup(id).await?;
            if cleanup.state == CleanupState::Running {
                work.push(RunningWork::Cleanup {
                    cleanup_id: cleanup.id,
                    action: cleanup.kind,
                    view_id: cleanup.view_id,
                    run_name: cleanup.run_name,
                    operation_id: cleanup.operation_id,
                    reviewed_at: cleanup.created_at,
                });
            }
        }
        for id in running.archives {
            let transfer = catalog.archive_record(id).await?.transfer;
            if transfer.state == ArchiveState::Running {
                work.push(RunningWork::Archive {
                    transfer_id: transfer.id,
                    action: transfer.kind,
                    project_id: transfer.project.id,
                    operation_id: transfer.storage_operation_id,
                    items: count(transfer.items.len()),
                    updated_at: transfer.updated_at,
                });
            }
        }
        for id in running.trash_moves {
            let operation = catalog.storage_operation(id).await?;
            let moved = catalog.trash_move(id).await?;
            if operation.state == StorageOperationState::Running && !moved.settled {
                work.push(RunningWork::TrashMove {
                    operation_id: operation.id,
                    offer: moved.offer,
                    project_id: moved.project_id,
                    items: count(moved.items.len()),
                    updated_at: operation.updated_at,
                });
            }
        }
        for id in running.operations {
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
        Ok(())
    }
}

/// Calibration waits on the user once the run reached Calibrate: before that
/// the Calibrate step has not run its automatic match.
const fn reached_calibrate(stage: RunStage) -> bool {
    !matches!(stage, RunStage::Select | RunStage::Review)
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

/// The Project's candidates that are a member of none of its runs, each
/// offered the open runs on its subject and rig (a panel run through its run
/// group), else a new run.
fn ready_to_add_sessions(reads: &ProjectReads, members: &[ProjectMember]) -> Vec<ReadyToAdd> {
    let project_id = reads.project.id;
    let members: BTreeSet<Uuid> = members.iter().map(|member| member.session_id).collect();
    reads
        .candidates
        .iter()
        .filter(|candidate| !members.contains(&candidate.session_id))
        .map(|candidate| {
            let mut actions = Vec::new();
            let open = reads.runs.iter().filter(|run| {
                run.subject_id == candidate.subject_id
                    && run.rig_id == candidate.rig_id
                    && run.completion == RunCompletion::Open
            });
            for run in open {
                let action = match run.group_id {
                    Some(group_id) => SessionAction::AddToRunGroup { group_id },
                    None => SessionAction::AddToRun { view_id: run.id },
                };
                if !actions.contains(&action) {
                    actions.push(action);
                }
            }
            if actions.is_empty() {
                actions.push(SessionAction::StartRun {
                    project_id,
                    subject_id: candidate.subject_id,
                    rig_id: candidate.rig_id,
                });
            }
            ReadyToAdd { project_id, candidate: candidate.clone(), actions }
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
