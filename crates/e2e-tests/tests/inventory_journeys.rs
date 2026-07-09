//! Spec 037 Layer-2 real-UI journey: per-frame inventory reconciliation
//! (spec 048).
//!
//! Real backend REAL: `roots.register`, `inbox.scan.folder`,
//! `inbox.classify`, `inbox.confirm`, `inbox.plan.apply` (catalogue-in-place),
//! `projects.create`, `inventory.reconcile.run`
//! (`apps/desktop/src-tauri/src/commands/inventory_frame.rs`, spec 048 T006).
//!
//! Real DOM: the project's "Add sources" session picker
//! (`SessionSourcePicker`, mounted from `EditProjectPane`) queries
//! `sessions.list` — the spec-048 T014 active/non-missing `frame_count`
//! read path (`crates/app/core/src/sessions.rs::active_frame_summary`) — and
//! renders it per-session. This journey reads that REAL, product-rendered
//! frame count before and after a real reconcile pass, rather than asserting
//! only the `inventory.reconcile.run` IPC response.
//!
//! Catalogue-in-place: same reasoning as `source_view_journeys.rs` — the
//! `roots.register` default (`organized`) keeps both fixture files at their
//! literal on-disk paths, so this journey can delete one of them directly to
//! simulate a real, external raw-frame loss (the disconnected-drive /
//! moved-by-another-tool scenario spec 048 exists to detect).
//!
//! KNOWN GAP (documented, not faked): `inventory.reconcile.run`,
//! `inventory.frame.list`, and `inventory.root_config.{get,set}`
//! have real backend implementations (spec 048 T006) but ZERO frontend
//! callers today (`git grep -rl inventoryReconcileRun apps/desktop/src`
//! matches only the generated `bindings/index.ts` file) — there is no
//! button, setting, or scheduled trigger anywhere in the product UI that
//! invokes a reconcile pass. This journey therefore triggers the reconcile
//! pass over the invoke bridge (same convention as `artifact.watcher.attach`
//! in `journeys.rs::cleanup_plan_review` for a backend surface with no UI
//! affordance yet) and proves its REAL, UI-visible effect on a genuine
//! product screen, rather than fabricating a UI trigger that does not exist.
//!
//! Run (CI): `cargo nextest run -p e2e_tests --profile e2e --run-ignored all`
//! (serial, `.config/nextest.toml`). See `crates/e2e-tests/tests/journeys.rs`
//! module docs and `README.md` for the full local run procedure.

mod common;

use std::time::Duration;

use common::{write_minimal_fits, E2eApp};
use serde_json::json;

const INVOKE_TIMEOUT: Duration = Duration::from_secs(30);

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

/// Registers a disposable `project`-category root purely to satisfy
/// `firstrun.complete`'s precondition (one `light_frames` root — this
/// journey's own ingest root satisfies that half — AND one `project` root,
/// `crates/persistence/db/src/repositories/first_run.rs`), then routes
/// through the real gate. A `projects.create` Project entity (this journey
/// creates one below) is a DIFFERENT concept from a registered `project`
/// source root and does not satisfy this precondition on its own. Without
/// this, `Shell.tsx`'s client-side `setupCompleted` gate bounces every
/// `goto_route` to a Shell-wrapped page (`/projects`) back to `/setup`
/// indefinitely (mirrors the proven `inbox_ui_journeys.rs` pattern).
async fn complete_first_run(app: &E2eApp) -> anyhow::Result<()> {
    let project_dir = tempfile::tempdir()?;
    let _: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({ "path": project_dir.path().to_string_lossy(), "category": "project", "scanSettings": null }),
        )
        .await?;
    app.complete_first_run_gate().await
}

/// External raw-frame deletion → `inventory.reconcile.run` → the real
/// Add-sources session picker's frame count drops from 2 to 1.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn reconcile_drops_externally_deleted_frame_from_real_ui_count() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    settle_first_run_redirect(&app).await?;

    // ── 1. Real ingest precondition: two same-identity light frames group ──
    // into ONE real `acquisition_session` with `frame_count == 2` (same
    // OBJECT/FILTER/GAIN/BINNING/night, spec 035 US4), catalogued in place so
    // both files stay at their real, individually-deletable paths.
    let root_dir = tempfile::tempdir()?;
    let keep_name = "light_m33_001.fits";
    let lose_name = "light_m33_002.fits";
    let keep_path = write_minimal_fits(
        root_dir.path(),
        keep_name,
        "Light Frame",
        Some("M 33"),
        Some("Ha"),
        Some("2026-01-12T22:00:00"),
    )?;
    let lose_path = write_minimal_fits(
        root_dir.path(),
        lose_name,
        "Light Frame",
        Some("M 33"),
        Some("Ha"),
        Some("2026-01-12T23:00:00"),
    )?;
    anyhow::ensure!(
        keep_path.exists() && lose_path.exists(),
        "fixture FITS files were not written"
    );

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

    let _confirm: serde_json::Value = app
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

    let _apply: serde_json::Value =
        app.invoke("inbox_plan_apply", json!({ "inboxItemId": inbox_item_id })).await?;
    anyhow::ensure!(
        keep_path.exists() && lose_path.exists(),
        "catalogue-in-place (organized default) must never move either file"
    );

    // Event-driven session grouping (spec 035 US4 plan_listener) — poll until
    // BOTH frames have joined the same session.
    let sessions: serde_json::Value = app
        .invoke_until("sessions_list", json!({}), INVOKE_TIMEOUT, |v: &serde_json::Value| {
            v.as_array().is_some_and(|arr| {
                arr.iter().any(|s| {
                    s["sessionKey"]["target"] == "M 33" && s["frameCount"].as_i64() == Some(2)
                })
            })
        })
        .await?;
    let session = sessions
        .as_array()
        .and_then(|arr| arr.iter().find(|s| s["sessionKey"]["target"] == "M 33"))
        .ok_or_else(|| anyhow::anyhow!("no M 33 session found: {sessions}"))?;
    let session_id = session["id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("session has no id: {session}"))?
        .to_owned();
    anyhow::ensure!(
        session["frameCount"].as_i64() == Some(2),
        "expected the two same-identity frames to group into one 2-frame session: {session}"
    );

    // ── 2. Real project (setup precondition) ──
    //
    // This journey's DOM focus is the Add-sources session picker's real frame
    // count, not project creation itself — created over the invoke bridge
    // like every other journey's preconditions.
    let project_dir = tempfile::tempdir()?;
    let create: serde_json::Value = app
        .invoke(
            "projects_create",
            json!({
                "req": {
                    "requestId": "e2e-inventory-create",
                    "name": "E2E Per-Frame Inventory Project",
                    "tool": "PixInsight",
                    "path": project_dir.path().to_string_lossy(),
                    "initialSources": [],
                    "notes": null,
                    "canonicalTargetId": null,
                }
            }),
        )
        .await?;
    let project_id = create["projectId"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("projects.create returned no projectId: {create}"))?
        .to_owned();

    complete_first_run(&app).await?;

    // ── 3. Real UI (BEFORE): open the project, open Add sources, read the ──
    // real per-session frame count from the real DOM.
    app.goto_route("/projects").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.wait_testid(&format!("project-row-{project_id}"), Duration::from_secs(15))
        .await?
        .click()
        .await?;
    app.wait_testid("edit-project-btn", Duration::from_secs(15)).await?.click().await?;
    app.wait_testid("edit-project-add-sources-toggle", Duration::from_secs(10))
        .await?
        .click()
        .await?;
    let frames_before = app
        .wait_testid_text(
            &format!("session-picker-frames-{session_id}"),
            Duration::from_secs(10),
            |text| !text.trim().is_empty(),
        )
        .await?;
    anyhow::ensure!(
        frames_before.trim() == "2",
        "expected the real Add-sources picker to show frameCount=2 before reconcile: \
         {frames_before:?}"
    );

    // ── 4. Real filesystem mutation: an external tool/user deletes one raw ──
    // frame from disk — the exact scenario spec 048 exists to detect.
    std::fs::remove_file(&lose_path)?;
    anyhow::ensure!(!lose_path.exists(), "fixture file was not actually removed: {lose_path:?}");
    anyhow::ensure!(keep_path.exists(), "the surviving frame must still be present: {keep_path:?}");

    // ── 5. Real backend mutation: inventory.reconcile.run ──
    //
    // No product UI exposes a reconcile trigger today (KNOWN GAP, module
    // docs), so this is invoked directly over the bridge.
    let reconcile: serde_json::Value = app
        .invoke(
            "inventory_reconcile_run",
            json!({ "req": { "rootId": root_id, "reason": "on_demand" } }),
        )
        .await?;
    anyhow::ensure!(
        reconcile["newlyMissing"].as_i64() == Some(1),
        "expected exactly 1 newly-missing frame: {reconcile}"
    );
    anyhow::ensure!(
        reconcile["present"].as_i64() == Some(1),
        "expected exactly 1 still-present frame: {reconcile}"
    );

    // ── 5b. Poll the SAME backend read the picker uses until it reflects ──
    // the drop, BEFORE reloading (mirrors the fix for
    // sessions_ui_derived_view_invariants, `git log 5c4ab4c5`: `inbox.plan
    // .apply`/`inventory.reconcile.run` returning does not guarantee every
    // downstream read is immediately consistent — a single page load only
    // fetches once, and if that one fetch lands before the backend state is
    // fully settled, nothing thereafter retriggers a refetch for
    // `wait_testid_text` to catch. `reconcile["present"]/["newlyMissing"]`
    // above already assert the response shape; this additionally proves
    // `sessions.list` itself — the exact command the picker queries — has
    // caught up before the reload below, so the reload's one-shot fetch
    // cannot race it.
    app.invoke_until("sessions_list", json!({}), INVOKE_TIMEOUT, |v: &serde_json::Value| {
        v.as_array().is_some_and(|arr| {
            arr.iter().any(|s| s["id"] == json!(session_id) && s["frameCount"].as_i64() == Some(1))
        })
    })
    .await
    .map_err(|e| anyhow::anyhow!("sessions.list never settled to frameCount=1 for the reconciled session before the UI reload: {e}"))?;

    // ── 6. Real UI (AFTER): a fresh page load re-fetches sessions.list ──
    //
    // `goto_route` only changes the URL fragment on the SAME document — per
    // the HTML fragment-navigation algorithm this never creates a new
    // Document, so the shared `QueryClient` (30s `staleTime`,
    // `apps/desktop/src/data/queryClient.ts`) survives across it and the
    // `sessions.list` query stays cached from the BEFORE read above. A real
    // `driver.refresh()` (used for the same reason by
    // `complete_first_run_gate`) forces an actual reload, discarding the
    // in-memory QueryClient so the SAME real DOM surface is guaranteed to
    // re-fetch and reflect the real reconciliation result rather than
    // serving stale cached data.
    app.driver
        .refresh()
        .await
        .map_err(|e| anyhow::anyhow!("page refresh before the AFTER read failed: {e}"))?;
    app.wait_document_ready(Duration::from_secs(10)).await?;
    app.goto_route("/projects").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.wait_testid(&format!("project-row-{project_id}"), Duration::from_secs(15))
        .await?
        .click()
        .await?;
    app.wait_testid("edit-project-btn", Duration::from_secs(15)).await?.click().await?;
    app.wait_testid("edit-project-add-sources-toggle", Duration::from_secs(10))
        .await?
        .click()
        .await?;

    // Deterministic fix for the cross-PR flake (CI evidence: "last seen:
    // Some(\"2\")" surviving the full 15s wait — only possible from a
    // served-stale-cache render, since step 5b above already proved a fresh
    // backend read returns 1). `driver.refresh()` above is meant to force a
    // fresh QueryClient, but is not a guaranteed proof of that on every
    // WebDriver backend; explicitly invalidating the exact query the picker
    // reads removes the dependency on the reload actually having discarded
    // the 30s-`staleTime` cache (`E2eApp::invalidate_query` doc comment).
    // Removable once lane nD's frontend reconcile-invalidation (PR #517,
    // `sessions.all` + `inventory` prefix invalidation on reconcile
    // completion) lands and `driver.refresh()` alone is sufficient again.
    app.invalidate_query(r#"["sessions"]"#).await?;

    let frames_after = app
        .wait_testid_text(
            &format!("session-picker-frames-{session_id}"),
            Duration::from_secs(15),
            |text| text.trim() == "1",
        )
        .await?;
    anyhow::ensure!(
        frames_after.trim() == "1",
        "expected the real Add-sources picker to show frameCount=1 after reconcile: \
         {frames_after:?}"
    );

    app.shutdown().await
}
