//! SIMBAD resolver adapter: delegates the network resolve to the published
//! `simbad-resolver` crate's [`simbad_resolver::TapResolver`] (its own
//! `reqwest`/TAP client, TSV parsing, and alias construction), converting
//! between astro-plan's stable local resolver types (unchanged public API
//! since spec 035 — every existing call site keeps compiling untouched) and
//! the crate's types at this boundary.
//!
//! [`SimbadResolver::resolve`] still performs the Caldwell translation
//! (FIX-2) itself: Caldwell is not a SIMBAD designation, and that translation
//! lives at the *backend-resolver* layer here (not the crate's higher-level
//! facade, which this crate does not use), matching prior behaviour exactly.

use async_trait::async_trait;

use crate::caldwell::{caldwell_to_designation, parse_caldwell_number};
use crate::{AliasKind, ResolveError, ResolvedAlias, ResolvedIdentity, Resolver, TargetSource};

/// Default SIMBAD TAP sync endpoint (CDS). Must match
/// [`simbad_resolver::SimbadConfig::default`]'s endpoint (asserted by
/// [`tests::default_endpoint_matches_upstream_crate`]).
pub const DEFAULT_TAP_ENDPOINT: &str = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";

/// Polite identifying `User-Agent` (CDS norm) for astro-plan's own requests
/// (distinct from the upstream crate's default; both identify politely).
pub const DEFAULT_USER_AGENT: &str = "astro-plan/0.1 (+https://github.com/; spec-035 resolver)";

/// Configuration for a [`SimbadResolver`] — a type alias for the upstream
/// crate's config (identical field shape: `endpoint`, `timeout`, `user_agent`).
pub type SimbadConfig = simbad_resolver::SimbadConfig;

/// Live SIMBAD resolver: the production [`Resolver`] implementation.
///
/// Thin wrapper over [`simbad_resolver::TapResolver`]; see the module doc for
/// why the Caldwell translation stays here rather than moving to the crate's
/// facade.
pub struct SimbadResolver(simbad_resolver::TapResolver);

impl SimbadResolver {
    /// Construct a resolver from a [`SimbadConfig`].
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the underlying `reqwest` client
    /// cannot be built (e.g. TLS backend init failure) or the endpoint is not
    /// a valid URL.
    pub fn new(config: &SimbadConfig) -> Result<Self, ResolveError> {
        simbad_resolver::TapResolver::new(config).map(Self).map_err(from_crate_error)
    }

    /// Convenience constructor using [`SimbadConfig::default`].
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the client cannot be built.
    pub fn with_defaults() -> Result<Self, ResolveError> {
        Self::new(&SimbadConfig::default())
    }
}

#[async_trait]
impl Resolver for SimbadResolver {
    async fn resolve(&self, query: &str) -> Result<ResolvedIdentity, ResolveError> {
        let query = query.trim();
        if query.is_empty() {
            return Err(ResolveError::NotFound(String::new()));
        }

        // FIX-2: Caldwell is NOT a SIMBAD designation. Translate a Caldwell query
        // (`C 14`, `Caldwell 14`) to its NGC/IC designation via the committed map,
        // resolve THAT, and attach the original `C n` as an alias. C99 (the
        // Coalsack) maps to None → NotFound (no single resolvable designation).
        let (simbad_query, caldwell_alias) = match parse_caldwell_number(query) {
            Some(n) => match caldwell_to_designation(n) {
                Some(desig) => (desig.to_owned(), Some(format!("C {n}"))),
                None => return Err(ResolveError::NotFound(query.to_owned())),
            },
            None => (query.to_owned(), None),
        };

        let mut identity = simbad_resolver::Resolver::resolve(&self.0, &simbad_query)
            .await
            .map(from_crate_identity)
            .map_err(from_crate_error)?;

        // FIX-2: bind the original Caldwell designation so future lookups of
        // `C n` are cache hits pointing at this object.
        if let Some(c) = &caldwell_alias {
            if !identity.aliases.iter().any(|a| &a.alias == c) {
                identity.aliases.push(ResolvedAlias::new(c.clone(), AliasKind::Designation));
            }
        }
        Ok(identity)
    }
}

/// A zero-cost [`Resolver`] that never reaches the network (FIX-3).
///
/// Used when online resolution is disabled in settings, so the command layer
/// can run the cache-first use case without constructing a `reqwest`/TLS client.
/// Every call reports [`ResolveError::Disabled`], which the use case maps to an
/// `unresolved("offline")` outcome (FR-015).
pub struct OfflineResolver;

#[async_trait]
impl Resolver for OfflineResolver {
    async fn resolve(&self, _query: &str) -> Result<ResolvedIdentity, ResolveError> {
        Err(ResolveError::Disabled)
    }
}

/// Shared SIMBAD `basic`-row TSV tokenizer, re-exported from the upstream
/// crate. `crates/tools/seed-builder` consumes this directly.
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
        aliases: i.aliases.into_iter().map(from_crate_alias).collect(),
        source: from_crate_source(i.source),
    }
}

fn from_crate_alias(a: simbad_resolver::ResolvedAlias) -> ResolvedAlias {
    ResolvedAlias { alias: a.alias, normalized: a.normalized, kind: from_crate_alias_kind(a.kind) }
}

fn from_crate_alias_kind(k: simbad_resolver::AliasKind) -> AliasKind {
    match k {
        simbad_resolver::AliasKind::Designation => AliasKind::Designation,
        simbad_resolver::AliasKind::CommonName => AliasKind::CommonName,
        simbad_resolver::AliasKind::User => AliasKind::User,
    }
}

fn from_crate_source(s: simbad_resolver::TargetSource) -> TargetSource {
    match s {
        simbad_resolver::TargetSource::Seed => TargetSource::Seed,
        simbad_resolver::TargetSource::Resolved => TargetSource::Resolved,
        simbad_resolver::TargetSource::UserOverride => TargetSource::UserOverride,
    }
}

fn from_crate_object_type(o: simbad_resolver::ObjectType) -> crate::ObjectType {
    // Both enums share the identical closed SIMBAD-otype vocabulary; round-trip
    // through the wire string so this stays correct even if variant order ever
    // diverges between the two independently-maintained enums.
    crate::ObjectType::from_wire(o.as_wire())
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

    #[test]
    fn resolver_builds_from_config() {
        let r = SimbadResolver::new(&SimbadConfig::default());
        assert!(r.is_ok());
    }

    #[tokio::test]
    async fn offline_resolver_always_disabled() {
        let err = OfflineResolver.resolve("M 31").await.unwrap_err();
        assert_eq!(err, ResolveError::Disabled);
    }

    // ── FIX-2: Caldwell query detection + translation ──────────────────────────

    #[test]
    fn caldwell_translates_to_resolvable_designation() {
        // C 14 → the Double Cluster (NGC 869) per the committed map.
        let n = parse_caldwell_number("C 14").unwrap();
        assert!(caldwell_to_designation(n).is_some());
        // C 99 (Coalsack) has no single resolvable designation → None.
        assert_eq!(caldwell_to_designation(99), None);
    }

    #[tokio::test]
    async fn empty_query_is_not_found_without_network() {
        let resolver = SimbadResolver::with_defaults().unwrap();
        let err = resolver.resolve("   ").await.unwrap_err();
        assert!(matches!(err, ResolveError::NotFound(_)));
    }

    #[tokio::test]
    async fn coalsack_caldwell_is_not_found_without_network() {
        // C99 has no NGC/IC designation — must short-circuit before any request.
        let resolver = SimbadResolver::with_defaults().unwrap();
        let err = resolver.resolve("C 99").await.unwrap_err();
        assert!(matches!(err, ResolveError::NotFound(_)));
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
