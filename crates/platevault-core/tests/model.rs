mod support;

use metadata_core::MetadataExtractor;
use platevault_core::{
    CalibrationKind, CaptureMetadata, ChecklistItemInput, ChecklistKind, Drift, FileIdentity,
    ImportFormat, ImportVerification, ImportedValue, LibraryError, MeasurementMethod, MetricId,
    MetricValue, NativePath, ObservationFingerprint, PanelInput, PreambleEntry, ProjectInput,
    ProjectPanel, RegionsRequest, RowMatch, SampleNumber, SampleRequest, Stretch, TargetCone,
    TargetFraming, TileRequest, Units, ValueSource, VolumeIdentity,
};
use uuid::Uuid;

#[test]
fn native_geometry_overrides_stale_keywords_and_preserves_unknown_structure() {
    use metadata_core::{NativeGeometry, RawFileMetadata};
    let mut raw = RawFileMetadata {
        naxis1: Some("400".into()),
        naxis2: Some("300".into()),
        native_geometry: Some(NativeGeometry::Planar { width: 4, height: 4, channels: 1 }),
        native_geometry_raw: Some("4:4:1".into()),
        ..RawFileMetadata::default()
    };
    let captured = CaptureMetadata::from(&raw);
    assert_eq!((captured.width, captured.height), (Some(4), Some(4)));
    assert_eq!(captured.raw.get("NAXIS1").map(String::as_str), Some("400"));
    assert_eq!(captured.raw.get("XISF:geometry").map(String::as_str), Some("4:4:1"));
    for geometry in [NativeGeometry::Unsupported, NativeGeometry::Malformed] {
        raw.native_geometry = Some(geometry);
        let captured = CaptureMetadata::from(&raw);
        assert_eq!((captured.width, captured.height), (None, None));
    }
    raw.native_geometry = None;
    let captured = CaptureMetadata::from(&raw);
    assert_eq!((captured.width, captured.height), (Some(400), Some(300)));
}

#[test]
fn real_fits_and_xisf_metadata_keep_scientific_evidence_and_source_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let fits = dir.path().join("light.fits");
    let xisf = dir.path().join("light.xisf");
    let fields = [
        ("IMAGETYP", "'LIGHT'"),
        ("FILTER", "'Ha'"),
        ("EXPTIME", "300.0"),
        ("GAIN", "100"),
        ("SET-TEMP", "-10"),
        ("CCD-TEMP", "-9.8"),
        ("DATE-OBS", "'2026-09-30T23:59:00'"),
        ("DATE-LOC", "'2026-10-01T01:59:00'"),
        ("INSTRUME", "'ASI2600MM'"),
        ("SITELONG", "15"),
    ];
    support::fits(&fits, &fields).unwrap();
    support::xisf(&xisf, &fields).unwrap();
    let before = [support::digest(&fits), support::digest(&xisf)];
    let extractors: [(&std::path::Path, &dyn MetadataExtractor); 2] =
        [(&fits, &metadata_fits::FitsExtractor), (&xisf, &metadata_xisf::XisfExtractor)];
    for (path, extractor) in extractors {
        let raw = extractor.extract(path).unwrap().unwrap();
        let metadata = CaptureMetadata::from(&raw);
        assert_eq!(metadata.exposure_seconds, Some(300.0));
        assert_eq!(metadata.set_temperature_c, Some(-10.0));
        assert_eq!(metadata.measured_temperature_c, Some(-9.8));
        assert_eq!(metadata.filter.as_deref(), Some("Ha"));
        assert_eq!(metadata.camera.as_deref(), Some("ASI2600MM"));
        assert_eq!(metadata.date_local.as_deref(), Some("2026-10-01T01:59:00"));
    }
    assert_eq!(before, [support::digest(&fits), support::digest(&xisf)]);
}

#[test]
fn relative_path_refuses_parent_and_absolute_paths() {
    assert!(NativePath::from_path(std::path::Path::new("../outside.fits"))
        .relative_path()
        .is_err());
    assert!(NativePath::from_path(&std::env::temp_dir()).relative_path().is_err());
    assert_eq!(
        NativePath::from_path(std::path::Path::new("night/Ha.fits")).relative_path().unwrap(),
        std::path::Path::new("night/Ha.fits")
    );
}

#[cfg(unix)]
#[test]
fn unix_non_utf8_path_roundtrips_without_display_identity_loss() {
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    let path = std::path::PathBuf::from(std::ffi::OsString::from_vec(b"night/\xff.fits".to_vec()));
    let native = NativePath::from_path(&path);
    let encoded = serde_json::to_string(&native).unwrap();
    let mut wire: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    assert_eq!(wire["display"], native.display());
    wire["display"] = serde_json::json!("an unrelated display path");
    let independent: NativePath = serde_json::from_value(wire).unwrap();
    assert_eq!(independent, native);
    let restored: NativePath = serde_json::from_str(&encoded).unwrap();
    assert_eq!(restored.to_path_buf().unwrap().as_os_str().as_bytes(), path.as_os_str().as_bytes());
    assert_ne!(native.display().as_bytes(), path.as_os_str().as_bytes());
}

#[test]
fn mount_unstable_file_numbers_do_not_invalidate_identical_decision_fingerprint() {
    let volume = VolumeIdentity {
        filesystem: "test-unstable".into(),
        stable_id: Some("same-volume".into()),
        file_ids_stable: false,
        case: platevault_core::PathSensitivity::Unknown,
        normalization: platevault_core::PathSensitivity::Unknown,
    };
    let a = ObservationFingerprint {
        identity: FileIdentity { volume, file_id: Some("mount-a".into()) },
        size_bytes: 16,
        modified_ns: 123,
        content_sha256: None,
    };
    let mut b = a.clone();
    b.identity.file_id = Some("mount-b".into());
    assert!(a.equivalent(&b));
    b.size_bytes += 1;
    assert!(!a.equivalent(&b));
    b.size_bytes = a.size_bytes;
    b.identity.volume.stable_id = Some("replacement".into());
    assert!(!a.equivalent(&b));
}

#[test]
fn sky_cone_refuses_nonfinite_out_of_range_coordinates() {
    for cone in [
        TargetCone { ra_deg: f64::NAN, dec_deg: 0.0, radius_deg: 1.0 },
        TargetCone { ra_deg: 10.0, dec_deg: 91.0, radius_deg: 1.0 },
        TargetCone { ra_deg: 10.0, dec_deg: 0.0, radius_deg: -1.0 },
    ] {
        assert!(cone.validate().is_err());
    }
    assert!(TargetCone { ra_deg: 359.0, dec_deg: -90.0, radius_deg: 180.0 }.validate().is_ok());
}

/// The refusal is `InvalidInput` and names `field`.
fn refused_naming(result: Result<(), LibraryError>, field: &str) {
    match result {
        Err(LibraryError::InvalidInput(message)) => {
            assert!(message.contains(field), "{message:?} should name {field:?}");
        }
        other => panic!("expected InvalidInput naming {field:?}, got {other:?}"),
    }
}

fn panel(name: &str) -> PanelInput {
    PanelInput {
        id: None,
        name: name.into(),
        ra_deg: 314.75,
        dec_deg: 44.33,
        width_deg: 2.5,
        height_deg: 1.7,
        position_angle_deg: None,
    }
}

fn project(targets: Vec<TargetFraming>, panels: Vec<PanelInput>) -> ProjectInput {
    ProjectInput {
        name: "NGC 7000 HOO".into(),
        notes: Some("Bicolor mosaic".into()),
        targets,
        panels,
        equipment_ids: Vec::new(),
    }
}

#[test]
fn project_input_refuses_blank_names_empty_framing_and_duplicates() {
    let ngc7000 = TargetFraming { target_id: Uuid::new_v4(), expected_revision: 3 };
    assert!(project(vec![ngc7000.clone()], Vec::new()).validate().is_ok());
    assert!(project(Vec::new(), vec![panel("East")]).validate().is_ok(), "panels frame alone");
    for blank in ["", "   "] {
        let input = ProjectInput { name: blank.into(), ..project(vec![ngc7000.clone()], vec![]) };
        refused_naming(input.validate(), "name");
    }
    refused_naming(project(Vec::new(), Vec::new()).validate(), "targets");
    let twice = project(vec![ngc7000.clone(), ngc7000.clone()], Vec::new());
    refused_naming(twice.validate(), "targets");
    let names = project(vec![ngc7000.clone()], vec![panel("East"), panel(" East ")]);
    refused_naming(names.validate(), "panels");
    let equipment = Uuid::new_v4();
    let repeated = ProjectInput {
        equipment_ids: vec![equipment, equipment],
        ..project(vec![ngc7000], vec![])
    };
    refused_naming(repeated.validate(), "equipmentIds");
}

#[test]
fn panel_input_accepts_its_closed_bounds_and_keeps_unknown_orientation_unknown() {
    for (ra_deg, dec_deg) in [(0.0, -90.0), (359.999, 90.0)] {
        let edge = PanelInput {
            ra_deg,
            dec_deg,
            width_deg: 180.0,
            height_deg: 180.0,
            position_angle_deg: Some(0.0),
            ..panel("Edge")
        };
        assert!(edge.validate().is_ok(), "{edge:?}");
    }
    let wire: PanelInput = serde_json::from_value(serde_json::json!({
        "name": "North", "raDeg": 0, "decDeg": 0, "widthDeg": 1, "heightDeg": 1,
        "positionAngleDeg": null
    }))
    .unwrap();
    assert_eq!(wire.position_angle_deg, None, "null orientation is unknown, never 0");
    assert!(wire.validate().is_ok());
    let omitted: PanelInput = serde_json::from_value(serde_json::json!({
        "name": "South", "raDeg": 1, "decDeg": 1, "widthDeg": 1, "heightDeg": 1
    }))
    .unwrap();
    assert_eq!(omitted.position_angle_deg, None);

    refused_naming(PanelInput { name: " ".into(), ..panel("x") }.validate(), "name");
    for ra_deg in [360.0, -0.5, f64::NAN, f64::INFINITY] {
        refused_naming(PanelInput { ra_deg, ..panel("P") }.validate(), "raDeg");
    }
    for dec_deg in [90.5, -91.0, f64::NAN, f64::NEG_INFINITY] {
        refused_naming(PanelInput { dec_deg, ..panel("P") }.validate(), "decDeg");
    }
    for width_deg in [0.0, -1.0, 180.5, f64::NAN, f64::INFINITY] {
        refused_naming(PanelInput { width_deg, ..panel("P") }.validate(), "widthDeg");
    }
    for height_deg in [0.0, -2.0, f64::NAN] {
        refused_naming(PanelInput { height_deg, ..panel("P") }.validate(), "heightDeg");
    }
    for angle in [360.0, -1.0, f64::NAN, f64::INFINITY] {
        let turned = PanelInput { position_angle_deg: Some(angle), ..panel("P") };
        refused_naming(turned.validate(), "positionAngleDeg");
    }
}

fn item(criterion: ChecklistKind) -> ChecklistItemInput {
    ChecklistItemInput { id: None, criterion }
}

#[test]
fn checklist_item_input_refuses_empty_goals_blank_channels_and_panelless_coverage() {
    let stored = ProjectPanel {
        id: Uuid::new_v4(),
        name: "East".into(),
        ra_deg: 314.75,
        dec_deg: 44.33,
        width_deg: 2.5,
        height_deg: 1.7,
        position_angle_deg: None,
    };
    let panels = std::slice::from_ref(&stored);
    let valid = [
        ChecklistKind::Integration { channel: "Ha".into(), goal_seconds: 36_000 },
        ChecklistKind::FrameCount { channel: "OIII".into(), goal_frames: 1 },
        ChecklistKind::ExposurePreference { exposure_seconds: 300.0, channel: None },
        ChecklistKind::ExposurePreference { exposure_seconds: 0.1, channel: Some("Ha".into()) },
        ChecklistKind::PanelCoverage,
        ChecklistKind::Equipment { equipment_id: Uuid::new_v4() },
        ChecklistKind::MissingCalibration { calibration: CalibrationKind::Flat, channel: None },
    ];
    for criterion in valid {
        assert!(item(criterion.clone()).validate(panels).is_ok(), "{criterion:?}");
    }
    let zero = ChecklistKind::Integration { channel: "Ha".into(), goal_seconds: 0 };
    refused_naming(item(zero).validate(panels), "goalSeconds");
    let none = ChecklistKind::FrameCount { channel: "Ha".into(), goal_frames: 0 };
    refused_naming(item(none).validate(panels), "goalFrames");
    for exposure_seconds in [0.0, -300.0, f64::NAN, f64::INFINITY] {
        let preference = ChecklistKind::ExposurePreference { exposure_seconds, channel: None };
        refused_naming(item(preference).validate(panels), "exposureSeconds");
    }
    for blank in ["", "  "] {
        let integration = ChecklistKind::Integration { channel: blank.into(), goal_seconds: 1 };
        refused_naming(item(integration).validate(panels), "channel");
        let preference = ChecklistKind::ExposurePreference {
            exposure_seconds: 300.0,
            channel: Some(blank.into()),
        };
        refused_naming(item(preference).validate(panels), "channel");
        let calibration = ChecklistKind::MissingCalibration {
            calibration: CalibrationKind::Dark,
            channel: Some(blank.into()),
        };
        refused_naming(item(calibration).validate(panels), "channel");
    }
    refused_naming(item(ChecklistKind::PanelCoverage).validate(&[]), "panels");

    let wire: ChecklistItemInput = serde_json::from_value(serde_json::json!({
        "kind": "integration", "channel": "Ha", "goalSeconds": 36000
    }))
    .unwrap();
    assert_eq!(wire.id, None);
    assert_eq!(
        wire.criterion,
        ChecklistKind::Integration { channel: "Ha".into(), goal_seconds: 36_000 }
    );
    let flats: ChecklistItemInput = serde_json::from_value(serde_json::json!({
        "kind": "missing_calibration", "calibration": "dark_flat"
    }))
    .unwrap();
    assert_eq!(
        flats.criterion,
        ChecklistKind::MissingCalibration { calibration: CalibrationKind::DarkFlat, channel: None }
    );
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct WireSample {
    #[serde(with = "platevault_core::sample_number")]
    value: f64,
}

#[test]
fn sample_number_writes_non_finite_values_as_strings_and_round_trips_each() {
    let cases = [
        (f64::NAN, serde_json::json!("NaN")),
        (f64::INFINITY, serde_json::json!("Infinity")),
        (f64::NEG_INFINITY, serde_json::json!("-Infinity")),
        (1.5, serde_json::json!(1.5)),
        (-0.25, serde_json::json!(-0.25)),
        (65535.0, serde_json::json!(65535.0)),
    ];
    for (value, wire) in cases {
        let written = serde_json::to_value(WireSample { value }).unwrap();
        assert_eq!(written["value"], wire, "{value}");
        let back: WireSample = serde_json::from_value(written).unwrap();
        if value.is_nan() {
            assert!(back.value.is_nan());
        } else {
            assert_eq!(back.value.to_bits(), value.to_bits());
        }
    }
    let integer: WireSample = serde_json::from_value(serde_json::json!({"value": 7})).unwrap();
    assert_eq!(integer.value.to_bits(), 7.0_f64.to_bits());
    assert!(serde_json::from_value::<WireSample>(serde_json::json!({"value": "nan"})).is_err());
    let numbers = serde_json::to_value([SampleNumber(f64::NAN), SampleNumber(2.0)]).unwrap();
    assert_eq!(numbers, serde_json::json!(["NaN", 2.0]));
}

#[test]
fn stretch_validation_refuses_inverted_non_finite_and_out_of_range_points() {
    let linear = |black, white| Stretch::Linear { black, white }.validate();
    refused_naming(linear(10.0, 10.0), "black");
    refused_naming(linear(20.0, 10.0), "black");
    refused_naming(linear(f64::NAN, 10.0), "black");
    refused_naming(linear(0.0, f64::INFINITY), "white");
    let mtf =
        |shadows, midtones, highlights| Stretch::Mtf { shadows, midtones, highlights }.validate();
    refused_naming(mtf(0.0, 0.0, 1.0), "midtones");
    refused_naming(mtf(0.0, 1.0, 1.0), "midtones");
    refused_naming(mtf(0.0, f64::NAN, 1.0), "midtones");
    refused_naming(mtf(0.5, 0.5, 0.5), "shadows");
    refused_naming(mtf(0.6, 0.5, 0.4), "shadows");
    refused_naming(mtf(-0.1, 0.5, 1.0), "shadows");
    refused_naming(mtf(0.0, 0.5, 1.1), "highlights");
    assert!(linear(0.0, 65535.0).is_ok());
    assert!(mtf(0.0, 0.25, 1.0).is_ok());
    assert!(Stretch::Auto.validate().is_ok());
    let parsed: Stretch = serde_json::from_value(serde_json::json!({
        "kind": "mtf", "shadows": 0.0, "midtones": 0.25, "highlights": 1.0
    }))
    .unwrap();
    assert_eq!(parsed, Stretch::Mtf { shadows: 0.0, midtones: 0.25, highlights: 1.0 });
    assert_eq!(serde_json::to_value(Stretch::Auto).unwrap(), serde_json::json!({"kind": "auto"}));
}

fn tile(width: u32, height: u32, level: u8, stretch: Stretch) -> TileRequest {
    TileRequest {
        asset_id: Uuid::nil(),
        sha256: "ab".repeat(32),
        plane: 0,
        level,
        x: 0,
        y: 0,
        width,
        height,
        stretch,
    }
}

#[test]
fn tile_and_sample_requests_refuse_sizes_and_levels_outside_their_bounds() {
    refused_naming(tile(0, 16, 0, Stretch::Auto).validate(), "width");
    refused_naming(tile(1025, 16, 0, Stretch::Auto).validate(), "width");
    refused_naming(tile(16, 0, 0, Stretch::Auto).validate(), "height");
    refused_naming(tile(16, 1025, 0, Stretch::Auto).validate(), "height");
    refused_naming(tile(16, 16, 9, Stretch::Auto).validate(), "level");
    refused_naming(tile(16, 16, 0, Stretch::Linear { black: 1.0, white: 0.0 }).validate(), "black");
    assert!(tile(1024, 1024, 8, Stretch::Auto).validate().is_ok());
    assert!(tile(1, 1, 0, Stretch::Auto).validate().is_ok());
    let sample = |width, height| SampleRequest {
        asset_id: Uuid::nil(),
        sha256: "ab".repeat(32),
        plane: 0,
        x: 0,
        y: 0,
        width,
        height,
    };
    refused_naming(sample(65, 1).validate(), "width");
    refused_naming(sample(1, 0).validate(), "height");
    assert!(sample(64, 64).validate().is_ok());
    let regions = |size| RegionsRequest {
        asset_id: Uuid::nil(),
        sha256: "ab".repeat(32),
        plane: 0,
        size,
        stretch: Stretch::Auto,
    };
    refused_naming(regions(15).validate(), "size");
    refused_naming(regions(1025).validate(), "size");
    assert!(regions(16).validate().is_ok());
}

#[test]
fn imported_values_serialize_as_unverified_imports_beside_built_in_values() {
    let value = ImportedValue {
        import_id: Uuid::from_u128(1),
        asset_id: Uuid::from_u128(2),
        column: "FWHM".into(),
        position: 4,
        label: "FWHM (SubframeSelector)".into(),
        value: Some(2.5),
        raw: "2.500".into(),
        reason: None,
        units: Some(Units::Arcsec),
        units_basis: vec![PreambleEntry { key: "Scale Unit".into(), value: "arcsec".into() }],
        warnings: vec![],
        source: ValueSource::Imported {
            format: ImportFormat::SubframeSelectorCsv,
            module_version: Some("1.9.3".into()),
            psf_type: Some("Moffat4".into()),
        },
        match_state: RowMatch::MatchedPath,
        verification: ImportVerification::Unverified,
        drift: Drift::Matches,
        imported_at: "2026-10-05T00:00:00Z".into(),
    };
    let wire = serde_json::to_value(&value).unwrap();
    assert_eq!(wire["source"]["kind"], "imported");
    assert_eq!(wire["source"]["format"], "subframe_selector_csv");
    assert_eq!(wire["source"]["moduleVersion"], "1.9.3");
    assert_eq!(wire["source"]["psfType"], "Moffat4");
    assert_eq!(wire["verification"], "unverified");
    assert_eq!(wire["match"], "matched_path");
    assert_eq!(wire["drift"], "matches");
    assert_eq!(wire["units"], "arcsec");
    assert_eq!(wire["unitsBasis"][0]["key"], "Scale Unit");
    let back: ImportedValue = serde_json::from_value(wire).unwrap();
    assert_eq!(back, value);
    let built_in = MetricValue::unavailable(
        MetricId::FwhmMedian,
        Units::Px,
        "no_fitted_stars",
        &MeasurementMethod::new("platevault.stars", 1),
    );
    let wire = serde_json::to_value(&built_in).unwrap();
    assert_eq!(
        wire["source"],
        serde_json::json!({"kind": "built_in", "method": "platevault.stars", "version": 1})
    );
    assert_eq!(wire["label"], "FWHM (Gaussian fit)");
    assert_eq!(wire["value"], serde_json::Value::Null);
    assert_eq!(wire["state"], "unavailable");
    assert_eq!(MetricId::HfrMedian.label(), "HFR (half-flux radius)");
    assert_eq!(serde_json::to_value(Units::Electrons).unwrap(), "e-");
}
