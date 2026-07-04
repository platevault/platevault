//! Spec 037 Layer-2 real-UI smoke test stubs.
//!
//! Verifies that every top-level route loads without a JS error.
//! Ignored until the backend commands the other journeys assert against are
//! de-stubbed (research D9). The harness (`window.__ALM_E2E__` bridge,
//! tauri-webdriver capabilities) is wired.
//!
//! Run (once un-ignored):
//! ```text
//! cargo nextest run -p e2e_tests --profile e2e --run-ignored all
//! ```

mod common;
use common::E2eApp;

/// Representative top-level routes to smoke-test (FR-007).
///
/// TODO(spec-037 wiring): confirm full route list from the app router
/// (apps/desktop/src/router or equivalent) before the wiring sprint.
const TOP_LEVEL_ROUTES: &[(&str, &str)] = &[
    ("Dashboard", "/"),
    ("Targets", "/targets"),
    ("Sessions", "/sessions"),
    ("Calibration", "/calibration"),
    ("Inbox", "/inbox"),
    ("Projects", "/projects"),
    ("Settings", "/settings"),
];

/// Navigate to every top-level route and assert no JS error is thrown (FR-007).
///
/// Steps (per route):
/// 1. Navigate to `APP_URL + path`.
/// 2. Wait for the shell chrome to appear (nav sidebar / header).
/// 3. Assert `window.__alm_lastError` is undefined (no unhandled JS error).
#[tokio::test]
#[ignore = "spec-037: thirtyfour smoke scaffold; wiring deferred"]
async fn all_top_level_screens_load() -> anyhow::Result<()> {
    let _app = E2eApp::launch().await?;
    let _routes = TOP_LEVEL_ROUTES;
    // TODO: for each (name, path) in _routes:
    //   1. driver.goto(format!("{}{}", APP_URL, path)).await?
    //   2. wait for shell selector (e.g. "[data-testid='app-shell']")
    //   3. invoke or execute_sync to read window.__alm_lastError; assert None
    todo!("spec-037: all_top_level_screens_load smoke not yet wired")
}
