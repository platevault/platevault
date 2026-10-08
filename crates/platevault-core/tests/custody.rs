// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage custody primitives (spec 071): OS Trash support and link safety,
//! verified transfer, D19 re-verification and the resumable journal.

mod support;

use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use platevault_core::custody::trash::OsTrash;
#[cfg(target_os = "linux")]
use platevault_core::custody::trash::SystemTrash;
use platevault_core::library::Library;
use platevault_core::{
    EntryKind, ItemChange, ItemOutcome, ItemPhase, NativePath, ReasonCode, StorageItem,
    StorageItemDraft, StorageOperation, StorageOperationKind, StorageOperationState,
    TransferDestination, TrashSupport, TrashUnsupported,
};
use support::digest;
use uuid::Uuid;

/// A stand-in OS Trash: it reports the configured support, records every
/// move it is asked for, and moves the entry itself into a private bin.
struct FakeTrash {
    support: TrashSupport,
    refuse: bool,
    bin: PathBuf,
    moved: Mutex<Vec<PathBuf>>,
}

impl FakeTrash {
    fn new(bin: &Path) -> Self {
        fs::create_dir_all(bin).unwrap();
        Self {
            support: TrashSupport::Supported,
            refuse: false,
            bin: bin.to_path_buf(),
            moved: Mutex::default(),
        }
    }

    fn moved(&self) -> Vec<PathBuf> {
        self.log().clone()
    }

    fn log(&self) -> MutexGuard<'_, Vec<PathBuf>> {
        self.moved.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl OsTrash for FakeTrash {
    fn support(&self, _entry: &Path, _size_bytes: u64) -> TrashSupport {
        self.support.clone()
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        let count = {
            let mut moved = self.log();
            moved.push(entry.to_path_buf());
            moved.len()
        };
        if self.refuse {
            return Err("the Trash refused the item".into());
        }
        // A rename moves a link itself, never its target.
        fs::rename(entry, self.bin.join(count.to_string())).map_err(|e| e.to_string())
    }
}

async fn library(root: &Path) -> Arc<Library> {
    Library::open(&root.join("catalog.sqlite"), None).await.unwrap()
}

fn native(path: &Path) -> NativePath {
    NativePath::from_path(path)
}

fn write_file(path: &Path, bytes: &[u8]) -> PathBuf {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
    path.to_path_buf()
}

/// Overwrite a file's bytes in place, keeping its size and modification time,
/// as a tool rewriting a frame in place would.
fn rewrite_in_place(path: &Path, bytes: &[u8]) {
    let modified = fs::metadata(path).unwrap().modified().unwrap();
    let mut file = fs::OpenOptions::new().write(true).open(path).unwrap();
    assert_eq!(file.metadata().unwrap().len(), bytes.len() as u64, "same size");
    file.seek(SeekFrom::Start(0)).unwrap();
    file.write_all(bytes).unwrap();
    file.set_modified(modified).unwrap();
    file.sync_all().unwrap();
}

async fn draft(library: &Library, source: &Path) -> StorageItemDraft {
    StorageItemDraft {
        source: library.review_storage_entry(native(source)).await.unwrap(),
        relied_on: Vec::new(),
        destination: None,
    }
}

async fn transfer_draft(
    library: &Library,
    source: &Path,
    root: &Path,
    relative: &str,
) -> StorageItemDraft {
    StorageItemDraft {
        destination: Some(TransferDestination {
            root: native(root),
            relative: native(Path::new(relative)),
        }),
        ..draft(library, source).await
    }
}

async fn record(
    library: &Library,
    kind: StorageOperationKind,
    drafts: Vec<StorageItemDraft>,
) -> Uuid {
    library.catalog().record_storage_operation(kind, &drafts).await.unwrap().id
}

/// Step until item `seq` reaches `phase`.
async fn step_to(
    library: &Library,
    id: Uuid,
    trash: &Arc<dyn OsTrash>,
    seq: usize,
    phase: ItemPhase,
) -> StorageOperation {
    for _ in 0..16 {
        let operation = library.step_storage_operation(id, Arc::clone(trash)).await.unwrap();
        if operation.items[seq].phase == phase {
            return operation;
        }
        assert!(
            operation.items[seq].outcome.is_none(),
            "item settled early: {:?}",
            operation.items[seq]
        );
    }
    panic!("item {seq} never reached {phase:?}");
}

fn code(item: &StorageItem) -> Option<ReasonCode> {
    item.reason.as_ref().map(|reason| reason.code)
}

fn as_dyn(trash: &Arc<FakeTrash>) -> Arc<dyn OsTrash> {
    Arc::clone(trash) as Arc<dyn OsTrash>
}

/// The Trash a link test retires through, never the user's own. On Linux it
/// is the real freedesktop adapter with its home Trash under `root/data`,
/// missing until the first move creates it.
#[cfg(target_os = "linux")]
fn link_trash(root: &Path) -> Arc<dyn OsTrash> {
    Arc::new(SystemTrash::with_data_home(root.join("data")))
}

/// The host Trash cannot be pointed elsewhere here, so the stand-in, which
/// renames the link itself, takes its place.
#[cfg(all(unix, not(target_os = "linux")))]
fn link_trash(root: &Path) -> Arc<dyn OsTrash> {
    Arc::new(FakeTrash::new(&root.join("bin")))
}

#[tokio::test]
async fn immediate_delete_volume_counts_as_unsupported_and_keeps_file() {
    let temp = tempfile::tempdir().unwrap();
    let library = library(temp.path()).await;
    let frame = write_file(&temp.path().join("share/M31/light_001.fits"), b"network frame bytes");
    let before = digest(&frame);
    let mut network = FakeTrash::new(&temp.path().join("bin"));
    // What the macOS adapter reports for an smbfs volume, where removal
    // deletes immediately instead of keeping the item in the Trash.
    network.support = TrashSupport::Unsupported {
        reason: TrashUnsupported::DeletesImmediately,
        detail: "the smbfs network volume has no Trash: macOS deletes items there immediately"
            .into(),
    };
    let network = Arc::new(network);
    let id =
        record(&library, StorageOperationKind::Trash, vec![draft(&library, &frame).await]).await;

    let operation = library.run_storage_operation(id, as_dyn(&network)).await.unwrap();

    assert_eq!(operation.state, StorageOperationState::Settled);
    let item = &operation.items[0];
    assert_eq!(item.outcome, Some(ItemOutcome::Blocked));
    assert_eq!(code(item), Some(ReasonCode::TrashUnsupported));
    assert!(item.reason.as_ref().unwrap().detail.contains("deletes items there immediately"));
    assert!(network.moved().is_empty(), "an unsupported volume is never asked to move anything");
    assert_eq!(digest(&frame), before, "the file stays in place, byte-identical");
}

#[cfg(unix)]
#[tokio::test]
async fn link_trashed_without_following_target() {
    let temp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temp.path()).unwrap();
    let library = library(&root).await;
    let original = write_file(&root.join("Captures/M31/light_001.fits"), b"original frame bytes");
    let originals = root.join("Captures/M31");
    let original_digest = digest(&original);
    let run = root.join("Runs/M31 (rev 1)");
    fs::create_dir_all(&run).unwrap();
    let file_link = run.join("light_001.fits");
    let folder_link = run.join("lights");
    std::os::unix::fs::symlink(&original, &file_link).unwrap();
    std::os::unix::fs::symlink(&originals, &folder_link).unwrap();

    let file_draft = draft(&library, &file_link).await;
    assert_eq!(file_draft.source.kind, EntryKind::Link { target: native(&original) });
    assert_eq!(file_draft.source.sha256, None, "a link's target is never hashed");
    let folder_draft = draft(&library, &folder_link).await;
    assert_eq!(folder_draft.source.kind, EntryKind::Link { target: native(&originals) });
    let id = record(&library, StorageOperationKind::Trash, vec![file_draft, folder_draft]).await;

    let operation = library.run_storage_operation(id, link_trash(&root)).await.unwrap();

    for item in &operation.items {
        assert_eq!(item.outcome, Some(ItemOutcome::Trashed), "{item:?}");
    }
    assert!(fs::symlink_metadata(&file_link).is_err(), "the file link itself went to the Trash");
    assert!(
        fs::symlink_metadata(&folder_link).is_err(),
        "the folder link itself went to the Trash"
    );
    assert_eq!(digest(&original), original_digest, "the link target stays byte-identical");
    let listing: Vec<_> =
        fs::read_dir(&originals).unwrap().map(|entry| entry.unwrap().file_name()).collect();
    assert_eq!(
        listing,
        vec![std::ffi::OsString::from("light_001.fits")],
        "no target folder followed"
    );
    #[cfg(target_os = "linux")]
    for (name, target) in [("light_001.fits", &original), ("lights", &originals)] {
        let trashed = root.join("data/Trash/files").join(name);
        assert_eq!(&fs::read_link(&trashed).unwrap(), target, "the link itself is in the Trash");
    }
}

#[tokio::test]
async fn transfer_rereads_destination_and_retains_source_on_mismatch() {
    let temp = tempfile::tempdir().unwrap();
    let library = library(temp.path()).await;
    let source =
        write_file(&temp.path().join("card/DCIM/light_001.fits"), b"reviewed source snapshot");
    let source_digest = digest(&source);
    let archive = temp.path().join("Archive");
    fs::create_dir_all(&archive).unwrap();
    let trash = Arc::new(FakeTrash::new(&temp.path().join("bin")));
    let id = record(
        &library,
        StorageOperationKind::Move,
        vec![
            transfer_draft(
                &library,
                &source,
                &archive,
                "NGC7000/Ha/2026-04-12/light/light_001.fits",
            )
            .await,
        ],
    )
    .await;
    let destination = archive.join("NGC7000/Ha/2026-04-12/light/light_001.fits");

    step_to(&library, id, &as_dyn(&trash), 0, ItemPhase::Installed).await;
    assert_eq!(digest(&destination), source_digest, "the copy was written durably");
    // The destination's bytes go bad after the write (a failing disk or share).
    rewrite_in_place(&destination, b"corrupted after writing!");
    let operation = library.run_storage_operation(id, as_dyn(&trash)).await.unwrap();

    let item = &operation.items[0];
    assert_eq!(item.outcome, Some(ItemOutcome::Blocked));
    assert_eq!(code(item), Some(ReasonCode::DestinationMismatch));
    assert_eq!(digest(&source), source_digest, "the source is retained");
    assert!(trash.moved().is_empty(), "a failed re-read never retires the source");
}

#[tokio::test]
async fn source_drift_retains_both_versions() {
    let temp = tempfile::tempdir().unwrap();
    let library = library(temp.path()).await;
    let source = write_file(&temp.path().join("card/light_002.fits"), b"bytes at review time");
    let reviewed = digest(&source);
    let archive = temp.path().join("Archive");
    fs::create_dir_all(&archive).unwrap();
    let trash = Arc::new(FakeTrash::new(&temp.path().join("bin")));
    let id = record(
        &library,
        StorageOperationKind::Move,
        vec![transfer_draft(&library, &source, &archive, "M31/light_002.fits").await],
    )
    .await;

    let verified = step_to(&library, id, &as_dyn(&trash), 0, ItemPhase::DestinationVerified).await;
    assert_eq!(verified.items[0].outcome, None);
    // The source changes in place before retirement, size and mtime preserved.
    rewrite_in_place(&source, b"bytes edited in situ");
    let operation = library.run_storage_operation(id, as_dyn(&trash)).await.unwrap();

    let item = &operation.items[0];
    assert_eq!(item.outcome, Some(ItemOutcome::Blocked));
    assert_eq!(code(item), Some(ReasonCode::SourceDrift));
    assert_eq!(fs::read(&source).unwrap(), b"bytes edited in situ", "the changed source is kept");
    assert_eq!(digest(&archive.join("M31/light_002.fits")), reviewed, "the verified copy is kept");
    assert!(trash.moved().is_empty(), "neither version is retired automatically");
}

#[tokio::test]
async fn in_place_change_with_preserved_stats_blocks_trash() {
    let temp = tempfile::tempdir().unwrap();
    let library = library(temp.path()).await;
    let changed = write_file(&temp.path().join("run/copy_a.fits"), b"approved bytes A");
    let kept = write_file(&temp.path().join("run/copy_b.fits"), b"approved bytes B");
    let trash = Arc::new(FakeTrash::new(&temp.path().join("bin")));
    let id = record(
        &library,
        StorageOperationKind::Trash,
        vec![draft(&library, &changed).await, draft(&library, &kept).await],
    )
    .await;
    rewrite_in_place(&changed, b"modified bytes A");

    let operation = library.run_storage_operation(id, as_dyn(&trash)).await.unwrap();

    assert_eq!(operation.items[0].outcome, Some(ItemOutcome::Blocked));
    assert_eq!(code(&operation.items[0]), Some(ReasonCode::SourceDrift));
    assert_eq!(fs::read(&changed).unwrap(), b"modified bytes A", "the drifted item stays in place");
    assert_eq!(
        operation.items[1].outcome,
        Some(ItemOutcome::Trashed),
        "other approved items proceed"
    );
    assert_eq!(trash.moved(), vec![kept]);
}

#[tokio::test]
async fn missing_retained_original_blocks_removal() {
    let temp = tempfile::tempdir().unwrap();
    let library = library(temp.path()).await;
    let original =
        write_file(&temp.path().join("Captures/light_003.fits"), b"last copy of these bytes");
    let prepared = temp.path().join("run/light_003.fits");
    fs::create_dir_all(prepared.parent().unwrap()).unwrap();
    fs::hard_link(&original, &prepared).unwrap();
    let mut item = draft(&library, &prepared).await;
    item.relied_on = vec![library.review_kept_copy(native(&original)).await.unwrap()];
    let trash = Arc::new(FakeTrash::new(&temp.path().join("bin")));
    let id = record(&library, StorageOperationKind::Trash, vec![item]).await;
    // The original is deleted externally: the hardlink now holds the last bytes.
    fs::remove_file(&original).unwrap();

    let operation = library.run_storage_operation(id, as_dyn(&trash)).await.unwrap();

    assert_eq!(operation.items[0].outcome, Some(ItemOutcome::Blocked));
    assert_eq!(code(&operation.items[0]), Some(ReasonCode::KeptCopyUnproven));
    assert!(prepared.exists(), "insufficient retained-original proof keeps the hardlink");
    assert!(trash.moved().is_empty());
}

#[tokio::test]
async fn journal_resumes_after_interruption_without_filename_presence() {
    let temp = tempfile::tempdir().unwrap();
    let archive = temp.path().join("Archive");
    fs::create_dir_all(&archive).unwrap();
    let sources: Vec<PathBuf> = ["a", "b", "c"]
        .iter()
        .map(|name| {
            write_file(
                &temp.path().join(format!("card/{name}.fits")),
                format!("frame {name}").as_bytes(),
            )
        })
        .collect();
    let trash = Arc::new(FakeTrash::new(&temp.path().join("bin")));
    let (copy, cleanup) = {
        let library = library(temp.path()).await;
        let mut drafts = Vec::new();
        for (source, name) in sources.iter().zip(["a", "b", "c"]) {
            drafts.push(
                transfer_draft(&library, source, &archive, &format!("M31/{name}.fits")).await,
            );
        }
        let copy = record(&library, StorageOperationKind::Copy, drafts).await;
        // a is copied and verified; b has recorded its partial copy when the
        // process stops.
        step_to(&library, copy, &as_dyn(&trash), 0, ItemPhase::Settled).await;
        step_to(&library, copy, &as_dyn(&trash), 1, ItemPhase::Writing).await;

        // A Trash operation interrupted right after recording its intent to
        // retire both entries, before the OS Trash was asked to move them.
        let x = write_file(&temp.path().join("run/x.fits"), b"entry x");
        let y = write_file(&temp.path().join("run/y.fits"), b"entry y");
        let cleanup = record(
            &library,
            StorageOperationKind::Trash,
            vec![draft(&library, &x).await, draft(&library, &y).await],
        )
        .await;
        let catalog = library.catalog();
        let started = catalog.start_storage_operation(cleanup).await.unwrap();
        for item in &started.items {
            let retiring = ItemChange {
                phase: ItemPhase::Retiring,
                outcome: None,
                reason: None,
                written: None,
            };
            catalog
                .advance_storage_item(cleanup, item.seq, item.revision, &retiring)
                .await
                .unwrap();
        }
        (copy, cleanup)
    };
    let destination = |name: &str| archive.join(format!("M31/{name}.fits"));
    let a_inode = identity(&destination("a"));
    // A file already at c's destination holds c's exact bytes: its name and
    // content say "done", but this operation never wrote it.
    fs::copy(&sources[2], destination("c")).unwrap();
    let decoy = identity(&destination("c"));
    // x left its path after the recorded intent (perhaps moved by the OS
    // Trash, perhaps by someone else); y is still in place.
    fs::rename(temp.path().join("run/x.fits"), temp.path().join("elsewhere.fits")).unwrap();

    let library = library(temp.path()).await;
    let unsettled: Vec<Uuid> = library
        .catalog()
        .unsettled_storage_operations()
        .await
        .unwrap()
        .iter()
        .map(|op| op.id)
        .collect();
    assert_eq!(unsettled, vec![copy, cleanup]);
    let copied = library.run_storage_operation(copy, as_dyn(&trash)).await.unwrap();
    let cleaned = library.run_storage_operation(cleanup, as_dyn(&trash)).await.unwrap();

    assert_eq!(copied.state, StorageOperationState::Settled);
    assert_eq!(copied.items[0].outcome, Some(ItemOutcome::Copied));
    assert_eq!(identity(&destination("a")), a_inode, "verified work is not copied again");
    assert_eq!(copied.items[1].outcome, Some(ItemOutcome::Copied), "b resumes its recorded copy");
    assert_eq!(digest(&destination("b")), digest(&sources[1]));
    assert_eq!(copied.items[2].outcome, Some(ItemOutcome::Blocked));
    assert_eq!(code(&copied.items[2]), Some(ReasonCode::DestinationOccupied));
    assert_eq!(
        identity(&destination("c")),
        decoy,
        "a file this operation did not write is never replaced"
    );
    for source in &sources {
        assert!(source.exists(), "Copy leaves every source in place");
    }
    assert_eq!(
        cleaned.items[0].outcome,
        Some(ItemOutcome::Uncertain),
        "absence never proves a move"
    );
    assert_eq!(code(&cleaned.items[0]), Some(ReasonCode::Interrupted));
    assert_eq!(cleaned.items[1].outcome, Some(ItemOutcome::Trashed), "y re-verifies and moves");
    assert_eq!(trash.moved(), vec![temp.path().join("run/y.fits")]);
}

#[tokio::test]
async fn no_permanent_delete_fallback() {
    let temp = tempfile::tempdir().unwrap();
    let library = library(temp.path()).await;
    let folder = temp.path().join("run");
    let entry = write_file(&folder.join("intermediate.xisf"), b"intermediate bytes");
    let mut refusing = FakeTrash::new(&temp.path().join("bin"));
    refusing.refuse = true;
    let refusing = Arc::new(refusing);
    let id =
        record(&library, StorageOperationKind::Trash, vec![draft(&library, &entry).await]).await;

    let operation = library.run_storage_operation(id, as_dyn(&refusing)).await.unwrap();

    assert_eq!(operation.items[0].outcome, Some(ItemOutcome::Blocked));
    assert_eq!(code(&operation.items[0]), Some(ReasonCode::TrashFailed));
    assert_eq!(refusing.moved(), vec![entry.clone()], "the OS Trash is the only removal tried");
    assert_eq!(fs::read(&entry).unwrap(), b"intermediate bytes", "nothing is deleted instead");
    let names: Vec<_> = fs::read_dir(&folder).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(
        names,
        vec![std::ffi::OsString::from("intermediate.xisf")],
        "no archive fallback copy"
    );

    // Move from a volume whose OS removal deletes immediately: the source is
    // kept and the item reports the verified copy with its source kept.
    let source = write_file(&temp.path().join("card/light_009.fits"), b"card frame");
    let archive = temp.path().join("Archive");
    fs::create_dir_all(&archive).unwrap();
    let mut card = FakeTrash::new(&temp.path().join("bin2"));
    card.support = TrashSupport::Unsupported {
        reason: TrashUnsupported::DeletesImmediately,
        detail: "removable drives have no Recycle Bin".into(),
    };
    let card = Arc::new(card);
    let id = record(
        &library,
        StorageOperationKind::Move,
        vec![transfer_draft(&library, &source, &archive, "M31/light_009.fits").await],
    )
    .await;

    let operation = library.run_storage_operation(id, as_dyn(&card)).await.unwrap();

    assert_eq!(operation.items[0].outcome, Some(ItemOutcome::SourceKept));
    assert_eq!(code(&operation.items[0]), Some(ReasonCode::TrashUnsupported));
    assert_eq!(fs::read(&source).unwrap(), b"card frame", "copied, source kept");
    assert_eq!(fs::read(archive.join("M31/light_009.fits")).unwrap(), b"card frame");
    assert!(card.moved().is_empty());
}

/// Same-session identity of the entry at `path`.
#[cfg(unix)]
fn identity(path: &Path) -> (u64, u64) {
    use std::os::unix::fs::MetadataExt;
    let metadata = fs::symlink_metadata(path).unwrap();
    (metadata.dev(), metadata.ino())
}

#[cfg(not(unix))]
fn identity(path: &Path) -> (u64, Option<std::time::SystemTime>) {
    let metadata = fs::symlink_metadata(path).unwrap();
    (metadata.len(), metadata.created().ok())
}
