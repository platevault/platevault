#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Layer-1 integration tests for the `target.resolve` use case (spec 035, #14).
//!
//! Uses a `FakeResolver` (offline, deterministic, no network, no SIMBAD calls)
//! together with the real SQLite backend to exercise the full resolve pipeline
//! in `app_core::target_resolve::resolve`.
//!
//! Covered cases:
//!  1. Successful resolve via primary designation ("M31") → `Resolved`.
//!  2. Cross-catalog alias ("NGC 224") maps to the same target as "M31".
//!  3. Unknown / junk query ("XYZ-UNKNOWN-9999") → `Unresolved`.
//!  4. Empty FITS OBJECT value → `Unresolved` with reason "unknown".

mod support;

use app_core::target_resolve::{resolve, resolve_explicit};
use contracts_core::targets::{TargetResolveSimbadRequest, TargetResolveStatus};
use targeting_resolver::{
    AliasKind, FakeResolver, ObjectType, ResolvedAlias, ResolvedIdentity, TargetSource,
};
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────────

/// Build a canonical M31 identity the FakeResolver will return.
fn m31_identity() -> ResolvedIdentity {
    ResolvedIdentity {
        simbad_oid: Some(1_575_544),
        primary_designation: "M 31".to_owned(),
        common_name: Some("Andromeda Galaxy".to_owned()),
        object_type: ObjectType::Galaxy,
        ra_deg: 10.684_708,
        dec_deg: 41.268_75,
        v_mag: None,
        aliases: vec![
            ResolvedAlias::new("M 31", AliasKind::Designation),
            ResolvedAlias::new("NGC 224", AliasKind::Designation),
            ResolvedAlias::new("Andromeda Galaxy", AliasKind::CommonName),
        ],
        source: TargetSource::Resolved,
    }
}

/// Build a minimal valid `TargetResolveSimbadRequest`.
fn make_req(query: impl Into<String>) -> TargetResolveSimbadRequest {
    TargetResolveSimbadRequest {
        contract_version: "1.0".to_owned(),
        request_id: Uuid::new_v4().to_string(),
        query: query.into(),
        override_target: None,
    }
}

// ── tests ─────────────────────────────────────────────────────────────────────

/// TC-14.1: A well-known FITS OBJECT value ("M31") maps to a single confident
/// match. The `FakeResolver` is pre-loaded with M31 so the cache-miss path
/// writes it to SQLite, and the response carries `Resolved` + `target_id`.
#[tokio::test]
async fn resolve_m31_by_primary_designation_returns_resolved() {
    let (db, _repo, _bus) = support::setup().await;
    // "M 31" is the normalized form after trimming; register under the exact
    // query the resolver receives (after trim in target_resolve.rs).
    let resolver = FakeResolver::new().with_response("M 31", m31_identity());

    let resp = resolve(db.pool(), &resolver, &make_req("M 31")).await.unwrap();

    assert_eq!(
        resp.status,
        TargetResolveStatus::Resolved,
        "expected Resolved for M31, got {:?}",
        resp.status
    );
    let target = resp.target.expect("Resolved response must carry a target");
    assert_eq!(target.primary_designation, "M 31");
    assert_eq!(target.simbad_oid, Some(1_575_544));
}

/// TC-14.2: "NGC 224" is an alias for M31; resolving it after the cache was
/// seeded by a prior M31 resolution must return the same stable `target_id`.
/// Exercises cross-catalog cache-hit dedup.
#[tokio::test]
async fn resolve_ngc224_maps_to_same_target_as_m31() {
    let (db, _repo, _bus) = support::setup().await;
    let resolver = FakeResolver::new()
        .with_response("M 31", m31_identity())
        .with_response("NGC 224", m31_identity());

    // First, resolve "M 31" to seed the cache.
    let m31_resp = resolve(db.pool(), &resolver, &make_req("M 31")).await.unwrap();
    assert_eq!(m31_resp.status, TargetResolveStatus::Resolved);
    let m31_target = m31_resp.target.unwrap();

    // Now resolve "NGC 224" — the FakeResolver returns the same simbad_oid, so
    // dedup merges them to the same canonical row.
    let ngc_resp = resolve(db.pool(), &resolver, &make_req("NGC 224")).await.unwrap();
    assert_eq!(ngc_resp.status, TargetResolveStatus::Resolved);
    let ngc_target = ngc_resp.target.unwrap();

    assert_eq!(
        m31_target.target_id, ngc_target.target_id,
        "M31 and NGC 224 must resolve to the same stable target_id"
    );
}

/// TC-14.3: A completely unknown query must yield `Unresolved`, not an error.
/// Per FR-006, unresolved outcomes are non-blocking.
#[tokio::test]
async fn resolve_unknown_query_returns_unresolved() {
    let (db, _repo, _bus) = support::setup().await;
    // FakeResolver with no configured response → default NotFound.
    let resolver = FakeResolver::new();

    let resp = resolve(db.pool(), &resolver, &make_req("XYZ-UNKNOWN-9999")).await.unwrap();

    assert_eq!(
        resp.status,
        TargetResolveStatus::Unresolved,
        "junk query must yield Unresolved, got {:?}",
        resp.status
    );
    assert!(resp.target.is_none(), "Unresolved response must not carry a target");
}

/// TC-14.4: An empty/whitespace FITS OBJECT value must yield `Unresolved`
/// (reason "unknown"). The resolver is never called.
#[tokio::test]
async fn resolve_empty_fits_object_returns_unresolved() {
    let (db, _repo, _bus) = support::setup().await;
    let resolver = FakeResolver::new();

    let resp = resolve(db.pool(), &resolver, &make_req("   ")).await.unwrap();

    assert_eq!(
        resp.status,
        TargetResolveStatus::Unresolved,
        "empty query must yield Unresolved, got {:?}",
        resp.status
    );
    assert!(resp.target.is_none(), "no target should be fabricated for empty query");
}

// ── spec 052 P2: `target.resolve_explicit` reachability (FR-008/FR-009) ────────
//
// These prove the WIRING (Tauri-command-equivalent `app_core` entrypoint →
// `resolve_explicit` → the Sesame-shaped fallback), not the TAP/Sesame
// composition logic itself (already unit-tested with fakes/spies in
// `targeting_resolver::simbad`). `FakeResolver::with_explicit_response`
// models "TAP misses this designation, but Sesame carries it" — a canned
// identity ONLY `resolve_explicit`'s path can reach.

/// TC-P2.1: a designation the plain (TAP-only) path misses stays `Unresolved`
/// via `resolve` (the debounced typeahead entrypoint) but resolves via
/// `resolve_explicit` (Enter/confirm/"search harder") — proving the deliberate
/// user action's command path actually reaches the fallback, end to end
/// through the real SQLite-backed use case, not just the resolver unit.
#[tokio::test]
async fn resolve_explicit_reaches_sesame_fallback_that_typeahead_misses() {
    let (db, _repo, _bus) = support::setup().await;
    let resolver =
        FakeResolver::new().with_explicit_response("Coarse Object", sesame_only_identity());

    let typeahead_resp = resolve(db.pool(), &resolver, &make_req("Coarse Object")).await.unwrap();
    assert_eq!(
        typeahead_resp.status,
        TargetResolveStatus::Unresolved,
        "the debounced typeahead entrypoint must never reach the Sesame-only fallback"
    );

    let explicit_resp =
        resolve_explicit(db.pool(), &resolver, &make_req("Coarse Object")).await.unwrap();
    assert_eq!(
        explicit_resp.status,
        TargetResolveStatus::Resolved,
        "the explicit resolve/confirm entrypoint must reach the Sesame-only fallback"
    );
    assert_eq!(explicit_resp.target.expect("resolved").primary_designation, "Coarse Object");
}

/// TC-P2.2: when the plain path already hits, `resolve_explicit` returns the
/// same result (no need to consult a fallback) — asserted via the crate's
/// call-count spies so this is a real reachability check, not a coincidence
/// of canned data.
#[tokio::test]
async fn resolve_explicit_skips_fallback_on_a_tap_hit() {
    let (db, _repo, _bus) = support::setup().await;
    let resolver = FakeResolver::new().with_response("M 31", m31_identity());

    let resp = resolve_explicit(db.pool(), &resolver, &make_req("M 31")).await.unwrap();

    assert_eq!(resp.status, TargetResolveStatus::Resolved);
    assert_eq!(resp.target.unwrap().primary_designation, "M 31");
    assert_eq!(resolver.explicit_call_count(), 1);
}

/// A coarse identity registered ONLY as an explicit-only response (models a
/// Sesame hit the TAP-only path never sees).
fn sesame_only_identity() -> ResolvedIdentity {
    ResolvedIdentity {
        simbad_oid: None,
        primary_designation: "Coarse Object".to_owned(),
        common_name: None,
        object_type: ObjectType::Other,
        ra_deg: 5.0,
        dec_deg: -3.0,
        v_mag: None,
        aliases: vec![ResolvedAlias::new("Coarse Object", AliasKind::Designation)],
        source: TargetSource::Resolved,
    }
}
