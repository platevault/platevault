//! Spec 029 global search stubs exposed to the Tauri webview.
//!
//! Stub implementations returning hardcoded fixture data matching the mock
//! layer until the real persistence layer is wired.

use contracts_core::search::{SearchResult, SearchResultKind};

/// `search.global` — performs a global search across all entity types.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "search.global")]
pub async fn search_global(query: String) -> Result<Vec<SearchResult>, String> {
    tracing::debug!("stub: search.global query={query}");
    Ok(vec![
        SearchResult {
            id: "ses-001".to_owned(),
            kind: SearchResultKind::Session,
            label: "M31 L 2026-05-18".to_owned(),
            sublabel: Some("120 frames".to_owned()),
            route: "/sessions/ses-001".to_owned(),
            score: 0.95,
        },
        SearchResult {
            id: "target-001".to_owned(),
            kind: SearchResultKind::Target,
            label: "M31 - Andromeda Galaxy".to_owned(),
            sublabel: Some("5 sessions".to_owned()),
            route: "/targets/target-001".to_owned(),
            score: 0.90,
        },
        SearchResult {
            id: "proj-001".to_owned(),
            kind: SearchResultKind::Project,
            label: "M31 LRGB".to_owned(),
            sublabel: Some("Processing".to_owned()),
            route: "/projects/proj-001".to_owned(),
            score: 0.85,
        },
        SearchResult {
            id: "nav-sessions".to_owned(),
            kind: SearchResultKind::Page,
            label: "Sessions".to_owned(),
            sublabel: Some("Browse all sessions".to_owned()),
            route: "/sessions".to_owned(),
            score: 0.50,
        },
    ])
}
