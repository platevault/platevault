//! Spec 037 Layer-2 real-UI journeys — Calibration masters (batch #3 of the
//! coverage-matrix "Batched plan", Journey 8): masters-ingest-as-individual-
//! items and the Calibration page's kind-conditional master detail, promoted
//! from `docs/development/windows-journeys/journey-08-calibration-masters-matching.md`.
//!
//! Spec 040 (calibration master detection) shipped without a `plan.md`/
//! `tasks.md` (a documented deviation) and had the least automated scrutiny
//! of any recently-shipped backend feature before this file.
//!
//! ## Documented, real gap found while authoring this file (NOT fixed here)
//!
//! Journey-08's Tests 3-5 (ranked-candidate matching view, assign/cancel,
//! offset-tolerance affecting live matching) describe a
//! `MatchCandidatesPanel` (`apps/desktop/src/features/calibration/
//! MatchCandidatesPanel.tsx`) UI. That component is fully implemented and
//! unit-tested (`MatchCandidatesPanel.test.tsx`, jsdom) but **no page mounts
//! it** — `git grep MatchCandidatesPanel apps/desktop/src` outside its own
//! test finds no importer, and `CalibrationPage.tsx` (read in full while
//! authoring this file) renders only `MastersTable` + `MasterDetail`, never
//! the match panel. `CalibrationMatchPanel.tsx` (`features/projects/`, a
//! DIFFERENT, read-only component wired into the project detail page) even
//! says in its own doc comment "assignment is done from the Calibration page
//! (CalibrationPage + MasterDetail)" — that wiring does not exist in the
//! code as of this writing. This is a real product gap, not a test gap: the
//! matching/assign UI is unreachable from the real app today, so it cannot
//! be promoted to a Layer-2 UI journey without a product wiring fix first.
//! Flagged in the coverage matrix rather than faked here.

mod common;

use std::time::Duration;

use common::{write_minimal_fits, E2eApp};
use serde_json::json;

const UI_TIMEOUT: Duration = Duration::from_secs(20);

async fn register_calibration_root(app: &E2eApp) -> anyhow::Result<(tempfile::TempDir, String)> {
    let root_dir = tempfile::tempdir()?;
    let register: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({
                "path": root_dir.path().to_string_lossy(),
                "category": "calibration",
                "scanSettings": null,
            }),
        )
        .await?;
    let root_id = register["sourceId"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("roots.register returned no sourceId: {register}"))?
        .to_owned();
    let _: serde_json::Value = app
        .invoke(
            "sources_set_organization_state",
            json!({ "sourceId": root_id, "organizationState": "unorganized" }),
        )
        .await?;
    Ok((root_dir, root_id))
}

/// Test 1 (journey-08): a folder with a master dark AND a master bias — real
/// WBPP-style `IMAGETYP = "Master Dark"` / `"Master Bias"` headers, detected
/// by the real `PixInsightDetector`
/// (`crates/calibration/master-detect/src/pixinsight.rs`) — materializes as
/// TWO individual real Inbox items, never one ambiguous folder aggregate.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn calibration_ui_masters_ingest_as_individual_items() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;

    let (root_dir, _root_id) = register_calibration_root(&app).await?;
    write_minimal_fits(
        root_dir.path(),
        "master_dark_001.fits",
        "Master Dark",
        None,
        None,
        Some("2026-01-05T12:00:00"),
    )?;
    write_minimal_fits(
        root_dir.path(),
        "master_bias_001.fits",
        "Master Bias",
        None,
        None,
        Some("2026-01-05T12:00:00"),
    )?;

    app.goto_route("/inbox").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.click_by_aria_label("Rescan all roots").await?;
    app.wait_testid_prefix_present("inbox-item-", UI_TIMEOUT).await?;

    let rows = app.find_all_testid_prefix("inbox-item-").await?;
    anyhow::ensure!(
        rows.len() >= 2,
        "expected the master dark + master bias to appear as 2 individual real \
         Inbox items (not one folder aggregate), found {}",
        rows.len()
    );
    let mut saw_master_label = 0usize;
    for row in &rows {
        let text = row.text().await.unwrap_or_default().to_lowercase();
        if text.contains("master") {
            saw_master_label += 1;
        }
    }
    anyhow::ensure!(
        saw_master_label >= 2,
        "expected each master item's row to carry a real 'N master' label \
         (`inbox_master_row_label`), got {saw_master_label} of {} rows",
        rows.len()
    );

    app.shutdown().await
}

/// Test 2 (journey-08): confirming + applying a master bias item via the real
/// Inbox UI registers it as a real `CalibrationMaster` row on the real
/// Calibration page (`master-row-<id>` — added as a thin, additive test hook
/// on `MastersTable.tsx`, mirroring the existing `inbox-item-<id>` row-testid
/// convention already used by `InboxList.tsx`), and the kind-conditional
/// Temperature property (only meaningful when `fingerprint.tempC` is present)
/// is genuinely OMITTED from the master's detail — not a fabricated number —
/// because this fixture carries no temperature header.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn calibration_ui_confirmed_master_shows_kind_conditional_detail() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;

    let (root_dir, _root_id) = register_calibration_root(&app).await?;
    write_minimal_fits(
        root_dir.path(),
        "master_bias_002.fits",
        "Master Bias",
        None,
        None,
        Some("2026-01-06T12:00:00"),
    )?;

    app.goto_route("/inbox").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.click_by_aria_label("Rescan all roots").await?;
    let item_id = app.testid_suffix("inbox-item-").await?;
    app.click_testid(&format!("inbox-item-{item_id}")).await?;
    app.wait_testid_enabled("inbox-confirm-btn", UI_TIMEOUT).await.map_err(|e| {
        anyhow::anyhow!(
            "expected the single master-bias item to classify single_type and enable Confirm: {e}"
        )
    })?;
    app.click_testid("inbox-confirm-btn").await?;

    app.wait_testid("inbox-review-plans-btn", UI_TIMEOUT).await?;
    app.click_testid("inbox-review-plans-btn").await?;
    app.wait_testid("plan-panel", UI_TIMEOUT).await?;
    app.click_testid("plan-apply-all").await?;

    // Real backend read: confirm the master really registered
    // (`calibration.masters.list`), and use its real id to find the real DOM
    // row on the Calibration page below — never a fixture id.
    let masters: serde_json::Value = app
        .invoke_until("calibration_masters_list", json!({}), UI_TIMEOUT, |v: &serde_json::Value| {
            v.as_array().is_some_and(|a| !a.is_empty())
        })
        .await?;
    let master = masters
        .as_array()
        .and_then(|a| {
            a.iter().find(|m| m["kind"].as_str().unwrap_or_default().eq_ignore_ascii_case("bias"))
        })
        .ok_or_else(|| {
            anyhow::anyhow!("expected a real bias master in calibration.masters.list: {masters}")
        })?;
    let master_id = master["id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("master has no id: {master}"))?
        .to_owned();

    app.goto_route("/calibration").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.wait_testid(&format!("master-row-{master_id}"), UI_TIMEOUT).await.map_err(|e| {
        anyhow::anyhow!(
            "expected the real master {master_id} as its own row on the Calibration page: {e}"
        )
    })?;

    // Select it: `MasterDetail` mounts in the right-side detail pane.
    app.click_testid(&format!("master-row-{master_id}")).await?;

    // Wait for the detail pane to actually render (the "Kind" property is
    // ALWAYS present, unconditionally) before asserting anything is absent —
    // otherwise a not-yet-rendered pane would trivially "pass" the absence
    // check below.
    let deadline = tokio::time::Instant::now() + UI_TIMEOUT;
    loop {
        if page_contains_text(&app, "Kind").await? {
            break;
        }
        anyhow::ensure!(
            tokio::time::Instant::now() < deadline,
            "MasterDetail never rendered its 'Kind' property within {UI_TIMEOUT:?}"
        );
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    // Now assert the kind-conditional Temperature row is genuinely absent
    // (fp.tempC is null for this fixture — `MasterDetail.tsx` omits the whole
    // property row rather than rendering a fabricated dash/number).
    anyhow::ensure!(
        !page_contains_text(&app, "Temperature").await?,
        "expected the Temperature property row to be omitted (not a dash) for a master with no tempC"
    );

    app.shutdown().await
}

/// `true` if any element on the current page contains the exact text
/// `needle` — a coarse but real DOM check for a property LABEL that should
/// be conditionally absent (`MasterDetail.tsx` omits the whole `PropertyDef`
/// entry rather than rendering a dash when `fp.tempC` is null).
async fn page_contains_text(app: &E2eApp, needle: &str) -> anyhow::Result<bool> {
    use thirtyfour::error::WebDriverErrorInner;
    let xpath = format!("//*[text()[contains(., '{needle}')]]");
    match app.driver.find(thirtyfour::By::XPath(&xpath)).await {
        Ok(_) => Ok(true),
        Err(e) if matches!(e.as_inner(), WebDriverErrorInner::NoSuchElement(_)) => Ok(false),
        Err(e) => Err(e.into()),
    }
}
