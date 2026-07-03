//! Shared harness for spec 037 Layer-2 real-UI E2E journeys.
//!
//! All journeys are `#[ignore]`d. They are compiled stubs that appear in
//! `cargo nextest list` but execution is deferred while the backend commands
//! they'd assert against are still stubs (research D9) — not because this
//! harness is unwired.
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

use std::path::PathBuf;
use std::process::{Child, Command};

use anyhow::{anyhow, Context, Result};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use thirtyfour::prelude::*;

/// URL where the `tauri-webdriver` CLI proxy listens for W3C WebDriver
/// sessions (`--port`, default `4444`). It forwards to the
/// `tauri-plugin-webdriver` server embedded in the `desktop_shell` binary on
/// `127.0.0.1:4445` (`--native-port`, matching `tauri_plugin_webdriver::init()`'s
/// default in `apps/desktop/src-tauri/src/lib.rs`).
pub const TAURI_WEBDRIVER_URL: &str = "http://127.0.0.1:4444";

/// Vite dev-server / `vite preview` port the app's Tauri `devUrl` points at
/// (`apps/desktop/src-tauri/tauri.conf.json`). The app loads this URL on its
/// own at launch — do NOT `driver.goto(APP_URL)` after connecting. Kept for
/// journeys that need to assert the current URL or navigate within the SPA.
pub const APP_URL: &str = "http://127.0.0.1:5173";

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
    /// Launch a full E2E session: preflight → reset DB → spawn the
    /// `tauri-webdriver` CLI proxy → connect WebDriver with the
    /// `tauri:options.application` capability pointing at the built
    /// `desktop_shell` binary.
    ///
    /// The app auto-loads its frontend from the Tauri `devUrl` on launch, so
    /// no `driver.goto(...)` call is needed here (see module docs).
    pub async fn launch() -> Result<Self> {
        preflight()?;
        reset_database()?;

        let driver_proc = spawn_tauri_webdriver()
            .context("failed to spawn the tauri-webdriver CLI on port 4444")?;

        let app_binary = app_binary_path()?;
        let mut caps = Capabilities::new();
        caps.set("tauri:options", json!({ "application": app_binary.to_string_lossy() }))
            .context("failed to set the tauri:options.application capability")?;

        let driver = WebDriver::new(TAURI_WEBDRIVER_URL, caps).await.with_context(|| {
            format!(
                "WebDriver::new failed against {TAURI_WEBDRIVER_URL} — is `tauri-webdriver` \
                 running, and was {} built with `--features e2e`?",
                app_binary.display()
            )
        })?;

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

    /// Quit the WebDriver session and kill the `tauri-webdriver` CLI process
    /// if present. Quitting the session already terminates the app process
    /// that `tauri-webdriver` launched on our behalf.
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
