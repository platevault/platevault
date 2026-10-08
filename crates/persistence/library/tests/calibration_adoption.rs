// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Master adoption (spec 068, D05): a durable review that writes no file, then a
//! confirmed copy into a registered Calibration location that is re-read and
//! hash-verified before the master is registered with its provenance. Every
//! scenario compares the fixture's hash manifest before and after.
#![cfg(unix)]

#[path = "support/calibration.rs"]
mod calibration_support;
mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use calibration_support::*;
use persistence_library::{Catalog, InputQuery, LocationReferences};
use platevault_model::{
    AdoptionDestination, AdoptionPhase, AdoptionSource, AdoptionState, Asset, Availability,
    CandidateRef, InputForm, InputKind, Location, LocationRole, MasterBasis, MasterOrigin,
    NativePath, ReferenceKind, ReviewState,
};
use support::*;
use uuid::Uuid;

const ADOPTION_TABLES: [&str; 3] = ["adoption_reviews", "adoption_operations", "adopted_masters"];

struct Lib {
    fx: Fixture,
    catalog: Catalog,
    results: Location,
    results_root: PathBuf,
    calibration: Location,
    calibration_root: PathBuf,
}

/// A Results location holding a Siril master flat (STACKCNT 30) and a
/// Calibration location with an existing `masters/` folder and raw Ha flats.
async fn library() -> Lib {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let (results, results_root) =
        location_at(&catalog, &fx, "Work/Processing", LocationRole::Results).await;
    let mut master = with_train(calibration_frame("Flat", Some("Ha"), 2.0, "2026-09-20"));
    master.stack_count = Some(30);
    scan_frames(
        &catalog,
        &results,
        vec![frame(&results_root, "NGC7000-HOO-Siril/output/master_flat_Ha.fit", master)],
    )
    .await;
    let (calibration, calibration_root) =
        location_at(&catalog, &fx, "Astro-T7/Calibration", LocationRole::Calibration).await;
    std::fs::create_dir_all(calibration_root.join("masters")).unwrap();
    let flat = || with_train(calibration_frame("FLAT", Some("Ha"), 2.0, "2026-09-18"));
    scan_frames(
        &catalog,
        &calibration,
        vec![
            frame(&calibration_root, "flats/Ha/Flat_Ha_001.fits", flat()),
            frame(&calibration_root, "flats/Ha/Flat_Ha_002.fits", flat()),
        ],
    )
    .await;
    Lib { fx, catalog, results, results_root, calibration, calibration_root }
}

const MASTER: &str = "NGC7000-HOO-Siril/output/master_flat_Ha.fit";

async fn asset_at(catalog: &Catalog, location: &Location, name: &str) -> Asset {
    let assets = catalog.location_assets(location.id).await.unwrap();
    assets.into_iter().find(|asset| asset.relative_path.display() == name).unwrap()
}

async fn master_source(lib: &Lib) -> AdoptionSource {
    let asset = asset_at(&lib.catalog, &lib.results, MASTER).await;
    AdoptionSource::Asset { asset_id: asset.id, expected: expected(&asset) }
}

fn into(location: &Location, relative: &str) -> AdoptionDestination {
    AdoptionDestination {
        location_id: location.id,
        relative_path: NativePath::from_path(Path::new(relative)),
    }
}

/// Fixture files other than the catalog's own database files.
fn sources(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
    tree(root)
        .into_iter()
        .filter(|(path, _)| !path.to_string_lossy().starts_with("catalog"))
        .collect()
}

async fn adoption_rows(lib: &Lib) -> BTreeMap<String, Vec<String>> {
    dump_tables(&lib.fx.db, &ADOPTION_TABLES).await
}

async fn candidates(lib: &Lib) -> Vec<CandidateRef> {
    let query = InputQuery { form: Some(InputForm::Candidate), ..InputQuery::default() };
    let rows = lib.catalog.calibration_inputs(&query, &TestRules::default()).await.unwrap();
    rows.into_iter().map(|row| row.input).collect()
}

#[tokio::test]
async fn review_hashes_the_source_checks_the_destination_and_writes_no_file() {
    let lib = library().await;
    let before = sources(lib.fx.temp.path());
    let source = asset_at(&lib.catalog, &lib.results, MASTER).await;
    let review = lib
        .catalog
        .review_adoption(
            &master_source(&lib).await,
            &into(&lib.calibration, "masters/master_flat_Ha.fit"),
            &TestRules::default(),
            DiskProbe,
        )
        .await
        .unwrap();

    assert_eq!((review.state, review.revision), (ReviewState::Open, 1));
    assert_eq!(review.source.asset_id, Some(source.id));
    assert_eq!(review.source.sha256, sha_of(&lib.results_root.join(MASTER)));
    assert_eq!(review.source.location_id, lib.results.id);
    assert_eq!(review.source.relative_path.display(), MASTER);
    assert_eq!(review.source.fingerprint.identity, source.fingerprint.identity);
    assert_eq!(review.classification.kind, InputKind::Flat);
    assert_eq!(review.classification.master.as_ref().unwrap().basis, MasterBasis::HeaderStackCount);
    assert_eq!(review.observed.stack_count, Some(30));
    let MasterOrigin::Location { location_id, relative_path, .. } = &review.origin else {
        panic!("an indexed source's origin is its location and path: {:?}", review.origin)
    };
    assert_eq!((*location_id, relative_path.display()), (lib.results.id, MASTER.to_owned()));
    assert_eq!(review.destination, into(&lib.calibration, "masters/master_flat_Ha.fit"));
    assert_eq!(sources(lib.fx.temp.path()), before, "review writes no file");
    assert_eq!(adoption_rows(&lib).await["adoption_reviews"].len(), 1);
    assert_eq!(adoption_rows(&lib).await["adoption_operations"].len(), 0);
}

#[tokio::test]
async fn review_refuses_each_unadoptable_request_and_writes_nothing() {
    let lib = library().await;
    let catalog = &lib.catalog;
    std::fs::write(lib.calibration_root.join("masters/taken.fit"), b"already here").unwrap();
    let raw = asset_at(catalog, &lib.calibration, "flats/Ha/Flat_Ha_001.fits").await;
    let captures = catalog.register_location(&lib.fx.registration()).await.unwrap();
    let (spare, spare_root) =
        location_at(catalog, &lib.fx, "Spare/Calibration", LocationRole::Calibration).await;
    std::fs::create_dir_all(spare_root.join("masters")).unwrap();
    let before = sources(lib.fx.temp.path());
    let rules = TestRules::default();
    let refuse = |source: AdoptionSource, destination: AdoptionDestination| {
        let rules = rules.clone();
        async move {
            catalog.review_adoption(&source, &destination, &rules, DiskProbe).await.unwrap_err()
        }
    };
    let master = master_source(&lib).await;

    let taken = refuse(master.clone(), into(&lib.calibration, "masters/taken.fit")).await;
    assert_eq!(kind(&taken), "identity_conflict", "{taken}");
    assert_eq!(
        taken.response(None, None).scope,
        Some(NativePath::from_path(&lib.calibration_root.join("masters/taken.fit"))),
        "the conflict is scoped to the destination path"
    );
    let missing = refuse(master.clone(), into(&lib.calibration, "absent/master.fit")).await;
    assert_eq!(kind(&missing), "not_found", "CAL creates no directories: {missing}");
    let wrong_role = refuse(master.clone(), into(&captures, "master.fit")).await;
    assert_eq!(kind(&wrong_role), "invalid_input", "{wrong_role}");
    let traversal = refuse(master.clone(), into(&lib.calibration, "../escape.fit")).await;
    assert_eq!(kind(&traversal), "invalid_input", "{traversal}");
    let not_master = refuse(
        AdoptionSource::Asset { asset_id: raw.id, expected: expected(&raw) },
        into(&lib.calibration, "masters/raw.fit"),
    )
    .await;
    assert_eq!(kind(&not_master), "invalid_input", "{not_master}");
    // Results discovery (070) records Result sources; an unknown one is not found.
    let unknown_result = refuse(
        AdoptionSource::Result { result_id: Uuid::new_v4() },
        into(&lib.calibration, "masters/result.fit"),
    )
    .await;
    assert_eq!(kind(&unknown_result), "not_found", "{unknown_result}");

    catalog
        .mark_location_unavailable(lib.calibration.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let offline = refuse(master.clone(), into(&lib.calibration, "masters/master.fit")).await;
    assert_eq!(kind(&offline), "source_unavailable", "{offline}");

    let assets = catalog.location_assets(lib.results.id).await.unwrap();
    let references = LocationReferences {
        references: Vec::new(),
        assets: assets.iter().map(|asset| asset.id).collect(),
        consulted: vec![ReferenceKind::View],
    };
    catalog
        .mark_location_unavailable(lib.results.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let retire = catalog.review_retire_location(lib.results.id, &references).await.unwrap();
    catalog
        .retire_location(retire.id, lib.results.id, retire.expected_revision, &references)
        .await
        .unwrap();
    let retired = asset_at(catalog, &lib.results, MASTER).await;
    let retired = refuse(
        AdoptionSource::Asset { asset_id: retired.id, expected: expected(&retired) },
        into(&spare, "masters/master.fit"),
    )
    .await;
    assert_eq!(kind(&retired), "invalid_input", "{retired}");

    assert!(adoption_rows(&lib).await.values().all(Vec::is_empty), "no review was recorded");
    assert_eq!(sources(lib.fx.temp.path()), before, "no file was written");
}

#[tokio::test]
async fn adoption_copies_verifies_and_registers_the_master_with_provenance() {
    let lib = library().await;
    let rules = TestRules::default();
    let source_path = lib.results_root.join(MASTER);
    let source_sha = sha_of(&source_path);
    let before = sources(lib.fx.temp.path());
    let destination = into(&lib.calibration, "masters/master_flat_Ha.fit");
    let review = lib
        .catalog
        .review_adoption(&master_source(&lib).await, &destination, &rules, DiskProbe)
        .await
        .unwrap();
    let operation = lib.catalog.adopt_master(review.id, review.revision, DiskProbe).await.unwrap();

    assert_eq!(
        (operation.state, operation.phase),
        (AdoptionState::Completed, AdoptionPhase::Registered)
    );
    assert!(operation.error.is_none(), "{:?}", operation.error);
    let installed = operation.installed.clone().expect("the installed identity is recorded");
    assert_eq!(installed.relative_path, destination.relative_path);
    let temporary = operation.temporary.clone().expect("the temporary file is recorded");
    assert!(!lib.calibration_root.join(temporary.relative_path.to_path_buf().unwrap()).exists());
    let master = operation.master.clone().expect("a completed operation carries its master");
    assert_eq!(operation.master_id, Some(master.id));
    let copy = lib.calibration_root.join("masters/master_flat_Ha.fit");
    assert_eq!(sha_of(&copy), source_sha, "the destination re-read equals the source digest");
    assert_eq!(master.fingerprint.content_sha256.as_deref(), Some(source_sha.as_str()));
    assert_eq!(master.fingerprint.identity, installed.identity);
    assert_eq!(master.fingerprint.size_bytes, std::fs::metadata(&copy).unwrap().len());
    assert_eq!((master.kind, master.revision), (InputKind::Flat, 1));
    assert_eq!(
        (master.location_id, &master.relative_path),
        (lib.calibration.id, &destination.relative_path)
    );
    assert_eq!(master.observed.stack_count, Some(30));
    assert_eq!(master.provenance.review_id, review.id);
    assert_eq!(master.provenance.source.sha256, source_sha);
    assert_eq!(master.provenance.source, review.source);
    assert_eq!(master.provenance.origin, review.origin);
    assert_eq!(master.classification, review.classification);

    let mut after = before.clone();
    let copied = before[&PathBuf::from("Work/Processing").join(MASTER)].clone();
    after.insert(PathBuf::from("Astro-T7/Calibration/masters/master_flat_Ha.fit"), copied);
    assert_eq!(sources(lib.fx.temp.path()), after, "only the adopted copy is new");

    let rows = lib.catalog.calibration_inputs(&InputQuery::default(), &rules).await.unwrap();
    let listed = rows.iter().find(|row| row.form == InputForm::Master).expect("the master lists");
    assert_eq!(listed.input, CandidateRef::Master { master_id: master.id, revision: 1 });
    assert!(listed.reusable);
    assert_eq!(listed.provenance.as_ref(), Some(&master.provenance));
    assert!(candidates(&lib).await.is_empty(), "the adopted source is no longer a candidate");

    let retry = lib.catalog.adopt_master(review.id, review.revision, DiskProbe).await.unwrap_err();
    assert_eq!(kind(&retry), "conflict", "the adopted review moved on: {retry}");

    let operations = lib.catalog.list_adoptions(None, 0, 0).await.unwrap();
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].master.as_ref(), Some(&master));
    let rows_before = adoption_rows(&lib).await;
    let Lib { fx, catalog, .. } = lib;
    catalog.close().await.unwrap();
    let reopened = Catalog::open(&fx.db).await.unwrap();
    assert_eq!(dump_tables(&fx.db, &ADOPTION_TABLES).await, rows_before, "restart keeps every row");
    let operations = reopened.list_adoptions(Some(AdoptionState::Completed), 0, 0).await.unwrap();
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].master.as_ref(), Some(&master), "the master returns unchanged");
    assert!(reopened
        .list_adoptions(Some(AdoptionState::Interrupted), 0, 0)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn a_source_changed_after_review_fails_before_install_and_removes_the_temporary_file() {
    let lib = library().await;
    let destination = into(&lib.calibration, "masters/master_flat_Ha.fit");
    let review = lib
        .catalog
        .review_adoption(&master_source(&lib).await, &destination, &TestRules::default(), DiskProbe)
        .await
        .unwrap();
    std::fs::write(lib.results_root.join(MASTER), b"re-stacked after review").unwrap();
    let before = sources(lib.fx.temp.path());

    let operation = lib.catalog.adopt_master(review.id, review.revision, DiskProbe).await.unwrap();
    assert_eq!(
        (operation.state, operation.phase),
        (AdoptionState::Failed, AdoptionPhase::TempCreated)
    );
    assert_eq!(
        operation.error.as_ref().unwrap().kind,
        "identity_conflict",
        "{:?}",
        operation.error
    );
    let temporary = operation.temporary.clone().expect("the temporary file was recorded");
    assert!(!lib.calibration_root.join(temporary.relative_path.to_path_buf().unwrap()).exists());
    assert!(operation.installed.is_none() && operation.master.is_none());
    assert!(!lib.calibration_root.join("masters/master_flat_Ha.fit").exists());
    assert_eq!(sources(lib.fx.temp.path()), before, "nothing new below any location");
    assert!(adoption_rows(&lib).await["adopted_masters"].is_empty(), "nothing is registered");
    let source = asset_at(&lib.catalog, &lib.results, MASTER).await;
    assert_eq!(candidates(&lib).await, vec![CandidateRef::Candidate { asset_id: source.id }]);
    let failed = lib.catalog.list_adoptions(Some(AdoptionState::Failed), 0, 0).await.unwrap();
    assert_eq!(failed.len(), 1);
}

/// CAL-AC-08: an unrelated file that appears at the reviewed destination is never
/// overwritten. Confirmation is refused naming that file, which stays
/// byte-identical; no copy is written, nothing is registered and the generated
/// source remains a candidate. A review of a free path then adopts (CAL-AC-07).
#[tokio::test]
async fn adoption_refuses_existing_destination_file() {
    let lib = library().await;
    let source = master_source(&lib).await;
    let rules = TestRules::default();
    let taken = into(&lib.calibration, "masters/master_flat_Ha.fit");
    let review = lib.catalog.review_adoption(&source, &taken, &rules, DiskProbe).await.unwrap();
    let occupant = lib.calibration_root.join("masters/master_flat_Ha.fit");
    std::fs::write(&occupant, b"someone else's master").unwrap();
    let before = sources(lib.fx.temp.path());

    let error = lib.catalog.adopt_master(review.id, review.revision, DiskProbe).await.unwrap_err();
    assert_eq!(kind(&error), "identity_conflict", "{error}");
    assert_eq!(
        error.response(None, None).scope,
        Some(NativePath::from_path(&occupant)),
        "the existing file is named"
    );
    assert_eq!(std::fs::read(&occupant).unwrap(), b"someone else's master");
    assert_eq!(sources(lib.fx.temp.path()), before, "no copy or temporary file is written");
    assert!(adoption_rows(&lib).await["adopted_masters"].is_empty(), "nothing is registered");
    let generated = asset_at(&lib.catalog, &lib.results, MASTER).await;
    assert_eq!(
        candidates(&lib).await,
        vec![CandidateRef::Candidate { asset_id: generated.id }],
        "the generated source remains a candidate"
    );
    let again = lib.catalog.adopt_master(review.id, review.revision, DiskProbe).await.unwrap_err();
    assert_eq!(kind(&again), "identity_conflict", "the path stays refused: {again}");

    let free = into(&lib.calibration, "masters/master_flat_Ha_2.fit");
    let review = lib.catalog.review_adoption(&source, &free, &rules, DiskProbe).await.unwrap();
    let operation = lib.catalog.adopt_master(review.id, review.revision, DiskProbe).await.unwrap();
    assert_eq!(
        (operation.state, operation.phase),
        (AdoptionState::Completed, AdoptionPhase::Registered),
        "{:?}",
        operation.error
    );
    let master = operation.master.expect("the free path registers the master");
    assert_eq!(master.relative_path, free.relative_path);
    assert_eq!(
        sha_of(&lib.calibration_root.join("masters/master_flat_Ha_2.fit")),
        sha_of(&lib.results_root.join(MASTER)),
        "the verified copy holds the reviewed bytes"
    );
    assert_eq!(std::fs::read(&occupant).unwrap(), b"someone else's master");
}
