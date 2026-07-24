// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Projection lifecycle state model (spec 002 data-model.md §ProcessingArtifact).

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
pub enum ProjectionState {
    Current,
    Stale,
    Regenerating,
}

/// Canonical allowed `(from, to)` edges per data-model.md §ProcessingArtifact §Lifecycle.
pub const TRANSITIONS: &[(ProjectionState, ProjectionState)] = &[
    (ProjectionState::Current, ProjectionState::Stale),
    (ProjectionState::Stale, ProjectionState::Regenerating),
    (ProjectionState::Regenerating, ProjectionState::Current),
    (ProjectionState::Regenerating, ProjectionState::Stale),
];

#[must_use]
pub fn is_allowed(from: ProjectionState, to: ProjectionState) -> bool {
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
pub enum ArtifactKind {
    Master,
    Integration,
    Drizzle,
    Manifest,
    Other,
}

/// A processing artifact tracked by the app but not produced by it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProcessingArtifact {
    pub id: EntityId,
    pub project_id: Option<EntityId>,
    pub file_record_id: EntityId,
    pub kind: ArtifactKind,
    pub tool: Option<String>,
    pub staleness: ProjectionState,
    pub created_at: Timestamp,
}
