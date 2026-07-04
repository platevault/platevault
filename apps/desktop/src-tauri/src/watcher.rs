//! Bridge between the `fs_inventory::watcher::WatcherService` and the Tauri
//! event system.
//!
//! `start_watcher` spawns a background task that subscribes to watcher events
//! and forwards them to the webview via `app_handle.emit("inbox:file-change", payload)`.
//! `stop_watcher` shuts the watcher down and the forwarding task exits on the
//! next loop iteration when the broadcast channel is closed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use camino::Utf8PathBuf;

use audit::bus::EventBus;
use fs_inventory::artifact_watcher::{start_artifact_watcher, ArtifactEventKind, WatcherGuard};
use fs_inventory::watcher::{InboxFileEvent, SharedWatcherService};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

/// Start watching the given inbox paths and forward events to the Tauri webview.
///
/// # Errors
///
/// Returns an error string if the underlying watcher cannot be started.
pub async fn start_watcher(
    app_handle: AppHandle,
    watcher_service: SharedWatcherService,
    paths: &[Utf8PathBuf],
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

// ── Artifact watcher (spec 012, FR-009, T008) ──────────────────────────────────
//
// One OS watcher per *active* project, attached when the project drawer opens
// and detached when it closes (plan.md §Sequencing: "One watcher per active
// project... This bounds the number of OS watchers, which is a scarce
// resource on macOS and Windows"). A global always-on watcher over every
// registered library root was tried first and dropped: it never bounded the
// OS-watcher count, watched entire drives recursively regardless of whether
// any project was open, and stamped the *library root* id onto
// `ProcessingArtifact.project_id` (never the real project). Re-attaching runs
// an on-attach reconciliation pass first (T005's `reconcile`) so files written
// while detached are still picked up (spec 012 edge case).

/// A single project's live watcher + its event-forwarding task.
pub struct ArtifactWatcherEntry {
    /// Kept alive only to hold the OS watcher open; dropping it stops watching
    /// and closes the event channel, which ends `forward_task`.
    _guard: WatcherGuard,
    forward_task: JoinHandle<()>,
}

/// Registry of per-project artifact watchers, keyed by `project_id`.
///
/// Managed as Tauri state so `artifact_watcher_attach`/`artifact_watcher_detach`
/// commands can look up and mutate it.
pub type ArtifactWatcherRegistry = Arc<Mutex<HashMap<String, ArtifactWatcherEntry>>>;

/// Construct an empty registry (call once at app startup and `app.manage()` it).
#[must_use]
pub fn new_artifact_watcher_registry() -> ArtifactWatcherRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Derive the stable `[a-z][a-z0-9_]*` tool id from a project's display `tool`
/// field (data-model.md §`WorkflowBinding` resolution rule). Mirrors the
/// frontend's `toolIdFromProjectTool` in `features/projects/tool-launch.ts`:
/// `"PixInsight"` → `"pixinsight"`, `"Planetary Suite"` → `"planetary_suite"`.
fn tool_id_from_project_tool(project_tool: &str) -> String {
    project_tool.to_lowercase().split_whitespace().collect::<Vec<_>>().join("_")
}

/// Non-recursive directory listing of real files only.
///
/// Constitution: never follows symlinks (no per-root opt-in exists for
/// project output folders in v1), and never recurses (matches the
/// single-level contract `workflow_artifacts::reconciler::reconcile` already
/// exercises in its unit tests).
fn real_read_dir(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("read_dir({}) failed: {e}", dir.display()))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_symlink() || !file_type.is_file() {
            continue;
        }
        out.push(entry.path());
    }
    Ok(out)
}

/// Real (size, mtime) probe. Uses `symlink_metadata` and rejects symlinks
/// explicitly — belt-and-suspenders alongside `real_read_dir`'s filter.
fn real_metadata(path: &Path) -> Option<(u64, std::time::SystemTime)> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() {
        return None;
    }
    let modified = meta.modified().ok()?;
    Some((meta.len(), modified))
}

/// Run the on-attach reconciliation pass (T005): scan `project_root`,
/// transition DB rows that are `Gone`/`Seen`, and `detect` any `new_files`.
///
/// Split out of [`attach_project_watcher`] to keep that function's line count
/// within the workspace lint budget; it has no independent lifecycle of its
/// own (always called immediately before the live watcher starts).
async fn run_attach_reconciliation(
    pool: &SqlitePool,
    bus: &EventBus,
    project_id: &str,
    project_root: &Path,
    tool_id: &str,
    ext_refs: &[&str],
) -> Result<(), String> {
    let known_rows = persistence_db::repositories::artifacts::list_artifacts_for_project(
        pool,
        project_id,
        &["present"],
    )
    .await
    .map_err(|e| format!("{e}"))?;
    let known_paths: Vec<String> = known_rows.iter().map(|r| r.path.clone()).collect();

    let report = workflow_artifacts::reconcile(
        project_root,
        &known_paths,
        ext_refs,
        &real_read_dir,
        &real_metadata,
    )
    .map_err(|e| format!("reconcile failed: {e}"))?;

    for (rel_path, outcome) in report.existing {
        let Some(row) = known_rows.iter().find(|r| r.path == rel_path) else { continue };
        match outcome {
            workflow_artifacts::ReconcileOutcome::Gone => {
                if let Err(e) =
                    app_core::artifact::mark_missing(pool, bus, project_id, &row.id, &row.path)
                        .await
                {
                    tracing::warn!("artifact watcher: mark_missing failed for {}: {e}", row.path);
                }
            }
            workflow_artifacts::ReconcileOutcome::Seen => {
                if let Err(e) =
                    persistence_db::repositories::artifacts::touch_artifact(pool, &row.id).await
                {
                    tracing::warn!("artifact watcher: touch_artifact failed for {}: {e}", row.path);
                }
            }
        }
    }

    for new_file in report.new_files {
        let path_str = new_file.absolute_path.to_string_lossy().into_owned();
        let detected_at = OffsetDateTime::from(new_file.file_mtime)
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());
        let size_bytes = i64::try_from(new_file.size_bytes).unwrap_or(i64::MAX);
        if let Err(e) = app_core::artifact::detect(
            pool,
            bus,
            project_id,
            &path_str,
            tool_id,
            size_bytes,
            &detected_at,
            &detected_at,
        )
        .await
        {
            tracing::warn!("artifact watcher: reconcile detect failed for {path_str}: {e}");
        }
    }

    Ok(())
}

/// Attach a live filesystem watcher for `project_id`'s output folder
/// (currently `Project.path`; source-view folders are out of scope, see
/// `tool_launch::launch`'s identical v1 simplification).
///
/// Idempotent: attaching an already-attached project is a no-op (guards
/// against duplicate mount effects, e.g. React `StrictMode`).
///
/// Runs an on-attach reconciliation pass (T005) before starting the live
/// watcher so files written while detached are still detected, then emits
/// `artifact.detected`/`artifact.missing` for the reconciliation results
/// exactly as the live watcher would.
///
/// # Errors
/// Returns `Err(String)` if the project cannot be loaded or the watcher
/// cannot be started. An unavailable output folder (e.g. a removed external
/// drive) is NOT an error — it logs and returns `Ok(())` so the caller can
/// retry later (spec 012 edge case).
pub async fn attach_project_watcher(
    pool: &SqlitePool,
    bus: &EventBus,
    registry: &ArtifactWatcherRegistry,
    project_id: &str,
) -> Result<(), String> {
    let mut reg = registry.lock().await;
    if reg.contains_key(project_id) {
        return Ok(());
    }

    let project = persistence_db::repositories::projects::get_project(pool, project_id)
        .await
        .map_err(|e| format!("{e}"))?;

    let project_root = PathBuf::from(&project.path);
    if !project_root.is_dir() {
        tracing::warn!(
            "artifact watcher: project {project_id} output folder unavailable: {}",
            project.path
        );
        return Ok(());
    }

    let tool_id = tool_id_from_project_tool(&project.tool);
    let extensions = app_core::tool_launch::read_watch_extensions(pool, &tool_id).await;
    let ext_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();

    // ── On-attach reconciliation pass (T005) ───────────────────────────────
    run_attach_reconciliation(pool, bus, project_id, &project_root, &tool_id, &ext_refs).await?;

    // ── Start the live per-project watcher ─────────────────────────────────
    let root_utf8 = Utf8PathBuf::from_path_buf(project_root)
        .map_err(|_| format!("project path is not valid UTF-8: {}", project.path))?;

    let (mut rx, guard) = start_artifact_watcher(std::slice::from_ref(&root_utf8), 256)
        .map_err(|e| format!("failed to start artifact watcher: {e}"))?;

    let task_pool = pool.clone();
    let task_bus = bus.clone();
    let task_project_id = project_id.to_owned();
    let task_tool_id = tool_id.clone();
    let task_extensions = extensions.clone();
    let forward_task = tokio::spawn(async move {
        while let Some(evt) = rx.recv().await {
            // Only handle create/modify — removals are handled by the
            // on-attach reconciliation pass, matching the existing T005 design.
            if evt.kind == ArtifactEventKind::Removed {
                continue;
            }

            let file_name = evt.path.file_name().unwrap_or_default();
            let ext_refs: Vec<&str> = task_extensions.iter().map(String::as_str).collect();
            if !workflow_artifacts::extension_allowed(file_name, &ext_refs) {
                continue;
            }

            let path_str = evt.path.as_str().to_owned();
            let now = OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());

            match app_core::artifact::detect(
                &task_pool,
                &task_bus,
                &task_project_id,
                &path_str,
                &task_tool_id,
                0, // size unknown at watch time; the next reconciliation fills it
                &now,
                &now,
            )
            .await
            {
                Ok(_) => {
                    tracing::debug!(
                        "artifact watcher: detected {path_str} (project {task_project_id})"
                    );
                }
                Err(e) => {
                    tracing::debug!("artifact watcher: detect failed for {path_str}: {e}");
                }
            }
        }

        tracing::debug!("artifact watcher: channel closed for project {task_project_id}");
    });

    tracing::info!("artifact watcher: attached for project {project_id} ({})", project.path);
    reg.insert(project_id.to_owned(), ArtifactWatcherEntry { _guard: guard, forward_task });
    Ok(())
}

/// Detach the live filesystem watcher for `project_id`, if attached.
///
/// Idempotent: detaching an unattached (or already-detached) project is a
/// silent no-op.
pub async fn detach_project_watcher(registry: &ArtifactWatcherRegistry, project_id: &str) {
    let mut reg = registry.lock().await;
    if let Some(entry) = reg.remove(project_id) {
        entry.forward_task.abort();
        // Dropping `_guard` here (end of scope) stops the OS watcher.
        tracing::info!("artifact watcher: detached for project {project_id}");
    }
}
