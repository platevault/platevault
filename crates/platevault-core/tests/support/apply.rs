// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared world for the F4 Apply tests (spec 069; astro-plan-y1zq7): Project
//! 'NGC 7000' with one group on the `RedCat`, its Ha and OIII light sessions
//! of 12 and 13 Oct 2026 Usable, reviewed and held with their copies, each
//! pinned to its night's raw flats and the 300 s raw darks, bias No, and the
//! empty processing location `Work/Processing`. A third Ha session of
//! 14 Oct at gain 0 is catalogued but not held. Every file is real; the F4
//! desired state is written as the membership writer would.
//! Included with `#[path = "support/apply.rs"] mod apply_support;`.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use persistence_library::SourceProbe;
use platevault_core::apply::Unattended;
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::*;
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use uuid::Uuid;

pub const AT: &str = "2026-10-16T08:00:00Z";
pub const HA: [&str; 2] = ["2026-10-12/Light_001.fits", "2026-10-12/Light_002.fits"];
pub const OIII: [&str; 2] = ["2026-10-13/Light_001.fits", "2026-10-13/Light_002.fits"];
pub const HA_GAIN_0: &str = "2026-10-14/Ha_001.fits";
pub const DARKS: [&str; 2] = ["darks/Dark_300s_001.fits", "darks/Dark_300s_002.fits"];
pub const HA_FLATS: [&str; 2] = ["flats/Ha/Flat_Ha_001.fits", "flats/Ha/Flat_Ha_002.fits"];
pub const OIII_FLATS: [&str; 2] =
    ["flats/OIII/Flat_OIII_001.fits", "flats/OIII/Flat_OIII_002.fits"];
pub const PROJECT: &str = "NGC 7000";

fn meta(
    kind: &str,
    filter: Option<&str>,
    exposure: f64,
    gain: f64,
    night: &str,
) -> CaptureMetadata {
    CaptureMetadata {
        image_type: Some(kind.into()),
        filter: filter.map(str::to_owned),
        exposure_seconds: Some(exposure),
        camera: Some("ASI2600MM".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        gain: Some(gain),
        offset: Some(50),
        width: Some(6248),
        height: Some(4176),
        binning_x: Some(1),
        binning_y: Some(1),
        date_local: Some(format!("{night}T22:00:00")),
        ..CaptureMetadata::default()
    }
}

fn lights() -> Vec<(String, CaptureMetadata)> {
    let mut frames: Vec<(String, CaptureMetadata)> = HA
        .iter()
        .map(|path| ((*path).to_owned(), meta("LIGHT", Some("Ha"), 300.0, 100.0, "2026-10-12")))
        .collect();
    frames.extend(
        OIII.iter().map(|path| {
            ((*path).to_owned(), meta("LIGHT", Some("OIII"), 300.0, 100.0, "2026-10-13"))
        }),
    );
    frames.push((HA_GAIN_0.to_owned(), meta("LIGHT", Some("Ha"), 300.0, 0.0, "2026-10-14")));
    frames
}

fn calibration_frames() -> Vec<(String, CaptureMetadata)> {
    let mut frames = Vec::new();
    for path in DARKS {
        frames.push((path.to_owned(), meta("DARK", None, 300.0, 100.0, "2026-10-12")));
    }
    for path in HA_FLATS {
        frames.push((path.to_owned(), meta("FLAT", Some("Ha"), 2.0, 100.0, "2026-10-12")));
    }
    for path in OIII_FLATS {
        frames.push((path.to_owned(), meta("FLAT", Some("OIII"), 2.0, 100.0, "2026-10-13")));
    }
    frames
}

/// One session per type, night, filter, exposure and gain.
fn group_by_night(assets: &[Asset]) -> GroupingResult {
    let mut sessions: BTreeMap<String, Vec<Uuid>> = BTreeMap::new();
    for asset in assets {
        let m = &asset.effective;
        let night = m.date_local.as_deref().map(|date| date.get(..10).unwrap_or(date).to_owned());
        let key = format!(
            "capture-v1|type={}|night={}@date-loc-noon|filter={}|exposure_s={}|gain={}",
            m.image_type.as_deref().unwrap_or("?").to_lowercase(),
            night.unwrap_or_default(),
            m.filter.as_deref().unwrap_or("?"),
            m.exposure_seconds.map(|v| v.to_string()).unwrap_or_default(),
            m.gain.map(|v| v.to_string()).unwrap_or_default(),
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

/// A primary FITS header unique to `relative`.
fn fits(relative: &str, metadata: &CaptureMetadata) -> Vec<u8> {
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
    cards.push(format!("COMMENT {relative}"));
    cards.push("END".to_owned());
    let mut bytes: Vec<u8> =
        cards.iter().flat_map(|card| format!("{card:<80}").into_bytes()).collect();
    bytes.resize(2880, b' ');
    bytes
}

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
            fingerprint: InventoryProbe::default().fingerprint(&path).unwrap(),
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
        state: ScanState::Completed,
    };
    let finished = catalog
        .finish_scan(
            operation.id,
            &observation,
            |location| InventoryProbe::default().root_identity(location),
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

/// Records what the control saw.
#[derive(Default)]
pub struct Recorder {
    pub cancel: std::sync::atomic::AtomicBool,
    pub stop_at: std::sync::Mutex<Option<ApplyPhase>>,
    pub waited: std::sync::atomic::AtomicBool,
}

impl platevault_core::apply::ApplyControl for Recorder {
    fn canceled(&self) -> bool {
        self.cancel.load(std::sync::atomic::Ordering::SeqCst)
    }
    fn interrupted(&self, phase: ApplyPhase) -> bool {
        *self.stop_at.lock().unwrap() == Some(phase)
    }
    fn waiting(&self, waiting: bool) {
        if waiting {
            self.waited.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

pub struct World {
    pub temp: tempfile::TempDir,
    pub db: PathBuf,
    pub library: Arc<Library>,
    pub captures: Location,
    pub calibration: Location,
    /// `Work/Processing`, canonical.
    pub parent: PathBuf,
    pub project: Uuid,
    pub group: Uuid,
    pub rig: Uuid,
}

/// The world with the Ha and OIII sessions held, the View in `mode`.
pub async fn world(mode: ViewMode) -> World {
    let world = catalogued(mode).await;
    world.hold(HA[0]).await;
    world.hold(OIII[0]).await;
    world
}

/// The world with no session held yet.
pub async fn catalogued(mode: ViewMode) -> World {
    let temp = tempfile::tempdir().unwrap();
    let db = temp.path().join("library.sqlite");
    let library = Library::open(&db, None).await.unwrap();
    let mut locations = Vec::new();
    for (name, role) in [
        ("Astro-T7/Captures", LocationRole::Captures),
        ("Astro-T7/Calibration", LocationRole::Calibration),
    ] {
        let root = temp.path().join(name);
        fs::create_dir_all(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let location = library
            .register_location(NativePath::from_path(&root), name.into(), role)
            .await
            .unwrap();
        locations.push((location, root));
    }
    scan(&library, &locations[0].0, &locations[0].1, &lights()).await;
    scan(&library, &locations[1].0, &locations[1].1, &calibration_frames()).await;
    let parent = temp.path().join("Work/Processing");
    fs::create_dir_all(&parent).unwrap();
    let parent = fs::canonicalize(parent).unwrap();
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
    let world = World {
        temp,
        db,
        library: Arc::clone(&library),
        captures: locations[0].0.clone(),
        calibration: locations[1].0.clone(),
        parent,
        project: project.id,
        group: Uuid::new_v4(),
        rig: redcat.id,
    };
    for path in [HA[0], OIII[0], HA_GAIN_0] {
        let session = world.session_of(&world.captures, path).await;
        catalog.associate_target(&[expected_session(&session)], ngc.candidate.id).await.unwrap();
        let session = world.session_of(&world.captures, path).await;
        catalog.confirm_equipment(&[expected_session(&session)], redcat.id).await.unwrap();
    }
    let parent_json = serde_json::to_string(&NativePath::from_path(&world.parent)).unwrap();
    let mode = serde_json::to_value(mode).unwrap().as_str().unwrap().to_owned();
    world
        .sql(
            "UPDATE projects SET processing_parent = ?2, view_mode = ?3 WHERE id = ?1",
            &[&world.project.to_string(), &parent_json, &mode],
        )
        .await;
    world
        .sql(
            "INSERT INTO project_groups (id, project_id, rig_id, name, name_key, panel, origin, \
             optics, position, created_at) VALUES (?1, ?2, ?3, 'RedCat', 'redcat', 0, 'framing', \
             '{\"cameraId\":null,\"focalLengthMm\":\"250\",\"reducer\":null}', 0, ?4)",
            &[&world.group.to_string(), &world.project.to_string(), &world.rig.to_string(), AT],
        )
        .await;
    world
}

impl World {
    pub fn catalog(&self) -> &persistence_library::Catalog {
        self.library.catalog()
    }

    pub async fn conn(&self) -> SqliteConnection {
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&self.db))
            .await
            .unwrap()
    }

    /// Run `sql` with text binds against the catalog file.
    pub async fn sql(&self, sql: &'static str, binds: &[&str]) {
        let mut conn = self.conn().await;
        let mut query = sqlx::query(sql);
        for bind in binds {
            query = query.bind(*bind);
        }
        query.execute(&mut conn).await.unwrap_or_else(|error| panic!("{sql}: {error}"));
    }

    pub fn light(&self, path: &str) -> PathBuf {
        self.captures.path.to_path_buf().unwrap().join(path)
    }

    pub fn calibration_file(&self, path: &str) -> PathBuf {
        self.calibration.path.to_path_buf().unwrap().join(path)
    }

    pub fn folder(&self) -> PathBuf {
        self.parent.join(PROJECT)
    }

    pub fn view(&self) -> PathBuf {
        self.folder().join("View")
    }

    pub fn previous(&self) -> PathBuf {
        self.folder().join("View (previous)")
    }

    pub fn building(&self) -> PathBuf {
        self.folder().join("View (building)")
    }

    pub async fn asset_at(&self, location: &Location, path: &str) -> Asset {
        self.catalog()
            .location_assets(location.id)
            .await
            .unwrap()
            .into_iter()
            .find(|asset| asset.relative_path.display() == path)
            .unwrap()
    }

    /// The current session holding the file at `path`, light or calibration.
    pub async fn session_of(&self, location: &Location, path: &str) -> Session {
        let asset = self.asset_at(location, path).await.id;
        let mut conn = self.conn().await;
        let id: String = sqlx::query_scalar(
            "SELECT m.session_id FROM session_members m JOIN sessions s ON s.id = m.session_id \
             WHERE m.asset_id = ?1 AND s.superseded_by IS NULL",
        )
        .bind(asset.to_string())
        .fetch_one(&mut conn)
        .await
        .unwrap();
        self.catalog().session(id.parse().unwrap()).await.unwrap().summary.session
    }

    /// Mark every frame of a session `quality`, hashing them as review does.
    pub async fn mark(&self, session: &Session, quality: Quality) {
        let assets = self.catalog().session(session.id).await.unwrap().assets;
        let expected: Vec<ExpectedAsset> = assets
            .iter()
            .map(|asset| ExpectedAsset {
                asset_id: asset.id,
                decision_revision: asset.decision_revision,
                fingerprint: asset.fingerprint.clone(),
            })
            .collect();
        self.catalog().set_quality(&expected, quality, InventoryProbe::default()).await.unwrap();
    }

    /// The raw set pin of the calibration session holding `path`.
    async fn raw_set(&self, path: &str, night: &str) -> PinState {
        let session = self.session_of(&self.calibration, path).await;
        let mut files = Vec::new();
        let mut assets = self.catalog().session(session.id).await.unwrap().assets;
        assets.sort_by_key(|asset| asset.id);
        for asset in assets {
            let file = self
                .calibration
                .path
                .to_path_buf()
                .unwrap()
                .join(asset.relative_path.relative_path().unwrap());
            files.push(PinnedFile {
                asset_id: Some(asset.id),
                sha256: hex::encode(Sha256::digest(fs::read(&file).unwrap())),
                fingerprint: asset.fingerprint.clone(),
            });
        }
        PinState::Pinned {
            target: PinTarget {
                input: InputRef::RawSet {
                    session_id: session.id,
                    grouping_revision: session.grouping_revision,
                },
                captured: Some(
                    time::Date::parse(
                        night,
                        time::macros::format_description!("[year]-[month]-[day]"),
                    )
                    .unwrap(),
                ),
                files,
                evaluation: Evaluation {
                    verdict: Verdict::Compatible,
                    criteria: Vec::new(),
                    evidence: Vec::new(),
                },
            },
            origin: PinOrigin::Automatic,
        }
    }

    /// Pin `kind` of `session` to `pin`.
    pub async fn pin(&self, session: Uuid, kind: &str, pin: &PinState) {
        let (input_session, revision) = match pin.target().map(|target| target.input) {
            Some(InputRef::RawSet { session_id, grouping_revision }) => {
                (Some(session_id.to_string()), Some(grouping_revision.to_string()))
            }
            Some(InputRef::Master { revision, .. }) => (None, Some(revision.to_string())),
            None => (None, None),
        };
        self.sql(
            "UPDATE session_calibration_kinds SET state = ?3, input_session_id = nullif(?4, ''), \
             input_revision = CAST(nullif(?5, '') AS INTEGER), pin = ?6, decided_at = ?7 \
             WHERE session_id = ?1 AND kind = ?2",
            &[
                &session.to_string(),
                kind,
                pin.name(),
                input_session.as_deref().unwrap_or(""),
                revision.as_deref().unwrap_or(""),
                &serde_json::to_string(pin).unwrap(),
                AT,
            ],
        )
        .await;
    }

    /// Mark the light session holding `path` Usable and reviewed, pin its
    /// night's flats and the darks, set bias No, and hold it in the group
    /// with every capture, as the membership writer does.
    pub async fn hold(&self, path: &str) -> Uuid {
        let session = self.session_of(&self.captures, path).await;
        self.mark(&session, Quality::Usable).await;
        let session = self.session_of(&self.captures, path).await;
        let id = session.id.to_string();
        self.sql(
            "INSERT INTO session_reviews (session_id, grouping_revision, finished_at) \
             SELECT id, grouping_revision, ?2 FROM sessions WHERE id = ?1",
            &[&id, AT],
        )
        .await;
        self.sql(
            "INSERT INTO session_calibration (session_id, generation, matching_pending, updated_at) \
             VALUES (?1, 1, 0, ?2)",
            &[&id, AT],
        )
        .await;
        let (flats, night) = if path.starts_with("2026-10-13") {
            (OIII_FLATS[0], "2026-10-13")
        } else {
            (HA_FLATS[0], "2026-10-12")
        };
        self.pin(session.id, "flat", &self.raw_set(flats, night).await).await;
        self.pin(session.id, "dark", &self.raw_set(DARKS[0], "2026-10-12").await).await;
        self.pin(session.id, "bias", &PinState::Declined { origin: DeclineOrigin::User }).await;
        self.sql(
            "INSERT INTO project_sessions (project_id, session_id, group_id, placement, \
             grouping_revision, calibration_generation, added_at) \
             SELECT ?1, s.id, ?3, 'framing', s.grouping_revision, c.generation, ?4 FROM sessions s \
             JOIN session_calibration c ON c.session_id = s.id WHERE s.id = ?2",
            &[&self.project.to_string(), &id, &self.group.to_string(), AT],
        )
        .await;
        let assets = self.catalog().session(session.id).await.unwrap().assets;
        for asset in assets {
            let key = asset.id.to_string();
            self.sql(
                "INSERT INTO project_captures (project_id, capture_key, session_id, inclusion, \
                 basis, quality_when_added, updated_at) VALUES (?1, ?2, ?3, 'included', \
                 'usable', '\"usable\"', ?4)",
                &[&self.project.to_string(), &key, &id, AT],
            )
            .await;
            self.sql(
                "INSERT INTO project_capture_copies (project_id, capture_key, asset_id, \
                 decision_revision, fingerprint) VALUES (?1, ?2, ?2, CAST(?3 AS INTEGER), ?4)",
                &[
                    &self.project.to_string(),
                    &key,
                    &asset.decision_revision.to_string(),
                    &serde_json::to_string(&asset.fingerprint).unwrap(),
                ],
            )
            .await;
        }
        self.bump().await;
        session.id
    }

    /// Advance the Project's desired-state revision, as every edit does.
    pub async fn bump(&self) {
        self.sql(
            "UPDATE projects SET revision = revision + 1 WHERE id = ?1",
            &[&self.project.to_string()],
        )
        .await;
    }

    pub async fn preview(&self) -> ApplyPreview {
        self.library.apply_preview(self.project).await.unwrap()
    }

    pub fn request(preview: &ApplyPreview) -> ApplyRequest {
        ApplyRequest {
            project_id: preview.project_id,
            desired_revision: preview.desired_revision,
            basis_digest: preview.basis_digest.clone(),
            ticked: Vec::new(),
        }
    }

    /// Open the sheet and apply it unattended.
    pub async fn apply(&self) -> ApplyReport {
        let preview = self.preview().await;
        assert!(preview.blockers.is_empty(), "{:#?}", preview.blockers);
        self.library.apply(&Self::request(&preview), &Unattended).await.unwrap()
    }

    /// Every file and link below `root`, relative, sorted.
    pub fn tree(root: &Path) -> Vec<String> {
        let mut found = Vec::new();
        let mut folders = vec![root.to_path_buf()];
        while let Some(folder) = folders.pop() {
            let Ok(entries) = fs::read_dir(&folder) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                let metadata = fs::symlink_metadata(&path).unwrap();
                if metadata.is_dir() {
                    folders.push(path);
                } else {
                    found.push(path.strip_prefix(root).unwrap().to_string_lossy().into_owned());
                }
            }
        }
        found.sort();
        found
    }

    /// Re-open the library on the same catalog, as a restart does.
    pub async fn reopen(&mut self) {
        self.library = Library::open(&self.db, None).await.unwrap();
    }

    pub async fn journal(&self, operation: Uuid) -> ApplyJournal {
        self.catalog().apply_journal(operation).await.unwrap()
    }
}

/// The SHA-256 of a file.
pub fn digest(path: &Path) -> String {
    hex::encode(Sha256::digest(fs::read(path).unwrap()))
}
