//! SIMBAD resolver adapter: delegates to the published `simbad-resolver`
//! crate's own [`simbad_resolver::SimbadResolver`] cache-first facade (spec
//! 052 P1, D1) rather than calling [`simbad_resolver::TapResolver`] directly.
//!
//! The facade owns cache-first resolution (persistent redb, [`ResolveCache`]),
//! Caldwell translation, and (from 0.2.0) `v_mag` enrichment; this module is a
//! thin boundary converting between astro-plan's stable local resolver types
//! (unchanged public API since spec 035 — every existing call site keeps
//! compiling untouched) and the crate's types.
//!
//! ## Cache lifetime (D2 — one global redb file, no TTL)
//!
//! [`ResolveCache`] wraps the crate's [`simbad_resolver::Store`] (an `Arc`
//! handle over one open `redb::Database`) and is opened ONCE at app startup
//! (`<app_data>/simbad-cache.redb`); every [`SimbadResolver`] built afterward
//! (settings changes rebuild the resolver, e.g. after `target.resolution
//! .settings.update`) shares that same store via a cheap clone
//! ([`CacheBackend::custom`]) instead of re-opening the file.

use async_trait::async_trait;
use simbad_resolver::{CacheBackend, ResolverConfig};

use crate::{AliasKind, ResolveError, ResolvedAlias, ResolvedIdentity, Resolver, TargetSource};

/// Default SIMBAD TAP sync endpoint (CDS). Must match
/// [`simbad_resolver::SimbadConfig::default`]'s endpoint (asserted by
/// [`tests::default_endpoint_matches_upstream_crate`]).
pub const DEFAULT_TAP_ENDPOINT: &str = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";

/// Polite identifying `User-Agent` (CDS norm) for astro-plan's own requests
/// (distinct from the upstream crate's default; both identify politely).
pub const DEFAULT_USER_AGENT: &str = "astro-plan/0.1 (+https://github.com/; spec-035 resolver)";

/// The id-namespace seed used to derive stable target ids from a designation.
/// MUST match `targeting::identity`'s hardcoded `"astro-plan.targets"` seed
/// exactly (asserted by
/// [`tests::namespace_matches_sqlite_identity_derivation`]) so a redb-cache id
/// and the SQLite id later written for the same designation by
/// `crate::cache::upsert_resolved` are bit-identical — the in-use "promote
/// from cache" write never needs to special-case ids.
const NAMESPACE_SEED: &str = "astro-plan.targets";

/// Configuration for a [`SimbadResolver`] — a type alias for the upstream
/// crate's config (identical field shape: `endpoint`, `timeout`, `user_agent`).
pub type SimbadConfig = simbad_resolver::SimbadConfig;

/// A shared handle to the persistent SIMBAD resolve cache (spec 052 P1 D2: one
/// global redb file, no TTL, warmed from the bundled seed + existing
/// `canonical_target` rows — see [`crate::seed`]).
///
/// Cloning is cheap (an `Arc` over one `redb::Database`, mirroring
/// [`simbad_resolver::Store`]); open it once at app startup and clone it into
/// every [`SimbadResolver`] built afterward.
#[derive(Clone)]
pub struct ResolveCache(simbad_resolver::Store);

impl ResolveCache {
    /// Open (creating if missing) the durable, file-backed resolve cache at
    /// `path`.
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the redb file cannot be opened or
    /// its tables cannot be initialised.
    pub fn open(path: impl AsRef<std::path::Path>) -> Result<Self, ResolveError> {
        simbad_resolver::Store::open(path).map(Self).map_err(from_cache_error)
    }

    /// An ephemeral, in-memory resolve cache (nothing persisted) — for tests
    /// and offline-only construction.
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the in-memory store cannot be
    /// created.
    pub fn in_memory() -> Result<Self, ResolveError> {
        simbad_resolver::Store::in_memory().map(Self).map_err(from_cache_error)
    }

    /// Borrow the crate's own [`simbad_resolver::Cache`] trait object (e.g. for
    /// [`crate::seed`] warming or a "clear resolve cache" action).
    #[must_use]
    pub fn cache(&self) -> impl simbad_resolver::Cache + 'static {
        self.0.cache()
    }
}

/// Either a live network resolver or a zero-cost stub, selected once at
/// [`SimbadResolver::new`] by the caller's `online_enabled` flag.
///
/// This exists so the facade never has to construct a `reqwest`/TLS client
/// when online resolution is disabled (mirroring the pre-052 FIX-3 concern —
/// client construction itself can fail), while STILL getting a cache-first
/// hit from the shared [`ResolveCache`] in offline mode (FR-006/FR-018: "a
/// cached/seeded object is never re-queried", regardless of the online
/// setting).
enum EitherNetworkResolver {
    Online(simbad_resolver::TapResolver),
    Offline(simbad_resolver::OfflineResolver),
}

#[async_trait]
impl simbad_resolver::Resolver for EitherNetworkResolver {
    async fn resolve(
        &self,
        query: &str,
    ) -> Result<simbad_resolver::ResolvedIdentity, simbad_resolver::ResolveError> {
        match self {
            Self::Online(r) => simbad_resolver::Resolver::resolve(r, query).await,
            Self::Offline(r) => simbad_resolver::Resolver::resolve(r, query).await,
        }
    }
}

/// Live SIMBAD resolver: the production [`Resolver`] implementation.
///
/// Wraps the crate's own cache-first [`simbad_resolver::SimbadResolver`]
/// facade (see the module doc for why astro-plan no longer calls
/// `TapResolver` directly).
pub struct SimbadResolver(simbad_resolver::SimbadResolver<EitherNetworkResolver>);

impl SimbadResolver {
    /// Construct a resolver from a [`SimbadConfig`] and a shared
    /// [`ResolveCache`].
    ///
    /// When `online_enabled` is `false`, no `reqwest`/TLS client is built at
    /// all (`config` is simply unused for that call) — cache hits still
    /// resolve locally, and a miss reports an offline-shaped unresolved
    /// outcome (never touches the network).
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the underlying `reqwest` client
    /// cannot be built (e.g. TLS backend init failure) or the endpoint is not
    /// a valid URL.
    pub fn new(
        config: &SimbadConfig,
        cache: &ResolveCache,
        online_enabled: bool,
    ) -> Result<Self, ResolveError> {
        let inner = if online_enabled {
            EitherNetworkResolver::Online(
                simbad_resolver::TapResolver::new(config).map_err(from_crate_error)?,
            )
        } else {
            EitherNetworkResolver::Offline(simbad_resolver::OfflineResolver)
        };
        let resolver_config = ResolverConfig::new(NAMESPACE_SEED).with_online(online_enabled);
        let facade = simbad_resolver::SimbadResolver::new(
            inner,
            CacheBackend::custom(cache.cache()),
            resolver_config,
        )
        .map_err(from_facade_error)?;
        Ok(Self(facade))
    }

    /// Convenience constructor using [`SimbadConfig::default`] and an
    /// ephemeral in-memory cache. Test-only in practice (production always
    /// shares the app-data-rooted [`ResolveCache`] via [`Self::new`]).
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the client or cache cannot be built.
    pub fn with_defaults() -> Result<Self, ResolveError> {
        Self::new(&SimbadConfig::default(), &ResolveCache::in_memory()?, true)
    }

    /// Local, network-free typeahead search over the shared redb cache
    /// (`target.search`, FR-005) — exact/prefix/substring ranked, capped at
    /// `limit`.
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] on a cache backend failure.
    pub async fn search(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<simbad_resolver::SearchHit>, ResolveError> {
        self.0.search(query, limit).await.map_err(from_facade_error)
    }
}

#[async_trait]
impl Resolver for SimbadResolver {
    async fn resolve(&self, query: &str) -> Result<ResolvedIdentity, ResolveError> {
        let query = query.trim();
        if query.is_empty() {
            return Err(ResolveError::NotFound(String::new()));
        }

        // Caldwell translation, cache-first check (redb), and the online-gate
        // now all live inside the facade's own `resolve_core` (D1) — this
        // wrapper only converts the outcome back to astro-plan's local types.
        match self.0.resolve(query).await {
            Ok(simbad_resolver::Resolution::Resolved(cached)) => {
                Ok(from_crate_identity(cached.to_identity()))
            }
            Ok(simbad_resolver::Resolution::Unresolved { query, reason }) => {
                Err(from_unresolved_reason(query, reason))
            }
            Err(e) => Err(from_facade_error(e)),
        }
    }
}

/// A zero-cost [`Resolver`] that never reaches the network (FIX-3).
///
/// Used when online resolution is disabled in settings, so the command layer
/// can run the cache-first use case without constructing a `reqwest`/TLS
/// client. Every call reports [`ResolveError::Disabled`], which the use case
/// maps to an `unresolved("offline")` outcome (FR-015). Distinct from
/// [`SimbadResolver::new`]'s internal `online_enabled = false` path (which
/// STILL cache-checks via the shared [`ResolveCache`]); this stub carries no
/// cache at all and is used by callers with no cache handle in scope (e.g.
/// the background-drain's client-build-failure fallback).
pub struct OfflineResolver;

#[async_trait]
impl Resolver for OfflineResolver {
    async fn resolve(&self, _query: &str) -> Result<ResolvedIdentity, ResolveError> {
        Err(ResolveError::Disabled)
    }
}

/// Shared SIMBAD `basic`-row TSV tokenizer, re-exported from the upstream
/// crate. `crates/tools/seed-builder` consumes this directly. 0.2.0 widens the
/// tuple to `(oid, main_id, ra, dec, otype, v_mag)`.
pub use simbad_resolver::wire::parse_basic_row;

// ── Boundary conversions (crate ⇄ astro-plan local types) ───────────────────

/// Convert the upstream crate's `ResolveError` to astro-plan's local
/// `ResolveError` — the variants are identical 1:1, this crate's copy predates
/// (and stays independent of) the published crate's error type.
fn from_crate_error(e: simbad_resolver::ResolveError) -> ResolveError {
    match e {
        simbad_resolver::ResolveError::Network(s) => ResolveError::Network(s),
        simbad_resolver::ResolveError::Timeout(s) => ResolveError::Timeout(s),
        simbad_resolver::ResolveError::Disabled => ResolveError::Disabled,
        simbad_resolver::ResolveError::NotFound(s) => ResolveError::NotFound(s),
        simbad_resolver::ResolveError::Ambiguous { query, count } => {
            ResolveError::Ambiguous { query, count }
        }
        simbad_resolver::ResolveError::Parse(s) => ResolveError::Parse(s),
    }
}

/// Map a facade [`simbad_resolver::UnresolvedReason`] to astro-plan's local
/// `ResolveError`, preserving the exact grouping every existing caller already
/// matches on (`target_resolve::resolve`'s `Network|Timeout|Disabled` →
/// `"offline"`, `NotFound|Parse` → `"unknown"`, `Ambiguous` → `"ambiguous"`).
/// `Ambiguous`'s `count` is not carried by the facade's reason — `0` is a safe
/// placeholder, matched only structurally downstream, never displayed.
fn from_unresolved_reason(
    query: String,
    reason: simbad_resolver::UnresolvedReason,
) -> ResolveError {
    match reason {
        simbad_resolver::UnresolvedReason::Offline => ResolveError::Network(query),
        simbad_resolver::UnresolvedReason::Unknown => ResolveError::NotFound(query),
        simbad_resolver::UnresolvedReason::Ambiguous => ResolveError::Ambiguous { query, count: 0 },
    }
}

/// Map a facade-level [`simbad_resolver::Error`] (cache/queue backend
/// failure — NOT a normal not-found/ambiguous/offline outcome, those are
/// [`simbad_resolver::Resolution::Unresolved`]) to astro-plan's local
/// `ResolveError`. Treated as transient/offline: a local cache hiccup should
/// degrade gracefully, never crash `target.resolve`.
fn from_facade_error(e: simbad_resolver::Error) -> ResolveError {
    ResolveError::Network(e.to_string())
}

/// Map a cache-backend-only error (cache open/init) to astro-plan's local
/// `ResolveError`.
fn from_cache_error(e: simbad_resolver::CacheError) -> ResolveError {
    ResolveError::Network(e.to_string())
}

/// Convert the upstream crate's `ResolvedIdentity` to astro-plan's local
/// `ResolvedIdentity`, dropping the crate's `otype_raw` escape-hatch field:
/// astro-plan's `canonical_target` schema has no column for it and nothing in
/// this codebase reads it (kept local type has no such field, by design — see
/// module doc).
fn from_crate_identity(i: simbad_resolver::ResolvedIdentity) -> ResolvedIdentity {
    ResolvedIdentity {
        simbad_oid: i.simbad_oid,
        primary_designation: i.primary_designation,
        common_name: i.common_name,
        object_type: from_crate_object_type(i.object_type),
        ra_deg: i.ra_deg,
        dec_deg: i.dec_deg,
        v_mag: i.v_mag,
        aliases: i.aliases.into_iter().map(from_crate_alias).collect(),
        source: from_crate_source(i.source),
    }
}

fn from_crate_alias(a: simbad_resolver::ResolvedAlias) -> ResolvedAlias {
    ResolvedAlias { alias: a.alias, normalized: a.normalized, kind: from_crate_alias_kind(a.kind) }
}

pub(crate) fn from_crate_alias_kind(k: simbad_resolver::AliasKind) -> AliasKind {
    match k {
        simbad_resolver::AliasKind::Designation => AliasKind::Designation,
        simbad_resolver::AliasKind::CommonName => AliasKind::CommonName,
        simbad_resolver::AliasKind::User => AliasKind::User,
    }
}

pub(crate) fn from_crate_source(s: simbad_resolver::TargetSource) -> TargetSource {
    match s {
        simbad_resolver::TargetSource::Seed => TargetSource::Seed,
        simbad_resolver::TargetSource::Resolved => TargetSource::Resolved,
        simbad_resolver::TargetSource::UserOverride => TargetSource::UserOverride,
    }
}

pub(crate) fn from_crate_object_type(o: simbad_resolver::ObjectType) -> crate::ObjectType {
    // Both enums share the identical closed SIMBAD-otype vocabulary; round-trip
    // through the wire string so this stays correct even if variant order ever
    // diverges between the two independently-maintained enums.
    crate::ObjectType::from_wire(o.as_wire())
}

/// Convert a crate-side [`simbad_resolver::CachedTarget`] (redb cache read
/// model) to astro-plan's local `cache::CachedTarget` shape, for the
/// `target.search` typeahead path (spec 052 P1 D1: search reads the shared
/// redb cache via [`SimbadResolver::search`], not SQLite).
///
/// `display_alias` is always `None`: it is a SQLite-only, user-owned field
/// (FR-012) with no redb-cache equivalent — a pure search hit is, by
/// definition, not yet an adopted/in-use target.
pub fn from_crate_cached_target(t: simbad_resolver::CachedTarget) -> crate::cache::CachedTarget {
    crate::cache::CachedTarget {
        id: t.id,
        simbad_oid: t.simbad_oid,
        primary_designation: t.primary_designation,
        display_alias: None,
        object_type: from_crate_object_type(t.object_type),
        ra_deg: t.ra_deg,
        dec_deg: t.dec_deg,
        source: from_crate_source(t.source),
        resolved_at: t.resolved_at,
        aliases: t.aliases.into_iter().map(from_crate_alias).collect(),
    }
}

/// Convert a crate-side [`simbad_resolver::SearchHit`] to astro-plan's local
/// `cache::SearchHit`.
pub fn from_crate_search_hit(h: simbad_resolver::SearchHit) -> crate::cache::SearchHit {
    crate::cache::SearchHit {
        target: from_crate_cached_target(h.target),
        matched_alias: h.matched_alias,
        rank: h.rank,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_endpoint_matches_upstream_crate() {
        assert_eq!(DEFAULT_TAP_ENDPOINT, simbad_resolver::SimbadConfig::default().endpoint);
    }

    #[test]
    fn config_from_settings_clamps_timeout() {
        let c = SimbadConfig::from_settings("https://example/tap", 0);
        assert_eq!(c.timeout, std::time::Duration::from_secs(1));
        assert_eq!(c.endpoint, "https://example/tap");
    }

    /// D2/D8 interop: the redb-cache namespace seed used here MUST match
    /// `targeting::identity`'s hardcoded namespace exactly, so a target
    /// resolved from the redb cache and later promoted to `canonical_target`
    /// (`crate::cache::upsert_resolved`, which calls
    /// `targeting::identity::target_id_from_designation`) gets the SAME id
    /// both times — the in-use write never needs to special-case ids.
    #[test]
    fn namespace_matches_sqlite_identity_derivation() {
        let facade_ns = simbad_resolver::identity::namespace(NAMESPACE_SEED);
        assert_eq!(facade_ns, targeting::identity::target_namespace());

        let facade_id = simbad_resolver::identity::target_id_from_designation(&facade_ns, "M 31");
        let sqlite_id = targeting::identity::target_id_from_designation("M 31");
        assert_eq!(facade_id, sqlite_id);
    }

    #[test]
    fn resolver_builds_from_config_online_and_offline() {
        let cache = ResolveCache::in_memory().unwrap();
        assert!(SimbadResolver::new(&SimbadConfig::default(), &cache, true).is_ok());
        assert!(SimbadResolver::new(&SimbadConfig::default(), &cache, false).is_ok());
    }

    #[tokio::test]
    async fn offline_resolver_always_disabled() {
        let err = OfflineResolver.resolve("M 31").await.unwrap_err();
        assert_eq!(err, ResolveError::Disabled);
    }

    // ── FIX-2: Caldwell query detection + translation (now facade-internal) ────

    #[tokio::test]
    async fn empty_query_is_not_found_without_network() {
        let cache = ResolveCache::in_memory().unwrap();
        let resolver = SimbadResolver::new(&SimbadConfig::default(), &cache, true).unwrap();
        let err = resolver.resolve("   ").await.unwrap_err();
        assert!(matches!(err, ResolveError::NotFound(_)));
    }

    #[tokio::test]
    async fn coalsack_caldwell_is_not_found_without_network() {
        // C99 has no NGC/IC designation — the facade's Caldwell branch must
        // short-circuit before any request, offline resolver included.
        let cache = ResolveCache::in_memory().unwrap();
        let resolver = SimbadResolver::new(&SimbadConfig::default(), &cache, false).unwrap();
        let err = resolver.resolve("C 99").await.unwrap_err();
        assert!(matches!(err, ResolveError::NotFound(_)));
    }

    #[tokio::test]
    async fn offline_mode_cache_hit_resolves_without_network() {
        // FR-006/FR-018: a cache hit must resolve even when online is
        // disabled (EitherNetworkResolver::Offline never touches the network).
        // Seed the shared cache directly via its Cache trait (no live TAP
        // access from this offline test).
        let cache = ResolveCache::in_memory().unwrap();
        let identity = simbad_resolver::ResolvedIdentity {
            simbad_oid: Some(1_575_544),
            primary_designation: "M 31".to_owned(),
            common_name: None,
            object_type: simbad_resolver::ObjectType::Galaxy,
            otype_raw: "G".to_owned(),
            ra_deg: 10.684_708,
            dec_deg: 41.268_75,
            v_mag: Some(3.44),
            aliases: vec![simbad_resolver::ResolvedAlias::new(
                "M 31",
                simbad_resolver::AliasKind::Designation,
            )],
            source: simbad_resolver::TargetSource::Resolved,
        };
        let ns = simbad_resolver::identity::namespace(NAMESPACE_SEED);
        simbad_resolver::Cache::upsert(&cache.cache(), &identity, &ns).await.unwrap();

        let resolver = SimbadResolver::new(&SimbadConfig::default(), &cache, false).unwrap();
        let got = resolver.resolve("M 31").await.unwrap();
        assert_eq!(got.primary_designation, "M 31");
        assert_eq!(got.v_mag, Some(3.44));
    }

    #[test]
    fn error_conversion_preserves_variant_and_payload() {
        assert_eq!(
            from_crate_error(simbad_resolver::ResolveError::Timeout(7)),
            ResolveError::Timeout(7)
        );
        assert_eq!(
            from_crate_error(simbad_resolver::ResolveError::Ambiguous {
                query: "x".to_owned(),
                count: 2
            }),
            ResolveError::Ambiguous { query: "x".to_owned(), count: 2 }
        );
    }

    #[test]
    fn object_type_conversion_round_trips_every_variant() {
        for wire in [
            "galaxy",
            "planetary_nebula",
            "emission_nebula",
            "reflection_nebula",
            "dark_nebula",
            "open_cluster",
            "globular_cluster",
            "supernova_remnant",
            "galaxy_cluster",
            "double_star",
            "asterism",
            "other",
        ] {
            let crate_ot = simbad_resolver::ObjectType::from_wire(wire);
            assert_eq!(from_crate_object_type(crate_ot).as_wire(), wire);
        }
    }
}
