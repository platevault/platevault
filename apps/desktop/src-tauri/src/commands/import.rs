// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Import IPC (spec 071 STO-IMP-FR-01..06/08): saved sources, the templated
//! preview and its choices, Start and Retry, and the import's status.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]).
//! Previews and choices write nothing to any location. Start approves the
//! preview revision the user saw and runs the import in the background on the
//! host OS Trash; `import_status` reads its durable progress. Retry resumes an
//! interrupted import from its recorded journal.

use std::sync::Arc;

use platevault_core::custody::trash::{OsTrash, SystemTrash};
use platevault_core::import::ImportCheck;
use platevault_core::library::Library;
use platevault_core::{
    ImportMode, ImportOperation, ImportSourceSpec, LocationRole, NamingFrameType, NativePath,
    SavedSource, SavedSourceView,
};
use tauri::State;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Run or resume an import off the command, logging how it ended.
fn spawn_run(library: &Arc<Library>, id: Uuid) {
    let library = Arc::clone(library);
    tauri::async_runtime::spawn(async move {
        let trash: Arc<dyn OsTrash> = Arc::new(SystemTrash::default());
        match library.run_import(id, trash).await {
            Ok(operation) => tracing::info!(%id, state = ?operation.state, "import run ended"),
            Err(error) => tracing::warn!(%id, "import run failed: {error}"),
        }
    });
}

/// Every saved source with whether its folder is mounted now.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn import_sources_list(library: State<'_, Arc<Library>>) -> Reply<Vec<SavedSourceView>> {
    library.import_sources().await.map_err(fail(None))
}

/// Save a mounted folder under a name for Import new.
///
/// # Errors
/// `InvalidInput` for a blank name or a path that is not a readable folder;
/// `Conflict` when the folder is already saved.
#[tauri::command]
pub async fn import_source_save(
    library: State<'_, Arc<Library>>,
    name: String,
    path: NativePath,
) -> Reply<SavedSource> {
    library.save_import_source(name, path).await.map_err(fail(None))
}

/// Preview an import of a saved source or any mounted folder. Writes nothing.
///
/// # Errors
/// `NotFound` for an unknown saved source; `SourceUnavailable` while the folder
/// is not mounted.
#[tauri::command]
pub async fn import_preview(
    library: State<'_, Arc<Library>>,
    source: ImportSourceSpec,
) -> Reply<ImportOperation> {
    library.preview_import(source, ImportCheck::default()).await.map_err(fail(None))
}

/// Check the source again: settling files, new files, and every route.
///
/// # Errors
/// `Conflict` for a stale revision; `SourceUnavailable` while offline.
#[tauri::command]
pub async fn import_recheck(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    expected_revision: u64,
) -> Reply<ImportOperation> {
    library
        .recheck_import(id, expected_revision, ImportCheck::default())
        .await
        .map_err(fail(Some(id)))
}

/// Set or clear a preview item's frame type.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown item.
#[tauri::command]
pub async fn import_set_type(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    expected_revision: u64,
    seq: u32,
    frame_type: Option<NamingFrameType>,
) -> Reply<ImportOperation> {
    library.set_import_type(id, expected_revision, seq, frame_type).await.map_err(fail(Some(id)))
}

/// Leave a preview item out, or take it back in.
///
/// # Errors
/// `Conflict` for a stale revision; `NotFound` for an unknown item.
#[tauri::command]
pub async fn import_set_excluded(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    expected_revision: u64,
    seq: u32,
    excluded: bool,
) -> Reply<ImportOperation> {
    library.set_import_excluded(id, expected_revision, seq, excluded).await.map_err(fail(Some(id)))
}

/// Choose the location a role's items go to when the role has several.
///
/// # Errors
/// `InvalidInput` for a location of another role or a retired one.
#[tauri::command]
pub async fn import_choose_location(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    expected_revision: u64,
    role: LocationRole,
    location_id: Uuid,
) -> Reply<ImportOperation> {
    library
        .choose_import_location(id, expected_revision, role, location_id)
        .await
        .map_err(fail(Some(id)))
}

/// Approve the shown preview revision with Copy or Move and run it in the
/// background; poll [`import_status`] for progress and outcomes.
///
/// # Errors
/// `Conflict` when the preview changed since it was shown; `InvalidInput`
/// when nothing is Ready or the import already started.
#[tauri::command]
pub async fn import_start(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    expected_revision: u64,
    mode: ImportMode,
) -> Reply<ImportOperation> {
    let started =
        library.start_import(id, expected_revision, mode).await.map_err(fail(Some(id)))?;
    spawn_run(&library, id);
    Ok(started)
}

/// Resume an interrupted import from its recorded journal, in the background.
///
/// # Errors
/// `NotFound` for an unknown import.
#[tauri::command]
pub async fn import_retry(library: State<'_, Arc<Library>>, id: Uuid) -> Reply<ImportOperation> {
    let current = library.import_operation(id).await.map_err(fail(Some(id)))?;
    spawn_run(&library, id);
    Ok(current)
}

/// The import's preview, progress, per-item outcomes and summary.
///
/// # Errors
/// `NotFound` for an unknown import.
#[tauri::command]
pub async fn import_status(library: State<'_, Arc<Library>>, id: Uuid) -> Reply<ImportOperation> {
    library.import_operation(id).await.map_err(fail(Some(id)))
}
