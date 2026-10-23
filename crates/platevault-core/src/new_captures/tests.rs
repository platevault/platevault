// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! New-capture discovery over real temp folders, the real OS watcher and a
//! real catalog (bead astro-plan-ef440).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use camino::{Utf8Path, Utf8PathBuf};
use fs_inventory::artifact_watcher::{ArtifactEventKind, ArtifactFileEvent, TreeWatch};
use persistence_library::{ArchiveDraft, TrashedFrame};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    CaptureWatch, Gate, NewCaptureCount, Observed, OsProbe, RootProbe, Settings, Watched,
    WatchedRoot, SHUTDOWN_GRACE,
};
use crate::inventory::{self, Entry, Listing, RootRefusal, RootStamp};
use crate::library::{fixtures, Library};
use crate::scan_support::scan_to_end;
use crate::{
    ArchiveMoveOutcome, EntryEvidence, EntryKind, ItemReason, LibraryError, Location, LocationRole,
    NativePath, ObservationFingerprint, PathSensitivity, ReasonCode, ScanState, StorageItemDraft,
    TransferDestination,
};

/// Ticks short enough for tests; the OS watcher, walks and shutdown grace are
/// real.
const FAST: Settings = Settings {
    debounce: Duration::from_millis(50),
    sweep: Duration::from_millis(200),
    capacity: 1024,
    grace: SHUTDOWN_GRACE,
    removal_wait: Duration::from_millis(200),
};

struct Fixture {
    _dir: tempfile::TempDir,
    base: PathBuf,
    library: Arc<Library>,
}

async fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().to_path_buf();
    let library = Library::open(&base.join("catalog.sqlite"), None).await.unwrap();
    Fixture { _dir: dir, base, library }
}

async fn captures(library: &Arc<Library>, root: &Path) -> Location {
    fs::create_dir_all(root).unwrap();
    library
        .register_location(NativePath::from_path(root), "Captures".into(), LocationRole::Captures)
        .await
        .unwrap()
}

fn frame(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fixtures::fits(path, &[("IMAGETYP", "'Light Frame'"), ("FILTER", "'Ha'"), ("EXPTIME", "300")])
        .unwrap();
}

fn watch(library: &Arc<Library>) -> CaptureWatch {
    CaptureWatch::start_with(library, FAST, Arc::new(OsProbe))
}

fn new_files(counts: &[NewCaptureCount], id: Uuid) -> Option<u64> {
    counts.iter().find(|count| count.location_id == id).map(|count| count.new_files)
}

/// The counts once `done` accepts them.
async fn until(
    watch: &CaptureWatch,
    done: impl Fn(&[NewCaptureCount]) -> bool,
) -> Vec<NewCaptureCount> {
    let mut counts = watch.subscribe();
    let reached = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            {
                let now = counts.borrow_and_update();
                if done(&now) {
                    return now.clone();
                }
            }
            counts.changed().await.expect("discovery keeps running");
        }
    })
    .await;
    reached.unwrap_or_else(|_| panic!("counts never matched; last {:?}", watch.counts()))
}

async fn count_is(watch: &CaptureWatch, id: Uuid, expected: u64) -> Vec<NewCaptureCount> {
    until(watch, |counts| new_files(counts, id) == Some(expected)).await
}

/// Wait until the location's count is `new_files` and live: a walk that
/// reconciles the count after a restart of its watcher has ended.
async fn live_count_is(watch: &CaptureWatch, id: Uuid, new_files: u64) {
    let live = [NewCaptureCount { location_id: id, new_files, live: true }];
    until(watch, |counts| counts == live).await;
}

/// Wait until `holds`, checking every few milliseconds.
async fn eventually(what: &str, holds: impl Fn() -> bool) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while !holds() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("never: {what}"));
}

fn walks(watch: &CaptureWatch) -> usize {
    watch.observed().walks.load(Ordering::SeqCst)
}

fn watchers(watch: &CaptureWatch) -> usize {
    watch.observed().watchers.load(Ordering::SeqCst)
}

/// Wait until discovery holds `held` OS watchers.
async fn watchers_are(watch: &CaptureWatch, held: usize) {
    eventually(&format!("{held} watchers held"), || watchers(watch) == held).await;
}

fn sweeps(observed: &Observed) -> &AtomicUsize {
    &observed.sweeps
}

fn drains(observed: &Observed) -> &AtomicUsize {
    &observed.drains
}

/// Wait until `ticks` more ticks of the kind `counter` counts started and
/// ended after this call, their counts published. Ticks of every kind run
/// one after another, so a tick has ended, and its counts are published,
/// once the next one started.
async fn after(watch: &CaptureWatch, counter: fn(&Observed) -> &AtomicUsize, ticks: usize) {
    let counter = counter(watch.observed());
    let mark = counter.load(Ordering::SeqCst);
    eventually(&format!("{ticks} more ticks"), || counter.load(Ordering::SeqCst) > mark + ticks)
        .await;
}

/// Wait until a call waits at `gate`.
async fn holding(gate: &Gate) {
    eventually("a call waits at the gate", || gate.held()).await;
}

/// Opens a gate when dropped, so a failing test never leaves a thread
/// waiting at it.
struct Opens<'a>(&'a Gate);

impl Drop for Opens<'_> {
    fn drop(&mut self) {
        self.0.open();
    }
}

/// The OS probe, counting how often discovery touches the root; its root
/// `stat`s and its listings wait at their gates. The next watchers it starts
/// can fail or leave a folder unwatched, at once; the healthy ones after
/// them wait at their gate.
#[derive(Default)]
struct Probe {
    stats: AtomicUsize,
    validations: AtomicUsize,
    stat_gate: Gate,
    list_gate: Gate,
    watch_gate: Gate,
    /// Watchers started, or failed to.
    watches: AtomicUsize,
    /// How many of the next watchers fail to start, as when Linux has no
    /// inotify instance left.
    failing: AtomicUsize,
    /// How many of the next watchers start with a folder a walk lists (the
    /// root) refused.
    partial: AtomicUsize,
    /// A folder, with a frame, that the next watcher start creates after it
    /// listed the tree and before it registered it: neither listed nor
    /// reported, as one created in that window on a slow tree is.
    late: Mutex<Option<PathBuf>>,
    /// A folder every watcher start reports refused, as Windows refuses
    /// `System Volume Information`.
    refused: Mutex<Option<PathBuf>>,
    /// How many of the next validations cannot observe the root, as when a
    /// volume query fails once.
    unobserved: AtomicUsize,
    /// Whether the watchers it starts deliver no event while they watch, as
    /// when a folder becomes readable without one.
    deaf: AtomicBool,
    /// Events the test sends, delivered by the next watcher it starts in
    /// place of the OS's.
    feed: Mutex<Option<tokio::sync::mpsc::Receiver<ArtifactFileEvent>>>,
    /// How many paths that live events named were read below a root.
    entries: AtomicUsize,
    /// Run once just before the lookup of a path a live event named reads
    /// the metadata of the given path; its error is that read's error, as a
    /// share's brief I/O error is. It can also change the tree mid-lookup.
    before_stat: Mutex<Option<StatHook>>,
    /// Canonical paths resolved, or failed to.
    canonicals: AtomicUsize,
    /// How many of the next canonical paths cannot be resolved, as when a
    /// linked folder above the root briefly cannot be read.
    uncanonical: AtomicUsize,
}

/// A path, and what to do just before its metadata is read.
type StatHook = (PathBuf, Box<dyn FnOnce() -> std::io::Result<()> + Send>);

/// Take one from `counter` unless it is zero.
fn take_one(counter: &AtomicUsize) -> bool {
    counter.try_update(Ordering::SeqCst, Ordering::SeqCst, |left| left.checked_sub(1)).is_ok()
}

/// Discovery of `library` through `probe`.
fn probed(library: &Arc<Library>, probe: &Arc<Probe>) -> CaptureWatch {
    CaptureWatch::start_with(library, FAST, Arc::clone(probe) as Arc<dyn RootProbe>)
}

impl RootProbe for Probe {
    fn stamp(&self, root: &Path) -> Option<RootStamp> {
        self.stats.fetch_add(1, Ordering::SeqCst);
        self.stat_gate.pass();
        OsProbe.stamp(root)
    }

    fn validate(&self, location: &Location) -> Result<(), RootRefusal> {
        self.validations.fetch_add(1, Ordering::SeqCst);
        if take_one(&self.unobserved) {
            let error = LibraryError::IdentityConflict("volume query timed out".into());
            return Err(RootRefusal::Unobserved(error));
        }
        OsProbe.validate(location)
    }

    fn watch(&self, root: &Utf8Path, capacity: usize) -> Result<TreeWatch, String> {
        self.watches.fetch_add(1, Ordering::SeqCst);
        if take_one(&self.failing) {
            return Err("inotify_init: too many open files".into());
        }
        let mut started = if take_one(&self.partial) {
            let mut started = OsProbe.watch(root, capacity)?;
            started.refused.push(root.as_std_path().to_path_buf());
            started
        } else {
            self.watch_gate.pass();
            let late = self.late.lock().unwrap().take();
            if let Some(late) = late {
                frame(&late.join("Ha_late.fits"));
                let mut started = OsProbe.watch(root, capacity)?;
                started.folders.retain(|listed| *listed != late);
                started
            } else {
                OsProbe.watch(root, capacity)?
            }
        };
        let refused = self.refused.lock().unwrap().clone();
        started.refused.extend(refused);
        if self.deaf.load(Ordering::SeqCst) {
            // The watcher still holds its folders; its events go nowhere.
            started.events = tokio::sync::mpsc::channel(1).1;
        }
        if let Some(fed) = self.feed.lock().unwrap().take() {
            started.events = fed;
        }
        Ok(started)
    }

    fn list(
        &self,
        root: &Path,
        stamp: RootStamp,
        canceled: &AtomicBool,
    ) -> Result<Listing, LibraryError> {
        self.list_gate.pass();
        OsProbe.list(root, stamp, canceled)
    }

    fn entry(&self, root: &Path, stamp: RootStamp, relative: &Path) -> Entry {
        self.entries.fetch_add(1, Ordering::SeqCst);
        inventory::entry_at_with(root, stamp, relative, |path| {
            let hook = {
                let mut hook = self.before_stat.lock().unwrap();
                hook.take_if(|(at, _)| *at == path)
            };
            if let Some((_, run)) = hook {
                run()?;
            }
            fs::symlink_metadata(path)
        })
    }

    fn canonical(&self, root: &Path) -> std::io::Result<PathBuf> {
        self.canonicals.fetch_add(1, Ordering::SeqCst);
        if take_one(&self.uncanonical) {
            return Err(std::io::Error::other("a linked folder above the root did not answer"));
        }
        OsProbe.canonical(root)
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn files_copied_into_an_online_location_are_counted_without_a_rescan() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 0).await;

    for name in ["Ha_001.fits", "Ha_002.fits", "Ha_003.xisf"] {
        if name.ends_with("xisf") {
            fixtures::xisf(&root.join(name), &[("IMAGETYP", "Light Frame")]).unwrap();
        } else {
            frame(&root.join(name));
        }
    }
    fs::write(root.join("notes.txt"), b"not a frame").unwrap();

    let counts = count_is(&watch, location.id, 3).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 3, live: true }]);
    assert_eq!(walks(&watch), 1, "live events, no rescan");
    let indexed = fx.library.catalog().location_recorded_paths(location.id).await.unwrap();
    assert!(indexed.is_empty(), "discovery writes nothing to the catalog");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn files_added_while_the_app_was_closed_are_counted_at_the_next_start() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("2026-10-12/Ha_001.fits"));
    let first = watch(&fx.library);
    count_is(&first, location.id, 1).await;
    first.shutdown().await;

    frame(&root.join("2026-10-13/Ha_001.fits"));
    frame(&root.join("2026-10-13/Ha_002.fits"));

    let next = watch(&fx.library);
    count_is(&next, location.id, 3).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_file_seen_by_the_walk_and_the_watcher_counts_once() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    frame(&root.join("M\u{e9}ridien.fits"));

    let watch = watch(&fx.library);
    // Rewritten while the start-up walk may still run: both see it.
    frame(&root.join("Ha_001.fits"));
    count_is(&watch, location.id, 2).await;

    // Written again, and renamed in case only, after the walk. The frame
    // written after them counts once their events were applied, and the
    // new spelling is the one counted.
    frame(&root.join("Ha_001.fits"));
    fs::rename(root.join("Ha_001.fits"), root.join("ha_001.fits")).unwrap();
    frame(&root.join("Ha_002.fits"));
    count_is(&watch, location.id, 3).await;
    fs::remove_file(root.join("ha_001.fits")).unwrap();
    count_is(&watch, location.id, 2).await;

    // The decomposed spelling is the same file exactly where the indexer's
    // name comparison says so: there, removing the composed spelling removes
    // the only file both name.
    let volume = &location.identity.volume;
    let composed = NativePath::from_path(Path::new("M\u{e9}ridien.fits"));
    let decomposed = NativePath::from_path(Path::new("Me\u{301}ridien.fits"));
    let expected = if composed.same_on(&decomposed, volume) { 2 } else { 3 };
    frame(&root.join("Me\u{301}ridien.fits"));
    count_is(&watch, location.id, expected).await;
    fs::remove_file(root.join("M\u{e9}ridien.fits")).unwrap();
    count_is(&watch, location.id, expected - 1).await;
    assert_eq!(walks(&watch), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_new_file_removed_or_renamed_before_import_leaves_the_count() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 0).await;
    for name in ["a.fits", "b.fits", "c.fits"] {
        frame(&root.join(name));
    }
    count_is(&watch, location.id, 3).await;

    fs::remove_file(root.join("a.fits")).unwrap();
    count_is(&watch, location.id, 2).await;
    // A rename is a removal plus an addition. The frame written after it
    // counts once both were applied, and the new name is the one counted.
    fs::rename(root.join("b.fits"), root.join("b-renamed.fits")).unwrap();
    frame(&root.join("d.fits"));
    count_is(&watch, location.id, 3).await;
    fs::remove_file(root.join("b-renamed.fits")).unwrap();
    count_is(&watch, location.id, 2).await;
    fs::rename(root.join("c.fits"), root.join("c.fits.bak")).unwrap();
    count_is(&watch, location.id, 1).await;

    // A frame moved in from outside the root is a live event, not a rescan.
    let walked = walks(&watch);
    frame(&fx.base.join("outside/e.fits"));
    fs::rename(fx.base.join("outside/e.fits"), root.join("e.fits")).unwrap();
    count_is(&watch, location.id, 2).await;
    assert_eq!(walks(&watch), walked, "a file moved in is counted live");

    // A night folder moved in brings frames no live event names: the watcher
    // asks for a rescan (as for an OS watcher error), which walks again.
    let staged = fx.base.join("staged night");
    frame(&staged.join("f.fits"));
    frame(&staged.join("g.fits"));
    fs::rename(&staged, root.join("2026-10-14")).unwrap();
    count_is(&watch, location.id, 4).await;
    assert!(walks(&watch) > walked, "the new folder walked again");
    // Removing the folder removes what it held.
    fs::remove_dir_all(root.join("2026-10-14")).unwrap();
    count_is(&watch, location.id, 2).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn indexed_files_leave_the_count() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    frame(&root.join("Ha_002.fits"));
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 2).await;

    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    count_is(&watch, location.id, 0).await;
    frame(&root.join("Ha_003.fits"));
    count_is(&watch, location.id, 1).await;
}

/// The frames whose records [`vacate_and_refill`] vacates: two the OS Trash
/// takes, recorded Trashed, and two that leave the drive, recorded Missing.
const TRASHED: [&str; 2] = ["Ha_001.fits", "Ha_002.fits"];
const MISSING: [&str; 2] = ["Ha_003.fits", "Ha_004.fits"];

/// A frame other than the one [`frame`] writes, written now.
fn other_frame(path: &Path) {
    fixtures::fits(
        path,
        &[("IMAGETYP", "'Light Frame'"), ("FILTER", "'OIII'"), ("EXPTIME", "120")],
    )
    .unwrap();
}

/// Move a file, which keeps its size and modification time, as the OS Trash
/// does, and as putting it back does.
fn move_file(from: &Path, to: &Path) {
    fs::create_dir_all(to.parent().unwrap()).unwrap();
    fs::rename(from, to).unwrap();
}

/// Where [`vacate`] moves [`TRASHED`] and [`MISSING`]: a stand-in OS Trash,
/// and another drive.
fn bin(fx: &Fixture) -> PathBuf {
    fx.base.join("Trash")
}

fn aside(fx: &Fixture) -> PathBuf {
    fx.base.join("aside")
}

/// Vacate the records of [`MISSING`] and the files of [`TRASHED`], frames
/// indexed at `root`, the root of `location`: the first leave the drive and
/// a scan records them Missing, and the others go to the OS Trash
/// ([`bin`]). Returns the [`TRASHED`] frames as custody records them once
/// the OS Trash took them.
async fn vacate(fx: &Fixture, location: &Location, root: &Path) -> Vec<TrashedFrame> {
    for name in MISSING {
        move_file(&root.join(name), &aside(fx).join(name));
    }
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    let assets = fx.library.catalog().location_assets(location.id).await.unwrap();
    let mut trashed = Vec::new();
    for name in TRASHED {
        let relative = NativePath::from_path(Path::new(name));
        let asset = assets.iter().find(|asset| asset.relative_path == relative).unwrap();
        let sha256 = hex::encode(Sha256::digest(fs::read(root.join(name)).unwrap()));
        move_file(&root.join(name), &bin(fx).join(name));
        trashed.push(TrashedFrame { asset_id: asset.id, sha256 });
    }
    trashed
}

/// A frame at the path of a Missing or Trashed record is new unless it is
/// the record's file put back, with the size and modification time the
/// record last observed (bead astro-plan-0rfuw): the start-up walk counts
/// the other frame at one path of each, not the originals put back at the
/// others, and a scan, which returns all four records, leaves none.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_start_up_walk_counts_a_frame_at_a_vacated_path_unless_its_file_was_put_back() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    for name in TRASHED.iter().chain(&MISSING) {
        frame(&root.join(name));
    }
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    let trashed = vacate(&fx, &location, &root).await;
    fx.library.record_trashed(Uuid::new_v4(), &trashed).await.unwrap();
    other_frame(&root.join(TRASHED[0]));
    other_frame(&root.join(MISSING[0]));
    move_file(&bin(&fx).join(TRASHED[1]), &root.join(TRASHED[1]));
    move_file(&aside(&fx).join(MISSING[1]), &root.join(MISSING[1]));

    let watch = watch(&fx.library);
    count_is(&watch, location.id, 2).await;
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    count_is(&watch, location.id, 0).await;
}

/// As [`the_start_up_walk_counts_a_frame_at_a_vacated_path_unless_its_file_was_put_back`],
/// with every change made while discovery runs, which live events count.
/// A frame written in place of a trashed one before custody recorded the
/// trash is judged again once it did.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_live_event_counts_a_frame_at_a_vacated_path_unless_its_file_was_put_back() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    for name in TRASHED.iter().chain(&MISSING) {
        frame(&root.join(name));
    }
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 4).await;
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    count_is(&watch, location.id, 0).await;

    let trashed = vacate(&fx, &location, &root).await;
    // Written before the trash is recorded: its path still holds a file the
    // catalog holds. The frame at the Missing path, written after it, counts.
    other_frame(&root.join(TRASHED[0]));
    move_file(&aside(&fx).join(MISSING[1]), &root.join(MISSING[1]));
    other_frame(&root.join(MISSING[0]));
    count_is(&watch, location.id, 1).await;

    fx.library.record_trashed(Uuid::new_v4(), &trashed).await.unwrap();
    count_is(&watch, location.id, 2).await;
    move_file(&bin(&fx).join(TRASHED[1]), &root.join(TRASHED[1]));
    // Every event the changes raised was applied: the count stays.
    after(&watch, drains, 3).await;
    assert_eq!(new_files(&watch.counts(), location.id), Some(2));
    assert_eq!(walks(&watch), 1, "live events, no rescan");
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    count_is(&watch, location.id, 0).await;
}

/// A record an archive moved to another location leaves its path, though
/// it was never Missing or Trashed. A frame written there before the move,
/// judged held, is looked up again once the move is announced
/// ([`Library::recorded_paths_changed`]) and counts; the archive's copy,
/// counted while its record had not moved yet, leaves the other count.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_record_moved_away_is_counted_where_it_left_and_not_where_it_went() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let archive_root = fx.base.join("Archive");
    let archive = captures(&fx.library, &archive_root).await;
    let name = TRASHED[0];
    frame(&root.join(name));
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 0).await;
    count_is(&watch, archive.id, 0).await;

    // Before the record moves: the copy lands in the archive, the original
    // goes to the OS Trash and another frame takes its path, judged held.
    // The frame written last, at a new path, counts once the events before
    // it were applied.
    fs::copy(root.join(name), archive_root.join(name)).unwrap();
    move_file(&root.join(name), &bin(&fx).join(name));
    other_frame(&root.join(name));
    other_frame(&root.join(MISSING[0]));
    count_is(&watch, location.id, 1).await;
    count_is(&watch, archive.id, 1).await;

    // The record moves to the copy, as `move_asset_record` does.
    let mut catalog = raw_catalog(&fx).await;
    sqlx::query("UPDATE assets SET location_id = ?1 WHERE location_id = ?2")
        .bind(archive.id.to_string())
        .bind(location.id.to_string())
        .execute(&mut catalog)
        .await
        .unwrap();
    fx.library.recorded_paths_changed(location.id);
    fx.library.recorded_paths_changed(archive.id);
    count_is(&watch, location.id, 2).await;
    count_is(&watch, archive.id, 0).await;
    assert_eq!(walks(&watch), 2, "the start-up walks only: no rescan");
}

/// Journal Sessions > Archive of the frame at `name` in `location` to the
/// same path in `archive`, and move its record to the copy there, as the
/// archive does once the copy verified. The move stays unsettled: its
/// original waits at its path to be retired. Returns the storage operation.
async fn archive_in_flight(
    fx: &Fixture,
    location: &Location,
    archive: &Location,
    name: &str,
) -> Uuid {
    let catalog = fx.library.catalog();
    let relative = NativePath::from_path(Path::new(name));
    let assets = catalog.location_assets(location.id).await.unwrap();
    let asset = assets.into_iter().find(|asset| asset.relative_path == relative).unwrap();
    let session: String = sqlx::query_scalar("SELECT session_id FROM assets WHERE id = ?1")
        .bind(asset.id.to_string())
        .fetch_one(&mut raw_catalog(fx).await)
        .await
        .unwrap();
    let original = location.path.to_path_buf().unwrap().join(name);
    let sha256 = hex::encode(Sha256::digest(fs::read(&original).unwrap()));
    let draft = ArchiveDraft {
        session_id: Uuid::parse_str(&session).unwrap(),
        asset: asset.clone(),
        to_location_id: archive.id,
        to_path: relative.clone(),
        links: Vec::new(),
        draft: StorageItemDraft {
            source: EntryEvidence {
                path: NativePath::from_path(&original),
                root: None,
                kind: EntryKind::File,
                fingerprint: ObservationFingerprint {
                    content_sha256: None,
                    ..asset.fingerprint.clone()
                },
                sha256: Some(sha256.clone()),
            },
            relied_on: Vec::new(),
            destination: Some(TransferDestination { root: archive.path.clone(), relative }),
        },
    };
    let storage = catalog.begin_sessions_archive(&[draft]).await.unwrap();
    let copy = ObservationFingerprint { content_sha256: Some(sha256), ..asset.fingerprint };
    catalog.record_archive_repoint(storage, 0, &copy).await.unwrap();
    storage
}

/// An archive moves a frame's record to the verified copy before it retires
/// the original, which waits at its path meanwhile. Discovery holds it there
/// by the size and time the move started from, whether a recount or a
/// start-up walk reads the location in that gap; only a new frame counts.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_original_its_archive_has_not_retired_yet_stays_held() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let archive_root = fx.base.join("Archive");
    let archive = captures(&fx.library, &archive_root).await;
    let name = TRASHED[0];
    frame(&root.join(name));
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    let counting = watch(&fx.library);
    count_is(&counting, location.id, 0).await;

    fs::copy(root.join(name), archive_root.join(name)).unwrap();
    archive_in_flight(&fx, &location, &archive, name).await;
    // A new frame, counted once the events before it were applied.
    other_frame(&root.join(MISSING[0]));
    count_is(&counting, location.id, 1).await;
    let recounts = || counting.observed().recounts.load(Ordering::SeqCst);
    let before = recounts();
    fx.library.recorded_paths_changed(location.id);
    eventually("the source was recounted", || recounts() > before).await;
    after(&counting, drains, 1).await;
    let recounted = new_files(&counting.counts(), location.id);
    counting.shutdown().await;

    // A start-up walk in the same gap, as after a stop.
    let walking = watch(&fx.library);
    let walked = until(&walking, |counts| new_files(counts, location.id).is_some()).await;
    assert_eq!(
        (recounted, new_files(&walked, location.id)),
        (Some(1), Some(1)),
        "(recount, walk): the original waiting at its path is held, the new frame counts"
    );
}

/// Once an archive move settles, the source no longer records the path its
/// record left. An original the archive kept beside its copy (source
/// retained, as on a volume with no OS Trash) is then a file the library
/// doesn't hold there and counts once the settle is announced, with no walk;
/// an original the archive retired leaves nothing new to count.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_settled_archive_counts_the_original_it_kept_and_not_one_it_retired() {
    for retired in [false, true] {
        let fx = fixture().await;
        let root = fx.base.join("Captures");
        let location = captures(&fx.library, &root).await;
        let archive_root = fx.base.join("Archive");
        let archive = captures(&fx.library, &archive_root).await;
        let name = TRASHED[0];
        frame(&root.join(name));
        assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
        let watch = watch(&fx.library);
        count_is(&watch, location.id, 0).await;

        fs::copy(root.join(name), archive_root.join(name)).unwrap();
        let storage = archive_in_flight(&fx, &location, &archive, name).await;
        // A new frame, counted once the events before it were applied.
        other_frame(&root.join(MISSING[0]));
        count_is(&watch, location.id, 1).await;
        let recounts = || watch.observed().recounts.load(Ordering::SeqCst);
        let before = recounts();
        fx.library.recorded_paths_changed(location.id);
        eventually("the source was recounted", || recounts() > before).await;
        after(&watch, drains, 1).await;
        assert_eq!(new_files(&watch.counts(), location.id), Some(1), "held while in flight");

        let (outcome, reason) = if retired {
            move_file(&root.join(name), &bin(&fx).join(name));
            (ArchiveMoveOutcome::Archived, None)
        } else {
            let kept = ItemReason::new(ReasonCode::TrashUnsupported, "the volume has no Trash");
            (ArchiveMoveOutcome::SourceRetained, Some(kept))
        };
        let catalog = fx.library.catalog();
        catalog.settle_archive_move(storage, 0, outcome, reason.as_ref()).await.unwrap();
        let before = recounts();
        fx.library.recorded_paths_changed(location.id);
        if retired {
            eventually("the source was recounted", || recounts() > before).await;
            after(&watch, drains, 1).await;
            assert_eq!(new_files(&watch.counts(), location.id), Some(1), "the original is gone");
        } else {
            count_is(&watch, location.id, 2).await;
        }
        assert_eq!(walks(&watch), 2, "the start-up walks only: no rescan");
        watch.shutdown().await;
    }
}

/// A frame at a Missing record's path that kept the record's modification
/// time but not its size (the original grown by one FITS block, its time put
/// back) is not the original: the start-up walk counts it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_frame_at_a_vacated_path_with_its_time_but_not_its_size_counts() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let path = root.join(MISSING[0]);
    frame(&path);
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    let mut bytes = fs::read(&path).unwrap();
    fs::remove_file(&path).unwrap();
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);

    bytes.extend([0_u8; 2880]);
    fs::write(&path, &bytes).unwrap();
    fs::File::options().write(true).open(&path).unwrap().set_modified(modified).unwrap();
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 1).await;
}

/// A trash run recorded frame by frame reads the location's catalog paths
/// at most once per debounce tick, not once per frame.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_trash_run_of_many_frames_is_recounted_once_per_tick() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    for n in 1..=10 {
        frame(&root.join(format!("Ha_{n:03}.fits")));
    }
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    // Count every debounce tick during the run rather than assuming it fits
    // between two ticks on every runner.
    let slow = Settings { debounce: Duration::from_secs(2), ..FAST };
    let watch = CaptureWatch::start_with(&fx.library, slow, Arc::new(OsProbe));
    count_is(&watch, location.id, 0).await;
    let recounts = || watch.observed().recounts.load(Ordering::SeqCst);
    let assets = fx.library.catalog().location_assets(location.id).await.unwrap();
    let frames: Vec<_> = assets
        .iter()
        .map(|asset| {
            let path = root.join(asset.relative_path.to_path_buf().unwrap());
            let sha256 = hex::encode(Sha256::digest(fs::read(path).unwrap()));
            TrashedFrame { asset_id: asset.id, sha256 }
        })
        .collect();
    let before = recounts();
    let ticks_before = drains(watch.observed()).load(Ordering::SeqCst);
    for frame in frames {
        fx.library.record_trashed(Uuid::new_v4(), &[frame]).await.unwrap();
    }
    eventually("the trash run was recounted", || recounts() > before).await;
    after(&watch, drains, 1).await;
    let recounted = recounts() - before;
    let elapsed_ticks = drains(watch.observed()).load(Ordering::SeqCst) - ticks_before;
    assert!(
        recounted <= elapsed_ticks,
        "{recounted} recounts for {elapsed_ticks} debounce ticks and {} trashed frames",
        assets.len()
    );
    assert_eq!(new_files(&watch.counts(), location.id), Some(0), "the originals are held");
}

/// A raw connection to the fixture's catalog, for failures no library
/// command causes.
async fn raw_catalog(fx: &Fixture) -> sqlx::SqliteConnection {
    use sqlx::Connection as _;
    let url = format!("sqlite://{}", fx.base.join("catalog.sqlite").display());
    sqlx::SqliteConnection::connect(&url).await.unwrap()
}

/// Make the catalog's indexed paths unreadable, or readable again.
async fn hide_assets(connection: &mut sqlx::SqliteConnection, hidden: bool) {
    let rename = if hidden {
        "ALTER TABLE assets RENAME TO assets_hidden"
    } else {
        "ALTER TABLE assets_hidden RENAME TO assets"
    };
    sqlx::query(rename).execute(connection).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unreadable_catalog_keeps_the_location_online_and_is_read_again() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    let mut catalog = raw_catalog(&fx).await;

    // The start-up walk lists the root, but what the catalog holds there is
    // unknown: the location keeps its watcher and is not walked again.
    hide_assets(&mut catalog, true).await;
    let watch = watch(&fx.library);
    eventually("the start-up walk ran", || walks(&watch) == 1).await;
    after(&watch, sweeps, 2).await;
    assert_eq!(watch.counts(), Vec::<NewCaptureCount>::new(), "not counted before the catalog");
    assert_eq!((watchers(&watch), walks(&watch)), (1, 1));
    // Read again at the next tick once it answers: the frame is indexed.
    hide_assets(&mut catalog, false).await;
    count_is(&watch, location.id, 0).await;

    // A later walk keeps counting from what the catalog held before.
    hide_assets(&mut catalog, true).await;
    frame(&root.join("2026-10-15/Ha_002.fits"));
    live_count_is(&watch, location.id, 1).await;
    assert_eq!(walks(&watch), 2);
    // The new folder restarted the watcher; the old one closes off the
    // runtime.
    watchers_are(&watch, 1).await;
    hide_assets(&mut catalog, false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_scan_that_ends_while_a_walk_lists_is_counted_after_it() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    frame(&root.join("Ha_002.fits"));
    let probe = Arc::new(Probe::default());
    probe.list_gate.close();
    let watch = probed(&fx.library, &probe);

    // The start-up walk read the catalog, empty then, and now lists.
    holding(&probe.list_gate).await;
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    probe.list_gate.open();

    let counts = count_is(&watch, location.id, 0).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: true }]);
    assert_eq!(walks(&watch), 1, "the catalog is read again, not the folder");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_overflowing_event_channel_triggers_a_rescan() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let watch =
        CaptureWatch::start_with(&fx.library, Settings { capacity: 1, ..FAST }, Arc::new(OsProbe));
    count_is(&watch, location.id, 0).await;

    for index in 0..40 {
        frame(&root.join(format!("Ha_{index:03}.fits")));
    }

    count_is(&watch, location.id, 40).await;
    assert!(walks(&watch) >= 2, "the overflow walked again");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_folder_created_while_the_watcher_starts_is_watched_after_the_walk() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    *probe.late.lock().unwrap() = Some(root.join("2026-10-15"));
    let watch = probed(&fx.library, &probe);

    // The start-up walk enters a folder the watcher did not list, so the
    // watcher starts again over it and the walk is redone.
    eventually("the watcher restarted", || probe.watches.load(Ordering::SeqCst) >= 2).await;
    live_count_is(&watch, location.id, 1).await;
    frame(&root.join("2026-10-15/Ha_002.fits"));
    count_is(&watch, location.id, 2).await;
    // On macOS `FSEvents` may also report the folder's creation, made just
    // before the first watcher started, to the second one, which restarts
    // once more. inotify and `ReadDirectoryChangesW` report nothing from
    // before a watch was registered, so elsewhere a third start is a bug.
    after(&watch, sweeps, 1).await;
    let settled = (probe.watches.load(Ordering::SeqCst), walks(&watch));
    let fsevents_replay = cfg!(target_os = "macos") && settled == (3, 3);
    assert!(settled == (2, 2) || fsevents_replay, "restarted {settled:?}");
    after(&watch, sweeps, 2).await;
    assert_eq!((probe.watches.load(Ordering::SeqCst), walks(&watch)), settled, "settled");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_watcher_that_did_not_start_is_retried_at_the_next_sweep() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    probe.failing.store(1, Ordering::SeqCst);
    probe.watch_gate.close();
    let watch = probed(&fx.library, &probe);

    let counts = count_is(&watch, location.id, 0).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: false }]);
    assert_eq!(watchers(&watch), 0);
    // A sweep starts the watcher again, and it waits at the gate: what
    // arrives meanwhile is not counted live, but by the walk that follows.
    holding(&probe.watch_gate).await;
    frame(&root.join("Ha_001.fits"));
    probe.watch_gate.open();
    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: true }]);
    assert_eq!((probe.watches.load(Ordering::SeqCst), walks(&watch)), (2, 2));

    // Live now, and started once only.
    frame(&root.join("Ha_002.fits"));
    count_is(&watch, location.id, 2).await;
    after(&watch, sweeps, 2).await;
    assert_eq!((probe.watches.load(Ordering::SeqCst), walks(&watch)), (2, 2));
    assert_eq!(watchers(&watch), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_watcher_that_left_a_folder_unwatched_is_not_live_and_is_retried() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    probe.partial.store(1, Ordering::SeqCst);
    probe.watch_gate.close();
    let watch = probed(&fx.library, &probe);

    let counts = until(&watch, |counts| !counts.is_empty()).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: false }]);
    // A sweep starts it again over every folder.
    holding(&probe.watch_gate).await;
    assert!(watch.counts().iter().all(|count| !count.live));
    probe.watch_gate.open();
    let counts = until(&watch, |counts| counts.iter().all(|count| count.live)).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: true }]);
    assert_eq!(probe.watches.load(Ordering::SeqCst), 2);
    watchers_are(&watch, 1).await;
}

/// Restores a folder's permissions when dropped, so a failing test still
/// leaves its temp tree removable.
#[cfg(unix)]
struct Unlock<'a>(&'a Path);

#[cfg(unix)]
impl Drop for Unlock<'_> {
    fn drop(&mut self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(self.0, fs::Permissions::from_mode(0o755));
    }
}

/// `lost+found` at the root of an ext4 drive, or `System Volume Information`
/// at the root of an NTFS one: the OS refuses to watch it at every start, and
/// no walk can list it either.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_folder_refused_for_good_that_no_walk_lists_leaves_the_watcher_live() {
    use std::os::unix::fs::PermissionsExt;
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let locked = root.join("lost+found");
    frame(&locked.join("Ha_001.fits"));
    let _unlock = Unlock(&locked);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    assert!(fs::read_dir(&locked).is_err(), "needs a user file permissions bind, not root");
    let probe = Arc::new(Probe::default());
    *probe.refused.lock().unwrap() = Some(locked.clone());
    let watch = probed(&fx.library, &probe);

    // Nothing below it is counted, so the watcher misses nothing the count
    // holds: live, and neither restarted nor walked again at each sweep.
    let counts = until(&watch, |counts| !counts.is_empty()).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: true }]);
    after(&watch, sweeps, 3).await;
    assert_eq!((probe.watches.load(Ordering::SeqCst), walks(&watch)), (1, 1));

    // Once it can be listed, the next sweep watches and walks it.
    *probe.refused.lock().unwrap() = None;
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: true }]);
    assert_eq!(probe.watches.load(Ordering::SeqCst), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watching_starts_when_a_location_is_added() {
    let fx = fixture().await;
    let watch = watch(&fx.library);
    after(&watch, sweeps, 1).await;
    assert_eq!(watch.counts(), Vec::<NewCaptureCount>::new());

    let root = fx.base.join("Captures");
    frame(&root.join("Ha_001.fits"));
    let location = captures(&fx.library, &root).await;

    count_is(&watch, location.id, 1).await;
    assert_eq!(watchers(&watch), 1);
    // Calibration locations are not Captures: a sweep after the
    // registration leaves them unwatched.
    let darks = fx.base.join("Darks");
    fs::create_dir_all(&darks).unwrap();
    fx.library
        .register_location(NativePath::from_path(&darks), "Darks".into(), LocationRole::Calibration)
        .await
        .unwrap();
    after(&watch, sweeps, 1).await;
    assert_eq!(watch.counts().len(), 1);
    assert_eq!(watchers(&watch), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watching_stops_when_a_location_is_retired() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 0).await;

    let review = fx.library.review_retire_location(location.id).await.unwrap();
    fx.library.retire_location(review.id, location.id, review.expected_revision).await.unwrap();

    until(&watch, <[NewCaptureCount]>::is_empty).await;
    watchers_are(&watch, 0).await;
    // No sweep starts it again.
    frame(&root.join("Ha_001.fits"));
    after(&watch, sweeps, 2).await;
    assert_eq!(watch.counts(), Vec::<NewCaptureCount>::new());
    assert_eq!(watchers(&watch), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watching_stops_when_a_location_leaves_the_catalog() {
    use sqlx::Connection as _;

    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 0).await;

    // No library command removes a location; any other removal is seen at
    // the next sweep.
    let url = format!("sqlite://{}", fx.base.join("catalog.sqlite").display());
    let mut connection = sqlx::SqliteConnection::connect(&url).await.unwrap();
    sqlx::query("DELETE FROM locations WHERE id = ?1")
        .bind(location.id.to_string())
        .execute(&mut connection)
        .await
        .unwrap();
    connection.close().await.unwrap();

    until(&watch, <[NewCaptureCount]>::is_empty).await;
    watchers_are(&watch, 0).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watching_follows_a_remapped_location_to_its_new_root() {
    let fx = fixture().await;
    let old = fx.base.join("Captures");
    let location = captures(&fx.library, &old).await;
    frame(&old.join("Ha_001.fits"));
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 0).await;
    // A frame only the old root holds.
    frame(&old.join("Ha_old.fits"));
    count_is(&watch, location.id, 1).await;

    let copy = copy_of(&old, &fx.base.join("Captures copy"));
    remap(&fx.library, location.id, &copy).await;

    // The walk of the new root starts it again from what the catalog holds.
    eventually("the new root walked", || walks(&watch) >= 2).await;
    count_is(&watch, location.id, 0).await;
    frame(&copy.join("Ha_002.fits"));
    frame(&copy.join("Ha_003.fits"));
    count_is(&watch, location.id, 2).await;
    watchers_are(&watch, 1).await;
}

/// A copy at `to` of the frame `Ha_001.fits` that `from` holds.
fn copy_of(from: &Path, to: &Path) -> PathBuf {
    fs::create_dir_all(to).unwrap();
    fs::copy(from.join("Ha_001.fits"), to.join("Ha_001.fits")).unwrap();
    to.to_path_buf()
}

/// Remap `location` to `to`, which holds what the catalog holds there.
async fn remap(library: &Arc<Library>, location: Uuid, to: &Path) {
    let current = library.catalog().location(location).await.unwrap();
    let review = library
        .review_remap(location, current.decision_revision, NativePath::from_path(to))
        .await
        .unwrap();
    assert!(review.blocked.is_empty(), "{:?}", review.blocked);
    library.apply_remap(review.id, current.decision_revision).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watching_follows_a_reselected_location_to_its_new_path() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    // No sweep runs after the start: the reselection itself moves the watch.
    let slow = Settings { sweep: Duration::from_secs(3600), ..FAST };
    let watch = CaptureWatch::start_with(&fx.library, slow, Arc::new(OsProbe));
    count_is(&watch, location.id, 1).await;

    // The folder moved; reselecting it there follows it.
    let moved = fx.base.join("Archive/Captures");
    fs::create_dir_all(moved.parent().unwrap()).unwrap();
    fs::rename(&root, &moved).unwrap();
    let current = fx.library.catalog().location(location.id).await.unwrap();
    fx.library
        .reselect_location(location.id, current.decision_revision, NativePath::from_path(&moved))
        .await
        .unwrap();

    eventually("the new path walked", || walks(&watch) >= 2).await;
    live_count_is(&watch, location.id, 1).await;
    let walked = walks(&watch);
    frame(&moved.join("Ha_002.fits"));
    live_count_is(&watch, location.id, 2).await;
    assert_eq!(walks(&watch), walked, "counted live at the new path");
    watchers_are(&watch, 1).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_offline_root_releases_its_watch_and_is_only_checked_each_sweep() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    let probe = Arc::new(Probe::default());
    let watch = probed(&fx.library, &probe);
    count_is(&watch, location.id, 1).await;
    assert_eq!(watchers(&watch), 1);

    // The drive goes away: its mount point is gone.
    let unplugged = fx.base.join("unplugged");
    fs::rename(&root, &unplugged).unwrap();
    until(&watch, <[NewCaptureCount]>::is_empty).await;
    watchers_are(&watch, 0).await;

    let (stats, validations) =
        (probe.stats.load(Ordering::SeqCst), probe.validations.load(Ordering::SeqCst));
    after(&watch, sweeps, 10).await;
    // Ten sweeps, plus the one under way when counting started and the one
    // whose start ended the wait.
    let stats = probe.stats.load(Ordering::SeqCst) - stats;
    assert!(stats <= 12, "one stat per sweep at most, not a loop: {stats} in 10 sweeps");
    assert_eq!(
        probe.validations.load(Ordering::SeqCst),
        validations,
        "an absent root is not queried"
    );

    // Back online, with what arrived meanwhile.
    frame(&unplugged.join("Ha_002.fits"));
    fs::rename(&unplugged, &root).unwrap();
    count_is(&watch, location.id, 2).await;
    watchers_are(&watch, 1).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_watcher_slow_to_stop_holds_up_no_discovery() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 0).await;

    // The drive goes away, and stopping its watcher hangs.
    let releases = &watch.observed().releases;
    let _opens = Opens(releases);
    releases.close();
    fs::rename(&root, fx.base.join("unplugged")).unwrap();
    // Discovery goes on meanwhile: the location leaves the counts at once.
    until(&watch, <[NewCaptureCount]>::is_empty).await;
    holding(releases).await;
    assert_eq!(watchers(&watch), 1, "still stopping");
    releases.open();
    watchers_are(&watch, 0).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_root_is_not_queried_again_until_it_changes() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    let watch = probed(&fx.library, &probe);
    count_is(&watch, location.id, 0).await;

    // Another folder now sits at the registered path.
    fs::rename(&root, fx.base.join("moved")).unwrap();
    until(&watch, <[NewCaptureCount]>::is_empty).await;
    let before = probe.validations.load(Ordering::SeqCst);
    fs::create_dir_all(&root).unwrap();
    frame(&root.join("Ha_001.fits"));
    eventually("the new folder is checked", || probe.validations.load(Ordering::SeqCst) > before)
        .await;
    after(&watch, sweeps, 10).await;
    assert_eq!(probe.validations.load(Ordering::SeqCst), before + 1, "refused once, not again");
    assert_eq!(watch.counts(), Vec::<NewCaptureCount>::new());
    assert_eq!(watchers(&watch), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_root_that_could_not_be_checked_is_checked_again_at_the_next_sweep() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    let probe = Arc::new(Probe::default());
    // The volume query fails once, while the root itself is unchanged.
    probe.unobserved.store(1, Ordering::SeqCst);
    let watch = probed(&fx.library, &probe);

    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: true }]);
    assert_eq!(probe.validations.load(Ordering::SeqCst), 2, "refused once, then checked again");
}

/// The root's canonical path cannot be resolved once, as when a linked
/// folder above it briefly does not answer: on macOS it is not watched
/// without it, since `FSEvents` would name its events by that path, but
/// checked again and counted at the next sweep.
#[cfg(target_os = "macos")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_root_whose_canonical_path_fails_is_checked_again_at_the_next_sweep() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    let probe = Arc::new(Probe::default());
    probe.uncanonical.store(1, Ordering::SeqCst);
    let watch = probed(&fx.library, &probe);

    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: true }]);
    assert_eq!(probe.canonicals.load(Ordering::SeqCst), 2, "failed once, then resolved again");
    assert_eq!((probe.watches.load(Ordering::SeqCst), walks(&watch)), (1, 1));
}

/// Elsewhere events name the watched path itself, and `canonicalize` fails
/// for good on some Windows volume drivers: a root whose canonical path
/// cannot be resolved is watched and counted at once, without it.
#[cfg(not(target_os = "macos"))]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_root_whose_canonical_path_fails_is_watched_without_it() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    let probe = Arc::new(Probe::default());
    probe.uncanonical.store(usize::MAX, Ordering::SeqCst);
    let watch = probed(&fx.library, &probe);

    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: true }]);
    assert_eq!(probe.canonicals.load(Ordering::SeqCst), 1, "not checked again");
    frame(&root.join("Ha_002.fits"));
    count_is(&watch, location.id, 2).await;
}

/// A folder the walk cannot list. When it becomes readable no event need
/// bring its files in (`FSEvents` may report the change of mode, inotify
/// reports none below a folder it could not watch), so the watchers here
/// deliver none, and a sweep lists it again.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_folder_the_walk_could_not_list_is_walked_once_it_can_be() {
    use std::os::unix::fs::PermissionsExt;
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let locked = root.join("night");
    frame(&locked.join("Ha_001.fits"));
    let _unlock = Unlock(&locked);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    assert!(fs::read_dir(&locked).is_err(), "needs a user file permissions bind, not root");
    let probe = Arc::new(Probe::default());
    probe.deaf.store(true, Ordering::SeqCst);
    let watch = probed(&fx.library, &probe);

    let counts = count_is(&watch, location.id, 0).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: true }]);
    after(&watch, sweeps, 2).await;
    let walked = walks(&watch);
    assert_eq!(walked, 1, "an unreadable folder is not walked again while it stays so");

    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: true }]);
}

/// A folder that lists its names but none of its entries' metadata (read
/// without search permission, as a network share that errors per entry): the
/// walk keeps it incomplete, a sweep lists it again rather than rewalking
/// while it stays so, and walks the location once it lists in full.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_folder_listed_only_in_part_is_walked_once_it_lists_in_full() {
    use std::os::unix::fs::PermissionsExt;
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let night = root.join("night");
    frame(&night.join("Ha_001.fits"));
    let _unlock = Unlock(&night);
    fs::set_permissions(&night, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(fs::read_dir(&night).is_ok(), "its names list");
    assert!(fs::symlink_metadata(night.join("Ha_001.fits")).is_err(), "needs a user, not root");
    let probe = Arc::new(Probe::default());
    probe.deaf.store(true, Ordering::SeqCst);
    let watch = probed(&fx.library, &probe);

    let counts = count_is(&watch, location.id, 0).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: true }]);
    after(&watch, sweeps, 2).await;
    assert_eq!(walks(&watch), 1, "not walked again while it lists only in part");

    fs::set_permissions(&night, fs::Permissions::from_mode(0o755)).unwrap();
    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: true }]);
}

/// A counted folder made unreadable leaves the count, as the next scan
/// cannot read it, and returns to it once readable: the watcher reports the
/// folder's permission change, while no event names the files below it. A
/// frame added to a readable folder is still counted live, without a walk.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_counted_folder_made_unreadable_leaves_the_count_until_it_is_readable() {
    use std::os::unix::fs::PermissionsExt;
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let night = root.join("night");
    frame(&night.join("Ha_001.fits"));
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 1).await;
    frame(&night.join("Ha_002.fits"));
    count_is(&watch, location.id, 2).await;
    assert_eq!(walks(&watch), 1, "a new frame is counted live");

    let _unlock = Unlock(&night);
    fs::set_permissions(&night, fs::Permissions::from_mode(0o000)).unwrap();
    assert!(fs::read_dir(&night).is_err(), "needs a user file permissions bind, not root");
    let counts = count_is(&watch, location.id, 0).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: true }]);

    fs::set_permissions(&night, fs::Permissions::from_mode(0o755)).unwrap();
    count_is(&watch, location.id, 2).await;
}

/// A root that is not UTF-8 cannot be watched (Linux only: macOS refuses
/// such names), so every sweep walks it again and its count follows.
#[cfg(target_os = "linux")]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_root_that_is_not_utf8_is_walked_again_at_every_sweep() {
    use std::os::unix::ffi::OsStrExt;
    let fx = fixture().await;
    let root = fx.base.join(std::ffi::OsStr::from_bytes(b"Captures \xff"));
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 1).await;
    assert_eq!(watchers(&watch), 0, "never watched");

    frame(&root.join("Ha_002.fits"));
    let counts = count_is(&watch, location.id, 2).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 2, live: false }]);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_released_location_touches_its_volume_no_more_until_reattached() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    let probe = Arc::new(Probe::default());
    let watch = probed(&fx.library, &probe);
    count_is(&watch, location.id, 1).await;

    // Its drive is about to be ejected: released before this returns.
    watch.release(location.id, &root).await;
    assert_eq!(watchers(&watch), 0, "no watcher holds the volume");
    let counts = until(&watch, |counts| counts.iter().all(|count| !count.live)).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: false }]);
    // No sweep or event touches the root meanwhile.
    let touched =
        |probe: &Probe| (probe.stats.load(Ordering::SeqCst), probe.watches.load(Ordering::SeqCst));
    let (before, walked) = (touched(&probe), walks(&watch));
    frame(&root.join("Ha_002.fits"));
    after(&watch, sweeps, 2).await;
    assert_eq!((touched(&probe), walks(&watch)), (before, walked));
    assert_eq!(new_files(&watch.counts(), location.id), Some(1));

    // The eject was refused: watched again, with what arrived meanwhile.
    watch.reattach(location.id, &root);
    let counts = count_is(&watch, location.id, 2).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 2, live: true }]);
    watchers_are(&watch, 1).await;
    frame(&root.join("Ha_003.fits"));
    count_is(&watch, location.id, 3).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_returns_once_the_walk_in_flight_ended() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    let _opens = Opens(&probe.list_gate);
    probe.list_gate.close();
    let watch = probed(&fx.library, &probe);
    holding(&probe.list_gate).await;

    // The start-up walk still lists the volume: the release waits for it.
    let release = watch.release(location.id, &root);
    tokio::pin!(release);
    let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
    assert!(early.is_err(), "released while a walk still listed the volume");
    probe.list_gate.open();
    tokio::time::timeout(Duration::from_secs(5), release).await.expect("released after the walk");
    assert_eq!(watchers(&watch), 0);
    after(&watch, sweeps, 1).await;
    assert_eq!(watch.counts(), Vec::<NewCaptureCount>::new(), "its walk never counted");
}

/// App exit (the desktop shell stops discovery, then the window thread a
/// release blocks) never waits on a release whose walk hangs: it returns
/// once discovery is asked to stop.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_held_by_a_hung_walk_returns_once_discovery_stops() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    let _opens = Opens(&probe.list_gate);
    probe.list_gate.close();
    let watch = probed(&fx.library, &probe);
    holding(&probe.list_gate).await;
    let release = watch.release(location.id, &root);
    tokio::pin!(release);
    let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
    assert!(early.is_err(), "released while a walk still listed the volume");

    // The walk still hangs as the app exits; its gate opens only once the
    // test ends.
    let exit = async {
        tokio::join!(watch.shutdown(), release);
    };
    let bounded = tokio::time::timeout(SHUTDOWN_GRACE * 2, exit).await;
    assert!(bounded.is_ok(), "a release held by a hung walk held up exit");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_waits_for_a_watcher_still_closing() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    let watch = probed(&fx.library, &probe);
    count_is(&watch, location.id, 0).await;

    // A new folder restarts the watcher: the old one is slow to close, and
    // no new one starts.
    let releases = &watch.observed().releases;
    let _opens = Opens(releases);
    releases.close();
    probe.failing.store(1000, Ordering::SeqCst);
    fs::create_dir(root.join("2026-10-16")).unwrap();
    holding(releases).await;

    // Only the closing watcher holds the volume, and the release waits for it.
    let release = watch.release(location.id, &root);
    tokio::pin!(release);
    let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
    assert!(early.is_err(), "released while a closing watcher still held the volume");
    releases.open();
    tokio::time::timeout(Duration::from_secs(5), release).await.expect("released once it closed");
    assert_eq!(watchers(&watch), 0);
}

/// A release waits for every call still in flight on its root's volume,
/// whichever location it served: here the watcher a retired location let go
/// of, beside the released root on the same volume. The released location
/// holds no watcher, so it has nothing of its own to wait for.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_waits_for_a_watcher_another_location_closes_on_its_volume() {
    let fx = fixture().await;
    let (root_a, root_b) = (fx.base.join("A"), fx.base.join("B"));
    let a = captures(&fx.library, &root_a).await;
    let probe = Arc::new(Probe::default());
    let watch = probed(&fx.library, &probe);
    count_is(&watch, a.id, 0).await;
    watchers_are(&watch, 1).await;
    probe.failing.store(1000, Ordering::SeqCst);
    let b = captures(&fx.library, &root_b).await;
    count_is(&watch, b.id, 0).await;
    assert_eq!(watchers(&watch), 1, "only A holds a watcher");

    // A retires, and its watcher is slow to close.
    let releases = &watch.observed().releases;
    let _opens = Opens(releases);
    releases.close();
    let review = fx.library.review_retire_location(a.id).await.unwrap();
    fx.library.retire_location(review.id, a.id, review.expected_revision).await.unwrap();
    holding(releases).await;

    let release = watch.release(b.id, &root_b);
    tokio::pin!(release);
    let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
    assert!(early.is_err(), "released while another location's watcher closed on its volume");
    releases.open();
    tokio::time::timeout(Duration::from_secs(5), release).await.expect("released once it closed");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_root_is_named_from_the_start_of_its_watch_until_it_leaves() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    let _opens = Opens(&probe.list_gate);
    probe.list_gate.close();
    let watch = probed(&fx.library, &probe);
    let roots = || watch.subscribe_roots().borrow().clone();
    let named = [named_root(&location, &root)];

    // The first walk still lists the volume, so nothing is counted, but the
    // root is named: a removal of its volume can be followed.
    holding(&probe.list_gate).await;
    assert_eq!(watch.counts(), Vec::<NewCaptureCount>::new());
    assert_eq!(roots(), named);
    probe.list_gate.open();
    count_is(&watch, location.id, 0).await;

    // Named while its volume is being removed, and no longer once it is.
    watch.release(location.id, &root).await;
    assert_eq!(roots(), named);
    watch.gone(location.id, &root);
    eventually("the root leaves with its location", || roots().is_empty()).await;
}

/// How [`CaptureWatch::subscribe_roots`] names `root`, a root of `location`.
fn named_root(location: &Location, root: &Path) -> WatchedRoot {
    WatchedRoot {
        location_id: location.id,
        root: root.to_path_buf(),
        volume_kind: location.volume_kind,
        folder: inventory::root_stamp(root).and_then(RootStamp::folder),
    }
}

/// A location retired while its walk still lists and its watcher still
/// closes, as on a slow volume: its root stays named until both returned, so
/// a removal of its volume is still followed, and a release waits for both.
/// The root leaves once they returned.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_retired_root_stays_named_until_its_walk_and_watcher_close_returned() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    let _lists = Opens(&probe.list_gate);
    probe.list_gate.close();
    let watch = probed(&fx.library, &probe);
    let releases = &watch.observed().releases;
    let _closes = Opens(releases);
    releases.close();
    let roots = || watch.subscribe_roots().borrow().clone();
    let named = [named_root(&location, &root)];
    holding(&probe.list_gate).await;
    watchers_are(&watch, 1).await;

    let review = fx.library.review_retire_location(location.id).await.unwrap();
    fx.library.retire_location(review.id, location.id, review.expected_revision).await.unwrap();
    holding(releases).await;
    let release = watch.release(location.id, &root);
    tokio::pin!(release);
    let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
    assert!(early.is_err(), "released while its walk listed and its watcher closed");
    assert_eq!(roots(), named, "unnamed while its walk listed and its watcher closed");

    releases.open();
    watchers_are(&watch, 0).await;
    let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
    assert!(early.is_err(), "released while its walk still listed");
    assert_eq!(roots(), named, "unnamed while its walk still listed");

    probe.list_gate.open();
    tokio::time::timeout(Duration::from_secs(5), release)
        .await
        .expect("released once both returned");
    eventually("the root leaves once both returned", || roots().is_empty()).await;
}

/// A walk and a watcher close still in flight a sweep after their location
/// retired, as on a share whose server went away, are each logged once, not
/// before, while their root stays named.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_call_still_in_flight_a_sweep_after_it_was_let_go_is_logged_once() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let probe = Arc::new(Probe::default());
    let _lists = Opens(&probe.list_gate);
    probe.list_gate.close();
    let watch = probed(&fx.library, &probe);
    let releases = &watch.observed().releases;
    let _closes = Opens(releases);
    releases.close();
    holding(&probe.list_gate).await;
    watchers_are(&watch, 1).await;
    let stuck = || watch.observed().stuck.load(Ordering::SeqCst);

    let retired = Instant::now();
    let review = fx.library.review_retire_location(location.id).await.unwrap();
    fx.library.retire_location(review.id, location.id, review.expected_revision).await.unwrap();
    holding(releases).await;
    eventually("the walk and the watcher close logged", || stuck() == 2).await;
    assert!(retired.elapsed() >= FAST.sweep, "logged before a sweep passed");
    after(&watch, sweeps, 2).await;
    assert_eq!(stuck(), 2, "each logged once");
    assert_eq!(watch.subscribe_roots().borrow().clone(), [named_root(&location, &root)]);

    releases.open();
    probe.list_gate.open();
    eventually("the root leaves once both returned", || {
        watch.subscribe_roots().borrow().is_empty()
    })
    .await;
    assert_eq!(stuck(), 2);
}

/// A remapped location's old root stays named beside its new one while its
/// watcher still closes. A removal of the old root's volume waits for that
/// close, and lets go of the new root's watch as well, which may be on that
/// volume: only the old root stays named until the removal is decided.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_remapped_location_names_its_old_root_until_its_watcher_closed() {
    let fx = fixture().await;
    let old = fx.base.join("Captures");
    let location = captures(&fx.library, &old).await;
    frame(&old.join("Ha_001.fits"));
    assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
    // Only the notice ends the wait for the removal.
    let settings = Settings { removal_wait: Duration::from_secs(3600), ..FAST };
    let watch = CaptureWatch::start_with(&fx.library, settings, Arc::new(OsProbe));
    live_count_is(&watch, location.id, 0).await;
    let releases = &watch.observed().releases;
    let _opens = Opens(releases);
    releases.close();
    let roots = || watch.subscribe_roots().borrow().clone();

    let copy = copy_of(&old, &fx.base.join("Captures copy"));
    remap(&fx.library, location.id, &copy).await;
    holding(releases).await;
    eventually("the new root walked", || walks(&watch) >= 2).await;
    live_count_is(&watch, location.id, 0).await;
    let remapped = fx.library.catalog().location(location.id).await.unwrap();
    assert_eq!(roots(), [named_root(&location, &old), named_root(&remapped, &copy)]);

    // The old root's volume is to be removed: the release waits for its
    // watcher's close, and lets go of the new root's watch too.
    let release = watch.release(location.id, &old);
    tokio::pin!(release);
    let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
    assert!(early.is_err(), "released while the old root's watcher still closed");
    until(&watch, <[NewCaptureCount]>::is_empty).await;
    releases.open();
    tokio::time::timeout(Duration::from_secs(5), release).await.expect("released once it closed");
    assert_eq!(watchers(&watch), 0, "a watcher holds the new root after the release");
    eventually("the old root named alone once both watchers closed", || {
        roots() == [named_root(&location, &old)]
    })
    .await;

    // The old root's volume is gone: the new root is watched and counted
    // live.
    watch.gone(location.id, &old);
    frame(&copy.join("Ha_002.fits"));
    live_count_is(&watch, location.id, 1).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_removed_volume_goes_offline_at_once_and_returns_at_a_sweep() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 0).await;

    // Ejected: gone without waiting for a sweep to find the root missing,
    // even though the root is still there.
    watch.release(location.id, &root).await;
    watch.gone(location.id, &root);
    until(&watch, <[NewCaptureCount]>::is_empty).await;
    assert_eq!(watchers(&watch), 0);
    // Plugged back in: the next sweep starts it again.
    frame(&root.join("Ha_001.fits"));
    count_is(&watch, location.id, 1).await;
    watchers_are(&watch, 1).await;
}

/// Reselecting an offline location at the path it is back at checks its
/// root at once: it is counted live without waiting for a sweep.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reselecting_an_offline_root_at_its_path_watches_it_without_a_sweep() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    // No sweep runs after the start.
    let slow = Settings { sweep: Duration::from_secs(3600), ..FAST };
    let probe = Arc::new(Probe::default());
    let watch =
        CaptureWatch::start_with(&fx.library, slow, Arc::clone(&probe) as Arc<dyn RootProbe>);
    count_is(&watch, location.id, 1).await;
    // Ejected: offline at once.
    watch.release(location.id, &root).await;
    watch.gone(location.id, &root);
    until(&watch, <[NewCaptureCount]>::is_empty).await;
    let swept = sweeps(watch.observed()).load(Ordering::SeqCst);

    // Plugged back in at the same path, and reselected there.
    let current = fx.library.catalog().location(location.id).await.unwrap();
    fx.library
        .reselect_location(location.id, current.decision_revision, NativePath::from_path(&root))
        .await
        .unwrap();

    live_count_is(&watch, location.id, 1).await;
    watchers_are(&watch, 1).await;
    assert_eq!(sweeps(watch.observed()).load(Ordering::SeqCst), swept, "no sweep started it");
}

/// What discovery did through `probe`: root `stat`s, root validations and
/// watcher starts.
fn touches(probe: &Probe) -> [usize; 3] {
    [&probe.stats, &probe.validations, &probe.watches].map(|count| count.load(Ordering::SeqCst))
}

/// A Captures location remapped while the removal of its old root's volume
/// is pending.
struct RemappedInRemoval {
    fx: Fixture,
    watch: CaptureWatch,
    probe: Arc<Probe>,
    location: Location,
    old: PathBuf,
    copy: PathBuf,
}

impl RemappedInRemoval {
    /// A location with a frame the catalog holds, watched with `settings` and
    /// counted live at `old`.
    async fn watched(settings: Settings) -> (Fixture, CaptureWatch, Arc<Probe>, Location, PathBuf) {
        let fx = fixture().await;
        let old = fx.base.join("Captures");
        let location = captures(&fx.library, &old).await;
        frame(&old.join("Ha_001.fits"));
        assert_eq!(scan_to_end(&fx.library, location.id).await.state, ScanState::Completed);
        let probe = Arc::new(Probe::default());
        let watch = CaptureWatch::start_with(
            &fx.library,
            settings,
            Arc::clone(&probe) as Arc<dyn RootProbe>,
        );
        live_count_is(&watch, location.id, 0).await;
        (fx, watch, probe, location, old)
    }

    /// Watch a location with `settings`, release its root, remap it, and
    /// check that the new root, which may be on the volume being removed,
    /// is left alone: nothing touches it, and only the old root stays named,
    /// so the removal's outcome still arrives for it.
    async fn start(settings: Settings) -> Self {
        let (fx, watch, probe, location, old) = Self::watched(settings).await;
        watch.release(location.id, &old).await;
        let (touched, walked) = (touches(&probe), walks(&watch));

        let copy = copy_of(&old, &fx.base.join("Captures copy"));
        remap(&fx.library, location.id, &copy).await;
        // Applied: the old root's count leaves.
        until(&watch, <[NewCaptureCount]>::is_empty).await;
        assert_eq!(
            (touches(&probe), walks(&watch), watchers(&watch)),
            (touched, walked, 0),
            "the new root was touched while the removal was pending"
        );
        assert_eq!(*watch.subscribe_roots().borrow(), [named_root(&location, &old)]);
        Self { fx, watch, probe, location, old, copy }
    }

    /// Watch a location with `settings`, remap it and let the remap apply
    /// in full, watched and walked at the new root, with the old root no
    /// longer named, and only then release the old root: the removal notice
    /// lost the race to the remap. The release lets go of the new root too,
    /// which may be on the volume being removed, and the removal stays
    /// pending as in [`Self::start`]. The old root is not named again, so
    /// the eject window registers no fresh handle on it: the named roots do
    /// not change, the new root staying named for the removal's outcome.
    async fn released_after_the_remap(settings: Settings) -> Self {
        let (fx, watch, probe, location, old) = Self::watched(settings).await;
        let copy = copy_of(&old, &fx.base.join("Captures copy"));
        remap(&fx.library, location.id, &copy).await;
        let remapped = fx.library.catalog().location(location.id).await.unwrap();
        let new_root = [named_root(&remapped, &copy)];
        eventually("the new root named alone", || *watch.subscribe_roots().borrow() == new_root)
            .await;
        live_count_is(&watch, location.id, 0).await;
        watchers_are(&watch, 1).await;
        let mut roots = watch.subscribe_roots();
        roots.borrow_and_update();

        watch.release(location.id, &old).await;
        assert_eq!(watchers(&watch), 0, "a watcher holds the new root after the release");
        until(&watch, <[NewCaptureCount]>::is_empty).await;
        let (touched, walked) = (touches(&probe), walks(&watch));
        // Debounce ticks pass, and none touches the new root.
        tokio::time::sleep(FAST.debounce * 5).await;
        assert_eq!(
            (touches(&probe), walks(&watch), watchers(&watch)),
            (touched, walked, 0),
            "the new root was touched while the removal was pending"
        );
        assert!(
            !roots.has_changed().expect("discovery runs"),
            "the named roots changed while the removal was pending: {:?}",
            *roots.borrow()
        );
        assert_eq!(*roots.borrow(), new_root);
        Self { fx, watch, probe, location, old, copy }
    }

    /// Watch a location with `settings`, remap it twice while each earlier
    /// root's watcher is still closing, and only then release its first
    /// root, the order Codex review thread `r4329486324` flagged: the
    /// release lets go of the root the location follows now, which may be on
    /// that volume, and waits for its watcher's close as well. No root is
    /// named that was not before, the first one staying named for the
    /// removal's outcome, and nothing touches the location's roots.
    async fn released_after_two_remaps(settings: Settings) -> Self {
        let (fx, watch, probe, location, old) = Self::watched(settings).await;
        let releases = &watch.observed().releases;
        let opens = Opens(releases);
        releases.close();
        let roots = || watch.subscribe_roots().borrow().clone();
        let mut named = vec![named_root(&location, &old)];
        let copies = ["Captures B", "Captures C"].map(|name| fx.base.join(name));
        for (walked, copy) in (2..).zip(&copies) {
            copy_of(&old, copy);
            remap(&fx.library, location.id, copy).await;
            holding(releases).await;
            eventually("the new root walked", || walks(&watch) >= walked).await;
            live_count_is(&watch, location.id, 0).await;
            let remapped = fx.library.catalog().location(location.id).await.unwrap();
            named.push(named_root(&remapped, copy));
        }
        assert_eq!(roots(), named, "each earlier root is named while its watcher closes");
        let (touched, walked) = (touches(&probe), walks(&watch));

        {
            let release = watch.release(location.id, &old);
            tokio::pin!(release);
            let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
            assert!(early.is_err(), "released while a watcher still closed on the volume");
            until(&watch, <[NewCaptureCount]>::is_empty).await;
            assert_eq!(roots(), named, "the named roots changed as the release arrived");
            releases.open();
            tokio::time::timeout(Duration::from_secs(5), release)
                .await
                .expect("released once closed");
        }
        drop(opens);
        assert_eq!(watchers(&watch), 0, "a watcher holds the root followed now after the release");
        eventually("the first root named alone once every watcher closed", || {
            roots() == [named_root(&location, &old)]
        })
        .await;
        // Debounce ticks pass, and none touches a root of the location.
        tokio::time::sleep(FAST.debounce * 5).await;
        assert_eq!(
            (touches(&probe), walks(&watch), watchers(&watch)),
            (touched, walked, 0),
            "a root was touched while the removal was pending"
        );
        let [_, copy] = copies;
        Self { fx, watch, probe, location, old, copy }
    }

    /// Watch a location with `settings`, move its folder away so a sweep
    /// takes it offline while its watcher there still closes, release the
    /// old root, and only then reselect the location at the folder's new
    /// path, the order Codex review thread `PRRT_kwDOSdTu0s6ugh6G` flagged:
    /// the new root, which may be on the volume being removed, is left
    /// alone, and the old root stays named alone for the removal's outcome.
    async fn released_while_offline(settings: Settings) -> Self {
        let (fx, watch, probe, location, old) = Self::watched(settings).await;
        let releases = &watch.observed().releases;
        let opens = Opens(releases);
        releases.close();
        let roots = || watch.subscribe_roots().borrow().clone();
        let named = roots();
        let copy = fx.base.join("Captures moved");
        fs::rename(&old, &copy).unwrap();
        until(&watch, <[NewCaptureCount]>::is_empty).await;
        holding(releases).await;
        assert_eq!(roots(), named, "the old root is named while its watcher closes");

        let (touched, walked) = {
            let release = watch.release(location.id, &old);
            tokio::pin!(release);
            let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
            assert!(early.is_err(), "released while the old root's watcher still closed");
            let (touched, walked) = (touches(&probe), walks(&watch));
            let current = fx.library.catalog().location(location.id).await.unwrap();
            fx.library
                .reselect_location(
                    location.id,
                    current.decision_revision,
                    NativePath::from_path(&copy),
                )
                .await
                .unwrap();
            // Sweeps and debounce ticks pass, and none touches the new root.
            tokio::time::sleep(settings.sweep * 3).await;
            assert_eq!(
                (touches(&probe), walks(&watch)),
                (touched, walked),
                "the new root was touched while the removal was pending"
            );
            releases.open();
            tokio::time::timeout(Duration::from_secs(5), release)
                .await
                .expect("released once closed");
            (touched, walked)
        };
        drop(opens);
        tokio::time::sleep(settings.sweep * 3).await;
        assert_eq!(
            (touches(&probe), walks(&watch), watchers(&watch)),
            (touched, walked, 0),
            "the new root was touched while the removal was pending"
        );
        assert_eq!(roots(), named, "the named roots changed while the removal was pending");
        Self { fx, watch, probe, location, old, copy }
    }

    /// The new root is watched and counted live, and named alone.
    async fn watched_at_the_new_root(&self) {
        let id = self.location.id;
        live_count_is(&self.watch, id, 0).await;
        watchers_are(&self.watch, 1).await;
        let remapped = self.fx.library.catalog().location(id).await.unwrap();
        assert_eq!(*self.watch.subscribe_roots().borrow(), [named_root(&remapped, &self.copy)]);
        frame(&self.copy.join("Ha_002.fits"));
        live_count_is(&self.watch, id, 1).await;
    }
}

/// No sweep runs after the start, and the wait for a notice does not run out
/// before the test ends: only the notice ends the wait.
const UNTIL_NOTICED: Settings =
    Settings { sweep: Duration::from_secs(3600), removal_wait: Duration::from_secs(3600), ..FAST };

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_root_change_during_a_pending_removal_starts_once_the_removal_is_refused() {
    let remapped = RemappedInRemoval::start(UNTIL_NOTICED).await;
    remapped.watch.reattach(remapped.location.id, &remapped.old);
    remapped.watched_at_the_new_root().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_root_change_during_a_pending_removal_starts_once_the_volume_is_gone() {
    let remapped = RemappedInRemoval::start(UNTIL_NOTICED).await;
    remapped.watch.gone(remapped.location.id, &remapped.old);
    remapped.watched_at_the_new_root().await;
}

/// The remap is applied before the release arrives, the order Codex review
/// thread `PRRT_kwDOSdTu0s6ueQXd` flagged: the release still holds the
/// location off its new root until the removal is refused.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_after_a_root_change_lets_go_of_the_new_root_until_refused() {
    let remapped = RemappedInRemoval::released_after_the_remap(UNTIL_NOTICED).await;
    remapped.watch.reattach(remapped.location.id, &remapped.old);
    remapped.watched_at_the_new_root().await;
}

/// The release came once the old root had left the named roots, so the
/// eject window may hold no registration on it any more: the refusal that
/// arrives through the new root's registration ends the wait.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_after_a_root_change_is_refused_through_the_new_root() {
    let remapped = RemappedInRemoval::released_after_the_remap(UNTIL_NOTICED).await;
    remapped.watch.reattach(remapped.location.id, &remapped.copy);
    remapped.watched_at_the_new_root().await;
}

/// As above, for a removal that went ahead: the notice that the volume is
/// gone arrives through the new root's registration.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_after_a_root_change_ends_once_gone_through_the_new_root() {
    let remapped = RemappedInRemoval::released_after_the_remap(UNTIL_NOTICED).await;
    remapped.watch.gone(remapped.location.id, &remapped.copy);
    remapped.watched_at_the_new_root().await;
}

/// The release arrives after two remaps, while the first root's watcher
/// still closes: the root followed now stays let go of until the removal is
/// refused through the first root's registration.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_after_two_root_changes_lets_go_of_the_root_followed_now_until_refused() {
    let remapped = RemappedInRemoval::released_after_two_remaps(UNTIL_NOTICED).await;
    remapped.watch.reattach(remapped.location.id, &remapped.old);
    remapped.watched_at_the_new_root().await;
}

/// As above, for a removal that went ahead.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_after_two_root_changes_lets_go_of_the_root_followed_now_until_gone() {
    let remapped = RemappedInRemoval::released_after_two_remaps(UNTIL_NOTICED).await;
    remapped.watch.gone(remapped.location.id, &remapped.old);
    remapped.watched_at_the_new_root().await;
}

/// Sweeps run, so the location goes offline, and only the notice ends the
/// wait for the removal.
const SWEEPING_UNTIL_NOTICED: Settings =
    Settings { removal_wait: Duration::from_secs(3600), ..FAST };

/// The release arrives while the location is offline, its old root's
/// watcher still closing, and a remap follows: the new root is started only
/// once the removal is refused.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_while_offline_holds_a_later_root_change_until_refused() {
    let remapped = RemappedInRemoval::released_while_offline(SWEEPING_UNTIL_NOTICED).await;
    remapped.watch.reattach(remapped.location.id, &remapped.old);
    remapped.watched_at_the_new_root().await;
}

/// As above, for a removal that went ahead.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_while_offline_holds_a_later_root_change_until_gone() {
    let remapped = RemappedInRemoval::released_while_offline(SWEEPING_UNTIL_NOTICED).await;
    remapped.watch.gone(remapped.location.id, &remapped.old);
    remapped.watched_at_the_new_root().await;
}

/// As above, with no notice: the wait runs out on its own.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_while_offline_holds_a_later_root_change_a_bounded_time() {
    // 3 s, not 1 s: `released_while_offline` asserts the new root stays
    // untouched for over a second after the remap.
    let settings = Settings { removal_wait: Duration::from_secs(3), ..FAST };
    let remapped = RemappedInRemoval::released_while_offline(settings).await;
    remapped.watched_at_the_new_root().await;
}

/// Reselect `id` at `at`.
async fn reselect(library: &Arc<Library>, id: Uuid, at: &Path) {
    let current = library.catalog().location(id).await.unwrap();
    library
        .reselect_location(id, current.decision_revision, NativePath::from_path(at))
        .await
        .unwrap();
}

/// Reselect `id` at `root` while a release holds it: the root is not walked.
async fn reselected_untouched(library: &Arc<Library>, watch: &CaptureWatch, id: Uuid, root: &Path) {
    let walked = walks(watch);
    reselect(library, id, root).await;
    tokio::time::sleep(FAST.debounce * 5).await;
    assert_eq!(walks(watch), walked, "the root was walked during the hold");
}

/// A location is ejected while its watcher still closes, so it goes offline
/// with its root still named, and a release of that root arrives again: it
/// is held, with no root change, until the wait runs out. A reselection at
/// the same root, during the hold (`during`) or after it, is then checked
/// at once, with no sweep, as for any reselected offline location.
async fn reselected_once_a_hold_while_offline_ends(during: bool) {
    // No sweep runs after the start; 3 s leaves room for the steps below.
    let settings = Settings { removal_wait: Duration::from_secs(3), ..UNTIL_NOTICED };
    let (fx, watch, _probe, location, root) = RemappedInRemoval::watched(settings).await;
    let id = location.id;
    let releases = &watch.observed().releases;
    let opens = Opens(releases);
    releases.close();
    let early = Duration::from_millis(300);

    let first = watch.release(id, &root);
    tokio::pin!(first);
    assert!(tokio::time::timeout(early, &mut first).await.is_err(), "the close still runs");
    holding(releases).await;
    watch.gone(id, &root);
    until(&watch, <[NewCaptureCount]>::is_empty).await;
    assert_eq!(*watch.subscribe_roots().borrow(), [named_root(&location, &root)]);

    let second = watch.release(id, &root);
    tokio::pin!(second);
    assert!(tokio::time::timeout(early, &mut second).await.is_err(), "the close still runs");
    if during {
        reselected_untouched(&fx.library, &watch, id, &root).await;
    }
    releases.open();
    tokio::time::timeout(Duration::from_secs(5), first).await.expect("released once closed");
    tokio::time::timeout(Duration::from_secs(5), second).await.expect("released once closed");
    drop(opens);
    let swept = sweeps(watch.observed()).load(Ordering::SeqCst);
    if !during {
        eventually("the hold ends", || watch.subscribe_roots().borrow().is_empty()).await;
        reselect(&fx.library, id, &root).await;
    }

    live_count_is(&watch, id, 0).await;
    watchers_are(&watch, 1).await;
    assert_eq!(sweeps(watch.observed()).load(Ordering::SeqCst), swept, "no sweep started it");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reselection_during_a_hold_while_offline_is_checked_once_the_hold_ends() {
    reselected_once_a_hold_while_offline_ends(true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reselection_after_a_hold_while_offline_is_checked_at_once() {
    reselected_once_a_hold_while_offline_ends(false).await;
}

/// The removal was refused and the location moved on to its new root, and
/// only then does a release of its old root arrive, sent before the eject
/// window ended that root's registration: the new root, which may be on that
/// volume, is let go of again. The old root is not named again, the new
/// root staying named in its place, and the refusal that arrives through
/// the new root's registration ends the wait.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_of_the_old_root_after_moving_on_lets_go_of_the_new_root() {
    let remapped = RemappedInRemoval::start(UNTIL_NOTICED).await;
    let (id, watch, probe) = (remapped.location.id, &remapped.watch, &remapped.probe);
    watch.reattach(id, &remapped.old);
    remapped.watched_at_the_new_root().await;
    let mut roots = watch.subscribe_roots();
    let new_root = roots.borrow_and_update().clone();

    watch.release(id, &remapped.old).await;
    assert_eq!(watchers(watch), 0, "a watcher holds the new root after the release");
    until(watch, <[NewCaptureCount]>::is_empty).await;
    let (touched, walked) = (touches(probe), walks(watch));
    tokio::time::sleep(FAST.debounce * 5).await;
    assert_eq!(
        (touches(probe), walks(watch), watchers(watch)),
        (touched, walked, 0),
        "the new root was touched while the removal was pending"
    );
    assert!(
        !roots.has_changed().expect("discovery runs"),
        "the named roots changed while the removal was pending: {:?}",
        *roots.borrow()
    );

    watch.reattach(id, &remapped.copy);
    live_count_is(watch, id, 1).await;
    watchers_are(watch, 1).await;
    assert_eq!(*watch.subscribe_roots().borrow(), new_root);
}

/// No notice may ever come (the eject window ends the registration of a
/// root its location no longer follows): the wait runs out on its own, with
/// no sweep.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_root_change_during_a_pending_removal_waits_a_bounded_time() {
    // 3 s, not 1 s: `start` asserts the new root stays untouched after the
    // remap, and a stalled CI runner must not run the wait out before that.
    let settings = Settings { removal_wait: Duration::from_secs(3), ..UNTIL_NOTICED };
    let remapped = RemappedInRemoval::start(settings).await;
    let swept = sweeps(remapped.watch.observed()).load(Ordering::SeqCst);
    remapped.watched_at_the_new_root().await;
    assert_eq!(
        sweeps(remapped.watch.observed()).load(Ordering::SeqCst),
        swept,
        "no sweep started it"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn no_watcher_outlives_shutdown_or_the_handle() {
    let fx = fixture().await;
    let first = captures(&fx.library, &fx.base.join("Captures A")).await;
    let second = captures(&fx.library, &fx.base.join("Captures B")).await;

    let watch = watch(&fx.library);
    until(&watch, |counts| {
        new_files(counts, first.id).is_some() && new_files(counts, second.id).is_some()
    })
    .await;
    assert_eq!(watchers(&watch), 2);
    let mut counts = watch.subscribe();
    counts.borrow_and_update();
    watch.shutdown().await;
    assert_eq!(watchers(&watch), 0);
    assert!(counts.changed().await.is_err(), "the counts end with discovery");

    let dropped = super::CaptureWatch::start_with(&fx.library, FAST, Arc::new(OsProbe));
    until(&dropped, |counts| counts.len() == 2).await;
    let observed = Arc::clone(&dropped.observed);
    drop(dropped);
    eventually("dropping the handle releases every watcher", || {
        observed.watchers.load(Ordering::SeqCst) == 0
    })
    .await;
}

// One worker: a root check that held a runtime worker would leave nothing to
// drive the runtime's timers, the shutdown grace's among them, so the test
// hangs on such a regression on every run, not only when the scheduler leaves
// no spare worker parked on the driver.
#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn shutdown_returns_while_a_root_check_hangs() {
    let fx = fixture().await;
    let location = captures(&fx.library, &fx.base.join("Captures")).await;
    let probe = Arc::new(Probe::default());
    let watch = probed(&fx.library, &probe);
    count_is(&watch, location.id, 0).await;

    // A sweep checks the root, and the check hangs.
    probe.stat_gate.close();
    holding(&probe.stat_gate).await;
    // App exit waits on this: a hung check must not hold it.
    let stopped = tokio::time::timeout(Duration::from_secs(5), watch.shutdown()).await;
    // Canceled, discovery releases every watcher while the check still hangs.
    let released = tokio::time::timeout(Duration::from_secs(5), async {
        while watchers(&watch) != 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    probe.stat_gate.open();
    assert!(stopped.is_ok(), "shutdown waited out a hung root check");
    assert!(released.is_ok(), "a watcher outlived shutdown while a root check hung");
}

// One worker, for the same reason: a watcher closed on that worker as
// discovery stops would leave nothing to drive the shutdown grace.
#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn shutdown_returns_while_a_watcher_is_slow_to_close() {
    let fx = fixture().await;
    let location = captures(&fx.library, &fx.base.join("Captures")).await;
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 0).await;

    // Closing the watcher hangs, as stopping `FSEvents` on a dead share does.
    // A regression holds the only worker until this thread opens the gate,
    // well after the grace, instead of hanging the test.
    let observed = Arc::clone(&watch.observed);
    observed.releases.close();
    let opener = Arc::clone(&observed);
    std::thread::spawn(move || {
        std::thread::sleep(SHUTDOWN_GRACE * 3);
        opener.releases.open();
    });
    let started = std::time::Instant::now();
    watch.shutdown().await;
    let took = started.elapsed();
    assert!(took < SHUTDOWN_GRACE * 2, "a watcher's close held shutdown for {took:?}");
    assert!(observed.releases.held(), "the close waits off the runtime");
    observed.releases.open();
    eventually("the watcher closes once it can", || observed.watchers.load(Ordering::SeqCst) == 0)
        .await;
}

/// A location as discovery holds it once counted, with nothing new yet.
fn counted(location: Location, root: &Path) -> Watched {
    Watched {
        stamp: inventory::root_stamp(root).unwrap(),
        root: root.to_path_buf(),
        prefixes: vec![root.to_path_buf()],
        location,
        live: None,
        known: HashMap::new(),
        vacated: HashMap::new(),
        new: HashMap::new(),
        walk: None,
        unlisted: Vec::new(),
        rescan: false,
        recount: false,
        unreadable: false,
        listed: true,
        cataloged: true,
        released: false,
        moved: None,
        held_offline: None,
    }
}

/// A counted folder moved out of the location, and a link to it took its
/// name at once: the OS watcher reports the name when it already is the
/// link, which is never followed, and the frames below it leave the count.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_link_in_place_of_a_counted_folder_forgets_the_frames_below_it() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("night/Ha_001.fits"));
    let watch = watch(&fx.library);
    count_is(&watch, location.id, 1).await;

    let elsewhere = fx.base.join("elsewhere");
    fs::rename(root.join("night"), &elsewhere).unwrap();
    std::os::unix::fs::symlink(&elsewhere, root.join("night")).unwrap();
    // The folder's path was watched, so the watcher restarts and walks: the
    // count is live again once that walk reconciled it.
    live_count_is(&watch, location.id, 0).await;
}

/// The root is replaced by a link to another tree while live events name it
/// and a path below it, as the root's own watch reports the move: the
/// location goes offline, and no path below the replaced root is read
/// through the link.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_root_replaced_by_a_link_is_never_read_through() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("night/Ha_001.fits"));
    let (events, fed) = tokio::sync::mpsc::channel(16);
    let probe = Arc::new(Probe::default());
    *probe.feed.lock().unwrap() = Some(fed);
    // No sweep after the start: only the events find the replaced root.
    let settings = Settings { sweep: Duration::from_secs(3600), ..FAST };
    let probe_dyn = Arc::clone(&probe) as Arc<dyn RootProbe>;
    let watch = CaptureWatch::start_with(&fx.library, settings, probe_dyn);
    count_is(&watch, location.id, 1).await;

    let elsewhere = fx.base.join("elsewhere");
    frame(&elsewhere.join("night/Ha_002.fits"));
    fs::rename(&root, fx.base.join("moved")).unwrap();
    std::os::unix::fs::symlink(&elsewhere, &root).unwrap();
    events.try_send(named(root.join("night/Ha_002.fits"), ArtifactEventKind::Created)).unwrap();
    events.try_send(named(root.clone(), ArtifactEventKind::Modified)).unwrap();

    until(&watch, <[NewCaptureCount]>::is_empty).await;
    assert_eq!(probe.entries.load(Ordering::SeqCst), 0, "a path was read through the root's link");
}

/// An event the OS watcher would send about `path`.
fn named(path: PathBuf, kind: ArtifactEventKind) -> ArtifactFileEvent {
    ArtifactFileEvent { path: Utf8PathBuf::from_path_buf(path).unwrap(), kind }
}

/// Discovery of `library` through `probe`, with no sweep after the start:
/// only events and walks change the watcher.
fn probed_without_sweeps(library: &Arc<Library>, probe: &Arc<Probe>) -> CaptureWatch {
    let settings = Settings { sweep: Duration::from_secs(3600), ..FAST };
    CaptureWatch::start_with(library, settings, Arc::clone(probe) as Arc<dyn RootProbe>)
}

/// A watched folder renamed out of the location reaches discovery only as
/// its old path, as inotify and Windows report it: the watcher starts again,
/// so no watch follows the folder outside the location. A frame renamed in
/// place, which reports its old path too, never restarts it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_watched_folder_moved_out_of_the_location_restarts_the_watcher() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("night/Ha_001.fits"));
    let (events, fed) = tokio::sync::mpsc::channel(16);
    let probe = Arc::new(Probe::default());
    *probe.feed.lock().unwrap() = Some(fed);
    let watch = probed_without_sweeps(&fx.library, &probe);
    count_is(&watch, location.id, 1).await;

    let (old, new) = (root.join("night/Ha_001.fits"), root.join("night/Ha_002.fits"));
    fs::rename(&old, &new).unwrap();
    events.try_send(named(old, ArtifactEventKind::Modified)).unwrap();
    events.try_send(named(new, ArtifactEventKind::Modified)).unwrap();
    eventually("both paths looked up", || probe.entries.load(Ordering::SeqCst) == 2).await;
    after(&watch, drains, 1).await;
    let started = (probe.watches.load(Ordering::SeqCst), walks(&watch));
    assert_eq!(started, (1, 1), "a frame renamed in place restarted the watcher");
    assert_eq!(new_files(&watch.counts(), location.id), Some(1));

    fs::rename(root.join("night"), fx.base.join("archive")).unwrap();
    events.try_send(named(root.join("night"), ArtifactEventKind::Modified)).unwrap();
    eventually("the watcher restarted", || probe.watches.load(Ordering::SeqCst) == 2).await;
    live_count_is(&watch, location.id, 0).await;
    assert_eq!(walks(&watch), 2);
}

/// An event that spells a counted frame's path another way `Path` holds
/// equal (here a `.` step; on Windows `/` for `\` as well) names that frame:
/// once it is gone, it leaves the count.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_event_spelling_a_counted_path_apart_names_the_same_frame() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("night").join("Ha_001.fits"));
    let (events, fed) = tokio::sync::mpsc::channel(16);
    let probe = Arc::new(Probe::default());
    *probe.feed.lock().unwrap() = Some(fed);
    let watch = probed_without_sweeps(&fx.library, &probe);
    count_is(&watch, location.id, 1).await;

    fs::remove_file(root.join("night").join("Ha_001.fits")).unwrap();
    let spelled = root.join("night").join(".").join("Ha_001.fits");
    events.try_send(named(spelled, ArtifactEventKind::Modified)).unwrap();
    count_is(&watch, location.id, 0).await;
}

/// The OS refused to watch a folder that did not open as the watcher
/// started, and it opens by the time the walk lists it: the watcher starts
/// again at once, not at the next sweep, so the count is not published as
/// live while a listable folder is unwatched. The watchers deliver no
/// event, so only the walk can tell.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_folder_the_walk_lists_in_full_restarts_the_watcher() {
    use std::os::unix::fs::PermissionsExt;
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let night = root.join("night");
    frame(&night.join("Ha_001.fits"));
    let _unlock = Unlock(&night);
    fs::set_permissions(&night, fs::Permissions::from_mode(0o000)).unwrap();
    assert!(fs::read_dir(&night).is_err(), "needs a user file permissions bind, not root");
    let probe = Arc::new(Probe::default());
    *probe.refused.lock().unwrap() = Some(night.clone());
    probe.deaf.store(true, Ordering::SeqCst);
    let _opens = Opens(&probe.list_gate);
    probe.list_gate.close();
    let watch = probed_without_sweeps(&fx.library, &probe);

    // The watcher started with the folder refused and unopened; the walk
    // waits until it opens.
    holding(&probe.list_gate).await;
    fs::set_permissions(&night, fs::Permissions::from_mode(0o755)).unwrap();
    probe.list_gate.open();
    eventually("the watcher restarted", || probe.watches.load(Ordering::SeqCst) == 2).await;
    // Refused again but listable: counted, not live, retried at each sweep.
    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: false }]);
}

/// The metadata of a folder above a counted frame cannot be read once, as a
/// share answers an event's lookup with a brief I/O error: the frame stays
/// counted, and the location is walked again, which finds it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_frame_whose_lookup_fails_stays_counted_and_is_walked_again() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("night/Ha_001.fits"));
    let (events, fed) = tokio::sync::mpsc::channel(16);
    let probe = Arc::new(Probe::default());
    *probe.feed.lock().unwrap() = Some(fed);
    let _opens = Opens(&probe.list_gate);
    let watch = probed(&fx.library, &probe);
    count_is(&watch, location.id, 1).await;

    let failure: Box<dyn FnOnce() -> std::io::Result<()> + Send> =
        Box::new(|| Err(std::io::Error::other("the share did not answer")));
    *probe.before_stat.lock().unwrap() = Some((root.join("night"), failure));
    // The walk that follows waits at the gate, so the count seen meanwhile
    // is the one the event left.
    probe.list_gate.close();
    events.try_send(named(root.join("night/Ha_001.fits"), ArtifactEventKind::Modified)).unwrap();
    holding(&probe.list_gate).await;
    assert_eq!(new_files(&watch.counts(), location.id), Some(1), "an unobserved frame left");
    probe.list_gate.open();
    count_is(&watch, location.id, 1).await;
    assert_eq!(walks(&watch), 2);
}

/// The watcher lost events while a frame arrived: it starts again at once,
/// but the count is not live while the new watcher starts, nor until the
/// walk that follows has reconciled it, finding the frame no event reported.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_count_is_not_live_until_the_walk_after_a_restart_reconciles_it() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("night/Ha_001.fits"));
    let (events, fed) = tokio::sync::mpsc::channel(16);
    let probe = Arc::new(Probe::default());
    *probe.feed.lock().unwrap() = Some(fed);
    let (_lists, _watches) = (Opens(&probe.list_gate), Opens(&probe.watch_gate));
    let watch = probed_without_sweeps(&fx.library, &probe);
    live_count_is(&watch, location.id, 1).await;

    frame(&root.join("night/Ha_002.fits"));
    probe.list_gate.close();
    probe.watch_gate.close();
    events.try_send(named(root.clone(), ArtifactEventKind::NeedsRescan)).unwrap();
    holding(&probe.watch_gate).await;
    let held = [NewCaptureCount { location_id: location.id, new_files: 1, live: false }];
    assert_eq!(watch.counts(), held, "live while the watcher restarts");
    probe.watch_gate.open();
    holding(&probe.list_gate).await;
    assert_eq!(walks(&watch), 2, "the walk after the restart waits");
    after(&watch, drains, 1).await;
    assert_eq!(watch.counts(), held, "live while the walk reconciles");
    probe.list_gate.open();
    live_count_is(&watch, location.id, 2).await;
    assert_eq!(probe.watches.load(Ordering::SeqCst), 2, "the watcher restarted");
}

/// A folder above an event's path is swapped for a link to a folder outside
/// the location while the path is looked up, once that folder was checked:
/// what the lookup read through the link is not counted, and the location
/// is walked again, which does not enter the link.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_folder_swapped_for_a_link_during_a_lookup_is_not_counted_through() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    fs::create_dir_all(root.join("night")).unwrap();
    let elsewhere = fx.base.join("elsewhere");
    frame(&elsewhere.join("Ha_901.fits"));
    let (events, fed) = tokio::sync::mpsc::channel(16);
    let probe = Arc::new(Probe::default());
    *probe.feed.lock().unwrap() = Some(fed);
    let _opens = Opens(&probe.list_gate);
    let watch = probed(&fx.library, &probe);
    count_is(&watch, location.id, 0).await;

    let (night, moved) = (root.join("night"), fx.base.join("moved"));
    let swap: Box<dyn FnOnce() -> std::io::Result<()> + Send> = Box::new(move || {
        fs::rename(&night, moved)?;
        std::os::unix::fs::symlink(elsewhere, &night)
    });
    let created = root.join("night/Ha_901.fits");
    *probe.before_stat.lock().unwrap() = Some((created.clone(), swap));
    probe.list_gate.close();
    events.try_send(named(created, ArtifactEventKind::Created)).unwrap();
    holding(&probe.list_gate).await;
    assert_eq!(new_files(&watch.counts(), location.id), Some(0), "counted through the link");
    probe.list_gate.open();
    count_is(&watch, location.id, 0).await;
    assert_eq!(walks(&watch), 2);
}

/// A folder the OS refused to watch was swapped for a link to a readable
/// folder before discovery checked whether it opens: it is no folder of the
/// tree, and no walk lists it, so the watcher stays live and is not
/// restarted for it.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_folder_swapped_for_a_link_is_not_opened_through_it() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let elsewhere = fx.base.join("elsewhere");
    frame(&elsewhere.join("Ha_901.fits"));
    std::os::unix::fs::symlink(&elsewhere, root.join("night")).unwrap();
    let probe = Arc::new(Probe::default());
    *probe.refused.lock().unwrap() = Some(root.join("night"));
    let watch = probed(&fx.library, &probe);

    let counts = count_is(&watch, location.id, 0).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: true }]);
    after(&watch, sweeps, 2).await;
    let started = (probe.watches.load(Ordering::SeqCst), walks(&watch));
    assert_eq!(started, (1, 1), "restarted for a folder only a link reaches");
}

/// A folder holding counted frames moved out, and a frame took its name
/// before the next debounce tick: the move reported no removal below it.
#[tokio::test]
async fn a_frame_in_place_of_a_counted_folder_forgets_the_frames_below_it() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let mut watched = counted(location, &root);
    let folder = Path::new("M31.fits");
    watched.recheck(&folder.join("Ha_001.fits"), Entry::Frame, None);
    watched.recheck(&folder.join("Ha_002.fits"), Entry::Frame, None);
    assert_eq!(watched.count().new_files, 2);

    watched.recheck(folder, Entry::Frame, None);
    assert_eq!(watched.new.into_values().collect::<Vec<_>>(), [folder.to_path_buf()]);
}

/// A case-only rename on a volume that folds case names one frame under two
/// spellings in one batch, in no set order: the frame found under the new
/// spelling stays counted once, though the old spelling's entry is gone.
#[tokio::test]
async fn a_case_only_rename_keeps_its_frame_counted_once() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    let mut watched = counted(location, &root);
    let volume = &mut watched.location.identity.volume;
    (volume.case, volume.normalization) =
        (PathSensitivity::Insensitive, PathSensitivity::Insensitive);
    let (old, new) = (PathBuf::from("ha_001.fits"), PathBuf::from("Ha_001.fits"));
    watched.recheck(&old, Entry::Frame, None);

    watched.recheck_all(&[(new.clone(), Entry::Frame, None), (old, Entry::Other, None)]);
    assert_eq!(watched.new.into_values().collect::<Vec<_>>(), [new]);
}
