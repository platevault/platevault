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
//!   embedded W3C WebDriver server listening on `127.0.0.1:4445`. Release
//!   builds omit the `e2e` feature so the automation surface is never present
//!   (Constitution Principle V).
//! - The `tauri-webdriver` CLI (`cargo install tauri-webdriver --locked`)
//!   proxies `127.0.0.1:4444` -> the embedded plugin server on `:4445`, and
//!   manages the target app's process lifecycle via the `tauri:options`
//!   capability — it does **not** take the app binary as a CLI argument.
//! - thirtyfour (this crate's W3C client) connects to the CLI on `:4444` and
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

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use thirtyfour::components::escape_string;
use thirtyfour::prelude::*;

/// URL where the `tauri-webdriver` CLI proxy listens for W3C WebDriver
/// sessions (`--port`, default `4444`). It forwards to the
/// `tauri-plugin-webdriver` server embedded in the `desktop_shell` binary on
/// `127.0.0.1:4445` (`--native-port`, matching `tauri_plugin_webdriver::init()`'s
/// default in `apps/desktop/src-tauri/src/lib.rs`).
pub const TAURI_WEBDRIVER_URL: &str = "http://127.0.0.1:4444";

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
/// BEFORE the window exists (observed ~30 s on ubuntu-latest, CI run
/// 28694907445), and the plugin's own per-attempt window-wait is only 10 s.
pub const LAUNCH_TIMEOUT: Duration = Duration::from_secs(120);

/// Default deadline for the convenience "find an element by aria-label /
/// button text, then act on it" helpers ([`E2eApp::click_by_aria_label`] and
/// friends). These poll for their target rather than doing a single
/// immediate `find` — see [`E2eApp::find_waiting`] for the CI race this
/// guards against. 20 s comfortably covers a debug-build route render on a
/// cold CI runner without masking a genuinely-absent element for long.
pub const DEFAULT_FIND_TIMEOUT: Duration = Duration::from_secs(20);

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
        preflight()?;
        reset_database()?;
        reset_webview_storage();
        reset_window_state();

        let mut driver_proc = spawn_tauri_webdriver()
            .context("failed to spawn the tauri-webdriver CLI on port 4444")?;

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

            match WebDriver::new(TAURI_WEBDRIVER_URL, caps).await {
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
                        // CLI itself — otherwise the leaked pair holds ports
                        // 4444/4445 and poisons every subsequent test in the
                        // serial run (exactly what CI's TRY-2 "can not
                        // listen to address" failure was).
                        blocking_session_delete();
                        kill_driver_proc(&mut driver_proc);
                        return Err(e).with_context(|| {
                            format!(
                                "WebDriver session not created within {LAUNCH_TIMEOUT:?} \
                                 against {TAURI_WEBDRIVER_URL} — is `tauri-webdriver` \
                                 running, and was {} built with `--features e2e`?",
                                app_binary.display()
                            )
                        });
                    }
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                }
            }
        };

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
                callback({ ok: false, error: String(err) });
            });
        "#;

        let ret = self
            .driver
            .execute_async(script, vec![json!(command), args])
            .await
            .context("execute_async failed")?;

        let outcome: InvokeOutcome =
            ret.convert().context("failed to deserialise InvokeOutcome from bridge response")?;

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
    /// message once `timeout` elapses) if the predicate never accepts a value.
    pub async fn invoke_until<T, P>(
        &self,
        command: &str,
        args: Value,
        timeout: Duration,
        mut predicate: P,
    ) -> Result<T>
    where
        T: DeserializeOwned,
        P: FnMut(&T) -> bool,
    {
        let deadline = Instant::now() + timeout;
        let mut last_err: Option<anyhow::Error> = None;
        loop {
            match self.invoke::<T>(command, args.clone()).await {
                Ok(value) if predicate(&value) => return Ok(value),
                Ok(_) => {}
                Err(e) => last_err = Some(e),
            }
            if Instant::now() >= deadline {
                return Err(last_err.unwrap_or_else(|| {
                    anyhow!(
                        "invoke_until({command}) timed out after {:?} without a matching value",
                        timeout
                    )
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

    /// Wait for [`Self::bridge_ready`] to become `true`.
    pub async fn wait_bridge_ready(&self, timeout: Duration) -> Result<()> {
        let deadline = Instant::now() + timeout;
        loop {
            if self.bridge_ready().await.unwrap_or(false) {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(anyhow!("window.__ALM_E2E__ bridge never became ready"));
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
    // Real-DOM interaction helpers (additive, shared across per-area UI
    // journeys — inbox/calibration/targets/sessions/lifecycle/settings).
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

    /// Clear then type into the `<input data-testid=..>`.
    pub async fn fill_testid(&self, testid: &str, value: &str) -> Result<()> {
        let el = self.find_testid(testid).await?;
        el.clear().await.with_context(|| format!("clear {testid} failed"))?;
        el.send_keys(value).await.with_context(|| format!("send_keys {testid} failed"))
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
    async fn find_waiting(&self, by: By, what: &str) -> Result<WebElement> {
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
    /// 2. `guided.dismiss` — the guided coach auto-activates on the first
    ///    Shell mount after setup and its react-joyride overlay would sit
    ///    over the page; activation is a no-op on a dismissed flow
    ///    (`crates/app/core/src/guided_flow.rs::activate_after_setup`);
    /// 3. set `setupCompleted: true` in the `alm-preferences` localStorage
    ///    blob (what `SetupWizard` does via `setPreference`);
    /// 4. reload the page — the preferences module caches its localStorage
    ///    read in module state (`apps/desktop/src/data/preferences.ts`), so
    ///    a direct localStorage write is invisible until a fresh page load.
    pub async fn complete_first_run_gate(&self) -> Result<()> {
        let _: Value = self
            .invoke("firstrun_complete", json!({}))
            .await
            .context("firstrun.complete failed — were a raw AND a project source registered?")?;
        let _: Value = self.invoke("guided_dismiss", json!({})).await?;

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

    /// Quit the WebDriver session and kill the `tauri-webdriver` CLI process
    /// if present. Quitting the session (a `DELETE /session/{id}` through the
    /// CLI) makes the CLI terminate the app process it launched on our
    /// behalf; killing the CLI afterwards frees port 4444.
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
    /// `tauri-webdriver` CLI (port 4444) AND the app it launched (port 4445),
    /// which poisons every subsequent test in the serial run — this is
    /// exactly what CI run 28694907445's TRY-2 `can not listen to address:
    /// 127.0.0.1:4444` / `Plugin server not ready after timeout` cascade was.
    ///
    /// `driver.quit()` is async and cannot be awaited here, so the app-kill
    /// is requested with a synchronous raw-HTTP `DELETE /session/…` instead:
    /// the CLI kills its app process after ANY session-delete round trip,
    /// regardless of the session id being real.
    fn drop(&mut self) {
        if let Some(mut child) = self.driver_proc.take() {
            blocking_session_delete();
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
/// leaves the CLI alive and port 4444 occupied (the CI TRY-2 leak).
fn kill_driver_proc(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Synchronously send `DELETE /session/e2e-cleanup` to the `tauri-webdriver`
/// CLI over a raw std TCP socket (best-effort, short timeouts, no async and
/// no extra HTTP-client dependency — this must be callable from `Drop`).
///
/// The CLI kills the app process it launched after ANY `/session/{id}` DELETE
/// round trip (it does not validate the id) — this is the only handle we have
/// on the app's lifetime, since the CLI spawned it, not the harness.
fn blocking_session_delete() {
    let attempt = || -> std::io::Result<()> {
        let addr = "127.0.0.1:4444";
        let timeout = Duration::from_secs(5);
        let mut stream = std::net::TcpStream::connect_timeout(&addr.parse().unwrap(), timeout)?;
        stream.set_read_timeout(Some(timeout))?;
        stream.set_write_timeout(Some(timeout))?;
        use std::io::{Read, Write};
        stream.write_all(
            b"DELETE /session/e2e-cleanup HTTP/1.1\r\n\
              Host: 127.0.0.1:4444\r\n\
              Content-Length: 0\r\n\
              Connection: close\r\n\r\n",
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

/// Spawn the `tauri-webdriver` CLI proxy as a background child process.
///
/// Mirrors `.github/workflows/e2e.yml`: the CLI is installed once
/// (`cargo install tauri-webdriver --locked`) and this harness starts it per
/// session. `--port`/`--native-port` are passed explicitly even though they
/// match the CLI's and plugin's defaults, so a future default change upstream
/// doesn't silently break the pairing.
fn spawn_tauri_webdriver() -> Result<Child> {
    Command::new("tauri-webdriver")
        .arg("--port")
        .arg("4444")
        .arg("--native-port")
        .arg("4445")
        .spawn()
        .map_err(|e| {
            anyhow!(
                "failed to spawn tauri-webdriver: {e} \
                 (install with `cargo install tauri-webdriver --locked`)"
            )
        })
}

/// Reset the application database so each test starts from a clean state.
///
/// FR-006: if `ALM_DB_URL` is set and looks like `sqlite://PATH?...`, strip
/// the `sqlite://` prefix and everything from `?` onward, then remove that
/// file (errors are ignored so a missing file doesn't fail startup).
///
/// When `ALM_DB_URL` is unset (the e2e.yml CI configuration), the app stores
/// its DB at `<app_data_dir>/alm.db` (`apps/desktop/src-tauri/src/main.rs`,
/// identifier `dev.astro-plan.astro-library-manager`). Without removing it
/// there, state accumulates ACROSS the serial journeys — a journey that
/// completes first-run leaves `firstrun.complete` + its registered roots +
/// unacknowledged inbox items behind for every later journey, breaking both
/// the fresh-DB startup-redirect expectation and every "only item in the
/// list" selection. The `-wal`/`-shm` sidecars are removed too so SQLite
/// can't replay a stale WAL into the fresh DB.
fn reset_database() -> Result<()> {
    let db_path: Option<PathBuf> = if let Ok(url) = std::env::var("ALM_DB_URL") {
        url.strip_prefix("sqlite://").map(|p| PathBuf::from(p.split('?').next().unwrap_or(p)))
    } else {
        app_data_dir().map(|dir| dir.join("alm.db"))
    };
    if let Some(path) = db_path {
        let _ = std::fs::remove_file(&path);
        for sidecar in ["-wal", "-shm"] {
            let mut os = path.clone().into_os_string();
            os.push(sidecar);
            let _ = std::fs::remove_file(PathBuf::from(os));
        }
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
fn reset_webview_storage() {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "windows") {
        // WebView2 keeps ALL web storage under the user-data folder tauri
        // points at `<app_local_data_dir>/EBWebView`.
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates
                .push(PathBuf::from(local).join("dev.astro-plan.astro-library-manager/EBWebView"));
        }
    } else if cfg!(target_os = "macos") {
        // WKWebView website data (incl. localStorage) lives under
        // ~/Library/WebKit/<identifier>/WebsiteData.
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(
                PathBuf::from(home)
                    .join("Library/WebKit/dev.astro-plan.astro-library-manager/WebsiteData"),
            );
        }
    } else if let Some(dir) = app_data_dir() {
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
/// journey's process happened to exit in. On a CI runner (headless/virtual
/// display, or a shared display with unusual bounds), a restored geometry
/// can end up minimized or positioned somewhere WebDriver's element queries
/// can't interact with, hanging the next journey instead of failing fast
/// (observed as `inbox_ui_mixed_folder_splits_into_single_type_items` timing
/// out at >150s on Windows/macOS real-UI CI once the shell-polish window
/// state plugin started actually persisting geometry across launches).
///
/// The plugin's default store is `.window-state.json` under
/// `app.path().app_config_dir()` (`tauri-plugin-window-state` source) —
/// which is a DIFFERENT directory than `app_data_dir()` on Linux
/// (`$XDG_CONFIG_HOME`/`~/.config` vs `$XDG_DATA_HOME`/`~/.local/share`) but
/// the SAME directory on Windows (`%APPDATA%`) and macOS
/// (`~/Library/Application Support`), where the CI failures were observed.
/// Failures are ignored (first run has no window-state file yet).
fn reset_window_state() {
    if let Some(dir) = app_config_dir() {
        let _ = std::fs::remove_file(dir.join(".window-state.json"));
    }
}

/// Resolve the per-OS Tauri `app_config_dir` for the app identifier
/// `dev.astro-plan.astro-library-manager` (`tauri.conf.json`). Mirrors
/// `tauri::path::PathResolver::app_config_dir` (`dirs::config_dir()/<identifier>`)
/// without needing a Tauri runtime in the test harness:
/// - Linux:   `$XDG_CONFIG_HOME` or `~/.config`
/// - macOS:   `~/Library/Application Support` (same as `app_data_dir`)
/// - Windows: `%APPDATA%` (roaming, same as `app_data_dir`)
fn app_config_dir() -> Option<PathBuf> {
    const APP_IDENTIFIER: &str = "dev.astro-plan.astro-library-manager";
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    };
    base.map(|b| b.join(APP_IDENTIFIER))
}

/// Resolve the per-OS Tauri `app_data_dir` for the app identifier
/// `dev.astro-plan.astro-library-manager` (`tauri.conf.json`). Mirrors
/// `tauri::path::PathResolver::app_data_dir` (`dirs::data_dir()/<identifier>`)
/// without needing a Tauri runtime in the test harness:
/// - Linux:   `$XDG_DATA_HOME` or `~/.local/share`
/// - macOS:   `~/Library/Application Support`
/// - Windows: `%APPDATA%` (roaming)
fn app_data_dir() -> Option<PathBuf> {
    const APP_IDENTIFIER: &str = "dev.astro-plan.astro-library-manager";
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
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
pub fn write_minimal_fits(
    dir: &Path,
    name: &str,
    imagetyp: &str,
    object: Option<&str>,
    filter: Option<&str>,
    date_obs: Option<&str>,
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
    write_card(&format!("{:<80}", "GAIN    = 100"));
    write_card(&format!("{:<80}", "XBINNING= 1"));
    write_card(&format!("{:<80}", "YBINNING= 1"));
    block[idx * 80..idx * 80 + 3].copy_from_slice(b"END");
    std::fs::write(&path, &block).with_context(|| format!("write fixture FITS {path:?}"))?;
    Ok(path)
}
