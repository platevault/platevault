//! `target.cache.clear` support (spec 052 P1 FR-002): wipe the shared redb
//! resolve cache and re-warm it from the bundled seed + existing durable
//! `canonical_target` rows. Never touches `canonical_target` itself — the
//! redb cache is an explicitly reproducible projection (constitution §V).
//!
//! `simbad_resolver::Cache` exposes no delete-all primitive, so "clear" is
//! file-level: drop every handle to the old redb `Database`, delete the file,
//! reopen, re-warm. [`AppState::resolve_cache`]'s write lock ensures no new
//! reader starts mid-swap; a reader that already cloned the handle just
//! before the swap keeps working against the (now-orphaned) old file until it
//! finishes, which is why the old handle is dropped before the file delete —
//! a concurrent straggler can still transiently make the delete fail on
//! Windows (sharing violation), surfaced as an error rather than silently
//! leaving a stale cache in place.

use contracts_core::ContractError;

use crate::commands::lifecycle::AppState;

/// Namespace seed for redb-cache ids — MUST match
/// `targeting_resolver::simbad`'s production seed exactly (asserted there by
/// `namespace_matches_sqlite_identity_derivation`) so re-warmed ids stay
/// consistent with anything already promoted to `canonical_target`.
const NAMESPACE_SEED: &str = "astro-plan.targets";

/// Open the shared redb resolve cache at `path` (creating it if missing).
///
/// Falls back to an ephemeral in-memory cache on failure (e.g. a corrupt or
/// unwritable file) rather than hard-crashing startup — the app still works,
/// just without a persistent typeahead cache until the next restart.
#[must_use]
pub fn open_or_in_memory(path: &std::path::Path) -> targeting_resolver::simbad::ResolveCache {
    targeting_resolver::simbad::ResolveCache::open(path).unwrap_or_else(|e| {
        tracing::warn!(
            path = %path.display(),
            "failed to open the resolve cache file, falling back to in-memory: {e}"
        );
        targeting_resolver::simbad::ResolveCache::in_memory()
            .expect("in-memory resolve cache must never fail to construct")
    })
}

/// Clear and re-warm the shared resolve cache. Returns the number of entries
/// the fresh cache was re-warmed with (bundled seed + durable rows).
///
/// # Errors
///
/// Returns [`ContractError`] (`internal.database`) if the old file cannot be
/// removed or the fresh cache cannot be opened/warmed.
pub async fn clear_and_rewarm(state: &AppState) -> Result<usize, ContractError> {
    let mut guard = state.resolve_cache.write().await;

    // Drop every handle this process holds on the old file BEFORE touching
    // it on disk (Windows locks a memory-mapped file exclusively).
    *guard = targeting_resolver::simbad::ResolveCache::in_memory()
        .map_err(|e| ContractError::internal(e.to_string()))?;

    if let Err(e) = std::fs::remove_file(&state.resolve_cache_path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(ContractError::internal(format!(
                "failed to remove the resolve cache file: {e}"
            )));
        }
    }

    let fresh = targeting_resolver::simbad::ResolveCache::open(&state.resolve_cache_path)
        .map_err(|e| ContractError::internal(e.to_string()))?;
    let namespace = simbad_resolver::identity::namespace(NAMESPACE_SEED);
    let cache = fresh.cache();

    let seed_count = targeting_resolver::seed::warm_bundled_on_first_run(&cache, &namespace)
        .await
        .map_err(|e| ContractError::internal(e.to_string()))?
        .unwrap_or(0);
    let durable_count = targeting_resolver::seed::warm_from_canonical_target(
        &cache,
        state.repo.pool(),
        &namespace,
    )
    .await
    .map_err(|e| ContractError::internal(e.to_string()))?;

    *guard = fresh;
    Ok(seed_count + durable_count)
}
