//! Review queue contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `ReviewItem` in
//! `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::sessions::{ConfidenceLevel, MetaValue};

// ── Enums ───────────────────────────────────────────────────────────────────

/// Kind of item in the review queue.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum ReviewItemKind {
    Session,
    UnclassifiedFile,
}

// ── Structs ─────────────────────────────────────────────────────────────────

/// An item in the review queue awaiting user decision.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    pub id: String,
    pub kind: ReviewItemKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    pub confidence: ConfidenceLevel,
    pub blocking_reasons: Vec<String>,
    pub evidence: std::collections::HashMap<String, MetaValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_filter: Option<String>,
}
