// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Boundary conversions (crate ⇄ astro-plan local types).

use crate::{AliasKind, ResolveError, ResolvedAlias, ResolvedIdentity, TargetSource};

/// Convert the upstream crate's `ResolveError` to astro-plan's local
/// `ResolveError` — the variants are identical 1:1, this crate's copy predates
/// (and stays independent of) the published crate's error type.
pub(super) fn from_crate_error(e: simbad_resolver::ResolveError) -> ResolveError {
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
pub(super) fn from_unresolved_reason(
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
pub(super) fn from_facade_error(e: &simbad_resolver::Error) -> ResolveError {
    ResolveError::Network(e.to_string())
}

/// Map a cache-backend-only error (cache open/init) to astro-plan's local
/// `ResolveError`.
pub(super) fn from_cache_error(e: &simbad_resolver::CacheError) -> ResolveError {
    ResolveError::Network(e.to_string())
}

/// Convert the upstream crate's `ResolvedIdentity` to astro-plan's local
/// `ResolvedIdentity`, dropping the crate's `otype_raw` escape-hatch field:
/// astro-plan's `canonical_target` schema has no column for it and nothing in
/// this codebase reads it (kept local type has no such field, by design — see
/// module doc).
#[must_use]
pub fn from_crate_identity(i: simbad_resolver::ResolvedIdentity) -> ResolvedIdentity {
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
/// redb cache via [`super::resolver::SimbadResolver::search`], not SQLite).
///
/// `display_alias` is always `None`: it is a SQLite-only, user-owned field
/// (FR-012) with no redb-cache equivalent — a pure search hit is, by
/// definition, not yet an adopted/in-use target.
#[must_use]
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
#[must_use]
pub fn from_crate_search_hit(h: simbad_resolver::SearchHit) -> crate::cache::SearchHit {
    crate::cache::SearchHit {
        target: from_crate_cached_target(h.target),
        matched_alias: h.matched_alias,
        rank: h.rank,
    }
}
