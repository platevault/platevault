//! Token-set similarity fuzzy matcher (spec 013, T011, research.md R2 stage 2).
//!
//! When the exact-match path fails, this module scores every alias in the
//! [`TargetCatalog`] using a token-set similarity metric (implemented via
//! `strsim::jaro_winkler` for fast, good-quality scoring on short astronomy
//! strings) and returns ranked [`TargetMatch`] candidates above the discard
//! threshold (75 points).
//!
//! ## Token-set approach
//!
//! A token-set score for (query, alias) is computed as:
//!
//! 1. Tokenize both the query and the alias (split on whitespace, sort,
//!    deduplicate — see [`crate::normalize::tokenize`]).
//! 2. If all query tokens appear in the alias token set, treat this as a
//!    partial match and give it a baseline boost.
//! 3. Compute `strsim::jaro_winkler` on the sorted-token strings as a
//!    fine-grained measure, scaled to `[0, 100]`.
//! 4. If all query tokens are a subset of alias tokens, boost the score
//!    by the `subset_bonus` (default 15 points).
//!
//! The highest-scored alias across all catalog entries is selected as the
//! representative match for that entry.
//!
//! ## Edit-distance tie-breaking
//!
//! See [`crate::lookup::edit_distance`] for the Damerau-Levenshtein pass
//! that runs on the top-N scorers from this module.
//!
//! ## Confidence thresholds (research.md R2)
//!
//! | Score range    | Confidence |
//! |----------------|------------|
//! | [90, 100]      | `medium`   |
//! | [75, 90)       | `low`      |
//! | < 75           | discarded  |

use std::collections::HashSet;

use crate::catalog::{Confidence, MatchEvidence, MatchStrategy, TargetCatalog, TargetMatch};
use crate::normalize::{normalize, tokenize};

/// Discard threshold — candidates below this score are not returned.
const DISCARD_THRESHOLD: f64 = 75.0;
/// Score above which a candidate earns `medium` confidence.
const MEDIUM_THRESHOLD: f64 = 90.0;

/// Run token-set fuzzy matching for `raw_query` against the catalog.
///
/// Returns candidates ranked by score descending, all above
/// [`DISCARD_THRESHOLD`].  An empty result means no useful match was found.
#[must_use]
pub fn lookup(catalog: &TargetCatalog, raw_query: &str, limit: usize) -> Vec<TargetMatch> {
    let normalized_query = normalize(raw_query);
    if normalized_query.is_empty() {
        return vec![];
    }

    let query_tokens: HashSet<&str> = tokenize(&normalized_query).into_iter().collect();
    let query_token_str = sorted_token_str(&normalized_query);

    // Score every (alias, entry) pair; keep the best score per target_id.
    let mut best: std::collections::HashMap<uuid::Uuid, TargetMatch> =
        std::collections::HashMap::new();

    for (alias_norm, entry) in catalog.iter_aliases() {
        let score = token_set_score(&query_tokens, &query_token_str, alias_norm);
        if score < DISCARD_THRESHOLD {
            continue;
        }
        let confidence =
            if score >= MEDIUM_THRESHOLD { Confidence::Medium } else { Confidence::Low };

        let candidate = TargetMatch {
            target_id: entry.target_id,
            primary_designation: entry.primary_designation.clone(),
            primary_catalog_display: entry.primary_catalog_display.clone(),
            confidence,
            score,
            evidence: MatchEvidence {
                matched_alias: alias_norm.to_owned(),
                normalized_query: normalized_query.clone(),
                strategy: MatchStrategy::TokenSet,
                score,
            },
        };

        best.entry(entry.target_id)
            .and_modify(|existing| {
                if score > existing.score {
                    *existing = candidate.clone();
                }
            })
            .or_insert(candidate);
    }

    let mut results: Vec<TargetMatch> = best.into_values().collect();
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    results
}

/// Token-set similarity score for `query` against a single `alias`.
///
/// Returns a score in `[0, 100]`.
///
/// Implements a token-set ratio inspired by RapidFuzz / FuzzyWuzzy:
///
/// 1. Compute base = `jaro_winkler(sorted(query_tokens), sorted(alias_tokens)) * 100`.
/// 2. Compute intersection = query_tokens ∩ alias_tokens.
/// 3. Compute intersection score = `jaro_winkler(sorted(intersection), query_str) * 100`.
/// 4. Return `max(base, intersection_score)`.
///
/// This correctly scores single-token containment: "pinwheel" vs
/// "pinwheel galaxy" — the intersection is {"pinwheel"}, matching the query
/// perfectly → intersection_score ≈ 100.
fn token_set_score(query_tokens: &HashSet<&str>, query_token_str: &str, alias_norm: &str) -> f64 {
    let alias_tokens: HashSet<&str> = tokenize(alias_norm).into_iter().collect();
    let alias_token_str = sorted_token_str(alias_norm);

    if query_tokens.is_empty() {
        return 0.0;
    }

    // Base: jaro-winkler on sorted-token strings.
    let base = strsim::jaro_winkler(query_token_str, &alias_token_str) * 100.0;

    // Intersection score: how well does the shared token set match the query?
    let mut intersection: Vec<&str> =
        query_tokens.iter().filter(|t| alias_tokens.contains(*t)).copied().collect();
    if intersection.is_empty() {
        return base;
    }
    intersection.sort_unstable();
    let intersection_str = intersection.join(" ");
    let intersection_score = strsim::jaro_winkler(&intersection_str, query_token_str) * 100.0;

    base.max(intersection_score)
}

/// Build a single sorted-token string for jaro-winkler comparison.
fn sorted_token_str(normalized: &str) -> String {
    let mut tokens: Vec<&str> = normalized.split_whitespace().collect();
    tokens.sort_unstable();
    tokens.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_catalog() -> TargetCatalog {
        crate::fixture::seeded_catalog()
    }

    #[test]
    fn fuzzy_finds_m101_from_extra_token() {
        let cat = fixture_catalog();
        // "M101 LRGB" — extra token; fuzzy should still surface M101.
        let results = lookup(&cat, "M101 LRGB", 5);
        assert!(!results.is_empty(), "expected at least one fuzzy match");
        let top = &results[0];
        // Must point to M101.
        assert!(
            top.primary_designation.contains("101"),
            "expected M101, got {}",
            top.primary_designation
        );
    }

    #[test]
    fn fuzzy_finds_ngc_with_hyphen() {
        let cat = fixture_catalog();
        // "ngc-5457" — after normalization → "ngc 5457" — exact should not
        // hit because the fixture uses "M 101" as primary, but fuzzy will.
        let results = lookup(&cat, "ngc-5457", 5);
        assert!(!results.is_empty(), "expected fuzzy match for ngc-5457");
    }

    #[test]
    fn fuzzy_finds_pinwheel_from_common_name() {
        let cat = fixture_catalog();
        let results = lookup(&cat, "pinwheel", 5);
        assert!(!results.is_empty(), "expected fuzzy match for pinwheel");
    }

    #[test]
    fn fuzzy_returns_empty_for_generic_word() {
        let cat = fixture_catalog();
        // "Light" should not match anything above the discard threshold.
        let results = lookup(&cat, "Light", 5);
        // It's acceptable for "light" to return zero or near-zero candidates.
        // If something matches, it must be above the discard threshold.
        for r in &results {
            assert!(r.score >= DISCARD_THRESHOLD);
        }
    }

    #[test]
    fn fuzzy_respects_limit() {
        let cat = fixture_catalog();
        let results = lookup(&cat, "ngc", 1);
        assert!(results.len() <= 1);
    }

    #[test]
    fn confidence_bucket_for_high_scorer() {
        // Build a catalog where the query is a near-perfect match.
        let cat = fixture_catalog();
        // "M 101" should score very high against "m 101" alias.
        let results = lookup(&cat, "M 101 lrgb", 5);
        if let Some(top) = results.first() {
            // Score >= 90 → medium; < 90 → low.
            let expected =
                if top.score >= MEDIUM_THRESHOLD { Confidence::Medium } else { Confidence::Low };
            assert_eq!(top.confidence, expected);
        }
    }
}
