// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Import IPC (spec 071 STO-IMP-FR-01..06/08): saved sources, the templated
//! preview and its choices, import review of the sessions the lights form
//! (merge, re-split, each session's Target and the import's own split
//! limits; LIB-FR-04/24, D-W107, D-W129), Start and Retry, and the import's
//! status.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]).
//! Previews and choices write nothing to any location, and the split preview
//! saves nothing at all. Start approves the preview revision the user saw and
//! runs the import in the background on the host OS Trash; `import_status`
//! reads its durable progress and `import_list` every started import's
//! state and counts. Retry resumes an interrupted import from its recorded
//! journal.

use std::sync::Arc;

use platevault_core::custody::trash::{OsTrash, SystemTrash};
use platevault_core::import::ImportCheck;
use platevault_core::library::Library;
use platevault_core::{
    ImportListEntry, ImportListState, ImportMode, ImportOperation, ImportSession, ImportSourceSpec,
    LocationRole, NamingFrameType, NativePath, SavedSource, SavedSourceView, SplitLimits,
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
#[specta::specta]
pub async fn import_sources_list(library: State<'_, Arc<Library>>) -> Reply<Vec<SavedSourceView>> {
    library.import_sources().await.map_err(fail(None))
}

/// Save a mounted folder under a name for Import new.
///
/// # Errors
/// `InvalidInput` for a blank name or a path that is not a readable folder;
/// `Conflict` when the folder is already saved.
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
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

/// Merge the sessions holding `seqs` (an item of each) into one before the
/// import starts; only sessions that differ in framing alone merge.
///
/// # Errors
/// `InvalidInput` for fewer than two sessions, sessions of different capture
/// keys or an item in no session; `Conflict` for a stale revision.
#[tauri::command]
#[specta::specta]
pub async fn import_merge_sessions(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    expected_revision: u64,
    seqs: Vec<u32>,
) -> Reply<ImportOperation> {
    library.merge_import_sessions(id, expected_revision, &seqs).await.map_err(fail(Some(id)))
}

/// Re-split the merged session holding item `seq` by framing again.
///
/// # Errors
/// `InvalidInput` for a session that was not merged or an item in no
/// session; `Conflict` for a stale revision.
#[tauri::command]
#[specta::specta]
pub async fn import_resplit_session(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    expected_revision: u64,
    seq: u32,
) -> Reply<ImportOperation> {
    library.resplit_import_session(id, expected_revision, seq).await.map_err(fail(Some(id)))
}

/// The sessions the import's lights would form with these centre and
/// rotation limits, for the review's sliders. Saves nothing.
///
/// # Errors
/// `InvalidInput` for limits out of range; `NotFound` for an unknown import.
#[tauri::command]
#[specta::specta]
pub async fn import_split_preview(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    limits: SplitLimits,
) -> Reply<Vec<ImportSession>> {
    library.preview_import_split(id, &limits).await.map_err(fail(Some(id)))
}

/// Give the import its own centre and rotation limits, or (`null`) split it
/// with the Settings default again. Only this import changes.
///
/// # Errors
/// `InvalidInput` for limits out of range; `Conflict` for a stale revision.
#[tauri::command]
#[specta::specta]
pub async fn import_set_split_limits(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    expected_revision: u64,
    limits: Option<SplitLimits>,
) -> Reply<ImportOperation> {
    library.set_import_split_limits(id, expected_revision, limits).await.map_err(fail(Some(id)))
}

/// Choose the Target the session holding item `seq` files under, or
/// Unclassified (`null`), in place of the one its pointing matches.
///
/// # Errors
/// `NotFound` for an unknown Target; `InvalidInput` for an item in no
/// session; `Conflict` for a stale revision.
#[tauri::command]
#[specta::specta]
pub async fn import_choose_target(
    library: State<'_, Arc<Library>>,
    id: Uuid,
    expected_revision: u64,
    seq: u32,
    target_id: Option<Uuid>,
) -> Reply<ImportOperation> {
    library
        .choose_import_target(id, expected_revision, seq, target_id)
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
#[specta::specta]
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
#[specta::specta]
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
#[specta::specta]
pub async fn import_status(library: State<'_, Arc<Library>>, id: Uuid) -> Reply<ImportOperation> {
    library.import_operation(id).await.map_err(fail(Some(id)))
}

/// Every started import in `states`, most recently updated first, with its
/// durable state and summary.
///
/// # Errors
/// `PersistenceFailure` for an unreadable catalog.
#[tauri::command]
#[specta::specta]
pub async fn import_list(
    library: State<'_, Arc<Library>>,
    states: Vec<ImportListState>,
) -> Reply<Vec<ImportListEntry>> {
    library.import_list(&states).await.map_err(fail(None))
}
