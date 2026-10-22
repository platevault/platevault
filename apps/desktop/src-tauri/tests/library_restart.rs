// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 library shell commits a Project's View through IPC and keeps it
//! across a restart (WIRE acceptance: real IPC commit and restart).
//!
//! One journey over a temporary library on disk. Every step is a registered
//! library-shell command, run through Tauri's mock runtime with JSON arguments
//! as the webview sends them. The shell's first life:
//! 1. Register a Calibration and a Captures location of real FITS frames and
//!    scan both.
//! 2. Save the Target and the rig, and confirm both on the light session.
//! 3. Reassign its darks, flats and bias to the scanned raw sets.
//! 4. Mark its frames Usable and finish its review.
//! 5. Create the Project, add the session, choose Copies and the processing
//!    location, and Apply it. Copies needs no symlink privilege on any
//!    platform.
//!
//! The first life runs in a child process of this test binary. A mock app
//! never drops the state it manages, so only the process exit drops its app
//! and Library completely, as quitting `PlateVault` does. The test then
//! rebuilds the shell over the same data directory, and IPC alone shows that:
//! - the Project, its membership and the installed View manifest survived;
//! - Home reads "Open in {app}";
//! - Apply has nothing to change.

#[path = "../../../../crates/platevault-core/tests/support/scan.rs"]
mod scan_support;
mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use desktop_shell::library_shell::CATALOG_FILE;
use fits_fixtures::FitsFixture;
use platevault_core::library::Library;
use platevault_core::{NativePath, ScanState};
use scan_support::ScanWatch;
use serde_json::{json, Value};
use support::Ipc;
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// The test the child process runs: its first life.
const TEST: &str = "an_applied_project_survives_a_restart_and_apply_has_nothing_to_change";
/// Set only in the child: the temporary root its first life works in.
const FIRST_LIFE_ENV: &str = "PV_TEST_LIBRARY_RESTART_ROOT";
const PROJECT: &str = "NGC 7000";
/// How long a scan or calibration matching may take before the test fails.
/// Only a hang should fail: on a loaded machine one catalog write took 16 s.
const PATIENCE: Duration = Duration::from_secs(300);

/// The library shell over the catalog in `data_dir`, opened as a start opens
/// it: `Library::open` on `<data dir>/catalog.sqlite`, which settles what an
/// earlier run left of Apply and of calibration matching, managed before the
/// `library` window exists, with the running Applies and Closes the shell
/// manages. Only the handlers this journey calls are registered.
struct Shell {
    webview: WebviewWindow<MockRuntime>,
    _app: tauri::App<MockRuntime>,
}

impl Shell {
    fn open(data_dir: &Path) -> Self {
        // Opened on Tauri's runtime, where the handlers run, so the catalog's
        // connections belong to it.
        let library =
            tauri::async_runtime::block_on(Library::open(&data_dir.join(CATALOG_FILE), None))
                .expect("open library");
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![
                desktop_shell::commands::library::library_register_location,
                desktop_shell::commands::library::library_start_scan,
                desktop_shell::commands::library::library_scan_status,
                desktop_shell::commands::library::library_list_sessions,
                desktop_shell::commands::library::library_session,
                desktop_shell::commands::library::library_set_quality,
                desktop_shell::commands::library::library_save_target,
                desktop_shell::commands::library::library_associate_target,
                desktop_shell::commands::library::library_save_equipment,
                desktop_shell::commands::library::library_confirm_equipment,
                desktop_shell::commands::calibration_inputs::calibration_list_inputs,
                desktop_shell::commands::session_calibration::calibration_reassign,
                desktop_shell::commands::frame_review::pix_session_intake,
                desktop_shell::commands::frame_review::pix_finish_review,
                desktop_shell::commands::project_goals::project_create,
                desktop_shell::commands::project_goals::project_list,
                desktop_shell::commands::project_inputs::project_inputs,
                desktop_shell::commands::project_inputs::project_add_sessions,
                desktop_shell::commands::project_inputs::project_set_view_settings,
                desktop_shell::commands::project_apply::project_apply_preview,
                desktop_shell::commands::project_apply::project_apply,
                desktop_shell::commands::home::home_dashboard,
            ])
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        app.manage(library);
        support::manage_runs(&app);
        let webview = WebviewWindowBuilder::new(&app, "library", WebviewUrl::default())
            .build()
            .expect("library window");
        Self { webview, _app: app }
    }

    fn register(&self, root: &Path, name: &str, role: &str) -> Value {
        let location = self.call(
            "library_register_location",
            &json!({ "path": native(root), "displayName": name, "role": role }),
        );
        location["id"].clone()
    }

    /// Scan the whole location through IPC and wait for the scan's terminal
    /// event. The stored status turns terminal at the scan's commit, before
    /// its target suggestions and calibration matching run; the event follows
    /// them, and the webview then reads the finished scan through IPC.
    fn scan(&self, location: &Value) {
        let watch = ScanWatch::new(&self.webview.state::<Arc<Library>>());
        let started = self.call("library_start_scan", &json!({ "locationId": location }));
        let id = serde_json::from_value(started["id"].clone()).expect("scan id");
        let finished = tauri::async_runtime::block_on(watch.terminal(id, PATIENCE));
        assert_eq!(finished.state, ScanState::Completed, "{finished:?}");
        let status = self.call("library_scan_status", &json!({ "operationId": started["id"] }));
        assert_eq!(status["state"], "completed", "{status:#}");
    }

    fn intake(&self, session: &Value) -> Value {
        self.call("pix_session_intake", &json!({ "sessionId": session }))
    }

    fn sessions(&self, location: &Value) -> Vec<Value> {
        let listed = self.call(
            "library_list_sessions",
            &json!({
                "locationId": location,
                "includeSuperseded": null,
                "filter": null,
                "offset": 0,
                "limit": 50,
            }),
        );
        listed.as_array().expect("session list").clone()
    }

    /// The session as a decision names it: its grouping and decision revisions.
    fn expected_session(&self, location: &Value, session: &Value) -> Value {
        let listed = self.sessions(location);
        let summary = listed
            .iter()
            .find(|summary| summary["session"]["id"] == *session)
            .unwrap_or_else(|| panic!("session {session} is not listed: {listed:#?}"));
        json!({
            "sessionId": session,
            "groupingRevision": summary["session"]["groupingRevision"],
            "decisionRevision": summary["session"]["decisionRevision"],
        })
    }

    fn sheet(&self, project: &Value) -> Value {
        self.call("project_apply_preview", &json!({ "projectId": project }))
    }

    /// Apply the sheet as reviewed, ticking no foreign file.
    fn apply(&self, sheet: &Value) -> Value {
        self.call(
            "project_apply",
            &json!({ "request": {
                "projectId": sheet["projectId"],
                "desiredRevision": sheet["desiredRevision"],
                "basisDigest": sheet["basisDigest"],
                "ticked": [],
            } }),
        )
    }

    fn project_inputs(&self, project: &Value) -> Value {
        self.call("project_inputs", &json!({ "projectId": project }))
    }

    /// The Project's row on Home, with its pending changes and Next action.
    fn home(&self, project: &Value) -> Value {
        let tonight = json!({
            "night": null,
            "criteria": {
                "minAltitudeDeg": 30.0,
                "darkness": "astronomical",
                "moon": { "kind": "none" },
                "minDurationMinutes": 30,
            },
        });
        let home = self.call("home_dashboard", &json!({ "tonight": tonight }));
        let projects = home["projects"].as_array().expect("Home projects");
        let [row] = projects.as_slice() else { panic!("one open Project on Home: {home:#}") };
        assert_eq!(row["project"]["id"], *project, "{row:#}");
        row.clone()
    }
}

impl Ipc for Shell {
    fn webview(&self) -> &WebviewWindow<MockRuntime> {
        &self.webview
    }
}

/// Where everything of the journey lives under one temporary root.
struct Layout {
    root: PathBuf,
    data_dir: PathBuf,
    captures: PathBuf,
    calibration: PathBuf,
    processing: PathBuf,
}

impl Layout {
    fn new(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            data_dir: root.join("library-rebuild"),
            captures: root.join("Astro-T7/Captures"),
            calibration: root.join("Astro-T7/Calibration"),
            processing: root.join("Work/Processing"),
        }
    }

    /// What the first life leaves for the restart to compare against.
    fn record(&self) -> PathBuf {
        self.root.join("first-life.json")
    }

    /// The night of 12 Oct 2026: two Ha lights, and two each of its darks,
    /// its flats (taken the next morning) and its bias.
    fn write_frames(&self) {
        for (name, start) in [("Light_001.fits", "22:00:00"), ("Light_002.fits", "22:06:00")] {
            let path = self.captures.join("2026-10-12").join(name);
            frame(&path, "LIGHT", Some("Ha"), 300.0, &format!("2026-10-12T{start}"));
        }
        for (index, start) in ["14:00:00", "14:06:00"].iter().enumerate() {
            let n = index + 1;
            let dark = self.calibration.join(format!("darks/Dark_300s_00{n}.fits"));
            frame(&dark, "DARK", None, 300.0, &format!("2026-10-12T{start}"));
            let bias = self.calibration.join(format!("bias/Bias_00{n}.fits"));
            frame(&bias, "BIAS", None, 0.0, &format!("2026-10-12T{start}"));
            let flat = self.calibration.join(format!("flats/Ha/Flat_Ha_00{n}.fits"));
            frame(&flat, "FLAT", Some("Ha"), 2.0, &format!("2026-10-13T06:0{n}:00"));
        }
    }
}

/// A path as the webview sends it.
fn native(path: &Path) -> Value {
    serde_json::to_value(NativePath::from_path(path)).expect("path JSON")
}

fn path_of(value: &Value) -> NativePath {
    serde_json::from_value(value.clone()).unwrap_or_else(|error| panic!("{value}: {error}"))
}

/// One FITS frame from the rig's ASI2600MM at gain 100.
fn frame(path: &Path, image_type: &str, filter: Option<&str>, exposure: f64, start: &str) {
    fs::create_dir_all(path.parent().expect("frame folder")).expect("create frame folder");
    let fixture = FitsFixture::new()
        .card("SIMPLE  =                    T")
        .card("BITPIX  =                   16")
        .card("NAXIS   =                    0")
        .imagetyp(image_type)
        .exptime(exposure)
        .gain(100.0)
        .instrume("ASI2600MM")
        .telescop("RedCat 51")
        .date_obs(start);
    match filter {
        Some(filter) => fixture.filter(filter),
        None => fixture,
    }
    .write(path);
}

/// Every file under `folder` by its relative path, with its bytes. Each one
/// is a regular file: Copies mode places no link.
fn tree(folder: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut files = BTreeMap::new();
    let mut folders = vec![folder.to_path_buf()];
    while let Some(current) = folders.pop() {
        for entry in fs::read_dir(&current).expect("read View folder") {
            let path = entry.expect("View entry").path();
            let kind = fs::symlink_metadata(&path).expect("View entry metadata").file_type();
            if kind.is_dir() {
                folders.push(path);
                continue;
            }
            assert!(kind.is_file(), "{} is a copy, not a link", path.display());
            let relative = path.strip_prefix(folder).expect("under the View").to_path_buf();
            files.insert(relative, fs::read(&path).expect("read placed copy"));
        }
    }
    files
}

/// The sheet's entries by path relative to `View/`; no two share one.
fn entry_paths(sheet: &Value) -> BTreeSet<PathBuf> {
    let entries = sheet["entries"].as_array().expect("sheet entries");
    let paths: BTreeSet<PathBuf> = entries
        .iter()
        .map(|entry| path_of(&entry["path"]).relative_path().expect("relative entry path"))
        .collect();
    assert_eq!(paths.len(), entries.len(), "each entry has its own path: {sheet:#}");
    paths
}

/// The sheet's `View/` folder, in its Project folder.
fn view_of(sheet: &Value) -> PathBuf {
    path_of(&sheet["projectFolder"]).to_path_buf().expect("Project folder").join("View")
}

#[test]
fn an_applied_project_survives_a_restart_and_apply_has_nothing_to_change() {
    if let Some(root) = std::env::var_os(FIRST_LIFE_ENV) {
        let layout = Layout::new(Path::new(&root));
        let record = first_life(&layout);
        fs::write(layout.record(), record.to_string()).expect("write the first life's record");
        return;
    }
    let temp = tempfile::tempdir().expect("temp dir");
    let layout = Layout::new(temp.path());
    for folder in [&layout.data_dir, &layout.processing] {
        fs::create_dir_all(folder).expect("create folder");
    }
    layout.write_frames();
    let status = Command::new(std::env::current_exe().expect("this test binary"))
        .args([TEST, "--exact", "--nocapture"])
        .env(FIRST_LIFE_ENV, temp.path())
        .status()
        .expect("start the first life");
    assert!(status.success(), "the first life failed ({status}); its output is above");
    let record = fs::read(layout.record()).expect("the first life left its record");
    after_restart(&layout, &serde_json::from_slice(&record).expect("record JSON"));
}

/// The light session, Ready and settled, with the Target and rig it took.
struct Intake {
    session: Value,
    target: Value,
    rig: Value,
}

/// Scan both locations, then take the light session through its intake:
/// Target, rig, every calibration kind pinned and its review finished.
fn intake(shell: &Shell, layout: &Layout) -> Intake {
    // The calibration library first, so the lights are matched as they arrive.
    let calibration = shell.register(&layout.calibration, "Calibration", "calibration");
    shell.scan(&calibration);
    let captures = shell.register(&layout.captures, "Captures", "captures");
    shell.scan(&captures);
    let lights = shell.sessions(&captures);
    let [light] = lights.as_slice() else { panic!("one light session: {lights:#?}") };
    assert_eq!(light["assetCount"], 2, "{light:#}");
    let session = light["session"]["id"].clone();
    // The captures scan's terminal event follows its calibration matching.
    let matching = &shell.intake(&session)["calibration"]["matchingPending"];
    assert_eq!(*matching, false, "matching has run for session {session}");

    let target = shell.call(
        "library_save_target",
        &json!({
            "target": {
                "source": "user",
                "designation": PROJECT,
                "objectType": "emission_nebula",
                "coordinates": { "raDeg": 314.75, "decDeg": 44.33, "frame": "icrs" },
            },
            "expectedRevision": null,
        }),
    )["candidate"]["id"]
        .clone();
    shell.call(
        "library_associate_target",
        &json!({ "expected": [shell.expected_session(&captures, &session)], "targetId": target }),
    );
    let rig = shell.call(
        "library_save_equipment",
        &json!({
            "equipment": {
                "id": null,
                "name": "RedCat 51",
                "camera": "ASI2600MM",
                "telescope": "RedCat 51",
                "focalLengthMm": 250.0,
                "pixelSizeUm": 3.76,
                "sensorWidthPx": 6248,
                "sensorHeightPx": 4176,
                "colorKind": "mono",
            },
            "expectedRevision": null,
        }),
    )["id"]
        .clone();
    shell.call(
        "library_confirm_equipment",
        &json!({ "expected": [shell.expected_session(&captures, &session)], "equipmentId": rig }),
    );

    // Each kind pinned to the one raw set the Calibration scan found.
    for kind in ["dark", "flat", "bias"] {
        let listed = shell.call(
            "calibration_list_inputs",
            &json!({
                "kind": kind,
                "form": "raw_set",
                "locationId": calibration,
                "offset": 0,
                "limit": 10,
            }),
        );
        let [raw_set] = listed.as_array().expect("inputs").as_slice() else {
            panic!("one {kind} raw set: {listed:#}")
        };
        let generation = shell.intake(&session)["calibration"]["generation"].clone();
        let pinned = shell.call(
            "calibration_reassign",
            &json!({
                "sessionId": session,
                "kind": kind,
                "input": raw_set["input"],
                "expectedGeneration": generation,
            }),
        );
        assert_eq!(pinned[kind]["state"], "pinned", "{pinned:#}");
    }

    // Every frame Usable, then Finish review.
    let detail = shell.call("library_session", &json!({ "sessionId": session }))["detail"].clone();
    let unreviewed: Vec<Value> = detail["assets"]
        .as_array()
        .expect("session assets")
        .iter()
        .filter(|asset| asset["quality"] == "unreviewed")
        .map(|asset| {
            json!({
                "assetId": asset["id"],
                "decisionRevision": asset["decisionRevision"],
                "fingerprint": asset["fingerprint"],
            })
        })
        .collect();
    assert_eq!(unreviewed.len(), 2, "{detail:#}");
    shell.call("library_set_quality", &json!({ "expected": unreviewed, "state": "usable" }));
    let grouping = shell.intake(&session)["intake"]["groupingRevision"].clone();
    shell.call(
        "pix_finish_review",
        &json!({ "sessionId": session, "expectedGroupingRevision": grouping }),
    );
    Intake { session, target, rig }
}

/// The shell's first life, in the child process: the intake, the Project and
/// its first Apply. It returns what the restart compares against.
fn first_life(layout: &Layout) -> Value {
    let shell = Shell::open(&layout.data_dir);
    let Intake { session, target, rig } = intake(&shell, layout);
    let admission = shell.intake(&session);
    assert_eq!(admission["blockers"], json!([]), "the session can join: {admission:#}");

    let created = shell.call(
        "project_create",
        &json!({
            "name": PROJECT,
            "notes": null,
            "subjects": [{ "targetId": target }],
            "rigIds": [rig],
            "goals": [],
        }),
    );
    let project = created["id"].clone();
    let added = shell.call(
        "project_add_sessions",
        &json!({
            "projectId": project,
            "expectedRevision": created["revision"],
            "sessions": [{
                "sessionId": session,
                "expected": {
                    "groupingRevision": admission["intake"]["groupingRevision"],
                    "calibrationGeneration": admission["calibration"]["generation"],
                },
            }],
            "groupId": null,
        }),
    );
    let members = added["sessions"].as_array().expect("members");
    assert!(members.iter().any(|member| member["sessionId"] == session), "{added:#}");

    let chosen = shell.call(
        "project_set_view_settings",
        &json!({
            "projectId": project,
            "expectedRevision": added["revision"],
            "settings": {
                "mode": "copies",
                "keywords": null,
                "profileId": null,
                "parent": native(&layout.processing),
            },
        }),
    );
    assert_eq!(chosen["settings"]["mode"], "copies", "{chosen:#}");
    let before = shell.home(&project);
    assert_eq!(before["pendingChanges"], 0, "{before:#}");
    assert_eq!(before["next"], json!({ "kind": "add_sessions" }), "no View yet: {before:#}");

    let sheet = shell.sheet(&project);
    assert_eq!(sheet["blockers"], json!([]), "{sheet:#}");
    assert_eq!(sheet["mode"], "copies");
    assert_eq!(sheet["appliedGeneration"], Value::Null, "the first Apply");
    let entries = sheet["entries"].as_array().expect("sheet entries");
    // On one clone-capable volume a Copies entry is a clone (PREP-FR-04).
    let own_files = ["copy", "clone"];
    assert!(
        entries
            .iter()
            .all(|entry| own_files.iter().any(|kind| entry["placement"]["kind"] == *kind)),
        "{sheet:#}"
    );
    assert_eq!(sheet["footprint"]["frames"], entries.len(), "{sheet:#}");
    let lights = entries.iter().filter(|entry| entry["source"]["source"] == "light").count();
    assert_eq!(lights, 2, "{sheet:#}");
    for kind in ["dark", "flat", "bias"] {
        let frames = entries
            .iter()
            .filter(|entry| {
                entry["source"]["source"] == "calibration_frame" && entry["source"]["kind"] == kind
            })
            .count();
        assert_eq!(frames, 2, "both {kind} frames are placed: {sheet:#}");
    }
    let applied = shell.apply(&sheet);
    assert_eq!(applied["outcome"], "applied", "{applied:#}");
    assert_eq!(applied["failures"], json!([]), "{applied:#}");
    assert_eq!(applied["stop"], Value::Null, "{applied:#}");
    let placed = tree(&view_of(&sheet));
    let paths: BTreeSet<PathBuf> = placed.keys().cloned().collect();
    assert_eq!(paths, entry_paths(&sheet), "{placed:#?}");
    let inputs = shell.project_inputs(&project);
    assert_eq!(inputs["pending"], json!([]), "{inputs:#}");
    assert_eq!(shell.home(&project)["next"], json!({ "kind": "open_view" }));

    let placed: Vec<Value> = placed
        .iter()
        .map(|(path, bytes)| json!({ "path": native(path), "bytes": bytes }))
        .collect();
    json!({ "sheet": sheet, "applied": applied, "inputs": inputs, "placed": placed })
}

/// The View the first life placed, by relative path, with its bytes.
fn placed_by(record: &Value) -> BTreeMap<PathBuf, Vec<u8>> {
    record["placed"]
        .as_array()
        .expect("placed files")
        .iter()
        .map(|file| {
            let path = path_of(&file["path"]).relative_path().expect("relative path");
            let bytes = serde_json::from_value(file["bytes"].clone()).expect("file bytes");
            (path, bytes)
        })
        .collect()
}

/// The rebuilt shell over the first life's data directory.
fn after_restart(layout: &Layout, record: &Value) {
    let shell = Shell::open(&layout.data_dir);
    let project = &record["sheet"]["projectId"];
    project_survives(&shell, record);
    let sheet = manifest_survives(&shell, record);
    let home = shell.home(project);
    assert_eq!(home["pendingChanges"], 0, "{home:#}");
    assert_eq!(home["next"], json!({ "kind": "open_view" }), "Home's Next action: {home:#}");
    nothing_to_change(&shell, record, &sheet);
}

/// The Project and its membership survive, with the desired state as it was.
fn project_survives(shell: &Shell, record: &Value) {
    let project = &record["sheet"]["projectId"];
    let listed = shell.call(
        "project_list",
        &json!({ "targetId": null, "includeClosed": null, "offset": 0, "limit": 50 }),
    );
    let [summary] = listed.as_array().expect("Projects").as_slice() else {
        panic!("one Project: {listed:#}")
    };
    assert_eq!((&summary["id"], &summary["name"]), (project, &json!(PROJECT)), "{summary:#}");
    let desired = &shell.project_inputs(project)["desired"];
    assert_eq!(desired, &record["inputs"]["desired"], "the desired state survives as it was");
    assert_eq!(desired["settings"]["mode"], "copies");
}

/// The installed manifest survives: the Apply sheet names its generation,
/// and it accounts for every file in `View/` exactly as it was placed. The
/// sheet is returned for the next Apply.
fn manifest_survives(shell: &Shell, record: &Value) -> Value {
    let (first, applied) = (&record["sheet"], &record["applied"]);
    let sheet = shell.sheet(&first["projectId"]);
    assert_eq!(sheet["appliedGeneration"], applied["generation"], "{sheet:#}");
    for same in ["desiredRevision", "projectFolder", "mode", "entries"] {
        assert_eq!(sheet[same], first[same], "{same} is the installed View's: {sheet:#}");
    }
    for empty in ["blockers", "foreign", "changedCopies", "leftovers"] {
        assert_eq!(sheet[empty], json!([]), "{empty}: {sheet:#}");
    }
    assert_eq!(tree(&view_of(&sheet)), placed_by(record), "the View is as Apply left it");
    sheet
}

/// Nothing to change: no change is pending, and Apply rebuilds the View it
/// already holds, moves no foreign file and leaves nothing behind.
fn nothing_to_change(shell: &Shell, record: &Value, sheet: &Value) {
    let project = &sheet["projectId"];
    assert_eq!(shell.project_inputs(project)["pending"], json!([]), "no change is pending");
    let reapplied = shell.apply(sheet);
    assert_eq!(reapplied["outcome"], "applied", "{reapplied:#}");
    let next = record["applied"]["generation"].as_u64().expect("generation") + 1;
    assert_eq!(reapplied["generation"], next, "{reapplied:#}");
    for empty in ["failures", "foreign", "leftovers"] {
        assert_eq!(reapplied[empty], json!([]), "{empty}: {reapplied:#}");
    }
    assert_eq!(reapplied["stop"], Value::Null, "{reapplied:#}");
    let view = view_of(sheet);
    assert_eq!(tree(&view), placed_by(record), "the rebuilt View holds the same copies");
    let previous = view.with_file_name("View (previous)");
    assert!(!previous.exists(), "every verified old copy was retired");
    assert_eq!(shell.project_inputs(project)["pending"], json!([]));
    assert_eq!(shell.home(project)["next"], json!({ "kind": "open_view" }));
}
