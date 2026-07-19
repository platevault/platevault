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
/// `compute_archive_destination` (`protection.rs`) always anchors an
/// archive's actual destination on that same source file's own parent
/// directory, so probing free space from the first item's source parent is
/// the same volume any archive-action item would actually land on — without
/// requiring the (not-yet-created) `.astro-plan-archive/<planId>/` directory
/// itself to exist.
///
/// Never a hard gate (constitution II leaves approval to the user): a probe
/// failure or an empty plan returns `available_bytes: None` rather than an
/// error, and the real, authoritative check remains the apply-time
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

    let available_bytes = detail
        .items
        .first()
        .and_then(|item| Utf8PathBuf::from(&item.from).parent().map(Utf8PathBuf::from))
        .and_then(|dir| available_space_bytes(&dir).ok())
        .map(|bytes| i64::try_from(bytes).unwrap_or(i64::MAX));

    Ok(PlanFreeSpaceEstimate { required_bytes: detail.total_bytes_required, available_bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use audit::EventBus;
    use contracts_core::error_code::ErrorCode;
    use persistence_db::{repositories::plans as repo, Database};

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

    #[tokio::test]
    async fn estimate_free_space_probes_the_first_items_source_parent_directory() {
        let (db, _bus) = setup().await;
        insert_draft(&db, "p1").await;
        // Real filesystem path (a temp dir) so the probe succeeds — mirrors
        // how a real cleanup/archive item's `from_relative_path` is always an
        // absolute, currently-present source path (`processing_artifacts.path`).
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("file.fits");
        let source_str = source.to_str().unwrap();
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: "item-1",
                plan_id: "p1",
                item_index: 1,
                name: "file.fits",
                action: "archive",
                from_root_id: None,
                from_relative_path: source_str,
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
}
