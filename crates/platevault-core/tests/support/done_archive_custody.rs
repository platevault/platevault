// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixtures of the Done / Archive custody tests (spec 071
//! STO-FR-06..08/13..16): a stand-in OS Trash that keeps what it receives,
//! can refuse chosen paths as a volume that deletes immediately, and can hold
//! a move open; byte-identical copies of the PREP world's lights in other
//! Captures locations; and the approvals a user gives on the sheet.
//! Included with `#[path = "support/done_archive_custody.rs"] mod custody_support;`
//! beside `done_archive_support`, `prepare_support`, `results_support` and
//! `support`.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};

use persistence_library::SessionQuery;
use platevault_core::custody::trash::OsTrash;
use platevault_core::*;
use uuid::Uuid;

use super::done_archive_support::{asset_at, hashed, light_metadata, register, scan};
use super::prepare_support::World;

/// A stand-in OS Trash: each entry itself is renamed into a private bin, so
/// nothing is ever deleted. Entries below a refused prefix read as a volume
/// whose OS removal deletes immediately; entries below a misreported prefix
/// are moved but reported as refused; a gated move waits until released.
pub struct Bin {
    folder: PathBuf,
    refused: Mutex<Vec<PathBuf>>,
    misreported: Mutex<Vec<PathBuf>>,
    moved: Mutex<Vec<(PathBuf, PathBuf)>>,
    gate: Mutex<Option<Gate>>,
}

struct Gate {
    reached: Arc<tokio::sync::Notify>,
    release: mpsc::Receiver<()>,
}

impl Bin {
    pub fn new(world: &World) -> Arc<Self> {
        let folder = world.temp.path().join("OS Trash");
        fs::create_dir_all(&folder).unwrap();
        Arc::new(Self {
            folder,
            refused: Mutex::default(),
            misreported: Mutex::default(),
            moved: Mutex::default(),
            gate: Mutex::default(),
        })
    }

    pub fn trash(self: &Arc<Self>) -> Arc<dyn OsTrash> {
        Arc::clone(self) as Arc<dyn OsTrash>
    }

    /// Entries at or below `path` sit where the OS deletes immediately.
    pub fn refuse(&self, path: &Path) {
        self.refused.lock().unwrap().push(path.to_path_buf());
    }

    /// Entries at or below `path` are moved, but the OS reports a failure,
    /// so custody cannot prove where they went: an Uncertain retirement.
    pub fn misreport(&self, path: &Path) {
        self.misreported.lock().unwrap().push(path.to_path_buf());
    }

    /// Hold the next move open: `reached` fires once it is requested, and it
    /// proceeds once the returned sender sends or is dropped.
    pub fn hold_next(&self) -> (Arc<tokio::sync::Notify>, mpsc::Sender<()>) {
        let (release_tx, release) = mpsc::channel();
        let reached = Arc::new(tokio::sync::Notify::new());
        *self.gate.lock().unwrap() = Some(Gate { reached: Arc::clone(&reached), release });
        (reached, release_tx)
    }

    /// Where the bin keeps the entry that was at `original`.
    pub fn kept(&self, original: &Path) -> Option<PathBuf> {
        self.moved
            .lock()
            .unwrap()
            .iter()
            .find(|(from, _)| from == original)
            .map(|(_, to)| to.clone())
    }

    pub fn moved(&self) -> Vec<PathBuf> {
        self.moved.lock().unwrap().iter().map(|(from, _)| from.clone()).collect()
    }
}

impl OsTrash for Bin {
    fn support(&self, entry: &Path, _size_bytes: u64) -> TrashSupport {
        if self.refused.lock().unwrap().iter().any(|prefix| entry.starts_with(prefix)) {
            return TrashSupport::Unsupported {
                reason: TrashUnsupported::DeletesImmediately,
                detail: "the volume deletes items immediately".into(),
            };
        }
        TrashSupport::Supported
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        let gate = self.gate.lock().unwrap().take();
        if let Some(gate) = gate {
            gate.reached.notify_one();
            let _ = gate.release.recv();
        }
        let name = entry.file_name().ok_or("an entry has a name")?.to_string_lossy();
        let mut moved = self.moved.lock().unwrap();
        let kept = self.folder.join(format!("{}-{name}", moved.len()));
        fs::rename(entry, &kept).map_err(|error| error.to_string())?;
        moved.push((entry.to_path_buf(), kept));
        drop(moved);
        if self.misreported.lock().unwrap().iter().any(|prefix| entry.starts_with(prefix)) {
            return Err("the OS Trash reported a failure after moving the entry".into());
        }
        Ok(())
    }
}

/// The session holding the world's Captures copy of light `path`.
pub async fn session_of(world: &World, path: &str) -> Uuid {
    let asset = asset_at(world, &world.captures, path).await;
    world
        .catalog()
        .list_sessions(&SessionQuery::default())
        .await
        .unwrap()
        .into_iter()
        .map(|summary| summary.session)
        .find(|session| session.asset_ids.contains(&asset.id))
        .unwrap_or_else(|| panic!("{path} is in no listed session"))
        .id
}

/// Register the empty Captures location `Archive`.
pub async fn archive_location(world: &World) -> Location {
    register(world, "Archive", LocationRole::Captures).await
}

/// Register Captures location `name` holding byte-identical copies of the
/// world's lights `paths`, every copy hashed; returns the location and the
/// copies in `paths` order.
pub async fn copies_in(world: &World, name: &str, paths: &[&str]) -> (Location, Vec<Asset>) {
    let location = register(world, name, LocationRole::Captures).await;
    let files: Vec<(&str, Vec<u8>, CaptureMetadata)> = paths
        .iter()
        .map(|path| {
            let (filter, night) =
                if path.contains("OIII") { ("OIII", "2026-09-24") } else { ("Ha", "2026-09-18") };
            (*path, fs::read(world.light(path)).unwrap(), light_metadata(filter, night))
        })
        .collect();
    scan(world, &location, &files).await;
    let mut copies = Vec::new();
    for path in paths {
        hashed(world, &asset_at(world, &world.captures, path).await).await;
        copies.push(hashed(world, &asset_at(world, &location, path).await).await);
    }
    (location, copies)
}

/// The file recorded at `path` below `location`.
pub fn file_in(location: &Location, path: &str) -> PathBuf {
    location.path.to_path_buf().unwrap().join(path)
}

/// The catalog record of `id`, wherever it is now.
pub async fn record(world: &World, id: Uuid) -> Asset {
    world.catalog().asset(id).await.unwrap()
}

/// Approve every frame the rejected-frames offer lists, with its copies.
pub fn approve_rejected(sheet: &DoneArchiveSheet) -> RejectedFramesApproval {
    RejectedFramesApproval {
        project_revision: sheet.project_revision,
        frames: sheet
            .rejected_frames
            .frames
            .iter()
            .map(|frame| ApprovedFrame {
                frame_key: frame.frame_key,
                copies: frame.copies.iter().map(|copy| copy.asset_id).collect(),
            })
            .collect(),
    }
}

/// Approve every extra copy the duplicates offer lists, with its kept copy.
pub fn approve_duplicates(sheet: &DoneArchiveSheet) -> DuplicatesApproval {
    DuplicatesApproval {
        project_revision: sheet.project_revision,
        copies: sheet
            .duplicates
            .frames
            .iter()
            .flat_map(|frame| {
                frame.offered.iter().map(|copy| ApprovedCopy {
                    asset_id: copy.asset_id,
                    kept_asset_id: frame.kept.asset_id,
                })
            })
            .collect(),
    }
}

/// Approve every item the intermediates offer lists.
pub fn approve_intermediates(sheet: &DoneArchiveSheet) -> IntermediatesApproval {
    IntermediatesApproval {
        project_revision: sheet.project_revision,
        items: sheet.intermediates.items.iter().map(|item| item.result_id).collect(),
    }
}

/// The reason codes a refusal lists for its custody checks.
pub fn custody_codes(refused: &RefusedMove) -> Vec<ReasonCode> {
    refused
        .reasons
        .iter()
        .filter_map(|reason| match reason {
            MoveRefusal::Custody { reason, .. } => Some(reason.code),
            _ => None,
        })
        .collect()
}

/// Another open Project `name` on the world's Target and rig whose run `run`
/// selects every candidate session but `deselected`.
pub async fn project_without(
    world: &World,
    name: &str,
    run: &str,
    deselected: &[Uuid],
) -> (Uuid, Uuid) {
    let catalog = world.catalog();
    let other = open_project(world, name).await;
    let view = world.view().await;
    let record = catalog
        .create_view(&NewView {
            project_id: other,
            subject_id: catalog.project(other).await.unwrap().subjects[0].id,
            rig_id: view.rig_id,
            name: run.into(),
        })
        .await
        .unwrap();
    let mut draft = 1;
    if !deselected.is_empty() {
        let edit = DraftEdit::DeselectSessions { session_ids: deselected.to_vec() };
        catalog.edit_view_draft(record.view.id, draft, &edit).await.unwrap();
        draft += 1;
    }
    catalog.save_view(record.view.id, 0, draft).await.unwrap();
    (other, record.view.id)
}

/// Another open Project `name` on the world's Target and rig, with no run.
pub async fn open_project(world: &World, name: &str) -> Uuid {
    let view = world.view().await;
    let catalog = world.catalog();
    let target = catalog.project(view.project_id).await.unwrap().subjects[0].target_id;
    catalog
        .create_project(&ProjectInput {
            name: name.into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: target,
                name: None,
                mosaic: false,
                panels: Vec::new(),
            }],
            rig_ids: vec![view.rig_id],
            goals: Vec::new(),
        })
        .await
        .unwrap()
        .id
}
