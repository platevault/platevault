// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The one seam through which Apply, Clean up and the Apply sheet deliver
//! a recorded correction as an isolated patched copy (spec 069 PREP-FR-03,
//! PREP-FR-04, PREP-FR-09, PREP-FR-20; D-W122, D-W123). It keeps the
//! capture field to header keyword mapping and makes each copy the way a
//! verified transfer does; how a header is written, and what a patched
//! copy holds, is the metadata crates' (`metadata_fits::patch` on
//! `fits-header`, `metadata_xisf::patch` on `xisf-header`), chosen by the
//! original's catalogued format. Its callers see the reviewed change, the
//! refusal and the proven digest, never how a header is written.
//!
//! Originals are only read. A patched copy is made under a partial name
//! beside its entry (`.pv-…partial`), proven, then installed without
//! replacing anything; one that fails is removed, and the partial an
//! interruption leaves is one clearing `View (building)/` knows by name. A
//! FITS copy is written new from its original: the patched primary header,
//! then every byte after the original one. An XISF copy is a verified byte
//! copy, edited in place. Either keeps its original's modification time, as
//! every copy does. Its entry records the digest it was proven to hold,
//! which every later proof compares against.

use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use metadata_core::patch::{self, EditValue, FieldEdit, KeywordWrite, PatchError};
use metadata_fits::patch::CopyDigests;
use uuid::Uuid;

use crate::custody::transfer;
use crate::{
    inventory, CaptureMetadata, CorrectedField, EntryEvidence, FileIdentity, ImageFormat,
    ItemReason, PatchRefusal, ReasonCode, TransferDestination, WrittenCopy, FRAMING_LABEL_FIELD,
};

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
/// `TELESCOPE` and `INSTRUMENT` exist in FITS only as HIERARCH cards; a
/// present one takes the corrected value, and none is added (owner
/// decision). The last six fields are the ones `PlateVault`'s readers take
/// from their own keywords, which PREP-FR-20 doesn't name.
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

/// The reviewed change a frame's patched copy carries, and its original's
/// catalogued format, which picks the patcher.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HeaderPatch {
    pub format: ImageFormat,
    pub changes: Vec<CorrectedField>,
}

/// Where a patched copy goes and what it carries.
pub struct PatchTarget<'a> {
    /// The original's snapshot (D19), which the copy is made from.
    pub snapshot: &'a EntryEvidence,
    pub destination: TransferDestination,
    /// The Apply and the entry, which name the partial copy.
    pub operation: Uuid,
    pub seq: u32,
    pub patch: &'a HeaderPatch,
}

/// A patched copy installed and proven.
#[derive(Clone, Debug)]
pub struct Patched {
    pub identity: FileIdentity,
    /// The SHA-256 it was proven to hold, which its entry records.
    pub sha256: String,
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

/// Why recording `value` as the corrected `field` would leave a correction
/// no patched copy can deliver (D-W123, owner decisions): a field no header
/// keyword carries, or a text value FITS can't hold, not printable ASCII or
/// too long for one card on its own. The framing label is a grouping
/// decision, not a header correction, so it is never refused. The backend
/// that records a correction refuses it, and Apply refuses it again.
#[must_use]
pub fn entry_refusal(field: &str, value: &serde_json::Value) -> Option<PatchRefusal> {
    if field == FRAMING_LABEL_FIELD {
        return None;
    }
    let Some(mapping) = mapping(field) else { return Some(PatchRefusal::NoKeyword) };
    let text = value.as_str()?;
    if mapping.kind != Kind::Text {
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

fn partial_path(written: &WrittenCopy) -> Result<PathBuf, ItemReason> {
    written
        .partial
        .to_path_buf()
        .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))
}

/// Make the isolated patched copy of the original `target.snapshot`
/// records at `target.destination`, carrying its patch, and prove it
/// (PREP-FR-03, PREP-FR-09): written under a partial name, installed
/// without replacing anything, and re-read. A copy that fails is removed,
/// so Retry makes it again.
///
/// # Errors
/// Why the copy couldn't be written, patched, installed or proven.
pub fn patch_copy(target: &PatchTarget<'_>) -> Result<Patched, ItemReason> {
    let original = target
        .snapshot
        .path
        .to_path_buf()
        .map_err(|error| reason(ReasonCode::SourceUnavailable, error.to_string()))?;
    let changes = &target.patch.changes;
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
    match target.patch.format {
        ImageFormat::Fits => patch_fits(target, &original, |out| {
            metadata_fits::patch::write_copy(&original, out, &edits)
        }),
        ImageFormat::Xisf => patch_xisf(target, &original, &edits),
        ImageFormat::Unsupported => Err(reason(
            ReasonCode::WriteFailed,
            format!("{}: {}", original.display(), PatchRefusal::UnsupportedFormat.describe()),
        )),
    }
}

/// A FITS patched copy: `write` fills the partial copy from the original,
/// which must still hold its snapshot's bytes.
fn patch_fits(
    target: &PatchTarget<'_>,
    original: &Path,
    write: impl FnOnce(&mut File) -> Result<CopyDigests, PatchError>,
) -> Result<Patched, ItemReason> {
    let written = transfer::begin(target.operation, target.seq, &target.destination)?;
    let snapshot = target.snapshot;
    let digests = transfer::fill_partial(&written, snapshot.fingerprint.modified_ns, |out| {
        let digests =
            write(out).map_err(|error| build_failure(original, &target.patch.changes, &error))?;
        if snapshot.sha256.as_deref() != Some(hex::encode(digests.source).as_str()) {
            return Err(reason(
                ReasonCode::SourceDrift,
                format!("{} changed since its snapshot", original.display()),
            ));
        }
        Ok(digests)
    })?;
    install(target, &written, digests.copy_len, hex::encode(digests.copy))
}

/// An XISF patched copy: a verified byte copy of the original, edited in
/// place by `xisf-header`, then proven to differ from it only by the
/// corrected header.
fn patch_xisf(
    target: &PatchTarget<'_>,
    original: &Path,
    edits: &[FieldEdit],
) -> Result<Patched, ItemReason> {
    let written = transfer::begin(target.operation, target.seq, &target.destination)?;
    transfer::fill_from_source(target.snapshot, &written)?;
    let partial = partial_path(&written)?;
    if let Err(error) = metadata_xisf::patch::patch_in_place(&partial, edits) {
        transfer::discard(&partial, &written.identity);
        return Err(build_failure(original, &target.patch.changes, &error));
    }
    // The edit renamed a new file over the partial copy. Should it vanish
    // now, clearing `View (building)/` still knows the partial by name.
    let edited = inventory::probe_fingerprint(&partial)
        .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
    let written = WrittenCopy { identity: edited.identity, ..written };
    let proven = transfer::settle_partial(&written, target.snapshot.fingerprint.modified_ns)
        .and_then(|()| {
            metadata_xisf::patch::patched_digest(&partial, original, edits)
                .map_err(|error| build_failure(original, &target.patch.changes, &error))?
                .ok_or_else(|| {
                    reason(
                        ReasonCode::DestinationMismatch,
                        format!(
                            "{} differs from its original beyond its corrected header",
                            partial.display()
                        ),
                    )
                })
        });
    match proven {
        Ok(digest) => install(target, &written, edited.size_bytes, hex::encode(digest)),
        Err(failure) => {
            transfer::discard(&partial, &written.identity);
            Err(failure)
        }
    }
}

/// Install the proven partial copy at its entry and re-read it there; one
/// that doesn't hold what was proven is removed.
fn install(
    target: &PatchTarget<'_>,
    written: &WrittenCopy,
    size_bytes: u64,
    sha256: String,
) -> Result<Patched, ItemReason> {
    transfer::install(&target.destination, written)?;
    if let Err(failure) =
        transfer::verify_bytes(&target.destination, written, size_bytes, Some(&sha256))
    {
        if let (Ok(root), Ok(relative)) =
            (target.destination.root.to_path_buf(), target.destination.relative.relative_path())
        {
            transfer::discard(&root.join(relative), &written.identity);
        }
        return Err(failure);
    }
    Ok(Patched { identity: written.identity.clone(), sha256 })
}

/// Whether `file`, found in a `View (building)/` where the build plans the
/// patched copy of `original` with `patch`, is that copy: what an
/// interrupted build of the same plan left. A FITS copy is proven by the
/// digest the same patch of `original`, which must still hold
/// `source_sha256`, yields; an XISF copy by comparison with `original`,
/// which the build snapshotted just before.
#[must_use]
pub fn is_planned_patch(
    file: &EntryEvidence,
    original: &Path,
    source_sha256: &str,
    patch: &HeaderPatch,
) -> bool {
    let (Ok(edits), Some(found)) = (edits_of(&patch.changes), file.sha256.as_deref()) else {
        return false;
    };
    match patch.format {
        ImageFormat::Fits => {
            metadata_fits::patch::copy_digests(original, &edits).is_ok_and(|digests| {
                hex::encode(digests.source) == source_sha256 && hex::encode(digests.copy) == found
            })
        }
        ImageFormat::Xisf => file.path.to_path_buf().is_ok_and(|copy| {
            metadata_xisf::patch::patched_digest(&copy, original, &edits)
                .is_ok_and(|digest| digest.is_some_and(|digest| hex::encode(digest) == found))
        }),
        ImageFormat::Unsupported => false,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Write;

    use sha2::{Digest, Sha256};

    use super::*;
    use crate::custody::observe_entry;
    use crate::NativePath;

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

    /// What no patched copy can deliver is refused when it is recorded: a
    /// value FITS can't hold, and a field no header keyword carries. The
    /// framing label is a grouping decision, not a header correction.
    #[test]
    fn refuses_at_entry_what_no_patched_copy_can_deliver() {
        let text = |value: &str| serde_json::Value::String(value.to_owned());
        assert_eq!(entry_refusal("object", &text("Hα")), Some(PatchRefusal::NotPrintableAscii));
        assert_eq!(entry_refusal("object", &text(&"x".repeat(69))), Some(PatchRefusal::TooLong));
        assert_eq!(entry_refusal("object", &text("NGC 7000")), None);
        let date = text("2026-10-12T20:00:00");
        assert_eq!(entry_refusal("dateObs", &date), Some(PatchRefusal::NoKeyword));
        assert_eq!(entry_refusal("raDeg", &serde_json::json!(10.5)), Some(PatchRefusal::NoKeyword));
        assert_eq!(entry_refusal(FRAMING_LABEL_FIELD, &text("Ha 2")), None);
        assert_eq!(entry_refusal("gain", &serde_json::json!(120)), None);
    }

    /// A FITS light: its primary header and a 4 × 4 8-bit image.
    fn fits_light() -> Vec<u8> {
        let cards = [
            "SIMPLE  =                    T",
            "BITPIX  =                    8",
            "NAXIS   =                    2",
            "NAXIS1  =                    4",
            "NAXIS2  =                    4",
            "END",
        ];
        let mut bytes: Vec<u8> =
            cards.iter().flat_map(|card| format!("{card:<80}").into_bytes()).collect();
        bytes.resize(2880, b' ');
        bytes.extend([7_u8; 16]);
        bytes.resize(2 * 2880, 0);
        bytes
    }

    struct Fixture {
        _dir: tempfile::TempDir,
        original: PathBuf,
        building: PathBuf,
        snapshot: EntryEvidence,
        patch: HeaderPatch,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let (original, building) =
                (dir.path().join("light.fits"), dir.path().join("View (building)"));
            fs::write(&original, fits_light()).unwrap();
            fs::create_dir(&building).unwrap();
            let snapshot = observe_entry(&original).unwrap();
            let patch = HeaderPatch {
                format: ImageFormat::Fits,
                changes: vec![change("object", "NGC 7000")],
            };
            Self { _dir: dir, original, building, snapshot, patch }
        }

        fn target(&self) -> PatchTarget<'_> {
            PatchTarget {
                snapshot: &self.snapshot,
                destination: TransferDestination {
                    root: NativePath::from_path(&self.building),
                    relative: NativePath::from_path(Path::new("NIGHT/light.fits")),
                },
                operation: Uuid::from_u128(7),
                seq: 3,
                patch: &self.patch,
            }
        }

        fn night(&self) -> PathBuf {
            self.building.join("NIGHT")
        }
    }

    /// A writer on a volume that fills up after `left` bytes.
    struct FullAfter<'a> {
        out: &'a mut File,
        left: usize,
    }

    impl Write for FullAfter<'_> {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if self.left == 0 {
                return Err(io::ErrorKind::StorageFull.into());
            }
            let written = self.out.write(&bytes[..bytes.len().min(self.left)])?;
            self.left -= written;
            Ok(written)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.out.flush()
        }
    }

    /// A FITS patched copy whose write fails part way leaves nothing at its
    /// entry and no partial copy beside it, so Retry writes it; the copy it
    /// writes is proven, and so recognised as this plan's own.
    #[test]
    fn a_patched_copy_that_fails_to_write_leaves_nothing_and_retry_writes_it() {
        let fixture = Fixture::new();
        let edits = edits_of(&fixture.patch.changes).unwrap();
        let failed = patch_fits(&fixture.target(), &fixture.original, |out| {
            let mut full = FullAfter { out, left: 3000 };
            metadata_fits::patch::write_copy(&fixture.original, &mut full, &edits)
        })
        .unwrap_err();
        assert_eq!(failed.code, ReasonCode::WriteFailed, "{failed:?}");
        assert_eq!(fs::read_dir(fixture.night()).unwrap().count(), 0, "nothing stays");

        let patched = patch_copy(&fixture.target()).unwrap();
        let path = fixture.night().join("light.fits");
        let copy = fs::read(&path).unwrap();
        assert_eq!(patched.sha256, hex::encode(Sha256::digest(&copy)));
        assert!(copy.windows(20).any(|card| card == b"OBJECT  = 'NGC 7000'"));
        assert_eq!(copy[2880..], fits_light()[2880..], "the data unit is unchanged");
        assert_eq!(fs::read(&fixture.original).unwrap(), fits_light(), "the original is only read");
        assert_eq!(fs::read_dir(fixture.night()).unwrap().count(), 1, "no partial copy stays");

        let sha256 = fixture.snapshot.sha256.as_deref().unwrap();
        let found = observe_entry(&path).unwrap();
        assert!(is_planned_patch(&found, &fixture.original, sha256, &fixture.patch));
        let plain = observe_entry(&fixture.original).unwrap();
        assert!(!is_planned_patch(&plain, &fixture.original, sha256, &fixture.patch));
    }

    /// An entry something else already holds is reported as occupied and
    /// never replaced.
    #[test]
    fn an_occupied_entry_is_reported_and_kept() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.night()).unwrap();
        fs::write(fixture.night().join("light.fits"), b"a tool's file").unwrap();
        let refused = patch_copy(&fixture.target()).unwrap_err();
        assert_eq!(refused.code, ReasonCode::DestinationOccupied, "{refused:?}");
        assert_eq!(fs::read(fixture.night().join("light.fits")).unwrap(), b"a tool's file");
        assert_eq!(fs::read_dir(fixture.night()).unwrap().count(), 1, "no partial copy stays");
    }

    /// The unfinished copies an interruption can leave are known by name:
    /// a partial copy, and the file `xisf-header` writes beside one.
    #[test]
    fn knows_the_partial_copies_an_interruption_leaves() {
        let partial = ".pv-0123abcd-3-a1b2c3.partial";
        assert!(transfer::is_partial_name(partial));
        assert!(transfer::is_partial_name(&format!(".{partial}.tmp-4242")));
        assert!(!transfer::is_partial_name(&format!(".{partial}.tmp-")));
        assert!(!transfer::is_partial_name(".light.fits.tmp-4242"));
        assert!(!transfer::is_partial_name("light.fits"));
    }
}
