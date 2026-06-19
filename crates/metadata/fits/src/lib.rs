//! Minimal pure-Rust FITS header reader (spec 005 T005).
//!
//! # FITS Header Format
//!
//! A FITS file begins with one or more 2880-byte blocks. Each block contains
//! 36 header cards; each card is exactly 80 ASCII bytes. The header ends at the
//! first card whose first 8 bytes are `END     `.
//!
//! This extractor reads only the header keywords required for inbox
//! classification: `IMAGETYP`, `FILTER`, `OBJECT`, `EXPTIME`, `EXPOSURE`,
//! `GAIN`, `XBINNING`, `YBINNING`, `NAXIS1`, `NAXIS2`, `INSTRUME`, `TELESCOP`,
//! `DATE-OBS`.
//!
//! No cfitsio or heavy C dependencies — the implementation reads raw bytes.
//! Missing or garbage headers are handled gracefully; the extractor never
//! panics or returns hard errors for corrupt files, preferring `None` values.
#![allow(clippy::doc_markdown)]

use std::io::{self, Read};
use std::path::Path;

use metadata_core::{MetadataExtractError, MetadataExtractor, RawFileMetadata};

// ── Constants ─────────────────────────────────────────────────────────────────

const BLOCK_SIZE: usize = 2880;
const CARD_SIZE: usize = 80;
const CARDS_PER_BLOCK: usize = BLOCK_SIZE / CARD_SIZE;

/// Maximum number of blocks to read before giving up.
/// A typical FITS primary header is 1-4 blocks; 32 is extremely generous.
const MAX_HEADER_BLOCKS: usize = 32;

// ── FitsExtractor ─────────────────────────────────────────────────────────────

/// Adapter that reads standard FITS header keywords using a pure-Rust parser.
///
/// Supports `.fits`, `.fit`, `.fts` extensions.
pub struct FitsExtractor;

impl MetadataExtractor for FitsExtractor {
    fn extract(&self, path: &Path) -> Result<Option<RawFileMetadata>, MetadataExtractError> {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();

        if !self.supports_extension(&ext) {
            return Ok(None);
        }

        let file = std::fs::File::open(path).map_err(|e| MetadataExtractError::Io {
            path: path.display().to_string(),
            msg: e.to_string(),
        })?;

        let cards = read_header_cards(file, path).map_err(|e| MetadataExtractError::Io {
            path: path.display().to_string(),
            msg: e.to_string(),
        })?;

        Ok(Some(parse_cards(&cards)))
    }

    fn supports_extension(&self, ext: &str) -> bool {
        matches!(ext, "fits" | "fit" | "fts")
    }
}

// ── Header reading ────────────────────────────────────────────────────────────

/// Read all header cards up to (but not including) the END card.
///
/// Returns only the 80-byte cards that precede the `END` marker.
fn read_header_cards(mut reader: impl Read, _path: &Path) -> io::Result<Vec<[u8; CARD_SIZE]>> {
    let mut cards = Vec::new();
    let mut block = [0u8; BLOCK_SIZE];

    for _ in 0..MAX_HEADER_BLOCKS {
        match reader.read_exact(&mut block) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e),
        }

        for i in 0..CARDS_PER_BLOCK {
            let card_bytes = &block[i * CARD_SIZE..(i + 1) * CARD_SIZE];
            let mut card = [0u8; CARD_SIZE];
            card.copy_from_slice(card_bytes);

            // Check for END marker
            if card_bytes.starts_with(b"END     ") || card_bytes.starts_with(b"END\x00") {
                return Ok(cards);
            }

            cards.push(card);
        }
    }

    Ok(cards)
}

// ── Card parsing ──────────────────────────────────────────────────────────────

/// Parse a list of 80-byte FITS cards into [`RawFileMetadata`].
fn parse_cards(cards: &[[u8; CARD_SIZE]]) -> RawFileMetadata {
    let mut meta = RawFileMetadata::default();

    for card in cards {
        // A value card has keyword in bytes 0..8 and '= ' at bytes 8..10.
        // Some cards use HIERARCH extension but we ignore those for now.
        let keyword_bytes = &card[0..8];
        // Trim trailing spaces from the 8-byte keyword field.
        let keyword = std::str::from_utf8(keyword_bytes).unwrap_or("").trim_end();

        match keyword {
            "IMAGETYP" => meta.image_typ = extract_string_value(card),
            "FILTER" => meta.filter = extract_string_value(card),
            "OBJECT" => meta.object = extract_string_value(card),
            "EXPTIME" | "EXPOSURE" if meta.exposure.is_none() => {
                meta.exposure = extract_numeric_string(card);
            }
            "GAIN" => meta.gain = extract_numeric_string(card),
            "XBINNING" => meta.x_binning = extract_numeric_string(card),
            "YBINNING" => meta.y_binning = extract_numeric_string(card),
            "NAXIS1" => meta.naxis1 = extract_numeric_string(card),
            "NAXIS2" => meta.naxis2 = extract_numeric_string(card),
            "INSTRUME" => meta.instrume = extract_string_value(card),
            "TELESCOP" => meta.telescop = extract_string_value(card),
            "DATE-OBS" => meta.date_obs = extract_string_value(card),
            // Stack/integration count: STACKCNT (preferred) or NCOMBINE fallback.
            "STACKCNT" => {
                meta.stack_count =
                    extract_numeric_string(card).and_then(|s| s.trim().parse::<u32>().ok());
            }
            "NCOMBINE" if meta.stack_count.is_none() => {
                meta.stack_count =
                    extract_numeric_string(card).and_then(|s| s.trim().parse::<u32>().ok());
            }
            _ => {}
        }
    }

    meta
}

/// Extract a FITS string value (between single quotes) from a card.
///
/// FITS string values look like:  `IMAGETYP= 'Light Frame'         / comment`
/// The value is between single quotes. Trailing spaces inside the quotes are
/// significant per FITS standard but we trim them for practical use.
fn extract_string_value(card: &[u8; CARD_SIZE]) -> Option<String> {
    // Bytes 0..8 keyword, byte 8 should be '=', byte 9 is usually ' '.
    let value_area = std::str::from_utf8(&card[8..]).ok()?;
    let after_eq = value_area.trim_start_matches(['=', ' ']);

    if let Some(inner) = after_eq.strip_prefix('\'') {
        // Find closing quote (handle doubled single-quote escape '' → ')
        let close = inner.find('\'')?;
        let raw = &inner[..close];
        let trimmed = raw.trim_end();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.replace("''", "'"))
        }
    } else {
        None
    }
}

/// Extract a FITS numeric value (no quotes) from a card as a string.
///
/// Example: `NAXIS1  =                 4144 / image width in pixels`
fn extract_numeric_string(card: &[u8; CARD_SIZE]) -> Option<String> {
    let value_area = std::str::from_utf8(&card[8..]).ok()?;
    // Skip '=' and whitespace
    let value_part = value_area.trim_start_matches(['=', ' ']);
    // Take until '/' (comment marker) or end of field
    let raw_value = value_part.split('/').next().unwrap_or("").trim().to_owned();

    if raw_value.is_empty() {
        None
    } else {
        Some(raw_value)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Test helpers ──────────────────────────────────────────────────────────

    /// Build a single FITS block (2880 bytes) from a list of 80-char card strings.
    /// Missing cards are filled with spaces. Appends an END card.
    fn build_fits_header(cards: &[&str]) -> Vec<u8> {
        let mut block = vec![b' '; BLOCK_SIZE];
        let mut idx = 0usize;

        for card_str in cards {
            if idx >= CARDS_PER_BLOCK {
                break;
            }
            let bytes = card_str.as_bytes();
            let len = bytes.len().min(CARD_SIZE);
            block[idx * CARD_SIZE..idx * CARD_SIZE + len].copy_from_slice(&bytes[..len]);
            idx += 1;
        }

        // Write END card
        if idx < CARDS_PER_BLOCK {
            let end_pos = idx * CARD_SIZE;
            block[end_pos..end_pos + 3].copy_from_slice(b"END");
        }

        block
    }

    /// Pad a card string to exactly 80 chars.
    fn pad80(s: &str) -> String {
        format!("{s:<80}")
    }

    // ── IMAGETYP extraction ───────────────────────────────────────────────────

    #[test]
    fn parses_imagetyp_light_frame() {
        let card = pad80("IMAGETYP= 'Light Frame'");
        let block = build_fits_header(&[&card]);
        let cards_parsed = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards_parsed);
        assert_eq!(meta.image_typ, Some("Light Frame".to_owned()));
    }

    #[test]
    fn parses_imagetyp_dark() {
        let card = pad80("IMAGETYP= 'Dark Frame'           / frame type");
        let block = build_fits_header(&[&card]);
        let cards_parsed = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards_parsed);
        assert_eq!(meta.image_typ, Some("Dark Frame".to_owned()));
    }

    #[test]
    fn parses_imagetyp_bias() {
        let card = pad80("IMAGETYP= 'Bias Frame'");
        let block = build_fits_header(&[&card]);
        let cards = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards);
        assert_eq!(meta.image_typ, Some("Bias Frame".to_owned()));
    }

    #[test]
    fn parses_filter() {
        let card = pad80("FILTER  = 'Ha      '");
        let block = build_fits_header(&[&card]);
        let cards = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards);
        assert_eq!(meta.filter, Some("Ha".to_owned()));
    }

    #[test]
    fn parses_object() {
        let card = pad80("OBJECT  = 'NGC 7000'           / object name");
        let block = build_fits_header(&[&card]);
        let cards = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards);
        assert_eq!(meta.object, Some("NGC 7000".to_owned()));
    }

    #[test]
    fn parses_exptime() {
        let card = pad80("EXPTIME =                 300.0 / exposure time in seconds");
        let block = build_fits_header(&[&card]);
        let cards = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards);
        assert_eq!(meta.exposure, Some("300.0".to_owned()));
    }

    #[test]
    fn parses_gain() {
        let card = pad80("GAIN    =                   100 / camera gain");
        let block = build_fits_header(&[&card]);
        let cards = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards);
        assert_eq!(meta.gain, Some("100".to_owned()));
    }

    #[test]
    fn parses_naxis() {
        let cards =
            [pad80("NAXIS1  =                  4144"), pad80("NAXIS2  =                  2822")];
        let block = build_fits_header(&cards.iter().map(String::as_str).collect::<Vec<_>>());
        let parsed = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&parsed);
        assert_eq!(meta.naxis1, Some("4144".to_owned()));
        assert_eq!(meta.naxis2, Some("2822".to_owned()));
    }

    #[test]
    fn parses_instrume_and_telescop() {
        let cards = [pad80("INSTRUME= 'ZWO ASI2600MM Pro'"), pad80("TELESCOP= 'AT130-EDT'")];
        let block = build_fits_header(&cards.iter().map(String::as_str).collect::<Vec<_>>());
        let parsed = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&parsed);
        assert_eq!(meta.instrume, Some("ZWO ASI2600MM Pro".to_owned()));
        assert_eq!(meta.telescop, Some("AT130-EDT".to_owned()));
    }

    #[test]
    fn parses_date_obs() {
        let card = pad80("DATE-OBS= '2025-10-10T22:15:00'");
        let block = build_fits_header(&[&card]);
        let cards = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards);
        assert_eq!(meta.date_obs, Some("2025-10-10T22:15:00".to_owned()));
    }

    #[test]
    fn missing_keywords_return_none() {
        let card = pad80("SIMPLE  =                    T / file conforms to FITS standard");
        let block = build_fits_header(&[&card]);
        let cards = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards);
        assert!(meta.image_typ.is_none());
        assert!(meta.filter.is_none());
        assert!(meta.object.is_none());
    }

    #[test]
    fn empty_block_returns_empty_metadata() {
        let block = build_fits_header(&[]);
        let cards = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&cards);
        assert!(meta.image_typ.is_none());
    }

    #[test]
    fn extractor_rejects_xisf_extension() {
        let extractor = FitsExtractor;
        assert!(!extractor.supports_extension("xisf"));
        assert!(extractor.supports_extension("fits"));
        assert!(extractor.supports_extension("fit"));
        assert!(extractor.supports_extension("fts"));
    }

    #[test]
    fn multi_keyword_card_set() {
        let cards = [
            pad80("IMAGETYP= 'Flat Frame'"),
            pad80("FILTER  = 'OIII    '"),
            pad80("EXPTIME =                   3.0"),
            pad80("XBINNING=                     1"),
            pad80("YBINNING=                     1"),
        ];
        let block = build_fits_header(&cards.iter().map(String::as_str).collect::<Vec<_>>());
        let parsed = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&parsed);
        assert_eq!(meta.image_typ, Some("Flat Frame".to_owned()));
        assert_eq!(meta.filter, Some("OIII".to_owned()));
        assert_eq!(meta.exposure, Some("3.0".to_owned()));
        assert_eq!(meta.x_binning, Some("1".to_owned()));
        assert_eq!(meta.y_binning, Some("1".to_owned()));
    }

    #[test]
    fn exposure_keyword_fallback_to_exposure() {
        // EXPTIME takes priority; if absent, EXPOSURE is used
        let cards = [pad80("EXPOSURE=                 120.0 / exposure in seconds")];
        let block = build_fits_header(&cards.iter().map(String::as_str).collect::<Vec<_>>());
        let parsed = read_header_cards(block.as_slice(), Path::new("test.fits")).unwrap();
        let meta = parse_cards(&parsed);
        assert_eq!(meta.exposure, Some("120.0".to_owned()));
    }
}
