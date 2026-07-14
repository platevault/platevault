// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 052 P1 T005 — SC-001: repeat search/resolve of a cached object issues
//! zero network calls, even across a process restart (drop + rebuild the
//! facade pointed at the same redb file).
//!
//! Uses the crate's own `simbad_resolver::SimbadResolver` facade directly
//! with a call-counting spy [`Resolver`] — astro-plan's production
//! `targeting_resolver::simbad::SimbadResolver` wrapper only ever builds a
//! real `TapResolver`/`OfflineResolver` internally (no seam for a fake), so
//! this SC-001 proof lives at the facade level the wrapper delegates to.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use simbad_resolver::{
    AliasKind, CacheBackend, ObjectType, Resolution, ResolveError, ResolvedAlias, ResolvedIdentity,
    Resolver, ResolverConfig, SimbadResolver, TargetSource,
};

/// A `Resolver` that counts every call and always answers with a canned M 31
/// identity — stands in for the network TAP client.
struct SpyResolver(Arc<AtomicUsize>);

#[async_trait::async_trait]
impl Resolver for SpyResolver {
    async fn resolve(&self, _query: &str) -> Result<ResolvedIdentity, ResolveError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(m31())
    }
}

fn m31() -> ResolvedIdentity {
    ResolvedIdentity {
        simbad_oid: Some(1_575_544),
        primary_designation: "M 31".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: ObjectType::Galaxy,
        otype_raw: "G".to_owned(),
        ra_deg: 10.684_708,
        dec_deg: 41.268_75,
        v_mag: Some(3.44),
        aliases: vec![ResolvedAlias::new("M 31", AliasKind::Designation)],
        source: TargetSource::Resolved,
    }
}

#[tokio::test]
async fn sc001_resolve_survives_facade_rebuild_with_zero_network_calls() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("resolve-cache.redb");
    let namespace = simbad_resolver::identity::namespace("sc001-test");
    let calls = Arc::new(AtomicUsize::new(0));

    // Facade #1: cold cache — resolve() misses, calls the spy once, caches
    // the result to the file-backed redb store.
    {
        let facade = SimbadResolver::new(
            SpyResolver(calls.clone()),
            CacheBackend::file(&path),
            ResolverConfig::new("sc001-test").with_namespace(namespace),
        )
        .expect("facade #1 must build");
        let resolution = facade.resolve("M 31").await.expect("resolve must not error");
        assert!(
            matches!(resolution, Resolution::Resolved(t) if t.primary_designation == "M 31"),
            "first resolve must succeed via the spy"
        );
    } // facade #1 (and its redb Database handle) dropped here.
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "first resolve must call the resolver exactly once"
    );

    // Facade #2: simulates an app restart — a FRESH facade instance pointed
    // at the SAME redb file, with a resolver that would still answer if
    // called. The second resolve must be served entirely from the
    // redb cache: zero additional calls to the spy (SC-001).
    {
        let facade2 = SimbadResolver::new(
            SpyResolver(calls.clone()),
            CacheBackend::file(&path),
            ResolverConfig::new("sc001-test").with_namespace(namespace),
        )
        .expect("facade #2 must build");
        let resolution2 = facade2.resolve("M 31").await.expect("resolve must not error");
        assert!(
            matches!(resolution2, Resolution::Resolved(t) if t.primary_designation == "M 31"),
            "second resolve must still succeed, served from the redb cache"
        );
    }
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "SC-001: a cached object survives a facade rebuild over the same redb file \
         and issues zero further network calls"
    );
}
