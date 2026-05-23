//! PreparedSource lifecycle state model (spec 002 data-model.md).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ids::{EntityId, Timestamp};

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
pub enum PreparedSourceState {
    NotCreated,
    Planned,
    Ready,
    Stale,
    Retired,
}

/// Canonical allowed `(from, to)` edges. Derived from data-model.md §Project
/// edge table side-effects (prepared-source rows are linked at `ready → prepared`,
/// retired at `prepared → ready`) plus the §Plan-Requirement table noting that
/// any `* → retired` edge requires a `FilesystemPlan`.
pub const TRANSITIONS: &[(PreparedSourceState, PreparedSourceState)] = &[
    (PreparedSourceState::NotCreated, PreparedSourceState::Planned),
    (PreparedSourceState::Planned, PreparedSourceState::Ready),
    (PreparedSourceState::Planned, PreparedSourceState::Retired),
    (PreparedSourceState::Ready, PreparedSourceState::Stale),
    (PreparedSourceState::Ready, PreparedSourceState::Retired),
    (PreparedSourceState::Stale, PreparedSourceState::Planned),
    (PreparedSourceState::Stale, PreparedSourceState::Retired),
];

#[must_use]
pub fn is_allowed(from: PreparedSourceState, to: PreparedSourceState) -> bool {
    TRANSITIONS.iter().any(|&(f, t)| f == from && t == to)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedSourceView {
    pub id: EntityId,
    pub project_id: EntityId,
    pub state: PreparedSourceState,
    pub created_at: Timestamp,
}
