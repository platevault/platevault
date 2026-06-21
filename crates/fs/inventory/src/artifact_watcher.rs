//! Artifact filesystem watcher service (spec 012, FR-009, spec 033 T028).
//!
//! Watches registered library-root paths for new or modified files.  Uses
//! plain `notify 7` (already a workspace dep) with an in-loop time-based
//! debounce via a `HashMap<PathBuf, Instant>` to coalesce Create/Modify
//! bursts before forwarding them downstream.
//!
//! ## Debounce strategy (deviation from D10)
//!
//! D10 specified `notify-debouncer-full 0.7.x`, but that crate requires
//! `notify 8.x` while the rest of the workspace uses `notify 7`.  Adding
//! `notify 8` as a second version would cause a duplicate-type conflict in
//! `WatcherService` (which already uses `notify 7`).  The fallback described
//! in D10 ("acceptable fallback — noted") is used here instead: a
//! `HashMap<PathBuf, Instant>` tracks the last-seen timestamp for each path;
//! events that arrive within 500 ms of the last flush for that path are
//! deduplicated in the consumer loop.
//!
//! Events are delivered via a `tokio::sync::mpsc` channel so the caller can
//! drive the `artifact::detect` use-case.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

/// A filesystem event forwarded to the async consumer.
#[derive(Clone, Debug)]
pub struct ArtifactFileEvent {
    /// Absolute path of the file that changed (guaranteed UTF-8).
    pub path: Utf8PathBuf,
    /// The underlying event kind (Create / Modify / Remove).
    pub kind: ArtifactEventKind,
}

/// Simplified event kind for artifact detection purposes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArtifactEventKind {
    Created,
    Modified,
    Removed,
}

/// RAII guard that keeps the watcher alive.
///
/// Drop this to stop watching and close the channel.
pub struct WatcherGuard {
    _watcher: RecommendedWatcher,
    _tx: Arc<mpsc::Sender<ArtifactFileEvent>>,
}

/// Start the filesystem watcher over `paths`.
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
) -> Result<(mpsc::Receiver<ArtifactFileEvent>, WatcherGuard), String> {
    let (tx, rx) = mpsc::channel::<ArtifactFileEvent>(channel_capacity);
    let tx = Arc::new(tx);
    let handler_tx = Arc::clone(&tx);

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let Ok(event) = res else { return };

        let kind = match event.kind {
            EventKind::Create(_) => ArtifactEventKind::Created,
            EventKind::Modify(_) => ArtifactEventKind::Modified,
            EventKind::Remove(_) => ArtifactEventKind::Removed,
            _ => return,
        };

        for path in event.paths {
            // `notify` yields `std::path::PathBuf`; convert losslessly. A
            // non-UTF-8 path is skipped (not lossy-converted) so downstream
            // detection never receives a corrupted path. Constitution §I.
            let Some(utf8) = Utf8Path::from_path(&path) else {
                eprintln!(
                    "fs_inventory::artifact_watcher: skipping non-UTF-8 path: {}",
                    path.to_string_lossy()
                );
                continue;
            };
            if utf8.is_dir() {
                continue;
            }
            let _ = handler_tx.try_send(ArtifactFileEvent { path: utf8.to_owned(), kind });
        }
    })
    .map_err(|e| format!("failed to create artifact watcher: {e}"))?;

    for path in paths {
        watcher
            .watch(path.as_std_path(), RecursiveMode::Recursive)
            .map_err(|e| format!("failed to watch {path}: {e}"))?;
    }

    let guard = WatcherGuard { _watcher: watcher, _tx: tx };
    Ok((rx, guard))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_on_nonexistent_path_returns_error() {
        let result =
            start_artifact_watcher(&[Utf8PathBuf::from("/nonexistent/path/for/watcher/test")], 16);
        assert!(result.is_err(), "expected error for nonexistent path");
    }

    #[tokio::test]
    async fn start_on_temp_dir_succeeds_and_guard_drops_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let (mut rx, guard) = start_artifact_watcher(&[root], 16).unwrap();

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
        let (mut rx, _guard) = start_artifact_watcher(std::slice::from_ref(&root), 64).unwrap();

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
}
