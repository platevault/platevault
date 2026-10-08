// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage custody records (spec 071): reviewed entry evidence, OS Trash
//! support, and the operation journal with per-item phases, outcomes and
//! reasons.
//!
//! An item's phase is recorded before the step it leads into can be observed
//! on disk, so a resumed operation decides from recorded identities and never
//! from whether a file name is present.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{FileIdentity, NativePath, ObservationFingerprint, Revision};

/// What one storage operation does with each of its items.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageOperationKind {
    /// Move each entry to the OS Trash.
    Trash,
    /// Verified transfer; every source stays where it is.
    Copy,
    /// Verified transfer, then each source goes to the OS Trash once it,
    /// and its destination, re-verify against the snapshot.
    Move,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageOperationState {
    /// Recorded from a review; nothing has been written or moved.
    Reviewed,
    /// Started. An operation left running by an earlier process was
    /// interrupted and resumes from each item's recorded phase.
    Running,
    /// Every item carries an outcome; nothing further happens.
    Settled,
}

/// What a reviewed entry is. A link is recorded by its own identity and its
/// target text; its target is never opened, hashed or followed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Link { target: NativePath },
}

/// Reviewed evidence of one entry, re-verified immediately before it moves (D19).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryEvidence {
    /// Absolute path of the entry itself.
    pub path: NativePath,
    pub kind: EntryKind,
    /// No-follow identity, size and modification time; never a content digest.
    pub fingerprint: ObservationFingerprint,
    /// SHA-256 of a file's bytes; `None` for a link.
    pub sha256: Option<String>,
}

/// A retained original or kept copy an item relies on. It must still hold
/// these bytes immediately before the item moves.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptCopy {
    pub path: NativePath,
    pub fingerprint: ObservationFingerprint,
    pub sha256: String,
}

/// Where a transfer writes: an existing folder, and a path below it whose
/// missing folders are created. An existing entry at the destination is never
/// replaced.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferDestination {
    pub root: NativePath,
    pub relative: NativePath,
}

/// One reviewed item of a new operation.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageItemDraft {
    pub source: EntryEvidence,
    /// Copies the item relies on; only Trash items carry them.
    pub relied_on: Vec<KeptCopy>,
    /// Required for Copy and Move items; absent for Trash items.
    pub destination: Option<TransferDestination>,
}

/// The copy a transfer item wrote, recorded by identity while it was still a
/// partial file beside its destination. Installing it at the destination keeps
/// that identity, which is how a resumed item recognizes its own copy.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenCopy {
    pub partial: NativePath,
    pub identity: FileIdentity,
}

/// Durable progress of one item.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemPhase {
    /// Reviewed; nothing written or moved.
    Pending,
    /// A partial copy, recorded by identity, exists beside the destination.
    Writing,
    /// The destination name holds the recorded copy, not yet re-read.
    Installed,
    /// The re-read destination matched the source snapshot; the source is retained.
    DestinationVerified,
    /// The move to the OS Trash was about to be requested; its result is not recorded.
    Retiring,
    /// The outcome is recorded.
    Settled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemOutcome {
    /// The entry itself went to the OS Trash.
    Trashed,
    /// The destination verified; the source stayed in place as Copy intends.
    Copied,
    /// The destination verified and the re-verified source went to the OS Trash.
    Moved,
    /// The destination verified, but the source was kept because its volume
    /// has no OS Trash or deletes immediately ("copied, source kept").
    SourceKept,
    /// Stopped before anything further moved; the reason names why. The
    /// source, and any destination the item wrote, are left in place.
    Blocked,
    /// An interruption left a state the recorded evidence cannot prove.
    Uncertain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReasonCode {
    /// The volume has no OS Trash, or its OS removal deletes immediately.
    TrashUnsupported,
    /// The OS refused the move to its Trash; the entry is still in place.
    TrashFailed,
    /// The source's identity, size, modification time or SHA-256 differs from its review.
    SourceDrift,
    /// The source is missing or cannot be read.
    SourceUnavailable,
    /// A retained original or kept copy is missing or no longer holds its reviewed bytes.
    KeptCopyUnproven,
    /// The destination name holds an entry this operation did not write.
    DestinationOccupied,
    /// The re-read destination differs from the source snapshot.
    DestinationMismatch,
    /// The destination folder or this operation's written copy changed.
    DestinationChanged,
    /// The destination could not be written, synced or installed without replacing anything.
    WriteFailed,
    /// After an interruption the recorded evidence cannot prove what happened.
    Interrupted,
    /// A library frame, an original source, or a run group's Results another
    /// run uses as an input: run Clean up and Empty Trash never touch it.
    Protected,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemReason {
    pub code: ReasonCode,
    pub detail: String,
}

impl ItemReason {
    #[must_use]
    pub fn new(code: ReasonCode, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }
}

/// One recorded change of an item, applied by compare-and-swap on its revision.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemChange {
    pub phase: ItemPhase,
    /// Required exactly when `phase` is [`ItemPhase::Settled`].
    pub outcome: Option<ItemOutcome>,
    pub reason: Option<ItemReason>,
    pub written: Option<WrittenCopy>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageItem {
    pub seq: u32,
    pub source: EntryEvidence,
    pub relied_on: Vec<KeptCopy>,
    pub destination: Option<TransferDestination>,
    pub written: Option<WrittenCopy>,
    pub phase: ItemPhase,
    pub outcome: Option<ItemOutcome>,
    pub reason: Option<ItemReason>,
    pub revision: Revision,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageOperation {
    pub id: Uuid,
    pub kind: StorageOperationKind,
    pub state: StorageOperationState,
    pub revision: Revision,
    pub items: Vec<StorageItem>,
    pub created_at: String,
    pub updated_at: String,
}

/// Why an entry's volume cannot take it to the OS Trash.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrashUnsupported {
    /// The OS would delete the entry immediately instead of keeping it restorable.
    DeletesImmediately,
    /// The volume has no Trash this platform can use.
    NoTrash,
    /// The volume is read-only.
    ReadOnly,
    /// The volume's Trash behaviour could not be established.
    Unqualified,
}

/// Whether the OS Trash keeps an entry restorable, decided per location.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "support", rename_all = "snake_case")]
pub enum TrashSupport {
    Supported,
    Unsupported { reason: TrashUnsupported, detail: String },
}
