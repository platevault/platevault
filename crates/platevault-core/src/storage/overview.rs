// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Storage overview (STO-FR-11, STO-FR-12, STO-AC-12, D16): registered
//! locations with their availability, library-wide content-identity
//! duplicate candidates and verified transfers, each with the archive it
//! carries, in its own section. A Project's footprint is its Apply sheet's
//! (PREP-FR-08).
//!
//! The overview only reads. Displaying a duplicate candidate authorizes
//! nothing: it records no operation, approves no removal and changes no
//! decision; removal stays with the reviewed custody scopes. Before anything
//! mutates, the overview re-reads every open transfer item's reviewed source
//! and written copy by their recorded no-follow identity, size and
//! modification time. An entry changed or removed outside `PlateVault`
//! blocks that item for review; an entry whose folder is unreachable is an
//! availability matter, never drift. Bytes are not hashed here: every
//! mutation still re-verifies its SHA-256 immediately before it moves
//! anything (D19).

use std::fs;
use std::path::{Path, PathBuf};

use persistence_library::{ArchiveOwner, DuplicateCopy, LocationFailure};
use serde::Serialize;
use uuid::Uuid;

use crate::custody::{in_place, same_identity};
use crate::library::{blocking, Library};
use crate::{
    inventory, EntryEvidence, ItemOutcome, ItemPhase, ItemReason, LibraryError, Location,
    NativePath, ReasonCode, Revision, StorageItem, StorageOperation, StorageOperationKind,
    StorageOperationState, TransferDestination, WrittenCopy,
};

/// What Storage shows, one section per concern.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOverview {
    pub locations: Vec<LocationAvailability>,
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

/// Live copies sharing one SHA-256 (D16). A candidate is shown only: it
/// carries no approval and no operation.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidate {
    pub sha256: String,
    pub size_bytes: u64,
    pub copies: Vec<DuplicateCopy>,
}

/// A verified transfer with each item's recorded phase and, for an Archive,
/// whose archive it is: a Project's Wrap up or Sessions > Archive
/// (STO-FR-11, STO-FR-13).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferView {
    pub operation_id: Uuid,
    pub kind: StorageOperationKind,
    pub state: StorageOperationState,
    pub archive: Option<ArchiveOwner>,
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
        Ok(StorageOverview {
            locations: self.location_availability().await?,
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
    archive: Option<ArchiveOwner>,
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
