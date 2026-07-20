// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Bridges persisted ingestion settings to inbox scan traversal options.
//!
//! Lives in `app_core` rather than `app_core_inbox` because it needs both the
//! settings store (`app_core_settings`) and the scanner (`app_core_inbox`);
//! `app_core_inbox` depends on neither (same rationale as `inbox_plan`).
//!
//! Only `follow_symlinks` is resolved here. The scanner treats symlinks and
//! Windows junctions as one class (`fs_pathsafe::is_link_or_junction`), so the
//! contract's separate `follow_junctions` flag has no distinct effect, and no
//! scan path branches on `hashing_mode`, `scan_on_startup`, or
//! `metadata_extraction`.

use app_core_inbox::scan::ScanOptions;
use app_core_settings::ingestion::get_ingestion_settings;
use contracts_core::ContractError;
use sqlx::SqlitePool;

/// Build [`ScanOptions`] from the persisted ingestion settings.
///
/// # Errors
/// Returns `ContractError` when the settings document cannot be read.
pub async fn resolve_scan_options(pool: &SqlitePool) -> Result<ScanOptions, ContractError> {
    let settings = get_ingestion_settings(pool).await?;
    Ok(ScanOptions { follow_symlinks: settings.follow_symlinks })
}
