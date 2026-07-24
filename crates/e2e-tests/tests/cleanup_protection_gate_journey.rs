// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 037 Layer-2 real-UI journey — issue #1223 (coverage gap #1220):
//! cleanup scan -> protected-item gate -> `PlanReviewOverlay` -> approve &
//! apply, driven entirely through the real DOM, not the `invoke` bridge.
//!
//! `apps/desktop/src/features/plans/PlanReviewOverlay.tsx` is the single
//! shared reviewable-mutation review surface (cleanup, archive, restore,
//! source-view removal all route through it), and before this journey
//! neither of its two safety gates had any real-backend E2E coverage:
//! `plan-review-approve-apply` and `plan-review-confirm-destructive` had
//! zero hits anywhere under `crates/e2e-tests/tests/` (confirmed by grep
//! while authoring this file — the only "plan-review" strings there were
//! prose in doc comments). `journeys.rs::cleanup_plan_review` drives cleanup
//! scan/generate/approve/apply entirely through the bridge and explicitly
//! sets the project's protection override to `"unprotected"` so it never
//! exercises a protected item at all — it proves the backend pipeline works,
//! never that a protected item actually blocks a real button click, nor that
//! the acknowledgement/destructive-confirm controls in the real DOM gate
//! `Approve & apply`.
//!
//! This journey drives the real `CleanupSection`
//! (`apps/desktop/src/features/projects/OutputsCleanupSections.tsx`) end to
//! end — Scan, Generate cleanup plan, the shared `PlanReviewOverlay` — with
//! ONE plan carrying both a protected item (a `MasterDark_*` calibration
//! master, category-elevated to `protected`) and a non-protected item (an
//! `integration_*` intermediate, policy-actioned `delete`), then proves the
//! conjunction the task requires: the cleanable file is gone from disk, the
//! protected file is byte-identical and still in place, and the plan's own
//! durable state (`plans.get` / `plans.apply.status`) agrees with both.
//!
//! Mixed-protection-in-one-project mechanics (verified against
//! `crates/persistence/plans/src/repositories/source_protection.rs::resolve_protection`
//! and `crates/app/core/src/cleanup_generator/scan.rs`): a per-source
//! protection override always wins UNIFORMLY for every item in that source
//! regardless of category, so a project-level override (what
//! `cleanup_plan_review` uses) cannot produce a mixed-protection plan.
//! Category elevation (an item's classification category being a member of
//! the global protected-categories list, default `["lights","masters",
//! "finals"]`) only differentiates items when there is NO per-source
//! override. This journey therefore flips the GLOBAL default instead
//! (`settings.update` scope `"cleanup"` key `defaultProtection` ->
//! `"unprotected"`): `masters` stays protected via category elevation,
//! `intermediate` does not (it is not in the protected-categories list).
//!
//! The cleanable item's policy action is `delete` (not `archive`), which the
//! generator (`crates/app/core/src/cleanup_generator/generate.rs`) maps
//! straight to plan-item `action = "delete"` regardless of the plan's
//! archive/trash destination choice, and the executor
//! (`crates/fs/executor/src/run/dispatch.rs`) maps that to
//! `ExecutorItemAction::Delete` -> `delete_op::delete_file` — a plain,
//! deterministic `std::fs::remove_file` gated by `destructive_confirmed`,
//! with no OS-trash/interactive-desktop dependency (unlike
//! `ExecutorItemAction::Trash`, the `trash` crate path #1224 owns and which
//! hangs headless on Windows). This also exercises
//! `plan-review-confirm-destructive`, the plan's other previously-uncovered
//! gate, without touching the OS trash hazard at all.
//!
//! Run (CI): `cargo nextest run -p e2e_tests --profile e2e --run-ignored all`
//! (serial, `.config/nextest.toml`). See `crates/e2e-tests/README.md`.

mod common;

use std::time::Duration;

use common::E2eApp;
use serde_json::json;

const UI_TIMEOUT: Duration = Duration::from_secs(20);
const INVOKE_TIMEOUT: Duration = Duration::from_secs(30);
const APPLY_TIMEOUT: Duration = Duration::from_secs(60);

/// Register a disposable raw + project source so `firstrun.complete`'s real
/// preconditions ("at least one raw source and one project source") are met.
/// Mirrors `inbox_ui_journeys.rs`'s local `register_light_root`/
/// `register_project_root` helpers — not shared from there because those are
/// private to that module and this journey needs no other part of it.
async fn satisfy_firstrun_sources(
    app: &E2eApp,
) -> anyhow::Result<(tempfile::TempDir, tempfile::TempDir)> {
    let raw_dir = tempfile::tempdir()?;
    let _: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({
                "path": raw_dir.path().to_string_lossy(),
                "category": "light_frames",
                "scanSettings": null,
            }),
        )
        .await?;
    let project_root_dir = tempfile::tempdir()?;
    let _: serde_json::Value = app
        .invoke(
            "roots_register",
            json!({
                "path": project_root_dir.path().to_string_lossy(),
                "category": "project",
                "scanSettings": null,
            }),
        )
        .await?;
    Ok((raw_dir, project_root_dir))
}

#[tokio::test]
#[ignore = "Layer-2 real-UI journey: needs tauri-webdriver CLI + desktop_shell --features e2e + served frontend; run via e2e.yml (--run-ignored all)"]
async fn cleanup_ui_protected_item_blocks_apply_cleanable_item_deletes() -> anyhow::Result<()> {
    let app = E2eApp::launch().await?;
    app.wait_bridge_ready(Duration::from_secs(30)).await?;
    // See `journeys.rs::first_run_resolve_create_project` for why this poll
    // (not an immediate URL check) is required — the index route's first-run
    // redirect is asynchronous.
    app.wait_url_contains("/setup", Duration::from_secs(15))
        .await
        .map(drop)
        .map_err(|e| anyhow::anyhow!("expected a fresh DB to redirect to /setup: {e}"))?;

    let (_raw_dir, _project_root_dir) = satisfy_firstrun_sources(&app).await?;

    // Flip the GLOBAL default protection level (not a per-project override —
    // see module docs) so category elevation is what differentiates the two
    // items generated below.
    let _: serde_json::Value = app
        .invoke(
            "settings_update",
            json!({ "scope": "cleanup", "values": { "defaultProtection": "unprotected" } }),
        )
        .await?;

    // The real project whose artifacts get scanned for cleanup. The
    // artifact watcher's attach-time reconciliation pass requires the
    // project's output folder to already exist on disk (mirrors
    // `journeys.rs::cleanup_plan_review`).
    let project_dir = tempfile::tempdir()?;
    let create: serde_json::Value = app
        .invoke(
            "projects_create",
            json!({
                "req": {
                    "requestId": "e2e-cleanup-gate-create",
                    "name": "E2E Cleanup Protection Gate Project",
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

    // Two real output files: a calibration master (elevated to `protected`
    // via the default `masters` protected-category, per
    // `DataType::Master::protection_category()`) and an intermediate (stays
    // `unprotected` — `"intermediate"` is not in the default
    // protected-categories list). Filenames follow the real PixInsight
    // naming convention `default_rules.rs` classifies on.
    let master_name = "MasterDark_600s_-10C.xisf";
    let intermediate_name = "integration_M31_Ha.xisf";
    let master_path = project_dir.path().join(master_name);
    std::fs::write(&master_path, b"not-a-real-xisf-master")?;
    let master_bytes_before = std::fs::read(&master_path)?;
    let intermediate_path = project_dir.path().join(intermediate_name);
    std::fs::write(&intermediate_path, b"not-a-real-xisf-intermediate")?;

    // Attaching the watcher runs a real, synchronous-enough reconciliation
    // pass (spec 012 T005) — poll `artifact.list` for both fixtures rather
    // than assuming they land before the next call returns.
    let _: serde_json::Value = app
        .invoke("artifact_watcher_attach", json!({ "request": { "projectId": project_id } }))
        .await?;
    let artifacts: serde_json::Value = app
        .invoke_until(
            "artifact_list",
            json!({ "request": { "projectId": project_id, "includeStates": [] } }),
            INVOKE_TIMEOUT,
            |v: &serde_json::Value| v["artifacts"].as_array().is_some_and(|a| a.len() >= 2),
        )
        .await?;
    let kinds: Vec<&str> = artifacts["artifacts"]
        .as_array()
        .expect("artifacts array present (checked by invoke_until predicate)")
        .iter()
        .filter_map(|a| a["kind"].as_str())
        .collect();
    anyhow::ensure!(
        kinds.iter().filter(|k| **k == "master").count() == 1
            && kinds.iter().filter(|k| **k == "intermediate").count() == 1,
        "expected exactly one master + one intermediate artifact, got: {kinds:?}"
    );

    // Cleanup policy: master -> archive (will be REFUSED at apply time —
    // protected), intermediate -> delete (a real permanent delete, gated on
    // the UI's destructive-confirm checkbox), final -> keep (no final
    // fixture exists; present for parity with the existing policy shape).
    let _: serde_json::Value = app
        .invoke(
            "cleanup_policy_update",
            json!({
                "request": {
                    "entries": [
                        { "dataType": "master", "action": "archive" },
                        { "dataType": "intermediate", "action": "delete" },
                        { "dataType": "final", "action": "keep" },
                    ],
                    "autoOnCompletion": false,
                }
            }),
        )
        .await?;

    app.complete_first_run_gate().await?;

    // ── Real UI from here: Projects list (deep-linked selection) -> Cleanup
    // section -> Scan -> Generate -> PlanReviewOverlay -> Approve & apply ──
    app.goto_route(&format!("/projects?selected={project_id}")).await?;
    app.wait_bridge_ready(Duration::from_secs(15)).await?;

    app.wait_testid("cleanup-scan-btn", UI_TIMEOUT).await?;
    app.click_testid("cleanup-scan-btn").await?;
    app.wait_testid("cleanup-group-master", UI_TIMEOUT).await?;
    app.wait_testid("cleanup-group-intermediate", UI_TIMEOUT).await?;
    // The protected-row hint only renders when a scanned candidate resolved
    // `protected` — a real-backend signal the master item is gated, before
    // any plan even exists.
    app.wait_testid("cleanup-protected-note", UI_TIMEOUT).await?;

    app.wait_testid("cleanup-generate-btn", UI_TIMEOUT).await?;
    app.click_testid("cleanup-generate-btn").await?;

    app.wait_testid("plan-review-overlay", UI_TIMEOUT).await?;
    app.wait_testid_prefix_present("plan-review-item-", UI_TIMEOUT).await?;
    app.wait_testid("plan-review-confirm-destructive", UI_TIMEOUT).await?;

    // Both gates present, both unmet -> Approve & apply must start disabled.
    // This is the journey's first non-vacuous checkpoint: a build with the
    // backend gate removed still leaves this assertion true (the FRONTEND
    // gate is independent), so it alone would not catch a regression in the
    // authoritative apply-time check — see the disk assertions below, which
    // are what the non-vacuity break targets.
    anyhow::ensure!(
        !app.is_enabled_testid("plan-review-approve-apply").await?,
        "Approve & apply must start disabled: protection not acknowledged, destructive not confirmed"
    );

    // Acknowledge the protected item (spec 016 gate, `PlanProtectionGate`).
    // The button carries no `data-testid` (see `PlanProtectionGate.tsx`) and
    // its text is unambiguous in this modal — exactly `click_button_text`'s
    // documented safe case.
    app.click_button_text("Acknowledge").await?;
    // Confirm the destructive delete (issue #741 gate).
    app.click_testid("plan-review-confirm-destructive").await?;

    app.wait_testid_enabled("plan-review-approve-apply", UI_TIMEOUT).await?;
    app.click_testid("plan-review-approve-apply").await?;

    // ── Durable/disk proof (not just UI) ───────────────────────────────────

    // Resolve the real plan id through the bridge (the UI never renders it) —
    // this DB is isolated per e2e process (`.config/nextest.toml`), so the
    // single cleanup-origin plan is unambiguously this journey's. Poll
    // `plans.apply.status` (ground truth, not a UI guess) for the terminal
    // state BEFORE asserting anything about the overlay's own footer.
    let plans_list: serde_json::Value = app
        .invoke(
            "plans_list",
            json!({
                "stateFilter": null,
                "originFilter": ["cleanup"],
                "createdAfter": null,
                "limit": null,
            }),
        )
        .await?;
    let plans = plans_list["plans"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("plans.list returned no plans array: {plans_list}"))?;
    anyhow::ensure!(
        plans.len() == 1,
        "expected exactly one cleanup-origin plan in this isolated DB, got: {plans_list}"
    );
    let plan_id = plans[0]["id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("plan summary has no id: {plans_list}"))?
        .to_owned();

    let status: serde_json::Value = app
        .invoke_until(
            "plans_apply_status",
            json!({ "planId": plan_id }),
            APPLY_TIMEOUT,
            |v: &serde_json::Value| {
                matches!(
                    v["planState"].as_str(),
                    Some("applied" | "partially_applied" | "failed" | "cancelled")
                )
            },
        )
        .await?;
    anyhow::ensure!(
        status["planState"] == "partially_applied",
        "expected the plan to land partially_applied (one refused, one deleted): {status}"
    );
    anyhow::ensure!(
        status["itemsApplied"].as_i64().unwrap_or(0) >= 1,
        "expected at least 1 durably-recorded applied item: {status}"
    );
    anyhow::ensure!(
        status["itemsFailed"].as_i64().unwrap_or(0) >= 1,
        "expected at least 1 durably-recorded failed (protected-refusal) item: {status}"
    );

    let plan_detail: serde_json::Value = app.invoke("plans_get", json!({ "id": plan_id })).await?;
    let items = plan_detail["items"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("plans.get returned no items array: {plan_detail}"))?;
    let master_item = items
        .iter()
        .find(|i| i["name"] == json!(master_name))
        .ok_or_else(|| anyhow::anyhow!("master item not found on plan: {plan_detail}"))?;
    let intermediate_item = items
        .iter()
        .find(|i| i["name"] == json!(intermediate_name))
        .ok_or_else(|| anyhow::anyhow!("intermediate item not found on plan: {plan_detail}"))?;

    anyhow::ensure!(
        master_item["protection"] == "protected",
        "expected the master item to have resolved `protected`: {master_item}"
    );
    anyhow::ensure!(
        master_item["state"] == "failed",
        "expected the protected master item to be refused at apply: {master_item}"
    );
    anyhow::ensure!(
        master_item["failureReason"].as_str().unwrap_or_default().contains("protected.source"),
        "expected the master item's failure reason to cite protected.source: {master_item}"
    );
    anyhow::ensure!(
        intermediate_item["protection"] == "normal",
        "expected the intermediate item to have resolved non-protected: {intermediate_item}"
    );
    anyhow::ensure!(
        intermediate_item["state"] == "succeeded",
        "expected the unprotected, confirmed-destructive intermediate item to apply: {intermediate_item}"
    );

    // The conjunction the task requires, proven on the REAL filesystem: the
    // cleanable file is gone, the protected file is untouched.
    anyhow::ensure!(
        !intermediate_path.exists(),
        "expected the confirmed-destructive intermediate item to be permanently deleted from disk: {intermediate_path:?}"
    );
    anyhow::ensure!(
        master_path.exists(),
        "expected the protected master item to remain on disk, untouched: {master_path:?}"
    );
    let master_bytes_after = std::fs::read(&master_path)?;
    anyhow::ensure!(
        master_bytes_after == master_bytes_before,
        "expected the protected master file's bytes to be unchanged (never opened for write)"
    );

    app.shutdown().await
}
