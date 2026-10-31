// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Wrap up's sheets, requests and reports (spec 065 PRJ-FR-14/15/25/30, 071
//! STO-FR-01/04/06/13 to STO-FR-16; D-W43, D-W80, D-W97, D-W111, D-W112,
//! D-W116), on the lifecycle and records of [`crate::project_lifecycle`].
//!
//! Each step is reviewed, then confirmed: Clean up offers the View's placed
//! entries (Copies ticked, Symlinks unticked) and whatever `View (previous)/`
//! still holds (unticked); Trash offers three groups, each moving only when
//! its row is ticked (D-W43); Archive lists the Project's sessions with every
//! file's from and to path and the kept-View links it repoints, and its
//! Proceed is Close. Nothing moves that the user didn't review, and every
//! refusal names its reason. `Output/` is never offered.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    ClosedSnapshot, EntryPlacement, ItemReason, NativePath, PreviousItemReason, ProjectLifecycle,
    ProjectOperationKind, Revision, WrapUpRecord, WrapUpStep,
};

/// Why Wrap up doesn't open, or one of its steps can't run now.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "blocker", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum WrapUpBlocker {
    /// Closed, Closing or Archived: Wrap up is a read-only record.
    NotOpen { lifecycle: ProjectLifecycle },
    /// "Apply or discard N changes first ▸" (provisional, `ClosePolicy`).
    PendingChanges { count: usize },
    /// One operation runs per Project at a time.
    OperationRunning { kind: ProjectOperationKind },
}

/// Where a Project's Wrap up stands: its recorded steps and the step that
/// is current.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct WrapUpStatus {
    pub project_id: Uuid,
    pub lifecycle: ProjectLifecycle,
    pub desired_revision: Revision,
    pub blocker: Option<WrapUpBlocker>,
    /// The recorded steps in order; a Closed Project's read-only record.
    pub records: Vec<WrapUpRecord>,
    /// The first step not recorded yet, while Wrap up is open.
    pub current: Option<WrapUpStep>,
}

/// The durable state of a Project's Close/archive run.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ProjectCloseStatus {
    /// The Project's archive operation is active; `progress` is its durable journal view.
    Running { progress: ArchiveProgress },
    /// The operation was stopped before it settled; recovery resumes from `progress`.
    Stopped { progress: ArchiveProgress },
    /// The archive settled, with one outcome per reviewed file.
    Settled { report: ArchiveProgress },
}

// ── Clean up ─────────────────────────────────────────────────────────────────

/// What one Clean up row is.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum CleanUpEntryKind {
    /// An entry Apply placed in `View/`, by its manifest seq.
    Placed { seq: u32, placement: EntryPlacement },
    /// A file `View (previous)/` still holds.
    Leftover { reason: PreviousItemReason },
}

/// One Clean up row (STO-FR-01/02).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CleanUpEntry {
    /// Relative to the Project folder: below `View/` or `View (previous)/`.
    pub path: NativePath,
    pub kind: CleanUpEntryKind,
    /// A link's size is never a promised reclaim.
    pub size_bytes: u64,
    /// Copies are ticked; Symlinks and leftovers are not.
    pub preselected: bool,
}

/// The Clean up step as it opens. `Processing/`, `Output/`, originals and
/// library frames are never listed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CleanUpReview {
    pub project_id: Uuid,
    pub desired_revision: Revision,
    /// The installed View's generation, if there is one.
    pub generation: Option<Revision>,
    pub entries: Vec<CleanUpEntry>,
}

/// The rows the user confirmed, by path; anything else stays.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CleanUpRequest {
    pub project_id: Uuid,
    pub desired_revision: Revision,
    pub generation: Option<Revision>,
    pub selected: Vec<NativePath>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum CleanUpOutcome {
    /// A link `PlateVault` placed, deleted after its no-follow check.
    Deleted,
    /// A copy or leftover that went to the OS Trash.
    Trashed,
    /// Left in place, naming why.
    Kept { reason: ItemReason },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CleanUpResult {
    pub path: NativePath,
    pub outcome: CleanUpOutcome,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CleanUpReport {
    pub record: WrapUpRecord,
    /// One result per selected row.
    pub results: Vec<CleanUpResult>,
    /// `View/` held nothing more, so it was removed and its manifest retired.
    pub view_removed: bool,
}

// ── Trash ────────────────────────────────────────────────────────────────────

/// The three rows of the Trash step (PRJ-FR-15).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum TrashGroup {
    /// "Move N rejected frames to Trash (size)": every copy of each
    /// library-Unusable frame, or none.
    RejectedFrames,
    /// "Move N processing files to Trash (size)": `Processing/` files.
    ProcessingFiles,
    /// "Move N duplicate copies to Trash (size)": extra byte-identical copies.
    DuplicateCopies,
}

impl TrashGroup {
    pub const ORDER: [Self; 3] =
        [Self::RejectedFrames, Self::ProcessingFiles, Self::DuplicateCopies];
}

/// One item a Trash row moves under its approval.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TrashCandidate {
    /// The frame's capture key, or the duplicate copy's asset id; `None` for
    /// a `Processing/` file.
    pub id: Option<Uuid>,
    /// The absolute paths it moves: every copy of a rejected frame, else one.
    pub files: Vec<NativePath>,
    pub size_bytes: u64,
    /// The copy a duplicate keeps, named.
    pub kept: Option<NativePath>,
}

/// An item a row lists as not selectable, with its reason.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TrashRefusal {
    pub id: Option<Uuid>,
    pub path: NativePath,
    pub reason: ItemReason,
}

/// One Trash row: what it moves, its size and what it refuses.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TrashGroupOffer {
    pub group: TrashGroup,
    pub items: Vec<TrashCandidate>,
    /// The expected reclaim.
    pub size_bytes: u64,
    pub refused: Vec<TrashRefusal>,
    /// The recommended rows are preselected; none of these is.
    pub preselected: bool,
}

/// The Trash step as it opens.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TrashReview {
    pub project_id: Uuid,
    pub desired_revision: Revision,
    /// SHA-256 of the offers; Trash refuses a sheet that no longer matches.
    pub digest: String,
    /// One row per [`TrashGroup`], in order.
    pub groups: Vec<TrashGroupOffer>,
    /// Masters `Processing/` offered that stay protected; adopt one first
    /// (CAL-FR-06).
    pub protected_masters: Vec<NativePath>,
}

/// The rows the user ticked (D-W43): an unticked row moves nothing.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TrashRequest {
    pub project_id: Uuid,
    pub digest: String,
    pub ticked: Vec<TrashGroup>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct TrashReport {
    pub record: WrapUpRecord,
    /// The files that reached the OS Trash.
    pub moved: Vec<NativePath>,
    /// Every approved item that stayed, with its reason.
    pub refused: Vec<TrashRefusal>,
}

// ── Archive and Close ────────────────────────────────────────────────────────

/// One file an archive moves: from its path to the templated one.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ArchiveFile {
    pub asset_id: Uuid,
    pub from: NativePath,
    pub to: NativePath,
    pub size_bytes: u64,
}

/// One session row of an archive review.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ArchiveSessionOffer {
    pub session_id: Uuid,
    pub files: Vec<ArchiveFile>,
    /// The open Projects that hold it: it stays at its path, not selectable.
    pub kept_by: Vec<String>,
    /// Why it can't move otherwise (naming, occupied, offline, already there).
    pub hold: Option<ItemReason>,
}

/// A link in a Closed or Archived Project's kept View that points at a file
/// the archive moves: it is repointed and recorded (D-W111).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct KeptViewLink {
    pub project_id: Uuid,
    pub project: String,
    /// The manifest entry the link is.
    pub generation: Revision,
    pub seq: u32,
    pub asset_id: Uuid,
    /// The link itself, absolute; never followed.
    pub link: NativePath,
}

/// Archive's review: the sessions it can move to `destination`, the ones it
/// keeps, and the kept-View links it repoints.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ArchiveReview {
    /// The Project whose Wrap up archives; `None` for Sessions > Archive.
    pub project_id: Option<Uuid>,
    pub destination: Uuid,
    pub sessions: Vec<ArchiveSessionOffer>,
    pub links: Vec<KeptViewLink>,
    /// SHA-256 of the review; archiving refuses one that no longer matches.
    pub digest: String,
}

/// What the confirmed archive moves.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ArchiveSelection {
    pub destination: Uuid,
    pub sessions: Vec<Uuid>,
    pub digest: String,
}

/// Close project…: Archive's Proceed. With no session selected it closes with
/// no archive, which is valid.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CloseRequest {
    pub project_id: Uuid,
    pub desired_revision: Revision,
    pub archive: Option<ArchiveSelection>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum ArchiveMoveOutcome {
    /// Copied, verified, every link repointed and the source retired.
    Archived,
    /// The record and links moved to the verified copy, but the source stays:
    /// its retirement was refused or a link could not be repointed.
    SourceRetained,
    /// Nothing moved for this file; the reason names why.
    Blocked,
    /// An interruption left a state the recorded evidence cannot prove.
    Uncertain,
}

/// One file of a running or settled archive.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ArchiveMove {
    pub seq: u32,
    pub session_id: Uuid,
    pub file: ArchiveFile,
    /// The catalog record names the archive copy.
    pub repointed: bool,
    pub outcome: Option<ArchiveMoveOutcome>,
    pub reason: Option<ItemReason>,
}

/// An archive's durable progress.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ArchiveProgress {
    /// The verified-transfer journal operation.
    pub storage_operation_id: Uuid,
    pub project_id: Option<Uuid>,
    pub settled: bool,
    pub moves: Vec<ArchiveMove>,
    /// The kept-View links repointed so far.
    pub repointed_links: Vec<KeptViewLink>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CloseReport {
    /// Closing while the archive runs or was interrupted, then Archived, or
    /// Closed when nothing was archived.
    pub lifecycle: ProjectLifecycle,
    pub snapshot: ClosedSnapshot,
    pub archive: Option<ArchiveProgress>,
}

// ── Duplicate ────────────────────────────────────────────────────────────────

/// Duplicate…: the new Project's name and what the user kept ticked
/// (PRJ-FR-30). Subjects and rigs always come along; sessions bring their
/// groups and overrides; nothing links back to the original.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct DuplicateRequest {
    pub project_id: Uuid,
    pub name: String,
    pub sessions: Vec<Uuid>,
    pub goals: bool,
    pub notes: bool,
    pub settings: bool,
}
