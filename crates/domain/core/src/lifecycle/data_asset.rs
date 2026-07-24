// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `EntityType` enum — the string tag for each entity family in contracts and audit rows.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
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
    /// A calibration master assignment (#1120) — audit-only entity type, same
    /// precedent as Framing. `calibration_assignment` rows are created and
    /// deleted outright rather than transitioned, so an assignment's history
    /// survives only in `audit_log_entry`.
    Calibration,
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
            Self::Calibration => "calibration",
        }
    }
}

impl std::fmt::Display for EntityType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

