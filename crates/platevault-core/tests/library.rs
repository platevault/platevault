mod support;

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::targets::TargetQuery;
use platevault_core::*;
use uuid::Uuid;

async fn terminal(library: &Arc<Library>, id: Uuid) -> ScanOperation {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = library.catalog().scan_status(id).await.unwrap();
            if operation.state != ScanState::Running {
                return operation;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("scan must reach a durable terminal state")
}

#[tokio::test]
async fn real_composed_library_preserves_sources_quality_and_restart() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("captures");
    std::fs::create_dir(&root).unwrap();
    let fits = root.join("light.fits");
    let xisf = root.join("light.xisf");
    let fields = [
        ("IMAGETYP", "'LIGHT'"),
        ("FILTER", "'Ha'"),
        ("EXPTIME", "300"),
        ("DATE-OBS", "'2026-09-18T22:00:00Z'"),
        ("OBJECT", "'M31'"),
        ("RA", "10.684708"),
        ("DEC", "41.26875"),
        ("FOCALLEN", "1"),
        ("XPIXSZ", "3.76"),
    ];
    support::fits(&fits, &fields).unwrap();
    support::xisf(&xisf, &fields).unwrap();
    let originals = [support::digest(&fits), support::digest(&xisf)];
    let database = temp.path().join("library.sqlite");
    let library = Library::open(&database, None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captured".into(), LocationRole::Captures)
        .await
        .unwrap();
    assert!(library.catalog().location_assets(location.id).await.unwrap().is_empty());
    let started = library.start_scan(location.id, None).await.unwrap();
    assert_eq!(started.state, ScanState::Running);
    let finished = terminal(&library, started.id).await;
    assert_eq!(finished.state, ScanState::Completed);
    assert!(finished.revision > started.revision);
    assert_eq!(finished.progress.metadata_read, 2);
    let assets = library.catalog().location_assets(location.id).await.unwrap();
    assert_eq!(assets.len(), 2);
    let first = &assets[0];
    let expected = ExpectedAsset {
        asset_id: first.id,
        decision_revision: first.decision_revision,
        fingerprint: first.fingerprint.clone(),
    };
    let reviewed =
        library.catalog().set_quality(&[expected], Quality::Usable, InventoryProbe).await.unwrap();
    assert_eq!(reviewed[0].applicable_quality(), ApplicableQuality::Usable);
    assert!(reviewed[0].quality_basis.as_ref().unwrap().content_sha256.is_some());
    let query = SessionQuery::default();
    let sessions = library.catalog().list_sessions(&query).await.unwrap();
    let inspected = library.session(sessions[0].session.id).await.unwrap();
    assert_eq!(inspected.detail.summary.session.id, sessions[0].session.id);
    let suggested = inspected
        .detail
        .associations
        .iter()
        .find(|association| association.kind == AssociationKind::Target)
        .unwrap();
    assert_eq!(suggested.state, AssociationState::Suggested);
    let coverage = library.catalog().target_coverage(suggested.subject_id.unwrap()).await.unwrap();
    assert!(
        (coverage.contributions.iter().map(|item| item.captured_seconds).sum::<f64>() - 600.0)
            .abs()
            < 1e-9
    );
    assert!(
        (coverage.contributions.iter().map(|item| item.usable_seconds).sum::<f64>() - 300.0).abs()
            < 1e-9
    );
    let targets = library
        .search_targets(&TargetQuery { text: Some("M31".into()), cone: None, limit: 5 })
        .await
        .unwrap();
    let m31 = targets.iter().find(|hit| hit.candidate.designation == "M 31").unwrap();
    assert_eq!(
        m31.candidate.provenance,
        Provenance::Seed { dataset: "bundled-seed/v1/sha256:aa442354ca1f36cd".into() }
    );
    assert!(matches!(
        library.resolve_target("M31").await,
        Err(LibraryError::ProviderUnavailable(_))
    ));
    drop(library);
    let reopened = Library::open(&database, None).await.unwrap();
    assert_eq!(
        reopened.catalog().asset(first.id).await.unwrap().applicable_quality(),
        ApplicableQuality::Usable
    );
    assert_eq!([support::digest(&fits), support::digest(&xisf)], originals);
}

#[tokio::test]
async fn confirmed_object_correction_refreshes_the_stored_target_association() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("captures");
    std::fs::create_dir(&root).unwrap();
    let fits = root.join("light.fits");
    let xisf = root.join("light.xisf");
    let fields = [
        ("IMAGETYP", "'LIGHT'"),
        ("FILTER", "'Ha'"),
        ("EXPTIME", "300"),
        ("DATE-OBS", "'2026-09-18T22:00:00Z'"),
        ("RA", "10.684708"),
        ("DEC", "41.26875"),
        ("FOCALLEN", "1"),
        ("XPIXSZ", "3.76"),
    ];
    support::fits(&fits, &fields).unwrap();
    support::xisf(&xisf, &fields).unwrap();
    let originals = [support::digest(&fits), support::digest(&xisf)];
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captured".into(), LocationRole::Captures)
        .await
        .unwrap();
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location.id, None).await.unwrap();
    // The Completed event is published only after scan-time suggestions are recorded.
    let completed = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                return operation;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state");
    assert_eq!(completed.state, ScanState::Completed);
    let stored_target = |detail: &persistence_library::SessionDetail| {
        detail
            .associations
            .iter()
            .find(|association| association.kind == AssociationKind::Target)
            .map(|association| (association.state.clone(), association.subject_id))
            .unwrap()
    };
    let sessions = library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 1);
    let before = library.catalog().session(sessions[0].session.id).await.unwrap();
    assert_eq!(stored_target(&before).0, AssociationState::NeedsReview, "no OBJECT alias yet");

    let expected = before
        .assets
        .iter()
        .map(|asset| ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        })
        .collect::<Vec<_>>();
    let corrections = expected
        .iter()
        .map(|asset| CorrectionInput {
            asset_id: asset.asset_id,
            field: "object".into(),
            value: serde_json::json!("M 31"),
        })
        .collect::<Vec<_>>();
    let preview = library
        .catalog()
        .preview_correction(&expected, &corrections, platevault_core::grouping::group_assets)
        .await
        .unwrap();
    let confirmed = library.confirm_correction(preview.id, &expected).await.unwrap();
    assert!(confirmed.association_refresh.is_none());
    assert_eq!(confirmed.outcome.sessions.len(), 1);

    let after = library.catalog().session(confirmed.outcome.sessions[0].id).await.unwrap();
    let (state, subject) = stored_target(&after);
    assert_eq!(state, AssociationState::Suggested, "stored association refreshed on confirm");
    let m31 = library.catalog().target(subject.unwrap()).await.unwrap();
    assert_eq!(m31.candidate.designation, "M 31");
    assert!(after.assets.iter().all(|asset| asset.observed.object.is_none()), "observed kept");
    assert_eq!([support::digest(&fits), support::digest(&xisf)], originals);
}

#[tokio::test]
async fn retry_runs_a_real_scoped_worker_and_offline_scan_retains_observations() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("captures");
    let scope = root.join("night");
    std::fs::create_dir_all(&scope).unwrap();
    support::fits(&scope.join("light.fits"), &[("IMAGETYP", "'LIGHT'"), ("EXPTIME", "60")])
        .unwrap();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captured".into(), LocationRole::Captures)
        .await
        .unwrap();
    let retry =
        library.retry_scope(location.id, NativePath::from_path(Path::new("night"))).await.unwrap();
    assert_eq!(terminal(&library, retry.id).await.state, ScanState::Completed);
    let asset = library.catalog().location_assets(location.id).await.unwrap().remove(0);
    let unavailable_scope = library
        .retry_scope(location.id, NativePath::from_path(Path::new("missing-sub")))
        .await
        .unwrap();
    assert_eq!(terminal(&library, unavailable_scope.id).await.state, ScanState::Failed);
    assert_eq!(
        library.catalog().location(location.id).await.unwrap().availability,
        Availability::Available
    );
    assert_eq!(
        library.catalog().asset(asset.id).await.unwrap().availability,
        Availability::Available
    );
    std::fs::rename(&root, temp.path().join("offline")).unwrap();
    let scan = library.start_scan(location.id, None).await.unwrap();
    let failed = terminal(&library, scan.id).await;
    assert_eq!(failed.state, ScanState::Failed);
    assert!(!failed.issues.is_empty());
    assert!(failed.complete_scopes.is_empty());
    let retained = library.catalog().asset(asset.id).await.unwrap();
    assert_eq!(retained.availability, Availability::Offline);
    assert_eq!(retained.fingerprint, asset.fingerprint);
}

#[tokio::test]
async fn malformed_headers_are_visible_file_issues_and_valid_siblings_commit() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("captures");
    std::fs::create_dir(&root).unwrap();
    let fields = [("IMAGETYP", "'LIGHT'"), ("FILTER", "'Ha'"), ("EXPTIME", "60")];
    let valid = root.join("light.fits");
    support::fits(&valid, &fields).unwrap();
    let zeroed = root.join("zeroed.fits");
    std::fs::write(&zeroed, [0_u8; 2880]).unwrap();
    let empty = root.join("empty.fits");
    std::fs::write(&empty, []).unwrap();
    let truncated = root.join("truncated.xisf");
    support::xisf(&truncated, &fields).unwrap();
    let whole = std::fs::read(&truncated).unwrap();
    std::fs::write(&truncated, &whole[..40]).unwrap();
    let sources = [&valid, &zeroed, &empty, &truncated];
    let originals: Vec<String> = sources.iter().map(|path| support::digest(path)).collect();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captured".into(), LocationRole::Captures)
        .await
        .unwrap();
    let started = library.start_scan(location.id, None).await.unwrap();
    let finished = terminal(&library, started.id).await;
    assert_eq!(finished.state, ScanState::Partial, "{finished:?}");
    for name in ["zeroed.fits", "empty.fits", "truncated.xisf"] {
        let issue = finished
            .issues
            .iter()
            .find(|issue| issue.relative_path.display() == name)
            .unwrap_or_else(|| panic!("{name} must be a visible per-file issue: {finished:?}"));
        assert!(issue.reason.contains("unreadable"), "{name}: {}", issue.reason);
        assert_eq!(issue.availability, Availability::Unreadable, "{name}");
        assert!(finished.incomplete_scopes.contains(&issue.relative_path), "{name}");
    }
    let assets = library.catalog().location_assets(location.id).await.unwrap();
    let names: Vec<String> = assets.iter().map(|asset| asset.relative_path.display()).collect();
    assert_eq!(names, ["light.fits"], "only the readable file is indexed");
    assert_eq!(assets[0].availability, Availability::Available);
    let location = library.catalog().location(location.id).await.unwrap();
    assert_eq!(location.availability, Availability::Available);
    let after: Vec<String> = sources.iter().map(|path| support::digest(path)).collect();
    assert_eq!(after, originals, "sources are read-only");
}

/// Start a scan and wait for its terminal event, published after scan-time work.
async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                return operation;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state")
}

/// Write `bytes` over a file in place, keeping its size and nanosecond mtime.
fn rewrite_same_stat(path: &Path, bytes: &[u8]) {
    assert_eq!(std::fs::metadata(path).unwrap().len(), bytes.len() as u64);
    let modified = std::fs::metadata(path).unwrap().modified().unwrap();
    let file = std::fs::OpenOptions::new().write(true).truncate(true).open(path).unwrap();
    std::io::Write::write_all(&mut &file, bytes).unwrap();
    file.set_modified(modified).unwrap();
    file.sync_all().unwrap();
}

fn usable_seconds(coverage: &TargetCoverage) -> f64 {
    coverage.contributions.iter().map(|contribution| contribution.usable_seconds).sum()
}

#[tokio::test]
async fn same_stat_replacement_leaves_usable_totals_until_the_reviewed_bytes_return() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("captures");
    std::fs::create_dir(&root).unwrap();
    let light = root.join("light.fits");
    let fields = [("IMAGETYP", "'LIGHT'"), ("FILTER", "'Ha'"), ("EXPTIME", "300")];
    support::fits(&light, &fields).unwrap();
    let reviewed_bytes = std::fs::read(&light).unwrap();
    let original = support::digest(&light);
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captured".into(), LocationRole::Captures)
        .await
        .unwrap();
    assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
    let catalog = library.catalog();
    let asset = catalog.location_assets(location.id).await.unwrap().remove(0);
    let expected = ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    };
    let decided = catalog.set_quality(&[expected], Quality::Usable, InventoryProbe).await.unwrap();
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let target = TargetCandidate {
        id: Uuid::new_v4(),
        designation: "NGC 7000".into(),
        aliases: Vec::new(),
        common_name: None,
        object_type: "nebula".into(),
        coordinates: None,
        provenance: Provenance::User,
        provider_id: None,
    };
    let target = catalog.save_target(&target, None).await.unwrap().candidate.id;
    let expected_session = ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    };
    catalog.associate_target(&[expected_session], target).await.unwrap();
    let coverage = catalog.target_coverage(target).await.unwrap();
    assert!((usable_seconds(&coverage) - 300.0).abs() < 1e-9, "{coverage:?}");

    // A pixel changes in place; size and nanosecond mtime stay the same.
    let mut replaced = reviewed_bytes.clone();
    *replaced.last_mut().unwrap() ^= 0xff;
    rewrite_same_stat(&light, &replaced);
    assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
    let changed = catalog.asset(asset.id).await.unwrap();
    assert_eq!(changed.quality, Quality::Usable, "the decision is kept as history");
    assert_eq!(
        changed.applicable_quality(),
        ApplicableQuality::ChangedContent { previous: Quality::Usable }
    );
    let coverage = catalog.target_coverage(target).await.unwrap();
    assert!(usable_seconds(&coverage).abs() < 1e-9, "left usable totals: {coverage:?}");
    assert_eq!(coverage.contributions.iter().map(|c| c.drifted_decisions).sum::<u64>(), 1);
    let membership = catalog.session(session.id).await.unwrap().summary;
    assert!(membership.successors.is_empty() && membership.session.asset_ids == session.asset_ids);

    // The reviewed bytes return: applicable again without a new decision.
    rewrite_same_stat(&light, &reviewed_bytes);
    assert_eq!(support::digest(&light), original);
    assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
    let restored = catalog.asset(asset.id).await.unwrap();
    assert_eq!(restored.applicable_quality(), ApplicableQuality::Usable);
    assert_eq!(restored.decision_revision, decided[0].decision_revision, "no new decision");
    let coverage = catalog.target_coverage(target).await.unwrap();
    assert!((usable_seconds(&coverage) - 300.0).abs() < 1e-9, "{coverage:?}");
    assert!(!coverage.provisional);
    assert_eq!(support::digest(&light), original);
}
