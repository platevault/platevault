//! PreparedSource lifecycle state model (spec 002 data-model.md).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ids::{EntityId, Timestamp};

#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum PreparedSourceState {
    NotCreated,
    Planned,
    Ready,
    Stale,
    Retired,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedSourceView {
    pub id: EntityId,
    pub project_id: EntityId,
    pub state: PreparedSourceState,
    pub created_at: Timestamp,
}
