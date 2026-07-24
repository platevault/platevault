// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 030 status summary command (T023).
//!
//! Returns a `StatusSummary` DTO populated from the database.

use std::time::Duration;

use contracts_core::status::{LibraryStats, RootHealth, StatusSummary};
use futures_util::future::join_all;
use tauri::State;
use tokio::time::timeout;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;
use persistence_targets::repositories::q_desktop::{
    count_acquisition_sessions, count_calibration_masters, count_projects,
    count_unacknowledged_inbox_items,
};
use persistence_targets::repositories::target_favourites::count_favourites;

/// Maximum time to wait for a single root-path existence probe.
///
/// An offline SMB/NAS mount can block an OS `stat` call for the full RPC
/// timeout (up to 30 s on some hosts). Capping each probe keeps the sidebar
/// responsive; timed-out roots report `online: false`.
const ROOT_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// `status.summary` — returns current library status overview.
///
/// Roots are fetched from `registered_sources`; each root's `online` flag is
/// set by testing whether its path is currently accessible on the filesystem.
/// Probes run concurrently with a per-root timeout so an offline NAS/SMB root
/// cannot block a tokio worker for the full OS stat timeout.
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

    let sources = persistence_lifecycle::repositories::first_run::list_sources(pool)
        .await
        .map_err(|e| ContractError::internal(e.to_string()))?;

    // Probe all roots concurrently; each probe is capped at ROOT_PROBE_TIMEOUT
    // so total latency = slowest single probe capped at the timeout, not the sum.
    let probe_futs = sources.into_iter().map(|s| async move {
        let path = s.path.clone();
        let kind = format!("{:?}", s.kind).to_lowercase();
        let online = timeout(ROOT_PROBE_TIMEOUT, tokio::fs::try_exists(&path))
            .await
            .ok() // timeout => None => false
            .and_then(std::result::Result::ok) // permission-denied / IO error => offline, matching Path::exists() behaviour
            .unwrap_or(false);
        RootHealth { id: s.source_id, path, kind, online }
    });
    let roots: Vec<RootHealth> = join_all(probe_futs).await;

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

    // "My targets" (issue #574): the count of favourited targets, matching
    // the Targets page's "My Targets" filter — not the bundled seed catalog.
    let targets: u32 = count_favourites(pool)
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
