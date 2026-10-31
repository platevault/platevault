// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! F4 Apply's swap after waiting for a tool (spec 069 PREP-FR-18, plan §3;
//! astro-plan-yb133 PS2): the wait for a tool to release a file in `View/`
//! has no limit, so a Project edit committed while Apply waits is checked
//! once the old View moved aside: it puts the old View back and fails.
//! Holds the View with `apply::pacing`; run with `--features test-pacing`.
#![cfg(all(unix, feature = "test-pacing"))]

#[path = "support/apply.rs"]
mod apply_support;

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use apply_support::{world, Recorder, World, PATIENCE};
use platevault_core::apply::pacing::HeldFolder;
use platevault_core::apply::Unattended;
use platevault_core::*;

/// PREP-FR-18 (astro-plan-wre19.6): while Apply waits for a tool, its
/// durable status names the folder a tool holds and when the wait began,
/// read as often as asked; once the tool lets go the wait ends with the
/// phase it moves to, and the Apply settles Applied.
#[tokio::test(flavor = "multi_thread")]
async fn the_status_reads_which_folder_a_tool_holds_and_since_when() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    world.bump().await;
    let preview = world.preview().await;
    let held = HeldFolder::hold(&world.view());
    let started =
        world.library.start_apply(&World::request(&preview), Arc::new(Unattended)).await.unwrap();
    let ApplyStatus::Running { progress, .. } = started else { panic!("{started:#?}") };
    let operation = progress.operation_id;

    let deadline = Instant::now() + PATIENCE;
    let (phase, wait) = loop {
        match world.library.apply_status(operation).await.unwrap() {
            ApplyStatus::Running {
                progress: ApplyProgress { phase, waiting: Some(wait), .. },
                ..
            } => break (phase, wait),
            ApplyStatus::Running { .. } => {}
            other => panic!("it ended without waiting: {other:#?}"),
        }
        assert!(Instant::now() < deadline, "Apply never waited for the tool");
        tokio::time::sleep(Duration::from_millis(10)).await;
    };
    assert_eq!(phase, ApplyPhase::BuildVerified);
    assert_eq!(wait.held, NativePath::from_path(&world.view()), "it names the held View");
    assert!(wait.since >= progress.started_at, "the wait began after the start: {wait:?}");
    tokio::time::sleep(Duration::from_millis(50)).await;
    let again = world.library.apply_status(operation).await.unwrap();
    assert!(
        matches!(&again, ApplyStatus::Running { progress, .. } if progress.waiting.as_ref() == Some(&wait)),
        "the wait keeps when it began: {again:#?}"
    );

    drop(held);
    let report = world.settled(operation).await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert_eq!(world.journal(operation).await.outcome, Some(ApplyOutcome::Applied));
}

#[tokio::test(flavor = "multi_thread")]
async fn an_edit_while_apply_waits_for_a_tool_puts_the_old_view_back() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let before = World::tree(&world.view());
    world.bump().await;
    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);

    let held = HeldFolder::hold(&world.view());
    let control = Recorder::default();
    let edit = async {
        while !control.waited.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        world.bump().await;
        drop(held);
    };
    let request = World::request(&preview);
    let (report, ()) = tokio::join!(world.library.apply(&request, &control), edit);
    let report = report.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Failed), "{report:#?}");
    assert_eq!(World::tree(&world.view()), before, "the old View is back in place");
    assert!(!world.previous().exists(), "nothing is left aside");
}
