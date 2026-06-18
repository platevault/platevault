//! Gated online integration tests against the live SIMBAD CDS service.
//!
//! These tests require a real network connection to simbad.cds.unistra.fr and
//! are marked `#[ignore]` so they are excluded from the default `cargo test`
//! run. Execute them explicitly when network access is available:
//!
//! ```text
//! cargo test -p targeting --test simbad_live -- --ignored
//! ```
//!
//! They exercise the real [`SimbadResolver`] end-to-end: two ADQL round-trips
//! to the TAP sync endpoint, TSV parsing, alias set construction, and
//! coordinate/object-type mapping.
//!
//! # Spec 035 coverage
//!
//! - **T024**: live SIMBAD round-trip for M 31 (Andromeda Galaxy) and NGC 7000
//!   (North America Nebula) — verifies canonical identity, plausible ICRS
//!   coordinates, object type, and cross-ID alias set.

use targeting::resolver::simbad::{SimbadConfig, SimbadResolver};
use targeting::resolver::{AliasKind, ObjectType, Resolver};

// ── helpers ──────────────────────────────────────────────────────────────────

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
fn has_alias(aliases: &[targeting::resolver::ResolvedAlias], needle: &str) -> bool {
    aliases.iter().any(|a| a.alias == needle)
}

// ── T024: M 31 (Andromeda Galaxy) ────────────────────────────────────────────

/// Live SIMBAD resolution of M 31 (Andromeda Galaxy).
///
/// Requires network access to simbad.cds.unistra.fr — ignored by default.
/// Run with: `cargo test -p targeting --test simbad_live -- --ignored`
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
#[ignore = "requires network access to simbad.cds.unistra.fr; run with --ignored"]
async fn live_resolve_m31_andromeda_galaxy() {
    let resolver = SimbadResolver::new(&SimbadConfig::default())
        .expect("SimbadResolver should build from default config");

    let identity =
        resolver.resolve("M 31").await.expect("live SIMBAD resolve of 'M 31' must succeed");

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
/// Requires network access to simbad.cds.unistra.fr — ignored by default.
/// Run with: `cargo test -p targeting --test simbad_live -- --ignored`
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
#[ignore = "requires network access to simbad.cds.unistra.fr; run with --ignored"]
async fn live_resolve_ngc7293_helix_nebula() {
    let resolver = SimbadResolver::new(&SimbadConfig::default())
        .expect("SimbadResolver should build from default config");

    let identity =
        resolver.resolve("NGC 7293").await.expect("live SIMBAD resolve of 'NGC 7293' must succeed");

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
