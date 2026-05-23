//! ProvenancedValue<T> — append-only value wrapper carrying observed/inferred/reviewed history.
//!
//! Priority rule: reviewed > inferred > observed > generated > planned > applied
//! (spec 002 data-model.md §ProvenancedValue).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ids::{EntityId, Timestamp};

/// Origin tag that classifies how a value was derived or confirmed.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceTag {
    /// Extracted directly from a FITS/XISF keyword or filesystem attribute.
    Observed,
    /// Derived algorithmically (e.g. session key from frame metadata).
    Inferred,
    /// Confirmed or corrected by the user.
    Reviewed,
    /// Recomputed from source data (e.g. manifest regeneration).
    Generated,
    /// Set by a pending `FilesystemPlan` — cleared when plan resolves.
    Planned,
    /// Written after a `FilesystemPlan` reaches `applied`.
    Applied,
}

/// One entry in the append-only provenance history.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceEntry<T: JsonSchema> {
    /// The value that was in effect when this entry was captured.
    pub value: T,
    pub origin: ProvenanceTag,
    pub captured_at: Timestamp,
    /// Opaque reference to the originating source (file_record id, plan id, reviewer id, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<EntityId>,
    /// Optional pointer to the entry that superseded this one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_by: Option<String>,
}

/// Priority score — lower number = higher priority.
fn priority(tag: ProvenanceTag) -> u8 {
    match tag {
        ProvenanceTag::Reviewed => 0,
        ProvenanceTag::Inferred => 1,
        ProvenanceTag::Observed => 2,
        ProvenanceTag::Generated => 3,
        ProvenanceTag::Planned => 4,
        ProvenanceTag::Applied => 5,
    }
}

/// Wrapper that carries a value with its full provenance trail.
///
/// `history` is append-only; mutation produces a new entry without erasing prior ones.
/// Inline history is bounded per origin tag; older entries spill to `provenance_history_archive`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProvenancedValue<T: JsonSchema> {
    /// Effective current value (priority: reviewed > inferred > observed > generated > planned > applied).
    pub current: T,
    /// The origin tag of the winning entry.
    pub origin: ProvenanceTag,
    /// Append-only history. Most recent N entries per origin, newest first.
    pub history: Vec<ProvenanceEntry<T>>,
    /// True when older entries exist in the `provenance_history_archive` table.
    #[serde(default)]
    pub history_truncated: bool,
}

impl<T: Clone + JsonSchema> ProvenancedValue<T> {
    /// Construct with a single initial entry.
    #[must_use]
    pub fn new(value: T, origin: ProvenanceTag, captured_at: Timestamp) -> Self {
        let entry = ProvenanceEntry {
            value: value.clone(),
            origin,
            captured_at,
            source_id: None,
            replaced_by: None,
        };
        Self { current: value, origin, history: vec![entry], history_truncated: false }
    }

    /// Append a new entry and recompute the winning current value.
    pub fn push(&mut self, entry: ProvenanceEntry<T>) {
        // If the new entry has higher priority (lower score), promote it to current.
        if priority(entry.origin) <= priority(self.origin) {
            self.current = entry.value.clone();
            self.origin = entry.origin;
        }
        self.history.insert(0, entry); // newest first
    }
}
