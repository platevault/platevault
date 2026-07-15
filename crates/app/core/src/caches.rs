// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `app_core`-owned cache statics (in-memory caching layer, F0 foundation).
//!
//! Each cache is a module-local process-global `OnceLock`, mirroring the
//! `ACTIVE_RUNS` pattern in [`crate::plan_apply`]. No central `AppCaches`
//! struct — see the caching layer plan's "Architecture" section for the
//! rationale (would churn every command signature; background tasks have no
//! `Tauri::State` handle anyway).
//!
//! This module defines the `library_root` and `source_protection_state`
//! cache handles and their `pub invalidate_*` / reader functions; read-through
//! + invalidation wiring lives at their call sites in `first_run.rs` /
//! `protection.rs` / `plan_apply.rs`. The `protection_defaults` cache is
//! defined in `app_core_cache` instead (see the note below) because
//! `app_core_settings` must also be able to invalidate it.

use std::sync::OnceLock;

use app_core_cache::{CacheConfig, TtlCache};

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

/// `source_id` → resolved [`contracts_core::protection::SourceProtectionGetResponse`],
/// tagged with the `app_core_cache::protection_defaults_epoch` it was resolved
/// under. Capacity 8,192, explicit-only invalidation.
///
/// Resolved responses embed values inherited from the global defaults (the
/// level for inheriting sources; `block_permanent_delete`/categories even for
/// overridden ones), so an entry is only valid for the defaults epoch it was
/// resolved under — readers must treat an epoch mismatch as a miss (issue
/// #563: a global-defaults change otherwise left stale per-source answers
/// here forever, since this cache has no TTL and `app_core_settings` cannot
/// invalidate it without a dependency cycle).
///
/// Invalidate at `protection::set_source_protection` (the affected
/// `source_id`) and `protection::seed_source_protection` (loop the affected
/// `source_id`s — `TtlCache` exposes no bulk-clear, so a "seed touches every
/// source" write invalidates each known id it just seeded).
static SOURCE_PROTECTION_STATE: OnceLock<
    TtlCache<String, (u64, contracts_core::protection::SourceProtectionGetResponse)>,
> = OnceLock::new();

/// Return the process-global `source_protection_state` cache (source_id →
/// (defaults epoch, resolved protection)).
pub fn source_protection_state(
) -> &'static TtlCache<String, (u64, contracts_core::protection::SourceProtectionGetResponse)> {
    SOURCE_PROTECTION_STATE.get_or_init(|| TtlCache::new(CacheConfig::new(8_192)))
}

/// Remove the cached resolved protection for `source_id`.
pub fn invalidate_source_protection_state(source_id: &str) {
    source_protection_state().invalidate(&source_id.to_owned());
}

// Note: the `protection_defaults` global-defaults snapshot cache lives in
// `app_core_cache` (`app_core_cache::protection_defaults` /
// `invalidate_protection_defaults`), not here — `app_core_settings` also
// needs to invalidate it, and `app_core` depends on `app_core_settings`, so
// keeping it in this crate would create a cycle. See `protection.rs` for the
// read-through wiring.

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
        cache.insert("src-1".to_owned(), (0, value.clone()));
        assert_eq!(cache.get(&"src-1".to_owned()).map(|(_, v)| v.source_id), Some(value.source_id));

        invalidate_source_protection_state("src-1");
        assert!(cache.get(&"src-1".to_owned()).is_none());
    }
}
