// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Issues IPC (spec 063 FR-032, D-W92, D-W144, D-W158): every issue on the
//! row it affects with the status-bar counters and each page's count, and a
//! row's Dismiss and Restore.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `issues` block. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::IssueView;
use tauri::State;

use super::library::{fail, Reply};

/// Every current issue: those that count, those dismissed, the counters by
/// severity and, per severity, each page with its count. Reading forgets a
/// dismissal whose issue ended or changed.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read or written.
#[tauri::command]
#[specta::specta]
pub async fn library_issues(library: State<'_, Arc<Library>>) -> Reply<IssueView> {
    library.issues().await.map_err(fail(None))
}

/// Dismiss the current issue with `fingerprint` until it changes.
///
/// # Errors
/// `NotFound` when no current issue has it; `InvalidInput` for a Project's
/// own waiting work; `PersistenceFailure` when the catalog cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn library_dismiss_issue(
    library: State<'_, Arc<Library>>,
    fingerprint: String,
) -> Reply<()> {
    library.dismiss_issue(&fingerprint).await.map_err(fail(None))
}

/// Restore the dismissed issue with `fingerprint`.
///
/// # Errors
/// `NotFound` when no dismissal has it; `PersistenceFailure` when the
/// catalog cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn library_restore_issue(
    library: State<'_, Arc<Library>>,
    fingerprint: String,
) -> Reply<()> {
    library.restore_issue(&fingerprint).await.map_err(fail(None))
}
