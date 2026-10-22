// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! F4 Apply's swap never replaces a folder (STO-FR-12, PREP-FR-06;
//! astro-plan-nfsgg): a folder that takes `View/` after the old View moved
//! aside refuses the install, and the old View is kept and restored.

#[path = "support/apply.rs"]
mod apply_support;

use std::fs;
use std::path::PathBuf;

use apply_support::{world, World};
use platevault_core::apply::ApplyControl;
use platevault_core::*;

/// Another process creates an empty `View/` the moment the old View has
/// moved aside, before the new one is installed.
struct TakesView(PathBuf);

impl ApplyControl for TakesView {
    fn interrupted(&self, phase: ApplyPhase) -> bool {
        if phase == ApplyPhase::OldMoved {
            fs::create_dir(&self.0).unwrap();
        }
        false
    }
}

#[tokio::test]
async fn an_empty_folder_at_view_refuses_the_install_and_the_old_view_is_kept() {
    let mut world = world(ViewMode::Copies).await;
    world.apply().await;
    let before = World::tree(&world.view());
    world.bump().await;
    let preview = world.preview().await;

    let refused = world
        .library
        .apply(&World::request(&preview), &TakesView(world.view()))
        .await
        .expect_err("the install is refused");

    assert!(
        matches!(&refused, LibraryError::IdentityConflict(detail)
            if detail.contains("installing the new View failed")),
        "{refused:?}"
    );
    assert_eq!(fs::read_dir(world.view()).unwrap().count(), 0, "the empty folder stays");
    assert_eq!(World::tree(&world.previous()), before, "the old View is kept whole");
    assert!(world.building().exists(), "the new View was not moved anywhere");

    fs::remove_dir(world.view()).unwrap();
    world.reopen().await;
    assert_eq!(World::tree(&world.view()), before, "the restart restores the old View");
    assert!(!world.previous().exists());
}
