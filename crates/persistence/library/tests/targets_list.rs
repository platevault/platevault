// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Targets list records (spec 072 PLAN-TGT-FR-01/03/08/10): ★ favourites
//! and the open-Project subjects that together make My targets, search-result
//! actions, Sessions and Captured per channel over frames outside the Trash,
//! and saved presets. Fixture files are real and only read.
#![cfg(unix)]

mod support;

use std::path::Path;

use persistence_library::{Catalog, SessionQuery, SuggestedAssociation};
use platevault_model::{
    AssociationKind, AssociationState, Availability, Band, BuiltinPreset, Catalogue,
    ChannelIntegration, Equipment, EvidenceItem, FieldPath, LibraryError, Location,
    MeasurementMethod, PresetFilters, ProjectBadge, ProjectInput, Provenance, ScanFile,
    ScanObservation, ScanProgress, ScanState, Session, SubjectInput, TargetActivity, TargetRecord,
    TargetsColumn, TargetsSearchAction, TargetsShow, TargetsSort, WrapUpOutcome, WrapUpStep,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::*;
use uuid::Uuid;

async fn raw(db: &Path) -> SqliteConnection {
    SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await.unwrap()
}

fn rig(name: &str) -> Equipment {
    Equipment {
        id: Uuid::new_v4(),
        name: name.into(),
        camera: Some("ASI2600MM".into()),
        telescope: Some(name.into()),
        focal_length_mm: Some(400.0),
        pixel_size_um: Some(3.76),
        sensor_width_px: Some(6248),
        sensor_height_px: Some(4176),
        color_kind: None,
        decision_revision: 0,
        state: AssociationState::Confirmed,
        provenance: Provenance::User,
    }
}

fn project(name: &str, subjects: &[&TargetRecord], rig: &Equipment) -> ProjectInput {
    ProjectInput {
        name: name.into(),
        notes: None,
        subjects: subjects
            .iter()
            .map(|target| SubjectInput { target_id: target.candidate.id, name: None })
            .collect(),
        rig_ids: vec![rig.id],
        goals: Vec::new(),
    }
}

async fn save(catalog: &Catalog, designation: &str) -> TargetRecord {
    catalog.save_target(&target(designation, &designation.to_lowercase()), None).await.unwrap()
}

/// PLAN-TGT-FR-01/14: a Target read is scoped to saved records, `NotFound`
/// otherwise, and the favourite moves a Target in and out of My targets.
#[tokio::test]
async fn target_read_returns_not_found_and_tracks_my_target_membership() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let target = save(&catalog, "IC 1396").await;
    let missing = catalog.target(Uuid::new_v4()).await.unwrap_err();
    assert!(matches!(missing, LibraryError::NotFound(_)), "{missing:?}");
    assert!(!catalog.my_target_marks().await.unwrap().contains(target.candidate.id));

    catalog.set_favourite(target.candidate.id, true).await.unwrap();
    assert!(catalog.my_target_marks().await.unwrap().contains(target.candidate.id));
    catalog.set_favourite(target.candidate.id, false).await.unwrap();
    assert!(!catalog.my_target_marks().await.unwrap().contains(target.candidate.id));
    catalog.close().await.unwrap();
}

/// D-W60, PLAN-TGT-FR-01: My targets includes ★ favourites, every subject of
/// an open Project, and current sessions that count as confirmed. Projects
/// carry badges, a Closed Project adds nothing, and ★ never removes a subject.
#[tokio::test]
async fn marks_hold_favourites_and_open_project_subjects_only() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let m31 = save(&catalog, "M 31").await;
    let ic1396 = save(&catalog, "IC 1396").await;
    let ngc7000 = save(&catalog, "NGC 7000").await;
    let m81 = save(&catalog, "M 81").await;
    let redcat = catalog.save_equipment(&rig("RedCat 51"), None).await.unwrap();

    assert!(catalog.my_target_marks().await.unwrap().ids().is_empty());
    assert!(catalog.set_favourite(m31.candidate.id, true).await.unwrap());
    let summer =
        catalog.create_project(&project("Summer nebulae", &[&ic1396, &ngc7000], &redcat)).await;
    let summer = summer.unwrap();
    let cygnus = catalog.create_project(&project("Cygnus", &[&ngc7000], &redcat)).await.unwrap();
    let old = catalog.create_project(&project("Old galaxies", &[&m81], &redcat)).await.unwrap();
    let revision = catalog.wrap_up_status(old.id).await.unwrap().desired_revision;
    for step in [WrapUpStep::CleanUp, WrapUpStep::Trash] {
        catalog.record_wrap_up_step(old.id, revision, step, WrapUpOutcome::Skipped).await.unwrap();
    }
    let method = MeasurementMethod::new("platevault.stars", 1);
    catalog.close_project(old.id, revision, &method, &[]).await.unwrap();

    let marks = catalog.my_target_marks().await.unwrap();
    assert_eq!(marks.favourites.iter().copied().collect::<Vec<_>>(), [m31.candidate.id]);
    let badge = |id: Uuid, name: &str| ProjectBadge { project_id: id, name: name.into() };
    assert_eq!(
        marks.badges.get(&ic1396.candidate.id).unwrap(),
        &[badge(summer.id, "Summer nebulae")]
    );
    assert_eq!(
        marks.badges.get(&ngc7000.candidate.id).unwrap(),
        &[badge(cygnus.id, "Cygnus"), badge(summer.id, "Summer nebulae")],
        "badges follow Project name order"
    );
    assert!(!marks.contains(m81.candidate.id), "a Closed Project's subject is not in My targets");
    assert_eq!(marks.ids().len(), 3);

    // ★ on a subject and off again: the subject stays listed with its badge.
    assert!(catalog.set_favourite(ic1396.candidate.id, true).await.unwrap());
    assert!(!catalog.set_favourite(ic1396.candidate.id, false).await.unwrap());
    let marks = catalog.my_target_marks().await.unwrap();
    assert!(marks.contains(ic1396.candidate.id));
    assert!(!marks.favourites.contains(&ic1396.candidate.id));

    // ★ is idempotent and names an unsaved Target as not found.
    assert!(catalog.set_favourite(m31.candidate.id, true).await.unwrap());
    assert_eq!(catalog.my_target_marks().await.unwrap().favourites.len(), 1);
    let unsaved = catalog.set_favourite(Uuid::new_v4(), true).await.unwrap_err();
    assert!(matches!(unsaved, LibraryError::NotFound(_)), "{unsaved:?}");
}
/// D-W125: a live, indexed Target session joins My targets without favouriting
/// it or creating its Target record. An unqualified suggestion alone does not.
#[tokio::test]
async fn my_targets_include_confirmed_sessions_but_not_unqualified_suggestions() {
    let fx = Fixture::new();
    for frame in &FRAMES {
        fx.write(frame.path, frame.path.as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan_frames(&catalog, &fx, &location).await;

    let confirmed_target = save(&catalog, "M 31").await;
    let qualified_target = save(&catalog, "IC 1396").await;
    let suggested_target = save(&catalog, "NGC 7000").await;
    let generation = catalog.target_generation().await.unwrap();

    let confirmed_session = session_of(&catalog, &location, "m31/Ha_1.fits").await;
    catalog
        .associate_target(&[expected_session(&confirmed_session)], confirmed_target.candidate.id)
        .await
        .unwrap();
    let qualified_session = session_of(&catalog, &location, "m31/OIII_1.fits").await;
    let qualified_detail = catalog.session(qualified_session.id).await.unwrap();
    let qualified_suggestion = SuggestedAssociation {
        session_id: qualified_session.id,
        grouping_revision: qualified_session.grouping_revision,
        kind: AssociationKind::Target,
        subject_id: Some(qualified_target.candidate.id),
        state: AssociationState::Suggested,
        evidence: vec![
            EvidenceItem::Alias { normalized: "ic 1396".into(), agrees: true },
            EvidenceItem::Coordinates { ra_deg: 314.75, dec_deg: 44.33, qualified: true },
        ],
        provenance: Provenance::Inferred { rule: "test-qualified-pointing".into() },
        expected_observations: qualified_detail
            .assets
            .iter()
            .map(|asset| (asset.id, asset.fingerprint.clone()))
            .collect(),
        expected_decisions: qualified_detail
            .assets
            .iter()
            .map(|asset| (asset.id, asset.decision_revision))
            .collect(),
        expected_observation_revisions: qualified_detail
            .assets
            .iter()
            .map(|asset| (asset.id, asset.observation_revision))
            .collect(),
    };
    catalog.record_suggestions(&[qualified_suggestion]).await.unwrap();

    let suggested_session = session_of(&catalog, &location, "m31/L_1.fits").await;
    let suggested_detail = catalog.session(suggested_session.id).await.unwrap();
    let suggestion_only = SuggestedAssociation {
        session_id: suggested_session.id,
        grouping_revision: suggested_session.grouping_revision,
        kind: AssociationKind::Target,
        subject_id: Some(suggested_target.candidate.id),
        state: AssociationState::Suggested,
        evidence: vec![EvidenceItem::Alias { normalized: "ngc 7000".into(), agrees: true }],
        provenance: Provenance::Inferred { rule: "test-unqualified".into() },
        expected_observations: suggested_detail
            .assets
            .iter()
            .map(|asset| (asset.id, asset.fingerprint.clone()))
            .collect(),
        expected_decisions: suggested_detail
            .assets
            .iter()
            .map(|asset| (asset.id, asset.decision_revision))
            .collect(),
        expected_observation_revisions: suggested_detail
            .assets
            .iter()
            .map(|asset| (asset.id, asset.observation_revision))
            .collect(),
    };
    catalog.record_suggestions(&[suggestion_only]).await.unwrap();

    let marks = catalog.my_target_marks().await.unwrap();
    assert!(marks.contains(confirmed_target.candidate.id), "confirmed indexed session");
    assert!(marks.contains(qualified_target.candidate.id), "qualified pointing association");
    assert!(!marks.contains(suggested_target.candidate.id), "suggestion alone is not membership");
    assert!(marks.favourites.is_empty(), "session membership does not favourite targets");
    assert!(marks.badges.is_empty(), "session membership adds no Project badge");
    assert_eq!(
        marks.sessions,
        [confirmed_target.candidate.id, qualified_target.candidate.id].into()
    );
    assert_eq!(catalog.target_generation().await.unwrap(), generation);
    let saved = catalog.list_targets(0, 0).await.unwrap();
    assert_eq!(saved.len(), 3, "membership reads do not create Target records");
    assert!(saved.iter().any(|record| record.candidate.id == confirmed_target.candidate.id));
}

/// PLAN-TGT-FR-03: acting on a result outside My targets saves the Target and
/// marks it ★ in one transaction; acting again opens the kept record.
#[tokio::test]
async fn act_on_target_search_result_adds_once_then_opens_the_kept_record() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let candidate = target("NGC 7000", "ngc 7000");
    let generation = catalog.target_generation().await.unwrap();

    let TargetsSearchAction::Added { target: added } =
        catalog.act_on_target_search_result(&candidate, true).await.unwrap()
    else {
        panic!("a Target outside My targets is added");
    };
    assert_eq!(added.candidate.id, candidate.id);
    assert_eq!(added.decision_revision, 1);
    assert_eq!(catalog.target_generation().await.unwrap(), generation + 1);
    assert!(catalog.my_target_marks().await.unwrap().favourites.contains(&candidate.id));

    let mut edited = added.candidate.clone();
    edited.common_name = Some("North America Nebula".into());
    let saved = catalog.save_target(&edited, Some(1)).await.unwrap();
    let generation = catalog.target_generation().await.unwrap();
    let opened = catalog.act_on_target_search_result(&candidate, true).await.unwrap();
    assert_eq!(
        opened,
        TargetsSearchAction::Open { target: saved },
        "the edited record is kept, not overwritten"
    );
    assert_eq!(catalog.target_generation().await.unwrap(), generation, "opening writes nothing");

    let mut blank = target("x", "x");
    blank.designation = "  ".into();
    let refused = catalog.act_on_target_search_result(&blank, true).await.unwrap_err();
    assert_eq!(refused.field().map(FieldPath::as_str), Some("designation"), "{refused:?}");
    assert!(!catalog.my_target_marks().await.unwrap().favourites.contains(&blank.id));
}

// ---------------------------------------------------------------------------
// Captured
// ---------------------------------------------------------------------------

/// One frame: path, FILTER, exposure and camera. The fixture groups frames by
/// filter, exposure and camera.
struct Frame {
    path: &'static str,
    filter: &'static str,
    exposure: f64,
    camera: &'static str,
}

const FRAMES: [Frame; 8] = [
    Frame { path: "m31/Ha_1.fits", filter: "Ha", exposure: 1800.0, camera: "ASI2600MM" },
    Frame { path: "m31/Ha_2.fits", filter: "Ha", exposure: 1800.0, camera: "ASI2600MM" },
    Frame { path: "m31/Ha_3.fits", filter: "Ha", exposure: 1800.0, camera: "ASI2600MM" },
    Frame { path: "m31/Ha_4.fits", filter: "Ha", exposure: 1800.0, camera: "ASI2600MM" },
    Frame { path: "m31/OIII_1.fits", filter: "OIII", exposure: 1800.0, camera: "ASI2600MM" },
    Frame { path: "m31/OIII_2.fits", filter: "OIII", exposure: 1800.0, camera: "ASI2600MM" },
    // The 30m OIII session that goes to the Trash.
    Frame { path: "m31/OIII_late.fits", filter: "OIII", exposure: 1800.0, camera: "ASI533MM" },
    // A session only suggested for M 31: it counts toward nothing.
    Frame { path: "m31/L_1.fits", filter: "L", exposure: 600.0, camera: "ASI2600MM" },
];

fn scan_file(fx: &Fixture, frame: &Frame) -> ScanFile {
    let mut file = fx.scan_file(frame.path);
    file.metadata.filter = Some(frame.filter.into());
    file.metadata.exposure_seconds = Some(frame.exposure);
    file.metadata.camera = Some(frame.camera.into());
    file
}

async fn scan_frames(catalog: &Catalog, fx: &Fixture, location: &Location) {
    use persistence_library::SourceProbe;
    let files: Vec<ScanFile> = FRAMES.iter().map(|frame| scan_file(fx, frame)).collect();
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let root = DiskProbe.root_identity(location).unwrap();
    let count = files.len() as u64;
    let progress =
        ScanProgress { discovered: count, metadata_read: count, ..ScanProgress::default() };
    let batch = platevault_model::ScanBatch {
        files: files.clone(),
        issues: Vec::new(),
        progress: progress.clone(),
    };
    catalog.apply_scan_batch(operation.id, &root, &batch, group).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: root,
        incomplete_scopes: Vec::new(),
        files,
        issues: Vec::new(),
        complete_scopes: vec![root_scope()],
        progress,
        state: ScanState::Completed,
    };
    catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| DiskProbe.root_identity(location),
            group,
        )
        .await
        .unwrap();
}

async fn session_of(catalog: &Catalog, location: &Location, path: &str) -> Session {
    let asset = by_name(&catalog.location_assets(location.id).await.unwrap(), path).id;
    catalog
        .list_sessions(&SessionQuery::default())
        .await
        .unwrap()
        .into_iter()
        .map(|summary| summary.session)
        .find(|session| session.asset_ids.contains(&asset))
        .unwrap()
}

fn channel(name: &str, seconds: f64, frames: u32) -> ChannelIntegration {
    ChannelIntegration { channel: Some(name.into()), seconds, frames }
}

/// PLAN-TGT-AC-08, D-W43: M 31 with 2h00m of Ha and 1h30m of OIII, where one
/// 30m OIII session is Trashed: Captured reads Ha 2h00m and OIII 1h00m and
/// Sessions leaves the Trashed session out. A suggested session counts toward
/// nothing; an Unusable frame still counts, whatever its quality.
#[tokio::test]
async fn captured_excludes_trashed() {
    let fx = Fixture::new();
    for frame in &FRAMES {
        fx.write(frame.path, frame.path.as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan_frames(&catalog, &fx, &location).await;
    let m31 = save(&catalog, "M 31").await;
    for path in ["m31/Ha_1.fits", "m31/OIII_1.fits", "m31/OIII_late.fits"] {
        let session = session_of(&catalog, &location, path).await;
        catalog.associate_target(&[expected_session(&session)], m31.candidate.id).await.unwrap();
    }
    let unusable =
        by_name(&catalog.location_assets(location.id).await.unwrap(), "Ha_4.fits").clone();
    catalog
        .set_quality(&[expected(&unusable)], platevault_model::Quality::Unusable, DiskProbe)
        .await
        .unwrap();

    let before = catalog.target_activity().await.unwrap();
    assert_eq!(
        before.get(&m31.candidate.id).unwrap(),
        &TargetActivity {
            sessions: 3,
            captured: vec![channel("Ha", 7200.0, 4), channel("OIII", 5400.0, 3)],
        }
    );

    let late = by_name(&catalog.location_assets(location.id).await.unwrap(), "OIII_late.fits").id;
    catalog.close().await.unwrap();
    let mut conn = raw(&fx.db).await;
    sqlx::query("UPDATE assets SET availability = ?1 WHERE id = ?2")
        .bind(serde_json::to_value(Availability::Trashed).unwrap().as_str().unwrap())
        .bind(late.to_string())
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
    let catalog = Catalog::open(&fx.db).await.unwrap();

    let activity = catalog.target_activity().await.unwrap();
    let m31_activity = activity.get(&m31.candidate.id).unwrap();
    assert_eq!(
        m31_activity,
        &TargetActivity {
            sessions: 2,
            captured: vec![channel("Ha", 7200.0, 4), channel("OIII", 3600.0, 2)],
        }
    );
    assert!((m31_activity.captured_seconds() - 10_800.0).abs() < 1e-9);
    assert_eq!(activity.len(), 1, "only confirmed Targets have activity");
}

/// D-W124: target activity includes a Suggested Target only when its agreeing
/// alias and qualified geometry make it count as confirmed.
#[tokio::test]
async fn target_activity_counts_evidence_qualified_suggested_target() {
    let fx = Fixture::new();
    for frame in &FRAMES {
        fx.write(frame.path, frame.path.as_bytes());
    }
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let location = catalog.register_location(&fx.registration()).await.unwrap();
    scan_frames(&catalog, &fx, &location).await;
    let target = save(&catalog, "IC 1396").await;
    let session = session_of(&catalog, &location, "m31/OIII_1.fits").await;
    let detail = catalog.session(session.id).await.unwrap();
    let suggestion = SuggestedAssociation {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        kind: AssociationKind::Target,
        subject_id: Some(target.candidate.id),
        state: AssociationState::Suggested,
        evidence: vec![
            EvidenceItem::Alias { normalized: "ic 1396".into(), agrees: true },
            EvidenceItem::Coordinates { ra_deg: 314.75, dec_deg: 44.33, qualified: true },
        ],
        provenance: Provenance::Inferred { rule: "test-qualified-pointing".into() },
        expected_observations: detail
            .assets
            .iter()
            .map(|asset| (asset.id, asset.fingerprint.clone()))
            .collect(),
        expected_decisions: detail
            .assets
            .iter()
            .map(|asset| (asset.id, asset.decision_revision))
            .collect(),
        expected_observation_revisions: detail
            .assets
            .iter()
            .map(|asset| (asset.id, asset.observation_revision))
            .collect(),
    };
    catalog.record_suggestions(&[suggestion]).await.unwrap();
    let activity = catalog.target_activity().await.unwrap();
    assert_eq!(
        activity.get(&target.candidate.id).unwrap(),
        &TargetActivity { sessions: 1, captured: vec![channel("OIII", 3600.0, 2)] }
    );
    catalog.close().await.unwrap();
}

// ---------------------------------------------------------------------------
// Saved presets
// ---------------------------------------------------------------------------

/// Every saved filter set, so a round trip shows each one persists
/// (PLAN-TGT-FR-10/15/17): the Favourite filter, Suitable filters and the
/// Fit filter's rig.
fn autumn() -> PresetFilters {
    PresetFilters {
        show: TargetsShow::Browse,
        catalogues: vec![Catalogue::Ngc, Catalogue::Messier],
        preset: Some(BuiltinPreset::GalaxiesDarkSky),
        favourite: Some(false),
        suitable_bands: vec![Band::Ha, Band::Oiii],
        rig_id: Some(Uuid::from_u128(0x0072_0010)),
        sort: TargetsSort { column: TargetsColumn::ImgTime, descending: true },
    }
}

/// PLAN-TGT-FR-10: a saved preset persists across a reopen with its filters,
/// is renamed and deleted at its revision, and names are unique.
#[tokio::test]
async fn saved_presets_persist_rename_and_delete_at_their_revision() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let created = catalog.create_preset("Autumn galaxies", &autumn()).await.unwrap();
    assert_eq!(created.revision, 1);
    let other =
        catalog.create_preset("  Bright nebulae ", &PresetFilters::default()).await.unwrap();
    assert_eq!(other.name, "Bright nebulae", "names are trimmed");
    let duplicate = catalog.create_preset("autumn GALAXIES", &autumn()).await.unwrap_err();
    assert!(matches!(duplicate, LibraryError::Conflict { .. }), "{duplicate:?}");
    let builtin = catalog.create_preset("Galaxies dark sky", &autumn()).await.unwrap_err();
    assert_eq!(builtin.field().map(FieldPath::as_str), Some("name"), "{builtin:?}");
    catalog.close().await.unwrap();

    let catalog = Catalog::open(&fx.db).await.unwrap();
    let saved = catalog.saved_presets().await.unwrap();
    assert_eq!(saved, [created.clone(), other.clone()], "listed by name after a reopen");
    assert_eq!(saved[0].filters, autumn());

    let renamed = catalog.rename_preset(created.id, "Autumn galaxies 2026", 1).await.unwrap();
    assert_eq!((renamed.revision, renamed.name.as_str()), (2, "Autumn galaxies 2026"));
    assert_eq!(renamed.filters, autumn());
    let stale = catalog.rename_preset(created.id, "Stale", 1).await.unwrap_err();
    assert!(matches!(stale, LibraryError::Conflict { .. }), "{stale:?}");
    let taken = catalog.rename_preset(created.id, "bright nebulae", 2).await.unwrap_err();
    assert!(matches!(taken, LibraryError::Conflict { .. }), "{taken:?}");

    let stale = catalog.delete_preset(created.id, 1).await.unwrap_err();
    assert!(matches!(stale, LibraryError::Conflict { .. }), "{stale:?}");
    catalog.delete_preset(created.id, 2).await.unwrap();
    let missing = catalog.delete_preset(created.id, 2).await.unwrap_err();
    assert!(matches!(missing, LibraryError::NotFound(_)), "{missing:?}");
    assert_eq!(catalog.saved_presets().await.unwrap(), [other]);
}
