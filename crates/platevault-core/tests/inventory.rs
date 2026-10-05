// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Observable inventory and grouping boundaries on real generated FITS/XISF
//! files: progressive read-only scans, uncertain scopes that never prove
//! absence, fail-closed identity, and canonical homogeneous grouping.

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use metadata_core::MetadataExtractor;
use platevault_core::*;
use platevault_core::{grouping, inventory};
use uuid::Uuid;

const LIGHT: [(&str, &str); 12] = [
    ("IMAGETYP", "'LIGHT'"),
    ("FILTER", "'Ha'"),
    ("EXPTIME", "300"),
    ("GAIN", "100"),
    ("OFFSET", "50"),
    ("XBINNING", "1"),
    ("YBINNING", "1"),
    ("INSTRUME", "'ASI2600MM'"),
    ("TELESCOP", "'RedCat 51'"),
    ("FOCALLEN", "250"),
    ("SET-TEMP", "-10"),
    ("DATE-LOC", "'2026-09-12T23:10:00'"),
];

fn with(overrides: &[(&'static str, &'static str)]) -> Vec<(&'static str, &'static str)> {
    let mut fields: Vec<_> =
        LIGHT.iter().copied().filter(|(key, _)| overrides.iter().all(|(o, _)| o != key)).collect();
    fields.extend(overrides.iter().copied().filter(|(_, value)| !value.is_empty()));
    fields
}

/// Effective metadata exactly as the shared FITS adapter reads it.
fn header(fields: &[(&str, &str)]) -> CaptureMetadata {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("frame.fits");
    support::fits(&path, fields).unwrap();
    CaptureMetadata::from(&metadata_fits::FitsExtractor.extract(&path).unwrap().unwrap())
}

fn asset(effective: CaptureMetadata) -> Asset {
    let fingerprint = ObservationFingerprint {
        identity: FileIdentity {
            volume: VolumeIdentity {
                filesystem: "apfs".into(),
                stable_id: Some("VOLUME".into()),
                file_ids_stable: false,
                case: PathSensitivity::Unknown,
                normalization: PathSensitivity::Unknown,
            },
            file_id: None,
        },
        size_bytes: 5760,
        modified_ns: 1,
        content_sha256: None,
    };
    Asset {
        id: Uuid::new_v4(),
        location_id: Uuid::nil(),
        relative_path: rel("frame.fits"),
        fingerprint,
        observation_revision: 1,
        decision_revision: 1,
        format: ImageFormat::Fits,
        availability: Availability::Available,
        observed: effective.clone(),
        effective,
        quality: Quality::Unreviewed,
        quality_basis: None,
        verification_pending: false,
        last_observed_at: "2026-10-04T00:00:00Z".into(),
        last_verified_at: None,
    }
}

fn rel(path: &str) -> NativePath {
    NativePath::from_path(Path::new(path))
}

fn session_of(result: &GroupingResult, id: Uuid) -> &SessionCandidate {
    result
        .sessions
        .iter()
        .find(|session| session.asset_ids.contains(&id))
        .expect("every asset is grouped")
}

#[test]
fn channels_exposure_camera_and_settings_split_while_object_and_jitter_do_not() {
    let base = asset(header(&LIGHT));
    let jitter = asset(header(&with(&[
        ("OBJECT", "'NGC 7000'"),
        ("CCD-TEMP", "-9.6"),
        ("ROTATANG", "90.4"),
        ("RA", "314.7"),
        ("DEC", "44.3"),
    ])));
    let other_label = asset(header(&with(&[
        ("OBJECT", "'IC 5070'"),
        ("CCD-TEMP", "-10.4"),
        ("ROTATANG", "89.7"),
    ])));
    let splits = [
        asset(header(&with(&[("FILTER", "'OIII'")]))),
        asset(header(&with(&[("EXPTIME", "180")]))),
        asset(header(&with(&[("INSTRUME", "'ASI294MC'")]))),
        asset(header(&with(&[("SET-TEMP", "-20")]))),
        asset(header(&with(&[("GAIN", "0")]))),
        asset(header(&with(&[("OFFSET", "30")]))),
        asset(header(&with(&[("XBINNING", "2"), ("YBINNING", "2")]))),
        asset(header(&with(&[("TELESCOP", "'Esprit 100'"), ("FOCALLEN", "550")]))),
    ];
    let mut assets = vec![base.clone(), jitter.clone(), other_label.clone()];
    assets.extend(splits.iter().cloned());

    let result = grouping::group_assets(&assets);

    assert_eq!(result.sessions.len(), 1 + splits.len());
    let session = session_of(&result, base.id);
    let mut expected = vec![base.id, jitter.id, other_label.id];
    expected.sort();
    assert_eq!(session.asset_ids, expected);
    assert_eq!(session.date_basis.as_deref(), Some(grouping::BASIS_DATE_LOC));
    for label in ["NGC", "IC 5070", "9.6", "90.4", "314.7"] {
        assert!(!session.key.0.contains(label), "{label} leaked into {}", session.key.0);
    }
    for split in &splits {
        assert_eq!(session_of(&result, split.id).asset_ids, vec![split.id]);
    }
}

#[test]
fn equivalent_numeric_spellings_and_setpoints_share_one_canonical_key() {
    let plain = asset(header(&LIGHT));
    let decimals = asset(header(&with(&[
        ("EXPTIME", "300.0"),
        ("GAIN", "100.00"),
        ("SET-TEMP", "-10.0"),
        ("FOCALLEN", "250.000"),
        ("FILTER", "'Ha      '"),
    ])));
    let exponent = asset(header(&with(&[("EXPTIME", "3.0E2"), ("SET-TEMP", "-1.0E1")])));
    let zero = asset(header(&with(&[("SET-TEMP", "0")])));
    let negative_zero = asset(header(&with(&[("SET-TEMP", "-0.0")])));

    let result = grouping::group_assets(&[
        plain.clone(),
        decimals.clone(),
        exponent.clone(),
        zero.clone(),
        negative_zero.clone(),
    ]);

    assert_eq!(result.sessions.len(), 2);
    let session = session_of(&result, plain.id);
    assert!(session.asset_ids.contains(&decimals.id) && session.asset_ids.contains(&exponent.id));
    assert!(session.key.0.contains("|exposure_s=300|"), "{}", session.key.0);
    assert!(session.key.0.contains("|set_temp_c=-10"), "{}", session.key.0);
    let zero_session = session_of(&result, zero.id);
    assert!(zero_session.asset_ids.contains(&negative_zero.id));
    assert!(zero_session.key.0.ends_with("|set_temp_c=0"), "{}", zero_session.key.0);
}

#[test]
fn header_night_uses_local_noon_then_longitude_then_provisional_utc() {
    let evening = asset(header(&with(&[("DATE-LOC", "'2026-09-12T23:10:00'")])));
    let small_hours = asset(header(&with(&[("DATE-LOC", "'2026-09-13T03:40:00.250'")])));
    let next_afternoon = asset(header(&with(&[("DATE-LOC", "'2026-09-13T12:30:00'")])));
    // 02:00 UTC at 120°E is 10:00 mean solar time: still the night of the 12th.
    let longitude = asset(header(&with(&[
        ("DATE-LOC", ""),
        ("DATE-OBS", "'2026-09-13T02:00:00'"),
        ("SITELONG", "120"),
    ])));
    let utc_only = asset(header(&with(&[("DATE-LOC", ""), ("DATE-OBS", "'2026-09-13T02:00:00'")])));

    let result = grouping::group_assets(&[
        evening.clone(),
        small_hours.clone(),
        next_afternoon.clone(),
        longitude.clone(),
        utc_only.clone(),
    ]);

    let night = session_of(&result, evening.id);
    assert!(night.asset_ids.contains(&small_hours.id));
    assert!(night.key.0.contains("|night=2026-09-12@date-loc-noon|"), "{}", night.key.0);
    assert!(
        night.provisional.iter().all(|note| !note.starts_with("night")),
        "{:?}",
        night.provisional
    );
    assert!(session_of(&result, next_afternoon.id)
        .key
        .0
        .contains("|night=2026-09-13@date-loc-noon|"));

    let solar = session_of(&result, longitude.id);
    assert_eq!(solar.date_basis.as_deref(), Some(grouping::BASIS_LONGITUDE));
    assert!(
        solar.key.0.contains("|night=2026-09-12@longitude-mean-solar-noon|"),
        "{}",
        solar.key.0
    );

    let provisional = session_of(&result, utc_only.id);
    assert_eq!(provisional.asset_ids, vec![utc_only.id]);
    assert_eq!(provisional.date_basis.as_deref(), Some(grouping::BASIS_UTC));
    assert!(provisional.key.0.contains("|night=2026-09-13@utc-date-provisional|"));
    assert!(provisional.provisional.iter().any(|note| note.contains("provisional UTC date")));
}

#[test]
fn unknown_or_invalid_evidence_stays_explicit_without_clock_or_zero_fallback() {
    let undated = asset(header(&with(&[("DATE-LOC", "")])));
    let invalid_date = asset(header(&with(&[("DATE-LOC", "'yesterday evening'")])));
    let invalid_exposure = asset(header(&with(&[("EXPTIME", "'abc'")])));
    let zero_exposure = asset(header(&with(&[("EXPTIME", "0")])));
    let no_exposure = asset(header(&with(&[("EXPTIME", "")])));

    let result = grouping::group_assets(&[
        undated.clone(),
        invalid_date.clone(),
        invalid_exposure.clone(),
        zero_exposure.clone(),
        no_exposure.clone(),
    ]);

    let undated = session_of(&result, undated.id);
    assert!(undated.key.0.contains("|night?|"), "{}", undated.key.0);
    assert_eq!(undated.date_basis, None);
    assert!(undated.provisional.iter().any(|note| note.starts_with("night: unknown")));
    let invalid_date = session_of(&result, invalid_date.id);
    assert!(invalid_date.key.0.contains("|night?|"));
    assert!(invalid_date.provisional.iter().any(|note| note.contains("yesterday evening")));

    let invalid = session_of(&result, invalid_exposure.id);
    assert!(invalid.key.0.contains("|exposure_s?|"), "{}", invalid.key.0);
    assert!(
        invalid.provisional.iter().any(|note| note.contains("EXPTIME=\"abc\"")),
        "{:?}",
        invalid.provisional
    );
    let zero = session_of(&result, zero_exposure.id);
    assert!(zero.key.0.contains("|exposure_s=0|"));
    assert_ne!(zero.key, invalid.key);
    let absent = session_of(&result, no_exposure.id);
    assert!(absent
        .provisional
        .iter()
        .any(|note| note == "exposure_s: unknown; header EXPTIME is absent"));
}

#[test]
fn grouping_is_input_order_independent_and_follows_effective_corrections() {
    let ha = asset(header(&LIGHT));
    let oiii = asset(header(&with(&[("FILTER", "'OIII'")])));
    let mut corrected = asset(header(&LIGHT));
    corrected.effective.filter = Some("OIII".into());
    // Text containing the field separator must not forge another field.
    let mut forged = asset(header(&with(&[("INSTRUME", "")])));
    forged.effective.filter = Some("Ha|camera=ASI2600MM".into());

    let forward =
        grouping::group_assets(&[ha.clone(), oiii.clone(), corrected.clone(), forged.clone()]);
    let reverse =
        grouping::group_assets(&[forged.clone(), corrected.clone(), oiii.clone(), ha.clone()]);

    let shape = |result: &GroupingResult| {
        result
            .sessions
            .iter()
            .map(|session| (session.key.clone(), session.asset_ids.clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(shape(&forward), shape(&reverse));
    let channel = session_of(&forward, oiii.id);
    assert!(channel.asset_ids.contains(&corrected.id));
    assert_eq!(session_of(&forward, ha.id).asset_ids, vec![ha.id]);
    assert_eq!(session_of(&forward, forged.id).asset_ids, vec![forged.id]);
    assert_eq!(corrected.observed.filter.as_deref(), Some("Ha"), "observed evidence is untouched");
}

// ── Inventory ────────────────────────────────────────────────────────────────

fn location(root: &Path) -> Location {
    Location {
        id: Uuid::new_v4(),
        name: "Captures".into(),
        path: NativePath::from_path(root),
        role: LocationRole::Captures,
        identity: inventory::observe_root_identity(root)
            .expect("host temp volume identity qualifies"),
        decision_revision: 1,
        availability: Availability::Available,
        last_observed_at: None,
        lifecycle: LocationLifecycle::Active,
    }
}

fn run(
    location: &Location,
    options: &ScanOptions,
) -> (Result<ScanObservation, LibraryError>, Vec<ScanBatch>) {
    let mut batches = Vec::new();
    let result = inventory::scan(
        location,
        options,
        |batch| {
            batches.push(batch);
            Ok(())
        },
        &AtomicBool::new(false),
    );
    (result, batches)
}

fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

/// Every entry below `root` (no links followed) with its bytes' digest.
fn snapshot(root: &Path) -> BTreeMap<PathBuf, String> {
    let mut entries = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        for entry in std::fs::read_dir(&directory).unwrap() {
            let path = entry.unwrap().path();
            let meta = std::fs::symlink_metadata(&path).unwrap();
            if meta.is_dir() {
                stack.push(path.clone());
                entries.insert(path, "dir".into());
            } else if meta.is_file() {
                entries.insert(path.clone(), support::digest(&path));
            } else {
                entries.insert(
                    path.clone(),
                    format!("link:{}", std::fs::read_link(&path).unwrap().display()),
                );
            }
        }
    }
    entries
}

fn issue_at<'a>(observation: &'a ScanObservation, path: &str) -> &'a ScanIssue {
    observation
        .issues
        .iter()
        .find(|issue| issue.relative_path == rel(path))
        .unwrap_or_else(|| panic!("no issue at {path}: {:?}", observation.issues))
}

fn file_at<'a>(observation: &'a ScanObservation, path: &NativePath) -> &'a ScanFile {
    observation
        .files
        .iter()
        .find(|file| &file.relative_path == path)
        .unwrap_or_else(|| panic!("{} not observed", path.display()))
}

/// Real FITS/XISF frames, a non-image, a malformed header and a name that a
/// lossy path conversion would alter. Returns that name.
fn capture_tree(root: &Path) -> PathBuf {
    std::fs::create_dir_all(root.join("night1")).unwrap();
    let wcs = with(&[
        ("CTYPE1", "'RA---TAN'"),
        ("CTYPE2", "'DEC--TAN'"),
        ("CRVAL1", "314.68"),
        ("CRVAL2", "44.53"),
        ("OBJECT", "'NGC 7000'"),
    ]);
    support::fits(&root.join("night1/ha_001.fits"), &wcs).unwrap();
    support::xisf(&root.join("night1/oiii_001.xisf"), &with(&[("FILTER", "'OIII'")])).unwrap();
    std::fs::write(root.join("night1/notes.txt"), b"seeing 2.1").unwrap();
    std::fs::write(root.join("broken.fits"), [0_u8; 2880]).unwrap();
    // Linux filesystems accept arbitrary bytes; APFS and NTFS require Unicode,
    // so there a decomposed (NFD) name proves no normalization on the way in.
    #[cfg(target_os = "linux")]
    let odd_name = {
        use std::os::unix::ffi::OsStringExt;
        PathBuf::from(std::ffi::OsString::from_vec(b"night1/\xffdark.fits".to_vec()))
    };
    #[cfg(not(target_os = "linux"))]
    let odd_name = PathBuf::from("night1/Ne\u{301}buleuse-dark.fits");
    support::fits(&root.join(&odd_name), &with(&[("IMAGETYP", "'DARK'")])).unwrap();
    odd_name
}

/// A malformed header is a per-file issue that is never absent, while the
/// readable rest of the tree still proves absence.
fn assert_malformed_file_is_uncertain(observation: &ScanObservation) {
    let broken = issue_at(observation, "broken.fits");
    assert!(broken.reason.starts_with("metadata unreadable"), "{}", broken.reason);
    assert_eq!(broken.availability, Availability::Unreadable);
    let progress = &observation.progress;
    assert_eq!((progress.unsupported, progress.unreadable), (1, 1), "{progress:?}");
    assert_eq!(progress.metadata_read, observation.files.len() as u64);
    assert_eq!(observation.state, ScanState::Partial);
    assert_eq!(observation.complete_scopes, vec![rel("")]);
    assert!(inventory::absence_provable(observation, &rel("night1/deleted.fits")));
    assert!(!inventory::absence_provable(observation, &rel("broken.fits")));
}

#[test]
fn progressive_scan_reports_real_headers_and_per_file_errors_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let odd_name = capture_tree(root);
    let before = snapshot(root);
    let location = location(root);

    let (observation, batches) =
        run(&location, &ScanOptions { batch_size: 1, relative_scope: None });
    let observation = observation.unwrap();

    assert_eq!(snapshot(root), before, "indexing must not change paths, names or bytes");
    assert!(batches.len() >= 3, "results arrive progressively: {}", batches.len());
    assert!(batches
        .windows(2)
        .all(|pair| pair[0].progress.discovered <= pair[1].progress.discovered));
    let delivered: usize = batches.iter().map(|batch| batch.files.len()).sum();
    assert_eq!(delivered, observation.files.len());

    let ha = file_at(&observation, &rel("night1/ha_001.fits"));
    assert_eq!(ha.format, ImageFormat::Fits);
    assert_eq!(ha.metadata.filter.as_deref(), Some("Ha"));
    assert_eq!(ha.metadata.object.as_deref(), Some("NGC 7000"));
    assert_eq!(ha.metadata.exposure_seconds, Some(300.0));
    assert_eq!((ha.metadata.wcs_ra_deg, ha.metadata.wcs_dec_deg), (Some(314.68), Some(44.53)));
    assert_eq!(ha.fingerprint.identity.volume, location.identity.volume);
    assert_eq!(
        inventory::probe_fingerprint(&root.join("night1/ha_001.fits")).unwrap(),
        ha.fingerprint,
        "scan and probe fingerprints agree"
    );
    let oiii = file_at(&observation, &rel("night1/oiii_001.xisf"));
    assert_eq!((oiii.format, oiii.metadata.filter.as_deref()), (ImageFormat::Xisf, Some("OIII")));
    let dark = file_at(&observation, &NativePath::from_path(&odd_name));
    assert_eq!(dark.relative_path.to_path_buf().unwrap(), odd_name);
    assert_eq!(dark.metadata.image_type.as_deref(), Some("DARK"));

    assert_malformed_file_is_uncertain(&observation);
}

#[cfg(unix)]
#[test]
fn denied_and_linked_subtrees_stay_uncertain_while_siblings_reconcile() {
    use std::os::unix::fs::PermissionsExt;

    struct Restore(PathBuf);
    impl Drop for Restore {
        fn drop(&mut self) {
            let _ = std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(0o755));
        }
    }

    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let root = dir.path();
    for folder in ["ok", "denied"] {
        std::fs::create_dir(root.join(folder)).unwrap();
        support::fits(&root.join(folder).join("light.fits"), &LIGHT).unwrap();
    }
    support::fits(&outside.path().join("elsewhere.fits"), &LIGHT).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("linked-dir")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("elsewhere.fits"), root.join("ok/linked.fits"))
        .unwrap();
    let location = location(root);
    let outside_before = snapshot(outside.path());

    std::fs::set_permissions(root.join("denied"), std::fs::Permissions::from_mode(0o000)).unwrap();
    let _restore = Restore(root.join("denied"));
    if std::fs::read_dir(root.join("denied")).is_ok() {
        eprintln!(
            "permission denial is not enforceable for this user; denied-scope case not exercised"
        );
        return;
    }

    let (observation, _) = run(&location, &ScanOptions::default());
    let observation = observation.unwrap();

    assert_eq!(observation.state, ScanState::Partial);
    let paths: Vec<_> = observation.files.iter().map(|file| file.relative_path.clone()).collect();
    assert_eq!(paths, vec![rel("ok/light.fits")]);
    assert_eq!(issue_at(&observation, "denied").availability, Availability::Unreadable);
    assert!(issue_at(&observation, "linked-dir").reason.contains("not followed"));
    assert!(issue_at(&observation, "ok/linked.fits").reason.contains("not followed"));
    assert!(!inventory::absence_provable(&observation, &rel("denied/light.fits")));
    assert!(!inventory::absence_provable(&observation, &rel("linked-dir/elsewhere.fits")));
    assert!(!inventory::absence_provable(&observation, &rel("ok/linked.fits")));
    assert!(inventory::absence_provable(&observation, &rel("ok/renamed.fits")));
    assert_eq!(snapshot(outside.path()), outside_before);
}

#[test]
fn cancel_and_callback_failure_never_produce_complete_scopes() {
    let dir = tempfile::tempdir().unwrap();
    for index in 0..4 {
        support::fits(&dir.path().join(format!("light_{index}.fits")), &LIGHT).unwrap();
    }
    let location = location(dir.path());
    let options = ScanOptions { batch_size: 1, relative_scope: None };

    let canceled = AtomicBool::new(false);
    let mut calls = 0;
    let observation = inventory::scan(
        &location,
        &options,
        |_| {
            calls += 1;
            canceled.store(true, Ordering::Release);
            Ok(())
        },
        &canceled,
    )
    .unwrap();
    assert_eq!(calls, 1, "no batch is delivered after cancellation");
    assert_eq!(observation.state, ScanState::Canceled);
    assert!(observation.complete_scopes.is_empty());
    assert_eq!(observation.files.len(), 1);
    assert!(!inventory::absence_provable(&observation, &rel("light_3.fits")));
    assert!(!inventory::absence_provable(&observation, &rel("never-existed.fits")));

    let mut calls = 0;
    let failed = inventory::scan(
        &location,
        &options,
        |_| {
            calls += 1;
            Err(LibraryError::PersistenceFailure("disk full".into()))
        },
        &AtomicBool::new(false),
    );
    assert_eq!(calls, 1, "a failed batch stops the walk");
    assert!(matches!(failed, Err(LibraryError::PersistenceFailure(_))));
}

#[test]
fn replaced_or_offline_roots_refuse_before_any_batch() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("Captures");
    std::fs::create_dir(&root).unwrap();
    support::fits(&root.join("light.fits"), &LIGHT).unwrap();
    let location = location(&root);
    assert!(inventory::validate_location_root(&location).is_ok());

    // A readable empty replacement folder at the same path is not the root.
    std::fs::rename(&root, parent.path().join("Captures-moved")).unwrap();
    std::fs::create_dir(&root).unwrap();
    let (replaced, batches) = run(&location, &ScanOptions::default());
    let error = replaced.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict", "{error}");
    assert_eq!(error.response(None, None).identity, Some(location.id));
    assert!(batches.is_empty());
    assert!(inventory::validate_location_root(&location).is_err());

    std::fs::remove_dir(&root).unwrap();
    let (offline, batches) = run(&location, &ScanOptions::default());
    assert_eq!(kind(&offline.unwrap_err()), "source_unavailable");
    assert!(batches.is_empty());

    let relative = inventory::observe_root_identity(Path::new("Captures")).unwrap_err();
    assert_eq!(kind(&relative), "invalid_input", "{relative}");

    // Unqualified recorded identity fails closed instead of guessing.
    std::fs::rename(parent.path().join("Captures-moved"), &root).unwrap();
    let mut unqualified = location.clone();
    unqualified.identity.volume.stable_id = None;
    assert_eq!(
        kind(&run(&unqualified, &ScanOptions::default()).0.unwrap_err()),
        "identity_conflict"
    );
    assert!(
        run(&location, &ScanOptions::default()).0.is_ok(),
        "the original folder is accepted again"
    );
}

#[test]
fn root_replaced_mid_scan_fails_without_absence_and_discards_pending_batch() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("Captures");
    for night in ["a", "b"] {
        std::fs::create_dir_all(root.join(night)).unwrap();
        for index in 0..2 {
            support::fits(&root.join(night).join(format!("light_{index}.fits")), &LIGHT).unwrap();
        }
    }
    let location = location(&root);
    let mut delivered = 0;
    let observation = inventory::scan(
        &location,
        &ScanOptions { batch_size: 1, relative_scope: None },
        |_| {
            delivered += 1;
            if delivered == 1 {
                std::fs::rename(&root, parent.path().join("unplugged")).unwrap();
                std::fs::create_dir(&root).unwrap();
            }
            Ok(())
        },
        &AtomicBool::new(false),
    )
    .unwrap();

    assert_eq!(delivered, 1);
    assert_eq!(observation.state, ScanState::Failed);
    assert!(observation.complete_scopes.is_empty());
    assert_eq!(issue_at(&observation, "").availability, Availability::IdentityConflict);
    assert!(!inventory::absence_provable(&observation, &rel("b/light_1.fits")));
}

#[test]
fn retry_scope_is_bounded_and_refuses_escape_or_links() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    for night in ["night1", "night2"] {
        std::fs::create_dir(root.join(night)).unwrap();
        support::fits(&root.join(night).join("light.fits"), &LIGHT).unwrap();
    }
    let location = location(root);

    let (observation, _) =
        run(&location, &ScanOptions { batch_size: 8, relative_scope: Some(rel("night1")) });
    let observation = observation.unwrap();
    assert_eq!(observation.state, ScanState::Completed);
    assert_eq!(observation.complete_scopes, vec![rel("night1")]);
    assert_eq!(
        observation.files.iter().map(|file| file.relative_path.clone()).collect::<Vec<_>>(),
        vec![rel("night1/light.fits")]
    );
    assert!(inventory::absence_provable(&observation, &rel("night1/other.fits")));
    assert!(!inventory::absence_provable(&observation, &rel("night2/light.fits")));

    let escape =
        run(&location, &ScanOptions { batch_size: 8, relative_scope: Some(rel("../night1")) }).0;
    assert_eq!(kind(&escape.unwrap_err()), "invalid_input");
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("night2"), root.join("alias")).unwrap();
        let linked =
            run(&location, &ScanOptions { batch_size: 8, relative_scope: Some(rel("alias")) }).0;
        assert_eq!(kind(&linked.unwrap_err()), "invalid_input");
    }
}

#[cfg(target_os = "macos")]
#[test]
fn volume_identity_qualifies_the_host_volume_and_fails_closed_elsewhere() {
    let dir = tempfile::tempdir().unwrap();
    let identity = inventory::observe_root_identity(dir.path()).unwrap();
    assert!(identity.volume.validate().is_ok());
    assert!(
        identity.volume.stable_id.as_deref().is_some_and(|uuid| uuid.len() == 36),
        "{identity:?}"
    );
    assert_eq!(identity.volume.file_ids_stable, identity.file_id.is_some());

    let devfs = inventory::observe_root_identity(Path::new("/dev")).unwrap_err();
    assert_eq!(kind(&devfs), "identity_conflict", "{devfs}");
    let file = inventory::probe_fingerprint(Path::new("/dev/null")).unwrap_err();
    assert_eq!(kind(&file), "invalid_input");
}

/// A real disk image attached at `mountpoint` with `hdiutil`, detached on drop.
#[cfg(target_os = "macos")]
struct DiskImage {
    mountpoint: PathBuf,
    _images: tempfile::TempDir,
}

#[cfg(target_os = "macos")]
impl DiskImage {
    fn attach(filesystem: &str, mountpoint: &Path) -> Self {
        use std::process::Command;
        let images = tempfile::tempdir().unwrap();
        let image = images.path().join("volume.dmg");
        let created = Command::new("/usr/bin/hdiutil")
            .args(["create", "-quiet", "-size", "8m", "-fs", filesystem, "-volname", "PVTEST"])
            .arg(&image)
            .status()
            .unwrap();
        assert!(created.success(), "hdiutil create {filesystem}");
        let attached = Command::new("/usr/bin/hdiutil")
            .args(["attach", "-quiet", "-nobrowse", "-mountpoint"])
            .arg(mountpoint)
            .arg(&image)
            .status()
            .unwrap();
        assert!(attached.success(), "hdiutil attach {filesystem}");
        Self { mountpoint: mountpoint.to_path_buf(), _images: images }
    }
}

#[cfg(target_os = "macos")]
impl Drop for DiskImage {
    fn drop(&mut self) {
        let _ = std::process::Command::new("/usr/bin/hdiutil")
            .args(["detach", "-force"])
            .arg(&self.mountpoint)
            .status();
    }
}

/// Mounts a real disk image inside the scan root; needs `hdiutil`.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "attaches a disk image with hdiutil"]
fn nested_foreign_volume_is_a_boundary_scope() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let nested = root.join("nested");
    std::fs::create_dir(&nested).unwrap();
    support::fits(&root.join("light.fits"), &LIGHT).unwrap();
    let _volume = DiskImage::attach("HFS+", &nested);
    support::fits(&nested.join("foreign.fits"), &LIGHT).unwrap();
    let location = location(root);

    let (observation, _) = run(&location, &ScanOptions::default());
    let observation = observation.unwrap();

    assert_eq!(observation.state, ScanState::Partial);
    assert_eq!(issue_at(&observation, "nested").availability, Availability::IdentityConflict);
    assert!(observation.files.iter().all(|file| file.relative_path != rel("nested/foreign.fits")));
    assert!(!inventory::absence_provable(&observation, &rel("nested/foreign.fits")));
    assert!(inventory::absence_provable(&observation, &rel("gone.fits")));
}

/// FAT and exFAT folder IDs follow directory-entry positions, so a replaced
/// folder is indistinguishable: such roots are refused before any batch.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "attaches disk images with hdiutil"]
fn roots_without_stable_folder_ids_are_refused_before_any_batch() {
    for filesystem in ["MS-DOS", "ExFAT"] {
        let mount = tempfile::tempdir().unwrap();
        let volume = DiskImage::attach(filesystem, mount.path());
        let root = volume.mountpoint.join("Captures");
        std::fs::create_dir(&root).unwrap();
        support::fits(&root.join("light.fits"), &LIGHT).unwrap();

        let refused = inventory::observe_root_identity(&root).unwrap_err();
        assert_eq!(kind(&refused), "identity_conflict", "{filesystem}: {refused}");

        // A file fingerprint is still observable, but carries no file ID.
        let file = inventory::probe_fingerprint(&root.join("light.fits")).unwrap();
        assert!(!file.identity.volume.file_ids_stable, "{filesystem}: {file:?}");
        assert_eq!(file.identity.file_id, None);
        assert!(file.identity.volume.validate().is_ok(), "{filesystem}: volume UUID qualifies");

        // A location recorded with only that volume identity never scans.
        let location = Location {
            id: Uuid::new_v4(),
            name: "Card".into(),
            path: NativePath::from_path(&root),
            role: LocationRole::Captures,
            identity: FileIdentity { volume: file.identity.volume.clone(), file_id: None },
            decision_revision: 1,
            availability: Availability::Available,
            last_observed_at: None,
            lifecycle: LocationLifecycle::Active,
        };
        let (scanned, batches) = run(&location, &ScanOptions::default());
        assert_eq!(kind(&scanned.unwrap_err()), "identity_conflict", "{filesystem}");
        assert!(batches.is_empty(), "{filesystem}: no batch before refusal");
        assert!(inventory::validate_location_root(&location).is_err());
    }
}
