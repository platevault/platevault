//! `target.resolve` use case (spec 013, T008 + T016).
//!
//! Collapses the ranked [`TargetMatch`] list from the lookup pipeline into a
//! single [`ResolveOutcome`] per the ambiguity decision table (research.md R3).
//!
//! ## Decision table (R3)
//!
//! | Condition | Outcome |
//! |-----------|---------|
//! | `top_score >= 90` AND `second_score < top_score - 15` | `Resolved(high)` |
//! | `top_score >= 60` AND `second_score < top_score - 10` | `Resolved(medium)` |
//! | Multiple candidates within 15 points of top, OR multiple `high` candidates | `Ambiguous` |
//! | `top_score < 50` OR no candidates | `Unresolved` |

use crate::catalog::{Confidence, TargetMatch};

// ── ResolveOutcome ────────────────────────────────────────────────────────────

/// Outcome of the resolve decision.
#[derive(Clone, Debug, PartialEq)]
pub enum ResolveOutcome {
    /// Single confident match.
    Resolved { target: TargetMatch },
    /// Multiple candidates are too close to each other to pick one.
    Ambiguous { candidates: Vec<TargetMatch> },
    /// No candidate above the discard threshold.
    Unresolved,
    /// Catalog index failed to build from SQLite.
    CatalogUnavailable,
    /// Catalog tables are empty — first-run download not yet completed.
    CatalogNotInstalled,
}

/// Apply the R3 ambiguity decision policy to a ranked candidate list.
///
/// `candidates` MUST be sorted by score descending and already filtered to
/// be above the discard threshold (≥ 75 points, handled by the fuzzy module).
#[must_use]
pub fn apply_policy(mut candidates: Vec<TargetMatch>) -> ResolveOutcome {
    if candidates.is_empty() {
        return ResolveOutcome::Unresolved;
    }

    let top = &candidates[0];

    // Multiple `high` candidates → ambiguous.
    let high_count = candidates.iter().filter(|c| c.confidence == Confidence::High).count();
    if high_count > 1 {
        return ResolveOutcome::Ambiguous { candidates };
    }

    let top_score = top.score;
    let second_score = candidates.get(1).map_or(f64::NEG_INFINITY, |c| c.score);
    let gap = top_score - second_score;

    // Multiple `high` candidates or any candidate within 15 points of the top
    // → always ambiguous regardless of tier scores.
    // The gap-≤-15 check covers both the high tier (95/82/gap13) and the
    // medium tier (70/55/gap15) truth-table rows (research.md R3).
    let has_close_second = candidates.len() > 1 && gap <= 15.0;
    if has_close_second {
        let window: Vec<TargetMatch> =
            candidates.into_iter().take_while(|c| top_score - c.score <= 15.0).collect();
        return ResolveOutcome::Ambiguous { candidates: window };
    }

    // Only one candidate OR gap > 15 → apply tier thresholds.

    // Tier 1: high confidence — score ≥ 90 AND gap > 15 (or single candidate).
    if top_score >= 90.0 {
        let target = candidates.swap_remove(0);
        return ResolveOutcome::Resolved { target };
    }

    // Tier 2: medium confidence — score in [60, 90) AND gap > 10.
    // Since gap > 15 implies gap > 10, this covers 85/68/17 correctly.
    if top_score >= 60.0 {
        let target = candidates.swap_remove(0);
        return ResolveOutcome::Resolved { target };
    }

    // Score too low to be useful.
    ResolveOutcome::Unresolved
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{Confidence, MatchEvidence, MatchStrategy, TargetMatch};
    use uuid::Uuid;

    fn make_match(score: f64, id: &str) -> TargetMatch {
        let confidence = if score >= 90.0 {
            Confidence::High
        } else if score >= 75.0 {
            Confidence::Medium
        } else {
            Confidence::Low
        };
        TargetMatch {
            target_id: Uuid::new_v4(),
            primary_designation: id.to_owned(),
            primary_catalog_display: "Messier".to_owned(),
            confidence,
            score,
            evidence: MatchEvidence {
                matched_alias: id.to_owned(),
                normalized_query: "q".to_owned(),
                strategy: MatchStrategy::TokenSet,
                score,
            },
        }
    }

    // Truth-table tests from research.md R3.

    #[test]
    fn resolved_high_when_gap_gt_15_and_top_ge_90() {
        // top=95, second=79, gap=16 → resolved/high
        let candidates = vec![make_match(95.0, "M31"), make_match(79.0, "M32")];
        let outcome = apply_policy(candidates);
        assert!(
            matches!(&outcome, ResolveOutcome::Resolved { target } if (target.score - 95.0).abs() < f64::EPSILON),
            "expected Resolved with score 95.0"
        );
    }

    #[test]
    fn ambiguous_when_gap_le_15_top_ge_90() {
        // top=95, second=82, gap=13 → ambiguous
        let candidates = vec![make_match(95.0, "M31"), make_match(82.0, "M32")];
        let outcome = apply_policy(candidates);
        assert!(matches!(outcome, ResolveOutcome::Ambiguous { .. }));
    }

    #[test]
    fn resolved_medium_when_top_ge_60_gap_gt_10() {
        // top=85, second=68, gap=17 → resolved/medium
        let candidates = vec![make_match(85.0, "M31"), make_match(68.0, "M32")];
        let outcome = apply_policy(candidates);
        assert!(matches!(outcome, ResolveOutcome::Resolved { .. }));
    }

    #[test]
    fn ambiguous_when_top_ge_60_gap_le_10() {
        // top=85, second=76, gap=9 → ambiguous
        let candidates = vec![make_match(85.0, "M31"), make_match(76.0, "M32")];
        let outcome = apply_policy(candidates);
        assert!(matches!(outcome, ResolveOutcome::Ambiguous { .. }));
    }

    #[test]
    fn ambiguous_when_top_lt_90_gap_le_15() {
        // top=70, second=55, gap=15 → ambiguous (top < 90, gap ≤ 15)
        let candidates = vec![make_match(70.0, "M31"), make_match(55.0, "M32")];
        let outcome = apply_policy(candidates);
        assert!(matches!(outcome, ResolveOutcome::Ambiguous { .. }));
    }

    #[test]
    fn unresolved_when_top_lt_50() {
        // top=45 → unresolved
        let candidates = vec![make_match(45.0, "M31")];
        let outcome = apply_policy(candidates);
        assert_eq!(outcome, ResolveOutcome::Unresolved);
    }

    #[test]
    fn unresolved_on_empty_candidates() {
        let outcome = apply_policy(vec![]);
        assert_eq!(outcome, ResolveOutcome::Unresolved);
    }

    #[test]
    fn ambiguous_on_multiple_high_candidates() {
        // Two `high` (score ≥ 90) candidates → ambiguous regardless of gap.
        let candidates = vec![make_match(96.0, "M31"), make_match(92.0, "M32")];
        let outcome = apply_policy(candidates);
        assert!(matches!(outcome, ResolveOutcome::Ambiguous { .. }));
    }

    #[test]
    fn single_high_confidence_match_with_no_second() {
        // Only one candidate, score=95, gap=∞ → resolved/high.
        let candidates = vec![make_match(95.0, "M31")];
        let outcome = apply_policy(candidates);
        assert!(matches!(outcome, ResolveOutcome::Resolved { .. }));
    }
}
