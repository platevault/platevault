// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixtures of the RES tests (spec 070): the PREP world's prepared
//! run, settled and growing files in its Results folder, and a mosaic run
//! group whose panel and Assembled Results folders are recorded the way
//! Prepare all records them. Included with
//! `#[path = "support/results.rs"] mod results_support;` beside
//! `prepare_support` and `support`.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use platevault_core::library::Library;
use platevault_core::*;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use uuid::Uuid;

use super::prepare_support::{Watch, World, PROJECT, RUN};

/// Set `path`'s modification time an hour back: a settled file.
pub fn settle(path: &Path) {
    let file = fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_modified(SystemTime::now() - Duration::from_secs(3600)).unwrap();
}

/// A settled FITS file with `keywords`.
pub fn stack(path: &Path, keywords: &[(&str, &str)]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    super::support::fits(path, keywords).unwrap();
    settle(path);
}

/// A settled non-image file with `text`.
pub fn text(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
    settle(path);
}

pub fn native_json(path: &Path) -> String {
    serde_json::to_string(&NativePath::from_path(path)).unwrap().replace('\'', "''")
}

/// Run SQL a parallel unit's write owns (U26 Prepare all) directly.
pub async fn raw_sql(database: &Path, statement: &str) {
    let options = SqliteConnectOptions::new().filename(database).foreign_keys(true);
    let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
    sqlx::query(sqlx::AssertSqlSafe(statement.to_owned())).execute(&mut conn).await.unwrap();
    conn.close().await.unwrap();
}

/// Record a Results folder as PREP records it: a run's or panel run's own
/// (`view`), or a run group's `Assembled/` (`group`).
pub async fn record_results_folder(
    database: &Path,
    view: Option<Uuid>,
    group: Option<Uuid>,
    kind: &str,
    path: &Path,
) {
    fs::create_dir_all(path).unwrap();
    let id = |value: Option<Uuid>| value.map_or_else(|| "NULL".to_owned(), |id| format!("'{id}'"));
    raw_sql(
        database,
        &format!(
            "INSERT INTO results_folders (id, view_id, group_id, kind, path, created_at) VALUES \
             ('{}', {}, {}, '{kind}', '{}', '2026-10-08T00:00:00Z')",
            Uuid::new_v4(),
            id(view),
            id(group),
            native_json(path)
        ),
    )
    .await;
}

pub fn database(world: &World) -> PathBuf {
    world.temp.path().join("library.sqlite")
}

/// `<output>/<Project>/<Run> Results/`.
pub fn results_dir(world: &World) -> PathBuf {
    world.output.join(PROJECT).join(format!("{RUN} Results"))
}

/// Prepare the world's run once with a Siril profile.
pub async fn prepared(world: &World) -> PreparationOutcome {
    let profile = world.siril("exit 0").await;
    let request = world.request(&profile, InputMode::LinkedView, None);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    outcome
}

pub fn path(record: &ResultRecord) -> PathBuf {
    record.path.to_path_buf().unwrap()
}

pub fn paths(records: &[ResultRecord]) -> Vec<PathBuf> {
    records.iter().map(path).collect()
}

pub fn find<'a>(records: &'a [ResultRecord], file: &Path) -> &'a ResultRecord {
    records
        .iter()
        .find(|record| path(record) == file)
        .unwrap_or_else(|| panic!("{} is not listed in {:?}", file.display(), paths(records)))
}

/// Rescan the run and accept `file` as `kind`.
pub async fn accept(library: &Library, owner: ResultOwner, file: &Path, kind: ResultKind) -> Uuid {
    let listing = library.rescan_results(owner).await.unwrap();
    let id = find(&listing.candidates, file).id;
    let outcome =
        library.accept_results(&[AcceptResult { result_id: id, kind: Some(kind) }]).await.unwrap();
    assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
    id
}

/// A Project 'NGC7000 Cygnus' with the mosaic subject 'Cygnus Wall' of three
/// panels and a run group with one panel run per panel.
pub struct GroupWorld {
    pub temp: tempfile::TempDir,
    pub database: PathBuf,
    pub library: Arc<Library>,
    pub project: Project,
    pub group: ViewGroupRecord,
    /// `<output>/NGC7000 Cygnus/`.
    pub project_dir: PathBuf,
}

impl GroupWorld {
    /// The panel run of panel `number`.
    pub fn panel_run(&self, number: u32) -> Uuid {
        let panel =
            self.project.subjects[0].panels.iter().find(|panel| panel.number == number).unwrap().id;
        self.group.runs.iter().find(|run| run.view.panel_id == Some(panel)).unwrap().view.id
    }

    pub fn results(&self) -> PathBuf {
        self.project_dir.join("Cygnus Wall Results")
    }
}

pub async fn group_world() -> GroupWorld {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("library.sqlite");
    let library = Library::open(&database, None).await.unwrap();
    let catalog = library.catalog();
    let target = TargetCandidate {
        id: Uuid::new_v4(),
        designation: "NGC 7000".into(),
        aliases: Vec::new(),
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(SkyCoordinates { ra_deg: 314.75, dec_deg: 44.33, frame: "ICRS".into() }),
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    };
    let target = catalog.save_target(&target, None).await.unwrap();
    let rig = Equipment {
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
    };
    let rig = catalog.save_equipment(&rig, None).await.unwrap();
    let panels = (1..=3)
        .map(|number| PanelInput {
            number,
            ra_deg: 313.0 + f64::from(number),
            dec_deg: 44.0,
            rotation_deg: Some(0.0),
        })
        .collect();
    let input = ProjectInput {
        name: "NGC7000 Cygnus".into(),
        notes: None,
        subjects: vec![SubjectInput {
            target_id: target.candidate.id,
            name: Some("Cygnus Wall".into()),
            mosaic: true,
            panels,
        }],
        rig_ids: vec![rig.id],
        goals: Vec::new(),
    };
    let project = catalog.create_project(&input).await.unwrap();
    let new = NewViewGroup {
        project_id: project.id,
        subject_id: project.subjects[0].id,
        rig_id: rig.id,
        name: "Cygnus Wall".into(),
        panels: project.subjects[0].panels.clone(),
    };
    let group = catalog.create_view_group(&new, &[]).await.unwrap();
    let project_dir = temp.path().join("Work/Processing/NGC7000 Cygnus");
    fs::create_dir_all(&project_dir).unwrap();
    GroupWorld { temp, database, library, project, group, project_dir }
}
