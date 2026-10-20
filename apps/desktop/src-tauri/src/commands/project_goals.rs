// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project IPC (spec 065, amended D-W1..D-W74).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]) under
//! its `projects` block; the legacy [`crate::commands::projects`] commands stay
//! unregistered there. Every Project write names the expected Project revision
//! and returns the committed Project only after its transaction commits.
//! Failures follow the library [`ErrorResponse`] conventions. No command reads
//! or writes an image file, a library quality decision or a session record.
//!
//! [`ErrorResponse`]: platevault_core::ErrorResponse

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{
    GoalInput, GoalSpec, GoalTemplate, GoalTemplateInput, Project, ProjectCandidate, ProjectInput,
    ProjectQuery, ProjectSummary, Revision, SubjectInput,
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
#[specta::specta]
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
#[specta::specta]
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

/// Replace the subject list; a listed Target keeps its subject and an omitted
/// subject is removed with its goals kept hidden, which return when its Target
/// is added back (D-W128). Suggestions follow; no held session changes.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project or an
/// unsaved Target; `InvalidInput` for an invalid subject list or for removing a
/// subject a held session joined on.
#[tauri::command]
#[specta::specta]
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

/// Replace the rig list. Suggestions follow; no held session changes.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project or
/// equipment; `InvalidInput` for an empty or repeated list, or for removing a
/// rig a group of the Project is on.
#[tauri::command]
#[specta::specta]
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

/// Replace the goal list; a goal names its subject Target and, for a mosaic
/// panel, its panel group.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project, a Target
/// that is no subject or an unknown group; `InvalidInput` for an invalid or
/// repeated goal or a group that is not a mosaic panel.
#[tauri::command]
#[specta::specta]
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

/// Copy a template's values into one subject's goals: of the mosaic panel group
/// `group_id`, or the subject's own goals when it is absent. The template list
/// never depends on a rig.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown Project, template
/// or group, or a Target that is no subject; `InvalidInput` for a group that is
/// not a mosaic panel.
#[tauri::command]
#[specta::specta]
pub async fn project_apply_goal_template(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    template_id: Uuid,
    target_id: Uuid,
    group_id: Option<Uuid>,
) -> Reply<Project> {
    library
        .catalog()
        .apply_goal_template(project_id, expected_revision, template_id, target_id, group_id)
        .await
        .map_err(fail(Some(project_id)))
}

/// Project summaries by name, optionally only those with `target_id` as a
/// subject. Projects Wrap up closed (Closing, Closed, Archived) are listed only
/// when `includeClosed` is on (PRJ-FR-32).
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
#[specta::specta]
pub async fn project_list(
    library: State<'_, Arc<Library>>,
    target_id: Option<Uuid>,
    include_closed: Option<bool>,
    offset: u32,
    limit: u32,
) -> Reply<Vec<ProjectSummary>> {
    let query =
        ProjectQuery { target_id, include_closed: include_closed.unwrap_or(false), offset, limit };
    library.catalog().list_projects(&query).await.map_err(fail(target_id))
}

/// The Project's candidates, derived now: every current session whose
/// confirmed Target is a subject's and whose confirmed rig is a Project rig,
/// whether the Project holds it or not. Read-only.
///
/// # Errors
/// `NotFound` for an unknown Project.
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
pub async fn goal_template_list(library: State<'_, Arc<Library>>) -> Reply<Vec<GoalTemplate>> {
    library.catalog().goal_templates().await.map_err(fail(None))
}

/// Create (`id` absent) or update a user template by CAS. No Project changes.
///
/// # Errors
/// `InvalidInput` for invalid fields or a built-in id; `NotFound` for an
/// unknown id; `Conflict` for a stale revision.
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
