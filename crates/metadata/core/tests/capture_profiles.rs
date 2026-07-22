// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use metadata_core::{
    CalculatedFocalLength, CanonicalField, CaptureProfileRegistry, EvidenceConfidence,
    EvidenceState, MetadataValue, RawMetadata,
};

fn text(value: &str) -> MetadataValue {
    MetadataValue::Text(value.to_owned())
}

#[test]
fn nina_uses_configured_camera_and_telescope_representatives() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = RawMetadata::from_pairs([
        ("SWCREATE", "N.I.N.A. 3.2.0.9001 (x64)"),
        ("CAMERA", "ZWO ASI2600MM Pro"),
        ("TELESCOP", "Celestron C925"),
        ("FILTER", "OIII"),
        ("XBINNING", "1"),
        ("YBINNING", "2"),
        ("FOCALLEN", "1645"),
    ]);

    let extracted = registry.extract(
        &raw,
        Some(CalculatedFocalLength { millimetres: 1_632.5, source: "wcs_cd_matrix".to_owned() }),
    );

    assert_eq!(extracted.profile.profile_id, "nina");
    assert_eq!(extracted.profile.version, 1);

    let camera = extracted.field(CanonicalField::Camera).unwrap();
    assert_eq!(camera.state, EvidenceState::Known);
    assert_eq!(camera.source_field.as_deref(), Some("CAMERA"));
    assert_eq!(camera.normalized_value, Some(text("ZWO ASI2600MM Pro")));

    let telescope = extracted.field(CanonicalField::Telescope).unwrap();
    assert_eq!(telescope.source_field.as_deref(), Some("TELESCOP"));
    assert_eq!(telescope.normalized_value, Some(text("Celestron C925")));

    assert_eq!(
        extracted.field(CanonicalField::BinningX).unwrap().normalized_value,
        Some(MetadataValue::Unsigned(1))
    );
    assert_eq!(
        extracted.field(CanonicalField::BinningY).unwrap().normalized_value,
        Some(MetadataValue::Unsigned(2))
    );

    let reported = extracted.field(CanonicalField::FocalLengthReported).unwrap();
    assert_eq!(reported.normalized_value, Some(MetadataValue::Decimal(1_645.0)));
    assert_eq!(reported.confidence, EvidenceConfidence::Reported);

    let calculated = extracted.field(CanonicalField::FocalLengthCalculated).unwrap();
    assert_eq!(calculated.normalized_value, Some(MetadataValue::Decimal(1_632.5)));
    assert_eq!(calculated.confidence, EvidenceConfidence::Calculated);
    assert_eq!(calculated.source_field.as_deref(), Some("wcs_cd_matrix"));
}

#[test]
fn dwarf_prefers_instrume_and_keeps_missing_values_explicit() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = RawMetadata::from_pairs([
        ("ORIGIN", "DWARFLAB"),
        ("INSTRUME", "DWARF III"),
        ("CAMERA", "TELE"),
        ("TELESCOP", "DWARF 3"),
        ("XBINNING", "1"),
        ("YBINNING", "1"),
    ]);

    let extracted = registry.extract(&raw, None);

    assert_eq!(extracted.profile.profile_id, "dwarf");
    let camera = extracted.field(CanonicalField::Camera).unwrap();
    assert_eq!(camera.source_field.as_deref(), Some("INSTRUME"));
    assert_eq!(camera.raw_value.as_deref(), Some("DWARF III"));
    assert_eq!(camera.normalized_value, Some(text("DWARF 3")));

    for field in [CanonicalField::Filter, CanonicalField::Offset, CanonicalField::ReadoutMode] {
        let evidence = extracted.field(field).unwrap();
        assert_eq!(evidence.state, EvidenceState::Absent);
        assert!(evidence.source_field.is_none());
        assert!(evidence.raw_value.is_none());
        assert!(evidence.normalized_value.is_none());
    }
}

#[test]
fn binning_axes_are_not_inferred_from_each_other_or_raster() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = RawMetadata::from_pairs([
        ("INSTRUME", "Unknown camera"),
        ("XBINNING", "2"),
        ("NAXIS1", "3000"),
        ("NAXIS2", "2000"),
    ]);

    let extracted = registry.extract(&raw, None);

    assert_eq!(extracted.profile.profile_id, "generic");
    assert_eq!(
        extracted.field(CanonicalField::BinningX).unwrap().normalized_value,
        Some(MetadataValue::Unsigned(2))
    );
    assert_eq!(extracted.field(CanonicalField::BinningY).unwrap().state, EvidenceState::Absent);
}

#[test]
fn xisf_native_focal_length_is_scaled_without_overwriting_calculated_evidence() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = RawMetadata::from_pairs([
        ("Instrument:Camera:Name", "QHY268M"),
        ("Instrument:Telescope:Name", "APO 120"),
        ("Instrument:Telescope:FocalLength", "0.835784"),
    ]);

    let extracted = registry.extract(
        &raw,
        Some(CalculatedFocalLength {
            millimetres: 821.25,
            source: "xisf_wcs_transform".to_owned(),
        }),
    );

    assert_eq!(
        extracted.field(CanonicalField::Camera).unwrap().normalized_value,
        Some(text("QHY268M"))
    );
    assert_eq!(
        extracted.field(CanonicalField::Telescope).unwrap().normalized_value,
        Some(text("APO 120"))
    );
    assert_eq!(
        extracted.field(CanonicalField::FocalLengthReported).unwrap().normalized_value,
        Some(MetadataValue::Decimal(835.784))
    );
    assert_eq!(
        extracted.field(CanonicalField::FocalLengthCalculated).unwrap().normalized_value,
        Some(MetadataValue::Decimal(821.25))
    );
}

#[test]
fn explicit_priority_selects_one_matching_profile_deterministically() {
    let registry = CaptureProfileRegistry::from_toml(
        r#"
format_version = 1
fallback_profile = "generic"

[[profiles]]
id = "lower"
version = 1
priority = 10
match_any = [{ field = "MAKER", equals = "shared" }]

[profiles.fields.camera]
confidence = "reported"
sources = [{ field = "LOWER_CAMERA", parser = "text" }]

[[profiles]]
id = "higher"
version = 2
priority = 20
match_any = [{ field = "MAKER", equals = "shared" }]

[profiles.fields.camera]
confidence = "reported"
sources = [{ field = "HIGHER_CAMERA", parser = "text" }]

[[profiles]]
id = "generic"
version = 1
priority = 0
"#,
    )
    .unwrap();
    let raw = RawMetadata::from_pairs([
        ("MAKER", "shared"),
        ("LOWER_CAMERA", "lower"),
        ("HIGHER_CAMERA", "higher"),
    ]);

    let extracted = registry.extract(&raw, None);

    assert_eq!(extracted.profile.profile_id, "higher");
    assert_eq!(extracted.profile.version, 2);
    assert_eq!(
        extracted.field(CanonicalField::Camera).unwrap().normalized_value,
        Some(text("higher"))
    );
}

#[test]
fn invalid_present_value_is_not_collapsed_into_absence() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = RawMetadata::from_pairs([("OFFSET", "not-an-integer")]);

    let extracted = registry.extract(&raw, None);
    let offset = extracted.field(CanonicalField::Offset).unwrap();

    assert_eq!(offset.state, EvidenceState::Invalid);
    assert_eq!(offset.source_field.as_deref(), Some("OFFSET"));
    assert_eq!(offset.raw_value.as_deref(), Some("not-an-integer"));
    assert!(offset.normalized_value.is_none());
}

#[test]
fn source_vocabulary_is_supplied_by_toml_not_rust_branches() {
    let registry = CaptureProfileRegistry::from_toml(
        r#"
format_version = 1
fallback_profile = "vendor"

[[profiles]]
id = "vendor"
version = 7
priority = 1

[profiles.fields.camera]
confidence = "confirmed"
sources = [{ field = "VENDOR_CAMERA", parser = "text" }]
"#,
    )
    .unwrap();
    let raw = RawMetadata::from_pairs([("VENDOR_CAMERA", "Configured Camera")]);

    let extracted = registry.extract(&raw, None);

    assert_eq!(extracted.profile.profile_id, "vendor");
    assert_eq!(extracted.profile.version, 7);
    assert_eq!(
        extracted.field(CanonicalField::Camera).unwrap().normalized_value,
        Some(text("Configured Camera"))
    );
}
