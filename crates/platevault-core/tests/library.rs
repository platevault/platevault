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
