//! `app_core`-owned cache statics (in-memory caching layer, F0 foundation).
//!
//! Each cache is a module-local process-global `OnceLock`, mirroring the
//! `ACTIVE_RUNS` pattern in [`crate::plan_apply`]. No central `AppCaches`
//! struct — see the caching layer plan's "Architecture" section for the
//! rationale (would churn every command signature; background tasks have no
//! `Tauri::State` handle anyway).
//!
//! This module defines the cache handles and their `pub invalidate_*` /
//! reader functions only. Wiring reads through the cache and calling
//! `invalidate_*` at write sites is downstream (W-ROOT, W-PROT) work.

use std::sync::{Arc, OnceLock};

use app_core_cache::{CacheConfig, SnapshotCache, TtlCache};

use crate::protection::GlobalProtection;

// ── library_root: root_id → path (`first_run.rs`) ──────────────────────────

/// `root_id` → resolved filesystem path. Capacity 256 (registered library
/// roots are few and long-lived), explicit-only invalidation (no TTL — a
/// remapped root must never silently resurface its old path).
///
/// Invalidate at `first_run::register_source` / `register_source_batch` /
/// `remap_root` for the affected `root_id`(s).
static LIBRARY_ROOT: OnceLock<TtlCache<String, String>> = OnceLock::new();

/// Return the process-global `library_root` cache (root_id → path).
pub fn library_root() -> &'static TtlCache<String, String> {
    LIBRARY_ROOT.get_or_init(|| TtlCache::new(CacheConfig::new(256)))
}

/// Remove the cached path for `root_id`. Call after any write that changes or
/// removes a root's recorded path (register, remap, remove).
pub fn invalidate_library_root(root_id: &str) {
    library_root().invalidate(&root_id.to_owned());
}

// ── source_protection_state: source_id → resolved protection (`protection.rs`) ──

/// `source_id` → resolved [`contracts_core::protection::SourceProtectionGetResponse`].
/// Capacity 8,192, explicit-only invalidation.
///
/// Invalidate at `protection::set_source_protection` (the affected
/// `source_id`) and `protection::seed_source_protection` (loop the affected
/// `source_id`s — `TtlCache` exposes no bulk-clear, so a "seed touches every
/// source" write invalidates each known id it just seeded).
static SOURCE_PROTECTION_STATE: OnceLock<
    TtlCache<String, contracts_core::protection::SourceProtectionGetResponse>,
> = OnceLock::new();

/// Return the process-global `source_protection_state` cache (source_id →
/// resolved protection).
pub fn source_protection_state(
) -> &'static TtlCache<String, contracts_core::protection::SourceProtectionGetResponse> {
    SOURCE_PROTECTION_STATE.get_or_init(|| TtlCache::new(CacheConfig::new(8_192)))
}

/// Remove the cached resolved protection for `source_id`.
pub fn invalidate_source_protection_state(source_id: &str) {
    source_protection_state().invalidate(&source_id.to_owned());
}

// ── protection defaults: global default level/categories (`protection.rs`) ──

/// Global protection defaults snapshot (`protection_defaults` table, scope
/// `"global"`), 1 slot.
///
/// Invalidate at `protection::set_global_protection_default` and via the
/// settings-bag fan-out (`app_core_settings::update_setting` /
/// `restore_defaults` for the `defaultProtection`/`blockPermanentDelete`/
/// `protectedCategories` keys) since defaults are also legacy-readable from
/// the `settings` table.
static PROTECTION_DEFAULTS: OnceLock<SnapshotCache<GlobalProtection>> = OnceLock::new();

/// Return the process-global protection-defaults snapshot cache.
///
/// `pub(crate)` (not `pub`): [`GlobalProtection`] itself is `pub(crate)` to
/// `app_core` (defined in `protection.rs`), so this accessor cannot be any
/// more public than its return type without also widening that struct's
/// visibility — every caller already lives inside this crate.
pub(crate) fn protection_defaults() -> &'static SnapshotCache<GlobalProtection> {
    PROTECTION_DEFAULTS.get_or_init(SnapshotCache::new)
}

/// Store a freshly loaded [`GlobalProtection`] snapshot.
#[allow(dead_code)] // called by the read-through load path once W-PROT wires it in
pub(crate) fn store_protection_defaults(value: Arc<GlobalProtection>) {
    protection_defaults().store(value);
}

/// Clear the protection-defaults snapshot so the next read reloads from the DB.
pub fn invalidate_protection_defaults() {
    protection_defaults().invalidate();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_root_cache_hit_then_invalidate_misses() {
        let cache = library_root();
        cache.insert("root-1".to_owned(), "/mnt/d/astro".to_owned());
        assert_eq!(cache.get(&"root-1".to_owned()), Some("/mnt/d/astro".to_owned()));

        invalidate_library_root("root-1");
        assert_eq!(cache.get(&"root-1".to_owned()), None);
    }

    #[test]
    fn source_protection_state_cache_hit_then_invalidate_misses() {
        use contracts_core::protection::{ProtectionLevel, SourceProtectionGetResponse};

        let cache = source_protection_state();
        let value = SourceProtectionGetResponse {
            source_id: Some("src-1".to_owned()),
            level: ProtectionLevel::Protected,
            block_permanent_delete: true,
            categories: vec!["lights".to_owned()],
            inherits_default: true,
        };
        cache.insert("src-1".to_owned(), value.clone());
        assert_eq!(cache.get(&"src-1".to_owned()).map(|v| v.source_id), Some(value.source_id));

        invalidate_source_protection_state("src-1");
        assert!(cache.get(&"src-1".to_owned()).is_none());
    }

    #[test]
    fn protection_defaults_store_load_invalidate_round_trips() {
        // Reuses the process-global static, so scope this test to values it
        // fully owns (invalidate at start and end) to stay independent of
        // other tests' ordering.
        invalidate_protection_defaults();
        assert!(protection_defaults().load().is_none());

        store_protection_defaults(Arc::new(GlobalProtection {
            level: "protected".to_owned(),
            block_permanent_delete: true,
            categories: vec!["lights".to_owned()],
        }));
        let loaded = protection_defaults().load().expect("stored value must load");
        assert_eq!(loaded.level, "protected");

        invalidate_protection_defaults();
        assert!(protection_defaults().load().is_none());
    }
}
