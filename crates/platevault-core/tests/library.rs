mod support;

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use persistence_library::{SessionMember, SessionQuery};
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

fn expected_of(asset: &Asset) -> ExpectedAsset {
    ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    }
}

fn summed(coverage: &TargetCoverage, pick: fn(&CoverageContribution) -> f64) -> f64 {
    coverage.contributions.iter().map(pick).sum()
}

#[tokio::test]
async fn byte_identical_copies_in_two_locations_are_one_logical_capture() {
    let temp = tempfile::tempdir().unwrap();
    let (first, second) = (temp.path().join("T7"), temp.path().join("NAS"));
    std::fs::create_dir(&first).unwrap();
    std::fs::create_dir(&second).unwrap();
    let mut originals = Vec::new();
    for (name, start) in
        [("light_1.fits", "'2026-09-18T22:00:00'"), ("light_2.fits", "'2026-09-18T22:05:00'")]
    {
        let fields =
            [("IMAGETYP", "'LIGHT'"), ("FILTER", "'Ha'"), ("EXPTIME", "300"), ("DATE-OBS", start)];
        support::fits(&first.join(name), &fields).unwrap();
        std::fs::copy(first.join(name), second.join(name)).unwrap();
        originals.push((first.join(name), support::digest(&first.join(name))));
        originals.push((second.join(name), support::digest(&second.join(name))));
    }
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let mut locations = Vec::new();
    for root in [&first, &second] {
        let location = library
            .register_location(
                NativePath::from_path(root),
                "Captured".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap();
        assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
        locations.push(location.id);
    }
    let catalog = library.catalog();
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 1, "copies share one capture key");
    let session = sessions[0].session.clone();
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
    assert!(
        (summed(&coverage, |c| c.captured_seconds) - 600.0).abs() < 1e-9,
        "counted once: {coverage:?}"
    );
    assert!(!coverage.provisional, "{coverage:?}");
    let mut covered = coverage.covered_location_ids.clone();
    covered.sort_unstable();
    locations.sort_unstable();
    assert_eq!(covered, locations);
    let detail = catalog.session(session.id).await.unwrap();
    assert_eq!((detail.summary.asset_count, detail.summary.capture_count), (4, 2));
    assert_eq!(detail.members.len(), 2, "each frame listed once");
    for member in &detail.members {
        assert!(member.content_sha256.is_some() && !member.duplicate_candidate, "{member:?}");
        let homes: Vec<Uuid> = member
            .copies
            .iter()
            .map(|id| detail.assets.iter().find(|asset| asset.id == *id).unwrap().location_id)
            .collect();
        assert_eq!(homes.len(), 2, "both physical copies named");
        assert_ne!(homes[0], homes[1]);
    }

    // A decision on either copy applies to the logical capture.
    let member = &detail.members[0];
    let first_copy = catalog.asset(member.copies[0]).await.unwrap();
    catalog
        .set_quality(&[expected_of(&first_copy)], Quality::Usable, InventoryProbe)
        .await
        .unwrap();
    let coverage = catalog.target_coverage(target).await.unwrap();
    assert!((summed(&coverage, |c| c.usable_seconds) - 300.0).abs() < 1e-9, "{coverage:?}");
    assert!((summed(&coverage, |c| c.unreviewed_seconds) - 300.0).abs() < 1e-9);
    // Conflicting explicit decisions count as neither Usable nor Unreviewed.
    let second = catalog.asset(member.copies[1]).await.unwrap();
    catalog.set_quality(&[expected_of(&second)], Quality::Unusable, InventoryProbe).await.unwrap();
    let coverage = catalog.target_coverage(target).await.unwrap();
    assert!(summed(&coverage, |c| c.usable_seconds).abs() < 1e-9, "{coverage:?}");
    assert!((summed(&coverage, |c| c.unreviewed_seconds) - 300.0).abs() < 1e-9);
    assert!((summed(&coverage, |c| c.captured_seconds) - 600.0).abs() < 1e-9);
    assert_eq!(coverage.contributions.iter().map(|c| c.conflicting_decisions).sum::<u64>(), 1);
    let detail = catalog.session(session.id).await.unwrap();
    assert!(detail.members.iter().any(|m| m.applicable_quality == ApplicableQuality::Conflicting));
    for location in &locations {
        assert_eq!(catalog.location_assets(*location).await.unwrap().len(), 2, "every copy stays");
    }
    for (path, digest) in &originals {
        assert_eq!(&support::digest(path), digest, "copies are read-only");
    }
}

fn m31_frame(start: &str) -> [(&'static str, String); 9] {
    [
        ("IMAGETYP", "'LIGHT'".into()),
        ("FILTER", "'Ha'".into()),
        ("EXPTIME", "300".into()),
        ("DATE-OBS", format!("'{start}'")),
        ("OBJECT", "'M31'".into()),
        ("RA", "10.684708".into()),
        ("DEC", "41.26875".into()),
        ("FOCALLEN", "1".into()),
        ("XPIXSZ", "3.76".into()),
    ]
}

fn write_frame(path: &Path, start: &str) {
    let fields = m31_frame(start);
    let fields: Vec<(&str, &str)> =
        fields.iter().map(|(key, value)| (*key, value.as_str())).collect();
    support::fits(path, &fields).unwrap();
}

fn target_of(
    detail: &persistence_library::SessionDetail,
) -> Option<(AssociationState, Option<Uuid>)> {
    detail
        .associations
        .iter()
        .find(|association| association.kind == AssociationKind::Target)
        .map(|association| (association.state.clone(), association.subject_id))
}

#[tokio::test]
async fn a_partial_filter_correction_refreshes_every_successor_session() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("captures");
    std::fs::create_dir(&root).unwrap();
    let mut originals = Vec::new();
    for (index, start) in
        ["2026-09-18T22:00:00", "2026-09-18T22:05:00", "2026-09-18T22:10:00"].iter().enumerate()
    {
        let path = root.join(format!("light_{index}.fits"));
        write_frame(&path, start);
        originals.push((path.clone(), support::digest(&path)));
    }
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captured".into(), LocationRole::Captures)
        .await
        .unwrap();
    assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
    let catalog = library.catalog();
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.clone();
    let detail = catalog.session(session.id).await.unwrap();
    let (state, m31) = target_of(&detail).unwrap();
    assert_eq!(state, AssociationState::Suggested);
    let m31 = m31.unwrap();
    let captured = |coverage: &TargetCoverage| summed(coverage, |c| c.captured_seconds);
    assert!((captured(&catalog.target_coverage(m31).await.unwrap()) - 900.0).abs() < 1e-9);

    // One frame's filter is corrected: the session splits into two successors.
    let corrected = expected_of(&detail.assets[0]);
    let correction = CorrectionInput {
        asset_id: corrected.asset_id,
        field: "filter".into(),
        value: serde_json::json!("OIII"),
    };
    let preview = catalog
        .preview_correction(
            std::slice::from_ref(&corrected),
            &[correction],
            platevault_core::grouping::group_assets,
        )
        .await
        .unwrap();
    let confirmed = library.confirm_correction(preview.id, &[corrected]).await.unwrap();
    assert!(confirmed.association_refresh.is_none());
    let successors = confirmed.outcome.lineage.unwrap().successors;
    assert_eq!(successors.len(), 2, "the remainder and the corrected frame");
    for successor in successors {
        let detail = catalog.session(successor).await.unwrap();
        assert_eq!(
            target_of(&detail),
            Some((AssociationState::Suggested, Some(m31))),
            "successor of {} frame(s) re-derived",
            detail.assets.len()
        );
    }
    assert!((captured(&catalog.target_coverage(m31).await.unwrap()) - 900.0).abs() < 1e-9);
    for (path, digest) in &originals {
        assert_eq!(&support::digest(path), digest);
    }
}

/// Two locations holding byte-identical copies of two frames, both indexed, with
/// the session confirmed as a user target.
async fn copied_library(temp: &tempfile::TempDir) -> (Arc<Library>, Vec<Location>, Uuid) {
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let mut locations = Vec::new();
    for name in ["T7", "NAS"] {
        let root = temp.path().join(name);
        std::fs::create_dir(&root).unwrap();
        write_frame(&root.join("light_1.fits"), "2026-09-18T22:00:00");
        write_frame(&root.join("light_2.fits"), "2026-09-18T22:05:00");
        let location = library
            .register_location(NativePath::from_path(&root), name.into(), LocationRole::Captures)
            .await
            .unwrap();
        assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
        locations.push(location);
    }
    let catalog = library.catalog();
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
    let expected = ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    };
    catalog.associate_target(&[expected], target).await.unwrap();
    (library, locations, target)
}

async fn copy_named(library: &Library, location: &Location, name: &str) -> Asset {
    let assets = library.catalog().location_assets(location.id).await.unwrap();
    assets.into_iter().find(|asset| asset.relative_path.display() == name).unwrap()
}

#[tokio::test]
async fn a_missing_copy_stays_inside_its_logical_capture() {
    let temp = tempfile::tempdir().unwrap();
    let (library, locations, target) = copied_library(&temp).await;
    let catalog = library.catalog();
    let reviewed = copy_named(&library, &locations[0], "light_1.fits").await;
    catalog.set_quality(&[expected_of(&reviewed)], Quality::Usable, InventoryProbe).await.unwrap();
    let kept = [
        temp.path().join("T7/light_2.fits"),
        temp.path().join("NAS/light_1.fits"),
        temp.path().join("NAS/light_2.fits"),
    ];
    let originals: Vec<String> = kept.iter().map(|path| support::digest(path)).collect();

    // The reviewed T7 copy is deleted and its location rescanned.
    std::fs::remove_file(temp.path().join("T7/light_1.fits")).unwrap();
    assert_eq!(scan_to_end(&library, locations[0].id).await.state, ScanState::Completed);
    assert_eq!(catalog.asset(reviewed.id).await.unwrap().availability, Availability::Missing);
    let coverage = catalog.target_coverage(target).await.unwrap();
    assert!((summed(&coverage, |c| c.captured_seconds) - 600.0).abs() < 1e-9, "{coverage:?}");
    assert!((summed(&coverage, |c| c.usable_seconds) - 300.0).abs() < 1e-9, "{coverage:?}");
    assert!((summed(&coverage, |c| c.unreviewed_seconds) - 300.0).abs() < 1e-9);
    let session = catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].clone();
    let detail = catalog.session(session.session.id).await.unwrap();
    assert_eq!((session.capture_count, detail.members.len()), (2, 2), "one count everywhere");
    let member = detail.members.iter().find(|m| m.copies.contains(&reviewed.id)).unwrap();
    assert_eq!(member.copies.len(), 2, "the Missing copy stays listed in its capture");
    assert_eq!(member.applicable_quality, ApplicableQuality::Usable);
    let after: Vec<String> = kept.iter().map(|path| support::digest(path)).collect();
    assert_eq!(after, originals);
}

/// Flip the last pixel byte of a copy in place, keeping its size and mtime.
fn replace_pixels_in_place(path: &Path) -> String {
    let mut bytes = std::fs::read(path).unwrap();
    *bytes.last_mut().unwrap() ^= 0xff;
    rewrite_same_stat(path, &bytes);
    support::digest(path)
}

fn conflicting_copies(coverage: &TargetCoverage) -> u64 {
    coverage.contributions.iter().map(|contribution| contribution.conflicting_copies).sum()
}

/// The capture of `name` in the location's session, with its copies' locations.
async fn capture_of(library: &Library, location: &Location, name: &str) -> (SessionMember, u64) {
    let copy = copy_named(library, location, name).await;
    let session =
        library.catalog().list_sessions(&SessionQuery::default()).await.unwrap()[0].clone();
    let detail = library.catalog().session(session.session.id).await.unwrap();
    let member =
        detail.members.into_iter().find(|member| member.copies.contains(&copy.id)).unwrap();
    (member, session.capture_count)
}

#[tokio::test]
async fn a_same_stat_replaced_copy_is_rehashed_and_names_the_pair_conflicting_copies() {
    let temp = tempfile::tempdir().unwrap();
    let (library, locations, target) = copied_library(&temp).await;
    let catalog = library.catalog();
    let (aliased, _) = capture_of(&library, &locations[0], "light_1.fits").await;
    assert_eq!(aliased.copies.len(), 2);
    assert!(aliased.content_sha256.is_some());
    let kept = [temp.path().join("T7/light_1.fits"), temp.path().join("T7/light_2.fits")];
    let originals: Vec<String> = kept.iter().map(|path| support::digest(path)).collect();
    // Nobody reviewed either copy; the NAS copy is replaced in place.
    let replaced = temp.path().join("NAS/light_1.fits");
    let replaced_digest = replace_pixels_in_place(&replaced);

    assert_eq!(scan_to_end(&library, locations[1].id).await.state, ScanState::Completed);
    let copy = copy_named(&library, &locations[1], "light_1.fits").await;
    assert_eq!(copy.fingerprint.content_sha256.as_deref(), Some(replaced_digest.as_str()));
    let (member, capture_count) = capture_of(&library, &locations[1], "light_1.fits").await;
    assert_eq!(member.applicable_quality, ApplicableQuality::ConflictingCopies);
    assert_eq!((member.copies.len(), member.content_sha256.as_deref()), (2, None));
    assert_eq!(capture_count, 2, "the pair still counts once");
    let coverage = catalog.target_coverage(target).await.unwrap();
    assert!((summed(&coverage, |c| c.captured_seconds) - 600.0).abs() < 1e-9, "{coverage:?}");
    assert!((summed(&coverage, |c| c.unreviewed_seconds) - 300.0).abs() < 1e-9, "{coverage:?}");
    assert_eq!(conflicting_copies(&coverage), 1);
    for location in &locations {
        assert_eq!(catalog.location_assets(location.id).await.unwrap().len(), 2, "both registered");
    }
    let after: Vec<String> = kept.iter().map(|path| support::digest(path)).collect();
    assert_eq!(after, originals);
    assert_eq!(support::digest(&replaced), replaced_digest, "the scan wrote nothing");
}

#[tokio::test]
async fn a_replaced_copy_never_carries_another_copys_decision() {
    let temp = tempfile::tempdir().unwrap();
    let (library, locations, target) = copied_library(&temp).await;
    let catalog = library.catalog();
    let reviewed = copy_named(&library, &locations[0], "light_1.fits").await;
    catalog.set_quality(&[expected_of(&reviewed)], Quality::Usable, InventoryProbe).await.unwrap();
    let kept = [
        temp.path().join("T7/light_1.fits"),
        temp.path().join("T7/light_2.fits"),
        temp.path().join("NAS/light_2.fits"),
    ];
    let originals: Vec<String> = kept.iter().map(|path| support::digest(path)).collect();
    let replaced = temp.path().join("NAS/light_1.fits");
    let replaced_digest = replace_pixels_in_place(&replaced);

    // The NAS rescan rehashes the copy that carried the T7 decision.
    assert_eq!(scan_to_end(&library, locations[1].id).await.state, ScanState::Completed);
    let copy = copy_named(&library, &locations[1], "light_1.fits").await;
    assert_eq!(copy.fingerprint.content_sha256.as_deref(), Some(replaced_digest.as_str()));
    assert!(!copy.verification_pending);
    // With T7 offline the available NAS copy is not offered in its place.
    std::fs::rename(temp.path().join("T7"), temp.path().join("T7-unplugged")).unwrap();
    assert_eq!(scan_to_end(&library, locations[0].id).await.state, ScanState::Failed);
    std::fs::rename(temp.path().join("T7-unplugged"), temp.path().join("T7")).unwrap();
    let coverage = catalog.target_coverage(target).await.unwrap();
    assert!((summed(&coverage, |c| c.captured_seconds) - 600.0).abs() < 1e-9, "{coverage:?}");
    assert!(summed(&coverage, |c| c.usable_seconds).abs() < 1e-9, "{coverage:?}");
    assert!((summed(&coverage, |c| c.unreviewed_seconds) - 300.0).abs() < 1e-9);
    assert_eq!(conflicting_copies(&coverage), 1);
    let after: Vec<String> = kept.iter().map(|path| support::digest(path)).collect();
    assert_eq!(after, originals);
    assert_eq!(support::digest(&replaced), replaced_digest, "the scan wrote nothing");
}

#[tokio::test]
async fn candidates_whose_digests_differ_are_conflicting_copies_counted_once() {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let mut locations = Vec::new();
    let mut originals = Vec::new();
    for name in ["T7", "NAS"] {
        let root = temp.path().join(name);
        std::fs::create_dir(&root).unwrap();
        let light = root.join("light_1.fits");
        write_frame(&light, "2026-09-18T22:00:00");
        if name == "NAS" {
            // Same header, size and start time; different pixels.
            let mut bytes = std::fs::read(&light).unwrap();
            *bytes.last_mut().unwrap() ^= 0xff;
            std::fs::write(&light, &bytes).unwrap();
        }
        originals.push((light.clone(), support::digest(&light)));
        let location = library
            .register_location(NativePath::from_path(&root), name.into(), LocationRole::Captures)
            .await
            .unwrap();
        assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
        locations.push(location);
    }
    let (member, capture_count) = capture_of(&library, &locations[0], "light_1.fits").await;
    assert_eq!(member.applicable_quality, ApplicableQuality::ConflictingCopies);
    assert!(!member.duplicate_candidate, "both copies were hashed");
    assert_eq!((member.copies.len(), capture_count), (2, 1));
    let session =
        library.catalog().list_sessions(&SessionQuery::default()).await.unwrap()[0].clone();
    assert!(!session.provisional, "hashed conflicting copies are not provisional");
    for (path, digest) in &originals {
        assert_eq!(&support::digest(path), digest);
    }
}

/// A light frame of one session; `frame` varies the header bytes, not the size.
fn write_light(path: &Path, frame: usize, start: Option<&str>) {
    let number = frame.to_string();
    let start = start.map(|start| format!("'{start}'"));
    let mut fields =
        vec![("IMAGETYP", "'LIGHT'"), ("FILTER", "'Ha'"), ("EXPTIME", "300"), ("FRAMENO", &number)];
    if let Some(start) = &start {
        fields.push(("DATE-OBS", start));
    }
    support::fits(path, &fields).unwrap();
}

/// Index `frames` lights into T7 and copy them to NAS (`differ` frames get other
/// pixels there), returning the library, both locations and every original digest.
async fn two_location_library(
    temp: &tempfile::TempDir,
    frames: usize,
    start: Option<&str>,
    differ: &[usize],
) -> (Arc<Library>, Vec<Location>, Vec<(std::path::PathBuf, String)>) {
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let mut locations = Vec::new();
    let mut originals = Vec::new();
    for name in ["T7", "NAS"] {
        let root = temp.path().join(name);
        std::fs::create_dir(&root).unwrap();
        for frame in 0..frames {
            let path = root.join(format!("light_{frame}.fits"));
            write_light(&path, frame, start);
            if name == "NAS" && differ.contains(&frame) {
                let mut bytes = std::fs::read(&path).unwrap();
                *bytes.last_mut().unwrap() ^= 0xff;
                std::fs::write(&path, &bytes).unwrap();
            }
            originals.push((path.clone(), support::digest(&path)));
        }
        let location = library
            .register_location(NativePath::from_path(&root), name.into(), LocationRole::Captures)
            .await
            .unwrap();
        assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
        locations.push(location);
    }
    (library, locations, originals)
}

async fn only_session(
    library: &Library,
) -> (persistence_library::SessionSummary, persistence_library::SessionDetail) {
    let sessions = library.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
    assert_eq!(sessions.len(), 1, "one capture key across both locations");
    let detail = library.catalog().session(sessions[0].session.id).await.unwrap();
    (sessions[0].clone(), detail)
}

#[tokio::test]
async fn copies_without_a_capture_start_join_only_by_equal_digest() {
    // No DATE-OBS at all, and a date-only DATE-OBS without a time of day.
    for start in [None, Some("2026-09-18")] {
        let temp = tempfile::tempdir().unwrap();
        let (library, _, originals) = two_location_library(&temp, 3, start, &[]).await;
        let (session, detail) = only_session(&library).await;
        assert!(detail.members.iter().all(|m| !m.duplicate_candidate), "{start:?}: no match");
        assert!(
            detail.assets.iter().all(|asset| asset.fingerprint.content_sha256.is_none()),
            "{start:?}: an unknown start is no duplicate candidate, so nothing is hashed"
        );
        // Every frame is reviewed, so every copy is hashed.
        for asset in &detail.assets {
            let asset = library.catalog().asset(asset.id).await.unwrap();
            library
                .catalog()
                .set_quality(&[expected_of(&asset)], Quality::Usable, InventoryProbe)
                .await
                .unwrap();
        }
        let (after, detail) = only_session(&library).await;
        assert_eq!((session.asset_count, after.capture_count), (6, 3), "{start:?}: by digest");
        assert_eq!(detail.members.len(), 3);
        for member in &detail.members {
            assert_eq!(member.copies.len(), 2, "{member:?}");
            assert_eq!(member.applicable_quality, ApplicableQuality::Usable, "{member:?}");
        }
        for (path, digest) in &originals {
            assert_eq!(&support::digest(path), digest);
        }
    }
}

#[tokio::test]
async fn ambiguous_same_start_matches_never_join_copies() {
    let temp = tempfile::tempdir().unwrap();
    // Three same-size frames share one start time; the NAS copy of frame 2 differs.
    let (library, _, originals) =
        two_location_library(&temp, 3, Some("2026-09-18T22:00:00"), &[2]).await;
    let (session, detail) = only_session(&library).await;
    assert!(detail.assets.iter().all(|asset| asset.fingerprint.content_sha256.is_some()));
    assert!(!session.provisional, "every candidate was hashed");
    assert_eq!(session.capture_count, 4, "two identical pairs and two unrelated frames");
    assert!(
        detail.members.iter().all(|m| m.applicable_quality != ApplicableQuality::ConflictingCopies),
        "{:?}",
        detail.members
    );
    let sizes: Vec<usize> = detail.members.iter().map(|member| member.copies.len()).collect();
    assert_eq!(sizes.iter().filter(|copies| **copies == 2).count(), 2, "{sizes:?}");
    for (path, digest) in &originals {
        assert_eq!(&support::digest(path), digest);
    }
}
