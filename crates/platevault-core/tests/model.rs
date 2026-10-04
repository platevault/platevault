mod support;

use metadata_core::MetadataExtractor;
use platevault_core::{
    CaptureMetadata, FileIdentity, NativePath, ObservationFingerprint, TargetCone, VolumeIdentity,
};

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
