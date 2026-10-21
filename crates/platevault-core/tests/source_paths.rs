// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! F4 custody of catalog sources (spec 071 STO-FR-07; astro-plan-9w4qm C4):
//! a source is resolved from its registered root one folder at a time,
//! never following a link, every time it is read or moved. A folder of the
//! location that becomes a link after indexing is refused by Apply, Trash and
//! Archive, and nothing outside the registered root is read or moved.

#[path = "support/apply.rs"]
mod apply_support;
#[path = "support/cleanup.rs"]
mod cleanup_support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use apply_support::{digest, world, World, HA};
use cleanup_support::ScopedTrash;
use platevault_core::apply::Unattended;
use platevault_core::*;

/// The indexed night folder both Ha lights sit in.
const NIGHT: &str = "2026-10-12";

/// Move the indexed `2026-10-12/` folder out of the captures location and
/// leave a link to it in its place. Its files keep their identity, size,
/// modification time and bytes, so only a walk below the registered root
/// that refuses links tells the swapped folder from the indexed one.
fn swap_night_for_link(world: &World) -> PathBuf {
    let root = world.captures.path.to_path_buf().unwrap();
    let outside = world.temp.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    let moved = outside.join(NIGHT);
    fs::rename(root.join(NIGHT), &moved).unwrap();
    link_folder(&moved, &root.join(NIGHT));
    moved
}

/// Leave a link at `link` to the folder `target`. `fs_pathsafe::create_symlink`
/// makes file links, and a Windows link to a folder is a directory symlink.
fn link_folder(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(target, link).unwrap();
}

/// The Ha lights where the swap left them, outside every location.
fn outside_lights(moved: &Path) -> Vec<PathBuf> {
    HA.iter().map(|relative| moved.join(Path::new(relative).file_name().unwrap())).collect()
}

/// Every regular file below `folder`, without following a link.
fn files_below(folder: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(folder) else { return found };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else { continue };
        if metadata.is_dir() {
            found.extend(files_below(&path));
        } else if metadata.is_file() {
            found.push(path);
        }
    }
    found
}

/// The SHA-256 of each original, taken before the operation runs.
fn digests(originals: &[PathBuf]) -> Vec<String> {
    originals.iter().map(|path| digest(path)).collect()
}

/// No regular file below `folder` holds any of the bytes `digests` name:
/// nothing read from outside the root was written there.
fn holds_none_of(folder: &Path, digests: &[String]) {
    for file in files_below(folder) {
        assert!(!digests.contains(&digest(&file)), "{} holds an outside original", file.display());
    }
}

/// The originals are still outside, where nothing may move them from.
fn still_outside(originals: &[PathBuf], trash: Option<&ScopedTrash>) {
    for original in originals {
        assert!(original.exists(), "{} stays where it is", original.display());
    }
    if let Some(trash) = trash {
        let night = Path::new(NIGHT);
        let taken: Vec<PathBuf> = trash
            .moved()
            .into_iter()
            .filter(|path| path.parent().is_some_and(|parent| parent.ends_with(night)))
            .collect();
        assert!(taken.is_empty(), "nothing below the swapped folder was trashed: {taken:#?}");
    }
}

fn bin(world: &World) -> Arc<ScopedTrash> {
    ScopedTrash::new(&world.temp.path().join("bin"))
}

/// Proceed through Clean up with nothing ticked.
async fn skip_clean_up(world: &World, trash: &Arc<ScopedTrash>) {
    let review = world.library.clean_up_review(world.project).await.unwrap();
    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected: Vec::new(),
    };
    world.library.clean_up(&request, trash.dyn_trash()).await.unwrap();
}

#[tokio::test]
async fn apply_refuses_an_original_whose_indexed_folder_became_a_link() {
    let world = world(ViewMode::Copies).await;
    let moved = swap_night_for_link(&world);
    let originals = outside_lights(&moved);
    let bytes = digests(&originals);

    let preview = world.preview().await;
    let applied = world.library.apply(&World::request(&preview), &Unattended).await;
    if let Ok(report) = &applied {
        assert_ne!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    }
    assert!(!world.view().exists(), "no View was installed");
    still_outside(&originals, None);
    holds_none_of(&world.folder(), &bytes);
}

#[tokio::test]
async fn trash_refuses_a_rejected_frame_whose_indexed_folder_became_a_link() {
    let world = world(ViewMode::Symlinks).await;
    let ha = world.session_of(&world.captures, HA[0]).await;
    world.apply().await;
    world.mark(&ha, Quality::Unusable).await;
    world.apply().await;
    let trash = bin(&world);
    skip_clean_up(&world, &trash).await;
    let review = world.library.trash_review(world.project, trash.dyn_trash()).await.unwrap();
    assert_eq!(review.groups[0].group, TrashGroup::RejectedFrames, "{review:#?}");
    assert_eq!(review.groups[0].items.len(), 2, "{review:#?}");

    let moved = swap_night_for_link(&world);
    let originals = outside_lights(&moved);
    let request = TrashRequest {
        project_id: world.project,
        digest: review.digest.clone(),
        ticked: vec![TrashGroup::RejectedFrames],
    };
    let _ = world.library.wrap_up_trash(&request, trash.dyn_trash()).await;
    still_outside(&originals, Some(&trash));
    let assets = world.library.catalog().session(ha.id).await.unwrap().assets;
    assert!(
        assets.iter().all(|asset| asset.availability != Availability::Trashed),
        "no refused frame reads Trashed: {assets:#?}"
    );
}

#[tokio::test]
async fn archive_refuses_a_session_whose_indexed_folder_became_a_link() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let archive_root = fs::canonicalize({
        let root = world.temp.path().join("Archive-T7");
        fs::create_dir_all(&root).unwrap();
        root
    })
    .unwrap();
    let archive = world
        .library
        .register_location(
            NativePath::from_path(&archive_root),
            "Archive-T7".into(),
            LocationRole::Captures,
        )
        .await
        .unwrap();
    let trash = bin(&world);
    skip_clean_up(&world, &trash).await;
    let review = world.library.trash_review(world.project, trash.dyn_trash()).await.unwrap();
    let request =
        TrashRequest { project_id: world.project, digest: review.digest, ticked: Vec::new() };
    world.library.wrap_up_trash(&request, trash.dyn_trash()).await.unwrap();
    let review = world.library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    let sessions: Vec<uuid::Uuid> = review.sessions.iter().map(|offer| offer.session_id).collect();
    let desired_revision =
        world.library.wrap_up_status(world.project).await.unwrap().desired_revision;

    let moved = swap_night_for_link(&world);
    let originals = outside_lights(&moved);
    let bytes = digests(&originals);
    let request = CloseRequest {
        project_id: world.project,
        desired_revision,
        archive: Some(ArchiveSelection {
            destination: archive.id,
            sessions,
            digest: review.digest,
        }),
    };
    let _ = world.library.close_project(&request, trash.dyn_trash(), &Unattended).await;
    still_outside(&originals, Some(&trash));
    holds_none_of(&archive_root, &bytes);
}

/// Swaps the indexed night folder for a link once Apply recorded its
/// snapshots, before it places anything.
struct SwapAfterSnapshot<'a> {
    world: &'a World,
    moved: std::sync::Mutex<Option<PathBuf>>,
}

impl platevault_core::apply::ApplyControl for SwapAfterSnapshot<'_> {
    fn interrupted(&self, phase: ApplyPhase) -> bool {
        let mut moved = self.moved.lock().unwrap();
        if phase == ApplyPhase::SourcesVerified && moved.is_none() {
            *moved = Some(swap_night_for_link(self.world));
        }
        false
    }
}

/// nlewt: a folder swapped for a link after the snapshot and before the
/// placement: the clone or copy reads the original through the folders
/// entered from its root, so Apply refuses and no outside byte is placed.
#[tokio::test]
async fn apply_places_no_outside_byte_when_a_folder_becomes_a_link_after_the_snapshot() {
    let world = world(ViewMode::Copies).await;
    let preview = world.preview().await;
    assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);
    let control = SwapAfterSnapshot { world: &world, moved: std::sync::Mutex::new(None) };
    let applied = world.library.apply(&World::request(&preview), &control).await;
    let moved = control.moved.lock().unwrap().clone().expect("the swap ran");
    if let Ok(report) = &applied {
        assert_ne!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    }
    let originals = outside_lights(&moved);
    still_outside(&originals, None);
    holds_none_of(&world.folder(), &digests(&originals));
}

/// 9w4qm: an old copy is deleted outright only once its original verifies,
/// so an original now reached through a link proves nothing and the copy
/// stays, named.
#[tokio::test]
async fn apply_keeps_an_old_copy_whose_original_is_reached_through_a_link() {
    let world = world(ViewMode::Copies).await;
    let ha = world.session_of(&world.captures, HA[0]).await;
    world.apply().await;
    world.mark(&ha, Quality::Unusable).await;
    let moved = swap_night_for_link(&world);
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let kept: Vec<&PreviousItem> = report
        .leftovers
        .iter()
        .filter(|item| item.reason == PreviousItemReason::UnverifiedCopy)
        .collect();
    assert_eq!(kept.len(), HA.len(), "{:#?}", report.leftovers);
    for item in kept {
        let path = world.folder().join(item.path.relative_path().unwrap());
        assert!(path.exists(), "{} stays", path.display());
    }
    still_outside(&outside_lights(&moved), None);
}

/// 9w4qm: Clean up moves a copy to the OS Trash only once its original
/// verifies below its root; reached through a link, the copy stays.
#[tokio::test]
async fn clean_up_keeps_a_copy_whose_original_is_reached_through_a_link() {
    let world = world(ViewMode::Copies).await;
    world.apply().await;
    let moved = swap_night_for_link(&world);
    let trash = bin(&world);
    let review = world.library.clean_up_review(world.project).await.unwrap();
    let ha: Vec<NativePath> = review
        .entries
        .iter()
        .map(|entry| entry.path.clone())
        .filter(|path| {
            fs_pathsafe::wire_path(&path.relative_path().unwrap())
                .contains("NIGHT_2026-10-12/Lights")
        })
        .collect();
    assert_eq!(ha.len(), HA.len(), "{review:#?}");
    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected: ha.clone(),
    };
    let report = world.library.clean_up(&request, trash.dyn_trash()).await.unwrap();
    for row in &ha {
        let outcome = report.results.iter().find(|result| result.path == *row).unwrap();
        assert!(matches!(outcome.outcome, CleanUpOutcome::Kept { .. }), "{report:#?}");
        assert!(world.folder().join(row.relative_path().unwrap()).exists());
    }
    assert!(trash.moved().is_empty(), "{:#?}", trash.moved());
    still_outside(&outside_lights(&moved), Some(&trash));
}

/// yb133: a Project folder that is a link offers no `Processing/` file
/// from where it points, as Apply refuses a linked Project folder.
#[tokio::test]
async fn trash_offers_nothing_through_a_linked_project_folder() {
    let world = world(ViewMode::Symlinks).await;
    world.apply().await;
    let trash = bin(&world);
    skip_clean_up(&world, &trash).await;
    let elsewhere = world.temp.path().join("elsewhere");
    fs::create_dir_all(&elsewhere).unwrap();
    let away = elsewhere.join(apply_support::PROJECT);
    fs::rename(world.folder(), &away).unwrap();
    fs::create_dir_all(away.join("Processing")).unwrap();
    fs::write(away.join("Processing/registered.xisf"), b"elsewhere").unwrap();
    link_folder(&away, &world.folder());

    let review = world.library.trash_review(world.project, trash.dyn_trash()).await.unwrap();
    let offered = review
        .groups
        .iter()
        .filter(|group| group.group == TrashGroup::ProcessingFiles)
        .flat_map(|group| group.items.iter().flat_map(|item| &item.files))
        .count();
    assert_eq!(offered, 0, "{review:#?}");
    assert!(away.join("Processing/registered.xisf").exists());
}
