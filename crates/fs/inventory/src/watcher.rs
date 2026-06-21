//! Filesystem watcher service for inbox folders.
//!
//! Watches inbox directories for file additions, deletions, and moves using
//! the `notify` crate. Events are forwarded to a tokio broadcast channel so
//! that multiple consumers (e.g. the Tauri event bridge) can subscribe.
//!
//! Per research R8, only inbox folders are watched — raw/calibration/project
//! roots are scanned on demand.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

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

/// Diagnostic sink for a non-UTF-8 watcher path that cannot be represented as a
/// faithful UTF-8 wire string. We deliberately do **not** lossy-convert; the
/// event is dropped. The lossy `to_string_lossy` rendering is used here only for
/// the human-readable diagnostic, never for the emitted payload.
fn tracing_skip_non_utf8(path: &std::path::Path) {
    // `fs_inventory` has no `tracing` dependency; emit a stderr diagnostic so the
    // skip is observable without corrupting the wire payload.
    eprintln!(
        "fs_inventory::watcher: skipping non-UTF-8 path (cannot emit faithful UTF-8 event): {}",
        path.to_string_lossy()
    );
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
    /// Replaces any previously active watcher. Each path is watched
    /// recursively so that nested inbox structures are captured.
    ///
    /// # Errors
    ///
    /// Returns an error string if the platform watcher cannot be created or a
    /// path cannot be watched.
    pub fn start(&mut self, paths: &[Utf8PathBuf]) -> Result<(), String> {
        // Stop existing watcher if running.
        self.watcher = None;

        let tx = self.tx.clone();

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else {
                return;
            };

            // `notify` yields `std::path::PathBuf`, which can be non-UTF-8 on a
            // raw disk. We convert each path losslessly via `Utf8Path::from_path`.
            // A non-UTF-8 path is *skipped* (not lossy-converted): we cannot emit
            // a faithful UTF-8 wire string for it, so the event is dropped with a
            // diagnostic rather than corrupting the path. Constitution §I: never
            // silently mangle a user path.
            let make = |kind: PathEventKind, paths: &[std::path::PathBuf]| {
                paths
                    .iter()
                    .filter_map(|p| {
                        if let Some(utf8) = Utf8Path::from_path(p) {
                            Some(kind.into_event(utf8.as_str().to_owned()))
                        } else {
                            tracing_skip_non_utf8(p);
                            None
                        }
                    })
                    .collect::<Vec<InboxFileEvent>>()
            };

            let events: Vec<InboxFileEvent> = match event.kind {
                EventKind::Create(_) => make(PathEventKind::Added, &event.paths),
                EventKind::Remove(_) => make(PathEventKind::Removed, &event.paths),
                EventKind::Modify(_) => make(PathEventKind::Modified, &event.paths),
                _ => Vec::new(),
            };

            for evt in events {
                // Ignore send errors — they mean no subscribers are active.
                let _ = tx.send(evt);
            }
        })
        .map_err(|e| format!("failed to create filesystem watcher: {e}"))?;

        for path in paths {
            watcher
                .watch(path.as_std_path(), RecursiveMode::Recursive)
                .map_err(|e| format!("failed to watch {path}: {e}"))?;
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
        let result = svc.start(&[Utf8PathBuf::from("/nonexistent/path/that/should/not/exist")]);
        assert!(result.is_err());
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
