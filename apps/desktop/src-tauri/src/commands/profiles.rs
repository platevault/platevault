// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Handoff profile IPC (spec 069 PREP-FR-01/02): the application a Project's
//! View opens in, with its launch arguments and capability evidence.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `profiles` block. Every write names the expected revision and
//! returns the committed profile only after its transaction commits. Failures
//! follow the library [`platevault_core::ErrorResponse`] conventions, naming
//! the profile.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{Profile, ProfileInput, Revision};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Every handoff profile by name.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn prepare_profiles(library: State<'_, Arc<Library>>) -> Reply<Vec<Profile>> {
    library.catalog().profiles().await.map_err(fail(None))
}

/// Record a profile with its executable, launch arguments and capability
/// evidence (D04).
///
/// # Errors
/// `InvalidInput` for a blank name, an unknown placeholder or a claim
/// without its evidence.
#[tauri::command]
#[specta::specta]
pub async fn prepare_profile_create(
    library: State<'_, Arc<Library>>,
    input: ProfileInput,
) -> Reply<Profile> {
    library.catalog().create_profile(&input).await.map_err(fail(None))
}

/// Replace a profile at `expected_revision`.
///
/// # Errors
/// As `prepare_profile_create`; `Conflict` for a stale revision.
#[tauri::command]
#[specta::specta]
pub async fn prepare_profile_update(
    library: State<'_, Arc<Library>>,
    profile_id: Uuid,
    expected_revision: Revision,
    input: ProfileInput,
) -> Reply<Profile> {
    library
        .catalog()
        .update_profile(profile_id, expected_revision, &input)
        .await
        .map_err(fail(Some(profile_id)))
}
