// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Import (spec 071 STO-IMP-FR-01..06 and STO-IMP-FR-08, LIB-FR-16): saved
//! sources, the templated preview with its holds, duplicates and collisions,
//! and the per-item outcome of a verified Copy or Move.
//!
//! A preview is durable: every source file is recorded with its settle
//! observation, its reviewed evidence (no-follow fingerprint and SHA-256) once
//! it settled, and its header metadata, so the user's choices, a recheck and
//! the execution all decide from the same recorded evidence.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    Availability, CaptureMetadata, EntryEvidence, FileIdentity, ItemReason, LocationRole,
    NamingFallback, NamingFrameType, NativePath, ObservationFingerprint, Revision,
};

/// A source folder saved under a name, for Import new.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSource {
    pub id: Uuid,
    pub name: String,
    /// Absolute path of a folder the OS has mounted; the app mounts nothing.
    pub path: NativePath,
    /// When an import from this source last settled.
    pub last_imported_at: Option<String>,
    pub created_at: String,
}

/// A saved source with whether its folder can be read now.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSourceView {
    #[serde(flatten)]
    pub source: SavedSource,
    /// `Offline` while the folder (an unmounted share or card) is absent.
    pub availability: Availability,
}

/// What a preview reads: a saved source (Import new) or any mounted folder.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ImportSourceSpec {
    Saved { id: Uuid },
    Folder { path: NativePath },
}

/// Copy keeps every source; Move sends each re-verified source to the OS Trash.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    Copy,
    Move,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportState {
    /// Previewed; nothing has been written.
    Previewed,
    /// Started; approved items are being transferred and indexed.
    Running,
    /// The source (or a destination) went away; verified items keep their
    /// state and the rest stay pending until Retry.
    Interrupted,
    /// Every approved item has an outcome.
    Settled,
}

/// Where an item stands, from the preview through execution.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportItemPhase {
    /// Routed; starting the import approves it.
    Ready,
    /// No frame type: held until the user sets one; never imported untyped.
    Unclassified,
    /// Size or modification time still changing: held until both stay
    /// unchanged across consecutive checks.
    Settling,
    /// Skipped: its SHA-256 matches a frame already in the library, an
    /// earlier file of this import or one imported from this source.
    Duplicate,
    /// Held: the named block must be resolved first.
    Blocked,
    /// Left out by the user.
    Excluded,
    /// Approved; its verified transfer has not finished.
    Pending,
    /// Move only: the destination verified; the source awaits its re-verified
    /// move to the OS Trash.
    Landed,
    /// The destination verified; the source is untouched.
    Copied,
    /// The destination verified and the re-verified source went to the OS Trash.
    Moved,
    /// The destination verified; the source stayed (no OS Trash, immediate
    /// deletion, or a source or destination that failed its re-verification).
    SourceKept,
    /// Not imported; the reason names why.
    Failed,
    /// An interruption left a state the recorded evidence cannot prove.
    Uncertain,
}

impl ImportItemPhase {
    /// The destination holds a verified copy of the source snapshot.
    #[must_use]
    pub const fn imported(self) -> bool {
        matches!(self, Self::Landed | Self::Copied | Self::Moved | Self::SourceKept)
    }
}

/// What a skipped duplicate matches.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ImportDuplicate {
    /// A frame already indexed in the library.
    IndexedFrame { asset_id: Uuid },
    /// An earlier file of this import; only the first copy is imported.
    SameImport { seq: u32, source_path: NativePath },
    /// A frame imported earlier from this saved source.
    SameSource { operation_id: Uuid },
    /// The templated destination already holds these exact bytes.
    AtDestination { path: NativePath },
}

/// Why a preview item is held.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ImportBlock {
    /// No active location has the role; register one (LIB-FR-01).
    MissingRole { role: LocationRole },
    /// Several locations have the role; the user chooses one for the import.
    LocationNotChosen { role: LocationRole },
    /// The chosen location cannot take files.
    DestinationUnwritable { location_id: Uuid, detail: String },
    /// The templated destination holds different bytes; nothing is overwritten.
    Collision { path: NativePath },
    /// An earlier item of this import routes to the same destination.
    CollidesWithItem { seq: u32 },
    /// The naming template refused the item's metadata.
    Naming { detail: String },
    /// The file's header or bytes could not be read.
    Unreadable { detail: String },
    /// The file is no longer in the source.
    SourceMissing,
    /// A library frame may hold these bytes but could not be hashed to prove it.
    DuplicateUnproven { asset_id: Uuid, detail: String },
}

/// A light's confirmed rig, named in the preview.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRig {
    pub equipment_id: Uuid,
    pub name: String,
}

/// A FILTER value no filter on the light's confirmed rig matches: the
/// "Add {value} to {rig}" prompt of PLAN-EQ-FR-04. It holds nothing back.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnknownFilter {
    pub equipment_id: Uuid,
    pub rig_name: String,
    pub value: String,
}

/// One source file of an import.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub seq: u32,
    /// Absolute path of the source file.
    pub source_path: NativePath,
    /// The same path below the source folder.
    pub relative_path: NativePath,
    pub size_bytes: u64,
    /// SHA-256 of the settled source snapshot.
    pub sha256: Option<String>,
    /// The header IMAGETYP as read.
    pub image_type: Option<String>,
    /// The frame type the header gives; `None` is Unclassified.
    pub classification: Option<NamingFrameType>,
    /// The frame type the user set; it overrides the header.
    pub user_type: Option<NamingFrameType>,
    pub excluded: bool,
    pub role: Option<LocationRole>,
    pub destination_location_id: Option<Uuid>,
    /// Below the destination location: the templated folder and the source's
    /// own basename.
    pub destination_path: Option<NativePath>,
    /// Template tokens that resolved to their fallback.
    pub fallbacks: Vec<NamingFallback>,
    pub rig: Option<ImportRig>,
    pub unknown_filter: Option<UnknownFilter>,
    pub phase: ImportItemPhase,
    pub duplicate: Option<ImportDuplicate>,
    pub block: Option<ImportBlock>,
    /// Custody reason of a failed, kept or uncertain transfer.
    pub reason: Option<ItemReason>,
    /// The destination holds a verified copy.
    pub landed: bool,
    /// The landed copy is indexed in the library (LIB-FR-16).
    pub indexed: bool,
}

impl ImportItem {
    /// The frame type the item imports as: the user's, else the header's.
    #[must_use]
    pub fn frame_type(&self) -> Option<NamingFrameType> {
        self.user_type.or(self.classification)
    }
}

/// The last settle check of a source file.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleObservation {
    pub fingerprint: ObservationFingerprint,
    /// Milliseconds since the Unix epoch when the fingerprint was taken.
    pub checked_at_ms: i64,
}

/// The storage journal item carrying an import item's current transfer.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRef {
    pub operation_id: Uuid,
    pub seq: u32,
}

/// An import item with the recorded evidence it is routed and executed from.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItemRecord {
    pub item: ImportItem,
    pub observation: Option<SettleObservation>,
    /// Reviewed no-follow fingerprint and SHA-256 of the settled snapshot.
    pub evidence: Option<EntryEvidence>,
    pub metadata: Option<CaptureMetadata>,
    pub storage: Option<StorageRef>,
    /// Identity of the copy the transfer wrote, once it landed.
    pub written: Option<FileIdentity>,
}

/// The location chosen for a role that has several.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportChoice {
    pub role: LocationRole,
    pub location_id: Uuid,
}

/// A recorded import operation and its items.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRecord {
    pub id: Uuid,
    pub source_id: Option<Uuid>,
    pub source_path: NativePath,
    /// The source folder as the preview observed it: its volume and, where
    /// the volume's IDs are stable, its folder ID. Another folder at the path,
    /// or the mount point an unmounted share left, is not this source.
    pub source_identity: FileIdentity,
    pub mode: Option<ImportMode>,
    pub state: ImportState,
    pub choices: Vec<ImportChoice>,
    pub revision: Revision,
    pub items: Vec<ImportItemRecord>,
    pub created_at: String,
    pub updated_at: String,
    pub settled_at: Option<String>,
}

/// A new preview to record.
#[derive(Clone, Debug)]
pub struct ImportDraft {
    pub source_id: Option<Uuid>,
    pub source_path: NativePath,
    pub source_identity: FileIdentity,
    pub items: Vec<ImportItemRecord>,
}

/// Whether a destination folder can take new files, checked without writing.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Writability {
    Writable,
    NotWritable {
        detail: String,
    },
    /// No check that writes nothing could answer: the platform has none, or
    /// the Windows access check failed for a reason other than a refusal. A
    /// failed write still blocks only its item.
    Unknown {
        detail: String,
    },
}

/// One location an import may write to, with what the import puts there.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDestination {
    pub role: LocationRole,
    pub location_id: Uuid,
    pub name: String,
    pub path: NativePath,
    /// The location this import writes the role's items to.
    pub chosen: bool,
    /// Ready (or, once started, approved) items routed here and their bytes.
    pub items: u64,
    pub bytes: u64,
    /// Free bytes on the location's volume; `None` when it cannot be read.
    pub free_bytes: Option<u64>,
    pub writability: Writability,
}

/// Exact per-item counts of an import (STO-IMP-FR-06).
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub ready: u64,
    /// Destinations that hold a verified copy.
    pub imported: u64,
    pub duplicates: u64,
    pub unclassified: u64,
    pub settling: u64,
    pub blocked: u64,
    pub excluded: u64,
    /// Approved items still waiting for their transfer or source retirement.
    pub pending: u64,
    pub failed: u64,
    /// Items whose destination or source failed its verification.
    pub failed_verification: u64,
    /// Move sources sent to the OS Trash.
    pub sources_trashed: u64,
    /// Move sources kept beside their verified copy.
    pub sources_kept: u64,
    pub uncertain: u64,
}

/// An import as Import shows it: the preview before it starts, then its
/// progress and outcomes.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOperation {
    pub id: Uuid,
    pub source_id: Option<Uuid>,
    pub source_path: NativePath,
    /// `Offline` while the source folder is absent (an unmounted share).
    pub source_availability: Availability,
    pub mode: Option<ImportMode>,
    pub state: ImportState,
    /// Every user choice and recheck bumps it; Start approves exactly the
    /// items shown at this revision.
    pub revision: Revision,
    pub items: Vec<ImportItem>,
    pub destinations: Vec<ImportDestination>,
    pub summary: ImportSummary,
    pub created_at: String,
    pub updated_at: String,
    pub settled_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_and_block_fields_are_camel_case() {
        let id = Uuid::new_v4();
        let source_path = NativePath::UnixBytes(b"/Volumes/card/light_001.fits".to_vec());
        let duplicates = [
            (ImportDuplicate::IndexedFrame { asset_id: id }, "assetId"),
            (ImportDuplicate::SameImport { seq: 1, source_path }, "sourcePath"),
            (ImportDuplicate::SameSource { operation_id: id }, "operationId"),
        ];
        for (duplicate, field) in duplicates {
            let wire = serde_json::to_value(&duplicate).unwrap();
            assert!(wire.get(field).is_some(), "{wire}");
            assert_eq!(serde_json::from_value::<ImportDuplicate>(wire).unwrap(), duplicate);
        }
        let blocks = [
            (
                ImportBlock::DestinationUnwritable { location_id: id, detail: "x".into() },
                "locationId",
            ),
            (ImportBlock::DuplicateUnproven { asset_id: id, detail: "x".into() }, "assetId"),
        ];
        for (block, field) in blocks {
            let wire = serde_json::to_value(&block).unwrap();
            assert!(wire.get(field).is_some(), "{wire}");
            assert_eq!(serde_json::from_value::<ImportBlock>(wire).unwrap(), block);
        }
        let wire = serde_json::to_value(ImportDuplicate::IndexedFrame { asset_id: id }).unwrap();
        assert_eq!(wire["kind"], "indexed_frame", "variant tags stay snake_case");
    }
}
