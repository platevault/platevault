// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Run lifecycle IPC (spec 070 RES-FR-06/07/10, PRJ-FR-20, amended D-W72).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `runs` block. Mark Complete is blocked only by a Running
//! app-owned operation affecting the run; Move run to Trash is also refused
//! while one of the run's accepted Results is an input to another run; each
//! refusal names every blocker. Neither, nor Reopen or Restore, moves a file.
//! The Empty Trash review only reads: PV-STO executes it. Failures follow the
//! library [`platevault_core::ErrorResponse`] conventions, naming the run or
//! the Project.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{EmptyTrashReview, TrashedRun, ViewRecord};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Mark processing complete: the run moves to Done. Needs no Result,
/// removes nothing and starts no Clean up.
///
/// # Errors
/// `InvalidInput` naming each Running operation affecting the run, or for a
/// run already Complete or in the Project's Trash; `NotFound` for an unknown
/// run.
#[tauri::command]
pub async fn view_mark_complete(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
) -> Reply<ViewRecord> {
    library.mark_view_complete(view_id).await.map_err(fail(Some(view_id)))
}

/// Reopen a Complete run at the stage it was in before Complete.
///
/// # Errors
/// `InvalidInput` for a run that is not Complete or is in the Project's
/// Trash; `NotFound` for an unknown run.
#[tauri::command]
pub async fn view_reopen(library: State<'_, Arc<Library>>, view_id: Uuid) -> Reply<ViewRecord> {
    library.catalog().reopen_view(view_id).await.map_err(fail(Some(view_id)))
}

/// Move the run to its Project's Trash at any stage. Moves no file.
///
/// # Errors
/// `InvalidInput` naming each blocker (a Running operation, a run using one
/// of its Results), or for a run already in the Trash; `NotFound` for an
/// unknown run.
#[tauri::command]
pub async fn view_move_to_trash(
    library: State<'_, Arc<Library>>,
    view_id: Uuid,
) -> Reply<ViewRecord> {
    library.move_view_to_trash(view_id).await.map_err(fail(Some(view_id)))
}

/// Restore the run from its Project's Trash exactly as it was.
///
/// # Errors
/// `InvalidInput` for a run that is not in the Trash; `NotFound` for an
/// unknown run.
#[tauri::command]
pub async fn view_restore(library: State<'_, Arc<Library>>, view_id: Uuid) -> Reply<ViewRecord> {
    library.catalog().restore_view(view_id).await.map_err(fail(Some(view_id)))
}

/// The Project's Trash list: each run in it with its stage. Read-only.
///
/// # Errors
/// `NotFound` for an unknown Project.
#[tauri::command]
pub async fn view_trash_list(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<Vec<TrashedRun>> {
    library.catalog().trashed_views(project_id).await.map_err(fail(Some(project_id)))
}

/// The Empty Trash review: every run in the Project's Trash, or only
/// `viewIds`, with its prepared folders and its Results folder. Read-only.
///
/// # Errors
/// `InvalidInput` for an asked run not in this Project's Trash; `NotFound`
/// for an unknown Project.
#[tauri::command]
pub async fn view_empty_trash_review(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    view_ids: Option<Vec<Uuid>>,
) -> Reply<EmptyTrashReview> {
    let views = view_ids.unwrap_or_default();
    library.empty_trash_review(project_id, &views).await.map_err(fail(Some(project_id)))
}
