//! Target contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `Target` and `TargetDetail`
//! in `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::lifecycle::ProjectState;
use crate::sessions::AcquisitionSession;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Classification of an astronomical target.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum TargetKind {
    DeepSky,
    Planetary,
    Lunar,
    Solar,
    Landscape,
}

// ── Structs ─────────────────────────────────────────────────────────────────

/// Catalog identifiers for a target (NGC, IC, Messier, etc.).
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogIds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ngc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messier: Option<String>,
}

/// Equatorial coordinates (J2000).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Coordinates {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ra: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dec: Option<f64>,
}

/// An astronomical target as seen in list views.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub catalog_ids: CatalogIds,
    pub kind: TargetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coordinates: Option<Coordinates>,
    pub session_count: u32,
    pub project_count: u32,
    pub total_integration_hours: f64,
    /// Filter name -> acquired hours.
    pub coverage: std::collections::HashMap<String, f64>,
    /// Filter name -> recommended hours.
    pub recommended_hours: std::collections::HashMap<String, f64>,
}

/// A project stub within the target detail view.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetProjectStub {
    pub id: String,
    pub name: String,
    pub state: ProjectState,
}

/// Extended detail view of a target.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetDetail {
    // Flattened base fields from Target.
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub catalog_ids: CatalogIds,
    pub kind: TargetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coordinates: Option<Coordinates>,
    pub session_count: u32,
    pub project_count: u32,
    pub total_integration_hours: f64,
    pub coverage: std::collections::HashMap<String, f64>,
    pub recommended_hours: std::collections::HashMap<String, f64>,
    // Detail-only fields.
    pub sessions: Vec<AcquisitionSession>,
    pub projects: Vec<TargetProjectStub>,
}
