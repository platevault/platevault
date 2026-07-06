//! Spec 037 Layer-2 real-UI journeys — Settings auto-save + theme persistence
//! (batch #11 of the coverage-matrix "Batched plan", Journey 10). Promotes
//! two of `docs/development/windows-journeys/journey-10-settings-appearance-i18n.md`'s
//! Tests: #1 (pane grouping / no global Save) + #4 (a setting persists
//! through the real backend) combined into one journey, and #2 (theme
//! applies live and survives a restart) as a second.
//!
//! Deliberately scoped to these two: they're real, cheap, deterministic UI
//! state/persistence checks with no native OS dialogs involved — the
//! "lowest filesystem-mutation risk" batch per the coverage matrix. The
//! remaining Tests (ingestion-settings-persist-across-restart, altitude
//! clamp, log-panel layout/export, 1100x720 layout convention, translated
//! backend-error surfacing, command palette, sidebar persistence) are left
//! as documented follow-ups — several need either a scrollable content
//! fixture or a real backend-rejected action reachable without a native
//! dialog, which would meaningfully grow this file's scope.
//!
//! Note on cross-session persistence and `E2eApp::launch()`/`relaunch()`:
//! both reset the SQLite DB on every call (`reset_database()`), so a
//! backend-persisted setting (e.g. Ingestion's toggles, which round-trip
//! through `ingestion.settings.get`/`update` into the same DB) CANNOT be
//! proven to survive a relaunch in this harness — the DB reset would erase
//! it regardless of whether the real app would have kept it. Only
//! `localStorage`-backed state (e.g. the theme choice,
//! `apps/desktop/src/data/theme.ts`) survives a `relaunch()` (unlike a
//! second `launch()`, which also wipes webview storage) and can honestly
//! prove cross-relaunch persistence here; the
//! ingestion-settings-persist-across-restart scenario (journey-10 Test 4) is
//! left as a follow-up for that reason, not an oversight.

mod common;

use std::time::Duration;

use anyhow::Context;
use common::E2eApp;
use serde_json::json;
use thirtyfour::By;

const UI_TIMEOUT: Duration = Duration::from_secs(20);

/// Wait for the index route's async first-run redirect to land on `/setup`
/// BEFORE navigating anywhere (mirrors `inbox_ui_journeys.rs`'s
/// `settle_first_run_redirect`). A fresh DB (the harness resets it every
/// launch) makes `checkFirstRunComplete` redirect `/` → `/setup` from an
/// async `beforeLoad`; if a journey `goto_route`s while that redirect is
/// still pending, the late-resolving redirect can yank the app off the
/// target route.
async fn settle_first_run_redirect(app: &E2eApp) -> anyhow::Result<()> {
    app.wait_url_contains("/setup", Duration::from_secs(15))
        .await
        .map(drop)
        .map_err(|e| anyhow::anyhow!("expected a fresh DB to redirect to /setup: {e}"))
}

/// Registers BOTH a raw (`light_frames`) and a `project` root:
/// [`E2eApp::complete_first_run_gate`] requires at least one of each, and
/// routing through the real gate (not a bare `firstrun_complete` invoke)
/// also clears the Shell's separate `setupCompleted` localStorage flag — a
/// journey that only calls the backend command still gets bounced to
/// `/setup` on every subsequent `goto_route` (`inbox_ui_journeys.rs`'s
/// `register_project_root`/`complete_first_run_gate` pairing is the proven
/// pattern this mirrors).
async fn complete_first_run(app: &E2eApp) -> anyhow::Result<()> {
    settle_first_run_redirect(app).await?;
    let raw_dir = tempfile::tempdir()?;
    let _: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({ "path": raw_dir.path().to_string_lossy(), "category": "light_frames", "scanSettings": null }),
        )
        .await?;
    let project_dir = tempfile::tempdir()?;
    let _: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({ "path": project_dir.path().to_string_lossy(), "category": "project", "scanSettings": null }),
        )
        .await?;
    app.complete_first_run_gate().await
}

/// Test 1 (journey-10): the Ingestion pane has NO global "Save" button
/// anywhere, and toggling a real field auto-saves through the real backend
/// (`ingestion.settings.update`) without any explicit save action — proven
/// by a fresh `ingestion.settings.get` read reflecting the change.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn settings_ui_ingestion_toggle_autosaves_no_global_save_button() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    complete_first_run(&app).await?;

    // The active pane is a real PATH param (`settingsPaneRoute`, path
    // `/settings/$pane` — `apps/desktop/src/app/router.tsx`), read via
    // `useParams` in `SettingsPage.tsx`, NOT a `?pane=` query string; the
    // query-string form silently falls back to the default 'sources' pane
    // (CI: "Follow symbolic links" never appeared — the Ingestion pane
    // never actually mounted).
    app.goto_route("/settings/ingestion").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;

    anyhow::ensure!(
        app.count_buttons_with_text("Save").await? == 0,
        "expected NO global 'Save' button on a settings pane (auto-save-only convention, spec 018)"
    );

    // Real backend precondition: `followSymlinks` defaults to false.
    let before: serde_json::Value = app.invoke("ingestion_settings_get", json!({})).await?;
    anyhow::ensure!(
        before["followSymlinks"] == json!(false),
        "expected the real default followSymlinks=false before toggling: {before}"
    );
    anyhow::ensure!(
        !app.checkbox_checked_by_aria_label("Follow symbolic links").await?,
        "expected the real checkbox to start unchecked, matching the backend default"
    );

    // Real DOM interaction: toggle it. No save button exists — this is the
    // only action a real user could take to change the value.
    app.click_by_aria_label("Follow symbolic links").await?;
    anyhow::ensure!(
        app.checkbox_checked_by_aria_label("Follow symbolic links").await?,
        "expected the real checkbox to reflect the toggle immediately"
    );

    // Real backend round-trip: confirm the auto-save actually persisted,
    // with no Save click anywhere in this journey.
    let after: serde_json::Value = app
        .invoke_until("ingestion_settings_get", json!({}), UI_TIMEOUT, |v: &serde_json::Value| {
            v["followSymlinks"] == json!(true)
        })
        .await
        .map_err(|e| {
            anyhow::anyhow!("expected the toggle to auto-save to the real backend: {e}")
        })?;
    anyhow::ensure!(after["followSymlinks"] == json!(true), "unexpected persisted value: {after}");

    app.shutdown().await
}

/// Test 2 (journey-10): switching the theme applies live (`<html
/// data-theme>` changes with no reload) and survives a full app relaunch —
/// the ONE piece of Settings state this harness can honestly prove survives
/// a relaunch, since theme choice is `localStorage`-backed
/// (`apps/desktop/src/data/theme.ts`) and therefore untouched by
/// `E2eApp::launch()`'s per-session `reset_database()` (see module docs).
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn settings_ui_theme_applies_live_and_persists_across_relaunch() -> anyhow::Result<()> {
    {
        let app = E2eApp::launch().await?;
        app.wait_bridge_ready(Duration::from_secs(30)).await?;
        complete_first_run(&app).await?;

        app.goto_route("/settings/general").await?;
        app.wait_bridge_ready(Duration::from_secs(15)).await?;

        // "Espresso" (`THEMES` id `espresso-dark`) — a real, non-default theme
        // swatch, matched by its visible name (the swatch button's full text
        // also includes its light/dark mode label, so an exact-match helper
        // would be wrong here — use `contains`).
        // Poll for the swatch to actually mount: it opens asynchronously
        // after the navigation, same route/render race `E2eApp::find_waiting`
        // documents.
        let xpath = "//button[contains(., 'Espresso')]";
        app.find_waiting(By::XPath(xpath), "the 'Espresso' theme swatch button")
            .await?
            .click()
            .await
            .context("click the Espresso theme swatch failed")?;

        // Live apply: no reload needed.
        let theme: String = app
            .driver
            .execute("return document.documentElement.getAttribute('data-theme')", vec![])
            .await
            .context("failed to read document.documentElement's data-theme")?
            .convert()
            .context("failed to deserialise data-theme")?;
        anyhow::ensure!(
            theme == "espresso-dark",
            "expected the theme to apply live with no reload, got data-theme={theme:?}"
        );

        // Diagnostic (round 2, fix-464-theme): confirm the write actually
        // landed in `localStorage` itself, not just the derived `data-theme`
        // attribute — rules out "never written" as a cause of a later
        // relaunch failure.
        let stored: serde_json::Value = app
            .driver
            .execute("return window.localStorage.getItem('alm.theme')", vec![])
            .await
            .context("failed to read localStorage['alm.theme'] before shutdown")?
            .convert()
            .context("failed to deserialise localStorage['alm.theme'] before shutdown")?;
        anyhow::ensure!(
            stored == serde_json::json!("espresso-dark"),
            "expected localStorage['alm.theme']=\"espresso-dark\" to be written before \
             shutdown, got {stored:?}"
        );

        // `E2eApp::shutdown()` force-kills the app process (the CLI's only
        // handle on the app's lifetime — see `blocking_session_delete`'s
        // doc), rather than closing the window gracefully. Chromium/WebView2
        // commits `localStorage` writes to its on-disk store asynchronously
        // (a background-sequence flush, not synchronous-per-write), so an
        // abrupt process kill immediately after a write can lose it before
        // it reaches disk — a documented WebView2/Chromium characteristic,
        // and a plausible reason this journey is Windows-only-flaky even
        // with a real, unwiped webview profile (WebKitGTK's flush timing
        // differs). Give the background flush a moment to complete before
        // killing the process.
        tokio::time::sleep(Duration::from_millis(1000)).await;

        app.shutdown().await?;
    }

    // Relaunch: a fresh WebDriver session + a fresh `desktop_shell` process,
    // via `E2eApp::relaunch()` (NOT `launch()` — `launch()` wipes the
    // webview's persisted storage on every call, which would erase the very
    // localStorage state this journey is trying to prove survives a real
    // app restart). `reset_database()` still wipes the SQLite DB (first-run
    // state), but the theme choice lives in the SAME OS webview profile's
    // localStorage and is applied by `initAppearance()` at boot, before
    // routing/first-run even resolves — so it should already be set the
    // instant the bridge is ready, with no navigation needed.
    let app2 = E2eApp::relaunch().await?;
    app2.wait_bridge_ready(Duration::from_secs(30)).await?;

    // Diagnostic (round 2, fix-464-theme): read the RAW localStorage value
    // directly, in addition to the derived `data-theme` attribute. If this
    // is `null`, the write was lost between processes (harness/OS-level
    // storage loss). If it's still `"espresso-dark"` but `data-theme` below
    // reverted to the default, the value survived fine and the bug is a
    // product-code race in `initAppearance()`/`applyTheme()` reading
    // localStorage before hydration completes — a very different fix.
    let stored_after_relaunch: serde_json::Value = app2
        .driver
        .execute("return window.localStorage.getItem('alm.theme')", vec![])
        .await
        .context("failed to read localStorage['alm.theme'] after relaunch")?
        .convert()
        .context("failed to deserialise localStorage['alm.theme'] after relaunch")?;

    let theme_after_relaunch: String = app2
        .driver
        .execute("return document.documentElement.getAttribute('data-theme')", vec![])
        .await
        .context("failed to read document.documentElement's data-theme after relaunch")?
        .convert()
        .context("failed to deserialise data-theme after relaunch")?;
    anyhow::ensure!(
        theme_after_relaunch == "espresso-dark",
        "expected the theme choice to survive a full app relaunch (localStorage), \
         got data-theme={theme_after_relaunch:?} (raw localStorage['alm.theme']={stored_after_relaunch:?} \
         — null means the value never made it to disk/the new process; \
         \"espresso-dark\" means it survived but something ignored it at boot)"
    );

    // Confirm the Settings UI itself reflects the persisted choice too (not
    // just the raw DOM attribute).
    complete_first_run(&app2).await?;
    app2.goto_route("/settings/general").await?;
    app2.wait_bridge_ready(Duration::from_secs(15)).await?;
    let espresso_swatch = app2
        .find_waiting(
            By::XPath("//button[contains(., 'Espresso')]"),
            "the 'Espresso' theme swatch button after relaunch",
        )
        .await?;
    let pressed = espresso_swatch
        .attr("aria-pressed")
        .await
        .context("failed to read aria-pressed on the Espresso swatch")?;
    anyhow::ensure!(
        pressed.as_deref() == Some("true"),
        "expected the Espresso swatch to show aria-pressed=true after relaunch, got {pressed:?}"
    );

    app2.shutdown().await
}
