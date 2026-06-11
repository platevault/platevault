//! Shared metadata model used by format-specific extractors (spec 005).
//!
//! # Contents
//!
//! - [`FrameType`] — canonical classification enum.
//! - [`EvidenceSource`] — how the frame type was determined.
//! - [`ImageTypNormalizationTable`] — maps raw IMAGETYP strings to
//!   [`FrameType`] via case-insensitive lookup.
//! - [`MetadataExtractor`] — trait implemented by FITS/XISF adapters.
//! - [`RawFileMetadata`] — minimal header values returned by extractors.
#![allow(clippy::doc_markdown)]

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ── FrameType ─────────────────────────────────────────────────────────────────

/// Canonical astronomical frame types used throughout the app.
///
/// `DarkFlat` is reserved in v1; the normalization table does NOT map any
/// IMAGETYP value to it — files land as `unclassified` and can be manually
/// promoted via `inbox.reclassify`. (Ref: R-DarkFlat-Reserved)
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameType {
    Light,
    Dark,
    Bias,
    Flat,
    /// Reserved — not produced by the v1 normalization table.
    DarkFlat,
}

impl FrameType {
    /// Return the canonical lowercase string used in contracts.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            FrameType::Light => "light",
            FrameType::Dark => "dark",
            FrameType::Bias => "bias",
            FrameType::Flat => "flat",
            FrameType::DarkFlat => "dark_flat",
        }
    }

    /// Parse from a contract/DB string (case-insensitive).
    #[must_use]
    pub fn from_str_ci(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "light" => Some(FrameType::Light),
            "dark" => Some(FrameType::Dark),
            "bias" => Some(FrameType::Bias),
            "flat" => Some(FrameType::Flat),
            "dark_flat" => Some(FrameType::DarkFlat),
            _ => None,
        }
    }
}

impl std::fmt::Display for FrameType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// ── EvidenceSource ────────────────────────────────────────────────────────────

/// How a [`FrameType`] assignment was determined for a file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceSource {
    /// Derived from the FITS `IMAGETYP` header keyword.
    ImagetypHeader,
    /// Derived from an XISF `FITSKeyword` property.
    XisfProperty,
    /// Manually set by the user via `inbox.reclassify`.
    ManualOverride,
    /// No determinable source (IMAGETYP absent or unreadable).
    None,
}

impl EvidenceSource {
    /// Return the canonical lowercase string used in the DB.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            EvidenceSource::ImagetypHeader => "imagetyp_header",

            EvidenceSource::XisfProperty => "xisf_property",
            EvidenceSource::ManualOverride => "manual_override",
            EvidenceSource::None => "none",
        }
    }

    /// Parse from DB/contract string.
    #[must_use]
    pub fn from_str_ci(s: &str) -> Option<Self> {
        match s {
            "imagetyp_header" => Some(EvidenceSource::ImagetypHeader),
            "xisf_property" => Some(EvidenceSource::XisfProperty),
            "manual_override" => Some(EvidenceSource::ManualOverride),
            "none" => Some(EvidenceSource::None),
            _ => None,
        }
    }
}

// ── ImageTypNormalizationTable ────────────────────────────────────────────────

/// Case-insensitive mapping from raw IMAGETYP string values → [`FrameType`].
///
/// The canonical mapping is loaded from the embedded TOML data file
/// `data/imagetyp_normalization.toml` (R-IMAGETYP-Norm). Unknown values
/// return `None` (file is marked unclassified).
///
/// `DarkFlat` is intentionally absent from the v1 mapping (R-DarkFlat-Reserved).
#[derive(Clone, Debug)]
pub struct ImageTypNormalizationTable {
    /// Lowercase-normalised key → FrameType.
    entries: HashMap<String, FrameType>,
}

impl ImageTypNormalizationTable {
    /// Build from an iterator of `(raw_value, FrameType)` pairs.
    pub fn from_entries(iter: impl IntoIterator<Item = (String, FrameType)>) -> Self {
        let entries = iter.into_iter().map(|(k, v)| (k.trim().to_ascii_lowercase(), v)).collect();
        Self { entries }
    }

    /// Normalise a raw `IMAGETYP` string to a [`FrameType`].
    ///
    /// Comparison is case-insensitive and trims surrounding whitespace.
    /// Returns `None` for unknown or empty values.
    #[must_use]
    pub fn normalize(&self, raw: &str) -> Option<FrameType> {
        let key = raw.trim().to_ascii_lowercase();
        if key.is_empty() {
            return None;
        }
        self.entries.get(&key).copied()
    }

    /// Return the number of entries in the table.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns `true` if the table has no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// Build the V1 normalization table from the canonical embedded mapping.
///
/// Source: `docs/research/imagetyp-normalization.md` (T0-IMAGETYP-Research).
#[must_use]
pub fn v1_normalization_table() -> ImageTypNormalizationTable {
    // Comprehensive mapping compiled from NINA, SGP, APT, Voyager, Ekos/KStars,
    // MaximDL, ACP, ASIAIR, SharpCap, ZWO ASI, FireCapture documentation and
    // user-reported real FITS files. (Ref: R-IMAGETYP-Norm, T0-IMAGETYP-Research)
    let entries: &[(&str, FrameType)] = &[
        // ── LIGHT / SCIENCE frames ────────────────────────────────────────────
        ("light", FrameType::Light),
        ("light frame", FrameType::Light),
        ("light frames", FrameType::Light),
        ("science", FrameType::Light),
        ("science frame", FrameType::Light),
        ("science frames", FrameType::Light),
        ("object", FrameType::Light), // ACP, MaximDL
        // ── DARK frames ───────────────────────────────────────────────────────
        ("dark", FrameType::Dark),
        ("dark frame", FrameType::Dark),
        ("dark frames", FrameType::Dark),
        // ── BIAS frames ───────────────────────────────────────────────────────
        ("bias", FrameType::Bias),
        ("bias frame", FrameType::Bias),
        ("bias frames", FrameType::Bias),
        ("offset", FrameType::Bias), // SGP, some European capture software
        ("offset frame", FrameType::Bias),
        ("zero", FrameType::Bias), // MaximDL
        // ── FLAT frames ───────────────────────────────────────────────────────
        ("flat", FrameType::Flat),
        ("flat frame", FrameType::Flat),
        ("flat frames", FrameType::Flat),
        ("sky flat", FrameType::Flat),
        ("dawn flat", FrameType::Flat),
        ("dusk flat", FrameType::Flat),
        ("twilight flat", FrameType::Flat),
        // NOTE: dark_flat is intentionally absent (R-DarkFlat-Reserved).
        // Files with "darkflat", "dark flat", "flat dark" etc. are unclassified
        // until manually reclassified via inbox.reclassify.
    ];

    ImageTypNormalizationTable::from_entries(entries.iter().map(|(k, v)| ((*k).to_owned(), *v)))
}

// ── RawFileMetadata ───────────────────────────────────────────────────────────

/// Minimal extracted header values returned by format-specific extractors.
///
/// Fields are `Option<String>` because any header keyword may be absent or
/// unreadable. Normalization and classification happen in `crates/domain/core`
/// or `crates/app/core`.
#[derive(Clone, Debug, Default)]
pub struct RawFileMetadata {
    /// Raw `IMAGETYP` string (before normalization).
    pub image_typ: Option<String>,
    /// `FILTER` keyword value.
    pub filter: Option<String>,
    /// `OBJECT` keyword value.
    pub object: Option<String>,
    /// `EXPTIME` or `EXPOSURE` (seconds as a string).
    pub exposure: Option<String>,
    /// `GAIN` keyword value.
    pub gain: Option<String>,
    /// `XBINNING` value.
    pub x_binning: Option<String>,
    /// `YBINNING` value.
    pub y_binning: Option<String>,
    /// `NAXIS1` (image width in pixels).
    pub naxis1: Option<String>,
    /// `NAXIS2` (image height in pixels).
    pub naxis2: Option<String>,
    /// `INSTRUME` (camera/instrument identifier).
    pub instrume: Option<String>,
    /// `TELESCOP` (telescope identifier).
    pub telescop: Option<String>,
    /// `DATE-OBS` (ISO 8601 string or FITS-style `YYYY-MM-DDTHH:MM:SS`).
    pub date_obs: Option<String>,
}

// ── MetadataExtractor ─────────────────────────────────────────────────────────

/// Trait implemented by format-specific adapters (`crates/metadata/fits`,
/// `crates/metadata/xisf`).
///
/// Extractors read header-level metadata only; they MUST NOT modify files.
pub trait MetadataExtractor: Send + Sync {
    /// Read raw metadata from the file at `path`.
    ///
    /// Returns `Ok(None)` when the file exists but the format is not supported
    /// by this extractor (e.g. a FITS extractor encountering an XISF file).
    ///
    /// # Errors
    /// Returns an error string describing any I/O or parse failure.
    fn extract(
        &self,
        path: &std::path::Path,
    ) -> Result<Option<RawFileMetadata>, MetadataExtractError>;

    /// Returns `true` if this extractor can handle the given file extension
    /// (case-insensitive, without leading dot).
    fn supports_extension(&self, ext: &str) -> bool;
}

/// Error type for [`MetadataExtractor::extract`].
#[derive(Clone, Debug, thiserror::Error)]
pub enum MetadataExtractError {
    #[error("I/O error reading {path}: {msg}")]
    Io { path: String, msg: String },
    #[error("Parse error in {path}: {msg}")]
    Parse { path: String, msg: String },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_type_round_trips() {
        for ft in [
            FrameType::Light,
            FrameType::Dark,
            FrameType::Bias,
            FrameType::Flat,
            FrameType::DarkFlat,
        ] {
            assert_eq!(FrameType::from_str_ci(ft.as_str()), Some(ft));
        }
    }

    #[test]
    fn evidence_source_round_trips() {
        for es in [
            EvidenceSource::ImagetypHeader,
            EvidenceSource::XisfProperty,
            EvidenceSource::ManualOverride,
            EvidenceSource::None,
        ] {
            assert_eq!(EvidenceSource::from_str_ci(es.as_str()), Some(es));
        }
    }

    #[test]
    fn normalization_table_light_variants() {
        let table = v1_normalization_table();
        assert_eq!(table.normalize("Light"), Some(FrameType::Light));
        assert_eq!(table.normalize("LIGHT"), Some(FrameType::Light));
        assert_eq!(table.normalize("light frame"), Some(FrameType::Light));
        assert_eq!(table.normalize("Science"), Some(FrameType::Light));
        assert_eq!(table.normalize("object"), Some(FrameType::Light));
    }

    #[test]
    fn normalization_table_dark_variants() {
        let table = v1_normalization_table();
        assert_eq!(table.normalize("Dark"), Some(FrameType::Dark));
        assert_eq!(table.normalize("DARK FRAME"), Some(FrameType::Dark));
    }

    #[test]
    fn normalization_table_bias_variants() {
        let table = v1_normalization_table();
        assert_eq!(table.normalize("Bias"), Some(FrameType::Bias));
        assert_eq!(table.normalize("Offset"), Some(FrameType::Bias));
        assert_eq!(table.normalize("zero"), Some(FrameType::Bias));
    }

    #[test]
    fn normalization_table_flat_variants() {
        let table = v1_normalization_table();
        assert_eq!(table.normalize("Flat"), Some(FrameType::Flat));
        assert_eq!(table.normalize("flat frame"), Some(FrameType::Flat));
        assert_eq!(table.normalize("Sky Flat"), Some(FrameType::Flat));
    }

    #[test]
    fn normalization_table_unknown_returns_none() {
        let table = v1_normalization_table();
        assert_eq!(table.normalize("UNKNOWN_TYPE"), None);
        assert_eq!(table.normalize(""), None);
        assert_eq!(table.normalize("dark flat"), None);
        assert_eq!(table.normalize("darkflat"), None);
    }

    #[test]
    fn normalization_table_trims_whitespace() {
        let table = v1_normalization_table();
        assert_eq!(table.normalize("  Light  "), Some(FrameType::Light));
        assert_eq!(table.normalize("\tDark\t"), Some(FrameType::Dark));
    }

    #[test]
    fn normalization_table_not_empty() {
        let table = v1_normalization_table();
        assert!(!table.is_empty());
        assert!(table.len() > 10);
    }
}
