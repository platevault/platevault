// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Artifact filesystem watcher service (spec 012, FR-009, spec 033 T028).
//!
//! Watches registered library-root paths for new or modified files.  Uses
//! `notify 8` and forwards every raw Create/Modify/Remove event downstream,
//! undebounced, via a `tokio::sync::mpsc` channel.
//!
//! ## Debounce strategy (deviation from D10)
//!
//! D10 specified `notify-debouncer-full 0.7.x`.  `notify-debouncer-full` is
//! now a direct dep alongside `notify 8`, satisfying that design intent.
//! However, wiring the debouncer into the event pipeline touches the same
//! watcher files being refactored on branch `fix/watcher-robustness-cluster`
//! (bead kyo7.74); to avoid a merge conflict, debouncer adoption is deferred
//! to that branch.  This crate therefore stays a thin raw-event source for
//! now.  The stable-size debounce (default 2s, spec 012 edge case) is pure
//! logic in `workflow_artifacts::watcher::check_stability`/`FileSnapshot`,
//! applied by the consumer (`apps/desktop/src-tauri/src/watcher.rs`'s
//! per-project forward task) against a `HashMap<PathBuf, FileSnapshot>` it
//! owns.
//!
//! [`start_tree_watcher`] is the same event source for a tree whose new
//! folders must be watched too (the library's Captures locations): it never
//! follows links and reports a folder that appears below a watched path,
//! whose permissions or owner change, or that is reported removed while a
//! folder is still at its path (a nested volume unmounted from it), as
//! `NeedsRescan`. Both report an OS watcher error, an OS lost-events notice
//! and a full channel (through the overflow flag) for a rescan.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use camino::Utf8PathBuf;
use notify::event::{MetadataKind, ModifyKind};
use notify::{Event, EventKind, RecommendedWatcher};
use tokio::sync::mpsc;

use crate::notify_bridge::{SimpleEventKind, WatchRegistrationReport};

/// A filesystem event forwarded to the async consumer.
#[derive(Clone, Debug)]
pub struct ArtifactFileEvent {
    /// Absolute path of the file that changed (guaranteed UTF-8).
    pub path: Utf8PathBuf,
    /// The underlying event kind (Create / Modify / Remove / error signals).
    pub kind: ArtifactEventKind,
}

/// Simplified event kind for artifact detection purposes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArtifactEventKind {
    Created,
    Modified,
    Removed,
    /// The OS watcher encountered an error — consumer should trigger a reconcile
    /// pass to recover any missed events (item a: error-callback deafness fix).
    NeedsRescan,
}

impl From<SimpleEventKind> for ArtifactEventKind {
    fn from(kind: SimpleEventKind) -> Self {
        match kind {
            SimpleEventKind::Created => Self::Created,
            SimpleEventKind::Modified => Self::Modified,
            SimpleEventKind::Removed => Self::Removed,
        }
    }
}

/// RAII guard that keeps the watcher alive.
///
/// Drop this to stop watching and close the channel, or [`close`] it to also
/// wait until the OS released the watched folders.
///
/// `overflow_flag` is set to `true` by the notify callback whenever the mpsc
/// channel is full and at least one event was dropped. The forward task polls
/// this flag instead of relying on an in-band sentinel event — an
/// `AtomicBool::store` cannot itself be lost the way a `try_send` can.
///
/// [`close`]: Self::close
pub struct WatcherGuard {
    #[cfg_attr(
        not(windows),
        expect(dead_code, reason = "held for its drop; Windows' close uses it")
    )]
    watcher: RecommendedWatcher,
    _tx: Arc<mpsc::Sender<ArtifactFileEvent>>,
    /// Set to `true` when the channel overflowed; cleared by the consumer
    /// after it triggers reconciliation.
    pub overflow_flag: Arc<AtomicBool>,
    /// The folders registered with the OS.
    #[cfg(windows)]
    watched: Vec<PathBuf>,
}

impl WatcherGuard {
    /// Stop watching and return once the OS released every folder handle the
    /// watcher held, so their volume can be ejected. It waits on the watcher's
    /// own thread, which may wait on the file system: call it where blocking
    /// is allowed.
    ///
    /// On Windows, dropping the watcher only asks its thread to close the
    /// folder handles, one after another, later. Here each folder is
    /// unwatched first, and a configuration request, which that thread
    /// answers only after the unwatches queued before it, waits them out.
    /// Elsewhere this is the drop: `FSEvents` and inotify hold no handle that
    /// keeps a volume from being ejected.
    pub fn close(self) {
        #[cfg(windows)]
        close_folders(self);
        #[cfg(not(windows))]
        drop(self);
    }
}

/// [`WatcherGuard::close`] on Windows.
#[cfg(windows)]
fn close_folders(mut guard: WatcherGuard) {
    use notify::Watcher as _;
    for folder in &guard.watched {
        let _ = guard.watcher.unwatch(folder);
    }
    // Answered in order, once every unwatch above closed its handle.
    let _ = guard.watcher.configure(notify::Config::default());
}

/// Start the filesystem watcher over `paths`.
///
/// `follow_symlinks` gates traversal (constitution "MUST NOT follow symlinks
/// or junctions unless explicitly enabled per root", duplication-and-
/// abstraction audit T1-a): when `false`, each path is walked ourselves via
/// [`fs_pathsafe::real_dirs_under`] and every real (non-link) subdirectory is
/// watched individually with `RecursiveMode::NonRecursive`, mirroring
/// [`crate::watcher::WatcherService::start`]. When `true`, a single
/// `RecursiveMode::Recursive` watch per path is used (the OS watcher may then
/// follow links under it).
///
/// The paths register through [`register_watch_paths`], as the tree watcher
/// (astro-plan-ef440) made it: every path in one batch, a listing that
/// leaves out a folder swapped for a link or junction while it lists, and an
/// error for a path that probes as a real folder yet lists no folders.
///
/// Returns an `mpsc::Receiver` and a `WatcherGuard`.  Drop the guard to stop.
///
/// # Errors
///
/// Returns an error string if the platform watcher cannot be initialised, a
/// path cannot be watched, or a path lists no folders once it probed fine.
///
/// [`register_watch_paths`]: crate::notify_bridge::register_watch_paths
pub fn start_artifact_watcher(
    paths: &[Utf8PathBuf],
    channel_capacity: usize,
    follow_symlinks: bool,
) -> Result<(mpsc::Receiver<ArtifactFileEvent>, WatcherGuard), String> {
    start(paths, channel_capacity, follow_symlinks, NewFolders::Skip)
        .map(|(events, guard, _)| (events, guard))
}

/// A watcher [`start_tree_watcher`] started.
pub struct TreeWatch {
    pub events: mpsc::Receiver<ArtifactFileEvent>,
    /// Drop it to stop watching, or close it to wait for the OS as well.
    pub guard: WatcherGuard,
    /// Every real folder found below the watched paths as the watcher
    /// started, watched or not. A folder created after its parent was listed
    /// is missing, and nothing reports it: a walk that starts once the watcher
    /// started finds it, and the consumer then restarts the watcher.
    ///
    /// A watched folder that is removed or renamed away, out of the watched
    /// paths as well, is reported as its path only, since nothing is at that
    /// path any more and no event says it was a folder (inotify and Windows
    /// name a rename's old path without its kind). The consumer tells it from
    /// a file by this list and restarts the watcher: `ReadDirectoryChangesW`
    /// watches the folder itself, so its handle would follow it outside the
    /// watched paths, and this list would name a folder that is gone. (notify
    /// drops an inotify watch, with those below it, when the parent's watch
    /// reports the move.)
    pub folders: Vec<PathBuf>,
    /// The folders of `folders` the OS refused to watch: no event arrives
    /// from them.
    pub refused: Vec<PathBuf>,
}

/// Start a watcher over every real folder below `paths` on their own volume,
/// never following a link or junction or entering a volume mounted inside,
/// that also covers folders appearing later.
///
/// Each real folder is watched on its own (as [`start_artifact_watcher`] with
/// `follow_symlinks` off), so a folder created or moved in below `paths` is
/// not watched yet: it is reported as [`ArtifactEventKind::NeedsRescan`], and
/// the consumer restarts the watcher over the new folder set and walks the
/// tree for the files the new folder already holds. So is a change of a
/// folder's permissions or owner (on Windows, a change of a folder that no
/// longer opens), which can change what a walk lists below it while no
/// event names the files there, a removal of a path a folder is still at
/// (another folder took its place, or a nested volume was unmounted from
/// it), and an event about a path that is not UTF-8, which cannot be
/// forwarded. A link or junction at a
/// path an event names is reported as that path, never followed, so a watched
/// folder that a link replaced reaches the consumer like one that went away.
/// The folders are listed before they are registered, in one batch; one
/// created in between is missing from [`TreeWatch::folders`].
///
/// # Errors
///
/// As [`start_artifact_watcher`].
pub fn start_tree_watcher(
    paths: &[Utf8PathBuf],
    channel_capacity: usize,
) -> Result<TreeWatch, String> {
    let (events, guard, report) = start(paths, channel_capacity, false, NewFolders::Rescan)?;
    let refused: Vec<PathBuf> = report.skipped.into_iter().map(|(folder, _)| folder).collect();
    let mut folders = report.watched;
    folders.extend(refused.iter().cloned());
    Ok(TreeWatch { events, guard, folders, refused })
}

/// What a folder created or moved in below a watched path signals, and how
/// far the watched folders reach.
#[derive(Clone, Copy)]
enum NewFolders {
    /// Nothing: folder events are not forwarded. Every real folder is
    /// watched, on any volume.
    Skip,
    /// [`ArtifactEventKind::NeedsRescan`], because the folder is not watched;
    /// so does a change of a folder's access, or a removal of a path a
    /// folder is still at ([`folder_rescans`]), and an event about a path
    /// that is not UTF-8. A link or junction
    /// is forwarded as its own path. Only the folders on each path's own
    /// volume are watched.
    Rescan,
}

/// Whether `kind` brings a folder into the watched tree: created there, or
/// renamed to (or, where the platform cannot pair renames, from) its name.
const fn brings_folder(kind: EventKind) -> bool {
    matches!(kind, EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_)))
}

/// Whether `kind` may change who can list a folder: its permissions, owner
/// or access list changed. A timestamp or extended-attribute change named as
/// such (`WriteTime`, `AccessTime`, `Extended`) does not. notify reports a
/// permission change and a folder's new times (`utimes`) alike as
/// `Metadata(Any)`: every inotify `IN_ATTRIB`, and every `FSEvents`
/// inode-metadata change, maps to it. So such a change rescans too, since
/// telling the two apart would mean recording each folder's mode and owner
/// to compare against: a copy tool that sets a folder's times costs a rescan
/// of its location, in exchange for never missing an access change. Windows
/// reports no metadata kind: see [`folder_rescans`].
const fn changes_access(kind: EventKind) -> bool {
    matches!(
        kind,
        EventKind::Modify(ModifyKind::Metadata(
            MetadataKind::Any | MetadataKind::Permissions | MetadataKind::Ownership
        ))
    )
}

/// Whether an event of `kind` naming `folder` asks a tree watcher for a
/// rescan: the folder was brought into the tree, who can list it may have
/// changed, or it was reported removed yet a folder is still there.
///
/// Windows reports a folder's access list change only as `Modify(Any)`,
/// which it also reports for every entry written in the folder, so such an
/// event rescans only once the folder no longer opens. One that opens again
/// is found by the sweep that lists the walk's unlisted folders again.
///
/// A removal of a path that still holds a folder means another folder took
/// its place: one recreated there, or, on macOS, the folder below a nested
/// volume that was unmounted, which `FSEvents` reports as a removal of the
/// mount point. The nested volume was never watched, so nothing watches the
/// folder now exposed, and only a rescan brings it and its frames in.
fn folder_rescans(folder: &std::path::Path, kind: EventKind) -> bool {
    brings_folder(kind)
        || changes_access(kind)
        || matches!(kind, EventKind::Remove(_))
        || (matches!(kind, EventKind::Modify(ModifyKind::Any))
            && std::fs::read_dir(folder).is_err())
}

fn needs_rescan() -> ArtifactFileEvent {
    ArtifactFileEvent { path: Utf8PathBuf::new(), kind: ArtifactEventKind::NeedsRescan }
}

/// Hand what one `notify` callback reports to `send`, which returns whether
/// the channel took it; the rest of a batch is dropped once it did not.
///
/// Item (a): an OS watcher error, and an event carrying `notify`'s rescan
/// flag (an OS queue overflow or dropped-events notice, e.g. inotify
/// `IN_Q_OVERFLOW` or `FSEvents` `MustScanSubDirs`), become `NeedsRescan`:
/// the events received so far can no longer be relied on.
fn forward(
    res: Result<Event, notify::Error>,
    new_folders: NewFolders,
    mut send: impl FnMut(ArtifactFileEvent) -> bool,
) {
    let event = match res {
        Err(e) => {
            tracing::error!(error = %e, "artifact watcher error");
            send(needs_rescan());
            return;
        }
        Ok(event) if event.need_rescan() => {
            tracing::warn!("artifact watcher: the OS reported lost events");
            send(needs_rescan());
            return;
        }
        Ok(event) => event,
    };
    let Some(simple_kind) = crate::notify_bridge::classify(event.kind) else {
        return;
    };
    let kind = ArtifactEventKind::from(simple_kind);
    for path in &event.paths {
        if !forward_path(path, kind, event.kind, new_folders, &mut send) {
            return;
        }
    }
}

/// Hand `send` what one path of an event of `event_kind` signals; `false`
/// once the channel did not take it.
fn forward_path(
    path: &std::path::Path,
    kind: ArtifactEventKind,
    event_kind: EventKind,
    new_folders: NewFolders,
    send: &mut impl FnMut(ArtifactFileEvent) -> bool,
) -> bool {
    let rescans = matches!(new_folders, NewFolders::Rescan);
    let Some(utf8) =
        crate::notify_bridge::utf8_path_or_skip(path, "fs_inventory::artifact_watcher")
    else {
        // The consumer counts such a path through its own walk, which finds
        // what changed there.
        return !rescans || send(needs_rescan());
    };
    // A link is never followed: in a tree its own path is reported, so the
    // consumer drops what it counted below a folder the link replaced.
    if rescans && fs_pathsafe::is_link_or_junction(path) {
        return send(ArtifactFileEvent { path: utf8, kind });
    }
    if utf8.is_dir() {
        return !(rescans && folder_rescans(path, event_kind)) || send(needs_rescan());
    }
    send(ArtifactFileEvent { path: utf8, kind })
}

fn start(
    paths: &[Utf8PathBuf],
    channel_capacity: usize,
    follow_symlinks: bool,
    new_folders: NewFolders,
) -> Result<(mpsc::Receiver<ArtifactFileEvent>, WatcherGuard, WatchRegistrationReport), String> {
    let (tx, rx) = mpsc::channel::<ArtifactFileEvent>(channel_capacity);
    let tx = Arc::new(tx);
    let handler_tx = Arc::clone(&tx);
    // Item (c): atomic flag set on overflow — cannot itself be dropped the
    // way an in-band try_send sentinel can. The forward task polls and clears
    // it on each loop iteration.
    let overflow_flag = Arc::new(AtomicBool::new(false));
    let callback_overflow = Arc::clone(&overflow_flag);

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        forward(res, new_folders, |event| match handler_tx.try_send(event) {
            // Store beats try_send: an AtomicBool::store cannot be dropped
            // if the channel is full.
            Err(mpsc::error::TrySendError::Full(_)) => {
                tracing::warn!("artifact watcher: channel full, events dropped");
                callback_overflow.store(true, Ordering::Release);
                false
            }
            Ok(()) | Err(mpsc::error::TrySendError::Closed(_)) => true,
        });
    })
    .map_err(|e| format!("failed to create artifact watcher: {e}"))?;

    // Item (d): partial start tolerance — per-subdirectory failures are
    // collected rather than aborting the entire watcher start.
    let report = match new_folders {
        NewFolders::Skip => {
            crate::notify_bridge::register_watch_paths(&mut watcher, paths, follow_symlinks, false)?
        }
        NewFolders::Rescan => crate::notify_bridge::register_tree_paths(&mut watcher, paths)?,
    };
    if !report.skipped.is_empty() {
        tracing::warn!(
            "artifact watcher: {} subdirectories could not be watched (partial start)",
            report.skipped.len()
        );
    }

    let guard = WatcherGuard {
        #[cfg(windows)]
        watched: report.watched.clone(),
        watcher,
        _tx: tx,
        overflow_flag,
    };
    Ok((rx, guard, report))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_on_nonexistent_path_returns_error() {
        let result = start_artifact_watcher(
            &[Utf8PathBuf::from("/nonexistent/path/for/watcher/test")],
            16,
            false,
        );
        assert!(result.is_err(), "expected error for nonexistent path");
    }

    /// The first event within `wait` that `wanted` accepts.
    async fn first_event(
        rx: &mut mpsc::Receiver<ArtifactFileEvent>,
        wait: std::time::Duration,
        wanted: impl Fn(&ArtifactFileEvent) -> bool,
    ) -> Option<ArtifactFileEvent> {
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(evt)) if wanted(&evt) => return Some(evt),
                Ok(Some(_)) => {}
                _ => return None,
            }
        }
    }

    #[tokio::test]
    async fn tree_watcher_reports_a_new_folder_for_a_rescan() {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).unwrap();
        let TreeWatch { events: mut rx, guard: _guard, .. } =
            start_tree_watcher(std::slice::from_ref(&root), 64).unwrap();

        std::fs::create_dir(root.join("2026-10-14")).unwrap();

        let rescan = first_event(&mut rx, std::time::Duration::from_secs(3), |evt| {
            evt.kind == ArtifactEventKind::NeedsRescan
        })
        .await;
        assert!(rescan.is_some(), "a new folder below the root must ask for a rescan");
    }

    /// One batch registers every folder of a tree (one `FSEvents` restart on
    /// macOS): the watcher names each folder it listed, and the deepest one
    /// delivers events.
    #[tokio::test]
    async fn tree_watcher_lists_and_watches_every_folder_of_a_tree() {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).unwrap();
        let deepest = (0..20).fold(root.clone(), |folder, depth| folder.join(format!("d{depth}")));
        std::fs::create_dir_all(&deepest).unwrap();
        for night in 0..40 {
            std::fs::create_dir(root.join(format!("night-{night:02}"))).unwrap();
        }

        let TreeWatch { events: mut rx, guard: _guard, folders, refused } =
            start_tree_watcher(std::slice::from_ref(&root), 64).unwrap();
        assert_eq!((folders.len(), refused.len()), (1 + 20 + 40, 0));
        assert!(folders.contains(&deepest.clone().into_std_path_buf()));

        let frame = deepest.join("Ha_001.fits");
        std::fs::write(&frame, b"data").unwrap();
        let created =
            first_event(&mut rx, std::time::Duration::from_secs(3), |evt| evt.path == frame).await;
        assert!(created.is_some(), "the deepest folder of the batch is watched");
    }

    /// Closing returns once Windows released every watched folder: each one
    /// then opens with no sharing, which a watch handle still open refuses.
    #[cfg(windows)]
    #[test]
    fn closing_a_tree_watcher_releases_every_folder_before_it_returns() {
        use std::os::windows::fs::OpenOptionsExt;
        /// `FILE_FLAG_BACKUP_SEMANTICS`, which opening a folder needs.
        const BACKUP_SEMANTICS: u32 = 0x0200_0000;
        let exclusive = |folder: &std::path::Path| {
            std::fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .custom_flags(BACKUP_SEMANTICS)
                .open(folder)
        };
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).unwrap();
        for night in 0..200 {
            std::fs::create_dir(root.join(format!("night-{night:03}"))).unwrap();
        }

        let TreeWatch { guard, folders, refused, .. } =
            start_tree_watcher(std::slice::from_ref(&root), 64).unwrap();
        assert_eq!((folders.len(), refused.len()), (201, 0));
        assert!(exclusive(&folders[0]).is_err(), "a watched folder is held open");
        guard.close();
        for folder in &folders {
            if let Err(error) = exclusive(folder) {
                panic!("{} still held after close: {error}", folder.display());
            }
        }
    }

    #[tokio::test]
    async fn artifact_watcher_does_not_report_new_folders() {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).unwrap();
        let (mut rx, _guard) =
            start_artifact_watcher(std::slice::from_ref(&root), 64, false).unwrap();

        std::fs::create_dir(root.join("2026-10-14")).unwrap();

        let any = first_event(&mut rx, std::time::Duration::from_millis(700), |_| true).await;
        assert!(any.is_none(), "folder events stay unforwarded: {any:?}");
    }

    fn forwarded(res: Result<Event, notify::Error>) -> Vec<ArtifactEventKind> {
        let mut kinds = Vec::new();
        forward(res, NewFolders::Skip, |event| {
            kinds.push(event.kind);
            true
        });
        kinds
    }

    /// A path the platform names in a way UTF-8 cannot spell: a stray byte on
    /// Unix, an unpaired surrogate on Windows.
    fn not_utf8() -> PathBuf {
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            PathBuf::from(std::ffi::OsStr::from_bytes(b"/captures/Ha_\xff.fits"))
        }
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStringExt;
            let mut wide: Vec<u16> = r"C:\captures\Ha_".encode_utf16().collect();
            wide.push(0xD800);
            wide.extend(".fits".encode_utf16());
            PathBuf::from(std::ffi::OsString::from_wide(&wide))
        }
    }

    /// Its event cannot be forwarded, so a tree watcher asks for a rescan,
    /// whose walk counts what changed there.
    #[test]
    fn a_path_that_is_not_utf8_asks_a_tree_watcher_for_a_rescan() {
        let path = not_utf8();
        assert!(path.to_str().is_none());
        let created = Event::new(EventKind::Create(notify::event::CreateKind::File)).add_path(path);
        let mut kinds = Vec::new();
        forward(Ok(created.clone()), NewFolders::Rescan, |event| {
            kinds.push(event.kind);
            true
        });
        assert_eq!(kinds, [ArtifactEventKind::NeedsRescan]);
        assert_eq!(forwarded(Ok(created)), [] as [ArtifactEventKind; 0]);
    }

    /// A link that took a watched folder's place is reported as its own path
    /// to a tree watcher, which follows no link; the artifact watcher still
    /// forwards no folder event.
    #[cfg(unix)]
    #[test]
    fn a_link_to_a_folder_is_reported_to_a_tree_watcher_as_its_path() {
        let dir = tempfile::tempdir().unwrap();
        let elsewhere = dir.path().join("elsewhere");
        std::fs::create_dir(&elsewhere).unwrap();
        let link = dir.path().join("night");
        std::os::unix::fs::symlink(&elsewhere, &link).unwrap();
        let created =
            Event::new(EventKind::Create(notify::event::CreateKind::Any)).add_path(link.clone());

        let mut events = Vec::new();
        forward(Ok(created.clone()), NewFolders::Rescan, |event| {
            events.push((event.path, event.kind));
            true
        });
        let link = Utf8PathBuf::from_path_buf(link).unwrap();
        assert_eq!(events, [(link, ArtifactEventKind::Created)]);
        assert_eq!(forwarded(Ok(created)), [] as [ArtifactEventKind; 0]);
    }

    #[test]
    fn an_os_watcher_error_asks_for_a_rescan() {
        let kinds = forwarded(Err(notify::Error::generic("inotify watch limit reached")));
        assert_eq!(kinds, [ArtifactEventKind::NeedsRescan]);
    }

    #[test]
    fn an_os_lost_events_notice_asks_for_a_rescan() {
        let notice = Event::new(EventKind::Other).set_flag(notify::event::Flag::Rescan);
        assert_eq!(forwarded(Ok(notice)), [ArtifactEventKind::NeedsRescan]);
        let created = Event::new(EventKind::Create(notify::event::CreateKind::File))
            .add_path("/no/such/folder/Ha_001.fits".into());
        assert_eq!(forwarded(Ok(created)), [ArtifactEventKind::Created]);
    }

    #[test]
    fn only_creations_and_renames_bring_a_folder() {
        use notify::event::{CreateKind, RenameMode};
        assert!(brings_folder(EventKind::Create(CreateKind::Folder)));
        assert!(brings_folder(EventKind::Modify(ModifyKind::Name(RenameMode::To))));
        assert!(!brings_folder(EventKind::Modify(ModifyKind::Metadata(MetadataKind::WriteTime))));
        assert!(!brings_folder(EventKind::Remove(notify::event::RemoveKind::Folder)));
    }

    /// A folder whose permissions or owner changed may list other files now:
    /// a tree watcher asks for a rescan, and so does any metadata change a
    /// backend reports only as `Metadata(Any)`, new times included. A change
    /// named as one of its times or extended attributes changes nothing a
    /// walk lists, and the artifact watcher forwards no folder event.
    #[test]
    fn a_folder_access_change_asks_a_tree_watcher_for_a_rescan() {
        let dir = tempfile::tempdir().unwrap();
        let rescans = |kind: MetadataKind| {
            let changed = Event::new(EventKind::Modify(ModifyKind::Metadata(kind)))
                .add_path(dir.path().to_path_buf());
            let mut kinds = Vec::new();
            forward(Ok(changed.clone()), NewFolders::Rescan, |event| {
                kinds.push(event.kind);
                true
            });
            assert_eq!(forwarded(Ok(changed)), [] as [ArtifactEventKind; 0]);
            kinds == [ArtifactEventKind::NeedsRescan]
        };
        assert!(rescans(MetadataKind::Any), "inotify IN_ATTRIB, FSEvents inode metadata, utimes");
        assert!(!rescans(MetadataKind::AccessTime));
        assert!(rescans(MetadataKind::Permissions));
        assert!(rescans(MetadataKind::Ownership));
        assert!(!rescans(MetadataKind::WriteTime));
        assert!(!rescans(MetadataKind::Extended));
    }

    /// Windows names a folder's access change only as a generic
    /// modification, as it names each file written in the folder: a tree
    /// watcher rescans only once the folder no longer opens. The kind is
    /// built here, so the unreadable folder is made with Unix permissions.
    #[cfg(unix)]
    #[test]
    fn a_generic_folder_change_rescans_once_the_folder_no_longer_opens() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("night");
        std::fs::create_dir(&folder).unwrap();
        let modified = Event::new(EventKind::Modify(ModifyKind::Any)).add_path(folder.clone());
        let rescans = || {
            let mut kinds = Vec::new();
            forward(Ok(modified.clone()), NewFolders::Rescan, |event| {
                kinds.push(event.kind);
                true
            });
            kinds == [ArtifactEventKind::NeedsRescan]
        };
        assert!(!rescans(), "a file written in it");

        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o000)).unwrap();
        let unreadable = std::fs::read_dir(&folder).is_err();
        let rescanned = rescans();
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(unreadable, "needs a user file permissions bind, not root");
        assert!(rescanned, "it no longer opens");
        assert_eq!(forwarded(Ok(modified)), [] as [ArtifactEventKind; 0]);
    }

    /// `FSEvents` reports a nested volume unmounted from a folder of the tree
    /// as a removal of the mount point, which by then is the folder below it,
    /// never watched: a tree watcher asks for a rescan. A removed path that
    /// holds no folder any more is still forwarded as its removal, and the
    /// artifact watcher forwards no folder event.
    #[test]
    fn a_removal_of_a_path_still_holding_a_folder_asks_a_tree_watcher_for_a_rescan() {
        use notify::event::RemoveKind;
        let dir = tempfile::tempdir().unwrap();
        let mount_point = dir.path().join("night");
        std::fs::create_dir(&mount_point).unwrap();
        let gone = dir.path().join("gone");
        let removed = |path: &std::path::Path| {
            let event = Event::new(EventKind::Remove(RemoveKind::Folder)).add_path(path.into());
            let mut events = Vec::new();
            forward(Ok(event.clone()), NewFolders::Rescan, |event| {
                events.push((event.path, event.kind));
                true
            });
            (events, forwarded(Ok(event)))
        };

        let (tree, artifact) = removed(&mount_point);
        assert_eq!(tree, [(Utf8PathBuf::new(), ArtifactEventKind::NeedsRescan)]);
        assert_eq!(artifact, [] as [ArtifactEventKind; 0]);

        let (tree, artifact) = removed(&gone);
        let gone = Utf8PathBuf::from_path_buf(gone).unwrap();
        assert_eq!(tree, [(gone, ArtifactEventKind::Removed)]);
        assert_eq!(artifact, [ArtifactEventKind::Removed]);
    }

    #[tokio::test]
    async fn start_on_temp_dir_succeeds_and_guard_drops_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let (mut rx, guard) = start_artifact_watcher(&[root], 16, false).unwrap();

        drop(guard);

        // After dropping the guard, the Sender Arc is released.
        // Channel becomes closed; recv returns None.
        assert!(rx.recv().await.is_none());
    }

    #[tokio::test]
    async fn file_create_fires_event() {
        let dir = tempfile::tempdir().unwrap();
        // Canonicalize so emitted event paths match `file_path` (macOS reports
        // /private/var/... while tempdir() returns /var/...).
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).unwrap();
        let (mut rx, _guard) =
            start_artifact_watcher(std::slice::from_ref(&root), 64, false).unwrap();

        let file_path = root.join("test_artifact.xisf");
        std::fs::write(&file_path, b"data").unwrap();

        // Wait for event with a 2-second deadline.
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
        let received = loop {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(evt)) if evt.path == file_path => break true,
                Ok(Some(_)) => {}
                _ => break false,
            }
        };
        assert!(received, "expected ArtifactFileEvent for the created file");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlinked_subtree_is_not_traversed_unless_enabled() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let canonical_root = dir.path().canonicalize().unwrap();
        let real_target = canonical_root.join("real_target");
        std::fs::create_dir_all(&real_target).unwrap();

        let scan_root = canonical_root.join("scan_root");
        std::fs::create_dir_all(&scan_root).unwrap();
        symlink(&real_target, scan_root.join("linked")).unwrap();
        let scan_root_utf8 = Utf8PathBuf::from_path_buf(scan_root).unwrap();

        let (mut rx, _guard) =
            start_artifact_watcher(std::slice::from_ref(&scan_root_utf8), 64, false).unwrap();

        // A file written behind the un-enabled symlink must never surface an
        // event — the watcher was never attached to that subtree.
        std::fs::write(real_target.join("hidden.fits"), b"data").unwrap();

        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(500);
        let received = tokio::time::timeout_at(deadline, rx.recv()).await;
        assert!(
            received.is_err(),
            "must not observe an event for a file behind an un-enabled symlink"
        );
    }
}
