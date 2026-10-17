// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared calibration model types (spec 068): the stack count a master
//! determination reads, the F4 reference kinds, the calibration kinds' wire
//! names and adoption destinations.

mod support;

use metadata_core::MetadataExtractor;
use platevault_core::{CaptureMetadata, LibraryError, NativePath};
use uuid::Uuid;

#[test]
fn capture_metadata_carries_the_stack_count_and_keeps_an_absent_count_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let cases: [(&str, &[(&str, &str)], Option<u32>); 3] = [
        ("both.fits", &[("IMAGETYP", "'Flat'"), ("STACKCNT", "30"), ("NCOMBINE", "12")], Some(30)),
        ("ncombine.fits", &[("IMAGETYP", "'Flat'"), ("NCOMBINE", "12")], Some(12)),
        ("none.fits", &[("IMAGETYP", "'Flat'")], None),
    ];
    for (name, fields, expected) in cases {
        let path = dir.path().join(name);
        support::fits(&path, fields).unwrap();
        let raw = metadata_fits::FitsExtractor.extract(&path).unwrap().unwrap();
        assert_eq!(CaptureMetadata::from(&raw).stack_count, expected, "{name}");
    }
    let absent = CaptureMetadata::from(&metadata_core::RawFileMetadata::default());
    assert_eq!(absent.stack_count, None, "an absent count is never 0");
    // A capture stored before 068 carries no stackCount field at all.
    let mut stored = serde_json::to_value(&absent).unwrap();
    assert!(stored.as_object_mut().unwrap().remove("stackCount").is_some());
    let read: CaptureMetadata = serde_json::from_value(stored).unwrap();
    assert_eq!(read.stack_count, None);
}

/// F4 references are a Project's held copies and calibration records
/// (adopted masters and session pins); runs, Views and Results hold none.
#[test]
fn references_are_project_or_calibration() {
    use platevault_core::ReferenceKind;
    for (kind, wire) in
        [(ReferenceKind::Project, "project"), (ReferenceKind::Calibration, "calibration")]
    {
        let text = serde_json::to_value(kind).unwrap();
        assert_eq!(text, serde_json::json!(wire));
        assert_eq!(serde_json::from_value::<ReferenceKind>(text).unwrap(), kind);
    }
    for gone in ["view", "result"] {
        assert!(serde_json::from_value::<ReferenceKind>(serde_json::json!(gone)).is_err(), "{gone}");
    }
}

fn names_field(error: &LibraryError, field: &str) -> bool {
    matches!(error, LibraryError::InvalidInput(message) if message.contains(field))
}

#[test]
fn calibration_kinds_are_bias_dark_and_flat() {
    use platevault_core::InputKind;
    for wire in ["dark_flat", "darkflat", "light", ""] {
        let parsed = serde_json::from_value::<InputKind>(serde_json::json!(wire))
            .map_err(LibraryError::from);
        assert!(matches!(parsed, Err(LibraryError::InvalidInput(_))), "{wire}: {parsed:?}");
    }
    for (kind, wire) in
        [(InputKind::Bias, "bias"), (InputKind::Dark, "dark"), (InputKind::Flat, "flat")]
    {
        assert_eq!(serde_json::to_value(kind).unwrap(), serde_json::json!(wire));
    }
}

#[test]
fn an_adoption_destination_names_a_new_file_below_the_location_root() {
    use platevault_core::AdoptionDestination;
    // Each literal is the native encoding of its text: `/` is a separator on
    // every host, and a payload from another OS is refused before validation.
    let destination = |path: &str| AdoptionDestination {
        location_id: Uuid::from_u128(7),
        relative_path: NativePath::from_path(std::path::Path::new(path)),
    };
    for refused in
        ["/masters/masterFlat.fit", "../masterFlat.fit", "masters/../../x.fit", "", ".", "masters/"]
    {
        let error = destination(refused).validate().unwrap_err();
        assert!(names_field(&error, "relativePath"), "{refused:?}: {error:?}");
    }
    assert_eq!(
        destination("masters/master_flat_Ha.fit").validate().unwrap(),
        std::path::PathBuf::from("masters/master_flat_Ha.fit")
    );
    #[cfg(unix)]
    {
        let lossy = AdoptionDestination {
            location_id: Uuid::from_u128(7),
            relative_path: NativePath::UnixBytes(b"masters/flat_\xff.fit".to_vec()),
        };
        let path = lossy.validate().unwrap();
        assert_eq!(NativePath::from_path(&path), lossy.relative_path, "non-UTF8 stays lossless");
        let wire = serde_json::to_value(&lossy).unwrap();
        let back: AdoptionDestination = serde_json::from_value(wire).unwrap();
        assert_eq!(back, lossy);
    }
}
