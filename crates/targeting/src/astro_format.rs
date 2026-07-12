//! Sexagesimal RA/Dec display formatting.
//!
//! Thin wrapper over `skymath::Equatorial::ra_sexagesimal`/`dec_sexagesimal`,
//! which round at the requested precision *before* decomposing into
//! degrees/minutes/seconds — carry-safe, so a value like `59.6"` never rolls
//! over to an invalid `"...:60"` field the way a naive `seconds.toFixed(0)`
//! on the raw remainder can.
//!
//! skymath exposes no h/m/s (or d/m/s) component accessors — only the fully
//! formatted colon/space-separated string — so the astronomy-notation display
//! (`HHhMMmSSs` / `±DD°MM′SS″`, matching the deleted TS `fmtRa`/`fmtDec`) is
//! produced by splitting skymath's colon-separated, carry-already-applied
//! string on `:` and re-joining with the display glyphs; the carry itself
//! still happens inside skymath, this only changes field separators.

use skymath::{Separator, SexaStyle};

use crate::coords::{self, Pointing};

/// Colon-separated, 0 fractional-second-digit style (`HH:MM:SS` / `±DD:MM:SS`).
const COLON_STYLE: SexaStyle = SexaStyle { separator: Separator::Colons, seconds_places: 0 };

/// A target's RA/Dec formatted in astronomy notation: `HHhMMmSSs` for RA,
/// `±DD°MM′SS″` for Dec (negative sign is U+2212, not the ASCII hyphen).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SexagesimalCoords {
    pub ra: String,
    pub dec: String,
}

/// Format decimal-degree RA/Dec as astronomy-notation sexagesimal strings.
///
/// Returns `None` when either coordinate is non-finite (NaN/±inf) — never a
/// fabricated string. Out-of-domain-but-finite input is wrapped/clamped into
/// domain first (see [`coords::to_equatorial`]).
#[must_use]
pub fn sexagesimal(ra_deg: f64, dec_deg: f64) -> Option<SexagesimalCoords> {
    if !ra_deg.is_finite() || !dec_deg.is_finite() {
        return None;
    }
    let eq = coords::to_equatorial(Pointing::new(ra_deg, dec_deg));
    Some(SexagesimalCoords {
        ra: ra_glyphs(&eq.ra_sexagesimal(COLON_STYLE)),
        dec: dec_glyphs(&eq.dec_sexagesimal(COLON_STYLE)),
    })
}

/// `"HH:MM:SS"` → `"HHhMMmSSs"`.
fn ra_glyphs(colon: &str) -> String {
    let mut f = colon.splitn(3, ':');
    let (h, m, s) = (f.next().unwrap_or(""), f.next().unwrap_or(""), f.next().unwrap_or(""));
    format!("{h}h{m}m{s}s")
}

/// `"+DD:MM:SS"` / `"-DD:MM:SS"` → `"±DD°MM′SS″"`, with U+2212 (minus sign)
/// for negative — never the ASCII hyphen `format_dec` emits.
fn dec_glyphs(colon: &str) -> String {
    let (sign, rest) = colon
        .strip_prefix('-')
        .map(|r| ("\u{2212}", r))
        .or_else(|| colon.strip_prefix('+').map(|r| ("+", r)))
        .unwrap_or(("+", colon));
    let mut f = rest.splitn(3, ':');
    let (d, m, s) = (f.next().unwrap_or(""), f.next().unwrap_or(""), f.next().unwrap_or(""));
    format!("{sign}{d}\u{b0}{m}\u{2032}{s}\u{2033}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_m31_exact_glyphs() {
        // M31: RA 10.6847deg -> 00h42m44s, Dec 41.2688deg -> +41°16′08″.
        let s = sexagesimal(10.6847, 41.2688).unwrap();
        assert_eq!(s.ra, "00h42m44s");
        assert_eq!(s.dec, "+41\u{b0}16\u{2032}08\u{2033}");
    }

    #[test]
    fn negative_dec_uses_u2212_not_ascii_hyphen() {
        let s = sexagesimal(10.0, -5.5).unwrap();
        assert_eq!(s.dec, "\u{2212}05\u{b0}30\u{2032}00\u{2033}");
        assert!(!s.dec.starts_with('-'), "must be U+2212, not ASCII hyphen: {}", s.dec);
    }

    #[test]
    fn seconds_carry_never_shows_60_and_keeps_glyphs() {
        // 44.999_999_999° Dec rounds its seconds field up into the next minute;
        // must land on a valid glyph string, never "...′60″".
        let s = sexagesimal(0.0, 44.999_999_999).unwrap();
        assert_eq!(s.dec, "+45\u{b0}00\u{2032}00\u{2033}");
        assert!(!s.dec.contains("60\u{2033}"), "dec={}", s.dec);
    }

    #[test]
    fn non_finite_is_none() {
        assert!(sexagesimal(f64::NAN, 0.0).is_none());
        assert!(sexagesimal(0.0, f64::INFINITY).is_none());
    }
}
