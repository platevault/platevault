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
    /// Integration count from `STACKCNT` (preferred) or `NCOMBINE`.
    ///
    /// Present only in stacked/master files that carry this keyword.
    /// Used by the master-detect crate to identify stacked calibration frames.
    pub stack_count: Option<u32>,

    // ── Extended extracted metadata (spec 041 T062, R-9/R-18) ───────────────
    // All fields are best-effort: absent header ⇒ `None`, never an error.
    /// Camera read-out offset / pedestal from `OFFSET` (fallback `BLKLEVEL`).
    /// Grouping dimension for all four frame types. ADU.
    pub offset: Option<i64>,
    /// Sensor set/target temperature from `SET-TEMP`. Default dark-grouping
    /// temperature source (R-18 temperature policy). Degrees Celsius.
    pub set_temp_c: Option<f64>,
    /// Sensor actual temperature from `CCD-TEMP` (fallback `DET-TEMP`,
    /// DWARF III). Deviation-warning source. Degrees Celsius.
    pub ccd_temp_c: Option<f64>,
    /// Right ascension in decimal degrees.
    ///
    /// Decimal `RA` is preferred; sexagesimal `OBJCTRA` (`H M S`) is converted
    /// to decimal degrees (×15) as a fallback. Light pointing + R-17 target
    /// resolution.
    pub ra_deg: Option<f64>,
    /// Declination in decimal degrees.
    ///
    /// Decimal `DEC` is preferred; sexagesimal `OBJCTDEC` (`±D M S`) is
    /// converted to decimal degrees as a fallback. Light pointing + R-17.
    pub dec_deg: Option<f64>,
    /// Mechanical rotator angle in degrees from `ROTATANG` (= `ROTATOR`).
    ///
    /// This is the flat↔light match key and tolerant light grouping
    /// dimension (R-18). NOT the sky position angle.
    pub rotator_angle_deg: Option<f64>,
    /// Rotator device identifier from `ROTNAME`. Informational only.
    pub rotator_name: Option<String>,
    /// Sky position angle in degrees from `OBJCTROT`.
    ///
    /// Informational only — explicitly NOT a flat-match key (R-18). Kept
    /// separate from [`Self::rotator_angle_deg`] so the two are never swapped.
    pub sky_rotation_deg: Option<f64>,
    /// Sensor readout mode from `READOUTM`. Optional grouping dim, default OFF.
    pub readout_mode: Option<String>,
    /// Focal length in millimetres from `FOCALLEN`
    /// (XISF `Instrument:Telescope:FocalLength` is in metres → ×1000).
    /// Optic-train composite input (light + flat).
    pub focal_length_mm: Option<f64>,
    /// Pixel size in micrometres from `XPIXSZ` (fallback `PIXSIZE`;
    /// XISF `Image:PixelSize`). Feeds the FOV-aware target radius (R-17).
    pub pixel_size_um: Option<f64>,
    /// Observer latitude in degrees from `SITELAT` → `OBSGEO-B` → `LAT-OBS`.
    /// Future grouping only.
    pub observer_lat: Option<f64>,
    /// Observer longitude in degrees from `SITELONG` → `OBSGEO-L` →
    /// `LONG-OBS`. Prerequisite for UTC-fallback night binning.
    pub observer_long: Option<f64>,
    /// Observer elevation in metres from `SITEELEV` → `OBSGEO-H` → `ALT-OBS`.
    /// Future grouping only.
    pub observer_elev: Option<f64>,
    /// Local civil time of observation from `DATE-LOC`. Observing-night =
    /// local calendar date under a noon boundary (R-18).
    pub date_loc: Option<String>,
    /// Observation end time from `DATE-END`. Dark-run span heuristic.
    pub date_end: Option<String>,
    /// Modified Julian Date of exposure midpoint from `MJD-AVG`
    /// (NINA 3.2+). Ordering / dark-run span / UTC math (preferred).
    pub mjd_avg: Option<f64>,
    /// Modified Julian Date of exposure start from `MJD-OBS`.
    /// Ordering / dark-run span fallback.
    pub mjd_obs: Option<f64>,
}

// ── Coordinate / value parsing helpers ──────────────────────────────────────

/// Parse a sexagesimal right-ascension string in `H M S` form (e.g.
/// `"18 10 38"` or `"5 34 57.984"`) into decimal **degrees**.
///
/// RA is expressed in hours; the result is multiplied by 15 (360° / 24h).
/// Separators may be spaces or colons. Returns `None` for unparseable input,
/// or when the parsed value is outside the RA domain (`[0, 360)`).
///
/// Delegates the sexagesimal→decimal conversion to
/// `target_match::Equatorial::parse` (a paired call with a `"0"` Dec
/// sentinel, since that constructor validates RA and Dec together). FITS/XISF
/// header values are frequently single-quoted; that quoting is stripped here
/// before parsing, since `target_match` treats quote characters as part of
/// the token (a FITS-specific tolerance, not a general coordinate concern).
#[must_use]
pub fn sexagesimal_ra_to_deg(raw: &str) -> Option<f64> {
    let cleaned = strip_fits_quotes(raw)?;
    target_match::Equatorial::parse(cleaned, "0", target_match::Epoch::J2000)
        .ok()
        .map(|e| e.ra().degrees())
}

/// Parse a sexagesimal declination string in `±D M S` form (e.g.
/// `"-15 01 11"` or `"+0 00 00.00"`) into decimal **degrees**.
///
/// A leading `-` on the degrees field applies to the whole value.
/// Separators may be spaces or colons. Returns `None` for unparseable input,
/// or when the parsed value is outside the Dec domain (`[-90, 90]`).
///
/// See [`sexagesimal_ra_to_deg`] for the shared parsing/quoting approach.
#[must_use]
pub fn sexagesimal_dec_to_deg(raw: &str) -> Option<f64> {
    let cleaned = strip_fits_quotes(raw)?;
    target_match::Equatorial::parse("0", cleaned, target_match::Epoch::J2000)
        .ok()
        .map(|e| e.dec().degrees())
}

/// Strip surrounding whitespace and a single layer of FITS single-quoting
/// (`'...'`) from a header value string. Returns `None` for empty input.
fn strip_fits_quotes(raw: &str) -> Option<&str> {
    let trimmed = raw.trim().trim_matches('\'').trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// Parse a decimal value from a FITS/XISF value string, tolerating a trailing
/// FITS comment is the caller's responsibility (pass the already-extracted
/// value). Returns `None` for empty or non-numeric input.
#[must_use]
pub fn parse_f64(raw: &str) -> Option<f64> {
    let t = raw.trim();
    if t.is_empty() {
        None
    } else {
        t.parse::<f64>().ok()
    }
}

/// Parse an integer value (e.g. `OFFSET`) from a value string. Accepts values
/// written as floats (`"20.0"` → `20`) by truncating toward zero.
#[must_use]
pub fn parse_i64(raw: &str) -> Option<i64> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(v) = t.parse::<i64>() {
        return Some(v);
    }
    // Fall back to float parse (some writers emit `20.0`); round to nearest
    // representable integer (offsets/pedestals are small, well within range).
    #[allow(clippy::cast_possible_truncation)]
    t.parse::<f64>().ok().map(|f| f.trunc() as i64)
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

    // ── Sexagesimal coordinate conversion (spec 041 T062) ─────────────────────

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-6, "expected {b}, got {a}");
    }

    #[test]
    fn ra_hms_to_deg_real_poseidon() {
        // Real Poseidon-C header: OBJCTRA = '18 10 38' (H M S)
        // 18h10m38s = (18 + 10/60 + 38/3600) * 15 = 272.6583333…°
        approx(sexagesimal_ra_to_deg("18 10 38").unwrap(), 272.658_333_333);
    }

    #[test]
    fn ra_hms_to_deg_with_fractional_seconds() {
        // Real XISF header: OBJCTRA = '5 34 57.984'
        approx(sexagesimal_ra_to_deg("5 34 57.984").unwrap(), 83.7416);
    }

    #[test]
    fn ra_hms_strips_surrounding_quotes() {
        approx(sexagesimal_ra_to_deg("'5 34 57.984'").unwrap(), 83.7416);
    }

    #[test]
    fn ra_hms_colon_separator() {
        approx(sexagesimal_ra_to_deg("18:10:38").unwrap(), 272.658_333_333);
    }

    #[test]
    fn dec_dms_negative_real_poseidon() {
        // Real Poseidon-C header: OBJCTDEC = '-15 01 11' (D M S)
        // -(15 + 1/60 + 11/3600) = -15.019722…
        approx(sexagesimal_dec_to_deg("-15 01 11").unwrap(), -15.019_722_222);
    }

    #[test]
    fn dec_dms_positive_zero() {
        // Real DWARF/synthetic: OBJCTDEC = '+0 00 00.00'
        approx(sexagesimal_dec_to_deg("+0 00 00.00").unwrap(), 0.0);
    }

    #[test]
    fn dec_dms_negative_sub_degree_keeps_sign() {
        // -0d 20m → must stay negative even though degree field is 0
        approx(sexagesimal_dec_to_deg("-0 20 00").unwrap(), -0.333_333_333);
    }

    #[test]
    fn sexagesimal_degrees_only() {
        approx(sexagesimal_dec_to_deg("45").unwrap(), 45.0);
    }

    #[test]
    fn sexagesimal_invalid_returns_none() {
        assert!(sexagesimal_ra_to_deg("").is_none());
        assert!(sexagesimal_ra_to_deg("abc").is_none());
        assert!(sexagesimal_dec_to_deg("'   '").is_none());
    }

    #[test]
    fn parse_i64_handles_int_and_float() {
        assert_eq!(parse_i64("20"), Some(20));
        assert_eq!(parse_i64(" 50 "), Some(50));
        assert_eq!(parse_i64("20.0"), Some(20));
        assert_eq!(parse_i64(""), None);
        assert_eq!(parse_i64("x"), None);
    }

    #[test]
    fn parse_f64_helper() {
        approx(parse_f64("3.76").unwrap(), 3.76);
        approx(parse_f64(" -15.0055 ").unwrap(), -15.0055);
        assert!(parse_f64("").is_none());
    }
}
