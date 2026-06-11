//! License attribution model for spec 014 — Catalog Index Licensing.
//!
//! `LicenseShortCode` is a **closed enum** (R-2.1). CI hard-fails on unknown
//! values. New entries require an explicit research decision per the
//! constitution.
//!
//! `LicenseAttribution` is the per-catalog notice surface. Attribution text is
//! stored verbatim — never templated at runtime (R-2.2).

use serde::{Deserialize, Serialize};

// ── LicenseShortCode ─────────────────────────────────────────────────────────

/// Closed enum of licenses permitted by the catalog registry (R-2.1).
///
/// CI hard-fails on any TOML manifest entry whose `license` field is not one
/// of these variants. New variants require an explicit constitution-compliant
/// research decision.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LicenseShortCode {
    /// Works in the public domain — no attribution required, though a
    /// "verified: <source>, accessed <date>" string is still recorded.
    PublicDomain,
    /// Apache License 2.0 (project-authored or compatible contributions).
    #[serde(rename = "apache-2.0")]
    Apache2,
    /// MIT License.
    Mit,
    /// Creative Commons Zero (CC0 1.0 Universal — effectively public domain).
    #[serde(rename = "cc0-1.0")]
    Cc0_1_0,
    /// Creative Commons Attribution 4.0 International.
    #[serde(rename = "cc-by-4.0")]
    CcBy4_0,
    /// Creative Commons Attribution-ShareAlike 4.0 International.
    /// Used by OpenNGC — requires attribution + share-alike on derivatives.
    #[serde(rename = "cc-by-sa-4.0")]
    CcBySa4_0,
    /// HyperLeda custom license (non-commercial redistribution allowed).
    Hyperleda,
    /// ESA free-use license (redistribution allowed with attribution).
    #[serde(rename = "esa-free")]
    EsaFree,
}

impl LicenseShortCode {
    /// Return the canonical string representation used in contracts and DB.
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PublicDomain => "public-domain",
            Self::Apache2 => "apache-2.0",
            Self::Mit => "mit",
            Self::Cc0_1_0 => "cc0-1.0",
            Self::CcBy4_0 => "cc-by-4.0",
            Self::CcBySa4_0 => "cc-by-sa-4.0",
            Self::Hyperleda => "hyperleda",
            Self::EsaFree => "esa-free",
        }
    }

    /// Parse from the string form used in the manifest / DB.
    ///
    /// Returns `None` for unknown codes. CI must treat `None` as a hard failure
    /// (R-2.1).
    #[must_use]
    pub fn parse_code(s: &str) -> Option<Self> {
        match s {
            "public-domain" => Some(Self::PublicDomain),
            "apache-2.0" => Some(Self::Apache2),
            "mit" => Some(Self::Mit),
            "cc0-1.0" => Some(Self::Cc0_1_0),
            "cc-by-4.0" => Some(Self::CcBy4_0),
            "cc-by-sa-4.0" => Some(Self::CcBySa4_0),
            "hyperleda" => Some(Self::Hyperleda),
            "esa-free" => Some(Self::EsaFree),
            _ => None,
        }
    }

    /// Return `true` if this license requires `author`, `title`, and
    /// `license_uri` fields in the `LicenseAttribution` record (R-2.2).
    #[must_use]
    pub fn requires_cc_attribution(&self) -> bool {
        matches!(self, Self::CcBy4_0 | Self::CcBySa4_0)
    }
}

// ── LicenseAttribution ────────────────────────────────────────────────────────

/// Per-catalog notice surface for display in Settings and for generating
/// `NOTICE.json` / `NOTICE.txt` artifacts (R-2.2, R-2.3).
///
/// Invariants:
/// - `text` is never empty.
/// - For `cc-by-4.0` and `cc-by-sa-4.0`, `author`, `title`, and `license_uri`
///   are required.
/// - `link` must resolve to a stable source URL or archived snapshot.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LicenseAttribution {
    /// FK to `Catalog.id`.
    pub catalog_id: String,
    /// License for this attribution row (echoes `Catalog.license`).
    pub license: LicenseShortCode,
    /// Full required notice text, verbatim.  Public-domain entries carry a
    /// `"verified: <source>, accessed <date>"` string so the panel is never
    /// empty.
    pub text: String,
    /// Stable source link referenced by the notice.
    pub link: String,
    /// Date the source was fetched (ISO 8601). Used for the "verified on"
    /// line in public-domain entries.
    pub accessed_on: Option<String>,
    /// Author / rights-holder name.  **Required** for CC-BY and CC-BY-SA.
    pub author: Option<String>,
    /// Work title.  **Required** for CC-BY and CC-BY-SA.
    pub title: Option<String>,
    /// Canonical license URI.  **Required** for CC-BY and CC-BY-SA.
    pub license_uri: Option<String>,
    /// Describes the nature of any modifications made by the project
    /// (e.g. column subsetting, coordinate normalisation).
    pub modifications_notice: Option<String>,
}

impl LicenseAttribution {
    /// Validate the record against the data-model invariants.
    ///
    /// Returns `Err` with a human-readable message when validation fails.
    ///
    /// # Errors
    ///
    /// Returns an error string describing the first invariant violation found.
    pub fn validate(&self) -> Result<(), String> {
        if self.text.is_empty() {
            return Err(format!("catalog {}: attribution text must not be empty", self.catalog_id));
        }
        if self.link.is_empty() {
            return Err(format!("catalog {}: attribution link must not be empty", self.catalog_id));
        }
        if self.license.requires_cc_attribution() {
            if self.author.as_deref().unwrap_or("").is_empty() {
                return Err(format!(
                    "catalog {}: author is required for {} license",
                    self.catalog_id,
                    self.license.as_str()
                ));
            }
            if self.title.as_deref().unwrap_or("").is_empty() {
                return Err(format!(
                    "catalog {}: title is required for {} license",
                    self.catalog_id,
                    self.license.as_str()
                ));
            }
            if self.license_uri.as_deref().unwrap_or("").is_empty() {
                return Err(format!(
                    "catalog {}: license_uri is required for {} license",
                    self.catalog_id,
                    self.license.as_str()
                ));
            }
        }
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_short_code_roundtrip() {
        for code in [
            "public-domain",
            "apache-2.0",
            "mit",
            "cc0-1.0",
            "cc-by-4.0",
            "cc-by-sa-4.0",
            "hyperleda",
            "esa-free",
        ] {
            let parsed = LicenseShortCode::parse_code(code)
                .unwrap_or_else(|| panic!("unknown code: {code}"));
            assert_eq!(parsed.as_str(), code);
        }
    }

    #[test]
    fn unknown_license_code_returns_none() {
        assert!(LicenseShortCode::parse_code("gpl-3.0").is_none());
        assert!(LicenseShortCode::parse_code("").is_none());
    }

    #[test]
    fn cc_attribution_required_only_for_cc_variants() {
        assert!(!LicenseShortCode::PublicDomain.requires_cc_attribution());
        assert!(!LicenseShortCode::Apache2.requires_cc_attribution());
        assert!(LicenseShortCode::CcBy4_0.requires_cc_attribution());
        assert!(LicenseShortCode::CcBySa4_0.requires_cc_attribution());
    }

    #[test]
    fn attribution_validate_rejects_empty_text() {
        let attr = LicenseAttribution {
            catalog_id: "messier".into(),
            license: LicenseShortCode::PublicDomain,
            text: String::new(),
            link: "https://example.com".into(),
            accessed_on: None,
            author: None,
            title: None,
            license_uri: None,
            modifications_notice: None,
        };
        assert!(attr.validate().is_err());
    }

    #[test]
    fn attribution_validate_requires_cc_fields_for_cc_by_sa() {
        let attr = LicenseAttribution {
            catalog_id: "opengc".into(),
            license: LicenseShortCode::CcBySa4_0,
            text: "OpenNGC by Mattia Verga, CC BY-SA 4.0".into(),
            link: "https://github.com/mattiaverga/OpenNGC".into(),
            accessed_on: None,
            // Missing author, title, license_uri
            author: None,
            title: None,
            license_uri: None,
            modifications_notice: None,
        };
        let err = attr.validate().unwrap_err();
        assert!(err.contains("author"), "expected author error, got: {err}");
    }

    #[test]
    fn attribution_validate_passes_complete_cc_by_sa_record() {
        let attr = LicenseAttribution {
            catalog_id: "opengc".into(),
            license: LicenseShortCode::CcBySa4_0,
            text: "OpenNGC by Mattia Verga, CC BY-SA 4.0".into(),
            link: "https://github.com/mattiaverga/OpenNGC".into(),
            accessed_on: Some("2026-01-01".into()),
            author: Some("Mattia Verga".into()),
            title: Some("OpenNGC".into()),
            license_uri: Some("https://creativecommons.org/licenses/by-sa/4.0/".into()),
            modifications_notice: Some("Column subset: name, ra, dec, identifiers".into()),
        };
        assert!(attr.validate().is_ok());
    }

    #[test]
    fn attribution_validate_passes_public_domain_record() {
        let attr = LicenseAttribution {
            catalog_id: "messier".into(),
            license: LicenseShortCode::PublicDomain,
            text: "Verified: public domain. Source: https://messier.seds.org, accessed 2026-01-01."
                .into(),
            link: "https://messier.seds.org".into(),
            accessed_on: Some("2026-01-01".into()),
            author: None,
            title: None,
            license_uri: None,
            modifications_notice: None,
        };
        assert!(attr.validate().is_ok());
    }
}
