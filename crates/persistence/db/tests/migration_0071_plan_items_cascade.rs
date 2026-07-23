// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Regression test for #1307.
//!
//! `plans` has been rebuilt (drop + recreate + rename) 15 times to change its
//! `CHECK` constraints; migration 0071 is used here as the sample. Every one
//! of those rebuilds opens with `PRAGMA foreign_keys = OFF` to make its
//! `DROP TABLE plans` safe. sqlx runs each migration inside its own
//! transaction, and `SQLite` treats that pragma as a no-op once a transaction
//! is open (see `sqlite.org/pragma.html#pragma_foreign_keys`) — so the in-file
//! pragma never took effect, and the `DROP TABLE` cascaded through
//! `plan_items.plan_id REFERENCES plans(id) ON DELETE CASCADE`, silently
//! deleting every plan item.
//!
//! This test drives the *real* embedded migrator (same SQL as production, no
//! duplicated copy) over a single connection, matching how
//! `Database::migrate()` actually applies migrations, so it exercises the
//! same transaction wrapping that triggers the defect.

use persistence_db::Database;
use sqlx::migrate::{Migration, Migrator};
use sqlx::sqlite::SqliteConnection;

/// The production migrator, filtered to every migration up to and including
/// `through_version`. Reuses the real embedded SQL — nothing here can drift
/// out of step with what `Database::migrate()` actually ships.
fn migrator_through(through_version: i64) -> Migrator {
    let full: Migrator = sqlx::migrate!("./migrations");
    let filtered: Vec<Migration> =
        full.migrations.iter().filter(|m| m.version <= through_version).cloned().collect();
    Migrator { migrations: filtered.into(), ..Migrator::DEFAULT }
}

async fn seed_plan_with_item(conn: &mut SqliteConnection) {
    sqlx::query(
        "INSERT INTO plans \
         (id, number, title, origin, origin_path, state, plan_type, \
          destructive_destination, items_total, created_at) \
         VALUES ('plan-1', 7, 'Archive M31', 'archive', '/astro/M31', 'applied', \
                 'archive', 'trash', 3, '2026-06-01T00:00:00Z')",
    )
    .execute(&mut *conn)
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
    .execute(&mut *conn)
    .await
    .expect("seed plan_item");
}

/// Seeds a `plan`/`plan_item` at schema version 70, then runs the *real*
/// `Database::migrate()` production entry point (not a hand-rolled
/// reproduction of it) to carry the DB the rest of the way to head. This is
/// deliberately the exact function real callers use, so a temporary revert of
/// `Database::migrate()` to the pre-fix version reproduces the failure here
/// and nowhere else needs to change.
#[tokio::test]
async fn migration_0071_preserves_plan_items() {
    let db = Database::in_memory().await.expect("in-memory db");
    {
        let mut conn = db.pool().acquire().await.expect("acquire connection");
        migrator_through(70).run(&mut *conn).await.expect("migrate through 0070");
        seed_plan_with_item(&mut conn).await;

        let (before,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM plan_items WHERE plan_id = 'plan-1'")
                .fetch_one(&mut *conn)
                .await
                .expect("count plan_items before 0071");
        assert_eq!(before, 1, "seed must have inserted exactly one plan_item");
        // `conn` drops here and returns to the pool before `db.migrate()`
        // acquires its own connection — this is an in-memory DB, so a second
        // *live* connection open at the same time would see an empty sibling
        // database rather than this one.
    }

    // The call under test: on the unfixed `Database::migrate()`, this runs
    // migration 0071 over the shared pool with default FK enforcement (ON,
    // set at connect time) and no compensating pragma outside a transaction,
    // so 0071's own `PRAGMA foreign_keys = OFF` (issued inside the
    // migration's transaction) is a no-op and `DROP TABLE plans` cascades.
    db.migrate().await.expect("migrate to head");

    let (after,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM plan_items WHERE plan_id = 'plan-1'")
            .fetch_one(db.pool())
            .await
            .expect("count plan_items after migrating to head");
    assert_eq!(
        after, 1,
        "rebuilding plans (migration 0071) must not cascade-delete its plan_items"
    );

    // The plan row itself must also survive with every column intact.
    let (title, origin): (String, String) =
        sqlx::query_as("SELECT title, origin FROM plans WHERE id = 'plan-1'")
            .fetch_one(db.pool())
            .await
            .expect("plan row must survive the rebuild");
    assert_eq!(title, "Archive M31");
    assert_eq!(origin, "archive");
}
