//! Sexagesimal RA/Dec display formatting.
//!
//! Thin wrapper over `target_match::Equatorial::ra_to_sexagesimal` /
//! `dec_to_sexagesimal`, which round at the requested precision *before*
//! decomposing into degrees/minutes/seconds — carry-safe, so a value like
//! `59.6"` never rolls over to an invalid `"...:60"` field the way a naive
//! `seconds.toFixed(0)` on the raw remainder can.

use crate::coords::{self, Pointing};

/// A target's RA/Dec formatted as sexagesimal strings: `HH:MM:SS` for RA,
/// `±DD:MM:SS` for Dec (0 fractional-second digits).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SexagesimalCoords {
    pub ra: String,
    pub dec: String,
}

/// Format decimal-degree RA/Dec as sexagesimal strings.
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
    Some(SexagesimalCoords { ra: eq.ra_to_sexagesimal(0), dec: eq.dec_to_sexagesimal(0) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_m31() {
        // M31: RA 10.6847deg = 00:42:44, Dec 41.2688deg = +41:16:08(ish).
        let s = sexagesimal(10.6847, 41.2688).unwrap();
        assert!(s.ra.starts_with("00:42:44"), "ra={}", s.ra);
        assert!(s.dec.starts_with("+41:16:"), "dec={}", s.dec);
    }

    #[test]
    fn seconds_never_roll_over_to_60() {
        // A value engineered to be within rounding distance of a 60s carry.
        let s = sexagesimal(0.0, 44.999_999_999).unwrap();
        assert!(!s.dec.contains(":60"), "dec={}", s.dec);
    }

    #[test]
    fn non_finite_is_none() {
        assert!(sexagesimal(f64::NAN, 0.0).is_none());
        assert!(sexagesimal(0.0, f64::INFINITY).is_none());
    }

    #[test]
    fn negative_dec_keeps_sign() {
        let s = sexagesimal(10.0, -5.5).unwrap();
        assert!(s.dec.starts_with('-'), "dec={}", s.dec);
    }
}
