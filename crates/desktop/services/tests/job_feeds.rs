// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The job-progress feeds against a real `Library` catalog: what each feed
//! yields after its progress channel lagged, which is when it re-reads durable
//! status instead of trusting the channel.
//!
//! A test makes a feed lag by not polling it while the library sends far more
//! snapshots than any progress channel retains. A snapshot that only the
//! durable resync can deliver proves the resync ran; an operation the channel
//! dropped and the feed never yields proves the lag happened.

use std::collections::HashMap;
use std::fmt::Debug;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use desktop_services::channels::Feed;
use desktop_services::jobs::{MeasurementProgressFeed, ScanProgressFeed};
use platevault_core::library::Library;
use platevault_core::{
    LocationRole, MeasurementProgress, NativePath, RunState, ScanOperation, ScanState,
};
use platevault_pixels::fixtures::{quantize, write_fits, FitsImage, SyntheticFrame, SyntheticStar};
use platevault_pixels::{SampleFormat, Scaling};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection};
use tokio::sync::broadcast;
use uuid::Uuid;

/// Scan snapshots sent after the feed's last read: past the library's
/// 128-snapshot scan channel, so the oldest unread ones are dropped. Each scan
/// test asserts that a dropped scan never reaches the feed, so a larger
/// channel fails that assertion instead of passing without a lag.
const SCAN_BURST: usize = 160;
/// Frames in the burst location: three 64-file batches per scan, so each scan
/// sends several snapshots and the burst needs few scans.
const BURST_FRAMES: u64 = 192;
/// How long one expected item may take on a loaded test runner.
const ITEM: Duration = Duration::from_secs(60);
/// After the expected items, a feed that yields nothing for this long has
/// nothing more to yield.
const PARKED: Duration = Duration::from_millis(500);
/// FITS stores unsigned 16-bit data as signed samples with this BZERO.
const BZERO: Scaling = Scaling { zero: 32768.0, scale: 1.0 };

async fn next_item<F: Feed>(feed: &mut F) -> F::Item {
    tokio::time::timeout(ITEM, feed.next())
        .await
        .expect("the feed yields its next item in time")
        .expect("the library keeps its progress channel open")
}

/// Every item up to and including the first one `last` accepts, after which
/// the feed must have nothing more to yield.
async fn drain_until<F>(feed: &mut F, last: impl Fn(&F::Item) -> bool) -> Vec<F::Item>
where
    F: Feed,
    F::Item: Debug,
{
    let mut items = Vec::new();
    loop {
        let item = next_item(feed).await;
        let done = last(&item);
        items.push(item);
        if done {
            break;
        }
    }
    // The feed is parked in its channel receive here, which is cancel-safe.
    let extra = tokio::time::timeout(PARKED, feed.next()).await;
    assert!(extra.is_err(), "nothing follows the last expected item: {extra:?}");
    items
}

/// A connection to the library's catalog beside the library's own, standing
/// in for a failure or state the library cannot be asked to produce.
async fn catalog_connection(database: &Path) -> SqliteConnection {
    let options = SqliteConnectOptions::new().filename(database).foreign_keys(false);
    SqliteConnection::connect_with(&options).await.expect("open the catalog directly")
}

/// A 64×64 frame with two stars and no capture headers: scans index it
/// without forming a session, which keeps each scan to its batch commits.
fn write_frame(path: &Path, seed: u64) {
    let star = |x, y, amplitude| SyntheticStar {
        x,
        y,
        amplitude,
        sigma_major: 2.0,
        sigma_minor: 1.8,
        angle_deg: 30.0,
    };
    let frame = SyntheticFrame {
        stars: vec![star(20.3, 21.6, 3000.0), star(44.7, 40.2, 2000.0)],
        ..SyntheticFrame::new(64, 64, seed, 1000.0, 10.0)
    };
    let samples = quantize(&frame.render(), SampleFormat::I16, BZERO);
    let bytes = write_fits(&FitsImage {
        width: frame.width,
        height: frame.height,
        channels: 1,
        samples: &samples,
        scaling: BZERO,
        blank: None,
        cards: &[],
    })
    .expect("write FITS frame");
    std::fs::write(path, bytes).expect("write frame");
}

async fn register(library: &Library, root: &Path, name: &str) -> Uuid {
    library
        .register_location(NativePath::from_path(root), name.into(), LocationRole::Captures)
        .await
        .expect("register location")
        .id
}

// ── Scan progress ────────────────────────────────────────────────────────────

/// One yielded `library_scan_progress` payload, read back from its JSON.
#[derive(Debug)]
struct Snapshot {
    operation: Uuid,
    revision: u64,
    running: bool,
}

impl Snapshot {
    fn of(event: &impl serde::Serialize) -> Self {
        let json = serde_json::to_value(event).expect("serialize the event");
        Self {
            operation: serde_json::from_value(json["operationId"].clone()).expect("operation id"),
            revision: json["revision"].as_u64().expect("revision"),
            running: json["state"] == "running",
        }
    }

    fn is_terminal_of(&self, operation: Uuid) -> bool {
        self.operation == operation && !self.running
    }
}

struct ScanWorld {
    _temp: tempfile::TempDir,
    database: PathBuf,
    library: Arc<Library>,
    /// Holds one frame: its scan sends a Running batch snapshot, then its
    /// terminal one.
    first: Uuid,
    /// Holds [`BURST_FRAMES`] frames: each scan sends one Running snapshot per
    /// batch, then its terminal one.
    second: Uuid,
    /// Reads every scan snapshot, drained after each scan so it never lags.
    witness: broadcast::Receiver<ScanOperation>,
}

impl ScanWorld {
    async fn new() -> Self {
        let temp = tempfile::tempdir().expect("temp dir");
        let database = temp.path().join("library.sqlite");
        let library = Library::open(&database, None).await.expect("open library");
        let first_root = temp.path().join("First");
        let second_root = temp.path().join("Second");
        std::fs::create_dir(&first_root).expect("create first root");
        std::fs::create_dir(&second_root).expect("create second root");
        write_frame(&first_root.join("frame_000.fits"), 1);
        for index in 1..=BURST_FRAMES {
            write_frame(&second_root.join(format!("frame_{index:03}.fits")), index + 1);
        }
        let first = register(&library, &first_root, "First").await;
        let second = register(&library, &second_root, "Second").await;
        let witness = library.subscribe_scan_progress();
        Self { _temp: temp, database, library, first, second, witness }
    }

    async fn start(&self, location: Uuid) -> Uuid {
        self.library.start_scan(location, None).await.expect("start scan").id
    }

    /// Wait for `operation`'s terminal snapshot, returning how many snapshots
    /// the library sent meanwhile.
    async fn until_terminal(&mut self, operation: Uuid) -> usize {
        let mut sent = 0;
        tokio::time::timeout(ITEM, async {
            loop {
                let snapshot = self.witness.recv().await.expect("the witness never lags");
                sent += 1;
                if snapshot.id == operation && snapshot.state != ScanState::Running {
                    return;
                }
            }
        })
        .await
        .expect("the scan must send its terminal snapshot");
        sent
    }

    /// Scan the second location until more than [`SCAN_BURST`] snapshots
    /// were sent, returning the scans in start order.
    async fn burst(&mut self) -> Vec<Uuid> {
        let mut scans = Vec::new();
        let mut sent = 0;
        while sent <= SCAN_BURST {
            let operation = self.start(self.second).await;
            sent += self.until_terminal(operation).await;
            scans.push(operation);
        }
        scans
    }

    /// A tracked scan: the feed yielded its Running snapshot, then its terminal
    /// snapshot was dropped by a burst the feed did not read.
    async fn tracked_then_lagged(&mut self, feed: &mut ScanProgressFeed) -> (Snapshot, Vec<Uuid>) {
        let tracked = self.start(self.first).await;
        let running = Snapshot::of(&next_item(feed).await);
        assert_eq!((running.operation, running.running), (tracked, true), "{running:?}");
        self.until_terminal(tracked).await;
        let burst = self.burst().await;
        (running, burst)
    }
}

/// Every snapshot up to the terminal of `operation`, then nothing.
async fn snapshots_until_terminal(feed: &mut ScanProgressFeed, operation: Uuid) -> Vec<Snapshot> {
    let events = drain_until(feed, |event| Snapshot::of(event).is_terminal_of(operation)).await;
    events.iter().map(Snapshot::of).collect()
}

/// Per operation, revisions only increase and nothing follows a terminal.
fn assert_ordered(snapshots: &[Snapshot]) {
    let mut seen: HashMap<Uuid, (u64, bool)> = HashMap::new();
    for snapshot in snapshots {
        if let Some(&(revision, running)) = seen.get(&snapshot.operation) {
            assert!(
                running,
                "a snapshot followed {}'s terminal: {snapshots:?}",
                snapshot.operation
            );
            assert!(snapshot.revision > revision, "a stale snapshot was yielded: {snapshots:?}");
        }
        seen.insert(snapshot.operation, (snapshot.revision, snapshot.running));
    }
}

/// After the channel lagged past a tracked scan's terminal, the resync yields
/// that terminal from durable status, once and before the channel resumes; the
/// resumed channel snapshots keep their order and end in the newest terminal.
#[tokio::test(flavor = "multi_thread")]
async fn a_scan_resync_yields_the_lost_terminal_before_the_channel_resumes() {
    let mut world = ScanWorld::new().await;
    let mut feed = ScanProgressFeed::subscribe(Arc::clone(&world.library));
    let (running, burst) = world.tracked_then_lagged(&mut feed).await;
    let newest = *burst.last().expect("burst scans");

    let yielded = snapshots_until_terminal(&mut feed, newest).await;

    let recovered = &yielded[0];
    assert_eq!(recovered.operation, running.operation, "the resync terminal comes first");
    assert!(!recovered.running && recovered.revision > running.revision, "{recovered:?}");
    assert_eq!(
        yielded.iter().filter(|snapshot| snapshot.operation == running.operation).count(),
        1,
        "the tracked terminal is yielded once"
    );
    assert!(
        yielded.iter().all(|snapshot| snapshot.operation != burst[0]),
        "the channel dropped the first burst scan, so the feed really lagged"
    );
    assert_ordered(&yielded);
}

/// A resync whose listing succeeds but whose re-read of a tracked operation
/// fails is logged and leaves the feed live: it resumes the channel and keeps
/// following scans that start afterwards.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_resync_read_leaves_the_scan_feed_live() {
    let mut world = ScanWorld::new().await;
    let mut feed = ScanProgressFeed::subscribe(Arc::clone(&world.library));
    let (running, burst) = world.tracked_then_lagged(&mut feed).await;
    // Without its row the listing omits the tracked operation, so the resync
    // re-reads it by id, and that read fails NotFound.
    let mut catalog = catalog_connection(&world.database).await;
    sqlx::query("DELETE FROM scan_operations WHERE id = ?1")
        .bind(running.operation.to_string())
        .execute(&mut catalog)
        .await
        .expect("remove the tracked operation");

    let yielded = snapshots_until_terminal(&mut feed, *burst.last().expect("burst scans")).await;

    assert!(
        yielded.iter().all(|snapshot| snapshot.operation != running.operation),
        "nothing is yielded for an operation the resync could not read: {yielded:?}"
    );
    assert!(yielded.iter().all(|snapshot| snapshot.operation != burst[0]), "the feed lagged");
    assert_ordered(&yielded);

    let later = world.start(world.second).await;
    world.until_terminal(later).await;
    let live = snapshots_until_terminal(&mut feed, later).await;
    assert!(
        live.iter().all(|snapshot| snapshot.operation == later),
        "a scan started after the failure is followed live: {live:?}"
    );
    assert_ordered(&live);
}

// ── Measurement progress ─────────────────────────────────────────────────────

/// Settled-frame snapshots well past the measurement channel's capacity.
const FRAMES: u64 = 300;

/// One measurement run over `FRAMES` frames, measured to completion while two
/// subscribed feeds were never polled.
struct Measured {
    _temp: tempfile::TempDir,
    database: PathBuf,
    run: Uuid,
    feeds: [MeasurementProgressFeed; 2],
}

impl Measured {
    async fn new() -> Self {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("Captures");
        std::fs::create_dir(&root).expect("create location root");
        for index in 0..FRAMES {
            write_frame(&root.join(format!("frame_{index:03}.fits")), index + 1);
        }
        let database = temp.path().join("library.sqlite");
        let library = Library::open(&database, None).await.expect("open library");
        let location = register(&library, &root, "Captures").await;
        let mut progress = library.subscribe_scan_progress();
        let scan = library.start_scan(location, None).await.expect("start scan").id;
        tokio::time::timeout(Duration::from_secs(120), async {
            loop {
                let snapshot = progress.recv().await.expect("scan progress");
                if snapshot.id == scan && snapshot.state != ScanState::Running {
                    return;
                }
            }
        })
        .await
        .expect("the scan finishes");
        let assets: Vec<Uuid> = library
            .catalog()
            .location_assets(location)
            .await
            .expect("location assets")
            .into_iter()
            .map(|asset| asset.id)
            .collect();
        assert_eq!(
            assets.len(),
            usize::try_from(FRAMES).expect("frame count"),
            "every frame indexed"
        );

        let feeds = [
            MeasurementProgressFeed::subscribe(Arc::clone(&library)),
            MeasurementProgressFeed::subscribe(Arc::clone(&library)),
        ];
        let review = library.frame_review();
        let run = review.start_measurement(&assets, &[]).await.expect("start measurement");
        let finished = tokio::time::timeout(Duration::from_secs(300), async {
            loop {
                let status = review.measurement_status(run.operation_id).await.expect("status");
                if status.state != RunState::Running {
                    return status;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the run finishes");
        assert_eq!(finished.state, RunState::Completed, "{finished:?}");
        Self { _temp: temp, database, run: run.operation_id, feeds }
    }
}

/// A frame-free snapshot: a run state change, or a durable resync.
fn frameless(progress: &MeasurementProgress) -> bool {
    progress.asset_id.is_none() && progress.frame_state.is_none()
}

fn is_terminal(progress: &MeasurementProgress) -> bool {
    frameless(progress) && progress.state == RunState::Completed
}

/// After lag, a run that already finished leaves nothing to re-read: the feed
/// resumes the channel, yields no resync snapshot, and ends in the run's
/// terminal state. Then, with the run durably Running at the next lag, the
/// resync yields that durable status without a frame, before the channel
/// resumes.
#[tokio::test(flavor = "multi_thread")]
async fn a_measurement_resync_yields_only_a_durably_running_run() {
    let Measured { _temp, database, run, feeds: [mut finished, mut running] } =
        Measured::new().await;

    let yielded = drain_until(&mut finished, is_terminal).await;
    assert!(yielded.iter().all(|progress| progress.operation_id == run));
    let settled = &yielded[..yielded.len() - 1];
    assert!(
        settled
            .iter()
            .all(|progress| progress.asset_id.is_some() && progress.frame_state.is_some()),
        "no resync snapshot, and the start event was dropped: {settled:?}"
    );
    assert!(settled.len() < usize::try_from(FRAMES).expect("frame count"), "the feed lagged");

    // The durable state a resync would read while the run was still going.
    let mut catalog = catalog_connection(&database).await;
    sqlx::query("UPDATE measurement_runs SET state = 'running', finished_at = NULL WHERE id = ?1")
        .bind(run.to_string())
        .execute(&mut catalog)
        .await
        .expect("mark the run Running");
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM measurement_runs WHERE id = ?1")
        .bind(run.to_string())
        .fetch_one(&mut catalog)
        .await
        .expect("run revision");

    let resynced = next_item(&mut running).await;
    assert!(frameless(&resynced), "{resynced:?}");
    assert_eq!(
        (resynced.operation_id, resynced.state, i64::try_from(resynced.revision).ok()),
        (run, RunState::Running, Some(revision)),
        "the durable Running status comes first"
    );
    let resumed = drain_until(&mut running, is_terminal).await;
    assert!(
        resumed[..resumed.len() - 1].iter().all(|progress| progress.asset_id.is_some()),
        "then the channel resumes with its settled frames and terminal: {resumed:?}"
    );
}
