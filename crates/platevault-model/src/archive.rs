// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Archive of a Done Project's sessions and the reviewed restore of archived
//! ones (spec 071 STO-FR-06/07/08/13, STO-AC-05/07/10/17/22; spec 065
//! PRJ-AC-27; D06, D-W20, D-W46, D-W69).
//!
//! A transfer is reviewed, then executed: every item is copied from its
//! reviewed snapshot to a path the naming templates lay out, re-read, its
//! references are updated, and only then is its source retired to the OS
//! Trash. Each item records the phase it reached, so a resumed transfer
//! decides from recorded identities, never from whether a file name is
//! present. The frame keeps its catalog record, decisions and memberships:
//! the record is repointed at the verified copy.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    Availability, FileIdentity, ItemReason, KeptSession, LocationRole, NamingFallback, NativePath,
    OfferRun, PreparedEntryKind, ProjectName, Revision, Writability,
};

/// What a reviewed transfer does with its sessions.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveKind {
    /// A Done Project's Archive: each session to the archive location.
    Archive,
    /// The reviewed restore of archived sessions to the paths they left.
    Restore,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveState {
    /// Recorded from a review; nothing has been written or moved.
    Reviewed,
    /// Started. A transfer left running by an earlier process was
    /// interrupted and resumes from each item's recorded phase.
    Running,
    /// Every item carries an outcome.
    Settled,
}

/// A destination location as review observed it (STO-FR-06): its volume
/// identity, free space and writability. A different volume mounted at the
/// registered path is a conflict, and nothing is written there.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDestination {
    pub location_id: Uuid,
    pub name: String,
    pub root: NativePath,
    pub role: LocationRole,
    /// The registered volume and folder, observed at review.
    pub identity: Option<FileIdentity>,
    pub free_bytes: Option<u64>,
    pub writability: Writability,
    /// Bytes the transfer writes there.
    pub needed_bytes: u64,
    /// Why nothing can be written there; the transfer does not start.
    pub blocked: Option<String>,
}

/// What a reference update proposes for one prepared entry that reads the
/// frame (STO-FR-06): each run's current mode beside the proposed one.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceUpdate {
    /// The prepared symbolic link is rebuilt to point at the new path; the
    /// old link goes to the OS Trash and is never followed.
    RepointLink,
    /// The prepared hardlink keeps its local copy of the bytes: it is never
    /// rebuilt as a hardlink, nothing is converted, and those bytes are not
    /// reclaimed. Its retained original becomes the new path.
    KeepLocalCopy,
    /// The prepared copy or clone holds its own bytes; its retained original
    /// becomes the new path.
    RetainedOriginal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceState {
    Pending,
    Completed,
    /// Not updated; the item's source is retained.
    Blocked,
    /// An interruption left a state the recorded evidence cannot prove.
    Uncertain,
}

/// One prepared entry of a run, in any Project, that reads the frame.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReference {
    pub run: OfferRun,
    pub preparation_id: Uuid,
    pub preparation: u32,
    pub entry_seq: u32,
    pub entry_path: NativePath,
    /// The entry's current mode.
    pub mode: PreparedEntryKind,
    pub update: ReferenceUpdate,
    pub state: ReferenceState,
    pub reason: Option<ItemReason>,
}

/// Why a reviewed item is held back and never transferred.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ArchiveHold {
    /// The session is a member of a run in another Project not marked Done
    /// (PRJ-FR-14), re-checked when the transfer starts.
    Kept { projects: Vec<ProjectName> },
    /// The copy is not on disk to transfer, or cannot be read.
    Unavailable { availability: Availability },
    /// The copy already sits in the destination location.
    AlreadyThere,
    /// An archive keeps a frame's role: it goes to a location of its own role.
    RoleMismatch { role: LocationRole },
    /// The naming template cannot lay the frame out.
    Naming { detail: String },
    /// The destination path holds an entry, or the catalog records one there;
    /// nothing is ever replaced.
    Occupied { path: NativePath },
    /// An earlier item of this transfer lays out to the same path.
    CollidesWithItem { seq: u32 },
    /// The copy is the Direct-source path of a run, in a configuration
    /// `PlateVault` cannot rewrite; its source stays in place.
    DirectSource { run: OfferRun, preparation: u32 },
    /// A prepared entry that reads the copy is being written, or drifted.
    ReferenceUnsettled { run: OfferRun, preparation: u32, detail: String },
    /// A prepared link reads the copy and this platform cannot rebuild it
    /// (only macOS and Linux do), so nothing is written for the frame.
    LinkRepairUnsupported { run: OfferRun, preparation: u32 },
    /// The copy, its catalog record or its references changed since review.
    Changed { detail: String },
}

/// Durable progress of one item.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchivePhase {
    /// Reviewed; the source is retained and nothing is verified yet.
    Pending,
    /// The re-read destination matched the source snapshot; the source is retained.
    DestinationVerified,
    /// Reference updates were about to start; their result is not recorded.
    Repairing,
    /// Every reference names the destination copy, the catalog record
    /// included; the source is retained until it is retired.
    ReferenceUpdated,
    /// The outcome is recorded.
    Settled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveOutcome {
    /// The destination verified, every reference was updated and the
    /// re-verified source went to the OS Trash.
    Archived,
    /// The destination verified but the source stays where it is: a
    /// reference could not be updated or re-verified, the source drifted,
    /// or its volume has no OS Trash. Once the frame's record moved to the
    /// copy, both versions are kept for review; a copy that nothing records
    /// or reads is discarded, so a later review finds its path free.
    SourceRetained,
    /// Held back before its destination verified; the source stays.
    Blocked,
    /// An interruption left a state the recorded evidence cannot prove.
    Uncertain,
}

/// One frame copy of a reviewed transfer.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveItem {
    pub seq: u32,
    pub session_id: Uuid,
    pub asset_id: Uuid,
    pub source_location_id: Uuid,
    /// The source below its location's root.
    pub source_path: NativePath,
    pub destination_location_id: Uuid,
    /// The destination below its location's root, laid out by the naming
    /// templates for an archive, the path the frame left for a restore.
    pub destination_path: NativePath,
    pub size_bytes: u64,
    /// The reviewed SHA-256 the copy and its re-read must match.
    pub sha256: Option<String>,
    /// Template tokens that took their fallback value.
    pub fallbacks: Vec<NamingFallback>,
    pub references: Vec<ArchiveReference>,
    /// Set for an item review held back; it is never transferred.
    pub hold: Option<ArchiveHold>,
    pub phase: ArchivePhase,
    pub outcome: Option<ArchiveOutcome>,
    pub reason: Option<ItemReason>,
    /// The catalog record names the destination copy.
    pub repointed: bool,
}

/// A reviewed Archive or restore transfer and its items' recorded phases.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveTransfer {
    pub id: Uuid,
    pub kind: ArchiveKind,
    pub project: ProjectName,
    /// The Project revision the review read.
    pub project_revision: Revision,
    pub state: ArchiveState,
    pub destinations: Vec<ArchiveDestination>,
    /// Member sessions Archive keeps at their paths, naming the Projects
    /// that use them.
    pub kept: Vec<KeptSession>,
    pub items: Vec<ArchiveItem>,
    /// Bytes the retired sources would free: a source a prepared hardlink
    /// shares stays held. Observed reclaim is separate.
    pub expected_reclaim_bytes: u64,
    /// The verified-transfer journal operation, once the transfer started.
    pub storage_operation_id: Option<Uuid>,
    pub created_at: String,
    pub updated_at: String,
}

/// The Archive or restore transfer a verified storage transfer carries:
/// Storage lists it as that transfer of its Project (STO-FR-11).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferArchive {
    pub transfer_id: Uuid,
    pub kind: ArchiveKind,
    pub project: ProjectName,
}

/// One frame of a session at its archive path.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedFrame {
    pub asset_id: Uuid,
    pub location_id: Uuid,
    pub location_name: String,
    /// The archive path below the location's root.
    pub path: NativePath,
    /// Offline while the archive volume is not mounted (STO-FR-08).
    pub availability: Availability,
    /// The Archive transfer that moved it, and its Project.
    pub transfer_id: Uuid,
    pub project: ProjectName,
    pub archived_at: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionArchiveStatus {
    NotArchived,
    /// Every live frame of the session is at its archive path.
    Archived,
    /// Some live frames are at their archive paths and others are not.
    PartlyArchived,
}

/// Whether a session shows as Archived (STO-FR-13, PRJ-AC-27): it does from
/// the Archive that moved it until a reviewed restore moves it back, whether
/// or not its Project was Reopened in between.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionArchiveState {
    pub session_id: Uuid,
    pub status: SessionArchiveStatus,
    pub archived: Vec<ArchivedFrame>,
}
