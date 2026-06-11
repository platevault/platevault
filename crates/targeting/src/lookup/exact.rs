//! Exact alias-index lookup (spec 013, T007, research.md R2 stage 1).
//!
//! Normalizes the query, then looks it up in the [`TargetCatalog`] alias
//! index. A hit returns a single [`TargetMatch`] with `strategy = exact`,
//! `score = 100`, and `confidence = high`.

use crate::catalog::{Confidence, MatchEvidence, MatchStrategy, TargetCatalog, TargetMatch};
use crate::normalize::normalize;

/// Look up a raw query string in the exact alias index.
///
/// Returns `Some(TargetMatch)` when the normalized query matches a known
/// alias, or `None` when no exact match exists.
#[must_use]
pub fn lookup(catalog: &TargetCatalog, raw_query: &str) -> Option<TargetMatch> {
    let normalized = normalize(raw_query);
    if normalized.is_empty() {
        return None;
    }

    catalog.exact_lookup(&normalized).map(|entry| TargetMatch {
        target_id: entry.target_id,
        primary_designation: entry.primary_designation.clone(),
        primary_catalog_display: entry.primary_catalog_display.clone(),
        confidence: Confidence::High,
        score: 100.0,
        evidence: MatchEvidence {
            matched_alias: entry.primary_designation.clone(),
            normalized_query: normalized,
            strategy: MatchStrategy::Exact,
            score: 100.0,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_catalog() -> TargetCatalog {
        crate::fixture::seeded_catalog()
    }

    #[test]
    fn exact_hit_on_primary_designation() {
        let cat = fixture_catalog();
        let m = lookup(&cat, "M 31").unwrap();
        assert_eq!(m.confidence, Confidence::High);
        assert!((m.score - 100.0).abs() < f64::EPSILON, "expected score 100.0, got {}", m.score);
        assert_eq!(m.evidence.strategy, MatchStrategy::Exact);
    }

    #[test]
    fn exact_hit_on_raw_compact_form() {
        let cat = fixture_catalog();
        // "M31" normalizes to "m 31" — must find M 31.
        let m = lookup(&cat, "M31").unwrap();
        assert_eq!(m.confidence, Confidence::High);
    }

    #[test]
    fn exact_hit_on_ngc_alias() {
        let cat = fixture_catalog();
        // M31 ≡ NGC 224 — must resolve to the same target.
        let m31 = lookup(&cat, "M31").unwrap();
        let ngc = lookup(&cat, "NGC224").unwrap();
        assert_eq!(m31.target_id, ngc.target_id);
    }

    #[test]
    fn exact_hit_on_common_name() {
        let cat = fixture_catalog();
        let m = lookup(&cat, "Andromeda Galaxy").unwrap();
        assert_eq!(m.confidence, Confidence::High);
    }

    #[test]
    fn exact_miss_returns_none() {
        let cat = fixture_catalog();
        assert!(lookup(&cat, "Light").is_none());
    }

    #[test]
    fn empty_query_returns_none() {
        let cat = fixture_catalog();
        assert!(lookup(&cat, "").is_none());
        assert!(lookup(&cat, "  ").is_none());
    }

    #[test]
    fn case_insensitive_lookup() {
        let cat = fixture_catalog();
        let m = lookup(&cat, "andromeda galaxy").unwrap();
        assert_eq!(m.confidence, Confidence::High);
    }
}
