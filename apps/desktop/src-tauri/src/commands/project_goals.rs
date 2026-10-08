// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project IPC (spec 065, amended D-W1..D-W74).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]) under
//! its `projects` block; the legacy [`crate::commands::projects`] commands stay
//! unregistered there. Every Project write names the expected Project revision
//! and returns the committed Project only after its transaction commits; a
//! Project-only reject names its own asset's decision revision instead, so rapid
//! marks never chain. Failures follow the library [`ErrorResponse`] conventions.
//! No command reads or writes an image file, a library quality decision or a
//! session record.
//!
//! [`ErrorResponse`]: platevault_core::ErrorResponse

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{
    GoalInput, GoalSpec, GoalTemplate, GoalTemplateInput, Project, ProjectCandidate, ProjectDetail,
    ProjectInput, ProjectQuery, ProjectRejection, ProjectSummary, RejectionMark, Revision,
    SubjectInput,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Create an open Project at revision 1 with its subjects (the Target it was
/// opened from first), rigs and goals. Writes only Project rows.
///
/// # Errors
/// `InvalidInput` for invalid fields or goal scope; `NotFound` for an unsaved
/// Target, unknown equipment or a goal naming a Target or panel not listed.
#[tauri::command]
pub async fn project_create(
    library: State<'_, Arc<Library>>,
    name: String,
    notes: Option<String>,
    subjects: Vec<SubjectInput>,
    rig_ids: Vec<Uuid>,
    goals: Vec<GoalInput>,
) -> Reply<Project> {
    let input = ProjectInput { name, notes, subjects, rig_ids, goals };
    library.catalog().create_project(&input).await.map_err(fail(None))
}

/// Replace the Project's name and notes.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project;
/// `InvalidInput` for a blank name.
#[tauri::command]
pub async fn project_update(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    name: String,
    notes: Option<String>,
) -> Reply<Project> {
    library
        .catalog()
        .update_project(project_id, expected_revision, &name, notes.as_deref())
        .await
        .map_err(fail(Some(project_id)))
}

/// Replace the subject list; a listed Target keeps its subject and a listed
/// panel number keeps its panel. Changes candidates only.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project or an
/// unsaved Target; `InvalidInput` for an invalid subject or panel.
#[tauri::command]
pub async fn project_set_subjects(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    subjects: Vec<SubjectInput>,
) -> Reply<Project> {
    library
        .catalog()
        .set_project_subjects(project_id, expected_revision, &subjects)
        .await
        .map_err(fail(Some(project_id)))
}

/// Replace the rig list. Changes candidates only.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project or
/// equipment; `InvalidInput` for an empty or repeated list.
#[tauri::command]
pub async fn project_set_rigs(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    rig_ids: Vec<Uuid>,
) -> Reply<Project> {
    library
        .catalog()
        .set_project_rigs(project_id, expected_revision, &rig_ids)
        .await
        .map_err(fail(Some(project_id)))
}

/// Replace the goal list.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project, subject
/// Target or panel; `InvalidInput` for an invalid or repeated goal or scope.
#[tauri::command]
pub async fn project_set_goals(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    goals: Vec<GoalInput>,
) -> Reply<Project> {
    library
        .catalog()
        .set_project_goals(project_id, expected_revision, &goals)
        .await
        .map_err(fail(Some(project_id)))
}

/// Copy a template's values into one subject's goals: one panel of a mosaic, or
/// every panel when `panel` is absent. The template list never depends on a rig.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project, template,
/// subject Target or panel; `InvalidInput` for a panel on a single-Target subject.
#[tauri::command]
pub async fn project_apply_goal_template(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    template_id: Uuid,
    target_id: Uuid,
    panel: Option<u32>,
) -> Reply<Project> {
    library
        .catalog()
        .apply_goal_template(project_id, expected_revision, template_id, target_id, panel)
        .await
        .map_err(fail(Some(project_id)))
}

/// "Reject for this Project only", or its withdrawal, per asset, all or nothing.
/// Library quality, candidates, other Projects and the Project revision stay.
///
/// # Errors
/// `Conflict` naming an asset whose decision revision or bytes changed;
/// `NotFound` for an unknown Project or asset; `InvalidInput` for empty or
/// repeated marks, a Trashed frame or a retired copy.
#[tauri::command]
pub async fn project_set_rejection(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    marks: Vec<RejectionMark>,
) -> Reply<Vec<ProjectRejection>> {
    library
        .catalog()
        .set_project_rejection(project_id, &marks)
        .await
        .map_err(fail(Some(project_id)))
}

/// Project summaries by name, optionally only those with `target_id` as a
/// subject. Done Projects are listed only when `showDone` ("Show done") is on.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn project_list(
    library: State<'_, Arc<Library>>,
    target_id: Option<Uuid>,
    show_done: Option<bool>,
    offset: u32,
    limit: u32,
) -> Reply<Vec<ProjectSummary>> {
    let query = ProjectQuery { target_id, show_done: show_done.unwrap_or(false), offset, limit };
    library.catalog().list_projects(&query).await.map_err(fail(target_id))
}

/// Mark the Project Done. Refused while any run outside the Project's Trash
/// is not Complete, naming each with its stage. Moves no file.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project;
/// `InvalidInput` naming each run that is not Complete, or for a Project
/// already Done.
#[tauri::command]
pub async fn project_mark_done(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
) -> Reply<Project> {
    library
        .catalog()
        .mark_project_done(project_id, expected_revision)
        .await
        .map_err(fail(Some(project_id)))
}

/// Reopen a Done Project with its runs, goals and members unchanged. Moves no
/// file.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project;
/// `InvalidInput` for a Project that is open.
#[tauri::command]
pub async fn project_reopen(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
) -> Reply<Project> {
    library
        .catalog()
        .reopen_project(project_id, expected_revision)
        .await
        .map_err(fail(Some(project_id)))
}

/// The Project with its candidates and latest Project-only decisions, from one
/// catalog snapshot. Read-only.
///
/// # Errors
/// `NotFound` for an unknown Project.
#[tauri::command]
pub async fn project_detail(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<ProjectDetail> {
    library.catalog().project_detail(project_id).await.map_err(fail(Some(project_id)))
}

/// The Project's derived candidates, each naming its subject and rig.
///
/// # Errors
/// `NotFound` for an unknown Project.
#[tauri::command]
pub async fn project_candidates(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<Vec<ProjectCandidate>> {
    library.catalog().project_candidates(project_id).await.map_err(fail(Some(project_id)))
}

/// The built-in templates, then the user templates by name.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn goal_template_list(library: State<'_, Arc<Library>>) -> Reply<Vec<GoalTemplate>> {
    library.catalog().goal_templates().await.map_err(fail(None))
}

/// Create (`id` absent) or update a user template by CAS. No Project changes.
///
/// # Errors
/// `InvalidInput` for invalid fields or a built-in id; `NotFound` for an
/// unknown id; `Conflict` for a stale revision.
#[tauri::command]
pub async fn goal_template_save(
    library: State<'_, Arc<Library>>,
    id: Option<Uuid>,
    name: String,
    goals: Vec<GoalSpec>,
    expected_revision: Option<Revision>,
) -> Reply<GoalTemplate> {
    let input = GoalTemplateInput { id, name, goals };
    library.catalog().save_goal_template(&input, expected_revision).await.map_err(fail(id))
}

/// Delete a user template; Projects keep the values copied from it.
///
/// # Errors
/// `InvalidInput` for a built-in id; `NotFound` for an unknown id; `Conflict`
/// for a stale revision.
#[tauri::command]
pub async fn goal_template_delete(
    library: State<'_, Arc<Library>>,
    template_id: Uuid,
    expected_revision: Revision,
) -> Reply<()> {
    library
        .catalog()
        .delete_goal_template(template_id, expected_revision)
        .await
        .map_err(fail(Some(template_id)))
}
