//! Bridge between the `fs_inventory::watcher::WatcherService` and the Tauri
//! event system.
//!
//! `start_watcher` spawns a background task that subscribes to watcher events
//! and forwards them to the webview via `app_handle.emit("inbox:file-change", payload)`.
//! `stop_watcher` shuts the watcher down and the forwarding task exits on the
//! next loop iteration when the broadcast channel is closed.

use std::path::PathBuf;

use audit::bus::EventBus;
use fs_inventory::artifact_watcher::{start_artifact_watcher, ArtifactEventKind};
use fs_inventory::watcher::{InboxFileEvent, SharedWatcherService};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use time::OffsetDateTime;

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

// ── Artifact watcher (spec 012, FR-009, spec 033 T028) ────────────────────────

/// Spawn the artifact watcher loop.
///
/// 1. Loads all registered library-root paths from the DB.
/// 2. Starts the debounced watcher over those paths.
/// 3. For each `Created` / `Modified` event: calls `artifact::detect` → emits
///    both `artifact.detected` (existing) and `artifact.classified` (new, T028).
///
/// Runs as a fire-and-forget tokio task.  Errors loading roots or starting the
/// watcher are logged and the task exits cleanly without panicking.
pub fn spawn_artifact_watcher(pool: SqlitePool, bus: EventBus) {
    tokio::spawn(async move {
        // Load all registered library roots.
        let roots = match persistence_db::repositories::inventory::list_all_roots(&pool).await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("artifact watcher: could not load library roots: {e}");
                return;
            }
        };

        let paths: Vec<PathBuf> =
            roots.iter().map(|r| PathBuf::from(&r.current_path)).filter(|p| p.exists()).collect();

        if paths.is_empty() {
            tracing::debug!("artifact watcher: no registered library roots found; not watching");
            return;
        }

        let (mut rx, _guard) = match start_artifact_watcher(&paths, 256) {
            Ok(pair) => pair,
            Err(e) => {
                tracing::warn!("artifact watcher: failed to start: {e}");
                return;
            }
        };

        tracing::info!("artifact watcher: watching {} root(s)", roots.len());

        while let Some(evt) = rx.recv().await {
            // Only handle create/modify — removals are handled by reconciliation.
            if evt.kind == ArtifactEventKind::Removed {
                continue;
            }

            let path_str = evt.path.to_string_lossy().into_owned();

            // Attempt to find which root this path belongs to (for project_id).
            // For watcher events we derive project_id from the root that owns the
            // path. The root id is used as the project_id key here because at the
            // filesystem level we don't yet have the artifact-project mapping.
            let project_id = roots
                .iter()
                .find(|r| evt.path.starts_with(&r.current_path))
                .map_or_else(|| "unknown".to_owned(), |r| r.id.clone());

            let now = OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());

            // Call detect — this emits both artifact.detected AND artifact.classified
            // (spec 033 T028: the classified event is now emitted inside detect).
            match app_core::artifact::detect(
                &pool,
                &bus,
                &project_id,
                &path_str,
                "filesystem",
                0, // size unknown at watch time; reconciliation fills it
                &now,
                &now,
            )
            .await
            {
                Ok(_) => {
                    tracing::debug!("artifact watcher: detected {path_str}");
                }
                Err(e) => {
                    tracing::debug!("artifact watcher: detect failed for {path_str}: {e}");
                }
            }
        }

        tracing::debug!("artifact watcher: channel closed, exiting");
    });
}
