// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Folder moves, a storage Move and Archive onto a macOS smbfs mount
//! (astro-plan-wdlol). The share has no atomic no-replace rename, so a
//! folder moves over an empty placeholder `PlateVault` claimed, and that
//! placeholder's handle stays open across the rename (STO-FR-12, D-W139).
//! POSIX lets a volume refuse to rename over an open folder with `EBUSY`;
//! smbfs doesn't. It does answer `F_FULLFSYNC`, which `File::sync_all` is
//! on macOS, with `ENOTSUP` for files and folders, which failed every copy
//! onto a share until the verified transfer fell back to `fsync`
//! (`custody::transfer::sync`).
//!
//! Each test works in a fresh folder below the mounted share named by
//! `PLATEVAULT_TEST_SMB`; the library, the captures and the OS Trash stay
//! on the host volume. The Linux freedesktop Trash is the other excluded
//! sync path: there `sync_all` is already plain `fsync`. The updater uses
//! app-owned temporary and install locations, never a user-chosen share.
//! A throwaway Samba server bound to the loopback, with a test-only user, is
//! enough (macOS's own smbd may hold port 445):
//!
//! ```sh
//! docker run -d --name smb-test -p 127.0.0.1:4455:445 --entrypoint sh alpine/git -c '
//!   apk add --no-cache samba && adduser -D -H smbtest &&
//!   printf "smbpass\nsmbpass\n" | smbpasswd -a -s smbtest &&
//!   mkdir /share && chown smbtest /share &&
//!   printf "[share]\npath = /share\nread only = no\nvalid users = smbtest\n" >/etc/samba/smb.conf &&
//!   exec smbd --foreground --no-process-group --debug-stdout'
//! mkdir -p /tmp/smb-test && mount_smbfs -o nobrowse //smbtest:smbpass@127.0.0.1:4455/share /tmp/smb-test
//! PLATEVAULT_TEST_SMB=/tmp/smb-test \
//!   cargo nextest run -p platevault_core --test custody_smb --run-ignored all
//! umount /tmp/smb-test && docker rm -f smb-test
//! ```
//!
//! A share with `vfs objects = catia fruit streams_xattr`, as a NAS serving
//! Macs has, is worth a second run: macOS then keeps extended attributes in
//! named streams rather than `._` files.
#![cfg(target_os = "macos")]

#[path = "support/apply.rs"]
mod apply_support;
#[path = "support/cleanup.rs"]
mod cleanup_support;

use std::fs;
use std::path::{Path, PathBuf};

use apply_support::{digest, world, World};
use cleanup_support::ScopedTrash;
use platevault_core::*;

/// A fresh, canonical folder below the mounted share.
fn on_share() -> PathBuf {
    let share = std::env::var_os("PLATEVAULT_TEST_SMB")
        .expect("PLATEVAULT_TEST_SMB names a mounted SMB folder");
    let folder = Path::new(&share).join(uuid::Uuid::new_v4().simple().to_string());
    fs::create_dir_all(&folder).unwrap();
    fs::canonicalize(folder).unwrap()
}

/// A folder holding one file.
fn folder_with_a_file(folder: &Path) {
    fs::create_dir(folder).unwrap();
    fs::write(folder.join("frame.fits"), b"frame").unwrap();
}

/// The two primitives a folder move over a placeholder rests on, each named
/// by its errno when the share refuses it: the share answers the no-replace
/// rename as unsupported, so `PlateVault` takes the placeholder fallback,
/// and a plain rename moves a folder over an empty folder held open.
#[tokio::test]
#[ignore = "needs an SMB share: PLATEVAULT_TEST_SMB=<mounted folder>"]
async fn a_folder_renames_over_an_open_empty_placeholder_on_the_share() {
    use rustix::fs::{renameat_with, RenameFlags, CWD};
    use rustix::io::Errno;

    let root = on_share();
    let (from, to) = (root.join("View"), root.join("View (previous)"));
    folder_with_a_file(&from);

    match renameat_with(CWD, &from, CWD, &to, RenameFlags::NOREPLACE) {
        Err(errno)
            if [Errno::INVAL, Errno::NOTSUP, Errno::OPNOTSUPP, Errno::NOSYS].contains(&errno) =>
        {
            eprintln!("no-replace rename: {}", std::io::Error::from(errno));
        }
        other => panic!(
            "this share answers the no-replace rename with {other:?}: the placeholder \
             fallback is not what moves folders here"
        ),
    }
    assert!(from.is_dir() && !to.exists(), "the refused rename moved nothing");

    fs::create_dir(&to).unwrap();
    let placeholder = fs::File::open(&to).unwrap();
    if let Err(error) = fs::rename(&from, &to) {
        panic!("the share refuses a rename over an open empty folder: {error} ({error:?})");
    }
    drop(placeholder);
    assert!(!from.exists());
    assert_eq!(fs::read(to.join("frame.fits")).unwrap(), b"frame");
}

/// Point the Project's processing location at a fresh folder on the share.
async fn project_on_share(world: &World) -> PathBuf {
    let parent = on_share().join("Processing");
    fs::create_dir(&parent).unwrap();
    let parent_json = serde_json::to_string(&NativePath::from_path(&parent)).unwrap();
    world
        .sql(
            "UPDATE projects SET processing_parent = ?2 WHERE id = ?1",
            &[&world.project.to_string(), &parent_json],
        )
        .await;
    parent.join(apply_support::PROJECT)
}

/// The placed entries of the installed View hold their originals' bytes.
async fn every_entry_verified(world: &World, view: &Path) {
    let manifest = world.catalog().apply_inputs(world.project).await.unwrap().installed.unwrap();
    assert_ne!(manifest.entries.len(), 0, "the View places entries");
    for entry in &manifest.entries {
        let path = view.join(entry.path.relative_path().unwrap());
        assert_eq!(digest(&path), entry.source_sha256, "{} holds its original", path.display());
    }
}

/// The folder move at risk: a second Apply moves the installed `View/`
/// aside to `View (previous)/` over the placeholder it claimed there, then
/// the built View into `View/`, both on the share.
#[tokio::test]
#[ignore = "needs an SMB share: PLATEVAULT_TEST_SMB=<mounted folder>"]
async fn a_second_apply_moves_the_view_folder_aside_on_the_share() {
    let world = world(ViewMode::Copies).await;
    let folder = project_on_share(&world).await;
    let view = folder.join("View");

    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    every_entry_verified(&world, &view).await;

    world.bump().await;
    let report = world.apply().await;
    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    assert!(report.foreign.is_empty(), "{:#?}", report.foreign);
    assert!(report.leftovers.is_empty(), "{:#?}", report.leftovers);
    every_entry_verified(&world, &view).await;
    let left = World::tree(&folder);
    assert!(!folder.join("View (previous)").exists(), "{left:#?}");
    assert!(!folder.join("View (building)").exists(), "{left:#?}");
    assert!(!left.iter().any(|path| path.contains(".pv-")), "no partial stays: {left:#?}");
}

/// The calendar save dialog accepts an arbitrary user-chosen path. Writing its
/// `.ics` file and committing the folder entry must both work on smbfs.
#[test]
#[ignore = "needs an SMB share: PLATEVAULT_TEST_SMB=<mounted folder>"]
fn a_calendar_export_writes_its_user_chosen_file_to_the_share() {
    let path = on_share().join("observing-windows.ics");
    let bytes = b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";

    platevault_core::calendar::write_snapshot(&path, bytes).unwrap();

    assert_eq!(fs::read(&path).unwrap(), bytes);
}

/// A storage Move of a capture folder's files onto the share: each file is
/// copied onto a name it created, synced, verified, and its source retired.
/// The verified transfer is the one Apply and Output copies onto a Project
/// folder on the share go through; a Move's own destination is a location,
/// which the share can't be (below).
#[tokio::test]
#[ignore = "needs an SMB share: PLATEVAULT_TEST_SMB=<mounted folder>"]
async fn a_storage_move_of_a_folder_onto_the_share_moves_every_file() {
    let temp = tempfile::tempdir().unwrap();
    let host = fs::canonicalize(temp.path()).unwrap();
    let library = library::Library::open(&host.join("catalog.sqlite"), None).await.unwrap();
    let trash = ScopedTrash::new(&host.join("bin"));
    let root = on_share();
    let mut drafts = Vec::new();
    let mut expected = Vec::new();
    for name in ["Light_001.fits", "Light_002.fits"] {
        let source = host.join("card/M31").join(name);
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, format!("{name} bytes")).unwrap();
        let relative = format!("M31/Ha/2026-10-12/light/{name}");
        expected.push((root.join(&relative), digest(&source)));
        drafts.push(StorageItemDraft {
            source: library.review_storage_entry(NativePath::from_path(&source)).await.unwrap(),
            relied_on: Vec::new(),
            destination: Some(TransferDestination {
                root: NativePath::from_path(&root),
                relative: NativePath::from_path(Path::new(&relative)),
            }),
        });
    }
    let id = library
        .catalog()
        .record_storage_operation(StorageOperationKind::Move, &drafts)
        .await
        .unwrap()
        .id;

    let operation = library.run_storage_operation(id, trash.dyn_trash()).await.unwrap();

    for item in &operation.items {
        assert_eq!(item.outcome, Some(ItemOutcome::Moved), "{item:#?}");
    }
    for (path, sha256) in &expected {
        assert_eq!(&digest(path), sha256, "{} holds its source", path.display());
    }
    assert_eq!(trash.moved().len(), 2, "both sources were retired");
    let left = World::tree(&root);
    assert!(!left.iter().any(|path| path.contains(".pv-")), "no partial stays: {left:#?}");
}

/// Archive's destination is a captures location, and a location root needs
/// a remount-stable folder ID, which smbfs doesn't have: Archive onto the
/// share is refused by name when the share is added as a location, before
/// anything is written, and the user archives to another location.
#[tokio::test]
#[ignore = "needs an SMB share: PLATEVAULT_TEST_SMB=<mounted folder>"]
async fn the_share_is_refused_by_name_as_an_archive_location() {
    let world = world(ViewMode::Copies).await;
    let root = on_share();
    let refused = world
        .library
        .register_location(
            NativePath::from_path(&root),
            "Archive-SMB".into(),
            LocationRole::Captures,
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code().as_str(), "identity_conflict", "{refused}");
    let message = refused.to_string();
    assert!(message.contains("smbfs") && message.contains("remount-stable folder ID"), "{message}");
    assert_eq!(World::tree(&root), Vec::<String>::new(), "nothing is written");
}
