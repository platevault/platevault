// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The one seam through which Apply, Clean up and the Apply sheet deliver
//! and prove a recorded correction as an isolated patched copy (spec 069
//! PREP-FR-03, PREP-FR-09, PREP-FR-20; D-W122, D-W123). It keeps the
//! capture field to header keyword mapping; writing a header is the
//! metadata crates' (`metadata_fits::patch` on `fits-header`,
//! `metadata_xisf::patch` on `xisf-header`). Its callers see the reviewed
//! change, the refusal and the proof, never how a header is written.
//!
//! Originals are only read. A FITS copy is written new from its original:
//! the patched primary header, then every byte after the original one. An
//! XISF copy is a verified byte copy Apply wrote, edited in place. Either
//! keeps its original's modification time, as every copy does, and proves
//! it differs from its original only by the corrected header: its digest is
//! the one the same patch of the original yields.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use metadata_core::patch::{self, EditValue, FieldEdit, KeywordWrite, PatchError};
use sha2::{Digest, Sha256};

use crate::custody::{observe_entry, transfer};
use crate::{
    inventory, CaptureMetadata, CorrectedField, EntryEvidence, EntryPlacement, FileIdentity,
    ImageFormat, ItemReason, PatchRefusal, ReasonCode, FRAMING_LABEL_FIELD,
};

const HASH_BUFFER: usize = 1 << 20;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Kind {
    Text,
    Real,
    Integer,
}

/// Siril's `FLENGTH` holds metres where the catalog holds millimetres.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Unit {
    Same,
    MetresFromMillimetres,
}

/// The keywords one correctable capture field writes.
struct Mapping {
    field: &'static str,
    kind: Kind,
    /// The canonical keyword first, then every fixed-format alias.
    writes: &'static [(&'static str, Unit)],
    add_unless: &'static [&'static str],
    hierarch: &'static [&'static str],
    property: Option<(&'static str, Unit)>,
}

/// Provisional, pending owner confirmation (PREP-FR-20, D-W123, J23 G10):
/// each correctable capture field's canonical keyword and the aliases the
/// cited profile evidence names (PREP-FR-21), in the units it gives them.
/// A present alias is overwritten, never added (owner decision). The
/// catalog has no distinct Target or rig field, so a Target association
/// corrects `object`, and a rig `telescope`, `camera` and `focalLengthMm`.
/// `TELESCOPE` and `INSTRUMENT` exist in FITS only as HIERARCH cards. The
/// last six fields are the ones `PlateVault`'s readers take from their own
/// keywords, which PREP-FR-20 doesn't name.
const MAPPINGS: [Mapping; 12] = [
    Mapping {
        field: "object",
        kind: Kind::Text,
        writes: &[("OBJECT", Unit::Same), ("TARGET", Unit::Same), ("OBJNAME", Unit::Same)],
        add_unless: &["OBJECT"],
        hierarch: &[],
        property: None,
    },
    Mapping {
        field: "telescope",
        kind: Kind::Text,
        writes: &[("TELESCOP", Unit::Same)],
        add_unless: &["TELESCOP"],
        hierarch: &["TELESCOPE"],
        property: None,
    },
    Mapping {
        field: "camera",
        kind: Kind::Text,
        writes: &[("INSTRUME", Unit::Same), ("DETECTOR", Unit::Same)],
        add_unless: &["INSTRUME"],
        hierarch: &["INSTRUMENT"],
        property: None,
    },
    // Siril's `FOCAL` is in millimetres and its `FLENGTH` in metres, as is
    // the XISF focal-length property PlateVault's XISF reader falls back on.
    Mapping {
        field: "focalLengthMm",
        kind: Kind::Real,
        writes: &[
            ("FOCALLEN", Unit::Same),
            ("FOCAL", Unit::Same),
            ("FLENGTH", Unit::MetresFromMillimetres),
        ],
        add_unless: &["FOCALLEN"],
        hierarch: &[],
        property: Some(("Instrument:Telescope:FocalLength", Unit::MetresFromMillimetres)),
    },
    Mapping {
        field: "filter",
        kind: Kind::Text,
        writes: &[
            ("FILTER", Unit::Same),
            ("INSFLNAM", Unit::Same),
            ("FILT-1", Unit::Same),
            ("FILTNAM", Unit::Same),
            ("FILTNAME", Unit::Same),
        ],
        add_unless: &["FILTER"],
        hierarch: &[],
        property: None,
    },
    Mapping {
        field: "exposureSeconds",
        kind: Kind::Real,
        writes: &[("EXPTIME", Unit::Same), ("EXPOSURE", Unit::Same)],
        add_unless: &["EXPTIME", "EXPOSURE"],
        hierarch: &[],
        property: None,
    },
    Mapping {
        field: "imageType",
        kind: Kind::Text,
        writes: &[("IMAGETYP", Unit::Same)],
        add_unless: &["IMAGETYP"],
        hierarch: &[],
        property: None,
    },
    Mapping {
        field: "gain",
        kind: Kind::Real,
        writes: &[("GAIN", Unit::Same)],
        add_unless: &["GAIN"],
        hierarch: &[],
        property: None,
    },
    Mapping {
        field: "offset",
        kind: Kind::Integer,
        writes: &[("OFFSET", Unit::Same), ("BLKLEVEL", Unit::Same)],
        add_unless: &["OFFSET", "BLKLEVEL"],
        hierarch: &[],
        property: None,
    },
    Mapping {
        field: "binningX",
        kind: Kind::Integer,
        writes: &[("XBINNING", Unit::Same)],
        add_unless: &["XBINNING"],
        hierarch: &[],
        property: None,
    },
    Mapping {
        field: "binningY",
        kind: Kind::Integer,
        writes: &[("YBINNING", Unit::Same)],
        add_unless: &["YBINNING"],
        hierarch: &[],
        property: None,
    },
    Mapping {
        field: "setTemperatureC",
        kind: Kind::Real,
        writes: &[("SET-TEMP", Unit::Same)],
        add_unless: &["SET-TEMP"],
        hierarch: &[],
        property: None,
    },
];

fn mapping(field: &str) -> Option<&'static Mapping> {
    MAPPINGS.iter().find(|mapping| mapping.field == field)
}

/// Why a source can't carry its corrections, naming the corrected field;
/// a reason the whole file gives names the first.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Refusal {
    pub field: String,
    pub reason: PatchRefusal,
}

/// A patched copy written and proven.
#[derive(Clone, Debug)]
pub struct PatchOutcome {
    pub placement: EntryPlacement,
    /// The copy's identity once it carries the corrections.
    pub identity: FileIdentity,
}

/// The reviewed change of a frame: every field whose corrected value
/// differs from its header's, with the keywords a patched copy writes.
/// The framing label is a grouping decision no header holds, so it is
/// never one.
#[must_use]
pub fn corrections(observed: &CaptureMetadata, effective: &CaptureMetadata) -> Vec<CorrectedField> {
    let (Ok(serde_json::Value::Object(observed)), Ok(serde_json::Value::Object(effective))) =
        (serde_json::to_value(observed), serde_json::to_value(effective))
    else {
        return Vec::new();
    };
    effective
        .iter()
        .filter(|(field, value)| {
            !matches!(field.as_str(), "raw" | FRAMING_LABEL_FIELD)
                && observed.get(*field) != Some(*value)
        })
        .map(|(field, value)| CorrectedField {
            field: field.clone(),
            keywords: mapping(field)
                .map(|mapping| {
                    let names = mapping.writes.iter().map(|(name, _)| *name);
                    names.chain(mapping.hierarch.iter().copied()).map(str::to_owned).collect()
                })
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

/// Why recording `value` as the corrected `field` would leave a value FITS
/// can't hold: not printable ASCII, or too long for one card (D-W123,
/// owner decision). The backend that records a correction refuses it, and
/// Apply refuses it again.
#[must_use]
pub fn entry_refusal(field: &str, value: &serde_json::Value) -> Option<PatchRefusal> {
    let text = value.as_str()?;
    if mapping(field)?.kind != Kind::Text {
        return None;
    }
    patch::fits_text(text).err().map(refusal_of)
}

const fn refusal_of(reason: patch::Refusal) -> PatchRefusal {
    match reason {
        patch::Refusal::NoHeader => PatchRefusal::NoHeader,
        patch::Refusal::NotPrintableAscii => PatchRefusal::NotPrintableAscii,
        patch::Refusal::TooLong => PatchRefusal::TooLong,
        patch::Refusal::ImageInExtension => PatchRefusal::ImageInExtension,
        patch::Refusal::HierarchAlias => PatchRefusal::HierarchAlias,
        patch::Refusal::XisfLayout => PatchRefusal::XisfLayout,
    }
}

fn converted(value: f64, unit: Unit) -> f64 {
    match unit {
        Unit::Same => value,
        Unit::MetresFromMillimetres => value / 1000.0,
    }
}

/// What `change` writes, or why no header keyword can carry it.
fn edit_of(change: &CorrectedField) -> Result<FieldEdit, PatchRefusal> {
    let mapping = mapping(&change.field).ok_or(PatchRefusal::NoKeyword)?;
    let catalog = change.catalog.as_deref().ok_or(PatchRefusal::NoValue)?;
    let number = || catalog.parse::<f64>().ok().filter(|number| number.is_finite());
    let value = |unit: Unit| -> Result<EditValue, PatchRefusal> {
        Ok(match mapping.kind {
            Kind::Text => EditValue::Text(catalog.to_owned()),
            Kind::Real => {
                EditValue::Real(converted(number().ok_or(PatchRefusal::NotANumber)?, unit))
            }
            Kind::Integer => {
                EditValue::Integer(catalog.parse().map_err(|_| PatchRefusal::NotANumber)?)
            }
        })
    };
    let writes = mapping
        .writes
        .iter()
        .map(|&(keyword, unit)| Ok(KeywordWrite { keyword, value: value(unit)? }))
        .collect::<Result<_, PatchRefusal>>()?;
    let property = match mapping.property {
        Some((id, unit)) => match value(unit)? {
            EditValue::Real(number) => Some((id, number.to_string())),
            EditValue::Integer(number) => Some((id, number.to_string())),
            EditValue::Text(text) => Some((id, text)),
        },
        None => None,
    };
    Ok(FieldEdit { writes, add_unless: mapping.add_unless, hierarch: mapping.hierarch, property })
}

fn edits_of(changes: &[CorrectedField]) -> Result<Vec<FieldEdit>, Refusal> {
    changes
        .iter()
        .map(|change| {
            edit_of(change).map_err(|reason| Refusal { field: change.field.clone(), reason })
        })
        .collect()
}

/// The refusal a patcher's error carries, naming the field.
fn refused(changes: &[CorrectedField], error: &PatchError) -> Option<Refusal> {
    match error {
        PatchError::Refused(refused) => Some(Refusal {
            field: changes.get(refused.edit).or_else(|| changes.first())?.field.clone(),
            reason: refusal_of(refused.reason),
        }),
        PatchError::Header(_) => {
            Some(Refusal { field: changes.first()?.field.clone(), reason: PatchRefusal::NoHeader })
        }
        PatchError::Io(_) => None,
    }
}

/// Whether `source`, catalogued as `format`, can carry `changes`: Apply's
/// refusal before it builds (PREP-FR-03). Reads only its header. A source
/// that can't be read now isn't refused here; the build reads it again.
///
/// # Errors
/// The first field no patched copy of `source` can carry, and why.
pub fn check(
    source: &Path,
    format: ImageFormat,
    changes: &[CorrectedField],
) -> Result<(), Refusal> {
    let Some(first) = changes.first() else { return Ok(()) };
    let edits = edits_of(changes)?;
    let checked = match format {
        ImageFormat::Fits => metadata_fits::patch::check(source, &edits),
        ImageFormat::Xisf => metadata_xisf::patch::check(source, &edits),
        ImageFormat::Unsupported => {
            return Err(Refusal {
                field: first.field.clone(),
                reason: PatchRefusal::UnsupportedFormat,
            });
        }
    };
    checked.map_err(|error| refused(changes, &error)).or_else(|refusal| refusal.map_or(Ok(()), Err))
}

/// The format a file's own first bytes give.
fn format_of(path: &Path) -> io::Result<Option<ImageFormat>> {
    let mut start = [0_u8; 9];
    let read = File::open(path)?.read(&mut start)?;
    Ok(if start[..read].starts_with(b"SIMPLE  =") {
        Some(ImageFormat::Fits)
    } else if start[..read].starts_with(b"XISF0100") {
        Some(ImageFormat::Xisf)
    } else {
        None
    })
}

fn reason(code: ReasonCode, detail: impl Into<String>) -> ItemReason {
    ItemReason::new(code, detail)
}

/// The refusal or failure of a patch at build time, as Apply reports it.
fn build_failure(path: &Path, changes: &[CorrectedField], error: &PatchError) -> ItemReason {
    match (refused(changes, error), error) {
        (Some(refusal), _) => reason(
            ReasonCode::WriteFailed,
            format!(
                "{} can't carry its corrected {}: {}",
                path.display(),
                refusal.field,
                refusal.reason.describe()
            ),
        ),
        (None, PatchError::Io(error)) if error.kind() == io::ErrorKind::AlreadyExists => reason(
            ReasonCode::DestinationOccupied,
            format!("{} already holds an entry; nothing is replaced", path.display()),
        ),
        (None, error) => reason(ReasonCode::WriteFailed, format!("{}: {error}", path.display())),
    }
}

/// Give the copy at `dest` the modification time `modified`, the
/// original's, sync it and its folder.
fn settle(dest: &Path, modified: std::time::SystemTime) -> io::Result<()> {
    let file = fs::OpenOptions::new().write(true).open(dest)?;
    file.set_modified(modified)?;
    file.sync_all()?;
    transfer::sync_folder(dest.parent().unwrap_or(dest))
}

/// Make `dest` the isolated patched copy of the original `snapshot`
/// records, carrying `changes`, and prove it (PREP-FR-03, PREP-FR-09). A
/// FITS copy is written new from the original; an XISF copy is the verified
/// byte copy `copy` makes, edited in place. A copy that fails is removed,
/// so Retry makes it again.
///
/// # Errors
/// Why `dest` couldn't be written, patched or proven.
pub fn patch_copy(
    snapshot: &EntryEvidence,
    dest: &Path,
    changes: &[CorrectedField],
    copy: impl FnOnce() -> Result<(EntryPlacement, FileIdentity), ItemReason>,
) -> Result<PatchOutcome, ItemReason> {
    let original = snapshot
        .path
        .to_path_buf()
        .map_err(|error| reason(ReasonCode::SourceUnavailable, error.to_string()))?;
    let unavailable = |error: io::Error| {
        reason(ReasonCode::SourceUnavailable, format!("{}: {error}", original.display()))
    };
    let modified =
        fs::metadata(&original).and_then(|metadata| metadata.modified()).map_err(unavailable)?;
    let edits = edits_of(changes).map_err(|refusal| {
        reason(
            ReasonCode::WriteFailed,
            format!(
                "{} can't carry its corrected {}: {}",
                original.display(),
                refusal.field,
                refusal.reason.describe()
            ),
        )
    })?;
    match format_of(&original).map_err(unavailable)? {
        Some(ImageFormat::Fits) => {
            let bytes = fs::read(&original).map_err(unavailable)?;
            if Some(hex::encode(Sha256::digest(&bytes))) != snapshot.sha256 {
                return Err(reason(
                    ReasonCode::SourceDrift,
                    format!("{} changed since its snapshot", original.display()),
                ));
            }
            let header = metadata_fits::patch::write_copy(&bytes, dest, &edits)
                .map_err(|error| build_failure(dest, changes, &error))?;
            let tail = metadata_fits::patch::header_len(&bytes).unwrap_or(bytes.len());
            let mut expected = Sha256::new();
            expected.update(&header);
            expected.update(&bytes[tail..]);
            let expected = hex::encode(expected.finalize());
            let written = inventory::probe_fingerprint(dest)
                .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
            let proven = settle(dest, modified)
                .map_err(|error| {
                    reason(ReasonCode::WriteFailed, format!("{}: {error}", dest.display()))
                })
                .and_then(|()| prove(dest, &expected));
            match proven {
                Ok(identity) => Ok(PatchOutcome { placement: EntryPlacement::Copy, identity }),
                Err(failure) => {
                    transfer::discard(dest, &written.identity);
                    Err(failure)
                }
            }
        }
        Some(ImageFormat::Xisf) => {
            let (placement, identity) = copy()?;
            let patched = metadata_xisf::patch::patch_in_place(dest, &edits)
                .map_err(|error| build_failure(dest, changes, &error))
                .and_then(|()| {
                    settle(dest, modified).map_err(|error| {
                        reason(ReasonCode::WriteFailed, format!("{}: {error}", dest.display()))
                    })
                })
                .and_then(|()| {
                    let expected = expected_digest(&original, snapshot.sha256.as_deref(), changes)
                        .ok_or_else(|| {
                            reason(
                                ReasonCode::SourceDrift,
                                format!("{} changed since its snapshot", original.display()),
                            )
                        })?;
                    prove(dest, &expected)
                });
            match patched {
                Ok(identity) => Ok(PatchOutcome { placement, identity }),
                Err(failure) => {
                    let now =
                        inventory::probe_fingerprint(dest).map_or(identity, |now| now.identity);
                    transfer::discard(dest, &now);
                    Err(failure)
                }
            }
        }
        _ => Err(reason(
            ReasonCode::WriteFailed,
            format!("{}: {}", original.display(), PatchRefusal::UnsupportedFormat.describe()),
        )),
    }
}

/// The copy at `dest` holds `expected`'s bytes; its identity.
fn prove(dest: &Path, expected: &str) -> Result<FileIdentity, ItemReason> {
    let written = observe_entry(dest)
        .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
    if written.sha256.as_deref() != Some(expected) {
        return Err(reason(
            ReasonCode::DestinationMismatch,
            format!("{} differs from its original beyond its corrected header", dest.display()),
        ));
    }
    Ok(written.fingerprint.identity)
}

/// Whether `copy`, a patched copy `PlateVault` placed, still holds exactly
/// the patch of `original`, which must hold `source_sha256`, with
/// `changes`: the proof before Clean up, retiring the old View or clearing
/// a failed build treats it as `PlateVault`'s own.
#[must_use]
pub fn holds_patch(
    copy: &EntryEvidence,
    original: &Path,
    source_sha256: &str,
    changes: &[CorrectedField],
) -> bool {
    expected_digest(original, Some(source_sha256), changes)
        .is_some_and(|expected| copy.sha256.as_deref() == Some(expected.as_str()))
}

/// The SHA-256 the patched copy of `original` with `changes` holds, once
/// `original` is proven to hold `source_sha256`. A FITS original is read
/// once; an XISF one is patched in a scratch copy.
fn expected_digest(
    original: &Path,
    source_sha256: Option<&str>,
    changes: &[CorrectedField],
) -> Option<String> {
    let edits = edits_of(changes).ok()?;
    match format_of(original).ok()?? {
        ImageFormat::Fits => {
            let header = metadata_fits::patch::read_header_region(original).ok()?;
            let patched = metadata_fits::patch::patched_header(&header, &edits).ok()?;
            let mut file = File::open(original).ok()?;
            let (mut whole, mut expected) = (Sha256::new(), Sha256::new());
            expected.update(&patched);
            let mut offset = 0_usize;
            let mut buffer = vec![0_u8; HASH_BUFFER];
            loop {
                let read = file.read(&mut buffer).ok()?;
                if read == 0 {
                    break;
                }
                let chunk = &buffer[..read];
                whole.update(chunk);
                let skip = header.len().saturating_sub(offset).min(read);
                expected.update(&chunk[skip..]);
                offset += read;
            }
            (Some(hex::encode(whole.finalize()).as_str()) == source_sha256)
                .then(|| hex::encode(expected.finalize()))
        }
        ImageFormat::Xisf => {
            let scratch = tempfile::tempdir().ok()?;
            let copy: PathBuf = scratch.path().join("patched.xisf");
            fs::copy(original, &copy).ok()?;
            let copied = hex::encode(Sha256::digest(fs::read(&copy).ok()?));
            if Some(copied.as_str()) != source_sha256 {
                return None;
            }
            metadata_xisf::patch::patch_in_place(&copy, &edits).ok()?;
            Some(hex::encode(Sha256::digest(fs::read(&copy).ok()?)))
        }
        ImageFormat::Unsupported => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(field: &str, catalog: &str) -> CorrectedField {
        CorrectedField {
            field: field.to_owned(),
            keywords: Vec::new(),
            header: None,
            catalog: Some(catalog.to_owned()),
        }
    }

    /// PREP-FR-20, D-W123: a rig's focal length writes `FOCALLEN` and
    /// Siril's `FOCAL` in millimetres and `FLENGTH` and the XISF property in
    /// metres; the telescope's HIERARCH alias is named for the patchers.
    #[test]
    fn maps_fields_to_keywords_in_their_units() {
        let focal = edit_of(&change("focalLengthMm", "250.0")).unwrap();
        let values: Vec<(&str, &EditValue)> =
            focal.writes.iter().map(|write| (write.keyword, &write.value)).collect();
        assert_eq!(
            values,
            [
                ("FOCALLEN", &EditValue::Real(250.0)),
                ("FOCAL", &EditValue::Real(250.0)),
                ("FLENGTH", &EditValue::Real(0.25)),
            ]
        );
        assert_eq!(focal.property, Some(("Instrument:Telescope:FocalLength", "0.25".to_owned())));
        assert_eq!(edit_of(&change("telescope", "RedCat 51")).unwrap().hierarch, ["TELESCOPE"]);
        assert_eq!(edit_of(&change("readoutMode", "fast")), Err(PatchRefusal::NoKeyword));
        assert_eq!(edit_of(&change("gain", "high")), Err(PatchRefusal::NotANumber));
        let cleared = CorrectedField { catalog: None, ..change("object", "") };
        assert_eq!(edit_of(&cleared), Err(PatchRefusal::NoValue));
    }

    #[test]
    fn corrections_name_catalog_and_header_values() {
        let observed = CaptureMetadata {
            filter: Some("Ha".into()),
            gain: Some(100.0),
            ..CaptureMetadata::default()
        };
        let effective = CaptureMetadata { filter: Some("OIII".into()), ..observed.clone() };
        let filter = CorrectedField {
            field: "filter".into(),
            keywords: ["FILTER", "INSFLNAM", "FILT-1", "FILTNAM", "FILTNAME"]
                .map(str::to_owned)
                .into(),
            header: Some("Ha".into()),
            catalog: Some("OIII".into()),
        };
        assert_eq!(corrections(&observed, &effective), [filter]);
        assert_eq!(corrections(&observed, &observed), Vec::<CorrectedField>::new());
    }

    /// A value FITS can't hold is refused when it is recorded.
    #[test]
    fn refuses_a_text_value_fits_cannot_hold_at_entry() {
        let text = |value: &str| serde_json::Value::String(value.to_owned());
        assert_eq!(entry_refusal("object", &text("Hα")), Some(PatchRefusal::NotPrintableAscii));
        assert_eq!(entry_refusal("object", &text(&"x".repeat(69))), Some(PatchRefusal::TooLong));
        assert_eq!(entry_refusal("object", &text("NGC 7000")), None);
        assert_eq!(entry_refusal("dateObs", &text("Hα")), None, "no keyword, no FITS card");
        assert_eq!(entry_refusal("gain", &serde_json::json!(120)), None);
    }
}
