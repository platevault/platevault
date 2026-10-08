// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixtures for the Clean up and Empty Trash tests (spec 071
//! STO-FR-01..05/10/17): a stand-in OS Trash that moves each entry itself into
//! a private bin and has no Trash below chosen roots, a folder indexed as a
//! library location, the library's frames and quality decisions as one
//! snapshot, and raw SQL against the catalog file.
//! Included with `#[path = "support/cleanup.rs"] mod cleanup_support;`.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use persistence_library::SourceProbe;
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::*;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use uuid::Uuid;

/// A stand-in OS Trash: it moves the entry itself, never a link's target,
/// into its bin, and below each `no_trash` root it has no Trash at all.
pub struct ScopedTrash {
    bin: PathBuf,
    no_trash: Mutex<Vec<PathBuf>>,
    moved: Mutex<Vec<PathBuf>>,
    next: AtomicUsize,
}

impl ScopedTrash {
    pub fn new(bin: &Path) -> Arc<Self> {
        fs::create_dir_all(bin).unwrap();
        Arc::new(Self {
            bin: bin.to_path_buf(),
            no_trash: Mutex::new(Vec::new()),
            moved: Mutex::new(Vec::new()),
            next: AtomicUsize::new(0),
        })
    }

    /// The location below `root` has no OS Trash from now on.
    pub fn without_trash(&self, root: &Path) {
        self.no_trash.lock().unwrap().push(root.to_path_buf());
    }

    /// Every path the OS Trash took, in order.
    pub fn moved(&self) -> Vec<PathBuf> {
        self.moved.lock().unwrap().clone()
    }

    /// How many entries the bin holds: nothing leaves it.
    pub fn bin_len(&self) -> usize {
        fs::read_dir(&self.bin).unwrap().count()
    }

    pub fn dyn_trash(self: &Arc<Self>) -> Arc<dyn OsTrash> {
        Arc::clone(self) as Arc<dyn OsTrash>
    }
}

impl OsTrash for ScopedTrash {
    fn support(&self, entry: &Path, _size_bytes: u64) -> TrashSupport {
        if self.no_trash.lock().unwrap().iter().any(|root| entry.starts_with(root)) {
            TrashSupport::Unsupported {
                reason: TrashUnsupported::NoTrash,
                detail: "this location has no OS Trash".into(),
            }
        } else {
            TrashSupport::Supported
        }
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        let name = entry.file_name().ok_or("an entry has a name")?.to_string_lossy();
        let n = self.next.fetch_add(1, Ordering::SeqCst);
        fs::rename(entry, self.bin.join(format!("{n:03}-{name}")))
            .map_err(|error| error.to_string())?;
        self.moved.lock().unwrap().push(entry.to_path_buf());
        Ok(())
    }
}

/// Register `root` as a Captures location and index every file below it as
/// one session of lights.
pub async fn index_folder(library: &Library, root: &Path, name: &str) -> Location {
    let location = library
        .register_location(NativePath::from_path(root), name.into(), LocationRole::Captures)
        .await
        .unwrap();
    let catalog = library.catalog();
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(folder) = pending.pop() {
        for entry in fs::read_dir(&folder).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            files.push(ScanFile {
                relative_path: NativePath::from_path(path.strip_prefix(root).unwrap()),
                fingerprint: InventoryProbe.fingerprint(&path).unwrap(),
                format: ImageFormat::Fits,
                metadata: CaptureMetadata {
                    image_type: Some("LIGHT".into()),
                    filter: Some("Ha".into()),
                    exposure_seconds: Some(300.0),
                    date_local: Some("2026-09-18T22:00:00".into()),
                    ..CaptureMetadata::default()
                },
            });
        }
    }
    let one_session = |assets: &[Asset]| GroupingResult {
        sessions: vec![SessionCandidate {
            key: CaptureKey("capture-v1|indexed-results".into()),
            asset_ids: {
                let mut ids: Vec<Uuid> = assets.iter().map(|asset| asset.id).collect();
                ids.sort_unstable();
                ids
            },
            provisional: Vec::new(),
            date_basis: Some("date-loc-noon".into()),
        }],
    };
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let identity = InventoryProbe.root_identity(&location).unwrap();
    let count = files.len() as u64;
    let progress =
        ScanProgress { discovered: count, metadata_read: count, ..ScanProgress::default() };
    let batch = ScanBatch { files: files.clone(), issues: Vec::new(), progress: progress.clone() };
    catalog.apply_scan_batch(operation.id, &identity, &batch, one_session).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: identity,
        incomplete_scopes: Vec::new(),
        files,
        issues: Vec::new(),
        complete_scopes: vec![NativePath::UnixBytes(Vec::new())],
        progress,
        state: ScanState::Completed,
    };
    let finished = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| InventoryProbe.root_identity(location),
            one_session,
        )
        .await
        .unwrap();
    assert_eq!(finished.state, ScanState::Completed);
    location
}

/// Decide `quality` for every frame at `paths`.
pub async fn decide(library: &Library, location: &Location, paths: &[&str], quality: Quality) {
    let assets = library.catalog().location_assets(location.id).await.unwrap();
    let expected: Vec<ExpectedAsset> = assets
        .into_iter()
        .filter(|asset| paths.contains(&asset.relative_path.display().as_str()))
        .map(|asset| ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint,
        })
        .collect();
    assert_eq!(expected.len(), paths.len(), "every frame to decide is indexed");
    library.catalog().set_quality(&expected, quality, InventoryProbe).await.unwrap();
}

/// Every library frame with its availability and quality decision.
pub async fn frames(library: &Library) -> Vec<(Uuid, String, Availability, Quality, Revision)> {
    let mut frames = Vec::new();
    for location in library.catalog().list_locations().await.unwrap() {
        for asset in library.catalog().location_assets(location.id).await.unwrap() {
            frames.push((
                asset.id,
                asset.relative_path.display(),
                asset.availability,
                asset.quality,
                asset.decision_revision,
            ));
        }
    }
    frames.sort_by_key(|frame| frame.0);
    frames
}

/// Run one SQL statement on the catalog file outside the library.
pub async fn try_raw_sql(database: &Path, statement: &str) -> Result<(), sqlx::Error> {
    let options = SqliteConnectOptions::new().filename(database);
    let mut conn = SqliteConnection::connect_with(&options).await?;
    let result = sqlx::query(sqlx::AssertSqlSafe(statement.to_owned())).execute(&mut conn).await;
    conn.close().await?;
    result.map(drop)
}

/// Every item of `review`, in group order.
pub fn items(review: &CleanupReview) -> Vec<&CleanupItem> {
    review.groups.iter().flat_map(|group| &group.items).collect()
}

/// The paths of `items` as native paths.
pub fn paths<'a>(items: impl IntoIterator<Item = &'a CleanupItem>) -> Vec<PathBuf> {
    items.into_iter().map(|item| item.path.to_path_buf().unwrap()).collect()
}

/// The reason code an item stays for, if it stays.
pub fn stays_for(item: &CleanupItem) -> Option<ReasonCode> {
    match &item.state {
        CleanupItemState::Stays { reason } => Some(reason.code),
        _ => None,
    }
}
