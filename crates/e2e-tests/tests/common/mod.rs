// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared harness for spec 037 Layer-2 real-UI E2E journeys.
//!
//! All journeys are real (WP-C) but `#[ignore]`d: they need the
//! `tauri-webdriver` CLI, a `desktop_shell --features e2e` build, and a
//! served frontend — none of which exist in the Layer-1 `cargo test
//! --workspace` job (ci.yml). The dedicated e2e.yml workflow runs them with
//! `--run-ignored all` after standing that environment up.
//!
//! Mechanism (mirrors `.github/workflows/e2e.yml`, research D10):
//! - `desktop_shell` is built with `cargo build -p desktop_shell --features
//!   e2e`, which compiles in `tauri-plugin-webdriver` (Choochmeque) — an
//!   embedded W3C WebDriver server on loopback. Release builds omit the
//!   `e2e` feature so the automation surface is never present (Constitution
//!   Principle V).
//! - The `tauri-webdriver` CLI (`cargo install tauri-webdriver --locked`)
//!   proxies a loopback port -> the embedded plugin server on another, and
//!   manages the target app's process lifecycle via the `tauri:options`
//!   capability — it does **not** take the app binary as a CLI argument.
//!   Both ports are allocated per test PROCESS (each nextest test is its own
//!   process) rather than fixed at `:4444`/`:4445`, so concurrent journeys
//!   (`test-threads > 1`) never collide — see [`InstanceEnv`].
//! - thirtyfour (this crate's W3C client) connects to the CLI's proxy port and
//!   sends `tauri:options.application` = the built `desktop_shell` binary
//!   path in the New Session capabilities. No `browserName` is set (see
//!   `quickstart.md`).
//! - The app loads its own frontend from the Tauri `devUrl` (`:5173`)
//!   automatically on launch, so the harness does **not** call
//!   `driver.goto(...)` after connecting.
//! - `window.__ALM_E2E__.invoke(...)` (exposed by the frontend when built
//!   with `VITE_E2E=1`, see `apps/desktop/src/main.tsx`) is the real-IPC
//!   invoke bridge used by [`E2eApp::invoke`].
//!
//! See `crates/e2e-tests/README.md` for the full run procedure.

#![allow(dead_code)]

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use thirtyfour::components::escape_string;
use thirtyfour::prelude::*;

/// Per-process isolated E2E instance environment: an ephemeral proxy/native
/// port pair for `tauri-webdriver`/`tauri-plugin-webdriver`, plus an isolated
/// app-data/app-config/DB root — so concurrent `cargo-nextest` PROCESSES
/// (`test-threads > 1`; nextest gives each `#[test]` its own OS process, so
/// there is no in-process races to guard, only cross-process port/file
/// collisions) never share a WebDriver port, SQLite file, or webview profile.
///
/// Lazily allocated once per process and reused for every
/// [`E2eApp::launch`]/[`E2eApp::relaunch`] call in that test: `relaunch()`
/// (`ResetScope::PreserveWebviewStorage`) depends on the SAME app-data root
/// surviving across a launch -> shutdown -> relaunch sequence within one
/// journey (that's the whole point of the webview-storage-preserving
/// restart), so this must NOT be re-picked per `launch_with` call.
struct InstanceEnv {
    /// Kept alive for the process lifetime so the paths derived from it stay
    /// valid; never read directly.
    _root: tempfile::TempDir,
    /// Env vars to set (and transitively propagate through the
    /// `tauri-webdriver` CLI, which does not `env_clear()` its spawned
    /// `desktop_shell` child) so the app resolves its `app_data_dir`/
    /// `app_config_dir` (and, on Windows, `app_local_data_dir`) under this
    /// instance's isolated root instead of the shared real OS profile.
    vars: Vec<(&'static str, String)>,
    /// Isolated SQLite file this instance's app connects to (`ALM_DB_URL`).
    db_path: PathBuf,
    /// Port the `tauri-webdriver` CLI proxy listens on (`--port`); thirtyfour
    /// connects here.
    proxy_port: u16,
    /// Port `tauri-plugin-webdriver` binds inside the app (`--native-port`,
    /// `TAURI_WEBDRIVER_PORT`).
    native_port: u16,
}

impl InstanceEnv {
    fn new() -> Result<Self> {
        let root = tempfile::tempdir().context("failed to create isolated E2E instance dir")?;
        let db_path = root.path().join("e2e-test.db");
        let vars: Vec<(&'static str, String)> = if cfg!(target_os = "windows") {
            vec![
                ("APPDATA", root.path().join("appdata").display().to_string()),
                ("LOCALAPPDATA", root.path().join("localappdata").display().to_string()),
            ]
        } else if cfg!(target_os = "macos") {
            // app_data_dir/app_config_dir both resolve under $HOME on macOS
            // (see `app_data_dir`/`app_config_dir` below).
            vec![("HOME", root.path().display().to_string())]
        } else {
            vec![
                ("XDG_DATA_HOME", root.path().join("xdg-data").display().to_string()),
                ("XDG_CONFIG_HOME", root.path().join("xdg-config").display().to_string()),
            ]
        };
        let (proxy_port, native_port) = pick_port_pair()?;
        Ok(Self { _root: root, vars, db_path, proxy_port, native_port })
    }
}

/// The process-wide [`InstanceEnv`] singleton — see its docs for why this
/// must be lazily-allocated-once rather than per-launch.
fn instance_env() -> &'static InstanceEnv {
    static ENV: OnceLock<InstanceEnv> = OnceLock::new();
    ENV.get_or_init(|| {
        InstanceEnv::new().expect(
            "failed to allocate an isolated E2E instance environment \
             (temp dir creation or ephemeral port binding failed)",
        )
    })
}

/// Bind two ephemeral (`:0`) TCP ports on loopback and return them, dropping
/// the listeners immediately so `tauri-webdriver` can bind them itself.
///
/// This has an inherent, accepted bind-race window between the listener drop
/// here and `tauri-webdriver`'s own bind a moment later (the standard
/// "ask the OS for a free port, then let someone else use it" pattern used by
/// e.g. the `portpicker` crate) — acceptable for a CI test harness where a
/// concurrently-running desktop_shell can be relied on not to be racing for
/// literally the same ephemeral port in the same instant.
fn pick_port_pair() -> Result<(u16, u16)> {
    let a = std::net::TcpListener::bind("127.0.0.1:0")
        .context("failed to bind an ephemeral port for the tauri-webdriver proxy")?;
    let b = std::net::TcpListener::bind("127.0.0.1:0")
        .context("failed to bind an ephemeral port for the tauri-plugin-webdriver native server")?;
    let proxy_port = a.local_addr().context("failed to read proxy port local_addr")?.port();
    let native_port = b.local_addr().context("failed to read native port local_addr")?.port();
    drop(a);
    drop(b);
    Ok((proxy_port, native_port))
}

/// Vite dev-server / `vite preview` URL the app's Tauri `devUrl` points at
/// (`apps/desktop/src-tauri/tauri.conf.json`). The app loads this URL on its
/// own at launch — do NOT `driver.goto(APP_URL)` after connecting. Kept for
/// journeys that need to assert the current URL or navigate within the SPA.
///
/// MUST be the `localhost` host form, byte-identical to `devUrl`: the app
/// boots on `http://localhost:5173`, and `localhost` vs `127.0.0.1` are
/// DIFFERENT web origins with separate localStorage. Navigating journeys to
/// a `127.0.0.1` URL splits app state across two origins — preferences
/// written on one (e.g. `setupCompleted`, `complete_first_run_gate`) are
/// invisible on the other, which made `Shell`'s localStorage-based setup
/// gate and `SetupPage`'s backend-based check ping-pong `/setup` ↔ `/inbox`
/// indefinitely.
pub const APP_URL: &str = "http://localhost:5173";

/// Overall deadline for WebDriver session creation in [`E2eApp::launch`].
///
/// Must comfortably cover a debug-build app boot on a cold CI runner: DB
/// connect + migrations + the ~13k-row bundled target-seed load all happen
/// BEFORE the window exists (observed ~30 s serial on ubuntu-latest, CI run
/// 28694907445), and the plugin's own per-attempt window-wait is only 10 s.
///
/// Raised from 120 s to 240 s (CI run 29592400990, PR #951): with the `e2e`
/// nextest profile's `test-threads` raised above 1, two of these CPU-heavy
/// boots (WebKitGTK/WebView2 init + SQLite migrate + seed load, all on a
/// 4-vCPU runner) can now genuinely run concurrently, and one of two
/// concurrent boots measurably exceeded 120 s on both attempts while sibling
/// tests booted normally — real contention, not a hang. 240 s keeps meaningful
/// headroom under `.config/nextest.toml`'s `slow-timeout` hard-kill ceiling
/// (`period = 60s, terminate-after = 5` => 300 s per attempt) for in-journey
/// polling after a slow-but-successful launch.
pub const LAUNCH_TIMEOUT: Duration = Duration::from_secs(240);

/// Default deadline for the convenience "find an element by aria-label /
/// button text, then act on it" helpers ([`E2eApp::click_by_aria_label`] and
/// friends). These poll for their target rather than doing a single
/// immediate `find` — see [`E2eApp::find_waiting`] for the CI race this
/// guards against. 20 s comfortably covers a debug-build route render on a
/// cold CI runner without masking a genuinely-absent element for long.
pub const DEFAULT_FIND_TIMEOUT: Duration = Duration::from_secs(20);

/// Deadline for a single `execute_async` script, set explicitly on the session
/// (#1205). Before this existed the suite silently inherited the driver's own
/// default — the W3C default is 30 s, which a legitimate IPC invoke can exceed
/// on a saturated Windows runner, producing a bare "Script execution timed out"
/// that names neither the command nor the budget it blew.
///
/// 90 s is chosen to sit *below* nextest's per-attempt hard kill (`period = 60s,
/// terminate-after = 5` => 300 s in `.config/nextest.toml`) so a script timeout
/// still fails as a readable test error rather than as a process kill, while
/// leaving room for several sequential invokes in one journey. Raising this
/// cannot mask a true hang: [`E2eApp::invoke`] names the in-flight command in
/// its error context, so a script that never calls back still fails loudly.
pub const SCRIPT_TIMEOUT: Duration = Duration::from_secs(90);

/// Deadline for a document navigation. `goto_route` is followed by an explicit
/// [`E2eApp::wait_bridge_ready`] poll, so this only needs to bound the raw
/// navigation itself.
pub const SCRIPT_TIMEOUT_PAGE_LOAD: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------------------
// Private deserialization target for invoke() responses
// ---------------------------------------------------------------------------

/// Raw bridge response shape, using `Value` so no `T: Default` bound is needed.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvokeOutcome {
    ok: bool,
    #[serde(default)]
    value: Option<Value>,
    #[serde(default)]
    error: Option<String>,
}

impl InvokeOutcome {
    fn into_result<T: DeserializeOwned>(self) -> Result<T> {
        if self.ok {
            // Unit-returning commands (`Result<(), _>` — e.g.
            // `artifact_watcher_attach`) legitimately resolve with `null`/
            // `undefined`; `Option<Value>` deserialises JSON null to `None`, so
            // treat an absent value as `Value::Null` rather than an error.
            let raw = self.value.unwrap_or(Value::Null);
            serde_json::from_value(raw).context("failed to deserialise invoke value into T")
        } else {
            Err(anyhow!("invoke error: {}", self.error.unwrap_or_else(|| "unknown error".into())))
        }
    }
}

// ---------------------------------------------------------------------------
// E2eApp — the main harness handle
// ---------------------------------------------------------------------------

/// Handle for a running test app + WebDriver session.
///
/// Call [`E2eApp::launch`] to start, [`E2eApp::shutdown`] to tear down.
pub struct E2eApp {
    pub driver: WebDriver,
    driver_proc: Option<Child>,
}

/// How much persisted state [`E2eApp::launch_with`] wipes before spawning
/// the app process. See [`E2eApp::launch`] vs [`E2eApp::relaunch`].
#[derive(Clone, Copy, PartialEq, Eq)]
enum ResetScope {
    /// Wipe DB + webview storage + window-state (a fresh journey).
    Full,
    /// Wipe DB + window-state, but keep webview storage (localStorage) —
    /// simulates a real app restart within one journey.
    PreserveWebviewStorage,
}

impl E2eApp {
    /// Launch a full E2E session: preflight → reset DB → spawn the
    /// `tauri-webdriver` CLI proxy → create the WebDriver session with a
    /// deadline-bounded retry loop.
    ///
    /// Why the retry loop (CI evidence: run 28694907445, ubuntu):
    /// `desktop_shell` initialises the webdriver **plugin** in `build_app()`
    /// but only creates its **window** when `run_app()` starts the event loop
    /// — after DB connect, migrations, and the ~13k-row bundled-seed load
    /// (`apps/desktop/src-tauri/src/main.rs`). A debug build on a CI runner
    /// spends tens of seconds in that gap. The `tauri-webdriver` CLI's
    /// session handler only waits for the plugin *port* (30 s), then forwards
    /// session-create to the plugin, whose own window-wait is 10 s — so a
    /// slow boot yields `no such window` (404) even though the app is healthy
    /// and seconds away from ready.
    ///
    /// The CLI (`tauri-webdriver` 0.1.1, `src/server.rs::handle_plugin`)
    /// kills any prior app instance and relaunches on every `POST /session`
    /// whose capabilities carry a `tauri:options.application` value — and an
    /// **empty string still counts**: `extract_app_path` returns
    /// `Some("".into())`, so the CLI kills the booting app and then fails
    /// `Command::new("")` with ENOENT ("Failed to launch Tauri app: No such
    /// file or directory", CI run 28695295960). The only no-relaunch path is
    /// to omit `tauri:options` entirely (`extract_app_path` → `None`), which
    /// forwards the session-create straight to the plugin in the running
    /// app. So: attempt 1 sends the real path (launch); retries send **no
    /// `tauri:options` at all** (reuse the booting instance) until the
    /// window exists or [`LAUNCH_TIMEOUT`] elapses. Connection-level errors
    /// (`RequestFailed`) mean the CLI never received the POST — the app was
    /// not launched — so the real path is kept for the next attempt.
    ///
    /// The app auto-loads its frontend from the Tauri `devUrl` on launch, so
    /// no `driver.goto(...)` call is needed here (see module docs).
    pub async fn launch() -> Result<Self> {
        Self::launch_with(ResetScope::Full).await
    }

    /// Simulate a real app restart WITHIN one journey: a fresh WebDriver
    /// session + a fresh `desktop_shell` process, but WITHOUT wiping the
    /// webview's persisted web storage (localStorage & co).
    ///
    /// [`Self::launch`] always calls `reset_webview_storage()` so that
    /// state set by one journey (test function) can't leak into the NEXT
    /// journey's fresh [`Self::launch`] — those are different real OS user
    /// profiles' worth of isolation, correctly enforced. But a journey that
    /// wants to prove something actually SURVIVES a real app relaunch (e.g.
    /// `settings_journeys.rs`'s theme persistence test) must call this
    /// instead of `launch()` for its second call: calling `launch()` again
    /// wipes the very localStorage state the journey is trying to prove
    /// persisted, which is a harness bug, not a product one (windows-only
    /// symptom: only WebView2's `EBWebView` wipe path in
    /// `reset_webview_storage()` actually deletes real localStorage files —
    /// the Linux `localstorage`/`storage` paths don't match WebKitGTK's real
    /// storage location, so the same call was already a no-op there).
    ///
    /// Still resets the database and window-state store (same as `launch()`)
    /// — those are unrelated to the webview storage this exists to preserve,
    /// and journeys that use this (see `settings_journeys.rs`) already expect
    /// a fresh DB / first-run gate after "relaunching".
    pub async fn relaunch() -> Result<Self> {
        Self::launch_with(ResetScope::PreserveWebviewStorage).await
    }

    async fn launch_with(scope: ResetScope) -> Result<Self> {
        preflight()?;
        let env = instance_env();
        reset_database(&env.db_path)?;
        if matches!(scope, ResetScope::Full) {
            reset_webview_storage(&env.vars);
        }
        reset_window_state(&env.vars);

        let (mut driver_proc, proc_log) = spawn_tauri_webdriver(env).with_context(|| {
            format!("failed to spawn the tauri-webdriver CLI on port {}", env.proxy_port)
        })?;
        let webdriver_url = format!("http://127.0.0.1:{}", env.proxy_port);

        let app_binary = app_binary_path()?;
        let deadline = Instant::now() + LAUNCH_TIMEOUT;
        let mut launched = false;

        let driver = loop {
            let mut caps = Capabilities::new();
            if !launched {
                // Only the launching attempt may carry tauri:options: the CLI
                // treats ANY present `application` value (even "") as "kill
                // the current app and relaunch". Retries must omit the key so
                // the POST is forwarded to the already-booting instance.
                if let Err(e) = caps
                    .set("tauri:options", json!({ "application": app_binary.to_string_lossy() }))
                {
                    kill_driver_proc(&mut driver_proc);
                    return Err(e)
                        .context("failed to set the tauri:options.application capability");
                }
            }

            match WebDriver::new(&webdriver_url, caps).await {
                Ok(driver) => break driver,
                Err(e) => {
                    // Any typed WebDriver response means the CLI handled the
                    // POST — and therefore already spawned the app process.
                    // Only a transport-level RequestFailed means it didn't.
                    use thirtyfour::error::WebDriverErrorInner;
                    if !matches!(e.as_inner(), WebDriverErrorInner::RequestFailed(_)) {
                        launched = true;
                    }
                    if Instant::now() >= deadline {
                        // Ask the CLI to kill the app it launched (any
                        // DELETE /session/{id} triggers that), then kill the
                        // CLI itself — otherwise the leaked pair holds this
                        // instance's ports and poisons every later launch
                        // sharing this process (exactly what CI's TRY-2 "can
                        // not listen to address" failure was, back when ports
                        // were fixed at 4444/4445).
                        blocking_session_delete(env.proxy_port);
                        kill_driver_proc(&mut driver_proc);
                        return Err(e).with_context(|| {
                            format!(
                                "WebDriver session not created within {LAUNCH_TIMEOUT:?} \
                                 against {webdriver_url} — is `tauri-webdriver` \
                                 running, and was {} built with `--features e2e`?\n{}",
                                app_binary.display(),
                                proc_log.dump()
                            )
                        });
                    }
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                }
            }
        };

        // Set the script timeout EXPLICITLY (#1205). Until this call existed,
        // every `execute_async` inherited whatever default the driver happened
        // to use (W3C says 30s) — never a deliberate choice. A legitimate IPC
        // invoke on a loaded Windows runner can exceed 30s, which surfaces as a
        // bare "Script execution timed out" with no indication of which command
        // was in flight.
        //
        // This does NOT hide a genuine hang: `invoke` names the command in its
        // error context, so a script that never calls back still fails — it just
        // fails at a budget we chose, naming the culprit, instead of at an
        // undocumented default anonymously.
        // Argument order is (script, page_load, implicit) — NOT the
        // page-load-first order the name ordering might suggest. Passing these
        // reversed silently swaps the two budgets and still compiles, so keep
        // the labels below when editing.
        let timeouts = TimeoutConfiguration::new(
            /* script */ Some(SCRIPT_TIMEOUT),
            /* page_load */ Some(SCRIPT_TIMEOUT_PAGE_LOAD),
            // Implicit wait stays ZERO: every wait in this harness is an
            // explicit poll loop, and thirtyfour's own default notes that
            // ElementQuery requires zero. A non-zero implicit wait would
            // silently stack on top of those and inflate every negative
            // assertion.
            /* implicit */
            Some(Duration::from_secs(0)),
        );
        if let Err(e) = driver.update_timeouts(timeouts).await {
            blocking_session_delete(env.proxy_port);
            kill_driver_proc(&mut driver_proc);
            return Err(e).context("failed to set explicit WebDriver timeouts");
        }

        Ok(Self { driver, driver_proc: Some(driver_proc) })
    }

    /// Issue a Tauri command through the `window.__ALM_E2E__` bridge.
    ///
    /// The bridge is exposed by the desktop app when it is built with
    /// `VITE_E2E=1` (see `apps/desktop/src/main.tsx`). This replaces the old
    /// better-sqlite3 reader approach: instead of reading the DB directly, we
    /// assert UI→real-backend round-trips against real command output
    /// (FR-008).
    ///
    /// The injected WebDriver callback is the last script argument
    /// (`arguments[arguments.length-1]`); the bridge resolves it with
    /// `{ok:true,value}` or `{ok:false,error}`.
    pub async fn invoke<T: DeserializeOwned>(&self, command: &str, args: Value) -> Result<T> {
        let script = r#"
            var cmd      = arguments[0];
            var cmdArgs  = arguments[1];
            var callback = arguments[arguments.length - 1];
            if (!window.__ALM_E2E__ || typeof window.__ALM_E2E__.invoke !== 'function') {
                callback({ ok: false, error: '__ALM_E2E__ bridge missing (build with VITE_E2E=1)' });
                return;
            }
            window.__ALM_E2E__.invoke(cmd, cmdArgs).then(function(value) {
                callback({ ok: true, value: value });
            }).catch(function(err) {
                // `unwrap()` (`apps/desktop/src/api/ipc.ts`) throws the raw
                // `ContractError` envelope object on a rejected command, not
                // a JS `Error` instance — `String(err)` on a plain object
                // stringifies to the useless "[object Object]" (round 4,
                // #470: masked a real `no_link_kind` backend error behind
                // that placeholder). Prefer JSON.stringify so `code`/
                // `message`/`details` are readable; fall back to
                // `err.message`/`String(err)` only if JSON serialisation
                // itself fails or yields nothing useful (e.g. a real `Error`
                // instance, whose own fields aren't enumerable).
                var serialized;
                try {
                    serialized = JSON.stringify(err);
                } catch (jsonErr) {
                    serialized = null;
                }
                if (!serialized || serialized === '{}') {
                    serialized = (err && err.message) ? String(err.message) : String(err);
                }
                callback({ ok: false, error: serialized });
            });
        "#;

        let ret = self
            .driver
            .execute_async(script, vec![json!(command), args])
            .await
            // Name the command (#1205). This used to be a bare
            // "execute_async failed", so a script timeout told us nothing about
            // WHICH invoke never called back — the CI log was undiagnosable.
            // With the command named, raising SCRIPT_TIMEOUT stays safe: a
            // genuine hang still fails, and now says what hung.
            .with_context(|| {
                format!(
                    "execute_async failed for command {command:?} \
                     (script timeout is {SCRIPT_TIMEOUT:?}); a timeout here means the \
                     bridge never invoked the WebDriver callback for that command"
                )
            })?;

        let outcome: InvokeOutcome = ret.convert().with_context(|| {
            format!("failed to deserialise InvokeOutcome from bridge response for {command:?}")
        })?;

        outcome.into_result::<T>()
    }

    /// Poll a command through the `invoke` bridge until `predicate` accepts the
    /// deserialised value or `timeout` elapses.
    ///
    /// Several real backend effects in this app are event-driven rather than
    /// synchronous with the triggering call (e.g. the inbox plan-apply listener
    /// creates `acquisition_session` rows asynchronously after a plan-applied
    /// event, and the artifact watcher's reconciliation pass runs on its own
    /// task). Polling a real read command until the expected state appears is
    /// the wait primitive for those cases — never a blind `sleep`.
    ///
    /// # Errors
    /// Returns the last error (invoke failure, or a "predicate never matched"
    /// message once `timeout` elapses) if the predicate never accepts a
    /// value. The timeout variant includes the last successfully-decoded
    /// (but non-matching) response, truncated, so a caller can see whether
    /// the backend returned an empty/unrelated result or the expected data
    /// present-but-unmatched by the predicate (a predicate bug) without a
    /// second CI round just to add that dump.
    pub async fn invoke_until<T, P>(
        &self,
        command: &str,
        args: Value,
        timeout: Duration,
        mut predicate: P,
    ) -> Result<T>
    where
        T: DeserializeOwned + std::fmt::Debug,
        P: FnMut(&T) -> bool,
    {
        let deadline = Instant::now() + timeout;
        let mut last_err: Option<anyhow::Error> = None;
        let mut last_value: Option<String> = None;
        loop {
            match self.invoke::<T>(command, args.clone()).await {
                Ok(value) if predicate(&value) => return Ok(value),
                Ok(value) => {
                    let dump = format!("{value:?}");
                    last_value = Some(if dump.len() > 4096 {
                        format!("{}...[truncated]", &dump[..4096])
                    } else {
                        dump
                    });
                }
                Err(e) => last_err = Some(e),
            }
            if Instant::now() >= deadline {
                return Err(last_err.unwrap_or_else(|| match &last_value {
                    Some(v) => anyhow!(
                        "invoke_until({command}) timed out after {:?} without a matching \
                         value; last response: {v}",
                        timeout
                    ),
                    None => anyhow!(
                        "invoke_until({command}) timed out after {:?} without a matching value \
                         (never returned successfully)",
                        timeout
                    ),
                }));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    /// Navigate to a top-level SPA route and wait for the shell to settle.
    ///
    /// The router uses HASH history (`createHashHistory()`,
    /// `apps/desktop/src/app/router.tsx`): routes live in the URL fragment
    /// (`/#/inbox`) and the pathname is ignored entirely. Navigating to
    /// `{APP_URL}{path}` therefore always lands on the index route `/`,
    /// whose first-run gate redirects a fresh DB to `/setup` — the target
    /// page never mounts (CI run 28751553798: Inbox's "Rescan all roots"
    /// deterministically never appeared on all three OSes). Navigate to the
    /// hash form instead. Waits for `document.readyState == "complete"`
    /// instead of a fixed sleep.
    /// The navigation is VERIFIED: several app-level redirects can move the
    /// page away from the requested route right after landing (the Shell
    /// redirects everything to `/setup` while the `setupCompleted` preference
    /// is false, `SetupPage` bounces to `/inbox` once setup completes, the
    /// index gate redirects asynchronously). Retry until the URL actually
    /// stays on the target route, and fail with the URL it kept landing on —
    /// far more diagnosable in CI than a downstream "element never appeared".
    pub async fn goto_route(&self, path: &str) -> Result<()> {
        let url = format!("{APP_URL}/#{path}");
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut last = String::new();
        loop {
            self.driver.goto(&url).await.with_context(|| format!("goto {url} failed"))?;
            self.wait_document_ready(Duration::from_secs(10)).await?;

            // Wait for the URL to land on the target, then confirm it STAYS
            // there (a late-resolving redirect can still yank it away).
            if self.wait_url_contains(path, Duration::from_secs(3)).await.is_ok() {
                tokio::time::sleep(Duration::from_millis(700)).await;
                let current =
                    self.driver.current_url().await.context("failed to read current_url")?;
                last = current.to_string();
                if last.contains(path) {
                    return Ok(());
                }
            } else if let Ok(current) = self.driver.current_url().await {
                last = current.to_string();
            }

            if Instant::now() >= deadline {
                return Err(anyhow!(
                    "route {path} did not stick within 20s — the app kept redirecting \
                     away (last URL: {last}); is the first-run gate complete \
                     (E2eApp::complete_first_run_gate)?"
                ));
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    /// Poll `document.readyState` until `"complete"` or `timeout` elapses.
    pub async fn wait_document_ready(&self, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            let state: String = self
                .driver
                .execute("return document.readyState", vec![])
                .await
                .context("failed to read document.readyState")?
                .convert()
                .context("failed to deserialise document.readyState")?;
            if state == "complete" {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(anyhow!("document.readyState never reached 'complete'"));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Poll `current_url()` until it contains `needle` or `timeout` elapses.
    ///
    /// The index route's first-run gate (`apps/desktop/src/app/router.tsx`)
    /// redirects to `/setup` from an **async** `beforeLoad`:
    /// `checkFirstRunComplete` does a dynamic `import('@/bindings/index')` plus a
    /// `firstrun_state` IPC round-trip, so the redirect lands slightly *after*
    /// the page's `__ALM_E2E__` bridge becomes ready. Asserting the URL the
    /// instant `wait_bridge_ready` returns races that redirect — poll for it.
    pub async fn wait_url_contains(&self, needle: &str, timeout: Duration) -> Result<String> {
        let deadline = Instant::now() + timeout;
        loop {
            let url = self.driver.current_url().await.context("failed to read current_url")?;
            let current = url.to_string();
            if current.contains(needle) {
                return Ok(current);
            }
            if Instant::now() >= deadline {
                return Err(anyhow!(
                    "URL never contained {needle:?} within {timeout:?} (last: {current})"
                ));
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    /// `true` once `window.__ALM_E2E__.invoke` exists — a real signal that
    /// `main.tsx` finished its top-level module evaluation for the current
    /// page load (used instead of a blind sleep after `goto_route`).
    pub async fn bridge_ready(&self) -> Result<bool> {
        let script = r"
            return !!(window.__ALM_E2E__ && typeof window.__ALM_E2E__.invoke === 'function');
        ";
        let ret =
            self.driver.execute(script, vec![]).await.context("bridge_ready script failed")?;
        ret.convert::<bool>().context("failed to deserialise bridge_ready result")
    }

    /// Page state captured when a bridge wait times out (#1204).
    ///
    /// Returns a human-readable one-liner and never fails: this runs on an
    /// already-failing path, so a diagnostic that could itself error would
    /// replace the real failure with its own.
    async fn bridge_failure_context(&self) -> String {
        let url = match self.driver.current_url().await {
            Ok(u) => u.to_string(),
            Err(e) => format!("<current_url failed: {e}>"),
        };

        // One script, so a dying session yields one error rather than four.
        let probe = r#"
            var boundary = document.querySelector('[data-testid="app-error-boundary-fallback"]');
            return JSON.stringify({
                readyState: document.readyState,
                hasBridge:  !!window.__ALM_E2E__,
                bridgeKeys: window.__ALM_E2E__ ? Object.keys(window.__ALM_E2E__) : [],
                errorBoundary: boundary ? (boundary.innerText || '').slice(0, 300) : null,
                bodyChars: document.body ? document.body.innerHTML.length : 0
            });
        "#;
        let page = match self.driver.execute(probe, vec![]).await {
            Ok(ret) => {
                ret.convert::<String>().unwrap_or_else(|e| format!("<undeserialisable: {e}>"))
            }
            Err(e) => format!("<probe script failed: {e}>"),
        };

        format!("url={url}; page={page}")
    }

    /// Wait for [`Self::bridge_ready`] to become `true`.
    pub async fn wait_bridge_ready(&self, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        // Retain the last probe error (#1204). This loop used to call
        // `.unwrap_or(false)`, which DISCARDED the underlying WebDriver error on
        // every iteration — so a dead session or a crashed page spun silently to
        // the deadline and reported the generic "never became ready", throwing
        // away the actual cause each time round.
        let mut last_err: Option<String>;
        loop {
            match self.bridge_ready().await {
                Ok(true) => return Ok(()),
                Ok(false) => last_err = None,
                Err(e) => last_err = Some(format!("{e:#}")),
            }
            if Instant::now() >= deadline {
                let probed = self.bridge_failure_context().await;
                let cause = last_err.map_or_else(
                    || "no probe error — the bridge simply never appeared".to_owned(),
                    |e| format!("last probe error: {e}"),
                );
                return Err(anyhow!(
                    "window.__ALM_E2E__ bridge never became ready within {timeout:?}; \
                     {cause}; {probed}"
                ));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// `true` when the shared `AppErrorBoundary` fallback
    /// (`[data-testid="app-error-boundary-fallback"]`, `apps/desktop/src/app/AppErrorBoundary.tsx`)
    /// is present in the DOM — the real, shipped signal that a route's
    /// component tree threw an uncaught render error (FR-007).
    pub async fn error_boundary_visible(&self) -> Result<bool> {
        use thirtyfour::error::WebDriverErrorInner;

        match self.driver.find(By::Css("[data-testid='app-error-boundary-fallback']")).await {
            Ok(_) => Ok(true),
            Err(e) if matches!(e.as_inner(), WebDriverErrorInner::NoSuchElement(_)) => Ok(false),
            Err(e) => Err(e).context("failed to query for the error boundary fallback"),
        }
    }

    // ---------------------------------------------------------------------
    // Failure-site diagnostics (fix-lane round 5, PR #477): purely
    // best-effort evidence-gathering for a failing journey's error message —
    // never used for assertions. Each dump degrades to an inline error string
    // rather than propagating, so a diagnostic failing never masks the real
    // assertion failure it was called from.
    // ---------------------------------------------------------------------

    /// Dump DOM + TanStack Query + buffered-error evidence for a failing
    /// real-UI journey, deciding between the three live hypotheses for the
    /// Windows-only `inbox_ui_mixed_folder_splits_into_single_type_items`
    /// "found 0 rows" failure (round 3/4 narrowed it to: real webview only):
    ///
    /// - (a) UI IPC channel error/race: `queryState` (status/fetchStatus/
    ///   error/dataUpdatedAt/fetchFailureCount) for the `['inbox','all']`
    ///   query key (`apps/desktop/src/features/inbox/store.ts`), plus
    ///   `e2eErrors` — uncaught `error`/`unhandledrejection` events buffered by
    ///   the `VITE_E2E` listener installed in `apps/desktop/src/main.tsx`. If
    ///   the query never reaches `status: "success"` with `dataUpdatedAt > 0`,
    ///   or `e2eErrors` is non-empty, the UI's own IPC channel is implicated
    ///   rather than the backend (which round-3 already proved returns the
    ///   right rows via the diagnostic-only invoke bridge).
    /// - (b) layout/virtualizer race: `containerFound` / `containerRectHeight`
    ///   / `rowCount` / `containerOuterHtml` (truncated) for the
    ///   `[data-testid="inbox-virtual-sizer"]` scroll viewport
    ///   (`apps/desktop/src/ui/Table.tsx`'s virtualizer measures this
    ///   element) — a 0-height container with `rowCount: 0` but a non-empty,
    ///   well-formed `containerOuterHtml` (e.g. spacer rows present) points at
    ///   the virtualizer, not the query layer.
    /// - (c) stale frontend artifact: `buildTime`, baked in at Vite
    ///   config-eval time via the `VITE_BUILD_TIME` define
    ///   (`apps/desktop/vite.config.ts`) — compare against the CI job's wall
    ///   clock in the run this dump came from.
    ///
    /// Returns a single JSON object; a field-level failure (bridge not
    /// exposed, container missing, query client absent) becomes a `null` /
    /// error-string value in that field rather than an `Err` for the whole
    /// call, so partial evidence is never lost to an all-or-nothing dump.
    pub async fn dump_ui_diagnostics(&self) -> Value {
        let script = r#"
            var callback = arguments[arguments.length - 1];
            function truncate(s, n) {
                if (typeof s !== 'string') return s;
                return s.length > n ? s.slice(0, n) + '...[truncated]' : s;
            }
            try {
                var container = document.querySelector('[data-testid="inbox-virtual-sizer"]');
                var rows = document.querySelectorAll('[data-testid^="inbox-item-"]');
                var rect = container ? container.getBoundingClientRect() : null;
                var e2e = window.__ALM_E2E__;
                var queryState = null;
                if (e2e && e2e.queryClient) {
                    try {
                        var s = e2e.queryClient.getQueryState(['inbox', 'all']);
                        if (s) {
                            queryState = {
                                status: s.status,
                                fetchStatus: s.fetchStatus,
                                error: s.error ? String(s.error.message || s.error) : null,
                                dataUpdatedAt: s.dataUpdatedAt,
                                errorUpdatedAt: s.errorUpdatedAt,
                                fetchFailureCount: s.fetchFailureCount,
                                dataLength: Array.isArray(s.data) ? s.data.length : null
                            };
                        }
                    } catch (qerr) {
                        queryState = { queryStateError: String(qerr) };
                    }
                }
                callback({
                    ok: true,
                    value: {
                        bridgeExposed: !!e2e,
                        buildTime: e2e ? e2e.buildTime : null,
                        documentReadyState: document.readyState,
                        containerFound: !!container,
                        containerRectHeight: rect ? rect.height : null,
                        rowCount: rows.length,
                        containerOuterHtml: truncate(container ? container.outerHTML : null, 4096),
                        queryState: queryState,
                        e2eErrors: (window.__e2eErrors || []).slice(-30)
                    }
                });
            } catch (err) {
                callback({ ok: false, error: String(err) });
            }
        "#;

        match self.driver.execute_async(script, vec![]).await {
            Ok(ret) => ret
                .convert::<Value>()
                .unwrap_or_else(|e| json!({ "dump_ui_diagnostics_decode_error": e.to_string() })),
            Err(e) => json!({ "dump_ui_diagnostics_execute_error": e.to_string() }),
        }
    }

    /// Generic evidence dump for a failing journey centred on ONE
    /// `data-testid` element (unlike `dump_ui_diagnostics`, which is
    /// hardcoded to the Inbox virtualizer/query-key investigation) — e.g. a
    /// dialog/modal that should have closed after a submit action but is
    /// still present. Captures whether the element is still in the DOM, its
    /// (truncated) `outerHTML` — including any inline error banner it may be
    /// showing — and the buffered `window.__e2eErrors` (uncaught
    /// `error`/`unhandledrejection` events, `VITE_E2E` listener installed in
    /// `apps/desktop/src/main.tsx`). Never used for assertions; a failure at
    /// any step degrades to an inline error string rather than propagating.
    pub async fn dump_testid_diagnostics(&self, testid: &str) -> Value {
        let script = format!(
            r#"
            var callback = arguments[arguments.length - 1];
            function truncate(s, n) {{
                if (typeof s !== 'string') return s;
                return s.length > n ? s.slice(0, n) + '...[truncated]' : s;
            }}
            try {{
                var el = document.querySelector('[data-testid="{testid}"]');
                callback({{
                    ok: true,
                    value: {{
                        found: !!el,
                        outerHtml: truncate(el ? el.outerHTML : null, 8192),
                        e2eErrors: (window.__e2eErrors || []).slice(-30)
                    }}
                }});
            }} catch (err) {{
                callback({{ ok: false, error: String(err) }});
            }}
        "#
        );

        match self.driver.execute_async(&script, vec![]).await {
            Ok(ret) => ret.convert::<Value>().unwrap_or_else(
                |e| json!({ "dump_testid_diagnostics_decode_error": e.to_string() }),
            ),
            Err(e) => json!({ "dump_testid_diagnostics_execute_error": e.to_string() }),
        }
    }

    /// Force TanStack Query to invalidate + refetch every query whose key has
    /// `key_json` (a JSON array literal, e.g. `["sessions"]`) as a prefix, via
    /// the E2E-only `window.__ALM_E2E__.queryClient` bridge
    /// (`apps/desktop/src/main.tsx`, `VITE_E2E` gate) — the SAME QueryClient
    /// instance the mounted page reads from, not a page reload.
    ///
    /// Exists because a query younger than its 30s `staleTime`
    /// (`apps/desktop/src/data/queryClient.ts`) serves its cached value on
    /// remount/refocus WITHOUT a network refetch, so a `driver.refresh()`
    /// alone is only a reliable proof of freshness if the reload fully
    /// discarded the prior QueryClient's cache — not guaranteed on every
    /// WebDriver backend (root cause of the cross-PR
    /// `reconcile_drops_externally_deleted_frame_from_real_ui_count` flake,
    /// CI evidence: "last seen: Some(\"2\")" persisting the entire 15s wait,
    /// only possible from a served-stale-cache render, not a fresh backend
    /// read). Awaits `invalidateQueries`'s returned promise, which TanStack
    /// Query resolves only once every currently-active matching query's
    /// refetch settles, so the caller can assert the freshly-rendered DOM
    /// immediately after this returns.
    ///
    /// Lane nD's frontend reconcile invalidation (PR #517, MERGED) wires
    /// `sessions.all` + `inventory` prefix invalidation into the real
    /// "Reconcile" button's click handler
    /// (`apps/desktop/src/features/settings/DataSources.tsx::handleReconcile`)
    /// — but this journey triggers `inventory.reconcile.run` directly over
    /// the invoke bridge (documented KNOWN GAP, no UI trigger for that path),
    /// which #517's handler never runs. This is the freshness guarantee for
    /// that read, not belt-and-braces.
    ///
    /// The question this doc comment used to leave open — "re-evaluate
    /// whether `driver.refresh()` alone is sufficient" — is settled: it is
    /// not (#1113). A reload remounts the app through the setup gate and
    /// route restore, so the document a journey is asserting against can be
    /// torn down under it; the observed failure was an Inbox page with no
    /// `inbox-list` element at all for a full 20s budget while WebDriver went
    /// on serving detached row handles from the pre-reload document. Prefer
    /// this method for any settle-then-assert step, so the settle signal and
    /// the assertion read one live document. Reserve `driver.refresh()` for
    /// steps that are genuinely exercising reload or route-restore behaviour
    /// (see `complete_first_run_gate`, which needs a reload because the
    /// preferences module caches its localStorage read in module state).
    pub async fn invalidate_query(&self, key_json: &str) -> Result<()> {
        let script = format!(
            r#"
            var callback = arguments[arguments.length - 1];
            var e2e = window.__ALM_E2E__;
            if (!e2e || !e2e.queryClient) {{
                callback({{ ok: false, error: '__ALM_E2E__.queryClient bridge missing (build with VITE_E2E=1)' }});
                return;
            }}
            e2e.queryClient.invalidateQueries({{ queryKey: {key_json} }}).then(function () {{
                callback({{ ok: true }});
            }}).catch(function (err) {{
                callback({{ ok: false, error: String(err) }});
            }});
        "#
        );
        let outcome: InvokeOutcome = self
            .driver
            .execute_async(&script, vec![])
            .await
            .context("invalidate_query execute_async failed")?
            .convert()
            .context("failed to deserialise invalidate_query result")?;
        outcome.into_result::<Value>().map(drop)
    }

    /// Drain the last ~30 real browser console entries (chromedriver/
    /// WebView2 `"browser"` log type, W3C `GET /session/{id}/log`) — best
    /// effort. Some WebDriver stacks (notably older Edge/WebView2 driver
    /// builds) reject the log endpoint entirely; that's captured as an error
    /// string rather than failing the caller, per this module's diagnostics
    /// contract.
    pub async fn dump_console_log(&self) -> Value {
        match self.driver.get_log("browser").await {
            Ok(entries) => {
                let tail: Vec<_> = entries.iter().rev().take(30).rev().collect();
                json!({ "console_log": tail })
            }
            Err(e) => json!({ "console_log_error": e.to_string() }),
        }
    }

    // ---------------------------------------------------------------------
    // Real-DOM interaction helpers (additive, shared across per-area UI
    // journeys — inbox/calibration/targets/sessions/lifecycle/settings/
    // source-view/per-frame-inventory).
    // These drive the ACTUAL rendered `data-testid` elements (click/type/
    // read), never the invoke bridge, so journeys built on them are proving
    // real UI interaction rather than a second copy of the IPC-level tests.
    // ---------------------------------------------------------------------

    /// Locate a single element by its exact `data-testid` attribute.
    pub async fn find_testid(&self, testid: &str) -> Result<WebElement> {
        self.driver
            .find(By::Css(format!("[data-testid='{testid}']")))
            .await
            .with_context(|| format!("no element with data-testid={testid:?}"))
    }

    /// Locate the first element whose `data-testid` STARTS WITH `prefix` —
    /// for dynamic testids keyed by a real backend id (e.g.
    /// `plan-group-<planId>`, `inbox-item-<inboxItemId>`) that the journey
    /// doesn't know in advance.
    pub async fn find_testid_prefix(&self, prefix: &str) -> Result<WebElement> {
        self.driver
            .find(By::Css(format!("[data-testid^='{prefix}']")))
            .await
            .with_context(|| format!("no element with data-testid starting with {prefix:?}"))
    }

    /// All elements whose `data-testid` starts with `prefix`.
    pub async fn find_all_testid_prefix(&self, prefix: &str) -> Result<Vec<WebElement>> {
        self.driver
            .find_all(By::Css(format!("[data-testid^='{prefix}']")))
            .await
            .with_context(|| format!("query for data-testid prefix {prefix:?} failed"))
    }

    /// Lowercased, trimmed `textContent` of every element whose `data-testid`
    /// starts with `prefix`, read as ONE snapshot of the live document.
    ///
    /// Prefer this over [`Self::find_all_testid_prefix`] + per-element
    /// `.text()` whenever the texts are asserted on. The two-step form is not
    /// equivalent on a list that re-renders (the Inbox list swaps row nodes
    /// constantly): a handle can be detached before `.text()` reads it, and
    /// `.text()` on a detached handle raises `stale element reference`. A
    /// caller that defaults that error to `""` turns a WebDriver failure into
    /// something shaped like product data — the #1111 failure mode, which
    /// reported two blank Type badges the product can never render. A single
    /// snapshot cannot interleave with a re-render, and a driver failure
    /// propagates as an error rather than as text.
    pub async fn testid_prefix_texts(&self, prefix: &str) -> Result<Vec<String>> {
        let script = format!(
            r#"
            return JSON.stringify(
                Array.prototype.map.call(
                    document.querySelectorAll('[data-testid^="{prefix}"]'),
                    function (el) {{ return el.textContent || ''; }}
                )
            );
            "#
        );
        let raw = self
            .driver
            .execute(&script, vec![])
            .await
            .with_context(|| format!("snapshotting text for data-testid prefix {prefix:?} failed"))?
            .json()
            .as_str()
            .with_context(|| {
                format!("the {prefix:?} text snapshot script did not return a string")
            })?
            .to_owned();
        let texts: Vec<String> = serde_json::from_str(&raw)
            .with_context(|| format!("the {prefix:?} text snapshot was not a JSON array"))?;
        Ok(texts.into_iter().map(|t| t.trim().to_lowercase()).collect())
    }

    /// The dynamic suffix of the first `data-testid` starting with `prefix`
    /// (e.g. `prefix = "inbox-item-"` on `data-testid="inbox-item-abc123"`
    /// returns `"abc123"`) — lets a journey discover a real backend id from
    /// the rendered DOM instead of a second invoke round-trip.
    ///
    /// POLLS for the element (up to [`DEFAULT_FIND_TIMEOUT`]) rather than
    /// doing a single immediate lookup: this is frequently called straight
    /// after an action that triggers an async refetch + re-render (e.g. an
    /// Inbox rescan, which re-runs `inbox.scan` then re-fetches the list), so
    /// the row may not exist the instant this is called. Same
    /// route/refetch-render race [`Self::find_waiting`] documents — waiting
    /// here means callers don't each have to remember a preceding
    /// `wait_testid_prefix_present`.
    pub async fn testid_suffix(&self, prefix: &str) -> Result<String> {
        let deadline = Instant::now() + DEFAULT_FIND_TIMEOUT;
        let el = loop {
            if let Ok(el) = self.find_testid_prefix(prefix).await {
                break el;
            }
            if Instant::now() >= deadline {
                return Err(anyhow!(
                    "no data-testid starting with {prefix:?} appeared within {DEFAULT_FIND_TIMEOUT:?}"
                ));
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        };
        let full = el
            .attr("data-testid")
            .await
            .context("failed to read data-testid attribute")?
            .ok_or_else(|| anyhow!("element matched by prefix {prefix:?} has no data-testid"))?;
        full.strip_prefix(prefix)
            .map(str::to_owned)
            .ok_or_else(|| anyhow!("data-testid {full:?} did not start with {prefix:?}"))
    }

    /// `true` if an element with the exact `data-testid` is currently in the DOM.
    pub async fn testid_exists(&self, testid: &str) -> Result<bool> {
        use thirtyfour::error::WebDriverErrorInner;
        match self.driver.find(By::Css(format!("[data-testid='{testid}']"))).await {
            Ok(_) => Ok(true),
            Err(e) if matches!(e.as_inner(), WebDriverErrorInner::NoSuchElement(_)) => Ok(false),
            Err(e) => Err(e).context("testid_exists query failed"),
        }
    }

    /// Click the element with the given `data-testid`.
    pub async fn click_testid(&self, testid: &str) -> Result<()> {
        self.find_testid(testid)
            .await?
            .click()
            .await
            .with_context(|| format!("click {testid} failed"))
    }

    /// Rendered text content of the element with the given `data-testid`.
    pub async fn text_testid(&self, testid: &str) -> Result<String> {
        self.find_testid(testid)
            .await?
            .text()
            .await
            .with_context(|| format!("read text of {testid} failed"))
    }

    /// `true` when the element with the given `data-testid` is enabled — the
    /// real DOM `disabled` state, not an assumption from response shape.
    pub async fn is_enabled_testid(&self, testid: &str) -> Result<bool> {
        self.find_testid(testid).await?.is_enabled().await.context("is_enabled query failed")
    }

    /// Poll for an element with the given `data-testid` to appear, returning it.
    pub async fn wait_testid(&self, testid: &str, timeout: Duration) -> Result<WebElement> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Ok(el) = self.find_testid(testid).await {
                return Ok(el);
            }
            if Instant::now() >= deadline {
                return Err(anyhow!("data-testid={testid:?} never appeared within {timeout:?}"));
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    /// Poll until the element with the given `data-testid` becomes enabled.
    pub async fn wait_testid_enabled(&self, testid: &str, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            if self.is_enabled_testid(testid).await.unwrap_or(false) {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(anyhow!(
                    "data-testid={testid:?} never became enabled within {timeout:?}"
                ));
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    /// Poll until at least one element whose `data-testid` starts with
    /// `prefix` appears in the DOM.
    pub async fn wait_testid_prefix_present(&self, prefix: &str, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            if self.find_testid_prefix(prefix).await.is_ok() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(anyhow!(
                    "no data-testid starting with {prefix:?} appeared within {timeout:?}"
                ));
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    /// Poll until no element with the given `data-testid` remains in the DOM.
    pub async fn wait_testid_gone(&self, testid: &str, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            if !self.testid_exists(testid).await.unwrap_or(true) {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(anyhow!("data-testid={testid:?} never disappeared within {timeout:?}"));
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    /// Select an `<option>` by its `value` attribute on the
    /// `<select data-testid=..>`.
    ///
    /// NOT implemented via WebDriver's option-click
    /// (`SelectElement::select_by_value`): on WebKitGTK that click does not
    /// reliably fire the `change` event a React-CONTROLLED `<select
    /// onChange>` needs, so React never updates its state and re-renders the
    /// select straight back to its previous value (observed on the Inbox
    /// bulk-reclassify frame-type select, PR #457 — the checkbox on the same
    /// pane committed fine while every option-click silently reverted).
    /// Instead set the value and dispatch bubbling `input` + `change` events
    /// — exactly what Playwright's `selectOption` does — then VERIFY the
    /// value stuck.
    pub async fn select_testid(&self, testid: &str, value: &str) -> Result<()> {
        let el = self.find_testid(testid).await?;
        let script = r#"
            var el = arguments[0];
            var value = arguments[1];
            el.value = value;
            el.dispatchEvent(new Event('input',  { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return el.value;
        "#;
        let out: String = self
            .driver
            .execute(script, vec![el.to_json()?, json!(value)])
            .await
            .with_context(|| format!("select value {value:?} on {testid} failed"))?
            .convert()
            .context("failed to deserialise the select result")?;
        if out != value {
            return Err(anyhow!(
                "select {testid}: value {value:?} did not stick (got {out:?}) — \
                 is there an <option value={value:?}>?"
            ));
        }
        Ok(())
    }

    /// Clear then type into the `<input data-testid=..>`, verifying the typed
    /// value actually landed in the live DOM `.value` before returning —
    /// retrying through render churn if it didn't.
    ///
    /// Unlike `select_testid` (which already verifies its committed value,
    /// PR #457) and the search-input fill in `targets_journeys.rs` (verify +
    /// retry after #841's "typed into the wrong/stale element" garble), this
    /// helper previously trusted `clear()` + `send_keys()` blindly. On a
    /// CONTROLLED React input inside a pane that re-renders as async queries
    /// land (e.g. the Inbox bulk-property fields, which mount only once
    /// `inbox.property_registry` resolves), a re-render racing the keystrokes
    /// can silently drop or truncate them, leaving React state empty even
    /// though `send_keys` itself reported success — the caller (`handleBulkApply`)
    /// then skips the property entirely since it treats `''` as "unchanged".
    pub async fn fill_testid(&self, testid: &str, value: &str) -> Result<()> {
        let deadline = Instant::now() + DEFAULT_FIND_TIMEOUT;
        loop {
            let el = self.find_testid(testid).await?;
            el.clear().await.with_context(|| format!("clear {testid} failed"))?;
            el.send_keys(value).await.with_context(|| format!("send_keys {testid} failed"))?;
            let live_value: String = self
                .driver
                .execute("return arguments[0].value;", vec![el.to_json()?])
                .await
                .with_context(|| format!("reading live .value of {testid} failed"))?
                .convert()
                .with_context(|| format!("failed to deserialize live .value of {testid}"))?;
            if live_value == value {
                return Ok(());
            }
            if Instant::now() >= deadline {
                anyhow::bail!(
                    "fill {testid}: value {value:?} never stuck (last read: {live_value:?}) \
                     after retrying for {DEFAULT_FIND_TIMEOUT:?}"
                );
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    /// Poll `driver.find(by)` until it resolves an element or
    /// [`DEFAULT_FIND_TIMEOUT`] elapses.
    ///
    /// WHY this exists (CI-only bug, reproducible on ubuntu + windows,
    /// #457/#458): after `goto_route(..)` + `wait_bridge_ready(..)`, the
    /// target route's React component subtree has NOT necessarily finished
    /// mounting and painting its controls. `wait_bridge_ready` only proves
    /// `main.tsx` finished top-level module evaluation (the
    /// `window.__ALM_E2E__` bridge exists) — it says nothing about whether
    /// the current route's page component has rendered yet. A single
    /// immediate `driver.find(..)` for a page control (e.g. Inbox's "Rescan
    /// all roots" button) therefore RACES that render and intermittently
    /// fails with `no element with aria-label=..` on a slow CI runner, even
    /// though the string is correct and the control does render a beat later.
    /// Polling is the fix — the same wait primitive the `data-testid`
    /// helpers above already use, applied to the aria-label / button-text
    /// locators too.
    pub async fn find_waiting(&self, by: By, what: &str) -> Result<WebElement> {
        let deadline = Instant::now() + DEFAULT_FIND_TIMEOUT;
        loop {
            match self.driver.find(by.clone()).await {
                Ok(el) => return Ok(el),
                Err(e) => {
                    if Instant::now() >= deadline {
                        // Include the URL the page actually sits on — a
                        // missing element is very often "the app is on a
                        // different route", which this makes diagnosable
                        // straight from a CI log.
                        let url = self
                            .driver
                            .current_url()
                            .await
                            .map_or_else(|_| "<unknown>".to_owned(), |u| u.to_string());
                        return Err(e).with_context(|| {
                            format!(
                                "{what} never appeared within {DEFAULT_FIND_TIMEOUT:?} \
                                 (current URL: {url})"
                            )
                        });
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    /// Poll the text content of the element at `data-testid` until `predicate`
    /// accepts it or `timeout` elapses — the DOM-read equivalent of
    /// [`Self::invoke_until`], for asserting a real backend mutation (e.g. a
    /// reconcile pass) landed in a re-rendered, product-owned element instead
    /// of only in the IPC response.
    pub async fn wait_testid_text<P>(
        &self,
        testid: &str,
        timeout: Duration,
        mut predicate: P,
    ) -> Result<String>
    where
        P: FnMut(&str) -> bool,
    {
        let deadline = Instant::now() + timeout;
        let mut last_seen: Option<String> = None;
        loop {
            if let Ok(el) = self.driver.find(By::Css(format!("[data-testid='{testid}']"))).await {
                if let Ok(text) = el.text().await {
                    if predicate(&text) {
                        return Ok(text);
                    }
                    last_seen = Some(text);
                }
            }
            if Instant::now() >= deadline {
                return Err(anyhow!(
                    "text of data-testid={testid:?} never matched within {timeout:?} \
                     (last seen: {last_seen:?})"
                ));
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    /// Click an element located by its exact `aria-label` — for the few real
    /// controls that carry no `data-testid` (e.g. Inbox's "Rescan all roots",
    /// whose label is more stable across i18n pluralisation than its text
    /// node). Polls for the element (via [`Self::find_waiting`]) rather than
    /// doing a single immediate lookup, so it survives the route-render race
    /// described on `find_waiting` (the CI `no element with aria-label=..`
    /// failure this fix addresses).
    pub async fn click_by_aria_label(&self, label: &str) -> Result<()> {
        let xpath = format!("//*[@aria-label={}]", escape_string(label));
        self.find_waiting(By::XPath(&xpath), &format!("element with aria-label={label:?}"))
            .await?
            .click()
            .await
            .with_context(|| format!("click aria-label={label:?} failed"))
    }

    /// Complete the app's first-run gate the way the wizard's Finish step
    /// does (`SetupWizard.tsx`), without driving the wizard UI.
    ///
    /// Journeys that visit ANY shell page need this: the Shell component
    /// itself redirects every route to `/setup` while the `setupCompleted`
    /// localStorage preference is false (`apps/desktop/src/app/Shell.tsx` —
    /// a second gate besides the index route's `beforeLoad`, and the reason
    /// `/#/inbox` bounced back to `/#/setup` on CI run 28767450494 even
    /// after the hash-history fix).
    ///
    /// Mirrors the wizard's completion sequence:
    /// 1. `firstrun.complete` (backend gate — the CALLER must already have
    ///    registered at least one raw and one project source, its real
    ///    preconditions);
    /// 2. set `setupCompleted: true` in the `alm-preferences` localStorage
    ///    blob (what `SetupWizard` does via `setPreference`);
    /// 3. reload the page — the preferences module caches its localStorage
    ///    read in module state (`apps/desktop/src/data/preferences.ts`), so
    ///    a direct localStorage write is invisible until a fresh page load.
    pub async fn complete_first_run_gate(&self) -> Result<()> {
        self.complete_first_run_gate_impl(true).await
    }

    /// Like [`Self::complete_first_run_gate`] but LEAVES spec-056 onboarding
    /// enabled, so the orientation walk auto-runs and the Getting-started
    /// checklist renders. Only `onboarding_journey.rs` (VC-004) needs this;
    /// every other journey suppresses onboarding so the walk's modal overlay
    /// never intercepts its own UI interactions.
    pub async fn complete_first_run_gate_onboarding(&self) -> Result<()> {
        self.complete_first_run_gate_impl(false).await
    }

    /// Shared first-run gate completion. When `suppress_onboarding` is true the
    /// deterministic onboarding suppression flag is set before the reload so
    /// neither the walk nor the checklist renders (`isOnboardingSuppressed()`,
    /// `apps/desktop/src/features/onboarding/store.ts`).
    async fn complete_first_run_gate_impl(&self, suppress_onboarding: bool) -> Result<()> {
        let _: Value = self
            .invoke("firstrun_complete", json!({}))
            .await
            .context("firstrun.complete failed — were a raw AND a project source registered?")?;

        let script = r#"
            var raw = localStorage.getItem('alm-preferences');
            var prefs = {};
            try { prefs = raw ? JSON.parse(raw) : {}; } catch (e) { prefs = {}; }
            prefs.setupCompleted = true;
            localStorage.setItem('alm-preferences', JSON.stringify(prefs));
        "#;
        self.driver
            .execute(script, vec![])
            .await
            .context("failed to persist setupCompleted preference")?;

        // Write the flag EXPLICITLY in both directions, before the reload so the
        // onboarding store reads it at boot.
        //
        // Clearing it in the `false` branch is not redundant: on Windows the
        // webview's localStorage is NOT isolated per test the way the DB and
        // app-data dirs are. `InstanceEnv` redirects APPDATA/LOCALAPPDATA, but
        // WebView2 does not resolve its user-data folder from those, so every
        // test in a shard shares one localStorage origin. Each journey that
        // calls the suppressing variant leaves the flag set, and whichever
        // onboarding-enabled test runs after it inherits the suppression and
        // silently renders no walk. That is exactly what made
        // `orientation_walk_then_real_confirm_renders_live_auto_tick` fail on
        // Windows shard 2/2 only, deterministically, while passing on every
        // ubuntu shard (WebKitGTK honours the redirected XDG dirs, so each
        // process really does get a clean profile).
        //
        // Diagnosed from the failure-path dump in `onboarding_journey.rs`:
        // `suppressedFlag:"true"` with a healthy backend and a mounted shell.
        let flag_script = if suppress_onboarding {
            // Otherwise the spec-056 US1 walk auto-runs and its modal overlay
            // intercepts every subsequent `goto_route`/click in the journey.
            r#"localStorage.setItem('alm-onboarding-suppressed', 'true');"#
        } else {
            r#"localStorage.removeItem('alm-onboarding-suppressed');"#
        };
        self.driver
            .execute(flag_script, vec![])
            .await
            .context("failed to write the onboarding suppression flag")?;

        // KEEP the reload (#1113 reviewed): this is not a settle step. The
        // preferences module caches its localStorage read in module state, so
        // the write above is invisible without a fresh page load —
        // `invalidate_query` cannot substitute for it.
        self.driver.refresh().await.context("page refresh after first-run completion failed")?;
        self.wait_document_ready(Duration::from_secs(10)).await?;
        self.wait_bridge_ready(Duration::from_secs(15)).await?;

        // Verify the preference actually survived the reload: if the
        // webview's storage backend dropped it, every shell route would
        // silently bounce back to /setup — fail HERE with a named cause
        // instead of a downstream "element never appeared".
        let persisted: bool = self
            .driver
            .execute(
                r#"
                try {
                    var raw = localStorage.getItem('alm-preferences');
                    return raw ? JSON.parse(raw).setupCompleted === true : false;
                } catch (e) { return false; }
                "#,
                vec![],
            )
            .await
            .context("failed to read back the setupCompleted preference")?
            .convert()
            .context("failed to deserialise the setupCompleted read-back")?;
        if !persisted {
            return Err(anyhow!(
                "setupCompleted=true did not persist in localStorage across the reload — \
                 the webview storage backend dropped the preference"
            ));
        }
        Ok(())
    }

    /// Fill an `<input>`/`<select>`-less text field located by its exact
    /// `aria-label` (clear then type) — for real form fields that carry no
    /// `data-testid` (e.g. `TargetSearch`'s combobox input). Polls for the
    /// element (via [`Self::find_waiting`]) rather than doing a single
    /// immediate lookup, so it survives the same route-render race
    /// `find_waiting` documents.
    pub async fn fill_by_aria_label(&self, label: &str, value: &str) -> Result<()> {
        let xpath = format!("//*[@aria-label={}]", escape_string(label));
        let el = self
            .find_waiting(By::XPath(&xpath), &format!("element with aria-label={label:?}"))
            .await?;
        el.clear().await.with_context(|| format!("clear aria-label={label:?} failed"))?;
        el.send_keys(value).await.with_context(|| format!("send_keys aria-label={label:?} failed"))
    }

    /// Click the first `<button>` whose full trimmed text content equals
    /// `text` exactly — for real controls with no `data-testid` and no
    /// stable `aria-label` (e.g. Settings' "+ Add site" / "Save" buttons).
    /// Only safe to use when `text` is unambiguous in the current DOM (no
    /// two same-labelled buttons visible at once) — callers with an
    /// ambiguity risk (e.g. a dialog whose confirm button repeats a trigger
    /// button's label) should scope the search to a container element
    /// instead via `app.driver.find(...)` + `WebElement::find(...)`. Polls
    /// for the element (via [`Self::find_waiting`]) rather than doing a
    /// single immediate lookup, so it survives the same route-render race
    /// `find_waiting` documents.
    pub async fn click_button_text(&self, text: &str) -> Result<()> {
        let xpath = format!("//button[normalize-space(.)={}]", escape_string(text));
        self.find_waiting(By::XPath(&xpath), &format!("<button> with text {text:?}"))
            .await?
            .click()
            .await
            .with_context(|| format!("click button text={text:?} failed"))
    }

    /// Count of elements anywhere on the page whose `title` attribute equals
    /// `title` exactly — a real, coarse but honest way to assert a specific
    /// disclosure/placeholder tooltip is (or is not) present, when the
    /// underlying element carries no `data-testid` (e.g. the Targets table's
    /// per-row "Opposition date unknown" / "Lunar distance unknown"
    /// disclosures, spec 047). NOT routed through [`Self::find_waiting`]:
    /// callers use this to assert an ABSENCE (a zero count is frequently the
    /// expected, correct result), so polling for presence here would be
    /// wrong — callers that need to wait for a nonzero count should poll
    /// this fn themselves.
    pub async fn count_elements_with_title(&self, title: &str) -> Result<usize> {
        let xpath = format!("//*[@title={}]", escape_string(title));
        Ok(self
            .driver
            .find_all(By::XPath(&xpath))
            .await
            .with_context(|| format!("query for title={title:?} failed"))?
            .len())
    }

    /// Count of `<button>`s anywhere on the page whose full trimmed text
    /// content equals `text` exactly — used as a real, honest "no such
    /// control exists" check (e.g. proving no global "Save" button exists on
    /// a settings pane, spec 018's auto-save-only convention). NOT routed
    /// through [`Self::find_waiting`] for the same reason as
    /// [`Self::count_elements_with_title`]: a zero count is frequently the
    /// expected, correct result.
    pub async fn count_buttons_with_text(&self, text: &str) -> Result<usize> {
        let xpath = format!("//button[normalize-space(.)={}]", escape_string(text));
        Ok(self
            .driver
            .find_all(By::XPath(&xpath))
            .await
            .with_context(|| format!("query for button text={text:?} failed"))?
            .len())
    }

    /// Read an `aria-label`ed checkbox's checked state (e.g. a `Toggle`
    /// component) — real DOM state, not an assumption from response shape.
    /// Polls for the element (via [`Self::find_waiting`]) rather than doing a
    /// single immediate lookup, so it survives the same route-render race
    /// `find_waiting` documents.
    pub async fn checkbox_checked_by_aria_label(&self, label: &str) -> Result<bool> {
        let xpath = format!("//*[@aria-label={}]", escape_string(label));
        self.find_waiting(By::XPath(&xpath), &format!("element with aria-label={label:?}"))
            .await?
            .is_selected()
            .await
            .with_context(|| format!("is_selected() on aria-label={label:?} failed"))
    }

    /// Close the app's window gracefully (round 3, fix-464-theme) before
    /// falling through to the ordinary [`Self::shutdown`] teardown, so a
    /// value written to `localStorage` right before this call actually
    /// survives a following [`Self::relaunch`].
    ///
    /// [`Self::shutdown`]'s `driver.quit()` makes the `tauri-webdriver` CLI
    /// force-kill the app process — the CLI's only handle on the app's
    /// lifetime (see `blocking_session_delete`'s doc). CI evidence (run
    /// 28808552431, then run 28810006837 even with a 1s pre-kill flush
    /// delay) shows this reliably loses a `localStorage` write on Windows:
    /// the raw value read back after a relaunch was `null`, not merely
    /// stale — WebView2 commits `localStorage` to its on-disk LevelDB-backed
    /// store on a graceful shutdown, not on a timer, so a delay before an
    /// abrupt kill cannot save it.
    ///
    /// Triggers a REAL native window close — `@tauri-apps/api/window`'s
    /// `getCurrentWindow().close()` (dynamically imported the same way
    /// `apps/desktop/src/data/theme.ts`'s `syncNativeWindowTheme` already
    /// does), not DOM's bare `window.close()` (a no-op for a top-level
    /// window in most engines). This app has no `on_window_event`/
    /// `CloseRequested` handler (`apps/desktop/src-tauri/src/lib.rs`), so
    /// closing the only window exits the process the same way the native
    /// Quit menu item's `app.exit(0)` does (`lib.rs`'s `on_menu_event`) —
    /// real-user fidelity, not a synthetic teardown path.
    ///
    /// Polls for the `__ALM_E2E__` bridge to actually disappear (proof the
    /// window/process tore down) rather than trusting the `close()` promise
    /// resolved before the OS finished reaping the process, then hands off
    /// to [`Self::shutdown`] — by then the app is normally already gone, so
    /// that call is just cleaning up the (already-dead) CLI session and
    /// freeing its proxy port, not the thing that kills the app.
    ///
    /// Falls back to [`Self::shutdown`]'s abrupt kill if the graceful close
    /// doesn't complete within the deadline (e.g. the dynamic import fails
    /// outside a real Tauri runtime) — best-effort, never hangs a journey.
    pub async fn graceful_shutdown(self) -> Result<()> {
        let script = r#"
            var callback = arguments[arguments.length - 1];
            import('@tauri-apps/api/window').then(function (mod) {
                return mod.getCurrentWindow().close();
            }).then(function () {
                callback(true);
            }).catch(function () {
                callback(false);
            });
        "#;
        let _: bool = self
            .driver
            .execute_async(script, vec![])
            .await
            .ok()
            .and_then(|ret| ret.convert::<bool>().ok())
            .unwrap_or(false);

        // Proof the window/process actually tore down: once it has, WebDriver
        // commands against the now-gone window/session fail — treat any
        // error the same as an explicit "bridge gone" (`Ok(false)`).
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self.bridge_ready().await {
                Ok(false) | Err(_) => break,
                Ok(true) if Instant::now() >= deadline => break,
                Ok(true) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
        // Small extra margin for the OS to finish reaping the process right
        // after the window/webview teardown completes.
        tokio::time::sleep(Duration::from_millis(200)).await;

        self.shutdown().await
    }

    /// Quit the WebDriver session and kill the `tauri-webdriver` CLI process
    /// if present. Quitting the session (a `DELETE /session/{id}` through the
    /// CLI) makes the CLI terminate the app process it launched on our
    /// behalf; killing the CLI afterwards frees its proxy port.
    pub async fn shutdown(mut self) -> Result<()> {
        // `quit()` consumes the WebDriver, which can't be moved out of a
        // Drop-implementing type; WebDriver is a cheap Arc-backed handle, so
        // quitting a clone quits the same underlying session.
        let _ = self.driver.clone().quit().await;
        if let Some(mut child) = self.driver_proc.take() {
            kill_driver_proc(&mut child);
        }
        Ok(())
    }
}

impl Drop for E2eApp {
    /// Best-effort teardown for journeys that bail mid-way with `?` and never
    /// reach [`E2eApp::shutdown`]. Without this, the failed test leaks the
    /// `tauri-webdriver` CLI AND the app it launched, which would poison every
    /// later launch sharing this process — this is exactly what CI run
    /// 28694907445's TRY-2 `can not listen to address: 127.0.0.1:4444` /
    /// `Plugin server not ready after timeout` cascade was, back when ports
    /// were fixed at 4444/4445 instead of allocated per process
    /// ([`InstanceEnv`]).
    ///
    /// `driver.quit()` is async and cannot be awaited here, so the app-kill
    /// is requested with a synchronous raw-HTTP `DELETE /session/…` instead:
    /// the CLI kills its app process after ANY session-delete round trip,
    /// regardless of the session id being real.
    fn drop(&mut self) {
        if let Some(mut child) = self.driver_proc.take() {
            blocking_session_delete(instance_env().proxy_port);
            kill_driver_proc(&mut child);
        }
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Kill and reap the `tauri-webdriver` CLI child process (best-effort).
///
/// `std::process::Child` does NOT kill on drop — letting it fall out of scope
/// leaves the CLI alive and its port occupied (the CI TRY-2 leak).
fn kill_driver_proc(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Synchronously send `DELETE /session/e2e-cleanup` to the `tauri-webdriver`
/// CLI (on `proxy_port`) over a raw std TCP socket (best-effort, short
/// timeouts, no async and no extra HTTP-client dependency — this must be
/// callable from `Drop`).
///
/// The CLI kills the app process it launched after ANY `/session/{id}` DELETE
/// round trip (it does not validate the id) — this is the only handle we have
/// on the app's lifetime, since the CLI spawned it, not the harness.
fn blocking_session_delete(proxy_port: u16) {
    let attempt = || -> std::io::Result<()> {
        let addr = format!("127.0.0.1:{proxy_port}");
        let timeout = Duration::from_secs(5);
        let mut stream = std::net::TcpStream::connect_timeout(&addr.parse().unwrap(), timeout)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        use std::io::{Read, Write};
        stream.write_all(
            format!(
                "DELETE /session/e2e-cleanup HTTP/1.1\r\n\
                 Host: 127.0.0.1:{proxy_port}\r\n\
                 Content-Length: 0\r\n\
                 Connection: close\r\n\r\n"
            )
            .as_bytes(),
        )?;
        // Wait for the response (the CLI kills the app only AFTER the
        // forwarded round trip completes); the body content is irrelevant.
        let mut buf = Vec::new();
        let _ = stream.read_to_end(&mut buf);
        Ok(())
    };
    let _ = attempt();
}

/// Pre-flight check: verify the `tauri-webdriver` CLI is on `$PATH` and the
/// `desktop_shell` binary has been built, with a named, actionable error for
/// each (FR-015). Old per-OS driver checks (`WebKitWebDriver`/`msedgedriver`)
/// are obsolete since D10 standardized on `tauri-plugin-webdriver` for every
/// OS — there is no per-OS native driver binary left to check.
fn preflight() -> Result<()> {
    check_tauri_webdriver_cli()?;
    check_app_binary()?;
    Ok(())
}

/// Verify `tauri-webdriver` is reachable on `$PATH` by attempting to spawn it.
/// A spawn failure with `NotFound` means the CLI is missing; any other
/// outcome (including a non-zero exit from an unrecognised flag) means the
/// binary exists.
fn check_tauri_webdriver_cli() -> Result<()> {
    match Command::new("tauri-webdriver").arg("--help").output() {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(anyhow!(
            "the `tauri-webdriver` CLI is not on $PATH.\n\
             Install it with: cargo install tauri-webdriver --locked\n\
             (mirrors the \"Install tauri-webdriver CLI\" step in .github/workflows/e2e.yml)"
        )),
        Err(e) => Err(e).context("failed to probe for the tauri-webdriver CLI on $PATH"),
    }
}

/// Verify the `desktop_shell` binary this harness will launch actually
/// exists, so a missing build fails with a named error here instead of a
/// confusing WebDriver session-creation failure.
fn check_app_binary() -> Result<()> {
    let path = app_binary_path()?;
    if path.is_file() {
        Ok(())
    } else {
        Err(anyhow!(
            "desktop_shell binary not found at {}.\n\
             Build it with: cargo build -p desktop_shell --features e2e\n\
             Or point at an existing build with: ALM_E2E_APP_BIN=/path/to/binary",
            path.display()
        ))
    }
}

/// Resolve the path to the built `desktop_shell` binary.
///
/// Mirrors `.github/workflows/e2e.yml`'s "Build desktop_shell with e2e
/// feature" step (`cargo build -p desktop_shell --features e2e`), which
/// places the binary at `<workspace_root>/target/debug/desktop_shell[.exe]`.
/// Override with `ALM_E2E_APP_BIN=/path/to/binary` (documented in
/// `quickstart.md`) to point at a different build (e.g. a release profile).
fn app_binary_path() -> Result<PathBuf> {
    if let Ok(path) = std::env::var("ALM_E2E_APP_BIN") {
        return Ok(PathBuf::from(path));
    }

    // CARGO_MANIFEST_DIR is `<workspace_root>/crates/e2e-tests` at compile time.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(std::path::Path::parent)
        .ok_or_else(|| anyhow!("failed to resolve workspace root from CARGO_MANIFEST_DIR"))?;

    let binary_name = if cfg!(windows) { "desktop_shell.exe" } else { "desktop_shell" };
    Ok(workspace_root.join("target").join("debug").join(binary_name))
}

/// Cap on buffered lines per stream in [`ProcLog`] — [`E2eApp::launch_with`]'s
/// failure path is the only reader and only cares about the tail of a
/// [`LAUNCH_TIMEOUT`]-bounded window, so this stays cheap even if the CLI or
/// app is chatty for the rest of a long-running journey.
const DIAGNOSTIC_LOG_LINES: usize = 200;

/// Bounded ring-buffer capture of the `tauri-webdriver` CLI child process's
/// stdout/stderr, drained continuously by background threads (see
/// [`drain_into`]) — diagnostics only, never read except on a launch failure
/// in [`E2eApp::launch_with`]. Previously nothing surfaced whether the app
/// even started on a launch failure (undiagnosable macOS `Connection refused`
/// runs, issue #489); the CLI's own child (`desktop_shell`) inherits stdio
/// from the CLI by default, so piping the CLI's streams transitively
/// captures the app's own console output too, not just the CLI's log.
struct ProcLog {
    stdout: Arc<Mutex<VecDeque<String>>>,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

impl ProcLog {
    fn dump(&self) -> String {
        format!(
            "--- tauri-webdriver CLI stdout (last {DIAGNOSTIC_LOG_LINES} lines; \
             desktop_shell inherits this fd by default, so its own console output \
             normally appears here too) ---\n{}\n\
             --- tauri-webdriver CLI stderr ---\n{}",
            Self::render(&self.stdout),
            Self::render(&self.stderr),
        )
    }

    fn render(buf: &Arc<Mutex<VecDeque<String>>>) -> String {
        let lines = buf.lock().unwrap();
        if lines.is_empty() {
            "<empty>".to_owned()
        } else {
            lines.iter().cloned().collect::<Vec<_>>().join("\n")
        }
    }
}

/// Spawn a background thread draining `reader` line-by-line into `buf`
/// (bounded to [`DIAGNOSTIC_LOG_LINES`]). Draining is mandatory, not just for
/// diagnostics: an unread OS pipe fills and blocks the writing process once
/// its buffer is full, which would hang the CLI — and therefore the app it
/// launched — mid-journey, long after a successful launch moved past the
/// code that reads this buffer's contents.
fn drain_into<R: std::io::Read + Send + 'static>(reader: R, buf: Arc<Mutex<VecDeque<String>>>) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let mut buf = buf.lock().unwrap();
            if buf.len() >= DIAGNOSTIC_LOG_LINES {
                buf.pop_front();
            }
            buf.push_back(line);
        }
    });
}

/// Spawn the `tauri-webdriver` CLI proxy as a background child process,
/// bound to this instance's isolated ports/DB/app-data root ([`InstanceEnv`]).
///
/// Mirrors `.github/workflows/e2e.yml`: the CLI is installed once
/// (`cargo install tauri-webdriver --locked`) and this harness starts it per
/// session. `--port`/`--native-port` select this instance's ephemeral ports.
///
/// `tauri-webdriver`'s own `Command::new(&app_path)` (spawning
/// `desktop_shell`) does not `env_clear()`, so every env var set here —
/// `TAURI_WEBDRIVER_PORT` (read by `tauri_plugin_webdriver::init()`,
/// `apps/desktop/src-tauri/src/lib.rs`) matching `--native-port`,
/// `ALM_DB_URL`, and the app-data/config dir overrides — propagates
/// transitively into the app process, isolating it without touching
/// `.github/workflows/e2e.yml`.
///
/// stdout/stderr are piped (not inherited) and drained into a [`ProcLog`] so
/// a launch failure can print what the CLI (and transitively, the app it
/// launched) actually did — see [`ProcLog`]'s docs.
fn spawn_tauri_webdriver(env: &InstanceEnv) -> Result<(Child, ProcLog)> {
    let mut cmd = Command::new("tauri-webdriver");
    cmd.arg("--port")
        .arg(env.proxy_port.to_string())
        .arg("--native-port")
        .arg(env.native_port.to_string())
        .env("TAURI_WEBDRIVER_PORT", env.native_port.to_string())
        .env("ALM_DB_URL", format!("sqlite://{}?mode=rwc", env.db_path.display()))
        // `env.native_port` is already unique per test process (see
        // `pick_port_pair`), so it doubles as a cheap per-instance marker.
        // Its mere presence tells `apps/desktop/src-tauri/src/lib.rs` to skip
        // the single-instance plugin entirely (see that file's plugin
        // registration): the plugin enforces one identifier-derived identity
        // with a per-instance override only on Linux, so concurrently-launched
        // `desktop_shell` instances otherwise collide and the loser is
        // silently redirected/exited without opening a window (WebDriver then
        // times out). Real users/non-e2e builds never set this, so the guard
        // stays active for them.
        .env("ALM_E2E_INSTANCE_ID", env.native_port.to_string())
        // OS-trash boundary double for headless CI. The Windows Shell trash
        // (`trash::delete` -> `IFileOperation`) needs an interactive
        // window-station/desktop and blocks indefinitely in the non-interactive
        // CI runner context — verified: a real interactive Windows desktop
        // trashes on every volume (incl. external + no-Recycle-Bin) in <300ms,
        // only the headless session hangs. A real Recycle-Bin move is
        // unperformable here, so the app does a deterministic filesystem
        // removal instead (see `fs_executor::ops::trash_op`), matching the
        // FakeSpawner/FakeResolver boundary pattern. Production/live never sets
        // this and always uses real OS trash.
        .env("ALM_E2E_OS_TRASH_FAKE", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in &env.vars {
        cmd.env(key, value);
    }
    let mut child = cmd.spawn().map_err(|e| {
        anyhow!(
            "failed to spawn tauri-webdriver: {e} \
             (install with `cargo install tauri-webdriver --locked`)"
        )
    })?;

    let stdout_buf = Arc::new(Mutex::new(VecDeque::new()));
    let stderr_buf = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(stdout) = child.stdout.take() {
        drain_into(stdout, stdout_buf.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        drain_into(stderr, stderr_buf.clone());
    }

    Ok((child, ProcLog { stdout: stdout_buf, stderr: stderr_buf }))
}

/// Reset the application database so each test starts from a clean state.
///
/// FR-006: if `ALM_DB_URL` is set and looks like `sqlite://PATH?...`, strip
/// the `sqlite://` prefix and everything from `?` onward, then remove that
/// file (errors are ignored so a missing file doesn't fail startup).
///
/// The app connects to exactly this instance's isolated `db_path`
/// ([`InstanceEnv`], passed through as `ALM_DB_URL` by
/// [`spawn_tauri_webdriver`]), so no other process/journey can share or race
/// this file. Without removing it here, state would accumulate ACROSS
/// sequential launches within the SAME process (`relaunch()`, or a journey
/// that calls `launch()` more than once) — a journey that completes
/// first-run leaves `firstrun.complete` + its registered roots +
/// unacknowledged inbox items behind for the next launch, breaking both the
/// fresh-DB startup-redirect expectation and every "only item in the list"
/// selection. The `-wal`/`-shm` sidecars are removed too so SQLite can't
/// replay a stale WAL into the fresh DB.
fn reset_database(db_path: &Path) -> Result<()> {
    let _ = std::fs::remove_file(db_path);
    for sidecar in ["-wal", "-shm"] {
        let mut os = db_path.as_os_str().to_owned();
        os.push(sidecar);
        let _ = std::fs::remove_file(PathBuf::from(os));
    }
    Ok(())
}

/// Best-effort wipe of the webview's persisted web storage (localStorage &
/// co.) so preferences set by one journey (`alm-preferences.setupCompleted`,
/// grouping dims, theme) can't leak into the next. Without this, a journey
/// that completes first-run leaves `setupCompleted: true` behind, and the
/// next launch's `SetupPage` immediately bounces `/setup` → `/inbox`
/// (`SetupPage.tsx`), breaking the fresh-DB startup-redirect expectation the
/// journeys share. Called before the app process is spawned, so nothing
/// holds these files open. Failures are ignored (first run has no storage).
///
/// `vars` is this instance's [`InstanceEnv::vars`] — the SAME env overrides
/// passed to the spawned app, so paths resolved here always match where the
/// app actually writes, never the real (unisolated) OS profile.
fn reset_webview_storage(vars: &[(&'static str, String)]) {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "windows") {
        // WebView2 keeps ALL web storage under the user-data folder tauri
        // points at `<app_local_data_dir>/EBWebView`.
        if let Some(local) = lookup(vars, "LOCALAPPDATA") {
            candidates
                .push(PathBuf::from(local).join("dev.astro-plan.astro-library-manager/EBWebView"));
        }
    } else if cfg!(target_os = "macos") {
        // WKWebView website data (incl. localStorage) lives under
        // ~/Library/WebKit/<identifier>/WebsiteData.
        if let Some(home) = lookup(vars, "HOME") {
            candidates.push(
                PathBuf::from(home)
                    .join("Library/WebKit/dev.astro-plan.astro-library-manager/WebsiteData"),
            );
        }
    } else if let Some(dir) = app_data_dir(vars) {
        // WebKitGTK stores localStorage / IndexedDB inside the app data dir.
        candidates.push(dir.join("localstorage"));
        candidates.push(dir.join("storage"));
    }
    for path in candidates {
        let _ = std::fs::remove_dir_all(path);
    }
}

/// Reset `tauri-plugin-window-state`'s persisted geometry (spec 051 US4)
/// before each journey launch, for the same reason `reset_database()` and
/// `reset_webview_storage()` exist: sequential journeys in the same CI job
/// share one real OS user profile, so without this a later journey's app
/// process restores whatever size/position/maximized state an EARLIER
/// journey's process happened to exit in. Kept as a defensive hygiene reset
/// (a restored off-screen/minimized geometry is a real way to hang WebDriver
/// element queries), but it is NOT a fix for the Windows real-UI E2E failure
/// on `inbox_ui_mixed_folder_splits_into_single_type_items`: CI run
/// 28782673323 (main@9ee504d1, BEFORE this function existed) and run
/// 28786351305 (this branch, AFTER it landed) fail identically — same
/// "found 0" assertion, same ~152s duration, on both TRY 1 and TRY 2. The
/// real root cause of that failure is still open; see the diagnostic dump
/// added at the failure site in `inbox_ui_journeys.rs` (round 3,
/// fix-main-e2e-interplay) for the next data point.
///
/// The plugin's default store is `.window-state.json` under
/// `app.path().app_config_dir()` (`tauri-plugin-window-state` source) —
/// which is a DIFFERENT directory than `app_data_dir()` on Linux
/// (`$XDG_CONFIG_HOME`/`~/.config` vs `$XDG_DATA_HOME`/`~/.local/share`) but
/// the SAME directory on Windows (`%APPDATA%`) and macOS
/// (`~/Library/Application Support`).
/// Failures are ignored (first run has no window-state file yet).
///
/// `vars` — see [`reset_webview_storage`]'s doc on why this takes the
/// instance's env overrides instead of reading the real OS env.
fn reset_window_state(vars: &[(&'static str, String)]) {
    if let Some(dir) = app_config_dir(vars) {
        let _ = std::fs::remove_file(dir.join(".window-state.json"));
    }
}

/// Look up `key` in an [`InstanceEnv::vars`]-shaped override list.
fn lookup<'a>(vars: &'a [(&'static str, String)], key: &str) -> Option<&'a str> {
    vars.iter().find(|(k, _)| *k == key).map(|(_, v)| v.as_str())
}

/// Resolve the per-OS Tauri `app_config_dir` for the app identifier
/// `dev.astro-plan.astro-library-manager` (`tauri.conf.json`) under this
/// instance's isolated env overrides (`vars`, [`InstanceEnv::vars`]) instead
/// of the real OS env. Mirrors `tauri::path::PathResolver::app_config_dir`
/// (`dirs::config_dir()/<identifier>`) without needing a Tauri runtime in the
/// test harness:
/// - Linux:   `$XDG_CONFIG_HOME`
/// - macOS:   `~/Library/Application Support` (same as `app_data_dir`)
/// - Windows: `%APPDATA%` (roaming, same as `app_data_dir`)
fn app_config_dir(vars: &[(&'static str, String)]) -> Option<PathBuf> {
    const APP_IDENTIFIER: &str = "dev.astro-plan.astro-library-manager";
    let base = if cfg!(target_os = "windows") {
        lookup(vars, "APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        lookup(vars, "HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        lookup(vars, "XDG_CONFIG_HOME").map(PathBuf::from)
    };
    base.map(|b| b.join(APP_IDENTIFIER))
}

/// Resolve the per-OS Tauri `app_data_dir` for the app identifier
/// `dev.astro-plan.astro-library-manager` (`tauri.conf.json`) under this
/// instance's isolated env overrides (`vars`, [`InstanceEnv::vars`]) instead
/// of the real OS env. Mirrors `tauri::path::PathResolver::app_data_dir`
/// (`dirs::data_dir()/<identifier>`) without needing a Tauri runtime in the
/// test harness:
/// - Linux:   `$XDG_DATA_HOME`
/// - macOS:   `~/Library/Application Support`
/// - Windows: `%APPDATA%` (roaming)
fn app_data_dir(vars: &[(&'static str, String)]) -> Option<PathBuf> {
    const APP_IDENTIFIER: &str = "dev.astro-plan.astro-library-manager";
    let base = if cfg!(target_os = "windows") {
        lookup(vars, "APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        lookup(vars, "HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        lookup(vars, "XDG_DATA_HOME").map(PathBuf::from)
    };
    base.map(|b| b.join(APP_IDENTIFIER))
}

// ---------------------------------------------------------------------------
// FITS fixture writer
// ---------------------------------------------------------------------------

/// Write a minimal single-block (2880-byte) FITS file with the given header
/// cards, so journeys can drive the real inbox classify/confirm/ingest
/// pipeline against real files on disk (no product code touched).
///
/// Mirrors the proven fixture writer already used by
/// `crates/app/inbox/src/confirm.rs` tests and
/// `crates/app/core/tests/ingest_sessions_integration.rs` (T045/T046) — same
/// card set, same padding — so the real classifier/session-grouping code
/// accepts it exactly as it does at Layer 1.
///
/// Writes **no** `EXPTIME` card, so every frame type routes to the
/// `__needs_review__` sentinel (T070 mandatory-attribute gate: lights need
/// `OBJECT`+`FILTER`+`EXPTIME`, darks need `EXPTIME`+`GAIN`). That is what the
/// needs-review journeys want; a journey that needs a frame to actually
/// CLASSIFY must use [`write_minimal_fits_with_exposure`].
pub fn write_minimal_fits(
    dir: &Path,
    name: &str,
    imagetyp: &str,
    object: Option<&str>,
    filter: Option<&str>,
    date_obs: Option<&str>,
) -> Result<PathBuf> {
    write_minimal_fits_with_exposure(dir, name, imagetyp, object, filter, date_obs, None)
}

/// [`write_minimal_fits`] plus an optional `EXPTIME` card.
///
/// `EXPTIME` is a hard mandatory attribute for lights AND darks
/// (`mandatory_set_for`, `crates/app/inbox/src/classify.rs`), so it is the
/// difference between a fixture that classifies into a real grouping bucket
/// and one that collapses into the single `__needs_review__` sentinel bucket.
/// Header set matches the Layer-1 `t066_mixed_folder_produces_n_sub_items`
/// fixtures (`EXPTIME=300.0`, `GAIN=100`), which prove a light + a dark
/// materialize as two distinct single-type sub-items.
pub fn write_minimal_fits_with_exposure(
    dir: &Path,
    name: &str,
    imagetyp: &str,
    object: Option<&str>,
    filter: Option<&str>,
    date_obs: Option<&str>,
    exposure_s: Option<f64>,
) -> Result<PathBuf> {
    let path = dir.join(name);
    let mut block = vec![b' '; 2880];
    let mut idx = 0usize;
    let mut write_card = |card: &str| {
        let bytes = card.as_bytes();
        let len = bytes.len().min(80);
        block[idx * 80..idx * 80 + len].copy_from_slice(&bytes[..len]);
        idx += 1;
    };
    write_card(&format!("{:<80}", format!("IMAGETYP= '{imagetyp}'")));
    if let Some(o) = object {
        write_card(&format!("{:<80}", format!("OBJECT  = '{o}'")));
    }
    if let Some(f) = filter {
        write_card(&format!("{:<80}", format!("FILTER  = '{f}'")));
    }
    if let Some(d) = date_obs {
        write_card(&format!("{:<80}", format!("DATE-OBS= '{d}'")));
    }
    if let Some(e) = exposure_s {
        write_card(&format!("{:<80}", format!("EXPTIME = {e}")));
    }
    write_card(&format!("{:<80}", "GAIN    = 100"));
    write_card(&format!("{:<80}", "XBINNING= 1"));
    write_card(&format!("{:<80}", "YBINNING= 1"));
    block[idx * 80..idx * 80 + 3].copy_from_slice(b"END");
    std::fs::write(&path, &block).with_context(|| format!("write fixture FITS {path:?}"))?;
    Ok(path)
}
