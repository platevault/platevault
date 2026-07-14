// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Structural pattern validator (spec 015 T3.5).
//!
//! `validate(pattern, registry) -> ValidateResult` checks the pattern
//! structure without resolving against metadata. It:
//! - Returns `Err(ValidateError::Empty)` for an empty pattern.
//! - Returns `Err(ValidateError::UnknownToken)` for any unknown token name.
//! - Returns warnings for non-fatal structural issues (consecutive separators,
//!   leading separator, trailing separator, no path separator).

use crate::{registry::TokenRegistry, VALID_SEPARATORS};

// ── Warnings ───────────────────────────────────────────────────────────────

/// Non-fatal structural warnings (data-model.md §ValidateResult).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ValidationWarning {
    /// Two or more consecutive separator parts with no token between them.
    ConsecutiveSeparators,
    /// The first part of the pattern is a separator.
    LeadingSeparator,
    /// The last part of the pattern is a separator.
    TrailingSeparator,
    /// The pattern contains no `/` separator, so all resolved values will
    /// land in a single flat directory level.
    NoPathSeparator,
}

impl ValidationWarning {
    /// Return the canonical string code for this warning.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::ConsecutiveSeparators => "consecutive_separators",
            Self::LeadingSeparator => "leading_separator",
            Self::TrailingSeparator => "trailing_separator",
            Self::NoPathSeparator => "no_path_separator",
        }
    }
}

// ── Errors ─────────────────────────────────────────────────────────────────

/// Hard errors that make a pattern invalid (data-model.md §Errors).
#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum ValidateError {
    /// Pattern contains zero parts (data-model.md `pattern.empty`).
    #[error("pattern is empty")]
    Empty,
    /// Pattern references an unregistered token name (data-model.md `token.unknown`).
    #[error("unknown token: {token}")]
    UnknownToken { token: String },
    /// A separator value is not in the allowed set.
    #[error("invalid separator: {sep}")]
    InvalidSeparator { sep: String },
}

// ── ValidateResult ─────────────────────────────────────────────────────────

/// Result of structural pattern validation (data-model.md §ValidateResult).
#[derive(Clone, Debug)]
pub struct ValidateResult {
    /// `false` when any hard error is present.
    pub valid: bool,
    /// Non-fatal structural warnings.
    pub warnings: Vec<ValidationWarning>,
    /// Hard errors (at most one is populated in v1; stops at first error).
    pub errors: Vec<ValidateError>,
}

// ── validate ───────────────────────────────────────────────────────────────

/// Validate the structural integrity of a pattern without resolving metadata.
///
/// Hard errors (`pattern.empty`, `token.unknown`, invalid separator) make the
/// pattern invalid and are surfaced in `ValidateResult.errors`.
///
/// Non-fatal structural issues are reported as `warnings` even when `valid`.
#[must_use]
pub fn validate(pattern: &[crate::PatternPart], registry: &TokenRegistry) -> ValidateResult {
    // ── Hard error: empty pattern ──────────────────────────────────────────
    if pattern.is_empty() {
        return ValidateResult {
            valid: false,
            warnings: vec![],
            errors: vec![ValidateError::Empty],
        };
    }

    let mut errors: Vec<ValidateError> = vec![];

    // ── Hard error: unknown token / invalid separator ──────────────────────
    for part in pattern {
        match part.kind.as_str() {
            "token" => {
                if !registry.contains(&part.value) {
                    errors.push(ValidateError::UnknownToken { token: part.value.clone() });
                    // Accumulate all unknown tokens in one pass.
                }
            }
            "separator" => {
                if !VALID_SEPARATORS.contains(&part.value.as_str()) {
                    errors.push(ValidateError::InvalidSeparator { sep: part.value.clone() });
                }
            }
            _ => {
                // Unknown kind — treat as invalid separator for now.
                errors.push(ValidateError::InvalidSeparator { sep: part.value.clone() });
            }
        }
    }

    if !errors.is_empty() {
        return ValidateResult { valid: false, warnings: vec![], errors };
    }

    // ── Warnings (non-fatal) ───────────────────────────────────────────────
    let mut warnings: Vec<ValidationWarning> = vec![];

    // Leading separator check.
    if let Some(first) = pattern.first() {
        if first.kind == "separator" {
            warnings.push(ValidationWarning::LeadingSeparator);
        }
    }

    // Trailing separator check.
    if let Some(last) = pattern.last() {
        if last.kind == "separator" {
            warnings.push(ValidationWarning::TrailingSeparator);
        }
    }

    // Consecutive separators check.
    let has_consecutive =
        pattern.windows(2).any(|pair| pair[0].kind == "separator" && pair[1].kind == "separator");
    if has_consecutive {
        warnings.push(ValidationWarning::ConsecutiveSeparators);
    }

    // No path separator check.
    let has_path_sep = pattern.iter().any(|p| p.kind == "separator" && p.value == "/");
    if !has_path_sep {
        warnings.push(ValidationWarning::NoPathSeparator);
    }

    ValidateResult { valid: true, warnings, errors: vec![] }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use crate::PatternPart;

    use super::*;
    use crate::registry::V1_REGISTRY;

    fn tok(value: &str) -> PatternPart {
        PatternPart { id: value.to_owned(), kind: "token".to_owned(), value: value.to_owned() }
    }

    fn sep(value: &str) -> PatternPart {
        PatternPart {
            id: format!("sep-{value}"),
            kind: "separator".to_owned(),
            value: value.to_owned(),
        }
    }

    #[test]
    fn empty_pattern_is_invalid() {
        let result = validate(&[], &V1_REGISTRY);
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| matches!(e, ValidateError::Empty)));
    }

    #[test]
    fn unknown_token_is_invalid() {
        let pattern = vec![tok("telescope")];
        let result = validate(&pattern, &V1_REGISTRY);
        assert!(!result.valid);
        assert!(result
            .errors
            .iter()
            .any(|e| matches!(e, ValidateError::UnknownToken { token } if token == "telescope")));
    }

    #[test]
    fn all_v1_tokens_are_valid() {
        let tokens = [
            "target",
            "filter",
            "date",
            "frame_type",
            "camera",
            "exposure",
            "gain",
            "binning",
            "set_temp",
        ];
        for name in tokens {
            let pattern = vec![tok(name)];
            let result = validate(&pattern, &V1_REGISTRY);
            assert!(result.valid, "token {name} should be valid");
        }
    }

    #[test]
    fn valid_separators_pass() {
        for s in ["/", "-", "_", " "] {
            let pattern = vec![tok("target"), sep(s), tok("filter")];
            let result = validate(&pattern, &V1_REGISTRY);
            assert!(result.valid, "separator '{s}' should be valid");
        }
    }

    #[test]
    fn invalid_separator_is_invalid() {
        let pattern = vec![tok("target"), sep("."), tok("filter")];
        let result = validate(&pattern, &V1_REGISTRY);
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| matches!(e, ValidateError::InvalidSeparator { .. })));
    }

    #[test]
    fn trailing_separator_warning() {
        let pattern = vec![tok("target"), sep("/")];
        let result = validate(&pattern, &V1_REGISTRY);
        assert!(result.valid);
        assert!(result.warnings.contains(&ValidationWarning::TrailingSeparator));
    }

    #[test]
    fn leading_separator_warning() {
        let pattern = vec![sep("/"), tok("target")];
        let result = validate(&pattern, &V1_REGISTRY);
        assert!(result.valid);
        assert!(result.warnings.contains(&ValidationWarning::LeadingSeparator));
    }

    #[test]
    fn consecutive_separators_warning() {
        let pattern = vec![tok("target"), sep("/"), sep("-"), tok("filter")];
        let result = validate(&pattern, &V1_REGISTRY);
        assert!(result.valid);
        assert!(result.warnings.contains(&ValidationWarning::ConsecutiveSeparators));
    }

    #[test]
    fn no_path_separator_warning() {
        let pattern = vec![tok("target"), sep("-"), tok("filter")];
        let result = validate(&pattern, &V1_REGISTRY);
        assert!(result.valid);
        assert!(result.warnings.contains(&ValidationWarning::NoPathSeparator));
    }

    #[test]
    fn canonical_pattern_has_only_trailing_separator_warning() {
        // {target}/{filter}/{date}/{frame_type}/
        let pattern = vec![
            tok("target"),
            sep("/"),
            tok("filter"),
            sep("/"),
            tok("date"),
            sep("/"),
            tok("frame_type"),
            sep("/"),
        ];
        let result = validate(&pattern, &V1_REGISTRY);
        assert!(result.valid);
        // Should warn about trailing separator but nothing else.
        assert!(result.warnings.contains(&ValidationWarning::TrailingSeparator));
        assert!(!result.warnings.contains(&ValidationWarning::LeadingSeparator));
        assert!(!result.warnings.contains(&ValidationWarning::ConsecutiveSeparators));
        assert!(!result.warnings.contains(&ValidationWarning::NoPathSeparator));
    }
}
