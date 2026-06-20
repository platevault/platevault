//! Shared harness for spec 037 Layer-2 real-UI E2E journeys.
//!
//! All journeys are `#[ignore]`d. They are compiled stubs that appear in
//! `cargo nextest list` but are deferred until two prerequisites land:
//!
//! 1. The `__APP_E2E__` bridge (exposed by the desktop app when built with
//!    `VITE_E2E=1`) is wired in the frontend.
//! 2. The tauri-driver WebDriver caps (`tauri:options.application` +
//!    `browserName="wry"`) replace the chrome placeholder caps used here.
//!
//! See `crates/e2e-tests/README.md` for the full run procedure.

#![allow(dead_code)]

use std::process::{Child, Command};

use anyhow::{anyhow, Context, Result};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use thirtyfour::prelude::*;

/// URL where tauri-driver listens for W3C WebDriver sessions.
pub const TAURI_DRIVER_URL: &str = "http://127.0.0.1:4444";

/// Vite dev-server port used when running against the real backend
/// (`VITE_USE_MOCKS=false`).
pub const APP_URL: &str = "http://127.0.0.1:1420";

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
    /// connect WebDriver → navigate to [`APP_URL`].
    pub async fn launch() -> Result<Self> {
        preflight()?;
        reset_database()?;

        let driver_proc =
            spawn_tauri_driver().context("failed to spawn tauri-driver on port 4444")?;

        // TODO(spec-037 wiring): replace DesiredCapabilities::chrome() with
        // real tauri-driver caps:
        //   caps.set_browser_name("wry")?;
        //   caps.add_capability("tauri:options", json!({"application": "/path/to/alm"}))?;
        // Chrome caps are a placeholder that makes this file compile.
        let driver = WebDriver::new(TAURI_DRIVER_URL, DesiredCapabilities::chrome())
            .await
            .context("WebDriver::new failed — is tauri-driver running on :4444?")?;

        driver.goto(APP_URL).await.context("driver.goto APP_URL failed")?;

        Ok(Self { driver, driver_proc: Some(driver_proc) })
    }

    /// Issue a Tauri command through the `window.__APP_E2E__` bridge.
    ///
    /// The bridge is exposed by the desktop app when it is built with
    /// `VITE_E2E=1`.  This replaces the old better-sqlite3 reader approach:
    /// instead of reading the DB directly, we assert UI→real-backend
    /// round-trips against real command output (FR-008).
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
                callback({ ok: false, error: '__APP_E2E__ bridge missing (build with VITE_E2E=1)' });
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
// Private helpers (each carries a TODO(spec-037 wiring) note)
// ---------------------------------------------------------------------------

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
/// TODO(spec-037 wiring): wrap in `xvfb-run` on Linux (headless display);
/// pass the built application binary via `tauri-driver -- /path/to/alm`.
fn spawn_tauri_driver() -> Result<Child> {
    Command::new("tauri-driver")
        .arg("--port")
        .arg("4444")
        .spawn()
        .map_err(|e| anyhow!("failed to spawn tauri-driver: {e}"))
}
