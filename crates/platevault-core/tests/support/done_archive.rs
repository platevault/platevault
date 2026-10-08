// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixtures of the Done / Archive sheet tests (spec 065 PRJ-FR-14/15):
//! the PREP world's lights marked in the library and for the Project only,
//! the world's Project marked Done, another Project whose open run prepared
//! some of the lights, and byte-identical extra copies in locations
//! registered after the world's. Included with
//! `#[path = "support/done_archive.rs"] mod done_archive_support;` beside
//! `prepare_support`, `results_support` and `support`.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use persistence_library::{
    NewPreparation, NewPreparedEntry, PreparationRecord, SourceProbe, TrashedFrame,
};
use platevault_core::library::InventoryProbe;
use platevault_core::*;
use uuid::Uuid;

use super::prepare_support::World;

/// The copy recorded at `path` below `location`.
pub async fn asset_at(world: &World, location: &Location, path: &str) -> Asset {
    world
        .catalog()
        .location_assets(location.id)
        .await
        .unwrap()
        .into_iter()
        .find(|asset| asset.relative_path.display() == path)
        .unwrap_or_else(|| panic!("{path} is not indexed in {}", location.name))
}

/// The world's Captures copy of light `path`.
pub async fn light(world: &World, path: &str) -> Asset {
    asset_at(world, &world.captures, path).await
}

/// The file a copy is recorded at.
pub fn file_of(location: &Location, asset: &Asset) -> PathBuf {
    location.path.to_path_buf().unwrap().join(asset.relative_path.relative_path().unwrap())
}

/// Decide `asset`'s library quality, hashing its bytes as review does.
pub async fn set_quality(world: &World, asset: &Asset, quality: Quality) {
    let expected = ExpectedAsset {
        asset_id: asset.id,
        decision_revision: asset.decision_revision,
        fingerprint: asset.fingerprint.clone(),
    };
    world.catalog().set_quality(&[expected], quality, InventoryProbe).await.unwrap();
}

/// "Reject for this Project only" on `asset`, its first Project-only mark.
pub async fn reject_for_project(world: &World, project: Uuid, asset: &Asset) {
    let mark = RejectionMark {
        asset_id: asset.id,
        fingerprint: asset.fingerprint.clone(),
        expected_revision: 0,
        rejected: true,
    };
    world.catalog().set_project_rejection(project, &[mark]).await.unwrap();
}

/// Record `asset` Trashed by a storage operation, as custody does after the
/// OS Trash took it.
pub async fn record_trashed(world: &World, location: &Location, asset: &Asset) {
    let frame = TrashedFrame {
        asset_id: asset.id,
        sha256: super::support::digest(&file_of(location, asset)),
        complete_view_ids: Vec::new(),
    };
    world.catalog().record_trashed(Uuid::new_v4(), &[frame]).await.unwrap();
}

/// The world's Project.
pub async fn project_of(world: &World) -> Uuid {
    world.view().await.project_id
}

/// Mark `project` Done at its current revision.
pub async fn mark_done(world: &World, project: Uuid) {
    let revision = world.catalog().project(project).await.unwrap().revision;
    world.catalog().mark_project_done(project, revision).await.unwrap();
}

/// Mark the world's run Complete and its Project Done.
pub async fn done(world: &World) -> Uuid {
    world.library.mark_view_complete(world.run).await.unwrap();
    let project = project_of(world).await;
    mark_done(world, project).await;
    project
}

/// The Done / Archive sheet of `project`.
pub async fn sheet(world: &World, project: Uuid) -> DoneArchiveSheet {
    world.library.done_archive_review(project).await.unwrap()
}

/// Another open Project `name` on the world's Target and rig, with run
/// `run` saved once with every candidate.
pub async fn other_project_run(world: &World, name: &str, run: &str) -> (Uuid, Uuid) {
    let view = world.view().await;
    let catalog = world.catalog();
    let target = catalog.project(view.project_id).await.unwrap().subjects[0].target_id;
    let other = catalog
        .create_project(&ProjectInput {
            name: name.into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: target,
                name: None,
                mosaic: false,
                panels: Vec::new(),
            }],
            rig_ids: vec![view.rig_id],
            goals: Vec::new(),
        })
        .await
        .unwrap();
    let record = catalog
        .create_view(&NewView {
            project_id: other.id,
            subject_id: other.subjects[0].id,
            rig_id: view.rig_id,
            name: run.into(),
        })
        .await
        .unwrap();
    catalog.save_view(record.view.id, 0, 1).await.unwrap();
    (other.id, record.view.id)
}

/// Record preparation 1 of `run` Prepared, reading each `(frame key, copy,
/// file)` as a light: each copy itself as the Direct-source path, or a
/// symlink in the revision's folder. The run moves to Prepare and stays open.
pub async fn record_preparation(
    world: &World,
    run: Uuid,
    mode: InputMode,
    inputs: &[(Uuid, &Asset, PathBuf)],
) -> PreparationRecord {
    let catalog = world.catalog();
    let profile = world.siril("exit 0").await;
    let name = catalog.view(run).await.unwrap().revision.unwrap().name;
    let folder = world.output.join("Other").join(&name);
    let direct = mode == InputMode::DirectSource;
    let entries = inputs
        .iter()
        .map(|(key, copy, file)| {
            let entry = folder.join("Lights").join(file.file_name().unwrap());
            NewPreparedEntry {
                member_key: Some(*key),
                asset_id: Some(copy.id),
                master_id: None,
                input: PreparedInput::Light,
                kind: if direct {
                    PreparedEntryKind::DirectSource
                } else {
                    PreparedEntryKind::Symlink
                },
                path: NativePath::from_path(if direct { file } else { &entry }),
                source: Some(NativePath::from_path(file)),
                size_bytes: copy.fingerprint.size_bytes,
                blocked: None,
            }
        })
        .collect();
    let started = catalog
        .start_preparation(&NewPreparation {
            view_id: run,
            n: 1,
            membership_revision: 1,
            profile_id: profile.id,
            mode,
            link: (!direct).then_some(LinkKind::Symlink),
            output: NativePath::from_path(&world.output),
            folder: NativePath::from_path(&folder),
            results_folder: NativePath::from_path(
                &world.output.join("Other").join(format!("{name} Results")),
            ),
            entries,
        })
        .await
        .unwrap();
    catalog.set_view_stage(run, RunStage::Prepare).await.unwrap();
    catalog.finish_preparation(started.revision.id, PreparationState::Prepared, None).await.unwrap()
}

/// Register an empty folder `name` beside the world's locations.
pub async fn register(world: &World, name: &str, role: LocationRole) -> Location {
    let root = world.temp.path().join(name);
    fs::create_dir_all(&root).unwrap();
    world.library.register_location(NativePath::from_path(&root), name.into(), role).await.unwrap()
}

/// A light's capture metadata, as the PREP world records its lights.
pub fn light_metadata(filter: &str, night: &str) -> CaptureMetadata {
    CaptureMetadata {
        image_type: Some("LIGHT".into()),
        filter: Some(filter.into()),
        exposure_seconds: Some(300.0),
        camera: Some("ASI2600MM".into()),
        gain: Some(100.0),
        offset: Some(50),
        width: Some(6248),
        height: Some(4176),
        binning_x: Some(1),
        binning_y: Some(1),
        set_temperature_c: Some(-10.0),
        date_local: Some(format!("{night}T22:00:00")),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        ..CaptureMetadata::default()
    }
}

/// One session per night and filter, keyed as the PREP world keys its own,
/// so a copy joins the session its original is in.
fn by_night(assets: &[Asset]) -> GroupingResult {
    let mut sessions: std::collections::BTreeMap<String, Vec<Uuid>> =
        std::collections::BTreeMap::new();
    for asset in assets {
        let m = &asset.effective;
        let night = m.date_local.as_deref().map(|date| date.get(..10).unwrap_or(date).to_owned());
        let key = format!(
            "capture-v1|type={}|night={}@date-loc-noon|filter={}|exposure_s={}|camera={}|scope={}",
            m.image_type.as_deref().unwrap_or("?").to_lowercase(),
            night.unwrap_or_default(),
            m.filter.as_deref().unwrap_or("?"),
            m.exposure_seconds.map(|v| v.to_string()).unwrap_or_default(),
            m.camera.as_deref().unwrap_or("?"),
            m.telescope.as_deref().unwrap_or("?"),
        );
        sessions.entry(key).or_default().push(asset.id);
    }
    GroupingResult {
        sessions: sessions
            .into_iter()
            .map(|(key, mut asset_ids)| {
                asset_ids.sort_unstable();
                SessionCandidate {
                    key: CaptureKey(key),
                    asset_ids,
                    provisional: Vec::new(),
                    date_basis: Some("date-loc-noon".into()),
                }
            })
            .collect(),
    }
}

/// Write each `(relative path, bytes, metadata)` below `location` and scan
/// the whole location once.
pub async fn scan(world: &World, location: &Location, files: &[(&str, Vec<u8>, CaptureMetadata)]) {
    let catalog = world.catalog();
    let root = location.path.to_path_buf().unwrap();
    let mut scanned = Vec::new();
    for (relative, bytes, metadata) in files {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, bytes).unwrap();
        scanned.push(ScanFile {
            relative_path: NativePath::from_path(Path::new(relative)),
            fingerprint: InventoryProbe.fingerprint(&path).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata.clone(),
        });
    }
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let identity = InventoryProbe.root_identity(location).unwrap();
    let count = scanned.len() as u64;
    let progress =
        ScanProgress { discovered: count, metadata_read: count, ..ScanProgress::default() };
    let batch =
        ScanBatch { files: scanned.clone(), issues: Vec::new(), progress: progress.clone() };
    catalog.apply_scan_batch(operation.id, &identity, &batch, by_night).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: identity,
        incomplete_scopes: Vec::new(),
        files: scanned,
        issues: Vec::new(),
        complete_scopes: vec![NativePath::UnixBytes(Vec::new())],
        progress,
        state: ScanState::Completed,
    };
    let finished = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| InventoryProbe.root_identity(location),
            by_night,
        )
        .await
        .unwrap();
    assert_eq!(finished.state, ScanState::Completed);
}

/// Hash `asset`'s bytes and bind the digest to its record (lazy byte proof).
pub async fn hashed(world: &World, asset: &Asset) -> Asset {
    world.catalog().verify_digest(asset.id, InventoryProbe).await.unwrap();
    world
        .catalog()
        .location_assets(asset.location_id)
        .await
        .unwrap()
        .into_iter()
        .find(|a| a.id == asset.id)
        .unwrap()
}
