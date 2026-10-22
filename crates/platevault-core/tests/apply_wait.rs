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
use std::time::Duration;

use apply_support::{world, Recorder, World};
use platevault_core::apply::pacing::HeldFolder;
use platevault_core::*;

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
