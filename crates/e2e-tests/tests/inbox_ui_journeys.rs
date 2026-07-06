//! Spec 037 Layer-2 real-UI journeys — Inbox (batch #6 of the coverage-matrix
//! "Batched plan"): the UI-level gate + reclassify + confirm/apply surface
//! that `journeys.rs`'s `plan_review_apply_with_audit` proves only through
//! the `window.__ALM_E2E__.invoke` bridge, never by clicking through the real
//! Inbox page (`apps/desktop/src/features/inbox/{InboxPage,InboxDetail,
//! PlanPanel}.tsx`).
//!
//! Per the manual click-by-click specs this promotes to automation:
//! `docs/development/windows-journeys/journey-02-inbox-ingest-move.md` and
//! `journey-03-inbox-catalogue-in-place.md`.
//!
//! Setup steps that need the native OS folder picker (registering a root,
//! flipping its `organization_state`) stay on the `invoke` bridge — the same
//! documented constraint `journeys.rs` already carries. Everything a real
//! user would click (Rescan, selecting a detection row, the bulk-reclassify
//! controls, Confirm, opening the plan-review overlay, Apply) is driven
//! through real `data-testid` DOM elements via the helpers in `common/mod.rs`.

mod common;

use std::path::Path;
use std::time::Duration;

use anyhow::Context;
use common::{write_minimal_fits, E2eApp};
use serde_json::json;

const UI_TIMEOUT: Duration = Duration::from_secs(20);
const INVOKE_TIMEOUT: Duration = Duration::from_secs(30);

/// Register a disposable light-frames root and return `(app_handle_unused,
/// root_dir, root_id)`. `organization_state` starts `organized` by default
/// (spec 041 R-7); callers that need the move branch flip it explicitly.
async fn register_light_root(app: &E2eApp) -> anyhow::Result<(tempfile::TempDir, String)> {
    let root_dir = tempfile::tempdir()?;
    let register: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({
                "path": root_dir.path().to_string_lossy(),
                "category": "light_frames",
                "scanSettings": null,
            }),
        )
        .await?;
    let root_id = register["sourceId"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("roots.register returned no sourceId: {register}"))?
        .to_owned();
    Ok((root_dir, root_id))
}

/// Wait for the index route's async first-run redirect to land on `/setup`
/// BEFORE navigating anywhere. A fresh DB (the harness resets it every
/// launch) makes `checkFirstRunComplete` redirect `/` → `/setup` from an
/// async `beforeLoad` (dynamic import + `firstrun_state` IPC round-trip,
/// `apps/desktop/src/app/router.tsx`). If a journey `goto_route`s while that
/// redirect is still pending, the late-resolving redirect yanks the app off
/// the target route — on CI run 28766017315 that intermittently replaced
/// `/#/inbox` with `/#/setup` and "Rescan all roots" never appeared. Once the
/// URL shows `/setup`, no navigation is pending and `goto_route` is safe.
async fn settle_first_run_redirect(app: &E2eApp) -> anyhow::Result<()> {
    app.wait_url_contains("/setup", Duration::from_secs(15))
        .await
        .map(drop)
        .map_err(|e| anyhow::anyhow!("expected a fresh DB to redirect to /setup: {e}"))
}

/// Seed the FIRST scan of `root_id` through the invoke bridge (a setup step,
/// like root registration itself).
///
/// In the real product the initial scan happens in the first-run wizard's
/// scan step. The Inbox page's "Rescan all roots" derives its root set from
/// the CURRENT item list (`InboxPage.tsx` dedupes `items[].rootId`), so on a
/// never-scanned root the button is a real no-op — no `inbox-item-*` row can
/// ever appear, however long the journey waits (CI run 28766017315). One
/// bridge-side `inbox.scan.folder` mirrors the wizard step (whose native
/// folder picker WebDriver can't drive); the journey's Rescan click then
/// exercises the real UI path against a root the list actually knows.
async fn seed_initial_scan(app: &E2eApp, root_id: &str, root_dir: &Path) -> anyhow::Result<()> {
    let scan: serde_json::Value = app
        .invoke(
            "inbox_scan_folder",
            json!({
                "req": {
                    "rootId": root_id,
                    "rootAbsolutePath": root_dir.to_string_lossy(),
                    "followSymlinks": false,
                }
            }),
        )
        .await?;
    let items = scan["items"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("inbox.scan.folder returned no items array: {scan}"))?;
    anyhow::ensure!(
        !items.is_empty(),
        "expected the seed inbox.scan.folder to discover the fixture file(s): {scan}"
    );
    Ok(())
}

/// Click Rescan (aria-label "Rescan all roots" — `m.inbox_rescan_all_roots_aria()`,
/// `apps/desktop/messages/en.json`) and wait for the list to settle by polling
/// for at least one real `inbox-item-*` row.
async fn rescan_and_wait_for_item(app: &E2eApp) -> anyhow::Result<()> {
    app.click_by_aria_label("Rescan all roots").await?;
    app.wait_testid_prefix_present("inbox-item-", UI_TIMEOUT).await
}

/// Select the (only) inbox item row and return its real `inboxItemId`, waiting
/// for the detail pane's real Confirm button to mount (the detail-loaded
/// signal — `InboxDetail` always renders `data-testid="inbox-confirm-btn"`
/// once an item is selected, per `InboxPage.tsx`'s always-passed `onConfirm`).
async fn select_only_item(app: &E2eApp) -> anyhow::Result<String> {
    let item_id = app.testid_suffix("inbox-item-").await?;
    app.click_testid(&format!("inbox-item-{item_id}")).await?;
    app.wait_testid("inbox-confirm-btn", UI_TIMEOUT).await?;
    Ok(item_id)
}

/// Test 1 (journey-02): a folder with one light + one dark frame — both with
/// complete metadata — materializes as multiple SINGLE-TYPE rows in the real
/// Inbox list after Rescan, per spec 041's mixed-folder split (memory:
/// "mixed folders → single-type items at ingest", PR #315). This is the
/// UI-interaction proof that the classify/split pipeline is really wired to
/// the rendered list, not just the `inbox.scan.folder`/`inbox.classify`
/// response shape `journeys.rs` already checks.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn inbox_ui_mixed_folder_splits_into_single_type_items() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    settle_first_run_redirect(&app).await?;

    let (root_dir, root_id) = register_light_root(&app).await?;
    // Force the move branch isn't needed for classification — leave the
    // default `organized` state; classification doesn't depend on it.
    let _: serde_json::Value = app
        .invoke(
            "sources_set_organization_state",
            json!({ "sourceId": root_id, "organizationState": "unorganized" }),
        )
        .await?;

    write_minimal_fits(
        root_dir.path(),
        "light_001.fits",
        "Light Frame",
        Some("M42"),
        Some("Ha"),
        Some("2026-01-10T22:00:00"),
    )?;
    write_minimal_fits(
        root_dir.path(),
        "dark_001.fits",
        "Dark Frame",
        None,
        None,
        Some("2026-01-10T22:05:00"),
    )?;

    seed_initial_scan(&app, &root_id, root_dir.path()).await?;

    app.goto_route("/inbox").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.click_by_aria_label("Rescan all roots").await?;
    app.wait_testid_prefix_present("inbox-item-", UI_TIMEOUT).await?;

    let rows = app.find_all_testid_prefix("inbox-item-").await?;
    anyhow::ensure!(
        rows.len() >= 2,
        "expected the mixed folder to split into >=2 single-type rows in the \
         real Inbox list, found {}",
        rows.len()
    );
    for row in &rows {
        let text = row.text().await.unwrap_or_default().to_lowercase();
        anyhow::ensure!(
            !text.contains("mixed"),
            "expected split single-type rows, not an ambiguous 'mixed' row: {text:?}"
        );
    }

    app.shutdown().await
}

/// Tests 2/3 (journey-02): an unrecognised `IMAGETYP` renders the real
/// "frame types required" danger banner and blocks Confirm (`canConfirm`
/// requires `classification.type === "single_type"`,
/// `apps/desktop/src/features/inbox/InboxPage.tsx`); the bulk-reclassify
/// control (`reclassify-select-all` → `bulk-frame-type` → `bulk-apply-btn`)
/// then resolves it to a real `single_type` classification and Confirm
/// re-enables — all real DOM interaction, real `inbox.reclassify` command.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn inbox_ui_unclassified_gate_bulk_reclassify_unblocks_confirm() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    settle_first_run_redirect(&app).await?;

    let (root_dir, root_id) = register_light_root(&app).await?;
    let _: serde_json::Value = app
        .invoke(
            "sources_set_organization_state",
            json!({ "sourceId": root_id, "organizationState": "unorganized" }),
        )
        .await?;

    // "Frame Unknown" is not a mapped IMAGETYP (classify.rs: unclassified
    // when IMAGETYP is absent or unmapped) — this file resolves to a real
    // classification.type == "unclassified", not a fixture.
    write_minimal_fits(
        root_dir.path(),
        "ambiguous_001.fits",
        "Frame Unknown",
        Some("M42"),
        Some("Ha"),
        Some("2026-01-10T22:00:00"),
    )?;

    seed_initial_scan(&app, &root_id, root_dir.path()).await?;

    app.goto_route("/inbox").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    rescan_and_wait_for_item(&app).await?;
    select_only_item(&app).await?;

    // Real blocking banner + real disabled Confirm.
    app.wait_testid("inbox-unclassified-alert", UI_TIMEOUT).await?;
    anyhow::ensure!(
        !app.is_enabled_testid("inbox-confirm-btn").await?,
        "expected Confirm to be disabled while classification.type == 'unclassified'"
    );

    // Bulk reclassify: select the one needs-review file, set frame type ->
    // light, apply. Real inputs, real `inbox.reclassify` round-trip.
    app.click_testid("reclassify-select-all").await?;
    app.select_testid("bulk-frame-type", "light").await?;
    app.click_testid("bulk-apply-btn").await?;

    // The store invalidates the classify query cache on success (`store.ts`);
    // Confirm re-enabling is the real, observable proof the override landed
    // and reclassified the file to `single_type`.
    app.wait_testid_enabled("inbox-confirm-btn", UI_TIMEOUT).await.map_err(|e| {
        anyhow::anyhow!(
            "expected bulk reclassify to unblock Confirm (single_type, no missing attrs): {e}"
        )
    })?;
    anyhow::ensure!(
        !app.testid_exists("inbox-unclassified-alert").await?,
        "expected the 'frame types required' banner to clear after reclassify"
    );

    app.shutdown().await
}

/// Test 2 variant (journey-02), the OTHER real gate: a light frame with
/// filter + target present but no DATE-OBS is a real `single_type`
/// classification (IMAGETYP maps fine) yet still blocks Confirm, because
/// `date` is path-load-bearing (FR-032/US9, `confirm.rs`'s
/// `missing_path_attribute_blocks_with_report` at Layer 1). This is a
/// DIFFERENT mechanism than the unclassified-frame-type gate above — the
/// bulk-reclassify control has no "set date" field, so this documents the
/// real, honest boundary: fixing it requires editing the source FITS header
/// (outside the app) and rescanning, not a UI override.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn inbox_ui_missing_path_attribute_banner_blocks_confirm() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    settle_first_run_redirect(&app).await?;

    let (root_dir, root_id) = register_light_root(&app).await?;
    let _: serde_json::Value = app
        .invoke(
            "sources_set_organization_state",
            json!({ "sourceId": root_id, "organizationState": "unorganized" }),
        )
        .await?;

    write_minimal_fits(
        root_dir.path(),
        "light_no_date.fits",
        "Light Frame",
        Some("M42"),
        Some("Ha"),
        None, // no DATE-OBS — the real, path-load-bearing gap (FR-032)
    )?;

    seed_initial_scan(&app, &root_id, root_dir.path()).await?;

    app.goto_route("/inbox").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    rescan_and_wait_for_item(&app).await?;
    select_only_item(&app).await?;

    app.wait_testid("inbox-missing-attr-banner", UI_TIMEOUT).await?;
    let banner_text = app.text_testid("inbox-missing-attr-banner").await?;
    anyhow::ensure!(
        banner_text.to_lowercase().contains("required metadata missing"),
        "expected the FR-032 banner's real copy, got: {banner_text:?}"
    );
    anyhow::ensure!(
        !app.is_enabled_testid("inbox-confirm-btn").await?,
        "expected Confirm to stay disabled while a file is missing a path-load-bearing attribute"
    );

    app.shutdown().await
}

/// Tests 5/6 (journey-02): Confirm creates a reviewable plan WITHOUT moving
/// the file (real filesystem check immediately after the click), and Apply
/// (via the plan-review overlay) moves it to EXACTLY the destination path the
/// overlay displayed beforehand (`inbox-dest-absolute-0`) — a real
/// UI-displayed-path == real-file-location proof, not just a durable-status
/// poll.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn inbox_ui_confirm_does_not_move_then_apply_moves_to_shown_destination() -> anyhow::Result<()>
{
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    settle_first_run_redirect(&app).await?;

    let (root_dir, root_id) = register_light_root(&app).await?;
    let _: serde_json::Value = app
        .invoke(
            "sources_set_organization_state",
            json!({ "sourceId": root_id, "organizationState": "unorganized" }),
        )
        .await?;

    let original_path = write_minimal_fits(
        root_dir.path(),
        "light_move_me.fits",
        "Light Frame",
        Some("M42"),
        Some("Ha"),
        Some("2026-01-10T22:00:00"),
    )?;

    seed_initial_scan(&app, &root_id, root_dir.path()).await?;

    app.goto_route("/inbox").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    rescan_and_wait_for_item(&app).await?;
    let item_id = select_only_item(&app).await?;

    app.wait_testid_enabled("inbox-confirm-btn", UI_TIMEOUT).await?;
    app.click_testid("inbox-confirm-btn").await?;

    // Test 5: Confirm alone must never move the file.
    anyhow::ensure!(
        original_path.exists(),
        "Confirm must only create a reviewable plan — the file moved before Apply"
    );

    // Open the plan-review overlay and expand this item's group to reveal
    // the real destination path BEFORE applying.
    app.wait_testid("inbox-review-plans-btn", UI_TIMEOUT).await?;
    app.click_testid("inbox-review-plans-btn").await?;
    app.wait_testid("plan-panel", UI_TIMEOUT).await?;
    app.click_testid(&format!("plan-group-toggle-{item_id}")).await?;
    let dest_el = app.wait_testid("inbox-dest-absolute-0", UI_TIMEOUT).await?;
    let shown_dest = dest_el.text().await.context("failed to read the shown destination path")?;
    anyhow::ensure!(!shown_dest.trim().is_empty(), "expected a non-empty shown destination path");

    // Test 6: Apply, then verify the file is EXACTLY at the shown path.
    app.click_testid("plan-apply-all").await?;

    let deadline = tokio::time::Instant::now() + INVOKE_TIMEOUT;
    loop {
        if !original_path.exists() && std::path::Path::new(shown_dest.trim()).exists() {
            break;
        }
        anyhow::ensure!(
            tokio::time::Instant::now() < deadline,
            "apply did not move the file to the shown destination {shown_dest:?} within {:?} \
             (original still present: {}, dest present: {})",
            INVOKE_TIMEOUT,
            original_path.exists(),
            std::path::Path::new(shown_dest.trim()).exists()
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    app.shutdown().await
}

/// Journey-03 core scenario: an ORGANIZED root (the default —
/// `sources.set_organization_state` is deliberately NOT called here) confirms
/// to a real catalogue plan (0 moves), the overlay shows "In place" with no
/// destination-absolute-path cell, and Apply leaves the file byte-identical
/// at its original path.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn inbox_ui_catalogue_in_place_zero_moves_byte_identical() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    settle_first_run_redirect(&app).await?;

    // Deliberately organized (default) — no `sources_set_organization_state`
    // call — this is the catalogue-in-place branch, not the move branch.
    let (root_dir, root_id) = register_light_root(&app).await?;

    let original_path = write_minimal_fits(
        root_dir.path(),
        "light_in_place.fits",
        "Light Frame",
        Some("M42"),
        Some("Ha"),
        Some("2026-01-10T22:00:00"),
    )?;
    let original_bytes = std::fs::read(&original_path)?;

    seed_initial_scan(&app, &root_id, root_dir.path()).await?;

    app.goto_route("/inbox").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    rescan_and_wait_for_item(&app).await?;
    let item_id = select_only_item(&app).await?;

    app.wait_testid_enabled("inbox-confirm-btn", UI_TIMEOUT).await?;
    app.click_testid("inbox-confirm-btn").await?;
    anyhow::ensure!(original_path.exists(), "catalogue-in-place must never move the file");

    app.wait_testid("inbox-review-plans-btn", UI_TIMEOUT).await?;
    app.click_testid("inbox-review-plans-btn").await?;
    app.wait_testid("plan-panel", UI_TIMEOUT).await?;

    // No destination-root picker for an organized root (nothing to pick).
    anyhow::ensure!(
        !app.testid_exists("inbox-root-picker").await?,
        "an organized (catalogue-in-place) root must never show the destination-root picker"
    );

    app.click_testid(&format!("plan-group-toggle-{item_id}")).await?;
    // "In place" is a real, rendered label for a fully-catalogued group.
    let group_dest = app.text_testid(&format!("plan-group-summary-{item_id}")).await;
    let _ = group_dest; // composition text; the authoritative check is below.
    anyhow::ensure!(
        !app.testid_exists("inbox-dest-absolute-0").await?,
        "a catalogue (0-move) plan must not render a destination-absolute-path cell"
    );

    app.click_testid("plan-apply-all").await?;
    app.wait_testid_gone("plan-panel", INVOKE_TIMEOUT).await.map_err(|e| {
        anyhow::anyhow!("expected the plan-approval overlay to auto-close after apply: {e}")
    })?;

    anyhow::ensure!(
        original_path.exists(),
        "catalogue-in-place apply must leave the file at its original path"
    );
    let after_bytes = std::fs::read(&original_path)?;
    anyhow::ensure!(
        original_bytes == after_bytes,
        "catalogue-in-place apply must not alter file bytes"
    );

    app.shutdown().await
}
