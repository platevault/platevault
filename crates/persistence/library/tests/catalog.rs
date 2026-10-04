// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Focused file-backed catalog behavior: durability, CAS, absence proof, regroup
//! lineage, digest-bound quality and all-or-nothing remap. Fixture files are real;
//! the probe reads actual no-follow file and folder metadata.
#![cfg(unix)]

use std::collections::BTreeMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use persistence_library::{
    Catalog, LocationRegistration, SessionQuery, SourceProbe, SuggestedAssociation,
};
use platevault_model::{
    ApplicableQuality, Asset, Association, AssociationKind, AssociationState, Availability,
    CaptureKey, CaptureMetadata, CorrectionInput, EvidenceItem, ExpectedAsset, ExpectedSession,
    FileIdentity, GroupingResult, ImageFormat, LibraryError, Location, LocationRole, NativePath,
    ObservationFingerprint, PathSensitivity, Provenance, Quality, RemapBlockReason, Revision,
    ScanBatch, ScanFile, ScanIssue, ScanObservation, ScanOperation, ScanProgress, ScanState,
    Session, SessionCandidate, TargetAlias, TargetCandidate, VolumeIdentity,
};
use sha2::{Digest, Sha256};
use uuid::Uuid;

fn volume() -> VolumeIdentity {
    VolumeIdentity {
        filesystem: "apfs".into(),
        stable_id: Some("0F1E2D3C-test-volume".into()),
        file_ids_stable: true,
        case: PathSensitivity::Sensitive,
        normalization: PathSensitivity::Sensitive,
    }
}

fn io_error(path: &Path, error: &std::io::Error) -> LibraryError {
    LibraryError::from_io(path, error)
}

fn file_fingerprint(path: &Path) -> Result<ObservationFingerprint, LibraryError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| io_error(path, &error))?;
    if !metadata.file_type().is_file() {
        return Err(LibraryError::InvalidInput("not a regular file".into()));
    }
    let modified = metadata.modified().map_err(|error| io_error(path, &error))?;
    let modified_ns =
        i128::try_from(modified.duration_since(UNIX_EPOCH).unwrap().as_nanos()).unwrap();
    Ok(ObservationFingerprint {
        identity: FileIdentity { volume: volume(), file_id: Some(metadata.ino().to_string()) },
        size_bytes: metadata.len(),
        modified_ns,
        content_sha256: None,
    })
}

fn folder_identity(path: &Path) -> Result<FileIdentity, LibraryError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| io_error(path, &error))?;
    if !metadata.is_dir() {
        return Err(LibraryError::IdentityConflict("root is not a folder".into()));
    }
    Ok(FileIdentity { volume: volume(), file_id: Some(metadata.ino().to_string()) })
}

/// Real no-follow probe of the fixture volume.
#[derive(Clone)]
struct DiskProbe;

impl SourceProbe for DiskProbe {
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
        file_fingerprint(path)
    }
    fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
        folder_identity(&location.path.to_path_buf()?)
    }
}

/// Simple behavioral grouping: frame type, filter, exposure and camera.
fn group(assets: &[Asset]) -> GroupingResult {
    let mut sessions: BTreeMap<String, Vec<Uuid>> = BTreeMap::new();
    for asset in assets {
        let m = &asset.effective;
        let key =
            format!("{:?}|{:?}|{:?}|{:?}", m.image_type, m.filter, m.exposure_seconds, m.camera);
        sessions.entry(key).or_default().push(asset.id);
    }
    GroupingResult {
        sessions: sessions
            .into_iter()
            .map(|(key, mut asset_ids)| {
                asset_ids.sort_unstable();
                SessionCandidate {
                    key: CaptureKey(key),
                    asset_ids,
                    provisional: Vec::new(),
                    date_basis: Some("2026-09-12".into()),
                }
            })
            .collect(),
    }
}

fn metadata_for(relative: &str) -> CaptureMetadata {
    let filter = if relative.contains("OIII") { "OIII" } else { "Ha" };
    CaptureMetadata {
        image_type: Some(if relative.contains("Dark") { "DARK" } else { "LIGHT" }.into()),
        filter: Some(filter.into()),
        exposure_seconds: Some(300.0),
        camera: Some("ASI2600MM".into()),
        date_local: Some("2026-09-12T23:00:00".into()),
        ..CaptureMetadata::default()
    }
}

fn sha_of(path: &Path) -> String {
    hex::encode(Sha256::digest(std::fs::read(path).unwrap()))
}

/// Names, sizes and SHA-256 of every file below `root`.
fn tree(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else {
                let size = std::fs::metadata(&path).unwrap().len();
                files.insert(path.strip_prefix(root).unwrap().to_path_buf(), (size, sha_of(&path)));
            }
        }
    }
    files
}

struct Fixture {
    temp: tempfile::TempDir,
    db: PathBuf,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Astro-T7").join("Captures");
        std::fs::create_dir_all(&root).unwrap();
        Self { db: temp.path().join("catalog.sqlite"), root, temp }
    }
    fn write(&self, relative: &str, bytes: &[u8]) {
        let path = self.root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    fn registration(&self) -> LocationRegistration {
        LocationRegistration {
            name: "Astro-T7/Captures".into(),
            path: NativePath::from_path(&self.root),
            role: LocationRole::Captures,
            identity: folder_identity(&self.root).unwrap(),
        }
    }
    fn scan_file(&self, relative: &str) -> ScanFile {
        ScanFile {
            relative_path: NativePath::from_path(Path::new(relative)),
            fingerprint: file_fingerprint(&self.root.join(relative)).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata_for(relative),
        }
    }
}

fn root_scope() -> NativePath {
    NativePath::UnixBytes(Vec::new())
}

fn kind(error: &LibraryError) -> String {
    error.response(None, None).kind
}

fn expected(asset: &Asset) -> ExpectedAsset {
    ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    }
}

fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

fn target(designation: &str, alias: &str) -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: designation.into(),
        aliases: vec![TargetAlias {
            text: designation.into(),
            normalized: alias.into(),
            kind: "designation".into(),
            provenance: Provenance::User,
        }],
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(platevault_model::SkyCoordinates {
            ra_deg: 314.75,
            dec_deg: 44.33,
            frame: "ICRS".into(),
        }),
        provenance: Provenance::User,
        provider_id: None,
    }
}

async fn scan_with(
    catalog: &Catalog,
    fx: &Fixture,
    location: &Location,
    files: &[&str],
    issues: Vec<ScanIssue>,
    state: ScanState,
) -> ScanOperation {
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let files: Vec<ScanFile> = files.iter().map(|relative| fx.scan_file(relative)).collect();
    let root = DiskProbe.root_identity(location).unwrap();
    let progress = ScanProgress {
        discovered: files.len() as u64,
        metadata_read: files.len() as u64,
        ..ScanProgress::default()
    };
    let batch =
        ScanBatch { files: files.clone(), issues: issues.clone(), progress: progress.clone() };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let terminal = matches!(state, ScanState::Completed | ScanState::Partial);
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
        incomplete_scopes: issues.iter().map(|issue| issue.relative_path.clone()).collect(),
        files,
        issues,
        complete_scopes: if terminal { vec![root_scope()] } else { Vec::new() },
        progress,
        state,
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

async fn scan(
    catalog: &Catalog,
    fx: &Fixture,
    location: &Location,
    files: &[&str],
) -> ScanOperation {
    scan_with(catalog, fx, location, files, Vec::new(), ScanState::Completed).await
}

fn by_name<'a>(assets: &'a [Asset], name: &str) -> &'a Asset {
    assets.iter().find(|asset| asset.relative_path.display().ends_with(name)).unwrap()
}

#[tokio::test]
async fn writer_connection_reports_actual_wal_full_and_fullfsync() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let settings = catalog.writer_settings().await.unwrap();
    assert_eq!(settings.journal_mode, "wal");
    assert_eq!(settings.synchronous, 2, "synchronous=FULL");
    assert!(settings.foreign_keys);
    if cfg!(target_os = "macos") {
        assert!(settings.fullfsync && settings.checkpoint_fullfsync);
    }
}

#[tokio::test]
async fn restart_restores_identities_decisions_and_marks_interrupted_scans_incomplete() {
    let fx = Fixture::new();
    fx.write("night1/Ha_001.fits", b"SIMPLE = T / Ha frame one");
    fx.write("night1/Ha_002.fits", b"SIMPLE = T / Ha frame two");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    assert_eq!(tree(&fx.root), before, "registration modifies nothing");
    let operation =
        scan(&catalog, &fx, &location, &["night1/Ha_001.fits", "night1/Ha_002.fits"]).await;
    assert_eq!(operation.state, ScanState::Completed);
    let assets = catalog.location_assets(location.id).await.unwrap();
    let decided =
        catalog.set_quality(&[expected(&assets[0])], Quality::Usable, DiskProbe).await.unwrap();
    let basis = decided[0].quality_basis.clone().unwrap();
    assert_eq!(basis.content_sha256, Some(sha_of(&fx.root.join("night1/Ha_001.fits"))));
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 1);
    catalog
        .associate_target(&[expected_session(&sessions[0].session)], saved.candidate.id)
        .await
        .unwrap();
    let interrupted = catalog.begin_scan(location.id, None).await.unwrap();
    catalog.close().await.unwrap();

    let reopened = Catalog::open(&fx.db).await.unwrap();
    let restored = reopened.location_assets(location.id).await.unwrap();
    let ids = |assets: &[Asset]| assets.iter().map(|asset| asset.id).collect::<Vec<_>>();
    assert_eq!(ids(&restored), ids(&assets));
    assert_eq!(restored[0].applicable_quality(), ApplicableQuality::Usable);
    assert_eq!(restored[0].decision_revision, decided[0].decision_revision);
    let detail = reopened.session(sessions[0].session.id).await.unwrap();
    assert_eq!(detail.associations[0].state, AssociationState::Confirmed);
    assert_eq!(detail.associations[0].subject_id, Some(saved.candidate.id));
    let status = reopened.scan_status(interrupted.id).await.unwrap();
    assert_eq!(status.state, ScanState::Partial);
    assert!(status.incomplete_scopes.contains(&root_scope()));
    assert!(status.issues.iter().any(|issue| issue.reason.contains("interrupted")));
    assert!(status.revision > interrupted.revision);
    assert_eq!(reopened.list_operations(Some(location.id), 0, 10).await.unwrap().len(), 2);
    assert_eq!(tree(&fx.root), before, "sources unchanged");
}

#[tokio::test]
async fn stale_multi_asset_batch_changes_nothing_and_unchanged_rescan_keeps_cas() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"frame one");
    fx.write("Ha_002.fits", b"frame two");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let mut stale = expected(&assets[1]);
    stale.decision_revision += 1;
    let error = catalog
        .set_quality(&[expected(&assets[0]), stale], Quality::Usable, DiskProbe)
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "conflict");
    for asset in catalog.location_assets(location.id).await.unwrap() {
        assert_eq!((asset.quality, asset.decision_revision), (Quality::Unreviewed, 0));
    }
    let rescan = scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    assert_eq!(rescan.state, ScanState::Completed);
    let decided = catalog
        .set_quality(&[expected(&assets[0]), expected(&assets[1])], Quality::Unusable, DiskProbe)
        .await
        .unwrap();
    assert!(decided.iter().all(|asset| asset.applicable_quality() == ApplicableQuality::Unusable));
}

#[tokio::test]
async fn partial_offline_and_mid_scan_root_change_never_mark_missing() {
    let fx = Fixture::new();
    for name in ["night1/Ha_001.fits", "night1/Ha_002.fits", "night2/Ha_003.fits"] {
        fx.write(name, name.as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(
        &catalog,
        &fx,
        &location,
        &["night1/Ha_001.fits", "night1/Ha_002.fits", "night2/Ha_003.fits"],
    )
    .await;
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    catalog
        .associate_target(&[expected_session(&sessions[0].session)], saved.candidate.id)
        .await
        .unwrap();

    std::fs::remove_file(fx.root.join("night1/Ha_002.fits")).unwrap();
    let denied = ScanIssue {
        relative_path: NativePath::from_path(Path::new("night2")),
        reason: "access denied".into(),
        availability: Availability::Unreadable,
    };
    let partial = scan_with(
        &catalog,
        &fx,
        &location,
        &["night1/Ha_001.fits"],
        vec![denied],
        ScanState::Partial,
    )
    .await;
    assert_eq!(partial.state, ScanState::Partial);
    let assets = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(
        by_name(&assets, "Ha_002.fits").availability,
        Availability::Missing,
        "positive control"
    );
    assert_eq!(by_name(&assets, "Ha_003.fits").availability, Availability::Unreadable);

    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let elsewhere = fx.temp.path().join("replacement");
    std::fs::create_dir_all(&elsewhere).unwrap();
    let replaced = folder_identity(&elsewhere).unwrap();
    let batch = ScanBatch::default();
    let error = catalog.apply_scan_batch(operation.id, &replaced, &batch, group).await.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict");
    std::fs::remove_file(fx.root.join("night1/Ha_001.fits")).unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: folder_identity(&fx.root).unwrap(),
        files: Vec::new(),
        issues: Vec::new(),
        complete_scopes: vec![root_scope()],
        incomplete_scopes: Vec::new(),
        progress: ScanProgress::default(),
        state: ScanState::Completed,
    };
    let finished = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap();
    assert_eq!(finished.state, ScanState::Partial);
    let assets = catalog.location_assets(location.id).await.unwrap();
    assert_ne!(by_name(&assets, "Ha_001.fits").availability, Availability::Missing);

    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    std::fs::rename(&fx.root, fx.root.with_extension("unplugged")).unwrap();
    let error = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "not_found");
    assert_eq!(catalog.scan_status(operation.id).await.unwrap().state, ScanState::Partial);
    let failure = catalog.location_failure(location.id).await.unwrap().unwrap();
    assert_eq!(failure.availability, Availability::Offline);
    let assets = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(by_name(&assets, "Ha_001.fits").availability, Availability::Offline);
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!(coverage.provisional);
    let offline: Vec<_> = coverage
        .contributions
        .iter()
        .filter(|contribution| contribution.availability == Availability::Offline)
        .collect();
    assert!((offline.iter().map(|c| c.captured_seconds).sum::<f64>() - 600.0).abs() < 1e-9);
    assert!(offline.iter().all(|c| c.usable_seconds == 0.0 && !c.last_observed_at.is_empty()));
}

#[tokio::test]
async fn correction_regroup_commits_lineage_atomically_and_inherits_only_shared_confirmation() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits", "Ha_003.fits", "OIII_001.fits"];
    for name in names {
        fx.write(name, name.as_bytes());
    }
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let corrected = by_name(&assets, "Ha_003.fits").clone();
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    let ha = sessions.iter().find(|s| s.session.asset_ids.len() == 3).unwrap().session.clone();
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&ha)], saved.candidate.id).await.unwrap();
    let correction = vec![CorrectionInput {
        asset_id: corrected.id,
        field: "filter".into(),
        value: serde_json::json!("OIII"),
    }];

    let error = catalog
        .apply_correction_and_regroup(&[expected(&corrected)], &correction, |_: &[Asset]| {
            GroupingResult::default()
        })
        .await
        .unwrap_err();
    assert_eq!(kind(&error), "invalid_input");
    let unchanged = catalog.asset(corrected.id).await.unwrap();
    assert_eq!(
        (unchanged.effective.filter.as_deref(), unchanged.decision_revision),
        (Some("Ha"), 0)
    );

    let preview =
        catalog.preview_correction(&[expected(&corrected)], &correction, group).await.unwrap();
    assert!(preview.proposal.lineage.is_some());
    assert_eq!(catalog.asset(corrected.id).await.unwrap().effective.filter.as_deref(), Some("Ha"));
    assert_eq!(catalog.correction_preview(preview.id).await.unwrap().id, preview.id);
    let outcome =
        catalog.confirm_correction(preview.id, &[expected(&corrected)], group).await.unwrap();
    let lineage = outcome.lineage.unwrap();
    assert!(lineage.predecessors.contains(&ha.id));
    assert_eq!(lineage.moved_assets, vec![corrected.id]);
    assert_eq!(lineage.successors.len(), 2);
    let after = catalog.asset(corrected.id).await.unwrap();
    assert_eq!(after.observed.filter.as_deref(), Some("Ha"), "original evidence retained");
    assert_eq!(after.effective.filter.as_deref(), Some("OIII"));
    let old = catalog.session(ha.id).await.unwrap();
    assert_eq!(old.summary.session.asset_ids, ha.asset_ids, "predecessor membership preserved");
    assert_eq!(old.summary.successors, lineage.successors);
    let error =
        catalog.associate_target(&[expected_session(&ha)], saved.candidate.id).await.unwrap_err();
    assert!(
        matches!(error, LibraryError::Conflict { ref successors, .. } if !successors.is_empty())
    );
    for successor in &lineage.successors {
        let detail = catalog.session(*successor).await.unwrap();
        let state = &detail.associations[0].state;
        if detail.summary.session.asset_ids.contains(&corrected.id) {
            assert_eq!(*state, AssociationState::NeedsReview, "mixed confirmation");
        } else {
            assert_eq!(*state, AssociationState::Confirmed, "every asset shared it");
        }
    }
    let again = catalog.confirm_correction(preview.id, &[expected(&corrected)], group).await;
    assert_eq!(kind(&again.unwrap_err()), "invalid_input");
    assert_eq!(tree(&fx.root), before, "headers unchanged");
}

#[tokio::test]
async fn same_size_preserved_mtime_rewrite_invalidates_reviewed_quality_after_rescan() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"original bytes A");
    fx.write("Ha_002.fits", b"original bytes B");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    catalog.set_quality(&[expected(&assets[0])], Quality::Usable, DiskProbe).await.unwrap();
    catalog.set_quality(&[expected(&assets[1])], Quality::Unusable, DiskProbe).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let unchanged = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(unchanged[0].applicable_quality(), ApplicableQuality::Usable, "positive control");

    for (name, bytes) in
        [("Ha_001.fits", b"rewritten bytesA"), ("Ha_002.fits", b"rewritten bytesB")]
    {
        let source = fx.root.join(name);
        let link = fx.temp.path().join(format!("{name}.link"));
        std::fs::hard_link(&source, &link).unwrap();
        let modified = std::fs::metadata(&source).unwrap().modified().unwrap();
        let before = file_fingerprint(&source).unwrap();
        let file = std::fs::OpenOptions::new().write(true).truncate(true).open(&link).unwrap();
        std::io::Write::write_all(&mut &file, bytes).unwrap();
        file.set_modified(modified).unwrap();
        drop(file);
        assert!(before.equivalent(&file_fingerprint(&source).unwrap()), "stats cannot detect it");
    }
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let rescanned = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(
        rescanned[0].applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Usable }
    );
    assert_eq!(
        rescanned[1].applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Unusable }
    );
    assert_eq!(rescanned[0].observation_revision, 2);
}

#[tokio::test]
async fn remap_refuses_mismatch_and_missing_byte_proof_then_verified_copy_keeps_decisions() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"frame one bytes");
    fx.write("Ha_002.fits", b"frame two bytes");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    catalog.set_quality(&[expected(&assets[0])], Quality::Usable, DiskProbe).await.unwrap();
    let location = catalog.location(location.id).await.unwrap();
    let copy = |name: &str, second: &[u8]| {
        let dir = fx.temp.path().join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Ha_001.fits"), b"frame one bytes").unwrap();
        std::fs::write(dir.join("Ha_002.fits"), second).unwrap();
        dir
    };
    let bad = copy("Copy-Bad", b"frame TWO bytes");
    let good = copy("Copy-Good", b"frame two bytes");
    let original_tree = tree(&fx.root);

    let review = catalog
        .review_remap(
            location.id,
            location.decision_revision,
            &NativePath::from_path(&bad),
            &folder_identity(&bad).unwrap(),
            DiskProbe,
        )
        .await
        .unwrap();
    assert!(review.blocked.iter().any(|block| block.reason == RemapBlockReason::Mismatch));
    let error =
        catalog.apply_remap(review.id, location.decision_revision, DiskProbe).await.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict");
    assert_eq!(catalog.location(location.id).await.unwrap().path, location.path);

    let away = fx.root.with_extension("offline");
    std::fs::rename(&fx.root, &away).unwrap();
    let review = catalog
        .review_remap(
            location.id,
            location.decision_revision,
            &NativePath::from_path(&good),
            &folder_identity(&good).unwrap(),
            DiskProbe,
        )
        .await
        .unwrap();
    assert!(review.blocked.iter().any(|block| block.reason == RemapBlockReason::NoByteProof));
    let error =
        catalog.apply_remap(review.id, location.decision_revision, DiskProbe).await.unwrap_err();
    assert_eq!(kind(&error), "no_byte_proof");
    let unchanged = catalog.location_assets(location.id).await.unwrap();
    assert!(
        unchanged.iter().zip(&assets).all(|(now, was)| now.id == was.id
            && now.relative_path == was.relative_path
            && now.fingerprint.identity == was.fingerprint.identity),
        "refused remap leaves every asset on the original root"
    );
    assert_eq!(
        catalog.location(location.id).await.unwrap().decision_revision,
        location.decision_revision
    );
    std::fs::rename(&away, &fx.root).unwrap();

    let review = catalog
        .review_remap(
            location.id,
            location.decision_revision,
            &NativePath::from_path(&good),
            &folder_identity(&good).unwrap(),
            DiskProbe,
        )
        .await
        .unwrap();
    assert!(review.blocked.is_empty(), "{:?}", review.blocked);
    let remapped =
        catalog.apply_remap(review.id, location.decision_revision, DiskProbe).await.unwrap();
    assert_eq!(remapped.path, NativePath::from_path(&good));
    let moved = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(
        moved.iter().map(|a| a.id).collect::<Vec<_>>(),
        assets.iter().map(|a| a.id).collect::<Vec<_>>()
    );
    assert_eq!(moved[0].applicable_quality(), ApplicableQuality::Usable, "decision kept");
    assert_eq!(tree(&fx.root), original_tree, "no source writes");
}

#[tokio::test]
async fn seed_facts_are_recorded_without_adoption_and_qualified_suggestions_count() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"frame one");
    fx.write("Ha_002.fits", b"frame two");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let mut seed = target("NGC 7000", "ngc 7000");
    seed.provenance = Provenance::Seed { dataset: "bundled-seed".into() };

    let mut user = seed.clone();
    user.provenance = Provenance::User;
    assert_eq!(kind(&catalog.record_seed_target(&user).await.unwrap_err()), "invalid_input");
    assert!(catalog.list_targets(0, 0).await.unwrap().is_empty(), "refusal writes nothing");
    let recorded = catalog.record_seed_target(&seed).await.unwrap();
    assert_eq!(recorded.decision_revision, 1);
    assert_eq!(catalog.record_seed_target(&seed).await.unwrap().decision_revision, 1, "idempotent");

    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let assessed = assessment(&catalog, session.id).await;
    let alias = EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true };
    let suggestion = |evidence: Vec<EvidenceItem>| SuggestedAssociation {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        kind: AssociationKind::Target,
        subject_id: Some(seed.id),
        state: AssociationState::Suggested,
        evidence,
        provenance: Provenance::Inferred { rule: "alias-and-coordinates".into() },
        expected_observations: assessed.observations.clone(),
        expected_decisions: assessed.decisions.clone(),
        expected_observation_revisions: assessed.sequences.clone(),
    };
    catalog.record_suggestions(&[suggestion(vec![alias.clone()])]).await.unwrap();
    let label_only = catalog.target_coverage(seed.id).await.unwrap();
    assert!(label_only.contributions.is_empty(), "an agreeing label alone does not count");
    let coordinates = EvidenceItem::Coordinates { ra_deg: 314.75, dec_deg: 44.33, qualified: true };
    catalog.record_suggestions(&[suggestion(vec![alias, coordinates])]).await.unwrap();
    let coverage = catalog.target_coverage(seed.id).await.unwrap();
    let captured: f64 = coverage.contributions.iter().map(|c| c.captured_seconds).sum();
    let unreviewed: f64 = coverage.contributions.iter().map(|c| c.unreviewed_seconds).sum();
    assert!((captured - 600.0).abs() < 1e-9 && (unreviewed - 600.0).abs() < 1e-9);
    assert_eq!(coverage.covered_location_ids, vec![location.id]);
    let associations = catalog.associations(session.id).await.unwrap();
    assert_eq!(associations[0].state, AssociationState::Suggested, "never auto-confirmed");
    catalog.close().await.unwrap();

    let reopened = Catalog::open(&fx.db).await.unwrap();
    let listed = reopened.list_targets(0, 0).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].candidate.provenance, Provenance::Seed { dataset: "bundled-seed".into() });
    let mut refreshed = seed.clone();
    refreshed.common_name = Some("North America Nebula".into());
    assert_eq!(reopened.record_seed_target(&refreshed).await.unwrap().decision_revision, 2);

    let mut adopted = refreshed.clone();
    adopted.provenance = Provenance::User;
    adopted.common_name = Some("My North America".into());
    reopened.save_target(&adopted, Some(2)).await.unwrap();
    let kept = reopened.record_seed_target(&seed).await.unwrap();
    assert_eq!(kept.candidate.provenance, Provenance::User, "user record never overwritten");
    assert_eq!(kept.candidate.common_name.as_deref(), Some("My North America"));
    assert_eq!(kept.decision_revision, 3);
}

/// Member snapshot exactly as a consumer reads it from `SessionDetail.assets`.
#[derive(Clone)]
struct Assessed {
    observations: BTreeMap<Uuid, ObservationFingerprint>,
    decisions: BTreeMap<Uuid, Revision>,
    sequences: BTreeMap<Uuid, Revision>,
}

async fn assessment(catalog: &Catalog, session_id: Uuid) -> Assessed {
    let assets = catalog.session(session_id).await.unwrap().assets;
    Assessed {
        observations: assets.iter().map(|a| (a.id, a.fingerprint.clone())).collect(),
        decisions: assets.iter().map(|a| (a.id, a.decision_revision)).collect(),
        sequences: assets.iter().map(|a| (a.id, a.observation_revision)).collect(),
    }
}

async fn saved_equipment(catalog: &Catalog) -> platevault_model::Equipment {
    let equipment = platevault_model::Equipment {
        id: Uuid::new_v4(),
        name: "ASI2600MM on RedCat".into(),
        camera: Some("ASI2600MM".into()),
        telescope: None,
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        decision_revision: 0,
        state: AssociationState::Unresolved,
        provenance: Provenance::User,
    };
    catalog.save_equipment(&equipment, None).await.unwrap()
}

#[tokio::test]
async fn stale_assessment_of_same_grouping_revision_is_refused_and_confirmation_kept() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"OBJECT = 'NGC 7000'");
    fx.write("Ha_002.fits", b"OBJECT = 'NGC 7000' second");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let mut seed = target("NGC 7000", "ngc 7000");
    seed.provenance = Provenance::Seed { dataset: "bundled-seed".into() };
    catalog.record_seed_target(&seed).await.unwrap();
    let equipment = saved_equipment(&catalog).await;
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let assessed = assessment(&catalog, session.id).await;
    let qualified = vec![
        EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true },
        EvidenceItem::Coordinates { ra_deg: 314.75, dec_deg: 44.33, qualified: true },
    ];
    let suggest = |kind, subject, basis: &Assessed| SuggestedAssociation {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        kind,
        subject_id: Some(subject),
        state: AssociationState::Suggested,
        evidence: qualified.clone(),
        provenance: Provenance::Inferred { rule: "alias-and-coordinates".into() },
        expected_observations: basis.observations.clone(),
        expected_decisions: basis.decisions.clone(),
        expected_observation_revisions: basis.sequences.clone(),
    };

    // The header changes on disk; capture identity and grouping revision stay the same.
    let path = fx.root.join("Ha_001.fits");
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    std::fs::write(&path, b"OBJECT = 'M 31' rewritten header").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(modified + std::time::Duration::from_secs(5))
        .unwrap();
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let mut files = vec![fx.scan_file("Ha_001.fits"), fx.scan_file("Ha_002.fits")];
    files[0].metadata.object = Some("M 31".into());
    let root = DiskProbe.root_identity(&location).unwrap();
    let batch = ScanBatch { files, ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let after = catalog.session(session.id).await.unwrap().summary.session;
    assert_eq!(after.grouping_revision, session.grouping_revision, "same grouping revision");
    assert!(catalog.session(session.id).await.unwrap().summary.successors.is_empty());

    let fresh = assessment(&catalog, session.id).await;
    let stale = catalog
        .record_suggestions(&[
            suggest(AssociationKind::Equipment, equipment.id, &fresh),
            suggest(AssociationKind::Target, seed.id, &assessed),
        ])
        .await
        .unwrap_err();
    assert_eq!(kind(&stale), "conflict");
    assert!(catalog.associations(session.id).await.unwrap().is_empty(), "all or nothing");
    assert!(catalog.target_coverage(seed.id).await.unwrap().contributions.is_empty());

    let mut partial = fresh.clone();
    partial.observations.pop_first();
    let missing_member = catalog
        .record_suggestions(&[suggest(AssociationKind::Target, seed.id, &partial)])
        .await
        .unwrap_err();
    assert_eq!(kind(&missing_member), "conflict");

    let recorded = catalog
        .record_suggestions(&[suggest(AssociationKind::Target, seed.id, &fresh)])
        .await
        .unwrap();
    assert_eq!(recorded[0].observation_basis, fresh.observations);
    assert_eq!(recorded[0].state, AssociationState::Suggested);
    let counted: f64 = catalog
        .target_coverage(seed.id)
        .await
        .unwrap()
        .contributions
        .iter()
        .map(|contribution| contribution.captured_seconds)
        .sum();
    assert!((counted - 600.0).abs() < 1e-9);

    let current = catalog.session(session.id).await.unwrap().summary.session;
    let confirmed = catalog.associate_target(&[expected_session(&current)], seed.id).await.unwrap();
    let other = catalog.save_target(&target("IC 5070", "ic 5070"), None).await.unwrap();
    let kept = catalog
        .record_suggestions(&[suggest(AssociationKind::Target, other.candidate.id, &fresh)])
        .await
        .unwrap();
    assert_eq!(kept[0].state, AssociationState::Confirmed);
    assert_eq!(kept[0].subject_id, Some(seed.id));
    let stored = catalog.associations(session.id).await.unwrap();
    assert_eq!(
        stored[0].decision_revision, confirmed[0].decision_revision,
        "confirmation untouched"
    );
    assert_eq!(stored[0].subject_id, Some(seed.id));
}

#[tokio::test]
async fn stale_assessment_after_correction_or_metadata_only_observation_is_refused() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"frame one");
    fx.write("Ha_002.fits", b"frame two");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let mut seed = target("NGC 7000", "ngc 7000");
    seed.provenance = Provenance::Seed { dataset: "bundled-seed".into() };
    catalog.record_seed_target(&seed).await.unwrap();
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let suggest = |basis: &Assessed| SuggestedAssociation {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        kind: AssociationKind::Target,
        subject_id: Some(seed.id),
        state: AssociationState::Suggested,
        evidence: vec![
            EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true },
            EvidenceItem::Coordinates { ra_deg: 314.75, dec_deg: 44.33, qualified: true },
        ],
        provenance: Provenance::Inferred { rule: "alias-and-coordinates".into() },
        expected_observations: basis.observations.clone(),
        expected_decisions: basis.decisions.clone(),
        expected_observation_revisions: basis.sequences.clone(),
    };
    let assessed = assessment(&catalog, session.id).await;

    // A catalog OBJECT correction changes effective evidence, not capture identity.
    let asset = catalog.session(session.id).await.unwrap().assets[0].clone();
    let correction = CorrectionInput {
        asset_id: asset.id,
        field: "object".into(),
        value: serde_json::json!("M 31"),
    };
    catalog.apply_correction_and_regroup(&[expected(&asset)], &[correction], group).await.unwrap();
    let detail = catalog.session(session.id).await.unwrap();
    assert_eq!(detail.summary.session.grouping_revision, session.grouping_revision);
    assert!(detail.summary.successors.is_empty());
    let corrected = assessment(&catalog, session.id).await;
    assert_eq!(corrected.observations, assessed.observations, "fingerprints cannot detect it");
    let error = catalog.record_suggestions(&[suggest(&assessed)]).await.unwrap_err();
    assert_eq!(kind(&error), "conflict");
    assert!(catalog.associations(session.id).await.unwrap().is_empty());

    // Same bytes, newly recorded header evidence: only the observation sequence moves.
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let mut files = vec![fx.scan_file("Ha_001.fits"), fx.scan_file("Ha_002.fits")];
    files[1].metadata.ra_deg = Some(314.7);
    let root = DiskProbe.root_identity(&location).unwrap();
    let batch = ScanBatch { files, ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let observed = assessment(&catalog, session.id).await;
    assert_eq!(observed.observations, corrected.observations);
    assert_ne!(observed.sequences, corrected.sequences);
    let error = catalog.record_suggestions(&[suggest(&corrected)]).await.unwrap_err();
    assert_eq!(kind(&error), "conflict");
    assert!(catalog.associations(session.id).await.unwrap().is_empty());

    let recorded = catalog.record_suggestions(&[suggest(&observed)]).await.unwrap();
    assert_eq!(recorded[0].state, AssociationState::Suggested);
    assert_eq!(recorded[0].observation_basis, observed.observations);
}

#[tokio::test]
async fn catalog_correction_invalidates_inferred_suggestions_but_keeps_confirmations() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"OBJECT = 'NGC 7000' one");
    fx.write("Ha_002.fits", b"OBJECT = 'NGC 7000' two");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let mut seed = target("NGC 7000", "ngc 7000");
    seed.provenance = Provenance::Seed { dataset: "bundled-seed".into() };
    catalog.record_seed_target(&seed).await.unwrap();
    let equipment = saved_equipment(&catalog).await;
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let confirmed =
        catalog.confirm_equipment(&[expected_session(&session)], equipment.id).await.unwrap();
    let session = catalog.session(session.id).await.unwrap().summary.session;
    let assessed = assessment(&catalog, session.id).await;
    let suggestion = SuggestedAssociation {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        kind: AssociationKind::Target,
        subject_id: Some(seed.id),
        state: AssociationState::Suggested,
        evidence: vec![
            EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true },
            EvidenceItem::Coordinates { ra_deg: 314.75, dec_deg: 44.33, qualified: true },
        ],
        provenance: Provenance::Inferred { rule: "alias-and-coordinates".into() },
        expected_observations: assessed.observations.clone(),
        expected_decisions: assessed.decisions.clone(),
        expected_observation_revisions: assessed.sequences.clone(),
    };
    catalog.record_suggestions(std::slice::from_ref(&suggestion)).await.unwrap();
    let counted = |coverage: platevault_model::TargetCoverage| -> f64 {
        coverage.contributions.iter().map(|c| c.captured_seconds).sum()
    };
    assert!((counted(catalog.target_coverage(seed.id).await.unwrap()) - 600.0).abs() < 1e-9);

    // OBJECT is outside capture identity: same session, same grouping revision.
    let asset = catalog.session(session.id).await.unwrap().assets[0].clone();
    let correction = CorrectionInput {
        asset_id: asset.id,
        field: "object".into(),
        value: serde_json::json!("M 31"),
    };
    let outcome = catalog
        .apply_correction_and_regroup(&[expected(&asset)], &[correction], group)
        .await
        .unwrap();
    assert!(outcome.lineage.is_none(), "no regroup");
    let detail = catalog.session(session.id).await.unwrap();
    assert_eq!(detail.summary.session.grouping_revision, session.grouping_revision);

    let by_kind = |kind| detail.associations.iter().find(|a| a.kind == kind).unwrap().clone();
    let inferred = by_kind(AssociationKind::Target);
    assert_eq!(inferred.state, AssociationState::NeedsReview, "stale inference not trusted");
    assert_eq!(inferred.subject_id, Some(seed.id), "evidence history retained");
    let stale_total = counted(catalog.target_coverage(seed.id).await.unwrap());
    assert!(stale_total.abs() < 1e-9, "coverage no longer counts it: {stale_total}");
    let manual = by_kind(AssociationKind::Equipment);
    assert_eq!(manual.state, AssociationState::Confirmed);
    assert_eq!(manual.decision_revision, confirmed[0].decision_revision, "confirmation untouched");
    let error = catalog.record_suggestions(&[suggestion]).await.unwrap_err();
    assert_eq!(kind(&error), "conflict", "pre-correction assessment refused");
    assert_eq!(tree(&fx.root), before, "catalog-only correction");
}

#[tokio::test]
async fn changed_observation_in_scan_batch_invalidates_inferred_suggestions_atomically() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"OBJECT = 'NGC 7000' one");
    fx.write("Ha_002.fits", b"OBJECT = 'NGC 7000' two");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let mut seed = target("NGC 7000", "ngc 7000");
    seed.provenance = Provenance::Seed { dataset: "bundled-seed".into() };
    catalog.record_seed_target(&seed).await.unwrap();
    let equipment = saved_equipment(&catalog).await;
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let confirmed =
        catalog.confirm_equipment(&[expected_session(&session)], equipment.id).await.unwrap();
    let session = catalog.session(session.id).await.unwrap().summary.session;
    let assessed = assessment(&catalog, session.id).await;
    let suggestion = SuggestedAssociation {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        kind: AssociationKind::Target,
        subject_id: Some(seed.id),
        state: AssociationState::Suggested,
        evidence: vec![
            EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true },
            EvidenceItem::Coordinates { ra_deg: 314.75, dec_deg: 44.33, qualified: true },
        ],
        provenance: Provenance::Inferred { rule: "alias-and-coordinates".into() },
        expected_observations: assessed.observations,
        expected_decisions: assessed.decisions,
        expected_observation_revisions: assessed.sequences,
    };
    catalog.record_suggestions(&[suggestion]).await.unwrap();
    let total = |coverage: platevault_model::TargetCoverage| -> f64 {
        coverage.contributions.iter().map(|c| c.captured_seconds).sum()
    };
    assert!((total(catalog.target_coverage(seed.id).await.unwrap()) - 600.0).abs() < 1e-9);

    // An unchanged rescan batch keeps the assessment.
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(&location).unwrap();
    let unchanged = ScanBatch { files: vec![fx.scan_file("Ha_002.fits")], ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root, &unchanged, group).await.unwrap();
    let kept = catalog.associations(session.id).await.unwrap();
    let target_of = |list: &[Association]| {
        list.iter().find(|a| a.kind == AssociationKind::Target).unwrap().clone()
    };
    assert_eq!(target_of(&kept).state, AssociationState::Suggested, "positive control");

    // The next batch observes a changed header; no new assessment is supplied.
    let mut changed = fx.scan_file("Ha_001.fits");
    changed.metadata.object = Some("M 31".into());
    let batch = ScanBatch { files: vec![changed], ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let detail = catalog.session(session.id).await.unwrap();
    assert_eq!(detail.summary.session.grouping_revision, session.grouping_revision);
    let inferred = target_of(&detail.associations);
    assert_eq!(inferred.state, AssociationState::NeedsReview);
    assert_eq!(inferred.subject_id, Some(seed.id), "evidence history retained");
    let stale = total(catalog.target_coverage(seed.id).await.unwrap());
    assert!(stale.abs() < 1e-9, "stale inference no longer counts: {stale}");
    let manual = detail.associations.iter().find(|a| a.kind == AssociationKind::Equipment).unwrap();
    assert_eq!(manual.state, AssociationState::Confirmed);
    assert_eq!(manual.decision_revision, confirmed[0].decision_revision);
}

#[tokio::test]
async fn new_member_joining_assessed_session_invalidates_inferred_suggestion() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"OBJECT = 'NGC 7000' one");
    fx.write("Ha_002.fits", b"OBJECT = 'NGC 7000' two");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let mut seed = target("NGC 7000", "ngc 7000");
    seed.provenance = Provenance::Seed { dataset: "bundled-seed".into() };
    catalog.record_seed_target(&seed).await.unwrap();
    let equipment = saved_equipment(&catalog).await;
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let confirmed =
        catalog.confirm_equipment(&[expected_session(&session)], equipment.id).await.unwrap();
    let session = catalog.session(session.id).await.unwrap().summary.session;
    let assessed = assessment(&catalog, session.id).await;
    let suggestion = SuggestedAssociation {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        kind: AssociationKind::Target,
        subject_id: Some(seed.id),
        state: AssociationState::Suggested,
        evidence: vec![
            EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true },
            EvidenceItem::Coordinates { ra_deg: 314.75, dec_deg: 44.33, qualified: true },
        ],
        provenance: Provenance::Inferred { rule: "alias-and-coordinates".into() },
        expected_observations: assessed.observations,
        expected_decisions: assessed.decisions,
        expected_observation_revisions: assessed.sequences,
    };
    catalog.record_suggestions(&[suggestion]).await.unwrap();

    // A third frame with the same capture key but another OBJECT joins the session.
    fx.write("Ha_003.fits", b"OBJECT = 'M 31' three");
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(&location).unwrap();
    let mut joining = fx.scan_file("Ha_003.fits");
    joining.metadata.object = Some("M 31".into());
    let batch = ScanBatch { files: vec![joining], ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let detail = catalog.session(session.id).await.unwrap();
    assert_eq!(detail.summary.session.asset_ids.len(), 3, "same session grew");
    let inferred = detail.associations.iter().find(|a| a.kind == AssociationKind::Target).unwrap();
    assert_eq!(inferred.state, AssociationState::NeedsReview, "new member was never assessed");
    let total: f64 = catalog
        .target_coverage(seed.id)
        .await
        .unwrap()
        .contributions
        .iter()
        .map(|contribution| contribution.captured_seconds)
        .sum();
    assert!(total.abs() < 1e-9, "no coverage from an old assessment: {total}");
    let manual = detail.associations.iter().find(|a| a.kind == AssociationKind::Equipment).unwrap();
    assert_eq!(manual.state, AssociationState::Confirmed, "explicit confirmation kept");
    assert_eq!(manual.decision_revision, confirmed[0].decision_revision);
}

#[tokio::test]
async fn failed_subtree_retry_reports_unreadable_scope_and_keeps_location_available() {
    let fx = Fixture::new();
    fx.write("night1/Ha_001.fits", b"frame one");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["night1/Ha_001.fits"]).await;
    let missing = NativePath::from_path(Path::new("night9"));

    let operation = catalog.retry_scope(location.id, missing.clone()).await.unwrap();
    let failed = catalog
        .abort_scan(operation.id, ScanState::Failed, "night9: No such file or directory")
        .await
        .unwrap();
    assert_eq!(failed.state, ScanState::Failed);
    let issue = failed.issues.iter().find(|issue| issue.relative_path == missing).unwrap();
    assert_eq!(issue.availability, Availability::Unreadable, "failed scope is not available");
    assert!(failed.incomplete_scopes.contains(&missing));
    assert!(failed.complete_scopes.is_empty());
    let after = catalog.location(location.id).await.unwrap();
    assert_eq!(after.availability, Availability::Available, "root location state unchanged");
    assert!(catalog.location_failure(location.id).await.unwrap().is_none());
    let assets = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(assets[0].availability, Availability::Available, "no Missing claim");

    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let canceled =
        catalog.abort_scan(operation.id, ScanState::Canceled, "canceled by user").await.unwrap();
    let issue = canceled.issues.iter().find(|issue| issue.reason == "canceled by user").unwrap();
    assert_eq!(issue.availability, Availability::Available, "cancellation is not a file failure");

    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    catalog
        .mark_location_unavailable(location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let offline = catalog.abort_scan(operation.id, ScanState::Failed, "volume gone").await.unwrap();
    let issue = offline.issues.iter().find(|issue| issue.reason == "volume gone").unwrap();
    assert_eq!(issue.availability, Availability::Offline, "known location failure preserved");
}

/// Recorded capabilities of a case- and normalization-insensitive volume.
fn insensitive_volume() -> VolumeIdentity {
    VolumeIdentity {
        case: PathSensitivity::Insensitive,
        normalization: PathSensitivity::Insensitive,
        ..volume()
    }
}

/// Real no-follow probe reporting the insensitive volume's recorded capabilities.
struct InsensitiveProbe;

impl SourceProbe for InsensitiveProbe {
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
        let mut fingerprint = file_fingerprint(path)?;
        fingerprint.identity.volume = insensitive_volume();
        Ok(fingerprint)
    }
    fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
        let mut identity = folder_identity(&location.path.to_path_buf()?)?;
        identity.volume = insensitive_volume();
        Ok(identity)
    }
}

async fn register_insensitive(catalog: &Catalog, fx: &Fixture) -> Location {
    let mut registration = fx.registration();
    registration.identity.volume = insensitive_volume();
    catalog.register_location(&registration).await.unwrap()
}

async fn scan_files(catalog: &Catalog, location: &Location, files: Vec<ScanFile>) -> ScanOperation {
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = InsensitiveProbe.root_identity(location).unwrap();
    let batch = ScanBatch { files: files.clone(), ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
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
            |location| InsensitiveProbe.root_identity(location),
            group,
        )
        .await
        .unwrap()
}

fn insensitive_file(fx: &Fixture, relative: &str) -> ScanFile {
    let mut file = fx.scan_file(relative);
    file.fingerprint.identity.volume = insensitive_volume();
    file
}

#[tokio::test]
async fn reviewed_case_variant_same_stat_rewrite_is_rehashed_and_invalidated() {
    let fx = Fixture::new();
    fx.write("night1/Ha_001.fits", b"original bytes A");
    fx.write("night1/Ha_002.fits", b"original bytes B");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = register_insensitive(&catalog, &fx).await;
    let files = ["night1/Ha_001.fits", "night1/Ha_002.fits"];
    scan_files(&catalog, &location, files.iter().map(|name| insensitive_file(&fx, name)).collect())
        .await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let expected: Vec<_> = assets.iter().map(expected).collect();
    catalog.set_quality(&expected, Quality::Usable, InsensitiveProbe).await.unwrap();

    for name in ["Ha_001.fits", "Ha_002.fits"] {
        let upper = name.to_uppercase().replace(".FITS", ".fits");
        std::fs::rename(fx.root.join("night1").join(name), fx.root.join("night1").join(upper))
            .unwrap();
    }
    let rewritten = fx.root.join("night1/HA_001.fits");
    let before = file_fingerprint(&rewritten).unwrap();
    let modified = std::fs::metadata(&rewritten).unwrap().modified().unwrap();
    let file = std::fs::OpenOptions::new().write(true).truncate(true).open(&rewritten).unwrap();
    std::io::Write::write_all(&mut &file, b"rewritten bytesA").unwrap();
    file.set_modified(modified).unwrap();
    drop(file);
    assert!(before.equivalent(&file_fingerprint(&rewritten).unwrap()), "stats cannot detect it");

    // The progressive batch is the first and only delivery of the variant spelling;
    // the decision must already be invalidated when it commits.
    let variants: Vec<ScanFile> = ["night1/HA_001.fits", "night1/HA_002.fits"]
        .iter()
        .map(|name| insensitive_file(&fx, name))
        .collect();
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = InsensitiveProbe.root_identity(&location).unwrap();
    let batch = ScanBatch { files: variants, ..ScanBatch::default() };
    let status = catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    assert!(status.issues.is_empty(), "{:?}", status.issues);
    let rescanned = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(rescanned.len(), 2, "variant spelling reuses the asset identity");
    let changed =
        rescanned.iter().find(|asset| asset.id == by_name(&assets, "Ha_001.fits").id).unwrap();
    assert_eq!(changed.relative_path, NativePath::from_path(Path::new("night1/HA_001.fits")));
    assert_eq!(
        changed.applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Usable }
    );
    assert_eq!(changed.fingerprint.content_sha256, Some(sha_of(&rewritten)));
    let kept =
        rescanned.iter().find(|asset| asset.id == by_name(&assets, "Ha_002.fits").id).unwrap();
    assert_eq!(
        kept.applicable_quality(),
        ApplicableQuality::Usable,
        "unchanged bytes keep the decision"
    );
}

/// Same size and nanosecond mtime; the file id is the only identity evidence.
fn variant_file(relative: &str, file_id: Option<&str>) -> ScanFile {
    ScanFile {
        relative_path: NativePath::from_path(Path::new(relative)),
        fingerprint: ObservationFingerprint {
            identity: FileIdentity {
                volume: insensitive_volume(),
                file_id: file_id.map(str::to_owned),
            },
            size_bytes: 2880,
            modified_ns: 1_759_000_000_123_456_789,
            content_sha256: None,
        },
        format: ImageFormat::Fits,
        metadata: metadata_for(relative),
    }
}

#[tokio::test]
async fn case_variant_without_qualified_file_identity_is_refused_without_adoption_or_absence() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = register_insensitive(&catalog, &fx).await;
    scan_files(
        &catalog,
        &location,
        vec![variant_file("Frame.fits", None), variant_file("FRAME.fits", None)],
    )
    .await;
    let before = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(before.len(), 2);

    let operation = scan_files(&catalog, &location, vec![variant_file("frame.fits", None)]).await;
    assert_eq!(operation.state, ScanState::Partial);
    assert!(operation
        .issues
        .iter()
        .any(|issue| issue.availability == Availability::IdentityConflict
            && issue.reason.contains("without qualified file identity")));
    let after = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(after.len(), 2, "no third record and no adoption");
    for asset in &after {
        assert_eq!(asset.availability, Availability::IdentityConflict, "never Missing");
        let prior = before.iter().find(|prior| prior.id == asset.id).unwrap();
        assert_eq!(asset.relative_path, prior.relative_path);
        assert_eq!(asset.fingerprint, prior.fingerprint);
    }
}

#[tokio::test]
async fn case_equivalent_different_file_with_distinct_qualified_id_is_never_adopted() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = register_insensitive(&catalog, &fx).await;
    scan_files(&catalog, &location, vec![variant_file("Frame.fits", Some("11"))]).await;
    let before = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(before.len(), 1);
    let old = before[0].clone();

    let operation =
        scan_files(&catalog, &location, vec![variant_file("FRAME.fits", Some("12"))]).await;
    assert_eq!(operation.state, ScanState::Partial, "uncertain old variant scope");
    assert!(operation.incomplete_scopes.contains(&old.relative_path));
    let after = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(after.len(), 2, "different file identity creates a separate record");
    let kept = after.iter().find(|asset| asset.id == old.id).unwrap();
    assert_eq!(kept.relative_path, old.relative_path);
    assert_eq!(kept.fingerprint.identity.file_id.as_deref(), Some("11"));
    assert_eq!(kept.observation_revision, old.observation_revision);
    assert_eq!(kept.availability, Availability::Available, "not Missing");
    let added = after.iter().find(|asset| asset.id != old.id).unwrap();
    assert_eq!(added.relative_path, NativePath::from_path(Path::new("FRAME.fits")));
    assert_eq!(added.fingerprint.identity.file_id.as_deref(), Some("12"));

    let renamed =
        scan_files(&catalog, &location, vec![variant_file("frame.fits", Some("11"))]).await;
    assert!(renamed.issues.is_empty(), "{:?}", renamed.issues);
    let adopted = catalog.asset(old.id).await.unwrap();
    assert_eq!(adopted.relative_path, NativePath::from_path(Path::new("frame.fits")));
    assert_eq!(catalog.location_assets(location.id).await.unwrap().len(), 2);
}

#[tokio::test]
async fn target_generation_advances_only_with_committed_target_writes_and_survives_restart() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    assert_eq!(catalog.target_generation().await.unwrap(), 0);
    let mut seed = target("NGC 7000", "ngc 7000");
    seed.provenance = Provenance::Seed { dataset: "bundled-seed".into() };
    catalog.record_seed_target(&seed).await.unwrap();
    assert_eq!(catalog.target_generation().await.unwrap(), 1);
    catalog.record_seed_target(&seed).await.unwrap();
    assert_eq!(catalog.target_generation().await.unwrap(), 1, "no-op seed fact");

    let mut edited = seed.clone();
    edited.provenance = Provenance::User;
    let stale = catalog.save_target(&edited, Some(7)).await.unwrap_err();
    assert_eq!(kind(&stale), "conflict");
    assert_eq!(catalog.target_generation().await.unwrap(), 1, "refused write");
    let duplicate = catalog.save_target(&edited, None).await.unwrap_err();
    assert_eq!(kind(&duplicate), "conflict");
    assert_eq!(catalog.target_generation().await.unwrap(), 1);

    catalog.save_target(&edited, Some(1)).await.unwrap();
    assert_eq!(catalog.target_generation().await.unwrap(), 2);
    catalog.record_seed_target(&seed).await.unwrap();
    assert_eq!(catalog.target_generation().await.unwrap(), 2, "user record kept");
    catalog.save_target(&target("IC 5070", "ic 5070"), None).await.unwrap();
    assert_eq!(catalog.target_generation().await.unwrap(), 3);
    catalog.close().await.unwrap();

    let reopened = Catalog::open(&fx.db).await.unwrap();
    assert_eq!(reopened.target_generation().await.unwrap(), 3, "restart persists");
    assert_eq!(reopened.list_targets(0, 0).await.unwrap().len(), 2);
}

#[tokio::test]
async fn overlapping_roots_on_the_same_volume_are_refused() {
    let fx = Fixture::new();
    std::fs::create_dir_all(fx.root.join("night1")).unwrap();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    catalog.register_location(&fx.registration()).await.unwrap();
    for path in [fx.root.clone(), fx.root.join("night1"), fx.root.parent().unwrap().to_path_buf()] {
        let registration = LocationRegistration {
            name: "overlap".into(),
            path: NativePath::from_path(&path),
            role: LocationRole::Calibration,
            identity: folder_identity(&path).unwrap(),
        };
        let error = catalog.register_location(&registration).await.unwrap_err();
        assert_eq!(kind(&error), "identity_conflict", "{}", path.display());
    }
    assert_eq!(catalog.list_locations().await.unwrap().len(), 1);
}

/// Rescan of exactly these observed files through one batch and the terminal pass.
async fn rescan_files(catalog: &Catalog, location: &Location, files: Vec<ScanFile>) {
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(location).unwrap();
    let batch = ScanBatch { files: files.clone(), ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
        files,
        issues: Vec::new(),
        complete_scopes: vec![root_scope()],
        incomplete_scopes: Vec::new(),
        progress: ScanProgress::default(),
        state: ScanState::Completed,
    };
    let finished = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap();
    assert_eq!(finished.state, ScanState::Completed);
}

fn inheritance_conflict(association: &Association) -> bool {
    association.state == AssociationState::NeedsReview
        && association.provenance
            == Provenance::Inferred { rule: "regroup-confirmation-inheritance".into() }
        && matches!(association.evidence.as_slice(), [EvidenceItem::Conflict { .. }])
}

#[tokio::test]
async fn inherited_confirmation_conflicts_survive_automatic_rescans_and_regroups() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits", "OIII_001.fits"];
    for name in names {
        fx.write(name, name.as_bytes());
    }
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    let ha = sessions.iter().find(|s| s.session.asset_ids.len() == 2).unwrap().session.clone();
    let oiii = sessions.iter().find(|s| s.session.asset_ids.len() == 1).unwrap().session.clone();
    let ngc = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let ic = catalog.save_target(&target("IC 5070", "ic 5070"), None).await.unwrap();
    let equipment = saved_equipment(&catalog).await;
    catalog.associate_target(&[expected_session(&ha)], ngc.candidate.id).await.unwrap();
    catalog.associate_target(&[expected_session(&oiii)], ic.candidate.id).await.unwrap();
    let ha = catalog.session(ha.id).await.unwrap().summary.session;
    catalog.confirm_equipment(&[expected_session(&ha)], equipment.id).await.unwrap();

    // Correcting the OIII frame to Ha merges frames the user confirmed as two
    // different targets, and frames with and without an equipment confirmation.
    let assets = catalog.location_assets(location.id).await.unwrap();
    let moved = by_name(&assets, "OIII_001.fits").clone();
    let correction =
        vec![CorrectionInput { asset_id: moved.id, field: "filter".into(), value: "Ha".into() }];
    let outcome = catalog
        .apply_correction_and_regroup(&[expected(&moved)], &correction, group)
        .await
        .unwrap();
    let merged = outcome.sessions[0].id;
    let pending = catalog.associations(merged).await.unwrap();
    assert_eq!(pending.len(), 2, "{pending:?}");
    assert!(pending.iter().all(inheritance_conflict), "{pending:?}");

    // An unchanged rescan and its automatic assessments keep both review conflicts.
    let files: Vec<ScanFile> = names.iter().map(|name| fx.scan_file(name)).collect();
    rescan_files(&catalog, &location, files.clone()).await;
    let current = catalog.session(merged).await.unwrap().summary.session;
    let assessed = assessment(&catalog, merged).await;
    let suggest = |kind, subject| SuggestedAssociation {
        session_id: merged,
        grouping_revision: current.grouping_revision,
        kind,
        subject_id: Some(subject),
        state: AssociationState::Suggested,
        evidence: vec![
            EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true },
            EvidenceItem::Coordinates { ra_deg: 314.75, dec_deg: 44.33, qualified: true },
        ],
        provenance: Provenance::Inferred { rule: "alias-and-coordinates".into() },
        expected_observations: assessed.observations.clone(),
        expected_decisions: assessed.decisions.clone(),
        expected_observation_revisions: assessed.sequences.clone(),
    };
    catalog
        .record_suggestions(&[
            suggest(AssociationKind::Target, ngc.candidate.id),
            suggest(AssociationKind::Equipment, equipment.id),
        ])
        .await
        .unwrap();
    let kept = catalog.associations(merged).await.unwrap();
    assert_eq!(kept.len(), 2);
    assert!(kept.iter().all(inheritance_conflict), "automatic rows never replace them: {kept:?}");
    for target in [ngc.candidate.id, ic.candidate.id] {
        let coverage = catalog.target_coverage(target).await.unwrap();
        assert!(coverage.contributions.is_empty(), "frames under review never count");
    }

    // A rescan that moves one frame out regroups the merged session; every
    // successor still waits for the user's review.
    let mut regrouped = files;
    regrouped[1].metadata.filter = Some("OIII".into());
    rescan_files(&catalog, &location, regrouped).await;
    let successors = catalog.session(merged).await.unwrap().summary.successors;
    assert_eq!(successors.len(), 2, "merged session superseded");
    for successor in successors {
        let associations = catalog.associations(successor).await.unwrap();
        assert_eq!(associations.len(), 2, "{associations:?}");
        assert!(associations.iter().all(inheritance_conflict), "{associations:?}");
    }
    assert_eq!(tree(&fx.root), before, "headers unchanged");
}

fn registration_at(path: &Path) -> LocationRegistration {
    LocationRegistration {
        name: path.file_name().unwrap().to_string_lossy().into_owned(),
        path: NativePath::from_path(path),
        role: LocationRole::Captures,
        identity: folder_identity(path).unwrap(),
    }
}

#[tokio::test]
async fn overlap_follows_canonical_ancestry_through_aliases_and_fails_closed() {
    let fx = Fixture::new();
    let volume_root = fx.root.parent().unwrap().to_path_buf();
    std::fs::create_dir_all(fx.root.join("night1")).unwrap();
    // A linked home folder pointing into the capture volume.
    let link = fx.temp.path().join("linked-T7");
    std::os::unix::fs::symlink(&volume_root, &link).unwrap();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let linked = catalog.register_location(&registration_at(&link.join("Captures"))).await.unwrap();
    assert_eq!(linked.path, NativePath::from_path(&link.join("Captures")), "stored as given");
    for path in [volume_root.clone(), fx.root.clone(), fx.root.join("night1")] {
        let error = catalog.register_location(&registration_at(&path)).await.unwrap_err();
        assert_eq!(kind(&error), "identity_conflict", "{}", path.display());
    }
    // macOS temporary folders live below /var, a link to /private/var.
    #[cfg(target_os = "macos")]
    {
        let canonical = std::fs::canonicalize(&fx.root).unwrap();
        assert!(fx.root.starts_with("/var") && canonical.starts_with("/private/var"));
        let error = catalog
            .register_location(&registration_at(&canonical.join("night1")))
            .await
            .unwrap_err();
        assert_eq!(kind(&error), "identity_conflict");
    }
    assert_eq!(catalog.list_locations().await.unwrap().len(), 1);

    // A path that does not resolve is refused. While a registered root on the
    // volume no longer resolves, the folder that now holds it is refused, naming the
    // root and where it was found, and an unrelated folder registers.
    let elsewhere = fx.temp.path().join("Elsewhere");
    std::fs::create_dir_all(elsewhere.join("Flats")).unwrap();
    std::fs::rename(&link, fx.temp.path().join("renamed-link")).unwrap();
    let mut unresolved = registration_at(&elsewhere.join("Flats"));
    unresolved.path = NativePath::from_path(&elsewhere.join("Darks"));
    catalog.register_location(&unresolved).await.unwrap_err();
    let error = catalog.register_location(&registration_at(&volume_root)).await.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict");
    let found = std::fs::canonicalize(&fx.root).unwrap().display().to_string();
    let message = error.to_string();
    assert!(
        message.contains("\"Captures\"")
            && message.contains(&found)
            && message.contains("reselect"),
        "{message}"
    );
    assert_eq!(catalog.list_locations().await.unwrap().len(), 1, "refusals write nothing");
    catalog.register_location(&registration_at(&elsewhere)).await.unwrap();
}

#[tokio::test]
async fn sibling_roots_that_no_longer_resolve_never_block_their_recovery() {
    let fx = Fixture::new();
    let volume = fx.temp.path().join("T7");
    let astro = volume.join("Astro");
    for name in ["Lights", "Calibration"] {
        std::fs::create_dir_all(astro.join(name).join("night1")).unwrap();
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let lights = catalog.register_location(&registration_at(&astro.join("Lights"))).await.unwrap();
    let calibration =
        catalog.register_location(&registration_at(&astro.join("Calibration"))).await.unwrap();

    // The folder above both roots is renamed, as when the volume remounts under
    // another name: neither stored root resolves any more.
    let moved = volume.join("Astro 1");
    std::fs::rename(&astro, &moved).unwrap();
    // A stale root refuses its recorded folder, a folder below it, a new folder at
    // its stored path and the renamed ancestor that now holds it, naming the root.
    std::fs::create_dir_all(astro.join("Lights")).unwrap();
    for path in [
        moved.clone(),
        moved.join("Calibration"),
        moved.join("Calibration/night1"),
        astro.join("Lights"),
    ] {
        let error = catalog.register_location(&registration_at(&path)).await.unwrap_err();
        assert_eq!(kind(&error), "identity_conflict", "{}", path.display());
    }
    let error = catalog.register_location(&registration_at(&moved)).await.unwrap_err();
    assert!(error.to_string().contains("no longer resolves"), "{error}");
    std::fs::remove_dir_all(&astro).unwrap();
    assert_eq!(catalog.list_locations().await.unwrap().len(), 2, "refusals write nothing");

    // Each root is chosen again at its new path while its sibling is still stale.
    let path = moved.join("Lights");
    let reselected = catalog
        .reselect_location(
            lights.id,
            lights.decision_revision,
            &NativePath::from_path(&path),
            &folder_identity(&path).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reselected.path, NativePath::from_path(&path));
    // While its sibling is still stale, a folder inside that sibling is refused and an
    // unrelated folder registers.
    let inside = moved.join("Calibration/night1");
    let error = catalog.register_location(&registration_at(&inside)).await;
    assert!(error.unwrap_err().to_string().contains("\"Calibration\""));
    std::fs::create_dir_all(volume.join("Flats")).unwrap();
    catalog.register_location(&registration_at(&volume.join("Flats"))).await.unwrap();
    let path = moved.join("Calibration");
    catalog
        .reselect_location(
            calibration.id,
            calibration.decision_revision,
            &NativePath::from_path(&path),
            &folder_identity(&path).unwrap(),
        )
        .await
        .unwrap();
    // Once both resolve, the ancestor holding them overlaps.
    let error = catalog.register_location(&registration_at(&moved)).await.unwrap_err();
    assert!(error.to_string().contains("folder overlaps"), "{error}");
    assert_eq!(catalog.list_locations().await.unwrap().len(), 3);
}

#[tokio::test]
async fn a_deleted_or_moved_root_blocks_only_the_folders_that_hold_it() {
    use std::os::unix::fs::PermissionsExt;
    struct Restore(PathBuf);
    impl Drop for Restore {
        fn drop(&mut self) {
            let _ = std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(0o755));
        }
    }

    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"frame one bytes");
    fx.write("Ha_002.fits", b"frame two bytes");
    let volume = fx.root.parent().unwrap().to_path_buf();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let captures = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &captures, &["Ha_001.fits", "Ha_002.fits"]).await;
    let (test, darks) = (volume.join("Test"), volume.join("Darks"));
    std::fs::create_dir_all(&test).unwrap();
    std::fs::create_dir_all(darks.join("night1")).unwrap();
    std::fs::write(darks.join("night1/Dark_001.fits"), b"dark frame bytes").unwrap();
    catalog.register_location(&registration_at(&test)).await.unwrap();
    let dark_root = catalog.register_location(&registration_at(&darks)).await.unwrap();
    let originals = tree(&fx.root);
    let dark_frames = tree(&darks);

    // One root is deleted and the other moves into an archive folder: neither stored
    // root resolves, and the deleted one can never be reselected.
    std::fs::remove_dir_all(&test).unwrap();
    let archive = volume.join("Archive");
    let moved = archive.join("Darks");
    std::fs::create_dir_all(&archive).unwrap();
    std::fs::rename(&darks, &moved).unwrap();

    // An unrelated sibling registers.
    let flats = volume.join("Flats");
    std::fs::create_dir_all(flats.join("night1")).unwrap();
    catalog.register_location(&registration_at(&flats)).await.unwrap();

    // The folder now holding the moved root is refused, naming the root and where
    // it is.
    let error = catalog.register_location(&registration_at(&archive)).await.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict");
    let found = std::fs::canonicalize(&moved).unwrap().display().to_string();
    let message = error.to_string();
    assert!(
        message.contains("\"Darks\"") && message.contains(&found) && message.contains("reselect"),
        "{message}"
    );

    // A folder that cannot be searched completely is refused, naming the way out.
    let lights = volume.join("Lights");
    std::fs::create_dir_all(lights.join("private")).unwrap();
    std::fs::set_permissions(lights.join("private"), std::fs::Permissions::from_mode(0o000))
        .unwrap();
    let restore = Restore(lights.join("private"));
    if std::fs::read_dir(lights.join("private")).is_ok() {
        eprintln!("permission denial is not enforceable for this user; unsearchable case skipped");
    } else {
        let error = catalog.register_location(&registration_at(&lights)).await.unwrap_err();
        assert_eq!(kind(&error), "identity_conflict");
        let message = error.to_string();
        assert!(
            message.contains("cannot be searched") && message.contains("reselect"),
            "{message}"
        );
    }
    drop(restore);
    catalog.register_location(&registration_at(&lights)).await.unwrap();

    // The scanned location is remapped onto a verified copy on the same volume.
    let copy = volume.join("Captures copy");
    std::fs::create_dir_all(&copy).unwrap();
    for name in ["Ha_001.fits", "Ha_002.fits"] {
        std::fs::copy(fx.root.join(name), copy.join(name)).unwrap();
    }
    let captures = catalog.location(captures.id).await.unwrap();
    let review = catalog
        .review_remap(
            captures.id,
            captures.decision_revision,
            &NativePath::from_path(&copy),
            &folder_identity(&copy).unwrap(),
            DiskProbe,
        )
        .await
        .unwrap();
    assert!(review.blocked.is_empty(), "{:?}", review.blocked);
    let remapped =
        catalog.apply_remap(review.id, captures.decision_revision, DiskProbe).await.unwrap();
    assert_eq!(remapped.path, NativePath::from_path(&copy));

    // The moved root is chosen again where it now is.
    let reselected = catalog
        .reselect_location(
            dark_root.id,
            dark_root.decision_revision,
            &NativePath::from_path(&moved),
            &folder_identity(&moved).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reselected.path, NativePath::from_path(&moved));
    assert_eq!(catalog.list_locations().await.unwrap().len(), 5);
    assert_eq!(tree(&fx.root), originals, "originals unchanged");
    assert_eq!(tree(&moved), dark_frames, "moved originals unchanged");
}

#[tokio::test]
async fn without_folder_identity_a_stale_root_refuses_and_names_the_way_out() {
    let fx = Fixture::new();
    let volume = fx.root.parent().unwrap().to_path_buf();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    // A volume that records file ids but does not keep them stable.
    let unstable = |path: &Path| {
        let mut registration = registration_at(path);
        registration.identity.volume.file_ids_stable = false;
        registration
    };
    let test = volume.join("Test");
    std::fs::create_dir_all(&test).unwrap();
    catalog.register_location(&unstable(&test)).await.unwrap();
    std::fs::remove_dir_all(&test).unwrap();

    let flats = volume.join("Flats");
    std::fs::create_dir_all(&flats).unwrap();
    let error = catalog.register_location(&unstable(&flats)).await.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict");
    let message = error.to_string();
    let way_out = format!("restore a folder at {}", test.display());
    assert!(
        message.contains("\"Test\"") && message.contains("reselect") && message.contains(&way_out),
        "{message}"
    );
    assert_eq!(catalog.list_locations().await.unwrap().len(), 1, "refusals write nothing");

    // The named way out: a folder at the stored path resolves again.
    std::fs::create_dir_all(&test).unwrap();
    catalog.register_location(&unstable(&flats)).await.unwrap();
}

#[tokio::test]
async fn root_loss_during_a_subtree_retry_changes_availability_only_inside_its_scope() {
    let fx = Fixture::new();
    fx.write("night1/Ha_001.fits", b"frame one");
    fx.write("night2/Ha_002.fits", b"frame two");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["night1/Ha_001.fits", "night2/Ha_002.fits"]).await;
    let night1 = NativePath::from_path(Path::new("night1"));

    let operation = catalog.retry_scope(location.id, night1.clone()).await.unwrap();
    let root = DiskProbe.root_identity(&location).unwrap();
    // The walker reports root continuity loss at the location root path.
    let lost = ScanIssue {
        relative_path: root_scope(),
        reason: "location root became unavailable during the scan".into(),
        availability: Availability::Offline,
    };
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
        files: Vec::new(),
        issues: vec![lost],
        complete_scopes: Vec::new(),
        incomplete_scopes: vec![night1.clone()],
        progress: ScanProgress::default(),
        state: ScanState::Failed,
    };
    let failed = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap();
    assert_eq!(failed.state, ScanState::Failed);
    assert!(failed.issues.iter().any(|issue| issue.relative_path == root_scope()), "reported");
    assert_eq!(failed.incomplete_scopes, vec![night1], "{failed:?}");
    let assets = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(by_name(&assets, "Ha_001.fits").availability, Availability::Offline);
    assert_eq!(
        by_name(&assets, "Ha_002.fits").availability,
        Availability::Available,
        "siblings outside the retried scope keep their state"
    );

    // An issue for a path the operation never covered is refused, not applied.
    let operation =
        catalog.retry_scope(location.id, NativePath::from_path(Path::new("night1"))).await.unwrap();
    let outside = ScanBatch {
        issues: vec![ScanIssue {
            relative_path: NativePath::from_path(Path::new("night2")),
            reason: "listing interrupted".into(),
            availability: Availability::Unreadable,
        }],
        ..ScanBatch::default()
    };
    let root = DiskProbe.root_identity(&location).unwrap();
    let error = catalog.apply_scan_batch(operation.id, &root, &outside, group).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input");
    let assets = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(by_name(&assets, "Ha_002.fits").availability, Availability::Available);
    assert_eq!(tree(&fx.root), before);
}

/// Replace a fixture's bytes in place with equal length and its original mtime.
fn rewrite_same_stat(fx: &Fixture, name: &str, bytes: &[u8]) {
    let source = fx.root.join(name);
    let before = file_fingerprint(&source).unwrap();
    assert_eq!(before.size_bytes, bytes.len() as u64);
    let modified = std::fs::metadata(&source).unwrap().modified().unwrap();
    let file = std::fs::OpenOptions::new().write(true).truncate(true).open(&source).unwrap();
    std::io::Write::write_all(&mut &file, bytes).unwrap();
    file.set_modified(modified).unwrap();
    drop(file);
    assert!(before.equivalent(&file_fingerprint(&source).unwrap()), "stats cannot detect it");
}

#[tokio::test]
async fn terminal_pass_reuses_batch_proof_and_reads_each_decided_frame_once_per_scan() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"reviewed bytes A");
    fx.write("Ha_002.fits", b"second frame");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let reviewed = by_name(&assets, "Ha_001.fits").clone();
    catalog.set_quality(&[expected(&reviewed)], Quality::Usable, DiskProbe).await.unwrap();

    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(&location).unwrap();
    let files: Vec<ScanFile> = names.iter().map(|name| fx.scan_file(name)).collect();
    let denied = ScanIssue {
        relative_path: NativePath::from_path(Path::new("night9")),
        reason: "listing interrupted".into(),
        availability: Availability::Unreadable,
    };
    let batch = ScanBatch {
        files: files.clone(),
        issues: vec![denied.clone()],
        progress: ScanProgress::default(),
    };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let proven = catalog.asset(reviewed.id).await.unwrap();
    assert_eq!(proven.applicable_quality(), ApplicableQuality::Usable, "batch rehash matched");

    // The bytes change after the batch proved them. A terminal pass that read
    // the reviewed frame a second time would see the replacement now.
    rewrite_same_stat(&fx, "Ha_001.fits", b"replaced bytes B");
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
        files,
        issues: vec![denied.clone()],
        complete_scopes: vec![root_scope()],
        incomplete_scopes: vec![denied.relative_path.clone()],
        progress: ScanProgress::default(),
        state: ScanState::Partial,
    };
    let finished = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap();
    assert_eq!(finished.state, ScanState::Partial);
    let recorded =
        finished.issues.iter().filter(|issue| issue.relative_path == denied.relative_path);
    assert_eq!(recorded.count(), 1, "a batch issue is recorded once: {finished:?}");
    let kept = catalog.asset(reviewed.id).await.unwrap();
    assert_eq!(kept.fingerprint, proven.fingerprint, "the terminal pass did not re-read it");
    assert_eq!(kept.observation_revision, proven.observation_revision);
    assert_eq!(kept.applicable_quality(), ApplicableQuality::Usable);

    // The next scan reads the frame once again and sees the replacement.
    scan(&catalog, &fx, &location, &names).await;
    let rescanned = catalog.asset(reviewed.id).await.unwrap();
    assert_eq!(
        rescanned.applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Usable }
    );
}

fn coverage_sum(
    coverage: &platevault_model::TargetCoverage,
    pick: fn(&platevault_model::CoverageContribution) -> f64,
) -> f64 {
    coverage.contributions.iter().map(pick).sum()
}

#[tokio::test]
async fn decided_frames_stay_verification_pending_until_their_rehash_finishes() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"reviewed frame");
    fx.write("Ha_002.fits", b"other frame");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let reviewed = by_name(&assets, "Ha_001.fits").clone();
    catalog.set_quality(&[expected(&reviewed)], Quality::Usable, DiskProbe).await.unwrap();
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&session)], saved.candidate.id).await.unwrap();
    let usable =
        |coverage: &platevault_model::TargetCoverage| coverage_sum(coverage, |c| c.usable_seconds);
    let settled = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((usable(&settled) - 300.0).abs() < 1e-9 && !settled.provisional, "{settled:?}");

    // A readable rescan has begun but has not rehashed the reviewed frame yet.
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(&location).unwrap();
    let first = ScanBatch { files: vec![fx.scan_file("Ha_002.fits")], ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root, &first, group).await.unwrap();
    let pending = |asset: &Asset| {
        asset.applicable_quality()
            == ApplicableQuality::VerificationPending { previous: Quality::Usable }
            && asset.quality == Quality::Usable
    };
    let counted = |coverage: &platevault_model::TargetCoverage| {
        coverage.contributions.iter().map(|c| c.verification_pending).sum::<u64>()
    };
    assert!(pending(&catalog.asset(reviewed.id).await.unwrap()));
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!(usable(&coverage).abs() < 1e-9 && coverage.provisional, "{coverage:?}");
    assert_eq!(counted(&coverage), 1, "coverage reports the pending frame");

    // Canceling before the rehash leaves it pending, across a restart too.
    catalog.abort_scan(operation.id, ScanState::Canceled, "canceled by user").await.unwrap();
    catalog.close().await.unwrap();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    assert!(pending(&catalog.asset(reviewed.id).await.unwrap()));
    assert!(catalog.target_coverage(saved.candidate.id).await.unwrap().provisional);

    // A failed rehash (the bytes no longer match the observed stats) stays pending.
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let mut stale = fx.scan_file("Ha_001.fits");
    stale.fingerprint.modified_ns += 1;
    let files = vec![stale, fx.scan_file("Ha_002.fits")];
    let batch = ScanBatch { files: files.clone(), ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root.clone(),
        files,
        issues: Vec::new(),
        complete_scopes: vec![root_scope()],
        incomplete_scopes: Vec::new(),
        progress: ScanProgress::default(),
        state: ScanState::Completed,
    };
    let failed = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap();
    assert_eq!(failed.state, ScanState::Partial);
    assert!(pending(&catalog.asset(reviewed.id).await.unwrap()));
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!(usable(&coverage).abs() < 1e-9 && coverage.provisional, "{coverage:?}");
    assert_eq!(counted(&coverage), 1);

    // A rescan whose rehash finishes makes the decision applicable again.
    scan(&catalog, &fx, &location, &names).await;
    let verified = catalog.asset(reviewed.id).await.unwrap();
    assert_eq!(verified.applicable_quality(), ApplicableQuality::Usable);
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((usable(&coverage) - 300.0).abs() < 1e-9 && !coverage.provisional, "{coverage:?}");
    assert_eq!(tree(&fx.root), before, "sources unchanged");
}

/// Real probe that requests cancellation as soon as the first file is probed.
struct CancelingProbe(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl SourceProbe for CancelingProbe {
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
        self.0.store(true, std::sync::atomic::Ordering::Release);
        file_fingerprint(path)
    }
    fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
        folder_identity(&location.path.to_path_buf()?)
    }
}

async fn hashed_assets(catalog: &Catalog, locations: &[&Location]) -> usize {
    let mut hashed = 0;
    for location in locations {
        for asset in catalog.location_assets(location.id).await.unwrap() {
            hashed += usize::from(asset.fingerprint.content_sha256.is_some());
        }
    }
    hashed
}

/// Begin a scan of `root` and apply these files in one batch, leaving it running.
async fn running_scan_of(
    catalog: &Catalog,
    location: &Location,
    root: &Path,
    names: &[&str],
) -> Uuid {
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let files = names
        .iter()
        .map(|name| ScanFile {
            relative_path: NativePath::from_path(Path::new(name)),
            fingerprint: file_fingerprint(&root.join(name)).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata_for(name),
        })
        .collect();
    let root_identity = DiskProbe.root_identity(location).unwrap();
    let batch = ScanBatch { files, ..ScanBatch::default() };
    catalog.apply_scan_batch(operation.id, &root_identity, &batch, group).await.unwrap();
    operation.id
}

#[tokio::test]
async fn duplicate_verification_stops_at_cancel_and_keeps_each_bound_digest() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    let nas = fx.temp.path().join("NAS");
    std::fs::create_dir_all(&nas).unwrap();
    for name in names {
        fx.write(name, name.as_bytes());
        std::fs::copy(fx.root.join(name), nas.join(name)).unwrap();
    }
    let before = (tree(&fx.root), tree(&nas));
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let t7 = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &t7, &names).await;
    let nas_location = catalog.register_location(&registration_at(&nas)).await.unwrap();
    let operation = running_scan_of(&catalog, &nas_location, &nas, &names).await;

    let work = catalog.duplicate_verification_work(operation).await.unwrap();
    assert_eq!(work.len(), 4, "every unhashed copy on both sides");
    let recorded = catalog.scan_status(operation).await.unwrap().progress;
    assert_eq!((recorded.duplicate_candidates, recorded.duplicates_verified), (4, 0));
    let canceled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let probe = CancelingProbe(std::sync::Arc::clone(&canceled));
    let status = catalog
        .verify_duplicate_candidates(operation, &work, probe, std::sync::Arc::clone(&canceled))
        .await
        .unwrap();
    assert_eq!(status.progress.duplicates_verified, 1, "stops before the next file");
    assert_eq!(hashed_assets(&catalog, &[&t7, &nas_location]).await, 1);

    // The bound digest survives a restart; the next readable scan does the rest.
    catalog.close().await.unwrap();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    assert_eq!(hashed_assets(&catalog, &[&t7, &nas_location]).await, 1, "persisted per chunk");
    let operation = running_scan_of(&catalog, &nas_location, &nas, &names).await;
    let work = catalog.duplicate_verification_work(operation).await.unwrap();
    assert_eq!(work.len(), 3);
    let clear = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let status =
        catalog.verify_duplicate_candidates(operation, &work, DiskProbe, clear).await.unwrap();
    assert_eq!((status.progress.duplicate_candidates, status.progress.duplicates_verified), (3, 3));
    assert_eq!(hashed_assets(&catalog, &[&t7, &nas_location]).await, 4);
    assert!(catalog.duplicate_verification_work(operation).await.unwrap().is_empty());
    assert_eq!((tree(&fx.root), tree(&nas)), before, "sources unchanged");
}
