// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review IPC (spec 067 `contracts/frame-review.md`, version 1).
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`])
//! beside the library commands. Each handler forwards to
//! [`platevault_core::frame_review::FrameReview`] and reports failures with the
//! library [`platevault_core::ErrorResponse`] conventions, naming the asset,
//! run or import. No command writes a source file, a preview file or a non-PIX
//! catalog record. Progress is published as `pix_measurement_progress`;
//! `pix_measurement_status` and `pix_review_frames` are the durable truth.

use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{
    ConfirmedImport, CutoutRequest, FrameDetail, FramePreview, FrameStars, FrameState,
    ImportReview, MeasurementProgress, MeasurementRun, NativePath, PreviewTile, RegionsRequest,
    RowResolution, SampleRequest, SampleValue, StarCutouts, Stretch, ThumbnailEntry, TileRequest,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use super::library::{fail, Reply};

/// Settled frames and run state changes; polling `pix_measurement_status` and
/// `pix_review_frames` stays the durable truth.
pub const MEASUREMENT_PROGRESS_EVENT: &str = "pix_measurement_progress";

/// Forwards measurement snapshots to the webview. Each channel event is one
/// settled frame or state change, so all are forwarded; after broadcast lag
/// the Running run's durable status is re-emitted without a frame.
pub fn spawn_measurement_bridge(app: AppHandle, library: &Arc<Library>) {
    let library = Arc::clone(library);
    let mut events = library.frame_review().subscribe_measurement_progress();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(progress) => emit_measurement(&app, &progress),
                Err(RecvError::Lagged(skipped)) => {
                    tracing::warn!(
                        skipped,
                        "measurement progress lagged; re-reading durable status"
                    );
                    match library.frame_review().running_run().await {
                        Ok(Some(run)) => emit_measurement(
                            &app,
                            &MeasurementProgress {
                                operation_id: run.operation_id,
                                revision: run.revision,
                                state: run.state,
                                counters: run.counters,
                                asset_id: None,
                                frame_state: None,
                            },
                        ),
                        Ok(None) => {}
                        Err(error) => tracing::error!(
                            %error,
                            "measurement progress resync failed; clients must poll pix_measurement_status"
                        ),
                    }
                }
                Err(RecvError::Closed) => return,
            }
        }
    });
}

fn emit_measurement(app: &AppHandle, progress: &MeasurementProgress) {
    if let Err(error) = app.emit(MEASUREMENT_PROGRESS_EVENT, progress) {
        tracing::error!(run = %progress.operation_id, %error, "measurement progress event not delivered");
    }
}

/// `pix_review_frames` response: one state per requested asset, in request
/// order, and the Running run if any.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewedFrames {
    pub frames: Vec<FrameState>,
    pub running: Option<MeasurementRun>,
}

/// Frame states from the catalog alone; starts no measurement and reads no
/// source.
///
/// # Errors
/// `NotFound` for an unknown asset; `InvalidInput` for an asset listed twice.
#[tauri::command]
pub async fn pix_review_frames(
    library: State<'_, Arc<Library>>,
    assets: Vec<Uuid>,
) -> Reply<ReviewedFrames> {
    let review = library.frame_review();
    let frames = review.frame_states(&assets).await.map_err(fail(None))?;
    let running = review.running_run().await.map_err(fail(None))?;
    Ok(ReviewedFrames { frames, running })
}

/// Queue the frames without a valid record, `priority` first; frames join a
/// Running run.
///
/// # Errors
/// `InvalidInput` for an empty request or a priority asset outside it;
/// `NotFound` for an unknown asset; `Conflict` while the run is stopping.
#[tauri::command]
pub async fn pix_start_measurement(
    library: State<'_, Arc<Library>>,
    assets: Vec<Uuid>,
    priority: Vec<Uuid>,
) -> Reply<MeasurementRun> {
    library.frame_review().start_measurement(&assets, &priority).await.map_err(fail(None))
}

/// Move queued frames to the head of the run's queue.
///
/// # Errors
/// `NotFound` for an unknown run; `Conflict` when it is not Running.
#[tauri::command]
pub async fn pix_prioritize_measurement(
    library: State<'_, Arc<Library>>,
    operation_id: Uuid,
    assets: Vec<Uuid>,
) -> Reply<MeasurementRun> {
    let review = library.frame_review();
    review.prioritize(operation_id, &assets).await.map_err(fail(Some(operation_id)))
}

/// The durable run: state, counters, issues and revision.
///
/// # Errors
/// `NotFound` for an unknown run.
#[tauri::command]
pub async fn pix_measurement_status(
    library: State<'_, Arc<Library>>,
    operation_id: Uuid,
) -> Reply<MeasurementRun> {
    library.frame_review().measurement_status(operation_id).await.map_err(fail(Some(operation_id)))
}

/// Request cancellation; the run reads Canceled once in-flight frames settle.
///
/// # Errors
/// `NotFound` for an unknown run; `Conflict` when it is not Running.
#[tauri::command]
pub async fn pix_cancel_measurement(
    library: State<'_, Arc<Library>>,
    operation_id: Uuid,
) -> Reply<MeasurementRun> {
    library.frame_review().cancel_measurement(operation_id).await.map_err(fail(Some(operation_id)))
}

/// Runs newest first, including Interrupted runs after a restart.
///
/// # Errors
/// `PersistenceFailure` when the catalog cannot be read.
#[tauri::command]
pub async fn pix_list_measurement_runs(
    library: State<'_, Arc<Library>>,
    offset: u32,
    limit: u32,
) -> Reply<Vec<MeasurementRun>> {
    library.frame_review().list_runs(offset, limit).await.map_err(fail(None))
}

/// Decode the current file after a verified contained read.
///
/// # Errors
/// `SourceUnavailable`, `UnsupportedFormat` naming the feature,
/// `MetadataUnreadable` or `IdentityConflict`.
#[tauri::command]
pub async fn pix_open_frame(
    library: State<'_, Arc<Library>>,
    asset_id: Uuid,
) -> Reply<FramePreview> {
    library.frame_review().open_frame(asset_id).await.map_err(fail(Some(asset_id)))
}

/// One stretched display tile in level coordinates.
///
/// # Errors
/// `InvalidInput` for an invalid tile; `Conflict` when the bytes differ from
/// `sha256`.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // The contract's flat TileRequest fields.
pub async fn pix_preview_tile(
    library: State<'_, Arc<Library>>,
    asset_id: Uuid,
    sha256: String,
    plane: u32,
    level: u8,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    stretch: Stretch,
) -> Reply<PreviewTile> {
    let request = TileRequest { asset_id, sha256, plane, level, x, y, width, height, stretch };
    library.frame_review().preview_tile(&request).await.map_err(fail(Some(asset_id)))
}

/// The center and four corner regions at full resolution.
///
/// # Errors
/// As `pix_preview_tile`.
#[tauri::command]
pub async fn pix_compare_regions(
    library: State<'_, Arc<Library>>,
    asset_id: Uuid,
    sha256: String,
    plane: u32,
    size: u32,
    stretch: Stretch,
) -> Reply<Vec<PreviewTile>> {
    let request = RegionsRequest { asset_id, sha256, plane, size, stretch };
    library.frame_review().compare_regions(&request).await.map_err(fail(Some(asset_id)))
}

/// Up to 64×64 samples as stored, scaled and categorised.
///
/// # Errors
/// As `pix_preview_tile`.
#[tauri::command]
pub async fn pix_sample_region(
    library: State<'_, Arc<Library>>,
    asset_id: Uuid,
    sha256: String,
    plane: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Reply<Vec<SampleValue>> {
    let request = SampleRequest { asset_id, sha256, plane, x, y, width, height };
    library.frame_review().sample_region(&request).await.map_err(fail(Some(asset_id)))
}

/// The stars of the valid record, or the frame state without one.
///
/// # Errors
/// `NotFound` for an unknown asset.
#[tauri::command]
pub async fn pix_frame_stars(
    library: State<'_, Arc<Library>>,
    asset_id: Uuid,
) -> Reply<FrameStars> {
    library.frame_review().frame_stars(asset_id).await.map_err(fail(Some(asset_id)))
}

/// Observed, fitted and residual arrays of one recorded star.
///
/// # Errors
/// `NotFound` for an unknown record or star; `Conflict` when the decoded
/// digest differs from the record's basis.
#[tauri::command]
pub async fn pix_star_cutouts(
    library: State<'_, Arc<Library>>,
    asset_id: Uuid,
    measurement_id: Uuid,
    star: u32,
    sha256: String,
) -> Reply<StarCutouts> {
    let request = CutoutRequest { asset_id, measurement_id, star, sha256 };
    library.frame_review().star_cutouts(&request).await.map_err(fail(Some(asset_id)))
}

/// Disclosure: identity, header evidence, the built-in record and imported
/// values. Read only.
///
/// # Errors
/// `NotFound` for an unknown asset.
#[tauri::command]
pub async fn pix_frame_detail(
    library: State<'_, Arc<Library>>,
    asset_id: Uuid,
) -> Reply<FrameDetail> {
    library.frame_review().frame_detail(asset_id).await.map_err(fail(Some(asset_id)))
}

/// Read a `SubframeSelector` CSV export and store the durable reviewed
/// proposal; attaches no value.
///
/// # Errors
/// Read errors naming the path; `UnsupportedFormat` for a table without Index
/// or File; `InvalidInput` for an invalid scope.
#[tauri::command]
pub async fn pix_review_import(
    library: State<'_, Arc<Library>>,
    path: NativePath,
    scope: Vec<Uuid>,
) -> Reply<ImportReview> {
    library.frame_review().review_import(&path, &scope).await.map_err(fail(None))
}

/// The stored review, reviewed or confirmed.
///
/// # Errors
/// `NotFound` for an unknown review.
#[tauri::command]
pub async fn pix_import_review(
    library: State<'_, Arc<Library>>,
    review_id: Uuid,
) -> Reply<ImportReview> {
    library.frame_review().import_review(review_id).await.map_err(fail(Some(review_id)))
}

/// Confirm a reviewed import once, in one commit.
///
/// # Errors
/// `Conflict` for a confirmed review or a changed attached asset;
/// `InvalidInput` for a resolution outside a row's candidates.
#[tauri::command]
pub async fn pix_confirm_import(
    library: State<'_, Arc<Library>>,
    review_id: Uuid,
    resolutions: Vec<RowResolution>,
) -> Reply<ConfirmedImport> {
    let review = library.frame_review();
    review.confirm_import(review_id, &resolutions).await.map_err(fail(Some(review_id)))
}

/// One thumbnail state per asset in request order. Thumbnails cached for the
/// frame's current bytes come from the catalog without reading the source;
/// others read `pending` while they decode, so clients request again. Starts
/// no measurement and changes no library record.
///
/// # Errors
/// `NotFound` for an unknown asset; `InvalidInput` for an asset listed twice.
#[tauri::command]
pub async fn pix_thumbnails(
    library: State<'_, Arc<Library>>,
    assets: Vec<Uuid>,
) -> Reply<Vec<ThumbnailEntry>> {
    library.frame_review().thumbnails(&assets).await.map_err(fail(None))
}
