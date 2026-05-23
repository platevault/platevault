//! Project lifecycle state model (spec 002 data-model.md §Project).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ids::{EntityId, Timestamp};

/// Lifecycle state for a `Project`.
///
/// 7 variants from spec 002 §Project and research.md §2.1.
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
)]
#[serde(rename_all = "snake_case")]
pub enum ProjectState {
    SetupIncomplete,
    Ready,
    Prepared,
    Processing,
    Completed,
    Archived,
    /// Carries a `block_reason` on the entity row.
    Blocked,
}

impl ProjectState {
    #[must_use]
    pub const fn is_before_archive(self) -> bool {
        matches!(
            self,
            Self::SetupIncomplete
                | Self::Ready
                | Self::Prepared
                | Self::Processing
                | Self::Completed
        )
    }
}

/// Snapshot of `{label, at, actor}` recorded in the UI projection column.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct LastAction {
    pub label: String,
    pub at: String,
    pub actor: String,
}

/// Stub entity struct — full fields wired in persistence layer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: EntityId,
    pub name: String,
    pub target_id: EntityId,
    pub session_ids: Vec<EntityId>,
    pub state: ProjectState,
    pub last_action: Option<LastAction>,
    pub block_reason: Option<String>,
    pub created_at: Timestamp,
}
