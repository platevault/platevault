// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Focused file-backed catalog behavior: durability, CAS, absence proof, regroup
//! lineage, digest-bound quality and all-or-nothing remap. Fixture files are real;
//! the probe reads actual no-follow file and folder metadata.
#![cfg(unix)]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use persistence_library::{
    Catalog, LocationReferences, LocationRegistration, SessionQuery, SourceProbe,
    SuggestedAssociation, SCHEMA_VERSION,
};
use platevault_model::{
    ApplicableQuality, Asset, AssetReference, Association, AssociationKind, AssociationState,
    Availability, CorrectionInput, EvidenceItem, ExpectedSession, FileIdentity, GroupingResult,
    ImageFormat, LibraryError, Location, LocationLifecycle, LocationRole, NativePath,
    ObservationFingerprint, PathSensitivity, Provenance, Quality, ReferenceKind, RemapBlockReason,
    RetryAction, Revision, ScanBatch, ScanFile, ScanIssue, ScanObservation, ScanOperation,
    ScanProgress, ScanState, Session, VolumeIdentity, VolumeKind,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{Column, Connection, Row};
use support::*;
use uuid::Uuid;

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
    let stamped = last_verified(&catalog, &assets).await;
    assert!(stamped[0].is_some() && stamped[1].is_none(), "{stamped:?}");

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
    assert_eq!(last_verified(&catalog, &assets).await, stamped, "a refused remap stamps nothing");

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
    assert_eq!(last_verified(&catalog, &assets).await, stamped, "a refused remap stamps nothing");
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

    // The candidate changes after the review with its stats kept: apply hashes
    // it, refuses, and stamps nothing. The reviewed bytes return.
    let candidate = good.join("Ha_002.fits");
    rewrite_path_same_stat(&candidate, b"frame TWO bytes");
    let error =
        catalog.apply_remap(review.id, location.decision_revision, DiskProbe).await.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict");
    assert_eq!(last_verified(&catalog, &assets).await, stamped, "a refused remap stamps nothing");
    rewrite_path_same_stat(&candidate, b"frame two bytes");
    let remapped =
        catalog.apply_remap(review.id, location.decision_revision, DiskProbe).await.unwrap();
    assert_eq!(remapped.path, NativePath::from_path(&good));
    let moved = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(
        moved.iter().map(|a| a.id).collect::<Vec<_>>(),
        assets.iter().map(|a| a.id).collect::<Vec<_>>()
    );
    assert_eq!(moved[0].applicable_quality(), ApplicableQuality::Usable, "decision kept");
    // Apply rehashed every asset against its review: each is verified now.
    let verified = last_verified(&catalog, &assets).await;
    assert!(
        verified.iter().zip(&stamped).all(|(now, was)| now.is_some() && now != was),
        "every remapped asset is verified at apply: {verified:?} after {stamped:?}"
    );
    assert_eq!(tree(&fx.root), original_tree, "no source writes");
}

/// Real probe that, at the first root check after `target` was fingerprinted
/// `after` times, replaces `target` with a new file of different bytes at the same
/// size and mtime: the window between hashing a source and committing its effect.
struct ReplacingProbe {
    target: PathBuf,
    bytes: &'static [u8],
    after: usize,
    probed: std::sync::atomic::AtomicUsize,
    replaced: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl ReplacingProbe {
    fn new(
        target: PathBuf,
        bytes: &'static [u8],
        after: usize,
    ) -> (Self, std::sync::Arc<std::sync::atomic::AtomicBool>) {
        let replaced = std::sync::Arc::default();
        let probe = Self {
            target,
            bytes,
            after,
            probed: std::sync::atomic::AtomicUsize::new(0),
            replaced: std::sync::Arc::clone(&replaced),
        };
        (probe, replaced)
    }
}

impl SourceProbe for ReplacingProbe {
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
        if path == self.target {
            self.probed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        file_fingerprint(path)
    }
    fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
        if self.probed.load(std::sync::atomic::Ordering::SeqCst) >= self.after
            && !self.replaced.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            replace_same_stat(&self.target, self.bytes);
        }
        folder_identity(&location.path.to_path_buf()?)
    }
}

/// Rename a new file holding `bytes` over `path`, at its size and mtime.
fn replace_same_stat(path: &Path, bytes: &[u8]) {
    let before = file_fingerprint(path).unwrap();
    let modified = std::fs::metadata(path).unwrap().modified().unwrap();
    let staged = path.with_extension("staged");
    std::fs::write(&staged, bytes).unwrap();
    std::fs::File::options().write(true).open(&staged).unwrap().set_modified(modified).unwrap();
    std::fs::rename(&staged, path).unwrap();
    let after = file_fingerprint(path).unwrap();
    assert_eq!((after.size_bytes, after.modified_ns), (before.size_bytes, before.modified_ns));
    assert_ne!(after.identity.file_id, before.identity.file_id, "a new file replaced it");
}

#[tokio::test]
async fn a_decision_on_a_source_replaced_with_equal_stats_after_hashing_binds_nothing() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"frame one bytes");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits"]).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let stamped = last_verified(&catalog, &assets).await;

    // Hashing probes the source before and after reading it; the root check that
    // follows is the last step before the decision commits.
    let (probe, replaced) = ReplacingProbe::new(fx.root.join("Ha_001.fits"), b"frame ONE bytes", 2);
    let error =
        catalog.set_quality(&[expected(&assets[0])], Quality::Usable, probe).await.unwrap_err();

    assert!(replaced.load(std::sync::atomic::Ordering::SeqCst), "replaced before commit");
    assert_eq!(kind(&error), "identity_conflict", "{error}");
    let unchanged = catalog.asset(assets[0].id).await.unwrap();
    assert_eq!(unchanged.quality, Quality::Unreviewed, "no decision recorded");
    assert_eq!(unchanged.decision_revision, assets[0].decision_revision);
    assert_eq!(unchanged.fingerprint.content_sha256, None, "no digest bound");
    assert_eq!(last_verified(&catalog, &assets).await, stamped, "nothing verified");
}

#[tokio::test]
async fn a_remap_onto_a_candidate_replaced_with_equal_stats_after_hashing_moves_nothing() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"frame one bytes");
    fx.write("Ha_002.fits", b"frame two bytes");
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let location = catalog.location(location.id).await.unwrap();
    let copy = fx.temp.path().join("Copy");
    std::fs::create_dir_all(&copy).unwrap();
    for name in ["Ha_001.fits", "Ha_002.fits"] {
        std::fs::copy(fx.root.join(name), copy.join(name)).unwrap();
    }
    let review = catalog
        .review_remap(
            location.id,
            location.decision_revision,
            &NativePath::from_path(&copy),
            &folder_identity(&copy).unwrap(),
            DiskProbe,
        )
        .await
        .unwrap();
    assert!(review.blocked.is_empty(), "{:?}", review.blocked);
    let stamped = last_verified(&catalog, &assets).await;

    // Apply fingerprints and hashes the candidate, then rechecks the candidate
    // root last before the stale-root search and the commit.
    let (probe, replaced) = ReplacingProbe::new(copy.join("Ha_002.fits"), b"frame TWO bytes", 1);
    let error =
        catalog.apply_remap(review.id, location.decision_revision, probe).await.unwrap_err();

    assert!(replaced.load(std::sync::atomic::Ordering::SeqCst), "replaced before commit");
    assert_eq!(kind(&error), "identity_conflict", "{error}");
    let current = catalog.location(location.id).await.unwrap();
    assert_eq!(current.path, location.path, "the root is not remapped");
    assert_eq!(current.decision_revision, location.decision_revision);
    let unchanged = catalog.location_assets(location.id).await.unwrap();
    assert!(
        unchanged.iter().zip(&assets).all(|(now, was)| now.id == was.id
            && now.relative_path == was.relative_path
            && now.fingerprint == was.fingerprint),
        "every asset keeps its original fingerprint and no digest is bound"
    );
    assert_eq!(last_verified(&catalog, &assets).await, stamped, "a refused remap stamps nothing");
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
        sensor_width_px: None,
        sensor_height_px: None,
        color_kind: None,
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
            volume_kind: VolumeKind::Local,
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
        volume_kind: VolumeKind::Local,
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
    // The deleted folder stays open so ext4/XFS cannot hand its inode to a folder
    // made later; that reuse is a documented residual this test does not cover.
    let _held = std::fs::File::open(&test).unwrap();
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
    std::fs::write(test.join("Ha_001.fits"), b"frame one bytes").unwrap();
    let test_root = catalog.register_location(&unstable(&test)).await.unwrap();
    // The root is renamed; nothing on this volume can prove where it went.
    let renamed = volume.join("Test 1");
    std::fs::rename(&test, &renamed).unwrap();
    let frame = sha_of(&renamed.join("Ha_001.fits"));

    let flats = volume.join("Flats");
    std::fs::create_dir_all(&flats).unwrap();
    let error = catalog.register_location(&unstable(&flats)).await.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict");
    let message = error.to_string();
    assert!(message.contains("\"Test\"") && message.contains("reselect"), "{message}");
    // A folder made at the stored path would let the renamed root register twice.
    assert!(!message.contains("restore"), "{message}");
    // The renamed folder itself is the registered root.
    let error = catalog.register_location(&unstable(&renamed)).await.unwrap_err();
    assert!(error.to_string().contains("\"Test\""), "{error}");
    assert_eq!(catalog.list_locations().await.unwrap().len(), 1, "refusals write nothing");

    // The named way out: reselect the root at its current folder.
    catalog
        .reselect_location(
            test_root.id,
            test_root.decision_revision,
            &NativePath::from_path(&renamed),
            &unstable(&renamed).identity,
        )
        .await
        .unwrap();
    catalog.register_location(&unstable(&flats)).await.unwrap();
    let error = catalog.register_location(&unstable(&renamed)).await.unwrap_err();
    assert!(error.to_string().contains("folder overlaps"), "{error}");
    assert_eq!(sha_of(&renamed.join("Ha_001.fits")), frame, "originals unchanged");
}

/// References read outside the catalog for `assets`: every kind consulted.
fn read_references(assets: &[Asset], references: Vec<AssetReference>) -> LocationReferences {
    LocationReferences {
        assets: assets.iter().map(|asset| asset.id).collect(),
        references,
        consulted: vec![ReferenceKind::View, ReferenceKind::Project, ReferenceKind::Result],
    }
}

/// A fixed View membership holding `assets` at `revision`.
fn fixed_view(assets: &[Asset], revision: Revision) -> AssetReference {
    AssetReference {
        kind: ReferenceKind::View,
        id: Uuid::from_u128(0x7000),
        name: "NGC 7000 Ha".into(),
        revision,
        asset_ids: ids_of(assets).into_iter().collect(),
    }
}

fn ids_of(assets: &[Asset]) -> BTreeSet<Uuid> {
    assets.iter().map(|asset| asset.id).collect()
}

#[tokio::test]
async fn a_reviewed_retire_names_every_reference_and_changes_no_file() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"frame one bytes");
    fx.write("Ha_002.fits", b"frame two bytes");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &["Ha_001.fits", "Ha_002.fits"]).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    catalog.set_quality(&[expected(&assets[0])], Quality::Usable, DiskProbe).await.unwrap();
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&session)], saved.candidate.id).await.unwrap();

    // The location goes offline; its copies are fixed View members.
    let unplugged = fx.root.with_extension("unplugged");
    std::fs::rename(&fx.root, &unplugged).unwrap();
    let location = catalog
        .mark_location_unavailable(location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let assets = catalog.location_assets(location.id).await.unwrap();
    let view = fixed_view(&assets, 3);
    let references = read_references(&assets, vec![view.clone()]);
    let review = catalog.review_retire_location(location.id, &references).await.unwrap();
    assert_eq!(
        (review.location_id, review.location_name.as_str(), &review.root),
        (location.id, "Astro-T7/Captures", &location.path)
    );
    assert_eq!(
        (review.availability, review.expected_revision),
        (Availability::Offline, location.decision_revision)
    );
    let named: BTreeSet<Uuid> = review.assets.iter().map(|copy| copy.asset_id).collect();
    assert_eq!(named, ids_of(&assets));
    assert_eq!(review.sessions.len(), 1, "{:?}", review.sessions);
    assert_eq!(review.sessions[0].session_id, session.id);
    assert_eq!(review.sessions[0].grouping_revision, session.grouping_revision);
    assert_eq!(review.references, vec![view.clone()]);
    assert_eq!(review.consulted, references.consulted);
    assert!(
        review.statement.contains("deletes, moves or modifies no file"),
        "{}",
        review.statement
    );
    let stored = catalog.retire_review(review.id).await.unwrap();
    assert_eq!((stored.references, stored.assets.len()), (review.references.clone(), 2), "durable");

    // A stale revision, or a View that changed since the review, is refused.
    let stale = location.decision_revision + 1;
    let error = catalog.retire_location(review.id, location.id, stale, &references).await;
    assert_eq!(kind(&error.unwrap_err()), "conflict");
    let refreshed = read_references(&assets, vec![fixed_view(&assets, 4)]);
    let error =
        catalog.retire_location(review.id, location.id, review.expected_revision, &refreshed);
    assert_eq!(kind(&error.await.unwrap_err()), "conflict");
    let unchanged = catalog.location(location.id).await.unwrap();
    assert_eq!(
        (unchanged.lifecycle, unchanged.decision_revision),
        (LocationLifecycle::Active, location.decision_revision),
        "refusals change nothing"
    );
    assert!(catalog
        .location_assets(location.id)
        .await
        .unwrap()
        .iter()
        .all(|asset| asset.availability == Availability::Offline));

    let retired = catalog
        .retire_location(review.id, location.id, review.expected_revision, &references)
        .await
        .unwrap();
    assert_eq!(retired.lifecycle, LocationLifecycle::Retired);
    assert_eq!(retired.decision_revision, location.decision_revision + 1);
    assert_eq!(retired.availability, Availability::Offline, "last-observed state kept");

    // Its copies read Retired, never Missing, and keep their decisions as history.
    let history = catalog.location_assets(location.id).await.unwrap();
    assert_eq!(ids_of(&history), ids_of(&assets));
    assert!(history.iter().all(|asset| asset.availability == Availability::Retired));
    assert_eq!(catalog.asset(assets[0].id).await.unwrap().quality, Quality::Usable);

    // They leave every integration total; the session keeps its exact membership.
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!(
        coverage.contributions.is_empty()
            && coverage.covered_location_ids.is_empty()
            && !coverage.provisional,
        "{coverage:?}"
    );
    let detail = catalog.session(session.id).await.unwrap();
    assert_eq!(detail.summary.session.asset_ids, session.asset_ids, "membership unchanged");
    assert_eq!(
        (detail.summary.capture_count, detail.summary.availability, detail.summary.provisional),
        (0, Availability::Retired, false)
    );

    // The review is single-use, and a retired location is never reselected,
    // rescanned, remapped or decided on, even where its folder returns.
    let again =
        catalog.retire_location(review.id, location.id, retired.decision_revision, &references);
    assert_eq!(kind(&again.await.unwrap_err()), "invalid_input");
    std::fs::rename(&unplugged, &fx.root).unwrap();
    refuses_reuse_of_retired(&catalog, &fx, &retired, &history[1]).await;
    assert_eq!(tree(&fx.root), before, "originals unchanged");
}

/// A retired location is never reselected, rescanned, remapped or decided on,
/// even where its folder returns, and the refusals change nothing.
async fn refuses_reuse_of_retired(
    catalog: &Catalog,
    fx: &Fixture,
    retired: &Location,
    copy: &Asset,
) {
    let before = tree(&fx.root);
    let root = NativePath::from_path(&fx.root);
    let identity = folder_identity(&fx.root).unwrap();
    let revision = retired.decision_revision;
    let error =
        catalog.reselect_location(retired.id, revision, &root, &identity).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input");
    assert!(error.to_string().contains("retired"), "{error}");
    assert_eq!(kind(&catalog.begin_scan(retired.id, None).await.unwrap_err()), "invalid_input");
    let night = NativePath::from_path(Path::new("night1"));
    assert_eq!(kind(&catalog.retry_scope(retired.id, night).await.unwrap_err()), "invalid_input");
    let remap = catalog.review_remap(retired.id, revision, &root, &identity, DiskProbe).await;
    assert_eq!(kind(&remap.unwrap_err()), "invalid_input");
    let decided = catalog.set_quality(&[expected(copy)], Quality::Usable, DiskProbe).await;
    assert_eq!(kind(&decided.unwrap_err()), "invalid_input");
    assert_eq!(catalog.location(retired.id).await.unwrap().decision_revision, revision);
    assert_eq!(tree(&fx.root), before, "originals unchanged");
}

#[tokio::test]
async fn a_retire_review_whose_availability_changed_is_refused() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    fx.write(names[0], b"frame one bytes");
    fx.write(names[1], b"frame two bytes");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();

    // The review is taken while the drive reads Offline.
    let unplugged = fx.root.with_extension("unplugged");
    std::fs::rename(&fx.root, &unplugged).unwrap();
    let location = catalog
        .mark_location_unavailable(location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let references = read_references(&assets, Vec::new());
    let review = catalog.review_retire_location(location.id, &references).await.unwrap();
    assert_eq!(review.availability, Availability::Offline);

    // The drive returns and a readable rescan of the same files completes; it
    // changes no copy, session or revision, only the availability.
    std::fs::rename(&unplugged, &fx.root).unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let returned = catalog.location(location.id).await.unwrap();
    assert_eq!(
        (returned.availability, returned.decision_revision),
        (Availability::Available, review.expected_revision)
    );

    // The review no longer holds: a Conflict naming the location sends the user
    // back to review, and nothing changes.
    let error = catalog
        .retire_location(review.id, location.id, review.expected_revision, &references)
        .await
        .unwrap_err();
    let response = error.response(None, None);
    assert_eq!(
        (response.kind.as_str(), response.identity, response.retry),
        ("conflict", Some(location.id), RetryAction::Review)
    );
    let unchanged = catalog.location(location.id).await.unwrap();
    assert_eq!(
        (unchanged.lifecycle, unchanged.availability, unchanged.decision_revision),
        (LocationLifecycle::Active, Availability::Available, review.expected_revision),
        "refusal changes nothing"
    );

    // A fresh review names the current availability and confirms.
    let fresh = catalog.review_retire_location(location.id, &references).await.unwrap();
    assert_eq!(fresh.availability, Availability::Available);
    let retired = catalog
        .retire_location(fresh.id, location.id, fresh.expected_revision, &references)
        .await
        .unwrap();
    assert_eq!(retired.lifecycle, LocationLifecycle::Retired);
    assert_eq!(tree(&fx.root), before, "originals unchanged");
}

/// Real probe that records whether any source was probed.
struct RecordingProbe(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl SourceProbe for RecordingProbe {
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
        self.0.store(true, std::sync::atomic::Ordering::Release);
        file_fingerprint(path)
    }
    fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
        self.0.store(true, std::sync::atomic::Ordering::Release);
        folder_identity(&location.path.to_path_buf()?)
    }
}

#[tokio::test]
async fn a_decision_on_a_retired_copy_is_refused_before_its_root_is_read() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    fx.write(names[0], b"frame one bytes");
    fx.write(names[1], b"frame two bytes");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let unplugged = fx.root.with_extension("unplugged");
    std::fs::rename(&fx.root, &unplugged).unwrap();
    let location = catalog
        .mark_location_unavailable(location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let references = read_references(&assets, Vec::new());
    let review = catalog.review_retire_location(location.id, &references).await.unwrap();
    catalog
        .retire_location(review.id, location.id, review.expected_revision, &references)
        .await
        .unwrap();
    let copy = catalog.asset(assets[0].id).await.unwrap();
    assert_eq!(copy.availability, Availability::Retired);

    let probed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let refuse = |stage: &str| {
        let catalog = &catalog;
        let copy = &copy;
        let probed = &probed;
        let stage = stage.to_owned();
        async move {
            for quality in [Quality::Usable, Quality::Unusable] {
                let probe = RecordingProbe(probed.clone());
                let error =
                    catalog.set_quality(&[expected(copy)], quality, probe).await.unwrap_err();
                let response = error.response(None, None);
                assert_eq!(
                    (response.kind.as_str(), response.identity, response.retry),
                    ("invalid_input", Some(copy.id), RetryAction::Review),
                    "{stage}: {error}"
                );
                assert!(error.to_string().contains("retired location"), "{stage}: {error}");
            }
        }
    };
    // Offline, the normal state after a retire, the refusal names the
    // retirement rather than asking to reconnect the drive.
    refuse("offline").await;
    // Where its folder returns, its root is still never probed nor its files hashed.
    std::fs::rename(&unplugged, &fx.root).unwrap();
    refuse("returned").await;
    assert!(!probed.load(std::sync::atomic::Ordering::Acquire), "no retired source is read");
    let kept = catalog.asset(copy.id).await.unwrap();
    assert_eq!((kept.quality, kept.decision_revision), (copy.quality, copy.decision_revision));
    assert_eq!(tree(&fx.root), before, "originals unchanged");
}

#[tokio::test]
async fn a_retired_folder_registers_again_and_counts_each_capture_once() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    fx.write(names[0], b"frame one bytes");
    fx.write(names[1], b"frame two bytes");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let retired_assets = catalog.location_assets(location.id).await.unwrap();
    let reviewed = by_name(&retired_assets, names[0]).clone();
    catalog.set_quality(&[expected(&reviewed)], Quality::Usable, DiskProbe).await.unwrap();
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&session)], saved.candidate.id).await.unwrap();
    let totals = |coverage: &platevault_model::TargetCoverage| {
        (
            coverage_sum(coverage, |c| c.captured_seconds),
            coverage_sum(coverage, |c| c.usable_seconds),
            coverage_sum(coverage, |c| c.unreviewed_seconds),
        )
    };
    assert_eq!(
        totals(&catalog.target_coverage(saved.candidate.id).await.unwrap()),
        (600.0, 300.0, 300.0)
    );

    // The root is lost while a scan runs; that scan settles as Failed.
    let unplugged = fx.root.with_extension("unplugged");
    std::fs::rename(&fx.root, &unplugged).unwrap();
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let location = catalog
        .mark_location_unavailable(location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let references = read_references(&retired_assets, Vec::new());
    let review = catalog.review_retire_location(location.id, &references).await.unwrap();
    // Retirement waits for the Running scan of the location, naming it.
    let error = catalog
        .retire_location(review.id, location.id, review.expected_revision, &references)
        .await
        .unwrap_err();
    let response = error.response(None, None);
    assert_eq!((response.kind.as_str(), response.identity), ("conflict", Some(operation.id)));
    catalog.abort_scan(operation.id, ScanState::Failed, "volume gone").await.unwrap();
    catalog
        .retire_location(review.id, location.id, review.expected_revision, &references)
        .await
        .unwrap();

    // The same folder returns and registers again as a new location.
    std::fs::rename(&unplugged, &fx.root).unwrap();
    let again = catalog.register_location(&fx.registration()).await.unwrap();
    assert_ne!(again.id, location.id);
    assert_eq!(again.lifecycle, LocationLifecycle::Active);
    scan(&catalog, &fx, &again, &names).await;
    let fresh = catalog.location_assets(again.id).await.unwrap();
    assert!(ids_of(&fresh).is_disjoint(&ids_of(&retired_assets)), "new asset identities");
    assert!(
        fresh.iter().all(|asset| asset.quality == Quality::Unreviewed
            && asset.availability == Availability::Available),
        "no retired decision transfers"
    );

    // The copies form their own session, which counts toward the Target only once
    // associated, each capture once: retired copies are neither totals nor candidates.
    let summaries = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    let renewed_session = session_holding(&summaries, &fresh);
    assert_ne!(renewed_session.id, session.id, "the retired session absorbs nothing");
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!(coverage.contributions.is_empty(), "no association transfers: {coverage:?}");
    catalog
        .associate_target(&[expected_session(&renewed_session)], saved.candidate.id)
        .await
        .unwrap();
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert_eq!(totals(&coverage), (600.0, 0.0, 600.0), "{coverage:?}");
    assert_eq!(coverage.covered_location_ids, vec![again.id]);
    assert!(!coverage.provisional, "{coverage:?}");
    let counted: u64 = summaries.iter().map(|summary| summary.capture_count).sum();
    assert_eq!(counted, 2, "{summaries:?}");
    assert!(summaries.iter().all(|summary| !summary.provisional), "{summaries:?}");

    // A reviewed copy is never joined to its byte-identical retired twin.
    let renewed = by_name(&fresh, names[0]).clone();
    let decided = catalog.set_quality(&[expected(&renewed)], Quality::Usable, DiskProbe).await;
    let digest = decided.unwrap()[0].fingerprint.content_sha256.clone();
    let twin = catalog.asset(reviewed.id).await.unwrap();
    assert_eq!(digest, twin.fingerprint.content_sha256, "byte-identical");
    let holder = renewed_session.id;
    let members = catalog.session(holder).await.unwrap().members;
    let member = members.iter().find(|member| member.copies.contains(&renewed.id)).unwrap();
    assert_eq!(member.copies, vec![renewed.id], "{members:?}");
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert_eq!(totals(&coverage), (600.0, 300.0, 300.0), "{coverage:?}");
    assert_eq!(tree(&fx.root), before, "originals unchanged");
}

/// The current session holding every one of these assets.
fn session_holding(summaries: &[persistence_library::SessionSummary], assets: &[Asset]) -> Session {
    let ids = ids_of(assets);
    let holders: Vec<&Session> = summaries
        .iter()
        .map(|summary| &summary.session)
        .filter(|session| session.asset_ids.iter().any(|id| ids.contains(id)))
        .collect();
    assert_eq!(holders.len(), 1, "{summaries:?}");
    assert_eq!(holders[0].asset_ids.iter().copied().collect::<BTreeSet<_>>(), ids);
    holders[0].clone()
}

/// LIB-FR-15, D11: a session whose assets all belong to Retired locations never
/// absorbs new assets. Copies of its re-registered folder form a new session from
/// their own evidence; no quality decision, Target or equipment association or
/// catalog correction of the retired copies transfers to them.
#[tokio::test]
async fn a_re_registered_folder_forms_new_sessions_that_inherit_nothing_retired() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    fx.write(names[0], b"frame one bytes");
    fx.write(names[1], b"frame two bytes");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    catalog
        .set_quality(&[expected(by_name(&assets, names[0]))], Quality::Usable, DiskProbe)
        .await
        .unwrap();
    // A catalog correction outside capture identity keeps the session.
    let corrected = by_name(&assets, names[1]).clone();
    let correction =
        CorrectionInput { asset_id: corrected.id, field: "object".into(), value: "M 31".into() };
    catalog
        .apply_correction_and_regroup(&[expected(&corrected)], &[correction], group)
        .await
        .unwrap();
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    assert_eq!(session.asset_ids.iter().copied().collect::<BTreeSet<_>>(), ids_of(&assets));
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&session)], saved.candidate.id).await.unwrap();
    let session = catalog.session(session.id).await.unwrap().summary.session;
    let equipment = saved_equipment(&catalog).await;
    catalog.confirm_equipment(&[expected_session(&session)], equipment.id).await.unwrap();
    let decisions = |associations: Vec<Association>| {
        associations
            .into_iter()
            .map(|a| (a.kind, a.state, a.subject_id, a.decision_revision))
            .collect::<Vec<_>>()
    };
    let confirmed = decisions(catalog.associations(session.id).await.unwrap());
    assert_eq!(confirmed.len(), 2);
    assert!(confirmed.iter().all(|(_, state, _, _)| *state == AssociationState::Confirmed));

    let unplugged = fx.root.with_extension("unplugged");
    std::fs::rename(&fx.root, &unplugged).unwrap();
    let location = catalog
        .mark_location_unavailable(location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let references = read_references(&assets, Vec::new());
    let review = catalog.review_retire_location(location.id, &references).await.unwrap();
    catalog
        .retire_location(review.id, location.id, review.expected_revision, &references)
        .await
        .unwrap();

    std::fs::rename(&unplugged, &fx.root).unwrap();
    let again = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &again, &names).await;
    let fresh = catalog.location_assets(again.id).await.unwrap();
    assert!(
        fresh.iter().all(|asset| asset.quality == Quality::Unreviewed
            && asset.quality_basis.is_none()
            && asset.effective == asset.observed),
        "no retired quality decision or correction transfers: {fresh:?}"
    );

    // The retired session keeps exactly its retired copies and confirmations as
    // history; the new copies form a new session that inherits none of them.
    let summaries = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    let renewed = session_holding(&summaries, &fresh);
    assert_ne!(renewed.id, session.id, "the retired session absorbs no new asset");
    let history = catalog.session(session.id).await.unwrap();
    assert_eq!(history.summary.session.asset_ids, session.asset_ids);
    assert!(history.summary.successors.is_empty(), "{history:?}");
    assert_eq!(decisions(catalog.associations(session.id).await.unwrap()), confirmed);
    let inherited = catalog.associations(renewed.id).await.unwrap();
    assert!(inherited.is_empty(), "it starts from its own evidence: {inherited:?}");
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!(coverage.contributions.is_empty(), "{coverage:?}");
    assert_eq!(tree(&fx.root), before, "originals unchanged");
}

/// A session holding copies in an Active and a Retired location still absorbs
/// new assets: when the retired folder registers again, its new copy joins that
/// session, which keeps its id and gains no successor. The retired copy stays
/// outside every total.
#[tokio::test]
async fn a_session_with_an_active_copy_absorbs_its_re_registered_retired_folder() {
    let fx = Fixture::new();
    fx.write("Ha_001.fits", b"frame on the T7");
    let cold = fx.temp.path().join("Cold-1");
    std::fs::create_dir_all(&cold).unwrap();
    std::fs::write(cold.join("Ha_002.fits"), b"frame on the cold drive").unwrap();
    let before = (tree(&fx.root), tree(&cold));
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let active = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &active, &["Ha_001.fits"]).await;
    let retiring = catalog.register_location(&registration_at(&cold)).await.unwrap();
    scan_at(&catalog, &retiring, &cold, &["Ha_002.fits"]).await;
    let retired_copies = catalog.location_assets(retiring.id).await.unwrap();
    let mut held = catalog.location_assets(active.id).await.unwrap();
    held.extend(retired_copies.iter().cloned());
    for asset in &held {
        catalog.set_quality(&[expected(asset)], Quality::Usable, DiskProbe).await.unwrap();
    }
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 1, "one capture key across both locations: {sessions:?}");
    let session = sessions[0].session.clone();
    assert_eq!(session.asset_ids.iter().copied().collect::<BTreeSet<_>>(), ids_of(&held));
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&session)], saved.candidate.id).await.unwrap();
    let totals = |coverage: &platevault_model::TargetCoverage| {
        (
            coverage_sum(coverage, |c| c.captured_seconds),
            coverage_sum(coverage, |c| c.usable_seconds),
            coverage_sum(coverage, |c| c.unreviewed_seconds),
        )
    };
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert_eq!(totals(&coverage), (600.0, 600.0, 0.0), "{coverage:?}");

    // Cold-1 is retired: its copy leaves every total.
    let unplugged = cold.with_extension("unplugged");
    std::fs::rename(&cold, &unplugged).unwrap();
    let retiring = catalog
        .mark_location_unavailable(retiring.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let references = read_references(&retired_copies, Vec::new());
    let review = catalog.review_retire_location(retiring.id, &references).await.unwrap();
    catalog
        .retire_location(review.id, retiring.id, review.expected_revision, &references)
        .await
        .unwrap();
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert_eq!(totals(&coverage), (300.0, 300.0, 0.0), "{coverage:?}");

    // Its folder registers again. The session still holds an Active copy, so it
    // absorbs the new copy: same id, no successor, every copy a member.
    std::fs::rename(&unplugged, &cold).unwrap();
    let again = catalog.register_location(&registration_at(&cold)).await.unwrap();
    scan_at(&catalog, &again, &cold, &["Ha_002.fits"]).await;
    let fresh = catalog.location_assets(again.id).await.unwrap();
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 1, "no new session: {sessions:?}");
    let kept = catalog.session(session.id).await.unwrap().summary;
    assert!(kept.successors.is_empty(), "{kept:?}");
    held.extend(fresh.iter().cloned());
    assert_eq!(kept.session.asset_ids.iter().copied().collect::<BTreeSet<_>>(), ids_of(&held));
    assert_eq!(kept.capture_count, 2, "the retired copy is not counted: {kept:?}");

    // The retired copy stays out of totals; the new copy counts Unreviewed.
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert_eq!(totals(&coverage), (600.0, 300.0, 300.0), "{coverage:?}");
    let covered: Vec<Uuid> =
        [active.id, again.id].into_iter().collect::<BTreeSet<_>>().into_iter().collect();
    assert_eq!(coverage.covered_location_ids, covered);
    assert!(!coverage.provisional, "{coverage:?}");
    assert_eq!((tree(&fx.root), tree(&cold)), before, "originals unchanged");
}

#[tokio::test]
async fn a_deleted_root_without_folder_identity_is_freed_by_a_reviewed_retire() {
    let fx = Fixture::new();
    let volume = fx.root.parent().unwrap().to_path_buf();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    // No stable folder identity, as on Windows NTFS or exFAT, msdos and SMB volumes.
    let unstable = |path: &Path| {
        let mut registration = registration_at(path);
        registration.identity.volume.file_ids_stable = false;
        registration
    };
    let test = volume.join("Test");
    std::fs::create_dir_all(&test).unwrap();
    let test_root = catalog.register_location(&unstable(&test)).await.unwrap();
    // The root is deleted: no folder can ever be reselected for it.
    std::fs::remove_dir_all(&test).unwrap();
    let flats = volume.join("Flats");
    std::fs::create_dir_all(&flats).unwrap();
    std::fs::write(flats.join("Flat_001.fits"), b"flat frame bytes").unwrap();
    let flat = sha_of(&flats.join("Flat_001.fits"));

    // The refusal names both ways out.
    // Unstable ids get reused by unrelated folders; the new folder carrying the
    // deleted root's id must prove nothing.
    let mut reused = unstable(&flats);
    reused.identity.file_id.clone_from(&test_root.identity.file_id);
    let error = catalog.register_location(&reused).await.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict");
    let message = error.to_string();
    assert!(
        message.contains("\"Test\"")
            && message.contains("reselect")
            && message.contains("Retire location"),
        "{message}"
    );
    assert!(!message.contains("restore"), "{message}");

    // Recovery: review and confirm Retire location for the deleted root.
    let references = read_references(&[], Vec::new());
    let review = catalog.review_retire_location(test_root.id, &references).await.unwrap();
    assert_eq!((&review.root, review.assets.len()), (&test_root.path, 0));
    catalog
        .retire_location(review.id, test_root.id, test_root.decision_revision, &references)
        .await
        .unwrap();
    let flats_root = catalog.register_location(&unstable(&flats)).await.unwrap();
    // The deleted folder, made again, is a new location.
    std::fs::create_dir_all(&test).unwrap();
    let again = catalog.register_location(&unstable(&test)).await.unwrap();
    assert_ne!(again.id, test_root.id);
    assert_eq!(catalog.list_locations().await.unwrap().len(), 3);
    assert_eq!(flats_root.lifecycle, LocationLifecycle::Active);
    assert_eq!(sha_of(&flats.join("Flat_001.fits")), flat, "originals unchanged");
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
    rewrite_path_same_stat(&fx.root.join(name), bytes);
}

/// Replace a file's bytes in place with equal length and its original mtime.
fn rewrite_path_same_stat(source: &Path, bytes: &[u8]) {
    let before = file_fingerprint(source).unwrap();
    assert_eq!(before.size_bytes, bytes.len() as u64);
    let modified = std::fs::metadata(source).unwrap().modified().unwrap();
    let file = std::fs::OpenOptions::new().write(true).truncate(true).open(source).unwrap();
    std::io::Write::write_all(&mut &file, bytes).unwrap();
    file.set_modified(modified).unwrap();
    drop(file);
    assert!(before.equivalent(&file_fingerprint(source).unwrap()), "stats cannot detect it");
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

/// D19, FR-017: a total counts each decision as of its last completed
/// verification, at review or a readable rescan, and labels the oldest such time
/// it relies on. Reading the total starts no rehash; drifted and pending items
/// stay outside it and outside its label.
#[tokio::test]
async fn coverage_counts_decisions_as_of_their_last_verification_and_reading_rehashes_nothing() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    fx.write(names[0], b"reviewed frame A");
    fx.write(names[1], b"reviewed frame B");
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    assert!(assets.iter().all(|asset| asset.last_verified_at.is_none()), "indexing hashes nothing");
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&session)], saved.candidate.id).await.unwrap();
    let mut decided: Vec<Asset> = Vec::new();
    for name in names {
        let asset = expected(by_name(&assets, name));
        decided.extend(catalog.set_quality(&[asset], Quality::Usable, DiskProbe).await.unwrap());
    }
    let reviewed_at: Vec<String> = decided
        .iter()
        .map(|asset| asset.last_verified_at.clone().expect("review verifies the bytes"))
        .collect();
    assert_ne!(reviewed_at[0], reviewed_at[1]);
    let usable =
        |coverage: &platevault_model::TargetCoverage| coverage_sum(coverage, |c| c.usable_seconds);
    let labels = |coverage: &platevault_model::TargetCoverage| {
        let each: Vec<Option<String>> =
            coverage.contributions.iter().map(|c| c.last_verified_at.clone()).collect();
        (coverage.last_verified_at.clone(), each)
    };
    let settled = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((usable(&settled) - 600.0).abs() < 1e-9, "{settled:?}");
    let oldest = Some(reviewed_at[0].clone());
    assert_eq!(labels(&settled), (oldest.clone(), vec![oldest]), "oldest verification relied on");

    // The reviewed bytes change in place with size and mtime kept. Reading the
    // total rehashes nothing: it still counts the frame as of its review and
    // records no state or operation.
    let reviewed_bytes = std::fs::read(fx.root.join(names[0])).unwrap();
    rewrite_same_stat(&fx, names[0], b"replaced frame A");
    let operations = catalog.list_operations(Some(location.id), 0, 10).await.unwrap().len();
    let read = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((usable(&read) - 600.0).abs() < 1e-9, "{read:?}");
    assert_eq!(labels(&read), labels(&settled));
    assert_eq!(catalog.asset(decided[0].id).await.unwrap(), decided[0], "nothing recorded");
    assert_eq!(catalog.list_operations(Some(location.id), 0, 10).await.unwrap().len(), operations);

    // A readable rescan verifies both: the drifted frame leaves the total and its
    // label, which moves to the rescan's verification of the frame still counted.
    scan(&catalog, &fx, &location, &names).await;
    let drifted = catalog.asset(decided[0].id).await.unwrap();
    assert_eq!(
        drifted.applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Usable }
    );
    let rescanned = catalog.asset(decided[1].id).await.unwrap().last_verified_at;
    assert!(rescanned.is_some() && rescanned != Some(reviewed_at[1].clone()), "{rescanned:?}");
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((usable(&coverage) - 300.0).abs() < 1e-9, "{coverage:?}");
    assert_eq!(coverage.contributions.iter().map(|c| c.drifted_decisions).sum::<u64>(), 1);
    assert_eq!(labels(&coverage), (rescanned.clone(), vec![rescanned]));

    // The reviewed bytes return: the next readable rescan counts them again.
    rewrite_same_stat(&fx, names[0], &reviewed_bytes);
    scan(&catalog, &fx, &location, &names).await;
    let restored = catalog.asset(decided[0].id).await.unwrap();
    assert_eq!(restored.applicable_quality(), ApplicableQuality::Usable);
    let verified = restored.last_verified_at.clone();
    assert_eq!(catalog.asset(decided[1].id).await.unwrap().last_verified_at, verified);
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((usable(&coverage) - 600.0).abs() < 1e-9, "{coverage:?}");
    assert_eq!(labels(&coverage), (verified.clone(), vec![verified.clone()]));

    // While a started rehash runs, both read verification pending: outside the
    // total and its label.
    let reviewed_stamps = last_verified(&catalog, &decided).await;
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(&location).unwrap();
    catalog.apply_scan_batch(operation.id, &root, &ScanBatch::default(), group).await.unwrap();
    let pending = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!(usable(&pending).abs() < 1e-9, "{pending:?}");
    assert_eq!(pending.contributions.iter().map(|c| c.verification_pending).sum::<u64>(), 2);
    assert_eq!(labels(&pending), (None, vec![None]));
    // Canceling verifies nothing: each keeps its last verification, stays pending
    // and stays outside the total and its label.
    catalog.abort_scan(operation.id, ScanState::Canceled, "canceled by user").await.unwrap();
    assert_eq!(last_verified(&catalog, &decided).await, reviewed_stamps, "a cancel stamps nothing");
    let canceled = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!(usable(&canceled).abs() < 1e-9, "{canceled:?}");
    assert_eq!(canceled.contributions.iter().map(|c| c.verification_pending).sum::<u64>(), 2);
    assert_eq!(labels(&canceled), (None, vec![None]));
    scan(&catalog, &fx, &location, &names).await;
    let verified = catalog.asset(decided[0].id).await.unwrap().last_verified_at;

    // Offline, the total keeps its last-observed count and verification time.
    let unplugged = fx.root.with_extension("unplugged");
    std::fs::rename(&fx.root, &unplugged).unwrap();
    catalog
        .mark_location_unavailable(location.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let offline = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((usable(&offline) - 600.0).abs() < 1e-9, "{offline:?}");
    assert!(offline.contributions.iter().all(|c| c.availability == Availability::Offline));
    assert_eq!(labels(&offline), (verified.clone(), vec![verified]));
    std::fs::rename(&unplugged, &fx.root).unwrap();
    assert_eq!(tree(&fx.root), before, "originals unchanged");
}

/// D19: a capture is labelled with the oldest last verification among the copies
/// whose decision makes it Usable. An Unreviewed copy's earlier hash never labels
/// it, and the copy it is counted on does not pick the time shown.
#[tokio::test]
async fn a_capture_is_labelled_with_the_oldest_verification_of_its_usable_copies() {
    let fx = Fixture::new();
    let name = "Ha_001.fits";
    fx.write(name, b"one capture, two copies");
    let nas = fx.temp.path().join("NAS");
    std::fs::create_dir_all(&nas).unwrap();
    std::fs::copy(fx.root.join(name), nas.join(name)).unwrap();
    let before = (tree(&fx.root), tree(&nas));
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let t7 = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &t7, &[name]).await;
    let nas_location = catalog.register_location(&registration_at(&nas)).await.unwrap();
    scan_at(&catalog, &nas_location, &nas, &[name]).await;
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&[expected_session(&session)], saved.candidate.id).await.unwrap();
    // Coverage counts a capture on its available copy in the smallest location id.
    let mut copies = Vec::new();
    for location in [&t7, &nas_location] {
        copies.extend(catalog.location_assets(location.id).await.unwrap());
    }
    copies.sort_by_key(|copy| copy.location_id);
    let (counted, other) = (copies[0].id, copies[1].id);
    let decide = |id: Uuid| {
        let catalog = &catalog;
        async move {
            let asset = expected(&catalog.asset(id).await.unwrap());
            let decided = catalog.set_quality(&[asset], Quality::Usable, DiskProbe).await;
            decided.unwrap()[0].last_verified_at.clone().expect("review verifies")
        }
    };
    let labels = |coverage: &platevault_model::TargetCoverage| {
        let each: Vec<Option<String>> =
            coverage.contributions.iter().map(|c| c.last_verified_at.clone()).collect();
        (coverage.last_verified_at.clone(), each)
    };

    // The counted copy is inspected first, then only the other copy is reviewed:
    // the decision speaks for the capture, labelled with its review only.
    catalog.verify_digest(counted, DiskProbe).await.unwrap();
    let inspected = catalog.asset(counted).await.unwrap().last_verified_at.unwrap();
    let first = decide(other).await;
    assert_ne!(inspected, first);
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((coverage_sum(&coverage, |c| c.usable_seconds) - 300.0).abs() < 1e-9, "{coverage:?}");
    let label = Some(first.clone());
    assert_eq!(labels(&coverage), (label.clone(), vec![label.clone()]), "not {inspected}");

    // Reviewing the counted copy later keeps the oldest Usable verification.
    let second = decide(counted).await;
    assert_ne!(second, first);
    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    assert!((coverage_sum(&coverage, |c| c.usable_seconds) - 300.0).abs() < 1e-9, "{coverage:?}");
    assert_eq!(labels(&coverage), (label.clone(), vec![label]), "not {second}");
    assert_eq!((tree(&fx.root), tree(&nas)), before, "originals unchanged");
}

/// Light integration reads IMAGETYP as grouping does: OBJECT and SCIENCE count
/// exactly like Light Frame, a calibration frame counts toward no light total,
/// and IMAGETYP text that names no recognised frame type stays unknown exposure
/// instead of light.
#[tokio::test]
async fn coverage_counts_every_imagetyp_recognised_as_a_light_frame() {
    let fx = Fixture::new();
    let frames = [
        ("light.fits", "Light Frame"),
        ("object.fits", "OBJECT"),
        ("science.fits", "Science"),
        ("dark.fits", "DARK"),
        ("unclassified.fits", "Lights"),
    ];
    for (name, image_type) in frames {
        fx.write(name, image_type.as_bytes());
    }
    let before = tree(&fx.root);
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    let files = frames
        .iter()
        .map(|(name, image_type)| {
            let mut file = fx.scan_file(name);
            file.metadata.image_type = Some((*image_type).into());
            file
        })
        .collect();
    rescan_files(&catalog, &location, files).await;
    let sessions: Vec<ExpectedSession> = catalog
        .list_sessions(&SessionQuery::default())
        .await
        .unwrap()
        .iter()
        .map(|summary| expected_session(&summary.session))
        .collect();
    // The dark session is in no Sessions list (LIB-FR-16) and counts nowhere.
    assert_eq!(sessions.len(), frames.len() - 1);
    let saved = catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
    catalog.associate_target(&sessions, saved.candidate.id).await.unwrap();

    let coverage = catalog.target_coverage(saved.candidate.id).await.unwrap();
    let counted = (
        coverage_sum(&coverage, |c| c.captured_seconds),
        coverage_sum(&coverage, |c| c.unreviewed_seconds),
        coverage.contributions.iter().map(|c| c.unknown_exposure_count).sum::<u64>(),
    );
    assert_eq!(counted, (900.0, 900.0, 1), "{coverage:?}");
    assert_eq!(tree(&fx.root), before, "originals unchanged");
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

/// The last verification of each asset, read now.
async fn last_verified(catalog: &Catalog, assets: &[Asset]) -> Vec<Option<String>> {
    let mut stamps = Vec::with_capacity(assets.len());
    for asset in assets {
        stamps.push(catalog.asset(asset.id).await.unwrap().last_verified_at);
    }
    stamps
}

/// Every copy carries a last verification exactly when its digest is bound.
async fn assert_stamped_when_hashed(catalog: &Catalog, locations: &[&Location]) {
    for location in locations {
        for asset in catalog.location_assets(location.id).await.unwrap() {
            assert_eq!(
                asset.last_verified_at.is_some(),
                asset.fingerprint.content_sha256.is_some(),
                "{asset:?}"
            );
        }
    }
}

fn scan_file_at(root: &Path, name: &str) -> ScanFile {
    ScanFile {
        relative_path: NativePath::from_path(Path::new(name)),
        fingerprint: file_fingerprint(&root.join(name)).unwrap(),
        format: ImageFormat::Fits,
        metadata: metadata_for(name),
    }
}

/// Scan these files below `root` to a Completed observation in one batch.
async fn scan_at(
    catalog: &Catalog,
    location: &Location,
    root: &Path,
    names: &[&str],
) -> ScanOperation {
    let operation = running_scan_of(catalog, location, root, names).await;
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: DiskProbe.root_identity(location).unwrap(),
        files: names.iter().map(|name| scan_file_at(root, name)).collect(),
        issues: Vec::new(),
        complete_scopes: vec![root_scope()],
        incomplete_scopes: Vec::new(),
        progress: ScanProgress::default(),
        state: ScanState::Completed,
    };
    let finished = catalog
        .finish_scan(operation, &observation, |location| DiskProbe.root_identity(location), group)
        .await
        .unwrap();
    assert_eq!(finished.state, ScanState::Completed, "{finished:?}");
    finished
}

/// Begin a scan of `root` and apply these files in one batch, leaving it running.
async fn running_scan_of(
    catalog: &Catalog,
    location: &Location,
    root: &Path,
    names: &[&str],
) -> Uuid {
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let files = names.iter().map(|name| scan_file_at(root, name)).collect();
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
    assert_stamped_when_hashed(&catalog, &[&t7, &nas_location]).await;

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
    assert_stamped_when_hashed(&catalog, &[&t7, &nas_location]).await;
    assert!(catalog.duplicate_verification_work(operation).await.unwrap().is_empty());
    assert_eq!((tree(&fx.root), tree(&nas)), before, "sources unchanged");
}

/// Plain connection to a closed fixture catalog, for rows and schema state no
/// public catalog write produces.
async fn raw_connection(db: &Path) -> SqliteConnection {
    SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await.unwrap()
}

async fn recorded_version(conn: &mut SqliteConnection) -> i64 {
    sqlx::query_scalar("SELECT value FROM catalog_meta WHERE key = 'schema_version'")
        .fetch_one(conn)
        .await
        .unwrap()
}

async fn schema_objects(conn: &mut SqliteConnection) -> Vec<(String, String, String)> {
    sqlx::query_as("SELECT type, name, coalesce(sql, '') FROM sqlite_master ORDER BY type, name")
        .fetch_all(conn)
        .await
        .unwrap()
}

/// One `SCHEMA_VERSION` covers every schema module. A catalog recording any
/// other version, older or newer, is refused with the documented error before
/// any module's DDL touches it, and the file is left as it was. Recorded back at
/// `SCHEMA_VERSION`, the same file opens and the schema is applied again.
#[tokio::test]
async fn schema_version_mismatch_is_refused() {
    let fx = Fixture::new();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    let mut conn = raw_connection(&fx.db).await;
    assert_eq!(recorded_version(&mut conn).await, SCHEMA_VERSION, "a new catalog records it");
    // Without this index, any re-applied schema DDL would show.
    sqlx::query("DROP INDEX assets_pending").execute(&mut conn).await.unwrap();
    for version in [SCHEMA_VERSION - 1, SCHEMA_VERSION + 1] {
        sqlx::query("UPDATE catalog_meta SET value = ?1 WHERE key = 'schema_version'")
            .bind(version)
            .execute(&mut conn)
            .await
            .unwrap();
        let before = schema_objects(&mut conn).await;
        let error = Catalog::open(&fx.db).await.err().expect("a mismatched catalog is refused");
        assert_eq!(kind(&error), "invalid_input", "{error}");
        assert_eq!(
            error.to_string(),
            format!("invalid input: unsupported catalog schema version {version}")
        );
        assert_eq!(schema_objects(&mut conn).await, before, "no schema DDL ran");
        assert_eq!(recorded_version(&mut conn).await, version, "the version is left as it was");
    }
    sqlx::query("UPDATE catalog_meta SET value = ?1 WHERE key = 'schema_version'")
        .bind(SCHEMA_VERSION)
        .execute(&mut conn)
        .await
        .unwrap();
    Catalog::open(&fx.db).await.unwrap().close().await.unwrap();
    let objects = schema_objects(&mut conn).await;
    assert!(objects.iter().any(|(_, name, _)| name == "assets_pending"), "schema applied again");
    conn.close().await.unwrap();
}

/// `live_assets` is the one predicate that keeps Trashed frames out of queries
/// and totals (LIB-FR-18): every `assets` row and column except rows whose
/// stored availability is the model's `Trashed` encoding. A Trashed row still
/// reads back as its catalog record.
#[tokio::test]
async fn live_assets_excludes_trashed_rows() {
    let fx = Fixture::new();
    let names = ["night1/Ha_001.fits", "night1/Ha_002.fits", "night1/Ha_003.fits"];
    for name in names {
        fx.write(name, name.as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan(&catalog, &fx, &location, &names).await;
    let assets = catalog.location_assets(location.id).await.unwrap();
    let trashed = by_name(&assets, "Ha_002.fits").id;
    catalog.close().await.unwrap();

    // No catalog write trashes a frame yet, so store the model's encoding directly.
    let encoding = serde_json::to_value(Availability::Trashed).unwrap();
    let mut conn = raw_connection(&fx.db).await;
    sqlx::query("UPDATE assets SET availability = ?1 WHERE id = ?2")
        .bind(encoding.as_str().unwrap())
        .bind(trashed.to_string())
        .execute(&mut conn)
        .await
        .unwrap();
    let all: BTreeSet<String> = sqlx::query_scalar("SELECT id FROM assets")
        .fetch_all(&mut conn)
        .await
        .unwrap()
        .into_iter()
        .collect();
    let live: BTreeSet<String> = sqlx::query_scalar("SELECT id FROM live_assets")
        .fetch_all(&mut conn)
        .await
        .unwrap()
        .into_iter()
        .collect();
    assert_eq!(all.len(), names.len());
    let mut expected = all.clone();
    expected.remove(&trashed.to_string());
    assert_eq!(live, expected, "every row but the Trashed one");
    let columns = |row: &sqlx::sqlite::SqliteRow| {
        row.columns().iter().map(|column| column.name().to_owned()).collect::<Vec<_>>()
    };
    let table = sqlx::query("SELECT * FROM assets LIMIT 1").fetch_one(&mut conn).await.unwrap();
    let view = sqlx::query("SELECT * FROM live_assets LIMIT 1").fetch_one(&mut conn).await.unwrap();
    assert_eq!(columns(&view), columns(&table), "the view keeps every assets column");
    conn.close().await.unwrap();

    let catalog = Catalog::open(&fx.db).await.unwrap();
    assert_eq!(catalog.asset(trashed).await.unwrap().availability, Availability::Trashed);
    catalog.close().await.unwrap();
}

/// The user moved a Trashed frame to the OS Trash, so its stored state wins over
/// whatever its location reads: in an Offline location and in a Retired one it
/// still reads Trashed, while its untrashed siblings read Offline and Retired.
#[tokio::test]
async fn a_trashed_asset_reads_trashed_in_an_offline_or_retired_location() {
    let fx = Fixture::new();
    let names = ["Ha_001.fits", "Ha_002.fits"];
    let nas = fx.temp.path().join("NAS");
    std::fs::create_dir_all(&nas).unwrap();
    for name in names {
        fx.write(name, format!("T7 {name}").as_bytes());
        std::fs::write(nas.join(name), format!("NAS {name}")).unwrap();
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let offline = catalog.register_location(&fx.registration()).await.unwrap();
    let retired = catalog.register_location(&registration_at(&nas)).await.unwrap();
    scan(&catalog, &fx, &offline, &names).await;
    scan_at(&catalog, &retired, &nas, &names).await;
    let in_offline = catalog.location_assets(offline.id).await.unwrap();
    let in_retired = catalog.location_assets(retired.id).await.unwrap();
    let trashed = [by_name(&in_offline, "Ha_001.fits").id, by_name(&in_retired, "Ha_001.fits").id];
    let siblings = [by_name(&in_offline, "Ha_002.fits").id, by_name(&in_retired, "Ha_002.fits").id];
    catalog.close().await.unwrap();

    // No catalog write trashes a frame yet, so store the model's encoding directly.
    let encoding = serde_json::to_value(Availability::Trashed).unwrap();
    let mut conn = raw_connection(&fx.db).await;
    for id in trashed {
        sqlx::query("UPDATE assets SET availability = ?1 WHERE id = ?2")
            .bind(encoding.as_str().unwrap())
            .bind(id.to_string())
            .execute(&mut conn)
            .await
            .unwrap();
    }
    sqlx::query("UPDATE locations SET availability = 'offline' WHERE id = ?1")
        .bind(offline.id.to_string())
        .execute(&mut conn)
        .await
        .unwrap();
    sqlx::query("UPDATE locations SET lifecycle = 'retired' WHERE id = ?1")
        .bind(retired.id.to_string())
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();

    let catalog = Catalog::open(&fx.db).await.unwrap();
    for id in trashed {
        assert_eq!(catalog.asset(id).await.unwrap().availability, Availability::Trashed);
    }
    assert_eq!(catalog.asset(siblings[0]).await.unwrap().availability, Availability::Offline);
    assert_eq!(catalog.asset(siblings[1]).await.unwrap().availability, Availability::Retired);
    catalog.close().await.unwrap();
}
