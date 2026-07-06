//! Spec 037 Layer-2 real-UI journey: source-view generation (spec 049).
//!
//! Real backend REAL: `roots.register`, `inbox.scan.folder`,
//! `inbox.classify`, `inbox.confirm`, `inbox.plan.apply` (catalogue-in-place —
//! see below), `projects.create`, `projects.source.add`, `sourceview.generate`
//! (driven through the real `GenerateSourceViewDialog` UI, not the invoke
//! bridge), `plans.list`, `plans.get`, `plans.approve`.
//!
//! Real DOM: select the project row (`project-row-<id>`), open the
//! `SourceViewsSection`'s "Generate source view" dialog
//! (`generate-source-view-btn` → `generate-source-view-dialog`), and submit it
//! (`generate-source-view-submit`) — the actual product click path a user
//! takes, not an IPC-only round trip.
//!
//! Catalogue-in-place (not move): `roots.register` defaults non-inbox
//! categories to `organized` (`apps/desktop/src-tauri/src/commands/roots.rs`),
//! so `inbox.confirm` emits a `catalogue` action (`from == to`, no move —
//! `crates/app/inbox/src/confirm.rs`). This journey never calls
//! `sources.set_organization_state`, so the fixture FITS file stays at its
//! original path — real, but simpler to reason about than the move variant
//! the existing `plan_review_apply_with_audit` journey already covers.
//!
//! FINDING (documented, not silently worked around): `projects.source.add`
//! and `projects.create`'s `initialSources` path
//! (`crates/app/projects/src/project_setup.rs`) have hardcoded
//! `filter_snapshot`/`exposure_snapshot` to `""` since spec 003
//! ("Snapshot fields will be empty until spec 003 Inventory is wired") and
//! this was never revisited even though the real per-session filter/exposure
//! has been available via `sessions.get`/`sessions.list` since spec 048. As a
//! result, `sourceview.generate`'s WBPP `{date}/{filter}/{exposure}` layout
//! (`crates/app/projects/src/source_view_generate.rs`) always lands every
//! real project-linked session in the pattern's documented `nofilter`/
//! `unknown-exposure` fallback buckets, never the frame's real filter. This
//! journey asserts the REAL (fallback) destination shape, not an aspirational
//! one, and calls the gap out explicitly below rather than masking it with a
//! looser assertion.
//!
//! KNOWN GAP (documented, not faked — mirrors `cleanup_plan_review` in
//! `journeys.rs`): materializing the real symlink/junction on disk requires
//! `plans.apply_real`, whose `tauri::ipc::Channel` argument only the product
//! frontend's `applyPlan` helper (`apps/desktop/src/features/plans/
//! planApply.ts`) constructs today, via `usePlanApplyProgress` →
//! `PlanReviewOverlay`. Nothing wires the `sourceview.generate` plan id into
//! that overlay: `SourceViewsSection.handleGenerated` calls
//! `onPlanCreated?.(planId)`, but its only real mount point,
//! `ProjectBottomDetail`, never passes an `onPlanCreated` prop — so both that
//! callback and the toast's "View plan" action are silent no-ops
//! (`git grep -n onPlanCreated apps/desktop/src/features/projects` shows the
//! prop is optional and unconnected on this path). Fabricating a Channel from
//! a WebDriver script instead would mean reaching into product frontend/Tauri
//! -internal plumbing beyond a thin test hook — the same call already made
//! for `cleanup_plan_review` — so this journey stops at `approved` via the
//! real, channel-free `plans.approve` command. Real, on-disk symlink/junction
//! proof for spec 049 is BLOCKED on either (a) a channel-free apply command
//! (matching `inbox.plan.apply`'s precedent), or (b) wiring
//! `PlanReviewOverlay` (or an equivalent) into `SourceViewsSection` so a real
//! UI Apply button exists to click.
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

/// Generate Source View dialog → real reviewable `prepared_view_generation`
/// plan with the WBPP per-tool layout → approve.
#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn generate_source_view_creates_reviewable_wbpp_plan() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    settle_first_run_redirect(&app).await?;

    // ── 1. Real ingest precondition: one real, catalogued-in-place light frame ──
    let root_dir = tempfile::tempdir()?;
    let file_name = "light_m33_001.fits";
    let light_path = write_minimal_fits(
        root_dir.path(),
        file_name,
        "Light Frame",
        Some("M 33"),
        Some("Ha"),
        Some("2026-01-12T22:00:00"),
    )?;
    anyhow::ensure!(light_path.exists(), "fixture FITS file was not written");

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

    let confirm: serde_json::Value = app
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
    anyhow::ensure!(
        confirm["planId"].as_str().is_some_and(|s| !s.is_empty()),
        "expected a real (non-empty) plan id from inbox.confirm: {confirm}"
    );

    let _apply: serde_json::Value =
        app.invoke("inbox_plan_apply", json!({ "inboxItemId": inbox_item_id })).await?;
    anyhow::ensure!(
        light_path.exists(),
        "catalogue-in-place (organized default) must never move the file: {light_path:?}"
    );

    // Event-driven session grouping (spec 035 US4 plan_listener).
    let sessions: serde_json::Value = app
        .invoke_until("sessions_list", json!({}), INVOKE_TIMEOUT, |v: &serde_json::Value| {
            v.as_array().is_some_and(|arr| arr.iter().any(|s| s["sessionKey"]["target"] == "M 33"))
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

    // ── 2. Real project + real project-source link (setup precondition) ──
    //
    // `sourceview.generate` reads `project_sources`, populated here via the
    // same real `projects.source.add` backend the "Add sources" UI drives —
    // this journey's own DOM focus is the Generate Source View surface (the
    // companion `inventory_journeys.rs` drives the Add-sources UI itself), so
    // the link is set up over the invoke bridge like every other journey's
    // preconditions (project creation, root registration, etc).
    let project_dir = tempfile::tempdir()?;
    let create: serde_json::Value = app
        .invoke(
            "projects_create",
            json!({
                "req": {
                    "requestId": "e2e-sourceview-create",
                    "name": "E2E Source View Project",
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

    let _add_source: serde_json::Value = app
        .invoke(
            "projects_source_add",
            json!({
                "req": {
                    "requestId": "e2e-sourceview-add-source",
                    "projectId": project_id,
                    "inventorySessionId": session_id,
                }
            }),
        )
        .await?;

    complete_first_run(&app).await?;

    // ── 3. Real UI: select the project, open Generate Source View, submit ──
    app.goto_route("/projects").await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;
    app.wait_testid(&format!("project-row-{project_id}"), Duration::from_secs(15))
        .await?
        .click()
        .await?;

    app.wait_testid("generate-source-view-btn", Duration::from_secs(15)).await?.click().await?;
    app.wait_testid("generate-source-view-dialog", Duration::from_secs(10)).await?;
    app.wait_testid_enabled("generate-source-view-submit", Duration::from_secs(10)).await?;
    app.find_testid("generate-source-view-submit").await?.click().await?;

    // `GenerateSourceViewDialog.handleSubmit` only calls `onClose()` after
    // `sourceview.generate` resolves successfully, so the dialog closing is
    // real, DOM-visible proof the submit actually reached and completed the
    // backend call — a much sharper signal than the `plans_list` poll below
    // if the click never registered or the call errored. This is
    // diagnostic-only (never gates the journey): a slow/absent close
    // animation without a genuine submit failure would otherwise produce a
    // false negative here even though the plan really was created, and the
    // real assertion is the `plans_list` read below regardless. On failure,
    // dump the dialog's own DOM (it renders the submit error inline via a
    // `Banner`, `GenerateSourceViewDialog.tsx`) plus any buffered uncaught
    // errors, and fold that evidence into the `plans_list` timeout message
    // if the plan never shows up either.
    let dialog_close_diagnostics =
        match app.wait_testid_gone("generate-source-view-dialog", Duration::from_secs(15)).await {
            Ok(()) => None,
            Err(e) => {
                let diagnostics = app.dump_testid_diagnostics("generate-source-view-dialog").await;
                Some(format!(
                    "the dialog never closed after submit — sourceview.generate likely errored or \
                 the submit click never registered: {e}\ndiagnostics: {diagnostics}"
                ))
            }
        };

    // ── 4. Real backend proof: a real, reviewable plan was created ──
    //
    // No product UI routes this plan id back for review (KNOWN GAP, module
    // docs), so find it via the real `plans.list` read path instead of a
    // fabricated return value.
    let plans: serde_json::Value = app
        .invoke_until(
            "plans_list",
            json!({
                "stateFilter": null,
                "originFilter": ["prepared_view_generation"],
                "createdAfter": null,
                "limit": null,
            }),
            INVOKE_TIMEOUT,
            |v: &serde_json::Value| {
                v["plans"]
                    .as_array()
                    .is_some_and(|arr| arr.iter().any(|p| p["originPath"] == json!(project_id)))
            },
        )
        .await
        .map_err(|e| match &dialog_close_diagnostics {
            Some(d) => anyhow::anyhow!("{e}\n\nadditional evidence from the submit step: {d}"),
            None => e,
        })?;
    let plan = plans["plans"]
        .as_array()
        .and_then(|arr| arr.iter().find(|p| p["originPath"] == json!(project_id)))
        .ok_or_else(|| {
            anyhow::anyhow!("no prepared_view_generation plan found for {project_id}: {plans}")
        })?;
    let plan_id =
        plan["id"].as_str().ok_or_else(|| anyhow::anyhow!("plan has no id: {plan}"))?.to_owned();
    anyhow::ensure!(
        plan["state"] == "ready_for_review",
        "expected the generated plan to be ready_for_review: {plan}"
    );

    // ── Real per-tool layout proof (spec 049 US2) ──
    //
    // The WBPP/PixInsight default profile groups lights 3 levels deep
    // (night / filter / exposure) under `<project>/source-views/<plan_id>/`.
    // Per the FINDING documented in the module docs, filter/exposure resolve
    // to their registry fallback names here ("nofilter"/"unknown-exposure"),
    // not the frame's real "Ha" filter — this asserts that REAL behavior.
    let detail: serde_json::Value = app.invoke("plans_get", json!({ "id": plan_id })).await?;
    let link_item = detail["items"]
        .as_array()
        .and_then(|items| items.iter().find(|i| i["action"] == "link"))
        .ok_or_else(|| anyhow::anyhow!("generated plan has no link item: {detail}"))?;
    let to_path = link_item["to"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("link item has no destination path: {link_item}"))?;
    let expected_prefix =
        format!("{}/source-views/{plan_id}/", project_dir.path().to_string_lossy());
    anyhow::ensure!(
        to_path.starts_with(&expected_prefix),
        "expected the generated destination under the project's own source-views/<plan_id> \
         tree: {to_path} (expected prefix {expected_prefix})"
    );
    let layout_tail = to_path.strip_prefix(&expected_prefix).ok_or_else(|| {
        anyhow::anyhow!("prefix check above should guarantee this strip succeeds: {to_path}")
    })?;
    let layout_segments: Vec<&str> = layout_tail.split('/').collect();
    anyhow::ensure!(
        layout_segments.len() == 4 && layout_segments[3] == file_name,
        "expected the WBPP 3-level {{date}}/{{filter}}/{{exposure}} layout ending in the real \
         frame's basename, got: {layout_tail} (from {to_path})"
    );
    anyhow::ensure!(
        layout_segments[1] == "nofilter" && layout_segments[2] == "unknown-exposure",
        "the filter/exposure fallback bucket names changed (or `projects.source.add` now \
         snapshots real filter/exposure) — re-verify the empty-snapshot FINDING documented in \
         this file's module docs before updating this assertion: {layout_tail}"
    );

    // ── 5. Real, channel-free step available today: approve ──
    let approve: serde_json::Value = app.invoke("plans_approve", json!({ "id": plan_id })).await?;
    anyhow::ensure!(
        approve["planId"] == json!(plan_id) && approve["newState"] == "approved",
        "expected plans.approve to move the generated plan to approved: {approve}"
    );

    // Apply (real symlink/junction materialization) is BLOCKED — see the
    // KNOWN GAP in this file's module docs.

    app.shutdown().await
}
