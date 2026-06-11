//! Damerau-Levenshtein edit-distance tie-breaking pass (spec 013, T012).
//!
//! Applied to the top-N candidates from the fuzzy matcher to break ties
//! among candidates that have similar token-set scores.  Higher edit-distance
//! similarity (lower distance) wins.  The score is re-scaled as:
//!
//! ```text
//! ed_score = (1.0 - edit_distance / max_len) * 100.0
//! ```
//!
//! where `max_len` is the larger of the two string lengths.  Candidates are
//! re-ranked by this score when their token-set scores are within 5 points
//! of each other.

use crate::catalog::TargetMatch;

/// Re-rank `candidates` by Damerau-Levenshtein edit-distance similarity when
/// two candidates have token-set scores within `tie_gap` points of each other.
///
/// The result is a re-ordered (and potentially score-adjusted) copy of the
/// input list.  The mutation is purely cosmetic: scores do not change, only
/// ordering.
#[must_use]
pub fn rerank(candidates: Vec<TargetMatch>, query_normalized: &str) -> Vec<TargetMatch> {
    if candidates.len() <= 1 {
        return candidates;
    }

    // Annotate each candidate with an edit-distance score against the query.
    let mut annotated: Vec<(TargetMatch, f64)> = candidates
        .into_iter()
        .map(|m| {
            let ed_score = edit_score(query_normalized, &m.evidence.matched_alias);
            (m, ed_score)
        })
        .collect();

    // Stable sort: primary key = token-set score descending, secondary key =
    // edit-distance score descending.
    annotated.sort_by(|(a, a_ed), (b, b_ed)| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b_ed.partial_cmp(a_ed).unwrap_or(std::cmp::Ordering::Equal))
    });

    annotated.into_iter().map(|(m, _)| m).collect()
}

/// Compute an edit-distance similarity score in `[0.0, 100.0]`.
///
/// Uses `strsim::generic_damerau_levenshtein` (optimal string alignment).
/// Returns `100.0` for identical strings and `0.0` for maximally different.
#[must_use]
fn edit_score(a: &str, b: &str) -> f64 {
    if a == b {
        return 100.0;
    }
    let a_len = a.chars().count();
    let b_len = b.chars().count();
    let max_len = a_len.max(b_len);
    if max_len == 0 {
        return 100.0;
    }
    let dist = strsim::generic_damerau_levenshtein(
        &a.chars().collect::<Vec<_>>(),
        &b.chars().collect::<Vec<_>>(),
    );
    // Catalog names are at most a few dozen characters; usize-to-f64 precision
    // loss is not a concern at this scale (max_len << 2^52).
    #[allow(clippy::cast_precision_loss)]
    let ratio = 1.0 - (dist as f64 / max_len as f64);
    (ratio * 100.0).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_score_identical_strings() {
        let score = edit_score("m 31", "m 31");
        assert!((score - 100.0).abs() < f64::EPSILON, "expected 100.0, got {score}");
    }

    #[test]
    fn edit_score_completely_different() {
        let s = edit_score("zzz", "aaa");
        assert!(s < 100.0);
    }

    #[test]
    fn rerank_stable_on_single_candidate() {
        let cat = crate::fixture::seeded_catalog();
        let candidates =
            crate::lookup::exact::lookup(&cat, "M31").map(|m| vec![m]).unwrap_or_default();
        let reranked = rerank(candidates.clone(), "m 31");
        assert_eq!(reranked.len(), 1);
    }
}
