// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project state (spec 065 PRJ-FR-14, PRJ-AC-21, PRJ-AC-22, PRJ-AC-27; D-W26,
//! D-W46, D-W48, D-W69, D-W72). Only the user marks a Project Done, and Mark
//! Done is refused while any run outside the Project's Trash is not Complete,
//! naming each. Reopen returns a Done Project to open, moving no file and
//! leaving its runs, goals and members as they were. Done Projects are listed
//! only when "Show done" is on.
#![cfg(unix)]

#[path = "support/project_state.rs"]
mod project_state_support;
mod support;

use persistence_library::Catalog;
use platevault_model::{
    MeasurementMethod, ProjectQuery, ProjectState, RunCompletion, RunStage, ViewQuery,
};
use project_state_support::{ha_frames, world, World};
use support::{kind, tree};
use uuid::Uuid;

async fn listed(catalog: &Catalog, show_done: bool, target_id: Option<Uuid>) -> Vec<Uuid> {
    let query = ProjectQuery { show_done, target_id, ..ProjectQuery::default() };
    catalog.list_projects(&query).await.unwrap().into_iter().map(|summary| summary.id).collect()
}

async fn runs(world: &World, project: Uuid) -> Vec<platevault_model::ViewListing> {
    let query = ViewQuery { project_id: Some(project), ..ViewQuery::default() };
    world.catalog.list_views(&query).await.unwrap()
}

/// PRJ-FR-14, PRJ-AC-21: Mark Done names each run outside the Trash that is not
/// Complete, with its stage, and the Project stays open until each is completed
/// or moved to the Trash. A Complete run and a run already in the Trash are
/// never named.
#[tokio::test]
async fn mark_done_names_non_complete_runs_and_refuses() {
    let world = world().await;
    let project = world.project("NGC 7000 Ha", Vec::new()).await;
    let complete = world.run(&project, "Finished", RunStage::Results).await;
    world.complete(complete).await;
    let trashed = world.run(&project, "Abandoned", RunStage::Review).await;
    world.trash(trashed).await;
    let preparing = world.run(&project, "Preparing", RunStage::Prepare).await;
    let selecting = world.run(&project, "Selecting", RunStage::Select).await;

    let refused = world.catalog.mark_project_done(project.id, project.revision).await.unwrap_err();
    assert_eq!(kind(&refused), "invalid_input", "{refused}");
    let message = refused.to_string();
    for named in [
        format!("'Preparing' ({preparing}) at Prepare"),
        format!("'Selecting' ({selecting}) at Select"),
    ] {
        assert!(message.contains(&named), "{named} missing from: {message}");
    }
    assert!(message.contains("complete it or move it to the Trash"), "{message}");
    for silent in ["Finished", "Abandoned"] {
        assert!(!message.contains(silent), "{silent} named in: {message}");
    }
    let unchanged = world.catalog.project(project.id).await.unwrap();
    assert_eq!(unchanged, project, "a refused Mark Done changes nothing");

    world.complete(preparing).await;
    let refused = world.catalog.mark_project_done(project.id, project.revision).await.unwrap_err();
    let message = refused.to_string();
    assert!(message.contains(&selecting.to_string()), "{message}");
    assert!(!message.contains("Preparing"), "a completed run is no longer named: {message}");
    assert_eq!(world.catalog.project(project.id).await.unwrap().state, ProjectState::Open);

    world.trash(selecting).await;
    let done = world.catalog.mark_project_done(project.id, project.revision).await.unwrap();
    assert_eq!(done.state, ProjectState::Done);
    assert!(done.done_at.is_some());
    assert_eq!(done.revision, project.revision + 1);
    assert_eq!(world.catalog.project(project.id).await.unwrap(), done);

    let again = world.catalog.mark_project_done(project.id, done.revision).await.unwrap_err();
    assert_eq!(kind(&again), "invalid_input", "a Done Project is not marked Done twice");
    let stale = world.catalog.mark_project_done(project.id, project.revision).await.unwrap_err();
    assert_eq!(kind(&stale), "conflict", "{stale}");
    world.catalog.close().await.unwrap();
}

/// PRJ-AC-21, PRJ-AC-27: Reopen moves no file and returns the Done Project to
/// open with its subjects, rigs, goals, runs and members unchanged.
#[tokio::test]
async fn reopen_restores_open_with_runs_goals_members() {
    let world = world().await;
    let ngc = world.ngc.candidate.id;
    let project = world.project("NGC 7000 Ha", vec![ha_frames(ngc, 2)]).await;
    let finished = world.run(&project, "Finished", RunStage::Results).await;
    world.complete(finished).await;
    let trashed = world.run(&project, "Abandoned", RunStage::Select).await;
    world.trash(trashed).await;

    let refused = world.catalog.reopen_project(project.id, project.revision).await.unwrap_err();
    assert_eq!(kind(&refused), "invalid_input", "an open Project is not reopened");

    let done = world.catalog.mark_project_done(project.id, project.revision).await.unwrap();
    let files = tree(&world.fx.root);
    let views = runs(&world, project.id).await;
    let members = world.catalog.project_members(project.id).await.unwrap();
    let in_trash = world.catalog.trashed_views(project.id).await.unwrap();
    assert_eq!(
        (members.len(), members[0].view_ids.as_slice()),
        (1, [finished].as_slice()),
        "the Ha session is a member of the Complete run only"
    );

    let open = world.catalog.reopen_project(project.id, done.revision).await.unwrap();
    assert_eq!(open.state, ProjectState::Open);
    assert_eq!(open.done_at, None);
    assert_eq!(open.revision, done.revision + 1);
    assert_eq!(
        (&open.name, &open.notes, &open.subjects, &open.rig_ids, &open.goals),
        (&project.name, &project.notes, &project.subjects, &project.rig_ids, &project.goals),
        "subjects, rigs and goals are unchanged"
    );
    assert_eq!(world.catalog.project(project.id).await.unwrap(), open);
    assert_eq!(runs(&world, project.id).await, views, "runs keep their stage and completion");
    assert_eq!(views[0].completion, RunCompletion::Complete, "the run stays Complete");
    assert_eq!(world.catalog.project_members(project.id).await.unwrap(), members);
    assert_eq!(world.catalog.trashed_views(project.id).await.unwrap(), in_trash);
    assert_eq!(tree(&world.fx.root), files, "Reopen moves no file");

    let stale = world.catalog.reopen_project(project.id, done.revision).await.unwrap_err();
    assert_eq!(kind(&stale), "conflict", "{stale}");
    world.catalog.close().await.unwrap();
}

/// PRJ-AC-22, D-W48: the list holds only open Projects until "Show done" is on,
/// with or without a subject filter; a reopened Project is listed again.
#[tokio::test]
async fn done_projects_hidden_unless_show_done() {
    let world = world().await;
    let open = world.project("A open", Vec::new()).await;
    let finished = world.project("B finished", Vec::new()).await;
    let done = world.catalog.mark_project_done(finished.id, finished.revision).await.unwrap();
    let ngc = Some(world.ngc.candidate.id);

    assert_eq!(listed(&world.catalog, false, None).await, vec![open.id]);
    assert_eq!(listed(&world.catalog, false, ngc).await, vec![open.id]);
    assert_eq!(listed(&world.catalog, true, None).await, vec![open.id, finished.id]);
    assert_eq!(listed(&world.catalog, true, ngc).await, vec![open.id, finished.id]);
    let shown = world
        .catalog
        .list_projects(&ProjectQuery { show_done: true, ..ProjectQuery::default() })
        .await
        .unwrap();
    assert_eq!(shown[1].state, ProjectState::Done);

    world.catalog.reopen_project(finished.id, done.revision).await.unwrap();
    assert_eq!(listed(&world.catalog, false, None).await, vec![open.id, finished.id]);
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-14: only the user marks a Project Done. Every goal met, by a run that
/// is itself Complete, leaves the Project open and listed.
#[tokio::test]
async fn goals_met_never_mark_done() {
    let world = world().await;
    let ngc = world.ngc.candidate.id;
    let project = world.project("NGC 7000 Ha", vec![ha_frames(ngc, 2)]).await;
    let run = world.run(&project, "Finished", RunStage::Results).await;
    let method = MeasurementMethod::new("platevault.stars", 1);
    let progress = world.catalog.project_progress_basis(project.id, &method).await.unwrap();
    assert!(progress.goals.iter().all(|goal| goal.met), "{progress:#?}");
    assert_eq!(world.catalog.project(project.id).await.unwrap().state, ProjectState::Open);

    world.complete(run).await;
    let progress = world.catalog.project_progress_basis(project.id, &method).await.unwrap();
    assert!(progress.goals.iter().all(|goal| goal.met), "{progress:#?}");
    let current = world.catalog.project(project.id).await.unwrap();
    assert_eq!((current.state, current.done_at.as_deref()), (ProjectState::Open, None));
    assert_eq!(current.revision, project.revision, "nothing wrote the Project");
    assert_eq!(listed(&world.catalog, false, None).await, vec![project.id]);

    let done = world.catalog.mark_project_done(project.id, current.revision).await.unwrap();
    assert_eq!(done.state, ProjectState::Done, "the user's Mark Done is the only way to Done");
    world.catalog.close().await.unwrap();
}
