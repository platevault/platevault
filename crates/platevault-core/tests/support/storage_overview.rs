// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixtures for the Storage overview tests (spec 071 STO-FR-11/12):
//! real FITS copies in several registered locations, scanned so their
//! content identity is recorded, one of them moved to a stand-in OS Trash
//! and recorded Trashed, and verified transfers recorded in the journal.
//! Included with `#[path = "support/storage_overview.rs"] mod overview_support;`
//! next to `mod support;`.
#![allow(dead_code)]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::TrashedFrame;
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::Library;
use platevault_core::*;
use uuid::Uuid;

use crate::support;

/// A stand-in OS Trash that moves each entry itself into a private bin.
pub struct BinTrash {
    bin: PathBuf,
}

impl BinTrash {
    pub fn in_folder(bin: &Path) -> Arc<dyn OsTrash> {
        fs::create_dir_all(bin).unwrap();
        Arc::new(Self { bin: bin.to_path_buf() })
    }
}

impl OsTrash for BinTrash {
    fn support(&self, _entry: &Path, _size_bytes: u64) -> TrashSupport {
        TrashSupport::Supported
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        let name = entry.file_name().ok_or("an entry has a name")?;
        fs::rename(entry, self.bin.join(name)).map_err(|error| error.to_string())
    }
}

pub async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                return operation;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state")
}

pub async fn register(library: &Arc<Library>, root: &Path, name: &str) -> Location {
    fs::create_dir_all(root).unwrap();
    library
        .register_location(NativePath::from_path(root), name.into(), LocationRole::Captures)
        .await
        .unwrap()
}

/// One frame copied byte for byte into three Captures locations, `Disk A`,
/// `Disk B` and `Disk C`. The copy in `Disk C` went to the OS Trash through a
/// settled Trash operation and is recorded Trashed.
pub struct Duplicates {
    pub sha256: String,
    pub locations: [Location; 3],
    pub paths: [PathBuf; 3],
    pub assets: [Uuid; 3],
    /// The settled Trash operation that moved the `Disk C` copy.
    pub cleanup: Uuid,
}

impl Duplicates {
    pub async fn new(library: &Arc<Library>, root: &Path) -> Self {
        let fields = [
            ("IMAGETYP", "'LIGHT'"),
            ("FILTER", "'Ha'"),
            ("EXPTIME", "300"),
            ("DATE-OBS", "'2026-08-02T23:10:00'"),
        ];
        let names = ["Disk A", "Disk B", "Disk C"];
        let paths = names.map(|name| root.join(name).join("M31/light_001.fits"));
        fs::create_dir_all(paths[0].parent().unwrap()).unwrap();
        support::fits(&paths[0], &fields).unwrap();
        for path in &paths[1..] {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::copy(&paths[0], path).unwrap();
        }
        let sha256 = support::digest(&paths[0]);
        let mut locations = Vec::new();
        for name in names {
            let location = register(library, &root.join(name), name).await;
            assert_eq!(scan_to_end(library, location.id).await.state, ScanState::Completed);
            locations.push(location);
        }
        let locations: [Location; 3] = locations.try_into().unwrap();
        let mut assets = Vec::new();
        for location in &locations {
            let copies = library.catalog().location_assets(location.id).await.unwrap();
            assert_eq!(copies.len(), 1, "one copy per location");
            assert_eq!(
                copies[0].fingerprint.content_sha256.as_deref(),
                Some(sha256.as_str()),
                "every copy's content identity is recorded"
            );
            assets.push(copies[0].id);
        }
        let assets: [Uuid; 3] = assets.try_into().unwrap();
        let source = library.review_storage_entry(NativePath::from_path(&paths[2])).await.unwrap();
        let draft = StorageItemDraft { source, relied_on: Vec::new(), destination: None };
        let cleanup = library
            .catalog()
            .record_storage_operation(StorageOperationKind::Trash, &[draft])
            .await
            .unwrap()
            .id;
        let trashed = library
            .run_storage_operation(cleanup, BinTrash::in_folder(&root.join("OS Trash")))
            .await
            .unwrap();
        assert_eq!(trashed.items[0].outcome, Some(ItemOutcome::Trashed), "{trashed:?}");
        let frame =
            TrashedFrame { asset_id: assets[2], sha256: sha256.clone(), complete_view_ids: vec![] };
        library.catalog().record_trashed(cleanup, &[frame]).await.unwrap();
        Self { sha256, locations, paths, assets, cleanup }
    }
}

/// A reviewed transfer item from `source` to `relative` below `root`.
pub async fn transfer_draft(
    library: &Library,
    source: &Path,
    root: &Path,
    relative: &str,
) -> StorageItemDraft {
    StorageItemDraft {
        source: library.review_storage_entry(NativePath::from_path(source)).await.unwrap(),
        relied_on: Vec::new(),
        destination: Some(TransferDestination {
            root: NativePath::from_path(root),
            relative: NativePath::from_path(Path::new(relative)),
        }),
    }
}

/// Step the operation until item `seq` reaches `phase`.
pub async fn step_to(
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
        assert!(operation.items[seq].outcome.is_none(), "settled early: {operation:?}");
    }
    panic!("item {seq} never reached {phase:?}");
}

/// Append bytes to a file outside `PlateVault`, as another tool would.
pub fn append(path: &Path) {
    let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
    file.write_all(b" edited elsewhere").unwrap();
    file.sync_all().unwrap();
}
