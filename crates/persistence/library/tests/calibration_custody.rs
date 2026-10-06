// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration custody facts and references (spec 068, R19): the STO seam that
//! names candidate masters, adopted masters and retained adoption sources with
//! their no-follow fingerprints, and the Retire location references of
//! effective decisions and adopted masters. Both are reads that touch no file.
#![cfg(unix)]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use persistence_library::{Catalog, InputQuery, LocationReferences, SessionQuery};
use platevault_model::{
    AdoptedMaster, AdoptionDestination, AdoptionSource, Asset, AssetReference, Availability,
    CalibrationViewPlan, CriteriaInput, CustodyFact, CustodyKind, DecisionItem, InputKind,
    KeptCopy, Location, LocationRole, NativePath, NewView, ReferenceKind, RequirementState,
    Session, ViewOriginInput,
};
use support::*;
use uuid::Uuid;

const MASTER_DARK: &str = "masters/MasterDark_300s.xisf";
const SOURCE: &str = "NGC7000-HOO-Siril/output/master_flat_Ha.fit";
const DESTINATION: &str = "masters/master_flat_Ha.fit";
const VIEW_NAME: &str = "NGC7000 HOO - Siril";

struct Lib {
    fx: Fixture,
    catalog: Catalog,
    calibration: Location,
    calibration_root: PathBuf,
    results: Location,
    ha: Session,
    view: Uuid,
}

fn dark() -> platevault_model::CaptureMetadata {
    calibration_frame("DARK", None, 300.0, "2026-09-18")
}

fn master_dark() -> platevault_model::CaptureMetadata {
    let mut metadata = calibration_frame("Master Dark", None, 300.0, "2026-09-20");
    metadata.stack_count = None;
    metadata
}

fn master_flat() -> platevault_model::CaptureMetadata {
    let mut metadata = with_train(calibration_frame("Flat", Some("Ha"), 2.0, "2026-09-20"));
    metadata.stack_count = Some(30);
    metadata
}

/// 18 Sep Ha lights in a saved View, 300 s darks and a `PixInsight` master dark
/// in the Calibration location, and a Siril master flat (STACKCNT 30) in
/// `Work/Processing`.
async fn library() -> Lib {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let captures = catalog.register_location(&fx.registration()).await.unwrap();
    let light = || with_train(calibration_frame("LIGHT", Some("Ha"), 300.0, "2026-09-18"));
    scan_frames(
        &catalog,
        &captures,
        vec![
            frame(&fx.root, "lights/Ha_18_001.fits", light()),
            frame(&fx.root, "lights/Ha_18_002.fits", light()),
        ],
    )
    .await;
    let (calibration, calibration_root) =
        location_at(&catalog, &fx, "Astro-T7/Calibration", LocationRole::Calibration).await;
    scan_frames(&catalog, &calibration, calibration_files(&calibration_root, false)).await;
    let (results, results_root) =
        location_at(&catalog, &fx, "Work/Processing", LocationRole::Results).await;
    scan_frames(&catalog, &results, vec![frame(&results_root, SOURCE, master_flat())]).await;

    let lights = catalog.location_assets(captures.id).await.unwrap();
    let ha = session_of(&catalog, by_name(&lights, "Ha_18_001.fits").id).await;
    let view = saved_view(&catalog, VIEW_NAME, &[&ha]).await;
    Lib { fx, catalog, calibration, calibration_root, results, ha, view }
}

/// The Calibration location's files; with `adopted`, the adopted copy too.
fn calibration_files(root: &Path, adopted: bool) -> Vec<platevault_model::ScanFile> {
    let mut files = vec![
        frame(root, "darks/Dark_300s_001.fits", dark()),
        frame(root, "darks/Dark_300s_002.fits", dark()),
        frame(root, MASTER_DARK, master_dark()),
    ];
    if adopted {
        files.push(frame(root, DESTINATION, master_flat()));
    }
    files
}

async fn session_of(catalog: &Catalog, asset: Uuid) -> Session {
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    sessions.into_iter().find(|s| s.session.asset_ids.contains(&asset)).unwrap().session
}

async fn saved_view(catalog: &Catalog, name: &str, sessions: &[&Session]) -> Uuid {
    let record = catalog
        .create_view(&NewView {
            origin: ViewOriginInput::Sessions {
                sessions: sessions.iter().map(|session| expected_session(session)).collect(),
            },
            name: Some(name.into()),
            criteria: CriteriaInput::default(),
            framing_revision: None,
            suggestions: Vec::new(),
        })
        .await
        .unwrap();
    catalog.save_view(record.view.id, 0, 1).await.unwrap();
    record.view.id
}

fn rules() -> TestRules {
    TestRules::default()
}

async fn asset_at(catalog: &Catalog, location: &Location, name: &str) -> Asset {
    let assets = catalog.location_assets(location.id).await.unwrap();
    assets.into_iter().find(|asset| asset.relative_path.display() == name).unwrap()
}

/// Adopt the Siril master flat into `masters/` of the Calibration location.
async fn adopt(lib: &Lib) -> AdoptedMaster {
    let source = asset_at(&lib.catalog, &lib.results, SOURCE).await;
    let review = lib
        .catalog
        .review_adoption(
            &AdoptionSource::Asset { asset_id: source.id, expected: expected(&source) },
            &AdoptionDestination {
                location_id: lib.calibration.id,
                relative_path: NativePath::from_path(Path::new(DESTINATION)),
            },
            &rules(),
            DiskProbe,
        )
        .await
        .unwrap();
    let operation =
        Box::pin(lib.catalog.adopt_master(review.id, review.revision, DiskProbe)).await.unwrap();
    operation.master.expect("the adoption completed")
}

/// Rescan the Calibration location with the adopted copy and bind its digest,
/// so the master links to its indexed destination asset.
async fn index_destination(lib: &Lib) -> Asset {
    scan_frames(&lib.catalog, &lib.calibration, calibration_files(&lib.calibration_root, true))
        .await;
    let destination = asset_at(&lib.catalog, &lib.calibration, DESTINATION).await;
    lib.catalog.verify_digest(destination.id, DiskProbe).await.unwrap();
    destination
}

fn candidate_fact(asset: &Asset) -> CustodyFact {
    CustodyFact {
        kind: CustodyKind::CandidateMaster,
        asset_id: Some(asset.id),
        master_id: None,
        result_id: None,
        location_id: asset.location_id,
        relative_path: asset.relative_path.clone(),
        fingerprint: asset.fingerprint.clone(),
        kept_copy: None,
    }
}

fn master_fact(master: &AdoptedMaster) -> CustodyFact {
    CustodyFact {
        kind: CustodyKind::AdoptedMaster,
        asset_id: master.asset_id,
        master_id: Some(master.id),
        result_id: None,
        location_id: master.location_id,
        relative_path: master.relative_path.clone(),
        fingerprint: master.fingerprint.clone(),
        kept_copy: None,
    }
}

fn source_fact(source: &Asset, master: &AdoptedMaster) -> CustodyFact {
    CustodyFact {
        kind: CustodyKind::GeneratedSource,
        asset_id: Some(source.id),
        master_id: None,
        result_id: None,
        location_id: source.location_id,
        relative_path: source.relative_path.clone(),
        fingerprint: source.fingerprint.clone(),
        kept_copy: Some(KeptCopy {
            master_id: master.id,
            location_id: master.location_id,
            relative_path: master.relative_path.clone(),
            fingerprint: master.fingerprint.clone(),
        }),
    }
}

/// Facts keyed by kind and file, so the comparison does not pin their order.
fn keyed(facts: Vec<CustodyFact>) -> BTreeMap<(String, String), CustodyFact> {
    let mut keyed = BTreeMap::new();
    for fact in facts {
        let key = (format!("{:?}", fact.kind), fact.relative_path.display());
        assert!(keyed.insert(key, fact).is_none(), "each file is one fact of its kind");
    }
    keyed
}

async fn facts(lib: &Lib) -> BTreeMap<(String, String), CustodyFact> {
    keyed(lib.catalog.calibration_custody_facts(lib.view, &rules()).await.unwrap())
}

/// Fixture files other than the catalog's own database files.
fn sources(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
    tree(root)
        .into_iter()
        .filter(|(path, _)| !path.to_string_lossy().starts_with("catalog"))
        .collect()
}

/// The preselected suggestion of every suggested requirement of `kind`.
fn suggestions(plan: &CalibrationViewPlan, kind: InputKind) -> Vec<DecisionItem> {
    plan.requirements
        .iter()
        .filter(|r| r.state == RequirementState::Suggested && r.kind == kind)
        .map(|r| DecisionItem {
            light_session_id: r.light_session_id,
            kind: r.kind,
            input: r.preselected.unwrap().input().unwrap(),
        })
        .collect()
}

fn ids<'a>(assets: impl IntoIterator<Item = &'a Asset>) -> BTreeSet<Uuid> {
    assets.into_iter().map(|asset| asset.id).collect()
}

#[tokio::test]
async fn custody_facts_name_candidates_adopted_masters_and_retained_sources() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let unknown =
        catalog.calibration_custody_facts(Uuid::from_u128(0x404), &rules()).await.unwrap_err();
    assert_eq!(kind(&unknown), "not_found", "{unknown}");

    let detected = asset_at(catalog, &lib.calibration, MASTER_DARK).await;
    let source = asset_at(catalog, &lib.results, SOURCE).await;
    assert_eq!(
        facts(&lib).await,
        keyed(vec![candidate_fact(&detected), candidate_fact(&source)]),
        "before adoption both detected masters are candidates; raw darks are not custody facts"
    );

    let master = adopt(&lib).await;
    assert_eq!(master.asset_id, None, "no scan indexed the copy yet");
    assert_eq!(
        facts(&lib).await,
        keyed(
            vec![candidate_fact(&detected), master_fact(&master), source_fact(&source, &master),]
        ),
        "the adopted source is retained with its kept copy, no longer a candidate"
    );

    let destination = index_destination(&lib).await;
    let rows = catalog.calibration_inputs(&InputQuery::default(), &rules()).await.unwrap();
    let indexed = rows
        .iter()
        .find(|row| row.member_assets.contains(&destination.id))
        .expect("the indexed copy lists as the master");
    assert_eq!(indexed.form, platevault_model::InputForm::Master);
    let before = sources(lib.fx.temp.path());
    let read = facts(&lib).await;
    let adopted = read
        .values()
        .find(|fact| fact.kind == CustodyKind::AdoptedMaster)
        .expect("the master stays a fact");
    assert_eq!(adopted.asset_id, Some(destination.id), "the indexed destination is named");
    assert_eq!(
        read.values().filter(|fact| fact.kind == CustodyKind::CandidateMaster).count(),
        1,
        "the indexed destination is not a new candidate"
    );
    assert_eq!(sources(lib.fx.temp.path()), before, "reading custody facts touches no file");

    // A source whose location is Retired is no longer retained there.
    let held = catalog.location_assets(lib.results.id).await.unwrap();
    let references = LocationReferences {
        references: catalog.calibration_references(&ids(&held)).await.unwrap(),
        assets: ids(&held),
        consulted: vec![ReferenceKind::Calibration],
    };
    catalog
        .mark_location_unavailable(lib.results.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let review = catalog.review_retire_location(lib.results.id, &references).await.unwrap();
    catalog
        .retire_location(review.id, lib.results.id, review.expected_revision, &references)
        .await
        .unwrap();
    let after = facts(&lib).await;
    assert!(
        after.values().all(|fact| fact.kind != CustodyKind::GeneratedSource),
        "a Retired source is not retained: {after:#?}"
    );
    assert!(after.values().any(|fact| fact.kind == CustodyKind::AdoptedMaster));
}

#[tokio::test]
async fn references_name_effective_decisions_and_masters_with_their_revisions() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let lights: BTreeSet<Uuid> = lib.ha.asset_ids.iter().copied().collect();
    assert!(catalog.calibration_references(&BTreeSet::new()).await.unwrap().is_empty());
    assert!(
        catalog.calibration_references(&lights).await.unwrap().is_empty(),
        "a View without decisions holds nothing for calibration"
    );

    let plan = catalog.calibration_view_plan(lib.view, 1, &rules()).await.unwrap();
    let darks = suggestions(&plan, InputKind::Dark);
    assert_eq!(darks.len(), 1, "{plan:#?}");
    let accepted =
        catalog.accept_calibration(lib.view, 1, 0, &darks, &rules(), DiskProbe).await.unwrap();
    let dark_assets = catalog.location_assets(lib.calibration.id).await.unwrap();
    let raw_darks: Vec<&Asset> = dark_assets
        .iter()
        .filter(|asset| asset.relative_path.display().starts_with("darks/"))
        .collect();
    let view_reference = |asset_ids: Vec<Uuid>, revision| AssetReference {
        kind: ReferenceKind::Calibration,
        id: lib.view,
        name: VIEW_NAME.into(),
        revision,
        asset_ids,
    };
    let before = sources(lib.fx.temp.path());
    assert_eq!(
        catalog.calibration_references(&lights).await.unwrap(),
        [view_reference(lights.iter().copied().collect(), accepted.plan_revision)],
        "the light members of an effective decision, at the plan revision"
    );
    let mut asked = ids(raw_darks.iter().copied());
    asked.insert(Uuid::from_u128(0x404));
    assert_eq!(
        catalog.calibration_references(&asked).await.unwrap(),
        [view_reference(ids(raw_darks.iter().copied()).into_iter().collect(), 1)],
        "the hashed inputs of an effective decision; unrelated ids are not named"
    );
    assert_eq!(sources(lib.fx.temp.path()), before, "reading references touches no file");

    let withdrawn = catalog
        .withdraw_calibration(lib.view, 1, 1, &[(lib.ha.id, InputKind::Dark)], &rules())
        .await
        .unwrap();
    assert_eq!(withdrawn.plan_revision, 2);
    assert!(
        catalog.calibration_references(&lights).await.unwrap().is_empty(),
        "a withdrawn decision names nothing"
    );
    let reaccepted =
        catalog.accept_calibration(lib.view, 1, 2, &darks, &rules(), DiskProbe).await.unwrap();
    assert_eq!(reaccepted.plan_revision, 3);
    assert_eq!(
        catalog.calibration_references(&lights).await.unwrap(),
        [view_reference(lights.iter().copied().collect(), 3)],
        "a later decision is named at the new plan revision"
    );

    let master = adopt(&lib).await;
    let source = asset_at(catalog, &lib.results, SOURCE).await;
    let master_reference = |asset_id: Uuid| AssetReference {
        kind: ReferenceKind::Calibration,
        id: master.id,
        name: format!("flat master {DESTINATION}"),
        revision: master.revision,
        asset_ids: vec![asset_id],
    };
    assert_eq!(
        catalog.calibration_references(&BTreeSet::from([source.id])).await.unwrap(),
        [master_reference(source.id)],
        "an adopted master holds its source, at the master revision"
    );
    let destination = index_destination(&lib).await;
    let before = sources(lib.fx.temp.path());
    assert_eq!(
        catalog.calibration_references(&BTreeSet::from([destination.id])).await.unwrap(),
        [master_reference(destination.id)],
        "an adopted master holds its indexed destination"
    );
    let detected = asset_at(catalog, &lib.calibration, MASTER_DARK).await;
    assert!(
        catalog.calibration_references(&BTreeSet::from([detected.id])).await.unwrap().is_empty(),
        "an unadopted candidate is no calibration record"
    );
    assert_eq!(sources(lib.fx.temp.path()), before, "reading references touches no file");
}
