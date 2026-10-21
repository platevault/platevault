// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The mock library shell's IPC, shared by the `library_*` IPC tests. A
//! command runs through Tauri's mock runtime with JSON arguments, as the
//! webview sends them, and replies with its value or a refusal: a library
//! `ErrorResponse`, or Tauri's plain string for an argument the handler can't
//! deserialize. Included with `mod support;`; each test uses a subset.
#![allow(dead_code)]

use desktop_shell::commands::project_apply::ApplyRuns;
use desktop_shell::commands::project_wrap_up::CloseRuns;
use platevault_core::LibraryErrorCode;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, MockRuntime};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow};
use uuid::Uuid;

/// The refusal for a request that names a record the catalog doesn't hold.
pub const NOT_FOUND: LibraryErrorCode = LibraryErrorCode::NotFound;

/// A mock shell's commands, called through its `library` window.
pub trait Ipc {
    /// The window the commands run in.
    fn webview(&self) -> &WebviewWindow<MockRuntime>;

    /// The command's value, or what it refused with.
    fn invoke(&self, cmd: &str, args: &Value) -> Result<Value, Value> {
        invoke(self.webview(), cmd, args)
    }

    /// The command's reply; a refusal fails the test with what it said.
    fn call(&self, cmd: &str, args: &Value) -> Value {
        self.invoke(cmd, args).unwrap_or_else(|error| panic!("{cmd} {args} refused: {error}"))
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
}

/// [`Ipc::invoke`] for a caller that holds only the window, such as a thread
/// the test spawns while the shell stays with the test.
pub fn invoke(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: &Value,
) -> Result<Value, Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            // The origin a real webview invokes from is the app URL it loaded:
            // `tauri://localhost` on macOS and Linux, `http://tauri.localhost`
            // on Windows. Any other origin is remote, which the ACL refuses.
            url: webview.url().expect("mock webview URL"),
            body: InvokeBody::Json(args.clone()),
            headers: tauri::http::HeaderMap::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    )
    .map(|body| body.deserialize::<Value>().expect("JSON reply"))
}

/// The running Applies and Closes, managed as `library_shell::run` manages
/// them. Without them Tauri refuses `project_apply` and `project_close` with
/// its state-not-managed string before their handlers run.
pub fn manage_runs(app: &App<MockRuntime>) {
    app.manage(ApplyRuns::emitting(app.handle().clone()));
    app.manage(CloseRuns::default());
}
