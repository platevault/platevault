// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Observing-plan IPC (spec 072, PLAN-FR-01..11).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! beside the other library commands; the legacy `plan`, `plans` and
//! `plan_apply` commands, which name filesystem plans, stay unregistered there.
//! Every mutation names the revisions it expects and returns its record only
//! after its transaction commits. Failures follow the library [`ErrorResponse`]
//! conventions, naming the Target or site. No command reads or writes an image
//! file, opens a network connection or asks for an account.
//!
//! The handlers reach the native save dialog and the platform notification
//! settings through the dialog and opener plugins' Rust APIs, which need no
//! webview grant. The shell's window, labelled `library`, holds only
//! `capabilities/library.json`; the legacy `default.json` names other windows.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::planning_project::{ProjectGaps, ProjectPlanning, ProjectPlanningQuery};
use platevault_core::tonight::{Tonight, TonightQuery};
use platevault_core::{
    CalendarExportOutcome, CalendarExportReview, DefaultSiteSaved, EnableReminders, ErrorResponse,
    ExportSelection, LibraryError, PlanningSites, ReminderInput, ReminderReview, ReminderStatus,
    ReminderSubscription, Revision, SiteInput, SiteSaved, TargetPlan, WindowQuery, WindowSet,
};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use super::library::{fail, Reply};
use crate::library_notifier::notification_settings_url;

/// Every saved site with its revision, the default site or null, and the
/// settings revision.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn planning_list_sites(library: State<'_, Arc<Library>>) -> Reply<PlanningSites> {
    library.catalog().list_sites().await.map_err(fail(None))
}

/// Create a site at revision 1, or edit one at its expected revision. An edit
/// moves the site's subscriptions to `needs_reconfirmation` and names them.
///
/// # Errors
/// `InvalidInput` for invalid fields or a zone outside the bundled database;
/// `NotFound` for an unknown site; `Conflict` for a stale revision.
#[tauri::command]
pub async fn planning_save_site(
    library: State<'_, Arc<Library>>,
    site_id: Option<Uuid>,
    expected_revision: Option<Revision>,
    site: SiteInput,
) -> Reply<SiteSaved> {
    library.save_site(site_id, expected_revision, &site).await.map_err(fail(site_id))
}

/// Set or clear the default site; affected subscriptions need reconfirmation
/// and are named.
///
/// # Errors
/// `Conflict` for a stale settings revision; `NotFound` for an unknown site.
#[tauri::command]
pub async fn planning_set_default_site(
    library: State<'_, Arc<Library>>,
    site_id: Option<Uuid>,
    expected_revision: Revision,
) -> Reply<DefaultSiteSaved> {
    library.set_default_site(site_id, expected_revision).await.map_err(fail(site_id))
}

/// The window set with its basis and one entry per night. Read-only: writes
/// nothing and starts nothing.
///
/// # Errors
/// `InvalidInput` for an invalid query; `NotFound` for an unknown Target or
/// site.
#[tauri::command]
pub async fn planning_compute_windows(
    library: State<'_, Arc<Library>>,
    query: WindowQuery,
) -> Reply<WindowSet> {
    library.compute_windows(&query).await.map_err(fail(Some(query.target_id)))
}

/// Mark or unmark a saved Target as Planned. The Target record and its
/// decision revision stay unchanged, and no reminder is enabled.
///
/// # Errors
/// `NotFound` for an unknown Target; `Conflict` for a stale mark revision.
#[tauri::command]
pub async fn planning_set_planned(
    library: State<'_, Arc<Library>>,
    target_id: Uuid,
    planned: bool,
    expected_revision: Revision,
) -> Reply<TargetPlan> {
    library
        .catalog()
        .set_target_planned(target_id, planned, expected_revision)
        .await
        .map_err(fail(Some(target_id)))
}

/// Review reminder activation against the default site. Writes nothing.
///
/// # Errors
/// `InvalidInput` for invalid criteria or lead time, or naming `defaultSite`
/// when none is set; `NotFound` for an unknown Target.
#[tauri::command]
pub async fn planning_review_reminders(
    library: State<'_, Arc<Library>>,
    reminder: ReminderInput,
) -> Reply<ReminderReview> {
    library.review_reminders(&reminder).await.map_err(fail(Some(reminder.target_id)))
}

/// Activate reminders with the reviewed values: an undecided permission is
/// requested first, then the subscription commits `enabled` or `blocked`.
/// Starts no indexing.
///
/// # Errors
/// `InvalidInput` for invalid values or naming `defaultSite` when none is set;
/// `Conflict` when the site is not the default or a revision moved.
#[tauri::command]
pub async fn planning_enable_reminders(
    library: State<'_, Arc<Library>>,
    reminder: ReminderInput,
    site_id: Uuid,
    site_revision: Revision,
    settings_revision: Revision,
    expected_revision: Option<Revision>,
) -> Reply<ReminderSubscription> {
    let target = reminder.target_id;
    let request =
        EnableReminders { reminder, site_id, site_revision, settings_revision, expected_revision };
    library.enable_reminders(&request).await.map_err(fail(Some(target)))
}

/// Disable a Target's reminders; the scheduler stops when none stays enabled.
///
/// # Errors
/// `NotFound` for no subscription; `Conflict` for a stale revision.
#[tauri::command]
pub async fn planning_disable_reminders(
    library: State<'_, Arc<Library>>,
    target_id: Uuid,
    expected_revision: Revision,
) -> Reply<ReminderSubscription> {
    library.disable_reminders(target_id, expected_revision).await.map_err(fail(Some(target_id)))
}

/// Whether the scheduler runs, the permission, app-closed delivery, the
/// subscriptions, upcoming reminders and delivery records, newest first.
/// Read-only.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn planning_reminder_status(
    library: State<'_, Arc<Library>>,
    offset: u32,
    limit: u32,
) -> Reply<ReminderStatus> {
    library.reminder_status(offset, limit).await.map_err(fail(None))
}

/// `planning_open_notification_settings` result.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsOpened {
    pub opened: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

/// Open the platform notification settings. Changes no record.
///
/// # Errors
/// `SourceUnavailable` when the platform refuses to open its settings.
#[tauri::command]
pub async fn planning_open_notification_settings(app: AppHandle) -> Reply<SettingsOpened> {
    let Some(url) = notification_settings_url() else {
        return Ok(SettingsOpened { opened: false, reason: Some("no_settings_target") });
    };
    app.opener().open_url(url, None::<&str>).map_err(|error| {
        unavailable(format!("cannot open the notification settings: {error}"), None)
    })?;
    Ok(SettingsOpened { opened: true, reason: None })
}

/// Review a calendar export: the site, zone, night range, selected windows in
/// time order, snapshot digest and a suggested file name. Writes nothing.
///
/// # Errors
/// `InvalidInput` for an invalid selection; `Conflict` naming the Target when a
/// selected key is not in the recomputed set.
#[tauri::command]
pub async fn planning_review_calendar_export(
    library: State<'_, Arc<Library>>,
    selection: ExportSelection,
) -> Reply<CalendarExportReview> {
    let target = selection.query.target_id;
    library.review_calendar_export(&selection).await.map_err(fail(Some(target)))
}

/// Recompute the reviewed snapshot, refuse a different digest before any
/// dialog opens, then ask for the file in the native save dialog and write it.
/// A canceled dialog writes nothing.
///
/// # Errors
/// `Conflict` naming the Target for a stale digest; the write failures of
/// [`Library::write_calendar_export`], naming the path.
#[tauri::command]
pub async fn planning_export_calendar(
    app: AppHandle,
    library: State<'_, Arc<Library>>,
    selection: ExportSelection,
    snapshot_digest: String,
) -> Reply<CalendarExportOutcome> {
    let target = Some(selection.query.target_id);
    let prepared = library
        .prepare_calendar_export(&selection, &snapshot_digest)
        .await
        .map_err(fail(target))?;
    let dialog = app
        .dialog()
        .file()
        .set_title("Export observing windows")
        .set_file_name(prepared.suggested_file_name())
        .add_filter("Calendar", &["ics"]);
    // The panel blocks its caller until it closes, so it never runs on an
    // async worker.
    let chosen =
        tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file()).await.map_err(
            |error| unavailable(format!("the save dialog was interrupted: {error}"), target),
        )?;
    let Some(chosen) = chosen else {
        return Ok(CalendarExportOutcome::canceled());
    };
    let path = chosen.into_path().map_err(|error| {
        fail(target)(LibraryError::InvalidInput(format!(
            "the save dialog returned no file path: {error}"
        )))
    })?;
    library.write_calendar_export(prepared, path).await.map_err(fail(target))
}

// ---------------------------------------------------------------------------
// Tonight and Project planning (PLAN-FR-02/09/10/11)
// ---------------------------------------------------------------------------

/// Home's Tonight at the default site: the best window tonight of each Target
/// in My targets that has one, the Moon and the darkness window, each naming
/// the site and time zone. Without a default site it lists no windows and
/// names the reason. Read-only.
///
/// # Errors
/// `InvalidInput` for invalid criteria or a night outside the supported
/// calendar.
#[tauri::command]
pub async fn planning_tonight(
    library: State<'_, Arc<Library>>,
    query: TonightQuery,
) -> Reply<Tonight> {
    library.tonight(&query).await.map_err(fail(None))
}

/// A Project page's planning: the windows of its own subjects at the planning
/// site, each subject's and mosaic panel's goal gaps, and the "Open in
/// Planner" context. Read-only.
///
/// # Errors
/// `InvalidInput` for an invalid query; `NotFound` for an unknown Project or
/// site; `Conflict` when the Project changed between its reads.
#[tauri::command]
pub async fn planning_project_windows(
    library: State<'_, Arc<Library>>,
    query: ProjectPlanningQuery,
) -> Reply<ProjectPlanning> {
    library.project_planning(&query).await.map_err(fail(Some(query.project_id)))
}

/// The goal gaps a Target's Plan area shows for each open Project that has the
/// Target as a subject. Read-only.
///
/// # Errors
/// `NotFound` for an unknown Target; `Conflict` when a Project changed between
/// its reads.
#[tauri::command]
pub async fn planning_target_gaps(
    library: State<'_, Arc<Library>>,
    target_id: Uuid,
) -> Reply<Vec<ProjectGaps>> {
    library.target_project_gaps(target_id).await.map_err(fail(Some(target_id)))
}

fn unavailable(message: String, identity: Option<Uuid>) -> ErrorResponse {
    fail(identity)(LibraryError::SourceUnavailable(message))
}
