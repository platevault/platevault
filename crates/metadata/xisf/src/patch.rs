// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Isolated patched copies of XISF files (spec 069 PREP-FR-03, PREP-FR-20;
//! D-W123), built on `xisf-header`: a byte copy of the original has its
//! `<FITSKeyword>` elements, and a present native property alias, edited in
//! place by the crate's splice, which moves the attached data unchanged.
//! Originals are only read.
//!
//! The edit rules match the FITS patcher's: every keyword of an edit is
//! overwritten wherever present, an alias is never added, and the canonical
//! keyword is added only where none of `add_unless` is present. The longer
//! identity aliases a FITS file can only hold as HIERARCH cards are plain
//! keywords here, so they are overwritten like any alias. A value FITS
//! can't hold is refused too, since tools copy these keywords to FITS.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use metadata_core::patch::{validate, EditValue, FieldEdit, PatchError, Refusal};
use xisf_header::{Error as XisfError, Header};

/// Whether the XISF file at `source` can carry `edits`; reads only its
/// preamble and XML header.
///
/// # Errors
/// Why it can't.
pub fn check(source: &Path, edits: &[FieldEdit]) -> Result<(), PatchError> {
    validate(edits)?;
    let mut header = Header::read_from_file(source).map_err(header_error)?;
    let xml = read_xml(source)?;
    if xml.matches("location=\"attachment:").count() != 1 {
        return Err(PatchError::refused(0, Refusal::XisfLayout));
    }
    let adds = apply(&mut header, edits)?;
    if adds && image_is_self_closing(&xml) {
        return Err(PatchError::refused(0, Refusal::XisfLayout));
    }
    Ok(())
}

/// Edit `copy`, a byte copy of an XISF original that `PlateVault` wrote, in
/// place to carry `edits`. The crate writes a sibling temporary file and
/// renames it over `copy`, so the copy is a new file afterwards.
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

/// The XML header of the file at `path`, lossily decoded.
fn read_xml(path: &Path) -> Result<String, PatchError> {
    let mut file = File::open(path)?;
    let mut preamble = [0_u8; 16];
    file.read_exact(&mut preamble)?;
    let len = u32::from_le_bytes([preamble[8], preamble[9], preamble[10], preamble[11]]);
    let mut xml = vec![0_u8; usize::try_from(len).unwrap_or(usize::MAX)];
    file.read_exact(&mut xml)?;
    Ok(String::from_utf8_lossy(&xml).into_owned())
}

/// Whether the `<Image>` element is self-closing, so an added keyword has
/// no child content to go into.
fn image_is_self_closing(xml: &str) -> bool {
    xml.find("<Image")
        .and_then(|start| xml[start..].find('>').map(|end| &xml[start..start + end]))
        .is_some_and(|tag| tag.ends_with('/'))
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

    fn container(xml: &str, data: &[u8]) -> Vec<u8> {
        let mut out = b"XISF0100".to_vec();
        out.extend_from_slice(&u32::try_from(xml.len()).unwrap().to_le_bytes());
        out.extend_from_slice(&[0_u8; 4]);
        out.extend_from_slice(xml.as_bytes());
        out.extend_from_slice(data);
        out
    }

    /// An XISF light whose one attachment, `data`, follows its header; the
    /// header names the offset its own length puts the data at.
    fn light(body: &str, data: &[u8]) -> Vec<u8> {
        let xml = |offset: usize| {
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?><xisf version=\"1.0\" \
                 xmlns=\"http://www.pixinsight.com/xisf\"><Image geometry=\"2:2:1\" \
                 sampleFormat=\"UInt8\" colorSpace=\"Gray\" location=\"attachment:{offset:08}:{}\">\
                 {body}</Image></xisf>",
                data.len()
            )
        };
        let offset = 16 + xml(0).len();
        container(&xml(offset), data)
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

    /// The copy carries the edit, its attachment's bytes are moved
    /// unchanged, and an absent alias isn't added.
    #[test]
    fn patches_a_copy_and_keeps_its_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("light.xisf");
        let data = [1_u8, 2, 3, 4];
        let original = light("<FITSKeyword name=\"FILTER\" value=\"'Ha'\" comment=\"\"/>", &data);
        std::fs::write(&path, &original).unwrap();
        patch_in_place(&path, &[object_edit()]).unwrap();
        let header = Header::read_from_file(&path).unwrap();
        assert_eq!(header.get_str("OBJECT").unwrap(), Some("NGC 7000"));
        assert_eq!(header.count("OBJNAME"), 0, "an alias is never added");
        assert_eq!(header.get_str("FILTER").unwrap(), Some("Ha"));
        assert!(std::fs::read(&path).unwrap().ends_with(&data), "the data is unchanged");
    }

    /// A file with more than one attachment refuses before anything is
    /// written.
    #[test]
    fn refuses_more_than_one_attachment() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("light.xisf");
        let thumbnail = "<FITSKeyword name=\"FILTER\" value=\"'Ha'\" comment=\"\"/>\
                         <Thumbnail geometry=\"1:1:1\" sampleFormat=\"UInt8\" \
                         location=\"attachment:0:1\"/>";
        let original = light(thumbnail, &[1, 2, 3, 4]);
        std::fs::write(&path, &original).unwrap();
        let refused = patch_in_place(&path, &[object_edit()]).unwrap_err();
        assert!(
            matches!(refused, PatchError::Refused(r) if r.reason == Refusal::XisfLayout),
            "{refused}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), original, "nothing was written");
    }
}
