// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Online integration tests against the live SIMBAD CDS service (SC-004).
//!
//! These exercise the real [`SimbadResolver`] end-to-end: two ADQL round-trips
//! to the TAP sync endpoint, TSV parsing, alias set construction, and
//! coordinate/object-type mapping.
//!
//! **Opt-in, not run by default.** Every other suite in this workspace is
//! offline (see `docs/development/testing.md`); a live-network test that
//! silently runs in every `cargo test --workspace` invocation is a hidden
//! nondeterminism and CI-network-dependency risk (flagged in the spec-tails
//! release-hardening audit). Set `ALM_LIVE_SIMBAD=1` to opt in and get real
//! SC-004 coverage against the live TAP endpoint; unset (the default) skips
//! with a clear message and always passes. When opted in, each test still
//! issues only a **single** resolve via [`resolve_or_skip`] and distinguishes
//! a transient outage (`Network`/`Timeout`/`Disabled` → log + skip, never
//! fail) from a genuine data/parse mismatch (→ fail), so a flaky network
//! blip during an opted-in run still can't fail CI — only a real regression
//! can.
//!
//! # Spec 035 coverage
//!
//! - **T024 / SC-004**: live SIMBAD round-trip for M 31 (Andromeda Galaxy) and
//!   NGC 7293 (Helix Nebula) — verifies canonical identity, plausible ICRS
//!   coordinates, object type, and cross-ID alias set.

use targeting_resolver::simbad::{ResolveCache, SimbadConfig, SimbadResolver};
use targeting_resolver::{AliasKind, ObjectType, ResolveError, ResolvedIdentity, Resolver};

// ── helpers ──────────────────────────────────────────────────────────────────

/// Resolve `query` against live SIMBAD with exactly one network request.
///
/// Returns `Some(identity)` to proceed with assertions; returns `None` (after
/// logging) to **skip** — the default (`ALM_LIVE_SIMBAD` unset, opt-in not
/// given), or a transient outage once opted in (the resolver reports
/// `Network`/`Timeout`/`Disabled`: offline dev, sandboxed CI, or a rate-limit
/// hiccup). A genuine data failure (`NotFound`/`Ambiguous`/`Parse`) **panics**
/// even when opted in, so real regressions still fail.
async fn resolve_or_skip(query: &str, test: &str) -> Option<ResolvedIdentity> {
    if std::env::var_os("ALM_LIVE_SIMBAD").is_none() {
        eprintln!(
            "SKIP {test}: ALM_LIVE_SIMBAD not set — live SIMBAD (SC-004) is opt-in; \
             set ALM_LIVE_SIMBAD=1 to exercise it"
        );
        return None;
    }
    let cache = ResolveCache::in_memory().expect("in-memory resolve cache");
    let resolver = SimbadResolver::new(&SimbadConfig::default(), &cache, true)
        .expect("SimbadResolver should build from default config");
    match resolver.resolve(query).await {
        Ok(identity) => Some(identity),
        Err(e @ (ResolveError::Network(_) | ResolveError::Timeout(_) | ResolveError::Disabled)) => {
            eprintln!(
                "SKIP {test}: live SIMBAD unreachable resolving {query:?} ({e}) — \
                 SC-004 live assertions not exercised this run"
            );
            None
        }
        Err(e) => panic!("live SIMBAD resolve of {query:?} failed (non-transient): {e}"),
    }
}

/// Assert `actual` is within `tolerance` degrees of `expected`.
fn assert_deg_approx(label: &str, actual: f64, expected: f64, tolerance: f64) {
    let diff = (actual - expected).abs();
    assert!(
        diff <= tolerance,
        "{label}: expected ≈ {expected}° ± {tolerance}°, got {actual}° (diff {diff}°)"
    );
}

/// Return true if the alias list contains a designation or common-name entry
/// whose display form equals `needle` (case-sensitive, as SIMBAD returns it).
fn has_alias(aliases: &[targeting_resolver::ResolvedAlias], needle: &str) -> bool {
    aliases.iter().any(|a| a.alias == needle)
}

// ── T024: M 31 (Andromeda Galaxy) ────────────────────────────────────────────

/// Live SIMBAD resolution of M 31 (Andromeda Galaxy).
///
/// Opt-in only: skipped unless `ALM_LIVE_SIMBAD=1` is set; skips gracefully
/// when SIMBAD is unreachable even then.
///
/// Assertions (tolerances generous; SIMBAD coords are precise but we avoid
/// hard-coding excessive decimal places):
/// - status: `Ok` (not an error variant)
/// - `object_type` == `Galaxy`
/// - `ra_deg` ≈ 10.68° ± 0.5° (ICRS J2000)
/// - `dec_deg` ≈ 41.27° ± 0.5°
/// - alias set includes the NGC cross-ID `NGC 224`
/// - a `CommonName` alias for "Andromeda Galaxy" is present
/// - `simbad_oid` is populated (non-None)
#[tokio::test]
async fn live_resolve_m31_andromeda_galaxy() {
    let Some(identity) = resolve_or_skip("M 31", "live_resolve_m31_andromeda_galaxy").await else {
        return;
    };

    // Coordinates — ICRS J2000 decimal degrees. M 31 centroid is well-known:
    // ra ≈ 10.6847°, dec ≈ 41.2692°. Tolerance ±0.5° covers any future
    // SIMBAD position refinement without making the test brittle.
    assert_deg_approx("ra_deg", identity.ra_deg, 10.68, 0.5);
    assert_deg_approx("dec_deg", identity.dec_deg, 41.27, 0.5);

    // Object type.
    assert_eq!(
        identity.object_type,
        ObjectType::Galaxy,
        "M 31 must be classified as Galaxy, got {:?}",
        identity.object_type
    );

    // SIMBAD OID must be populated (we never fabricate).
    assert!(
        identity.simbad_oid.is_some(),
        "simbad_oid must be populated for a live-resolved object"
    );

    // Cross-ID: NGC 224 is the principal NGC designation for M 31.
    assert!(
        has_alias(&identity.aliases, "NGC 224"),
        "alias set must include 'NGC 224' for M 31; got: {:?}",
        identity.aliases.iter().map(|a| &a.alias).collect::<Vec<_>>()
    );

    // Common name: SIMBAD carries "NAME Andromeda Galaxy" for this object.
    let common_names: Vec<&str> = identity
        .aliases
        .iter()
        .filter(|a| matches!(a.kind, AliasKind::CommonName))
        .map(|a| a.alias.as_str())
        .collect();
    assert!(!common_names.is_empty(), "at least one CommonName alias must be present for M 31");
    assert!(
        common_names.iter().any(|n| n.contains("Andromeda")),
        "a CommonName alias containing 'Andromeda' must be present; got: {common_names:?}"
    );
}

// ── T024: NGC 7293 (Helix Nebula) ────────────────────────────────────────────

/// Live SIMBAD resolution of NGC 7293 (Helix Nebula).
///
/// Opt-in only: skipped unless `ALM_LIVE_SIMBAD=1` is set; skips gracefully
/// when SIMBAD is unreachable even then.
///
/// NGC 7293 is classified as `PN` (planetary nebula) in SIMBAD — one of the
/// most stable object-type assignments in the database. Confirmed live:
/// oid 1283906, ra ≈ 337.41°, dec ≈ −20.84°, `otype_txt` = "PN".
///
/// Assertions:
/// - status: `Ok`
/// - `object_type` == `PlanetaryNebula`
/// - `ra_deg` ≈ 337.4° ± 1.0° (≈ 22h 29m)
/// - `dec_deg` ≈ −20.8° ± 1.0°
/// - `simbad_oid` is populated
/// - alias set is non-empty
#[tokio::test]
async fn live_resolve_ngc7293_helix_nebula() {
    let Some(identity) = resolve_or_skip("NGC 7293", "live_resolve_ngc7293_helix_nebula").await
    else {
        return;
    };

    // Coordinates — Helix Nebula centroid: ra ≈ 337.41°, dec ≈ −20.84°.
    assert_deg_approx("ra_deg", identity.ra_deg, 337.4, 1.0);
    assert_deg_approx("dec_deg", identity.dec_deg, -20.8, 1.0);

    // SIMBAD classifies NGC 7293 as PN (planetary nebula).
    assert_eq!(
        identity.object_type,
        ObjectType::PlanetaryNebula,
        "NGC 7293 must be classified as PlanetaryNebula (PN), got {:?}",
        identity.object_type
    );

    // OID and alias sanity.
    assert!(identity.simbad_oid.is_some(), "simbad_oid must be populated");
    assert!(!identity.aliases.is_empty(), "alias set must be non-empty");
}
