// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Equipment inventory against a real catalog (astro-plan-mts3e; spec 072
//! PLAN-EQ-FR-01, D-W87): every saved rig, camera and rig filter list is
//! listed, and a rig or camera is deleted only while nothing refers to it.
//! A refused delete writes nothing: no cascade into sessions, associations,
//! rig versions, camera links, adopted masters or Projects.
#![cfg(unix)]

#[path = "support/calibration.rs"]
mod calibration_support;
mod support;

use std::path::Path;

use calibration_support::{
    calibration_frame, dump_tables, frame, location_at, raw, scan_frames, with_train, TestRules,
};
use persistence_library::{Catalog, NewGroup};
use platevault_model::{
    AdoptionDestination, AdoptionSource, AssociationState, Band, Camera, Equipment, GroupName,
    GroupOrigin, LibraryError, LocationRole, NativePath, OpticsSignature, Project, ProjectInput,
    Provenance, RigFilter, RigVersion, RotatorPresence, Session, SubjectInput,
};
use sqlx::Connection;
use support::{expected, expected_session, kind, scan, target, DiskProbe, Fixture};
use time::macros::date;
use uuid::Uuid;

/// Light sessions Ha and OIII and one dark session, all ASI2600MM frames.
const FRAMES: [&str; 3] = ["Ha_1.fits", "OIII_1.fits", "Dark_1.fits"];

/// Tables a refused delete must leave byte-for-byte as they were.
const GUARDED_TABLES: [&str; 14] = [
    "equipment",
    "rig_filter_lists",
    "rig_filters",
    "rig_versions",
    "session_rig_versions",
    "cameras",
    "session_cameras",
    "adopted_masters",
    "associations",
    "sessions",
    "projects",
    "project_rigs",
    "project_groups",
    "project_snapshots",
];

struct Inventory {
    fx: Fixture,
    catalog: Catalog,
}

impl Inventory {
    async fn new() -> Self {
        let fx = Fixture::new();
        for frame in FRAMES {
            fx.write(frame, frame.as_bytes());
        }
        let catalog = Catalog::open(&fx.db).await.unwrap();
        let location = catalog.register_location(&fx.registration()).await.unwrap();
        scan(&catalog, &fx, &location, &FRAMES).await;
        Self { fx, catalog }
    }

    async fn rig(&self, name: &str) -> Equipment {
        let equipment = Equipment {
            id: Uuid::new_v4(),
            name: name.into(),
            camera: Some("ASI2600MM".into()),
            telescope: Some(name.into()),
            focal_length_mm: Some(250.0),
            pixel_size_um: Some(3.76),
            sensor_width_px: Some(6248),
            sensor_height_px: Some(4176),
            color_kind: None,
            decision_revision: 0,
            state: AssociationState::Confirmed,
            provenance: Provenance::User,
        };
        self.catalog.save_equipment(&equipment, None).await.unwrap()
    }

    async fn camera(&self, model: &str) -> Camera {
        let camera = Camera {
            id: Uuid::new_v4(),
            model: model.into(),
            alias: None,
            no_darks: false,
            no_bias: false,
            revision: 0,
        };
        self.catalog.save_cameras(&[camera]).await.unwrap().remove(0)
    }

    async fn version(&self, rig: &Equipment, camera: &Camera) -> RigVersion {
        let version = RigVersion {
            id: Uuid::new_v4(),
            rig_id: rig.id,
            valid_from: date!(2026 - 09 - 01),
            optics: OpticsSignature::new(Some(camera.id), Some(250.0), None).unwrap(),
            rotator: RotatorPresence::Absent,
        };
        self.catalog.add_rig_version(&version).await.unwrap()
    }

    /// The current session whose capture key starts with `frame_type`: the
    /// fixture's grouping key opens with the frame type's `Debug` form.
    async fn session(&self, frame_type: &str) -> Session {
        let mut raw = raw(&self.fx.db).await;
        let prefix = format!("Some(\"{frame_type}\")|Some(\"Ha\")|");
        let id: String = sqlx::query_scalar(
            "SELECT id FROM sessions WHERE superseded_by IS NULL AND instr(capture_key, ?1) = 1",
        )
        .bind(&prefix)
        .fetch_one(&mut raw)
        .await
        .unwrap_or_else(|error| panic!("no session {prefix}: {error}"));
        raw.close().await.unwrap();
        self.catalog.session(id.parse().unwrap()).await.unwrap().summary.session
    }

    /// An open Project on NGC 7000 with `rig`.
    async fn project(&self, rig: &Equipment) -> Project {
        let ngc = self.catalog.save_target(&target("NGC 7000", "ngc 7000"), None).await.unwrap();
        self.catalog
            .create_project(&ProjectInput {
                name: "NGC 7000 HOO".into(),
                notes: None,
                subjects: vec![SubjectInput { target_id: ngc.candidate.id, name: None }],
                rig_ids: vec![rig.id],
                goals: Vec::new(),
            })
            .await
            .unwrap()
    }

    /// Every row of the guarded tables, each value quoted by SQLite.
    async fn snapshot(&self) -> std::collections::BTreeMap<String, Vec<String>> {
        dump_tables(&self.fx.db, &GUARDED_TABLES).await
    }
}

fn filter(name: &str, band: Band) -> RigFilter {
    RigFilter {
        id: Uuid::new_v4(),
        name: name.into(),
        match_values: vec![name.into()],
        bands: vec![band],
    }
}

fn refused(error: &LibraryError) -> bool {
    kind(error) == "invalid_input"
}

#[tokio::test]
async fn lists_every_rig_camera_and_rig_filter_list() {
    let inv = Inventory::new().await;
    assert!(inv.catalog.list_equipment().await.unwrap().is_empty(), "no rig saved yet");
    assert!(inv.catalog.rigs_with_filters().await.unwrap().is_empty());

    let redcat = inv.rig("RedCat 51").await;
    let esprit = inv.rig("Esprit 100").await;
    let renamed = Equipment { name: "Askar FRA400".into(), ..redcat.clone() };
    let redcat =
        inv.catalog.save_equipment(&renamed, Some(redcat.decision_revision)).await.unwrap();
    let mono = inv.camera("ASI2600MM").await;
    let osc = inv.camera("ASI533MC").await;
    let ha = filter("Ha", Band::Ha);
    inv.catalog.save_rig_filters(esprit.id, std::slice::from_ref(&ha), 0).await.unwrap();

    // Rigs by name, each at its current revision: what a rig picker needs.
    let listed = inv.catalog.list_equipment().await.unwrap();
    let rows: Vec<(Uuid, &str, u64)> =
        listed.iter().map(|rig| (rig.id, rig.name.as_str(), rig.decision_revision)).collect();
    assert_eq!(rows, [(redcat.id, "Askar FRA400", 2), (esprit.id, "Esprit 100", 1)]);
    assert_eq!(listed[0].telescope.as_deref(), Some("RedCat 51"), "the full record is listed");

    // Every camera, by model.
    let cameras = inv.catalog.cameras().await.unwrap();
    assert_eq!(cameras, [mono, osc]);

    // Every rig's filter list in the same order, an unsaved list at revision 0.
    let lists = inv.catalog.rigs_with_filters().await.unwrap();
    let read: Vec<(Uuid, u64, Vec<RigFilter>)> = lists
        .iter()
        .map(|(rig, list)| {
            assert_eq!(rig.id, list.equipment_id);
            (rig.id, list.revision, list.filters.clone())
        })
        .collect();
    assert_eq!(read, [(redcat.id, 0, Vec::new()), (esprit.id, 1, vec![ha])]);
    inv.catalog.close().await.unwrap();
}

#[tokio::test]
async fn deletes_an_unreferenced_rig_with_its_filter_list() {
    let inv = Inventory::new().await;
    let kept = inv.rig("RedCat 51").await;
    let gone = inv.rig("Esprit 100").await;
    let ha = filter("Ha", Band::Ha);
    inv.catalog.save_rig_filters(gone.id, std::slice::from_ref(&ha), 0).await.unwrap();

    let stale = inv.catalog.delete_equipment(gone.id, gone.decision_revision + 1).await;
    assert!(
        matches!(stale, Err(LibraryError::Conflict { id, current: 1, .. }) if id == gone.id),
        "{stale:?}"
    );
    inv.catalog.delete_equipment(gone.id, gone.decision_revision).await.unwrap();

    assert!(matches!(inv.catalog.equipment(gone.id).await, Err(LibraryError::NotFound(_))));
    assert!(matches!(inv.catalog.rig_filters(gone.id).await, Err(LibraryError::NotFound(_))));
    let listed: Vec<Uuid> =
        inv.catalog.list_equipment().await.unwrap().iter().map(|rig| rig.id).collect();
    assert_eq!(listed, [kept.id]);
    let mut raw = raw(&inv.fx.db).await;
    let leftovers: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM rig_filters WHERE equipment_id = ?1) + \
         (SELECT count(*) FROM rig_filter_lists WHERE equipment_id = ?1)",
    )
    .bind(gone.id.to_string())
    .fetch_one(&mut raw)
    .await
    .unwrap();
    raw.close().await.unwrap();
    assert_eq!(leftovers, 0, "the rig's own filter list goes with it");
    // The deleted rig's filter id is free again.
    inv.catalog.save_rig_filters(kept.id, &[ha], 0).await.unwrap();

    let again = inv.catalog.delete_equipment(gone.id, gone.decision_revision).await;
    assert!(matches!(again, Err(LibraryError::NotFound(_))), "{again:?}");
    inv.catalog.close().await.unwrap();
}

#[tokio::test]
async fn refuses_a_rig_that_a_session_project_or_version_uses() {
    let inv = Inventory::new().await;
    let camera = inv.camera("ASI2600MM").await;
    let confirmed = inv.rig("Confirmed rig").await;
    let in_project = inv.rig("Project rig").await;
    let versioned = inv.rig("Versioned rig").await;
    inv.catalog.save_rig_filters(confirmed.id, &[filter("Ha", Band::Ha)], 0).await.unwrap();

    let ha = inv.session("LIGHT").await;
    inv.catalog.confirm_equipment(&[expected_session(&ha)], confirmed.id).await.unwrap();
    inv.project(&in_project).await;
    inv.version(&versioned, &camera).await;

    let before = inv.snapshot().await;
    for rig in [&confirmed, &in_project, &versioned] {
        let error = inv.catalog.delete_equipment(rig.id, rig.decision_revision).await.unwrap_err();
        assert!(refused(&error), "{} must be refused: {error:?}", rig.name);
        assert!(error.to_string().contains(&rig.name), "the refusal names the rig: {error}");
    }
    assert_eq!(inv.snapshot().await, before, "a refused delete writes nothing");
    assert_eq!(inv.catalog.list_equipment().await.unwrap().len(), 3);
    inv.catalog.close().await.unwrap();
}

#[tokio::test]
async fn deletes_an_unreferenced_camera_and_refuses_a_used_one() {
    let inv = Inventory::new().await;
    let spare = inv.camera("ASI533MC").await;
    let mounted = inv.camera("ASI2600MM").await;
    let linked = inv.camera("ASI294MM").await;
    let linked = Camera { alias: Some("Guide cam".into()), ..linked };
    let linked = inv.catalog.save_cameras(&[linked]).await.unwrap().remove(0);
    let grouped = inv.camera("ASI183MM").await;
    let rig = inv.rig("RedCat 51").await;
    inv.version(&rig, &mounted).await;
    let dark = inv.session("DARK").await;
    inv.catalog.confirm_session_camera(&[expected_session(&dark)], linked.id).await.unwrap();
    // A user group of a Project whose optics name the camera.
    let project = inv.project(&rig).await;
    let group = NewGroup {
        id: Uuid::new_v4(),
        rig_id: rig.id,
        name: GroupName::new("ASI183 nights").unwrap(),
        origin: GroupOrigin::User,
        optics: OpticsSignature::new(Some(grouped.id), Some(250.0), None).unwrap(),
        framing: None,
    };
    inv.catalog.create_project_group(project.id, project.revision, &group, &[]).await.unwrap();

    let before = inv.snapshot().await;
    for (camera, label) in [
        (&mounted, "camera ASI2600MM is used by 1 rig version(s)"),
        (&linked, "camera Guide cam (ASI294MM) is used by 1 session(s)"),
        (&grouped, "camera ASI183MM is used by 1 Project(s)"),
    ] {
        let error = inv.catalog.delete_camera(camera.id, camera.revision).await.unwrap_err();
        assert!(refused(&error), "{} must be refused: {error:?}", camera.model);
        assert!(error.to_string().contains(label), "the refusal names it: {error}");
    }
    assert_eq!(inv.snapshot().await, before, "a refused delete writes nothing");

    let stale = inv.catalog.delete_camera(spare.id, spare.revision + 1).await;
    assert!(matches!(stale, Err(LibraryError::Conflict { .. })), "{stale:?}");
    inv.catalog.delete_camera(spare.id, spare.revision).await.unwrap();
    assert!(matches!(inv.catalog.camera(spare.id).await, Err(LibraryError::NotFound(_))));
    assert_eq!(inv.catalog.cameras().await.unwrap(), [grouped, mounted, linked]);
    let again = inv.catalog.delete_camera(spare.id, spare.revision).await;
    assert!(matches!(again, Err(LibraryError::NotFound(_))), "{again:?}");
    inv.catalog.close().await.unwrap();
}

#[tokio::test]
async fn refuses_a_camera_an_adopted_master_was_taken_with() {
    let fx = Fixture::new();
    let catalog = Catalog::open(&fx.db).await.unwrap();
    let (calibration, calibration_root) =
        location_at(&catalog, &fx, "Astro-T7/Calibration", LocationRole::Calibration).await;
    std::fs::create_dir_all(calibration_root.join("masters")).unwrap();
    let (results, results_root) =
        location_at(&catalog, &fx, "Work/Processing", LocationRole::Results).await;
    let mut flat = with_train(calibration_frame("Flat", Some("Ha"), 2.0, "2026-09-20"));
    flat.stack_count = Some(30);
    scan_frames(&catalog, &results, vec![frame(&results_root, "master_flat_Ha.fit", flat)]).await;
    // The schema records the camera a master was taken with (LIB-FR-26), but
    // no adoption writes it yet, so the link is written as a later import
    // would: by model, the rigs holding one ASI2600MM.
    let camera = Camera {
        id: Uuid::new_v4(),
        model: "ASI2600MM".into(),
        alias: None,
        no_darks: false,
        no_bias: false,
        revision: 0,
    };
    let camera = catalog.save_cameras(&[camera]).await.unwrap().remove(0);
    let source = catalog.location_assets(results.id).await.unwrap().remove(0);
    let review = catalog
        .review_adoption(
            &AdoptionSource::Asset { asset_id: source.id, expected: expected(&source) },
            &AdoptionDestination {
                location_id: calibration.id,
                relative_path: NativePath::from_path(Path::new("masters/master_flat_Ha.fit")),
            },
            &TestRules,
            DiskProbe,
        )
        .await
        .unwrap();
    Box::pin(catalog.adopt_master(review.id, review.revision, DiskProbe)).await.unwrap();
    let mut conn = raw(&fx.db).await;
    let linked = sqlx::query(
        "UPDATE adopted_masters SET camera_id = ?1, camera_basis = 'model' WHERE review_id = ?2",
    )
    .bind(camera.id.to_string())
    .bind(review.id.to_string())
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
    assert_eq!(linked.rows_affected(), 1, "one adopted master names the camera");

    let before = dump_tables(&fx.db, &GUARDED_TABLES).await;
    let error = catalog.delete_camera(camera.id, camera.revision).await.unwrap_err();
    assert!(refused(&error), "{error:?}");
    assert!(error.to_string().contains("1 calibration master(s)"), "{error}");
    assert_eq!(dump_tables(&fx.db, &GUARDED_TABLES).await, before, "nothing is written");
    catalog.close().await.unwrap();
}
