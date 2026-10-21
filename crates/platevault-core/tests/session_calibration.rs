// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Session calibration on the composed library (spec 064 LIB-FR-17,
//! LIB-FR-23 to LIB-FR-26; 068 CAL-FR-02, CAL-FR-05, CAL-FR-08, CAL-FR-16/17,
//! CAL-FR-19 to CAL-FR-22; D-W101 to D-W106, D-W113): real files, the real
//! calibration rules and the real disk probe. Ingestion records a light
//! session's calibration with matching pending; matching after the commit
//! pins what passes every check, suggests the rest and hashes what it binds;
//! a rig confirmation and calibration arriving later match again, filling
//! only kinds still waiting; a restart finishes what was left pending; the
//! user confirms, says No or reassigns against the generation they saw; a
//! changed pinned file keeps its pin and waits in Needs calibration.

#[path = "support/apply.rs"]
mod apply_support;
mod support;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use persistence_library::{InputQuery, SessionQuery, SourceProbe};
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::*;
use time::macros::date;
use uuid::Uuid;

const LIGHTS: [&str; 2] = ["2026-10-01/Ha_001.fits", "2026-10-01/Ha_002.fits"];
const FLATS: [&str; 2] = ["flats/2026-10-01/Flat_Ha_001.fits", "flats/2026-10-01/Flat_Ha_002.fits"];
const DARKS: [&str; 2] =
    ["darks/2026-09-20/Dark_300s_001.fits", "darks/2026-09-20/Dark_300s_002.fits"];
const CLOSER_DARKS: [&str; 2] =
    ["darks/2026-09-30/Dark_300s_001.fits", "darks/2026-09-30/Dark_300s_002.fits"];
const BIAS: [&str; 2] = ["bias/2026-09-20/Bias_001.fits", "bias/2026-09-20/Bias_002.fits"];

/// ASI2600MM, gain 100, offset 50, 6248 x 4176, binning 1, -10 C, on the
/// `RedCat` 51 at 250 mm and ROTATANG 10°, on the night of `night`.
fn meta(image_type: &str, filter: Option<&str>, exposure: f64, night: &str) -> CaptureMetadata {
    CaptureMetadata {
        image_type: Some(image_type.into()),
        filter: filter.map(str::to_owned),
        exposure_seconds: Some(exposure),
        camera: Some("ASI2600MM".into()),
        gain: Some(100.0),
        offset: Some(50),
        width: Some(6248),
        height: Some(4176),
        binning_x: Some(1),
        binning_y: Some(1),
        set_temperature_c: Some(-10.0),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        mechanical_rotation_deg: Some(10.0),
        date_local: Some(format!("{night}T22:00:00")),
        ..CaptureMetadata::default()
    }
}

fn lights() -> Vec<(String, CaptureMetadata)> {
    LIGHTS
        .iter()
        .map(|path| ((*path).into(), meta("LIGHT", Some("Ha"), 300.0, "2026-10-01")))
        .collect()
}

fn frames(
    paths: &[&str],
    image_type: &str,
    filter: Option<&str>,
    exposure: f64,
    night: &str,
) -> Vec<(String, CaptureMetadata)> {
    paths.iter().map(|path| ((*path).into(), meta(image_type, filter, exposure, night))).collect()
}

fn calibration() -> Vec<(String, CaptureMetadata)> {
    let mut all = frames(&FLATS, "FLAT", Some("Ha"), 2.0, "2026-10-01");
    all.extend(frames(&DARKS, "DARK", None, 300.0, "2026-09-20"));
    all.extend(frames(&BIAS, "BIAS", None, 0.001, "2026-09-20"));
    all
}

/// A `capture-v1`-shaped grouping by frame type, night, filter, exposure and
/// camera, so each night of the same settings is its own session.
fn group_by_night(assets: &[Asset]) -> GroupingResult {
    let mut sessions: std::collections::BTreeMap<String, Vec<Uuid>> =
        std::collections::BTreeMap::new();
    for asset in assets {
        let m = &asset.effective;
        let night = m.date_local.as_deref().map(|date| date.get(..10).unwrap_or(date).to_owned());
        let key = format!(
            "capture-v1|type={}|night={}@date-loc-noon|filter={}|exposure_s={}|camera={}",
            m.image_type.as_deref().unwrap_or("?").to_lowercase(),
            night.unwrap_or_default(),
            m.filter.as_deref().unwrap_or("?"),
            m.exposure_seconds.map(|v| v.to_string()).unwrap_or_default(),
            m.camera.as_deref().unwrap_or("?"),
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

/// Scan the whole location once with the files as they are on disk. The
/// catalog's scan writes, the library's matching does not run: it is the
/// state a commit leaves before matching.
async fn index(
    library: &Library,
    location: &Location,
    root: &Path,
    frames: &[(String, CaptureMetadata)],
) {
    let catalog = library.catalog();
    let mut files = Vec::new();
    for (relative, metadata) in frames {
        files.push(ScanFile {
            relative_path: NativePath::from_path(Path::new(relative)),
            fingerprint: InventoryProbe::default().fingerprint(&root.join(relative)).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata.clone(),
        });
    }
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let identity = InventoryProbe::default().root_identity(location).unwrap();
    let count = files.len() as u64;
    let progress =
        ScanProgress { discovered: count, metadata_read: count, ..ScanProgress::default() };
    let batch = ScanBatch { files: files.clone(), issues: Vec::new(), progress: progress.clone() };
    catalog.apply_scan_batch(operation.id, &identity, &batch, group_by_night).await.unwrap();
    let observation = ScanObservation {
        location_id: location.id,
        root_identity: identity,
        incomplete_scopes: Vec::new(),
        files,
        issues: Vec::new(),
        complete_scopes: vec![NativePath::UnixBytes(Vec::new())],
        progress,
        state: ScanState::Partial,
    };
    catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| InventoryProbe::default().root_identity(location),
            group_by_night,
        )
        .await
        .unwrap();
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

fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

struct World {
    _temp: tempfile::TempDir,
    db: PathBuf,
    library: Arc<Library>,
    captures: (Location, PathBuf),
    calibration: (Location, PathBuf),
    rig: Equipment,
}

/// One ASI2600MM camera, the `RedCat` rig with a version from 1 Jan 2026 that
/// has a rotator, and empty Captures and Calibration locations.
async fn world(no_darks: bool) -> World {
    let temp = tempfile::tempdir().unwrap();
    let db = temp.path().join("library.sqlite");
    let library = Library::open(&db, None).await.unwrap();
    let mut locations = Vec::new();
    for (name, role) in [
        ("Astro-T7/Captures", LocationRole::Captures),
        ("Astro-T7/Calibration", LocationRole::Calibration),
    ] {
        let root = temp.path().join(name);
        std::fs::create_dir_all(&root).unwrap();
        let root = std::fs::canonicalize(root).unwrap();
        let location = library
            .register_location(NativePath::from_path(&root), name.into(), role)
            .await
            .unwrap();
        locations.push((location, root));
    }
    let catalog = library.catalog();
    let camera = Camera {
        id: Uuid::new_v4(),
        model: "ASI2600MM".into(),
        alias: None,
        no_darks,
        no_bias: false,
        revision: 0,
    };
    let camera = catalog.save_cameras(&[camera]).await.unwrap().remove(0);
    let rig = catalog.save_equipment(&rig(), None).await.unwrap();
    catalog
        .add_rig_version(&RigVersion {
            id: Uuid::new_v4(),
            rig_id: rig.id,
            valid_from: date!(2026 - 01 - 01),
            optics: OpticsSignature::new(Some(camera.id), Some(250.0), None).unwrap(),
            rotator: RotatorPresence::Present,
        })
        .await
        .unwrap();
    let calibration = locations.pop().unwrap();
    let captures = locations.pop().unwrap();
    World { _temp: temp, db, library, captures, calibration, rig }
}

impl World {
    fn catalog(&self) -> &persistence_library::Catalog {
        self.library.catalog()
    }

    /// Write each file with bytes unique to its path, then index them.
    async fn ingest(&self, calibration: bool, frames: &[(String, CaptureMetadata)]) {
        let (location, root) = if calibration { &self.calibration } else { &self.captures };
        for (relative, _) in frames {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, format!("{relative}{}", " ".repeat(64))).unwrap();
        }
        index(&self.library, location, root, frames).await;
    }

    async fn asset(&self, calibration: bool, path: &str) -> Asset {
        let location = if calibration { &self.calibration.0 } else { &self.captures.0 };
        self.catalog()
            .location_assets(location.id)
            .await
            .unwrap()
            .into_iter()
            .find(|asset| asset.relative_path.display() == path)
            .unwrap()
    }

    async fn light(&self) -> Session {
        let asset = self.asset(false, LIGHTS[0]).await.id;
        let summaries = self.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
        summaries.into_iter().map(|s| s.session).find(|s| s.asset_ids.contains(&asset)).unwrap()
    }

    /// The raw set holding the calibration frame at `path`.
    async fn raw_set(&self, path: &str) -> InputRef {
        let asset = self.asset(true, path).await.id;
        let inputs = self.library.calibration_inputs(&InputQuery::default()).await.unwrap();
        let raw = inputs.iter().find(|input| input.member_assets.contains(&asset)).unwrap();
        raw.input.input().unwrap()
    }

    async fn status(&self) -> SessionCalibrationStatus {
        self.catalog().session_calibration(self.light().await.id).await.unwrap()
    }

    async fn confirm_rig(&self) {
        let session = self.light().await;
        self.catalog().confirm_equipment(&[expected_session(&session)], self.rig.id).await.unwrap();
    }
}

fn pinned(state: &PinState) -> Option<(InputRef, PinOrigin)> {
    match state {
        PinState::Pinned { target, origin } => Some((target.input, *origin)),
        _ => None,
    }
}

fn suggested(state: &PinState) -> Option<InputRef> {
    match state {
        PinState::Suggested { target } => Some(target.input),
        _ => None,
    }
}

#[tokio::test]
async fn ingestion_records_light_calibration_and_matching_pins_it_once_the_rig_is_known() {
    let world = world(false).await;
    world.ingest(true, &calibration()).await;
    world.ingest(false, &lights()).await;
    let before = world.status().await;
    assert!(before.calibration.matching_pending, "recorded in the ingestion transaction");
    assert!(before.calibration.generation > 0);
    assert_eq!(
        before.calibration.unsettled_kinds(),
        [InputKind::Bias, InputKind::Dark, InputKind::Flat]
    );
    let dark = world.raw_set(DARKS[0]).await;
    let raw_dark = world.catalog().session_calibration(dark.id()).await.unwrap();
    assert_eq!(raw_dark.calibration.generation, 0, "a calibration session has no record");

    let light = world.light().await.id;
    assert_eq!(world.library.match_pending_calibration().await.unwrap(), [light]);
    let matched = world.status().await;
    assert!(!matched.calibration.matching_pending);
    assert_eq!(pinned(&matched.calibration.dark), Some((dark, PinOrigin::Automatic)));
    assert_eq!(
        pinned(&matched.calibration.bias),
        Some((world.raw_set(BIAS[0]).await, PinOrigin::Automatic)),
        "a bias needs no exposure (CAL-AC-30)"
    );
    let flats = world.raw_set(FLATS[0]).await;
    assert_eq!(
        suggested(&matched.calibration.flat),
        Some(flats),
        "the lights' rig is not confirmed"
    );
    let frame = world.asset(true, DARKS[0]).await;
    assert_eq!(
        frame.fingerprint.content_sha256.as_deref(),
        Some(support::digest(&world.calibration.1.join(DARKS[0])).as_str()),
        "matching hashed and recorded what it pinned"
    );

    world.confirm_rig().await;
    assert!(world.status().await.calibration.matching_pending, "a rig confirmation matches again");
    world.library.match_pending_calibration().await.unwrap();
    let confirmed = world.status().await;
    assert_eq!(pinned(&confirmed.calibration.flat), Some((flats, PinOrigin::Automatic)));
    assert_eq!(confirmed.calibration.dark, matched.calibration.dark, "a pin is never replaced");
    assert_eq!(confirmed.needs, []);

    assert_eq!(world.library.match_pending_calibration().await.unwrap(), Vec::<Uuid>::new());
    assert_eq!(world.status().await.calibration.generation, confirmed.calibration.generation);
}

#[tokio::test]
async fn calibration_imported_later_fills_only_kinds_still_waiting() {
    let world = world(false).await;
    world.ingest(false, &lights()).await;
    world.confirm_rig().await;
    world.library.match_pending_calibration().await.unwrap();
    let waiting = world.status().await;
    assert_eq!(waiting.calibration.unsettled_kinds().len(), 3, "nothing to match yet");
    let light = world.light().await.id;
    world
        .catalog()
        .decline_calibration(&[(light, waiting.calibration.generation)], InputKind::Bias)
        .await
        .unwrap();

    world.ingest(true, &calibration()).await;
    assert!(world.status().await.calibration.matching_pending, "calibration arrived");
    world.library.match_pending_calibration().await.unwrap();
    let filled = world.status().await;
    assert_eq!(
        filled.calibration.bias,
        PinState::Declined { origin: DeclineOrigin::User },
        "a No is never replaced"
    );
    let dark = world.raw_set(DARKS[0]).await;
    assert_eq!(pinned(&filled.calibration.dark), Some((dark, PinOrigin::Automatic)));
    assert!(pinned(&filled.calibration.flat).is_some());

    let mut closer = calibration();
    closer.extend(frames(&CLOSER_DARKS, "DARK", None, 300.0, "2026-09-30"));
    world.ingest(true, &closer).await;
    world.library.match_pending_calibration().await.unwrap();
    assert_eq!(
        world.status().await.calibration.dark,
        filled.calibration.dark,
        "closer darks arriving later never replace the pin"
    );
}

/// CAL-FR-05: a No over many sessions is one transaction. A session it can't
/// take names itself as the refusal's identity, and no session takes the No.
#[tokio::test]
async fn a_no_over_many_sessions_names_the_session_it_refuses_and_declines_none() {
    let world = world(false).await;
    world.ingest(false, &lights()).await;
    world.confirm_rig().await;
    world.library.match_pending_calibration().await.unwrap();
    let before = world.status().await.calibration;
    let light = world.light().await.id;
    let unknown = Uuid::new_v4();
    let refused = world
        .catalog()
        .decline_calibration(&[(light, before.generation), (unknown, 1)], InputKind::Bias)
        .await
        .unwrap_err();
    let response = refused.response(None, None);
    assert_eq!(
        (response.code, response.identity),
        (LibraryErrorCode::NotFound, Some(unknown)),
        "{refused}"
    );
    assert_eq!(world.status().await.calibration, before, "the known session took no No");
}

#[tokio::test]
async fn opening_the_library_matches_what_a_crash_left_pending() {
    let world = world(false).await;
    world.ingest(true, &calibration()).await;
    world.ingest(false, &lights()).await;
    assert!(world.status().await.calibration.matching_pending);
    let light = world.light().await.id;
    let World { _temp, db, library, .. } = world;
    drop(library);
    let reopened = Library::open(&db, None).await.unwrap();
    let status = reopened.catalog().session_calibration(light).await.unwrap();
    assert!(!status.calibration.matching_pending, "matched on restart");
    assert!(pinned(&status.calibration.dark).is_some());
    let generation = status.calibration.generation;
    drop(reopened);
    let again = Library::open(&db, None).await.unwrap();
    let status = again.catalog().session_calibration(light).await.unwrap();
    assert_eq!(status.calibration.generation, generation, "a second start changes nothing");
}

#[tokio::test]
async fn a_cameras_dont_use_darks_settles_new_sessions_as_no_darks() {
    let world = world(true).await;
    world.ingest(false, &lights()).await;
    world.confirm_rig().await;
    let status = world.status().await;
    assert_eq!(
        status.calibration.dark,
        PinState::Declined { origin: DeclineOrigin::CameraDefault },
        "settled in the confirmation, with no warning"
    );
    assert_eq!(status.calibration.bias, PinState::Unresolved);
    world.ingest(true, &calibration()).await;
    world.library.match_pending_calibration().await.unwrap();
    let matched = world.status().await;
    assert_eq!(matched.calibration.dark, status.calibration.dark, "no dark is matched over it");
    assert!(pinned(&matched.calibration.bias).is_some());
}

#[tokio::test]
async fn a_camera_default_never_replaces_a_pin_or_a_users_choice() {
    let world = world(true).await;
    world.ingest(true, &calibration()).await;
    world.ingest(false, &lights()).await;
    world.library.match_pending_calibration().await.unwrap();
    let matched = world.status().await.calibration;
    let dark = world.raw_set(DARKS[0]).await;
    assert_eq!(pinned(&matched.dark), Some((dark, PinOrigin::Automatic)), "pinned before the rig");
    let light = world.light().await.id;
    let bias = world
        .catalog()
        .decline_calibration(&[(light, matched.generation)], InputKind::Bias)
        .await
        .unwrap()
        .remove(0)
        .bias;
    world.confirm_rig().await;
    let confirmed = world.status().await.calibration;
    assert_eq!(confirmed.dark, matched.dark, "Don't use darks applies to waiting kinds only");
    assert_eq!(confirmed.bias, bias, "the user's No stays");
}

#[tokio::test]
async fn confirm_no_and_reassign_check_the_generation_the_user_saw() {
    let world = world(false).await;
    world.ingest(true, &calibration()).await;
    world.ingest(false, &lights()).await;
    world.library.match_pending_calibration().await.unwrap();
    let light = world.light().await.id;
    let seen = world.status().await.calibration;
    assert!(suggested(&seen.flat).is_some());
    let catalog = world.catalog();
    let stale = catalog.confirm_calibration(light, InputKind::Flat, seen.generation - 1).await;
    assert!(matches!(stale, Err(LibraryError::Conflict { .. })), "{stale:?}");
    let confirmed =
        catalog.confirm_calibration(light, InputKind::Flat, seen.generation).await.unwrap();
    assert_eq!(
        pinned(&confirmed.flat),
        Some((world.raw_set(FLATS[0]).await, PinOrigin::Confirmed))
    );
    assert!(confirmed.generation > seen.generation);

    let dark = world.raw_set(DARKS[0]).await;
    let wrong_kind = world
        .library
        .reassign_calibration(light, InputKind::Flat, dark, confirmed.generation)
        .await;
    assert!(matches!(wrong_kind, Err(LibraryError::InvalidInput(_))), "{wrong_kind:?}");
    let declined = catalog
        .decline_calibration(&[(light, confirmed.generation)], InputKind::Dark)
        .await
        .unwrap()
        .remove(0);
    assert_eq!(declined.dark, PinState::Declined { origin: DeclineOrigin::User });
    let reassigned = world
        .library
        .reassign_calibration(light, InputKind::Dark, dark, declined.generation)
        .await
        .unwrap();
    assert_eq!(pinned(&reassigned.dark), Some((dark, PinOrigin::Reassigned)), "over a No too");
}

#[tokio::test]
async fn a_changed_pinned_flat_keeps_its_pin_and_waits_in_needs_calibration() {
    let world = world(false).await;
    world.ingest(true, &calibration()).await;
    world.ingest(false, &lights()).await;
    world.confirm_rig().await;
    world.library.match_pending_calibration().await.unwrap();
    let light = world.light().await.id;
    assert_eq!(world.catalog().needs_calibration().await.unwrap(), []);
    let pinned_flat = world.status().await.calibration.flat;
    assert!(pinned(&pinned_flat).is_some());

    std::fs::write(world.calibration.1.join(FLATS[0]), "other bytes of another length").unwrap();
    index(&world.library, &world.calibration.0, &world.calibration.1, &calibration()).await;
    let drifted = world.status().await;
    assert_eq!(drifted.calibration.flat, pinned_flat, "the pin stays");
    assert_eq!(drifted.health.flat, PinHealth::Changed);
    let queue = world.catalog().needs_calibration().await.unwrap();
    assert_eq!(
        queue,
        [SessionNeeds {
            session_id: light,
            needs: vec![CalibrationNeed::PinDrift {
                kind: InputKind::Flat,
                health: PinHealth::Changed
            }],
        }]
    );
    let counts = world.catalog().session_filter_counts().await.unwrap();
    assert_eq!(counts.needs_calibration, 1);
}

#[tokio::test]
async fn an_unused_input_releases_its_sessions_and_a_used_one_is_refused() {
    let world = world(false).await;
    world.ingest(true, &calibration()).await;
    world.ingest(false, &lights()).await;
    world.library.match_pending_calibration().await.unwrap();
    let light = world.light().await.id;
    let dark = world.raw_set(DARKS[0]).await;
    let used = world.catalog().calibration_input_use(&dark).await.unwrap();
    assert_eq!(used, CalibrationInputUse { projects: Vec::new(), sessions: vec![light] });
    assert_eq!(world.catalog().release_calibration_input(&dark).await.unwrap(), [light]);
    let released = world.status().await.calibration;
    assert_eq!(released.dark, PinState::Unresolved, "it needs calibration again");
    assert!(released.matching_pending);

    let held = apply_support::world(ViewMode::Symlinks).await;
    let dark = held.session_of(&held.calibration, apply_support::DARKS[0]).await;
    let input = InputRef::RawSet { session_id: dark.id, grouping_revision: dark.grouping_revision };
    let used = held.catalog().calibration_input_use(&input).await.unwrap();
    assert_eq!(used.projects.len(), 1);
    assert_eq!(used.projects[0].name, apply_support::PROJECT);
    let refused = held.catalog().release_calibration_input(&input).await;
    assert!(
        matches!(&refused, Err(LibraryError::InvalidInput(message)) if message.contains(apply_support::PROJECT)),
        "{refused:?}"
    );
}

#[tokio::test]
async fn a_reassignment_shows_on_the_applied_project_and_writes_nothing_into_it() {
    let world = apply_support::world(ViewMode::Symlinks).await;
    world.apply().await;
    let catalog = world.catalog();
    assert_eq!(catalog.calibration_changes(world.project).await.unwrap(), []);
    let ha = world.session_of(&world.captures, apply_support::HA[0]).await.id;
    let before = catalog.session_calibration(ha).await.unwrap().calibration;
    let revision = || async {
        let mut conn = world.conn().await;
        sqlx::query_scalar::<_, i64>("SELECT revision FROM projects WHERE id = ?1")
            .bind(world.project.to_string())
            .fetch_one(&mut conn)
            .await
            .unwrap()
    };
    let desired = revision().await;
    catalog.decline_calibration(&[(ha, before.generation)], InputKind::Dark).await.unwrap();
    let changes = catalog.calibration_changes(world.project).await.unwrap();
    assert_eq!(
        changes,
        [PendingChange::CalibrationChanged {
            session_id: ha,
            kind: InputKind::Dark,
            from: before.dark.settled().unwrap(),
            to: Some(SettledPin::Declined),
        }]
    );
    assert_eq!(changes[0].source(), ChangeSource::Library);
    assert_eq!(revision().await, desired, "nothing is written into the Project");
}

#[tokio::test]
async fn a_processing_master_offer_hidden_once_stays_a_candidate() {
    let world = apply_support::world(ViewMode::Symlinks).await;
    let catalog = world.catalog();
    let classification = Classification {
        kind: InputKind::Flat,
        master: Some(MasterEvidence {
            basis: MasterBasis::HeaderStackCount,
            stack_count: Some(20),
            detector: "test".into(),
        }),
    };
    let offer = catalog
        .offer_processing_master(
            world.project,
            &NativePath::from_path(Path::new("WBPP/master/masterFlat_Ha.xisf")),
            &"ab".repeat(32),
            &classification,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(catalog.processing_master_candidates().await.unwrap(), std::slice::from_ref(&offer));
    let hidden = catalog.dismiss_processing_master(offer.id).await.unwrap();
    assert_eq!(hidden.state, MasterOfferState::Dismissed);
    assert!(hidden.decided_at.is_some());
    let offers = catalog.processing_master_offers(world.project).await.unwrap();
    assert_eq!(offers, std::slice::from_ref(&hidden));
    assert_eq!(
        catalog.processing_master_candidates().await.unwrap(),
        std::slice::from_ref(&hidden),
        "it stays listed in Calibration"
    );
    assert_eq!(catalog.dismiss_processing_master(offer.id).await.unwrap(), hidden, "once");
}
