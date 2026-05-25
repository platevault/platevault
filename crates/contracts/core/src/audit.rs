//! Audit contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `AuditEntry` in
//! `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Outcome of an audited action.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AuditOutcome {
    Applied,
    Ok,
    Refused,
    Failed,
    Paused,
}

/// Actor that triggered the audited action.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AuditActor {
    User,
    System,
}

// ── Structs ─────────────────────────────────────────────────────────────────

/// A single audit log entry.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub timestamp: String,
    pub event_type: String,
    pub entity_type: String,
    pub entity_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_state: Option<String>,
    pub actor: AuditActor,
    pub outcome: AuditOutcome,
    pub detail: String,
}

/// Paginated response for audit list queries.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuditListResponse {
    pub entries: Vec<AuditEntry>,
    pub total: u32,
}
