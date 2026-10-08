// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared world for the PREP tests (spec 069): a Project 'NGC 7000 HOO' with
//! one run 'NGC7000-HOO-Siril' on Ha and OIII lights, its standard dark and
//! flat calibration assigned Automatic, and the empty `Work/Processing`
//! parent. Fixture files are real and are written only where a test says so.
//! Included with `#[path = "support/prepare.rs"] mod prepare_support;`.
#![allow(dead_code)]

use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use persistence_library::{SessionQuery, SourceProbe};
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::prepare::PrepareControl;
use platevault_core::*;
use uuid::Uuid;

pub const HA_LIGHTS: [&str; 2] = ["2026-09-18/Ha_001.fits", "2026-09-18/Ha_002.fits"];
pub const OIII_LIGHTS: [&str; 2] = ["2026-09-24/OIII_001.fits", "2026-09-24/OIII_002.fits"];
pub const RUN: &str = "NGC7000-HOO-Siril";
pub const PROJECT: &str = "NGC 7000 HOO";

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
        date_local: Some(format!("{night}T22:00:00")),
        ..CaptureMetadata::default()
    }
}

fn train(mut metadata: CaptureMetadata) -> CaptureMetadata {
    metadata.telescope = Some("RedCat 51".into());
    metadata.focal_length_mm = Some(250.0);
    metadata
}

fn calibration_frames() -> Vec<(String, CaptureMetadata)> {
    let mut frames = Vec::new();
    for index in 1..=2 {
        frames.push((
            format!("darks/Dark_300s_{index:03}.fits"),
            meta("DARK", None, 300.0, "2026-09-18"),
        ));
        frames.push((
            format!("flats/Ha/Flat_Ha_{index:03}.fits"),
            train(meta("FLAT", Some("Ha"), 2.0, "2026-09-18")),
        ));
        frames.push((
            format!("flats/OIII/Flat_OIII_{index:03}.fits"),
            train(meta("FLAT", Some("OIII"), 2.0, "2026-09-24")),
        ));
    }
    frames
}

/// One session per night of the same capture settings.
fn group_by_night(assets: &[Asset]) -> GroupingResult {
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

/// A primary FITS header unique to `relative`: the frame's type, filter and
/// object, and its path as a comment, in one block.
pub fn fits(relative: &str, metadata: &CaptureMetadata) -> Vec<u8> {
    let mut cards = vec![
        "SIMPLE  =                    T".to_owned(),
        "BITPIX  =                    8".to_owned(),
        "NAXIS   =                    0".to_owned(),
    ];
    if let Some(kind) = &metadata.image_type {
        cards.push(format!("IMAGETYP= '{kind:<8}'"));
    }
    if let Some(filter) = &metadata.filter {
        cards.push(format!("FILTER  = '{filter:<8}'"));
    }
    if let Some(object) = &metadata.object {
        cards.push(format!("OBJECT  = '{object:<8}'"));
    }
    cards.push(format!("COMMENT {relative}"));
    cards.push("END".to_owned());
    let mut bytes: Vec<u8> =
        cards.iter().flat_map(|card| format!("{card:<80}").into_bytes()).collect();
    bytes.resize(2880, b' ');
    bytes
}

/// Write each file as a FITS header unique to its path and scan the
/// location once.
async fn scan(
    library: &Library,
    location: &Location,
    root: &Path,
    frames: &[(String, CaptureMetadata)],
) {
    let catalog = library.catalog();
    let mut files = Vec::new();
    for (relative, metadata) in frames {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, fits(relative, metadata)).unwrap();
        files.push(ScanFile {
            relative_path: NativePath::from_path(Path::new(relative)),
            fingerprint: InventoryProbe.fingerprint(&path).unwrap(),
            format: ImageFormat::Fits,
            metadata: metadata.clone(),
        });
    }
    let operation = catalog.begin_scan(location.id, None).await.unwrap();
    let identity = InventoryProbe.root_identity(location).unwrap();
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
        state: ScanState::Completed,
    };
    let finished = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| InventoryProbe.root_identity(location),
            group_by_night,
        )
        .await
        .unwrap();
    assert_eq!(finished.state, ScanState::Completed);
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

fn target() -> TargetCandidate {
    TargetCandidate {
        id: Uuid::new_v4(),
        designation: "NGC 7000".into(),
        aliases: vec![TargetAlias {
            text: "NGC 7000".into(),
            normalized: "ngc 7000".into(),
            kind: "designation".into(),
            provenance: Provenance::User,
        }],
        common_name: None,
        object_type: "nebula".into(),
        coordinates: Some(SkyCoordinates { ra_deg: 314.75, dec_deg: 44.33, frame: "ICRS".into() }),
        provenance: Provenance::User,
        provider_id: None,
        angular_size: None,
        catalogues: Vec::new(),
    }
}

fn expected_session(session: &Session) -> ExpectedSession {
    ExpectedSession {
        session_id: session.id,
        grouping_revision: session.grouping_revision,
        decision_revision: session.decision_revision,
    }
}

pub struct World {
    pub temp: tempfile::TempDir,
    pub library: Arc<Library>,
    pub captures: Location,
    pub calibration: Location,
    /// `Work/Processing`, canonical: the parent the tests choose.
    pub output: PathBuf,
    pub run: Uuid,
}

/// The run saved once with every light, its calibration assigned Automatic.
pub async fn world() -> World {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let mut locations = Vec::new();
    for (name, role) in [
        ("Astro-T7/Captures", LocationRole::Captures),
        ("Astro-T7/Calibration", LocationRole::Calibration),
    ] {
        let root = temp.path().join(name);
        fs::create_dir_all(&root).unwrap();
        let location = library
            .register_location(NativePath::from_path(&root), name.into(), role)
            .await
            .unwrap();
        locations.push((location, root));
    }
    let output = temp.path().join("Work/Processing");
    fs::create_dir_all(&output).unwrap();
    let output = fs::canonicalize(output).unwrap();
    let lights: Vec<(String, CaptureMetadata)> = HA_LIGHTS
        .iter()
        .map(|path| ((*path).to_owned(), train(meta("LIGHT", Some("Ha"), 300.0, "2026-09-18"))))
        .chain(OIII_LIGHTS.iter().map(|path| {
            ((*path).to_owned(), train(meta("LIGHT", Some("OIII"), 300.0, "2026-09-24")))
        }))
        .collect();
    scan(&library, &locations[0].0, &locations[0].1, &lights).await;
    scan(&library, &locations[1].0, &locations[1].1, &calibration_frames()).await;
    let catalog = library.catalog();
    let ngc = catalog.save_target(&target(), None).await.unwrap();
    let redcat = catalog.save_equipment(&rig(), None).await.unwrap();
    let project = catalog
        .create_project(&ProjectInput {
            name: PROJECT.into(),
            notes: None,
            subjects: vec![SubjectInput {
                target_id: ngc.candidate.id,
                name: None,
                mosaic: false,
                panels: Vec::new(),
            }],
            rig_ids: vec![redcat.id],
            goals: Vec::new(),
        })
        .await
        .unwrap();
    let mut world = World {
        library: Arc::clone(&library),
        captures: locations[0].0.clone(),
        calibration: locations[1].0.clone(),
        output,
        run: Uuid::nil(),
        temp,
    };
    for path in [HA_LIGHTS[0], OIII_LIGHTS[0]] {
        let session = world.session_at(path).await;
        catalog.associate_target(&[expected_session(&session)], ngc.candidate.id).await.unwrap();
        let session = world.session_at(path).await;
        catalog.confirm_equipment(&[expected_session(&session)], redcat.id).await.unwrap();
    }
    let record = catalog
        .create_view(&NewView {
            project_id: project.id,
            subject_id: project.subjects[0].id,
            rig_id: redcat.id,
            name: RUN.into(),
        })
        .await
        .unwrap();
    world.run = record.view.id;
    catalog.save_view(world.run, 0, 1).await.unwrap();
    world.assign(1).await;
    world
}

impl World {
    pub fn catalog(&self) -> &persistence_library::Catalog {
        self.library.catalog()
    }

    pub fn light(&self, path: &str) -> PathBuf {
        self.captures.path.to_path_buf().unwrap().join(path)
    }

    pub fn calibration_file(&self, path: &str) -> PathBuf {
        self.calibration.path.to_path_buf().unwrap().join(path)
    }

    /// Every library source the run's preparation reads.
    pub fn sources(&self) -> Vec<PathBuf> {
        let mut sources: Vec<PathBuf> =
            HA_LIGHTS.iter().chain(&OIII_LIGHTS).map(|path| self.light(path)).collect();
        sources.extend(calibration_frames().iter().map(|(path, _)| self.calibration_file(path)));
        sources
    }

    async fn asset_at(&self, path: &str) -> Asset {
        self.catalog()
            .location_assets(self.captures.id)
            .await
            .unwrap()
            .into_iter()
            .find(|asset| asset.relative_path.display() == path)
            .unwrap()
    }

    async fn session_at(&self, path: &str) -> Session {
        let asset = self.asset_at(path).await.id;
        let summaries = self.catalog().list_sessions(&SessionQuery::default()).await.unwrap();
        summaries.into_iter().map(|s| s.session).find(|s| s.asset_ids.contains(&asset)).unwrap()
    }

    /// The automatic calibration match at membership `revision`.
    pub async fn assign(&self, revision: Revision) {
        let plan = self.library.calibration_view_plan(self.run, revision).await.unwrap();
        self.library.calibration_assign(self.run, revision, plan.plan_revision).await.unwrap();
        let handoff = self.library.calibration_handoff(self.run, revision).await.unwrap();
        assert!(handoff.ready, "{handoff:#?}");
    }

    /// Save membership revision 2 without one OIII frame, its calibration
    /// re-matched.
    pub async fn drop_one_oiii_frame(&self) {
        let revision = self.catalog().view_revision(self.run, 1).await.unwrap();
        let oiii = self.asset_at(OIII_LIGHTS[1]).await.id;
        let member = revision
            .members
            .iter()
            .find(|member| member.copies.iter().any(|copy| copy.asset_id == oiii))
            .unwrap()
            .member_key;
        let edit = DraftEdit::SetFrames { member_keys: vec![member], state: MemberState::Excluded };
        self.catalog().edit_view_draft(self.run, 0, &edit).await.unwrap();
        self.catalog().save_view(self.run, 1, 1).await.unwrap();
        self.assign(2).await;
    }

    /// Confirm a catalog correction of one capture field of the light at
    /// `path`, its file untouched, then re-run the automatic calibration
    /// match its regroup asks for. Returns the corrected asset.
    pub async fn correct(&self, path: &str, field: &str, value: serde_json::Value) -> Uuid {
        let asset = self.asset_at(path).await;
        let expected = ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        };
        let correction = CorrectionInput { asset_id: asset.id, field: field.into(), value };
        self.catalog()
            .apply_correction_and_regroup(&[expected], &[correction], group_by_night)
            .await
            .unwrap();
        self.assign(1).await;
        asset.id
    }

    /// A verified read-only Siril profile that launches `/bin/sh` with
    /// `script`, which gets the Results folder as `$1`.
    pub async fn siril(&self, script: &str) -> Profile {
        let proofs = Capability::ALL
            .into_iter()
            .map(|capability| CapabilityProof {
                capability,
                evidence: format!("fixture-qualified {capability}"),
            })
            .collect();
        let input = ProfileInput {
            name: "Siril".into(),
            kind: ProfileKind::Siril,
            executable: Some(NativePath::from_path(Path::new("/bin/sh"))),
            args: vec!["-c".into(), script.into(), "sh".into(), "{results}".into()],
            capability_evidence: CapabilityEvidence {
                input_behavior: InputBehavior::ReadOnly,
                input_list: true,
                proofs,
            },
        };
        self.catalog().create_profile(&input).await.unwrap()
    }

    /// A profile whose application may write to its inputs.
    pub async fn write_prone(&self) -> Profile {
        let input = ProfileInput {
            name: "WBPP".into(),
            kind: ProfileKind::Wbpp,
            executable: None,
            args: Vec::new(),
            capability_evidence: CapabilityEvidence {
                input_behavior: InputBehavior::WriteProne,
                input_list: false,
                proofs: vec![CapabilityProof {
                    capability: Capability::Input,
                    evidence: "rewrites FITS keywords of its input lights".into(),
                }],
            },
        };
        self.catalog().create_profile(&input).await.unwrap()
    }

    pub fn request(
        &self,
        profile: &Profile,
        mode: InputMode,
        link: Option<LinkKind>,
    ) -> PrepareRequest {
        PrepareRequest {
            profile_id: profile.id,
            mode,
            link,
            output: Some(NativePath::from_path(&self.output)),
            folder_name: None,
            corrections: std::collections::BTreeMap::new(),
        }
    }

    pub async fn membership_revision(&self) -> Revision {
        self.catalog().view(self.run).await.unwrap().view.revision
    }

    pub async fn prepare(&self, request: &PrepareRequest, control: &Watch) -> PreparationOutcome {
        let revision = self.membership_revision().await;
        self.library.prepare_run(self.run, request, revision, control).await.unwrap()
    }

    pub async fn view(&self) -> View {
        self.catalog().view(self.run).await.unwrap().view
    }
}

/// A Prepare control that continues and runs `hook` on every settled entry.
pub struct Watch {
    pub settled: parking_lot::Mutex<Vec<PreparedEntry>>,
    hook: Box<dyn Fn(&PreparedEntry) + Send + Sync>,
}

impl Watch {
    pub fn quiet() -> Self {
        Self::on(|_| {})
    }

    pub fn on(hook: impl Fn(&PreparedEntry) + Send + Sync + 'static) -> Self {
        Self { settled: parking_lot::Mutex::new(Vec::new()), hook: Box::new(hook) }
    }
}

impl PrepareControl for Watch {
    fn step(&self) -> PrepareStep {
        PrepareStep::Continue
    }

    fn settled(&self, entry: &PreparedEntry) {
        self.settled.lock().push(entry.clone());
        (self.hook)(entry);
    }
}

/// Change the first byte of `path` in place, keeping its size and
/// modification time: drift only a re-read can see.
pub fn overwrite_in_place(path: &Path) {
    let modified = fs::metadata(path).unwrap().modified().unwrap();
    let first = fs::read(path).unwrap()[0];
    let mut file = fs::OpenOptions::new().write(true).open(path).unwrap();
    file.seek(SeekFrom::Start(0)).unwrap();
    file.write_all(&[first ^ 0x20]).unwrap();
    file.set_modified(modified).unwrap();
    file.sync_all().unwrap();
}

/// Restore the first byte `overwrite_in_place` changed, keeping the time.
pub fn restore_in_place(path: &Path) {
    overwrite_in_place(path);
}

pub fn digest(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(fs::read(path).unwrap()))
}

/// Every file below `root` with its SHA-256 (links read as their target).
pub fn tree(root: &Path) -> Vec<(PathBuf, String)> {
    let mut files = Vec::new();
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        for entry in fs::read_dir(&folder).unwrap() {
            let path = entry.unwrap().path();
            if fs::symlink_metadata(&path).unwrap().is_dir() {
                folders.push(path);
            } else {
                files.push((path.strip_prefix(root).unwrap().to_path_buf(), digest(&path)));
            }
        }
    }
    files.sort();
    files
}

/// Wait up to ten seconds for `path` to appear.
pub async fn appears(path: &Path) -> bool {
    for _ in 0..100 {
        if path.exists() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

pub fn modified(path: &Path) -> SystemTime {
    fs::metadata(path).unwrap().modified().unwrap()
}
