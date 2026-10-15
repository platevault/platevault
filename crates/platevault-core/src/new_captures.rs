// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! New captures (bead astro-plan-ef440): supported frames that arrived in a
//! Captures location and that the catalog does not hold yet, counted per
//! location until an index adds them (a scan of the location, or Import
//! indexing what it landed).
//!
//! [`CaptureWatch`] finds them two ways while the app runs:
//! - a walk of each online Captures location when watching it starts (at app
//!   start, when a location is added, reselected or remapped, and when it
//!   comes back online), which finds the files that arrived while the app was
//!   closed;
//! - a live folder watcher per online location
//!   ([`fs_inventory::artifact_watcher::start_tree_watcher`]).
//!
//! Discovery writes nothing and reads no header. The walk lists entries by
//! the indexer's own rules ([`inventory::frame_paths`]: no link, junction or
//! nested foreign volume, the adapters' supported extensions) and a live
//! event re-checks only the path it names. The catalog is read for the paths
//! it already holds in the location. New files are keyed by each path's
//! identity on the location's volume ([`NativePath::identity_on`], the name
//! comparison the indexer uses), so a file that both the walk and the watcher
//! see, or that they see under two spellings the volume treats as one, counts
//! once. A removed file leaves the set, so a rename is a removal plus an
//! addition. A supported file the index then refuses (an unreadable header)
//! stays counted: it is still not in the library, and the scan names why.
//!
//! Lifecycle:
//! - An Active Captures location is watched while its root is online: the
//!   registered folder on the registered volume. A change through the
//!   [`Library`] (register, reselect, remap, retire) is applied at once;
//!   anything else the catalog lists differently, a removal included, at the
//!   next sweep.
//! - Every sweep each root is `stat`ed once, without following links. A
//!   watched root that is gone or no longer the same folder is dropped at
//!   once, releasing its OS watch. An absent root costs that one `stat` per
//!   sweep; a present one is checked against its registered identity, and a
//!   root refused once is checked again only after its `stat` changes.
//! - An OS watcher error or lost-events notice, a full event channel, or a new
//!   folder (which the watcher does not cover yet) restarts that location's
//!   watcher and walks it again. So does a walk that enters a folder the
//!   watcher did not find as it started (created between its listing and its
//!   registration), and every sweep while the watcher did not start or the OS
//!   refused some of the folders.
//! - A finished scan of a location re-reads the paths the catalog holds there,
//!   so the files it indexed leave the count.
//! - Windows ejects a removable volume only once no process holds a handle
//!   on it, and discovery's watcher holds one per folder. The desktop shell
//!   forwards the eject notices for the volume of each watched root:
//!   [`CaptureWatch::release`] when the removal is requested (the watcher is
//!   released, a walk in flight canceled and awaited, and nothing touches the
//!   root until the next notice), [`CaptureWatch::reattach`] when the removal
//!   was refused, and [`CaptureWatch::gone`] once the volume is removed, which
//!   takes the location offline without waiting for a sweep. Fixed and
//!   network volumes, and macOS and Linux, keep their watchers throughout. A
//!   manual eject check on a Windows machine is still pending.
//!
//! [`CaptureWatch::shutdown`], or dropping the [`CaptureWatch`], stops every
//! watcher. Shutdown waits a short grace at most. A `stat` of a network mount
//! whose server went away can block, so discovery makes every file-system
//! call on a blocking thread, never on a runtime worker: a worker it held
//! would stall the runtime's timers, the grace's among them. A watcher it
//! releases while it runs is stopped there too, since stopping one can wait
//! on such a `stat`. A discovery still waiting on such a call when the grace
//! runs out is canceled, which releases its watchers at once; app exit is
//! never held.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use fs_inventory::artifact_watcher::{
    start_tree_watcher, ArtifactEventKind, ArtifactFileEvent, TreeWatch, WatcherGuard,
};
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::{interval, interval_at, Instant, MissedTickBehavior};
use uuid::Uuid;

use crate::inventory::{self, Entry, Listing, RootStamp};
use crate::library::{blocking, Library};
use crate::{
    LibraryError, Location, LocationLifecycle, LocationRole, NativePath, PathIdentity,
    ScanOperation, ScanState,
};

/// How long live events gather before the paths they name are checked, once
/// each: a capture still being written raises many events for one file.
const DEBOUNCE: Duration = Duration::from_millis(500);
/// How often every Captures root's reachability is checked.
const SWEEP: Duration = Duration::from_secs(30);
/// Live events one location queues between checks; more overflow into a
/// rescan of the location.
const EVENT_CAPACITY: usize = 1024;
/// How long [`CaptureWatch::shutdown`] waits for discovery to stop.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

/// The new files of one online Captures location.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewCaptureCount {
    pub location_id: Uuid,
    /// Supported frames below the location that the catalog does not hold.
    pub new_files: u64,
    /// Whether a live folder watcher covers every folder and keeps the count
    /// current. `false` while it did not start or the OS refused some of the
    /// folders, and every sweep starts it again, or while the location's
    /// removable volume is being removed ([`CaptureWatch::release`]). The
    /// count then rests on the last walk (and on the events of the folders
    /// that are watched).
    pub live: bool,
}

/// Discovery of new captures in every online Captures location of a
/// [`Library`]; see the [module documentation](self).
pub struct CaptureWatch {
    stop: watch::Sender<bool>,
    counts: watch::Receiver<Vec<NewCaptureCount>>,
    notices: mpsc::UnboundedSender<Notice>,
    task: Mutex<Option<JoinHandle<()>>>,
    grace: Duration,
    #[cfg(test)]
    observed: Arc<Observed>,
}

impl CaptureWatch {
    /// Start discovery: walk and watch every online Captures location of
    /// `library`. Call it inside a Tokio runtime, which runs the discovery.
    #[must_use]
    pub fn start(library: &Arc<Library>) -> Self {
        Self::start_with(library, Settings::default(), Arc::new(OsProbe))
    }

    pub(crate) fn start_with(
        library: &Arc<Library>,
        settings: Settings,
        probe: Arc<dyn RootProbe>,
    ) -> Self {
        let (stop, stopped) = watch::channel(false);
        let (publish, counts) = watch::channel(Vec::new());
        let (walked, walks) = mpsc::unbounded_channel();
        let (notices, inbox) = mpsc::unbounded_channel();
        #[cfg(test)]
        let observed = Arc::new(Observed::default());
        // Subscribed before the first reconciliation, so no change between
        // the two is missed.
        let scans = library.subscribe_scan_progress();
        let changes = library.subscribe_location_changes();
        let run = Run {
            library: Arc::clone(library),
            probe,
            settings,
            locations: HashMap::new(),
            offline: HashMap::new(),
            walked,
            publish,
            next_walk: 0,
            #[cfg(test)]
            observed: Arc::clone(&observed),
        };
        let task = tokio::spawn(run.until_stopped(stopped, walks, scans, changes, inbox));
        Self {
            stop,
            counts,
            notices,
            task: Mutex::new(Some(task)),
            grace: settings.grace,
            #[cfg(test)]
            observed,
        }
    }

    /// Every counted location's new files, by location id. A location appears
    /// once its first walk finished and the catalog's paths there were read,
    /// and leaves when it stops being watched.
    #[must_use]
    pub fn counts(&self) -> Vec<NewCaptureCount> {
        self.counts.borrow().clone()
    }

    /// The counts now and after each change; the receiver closes when
    /// discovery stops.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<Vec<NewCaptureCount>> {
        self.counts.clone()
    }

    /// The removable volume holding `location` is about to be removed (the
    /// desktop shell forwards Windows' query to remove it): release its
    /// watcher and cancel its walk, and return once discovery holds no handle
    /// on the volume, so the removal can go ahead.
    ///
    /// Until [`reattach`](Self::reattach) or [`gone`](Self::gone), the
    /// location keeps the count it had, with `live: false`, and nothing
    /// touches its root, a sweep included. Returns at once for a location that
    /// is not watched, and once discovery stopped. Discovery handles one thing
    /// at a time, so this also waits out a file-system call it is making.
    pub async fn release(&self, location: Uuid) {
        let (released, done) = oneshot::channel();
        if self.notices.send(Notice::Release { location, released }).is_ok() {
            // Closed: discovery stopped, which released everything.
            let _ = done.await;
        }
    }

    /// The removal [`release`](Self::release) made way for did not happen:
    /// watch `location` again and walk it for what arrived meanwhile.
    pub fn reattach(&self, location: Uuid) {
        let _ = self.notices.send(Notice::Reattach(location));
    }

    /// The volume holding `location` was removed: stop counting it now
    /// rather than at the next sweep, which starts it again once its root is
    /// back.
    pub fn gone(&self, location: Uuid) {
        let _ = self.notices.send(Notice::Gone(location));
    }

    /// Stop discovery and return once every watcher is released, or once the
    /// shutdown grace ran out while discovery waited on a file-system call:
    /// it is then canceled, which releases its watchers at once.
    pub async fn shutdown(&self) {
        let _ = self.stop.send(true);
        let task = self.task.lock().unwrap_or_else(PoisonError::into_inner).take();
        let Some(mut task) = task else {
            return;
        };
        if tokio::time::timeout(self.grace, &mut task).await.is_err() {
            tracing::warn!("new captures: a file-system call held discovery at shutdown");
            task.abort();
        }
    }
}

impl Drop for CaptureWatch {
    /// Cancel discovery; its task drops every watcher it holds.
    fn drop(&mut self) {
        let task = self.task.get_mut().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(task) = task {
            task.abort();
        }
    }
}

/// Timing and capacity of discovery.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Settings {
    pub(crate) debounce: Duration,
    pub(crate) sweep: Duration,
    pub(crate) capacity: usize,
    pub(crate) grace: Duration,
}

impl Default for Settings {
    fn default() -> Self {
        Self { debounce: DEBOUNCE, sweep: SWEEP, capacity: EVENT_CAPACITY, grace: SHUTDOWN_GRACE }
    }
}

/// How discovery observes a location root. Every method is blocking.
pub(crate) trait RootProbe: Send + Sync + 'static {
    /// One no-follow `stat`: the root's continuity stamp, or `None` when it
    /// is absent or not a real folder.
    fn stamp(&self, root: &Path) -> Option<RootStamp>;

    /// Whether the root is the registered folder on the registered volume,
    /// which is qualified through a bounded OS query.
    ///
    /// # Errors
    /// The identity check's error, as for a scan.
    fn validate(&self, location: &Location) -> Result<(), LibraryError>;

    /// Start an OS watcher over every real folder below the root.
    ///
    /// # Errors
    /// Why the watcher did not start.
    fn watch(&self, root: &Utf8Path, capacity: usize) -> Result<TreeWatch, String>;

    /// List the frames and folders below the root by the indexer's rules
    /// ([`inventory::frame_paths`]).
    ///
    /// # Errors
    /// As [`inventory::frame_paths`].
    fn list(
        &self,
        root: &Path,
        stamp: RootStamp,
        canceled: &AtomicBool,
    ) -> Result<Listing, LibraryError>;
}

struct OsProbe;

impl RootProbe for OsProbe {
    fn stamp(&self, root: &Path) -> Option<RootStamp> {
        inventory::root_stamp(root)
    }

    fn validate(&self, location: &Location) -> Result<(), LibraryError> {
        inventory::validate_location_root(location).map(drop)
    }

    fn watch(&self, root: &Utf8Path, capacity: usize) -> Result<TreeWatch, String> {
        start_tree_watcher(&[root.to_path_buf()], capacity)
    }

    fn list(
        &self,
        root: &Path,
        stamp: RootStamp,
        canceled: &AtomicBool,
    ) -> Result<Listing, LibraryError> {
        inventory::frame_paths(root, stamp, canceled)
    }
}

/// What tests read about the running discovery.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct Observed {
    /// OS watchers held now.
    pub(crate) watchers: std::sync::atomic::AtomicUsize,
    /// Walks started so far.
    pub(crate) walks: std::sync::atomic::AtomicUsize,
    /// Debounce ticks whose events started draining so far.
    pub(crate) drains: std::sync::atomic::AtomicUsize,
    /// Sweeps started so far, the reconciliation at start included.
    pub(crate) sweeps: std::sync::atomic::AtomicUsize,
    /// Releasing a watcher waits here while it is closed, as stopping an
    /// `FSEvents` watcher waits on its callback's `stat` of a dead share.
    pub(crate) releases: Gate,
}

#[cfg(test)]
impl CaptureWatch {
    pub(crate) fn observed(&self) -> &Observed {
        &self.observed
    }
}

/// A gate a blocking call waits at while it is closed, as a call on a
/// network mount whose server went away waits.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct Gate {
    closed: Mutex<bool>,
    changed: std::sync::Condvar,
    held: AtomicBool,
}

#[cfg(test)]
impl Gate {
    pub(crate) fn close(&self) {
        *self.closed.lock().unwrap_or_else(PoisonError::into_inner) = true;
    }

    pub(crate) fn open(&self) {
        *self.closed.lock().unwrap_or_else(PoisonError::into_inner) = false;
        self.changed.notify_all();
    }

    /// Wait while the gate is closed.
    pub(crate) fn pass(&self) {
        let closed = self.closed.lock().unwrap_or_else(PoisonError::into_inner);
        let waits = |closed: &mut bool| {
            if *closed {
                self.held.store(true, Ordering::SeqCst);
            }
            *closed
        };
        drop(self.changed.wait_while(closed, waits).unwrap_or_else(PoisonError::into_inner));
    }

    /// Whether a call waited at the gate.
    pub(crate) fn held(&self) -> bool {
        self.held.load(Ordering::SeqCst)
    }
}

/// One live OS watcher and the events it queued.
struct Live {
    events: mpsc::Receiver<ArtifactFileEvent>,
    guard: WatcherGuard,
    /// The folders it found below the root as it started, relative to the
    /// root. It lists them before it registers them, so a folder created in
    /// between is missing and unwatched.
    folders: HashSet<PathBuf>,
    /// Whether it watches every folder it found; the folders the OS refused
    /// deliver no event.
    complete: bool,
    #[cfg(test)]
    _held: Held,
}

/// Counts a held watcher in [`Observed::watchers`] until it is dropped.
#[cfg(test)]
struct Held(Arc<Observed>);

#[cfg(test)]
impl Drop for Held {
    fn drop(&mut self) {
        self.0.releases.pass();
        self.0.watchers.fetch_sub(1, Ordering::SeqCst);
    }
}

/// A walk in flight.
struct Walk {
    id: u64,
    canceled: Arc<AtomicBool>,
    /// Paths live events named while it ran, checked again after it.
    touched: HashSet<PathBuf>,
    /// Resolves, closed, once its listing made its last file-system call.
    listed: Option<oneshot::Receiver<()>>,
}

impl Drop for Walk {
    fn drop(&mut self) {
        self.canceled.store(true, Ordering::Release);
    }
}

/// What a walk found: the paths the catalog holds in the location, and what
/// it listed on disk. Either can fail on its own.
struct Walked {
    location: Uuid,
    walk: u64,
    known: Result<Vec<NativePath>, LibraryError>,
    listing: Result<Listing, LibraryError>,
}

/// What the desktop shell reports about the removable volume holding a
/// location; see [`CaptureWatch::release`].
enum Notice {
    /// The volume is about to be removed: once nothing holds a handle on it,
    /// `released` is sent.
    Release { location: Uuid, released: oneshot::Sender<()> },
    /// The removal did not happen.
    Reattach(Uuid),
    /// The volume was removed.
    Gone(Uuid),
}

/// An online Captures location being counted.
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent flags: two kinds of pending work, the two halves of a known count, and a released volume"
)]
struct Watched {
    location: Location,
    root: PathBuf,
    /// `root` and, where the OS reports events under the canonical path
    /// (macOS), that path.
    prefixes: Vec<PathBuf>,
    stamp: RootStamp,
    live: Option<Live>,
    /// Identities of the paths the catalog holds in the location.
    known: HashSet<PathIdentity>,
    /// The new files: identity to relative path.
    new: HashMap<PathIdentity, PathBuf>,
    walk: Option<Walk>,
    /// Restart the watcher and walk again once the walk in flight ends.
    rescan: bool,
    /// Read the catalog's paths again: once the walk in flight ends, and at
    /// every debounce tick while the catalog cannot be read.
    recount: bool,
    /// A walk finished.
    listed: bool,
    /// The catalog's paths were read: with `listed`, the count is known.
    cataloged: bool,
    /// Its volume is being removed ([`CaptureWatch::release`]): it holds no
    /// watcher or walk, and nothing touches its root.
    released: bool,
}

impl Watched {
    fn identity(&self, relative: &Path) -> PathIdentity {
        NativePath::from_path(relative).identity_on(&self.location.identity.volume)
    }

    /// At a sweep, restart a watcher that did not start or watches only some
    /// folders, through a rescan, once no walk runs. A non-UTF-8 root is
    /// never watched, so it is not retried.
    fn retry_watcher(&mut self) {
        let partial = self.live.as_ref().is_none_or(|live| !live.complete);
        if partial && self.walk.is_none() && self.root.to_str().is_some() {
            self.rescan = true;
        }
    }

    fn relative<'a>(&self, path: &'a Path) -> Option<&'a Path> {
        self.prefixes.iter().find_map(|prefix| path.strip_prefix(prefix).ok())
    }

    /// Take the catalog's paths a walk read. When only the catalog failed, the
    /// location stays online, counted against the paths the catalog held when
    /// last read, and the catalog is read again.
    fn known_from(&mut self, known: Result<Vec<NativePath>, LibraryError>) {
        match known {
            Ok(known) => self.know(&known),
            Err(error) => {
                tracing::warn!(location = %self.location.id, %error, "new captures: indexed paths unreadable; read again at the next tick");
                self.recount = true;
            }
        }
    }

    fn know(&mut self, known: &[NativePath]) {
        let volume = &self.location.identity.volume;
        self.known = known.iter().map(|path| path.identity_on(volume)).collect();
        let known = &self.known;
        self.new.retain(|key, _| !known.contains(key));
        self.cataloged = true;
    }

    /// Replace the count with a finished walk's, against the catalog's paths
    /// as last read.
    ///
    /// A folder the walk entered that the watcher did not find as it
    /// started was created while it registered, and nothing watches it: the
    /// watcher is restarted. Every walk starts once its watcher is
    /// registered, so this misses no folder. One created before its parent's
    /// watch was registered is already there when the walk lists the parent,
    /// and the parent's watch reports one created after it.
    fn counted_from(&mut self, listing: Listing) {
        if let Some(live) = &self.live {
            self.rescan |= listing.folders.iter().any(|folder| !live.folders.contains(folder));
        }
        let volume = &self.location.identity.volume;
        let known = &self.known;
        self.new = listing
            .frames
            .into_iter()
            .filter_map(|frame| {
                let key = frame.identity_on(volume);
                if known.contains(&key) {
                    return None;
                }
                frame.to_path_buf().ok().map(|path| (key, path))
            })
            .collect();
        self.listed = true;
    }

    /// Take the events the live watcher queued, marking a rescan for an OS
    /// watcher error, a lost-events notice, a new folder or a full channel.
    /// Returns whether an event named the root, and the paths below it that
    /// events named, once each; a walk in flight also keeps those to check
    /// again after it. Touches no file system.
    fn take_events(&mut self) -> (bool, HashSet<PathBuf>) {
        let mut root_touched = false;
        let mut touched = HashSet::new();
        let Some(live) = self.live.as_mut() else {
            return (root_touched, touched);
        };
        let mut rescan = live.guard.overflow_flag.swap(false, Ordering::AcqRel);
        let mut named = HashSet::new();
        while let Ok(event) = live.events.try_recv() {
            if event.kind == ArtifactEventKind::NeedsRescan {
                rescan = true;
            } else {
                named.insert(event.path.into_std_path_buf());
            }
        }
        self.rescan |= rescan;
        for path in named {
            let Some(relative) = self.relative(&path).map(Path::to_path_buf) else {
                continue;
            };
            if relative.as_os_str().is_empty() {
                root_touched = true;
                continue;
            }
            if let Some(walk) = self.walk.as_mut() {
                walk.touched.insert(relative.clone());
            }
            touched.insert(relative);
        }
        (root_touched, touched)
    }

    /// Bring the count up to date for one path a live event named, from the
    /// entry found there now.
    fn recheck(&mut self, relative: &Path, entry: Entry) {
        let key = self.identity(relative);
        match entry {
            Entry::Frame => {
                if !self.known.contains(&key) {
                    self.new.insert(key, relative.to_path_buf());
                }
            }
            // A folder's own change; folders that appear arrive as rescans.
            Entry::Folder => {}
            Entry::Other => {
                if self.new.remove(&key).is_none() {
                    self.forget_below(relative);
                }
            }
        }
    }

    /// Drop the new files below a folder that went away.
    fn forget_below(&mut self, folder: &Path) {
        if self.new.is_empty() {
            return;
        }
        let depth = folder.components().count();
        let key = self.identity(folder);
        let volume = &self.location.identity.volume;
        self.new.retain(|_, path| {
            path.components().count() <= depth
                || NativePath::from_path(&path.components().take(depth).collect::<PathBuf>())
                    .identity_on(volume)
                    != key
        });
    }

    /// Whether the count is known: a walk finished and the catalog was read.
    const fn counted(&self) -> bool {
        self.listed && self.cataloged
    }

    fn count(&self) -> NewCaptureCount {
        NewCaptureCount {
            location_id: self.location.id,
            new_files: u64::try_from(self.new.len()).unwrap_or(u64::MAX),
            live: self.live.as_ref().is_some_and(|live| live.complete),
        }
    }
}

/// An Active Captures location that is not online.
struct Offline {
    location: Location,
    /// The root's stamp when its identity was last refused; an unchanged
    /// stamp is not checked again.
    refused: Option<RootStamp>,
}

/// Whether two records of a location name the same root.
fn same_root(a: &Location, b: &Location) -> bool {
    a.path == b.path && a.identity == b.identity
}

/// Stop an OS watcher on a blocking thread, never on a runtime worker:
/// stopping one can wait on the file system. `FSEvents` joins its thread,
/// whose callback `stat`s the paths it reports, on a share that may be gone.
fn unwatch(live: Option<Live>) {
    if let Some(live) = live {
        drop(tokio::task::spawn_blocking(move || drop(live)));
    }
}

/// Resolves once a stop was requested or the handle was dropped.
async fn stopped(stop: &mut watch::Receiver<bool>) {
    // An error means the sender is gone, which is a stop as well.
    let _ = stop.wait_for(|stop| *stop).await;
}

struct Run {
    library: Arc<Library>,
    probe: Arc<dyn RootProbe>,
    settings: Settings,
    locations: HashMap<Uuid, Watched>,
    offline: HashMap<Uuid, Offline>,
    walked: mpsc::UnboundedSender<Walked>,
    publish: watch::Sender<Vec<NewCaptureCount>>,
    next_walk: u64,
    #[cfg(test)]
    observed: Arc<Observed>,
}

impl Run {
    /// Discover until stopped; returning drops every watcher.
    async fn until_stopped(
        mut self,
        mut stop: watch::Receiver<bool>,
        mut walks: mpsc::UnboundedReceiver<Walked>,
        mut scans: broadcast::Receiver<ScanOperation>,
        mut changes: broadcast::Receiver<Uuid>,
        mut notices: mpsc::UnboundedReceiver<Notice>,
    ) {
        self.reconcile(true).await;
        self.publish();
        let mut debounce = interval(self.settings.debounce);
        debounce.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut sweep = interval_at(Instant::now() + self.settings.sweep, self.settings.sweep);
        sweep.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                () = stopped(&mut stop) => break,
                Some(walked) = walks.recv() => self.walked(walked).await,
                Some(notice) = notices.recv() => self.noticed(notice).await,
                change = changes.recv() => match change {
                    Ok(_) | Err(RecvError::Lagged(_)) => self.reconcile(false).await,
                    Err(RecvError::Closed) => break,
                },
                scan = scans.recv() => if !self.scanned(scan).await {
                    break;
                },
                _ = debounce.tick() => self.drain().await,
                _ = sweep.tick() => self.reconcile(true).await,
            }
            self.publish();
        }
    }

    /// Apply a scan's progress; `false` once scans can no longer be followed.
    async fn scanned(&mut self, scan: Result<ScanOperation, RecvError>) -> bool {
        match scan {
            Ok(operation) if operation.state != ScanState::Running => {
                self.indexed(operation.location_id).await;
            }
            Ok(_) => {}
            Err(RecvError::Lagged(_)) => self.recount_all().await,
            Err(RecvError::Closed) => return false,
        }
        true
    }

    /// Follow the catalog's Active Captures locations: stop what is no longer
    /// listed, retired or moved, and start what is online. A sweep also
    /// checks every root's reachability.
    async fn reconcile(&mut self, sweep: bool) {
        #[cfg(test)]
        if sweep {
            self.observed.sweeps.fetch_add(1, Ordering::SeqCst);
        }
        let wanted: HashMap<Uuid, Location> = match self.library.catalog().list_locations().await {
            Ok(listed) => listed
                .into_iter()
                .filter(|location| {
                    location.role == LocationRole::Captures
                        && location.lifecycle == LocationLifecycle::Active
                })
                .map(|location| (location.id, location))
                .collect(),
            Err(error) => {
                tracing::warn!(%error, "new captures: locations unreadable; watches unchanged");
                return;
            }
        };
        // Removed, retired and re-roled locations stop; reselected and
        // remapped ones start again at their new root.
        let stopped = self.locations.extract_if(|id, watched| {
            !wanted.get(id).is_some_and(|location| same_root(location, &watched.location))
        });
        for (_, mut watched) in stopped {
            unwatch(watched.live.take());
        }
        self.offline.retain(|id, offline| {
            wanted.get(id).is_some_and(|location| same_root(location, &offline.location))
        });
        for location in wanted.into_values() {
            self.follow(location, sweep).await;
        }
    }

    /// Keep, release or start one Active Captures location. Outside a sweep
    /// only locations not seen before are checked; a sweep also restarts a
    /// watcher that did not fully start. A released location's root is not
    /// touched.
    async fn follow(&mut self, location: Location, sweep: bool) {
        let id = location.id;
        let refused = if let Some(released) = self.locations.get(&id).map(|w| w.released) {
            if !sweep || released || self.unchanged(id).await {
                if let Some(watched) = self.locations.get_mut(&id) {
                    watched.location = location;
                    if sweep && !released {
                        watched.retry_watcher();
                    }
                }
                return;
            }
            self.go_offline(id);
            None
        } else if let Some(offline) = self.offline.get(&id) {
            if !sweep {
                return;
            }
            offline.refused
        } else {
            None
        };
        self.try_start(location, refused).await;
    }

    /// Start a location whose root is online, else record it offline.
    async fn try_start(&mut self, location: Location, refused: Option<RootStamp>) {
        let id = location.id;
        let Ok(root) = location.path.to_path_buf() else {
            self.offline.insert(id, Offline { location, refused: None });
            return;
        };
        let Some(stamp) = self.stamp(root.clone()).await else {
            self.offline.insert(id, Offline { location, refused: None });
            return;
        };
        if refused == Some(stamp) {
            self.offline.insert(id, Offline { location, refused });
            return;
        }
        let probe = Arc::clone(&self.probe);
        let checked = location.clone();
        let resolved = root.clone();
        let canonical = match blocking(move || {
            probe.validate(&checked)?;
            Ok(std::fs::canonicalize(&resolved).ok().filter(|canonical| *canonical != resolved))
        })
        .await
        {
            Ok(canonical) => canonical,
            Err(error) => {
                tracing::info!(location = %id, %error, "new captures: root is not the registered folder");
                self.offline.insert(id, Offline { location, refused: Some(stamp) });
                return;
            }
        };
        self.offline.remove(&id);
        let mut prefixes = vec![root.clone()];
        prefixes.extend(canonical);
        let live = self.attach(&root).await;
        self.locations.insert(
            id,
            Watched {
                location,
                root,
                prefixes,
                stamp,
                live,
                known: HashSet::new(),
                new: HashMap::new(),
                walk: None,
                rescan: false,
                recount: false,
                listed: false,
                cataloged: false,
                released: false,
            },
        );
        self.walk(id);
    }

    /// Stop counting a location whose root went away, releasing its watch.
    fn go_offline(&mut self, id: Uuid) {
        if let Some(mut watched) = self.locations.remove(&id) {
            unwatch(watched.live.take());
            tracing::info!(location = %id, "new captures: root went away; watch released");
            self.offline.insert(id, Offline { location: watched.location, refused: None });
        }
    }

    /// Apply what the desktop shell reported about a location's volume.
    async fn noticed(&mut self, notice: Notice) {
        match notice {
            Notice::Release { location, released } => self.release(location, released),
            Notice::Reattach(location) => self.reattach(location).await,
            Notice::Gone(location) => self.go_offline(location),
        }
    }

    /// Release every handle discovery holds on `id`'s volume, its watcher and
    /// its walk in flight, then send `released`. Discovery's other file-system
    /// calls are awaited where they are made, so none is in flight here.
    fn release(&mut self, id: Uuid, released: oneshot::Sender<()>) {
        let Some(watched) = self.locations.get_mut(&id) else {
            let _ = released.send(());
            return;
        };
        tracing::info!(location = %id, "new captures: volume to be removed; watch released");
        watched.released = true;
        watched.rescan = false;
        let live = watched.live.take();
        // Dropping the walk cancels it: its listing stops at the next folder.
        let listed = watched.walk.take().and_then(|mut walk| walk.listed.take());
        tokio::spawn(async move {
            if let Some(listed) = listed {
                let _ = listed.await;
            }
            if let Some(live) = live {
                let _ = tokio::task::spawn_blocking(move || drop(live)).await;
            }
            let _ = released.send(());
        });
    }

    /// The removal a release made way for did not happen: watch the location
    /// again and walk it.
    async fn reattach(&mut self, id: Uuid) {
        let Some(watched) = self.locations.get_mut(&id).filter(|watched| watched.released) else {
            return;
        };
        watched.released = false;
        tracing::info!(location = %id, "new captures: volume stays; watched again");
        self.rescan(id).await;
    }

    /// The root's continuity stamp, from a `stat` on a blocking thread; `None`
    /// as well when that check was interrupted.
    async fn stamp(&self, root: PathBuf) -> Option<RootStamp> {
        let probe = Arc::clone(&self.probe);
        tokio::task::spawn_blocking(move || probe.stamp(&root)).await.ok().flatten()
    }

    /// Whether a watched location's root is still the folder its watch
    /// started on.
    async fn unchanged(&self, id: Uuid) -> bool {
        let Some(watched) = self.locations.get(&id) else {
            return false;
        };
        let stamp = watched.stamp;
        self.stamp(watched.root.clone()).await == Some(stamp)
    }

    /// Watch every real folder below `root`.
    async fn attach(&self, root: &Path) -> Option<Live> {
        let Ok(watched) = Utf8PathBuf::from_path_buf(root.to_path_buf()) else {
            tracing::warn!(root = %root.display(), "new captures: a non-UTF-8 root is counted, not watched");
            return None;
        };
        let capacity = self.settings.capacity;
        let probe = Arc::clone(&self.probe);
        let started = tokio::task::spawn_blocking(move || {
            let TreeWatch { events, guard, folders, unwatched } =
                probe.watch(&watched, capacity)?;
            let folders = folders
                .iter()
                .filter_map(|folder| folder.strip_prefix(&watched).ok())
                .map(Path::to_path_buf)
                .collect();
            Ok((events, guard, folders, unwatched == 0))
        })
        .await
        .unwrap_or_else(|interrupted| Err(interrupted.to_string()));
        let (events, guard, folders, complete) = started
            .inspect_err(|error| {
                tracing::warn!(root = %root.display(), %error, "new captures: watcher did not start");
            })
            .ok()?;
        #[cfg(test)]
        self.observed.watchers.fetch_add(1, Ordering::SeqCst);
        Some(Live {
            events,
            guard,
            folders,
            complete,
            #[cfg(test)]
            _held: Held(Arc::clone(&self.observed)),
        })
    }

    /// Read which paths the catalog holds in a location, then walk it for its
    /// frames; the outcome arrives as [`Walked`]. The catalog is read first,
    /// so a scan that ends while the listing runs is caught by
    /// [`Watched::recount`].
    fn walk(&mut self, id: Uuid) {
        let Some(watched) = self.locations.get_mut(&id) else {
            return;
        };
        self.next_walk += 1;
        let walk = self.next_walk;
        let canceled = Arc::new(AtomicBool::new(false));
        let (ends, listed) = oneshot::channel::<()>();
        watched.walk = Some(Walk {
            id: walk,
            canceled: Arc::clone(&canceled),
            touched: HashSet::new(),
            listed: Some(listed),
        });
        watched.rescan = false;
        watched.recount = false;
        #[cfg(test)]
        self.observed.walks.fetch_add(1, Ordering::SeqCst);
        let (root, stamp) = (watched.root.clone(), watched.stamp);
        let library = Arc::clone(&self.library);
        let probe = Arc::clone(&self.probe);
        let sender = self.walked.clone();
        tokio::spawn(async move {
            let known = library.catalog().location_asset_paths(id).await;
            let listing = blocking(move || {
                // Dropped once the listing returned, which closes `listed`.
                let _ends = ends;
                probe.list(&root, stamp, &canceled)
            })
            .await;
            let _ = sender.send(Walked { location: id, walk, known, listing });
        });
    }

    async fn walked(&mut self, walked: Walked) {
        let id = walked.location;
        let Some(watched) = self.locations.get_mut(&id) else {
            return;
        };
        if watched.walk.as_ref().is_none_or(|walk| walk.id != walked.walk) {
            return;
        }
        let Some(mut walk) = watched.walk.take() else {
            return;
        };
        let listing = match walked.listing {
            Ok(listing) => listing,
            Err(error) => {
                // The root went away or cannot be read: offline until a sweep
                // finds it again, never retried in a loop.
                tracing::warn!(location = %id, %error, "new captures: walk failed");
                self.go_offline(id);
                return;
            }
        };
        watched.known_from(walked.known);
        watched.counted_from(listing);
        // The walk may have listed the paths live events named while it ran
        // before they changed.
        self.recheck(id, std::mem::take(&mut walk.touched)).await;
        let Some(watched) = self.locations.get(&id) else {
            return;
        };
        if watched.rescan {
            self.rescan(id).await;
        } else if watched.recount {
            self.recount(id).await;
        }
    }

    /// Apply the events every live watcher queued since the last tick, then
    /// restart the watchers or read again the catalog paths that wait for no
    /// walk.
    async fn drain(&mut self) {
        #[cfg(test)]
        self.observed.drains.fetch_add(1, Ordering::SeqCst);
        let mut queued = Vec::new();
        for (id, watched) in &mut self.locations {
            let (root_touched, touched) = watched.take_events();
            let pending = watched.walk.is_none() && (watched.rescan || watched.recount);
            if root_touched || !touched.is_empty() || pending {
                queued.push((*id, root_touched, touched));
            }
        }
        for (id, root_touched, touched) in queued {
            self.recheck(id, touched).await;
            if root_touched && !self.unchanged(id).await {
                self.go_offline(id);
                continue;
            }
            let Some(watched) = self.locations.get(&id) else {
                continue;
            };
            if watched.walk.is_some() {
                continue;
            }
            if watched.rescan {
                self.rescan(id).await;
            } else if watched.recount {
                self.recount(id).await;
            }
        }
    }

    /// Bring a location's count up to date for paths live events named, each
    /// read on a blocking thread. Checks that were interrupted are redone by a
    /// walk, as events the OS lost are.
    async fn recheck(&mut self, id: Uuid, touched: HashSet<PathBuf>) {
        if touched.is_empty() {
            return;
        }
        let Some(watched) = self.locations.get(&id) else {
            return;
        };
        let (root, stamp) = (watched.root.clone(), watched.stamp);
        let entries = tokio::task::spawn_blocking(move || {
            touched
                .into_iter()
                .map(|relative| {
                    let entry = inventory::entry_at(&root, stamp, &relative);
                    (relative, entry)
                })
                .collect::<Vec<_>>()
        })
        .await;
        let Some(watched) = self.locations.get_mut(&id) else {
            return;
        };
        match entries {
            Ok(entries) => {
                for (relative, entry) in &entries {
                    watched.recheck(relative, *entry);
                }
            }
            Err(_) => watched.rescan = true,
        }
    }

    /// Restart a location's watcher over its current folders and walk it; a
    /// released location waits for its reattachment.
    async fn rescan(&mut self, id: Uuid) {
        if self.locations.get(&id).is_none_or(|watched| watched.released) {
            return;
        }
        if !self.unchanged(id).await {
            self.go_offline(id);
            return;
        }
        let Some(watched) = self.locations.get_mut(&id) else {
            return;
        };
        // The old OS watch is released before the new folder set registers.
        unwatch(watched.live.take());
        let root = watched.root.clone();
        let live = self.attach(&root).await;
        if let Some(watched) = self.locations.get_mut(&id) {
            watched.live = live;
        }
        self.walk(id);
    }

    /// A scan of `id` finished: what it indexed leaves the count.
    async fn indexed(&mut self, id: Uuid) {
        match self.locations.get_mut(&id) {
            Some(watched) if watched.walk.is_some() => watched.recount = true,
            Some(_) => self.recount(id).await,
            None => {}
        }
    }

    /// Read the catalog's paths in `id` again; while the catalog cannot be
    /// read, every debounce tick tries again.
    async fn recount(&mut self, id: Uuid) {
        let read = self.library.catalog().location_asset_paths(id).await;
        let Some(watched) = self.locations.get_mut(&id) else {
            return;
        };
        match read {
            Ok(known) => {
                watched.know(&known);
                watched.recount = false;
            }
            Err(error) => {
                if !watched.recount {
                    tracing::warn!(location = %id, %error, "new captures: indexed paths unreadable; read again at the next tick");
                }
                watched.recount = true;
            }
        }
    }

    /// Scan snapshots were missed: re-read every location's indexed paths.
    async fn recount_all(&mut self) {
        let ids: Vec<Uuid> = self.locations.keys().copied().collect();
        for id in ids {
            self.indexed(id).await;
        }
    }

    fn publish(&self) {
        let mut counts: Vec<NewCaptureCount> = self
            .locations
            .values()
            .filter(|watched| watched.counted())
            .map(Watched::count)
            .collect();
        counts.sort_by_key(|count| count.location_id);
        self.publish.send_if_modified(|current| {
            if *current == counts {
                false
            } else {
                *current = counts;
                true
            }
        });
    }
}

#[cfg(test)]
mod tests;
