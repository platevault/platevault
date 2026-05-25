//! Session contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `AcquisitionSession` in
//! `apps/desktop/src/api/types.ts` and the fixture data in
//! `apps/desktop/src/data/fixtures/sessions.ts`. They are the Rust-side
//! source of truth once tauri-specta generates the typed bindings.

use serde::{Deserialize, Serialize};
use specta::Type;

// Re-use existing enums from sibling contract modules to avoid specta
// name collisions (`ProvenanceOrigin`, `SessionState`).
pub use crate::lifecycle::SessionState;
pub use crate::provenance::ProvenanceOrigin;

/// Confidence level for inferred or reviewed metadata.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceLevel {
    Unknown,
    Low,
    Medium,
    High,
    Confirmed,
    Rejected,
}

/// A single metadata value with provenance and confidence tracking.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MetaValue {
    /// Free-form JSON value. Uses [`crate::JsonAny`] to avoid specta's
    /// infinite-recursion issue with raw `serde_json::Value`.
    pub value: crate::JsonAny,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
    pub origin: ProvenanceOrigin,
    pub confidence: ConfidenceLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_ref: Option<String>,
}

/// Composite key that uniquely identifies an acquisition session by its
/// observing parameters.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionKey {
    pub target: String,
    pub filter: String,
    pub binning: String,
    pub gain: String,
    /// ISO date of the observing night (local sunset date).
    pub night: String,
}

/// An acquisition session as seen through the IPC boundary.
///
/// This is the list-level representation returned by `sessions.list`. It
/// matches the frontend's `AcquisitionSession` interface in `types.ts`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionSession {
    pub id: String,
    pub session_key: SessionKey,
    pub state: SessionState,
    pub confidence: ConfidenceLevel,
    pub optical_train_id: String,
    pub frame_count: u32,
    pub total_integration_seconds: f64,
    pub total_size_bytes: u64,
    pub metadata: std::collections::HashMap<String, MetaValue>,
    pub target_ids: Vec<String>,
    pub project_ids: Vec<String>,
    pub warnings: Vec<String>,
}
