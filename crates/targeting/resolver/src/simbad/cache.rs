// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The persistent, shared resolve-cache handle (spec 052 P1 D2).

use crate::ResolveError;

use super::convert::from_cache_error;

/// A shared handle to the persistent SIMBAD resolve cache (spec 052 P1 D2: one
/// global redb file, no TTL, warmed from the bundled seed + existing
/// `canonical_target` rows — see [`crate::seed`]).
///
/// Cloning is cheap (an `Arc` over one `redb::Database`, mirroring
/// [`simbad_resolver::Store`]); open it once at app startup and clone it into
/// every [`super::SimbadResolver`] built afterward.
#[derive(Clone)]
pub struct ResolveCache(simbad_resolver::Store);

impl ResolveCache {
    /// Open (creating if missing) the durable, file-backed resolve cache at
    /// `path`, with the store's bulk-batch writes configured `Eventual`
    /// (`simbad-resolver` 0.3.2's [`simbad_resolver::BatchDurability`] —
    /// skips the fsync per [`simbad_resolver::Cache::upsert_batch`]
    /// transaction; [`Self::flush`] does one fsync at the end persisting
    /// every chunk, since redb commits are cumulative). Single-item
    /// [`simbad_resolver::Cache::upsert`] calls (e.g. an in-flight resolve
    /// while a chunked seed warm is running) stay durable regardless — this
    /// setting only relaxes the *bulk seed/backfill warm* path
    /// (`crate::seed`), matching the app's own chunk size
    /// (`crate::seed::WARM_CHUNK_SIZE`'s ~13-chunk bundled seed warm going
    /// from ~13 fsyncs to 1).
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the redb file cannot be opened or
    /// its tables cannot be initialised.
    pub fn open(path: impl AsRef<std::path::Path>) -> Result<Self, ResolveError> {
        simbad_resolver::Store::open_with(path, simbad_resolver::BatchDurability::Eventual)
            .map(Self)
            .map_err(|e| from_cache_error(&e))
    }

    /// An ephemeral, in-memory resolve cache (nothing persisted) — for tests
    /// and offline-only construction. Always `Durable` (the crate has no
    /// `Eventual` in-memory variant — there is no "reopen after a crash"
    /// scenario for a store with nothing on disk to begin with).
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the in-memory store cannot be
    /// created.
    pub fn in_memory() -> Result<Self, ResolveError> {
        simbad_resolver::Store::in_memory().map(Self).map_err(|e| from_cache_error(&e))
    }

    /// Borrow the crate's own [`simbad_resolver::Cache`] trait object (e.g. for
    /// [`crate::seed`] warming or a "clear resolve cache" action).
    #[must_use]
    pub fn cache(&self) -> impl simbad_resolver::Cache + 'static {
        self.0.cache()
    }

    /// Force one fully durable commit, persisting every `Eventual` bulk-warm
    /// chunk written since [`Self::open`] (redb commits are cumulative — see
    /// [`simbad_resolver::RedbCache::flush`]). Call once after the LAST
    /// warm/backfill phase of a startup or `target.cache.clear` re-warm —
    /// don't rely on the cache closing naturally to persist those chunks, as
    /// it stays open for the rest of the process's lifetime. A cheap,
    /// safe-to-call no-op if nothing `Eventual` was written this session
    /// (e.g. every phase short-circuited on its own gate).
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the (empty) commit fails.
    pub async fn flush(&self) -> Result<(), ResolveError> {
        // `Store::cache()` returns the CONCRETE `RedbCache` (unlike
        // `Self::cache()` above, which erases it to `impl Cache` — `flush`
        // is redb-specific, not part of the portable `Cache` trait).
        self.0.cache().flush().await.map_err(|e| from_cache_error(&e))
    }
}
