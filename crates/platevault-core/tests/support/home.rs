// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixtures for the Home tests (spec 065 PRJ-FR-17..19): indexed light
//! sessions in every new-sessions group with two Projects, and helpers over
//! the F4 Apply world (`support/apply.rs`) that quiet its candidates, set a
//! goal and a default site and start one Running operation of each kind.
//! Included with `#[path = "support/home.rs"] mod home_support;` beside
//! `apply_support` and `membership_support`.
#![allow(dead_code)]

use std::fs;
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::import::ImportCheck;
use platevault_core::library::Library;
use platevault_core::tonight::TonightQuery;
use platevault_core::*;
use time::macros::date;
use time::Date;
use uuid::Uuid;

use crate::apply_support::{World, AT, HA_GAIN_0};
use crate::membership_support;
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

/// Eight indexed light sessions, one per night: three with no confirmed
/// Target, two confirmed IC 1396 (no Project's subject) and three confirmed
/// NGC 7000 on the rig, candidates of "Summer nebulae": one it holds, one
/// with its frames still Unreviewed, and one Ready and settled that it only
/// suggests. "Andromeda" is the second Project.
pub struct Indexed {
    pub temp: tempfile::TempDir,
    pub library: Arc<Library>,
    pub needs_target: Vec<Uuid>,
    /// Confirmed sessions no Project holds: the two IC 1396 ones, the
    /// unreviewed candidate and the suggestion.
    pub not_in_project: Vec<Uuid>,
    pub held: Uuid,
    pub unreviewed: Uuid,
    pub suggested: Uuid,
    pub nebulae: Project,
    pub galaxies: Project,
}

#[allow(clippy::cognitive_complexity, reason = "one fixture building every new-sessions group")]
pub async fn indexed() -> Indexed {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Astro-T7/Captures");
    for day in 1..=8 {
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
    assert_eq!(sessions.len(), 8, "one session per night");
    sessions.sort_by_key(|session| session.id);
    let ngc = catalog.save_target(&target("NGC 7000", 314.75, 44.33), None).await.unwrap();
    let ic = catalog.save_target(&target("IC 1396", 324.74, 57.5), None).await.unwrap();
    let m31 = catalog.save_target(&target("M 31", 10.68, 41.27), None).await.unwrap();
    let redcat = catalog.save_equipment(&rig(), None).await.unwrap();
    let project = |name: &str, target_id: Uuid| ProjectInput {
        name: name.into(),
        notes: None,
        subjects: vec![SubjectInput { target_id, name: None }],
        rig_ids: vec![redcat.id],
        goals: Vec::new(),
    };
    let nebulae =
        catalog.create_project(&project("Summer nebulae", ngc.candidate.id)).await.unwrap();
    let galaxies = catalog.create_project(&project("Andromeda", m31.candidate.id)).await.unwrap();
    for (session, target) in [(&sessions[3], ic.candidate.id), (&sessions[4], ic.candidate.id)] {
        catalog.associate_target(&[expected_session(session)], target).await.unwrap();
    }
    for session in &sessions[5..] {
        catalog.associate_target(&[expected_session(session)], ngc.candidate.id).await.unwrap();
        let session = catalog.session(session.id).await.unwrap().summary.session;
        catalog.confirm_equipment(&[expected_session(&session)], redcat.id).await.unwrap();
    }
    let (held, unreviewed, suggested) = (sessions[5].id, sessions[6].id, sessions[7].id);
    membership_support::hold(&library, nebulae.id, held).await;
    membership_support::admit(&library, suggested).await;
    let nebulae = catalog.project(nebulae.id).await.unwrap();
    Indexed {
        temp,
        library,
        needs_target: sessions[..3].iter().map(|session| session.id).collect(),
        not_in_project: vec![sessions[3].id, sessions[4].id, unreviewed, suggested],
        held,
        unreviewed,
        suggested,
        nebulae,
        galaxies,
    }
}

/// Mark the Apply world's unheld gain 0 session Usable without finishing
/// its review: no candidate frame reads Unreviewed and nothing is suggested.
pub async fn quiet(world: &World) {
    let session = world.session_of(&world.captures, HA_GAIN_0).await;
    world.mark(&session, Quality::Usable).await;
}

/// One frame-count goal on the Ha channel of the Apply world's subject.
pub async fn ha_goal(world: &World, goal_frames: u64) {
    let project = world.catalog().project(world.project).await.unwrap();
    let goals = [GoalInput {
        target_id: project.subjects[0].target_id,
        group_id: None,
        goal: GoalSpec::FrameCount { channel: Some("Ha".into()), goal_frames },
    }];
    world.catalog().set_project_goals(project.id, project.revision, &goals).await.unwrap();
}

/// A Copy to Output the Apply world's Project reserved and never settled.
pub async fn running_project_operation(world: &World) -> Uuid {
    let id = Uuid::new_v4();
    world
        .sql(
            "INSERT INTO project_operations (id, project_id, kind, state, reserved_at) \
             VALUES (?1, ?2, 'copy_to_output', 'active', ?3)",
            &[&id.to_string(), &world.project.to_string(), AT],
        )
        .await;
    id
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
