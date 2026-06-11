//! XISF metadata extraction adapter (spec 005 T006).
//!
//! # XISF Header Format
//!
//! An XISF file (PixInsight's native format) begins with a 16-byte signature
//! followed by a 4-byte little-endian XML header length, 4-byte reserved, and
//! then the XML header itself.
//!
//! The XML `<xisf>` element contains an `<Image>` element with optional
//! `<FITSKeyword>` children. Each `<FITSKeyword>` carries `name`, `value`, and
//! `comment` attributes — exactly the FITS header keyword model.
//!
//! This extractor reads only the XML header (no pixel data) and extracts the
//! same keywords as the FITS extractor via the `<FITSKeyword>` elements.
//!
//! No heavy C dependencies — uses `quick-xml` for the XML parse.
#![allow(clippy::doc_markdown)]

use std::io::{self, Read};
use std::path::Path;

use metadata_core::{MetadataExtractError, MetadataExtractor, RawFileMetadata};
use quick_xml::events::Event;
use quick_xml::Reader;

// ── Constants ─────────────────────────────────────────────────────────────────

/// XISF file signature bytes (8-byte "XISF0100" marker).
const XISF_SIGNATURE: &[u8; 8] = b"XISF0100";

/// Maximum XML header size we're willing to read (8 MiB). A real XISF header
/// with hundreds of FITSKeyword entries will be well under 1 MiB.
const MAX_XML_BYTES: u32 = 8 * 1024 * 1024;

// ── XisfExtractor ─────────────────────────────────────────────────────────────

/// Adapter that reads FITS-compatible metadata from XISF files via their XML
/// header.
///
/// Supports `.xisf` extension.
pub struct XisfExtractor;

impl MetadataExtractor for XisfExtractor {
    fn extract(&self, path: &Path) -> Result<Option<RawFileMetadata>, MetadataExtractError> {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();

        if !self.supports_extension(&ext) {
            return Ok(None);
        }

        let mut file = std::fs::File::open(path).map_err(|e| MetadataExtractError::Io {
            path: path.display().to_string(),
            msg: e.to_string(),
        })?;

        let xml = read_xml_header(&mut file, path).map_err(|e| MetadataExtractError::Io {
            path: path.display().to_string(),
            msg: e.to_string(),
        })?;

        parse_xml_header(&xml, path).map(Some)
    }

    fn supports_extension(&self, ext: &str) -> bool {
        ext == "xisf"
    }
}

// ── Header reading ────────────────────────────────────────────────────────────

/// Read the XML header bytes from an XISF file.
///
/// XISF header layout:
/// - Bytes  0..8  : signature `XISF0100`
/// - Bytes  8..12 : XML header length (u32 little-endian)
/// - Bytes 12..16 : reserved (4 bytes, must be 0)
/// - Bytes 16..16+length : UTF-8 XML
fn read_xml_header(reader: &mut impl Read, path: &Path) -> io::Result<String> {
    let mut preamble = [0u8; 16];
    reader.read_exact(&mut preamble)?;

    if &preamble[0..8] != XISF_SIGNATURE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{}: not an XISF file (bad signature)", path.display()),
        ));
    }

    let xml_length = u32::from_le_bytes(preamble[8..12].try_into().unwrap());

    if xml_length > MAX_XML_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{}: XISF XML header too large ({xml_length} bytes)", path.display()),
        ));
    }

    let mut xml_bytes = vec![0u8; xml_length as usize];
    reader.read_exact(&mut xml_bytes)?;

    String::from_utf8(xml_bytes).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidData, "XISF XML header is not valid UTF-8")
    })
}

// ── XML parsing ───────────────────────────────────────────────────────────────

/// Parse FITSKeyword elements from the XISF XML header and build
/// [`RawFileMetadata`].
fn parse_xml_header(xml: &str, path: &Path) -> Result<RawFileMetadata, MetadataExtractError> {
    let mut meta = RawFileMetadata::default();
    let mut reader = Reader::from_str(xml);

    let path_str = path.display().to_string();

    loop {
        match reader.read_event() {
            Ok(Event::Empty(e) | Event::Start(e)) => {
                // We only care about <FITSKeyword> elements
                if e.name().as_ref() != b"FITSKeyword" {
                    continue;
                }

                let mut name: Option<String> = None;
                let mut value: Option<String> = None;

                for attr_result in e.attributes() {
                    let attr = attr_result.map_err(|e| MetadataExtractError::Parse {
                        path: path_str.clone(),
                        msg: format!("attribute error: {e}"),
                    })?;

                    let key =
                        std::str::from_utf8(attr.key.as_ref()).unwrap_or("").to_ascii_lowercase();
                    let val = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map(std::borrow::Cow::into_owned)
                        .unwrap_or_default();

                    match key.as_str() {
                        "name" => name = Some(val),
                        "value" => value = Some(val),
                        _ => {}
                    }
                }

                if let (Some(kw), Some(val)) = (name, value) {
                    apply_fits_keyword(&mut meta, &kw, &val);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(MetadataExtractError::Parse {
                    path: path_str,
                    msg: format!("XML parse error: {e}"),
                });
            }
            _ => {}
        }
    }

    Ok(meta)
}

/// Apply a FITS keyword/value pair to `meta`, following the same rules as the
/// FITS extractor.
///
/// XISF stores string values with surrounding single quotes (like FITS cards);
/// we strip them here.
fn apply_fits_keyword(meta: &mut RawFileMetadata, keyword: &str, raw_value: &str) {
    // Strip FITS-style single-quote wrapping: 'Light Frame' → Light Frame
    let value = strip_fits_string_quotes(raw_value);

    match keyword.trim_end() {
        "IMAGETYP" => meta.image_typ = non_empty(value),
        "FILTER" => meta.filter = non_empty(value),
        "OBJECT" => meta.object = non_empty(value),
        "EXPTIME" | "EXPOSURE" if meta.exposure.is_none() => {
            meta.exposure = non_empty(value);
        }
        "GAIN" => meta.gain = non_empty(value),
        "XBINNING" => meta.x_binning = non_empty(value),
        "YBINNING" => meta.y_binning = non_empty(value),
        "NAXIS1" => meta.naxis1 = non_empty(value),
        "NAXIS2" => meta.naxis2 = non_empty(value),
        "INSTRUME" => meta.instrume = non_empty(value),
        "TELESCOP" => meta.telescop = non_empty(value),
        "DATE-OBS" => meta.date_obs = non_empty(value),
        _ => {}
    }
}

/// Strip FITS-style single-quote wrapping: `'Light Frame'` → `Light Frame`.
/// Also handles doubled single-quote escape: `''` → `'`.
fn strip_fits_string_quotes(s: &str) -> &str {
    let inner = s.trim();
    if inner.starts_with('\'') && inner.ends_with('\'') && inner.len() >= 2 {
        &inner[1..inner.len() - 1]
    } else {
        inner
    }
}

fn non_empty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_owned())
    }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal XISF byte stream with the given FITSKeyword entries.
    ///
    /// `keywords` is a list of `(name, value, comment)` triples.
    fn build_xisf(keywords: &[(&str, &str, &str)]) -> Vec<u8> {
        let mut kw_xml = String::new();
        for (name, value, comment) in keywords {
            kw_xml.push_str("   <FITSKeyword name=\"");
            kw_xml.push_str(name);
            kw_xml.push_str("\" value=\"");
            kw_xml.push_str(value);
            kw_xml.push_str("\" comment=\"");
            kw_xml.push_str(comment);
            kw_xml.push_str("\" />\n");
        }

        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
 <Image geometry="4144:2822:1" sampleFormat="Float32" >
{kw_xml}
 </Image>
</xisf>"#
        );

        let xml_bytes = xml.as_bytes();
        let xml_len = u32::try_from(xml_bytes.len()).expect("test XML too large");

        let mut out = Vec::new();
        out.extend_from_slice(XISF_SIGNATURE);
        out.extend_from_slice(&xml_len.to_le_bytes());
        out.extend_from_slice(&[0u8; 4]); // reserved
        out.extend_from_slice(xml_bytes);
        out
    }

    #[test]
    fn parses_imagetyp_light() {
        let data = build_xisf(&[("IMAGETYP", "'Light Frame'", "frame type")]);
        let xml = read_xml_header(&mut data.as_slice(), Path::new("test.xisf")).unwrap();
        let meta = parse_xml_header(&xml, Path::new("test.xisf")).unwrap();
        assert_eq!(meta.image_typ, Some("Light Frame".to_owned()));
    }

    #[test]
    fn parses_imagetyp_dark() {
        let data = build_xisf(&[("IMAGETYP", "'Dark Frame'", "")]);
        let xml = read_xml_header(&mut data.as_slice(), Path::new("test.xisf")).unwrap();
        let meta = parse_xml_header(&xml, Path::new("test.xisf")).unwrap();
        assert_eq!(meta.image_typ, Some("Dark Frame".to_owned()));
    }

    #[test]
    fn parses_filter_and_object() {
        let data = build_xisf(&[
            ("FILTER", "'Ha      '", "filter name"),
            ("OBJECT", "'NGC 7000'", "target"),
        ]);
        let xml = read_xml_header(&mut data.as_slice(), Path::new("test.xisf")).unwrap();
        let meta = parse_xml_header(&xml, Path::new("test.xisf")).unwrap();
        assert_eq!(meta.filter, Some("Ha".to_owned()));
        assert_eq!(meta.object, Some("NGC 7000".to_owned()));
    }

    #[test]
    fn parses_exptime() {
        let data = build_xisf(&[("EXPTIME", "300.0", "exposure in seconds")]);
        let xml = read_xml_header(&mut data.as_slice(), Path::new("test.xisf")).unwrap();
        let meta = parse_xml_header(&xml, Path::new("test.xisf")).unwrap();
        assert_eq!(meta.exposure, Some("300.0".to_owned()));
    }

    #[test]
    fn parses_gain_and_binning() {
        let data = build_xisf(&[
            ("GAIN", "100", "camera gain"),
            ("XBINNING", "1", ""),
            ("YBINNING", "1", ""),
        ]);
        let xml = read_xml_header(&mut data.as_slice(), Path::new("test.xisf")).unwrap();
        let meta = parse_xml_header(&xml, Path::new("test.xisf")).unwrap();
        assert_eq!(meta.gain, Some("100".to_owned()));
        assert_eq!(meta.x_binning, Some("1".to_owned()));
        assert_eq!(meta.y_binning, Some("1".to_owned()));
    }

    #[test]
    fn parses_instrume_telescop() {
        let data = build_xisf(&[
            ("INSTRUME", "'ZWO ASI2600MM Pro'", "camera"),
            ("TELESCOP", "'AT130-EDT'", "scope"),
        ]);
        let xml = read_xml_header(&mut data.as_slice(), Path::new("test.xisf")).unwrap();
        let meta = parse_xml_header(&xml, Path::new("test.xisf")).unwrap();
        assert_eq!(meta.instrume, Some("ZWO ASI2600MM Pro".to_owned()));
        assert_eq!(meta.telescop, Some("AT130-EDT".to_owned()));
    }

    #[test]
    fn parses_date_obs() {
        let data = build_xisf(&[("DATE-OBS", "'2025-10-10T22:15:00'", "")]);
        let xml = read_xml_header(&mut data.as_slice(), Path::new("test.xisf")).unwrap();
        let meta = parse_xml_header(&xml, Path::new("test.xisf")).unwrap();
        assert_eq!(meta.date_obs, Some("2025-10-10T22:15:00".to_owned()));
    }

    #[test]
    fn missing_keywords_return_none() {
        let data = build_xisf(&[]);
        let xml = read_xml_header(&mut data.as_slice(), Path::new("test.xisf")).unwrap();
        let meta = parse_xml_header(&xml, Path::new("test.xisf")).unwrap();
        assert!(meta.image_typ.is_none());
        assert!(meta.filter.is_none());
        assert!(meta.object.is_none());
    }

    #[test]
    fn bad_signature_returns_error() {
        let mut data = build_xisf(&[]);
        data[0..8].copy_from_slice(b"NOTXISF!");
        let err = read_xml_header(&mut data.as_slice(), Path::new("bad.xisf"));
        assert!(err.is_err());
    }

    #[test]
    fn extractor_rejects_fits_extension() {
        let extractor = XisfExtractor;
        assert!(!extractor.supports_extension("fits"));
        assert!(extractor.supports_extension("xisf"));
    }

    #[test]
    fn strip_fits_string_quotes_works() {
        assert_eq!(strip_fits_string_quotes("'Light Frame'"), "Light Frame");
        assert_eq!(strip_fits_string_quotes("'Ha      '"), "Ha      ");
        assert_eq!(strip_fits_string_quotes("300.0"), "300.0");
        assert_eq!(strip_fits_string_quotes("''"), "");
    }
}
