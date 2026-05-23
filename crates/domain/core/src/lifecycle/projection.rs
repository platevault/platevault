//! Projection lifecycle state model (spec 002 data-model.md §ProcessingArtifact).

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
pub enum ProjectionState {
    Current,
    Stale,
    Regenerating,
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
