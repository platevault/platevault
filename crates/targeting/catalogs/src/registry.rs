//! Static registry of known v1 catalogs and their metadata.
//!
//! The registry provides the list of all thirteen v1 catalogs defined in
//! spec 014 (R-1.1). In v1, all catalogs have `origin = "downloaded"`.
//! `built_in` is reserved but unused. `user` is deferred to v1.x (A2).

use serde::{Deserialize, Serialize};

use crate::license::LicenseShortCode;

// ── CatalogOrigin ──────────────────────────────────────────────────────────────

/// Origin of a registered catalog (data-model.md §Catalog, R-1.3).
///
/// - `downloaded`: all v1 catalogs; installed from the project-hosted manifest.
/// - `built_in`: reserved for forward-compat (future emergency-fallback); zero
///   built-in catalogs exist in v1 (R-3.3).
/// - `user`: reserved for v1.x; the backend rejects operations with this
///   origin with `origin.not_implemented` in v1 (A2).
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogOrigin {
    BuiltIn,
    Downloaded,
    User,
}

impl CatalogOrigin {
    /// Return the canonical string representation used in contracts and DB.
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::BuiltIn => "built_in",
            Self::Downloaded => "downloaded",
            Self::User => "user",
        }
    }
}

// ── CatalogMeta ───────────────────────────────────────────────────────────────

/// Static metadata for a known catalog.
///
/// Represents one registered catalog index known to the app (data-model.md
/// §Catalog). Installed records are stored in `catalog_downloaded`; this struct
/// is used for the static registry list and for populating new rows.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogMeta {
    /// Stable slug identifier, e.g. `"messier"`, `"ngc"`, `"opengc"`.
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// License short code for this catalog.
    pub license: LicenseShortCode,
    /// Origin of this catalog record.
    pub origin: CatalogOrigin,
    /// Upstream source URL from which the bundle was generated.
    pub source_url: String,
    /// Approximate entry count (optional; known from spec data).
    pub entry_count: Option<i64>,
}

// ── V1 catalog registry ────────────────────────────────────────────────────────

/// Returns the static list of all thirteen v1 catalogs defined in spec 014
/// (R-1.1). All have `origin = downloaded`.
///
/// This is the authoritative catalog list. Downloaded catalog records are
/// stored in the `catalog_downloaded` SQLite table; this list provides the
/// metadata needed to recognise and validate manifest entries.
#[must_use]
#[allow(clippy::too_many_lines)] // flat table of 13 catalog definitions — splitting adds no clarity
pub fn v1_catalogs() -> Vec<CatalogMeta> {
    vec![
        CatalogMeta {
            id: "messier".into(),
            name: "Messier".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://messier.seds.org".into(),
            entry_count: Some(110),
        },
        CatalogMeta {
            id: "caldwell".into(),
            name: "Caldwell".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://en.wikipedia.org/wiki/Caldwell_catalogue".into(),
            entry_count: Some(109),
        },
        CatalogMeta {
            id: "sharpless".into(),
            name: "Sharpless 2".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://en.wikipedia.org/wiki/Sharpless_catalog".into(),
            entry_count: Some(313),
        },
        CatalogMeta {
            id: "abell-pn".into(),
            name: "Abell Planetary Nebulae".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=V/84".into(),
            entry_count: Some(86),
        },
        CatalogMeta {
            id: "abell-clusters".into(),
            name: "Abell Galaxy Clusters".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/110A".into(),
            entry_count: Some(4073),
        },
        CatalogMeta {
            id: "arp".into(),
            name: "Arp (Peculiar Galaxies)".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://ned.ipac.caltech.edu/".into(),
            entry_count: Some(338),
        },
        CatalogMeta {
            id: "vdb".into(),
            name: "van den Bergh (vdB)".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/21".into(),
            entry_count: Some(158),
        },
        CatalogMeta {
            id: "barnard".into(),
            name: "Barnard Dark Nebulae".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/220A".into(),
            entry_count: Some(372),
        },
        CatalogMeta {
            id: "lbn".into(),
            name: "LBN (Lynds Bright Nebulae)".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/9".into(),
            entry_count: Some(1125),
        },
        CatalogMeta {
            id: "ldn".into(),
            name: "LDN (Lynds Dark Nebulae)".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/7A".into(),
            entry_count: Some(1802),
        },
        CatalogMeta {
            id: "melotte".into(),
            name: "Melotte".into(),
            license: LicenseShortCode::PublicDomain,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://en.wikipedia.org/wiki/Melotte_catalogue".into(),
            entry_count: Some(245),
        },
        CatalogMeta {
            id: "common-names".into(),
            name: "Common Names (app-authored)".into(),
            license: LicenseShortCode::Apache2,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://github.com/sjors/astro-plan-catalogs".into(),
            entry_count: Some(300),
        },
        CatalogMeta {
            // Canonical slug is "openngc" (matches the spec 013 CatalogId::Openngc
            // closed enum). "opengc" was a typo in spec 014 strings — fixed here
            // per D3 (FR-029, T070).
            id: "openngc".into(),
            name: "OpenNGC (NGC + IC)".into(),
            license: LicenseShortCode::CcBySa4_0,
            origin: CatalogOrigin::Downloaded,
            source_url: "https://github.com/mattiaverga/OpenNGC".into(),
            entry_count: Some(13000),
        },
    ]
}

/// Return the `CatalogMeta` for a given catalog id, or `None` if not found.
#[must_use]
pub fn find_catalog(id: &str) -> Option<CatalogMeta> {
    v1_catalogs().into_iter().find(|c| c.id == id)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v1_catalogs_has_thirteen_entries() {
        assert_eq!(v1_catalogs().len(), 13);
    }

    #[test]
    fn all_v1_catalogs_have_downloaded_origin() {
        for c in v1_catalogs() {
            assert_eq!(
                c.origin,
                CatalogOrigin::Downloaded,
                "catalog {} has unexpected origin {:?}",
                c.id,
                c.origin
            );
        }
    }

    #[test]
    fn all_catalog_ids_are_unique() {
        let catalogs = v1_catalogs();
        let mut ids: Vec<&str> = catalogs.iter().map(|c| c.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), catalogs.len(), "duplicate catalog ids detected");
    }

    #[test]
    fn all_catalog_ids_match_slug_pattern() {
        for c in v1_catalogs() {
            assert!(
                c.id.chars().all(|ch| ch.is_ascii_lowercase()
                    || ch.is_ascii_digit()
                    || ch == '-'
                    || ch == '_'),
                "catalog id '{}' contains invalid characters",
                c.id
            );
        }
    }

    #[test]
    fn openngc_has_cc_by_sa_license() {
        // Slug corrected from "opengc" (typo) to "openngc" per D3 / FR-029 / T070.
        let c = find_catalog("openngc").expect("openngc must be in registry");
        assert_eq!(c.license, LicenseShortCode::CcBySa4_0);
    }

    #[test]
    fn opengc_typo_is_not_in_registry() {
        // "opengc" (missing second n) must NOT be a registered slug (D3, T070).
        assert!(find_catalog("opengc").is_none(), "opengc typo slug must not exist in registry");
    }

    #[test]
    fn find_catalog_returns_none_for_unknown_id() {
        assert!(find_catalog("nonexistent").is_none());
    }

    #[test]
    fn user_origin_as_str() {
        assert_eq!(CatalogOrigin::User.as_str(), "user");
    }
}
