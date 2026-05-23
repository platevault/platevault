//! DataAsset trait + enum dispatch over all tracked entity families.
//! Spec 002 FR-007: every Data Asset exposes a common lifecycle interface.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::ids::EntityId;
use crate::lifecycle::data_source::{DataSourceState, RegisteredSource};
use crate::lifecycle::inventory::{FileRecord, InventoryState};
use crate::lifecycle::plan::{FilesystemPlan, PlanState};
use crate::lifecycle::prepared_source::{PreparedSourceState, PreparedSourceView};
use crate::lifecycle::projection::{ProcessingArtifact, ProjectionState};
use crate::lifecycle::project::{Project, ProjectState};
use crate::lifecycle::session::{AcquisitionSession, CalibrationSession, SessionState};

/// The string tag used in contracts and audit rows for each entity family.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    LibraryRoot,
    FileRecord,
    AcquisitionSession,
    CalibrationSession,
    DataSource,
    Project,
    PreparedSource,
    ProcessingArtifact,
    Projection,
    Plan,
    InventorySession,
    FilesystemPlan,
}

impl EntityType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LibraryRoot => "library_root",
            Self::FileRecord => "file_record",
            Self::AcquisitionSession => "acquisition_session",
            Self::CalibrationSession => "calibration_session",
            Self::DataSource => "data_source",
            Self::Project => "project",
            Self::PreparedSource => "prepared_source",
            Self::ProcessingArtifact => "processing_artifact",
            Self::Projection => "projection",
            Self::Plan => "plan",
            Self::InventorySession => "inventory_session",
            Self::FilesystemPlan => "filesystem_plan",
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

impl DataAsset for AcquisitionSession {
    fn entity_id(&self) -> EntityId {
        self.id
    }

    fn entity_type(&self) -> EntityType {
        EntityType::AcquisitionSession
    }

    fn current_state_label(&self) -> &'static str {
        session_state_label(self.state)
    }
}

impl DataAsset for CalibrationSession {
    fn entity_id(&self) -> EntityId {
        self.id
    }

    fn entity_type(&self) -> EntityType {
        EntityType::CalibrationSession
    }

    fn current_state_label(&self) -> &'static str {
        session_state_label(self.state)
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

fn session_state_label(state: SessionState) -> &'static str {
    match state {
        SessionState::Discovered => "discovered",
        SessionState::Candidate => "candidate",
        SessionState::NeedsReview => "needs_review",
        SessionState::Confirmed => "confirmed",
        SessionState::Rejected => "rejected",
        SessionState::Ignored => "ignored",
    }
}
