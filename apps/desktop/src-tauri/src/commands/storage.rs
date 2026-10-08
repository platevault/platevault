// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage custody IPC (spec 071).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `storage` block. Each feature keeps its own labelled region
//! below. Failures follow the library [`platevault_core::ErrorResponse`]
//! conventions.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::storage::StorageOverview;
use tauri::State;

use super::library::{fail, Reply};

// ---------------------------------------------------------------------------
// Storage overview (STO-FR-11, STO-FR-12, STO-AC-12)
// ---------------------------------------------------------------------------

/// Storage: location availability, run footprints, live content-identity
/// duplicate candidates and archive transfers, each in its own section. Reads
/// only: showing a candidate records no operation and authorizes no removal,
/// and an app-written entry changed outside `PlateVault` reads blocked.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn storage_overview(library: State<'_, Arc<Library>>) -> Reply<StorageOverview> {
    library.storage_overview().await.map_err(fail(None))
}
