// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Filesystem watcher service for inbox folders.
//!
//! Watches inbox directories for file additions, deletions, and moves using
//! the `notify` crate. Events are forwarded to a tokio broadcast channel so
//! that multiple consumers (e.g. the Tauri event bridge) can subscribe.
//!
//! Per research R8, only inbox folders are watched — raw/calibration/project
//! roots are scanned on demand.

use std::sync::Arc;

use camino::Utf8PathBuf;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::notify_bridge::SimpleEventKind;

/// Events emitted by the watcher service.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum InboxFileEvent {
    /// A file was created or moved into an inbox folder.
    Added { path: String },
    /// A file was removed or moved out of an inbox folder.
    Removed { path: String },
    /// A file was modified in-place.
    Modified { path: String },
}

/// Internal selector for which [`InboxFileEvent`] variant to build from a path.
#[derive(Clone, Copy)]
enum PathEventKind {
    Added,
    Removed,
    Modified,
}

impl PathEventKind {
    fn into_event(self, path: String) -> InboxFileEvent {
        match self {
            Self::Added => InboxFileEvent::Added { path },
            Self::Removed => InboxFileEvent::Removed { path },
            Self::Modified => InboxFileEvent::Modified { path },
        }
    }
}

impl From<SimpleEventKind> for PathEventKind {
    fn from(kind: SimpleEventKind) -> Self {
        match kind {
            SimpleEventKind::Created => Self::Added,
            SimpleEventKind::Removed => Self::Removed,
            SimpleEventKind::Modified => Self::Modified,
        }
    }
}

/// Manages a filesystem watcher scoped to inbox directories.
///
/// Call [`WatcherService::start`] with the list of inbox paths to begin
/// watching. Events are delivered on the broadcast channel returned by
/// [`WatcherService::subscribe`].
pub struct WatcherService {
    tx: broadcast::Sender<InboxFileEvent>,
    watcher: Option<RecommendedWatcher>,
}

impl WatcherService {
    /// Create a new idle watcher service.
    ///
    /// No directories are watched until [`Self::start`] is called.
    #[must_use]
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self { tx, watcher: None }
    }

    /// Subscribe to inbox file events.
    ///
    /// Multiple consumers may subscribe; each receives all events.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<InboxFileEvent> {
        self.tx.subscribe()
    }

    /// Start watching the given inbox directory paths.
    ///
    /// Replaces any previously active watcher.
    ///
    /// `follow_symlinks` gates traversal (spec 048 T004, constitution "MUST
    /// NOT follow symlinks or junctions unless explicitly enabled per
    /// root"): when `false` (the default for inbox folders), each path is
    /// walked ourselves via [`fs_pathsafe::real_dirs_under`] and every
    /// real (non-link) subdirectory is watched individually with
    /// `RecursiveMode::NonRecursive`, so a linked subtree is never traversed
    /// at the OS level. When `true`, the previous behaviour is preserved: a
    /// single `RecursiveMode::Recursive` watch per path (the OS watcher may
    /// then follow links under it).
    ///
    /// # Errors
    ///
    /// Returns an error string if the platform watcher cannot be created or a
    /// path cannot be watched.
    pub fn start(&mut self, paths: &[Utf8PathBuf], follow_symlinks: bool) -> Result<(), String> {
        // Stop existing watcher if running.
        self.watcher = None;

        let tx = self.tx.clone();

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else {
                return;
            };

            let Some(simple_kind) = crate::notify_bridge::classify(event.kind) else {
                return;
            };
            let kind = PathEventKind::from(simple_kind);

            for path in &event.paths {
                let Some(utf8) =
                    crate::notify_bridge::utf8_path_or_skip(path, "fs_inventory::watcher")
                else {
                    continue;
                };
                // Ignore send errors — they mean no subscribers are active.
                let _ = tx.send(kind.into_event(utf8.into_string()));
            }
        })
        .map_err(|e| format!("failed to create filesystem watcher: {e}"))?;

        for path in paths {
            if follow_symlinks {
                watcher
                    .watch(path.as_std_path(), RecursiveMode::Recursive)
                    .map_err(|e| format!("failed to watch {path}: {e}"))?;
                continue;
            }

            for dir in fs_pathsafe::real_dirs_under(path.as_std_path(), false) {
                watcher
                    .watch(&dir, RecursiveMode::NonRecursive)
                    .map_err(|e| format!("failed to watch {}: {e}", dir.display()))?;
            }
        }

        self.watcher = Some(watcher);
        Ok(())
    }

    /// Stop watching all directories.
    ///
    /// Drops the underlying platform watcher. Existing subscribers will stop
    /// receiving events but remain valid (they will see `RecvError::Lagged` or
    /// `RecvError::Closed` on the next receive).
    pub fn stop(&mut self) {
        self.watcher = None;
    }

    /// Returns `true` if the watcher is currently active.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.watcher.is_some()
    }
}

impl Default for WatcherService {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe handle to a [`WatcherService`] behind an `Arc<Mutex>`.
pub type SharedWatcherService = Arc<tokio::sync::Mutex<WatcherService>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_watcher_is_not_running() {
        let svc = WatcherService::new();
        assert!(!svc.is_running());
    }

    #[test]
    fn stop_is_idempotent() {
        let mut svc = WatcherService::new();
        svc.stop();
        svc.stop();
        assert!(!svc.is_running());
    }

    #[test]
    fn start_nonexistent_path_returns_error() {
        let mut svc = WatcherService::new();
        let result =
            svc.start(&[Utf8PathBuf::from("/nonexistent/path/that/should/not/exist")], false);
        assert!(result.is_err());
    }

    #[test]
    fn start_with_follow_symlinks_true_watches_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let mut svc = WatcherService::new();
        assert!(svc.start(&[path], true).is_ok());
        assert!(svc.is_running());
    }

    #[test]
    fn start_with_follow_symlinks_false_watches_real_subdirs_only() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("nested")).unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let mut svc = WatcherService::new();
        assert!(svc.start(&[path], false).is_ok());
        assert!(svc.is_running());
    }

    #[test]
    fn subscribe_returns_receiver() {
        let svc = WatcherService::new();
        let _rx = svc.subscribe();
        // Should not panic — receiver is valid even without active watcher.
    }

    #[test]
    fn inbox_file_event_serializes_with_tag() {
        let evt = InboxFileEvent::Added { path: "/inbox/test.fits".to_owned() };
        let json = serde_json::to_value(&evt).unwrap();
        assert_eq!(json["kind"], "added");
        assert_eq!(json["path"], "/inbox/test.fits");
    }
}
