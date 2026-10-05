mod support;

use metadata_core::MetadataExtractor;
use platevault_core::{
    AppClosedDelivery, BlockReason, CalibrationKind, CaptureMetadata, ChecklistItemInput,
    ChecklistKind, Darkness, DeliveryState, ExportSelection, FileIdentity, LibraryError,
    MoonCriterion, NativePath, NightPlan, NoWindowReason, ObservationFingerprint, ObservingWindow,
    PanelInput, PermissionState, PlanCriteria, ProjectInput, ProjectPanel, RecoveryAction,
    ReminderDelivery, ReminderInput, ReminderStatus, ReminderSubscription, SiteBasis, SiteInput,
    SubscriptionState, TargetCone, TargetFraming, UnavailableReason, UpcomingReminder,
    VolumeIdentity, WindowBasis, WindowKey, WindowQuery, WindowSet,
};
use time::macros::{date, datetime, offset};
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

fn backyard() -> SiteInput {
    SiteInput {
        name: "Backyard".into(),
        latitude_deg: 52.09,
        longitude_deg: 5.12,
        elevation_m: Some(5.0),
        time_zone: "Europe/Amsterdam".into(),
    }
}

fn criteria() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::MinSeparation { min_separation_deg: 30.0 },
        min_duration_minutes: 60,
    }
}

#[test]
fn site_input_refuses_blank_names_out_of_range_coordinates_and_empty_zones() {
    assert!(backyard().validate().is_ok());
    assert!(SiteInput { elevation_m: None, ..backyard() }.validate().is_ok());
    for (latitude_deg, longitude_deg) in [(-90.0, -180.0), (90.0, 180.0)] {
        assert!(SiteInput { latitude_deg, longitude_deg, ..backyard() }.validate().is_ok());
    }
    for name in ["", "   "] {
        refused_naming(SiteInput { name: name.into(), ..backyard() }.validate(), "name");
    }
    for latitude_deg in [90.5, -90.5, f64::NAN, f64::INFINITY] {
        refused_naming(SiteInput { latitude_deg, ..backyard() }.validate(), "latitudeDeg");
    }
    for longitude_deg in [180.5, -180.5, f64::NAN] {
        refused_naming(SiteInput { longitude_deg, ..backyard() }.validate(), "longitudeDeg");
    }
    for elevation in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let site = SiteInput { elevation_m: Some(elevation), ..backyard() };
        refused_naming(site.validate(), "elevationM");
    }
    for zone in ["", "  "] {
        refused_naming(SiteInput { time_zone: zone.into(), ..backyard() }.validate(), "timeZone");
    }
}

#[test]
fn plan_criteria_refuse_out_of_range_values_and_fill_in_no_default() {
    assert!(criteria().validate().is_ok());
    for moon in [MoonCriterion::None, MoonCriterion::BelowHorizon] {
        assert!(PlanCriteria { moon, ..criteria() }.validate().is_ok());
    }
    for (min_altitude_deg, min_duration_minutes) in [(0.0, 1), (89.9, 1440)] {
        let edge = PlanCriteria { min_altitude_deg, min_duration_minutes, ..criteria() };
        assert!(edge.validate().is_ok());
    }
    for min_altitude_deg in [90.0, -0.5, f64::NAN] {
        let refused = PlanCriteria { min_altitude_deg, ..criteria() };
        refused_naming(refused.validate(), "minAltitudeDeg");
    }
    for min_duration_minutes in [0, 1441] {
        let refused = PlanCriteria { min_duration_minutes, ..criteria() };
        refused_naming(refused.validate(), "minDurationMinutes");
    }
    for min_separation_deg in [0.0, 180.0, f64::NAN] {
        let moon = MoonCriterion::MinSeparation { min_separation_deg };
        refused_naming(PlanCriteria { moon, ..criteria() }.validate(), "minSeparationDeg");
    }

    let full = serde_json::json!({
        "minAltitudeDeg": 30.0,
        "darkness": "astronomical",
        "moon": {"kind": "min_separation", "minSeparationDeg": 30.0},
        "minDurationMinutes": 60
    });
    assert_eq!(serde_json::from_value::<PlanCriteria>(full.clone()).unwrap(), criteria());
    for field in ["minAltitudeDeg", "darkness", "moon", "minDurationMinutes"] {
        let mut partial = full.clone();
        partial.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<PlanCriteria>(partial).is_err(), "{field} defaulted");
    }
    let unbounded = serde_json::json!({"kind": "min_separation"});
    assert!(serde_json::from_value::<MoonCriterion>(unbounded).is_err());
}

#[test]
fn reminder_input_needs_explicit_criteria_and_a_lead_time_within_one_day() {
    let input = ReminderInput { target_id: Uuid::new_v4(), criteria: criteria(), lead_minutes: 60 };
    assert!(input.validate().is_ok());
    for lead_minutes in [1, 1440] {
        assert!(ReminderInput { lead_minutes, ..input.clone() }.validate().is_ok());
    }
    for lead_minutes in [0, 1441] {
        refused_naming(ReminderInput { lead_minutes, ..input.clone() }.validate(), "leadMinutes");
    }
    let low = PlanCriteria { min_altitude_deg: -1.0, ..criteria() };
    refused_naming(ReminderInput { criteria: low, ..input }.validate(), "minAltitudeDeg");

    let wire = serde_json::to_value(&input).unwrap();
    assert_eq!(serde_json::from_value::<ReminderInput>(wire.clone()).unwrap(), input);
    for field in ["leadMinutes", "criteria"] {
        let mut partial = wire.clone();
        partial.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<ReminderInput>(partial).is_err(), "{field} defaulted");
    }
}

#[test]
fn window_queries_cover_one_to_366_nights_and_exports_name_a_window() {
    let (target, site) = (Uuid::new_v4(), Uuid::new_v4());
    let query = WindowQuery {
        target_id: target,
        site_id: site,
        first_night: date!(2026 - 10 - 20),
        nights: 30,
        criteria: criteria(),
    };
    assert!(query.validate().is_ok());
    for nights in [1, 366] {
        assert!(WindowQuery { nights, ..query.clone() }.validate().is_ok());
    }
    for nights in [0, 367] {
        refused_naming(WindowQuery { nights, ..query.clone() }.validate(), "nights");
    }
    let wire = serde_json::to_value(&query).unwrap();
    assert_eq!(wire["firstNight"], "2026-10-20");
    assert_eq!(serde_json::from_value::<WindowQuery>(wire).unwrap(), query);

    let empty = ExportSelection { query: query.clone(), window_keys: Vec::new() };
    refused_naming(empty.validate(), "windowKeys");
    let key = WindowKey::new(target, site, datetime!(2026-10-20 19:31 UTC)).unwrap();
    assert!(ExportSelection { query, window_keys: vec![key] }.validate().is_ok());
}

#[test]
fn window_keys_are_whole_minute_utc_identities_with_one_text_form() {
    let (target, site) = (Uuid::new_v4(), Uuid::new_v4());
    let key = WindowKey::new(target, site, datetime!(2026-10-25 01:31 +02:00)).unwrap();
    assert_eq!(key.start_utc(), datetime!(2026-10-24 23:31 UTC));
    assert_eq!(key.start_utc().offset(), offset!(UTC));
    assert_eq!((key.target_id(), key.site_id()), (target, site));
    let text = key.to_string();
    assert_eq!(text, format!("{target}/{site}/2026-10-24T23:31Z"));
    assert_eq!(text.parse::<WindowKey>().unwrap(), key);
    assert_eq!(serde_json::to_value(key).unwrap(), serde_json::json!(text));
    assert_eq!(serde_json::from_value::<WindowKey>(serde_json::json!(text)).unwrap(), key);
    let same = WindowKey::new(target, site, datetime!(2026-10-24 23:31 UTC)).unwrap();
    assert_eq!(same, key);

    refused_naming(
        WindowKey::new(target, site, datetime!(2026-10-20 19:31:30 UTC)).map(drop),
        "windowKey",
    );
    for malformed in ["", "x/y/z", &format!("{target}/{site}/2026-10-24T23:31:30Z")] {
        assert!(malformed.parse::<WindowKey>().is_err(), "{malformed:?}");
    }
}

fn window(target: Uuid, site: Uuid) -> ObservingWindow {
    ObservingWindow {
        key: WindowKey::new(target, site, datetime!(2026-10-24 22:01 UTC)).unwrap(),
        start_utc: datetime!(2026-10-24 22:01 UTC),
        end_utc: datetime!(2026-10-25 01:30 UTC),
        start_local: datetime!(2026-10-25 00:01 +02:00),
        end_local: datetime!(2026-10-25 02:30 +01:00),
        time_zone: "Europe/Amsterdam".into(),
        duration_minutes: 209,
        night: date!(2026 - 10 - 24),
        site_name: "Backyard".into(),
    }
}

/// Every object key in a JSON document, recursively.
fn keys(value: &serde_json::Value, into: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                into.push(key.clone());
                keys(value, into);
            }
        }
        serde_json::Value::Array(items) => items.iter().for_each(|item| keys(item, into)),
        _ => {}
    }
}

fn assert_astronomical_only(value: &serde_json::Value) {
    let mut names = Vec::new();
    keys(value, &mut names);
    for name in names {
        let lower = name.to_lowercase();
        for claim in ["weather", "equipment", "readiness", "availability", "account"] {
            assert!(!lower.contains(claim), "{name} claims {claim}");
        }
        assert!(!name.contains('_'), "{name} is not camelCase");
    }
}

#[test]
fn planning_wire_types_round_trip_in_camel_case_and_claim_only_astronomy() {
    let (target, site) = (Uuid::new_v4(), Uuid::new_v4());
    let windows = WindowSet {
        basis: WindowBasis {
            target_id: target,
            target_revision: 2,
            designation: "NGC 7000".into(),
            site: SiteBasis {
                id: site,
                name: "Backyard".into(),
                revision: 1,
                latitude_deg: 52.09,
                longitude_deg: 5.12,
                elevation_m: Some(5.0),
            },
            time_zone: "Europe/Amsterdam".into(),
            criteria: criteria(),
            method: "skymath 0.7.2, geometric, no refraction".into(),
        },
        nights: vec![
            NightPlan {
                night: date!(2026 - 10 - 24),
                windows: vec![window(target, site)],
                no_window_reason: None,
            },
            NightPlan {
                night: date!(2026 - 10 - 25),
                windows: Vec::new(),
                no_window_reason: Some(NoWindowReason::MoonExcluded),
            },
        ],
        unavailable_reason: None,
    };
    let wire = serde_json::to_value(&windows).unwrap();
    let first = &wire["nights"][0]["windows"][0];
    assert_eq!(first["startLocal"], "2026-10-25T00:01:00+02:00");
    assert_eq!(first["endLocal"], "2026-10-25T02:30:00+01:00");
    assert_eq!(first["startUtc"], "2026-10-24T22:01:00Z");
    assert_eq!(wire["nights"][1]["noWindowReason"], "moon_excluded");
    assert_astronomical_only(&wire);
    assert_eq!(serde_json::from_value::<WindowSet>(wire).unwrap(), windows);
}

#[test]
fn reminder_wire_types_name_permission_states_and_never_claim_delivery() {
    let (target, site) = (Uuid::new_v4(), Uuid::new_v4());
    let unavailable = PermissionState::Unavailable { reason: UnavailableReason::UnbundledProcess };
    let wire = serde_json::to_value(unavailable).unwrap();
    assert_eq!(wire, serde_json::json!({"state": "unavailable", "reason": "unbundled_process"}));
    assert_eq!(serde_json::from_value::<PermissionState>(wire).unwrap(), unavailable);
    let denied = serde_json::to_value(PermissionState::NotDetermined).unwrap();
    assert_eq!(denied, serde_json::json!({"state": "not_determined"}));

    let key = window(target, site).key;
    let status = ReminderStatus {
        scheduler_running: false,
        permission: PermissionState::Denied,
        app_closed_delivery: AppClosedDelivery::UNAVAILABLE,
        subscriptions: vec![ReminderSubscription {
            target_id: target,
            site_id: site,
            site_name: "Backyard".into(),
            site_revision: 1,
            settings_revision: 1,
            criteria: criteria(),
            lead_minutes: 1440,
            state: SubscriptionState::Blocked,
            block_reason: Some(BlockReason::PermissionDenied),
            actions: BlockReason::PermissionDenied.actions(),
            revision: 1,
            activated_at: "2026-10-20T10:00:00Z".into(),
            updated_at: "2026-10-20T10:00:00Z".into(),
        }],
        upcoming: vec![UpcomingReminder {
            target_id: target,
            designation: "NGC 7000".into(),
            site_id: site,
            site_name: "Backyard".into(),
            window_key: key,
            due_at: datetime!(2026-10-23 22:01 UTC),
            start_utc: datetime!(2026-10-24 22:01 UTC),
            end_utc: datetime!(2026-10-25 01:30 UTC),
            start_local: datetime!(2026-10-25 00:01 +02:00),
            end_local: datetime!(2026-10-25 02:30 +01:00),
            time_zone: "Europe/Amsterdam".into(),
            night: date!(2026 - 10 - 24),
            lead_minutes: 1440,
        }],
        deliveries: vec![ReminderDelivery {
            window_key: key,
            target_id: target,
            site_id: site,
            site_name: "Backyard".into(),
            window_start_utc: datetime!(2026-10-24 22:01 UTC),
            window_end_utc: datetime!(2026-10-25 01:30 UTC),
            night: date!(2026 - 10 - 24),
            due_at: datetime!(2026-10-23 22:01 UTC),
            state: DeliveryState::Uncertain,
            reason: None,
            created_at: "2026-10-23T22:01:05Z".into(),
            updated_at: "2026-10-23T22:01:05Z".into(),
        }],
    };
    let wire = serde_json::to_value(&status).unwrap();
    assert_eq!(
        wire["appClosedDelivery"],
        serde_json::json!({"available": false, "reason": "no_installed_scheduler"})
    );
    assert_eq!(wire["subscriptions"][0]["state"], "blocked");
    assert_eq!(wire["subscriptions"][0]["actions"], serde_json::json!(["settings", "retry"]));
    assert_eq!(wire["deliveries"][0]["state"], "uncertain");
    assert_eq!(wire["upcoming"][0]["windowKey"], serde_json::json!(key.to_string()));
    assert_astronomical_only(&wire);
    assert_eq!(serde_json::from_value::<ReminderStatus>(wire).unwrap(), status);
    assert_eq!(BlockReason::UnbundledProcess.actions(), vec![RecoveryAction::Retry]);
    assert_eq!(PermissionState::Granted.block_reason(), None);
    assert_eq!(PermissionState::Denied.block_reason(), Some(BlockReason::PermissionDenied));
    assert_eq!(unavailable.block_reason(), Some(BlockReason::UnbundledProcess));
}
