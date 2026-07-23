// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared in-process caching primitives for `app_core_*` crates (spec 051).
//!
//! This crate is a **thin wrapper around `moka`**
//! (`moka = { version = "0.12", features = ["sync"] }`, already an in-tree
//! workspace dependency). It exists so app-layer crates share one place to
//! construct an in-memory cache/debounce table instead of each hand-rolling a
//! `moka::sync::Cache` (as `crates/app/projects/src/project_health.rs`
//! currently does for its block-transition debounce table).
//!
//! ## Scope (read this before reaching for this crate)
//!
//! - **In-memory, in-process, non-durable** caching for app-layer
//!   orchestration only (e.g. debouncing repeated event emission, memoizing a
//!   cheap derived read within a request). It is explicitly **not** a durable
//!   cache, not a replacement for `SQLite`, and not a general key-value store —
//!   Constitution Principle V still requires the database to be the durable
//!   record.
//! - `crates/targeting/resolver` (the redistributable SIMBAD resolution
//!   crate) MUST NOT depend on this crate — it has its own self-contained,
//!   durable `SQLite`-backed resolution cache. See
//!   `specs/051-tauri-shell-integration/research.md` §(d) for the full
//!   rationale ("the resolver-decoupling rule").
//!
//! ## Migrating existing hand-rolled caches
//!
//! `crates/app/projects/src/project_health.rs` previously hand-rolled its own
//! `DebounceTable` (a `moka::sync::Cache` wrapper); it now uses
//! [`DebounceCache`] here directly. Spec 051 did not require that migration —
//! it was a pure refactor with no user-facing effect — but the duplication
//! audit (`docs/development/duplication-and-abstraction-audit.md`, Phase 5)
//! folded it in.
//!
//! ## What this crate provides
//!
//! - [`TtlCache`]: a generic, size- and TTL-bounded cache with a
//!   single-flight get-or-insert (`get_or_insert_with`).
//! - [`DebounceCache`]: a presence-only cache (mirrors
//!   `project_health::DebounceTable`) for suppressing repeated signals within
//!   a time window, generic over the debounce key.
//! - [`SnapshotCache`]: a single-slot whole-value cache (spec: in-memory
//!   caching layer, F0) for values loaded via **async** SQL, where
//!   `TtlCache::get_or_insert_with`'s sync-only closure doesn't fit. Bounded by
//!   construction (exactly one `Arc<T>` slot) — no capacity/TTL knobs needed.

use std::hash::Hash;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use moka::sync::Cache;

/// Size/TTL/TTI configuration for a [`TtlCache`].
///
/// Mirrors the subset of `moka::sync::CacheBuilder` knobs this crate exposes.
/// Construct with [`CacheConfig::new`] and refine with the `with_*` builder
/// methods.
#[derive(Clone, Copy, Debug)]
pub struct CacheConfig {
    max_capacity: u64,
    time_to_live: Option<Duration>,
    time_to_idle: Option<Duration>,
}

impl CacheConfig {
    /// Start a config with the given maximum entry count and no TTL/TTI
    /// (entries live until evicted for capacity or explicitly invalidated).
    #[must_use]
    pub fn new(max_capacity: u64) -> Self {
        Self { max_capacity, time_to_live: None, time_to_idle: None }
    }

    /// Set a time-to-live: an entry expires this long after it was inserted,
    /// regardless of how often it is read.
    #[must_use]
    pub fn with_time_to_live(mut self, ttl: Duration) -> Self {
        self.time_to_live = Some(ttl);
        self
    }

    /// Set a time-to-idle: an entry expires this long after it was last
    /// read, resetting on every access.
    #[must_use]
    pub fn with_time_to_idle(mut self, tti: Duration) -> Self {
        self.time_to_idle = Some(tti);
        self
    }
}

/// A generic, size- and TTL-bounded in-memory cache.
///
/// Thin wrapper around `moka::sync::Cache<K, V>`. Safe to share across
/// threads via `Clone` (moka's handle is internally `Arc`-backed) — clone a
/// [`TtlCache`] rather than wrapping it in `Arc<Mutex<_>>` unless external
/// synchronization is otherwise required.
///
/// # Examples
///
/// ```
/// use std::time::Duration;
///
/// use app_core_cache::{CacheConfig, TtlCache};
///
/// let cache: TtlCache<String, u32> =
///     TtlCache::new(CacheConfig::new(100).with_time_to_live(Duration::from_secs(60)));
///
/// let value = cache.get_or_insert_with("key".to_owned(), || 42);
/// assert_eq!(value, 42);
/// assert_eq!(cache.get(&"key".to_owned()), Some(42));
/// ```
#[derive(Clone)]
pub struct TtlCache<K, V>
where
    K: Hash + Eq + Send + Sync + 'static,
    V: Clone + Send + Sync + 'static,
{
    inner: Cache<K, V>,
}

impl<K, V> TtlCache<K, V>
where
    K: Hash + Eq + Send + Sync + 'static,
    V: Clone + Send + Sync + 'static,
{
    /// Build a new cache from the given [`CacheConfig`].
    #[must_use]
    pub fn new(config: CacheConfig) -> Self {
        let mut builder = Cache::builder().max_capacity(config.max_capacity);
        if let Some(ttl) = config.time_to_live {
            builder = builder.time_to_live(ttl);
        }
        if let Some(tti) = config.time_to_idle {
            builder = builder.time_to_idle(tti);
        }
        Self { inner: builder.build() }
    }

    /// Return a clone of the cached value for `key`, or `None` on a miss
    /// (including an expired entry).
    #[must_use]
    pub fn get(&self, key: &K) -> Option<V> {
        self.inner.get(key)
    }

    /// Insert (or overwrite) the value for `key`.
    pub fn insert(&self, key: K, value: V) {
        self.inner.insert(key, value);
    }

    /// Remove `key` from the cache, if present.
    pub fn invalidate(&self, key: &K) {
        self.inner.invalidate(key);
    }

    /// Return the cached value for `key`, computing and inserting it via
    /// `init` on a miss. Concurrent calls for the same key are coalesced by
    /// `moka` (single-flight) — `init` runs at most once per miss even under
    /// concurrent access.
    pub fn get_or_insert_with(&self, key: K, init: impl FnOnce() -> V) -> V {
        self.inner.get_with(key, init)
    }

    /// Approximate number of entries currently held (moka's counts are
    /// eventually consistent; do not rely on this for exact bookkeeping).
    #[must_use]
    pub fn entry_count(&self) -> u64 {
        self.inner.entry_count()
    }

    /// Whether the cache currently holds no entries (see [`entry_count`]'s
    /// eventual-consistency caveat).
    ///
    /// [`entry_count`]: Self::entry_count
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entry_count() == 0
    }
}

/// A presence-only cache for suppressing repeated signals within a time
/// window — the generic form of the hand-rolled debounce table
/// `crates/app/projects/src/project_health.rs` previously carried.
///
/// Presence of a (non-expired) entry for a key means a signal for that key
/// was already emitted within the debounce window and must be suppressed.
/// The `time_to_live` window is fixed at construction, so entries auto-expire
/// after the window elapses — no manual `Instant` bookkeeping required.
///
/// # Examples
///
/// ```
/// use std::time::Duration;
///
/// use app_core_cache::DebounceCache;
///
/// let debounce: DebounceCache<String> = DebounceCache::new(Duration::from_mins(1));
///
/// assert!(!debounce.should_suppress(&"project-1".to_owned()), "first signal is not suppressed");
/// assert!(debounce.should_suppress(&"project-1".to_owned()), "second signal within window is suppressed");
/// ```
#[derive(Clone)]
pub struct DebounceCache<K>
where
    K: Hash + Eq + Clone + Send + Sync + 'static,
{
    last_emitted: Cache<K, ()>,
}

impl<K> DebounceCache<K>
where
    K: Hash + Eq + Clone + Send + Sync + 'static,
{
    /// Build a new debounce cache with the given suppression window.
    #[must_use]
    pub fn new(window: Duration) -> Self {
        Self { last_emitted: Cache::builder().time_to_live(window).build() }
    }

    /// Returns `true` if a signal for `key` should be suppressed (an entry
    /// is still present, i.e. the debounce window has not elapsed since the
    /// last call that returned `false` for this key). Otherwise records the
    /// emission (starting a fresh window) and returns `false`.
    pub fn should_suppress(&self, key: &K) -> bool {
        if self.last_emitted.get(key).is_some() {
            return true;
        }
        self.last_emitted.insert(key.clone(), ());
        false
    }

    /// Force-expire the entry for `key`, so the next `should_suppress` for it
    /// starts a fresh window. Useful for resetting a debounce early, and for
    /// tests that simulate elapsed time without sleeping.
    pub fn invalidate(&self, key: &K) {
        self.last_emitted.invalidate(key);
    }
}

/// A single-slot whole-value cache: `RwLock<Option<Arc<T>>>`.
///
/// For state loaded wholesale (e.g. a settings bag, a config row, a small
/// list snapshot) rather than keyed per-entry. Bounded by construction — it
/// only ever holds zero or one `Arc<T>` — so no capacity/TTL configuration is
/// needed the way [`TtlCache`] requires it.
///
/// Explicit invalidation is the whole contract: [`invalidate`](Self::invalidate)
/// clears the slot so the next [`load`](Self::load) observes a miss and the
/// caller re-derives + [`store`](Self::store)s a fresh value. There is no
/// TTL/TTI — owning modules call `invalidate` at their write sites (see the
/// in-memory caching layer plan's invalidation-point map).
///
/// **Usage contract for read-through call sites:** callers MUST call
/// [`invalidate`](Self::invalidate) only *after* the underlying DB write has
/// committed, never before or concurrently with it. A [`store`](Self::store)
/// that races a concurrent [`invalidate`](Self::invalidate) — i.e. a reader
/// re-derives from the pre-commit state and calls `store` after the writer's
/// `invalidate` has already run — repopulates the slot with a stale value.
/// Because there is no TTL, that staleness is permanent until the next
/// explicit invalidation. Sequencing invalidation strictly after commit is
/// what closes this window; do not replicate a store-then-invalidate (or
/// invalidate-before-commit) ordering in downstream read-through workers.
///
/// # Examples
///
/// ```
/// use std::sync::Arc;
///
/// use app_core_cache::SnapshotCache;
///
/// let cache: SnapshotCache<u32> = SnapshotCache::new();
/// assert_eq!(cache.load(), None, "empty cache is a miss");
///
/// cache.store(Arc::new(42));
/// assert_eq!(cache.load(), Some(Arc::new(42)));
///
/// cache.invalidate();
/// assert_eq!(cache.load(), None, "invalidated cache is a miss again");
/// ```
pub struct SnapshotCache<T>
where
    T: Send + Sync + 'static,
{
    slot: RwLock<Option<Arc<T>>>,
}

impl<T> SnapshotCache<T>
where
    T: Send + Sync + 'static,
{
    /// Build an empty cache (starts as a miss).
    #[must_use]
    pub const fn new() -> Self {
        Self { slot: RwLock::new(None) }
    }

    /// Return the currently cached value, or `None` on a miss.
    ///
    /// A poisoned lock (a prior panic while holding the write lock) is treated
    /// as recoverable: the cache is a best-effort in-memory optimization, not
    /// a durable record, so a poisoned lock degrades to a miss rather than
    /// propagating a panic to every subsequent reader.
    #[must_use]
    pub fn load(&self) -> Option<Arc<T>> {
        self.slot.read().map_or(None, |guard| guard.clone())
    }

    /// Replace the cached value.
    ///
    /// Not itself hazardous, but see the type-level doc for the lost-update
    /// window this creates when a `store` races a concurrent
    /// [`invalidate`](Self::invalidate): callers must invalidate strictly
    /// after their DB write commits, never before/concurrently with it.
    pub fn store(&self, value: Arc<T>) {
        if let Ok(mut guard) = self.slot.write() {
            *guard = Some(value);
        }
    }

    /// Clear the slot so the next [`load`](Self::load) is a miss. Call this
    /// at every write site that changes the underlying data (see the
    /// invalidation-point map in the caching layer plan) — this cache has no
    /// TTL, so a missed invalidation call means permanently stale data.
    pub fn invalidate(&self) {
        if let Ok(mut guard) = self.slot.write() {
            *guard = None;
        }
    }
}

impl<T> Default for SnapshotCache<T>
where
    T: Send + Sync + 'static,
{
    fn default() -> Self {
        Self::new()
    }
}

// ── protection_defaults: global protection-default settings snapshot ───────
//
// Relocated here (not `app_core`) so both `app_core` (`protection.rs` reads
// it) and `app_core_settings` (the generic settings-bag write path also
// changes these three keys) can invalidate it without a dependency cycle —
// `app_core` depends on `app_core_settings`, so the cache can't live in
// `app_core` if `app_core_settings` needs to invalidate it too.

/// Snapshot of the three global protection-default settings (`protection_defaults`
/// table, scope `"global"`): default level, block-permanent-delete flag, and
/// protected categories. Plain data so this leaf crate doesn't need to depend
/// on `app_core`'s `GlobalProtection` (which stays where it is; callers convert
/// at the boundary).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtectionDefaultsSnapshot {
    pub level: String,
    pub block_permanent_delete: bool,
    pub categories: Vec<String>,
}

/// Per-instance protection-defaults cache state.
///
/// Replaces the former process-global `OnceLock` statics (`PROTECTION_DEFAULTS`,
/// `PROTECTION_DEFAULTS_EPOCH`). Wrap in `Arc` and thread alongside
/// `SqlitePool`/`EventBus`; tests construct a fresh instance per test to
/// eliminate cross-contamination.
pub struct ProtectionDefaultsCaches {
    defaults: SnapshotCache<ProtectionDefaultsSnapshot>,
    /// Monotonic generation counter bumped by every [`Self::invalidate`] call.
    /// Downstream caches tag entries with the epoch they were resolved under
    /// and treat a mismatch as a miss (issue #563).
    epoch: AtomicU64,
}

impl ProtectionDefaultsCaches {
    /// Construct a fresh, empty instance.
    #[must_use]
    pub fn new() -> Self {
        Self { defaults: SnapshotCache::new(), epoch: AtomicU64::new(0) }
    }

    /// Return the current epoch. Capture *before* reading defaults a derived
    /// value will embed.
    #[must_use]
    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }

    /// Return the cached snapshot, or `None` on a miss.
    #[must_use]
    pub fn load(&self) -> Option<Arc<ProtectionDefaultsSnapshot>> {
        self.defaults.load()
    }

    /// Store a freshly loaded snapshot.
    pub fn store(&self, value: Arc<ProtectionDefaultsSnapshot>) {
        self.defaults.store(value);
    }

    /// Clear the snapshot and bump the epoch so derived caches see a miss.
    pub fn invalidate(&self) {
        self.defaults.invalidate();
        self.epoch.fetch_add(1, Ordering::AcqRel);
    }
}

impl Default for ProtectionDefaultsCaches {
    fn default() -> Self {
        Self::new()
    }
}

// ── Deprecated process-global accessors (migration shim) ─────────────────────
//
// These delegate to a process-global instance so existing call sites compile
// unchanged during incremental migration. New code MUST use
// `ProtectionDefaultsCaches` directly.

static PROTECTION_DEFAULTS: OnceLock<SnapshotCache<ProtectionDefaultsSnapshot>> = OnceLock::new();

static PROTECTION_DEFAULTS_EPOCH: AtomicU64 = AtomicU64::new(0);

/// Return the current protection-defaults epoch (process-global).
#[must_use]
pub fn protection_defaults_epoch() -> u64 {
    PROTECTION_DEFAULTS_EPOCH.load(Ordering::Acquire)
}

/// Return the process-global protection-defaults snapshot cache.
pub fn protection_defaults() -> &'static SnapshotCache<ProtectionDefaultsSnapshot> {
    PROTECTION_DEFAULTS.get_or_init(SnapshotCache::new)
}

/// Store a freshly loaded [`ProtectionDefaultsSnapshot`] (process-global).
pub fn store_protection_defaults(value: Arc<ProtectionDefaultsSnapshot>) {
    protection_defaults().store(value);
}

/// Clear the protection-defaults snapshot (process-global).
pub fn invalidate_protection_defaults() {
    protection_defaults().invalidate();
    PROTECTION_DEFAULTS_EPOCH.fetch_add(1, Ordering::AcqRel);
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    use super::{
        invalidate_protection_defaults, protection_defaults, store_protection_defaults,
        CacheConfig, DebounceCache, ProtectionDefaultsSnapshot, SnapshotCache, TtlCache,
    };

    #[test]
    fn ttl_cache_miss_then_hit() {
        let cache: TtlCache<String, u32> = TtlCache::new(CacheConfig::new(10));

        assert_eq!(cache.get(&"a".to_owned()), None, "miss before insert");
        cache.insert("a".to_owned(), 1);
        assert_eq!(cache.get(&"a".to_owned()), Some(1), "hit after insert");
    }

    #[test]
    fn ttl_cache_invalidate_removes_entry() {
        let cache: TtlCache<String, u32> = TtlCache::new(CacheConfig::new(10));
        cache.insert("a".to_owned(), 1);
        cache.invalidate(&"a".to_owned());
        assert_eq!(cache.get(&"a".to_owned()), None, "invalidated entry is a miss");
    }

    #[test]
    fn ttl_cache_get_or_insert_with_computes_once_on_miss() {
        let cache: TtlCache<String, u32> = TtlCache::new(CacheConfig::new(10));
        let mut calls = 0;

        let first = cache.get_or_insert_with("a".to_owned(), || {
            calls += 1;
            42
        });
        assert_eq!(first, 42);
        assert_eq!(calls, 1, "init runs on miss");

        let second = cache.get_or_insert_with("a".to_owned(), || {
            calls += 1;
            99
        });
        assert_eq!(second, 42, "hit returns the originally cached value");
        assert_eq!(calls, 1, "init does not run again on hit");
    }

    #[test]
    fn ttl_cache_expires_after_time_to_live() {
        let cache: TtlCache<String, u32> =
            TtlCache::new(CacheConfig::new(10).with_time_to_live(Duration::from_millis(30)));
        cache.insert("a".to_owned(), 1);
        assert_eq!(cache.get(&"a".to_owned()), Some(1));

        thread::sleep(Duration::from_millis(150));
        // moka's TTL sweep is lazy; run_pending_tasks forces expiry to be
        // observable without a background thread or a much longer sleep.
        cache.inner.run_pending_tasks();
        assert_eq!(cache.get(&"a".to_owned()), None, "entry must expire after its TTL elapses");
    }

    #[test]
    fn ttl_cache_evicts_by_capacity() {
        let cache: TtlCache<u32, u32> = TtlCache::new(CacheConfig::new(2));
        cache.insert(1, 1);
        cache.insert(2, 2);
        cache.insert(3, 3);
        cache.inner.run_pending_tasks();

        assert!(cache.entry_count() <= 2, "capacity bound must be enforced");
    }

    #[test]
    fn ttl_cache_is_empty_reports_no_entries() {
        let cache: TtlCache<String, u32> = TtlCache::new(CacheConfig::new(10));
        assert!(cache.is_empty(), "fresh cache is empty");
        cache.insert("a".to_owned(), 1);
        cache.inner.run_pending_tasks();
        assert!(!cache.is_empty(), "cache with an entry is not empty");
    }

    #[test]
    fn debounce_cache_suppresses_second_signal_within_window() {
        let debounce: DebounceCache<String> = DebounceCache::new(Duration::from_mins(1));

        assert!(!debounce.should_suppress(&"a".to_owned()), "first signal is not suppressed");
        assert!(
            debounce.should_suppress(&"a".to_owned()),
            "second signal within window is suppressed"
        );
    }

    #[test]
    fn debounce_cache_distinct_keys_do_not_suppress_each_other() {
        let debounce: DebounceCache<String> = DebounceCache::new(Duration::from_mins(1));

        assert!(!debounce.should_suppress(&"a".to_owned()));
        assert!(!debounce.should_suppress(&"b".to_owned()), "distinct key must not be debounced");
    }

    #[test]
    fn debounce_cache_allows_after_manual_expire() {
        let debounce: DebounceCache<String> = DebounceCache::new(Duration::from_mins(1));

        assert!(!debounce.should_suppress(&"a".to_owned()));
        debounce.invalidate(&"a".to_owned());
        assert!(
            !debounce.should_suppress(&"a".to_owned()),
            "after expiry, signal is emitted again"
        );
    }

    #[test]
    fn debounce_cache_allows_after_time_to_live_elapses() {
        let debounce: DebounceCache<String> = DebounceCache::new(Duration::from_millis(30));

        assert!(!debounce.should_suppress(&"a".to_owned()));
        thread::sleep(Duration::from_millis(150));
        assert!(
            !debounce.should_suppress(&"a".to_owned()),
            "after TTL elapses, signal is emitted again"
        );
    }

    #[test]
    fn snapshot_cache_starts_empty() {
        let cache: SnapshotCache<u32> = SnapshotCache::new();
        assert_eq!(cache.load(), None, "fresh cache is a miss");
    }

    #[test]
    fn snapshot_cache_store_then_load_hits() {
        let cache: SnapshotCache<u32> = SnapshotCache::new();
        cache.store(std::sync::Arc::new(42));
        assert_eq!(cache.load(), Some(std::sync::Arc::new(42)));
    }

    #[test]
    fn snapshot_cache_invalidate_clears_the_slot() {
        let cache: SnapshotCache<u32> = SnapshotCache::new();
        cache.store(std::sync::Arc::new(42));
        cache.invalidate();
        assert_eq!(cache.load(), None, "invalidated cache is a miss");
    }

    #[test]
    fn snapshot_cache_store_overwrites_previous_value() {
        let cache: SnapshotCache<u32> = SnapshotCache::new();
        cache.store(std::sync::Arc::new(1));
        cache.store(std::sync::Arc::new(2));
        assert_eq!(cache.load(), Some(std::sync::Arc::new(2)), "store replaces the slot");
    }

    #[test]
    fn snapshot_cache_default_is_empty() {
        let cache: SnapshotCache<u32> = SnapshotCache::default();
        assert_eq!(cache.load(), None);
    }

    #[test]
    fn protection_defaults_invalidate_bumps_epoch() {
        let before = super::protection_defaults_epoch();
        invalidate_protection_defaults();
        assert!(
            super::protection_defaults_epoch() > before,
            "every invalidation must advance the epoch so derived caches see a miss"
        );
    }

    #[test]
    fn protection_defaults_store_load_invalidate_round_trips() {
        // Reuses the process-global static, so scope this test to values it
        // fully owns (invalidate at start and end) to stay independent of
        // other tests' ordering.
        invalidate_protection_defaults();
        assert!(protection_defaults().load().is_none());

        store_protection_defaults(Arc::new(ProtectionDefaultsSnapshot {
            level: "protected".to_owned(),
            block_permanent_delete: true,
            categories: vec!["lights".to_owned()],
        }));
        let loaded = protection_defaults().load().expect("stored value must load");
        assert_eq!(loaded.level, "protected");

        invalidate_protection_defaults();
        assert!(protection_defaults().load().is_none());
    }

    // ── Per-instance isolation tests ─────────────────────────────────────

    #[test]
    fn protection_defaults_caches_instances_are_isolated() {
        use super::ProtectionDefaultsCaches;

        let a = ProtectionDefaultsCaches::new();
        let b = ProtectionDefaultsCaches::new();

        a.store(Arc::new(ProtectionDefaultsSnapshot {
            level: "protected".to_owned(),
            block_permanent_delete: true,
            categories: vec!["lights".to_owned()],
        }));

        assert!(b.load().is_none(), "instance B must not see A's store");
        assert_eq!(a.epoch(), 0, "A epoch starts at 0");
        assert_eq!(b.epoch(), 0, "B epoch starts at 0");

        a.invalidate();
        assert_eq!(a.epoch(), 1);
        assert_eq!(b.epoch(), 0, "B epoch must be independent of A");
    }
}
