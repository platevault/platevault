// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Trashed frames (LIB-FR-18, LIB-AC-19, D-W43, D-W52) and the Sessions scope
//! (LIB-FR-16, LIB-AC-17): a frame the storage custody moved to the OS Trash keeps
//! its record, leaves every list and total, is never reported Missing, and returns
//! only when a rescan finds its recorded path again. Sessions lists light sessions
//! of Captures locations. Fixture files are real; "the OS Trash" is a folder outside
//! the location on the same volume, so a put back is a rename that keeps the file.
#![cfg(unix)]

mod support;

use std::path::{Path, PathBuf};

use persistence_library::{
    Catalog, LocationRegistration, SessionFilter, SessionQuery, SessionSummary, SourceProbe,
    TrashedAsset, TrashedFrame, TrashedQuery,
};
use platevault_model::{
    ApplicableQuality, Asset, Availability, CorrectionInput, ImageFormat, Location, LocationRole,
    NativePath, Quality, ScanFile, ScanIssue, ScanObservation, ScanOperation, ScanProgress,
    ScanState, TargetCoverage,
};
use support::*;
use uuid::Uuid;

/// The fixture's stand-in for the OS Trash: same volume, outside every location.
fn trash_bin(fx: &Fixture) -> PathBuf {
    let bin = fx.temp.path().join("Trash");
    std::fs::create_dir_all(&bin).unwrap();
    bin
}

/// Move one file of the fixture's Captures location to the Trash, as the storage
/// custody does, then record it as one operation's Trashed frame.
async fn trash(
    catalog: &Catalog,
    fx: &Fixture,
    operation: Uuid,
    frames: &[(&Asset, &str, Vec<Uuid>)],
) -> Vec<TrashedAsset> {
    let mut recorded = Vec::new();
    for (asset, name, complete_view_ids) in frames {
        let source = fx.root.join(name);
        let sha256 = sha_of(&source);
        std::fs::rename(&source, trash_bin(fx).join(name)).unwrap();
        recorded.push(TrashedFrame {
            asset_id: asset.id,
            sha256,
            complete_view_ids: complete_view_ids.clone(),
        });
    }
    catalog.record_trashed(operation, &recorded).await.unwrap()
}

/// Put Back from the Trash: the same file returns to its recorded path.
fn put_back(fx: &Fixture, name: &str) {
    std::fs::rename(trash_bin(fx).join(name), fx.root.join(name)).unwrap();
}

async fn unusable(catalog: &Catalog, asset: &Asset) -> Asset {
    catalog.set_quality(&[expected(asset)], Quality::Unusable, DiskProbe).await.unwrap().remove(0)
}

fn trashed_filter() -> SessionQuery {
    SessionQuery { filter: Some(SessionFilter::Trashed), ..SessionQuery::default() }
}

async fn sessions(catalog: &Catalog, query: &SessionQuery) -> Vec<SessionSummary> {
    catalog.list_sessions(query).await.unwrap()
}

/// Captured seconds per channel of a Target's coverage.
fn captured(coverage: &TargetCoverage, channel: &str) -> f64 {
    coverage
        .contributions
        .iter()
        .filter(|c| c.channel.as_deref() == Some(channel))
        .map(|c| c.captured_seconds)
        .sum()
}

fn unreviewed(coverage: &TargetCoverage) -> f64 {
    coverage.contributions.iter().map(|c| c.unreviewed_seconds).sum()
}

fn ids(assets: &[&Asset]) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = assets.iter().map(|asset| asset.id).collect();
    ids.sort_unstable();
    ids
}

/// A complete scan of `names` under any registered root.
async fn scan_root(
    catalog: &Catalog,
    location: &Location,
    root: &Path,
    names: &[&str],
) -> ScanOperation {
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let files: Vec<ScanFile> = names
        .iter()
        .map(|name| ScanFile {
            relative_path: NativePath::from_path(Path::new(name)),
            fingerprint: file_fingerprint(&root.join(name)).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata_for(name),
        })
        .collect();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: folder_identity(root).unwrap(),
        files,
        issues: Vec::new(),
        complete_scopes: vec![root_scope()],
        incomplete_scopes: Vec::new(),
        progress: ScanProgress::default(),
        state: ScanState::Completed,
    };
    catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap()
}

/// LIB-FR-18, LIB-AC-19: a Trashed frame leaves the session list, the session's
/// assets and members, the location filter and the Target's captured and
/// Unreviewed totals; the other frames still count.
#[tokio::test]
async fn trashed_frame_is_absent_from_sessions_coverage_and_totals() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits", "Ha_003.fits"];
    for name in names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let session = sessions(&catalog, &SessionQuery::default()).await[0].session.clone();
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&session)], saved.candidate.id).await.unwrap();
    let rejected = unusable(&catalog, by_name(&assets, "Ha_002.fits")).await;
    let before = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((captured(&before, "Ha") - 900.0).abs() < 1e-9, "{before:?}");

    trash(&catalog, &fx, Uuid::new_v4(), &[(&rejected, "Ha_002.fits", Vec::new())]).await;

    let kept = ids(&[by_name(&assets, "Ha_001.fits"), by_name(&assets, "Ha_003.fits")]);
    for query in [
        SessionQuery::default(),
        SessionQuery { location_id: Some(location.id), ..SessionQuery::default() },
    ] {
        let listed = sessions(&catalog, &query).await;
        assert_eq!(listed.len(), 1, "{listed:?}");
        assert_eq!((listed[0].asset_count, listed[0].capture_count), (2, 2), "{listed:?}");
        assert_eq!(listed[0].session.asset_ids, kept);
        assert_eq!(listed[0].availability, Availability::Available);
    }
    let detail = catalog.session(session.id).await.unwrap();
    assert_eq!(ids(&detail.assets.iter().collect::<Vec<_>>()), kept);
    assert_eq!(detail.summary.asset_count, 2);
    assert_eq!(detail.members.len(), 2);
    assert!(detail.members.iter().all(|member| !member.copies.contains(&rejected.id)));

    let after = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((captured(&after, "Ha") - 600.0).abs() < 1e-9, "{after:?}");
    assert!((unreviewed(&after) - 600.0).abs() < 1e-9, "{after:?}");
    assert_eq!(catalog.asset(rejected.id).await.unwrap().availability, Availability::Trashed);
    catalog.close().await.unwrap();
}

/// LIB-AC-19: a complete rescan of the location, and an Unreadable issue over the
/// Trashed frame's folder, never report it Missing or Unreadable; a frame deleted
/// outside the app still reads Missing (positive control).
#[tokio::test]
async fn rescan_never_reports_trashed_missing() {
    let fx = Fixture::new();
    let names = ["night1/Ha_001.fits", "night1/Ha_002.fits", "night1/Ha_003.fits"];
    for name in names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    std::fs::create_dir_all(trash_bin(&fx).join("night1")).unwrap();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let rejected = unusable(&catalog, by_name(&assets, "Ha_002.fits")).await;
    let deleted = by_name(&assets, "Ha_003.fits").id;
    trash(&catalog, &fx, Uuid::new_v4(), &[(&rejected, names[1], Vec::new())]).await;
    std::fs::remove_file(fx.root.join(names[2])).unwrap();

    let rescan = scan(&catalog, &fx, &location, &names[..1]).await;
    assert_eq!(rescan.state, ScanState::Completed);
    assert_eq!(catalog.asset(rejected.id).await.unwrap().availability, Availability::Trashed);
    assert_eq!(catalog.asset(deleted).await.unwrap().availability, Availability::Missing);

    let issue = ScanIssue {
        relative_path: NativePath::from_path(Path::new("night1")),
        reason: "folder could not be read".into(),
        availability: Availability::Unreadable,
    };
    let partial = scan_with(&catalog, &fx, &location, &[], vec![issue], ScanState::Partial).await;
    assert_eq!(partial.state, ScanState::Partial);
    assert_eq!(catalog.asset(rejected.id).await.unwrap().availability, Availability::Trashed);
    let frames = catalog.trashed_assets(&TrashedQuery::default()).await.unwrap();
    assert_eq!(frames.iter().map(|frame| frame.asset.id).collect::<Vec<_>>(), [rejected.id]);
    catalog.close().await.unwrap();
}

/// LIB-AC-19: after Put back, a rescan that finds the recorded path with the
/// trashed SHA-256 returns the frame as Unusable, counted wherever Unusable frames
/// count; it leaves the Trashed filter and its episode stays as history.
#[tokio::test]
async fn put_back_and_rescan_returns_unusable_and_keeps_episode() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits", "Ha_003.fits"];
    for name in names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let session = sessions(&catalog, &SessionQuery::default()).await[0].session.clone();
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&session)], saved.candidate.id).await.unwrap();
    let rejected = unusable(&catalog, by_name(&assets, "Ha_002.fits")).await;
    let sha256 = sha_of(&fx.root.join("Ha_002.fits"));
    let operation = Uuid::new_v4();
    trash(&catalog, &fx, operation, &[(&rejected, "Ha_002.fits", Vec::new())]).await;
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_003.fits"]).await;
    assert_eq!(catalog.asset(rejected.id).await.unwrap().availability, Availability::Trashed);

    put_back(&fx, "Ha_002.fits");
    let rescan = scan(&catalog, &fx, &location, &names).await;
    assert_eq!(rescan.state, ScanState::Completed);
    let returned = catalog.asset(rejected.id).await.unwrap();
    assert_eq!(returned.availability, Availability::Available);
    assert_eq!(returned.applicable_quality(), ApplicableQuality::Unusable);
    assert_eq!(returned.quality, Quality::Unusable);
    assert!(catalog.trashed_assets(&TrashedQuery::default()).await.unwrap().is_empty());
    assert!(sessions(&catalog, &trashed_filter()).await.is_empty());

    let history = catalog.trash_episodes(rejected.id).await.unwrap();
    assert_eq!(history.len(), 1, "{history:?}");
    assert_eq!(history[0].storage_operation_id, operation);
    assert_eq!(history[0].sha256, sha256);
    assert!(history[0].put_back_at.is_some(), "{history:?}");

    let listed = sessions(&catalog, &SessionQuery::default()).await;
    assert_eq!(listed[0].asset_count, 3);
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((captured(&coverage, "Ha") - 900.0).abs() < 1e-9, "{coverage:?}");
    catalog.close().await.unwrap();
}

/// LIB-FR-18 with LIB-FR-09: different bytes at a Trashed frame's recorded path
/// follow the `ChangedContent` rule; the record leaves the Trashed state and keeps
/// its decision and the closed episode as history.
#[tokio::test]
async fn different_bytes_after_put_back_read_changed_content() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    for name in names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let rejected = unusable(&catalog, by_name(&assets, "Ha_002.fits")).await;
    trash(&catalog, &fx, Uuid::new_v4(), &[(&rejected, "Ha_002.fits", Vec::new())]).await;

    fx.write("Ha_002.fits", b"another frame entirely at the trashed path");
    let rescan = scan(&catalog, &fx, &location, &names).await;
    assert_eq!(rescan.state, ScanState::Completed);
    let returned = catalog.asset(rejected.id).await.unwrap();
    assert_eq!(returned.availability, Availability::Available);
    assert_eq!(
        returned.applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Unusable }
    );
    assert_eq!(returned.observation_revision, rejected.observation_revision + 1);
    assert!(catalog.trashed_assets(&TrashedQuery::default()).await.unwrap().is_empty());
    let history = catalog.trash_episodes(rejected.id).await.unwrap();
    assert_eq!(history.len(), 1);
    assert!(history[0].put_back_at.is_some());
    catalog.close().await.unwrap();
}

/// LIB-FR-18, PLAN-TGT-AC-08 (data side): a session whose frames are all Trashed
/// leaves Sessions and the Target's captured total for its channel; the Trashed
/// filter lists it.
#[tokio::test]
async fn session_with_all_frames_trashed_leaves_sessions() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits", "OIII_001.fits", "OIII_002.fits"];
    for name in names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let listed = sessions(&catalog, &SessionQuery::default()).await;
    assert_eq!(listed.len(), 2);
    let saved = catalog.save_target(&target("M 31", "m 31"), None).await.unwrap();
    let expected: Vec<_> = listed.iter().map(|row| expected_session(&row.session)).collect();
    catalog.associate_target(&expected, saved.candidate.id).await.unwrap();
    let oiii = by_name(&assets, "OIII_001.fits").id;
    let oiii_session =
        listed.iter().find(|row| row.session.asset_ids.contains(&oiii)).unwrap().session.id;
    let first = unusable(&catalog, by_name(&assets, "OIII_001.fits")).await;
    let second = unusable(&catalog, by_name(&assets, "OIII_002.fits")).await;
    let before = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((captured(&before, "OIII") - 600.0).abs() < 1e-9, "{before:?}");

    trash(
        &catalog,
        &fx,
        Uuid::new_v4(),
        &[(&first, "OIII_001.fits", Vec::new()), (&second, "OIII_002.fits", Vec::new())],
    )
    .await;

    let ha = ids(&[by_name(&assets, "Ha_001.fits"), by_name(&assets, "Ha_002.fits")]);
    for query in [
        SessionQuery::default(),
        SessionQuery { location_id: Some(location.id), ..SessionQuery::default() },
    ] {
        let listed = sessions(&catalog, &query).await;
        assert_eq!(listed.len(), 1, "{listed:?}");
        assert_eq!(listed[0].session.asset_ids, ha);
    }
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((captured(&coverage, "Ha") - 600.0).abs() < 1e-9, "{coverage:?}");
    assert!(captured(&coverage, "OIII").abs() < 1e-9, "{coverage:?}");

    let trashed = sessions(&catalog, &trashed_filter()).await;
    assert_eq!(trashed.len(), 1, "{trashed:?}");
    assert_eq!(trashed[0].session.id, oiii_session);
    assert_eq!(trashed[0].asset_count, 2);
    assert_eq!(trashed[0].availability, Availability::Trashed);
    catalog.close().await.unwrap();
}

/// LIB-AC-19: the Trashed filter lists exactly the Trashed frames, with their
/// last-observed metadata, the SHA-256 the custody verified and the operation
/// that trashed them; the runs Complete at trash time stay recorded (D-W52).
#[tokio::test]
async fn sessions_trashed_filter_lists_last_observed_metadata_and_operation() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits", "Ha_003.fits"];
    for name in names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let session = sessions(&catalog, &SessionQuery::default()).await[0].session.clone();
    let first = unusable(&catalog, by_name(&assets, "Ha_001.fits")).await;
    let second = unusable(&catalog, by_name(&assets, "Ha_002.fits")).await;
    let shas = [sha_of(&fx.root.join("Ha_001.fits")), sha_of(&fx.root.join("Ha_002.fits"))];
    let (operation, complete_run) = (Uuid::new_v4(), Uuid::new_v4());
    let recorded = trash(
        &catalog,
        &fx,
        operation,
        &[(&first, "Ha_001.fits", vec![complete_run]), (&second, "Ha_002.fits", Vec::new())],
    )
    .await;
    assert_eq!(recorded.len(), 2);

    let listed = sessions(&catalog, &trashed_filter()).await;
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(listed[0].session.id, session.id);
    assert_eq!(listed[0].session.asset_ids, ids(&[&first, &second]));
    assert_eq!((listed[0].asset_count, listed[0].capture_count), (2, 2));
    assert_eq!(listed[0].availability, Availability::Trashed);
    let latest = [&first.last_observed_at, &second.last_observed_at].into_iter().max().cloned();
    assert_eq!(listed[0].last_observed_at, latest);

    let frames = catalog.trashed_assets(&TrashedQuery::default()).await.unwrap();
    assert_eq!(frames.len(), 2, "{frames:?}");
    for (decided, sha256, views) in
        [(&first, &shas[0], vec![complete_run]), (&second, &shas[1], Vec::new())]
    {
        let frame = frames.iter().find(|frame| frame.asset.id == decided.id).unwrap();
        assert_eq!(frame.asset.availability, Availability::Trashed);
        assert_eq!(frame.asset.observed, decided.observed, "last-observed metadata");
        assert_eq!(frame.asset.effective, decided.effective);
        assert_eq!(frame.asset.last_observed_at, decided.last_observed_at);
        assert_eq!(frame.asset.quality, Quality::Unusable, "quality history is kept");
        assert_eq!(frame.session_id, Some(session.id));
        assert_eq!(frame.episode.storage_operation_id, operation);
        assert_eq!(&frame.episode.sha256, sha256);
        assert_eq!(frame.episode.complete_view_ids, views);
        assert!(!frame.episode.trashed_at.is_empty());
        assert_eq!(frame.episode.put_back_at, None);
    }
    let of_session = TrashedQuery { session_id: Some(session.id), ..TrashedQuery::default() };
    assert_eq!(catalog.trashed_assets(&of_session).await.unwrap().len(), 2);
    let other = TrashedQuery { session_id: Some(Uuid::new_v4()), ..TrashedQuery::default() };
    assert!(catalog.trashed_assets(&other).await.unwrap().is_empty());
    let paged = TrashedQuery { offset: 1, limit: 1, ..TrashedQuery::default() };
    assert_eq!(catalog.trashed_assets(&paged).await.unwrap().len(), 1);

    let live = sessions(&catalog, &SessionQuery::default()).await;
    assert_eq!(live[0].asset_count, 1);
    catalog.close().await.unwrap();
}

/// LIB-FR-16, LIB-AC-17 (catalog side): Sessions lists light sessions of
/// Captures locations only. Darks, in the Calibration location or in Captures,
/// and lights indexed only in the Calibration location are in no Sessions list.
#[tokio::test]
async fn calibration_location_sessions_are_not_in_sessions() {
    let fx = Fixture::new();
    let captures = ["Ha_001.fits", "Ha_002.fits", "Dark_101.fits"];
    for name in captures {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let calibration_root = fx.root.parent().unwrap().join("Calibration");
    let calibration_names = ["Dark_001.fits", "Dark_002.fits", "OIII_900.fits"];
    std::fs::create_dir_all(&calibration_root).unwrap();
    for name in calibration_names {
        std::fs::write(calibration_root.join(name), format!("calibration {name}")).unwrap();
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    let calibration = catalog
        .register_location(&LocationRegistration {
            name: "Astro-T7/Calibration".into(),
            path: NativePath::from_path(&calibration_root),
            role: LocationRole::Calibration,
            identity: folder_identity(&calibration_root).unwrap(),
        })
        .await
        .unwrap();
    scan(&catalog, &fx, &location, &captures).await;
    scan_root(&catalog, &calibration, &calibration_root, &calibration_names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let lights = ids(&[by_name(&assets, "Ha_001.fits"), by_name(&assets, "Ha_002.fits")]);

    let listed = sessions(&catalog, &SessionQuery::default()).await;
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(listed[0].session.asset_ids, lights);
    assert_eq!(listed[0].location_ids, [location.id]);
    let at_calibration =
        SessionQuery { location_id: Some(calibration.id), ..SessionQuery::default() };
    assert!(sessions(&catalog, &at_calibration).await.is_empty());
    let at_captures = SessionQuery { location_id: Some(location.id), ..SessionQuery::default() };
    assert_eq!(sessions(&catalog, &at_captures).await.len(), 1);
    catalog.close().await.unwrap();
}

/// LIB-FR-18: Fixed memberships keep a Trashed frame's id, but it never takes a
/// new decision or correction.
#[tokio::test]
async fn decisions_and_corrections_on_a_trashed_frame_are_refused() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    for name in names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let rejected = unusable(&catalog, by_name(&assets, "Ha_002.fits")).await;
    trash(&catalog, &fx, Uuid::new_v4(), &[(&rejected, "Ha_002.fits", Vec::new())]).await;
    let record = catalog.asset(rejected.id).await.unwrap();

    let decision = catalog.set_quality(&[expected(&record)], Quality::Usable, DiskProbe).await;
    assert_eq!(kind(&decision.unwrap_err()), "invalid_input");
    let correction = [CorrectionInput {
        asset_id: record.id,
        field: "filter".into(),
        value: serde_json::json!("OIII"),
    }];
    let preview = catalog.preview_correction(&[expected(&record)], &correction, group).await;
    assert_eq!(kind(&preview.unwrap_err()), "invalid_input");
    assert_eq!(catalog.asset(rejected.id).await.unwrap(), record, "nothing changed");
    catalog.close().await.unwrap();
}

/// D16 with LIB-FR-18: a Trashed copy never joins a live copy, by digest or by
/// link, so the live copy is its own capture and no Trashed decision speaks for it.
#[tokio::test]
async fn a_trashed_copy_never_joins_a_live_copy() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    for name in names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let nas = fx.temp.path().join("NAS");
    std::fs::create_dir_all(&nas).unwrap();
    std::fs::write(nas.join("Ha_002.fits"), "frame Ha_002.fits").unwrap();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    let backup = catalog
        .register_location(&LocationRegistration {
            name: "NAS".into(),
            path: NativePath::from_path(&nas),
            role: LocationRole::Captures,
            identity: folder_identity(&nas).unwrap(),
        })
        .await
        .unwrap();
    scan(&catalog, &fx, &location, &names).await;
    scan_root(&catalog, &backup, &nas, &["Ha_002.fits"]).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let copy = catalog.location_assets(backup.id).await.unwrap().remove(0);
    let rejected = unusable(&catalog, by_name(&assets, "Ha_002.fits")).await;
    catalog.verify_digest(copy.id, DiskProbe).await.unwrap();
    let session = sessions(&catalog, &SessionQuery::default()).await[0].session.clone();
    let joined = catalog.session(session.id).await.unwrap();
    let member = joined.members.iter().find(|member| member.copies.contains(&copy.id)).unwrap();
    let mut copies = member.copies.clone();
    copies.sort_unstable();
    assert_eq!(copies, ids(&[&rejected, &copy]), "one logical capture before");
    assert_eq!(member.applicable_quality, ApplicableQuality::Unusable);

    trash(&catalog, &fx, Uuid::new_v4(), &[(&rejected, "Ha_002.fits", Vec::new())]).await;
    let detail = catalog.session(session.id).await.unwrap();
    let member = detail.members.iter().find(|member| member.copies.contains(&copy.id)).unwrap();
    assert_eq!(member.copies, [copy.id]);
    assert_eq!(member.applicable_quality, ApplicableQuality::Unreviewed);
    assert_eq!(detail.summary.capture_count, 2);
    catalog.close().await.unwrap();
}

/// The trash record is one transaction: a digest that differs from the recorded
/// one refuses every frame; recording the same operation again is a no-op, and
/// another operation cannot trash a Trashed frame.
#[tokio::test]
async fn record_trashed_is_atomic_and_idempotent_per_operation() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    for name in names {
        fx.write(name, format!("frame {name}").as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let first = unusable(&catalog, by_name(&assets, "Ha_001.fits")).await;
    let second = unusable(&catalog, by_name(&assets, "Ha_002.fits")).await;
    let frame = |asset: &Asset, sha256: String| TrashedFrame {
        asset_id: asset.id,
        sha256,
        complete_view_ids: Vec::new(),
    };
    let (good, wrong) = (sha_of(&fx.root.join("Ha_001.fits")), "0".repeat(64));
    let operation = Uuid::new_v4();
    let refused = catalog
        .record_trashed(operation, &[frame(&first, good.clone()), frame(&second, wrong)])
        .await;
    assert_eq!(kind(&refused.unwrap_err()), "identity_conflict");
    assert_eq!(catalog.asset(first.id).await.unwrap().availability, Availability::Available);
    assert!(catalog.trash_episodes(first.id).await.unwrap().is_empty());
    let malformed = catalog.record_trashed(operation, &[frame(&first, "abc".into())]).await;
    assert_eq!(kind(&malformed.unwrap_err()), "invalid_input");

    let recorded = catalog.record_trashed(operation, &[frame(&first, good.clone())]).await.unwrap();
    let again = catalog.record_trashed(operation, &[frame(&first, good.clone())]).await.unwrap();
    assert_eq!(again[0].episode, recorded[0].episode, "a resumed operation records nothing new");
    assert_eq!(catalog.trash_episodes(first.id).await.unwrap().len(), 1);
    let other = catalog.record_trashed(Uuid::new_v4(), &[frame(&first, good)]).await;
    assert_eq!(kind(&other.unwrap_err()), "invalid_input");
    catalog.close().await.unwrap();
}
