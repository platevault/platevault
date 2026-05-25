//! Library root and equipment contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `LibraryRoot`, `Equipment`,
//! `RemapVerification`, and `OperationHandle` in `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Category of a library root directory.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum RootCategory {
    Raw,
    Calibration,
    Project,
    Inbox,
}

// ── Structs ─────────────────────────────────────────────────────────────────

/// A registered library root directory.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    pub id: String,
    pub path: String,
    pub category: RootCategory,
    pub online: bool,
    pub file_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scanned: Option<String>,
}

/// A piece of astrophotography equipment.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Equipment {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub aliases: Vec<String>,
}

/// A sample path match result within a remap verification.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemapSample {
    pub relative_path: String,
    pub found: bool,
}

/// Verification result for a root path remap operation.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemapVerification {
    pub root_id: String,
    pub original_path: String,
    pub new_path: String,
    pub samples: Vec<RemapSample>,
    pub all_verified: bool,
}

/// Handle for a long-running operation (scan, plan apply, etc.).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcOperationHandle {
    pub operation_id: String,
    pub kind: String,
}

/// Progress event emitted by a long-running operation.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub operation_id: String,
    pub discovered: u32,
    pub total: u32,
    pub current_item: String,
    pub elapsed_ms: u64,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_state: Option<CompletionState>,
}

/// Terminal state of a long-running operation.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum CompletionState {
    Completed,
    Failed,
    Paused,
}
