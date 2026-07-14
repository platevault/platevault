#![allow(clippy::doc_markdown)]

// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Cross-crate integration tests for spec 025 filesystem plan application
//! lifecycle: multi-item apply, partial failure, and the CAS race guard.
//!
//! Complements `plan_apply_audit_integration.rs` (single-item happy/conflict
//! paths). These tests exercise the same full Layer-1 path — seed plan →
//! approve → apply → real executor on tempdir files → real audit/state rows —
//! with multiple items so the terminal-state aggregation (`applied` vs
//! `partially_applied`) and the concurrent-apply CAS guard (R-CAS-1) are
//! proven against the real DB, not just the pure `TerminalCounts` unit test.

mod support;

use persistence_db::repositories::plans as plans_repo;
use uuid::Uuid;

/// Insert a draft plan with `item_count` move items, each pointing at its own
/// real tempdir source/destination pair, then advance to `approved`.
///
/// Returns the list of `(src, dst)` paths in item order.
async fn seed_multi_item_approved_plan(
    pool: &sqlx::SqlitePool,
    plan_id: &str,
    dir: &std::path::Path,
    item_count: usize,
) -> Vec<(std::path::PathBuf, std::path::PathBuf)> {
    plans_repo::insert_plan(
        pool,
        &plans_repo::InsertPlan {
            id: plan_id,
            title: "Multi-item Integration Test Plan",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .expect("insert_plan");

    let mut paths = Vec::with_capacity(item_count);
    for i in 0..item_count {
        let src = dir.join(format!("source-{i}.fits"));
        let dst = dir.join(format!("processed/dest-{i}.fits"));
        std::fs::write(&src, format!("content-{i}")).expect("write src");

        plans_repo::insert_plan_item(
            pool,
            &plans_repo::InsertPlanItem {
                id: &format!("{plan_id}-item-{i}"),
                plan_id,
                item_index: i64::try_from(i + 1).expect("item index fits i64"),
                name: &format!("file-{i}.fits"),
                action: "move",
                from_root_id: None,
                from_relative_path: src.to_str().expect("utf-8 src path"),
                to_root_id: None,
                to_relative_path: dst.to_str().expect("utf-8 dst path"),
                reason: "integration test",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: None,
                source_id: None,
                category: None,
            },
        )
        .await
        .expect("insert_plan_item");

        paths.push((src, dst));
    }

    plans_repo::update_plan_state(pool, plan_id, "ready_for_review")
        .await
        .expect("update to ready_for_review");
    plans_repo::set_approved(pool, plan_id, "2026-07-09T00:00:00Z", "tok-test-fixed")
        .await
        .expect("set_approved");

    paths
}

// ── T010: multi-item happy path ────────────────────────────────────────────

/// A 10-item plan where every source file exists and every destination is
/// free must move every file and reach the terminal `applied` state.
#[tokio::test]
async fn apply_multi_item_all_succeed_reaches_applied() {
    let (db, _repo, bus) = support::setup().await;
    let plan_id = Uuid::new_v4().to_string();
    let dir = tempfile::tempdir().expect("tempdir");

    let paths = seed_multi_item_approved_plan(db.pool(), &plan_id, dir.path(), 10).await;

    let resp = app_core::plan_apply::apply_plan(db.pool(), &bus, &plan_id, "tok-test-fixed", None)
        .await
        .expect("apply_plan should succeed");
    assert_eq!(resp.new_state, "applying");

    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    for (src, dst) in &paths {
        assert!(!src.exists(), "source {src:?} should have been moved away");
        assert!(dst.exists(), "destination {dst:?} should exist after move");
    }

    let plan_row = plans_repo::get_plan(db.pool(), &plan_id, false).await.expect("get_plan row");
    assert_eq!(plan_row.state, "applied", "10/10 succeeded items should reach 'applied'");
    assert_eq!(plan_row.items_applied, 10);
    assert_eq!(plan_row.items_failed, 0);
}

// ── T011: partial failure ──────────────────────────────────────────────────

/// A 3-item plan where one item's destination already exists (conflict) and
/// the other two are clear must move the two clear items, leave the
/// conflicting source untouched, and reach the terminal `partially_applied`
/// state (not `failed` — that's reserved for zero successes; see
/// `apply_plan_refuses_to_overwrite_existing_destination` for the all-fail case).
#[tokio::test]
async fn apply_partial_failure_reaches_partially_applied() {
    let (db, _repo, bus) = support::setup().await;
    let plan_id = Uuid::new_v4().to_string();
    let dir = tempfile::tempdir().expect("tempdir");

    let mut paths = seed_multi_item_approved_plan(db.pool(), &plan_id, dir.path(), 3).await;

    // Sabotage item 1's destination so it conflicts (already exists).
    let (_conflict_src, conflict_dst) = &paths[1];
    std::fs::create_dir_all(conflict_dst.parent().expect("dst has parent")).expect("mkdir dst dir");
    std::fs::write(conflict_dst, b"pre-existing").expect("write conflicting dst");

    let resp = app_core::plan_apply::apply_plan(db.pool(), &bus, &plan_id, "tok-test-fixed", None)
        .await
        .expect("apply_plan should succeed (apply start, not item execution)");
    assert_eq!(resp.new_state, "applying");

    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    // Items 0 and 2 succeeded.
    for idx in [0usize, 2usize] {
        let (src, dst) = &paths[idx];
        assert!(!src.exists(), "item {idx} source should have moved");
        assert!(dst.exists(), "item {idx} destination should exist");
    }

    // Item 1 conflicted: source intact, destination unmodified.
    let (conflict_src, conflict_dst) = paths.remove(1);
    assert!(conflict_src.exists(), "conflicting item's source must remain untouched");
    assert_eq!(
        std::fs::read(&conflict_dst).expect("read conflicting dst"),
        b"pre-existing",
        "conflicting item's destination must not be overwritten"
    );

    let plan_row = plans_repo::get_plan(db.pool(), &plan_id, false).await.expect("get_plan row");
    assert_eq!(
        plan_row.state, "partially_applied",
        "2 succeeded + 1 failed should reach 'partially_applied', not 'applied' or 'failed'"
    );
    assert_eq!(plan_row.items_applied, 2);
    assert_eq!(plan_row.items_failed, 1);
}

// ── T050: pause on item.stale (R-Pause-1) ───────────────────────────────────

/// An item whose approval-time size snapshot (`approved_size_bytes`) no
/// longer matches the real file's current size must halt the run with
/// `item.stale` and leave the plan in the `paused` state (not `failed`) —
/// R-Pause-1 is a distinct terminal-ish state from ordinary item failure.
///
/// (T049 — pause on `volume.unavailable` — is not covered here: that code
/// path requires a raw OS error `ENODEV`/`ENXIO`, which is not producible
/// through ordinary tempdir filesystem operations in a portable test; see
/// `crates/fs/executor/src/failure.rs::classify_io_error`.)
#[tokio::test]
async fn apply_pauses_on_stale_item_cas_mismatch() {
    let (db, _repo, bus) = support::setup().await;
    let plan_id = Uuid::new_v4().to_string();
    let dir = tempfile::tempdir().expect("tempdir");

    let paths = seed_multi_item_approved_plan(db.pool(), &plan_id, dir.path(), 1).await;
    let (src, _dst) = &paths[0];

    // Snapshot a size that does NOT match the real file (approval-time size
    // was wrong / the file changed after approval) — forces a CAS mismatch.
    let real_size = i64::try_from(std::fs::metadata(src).expect("stat src").len()).unwrap();
    plans_repo::update_item_fs_snapshot(
        db.pool(),
        &format!("{plan_id}-item-0"),
        None,
        Some(real_size + 1),
    )
    .await
    .expect("update_item_fs_snapshot");

    app_core::plan_apply::apply_plan(db.pool(), &bus, &plan_id, "tok-test-fixed", None)
        .await
        .expect("apply_plan should succeed (apply start, not item execution)");

    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    // Source untouched — the executor must not mutate a stale item.
    assert!(src.exists(), "source must remain untouched when its CAS snapshot is stale");

    let plan_row = plans_repo::get_plan(db.pool(), &plan_id, false).await.expect("get_plan row");
    assert_eq!(plan_row.state, "paused", "a stale-item CAS mismatch must pause, not fail, the run");

    let status = app_core::plan_apply::get_apply_status(db.pool(), &plan_id)
        .await
        .expect("get_apply_status");
    assert_eq!(status.pause_reason.as_deref(), Some("item.stale"));
}

// ── T057: CAS race (R-CAS-1) ────────────────────────────────────────────────

/// Two concurrent `apply_plan` calls racing on the same approved plan: the
/// atomic `approved → applying` CAS (`cas_approved_to_applying`) must let
/// exactly one caller win. The loser observes `plan.invalid_state`.
///
/// This proves the CAS guard end-to-end through the `app_core` use case
/// (not just the isolated SQL `UPDATE ... WHERE state = 'approved'` already
/// covered by `persistence_db::tests::cas_fails_if_not_approved`).
#[tokio::test]
async fn concurrent_apply_calls_race_on_cas_exactly_one_wins() {
    let (db, _repo, bus) = support::setup().await;
    let plan_id = Uuid::new_v4().to_string();
    let dir = tempfile::tempdir().expect("tempdir");

    seed_multi_item_approved_plan(db.pool(), &plan_id, dir.path(), 1).await;

    let pool_a = db.pool().clone();
    let bus_a = bus.clone();
    let plan_id_a = plan_id.clone();
    let pool_b = db.pool().clone();
    let bus_b = bus.clone();
    let plan_id_b = plan_id.clone();

    let (res_a, res_b) = tokio::join!(
        app_core::plan_apply::apply_plan(&pool_a, &bus_a, &plan_id_a, "tok-test-fixed", None),
        app_core::plan_apply::apply_plan(&pool_b, &bus_b, &plan_id_b, "tok-test-fixed", None),
    );

    let outcomes = [res_a, res_b];
    let succeeded = outcomes.iter().filter(|r| r.is_ok()).count();
    let failed = outcomes.iter().filter(|r| r.is_err()).count();

    assert_eq!(succeeded, 1, "exactly one concurrent apply_plan call must win the CAS");
    assert_eq!(failed, 1, "exactly one concurrent apply_plan call must lose the CAS");

    let loser = outcomes.into_iter().find(Result::is_err).expect("one call failed").unwrap_err();
    assert_eq!(
        loser.code,
        contracts_core::error_code::ErrorCode::PlanInvalidState,
        "the losing call must surface plan.invalid_state"
    );
}

// ── PR #685 review: refused items must count as failed ─────────────────────

/// A `delete` item with no destructive confirmation is refused by the
/// executor's destructive-confirm gate (`requires_destructive_confirm &&
/// !destructive_confirmed`, run.rs:381-401) *before* `on_item_start` runs,
/// with no pause. Refused items previously had no persistence arm
/// (`plan_apply.rs`'s `on_item_progress` match only handled
/// succeeded/failed/stale/skipped) — they stayed `item_state = 'pending'`
/// forever and were never counted in `items_failed`, so a plan with one
/// refused item alongside an otherwise-clean apply could report `applied`
/// instead of `partially_applied` (constitution §II silent-failure gap,
/// PR #685 review item 1).
#[tokio::test]
async fn apply_counts_refused_item_as_failed_not_silently_applied() {
    let (db, _repo, bus) = support::setup().await;
    let plan_id = Uuid::new_v4().to_string();
    let dir = tempfile::tempdir().expect("tempdir");

    plans_repo::insert_plan(
        db.pool(),
        &plans_repo::InsertPlan {
            id: &plan_id,
            title: "Refused Item Test Plan",
            origin: "cleanup",
            origin_path: None,
            plan_type: "cleanup",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        },
    )
    .await
    .expect("insert_plan");

    // Item 0: a `delete` action with no destructive_confirmed flag set (DB
    // default 0) — refused by the destructive-confirm gate, never reaches
    // on_item_start.
    let delete_src = dir.path().join("to-delete.fits");
    std::fs::write(&delete_src, b"data").expect("write delete_src");
    plans_repo::insert_plan_item(
        db.pool(),
        &plans_repo::InsertPlanItem {
            id: &format!("{plan_id}-item-0"),
            plan_id: &plan_id,
            item_index: 1,
            name: "to-delete.fits",
            action: "delete",
            from_root_id: None,
            from_relative_path: delete_src.to_str().expect("utf-8 delete src path"),
            to_root_id: None,
            to_relative_path: "",
            reason: "integration test",
            protection: "normal",
            linked_entity: None,
            provenance_json: None,
            archive_path: None,
            source_id: None,
            category: None,
        },
    )
    .await
    .expect("insert_plan_item (delete)");

    // Item 1: an ordinary move that succeeds cleanly.
    let move_src = dir.path().join("to-move.fits");
    let move_dst = dir.path().join("moved/to-move.fits");
    std::fs::write(&move_src, b"data").expect("write move_src");
    plans_repo::insert_plan_item(
        db.pool(),
        &plans_repo::InsertPlanItem {
            id: &format!("{plan_id}-item-1"),
            plan_id: &plan_id,
            item_index: 2,
            name: "to-move.fits",
            action: "move",
            from_root_id: None,
            from_relative_path: move_src.to_str().expect("utf-8 move src path"),
            to_root_id: None,
            to_relative_path: move_dst.to_str().expect("utf-8 move dst path"),
            reason: "integration test",
            protection: "normal",
            linked_entity: None,
            provenance_json: None,
            archive_path: None,
            source_id: None,
            category: None,
        },
    )
    .await
    .expect("insert_plan_item (move)");

    plans_repo::update_plan_state(db.pool(), &plan_id, "ready_for_review")
        .await
        .expect("update to ready_for_review");
    plans_repo::set_approved(db.pool(), &plan_id, "2026-07-13T00:00:00Z", "tok-test-fixed")
        .await
        .expect("set_approved");

    app_core::plan_apply::apply_plan(db.pool(), &bus, &plan_id, "tok-test-fixed", None)
        .await
        .expect("apply_plan should start");
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    // The refused delete must not have touched the file.
    assert!(delete_src.exists(), "a refused destructive item must not be deleted");
    // The unrelated move must have succeeded normally.
    assert!(!move_src.exists());
    assert!(move_dst.exists());

    let items = plans_repo::list_plan_items(db.pool(), &plan_id).await.expect("list_plan_items");
    let refused_item = items.iter().find(|i| i.id == format!("{plan_id}-item-0")).unwrap();
    assert_eq!(
        refused_item.item_state, "failed",
        "a refused item must persist as failed, not stay pending forever"
    );

    let plan_row = plans_repo::get_plan(db.pool(), &plan_id, false).await.expect("get_plan");
    assert_eq!(
        plan_row.state, "partially_applied",
        "one refused + one succeeded item must report partially_applied, not applied"
    );
    assert_eq!(plan_row.items_applied, 1);
    assert_eq!(
        plan_row.items_failed, 1,
        "the refused item must be counted in items_failed, not silently dropped"
    );
}
