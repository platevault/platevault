mod support;

use metadata_core::MetadataExtractor;
use platevault_core::{
    initial_member_state, ApplicableQuality, CalibrationKind, CandidateFilters, CandidateQuery,
    CaptureMetadata, ChecklistItemInput, ChecklistKind, CriteriaInput, FileIdentity, LibraryError,
    MemberReason, MemberState, NativePath, ObservationFingerprint, PanelInput, ProjectInput,
    ProjectPanel, Quality, SelectionReason, TargetCone, TargetFraming, VolumeIdentity,
    DEFAULT_MIN_FOOTPRINT_COVERAGE, DEFAULT_SUGGESTION_RADIUS_DEG,
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

#[test]
fn initial_member_state_follows_the_d02_table() {
    let included = (MemberState::Included, MemberReason::Initial);
    assert_eq!(initial_member_state(&ApplicableQuality::Unreviewed), included);
    assert_eq!(initial_member_state(&ApplicableQuality::Usable), included);
    assert_eq!(
        initial_member_state(&ApplicableQuality::Unusable),
        (MemberState::Excluded, MemberReason::LibraryUnusable)
    );
    for quality in [
        ApplicableQuality::ChangedContent { previous: Quality::Usable },
        ApplicableQuality::VerificationPending { previous: Quality::Unusable },
        ApplicableQuality::Conflicting,
        ApplicableQuality::ConflictingCopies,
    ] {
        assert_eq!(
            initial_member_state(&quality),
            (MemberState::Excluded, MemberReason::QualityNeedsReview { quality }),
            "{quality:?} starts excluded naming the state"
        );
    }
}

#[test]
fn criteria_input_accepts_its_closed_bounds_and_refuses_everything_outside() {
    let defaults: CriteriaInput = serde_json::from_value(serde_json::json!({})).unwrap();
    assert_eq!(defaults, CriteriaInput::default());
    assert_eq!((defaults.min_footprint_coverage, defaults.suggestion_radius_deg), (0.5, 2.0));
    assert_eq!((DEFAULT_MIN_FOOTPRINT_COVERAGE, DEFAULT_SUGGESTION_RADIUS_DEG), (0.5, 2.0));
    let input = |coverage, radius| CriteriaInput {
        min_footprint_coverage: coverage,
        suggestion_radius_deg: radius,
    };
    input(1.0, 180.0).validate().unwrap();
    input(1e-9, 1e-9).validate().unwrap();
    for coverage in [0.0, -0.1, 1.000_001, f64::NAN, f64::INFINITY] {
        refused_naming(input(coverage, 2.0).validate(), "minFootprintCoverage");
    }
    for radius in [0.0, -1.0, 180.000_1, f64::NAN, f64::NEG_INFINITY] {
        refused_naming(input(0.5, radius).validate(), "suggestionRadiusDeg");
    }
}

#[test]
fn candidate_filters_and_query_refuse_inverted_ranges_blank_text_and_bad_pages() {
    CandidateFilters::default().validate().unwrap();
    let cases = [
        (
            CandidateFilters {
                exposure_min: Some(300.0),
                exposure_max: Some(60.0),
                ..Default::default()
            },
            "exposure",
        ),
        (
            CandidateFilters { gain_min: Some(200.0), gain_max: Some(100.0), ..Default::default() },
            "gain",
        ),
        (
            CandidateFilters { offset_min: Some(50), offset_max: Some(10), ..Default::default() },
            "offset",
        ),
        (
            CandidateFilters {
                date_from: Some("2026-09-30".into()),
                date_to: Some("2026-09-12".into()),
                ..Default::default()
            },
            "date",
        ),
        (
            CandidateFilters {
                set_temperature_min: Some(-5.0),
                set_temperature_max: Some(-10.0),
                ..Default::default()
            },
            "setTemperature",
        ),
        (CandidateFilters { object_text: Some("  ".into()), ..Default::default() }, "objectText"),
        (CandidateFilters { exposure_min: Some(f64::NAN), ..Default::default() }, "exposureMin"),
    ];
    for (filters, field) in cases {
        refused_naming(filters.validate(), field);
    }
    // Equal bounds are a range of one value, not an inversion.
    CandidateFilters { exposure_min: Some(300.0), exposure_max: Some(300.0), ..Default::default() }
        .validate()
        .unwrap();

    let query =
        |value: serde_json::Value| -> CandidateQuery { serde_json::from_value(value).unwrap() };
    query(serde_json::json!({"membership": "draft", "limit": 50, "sort": {"key": "skyDistance"}}))
        .validate()
        .unwrap();
    refused_naming(
        query(serde_json::json!({"membership": "draft", "limit": 0})).validate(),
        "limit",
    );
    refused_naming(
        query(serde_json::json!({"membership": "draft", "limit": 50, "sort": {"key": "object", "direction": "desc"}}))
            .validate(),
        "sort key",
    );
}

#[test]
fn manual_select_matching_and_origin_choices_are_pinned_and_criteria_choices_are_not() {
    assert!(SelectionReason::Manual.is_pinned());
    assert!(SelectionReason::SelectMatching { filters: Box::default() }.is_pinned());
    assert!(SelectionReason::OriginSessions.is_pinned());
    assert!(!SelectionReason::GeometrySuggestion.is_pinned());
    assert!(!SelectionReason::RefreshMatch { review_id: Uuid::nil() }.is_pinned());
}

/// R30: footprint-sized geometry comes from declared dimensions over small
/// data, read back unchanged by both header readers.
#[test]
fn declared_footprint_geometry_reads_back_through_both_header_readers() {
    let dir = tempfile::tempdir().unwrap();
    let fits = dir.path().join("geometry.fits");
    let xisf = dir.path().join("geometry.xisf");
    let fields = [
        ("IMAGETYP", "'LIGHT'"),
        ("FOCALLEN", "250"),
        ("XPIXSZ", "3.76"),
        ("XBINNING", "1"),
        ("RA", "314.75"),
        ("DEC", "44.5"),
        ("OBJCTROT", "12.5"),
        ("CTYPE1", "'RA---TAN'"),
        ("CTYPE2", "'DEC--TAN'"),
        ("CRVAL1", "314.7"),
        ("CRVAL2", "44.6"),
        ("CD1_1", "0.000743"),
        ("CD2_1", "0.0"),
    ];
    support::fits_sized(&fits, (6248, 4176), &fields).unwrap();
    support::xisf_sized(&xisf, (6248, 4176), &fields).unwrap();
    let before = [support::digest(&fits), support::digest(&xisf)];
    let extractors: [(&std::path::Path, &dyn MetadataExtractor); 2] =
        [(&fits, &metadata_fits::FitsExtractor), (&xisf, &metadata_xisf::XisfExtractor)];
    for (path, extractor) in extractors {
        let metadata = CaptureMetadata::from(&extractor.extract(path).unwrap().unwrap());
        let label = path.display();
        assert_eq!((metadata.width, metadata.height), (Some(6248), Some(4176)), "{label}");
        assert_eq!(metadata.focal_length_mm, Some(250.0), "{label}");
        assert_eq!(metadata.pixel_size_um, Some(3.76), "{label}");
        assert_eq!(metadata.binning_x, Some(1), "{label}");
        assert_eq!((metadata.ra_deg, metadata.dec_deg), (Some(314.75), Some(44.5)), "{label}");
        assert_eq!(
            (metadata.wcs_ra_deg, metadata.wcs_dec_deg),
            (Some(314.7), Some(44.6)),
            "{label}"
        );
        // The WCS rotation wins over OBJCTROT as the sky position angle.
        assert_eq!(metadata.sky_rotation_deg, Some(0.0), "{label}");
    }
    assert_eq!(before, [support::digest(&fits), support::digest(&xisf)]);
}
