// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Output watcher (RES-FR-01, RES-FR-11, RES-AC-23): while the app runs,
//! every open Project with a processing location has its `Output/` and
//! `Processing/` followed.
//!
//! - A pass walks both folders, records `Output/` in the catalog, and hands
//!   each newly settled generated master of `Processing/` to CAL's once-only
//!   offer, keyed by digest. It reads no file in `Output/`; a possible master
//!   is read, and a master hashed, once per fingerprint.
//! - A pass runs when the folder watcher reports a change (the reused
//!   [`fs_inventory::artifact_watcher`], with its RAII guard, its rescan
//!   signal after an OS watcher error and its overflow flag for a full
//!   channel), while any file is still settling, on Rescan, and on every
//!   sweep. The first sweep runs at start, after every interrupted Copy to
//!   Output is finished, so files that arrived while the app was closed are
//!   found.
//! - The folder watcher watches the real folders that exist when it starts.
//!   A pass that finds the folders changed starts it again, and the sweep
//!   finds what was saved in a new folder in between, as it finds a path the
//!   folder watcher cannot name (one that is not UTF-8).
//! - A Project that is no longer open, or has no processing location, stops
//!   being watched. A pass that meets a running Copy to Output waits for it.
//!   [`OutputWatch::shutdown`], or dropping the [`OutputWatch`], stops every
//!   folder watcher.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fs_inventory::artifact_watcher::{
    start_artifact_watcher, ArtifactEventKind, ArtifactFileEvent, WatcherGuard,
};
use persistence_library::{OutputBasis, OutputFolder, OutputScan, OutputScanRecord, ScannedOutput};
use tokio::sync::mpsc::error::TryRecvError;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::{interval, MissedTickBehavior};
use uuid::Uuid;
use workflow_artifacts::watcher::DEFAULT_STABILITY_DEBOUNCE;

use super::{
    classify, header_readable, open_place, walk, walk_output, MasterCandidate, Place, Settler, Tree,
};
use crate::inventory::VolumeCache;
use crate::library::{blocking, Library};
use crate::{LibraryError, NativePath, ObservationFingerprint, OutputObservation, OutputState};

/// Passes a Rescan waits through while a Copy to Output runs.
const RESCAN_ATTEMPTS: usize = 40;

/// How the Output watcher paces itself.
#[derive(Clone, Copy, Debug)]
pub struct OutputWatchSettings {
    /// How long a file's fingerprint must hold before it reads Settled.
    pub window: Duration,
    /// How often reported changes and settling files are looked at.
    pub tick: Duration,
    /// How often every watched Project is walked, whatever was reported.
    pub sweep: Duration,
    /// Events the folder watcher queues before it raises its overflow flag.
    pub event_capacity: usize,
    /// How long shutdown waits for a pass in flight.
    pub shutdown_grace: Duration,
}

impl Default for OutputWatchSettings {
    fn default() -> Self {
        Self {
            window: DEFAULT_STABILITY_DEBOUNCE,
            tick: Duration::from_millis(500),
            sweep: Duration::from_secs(15),
            event_capacity: 1024,
            shutdown_grace: Duration::from_secs(2),
        }
    }
}

enum Command {
    Rescan(Uuid, oneshot::Sender<Result<Vec<OutputObservation>, LibraryError>>),
}

/// The running Output watcher of one library.
pub struct OutputWatch {
    commands: Mutex<Option<mpsc::UnboundedSender<Command>>>,
    task: Mutex<Option<JoinHandle<()>>>,
    grace: Duration,
}

fn stopped() -> LibraryError {
    LibraryError::InvalidInput("the Output watcher has stopped".into())
}

impl OutputWatch {
    /// Start watching with the default pacing.
    #[must_use]
    pub fn start(library: &Arc<Library>) -> Self {
        Self::start_with(library, OutputWatchSettings::default())
    }

    /// Start watching with `settings`.
    #[must_use]
    pub fn start_with(library: &Arc<Library>, settings: OutputWatchSettings) -> Self {
        let (commands, received) = mpsc::unbounded_channel();
        let run = Run { library: Arc::clone(library), settings, projects: HashMap::new() };
        let task = tokio::spawn(run.until_stopped(received));
        Self {
            commands: Mutex::new(Some(commands)),
            task: Mutex::new(Some(task)),
            grace: settings.shutdown_grace,
        }
    }

    /// Rescan, in the Output step's More menu: walk the Project now and
    /// return its Output step as recorded.
    ///
    /// # Errors
    /// `InvalidInput` for a Project that is not open or has no processing
    /// location, or once the watcher stopped; `NotFound` for an unknown
    /// Project; catalog errors.
    pub async fn rescan(&self, project_id: Uuid) -> Result<Vec<OutputObservation>, LibraryError> {
        let (reply, answer) = oneshot::channel();
        let sent = self
            .commands
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .is_some_and(|commands| commands.send(Command::Rescan(project_id, reply)).is_ok());
        if !sent {
            return Err(stopped());
        }
        answer.await.map_err(|_| stopped())?
    }

    /// Stop every folder watcher, waiting at most the shutdown grace for a
    /// pass in flight.
    pub async fn shutdown(&self) {
        drop(self.commands.lock().unwrap_or_else(PoisonError::into_inner).take());
        let task = self.task.lock().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(mut task) = task {
            if tokio::time::timeout(self.grace, &mut task).await.is_err() {
                task.abort();
            }
        }
    }
}

impl Drop for OutputWatch {
    fn drop(&mut self) {
        drop(self.commands.lock().unwrap_or_else(PoisonError::into_inner).take());
        if let Some(task) = self.task.lock().unwrap_or_else(PoisonError::into_inner).take() {
            task.abort();
        }
    }
}

struct Run {
    library: Arc<Library>,
    settings: OutputWatchSettings,
    projects: HashMap<Uuid, Watched>,
}

impl Run {
    async fn until_stopped(mut self, mut commands: mpsc::UnboundedReceiver<Command>) {
        if let Err(error) = self.library.resume_output_copies().await {
            tracing::warn!(%error, "Output watcher: interrupted copies were not finished");
        }
        let mut ticks = interval(self.settings.tick);
        ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut next_sweep = Instant::now();
        loop {
            tokio::select! {
                command = commands.recv() => match command {
                    Some(Command::Rescan(project_id, reply)) => {
                        let _ = reply.send(self.rescan(project_id).await);
                    }
                    None => break,
                },
                _ = ticks.tick() => {
                    if Instant::now() >= next_sweep {
                        self.sweep().await;
                        next_sweep = Instant::now() + self.settings.sweep;
                    }
                    self.pass_due().await;
                }
            }
        }
        let projects = std::mem::take(&mut self.projects);
        let _ = blocking(move || {
            drop(projects);
            Ok(())
        })
        .await;
    }

    /// Follow every open Project with a processing location, drop the rest,
    /// and walk each.
    async fn sweep(&mut self) {
        let ids = match self.library.catalog().output_projects().await {
            Ok(ids) => ids,
            Err(error) => {
                tracing::warn!(%error, "Output watcher: the Projects could not be read");
                return;
            }
        };
        let listed: BTreeSet<Uuid> = ids.iter().copied().collect();
        let gone: Vec<Uuid> =
            self.projects.keys().filter(|id| !listed.contains(id)).copied().collect();
        for id in gone {
            if let Some(watched) = self.projects.remove(&id) {
                release(watched).await;
            }
        }
        for id in ids {
            self.projects.entry(id).or_default().dirty = true;
        }
    }

    async fn pass_due(&mut self) {
        let due: Vec<Uuid> = self
            .projects
            .iter_mut()
            .filter_map(|(id, watched)| watched.due().then_some(*id))
            .collect();
        for project_id in due {
            if let Err(error) = self.pass(project_id).await {
                tracing::warn!(%error, %project_id, "Output watcher: pass failed");
            }
        }
    }

    async fn rescan(&mut self, project_id: Uuid) -> Result<Vec<OutputObservation>, LibraryError> {
        open_place(&self.library, project_id).await?;
        self.projects.entry(project_id).or_default();
        for _ in 0..RESCAN_ATTEMPTS {
            if let Some(listing) = self.pass(project_id).await? {
                return Ok(listing);
            }
            tokio::time::sleep(self.settings.tick).await;
        }
        self.library.catalog().project_outputs(project_id).await
    }

    /// One pass over `project_id`: the Output step as recorded, or `None`
    /// when the pass waits for a copy or the Project left.
    async fn pass(
        &mut self,
        project_id: Uuid,
    ) -> Result<Option<Vec<OutputObservation>>, LibraryError> {
        let Some(mut watched) = self.projects.remove(&project_id) else {
            return Ok(None);
        };
        match watched.pass(&self.library, project_id, &self.settings).await {
            Ok(Pass::Gone) => {
                release(watched).await;
                Ok(None)
            }
            Ok(Pass::Waiting) => {
                self.projects.insert(project_id, watched);
                Ok(None)
            }
            Ok(Pass::Recorded(listing)) => {
                self.projects.insert(project_id, watched);
                Ok(Some(listing))
            }
            Err(error) => {
                // The next sweep walks it again.
                watched.dirty = false;
                self.projects.insert(project_id, watched);
                Err(error)
            }
        }
    }
}

/// Stop a Project's folder watcher off the runtime's workers: stopping one
/// can wait on the file system.
async fn release(watched: Watched) {
    let _ = blocking(move || {
        drop(watched);
        Ok(())
    })
    .await;
}

/// A started folder watcher and the real folders that existed before it
/// started.
struct Armed {
    _guard: WatcherGuard,
    overflow: Arc<std::sync::atomic::AtomicBool>,
    events: mpsc::Receiver<ArtifactFileEvent>,
    folders: BTreeSet<PathBuf>,
}

enum Pass {
    Recorded(Vec<OutputObservation>),
    /// A Copy to Output runs, or one started since the pass read its basis.
    Waiting,
    /// No longer open, or no processing location.
    Gone,
}

/// One followed Project.
#[derive(Default)]
struct Watched {
    /// Something changed since the last pass.
    dirty: bool,
    /// A file was still settling at the last pass.
    settling: bool,
    /// The folder watcher reported an error: start it again.
    rearm: bool,
    output: Settler,
    processing: Settler,
    /// Each `Processing/` file already read for a master, at its fingerprint.
    classified: HashMap<PathBuf, ObservationFingerprint>,
    armed: Option<Armed>,
}

impl Watched {
    /// Take the folder watcher's reports; whether a pass is due.
    fn due(&mut self) -> bool {
        if let Some(armed) = &mut self.armed {
            if armed.overflow.swap(false, Ordering::AcqRel) {
                self.dirty = true;
            }
            loop {
                match armed.events.try_recv() {
                    Ok(event) => {
                        self.dirty = true;
                        if event.kind == ArtifactEventKind::NeedsRescan {
                            self.rearm = true;
                        }
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        self.dirty = true;
                        self.rearm = true;
                        break;
                    }
                }
            }
        }
        self.dirty || self.settling
    }

    async fn pass(
        &mut self,
        library: &Library,
        project_id: Uuid,
        settings: &OutputWatchSettings,
    ) -> Result<Pass, LibraryError> {
        let basis = library.catalog().output_basis(project_id).await?;
        if !basis.lifecycle.is_open() {
            return Ok(Pass::Gone);
        }
        let Some(place) = Place::of(&basis)? else {
            return Ok(Pass::Gone);
        };
        if basis.copying {
            self.dirty = true;
            return Ok(Pass::Waiting);
        }
        let walked_place = place.clone();
        let (output, processing) = blocking(move || {
            let volumes = VolumeCache::default();
            let output = walk_output(&walked_place, &volumes);
            Ok((output, walk(&walked_place.processing(), &volumes)))
        })
        .await?;
        let now = Instant::now();
        let (folder, output_settling) = self.scanned(&basis, &place, &output, now, settings.window);
        let scan = OutputScan { project_id, copies: basis.copies, folder };
        let listing = match library.catalog().record_output_scan(&scan).await? {
            OutputScanRecord::Recorded(listing) => listing,
            OutputScanRecord::Stale => {
                self.dirty = true;
                return Ok(Pass::Waiting);
            }
        };
        self.dirty = false;
        let (candidates, masters_settling) =
            self.master_candidates(&place, &processing, now, settings.window);
        self.offer(library, project_id, candidates).await?;
        self.settling = output_settling || masters_settling;

        let mut folders = BTreeSet::new();
        for tree in [&output, &processing] {
            if let Tree::Walked(walked) = tree {
                folders.extend(walked.folders.iter().cloned());
            }
        }
        let roots: Vec<PathBuf> = [place.output(), place.processing()]
            .into_iter()
            .filter(|root| folders.contains(root))
            .collect();
        if self.rearm || self.armed.as_ref().map(|armed| &armed.folders) != Some(&folders) {
            self.arm(roots, folders, settings.event_capacity).await;
        }
        Ok(Pass::Recorded(listing))
    }

    /// `Output/` as the pass recorded it, and whether a file still settles.
    fn scanned(
        &mut self,
        basis: &OutputBasis,
        place: &Place,
        output: &Tree,
        now: Instant,
        window: Duration,
    ) -> (OutputFolder, bool) {
        let walked = match output {
            Tree::Walked(walked) => walked,
            Tree::Absent => {
                self.output.keep(&[]);
                return (OutputFolder::Absent, false);
            }
            Tree::Unreadable => return (OutputFolder::Unreadable, false),
        };
        let root = place.output();
        let mut settling = false;
        let mut files = Vec::with_capacity(walked.files.len());
        for found in &walked.files {
            let Ok(relative) = found.path.strip_prefix(&root) else {
                continue;
            };
            let path = NativePath::from_path(relative);
            let recorded_settled = found.fingerprint.is_some()
                && basis.recorded.iter().any(|recorded| {
                    recorded.path == path
                        && recorded.state == OutputState::Settled
                        && recorded.fingerprint == found.fingerprint
                });
            let state = self.output.state(found, recorded_settled, now, window);
            settling |= state == OutputState::Settling;
            files.push(ScannedOutput {
                path,
                panel_group_id: place.panel_of(relative),
                state,
                size_bytes: found.size_bytes,
                fingerprint: found.fingerprint.clone(),
            });
        }
        self.output.keep(&walked.files);
        let unreadable = walked
            .unreadable
            .iter()
            .filter_map(|path| path.strip_prefix(&root).ok())
            .map(NativePath::from_path)
            .collect();
        (OutputFolder::Walked { files, unreadable }, settling)
    }

    /// The settled `Processing/` files not yet read at their fingerprint,
    /// and whether one still settles.
    fn master_candidates(
        &mut self,
        place: &Place,
        processing: &Tree,
        now: Instant,
        window: Duration,
    ) -> (Vec<MasterCandidate>, bool) {
        let Tree::Walked(walked) = processing else {
            self.processing.keep(&[]);
            self.classified.clear();
            return (Vec::new(), false);
        };
        let root = place.processing();
        let mut settling = false;
        let mut candidates = Vec::new();
        for found in walked.files.iter().filter(|found| header_readable(&found.path)) {
            if self.processing.state(found, false, now, window) == OutputState::Settling {
                settling = true;
                continue;
            }
            let (Some(fingerprint), Ok(relative)) =
                (&found.fingerprint, found.path.strip_prefix(&root))
            else {
                continue;
            };
            if self.classified.get(&found.path) != Some(fingerprint) {
                candidates.push(MasterCandidate {
                    path: found.path.clone(),
                    relative: relative.to_path_buf(),
                    fingerprint: fingerprint.clone(),
                });
            }
        }
        self.processing.keep(&walked.files);
        let present: BTreeSet<&PathBuf> = walked.files.iter().map(|found| &found.path).collect();
        self.classified.retain(|path, _| present.contains(path));
        (candidates, settling)
    }

    /// Read each candidate and hand each master to CAL's once-only offer.
    async fn offer(
        &mut self,
        library: &Library,
        project_id: Uuid,
        candidates: Vec<MasterCandidate>,
    ) -> Result<(), LibraryError> {
        if candidates.is_empty() {
            return Ok(());
        }
        for read in blocking(move || Ok(classify(candidates))).await? {
            if let Some((classification, sha256)) = &read.master {
                let path = NativePath::from_path(&read.candidate.relative);
                library
                    .catalog()
                    .offer_processing_master(project_id, &path, sha256, classification)
                    .await?;
            }
            self.classified.insert(read.candidate.path, read.candidate.fingerprint);
        }
        Ok(())
    }

    /// Start the folder watcher over `roots` again, never following a link;
    /// a watcher that cannot start is retried by the next pass.
    async fn arm(&mut self, roots: Vec<PathBuf>, folders: BTreeSet<PathBuf>, capacity: usize) {
        let previous = self.armed.take();
        self.rearm = false;
        let paths: Option<Vec<Utf8PathBuf>> =
            roots.into_iter().map(|root| Utf8PathBuf::from_path_buf(root).ok()).collect();
        let started = blocking(move || {
            drop(previous);
            let Some(paths) = paths.filter(|paths| !paths.is_empty()) else {
                return Ok(None);
            };
            Ok(start_artifact_watcher(&paths, capacity, false)
                .map_err(|error| tracing::warn!(%error, "Output watcher: folders not watched"))
                .ok())
        })
        .await;
        if let Ok(Some((events, guard))) = started {
            let overflow = Arc::clone(&guard.overflow_flag);
            self.armed = Some(Armed { _guard: guard, overflow, events, folders });
        }
    }
}
