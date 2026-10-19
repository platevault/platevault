// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Isolated patched copies of FITS files (spec 069 PREP-FR-03, PREP-FR-20;
//! D-W123), built on `fits-header`: the copy's primary header carries the
//! edits, and every byte after the original primary header, the data unit
//! and any later HDUs, is written unchanged. Originals are only read, and
//! streamed rather than held in memory.
//!
//! Every card of an edit's keywords is overwritten, each occurrence; an
//! alias is never added and the canonical keyword only where none of the
//! edit's `add_unless` keywords is present. A present ESO-style `HIERARCH`
//! card of the edit's long aliases (`HIERARCH TELESCOPE`) takes the
//! canonical value too; one `fits-header` can't address, another spelling
//! of such a name, is refused rather than left holding the old value. A
//! value is written to one card or refused, never continued on CONTINUE
//! cards: a value that fits a card on its own is never refused for the
//! comment the card already holds, which is shortened, or dropped when no
//! room is left. The header grows by a block when an added card needs one.
//! A primary header holding `NAXIS = 0` is refused: its image lies in an
//! extension, whose header isn't patched.

use std::fs::File;
use std::io::{self, Read, Write};
use std::path::Path;

use fits_header::{
    FitsError, Header, IntoValue, Key, Literal, RecordKind, Value, BLOCK_LEN, CARD_LEN,
};
use metadata_core::patch::{validate, EditValue, FieldEdit, PatchError, Refusal};
use sha2::{Digest, Sha256};

/// Headers longer than this are refused rather than read further.
const MAX_HEADER_BLOCKS: usize = 64;
/// How much of an original is read at a time.
const STREAM_BUFFER: usize = 1 << 20;
/// A value card's `KEYWORD = ` before its value.
const VALUE_START: usize = 10;
/// A `HIERARCH` card's `HIERARCH ` and ` = ` around its long name.
const HIERARCH_OVERHEAD: usize = "HIERARCH ".len() + " = ".len();
/// The ` / ` between a value and its comment.
const COMMENT_SEPARATOR: usize = 3;
/// The width `fits-header` right-aligns a short literal value in.
const LITERAL_WIDTH: usize = 20;

/// What writing a patched copy read and wrote.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CopyDigests {
    /// The SHA-256 of the original, as it was read.
    pub source: [u8; 32],
    /// The SHA-256 of the patched copy, as it was written.
    pub copy: [u8; 32],
    /// The patched copy's length in bytes.
    pub copy_len: u64,
}

/// The length of the primary header region at the start of `bytes`: its
/// cards up to and including `END`, in whole 2880-byte blocks, found as
/// `fits-header` finds it. `None` without `END`, or when `bytes` ends before
/// that block does.
fn header_len(bytes: &[u8]) -> Option<usize> {
    let end =
        bytes.as_chunks::<CARD_LEN>().0.iter().position(|card| card[..8].trim_ascii() == b"END")?;
    let len = ((end + 1) * CARD_LEN).div_ceil(BLOCK_LEN) * BLOCK_LEN;
    (len <= bytes.len()).then_some(len)
}

/// The primary header region of `file`, read block by block from its
/// start; `file` is left at the first byte after it.
fn read_header_region(file: &mut File) -> Result<Vec<u8>, PatchError> {
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

/// Whether the FITS file at `source` can carry `edits`; reads only its
/// primary header.
///
/// # Errors
/// Why it can't; I/O errors.
pub fn check(source: &Path, edits: &[FieldEdit]) -> Result<(), PatchError> {
    let mut file = File::open(source)?;
    edited(&read_header_region(&mut file)?, edits).map(drop)
}

/// Write the patched copy of the FITS file at `source` to `out`: the
/// patched primary header, then every byte after the original one
/// unchanged, streamed. Returns the digests of what it read and wrote.
///
/// # Errors
/// Why the header can't carry `edits`; I/O errors reading `source` or
/// writing `out`, with their kind.
pub fn write_copy(
    source: &Path,
    out: &mut impl Write,
    edits: &[FieldEdit],
) -> Result<CopyDigests, PatchError> {
    let mut file = File::open(source)?;
    let region = read_header_region(&mut file)?;
    let patched = edited(&region, edits)?.to_header_bytes();
    let (mut source_digest, mut copy_digest) = (Sha256::new(), Sha256::new());
    source_digest.update(&region);
    copy_digest.update(&patched);
    out.write_all(&patched)?;
    let mut copy_len = patched.len() as u64;
    let mut buffer = vec![0_u8; STREAM_BUFFER];
    loop {
        let read = match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error.into()),
        };
        let chunk = &buffer[..read];
        source_digest.update(chunk);
        copy_digest.update(chunk);
        out.write_all(chunk)?;
        copy_len += read as u64;
    }
    out.flush()?;
    Ok(CopyDigests {
        source: source_digest.finalize().into(),
        copy: copy_digest.finalize().into(),
        copy_len,
    })
}

/// The digests [`write_copy`] would return for `source` and `edits`,
/// without writing anything: the proof that a file is that patched copy.
///
/// # Errors
/// As [`write_copy`].
pub fn copy_digests(source: &Path, edits: &[FieldEdit]) -> Result<CopyDigests, PatchError> {
    write_copy(source, &mut io::sink(), edits)
}

fn header_error(error: &FitsError) -> PatchError {
    PatchError::Header(error.to_string())
}

/// The parsed primary header `bytes` with `edits` applied in memory.
fn edited(bytes: &[u8], edits: &[FieldEdit]) -> Result<Header, PatchError> {
    validate(edits)?;
    let no_header = || PatchError::refused(0, Refusal::NoHeader);
    let mut header = Header::parse(bytes).map_err(|_| no_header())?;
    if header.cards().first().and_then(|card| card.keyword()) != Some("SIMPLE") {
        return Err(no_header());
    }
    if matches!(header.get::<i64>("NAXIS"), Ok(Some(0))) {
        return Err(PatchError::refused(0, Refusal::ImageInExtension));
    }
    // The copy's header changes, so a CHECKSUM over the original HDU would be
    // wrong in it: it goes. DATASUM stays, since the data unit is copied
    // unchanged. Follow-up: have `fits-header` recompute CHECKSUM on write.
    while header.count("CHECKSUM") > 0 {
        header.remove(("CHECKSUM", 0)).map_err(|error| header_error(&error))?;
    }
    for (index, edit) in edits.iter().enumerate() {
        let refused = |reason| PatchError::refused(index, reason);
        if edit.hierarch.iter().any(|alias| unaddressable_hierarch(&header, alias)) {
            return Err(refused(Refusal::HierarchAlias));
        }
        let present = edit.add_unless.iter().any(|keyword| header.count(keyword) > 0);
        for write in &edit.writes {
            overwrite_all(&mut header, Card::Standard(write.keyword), &write.value)
                .map_err(|error| error.unwrap_or_else(|| refused(Refusal::TooLong)))?;
        }
        let Some(canonical) = edit.canonical() else { continue };
        for alias in edit.hierarch {
            overwrite_all(&mut header, Card::Hierarch(alias), &canonical.value)
                .map_err(|error| error.unwrap_or_else(|| refused(Refusal::TooLong)))?;
        }
        if !present {
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
        Value::Literal(token) => header.set(key, Literal(token)),
    }
    .map_err(|error| header_error(&error))
}

/// The cards of one keyword: a standard one, or an ESO-style `HIERARCH`
/// long name, which `fits-header` keeps apart.
#[derive(Clone, Copy)]
enum Card<'a> {
    Standard(&'a str),
    Hierarch(&'a str),
}

impl Card<'_> {
    fn key(self, occurrence: usize) -> Key {
        match self {
            Self::Standard(keyword) => (keyword, occurrence).into(),
            Self::Hierarch(name) => Key::hierarch_occurrence(name, occurrence),
        }
    }

    fn holds(self, kind: &RecordKind) -> bool {
        match (self, kind) {
            (Self::Standard(keyword), RecordKind::Value { keyword: name, .. })
            | (Self::Hierarch(keyword), RecordKind::Hierarch { keyword: name, .. }) => {
                name == keyword
            }
            _ => false,
        }
    }

    fn comments(self, header: &Header) -> Vec<Option<String>> {
        header
            .iter()
            .filter(|card| self.holds(&card.kind))
            .map(|card| card.comment().map(str::to_owned))
            .collect()
    }

    /// The characters one of these cards holding `value` has left after
    /// it, or `None` when the value alone doesn't fit the card.
    fn room(self, value: &EditValue) -> Option<usize> {
        let (start, value) = match (self, value_of(value)) {
            (Self::Standard(_), Value::Str(text)) => {
                (VALUE_START, text.replace('\'', "''").len().max(8) + 2)
            }
            (Self::Standard(_), Value::Literal(token)) => {
                (VALUE_START, token.len().max(LITERAL_WIDTH))
            }
            (Self::Hierarch(name), Value::Str(text)) => {
                (HIERARCH_OVERHEAD + name.len(), text.replace('\'', "''").len() + 2)
            }
            (Self::Hierarch(name), Value::Literal(token)) => {
                (HIERARCH_OVERHEAD + name.len(), token.len())
            }
        };
        CARD_LEN.checked_sub(start + value)
    }
}

/// `comment` cut to at most `max` bytes, at the end of a word where one
/// ends in that room.
fn shortened(comment: &str, max: usize) -> &str {
    let end = comment
        .char_indices()
        .map(|(index, character)| index + character.len_utf8())
        .take_while(|end| *end <= max)
        .last()
        .unwrap_or(0);
    let cut = &comment[..end];
    let at_word = match comment[end..].chars().next() {
        Some(next) if !next.is_whitespace() => cut.rfind(' ').map_or(cut, |space| &cut[..space]),
        _ => cut,
    };
    at_word.trim_end()
}

/// Overwrite every present card of `card` with `value`, last first, as a
/// card that can keep no comment moves to the end. A card's comment stays
/// when it fits beside the value, else it is cut to the room left; with no
/// room the card is replaced by one without a comment. `Err(None)` when
/// the value doesn't fit one of these cards.
fn overwrite_all(
    header: &mut Header,
    card: Card,
    value: &EditValue,
) -> Result<(), Option<PatchError>> {
    let comments = card.comments(header);
    if comments.is_empty() {
        return Ok(());
    }
    let room = card.room(value).ok_or(None)?;
    for (occurrence, comment) in comments.into_iter().enumerate().rev() {
        let key = card.key(occurrence);
        let Some(comment) = comment.filter(|comment| COMMENT_SEPARATOR + comment.len() > room)
        else {
            set(header, key, value)?;
            continue;
        };
        let kept = shortened(&comment, room.saturating_sub(COMMENT_SEPARATOR));
        if kept.is_empty() {
            header.remove(key).map_err(|error| header_error(&error))?;
            match card {
                Card::Standard(keyword) => match value_of(value) {
                    Value::Str(text) => header.append(keyword, text),
                    Value::Literal(token) => header.append(keyword, Literal(token)),
                }
                .map_err(|error| header_error(&error))?,
                // A HIERARCH card is only ever set alone; another of the
                // same name would take the value instead.
                Card::Hierarch(name) if card.comments(header).is_empty() => {
                    set(header, Key::hierarch(name), value)?;
                }
                Card::Hierarch(_) => return Err(None),
            }
            continue;
        }
        // `fits-header` checks a HIERARCH card's value against the comment
        // it holds, so the old comment goes before the value changes.
        header.set_comment(key.clone(), "").map_err(|error| header_error(&error))?;
        set(header, key.clone(), value)?;
        header.set_comment(key, kept).map_err(|error| header_error(&error))?;
    }
    Ok(())
}

/// Whether the header holds a `HIERARCH` card naming `alias` in a spelling
/// `fits-header` can't address (only ESO-style uppercase names are), so
/// it would keep the old value.
fn unaddressable_hierarch(header: &Header, alias: &str) -> bool {
    header.iter().any(|card| match &card.kind {
        RecordKind::Opaque { text } => text.strip_prefix("HIERARCH").is_some_and(|rest| {
            let name = rest.split_once('=').map_or(rest, |(name, _)| name);
            name.split_whitespace().collect::<Vec<_>>().join(" ").eq_ignore_ascii_case(alias)
        }),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use metadata_core::patch::KeywordWrite;

    fn header(cards: &[&str]) -> Vec<u8> {
        let mut bytes: Vec<u8> =
            cards.iter().flat_map(|card| format!("{card:<80}").into_bytes()).collect();
        bytes.extend(format!("{:<80}", "END").into_bytes());
        bytes.resize(bytes.len().div_ceil(BLOCK_LEN) * BLOCK_LEN, b' ');
        bytes
    }

    fn patched_header(source: &[u8], edits: &[FieldEdit]) -> Result<Vec<u8>, PatchError> {
        edited(source, edits).map(|header| header.to_header_bytes())
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

    fn object(value: &str) -> FieldEdit {
        edit(vec![write("OBJECT", text(value))], &["OBJECT"])
    }

    /// The trimmed cards of a header block, up to `END`.
    fn cards(bytes: &[u8]) -> Vec<String> {
        bytes
            .chunks(CARD_LEN)
            .map(|card| String::from_utf8_lossy(card).trim_end().to_owned())
            .take_while(|card| card != "END")
            .collect()
    }

    fn refusal(error: &PatchError) -> Option<Refusal> {
        match error {
            PatchError::Refused(refused) => Some(refused.reason),
            _ => None,
        }
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

    fn telescope(value: &str) -> FieldEdit {
        FieldEdit {
            hierarch: &["TELESCOPE"],
            ..edit(vec![write("TELESCOP", text(value))], &["TELESCOP"])
        }
    }

    /// A present ESO-style `HIERARCH TELESCOPE` card takes the corrected
    /// telescope, keeping its comment; every other card keeps its bytes.
    #[test]
    fn overwrites_a_present_hierarch_alias_and_leaves_other_cards_untouched() {
        let source = header(&[
            SIMPLE,
            NAXIS,
            "TELESCOP= 'Samyang 135'",
            "HIERARCH TELESCOPE = 'Samyang 135' / scope",
            "HIERARCH ESO DET DIT = 10.0 / s",
            "FILTER  = 'Ha      '",
        ]);
        let patched = patched_header(&source, &[telescope("RedCat 51")]).unwrap();
        assert_eq!(
            cards(&patched),
            [
                SIMPLE,
                NAXIS,
                "TELESCOP= 'RedCat 51'",
                "HIERARCH TELESCOPE = 'RedCat 51' / scope",
                "HIERARCH ESO DET DIT = 10.0 / s",
                "FILTER  = 'Ha      '",
            ]
        );
        for untouched in [0, 1, 4, 5] {
            let card = untouched * CARD_LEN..(untouched + 1) * CARD_LEN;
            assert_eq!(patched[card.clone()], source[card], "card {untouched} keeps its bytes");
        }
        let parsed = Header::parse(&patched).unwrap();
        assert_eq!(parsed.get_str(Key::hierarch("TELESCOPE")).unwrap(), Some("RedCat 51"));
    }

    /// A `HIERARCH` card naming the alias in another spelling stays opaque
    /// to `fits-header` and would keep the old value, so the field refuses;
    /// another field's edit doesn't.
    #[test]
    fn a_hierarch_alias_fits_header_cannot_address_refuses() {
        let source = header(&[SIMPLE, NAXIS, "HIERARCH Telescope = 'Samyang 135'"]);
        let refused = patched_header(&source, &[telescope("RedCat 51")]).unwrap_err();
        assert_eq!(refusal(&refused), Some(Refusal::HierarchAlias), "{refused}");
        let camera = FieldEdit {
            hierarch: &["INSTRUMENT"],
            ..edit(vec![write("INSTRUME", text("ASI2600MM"))], &["INSTRUME"])
        };
        assert!(patched_header(&source, &[camera]).is_ok());
    }

    /// A `HIERARCH` alias is overwritten where present and never added.
    #[test]
    fn adds_no_hierarch_card() {
        let source = header(&[SIMPLE, NAXIS]);
        let patched = patched_header(&source, &[telescope("RedCat 51")]).unwrap();
        assert_eq!(cards(&patched), [SIMPLE, NAXIS, "TELESCOP= 'RedCat 51'"]);
    }

    /// The edit makes CHECKSUM wrong, so the copy drops it; DATASUM, over
    /// the unchanged data, stays.
    #[test]
    fn drops_checksum_and_keeps_datasum() {
        let source = header(&[SIMPLE, NAXIS, "CHECKSUM= 'abc'", "DATASUM = '123'"]);
        let patched = patched_header(&source, &[object("NGC 7000")]).unwrap();
        assert_eq!(cards(&patched), [SIMPLE, NAXIS, "DATASUM = '123'", "OBJECT  = 'NGC 7000'"]);
    }

    /// NINA's `OBJECT` comment leaves 35 characters for the value: a longer
    /// value that fits a card on its own keeps the comment cut to the room
    /// left, one with no room left loses it, and nothing is continued.
    #[test]
    fn a_card_comment_never_refuses_a_value_that_fits_a_card() {
        let nina = "OBJECT  = 'NGC 7000'           / Name of the object of interest";
        let source = header(&[SIMPLE, NAXIS, nina, "EXPTIME =                300.0"]);
        let heart = "Heart and Soul Nebulae (IC 1805 / IC 1848)";
        let patched = patched_header(&source, &[object(heart)]).unwrap();
        let card = format!("OBJECT  = '{heart}' / Name of the object of");
        assert_eq!(cards(&patched), [SIMPLE, NAXIS, &card, "EXPTIME =                300.0"]);
        let parsed = Header::parse(&patched).unwrap();
        assert_eq!(parsed.get_str("OBJECT").unwrap(), Some(heart));

        let longest = "x".repeat(68);
        let patched = patched_header(&source, &[object(&longest)]).unwrap();
        let card = format!("OBJECT  = '{longest}'");
        assert_eq!(cards(&patched), [SIMPLE, NAXIS, "EXPTIME =                300.0", &card]);
        assert_eq!(patched.len(), BLOCK_LEN, "one card each, never CONTINUE");
    }

    /// What no fixed-format card holds on its own is refused, never
    /// continued, and so is a primary header whose image lies in an
    /// extension, even where it already holds the keyword.
    #[test]
    fn refuses_what_one_card_cannot_hold() {
        let source = header(&[SIMPLE, NAXIS, "OBJECT  = 'M 31'"]);
        let refused = patched_header(&source, &[object(&"x".repeat(69))]).unwrap_err();
        assert_eq!(refusal(&refused), Some(Refusal::TooLong));
        let refused = patched_header(&source, &[object("Hα")]).unwrap_err();
        assert_eq!(refusal(&refused), Some(Refusal::NotPrintableAscii));
        let extension = header(&[SIMPLE, "NAXIS   =                    0", "OBJECT  = 'M 31'"]);
        let refused = patched_header(&extension, &[object("NGC 7000")]).unwrap_err();
        assert_eq!(refusal(&refused), Some(Refusal::ImageInExtension));
        let refused = patched_header(b"not a FITS header", &[]).unwrap_err();
        assert_eq!(refusal(&refused), Some(Refusal::NoHeader));
    }

    /// The copy holds the patched header, then every byte after the
    /// original primary header unchanged; a header that runs out of room
    /// grows by a block. The digests are of what was read and written, and
    /// the proof computes the same without writing.
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
        let original = dir.path().join("light.fits");
        std::fs::write(&original, &source).unwrap();

        let mut copy = Vec::new();
        let digests = write_copy(&original, &mut copy, &[object("NGC 7000")]).unwrap();
        assert_eq!(copy.len(), 2 * BLOCK_LEN + data.len());
        assert_eq!(&copy[2 * BLOCK_LEN..], data.as_slice(), "the data unit is copied unchanged");
        assert_eq!(Header::parse(&copy).unwrap().get_str("OBJECT").unwrap(), Some("NGC 7000"));
        assert_eq!(digests.source, <[u8; 32]>::from(Sha256::digest(&source)));
        assert_eq!(digests.copy, <[u8; 32]>::from(Sha256::digest(&copy)));
        assert_eq!(digests.copy_len, copy.len() as u64);
        assert_eq!(copy_digests(&original, &[object("NGC 7000")]).unwrap(), digests);
        assert_eq!(std::fs::read(&original).unwrap(), source, "the original is only read");
    }
}
