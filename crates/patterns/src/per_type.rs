// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Per-frame-type destination pattern selector (spec 041 iteration 2026-06-21,
//! T049 — FR-025/FR-026/FR-026a).
//!
//! Today a single light template is applied to every frame, producing
//! nonsensical calibration paths. This module maps a file's resolved frame-type
//! class (including master-vs-raw) to a distinct default destination pattern.
//!
//! # Pattern string form
//!
//! Per-type patterns are expressed as **path strings** rather than the
//! [`crate::Pattern`] (`Vec<PatternPart>`) model, because the defaults contain
//! literal path segments (`flats`, `darks`, `bias`, `masters`, …) that the
//! token/separator model does not represent. A `{token}` placeholder names a
//! token from the v1 registry ([`crate::V1_REGISTRY`]); any bare segment is a
//! literal directory name.
//!
//! [`validate_pattern_str`] reuses the registry as the single validation
//! authority for token names — it does not hand-roll a token vocabulary.

use crate::V1_REGISTRY;

// ── FrameTypeClass ─────────────────────────────────────────────────────────

/// The seven frame-type classes that have a distinct destination pattern
/// (spec 041 destination model).
///
/// Lights are never masters; the three `Master*` variants are integrations.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameTypeClass {
    /// Raw light frame.
    Light,
    /// Raw flat frame.
    Flat,
    /// Raw dark frame.
    Dark,
    /// Raw bias frame.
    Bias,
    /// Master (integrated) flat.
    MasterFlat,
    /// Master (integrated) dark.
    MasterDark,
    /// Master (integrated) bias.
    MasterBias,
}

impl FrameTypeClass {
    /// Stable string name for this class, used as the settings map key.
    ///
    /// These are the canonical keys persisted in the per-type pattern settings
    /// (`crates/persistence/db`), so they must remain stable.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Flat => "flat",
            Self::Dark => "dark",
            Self::Bias => "bias",
            Self::MasterFlat => "master_flat",
            Self::MasterDark => "master_dark",
            Self::MasterBias => "master_bias",
        }
    }

    /// Parse a class from its stable [`as_str`](Self::as_str) name.
    #[must_use]
    pub fn from_str_name(name: &str) -> Option<Self> {
        match name {
            "light" => Some(Self::Light),
            "flat" => Some(Self::Flat),
            "dark" => Some(Self::Dark),
            "bias" => Some(Self::Bias),
            "master_flat" => Some(Self::MasterFlat),
            "master_dark" => Some(Self::MasterDark),
            "master_bias" => Some(Self::MasterBias),
            _ => None,
        }
    }

    /// All seven classes, in declaration order. Useful for building the full
    /// per-type settings map.
    #[must_use]
    pub fn all() -> [FrameTypeClass; 7] {
        [
            Self::Light,
            Self::Flat,
            Self::Dark,
            Self::Bias,
            Self::MasterFlat,
            Self::MasterDark,
            Self::MasterBias,
        ]
    }
}

// ── Classification ─────────────────────────────────────────────────────────

/// Map a raw frame-type string + master flag to a [`FrameTypeClass`].
///
/// `frame_type` is matched case-insensitively against the normalized vocabulary
/// produced by `crates/metadata/core` (`light`/`dark`/`flat`/`bias`), plus the
/// common long-form synonyms (`light frame`, `dark frame`, …) that appear in raw
/// headers. Returns `None` for an unrecognized type.
///
/// `is_master` selects the master variant for flat/dark/bias. Lights are never
/// masters: a light with `is_master = true` still resolves to [`FrameTypeClass::Light`].
#[must_use]
pub fn classify_frame(frame_type: &str, is_master: bool) -> Option<FrameTypeClass> {
    let normalized = frame_type.trim().to_ascii_lowercase();
    let base = match normalized.as_str() {
        "light" | "light frame" | "lights" => Base::Light,
        "flat" | "flat frame" | "flats" | "flatfield" => Base::Flat,
        "dark" | "dark frame" | "darks" => Base::Dark,
        "bias" | "bias frame" | "biases" | "offset" => Base::Bias,
        _ => return None,
    };

    Some(match (base, is_master) {
        (Base::Light, _) => FrameTypeClass::Light,
        (Base::Flat, false) => FrameTypeClass::Flat,
        (Base::Flat, true) => FrameTypeClass::MasterFlat,
        (Base::Dark, false) => FrameTypeClass::Dark,
        (Base::Dark, true) => FrameTypeClass::MasterDark,
        (Base::Bias, false) => FrameTypeClass::Bias,
        (Base::Bias, true) => FrameTypeClass::MasterBias,
    })
}

#[derive(Clone, Copy)]
enum Base {
    Light,
    Flat,
    Dark,
    Bias,
}

// ── Default patterns ───────────────────────────────────────────────────────

/// The built-in default destination pattern for a class (research.md
/// "Iteration 2026-06-21: Destination model", authoritative).
///
/// `{token}` names a v1 registry token; every other segment is a literal.
#[must_use]
pub fn default_pattern(class: FrameTypeClass) -> &'static str {
    match class {
        FrameTypeClass::Light => "{target}/{filter}/{date}/light/",
        FrameTypeClass::Flat => "flats/{filter}/{date}/",
        FrameTypeClass::Dark => "darks/{exposure}/",
        FrameTypeClass::Bias => "bias/",
        FrameTypeClass::MasterFlat => "masters/flats/{filter}/",
        FrameTypeClass::MasterDark => "masters/darks/{exposure}/",
        FrameTypeClass::MasterBias => "masters/bias/",
    }
}

// ── Pattern-string validation ──────────────────────────────────────────────

/// Validate a per-type destination pattern string.
///
/// A pattern is valid when it is non-empty and every `{token}` placeholder it
/// contains names a token registered in [`crate::V1_REGISTRY`]. Bare segments
/// are accepted as literal directory names. Token-name validity is delegated to
/// the registry (the single authority) rather than re-listing the vocabulary
/// here.
///
/// Returns the offending token name on failure.
///
/// # Errors
///
/// Returns [`PatternStrError::Empty`] when the trimmed pattern is empty, or
/// [`PatternStrError::UnknownToken`] when a `{token}` placeholder is not
/// registered.
pub fn validate_pattern_str(pattern: &str) -> Result<(), PatternStrError> {
    if pattern.trim().is_empty() {
        return Err(PatternStrError::Empty);
    }
    for token in tokens_in(pattern) {
        if !V1_REGISTRY.contains(&token) {
            return Err(PatternStrError::UnknownToken { token });
        }
    }
    Ok(())
}

/// Resolve the effective pattern string for a class given an optional user
/// override.
///
/// Returns `override_pattern` when it is `Some`, non-empty, and passes
/// [`validate_pattern_str`]; otherwise falls back to [`default_pattern`].
#[must_use]
pub fn effective_pattern(class: FrameTypeClass, override_pattern: Option<&str>) -> String {
    match override_pattern {
        Some(p) if validate_pattern_str(p).is_ok() => p.to_owned(),
        _ => default_pattern(class).to_owned(),
    }
}

/// Errors from [`validate_pattern_str`].
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum PatternStrError {
    /// The pattern is empty (after trimming).
    #[error("pattern is empty")]
    Empty,
    /// A `{token}` placeholder names an unregistered token.
    #[error("unknown token: {token}")]
    UnknownToken {
        /// The unregistered token name (without braces).
        token: String,
    },
}

/// Extract the `{token}` placeholder names (without braces) from a pattern
/// string, in order. Unterminated `{` is ignored.
fn tokens_in(pattern: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut rest = pattern;
    while let Some(open) = rest.find('{') {
        let after = &rest[open + 1..];
        match after.find('}') {
            Some(close) => {
                tokens.push(after[..close].to_owned());
                rest = &after[close + 1..];
            }
            None => break,
        }
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_raw_types_case_insensitive() {
        assert_eq!(classify_frame("light", false), Some(FrameTypeClass::Light));
        assert_eq!(classify_frame("LIGHT", false), Some(FrameTypeClass::Light));
        assert_eq!(classify_frame("Light Frame", false), Some(FrameTypeClass::Light));
        assert_eq!(classify_frame("flat", false), Some(FrameTypeClass::Flat));
        assert_eq!(classify_frame("dark", false), Some(FrameTypeClass::Dark));
        assert_eq!(classify_frame("bias", false), Some(FrameTypeClass::Bias));
        assert_eq!(classify_frame("offset", false), Some(FrameTypeClass::Bias));
    }

    #[test]
    fn classify_masters() {
        assert_eq!(classify_frame("flat", true), Some(FrameTypeClass::MasterFlat));
        assert_eq!(classify_frame("dark", true), Some(FrameTypeClass::MasterDark));
        assert_eq!(classify_frame("bias", true), Some(FrameTypeClass::MasterBias));
    }

    #[test]
    fn lights_are_never_masters() {
        // A light flagged as master still resolves to the raw light class.
        assert_eq!(classify_frame("light", true), Some(FrameTypeClass::Light));
    }

    #[test]
    fn classify_unknown_returns_none() {
        assert_eq!(classify_frame("snapshot", false), None);
        assert_eq!(classify_frame("", false), None);
    }

    #[test]
    fn defaults_match_research() {
        assert_eq!(default_pattern(FrameTypeClass::Light), "{target}/{filter}/{date}/light/");
        assert_eq!(default_pattern(FrameTypeClass::Flat), "flats/{filter}/{date}/");
        assert_eq!(default_pattern(FrameTypeClass::Dark), "darks/{exposure}/");
        assert_eq!(default_pattern(FrameTypeClass::Bias), "bias/");
        assert_eq!(default_pattern(FrameTypeClass::MasterFlat), "masters/flats/{filter}/");
        assert_eq!(default_pattern(FrameTypeClass::MasterDark), "masters/darks/{exposure}/");
        assert_eq!(default_pattern(FrameTypeClass::MasterBias), "masters/bias/");
    }

    #[test]
    fn all_defaults_validate() {
        for class in FrameTypeClass::all() {
            assert!(
                validate_pattern_str(default_pattern(class)).is_ok(),
                "default for {} must validate",
                class.as_str()
            );
        }
    }

    #[test]
    fn class_name_roundtrip() {
        for class in FrameTypeClass::all() {
            assert_eq!(FrameTypeClass::from_str_name(class.as_str()), Some(class));
        }
        assert_eq!(FrameTypeClass::from_str_name("nope"), None);
    }

    #[test]
    fn validate_rejects_empty_and_unknown_token() {
        assert_eq!(validate_pattern_str(""), Err(PatternStrError::Empty));
        assert_eq!(validate_pattern_str("   "), Err(PatternStrError::Empty));
        assert_eq!(
            validate_pattern_str("{telescope}/x/"),
            Err(PatternStrError::UnknownToken { token: "telescope".to_owned() })
        );
    }

    #[test]
    fn validate_accepts_literal_only_and_mixed() {
        assert!(validate_pattern_str("bias/").is_ok());
        assert!(validate_pattern_str("masters/flats/{filter}/").is_ok());
    }

    #[test]
    fn effective_prefers_valid_override() {
        assert_eq!(
            effective_pattern(FrameTypeClass::Dark, Some("custom/{gain}/")),
            "custom/{gain}/"
        );
    }

    #[test]
    fn effective_falls_back_on_empty_or_invalid() {
        assert_eq!(effective_pattern(FrameTypeClass::Bias, None), "bias/");
        assert_eq!(effective_pattern(FrameTypeClass::Bias, Some("")), "bias/");
        assert_eq!(effective_pattern(FrameTypeClass::Bias, Some("{nope}/")), "bias/");
    }

    #[test]
    fn tokens_in_handles_unterminated_brace() {
        assert_eq!(tokens_in("{target}/x/{filter"), vec!["target".to_owned()]);
    }
}
