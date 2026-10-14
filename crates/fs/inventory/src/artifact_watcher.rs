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
//! follows links and reports a folder that appears below a watched path as
//! `NeedsRescan`. Both report an OS watcher error, an OS lost-events notice
//! and a full channel (through the overflow flag) for a rescan.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use camino::Utf8PathBuf;
use notify::event::ModifyKind;
use notify::{Event, EventKind, RecommendedWatcher};
use tokio::sync::mpsc;

use crate::notify_bridge::SimpleEventKind;

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
/// Drop this to stop watching and close the channel.
///
/// `overflow_flag` is set to `true` by the notify callback whenever the mpsc
/// channel is full and at least one event was dropped. The forward task polls
/// this flag instead of relying on an in-band sentinel event — an
/// `AtomicBool::store` cannot itself be lost the way a `try_send` can.
pub struct WatcherGuard {
    _watcher: RecommendedWatcher,
    _tx: Arc<mpsc::Sender<ArtifactFileEvent>>,
    /// Set to `true` when the channel overflowed; cleared by the consumer
    /// after it triggers reconciliation.
    pub overflow_flag: Arc<AtomicBool>,
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
/// Returns an `mpsc::Receiver` and a `WatcherGuard`.  Drop the guard to stop.
///
/// # Errors
///
/// Returns an error string if the platform watcher cannot be initialised or a
/// path cannot be watched.
pub fn start_artifact_watcher(
    paths: &[Utf8PathBuf],
    channel_capacity: usize,
    follow_symlinks: bool,
) -> Result<(mpsc::Receiver<ArtifactFileEvent>, WatcherGuard), String> {
    start(paths, channel_capacity, follow_symlinks, NewFolders::Skip)
}

/// Start a watcher over every real folder below `paths`, never following a
/// link or junction, that also covers folders appearing later.
///
/// Each real folder is watched on its own (as [`start_artifact_watcher`] with
/// `follow_symlinks` off), so a folder created or moved in below `paths` is
/// not watched yet: it is reported as [`ArtifactEventKind::NeedsRescan`], and
/// the consumer restarts the watcher over the new folder set and walks the
/// tree for the files the new folder already holds.
///
/// # Errors
///
/// As [`start_artifact_watcher`].
pub fn start_tree_watcher(
    paths: &[Utf8PathBuf],
    channel_capacity: usize,
) -> Result<(mpsc::Receiver<ArtifactFileEvent>, WatcherGuard), String> {
    start(paths, channel_capacity, false, NewFolders::Rescan)
}

/// What a folder created or moved in below a watched path signals.
#[derive(Clone, Copy)]
enum NewFolders {
    /// Nothing: folder events are not forwarded.
    Skip,
    /// [`ArtifactEventKind::NeedsRescan`], because the folder is not watched.
    Rescan,
}

/// Whether `kind` brings a folder into the watched tree: created there, or
/// renamed to (or, where the platform cannot pair renames, from) its name.
const fn brings_folder(kind: EventKind) -> bool {
    matches!(kind, EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_)))
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
        let Some(utf8) =
            crate::notify_bridge::utf8_path_or_skip(path, "fs_inventory::artifact_watcher")
        else {
            continue;
        };
        if utf8.is_dir() {
            if matches!(new_folders, NewFolders::Rescan)
                && brings_folder(event.kind)
                && !fs_pathsafe::is_link_or_junction(path)
                && !send(needs_rescan())
            {
                return;
            }
            continue;
        }
        if !send(ArtifactFileEvent { path: utf8, kind }) {
            return;
        }
    }
}

fn start(
    paths: &[Utf8PathBuf],
    channel_capacity: usize,
    follow_symlinks: bool,
    new_folders: NewFolders,
) -> Result<(mpsc::Receiver<ArtifactFileEvent>, WatcherGuard), String> {
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
    let report =
        crate::notify_bridge::register_watch_paths(&mut watcher, paths, follow_symlinks, false)?;
    if !report.skipped.is_empty() {
        tracing::warn!(
            "artifact watcher: {} subdirectories could not be watched (partial start)",
            report.skipped.len()
        );
    }

    let guard = WatcherGuard { _watcher: watcher, _tx: tx, overflow_flag };
    Ok((rx, guard))
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
        let (mut rx, _guard) = start_tree_watcher(std::slice::from_ref(&root), 64).unwrap();

        std::fs::create_dir(root.join("2026-10-14")).unwrap();

        let rescan = first_event(&mut rx, std::time::Duration::from_secs(3), |evt| {
            evt.kind == ArtifactEventKind::NeedsRescan
        })
        .await;
        assert!(rescan.is_some(), "a new folder below the root must ask for a rescan");
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
        use notify::event::{CreateKind, MetadataKind, RenameMode};
        assert!(brings_folder(EventKind::Create(CreateKind::Folder)));
        assert!(brings_folder(EventKind::Modify(ModifyKind::Name(RenameMode::To))));
        assert!(!brings_folder(EventKind::Modify(ModifyKind::Metadata(MetadataKind::WriteTime))));
        assert!(!brings_folder(EventKind::Remove(notify::event::RemoveKind::Folder)));
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
