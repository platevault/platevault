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

use std::path::Path;
use std::sync::Arc;

use desktop_shell::commands::project_apply::ApplyRuns;
use desktop_shell::commands::project_wrap_up::{CloseRuns, WrapUpTrash};
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::Library;
use platevault_core::targets::TargetQuery;
use platevault_core::{
    AssociationState, ColorKind, Equipment, LibraryErrorCode, LocationRole, NativePath,
    ProjectInput, Provenance, SubjectInput, TrashSupport, TrashUnsupported,
};
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::webview::InvokeRequest;
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
    _dir: tempfile::TempDir,
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
                desktop_shell::commands::project_output::project_copy_to_output,
                desktop_shell::commands::project_wrap_up::project_wrap_up_status,
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
            ])
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        app.manage(library);
        app.manage(WrapUpTrash::new(Arc::new(NoTrash)));
        app.manage(ApplyRuns::emitting(app.handle().clone()));
        app.manage(CloseRuns::default());
        let webview = WebviewWindowBuilder::new(&app, "library", WebviewUrl::default())
            .build()
            .expect("library window");
        Self { webview, _app: app, _dir: dir }
    }

    fn invoke(&self, cmd: &str, args: &Value) -> Result<Value, Value> {
        get_ipc_response(
            &self.webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().expect("webview url"),
                body: InvokeBody::Json(args.clone()),
                headers: tauri::http::HeaderMap::default(),
                invoke_key: tauri::test::INVOKE_KEY.into(),
            },
        )
        .map(|body| body.deserialize::<Value>().expect("JSON reply"))
    }

    /// The command ran and refused with a library `ErrorResponse` of `code`
    /// naming `identity`, and sent no English text.
    fn refuses(&self, cmd: &str, args: &Value, code: LibraryErrorCode, identity: Uuid) {
        let error = self.invoke(cmd, args).expect_err(cmd);
        assert!(error.is_object(), "{cmd} reached its handler: {error}");
        assert_eq!(error["code"], json!(code), "{cmd}: {error}");
        assert_eq!(error["identity"], json!(identity), "{cmd}: {error}");
        assert!(error.get("message").is_none(), "{cmd} sent English text: {error}");
    }

    /// The library the handlers run on, to arrange what a test calls on.
    fn library(&self) -> Arc<Library> {
        Arc::clone(self.webview.state::<Arc<Library>>().inner())
    }

    /// An open Project on a saved seed Target and rig, holding no session.
    fn open_project(&self) -> Uuid {
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
            let rig = library.catalog().save_equipment(&rig, None).await.expect("rig").id;
            let query = TargetQuery { text: Some("NGC 7000".into()), cone: None, limit: 1 };
            let target =
                library.search_targets(&query).await.expect("seed search").remove(0).candidate;
            library.catalog().record_seed_target(&target).await.expect("save the Target");
            let input = ProjectInput {
                name: "NGC 7000 HOO".into(),
                notes: None,
                subjects: vec![SubjectInput { target_id: target.id, name: None }],
                rig_ids: vec![rig],
                goals: Vec::new(),
            };
            library.catalog().create_project(&input).await.expect("create the Project").id
        })
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

fn unix_path(path: &str) -> Value {
    json!({ "encoding": "unix-bytes", "payload": path.as_bytes() })
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

/// Every refusal below: the request names a record the catalog doesn't hold.
const NOT_FOUND: LibraryErrorCode = LibraryErrorCode::NotFound;

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
}

#[test]
fn wrap_up_family_takes_its_arguments() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    shell.refuses("project_wrap_up_status", &json!({ "projectId": project }), NOT_FOUND, project);
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
    let settings = |group: &str, panel: &str| {
        json!({
            "projectId": project,
            "expectedRevision": 1,
            "settings": {
                "mode": "copies",
                "keywords": { "group": group, "panel": panel },
                "profileId": null,
                "parent": unix_path("/tmp/processing"),
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
    shell.refuses(
        "project_clean_up_review",
        &json!({ "projectId": unknown }),
        "not_found",
        unknown,
    );
    shell.refuses(
        "project_clean_up",
        &json!({ "request": {
            "projectId": unknown,
            "desiredRevision": 1,
            "generation": null,
            "selected": [unix_path("View/Lights/frame.fits")],
        } }),
        "not_found",
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
    shell.refuses("project_trash_review", &json!({ "projectId": unknown }), "not_found", unknown);
    let trash = |project: Uuid, digest: &Value| {
        json!({ "request": {
            "projectId": project,
            "digest": digest,
            "ticked": ["processing_files"],
        } })
    };
    let stale = json!("0".repeat(64));
    shell.refuses("project_wrap_up_trash", &trash(unknown, &stale), "not_found", unknown);

    let project = shell.open_project();
    clean_up_nothing(&shell, project);
    let review =
        shell.invoke("project_trash_review", &json!({ "projectId": project })).expect("review");
    let groups: Vec<&Value> =
        review["groups"].as_array().expect("rows").iter().map(|row| &row["group"]).collect();
    assert_eq!(groups, ["rejected_frames", "processing_files", "duplicate_copies"], "{review}");
    // The digest is the proof the user saw this sheet.
    shell.refuses("project_wrap_up_trash", &trash(project, &stale), "conflict", project);
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
        "not_found",
        unknown,
    );

    let project = shell.open_project();
    // An unknown destination also names the Project the review was for.
    shell.refuses(
        "project_wrap_up_archive_review",
        &asked(project, Uuid::new_v4()),
        "not_found",
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
