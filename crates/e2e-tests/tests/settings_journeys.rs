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
//! Note on `E2eApp::launch()` and cross-session persistence: `launch()`
//! calls `reset_database()` (wipes the SQLite DB) on every call, so a
//! backend-persisted setting (e.g. Ingestion's toggles, which round-trip
//! through `ingestion.settings.get`/`update` into the same DB) CANNOT be
//! proven to survive a relaunch across two `E2eApp::launch()` calls in this
//! harness — the DB reset would erase it regardless of whether the real app
//! would have kept it. Only `localStorage`-backed state (e.g. the theme
//! choice, `apps/desktop/src/data/theme.ts`) is unaffected by
//! `reset_database()` and can honestly prove cross-relaunch persistence
//! here; the ingestion-settings-persist-across-restart scenario (journey-10
//! Test 4) is left as a follow-up for that reason, not an oversight.

mod common;

use std::time::Duration;

use anyhow::Context;
use common::E2eApp;
use serde_json::json;
use thirtyfour::By;

const UI_TIMEOUT: Duration = Duration::from_secs(20);

async fn complete_first_run(app: &E2eApp) -> anyhow::Result<()> {
    let raw_dir = tempfile::tempdir()?;
    let _: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({ "path": raw_dir.path().to_string_lossy(), "category": "light_frames", "scanSettings": null }),
        )
        .await?;
    let _: serde_json::Value = app.invoke("firstrun_complete", json!({})).await?;
    Ok(())
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

    app.goto_route("/settings?pane=ingestion").await?;
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

        app.goto_route("/settings?pane=general").await?;
        app.wait_bridge_ready(Duration::from_secs(15)).await?;

        // "Espresso" (`THEMES` id `espresso-dark`) — a real, non-default theme
        // swatch, matched by its visible name (the swatch button's full text
        // also includes its light/dark mode label, so an exact-match helper
        // would be wrong here — use `contains`).
        let xpath = "//button[contains(., 'Espresso')]";
        app.driver
            .find(By::XPath(xpath))
            .await
            .context("no 'Espresso' theme swatch button found")?
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

        app.shutdown().await?;
    }

    // Relaunch: a fresh WebDriver session + a fresh `desktop_shell` process.
    // `reset_database()` wipes the SQLite DB (first-run state), but the
    // theme choice lives in the SAME OS webview profile's localStorage and
    // is applied by `initAppearance()` at boot, before routing/first-run
    // even resolves — so it should already be set the instant the bridge is
    // ready, with no navigation needed.
    let app2 = E2eApp::launch().await?;
    app2.wait_bridge_ready(Duration::from_secs(30)).await?;

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
         got data-theme={theme_after_relaunch:?}"
    );

    // Confirm the Settings UI itself reflects the persisted choice too (not
    // just the raw DOM attribute).
    complete_first_run(&app2).await?;
    app2.goto_route("/settings?pane=general").await?;
    app2.wait_bridge_ready(Duration::from_secs(15)).await?;
    let espresso_swatch = app2
        .driver
        .find(By::XPath("//button[contains(., 'Espresso')]"))
        .await
        .context("no 'Espresso' theme swatch button found after relaunch")?;
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
