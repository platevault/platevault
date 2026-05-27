//! Filesystem watcher service for inbox folders.
//!
//! Watches inbox directories for file additions, deletions, and moves using
//! the `notify` crate. Events are forwarded to a tokio broadcast channel so
//! that multiple consumers (e.g. the Tauri event bridge) can subscribe.
//!
//! Per research R8, only inbox folders are watched — raw/calibration/project
//! roots are scanned on demand.

use std::path::PathBuf;
use std::sync::Arc;

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
    pub fn start(&mut self, paths: &[PathBuf]) -> Result<(), String> {
        // Stop existing watcher if running.
        self.watcher = None;

        let tx = self.tx.clone();

        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else {
                return;
            };

            let events: Vec<InboxFileEvent> = match event.kind {
                EventKind::Create(_) => event
                    .paths
                    .iter()
                    .map(|p| InboxFileEvent::Added { path: p.display().to_string() })
                    .collect(),
                EventKind::Remove(_) => event
                    .paths
                    .iter()
                    .map(|p| InboxFileEvent::Removed { path: p.display().to_string() })
                    .collect(),
                EventKind::Modify(_) => event
                    .paths
                    .iter()
                    .map(|p| InboxFileEvent::Modified { path: p.display().to_string() })
                    .collect(),
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
                .watch(path, RecursiveMode::Recursive)
                .map_err(|e| format!("failed to watch {}: {e}", path.display()))?;
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
        let result = svc.start(&[PathBuf::from("/nonexistent/path/that/should/not/exist")]);
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
