use platevault_core::*;
use uuid::Uuid;

fn fingerprint() -> ObservationFingerprint {
    ObservationFingerprint {
        identity: FileIdentity {
            volume: VolumeIdentity {
                filesystem: "test".into(),
                stable_id: Some("volume".into()),
                file_ids_stable: false,
                case: PathSensitivity::Unknown,
                normalization: PathSensitivity::Unknown,
            },
            file_id: None,
        },
        size_bytes: 32,
        modified_ns: 123,
        content_sha256: Some("original-content".into()),
    }
}

#[test]
fn nanosecond_fingerprint_survives_a_javascript_json_roundtrip() {
    let mut observed = fingerprint();
    observed.modified_ns = 1_791_107_852_913_670_014;
    let wire = serde_json::to_value(&observed).unwrap();
    assert_eq!(wire["modifiedNs"], "1791107852913670014");
    let echoed: ObservationFingerprint = serde_json::from_value(wire).unwrap();
    assert_eq!(echoed, observed);
    observed.modified_ns = -1_234_567_890_123_456_789;
    let echoed: ObservationFingerprint =
        serde_json::from_str(&serde_json::to_string(&observed).unwrap()).unwrap();
    assert_eq!(echoed.modified_ns, observed.modified_ns);
}

#[test]
fn changed_content_preserves_prior_rejection_instead_of_reincluding_it() {
    let basis = fingerprint();
    let mut asset = Asset {
        id: Uuid::new_v4(),
        location_id: Uuid::new_v4(),
        relative_path: NativePath::from_path(std::path::Path::new("light.fits")),
        fingerprint: basis.clone(),
        observation_revision: 1,
        decision_revision: 1,
        format: ImageFormat::Fits,
        availability: Availability::Available,
        observed: CaptureMetadata::default(),
        effective: CaptureMetadata::default(),
        quality: Quality::Unusable,
        quality_basis: Some(basis),
        verification_pending: false,
        last_observed_at: "2026-10-04T00:00:00Z".into(),
        last_verified_at: None,
    };
    assert_eq!(asset.applicable_quality(), ApplicableQuality::Unusable);
    asset.fingerprint.content_sha256 = Some("rewritten-same-size-and-mtime".into());
    assert_eq!(
        asset.applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Unusable }
    );
    assert_ne!(asset.applicable_quality(), ApplicableQuality::Unreviewed);
    assert_ne!(asset.applicable_quality(), ApplicableQuality::Usable);
    asset.fingerprint.content_sha256 = None;
    asset.quality_basis.as_mut().unwrap().content_sha256 = None;
    assert_eq!(
        asset.applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Unusable }
    );
}

#[test]
fn filesystem_failures_keep_scope_and_do_not_claim_absence() {
    let path = std::path::Path::new("night/unreadable.fits");
    let denied =
        LibraryError::from_io(path, &std::io::Error::from(std::io::ErrorKind::PermissionDenied));
    let denied = denied.response(None, None);
    assert_eq!(denied.kind, "access_denied");
    assert_eq!(denied.retry, RetryAction::Retry);
    assert_eq!(denied.scope.unwrap().to_path_buf().unwrap(), path);
    let absent = LibraryError::from_io(path, &std::io::Error::from(std::io::ErrorKind::NotFound))
        .response(None, None);
    assert_eq!(absent.kind, "not_found");
    assert_ne!(absent.kind, "missing");
    assert!(matches!(LibraryError::from(sqlx::Error::RowNotFound), LibraryError::NotFound(_)));
}

#[test]
fn unqualified_volume_and_unknown_path_behavior_never_guess_identity() {
    let mut volume = fingerprint().identity.volume;
    volume.stable_id = None;
    assert!(matches!(volume.validate(), Err(LibraryError::IdentityConflict(_))));
    let a = NativePath::from_path(std::path::Path::new("Ha.fits"));
    let b = NativePath::from_path(std::path::Path::new("ha.fits"));
    assert!(!a.same_on(&b, &volume));
    volume.case = PathSensitivity::Insensitive;
    volume.normalization = PathSensitivity::Sensitive;
    assert!(a.same_on(&b, &volume));
}

#[test]
fn windows_utf16_wire_keeps_unpaired_surrogate_payload() {
    let payload = vec![0x43, 0x3a, 0x5c, 0xd800, 0x2e, 0x66, 0x69, 0x74, 0x73];
    let native = NativePath::WindowsUtf16(payload.clone());
    let mut wire = serde_json::to_value(&native).unwrap();
    assert_eq!(wire["encoding"], "windows-utf16");
    assert_eq!(wire["payload"], serde_json::json!(payload));
    wire["display"] = serde_json::json!("not authoritative");
    assert_eq!(serde_json::from_value::<NativePath>(wire).unwrap(), native);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        assert_eq!(
            native.to_path_buf().unwrap().as_os_str().encode_wide().collect::<Vec<_>>(),
            payload
        );
    }
}
