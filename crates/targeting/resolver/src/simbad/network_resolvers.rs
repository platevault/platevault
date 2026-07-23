// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Small `Resolver` compositions [`super::resolver::SimbadResolver`] is built
//! from: a live-or-stub selector for the typeahead leg, a TAP-first/
//! Sesame-fallback pair for the explicit-resolve leg, and the enum that picks
//! between them.

use std::sync::Arc;

use async_trait::async_trait;

/// Either a live network resolver or a zero-cost stub, selected once at
/// [`super::resolver::SimbadResolver::new`] by the caller's `online_enabled` flag.
///
/// This exists so the facade never has to construct a `reqwest`/TLS client
/// when online resolution is disabled (mirroring the pre-052 FIX-3 concern —
/// client construction itself can fail), while STILL getting a cache-first
/// hit from the shared [`super::cache::ResolveCache`] in offline mode (FR-006/FR-018: "a
/// cached/seeded object is never re-queried", regardless of the online
/// setting).
pub(super) enum EitherNetworkResolver {
    Online(Arc<simbad_resolver::TapResolver>),
    Offline(simbad_resolver::OfflineResolver),
}

#[async_trait]
impl simbad_resolver::Resolver for EitherNetworkResolver {
    async fn resolve(
        &self,
        query: &str,
    ) -> Result<simbad_resolver::ResolvedIdentity, simbad_resolver::ResolveError> {
        match self {
            Self::Online(r) => simbad_resolver::Resolver::resolve(r.as_ref(), query).await,
            Self::Offline(r) => simbad_resolver::Resolver::resolve(r, query).await,
        }
    }
}

/// TAP-first, name-resolver-fallback-on-miss composition (spec 052 P2, D5,
/// FR-008/FR-010): tries `tap` first; only on a genuine "no match"
/// ([`simbad_resolver::ResolveError::NotFound`]) does it consult `sesame`.
/// Any other TAP outcome (a hit, `Ambiguous`, or a transient
/// `Network`/`Timeout`) is returned as-is — a transient TAP failure is not a
/// "match miss" and swapping to a different backend for it would silently
/// change the answer's provenance, not just extend coverage.
///
/// Generic over both legs so tests substitute [`simbad_resolver::FakeResolver`]
/// spies for both `TapResolver` and `SesameResolver` (call-count assertions,
/// no network). Production wires the real `T = TapResolver`, `S =
/// SesameResolver` (the latter itself `with_enricher`'d back through `tap` —
/// FR-010 oid recovery — see [`super::resolver::SimbadResolver::new`]).
pub(super) struct DualLookupResolver<T, S> {
    pub(super) tap: Arc<T>,
    pub(super) sesame: S,
}

impl<T, S> DualLookupResolver<T, S> {
    pub(super) fn new(tap: Arc<T>, sesame: S) -> Self {
        Self { tap, sesame }
    }
}

#[async_trait]
impl<T, S> simbad_resolver::Resolver for DualLookupResolver<T, S>
where
    T: simbad_resolver::Resolver,
    S: simbad_resolver::Resolver,
{
    async fn resolve(
        &self,
        query: &str,
    ) -> Result<simbad_resolver::ResolvedIdentity, simbad_resolver::ResolveError> {
        match self.tap.resolve(query).await {
            Ok(identity) => Ok(identity),
            Err(simbad_resolver::ResolveError::NotFound(_)) => self.sesame.resolve(query).await,
            Err(e) => Err(e),
        }
    }
}

/// Either the [`DualLookupResolver`] (online) or a zero-cost offline stub —
/// the explicit-resolve counterpart of [`EitherNetworkResolver`], preserving
/// the same "never build a `reqwest`/TLS client when offline" property
/// (FIX-3 / FR-011) for the Sesame leg too.
pub(super) enum ExplicitNetworkResolver {
    Online(DualLookupResolver<simbad_resolver::TapResolver, simbad_resolver::SesameResolver>),
    Offline(simbad_resolver::OfflineResolver),
}

#[async_trait]
impl simbad_resolver::Resolver for ExplicitNetworkResolver {
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
