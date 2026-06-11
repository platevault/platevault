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

/// Minimal glob matcher supporting `*` (any chars) and `?` (one char).
fn glob_match(pattern: &str, text: &str) -> bool {
    glob_match_recursive(pattern.as_bytes(), text.as_bytes())
}

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
}
