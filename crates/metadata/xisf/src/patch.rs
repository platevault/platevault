// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Isolated patched copies of XISF files (spec 069 PREP-FR-03, PREP-FR-20;
//! D-W123), built on `xisf-header`: a byte copy of the original has its
//! `<FITSKeyword>` elements, and a present native property alias, edited in
//! place by the crate's splice, which keeps every byte after the XML header,
//! each attachment block among them, unchanged. Originals are only read.
//!
//! The edit rules match the FITS patcher's: every keyword of an edit is
//! overwritten wherever present, an alias is never added, and the canonical
//! keyword is added only where none of `add_unless` is present. The longer
//! identity aliases a FITS file can only hold as HIERARCH cards are plain
//! keywords here, so they are overwritten like any alias. A value FITS
//! can't hold is refused too, since tools copy these keywords to FITS.

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use metadata_core::patch::{validate, EditValue, FieldEdit, PatchError, Refusal};
use sha2::{Digest, Sha256};
use xisf_header::{Error as XisfError, GeometryError, Header};

/// The signature, the XML header length and four reserved bytes.
const PREAMBLE: usize = 16;
/// How much of a file is read at a time.
const STREAM_BUFFER: usize = 1 << 20;

/// Whether the XISF file at `source` can carry `edits`; reads only its
/// preamble and XML header. The layouts `xisf-header` splices are one
/// `<Image>` with an attachment location, and an `<Image>` with children
/// where a keyword is added; the attachment blocks it would refuse to move
/// refuse when the copy is made.
///
/// # Errors
/// Why it can't; I/O errors.
pub fn check(source: &Path, edits: &[FieldEdit]) -> Result<(), PatchError> {
    validate(edits)?;
    let (_, head) = read_head(source)?;
    let mut header = Header::parse(&head).map_err(header_error)?;
    let xml = String::from_utf8_lossy(&head[PREAMBLE..]);
    let one_image =
        !matches!(header.image_geometry(), None | Some(Err(GeometryError::MultipleImages)));
    let tag = image_tag(&xml);
    if !one_image || !tag.is_some_and(|tag| tag.contains("location=\"attachment:")) {
        return Err(PatchError::refused(0, Refusal::XisfLayout));
    }
    if apply(&mut header, edits)? && tag.is_some_and(|tag| tag.ends_with('/')) {
        return Err(PatchError::refused(0, Refusal::XisfLayout));
    }
    Ok(())
}

/// Edit `copy`, a byte copy of an XISF original that `PlateVault` wrote, in
/// place to carry `edits`. The crate writes a sibling temporary file,
/// `.<name>.tmp-<pid>`, and renames it over `copy`, so the copy is a new
/// file afterwards.
///
/// # Errors
/// Why the copy can't carry `edits`; I/O errors. On error `copy` is left as
/// it was.
pub fn patch_in_place(copy: &Path, edits: &[FieldEdit]) -> Result<(), PatchError> {
    check(copy, edits)?;
    Header::update_file(copy, |header| {
        apply(header, edits).map(drop).map_err(|error| XisfError::Unsupported(error.to_string()))
    })
    .map_err(header_error)
}

/// The SHA-256 of `copy` when it is the patched copy of `original` with
/// `edits`, else `None`: its header is the original's with the edits, its
/// preamble differs only in the header length, and every byte after its
/// header is the original's, in order. Writes nothing.
///
/// # Errors
/// Why either header can't be read; I/O errors.
pub fn patched_digest(
    copy: &Path,
    original: &Path,
    edits: &[FieldEdit],
) -> Result<Option<[u8; 32]>, PatchError> {
    let (mut copy_file, copy_head) = read_head(copy)?;
    let (mut original_file, original_head) = read_head(original)?;
    if copy_head[..8] != original_head[..8]
        || copy_head[12..PREAMBLE] != original_head[12..PREAMBLE]
    {
        return Ok(None);
    }
    let mut expected = Header::parse(&original_head).map_err(header_error)?;
    apply(&mut expected, edits)?;
    if Header::parse(&copy_head).map_err(header_error)? != expected {
        return Ok(None);
    }
    let mut digest = Sha256::new();
    digest.update(&copy_head);
    let (mut ours, mut theirs) = (vec![0_u8; STREAM_BUFFER], vec![0_u8; STREAM_BUFFER]);
    loop {
        let read = read_some(&mut copy_file, &mut ours)?;
        if read == 0 {
            return Ok((read_some(&mut original_file, &mut theirs[..1])? == 0)
                .then(|| digest.finalize().into()));
        }
        match original_file.read_exact(&mut theirs[..read]) {
            Ok(()) if ours[..read] == theirs[..read] => digest.update(&ours[..read]),
            Ok(()) => return Ok(None),
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(error) => return Err(error.into()),
        }
    }
}

fn read_some(file: &mut File, buffer: &mut [u8]) -> io::Result<usize> {
    loop {
        match file.read(buffer) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            read => return read,
        }
    }
}

fn header_error(error: XisfError) -> PatchError {
    match error {
        XisfError::Io(error) => PatchError::Io(error),
        XisfError::Unsupported(_) => PatchError::refused(0, Refusal::XisfLayout),
        XisfError::TooSmall { .. }
        | XisfError::InvalidSignature
        | XisfError::HeaderTooLarge { .. } => PatchError::refused(0, Refusal::NoHeader),
        other => PatchError::Header(other.to_string()),
    }
}

/// The preamble and XML header of the file at `path`, and the file left at
/// the first byte after them.
fn read_head(path: &Path) -> Result<(File, Vec<u8>), PatchError> {
    let no_header = || PatchError::refused(0, Refusal::NoHeader);
    let mut file = File::open(path)?;
    let mut head = vec![0_u8; PREAMBLE];
    file.read_exact(&mut head).map_err(|_| no_header())?;
    if &head[..8] != b"XISF0100" {
        return Err(no_header());
    }
    let len = u32::from_le_bytes([head[8], head[9], head[10], head[11]]);
    let len = usize::try_from(len).map_err(|_| no_header())?;
    head.resize(PREAMBLE + len, 0);
    file.read_exact(&mut head[PREAMBLE..]).map_err(|_| no_header())?;
    Ok((file, head))
}

/// The start tag of the header's first `<Image>` element, without its
/// closing `>`.
fn image_tag(xml: &str) -> Option<&str> {
    let mut rest = xml;
    while let Some(start) = rest.find("<Image") {
        let tag = &rest[start..];
        if tag[6..].starts_with(|c: char| c.is_whitespace() || c == '>' || c == '/') {
            return tag.find('>').map(|end| &tag[..end]);
        }
        rest = &tag[6..];
    }
    None
}

fn set<'a>(
    header: &mut Header,
    key: impl Into<xisf_header::Key<'a>>,
    value: &EditValue,
) -> Result<(), PatchError> {
    match value {
        EditValue::Text(text) => header.set(key, text.as_str()),
        EditValue::Real(number) => header.set(key, *number),
        EditValue::Integer(number) => header.set(key, *number),
    }
    .map_err(header_error)
}

/// Apply `edits` in memory; whether any adds a keyword.
fn apply(header: &mut Header, edits: &[FieldEdit]) -> Result<bool, PatchError> {
    let mut adds = false;
    for edit in edits {
        let present = edit.add_unless.iter().any(|keyword| header.count(keyword) > 0);
        let Some(canonical) = edit.canonical() else { continue };
        let aliases = edit.writes.iter().map(|write| (write.keyword, &write.value));
        let longer = edit.hierarch.iter().map(|alias| (*alias, &canonical.value));
        for (keyword, value) in aliases.chain(longer) {
            for occurrence in 0..header.count(keyword) {
                set(header, (keyword, occurrence), value)?;
            }
        }
        if let Some((id, value)) = &edit.property {
            if header.property(id).is_some() {
                header.set_property(*id, value.as_str()).map_err(header_error)?;
            }
        }
        if !present {
            set(header, canonical.keyword, &canonical.value)?;
            adds = true;
        }
    }
    Ok(adds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use metadata_core::patch::KeywordWrite;

    const FILTER: &str = "<FITSKeyword name=\"FILTER\" value=\"'Ha'\" comment=\"\"/>";

    /// An XISF light whose image attachment `data`, then a thumbnail's
    /// `thumbnail` when given, follow its header, which names the offsets its
    /// own length puts them at. Without a `body` the `<Image>` is
    /// self-closing.
    fn light(body: Option<&str>, data: &[u8], thumbnail: Option<&[u8]>) -> Vec<u8> {
        let xml = |offset: usize| {
            let thumb = thumbnail.map_or(String::new(), |thumb| {
                format!(
                    "<Thumbnail geometry=\"1:1:1\" sampleFormat=\"UInt8\" colorSpace=\"Gray\" \
                     location=\"attachment:{:08}:{}\"/>",
                    offset + data.len(),
                    thumb.len()
                )
            });
            let image = format!(
                "<Image geometry=\"2:2:1\" sampleFormat=\"UInt8\" colorSpace=\"Gray\" \
                 location=\"attachment:{offset:08}:{}\"",
                data.len()
            );
            let image = match body {
                Some(body) => format!("{image}>{body}{thumb}</Image>"),
                None => format!("{image}/>"),
            };
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?><xisf version=\"1.0\" \
                 xmlns=\"http://www.pixinsight.com/xisf\">{image}</xisf>"
            )
        };
        let offset = PREAMBLE + xml(0).len();
        let xml = xml(offset);
        let mut out = b"XISF0100".to_vec();
        out.extend_from_slice(&u32::try_from(xml.len()).unwrap().to_le_bytes());
        out.extend_from_slice(&[0_u8; 4]);
        out.extend_from_slice(xml.as_bytes());
        out.extend_from_slice(data);
        out.extend_from_slice(thumbnail.unwrap_or_default());
        out
    }

    fn object_edit() -> FieldEdit {
        FieldEdit {
            writes: vec![
                KeywordWrite { keyword: "OBJECT", value: EditValue::Text("NGC 7000".into()) },
                KeywordWrite { keyword: "OBJNAME", value: EditValue::Text("NGC 7000".into()) },
            ],
            add_unless: &["OBJECT"],
            hierarch: &[],
            property: None,
        }
    }

    /// The copy carries the edit, its image and thumbnail blocks are kept
    /// unchanged, an absent alias isn't added, and the proof recognises the
    /// copy by its own digest.
    #[test]
    fn patches_an_image_with_a_thumbnail_and_keeps_both_blocks() {
        let dir = tempfile::tempdir().unwrap();
        let (original, copy) = (dir.path().join("original.xisf"), dir.path().join("copy.xisf"));
        let (data, thumbnail) = ([1_u8, 2, 3, 4], [9_u8]);
        let bytes = light(Some(FILTER), &data, Some(&thumbnail));
        std::fs::write(&original, &bytes).unwrap();
        std::fs::write(&copy, &bytes).unwrap();
        patch_in_place(&copy, &[object_edit()]).unwrap();
        let header = Header::read_from_file(&copy).unwrap();
        assert_eq!(header.get_str("OBJECT").unwrap(), Some("NGC 7000"));
        assert_eq!(header.count("OBJNAME"), 0, "an alias is never added");
        assert_eq!(header.get_str("FILTER").unwrap(), Some("Ha"));
        let patched = std::fs::read(&copy).unwrap();
        assert!(patched.ends_with(&[1, 2, 3, 4, 9]), "both blocks are unchanged");
        assert_eq!(std::fs::read(&original).unwrap(), bytes, "the original is only read");
        let digest = patched_digest(&copy, &original, &[object_edit()]).unwrap();
        assert_eq!(digest, Some(Sha256::digest(&patched).into()));
    }

    /// The proof refuses a copy that is the original unpatched, or whose
    /// data changed.
    #[test]
    fn the_proof_refuses_anything_but_the_patched_copy() {
        let dir = tempfile::tempdir().unwrap();
        let (original, copy) = (dir.path().join("original.xisf"), dir.path().join("copy.xisf"));
        let bytes = light(Some(FILTER), &[1, 2, 3, 4], None);
        std::fs::write(&original, &bytes).unwrap();
        std::fs::write(&copy, &bytes).unwrap();
        assert_eq!(patched_digest(&copy, &original, &[object_edit()]).unwrap(), None);
        patch_in_place(&copy, &[object_edit()]).unwrap();
        let mut patched = std::fs::read(&copy).unwrap();
        *patched.last_mut().unwrap() = 7;
        std::fs::write(&copy, &patched).unwrap();
        assert_eq!(patched_digest(&copy, &original, &[object_edit()]).unwrap(), None);
    }

    /// A self-closing `<Image>` has nowhere to add a keyword, and a header
    /// whose `<Image>` has no attachment isn't one the splice edits; both
    /// refuse before anything is written.
    #[test]
    fn refuses_layouts_the_splice_does_not_edit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("light.xisf");
        // The same length, so the header keeps its declared size.
        let unattached = String::from_utf8(light(Some(FILTER), &[1, 2, 3, 4], None))
            .unwrap()
            .replace(" location=\"attachment:", " position=\"attachment:");
        for bytes in [light(None, &[1, 2, 3, 4], None), unattached.into_bytes()] {
            std::fs::write(&path, &bytes).unwrap();
            let refused = patch_in_place(&path, &[object_edit()]).unwrap_err();
            assert!(
                matches!(refused, PatchError::Refused(r) if r.reason == Refusal::XisfLayout),
                "{refused}"
            );
            assert_eq!(std::fs::read(&path).unwrap(), bytes, "nothing was written");
        }
    }
}
