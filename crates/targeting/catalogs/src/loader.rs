//! Catalog entry-file reader (spec 013 surface; ratified in spec 033 F3).
//!
//! Reads a per-catalog `<slug>.json` file — the format each `catalog.download`
//! installs — into validated in-memory entries. The on-disk schema is the
//! ratified F3 format (see `specs/tiny/catalog-entry-file-format.md` and
//! `specs/014-catalog-index-licensing/contracts/catalog.entry-file.json`):
//!
//! ```json
//! { "catalogId": "openngc", "catalogDisplay": "OpenNGC", "version": "2026.06.18",
//!   "entries": [ { "designation": "NGC 224", "names": ["Andromeda Galaxy","M 31"],
//!     "ra": "00 42 44.330", "dec": "+41 16 09.40", "type": "galaxy",
//!     "constellation": "And", "magnitude": 3.44,
//!     "equivalents": [ { "catalogId": "messier", "designation": "M 31" } ] } ] }
//! ```
//!
//! These reader-side structs mirror the contract DTOs in
//! `contracts_core::catalogs` (`CatalogEntryFile`, `CatalogEntry`, …) and are
//! kept in casing/field parity by `tests/contract/catalog_entry_file_test.rs`.

use serde::{Deserialize, Serialize};

use crate::download::is_known_catalog_slug;

/// Object type taxonomy for a catalog entry. Closed enum with an `Other`
/// forward-compat fallback — an unrecognised string deserialises to `Other`
/// rather than failing (F3 decision 2).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectType {
    Galaxy,
    PlanetaryNebula,
    EmissionNebula,
    ReflectionNebula,
    DarkNebula,
    OpenCluster,
    GlobularCluster,
    SupernovaRemnant,
    GalaxyCluster,
    DoubleStar,
    Asterism,
    #[serde(other)]
    Other,
}

/// A cross-catalog equivalence carried inline in an entry (F3 decision 3).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntryEquivalent {
    /// Slug of the equivalent catalog (closed enum).
    pub catalog_id: String,
    /// Designation within that catalog, e.g. `"M 31"`.
    pub designation: String,
}

/// One entry in a per-catalog `<slug>.json` file (spec 013 `CatalogRef` source).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    /// Catalog-local designation, e.g. `"NGC 224"`.
    pub designation: String,
    /// Alternate names / aliases used for query matching.
    pub names: Vec<String>,
    /// Right ascension, sexagesimal hours `"HH MM SS.sss"` (F3 decision 1).
    pub ra: String,
    /// Declination, sexagesimal degrees `"±DD MM SS.ss"` (F3 decision 1).
    pub dec: String,
    /// Object type.
    pub r#type: ObjectType,
    /// IAU constellation abbreviation, e.g. `"And"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constellation: Option<String>,
    /// Apparent magnitude.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magnitude: Option<f64>,
    /// Inline cross-catalog equivalences (may be empty).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub equivalents: Vec<CatalogEntryEquivalent>,
}

/// A per-catalog entry file installed by `catalog.download` (`<slug>.json`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntryFile {
    /// Catalog slug (closed enum).
    pub catalog_id: String,
    /// Human-readable catalog name.
    pub catalog_display: String,
    /// Date-based catalog version (e.g. `"2026.06.18"`).
    pub version: String,
    /// All entries in this catalog.
    pub entries: Vec<CatalogEntry>,
}

/// Errors from reading or validating a catalog entry file.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CatalogReadError {
    /// The bytes were not valid JSON for the entry-file schema.
    #[error("malformed catalog entry file: {0}")]
    Malformed(String),
    /// A `catalogId` (file-level or equivalence) is not in the v1 closed set.
    #[error("unknown catalog slug: {0}")]
    UnknownCatalogSlug(String),
    /// A coordinate string failed sexagesimal range validation.
    #[error("invalid coordinate for '{designation}': {value}")]
    InvalidCoordinate { designation: String, value: String },
}

/// Parse and validate a per-catalog `<slug>.json` byte slice.
///
/// Validates: the file `catalogId` and every equivalence `catalogId` are in the
/// closed slug set; every entry's `ra`/`dec` are well-formed sexagesimal in
/// range. Pure — performs no I/O.
///
/// # Errors
///
/// Returns [`CatalogReadError`] on malformed JSON, an unknown slug, or an
/// out-of-range coordinate.
pub fn read_catalog_file(bytes: &[u8]) -> Result<CatalogEntryFile, CatalogReadError> {
    let file: CatalogEntryFile =
        serde_json::from_slice(bytes).map_err(|e| CatalogReadError::Malformed(e.to_string()))?;
    validate_catalog_file(&file)?;
    Ok(file)
}

fn validate_catalog_file(file: &CatalogEntryFile) -> Result<(), CatalogReadError> {
    if !is_known_catalog_slug(&file.catalog_id) {
        return Err(CatalogReadError::UnknownCatalogSlug(file.catalog_id.clone()));
    }
    for entry in &file.entries {
        if !valid_ra(&entry.ra) {
            return Err(CatalogReadError::InvalidCoordinate {
                designation: entry.designation.clone(),
                value: entry.ra.clone(),
            });
        }
        if !valid_dec(&entry.dec) {
            return Err(CatalogReadError::InvalidCoordinate {
                designation: entry.designation.clone(),
                value: entry.dec.clone(),
            });
        }
        for eq in &entry.equivalents {
            if !is_known_catalog_slug(&eq.catalog_id) {
                return Err(CatalogReadError::UnknownCatalogSlug(eq.catalog_id.clone()));
            }
        }
    }
    Ok(())
}

/// Validate RA as sexagesimal hours `"HH MM SS.sss"`: H 0–23, M 0–59, S [0,60).
fn valid_ra(s: &str) -> bool {
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() != 3 {
        return false;
    }
    let (Ok(h), Ok(m), Ok(sec)) =
        (parts[0].parse::<u32>(), parts[1].parse::<u32>(), parts[2].parse::<f64>())
    else {
        return false;
    };
    h <= 23 && m <= 59 && (0.0..60.0).contains(&sec)
}

/// Validate Dec as sexagesimal degrees `"±DD MM SS.ss"`: |D| 0–90, M 0–59,
/// S [0,60); at exactly ±90° the arcmin/arcsec MUST be zero.
fn valid_dec(s: &str) -> bool {
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() != 3 {
        return false;
    }
    let deg_token = parts[0].strip_prefix(['+', '-']).unwrap_or(parts[0]);
    let (Ok(deg), Ok(m), Ok(sec)) =
        (deg_token.parse::<u32>(), parts[1].parse::<u32>(), parts[2].parse::<f64>())
    else {
        return false;
    };
    if deg > 90 || m > 59 || !(0.0..60.0).contains(&sec) {
        return false;
    }
    // Disallow values beyond the poles, e.g. "+90 30 00".
    !(deg == 90 && (m != 0 || sec != 0.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "catalogId": "openngc",
        "catalogDisplay": "OpenNGC",
        "version": "2026.06.18",
        "entries": [
            {
                "designation": "NGC 224",
                "names": ["Andromeda Galaxy", "M 31"],
                "ra": "00 42 44.330",
                "dec": "+41 16 09.40",
                "type": "galaxy",
                "constellation": "And",
                "magnitude": 3.44,
                "equivalents": [ { "catalogId": "messier", "designation": "M 31" } ]
            }
        ]
    }"#;

    #[test]
    fn reads_valid_entry_file() {
        let file = read_catalog_file(SAMPLE.as_bytes()).expect("valid file parses");
        assert_eq!(file.catalog_id, "openngc");
        assert_eq!(file.entries.len(), 1);
        let e = &file.entries[0];
        assert_eq!(e.designation, "NGC 224");
        assert_eq!(e.r#type, ObjectType::Galaxy);
        assert_eq!(e.equivalents[0].catalog_id, "messier");
        assert_eq!(e.magnitude, Some(3.44));
    }

    #[test]
    fn optional_fields_default() {
        let json = r#"{"catalogId":"common","catalogDisplay":"Common Names","version":"2026.06.18",
            "entries":[{"designation":"Pinwheel","names":["M101"],"ra":"14 03 12.5","dec":"+54 20 56","type":"galaxy"}]}"#;
        let file = read_catalog_file(json.as_bytes()).unwrap();
        let e = &file.entries[0];
        assert!(e.constellation.is_none());
        assert!(e.magnitude.is_none());
        assert!(e.equivalents.is_empty());
    }

    #[test]
    fn unknown_object_type_falls_back_to_other() {
        let json = r#"{"catalogId":"openngc","catalogDisplay":"OpenNGC","version":"1",
            "entries":[{"designation":"X","names":[],"ra":"00 00 00","dec":"+00 00 00","type":"frobnicate"}]}"#;
        let file = read_catalog_file(json.as_bytes()).unwrap();
        assert_eq!(file.entries[0].r#type, ObjectType::Other);
    }

    #[test]
    fn rejects_unknown_file_slug() {
        let json =
            r#"{"catalogId":"not_a_catalog","catalogDisplay":"X","version":"1","entries":[]}"#;
        assert_eq!(
            read_catalog_file(json.as_bytes()),
            Err(CatalogReadError::UnknownCatalogSlug("not_a_catalog".into()))
        );
    }

    #[test]
    fn rejects_unknown_equivalence_slug() {
        let json = r#"{"catalogId":"openngc","catalogDisplay":"OpenNGC","version":"1",
            "entries":[{"designation":"X","names":[],"ra":"00 00 00","dec":"+00 00 00","type":"galaxy",
            "equivalents":[{"catalogId":"bogus","designation":"Y"}]}]}"#;
        assert!(matches!(
            read_catalog_file(json.as_bytes()),
            Err(CatalogReadError::UnknownCatalogSlug(s)) if s == "bogus"
        ));
    }

    #[test]
    fn rejects_out_of_range_ra() {
        let json = r#"{"catalogId":"openngc","catalogDisplay":"OpenNGC","version":"1",
            "entries":[{"designation":"Bad","names":[],"ra":"24 00 00","dec":"+00 00 00","type":"galaxy"}]}"#;
        assert!(matches!(
            read_catalog_file(json.as_bytes()),
            Err(CatalogReadError::InvalidCoordinate { .. })
        ));
    }

    #[test]
    fn rejects_dec_beyond_pole() {
        let json = r#"{"catalogId":"openngc","catalogDisplay":"OpenNGC","version":"1",
            "entries":[{"designation":"Bad","names":[],"ra":"00 00 00","dec":"+90 30 00","type":"galaxy"}]}"#;
        assert!(matches!(
            read_catalog_file(json.as_bytes()),
            Err(CatalogReadError::InvalidCoordinate { .. })
        ));
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(matches!(read_catalog_file(b"not json"), Err(CatalogReadError::Malformed(_))));
    }

    #[test]
    fn valid_dec_accepts_exact_pole() {
        assert!(valid_dec("-90 00 00"));
        assert!(valid_dec("+90 00 00.0"));
    }
}
