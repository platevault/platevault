// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Isolated patched copies of FITS files (spec 069 PREP-FR-03, PREP-FR-20;
//! D-W123), built on `fits-header`: the copy's primary header carries the
//! edits, and every byte after the original primary header, the data unit
//! and any later HDUs, is written unchanged. Originals are only read.
//!
//! Every card of an edit's keywords is overwritten, each occurrence; an
//! alias is never added and the canonical keyword only where none of the
//! edit's `add_unless` keywords is present. A value is written to one
//! fixed-format card or refused, never continued on CONTINUE cards. The
//! header grows by a block when an added card needs one.

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use fits_header::{FitsError, Header, IntoValue, Key, RecordKind, Value, BLOCK_LEN, CARD_LEN};
use metadata_core::patch::{validate, EditValue, FieldEdit, KeywordWrite, PatchError, Refusal};

/// Headers longer than this are refused rather than read further.
const MAX_HEADER_BLOCKS: usize = 64;

/// The length of the primary header region at the start of `bytes`: its
/// cards up to and including `END`, in whole 2880-byte blocks, found as
/// `fits-header` finds it. `None` without `END`, or when `bytes` ends before
/// that block does.
#[must_use]
pub fn header_len(bytes: &[u8]) -> Option<usize> {
    let end =
        bytes.as_chunks::<CARD_LEN>().0.iter().position(|card| card[..8].trim_ascii() == b"END")?;
    let len = ((end + 1) * CARD_LEN).div_ceil(BLOCK_LEN) * BLOCK_LEN;
    (len <= bytes.len()).then_some(len)
}

/// The primary header region of the file at `path`, read block by block.
///
/// # Errors
/// I/O errors; [`Refusal::NoHeader`] when no `END` card is found.
pub fn read_header_region(path: &Path) -> Result<Vec<u8>, PatchError> {
    let mut file = File::open(path)?;
    let mut bytes = Vec::with_capacity(BLOCK_LEN);
    let mut block = vec![0_u8; BLOCK_LEN];
    for _ in 0..MAX_HEADER_BLOCKS {
        match file.read_exact(&mut block) {
            Ok(()) => bytes.extend_from_slice(&block),
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(error.into()),
        }
        if let Some(len) = header_len(&bytes) {
            bytes.truncate(len);
            return Ok(bytes);
        }
    }
    Err(PatchError::refused(0, Refusal::NoHeader))
}

/// The header block a patched copy of a file with primary header region
/// `header` starts with.
///
/// # Errors
/// Why the header can't carry `edits`.
pub fn patched_header(header: &[u8], edits: &[FieldEdit]) -> Result<Vec<u8>, PatchError> {
    Ok(edited(header, edits)?.to_header_bytes())
}

/// Whether the FITS file at `source` can carry `edits`; reads only its
/// primary header.
///
/// # Errors
/// Why it can't.
pub fn check(source: &Path, edits: &[FieldEdit]) -> Result<(), PatchError> {
    edited(&read_header_region(source)?, edits).map(drop)
}

/// Create the patched copy of `source`, a whole FITS file's bytes, at
/// `dest`, which must not exist: the patched primary header, then every byte
/// after the original one unchanged. Returns the header block it wrote.
///
/// # Errors
/// Why the header can't carry `edits`; I/O errors, including an existing
/// `dest`.
pub fn write_copy(source: &[u8], dest: &Path, edits: &[FieldEdit]) -> Result<Vec<u8>, PatchError> {
    let len = header_len(source).ok_or_else(|| PatchError::refused(0, Refusal::NoHeader))?;
    let header = edited(&source[..len], edits)?;
    header.write_to_file(dest, &source[len..]).map_err(header_error)?;
    Ok(header.to_header_bytes())
}

fn header_error(error: FitsError) -> PatchError {
    match error {
        FitsError::Io(detail) => PatchError::Io(io::Error::other(detail)),
        other => PatchError::Header(other.to_string()),
    }
}

/// The parsed primary header `bytes` with `edits` applied in memory.
fn edited(bytes: &[u8], edits: &[FieldEdit]) -> Result<Header, PatchError> {
    validate(edits)?;
    let no_header = || PatchError::refused(0, Refusal::NoHeader);
    let mut header = Header::parse(bytes).map_err(|_| no_header())?;
    if header.cards().first().and_then(|card| card.keyword()) != Some("SIMPLE") {
        return Err(no_header());
    }
    // The copy's header changes, so a CHECKSUM over the original HDU would be
    // wrong in it: it goes. DATASUM stays, since the data unit is copied
    // unchanged. Follow-up: have `fits-header` recompute CHECKSUM on write.
    while header.count("CHECKSUM") > 0 {
        header.remove(("CHECKSUM", 0)).map_err(header_error)?;
    }
    let image_in_extension = matches!(header.get::<i64>("NAXIS"), Ok(Some(0)));
    for (index, edit) in edits.iter().enumerate() {
        let refused = |reason| PatchError::refused(index, reason);
        if edit.hierarch.iter().any(|alias| holds_hierarch(&header, alias)) {
            return Err(refused(Refusal::HierarchAlias));
        }
        let present = edit.add_unless.iter().any(|keyword| header.count(keyword) > 0);
        for write in &edit.writes {
            for occurrence in 0..header.count(write.keyword) {
                let comment = header
                    .iter()
                    .filter(|card| card.keyword() == Some(write.keyword))
                    .nth(occurrence)
                    .and_then(|card| card.comment().map(str::to_owned));
                one_card(write, comment.as_deref()).map_err(refused)?;
                set(&mut header, (write.keyword, occurrence), &write.value)?;
            }
        }
        if let (false, Some(canonical)) = (present, edit.canonical()) {
            if image_in_extension {
                return Err(refused(Refusal::ImageInExtension));
            }
            one_card(canonical, None).map_err(refused)?;
            set(&mut header, canonical.keyword, &canonical.value)?;
        }
    }
    Ok(header)
}

fn value_of(value: &EditValue) -> Value {
    match value {
        EditValue::Text(text) => text.as_str().into_value(),
        EditValue::Real(number) => (*number).into_value(),
        EditValue::Integer(number) => (*number).into_value(),
    }
}

fn set(header: &mut Header, key: impl Into<Key>, value: &EditValue) -> Result<(), PatchError> {
    match value_of(value) {
        Value::Str(text) => header.set(key, text),
        Value::Literal(token) => header.set(key, fits_header::Literal(token)),
    }
    .map_err(header_error)
}

/// Whether `write`, keeping `comment`, renders as one card rather than a
/// CONTINUE run (`fits-header` continues a value that doesn't fit).
fn one_card(write: &KeywordWrite, comment: Option<&str>) -> Result<(), Refusal> {
    let value = match value_of(&write.value) {
        Value::Str(text) => format!("'{:<8}'", text.replace('\'', "''")).len(),
        Value::Literal(token) => token.len().max(20),
    };
    let comment = comment.map_or(0, |comment| comment.len() + 3);
    if 10 + value + comment > CARD_LEN {
        return Err(Refusal::TooLong);
    }
    Ok(())
}

/// Whether the header holds a HIERARCH card for `alias`, which
/// `fits-header` keeps as opaque text.
fn holds_hierarch(header: &Header, alias: &str) -> bool {
    header.iter().any(|card| match &card.kind {
        RecordKind::Opaque { text } => text
            .strip_prefix("HIERARCH")
            .map(str::trim_start)
            .and_then(|rest| rest.split(|c: char| c == '=' || c.is_whitespace()).next())
            .is_some_and(|name| name.eq_ignore_ascii_case(alias)),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(cards: &[&str]) -> Vec<u8> {
        let mut bytes: Vec<u8> =
            cards.iter().flat_map(|card| format!("{card:<80}").into_bytes()).collect();
        bytes.extend(format!("{:<80}", "END").into_bytes());
        bytes.resize(bytes.len().div_ceil(BLOCK_LEN) * BLOCK_LEN, b' ');
        bytes
    }

    fn write(keyword: &'static str, value: EditValue) -> KeywordWrite {
        KeywordWrite { keyword, value }
    }

    fn edit(writes: Vec<KeywordWrite>, add_unless: &'static [&'static str]) -> FieldEdit {
        FieldEdit { writes, add_unless, hierarch: &[], property: None }
    }

    fn text(value: &str) -> EditValue {
        EditValue::Text(value.to_owned())
    }

    /// The trimmed cards of a header block, up to `END`.
    fn cards(bytes: &[u8]) -> Vec<String> {
        bytes
            .chunks(CARD_LEN)
            .map(|card| String::from_utf8_lossy(card).trim_end().to_owned())
            .take_while(|card| card != "END")
            .collect()
    }

    const SIMPLE: &str = "SIMPLE  =                    T";
    const NAXIS: &str = "NAXIS   =                    2";

    fn real(keyword: &str, value: &str) -> String {
        format!("{keyword:<8}= {value:>20}")
    }

    /// Every present card of an edit's keywords is overwritten, each
    /// occurrence and in its own units; an absent alias is never added, an
    /// absent canonical keyword is.
    #[test]
    fn overwrites_every_present_alias_and_adds_only_the_canonical_keyword() {
        let focal_card = format!("{} / mm", real("FOCAL", "135.0"));
        let length_card = real("FLENGTH", "0.135");
        let source = header(&[SIMPLE, NAXIS, &focal_card, &length_card, &length_card]);
        let focal = edit(
            vec![
                write("FOCALLEN", EditValue::Real(250.0)),
                write("FOCAL", EditValue::Real(250.0)),
                write("FLENGTH", EditValue::Real(0.25)),
            ],
            &["FOCALLEN"],
        );
        let object = edit(
            vec![write("OBJECT", text("NGC 7000")), write("OBJNAME", text("NGC 7000"))],
            &["OBJECT"],
        );
        let patched = patched_header(&source, &[focal, object]).unwrap();
        assert_eq!(
            cards(&patched),
            [
                SIMPLE.to_owned(),
                NAXIS.to_owned(),
                format!("{} / mm", real("FOCAL", "250.0")),
                real("FLENGTH", "0.25"),
                real("FLENGTH", "0.25"),
                real("FOCALLEN", "250.0"),
                "OBJECT  = 'NGC 7000'".to_owned(),
            ]
        );
    }

    /// `EXPTIME` is added only when neither it nor `EXPOSURE` is present.
    #[test]
    fn adds_the_canonical_keyword_only_without_any_named_alias() {
        let exposure = || {
            edit(
                vec![
                    write("EXPTIME", EditValue::Real(300.0)),
                    write("EXPOSURE", EditValue::Real(300.0)),
                ],
                &["EXPTIME", "EXPOSURE"],
            )
        };
        let alias = header(&[SIMPLE, NAXIS, &real("EXPOSURE", "60.0")]);
        let patched = patched_header(&alias, &[exposure()]).unwrap();
        let expected = [SIMPLE.to_owned(), NAXIS.to_owned(), real("EXPOSURE", "300.0")];
        assert_eq!(cards(&patched), expected);
        let neither = header(&[SIMPLE, NAXIS]);
        let patched = patched_header(&neither, &[exposure()]).unwrap();
        let expected = [SIMPLE.to_owned(), NAXIS.to_owned(), real("EXPTIME", "300.0")];
        assert_eq!(cards(&patched), expected);
    }

    /// A HIERARCH alias of a corrected field refuses until `fits-header` can
    /// address it; one of another field doesn't.
    #[test]
    fn a_hierarch_alias_of_the_field_refuses() {
        let source = header(&[SIMPLE, NAXIS, "HIERARCH TELESCOPE = 'Samyang 135'"]);
        let telescope = FieldEdit {
            hierarch: &["TELESCOPE"],
            ..edit(vec![write("TELESCOP", text("RedCat 51"))], &["TELESCOP"])
        };
        let refused = patched_header(&source, &[telescope]).unwrap_err();
        assert!(
            matches!(refused, PatchError::Refused(r) if r.reason == Refusal::HierarchAlias),
            "{refused}"
        );
        let camera = FieldEdit {
            hierarch: &["INSTRUMENT"],
            ..edit(vec![write("INSTRUME", text("ASI2600MM"))], &["INSTRUME"])
        };
        assert!(patched_header(&source, &[camera]).is_ok());
    }

    /// The edit makes CHECKSUM wrong, so the copy drops it; DATASUM, over
    /// the unchanged data, stays.
    #[test]
    fn drops_checksum_and_keeps_datasum() {
        let source = header(&[SIMPLE, NAXIS, "CHECKSUM= 'abc'", "DATASUM = '123'"]);
        let object = edit(vec![write("OBJECT", text("NGC 7000"))], &["OBJECT"]);
        let patched = patched_header(&source, &[object]).unwrap();
        assert_eq!(cards(&patched), [SIMPLE, NAXIS, "DATASUM = '123'", "OBJECT  = 'NGC 7000'"]);
    }

    /// What no fixed-format card holds is refused, never continued.
    #[test]
    fn refuses_what_one_card_cannot_hold() {
        let source = header(&[SIMPLE, NAXIS, &format!("OBJECT  = 'M 31'  / {}", "c".repeat(55))]);
        let long = edit(vec![write("OBJECT", text(&"x".repeat(30)))], &["OBJECT"]);
        let refused = patched_header(&source, &[long]).unwrap_err();
        assert!(matches!(refused, PatchError::Refused(r) if r.reason == Refusal::TooLong));
        let ascii = edit(vec![write("OBJECT", text("Hα"))], &["OBJECT"]);
        let refused = patched_header(&source, &[ascii]).unwrap_err();
        assert!(
            matches!(refused, PatchError::Refused(r) if r.reason == Refusal::NotPrintableAscii)
        );
        let extension = header(&[SIMPLE, "NAXIS   =                    0"]);
        let object = edit(vec![write("OBJECT", text("NGC 7000"))], &["OBJECT"]);
        let refused = patched_header(&extension, &[object]).unwrap_err();
        assert!(matches!(refused, PatchError::Refused(r) if r.reason == Refusal::ImageInExtension));
        let refused = patched_header(b"not a FITS header", &[]).unwrap_err();
        assert!(matches!(refused, PatchError::Refused(r) if r.reason == Refusal::NoHeader));
    }

    /// The copy holds the patched header, then every byte after the
    /// original primary header unchanged; a header that runs out of room
    /// grows by a block. The copy is never written over an existing file.
    #[test]
    fn writes_the_copy_with_the_data_unit_unchanged() {
        let filler: Vec<String> = (0..33).map(|index| format!("COMMENT {index}")).collect();
        let mut cards: Vec<&str> = vec![SIMPLE, NAXIS];
        cards.extend(filler.iter().map(String::as_str));
        let mut source = header(&cards);
        assert_eq!(source.len(), BLOCK_LEN, "END is the block's last card");
        let data: Vec<u8> = (0..=255).cycle().take(BLOCK_LEN + 7).collect();
        source.extend_from_slice(&data);
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("copy.fits");
        let object = edit(vec![write("OBJECT", text("NGC 7000"))], &["OBJECT"]);
        let written = write_copy(&source, &dest, std::slice::from_ref(&object)).unwrap();
        let copy = std::fs::read(&dest).unwrap();
        assert_eq!(written.len(), 2 * BLOCK_LEN);
        assert_eq!(&copy[..written.len()], written.as_slice());
        assert_eq!(&copy[written.len()..], data.as_slice(), "the data unit is copied unchanged");
        assert_eq!(Header::parse(&copy).unwrap().get_str("OBJECT").unwrap(), Some("NGC 7000"));
        assert!(write_copy(&source, &dest, &[object]).is_err(), "never over an existing file");
    }
}
