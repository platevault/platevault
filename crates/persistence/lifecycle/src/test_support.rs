// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared in-process test fixtures for persistence_lifecycle integration tests.
//!
//! Available under `cfg(test)` within this crate and via the `test-fixture`
//! feature for external consumers (e.g. `app_core` dev-dependencies).
//!
//! The returned `SqliteLifecycleRepository` owns an internal `EventBus`.
//! Callers that need direct bus access (e.g. to subscribe a listener before the
//! repo is exercised) should construct their own `EventBus` against the same
//! pool and pass it to `SqliteLifecycleRepository::new` directly — see
//! `app_core/tests/support/mod.rs` for that pattern.

use audit_types::{EventPublisher, Source};
use persistence_core::Database;
use sqlx::SqlitePool;

use crate::repositories::lifecycle::SqliteLifecycleRepository;

/// No-op [`EventPublisher`] for test setups that do not need event delivery.
///
/// This avoids a dependency on the `audit` crate (which depends on
/// `persistence_lifecycle`, creating a cycle) while still satisfying the
/// `EventPublisher` bound on `SqliteLifecycleRepository::new`.
struct NoopPublisher;

#[async_trait::async_trait]
impl EventPublisher for NoopPublisher {
    async fn publish(&self, _topic: &str, _source: Source, _payload: serde_json::Value) {}
}

/// Provision an isolated in-memory `Database` with all migrations applied and
/// wire a `SqliteLifecycleRepository` against it. Returns `(Database, repo)`.
///
/// The repository is wired with a no-op event publisher. If a test needs live
/// event delivery (e.g. to subscribe a listener), construct an `audit::bus::EventBus`
/// against the pool directly and pass it to `SqliteLifecycleRepository::new`.
///
/// # Panics
///
/// Panics if the in-memory pool, migrations, or repository construction fails.
pub async fn setup() -> (Database, SqliteLifecycleRepository) {
    let db = persistence_core::test_support::setup_db().await;
    let repo = SqliteLifecycleRepository::new(db.pool().clone(), NoopPublisher);
    (db, repo)
}

/// Insert a minimal `target` row sufficient to seed ledger-view entity data.
///
/// Inserts into the legacy `target` table (the simpler in-app catalog),
/// NOT `canonical_target` (the resolver domain).
///
/// # Panics
///
/// Panics on SQL failure.
pub async fn insert_target(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO target (id, primary_designation, created_at) \
         VALUES (?, ?, '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("DES-{id}"))
    .execute(pool)
    .await
    .expect("insert_target failed");
}

/// Insert a minimal `projects` row sufficient to satisfy lifecycle and ledger
/// queries. `state` is the initial `lifecycle` column value.
///
/// Uses a per-`id` path to avoid the `UNIQUE(path)` constraint when multiple
/// projects are seeded in the same test.
///
/// # Panics
///
/// Panics on SQL failure.
pub async fn insert_project(pool: &SqlitePool, id: &str, state: &str) {
    let path = format!("projects/{id}");
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, created_at, updated_at) \
         VALUES (?, 'P', 'PixInsight', ?, ?, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(state)
    .bind(&path)
    .execute(pool)
    .await
    .expect("insert_project failed");
}

/// Insert a `projects` row with an explicit `name` and `created_at` / `updated_at`
/// timestamp — use this when ledger filter tests need stable titles or
/// date-range queries. For simple FK-seed rows use [`insert_project`] instead.
///
/// # Panics
///
/// Panics on SQL failure.
pub async fn insert_named_project(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    state: &str,
    created_at: &str,
) {
    let path = format!("projects/{id}");
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, created_at, updated_at) \
         VALUES (?, ?, 'PixInsight', ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind(state)
    .bind(&path)
    .bind(created_at)
    .bind(created_at)
    .execute(pool)
    .await
    .expect("insert_named_project failed");
}

/// Insert a minimal `library_root` row for ledger-view entity seeding.
///
/// # Panics
///
/// Panics on SQL failure.
pub async fn insert_library_root(pool: &SqlitePool, id: &str, label: &str) {
    sqlx::query(
        "INSERT INTO library_root \
         (id, label, current_path, kind, state, last_seen_at, created_at) \
         VALUES (?, ?, '/tmp/lr', 'local', 'active', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')",
    )
    .bind(id)
    .bind(label)
    .execute(pool)
    .await
    .expect("insert_library_root failed");
}

/// Insert a minimal `file_record` row for ledger-view entity seeding.
///
/// # Panics
///
/// Panics on SQL failure.
pub async fn insert_file_record(
    pool: &SqlitePool,
    id: &str,
    root_id: &str,
    rel_path: &str,
    state: &str,
    last_seen_at: &str,
) {
    sqlx::query(
        "INSERT INTO file_record \
         (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
         VALUES (?, ?, ?, 0, '2026-05-01T00:00:00Z', ?, '2026-05-01T00:00:00Z', ?)",
    )
    .bind(id)
    .bind(root_id)
    .bind(rel_path)
    .bind(state)
    .bind(last_seen_at)
    .execute(pool)
    .await
    .expect("insert_file_record failed");
}
