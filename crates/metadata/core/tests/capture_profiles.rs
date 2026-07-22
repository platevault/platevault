// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::BTreeMap;

use metadata_core::{
    CalculatedFocalLength, CanonicalField, CaptureProfileRegistry, CaptureProfileVersion,
    EvidenceConfidence, EvidenceError, EvidenceState, FieldEvidence, MetadataEvidence,
    MetadataValue, RawMetadata, MAX_CAPTURE_PROFILE_TOML_BYTES, MAX_EVIDENCE_PAYLOAD_BYTES,
    MAX_EVIDENCE_VALUE_BYTES,
};

fn text(value: &str) -> MetadataValue {
    MetadataValue::Text(value.to_owned())
}

fn raw<I, K, V>(pairs: I) -> RawMetadata
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<String>,
    V: Into<String>,
{
    RawMetadata::from_pairs(pairs).unwrap()
}

#[test]
fn nina_uses_configured_camera_and_telescope_representatives() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = raw([
        ("SWCREATE", "N.I.N.A. 3.2.0.9001 (x64)"),
        ("CAMERA", "ZWO ASI2600MM Pro"),
        ("TELESCOP", "Celestron C925"),
        ("FILTER", "OIII"),
        ("XBINNING", "1"),
        ("YBINNING", "2"),
        ("FOCALLEN", "1645"),
    ]);

    let extracted = registry
        .extract(
            &raw,
            Some(CalculatedFocalLength::try_new(1_632.5, "wcs_cd_matrix".to_owned()).unwrap()),
        )
        .unwrap();

    assert_eq!(extracted.profile().profile_id(), "nina");
    assert_eq!(extracted.profile().version(), 1);

    let camera = extracted.field(CanonicalField::Camera).unwrap();
    assert_eq!(camera.state(), EvidenceState::Known);
    assert_eq!(camera.source_field(), Some("CAMERA"));
    assert_eq!(camera.normalized_value(), Some(&text("ZWO ASI2600MM Pro")));

    let telescope = extracted.field(CanonicalField::Telescope).unwrap();
    assert_eq!(telescope.source_field(), Some("TELESCOP"));
    assert_eq!(telescope.normalized_value(), Some(&text("Celestron C925")));

    assert_eq!(
        extracted.field(CanonicalField::BinningX).unwrap().normalized_value(),
        Some(&MetadataValue::Unsigned(1))
    );
    assert_eq!(
        extracted.field(CanonicalField::BinningY).unwrap().normalized_value(),
        Some(&MetadataValue::Unsigned(2))
    );

    let reported = extracted.field(CanonicalField::FocalLengthReported).unwrap();
    assert_eq!(reported.normalized_value(), Some(&MetadataValue::Decimal(1_645.0)));
    assert_eq!(reported.confidence(), EvidenceConfidence::Reported);

    let calculated = extracted.field(CanonicalField::FocalLengthCalculated).unwrap();
    assert_eq!(calculated.normalized_value(), Some(&MetadataValue::Decimal(1_632.5)));
    assert_eq!(calculated.confidence(), EvidenceConfidence::Calculated);
    assert_eq!(calculated.source_field(), Some("wcs_cd_matrix"));
}

#[test]
fn dwarf_prefers_instrume_and_keeps_missing_values_explicit() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = raw([
        ("ORIGIN", "DWARFLAB"),
        ("INSTRUME", "DWARF III"),
        ("CAMERA", "TELE"),
        ("TELESCOP", "DWARF 3"),
        ("XBINNING", "1"),
        ("YBINNING", "1"),
    ]);

    let extracted = registry.extract(&raw, None).unwrap();

    assert_eq!(extracted.profile().profile_id(), "dwarf");
    let camera = extracted.field(CanonicalField::Camera).unwrap();
    assert_eq!(camera.source_field(), Some("INSTRUME"));
    assert_eq!(camera.raw_value(), Some("DWARF III"));
    assert_eq!(camera.normalized_value(), Some(&text("DWARF 3")));

    for field in [CanonicalField::Filter, CanonicalField::Offset, CanonicalField::ReadoutMode] {
        let evidence = extracted.field(field).unwrap();
        assert_eq!(evidence.state(), EvidenceState::Absent);
        assert!(evidence.source_field().is_none());
        assert!(evidence.raw_value().is_none());
        assert!(evidence.normalized_value().is_none());
    }
}

#[test]
fn binning_axes_are_not_inferred_from_each_other_or_raster() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = raw([
        ("INSTRUME", "Unknown camera"),
        ("XBINNING", "2"),
        ("NAXIS1", "3000"),
        ("NAXIS2", "2000"),
    ]);

    let extracted = registry.extract(&raw, None).unwrap();

    assert_eq!(extracted.profile().profile_id(), "generic");
    assert_eq!(
        extracted.field(CanonicalField::BinningX).unwrap().normalized_value(),
        Some(&MetadataValue::Unsigned(2))
    );
    assert_eq!(extracted.field(CanonicalField::BinningY).unwrap().state(), EvidenceState::Absent);
}

#[test]
fn xisf_native_focal_length_is_scaled_without_overwriting_calculated_evidence() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = raw([
        ("Instrument:Camera:Name", "QHY268M"),
        ("Instrument:Telescope:Name", "APO 120"),
        ("Instrument:Telescope:FocalLength", "0.835784"),
    ]);

    let extracted = registry
        .extract(
            &raw,
            Some(CalculatedFocalLength::try_new(821.25, "xisf_wcs_transform".to_owned()).unwrap()),
        )
        .unwrap();

    assert_eq!(
        extracted.field(CanonicalField::Camera).unwrap().normalized_value(),
        Some(&text("QHY268M"))
    );
    assert_eq!(
        extracted.field(CanonicalField::Telescope).unwrap().normalized_value(),
        Some(&text("APO 120"))
    );
    assert_eq!(
        extracted.field(CanonicalField::FocalLengthReported).unwrap().normalized_value(),
        Some(&MetadataValue::Decimal(835.784))
    );
    assert_eq!(
        extracted.field(CanonicalField::FocalLengthCalculated).unwrap().normalized_value(),
        Some(&MetadataValue::Decimal(821.25))
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
    let raw = raw([("MAKER", "shared"), ("LOWER_CAMERA", "lower"), ("HIGHER_CAMERA", "higher")]);

    let extracted = registry.extract(&raw, None).unwrap();

    assert_eq!(extracted.profile().profile_id(), "higher");
    assert_eq!(extracted.profile().version(), 2);
    assert_eq!(
        extracted.field(CanonicalField::Camera).unwrap().normalized_value(),
        Some(&text("higher"))
    );
}

#[test]
fn invalid_present_value_is_not_collapsed_into_absence() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let raw = raw([("OFFSET", "not-an-integer")]);

    let extracted = registry.extract(&raw, None).unwrap();
    let offset = extracted.field(CanonicalField::Offset).unwrap();

    assert_eq!(offset.state(), EvidenceState::Invalid);
    assert_eq!(offset.source_field(), Some("OFFSET"));
    assert_eq!(offset.raw_value(), Some("not-an-integer"));
    assert!(offset.normalized_value().is_none());
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
    let raw = raw([("VENDOR_CAMERA", "Configured Camera")]);

    let extracted = registry.extract(&raw, None).unwrap();

    assert_eq!(extracted.profile().profile_id(), "vendor");
    assert_eq!(extracted.profile().version(), 7);
    assert_eq!(
        extracted.field(CanonicalField::Camera).unwrap().normalized_value(),
        Some(&text("Configured Camera"))
    );
}

#[test]
fn pixel_size_and_rotator_keep_distinct_numeric_boundary_semantics() {
    let registry = CaptureProfileRegistry::embedded().unwrap();
    let boundary_raw = raw([("XPIXSZ", "0"), ("ROTATANG", "-180")]);

    let extracted = registry.extract(&boundary_raw, None).unwrap();

    let pixel_size = extracted.field(CanonicalField::PixelSize).unwrap();
    assert_eq!(pixel_size.state(), EvidenceState::Invalid);
    assert_eq!(pixel_size.raw_value(), Some("0"));

    let rotator = extracted.field(CanonicalField::PhysicalRotator).unwrap();
    assert_eq!(rotator.state(), EvidenceState::Known);
    assert_eq!(rotator.normalized_value(), Some(&MetadataValue::Decimal(-180.0)));

    let non_finite = raw([("XPIXSZ", "0.000001"), ("ROTATANG", "NaN")]);
    let extracted = registry.extract(&non_finite, None).unwrap();
    assert_eq!(
        extracted.field(CanonicalField::PixelSize).unwrap().normalized_value(),
        Some(&MetadataValue::Decimal(0.000_001))
    );
    assert_eq!(
        extracted.field(CanonicalField::PhysicalRotator).unwrap().state(),
        EvidenceState::Invalid
    );
}

#[test]
fn field_evidence_rejects_invalid_state_value_tuples_during_deserialization() {
    let error = toml::from_str::<FieldEvidence>(
        r#"
state = "known"
sourceField = "CAMERA"
rawValue = "ASI2600MM"
confidence = "reported"
"#,
    )
    .unwrap_err();

    assert!(error.to_string().contains("known evidence requires"));

    let oversized = "x".repeat(MAX_EVIDENCE_VALUE_BYTES + 1);
    let source = format!(
        r#"
state = "invalid"
sourceField = "CAMERA"
rawValue = "{oversized}"
confidence = "reported"
"#
    );
    let error = toml::from_str::<FieldEvidence>(&source).unwrap_err();
    assert!(error.to_string().contains("maximum is 16384"));
}

#[test]
fn individual_evidence_values_enforce_max_minus_one_max_and_max_plus_one() {
    for size in [MAX_EVIDENCE_VALUE_BYTES - 1, MAX_EVIDENCE_VALUE_BYTES] {
        let value = "x".repeat(size);
        FieldEvidence::try_new(
            EvidenceState::Known,
            Some("CAMERA".to_owned()),
            Some(value.clone()),
            Some(MetadataValue::Text(value)),
            EvidenceConfidence::Reported,
        )
        .unwrap();
    }

    let oversized = "x".repeat(MAX_EVIDENCE_VALUE_BYTES + 1);
    let error = FieldEvidence::try_new(
        EvidenceState::Invalid,
        Some("CAMERA".to_owned()),
        Some(oversized),
        None,
        EvidenceConfidence::Reported,
    )
    .unwrap_err();
    assert!(matches!(
        error,
        EvidenceError::ValueTooLarge {
            actual,
            maximum: MAX_EVIDENCE_VALUE_BYTES,
            ..
        } if actual == MAX_EVIDENCE_VALUE_BYTES + 1
    ));
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UncheckedMetadataEvidence<'a> {
    profile: &'a CaptureProfileVersion,
    fields: &'a BTreeMap<CanonicalField, FieldEvidence>,
}

fn text_evidence(size: usize) -> FieldEvidence {
    let value = "x".repeat(size);
    FieldEvidence::try_new(
        EvidenceState::Known,
        Some("SOURCE".to_owned()),
        Some(value.clone()),
        Some(MetadataValue::Text(value)),
        EvidenceConfidence::Reported,
    )
    .unwrap()
}

#[test]
fn aggregate_evidence_payload_enforces_max_minus_one_max_and_max_plus_one() {
    let profile = CaptureProfileVersion::try_new("test".to_owned(), 1, 1).unwrap();
    let fields = [
        CanonicalField::Camera,
        CanonicalField::Telescope,
        CanonicalField::Filter,
        CanonicalField::Gain,
        CanonicalField::Offset,
        CanonicalField::ReadoutMode,
        CanonicalField::Crop,
        CanonicalField::SkyOrientation,
    ];

    let max_fields = fields
        .into_iter()
        .map(|field| (field, text_evidence(MAX_EVIDENCE_VALUE_BYTES)))
        .collect::<BTreeMap<_, _>>();
    MetadataEvidence::try_new(profile.clone(), max_fields.clone()).unwrap();

    let mut max_minus_one_fields = max_fields.clone();
    max_minus_one_fields
        .insert(CanonicalField::Camera, text_evidence(MAX_EVIDENCE_VALUE_BYTES - 1));
    MetadataEvidence::try_new(profile.clone(), max_minus_one_fields).unwrap();

    let mut max_plus_one_fields = max_fields;
    max_plus_one_fields.insert(
        CanonicalField::BinningX,
        FieldEvidence::try_new(
            EvidenceState::Invalid,
            Some("XBINNING".to_owned()),
            Some("x".to_owned()),
            None,
            EvidenceConfidence::Reported,
        )
        .unwrap(),
    );
    let error =
        MetadataEvidence::try_new(profile.clone(), max_plus_one_fields.clone()).unwrap_err();
    assert_eq!(
        error,
        EvidenceError::PayloadTooLarge {
            actual: MAX_EVIDENCE_PAYLOAD_BYTES + 1,
            maximum: MAX_EVIDENCE_PAYLOAD_BYTES,
        }
    );

    let serialized = toml::to_string(&UncheckedMetadataEvidence {
        profile: &profile,
        fields: &max_plus_one_fields,
    })
    .unwrap();
    let error = toml::from_str::<MetadataEvidence>(&serialized).unwrap_err();
    assert!(error.to_string().contains("metadata evidence payload"));
}

#[test]
fn raw_metadata_deserialization_canonicalizes_keys_and_rejects_collisions() {
    let canonicalized = toml::from_str::<RawMetadata>(
        r#"
[values.camera]
source_field = "camera"
raw_value = "QHY268M"
"#,
    )
    .unwrap();
    let canonical_toml = toml::to_string(&canonicalized).unwrap();
    assert!(canonical_toml.contains("[values.CAMERA]"));
    let extracted =
        CaptureProfileRegistry::embedded().unwrap().extract(&canonicalized, None).unwrap();
    assert_eq!(
        extracted.field(CanonicalField::Camera).unwrap().normalized_value(),
        Some(&text("QHY268M"))
    );

    let collision = toml::from_str::<RawMetadata>(
        r#"
[values.camera]
source_field = "camera"
raw_value = "first"

[values.CAMERA]
source_field = "CAMERA"
raw_value = "second"
"#,
    )
    .unwrap_err();
    assert!(collision.to_string().contains("case-insensitive key collision"));
}

const MINIMAL_PROFILE: &str = r#"
format_version = 1
fallback_profile = "generic"

[[profiles]]
id = "generic"
version = 1
"#;

fn padded_profile(size: usize) -> String {
    assert!(size >= MINIMAL_PROFILE.len() + 2);
    let mut source = MINIMAL_PROFILE.to_owned();
    source.push_str("\n#");
    source.push_str(&"x".repeat(size - source.len()));
    assert_eq!(source.len(), size);
    source
}

#[test]
fn capture_profile_input_is_bounded_at_the_documented_utf8_limit() {
    for size in [MAX_CAPTURE_PROFILE_TOML_BYTES - 1, MAX_CAPTURE_PROFILE_TOML_BYTES] {
        CaptureProfileRegistry::from_toml(&padded_profile(size)).unwrap();
    }

    let oversized = padded_profile(MAX_CAPTURE_PROFILE_TOML_BYTES + 1);
    let error = CaptureProfileRegistry::from_toml(&oversized).unwrap_err();
    assert!(matches!(
        error,
        metadata_core::CaptureProfileError::SourceTooLarge {
            actual,
            maximum: MAX_CAPTURE_PROFILE_TOML_BYTES,
        } if actual == MAX_CAPTURE_PROFILE_TOML_BYTES + 1
    ));
}

#[test]
fn capture_profile_toml_rejects_unknown_fields() {
    let source = format!("{MINIMAL_PROFILE}\nunexpected = true\n");
    let error = CaptureProfileRegistry::from_toml(&source).unwrap_err();

    assert!(error.to_string().contains("unknown field"));
}
