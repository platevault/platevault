//! Spec 030 status summary command (T023).
//!
//! Returns a `StatusSummary` DTO with zeroed counts. Real aggregation from
//! the database will be wired in a later task.

use contracts_core::status::{LibraryStats, StatusSummary};

/// `status.summary` — returns current library status overview.
///
/// # Errors
/// Returns `Err(String)` on failure; the stub never fails.
#[tauri::command]
#[specta::specta(rename = "status.summary")]
pub async fn status_summary() -> Result<StatusSummary, String> {
    tracing::debug!("stub: status.summary");
    Ok(StatusSummary {
        inbox_count: 0,
        library: LibraryStats { sessions: 0, calibration_sets: 0, targets: 0, projects: 0 },
        cleanup_reclaimable_bytes: 0,
        volumes: vec![],
        roots: vec![],
    })
}
