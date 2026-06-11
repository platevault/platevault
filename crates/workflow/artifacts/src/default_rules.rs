//! Default PixInsight + Siril artifact classification rule sets (spec 012 T012).
//!
//! Rules are based on research item R-2 (naming conventions per tool).
//! They are consumed by `classifier::classify` and are intentionally static
//! so that no DB lookup is required at classification time.
//!
//! PixInsight conventions (case-insensitive prefix/suffix/glob):
//!   - MasterDark_*    → master   (high confidence)
//!   - MasterFlat_*    → master
//!   - MasterBias_*    → master
//!   - integration_*   → intermediate (stacked but not final)
//!   - *_c.xisf        → final (combined)
//!   - *_combined.*    → final
//!   - *_ABE.*         → intermediate (automated background extraction)
//!   - *_DBE.*         → intermediate
//!
//! Siril conventions:
//!   - master_dark.*   → master
//!   - master_flat.*   → master
//!   - master_bias.*   → master
//!   - pp_*.fit        → intermediate (pre-processed frames)
//!   - result.*        → final

use crate::rules::{ArtifactKind, ArtifactRule, MatchKind};

/// Return all default rules sorted by descending priority.
/// Callers should pass the returned slice directly to `classifier::classify`.
#[must_use]
#[allow(clippy::too_many_lines)] // list of static rules — splitting adds no clarity
pub fn all() -> Vec<ArtifactRule> {
    let mut rules = vec![
        // ── PixInsight master calibration files ──────────────────────────────
        ArtifactRule {
            id: "pi_master_dark",
            tool: "pixinsight",
            match_kind: MatchKind::Prefix,
            pattern: "MasterDark",
            kind: ArtifactKind::Master,
            confidence: 0.95,
            priority: 100,
        },
        ArtifactRule {
            id: "pi_master_flat",
            tool: "pixinsight",
            match_kind: MatchKind::Prefix,
            pattern: "MasterFlat",
            kind: ArtifactKind::Master,
            confidence: 0.95,
            priority: 100,
        },
        ArtifactRule {
            id: "pi_master_bias",
            tool: "pixinsight",
            match_kind: MatchKind::Prefix,
            pattern: "MasterBias",
            kind: ArtifactKind::Master,
            confidence: 0.95,
            priority: 100,
        },
        // ── PixInsight final outputs ──────────────────────────────────────────
        ArtifactRule {
            id: "pi_combined_suffix",
            tool: "pixinsight",
            match_kind: MatchKind::Suffix,
            pattern: "_combined",
            kind: ArtifactKind::Final,
            confidence: 0.85,
            priority: 90,
        },
        ArtifactRule {
            id: "pi_c_suffix",
            tool: "pixinsight",
            match_kind: MatchKind::Suffix,
            pattern: "_c",
            kind: ArtifactKind::Final,
            confidence: 0.80,
            priority: 85,
        },
        // ── PixInsight intermediate ───────────────────────────────────────────
        ArtifactRule {
            id: "pi_integration",
            tool: "pixinsight",
            match_kind: MatchKind::Prefix,
            pattern: "integration_",
            kind: ArtifactKind::Intermediate,
            confidence: 0.90,
            priority: 80,
        },
        ArtifactRule {
            id: "pi_abe",
            tool: "pixinsight",
            match_kind: MatchKind::Suffix,
            pattern: "_ABE",
            kind: ArtifactKind::Intermediate,
            confidence: 0.88,
            priority: 80,
        },
        ArtifactRule {
            id: "pi_dbe",
            tool: "pixinsight",
            match_kind: MatchKind::Suffix,
            pattern: "_DBE",
            kind: ArtifactKind::Intermediate,
            confidence: 0.88,
            priority: 80,
        },
        // ── Siril master calibration files ────────────────────────────────────
        ArtifactRule {
            id: "siril_master_dark",
            tool: "siril",
            match_kind: MatchKind::Prefix,
            pattern: "master_dark",
            kind: ArtifactKind::Master,
            confidence: 0.95,
            priority: 100,
        },
        ArtifactRule {
            id: "siril_master_flat",
            tool: "siril",
            match_kind: MatchKind::Prefix,
            pattern: "master_flat",
            kind: ArtifactKind::Master,
            confidence: 0.95,
            priority: 100,
        },
        ArtifactRule {
            id: "siril_master_bias",
            tool: "siril",
            match_kind: MatchKind::Prefix,
            pattern: "master_bias",
            kind: ArtifactKind::Master,
            confidence: 0.95,
            priority: 100,
        },
        // ── Siril final output ────────────────────────────────────────────────
        ArtifactRule {
            id: "siril_result",
            tool: "siril",
            match_kind: MatchKind::Prefix,
            pattern: "result",
            kind: ArtifactKind::Final,
            confidence: 0.80,
            priority: 70,
        },
        // ── Siril pre-processed frames ────────────────────────────────────────
        ArtifactRule {
            id: "siril_pp",
            tool: "siril",
            match_kind: MatchKind::Prefix,
            pattern: "pp_",
            kind: ArtifactKind::Intermediate,
            confidence: 0.88,
            priority: 80,
        },
    ];
    rules.sort_by_key(|r| std::cmp::Reverse(r.priority));
    rules
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_returns_non_empty_sorted_list() {
        let rules = all();
        assert!(!rules.is_empty());
        // Verify descending sort.
        for window in rules.windows(2) {
            assert!(window[0].priority >= window[1].priority);
        }
    }
}
