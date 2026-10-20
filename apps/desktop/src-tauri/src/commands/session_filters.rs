// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Sessions filter IPC (spec 064 LIB-FR-17, spec 065 PRJ-FR-08, PRJ-FR-19,
//! D-W59): the "Needs a Target", "Not in any Project" and "Needs calibration"
//! counts, and a session row's Create Project and Add to Project. The filters
//! themselves are `library_list_sessions`'s `filter`; "Not in any Project"
//! reads the sessions Projects hold (`project_sessions`). Registered only by
//! the isolated rebuilt shell ([`crate::library_shell`]). Both row actions
//! hold the session through the core's membership add: it is placed in a
//! group and admitted, so only a session whose calibration is settled joins,
//! and a refusal saves nothing. Failures follow the library [`ErrorResponse`]
//! conventions.
//!
//! [`ErrorResponse`]: platevault_core::ErrorResponse

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{
    ExpectedSession, Project, ProjectAdded, ProjectAddition, ProjectInput, Revision,
    SessionFilterCounts,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// The "Needs a Target", "Not in any Project" and "Needs calibration" list
/// lengths, which Home's top line reports. Read-only.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn library_session_filter_counts(
    library: State<'_, Arc<Library>>,
) -> Reply<SessionFilterCounts> {
    library.catalog().session_filter_counts().await.map_err(fail(None))
}

/// Create Project's prefill from a session: its confirmed Target as the one
/// subject and its confirmed rig. Nothing is saved;
/// `project_create_from_session` saves.
///
/// # Errors
/// `NotFound` for an unknown session; `Conflict` for a superseded one;
/// `InvalidInput` when it has no confirmed Target.
#[tauri::command]
#[specta::specta]
pub async fn project_prefill_from_session(
    library: State<'_, Arc<Library>>,
    session_id: Uuid,
) -> Reply<ProjectInput> {
    library.catalog().project_prefill(session_id).await.map_err(fail(Some(session_id)))
}

/// Create Project from a session row: the Project `input` describes, holding
/// the session in a group of its rig, at revision 1. Only a session whose
/// calibration is settled is held; otherwise no Project is saved.
///
/// # Errors
/// `InvalidInput` naming every admission blocker, such as the calibration
/// kinds to choose first, for invalid fields, or for a session with no
/// confirmed Target or rig; `Conflict` for a session changed since it was
/// read; `NotFound` for an unknown session, Target or rig.
#[tauri::command]
#[specta::specta]
pub async fn project_create_from_session(
    library: State<'_, Arc<Library>>,
    session: ExpectedSession,
    input: ProjectInput,
) -> Reply<Project> {
    library
        .create_project_from_session(&input, &session)
        .await
        .map_err(fail(Some(session.session_id)))
}

/// What Add to Project would add for the session, with the note naming a rig
/// it adds. Nothing is saved.
///
/// # Errors
/// `NotFound` for an unknown session or Project; `Conflict` for a superseded
/// session; `InvalidInput` when it has no confirmed Target.
#[tauri::command]
#[specta::specta]
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

/// Add to Project as previewed: the session joins a group of its rig, with
/// its Target as a subject and its rig when the Project lacks them, in one
/// Project revision. Only a session whose calibration is settled joins.
///
/// # Errors
/// `Conflict` for a stale Project revision or a changed session; `NotFound`
/// for an unknown session or Project; `InvalidInput` naming every admission
/// blocker, such as the calibration kinds to choose first, or for a session
/// with no confirmed Target or rig or one the Project already holds.
#[tauri::command]
#[specta::specta]
pub async fn project_add_session(
    library: State<'_, Arc<Library>>,
    session: ExpectedSession,
    project_id: Uuid,
    expected_revision: Revision,
) -> Reply<ProjectAdded> {
    library
        .add_session_to_project(&session, project_id, expected_revision)
        .await
        .map_err(fail(Some(project_id)))
}
