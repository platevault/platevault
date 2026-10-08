// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Storage overview (STO-FR-11, STO-FR-12, STO-AC-12, D16): registered
//! locations with their availability, run footprints (each run's, and each
//! run group's Prepare all), library-wide content-identity duplicate
//! candidates and archive transfers, each in its own section.
//!
//! The overview only reads. Displaying a duplicate candidate authorizes
//! nothing: it records no operation, approves no removal and changes no
//! decision; removal stays with the reviewed custody scopes. Before anything
//! mutates, the overview re-reads every entry the application wrote (a
//! prepared link, clone or copy) and every open transfer item's reviewed
//! source and written copy by their recorded no-follow identity, size and
//! modification time, a link by its target text. An entry changed or removed
//! outside `PlateVault` blocks that item for review; an entry whose folder is
//! unreachable is an availability matter, never drift. Bytes are not hashed
//! here: every mutation still re-verifies its SHA-256 immediately before it
//! moves anything (D19).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use persistence_library::{DuplicateCopy, LocationFailure, PreparationRecord};
use serde::Serialize;
use uuid::Uuid;

use crate::custody::{in_place, same_identity};
use crate::library::{blocking, Library};
use crate::{
    inventory, EntryEvidence, EntryState, InputMode, ItemOutcome, ItemPhase, ItemReason,
    LibraryError, LinkKind, Location, NativePath, PreparationState, PreparedEntry,
    PreparedEntryKey, PreparedEntryKind, ReasonCode, Revision, StorageItem, StorageOperation,
    StorageOperationKind, StorageOperationState, TransferArchive, TransferDestination, WrittenCopy,
};

/// What Storage shows, one section per concern.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    pub locations: Vec<LocationAvailability>,
    pub footprints: Vec<RunFootprint>,
    /// Run groups' Prepare all footprints; each `Panel N/` folder is also its
    /// panel run's revision in `footprints`.
    pub group_footprints: Vec<GroupFootprint>,
    pub duplicates: Vec<DuplicateCandidate>,
    pub transfers: Vec<TransferView>,
}

/// A registered location with its last-observed availability and the access
/// failure LIB recorded, if any.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationAvailability {
    pub location: Location,
    pub failure: Option<LocationFailure>,
}

/// The folders a run's preparations wrote and the bytes their copies hold.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFootprint {
    pub view_id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    /// The run is in its Project's Trash; its folders stay until Empty Trash.
    pub in_project_trash: bool,
    pub results_folder: Option<NativePath>,
    pub revisions: Vec<RevisionFootprint>,
    /// Bytes held by every revision's copies.
    pub footprint_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionFootprint {
    pub preparation_id: Uuid,
    pub n: u32,
    pub folder: NativePath,
    /// The Prepare all whose group folder holds this panel run revision.
    pub group_preparation_id: Option<Uuid>,
    pub state: PreparationState,
    pub mode: InputMode,
    pub link: Option<LinkKind>,
    /// Entries the preparation wrote: links, clones and copies.
    pub entries: u32,
    /// Bytes held by its copies, as Review preparation counts the footprint.
    pub footprint_bytes: u64,
    /// Written entries blocked for review: recorded drift, or drift found now.
    pub blocked: Vec<BlockedEntry>,
}

/// The folders a run group's Prepare all revisions wrote (PREP-FR-12/13):
/// each group folder, holding one `Panel N/` per panel run, and the group's
/// `<Mosaic> Results/Assembled/`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupFootprint {
    pub group_id: Uuid,
    pub project_id: Uuid,
    /// The mosaic's name: the `<Mosaic>` of its group and Results folders.
    pub name: String,
    pub assembled_folder: Option<NativePath>,
    pub revisions: Vec<GroupRevisionFootprint>,
    /// Bytes held by the copies of every revision's panel runs.
    pub footprint_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRevisionFootprint {
    pub group_preparation_id: Uuid,
    pub n: u32,
    /// `<Mosaic>/` or `<Mosaic> (rev N)/`.
    pub folder: NativePath,
    pub outcome: PreparationState,
    /// The panel run revisions in its `Panel N/` folders.
    pub panel_preparations: Vec<Uuid>,
    /// Bytes held by those revisions' copies.
    pub footprint_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedEntry {
    pub seq: u32,
    pub path: NativePath,
    pub reason: ItemReason,
}

/// Live copies sharing one SHA-256 (D16). A candidate is shown only: it
/// carries no approval and no operation.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidate {
    pub sha256: String,
    pub size_bytes: u64,
    pub copies: Vec<DuplicateCopy>,
}

/// A verified transfer with each item's recorded phase and, for an Archive
/// or restore, the transfer of its Project it carries (STO-FR-11).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferView {
    pub operation_id: Uuid,
    pub kind: StorageOperationKind,
    pub state: StorageOperationState,
    pub archive: Option<TransferArchive>,
    pub created_at: String,
    pub updated_at: String,
    pub items: Vec<TransferItemView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferItemView {
    pub seq: u32,
    pub source: NativePath,
    pub destination: Option<TransferDestination>,
    pub phase: ItemPhase,
    pub outcome: Option<ItemOutcome>,
    pub reason: Option<ItemReason>,
    /// External drift found in the item's reviewed source or written copy:
    /// the item is blocked for review.
    pub blocked: Option<ItemReason>,
}

impl Library {
    /// The Storage overview. Reads only: no operation is recorded and no
    /// file, decision or journal entry changes.
    ///
    /// # Errors
    /// Catalog read failures.
    pub async fn storage_overview(&self) -> Result<StorageOverview, LibraryError> {
        let locations = self.location_availability().await?;
        let footprints = self.run_footprints().await?;
        let group_footprints = self.group_footprints(&footprints).await?;
        Ok(StorageOverview {
            locations,
            footprints,
            group_footprints,
            duplicates: duplicate_candidates(self.catalog().live_duplicate_copies().await?),
            transfers: self.transfer_views().await?,
        })
    }

    async fn location_availability(&self) -> Result<Vec<LocationAvailability>, LibraryError> {
        let catalog = self.catalog();
        let locations = catalog.list_locations().await?;
        let mut states = Vec::with_capacity(locations.len());
        for location in locations {
            let failure = catalog.location_failure(location.id).await?;
            states.push(LocationAvailability { location, failure });
        }
        Ok(states)
    }

    async fn run_footprints(&self) -> Result<Vec<RunFootprint>, LibraryError> {
        let catalog = self.catalog();
        let mut runs = Vec::new();
        for view_id in catalog.runs_with_footprint().await? {
            let record = catalog.view(view_id).await?;
            let name = record
                .revision
                .as_ref()
                .map(|header| header.name.clone())
                .or_else(|| record.draft.as_ref().map(|draft| draft.name.clone()))
                .unwrap_or_default();
            let mut preparations = Vec::new();
            for revision in catalog.view_preparations(view_id).await? {
                preparations.push(catalog.preparation(revision.id).await?);
            }
            let removed = catalog.removed_prepared_entries(view_id).await?;
            let revisions = blocking(move || {
                Ok(preparations
                    .into_iter()
                    .map(|record| revision_footprint(record, &removed))
                    .collect::<Vec<_>>())
            })
            .await?;
            runs.push(RunFootprint {
                view_id,
                project_id: record.view.project_id,
                name,
                in_project_trash: record.view.trashed_at.is_some(),
                results_folder: catalog.view_results_folder(view_id).await?,
                footprint_bytes: revisions.iter().map(|revision| revision.footprint_bytes).sum(),
                revisions,
            });
        }
        runs.sort_by(|left, right| {
            left.name.cmp(&right.name).then(left.view_id.cmp(&right.view_id))
        });
        Ok(runs)
    }

    /// Each run group's Prepare all revisions, counting the bytes of the
    /// panel run revisions `runs` lists in each group folder.
    async fn group_footprints(
        &self,
        runs: &[RunFootprint],
    ) -> Result<Vec<GroupFootprint>, LibraryError> {
        let catalog = self.catalog();
        let mut groups = Vec::new();
        for group_id in catalog.groups_with_footprint().await? {
            let basis = catalog.group_preparation_basis(group_id).await?;
            let revisions: Vec<GroupRevisionFootprint> = basis
                .preparations
                .into_iter()
                .map(|preparation| {
                    let panels: Vec<&RevisionFootprint> = runs
                        .iter()
                        .flat_map(|run| &run.revisions)
                        .filter(|revision| revision.group_preparation_id == Some(preparation.id))
                        .collect();
                    GroupRevisionFootprint {
                        group_preparation_id: preparation.id,
                        n: preparation.n,
                        folder: preparation.folder,
                        outcome: preparation.outcome,
                        panel_preparations: panels
                            .iter()
                            .map(|revision| revision.preparation_id)
                            .collect(),
                        footprint_bytes: panels
                            .iter()
                            .map(|revision| revision.footprint_bytes)
                            .sum(),
                    }
                })
                .collect();
            groups.push(GroupFootprint {
                group_id,
                project_id: basis.group.project_id,
                name: basis.group.name,
                assembled_folder: basis.assembled,
                footprint_bytes: revisions.iter().map(|revision| revision.footprint_bytes).sum(),
                revisions,
            });
        }
        groups.sort_by(|left, right| {
            left.name.cmp(&right.name).then(left.group_id.cmp(&right.group_id))
        });
        Ok(groups)
    }

    async fn transfer_views(&self) -> Result<Vec<TransferView>, LibraryError> {
        let catalog = self.catalog();
        let mut views = Vec::new();
        for transfer in catalog.archive_transfers().await? {
            let (operation, archive) = (transfer.operation, transfer.archive);
            if operation.state == StorageOperationState::Settled {
                views.push(transfer_view(operation, archive, &[]));
                continue;
            }
            let items = operation.items.clone();
            let found = blocking(move || {
                Ok(items
                    .iter()
                    .filter_map(|item| {
                        transfer_drift(item).map(|reason| (item.seq, item.revision, reason))
                    })
                    .collect::<Vec<_>>())
            })
            .await?;
            // An executor may have advanced an item while it was re-read; only
            // an item still at the recorded revision it was checked against
            // is blocked.
            let operation = if found.is_empty() {
                operation
            } else {
                catalog.storage_operation(operation.id).await?
            };
            views.push(transfer_view(operation, archive, &found));
        }
        Ok(views)
    }
}

/// One revision's footprint, re-reading every entry it wrote. An entry a
/// run Clean up moved to the OS Trash (`removed`) holds nothing and never
/// reads as drift: `PlateVault` moved it. Runs off the async runtime.
fn revision_footprint(
    record: PreparationRecord,
    removed: &HashSet<PreparedEntryKey>,
) -> RevisionFootprint {
    let running = record.revision.state == PreparationState::Running;
    let mut entries = 0;
    let mut footprint_bytes = 0;
    let mut blocked = Vec::new();
    for entry in &record.entries {
        let key = PreparedEntryKey { preparation_id: record.revision.id, seq: entry.seq };
        if !entry.kind.created()
            || !matches!(entry.state, EntryState::Prepared | EntryState::Drifted)
            || removed.contains(&key)
        {
            continue;
        }
        entries += 1;
        if entry.kind == PreparedEntryKind::Copy {
            footprint_bytes += entry.size_bytes;
        }
        if let Some(reason) = entry_block(entry, running) {
            blocked.push(BlockedEntry { seq: entry.seq, path: entry.path.clone(), reason });
        }
    }
    let revision = record.revision;
    RevisionFootprint {
        preparation_id: revision.id,
        n: revision.n,
        folder: revision.folder,
        group_preparation_id: revision.group_preparation_id,
        state: revision.state,
        mode: revision.mode,
        link: revision.link,
        entries,
        footprint_bytes,
        blocked,
    }
}

/// Why a written entry is blocked for review: drift a re-verification
/// recorded, or external drift found now. A Running revision is being
/// written right now, so its entries are shown by their recorded state only.
fn entry_block(entry: &PreparedEntry, running: bool) -> Option<ItemReason> {
    if entry.state == EntryState::Drifted {
        return entry.reason.clone();
    }
    if running {
        return None;
    }
    match &entry.entry_identity {
        Some(identity) => written_entry_drift(identity),
        None => Some(ItemReason::new(
            ReasonCode::Interrupted,
            format!("{} has no recorded entry", entry.path.display()),
        )),
    }
}

/// Group live copies by digest, largest reclaim first.
fn duplicate_candidates(copies: Vec<DuplicateCopy>) -> Vec<DuplicateCandidate> {
    let mut candidates: Vec<DuplicateCandidate> = Vec::new();
    for copy in copies {
        match candidates.last_mut() {
            Some(candidate) if candidate.sha256 == copy.sha256 => candidate.copies.push(copy),
            _ => candidates.push(DuplicateCandidate {
                sha256: copy.sha256.clone(),
                size_bytes: copy.size_bytes,
                copies: vec![copy],
            }),
        }
    }
    candidates.sort_by(|left, right| {
        right.size_bytes.cmp(&left.size_bytes).then_with(|| left.sha256.cmp(&right.sha256))
    });
    candidates
}

fn transfer_view(
    operation: StorageOperation,
    archive: Option<TransferArchive>,
    found: &[(u32, Revision, ItemReason)],
) -> TransferView {
    TransferView {
        operation_id: operation.id,
        kind: operation.kind,
        state: operation.state,
        archive,
        created_at: operation.created_at,
        updated_at: operation.updated_at,
        items: operation
            .items
            .into_iter()
            .map(|item| {
                let blocked = found
                    .iter()
                    .find(|(seq, revision, _)| {
                        *seq == item.seq && *revision == item.revision && item.outcome.is_none()
                    })
                    .map(|(_, _, reason)| reason.clone());
                TransferItemView {
                    seq: item.seq,
                    source: item.source.path,
                    destination: item.destination,
                    phase: item.phase,
                    outcome: item.outcome,
                    reason: item.reason,
                    blocked,
                }
            })
            .collect(),
    }
}

/// How an entry at its path differs from its record.
enum Drift {
    /// Something other than the recorded entry is there.
    Changed(String),
    /// The entry is gone while its folder is still reachable.
    Removed(String),
}

impl Drift {
    fn detail(self) -> String {
        match self {
            Self::Changed(detail) | Self::Removed(detail) => detail,
        }
    }
}

/// External drift at `path` when it no longer `holds` its recorded entry.
/// An unreachable folder (an unmounted volume) is availability, not drift.
fn drift(path: &Path, holds: bool) -> Option<Drift> {
    if holds {
        return None;
    }
    if fs::symlink_metadata(path).is_ok() {
        return Some(Drift::Changed(format!(
            "{} changed outside PlateVault since it was recorded",
            path.display()
        )));
    }
    let reachable = path.parent().is_some_and(|folder| fs::symlink_metadata(folder).is_ok());
    reachable.then(|| Drift::Removed(format!("{} was removed outside PlateVault", path.display())))
}

fn evidence_drift(entry: &EntryEvidence) -> Option<Drift> {
    let path = entry.path.to_path_buf().ok()?;
    drift(&path, in_place(entry))
}

/// A prepared link, clone or copy the application wrote.
fn written_entry_drift(entry: &EntryEvidence) -> Option<ItemReason> {
    evidence_drift(entry)
        .map(|found| ItemReason::new(ReasonCode::DestinationMismatch, found.detail()))
}

/// Whether `path` is the regular file a transfer wrote, of `size` bytes once
/// it is complete.
fn holds_copy(path: &Path, written: &WrittenCopy, size: Option<u64>) -> bool {
    inventory::probe_fingerprint(path).is_ok_and(|observed| {
        same_identity(&observed.identity, &written.identity)
            && size.is_none_or(|size| observed.size_bytes == size)
    })
}

fn destination_file(destination: &TransferDestination) -> Option<PathBuf> {
    let root = destination.root.to_path_buf().ok()?;
    Some(root.join(destination.relative.relative_path().ok()?))
}

/// External drift of an open transfer item: its reviewed source while the
/// source is retained, an entry at a destination it has not written yet, and
/// the copy it wrote once it is recorded.
fn transfer_drift(item: &StorageItem) -> Option<ItemReason> {
    if item.outcome.is_some() {
        return None;
    }
    let retained = matches!(
        item.phase,
        ItemPhase::Pending
            | ItemPhase::Writing
            | ItemPhase::Installed
            | ItemPhase::DestinationVerified
    );
    if retained {
        match evidence_drift(&item.source) {
            Some(Drift::Changed(detail)) => {
                return Some(ItemReason::new(ReasonCode::SourceDrift, detail));
            }
            Some(Drift::Removed(detail)) => {
                return Some(ItemReason::new(ReasonCode::SourceUnavailable, detail));
            }
            None => {}
        }
    }
    let target = destination_file(item.destination.as_ref()?)?;
    let changed = |found: Drift| ItemReason::new(ReasonCode::DestinationChanged, found.detail());
    match (item.phase, item.written.as_ref()) {
        (ItemPhase::Pending, _) => fs::symlink_metadata(&target).is_ok().then(|| {
            ItemReason::new(
                ReasonCode::DestinationOccupied,
                format!("{} already holds an entry; nothing is replaced", target.display()),
            )
        }),
        (ItemPhase::Writing, Some(written)) => {
            let partial = written.partial.to_path_buf().ok()?;
            let holds = holds_copy(&partial, written, None) || holds_copy(&target, written, None);
            drift(&partial, holds).map(changed)
        }
        (
            ItemPhase::Installed | ItemPhase::DestinationVerified | ItemPhase::Retiring,
            Some(written),
        ) => {
            let size = Some(item.source.fingerprint.size_bytes);
            drift(&target, holds_copy(&target, written, size)).map(changed)
        }
        _ => None,
    }
}
