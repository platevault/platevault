// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project inputs IPC: the Sessions step and its groups (spec 065 PRJ-FR-07,
//! PRJ-FR-08, PRJ-FR-27, PRJ-FR-29, PRJ-FR-31; 066 VSEL-FR-02, VSEL-FR-10,
//! VSEL-FR-15).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `project inputs` block. Every write names the expected Project
//! revision and returns the Project's desired state after its transaction
//! commits. No command touches a file or the View: each change reads as
//! pending until Apply. Adding sessions, making, splitting, renaming or
//! marking a group and the View step's settings run the core rules
//! (placement, distinct group folders, an absolute processing location);
//! removing or moving sessions, removing an empty group and frame choices are
//! the catalog's own edits. Group names arrive as text and the core builds the
//! validated [`platevault_core::GroupName`]; keyword names deserialize through
//! their validating constructor. Failures follow the library
//! [`platevault_core::ErrorResponse`] conventions, naming the Project.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::projects::{ProjectInputs, SessionToAdd};
use platevault_core::{FrameChoice, ProjectDesired, ProjectViewSettings, Revision};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// The Sessions step: what the Project holds, the keywords in effect, each
/// group's folder in the next View, the pending changes and the suggestions.
/// Read-only.
///
/// # Errors
/// `NotFound` for an unknown Project; `PersistenceFailure` for a corrupt record.
#[tauri::command]
#[specta::specta]
pub async fn project_inputs(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<ProjectInputs> {
    library.project_inputs(project_id).await.map_err(fail(Some(project_id)))
}

/// Add whole Ready sessions, each at the admission basis the user saw, into
/// `group_id` when given, else into the framing group of its rig and optics.
///
/// # Errors
/// `InvalidInput` naming every admission blocker, or for a session with no
/// confirmed rig; `Conflict` for a stale revision; `NotFound` for an unknown
/// Project, session or group.
#[tauri::command]
#[specta::specta]
pub async fn project_add_sessions(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    sessions: Vec<SessionToAdd>,
    group_id: Option<Uuid>,
) -> Reply<ProjectDesired> {
    library
        .add_project_sessions(project_id, expected_revision, &sessions, group_id)
        .await
        .map_err(fail(Some(project_id)))
}

/// Remove whole sessions with their captures; an emptied framing group goes
/// unless it carries goals. Subjects and rigs stay.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project or a
/// session it doesn't hold; `InvalidInput` for a Project that isn't open.
#[tauri::command]
#[specta::specta]
pub async fn project_remove_sessions(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    sessions: Vec<Uuid>,
) -> Reply<ProjectDesired> {
    library
        .catalog()
        .remove_project_sessions(project_id, expected_revision, &sessions)
        .await
        .map_err(fail(Some(project_id)))
}

/// Move held sessions into `group_id` of their own rig; the move survives
/// recomputation.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project, group
/// or held session; `InvalidInput` for a Project that isn't open or a group of
/// another rig.
#[tauri::command]
#[specta::specta]
pub async fn project_move_sessions(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    sessions: Vec<Uuid>,
    group_id: Uuid,
) -> Reply<ProjectDesired> {
    library
        .catalog()
        .move_project_sessions(project_id, expected_revision, &sessions, group_id)
        .await
        .map_err(fail(Some(project_id)))
}

/// Create a group named `name` on `rig_id` and move `sessions` into it.
///
/// # Errors
/// `InvalidInput` for a blank name or one sharing another group's folder;
/// otherwise as `project_move_sessions`.
#[tauri::command]
#[specta::specta]
pub async fn project_create_group(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    rig_id: Uuid,
    name: String,
    sessions: Vec<Uuid>,
) -> Reply<ProjectDesired> {
    library
        .create_project_group(project_id, expected_revision, rig_id, &name, &sessions)
        .await
        .map_err(fail(Some(project_id)))
}

/// Split `sessions` off group `group_id` into a new group of the same rig,
/// optics and framing, named `name` or by default "<Rig> · 2".
///
/// # Errors
/// `InvalidInput` for no session, a session of another group or a name
/// sharing another group's folder; `NotFound` for an unknown group.
#[tauri::command]
#[specta::specta]
pub async fn project_split_group(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    group_id: Uuid,
    sessions: Vec<Uuid>,
    name: Option<String>,
) -> Reply<ProjectDesired> {
    library
        .split_project_group(project_id, expected_revision, group_id, &sessions, name.as_deref())
        .await
        .map_err(fail(Some(project_id)))
}

/// Rename a group; its folder changes at the next Apply.
///
/// # Errors
/// `InvalidInput` for a blank name or one sharing another group's folder;
/// `Conflict` for a stale revision; `NotFound` for an unknown group.
#[tauri::command]
#[specta::specta]
pub async fn project_rename_group(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    group_id: Uuid,
    name: String,
) -> Reply<ProjectDesired> {
    library
        .rename_project_group(project_id, expected_revision, group_id, &name)
        .await
        .map_err(fail(Some(project_id)))
}

/// Mark a group a mosaic panel, or not. Marking names it `name`, or by
/// default "Panel N" from its sessions' capture name; unmarking keeps the
/// name unless one is given.
///
/// # Errors
/// `InvalidInput` for a blank name or one sharing another group's folder;
/// `NotFound` for an unknown group; `Conflict` for a stale revision.
#[tauri::command]
#[specta::specta]
pub async fn project_set_group_panel(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    group_id: Uuid,
    panel: bool,
    name: Option<String>,
) -> Reply<ProjectDesired> {
    library
        .set_project_group_panel(project_id, expected_revision, group_id, panel, name.as_deref())
        .await
        .map_err(fail(Some(project_id)))
}

/// The user's choice for held frames: exclude them from this Project, include
/// them although the Library has them Unusable, or follow the Library again.
/// Files and library quality stay.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project or a
/// capture it doesn't hold; `InvalidInput` for a Project that isn't open or
/// no capture.
#[tauri::command]
#[specta::specta]
pub async fn project_set_frames(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    capture_keys: Vec<Uuid>,
    choice: FrameChoice,
) -> Reply<ProjectDesired> {
    library
        .catalog()
        .set_project_frames(project_id, expected_revision, &capture_keys, choice)
        .await
        .map_err(fail(Some(project_id)))
}

/// Remove an empty group.
///
/// # Errors
/// `InvalidInput` for a Project that isn't open, or a group that still holds
/// sessions or goals; `Conflict` for a stale revision; `NotFound` for an
/// unknown Project or group.
#[tauri::command]
#[specta::specta]
pub async fn project_remove_group(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    group_id: Uuid,
) -> Reply<ProjectDesired> {
    library
        .catalog()
        .remove_project_group(project_id, expected_revision, group_id)
        .await
        .map_err(fail(Some(project_id)))
}

/// The View step's settings: the input mode, this Project's keyword names
/// (`null` uses the Settings defaults), the application the View is handed
/// to and the processing location. A mode switch reaches the View only
/// through Apply.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project or
/// application profile; `InvalidInput` for a Project that isn't open or a
/// relative processing location, which is not stored.
#[tauri::command]
#[specta::specta]
pub async fn project_set_view_settings(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    settings: ProjectViewSettings,
) -> Reply<ProjectDesired> {
    library
        .set_project_view_settings(project_id, expected_revision, &settings)
        .await
        .map_err(fail(Some(project_id)))
}
