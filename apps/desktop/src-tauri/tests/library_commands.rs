// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! IPC smoke tests for the F4 library-shell commands, one per command family.
//!
//! Each test runs the registered handlers through Tauri's mock runtime with
//! JSON arguments, as the webview sends them, on a temporary catalog. A reply
//! is either the command's value or a library `ErrorResponse` naming the
//! identity the request was about. An argument the handler can't deserialize
//! never reaches it: Tauri refuses it with a plain string, which these tests
//! tell apart, so each call proves the command's argument names and shapes.

use std::path::Path;
use std::sync::Arc;

use desktop_shell::commands::project_wrap_up::WrapUpTrash;
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::Library;
use platevault_core::{TrashSupport, TrashUnsupported};
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

/// The mock shell over a fresh catalog. Fields drop in order: the window and
/// app (with the library they manage) before the catalog's directory.
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
            ])
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        app.manage(library);
        app.manage(WrapUpTrash::new(Arc::new(NoTrash)));
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

    /// The command ran and refused with a library `ErrorResponse` of `kind`
    /// naming `identity`.
    fn refuses(&self, cmd: &str, args: &Value, kind: &str, identity: Uuid) {
        let error = self.invoke(cmd, args).expect_err(cmd);
        assert!(error.is_object(), "{cmd} reached its handler: {error}");
        assert_eq!(error["kind"], kind, "{cmd}: {error}");
        assert_eq!(error["identity"], json!(identity), "{cmd}: {error}");
        assert!(error["message"].as_str().is_some_and(|text| !text.is_empty()), "{cmd}: {error}");
    }
}

fn unix_path(path: &str) -> Value {
    json!({ "encoding": "unix-bytes", "payload": path.as_bytes() })
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

    shell.refuses("project_inputs", &json!({ "projectId": project }), "not_found", project);
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
        "not_found",
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
        "not_found",
        project,
    );
    shell.refuses(
        "project_move_sessions",
        &edit(json!({ "sessions": [session], "groupId": group })),
        "not_found",
        project,
    );
    shell.refuses(
        "project_create_group",
        &edit(json!({ "rigId": Uuid::new_v4(), "name": "Wide", "sessions": [session] })),
        "not_found",
        project,
    );
    shell.refuses(
        "project_split_group",
        &edit(json!({ "groupId": group, "sessions": [session], "name": null })),
        "not_found",
        project,
    );
    shell.refuses(
        "project_rename_group",
        &edit(json!({ "groupId": group, "name": "Core" })),
        "not_found",
        project,
    );
    shell.refuses(
        "project_set_group_panel",
        &edit(json!({ "groupId": group, "panel": true, "name": "Panel 1" })),
        "not_found",
        project,
    );
    shell.refuses(
        "project_set_frames",
        &edit(json!({ "captureKeys": [Uuid::new_v4()], "choice": "exclude" })),
        "not_found",
        project,
    );
}

#[test]
fn apply_family_takes_its_arguments() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    shell.refuses("project_apply_preview", &json!({ "projectId": project }), "not_found", project);
    shell.refuses(
        "project_apply",
        &json!({ "request": {
            "projectId": project,
            "desiredRevision": 1,
            "basisDigest": "0".repeat(64),
            "ticked": [unix_path("notes.txt")],
        } }),
        "not_found",
        project,
    );
}

#[test]
fn intake_family_takes_its_arguments() {
    let shell = Shell::new();
    let session = Uuid::new_v4();
    let asked = json!({ "sessionId": session });
    shell.refuses("pix_session_intake", &asked, "not_found", session);
    shell.refuses(
        "pix_session_review_list",
        &json!({ "sessionId": session, "filter": "all", "sort": null, "names": { "kind": "file_name" } }),
        "not_found",
        session,
    );
    shell.refuses(
        "pix_finish_review",
        &json!({ "sessionId": session, "expectedGroupingRevision": 1 }),
        "not_found",
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
        "not_found",
        asset,
    );
    shell.refuses("pix_reopen_review", &asked, "not_found", session);
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
        "not_found",
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
        "not_found",
        project,
    );
}

#[test]
fn wrap_up_family_takes_its_arguments() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    shell.refuses("project_wrap_up_status", &json!({ "projectId": project }), "not_found", project);
    shell.refuses(
        "project_close",
        &json!({ "request": { "projectId": project, "desiredRevision": 1, "archive": null } }),
        "not_found",
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
        "not_found",
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
        "not_found",
        session,
    );
    // No runs over many sessions at once, so the refusal names the session
    // it couldn't find in its message rather than as the request's identity.
    let error = shell
        .invoke("calibration_decline", &json!({ "sessions": [[session, 1]], "kind": "bias" }))
        .expect_err("unknown session");
    assert!(error.is_object(), "calibration_decline reached its handler: {error}");
    assert_eq!(error["kind"], "not_found", "{error}");
    assert!(error["identity"].is_null(), "{error}");
    assert!(
        error["message"].as_str().is_some_and(|text| text.contains(&session.to_string())),
        "{error}"
    );
}

#[test]
fn project_group_removal_and_view_settings_take_their_arguments() {
    let shell = Shell::new();
    let project = Uuid::new_v4();
    shell.refuses(
        "project_remove_group",
        &json!({ "projectId": project, "expectedRevision": 1, "groupId": Uuid::new_v4() }),
        "not_found",
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
    shell.refuses("project_set_view_settings", &settings("GROUP", "PANEL"), "not_found", project);
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
        "not_found",
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
        "not_found",
        destination,
    );
    shell.refuses(
        "sessions_archive",
        &json!({ "selection": {
            "destination": destination,
            "sessions": [session],
            "digest": "0".repeat(64),
        } }),
        "not_found",
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
    shell.refuses("project_review_previous_item", &review("kept"), "not_found", project);
    // Pending is the state the catalog records a leftover in; no client sets it.
    let pending =
        shell.invoke("project_review_previous_item", &review("pending")).expect_err("pending");
    assert!(pending.is_string(), "Tauri refuses a pending review itself: {pending}");
}
