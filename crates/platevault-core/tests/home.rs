// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home (spec 065 PRJ-FR-17/18/19, PRJ-AC-18/19/20/22/23, PV-PRJ-SC-05, root
//! FR-020, LIB-AC-09 backend) on the composed library over real files, with
//! no account and no network: the six sections in order, the top line equal
//! to the Sessions filters, each F4 Next rule as the first that applies, open
//! Projects only, and the running work of every kind. Projects hold sessions
//! through the membership writer or the Apply world; a suggestion holds
//! nothing.

#[path = "support/apply.rs"]
mod apply_support;
#[path = "support/cleanup.rs"]
mod cleanup_support;
#[path = "support/home.rs"]
mod home_support;
#[path = "support/membership.rs"]
mod membership_support;
#[path = "support/scan.rs"]
mod scan_support;
mod support;

use std::sync::atomic::Ordering;

use apply_support::{world, Recorder, World, DARKS, HA, HA_GAIN_0};
use cleanup_support::ScopedTrash;
use home_support::{
    default_site, ha_goal, indexed, quiet, running_import, running_project_operation,
    running_storage, target, tonight,
};
use platevault_core::apply::Unattended;
use platevault_core::home::HomeDashboard;
use platevault_core::library::Library;
use persistence_library::{SessionFilter, SessionQuery};
use platevault_core::*;
use uuid::Uuid;

async fn dashboard(library: &Library) -> HomeDashboard {
    library.home_dashboard(&tonight()).await.unwrap()
}

/// The Apply world's one Project on Home.
async fn home_project(world: &World) -> HomeProject {
    let mut home = dashboard(&world.library).await;
    assert_eq!(home.projects.len(), 1, "{:#?}", home.projects);
    let project = home.projects.remove(0);
    let listed = world.library.project_list(&ProjectQuery::default()).await.unwrap();
    let [summary] = listed.as_slice() else { panic!("one Project summary: {listed:#?}") };
    assert_eq!(summary.next_step.as_ref(), Some(&project.next));
    assert_eq!(summary.pending_changes, project.pending_changes);
    project
}

/// Each key's first position in `json`, which must increase.
fn in_order(json: &str, keys: &[&str]) {
    let positions: Vec<usize> = keys
        .iter()
        .map(|key| json.find(&format!("\"{key}\"")).unwrap_or_else(|| panic!("no {key}")))
        .collect();
    assert!(positions.is_sorted(), "{keys:?} out of order at {positions:?}");
}

/// PRJ-AC-18, PRJ-FR-17, root FR-020, LIB-AC-09: with indexed sessions and
/// two Projects, Home opens offline with the top line and six sections in
/// order; the new-sessions section has its four groups in order and every row
/// has a one-click action. A session an open Project suggests opens that
/// Project's suggestions (PRJ-FR-19).
#[tokio::test]
async fn six_sections_in_order() {
    let indexed = indexed().await;
    let home = dashboard(&indexed.library).await;
    let json = serde_json::to_string(&home).unwrap();
    in_order(
        &json,
        &[
            "topLine",
            "actions",
            "projects",
            "newSessions",
            "tonight",
            "targetStatus",
            "runningWork",
        ],
    );
    assert_eq!(home.actions, HomeAction::ALL);
    let names: Vec<&str> = home.projects.iter().map(|p| p.project.name.as_str()).collect();
    assert_eq!(names, ["Andromeda", "Summer nebulae"]);
    let groups = serde_json::to_string(&home.new_sessions).unwrap();
    in_order(&groups, &["needsTarget", "notInProject", "unreviewed", "readyToAdd"]);
    let sessions = &home.new_sessions;
    assert_eq!(sessions.needs_target.len(), 3);
    assert_eq!(sessions.not_in_project.len(), 4);
    assert_eq!(sessions.unreviewed.len(), 1);
    assert_eq!(sessions.ready_to_add.len(), 1);
    assert!(sessions.needs_target.iter().all(|row| !row.actions.is_empty()));
    assert!(sessions.not_in_project.iter().all(|row| !row.actions.is_empty()));
    assert!(sessions.unreviewed.iter().all(|row| !row.actions.is_empty()));
    assert!(sessions.ready_to_add.iter().all(|row| !row.actions.is_empty()));
    assert_eq!(sessions.unreviewed[0].session_id, indexed.unreviewed);
    let [ready] = sessions.ready_to_add.as_slice() else { panic!("{sessions:#?}") };
    assert_eq!(ready.suggestion.session_id, indexed.suggested);
    assert!(ready.suggestion.blockers.is_empty(), "settled, so it can be added");
    assert_eq!(ready.actions, [SessionAction::OpenSuggestions { project_id: indexed.nebulae.id }]);
}

/// PRJ-AC-20, PRJ-FR-19: three sessions with no confirmed Target read "need a
/// Target", and the four confirmed sessions no Project holds (two of
/// another Target, an unreviewed candidate and a suggestion) read "not in
/// any Project", exactly the Sessions filters' counts and lists; each "not
/// in a Project" row offers Create Project and Add to Project.
#[tokio::test]
async fn top_line_counts_match_session_filters() {
    let indexed = indexed().await;
    let catalog = indexed.library.catalog();
    let counts = catalog.session_filter_counts().await.unwrap();
    let query =
        SessionQuery { filter: Some(SessionFilter::NeedsCalibration), ..SessionQuery::default() };
    let needs_calibration = catalog.list_sessions(&query).await.unwrap().len() as u64;
    assert!(needs_calibration > 0, "no calibration was ingested, so sessions wait for it");
    assert_eq!(
        counts,
        SessionFilterCounts { needs_target: 3, not_in_any_project: 4, needs_calibration }
    );
    let home = dashboard(&indexed.library).await;
    assert_eq!(home.top_line, counts);
    for (filter, rows, expected) in [
        (SessionFilter::NeedsTarget, &home.new_sessions.needs_target, &indexed.needs_target),
        (
            SessionFilter::NotInAnyProject,
            &home.new_sessions.not_in_project,
            &indexed.not_in_project,
        ),
    ] {
        let query = SessionQuery { filter: Some(filter), ..SessionQuery::default() };
        let listed: Vec<Uuid> = catalog
            .list_sessions(&query)
            .await
            .unwrap()
            .into_iter()
            .map(|summary| summary.session.id)
            .collect();
        let shown: Vec<Uuid> = rows.iter().map(|row| row.session.session.id).collect();
        assert_eq!(shown, listed, "{filter:?}");
        let mut sorted = shown.clone();
        sorted.sort();
        let mut want = expected.clone();
        want.sort();
        assert_eq!(sorted, want, "{filter:?}");
        assert!(!shown.contains(&indexed.held), "a held session is in a Project");
    }
    assert!(home
        .new_sessions
        .needs_target
        .iter()
        .all(|row| row.actions == [SessionAction::ChooseTarget]));
    assert!(home
        .new_sessions
        .not_in_project
        .iter()
        .all(|row| row.actions == [SessionAction::CreateProject, SessionAction::AddToProject]));
}

/// PRJ-AC-19, PRJ-FR-18 rule 1: a candidate session with Unreviewed frames
/// wins over every later rule: "Review N new frames", opening frame review
/// on the candidates filtered to Unreviewed. A Project with no candidate,
/// nothing pending and no View reads "Add sessions" (rule 4).
#[tokio::test]
async fn next_rule1_review_new_frames_and_rule4_add_sessions() {
    let indexed = indexed().await;
    let home = dashboard(&indexed.library).await;
    let next: Vec<(&str, &NextAction)> =
        home.projects.iter().map(|p| (p.project.name.as_str(), &p.next)).collect();
    assert_eq!(
        next,
        [
            ("Andromeda", &NextAction::AddSessions),
            (
                "Summer nebulae",
                &NextAction::ReviewNewFrames {
                    frames: 1,
                    context: ReviewContext::ProjectCandidates { project_id: indexed.nebulae.id },
                    filter: ReviewFilter::Unreviewed,
                }
            ),
        ]
    );
    let listed = indexed.library.project_list(&ProjectQuery::default()).await.unwrap();
    for home in &home.projects {
        let summary = listed.iter().find(|summary| summary.id == home.project.id).unwrap();
        assert_eq!(summary.next_step.as_ref(), Some(&home.next));
        assert_eq!(summary.pending_changes, home.pending_changes);
    }
}

/// PRJ-FR-18 rule 2 (provisional, spec 065 PRJ-FR-18), PRJ-AC-23: a
/// suggestion whose calibration isn't settled keeps the Project waiting at
/// Sessions ("Choose its flats first"), before the Apply that was canceled,
/// which alone opens the View step.
#[tokio::test]
async fn next_rule2_waits_on_calibration_then_an_unfinished_apply() {
    let world = world(ViewMode::Copies).await;
    let canceled = Recorder::default();
    canceled.cancel.store(true, Ordering::SeqCst);
    let preview = world.preview().await;
    let report = world.library.apply(&World::request(&preview), &canceled).await.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Canceled));
    let unfinished = ProjectWait::ApplyNotFinished {
        operation_id: report.operation_id,
        outcome: ApplyOutcome::Canceled,
    };
    quiet(&world).await;
    assert_eq!(
        home_project(&world).await.next,
        NextAction::WaitsOnUser { step: ProjectStep::View, waits: vec![unfinished] }
    );

    let suggested = world.session_of(&world.captures, HA_GAIN_0).await;
    world.catalog().finish_session_review(suggested.id, suggested.grouping_revision).await.unwrap();
    let home = dashboard(&world.library).await;
    let [ready] = home.new_sessions.ready_to_add.as_slice() else {
        panic!("{:#?}", home.new_sessions)
    };
    assert_eq!(ready.suggestion.session_id, suggested.id);
    assert!(
        ready
            .suggestion
            .blockers
            .iter()
            .any(|blocker| matches!(blocker, AdmissionBlocker::CalibrationUnsettled { .. })),
        "{:#?}",
        ready.suggestion.blockers
    );
    assert_eq!(
        home.projects[0].next,
        NextAction::WaitsOnUser {
            step: ProjectStep::Sessions,
            waits: vec![
                ProjectWait::SuggestionNeedsCalibration { session_id: suggested.id },
                unfinished,
            ],
        }
    );
    let listed = world.library.project_list(&ProjectQuery::default()).await.unwrap();
    let summary = listed.iter().find(|summary| summary.id == world.project).unwrap();
    assert_eq!(summary.next_step, Some(home.projects[0].next.clone()));
    assert_eq!(summary.pending_changes, home.projects[0].pending_changes);
}

/// PRJ-FR-18 rule 4 and rule 2, D-W110: before the first Apply a Project has
/// no View and no pending change ("Add sessions"); once the View exists and
/// nothing is pending it reads "Open in {app}", and a mode switch reads
/// "Apply N changes". A leftover in `View (previous)/` the user hasn't
/// reviewed then keeps the Project waiting at the View step.
#[tokio::test]
async fn rule4_add_open_or_apply_then_rule2_previous_view_holds() {
    let world = world(ViewMode::Symlinks).await;
    quiet(&world).await;
    let project = home_project(&world).await;
    assert_eq!((project.pending_changes, project.next), (0, NextAction::AddSessions));
    world.apply().await;
    let project = home_project(&world).await;
    assert_eq!((project.pending_changes, project.next), (0, NextAction::OpenView));

    // A regular file where a dark's link was stays behind when the View
    // switches to copies.
    let tree = World::tree(&world.view());
    let replaced =
        tree.iter().find(|path| std::path::Path::new(path.as_str()).starts_with("Darks")).unwrap();
    std::fs::remove_file(world.view().join(replaced)).unwrap();
    std::fs::write(world.view().join(replaced), DARKS[0]).unwrap();
    world
        .sql(
            "UPDATE projects SET view_mode = 'copies' WHERE id = ?1",
            &[&world.project.to_string()],
        )
        .await;
    world.bump().await;
    let project = home_project(&world).await;
    assert!(project.pending_changes > 0, "the mode switch is pending");
    assert_eq!(project.next, NextAction::ApplyChanges { changes: project.pending_changes });
    assert_eq!(world.apply().await.leftovers.len(), 1);

    assert_eq!(
        home_project(&world).await.next,
        NextAction::WaitsOnUser {
            step: ProjectStep::View,
            waits: vec![ProjectWait::PreviousViewHolds { files: 1 }],
        }
    );
}

/// PRJ-FR-18 rule 3: nothing to review or wait on, a goal unmet in project
/// and a window tonight for its subject: "Plan tonight". Without a window,
/// rule 4 applies.
#[tokio::test]
async fn next_rule3_plan_tonight_when_goal_unmet_and_window() {
    let world = world(ViewMode::Symlinks).await;
    quiet(&world).await;
    world.apply().await;
    ha_goal(&world, 50).await;
    assert_eq!(home_project(&world).await.next, NextAction::OpenView, "no default site");

    default_site(&world.library).await;
    let home = dashboard(&world.library).await;
    let target = world.catalog().project(world.project).await.unwrap().subjects[0].target_id;
    let listed = world.library.project_list(&ProjectQuery::default()).await.unwrap();
    let summary = listed.iter().find(|summary| summary.id == world.project).unwrap();
    assert_eq!(summary.next_step, Some(home.projects[0].next.clone()));
    assert_eq!(summary.pending_changes, home.projects[0].pending_changes);
    let [status] = home.target_status.as_slice() else { panic!("{:#?}", home.target_status) };
    assert_eq!(status.target_id, target);
    assert_eq!(status.goals[0].still_needed, GoalShortfall::FrameCount { frames: 48 });
}

/// Where the Apply world's Project counts goals: the goal ids of its
/// progress, of its Home entry and of Home's Target status (sorted), and the
/// Targets its Next figure plans tonight.
async fn counted_goals(world: &World) -> (Vec<Uuid>, Vec<Uuid>, Vec<Uuid>, NextAction) {
    let progress = world.library.project_progress(world.project).await.unwrap();
    let home = home_project(world).await;
    let ids = |goals: &[GoalProgress]| goals.iter().map(|goal| goal.goal.id).collect();
    let mut unmet: Vec<Uuid> = dashboard(&world.library)
        .await
        .target_status
        .iter()
        .flat_map(|status| status.goals.iter().map(|unmet| unmet.progress.goal.id))
        .collect();
    unmet.sort_unstable();
    (ids(&progress.goals), ids(&home.goals), unmet, home.next)
}

/// What [`counted_goals`] reads when exactly `goals` of `project` count and
/// Next plans `target_ids` tonight.
fn counting(
    project: &Project,
    target_ids: Vec<Uuid>,
) -> (Vec<Uuid>, Vec<Uuid>, Vec<Uuid>, NextAction) {
    let ids: Vec<Uuid> = project.goals.iter().map(|goal| goal.id).collect();
    let mut unmet = ids.clone();
    unmet.sort_unstable();
    (ids.clone(), ids, unmet, NextAction::PlanTonight { target_ids })
}

/// D-W128, PRJ-FR-02/03/18: a removed subject's goals are hidden and count
/// nowhere: not in Project progress, Home's open Projects and Target status,
/// or the Next figure. Adding the subject back restores the same goals.
#[tokio::test]
async fn a_removed_subjects_goals_count_nowhere_until_it_is_added_back() {
    let world = world(ViewMode::Symlinks).await;
    quiet(&world).await;
    world.apply().await;
    default_site(&world.library).await;
    let catalog = world.catalog();
    let ic = catalog.save_target(&target("IC 1396", 324.74, 57.5), None).await.unwrap();
    let ic = ic.candidate.id;
    let project = catalog.project(world.project).await.unwrap();
    let ngc = project.subjects[0].target_id;
    let both = [ngc, ic].map(|target_id| SubjectInput { target_id, name: None });
    let project = catalog.set_project_subjects(project.id, project.revision, &both).await.unwrap();
    let goals = [ngc, ic].map(|target_id| GoalInput {
        target_id,
        group_id: None,
        goal: GoalSpec::FrameCount { channel: Some("Ha".into()), goal_frames: 50 },
    });
    let project = catalog.set_project_goals(project.id, project.revision, &goals).await.unwrap();
    let shown = counting(&project, vec![ngc, ic]);
    assert_eq!(counted_goals(&world).await, shown, "both subjects' goals count");

    let only_ngc = [SubjectInput { target_id: ngc, name: None }];
    let hidden =
        catalog.set_project_subjects(project.id, project.revision, &only_ngc).await.unwrap();
    assert_eq!(hidden.goals, project.goals[..1], "the removed subject's goal does not show");
    assert_eq!(counted_goals(&world).await, counting(&hidden, vec![ngc]), "nor counts");

    let restored = catalog.set_project_subjects(project.id, hidden.revision, &both).await.unwrap();
    let ic_goal = (project.goals[1].id, &project.goals[1].goal);
    let back = restored.goals.get(1).map(|goal| (goal.id, &goal.goal));
    assert_eq!(back, Some(ic_goal), "the same goal returns");
    assert_eq!(counted_goals(&world).await, shown, "the restored goal counts again");
}

/// The Projects list reuses the Home rule order for every Next action, and locked Projects carry neither field.
#[tokio::test]
async fn project_list_matches_home_next_rules_and_clears_closed_rows() {
    let indexed = indexed().await;
    let listed = indexed.library.project_list(&ProjectQuery::default()).await.unwrap();
    let open = listed.iter().map(|summary| (summary.name.as_str(), summary.next_step.as_ref().unwrap())).collect::<Vec<_>>();
    assert_eq!(open, [
        ("Andromeda", &NextAction::AddSessions),
        ("Summer nebulae", &NextAction::ReviewNewFrames {
            frames: 1,
            context: ReviewContext::ProjectCandidates { project_id: indexed.nebulae.id },
            filter: ReviewFilter::Unreviewed,
        }),
    ]);
    assert!(listed.iter().all(|summary| summary.pending_changes == 0));

    let world = world(ViewMode::Symlinks).await;
    quiet(&world).await;
    let listed = world.library.project_list(&ProjectQuery::default()).await.unwrap();
    assert_eq!(listed[0].next_step, Some(NextAction::AddSessions));
    world.apply().await;
    let listed = world.library.project_list(&ProjectQuery::default()).await.unwrap();
    assert_eq!(listed[0].next_step, Some(NextAction::OpenView));

    world.sql("UPDATE projects SET view_mode = 'copies' WHERE id = ?1", &[&world.project.to_string()]).await;
    world.bump().await;
    let listed = world.library.project_list(&ProjectQuery::default()).await.unwrap();
    let pending = listed[0].pending_changes;
    assert!(pending > 0);
    assert_eq!(listed[0].next_step, Some(NextAction::ApplyChanges { changes: pending }));

}
/// PRJ-AC-22: Home lists open Projects only; a Closed one leaves the list.
#[tokio::test]
async fn closed_projects_are_not_listed() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    assert_eq!(dashboard(&world.library).await.projects.len(), 1);
    let trash = ScopedTrash::new(&world.temp.path().join("bin"));
    let review = world.library.clean_up_review(world.project).await.unwrap();
    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected: Vec::new(),
    };
    world.library.clean_up(&request, trash.dyn_trash()).await.unwrap();
    let review = world.library.trash_review(world.project, trash.dyn_trash()).await.unwrap();
    let request =
        TrashRequest { project_id: world.project, digest: review.digest, ticked: Vec::new() };
    world.library.wrap_up_trash(&request, trash.dyn_trash()).await.unwrap();
    let desired_revision =
        world.library.wrap_up_status(world.project).await.unwrap().desired_revision;
    let close = CloseRequest { project_id: world.project, desired_revision, archive: None };
    let report = world.library.close_project(&close, trash.dyn_trash(), &Unattended).await.unwrap();
    assert_eq!(report.lifecycle, ProjectLifecycle::Closed);
    let listed = world.library.project_list(&ProjectQuery { include_closed: true, ..ProjectQuery::default() }).await.unwrap();
    let closed = listed.iter().find(|summary| summary.id == world.project).unwrap();
    assert_eq!(closed.lifecycle, ProjectLifecycle::Closed);
    assert_eq!(closed.next_step, None);
    assert_eq!(closed.pending_changes, 0);

    assert_eq!(dashboard(&world.library).await.projects, []);
}

/// PRJ-FR-17 section 6: a Running scan, measurement run, import, a
/// Project's operation and a storage operation are each listed once, in that
/// order; the Project's operation carries its Project's name.
#[tokio::test]
async fn running_work_lists_scan_measurement_import_project_storage() {
    let world = world(ViewMode::Symlinks).await;
    let catalog = world.catalog();
    let scan = catalog.begin_scan(world.calibration.id, None).await.unwrap();
    let asset = world.asset_at(&world.captures, HA[0]).await;
    let method = MeasurementMethod::new("fixture", 1);
    let measurement = catalog.begin_measurement_run(&method, &[asset.id], 0).await.unwrap();
    let import = running_import(&world).await;
    assert_eq!(import.state, ImportState::Running);
    let operation = running_project_operation(&world).await;
    let storage = running_storage(&world).await;

    let home = dashboard(&world.library).await;

    let listed: Vec<(&str, Uuid)> = home
        .running_work
        .iter()
        .map(|work| match work {
            RunningWork::Scan { operation_id, .. } => ("scan", *operation_id),
            RunningWork::Measurement { operation_id, .. } => ("measurement", *operation_id),
            RunningWork::Import { import_id, .. } => ("import", *import_id),
            RunningWork::Project { operation, .. } => ("project", operation.id),
            RunningWork::Storage { operation_id, .. } => ("storage", *operation_id),
        })
        .collect();
    assert_eq!(
        listed,
        [
            ("scan", scan.id),
            ("measurement", measurement.operation_id),
            ("import", import.id),
            ("project", operation),
            ("storage", storage.id),
        ]
    );
    let Some(RunningWork::Project { operation, project_name }) =
        home.running_work.iter().find(|work| matches!(work, RunningWork::Project { .. }))
    else {
        unreachable!()
    };
    assert_eq!(
        (operation.kind, project_name.as_str()),
        (ProjectOperationKind::CopyToOutput, apply_support::PROJECT)
    );
}
