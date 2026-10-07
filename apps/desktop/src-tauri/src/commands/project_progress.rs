// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project goal progress IPC (spec 065: PRJ-FR-04, PRJ-FR-11, PRJ-FR-21).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `projects` block. Each goal carries its "in project" and
//! "captured" numbers, labelled apart, and goal met reads "in project" only;
//! warnings are never goals. Failures follow the library [`ErrorResponse`]
//! conventions. The command reads only: no file, decision or record changes.
//!
//! [`ErrorResponse`]: platevault_core::ErrorResponse

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::ProjectProgress;
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// The Project's goal progress, in goal order, and its warnings. Read-only.
///
/// # Errors
/// `NotFound` for an unknown Project; `Conflict` when a candidate session
/// changed during the read, so the caller reads again.
#[tauri::command]
pub async fn project_progress(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<ProjectProgress> {
    library.project_progress(project_id).await.map_err(fail(Some(project_id)))
}
