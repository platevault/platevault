// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! FileRecord (inventory) lifecycle state model (spec 002 data-model.md §FileRecord).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
use strum::{EnumString, IntoStaticStr};

use crate::ids::{ContentHash, EntityId, Timestamp};

/// Lifecycle state for a `FileRecord` (inventory entry).
///
/// 6 variants per spec 002 §FileRecordState.
#[derive(
    Clone,
    Copy,
    Debug,
    Eq,
    Hash,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    Deserialize,
    JsonSchema,
    Type,
    EnumString,
    IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum InventoryState {
    Observed,
    Changed,
    Classified,
    Missing,
    Rejected,
    Protected,
}

/// Canonical allowed `(from, to)` edge list per research.md §2.4 (FileRecord transitions)
/// and data-model.md §FileRecord §Lifecycle. `* → protected` is a wildcard rule applied
/// from any non-terminal state; encoded explicitly here. `protected` is a sticky pin.
pub const TRANSITIONS: &[(InventoryState, InventoryState)] = &[
    (InventoryState::Observed, InventoryState::Classified),
    (InventoryState::Observed, InventoryState::Changed),
    (InventoryState::Observed, InventoryState::Missing),
    (InventoryState::Observed, InventoryState::Protected),
    (InventoryState::Classified, InventoryState::Rejected),
    (InventoryState::Classified, InventoryState::Changed),
    (InventoryState::Classified, InventoryState::Missing),
    (InventoryState::Classified, InventoryState::Protected),
    (InventoryState::Changed, InventoryState::Observed),
    (InventoryState::Changed, InventoryState::Missing),
    (InventoryState::Changed, InventoryState::Protected),
    (InventoryState::Missing, InventoryState::Observed),
    (InventoryState::Missing, InventoryState::Protected),
    (InventoryState::Rejected, InventoryState::Classified),
    (InventoryState::Rejected, InventoryState::Protected),
];

#[must_use]
pub fn is_allowed(from: InventoryState, to: InventoryState) -> bool {
    TRANSITIONS.iter().any(|&(f, t)| f == from && t == to)
}

/// A scanned filesystem entry under a `LibraryRoot`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileRecord {
    pub id: EntityId,
    pub root_id: EntityId,
    pub relative_path: String,
    pub size_bytes: u64,
    pub mtime: Timestamp,
    pub content_hash: Option<ContentHash>,
    pub state: InventoryState,
    pub first_seen_at: Timestamp,
    pub last_seen_at: Timestamp,
}
