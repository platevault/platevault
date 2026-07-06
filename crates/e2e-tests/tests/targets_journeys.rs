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

/// DIAGNOSTIC ONLY (not a fix): capture what the `.alm-target-search` widget
/// actually rendered when the suggestion-poll loop in [`add_target_via_ui`]
/// times out, so the NEXT CI run tells us whether Phase 1 (`target.search`)
/// threw, is still "resolving" (stuck on Phase 2 / SIMBAD), or genuinely
/// rendered zero suggestions.
///
/// Two refuted hypotheses already ruled out by code review (see the branch's
/// PR discussion): (1) the test fills the input via real `send_keys`, not a
/// JS value-set, so React's change/debounce handlers should fire; (2) Phase 1
/// (local seed search, `crates/app/targets/src/target_search.rs`, no network)
/// completes and calls `setSuggestions` BEFORE Phase 2 (SIMBAD `target.resolve`)
/// even starts, so a stuck/slow Phase 2 should not be able to block Phase 1's
/// already-rendered result. This capture exists to falsify or confirm both
/// with real evidence instead of guessing further.
///
/// Everything is printed via `anyhow::Error`'s `Display`/`Debug` chain so it
/// shows up directly in the nextest failure's stdout/stderr — no artifact
/// upload plumbing required. A best-effort screenshot is ALSO written to
/// `target/e2e-diagnostics/` (uploaded by the workflow's
/// `upload-artifact` step on failure) in case the DOM text alone doesn't
/// explain it.
async fn dump_target_search_diagnostics(app: &E2eApp, query: &str) -> String {
    let mut report = format!("=== target-search diagnostics for query {query:?} ===\n");

    // (a) DOM dump: outerHTML of the whole `.alm-target-search` root (input +
    // filters + status + any rendered options), not the full page — small and
    // directly relevant.
    let outer_html_script = r"
        var el = document.querySelector('.alm-target-search');
        return el ? el.outerHTML : '<.alm-target-search not found in DOM>';
    ";
    match app.driver.execute(outer_html_script, vec![]).await {
        Ok(ret) => match ret.convert::<String>() {
            Ok(html) => report.push_str(&format!("--- .alm-target-search outerHTML ---\n{html}\n")),
            Err(e) => report.push_str(&format!("(failed to deserialise outerHTML: {e})\n")),
        },
        Err(e) => report.push_str(&format!("(outerHTML script execution failed: {e})\n")),
    }

    // (b) Explicit state check: is a real `role="alert"` field error visible
    // (Phase 1 threw, `TargetSearch.tsx`'s catch branch), or is the
    // `--resolving` status still showing (stuck on Phase 2 / SIMBAD)?
    match app.driver.find(By::Css(".alm-field-error")).await {
        Ok(el) => {
            let text = el.text().await.unwrap_or_default();
            report.push_str(&format!("--- error state: PRESENT, text={text:?} ---\n"));
        }
        Err(_) => report.push_str("--- error state: absent ---\n"),
    }
    match app.driver.find(By::Css(".alm-target-search__status--resolving")).await {
        Ok(el) => {
            let text = el.text().await.unwrap_or_default();
            report.push_str(&format!(
                "--- resolving (SIMBAD phase-2) state: PRESENT, text={text:?} ---\n"
            ));
        }
        Err(_) => report.push_str("--- resolving (SIMBAD phase-2) state: absent ---\n"),
    }
    match app.driver.find(By::Css(".alm-target-search__status")).await {
        Ok(el) => {
            let text = el.text().await.unwrap_or_default();
            report.push_str(&format!("--- generic status line: PRESENT, text={text:?} ---\n"));
        }
        Err(_) => report.push_str("--- generic status line: absent ---\n"),
    }

    // (c) Best-effort screenshot — written to a fixed, predictable path per
    // query so the workflow's failure-only `upload-artifact` step can pick up
    // `target/e2e-diagnostics/*.png` regardless of which test/OS failed.
    let dir = std::path::Path::new("target/e2e-diagnostics");
    if std::fs::create_dir_all(dir).is_ok() {
        let safe_query: String =
            query.chars().map(|c| if c.is_alphanumeric() { c } else { '_' }).collect();
        let path = dir.join(format!("target-search-timeout-{safe_query}.png"));
        match app.driver.screenshot(&path).await {
            Ok(()) => report.push_str(&format!("--- screenshot written to {path:?} ---\n")),
            Err(e) => report.push_str(&format!("(screenshot capture failed: {e})\n")),
        }
    } else {
        report.push_str("(failed to create target/e2e-diagnostics/ directory)\n");
    }

    report
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
        if tokio::time::Instant::now() >= deadline {
            let diagnostics = dump_target_search_diagnostics(app, query).await;
            anyhow::bail!(
                "no suggestion rendered for query {query:?} within {UI_TIMEOUT:?} \
                 (offline seed search should be instant for a bundled designation)\n{diagnostics}"
            );
        }
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
