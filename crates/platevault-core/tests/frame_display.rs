// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Display-only frame review surfaces (spec 067 PIX-FR-03, PIX-FR-12,
//! PIX-AC-16): thumbnails decoded by the PIX decoder, cached against the
//! SHA-256 of the bytes they were decoded from, and the histogram of the
//! linear plane. Neither starts measurement or changes a library record, and
//! every fixture file is only ever read.
#![allow(clippy::too_many_lines, clippy::cast_precision_loss)]

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use persistence_library::SessionQuery;
use platevault_core::frame_review::FrameReview;
use platevault_core::library::{InventoryProbe, Library};
use platevault_core::*;
use platevault_pixels::display::{HISTOGRAM_BINS, THUMBNAIL_SIDE};
use platevault_pixels::fixtures::{quantize, write_fits, FitsImage, SyntheticFrame, SyntheticStar};
use platevault_pixels::{SampleFormat as StoredFormat, Scaling as StoredScaling};
use sqlx::Connection;
use uuid::Uuid;

/// FITS stores unsigned 16-bit data as signed samples with this BZERO.
const BZERO: StoredScaling = StoredScaling { zero: 32768.0, scale: 1.0 };
const BASE64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

fn header(index: usize) -> Vec<(&'static str, String)> {
    vec![
        ("IMAGETYP", "'LIGHT'".into()),
        ("INSTRUME", "'ASI2600MM'".into()),
        ("FILTER", "'Ha'".into()),
        ("EXPTIME", "300".into()),
        ("DATE-OBS", format!("'2026-09-10T20:{:02}:00'", index * 5)),
    ]
}

/// An unsigned 16-bit FITS frame of `values` (row-major plane units).
fn fits_u16(path: &Path, width: u32, height: u32, values: &[f64], index: usize) {
    let samples = quantize(values, StoredFormat::I16, BZERO);
    let cards = header(index);
    let bytes = write_fits(&FitsImage {
        width,
        height,
        channels: 1,
        samples: &samples,
        scaling: BZERO,
        blank: None,
        cards: &cards,
    })
    .unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// A 300×200 frame with one star; its thumbnail is level 1, 150×100.
fn star_frame(seed: u64) -> SyntheticFrame {
    SyntheticFrame {
        stars: vec![SyntheticStar {
            x: 120.4,
            y: 80.6,
            amplitude: 3000.0,
            sigma_major: 2.0,
            sigma_minor: 1.8,
            angle_deg: 30.0,
        }],
        ..SyntheticFrame::new(300, 200, seed, 1000.0, 10.0)
    }
}

fn write_star_frame(path: &Path, seed: u64, index: usize) {
    let frame = star_frame(seed);
    fits_u16(path, frame.width, frame.height, &frame.render(), index);
}

fn write_star_frames(root: &Path, count: usize) -> Vec<String> {
    (0..count)
        .map(|index| {
            let name = format!("Ha_{index:03}.fits");
            write_star_frame(&root.join(&name), index as u64 + 1, index);
            name
        })
        .collect()
}

/// A library over one generated root.
struct Shelf {
    _temp: tempfile::TempDir,
    database: PathBuf,
    root: PathBuf,
    library: Option<Arc<Library>>,
    location: Uuid,
    names: Vec<String>,
    ids: BTreeMap<String, Uuid>,
}

impl Shelf {
    async fn new(write: impl FnOnce(&Path) -> Vec<String>) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Captures");
        std::fs::create_dir(&root).unwrap();
        let names = write(&root);
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
        let mut shelf = Self {
            _temp: temp,
            database,
            root,
            library: Some(library),
            location: location.id,
            names,
            ids: BTreeMap::new(),
        };
        shelf.scan().await;
        shelf
    }

    /// Scan to its terminal state and re-read the asset ids.
    async fn scan(&mut self) {
        let library = Arc::clone(self.library());
        let mut progress = library.subscribe_scan_progress();
        let started = library.start_scan(self.location, None).await.unwrap();
        let finished = tokio::time::timeout(Duration::from_secs(60), async {
            loop {
                let operation = progress.recv().await.unwrap();
                if operation.id == started.id && operation.state != ScanState::Running {
                    return operation;
                }
            }
        })
        .await
        .expect("scan must publish its terminal state");
        assert_eq!(finished.state, ScanState::Completed);
        self.ids = library
            .catalog()
            .location_assets(self.location)
            .await
            .unwrap()
            .into_iter()
            .map(|asset| (asset.relative_path.display(), asset.id))
            .collect();
        assert!(self.names.iter().all(|name| self.ids.contains_key(name)));
    }

    fn library(&self) -> &Arc<Library> {
        self.library.as_ref().expect("library open")
    }

    fn review(&self) -> &FrameReview {
        self.library().frame_review()
    }

    fn path(&self, index: usize) -> PathBuf {
        self.root.join(&self.names[index])
    }

    fn assets(&self) -> Vec<Uuid> {
        self.names.iter().map(|name| self.ids[name]).collect()
    }

    /// Close the library, as an app exit does, and open it again.
    async fn reopen(&mut self) {
        self.library = None;
        self.library = Some(Library::open(&self.database, None).await.unwrap());
    }

    fn manifest(&self) -> Vec<String> {
        (0..self.names.len()).map(|index| support::digest(&self.path(index))).collect()
    }

    /// Every asset and session record with quality, decisions and digests.
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

    async fn thumbnail_rows(&self) -> i64 {
        let url = format!("sqlite://{}?mode=ro", self.database.display());
        let mut conn = sqlx::SqliteConnection::connect(&url).await.unwrap();
        let rows = sqlx::query_scalar("SELECT count(*) FROM frame_thumbnails")
            .fetch_one(&mut conn)
            .await
            .unwrap();
        conn.close().await.unwrap();
        rows
    }
}

/// Request until no thumbnail reads Pending.
async fn settled(review: &FrameReview, assets: &[Uuid]) -> Vec<ThumbnailEntry> {
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            let entries = review.thumbnails(assets).await.unwrap();
            if entries.iter().all(|entry| entry.state != ThumbnailState::Pending) {
                return entries;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("thumbnails must settle")
}

fn ready(entries: Vec<ThumbnailEntry>) -> Vec<FrameThumbnail> {
    entries
        .into_iter()
        .map(|entry| match entry.state {
            ThumbnailState::Ready { thumbnail } => {
                assert_eq!(thumbnail.asset_id, entry.asset_id);
                *thumbnail
            }
            other => panic!("expected a ready thumbnail for {}, got {other:?}", entry.asset_id),
        })
        .collect()
}

fn rewrite_in_place_keeping_stats(path: &Path, seed: u64, index: usize) {
    let original = std::fs::metadata(path).unwrap();
    write_star_frame(path, seed, index);
    let file = std::fs::File::options().write(true).open(path).unwrap();
    file.set_modified(original.modified().unwrap()).unwrap();
    let rewritten = std::fs::metadata(path).unwrap();
    assert_eq!(rewritten.len(), original.len());
    assert_eq!(rewritten.modified().unwrap(), original.modified().unwrap());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn thumbnail_cached_by_sha_and_redecoded_on_change() {
    let mut shelf = Shelf::new(|root| write_star_frames(root, 2)).await;
    let ids = shelf.assets();

    // Nothing is cached yet: every frame reads Pending while it decodes.
    let first = shelf.review().thumbnails(&ids).await.unwrap();
    assert_eq!(first.iter().map(|entry| entry.asset_id).collect::<Vec<_>>(), ids);
    assert!(first.iter().all(|entry| entry.state == ThumbnailState::Pending), "{first:?}");
    let cached = ready(settled(shelf.review(), &ids).await);
    let manifest = shelf.manifest();
    for (thumbnail, digest) in cached.iter().zip(&manifest) {
        assert_eq!(&thumbnail.sha256, digest, "bound to the bytes it was decoded from");
        assert_eq!(thumbnail.fingerprint.content_sha256.as_deref(), Some(digest.as_str()));
        let image = &thumbnail.image;
        assert_eq!((image.plane, image.level, image.width, image.height), (0, 1, 150, 100));
        assert!(image.width.max(image.height) <= THUMBNAIL_SIDE);
        assert_eq!(BASE64.decode(&image.gray).unwrap().len(), 150 * 100);
        assert_eq!(image.applied_stretch.kind, StretchKind::Auto, "a display stretch");
    }
    assert_eq!(shelf.thumbnail_rows().await, 2);

    // Served from the cache: no frame reads Pending again.
    let again = ready(shelf.review().thumbnails(&ids).await.unwrap());
    assert_eq!(again, cached);

    // Reopening shows the cached thumbnails without decoding the frames:
    // even with the source unreadable, nothing reads Pending or Unreadable.
    shelf.reopen().await;
    let path = shelf.path(0);
    let readable = std::fs::metadata(&path).unwrap().permissions();
    let mut locked = readable.clone();
    std::os::unix::fs::PermissionsExt::set_mode(&mut locked, 0o000);
    std::fs::set_permissions(&path, locked).unwrap();
    let reopened = shelf.review().thumbnails(&ids).await.unwrap();
    std::fs::set_permissions(&path, readable).unwrap();
    assert_eq!(ready(reopened), cached);

    // A digest change: bytes rewritten in place under equal size and mtime.
    // Once the catalog records the new digest the thumbnail is decoded again.
    rewrite_in_place_keeping_stats(&shelf.path(0), 101, 0);
    let digest = shelf.library().catalog().verify_digest(ids[0], InventoryProbe).await.unwrap();
    assert_eq!(digest.sha256, support::digest(&shelf.path(0)));
    let changed = shelf.review().thumbnails(&ids).await.unwrap();
    assert_eq!(changed[0].state, ThumbnailState::Pending, "{changed:?}");
    assert_eq!(changed[1].state, ThumbnailState::Ready { thumbnail: Box::new(cached[1].clone()) });
    let redecoded = ready(settled(shelf.review(), &ids).await);
    assert_eq!(redecoded[0].sha256, digest.sha256);
    assert_ne!(redecoded[0].sha256, cached[0].sha256);
    assert_ne!(redecoded[0].image.gray, cached[0].image.gray, "decoded from the new bytes");
    assert_eq!(redecoded[1], cached[1]);

    // An observation change: a rewrite with a new mtime, recorded by a scan.
    write_star_frame(&shelf.path(1), 202, 1);
    shelf.scan().await;
    assert_eq!(shelf.assets(), ids, "the rewritten frame keeps its asset");
    let observed = shelf.review().thumbnails(&ids).await.unwrap();
    let current = ThumbnailState::Ready { thumbnail: Box::new(redecoded[0].clone()) };
    assert_eq!(observed[0].state, current);
    assert_eq!(observed[1].state, ThumbnailState::Pending, "{observed:?}");
    let rescanned = ready(settled(shelf.review(), &ids).await);
    assert_eq!(rescanned[1].sha256, support::digest(&shelf.path(1)));
    assert_ne!(rescanned[1].sha256, cached[1].sha256);
    assert_eq!(shelf.thumbnail_rows().await, 2, "only the current bytes stay cached");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn thumbnail_never_starts_measurement() {
    let shelf = Shelf::new(|root| write_star_frames(root, 3)).await;
    let ids = shelf.assets();
    let manifest = shelf.manifest();
    let before = shelf.library_state().await;

    let thumbnails = ready(settled(shelf.review(), &ids).await);
    assert_eq!(thumbnails.len(), 3);
    let review = shelf.review();
    assert!(review.list_runs(0, 10).await.unwrap().is_empty(), "no measurement run exists");
    assert!(review.running_run().await.unwrap().is_none());
    for state in review.frame_states(&ids).await.unwrap() {
        assert_eq!(state.state, FrameStateKind::NotMeasured, "{state:?}");
        assert!(state.values.is_empty());
    }
    assert_eq!(shelf.library_state().await, before, "no asset, digest or session changes");
    assert_eq!(shelf.manifest(), manifest, "sources are only read");

    // Thumbnails never feed measurement: a run measures the full frame.
    let run = review.start_measurement(&ids, &[]).await.unwrap();
    let run = tokio::time::timeout(Duration::from_secs(120), async {
        loop {
            let status = review.measurement_status(run.operation_id).await.unwrap();
            if status.state != RunState::Running {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the run must settle");
    assert_eq!(run.state, RunState::Completed, "{run:?}");
    for (id, thumbnail) in ids.iter().zip(&thumbnails) {
        let detail = review.frame_detail(*id).await.unwrap();
        let record = detail.record.expect("measured");
        assert_eq!(record.basis.sha256(), Some(thumbnail.sha256.as_str()));
        let decoded = record.basis.decoded.expect("decoded basis");
        assert_eq!((decoded.width, decoded.height), (300, 200), "the full linear frame");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn histogram_bins_linear_plane_independent_of_stretch() {
    // 64×32 samples: 1000 + 10·(i mod 256) DN, so each of the 256 bins over
    // [1000, 3550] holds exactly 8 samples.
    let values: Vec<f64> =
        (0_u32..64 * 32).map(|index| 1000.0 + 10.0 * f64::from(index % 256)).collect();
    let shelf = Shelf::new(|root| {
        fits_u16(&root.join("ramp.fits"), 64, 32, &values, 0);
        vec!["ramp.fits".to_owned()]
    })
    .await;
    let asset = shelf.assets()[0];
    let review = shelf.review();
    let preview = review.open_frame(asset).await.unwrap();
    let statistics = &preview.planes[0].statistics;
    assert_eq!((statistics.min, statistics.max), (Some(1000.0), Some(3550.0)), "plane units");
    assert_eq!(statistics.histogram.len(), HISTOGRAM_BINS);
    assert_eq!(statistics.histogram, vec![8; HISTOGRAM_BINS]);
    assert_eq!(
        statistics.histogram.iter().map(|count| u64::from(*count)).sum::<u64>(),
        statistics.valid,
        "every valid sample is counted once"
    );

    // Different display stretches change the rendered gray values only.
    let tile = |stretch| TileRequest {
        asset_id: asset,
        sha256: preview.sha256.clone(),
        plane: 0,
        level: 0,
        x: 0,
        y: 0,
        width: 64,
        height: 32,
        stretch,
    };
    let mut grays = Vec::new();
    for stretch in [
        Stretch::Linear { black: 1000.0, white: 3550.0 },
        Stretch::Linear { black: 2000.0, white: 2100.0 },
        Stretch::Mtf { shadows: 0.0, midtones: 0.1, highlights: 1.0 },
        Stretch::Auto,
    ] {
        grays.push(review.preview_tile(&tile(stretch)).await.unwrap().gray);
    }
    grays.dedup();
    assert_eq!(grays.len(), 4, "each stretch renders differently");
    let thumbnail = ready(settled(review, &[asset]).await).remove(0);
    assert_eq!(thumbnail.image.applied_stretch.kind, StretchKind::Auto);
    let reopened = review.open_frame(asset).await.unwrap();
    assert_eq!(reopened.planes[0].statistics, *statistics, "the histogram never follows a stretch");
}
