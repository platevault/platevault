// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A Project's lifecycle in the catalog (spec 065 PRJ-FR-14/25/30, PRJ-AC-15,
//! PRJ-AC-21, PRJ-AC-34, PRJ-AC-43; D-W80, D-W97, D-W112): Wrap up records
//! Clean up, Trash, then Archive, each once and in order, and Close takes the
//! Closed snapshot and locks the Project for good. Reaching every goal never
//! closes a Project, there is no Reopen, and Duplicate continues a Closed
//! Project as a new open one.
//!
//! Rewritten for the F4 Project model. The run-era tests
//! `mark_done_names_non_complete_runs_and_refuses`,
//! `reopen_restores_open_with_runs_goals_members` and
//! `done_projects_hidden_unless_show_done` asserted Mark Done over runs,
//! Reopen of a Done Project and the Done list; the decision record removed
//! all three (§2: "Remove runs as separate prepared folders", "[PROVISIONAL]
//! There is no Reopen"; §5 Removed: "the Finish and Reopen gates on
//! preparation"), so they are deleted. `goals_met_never_mark_done` keeps its
//! behaviour as `goals_met_never_close_the_project`.
#![cfg(unix)]

#[path = "support/membership.rs"]
mod membership_support;
#[path = "support/project_state.rs"]
mod project_state_support;
mod support;

use persistence_library::{Catalog, ClosedProject};
use platevault_model::{
    Classification, DuplicateRequest, InputKind, MasterBasis, MasterEvidence, MasterOfferState,
    MeasurementMethod, NativePath, ProjectLifecycle, Quality, SettledPin, WrapUpBlocker,
    WrapUpOutcome, WrapUpStep,
};
use project_state_support::{ha_frames, world, World};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use std::collections::BTreeSet;
use support::{expected, expected_session, kind, target, DiskProbe};
use uuid::Uuid;

use serde_json::json;
fn method() -> MeasurementMethod {
    MeasurementMethod::new("platevault.stars", 1)
}

/// A Project on NGC 7000 and the `RedCat` with an Ha goal of 2 frames,
/// holding the fixture's one session.
async fn held(world: &World) -> (Uuid, Uuid) {
    let project = world.project("NGC 7000 Ha", vec![ha_frames(world.ngc.candidate.id, 2)]).await;
    let session = world.session().await.id;
    membership_support::hold(&world.catalog, project.id, session, world.redcat.id).await;
    (project.id, session)
}

async fn revision(catalog: &Catalog, project: Uuid) -> u64 {
    catalog.wrap_up_status(project).await.unwrap().desired_revision
}

/// Proceed through Clean up and Trash with nothing selected, then Close
/// project… with no archive.
async fn close(catalog: &Catalog, project: Uuid) -> ClosedProject {
    let revision = revision(catalog, project).await;
    for step in [WrapUpStep::CleanUp, WrapUpStep::Trash] {
        catalog.record_wrap_up_step(project, revision, step, WrapUpOutcome::Skipped).await.unwrap();
    }
    catalog.close_project(project, revision, &method(), &[]).await.unwrap()
}

/// PRJ-FR-14, PRJ-AC-15: only the user closes a Project. Every goal met
/// leaves it open, at the start of its Wrap up, with no snapshot.
#[tokio::test]
async fn goals_met_never_close_the_project() {
    let world = world().await;
    let catalog = &world.catalog;
    let (project, _) = held(&world).await;
    let before = revision(catalog, project).await;
    let progress = catalog.project_progress_basis(project, &method()).await.unwrap();
    assert!(progress.goals.iter().all(|goal| goal.met), "{progress:#?}");

    let status = catalog.wrap_up_status(project).await.unwrap();
    assert_eq!(status.lifecycle, ProjectLifecycle::Open);
    assert_eq!((status.blocker, status.current), (None, Some(WrapUpStep::CleanUp)));
    assert_eq!(status.records, Vec::<platevault_model::WrapUpRecord>::new());
    assert_eq!(status.desired_revision, before, "nothing wrote the Project");
    assert!(catalog.closed_snapshot(project).await.unwrap().is_none());

    let closed = close(catalog, project).await;
    assert_eq!(closed.lifecycle, ProjectLifecycle::Closed, "the user's Close is the only way");
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-25, PRJ-AC-34: Close records the snapshot of the basis and the
/// calibration each session used, and locks the Project for good. A later
/// Library rejection changes neither the snapshot nor its sessions, adds no
/// pending change, every edit is refused, and nothing reopens it.
#[tokio::test]
async fn close_locks_for_good_with_a_calibration_snapshot() {
    let world = world().await;
    let catalog = &world.catalog;
    let (project, session) = held(&world).await;
    let closed = close(catalog, project).await;

    assert_eq!(closed.lifecycle, ProjectLifecycle::Closed, "nothing was archived");
    let snapshot = catalog.closed_snapshot(project).await.unwrap().expect("Close took it");
    assert_eq!(snapshot, closed.snapshot);
    assert!(snapshot.never_applied(), "a Project never applied freezes its desired basis");
    let frozen = &snapshot.basis.groups[0].sessions[0];
    assert_eq!(frozen.session_id, session);
    assert_eq!(
        [&frozen.calibration.dark, &frozen.calibration.flat, &frozen.calibration.bias],
        [&SettledPin::Declined; 3],
        "the No answers are recorded as the calibration used"
    );
    assert!(snapshot.goals.iter().all(|goal| goal.met), "goals freeze at Close");

    let assets = catalog.session(session).await.unwrap().assets;
    catalog.set_quality(&[expected(&assets[0])], Quality::Unusable, DiskProbe).await.unwrap();
    assert_eq!(catalog.closed_snapshot(project).await.unwrap().unwrap(), snapshot);
    let pending = catalog.project_pending_changes(project).await.unwrap();
    assert_eq!(pending, Vec::<platevault_model::PendingChange>::new());

    let desired = catalog.project_desired(project).await.unwrap();
    let refused =
        catalog.remove_project_sessions(project, desired.revision, &[session]).await.unwrap_err();
    assert_eq!(kind(&refused), "invalid_input", "{refused}");
    assert_eq!(catalog.project_desired(project).await.unwrap().sessions.len(), 1);

    assert!(ProjectLifecycle::Closed.transition(ProjectLifecycle::Open).is_err(), "no Reopen");
    let reopen = catalog.reopen_wrap_up_step(project, WrapUpStep::CleanUp).await.unwrap_err();
    assert_eq!(kind(&reopen), "invalid_input", "{reopen}");
    let again = catalog.close_project(project, desired.revision, &method(), &[]).await.unwrap_err();
    assert_eq!(kind(&again), "invalid_input", "{again}");

    let status = catalog.wrap_up_status(project).await.unwrap();
    assert_eq!(
        status.blocker,
        Some(WrapUpBlocker::NotOpen { lifecycle: ProjectLifecycle::Closed })
    );
    assert_eq!(status.current, None, "the Wrap up tab is a read-only record");
    let steps: Vec<_> = status.records.iter().map(|record| (record.step, record.outcome)).collect();
    assert_eq!(
        steps,
        [
            (WrapUpStep::CleanUp, WrapUpOutcome::Skipped),
            (WrapUpStep::Trash, WrapUpOutcome::Skipped),
            (WrapUpStep::Archive, WrapUpOutcome::Skipped),
        ]
    );
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-14: Clean up, Trash, then Archive, each once; reopening a step
/// removes it and the later ones; nothing records while an operation runs
/// or at a stale revision.
#[tokio::test]
async fn wrap_up_runs_its_steps_in_order_and_reopens_back_to_front() {
    let world = world().await;
    let catalog = &world.catalog;
    let (project, _) = held(&world).await;
    let revision = revision(catalog, project).await;

    let early = catalog
        .record_wrap_up_step(project, revision, WrapUpStep::Trash, WrapUpOutcome::Skipped)
        .await
        .unwrap_err();
    assert_eq!(kind(&early), "invalid_input", "{early}");
    let stale = catalog
        .record_wrap_up_step(project, revision + 1, WrapUpStep::CleanUp, WrapUpOutcome::Skipped)
        .await
        .unwrap_err();
    assert_eq!(kind(&stale), "conflict", "{stale}");
    let closing = catalog.close_project(project, revision, &method(), &[]).await.unwrap_err();
    assert_eq!(kind(&closing), "invalid_input", "{closing}");

    let operation = catalog.begin_clean_up(project, revision).await.unwrap();
    let status = catalog.wrap_up_status(project).await.unwrap();
    assert_eq!(
        status.blocker,
        Some(WrapUpBlocker::OperationRunning {
            kind: platevault_model::ProjectOperationKind::CleanUp
        })
    );
    let busy = catalog
        .record_wrap_up_step(project, revision, WrapUpStep::CleanUp, WrapUpOutcome::Skipped)
        .await
        .unwrap_err();
    assert_eq!(kind(&busy), "invalid_input", "{busy}");
    let record = catalog.finish_clean_up(&operation, false).await.unwrap();
    assert_eq!(
        (record.outcome, record.operation_id),
        (WrapUpOutcome::Finished, Some(operation.id))
    );
    catalog
        .record_wrap_up_step(project, revision, WrapUpStep::Trash, WrapUpOutcome::Skipped)
        .await
        .unwrap();

    let reopened = catalog.reopen_wrap_up_step(project, WrapUpStep::CleanUp).await.unwrap();
    assert!(reopened.records.is_empty(), "Trash went with Clean up: {reopened:#?}");
    assert_eq!(reopened.current, Some(WrapUpStep::CleanUp));
    world.catalog.close().await.unwrap();
}

/// PRJ-FR-30, PRJ-AC-43: Duplicate of a Closed Project is a new open Project
/// with the same session in a copy of its group, on the Target it joined on
/// (not the one the Library confirms now), its goals and notes, no View and
/// no link; the original keeps its snapshot and sessions.
#[tokio::test]
async fn duplicate_continues_a_closed_project_with_its_joined_target() {
    let world = world().await;
    let catalog = &world.catalog;
    let (project, session) = held(&world).await;
    let renamed = catalog
        .update_project(project, revision(catalog, project).await, "NGC 7000 Ha", Some("season 1"))
        .await
        .unwrap();
    let joined = catalog.project_desired(project).await.unwrap().sessions[0].target_id;
    let closed = close(catalog, project).await;
    let other = catalog.save_target(&target("NGC 7000 East", "ngc 7000 east"), None).await.unwrap();
    let current = catalog.session(session).await.unwrap().summary.session;
    catalog.associate_target(&[expected_session(&current)], other.candidate.id).await.unwrap();

    let request = DuplicateRequest {
        project_id: project,
        name: "NGC 7000 Ha · 2".into(),
        sessions: vec![session],
        goals: true,
        notes: true,
        settings: true,
    };
    let duplicate = catalog.duplicate_project(&request).await.unwrap();

    assert_ne!(duplicate.id, project);
    assert_eq!(duplicate.notes.as_deref(), Some("season 1"));
    assert_eq!(duplicate.rig_ids, renamed.rig_ids);
    assert_eq!(duplicate.subjects[0].target_id, renamed.subjects[0].target_id);
    assert_eq!(
        duplicate.goals.iter().map(|goal| &goal.goal).collect::<Vec<_>>(),
        renamed.goals.iter().map(|goal| &goal.goal).collect::<Vec<_>>()
    );
    let copied = catalog.project_desired(duplicate.id).await.unwrap();
    let source = catalog.project_desired(project).await.unwrap();
    assert_eq!(copied.lifecycle, ProjectLifecycle::Open);
    assert_eq!(copied.groups.len(), 1);
    assert_ne!(copied.groups[0].id, source.groups[0].id, "fresh ids, no link");
    assert_eq!(
        (&copied.groups[0].name, copied.groups[0].rig_id),
        (&source.groups[0].name, source.groups[0].rig_id)
    );
    assert_eq!(copied.sessions[0].session_id, session);
    assert_eq!(copied.sessions[0].target_id, joined, "Duplicate copies the joined Target");
    assert_ne!(joined, other.candidate.id);
    assert_eq!(copied.captures.len(), source.captures.len());
    assert!(catalog.apply_inputs(duplicate.id).await.unwrap().installed.is_none(), "no View");

    assert_eq!(catalog.closed_snapshot(project).await.unwrap().unwrap(), closed.snapshot);
    assert_eq!(source.lifecycle, ProjectLifecycle::Closed);
    let stray = DuplicateRequest { sessions: vec![Uuid::new_v4()], ..request };
    let refused = catalog.duplicate_project(&stray).await.unwrap_err();
    assert_eq!(kind(&refused), "invalid_input", "{refused}");
    world.catalog.close().await.unwrap();
}

/// D-W124: Wrap up's archive naming uses an agreeing Suggested Target exactly
/// like a user-confirmed Target, but an alias without qualified geometry is ignored.
#[tokio::test]
async fn archive_assets_use_only_evidence_qualified_suggested_targets() {
    let world = world().await;
    let catalog = &world.catalog;
    let (_, session) = held(&world).await;
    let sessions = BTreeSet::from([session]);
    let archive_target = |assets: &[persistence_library::ArchiveAsset]| {
        assets.iter().find(|asset| asset.session_id == session).unwrap().target.clone()
    };

    let mut conn =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&world.fx.db))
            .await
            .unwrap();
    sqlx::query(
        "UPDATE associations SET state = 'suggested', evidence = ?1 \
         WHERE session_id = ?2 AND kind = 'target'",
    )
    .bind(json!([{"kind":"alias","normalized":"ngc 7000","agrees":true}]).to_string())
    .bind(session.to_string())
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();

    assert_eq!(archive_target(&catalog.archive_assets(&sessions).await.unwrap()), None);

    let mut conn =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&world.fx.db))
            .await
            .unwrap();
    sqlx::query(
        "UPDATE associations SET evidence = ?1 \
         WHERE session_id = ?2 AND kind = 'target'",
    )
    .bind(
        json!([
            {"kind":"alias","normalized":"ngc 7000","agrees":true},
            {"kind":"coordinates","ra_deg":314.75,"dec_deg":44.33,"qualified":true}
        ])
        .to_string(),
    )
    .bind(session.to_string())
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();

    assert_eq!(
        archive_target(&catalog.archive_assets(&sessions).await.unwrap()).as_deref(),
        Some("NGC 7000")
    );
    world.catalog.close().await.unwrap();
}
/// CAL-FR-06, RES-FR-07: the offer transaction independently refuses Hide and
/// Restore after its Project closes, even when callers bypass core's early gate.
#[tokio::test]
async fn closed_project_refuses_master_offer_catalog_operations() {
    let world = world().await;
    let project = world.project("NGC 7000 Ha", vec![ha_frames(world.ngc.candidate.id, 2)]).await;
    let path = NativePath::from_path(std::path::Path::new("WBPP/master/masterDark_300s.fit"));
    let sha256 = "a".repeat(64);
    let classification = Classification {
        kind: InputKind::Dark,
        master: Some(MasterEvidence {
            basis: MasterBasis::HeaderStackCount,
            stack_count: Some(30),
            detector: "test".into(),
        }),
    };
    let offer = world
        .catalog
        .offer_processing_master(project.id, &path, &sha256, &classification)
        .await
        .unwrap()
        .unwrap();
    close(&world.catalog, project.id).await;
    let hidden = world.catalog.dismiss_processing_master(offer.id, &sha256).await.unwrap_err();
    assert_eq!(kind(&hidden), "invalid_input", "{hidden}");
    assert_eq!(hidden.to_string(), "invalid input: a closed Project's Output is read-only");
    let restored = world.catalog.restore_processing_master(offer.id, &sha256).await;
    assert_eq!(
        restored.unwrap_err().to_string(),
        "invalid input: a closed Project's Output is read-only"
    );
    assert_eq!(
        world.catalog.processing_master_offer(offer.id).await.unwrap().state,
        MasterOfferState::Offered,
        "the refused catalog transactions leave the offer unchanged"
    );
    world.catalog.close().await.unwrap();
}
