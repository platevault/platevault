// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Resumable storage operation journal (STO-FR-05, STO-FR-07, STO-FR-08).
//!
//! Execution advances one item at a time through the catalog's storage
//! journal. A phase that leads into a filesystem change is recorded before
//! the change: a partial copy's identity before any byte is written, and the
//! intent to retire before the OS Trash is asked to move the entry. A resumed
//! item therefore decides from recorded identities and never from whether a
//! file name is present: a recorded copy is found by its identity at the
//! partial or destination name, a foreign file at the destination is a
//! collision, and an entry missing after a recorded retirement intent is
//! Uncertain rather than Trashed.

use std::collections::HashSet;
use std::sync::{Arc, LazyLock, Mutex};

use uuid::Uuid;

use super::trash::{self, OsTrash, Retirement};
use super::{blocking, in_place, transfer};
use crate::library::Library;
use crate::{
    ItemChange, ItemOutcome, ItemPhase, ItemReason, LibraryError, ReasonCode, StorageItem,
    StorageOperation, StorageOperationKind, StorageOperationState,
};
use persistence_library::Catalog;

/// Operations an executor of this process is advancing right now.
static LIVE: LazyLock<Mutex<HashSet<Uuid>>> = LazyLock::new(Mutex::default);

/// Exclusive claim on one operation for this process; released on drop.
struct Live(Uuid);

impl Live {
    fn claim(id: Uuid) -> Result<Self, LibraryError> {
        let claimed = LIVE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).insert(id);
        if !claimed {
            return Err(LibraryError::InvalidInput(format!(
                "storage operation {id} is already running"
            )));
        }
        Ok(Self(id))
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        LIVE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&self.0);
    }
}

impl Library {
    /// Advance one open item of a recorded operation by one durable step and
    /// return the operation. A reviewed operation starts; one left running by
    /// an earlier process resumes from its recorded phases; a settled one is
    /// returned unchanged.
    ///
    /// # Errors
    /// `InvalidInput` while another call is advancing the same operation;
    /// `NotFound` for an unknown operation; catalog failures.
    pub async fn step_storage_operation(
        &self,
        id: Uuid,
        trash: Arc<dyn OsTrash>,
    ) -> Result<StorageOperation, LibraryError> {
        let _live = Live::claim(id)?;
        step(self.catalog(), id, &trash).await
    }

    /// Run or resume a recorded operation until every item has an outcome,
    /// then settle it. Items that are blocked or uncertain do not stop the
    /// others.
    ///
    /// # Errors
    /// As [`Self::step_storage_operation`].
    pub async fn run_storage_operation(
        &self,
        id: Uuid,
        trash: Arc<dyn OsTrash>,
    ) -> Result<StorageOperation, LibraryError> {
        let _live = Live::claim(id)?;
        loop {
            let operation = step(self.catalog(), id, &trash).await?;
            if operation.state == StorageOperationState::Settled {
                return Ok(operation);
            }
        }
    }
}

async fn step(
    catalog: &Catalog,
    id: Uuid,
    trash: &Arc<dyn OsTrash>,
) -> Result<StorageOperation, LibraryError> {
    let mut operation = catalog.storage_operation(id).await?;
    match operation.state {
        StorageOperationState::Settled => return Ok(operation),
        StorageOperationState::Reviewed => operation = catalog.start_storage_operation(id).await?,
        StorageOperationState::Running => {}
    }
    if let Some(item) = operation.items.iter().find(|item| item.outcome.is_none()).cloned() {
        advance(catalog, id, operation.kind, item, trash).await?;
        operation = catalog.storage_operation(id).await?;
    }
    if operation.items.iter().all(|item| item.outcome.is_some()) {
        return catalog.settle_storage_operation(id).await;
    }
    Ok(operation)
}

fn change(item: &StorageItem, phase: ItemPhase) -> ItemChange {
    ItemChange { phase, outcome: None, reason: None, written: item.written.clone() }
}

fn settled(item: &StorageItem, outcome: ItemOutcome, reason: Option<ItemReason>) -> ItemChange {
    ItemChange {
        phase: ItemPhase::Settled,
        outcome: Some(outcome),
        reason,
        written: item.written.clone(),
    }
}

fn interrupted(item: &StorageItem) -> ItemChange {
    settled(
        item,
        ItemOutcome::Uncertain,
        Some(ItemReason::new(
            ReasonCode::Interrupted,
            "the move to the OS Trash was requested before an interruption and the entry is no \
             longer in place with its recorded identity; check the OS Trash",
        )),
    )
}

async fn record(
    catalog: &Catalog,
    id: Uuid,
    item: &StorageItem,
    change: &ItemChange,
) -> Result<StorageItem, LibraryError> {
    catalog.advance_storage_item(id, item.seq, item.revision, change).await
}

async fn advance(
    catalog: &Catalog,
    id: Uuid,
    kind: StorageOperationKind,
    item: StorageItem,
    trash: &Arc<dyn OsTrash>,
) -> Result<(), LibraryError> {
    use StorageOperationKind::{Copy, Move, Trash};
    let next = match (kind, item.phase) {
        (Trash, ItemPhase::Pending) | (Move, ItemPhase::DestinationVerified) => {
            let retiring = record(catalog, id, &item, &change(&item, ItemPhase::Retiring)).await?;
            retire(kind, retiring, trash).await?
        }
        (Trash | Move, ItemPhase::Retiring) => {
            let source = item.source.clone();
            if blocking(move || in_place(&source)).await? {
                retire(kind, item, trash).await?
            } else {
                (interrupted(&item), item)
            }
        }
        (Copy | Move, ItemPhase::Pending) => {
            let destination = destination(&item)?;
            let seq = item.seq;
            match blocking(move || transfer::begin(id, seq, &destination)).await? {
                Ok(written) => {
                    let next =
                        ItemChange { written: Some(written), ..change(&item, ItemPhase::Writing) };
                    (next, item)
                }
                Err(reason) => (settled(&item, ItemOutcome::Blocked, Some(reason)), item),
            }
        }
        (Copy | Move, ItemPhase::Writing) => {
            let (source, destination, written) =
                (item.source.clone(), destination(&item)?, written(&item)?);
            let next =
                match blocking(move || transfer::write(&source, &destination, &written)).await? {
                    Ok(()) => change(&item, ItemPhase::Installed),
                    Err(reason) => settled(&item, ItemOutcome::Blocked, Some(reason)),
                };
            (next, item)
        }
        (Copy | Move, ItemPhase::Installed) => {
            let (source, destination, written) =
                (item.source.clone(), destination(&item)?, written(&item)?);
            let next =
                match blocking(move || transfer::verify(&source, &destination, &written)).await? {
                    Ok(()) if kind == Copy => settled(&item, ItemOutcome::Copied, None),
                    Ok(()) => change(&item, ItemPhase::DestinationVerified),
                    Err(reason) => settled(&item, ItemOutcome::Blocked, Some(reason)),
                };
            (next, item)
        }
        (_, phase) => {
            return Err(LibraryError::PersistenceFailure(format!(
                "storage item {} cannot advance from {phase:?} in a {kind:?} operation",
                item.seq
            )));
        }
    };
    let (next, current) = next;
    record(catalog, id, &current, &next).await?;
    Ok(())
}

/// Retire an item's source through the OS Trash. A Move first re-verifies its
/// destination; every item re-verifies its kept copies and its source (D19).
async fn retire(
    kind: StorageOperationKind,
    item: StorageItem,
    trash: &Arc<dyn OsTrash>,
) -> Result<(ItemChange, StorageItem), LibraryError> {
    let trash = Arc::clone(trash);
    let target = match kind {
        StorageOperationKind::Move => Some((destination(&item)?, written(&item)?)),
        _ => None,
    };
    let (source, relied_on) = (item.source.clone(), item.relied_on.clone());
    let retirement = blocking(move || {
        trash::retire(trash.as_ref(), &source, &relied_on, || match &target {
            Some((destination, written)) => transfer::verify(&source, destination, written),
            None => Ok(()),
        })
    })
    .await?;
    let next = match (kind, retirement) {
        (StorageOperationKind::Move, Retirement::Moved) => settled(&item, ItemOutcome::Moved, None),
        (_, Retirement::Moved) => settled(&item, ItemOutcome::Trashed, None),
        (StorageOperationKind::Move, Retirement::Unsupported(reason)) => {
            settled(&item, ItemOutcome::SourceKept, Some(reason))
        }
        (_, Retirement::Unsupported(reason) | Retirement::Blocked(reason)) => {
            settled(&item, ItemOutcome::Blocked, Some(reason))
        }
        (_, Retirement::Uncertain(reason)) => settled(&item, ItemOutcome::Uncertain, Some(reason)),
    };
    Ok((next, item))
}

fn destination(item: &StorageItem) -> Result<crate::TransferDestination, LibraryError> {
    item.destination.clone().ok_or_else(|| {
        LibraryError::PersistenceFailure(format!("transfer item {} has no destination", item.seq))
    })
}

fn written(item: &StorageItem) -> Result<crate::WrittenCopy, LibraryError> {
    item.written.clone().ok_or_else(|| {
        LibraryError::PersistenceFailure(format!(
            "transfer item {} names no written copy",
            item.seq
        ))
    })
}
