// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Project IPC (spec 065 `contracts/projects.md`, version 1).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]) beside
//! the clean library commands; the legacy `projects_*` commands stay unregistered
//! there. Every mutation names the expected Project revision and returns the
//! committed Project only after its transaction commits. Failures follow the
//! library [`ErrorResponse`] conventions, naming the Project. No command reads or
//! writes an image file.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{
    ChecklistItemInput, ExpectedAsset, PanelInput, Project, ProjectDetail, ProjectInput,
    ProjectQuery, ProjectSummary, Revision, SessionLinkInput, TargetFraming,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Create a Project at revision 1 with the prefilled Target first in `targets`.
/// Writes only Project rows.
///
/// # Errors
/// `InvalidInput` for invalid fields; `NotFound` for an unsaved Target or unknown
/// equipment; `Conflict` naming a Target whose revision is not the expected one.
#[tauri::command]
pub async fn project_create(
    library: State<'_, Arc<Library>>,
    name: String,
    notes: Option<String>,
    targets: Vec<TargetFraming>,
    panels: Vec<PanelInput>,
    equipment_ids: Vec<Uuid>,
) -> Reply<Project> {
    let input = ProjectInput { name, notes, targets, panels, equipment_ids };
    library.catalog().create_project(&input).await.map_err(fail(None))
}

/// Replace a Project's name, notes, framing, panels and equipment. Writes no
/// View, link or quality record.
///
/// # Errors
/// `Conflict` for a stale Project or Target revision; `NotFound` for an unknown
/// Project, Target, equipment or panel; `InvalidInput` for invalid fields or for
/// removing a panel that holds links.
#[tauri::command]
pub async fn project_update(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    name: String,
    notes: Option<String>,
    targets: Vec<TargetFraming>,
    panels: Vec<PanelInput>,
    equipment_ids: Vec<Uuid>,
) -> Reply<Project> {
    let input = ProjectInput { name, notes, targets, panels, equipment_ids };
    library
        .catalog()
        .update_project(project_id, expected_revision, &input)
        .await
        .map_err(fail(Some(project_id)))
}

/// Set the ordered checklist; items without `id` get one, omitted items are removed.
///
/// # Errors
/// `Conflict` for a stale Project revision; `NotFound` for an unknown Project,
/// item or equipment; `InvalidInput` for an invalid criterion or a repeated item.
#[tauri::command]
pub async fn project_set_checklist(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    items: Vec<ChecklistItemInput>,
) -> Reply<Project> {
    library
        .catalog()
        .set_checklist(project_id, expected_revision, &items)
        .await
        .map_err(fail(Some(project_id)))
}

/// Link sessions through the exact session records the user saw; linking a
/// linked session reassigns its panel. Nothing is linked by proximity, OBJECT or
/// name.
///
/// # Errors
/// `Conflict` for a stale Project revision or a stale or superseded session, with
/// its current revision and successors; `NotFound` for an unknown Project,
/// session or panel; `InvalidInput` for empty or repeated sessions.
#[tauri::command]
pub async fn project_link_sessions(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    links: Vec<SessionLinkInput>,
) -> Reply<Project> {
    library
        .catalog()
        .link_sessions(project_id, expected_revision, &links)
        .await
        .map_err(fail(Some(project_id)))
}

/// Remove links; every rejection decision stays.
///
/// # Errors
/// `Conflict` for a stale Project revision; `NotFound` for an unknown Project or
/// a session that is not linked; `InvalidInput` for empty or repeated ids.
#[tauri::command]
pub async fn project_unlink_sessions(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    session_ids: Vec<Uuid>,
) -> Reply<Project> {
    library
        .catalog()
        .unlink_sessions(project_id, expected_revision, &session_ids)
        .await
        .map_err(fail(Some(project_id)))
}

/// Record one Project rejection decision per asset, or withdraw it with
/// `rejected` false. Library quality, library totals and View membership stay
/// unchanged; nothing is rehashed.
///
/// # Errors
/// `Conflict` for a stale Project revision or a changed asset; `NotFound` for an
/// unknown Project or asset; `InvalidInput` for a Retired copy or empty or
/// repeated assets.
#[tauri::command]
pub async fn project_set_rejection(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    expected_revision: Revision,
    expected: Vec<ExpectedAsset>,
    rejected: bool,
) -> Reply<Project> {
    library
        .catalog()
        .set_project_rejection(project_id, expected_revision, &expected, rejected)
        .await
        .map_err(fail(Some(project_id)))
}

/// Project summaries by name, optionally only those framing `target_id`. No
/// progress is computed.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn project_list(
    library: State<'_, Arc<Library>>,
    target_id: Option<Uuid>,
    offset: u32,
    limit: u32,
) -> Reply<Vec<ProjectSummary>> {
    let query = ProjectQuery { target_id, offset, limit };
    library.catalog().list_projects(&query).await.map_err(fail(target_id))
}

/// The Project with framing, linked-session evidence, per-channel progress,
/// checklist progress and effective rejections. Read-only; starts no rehash.
///
/// # Errors
/// `NotFound` for an unknown Project; `PersistenceFailure` when the catalog
/// cannot be read.
#[tauri::command]
pub async fn project_detail(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
) -> Reply<ProjectDetail> {
    library.project_detail(project_id).await.map_err(fail(Some(project_id)))
}
