//! Spec 030 status summary command (T023).
//!
//! Returns a `StatusSummary` DTO populated from the database.

use std::path::Path;

use contracts_core::status::{LibraryStats, RootHealth, StatusSummary};
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;
use persistence_db::repositories::q_desktop::{
    count_acquisition_sessions, count_calibration_masters, count_canonical_targets, count_projects,
    count_unacknowledged_inbox_items,
};

/// `status.summary` — returns current library status overview.
///
/// Roots are fetched from `registered_sources`; each root's `online` flag is
/// set by testing whether its path is currently accessible on the filesystem.
/// `inbox_count` reflects the real number of unacknowledged inbox items
/// (`pending_classification` or `classified`) across all registered sources.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn status_summary(state: State<'_, AppState>) -> Result<StatusSummary, ContractError> {
    tracing::debug!("status.summary");

    let pool = state.repo.pool();

    let sources = persistence_db::repositories::first_run::list_sources(pool)
        .await
        .map_err(|e| ContractError::internal(e.to_string()))?;

    let roots: Vec<RootHealth> = sources
        .into_iter()
        .map(|s| {
            let online = Path::new(&s.path).exists();
            RootHealth {
                id: s.source_id,
                path: s.path,
                kind: format!("{:?}", s.kind).to_lowercase(),
                online,
            }
        })
        .collect();

    // Count unacknowledged inbox items (states that need user attention).
    let inbox_count: u32 = count_unacknowledged_inbox_items(pool)
        .await
        .map(|n| u32::try_from(n.max(0)).unwrap_or(u32::MAX))
        .map_err(|e| ContractError::internal(e.to_string()))?;

    // Count real library totals from their authoritative tables.
    let sessions: u32 = count_acquisition_sessions(pool)
        .await
        .map(|n| u32::try_from(n.max(0)).unwrap_or(u32::MAX))
        .map_err(|e| ContractError::internal(e.to_string()))?;

    let calibration_sets: u32 = count_calibration_masters(pool)
        .await
        .map(|n| u32::try_from(n.max(0)).unwrap_or(u32::MAX))
        .map_err(|e| ContractError::internal(e.to_string()))?;

    let targets: u32 = count_canonical_targets(pool)
        .await
        .map(|n| u32::try_from(n.max(0)).unwrap_or(u32::MAX))
        .map_err(|e| ContractError::internal(e.to_string()))?;

    let projects: u32 = count_projects(pool)
        .await
        .map(|n| u32::try_from(n.max(0)).unwrap_or(u32::MAX))
        .map_err(|e| ContractError::internal(e.to_string()))?;

    Ok(StatusSummary {
        inbox_count,
        library: LibraryStats { sessions, calibration_sets, targets, projects },
        cleanup_reclaimable_bytes: 0,
        volumes: vec![],
        roots,
    })
}
