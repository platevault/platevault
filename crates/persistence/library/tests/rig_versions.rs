// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Physical cameras and rig versions against a real catalog (astro-plan-wmfw6;
//! spec 064 LIB-FR-26, LIB-AC-27..29, 072 PLAN-EQ-FR-07/08, PLAN-EQ-AC-08..11;
//! D-W102, D-W104):
//! - cameras save together, keep their ids, and need unique aliases once two
//!   share a model; a model names a camera only while the rigs hold one;
//! - a rig's versions are immutable and dated; a session confirmed to a rig
//!   records the version its night falls in and keeps it through later,
//!   backdated and re-confirmed edits and through regroups;
//! - a remount is a new version with the same optics: flats change, the
//!   Project group does not;
//! - alias and "Don't use darks"/"Don't use bias" edits reassign nothing.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;
use std::path::Path;

use persistence_library::{Catalog, SourceProbe};
use platevault_model::{
    Asset, AssociationState, Camera, CameraBasis, CameraLink, CameraResolution, CaptureKey,
    CaptureMetadata, CorrectionInput, Equipment, GroupingResult, ImageFormat, Location,
    OpticsSignature, Provenance, RigVersion, RotatorPresence, ScanBatch, ScanFile, ScanObservation,
    ScanProgress, ScanState, Session, SessionCandidate,
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use support::{expected, expected_session, file_fingerprint, kind, root_scope, DiskProbe, Fixture};
use time::macros::date;
use time::Date;
use uuid::Uuid;

// ── Fixture ──────────────────────────────────────────────────────────────────

/// A frame on disk: its file name, IMAGETYP, FILTER and local capture night.
struct Frame {
    name: &'static str,
    image_type: &'static str,
    filter: &'static str,
    night: &'static str,
}

const fn light(name: &'static str, filter: &'static str, night: &'static str) -> Frame {
    Frame { name, image_type: "LIGHT", filter, night }
}

const fn dark(name: &'static str, night: &'static str) -> Frame {
    Frame { name, image_type: "DARK", filter: "", night }
}

fn metadata(frame: &Frame) -> CaptureMetadata {
    CaptureMetadata {
        image_type: Some(frame.image_type.into()),
        filter: (!frame.filter.is_empty()).then(|| frame.filter.into()),
        exposure_seconds: Some(300.0),
        camera: Some("ASI2600MM".into()),
        date_local: Some(format!("{}T23:00:00", frame.night)),
        ..CaptureMetadata::default()
    }
}

/// Grouping in the `capture-v1` key shape: frame type, observing night,
/// filter and camera. The night field is the one sessions record versions by.
fn night_group(assets: &[Asset]) -> GroupingResult {
    let mut sessions: BTreeMap<String, Vec<Uuid>> = BTreeMap::new();
    for asset in assets {
        let meta = &asset.effective;
        let night = meta.date_local.as_deref().map_or_else(
            || "night?".to_owned(),
            |text| format!("night={}@date-loc-noon", &text[..10]),
        );
        let key = format!(
            "capture-v1|type={}|{night}|filter={}|camera={}",
            meta.image_type.as_deref().unwrap_or_default(),
            meta.filter.as_deref().unwrap_or_default(),
            meta.camera.as_deref().unwrap_or_default(),
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
                    framing: None,
                }
            })
            .collect(),
    }
}

struct Rigs {
    fx: Fixture,
    catalog: Catalog,
    location: Location,
}

impl Rigs {
    /// A catalog holding `frames`, scanned once with [`night_group`].
    async fn new(frames: &[Frame]) -> Self {
        let fx = Fixture::new();
        for frame in frames {
            fx.write(frame.name, frame.name.as_bytes());
        }
        let catalog = Catalog::open(&fx.db).await.unwrap();
        let location = catalog.register_location(&fx.registration()).await.unwrap();
        let files: Vec<ScanFile> = frames
            .iter()
            .map(|frame| ScanFile {
                relative_path: platevault_model::NativePath::from_path(Path::new(frame.name)),
                fingerprint: file_fingerprint(&fx.root.join(frame.name)).unwrap(),
                format: ImageFormat::Fits,
                metadata: metadata(frame),
            })
            .collect();
        let operation = catalog.begin_scan(location.id, None).await.unwrap();
        let root = DiskProbe.root_identity(&location).unwrap();
        let progress = ScanProgress {
            discovered: files.len() as u64,
            metadata_read: files.len() as u64,
            ..ScanProgress::default()
        };
        let batch =
            ScanBatch { files: files.clone(), issues: Vec::new(), progress: progress.clone() };
        catalog.apply_scan_batch(operation.id, &root, &batch, night_group).await.unwrap();
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
                night_group,
            )
            .await
            .unwrap();
        Self { fx, catalog, location }
    }

    /// The current session of one frame type, filter and night; listed
    /// sessions are lights only, so this reads the catalog file.
    async fn session(&self, image_type: &str, filter: &str, night: &str) -> Session {
        let wanted = format!("type={image_type}|night={night}@date-loc-noon|filter={filter}|");
        let mut raw = self.raw().await;
        let id: String = sqlx::query_scalar(
            "SELECT id FROM sessions WHERE superseded_by IS NULL AND instr(capture_key, ?1) > 0",
        )
        .bind(&wanted)
        .fetch_one(&mut raw)
        .await
        .unwrap_or_else(|error| panic!("no session {wanted}: {error}"));
        raw.close().await.unwrap();
        self.catalog.session(id.parse().unwrap()).await.unwrap().summary.session
    }

    async fn rig(&self, name: &str) -> Equipment {
        let equipment = Equipment {
            id: Uuid::new_v4(),
            name: name.into(),
            camera: Some("ASI2600MM".into()),
            telescope: None,
            focal_length_mm: Some(250.0),
            pixel_size_um: None,
            sensor_width_px: None,
            sensor_height_px: None,
            color_kind: None,
            decision_revision: 0,
            state: AssociationState::Confirmed,
            provenance: Provenance::User,
        };
        self.catalog.save_equipment(&equipment, None).await.unwrap()
    }

    async fn camera(&self, model: &str, alias: Option<&str>) -> Camera {
        let camera = Camera {
            id: Uuid::new_v4(),
            model: model.into(),
            alias: alias.map(str::to_owned),
            no_darks: false,
            no_bias: false,
            revision: 0,
        };
        self.catalog.save_cameras(&[camera]).await.unwrap().remove(0)
    }

    async fn version(
        &self,
        rig: &Equipment,
        valid_from: Date,
        optics: OpticsSignature,
    ) -> RigVersion {
        let version = RigVersion {
            id: Uuid::new_v4(),
            rig_id: rig.id,
            valid_from,
            optics,
            rotator: RotatorPresence::Absent,
        };
        let saved = self.catalog.add_rig_version(&version).await.unwrap();
        assert_eq!(saved, version);
        saved
    }

    /// Confirm `rig` for the current state of `session`.
    async fn confirm(&self, session: &Session, rig: &Equipment) {
        let current = self.catalog.session(session.id).await.unwrap().summary.session;
        self.catalog.confirm_equipment(&[expected_session(&current)], rig.id).await.unwrap();
    }

    async fn recorded(&self, session: &Session) -> Option<Uuid> {
        self.catalog.session_rig_version(session.id).await.unwrap().map(|version| version.id)
    }

    async fn raw(&self) -> SqliteConnection {
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&self.fx.db))
            .await
            .unwrap()
    }
}

fn optics(camera: &Camera, focal_mm: f64, reducer: Option<&str>) -> OpticsSignature {
    OpticsSignature::new(Some(camera.id), Some(focal_mm), reducer).unwrap()
}

/// Each calibration kind's state and the session's generation, by kind.
async fn calibration_state(
    raw: &mut SqliteConnection,
    session: Uuid,
) -> Vec<(String, String, i64)> {
    sqlx::query_as(
        "SELECT k.kind, k.state, c.generation FROM session_calibration_kinds k \
         JOIN session_calibration c ON c.session_id = k.session_id \
         WHERE k.session_id = ?1 ORDER BY k.kind",
    )
    .bind(session.to_string())
    .fetch_all(&mut *raw)
    .await
    .unwrap()
}

const OCT_1: &str = "2026-10-01";
const OCT_5: &str = "2026-10-05";
const OCT_9: &str = "2026-10-09";

fn three_nights() -> [Frame; 3] {
    [
        light("Ha_1001.fits", "Ha", OCT_1),
        light("Ha_1005.fits", "Ha", OCT_5),
        light("Ha_1009.fits", "Ha", OCT_9),
    ]
}

// ── Rig versions ─────────────────────────────────────────────────────────────

/// PLAN-EQ-AC-08/09, LIB-AC-29: sessions record the version their night falls
/// in, and neither a later nor a backdated version, nor confirming the rig
/// again, rebinds a recorded session.
#[tokio::test]
async fn a_session_keeps_the_version_it_was_captured_with() {
    let fx = Rigs::new(&three_nights()).await;
    let camera = fx.camera("ASI2600MM", None).await;
    let redcat = fx.rig("RedCat").await;
    let first = fx.version(&redcat, date!(2026 - 10 - 01), optics(&camera, 250.0, None)).await;
    let oct_1 = fx.session("LIGHT", "Ha", OCT_1).await;
    let oct_5 = fx.session("LIGHT", "Ha", OCT_5).await;
    let oct_9 = fx.session("LIGHT", "Ha", OCT_9).await;
    assert_eq!(fx.recorded(&oct_1).await, None, "no version before the rig is confirmed");
    fx.confirm(&oct_1, &redcat).await;
    fx.confirm(&oct_5, &redcat).await;
    assert_eq!(fx.recorded(&oct_1).await, Some(first.id));
    assert_eq!(fx.recorded(&oct_5).await, Some(first.id));

    // Edited from 8 Oct: the 9 Oct session records the new version.
    let second =
        fx.version(&redcat, date!(2026 - 10 - 08), optics(&camera, 250.0, Some("0.8x"))).await;
    assert_eq!(fx.recorded(&oct_5).await, Some(first.id), "a later version never rebinds");
    fx.confirm(&oct_9, &redcat).await;
    assert_eq!(fx.recorded(&oct_9).await, Some(second.id));

    // Provisional (PLAN-EQ-AC-09): a version dated before a recorded session
    // leaves it alone, and confirming the same rig again keeps it too.
    let backdated = fx.version(&redcat, date!(2026 - 10 - 03), optics(&camera, 250.0, None)).await;
    assert_eq!(fx.recorded(&oct_5).await, Some(first.id), "a backdated version never rebinds");
    fx.confirm(&oct_5, &redcat).await;
    assert_eq!(
        fx.recorded(&oct_5).await,
        Some(first.id),
        "re-confirming the rig keeps its version"
    );

    // The rig lists its versions by start date; a rename adds none.
    let listed: Vec<Uuid> = fx
        .catalog
        .rig_versions(redcat.id)
        .await
        .unwrap()
        .iter()
        .map(|version| version.id)
        .collect();
    assert_eq!(listed, [first.id, backdated.id, second.id]);
    let renamed = Equipment { name: "RedCat 51".into(), ..redcat.clone() };
    fx.catalog.save_equipment(&renamed, Some(redcat.decision_revision)).await.unwrap();
    assert_eq!(
        fx.catalog.rig_versions(redcat.id).await.unwrap().len(),
        3,
        "a rename adds no version"
    );
    assert_eq!(fx.recorded(&oct_9).await, Some(second.id));
}

#[tokio::test]
async fn a_rig_version_is_immutable_and_dated_once() {
    let fx = Rigs::new(&three_nights()).await;
    let camera = fx.camera("ASI2600MM", None).await;
    let redcat = fx.rig("RedCat").await;
    let first = fx.version(&redcat, date!(2026 - 10 - 01), optics(&camera, 250.0, None)).await;

    assert_eq!(fx.catalog.add_rig_version(&first).await.unwrap(), first, "a retry returns it");
    let same_date = RigVersion { id: Uuid::new_v4(), ..first.clone() };
    let error = fx.catalog.add_rig_version(&same_date).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input");
    assert!(error.to_string().contains("RedCat already has a version from 2026-10-01"), "{error}");
    let changed = RigVersion { rotator: RotatorPresence::Present, ..first.clone() };
    let error = fx.catalog.add_rig_version(&changed).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "a saved version is never rewritten: {error}");

    let unknown_camera = RigVersion {
        id: Uuid::new_v4(),
        valid_from: date!(2026 - 11 - 01),
        optics: OpticsSignature::new(Some(Uuid::new_v4()), Some(250.0), None).unwrap(),
        ..first.clone()
    };
    assert_eq!(kind(&fx.catalog.add_rig_version(&unknown_camera).await.unwrap_err()), "not_found");
    let unknown_rig = RigVersion { id: Uuid::new_v4(), rig_id: Uuid::new_v4(), ..first.clone() };
    assert_eq!(kind(&fx.catalog.add_rig_version(&unknown_rig).await.unwrap_err()), "not_found");
    let bad_optics = RigVersion {
        id: Uuid::new_v4(),
        valid_from: date!(2026 - 11 - 02),
        optics: OpticsSignature {
            camera_id: None,
            focal_length_mm: Some("-1".into()),
            reducer: None,
        },
        ..first.clone()
    };
    assert_eq!(kind(&fx.catalog.add_rig_version(&bad_optics).await.unwrap_err()), "invalid_input");

    let versions = fx.catalog.rig_versions(redcat.id).await.unwrap();
    assert_eq!(versions, [first], "refused versions leave the list as it was");
    assert_eq!(kind(&fx.catalog.rig_versions(Uuid::new_v4()).await.unwrap_err()), "not_found");
}

/// PLAN-EQ-FR-07, PRJ-AC-41: a remount is a new version with the same
/// optics, so flats of the earlier version no longer match while the
/// Project group stays; a reducer change starts a new group.
#[tokio::test]
async fn a_remount_is_a_new_version_but_not_a_new_group() {
    let fx = Rigs::new(&three_nights()).await;
    let camera = fx.camera("ASI2600MM", None).await;
    let redcat = fx.rig("RedCat").await;
    let first = fx.version(&redcat, date!(2026 - 10 - 01), optics(&camera, 250.0, None)).await;
    let remount = fx.version(&redcat, date!(2026 - 10 - 04), optics(&camera, 250.0, None)).await;
    let reducer =
        fx.version(&redcat, date!(2026 - 10 - 08), optics(&camera, 250.0, Some(" 0.8x "))).await;
    let oct_1 = fx.session("LIGHT", "Ha", OCT_1).await;
    let oct_5 = fx.session("LIGHT", "Ha", OCT_5).await;
    let oct_9 = fx.session("LIGHT", "Ha", OCT_9).await;
    for session in [&oct_1, &oct_5, &oct_9] {
        fx.confirm(session, &redcat).await;
    }
    let read = |session: &Session| fx.catalog.session_rig_version(session.id);
    let v1 = read(&oct_1).await.unwrap().unwrap();
    let v5 = read(&oct_5).await.unwrap().unwrap();
    let v9 = read(&oct_9).await.unwrap().unwrap();
    assert_eq!((v1.id, v5.id, v9.id), (first.id, remount.id, reducer.id));
    assert_ne!(v1.id, v5.id, "the remount is a version of its own: earlier flats stop matching");
    assert!(!v5.starts_new_group(&v1), "the same optics keep the Project group");
    assert!(v9.starts_new_group(&v5), "a reducer changes the optics");
    assert_eq!(v9.optics.reducer.as_deref(), Some("0.8x"), "stored canonical");
    assert_eq!(v1.optics, optics(&camera, 250.0, None), "focal length 250 reads back as saved");
}

/// Confirming another rig takes that rig's version; a rig with no version
/// for the session leaves it with none rather than another rig's.
#[tokio::test]
async fn confirming_another_rig_replaces_the_version() {
    let fx = Rigs::new(&three_nights()).await;
    let camera = fx.camera("ASI2600MM", None).await;
    let redcat = fx.rig("RedCat").await;
    let esprit = fx.rig("Esprit").await;
    let bare = fx.rig("Bare").await;
    let on_redcat = fx.version(&redcat, date!(2026 - 10 - 01), optics(&camera, 250.0, None)).await;
    let on_esprit = fx.version(&esprit, date!(2026 - 10 - 01), optics(&camera, 550.0, None)).await;
    let oct_5 = fx.session("LIGHT", "Ha", OCT_5).await;
    fx.confirm(&oct_5, &redcat).await;
    assert_eq!(fx.recorded(&oct_5).await, Some(on_redcat.id));
    fx.confirm(&oct_5, &esprit).await;
    assert_eq!(fx.recorded(&oct_5).await, Some(on_esprit.id));
    fx.confirm(&oct_5, &bare).await;
    assert_eq!(fx.recorded(&oct_5).await, None, "never another rig's version");
}

/// A session confirmed while its rig had no version records the version its
/// night falls in once the first one is added; a later version changes it
/// no more.
#[tokio::test]
async fn a_rigs_first_version_fills_sessions_confirmed_before_it() {
    let fx = Rigs::new(&three_nights()).await;
    let camera = fx.camera("ASI2600MM", None).await;
    let redcat = fx.rig("RedCat").await;
    let oct_1 = fx.session("LIGHT", "Ha", OCT_1).await;
    let oct_9 = fx.session("LIGHT", "Ha", OCT_9).await;
    fx.confirm(&oct_1, &redcat).await;
    fx.confirm(&oct_9, &redcat).await;
    assert_eq!(fx.recorded(&oct_1).await, None);
    let first = fx.version(&redcat, date!(2026 - 10 - 08), optics(&camera, 250.0, None)).await;
    assert_eq!(
        fx.recorded(&oct_1).await,
        Some(first.id),
        "a night before the first version reads the first"
    );
    assert_eq!(fx.recorded(&oct_9).await, Some(first.id));
    fx.version(&redcat, date!(2026 - 10 - 09), optics(&camera, 250.0, Some("0.8x"))).await;
    assert_eq!(fx.recorded(&oct_9).await, Some(first.id), "recorded sessions never rebind");
}

/// A regroup's successors keep the version their frames' session recorded,
/// even where a backdated version now covers their night; successors of
/// sessions that disagree read the version by night.
#[tokio::test]
async fn regroup_successors_keep_their_frames_version() {
    let frames = [
        light("Ha_a.fits", "Ha", OCT_5),
        light("Ha_b.fits", "Ha", OCT_5),
        light("OIII_a.fits", "OIII", OCT_5),
    ];
    let fx = Rigs::new(&frames).await;
    let camera = fx.camera("ASI2600MM", None).await;
    let redcat = fx.rig("RedCat").await;
    let first = fx.version(&redcat, date!(2026 - 10 - 01), optics(&camera, 250.0, None)).await;
    let ha = fx.session("LIGHT", "Ha", OCT_5).await;
    fx.confirm(&ha, &redcat).await;
    let backdated = fx.version(&redcat, date!(2026 - 10 - 03), optics(&camera, 250.0, None)).await;
    let oiii = fx.session("LIGHT", "OIII", OCT_5).await;
    fx.confirm(&oiii, &redcat).await;
    assert_eq!(fx.recorded(&ha).await, Some(first.id));
    assert_eq!(fx.recorded(&oiii).await, Some(backdated.id));

    // Split the Ha session: both successors inherit RedCat and version 1.
    let assets = fx.catalog.location_assets(fx.location.id).await.unwrap();
    let moved = support::by_name(&assets, "Ha_b.fits").clone();
    let correction =
        vec![CorrectionInput { asset_id: moved.id, field: "filter".into(), value: "Hb".into() }];
    let outcome = fx
        .catalog
        .apply_correction_and_regroup(&[expected(&moved)], &correction, night_group)
        .await
        .unwrap();
    let lineage = outcome.lineage.expect("the split supersedes the Ha session");
    assert_eq!(lineage.successors.len(), 2);
    for successor in &lineage.successors {
        let version = fx.catalog.session_rig_version(*successor).await.unwrap();
        assert_eq!(version.map(|version| version.id), Some(first.id), "successor {successor}");
    }

    // Merge the remaining Ha frame with the OIII frame: their sessions
    // recorded different versions, so the merged session reads its night's.
    let assets = fx.catalog.location_assets(fx.location.id).await.unwrap();
    let moved = support::by_name(&assets, "OIII_a.fits").clone();
    let correction =
        vec![CorrectionInput { asset_id: moved.id, field: "filter".into(), value: "Ha".into() }];
    let outcome = fx
        .catalog
        .apply_correction_and_regroup(&[expected(&moved)], &correction, night_group)
        .await
        .unwrap();
    let merged = outcome.lineage.expect("the merge supersedes both").successors;
    assert_eq!(merged.len(), 1);
    let version = fx.catalog.session_rig_version(merged[0]).await.unwrap();
    assert_eq!(version.map(|version| version.id), Some(backdated.id));
}

// ── Cameras ──────────────────────────────────────────────────────────────────

/// PLAN-EQ-AC-10: a second camera of a model needs an alias on both, unique
/// across cameras; saves are all or nothing and compare revisions.
#[tokio::test]
async fn cameras_of_one_model_need_unique_aliases() {
    let fx = Rigs::new(&three_nights()).await;
    let a = fx.camera(" ASI2600MM ", None).await;
    assert_eq!((a.model.as_str(), a.revision), ("ASI2600MM", 1), "trimmed and at revision 1");
    assert_eq!(
        fx.catalog.camera_resolution("asi2600mm").await.unwrap(),
        CameraResolution::Model { camera_id: a.id }
    );
    let new = |alias: Option<&str>| Camera {
        id: Uuid::new_v4(),
        model: "ASI2600MM".into(),
        alias: alias.map(str::to_owned),
        no_darks: false,
        no_bias: false,
        revision: 0,
    };

    let unnamed = new(None);
    let error = fx.catalog.save_cameras(std::slice::from_ref(&unnamed)).await.unwrap_err();
    assert!(error.to_string().contains("each needs a unique alias"), "{error}");
    assert_eq!(error.field().map(platevault_model::FieldPath::as_str), Some("0.alias"));
    let b = new(Some("2600 B"));
    let error = fx.catalog.save_cameras(std::slice::from_ref(&b)).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input", "camera A still has no alias: {error}");
    assert_eq!(error.field().map(platevault_model::FieldPath::as_str), Some("0.alias"));
    assert_eq!(error.response(None, None).identity, Some(b.id));
    let mut unrelated = new(None);
    unrelated.model = "ASI533MC".into();
    let batch_b = Camera { id: Uuid::new_v4(), ..b.clone() };
    let error = fx.catalog.save_cameras(&[unrelated, batch_b.clone()]).await.unwrap_err();
    assert_eq!(error.field().map(platevault_model::FieldPath::as_str), Some("1.alias"));
    assert_eq!(error.response(None, None).identity, Some(batch_b.id));
    let a_named = Camera { alias: Some("2600 A".into()), ..a.clone() };
    let clash = Camera { alias: Some(" 2600 a ".into()), ..b.clone() };
    let error = fx.catalog.save_cameras(&[a_named.clone(), clash]).await.unwrap_err();
    assert!(error.to_string().contains("share the alias"), "{error}");
    assert_eq!(error.field().map(platevault_model::FieldPath::as_str), Some("1.alias"));
    let listed = fx.catalog.cameras().await.unwrap();
    assert_eq!(listed, std::slice::from_ref(&a), "refused saves change nothing");

    let error = fx.catalog.save_cameras(&[a.clone(), b.clone()]).await.unwrap_err();
    assert_eq!(error.field().map(platevault_model::FieldPath::as_str), Some("0.alias"));
    assert_eq!(error.response(None, None).identity, Some(a.id));
    let saved = fx.catalog.save_cameras(&[a_named.clone(), b.clone()]).await.unwrap();
    assert_eq!(saved[0].revision, 2);
    assert_eq!(saved[1].revision, 1);
    let mut ids = vec![a.id, b.id];
    ids.sort_unstable();
    assert_eq!(
        fx.catalog.camera_resolution("ASI2600MM").await.unwrap(),
        CameraResolution::Choose { camera_ids: ids }
    );

    // Swapping the aliases in one save keeps both ids.
    let swap = [
        Camera { alias: Some("2600 B".into()), ..saved[0].clone() },
        Camera { alias: Some("2600 A".into()), ..saved[1].clone() },
    ];
    let swapped = fx.catalog.save_cameras(&swap).await.unwrap();
    assert_eq!(fx.catalog.camera(a.id).await.unwrap().alias.as_deref(), Some("2600 B"));
    assert_eq!(fx.catalog.camera(b.id).await.unwrap(), swapped[1]);

    let stale = fx.catalog.save_cameras(&[saved[0].clone()]).await.unwrap_err();
    assert_eq!(kind(&stale), "conflict");
    let taken = fx.catalog.save_cameras(&[Camera { revision: 0, ..swapped[0].clone() }]).await;
    assert_eq!(kind(&taken.unwrap_err()), "conflict", "a new camera cannot take a saved id");
    let unknown = Camera { revision: 4, ..new(Some("2600 C")) };
    assert_eq!(kind(&fx.catalog.save_cameras(&[unknown]).await.unwrap_err()), "not_found");
    let twice = new(Some("2600 C"));
    let error = fx.catalog.save_cameras(&[twice.clone(), twice]).await.unwrap_err();
    assert_eq!(kind(&error), "invalid_input");
    assert_eq!(kind(&fx.catalog.save_cameras(&[]).await.unwrap_err()), "invalid_input");
}

#[tokio::test]
async fn saving_one_camera_creates_edits_and_rejects_stale_revisions() {
    let fx = Rigs::new(&three_nights()).await;
    let created = fx.camera(" ASI533MC ", None).await;
    assert_eq!(created.model, "ASI533MC");
    assert_eq!(created.revision, 1);

    let edited = Camera { alias: Some("Main camera".into()), no_darks: true, ..created.clone() };
    let saved = fx.catalog.save_cameras(&[edited]).await.unwrap().remove(0);
    assert_eq!(saved.revision, 2);
    assert_eq!(saved.alias.as_deref(), Some("Main camera"));
    assert!(saved.no_darks);

    let stale = Camera { model: "Changed model".into(), ..created.clone() };
    assert_eq!(kind(&fx.catalog.save_cameras(&[stale]).await.unwrap_err()), "conflict");
    assert_eq!(fx.catalog.camera(created.id).await.unwrap(), saved);

    let invalid = Camera { model: "  ".into(), revision: 0, ..created };
    assert_eq!(kind(&fx.catalog.save_cameras(&[invalid]).await.unwrap_err()), "invalid_input");
}

/// LIB-AC-28, Q5: a dark session links by model while the rigs hold one
/// camera of it and keeps that link after a second camera arrives; a new
/// one then waits for the user's choice, which is the explicit match.
#[tokio::test]
async fn a_second_camera_never_reinterprets_a_link() {
    let frames = [dark("Dark_1001.fits", OCT_1), dark("Dark_1009.fits", OCT_9)];
    let fx = Rigs::new(&frames).await;
    let early = fx.session("DARK", "", OCT_1).await;
    let late = fx.session("DARK", "", OCT_9).await;
    assert_eq!(fx.catalog.link_session_camera(early.id).await.unwrap(), None, "no camera yet");

    let a = fx.camera("ASI2600MM", None).await;
    let by_model = CameraLink { camera_id: a.id, basis: CameraBasis::Model };
    assert_eq!(fx.catalog.link_session_camera(early.id).await.unwrap(), Some(by_model));
    assert_eq!(fx.catalog.session_camera(early.id).await.unwrap(), Some(a.clone()));

    let a_named = Camera { alias: Some("2600 A".into()), ..a.clone() };
    let b = Camera {
        id: Uuid::new_v4(),
        model: "ASI2600MM".into(),
        alias: Some("2600 B".into()),
        no_darks: false,
        no_bias: false,
        revision: 0,
    };
    let saved = fx.catalog.save_cameras(&[a_named, b.clone()]).await.unwrap();
    assert_eq!(
        fx.catalog.link_session_camera(early.id).await.unwrap(),
        Some(by_model),
        "the earlier link keeps camera A"
    );
    assert_eq!(fx.catalog.session_camera(early.id).await.unwrap(), Some(saved[0].clone()));
    assert_eq!(
        fx.catalog.link_session_camera(late.id).await.unwrap(),
        None,
        "with two cameras of the model the import asks"
    );
    assert_eq!(fx.catalog.session_camera(late.id).await.unwrap(), None);

    let fresh = fx.catalog.confirm_session_camera(&[expected_session(&late)], b.id).await.unwrap();
    assert_eq!(fresh[0].decision_revision, late.decision_revision + 1);
    assert_eq!(fx.catalog.session_camera(late.id).await.unwrap(), Some(saved[1].clone()));
    let stale = fx.catalog.confirm_session_camera(&[expected_session(&late)], a.id).await;
    assert_eq!(kind(&stale.unwrap_err()), "conflict");
    let unknown = fx.catalog.confirm_session_camera(&fresh, Uuid::new_v4()).await;
    assert_eq!(kind(&unknown.unwrap_err()), "not_found");
}

/// A split dark session's successors keep the camera the user confirmed.
#[tokio::test]
async fn regroup_successors_keep_a_confirmed_camera() {
    let frames = [dark("Dark_a.fits", OCT_1), dark("Dark_b.fits", OCT_1)];
    let fx = Rigs::new(&frames).await;
    let session = fx.session("DARK", "", OCT_1).await;
    let a = fx.camera("ASI2600MM", Some("2600 A")).await;
    fx.camera("ASI2600MM", Some("2600 B")).await;
    fx.catalog.confirm_session_camera(&[expected_session(&session)], a.id).await.unwrap();

    let assets = fx.catalog.location_assets(fx.location.id).await.unwrap();
    let moved = support::by_name(&assets, "Dark_b.fits").clone();
    let correction =
        vec![CorrectionInput { asset_id: moved.id, field: "filter".into(), value: "L".into() }];
    let outcome = fx
        .catalog
        .apply_correction_and_regroup(&[expected(&moved)], &correction, night_group)
        .await
        .unwrap();
    let successors = outcome.lineage.expect("the split supersedes the session").successors;
    assert_eq!(successors.len(), 2);
    for successor in successors {
        assert_eq!(fx.catalog.session_camera(successor).await.unwrap().map(|c| c.id), Some(a.id));
    }
}

/// PLAN-EQ-AC-11, LIB-AC-27: a light session's camera is its rig version's,
/// carrying the camera's current defaults; editing a default or an alias
/// writes no calibration state and no link.
#[tokio::test]
async fn camera_defaults_and_aliases_reassign_nothing() {
    let fx = Rigs::new(&three_nights()).await;
    let camera = fx.camera("ASI533MC", None).await;
    let esprit = fx.rig("Esprit").await;
    let version = fx.version(&esprit, date!(2026 - 10 - 01), optics(&camera, 550.0, None)).await;
    let oct_5 = fx.session("LIGHT", "Ha", OCT_5).await;
    fx.confirm(&oct_5, &esprit).await;
    assert_eq!(fx.catalog.session_camera(oct_5.id).await.unwrap(), Some(camera.clone()));

    // Ingestion recorded the light session's calibration (CAL).
    let mut raw = fx.raw().await;
    let before = calibration_state(&mut raw, oct_5.id).await;
    assert_eq!(before.len(), 3, "every kind has a state");

    let edited = Camera { no_darks: true, alias: Some("Esprit cam".into()), ..camera.clone() };
    let saved = fx.catalog.save_cameras(&[edited]).await.unwrap().remove(0);
    assert!(saved.no_darks && !saved.no_bias);
    assert_eq!(
        calibration_state(&mut raw, oct_5.id).await,
        before,
        "no session is settled in bulk"
    );
    assert_eq!(fx.catalog.session_camera(oct_5.id).await.unwrap(), Some(saved), "same camera id");
    assert_eq!(fx.recorded(&oct_5).await, Some(version.id));
    let links: i64 = sqlx::query_scalar("SELECT count(*) FROM session_cameras")
        .fetch_one(&mut raw)
        .await
        .unwrap();
    assert_eq!(links, 0, "a light session's camera comes from its rig version");
    raw.close().await.unwrap();
}
