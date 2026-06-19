//! Layer-1 integration tests for the `target.resolve` use case (spec 035, #14).
//!
//! Uses the `seeded_catalog()` test double from `targeting::fixture` (offline,
//! deterministic, no network, no SIMBAD calls) to exercise the full resolve
//! pipeline in `app_core::target_lookup::resolve`:
//!
//!  exact-match → R3 policy → `TargetResolveResponse`.
//!
//! Covered cases:
//!  1. Successful resolve via primary designation ("M31") → `Resolved`.
//!  2. Cross-catalog alias ("NGC 224") maps to the same target as "M31".
//!  3. Unknown / junk query ("XYZ-UNKNOWN-9999") → `Unresolved`.
//!  4. Empty FITS OBJECT value → `Error` with `query.empty` code.

use app_core::target_lookup::resolve;
use contracts_core::target_lookup::{ResolveStatus, TargetResolveRequest};
use targeting::catalog::{CatalogEntry, CatalogId, CatalogRef, TargetCatalog};
use targeting::identity::target_id;
use uuid::Uuid;

// ── helpers ───────────────────────────────────────────────────────────────────

/// Build the same three-entry seeded catalog used in unit tests.
///
/// Entries:
/// - M31 ≡ NGC 224 ≡ Andromeda Galaxy
/// - M101 ≡ NGC 5457 ≡ Pinwheel Galaxy
/// - IC 1396 ≡ Elephant Trunk Nebula
fn seeded_catalog() -> TargetCatalog {
    let m31 = CatalogEntry {
        target_id: target_id("messier", "M31"),
        primary_designation: "M 31".to_owned(),
        primary_catalog_display: "Messier".to_owned(),
        refs: vec![
            CatalogRef {
                catalog_id: CatalogId::Messier,
                catalog_display: "Messier".to_owned(),
                designation: "M31".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Openngc,
                catalog_display: "OpenNGC".to_owned(),
                designation: "NGC 224".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Common,
                catalog_display: "Common Names".to_owned(),
                designation: "Andromeda Galaxy".to_owned(),
            },
        ],
    };

    let m101 = CatalogEntry {
        target_id: target_id("messier", "M101"),
        primary_designation: "M 101".to_owned(),
        primary_catalog_display: "Messier".to_owned(),
        refs: vec![
            CatalogRef {
                catalog_id: CatalogId::Messier,
                catalog_display: "Messier".to_owned(),
                designation: "M101".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Openngc,
                catalog_display: "OpenNGC".to_owned(),
                designation: "NGC 5457".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Common,
                catalog_display: "Common Names".to_owned(),
                designation: "Pinwheel Galaxy".to_owned(),
            },
        ],
    };

    let ic1396 = CatalogEntry {
        target_id: target_id("openngc", "IC 1396"),
        primary_designation: "IC 1396".to_owned(),
        primary_catalog_display: "OpenNGC".to_owned(),
        refs: vec![
            CatalogRef {
                catalog_id: CatalogId::Openngc,
                catalog_display: "OpenNGC".to_owned(),
                designation: "IC 1396".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Common,
                catalog_display: "Common Names".to_owned(),
                designation: "Elephant Trunk Nebula".to_owned(),
            },
        ],
    };

    TargetCatalog::from_entries(vec![m31, m101, ic1396])
}

/// Build a minimal valid `TargetResolveRequest`.
fn make_req(fits_object_value: impl Into<String>) -> TargetResolveRequest {
    TargetResolveRequest {
        contract_version: "1.0".to_owned(),
        request_id: Uuid::new_v4().to_string(),
        fits_object_value: fits_object_value.into(),
    }
}

// ── tests ─────────────────────────────────────────────────────────────────────

/// A well-known FITS OBJECT value ("M31") maps to a single confident match.
///
/// Exercises: exact-match → single candidate → R3 high-confidence branch →
/// `Resolved`.
#[test]
fn resolve_m31_by_primary_designation_returns_resolved() {
    let catalog = seeded_catalog();
    let req = make_req("M31");

    let resp = resolve(&catalog, &req);

    assert_eq!(
        resp.status,
        ResolveStatus::Resolved,
        "expected Resolved for M31, got {:?}",
        resp.status
    );
    assert!(resp.target_id.is_some(), "Resolved response must carry a target_id");

    let returned_id = resp.target_id.as_deref().unwrap();
    let expected_id = target_id("messier", "M31").to_string();
    assert_eq!(returned_id, expected_id, "resolved target_id must be the UUIDv5 for M31");

    assert_eq!(resp.request_id, req.request_id, "response must echo the caller request_id");
}

/// "NGC 224" is an alias for M31; resolving it must return the same stable
/// `target_id` as resolving "M31".
///
/// Exercises cross-catalog equivalence through the full resolve pipeline.
#[test]
fn resolve_ngc224_maps_to_same_target_as_m31() {
    let catalog = seeded_catalog();

    let m31_resp = resolve(&catalog, &make_req("M31"));
    let ngc_resp = resolve(&catalog, &make_req("NGC 224"));

    assert_eq!(m31_resp.status, ResolveStatus::Resolved, "M31 must resolve");
    assert_eq!(ngc_resp.status, ResolveStatus::Resolved, "NGC 224 must resolve");

    assert_eq!(
        m31_resp.target_id, ngc_resp.target_id,
        "M31 and NGC 224 must resolve to the same stable target_id"
    );
}

/// A completely unknown query must yield `Unresolved`, not an error.
///
/// Per FR-006 and constitution §II, unresolved outcomes are non-blocking and
/// must NOT be classified as errors.
#[test]
fn resolve_unknown_query_returns_unresolved() {
    let catalog = seeded_catalog();
    let req = make_req("XYZ-UNKNOWN-9999");

    let resp = resolve(&catalog, &req);

    assert_eq!(
        resp.status,
        ResolveStatus::Unresolved,
        "junk query must yield Unresolved, got {:?}",
        resp.status
    );
    assert!(resp.target_id.is_none(), "Unresolved response must not carry a target_id");
    assert!(resp.errors.is_none(), "Unresolved is a valid non-error outcome; errors must be None");
}

/// An empty FITS OBJECT value must yield `Error` with code `query.empty`.
///
/// This is the only resolution path that returns a hard error; ingestion
/// callers must guard against empty headers before calling resolve.
#[test]
fn resolve_empty_fits_object_returns_query_empty_error() {
    let catalog = seeded_catalog();
    let req = make_req("   ");

    let resp = resolve(&catalog, &req);

    assert_eq!(
        resp.status,
        ResolveStatus::Error,
        "empty query must yield Error, got {:?}",
        resp.status
    );

    let errors = resp.errors.as_deref().unwrap_or(&[]);
    assert!(!errors.is_empty(), "Error response must contain at least one error item");

    let code = &errors[0].code;
    assert_eq!(code, "query.empty", "error code must be 'query.empty', got '{code}'");
}
