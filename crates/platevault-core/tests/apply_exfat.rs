// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! F4 Apply on a volume without an atomic no-replace rename (astro-plan-e6tgr,
//! astro-plan-cyqdo): macOS exFAT answers `renamex_np(RENAME_EXCL)`, `link`
//! and `clonefile` with `ENOTSUP`, and keeps `._<name>` `AppleDouble`
//! companions beside the files it writes.
//!
//! The Project folder lies on a real exFAT volume named by
//! `PLATEVAULT_TEST_EXFAT`, a mounted folder; the library stays on the host
//! volume, whose roots qualify. Run with a fresh image:
//!
//! ```sh
//! hdiutil create -size 256m -fs ExFAT -volname F4EXFAT /tmp/f4exfat/f4.dmg
//! hdiutil attach -nobrowse -mountpoint /tmp/f4exfat/mnt /tmp/f4exfat/f4.dmg
//! PLATEVAULT_TEST_EXFAT=/tmp/f4exfat/mnt \
//!   cargo nextest run -p platevault_core --test apply_exfat --run-ignored all
//! ```
#![cfg(unix)]

#[path = "support/apply.rs"]
mod apply_support;

use std::fs;
use std::path::{Path, PathBuf};

use apply_support::{digest, world, World};
use platevault_core::*;

/// The `AppleDouble` header's magic number, big-endian.
const APPLE_DOUBLE: [u8; 4] = [0x00, 0x05, 0x16, 0x07];

/// Point the Project's processing location at a fresh folder on the exFAT
/// volume.
async fn on_exfat(world: &World) -> PathBuf {
    let volume = std::env::var_os("PLATEVAULT_TEST_EXFAT")
        .expect("PLATEVAULT_TEST_EXFAT names a mounted exFAT folder");
    let parent = Path::new(&volume).join(uuid::Uuid::new_v4().simple().to_string()).join("Processing");
    fs::create_dir_all(&parent).unwrap();
    let parent = fs::canonicalize(parent).unwrap();
    let parent_json = serde_json::to_string(&NativePath::from_path(&parent)).unwrap();
    world
        .sql(
            "UPDATE projects SET processing_parent = ?2 WHERE id = ?1",
            &[&world.project.to_string(), &parent_json],
        )
        .await;
    parent.join(apply_support::PROJECT)
}

/// Every file below `folder`, relative, without following a link.
fn files(folder: &Path) -> Vec<String> {
    World::tree(folder)
}

/// The placed entries of the installed View hold their originals' bytes.
async fn every_entry_verified(world: &World, view: &Path) {
    let manifest = world.catalog().apply_inputs(world.project).await.unwrap().installed.unwrap();
    assert_ne!(manifest.entries.len(), 0, "the View places entries");
    for entry in &manifest.entries {
        let path = view.join(entry.path.relative_path().unwrap());
        let metadata = fs::symlink_metadata(&path).unwrap();
        assert!(metadata.is_file(), "{} is a copy", path.display());
        assert_eq!(digest(&path), entry.source_sha256, "{} holds its original", path.display());
    }
}

fn no_partials(folder: &Path) {
    let left: Vec<String> = files(folder)
        .into_iter()
        .filter(|path| path.rsplit('/').next().is_some_and(|name| name.starts_with(".pv-")))
        .collect();
    assert!(left.is_empty(), "no partial copy stays: {left:#?}");
}

fn is_companion(relative: &str) -> bool {
    relative.rsplit('/').next().is_some_and(|name| name.starts_with("._"))
}

#[tokio::test]
#[ignore = "needs an exFAT volume: PLATEVAULT_TEST_EXFAT=<mounted folder>"]
async fn a_copies_apply_on_exfat_places_every_entry_as_a_verified_copy() {
    let world = world(ViewMode::Copies).await;
    let folder = on_exfat(&world).await;

    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let view = folder.join("View");
    every_entry_verified(&world, &view).await;
    no_partials(&folder);

    // A second Apply retires the first View: nothing is replaced, every
    // old copy goes once proven, and nothing PlateVault wrote is foreign.
    world.bump().await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert!(report.foreign.is_empty(), "{:#?}", report.foreign);
    assert!(report.leftovers.is_empty(), "{:#?}", report.leftovers);
    every_entry_verified(&world, &view).await;
    no_partials(&folder);
    assert!(!folder.join("View (previous)").exists(), "{:#?}", files(&folder));
}

/// cyqdo: whether macOS keeps `._` companions beside the entries Apply
/// writes, and that a companion goes with its entry: it is never listed
/// as foreign or as a leftover, while a `._` file with no entry beside it
/// is, and stays untouched.
#[tokio::test]
#[ignore = "needs an exFAT volume: PLATEVAULT_TEST_EXFAT=<mounted folder>"]
async fn apple_double_companions_go_with_their_entries_on_exfat() {
    let world = world(ViewMode::Copies).await;
    let folder = on_exfat(&world).await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let view = folder.join("View");
    let companions: Vec<String> = files(&view).into_iter().filter(|path| is_companion(path)).collect();
    eprintln!("AppleDouble companions beside placed entries: {companions:#?}");

    let orphan = view.join("._Orphan.fits");
    let mut bytes = APPLE_DOUBLE.to_vec();
    bytes.resize(4096, 0);
    fs::write(&orphan, &bytes).unwrap();

    world.bump().await;
    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);
    let foreign: Vec<String> =
        preview.foreign.iter().map(|file| file.path.display()).collect();
    assert_eq!(foreign, ["._Orphan.fits"], "only the companion with no entry is foreign");

    let report = world.library.apply(&World::request(&preview), &apply::Unattended).await.unwrap();
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let left: Vec<String> =
        report.leftovers.iter().map(|item| item.path.display()).collect();
    assert_eq!(left, ["View (previous)/._Orphan.fits"], "the unticked orphan stays, named");
    let previous = files(&folder.join("View (previous)"));
    assert_eq!(previous, ["._Orphan.fits"], "every retired entry took its companion");
    assert_eq!(fs::read(folder.join("View (previous)/._Orphan.fits")).unwrap(), bytes);
}
