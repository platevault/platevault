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
    ApplicableQuality, Asset, AssociationKind, AssociationState, Availability, CaptureKey,
    CaptureMetadata, CorrectionInput, EvidenceItem, ExpectedAsset, ExpectedSession, FileIdentity,
    GroupingResult, ImageFormat, LibraryError, Location, LocationRole, NativePath,
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
