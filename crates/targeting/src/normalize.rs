// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Query normalization pipeline for spec 013 (research.md R2, stage 1).
//!
//! Delegates to [`simbad_resolver::normalize`] — the published `simbad-resolver`
//! crate's own copy of this pipeline (NFKC normalization, ASCII casefold,
//! punctuation stripping, whitespace collapse, catalog-prefix expansion; see
//! that crate's docs for the full stage list). Before spec 052 (#701) this
//! module carried an independently maintained duplicate of the same
//! algorithm: the SQLite alias-lookup/override path (this crate, used by
//! `app_core_targets`) and the cache write/dedup path (`targeting_resolver`,
//! via the published crate directly) could silently drift apart and split
//! alias lookups for the same physical object. Spec 052 D6/T004 designates
//! `simbad_resolver::normalize` the sole choke-point; this module is now a
//! thin wrapper so every caller of `targeting::normalize` gets that same,
//! single implementation.
//!
//! The permanent cross-crate drift guard lives in
//! `crates/app/targets/tests/normalize_equivalence.rs`.

/// Normalize a free-form query string for catalog lookup.
///
/// Delegates to [`simbad_resolver::normalize::normalize`] (the single
/// normalization choke-point, spec 052 D6).
#[must_use]
pub fn normalize(input: &str) -> String {
    simbad_resolver::normalize::normalize(input)
}

/// Tokenize a normalized string into a sorted, deduplicated set of tokens.
///
/// Used by the token-set similarity matcher (research.md R2, stage 2).
/// Delegates to [`simbad_resolver::normalize::tokenize`].
#[must_use]
pub fn tokenize(normalized: &str) -> Vec<&str> {
    simbad_resolver::normalize::tokenize(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    // These are sanity checks on the public wrapper. The exhaustive
    // prefix/unicode corpus lives in `simbad_resolver`'s own test suite; the
    // cross-crate drift guard lives in
    // `crates/app/targets/tests/normalize_equivalence.rs`.

    #[test]
    fn normalize_casefolds() {
        assert_eq!(normalize("M31"), "m 31");
    }

    #[test]
    fn normalize_expands_ngc_prefix() {
        assert_eq!(normalize("NGC224"), "ngc 224");
        assert_eq!(normalize("NGC7000"), "ngc 7000");
    }

    #[test]
    fn normalize_with_existing_space_unchanged() {
        assert_eq!(normalize("NGC 224"), "ngc 224");
    }

    #[test]
    fn normalize_plain_name_unchanged() {
        assert_eq!(normalize("Andromeda Galaxy"), "andromeda galaxy");
    }

    #[test]
    fn normalize_trims_whitespace() {
        assert_eq!(normalize("  M31  "), "m 31");
    }

    #[test]
    fn normalize_empty_string_is_empty() {
        assert_eq!(normalize(""), "");
    }

    #[test]
    fn tokenize_splits_and_sorts() {
        let t = tokenize("ngc 5457");
        assert_eq!(t, vec!["5457", "ngc"]);
    }

    #[test]
    fn tokenize_deduplicates() {
        let t = tokenize("m m 31");
        assert_eq!(t, vec!["31", "m"]);
    }
}
