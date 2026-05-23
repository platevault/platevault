//! DataSource (LibraryRoot) lifecycle state model (spec 002 data-model.md §LibraryRoot).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ids::{EntityId, Timestamp};

#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum DataSourceState {
    Active,
    Missing,
    Disabled,
    ReconnectRequired,
}

#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum LibraryRootKind {
    Local,
    External,
    Network,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegisteredSource {
    pub id: EntityId,
    pub label: String,
    pub current_path: String,
    pub kind: LibraryRootKind,
    pub state: DataSourceState,
    pub last_seen_at: Option<Timestamp>,
    pub created_at: Timestamp,
}
