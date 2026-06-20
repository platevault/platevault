//! `ArtifactRule` shape for the artifact classifier (spec 012 T011).
//!
//! Rules are loaded from workflow-profile seeds. Each rule maps a file
//! name pattern to an `ArtifactKind` with an associated confidence level.
//! Higher priority wins; manual overrides are treated as priority ∞.
//!
//! Constitution III: classification reads filenames and extensions only.
//! The app never opens a file for processing or modification.

use serde::{Deserialize, Serialize};

/// Classification kind: coarse signal for how relevant an artifact is.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    Intermediate,
    Master,
    Final,
}

impl ArtifactKind {
    /// Canonical string representation as stored in SQLite.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Intermediate => "intermediate",
            Self::Master => "master",
            Self::Final => "final",
        }
    }

    /// Parse from the SQLite string representation.
    ///
    /// # Errors
    /// Returns `Err` if the value is not a recognised kind.
    pub fn try_from_str(s: &str) -> Result<Self, String> {
        match s {
            "intermediate" => Ok(Self::Intermediate),
            "master" => Ok(Self::Master),
            "final" => Ok(Self::Final),
            other => Err(format!("unknown ArtifactKind: {other}")),
        }
    }
}

/// How the pattern is matched against a filename stem or full name.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchKind {
    /// Exact file name match (case-insensitive).
    Literal,
    /// File name starts with `pattern` (case-insensitive).
    Prefix,
    /// File name ends with `pattern` (case-insensitive), applied to the name without extension.
    Suffix,
    /// Glob pattern matched against the file name (case-insensitive).
    /// Only `*` and `?` wildcards are supported (no directory traversal).
    Glob,
}

/// A single classification rule scoped to a workflow profile.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArtifactRule {
    /// Stable identifier within the profile.
    pub id: &'static str,
    /// The workflow-profile tool id this rule belongs to (e.g. `pixinsight`).
    pub tool: &'static str,
    /// How to interpret `pattern`.
    pub match_kind: MatchKind,
    /// The pattern body (matched case-insensitively).
    pub pattern: &'static str,
    /// Kind to assign when the rule matches.
    pub kind: ArtifactKind,
    /// Confidence value in \[0, 1\].
    pub confidence: f64,
    /// Higher priority wins when multiple rules match.
    pub priority: i32,
}

impl ArtifactRule {
    /// Test whether this rule matches `file_name` (the name component only, not path).
    #[must_use]
    pub fn matches(&self, file_name: &str) -> bool {
        let lower = file_name.to_ascii_lowercase();
        let pat = self.pattern.to_ascii_lowercase();
        match self.match_kind {
            MatchKind::Literal => lower == pat,
            MatchKind::Prefix => lower.starts_with(pat.as_str()),
            MatchKind::Suffix => {
                // Suffix match on the stem (name without the last extension).
                let stem = stem_of(&lower);
                stem.ends_with(pat.as_str())
            }
            MatchKind::Glob => glob_match(&pat, &lower),
        }
    }
}

/// Return the name without its last extension component.
fn stem_of(name: &str) -> &str {
    match name.rfind('.') {
        Some(dot) => &name[..dot],
        None => name,
    }
}

/// Glob matcher supporting `*` (any chars) and `?` (one char), via `globset`.
///
/// Both `pattern` and `text` are already lowercased by [`ArtifactRule::matches`],
/// so case handling is preserved and the `globset` matcher is built
/// case-sensitively. `literal_separator(false)` keeps `*`/`?` matching any
/// character (including `/`), matching the prior hand-rolled recursion which had
/// no path semantics; `backslash_escape(false)` keeps `\` a literal byte.
///
/// `globset` reserves `[`…`]`, `{`…`}` and `**` for richer semantics the
/// hand-rolled matcher treated as literals. The documented supported surface is
/// `*`/`?` only and no in-use rule uses those metacharacters (see the
/// `globset_matches_handrolled_matrix` equivalence test). For any pattern
/// `globset` cannot compile, fall back to the byte-recursive matcher so no
/// pattern regresses.
fn glob_match(pattern: &str, text: &str) -> bool {
    match globset::GlobBuilder::new(pattern)
        .literal_separator(false)
        .backslash_escape(false)
        .build()
    {
        Ok(glob) => glob.compile_matcher().is_match(text),
        Err(_) => glob_match_recursive(pattern.as_bytes(), text.as_bytes()),
    }
}

/// Byte-recursive `*`/`?` matcher retained as the equivalence reference and as a
/// compile-failure fallback for [`glob_match`].
fn glob_match_recursive(pattern: &[u8], text: &[u8]) -> bool {
    match (pattern.first(), text.first()) {
        (None, None) => true,
        (None, Some(_)) | (Some(_), None) => false,
        (Some(b'*'), _) => {
            // `*` can match zero or more characters.
            glob_match_recursive(&pattern[1..], text)
                || (!text.is_empty() && glob_match_recursive(pattern, &text[1..]))
        }
        (Some(b'?'), Some(_)) => glob_match_recursive(&pattern[1..], &text[1..]),
        (Some(p), Some(t)) => *p == *t && glob_match_recursive(&pattern[1..], &text[1..]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(match_kind: MatchKind, pattern: &'static str, kind: ArtifactKind) -> ArtifactRule {
        ArtifactRule {
            id: "test",
            tool: "pixinsight",
            match_kind,
            pattern,
            kind,
            confidence: 0.9,
            priority: 10,
        }
    }

    #[test]
    fn prefix_matches_case_insensitive() {
        let r = rule(MatchKind::Prefix, "MasterDark", ArtifactKind::Master);
        assert!(r.matches("MasterDark_bin1x1.xisf"));
        assert!(r.matches("masterdark_bin1x1.xisf"));
        assert!(!r.matches("integration_M31.xisf"));
    }

    #[test]
    fn suffix_matches_stem_only() {
        let r = rule(MatchKind::Suffix, "_c", ArtifactKind::Final);
        assert!(r.matches("M31_c.xisf"));
        assert!(!r.matches("M31_combined.xisf")); // suffix is "_combined", not "_c"
    }

    #[test]
    fn glob_star_wildcard() {
        let r = rule(MatchKind::Glob, "integration_*.xisf", ArtifactKind::Intermediate);
        assert!(r.matches("integration_M31.xisf"));
        assert!(r.matches("integration_NGC3628_Ha.xisf"));
        assert!(!r.matches("masterflat_integration.xisf"));
    }

    #[test]
    fn glob_question_wildcard() {
        let r = rule(MatchKind::Glob, "m??.xisf", ArtifactKind::Intermediate);
        assert!(r.matches("m31.xisf"));
        assert!(!r.matches("m3.xisf"));
    }

    #[test]
    fn literal_exact() {
        let r = rule(MatchKind::Literal, "output.xisf", ArtifactKind::Final);
        assert!(r.matches("output.xisf"));
        assert!(r.matches("OUTPUT.XISF")); // case insensitive
        assert!(!r.matches("output2.xisf"));
    }

    /// T202 equivalence matrix: assert the `globset`-backed [`glob_match`]
    /// reproduces the prior byte-recursive [`glob_match_recursive`] for every
    /// (pattern × input) cell drawn from the `*`/`?` surface the `Glob` match
    /// kind supports.
    ///
    /// In-use `ArtifactRule` seeds (`default_rules.rs`) currently use only
    /// `Prefix`/`Suffix` kinds — **zero `Glob` rules exist** — so the patterns
    /// here cover the documented glob surface (`*`/`?`) plus the patterns the
    /// `glob_*_wildcard` unit tests exercise. All inputs are already lowercased
    /// by `ArtifactRule::matches`, so the matrix uses lowercase patterns/inputs
    /// to mirror the real call.
    ///
    /// Patterns whose LAST character is a bare `*` are excluded here and covered
    /// separately by [`globset_fixes_trailing_star_latent_bug`]: the prior
    /// recursion had a latent bug where a trailing `*` was routed through the
    /// `(Some(_), None)` arm at end-of-text and so never matched. `globset`
    /// implements the documented "`*` = any chars" intent correctly. No in-use
    /// rule (and none of the existing unit tests) uses a trailing bare `*`, so
    /// that fix is behavior-neutral for every real classification.
    #[test]
    fn globset_matches_handrolled_matrix() {
        // Glob patterns the `Glob` arm is documented to support (`*`/`?` only),
        // each terminating in a literal so the hand-rolled recursion is correct.
        let patterns = [
            "integration_*.xisf", // from `glob_star_wildcard`
            "m??.xisf",           // from `glob_question_wildcard`
            "*.xisf",             // leading star + literal extension
            "master*flat*.xisf",  // multiple stars, literal tail
            "ngc?.fits",          // single `?` mid-pattern
            "literal.xisf",       // no wildcards (degenerate)
            "*_ha.xisf",          // leading star, literal tail
            "pre*_*post.xit",     // stars on both sides of a token
        ];
        // Inputs spanning matches, near-misses, empties, and separators.
        let inputs = [
            "integration_m31.xisf",
            "integration_ngc3628_ha.xisf",
            "masterflat_integration.xisf",
            "m31.xisf",
            "m3.xisf",
            "output.xisf",
            "m31.fits",
            "ngc7.fits",
            "ngc77.fits",
            "masterxflatx.xisf",
            "a/b.xisf", // separator: `*` must cross `/` (literal_separator(false))
            "",
            "literal.xisf",
            "x_ha.xisf",
            "pre_mid_post.xit",
        ];

        for pat in patterns {
            for input in inputs {
                let expected = glob_match_recursive(pat.as_bytes(), input.as_bytes());
                let actual = glob_match(pat, input);
                assert_eq!(
                    actual, expected,
                    "glob divergence: pattern={pat:?} input={input:?} \
                     globset={actual} handrolled={expected}"
                );
            }
        }
    }

    /// T202 documents the one intentional, beneficial divergence found while
    /// building the equivalence matrix: a pattern ending in a bare `*` never
    /// matched under the old byte-recursive matcher (the `(Some(_), None)` arm
    /// shadowed the `*`-at-end case), while `globset` correctly treats `*` as
    /// "any characters". This branch is unreachable by any in-use rule, so the
    /// fix changes no real classification — it only removes a latent bug.
    #[test]
    fn globset_fixes_trailing_star_latent_bug() {
        // Old matcher: trailing bare `*` never matched a non-empty (or empty) name.
        assert!(!glob_match_recursive(b"*", b"anything.xisf"));
        assert!(!glob_match_recursive(b"*", b""));
        assert!(!glob_match_recursive(b"master*", b"masterdark"));
        // globset: documented "match anything" semantics.
        assert!(glob_match("*", "anything.xisf"));
        assert!(glob_match("*", ""));
        assert!(glob_match("master*", "masterdark"));
    }
}
