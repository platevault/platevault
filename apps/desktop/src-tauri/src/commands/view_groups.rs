// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Mosaic run group IPC (spec 066 VSEL-FR-05/07/08/18/19, D-W38, D-W41,
//! D-W73).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! under its `runs` block. A run on a mosaic subject is a run group: one panel
//! run per panel the user confirmed, and no whole-mosaic run. Each panel run
//! is an ordinary run for every `view_*` command. Writes carry the group's
//! `expectedRevision` and return only after their transaction commits.
//! Failures follow the library [`platevault_core::ErrorResponse`] conventions,
//! naming the group. No command reads or writes an image file.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::view_groups::ViewGroupDetail;
use platevault_core::{
    CalibrationPolicy, GroupActionOutcome, GroupSetup, InputMode, NewViewGroup, PanelDecision,
    PanelFilter, Revision, SubjectPanel,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Start a run group on a mosaic subject with the panels the creation step
/// listed, assigning every candidate on the rig by pointing.
///
/// # Errors
/// `InvalidInput` for a blank name, a single-Target subject or a rig not on
/// the Project; `Conflict` when `panels` is not the subject's current list;
/// `NotFound` for an unknown Project or subject.
#[tauri::command]
pub async fn view_group_create(
    library: State<'_, Arc<Library>>,
    project_id: Uuid,
    subject_id: Uuid,
    rig_id: Uuid,
    name: String,
    panels: Vec<SubjectPanel>,
) -> Reply<ViewGroupDetail> {
    let input = NewViewGroup { project_id, subject_id, rig_id, name, panels };
    library.create_view_group(&input).await.map_err(fail(Some(project_id)))
}

/// The group's setup, each panel run's status, outline and summary, the group
/// summary and its sessions, optionally kept by the Panel filter. Read-only.
///
/// # Errors
/// `NotFound` for an unknown run group.
#[tauri::command]
pub async fn view_group_detail(
    library: State<'_, Arc<Library>>,
    group_id: Uuid,
    panel_filter: Option<PanelFilter>,
) -> Reply<ViewGroupDetail> {
    library.view_group_detail(group_id, panel_filter).await.map_err(fail(Some(group_id)))
}

/// Assign each decided session to a panel or leave it out.
///
/// # Errors
/// `Conflict` for a stale revision or a changed session; `InvalidInput` for a
/// session that is not a candidate, a panel outside the group, or a touched
/// panel run that is Complete or in the Project's Trash.
#[tauri::command]
pub async fn view_group_assign_panel(
    library: State<'_, Arc<Library>>,
    group_id: Uuid,
    expected_revision: Revision,
    decisions: Vec<PanelDecision>,
) -> Reply<ViewGroupDetail> {
    library
        .assign_view_group_panels(group_id, expected_revision, &decisions)
        .await
        .map_err(fail(Some(group_id)))
}

/// Set the shared profile, input mode and calibration policy, reporting each
/// panel run's outcome.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown run group.
#[tauri::command]
pub async fn view_group_set_setup(
    library: State<'_, Arc<Library>>,
    group_id: Uuid,
    expected_revision: Revision,
    profile_id: Option<Uuid>,
    input_mode: Option<InputMode>,
    calibration_policy: CalibrationPolicy,
) -> Reply<GroupActionOutcome> {
    let setup = GroupSetup { profile_id, input_mode, calibration_policy };
    library
        .set_view_group_setup(group_id, expected_revision, &setup)
        .await
        .map_err(fail(Some(group_id)))
}
