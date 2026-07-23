// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Upgrade regression for the v0.6.0 migration shape.
//!
//! v0.6.0 shipped 0078/0079 without 0074/0075. Spec 056 must therefore add
//! its branch-local migrations above 0079 while preserving 0074/0075, which
//! landed on main after that release.

use persistence_db::Database;
use sqlx::migrate::{Migration, Migrator};

fn v060_migrator() -> Migrator {
    let migrations: Vec<Migration> = Database::migrator()
        .iter()
        .filter(|migration| migration.version <= 79 && !matches!(migration.version, 74 | 75))
        .cloned()
        .collect();
    Migrator { migrations: migrations.into(), ..Migrator::DEFAULT }
}

async fn applied_versions(db: &Database) -> Vec<i64> {
    sqlx::query_as::<_, (i64,)>("SELECT version FROM _sqlx_migrations ORDER BY version")
        .fetch_all(db.pool())
        .await
        .expect("read applied migrations")
        .into_iter()
        .map(|(version,)| version)
        .collect()
}

async fn object_exists(db: &Database, object_type: &str, name: &str) -> bool {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM sqlite_master WHERE type = ? AND name = ?")
            .bind(object_type)
            .bind(name)
            .fetch_one(db.pool())
            .await
            .expect("query sqlite schema");
    count == 1
}

async fn column_exists(db: &Database, table: &str, column: &str) -> bool {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT name FROM pragma_table_info(?)")
        .bind(table)
        .fetch_all(db.pool())
        .await
        .expect("query table columns");
    rows.iter().any(|(name,)| name == column)
}

#[tokio::test]
async fn v060_database_upgrades_through_late_main_and_onboarding_migrations() {
    let db = Database::in_memory().await.expect("in-memory db");
    v060_migrator().run(db.pool()).await.expect("apply v0.6.0 migration set");

    let released = applied_versions(&db).await;
    assert!(released.contains(&78) && released.contains(&79));
    for absent in [74, 75, 80, 81] {
        assert!(!released.contains(&absent), "v0.6.0 fixture unexpectedly contains {absent}");
    }
    assert!(object_exists(&db, "table", "guided_flow_state").await);
    assert!(!object_exists(&db, "table", "onboarding_state").await);

    Database::migrator()
        .run(db.pool())
        .await
        .expect("upgrade v0.6.0 database through the production migrator");

    let upgraded = applied_versions(&db).await;
    for applied in [74, 75, 80, 81] {
        assert!(upgraded.contains(&applied), "upgrade did not apply migration {applied}");
    }
    assert!(column_exists(&db, "inbox_items", "needs_review").await);
    assert!(column_exists(&db, "inbox_source_groups", "file_count").await);
    assert!(object_exists(&db, "table", "onboarding_state").await);
    assert!(object_exists(&db, "table", "onboarding_flags").await);
    assert!(!object_exists(&db, "table", "guided_flow_state").await);
}
