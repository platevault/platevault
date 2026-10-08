// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Run Clean up and Empty Trash (spec 071 STO-FR-01..05/10/17, PREP-FR-14,
//! RES-FR-10): the reviewed removal of a run's prepared entries and, for a run
//! in its Project's Trash, of its prepared folders, its Results folder when
//! the user ticks it, and its record.
//!
//! A review lists only what the run's preparation revisions created (links,
//! clones and copies); original sources, Direct-source paths, library frames
//! and the Results folder's products are never listed by Clean up. Review
//! records each moving entry with its identity and SHA-256, a link by its own
//! identity and target text, and the retained original it relies on; execution
//! re-verifies them immediately before each move (D19). Everything leaves its
//! path only through the OS Trash: an item that cannot go stays where it is and
//! is named with its reason. Library frames and their quality decisions are
//! never touched.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{ItemReason, NativePath, PreparedInput, TrashSupport};

/// Which removal a review records.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CleanupKind {
    /// Run Clean up (STO-FR-01): prepared entries, never a whole folder.
    CleanUp,
    /// Empty Trash for a run in its Project's Trash (STO-FR-17): every
    /// prepared folder, the Results folder when ticked, then the run record.
    EmptyTrash,
}

/// What an item is to the run.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CleanupRole {
    /// A prepared symbolic link; its target is never followed.
    Symlink,
    /// A prepared hardlink; it needs its verified retained original.
    Hardlink,
    /// A prepared copy; it needs its verified retained original.
    Copy,
    /// A prepared clone; it needs its verified retained original.
    Clone,
    /// Another entry inside a prepared folder, such as one the application
    /// wrote there. Only Empty Trash moves it, with its folder.
    Unprepared,
    /// An entry of the Results folder. Only Empty Trash moves it, and only
    /// when the user ticks the Results folder.
    Result,
}

impl CleanupRole {
    /// Whether removing the item frees its bytes. A link's size, a hardlink
    /// whose original keeps the bytes and a clone that shares its blocks are
    /// never presented as guaranteed reclaim (STO-FR-02).
    #[must_use]
    pub const fn reclaim_guaranteed(self) -> bool {
        matches!(self, Self::Copy | Self::Unprepared | Self::Result)
    }

    /// Whether removing the item needs its verified retained original.
    #[must_use]
    pub const fn needs_retained_original(self) -> bool {
        matches!(self, Self::Hardlink | Self::Copy | Self::Clone)
    }
}

/// One prepared entry: its preparation revision and its place in it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedEntryKey {
    pub preparation_id: Uuid,
    pub seq: u32,
}

/// What the user took out of a Clean up review. Every group starts selected,
/// so the default excludes nothing.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSelection {
    /// Deselected groups: none of their entries is recorded.
    #[serde(default)]
    pub excluded_roles: Vec<CleanupRole>,
    /// Deselected individual entries.
    #[serde(default)]
    pub excluded_entries: Vec<PreparedEntryKey>,
}

/// What a review is asked for.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CleanupRequest {
    /// Run Clean up: once the run is Complete, every entry its preparation
    /// revisions created; before then, only the entries of replaced
    /// revisions (STO-FR-10).
    CleanUp {
        view_id: Uuid,
        #[serde(default)]
        selection: CleanupSelection,
    },
    /// Empty Trash for one run in its Project's Trash. `results` is the
    /// Results folder tick, which starts unticked.
    EmptyTrash {
        view_id: Uuid,
        #[serde(default)]
        results: bool,
    },
}

impl CleanupRequest {
    #[must_use]
    pub const fn view_id(&self) -> Uuid {
        match self {
            Self::CleanUp { view_id, .. } | Self::EmptyTrash { view_id, .. } => *view_id,
        }
    }

    #[must_use]
    pub const fn kind(&self) -> CleanupKind {
        match self {
            Self::CleanUp { .. } => CleanupKind::CleanUp,
            Self::EmptyTrash { .. } => CleanupKind::EmptyTrash,
        }
    }
}

/// What the review decided for one item.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CleanupItemState {
    /// Recorded: it goes to the OS Trash once its evidence re-verifies.
    Moves,
    /// It stays where it is, for the reason named.
    Stays { reason: ItemReason },
    /// Its group or the entry itself is deselected; nothing is recorded.
    NotSelected,
}

/// One listed item (STO-FR-02).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub path: NativePath,
    pub role: CleanupRole,
    /// The input a prepared entry carries.
    pub input: Option<PreparedInput>,
    /// The prepared entry, for a prepared role.
    pub entry: Option<PreparedEntryKey>,
    /// The preparation revision number whose folder holds it.
    pub preparation_revision: Option<u32>,
    /// The original source a link, clone or copy was prepared from.
    pub source: Option<NativePath>,
    pub estimated_bytes: u64,
    /// See [`CleanupRole::reclaim_guaranteed`].
    pub reclaim_guaranteed: bool,
    /// The retained original the removal relies on, re-verified before the
    /// move.
    pub relies_on: Option<NativePath>,
    pub state: CleanupItemState,
}

/// One group of a review: every item of one role, with counts and sizes of
/// the items that move.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupGroup {
    pub role: CleanupRole,
    pub selected: bool,
    pub count: u32,
    pub moves: u32,
    pub stays: u32,
    pub estimated_bytes: u64,
    pub reclaim_guaranteed: bool,
    pub items: Vec<CleanupItem>,
}

/// Which recorded folder of the run. A run group's own folders join Empty
/// Trash of its last panel run only (D-W75).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CleanupFolderRole {
    /// A run's revision folder, or a panel run's `Panel N/`.
    Prepared { preparation_revision: u32 },
    /// The run's Results folder, or a panel run's `<Mosaic> Results/Panel N/`.
    Results,
    /// A Prepare all revision's group folder, `<Mosaic>/` or
    /// `<Mosaic> (rev N)/`: it lists no entry of its own and goes once its
    /// `Panel N/` folders are gone.
    Group { group_preparation: u32 },
    /// The run group's `<Mosaic> Results/Assembled/`, only when ticked.
    Assembled,
}

/// Trash support for one folder of the run with its moving and staying
/// counts (STO-FR-04).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupFolder {
    pub path: NativePath,
    pub role: CleanupFolderRole,
    pub support: TrashSupport,
    pub moves: u32,
    pub stays: u32,
    /// Empty Trash: the folder itself goes to the OS Trash once every entry
    /// in it has gone.
    pub folder_moves: bool,
}

/// An item that stays where it is, with its path and reason (STO-FR-05,
/// STO-FR-17).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StayingItem {
    pub path: NativePath,
    /// Whether the item is a whole folder.
    pub folder: bool,
    pub reason: ItemReason,
}

/// A recorded review. Nothing moves until it is executed.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReview {
    /// The recorded review to execute; `None` when a Clean up has nothing
    /// to move.
    pub id: Option<Uuid>,
    pub kind: CleanupKind,
    pub view_id: Uuid,
    pub run_name: String,
    pub groups: Vec<CleanupGroup>,
    pub folders: Vec<CleanupFolder>,
    /// Every item that stays in place, named with its reason.
    pub staying: Vec<StayingItem>,
    pub moves: u32,
    pub moves_bytes: u64,
    /// Empty Trash: the run's Results folder and whether it is ticked.
    pub results_folder: Option<NativePath>,
    pub results_ticked: bool,
    pub statement: String,
}

/// Where an executed review stands.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CleanupState {
    Reviewed,
    Running,
    Settled,
}

/// What an execution did (STO-FR-05): the exact complete or partial summary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupOutcome {
    pub id: Uuid,
    pub kind: CleanupKind,
    pub view_id: Uuid,
    pub run_name: String,
    pub state: CleanupState,
    /// The storage journal operation that moved the entries, if any moved.
    pub operation_id: Option<Uuid>,
    /// Every entry and folder that went to the OS Trash.
    pub moved: Vec<NativePath>,
    /// Every item left behind, with its path and reason; an item whose move
    /// cannot be proven after an interruption is named here too.
    pub left: Vec<StayingItem>,
    /// Empty Trash: the run record is removed.
    pub run_removed: bool,
    pub summary: String,
}

impl CleanupOutcome {
    /// Whether every recorded and reviewed item went to the OS Trash.
    #[must_use]
    pub fn complete(&self) -> bool {
        self.state == CleanupState::Settled && self.left.is_empty()
    }
}
