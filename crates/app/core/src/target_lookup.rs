//! Target lookup and resolve use cases for spec 013.
//!
//! Entry points:
//! - [`lookup`] — `target.lookup`: ranked candidate list for the UI catalog picker.
//! - [`resolve`] — `target.resolve`: single-value resolution for ingestion (FITS OBJECT).
//!
//! Both functions accept a pre-built [`targeting::catalog::TargetCatalog`]
//! so the in-memory index can be shared and rebuilt on
//! `catalog.download.completed` events without coupling this module to SQLite.
//!
//! ## Ingestion integration boundary (spec 005)
//!
//! The `resolve` function is the entry point for the ingestion/metadata pipeline.
//! When spec 005 (Inbox mixed-folder split) is implemented it should call
//! `resolve` with the extracted FITS `OBJECT` value. The pipeline handles the
//! `unresolved` / `ambiguous` / `catalog.not_installed` outcomes as non-blocking
//! (FR-006): ingestion records an audit event and continues.
//!
//! **This module does NOT implement metadata extraction** — that boundary is
//! owned by spec 005 / `crates/metadata/fits/`.

use contracts_core::target_lookup::{
    CandidateSummary, LookupConfidence, LookupError, LookupErrorCode, LookupMatchEvidence,
    LookupStrategy, LookupTargetMatch, TargetLookupRequest, TargetLookupResponse,
    TargetResolveRequest, TargetResolveResponse,
};
use targeting::catalog::{Confidence, MatchStrategy, TargetCatalog, TargetMatch};
use targeting::lookup::{edit_distance, exact, fuzzy};
use targeting::normalize::normalize;
use targeting::resolve::{apply_policy, ResolveOutcome};

// ── Helper converters ─────────────────────────────────────────────────────────

fn map_confidence(c: Confidence) -> LookupConfidence {
    match c {
        Confidence::High => LookupConfidence::High,
        Confidence::Medium => LookupConfidence::Medium,
        Confidence::Low => LookupConfidence::Low,
    }
}

fn map_strategy(s: MatchStrategy) -> LookupStrategy {
    match s {
        MatchStrategy::Exact => LookupStrategy::Exact,
        MatchStrategy::TokenSet => LookupStrategy::TokenSet,
        MatchStrategy::EditDistance => LookupStrategy::EditDistance,
    }
}

fn match_to_contract(m: TargetMatch) -> LookupTargetMatch {
    LookupTargetMatch {
        target_id: m.target_id.to_string(),
        primary_designation: m.primary_designation,
        catalog_display: m.primary_catalog_display,
        confidence: map_confidence(m.confidence),
        score: m.score,
        evidence: LookupMatchEvidence {
            matched_alias: m.evidence.matched_alias,
            normalized_query: m.evidence.normalized_query,
            strategy: map_strategy(m.evidence.strategy),
            score: m.evidence.score,
        },
    }
}

fn match_to_candidate_summary(m: &TargetMatch) -> CandidateSummary {
    CandidateSummary {
        target_id: m.target_id.to_string(),
        primary_designation: m.primary_designation.clone(),
        catalog_display: m.primary_catalog_display.clone(),
        score: m.score,
    }
}

// ── lookup ────────────────────────────────────────────────────────────────────

/// `target.lookup` — return ranked candidate matches for a free-form query.
///
/// The result is suitable for the UI catalog picker. Empty `matches` array
/// means no candidates above the discard threshold.
///
/// Returns `catalog.not_installed` when the catalog has no entries.
/// Returns `query.empty` when the query is blank.
#[must_use]
pub fn lookup(catalog: &TargetCatalog, req: &TargetLookupRequest) -> TargetLookupResponse {
    let query = req.query.trim();
    if query.is_empty() {
        return TargetLookupResponse::error(
            req.request_id.clone(),
            vec![LookupError::new(LookupErrorCode::QueryEmpty, "Query must not be empty.")],
        );
    }

    if catalog.is_empty() {
        return TargetLookupResponse::error(
            req.request_id.clone(),
            vec![LookupError::new(
                LookupErrorCode::CatalogNotInstalled,
                "Catalog not yet installed. Complete the first-run catalog download.",
            )],
        );
    }

    let limit = req.limit.clamp(1, 50) as usize;

    // Stage 1: exact match.
    if let Some(m) = exact::lookup(catalog, query) {
        return TargetLookupResponse::success(req.request_id.clone(), vec![match_to_contract(m)]);
    }

    // Stage 2: fuzzy (token-set) match.
    let fuzzy_results = fuzzy::lookup(catalog, query, limit * 2);

    // Stage 3: edit-distance re-rank.
    let norm_query = normalize(query);
    let reranked = edit_distance::rerank(fuzzy_results, &norm_query);

    let matches = reranked.into_iter().take(limit).map(match_to_contract).collect();

    TargetLookupResponse::success(req.request_id.clone(), matches)
}

// ── resolve ───────────────────────────────────────────────────────────────────

/// `target.resolve` — resolve a single FITS OBJECT value to a stable target identity.
///
/// Wraps `target.lookup` with single-result semantics per the ambiguity policy
/// (research.md R3). Returns:
///
/// - `resolved` when exactly one high-confidence or medium-confidence match
///   clears the gap threshold.
/// - `ambiguous` when multiple candidates are too close to decide.
/// - `unresolved` when nothing clears the discard threshold or the query is
///   too generic.
/// - `error` for `query.empty`, `catalog.not_installed`, or internal failure.
///
/// Non-blocking: all non-`resolved` outcomes are valid and MUST NOT block
/// ingestion in the caller (FR-006, constitution §II).
#[must_use]
pub fn resolve(catalog: &TargetCatalog, req: &TargetResolveRequest) -> TargetResolveResponse {
    let query = req.fits_object_value.trim();
    if query.is_empty() {
        return TargetResolveResponse::error(
            req.request_id.clone(),
            vec![LookupError::new(
                LookupErrorCode::QueryEmpty,
                "FITS OBJECT value must not be empty.",
            )],
        );
    }

    if catalog.is_empty() {
        return TargetResolveResponse::error(
            req.request_id.clone(),
            vec![LookupError::new(
                LookupErrorCode::CatalogNotInstalled,
                "Catalog not yet installed. Complete the first-run catalog download.",
            )],
        );
    }

    // Collect all candidates above the discard threshold.
    let candidates: Vec<TargetMatch> = {
        if let Some(exact_match) = exact::lookup(catalog, query) {
            vec![exact_match]
        } else {
            let fuzzy_results = fuzzy::lookup(catalog, query, 20);
            let norm_query = normalize(query);
            edit_distance::rerank(fuzzy_results, &norm_query)
        }
    };

    // Apply R3 policy.
    match apply_policy(candidates) {
        ResolveOutcome::Resolved { target } => {
            let confidence = map_confidence(target.confidence);
            TargetResolveResponse::resolved(
                req.request_id.clone(),
                target.target_id.to_string(),
                target.primary_designation,
                target.primary_catalog_display,
                confidence,
            )
        }
        ResolveOutcome::Ambiguous { candidates } => {
            let summaries: Vec<CandidateSummary> =
                candidates.iter().map(match_to_candidate_summary).collect();
            TargetResolveResponse::ambiguous(req.request_id.clone(), summaries)
        }
        ResolveOutcome::Unresolved => TargetResolveResponse::unresolved(req.request_id.clone()),
        ResolveOutcome::CatalogUnavailable => TargetResolveResponse::error(
            req.request_id.clone(),
            vec![LookupError::new(
                LookupErrorCode::CatalogUnavailable,
                "Catalog index failed to build from SQLite.",
            )],
        ),
        ResolveOutcome::CatalogNotInstalled => TargetResolveResponse::error(
            req.request_id.clone(),
            vec![LookupError::new(
                LookupErrorCode::CatalogNotInstalled,
                "Catalog not yet installed.",
            )],
        ),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use contracts_core::target_lookup::ResolveStatus;
    use targeting::catalog::{CatalogEntry, CatalogId, CatalogRef, TargetCatalog};
    use targeting::identity::target_id;

    fn req_id() -> String {
        "test-req-001".to_owned()
    }

    /// Build a small seeded catalog without depending on `targeting::fixture`
    /// (which is `#[cfg(test)]`-gated inside the `targeting` crate).
    fn seeded_catalog() -> TargetCatalog {
        let m31_id = target_id("messier", "M31");
        let m31 = CatalogEntry {
            target_id: m31_id,
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
        let m101_id = target_id("messier", "M101");
        let m101 = CatalogEntry {
            target_id: m101_id,
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
        TargetCatalog::from_entries(vec![m31, m101])
    }

    // ── lookup ────────────────────────────────────────────────────────────────

    #[test]
    fn lookup_exact_m31_returns_success() {
        let cat = seeded_catalog();
        let req = TargetLookupRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            query: "M31".into(),
            limit: 10,
        };
        let resp = lookup(&cat, &req);
        assert_eq!(resp.status, "success");
        let matches = resp.matches.unwrap();
        assert!(!matches.is_empty());
        assert_eq!(matches[0].confidence, LookupConfidence::High);
    }

    #[test]
    fn lookup_ngc224_resolves_same_target_as_m31() {
        let cat = seeded_catalog();
        let m31_req = TargetLookupRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            query: "M31".into(),
            limit: 1,
        };
        let ngc_req = TargetLookupRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            query: "NGC224".into(),
            limit: 1,
        };
        let m31_resp = lookup(&cat, &m31_req);
        let ngc_resp = lookup(&cat, &ngc_req);
        let m31_id = &m31_resp.matches.unwrap()[0].target_id;
        let ngc_id = &ngc_resp.matches.unwrap()[0].target_id;
        assert_eq!(m31_id, ngc_id);
    }

    #[test]
    fn lookup_andromeda_galaxy_returns_high_confidence() {
        let cat = seeded_catalog();
        let req = TargetLookupRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            query: "Andromeda Galaxy".into(),
            limit: 5,
        };
        let resp = lookup(&cat, &req);
        let matches = resp.matches.unwrap();
        assert!(!matches.is_empty());
        assert_eq!(matches[0].confidence, LookupConfidence::High);
    }

    #[test]
    fn lookup_empty_query_returns_query_empty_error() {
        let cat = seeded_catalog();
        let req = TargetLookupRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            query: "  ".into(),
            limit: 10,
        };
        let resp = lookup(&cat, &req);
        assert_eq!(resp.status, "error");
        let errors = resp.errors.unwrap();
        assert_eq!(errors[0].code, "query.empty");
    }

    #[test]
    fn lookup_empty_catalog_returns_not_installed_error() {
        let cat = TargetCatalog::new();
        let req = TargetLookupRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            query: "M31".into(),
            limit: 10,
        };
        let resp = lookup(&cat, &req);
        assert_eq!(resp.status, "error");
        let errors = resp.errors.unwrap();
        assert_eq!(errors[0].code, "catalog.not_installed");
    }

    #[test]
    fn lookup_respects_limit() {
        let cat = seeded_catalog();
        let req = TargetLookupRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            query: "galaxy".into(),
            limit: 1,
        };
        let resp = lookup(&cat, &req);
        if let Some(matches) = resp.matches {
            assert!(matches.len() <= 1);
        }
    }

    // ── resolve ───────────────────────────────────────────────────────────────

    #[test]
    fn resolve_m31_returns_resolved_high() {
        let cat = seeded_catalog();
        let req = TargetResolveRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            fits_object_value: "M31".into(),
        };
        let resp = resolve(&cat, &req);
        assert_eq!(resp.status, ResolveStatus::Resolved);
        assert_eq!(resp.confidence, Some(LookupConfidence::High));
        assert!(resp.target_id.is_some());
    }

    #[test]
    fn resolve_ngc224_same_target_as_m31() {
        let cat = seeded_catalog();
        let m31_resp = resolve(
            &cat,
            &TargetResolveRequest {
                contract_version: "1.0".into(),
                request_id: req_id(),
                fits_object_value: "M31".into(),
            },
        );
        let ngc_resp = resolve(
            &cat,
            &TargetResolveRequest {
                contract_version: "1.0".into(),
                request_id: req_id(),
                fits_object_value: "NGC224".into(),
            },
        );
        assert_eq!(m31_resp.status, ResolveStatus::Resolved);
        assert_eq!(ngc_resp.status, ResolveStatus::Resolved);
        assert_eq!(m31_resp.target_id, ngc_resp.target_id);
    }

    #[test]
    fn resolve_light_returns_unresolved_or_ambiguous() {
        let cat = seeded_catalog();
        let req = TargetResolveRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            fits_object_value: "Light".into(),
        };
        let resp = resolve(&cat, &req);
        assert!(
            matches!(resp.status, ResolveStatus::Unresolved | ResolveStatus::Ambiguous),
            "expected unresolved or ambiguous for generic 'Light', got {:?}",
            resp.status
        );
    }

    #[test]
    fn resolve_empty_fits_value_returns_error() {
        let cat = seeded_catalog();
        let req = TargetResolveRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            fits_object_value: String::new(),
        };
        let resp = resolve(&cat, &req);
        assert_eq!(resp.status, ResolveStatus::Error);
    }

    #[test]
    fn resolve_empty_catalog_returns_not_installed_error() {
        let cat = TargetCatalog::new();
        let req = TargetResolveRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            fits_object_value: "M31".into(),
        };
        let resp = resolve(&cat, &req);
        assert_eq!(resp.status, ResolveStatus::Error);
        let errors = resp.errors.unwrap();
        assert_eq!(errors[0].code, "catalog.not_installed");
    }

    #[test]
    fn resolve_common_name_andromeda_galaxy() {
        let cat = seeded_catalog();
        let req = TargetResolveRequest {
            contract_version: "1.0".into(),
            request_id: req_id(),
            fits_object_value: "Andromeda Galaxy".into(),
        };
        let resp = resolve(&cat, &req);
        assert_eq!(resp.status, ResolveStatus::Resolved);
    }
}
