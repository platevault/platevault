// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! IPC tests for import review (LIB-FR-04/24, D-W107, D-W129; CF2 owner
//! answer of 2026-10-20): merge and re-split, the read-only split preview,
//! the import's own centre and rotation limits and each session's Target,
//! and Home's import list (PRJ-FR-17 section 1), run through Tauri's mock
//! runtime with JSON arguments as the webview sends them. A refusal is a
//! library `ErrorResponse` code naming the import.

mod support;

use std::io::Write;
use std::path::Path;
use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{ImportMode, LibraryErrorCode, LocationRole, NativePath};
use serde_json::{json, Value};
use support::Ipc;
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

struct Shell {
    webview: WebviewWindow<MockRuntime>,
    card: std::path::PathBuf,
    _app: tauri::App<MockRuntime>,
    _dir: tempfile::TempDir,
}

impl Ipc for Shell {
    fn webview(&self) -> &WebviewWindow<MockRuntime> {
        &self.webview
    }
}

/// A 4×4 FITS light of 14 October, `minute` after 19:00 UTC, pointing
/// `offset` arcminutes north of 314.68°, +44.31°.
fn light(path: &Path, minute: u32, offset: f64) {
    let cards = [
        "SIMPLE  =                    T".to_owned(),
        "BITPIX  =                   16".into(),
        "NAXIS   =                    2".into(),
        "NAXIS1  =                    4".into(),
        "NAXIS2  =                    4".into(),
        "IMAGETYP= 'LIGHT'".into(),
        "FILTER  = 'Ha'".into(),
        "EXPTIME = 300".into(),
        format!("DATE-OBS= '2026-10-14T19:{minute:02}:00'"),
        "INSTRUME= 'ZWO ASI2600MM Pro'".into(),
        "OBJECT  = 'NGC7000'".into(),
        "FOCALLEN= 250".into(),
        "XPIXSZ  = 3.76".into(),
        "RA      = 314.68".into(),
        format!("DEC     = {:.9}", 44.31 + offset / 60.0),
        "ROTATANG= 12.4".into(),
        "END".into(),
    ];
    let mut header = Vec::new();
    for card in cards {
        let mut bytes = [b' '; 80];
        bytes[..card.len()].copy_from_slice(card.as_bytes());
        header.extend_from_slice(&bytes);
    }
    header.resize(header.len().div_ceil(2880) * 2880, b' ');
    header.resize(header.len() + 2880, 0);
    let mut file = std::fs::File::create(path).expect("fixture light");
    file.write_all(&header).expect("write the fixture");
}

impl Shell {
    /// The import commands over a catalog with one Captures location and a
    /// card of three lights: two at one framing and one 7′ away.
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let card = dir.path().join("card");
        let captures = dir.path().join("Captures");
        std::fs::create_dir_all(&card).expect("card");
        std::fs::create_dir_all(&captures).expect("captures");
        light(&card.join("a.fits"), 0, 0.0);
        light(&card.join("b.fits"), 1, 0.5);
        light(&card.join("c.fits"), 2, 7.0);
        let library = tauri::async_runtime::block_on(async {
            let library =
                Library::open(&dir.path().join("catalog.sqlite"), None).await.expect("library");
            library
                .register_location(
                    NativePath::from_path(&captures),
                    "Captures".into(),
                    LocationRole::Captures,
                )
                .await
                .expect("register Captures");
            library
        });
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                desktop_shell::commands::import::import_preview,
                desktop_shell::commands::import::import_recheck,
                desktop_shell::commands::import::import_status,
                desktop_shell::commands::import::import_merge_sessions,
                desktop_shell::commands::import::import_resplit_session,
                desktop_shell::commands::import::import_split_preview,
                desktop_shell::commands::import::import_set_split_limits,
                desktop_shell::commands::import::import_choose_target,
                desktop_shell::commands::import::import_list,
            ])
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        app.manage(Arc::clone(&library));
        let webview = WebviewWindowBuilder::new(&app, "library", WebviewUrl::default())
            .build()
            .expect("library window");
        Self { webview, card, _app: app, _dir: dir }
    }

    fn preview(&self) -> Value {
        // The preview settles each file over two checks, so the lights
        // written above settle on the second look.
        let source = json!({ "kind": "folder", "path": path_value(&self.card) });
        let mut preview = self.call("import_preview", &json!({ "source": source }));
        for _ in 0..50 {
            if preview["sessions"].as_array().is_some_and(|sessions| !sessions.is_empty()) {
                return preview;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
            preview = self.call(
                "import_recheck",
                &json!({ "id": preview["id"], "expectedRevision": preview["revision"] }),
            );
        }
        panic!("the lights never settled: {preview}");
    }
}

fn path_value(path: &Path) -> Value {
    serde_json::to_value(NativePath::from_path(path)).expect("native path")
}

fn id_of(value: &Value) -> Uuid {
    serde_json::from_value(value["id"].clone()).expect("import id")
}

fn sizes(sessions: &Value) -> Vec<usize> {
    sessions
        .as_array()
        .expect("sessions")
        .iter()
        .map(|session| session["items"].as_array().expect("items").len())
        .collect()
}

fn first_items(preview: &Value) -> Vec<Value> {
    preview["sessions"]
        .as_array()
        .expect("sessions")
        .iter()
        .map(|session| session["items"][0].clone())
        .collect()
}

#[test]
fn merge_and_resplit_work_over_ipc_and_keep_their_refusals() {
    let shell = Shell::new();
    let preview = shell.preview();
    let id = id_of(&preview);
    assert_eq!(sizes(&preview["sessions"]), [2, 1], "the 7′ light is a second framing");
    let seqs = first_items(&preview);

    shell.refuses(
        "import_merge_sessions",
        &json!({ "id": id, "expectedRevision": preview["revision"], "seqs": [seqs[0]] }),
        LibraryErrorCode::InvalidInput,
        id,
    );
    shell.refuses(
        "import_merge_sessions",
        &json!({ "id": id, "expectedRevision": 0, "seqs": seqs }),
        LibraryErrorCode::Conflict,
        id,
    );
    let merged = shell.call(
        "import_merge_sessions",
        &json!({ "id": id, "expectedRevision": preview["revision"], "seqs": seqs }),
    );
    assert_eq!(sizes(&merged["sessions"]), [3]);
    assert_eq!(merged["sessions"][0]["merged"], json!(true));

    shell.refuses(
        "import_resplit_session",
        &json!({ "id": id, "expectedRevision": preview["revision"], "seq": seqs[0] }),
        LibraryErrorCode::Conflict,
        id,
    );
    let resplit = shell.call(
        "import_resplit_session",
        &json!({ "id": id, "expectedRevision": merged["revision"], "seq": seqs[0] }),
    );
    assert_eq!(sizes(&resplit["sessions"]), [2, 1], "the split by framing returns");
    shell.refuses(
        "import_resplit_session",
        &json!({ "id": id, "expectedRevision": resplit["revision"], "seq": seqs[0] }),
        LibraryErrorCode::InvalidInput,
        id,
    );
}

#[test]
fn the_split_preview_and_the_import_limits_take_their_arguments() {
    let shell = Shell::new();
    let preview = shell.preview();
    let id = id_of(&preview);
    assert_eq!(
        preview["splitLimits"],
        json!({ "maxCentreOffsetArcmin": 5.0, "maxRotationDeg": 5.0 })
    );
    assert_eq!(preview["splitOverridden"], json!(false));

    let wide = json!({ "maxCentreOffsetArcmin": 10.0, "maxRotationDeg": 5.0 });
    let split = shell.call("import_split_preview", &json!({ "id": id, "limits": wide }));
    assert_eq!(sizes(&split), [3], "10′ holds all three");
    let narrow = json!({ "maxCentreOffsetArcmin": 0.2, "maxRotationDeg": 5.0 });
    let split = shell.call("import_split_preview", &json!({ "id": id, "limits": narrow }));
    assert_eq!(sizes(&split), [1, 1, 1]);
    let status = shell.call("import_status", &json!({ "id": id }));
    assert_eq!(status["revision"], preview["revision"], "a split preview saves nothing");
    shell.refuses(
        "import_split_preview",
        &json!({ "id": id, "limits": { "maxCentreOffsetArcmin": -1.0, "maxRotationDeg": 5.0 } }),
        LibraryErrorCode::InvalidInput,
        id,
    );

    let saved = shell.call(
        "import_set_split_limits",
        &json!({ "id": id, "expectedRevision": preview["revision"], "limits": wide }),
    );
    assert_eq!(
        (saved["splitLimits"].clone(), saved["splitOverridden"].clone()),
        (wide, json!(true))
    );
    assert_eq!(sizes(&saved["sessions"]), [3]);
    let cleared = shell.call(
        "import_set_split_limits",
        &json!({ "id": id, "expectedRevision": saved["revision"], "limits": null }),
    );
    assert_eq!(cleared["splitOverridden"], json!(false), "back to the Settings default");
    assert_eq!(sizes(&cleared["sessions"]), [2, 1]);
}

#[test]
fn a_session_target_is_chosen_over_ipc() {
    let shell = Shell::new();
    let preview = shell.preview();
    let id = id_of(&preview);
    assert_eq!(preview["sessions"][0]["target"], Value::Null, "Unclassified is preselected");
    let seq = first_items(&preview)[0].clone();

    shell.refuses(
        "import_choose_target",
        &json!({
            "id": id,
            "expectedRevision": preview["revision"],
            "seq": seq,
            "targetId": Uuid::new_v4(),
        }),
        LibraryErrorCode::NotFound,
        id,
    );
    let chosen = shell.call(
        "import_choose_target",
        &json!({ "id": id, "expectedRevision": preview["revision"], "seq": seq, "targetId": null }),
    );
    assert_eq!(chosen["sessions"][0]["targetChosen"], json!(true), "Unclassified, chosen");
    assert_eq!(chosen["sessions"][0]["target"], Value::Null);
}

#[test]
fn the_import_list_reads_started_imports_by_state_over_ipc() {
    let shell = Shell::new();
    let preview = shell.preview();
    let id = id_of(&preview);
    let every = json!({ "states": ["running", "interrupted", "failed", "partial", "settled"] });
    assert_eq!(shell.call("import_list", &every), json!([]), "a preview is never listed");

    let library = Arc::clone(shell.webview.state::<Arc<Library>>().inner());
    let revision = preview["revision"].as_u64().expect("revision");
    tauri::async_runtime::block_on(library.start_import(id, revision, ImportMode::Copy))
        .expect("start the import");
    let listed = shell.call("import_list", &every);
    assert_eq!(listed.as_array().map(Vec::len), Some(1), "{listed}");
    let row = &listed[0];
    assert_eq!(row["id"], json!(id));
    assert_eq!(row["state"], json!("running"));
    assert_eq!(row["sourcePath"], preview["sourcePath"]);
    assert_eq!(row["summary"]["pending"], preview["summary"]["ready"], "{row}");
    assert!(row["updatedAt"].is_string(), "{row}");
    assert_eq!(shell.call("import_list", &json!({ "states": ["settled"] })), json!([]));

    let refused =
        shell.invoke("import_list", &json!({ "states": ["previewed"] })).expect_err("previewed");
    assert!(refused.is_string(), "a state the list never reads is refused: {refused}");
}
