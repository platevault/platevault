//! Seeded in-memory test fixtures for spec 013 unit tests.
//!
//! Provides a small, deterministic catalog with:
//! - M31 / NGC 224 / Andromeda Galaxy (Messier + OpenNGC equivalence)
//! - M101 / NGC 5457 / Pinwheel Galaxy
//! - IC 1396 / Elephant Trunk Nebula
//!
//! No real catalog files are read; these entries are hard-coded for fast,
//! hermetic tests (per task requirement: no dependency on downloaded files).

use crate::catalog::{CatalogEntry, CatalogId, CatalogRef, TargetCatalog};
use crate::identity::target_id;

/// Build a seeded in-memory [`TargetCatalog`] for testing.
///
/// Contains three entries with cross-catalog equivalences:
/// - `M31` ≡ `NGC 224` ≡ `Andromeda Galaxy`
/// - `M101` ≡ `NGC 5457` ≡ `Pinwheel Galaxy`
/// - `IC 1396` ≡ `Elephant Trunk Nebula`
#[must_use]
pub fn seeded_catalog() -> TargetCatalog {
    TargetCatalog::from_entries(vec![m31_entry(), m101_entry(), ic1396_entry()])
}

fn m31_entry() -> CatalogEntry {
    let id = target_id("messier", "M31");
    CatalogEntry {
        target_id: id,
        primary_designation: "M 31".to_owned(),
        primary_catalog_display: "Messier".to_owned(),
        refs: vec![
            CatalogRef {
                catalog_id: CatalogId::Messier,
                catalog_display: "Messier".to_owned(),
                designation: "M31".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Openngc,
                catalog_display: "OpenNGC".to_owned(),
                designation: "NGC 224".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Common,
                catalog_display: "Common Names".to_owned(),
                designation: "Andromeda Galaxy".to_owned(),
            },
        ],
    }
}

fn m101_entry() -> CatalogEntry {
    let id = target_id("messier", "M101");
    CatalogEntry {
        target_id: id,
        primary_designation: "M 101".to_owned(),
        primary_catalog_display: "Messier".to_owned(),
        refs: vec![
            CatalogRef {
                catalog_id: CatalogId::Messier,
                catalog_display: "Messier".to_owned(),
                designation: "M101".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Openngc,
                catalog_display: "OpenNGC".to_owned(),
                designation: "NGC 5457".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Common,
                catalog_display: "Common Names".to_owned(),
                designation: "Pinwheel Galaxy".to_owned(),
            },
        ],
    }
}

fn ic1396_entry() -> CatalogEntry {
    let id = target_id("openngc", "IC 1396");
    CatalogEntry {
        target_id: id,
        primary_designation: "IC 1396".to_owned(),
        primary_catalog_display: "OpenNGC".to_owned(),
        refs: vec![
            CatalogRef {
                catalog_id: CatalogId::Openngc,
                catalog_display: "OpenNGC".to_owned(),
                designation: "IC 1396".to_owned(),
            },
            CatalogRef {
                catalog_id: CatalogId::Common,
                catalog_display: "Common Names".to_owned(),
                designation: "Elephant Trunk Nebula".to_owned(),
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeded_catalog_has_three_entries() {
        let cat = seeded_catalog();
        assert_eq!(cat.len(), 3);
    }

    #[test]
    fn m31_and_ngc224_resolve_to_same_target() {
        let cat = seeded_catalog();
        let m31 = cat.exact_lookup(&crate::normalize::normalize("M31"));
        let ngc = cat.exact_lookup(&crate::normalize::normalize("NGC224"));
        assert!(m31.is_some());
        assert!(ngc.is_some());
        assert_eq!(m31.unwrap().target_id, ngc.unwrap().target_id);
    }

    #[test]
    fn target_ids_are_deterministic() {
        let cat1 = seeded_catalog();
        let cat2 = seeded_catalog();
        let e1 = cat1.exact_lookup(&crate::normalize::normalize("M31")).unwrap();
        let e2 = cat2.exact_lookup(&crate::normalize::normalize("M31")).unwrap();
        assert_eq!(e1.target_id, e2.target_id);
    }
}
