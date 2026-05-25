//! Search contract DTOs for the Tauri IPC surface.
//!
//! These types mirror the hand-written TypeScript `SearchResult` in
//! `apps/desktop/src/api/types.ts`.

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Kind of entity returned by a global search.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum SearchResultKind {
    Session,
    Target,
    Project,
    Page,
    Action,
}

// ── Structs ─────────────────────────────────────────────────────────────────

/// A single search result from global search.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub kind: SearchResultKind,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sublabel: Option<String>,
    pub route: String,
    pub score: f64,
}
