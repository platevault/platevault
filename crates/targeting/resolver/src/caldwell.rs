//! Static Caldwell → NGC/IC (or other) designation map.
//!
//! Caldwell is **not** a SIMBAD designation (research.md R2): SIMBAD does not
//! recognise the `C…` prefix as an identifier. To resolve a Caldwell query we
//! translate it to the underlying object's *resolvable* designation (NGC, IC,
//! or another catalog SIMBAD does know) using Patrick Moore's published
//! Caldwell catalogue (C1–C109), then resolve / enrich that designation
//! normally.
//!
//! The C1–C109 map itself is maintained upstream in the published
//! `simbad-resolver` crate (the same map, verified identical entry-for-entry
//! at adoption time); this module re-exports it so the `targeting_resolver`
//! public path (`targeting_resolver::caldwell::*`, used by
//! `crates/tools/seed-builder`) is unaffected by the crate swap.
//!
//! Constitution §III: this is identity metadata only (no image processing).

pub use simbad_resolver::caldwell::{caldwell_to_designation, entry_count, parse_caldwell_number};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_full_caldwell_catalogue() {
        assert_eq!(entry_count(), 109);
    }

    #[test]
    fn known_mappings() {
        assert_eq!(caldwell_to_designation(1), Some("NGC 188"));
        assert_eq!(caldwell_to_designation(14), Some("NGC 869")); // Double Cluster
        assert_eq!(caldwell_to_designation(41), Some("Mel 25")); // Hyades
        assert_eq!(caldwell_to_designation(109), Some("NGC 3195"));
    }

    #[test]
    fn coalsack_has_no_designation() {
        assert_eq!(caldwell_to_designation(99), None);
    }

    #[test]
    fn parse_caldwell_number_recognizes_forms() {
        assert_eq!(parse_caldwell_number("C 14"), Some(14));
        assert_eq!(parse_caldwell_number("C14"), Some(14));
        assert_eq!(parse_caldwell_number("Caldwell 14"), Some(14));
    }
}
