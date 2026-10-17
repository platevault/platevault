// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! IPC tests for the controls of the F4 library shell's long operations:
//! Apply's waiting-for-a-tool event and its Cancel (spec 069 PREP-FR-18),
//! Close's Stop and its resumption (071 STO-FR-08), and the Output step's
//! Rescan (070 RES-FR-01).
//!
//! The handlers run through Tauri's mock runtime with JSON arguments, as the
//! webview sends them, over the F4 Apply world of `platevault_core`'s own
//! tests (its `tests/support`, included here, Unix-only like the core targets
//! that use it): real files and a real catalog. A tool holding a file in View
//! is the core's `apply::pacing::HeldFolder`, which the `test-pacing` feature
//! on this crate's dev-dependency edge compiles.
#![cfg(unix)]

#[path = "../../../../crates/platevault-core/tests/support/apply.rs"]
mod apply_support;
#[path = "../../../../crates/platevault-core/tests/support/cleanup.rs"]
mod cleanup_support;

use std::fs;
use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use apply_support::{catalogued, world, World};
use cleanup_support::ScopedTrash;
use desktop_shell::commands::project_apply::{ApplyRuns, APPLY_WAITING_EVENT};
use desktop_shell::commands::project_wrap_up::{CloseRuns, WrapUpTrash};
use platevault_core::apply::pacing::HeldFolder;
use platevault_core::custody::trash::OsTrash;
use platevault_core::library::Library;
use platevault_core::project_output::OutputWatch;
use platevault_core::{
    ApplyOutcome, ApplyPhase, ApplyReport, ArchiveMoveOutcome, ArchiveSelection, CleanUpRequest,
    CloseReport, CloseRequest, LocationRole, NativePath, OutputObservation, ProjectLifecycle,
    TrashRequest, TrashSupport, ViewMode, WrapUpStatus,
};
use serde_json::{json, Value};
use tauri::async_runtime::block_on;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::webview::InvokeRequest;
use tauri::{Listener, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

/// Bounds a wait for something the run under test must reach; exceeding it
/// fails the test instead of hanging it. A loaded machine takes tens of
/// seconds to build this world's View.
const PATIENCE: Duration = Duration::from_secs(180);

/// The mock shell over a world's library, with the state the real shell
/// manages for these commands. The window drops before the app.
struct Shell {
    webview: WebviewWindow<MockRuntime>,
    app: tauri::App<MockRuntime>,
}

impl Shell {
    fn new(library: &Arc<Library>, trash: Arc<dyn OsTrash>) -> Self {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                desktop_shell::commands::project_apply::project_apply_preview,
                desktop_shell::commands::project_apply::project_apply,
                desktop_shell::commands::project_apply::project_apply_cancel,
                desktop_shell::commands::project_output::project_output_rescan,
                desktop_shell::commands::project_wrap_up::project_wrap_up_status,
                desktop_shell::commands::project_wrap_up::project_close,
                desktop_shell::commands::project_wrap_up::project_close_stop,
            ])
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        app.manage(Arc::clone(library));
        app.manage(WrapUpTrash::new(trash));
        app.manage(ApplyRuns::emitting(app.handle().clone()));
        app.manage(CloseRuns::default());
        let webview = WebviewWindowBuilder::new(&app, "library", WebviewUrl::default())
            .build()
            .expect("library window");
        Self { webview, app }
    }

    fn invoke(&self, cmd: &str, args: &Value) -> Result<Value, Value> {
        invoke(&self.webview, cmd, args)
    }

    /// The command ran and refused with a library `ErrorResponse` of `kind`
    /// naming `identity`.
    fn refuses(&self, cmd: &str, args: &Value, kind: &str, identity: Uuid) {
        let error = self.invoke(cmd, args).expect_err(cmd);
        assert!(error.is_object(), "{cmd} reached its handler: {error}");
        assert_eq!(error["kind"], kind, "{cmd}: {error}");
        assert_eq!(error["identity"], json!(identity), "{cmd}: {error}");
    }

    /// Every `project_apply_waiting` payload from now on, in order.
    fn waits(&self) -> Receiver<Value> {
        let (sent, waits) = mpsc::channel();
        self.app.listen_any(APPLY_WAITING_EVENT, move |event| {
            let payload = serde_json::from_str(event.payload()).expect("JSON payload");
            let _ = sent.send(payload);
        });
        waits
    }

    /// The sheet's request, as the webview echoes it, with nothing ticked.
    fn sheet_request(&self, project: Uuid) -> Value {
        let preview = self.invoke("project_apply_preview", &json!({ "projectId": project }));
        let preview = preview.expect("the Apply sheet");
        assert_eq!(preview["blockers"], json!([]), "{preview}");
        json!({ "request": {
            "projectId": project,
            "desiredRevision": preview["desiredRevision"],
            "basisDigest": preview["basisDigest"],
            "ticked": [],
        } })
    }
}

fn invoke(webview: &WebviewWindow<MockRuntime>, cmd: &str, args: &Value) -> Result<Value, Value> {
    get_ipc_response(
        webview,
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

fn from<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("the reply's shape")
}

/// The world, opened on Tauri's runtime, where the handlers run, so the
/// catalog's connections belong to it. Its View is installed once.
fn applied(mode: ViewMode) -> World {
    block_on(async {
        let world = world(mode).await;
        world.apply().await;
        world
    })
}

/// A Trash that takes nothing, so no test can reach the user's.
fn no_trash(world: &World) -> Arc<dyn OsTrash> {
    ScopedTrash::new(&world.temp.path().join("bin")).dyn_trash()
}

/// PREP-FR-18: a tool holding a file in View makes Apply wait after the
/// build; the shell emits the operation, its Project and the held folder,
/// and once the tool lets go Apply continues by itself, emits that it no
/// longer waits, and ends Applied.
#[test]
fn a_held_apply_reports_its_wait_and_continues_once_released() {
    let world = applied(ViewMode::Symlinks);
    let shell = Shell::new(&world.library, no_trash(&world));
    let waits = shell.waits();
    let request = shell.sheet_request(world.project);
    let held_view = serde_json::to_value(NativePath::from_path(&world.view())).unwrap();

    let report: ApplyReport = thread::scope(|scope| {
        let held = HeldFolder::hold(&world.view());
        let webview = &shell.webview;
        let applying = scope.spawn(move || invoke(webview, "project_apply", &request));
        let started = waits.recv_timeout(PATIENCE).expect("Apply waits for the tool");
        assert_eq!(started["projectId"], json!(world.project), "{started}");
        assert_eq!(started["held"], held_view, "it names the View a tool holds a file in");
        drop(held);
        let report: ApplyReport = from(applying.join().unwrap().expect("Apply"));
        assert_eq!(started["operationId"], json!(report.operation_id), "{started}");
        let ended = waits.recv_timeout(PATIENCE).expect("Apply no longer waits");
        assert_eq!(
            ended,
            json!({ "operationId": report.operation_id, "projectId": world.project, "held": null })
        );
        report
    });

    assert_eq!(report.outcome, Some(ApplyOutcome::Applied), "{report:#?}");
    let journal = block_on(world.journal(report.operation_id));
    assert_eq!(
        (journal.phase, journal.outcome),
        (ApplyPhase::Settled, Some(ApplyOutcome::Applied))
    );
    assert!(waits.try_recv().is_err(), "one wait, one end");
}

/// PREP-FR-09/18: Cancel, by the operation id the waiting event names,
/// stops an Apply a tool holds; its journal ends Canceled, the old View is
/// untouched and the build is cleared. A Cancel once it ended finds nothing.
#[test]
fn cancel_stops_a_held_apply_and_its_journal_ends_canceled() {
    let world = applied(ViewMode::Symlinks);
    let before = World::tree(&world.view());
    let shell = Shell::new(&world.library, no_trash(&world));
    let waits = shell.waits();
    let request = shell.sheet_request(world.project);

    let report: ApplyReport = thread::scope(|scope| {
        // Declared in the scope, so a failed assertion lets the Apply go
        // before the scope joins it.
        let _held = HeldFolder::hold(&world.view());
        let webview = &shell.webview;
        let applying = scope.spawn(move || invoke(webview, "project_apply", &request));
        let started = waits.recv_timeout(PATIENCE).expect("Apply waits for the tool");
        let operation = started["operationId"].clone();
        let canceled = shell.invoke("project_apply_cancel", &json!({ "operationId": operation }));
        assert_eq!(canceled, Ok(Value::Null));
        let ended = waits.recv_timeout(PATIENCE).expect("the canceled Apply no longer waits");
        assert_eq!(ended["held"], Value::Null, "{ended}");
        let report: ApplyReport = from(applying.join().unwrap().expect("Apply"));
        assert_eq!(json!(report.operation_id), operation);
        report
    });

    assert_eq!(report.outcome, Some(ApplyOutcome::Canceled), "{report:#?}");
    let journal = block_on(world.journal(report.operation_id));
    assert_eq!(
        (journal.phase, journal.outcome),
        (ApplyPhase::Settled, Some(ApplyOutcome::Canceled))
    );
    assert_eq!(World::tree(&world.view()), before, "the old View is unchanged");
    assert!(!world.building().exists() && !world.previous().exists());
    shell.refuses(
        "project_apply_cancel",
        &json!({ "operationId": report.operation_id }),
        "not_found",
        report.operation_id,
    );
}

/// An OS Trash that holds its first move until the test lets it go, so the
/// Close is still running when the test stops it.
struct GatedTrash {
    bin: Arc<ScopedTrash>,
    gate: Mutex<Option<(Sender<()>, Receiver<()>)>>,
}

impl OsTrash for GatedTrash {
    fn support(&self, entry: &Path, size_bytes: u64) -> TrashSupport {
        self.bin.support(entry, size_bytes)
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        let gate = self.gate.lock().unwrap().take();
        if let Some((arrived, release)) = gate {
            arrived.send(()).unwrap();
            release.recv_timeout(PATIENCE).map_err(|error| format!("never let go: {error}"))?;
        }
        self.bin.move_to_trash(entry)
    }
}

/// Clean up and Trash proceed with nothing ticked, the empty `Archive-T7`
/// Captures location is registered, and the Close request archives every
/// session the review offers there.
async fn close_request(world: &World, trash: &Arc<ScopedTrash>) -> CloseRequest {
    let library = &world.library;
    let review = library.clean_up_review(world.project).await.unwrap();
    let request = CleanUpRequest {
        project_id: world.project,
        desired_revision: review.desired_revision,
        generation: review.generation,
        selected: Vec::new(),
    };
    library.clean_up(&request, trash.dyn_trash()).await.unwrap();
    let review = library.trash_review(world.project, trash.dyn_trash()).await.unwrap();
    let request =
        TrashRequest { project_id: world.project, digest: review.digest, ticked: Vec::new() };
    library.wrap_up_trash(&request, trash.dyn_trash()).await.unwrap();

    let root = world.temp.path().join("Archive-T7");
    fs::create_dir_all(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let archive = library
        .register_location(
            NativePath::from_path(&root),
            "Archive-T7".into(),
            LocationRole::Captures,
        )
        .await
        .unwrap();
    let review = library.wrap_up_archive_review(world.project, archive.id).await.unwrap();
    assert_eq!(review.sessions.len(), 2, "{review:#?}");
    CloseRequest {
        project_id: world.project,
        desired_revision: library.wrap_up_status(world.project).await.unwrap().desired_revision,
        archive: Some(ArchiveSelection {
            destination: archive.id,
            sessions: review.sessions.iter().map(|offer| offer.session_id).collect(),
            digest: review.digest,
        }),
    }
}

/// STO-FR-08: Stop interrupts a running Close before its archive's next
/// durable step: the Project stays Closing with the archive unsettled, and
/// the next start resumes it from what it recorded to Archived.
#[test]
fn close_stop_leaves_a_resumable_closing_project() {
    let mut world = applied(ViewMode::Symlinks);
    let bin = ScopedTrash::new(&world.temp.path().join("bin"));
    let request = block_on(close_request(&world, &bin));
    let (arrived, gate_arrival) = mpsc::channel();
    let (let_go, gate_release) = mpsc::channel();
    let trash = Arc::new(GatedTrash {
        bin: Arc::clone(&bin),
        gate: Mutex::new(Some((arrived, gate_release))),
    });
    let shell = Shell::new(&world.library, trash);
    let project = json!({ "projectId": world.project });

    let report: CloseReport = thread::scope(|scope| {
        let webview = &shell.webview;
        let args = json!({ "request": request });
        let closing = scope.spawn(move || invoke(webview, "project_close", &args));
        gate_arrival.recv_timeout(PATIENCE).expect("the archive retires its first original");
        assert_eq!(shell.invoke("project_close_stop", &project), Ok(Value::Null));
        let_go.send(()).unwrap();
        from(closing.join().unwrap().expect("Close"))
    });

    assert_eq!(report.lifecycle, ProjectLifecycle::Closing, "{report:#?}");
    let archive = report.archive.expect("the archive's progress");
    assert!(!archive.settled);
    let outcomes: Vec<_> = archive.moves.iter().map(|step| step.outcome).collect();
    assert_eq!(outcomes.first(), Some(&Some(ArchiveMoveOutcome::Archived)), "{outcomes:?}");
    assert!(outcomes[1..].iter().all(Option::is_none), "the stop came before the next file");
    let status: WrapUpStatus =
        from(shell.invoke("project_wrap_up_status", &project).expect("status"));
    assert_eq!(status.lifecycle, ProjectLifecycle::Closing);
    shell.refuses("project_close_stop", &project, "not_found", world.project);

    drop(shell);
    let settled = block_on(async {
        world.reopen().await;
        world.library.recover_wrap_up(bin.dyn_trash()).await.unwrap()
    });
    assert_eq!(settled.len(), 1);
    assert!(settled[0].settled, "{:#?}", settled[0]);
    assert!(settled[0].moves.iter().all(|step| step.outcome == Some(ArchiveMoveOutcome::Archived)));
    let status = block_on(world.library.wrap_up_status(world.project)).unwrap();
    assert_eq!(status.lifecycle, ProjectLifecycle::Archived);
    assert_eq!(bin.moved().len(), 4, "each original went to the Trash once");
}

/// RES-FR-01: Rescan walks the Project's `Output/` through the managed
/// watcher now, so a file saved since it last looked is listed.
#[test]
fn rescan_reports_a_new_output_file() {
    let world = block_on(catalogued(ViewMode::Copies));
    let output = world.folder().join("Output");
    fs::create_dir_all(&output).unwrap();
    let shell = Shell::new(&world.library, no_trash(&world));
    let watch = block_on(async { OutputWatch::start(&world.library) });
    shell.app.manage(watch);
    let project = json!({ "projectId": world.project });
    let before: Vec<OutputObservation> =
        from(shell.invoke("project_output_rescan", &project).expect("Rescan"));
    assert!(before.is_empty(), "{before:#?}");

    fs::write(output.join("NGC7000_final.xisf"), b"stacked by a tool").unwrap();
    let after: Vec<OutputObservation> =
        from(shell.invoke("project_output_rescan", &project).expect("Rescan"));
    let paths: Vec<_> = after.iter().map(|observation| observation.path.display()).collect();
    assert_eq!(paths, ["NGC7000_final.xisf"], "{after:#?}");

    let unknown = Uuid::new_v4();
    shell.refuses("project_output_rescan", &json!({ "projectId": unknown }), "not_found", unknown);
    block_on(shell.app.state::<OutputWatch>().shutdown());
}
