// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Composed frame review acceptance (spec 067): generated FITS and XISF
//! frames indexed through Library scans, measured, previewed and disclosed
//! through `FrameReview`. Every fixture file is only ever read, its SHA-256
//! manifest is compared after each scenario, and no library record changes.
#![allow(
    clippy::too_many_lines,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]

mod support;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use persistence_library::SessionQuery;
use platevault_core::frame_review::FrameReview;
use platevault_core::library::Library;
use platevault_core::*;
use platevault_pixels::fixtures::{
    quantize, set_integer, write_fits, write_xisf, CfaModulation, FitsImage, SyntheticFrame,
    SyntheticStar, XisfImage,
};
use platevault_pixels::{SampleFormat as StoredFormat, Scaling as StoredScaling, StoredSamples};
use tokio::sync::broadcast;
use uuid::Uuid;

/// FITS stores unsigned 16-bit data as signed samples with this BZERO.
const BZERO: StoredScaling = StoredScaling { zero: 32768.0, scale: 1.0 };
const BASE64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// Capture header cards: one night per `night`, five minutes per `index`.
fn header(filter: &str, night: usize, index: usize) -> Vec<(&'static str, String)> {
    let minutes = 18 * 60 + index * 5;
    vec![
        ("IMAGETYP", "'LIGHT'".into()),
        ("INSTRUME", "'ASI2600MM'".into()),
        ("TELESCOP", "'RedCat 51'".into()),
        ("OBJECT", "'NGC 7000'".into()),
        ("FILTER", format!("'{filter}'")),
        ("EXPTIME", "300".into()),
        (
            "DATE-OBS",
            format!("'2026-09-{:02}T{:02}:{:02}:00'", 10 + night, minutes / 60, minutes % 60),
        ),
        ("SITELAT", "52.0".into()),
        ("SITELONG", "4.5".into()),
    ]
}

fn fits_file(
    path: &Path,
    frame: &SyntheticFrame,
    samples: &StoredSamples,
    scaling: StoredScaling,
    blank: Option<i64>,
    cards: &[(&str, String)],
) {
    let bytes = write_fits(&FitsImage {
        width: frame.width,
        height: frame.height,
        channels: 1,
        samples,
        scaling,
        blank,
        cards,
    })
    .unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// An unsigned 16-bit FITS frame (signed samples with BZERO 32768).
fn fits_u16(path: &Path, frame: &SyntheticFrame, cards: &[(&str, String)]) {
    let samples = quantize(&frame.render(), StoredFormat::I16, BZERO);
    fits_file(path, frame, &samples, BZERO, None, cards);
}

fn xisf_u16(path: &Path, frame: &SyntheticFrame, cards: &[(&str, String)], cfa: Option<&str>) {
    let samples = quantize(&frame.render(), StoredFormat::U16, StoredScaling::IDENTITY);
    let keywords: Vec<(&str, &str)> =
        cards.iter().map(|(key, value)| (*key, value.as_str())).collect();
    let bytes = write_xisf(&XisfImage {
        cfa_pattern: cfa,
        keywords: &keywords,
        ..XisfImage::new(frame.width, frame.height, 1, &samples)
    })
    .unwrap();
    std::fs::write(path, bytes).unwrap();
}

fn star(x: f64, y: f64, amplitude: f64, sigma_major: f64, sigma_minor: f64) -> SyntheticStar {
    SyntheticStar { x, y, amplitude, sigma_major, sigma_minor, angle_deg: 30.0 }
}

/// A 64×64 frame with two well-exposed stars.
fn star_frame(seed: u64) -> SyntheticFrame {
    SyntheticFrame {
        stars: vec![star(20.3, 21.6, 3000.0, 2.0, 1.8), star(44.7, 40.2, 2000.0, 1.9, 1.9)],
        ..SyntheticFrame::new(64, 64, seed, 1000.0, 10.0)
    }
}

/// `count` frames over nights of 52: FITS on even nights, XISF on odd ones.
fn write_frames(root: &Path, count: usize) -> Vec<String> {
    (0..count)
        .map(|index| {
            let night = index / 52;
            let extension = if night % 2 == 0 { "fits" } else { "xisf" };
            let name = format!("n{night}_{index:03}.{extension}");
            let cards = header("Ha", night, index % 52);
            let frame = star_frame(index as u64 + 1);
            if night % 2 == 0 {
                fits_u16(&root.join(&name), &frame, &cards);
            } else {
                xisf_u16(&root.join(&name), &frame, &cards, None);
            }
            name
        })
        .collect()
}

/// Start a scan and wait for its terminal event.
async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                return operation;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state")
}

/// Poll the durable status until the run leaves Running, failing only once no
/// frame has settled for two minutes.
///
/// Each frame's contained read probes the volume three times (root, file,
/// root). On Windows a probe is a PowerShell CIM query bounded at 30 s, so a
/// 100-frame run on a loaded runner outlasts any fixed total budget while still
/// settling frame after frame; a worker settles its frame within 90 s or fails it.
async fn finished(review: &FrameReview, run: Uuid) -> MeasurementRun {
    const STALLED: Duration = Duration::from_secs(120);
    let mut remaining = None;
    let mut deadline = tokio::time::Instant::now() + STALLED;
    loop {
        let status = review.measurement_status(run).await.unwrap();
        if status.state != RunState::Running {
            return status;
        }
        if remaining != Some(status.counters.remaining) {
            remaining = Some(status.counters.remaining);
            deadline = tokio::time::Instant::now() + STALLED;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the run must settle: no frame settled for {STALLED:?}: {status:?}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Wait until `run` publishes a settled frame.
async fn settled_frame(progress: &mut broadcast::Receiver<MeasurementProgress>, run: Uuid) {
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            match progress.recv().await {
                Ok(event) if event.operation_id == run && event.asset_id.is_some() => {
                    assert!(event.frame_state.is_some(), "a settled frame carries its state");
                    return;
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(error) => panic!("progress closed: {error}"),
            }
        }
    })
    .await
    .expect("a frame must settle");
}

/// A library over one generated root, with the SHA-256 of every file.
struct Indexed {
    temp: tempfile::TempDir,
    database: PathBuf,
    root: PathBuf,
    library: Option<Arc<Library>>,
    location: Uuid,
    names: Vec<String>,
    ids: BTreeMap<String, Uuid>,
    manifest: BTreeMap<PathBuf, String>,
}

impl Indexed {
    async fn new(write: impl FnOnce(&Path) -> Vec<String>) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Captures");
        std::fs::create_dir(&root).unwrap();
        let names = write(&root);
        let manifest =
            names.iter().map(|name| (root.join(name), support::digest(&root.join(name)))).collect();
        let database = temp.path().join("library.sqlite");
        let library = Library::open(&database, None).await.unwrap();
        let location = library
            .register_location(
                NativePath::from_path(&root),
                "Captures".into(),
                LocationRole::Captures,
            )
            .await
            .unwrap();
        assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
        let ids = library
            .catalog()
            .location_assets(location.id)
            .await
            .unwrap()
            .into_iter()
            .map(|asset| (asset.relative_path.display(), asset.id))
            .collect::<BTreeMap<_, _>>();
        assert!(names.iter().all(|name| ids.contains_key(name)), "every fixture is indexed");
        Self {
            temp,
            database,
            root,
            library: Some(library),
            location: location.id,
            names,
            ids,
            manifest,
        }
    }

    fn library(&self) -> &Arc<Library> {
        self.library.as_ref().expect("library open")
    }

    fn review(&self) -> &FrameReview {
        self.library().frame_review()
    }

    fn id(&self, name: &str) -> Uuid {
        self.ids[name]
    }

    /// Asset ids in fixture order.
    fn assets(&self) -> Vec<Uuid> {
        self.names.iter().map(|name| self.id(name)).collect()
    }

    /// Close the library, as an app exit does, and open it again.
    async fn reopen(&mut self) {
        self.library = None;
        self.library = Some(Library::open(&self.database, None).await.unwrap());
    }

    fn assert_manifest(&self) {
        for (path, digest) in &self.manifest {
            assert_eq!(&support::digest(path), digest, "{} is read-only", path.display());
        }
    }

    /// Every asset and session record with quality, decisions, memberships
    /// and associations.
    async fn library_state(&self) -> serde_json::Value {
        let catalog = self.library().catalog();
        let assets = catalog.location_assets(self.location).await.unwrap();
        let query = SessionQuery { include_superseded: true, ..SessionQuery::default() };
        let mut sessions = Vec::new();
        for summary in catalog.list_sessions(&query).await.unwrap() {
            sessions.push(catalog.session(summary.session.id).await.unwrap());
        }
        serde_json::json!({ "assets": assets, "sessions": sessions })
    }

    async fn measure_all(&self) -> MeasurementRun {
        let run = self.review().start_measurement(&self.assets(), &[]).await.unwrap();
        let run = finished(self.review(), run.operation_id).await;
        assert_eq!(run.state, RunState::Completed, "{run:?}");
        run
    }
}

fn counters(requested: u64, already_cached: u64, measured: u64, remaining: u64) -> RunCounters {
    RunCounters { requested, already_cached, measured, failed: 0, unavailable: 0, remaining }
}

fn built_in() -> ValueSource {
    ValueSource::BuiltIn { method: "platevault.stars".into(), version: 1 }
}

fn value(values: &[MetricValue], metric: MetricId) -> &MetricValue {
    values.iter().find(|value| value.metric == metric).unwrap_or_else(|| panic!("{metric:?}"))
}

const FRAMES: usize = 208;
const MEASURED: usize = 100;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn frame_states_come_from_the_catalog_and_a_run_queues_only_frames_without_a_record() {
    let indexed = Indexed::new(|root| write_frames(root, FRAMES)).await;
    let review = indexed.review();
    let catalog = indexed.library().catalog();
    let assets = indexed.assets();
    let before = indexed.library_state().await;

    // PIX-AC-06: listing and paging sessions and reading frame states start no
    // run and write no measurement row.
    let sessions = catalog.list_sessions(&SessionQuery::default()).await.unwrap();
    assert!(sessions.len() >= 2, "{} sessions", sessions.len());
    for (offset, summary) in sessions.iter().enumerate() {
        let page = catalog
            .list_sessions(&SessionQuery {
                offset: offset as u32,
                limit: 1,
                ..SessionQuery::default()
            })
            .await
            .unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].session.id, summary.session.id);
    }
    let states = review.frame_states(&assets).await.unwrap();
    assert_eq!(states.len(), FRAMES);
    for state in &states {
        assert_eq!(state.state, FrameStateKind::NotMeasured);
        assert_eq!((state.measurement_id, state.values.len()), (None, 0));
        assert!(state.imported.is_empty());
    }
    assert!(review.list_runs(0, 10).await.unwrap().is_empty(), "reading starts no run");

    // 100 frames measured through the queue.
    let first = review.start_measurement(&assets[..MEASURED], &[]).await.unwrap();
    assert_eq!(first.state, RunState::Running);
    assert_eq!(first.method, MeasurementMethod::new("platevault.stars", 1));
    let first = finished(review, first.operation_id).await;
    assert_eq!(first.state, RunState::Completed);
    assert_eq!(first.counters, counters(100, 0, 100, 0));
    assert!(first.issues.is_empty());

    // Frame states come from the catalog alone: the root is moved away.
    let away = indexed.temp.path().join("Captures.away");
    std::fs::rename(&indexed.root, &away).unwrap();
    let states = review.frame_states(&assets).await;
    std::fs::rename(&away, &indexed.root).unwrap();
    let states = states.unwrap();
    assert_eq!(states.iter().map(|state| state.asset_id).collect::<Vec<_>>(), assets);
    let mut first_records = HashMap::new();
    for (index, state) in states.iter().enumerate() {
        if index < MEASURED {
            assert_eq!(state.state, FrameStateKind::Cached, "frame {index}");
            assert_eq!(state.verification, Some(Verification::Current));
            assert!(state.measured_at.is_some());
            assert_eq!(state.values.len(), 7);
            assert!(state.values.iter().all(|value| value.source == built_in()));
            assert_eq!(value(&state.values, MetricId::FittedStarCount).value, Some(2.0));
            first_records.insert(state.asset_id, state.measurement_id.unwrap());
        } else {
            assert_eq!(state.state, FrameStateKind::NotMeasured, "frame {index}");
            assert_eq!((state.measurement_id, state.values.len()), (None, 0));
        }
    }

    // Starting all 208 reports the cached 100 and queues the other 108, the
    // priority frame first.
    let queued = &assets[MEASURED..];
    let priority = queued[50];
    let second = review.start_measurement(&assets, &[priority]).await.unwrap();
    assert_eq!(second.state, RunState::Running);
    assert_ne!(second.operation_id, first.operation_id);
    assert_eq!(second.counters.requested, 208);
    assert_eq!(second.counters.already_cached, 100);
    assert_eq!(second.counters.remaining, 108);
    let mut order = vec![priority];
    order.extend(queued.iter().copied().filter(|id| *id != priority));
    let moved = order[order.len() - 1];
    let previewed = order[order.len() - 2];
    let prioritized = review.prioritize(second.operation_id, &[moved]).await.unwrap();
    assert_eq!(prioritized.operation_id, second.operation_id);

    // Preview of a queued frame is served while the run is Running.
    let preview = review.open_frame(previewed).await.unwrap();
    assert_eq!((preview.width, preview.height), (64, 64));
    assert!(!preview.matches_record);
    let tile = review
        .preview_tile(&TileRequest {
            asset_id: previewed,
            sha256: preview.sha256.clone(),
            plane: 0,
            level: 1,
            x: 0,
            y: 0,
            width: 32,
            height: 32,
            stretch: Stretch::Auto,
        })
        .await
        .unwrap();
    assert_eq!((tile.level, tile.width, tile.height), (1, 32, 32));
    assert_eq!(BASE64.decode(&tile.gray).unwrap().len(), 32 * 32);
    let state = &review.frame_states(&[previewed]).await.unwrap()[0];
    assert_eq!(state.state, FrameStateKind::Pending, "the previewed frame was still queued");

    let second = finished(review, second.operation_id).await;
    assert_eq!(second.state, RunState::Completed);
    assert_eq!(second.counters, counters(208, 100, 108, 0));

    // Dequeue order: the priority frame first, the prioritized frame right
    // after the frames already dequeued, every other frame in queue order.
    let states = review.frame_states(&assets).await.unwrap();
    assert!(states.iter().all(|state| state.state == FrameStateKind::Cached));
    let mut sequence = HashMap::new();
    for state in &states {
        let record = catalog.measurement(state.measurement_id.unwrap()).await.unwrap();
        if let Some(previous) = first_records.get(&state.asset_id) {
            assert_eq!(*previous, record.id, "a cached record is kept");
            assert_eq!(record.run_id, first.operation_id);
        } else {
            assert_eq!(record.run_id, second.operation_id);
            sequence.insert(state.asset_id, record.dequeue_sequence);
        }
    }
    assert_eq!(sequence[&priority], 1);
    let mut all: Vec<u64> = sequence.values().copied().collect();
    all.sort_unstable();
    assert_eq!(all, (1..=108).collect::<Vec<_>>());
    let moved_at = sequence[&moved];
    assert!(moved_at < 108, "prioritize moved the last frame ahead ({moved_at})");
    let ahead: BTreeSet<Uuid> =
        order.iter().copied().filter(|id| sequence[id] < moved_at).collect();
    let dequeued_before: BTreeSet<Uuid> = order[..moved_at as usize - 1].iter().copied().collect();
    assert_eq!(ahead, dequeued_before);

    assert_eq!(indexed.library_state().await, before);
    indexed.assert_manifest();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancel_keeps_committed_records_and_reopening_marks_the_running_run_interrupted() {
    let mut indexed = Indexed::new(|root| write_frames(root, 64)).await;
    let assets = indexed.assets();
    let before = indexed.library_state().await;
    let review = indexed.review();
    let mut progress = review.subscribe_measurement_progress();
    let run = review.start_measurement(&assets, &[]).await.unwrap();
    settled_frame(&mut progress, run.operation_id).await;
    let requested = review.cancel_measurement(run.operation_id).await.unwrap();
    assert_eq!(requested.operation_id, run.operation_id);
    let canceled = finished(review, run.operation_id).await;
    assert_eq!(canceled.state, RunState::Canceled);
    assert!(canceled.finished_at.is_some());

    let states = review.frame_states(&assets).await.unwrap();
    let cached: BTreeSet<Uuid> = states
        .iter()
        .filter(|state| state.state == FrameStateKind::Cached)
        .map(|state| state.asset_id)
        .collect();
    assert!(!cached.is_empty(), "committed records stay");
    assert!(cached.len() < assets.len(), "cancel left frames unmeasured");
    assert_eq!(canceled.counters.measured, cached.len() as u64);
    for state in &states {
        if !cached.contains(&state.asset_id) {
            assert_eq!(state.state, FrameStateKind::NotMeasured);
            assert!(state.values.is_empty());
        }
    }
    assert_eq!(indexed.library_state().await, before, "cancel changes no library record");
    indexed.assert_manifest();

    // A new start queues only the frames without a record.
    let restart = review.start_measurement(&assets, &[]).await.unwrap();
    assert_ne!(restart.operation_id, run.operation_id);
    assert_eq!(restart.counters.already_cached, cached.len() as u64);
    assert_eq!(restart.counters.remaining, (assets.len() - cached.len()) as u64);
    settled_frame(&mut progress, restart.operation_id).await;
    drop(progress);

    // Reopening the library mid-run reads Interrupted.
    indexed.reopen().await;
    let review = indexed.review();
    let interrupted = review.measurement_status(restart.operation_id).await.unwrap();
    assert_eq!(interrupted.state, RunState::Interrupted);
    assert!(interrupted.counters.remaining > 0);
    let runs = review.list_runs(0, 10).await.unwrap();
    let runs: Vec<(Uuid, RunState)> =
        runs.iter().map(|run| (run.operation_id, run.state)).collect();
    assert_eq!(
        runs,
        [(restart.operation_id, RunState::Interrupted), (run.operation_id, RunState::Canceled)]
    );
    let states = review.frame_states(&assets).await.unwrap();
    let cached_now = states.iter().filter(|state| state.state == FrameStateKind::Cached).count();
    assert!(cached_now > cached.len());
    assert!(states
        .iter()
        .all(|state| matches!(state.state, FrameStateKind::Cached | FrameStateKind::NotMeasured)));

    let last = review.start_measurement(&assets, &[]).await.unwrap();
    assert_eq!(last.counters.already_cached, cached_now as u64);
    let last = finished(review, last.operation_id).await;
    assert_eq!(last.state, RunState::Completed);
    let states = review.frame_states(&assets).await.unwrap();
    assert!(states.iter().all(|state| state.state == FrameStateKind::Cached));
    assert_eq!(indexed.library_state().await, before);
    indexed.assert_manifest();
}

const SATURATED: (f64, f64) = (40.2, 40.7);
const FITTED: (f64, f64) = (90.4, 88.1);
/// Masked samples of the Float32 defect frame, in readout order.
const DEFECTS: [(u32, u32, f64); 3] =
    [(10, 10, f64::NAN), (11, 10, f64::INFINITY), (12, 10, f64::NEG_INFINITY)];
const BLANK_AT: (u32, u32) = (5, 5);
const CFA_GAINS: [f64; 4] = [1.0, 0.5, 0.5, 0.25];

/// A saturated and a well-exposed star, defect frames and CFA mosaics.
fn write_pixel_frames(root: &Path) -> Vec<String> {
    let stars = SyntheticFrame {
        stars: vec![
            SyntheticStar {
                x: SATURATED.0,
                y: SATURATED.1,
                amplitude: 90000.0,
                sigma_major: 2.2,
                sigma_minor: 2.0,
                angle_deg: 0.0,
            },
            SyntheticStar {
                x: FITTED.0,
                y: FITTED.1,
                amplitude: 3000.0,
                sigma_major: 2.0,
                sigma_minor: 1.7,
                angle_deg: 60.0,
            },
        ],
        clip: Some(65535.0),
        ..SyntheticFrame::new(128, 128, 61, 1000.0, 10.0)
    };
    fits_u16(&root.join("stars.fits"), &stars, &header("L", 0, 0));

    let defects = SyntheticFrame {
        overrides: DEFECTS.to_vec(),
        ..SyntheticFrame::new(64, 64, 71, 1000.0, 10.0)
    };
    let samples = quantize(&defects.render(), StoredFormat::F32, StoredScaling::IDENTITY);
    fits_file(
        &root.join("defects.fits"),
        &defects,
        &samples,
        StoredScaling::IDENTITY,
        None,
        &header("L", 0, 1),
    );

    let blank = SyntheticFrame::new(64, 64, 72, 1000.0, 10.0);
    let mut samples = quantize(&blank.render(), StoredFormat::I16, BZERO);
    assert!(set_integer(&mut samples, (BLANK_AT.1 * 64 + BLANK_AT.0) as usize, -32768));
    fits_file(&root.join("blank.fits"), &blank, &samples, BZERO, Some(-32768), &header("L", 0, 2));

    let mosaic = SyntheticFrame {
        cfa: Some(CfaModulation { gains: CFA_GAINS }),
        ..SyntheticFrame::new(64, 64, 73, 1000.0, 2.0)
    };
    let mut cards = header("L", 0, 3);
    cards.push(("BAYERPAT", "'RGGB'".into()));
    fits_u16(&root.join("cfa.fits"), &mosaic, &cards);
    xisf_u16(&root.join("cfa.xisf"), &mosaic, &header("L", 0, 4), Some("RGGB"));
    ["stars.fits", "defects.fits", "blank.fits", "cfa.fits", "cfa.xisf"].map(str::to_owned).to_vec()
}

fn nearest(stars: &[StarRecord], (x, y): (f64, f64)) -> &StarRecord {
    stars
        .iter()
        .find(|star| (star.x - x).hypot(star.y - y) < 2.0)
        .unwrap_or_else(|| panic!("no star near ({x}, {y}) in {stars:?}"))
}

fn tile_request(
    asset: Uuid,
    sha256: &str,
    region: (u32, u32, u32, u32),
    level: u8,
    stretch: Stretch,
) -> TileRequest {
    let (x, y, width, height) = region;
    TileRequest {
        asset_id: asset,
        sha256: sha256.to_owned(),
        plane: 0,
        level,
        x,
        y,
        width,
        height,
        stretch,
    }
}

/// Metric values and star positions, bit for bit.
type Bits = (Vec<(MetricId, Option<u64>)>, Vec<(u64, u64, StarState)>);

/// The metric values and stars of a measured record.
fn bits(record: &MeasurementRecord) -> Bits {
    let MeasurementOutcome::Measured { metrics, stars, .. } = &record.outcome else {
        panic!("measured outcome expected: {record:?}");
    };
    (
        metrics.iter().map(|metric| (metric.metric, metric.value.map(f64::to_bits))).collect(),
        stars.iter().map(|star| (star.x.to_bits(), star.y.to_bits(), star.state)).collect(),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stretched_tiles_and_regions_change_no_record_and_remeasuring_is_bit_identical() {
    let indexed = Indexed::new(write_pixel_frames).await;
    let review = indexed.review();
    indexed.measure_all().await;
    let before = indexed.library_state().await;
    let stars = indexed.id("stars.fits");
    let detail = review.frame_detail(stars).await.unwrap();
    let record = detail.record.clone().expect("a valid record");
    let preview = review.open_frame(stars).await.unwrap();
    assert!(preview.matches_record);
    assert_eq!(preview.sha256, indexed.manifest[&indexed.root.join("stars.fits")]);
    assert_eq!(record.basis.sha256(), Some(preview.sha256.as_str()));

    let stretches = [
        Stretch::Linear { black: 1000.0, white: 1001.0 },
        Stretch::Mtf { shadows: 0.0, midtones: 0.001, highlights: 1.0 },
        Stretch::Mtf { shadows: 0.4, midtones: 0.5, highlights: 0.41 },
        Stretch::Auto,
    ];
    for stretch in stretches {
        let tile = review
            .preview_tile(&tile_request(stars, &preview.sha256, (0, 0, 128, 128), 0, stretch))
            .await
            .unwrap();
        assert_eq!(BASE64.decode(&tile.gray).unwrap().len(), 128 * 128);
        if let Stretch::Linear { black, white } = stretch {
            assert_eq!((tile.applied_stretch.black, tile.applied_stretch.white), (black, white));
        }
        let level = review
            .preview_tile(&tile_request(stars, &preview.sha256, (0, 0, 16, 16), 3, stretch))
            .await
            .unwrap();
        assert_eq!((level.level, level.width, level.height), (3, 16, 16));
        let regions = review
            .compare_regions(&RegionsRequest {
                asset_id: stars,
                sha256: preview.sha256.clone(),
                plane: 0,
                size: 16,
                stretch,
            })
            .await
            .unwrap();
        let corners: Vec<(u32, u32)> = regions.iter().map(|tile| (tile.x, tile.y)).collect();
        assert_eq!(corners, [(56, 56), (0, 0), (112, 0), (0, 112), (112, 112)]);
        assert!(regions.iter().all(|tile| tile.level == 0 && tile.width == 16));
    }
    let after = review.frame_detail(stars).await.unwrap();
    assert_eq!(after.record.as_ref(), Some(&record), "rendering changes no record");
    assert_eq!(after.state.values, detail.state.values);
    assert_eq!(indexed.library_state().await, before);
    indexed.assert_manifest();

    // Re-measuring the same bytes in a fresh catalog yields identical values.
    let fresh = Library::open(&indexed.temp.path().join("fresh.sqlite"), None).await.unwrap();
    let location = fresh
        .register_location(
            NativePath::from_path(&indexed.root),
            "Again".into(),
            LocationRole::Captures,
        )
        .await
        .unwrap();
    assert_eq!(scan_to_end(&fresh, location.id).await.state, ScanState::Completed);
    let again: BTreeMap<String, Uuid> = fresh
        .catalog()
        .location_assets(location.id)
        .await
        .unwrap()
        .into_iter()
        .map(|asset| (asset.relative_path.display(), asset.id))
        .collect();
    let ids: Vec<Uuid> = indexed.names.iter().map(|name| again[name]).collect();
    let run = fresh.frame_review().start_measurement(&ids, &[]).await.unwrap();
    assert_eq!(finished(fresh.frame_review(), run.operation_id).await.state, RunState::Completed);
    for name in &indexed.names {
        let original = review.frame_detail(indexed.id(name)).await.unwrap().record.unwrap();
        let remeasured =
            fresh.frame_review().frame_detail(again[name]).await.unwrap().record.unwrap();
        assert_eq!(remeasured.basis.sha256(), original.basis.sha256(), "{name}");
        assert_eq!(bits(&remeasured), bits(&original), "{name}");
    }
    indexed.assert_manifest();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn saturated_and_fitted_stars_disclose_their_basis_and_cutouts_refuse_changed_bytes() {
    let indexed = Indexed::new(write_pixel_frames).await;
    let review = indexed.review();
    indexed.measure_all().await;
    let stars_id = indexed.id("stars.fits");
    let path = indexed.root.join("stars.fits");

    let stars = review.frame_stars(stars_id).await.unwrap();
    assert_eq!(stars.state.state, FrameStateKind::Cached);
    let measurement_id = stars.measurement_id.unwrap();
    let saturated = nearest(&stars.stars, SATURATED);
    assert_eq!(saturated.state, StarState::Failed);
    assert!(saturated.reasons.contains(&StarReason::Saturated));
    assert_eq!((saturated.model, saturated.fwhm_px, saturated.hfr_px), (None, None, None));
    let fitted = nearest(&stars.stars, FITTED);
    assert_eq!(fitted.state, StarState::Fitted);
    assert_eq!(fitted.model, Some(StarModel::EllipticalGaussian));
    let (fwhm, hfr) = (fitted.fwhm_px.unwrap(), fitted.hfr_px.unwrap());
    assert!(fwhm > 3.0 && hfr > 1.0 && fwhm != hfr, "fwhm {fwhm} hfr {hfr}");

    // Frame values keep FWHM and HFR distinct, in pixels, with their source.
    let values = &stars.state.values;
    let fwhm_value = value(values, MetricId::FwhmMedian);
    let hfr_value = value(values, MetricId::HfrMedian);
    assert_eq!((fwhm_value.label.as_str(), fwhm_value.units), ("FWHM (Gaussian fit)", Units::Px));
    assert_eq!((hfr_value.label.as_str(), hfr_value.units), ("HFR (half-flux radius)", Units::Px));
    assert_eq!((fwhm_value.value, hfr_value.value), (Some(fwhm), Some(hfr)));
    assert_eq!(value(values, MetricId::StarCount).value, Some(2.0));
    assert_eq!(value(values, MetricId::FittedStarCount).value, Some(1.0));

    // Cutouts: observed, fitted and residual for the fitted star; observed
    // only for the failed one.
    let sha256 = review.open_frame(stars_id).await.unwrap().sha256;
    let cutout = |star: u32, sha256: String| CutoutRequest {
        asset_id: stars_id,
        measurement_id,
        star,
        sha256,
    };
    let fitted_cutouts = review.star_cutouts(&cutout(fitted.index, sha256.clone())).await.unwrap();
    let samples = (fitted_cutouts.width * fitted_cutouts.height) as usize;
    assert!(samples >= 81, "{samples}");
    assert_eq!(fitted_cutouts.observed.len(), samples);
    assert_eq!(fitted_cutouts.fitted.as_ref().map(Vec::len), Some(samples));
    assert_eq!(fitted_cutouts.residual.as_ref().map(Vec::len), Some(samples));
    let failed_cutouts =
        review.star_cutouts(&cutout(saturated.index, sha256.clone())).await.unwrap();
    assert!(!failed_cutouts.observed.is_empty());
    assert_eq!((failed_cutouts.fitted, failed_cutouts.residual), (None, None));

    // Disclosure of an asset taken from frame_states.
    let listed = review.frame_states(&[stars_id]).await.unwrap().remove(0);
    let detail = review.frame_detail(listed.asset_id).await.unwrap();
    assert_eq!(detail.asset.id, stars_id);
    assert_eq!(detail.asset.observed.filter.as_deref(), Some("L"));
    assert_eq!(detail.asset.observed.exposure_seconds, Some(300.0));
    let record = detail.record.as_ref().unwrap();
    assert_eq!(record.id, measurement_id);
    assert_eq!(record.method, MeasurementMethod::new("platevault.stars", 1));
    assert_eq!(record.basis.container, ImageFormat::Fits);
    assert_eq!(record.basis.sha256(), Some(sha256.as_str()));
    assert_eq!(sha256, indexed.manifest[&path]);
    assert_eq!(record.basis.fingerprint.size_bytes, detail.asset.fingerprint.size_bytes);
    let decoded = record.basis.decoded.as_ref().unwrap();
    assert_eq!(decoded.plane, PlaneBasis::Mono);
    assert_eq!(
        (decoded.sample_format, decoded.width, decoded.height),
        (SampleFormat::Int16, 128, 128)
    );
    assert_eq!(decoded.scaling, Scaling { zero: 32768.0, scale: 1.0 });
    assert_eq!(decoded.saturation.source, SaturationSource::TypeMaximum);
    assert_eq!(decoded.saturation.level, Some(65535.0));
    assert_eq!(detail.state.values.len(), 7);
    for value in &detail.state.values {
        assert_eq!(value.source, built_in(), "{value:?}");
        assert!(value.value.is_some() || value.reason.is_some(), "{value:?}");
    }
    assert_eq!(value(&detail.state.values, MetricId::BackgroundMedian).units, Units::Dn);
    let wire = serde_json::to_value(&detail).unwrap();
    assert_eq!(wire["record"]["basis"]["fingerprint"]["contentSha256"], sha256.as_str());
    assert_eq!(wire["record"]["method"]["name"], "platevault.stars");
    indexed.assert_manifest();

    // Same size and modification time, different bytes: the decoded digest no
    // longer matches the record's basis.
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let mut bytes = std::fs::read(&path).unwrap();
    let last = bytes.len() - 2881;
    bytes[last] ^= 0x01;
    std::fs::write(&path, &bytes).unwrap();
    std::fs::File::options().write(true).open(&path).unwrap().set_modified(modified).unwrap();
    let changed = review.open_frame(stars_id).await.unwrap();
    assert_ne!(changed.sha256, sha256);
    assert!(!changed.matches_record);
    let refused = review.star_cutouts(&cutout(fitted.index, changed.sha256.clone())).await;
    assert!(
        matches!(refused, Err(LibraryError::Conflict { id, .. }) if id == stars_id),
        "{refused:?}"
    );
    let stale =
        review.preview_tile(&tile_request(stars_id, &sha256, (0, 0, 8, 8), 0, Stretch::Auto)).await;
    assert!(matches!(stale, Err(LibraryError::Conflict { .. })), "{stale:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn defect_and_cfa_frames_keep_masked_samples_and_mosaic_evidence() {
    let indexed = Indexed::new(write_pixel_frames).await;
    let review = indexed.review();
    let run = indexed.measure_all().await;
    assert_eq!(run.counters, counters(5, 0, 5, 0));
    let before = indexed.library_state().await;

    // Float32 frame: NaN and the infinities are counted, shown as stored and
    // excluded from every metric.
    let defects = indexed.id("defects.fits");
    let record = review.frame_detail(defects).await.unwrap().record.unwrap();
    let MeasurementOutcome::Measured { metrics, masks, .. } = &record.outcome else {
        panic!("{record:?}");
    };
    let expected = MaskCounts { nan: 1, pos_inf: 1, neg_inf: 1, blank: 0, saturated: 0 };
    assert_eq!(*masks, expected);
    let background = value(metrics, MetricId::BackgroundMedian);
    assert_eq!(background.units, Units::DataUnit);
    assert!((background.value.unwrap() - 1000.0).abs() < 2.0, "{background:?}");
    assert!(value(metrics, MetricId::BackgroundNoise).value.unwrap() < 12.0);
    let preview = review.open_frame(defects).await.unwrap();
    assert_eq!(preview.sample_format, SampleFormat::Float32);
    assert_eq!(preview.planes[0].masks, expected);
    let samples = review
        .sample_region(&SampleRequest {
            asset_id: defects,
            sha256: preview.sha256.clone(),
            plane: 0,
            x: 9,
            y: 10,
            width: 4,
            height: 1,
        })
        .await
        .unwrap();
    let categories: Vec<SampleCategory> = samples.iter().map(|sample| sample.category).collect();
    assert_eq!(
        categories,
        [
            SampleCategory::Valid,
            SampleCategory::Nan,
            SampleCategory::PosInf,
            SampleCategory::NegInf
        ]
    );
    assert_eq!((samples[1].x, samples[1].y), (10, 10));
    let wire = serde_json::to_value(&samples).unwrap();
    let shown: Vec<&serde_json::Value> =
        wire.as_array().unwrap()[1..].iter().map(|sample| &sample["value"]).collect();
    assert_eq!(shown, ["NaN", "Infinity", "-Infinity"]);
    assert_eq!(wire[1]["stored"], "NaN");
    assert!(wire[0]["value"].is_number());
    let tile = review
        .preview_tile(&tile_request(
            defects,
            &preview.sha256,
            (8, 8, 8, 8),
            0,
            Stretch::Linear { black: 900.0, white: 1100.0 },
        ))
        .await
        .unwrap();
    let mask = BASE64.decode(tile.mask.expect("masked samples carry a mask")).unwrap();
    let codes: Vec<(usize, u8)> = mask
        .iter()
        .enumerate()
        .filter(|(_, code)| **code != 0)
        .map(|(at, code)| (at, *code))
        .collect();
    assert_eq!(codes, [(18, 1), (19, 2), (20, 3)]);
    let gray = BASE64.decode(&tile.gray).unwrap();
    assert_eq!((gray[18], gray[19], gray[20]), (0, 0, 0));

    // Integer frame: the BLANK sample keeps its stored value.
    let blank = indexed.id("blank.fits");
    let preview = review.open_frame(blank).await.unwrap();
    assert_eq!(preview.blank, Some(-32768));
    assert_eq!(preview.planes[0].masks.blank, 1);
    let samples = review
        .sample_region(&SampleRequest {
            asset_id: blank,
            sha256: preview.sha256.clone(),
            plane: 0,
            x: BLANK_AT.0,
            y: BLANK_AT.1,
            width: 1,
            height: 1,
        })
        .await
        .unwrap();
    assert_eq!(samples[0].category, SampleCategory::Blank);
    assert_eq!(samples[0].stored, StoredNumber::Integer(-32768));
    let record = review.frame_detail(blank).await.unwrap().record.unwrap();
    let MeasurementOutcome::Measured { masks, .. } = &record.outcome else { panic!("{record:?}") };
    assert_eq!(masks.blank, 1);

    // CFA mosaics: recorded pattern, mosaic tiles, no star metrics.
    for (name, source) in
        [("cfa.fits", CfaSource::BayerpatKeyword), ("cfa.xisf", CfaSource::ColorFilterArray)]
    {
        let id = indexed.id(name);
        let detail = review.frame_detail(id).await.unwrap();
        let record = detail.record.unwrap();
        let PlaneBasis::CfaMosaic(evidence) = &record.basis.decoded.as_ref().unwrap().plane else {
            panic!("{name}: {:?}", record.basis);
        };
        assert_eq!(
            (evidence.pattern.as_deref(), evidence.source),
            (Some("RGGB"), source),
            "{name}"
        );
        let MeasurementOutcome::Measured { metrics, stars, .. } = &record.outcome else {
            panic!("{record:?}");
        };
        assert!(stars.is_empty());
        for metric in [
            MetricId::StarCount,
            MetricId::FittedStarCount,
            MetricId::FwhmMedian,
            MetricId::HfrMedian,
        ] {
            let unavailable = value(metrics, metric);
            assert_eq!(unavailable.state, MetricState::Unavailable, "{name} {metric:?}");
            assert_eq!(unavailable.reason.as_deref(), Some("cfa_star_metrics_unqualified"));
        }
        assert_eq!(value(metrics, MetricId::BackgroundMedian).state, MetricState::Measured);
        assert_eq!(
            detail.state.basis.as_ref().unwrap().plane.as_ref(),
            Some(&record.basis.decoded.as_ref().unwrap().plane)
        );
        let preview = review.open_frame(id).await.unwrap();
        assert!(matches!(preview.planes[0].basis, PlaneBasis::CfaMosaic(_)));
        let tile = review
            .preview_tile(&tile_request(
                id,
                &preview.sha256,
                (0, 0, 2, 2),
                0,
                Stretch::Linear { black: 0.0, white: 2000.0 },
            ))
            .await
            .unwrap();
        let gray = BASE64.decode(&tile.gray).unwrap();
        let expected: Vec<f64> =
            CFA_GAINS.iter().map(|gain| 1000.0 * gain * 255.0 / 2000.0).collect();
        for (shown, expected) in gray.iter().zip(&expected) {
            assert!(
                (f64::from(*shown) - expected).abs() <= 1.5,
                "{name}: {gray:?} vs {expected:?}"
            );
        }
    }
    assert_eq!(indexed.library_state().await, before);
    indexed.assert_manifest();
}
