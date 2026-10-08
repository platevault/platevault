// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home (spec 065 PRJ-FR-17/18/19, PRJ-AC-18/19/20/22/23, PV-PRJ-SC-05, root
//! FR-020, LIB-AC-09 backend) on the composed library over real files, with
//! no account and no network: the six sections in order, the top line equal
//! to the Sessions filters, each Next rule as the first that applies, a
//! trashed run never blocked, Done Projects only under "Show done", and the
//! running work of every kind.
#![cfg(unix)]

#[path = "support/prepare_group.rs"]
mod group_support;
#[path = "support/home.rs"]
mod home_support;
#[path = "support/prepare.rs"]
mod prepare_support;
mod support;

use home_support::{
    captures_offline, default_site, failed_preparation, ha_goal, indexed, project, review_all,
    running_import, running_preparation, running_storage, tonight, unmatched_run,
};
use persistence_library::{SessionFilter, SessionQuery};
use platevault_core::home::HomeDashboard;
use platevault_core::*;
use prepare_support::{world, World};
use uuid::Uuid;

async fn dashboard(library: &platevault_core::library::Library, show_done: bool) -> HomeDashboard {
    library.home_dashboard(show_done, &tonight()).await.unwrap()
}

async fn next(world: &World) -> NextAction {
    let mut home = dashboard(&world.library, false).await;
    assert_eq!(home.projects.len(), 1);
    home.projects.remove(0).next
}

/// Each key's first position in `json`, which must increase.
fn in_order(json: &str, keys: &[&str]) {
    let positions: Vec<usize> = keys
        .iter()
        .map(|key| json.find(&format!("\"{key}\":")).unwrap_or_else(|| panic!("no {key}")))
        .collect();
    assert!(positions.is_sorted(), "{keys:?} out of order at {positions:?}");
}

/// PRJ-AC-18, PRJ-FR-17, root FR-020, LIB-AC-09: with indexed sessions and
/// two Projects, Home opens offline with the top line and six sections in
/// order; the new-sessions section has its four groups in order and every row
/// has a one-click action.
#[tokio::test]
async fn six_sections_in_order() {
    let indexed = indexed().await;
    let home = dashboard(&indexed.library, false).await;
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
    assert_eq!(sessions.not_in_project.len(), 2);
    assert_eq!(sessions.unreviewed.len(), 1);
    assert_eq!(sessions.ready_to_add.len(), 1);
    assert!(sessions.needs_target.iter().all(|row| !row.actions.is_empty()));
    assert!(sessions.not_in_project.iter().all(|row| !row.actions.is_empty()));
    assert!(sessions.unreviewed.iter().all(|row| !row.actions.is_empty()));
    assert!(sessions.ready_to_add.iter().all(|row| !row.actions.is_empty()));
    assert_eq!(sessions.unreviewed[0].session_id, indexed.candidate);
    assert_eq!(
        sessions.ready_to_add[0].actions,
        [SessionAction::StartRun {
            project_id: indexed.nebulae.id,
            subject_id: indexed.nebulae.subjects[0].id,
            rig_id: indexed.nebulae.rig_ids[0],
        }]
    );
}

/// PRJ-AC-20, PRJ-FR-19: three sessions with no confirmed Target and two
/// confirmed sessions in no Project read "3 sessions need a Target · 2 not in
/// any Project", exactly the Sessions filters' counts and lists; each "not in
/// a Project" row offers Create Project and Add to Project.
#[tokio::test]
async fn top_line_counts_match_session_filters() {
    let indexed = indexed().await;
    let catalog = indexed.library.catalog();
    let counts = catalog.session_filter_counts().await.unwrap();
    assert_eq!(counts, SessionFilterCounts { needs_target: 3, not_in_any_project: 2 });
    let home = dashboard(&indexed.library, false).await;
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
        assert!(!shown.contains(&indexed.candidate), "a candidate is in a Project");
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

/// PRJ-AC-19, PRJ-FR-18 rule 1: Unreviewed candidate frames win over a
/// blocked run and an unmet goal with a window: "Review N new frames",
/// opening frame review on the candidates filtered to Unreviewed.
#[tokio::test]
async fn next_rule1_review_n_new_frames() {
    let world = world().await;
    default_site(&world.library).await;
    ha_goal(&world, 50).await;
    unmatched_run(&world, RunStage::Calibrate).await;
    let project = project(&world).await;
    let review = |frames| NextAction::ReviewNewFrames {
        frames,
        context: ReviewContext::ProjectCandidates { project_id: project.id },
        filter: ReviewFilter::Unreviewed,
    };
    assert_eq!(next(&world).await, review(4));
    let asset = home_support::light(&world, prepare_support::HA_LIGHTS[0]).await;
    let expected = ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint,
    };
    world
        .catalog()
        .set_quality(&[expected], Quality::Usable, platevault_core::library::InventoryProbe)
        .await
        .unwrap();
    assert_eq!(next(&world).await, review(3));
}

fn blocked(next: &NextAction) -> (Uuid, RunStage, Vec<RunBlocker>) {
    match next {
        NextAction::OpenBlockedRun { view_id, stage, blockers, .. } => {
            (*view_id, *stage, blockers.clone())
        }
        other => panic!("expected a blocked run, got {other:?}"),
    }
}

/// PRJ-AC-23, PRJ-FR-18 rule 2: with no Unreviewed candidate frames, a run
/// with unresolved inputs opens at Select, one whose calibration needs review
/// at Calibrate, and one whose preparation failed at Prepare.
#[tokio::test]
async fn next_rule2_blocked_run_unresolved_calibration_or_failed_prep() {
    let calibrate = world().await;
    review_all(&calibrate).await;
    let early = unmatched_run(&calibrate, RunStage::Review).await;
    assert!(calibrate.library.run_blockers(early).await.unwrap().is_empty(), "not at Calibrate");
    calibrate.catalog().set_view_stage(early, RunStage::Calibrate).await.unwrap();
    let (run, stage, blockers) = blocked(&next(&calibrate).await);
    assert_eq!((run, stage), (early, RunStage::Calibrate));
    assert!(
        matches!(blockers[..], [RunBlocker::CalibrationNeedsReview(b)] if b.view_id == early),
        "{blockers:?}"
    );

    let failed = world().await;
    review_all(&failed).await;
    let revision = failed_preparation(&failed).await;
    let (run, stage, blockers) = blocked(&next(&failed).await);
    assert_eq!((run, stage), (failed.run, RunStage::Prepare));
    assert!(
        matches!(blockers[..], [RunBlocker::PreparationFailed(b)]
            if b.preparation_id == revision.id && b.state == PreparationState::Failed),
        "{blockers:?}"
    );

    let offline = world().await;
    review_all(&offline).await;
    captures_offline(&offline).await;
    let (run, stage, blockers) = blocked(&next(&offline).await);
    assert_eq!((run, stage), (offline.run, RunStage::Select));
    assert_eq!(blockers, [RunBlocker::UnresolvedInputs { view_id: offline.run, members: 4 }]);
}

/// PRJ-FR-18 rule 2: a run in the Project's Trash is never blocked, and
/// Restore brings its blocker back.
#[tokio::test]
async fn trashed_run_never_blocked() {
    let world = world().await;
    review_all(&world).await;
    failed_preparation(&world).await;
    assert_eq!(blocked(&next(&world).await).0, world.run);
    world.library.move_view_to_trash(world.run).await.unwrap();
    assert!(world.library.run_blockers(world.run).await.unwrap().is_empty());
    assert_eq!(next(&world).await, NextAction::StartRun);
    world.catalog().restore_view(world.run).await.unwrap();
    assert_eq!(blocked(&next(&world).await).0, world.run);
}

/// PRJ-FR-18 rule 3: nothing to review or unblock, a goal unmet in project
/// and a window tonight for its subject: "Plan tonight".
#[tokio::test]
async fn next_rule3_plan_tonight_when_goal_unmet_and_window() {
    let world = world().await;
    review_all(&world).await;
    default_site(&world.library).await;
    ha_goal(&world, 50).await;
    let target = project(&world).await.subjects[0].target_id;
    let home = dashboard(&world.library, false).await;
    assert!(home.tonight.has_window(target));
    assert_eq!(home.projects[0].next, NextAction::PlanTonight { target_ids: vec![target] });
    let status = &home.target_status;
    assert_eq!(status.len(), 1);
    assert_eq!(status[0].target_id, target);
    assert_eq!(status[0].goals[0].still_needed, GoalShortfall::FrameCount { frames: 48 });
}

/// PRJ-FR-18 rule 4: with every goal met, or an unmet goal and no window
/// tonight, Next is "Start a processing run".
#[tokio::test]
async fn next_rule4_start_run() {
    let world = world().await;
    review_all(&world).await;
    ha_goal(&world, 50).await;
    let home = dashboard(&world.library, false).await;
    assert!(home.tonight.windows.is_empty(), "no default site");
    assert_eq!(home.projects[0].next, NextAction::StartRun);

    default_site(&world.library).await;
    ha_goal(&world, 2).await;
    let home = dashboard(&world.library, false).await;
    assert!(home.projects[0].goals.iter().all(|goal| goal.met), "{:?}", home.projects[0].goals);
    assert_eq!(home.projects[0].next, NextAction::StartRun);
    assert!(home.target_status.is_empty());
}

/// PRJ-AC-22: with one open and one Done Project, Home lists only the open
/// one until "Show done" is on.
#[tokio::test]
async fn done_hidden_unless_show_done() {
    let indexed = indexed().await;
    let galaxies = &indexed.galaxies;
    indexed.library.catalog().mark_project_done(galaxies.id, galaxies.revision).await.unwrap();
    let names = |home: &HomeDashboard| -> Vec<(String, ProjectState)> {
        home.projects.iter().map(|p| (p.project.name.clone(), p.project.state)).collect()
    };
    let open = dashboard(&indexed.library, false).await;
    assert_eq!(names(&open), [("Summer nebulae".to_owned(), ProjectState::Open)]);
    let all = dashboard(&indexed.library, true).await;
    assert_eq!(
        names(&all),
        [
            ("Andromeda".to_owned(), ProjectState::Done),
            ("Summer nebulae".to_owned(), ProjectState::Open)
        ]
    );
}

/// PRJ-FR-17 section 6: a Running scan, measurement run, preparation, import
/// and storage operation are each listed, in that order; one that ends
/// leaves the list.
#[tokio::test]
async fn running_work_lists_scan_measurement_prepare_import_storage() {
    let world = world().await;
    let catalog = world.catalog();
    let scan = catalog.begin_scan(world.calibration.id, None).await.unwrap();
    let asset = home_support::light(&world, prepare_support::HA_LIGHTS[0]).await;
    let method = MeasurementMethod::new("fixture", 1);
    let measurement = catalog.begin_measurement_run(&method, &[asset.id], 0).await.unwrap();
    let preparation = running_preparation(&world).await;
    let import = running_import(&world).await;
    assert_eq!(import.state, ImportState::Running);
    let storage = running_storage(&world).await;

    let listed = |home: &HomeDashboard| -> Vec<(&'static str, Uuid)> {
        home.running_work
            .iter()
            .map(|work| match work {
                RunningWork::Scan { operation_id, .. } => ("scan", *operation_id),
                RunningWork::Measurement { operation_id, .. } => ("measurement", *operation_id),
                RunningWork::Prepare { preparation_id, .. } => ("prepare", *preparation_id),
                RunningWork::PrepareAll { group_preparation_id, .. } => {
                    ("prepare_all", *group_preparation_id)
                }
                RunningWork::Import { import_id, .. } => ("import", *import_id),
                RunningWork::Storage { operation_id, .. } => ("storage", *operation_id),
            })
            .collect()
    };
    let home = dashboard(&world.library, false).await;
    assert_eq!(
        listed(&home),
        [
            ("scan", scan.id),
            ("measurement", measurement.operation_id),
            ("prepare", preparation.id),
            ("import", import.id),
            ("storage", storage.id),
        ]
    );
    catalog.finish_preparation(preparation.id, PreparationState::Canceled, None).await.unwrap();
    let home = dashboard(&world.library, false).await;
    assert!(!listed(&home).contains(&("prepare", preparation.id)));
    assert_eq!(listed(&home).len(), 4);
}

/// PRJ-FR-17 section 6, PREP-FR-12: a Running Prepare all is listed once,
/// never once per panel run, and leaves the list when it ends.
#[tokio::test]
async fn running_work_lists_prepare_all_once() {
    let world = group_support::group_world().await;
    let profile = world.wbpp("exit 0").await;
    let request = world.setup(&profile, InputMode::Copy).await;
    let input = world.running_input(&profile, &request).await;
    let running = world.catalog().start_group_preparation(&input).await.unwrap().preparation;
    assert_eq!(running.outcome, PreparationState::Running);

    let home = dashboard(&world.library, false).await;
    let [RunningWork::PrepareAll { group_preparation_id, group_id, number, folder, started_at }] =
        home.running_work.as_slice()
    else {
        panic!("one Prepare all and no panel run's own Prepare: {:#?}", home.running_work);
    };
    assert_eq!(*group_preparation_id, running.id);
    assert_eq!(*group_id, world.group);
    assert_eq!(*number, 1);
    assert_eq!(folder, &running.folder);
    assert_eq!(started_at, &running.started_at);
    world
        .catalog()
        .finish_group_preparation(running.id, PreparationState::Canceled, None)
        .await
        .unwrap();
    let home = dashboard(&world.library, false).await;
    assert!(home.running_work.is_empty(), "{:#?}", home.running_work);
}
