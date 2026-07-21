// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared helpers for migration tests (#1231).

use persistence_db::Database;

/// Run the chain up to and including `version`, so a test can observe the
/// database as it stood before the migration it covers.
///
/// Uses the same embedded migrations as production, truncated -- there is no
/// second copy of the SQL to drift out of step with the real chain.
pub async fn migrate_through(db: &Database, version: i64) {
    let migrator = sqlx::migrate::Migrator {
        migrations: Database::migrator()
            .iter()
            .filter(|migration| migration.version <= version)
            .cloned()
            .collect(),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    migrator.run(db.pool()).await.expect("migrations should apply cleanly");
}

/// A database migrated to `version`, ready to be seeded with rows that the
/// next migration must carry forward.
pub async fn migrated_to(version: i64) -> Database {
    let db = Database::in_memory().await.expect("in-memory db");
    migrate_through(&db, version).await;
    db
}
