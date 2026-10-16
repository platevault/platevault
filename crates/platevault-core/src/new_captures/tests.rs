// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! New-capture discovery over real temp folders, the real OS watcher and a
//! real catalog (bead astro-plan-ef440).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use camino::Utf8Path;
use fs_inventory::artifact_watcher::TreeWatch;
use uuid::Uuid;

use super::{
    CaptureWatch, Gate, NewCaptureCount, Observed, OsProbe, RootProbe, Settings, Watched,
    WatchedRoot, SHUTDOWN_GRACE,
};
use crate::inventory::{self, Entry, Listing, RootStamp};
use crate::library::{fixtures, Library};
use crate::{LibraryError, Location, LocationRole, NativePath, ScanOperation, ScanState};

/// Ticks short enough for tests; the OS watcher, walks and shutdown grace are
/// real.
const FAST: Settings = Settings {
    debounce: Duration::from_millis(50),
    sweep: Duration::from_millis(200),
    capacity: 1024,
    grace: SHUTDOWN_GRACE,
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

async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
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
}

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

    fn validate(&self, location: &Location) -> Result<(), LibraryError> {
        self.validations.fetch_add(1, Ordering::SeqCst);
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
    let indexed = fx.library.catalog().location_asset_paths(location.id).await.unwrap();
    assert_eq!(indexed, Vec::<NativePath>::new(), "discovery writes nothing to the catalog");
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
    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: true }]);
    assert_eq!((watchers(&watch), walks(&watch)), (1, 2));
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
    eventually("the watcher restarted", || probe.watches.load(Ordering::SeqCst) == 2).await;
    let counts = count_is(&watch, location.id, 1).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 1, live: true }]);
    assert_eq!(walks(&watch), 2);
    frame(&root.join("2026-10-15/Ha_002.fits"));
    count_is(&watch, location.id, 2).await;
    after(&watch, sweeps, 1).await;
    assert_eq!((probe.watches.load(Ordering::SeqCst), walks(&watch)), (2, 2), "settled");
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

    let copy = fx.base.join("Captures copy");
    fs::create_dir_all(&copy).unwrap();
    fs::copy(old.join("Ha_001.fits"), copy.join("Ha_001.fits")).unwrap();
    let current = fx.library.catalog().location(location.id).await.unwrap();
    let review = fx
        .library
        .review_remap(location.id, current.decision_revision, NativePath::from_path(&copy))
        .await
        .unwrap();
    assert!(review.blocked.is_empty(), "{:?}", review.blocked);
    fx.library.apply_remap(review.id, current.decision_revision).await.unwrap();

    // The walk of the new root starts it again from what the catalog holds.
    eventually("the new root walked", || walks(&watch) >= 2).await;
    count_is(&watch, location.id, 0).await;
    frame(&copy.join("Ha_002.fits"));
    frame(&copy.join("Ha_003.fits"));
    count_is(&watch, location.id, 2).await;
    watchers_are(&watch, 1).await;
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
    count_is(&watch, location.id, 1).await;
    let walked = walks(&watch);
    frame(&moved.join("Ha_002.fits"));
    let counts = count_is(&watch, location.id, 2).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 2, live: true }]);
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
async fn a_released_location_touches_its_volume_no_more_until_reattached() {
    let fx = fixture().await;
    let root = fx.base.join("Captures");
    let location = captures(&fx.library, &root).await;
    frame(&root.join("Ha_001.fits"));
    let probe = Arc::new(Probe::default());
    let watch = probed(&fx.library, &probe);
    count_is(&watch, location.id, 1).await;

    // Its drive is about to be ejected: released before this returns.
    watch.release(location.id).await;
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
    watch.reattach(location.id);
    let counts = count_is(&watch, location.id, 2).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 2, live: true }]);
    watchers_are(&watch, 1).await;
    frame(&root.join("Ha_003.fits"));
    count_is(&watch, location.id, 3).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_release_returns_once_the_walk_in_flight_ended() {
    let fx = fixture().await;
    let location = captures(&fx.library, &fx.base.join("Captures")).await;
    let probe = Arc::new(Probe::default());
    let _opens = Opens(&probe.list_gate);
    probe.list_gate.close();
    let watch = probed(&fx.library, &probe);
    holding(&probe.list_gate).await;

    // The start-up walk still lists the volume: the release waits for it.
    let release = watch.release(location.id);
    tokio::pin!(release);
    let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
    assert!(early.is_err(), "released while a walk still listed the volume");
    probe.list_gate.open();
    tokio::time::timeout(Duration::from_secs(5), release).await.expect("released after the walk");
    assert_eq!(watchers(&watch), 0);
    after(&watch, sweeps, 1).await;
    assert_eq!(watch.counts(), Vec::<NewCaptureCount>::new(), "its walk never counted");
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
    let release = watch.release(location.id);
    tokio::pin!(release);
    let early = tokio::time::timeout(Duration::from_millis(300), &mut release).await;
    assert!(early.is_err(), "released while a closing watcher still held the volume");
    releases.open();
    tokio::time::timeout(Duration::from_secs(5), release).await.expect("released once it closed");
    assert_eq!(watchers(&watch), 0);
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
    let named = [WatchedRoot {
        location_id: location.id,
        root: root.clone(),
        volume_kind: location.volume_kind,
    }];

    // The first walk still lists the volume, so nothing is counted, but the
    // root is named: a removal of its volume can be followed.
    holding(&probe.list_gate).await;
    assert_eq!(watch.counts(), Vec::<NewCaptureCount>::new());
    assert_eq!(roots(), named);
    probe.list_gate.open();
    count_is(&watch, location.id, 0).await;

    // Named while its volume is being removed, and no longer once it is.
    watch.release(location.id).await;
    assert_eq!(roots(), named);
    watch.gone(location.id);
    eventually("the root leaves with its location", || roots().is_empty()).await;
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
    watch.release(location.id).await;
    watch.gone(location.id);
    until(&watch, <[NewCaptureCount]>::is_empty).await;
    assert_eq!(watchers(&watch), 0);
    // Plugged back in: the next sweep starts it again.
    frame(&root.join("Ha_001.fits"));
    count_is(&watch, location.id, 1).await;
    watchers_are(&watch, 1).await;
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
        known: HashSet::new(),
        new: HashMap::new(),
        walk: None,
        rescan: false,
        recount: false,
        listed: true,
        cataloged: true,
        released: false,
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
    let counts = count_is(&watch, location.id, 0).await;
    assert_eq!(counts, [NewCaptureCount { location_id: location.id, new_files: 0, live: true }]);
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
    watched.recheck(&folder.join("Ha_001.fits"), Entry::Frame);
    watched.recheck(&folder.join("Ha_002.fits"), Entry::Frame);
    assert_eq!(watched.count().new_files, 2);

    watched.recheck(folder, Entry::Frame);
    assert_eq!(watched.new.into_values().collect::<Vec<_>>(), [folder.to_path_buf()]);
}
