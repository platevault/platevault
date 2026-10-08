// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixtures for the Home tests (spec 065 PRJ-FR-17..19): indexed light
//! sessions in every new-sessions group with two Projects, and helpers over
//! the PREP world (`support/prepare.rs`) that review its frames, set goals and
//! a default site, block a run each way and start one Running operation of
//! each kind. Included with `#[path = "support/home.rs"] mod home_support;`
//! beside `prepare_support`.
#![allow(dead_code)]

use std::fs;
use std::sync::Arc;
use std::time::Duration;

use persistence_library::{NewPreparation, NewPreparedEntry, SessionQuery};
use platevault_core::import::ImportCheck;
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::tonight::TonightQuery;
use platevault_core::*;
use time::macros::date;
use time::Date;
use uuid::Uuid;

use crate::prepare_support::{World, HA_LIGHTS, OIII_LIGHTS};
use crate::support;

/// A night NGC 7000 is well up at Backyard (52.09 N, 5.12 E).
pub const NIGHT: Date = date!(2026 - 10 - 10);

pub fn tonight() -> TonightQuery {
    TonightQuery {
        night: Some(NIGHT),
        criteria: PlanCriteria {
            min_altitude_deg: 30.0,
            darkness: Darkness::Astronomical,
            moon: MoonCriterion::None,
            min_duration_minutes: 30,
        },
    }
}

/// Backyard as the default planning site.
pub async fn default_site(library: &Library) {
    let input = SiteInput {
        name: "Backyard".into(),
        latitude_deg: 52.09,
        longitude_deg: 5.12,
        elevation_m: None,
        time_zone: "Europe/Amsterdam".into(),
    };
    let id = library.save_site(None, None, &input).await.unwrap().site.id;
    let settings = library.catalog().list_sites().await.unwrap().settings_revision;
    library.set_default_site(Some(id), settings).await.unwrap();
}

async fn terminal(library: &Library, id: Uuid) -> ScanOperation {
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

fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

fn target(designation: &str, ra_deg: f64, dec_deg: f64) -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: designation.into(),
        aliases: vec![TargetAlias {
            text: designation.into(),
            normalized: designation.to_lowercase(),
            kind: "designation".into(),
            provenance: Provenance::User,
        }],
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(SkyCoordinates { ra_deg, dec_deg, frame: "ICRS".into() }),
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    }
}

fn rig() -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: "RedCat 51".into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: Some(6248),
        sensor_height_px: Some(4176),
        color_kind: None,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

/// Six indexed light sessions, one per night: three with no confirmed
/// Target, two confirmed IC 1396 (no Project's subject), one confirmed NGC
/// 7000 on the rig, a candidate of "Summer nebulae". "Andromeda" is the
/// second Project.
pub struct Indexed {
    pub temp: tempfile::TempDir,
    pub library: Arc<Library>,
    pub needs_target: Vec<Uuid>,
    pub not_in_project: Vec<Uuid>,
    pub candidate: Uuid,
    pub nebulae: Project,
    pub galaxies: Project,
}

pub async fn indexed() -> Indexed {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Astro-T7/Captures");
    for day in 1..=6 {
        let path = root.join(format!("2026-09-0{day}/Ha_001.fits"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let start = format!("'2026-09-0{day}T22:00:00'");
        support::fits(
            &path,
            &[
                ("IMAGETYP", "'LIGHT'"),
                ("FILTER", "'Ha'"),
                ("EXPTIME", "300"),
                ("DATE-OBS", start.as_str()),
                ("INSTRUME", "'ASI2600MM'"),
            ],
        )
        .unwrap();
    }
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captures".into(), LocationRole::Captures)
        .await
        .unwrap();
    let scan = library.start_scan(location.id, None).await.unwrap();
    assert_eq!(terminal(&library, scan.id).await.state, ScanState::Completed);
    let catalog = library.catalog();
    let mut sessions: Vec<Session> = catalog
        .list_sessions(&SessionQuery::default())
        .await
        .unwrap()
        .into_iter()
        .map(|summary| summary.session)
        .collect();
    assert_eq!(sessions.len(), 6, "one session per night");
    sessions.sort_by_key(|session| session.id);
    let ngc = catalog.save_target(&target("NGC 7000", 314.75, 44.33), None).await.unwrap();
    let ic = catalog.save_target(&target("IC 1396", 324.74, 57.5), None).await.unwrap();
    let m31 = catalog.save_target(&target("M 31", 10.68, 41.27), None).await.unwrap();
    let redcat = catalog.save_equipment(&rig(), None).await.unwrap();
    let project = |name: &str, target_id: Uuid| ProjectInput {
        name: name.into(),
        notes: None,
        subjects: vec![SubjectInput { target_id, name: None, mosaic: false, panels: Vec::new() }],
        rig_ids: vec![redcat.id],
        goals: Vec::new(),
    };
    let nebulae =
        catalog.create_project(&project("Summer nebulae", ngc.candidate.id)).await.unwrap();
    let galaxies = catalog.create_project(&project("Andromeda", m31.candidate.id)).await.unwrap();
    for (session, target) in [(&sessions[3], ic.candidate.id), (&sessions[4], ic.candidate.id)] {
        catalog.associate_target(&[expected_session(session)], target).await.unwrap();
    }
    catalog.associate_target(&[expected_session(&sessions[5])], ngc.candidate.id).await.unwrap();
    let candidate = catalog.session(sessions[5].id).await.unwrap().summary.session;
    catalog.confirm_equipment(&[expected_session(&candidate)], redcat.id).await.unwrap();
    Indexed {
        temp,
        library,
        needs_target: sessions[..3].iter().map(|session| session.id).collect(),
        not_in_project: vec![sessions[3].id, sessions[4].id],
        candidate: candidate.id,
        nebulae,
        galaxies,
    }
}

/// The PREP world's Project.
pub async fn project(world: &World) -> Project {
    let project = world.view().await.project_id;
    world.catalog().project(project).await.unwrap()
}

/// The world's light at `path` below its Captures location.
pub async fn light(world: &World, path: &str) -> Asset {
    world
        .catalog()
        .location_assets(world.captures.id)
        .await
        .unwrap()
        .into_iter()
        .find(|asset| asset.relative_path.display() == path)
        .unwrap()
}

/// Mark every light of the world Usable: no candidate frame reads Unreviewed.
pub async fn review_all(world: &World) {
    let mut expected = Vec::new();
    for path in HA_LIGHTS.iter().chain(OIII_LIGHTS.iter()) {
        let asset = light(world, path).await;
        expected.push(ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint,
        });
    }
    world.catalog().set_quality(&expected, Quality::Usable, InventoryProbe).await.unwrap();
}

/// One frame-count goal on the Ha channel of the world's subject.
pub async fn ha_goal(world: &World, goal_frames: u64) {
    let project = project(world).await;
    let goals = [GoalInput {
        target_id: project.subjects[0].target_id,
        panel: None,
        goal: GoalSpec::FrameCount { channel: Some("Ha".into()), goal_frames },
    }];
    world.catalog().set_project_goals(project.id, project.revision, &goals).await.unwrap();
}

/// A second run on the world's subject and rig, saved with every candidate
/// and moved to `stage` without running its automatic calibration match:
/// every light group still awaits an acceptance.
pub async fn unmatched_run(world: &World, stage: RunStage) -> Uuid {
    let view = world.view().await;
    let record = world
        .catalog()
        .create_view(&NewView {
            project_id: view.project_id,
            subject_id: view.subject_id,
            rig_id: view.rig_id,
            name: "Calibration check".into(),
        })
        .await
        .unwrap();
    let id = record.view.id;
    world.catalog().save_view(id, 0, 1).await.unwrap();
    world.catalog().set_view_stage(id, stage).await.unwrap();
    id
}

/// Record a preparation revision of the world's run Running, as Prepare
/// records it before writing any entry; nothing is written to disk.
pub async fn running_preparation(world: &World) -> PreparationRevision {
    let profile = world.siril("exit 0").await;
    let request = world.request(&profile, InputMode::Copy, None);
    let review = world.library.review_preparation(world.run, &request).await.unwrap();
    let location = review.location.clone().unwrap();
    let entries = review
        .entries
        .iter()
        .map(|entry| NewPreparedEntry {
            member_key: entry.member_key,
            asset_id: entry.asset_id,
            master_id: entry.master_id,
            input: entry.input,
            kind: entry.kind,
            path: entry.path.clone(),
            source: Some(entry.source.clone()),
            size_bytes: entry.size_bytes,
            blocked: None,
        })
        .collect();
    let input = NewPreparation {
        view_id: world.run,
        n: review.preparation_number,
        membership_revision: review.membership_revision,
        profile_id: profile.id,
        mode: review.mode,
        link: review.link,
        output: location.output,
        folder: location.folder,
        results_folder: location.results,
        entries,
    };
    world.catalog().start_preparation(&input).await.unwrap().revision
}

/// A preparation revision of the world's run that ended Failed.
pub async fn failed_preparation(world: &World) -> PreparationRevision {
    let running = running_preparation(world).await;
    world
        .catalog()
        .finish_preparation(running.id, PreparationState::Failed, Some("the profile crashed"))
        .await
        .unwrap()
        .revision
}

/// Take the world's Captures location offline: its root is renamed and a scan
/// finds it gone, so every light reads Offline.
pub async fn captures_offline(world: &World) {
    let root = world.captures.path.to_path_buf().unwrap();
    fs::rename(&root, root.with_file_name("Captures unplugged")).unwrap();
    let scan = world.library.start_scan(world.captures.id, None).await.unwrap();
    assert_eq!(terminal(&world.library, scan.id).await.state, ScanState::Failed);
}

/// A previewed import of one light from a card folder, started: Running
/// until it is executed, which nothing here does.
pub async fn running_import(world: &World) -> ImportOperation {
    let card = world.temp.path().join("card");
    let light = card.join("lights/NGC7000_Ha_001.fits");
    fs::create_dir_all(light.parent().unwrap()).unwrap();
    support::fits(
        &light,
        &[
            ("IMAGETYP", "'LIGHT'"),
            ("OBJECT", "'NGC7000'"),
            ("FILTER", "'Ha'"),
            ("EXPTIME", "300"),
            ("GAIN", "100"),
            ("DATE-OBS", "'2026-09-30T22:00:00'"),
            ("INSTRUME", "'ZWO ASI2600MM Pro'"),
            ("TELESCOP", "'RedCat 51'"),
        ],
    )
    .unwrap();
    let check = ImportCheck { settle_interval: Duration::from_millis(40) };
    let preview = world
        .library
        .preview_import(ImportSourceSpec::Folder { path: NativePath::from_path(&card) }, check)
        .await
        .unwrap();
    world.library.start_import(preview.id, preview.revision, ImportMode::Copy).await.unwrap()
}

/// A reviewed OS-Trash operation on one scratch file, started.
pub async fn running_storage(world: &World) -> StorageOperation {
    let scratch = world.temp.path().join("scratch/old.txt");
    fs::create_dir_all(scratch.parent().unwrap()).unwrap();
    fs::write(&scratch, b"scratch").unwrap();
    let draft = StorageItemDraft {
        source: world.library.review_storage_entry(NativePath::from_path(&scratch)).await.unwrap(),
        relied_on: Vec::new(),
        destination: None,
    };
    let catalog = world.catalog();
    let recorded =
        catalog.record_storage_operation(StorageOperationKind::Trash, &[draft]).await.unwrap();
    catalog.start_storage_operation(recorded.id).await.unwrap()
}
