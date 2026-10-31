// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! IPC smoke tests for the F4 library-shell commands, one per command family.
//!
//! Each test runs the registered handlers through Tauri's mock runtime with
//! JSON arguments, as the webview sends them, on a temporary catalog. A reply
//! is either the command's value or a library `ErrorResponse`: a stable code
//! naming the identity the request was about, with no English text. An
//! argument the handler can't deserialize never reaches it: Tauri refuses it
//! with a plain string, which these tests tell apart, so each call proves the
//! command's argument names and shapes.

mod support;

use std::path::Path;
use std::sync::Arc;

use desktop_shell::commands::library_dialogs::DataDirectory;
use desktop_shell::commands::project_wrap_up::WrapUpTrash;
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::Library;
use platevault_core::targets::TargetQuery;
use platevault_core::{
    AssociationState, ColorKind, Equipment, LibraryErrorCode, LocationRole, MeasurementMethod,
    NativePath, ProjectInput, ProjectLifecycle, Provenance, SubjectInput, TrashSupport,
    TrashUnsupported, WrapUpOutcome, WrapUpStep,
};
use serde_json::{json, Value};
use support::{Ipc, NOT_FOUND};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

/// A Trash that takes nothing, so no test can reach the user's.
struct NoTrash;

impl OsTrash for NoTrash {
    fn support(&self, _entry: &Path, _size_bytes: u64) -> TrashSupport {
        TrashSupport::Unsupported {
            reason: TrashUnsupported::DeletesImmediately,
            detail: "test Trash".into(),
        }
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        Err(format!("test Trash refuses {}", entry.display()))
    }
}

/// The mock shell over a fresh catalog. The window and app drop before the
/// catalog's directory, but a mock app never drops the Library it manages.
struct Shell {
    webview: WebviewWindow<MockRuntime>,
    _app: tauri::App<MockRuntime>,
    dir: tempfile::TempDir,
}

impl Shell {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        // Opened on Tauri's runtime, where the handlers run, so the catalog's
        // connections belong to it.
        let library =
            tauri::async_runtime::block_on(Library::open(&dir.path().join("catalog.sqlite"), None))
                .expect("open library");
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                desktop_shell::commands::project_goals::project_get,
                desktop_shell::commands::project_goals::project_rows,
                desktop_shell::commands::project_inputs::project_inputs,
                desktop_shell::commands::project_inputs::project_add_sessions,
                desktop_shell::commands::project_inputs::project_remove_sessions,
                desktop_shell::commands::project_inputs::project_move_sessions,
                desktop_shell::commands::project_inputs::project_create_group,
                desktop_shell::commands::project_inputs::project_split_group,
                desktop_shell::commands::project_inputs::project_rename_group,
                desktop_shell::commands::project_inputs::project_set_group_panel,
                desktop_shell::commands::project_inputs::project_set_frames,
                desktop_shell::commands::project_apply::project_apply_preview,
                desktop_shell::commands::project_apply::project_apply,
                desktop_shell::commands::project_apply::project_apply_status,
                desktop_shell::commands::project_apply::project_apply_cancel,
                desktop_shell::commands::project_apply::library_check_symlinks,
                desktop_shell::commands::library_dialogs::library_data_location,
                desktop_shell::commands::project_output::project_copy_to_output,
                desktop_shell::commands::project_output::project_output_list,
                desktop_shell::commands::project_wrap_up::project_wrap_up_status,
                desktop_shell::commands::project_wrap_up::project_close_status,
                desktop_shell::commands::project_wrap_up::project_close,
                desktop_shell::commands::project_wrap_up::project_duplicate,
                desktop_shell::commands::frame_review::pix_session_intake,
                desktop_shell::commands::frame_review::pix_session_review_list,
                desktop_shell::commands::frame_review::pix_session_review_mark,
                desktop_shell::commands::frame_review::pix_finish_review,
                desktop_shell::commands::frame_review::pix_reopen_review,
                desktop_shell::commands::session_calibration::calibration_needs,
                desktop_shell::commands::session_calibration::calibration_reassign,
                desktop_shell::commands::session_calibration::calibration_confirm,
                desktop_shell::commands::session_calibration::calibration_decline,
                desktop_shell::commands::project_inputs::project_remove_group,
                desktop_shell::commands::project_inputs::project_set_view_settings,
                desktop_shell::commands::project_wrap_up::project_reopen_wrap_up_step,
                desktop_shell::commands::project_wrap_up::project_closed_snapshot,
                desktop_shell::commands::sessions_archive::sessions_archive_review,
                desktop_shell::commands::sessions_archive::sessions_archive,
                desktop_shell::commands::view_previous::project_previous_items,
                desktop_shell::commands::view_previous::project_review_previous_item,
                desktop_shell::commands::project_wrap_up::project_clean_up_review,
                desktop_shell::commands::project_wrap_up::project_clean_up,
                desktop_shell::commands::project_wrap_up::project_trash_review,
                desktop_shell::commands::project_wrap_up::project_wrap_up_trash,
                desktop_shell::commands::project_wrap_up::project_wrap_up_archive_review,
                desktop_shell::commands::workflow_settings::workflow_settings_get,
                desktop_shell::commands::workflow_settings::workflow_settings_save,
                desktop_shell::commands::rigs::library_save_camera,
                desktop_shell::commands::targets_list::targets_get,
                desktop_shell::commands::targets_list::targets_presets_list,
                desktop_shell::commands::library::library_list_locations,
            ])
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        app.manage(library);
        app.manage(shared_data_directory(dir.path()));
        app.manage(WrapUpTrash::new(Arc::new(NoTrash)));
        support::manage_runs(&app);
        let webview = WebviewWindowBuilder::new(&app, "library", WebviewUrl::default())
            .build()
            .expect("library window");
        Self { webview, _app: app, dir }
    }

    /// The library the handlers run on, to arrange what a test calls on.
    fn library(&self) -> Arc<Library> {
        Arc::clone(self.webview.state::<Arc<Library>>().inner())
    }

    /// An open Project on a saved seed Target and rig, holding no session.
    fn open_project_details(&self) -> (Uuid, Uuid, Uuid) {
        let library = self.library();
        tauri::async_runtime::block_on(async move {
            let rig = Equipment {
                id: Uuid::new_v4(),
                name: "RedCat 51 + ASI2600MM".into(),
                camera: Some("ASI2600MM".into()),
                telescope: Some("RedCat 51".into()),
                focal_length_mm: Some(250.0),
                pixel_size_um: Some(3.76),
                sensor_width_px: Some(6248),
                sensor_height_px: Some(4176),
                color_kind: Some(ColorKind::Mono),
                decision_revision: 0,
                state: AssociationState::Confirmed,
                provenance: Provenance::User,
            };
            let rig_id = library.catalog().save_equipment(&rig, None).await.expect("rig").id;
            let query = TargetQuery { text: Some("NGC 7000".into()), cone: None, limit: 1 };
            let target =
                library.search_targets(&query).await.expect("seed search").remove(0).candidate;
            library.catalog().record_seed_target(&target).await.expect("save the Target");
            let input = ProjectInput {
                name: "NGC 7000 HOO".into(),
                notes: None,
                subjects: vec![SubjectInput { target_id: target.id, name: None }],
                rig_ids: vec![rig_id],
                goals: Vec::new(),
            };
            let project =
                library.catalog().create_project(&input).await.expect("create the Project");
            (project.id, target.id, rig_id)
        })
    }

    fn open_project(&self) -> Uuid {
        self.open_project_details().0
    }

    /// `root` registered as an active Captures location, an archive destination.
    fn destination(&self, root: &Path) -> Uuid {
        let library = self.library();
        let root = NativePath::from_path(&std::fs::canonicalize(root).expect("canonical root"));
        tauri::async_runtime::block_on(async move {
            library
                .register_location(root, "Archive".into(), LocationRole::Captures)
                .await
                .expect("register the destination")
                .id
        })
    }
}

impl Ipc for Shell {
    fn webview(&self) -> &WebviewWindow<MockRuntime> {
        &self.webview
    }
}

fn shared_data_directory(path: &Path) -> DataDirectory {
    desktop_shell::library_shell::managed_data_directory(path)
}

fn unix_path(path: &str) -> Value {
    json!({ "encoding": "unix-bytes", "payload": path.as_bytes() })
}

/// `path` as this operating system's wire path, which a handler that takes a
/// real location requires: another OS's encoding is refused as invalid input.
fn native_path(path: &Path) -> Value {
    serde_json::to_value(NativePath::from_path(path)).expect("path")
}

/// Review Clean up and confirm it with nothing selected, as the review's
/// revisions say; returns the review and the report.
fn clean_up_nothing(shell: &Shell, project: Uuid) -> (Value, Value) {
    let review =
        shell.invoke("project_clean_up_review", &json!({ "projectId": project })).expect("review");
    let report = shell
        .invoke(
            "project_clean_up",
            &json!({ "request": {
                "projectId": project,
                "desiredRevision": review["desiredRevision"],
                "generation": review["generation"],
                "selected": [],
            } }),
        )
        .expect("clean up");
    (review, report)
}

#[test]
fn project_inputs_family_takes_its_arguments() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    let group = Uuid::new_v4();
    let session = Uuid::new_v4();
    // A misnamed argument never reaches the handler.
    let misnamed = shell.invoke("project_inputs", &json!({ "id": project })).expect_err("misnamed");
    assert!(misnamed.is_string(), "Tauri refuses the arguments itself: {misnamed}");

    shell.refuses("project_inputs", &json!({ "projectId": project }), NOT_FOUND, project);
    let project = shell.open_project();
    let inputs = shell.call("project_inputs", &json!({ "projectId": project }));
    assert_eq!(inputs["panels"], json!([]), "a new Project has no panel outlines");
    shell.refuses(
        "project_add_sessions",
        &json!({
            "projectId": project,
            "expectedRevision": 1,
            "sessions": [{
                "sessionId": session,
                "expected": { "groupingRevision": 1, "calibrationGeneration": 1 },
            }],
            "groupId": null,
        }),
        NOT_FOUND,
        project,
    );
    let edit = |extra: Value| {
        let mut args = json!({ "projectId": project, "expectedRevision": 1 });
        args.as_object_mut().expect("object").extend(extra.as_object().expect("object").clone());
        args
    };
    shell.refuses(
        "project_remove_sessions",
        &edit(json!({ "sessions": [session] })),
        NOT_FOUND,
        project,
    );
    shell.refuses(
        "project_move_sessions",
        &edit(json!({ "sessions": [session], "groupId": group })),
        NOT_FOUND,
        project,
    );
    shell.refuses(
        "project_create_group",
        &edit(json!({ "rigId": Uuid::new_v4(), "name": "Wide", "sessions": [session] })),
        NOT_FOUND,
        project,
    );
    shell.refuses(
        "project_split_group",
        &edit(json!({ "groupId": group, "sessions": [session], "name": null })),
        NOT_FOUND,
        project,
    );
    shell.refuses(
        "project_rename_group",
        &edit(json!({ "groupId": group, "name": "Core" })),
        NOT_FOUND,
        project,
    );
    shell.refuses(
        "project_set_group_panel",
        &edit(json!({ "groupId": group, "panel": true, "name": "Panel 1" })),
        NOT_FOUND,
        project,
    );
    shell.refuses(
        "project_set_frames",
        &edit(json!({ "captureKeys": [Uuid::new_v4()], "choice": "exclude" })),
        NOT_FOUND,
        project,
    );
}

#[test]
fn apply_family_takes_its_arguments() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    shell.refuses("project_apply_preview", &json!({ "projectId": project }), NOT_FOUND, project);
    shell.refuses(
        "project_apply",
        &json!({ "request": {
            "projectId": project,
            "desiredRevision": 1,
            "basisDigest": "0".repeat(64),
            "ticked": [unix_path("notes.txt")],
        } }),
        NOT_FOUND,
        project,
    );
    // The durable operations contract: an unknown Apply is NotFound, and
    // Cancel never acknowledges one it can't find.
    let operation = Uuid::new_v4();
    let by_id = json!({ "operationId": operation });
    shell.refuses("project_apply_status", &by_id, NOT_FOUND, operation);
    shell.refuses("project_apply_cancel", &by_id, NOT_FOUND, operation);
}

#[test]
fn project_get_returns_the_current_revision_after_a_write() {
    let shell = Shell::new();
    let (project, target, rig) = shell.open_project_details();
    let library = shell.library();
    tauri::async_runtime::block_on(library.catalog().update_project(
        project,
        1,
        "Updated",
        Some("Current notes"),
    ))
    .expect("update the Project");
    let actual = shell.call("project_get", &json!({ "projectId": project }));

    assert_eq!(actual["name"], json!("Updated"));
    assert_eq!(actual["notes"], json!("Current notes"));
    assert_eq!(actual["revision"], json!(2));
    assert_eq!(actual["subjects"][0]["targetId"], json!(target));
    assert_eq!(actual["rigIds"], json!([rig]));
}

#[test]
fn project_get_refuses_an_unknown_project_scoped_to_its_id() {
    let shell = Shell::new();
    let project = Uuid::new_v4();

    shell.refuses("project_get", &json!({ "projectId": project }), NOT_FOUND, project);
}

#[test]
fn project_get_reports_a_closed_project_lifecycle() {
    let shell = Shell::new();
    let project = shell.open_project();
    let library = shell.library();
    tauri::async_runtime::block_on(async {
        let revision = library
            .catalog()
            .wrap_up_status(project)
            .await
            .expect("Wrap up status")
            .desired_revision;
        for step in [WrapUpStep::CleanUp, WrapUpStep::Trash] {
            library
                .catalog()
                .record_wrap_up_step(project, revision, step, WrapUpOutcome::Skipped)
                .await
                .expect("record skipped Wrap up step");
        }
        library
            .catalog()
            .close_project(project, revision, &MeasurementMethod::new("platevault.stars", 1), &[])
            .await
            .expect("close Project without an archive");
    });

    let actual = shell.call("project_get", &json!({ "projectId": project }));

    assert_eq!(actual["lifecycle"], json!(ProjectLifecycle::Closed));
    assert!(actual["closedAt"].is_string(), "{actual}");
}

/// `project_rows` returns each Project's summary with the open Project's
/// pending changes and Next action beside it.
#[test]
fn project_rows_return_the_next_action_and_pending_changes() {
    let shell = Shell::new();
    let project = shell.open_project();
    let listed = shell.call(
        "project_rows",
        &json!({ "targetId": null, "includeClosed": null, "offset": 0, "limit": 20 }),
    );
    let [row] = listed.as_array().expect("Projects").as_slice() else {
        panic!("one Project: {listed:#}")
    };
    assert_eq!(row["id"], json!(project));
    assert_eq!(row["work"], json!({ "pendingChanges": 0, "next": { "kind": "add_sessions" } }));
}

/// The Output listing IPC reads catalog records even when Output is absent.
#[test]
fn project_output_list_returns_recorded_observations_without_scanning() {
    let shell = Shell::new();
    let project = shell.open_project();
    let listed = shell.call("project_output_list", &json!({ "projectId": project }));
    assert_eq!(listed, json!([]));

    let unknown = Uuid::new_v4();
    shell.refuses("project_output_list", &json!({ "projectId": unknown }), NOT_FOUND, unknown);
}

/// PREP-FR-15 (J18 S1, J41 S16a): setup and Settings check a chosen folder
/// for symlinks; a folder that can't hold a file is refused scoped to it.
#[test]
fn the_symlink_check_returns_the_folders_capability() {
    let shell = Shell::new();
    let folder = tempfile::tempdir().expect("temp dir");
    let checked =
        shell.call("library_check_symlinks", &json!({ "folder": native_path(folder.path()) }));
    assert_eq!(checked, json!("available"));
    assert!(std::fs::read_dir(folder.path()).expect("folder").next().is_none(), "no probe stays");
    let missing = folder.path().join("missing");
    let refused = shell
        .invoke("library_check_symlinks", &json!({ "folder": native_path(&missing) }))
        .expect_err("a missing folder");
    assert_eq!(refused["code"], "not_found", "{refused}");
    assert_eq!(refused["scope"], native_path(&missing), "{refused}");
    assert!(!refused.to_string().contains("os error"), "{refused}");
}

#[test]
fn intake_family_takes_its_arguments() {
    let shell = Shell::new();
    let session = Uuid::new_v4();
    let asked = json!({ "sessionId": session });
    shell.refuses("pix_session_intake", &asked, NOT_FOUND, session);
    shell.refuses(
        "pix_session_review_list",
        &json!({ "sessionId": session, "filter": "all", "sort": null, "names": { "kind": "file_name" } }),
        NOT_FOUND,
        session,
    );
    shell.refuses(
        "pix_finish_review",
        &json!({ "sessionId": session, "expectedGroupingRevision": 1 }),
        NOT_FOUND,
        session,
    );
    let asset = Uuid::new_v4();
    shell.refuses(
        "pix_session_review_mark",
        &json!({
            "sessionId": session,
            "mark": {
                "asset": {
                    "assetId": asset,
                    "decisionRevision": 1,
                    "fingerprint": {
                        "identity": {
                            "volume": {
                                "filesystem": "apfs",
                                "stableId": null,
                                "fileIdsStable": true,
                                "case": "insensitive",
                                "normalization": "insensitive",
                            },
                            "fileId": null,
                        },
                        "sizeBytes": 2048,
                        "modifiedNs": "0",
                    },
                },
                "quality": "usable",
            },
        }),
        NOT_FOUND,
        asset,
    );
    shell.refuses("pix_reopen_review", &asked, NOT_FOUND, session);
}

#[test]
fn calibration_family_lists_the_queue_and_takes_reassign_arguments() {
    let shell = Shell::new();
    assert_eq!(
        shell.invoke("calibration_needs", &json!({})),
        Ok(json!([])),
        "nothing needs calibration"
    );
    let session = Uuid::new_v4();
    shell.refuses(
        "calibration_reassign",
        &json!({
            "sessionId": session,
            "kind": "dark",
            "input": { "form": "master", "masterId": Uuid::new_v4(), "revision": 1 },
            "expectedGeneration": 1,
        }),
        NOT_FOUND,
        session,
    );
}

#[test]
fn output_family_takes_its_arguments() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    shell.refuses(
        "project_copy_to_output",
        &json!({
            "projectId": project,
            "source": unix_path("/tmp/master_dark.xisf"),
            "name": unix_path("master_dark.xisf"),
        }),
        NOT_FOUND,
        project,
    );
    shell.refuses("project_output_list", &json!({ "projectId": project }), NOT_FOUND, project);
}

#[test]
fn wrap_up_family_takes_its_arguments() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    shell.refuses("project_wrap_up_status", &json!({ "projectId": project }), NOT_FOUND, project);
    shell.refuses("project_close_status", &json!({ "projectId": project }), NOT_FOUND, project);
    shell.refuses(
        "project_close",
        &json!({ "request": { "projectId": project, "desiredRevision": 1, "archive": null } }),
        NOT_FOUND,
        project,
    );
    shell.refuses(
        "project_duplicate",
        &json!({ "request": {
            "projectId": project,
            "name": "M31 again",
            "sessions": [],
            "goals": true,
            "notes": false,
            "settings": true,
        } }),
        NOT_FOUND,
        project,
    );
}
/// Close status IPC accepts the Project argument and reports no archive before one is started.
#[test]
fn project_close_status_ipc_reads_an_open_project() {
    let shell = Shell::new();
    let project = shell.open_project();

    assert_eq!(shell.call("project_close_status", &json!({ "projectId": project })), Value::Null);
}

#[test]
fn calibration_pin_family_takes_confirm_and_no_arguments() {
    let shell = Shell::new();
    let session = Uuid::new_v4();
    shell.refuses(
        "calibration_confirm",
        &json!({ "sessionId": session, "kind": "flat", "expectedGeneration": 1 }),
        NOT_FOUND,
        session,
    );
    // No runs over many sessions in one transaction; the refusal names the
    // session it couldn't find as its identity.
    shell.refuses(
        "calibration_decline",
        &json!({ "sessions": [[session, 1]], "kind": "bias" }),
        NOT_FOUND,
        session,
    );
}

#[test]
fn project_group_removal_and_view_settings_take_their_arguments() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    shell.refuses(
        "project_remove_group",
        &json!({ "projectId": project, "expectedRevision": 1, "groupId": Uuid::new_v4() }),
        NOT_FOUND,
        project,
    );
    // An absolute processing location of this OS, so the request is valid and
    // only the unknown Project refuses it.
    let parent = native_path(&std::env::temp_dir().join("processing"));
    let settings = |group: &str, panel: &str| {
        json!({
            "projectId": project,
            "expectedRevision": 1,
            "settings": {
                "mode": "copies",
                "keywords": { "group": group, "panel": panel },
                "profileId": null,
                "parent": parent,
            },
        })
    };
    shell.refuses("project_set_view_settings", &settings("GROUP", "PANEL"), NOT_FOUND, project);
    // Keywords arrive through their validating constructor: two that read the
    // same never reach the handler.
    let same = shell
        .invoke("project_set_view_settings", &settings("PANEL", "panel"))
        .expect_err("same keywords");
    assert!(same.is_string(), "Tauri refuses the keywords itself: {same}");
}

#[test]
fn wrap_up_record_family_reopens_a_step_and_reads_the_closed_snapshot() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    shell.refuses(
        "project_reopen_wrap_up_step",
        &json!({ "projectId": project, "step": "trash" }),
        NOT_FOUND,
        project,
    );
    assert_eq!(
        shell.invoke("project_closed_snapshot", &json!({ "projectId": project })),
        Ok(Value::Null),
        "a Project that never closed has no snapshot"
    );
}

#[test]
fn sessions_archive_family_takes_its_arguments() {
    let shell = Shell::new();
    let destination = Uuid::new_v4();
    let session = Uuid::new_v4();
    shell.refuses(
        "sessions_archive_review",
        &json!({ "sessions": [session], "destination": destination }),
        NOT_FOUND,
        destination,
    );
    shell.refuses(
        "sessions_archive",
        &json!({ "selection": {
            "destination": destination,
            "sessions": [session],
            "digest": "0".repeat(64),
        } }),
        NOT_FOUND,
        destination,
    );
}

#[test]
fn view_previous_family_lists_leftovers_and_takes_a_resolution() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    assert_eq!(
        shell.invoke("project_previous_items", &json!({ "projectId": project })),
        Ok(json!([])),
        "nothing waits in View (previous)/"
    );
    let review = |resolution: &str| {
        json!({
            "projectId": project,
            "path": unix_path("View (previous)/notes.txt"),
            "resolution": resolution,
        })
    };
    shell.refuses("project_review_previous_item", &review("kept"), NOT_FOUND, project);
    // Pending is the state the catalog records a leftover in; no client sets it.
    let pending =
        shell.invoke("project_review_previous_item", &review("pending")).expect_err("pending");
    assert!(pending.is_string(), "Tauri refuses a pending review itself: {pending}");
}

#[test]
fn clean_up_family_reviews_and_records_the_step() {
    let shell = Shell::new();
    let unknown = Uuid::new_v4();
    shell.refuses("project_clean_up_review", &json!({ "projectId": unknown }), NOT_FOUND, unknown);
    shell.refuses(
        "project_clean_up",
        &json!({ "request": {
            "projectId": unknown,
            "desiredRevision": 1,
            "generation": null,
            "selected": [unix_path("View/Lights/frame.fits")],
        } }),
        NOT_FOUND,
        unknown,
    );

    let project = shell.open_project();
    let (review, report) = clean_up_nothing(&shell, project);
    assert_eq!(review["projectId"], json!(project), "{review}");
    assert_eq!(review["entries"], json!([]), "a Project with no View offers nothing: {review}");
    assert_eq!(report["record"]["step"], "clean_up", "{report}");
    assert_eq!(report["record"]["outcome"], "finished", "nothing was offered: {report}");
    assert_eq!((&report["results"], &report["viewRemoved"]), (&json!([]), &json!(false)));
}

#[test]
fn trash_family_reviews_and_records_the_step() {
    let shell = Shell::new();
    let unknown = Uuid::new_v4();
    shell.refuses("project_trash_review", &json!({ "projectId": unknown }), NOT_FOUND, unknown);
    let trash = |project: Uuid, digest: &Value| {
        json!({ "request": {
            "projectId": project,
            "digest": digest,
            "ticked": ["processing_files"],
        } })
    };
    let stale = json!("0".repeat(64));
    shell.refuses("project_wrap_up_trash", &trash(unknown, &stale), NOT_FOUND, unknown);

    let project = shell.open_project();
    clean_up_nothing(&shell, project);
    let review =
        shell.invoke("project_trash_review", &json!({ "projectId": project })).expect("review");
    let groups: Vec<&Value> =
        review["groups"].as_array().expect("rows").iter().map(|row| &row["group"]).collect();
    assert_eq!(groups, ["rejected_frames", "processing_files", "duplicate_copies"], "{review}");
    // The digest is the proof the user saw this sheet.
    shell.refuses(
        "project_wrap_up_trash",
        &trash(project, &stale),
        LibraryErrorCode::Conflict,
        project,
    );
    let report =
        shell.invoke("project_wrap_up_trash", &trash(project, &review["digest"])).expect("trash");
    assert_eq!(report["record"]["step"], "trash", "{report}");
    assert_eq!(report["record"]["outcome"], "finished", "nothing was offered: {report}");
    assert_eq!((&report["moved"], &report["refused"]), (&json!([]), &json!([])));
}

#[test]
fn wrap_up_archive_review_family_lays_out_for_a_destination() {
    let shell = Shell::new();
    let archive = tempfile::tempdir().expect("archive root");
    let destination = shell.destination(archive.path());
    let unknown = Uuid::new_v4();
    let asked = |project: Uuid, at: Uuid| json!({ "projectId": project, "destination": at });
    shell.refuses(
        "project_wrap_up_archive_review",
        &asked(unknown, destination),
        NOT_FOUND,
        unknown,
    );

    let project = shell.open_project();
    // An unknown destination also names the Project the review was for.
    shell.refuses(
        "project_wrap_up_archive_review",
        &asked(project, Uuid::new_v4()),
        NOT_FOUND,
        project,
    );
    let review = shell
        .invoke("project_wrap_up_archive_review", &asked(project, destination))
        .expect("review");
    assert_eq!(
        (&review["projectId"], &review["destination"]),
        (&json!(project), &json!(destination))
    );
    assert_eq!(review["sessions"], json!([]), "the Project holds no session: {review}");
    assert!(review["digest"].as_str().is_some_and(|digest| digest.len() == 64), "{review}");
}

/// The library's workflow settings (D-W114; CAL-FR-15, J36 S8, PLAN-FR-02):
/// the defaults at revision 0, a save of non-defaults with its expected
/// revision, a stale save refused naming the settings, and an invalid one
/// refused naming the settings and the field that failed.
#[test]
fn workflow_settings_family_reads_and_saves_with_revisions() {
    let shell = Shell::new();
    let settings = persistence_library::WORKFLOW_SETTINGS_ID;
    let read = shell.call("workflow_settings_get", &json!({}));
    assert_eq!(read["revision"], json!(0), "{read}");
    assert_eq!(read["settings"]["viewMode"], json!("symlinks"));
    assert_eq!(read["settings"]["calibration"]["keepRawFrames"], json!(false));
    assert_eq!(read["settings"]["calibration"]["oldMasterAfterDays"], json!(90));
    assert_eq!(read["settings"]["moonAvoidance"]["OIII"]["distanceDeg"], json!(110.0));

    let mut changed = read["settings"].clone();
    changed["viewMode"] = json!("copies");
    changed["calibration"] = json!({"keepRawFrames": true, "oldMasterAfterDays": 30});
    changed["moonAvoidance"]["Ha"] = json!({"distanceDeg": 45.0, "widthDays": 5.0});
    let saved =
        shell.call("workflow_settings_save", &json!({"settings": changed, "expectedRevision": 0}));
    assert_eq!(saved, json!({"settings": changed, "revision": 1}));
    assert_eq!(shell.call("workflow_settings_get", &json!({})), saved);

    shell.refuses(
        "workflow_settings_save",
        &json!({"settings": changed, "expectedRevision": 0}),
        LibraryErrorCode::Conflict,
        settings,
    );
    let mut invalid = changed.clone();
    invalid["moonAvoidance"]["SII"] = json!({"distanceDeg": 60.0, "widthDays": 0.0});
    let refused = shell.refusal(
        "workflow_settings_save",
        &json!({"settings": invalid, "expectedRevision": 1}),
        LibraryErrorCode::InvalidInput,
        settings,
    );
    assert_eq!(refused["field"], json!("moonAvoidance.SII.widthDays"), "{refused}");
    assert_eq!(shell.call("workflow_settings_get", &json!({})), saved, "nothing else stored");
}

/// Camera IPC accepts one create, one revision-checked edit and refuses stale or invalid saves.
#[test]
fn library_save_camera_uses_camera_revisions_and_validation() {
    let shell = Shell::new();
    let camera = Uuid::new_v4();
    let args = |id: Option<Uuid>, model: &str, expected_revision: Option<u64>| {
        json!({
            "input": {
                "id": id,
                "model": model,
                "alias": null,
                "noDarks": false,
                "noBias": false,
            },
            "expectedRevision": expected_revision,
        })
    };

    let created = shell.call("library_save_camera", &args(Some(camera), "ASI533MC", None));
    assert_eq!(created["id"], json!(camera));
    assert_eq!(created["revision"], json!(1));

    let edited = shell.call("library_save_camera", &args(Some(camera), "ASI533MC Pro", Some(1)));
    assert_eq!(edited["model"], json!("ASI533MC Pro"));
    assert_eq!(edited["revision"], json!(2));
    shell.refuses(
        "library_save_camera",
        &args(Some(camera), "Stale Model", Some(1)),
        LibraryErrorCode::Conflict,
        camera,
    );
    let invalid_id = Uuid::new_v4();
    let invalid_model = shell.refusal(
        "library_save_camera",
        &args(Some(invalid_id), "  ", None),
        LibraryErrorCode::InvalidInput,
        invalid_id,
    );
    assert_eq!(invalid_model["field"], json!("model"), "{invalid_model}");
    let blank_alias_id = Uuid::new_v4();
    let mut blank_alias = args(Some(blank_alias_id), "ASI2600MM", None);
    blank_alias["input"]["alias"] = json!("  ");
    let blank_alias = shell.refusal(
        "library_save_camera",
        &blank_alias,
        LibraryErrorCode::InvalidInput,
        blank_alias_id,
    );
    assert_eq!(blank_alias["field"], json!("alias"), "{blank_alias}");
    let missing_id = shell
        .invoke("library_save_camera", &args(None, "Missing id", Some(1)))
        .expect_err("an edit without an id is refused");
    assert_eq!(missing_id["code"], json!(LibraryErrorCode::InvalidInput));
    assert_eq!(missing_id["identity"], Value::Null);
    let saved = shell.call("library_save_camera", &args(Some(camera), "ASI533MC Pro", Some(2)));
    assert_eq!(saved["model"], json!("ASI533MC Pro"));
    assert_eq!(saved["revision"], json!(3));
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let mut first_args = args(Some(first), "ASI2600MM", None);
    first_args["input"]["alias"] = json!("Shared alias");
    shell.call("library_save_camera", &first_args);
    let mut second_args = args(Some(second), "ASI533MC", None);
    second_args["input"]["alias"] = json!("shared ALIAS");
    let refusal =
        shell.refusal("library_save_camera", &second_args, LibraryErrorCode::InvalidInput, second);
    assert_eq!(refusal["field"], json!("alias"), "{refusal}");
    assert_eq!(refusal["identity"], json!(second), "{refusal}");

    let stored_without_alias = Uuid::new_v4();
    shell.call("library_save_camera", &args(Some(stored_without_alias), "ASI6200MM", None));
    let aliased_request = Uuid::new_v4();
    let mut aliased_args = args(Some(aliased_request), "ASI6200MM", None);
    aliased_args["input"]["alias"] = json!("Mono");
    let refusal = shell.refusal(
        "library_save_camera",
        &aliased_args,
        LibraryErrorCode::InvalidInput,
        aliased_request,
    );
    assert_eq!(refusal["field"], json!("alias"), "{refusal}");
    assert_eq!(refusal["identity"], json!(aliased_request), "{refusal}");
}
#[test]
fn library_data_location_returns_the_native_catalog_directory() {
    let shell = Shell::new();
    let actual = shell.call("library_data_location", &json!({}));
    assert_eq!(actual, native_path(shell.dir.path()));
}

/// Home Status (PRJ-FR-17 section 4): an online location carries its
/// volume's free space and low-space flag; an offline one reads unknown.
#[test]
fn library_list_locations_carries_the_volume_free_space_until_offline() {
    let shell = Shell::new();
    let root = shell.dir.path().join("Captures");
    std::fs::create_dir_all(&root).expect("captures root");
    let id = shell.destination(&root);
    let location = |listed: &Value| {
        let state = listed
            .as_array()
            .and_then(|states| states.iter().find(|state| state["location"]["id"] == json!(id)))
            .unwrap_or_else(|| panic!("the location is listed: {listed}"));
        (state["location"]["freeBytes"].clone(), state["location"]["lowSpace"].clone())
    };
    let (free, low) = location(&shell.call("library_list_locations", &json!({})));
    assert!(free.is_u64() && low.is_boolean(), "online: {free} {low}");

    let library = shell.library();
    tauri::async_runtime::block_on(library.catalog().mark_location_unavailable(
        id,
        platevault_core::Availability::Offline,
        "ejected",
    ))
    .expect("mark offline");
    let (free, low) = location(&shell.call("library_list_locations", &json!({})));
    assert_eq!((free, low), (Value::Null, Value::Null), "offline is unknown, never zero");
}

/// PLAN-TGT-FR-01/14: `targets_get` takes the Target and an optional list
/// context. An unsaved Target is refused scoped to its id; a saved one's row
/// says whether it is in My targets, and its context's rig gives it a Fit.
/// Built-in presets cross IPC as ids, with no English name or definition.
#[test]
fn targets_get_reads_one_saved_target_and_presets_cross_as_ids() {
    let shell = Shell::new();
    let unknown = Uuid::new_v4();
    shell.refuses("targets_get", &json!({ "targetId": unknown }), NOT_FOUND, unknown);

    let (_, target, rig) = shell.open_project_details();
    let detail = shell.call("targets_get", &json!({ "targetId": target, "context": null }));
    let row = &detail["row"];
    assert_eq!(row["target"]["id"], json!(target), "{detail}");
    assert_eq!((&row["inMyTargets"], &row["favourite"]), (&json!(true), &json!(false)), "{row}");
    assert_eq!(row["fit"], json!([]), "no rig by default: {row}");
    assert_eq!(detail["planningUnavailable"], "no_site", "{detail}");

    let context = json!({ "night": "2026-10-10", "rigs": { "kind": "rig", "equipmentId": rig } });
    let fitted = shell.call("targets_get", &json!({ "targetId": target, "context": context }));
    assert_eq!(fitted["row"]["fit"].as_array().map(Vec::len), Some(1), "{fitted}");
    let unknown_rig = json!({ "rigs": { "kind": "rig", "equipmentId": unknown } });
    shell.refuses(
        "targets_get",
        &json!({ "targetId": target, "context": unknown_rig }),
        NOT_FOUND,
        unknown,
    );

    let presets = shell.call("targets_presets_list", &json!({ "rigs": null }));
    let builtin = presets["builtin"].as_array().expect("built-in presets");
    assert!(!builtin.is_empty(), "{presets}");
    for info in builtin {
        let keys: Vec<&String> = info.as_object().expect("an object").keys().collect();
        assert_eq!(keys, ["preset"], "ids only: {info}");
    }
}
