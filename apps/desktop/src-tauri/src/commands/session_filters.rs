// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Sessions filter IPC (spec 064 LIB-FR-17, spec 065 PRJ-FR-19, D-W59): the
//! "Needs a Target" and "Not in any Project" counts, Create Project prefill and
//! Add to Project. The filters themselves are `library_list_sessions`'s
//! `filter`. Registered only by the isolated rebuilt shell
//! ([`crate::library_shell`]). Nothing here writes a run row; Add to Project
//! writes only Project rows after its transaction commits. Failures follow the
//! library [`ErrorResponse`] conventions.
//!
//! [`ErrorResponse`]: platevault_core::ErrorResponse

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{
    ExpectedSession, ProjectAdded, ProjectAddition, ProjectInput, Revision, SessionFilterCounts,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// The "Needs a Target" and "Not in any Project" list lengths, which Home's top
/// line reports. Read-only.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn library_session_filter_counts(
    library: State<'_, Arc<Library>>,
) -> Reply<SessionFilterCounts> {
    library.catalog().session_filter_counts().await.map_err(fail(None))
}

/// Create Project's prefill from a session: its confirmed Target as the one
/// subject and its confirmed rig. Nothing is saved; `project_create` saves.
///
/// # Errors
/// `NotFound` for an unknown session; `Conflict` for a superseded one;
/// `InvalidInput` when it has no confirmed Target.
#[tauri::command]
pub async fn project_prefill_from_session(
    library: State<'_, Arc<Library>>,
    session_id: Uuid,
) -> Reply<ProjectInput> {
    library.catalog().project_prefill(session_id).await.map_err(fail(Some(session_id)))
}

/// What Add to Project would add for the session, with the note naming a rig
/// it adds. Nothing is saved.
///
/// # Errors
/// `NotFound` for an unknown session or Project; `Conflict` for a superseded
/// session; `InvalidInput` when it has no confirmed Target.
#[tauri::command]
pub async fn project_preview_session_addition(
    library: State<'_, Arc<Library>>,
    session_id: Uuid,
    project_id: Uuid,
) -> Reply<ProjectAddition> {
    library
        .catalog()
        .preview_project_addition(session_id, project_id)
        .await
        .map_err(fail(Some(session_id)))
}

/// Add to Project as previewed: the session's Target as a subject and, when
/// the Project lacks it, its rig, in one Project revision.
///
/// # Errors
/// `Conflict` for a stale Project revision or a changed session; `NotFound`
/// for an unknown session or Project; `InvalidInput` when the session has no
/// confirmed Target.
#[tauri::command]
pub async fn project_add_session(
    library: State<'_, Arc<Library>>,
    session: ExpectedSession,
    project_id: Uuid,
    expected_revision: Revision,
) -> Reply<ProjectAdded> {
    library
        .catalog()
        .add_session_to_project(&session, project_id, expected_revision)
        .await
        .map_err(fail(Some(project_id)))
}
