// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Test-only serialization for the process-global `SnapshotCache` statics
//! (in-memory caching layer F0 foundation).
//!
//! `crate::caches::catalog`/`resolver_settings` are singleton `OnceLock`s
//! shared by every test in this crate's test binary. Without serialization,
//! parallel `#[tokio::test]` runs across `target_management`, `target_resolve`,
//! `target_search`, and `resolver_settings` tests race on the same slot — a
//! `store` from one test can land after another concurrently-running test's
//! `invalidate`, reproducing the lost-update window the `SnapshotCache` type
//! doc warns about, and leaking one test's DB content into another's
//! assertions. [`locked_db`] builds a fresh in-memory DB while holding a
//! process-wide lock (released when the returned [`LockedDb`] is dropped at
//! the end of the test), so `setup()` in each of those four files can use
//! this in place of a bare `Database` with no other test-body changes.
//! [`locked_reset`] is the sync counterpart for `crate::caches`'s own
//! round-trip unit tests, which manipulate these same statics directly and
//! are not `async`.

use persistence_core::Database;

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// A `Database` that also holds the shared cache-test lock for its
/// lifetime. Derefs to `Database` so existing call sites (`db.pool()`,
/// `&db` passed where `&Database` is expected) are unchanged.
pub struct LockedDb {
    db: Database,
    _guard: tokio::sync::MutexGuard<'static, ()>,
}

impl std::ops::Deref for LockedDb {
    type Target = Database;

    fn deref(&self) -> &Database {
        &self.db
    }
}

/// Acquire the shared lock, reset both snapshot caches to a clean (miss)
/// state, and build a fresh in-memory, migrated DB.
pub async fn locked_db() -> LockedDb {
    let guard = LOCK.lock().await;
    crate::caches::invalidate_catalog();
    crate::caches::invalidate_resolver_settings();
    let db = Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    LockedDb { db, _guard: guard }
}

/// Acquire the shared lock and reset both snapshot caches, for non-async
/// `#[test]` functions. Blocks the current thread rather than `.await`ing
/// — safe here because these call sites have no Tokio runtime, unlike
/// [`locked_db`]'s async callers.
pub fn locked_reset() -> tokio::sync::MutexGuard<'static, ()> {
    let guard = LOCK.blocking_lock();
    crate::caches::invalidate_catalog();
    crate::caches::invalidate_resolver_settings();
    guard
}
