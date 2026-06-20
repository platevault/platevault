//! Shared harness for spec 037 Layer-2 real-UI E2E journeys.
//!
//! All journeys are `#[ignore]`d. They are compiled stubs that appear in
//! `cargo nextest list` but are deferred until backend stubs are de-stubbed
//! (see research.md D9 for the gating conditions).
//!
//! # How the harness works (proven tauri-driver approach)
//!
//! 1. Build the frontend with `VITE_E2E=1 pnpm build` → `apps/desktop/dist/`.
//! 2. Serve `dist` on :5173 with `vite preview --port 5173` (background).
//!    The built `desktop_shell` binary reads the Tauri `devUrl` (:5173) and
//!    loads its frontend from there — the frontend is real and uses real IPC.
//! 3. Build the app binary: `cargo build -p desktop_shell`.
//! 4. Run `tauri-driver --port 4444` (background).
//! 5. This harness connects thirtyfour to `http://127.0.0.1:4444`, passing
//!    `tauri:options.application` = path to the built binary. Do NOT set
//!    `browserName` — WebKitWebDriver rejects the session when it is set.
//! 6. Launching the WebDriver session starts the app; the app loads its own
//!    frontend from :5173. Do NOT call `driver.goto(...)` — the app navigates
//!    itself on launch.
//!
//! # VITE_E2E flag
//!
//! Building the frontend with `VITE_E2E=1` enables CI-only typeable path
//! inputs (the native folder picker cannot be driven by WebDriver). Journeys
//! assert against the real UI via thirtyfour `find(By::...)` + element
//! text/state over real IPC. The `invoke()` helper below provides a secondary
//! assertion path via `window.__APP_E2E__`; it only works when `VITE_E2E=1`
//! is set and the bridge is wired in the frontend (not guaranteed today).
//!
//! See `crates/e2e-tests/README.md` and `specs/037-e2e-integration-testing/`
//! for the full run procedure.

#![allow(dead_code)]

use std::process::{Child, Command};

use anyhow::{anyhow, Context, Result};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use thirtyfour::prelude::*;

/// URL where tauri-driver listens for W3C WebDriver sessions.
pub const TAURI_DRIVER_URL: &str = "http://127.0.0.1:4444";

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
            let raw =
                self.value.ok_or_else(|| anyhow!("invoke succeeded but returned no value"))?;
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
    /// Launch a full E2E session: preflight → reset DB → spawn tauri-driver →
    /// connect WebDriver.
    ///
    /// The app loads its own frontend from the Tauri devUrl (:5173); do NOT
    /// call `driver.goto(...)` after this — the webview navigates on its own.
    /// Ensure `vite preview --port 5173` is already running before calling
    /// this (in CI it is started as a background step before nextest runs).
    pub async fn launch() -> Result<Self> {
        preflight()?;
        reset_database()?;

        let driver_proc =
            spawn_tauri_driver().context("failed to spawn tauri-driver on port 4444")?;

        // Build tauri-driver capabilities:
        // - tauri:options.application  = path to the built desktop_shell binary
        //   (tauri-driver reads this and hands it to the native WebDriver)
        // - browserName is intentionally ABSENT — WebKitWebDriver rejects the
        //   session when browserName is set (proven in the US3 spike, research D3).
        //
        // thirtyfour::Capabilities wraps a serde_json map; insert the custom
        // tauri:options key directly.
        let app_bin = app_binary_path();
        let mut caps = Capabilities::new();
        caps.set("tauri:options", json!({ "application": app_bin }))
            .context("failed to set tauri:options capability")?;

        let driver = WebDriver::new(TAURI_DRIVER_URL, caps)
            .await
            .context("WebDriver::new failed — is tauri-driver running on :4444?")?;

        // Do NOT call driver.goto() here. Launching the session starts the app,
        // which loads its frontend from the Tauri devUrl (:5173 served by
        // `vite preview`). Navigation is app-owned from this point on.

        Ok(Self { driver, driver_proc: Some(driver_proc) })
    }

    /// Issue a Tauri command through the `window.__APP_E2E__` bridge.
    ///
    /// # Primary assertion path
    ///
    /// The primary assertion path for journeys is the **real UI**: use
    /// `self.driver.find(By::...)` and assert on element text/state. That path
    /// works over real IPC with no special frontend wiring.
    ///
    /// # Secondary path (this helper)
    ///
    /// `invoke()` provides a secondary assertion path that reads back backend
    /// state directly. It only works when:
    /// 1. The frontend was built with `VITE_E2E=1`, AND
    /// 2. `window.__APP_E2E__.invoke` is wired in the frontend code.
    ///
    /// Neither is guaranteed today. Use `invoke()` only in journeys where you
    /// have verified both conditions hold; otherwise assert through the UI.
    ///
    /// The injected WebDriver callback is the last script argument
    /// (`arguments[arguments.length-1]`); the bridge resolves it with
    /// `{ok:true,value}` or `{ok:false,error}`.
    pub async fn invoke<T: DeserializeOwned>(&self, command: &str, args: Value) -> Result<T> {
        let script = r#"
            var cmd      = arguments[0];
            var cmdArgs  = arguments[1];
            var callback = arguments[arguments.length - 1];
            if (!window.__APP_E2E__ || typeof window.__APP_E2E__.invoke !== 'function') {
                callback({ ok: false, error: '__APP_E2E__ bridge missing (build with VITE_E2E=1 and ensure bridge is wired)' });
                return;
            }
            window.__APP_E2E__.invoke(cmd, cmdArgs).then(function(value) {
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

    /// Quit the WebDriver session and kill the driver process if present.
    pub async fn shutdown(mut self) -> Result<()> {
        let _ = self.driver.quit().await;
        if let Some(mut child) = self.driver_proc.take() {
            let _ = child.kill();
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Resolve the path to the built `desktop_shell` binary.
///
/// Reads `ALM_E2E_APP_BIN` from the environment if set; otherwise falls back
/// to the debug build path `target/debug/desktop_shell[.exe]`.
fn app_binary_path() -> String {
    if let Ok(bin) = std::env::var("ALM_E2E_APP_BIN") {
        return bin;
    }
    // Determine repo root from the manifest dir (this test crate is under
    // crates/e2e-tests; go up three levels: e2e-tests → crates → repo root).
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest.parent().and_then(|p| p.parent()).unwrap_or(manifest);
    let exe = if cfg!(target_os = "windows") { "desktop_shell.exe" } else { "desktop_shell" };
    repo_root.join("target").join("debug").join(exe).to_string_lossy().into_owned()
}

/// Pre-flight check: verify driver binaries are present and version-matched.
///
/// TODO(spec-037 wiring): assert that `tauri-driver` is on `$PATH`; on Linux
/// also assert `WebKitWebDriver`; on Windows assert `msedgedriver`.  Return a
/// named actionable error describing what is missing and where to get it
/// (FR-015).
fn preflight() -> Result<()> {
    Ok(())
}

/// Reset the application database so each test starts from a clean state.
///
/// FR-006: if `ALM_DB_URL` is set and looks like `sqlite://PATH?...`, strip
/// the `sqlite://` prefix and everything from `?` onward, then
/// `std::fs::remove_file` that path (errors are ignored so a missing file
/// doesn't fail startup).
///
/// TODO(spec-037 wiring): when `ALM_DB_URL` is unset, resolve the OS
/// app-data path (`dev.astro-plan.astro-library-manager/alm.db`) and remove
/// it there instead.
fn reset_database() -> Result<()> {
    if let Ok(url) = std::env::var("ALM_DB_URL") {
        if let Some(path_and_query) = url.strip_prefix("sqlite://") {
            let path = path_and_query.split('?').next().unwrap_or(path_and_query);
            let _ = std::fs::remove_file(path);
        }
    }
    // TODO(spec-037 wiring): resolve OS app-data path when ALM_DB_URL is unset.
    Ok(())
}

/// Spawn `tauri-driver --port 4444` as a background child process.
///
/// tauri-driver manages the native WebDriver (WebKitWebDriver on Linux,
/// msedgedriver on Windows) itself. On Linux, wrap this process in `xvfb-run`
/// before calling nextest, or run under an existing Xvfb display.
///
/// TODO(spec-037 wiring): add preflight error when tauri-driver is not on PATH.
fn spawn_tauri_driver() -> Result<Child> {
    Command::new("tauri-driver")
        .arg("--port")
        .arg("4444")
        .spawn()
        .map_err(|e| anyhow!("failed to spawn tauri-driver: {e}"))
}
