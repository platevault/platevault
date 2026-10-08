// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Catalog corrections delivered through an isolated patched Copy or Clone
//! (spec 069 PREP-FR-03, PREP-AC-06, D15): which capture fields differ from
//! the header, which FITS keywords the application reads for them, and the
//! header cards a patched entry carries in place of the source's.
//!
//! A patch replaces whole 80-byte cards of the primary header, or takes the
//! blank cards after `END` for a keyword the header lacks, so the entry keeps
//! the source's length and differs from it only by those cards. Only FITS is
//! patched; originals and links never are.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::{CaptureMetadata, CorrectedField};

const BLOCK: usize = 2880;
const CARD: usize = 80;
const CARDS_PER_BLOCK: usize = BLOCK / CARD;
/// Headers longer than this are refused rather than searched further.
const MAX_HEADER_BLOCKS: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ValueKind {
    Text,
    Real,
    Integer,
}

/// The FITS keywords `PlateVault`'s reader takes each correctable capture
/// field from, in its order of preference, with the value they hold.
const KEYWORDS: [(&str, &[&str], ValueKind); 12] = [
    ("filter", &["FILTER"], ValueKind::Text),
    ("object", &["OBJECT"], ValueKind::Text),
    ("imageType", &["IMAGETYP"], ValueKind::Text),
    ("camera", &["INSTRUME"], ValueKind::Text),
    ("telescope", &["TELESCOP"], ValueKind::Text),
    ("exposureSeconds", &["EXPTIME", "EXPOSURE"], ValueKind::Real),
    ("gain", &["GAIN"], ValueKind::Real),
    ("offset", &["OFFSET", "BLKLEVEL"], ValueKind::Integer),
    ("binningX", &["XBINNING"], ValueKind::Integer),
    ("binningY", &["YBINNING"], ValueKind::Integer),
    ("setTemperatureC", &["SET-TEMP"], ValueKind::Real),
    ("focalLengthMm", &["FOCALLEN"], ValueKind::Real),
];

fn keyword_entry(field: &str) -> Option<(&'static [&'static str], ValueKind)> {
    KEYWORDS
        .iter()
        .find(|(name, _, _)| *name == field)
        .map(|(_, keywords, kind)| (*keywords, *kind))
}

/// One header card a patched entry holds where the source holds `original`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Card {
    /// Byte offset of the card in the file.
    pub offset: u64,
    pub original: [u8; CARD],
    pub patched: [u8; CARD],
}

impl Card {
    pub const LEN: u64 = CARD as u64;
}

/// Every capture field whose confirmed catalog value differs from the value
/// the header holds, with the keywords a patch writes for it.
#[must_use]
pub fn corrected_fields(
    observed: &CaptureMetadata,
    effective: &CaptureMetadata,
) -> Vec<CorrectedField> {
    let (Ok(serde_json::Value::Object(observed)), Ok(serde_json::Value::Object(effective))) =
        (serde_json::to_value(observed), serde_json::to_value(effective))
    else {
        return Vec::new();
    };
    effective
        .iter()
        .filter(|(field, value)| field.as_str() != "raw" && observed.get(*field) != Some(*value))
        .map(|(field, value)| CorrectedField {
            field: field.clone(),
            keywords: keyword_entry(field)
                .map(|(keywords, _)| keywords.iter().map(|keyword| (*keyword).to_owned()).collect())
                .unwrap_or_default(),
            header: observed.get(field).and_then(shown),
            catalog: shown(value),
        })
        .collect()
}

fn shown(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

/// The cards a patched entry of `source` carries for `changes`: its
/// primary header read, then [`plan`].
///
/// # Errors
/// Why `source` cannot be patched, naming nothing but the cause.
pub fn cards_for(source: &Path, changes: &[CorrectedField]) -> Result<Vec<Card>, String> {
    plan(&read_header(source)?, changes)
}

/// The primary header of `path`, whole blocks up to the one holding `END`.
fn read_header(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut header = Vec::new();
    let mut block = [0_u8; BLOCK];
    for _ in 0..MAX_HEADER_BLOCKS {
        file.read_exact(&mut block).map_err(|_| "it is not a FITS file".to_owned())?;
        header.extend_from_slice(&block);
        if block.as_chunks::<CARD>().0.iter().any(|card| is_end(card)) {
            return Ok(header);
        }
    }
    Err(format!("its header holds no END card in {MAX_HEADER_BLOCKS} blocks"))
}

fn is_end(card: &[u8]) -> bool {
    card.starts_with(b"END") && card[3..].iter().all(|byte| *byte == b' ')
}

fn is_blank(card: &[u8]) -> bool {
    card.iter().all(|byte| *byte == b' ')
}

/// The value card of `keyword`, which an assignment `= ` follows.
fn holds(card: &[u8], keyword: &str) -> bool {
    let name = &card[..8];
    name.starts_with(keyword.as_bytes())
        && name[keyword.len()..].iter().all(|byte| *byte == b' ')
        && &card[8..10] == b"= "
}

/// The cards `changes` replace or add in `header`, by offset. A keyword the
/// header holds is replaced in every card that holds it; a missing one takes
/// the blank card after `END`, which moves down, inside the same block.
///
/// # Errors
/// Why the header cannot carry `changes`: no FITS header, a field without a
/// keyword, a value that is no FITS value, no room for an added card, a
/// long-string value continued on CONTINUE cards a patch would orphan, or a
/// CHECKSUM or DATASUM a patch would leave stale. These are refused, never
/// rewritten.
pub fn plan(header: &[u8], changes: &[CorrectedField]) -> Result<Vec<Card>, String> {
    let cards: Vec<&[u8]> =
        header.as_chunks::<CARD>().0.iter().map(<[u8; CARD]>::as_slice).collect();
    if !cards.first().is_some_and(|card| card.starts_with(b"SIMPLE  = ")) {
        return Err("it is not a FITS file".to_owned());
    }
    let end = cards.iter().position(|card| is_end(card)).ok_or("its header has no END card")?;
    if let Some(keyword) = ["CHECKSUM", "DATASUM"]
        .into_iter()
        .find(|keyword| cards[..end].iter().any(|card| holds(card, keyword)))
    {
        return Err(format!("its header holds {keyword}, which a patched copy would leave stale"));
    }
    let mut patched = Vec::new();
    let mut added = Vec::new();
    for change in changes {
        let (keywords, kind) = keyword_entry(&change.field)
            .ok_or_else(|| format!("PlateVault patches no header keyword for {}", change.field))?;
        let value = change
            .catalog
            .as_deref()
            .ok_or_else(|| format!("the catalog holds no {} value to write", change.field))?;
        let mut found = false;
        for keyword in keywords {
            let card = value_card(keyword, kind, value)?;
            for (index, held) in
                cards[..end].iter().enumerate().filter(|(_, held)| holds(held, keyword))
            {
                if continued(held)
                    || cards.get(index + 1).is_some_and(|next| next.starts_with(b"CONTINUE"))
                {
                    return Err(format!(
                        "its {keyword} value continues on CONTINUE cards, which a patch would orphan"
                    ));
                }
                patched.push(card_at(index, held, card));
                found = true;
            }
        }
        if !found {
            added.push((keywords[0], value_card(keywords[0], kind, value)?));
        }
    }
    if let Some((keyword, _)) = added.first() {
        if cards[..end].iter().any(|card| holds(card, "NAXIS") && value_text(card) == "0") {
            return Err(format!(
                "its header holds no {keyword} card and its image lies in an extension, whose \
                 header PlateVault does not patch"
            ));
        }
        let moved = end + added.len();
        let room = (end / CARDS_PER_BLOCK + 1) * CARDS_PER_BLOCK;
        if moved >= room || !cards[end + 1..=moved].iter().all(|card| is_blank(card)) {
            return Err(format!("its header has no room to add a {keyword} card"));
        }
        for (slot, (_, card)) in (end..).zip(added) {
            patched.push(card_at(slot, cards[slot], card));
        }
        let mut end_card = [b' '; CARD];
        end_card[..3].copy_from_slice(b"END");
        patched.push(card_at(moved, cards[moved], end_card));
    }
    patched.sort_by_key(|card| card.offset);
    patched.dedup_by_key(|card| card.offset);
    Ok(patched)
}

/// Whether a card's string value ends in `&`: a FITS long string that the
/// next CONTINUE card carries on.
fn continued(card: &[u8]) -> bool {
    let value = &card[10..];
    let Some(rest) = value.trim_ascii_start().strip_prefix(b"'") else {
        return false;
    };
    let mut text = Vec::new();
    let mut bytes = rest.iter();
    while let Some(&byte) = bytes.next() {
        if byte == b'\'' {
            if bytes.as_slice().first() == Some(&b'\'') {
                bytes.next();
            } else {
                break;
            }
        }
        text.push(byte);
    }
    text.trim_ascii_end().ends_with(b"&")
}

fn card_at(index: usize, held: &[u8], patched: [u8; CARD]) -> Card {
    let mut original = [b' '; CARD];
    original.copy_from_slice(held);
    Card { offset: u64::try_from(index * CARD).unwrap_or(u64::MAX), original, patched }
}

/// The value field of a card: columns 11 to the comment, trimmed.
fn value_text(card: &[u8]) -> &str {
    let value = std::str::from_utf8(&card[10..]).unwrap_or_default();
    value.split('/').next().unwrap_or_default().trim()
}

/// A fixed-format FITS value card: a quoted string from column 11, or a
/// number right-justified to column 30.
fn value_card(keyword: &str, kind: ValueKind, value: &str) -> Result<[u8; CARD], String> {
    let refused = || format!("'{value}' is no FITS {keyword} value");
    let text = match kind {
        ValueKind::Text => {
            if !value.bytes().all(|byte| (b' '..=b'~').contains(&byte)) {
                return Err(format!("'{value}' is not printable ASCII, which a FITS header needs"));
            }
            format!("{keyword:<8}= '{:<8}'", value.replace('\'', "''"))
        }
        ValueKind::Real => {
            let number: f64 = value.parse().map_err(|_| refused())?;
            if !number.is_finite() {
                return Err(refused());
            }
            let number = format!("{number:?}").replace('e', "E");
            format!("{keyword:<8}= {number:>20}")
        }
        ValueKind::Integer => {
            let number: i64 = value.parse().map_err(|_| refused())?;
            format!("{keyword:<8}= {number:>20}")
        }
    };
    if text.len() > CARD {
        return Err(format!("'{value}' does not fit one FITS header card"));
    }
    let mut card = [b' '; CARD];
    card[..text.len()].copy_from_slice(text.as_bytes());
    Ok(card)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(cards: &[&str]) -> Vec<u8> {
        let mut bytes: Vec<u8> =
            cards.iter().flat_map(|card| format!("{card:<80}").into_bytes()).collect();
        bytes.extend(format!("{:<80}", "END").into_bytes());
        bytes.resize(bytes.len().div_ceil(BLOCK) * BLOCK, b' ');
        bytes
    }

    fn change(field: &str, header: &str, catalog: &str) -> CorrectedField {
        CorrectedField {
            field: field.to_owned(),
            keywords: keyword_entry(field)
                .map(|(keywords, _)| keywords.iter().map(|k| (*k).to_owned()).collect())
                .unwrap_or_default(),
            header: Some(header.to_owned()),
            catalog: Some(catalog.to_owned()),
        }
    }

    fn text(card: &[u8; CARD]) -> &str {
        std::str::from_utf8(card).unwrap().trim_end()
    }

    #[test]
    fn replaces_the_card_the_header_holds() {
        let source = header(&[
            "SIMPLE  =                    T",
            "NAXIS   =                    2",
            "FILTER  = 'Ha      '           / filter",
        ]);
        let cards = plan(&source, &[change("filter", "Ha", "OIII")]).unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].offset, 160);
        assert_eq!(&cards[0].original[..], &source[160..240]);
        assert_eq!(text(&cards[0].patched), "FILTER  = 'OIII    '");
    }

    #[test]
    fn adds_a_missing_card_before_end() {
        let source = header(&["SIMPLE  =                    T", "NAXIS   =                    2"]);
        let cards = plan(&source, &[change("exposureSeconds", "", "300.0")]).unwrap();
        assert_eq!(cards.iter().map(|card| card.offset).collect::<Vec<_>>(), [160, 240]);
        assert_eq!(text(&cards[0].patched), "EXPTIME =                300.0");
        assert_eq!(text(&cards[1].patched), "END");
    }

    #[test]
    fn refuses_what_it_cannot_patch() {
        let source = header(&["SIMPLE  =                    T", "NAXIS   =                    0"]);
        assert!(plan(&source, &[change("filter", "", "Ha")]).unwrap_err().contains("extension"));
        assert!(plan(&source, &[change("readoutMode", "a", "b")])
            .unwrap_err()
            .contains("readoutMode"));
        assert!(plan(b"not a fits header", &[change("filter", "Ha", "OIII")]).is_err());
        let full: Vec<String> = std::iter::once("SIMPLE  =                    T".to_owned())
            .chain((1..35).map(|index| format!("COMMENT {index}")))
            .collect();
        let full: Vec<&str> = full.iter().map(String::as_str).collect();
        assert!(plan(&header(&full), &[change("filter", "", "Ha")]).unwrap_err().contains("room"));
        let named = header(&["SIMPLE  =                    T", "FILTER  = 'Ha'"]);
        assert!(plan(&named, &[change("filter", "Ha", "Hα")]).unwrap_err().contains("ASCII"));
    }

    #[test]
    fn corrected_fields_name_catalog_and_header_values() {
        let observed = CaptureMetadata {
            filter: Some("Ha".into()),
            gain: Some(100.0),
            ..CaptureMetadata::default()
        };
        let effective = CaptureMetadata { filter: Some("OIII".into()), ..observed.clone() };
        assert_eq!(corrected_fields(&observed, &effective), [change("filter", "Ha", "OIII")]);
        assert!(corrected_fields(&observed, &observed).is_empty());
    }

    /// A patch never orphans CONTINUE cards or leaves a checksum stale: it
    /// is refused, naming why, so review names it.
    #[test]
    fn refuses_continued_strings_and_checksums() {
        let simple = "SIMPLE  =                    T";
        let naxis = "NAXIS   =                    2";
        let object = change("object", "NGC 7000 North America Nebula", "NGC 7000");
        let continued =
            header(&[simple, naxis, "OBJECT  = 'NGC 7000 North America&'", "CONTINUE  ' Nebula'"]);
        assert!(plan(&continued, std::slice::from_ref(&object)).unwrap_err().contains("CONTINUE"));
        let ampersand = header(&[simple, naxis, "OBJECT  = 'NGC 7000&'           / name"]);
        assert!(plan(&ampersand, std::slice::from_ref(&object)).unwrap_err().contains("CONTINUE"));
        let followed = header(&[simple, naxis, "OBJECT  = 'NGC 7000'", "CONTINUE  'x'"]);
        assert!(plan(&followed, &[object]).unwrap_err().contains("CONTINUE"));
        for keyword in ["CHECKSUM", "DATASUM"] {
            let card = format!("{keyword:<8}= '0'");
            let summed = header(&[simple, naxis, "FILTER  = 'Ha      '", card.as_str()]);
            let refusal = plan(&summed, &[change("filter", "Ha", "OIII")]).unwrap_err();
            assert!(refusal.contains(keyword), "{refusal}");
        }
    }
}
