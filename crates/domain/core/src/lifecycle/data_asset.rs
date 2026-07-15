// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! DataAsset trait + enum dispatch over all tracked entity families.
//! Spec 002 FR-007: every Data Asset exposes a common lifecycle interface.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ids::EntityId;
use crate::lifecycle::data_source::{DataSourceState, RegisteredSource};
use crate::lifecycle::inventory::{FileRecord, InventoryState};
use crate::lifecycle::plan::{FilesystemPlan, PlanState};
use crate::lifecycle::prepared_source::{PreparedSourceState, PreparedSourceView};
use crate::lifecycle::project::{Project, ProjectState};
use crate::lifecycle::projection::{ProcessingArtifact, ProjectionState};
/// The string tag used in contracts and audit rows for each entity family.
///
/// Spec 041 FR-051 (T076): `AcquisitionSession`, `CalibrationSession`, and
/// `InventorySession` were removed. Sessions no longer carry a
/// review-transitionable lifecycle state, so they are no longer Data Assets
/// dispatched through the generic `lifecycle.transition` machinery.
///
/// Spec 030 FR-130–FR-134 (T120, Q15/#647): `Settings`, `Protection`, and
/// `Equipment` extend the tag set to non-lifecycle audit-worthy mutations
/// (durable `audit_log_entry` rows written via `EventBus::write_audit`, not
/// through `lifecycle.transition`/`record_transition`'s CAS state-column
/// path — they carry no lifecycle state and are never dispatched through
/// `DataAsset`). Source/root mutations reuse the existing `DataSource` /
/// `LibraryRoot` tags.
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
pub enum EntityType {
    LibraryRoot,
    FileRecord,
    DataSource,
    Project,
    PreparedSource,
    ProcessingArtifact,
    Projection,
    Plan,
    FilesystemPlan,
    Settings,
    Protection,
    Equipment,
    /// A framing (spec 008 Q27) — audit-only entity type, same precedent as
    /// Settings/Protection/Equipment (no lifecycle table/transitions of its
    /// own; only used at the `insert_audit_entry` write path).
    Framing,
}

impl EntityType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LibraryRoot => "library_root",
            Self::FileRecord => "file_record",
            Self::DataSource => "data_source",
            Self::Project => "project",
            Self::PreparedSource => "prepared_source",
            Self::ProcessingArtifact => "processing_artifact",
            Self::Projection => "projection",
            Self::Plan => "plan",
            Self::FilesystemPlan => "filesystem_plan",
            Self::Settings => "settings",
            Self::Protection => "protection",
            Self::Equipment => "equipment",
            Self::Framing => "framing",
        }
    }
}

impl std::fmt::Display for EntityType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Common interface shared by all Data Asset families.
pub trait DataAsset {
    fn entity_id(&self) -> EntityId;
    fn entity_type(&self) -> EntityType;
    fn current_state_label(&self) -> &'static str;
}

impl DataAsset for Project {
    fn entity_id(&self) -> EntityId {
        self.id
    }

    fn entity_type(&self) -> EntityType {
        EntityType::Project
    }

    fn current_state_label(&self) -> &'static str {
        match self.state {
            ProjectState::SetupIncomplete => "setup_incomplete",
            ProjectState::Ready => "ready",
            ProjectState::Prepared => "prepared",
            ProjectState::Processing => "processing",
            ProjectState::Completed => "completed",
            ProjectState::Archived => "archived",
            ProjectState::Blocked => "blocked",
        }
    }
}

impl DataAsset for FilesystemPlan {
    fn entity_id(&self) -> EntityId {
        self.id
    }

    fn entity_type(&self) -> EntityType {
        EntityType::FilesystemPlan
    }

    fn current_state_label(&self) -> &'static str {
        match self.state {
            PlanState::Draft => "draft",
            PlanState::ReadyForReview => "ready_for_review",
            PlanState::Approved => "approved",
            PlanState::Applying => "applying",
            PlanState::Paused => "paused",
            PlanState::Applied => "applied",
            PlanState::PartiallyApplied => "partially_applied",
            PlanState::Failed => "failed",
            PlanState::Cancelled => "cancelled",
            PlanState::Discarded => "discarded",
        }
    }
}

impl DataAsset for FileRecord {
    fn entity_id(&self) -> EntityId {
        self.id
    }

    fn entity_type(&self) -> EntityType {
        EntityType::FileRecord
    }

    fn current_state_label(&self) -> &'static str {
        match self.state {
            InventoryState::Observed => "observed",
            InventoryState::Changed => "changed",
            InventoryState::Classified => "classified",
            InventoryState::Missing => "missing",
            InventoryState::Rejected => "rejected",
            InventoryState::Protected => "protected",
        }
    }
}

impl DataAsset for RegisteredSource {
    fn entity_id(&self) -> EntityId {
        self.id
    }

    fn entity_type(&self) -> EntityType {
        EntityType::DataSource
    }

    fn current_state_label(&self) -> &'static str {
        match self.state {
            DataSourceState::Active => "active",
            DataSourceState::Missing => "missing",
            DataSourceState::Disabled => "disabled",
            DataSourceState::ReconnectRequired => "reconnect_required",
        }
    }
}

impl DataAsset for PreparedSourceView {
    fn entity_id(&self) -> EntityId {
        self.id
    }

    fn entity_type(&self) -> EntityType {
        EntityType::PreparedSource
    }

    fn current_state_label(&self) -> &'static str {
        match self.state {
            PreparedSourceState::NotCreated => "not_created",
            PreparedSourceState::Planned => "planned",
            PreparedSourceState::Ready => "ready",
            PreparedSourceState::Stale => "stale",
            PreparedSourceState::Retired => "retired",
        }
    }
}

impl DataAsset for ProcessingArtifact {
    fn entity_id(&self) -> EntityId {
        self.id
    }

    fn entity_type(&self) -> EntityType {
        EntityType::ProcessingArtifact
    }

    fn current_state_label(&self) -> &'static str {
        match self.staleness {
            ProjectionState::Current => "current",
            ProjectionState::Stale => "stale",
            ProjectionState::Regenerating => "regenerating",
        }
    }
}
