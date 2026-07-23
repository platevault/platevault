#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Layer-1 integration tests for the token pattern builder (spec 015).
//!
//! These tests exercise the full public API of the `patterns` crate:
//! parse a [`Pattern`] (build from [`PatternPart`] values), validate it
//! with [`validate`], and resolve it with [`resolve_v1`].  No database or
//! async runtime is required — the crate is pure in-memory.

use std::collections::HashMap;

use patterns::{
    resolve_v1, validate, MetadataBundle, PatternPart, ResolveError, ValidateError,
    ValidationWarning, V1_REGISTRY,
};

// ── Helpers ────────────────────────────────────────────────────────────────

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

fn meta(pairs: &[(&str, &str)]) -> MetadataBundle {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect()
}

// ── TC-1: Parse and validate a well-formed canonical pattern ───────────────

/// Build the canonical astrophotography pattern `{target}/{filter}/{date}/{frame_type}/`
/// from [`PatternPart`] values and assert structural validation passes with
/// only a trailing-separator warning.
#[test]
fn canonical_pattern_validates_with_trailing_separator_warning() {
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

    assert!(result.valid, "canonical pattern must be structurally valid");
    assert!(
        result.warnings.contains(&ValidationWarning::TrailingSeparator),
        "expected trailing-separator warning"
    );
    // No other warnings expected.
    assert!(
        !result.warnings.contains(&ValidationWarning::LeadingSeparator),
        "unexpected leading-separator warning"
    );
    assert!(
        !result.warnings.contains(&ValidationWarning::ConsecutiveSeparators),
        "unexpected consecutive-separators warning"
    );
    assert!(
        !result.warnings.contains(&ValidationWarning::NoPathSeparator),
        "unexpected no-path-separator warning"
    );
    assert!(result.errors.is_empty(), "no hard errors expected");
}

// ── TC-2: Resolve a canonical pattern against full metadata ────────────────

/// Build the canonical pattern and resolve it against a complete
/// [`MetadataBundle`].  Asserts the produced relative path matches the
/// expected forward-slash string and that no tokens are reported missing.
#[test]
fn canonical_pattern_resolves_to_expected_path() {
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
    let metadata = meta(&[
        ("target", "M101"),
        ("filter", "Ha"),
        ("date", "2026-04-12"),
        ("frame_type", "Light"),
    ]);

    let result = resolve_v1(&pattern, &metadata).expect("resolve must succeed");

    // frame_type uses Lower transform so "Light" → "light".
    assert_eq!(result.relative_path, "M101/Ha/2026-04-12/light/");
    assert!(
        result.missing_tokens.is_empty(),
        "no missing tokens expected when all metadata is present"
    );
}

// ── TC-3: Missing metadata uses fallback and is reported ──────────────────

/// Resolve a pattern whose metadata bundle omits several tokens.  Each absent
/// token must appear in `missing_tokens` and the fallback value must be used
/// in the produced path.
#[test]
fn missing_metadata_fields_use_fallbacks_and_are_reported() {
    // Pattern: {target}/{filter}  — metadata provides target only.
    let pattern = vec![tok("target"), sep("/"), tok("filter")];
    let metadata: MetadataBundle = HashMap::from([("target".to_owned(), "NGC7000".to_owned())]);

    let result = resolve_v1(&pattern, &metadata).expect("resolve must succeed with fallbacks");

    // "filter" is absent → fallback "nofilter".
    assert_eq!(
        result.relative_path, "NGC7000/nofilter",
        "absent filter must use 'nofilter' fallback"
    );
    assert!(
        result.missing_tokens.contains(&"filter".to_owned()),
        "absent filter must be reported in missing_tokens"
    );
    assert!(
        !result.missing_tokens.contains(&"target".to_owned()),
        "present target must not appear in missing_tokens"
    );
}

// ── TC-4: Unknown token name produces a hard error ─────────────────────────

/// A pattern that references a token name not in the v1 registry must be
/// rejected both by [`validate`] and by [`resolve_v1`] with
/// `ResolveError::UnknownToken`.
#[test]
fn unknown_token_name_is_rejected() {
    let pattern = vec![tok("telescope"), sep("/"), tok("target")];

    // Validate path.
    let vresult = validate(&pattern, &V1_REGISTRY);
    assert!(!vresult.valid, "pattern with unknown token must be invalid");
    assert!(
        vresult.errors.iter().any(|e| matches!(
            e,
            ValidateError::UnknownToken { token } if token == "telescope"
        )),
        "expected UnknownToken error for 'telescope'"
    );

    // Resolve path must also fail.
    let rresult = resolve_v1(&pattern, &meta(&[]));
    assert!(
        matches!(rresult, Err(ResolveError::UnknownToken { token }) if token == "telescope"),
        "resolve must return UnknownToken for unregistered token 'telescope'"
    );
}
