// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Catalog read latency while a large index runs (astro-plan-ocyuc.6).
//!
//! One location of synthetic FITS lights (`PV_PERF_NIGHTS` x
//! `PV_PERF_PER_NIGHT`, default 40 x 500 = 20,000 files) is indexed while a
//! reader samples the status bar's reads every `PV_PERF_READ_MS` (default
//! 100 ms). The test prints p50/p95/max per read, during and after the index,
//! plus the index wall time. A release build also asserts the budget, which is
//! set for the default size (a debug build only reports):
//!
//! - `scan_status`, `list_locations`, `list_operations`: p95 <= 50 ms;
//! - `list_sessions` (default page): p95 <= 250 ms and max <= 500 ms.
//!
//! The timings depend on the host, so the test is ignored and run on demand:
//!
//! ```sh
//! cargo test --release -p platevault_core --test index_read_latency -- --ignored --nocapture
//! ```
//!
//! A loaded or swapping host fails it without a code regression: check that
//! the disk has free space and swap is not exhausted before reading a failure
//! as a defect.
#[path = "support/scan.rs"]
mod scan_support;

use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use persistence_library::SessionQuery;
use platevault_core::library::Library;
use platevault_core::{LocationRole, NativePath, ScanState};
use scan_support::ScanWatch;

const READ_BUDGET: Duration = Duration::from_millis(50);
const SESSIONS_P95_BUDGET: Duration = Duration::from_millis(250);
const SESSIONS_MAX_BUDGET: Duration = Duration::from_millis(500);
const INDEX_PATIENCE: Duration = Duration::from_mins(30);

fn setting(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// A minimal FITS light: one header block and one data block.
fn write_fits(path: &Path, cards: &[String]) {
    let mut header = Vec::new();
    for card in cards.iter().map(String::as_str).chain(["END"]) {
        let mut bytes = [b' '; 80];
        bytes[..card.len()].copy_from_slice(card.as_bytes());
        header.extend_from_slice(&bytes);
    }
    header.resize(header.len().div_ceil(2880) * 2880, b' ');
    let mut file = std::fs::File::create(path).unwrap();
    file.write_all(&header).unwrap();
    file.write_all(&[0_u8; 2880]).unwrap();
}

/// `nights` session folders of `per_night` M31 lights, 20 s apart.
fn generate(root: &Path, nights: usize, per_night: usize) {
    for night in 0..nights {
        let day = night % 28 + 1;
        let folder = root.join(format!("M31/2026-09-{day:02}_{night}/LIGHT"));
        std::fs::create_dir_all(&folder).unwrap();
        for frame in 0..per_night {
            let (hour, minute, second) = (21 + frame / 180, (frame / 3) % 60, (frame % 3) * 20);
            let cards = [
                "SIMPLE  =                    T".to_owned(),
                "BITPIX  =                   16".to_owned(),
                "NAXIS   =                    2".to_owned(),
                "NAXIS1  =                    4".to_owned(),
                "NAXIS2  =                    4".to_owned(),
                "IMAGETYP= 'LIGHT'".to_owned(),
                "OBJECT  = 'M31'".to_owned(),
                "FILTER  = 'L'".to_owned(),
                "EXPTIME =                  300".to_owned(),
                format!("DATE-OBS= '2026-09-{day:02}T{hour:02}:{minute:02}:{second:02}'"),
                "RA      =            10.684708".to_owned(),
                "DEC     =             41.26875".to_owned(),
                "FOCALLEN=                  530".to_owned(),
                "XPIXSZ  =                 3.76".to_owned(),
            ];
            write_fits(&folder.join(format!("L_{frame:04}.fits")), &cards);
        }
    }
}

/// Latencies of one read, summarised by nearest-rank percentiles.
#[derive(Default)]
struct Latencies(Vec<Duration>);

impl Latencies {
    fn time<T>(&mut self, started: Instant, value: T) -> T {
        self.0.push(started.elapsed());
        value
    }

    /// The nearest-rank `percent`ile.
    fn percentile(&self, percent: usize) -> Duration {
        let mut sorted = self.0.clone();
        sorted.sort_unstable();
        let rank = (sorted.len() * percent).div_ceil(100).clamp(1, sorted.len());
        sorted[rank - 1]
    }

    fn max(&self) -> Duration {
        self.0.iter().copied().max().unwrap_or_default()
    }

    fn report(&self, label: &str) {
        assert!(!self.0.is_empty(), "{label}: no samples");
        println!(
            "{label}: n={} p50={:.1?} p95={:.1?} max={:.1?}",
            self.0.len(),
            self.percentile(50),
            self.percentile(95),
            self.max()
        );
    }
}

#[derive(Default)]
struct Reads {
    status: Latencies,
    locations: Latencies,
    operations: Latencies,
    sessions: Latencies,
}

impl Reads {
    fn report(&self, phase: &str) {
        self.status.report(&format!("{phase} scan_status"));
        self.locations.report(&format!("{phase} list_locations"));
        self.operations.report(&format!("{phase} list_operations"));
        self.sessions.report(&format!("{phase} list_sessions"));
    }
}

/// The status bar's reads, every `every`, until `stop` is raised.
async fn sample(
    library: Arc<Library>,
    scan: uuid::Uuid,
    stop: Arc<AtomicBool>,
    every: Duration,
) -> Reads {
    let catalog = library.catalog();
    let mut reads = Reads::default();
    while !stop.load(Ordering::Acquire) {
        let started = Instant::now();
        reads.status.time(started, catalog.scan_status(scan).await.unwrap());
        let started = Instant::now();
        reads.locations.time(started, catalog.list_locations().await.unwrap());
        let started = Instant::now();
        reads.operations.time(started, catalog.list_operations(None, 0, 50).await.unwrap());
        let started = Instant::now();
        reads
            .sessions
            .time(started, catalog.list_sessions(&SessionQuery::default()).await.unwrap());
        tokio::time::sleep(every).await;
    }
    reads
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "release-build perf budget over a 20,000-file index; run with --release --ignored"]
async fn reads_stay_within_budget_during_a_large_index() {
    let nights = setting("PV_PERF_NIGHTS", 40);
    let per_night = setting("PV_PERF_PER_NIGHT", 500);
    let every = Duration::from_millis(u64::try_from(setting("PV_PERF_READ_MS", 100)).unwrap());
    let data = tempfile::tempdir().unwrap();
    let root = data.path().join("captures");
    generate(&root, nights, per_night);
    let library = Library::open(&data.path().join("catalog.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "perf".into(), LocationRole::Captures)
        .await
        .unwrap();

    let watch = ScanWatch::new(&library);
    let scan = library.start_scan(location.id, None).await.unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let sampler = tokio::spawn(sample(Arc::clone(&library), scan.id, Arc::clone(&stop), every));
    let started = Instant::now();
    let finished = watch.terminal(scan.id, INDEX_PATIENCE).await;
    let index_time = started.elapsed();
    stop.store(true, Ordering::Release);
    let during = sampler.await.unwrap();
    assert_eq!(finished.state, ScanState::Completed, "{finished:?}");
    let files = nights * per_night;
    assert_eq!(finished.progress.metadata_read, u64::try_from(files).unwrap());
    println!("index of {files} files: {index_time:.1?}");
    during.report("during");

    let stop = Arc::new(AtomicBool::new(false));
    let sampler = tokio::spawn(sample(Arc::clone(&library), scan.id, Arc::clone(&stop), every));
    tokio::time::sleep(Duration::from_secs(5)).await;
    stop.store(true, Ordering::Release);
    sampler.await.unwrap().report("idle");

    if cfg!(debug_assertions) {
        println!("debug build: the budget is for release builds and is not asserted");
        return;
    }
    for (label, reads) in [
        ("scan_status", &during.status),
        ("list_locations", &during.locations),
        ("list_operations", &during.operations),
    ] {
        let p95 = reads.percentile(95);
        assert!(p95 <= READ_BUDGET, "{label} p95 {p95:?} exceeds {READ_BUDGET:?}");
    }
    let (p95, max) = (during.sessions.percentile(95), during.sessions.max());
    assert!(
        p95 <= SESSIONS_P95_BUDGET,
        "list_sessions p95 {p95:?} exceeds {SESSIONS_P95_BUDGET:?}"
    );
    assert!(
        max <= SESSIONS_MAX_BUDGET,
        "list_sessions max {max:?} exceeds {SESSIONS_MAX_BUDGET:?}"
    );
}
