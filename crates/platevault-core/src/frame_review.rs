// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review (spec 067): the measurement queue, the memory-only preview
//! cache and `SubframeSelector` import review over the catalog's measurement
//! tables.
//!
//! Sources are read only through `Catalog::open_contained`, which hashes every
//! byte it hands out. Measuring, previewing and importing write measurement
//! rows only: never a source file, a preview file, or an asset, quality,
//! session, association, correction, View or Project record.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard, PoisonError};

use base64::Engine as _;
use persistence_library::{Catalog, ContainedRead, FrameRecordBasis, ImportReviewInput};
use platevault_pixels as px;
use platevault_pixels::display::{self, PlaneStatistics, Region};
use platevault_pixels::measure::{self, FrameMeasurement, Measurement, StarMetrics};
use platevault_pixels::PixelError;
use sha2::{Digest, Sha256};
use tokio::sync::{broadcast, Mutex, Semaphore};
use uuid::Uuid;

use crate::library::{blocking, InventoryProbe};
use crate::subframe_csv;
use crate::{
    reasons, AppliedStretch, Asset, CfaEvidence, CfaSource, ConfirmedImport, CutoutRequest,
    DecodedBasis, FrameDetail, FramePreview, FrameStars, FrameState, ImageFormat, ImportBasis,
    ImportCandidate, ImportFormat, ImportReview, ImportSource, ImportedValue, InputBasis,
    LibraryError, MaskCounts, MeasurementMethod, MeasurementOutcome, MeasurementProgress,
    MeasurementRecord, MeasurementRun, MetricId, MetricValue, NativePath, ObservationFingerprint,
    PlaneBasis, PlanePreview, PlaneSummary, PreviewTile, RecordValidity, RegionsRequest, RowMatch,
    RowResolution, RunIssue, RunState, SampleCategory, SampleFormat, SampleNumber, SampleRequest,
    SampleValue, SaturationBasis, SaturationSource, Scaling, StarCutouts, StarModel, StarReason,
    StarRecord, StarState, StarWarning, StoredNumber, Stretch, StretchKind, TileRequest, Units,
};

/// Decoded-sample budget shared by the measurement workers, in MiB (R14).
const DECODE_BUDGET_MIB: u32 = 1024;
/// Memory cap of decoded frames kept for preview (R15).
const PREVIEW_CACHE_BYTES: usize = 768 << 20;
const PROGRESS_CAPACITY: usize = 256;
const BASE64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
/// Preview decoding is never canceled.
static NEVER: AtomicBool = AtomicBool::new(false);

/// The built-in method this build measures with.
fn method() -> MeasurementMethod {
    MeasurementMethod::new(measure::METHOD.name, measure::METHOD.version)
}

/// Measurement runs, previews, star diagnostics and imports for the
/// library's catalog. Dropping it stops the workers without settling their
/// run, as an exit does; the next open marks that run Interrupted.
pub struct FrameReview {
    shared: Arc<Shared>,
    previews: StdMutex<PreviewCache>,
}

/// State the measurement workers share with the service.
struct Shared {
    catalog: Arc<Catalog>,
    method: MeasurementMethod,
    run: Mutex<Option<ActiveRun>>,
    /// Set by cancel, a failed write or shutdown; decoding and measuring stop
    /// at their next checkpoint.
    abort: AtomicBool,
    shutdown: AtomicBool,
    progress: broadcast::Sender<MeasurementProgress>,
    budget: Semaphore,
    workers: usize,
}

/// The in-memory queue of the catalog's Running run.
struct ActiveRun {
    id: Uuid,
    pending: VecDeque<Queued>,
    /// Every asset the run's queue has held.
    held: HashSet<Uuid>,
    /// The state the run ends in once its workers stop, when not Completed.
    end: Option<RunState>,
    dequeued: u64,
    workers: usize,
}

/// One frame waiting for a worker.
#[derive(Clone, Copy)]
struct Queued {
    asset: Uuid,
    container: Option<px::Container>,
    size_bytes: u64,
}

impl Queued {
    fn of(basis: &FrameRecordBasis) -> Self {
        Self {
            asset: basis.asset.id,
            container: container_of(basis.asset.format),
            size_bytes: basis.asset.fingerprint.size_bytes,
        }
    }
}

impl Drop for FrameReview {
    fn drop(&mut self) {
        self.shared.shutdown.store(true, Ordering::Release);
        self.shared.abort.store(true, Ordering::Release);
    }
}

impl FrameReview {
    #[must_use]
    pub fn new(catalog: Arc<Catalog>) -> Self {
        let (progress, _) = broadcast::channel(PROGRESS_CAPACITY);
        let workers = std::thread::available_parallelism()
            .map_or(1, |cores| cores.get().saturating_sub(1).max(1));
        Self {
            shared: Arc::new(Shared {
                catalog,
                method: method(),
                run: Mutex::new(None),
                abort: AtomicBool::new(false),
                shutdown: AtomicBool::new(false),
                progress,
                budget: Semaphore::new(DECODE_BUDGET_MIB as usize),
                workers,
            }),
            previews: StdMutex::new(PreviewCache::default()),
        }
    }

    /// One state per asset in request order, with built-in and imported
    /// values. A catalog read only: starts no run and reads no source.
    ///
    /// # Errors
    /// `NotFound` for an unknown asset; `InvalidInput` for an asset listed
    /// twice; `PersistenceFailure` for an unreadable catalog.
    pub async fn frame_states(&self, assets: &[Uuid]) -> Result<Vec<FrameState>, LibraryError> {
        self.shared.frame_states(assets).await
    }

    /// The Running run, if any.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn running_run(&self) -> Result<Option<MeasurementRun>, LibraryError> {
        let newest = self.shared.catalog.list_measurement_runs(0, 1).await?;
        Ok(newest.into_iter().find(|run| run.state == RunState::Running))
    }

    /// Queue every asset without a valid record or a current failure, the
    /// `priority` assets first, then request order. While a run is Running
    /// the frames join it and that run is returned.
    ///
    /// # Errors
    /// `InvalidInput` for an empty request, a priority asset outside it or an
    /// asset listed twice; `NotFound` for an unknown asset; `Conflict` while
    /// the Running run is being canceled or failed; `PersistenceFailure`.
    pub async fn start_measurement(
        &self,
        assets: &[Uuid],
        priority: &[Uuid],
    ) -> Result<MeasurementRun, LibraryError> {
        if assets.is_empty() {
            return Err(LibraryError::InvalidInput(
                "a measurement needs at least one asset".into(),
            ));
        }
        let requested: HashSet<Uuid> = assets.iter().copied().collect();
        if let Some(outside) = priority.iter().find(|asset| !requested.contains(asset)) {
            return Err(LibraryError::InvalidInput(format!(
                "priority asset {outside} is not one of the requested assets"
            )));
        }
        let records = self.shared.catalog.frame_records(assets, &self.shared.method).await?;
        let by_id: HashMap<Uuid, &FrameRecordBasis> =
            records.iter().map(|basis| (basis.asset.id, basis)).collect();
        let mut seen = HashSet::new();
        let order: Vec<&FrameRecordBasis> = priority
            .iter()
            .chain(assets)
            .filter(|asset| seen.insert(**asset))
            .map(|asset| by_id[asset])
            .collect();
        let mut guard = self.shared.run.lock().await;
        let run = if let Some(active) = guard.as_mut() {
            self.join(active, &order, priority).await?
        } else {
            let (run, active) = self.begin(&order).await?;
            *guard = Some(active);
            run
        };
        drop(guard);
        self.shared.publish(&run, None, None);
        Ok(run)
    }

    async fn begin(
        &self,
        order: &[&FrameRecordBasis],
    ) -> Result<(MeasurementRun, ActiveRun), LibraryError> {
        let (cached, queue): (Vec<&FrameRecordBasis>, Vec<&FrameRecordBasis>) =
            order.iter().partition(|basis| basis.validity == RecordValidity::Valid);
        let ids: Vec<Uuid> = queue.iter().map(|basis| basis.asset.id).collect();
        let run = self
            .shared
            .catalog
            .begin_measurement_run(&self.shared.method, &ids, cached.len() as u64)
            .await?;
        self.shared.abort.store(false, Ordering::Release);
        let mut active = ActiveRun {
            id: run.operation_id,
            pending: queue.iter().map(|basis| Queued::of(basis)).collect(),
            held: ids.into_iter().collect(),
            end: None,
            dequeued: 0,
            workers: 0,
        };
        // One worker settles an empty run.
        self.spawn_workers(&mut active, 1);
        Ok((run, active))
    }

    async fn join(
        &self,
        active: &mut ActiveRun,
        order: &[&FrameRecordBasis],
        priority: &[Uuid],
    ) -> Result<MeasurementRun, LibraryError> {
        let catalog = &self.shared.catalog;
        if active.end.is_some() {
            return Err(run_conflict(&catalog.measurement_run(active.id).await?));
        }
        // A frame this run already measured is counted by it once.
        let cached = order
            .iter()
            .filter(|basis| {
                basis.validity == RecordValidity::Valid
                    && basis.record.as_ref().is_some_and(|record| record.run_id != active.id)
            })
            .count() as u64;
        let fresh: Vec<Queued> = order
            .iter()
            .filter(|basis| {
                basis.validity != RecordValidity::Valid && !active.held.contains(&basis.asset.id)
            })
            .map(|basis| Queued::of(basis))
            .collect();
        let ids: Vec<Uuid> = fresh.iter().map(|queued| queued.asset).collect();
        let run = catalog.extend_measurement_run(active.id, &ids, cached).await?;
        active.held.extend(ids);
        active.pending.extend(fresh);
        move_to_head(&mut active.pending, priority);
        self.spawn_workers(active, 0);
        Ok(run)
    }

    /// Bring the run's workers up to the pool size for its pending frames,
    /// and to at least `minimum`.
    fn spawn_workers(&self, active: &mut ActiveRun, minimum: usize) {
        let wanted = self.shared.workers.min(active.pending.len()).max(minimum);
        while active.workers < wanted {
            active.workers += 1;
            tokio::spawn(worker(Arc::clone(&self.shared), active.id));
        }
    }

    /// Move those of `assets` still queued in `run` to the head of its queue,
    /// in the order given. Settled and in-flight frames are unaffected.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; `Conflict` when it is not Running;
    /// `PersistenceFailure`.
    pub async fn prioritize(
        &self,
        run: Uuid,
        assets: &[Uuid],
    ) -> Result<MeasurementRun, LibraryError> {
        let mut guard = self.shared.run.lock().await;
        let active = guard.as_mut().filter(|active| active.id == run);
        let held = active.map(|active| move_to_head(&mut active.pending, assets)).is_some();
        drop(guard);
        let status = self.shared.catalog.measurement_run(run).await?;
        if held {
            Ok(status)
        } else {
            Err(run_conflict(&status))
        }
    }

    /// Stop dequeuing and abandon in-flight frames at their next checkpoint;
    /// the run reads Canceled once they settle. Committed records stay.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; `Conflict` when it is not Running;
    /// `PersistenceFailure`.
    pub async fn cancel_measurement(&self, run: Uuid) -> Result<MeasurementRun, LibraryError> {
        let mut guard = self.shared.run.lock().await;
        let held = match guard.as_mut().filter(|active| active.id == run) {
            Some(active) => {
                active.end.get_or_insert(RunState::Canceled);
                self.shared.abort.store(true, Ordering::Release);
                true
            }
            None => false,
        };
        drop(guard);
        let status = self.shared.catalog.measurement_run(run).await?;
        if !held {
            return Err(run_conflict(&status));
        }
        self.shared.publish(&status, None, None);
        Ok(status)
    }

    /// The durable run: state, counters, issues and revision.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; `PersistenceFailure`.
    pub async fn measurement_status(&self, run: Uuid) -> Result<MeasurementRun, LibraryError> {
        self.shared.catalog.measurement_run(run).await
    }

    /// Runs newest first, including Interrupted runs after a restart.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn list_runs(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<MeasurementRun>, LibraryError> {
        self.shared.catalog.list_measurement_runs(offset, limit).await
    }

    /// Snapshots of settled frames and run state changes. Events can be lost;
    /// `measurement_status` and `frame_states` are the durable truth.
    #[must_use]
    pub fn subscribe_measurement_progress(&self) -> broadcast::Receiver<MeasurementProgress> {
        self.shared.progress.subscribe()
    }

    /// Decode the current file through a verified contained read, off the
    /// async threads and never behind measurement.
    ///
    /// # Errors
    /// `SourceUnavailable` for an unavailable asset; `UnsupportedFormat`
    /// naming the feature; `MetadataUnreadable` for malformed pixel data;
    /// `IdentityConflict` for a source that changed while being read.
    pub async fn open_frame(&self, asset: Uuid) -> Result<FramePreview, LibraryError> {
        let decoded = self.read_frame(asset).await?;
        let basis = self.shared.record_basis(asset).await?;
        let matches_record =
            valid_record(&basis).and_then(|record| record.basis.sha256()) == Some(&decoded.sha256);
        Ok(decoded.preview(matches_record))
    }

    /// Render one stretched tile of a decoded plane. Memory-only: the source
    /// and every record are unchanged.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid request or a region outside the plane;
    /// `Conflict` when the current bytes differ from `request.sha256`; the
    /// errors of [`Self::open_frame`].
    pub async fn preview_tile(&self, request: &TileRequest) -> Result<PreviewTile, LibraryError> {
        request.validate()?;
        let decoded = self.decoded(request.asset_id, &request.sha256).await?;
        let region =
            Region { x: request.x, y: request.y, width: request.width, height: request.height };
        let (plane, level, stretch) =
            (request.plane, request.level, pixel_stretch(request.stretch));
        blocking(move || decoded.render(plane, region, level, &stretch)).await
    }

    /// Five full-resolution tiles: center, top-left, top-right, bottom-left
    /// and bottom-right, `size` clamped to the frame.
    ///
    /// # Errors
    /// As [`Self::preview_tile`].
    pub async fn compare_regions(
        &self,
        request: &RegionsRequest,
    ) -> Result<Vec<PreviewTile>, LibraryError> {
        request.validate()?;
        let decoded = self.decoded(request.asset_id, &request.sha256).await?;
        let (plane, size, stretch) = (request.plane, request.size, pixel_stretch(request.stretch));
        blocking(move || {
            let (samples, _) = decoded.plane(plane)?;
            display::comparison_regions(samples.width, samples.height, size)
                .into_iter()
                .map(|region| decoded.render(plane, region, 0, &stretch))
                .collect()
        })
        .await
    }

    /// Up to 64×64 samples as stored, scaled and categorised; masked samples
    /// are never replaced.
    ///
    /// # Errors
    /// As [`Self::preview_tile`].
    pub async fn sample_region(
        &self,
        request: &SampleRequest,
    ) -> Result<Vec<SampleValue>, LibraryError> {
        request.validate()?;
        let decoded = self.decoded(request.asset_id, &request.sha256).await?;
        let (plane, _) = decoded.plane(request.plane)?;
        let region =
            Region { x: request.x, y: request.y, width: request.width, height: request.height };
        let samples = display::sample_region(plane, region).map_err(pixel_error)?;
        let coordinates = (region.y..region.y + region.height)
            .flat_map(|y| (region.x..region.x + region.width).map(move |x| (x, y)));
        Ok(coordinates
            .zip(samples)
            .map(|((x, y), sample)| SampleValue {
                x,
                y,
                stored: stored_number(sample.stored),
                value: sample.value,
                category: sample_category(sample.category),
            })
            .collect())
    }

    /// The stars of the valid record, or none with the frame's state.
    ///
    /// # Errors
    /// `NotFound` for an unknown asset; `PersistenceFailure`.
    pub async fn frame_stars(&self, asset: Uuid) -> Result<FrameStars, LibraryError> {
        let (basis, imported) = self.shared.record_and_imports(asset).await?;
        let stars = match valid_record(&basis).map(|record| &record.outcome) {
            Some(MeasurementOutcome::Measured { stars, .. }) => stars.clone(),
            _ => Vec::new(),
        };
        let state = state_of(&basis, imported);
        Ok(FrameStars { asset_id: asset, measurement_id: state.measurement_id, state, stars })
    }

    /// Observed, fitted and residual arrays of one recorded star's box, from
    /// the bytes the record was measured on; observed only for a star without
    /// a fit.
    ///
    /// # Errors
    /// `NotFound` for an unknown record or star; `InvalidInput` for a record
    /// of another asset or without stars; `Conflict` when the decoded digest
    /// differs from `request.sha256` or from the record's basis.
    pub async fn star_cutouts(&self, request: &CutoutRequest) -> Result<StarCutouts, LibraryError> {
        let record = self.shared.catalog.measurement(request.measurement_id).await?;
        if record.asset_id != request.asset_id {
            return Err(LibraryError::InvalidInput(format!(
                "measurement {} belongs to asset {}, not {}",
                record.id, record.asset_id, request.asset_id
            )));
        }
        let MeasurementOutcome::Measured { stars, .. } = &record.outcome else {
            return Err(LibraryError::InvalidInput(format!(
                "measurement {} failed and has no stars",
                record.id
            )));
        };
        let star = stars.iter().find(|star| star.index == request.star).ok_or_else(|| {
            LibraryError::NotFound(format!("star {} of measurement {}", request.star, record.id))
        })?;
        let decoded = self.decoded(request.asset_id, &request.sha256).await?;
        if record.basis.sha256() != Some(&decoded.sha256) {
            return Err(changed(&decoded.asset));
        }
        let (plane, _) = decoded.plane(0)?;
        let cutouts = measure::cutouts(plane, &pixel_star(star));
        Ok(StarCutouts {
            asset_id: request.asset_id,
            measurement_id: record.id,
            star: request.star,
            x: cutouts.x,
            y: cutouts.y,
            width: cutouts.width,
            height: cutouts.height,
            observed: cutouts.observed.into_iter().map(SampleNumber).collect(),
            fitted: cutouts.fitted,
            residual: cutouts.residual.map(|values| values.into_iter().map(SampleNumber).collect()),
        })
    }

    /// Disclosure of one frame: the asset with its header evidence and
    /// fingerprint, its state, the valid built-in record and every imported
    /// value. Read only.
    ///
    /// # Errors
    /// `NotFound` for an unknown asset; `PersistenceFailure`.
    pub async fn frame_detail(&self, asset: Uuid) -> Result<FrameDetail, LibraryError> {
        let (basis, imported) = self.shared.record_and_imports(asset).await?;
        let record = valid_record(&basis).cloned();
        let state = state_of(&basis, imported.clone());
        Ok(FrameDetail { asset: basis.asset, state, record, imported })
    }

    /// Read a `SubframeSelector` CSV export, classify and match it against
    /// `scope`, record the import basis of every attached or candidate asset
    /// and store the durable `reviewed` proposal. Attaches no value.
    ///
    /// # Errors
    /// Read errors naming the path; `InvalidInput` for a file over the size
    /// limit; `UnsupportedFormat` for a table without Index or File; the
    /// catalog's review validation errors.
    pub async fn review_import(
        &self,
        path: &NativePath,
        scope: &[Uuid],
    ) -> Result<ImportReview, LibraryError> {
        let file = path.to_path_buf()?;
        let (bytes, sha256) = blocking(move || read_export(&file)).await?;
        let export = subframe_csv::parse(&bytes)?;
        let candidates = self.shared.catalog.import_candidates(scope).await?;
        let mut rows = subframe_csv::match_rows(&export, &candidates);
        let needed: BTreeSet<Uuid> = rows
            .iter()
            .flat_map(|row| {
                let candidates = if row.match_state == RowMatch::Ambiguous {
                    row.candidates.as_slice()
                } else {
                    &[]
                };
                row.asset_id.into_iter().chain(candidates.iter().copied())
            })
            .collect();
        let mut bases = BTreeMap::new();
        for candidate in candidates.iter().filter(|candidate| needed.contains(&candidate.asset_id))
        {
            let sha256 = match &candidate.sha256 {
                Some(sha256) => Some(sha256.clone()),
                None => self.hash(candidate).await,
            };
            bases.insert(
                candidate.asset_id,
                ImportBasis { fingerprint: candidate.fingerprint.clone(), sha256 },
            );
        }
        for row in &mut rows {
            if let Some(asset) = row.asset_id {
                row.basis = bases.get(&asset).cloned();
            }
        }
        let review = ImportReviewInput {
            format: ImportFormat::SubframeSelectorCsv,
            source: ImportSource { path: path.clone(), size_bytes: bytes.len() as u64, sha256 },
            module_version: export.module_version,
            psf_type: export.psf_type,
            preamble: export.preamble,
            layout: export.layout,
            scope: scope.to_vec(),
            columns: export.columns,
            rows,
            bases,
        };
        self.shared.catalog.create_import_review(&review).await
    }

    /// The SHA-256 of a candidate's current bytes when they are still the
    /// recorded observation; `None` for an unavailable or changed file.
    async fn hash(&self, candidate: &ImportCandidate) -> Option<String> {
        let read = self
            .shared
            .catalog
            .open_contained(candidate.asset_id, InventoryProbe, |_| Ok(()))
            .await
            .ok()?;
        let mut recorded = candidate.fingerprint.clone();
        recorded.content_sha256.clone_from(&read.fingerprint.content_sha256);
        read.fingerprint.equivalent(&recorded).then_some(read.sha256)
    }

    /// The stored review, reviewed or confirmed.
    ///
    /// # Errors
    /// `NotFound` for an unknown review; `PersistenceFailure`.
    pub async fn import_review(&self, id: Uuid) -> Result<ImportReview, LibraryError> {
        self.shared.catalog.import_review(id).await
    }

    /// Confirm a reviewed import once, resolving ambiguous rows to listed
    /// candidates, in one commit.
    ///
    /// # Errors
    /// `Conflict` for a confirmed review or an attached asset changed since
    /// review; `InvalidInput` for a resolution outside a row's candidates;
    /// `NotFound`; `PersistenceFailure`. Nothing is written on refusal.
    pub async fn confirm_import(
        &self,
        id: Uuid,
        resolutions: &[RowResolution],
    ) -> Result<ConfirmedImport, LibraryError> {
        self.shared.catalog.confirm_import(id, resolutions).await
    }

    fn cache(&self) -> MutexGuard<'_, PreviewCache> {
        self.previews.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Decode the asset's current file and keep it for preview.
    async fn read_frame(&self, asset_id: Uuid) -> Result<Arc<Decoded>, LibraryError> {
        let asset = self.shared.catalog.asset(asset_id).await?;
        let container = container_of(asset.format).ok_or_else(|| {
            LibraryError::UnsupportedFormat(format!("asset {asset_id} is not FITS or XISF"))
        })?;
        let read = self
            .shared
            .catalog
            .open_contained(asset_id, InventoryProbe, move |reader| {
                px::decode::decode(container, reader, &NEVER).map_err(pixel_error)
            })
            .await?;
        let decoded = Arc::new(blocking(move || Decoded::new(read)).await?);
        self.cache().insert(Arc::clone(&decoded));
        Ok(decoded)
    }

    /// The decoded frame with digest `sha256`, from the cache or a new read.
    async fn decoded(&self, asset: Uuid, sha256: &str) -> Result<Arc<Decoded>, LibraryError> {
        if let Some(decoded) = self.cache().get(asset, sha256) {
            return Ok(decoded);
        }
        let decoded = self.read_frame(asset).await?;
        if decoded.sha256 == sha256 {
            Ok(decoded)
        } else {
            Err(changed(&decoded.asset))
        }
    }
}

impl Shared {
    async fn frame_states(&self, assets: &[Uuid]) -> Result<Vec<FrameState>, LibraryError> {
        let records = self.catalog.frame_records(assets, &self.method).await?;
        let mut imported = self.imported(assets).await?;
        Ok(records
            .iter()
            .map(|basis| state_of(basis, imported.remove(&basis.asset.id).unwrap_or_default()))
            .collect())
    }

    async fn imported(
        &self,
        assets: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<ImportedValue>>, LibraryError> {
        let mut grouped: HashMap<Uuid, Vec<ImportedValue>> = HashMap::new();
        for value in self.catalog.imported_values(assets).await? {
            grouped.entry(value.asset_id).or_default().push(value);
        }
        Ok(grouped)
    }

    async fn record_basis(&self, asset: Uuid) -> Result<FrameRecordBasis, LibraryError> {
        self.catalog
            .frame_records(&[asset], &self.method)
            .await?
            .pop()
            .ok_or_else(|| LibraryError::NotFound(format!("asset {asset}")))
    }

    async fn record_and_imports(
        &self,
        asset: Uuid,
    ) -> Result<(FrameRecordBasis, Vec<ImportedValue>), LibraryError> {
        let basis = self.record_basis(asset).await?;
        let imported = self.catalog.imported_values(&[asset]).await?;
        Ok((basis, imported))
    }

    fn publish(
        &self,
        run: &MeasurementRun,
        asset_id: Option<Uuid>,
        frame_state: Option<FrameState>,
    ) {
        // No subscriber is not an error: polling is the durable truth.
        let _ = self.progress.send(MeasurementProgress {
            operation_id: run.operation_id,
            revision: run.revision,
            state: run.state,
            counters: run.counters,
            asset_id,
            frame_state,
        });
    }

    fn stopping(&self) -> bool {
        self.abort.load(Ordering::Acquire)
    }

    /// The next queued frame with its dequeue sequence. A worker without one
    /// leaves; the last one settles the run.
    async fn next_frame(&self, run: Uuid) -> Option<(Queued, u64)> {
        let mut guard = self.run.lock().await;
        let active = guard.as_mut().filter(|active| active.id == run)?;
        if self.shutdown.load(Ordering::Acquire) {
            return None;
        }
        if active.end.is_none() {
            if let Some(queued) = active.pending.pop_front() {
                active.dequeued += 1;
                return Some((queued, active.dequeued));
            }
        }
        active.workers -= 1;
        if active.workers > 0 {
            return None;
        }
        let state = active.end.unwrap_or(RunState::Completed);
        let finished = match self.catalog.finish_measurement_run(run, state).await {
            Err(_) if state != RunState::Failed => {
                self.catalog.finish_measurement_run(run, RunState::Failed).await
            }
            finished => finished,
        };
        *guard = None;
        drop(guard);
        // A run whose finish could not be written stays Running in the
        // catalog until the next open marks it Interrupted.
        if let Ok(finished) = finished {
            self.publish(&finished, None, None);
        }
        None
    }

    /// Measure one frame and settle it with its record, or with an issue for
    /// a source that could not be read. Abandons the frame without a write
    /// once the run is stopping.
    async fn settle(
        self: &Arc<Self>,
        run: Uuid,
        queued: Queued,
        sequence: u64,
    ) -> Result<(), LibraryError> {
        let permits = u32::try_from(queued.size_bytes.div_ceil(1 << 20))
            .unwrap_or(DECODE_BUDGET_MIB)
            .clamp(1, DECODE_BUDGET_MIB);
        let budget = self.budget.acquire_many(permits).await.map_err(|_| LibraryError::Canceled)?;
        let measured = self.measure(queued).await;
        drop(budget);
        if self.stopping() {
            return Ok(());
        }
        let settled = match measured {
            Ok((basis, outcome)) => {
                let record = MeasurementRecord {
                    id: Uuid::new_v4(),
                    asset_id: queued.asset,
                    run_id: run,
                    method: self.method.clone(),
                    dequeue_sequence: sequence,
                    basis,
                    outcome,
                    measured_at: now()?,
                };
                self.catalog.record_measurement(run, &record).await?
            }
            Err(error) => {
                let issue = RunIssue {
                    asset_id: queued.asset,
                    kind: error.response(None, None).kind,
                    message: error.to_string(),
                };
                self.catalog.record_run_issue(run, &issue).await?
            }
        };
        let state =
            self.frame_states(&[queued.asset]).await.ok().and_then(|mut states| states.pop());
        self.publish(&settled, Some(queued.asset), state);
        Ok(())
    }

    /// Decode through a contained read and measure. An unsupported or
    /// malformed encoding is the method's failed outcome for these bytes.
    async fn measure(
        self: &Arc<Self>,
        queued: Queued,
    ) -> Result<(InputBasis, MeasurementOutcome), LibraryError> {
        let shared = Arc::clone(self);
        let read = self
            .catalog
            .open_contained(queued.asset, InventoryProbe, move |reader| {
                let Some(container) = queued.container else {
                    return Ok(Err(PixelError::Unsupported(
                        "an image format other than FITS or XISF".into(),
                    )));
                };
                match px::decode::decode(container, reader, &shared.abort) {
                    Ok(image) => Ok(Ok(image)),
                    Err(error @ (PixelError::Unsupported(_) | PixelError::Malformed(_))) => {
                        Ok(Err(error))
                    }
                    Err(error) => Err(pixel_error(error)),
                }
            })
            .await?;
        let container = format_of(queued.container);
        let image = match read.value {
            Ok(image) => image,
            Err(error) => {
                let basis = InputBasis { fingerprint: read.fingerprint, container, decoded: None };
                return Ok((basis, failed_outcome(&error)));
            }
        };
        let decoded = decoded_basis(&image)?;
        let basis = InputBasis { fingerprint: read.fingerprint, container, decoded: Some(decoded) };
        let shared = Arc::clone(self);
        let measurement =
            blocking(move || measure::measure(&image, &shared.abort).map_err(pixel_error)).await?;
        Ok((basis, outcome(measurement, &self.method)))
    }

    /// Mark the run Failed after a catalog write failed and stop its workers.
    async fn fail(&self, run: Uuid) {
        let mut guard = self.run.lock().await;
        if let Some(active) = guard.as_mut().filter(|active| active.id == run) {
            active.end = Some(RunState::Failed);
        }
        drop(guard);
        self.abort.store(true, Ordering::Release);
    }
}

/// A measurement worker: dequeue, measure and settle until the queue is
/// empty or the run stops.
async fn worker(shared: Arc<Shared>, run: Uuid) {
    while let Some((queued, sequence)) = shared.next_frame(run).await {
        if shared.settle(run, queued, sequence).await.is_err() && !shared.stopping() {
            shared.fail(run).await;
        }
    }
}

fn move_to_head(pending: &mut VecDeque<Queued>, assets: &[Uuid]) {
    let mut head = Vec::new();
    for asset in assets {
        if let Some(at) = pending.iter().position(|queued| queued.asset == *asset) {
            head.extend(pending.remove(at));
        }
    }
    for queued in head.into_iter().rev() {
        pending.push_front(queued);
    }
}

fn run_conflict(run: &MeasurementRun) -> LibraryError {
    LibraryError::Conflict { id: run.operation_id, current: run.revision, successors: Vec::new() }
}

/// The bytes differ from the digest the caller or the record names; the
/// caller reopens the frame.
fn changed(asset: &Asset) -> LibraryError {
    LibraryError::Conflict {
        id: asset.id,
        current: asset.observation_revision,
        successors: Vec::new(),
    }
}

fn valid_record(basis: &FrameRecordBasis) -> Option<&MeasurementRecord> {
    basis.record.as_ref().filter(|_| basis.validity == RecordValidity::Valid)
}

fn state_of(basis: &FrameRecordBasis, imported: Vec<ImportedValue>) -> FrameState {
    FrameState::derive(&basis.asset, basis.record.as_ref(), basis.validity, basis.queued, imported)
}

fn now() -> Result<String, LibraryError> {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| LibraryError::PersistenceFailure(error.to_string()))
}

/// Read a CSV export read-only, bounded by the parser's size limit.
fn read_export(path: &Path) -> Result<(Vec<u8>, String), LibraryError> {
    let io = |error: std::io::Error| LibraryError::from_io(path, &error);
    let file = std::fs::File::open(path).map_err(io)?;
    if !file.metadata().map_err(io)?.is_file() {
        return Err(LibraryError::InvalidInput(format!("{} is not a file", path.display())));
    }
    let limit = subframe_csv::MAX_EXPORT_BYTES;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes).map_err(io)?;
    if bytes.len() > limit {
        return Err(LibraryError::InvalidInput(format!(
            "{} is larger than the {limit}-byte export limit",
            path.display()
        )));
    }
    let sha256 = hex::encode(Sha256::digest(&bytes));
    Ok((bytes, sha256))
}

// ---------------------------------------------------------------------------
// Preview cache
// ---------------------------------------------------------------------------

/// A decoded frame with the statistics and mask counts of every plane.
struct Decoded {
    asset: Asset,
    sha256: String,
    fingerprint: ObservationFingerprint,
    image: px::DecodedImage,
    statistics: Vec<(PlaneStatistics, px::MaskCounts)>,
    bytes: usize,
}

impl Decoded {
    fn new(read: ContainedRead<px::DecodedImage>) -> Result<Self, LibraryError> {
        let ContainedRead { value: image, asset, sha256, fingerprint } = read;
        if image.planes.is_empty() {
            return Err(LibraryError::MetadataUnreadable("the image has no plane".into()));
        }
        let statistics = image
            .planes
            .iter()
            .map(|plane| (display::statistics(plane), plane.mask_counts()))
            .collect();
        let bytes = image
            .planes
            .iter()
            .map(|plane| plane.samples.len() * plane.samples.format().bytes())
            .sum();
        Ok(Self { asset, sha256, fingerprint, image, statistics, bytes })
    }

    fn plane(&self, index: u32) -> Result<(&px::Plane, &PlaneStatistics), LibraryError> {
        let at = index as usize;
        match (self.image.planes.get(at), self.statistics.get(at)) {
            (Some(plane), Some((statistics, _))) => Ok((plane, statistics)),
            _ => Err(LibraryError::InvalidInput(format!(
                "plane {index} outside the frame's {} planes",
                self.image.planes.len()
            ))),
        }
    }

    fn render(
        &self,
        plane: u32,
        region: Region,
        level: u8,
        stretch: &display::Stretch,
    ) -> Result<PreviewTile, LibraryError> {
        let (samples, statistics) = self.plane(plane)?;
        let tile = display::render_tile(samples, statistics, region, level, stretch)
            .map_err(pixel_error)?;
        Ok(PreviewTile {
            plane,
            level: tile.level,
            x: tile.region.x,
            y: tile.region.y,
            width: tile.region.width,
            height: tile.region.height,
            applied_stretch: applied_stretch(tile.applied),
            gray: BASE64.encode(&tile.gray),
            mask: tile.mask.map(|mask| BASE64.encode(mask)),
        })
    }

    fn preview(&self, matches_record: bool) -> FramePreview {
        let first = &self.image.planes[0];
        let planes = self
            .image
            .planes
            .iter()
            .zip(&self.statistics)
            .enumerate()
            .map(|(index, (plane, (statistics, masks)))| PlanePreview {
                index: u32::try_from(index).unwrap_or(u32::MAX),
                basis: plane_basis(&plane.kind),
                masks: mask_counts(*masks),
                statistics: PlaneSummary {
                    valid: statistics.valid,
                    min: statistics.min,
                    max: statistics.max,
                    median: statistics.median,
                    mad: statistics.mad,
                },
            })
            .collect();
        FramePreview {
            asset_id: self.asset.id,
            sha256: self.sha256.clone(),
            fingerprint: self.fingerprint.clone(),
            container: self.asset.format,
            width: first.width,
            height: first.height,
            sample_format: sample_format(self.image.evidence.sample_format),
            scaling: scaling(first.scaling),
            blank: first.blank,
            saturation: saturation(first.saturation),
            planes,
            matches_record,
        }
    }
}

/// Decoded frames by recency, the latest bytes of each asset only, within
/// `PREVIEW_CACHE_BYTES`.
#[derive(Default)]
struct PreviewCache {
    entries: VecDeque<Arc<Decoded>>,
}

impl PreviewCache {
    fn get(&mut self, asset: Uuid, sha256: &str) -> Option<Arc<Decoded>> {
        let at = self
            .entries
            .iter()
            .position(|entry| entry.asset.id == asset && entry.sha256 == sha256)?;
        let entry = self.entries.remove(at)?;
        self.entries.push_back(Arc::clone(&entry));
        Some(entry)
    }

    fn insert(&mut self, decoded: Arc<Decoded>) {
        self.entries.retain(|entry| entry.asset.id != decoded.asset.id);
        self.entries.push_back(decoded);
        let mut bytes: usize = self.entries.iter().map(|entry| entry.bytes).sum();
        while bytes > PREVIEW_CACHE_BYTES && self.entries.len() > 1 {
            if let Some(evicted) = self.entries.pop_front() {
                bytes -= evicted.bytes;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Pixel crate to wire model
// ---------------------------------------------------------------------------

fn pixel_error(error: PixelError) -> LibraryError {
    match error {
        PixelError::Unsupported(feature) => LibraryError::UnsupportedFormat(feature),
        PixelError::Malformed(structure) => LibraryError::MetadataUnreadable(structure),
        PixelError::Io(error) => LibraryError::SourceUnavailable(error.to_string()),
        PixelError::InvalidRegion(region) => LibraryError::InvalidInput(region),
        PixelError::Canceled => LibraryError::Canceled,
    }
}

fn failed_outcome(error: &PixelError) -> MeasurementOutcome {
    let reason = match error {
        PixelError::Unsupported(_) => reasons::UNSUPPORTED_FORMAT,
        _ => reasons::MALFORMED_DATA,
    };
    MeasurementOutcome::Failed { reason: reason.to_owned(), message: error.to_string() }
}

const fn container_of(format: ImageFormat) -> Option<px::Container> {
    match format {
        ImageFormat::Fits => Some(px::Container::Fits),
        ImageFormat::Xisf => Some(px::Container::Xisf),
        ImageFormat::Unsupported => None,
    }
}

const fn format_of(container: Option<px::Container>) -> ImageFormat {
    match container {
        Some(px::Container::Fits) => ImageFormat::Fits,
        Some(px::Container::Xisf) => ImageFormat::Xisf,
        None => ImageFormat::Unsupported,
    }
}

const fn sample_format(format: px::SampleFormat) -> SampleFormat {
    match format {
        px::SampleFormat::U8 => SampleFormat::Uint8,
        px::SampleFormat::I16 => SampleFormat::Int16,
        px::SampleFormat::U16 => SampleFormat::Uint16,
        px::SampleFormat::I32 => SampleFormat::Int32,
        px::SampleFormat::U32 => SampleFormat::Uint32,
        px::SampleFormat::I64 => SampleFormat::Int64,
        px::SampleFormat::F32 => SampleFormat::Float32,
        px::SampleFormat::F64 => SampleFormat::Float64,
    }
}

const fn scaling(scaling: px::Scaling) -> Scaling {
    Scaling { zero: scaling.zero, scale: scaling.scale }
}

const fn saturation(saturation: px::Saturation) -> SaturationBasis {
    let source = match saturation.source {
        px::SaturationSource::SaturateKeyword => SaturationSource::SaturateKeyword,
        px::SaturationSource::XisfBounds => SaturationSource::XisfBounds,
        px::SaturationSource::TypeMaximum => SaturationSource::TypeMaximum,
        px::SaturationSource::Unknown => SaturationSource::Unknown,
    };
    SaturationBasis { level: saturation.level, source }
}

const fn mask_counts(masks: px::MaskCounts) -> MaskCounts {
    MaskCounts {
        nan: masks.nan,
        pos_inf: masks.pos_inf,
        neg_inf: masks.neg_inf,
        blank: masks.blank,
        saturated: masks.saturated,
    }
}

fn plane_basis(kind: &px::PlaneKind) -> PlaneBasis {
    match kind {
        px::PlaneKind::Mono => PlaneBasis::Mono,
        px::PlaneKind::CfaMosaic(evidence) => PlaneBasis::CfaMosaic(CfaEvidence {
            pattern: evidence.pattern.clone(),
            x_offset: evidence.x_offset,
            y_offset: evidence.y_offset,
            row_order: evidence.row_order.clone(),
            source: match evidence.source {
                px::CfaSource::BayerpatKeyword => CfaSource::BayerpatKeyword,
                px::CfaSource::ColorFilterArray => CfaSource::ColorFilterArray,
            },
        }),
        px::PlaneKind::Channel { index, count, color_space } => {
            PlaneBasis::Channel { index: *index, count: *count, color_space: color_space.clone() }
        }
    }
}

/// The measured plane; for a multi-channel refusal, the first channel.
fn decoded_basis(image: &px::DecodedImage) -> Result<DecodedBasis, LibraryError> {
    let plane = image
        .planes
        .first()
        .ok_or_else(|| LibraryError::MetadataUnreadable("the image has no plane".into()))?;
    Ok(DecodedBasis {
        plane: plane_basis(&plane.kind),
        plane_count: u32::try_from(image.planes.len()).unwrap_or(u32::MAX),
        sample_format: sample_format(image.evidence.sample_format),
        scaling: scaling(plane.scaling),
        blank: plane.blank,
        width: plane.width,
        height: plane.height,
        saturation: saturation(plane.saturation),
    })
}

const fn plane_units(units: measure::PlaneUnits) -> Units {
    match units {
        measure::PlaneUnits::Dn => Units::Dn,
        measure::PlaneUnits::Normalized => Units::Normalized,
        measure::PlaneUnits::DataUnit => Units::DataUnit,
    }
}

fn outcome(measurement: Measurement, method: &MeasurementMethod) -> MeasurementOutcome {
    match measurement {
        Measurement::Failed { reason, message } => {
            MeasurementOutcome::Failed { reason: reason.to_owned(), message }
        }
        Measurement::Measured(frame) => MeasurementOutcome::Measured {
            metrics: metrics(&frame, method),
            stars: frame.stars.iter().map(star_record).collect(),
            masks: mask_counts(frame.masks),
            truncated: frame.truncated,
        },
    }
}

/// The seven frame metrics, each measured or unavailable with its reason.
#[allow(clippy::cast_precision_loss)] // Star counts stay far below 2^53.
fn metrics(frame: &FrameMeasurement, method: &MeasurementMethod) -> Vec<MetricValue> {
    let metric = |id, units, value: Option<f64>, reason: &str| match value {
        Some(value) => MetricValue::measured(id, units, value, method),
        None => MetricValue::unavailable(id, units, reason, method),
    };
    let star_metrics = [
        (MetricId::StarCount, Units::Count),
        (MetricId::FittedStarCount, Units::Count),
        (MetricId::FwhmMedian, Units::Px),
        (MetricId::EccentricityMedian, Units::Dimensionless),
        (MetricId::HfrMedian, Units::Px),
    ];
    let mut values: Vec<MetricValue> = match frame.star_metrics {
        StarMetrics::Measured {
            star_count,
            fitted_star_count,
            fwhm_median,
            eccentricity_median,
            hfr_median,
        } => {
            let reason = frame.no_fitted_reason().unwrap_or(reasons::NO_FITTED_STARS);
            let values = [
                Some(star_count as f64),
                Some(fitted_star_count as f64),
                fwhm_median,
                eccentricity_median,
                hfr_median,
            ];
            star_metrics
                .iter()
                .zip(values)
                .map(|((id, units), value)| metric(*id, *units, value, reason))
                .collect()
        }
        StarMetrics::Unavailable { reason } => star_metrics
            .iter()
            .map(|(id, units)| MetricValue::unavailable(*id, *units, reason, method))
            .collect(),
    };
    let units = plane_units(frame.units);
    let reason = frame.background_reason().unwrap_or(measure::REASON_NO_VALID_SAMPLES);
    values.push(metric(MetricId::BackgroundMedian, units, frame.background_median, reason));
    values.push(metric(MetricId::BackgroundNoise, units, frame.background_noise, reason));
    values
}

fn star_record(star: &measure::Star) -> StarRecord {
    let shape = star.shape;
    StarRecord {
        index: star.index,
        x: star.x,
        y: star.y,
        state: match star.state {
            measure::StarState::Fitted => StarState::Fitted,
            measure::StarState::Failed => StarState::Failed,
            measure::StarState::NotFitted => StarState::NotFitted,
        },
        reasons: star.reasons.iter().map(|reason| star_reason(*reason)).collect(),
        warnings: star.warnings.iter().map(|warning| star_warning(*warning)).collect(),
        peak: star.peak,
        flux: star.flux,
        local_background: star.local_background,
        box_radius: star.box_radius,
        model: shape.map(|_| StarModel::EllipticalGaussian),
        fwhm_major_px: shape.map(|shape| shape.fwhm_major),
        fwhm_minor_px: shape.map(|shape| shape.fwhm_minor),
        fwhm_px: shape.map(|shape| shape.fwhm),
        eccentricity: shape.map(|shape| shape.eccentricity),
        position_angle_deg: shape.map(|shape| shape.position_angle_deg),
        hfr_px: shape.map(|shape| shape.hfr),
    }
}

const fn star_reason(reason: measure::StarReason) -> StarReason {
    match reason {
        measure::StarReason::Saturated => StarReason::Saturated,
        measure::StarReason::TooManyMaskedSamples => StarReason::TooManyMaskedSamples,
        measure::StarReason::NoConvergence => StarReason::NoConvergence,
        measure::StarReason::SigmaOutOfRange => StarReason::SigmaOutOfRange,
        measure::StarReason::CenterMoved => StarReason::CenterMoved,
        measure::StarReason::NearEdge => StarReason::NearEdge,
    }
}

const fn star_warning(warning: measure::StarWarning) -> StarWarning {
    match warning {
        measure::StarWarning::Saturated => StarWarning::Saturated,
        measure::StarWarning::MaskedSamplesExcluded => StarWarning::MaskedSamplesExcluded,
        measure::StarWarning::NearEdge => StarWarning::NearEdge,
        measure::StarWarning::Blended => StarWarning::Blended,
        measure::StarWarning::SaturationUnknown => StarWarning::SaturationUnknown,
    }
}

/// The recorded star as the pixel crate models it. Cutouts read only the
/// position, box, amplitude, background and shape, which the record keeps
/// losslessly; state reasons and warnings are not needed.
fn pixel_star(star: &StarRecord) -> measure::Star {
    let shape = match (
        star.fwhm_major_px,
        star.fwhm_minor_px,
        star.fwhm_px,
        star.eccentricity,
        star.position_angle_deg,
        star.hfr_px,
    ) {
        (
            Some(fwhm_major),
            Some(fwhm_minor),
            Some(fwhm),
            Some(eccentricity),
            Some(angle),
            Some(hfr),
        ) => Some(measure::StarShape {
            fwhm_major,
            fwhm_minor,
            fwhm,
            eccentricity,
            position_angle_deg: angle,
            hfr,
        }),
        _ => None,
    };
    measure::Star {
        index: star.index,
        x: star.x,
        y: star.y,
        state: match star.state {
            StarState::Fitted => measure::StarState::Fitted,
            StarState::Failed => measure::StarState::Failed,
            StarState::NotFitted => measure::StarState::NotFitted,
        },
        reasons: Vec::new(),
        warnings: Vec::new(),
        peak: star.peak,
        flux: star.flux,
        local_background: star.local_background,
        box_radius: star.box_radius,
        shape,
    }
}

const fn pixel_stretch(stretch: Stretch) -> display::Stretch {
    match stretch {
        Stretch::Linear { black, white } => display::Stretch::Linear { black, white },
        Stretch::Mtf { shadows, midtones, highlights } => {
            display::Stretch::Mtf { shadows, midtones, highlights }
        }
        Stretch::Auto => display::Stretch::Auto,
    }
}

const fn applied_stretch(applied: display::AppliedStretch) -> AppliedStretch {
    AppliedStretch {
        kind: match applied.kind {
            display::StretchKind::Linear => StretchKind::Linear,
            display::StretchKind::Mtf => StretchKind::Mtf,
            display::StretchKind::Auto => StretchKind::Auto,
        },
        black: applied.black,
        white: applied.white,
        shadows: applied.shadows,
        midtones: applied.midtones,
        highlights: applied.highlights,
    }
}

const fn sample_category(category: px::Category) -> SampleCategory {
    match category {
        px::Category::Valid => SampleCategory::Valid,
        px::Category::Nan => SampleCategory::Nan,
        px::Category::PosInf => SampleCategory::PosInf,
        px::Category::NegInf => SampleCategory::NegInf,
        px::Category::Blank => SampleCategory::Blank,
        px::Category::Saturated => SampleCategory::Saturated,
    }
}

const fn stored_number(stored: px::StoredValue) -> StoredNumber {
    match stored {
        px::StoredValue::Int(value) => StoredNumber::Integer(value),
        px::StoredValue::Float(value) => StoredNumber::Float(value),
    }
}
