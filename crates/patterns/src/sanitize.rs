//! OS-path sanitization pipeline (spec 015 T3.3, data-model.md §Errors).
//!
//! Steps (applied in order):
//! 1. NFC normalization + strip C0/C1 controls, format chars, bidi overrides.  (Ref: A1)
//! 2. OS character substitution: Windows reserved chars → `_`, trim leading/trailing whitespace and dots.
//! 3. Path-traversal rejection: `.` or `..` → `path.traversal`.  (Ref: A2)
//! 4. Windows reserved device-name rejection (CON, PRN, AUX, NUL, COM1–9, LPT1–9),
//!    case-insensitive, all platforms → `path.reserved_name`.  (Ref: A3)
//! 5. Unicode confusables detection via `unicode-security` → `pattern.invalid.unicode`.  (Ref: A1)
//!
//! Each step is exposed individually so the resolver can call them in sequence
//! and surface the first hard error.

use unicode_normalization::UnicodeNormalization;
use unicode_security::MixedScript;

// ── Sanitize errors ────────────────────────────────────────────────────────

/// Errors that the sanitize pipeline can surface.
#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum SanitizeError {
    /// Token value equals `.` or `..`, or the assembled path contains `..`.
    #[error("path traversal attempt in segment: {segment}")]
    PathTraversal { segment: String },
    /// Path segment matches a Windows reserved device name.
    #[error("Windows reserved device name: {segment}")]
    ReservedName { segment: String },
    /// Token value contains Unicode confusables or disallowed characters.
    #[error("Unicode confusables or disallowed chars in token {token}: {value}")]
    UnicodeConfusable { token: String, value: String },
}

// ── Step 1: NFC + strip disallowed code-points ─────────────────────────────

/// C0 controls: U+0000–U+001F (but space U+0020 is allowed in separators only;
/// for token values it is stripped here and re-added if the token value
/// contains a meaningful space — in practice raw FITS values do not).
///
/// C1 controls: U+0080–U+009F.
/// Format characters: Unicode category Cf (bidi overrides U+200B, U+FEFF, etc.).
fn is_disallowed(c: char) -> bool {
    let cp = c as u32;
    // C0 controls (except we keep printable ASCII range U+0020–U+007E)
    if cp < 0x20 {
        return true;
    }
    // C1 controls
    if (0x80..=0x9F).contains(&cp) {
        return true;
    }
    // Unicode category Cf (format characters) — covers bidi overrides,
    // zero-width spaces, word joiners, etc.
    matches!(
        c,
        '\u{00AD}' // soft hyphen
        | '\u{200B}'..='\u{200F}' // zero-width sp, LRM, RLM, etc.
        | '\u{2028}'..='\u{202E}' // line/paragraph sep, bidi overrides
        | '\u{2060}'..='\u{206F}' // word joiner, inhibit symmetric, etc.
        | '\u{FE00}'..='\u{FE0F}' // variation selectors
        | '\u{FEFF}'              // BOM / zero-width no-break space
        | '\u{FFF9}'..='\u{FFFB}' // annotation chars
    )
}

/// Step 1: NFC-normalize the string and strip C0/C1 controls, format
/// characters, and bidi override code points.
///
/// Returns the cleaned string. Never errors.
#[must_use]
pub fn step1_normalize_and_strip(input: &str) -> String {
    // NFC normalization followed by disallowed-char removal.
    input.nfc().filter(|c| !is_disallowed(*c)).collect()
}

// ── Step 2: OS character substitution ──────────────────────────────────────

/// Characters that are illegal in Windows filenames / path segments.
/// `/` and `\` are path delimiters; `?`, `*`, `"`, `<`, `>`, `|`, `:` are
/// Windows-reserved. They are mapped to `_`.
fn is_windows_reserved_char(c: char) -> bool {
    matches!(c, '\\' | ':' | '?' | '*' | '"' | '<' | '>' | '|')
}

/// Step 2: Replace Windows-reserved characters with `_`, then trim leading/
/// trailing whitespace and dots.
///
/// The `/` separator is **not** substituted here — segment splitting is done
/// by the resolver before calling sanitize. Individual token values should
/// never contain `/`; if they do the resolver will catch path-traversal issues.
#[must_use]
pub fn step2_substitute_reserved_chars(input: &str) -> String {
    let substituted: String =
        input.chars().map(|c| if is_windows_reserved_char(c) { '_' } else { c }).collect();
    // Trim leading/trailing dots and whitespace (Windows disallows trailing dot
    // and leading/trailing spaces in path segment names).
    substituted.trim_matches(|c: char| c == '.' || c.is_whitespace()).to_owned()
}

// ── Step 3: Path-traversal check ───────────────────────────────────────────

/// Step 3: Return an error if the segment equals `.` or `..`.
///
/// The assembled path is also checked by the resolver for embedded `..`
/// segments (which can arise from unusual token values that survive step 2).
///
/// # Errors
/// Returns [`SanitizeError::PathTraversal`] when `segment` is `.` or `..`.
pub fn step3_traversal_check(segment: &str) -> Result<(), SanitizeError> {
    if segment == "." || segment == ".." {
        return Err(SanitizeError::PathTraversal { segment: segment.to_owned() });
    }
    Ok(())
}

// ── Step 4: Windows reserved device name check ─────────────────────────────

/// Windows device names that must not appear as path segment names.
///
/// Checked case-insensitively on all platforms (constitution requirement).
static WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Step 4: Return an error if the segment (after prior sanitization) matches
/// a Windows reserved device name, case-insensitively.
///
/// # Errors
/// Returns [`SanitizeError::ReservedName`] when the segment is a reserved name.
pub fn step4_reserved_name_check(segment: &str) -> Result<(), SanitizeError> {
    let upper = segment.to_uppercase();
    if WINDOWS_RESERVED_NAMES.contains(&upper.as_str()) {
        return Err(SanitizeError::ReservedName { segment: segment.to_owned() });
    }
    Ok(())
}

// ── Step 5: Unicode confusables check ──────────────────────────────────────

/// Step 5: Check the sanitized value for Unicode confusables using the
/// `unicode-security` crate's mixed-script confusable detection.
///
/// # Errors
/// Returns [`SanitizeError::UnicodeConfusable`] when the value is detected as
/// a confusable by the `unicode-security` mixed-script profile.
pub fn step5_confusables_check(token_name: &str, value: &str) -> Result<(), SanitizeError> {
    // The unicode-security crate checks whether a string is "safe" from the
    // mixed-script confusables perspective (Unicode TR #39 §4).
    // `MixedScript::is_single_script` is implemented on `&str`.
    if !value.is_ascii() && !value.is_single_script() {
        return Err(SanitizeError::UnicodeConfusable {
            token: token_name.to_owned(),
            value: value.to_owned(),
        });
    }
    Ok(())
}

// ── Convenience: full pipeline ─────────────────────────────────────────────

/// Run the full sanitize pipeline on a token value.
///
/// Returns the cleaned value on success. Returns the first hard error
/// (`PathTraversal`, `ReservedName`, or `UnicodeConfusable`) encountered.
///
/// # Errors
/// Returns a [`SanitizeError`] if any step rejects the value.
pub fn sanitize_token_value(token_name: &str, raw: &str) -> Result<String, SanitizeError> {
    let s = step1_normalize_and_strip(raw);
    // Step 3 (traversal check) must run BEFORE step 2 so that `.` / `..` are
    // caught before step 2's dot-trimming collapses them to an empty string.
    step3_traversal_check(&s)?;
    let s = step2_substitute_reserved_chars(&s);
    step4_reserved_name_check(&s)?;
    step5_confusables_check(token_name, &s)?;
    Ok(s)
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Step 1: normalize and strip ────────────────────────────────────────

    #[test]
    fn step1_strips_c0_controls() {
        let input = "M\x0031"; // M + NUL + 1
        let result = step1_normalize_and_strip(input);
        // \x00 is a C0 control and should be removed.
        assert!(!result.contains('\x00'));
    }

    #[test]
    fn step1_strips_bidi_overrides() {
        // U+202E = RIGHT-TO-LEFT OVERRIDE
        let input = "normal\u{202E}text";
        let result = step1_normalize_and_strip(input);
        assert_eq!(result, "normaltext");
    }

    #[test]
    fn step1_strips_zero_width_space() {
        let input = "ha\u{200B}lpha";
        let result = step1_normalize_and_strip(input);
        assert_eq!(result, "halpha");
    }

    #[test]
    fn step1_preserves_normal_ascii() {
        let result = step1_normalize_and_strip("NGC7000");
        assert_eq!(result, "NGC7000");
    }

    #[test]
    fn step1_nfc_normalizes_composed_chars() {
        // "é" as decomposed (U+0065 U+0301) should become NFC (U+00E9).
        let decomposed = "e\u{0301}";
        let result = step1_normalize_and_strip(decomposed);
        assert_eq!(result, "\u{00E9}");
    }

    // ── Step 2: substitute reserved chars ──────────────────────────────────

    #[test]
    fn step2_replaces_colon() {
        assert_eq!(step2_substitute_reserved_chars("C:drive"), "C_drive");
    }

    #[test]
    fn step2_replaces_backslash() {
        assert_eq!(step2_substitute_reserved_chars("foo\\bar"), "foo_bar");
    }

    #[test]
    fn step2_replaces_question_mark() {
        assert_eq!(step2_substitute_reserved_chars("what?"), "what_");
    }

    #[test]
    fn step2_replaces_asterisk() {
        assert_eq!(step2_substitute_reserved_chars("glob*"), "glob_");
    }

    #[test]
    fn step2_trims_leading_trailing_dots() {
        assert_eq!(step2_substitute_reserved_chars(".hidden."), "hidden");
    }

    #[test]
    fn step2_trims_trailing_space() {
        assert_eq!(step2_substitute_reserved_chars("trailing "), "trailing");
    }

    #[test]
    fn step2_preserves_inner_hyphen_and_underscore() {
        assert_eq!(step2_substitute_reserved_chars("NGC-7000_Ha"), "NGC-7000_Ha");
    }

    // ── Step 3: traversal check ────────────────────────────────────────────

    #[test]
    fn step3_rejects_dot_dot() {
        assert!(matches!(step3_traversal_check(".."), Err(SanitizeError::PathTraversal { .. })));
    }

    #[test]
    fn step3_rejects_single_dot() {
        assert!(matches!(step3_traversal_check("."), Err(SanitizeError::PathTraversal { .. })));
    }

    #[test]
    fn step3_allows_normal_segment() {
        assert!(step3_traversal_check("NGC7000").is_ok());
    }

    // ── Step 4: reserved name check ────────────────────────────────────────

    #[test]
    fn step4_rejects_con_uppercase() {
        assert!(matches!(
            step4_reserved_name_check("CON"),
            Err(SanitizeError::ReservedName { .. })
        ));
    }

    #[test]
    fn step4_rejects_nul_lowercase() {
        assert!(matches!(
            step4_reserved_name_check("nul"),
            Err(SanitizeError::ReservedName { .. })
        ));
    }

    #[test]
    fn step4_rejects_com9() {
        assert!(matches!(
            step4_reserved_name_check("COM9"),
            Err(SanitizeError::ReservedName { .. })
        ));
    }

    #[test]
    fn step4_rejects_lpt1() {
        assert!(matches!(
            step4_reserved_name_check("lpt1"),
            Err(SanitizeError::ReservedName { .. })
        ));
    }

    #[test]
    fn step4_allows_con_prefix() {
        // "CONtrast" is not a reserved name.
        assert!(step4_reserved_name_check("CONtrast").is_ok());
    }

    #[test]
    fn step4_allows_normal_name() {
        assert!(step4_reserved_name_check("NGC7000").is_ok());
    }

    // ── Step 5: confusables check ──────────────────────────────────────────

    #[test]
    fn step5_allows_pure_ascii() {
        assert!(step5_confusables_check("target", "NGC7000").is_ok());
    }

    #[test]
    fn step5_allows_single_script_non_ascii() {
        // Pure Latin-script accented string should pass single-script check.
        assert!(step5_confusables_check("target", "Andromède").is_ok());
    }

    // ── Full pipeline ──────────────────────────────────────────────────────

    #[test]
    fn full_pipeline_clean_value() {
        let result = sanitize_token_value("target", "NGC7000").unwrap();
        assert_eq!(result, "NGC7000");
    }

    #[test]
    fn full_pipeline_strips_bidi_and_sanitizes() {
        // Bidi override is stripped, then the colon is replaced.
        let result = sanitize_token_value("target", "HA\u{202E}:filter").unwrap();
        assert_eq!(result, "HA_filter");
    }

    #[test]
    fn full_pipeline_traversal_rejected() {
        let err = sanitize_token_value("target", "..").unwrap_err();
        assert!(matches!(err, SanitizeError::PathTraversal { .. }));
    }

    #[test]
    fn full_pipeline_reserved_name_rejected() {
        let err = sanitize_token_value("target", "CON").unwrap_err();
        assert!(matches!(err, SanitizeError::ReservedName { .. }));
    }
}
