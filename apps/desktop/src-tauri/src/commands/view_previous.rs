// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `View (previous)/` review IPC (spec 066, 071 STO-FR-10; D-W110): the files
//! an Apply left in `View (previous)/` and the user's review of each.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `view previous` block. Apply waits until every leftover is
//! reviewed. The review keeps a file where it is (it is never asked about
//! again), moves it into `View/` at the same place, or moves it to the
//! [`WrapUpTrash`] the shell manages; a file that changed since it was recorded
//! is refused. The resolution arrives as the `contracts_core`
//! [`PreviousItemResolution`], which can't say Pending, the state only the
//! catalog records. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Project.

use std::sync::Arc;

use contracts_core::library_requests::PreviousItemResolution;
use platevault_core::library::Library;
use platevault_core::{NativePath, PreviousItem};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};
use super::project_wrap_up::WrapUpTrash;

/// What `View (previous)/` holds that still waits for review or was kept,
/// relative to the Project folder. Read-only; empty for a Project with none.
///
/// # Errors
/// `PersistenceFailure` for a corrupt record.
#[tauri::command]
#[specta::specta]
pub async fn project_previous_items(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<Vec<PreviousItem>> {
    library.catalog().previous_items(project_id).await.map_err(fail(Some(project_id)))
}

/// Review the leftover at `path`, as [`project_previous_items`] listed it.
///
/// # Errors
/// `NotFound` for an unknown Project or leftover; `InvalidInput` for a review
/// it can't take, a destination `View/` already holds, or a file that changed;
/// `IdentityConflict` when the OS Trash can't take it.
#[tauri::command]
#[specta::specta]
pub async fn project_review_previous_item(
    library: State<'_, Arc<Library>>,
    trash: State<'_, WrapUpTrash>,
    project_id: Uuid,
    path: NativePath,
    resolution: PreviousItemResolution,
) -> Reply<()> {
    library
        .review_view_leftover(project_id, path, resolution.into(), trash.get().as_ref())
        .await
        .map_err(fail(Some(project_id)))
}
