// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Populated-database coverage for the `plans` table rebuilds (#1231).
//!
//! `plans`/`plan_items` have been rebuilt eight times (0019, 0029, 0040, 0045,
//! 0053, 0054, 0071, 0073), and nothing covered any of them on populated data.
//! Each rebuild creates a new table, copies rows into it, drops the original
//! and renames -- a shape that fails silently, because the replacement table is
//! well-formed and merely emptier. Plan history is the durable audit record the
//! constitution makes load-bearing (Principle V).
//!
//! 0071 is covered here as the template; the remaining seven follow the same
//! shape and are tracked on #1231.

mod common;

use common::migrated_to;

/// Every column of the seeded plan, so the assertion fails on a shifted column
/// and not only on a dropped row.
type PlanRow = (String, i64, String, String, Option<String>, String, String, String, i64);

const SELECT_SEEDED_PLAN: &str = "SELECT id, number, title, origin, origin_path, state, \
                                  plan_type, destructive_destination, items_total \
                                  FROM plans WHERE id = 'plan-1'";

async fn seed_plan_with_item(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "INSERT INTO plans \
         (id, number, title, origin, origin_path, state, plan_type, \
          destructive_destination, items_total, created_at) \
         VALUES ('plan-1', 7, 'Archive M31', 'archive', '/astro/M31', 'applied', \
                 'archive', 'trash', 3, '2026-06-01T00:00:00Z')",
    )
    .execute(pool)
    .await
    .expect("seed plan");

    sqlx::query(
        "INSERT INTO plan_items \
         (id, plan_id, item_index, name, action, from_relative_path, \
          to_relative_path, reason, created_at) \
         VALUES ('item-1', 'plan-1', 0, 'frame_001.fits', 'archive', \
                 'lights/frame_001.fits', 'archive/frame_001.fits', \
                 'superseded', '2026-06-01T00:00:00Z')",
    )
    .execute(pool)
    .await
    .expect("seed plan_item");
}

#[tokio::test]
async fn migration_0071_carries_the_plan_row_forward() {
    let db = migrated_to(70).await;
    seed_plan_with_item(db.pool()).await;

    let before: PlanRow =
        sqlx::query_as(SELECT_SEEDED_PLAN).fetch_one(db.pool()).await.expect("read seeded plan");

    common::migrate_through(&db, 71).await;

    let after: PlanRow = sqlx::query_as(SELECT_SEEDED_PLAN)
        .fetch_one(db.pool())
        .await
        .expect("the rebuilt plans table must still hold the seeded plan");
    assert_eq!(before, after, "0071's positional row copy must preserve every column");

    // The point of 0071: 'restore' becomes a legal origin and plan_type.
    sqlx::query(
        "INSERT INTO plans \
         (id, number, title, origin, state, plan_type, created_at) \
         VALUES ('plan-2', 8, 'Restore M31', 'restore', 'draft', 'restore', \
                 '2026-06-02T00:00:00Z')",
    )
    .execute(db.pool())
    .await
    .expect("0071 must admit the 'restore' origin and plan_type");
}

/// KNOWN FAILING -- documents a live data-loss defect, see #1307.
///
/// Every `plans` rebuild opens with `PRAGMA foreign_keys = OFF` to make its
/// `DROP TABLE plans` safe. That pragma is a **no-op inside a transaction**,
/// and sqlx runs each migration in one (`sqlx-sqlite/src/migrate.rs:173`), so
/// foreign keys stay enabled and the DROP cascades through
/// `plan_items.plan_id REFERENCES plans(id) ON DELETE CASCADE`, deleting every
/// plan item.
///
/// Proven by A/B on identical SQL and identical seed data: applied through the
/// migrator (in a transaction) `plan_items` ends at 0; applied as a raw script
/// (no transaction) it ends at 1.
///
/// Un-ignore once the rebuilds are fixed. Seven migrations share the shape:
/// 0019, 0029, 0040, 0053, 0054, 0071, 0073. The existing files cannot be
/// edited -- their checksums are recorded in every deployed database -- so the
/// fix has to be a forward migration plus a rule for future rebuilds.
#[ignore = "live defect #1307: FK cascade wipes plan_items during the plans rebuild"]
#[tokio::test]
async fn migration_0071_preserves_plan_items() {
    let db = migrated_to(70).await;
    seed_plan_with_item(db.pool()).await;

    common::migrate_through(&db, 71).await;

    let (items,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM plan_items WHERE plan_id = 'plan-1'")
            .fetch_one(db.pool())
            .await
            .expect("count plan_items");
    assert_eq!(items, 1, "rebuilding plans must not cascade-delete its plan_items");
}
