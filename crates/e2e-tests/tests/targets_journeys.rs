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

    // (d) Round 2 (keepMounted alone did NOT fix this — still fails
    // identically cross-platform, deterministically): bypass the UI and
    // invoke the REAL backend `target_search` command directly through the
    // `window.__ALM_E2E__.invoke` bridge, mirroring `inbox_ui_journeys.rs`'s
    // direct-invoke diagnostic. This tells us whether the backend genuinely
    // returns hits for this exact query independent of the frontend
    // combobox/portal — local Chromium+mocks repro (both dev and prod
    // builds) proves the combobox mounts and renders options correctly for
    // typed queries, so if THIS call also returns real hits, the bug is
    // somewhere between the UI's `runSearch` and the DOM (state never
    // reaching `open`/`suggestions`); if it errors or never returns, the bug
    // is in the real IPC round-trip or the backend itself.
    let direct_invoke: serde_json::Value = match app
        .invoke(
            "target_search",
            json!({
                "req": {
                    "contractVersion": "1.0",
                    "requestId": "diag-direct-search",
                    "query": query,
                    "catalogFilter": [],
                    "typeFilter": [],
                    "limit": 20
                }
            }),
        )
        .await
    {
        Ok(v) => v,
        Err(e) => json!({ "direct_invoke_error": e.to_string() }),
    };
    report.push_str(&format!(
        "--- direct backend invoke of target_search({query:?}) ---\n{direct_invoke:#}\n"
    ));

    // (e) General UI-state diagnostics (bridge exposed?, build time, buffered
    // window errors/rejections) — the #477-era instrumentation
    // (`E2eApp::dump_ui_diagnostics`) shared with `inbox_ui_journeys.rs`.
    // `queryState` will be null here (TargetSearch doesn't use react-query),
    // but `bridgeExposed`/`buildTime`/`e2eErrors` are exactly what
    // distinguishes "stale/mismatched frontend build" from "a real uncaught
    // exception the UI swallowed silently" from "genuinely nothing went
    // wrong at the JS level".
    let ui_diag = app.dump_ui_diagnostics().await;
    report.push_str(&format!("--- dump_ui_diagnostics ---\n{ui_diag:#}\n"));

    // (f) Real browser console log tail (best-effort; some WebDriver stacks
    // reject the log endpoint entirely, per `dump_console_log`'s doc).
    let console_log = app.dump_console_log().await;
    report.push_str(&format!("--- dump_console_log ---\n{console_log:#}\n"));

    // (g) Round 3 correction: (a) above only dumps `.alm-target-search`'s
    // OWN outerHTML, and `Combobox.Portal` renders the suggestion listbox at
    // `document.body` — a SIBLING of that subtree, never a descendant — so
    // "absent from (a)'s dump" was never real evidence the listbox didn't
    // render, only that it isn't nested under the search root (which it
    // never was, portal or no portal). Look for it where it ACTUALLY lives:
    // (i) the real listbox via the input's `aria-controls` id (works
    // wherever it was portaled to), (ii) a page-wide count + first-match
    // outerHTML for the exact selector `add_target_via_ui`'s suggestion-poll
    // loop waits on, and (iii) a page-wide count of `[role="listbox"]` /
    // `[role="option"]` in case the class name itself has drifted (e.g. a
    // CSS consolidation rename) independent of Base UI's own ARIA roles.
    let listbox_script = r#"
        var callback = arguments[arguments.length - 1];
        function truncate(s, n) {
            if (typeof s !== 'string') return s;
            return s.length > n ? s.slice(0, n) + '...[truncated]' : s;
        }
        try {
            var input = document.querySelector('.alm-target-search__input');
            var controlsId = input ? input.getAttribute('aria-controls') : null;
            var listboxEl = controlsId ? document.getElementById(controlsId) : null;
            var optionEls = document.querySelectorAll('.alm-target-search__option');
            var roleListboxEls = document.querySelectorAll('[role="listbox"]');
            var roleOptionEls = document.querySelectorAll('[role="option"]');
            callback({
                ok: true,
                value: {
                    ariaControlsId: controlsId,
                    listboxFoundById: !!listboxEl,
                    listboxOuterHtml: truncate(listboxEl ? listboxEl.outerHTML : null, 4096),
                    optionSelectorCount: optionEls.length,
                    optionSelectorFirstOuterHtml: truncate(optionEls[0] ? optionEls[0].outerHTML : null, 2048),
                    roleListboxCount: roleListboxEls.length,
                    roleOptionCount: roleOptionEls.length
                }
            });
        } catch (err) {
            callback({ ok: false, error: String(err) });
        }
    "#;
    match app.driver.execute_async(listbox_script, vec![]).await {
        Ok(ret) => match ret.convert::<serde_json::Value>() {
            Ok(v) => {
                report.push_str(&format!("--- real-listbox / role-based diagnostics ---\n{v:#}\n"))
            }
            Err(e) => {
                report.push_str(&format!("(failed to deserialise listbox diagnostics: {e})\n"))
            }
        },
        Err(e) => report.push_str(&format!("(listbox diagnostics script execution failed: {e})\n")),
    }

    report
}

/// Poll [`E2eApp::count_elements_with_title`] until it reports at least one
/// match or `UI_TIMEOUT` elapses.
///
/// `count_elements_with_title`'s own doc explicitly does NOT poll — a zero
/// count is frequently the CORRECT, expected result for its other callers
/// (asserting an absence), so it hands the "wait for a nonzero count"
/// responsibility to callers that need it. `targets_ui_astronomy_columns_
/// disclose_placeholder_without_site` was calling it exactly once, right
/// after `add_target_via_ui` returns — a real IPC round trip (the target
/// list refetch that must happen before the new row's astronomy cells exist)
/// racing a single synchronous check, with no retry. This is the fix: poll
/// like every other "wait for a real UI state" helper in this harness
/// (`find_waiting`, the suggestion-poll loop in `add_target_via_ui`).
async fn wait_for_title_count_at_least(
    app: &E2eApp,
    title: &str,
    min_count: usize,
) -> anyhow::Result<usize> {
    let deadline = tokio::time::Instant::now() + UI_TIMEOUT;
    loop {
        let count = app.count_elements_with_title(title).await?;
        if count >= min_count {
            return Ok(count);
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(count);
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

/// Diagnostics for a `wait_for_title_count_at_least` timeout: the first real
/// target row's outerHTML (does the row even exist? does it carry the
/// expected muted/unknown cells?) plus a page-wide count for both disclosure
/// titles, so a future red run shows real evidence instead of a bare
/// "expected >= 1, got N".
async fn dump_astronomy_diagnostics(app: &E2eApp) -> String {
    let mut report = String::from("=== astronomy-columns diagnostics ===\n");

    let row_html_script = r"
        var el = document.querySelector('.alm-targets-table__row');
        return el ? el.outerHTML : '<.alm-targets-table__row not found in DOM>';
    ";
    match app.driver.execute(row_html_script, vec![]).await {
        Ok(ret) => match ret.convert::<String>() {
            Ok(html) => report
                .push_str(&format!("--- first .alm-targets-table__row outerHTML ---\n{html}\n")),
            Err(e) => report.push_str(&format!("(failed to deserialise row outerHTML: {e})\n")),
        },
        Err(e) => report.push_str(&format!("(row outerHTML script execution failed: {e})\n")),
    }

    match app.count_elements_with_title(OPPOSITION_UNKNOWN_TITLE).await {
        Ok(n) => report.push_str(&format!("--- OPPOSITION_UNKNOWN_TITLE count: {n} ---\n")),
        Err(e) => report.push_str(&format!("(OPPOSITION_UNKNOWN_TITLE count query failed: {e})\n")),
    }
    match app.count_elements_with_title(LUNAR_UNKNOWN_TITLE).await {
        Ok(n) => report.push_str(&format!("--- LUNAR_UNKNOWN_TITLE count: {n} ---\n")),
        Err(e) => report.push_str(&format!("(LUNAR_UNKNOWN_TITLE count query failed: {e})\n")),
    }

    let ui_diag = app.dump_ui_diagnostics().await;
    report.push_str(&format!("--- dump_ui_diagnostics ---\n{ui_diag:#}\n"));

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
    //
    // Round 3 root cause (#463): this MUST be `app.driver.find` (page-scoped),
    // NOT `popup.find` (scoped to `.alm-add-target__popup`'s subtree).
    // `TargetSearch.tsx`'s `Combobox.Portal` renders the suggestion listbox at
    // `document.body` — a SIBLING of the dialog popup, never a descendant of
    // it — so `popup.find(By::Css(".alm-target-search__option"))` was
    // structurally unable to ever match, regardless of whether the backend
    // responded or the popup actually rendered. This explained every prior
    // round's "no suggestion rendered" symptom even though round-3
    // diagnostics proved the backend answers instantly/correctly and the UI
    // buffers no errors: the assertion itself was searching the wrong DOM
    // subtree, cross-platform and deterministically. The mock-Playwright spec
    // (`targets_planner.spec.ts` 9.2b) never hit this because Playwright's
    // `page.locator(...)` is page-scoped by default.
    let deadline = tokio::time::Instant::now() + UI_TIMEOUT;
    let option = loop {
        if let Ok(opt) = app.driver.find(By::Css(".alm-target-search__option")).await {
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

    // Poll rather than a single check: the target row `add_target_via_ui` just
    // added still needs the real list-query refetch to land before its
    // astronomy cells (and therefore this title) exist in the DOM.
    let opposition_count = wait_for_title_count_at_least(&app, OPPOSITION_UNKNOWN_TITLE, 1).await?;
    if opposition_count < 1 {
        let diagnostics = dump_astronomy_diagnostics(&app).await;
        anyhow::bail!(
            "expected at least one real 'Opposition unknown' disclosure with no observing \
             site within {UI_TIMEOUT:?}, got {opposition_count}\n{diagnostics}"
        );
    }
    let lunar_count = wait_for_title_count_at_least(&app, LUNAR_UNKNOWN_TITLE, 1).await?;
    if lunar_count < 1 {
        let diagnostics = dump_astronomy_diagnostics(&app).await;
        anyhow::bail!(
            "expected at least one real 'Lunar distance unknown' disclosure with no observing \
             site within {UI_TIMEOUT:?}, got {lunar_count}\n{diagnostics}"
        );
    }

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
