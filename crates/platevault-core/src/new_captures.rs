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
//! event re-checks only the path it names ([`inventory::entry_at`]), without
//! following a link, checking the root and every folder above the path
//! again once it was looked up. A path whose metadata, or that of a folder
//! above it, cannot be read for another reason than its absence (a share's
//! brief I/O error), or a folder above which changed during the lookup,
//! keeps what was counted there, and the location is walked again. The
//! catalog is read for the paths it already holds in the location. New
//! files are keyed by each path's identity on the location's volume
//! ([`NativePath::identity_on`], the name
//! comparison the indexer uses), so a file that both the walk and the watcher
//! see, or that they see under two spellings the volume treats as one, counts
//! once. A removed file leaves the set, so a rename is a removal plus an
//! addition. A supported file the index then refuses (an unreadable header)
//! stays counted: it is still not in the library, and the scan names why.
//! The path of a Missing or Trashed record holds no file the catalog holds
//! (bead astro-plan-0rfuw): a frame there is counted unless it still has the
//! size and modification time the record last observed, as the original put
//! back (from the OS Trash, or onto the drive again) has, which a scan
//! returns to its record. Those are read off the runtime from the no-follow
//! metadata of the frames the walk lists or a live event finds there. A
//! different file with that same size and modification time is taken for
//! the original until a scan reads it: discovery reads no file's contents,
//! and a new capture that matches both, to the nanosecond, is unlikely.
//!
//! Lifecycle:
//! - An Active Captures location is watched while its root is online: the
//!   registered folder on the registered volume. A change through the
//!   [`Library`] (register, reselect, remap, retire) is applied at once, and
//!   an offline location reselected at the same root is checked at once;
//!   anything else the catalog lists differently, a removal included, at the
//!   next sweep.
//! - Every sweep each root is checked once without following links, and so
//!   is the root of each location whose live events a debounce tick checks,
//!   before any path they name is read. The check is one no-follow `stat`;
//!   on Windows it also opens a handle on the root folder itself, never a
//!   reparse target, and reads its folder ID. A watched root that is gone or
//!   no longer the same folder (replaced by a link or by another folder,
//!   which on Windows only its folder ID tells apart) is dropped at once,
//!   releasing its OS watch, and nothing below it is read through it. An
//!   absent root costs that one check per sweep; a present one is checked
//!   against its registered identity. A root refused because it is not the
//!   registered folder is checked again only after that check's result
//!   changes, and one whose identity could not be observed (a volume query
//!   that failed) at the next sweep.
//! - An OS watcher error or lost-events notice, a full event channel, a new
//!   folder (which the watcher does not cover yet), a folder whose access
//!   changed, a folder reported removed while a folder is still at its path,
//!   or a path that is not UTF-8 restarts that location's watcher and walks
//!   it again. So does a walk that enters a folder the watcher did not find
//!   as it started (created between its listing and its registration), and
//!   every sweep while the watcher did not start or the OS refused a folder
//!   the walk can list.
//! - A folder no walk can list holds nothing the count holds, as a scan
//!   leaves it out. One the OS refuses to watch too (`System Volume
//!   Information` at the root of an NTFS drive, `lost+found` on ext4) leaves
//!   the watcher live. Every sweep checks whether such a folder can be listed
//!   now, and walks the location again once one can, since a folder that
//!   becomes readable raises no event that brings its files in.
//! - A volume mounted inside a location is neither walked nor watched, and a
//!   walk never lists through a folder swapped for a link or junction. Nor
//!   does a sweep's check of a folder no walk could list in full, or of one
//!   the OS refused to watch. On macOS, where `FSEvents` reports an unmount
//!   of such a volume as a removal of its mount point, the folder below it
//!   is then walked and watched. Linux raises no inotify event in the folder
//!   above a mount point when its volume is unmounted, and Windows likely
//!   reports only a `Modify(Any)` on a folder that still opens, which asks
//!   for no rescan: there the folder below is found only by the next walk of
//!   the location (a rescan for another reason, or the next start).
//! - A finished scan of a location, and frames recorded Trashed there
//!   ([`Library::subscribe_trashed`]), re-read the paths the catalog holds
//!   there, so the files a scan indexed leave the count. A path whose file
//!   the catalog held and whose record left it since is looked up again: a
//!   frame written in place of a trashed one before the trash was recorded
//!   was judged held.
//! - Windows ejects a volume only once no process holds a handle on it, and
//!   discovery's watcher holds one per folder. [`CaptureWatch::subscribe_roots`]
//!   names every root discovery may hold such a handle through: from the
//!   moment it starts watching it until its location stops following it,
//!   and after that until the walk it canceled there stopped listing and the
//!   watchers it let go of there closed. So the removal of a retired or
//!   remapped location's old volume can still be waited for, and a remapped
//!   location's old root is named beside its new one meanwhile. The desktop
//!   shell forwards the eject notices for the volume of each one that is not
//!   a network share, with that root: [`CaptureWatch::release`] when the
//!   removal is requested (the location's watcher there is closed, its walk
//!   in flight canceled, and both, with every watcher still closing and walk
//!   still listing on that volume, awaited; nothing touches the root until
//!   the next notice), [`CaptureWatch::reattach`] when the removal was
//!   refused, and [`CaptureWatch::gone`] once the volume is removed, which
//!   takes the location offline without waiting for a sweep. A notice about
//!   a root its location no longer follows leaves the location alone. A
//!   location reselected or remapped while the removal of its root's volume
//!   is pending touches neither root and keeps the old one named, so the
//!   shell keeps its registration and the removal's notices still arrive;
//!   its new root, which may be on that volume, is watched once the removal
//!   was refused or completed, or after a bounded wait when no notice
//!   comes. A release returns once discovery is asked to stop, so app exit
//!   never waits on one. A watcher close or walk still in flight a sweep
//!   after discovery let go of it is logged once, with its root. macOS and
//!   Linux need none of this.
//!
//! [`CaptureWatch::shutdown`], or dropping the [`CaptureWatch`], stops every
//! watcher. Shutdown waits a short grace at most. A `stat` of a network mount
//! whose server went away can block, so discovery makes every file-system
//! call on a blocking thread, never on a runtime worker: a worker it held
//! would stall the runtime's timers, the grace's among them. Every watcher it
//! stops, while it runs and once it stopped or was canceled, is stopped there
//! too, since stopping one can wait on such a `stat`. A discovery still
//! waiting on such a call when the grace runs out is canceled; app exit is
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
use persistence_library::{RecordedPath, SizeAndTime};
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinHandle;
use tokio::time::{interval, interval_at, Instant, MissedTickBehavior};
use uuid::Uuid;

use crate::inventory::{self, Entry, FolderId, Listing, RootRefusal, RootStamp};
use crate::library::{blocking, Library};
use crate::{
    LibraryError, Location, LocationLifecycle, LocationRole, NativePath, PathIdentity,
    ScanOperation, ScanState, VolumeKind,
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
/// How long a location reselected or remapped while the removal of its
/// root's volume is pending waits for that removal's outcome, which may never
/// arrive, before its new root is watched.
const REMOVAL_WAIT: Duration = Duration::from_secs(30);

/// The new files of one online Captures location.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewCaptureCount {
    pub location_id: Uuid,
    /// Supported frames below the location that the catalog does not hold.
    pub new_files: u64,
    /// Whether a live folder watcher covers every folder and keeps the count
    /// current. `false` while it did not start or the OS refused a folder
    /// that a walk can list, and every sweep starts it again, while a walk
    /// reconciles the count (as one does after every restart of the
    /// watcher, which missed what changed while it was down), or while the
    /// location's volume is being removed ([`CaptureWatch::release`]). The
    /// count then rests on the last walk (and on the events of the folders
    /// that are watched).
    pub live: bool,
}

/// A root discovery follows, or still holds handles through: through a
/// watcher or a walk, it may hold handles on that root's volume until the
/// location leaves and every watcher it closed there and walk it canceled
/// there returned.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WatchedRoot {
    pub location_id: Uuid,
    pub root: PathBuf,
    pub volume_kind: VolumeKind,
    /// The root folder's ID when discovery started watching it, which the
    /// folder at `root` keeps while it is the same folder; `None` on a
    /// platform that reports none. A handle held for the root (the Windows
    /// removal notices) is bound to the folder with this ID, never to
    /// another one that took its path.
    pub folder: Option<FolderId>,
}

/// Discovery of new captures in every online Captures location of a
/// [`Library`]; see the [module documentation](self).
pub struct CaptureWatch {
    stop: watch::Sender<bool>,
    counts: watch::Receiver<Vec<NewCaptureCount>>,
    roots: watch::Receiver<Vec<WatchedRoot>>,
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
        let (publish_roots, roots) = watch::channel(Vec::new());
        let (walked, walks) = mpsc::unbounded_channel();
        let (notices, inbox) = mpsc::unbounded_channel();
        #[cfg(test)]
        let observed = Arc::new(Observed::default());
        // Subscribed before the first reconciliation, so no change between
        // the two is missed.
        let indexing = Indexing {
            scans: library.subscribe_scan_progress(),
            trashed: library.subscribe_trashed(),
        };
        let changes = library.subscribe_location_changes();
        let run = Run {
            library: Arc::clone(library),
            probe,
            settings,
            locations: HashMap::new(),
            offline: HashMap::new(),
            walked,
            publish,
            publish_roots,
            draining: Draining::default(),
            next_walk: 0,
            #[cfg(test)]
            observed: Arc::clone(&observed),
        };
        let task = tokio::spawn(run.until_stopped(stopped, walks, indexing, changes, inbox));
        Self {
            stop,
            counts,
            roots,
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

    /// The roots discovery may hold handles through, by location id and
    /// path, now and after each change. A root appears before its watcher
    /// starts and stays while its volume is being removed
    /// ([`release`](Self::release)) and after its location stops following
    /// it (retired, removed, remapped or offline), until the watchers
    /// discovery closed there and the walks it canceled there returned; it
    /// leaves by the next debounce tick after they did. A remapped
    /// location's old root is named beside its new one meanwhile. The
    /// receiver closes when discovery stops.
    #[must_use]
    pub fn subscribe_roots(&self) -> watch::Receiver<Vec<WatchedRoot>> {
        self.roots.clone()
    }

    /// The volume holding `root`, a root of `location` that
    /// [`subscribe_roots`](Self::subscribe_roots) names, is about to be
    /// removed (the desktop shell forwards Windows' query to remove it):
    /// close the location's watcher there and cancel its walk, and return
    /// once discovery holds no handle on the volume, a watcher still closing
    /// or a walk still listing that it let go of before included, whichever
    /// location it served, so the removal can go ahead.
    ///
    /// Until [`reattach`](Self::reattach) or [`gone`](Self::gone), the
    /// location keeps the count it had, with `live: false`, and nothing
    /// touches its root, a sweep included. A reselect or remap meanwhile
    /// takes it out of the counts and touches the new root only after that
    /// notice, or after a bounded wait when none comes. A location that no
    /// longer follows `root` (a remapped location's old root) is left alone:
    /// this only waits. Discovery handles one thing at a time, so this also
    /// waits out a file-system call it is making. It returns at once when
    /// discovery stopped, and as soon as it is asked to stop
    /// ([`shutdown`](Self::shutdown)), so app exit never waits on a removal
    /// whose walk or watcher close hangs.
    pub async fn release(&self, location: Uuid, root: &Path) {
        let (released, done) = oneshot::channel();
        let notice = Notice::Release { location, root: root.to_path_buf(), released };
        if self.notices.send(notice).is_err() {
            // Closed: discovery stopped, which released everything.
            return;
        }
        let mut stop = self.stop.subscribe();
        tokio::select! {
            _ = done => {}
            () = stopped(&mut stop) => {}
        }
    }

    /// The removal [`release`](Self::release) made way for did not happen:
    /// watch `location` again at `root`, if it still follows it there, and
    /// walk it for what arrived meanwhile.
    pub fn reattach(&self, location: Uuid, root: &Path) {
        let _ = self.notices.send(Notice::Reattach { location, root: root.to_path_buf() });
    }

    /// The volume holding `root` was removed: stop counting `location` now,
    /// if it follows `root`, rather than at the next sweep, which starts it
    /// again once its root is back.
    pub fn gone(&self, location: Uuid, root: &Path) {
        let _ = self.notices.send(Notice::Gone { location, root: root.to_path_buf() });
    }

    /// Stop discovery and return once every watcher is closed, or once the
    /// shutdown grace ran out while discovery waited on a file-system call or
    /// a watcher's close: it is then canceled, and the watchers it still held
    /// close off the runtime.
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
    /// Cancel discovery; the watchers its task holds close off the runtime.
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
    pub(crate) removal_wait: Duration,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            debounce: DEBOUNCE,
            sweep: SWEEP,
            capacity: EVENT_CAPACITY,
            grace: SHUTDOWN_GRACE,
            removal_wait: REMOVAL_WAIT,
        }
    }
}

/// How discovery observes a location root. Every method is blocking.
pub(crate) trait RootProbe: Send + Sync + 'static {
    /// The root's continuity stamp, or `None` when it is absent or not a
    /// real folder: one no-follow `stat`, and on Windows a query of a handle
    /// on the root folder itself (never a reparse target) for its folder ID.
    fn stamp(&self, root: &Path) -> Option<RootStamp>;

    /// Whether the root is the registered folder on the registered volume,
    /// which is qualified through a bounded OS query.
    ///
    /// # Errors
    /// The identity check's refusal, as for a scan, telling a mismatch from a
    /// root that could not be observed.
    fn validate(&self, location: &Location) -> Result<(), RootRefusal>;

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

    /// What a path a live event named below the root is, by the indexer's
    /// rules ([`inventory::entry_at`]).
    fn entry(&self, root: &Path, stamp: RootStamp, relative: &Path) -> Entry;

    /// The root's canonical path, every link above it resolved: on macOS
    /// `FSEvents` names the paths below a root reached through a linked
    /// folder by it.
    ///
    /// # Errors
    /// The path could not be resolved.
    fn canonical(&self, root: &Path) -> std::io::Result<PathBuf>;
}

struct OsProbe;

impl RootProbe for OsProbe {
    fn stamp(&self, root: &Path) -> Option<RootStamp> {
        inventory::root_stamp(root)
    }

    fn validate(&self, location: &Location) -> Result<(), RootRefusal> {
        inventory::check_location_root(location)
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

    fn entry(&self, root: &Path, stamp: RootStamp, relative: &Path) -> Entry {
        inventory::entry_at(root, stamp, relative)
    }

    fn canonical(&self, root: &Path) -> std::io::Result<PathBuf> {
        std::fs::canonicalize(root)
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
    /// Watcher closes and walk listings logged as still in flight a sweep
    /// after discovery let go of them.
    pub(crate) stuck: std::sync::atomic::AtomicUsize,
    /// Recounts started: reads of a location's catalog paths outside a walk.
    pub(crate) recounts: std::sync::atomic::AtomicUsize,
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
    /// Whether every folder it found is watched or one no walk can list: the
    /// folders the OS refused deliver no event, and only those a walk lists
    /// hold files the count holds.
    complete: bool,
    /// The folders the OS refused that no walk could list as it started,
    /// relative to the root. A sweep restarts the watcher once one of them
    /// can be listed.
    unlisted: Vec<PathBuf>,
    #[cfg(test)]
    _held: Held,
}

impl Live {
    /// Stop watching, and return once the OS released the watched folders.
    /// Blocking, as [`WatcherGuard::close`].
    fn close(self) {
        let Self { guard, .. } = self;
        guard.close();
    }
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
    /// Its listing, which may hold handles on the root's volume until it
    /// returned.
    listing: Call,
}

impl Drop for Walk {
    fn drop(&mut self) {
        self.canceled.store(true, Ordering::Release);
    }
}

/// What a walk found: the paths the catalog records in the location, and
/// what it listed on disk. Either can fail on its own.
struct Walked {
    location: Uuid,
    walk: u64,
    known: Result<Vec<RecordedPath>, LibraryError>,
    listing: Result<Listing, LibraryError>,
}

/// What the desktop shell reports about the removable volume holding a root
/// of a location; see [`CaptureWatch::release`].
enum Notice {
    /// The volume is about to be removed: once nothing holds a handle on it,
    /// `released` is sent.
    Release { location: Uuid, root: PathBuf, released: oneshot::Sender<()> },
    /// The removal did not happen.
    Reattach { location: Uuid, root: PathBuf },
    /// The volume was removed.
    Gone { location: Uuid, root: PathBuf },
}

/// A path below a root a live event named, relative to the root: what is
/// there now and, for a frame at the path of a Missing or Trashed record,
/// its size and time.
type Found = (PathBuf, Entry, Option<SizeAndTime>);

/// An online Captures location being counted.
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent flags: two kinds of pending work, the two halves of a known count, an unreadable catalog, and a released volume"
)]
struct Watched {
    location: Location,
    root: PathBuf,
    /// `root` and, where the OS reports events under the canonical path
    /// (macOS), that path.
    prefixes: Vec<PathBuf>,
    stamp: RootStamp,
    live: Option<Live>,
    /// Identities of the paths whose file the catalog holds in the location.
    known: HashSet<PathIdentity>,
    /// Identities of the paths of the location's Missing and Trashed
    /// records, each with the size and modification time its file had when
    /// last observed: a frame there is that file put back, held, only while
    /// it still has them.
    vacated: HashMap<PathIdentity, SizeAndTime>,
    /// The new files: identity to relative path.
    new: HashMap<PathIdentity, PathBuf>,
    walk: Option<Walk>,
    /// The folders the last walk could not list, relative to the root: a
    /// sweep walks again once one of them can be listed.
    unlisted: Vec<PathBuf>,
    /// Restart the watcher and walk again once the walk in flight ends.
    rescan: bool,
    /// Read the catalog's paths again once no walk is in flight: at the
    /// next debounce tick, or once the walk in flight ends, and at every
    /// debounce tick while the catalog cannot be read.
    recount: bool,
    /// The last read of the catalog's paths failed, and was logged.
    unreadable: bool,
    /// A walk finished.
    listed: bool,
    /// The catalog's paths were read: with `listed`, the count is known.
    cataloged: bool,
    /// Its volume is being removed ([`CaptureWatch::release`]): it holds no
    /// watcher or walk, and nothing touches its root.
    released: bool,
    /// Where the location moved (reselected or remapped) while it was
    /// released ([`Run::moved_in_removal`]).
    moved: Option<Moved>,
}

/// The record of a released location at the root it moved to, and when it
/// moved.
struct Moved {
    to: Location,
    since: Instant,
}

impl Watched {
    fn identity(&self, relative: &Path) -> PathIdentity {
        NativePath::from_path(relative).identity_on(&self.location.identity.volume)
    }

    fn relative<'a>(&self, path: &'a Path) -> Option<&'a Path> {
        self.prefixes.iter().find_map(|prefix| path.strip_prefix(prefix).ok())
    }

    /// Its root, as [`CaptureWatch::subscribe_roots`] names it.
    fn named(&self) -> WatchedRoot {
        WatchedRoot {
            location_id: self.location.id,
            root: self.root.clone(),
            volume_kind: self.location.volume_kind,
            folder: self.stamp.folder(),
        }
    }

    /// Take the catalog's paths a walk read. When only the catalog failed, the
    /// location stays online, counted against the paths the catalog held when
    /// last read, and the catalog is read again.
    fn known_from(&mut self, known: Result<Vec<RecordedPath>, LibraryError>) {
        match known {
            Ok(known) => self.know(&known),
            Err(error) => {
                if !self.unreadable {
                    tracing::warn!(location = %self.location.id, %error, "new captures: indexed paths unreadable; read again at the next tick");
                }
                self.unreadable = true;
                self.recount = true;
            }
        }
    }

    /// Take the paths the catalog records. A frame counted at the path of a
    /// Missing or Trashed record keeps the judgement made when it was found:
    /// such a record keeps the size and time it last observed while its file
    /// is gone, and a change of the frame raises an event that judges it again.
    fn know(&mut self, recorded: &[RecordedPath]) {
        let volume = &self.location.identity.volume;
        self.known.clear();
        self.vacated.clear();
        for record in recorded {
            let key = record.path.identity_on(volume);
            match record.vacated {
                Some(file) => {
                    self.vacated.insert(key, file);
                }
                None => {
                    self.known.insert(key);
                }
            }
        }
        let known = &self.known;
        self.new.retain(|key, _| !known.contains(key));
        self.cataloged = true;
        self.unreadable = false;
    }

    /// Whether the frame at the path whose identity is `key`, whose size and
    /// time are `file`, is a file the catalog holds: the catalog holds a file
    /// at that path, or the path's record left it and `file` is that file.
    fn holds(&self, key: &PathIdentity, file: Option<SizeAndTime>) -> bool {
        self.known.contains(key) || file.is_some_and(|file| self.vacated.get(key) == Some(&file))
    }

    /// Whether the catalog, as last read, records a Missing or Trashed
    /// record at the path `relative`.
    fn vacated_at(&self, relative: &Path) -> bool {
        self.vacated.contains_key(&self.identity(relative))
    }

    /// The paths of the Missing and Trashed records among `recorded` whose
    /// file the catalog held when last read.
    fn vacated_since(&self, recorded: &[RecordedPath]) -> HashSet<PathBuf> {
        let volume = &self.location.identity.volume;
        recorded
            .iter()
            .filter(|record| {
                record.vacated.is_some() && self.known.contains(&record.path.identity_on(volume))
            })
            .filter_map(|record| record.path.to_path_buf().ok())
            .collect()
    }

    /// Replace the count with a finished walk's, against the catalog's paths
    /// as last read.
    ///
    /// A folder the walk entered that the watcher did not find as it
    /// started was created while it registered, and nothing watches it: the
    /// watcher is restarted. Every walk starts once its watcher is
    /// registered, so this misses no folder. One created before its parent's
    /// watch was registered is already there when the walk lists the parent,
    /// and the parent's watch reports one created after it. So is the
    /// watcher restarted for a folder the OS refused to watch and that did
    /// not open as it started, once the walk lists it in full: it may be
    /// watched now, and until then it holds files no event reports.
    fn counted_from(&mut self, listing: Listing) {
        if let Some(live) = &self.live {
            self.rescan |= listing.folders.iter().any(|folder| {
                !live.folders.contains(folder)
                    || (live.unlisted.contains(folder) && !listing.unlisted.contains(folder))
            });
        }
        self.unlisted = listing.unlisted;
        let volume = &self.location.identity.volume;
        let new = listing
            .frames
            .into_iter()
            .filter_map(|frame| {
                let key = frame.path.identity_on(volume);
                if self.holds(&key, frame.file) {
                    return None;
                }
                frame.path.to_path_buf().ok().map(|path| (key, path))
            })
            .collect();
        self.new = new;
        self.listed = true;
    }

    /// Take the events the live watcher queued, marking a rescan for an OS
    /// watcher error, a lost-events notice, a new folder or a full channel.
    /// Returns whether an event named the root, and the paths below it that
    /// events named, once each; a walk in flight also keeps those to check
    /// again after it. Touches no file system.
    ///
    /// Each path is rebuilt from its components, as a walk builds the paths
    /// it counts: a name's identity is its native spelling
    /// ([`Watched::identity`]), and a path `Path` holds equal can be spelled
    /// apart (`/` for `\` on Windows, a `.` step), which would make a second
    /// name of one the count holds.
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
            let Some(relative) =
                self.relative(&path).map(|relative| relative.components().collect::<PathBuf>())
            else {
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
    /// entry found there now and, for a frame at the path of a Missing or
    /// Trashed record, its size and time (`file`). An entry that could not
    /// be observed keeps what was counted at and below it, and the location
    /// is walked again, which finds what is there.
    ///
    /// A folder the watcher watches that is no longer a folder at its path
    /// (removed, or renamed away, out of the location as well) restarts the
    /// watcher ([`TreeWatch::folders`]): `ReadDirectoryChangesW` watches a
    /// folder, not its path, so its handle would follow one moved out of the
    /// location, and the watched folders would name one that is gone. Only a
    /// watched folder's path does this; a file renamed or removed never
    /// restarts the watcher.
    fn recheck(&mut self, relative: &Path, entry: Entry, file: Option<SizeAndTime>) {
        if matches!(entry, Entry::Frame | Entry::Other)
            && self.live.as_ref().is_some_and(|live| live.folders.contains(relative))
        {
            self.rescan = true;
        }
        let key = self.identity(relative);
        match entry {
            Entry::Frame => {
                // A folder may have stood here, moved out with its files
                // counted below it: such a move does not reliably report
                // their removal.
                if !self.new.contains_key(&key) {
                    self.forget_below(relative);
                }
                // A vacated record's file put back in place of another.
                if self.holds(&key, file) {
                    self.new.remove(&key);
                } else {
                    self.new.insert(key, relative.to_path_buf());
                }
            }
            // A folder's own change; folders that appear, or whose access
            // changes, arrive as rescans.
            Entry::Folder => {}
            Entry::Other => {
                if self.new.remove(&key).is_none() {
                    self.forget_below(relative);
                }
            }
            Entry::Unobserved => self.rescan = true,
        }
    }

    /// [`Self::recheck`] for each path one batch of live events named, every
    /// path that holds no frame first. On a volume that folds case or
    /// normalization, two spellings of one name share an identity, and a
    /// rename between them names both in one batch, in no set order: the
    /// frame found under one spelling must outlast the other spelling's
    /// removal. A frame below a path found gone is counted as well; when that
    /// path was a watched folder, the watcher restarts and walks it again.
    fn recheck_all(&mut self, found: &[Found]) {
        let frame = |entry: &Entry| *entry == Entry::Frame;
        for (relative, entry, file) in found.iter().filter(|(_, entry, _)| !frame(entry)) {
            self.recheck(relative, *entry, *file);
        }
        for (relative, entry, file) in found.iter().filter(|(_, entry, _)| frame(entry)) {
            self.recheck(relative, *entry, *file);
        }
    }

    /// Drop the new files below a folder that went away or was replaced.
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

    /// Whether the count is known: a walk finished and the catalog was read,
    /// at the root the location follows.
    const fn counted(&self) -> bool {
        self.listed && self.cataloged && self.moved.is_none()
    }

    fn count(&self) -> NewCaptureCount {
        NewCaptureCount {
            location_id: self.location.id,
            new_files: u64::try_from(self.new.len()).unwrap_or(u64::MAX),
            live: self.walk.is_none() && self.live.as_ref().is_some_and(|live| live.complete),
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

/// Close an OS watcher on a blocking thread, never on a runtime worker:
/// closing one can wait on the file system. `FSEvents` joins its thread,
/// whose callback `stat`s the paths it reports, on a share that may be gone,
/// and Windows waits for its thread to close every folder handle. Outside a
/// runtime it closes here. The close still in flight, if any, is returned.
fn close_off_runtime(live: Live) -> Option<Call> {
    if let Ok(runtime) = tokio::runtime::Handle::try_current() {
        let (returns, close) = Call::start();
        drop(runtime.spawn_blocking(move || {
            live.close();
            drop(returns);
        }));
        Some(close)
    } else {
        live.close();
        None
    }
}

/// A blocking file-system call that may hold handles on a root's volume
/// until it returns: a watcher's close or a walk's listing. Every clone sees
/// it return.
#[derive(Clone)]
struct Call(watch::Receiver<()>);

impl Call {
    /// A call, and the guard it drops once it returned.
    fn start() -> (watch::Sender<()>, Self) {
        let (returns, call) = watch::channel(());
        (returns, Self(call))
    }

    /// Whether it returned. Nothing is ever sent: the channel only closes,
    /// once the guard is dropped.
    fn returned(&self) -> bool {
        self.0.has_changed().is_err()
    }

    /// Resolves once it returned.
    async fn wait(mut self) {
        while self.0.changed().await.is_ok() {}
    }
}

/// The calls discovery let go of that may still hold handles on a root's
/// volume: watchers it closed and walks it canceled, each with the root it
/// ran on. That root stays named ([`CaptureWatch::subscribe_roots`]) until
/// they returned, so a removal of its volume can still be followed and
/// waited for ([`Run::release`]) once its location no longer follows it.
#[derive(Default)]
struct Draining {
    /// Watcher closes, which shutdown waits for as well.
    closing: Vec<LetGo>,
    /// Listings of canceled walks, which stop at their next folder.
    listing: Vec<LetGo>,
}

/// A call discovery let go of, and the root it ran on.
struct LetGo {
    root: WatchedRoot,
    call: Call,
    /// When discovery let go of it.
    since: Instant,
    /// Whether it was reported still in flight ([`Draining::prune`]).
    reported: bool,
}

impl LetGo {
    fn now(root: WatchedRoot, call: Call) -> Self {
        Self { root, call, since: Instant::now(), reported: false }
    }
}

impl Draining {
    /// Close `watched`'s watcher off the runtime ([`close_off_runtime`]) and
    /// cancel its walk, keeping each until it returned.
    fn let_go(&mut self, watched: &mut Watched) {
        if let Some(close) = watched.live.take().and_then(close_off_runtime) {
            self.closing.push(LetGo::now(watched.named(), close));
        }
        // Dropping the walk cancels it.
        if let Some(walk) = watched.walk.take() {
            self.listing.push(LetGo::now(watched.named(), walk.listing.clone()));
        }
    }

    /// Forget the calls that returned, and pass each one still in flight
    /// `after` it was let go to `stuck` once, with what it is: one that
    /// never returns keeps its root named, and a release of its volume
    /// waiting, until discovery stops.
    fn prune(&mut self, after: Duration, mut stuck: impl FnMut(&'static str, &LetGo)) {
        self.closing.retain(|let_go| !let_go.call.returned());
        self.listing.retain(|let_go| !let_go.call.returned());
        let calls = self.closing.iter_mut().map(|let_go| ("watcher close", let_go));
        for (what, let_go) in calls.chain(self.listing.iter_mut().map(|let_go| ("walk", let_go))) {
            if !let_go.reported && let_go.since.elapsed() >= after {
                let_go.reported = true;
                stuck(what, let_go);
            }
        }
    }

    /// The roots calls still run on, once per call.
    fn roots(&self) -> impl Iterator<Item = &WatchedRoot> {
        self.closing.iter().chain(&self.listing).map(|let_go| &let_go.root)
    }

    /// The calls in flight on a root that `accepts` accepts.
    fn on(&self, accepts: impl Fn(&WatchedRoot) -> bool) -> Vec<Call> {
        let calls = self.closing.iter().chain(&self.listing);
        calls.filter(|let_go| accepts(&let_go.root)).map(|let_go| let_go.call.clone()).collect()
    }

    /// Take every watcher close in flight.
    fn closes(&mut self) -> Vec<Call> {
        self.closing.drain(..).map(|let_go| let_go.call).collect()
    }
}

/// The catalog changes after which discovery reads a location's paths
/// again: a scan that ended, and frames recorded Trashed outside a scan.
struct Indexing {
    scans: broadcast::Receiver<ScanOperation>,
    trashed: broadcast::Receiver<Uuid>,
}

/// Whose paths to read again.
#[derive(Clone, Copy)]
enum Reread {
    Location(Uuid),
    /// Changes were missed.
    Every,
}

impl Indexing {
    /// The next change; `None` once changes can no longer be followed. A
    /// running scan's progress changes nothing. Cancel-safe: a change taken
    /// is returned.
    async fn next(&mut self) -> Option<Reread> {
        loop {
            let changed = tokio::select! {
                scan = self.scans.recv() => scan.map(|scan| {
                    (scan.state != ScanState::Running).then_some(scan.location_id)
                }),
                trashed = self.trashed.recv() => trashed.map(Some),
            };
            match changed {
                Ok(Some(location)) => return Some(Reread::Location(location)),
                Ok(None) => {}
                Err(RecvError::Lagged(_)) => return Some(Reread::Every),
                Err(RecvError::Closed) => return None,
            }
        }
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
    publish_roots: watch::Sender<Vec<WatchedRoot>>,
    /// The watchers discovery closed and the walks it canceled, until they
    /// returned.
    draining: Draining,
    next_walk: u64,
    #[cfg(test)]
    observed: Arc<Observed>,
}

impl Drop for Run {
    /// Discovery stopped or was canceled: the watchers it still holds close
    /// off the runtime too, so neither a stop nor app exit waits on one.
    fn drop(&mut self) {
        for watched in self.locations.values_mut() {
            if let Some(live) = watched.live.take() {
                drop(close_off_runtime(live));
            }
        }
    }
}

impl Run {
    /// Discover until stopped, then close every watcher, and wait for that,
    /// off the runtime.
    async fn until_stopped(
        mut self,
        mut stop: watch::Receiver<bool>,
        mut walks: mpsc::UnboundedReceiver<Walked>,
        mut indexing: Indexing,
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
                reread = indexing.next() => if !self.reread(reread) {
                    break;
                },
                _ = debounce.tick() => self.tick().await,
                _ = sweep.tick() => self.reconcile(true).await,
            }
            self.publish();
        }
        self.close_all().await;
    }

    /// Close every watcher off the runtime and wait for each still closing.
    /// A close that hangs holds no runtime worker, so the shutdown grace
    /// still runs out. A canceled walk still listing is not waited for.
    async fn close_all(&mut self) {
        for watched in self.locations.values_mut() {
            self.draining.let_go(watched);
        }
        for close in self.draining.closes() {
            close.wait().await;
        }
    }

    /// At every debounce tick, check the paths live events named, and start
    /// each location that waited long enough for the removal of its old
    /// root's volume at the root it moved to.
    async fn tick(&mut self) {
        self.drain().await;
        self.waited_out().await;
    }

    /// Read the catalog's paths again as `reread` asks; `false` once the
    /// catalog's changes can no longer be followed.
    fn reread(&mut self, reread: Option<Reread>) -> bool {
        match reread {
            Some(Reread::Location(id)) => self.indexed(id),
            Some(Reread::Every) => self.recount_all(),
            None => return false,
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
        // remapped ones start again at their new root, once the removal of
        // their old root's volume is no longer pending (`follow`).
        for (_, mut watched) in self.locations.extract_if(|id, watched| {
            !wanted
                .get(id)
                .is_some_and(|location| watched.released || same_root(location, &watched.location))
        }) {
            self.draining.let_go(&mut watched);
        }
        self.offline.retain(|id, offline| {
            wanted.get(id).is_some_and(|location| same_root(location, &offline.location))
        });
        for location in wanted.into_values() {
            self.follow(location, sweep).await;
        }
    }

    /// Keep, release or start one Active Captures location. Outside a sweep
    /// only locations not seen before, and offline ones reselected, are
    /// checked; a sweep also restarts a watcher that did not fully start. A
    /// released location's root is not touched, nor is the root it moved to.
    async fn follow(&mut self, location: Location, sweep: bool) {
        let id = location.id;
        if self
            .locations
            .get(&id)
            .is_some_and(|watched| watched.released && !same_root(&location, &watched.location))
        {
            self.moved_in_removal(location);
            return;
        }
        let refused = if let Some(released) = self.locations.get(&id).map(|w| w.released) {
            if !sweep || released || self.unchanged(id).await {
                if let Some(watched) = self.locations.get_mut(&id) {
                    watched.location = location;
                    // Back at its old root, if it moved away.
                    watched.moved = None;
                }
                if sweep && !released {
                    self.retry_watcher(id).await;
                }
                return;
            }
            self.go_offline(id);
            None
        } else if let Some(offline) = self.offline.get(&id) {
            // A decision committed on the location since it went offline (a
            // reselection at the same root) has it checked at once, even
            // when its folder was refused before; otherwise only a sweep
            // checks it.
            let reselected = offline.location.decision_revision != location.decision_revision;
            if !sweep && !reselected {
                return;
            }
            offline.refused.filter(|_| !reselected)
        } else {
            None
        };
        self.try_start(location, refused).await;
    }

    /// `location` moved (reselected or remapped) while the removal of its
    /// old root's volume is pending. Its new root may be on that volume, so
    /// nothing touches it, and the old root stays named, so the eject window
    /// keeps that root's registration and the removal's outcome still
    /// arrives: [`Run::reattach`] or [`Run::gone`] then start the location at
    /// its new root ([`Run::move_on`]). A notice may never come, so it starts
    /// there as well once it waited [`Settings::removal_wait`], at the next
    /// debounce tick ([`Run::waited_out`]).
    fn moved_in_removal(&mut self, location: Location) {
        if let Some(watched) = self.locations.get_mut(&location.id) {
            let since = watched.moved.as_ref().map_or_else(Instant::now, |moved| moved.since);
            watched.moved = Some(Moved { to: location, since });
        }
    }

    /// Start every location that waited long enough for the removal of its
    /// old root's volume at the root it moved to.
    async fn waited_out(&mut self) {
        let wait = self.settings.removal_wait;
        let waited: Vec<Uuid> = self
            .locations
            .iter()
            .filter(|(_, watched)| {
                watched.moved.as_ref().is_some_and(|m| m.since.elapsed() >= wait)
            })
            .map(|(id, _)| *id)
            .collect();
        for id in waited {
            tracing::warn!(location = %id, "new captures: the removal of the old root's volume was not decided in time; the new root is watched");
            self.move_on(id).await;
        }
    }

    /// Stop following the old root of `id`, a location that moved while its
    /// volume was being removed, and start it at the root it moved to.
    async fn move_on(&mut self, id: Uuid) {
        let Some(mut watched) = self.locations.remove(&id) else {
            return;
        };
        self.draining.let_go(&mut watched);
        if let Some(moved) = watched.moved {
            self.try_start(moved.to, None).await;
        }
    }

    /// At a sweep, restart a watcher that did not start or misses a folder a
    /// walk can list, through a rescan, once no walk runs. A root that is not
    /// UTF-8 is never watched, so every sweep walks it again instead. A
    /// folder that no walk could list in full, refused by the watcher or left
    /// incomplete by the last walk, is listed again first: the location is
    /// rescanned once one of them lists in full.
    async fn retry_watcher(&mut self, id: Uuid) {
        let Some(watched) = self.locations.get(&id) else {
            return;
        };
        if watched.walk.is_some() {
            return;
        }
        let retry = match &watched.live {
            Some(live) if !live.complete => true,
            None => true,
            Some(live) => {
                let unlisted: Vec<PathBuf> =
                    watched.unlisted.iter().chain(&live.unlisted).cloned().collect();
                let (root, stamp) = (watched.root.clone(), watched.stamp);
                !unlisted.is_empty()
                    && tokio::task::spawn_blocking(move || {
                        unlisted.iter().any(|folder| inventory::lists_fully(&root, stamp, folder))
                    })
                    .await
                    .unwrap_or(false)
            }
        };
        if let Some(watched) = self.locations.get_mut(&id).filter(|_| retry) {
            watched.rescan = true;
        }
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
        let canonical = match self.check_root(&location, &root).await {
            Ok(canonical) => canonical,
            // Not checked again until the folder at the path changes.
            Err(RootRefusal::Mismatch(error)) => {
                tracing::info!(location = %id, %error, "new captures: root is not the registered folder");
                self.offline.insert(id, Offline { location, refused: Some(stamp) });
                return;
            }
            // Checked again at the next sweep.
            Err(RootRefusal::Unobserved(error)) => {
                tracing::warn!(location = %id, %error, "new captures: root could not be checked; checked again at the next sweep");
                self.offline.insert(id, Offline { location, refused: None });
                return;
            }
        };
        self.offline.remove(&id);
        let mut prefixes = vec![root.clone()];
        prefixes.extend(canonical);
        self.locations.insert(
            id,
            Watched {
                location,
                root: root.clone(),
                prefixes,
                stamp,
                live: None,
                known: HashSet::new(),
                vacated: HashMap::new(),
                new: HashMap::new(),
                walk: None,
                unlisted: Vec::new(),
                rescan: false,
                recount: false,
                unreadable: false,
                listed: false,
                cataloged: false,
                released: false,
                moved: None,
            },
        );
        // Named before its watcher holds anything on the volume.
        self.publish_roots();
        let live = self.attach(&root, stamp).await;
        if let Some(watched) = self.locations.get_mut(&id) {
            watched.live = live;
        }
        self.walk(id);
    }

    /// Check on a blocking thread that `root` is `location`'s registered
    /// folder, and resolve its canonical path when that differs.
    ///
    /// On macOS a root whose canonical path cannot be resolved is not
    /// observed: `FSEvents` names its events by that path, so its watcher
    /// could not tell them, and the root is checked again at the next sweep
    /// rather than watched without them. Elsewhere events name the watched
    /// path itself and the canonical path is only a second prefix, while
    /// `canonicalize` fails for good on some Windows volume drivers (`ImDisk`,
    /// `OSFMount`; rust-lang/rust#79449): such a root is watched without it.
    /// A root that is not UTF-8, which is counted but not watched, is logged
    /// here once.
    async fn check_root(
        &self,
        location: &Location,
        root: &Path,
    ) -> Result<Option<PathBuf>, RootRefusal> {
        if root.to_str().is_none() {
            tracing::warn!(location = %location.id, root = %root.display(), "new captures: a non-UTF-8 root is counted, not watched; every sweep walks it again");
        }
        let probe = Arc::clone(&self.probe);
        let checked = location.clone();
        let resolved = root.to_path_buf();
        tokio::task::spawn_blocking(move || {
            probe.validate(&checked)?;
            let canonical = match probe.canonical(&resolved) {
                Ok(canonical) => canonical,
                Err(error) if cfg!(target_os = "macos") => {
                    return Err(RootRefusal::Unobserved(LibraryError::from_io(&resolved, &error)));
                }
                Err(_) => return Ok(None),
            };
            Ok((canonical != resolved).then_some(canonical))
        })
        .await
        .unwrap_or_else(|interrupted| {
            Err(RootRefusal::Unobserved(LibraryError::SourceUnavailable(interrupted.to_string())))
        })
    }

    /// Stop counting a location whose root went away, releasing its watch.
    fn go_offline(&mut self, id: Uuid) {
        if let Some(mut watched) = self.locations.remove(&id) {
            self.draining.let_go(&mut watched);
            tracing::info!(location = %id, "new captures: root went away; watch released");
            self.offline.insert(id, Offline { location: watched.location, refused: None });
        }
    }

    /// Apply what the desktop shell reported about a location's volume.
    async fn noticed(&mut self, notice: Notice) {
        match notice {
            Notice::Release { location, root, released } => {
                self.release(location, &root, released);
            }
            Notice::Reattach { location, root } => self.reattach(location, &root).await,
            Notice::Gone { location, root } => self.gone(location, &root).await,
        }
    }

    /// Release every handle discovery holds on the volume of `root`, a root
    /// of `id`: close the location's watcher and cancel its walk when it
    /// follows `root`, then send `released` once every watcher discovery
    /// closed and walk it canceled on that volume returned, whichever
    /// location it served. The volume is the one in the root's folder ID; a
    /// root with none waits only for what ran on it. Discovery's other
    /// file-system calls are awaited where they are made, so none is in
    /// flight here.
    fn release(&mut self, id: Uuid, root: &Path, released: oneshot::Sender<()>) {
        let mut folder = None;
        if let Some(watched) = self.locations.get_mut(&id).filter(|watched| watched.root == root) {
            tracing::info!(location = %id, "new captures: volume to be removed; watch released");
            watched.released = true;
            watched.rescan = false;
            folder = watched.stamp.folder();
            self.draining.let_go(watched);
        }
        let at_root = |named: &WatchedRoot| named.location_id == id && named.root == root;
        let volume = folder
            .or_else(|| self.draining.roots().find(|&named| at_root(named))?.folder)
            .map(|folder| folder.volume);
        let in_flight = self.draining.on(|named| match volume {
            Some(volume) => named.folder.is_some_and(|folder| folder.volume == volume),
            None => at_root(named),
        });
        tokio::spawn(async move {
            for call in in_flight {
                call.wait().await;
            }
            let _ = released.send(());
        });
    }

    /// The removal a release made way for did not happen: watch the location
    /// again and walk it, at the root it moved to meanwhile if it did.
    async fn reattach(&mut self, id: Uuid, root: &Path) {
        let Some(watched) =
            self.locations.get_mut(&id).filter(|watched| watched.released && watched.root == root)
        else {
            return;
        };
        watched.released = false;
        if watched.moved.is_some() {
            tracing::info!(location = %id, "new captures: volume stays; the location's new root is watched");
            self.move_on(id).await;
            return;
        }
        tracing::info!(location = %id, "new captures: volume stays; watched again");
        self.rescan(id).await;
    }

    /// The volume holding `root`, a root of `id`, was removed: the location
    /// goes offline, or starts at the root it moved to meanwhile.
    async fn gone(&mut self, id: Uuid, root: &Path) {
        let Some(watched) = self.locations.get(&id).filter(|watched| watched.root == root) else {
            return;
        };
        if watched.moved.is_some() {
            self.move_on(id).await;
        } else {
            self.go_offline(id);
        }
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

    /// Watch every real folder below `root`, whose stamp is `stamp`, on its
    /// volume.
    async fn attach(&self, root: &Path, stamp: RootStamp) -> Option<Live> {
        // Logged once as the location starts; every sweep walks it instead.
        let Ok(watched) = Utf8PathBuf::from_path_buf(root.to_path_buf()) else {
            return None;
        };
        let capacity = self.settings.capacity;
        let probe = Arc::clone(&self.probe);
        let started = tokio::task::spawn_blocking(move || {
            let TreeWatch { events, guard, folders, refused } = probe.watch(&watched, capacity)?;
            let relative =
                |folder: &PathBuf| folder.strip_prefix(&watched).ok().map(Path::to_path_buf);
            let folders = folders.iter().filter_map(relative).collect();
            // The walk skips a folder it cannot list, as a scan does, so the
            // watcher misses nothing the count holds there. Whether it opens
            // is checked without following links: a refused folder swapped
            // for one is no folder of the tree, and no walk lists it.
            let unlisted: Vec<PathBuf> = refused
                .iter()
                .filter_map(relative)
                .filter(|folder| !inventory::opens(watched.as_std_path(), stamp, folder))
                .collect();
            let complete = unlisted.len() == refused.len();
            Ok((events, guard, folders, complete, unlisted))
        })
        .await
        .unwrap_or_else(|interrupted| Err(interrupted.to_string()));
        let (events, guard, folders, complete, unlisted) = started
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
            unlisted,
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
        let (returns, call) = Call::start();
        watched.walk = Some(Walk {
            id: walk,
            canceled: Arc::clone(&canceled),
            touched: HashSet::new(),
            listing: call,
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
            let known = library.catalog().location_recorded_paths(id).await;
            let listing = blocking(move || {
                // Dropped once the listing returned, which `Walk::listing`
                // sees.
                let _returns = returns;
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
            // `recheck` checks the root before any path below it; one that
            // only an event about the root named is checked here.
            if !touched.is_empty() {
                self.recheck(id, touched).await;
            } else if root_touched && !self.unchanged(id).await {
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
    /// read on a blocking thread once the root was checked there: a root that
    /// is no longer the folder its watch started on (replaced by a link, say)
    /// takes the location offline, and no path below it is read. Checks that
    /// were interrupted, and paths that could not be observed
    /// ([`Entry::Unobserved`]), are redone by a walk, as events the OS lost
    /// are.
    ///
    /// A frame at the path of a Missing or Trashed record is read for its
    /// size and time as well ([`Watched::holds`]); one at a path whose file
    /// the catalog holds is held as it is.
    async fn recheck(&mut self, id: Uuid, touched: HashSet<PathBuf>) {
        if touched.is_empty() {
            return;
        }
        let Some(watched) = self.locations.get(&id) else {
            return;
        };
        let vacated: HashSet<PathBuf> =
            touched.iter().filter(|relative| watched.vacated_at(relative)).cloned().collect();
        let (root, stamp) = (watched.root.clone(), watched.stamp);
        let probe = Arc::clone(&self.probe);
        let found = tokio::task::spawn_blocking(move || {
            (probe.stamp(&root) == Some(stamp)).then(|| {
                touched
                    .into_iter()
                    .map(|relative| {
                        let entry = probe.entry(&root, stamp, &relative);
                        let file = if entry == Entry::Frame && vacated.contains(&relative) {
                            inventory::frame_file(&root, stamp, &relative)
                        } else {
                            None
                        };
                        (relative, entry, file)
                    })
                    .collect::<Vec<Found>>()
            })
        })
        .await;
        let found = match found {
            Ok(Some(found)) => found,
            Ok(None) => {
                self.go_offline(id);
                return;
            }
            Err(_) => {
                if let Some(watched) = self.locations.get_mut(&id) {
                    watched.rescan = true;
                }
                return;
            }
        };
        if let Some(watched) = self.locations.get_mut(&id) {
            watched.recheck_all(&found);
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
        // The old OS watch closes, off the runtime, as the new folder set
        // registers. The count is not live from here on, and says so before
        // the new watcher starts, which can take long on a slow tree.
        self.draining.let_go(watched);
        self.publish();
        let Some((root, stamp)) =
            self.locations.get(&id).map(|watched| (watched.root.clone(), watched.stamp))
        else {
            return;
        };
        let live = self.attach(&root, stamp).await;
        if let Some(watched) = self.locations.get_mut(&id) {
            watched.live = live;
        }
        self.walk(id);
    }

    /// The catalog changed in `id` outside discovery (a scan ended, or
    /// frames were recorded Trashed there): its paths are read again once no
    /// walk is in flight, at the next debounce tick at the latest, so what a
    /// scan indexed leaves the count. Changes that arrive between two ticks,
    /// such as a trash run of many frames, are read once.
    fn indexed(&mut self, id: Uuid) {
        if let Some(watched) = self.locations.get_mut(&id) {
            watched.recount = true;
        }
    }

    /// Read the catalog's paths in `id` again; while the catalog cannot be
    /// read, every debounce tick tries again. Each path whose file the
    /// catalog held when last read and whose record left it since (recorded
    /// Missing by a scan, or Trashed) is looked up again, unless its volume
    /// is being removed: a frame there was judged held, as the frame written
    /// in place of a trashed one before the trash was recorded was.
    async fn recount(&mut self, id: Uuid) {
        #[cfg(test)]
        self.observed.recounts.fetch_add(1, Ordering::SeqCst);
        let read = self.library.catalog().location_recorded_paths(id).await;
        let Some(watched) = self.locations.get_mut(&id) else {
            return;
        };
        let left = match read {
            Ok(recorded) => {
                let left = watched.vacated_since(&recorded);
                watched.know(&recorded);
                watched.recount = false;
                left
            }
            Err(error) => {
                if !watched.unreadable {
                    tracing::warn!(location = %id, %error, "new captures: indexed paths unreadable; read again at the next tick");
                }
                watched.unreadable = true;
                watched.recount = true;
                return;
            }
        };
        if !watched.released {
            self.recheck(id, left).await;
        }
    }

    /// Catalog changes were missed (scan snapshots or trash announcements
    /// lagged): read every location's paths again.
    fn recount_all(&mut self) {
        for watched in self.locations.values_mut() {
            watched.recount = true;
        }
    }

    /// Publish the counts and the named roots, each only when it changed.
    fn publish(&mut self) {
        let mut counts: Vec<NewCaptureCount> = self
            .locations
            .values()
            .filter(|watched| watched.counted())
            .map(Watched::count)
            .collect();
        counts.sort_by_key(|count| count.location_id);
        self.publish.send_if_modified(|current| replace_changed(current, counts));
        self.publish_roots();
    }

    /// Publish, when they changed, the root of every followed location and
    /// every root a watcher discovery closed, or a walk it canceled, still
    /// runs on, once per location and path: a root a location follows again
    /// stands for its earlier calls there, and carries the folder ID of the
    /// folder at its path now. A call still in flight a sweep after
    /// discovery let go of it is logged once: one that never returns keeps
    /// its root named, and a release of its volume waiting, until discovery
    /// stops.
    fn publish_roots(&mut self) {
        self.draining.prune(self.settings.sweep, |call, stuck| {
            tracing::warn!(
                location = %stuck.root.location_id,
                root = %stuck.root.root.display(),
                call,
                waited = ?stuck.since.elapsed(),
                "new captures: still running after discovery let go of it; its root stays named, and a release of its volume waits for it"
            );
            #[cfg(test)]
            self.observed.stuck.fetch_add(1, Ordering::SeqCst);
        });
        // Followed roots come first, and the stable sort keeps them ahead of
        // the earlier calls' at their path, which `dedup_by` then drops.
        let mut roots: Vec<WatchedRoot> = self
            .locations
            .values()
            .map(Watched::named)
            .chain(self.draining.roots().cloned())
            .collect();
        roots.sort_by(|a, b| (a.location_id, &a.root).cmp(&(b.location_id, &b.root)));
        roots.dedup_by(|later, earlier| {
            later.location_id == earlier.location_id && later.root == earlier.root
        });
        self.publish_roots.send_if_modified(|current| replace_changed(current, roots));
    }
}

/// Replace `current` with `next` unless they are equal; whether it changed.
fn replace_changed<T: PartialEq>(current: &mut T, next: T) -> bool {
    if *current == next {
        false
    } else {
        *current = next;
        true
    }
}

#[cfg(test)]
mod tests;
