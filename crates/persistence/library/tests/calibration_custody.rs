// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration custody facts and references (spec 068, R19): the STO seam that
//! names candidate masters, adopted masters and retained adoption sources with
//! their no-follow fingerprints, and the Retire location references of adopted
//! masters and of the sessions whose calibration pins a file. Both are reads
//! that touch no file.
#![cfg(unix)]

#[path = "support/calibration.rs"]
mod calibration_support;
mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use calibration_support::*;
use persistence_library::{Catalog, InputQuery, LocationReferences};
use platevault_model::{
    AdoptedMaster, AdoptionDestination, AdoptionSource, Asset, AssetReference, Availability,
    CustodyFact, CustodyKind, InputKind, InputRef, Location, LocationRole, MasterKeptCopy,
    NativePath, ProjectInput, ReferenceKind,
};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

const MASTER_DARK: &str = "masters/MasterDark_300s.xisf";
const SOURCE: &str = "NGC7000-HOO-Siril/output/master_flat_Ha.fit";
const DESTINATION: &str = "masters/master_flat_Ha.fit";

struct Lib {
    fx: Fixture,
    catalog: Catalog,
    calibration: Location,
    calibration_root: PathBuf,
    results: Location,
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

/// 300 s darks and a `PixInsight` master dark in the Calibration location, and
/// a Siril master flat (STACKCNT 30) in `Work/Processing`.
async fn library() -> Lib {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let (calibration, calibration_root) =
        location_at(&catalog, &fx, "Astro-T7/Calibration", LocationRole::Calibration).await;
    scan_frames(&catalog, &calibration, calibration_files(&calibration_root, false)).await;
    let (results, results_root) =
        location_at(&catalog, &fx, "Work/Processing", LocationRole::Results).await;
    scan_frames(&catalog, &results, vec![frame(&results_root, SOURCE, master_flat())]).await;
    Lib { fx, catalog, calibration, calibration_root, results }
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

fn rules() -> TestRules {
    TestRules
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
        location_id: source.location_id,
        relative_path: source.relative_path.clone(),
        fingerprint: source.fingerprint.clone(),
        kept_copy: Some(MasterKeptCopy {
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
    keyed(lib.catalog.calibration_custody_facts(&rules()).await.unwrap())
}

/// Fixture files other than the catalog's own database files.
fn sources(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
    tree(root)
        .into_iter()
        .filter(|(path, _)| !path.to_string_lossy().starts_with("catalog"))
        .collect()
}

fn ids<'a>(assets: impl IntoIterator<Item = &'a Asset>) -> BTreeSet<Uuid> {
    assets.into_iter().map(|asset| asset.id).collect()
}

#[tokio::test]
async fn custody_facts_name_candidates_adopted_masters_and_retained_sources() {
    let lib = library().await;
    let catalog = &lib.catalog;
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
async fn references_name_adopted_masters_with_their_revisions() {
    let lib = library().await;
    let catalog = &lib.catalog;
    assert_eq!(
        catalog.calibration_references(&BTreeSet::new()).await.unwrap(),
        [] as [platevault_model::AssetReference; 0]
    );
    let source = asset_at(catalog, &lib.results, SOURCE).await;
    let held = catalog.location_assets(lib.calibration.id).await.unwrap();
    let mut asked = ids(&held);
    asked.insert(source.id);
    assert!(
        catalog.calibration_references(&asked).await.unwrap().is_empty(),
        "before adoption no calibration record holds a raw frame or a candidate"
    );

    let master = adopt(&lib).await;
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

/// A light session of 300 s Ha frames on the `RedCat 51` train in a Captures
/// location: the darks and the Siril master flat both fit it.
async fn light_session(lib: &Lib) -> Uuid {
    let (captures, root) =
        location_at(&lib.catalog, &lib.fx, "Astro-T7/Captures", LocationRole::Captures).await;
    let light = with_train(calibration_frame("LIGHT", Some("Ha"), 300.0, "2026-09-18"));
    scan_frames(&lib.catalog, &captures, vec![frame(&root, "lights/Ha_001.fits", light)]).await;
    let asset = asset_at(&lib.catalog, &captures, "lights/Ha_001.fits").await;
    let query = persistence_library::SessionQuery::default();
    let sessions = lib.catalog.list_sessions(&query).await.unwrap();
    sessions.into_iter().find(|s| s.session.asset_ids.contains(&asset.id)).unwrap().session.id
}

/// The calibration input listing `asset` among its members.
async fn input_holding(lib: &Lib, asset: Uuid) -> InputRef {
    let rows = lib.catalog.calibration_inputs(&InputQuery::default(), &rules()).await.unwrap();
    let row = rows.iter().find(|row| row.member_assets.contains(&asset)).unwrap();
    row.input.input().expect("a raw set or an adopted master")
}

/// Pin `kind` of `session` to `input` at its current calibration generation.
async fn pin(lib: &Lib, session: Uuid, kind: InputKind, input: InputRef) -> u64 {
    let catalog = &lib.catalog;
    let generation = catalog.session_calibration(session).await.unwrap().calibration.generation;
    let rules = rules();
    let pinned = catalog.reassign_calibration(session, kind, input, generation, &rules, DiskProbe);
    pinned.await.unwrap().generation
}

/// Record §6 (Hide and Move to Trash of a master list the sessions that use
/// it), R19: a session's pins hold the files they bind, a raw set's frames and
/// a pinned master's file, so Retire location names the session at its
/// calibration generation, and a pin change since the review makes it stale.
/// Only pins hold files; reading them touches no file.
#[tokio::test]
async fn references_name_sessions_whose_pins_bind_the_files() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let master = adopt(&lib).await;
    let destination = index_destination(&lib).await;
    let light = light_session(&lib).await;
    let darks = [
        asset_at(catalog, &lib.calibration, "darks/Dark_300s_001.fits").await.id,
        asset_at(catalog, &lib.calibration, "darks/Dark_300s_002.fits").await.id,
    ];
    let asked = ids(&catalog.location_assets(lib.calibration.id).await.unwrap());
    let master_reference = AssetReference {
        kind: ReferenceKind::Calibration,
        id: master.id,
        name: format!("flat master {DESTINATION}"),
        revision: master.revision,
        asset_ids: vec![destination.id],
    };
    assert_eq!(
        catalog.calibration_references(&asked).await.unwrap(),
        std::slice::from_ref(&master_reference),
        "no session pins anything yet"
    );

    let raw_set = input_holding(&lib, darks[0]).await;
    pin(&lib, light, InputKind::Dark, raw_set).await;
    let flat = input_holding(&lib, destination.id).await;
    assert_eq!(flat, InputRef::Master { master_id: master.id, revision: master.revision });
    let generation = pin(&lib, light, InputKind::Flat, flat).await;
    let before = sources(lib.fx.temp.path());
    let mut held = BTreeSet::from(darks);
    held.insert(destination.id);
    let pins = AssetReference {
        kind: ReferenceKind::Calibration,
        id: light,
        name: format!("dark, flat pinned on session {light}"),
        revision: generation,
        asset_ids: held.into_iter().collect(),
    };
    assert_eq!(
        catalog.calibration_references(&asked).await.unwrap(),
        [master_reference.clone(), pins.clone()],
        "the session holds the raw darks and the master's file it pins"
    );
    assert_eq!(
        catalog.calibration_references(&BTreeSet::from([darks[1]])).await.unwrap(),
        [AssetReference {
            name: format!("dark pinned on session {light}"),
            asset_ids: vec![darks[1]],
            ..pins.clone()
        }],
        "only the asked files count"
    );
    assert_eq!(sources(lib.fx.temp.path()), before, "reading references touches no file");

    let references = LocationReferences {
        references: catalog.calibration_references(&asked).await.unwrap(),
        assets: asked.clone(),
        consulted: vec![ReferenceKind::Calibration],
    };
    catalog
        .mark_location_unavailable(lib.calibration.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let review = catalog.review_retire_location(lib.calibration.id, &references).await.unwrap();
    assert!(review.references.contains(&pins), "the review names the session: {review:#?}");

    assert_eq!(catalog.release_calibration_input(&raw_set).await.unwrap(), [light]);
    let released = LocationReferences {
        references: catalog.calibration_references(&asked).await.unwrap(),
        ..references.clone()
    };
    let session = released.references.iter().find(|reference| reference.id == light).unwrap();
    assert_eq!(
        (session.name.clone(), session.asset_ids.clone()),
        (format!("flat pinned on session {light}"), vec![destination.id]),
        "a released raw set is held no more"
    );
    let stale = catalog
        .retire_location(review.id, lib.calibration.id, review.expected_revision, &released)
        .await
        .unwrap_err();
    assert_eq!(kind(&stale), "conflict", "the pins changed since the review: {stale}");
}
#[tokio::test]
async fn retire_review_blocks_pinned_calibration_and_names_projects_holding_sessions() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let light = light_session(&lib).await;
    let dark = asset_at(catalog, &lib.calibration, "darks/Dark_300s_001.fits").await.id;
    let generation = catalog.session_calibration(light).await.unwrap().calibration.generation;
    catalog
        .reassign_calibration(
            light,
            InputKind::Dark,
            input_holding(&lib, dark).await,
            generation,
            &rules(),
            DiskProbe,
        )
        .await
        .unwrap();
    let asked = ids(&catalog.location_assets(lib.calibration.id).await.unwrap());
    let references = LocationReferences {
        references: catalog.calibration_references(&asked).await.unwrap(),
        assets: asked,
        consulted: vec![ReferenceKind::Calibration],
    };
    catalog
        .mark_location_unavailable(lib.calibration.id, Availability::Offline, "unplugged")
        .await
        .unwrap();
    let review = catalog.review_retire_location(lib.calibration.id, &references).await.unwrap();
    assert_eq!(review.blocked.len(), 1, "one current blocker per pinned session");
    assert!(matches!(
        &review.blocked[0],
        platevault_model::RetireBlock::PinnedCalibration { session_id, capture_key, kinds, .. }
            if *session_id == light && capture_key.starts_with("capture-v1|") && kinds == &[InputKind::Dark]
    ));
    assert!(review.projects.is_empty(), "no Project holds this session yet");
    let refusal = catalog
        .retire_location(review.id, lib.calibration.id, review.expected_revision, &references)
        .await
        .unwrap_err();
    assert!(refusal.to_string().contains("pinned"), "{refusal}");
    assert_eq!(
        catalog.location(lib.calibration.id).await.unwrap().lifecycle,
        platevault_model::LocationLifecycle::Active,
        "a blocked retirement changes nothing"
    );
}

fn test_rig() -> platevault_model::Equipment {
    platevault_model::Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: None,
        sensor_height_px: None,
        color_kind: None,
        decision_revision: 0,
        state: platevault_model::AssociationState::Confirmed,
        provenance: platevault_model::Provenance::User,
    }
}
#[tokio::test]
async fn retire_review_projects_include_open_closed_and_archived_pin_holders() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let light = light_session(&lib).await;
    let dark = asset_at(catalog, &lib.calibration, "darks/Dark_300s_001.fits").await.id;
    let generation = catalog.session_calibration(light).await.unwrap().calibration.generation;
    catalog
        .reassign_calibration(
            light,
            InputKind::Dark,
            input_holding(&lib, dark).await,
            generation,
            &rules(),
            DiskProbe,
        )
        .await
        .unwrap();
    let target = catalog.save_target(&support::target("NGC 7000", "ngc 7000"), None).await.unwrap();
    let rig = catalog.save_equipment(&test_rig(), None).await.unwrap();
    let light_assets = catalog.session(light).await.unwrap().assets;
    let marks: Vec<_> = light_assets.iter().map(support::expected).collect();
    catalog.set_quality(&marks, platevault_model::Quality::Usable, DiskProbe).await.unwrap();
    let current = catalog.session(light).await.unwrap().summary.session;
    catalog
        .associate_target(&[support::expected_session(&current)], target.candidate.id)
        .await
        .unwrap();
    let current = catalog.session(light).await.unwrap().summary.session;
    catalog.confirm_equipment(&[support::expected_session(&current)], rig.id).await.unwrap();
    for kind in [InputKind::Bias, InputKind::Flat] {
        let current = catalog.session_calibration(light).await.unwrap().calibration.generation;
        catalog.decline_calibration(&[(light, current)], kind).await.unwrap();
    }
    let current = catalog.session(light).await.unwrap().summary.session;
    catalog.finish_session_review(light, current.grouping_revision).await.unwrap();

    let mut conn = raw(&lib.fx.db).await;
    let mut expected_projects = Vec::new();
    for lifecycle in ["open", "closed", "archived"] {
        let project = catalog
            .create_project(&ProjectInput {
                name: format!("{lifecycle} pin holder"),
                notes: None,
                subjects: vec![platevault_model::SubjectInput {
                    target_id: target.candidate.id,
                    name: None,
                }],
                rig_ids: vec![rig.id],
                goals: Vec::new(),
            })
            .await
            .unwrap();
        let desired = catalog
            .create_project_group(
                project.id,
                project.revision,
                &persistence_library::NewGroup {
                    id: Uuid::new_v4(),
                    rig_id: rig.id,
                    name: platevault_model::GroupName::new("RedCat").unwrap(),
                    origin: platevault_model::GroupOrigin::User,
                    optics: platevault_model::OpticsSignature::new(None, None, None).unwrap(),
                    framing: None,
                },
                &[],
            )
            .await
            .unwrap();
        sqlx::query("INSERT INTO project_sessions (project_id, session_id, group_id, placement, target_id, grouping_revision, calibration_generation, added_at) VALUES (?1, ?2, ?3, 'user', ?4, (SELECT grouping_revision FROM sessions WHERE id = ?2), (SELECT generation FROM session_calibration WHERE session_id = ?2), '2026-10-20')")
            .bind(project.id.to_string()).bind(light.to_string()).bind(desired.groups[0].id.to_string())
            .bind(target.candidate.id.to_string()).execute(&mut conn).await.unwrap();
        if lifecycle != "open" {
            let snapshot = serde_json::json!({"projectId":project.id,"takenAt":"2026-10-20","appliedGeneration":null,"basis":{},"goals":[]});
            sqlx::query("INSERT INTO project_snapshots (project_id, applied_generation, snapshot, taken_at) VALUES (?1, NULL, ?2, '2026-10-20')")
                .bind(project.id.to_string()).bind(snapshot.to_string()).execute(&mut conn).await.unwrap();
            for (step, outcome) in [
                ("clean_up", "skipped"),
                ("trash", "skipped"),
                ("archive", if lifecycle == "archived" { "finished" } else { "skipped" }),
            ] {
                sqlx::query("INSERT INTO project_wrap_up_steps (project_id, step, outcome, recorded_at) VALUES (?1, ?2, ?3, '2026-10-20')")
                    .bind(project.id.to_string()).bind(step).bind(outcome).execute(&mut conn).await.unwrap();
            }
            let state = if lifecycle == "archived" { "closing" } else { "closed" };
            sqlx::query(
                "UPDATE projects SET lifecycle = ?2, closed_at = '2026-10-20' WHERE id = ?1",
            )
            .bind(project.id.to_string())
            .bind(state)
            .execute(&mut conn)
            .await
            .unwrap();
            if lifecycle == "archived" {
                sqlx::query("UPDATE projects SET lifecycle = 'archived' WHERE id = ?1")
                    .bind(project.id.to_string())
                    .execute(&mut conn)
                    .await
                    .unwrap();
            }
        }
        expected_projects.push((project.id, lifecycle));
    }
    conn.close().await.unwrap();
    let asked = ids(&catalog.location_assets(lib.calibration.id).await.unwrap());
    let references = LocationReferences {
        references: catalog.calibration_references(&asked).await.unwrap(),
        assets: asked,
        consulted: vec![ReferenceKind::Calibration],
    };
    let review = catalog.review_retire_location(lib.calibration.id, &references).await.unwrap();
    assert_eq!(review.projects.len(), 3);
    for (id, lifecycle) in &expected_projects {
        assert!(
            review
                .projects
                .iter()
                .any(|project| project.project_id == *id
                    && project.lifecycle.to_string() == *lifecycle),
            "missing {lifecycle}: {:?}",
            review.projects
        );
    }
    let [platevault_model::RetireBlock::PinnedCalibration { session_id, capture_key, projects, .. }] =
        review.blocked.as_slice()
    else {
        panic!("{:#?}", review.blocked)
    };
    assert_eq!(*session_id, light);
    assert!(capture_key.starts_with("capture-v1|"));
    assert_eq!(projects.len(), 3);
    for (id, lifecycle) in &expected_projects {
        assert!(projects.iter().any(
            |project| project.project_id == *id && project.lifecycle.to_string() == *lifecycle
        ));
    }
}

#[tokio::test]
async fn confirm_rechecks_a_pin_added_after_review_and_no_pin_location_retires() {
    let lib = library().await;
    let catalog = &lib.catalog;
    let dark = asset_at(catalog, &lib.calibration, "darks/Dark_300s_001.fits").await.id;
    let asked = ids(&catalog.location_assets(lib.calibration.id).await.unwrap());
    let references = LocationReferences {
        references: catalog.calibration_references(&asked).await.unwrap(),
        assets: asked.clone(),
        consulted: vec![ReferenceKind::Calibration],
    };
    let review = catalog.review_retire_location(lib.calibration.id, &references).await.unwrap();
    assert!(review.blocked.is_empty());
    let light = light_session(&lib).await;
    let generation = catalog.session_calibration(light).await.unwrap().calibration.generation;
    catalog
        .reassign_calibration(
            light,
            InputKind::Dark,
            input_holding(&lib, dark).await,
            generation,
            &rules(),
            DiskProbe,
        )
        .await
        .unwrap();
    let current_references = LocationReferences {
        references: catalog.calibration_references(&asked).await.unwrap(),
        ..references.clone()
    };
    let blocked = catalog
        .retire_location(
            review.id,
            lib.calibration.id,
            review.expected_revision,
            &current_references,
        )
        .await
        .unwrap_err();
    assert_eq!(kind(&blocked), "conflict");
    assert_eq!(
        catalog.location(lib.calibration.id).await.unwrap().lifecycle,
        platevault_model::LocationLifecycle::Active
    );

    let (other, other_root) =
        location_at(catalog, &lib.fx, "Empty calibration", LocationRole::Calibration).await;
    let no_assets = ids(&catalog.location_assets(other.id).await.unwrap());
    assert!(std::fs::read_dir(other_root).unwrap().next().is_none(), "empty location has no files");
    let no_references = LocationReferences {
        assets: no_assets,
        references: Vec::new(),
        consulted: vec![ReferenceKind::Calibration],
    };
    let fresh = catalog.review_retire_location(other.id, &no_references).await.unwrap();
    assert!(fresh.blocked.is_empty());
    assert_eq!(
        catalog
            .retire_location(fresh.id, other.id, fresh.expected_revision, &no_references)
            .await
            .unwrap()
            .lifecycle,
        platevault_model::LocationLifecycle::Retired
    );
}
