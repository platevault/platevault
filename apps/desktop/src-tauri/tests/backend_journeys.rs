// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Real-backend journeys that used to live in the Layer-2 real-UI suite
//! (`crates/e2e-tests/tests/journeys.rs` and `archive_journeys.rs`, #1227).
//!
//! Those journeys booted the whole `desktop_shell` app under `WebDriver` and
//! then read no DOM at all: every step went through the
//! `window.__PV_E2E__.invoke` bridge. Here each one calls the same
//! `#[tauri::command]` functions directly, against a [`Backend`] that wires
//! the subset of `desktop_shell`'s `boot` they depend on: a real migrated
//! `SQLite` file, the real `EventBus`, a resolve cache warmed with the same
//! e2e seed the real-UI harness pre-warms, the inbox plan listener, the
//! ingest-resolution backstop drain, and the real filesystem.
//!
//! Each call is a direct Rust call: [`args`] checks deserialization of the
//! inner DTO JSON and [`wire`] serializes the returned DTO before assertions.
//! This does NOT exercise Tauri's invoke handler, runtime command dispatch,
//! or the frontend's top-level argument keys. `tests/bindings.rs` exports
//! the production `specta_builder` command set and checks an explicit subset
//! of command names in generated bindings (not the entire set). Several
//! commands used below are not in that explicit subset; runtime IPC dispatch
//! and argument-key coverage are open gaps.
//!
//! The real-UI halves stay in the real-UI suite: the fresh-DB redirect to
//! `/setup` that `first_run_resolve_create_project` used to check is asserted
//! by every journey there that calls `settle_first_run_redirect`.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use audit::bus::EventBus;
use contracts_core::JsonAny;
use persistence_core::Database;
use persistence_lifecycle::repositories::lifecycle::SqliteLifecycleRepository;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use targeting_resolver::simbad::ResolveCache;
use tauri::test::MockRuntime;
use tauri::{Manager, State};

use desktop_shell::commands::artifacts::{artifact_list, artifact_watcher_attach};
use desktop_shell::commands::calibration::calibration_match_suggest;
use desktop_shell::commands::cleanup::{
    cleanup_plan_generate, cleanup_policy_update, cleanup_scan,
};
use desktop_shell::commands::firstrun::firstrun_state;
use desktop_shell::commands::inbox::{
    inbox_classify, inbox_classify_source_group, inbox_confirm, inbox_list, inbox_plan_apply,
    inbox_scan_folder,
};
use desktop_shell::commands::lifecycle::{
    lifecycle_ledger_list, lifecycle_transition_apply, AppState,
};
use desktop_shell::commands::plan_apply::{plans_apply_direct, plans_apply_status};
use desktop_shell::commands::plans::{
    archive_list, archive_permanently_delete, archive_plan_generate, archive_send_to_trash,
    plans_approve,
};
use desktop_shell::commands::projects::{projects_create, projects_list};
use desktop_shell::commands::protection::source_protection_set;
use desktop_shell::commands::roots::{roots_register, sources_set_organization_state};
use desktop_shell::commands::search::search_global;
use desktop_shell::commands::sessions::sessions_list;
use desktop_shell::commands::settings::settings_update;
use desktop_shell::commands::target_lookup::target_resolve;
use desktop_shell::watcher::{new_artifact_watcher_registry, ArtifactWatcherRegistry};

/// Budget for a poll on work the backend finishes asynchronously (plan
/// executor, artifact watcher reconciliation, archive closure).
const INVOKE_TIMEOUT: Duration = Duration::from_secs(30);

/// Budget for a poll that may depend on the 30 s ingest-resolution backstop
/// drain (`apps/desktop/src-tauri/src/bootstrap/background.rs`): three of its
/// periods, as the real-UI suite allows for the same wait (#1205).
const DRAIN_BACKED_TIMEOUT: Duration = Duration::from_secs(90);

/// The ingest-resolution backstop's period in `boot`.
const DRAIN_INTERVAL: Duration = Duration::from_secs(30);

const POLL_INTERVAL: Duration = Duration::from_millis(200);

/// The plan states `plans.apply.status` can settle in.
const TERMINAL_PLAN_STATES: [&str; 4] = ["applied", "partially_applied", "failed", "cancelled"];
// `app_core_cache` retains a deprecated protection-default snapshot that is
// process-global and unkeyed by database. The inbox-apply, cleanup, and
// archive journeys exercise that DB-backed path, so serialize those three and
// reset it via the normal settings use case before asserting migration defaults.
static PROTECTION_DEFAULTS_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

// ─── Harness ────────────────────────────────────────────────────────────────

/// The managed state `desktop_shell`'s `boot` gives every command, without a
/// window or a webview.
struct Backend {
    app: tauri::App<MockRuntime>,
    /// Owns the database file and the resolve-cache path for the test's life.
    _data_dir: tempfile::TempDir,
}

impl Backend {
    async fn start() -> Self {
        let data_dir = tempfile::tempdir().expect("app data dir");
        // The same URL shape `main.rs` builds for the real app database.
        let db_url = format!("sqlite://{}?mode=rwc", data_dir.path().join("alm.db").display());
        let db = Database::connect(&db_url).await.expect("open the SQLite database");
        db.migrate().await.expect("run migrations");
        let pool = db.pool().clone();
        let bus = EventBus::with_pool(pool.clone());

        let resolve_cache = warmed_resolve_cache().await;
        app_core::inbox::plan_listener::start_inbox_plan_listener(
            pool.clone(),
            &bus,
            resolve_cache.clone(),
        );
        spawn_ingest_resolution_backstop(pool.clone(), bus.clone(), resolve_cache.clone());

        let repo = Arc::new(SqliteLifecycleRepository::new(pool.clone(), bus.clone()));
        let state = AppState::new(
            repo,
            bus,
            app_core::AppCaches::shared(),
            resolve_cache,
            data_dir.path().join("simbad-cache.redb"),
            Arc::new(AtomicBool::new(false)),
        );

        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app");
        // Inbox, inventory and watcher commands take the raw pool and the
        // watcher registry as their own managed state, as in `boot`.
        app.manage(pool);
        app.manage(new_artifact_watcher_registry());
        app.manage(state);
        Self { app, _data_dir: data_dir }
    }

    fn state(&self) -> State<'_, AppState> {
        self.app.state::<AppState>()
    }

    fn pool(&self) -> State<'_, sqlx::SqlitePool> {
        self.app.state::<sqlx::SqlitePool>()
    }

    fn watchers(&self) -> State<'_, ArtifactWatcherRegistry> {
        self.app.state::<ArtifactWatcherRegistry>()
    }
}

/// Reset the DB-backed protection defaults while holding
/// `PROTECTION_DEFAULTS_TEST_LOCK`. The production compatibility cache is
/// process-global and unkeyed by database; `set_global_protection_default`
/// invalidates it after each call, even when the value already matches.
async fn reset_protection_defaults(be: &Backend) {
    let state = be.app.state::<AppState>();
    for (key, value) in
        [("defaultProtection", json!("protected")), ("blockPermanentDelete", json!(true))]
    {
        app_core::protection::set_global_protection_default(
            state.repo.pool(),
            &state.bus,
            "global",
            key,
            value,
        )
        .await
        .unwrap_or_else(|error| panic!("reset protection default {key}: {error:?}"));
    }
}

/// An in-memory resolve cache holding the e2e seed (~200 entries, M 31 among
/// them), the same seed the real-UI harness pre-warms, so resolving "M 31" is
/// a deterministic, network-free cache hit.
async fn warmed_resolve_cache() -> ResolveCache {
    let resolve_cache = ResolveCache::in_memory().expect("in-memory resolve cache");
    let seed = targeting_resolver::seed::bundled_e2e().expect("parse the e2e seed asset");
    let namespace = simbad_resolver::identity::namespace("astro-plan.targets");
    targeting_resolver::seed::warm_cache(&resolve_cache.cache(), &seed, &namespace)
        .await
        .expect("warm the e2e seed into the resolve cache");
    resolve_cache
}

/// `boot`'s backstop ingest-resolution drain. The plan-applied event path
/// runs the same pass immediately; this loop catches what that path misses.
fn spawn_ingest_resolution_backstop(pool: sqlx::SqlitePool, bus: EventBus, cache: ResolveCache) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(DRAIN_INTERVAL).await;
            let _summary =
                app_core::ingest_resolution::drain_and_backfill_once(&pool, &bus, &cache).await;
        }
    });
}

/// Deserialize the inner DTO argument from the same JSON payload values the
/// removed IPC journeys used. Direct command calls do not test Tauri's
/// top-level argument keys.
fn args<T: DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("argument JSON must match the command DTO shape")
}

/// Serialize a successful command response to the JSON shape the old IPC
/// journeys observed. This does not invoke Tauri's IPC layer.
fn wire<T: Serialize, E: std::fmt::Debug>(command: &str, result: Result<T, E>) -> Value {
    let value = result.unwrap_or_else(|e| panic!("{command} failed: {e:?}"));
    serde_json::to_value(value).expect("command response must serialize")
}

/// Re-run `probe` until `done` accepts its response or `timeout` elapses.
async fn poll_until<F, Fut>(
    what: &str,
    timeout: Duration,
    probe: F,
    done: impl Fn(&Value) -> bool,
) -> Value
where
    F: Fn() -> Fut,
    Fut: Future<Output = Value>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let value = probe().await;
        if done(&value) {
            return value;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "{what} did not settle within {timeout:?}; last response: {value}"
        );
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Poll `plans.apply.status` until the executor reaches a terminal state.
async fn wait_plan_terminal(be: &Backend, plan_id: &str) -> Value {
    poll_until(
        "plans.apply.status",
        INVOKE_TIMEOUT,
        || async {
            wire("plans.apply.status", plans_apply_status(be.state(), plan_id.to_owned()).await)
        },
        |v| v["planState"].as_str().is_some_and(|s| TERMINAL_PLAN_STATES.contains(&s)),
    )
    .await
}

/// Write a minimal single-block (2880-byte) FITS file with the given header
/// cards. Same card set and padding as the real-UI suite's
/// `write_minimal_fits_with_exposure`, so the real classifier and
/// session-grouping code accept it the same way. `EXPTIME` is a mandatory
/// attribute for lights, so a light fixture that must classify passes it.
fn write_minimal_fits(
    dir: &Path,
    name: &str,
    imagetyp: &str,
    object: &str,
    filter: &str,
    date_obs: &str,
    exposure_s: f64,
) -> PathBuf {
    let path = dir.join(name);
    let mut block = vec![b' '; 2880];
    let cards = [
        format!("IMAGETYP= '{imagetyp}'"),
        format!("OBJECT  = '{object}'"),
        format!("FILTER  = '{filter}'"),
        format!("DATE-OBS= '{date_obs}'"),
        format!("EXPTIME = {exposure_s}"),
        "GAIN    = 100".to_owned(),
        "XBINNING= 1".to_owned(),
        "YBINNING= 1".to_owned(),
        "END".to_owned(),
    ];
    for (idx, card) in cards.iter().enumerate() {
        let bytes = card.as_bytes();
        block[idx * 80..idx * 80 + bytes.len()].copy_from_slice(bytes);
    }
    std::fs::write(&path, &block).expect("write the fixture FITS file");
    path
}

/// Create a project with no sources and no linked target; returns its id.
async fn create_project(be: &Backend, request_id: &str, name: &str, dir: &Path) -> (String, Value) {
    let create = wire(
        "projects.create",
        projects_create(
            be.state(),
            args(json!({
                "requestId": request_id,
                "name": name,
                "tool": "PixInsight",
                "path": dir.to_string_lossy(),
                "initialSources": [],
                "notes": null,
                "canonicalTargetId": null,
            })),
        )
        .await,
    );
    let project_id = create["projectId"]
        .as_str()
        .unwrap_or_else(|| panic!("projects.create returned no projectId: {create}"))
        .to_owned();
    (project_id, create)
}

/// Mark `source_id` unprotected. The app's safe-by-default level is
/// "protected" (constitution II), and a project id has no override until a
/// caller sets one, so without this every cleanup or archive item refuses
/// apply with `protected.source`. A user sets this the same way in Settings.
async fn unprotect(be: &Backend, source_id: &str) {
    wire(
        "source.protection.set",
        source_protection_set(
            be.state(),
            args(json!({
                "sourceId": source_id,
                "level": "unprotected",
                "blockPermanentDelete": null,
                "categories": null,
            })),
        )
        .await,
    );
}

/// Attach the project's artifact watcher and wait for its attach-time
/// reconciliation to record the files already in the folder.
async fn attach_and_list_artifacts(be: &Backend, project_id: &str) -> Value {
    artifact_watcher_attach(
        be.pool(),
        be.state(),
        be.watchers(),
        args(json!({ "projectId": project_id })),
    )
    .await
    .expect("artifact.watcher.attach failed");
    poll_until(
        "artifact.list",
        INVOKE_TIMEOUT,
        || async {
            wire(
                "artifact.list",
                artifact_list(
                    be.state(),
                    args(json!({ "projectId": project_id, "includeStates": [] })),
                )
                .await,
            )
        },
        |v| v["artifacts"].as_array().is_some_and(|a| !a.is_empty()),
    )
    .await
}

/// True if a `.astro-plan-archive` subtree exists directly under `dir`.
fn has_archive_subtree(dir: &Path) -> bool {
    std::fs::read_dir(dir)
        .ok()
        .and_then(|mut entries| {
            entries.find(|e| e.as_ref().is_ok_and(|e| e.file_name() == ".astro-plan-archive"))
        })
        .is_some()
}

/// True if `root` exists and contains at least one file (recursively), so
/// archive-management side effects are asserted without hardcoding the
/// item-id-derived archive filename.
fn any_file_under(root: &Path) -> bool {
    fn walk(dir: &Path) -> bool {
        let Ok(entries) = std::fs::read_dir(dir) else { return false };
        entries.flatten().any(|entry| {
            let path = entry.path();
            if path.is_dir() {
                walk(&path)
            } else {
                path.is_file()
            }
        })
    }
    root.is_dir() && walk(root)
}

// ─── Journeys ───────────────────────────────────────────────────────────────

/// First-run state → offline target resolve (seed-cache hit) → project
/// creation linked to the resolved target.
///
/// Backend REAL: `firstrun.state`, `target.resolve`, `projects.create`,
/// `projects.list`.
///
/// Was `journeys.rs::first_run_resolve_create_project`. The old journey's
/// only UI read was the URL landing on `/setup`. This test calls
/// `firstrun.state` directly and checks the fresh DB response omits the
/// optional `completedAt` field and reports `lastStep = "source_folders"`.
/// It does not test the frontend redirect; the real-UI suite still does via
/// journeys that call `settle_first_run_redirect`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn first_run_resolve_create_project() {
    let be = Backend::start().await;

    let first_run = wire("firstrun.state", firstrun_state(be.state()).await);
    assert_eq!(
        first_run.get("completedAt"),
        None,
        "a fresh DB must omit the optional completedAt field: {first_run}"
    );
    assert_eq!(
        first_run["lastStep"], "source_folders",
        "a fresh DB must report the initial setup step: {first_run}"
    );

    let resolve = wire(
        "target.resolve",
        target_resolve(
            be.state(),
            args(json!({
                "contractVersion": "1.0",
                "requestId": "e2e-first-run-resolve",
                "query": "M 31",
                "override": null,
            })),
        )
        .await,
    );
    assert!(
        resolve["status"] == "resolved",
        "expected M 31 to resolve from the bundled offline seed cache: {resolve}"
    );
    let target = &resolve["target"];
    let target_id = target["targetId"]
        .as_str()
        .unwrap_or_else(|| panic!("resolved target has no targetId: {resolve}"))
        .to_owned();
    let ra_deg = target["raDeg"]
        .as_f64()
        .unwrap_or_else(|| panic!("resolved target has no raDeg: {resolve}"));
    assert!(
        (5.0..15.0).contains(&ra_deg),
        "M 31 RA out of the expected bundled-seed range (~10.68): {ra_deg}"
    );

    let project_dir = tempfile::tempdir().expect("project dir");
    let create = wire(
        "projects.create",
        projects_create(
            be.state(),
            args(json!({
                "requestId": "e2e-first-run-create",
                "name": "E2E M31 Project",
                "tool": "PixInsight",
                "path": project_dir.path().to_string_lossy(),
                "initialSources": [],
                "notes": null,
                "canonicalTargetId": target_id,
            })),
        )
        .await,
    );
    let project_id = create["projectId"]
        .as_str()
        .unwrap_or_else(|| panic!("projects.create returned no projectId: {create}"))
        .to_owned();

    let projects = wire("projects.list", projects_list(be.state(), None).await);
    let found = projects
        .as_array()
        .unwrap_or_else(|| panic!("projects.list did not return an array: {projects}"))
        .iter()
        .any(|p| p["id"] == project_id);
    assert!(found, "expected project {project_id} in projects.list: {projects}");
}

/// Inbox confirm → apply → ingest session grouping (event-driven) →
/// calibration suggest → global search by alias.
///
/// Backend REAL: `roots.register`, `sources.set_organization_state`,
/// `inbox.scan.folder`, `inbox.list`, `inbox.classify_source_group`,
/// `inbox.classify`, `inbox.confirm`, `plans.approve`, `inbox.plan.apply`
/// (whose plan-applied event drives the real `plan_listener` →
/// `ingest_light_frames` session-grouping pipeline, spec 035 US4),
/// `plans.apply.status`, `sessions.list`, `calibration.match.suggest`,
/// `search.global`.
///
/// Was `journeys.rs::ingestion_sessions_search`. It also carries the durable
/// apply proofs of the deleted `journeys.rs::plan_review_apply_with_audit`,
/// which drove this same chain: the plan reaches `applied` with at least one
/// recorded item and the source file leaves its original path. That
/// journey's UI-level counterpart is `inbox_ui_journeys.rs::
/// inbox_ui_confirm_does_not_move_then_apply_moves_to_shown_destination`.
///
/// The OBJECT header is "M 31", a seed entry, so the ingest pipeline's target
/// resolution is a network-free cache hit.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[allow(clippy::too_many_lines)]
async fn ingestion_sessions_search() {
    let _protection_defaults_lock = PROTECTION_DEFAULTS_TEST_LOCK.lock().await;
    let be = Backend::start().await;
    reset_protection_defaults(&be).await;

    let root_dir = tempfile::tempdir().expect("root dir");
    let root_path = root_dir.path().to_string_lossy().into_owned();
    let original_path = write_minimal_fits(
        root_dir.path(),
        "light_m31_001.fits",
        "Light Frame",
        "M 31",
        "Ha",
        "2026-01-11T21:30:00",
        300.0,
    );

    let register = wire(
        "roots.register",
        roots_register(
            be.state(),
            root_path.clone(),
            "light_frames".to_owned(),
            JsonAny::from(Value::Null),
        )
        .await,
    );
    let root_id = register["sourceId"]
        .as_str()
        .unwrap_or_else(|| panic!("roots.register returned no sourceId: {register}"))
        .to_owned();
    // `roots.register` defaults non-inbox sources to "organized", so nothing
    // would move. The journey needs a real move: "unorganized" is the real,
    // documented state transition (spec 041 R-7/T030).
    wire(
        "sources.set_organization_state",
        sources_set_organization_state(be.state(), root_id.clone(), args(json!("unorganized")))
            .await,
    );

    // Spec 058 T012: a scan records a source group and no placeholder item;
    // classification materializes the real item rows.
    let scan = wire(
        "inbox.scan.folder",
        inbox_scan_folder(
            args(json!({ "rootId": root_id, "rootAbsolutePath": root_path })),
            be.pool(),
        )
        .await,
    );
    let inbox_item_id = if let Some(id) = scan["items"][0]["inboxItemId"].as_str() {
        id.to_owned()
    } else {
        let list = wire("inbox.list", inbox_list(be.pool()).await);
        let group_id = list["sourceGroups"]
            .as_array()
            .and_then(|groups| groups.iter().find(|g| g["rootId"].as_str() == Some(&root_id)))
            .and_then(|g| g["sourceGroupId"].as_str())
            .unwrap_or_else(|| {
                panic!("scan recorded no source group to classify: scan={scan} list={list}")
            })
            .to_owned();
        wire(
            "inbox.classify_source_group",
            inbox_classify_source_group(
                args(json!({ "sourceGroupId": group_id, "rootAbsolutePath": root_path })),
                be.pool(),
            )
            .await,
        );
        let after = wire("inbox.list", inbox_list(be.pool()).await);
        after["items"]
            .as_array()
            .and_then(|items| items.iter().find(|i| i["rootId"].as_str() == Some(&root_id)))
            .and_then(|i| i["inboxItemId"].as_str())
            .unwrap_or_else(|| {
                panic!("classifying source group {group_id} materialized no item: {after}")
            })
            .to_owned()
    };

    let classify = wire(
        "inbox.classify",
        inbox_classify(
            args(json!({
                "inboxItemId": inbox_item_id,
                "forceRescan": false,
                "rootAbsolutePath": root_path,
            })),
            be.pool(),
        )
        .await,
    );
    let content_signature = classify["contentSignature"]
        .as_str()
        .unwrap_or_else(|| panic!("inbox.classify returned no contentSignature: {classify}"))
        .to_owned();

    let confirm = wire(
        "inbox.confirm",
        inbox_confirm(
            args(json!({
                "inboxItemId": inbox_item_id,
                "contentSignature": content_signature,
                "destructiveDestination": null,
                "rootAbsolutePath": root_path,
                "rootId": null,
            })),
            be.state(),
        )
        .await,
    );
    let plan_id = confirm["planId"]
        .as_str()
        .unwrap_or_else(|| panic!("inbox.confirm returned no planId: {confirm}"))
        .to_owned();
    assert!(!plan_id.is_empty(), "expected a real (non-empty) plan id: {confirm}");

    // Constitution II (astro-plan-tykek): `inbox.plan.apply` refuses a plan
    // the caller has not approved, mirroring the UI's approve-then-apply.
    wire("plans.approve", plans_approve(be.state(), plan_id.clone()).await);
    let apply = wire("inbox.plan.apply", inbox_plan_apply(inbox_item_id.clone(), be.state()).await);
    assert!(
        apply["planId"] == json!(plan_id),
        "inbox.plan.apply applied a different plan than confirm created: {apply}"
    );

    // Durable apply trail (`plan_apply_events`) and the real move, carried
    // over from the deleted `plan_review_apply_with_audit`.
    let status = wait_plan_terminal(&be, &plan_id).await;
    assert!(status["planState"] == "applied", "expected the plan to apply cleanly, got: {status}");
    assert!(
        status["itemsApplied"].as_i64().unwrap_or(0) >= 1,
        "expected at least 1 durably-recorded applied item: {status}"
    );
    assert!(
        !original_path.exists(),
        "expected the source file to have moved away from {}",
        original_path.display()
    );

    // Session GROUPING follows the plan-applied event; the `targetIds` this
    // waits on are back-filled by the same event path, or failing that by the
    // 30 s backstop drain, hence the drain-backed budget.
    let sessions = poll_until(
        "sessions.list (a session with resolved targetIds)",
        DRAIN_BACKED_TIMEOUT,
        || async { wire("sessions.list", sessions_list(be.state(), None, None).await) },
        |v| {
            v.as_array().is_some_and(|arr| {
                arr.iter().any(|s| s["targetIds"].as_array().is_some_and(|t| !t.is_empty()))
            })
        },
    )
    .await;
    let session_id = sessions
        .as_array()
        .and_then(|arr| {
            arr.iter().find(|s| s["targetIds"].as_array().is_some_and(|t| !t.is_empty()))
        })
        .and_then(|s| s["id"].as_str())
        .unwrap_or_else(|| panic!("session has no id: {sessions}"))
        .to_owned();

    // Calibration suggest against the real session. Candidates may be empty
    // (no masters are seeded); the proof is a real, non-error response.
    let suggest = wire(
        "calibration.match.suggest",
        calibration_match_suggest(
            be.state(),
            args(json!({
                "contractVersion": "1.0",
                "requestId": "e2e-ingest-suggest",
                "sessionId": session_id,
                "calibrationTypes": null,
            })),
        )
        .await,
    );
    assert!(
        suggest.get("status").is_some(),
        "expected a real calibration.match.suggest response shape: {suggest}"
    );

    // The seed's M 31 entry carries the "Andromeda Galaxy" alias: global
    // search must resolve it.
    let search = wire("search.global", search_global(be.state(), "Andromeda".to_owned()).await);
    let alias_hit = search
        .as_array()
        .unwrap_or_else(|| panic!("search.global did not return an array: {search}"))
        .iter()
        .any(|r| r["kind"] == "target");
    assert!(alias_hit, "expected the Andromeda alias to resolve to a target result: {search}");
}

/// Lifecycle integrity: a real refusal/blocked `TransitionResponse`, and a
/// real ledger read (`lifecycle.ledger.list` is the durable read path for
/// lifecycle state).
///
/// Backend REAL: `projects.create`, `lifecycle.transition.apply`,
/// `lifecycle.ledger.list`.
///
/// Was `journeys.rs::lifecycle_integrity`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lifecycle_integrity() {
    let be = Backend::start().await;

    // A project with no sources starts life `setup_incomplete` and does NOT
    // auto-advance, since `initialSources` is empty.
    let project_dir = tempfile::tempdir().expect("project dir");
    let (project_id, create) =
        create_project(&be, "e2e-lifecycle-create", "E2E Lifecycle Project", project_dir.path())
            .await;
    assert!(
        create["lifecycle"] == "setup_incomplete",
        "expected a sourceless project to start setup_incomplete: {create}"
    );

    // Whether the business rule allows `setup_incomplete -> ready` here is
    // NOT asserted: the point is a real, well-formed `TransitionResponse`.
    let transition = wire(
        "lifecycle.transition.apply",
        lifecycle_transition_apply(
            be.state(),
            args(json!({
                "entityType": "project",
                "contractVersion": "2.0.0",
                // `requestId` is a real `Uuid` on the wire
                // (crates/contracts/core/src/lifecycle.rs), unlike the
                // free-form String requestIds elsewhere.
                "requestId": "e2e00000-0000-4000-8000-000000000001",
                "entityId": project_id,
                "currentState": "setup_incomplete",
                "nextState": "ready",
                "actionLabel": null,
                "actor": "user",
            })),
        )
        .await,
    );
    let transition_status = transition["status"]
        .as_str()
        .unwrap_or_else(|| panic!("transition response has no status: {transition}"));
    assert!(
        matches!(transition_status, "success" | "noop" | "error"),
        "unexpected transition status: {transition}"
    );
    if transition_status == "error" {
        let error = &transition["error"];
        assert!(
            error["code"].is_string() && !error["message"].as_str().unwrap_or_default().is_empty(),
            "refused transition must carry a real error code + message, not a placeholder: {transition}"
        );
    }

    let ledger = wire(
        "lifecycle.ledger.list",
        lifecycle_ledger_list(
            be.state(),
            args(json!({ "entityTypes": ["project"], "projectId": project_id })),
        )
        .await,
    );
    let has_row = ledger
        .as_array()
        .unwrap_or_else(|| panic!("lifecycle.ledger.list did not return an array: {ledger}"))
        .iter()
        .any(|row| row["entityId"] == project_id);
    assert!(has_row, "expected a ledger row for project {project_id}: {ledger}");
}

/// Cleanup plan review: real artifact observation → scan → generate →
/// approve → apply (spec 017/037 D22, Journey 6).
///
/// Backend REAL: `projects.create`, `source.protection.set`,
/// `artifact.watcher.attach` (spec 012, #400), `artifact.list`,
/// `cleanup.policy.update`, `cleanup.scan`, `cleanup.plan.generate`,
/// `plans.approve`, `plans.apply.direct`, `plans.apply.status`.
///
/// Was `journeys.rs::cleanup_plan_review`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cleanup_plan_review() {
    let _protection_defaults_lock = PROTECTION_DEFAULTS_TEST_LOCK.lock().await;
    let be = Backend::start().await;
    reset_protection_defaults(&be).await;

    // The artifact watcher's attach-time reconciliation needs the project's
    // output folder to exist already.
    let project_dir = tempfile::tempdir().expect("project dir");
    let (project_id, _) =
        create_project(&be, "e2e-cleanup-create", "E2E Cleanup Project", project_dir.path()).await;

    // A real output file, named per PixInsight's `integration_*` convention
    // (`crates/workflow/artifacts/src/default_rules.rs`), which classifies as
    // `ArtifactKind::Intermediate`: eligible for cleanup once the policy
    // allows it (below).
    let original_path = project_dir.path().join("integration_M31_Ha.xisf");
    std::fs::write(&original_path, b"not-a-real-xisf-file").expect("write the fixture output");

    unprotect(&be, &project_id).await;

    let artifacts = attach_and_list_artifacts(&be, &project_id).await;
    assert!(
        artifacts["artifacts"][0]["kind"] == "intermediate",
        "expected the fixture output to classify as intermediate: {artifacts}"
    );

    // The default cleanup policy is all-Keep (safe default): opt Intermediate
    // into Archive so the generator has a real candidate.
    wire(
        "cleanup.policy.update",
        cleanup_policy_update(
            be.state(),
            args(json!({
                "entries": [
                    { "dataType": "intermediate", "action": "archive" },
                    { "dataType": "master", "action": "keep" },
                    { "dataType": "final", "action": "keep" },
                ],
                "autoOnCompletion": false,
            })),
        )
        .await,
    );

    let scan = wire("cleanup.scan", cleanup_scan(be.state(), project_id.clone()).await);
    assert!(
        !scan["candidates"].as_array().unwrap_or(&Vec::new()).is_empty(),
        "expected a real cleanup candidate for the intermediate artifact: {scan}"
    );

    let generate = wire(
        "cleanup.plan.generate",
        cleanup_plan_generate(be.state(), args(json!({ "projectId": project_id }))).await,
    );
    let plan_id = generate["planId"]
        .as_str()
        .unwrap_or_else(|| panic!("cleanup.plan.generate returned no planId: {generate}"))
        .to_owned();
    assert!(
        generate["itemCount"].as_i64().unwrap_or(0) >= 1,
        "expected at least 1 real cleanup item on the generated plan: {generate}"
    );

    let approve = wire("plans.approve", plans_approve(be.state(), plan_id.clone()).await);
    assert!(
        approve["planId"] == json!(plan_id) && approve["newState"] == "approved",
        "expected plans.approve to move the generated plan to approved: {approve}"
    );
    let approval_token = approve["approvalToken"]
        .as_str()
        .unwrap_or_else(|| panic!("plans.approve returned no approvalToken: {approve}"))
        .to_owned();

    // The real filesystem mutation (channel-free, spec 037). The token minted
    // by the approve call is the gate; no apply path mints its own.
    let apply = wire(
        "plans.apply.direct",
        plans_apply_direct(be.state(), plan_id.clone(), approval_token).await,
    );
    assert!(
        apply["planId"] == json!(plan_id) && apply["newState"] == "applying",
        "expected plans.apply.direct to start applying the approved plan: {apply}"
    );

    let status = wait_plan_terminal(&be, &plan_id).await;
    assert!(
        status["planState"] == "applied",
        "expected the cleanup plan to apply cleanly, got: {status}"
    );
    assert!(
        status["itemsApplied"].as_i64().unwrap_or(0) >= 1,
        "expected at least 1 durably-recorded applied item: {status}"
    );

    // The original output moved out of the project folder into the
    // app-managed archive subtree.
    assert!(
        !original_path.exists(),
        "expected the cleanup candidate to have moved away from {}",
        original_path.display()
    );
    assert!(
        has_archive_subtree(project_dir.path()),
        "expected a `.astro-plan-archive` subtree under the project folder after apply"
    );
}

/// Drive a fresh project `setup_incomplete` → `ready` → `processing` →
/// `completed` through real transitions. `completed -> archived` is itself
/// plan-required, so the archive journey proves the plan-driven closure and
/// never attempts a direct transition into `archived`.
async fn advance_to_completed(be: &Backend, project_id: &str) {
    let hops =
        [("setup_incomplete", "ready"), ("ready", "processing"), ("processing", "completed")];
    for (current_state, next_state) in hops {
        let transition = wire(
            "lifecycle.transition.apply",
            lifecycle_transition_apply(
                be.state(),
                args(json!({
                    "entityType": "project",
                    "contractVersion": "2.0.0",
                    "requestId": uuid::Uuid::new_v4().to_string(),
                    "entityId": project_id,
                    "currentState": current_state,
                    "nextState": next_state,
                    "actionLabel": null,
                    "actor": "user",
                })),
            )
            .await,
        );
        assert!(
            transition["status"] == "success",
            "expected {current_state} -> {next_state} to succeed for a fresh project: {transition}"
        );
    }
}

/// Real lifecycle progression to `completed` → real archive plan →
/// `plans.apply.direct` (real move into `.astro-plan-archive`) →
/// `archive.list` durable read. One archived project and plan per call: the
/// caller then exercises exactly ONE destructive archive-management command
/// against it, because both really remove the plan's whole archive subtree
/// (#732). `label` disambiguates request ids and names across calls.
///
/// Returns `(plan_id, project_dir)`; the caller holds `project_dir` alive for
/// as long as it needs the archived file on disk.
#[allow(clippy::too_many_lines)]
async fn setup_archived_project(be: &Backend, label: &str) -> (String, tempfile::TempDir) {
    // 1. A project with no sources starts `setup_incomplete`.
    let project_dir = tempfile::tempdir().expect("project dir");
    let (project_id, create) = create_project(
        be,
        &format!("e2e-archive-create-{label}"),
        &format!("E2E Archive Project {label}"),
        project_dir.path(),
    )
    .await;
    assert!(
        create["lifecycle"] == "setup_incomplete",
        "expected a sourceless project to start setup_incomplete: {create}"
    );

    // 2. Real progression to `completed`.
    advance_to_completed(be, &project_id).await;

    // 3. Without an override every archive item refuses apply.
    unprotect(be, &project_id).await;

    // 4. A real processing output, classified `intermediate` by the real
    // artifact-kind rules.
    let original_path = project_dir.path().join(format!("integration_M31_Ha_{label}.xisf"));
    std::fs::write(&original_path, b"not-a-real-xisf-file").expect("write the fixture output");
    let artifacts = attach_and_list_artifacts(be, &project_id).await;
    assert!(
        artifacts["artifacts"][0]["kind"] == "intermediate",
        "expected the fixture output to classify as intermediate: {artifacts}"
    );

    // 5. Every observed artifact becomes an `archive`-action item. No
    // filesystem mutation happens here (FR-002).
    let generate = wire(
        "archive.plan.generate",
        archive_plan_generate(be.state(), project_id.clone(), None).await,
    );
    let plan_id = generate["planId"]
        .as_str()
        .unwrap_or_else(|| panic!("archive.plan.generate returned no planId: {generate}"))
        .to_owned();
    assert!(
        generate["itemCount"].as_i64().unwrap_or(0) >= 1,
        "expected at least 1 real archive item on the generated plan: {generate}"
    );

    // 6. Approve: `plans.apply.direct` requires the token this call mints.
    let approve = wire("plans.approve", plans_approve(be.state(), plan_id.clone()).await);
    let approval_token = approve["approvalToken"]
        .as_str()
        .unwrap_or_else(|| panic!("plans.approve returned no approvalToken: {approve}"))
        .to_owned();

    // 7. Apply: the real filesystem mutation, channel-free (spec 037).
    let apply = wire(
        "plans.apply.direct",
        plans_apply_direct(be.state(), plan_id.clone(), approval_token).await,
    );
    assert!(
        apply["planId"] == json!(plan_id) && apply["newState"] == "applying",
        "expected plans.apply.direct to start applying the generated archive plan: {apply}"
    );

    // 8. The durable apply status.
    let status = wait_plan_terminal(be, &plan_id).await;
    assert!(
        status["planState"] == "applied",
        "expected the archive plan to apply cleanly, got: {status}"
    );
    assert!(
        status["itemsApplied"].as_i64().unwrap_or(0) >= 1,
        "expected at least 1 durably-recorded applied item: {status}"
    );

    // 9. The file moved into the app-managed archive subtree, never a silent
    // overwrite (constitution II).
    assert!(
        !original_path.exists(),
        "expected the archived file to have moved away from {}",
        original_path.display()
    );
    assert!(
        has_archive_subtree(project_dir.path()),
        "expected a `.astro-plan-archive` subtree under the project folder after apply"
    );

    // 10. C5 lifecycle closure: a clean `applied` archive plan drives the
    // owning project into `archived`, the only way to reach that state.
    let archive_list = poll_until(
        "archive.list",
        INVOKE_TIMEOUT,
        || async { wire("archive.list", archive_list(be.state()).await) },
        |v| v["entries"].as_array().is_some_and(|a| a.iter().any(|e| e["id"] == json!(project_id))),
    )
    .await;
    let entry = archive_list["entries"]
        .as_array()
        .and_then(|a| a.iter().find(|e| e["id"] == json!(project_id)))
        .unwrap_or_else(|| panic!("expected project {project_id} in archive.list: {archive_list}"));
    assert!(
        entry["archivedViaPlanId"] == json!(plan_id),
        "expected the archive.list entry to carry the owning plan id: {entry}"
    );

    (plan_id, project_dir)
}

/// Whole-project archive → `archive.send_to_trash` → `archive.permanently_
/// delete` honouring the `blockPermanentDelete` protection default.
///
/// Backend REAL: `projects.create`, `lifecycle.transition.apply` (x3),
/// `source.protection.set`, `artifact.watcher.attach`, `artifact.list`,
/// `archive.plan.generate`, `plans.approve`, `plans.apply.direct`,
/// `plans.apply.status`, `archive.list`, `archive.send_to_trash`,
/// `settings.update`, `archive.permanently_delete`.
///
/// Both destructive commands act on a plan's ENTIRE archive subtree, so the
/// journey archives two independent projects: one for the trash path, one
/// for the blocked-then-unblocked permanent delete.
///
/// Was `archive_journeys.rs::slow_archive_lifecycle_apply_trash_permanent_delete`.
/// The OS trash runs through `fs_executor`'s headless double, as it did
/// there (`PV_E2E_OS_TRASH_FAKE`): the Shell trash blocks forever without an
/// interactive desktop, and the real primitive keeps its own unit coverage.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn archive_lifecycle_apply_trash_permanent_delete() {
    let _protection_defaults_lock = PROTECTION_DEFAULTS_TEST_LOCK.lock().await;
    let _fake_trash = fs_executor::ops::trash_op::fake::FakeTrashGuard::new();
    // Process-global seam. This is the only test in this binary using it; no
    // other backend journey reaches archive trash, so tokio worker threads do
    // not race another test into this fake or the real OS trash path.
    let be = Backend::start().await;
    reset_protection_defaults(&be).await;

    // ── archive.send_to_trash really removes the file ──────────────────────
    let (plan_a, dir_a) = setup_archived_project(&be, "trash").await;
    let archive_root_a = dir_a.path().join(".astro-plan-archive");
    let send_to_trash =
        wire("archive.send_to_trash", archive_send_to_trash(be.state(), plan_a.clone()).await);
    assert!(
        send_to_trash["planId"] == json!(plan_a)
            && send_to_trash["itemsMoved"].as_i64().unwrap_or(0) >= 1,
        "expected archive.send_to_trash to report the real archived item count: {send_to_trash}"
    );
    assert!(
        !any_file_under(&archive_root_a),
        "expected archive.send_to_trash to leave no files under {}",
        archive_root_a.display()
    );

    // ── archive.permanently_delete honours blockPermanentDelete, then really
    // removes the file once unblocked ───────────────────────────────────────
    let (plan_b, dir_b) = setup_archived_project(&be, "delete").await;
    let archive_root_b = dir_b.path().join(".astro-plan-archive");

    // The app's default is `true` (blocked).
    let blocked = archive_permanently_delete(be.state(), plan_b.clone(), "DELETE".to_owned()).await;
    assert!(
        blocked.is_err(),
        "expected archive.permanently_delete to be refused while blockPermanentDelete=true (default)"
    );
    // Refused before touching the filesystem (constitution II).
    assert!(
        any_file_under(&archive_root_b),
        "expected the blocked delete to leave the archived file untouched: {}",
        archive_root_b.display()
    );

    // Disable the protection default (the Settings > Cleanup toggle) and retry.
    wire(
        "settings.update",
        settings_update(
            be.state(),
            "cleanup".to_owned(),
            JsonAny::from(json!({ "blockPermanentDelete": false })),
        )
        .await,
    );
    let permanently_delete = wire(
        "archive.permanently_delete",
        archive_permanently_delete(be.state(), plan_b.clone(), "DELETE".to_owned()).await,
    );
    assert!(
        permanently_delete["planId"] == json!(plan_b)
            && permanently_delete["itemsDeleted"].as_i64().unwrap_or(0) >= 1,
        "expected archive.permanently_delete to succeed once unblocked: {permanently_delete}"
    );
    assert!(
        !any_file_under(&archive_root_b),
        "expected archive.permanently_delete to leave no files under {}",
        archive_root_b.display()
    );
}
