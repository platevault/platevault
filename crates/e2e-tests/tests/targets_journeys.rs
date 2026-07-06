//! Spec 037 Layer-2 real-UI journeys — Targets catalog, SIMBAD resolve-on-
//! demand path (offline seed hit, no live network), the stub-disclosure
//! guard, and real planner astronomy after an observing site is created
//! (batches #7 and #8 of the coverage-matrix "Batched plan", Journey 9).
//! Promotes `docs/development/windows-journeys/journey-09-targets-planning.md`.
//!
//! Deliberately DOES NOT exercise a live SIMBAD network lookup (journey-09
//! Test 3): a real HTTP dependency in a CI journey would be flaky and the
//! repo's own convention for #14 (SIMBAD resolution) is the offline
//! `FakeResolver` at Layer 1 — `target.resolve`/`target.search`'s bundled
//! offline seed cache (loaded on every boot, see `journeys.rs` module docs)
//! gives a deterministic, network-free real backend round-trip instead.
//!
//! Batch #8 (real planner astronomy) was documented as blocked on PR #440
//! (observing-site creation UI). Verified against `apps/desktop/src/features/
//! targets/site-gate.ts` while authoring this file: `readSiteExists()` now
//! reads the real `observing-sites/site-store` (no longer a hardcoded
//! `false`) — #440 has landed, so `targets_planner_real_astronomy_after_site_creation`
//! below is no longer a "gate-prompt-only" placeholder journey.

mod common;

use std::time::Duration;

use anyhow::Context;
use common::E2eApp;
use serde_json::json;
use thirtyfour::By;

const UI_TIMEOUT: Duration = Duration::from_secs(20);

/// Real, per-target disclosure titles (spec 047) — asserted verbatim against
/// `apps/desktop/messages/en.json` so a copy change fails this test loudly
/// instead of silently drifting.
const OPPOSITION_UNKNOWN_TITLE: &str = "Opposition date unknown — this target has no coordinates.";
const LUNAR_UNKNOWN_TITLE: &str = "Lunar distance unknown — this target has no coordinates.";

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

/// Complete first-run via the invoke bridge (native folder pickers can't be
/// driven by WebDriver — same documented constraint as `journeys.rs`/
/// `smoke.rs`) so `/targets` is directly reachable.
///
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

/// Add a target via the REAL "Add target" dialog (search -> select suggestion
/// -> confirm), all real DOM interaction. `query` should match the bundled
/// offline seed (e.g. a Messier designation) so resolution never needs a live
/// SIMBAD network call. Returns the resolved target's real id, read from the
/// real `?selected=<id>` URL the app navigates to on success
/// (`TargetsPage.tsx::handleAdded`).
async fn add_target_via_ui(app: &E2eApp, query: &str) -> anyhow::Result<String> {
    // Open: at this point no dialog is open yet, so the top-bar trigger's
    // "Add target" text is unambiguous.
    app.click_button_text("Add target").await?;

    // Poll for the dialog to actually mount: it opens asynchronously after the
    // trigger click, same route/render race `E2eApp::find_waiting` documents.
    let popup =
        app.find_waiting(By::Css(".alm-add-target__popup"), "the Add-target dialog popup").await?;
    let input = popup.find(By::Css(".alm-target-search__input")).await?;
    input.send_keys(query).await?;

    // Poll for a real suggestion option to render (offline seed search).
    let deadline = tokio::time::Instant::now() + UI_TIMEOUT;
    let option = loop {
        if let Ok(opt) = popup.find(By::Css(".alm-target-search__option")).await {
            break opt;
        }
        anyhow::ensure!(
            tokio::time::Instant::now() < deadline,
            "no suggestion rendered for query {query:?} within {UI_TIMEOUT:?} \
             (offline seed search should be instant for a bundled designation)"
        );
        tokio::time::sleep(Duration::from_millis(150)).await;
    };
    option.click().await?;

    // Confirm — scoped to the dialog popup so this can't accidentally hit the
    // top-bar trigger button, which shares the exact same "Add target" text.
    popup
        .find(By::XPath(".//button[normalize-space(.)='Add target']"))
        .await
        .context("no scoped 'Add target' confirm button inside the dialog popup")?
        .click()
        .await
        .context("click the dialog's Add target confirm button failed")?;

    let url = app
        .wait_url_contains("selected=", UI_TIMEOUT)
        .await
        .context("expected the app to navigate to ?selected=<targetId> after a successful add")?;
    let id = url
        .split("selected=")
        .nth(1)
        .ok_or_else(|| {
            anyhow::anyhow!("URL contained 'selected=' but split produced no id: {url}")
        })?
        .split('&')
        .next()
        .unwrap_or_default()
        .to_owned();
    anyhow::ensure!(!id.is_empty(), "extracted an empty target id from URL: {url}");
    Ok(id)
}

/// Test 2 (journey-09): adding the same bundled-seed target twice via the
/// real UI resolves to the SAME real target id both times — re-adding never
/// creates a duplicate catalog row.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn targets_ui_add_target_no_duplicate_on_reconfirm() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    complete_first_run(&app).await?;

    app.goto_route("/targets").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;

    let first_id = add_target_via_ui(&app, "M 1").await?;
    // Re-add the exact same designation.
    let second_id = add_target_via_ui(&app, "M 1").await?;

    anyhow::ensure!(
        first_id == second_id,
        "expected re-adding the same target to resolve to the SAME real id \
         (no duplicate), got {first_id:?} then {second_id:?}"
    );

    app.shutdown().await
}

/// Test 6a/6b (journey-09), the safety-critical stub-disclosure guard: with
/// NO observing site configured, the top bar shows the real "set up your
/// observing site" prompt (never a fabricated Moon summary), and per-target
/// Opposition/Lunar-separation cells show an explicit, real "unknown"
/// disclosure ("—" with a real title) rather than a fabricated-looking
/// number (`deriveRowMoonPlanning`'s real `!night` branch,
/// `apps/desktop/src/features/targets/astro/row-planning.ts`).
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn targets_ui_astronomy_columns_disclose_placeholder_without_site() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    complete_first_run(&app).await?;

    app.goto_route("/targets").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    // Guarantee at least one real target row exists regardless of whether the
    // bundled seed catalog is pre-listed on a fresh DB.
    add_target_via_ui(&app, "M 1").await?;

    app.wait_testid("planner-site-prompt", UI_TIMEOUT).await.map_err(|e| {
        anyhow::anyhow!("expected the real site-setup prompt with no observing site: {e}")
    })?;
    anyhow::ensure!(
        !app.testid_exists("moon-summary").await?,
        "no observing site exists — a real MoonSummary must not render"
    );

    anyhow::ensure!(
        app.count_elements_with_title(OPPOSITION_UNKNOWN_TITLE).await? >= 1,
        "expected at least one real 'Opposition unknown' disclosure with no observing site"
    );
    anyhow::ensure!(
        app.count_elements_with_title(LUNAR_UNKNOWN_TITLE).await? >= 1,
        "expected at least one real 'Lunar distance unknown' disclosure with no observing site"
    );

    app.shutdown().await
}

/// Test 6c (journey-09) / batch #8: creating a real observing site via the
/// real Settings → Target Planner → Observing Sites UI flips the real
/// `useObserverSiteExists()` gate, and the Targets page immediately (no
/// reload) swaps the site-setup prompt for a real `MoonSummary` — proving
/// the planner astronomy pipeline is really wired end-to-end from a real
/// user action, not just a settings round-trip.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn targets_planner_real_astronomy_after_site_creation() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    complete_first_run(&app).await?;

    app.goto_route("/targets").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.wait_testid("planner-site-prompt", UI_TIMEOUT).await.map_err(|e| {
        anyhow::anyhow!(
            "precondition failed: expected the site-setup prompt before any site exists: {e}"
        )
    })?;

    // Real UI: Settings -> Target Planner -> Observing Sites -> Add site.
    // The active pane is a real PATH param (`settingsPaneRoute`, path
    // `/settings/$pane` — `apps/desktop/src/app/router.tsx`), read via
    // `useParams` in `SettingsPage.tsx`, NOT a `?pane=` query string; the
    // query-string form silently falls back to the default 'sources' pane
    // (CI: "+ Add site" never appeared — the Planner pane never mounted).
    app.goto_route("/settings/planner").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.click_button_text("+ Add site").await?;

    // Poll for the form to actually mount: it opens asynchronously after the
    // trigger click, same route/render race `E2eApp::find_waiting` documents.
    let name_input =
        app.find_waiting(By::Id("observing-site-name"), "the observing-site name input").await?;
    name_input.send_keys("E2E Test Observatory").await?;
    let lat_input = app.driver.find(By::Id("observing-site-lat")).await?;
    lat_input.send_keys("51.4778").await?; // Royal Observatory Greenwich latitude
    let lon_input = app.driver.find(By::Id("observing-site-lon")).await?;
    lon_input.send_keys("-0.0015").await?;
    let elevation_input = app.driver.find(By::Id("observing-site-elevation")).await?;
    elevation_input.send_keys("45").await?;
    // Timezone/twilight/horizon keep their real defaults (local IANA zone,
    // astronomical twilight, 0° horizon) — only the load-bearing fields for
    // ephemeris computation are set explicitly.

    app.click_button_text("Save").await?;

    // Real, durable proof the site persisted: `settings.get('observing')`
    // now carries a non-empty `observingSites` array.
    let settings: serde_json::Value = app
        .invoke_until(
            "settings_get",
            json!({ "scope": "observing" }),
            UI_TIMEOUT,
            |v: &serde_json::Value| {
                v["values"]["observingSites"].as_array().is_some_and(|a| !a.is_empty())
            },
        )
        .await
        .context("expected the new observing site to persist to real settings storage")?;
    anyhow::ensure!(
        settings["values"]["observingActiveSiteId"].is_string(),
        "expected the first-ever site to auto-become active: {settings}"
    );

    // Real UI: back to Targets — the gate must flip WITHOUT a reload, since
    // every consumer subscribes to the live site-store via useSyncExternalStore.
    app.goto_route("/targets").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.wait_testid("moon-summary", UI_TIMEOUT).await.map_err(|e| {
        anyhow::anyhow!(
            "expected a real MoonSummary to render now that an observing site exists: {e}"
        )
    })?;
    anyhow::ensure!(
        !app.testid_exists("planner-site-prompt").await?,
        "expected the site-setup prompt to disappear now that a site exists"
    );

    app.shutdown().await
}
