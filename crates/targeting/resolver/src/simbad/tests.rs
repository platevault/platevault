// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::Arc;

use simbad_resolver::{CacheBackend, ResolverConfig};

use crate::{ResolveError, Resolver};

use super::convert::{from_crate_error, from_crate_object_type};
use super::network_resolvers::DualLookupResolver;
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

// ── spec 052 P2: TAP-first / Sesame-fallback dual lookup ────────────────────

fn m31_identity() -> simbad_resolver::ResolvedIdentity {
    simbad_resolver::ResolvedIdentity {
        simbad_oid: Some(1_575_544),
        primary_designation: "M 31".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
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
    }
}

/// A coarse Sesame hit that TAP re-enrichment could not place an oid on
/// (FR-010's "still none" branch) — `simbad_oid: None`.
fn sesame_coarse_identity(designation: &str) -> simbad_resolver::ResolvedIdentity {
    simbad_resolver::ResolvedIdentity {
        simbad_oid: None,
        primary_designation: designation.to_owned(),
        common_name: None,
        object_type: simbad_resolver::ObjectType::Other,
        otype_raw: String::new(),
        ra_deg: 5.0,
        dec_deg: -3.0,
        v_mag: None,
        aliases: vec![simbad_resolver::ResolvedAlias::new(
            designation,
            simbad_resolver::AliasKind::Designation,
        )],
        source: simbad_resolver::TargetSource::Resolved,
    }
}

#[tokio::test]
async fn dual_lookup_tap_hit_never_calls_sesame() {
    let tap = simbad_resolver::FakeResolver::new().with_response("M 31", m31_identity());
    let sesame =
        simbad_resolver::FakeResolver::new().with_response("M 31", sesame_coarse_identity("M 31"));
    let dual = DualLookupResolver::new(Arc::new(tap), sesame);

    let got = simbad_resolver::Resolver::resolve(&dual, "M 31").await.unwrap();
    assert_eq!(got.simbad_oid, Some(1_575_544));
    assert_eq!(dual.sesame.call_count(), 0, "a TAP hit must never consult Sesame (FR-008)");
}

#[tokio::test]
async fn dual_lookup_tap_miss_falls_back_to_sesame() {
    let tap = simbad_resolver::FakeResolver::new().with_error(
        "Coarse Object",
        simbad_resolver::ResolveError::NotFound("Coarse Object".to_owned()),
    );
    let sesame = simbad_resolver::FakeResolver::new()
        .with_response("Coarse Object", sesame_coarse_identity("Coarse Object"));
    let dual = DualLookupResolver::new(Arc::new(tap), sesame);

    let got = simbad_resolver::Resolver::resolve(&dual, "Coarse Object").await.unwrap();
    assert_eq!(got.primary_designation, "Coarse Object");
    assert_eq!(dual.sesame.call_count(), 1, "a TAP miss must fall back to Sesame exactly once");
}

#[tokio::test]
async fn dual_lookup_transient_tap_error_does_not_fall_back() {
    // A `Network`/`Timeout`/`Ambiguous` TAP outcome is not a "no match" —
    // only `NotFound` triggers the Sesame fallback (FR-008's literal
    // "returns no match").
    let tap = simbad_resolver::FakeResolver::new()
        .with_error("M 31", simbad_resolver::ResolveError::Timeout(5));
    let sesame = simbad_resolver::FakeResolver::new().with_response("M 31", m31_identity());
    let dual = DualLookupResolver::new(Arc::new(tap), sesame);

    let err = simbad_resolver::Resolver::resolve(&dual, "M 31").await.unwrap_err();
    assert!(matches!(err, simbad_resolver::ResolveError::Timeout(5)));
    assert_eq!(dual.sesame.call_count(), 0);
}

#[tokio::test]
async fn typeahead_facade_never_invokes_sesame_but_explicit_falls_back_on_miss() {
    // FR-009: the same TAP-miss query, run through a typeahead-shaped
    // facade (bare TAP resolver — matching what `EitherNetworkResolver`
    // wraps, no Sesame reference exists to call) vs an explicit-shaped
    // facade (`DualLookupResolver`).
    let query = "NGC-Unknown";
    let miss = || simbad_resolver::ResolveError::NotFound(query.to_owned());

    let typeahead_tap = simbad_resolver::FakeResolver::new().with_error(query, miss());
    let typeahead_facade = simbad_resolver::SimbadResolver::new(
        typeahead_tap,
        CacheBackend::InMemory,
        ResolverConfig::new("test.typeahead"),
    )
    .unwrap();
    let outcome = typeahead_facade.resolve(query).await.unwrap();
    assert!(matches!(outcome, simbad_resolver::Resolution::Unresolved { .. }));

    let explicit_tap = simbad_resolver::FakeResolver::new().with_error(query, miss());
    let explicit_sesame =
        simbad_resolver::FakeResolver::new().with_response(query, sesame_coarse_identity(query));
    let dual = DualLookupResolver::new(Arc::new(explicit_tap), explicit_sesame);
    let explicit_facade = simbad_resolver::SimbadResolver::new(
        dual,
        CacheBackend::InMemory,
        ResolverConfig::new("test.explicit"),
    )
    .unwrap();
    let outcome = explicit_facade.resolve(query).await.unwrap();
    let simbad_resolver::Resolution::Resolved(target) = outcome else {
        panic!("explicit resolve must fall back to Sesame on a TAP miss");
    };
    assert_eq!(target.primary_designation, query);
    assert_eq!(
        explicit_facade.resolver().sesame.call_count(),
        1,
        "only the explicit-shaped facade may invoke Sesame"
    );
}

#[tokio::test]
async fn sesame_hit_without_oid_still_dedups_via_designation_fallback() {
    // FR-010/FR-007: a Sesame hit that never recovered an oid still
    // dedups — via the facade's own `Cache::upsert` UUIDv5-from-designation
    // fallback — with a second alias of the same physical object.
    let cache = ResolveCache::in_memory().unwrap();
    let ns_seed = "test.oid-recovery";
    let config = ResolverConfig::new(ns_seed);

    let dual1 = DualLookupResolver::new(
        Arc::new(simbad_resolver::FakeResolver::new().with_error(
            "Coarse Object",
            simbad_resolver::ResolveError::NotFound("Coarse Object".to_owned()),
        )),
        simbad_resolver::FakeResolver::new()
            .with_response("Coarse Object", sesame_coarse_identity("Coarse Object")),
    );
    let facade1 = simbad_resolver::SimbadResolver::new(
        dual1,
        CacheBackend::custom(cache.cache()),
        config.clone(),
    )
    .unwrap();
    let simbad_resolver::Resolution::Resolved(first) =
        facade1.resolve("Coarse Object").await.unwrap()
    else {
        panic!("expected a Sesame-recovered resolve");
    };
    assert_eq!(first.simbad_oid, None, "coarse Sesame hit carries no oid here");
    let expected_id = simbad_resolver::identity::target_id_from_designation(
        &simbad_resolver::identity::namespace(ns_seed),
        &first.primary_designation,
    );
    assert_eq!(first.id, expected_id);

    // A second alias of the SAME physical object (Sesame always answers
    // with the same canonical designation) resolves independently and
    // MUST land on the identical id — no split identity.
    let dual2 = DualLookupResolver::new(
        Arc::new(simbad_resolver::FakeResolver::new().with_error(
            "Coarse Alias",
            simbad_resolver::ResolveError::NotFound("Coarse Alias".to_owned()),
        )),
        simbad_resolver::FakeResolver::new()
            .with_response("Coarse Alias", sesame_coarse_identity("Coarse Object")),
    );
    let facade2 =
        simbad_resolver::SimbadResolver::new(dual2, CacheBackend::custom(cache.cache()), config)
            .unwrap();
    let simbad_resolver::Resolution::Resolved(second) =
        facade2.resolve("Coarse Alias").await.unwrap()
    else {
        panic!("expected the second alias to resolve too");
    };
    assert_eq!(second.id, first.id, "same physical object must dedup to one id");
}

#[tokio::test]
async fn sesame_hit_with_recovered_oid_is_cached() {
    // FR-010's success path: TAP re-enrichment recovered an oid for the
    // Sesame hit (modelled here by the Sesame fake returning an identity
    // that already carries one, standing in for `with_enricher`'s
    // production TAP round trip).
    let recovered = simbad_resolver::ResolvedIdentity {
        simbad_oid: Some(99),
        ..sesame_coarse_identity("Recovered Object")
    };
    let dual = DualLookupResolver::new(
        Arc::new(simbad_resolver::FakeResolver::new().with_error(
            "Recovered Object",
            simbad_resolver::ResolveError::NotFound("Recovered Object".to_owned()),
        )),
        simbad_resolver::FakeResolver::new().with_response("Recovered Object", recovered),
    );
    let facade = simbad_resolver::SimbadResolver::new(
        dual,
        CacheBackend::InMemory,
        ResolverConfig::new("test.oid-recovered"),
    )
    .unwrap();
    let simbad_resolver::Resolution::Resolved(target) =
        facade.resolve("Recovered Object").await.unwrap()
    else {
        panic!("expected a resolved target");
    };
    assert_eq!(target.simbad_oid, Some(99));
}

#[tokio::test]
async fn resolve_explicit_offline_uses_cache_only() {
    // FR-011/FR-018: `resolve_explicit` is gated by the same online
    // setting as typeahead — a cache hit still resolves offline, and a
    // miss never touches Sesame (ExplicitNetworkResolver::Offline never
    // builds a network client at all).
    let cache = ResolveCache::in_memory().unwrap();
    let ns = simbad_resolver::identity::namespace(NAMESPACE_SEED);
    simbad_resolver::Cache::upsert(&cache.cache(), &m31_identity(), &ns).await.unwrap();

    let resolver = SimbadResolver::new(&SimbadConfig::default(), &cache, false).unwrap();
    let got = resolver.resolve_explicit("M 31").await.unwrap();
    assert_eq!(got.primary_designation, "M 31");

    let err = resolver.resolve_explicit("Totally Unknown Object").await.unwrap_err();
    assert_eq!(err, ResolveError::Network("Totally Unknown Object".to_owned()));
}

// ── spec 052 P3: cone-search offline gating (D9, FR-018) ────────────────────

#[tokio::test]
async fn resolve_position_is_disabled_offline() {
    // Cone-search has no cache-first path — offline must report Disabled,
    // never degrade to an (incorrectly empty) local result.
    let cache = ResolveCache::in_memory().unwrap();
    let resolver = SimbadResolver::new(&SimbadConfig::default(), &cache, false).unwrap();
    let err = resolver.resolve_position(10.68, 41.27, 1.0, 10).await.unwrap_err();
    assert_eq!(err, ResolveError::Disabled);
}

#[tokio::test]
async fn enrich_position_match_offline_returns_unenriched_identity() {
    let cache = ResolveCache::in_memory().unwrap();
    let resolver = SimbadResolver::new(&SimbadConfig::default(), &cache, false).unwrap();
    let m = simbad_resolver::PositionMatch { identity: m31_identity(), separation_deg: 0.02 };
    let got = resolver.enrich_position_match(m).await;
    assert_eq!(got.primary_designation, "M 31");
}

#[tokio::test]
async fn warm_cache_makes_a_cone_search_identity_findable_by_oid() {
    // A cone-search hit that was never separately typed/searched must
    // still be cache-resident after warm_cache, so a later
    // `target.cone_search.confirm` (which requires the id to be cache-
    // or SQLite-resident, see `promote_by_id`) can find it.
    let cache = ResolveCache::in_memory().unwrap();
    let resolver = SimbadResolver::new(&SimbadConfig::default(), &cache, true).unwrap();
    resolver.warm_cache(&m31_identity()).await;

    let found = simbad_resolver::Cache::get_by_simbad_oid(&cache.cache(), 1_575_544).await.unwrap();
    assert_eq!(found.map(|t| t.primary_designation), Some("M 31".to_owned()));
}
