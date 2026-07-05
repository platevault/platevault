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
//! `crates/app/projects/src/project_health.rs`'s `DebounceTable` is a valid,
//! working, hand-rolled equivalent of [`DebounceCache`] here. Spec 051 does
//! **not** require migrating it — that is a pure refactor with no
//! user-facing effect, tracked as a non-blocking follow-up (see
//! `specs/051-tauri-shell-integration/research.md` §(d), "Consumers").
//!
//! ## What this crate provides
//!
//! - [`TtlCache`]: a generic, size- and TTL-bounded cache with a
//!   single-flight get-or-insert (`get_or_insert_with`).
//! - [`DebounceCache`]: a presence-only cache (mirrors
//!   `project_health::DebounceTable`) for suppressing repeated signals within
//!   a time window, generic over the debounce key.

use std::hash::Hash;
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
/// window — the generic form of
/// `crates/app/projects/src/project_health.rs`'s `DebounceTable`.
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

    /// Force-expire the entry for `key` (test-only escape hatch for
    /// simulating elapsed time without sleeping).
    #[cfg(test)]
    pub fn expire(&self, key: &K) {
        self.last_emitted.invalidate(key);
    }
}

#[cfg(test)]
mod tests {
    use std::thread;
    use std::time::Duration;

    use super::{CacheConfig, DebounceCache, TtlCache};

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
        debounce.expire(&"a".to_owned());
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
}
