//! Spec 037 Layer-2 real-UI journey — Project creation wizard (batch #10 of
//! the coverage-matrix "Batched plan", Journey 5). Promotes journey-05's
//! Tests 1/2: duplicate-name inline error (never a generic toast) and
//! real on-disk folder creation under the REGISTERED PROJECT LIBRARY root
//! (the exact bug PR #414 fixed — folders used to land next to the app's
//! own working directory instead).
//!
//! Scoped to these two: the wizard's Sources step gates `canAdvance()` on
//! having at least one selected session (`WizardPage.tsx::canAdvance`, case
//! 1), so reaching the Review/Create step at all requires a real confirmed
//! session — this journey builds one via the same real ingest pipeline
//! `journeys.rs`/`sessions_journeys.rs` use. Tests 3-7 (attach/remove-source
//! UX, per-channel integration time, manifests/notes autosave, tool-launch
//! spawn + containment, artifact watcher) are left as documented follow-ups:
//! several need a configured processing-tool executable or a real process/
//! filesystem watcher, which would meaningfully grow this file's scope
//! beyond the wizard-creation flow this journey already exercises.

mod common;

use std::time::Duration;

use anyhow::Context;
use common::{write_minimal_fits, E2eApp};
use serde_json::json;
use thirtyfour::By;

const UI_TIMEOUT: Duration = Duration::from_secs(30);

/// Registers a disposable "project" category root (the registered project
/// LIBRARY the wizard's derived project path is anchored under, per PR
/// #414), plus one real confirmed session (M 31) so the wizard's Sources
/// step can advance. Returns the project library root's absolute path.
async fn setup_project_library_and_one_session(app: &E2eApp) -> anyhow::Result<std::path::PathBuf> {
    let project_root_dir = tempfile::tempdir()?;
    let project_root_path = project_root_dir.path().to_path_buf();
    // Leaked deliberately: the TempDir must outlive this function, but the
    // journey needs the path for its whole lifetime, not just setup — keep
    // the directory alive by leaking the guard (acceptable in a short-lived
    // test process; the OS reclaims it at process exit).
    std::mem::forget(project_root_dir);

    let _: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({ "path": project_root_path.to_string_lossy(), "category": "project", "scanSettings": null }),
        )
        .await?;

    // Real ingest pipeline (mirrors `sessions_journeys.rs`) to get one real
    // confirmed session with a known target, so the wizard's Sources step
    // has something real to select.
    let root_dir = tempfile::tempdir()?;
    write_minimal_fits(
        root_dir.path(),
        "light_m31_wizard_001.fits",
        "Light Frame",
        Some("M 31"),
        Some("Ha"),
        Some("2026-01-13T21:30:00"),
    )?;
    let register: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({ "path": root_dir.path().to_string_lossy(), "category": "light_frames", "scanSettings": null }),
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
    let scan: serde_json::Value = app
        .invoke(
            "inbox_scan_folder",
            json!({
                "req": {
                    "rootId": root_id,
                    "rootAbsolutePath": root_dir.path().to_string_lossy(),
                    "followSymlinks": false,
                }
            }),
        )
        .await?;
    let inbox_item_id = scan["items"][0]["inboxItemId"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("inbox.scan.folder discovered no item: {scan}"))?
        .to_owned();
    let classify: serde_json::Value = app
        .invoke(
            "inbox_classify",
            json!({
                "req": {
                    "inboxItemId": inbox_item_id,
                    "forceRescan": false,
                    "rootAbsolutePath": root_dir.path().to_string_lossy(),
                }
            }),
        )
        .await?;
    let content_signature = classify["contentSignature"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("inbox.classify returned no contentSignature: {classify}"))?
        .to_owned();
    let _: serde_json::Value = app
        .invoke(
            "inbox_confirm",
            json!({
                "req": {
                    "inboxItemId": inbox_item_id,
                    "contentSignature": content_signature,
                    "destructiveDestination": null,
                    "rootAbsolutePath": root_dir.path().to_string_lossy(),
                    "rootId": null,
                }
            }),
        )
        .await?;
    let _: serde_json::Value =
        app.invoke("inbox_plan_apply", json!({ "inboxItemId": inbox_item_id })).await?;

    // Session grouping is event-driven — poll the real backend read until it
    // resolves before the wizard needs it.
    let _: serde_json::Value = app
        .invoke_until("sessions_list", json!({}), UI_TIMEOUT, |v: &serde_json::Value| {
            v.as_array().is_some_and(|arr| {
                arr.iter().any(|s| s["targetIds"].as_array().is_some_and(|t| !t.is_empty()))
            })
        })
        .await
        .context("expected the M 31 session to resolve before the wizard needs it")?;

    Ok(project_root_path)
}

/// Drive the wizard's Name -> Sources -> Calibration -> Views -> Naming ->
/// Review steps for a given project `name`, ending with a click on the real
/// Create button (`data-testid="wizard-create-btn"`) — real DOM interaction
/// throughout, no invoke shortcuts.
async fn run_wizard_to_create(app: &E2eApp, name: &str) -> anyhow::Result<()> {
    // Poll for the wizard's Name step to actually mount: it opens
    // asynchronously after the navigation, same route/render race
    // `E2eApp::find_waiting` documents.
    let name_input = app
        .find_waiting(By::Id("project-name"), "the wizard's #project-name input")
        .await
        .context("no #project-name input found")?;
    name_input.clear().await?;
    name_input.send_keys(name).await?;

    app.click_button_text("Next: sources →").await?;
    app.click_by_aria_label("Select M 31 session").await?;
    app.click_button_text("Next: calibration →").await?;
    app.click_button_text("Next: source views →").await?;
    app.click_button_text("Next: naming →").await?;
    app.click_button_text("Next: review →").await?;
    app.click_testid("wizard-create-btn").await
}

/// Tests 1/2 (journey-05): a unique project name creates real `lights/`/
/// `darks/` subfolders under the REGISTERED PROJECT LIBRARY root (PR #414's
/// fix — not the app's own working directory), and creating a SECOND
/// project with the SAME name is blocked with a real inline field error
/// (never a generic toast), with the wizard returning to the Name step to
/// show it.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn projects_ui_wizard_creates_real_folders_and_blocks_duplicate_name() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    let project_root = setup_project_library_and_one_session(&app).await?;
    let _: serde_json::Value = app.invoke("firstrun_complete", json!({})).await?;

    let project_name = "E2E Wizard Project";

    // First creation: real success path.
    app.goto_route("/projects/new").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    run_wizard_to_create(&app, project_name).await?;

    // Real navigation-away signal: the wizard routes to /projects on success
    // (`WizardPage.tsx::handleCreate`), never staying on /projects/new.
    let deadline = tokio::time::Instant::now() + UI_TIMEOUT;
    loop {
        let url = app.driver.current_url().await?.to_string();
        if !url.contains("/projects/new") {
            break;
        }
        anyhow::ensure!(
            tokio::time::Instant::now() < deadline,
            "expected the wizard to navigate away from /projects/new after a successful create"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    // Test 2: real folders exist under the REGISTERED PROJECT LIBRARY root,
    // never next to the app binary. `safeName` mirrors
    // `WizardPage.tsx::handleCreate`'s kebab-case derivation.
    let safe_name = "e2e-wizard-project";
    let project_dir = project_root.join(safe_name);
    anyhow::ensure!(
        project_dir.join("lights").is_dir(),
        "expected a real lights/ folder under the registered project library root at {project_dir:?}"
    );
    anyhow::ensure!(
        project_dir.join("darks").is_dir(),
        "expected a real darks/ folder under the registered project library root at {project_dir:?}"
    );

    // Test 1: re-create with the exact same name — blocked with a real
    // inline field error, not a generic toast.
    app.goto_route("/projects/new").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    run_wizard_to_create(&app, project_name).await?;

    // Poll for the inline field error to render: it appears asynchronously
    // after the create attempt's real backend round trip, same
    // route/refetch-render race `E2eApp::find_waiting` documents.
    let error_el = app
        .find_waiting(By::Id("project-name-error"), "the #project-name-error field error")
        .await
        .map_err(|e| {
            anyhow::anyhow!(
                "expected a real inline #project-name-error field error after a duplicate-name \
                 create attempt (never a generic toast): {e}"
            )
        })?;
    let error_text =
        error_el.text().await.context("failed to read the duplicate-name error text")?;
    anyhow::ensure!(
        error_text.contains("already exists"),
        "expected the real duplicate-name copy ('A project with this name already exists.'), \
         got: {error_text:?}"
    );
    // The wizard must have returned to the Name step (index 0) to show it —
    // real proof: the name input is present and still on /projects/new.
    let url = app.driver.current_url().await?.to_string();
    anyhow::ensure!(
        url.contains("/projects/new"),
        "expected the wizard to stay on /projects/new (Name step) after a blocked duplicate create"
    );

    app.shutdown().await
}
