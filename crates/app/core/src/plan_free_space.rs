// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `plans.free_space_estimate` (issue #876) — an advisory destination
//! free-space read at plan review time, before approval.
//!
//! Kept in its own sibling module rather than in `plans.rs`: issue #979 is
//! splitting `plans.rs` on another in-flight branch, and this module has no
//! dependency on that split landing first (it only calls the already-public
//! `plans::get_plan`).

use camino::Utf8PathBuf;
use contracts_core::plans::PlanFreeSpaceEstimate;
use contracts_core::ContractError;
use fs_executor::ops::available_space_bytes;
use sqlx::SqlitePool;

use crate::plans::get_plan;

/// Every item's `from` field is the item's real, currently-present source
/// path (for cleanup/archive plans, the on-disk file being archived/deleted);
/// `compute_archive_destination` (`protection.rs`) always anchors an item's
/// archive destination on that same source file's own parent directory —
/// but a plan is NOT guaranteed to be single-volume: items can come from
/// different source roots (e.g. `generate_raw_frame_plan` allows
/// cross-root selection), each anchoring its own archive destination on a
/// different volume. Probing only the first item would silently ignore a
/// too-full second volume, so this collects every DISTINCT source-parent
/// directory across the plan's items, probes each, and reports the MINIMUM
/// free space of the volumes that answered — the estimate reflects
/// whichever destination volume is tightest, not just the first one — all
/// without requiring the (not-yet-created) `.astro-plan-archive/<planId>/`
/// directory itself to exist.
///
/// Never a hard gate (constitution II leaves approval to the user): a probe
/// failure on every distinct directory, or an empty plan, returns
/// `available_bytes: None` rather than an error — individual per-directory
/// probe failures are otherwise skipped rather than failing the whole
/// estimate, since the real, authoritative check remains the apply-time
/// `recheck_disk_space` (R-Pause-1).
///
/// # Errors
///
/// Returns `ContractError` with `"plan.not_found"` if the plan does not exist.
pub async fn estimate_free_space(
    pool: &SqlitePool,
    plan_id: &str,
) -> Result<PlanFreeSpaceEstimate, ContractError> {
    let detail = get_plan(pool, plan_id).await?;

    let mut parent_dirs: Vec<Utf8PathBuf> = detail
        .items
        .iter()
        .filter_map(|item| Utf8PathBuf::from(&item.from).parent().map(Utf8PathBuf::from))
        .collect();
    parent_dirs.sort();
    parent_dirs.dedup();

    let available_bytes = parent_dirs
        .iter()
        .filter_map(|dir| available_space_bytes(dir).ok())
        .min()
        .map(|bytes| i64::try_from(bytes).unwrap_or(i64::MAX));

    Ok(PlanFreeSpaceEstimate { required_bytes: detail.total_bytes_required, available_bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use audit::EventBus;
    use contracts_core::error_code::ErrorCode;
    use persistence_core::Database;
    use persistence_plans::repositories::plans as repo;

    async fn setup() -> (Database, EventBus) {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    async fn insert_draft(db: &Database, id: &str) {
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id,
                title: "Test",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();
    }

    async fn add_item(db: &Database, plan_id: &str, item_id: &str, action: &str) {
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: item_id,
                plan_id,
                item_index: 1,
                name: "file.fits",
                action,
                from_root_id: None,
                from_relative_path: "raw/file.fits",
                to_root_id: None,
                to_relative_path: "archive/file.fits",
                reason: "test",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: Some(".astro-plan-archive/p1/file.fits"),
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn estimate_free_space_not_found_for_missing_plan() {
        let (db, _bus) = setup().await;
        let err = estimate_free_space(db.pool(), "does-not-exist").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotFound);
    }

    #[tokio::test]
    async fn estimate_free_space_returns_none_for_a_zero_item_plan() {
        let (db, _bus) = setup().await;
        insert_draft(&db, "p1").await;

        let estimate = estimate_free_space(db.pool(), "p1").await.unwrap();
        assert_eq!(estimate.required_bytes, 0);
        assert_eq!(estimate.available_bytes, None, "nothing to probe a destination from");
    }

    /// Helper to insert an item whose `from_relative_path` is an absolute,
    /// real filesystem path so the probe can succeed — mirrors how a real
    /// cleanup/archive item's source path is always absolute and currently
    /// present (`processing_artifacts.path`).
    async fn add_item_with_real_source_path(
        db: &Database,
        plan_id: &str,
        item_id: &str,
        source_path: &str,
    ) {
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: item_id,
                plan_id,
                item_index: 1,
                name: "file.fits",
                action: "archive",
                from_root_id: None,
                from_relative_path: source_path,
                to_root_id: None,
                to_relative_path: "",
                reason: "test",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: None,
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn estimate_free_space_probes_the_items_source_parent_directory() {
        let (db, _bus) = setup().await;
        insert_draft(&db, "p1").await;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("file.fits");
        add_item_with_real_source_path(&db, "p1", "item-1", source.to_str().unwrap()).await;

        let estimate = estimate_free_space(db.pool(), "p1").await.unwrap();
        assert!(
            estimate.available_bytes.is_some_and(|b| b > 0),
            "a real volume must report nonzero free space"
        );
    }

    #[tokio::test]
    async fn estimate_free_space_returns_none_when_the_source_parent_is_unreachable() {
        let (db, _bus) = setup().await;
        insert_draft(&db, "p1").await;
        add_item(&db, "p1", "item-1", "archive").await; // from_relative_path: "raw/file.fits"

        let estimate = estimate_free_space(db.pool(), "p1").await.unwrap();
        assert_eq!(estimate.available_bytes, None, "relative path has no real parent to probe");
    }

    /// A plan can legitimately span volumes: each item anchors its own
    /// archive destination on its own source parent (`compute_archive_destination`),
    /// and cross-root selection is allowed (e.g. `generate_raw_frame_plan`).
    /// `item-1`'s parent is unreachable (a relative path, same as the
    /// unreachable-parent test above) and `item-2`'s is a real, distinct
    /// directory. A regression that only probed the FIRST item would report
    /// `None` here (item-1's probe fails and nothing else is tried); the
    /// fixed behaviour collects every distinct parent directory across all
    /// items, so item-2's real directory still answers.
    #[tokio::test]
    async fn estimate_free_space_probes_every_distinct_parent_directory_not_just_the_first() {
        let (db, _bus) = setup().await;
        insert_draft(&db, "p1").await;
        add_item(&db, "p1", "item-1", "archive").await; // from_relative_path: "raw/file.fits"
        let dir = tempfile::tempdir().unwrap();
        let second_source = dir.path().join("file.fits");
        add_item_with_real_source_path(&db, "p1", "item-2", second_source.to_str().unwrap()).await;

        let estimate = estimate_free_space(db.pool(), "p1").await.unwrap();
        assert!(
            estimate.available_bytes.is_some_and(|b| b > 0),
            "item-2's real, distinct parent directory must still be probed even though \
             item-1's parent (a different directory) is unreachable"
        );
    }
}
