//! Spec 037 Layer-2 real-UI smoke test (FR-007, coverage-matrix #21).
//!
//! Verifies that every top-level route loads without an uncaught React
//! render error, using the app's REAL default error boundary
//! (`apps/desktop/src/app/AppErrorBoundary.tsx`, wrapping `RouterProvider` in
//! `main.tsx`) rather than an invented `window.__alm_lastError` global (that
//! name never existed in the frontend — checked before wiring this up).
//!
//! Run: `cargo nextest run -p e2e_tests --profile e2e` (serial,
//! `.config/nextest.toml`).

mod common;
use std::time::Duration;

use common::E2eApp;
use serde_json::json;

/// Real top-level routes (`apps/desktop/src/app/router.tsx`). `/setup` and
/// `/projects/new` are entry points reached via first-run/creation flows
/// rather than persistent nav items, so they're covered by the dedicated
/// journeys instead of this generic sweep.
const TOP_LEVEL_ROUTES: &[(&str, &str)] = &[
    ("Sessions", "/sessions"),
    ("Inbox", "/inbox"),
    ("Calibration", "/calibration"),
    ("Targets", "/targets"),
    ("Projects", "/projects"),
    ("Archive", "/archive"),
    ("Settings", "/settings"),
];

/// Navigate to every top-level route and assert no uncaught render error
/// surfaced the shared `AppErrorBoundary` fallback (FR-007).
#[tokio::test]
async fn all_top_level_screens_load() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;

    // First-run gate: a fresh DB redirects every route to /setup. Register
    // one raw + one project source (real `roots.register` calls) and mark
    // first-run complete (real `firstrun.complete`) so the real app screens
    // are what gets exercised below, not the wizard.
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    let raw_dir = tempfile::tempdir()?;
    let project_dir = tempfile::tempdir()?;
    let _: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({ "path": raw_dir.path().to_string_lossy(), "category": "light_frames", "scanSettings": null }),
        )
        .await?;
    let _: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({ "path": project_dir.path().to_string_lossy(), "category": "project", "scanSettings": null }),
        )
        .await?;
    let _: serde_json::Value = app.invoke("firstrun_complete", json!({})).await?;

    for (name, path) in TOP_LEVEL_ROUTES {
        app.goto_route(path).await?;
        app.wait_bridge_ready(Duration::from_secs(15)).await?;
        let has_error = app.error_boundary_visible().await?;
        anyhow::ensure!(
            !has_error,
            "route {name} ({path}) surfaced the AppErrorBoundary fallback \
             (an uncaught render error) — see FR-007"
        );
    }

    app.shutdown().await
}
