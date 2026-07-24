// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! DataSource (LibraryRoot) lifecycle state model (spec 002 data-model.md §LibraryRoot).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
use strum::{EnumString, IntoStaticStr};

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
    EnumString,
    IntoStaticStr,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum DataSourceState {
    Active,
    Missing,
    Disabled,
    ReconnectRequired,
}

/// Canonical allowed `(from, to)` edge list per data-model.md §LibraryRoot §Lifecycle.
/// A root in `missing` or `reconnect_required` MUST NOT be auto-promoted to `active`
/// without a user-triggered rescan (data-model.md §LibraryRoot §Invariants).
pub const TRANSITIONS: &[(DataSourceState, DataSourceState)] = &[
    (DataSourceState::Active, DataSourceState::Missing),
    (DataSourceState::Missing, DataSourceState::Active),
    (DataSourceState::Missing, DataSourceState::ReconnectRequired),
    (DataSourceState::ReconnectRequired, DataSourceState::Active),
    (DataSourceState::Active, DataSourceState::Disabled),
    (DataSourceState::Disabled, DataSourceState::Active),
];

#[must_use]
pub fn is_allowed(from: DataSourceState, to: DataSourceState) -> bool {
    TRANSITIONS.iter().any(|&(f, t)| f == from && t == to)
}

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
