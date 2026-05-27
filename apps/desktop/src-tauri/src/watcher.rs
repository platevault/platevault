//! Bridge between the `fs_inventory::watcher::WatcherService` and the Tauri
//! event system.
//!
//! `start_watcher` spawns a background task that subscribes to watcher events
//! and forwards them to the webview via `app_handle.emit("inbox:file-change", payload)`.
//! `stop_watcher` shuts the watcher down and the forwarding task exits on the
//! next loop iteration when the broadcast channel is closed.

use std::path::PathBuf;

use fs_inventory::watcher::{InboxFileEvent, SharedWatcherService};
use tauri::{AppHandle, Emitter};

/// Start watching the given inbox paths and forward events to the Tauri webview.
///
/// # Errors
///
/// Returns an error string if the underlying watcher cannot be started.
pub async fn start_watcher(
    app_handle: AppHandle,
    watcher_service: SharedWatcherService,
    paths: &[PathBuf],
) -> Result<(), String> {
    let mut rx = {
        let mut svc = watcher_service.lock().await;
        let rx = svc.subscribe();
        svc.start(paths)?;
        rx
    };

    // Spawn a background task to forward watcher events to the webview.
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let payload = match &event {
                        InboxFileEvent::Added { path } => {
                            serde_json::json!({ "kind": "added", "path": path })
                        }
                        InboxFileEvent::Removed { path } => {
                            serde_json::json!({ "kind": "removed", "path": path })
                        }
                        InboxFileEvent::Modified { path } => {
                            serde_json::json!({ "kind": "modified", "path": path })
                        }
                    };
                    // Best-effort emit — the webview may not be listening.
                    let _ = app_handle.emit("inbox:file-change", payload);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    tracing::debug!("watcher broadcast channel closed, stopping forwarder");
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("watcher event forwarder lagged by {n} events");
                }
            }
        }
    });

    Ok(())
}

/// Stop the filesystem watcher.
///
/// The background forwarding task will exit once the broadcast channel is
/// closed (which happens when the watcher is dropped).
pub async fn stop_watcher(watcher_service: SharedWatcherService) {
    let mut svc = watcher_service.lock().await;
    svc.stop();
}
