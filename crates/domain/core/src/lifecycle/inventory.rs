//! FileRecord (inventory) lifecycle state model (spec 002 data-model.md §FileRecord).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ids::{ContentHash, EntityId, Timestamp};

/// Lifecycle state for a `FileRecord` (inventory entry).
///
/// 6 variants per spec 002 §FileRecordState.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
    Type,
)]
#[serde(rename_all = "snake_case")]
pub enum InventoryState {
    Observed,
    Changed,
    Classified,
    Missing,
    Rejected,
    Protected,
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
