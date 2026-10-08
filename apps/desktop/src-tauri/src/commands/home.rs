// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Home IPC (spec 065 PRJ-FR-17/18/19, root FR-020): the dashboard read.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `home` block. Read-only; failures follow the library
//! [`platevault_core::ErrorResponse`] conventions.

use std::sync::Arc;

use platevault_core::home::HomeDashboard;
use platevault_core::library::Library;
use platevault_core::tonight::TonightQuery;
use tauri::State;

use super::library::{fail, Reply};

/// Home: the top line "N sessions need a Target · M not in any Project",
/// then Actions, Projects with goals, stages and one Next action (Done ones
/// only when `showDone`), New sessions, Tonight for `tonight`, Target status
/// and Running work.
///
/// # Errors
/// `InvalidInput` for invalid Tonight criteria; `PersistenceFailure` when the
/// catalog cannot be read.
#[tauri::command]
pub async fn home_dashboard(
    library: State<'_, Arc<Library>>,
    show_done: Option<bool>,
    tonight: TonightQuery,
) -> Reply<HomeDashboard> {
    library.home_dashboard(show_done.unwrap_or(false), &tonight).await.map_err(fail(None))
}
