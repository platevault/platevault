// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application operations over the clean catalog. Image paths are read-only.

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

use crate::frame_review::FrameReview;
use crate::grouping::Intake;
use crate::import::mounted_root;
use crate::inventory;
use crate::patched_copy::{self, EntryFrame};
use crate::projects::{CalibrationReferences, ProjectReferences};
use crate::targets::{
    SimbadConfig, SimbadTargetResolver, TargetAssessment, TargetIndex, TargetQuery, TargetSearchHit,
};
use crate::{
    AssetReference, AssociationKind, AssociationState, Availability, CorrectionInput,
    ExpectedAsset, FileIdentity, FramingMargins, LibraryError, Location, LocationLifecycle,
    LocationRole, NativePath, ObservationFingerprint, ReferenceKind, RemapReview, RetireReview,
    Revision, ScanOperation, ScanOptions, ScanState, TargetCandidate,
};
use persistence_library::{
    Catalog, CorrectionOutcome, CorrectionPreview, LocationReferences, LocationRegistration,
    SessionDetail, SessionQuery, SuggestedAssociation, TrashedAsset, TrashedFrame,
};

/// What [`AssetReferences::references_to`] returns.
pub type ReferencesFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<AssetReference>, LibraryError>> + Send + 'a>>;

/// The seam PRJ (Projects) and CAL (calibration pins) implement for the
/// records that hold library asset ids.
/// Retire location reads every registered source to name those records in its
/// review, and reads them again on confirmation, refusing when they changed. The
/// library never writes them: a retired copy stays in them, reading Retired.
pub trait AssetReferences: Send + Sync + 'static {
    /// The kind of record this source holds.
    fn kind(&self) -> ReferenceKind;
    /// Every record that holds any of `assets`, each naming which of them.
    fn references_to<'a>(&'a self, assets: &'a BTreeSet<Uuid>) -> ReferencesFuture<'a>;
}

pub struct Library {
    /// Patched-copy entry refusals established by recent correction previews.
    /// Cache misses at confirm repeat validation; the bounded eviction is safe.
    patched_entry_refusals: Mutex<PatchedEntryRefusalCache>,
    catalog: Arc<Catalog>,
    targets: Arc<TargetIndex>,
    provider: Option<SimbadTargetResolver>,
    saved_targets: Mutex<Option<(u64, Arc<Vec<TargetCandidate>>)>>,
    scans: Mutex<HashMap<Uuid, ScanControl>>,
    progress: broadcast::Sender<ScanOperation>,
    /// The id of each location whose registration, path or lifecycle changed
    /// through this library (register, reselect, remap, retire).
    location_changes: broadcast::Sender<Uuid>,
    /// The id of each location whose recorded paths changed through this
    /// library outside a scan ([`Library::subscribe_recorded_paths`]).
    recorded_paths: broadcast::Sender<Uuid>,
    references: tokio::sync::RwLock<Vec<Arc<dyn AssetReferences>>>,
    pub(crate) planning: Mutex<crate::observing_plans::PlanningRuntime>,
    frame_review: FrameReview,
    /// Test-only: the next N assessments are refused as if a concurrent writer
    /// had committed between the session read and the record.
    /// Test-only counters for patched-copy entry-check I/O boundaries.
    #[cfg(test)]
    patched_entry_header_reads: std::sync::atomic::AtomicUsize,
    #[cfg(test)]
    forced_conflicts: std::sync::atomic::AtomicUsize,
}

#[derive(Clone)]
struct PatchedEntryRefusalBasis {
    expected: Vec<ExpectedAsset>,
    corrections: Vec<CorrectionInput>,
    refusals: HashMap<(Uuid, String), Option<crate::PatchRefusal>>,
}

/// Maximum number of correction previews whose refusal basis stays cached.
/// Older previews remain confirmable; a cache miss repeats validation.
const PATCHED_ENTRY_REFUSAL_CACHE_CAPACITY: usize = 64;

struct PatchedEntryRefusalCache {
    entries: HashMap<Uuid, PatchedEntryRefusalBasis>,
    insertion_order: VecDeque<Uuid>,
}

impl PatchedEntryRefusalCache {
    fn new() -> Self {
        Self { entries: HashMap::new(), insertion_order: VecDeque::new() }
    }

    fn insert(&mut self, preview_id: Uuid, basis: PatchedEntryRefusalBasis) {
        if let std::collections::hash_map::Entry::Occupied(mut entry) =
            self.entries.entry(preview_id)
        {
            entry.insert(basis);
            return;
        }

        if self.entries.len() == PATCHED_ENTRY_REFUSAL_CACHE_CAPACITY {
            if let Some(oldest) = self.insertion_order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
        self.entries.insert(preview_id, basis);
        self.insertion_order.push_back(preview_id);
    }

    fn remove(&mut self, preview_id: &Uuid) -> Option<PatchedEntryRefusalBasis> {
        let basis = self.entries.remove(preview_id)?;
        if let Some(index) = self.insertion_order.iter().position(|id| id == preview_id) {
            self.insertion_order.remove(index);
        }
        Some(basis)
    }
}

/// Re-reads of one session before a conflicting assessment is reported.
const ASSESSMENT_ATTEMPTS: usize = 3;
/// Duplicate candidates hashed and bound per catalog transaction.
const COPY_CHUNK: usize = 16;

struct ScanControl {
    canceled: Arc<AtomicBool>,
    pending_failure: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct LibrarySession {
    pub detail: SessionDetail,
    pub target_assessments: Vec<TargetAssessment>,
}

/// A committed metadata correction plus the outcome of re-deriving the target
/// suggestions of the resulting sessions (those holding a corrected asset and every
/// regroup successor).
///
/// The correction is durable whether or not the refresh succeeds. A failed refresh,
/// including a session another writer kept changing through every re-read, is
/// reported here; the catalog's fail-closed `NeedsReview` state stays in place and
/// the next scan or correction retries it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct ConfirmedCorrection {
    #[serde(flatten)]
    pub outcome: CorrectionOutcome,
    pub association_refresh: Option<crate::ErrorResponse>,
}

/// The inventory's source probe. Each probe holds the volume probes of one
/// run of reads (`inventory::VolumeCache`): clone it across the reads of a
/// run so each root's volume is probed once, and create a new one per run.
#[derive(Clone, Default)]
pub struct InventoryProbe {
    volumes: Arc<inventory::VolumeCache>,
}

impl persistence_library::SourceProbe for InventoryProbe {
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
        inventory::probe_fingerprint_in(path, &*self.volumes)
    }

    fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
        inventory::validate_location_root_in(location, &*self.volumes)
    }
}

impl Library {
    /// Open a fresh-schema catalog and load the offline target dataset, with
    /// the catalog's Projects and calibration pins registered as reference
    /// sources. Interrupted scan recovery is owned by the catalog.
    ///
    /// # Errors
    /// Returns catalog persistence, seed validation or provider configuration errors.
    pub async fn open(
        path: &Path,
        provider: Option<&SimbadConfig>,
    ) -> Result<Arc<Self>, LibraryError> {
        let catalog = Arc::new(Catalog::open(path).await?);
        let targets = blocking(TargetIndex::bundled).await?;
        let provider = provider.map(SimbadTargetResolver::simbad).transpose()?;
        let (progress, _) = broadcast::channel(128);
        let (location_changes, _) = broadcast::channel(64);
        let (recorded_paths, _) = broadcast::channel(64);
        let planning =
            Mutex::new(crate::observing_plans::PlanningRuntime::new(Arc::clone(&catalog)));
        let projects: Arc<dyn AssetReferences> =
            Arc::new(ProjectReferences { catalog: Arc::clone(&catalog) });
        let calibration: Arc<dyn AssetReferences> =
            Arc::new(CalibrationReferences { catalog: Arc::clone(&catalog) });
        let frame_review = FrameReview::new(Arc::clone(&catalog));
        let library = Arc::new(Self {
            patched_entry_refusals: Mutex::new(PatchedEntryRefusalCache::new()),
            catalog,
            targets: Arc::new(targets),
            provider,
            scans: Mutex::new(HashMap::new()),
            saved_targets: Mutex::new(None),
            progress,
            location_changes,
            recorded_paths,
            planning,
            references: tokio::sync::RwLock::new(vec![projects, calibration]),
            frame_review,
            #[cfg(test)]
            patched_entry_header_reads: std::sync::atomic::AtomicUsize::new(0),
            #[cfg(test)]
            forced_conflicts: std::sync::atomic::AtomicUsize::new(0),
        });
        // APPLY (069, F4): restore the old View or finish installing the new
        // one for every Apply an earlier run left unsettled.
        crate::apply::reconcile(&library).await;
        // CAL (068, F4): match the sessions whose calibration matching an
        // earlier run left pending (LIB-FR-23, LIB-FR-25).
        library.match_calibration_after_commit().await;
        Ok(library)
    }

    #[must_use]
    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    /// Measurement runs, previews, star diagnostics and imports (spec 067).
    #[must_use]
    pub const fn frame_review(&self) -> &FrameReview {
        &self.frame_review
    }

    #[must_use]
    pub fn subscribe_scan_progress(&self) -> broadcast::Receiver<ScanOperation> {
        self.progress.subscribe()
    }

    /// The id of each location registered, reselected, remapped or retired
    /// from now on. A lagged receiver has missed changes and re-reads the
    /// locations.
    #[must_use]
    pub fn subscribe_location_changes(&self) -> broadcast::Receiver<Uuid> {
        self.location_changes.subscribe()
    }

    /// Publish a committed location change; nobody listening is not an error.
    fn location_changed(&self, location: Location) -> Location {
        let _ = self.location_changes.send(location.id);
        location
    }

    /// The id of each location whose recorded paths change outside a scan
    /// from now on, once per change: frames recorded Trashed there, or a
    /// record an archive moved out of or into it. A lagged receiver has missed
    /// some and re-reads every location.
    #[must_use]
    pub fn subscribe_recorded_paths(&self) -> broadcast::Receiver<Uuid> {
        self.recorded_paths.subscribe()
    }

    /// Announce that the paths the catalog records in `location` changed
    /// outside a scan ([`Library::subscribe_recorded_paths`]); nobody
    /// listening is not an error.
    pub(crate) fn recorded_paths_changed(&self, location: Uuid) {
        let _ = self.recorded_paths.send(location);
    }

    /// Record frames the storage custody moved to the OS Trash
    /// ([`Catalog::record_trashed`]), then announce the location of each
    /// ([`Library::recorded_paths_changed`]).
    ///
    /// # Errors
    /// As [`Catalog::record_trashed`].
    pub(crate) async fn record_trashed(
        &self,
        storage_operation_id: Uuid,
        frames: &[TrashedFrame],
    ) -> Result<Vec<TrashedAsset>, LibraryError> {
        let trashed = self.catalog.record_trashed(storage_operation_id, frames).await?;
        let locations: BTreeSet<Uuid> =
            trashed.iter().map(|trashed| trashed.asset.location_id).collect();
        for location in locations {
            self.recorded_paths_changed(location);
        }
        Ok(trashed)
    }

    #[must_use]
    pub fn seed_target(&self, id: Uuid) -> Option<TargetCandidate> {
        self.targets.candidate(id)
    }

    /// The bundled seed index, for the Targets list's Browse and search.
    pub(crate) fn target_index(&self) -> &TargetIndex {
        &self.targets
    }

    /// Review replacement paths without changing originals or registered paths.
    ///
    /// # Errors
    /// Refuses inaccessible/unqualified roots, stale revisions or missing byte proof.
    pub async fn review_remap(
        &self,
        location_id: Uuid,
        expected: Revision,
        proposed: NativePath,
    ) -> Result<RemapReview, LibraryError> {
        let root = proposed.to_path_buf()?;
        let observed = blocking(move || inventory::observe_root(&root)).await?;
        let probe = InventoryProbe::default();
        self.catalog
            .review_remap(
                location_id,
                expected,
                &proposed,
                &observed.identity,
                observed.volume_kind,
                probe,
            )
            .await
    }

    /// Apply a reviewed remap; see [`Catalog::apply_remap`].
    ///
    /// # Errors
    /// `Conflict`, `IdentityConflict` or `NoByteProof` leave every path unchanged.
    pub async fn apply_remap(
        &self,
        review_id: Uuid,
        expected: Revision,
    ) -> Result<Location, LibraryError> {
        let location =
            self.catalog.apply_remap(review_id, expected, InventoryProbe::default()).await?;
        Ok(self.location_changed(location))
    }

    /// Every registered location, each Active and Available one with its
    /// volume's free space and low-space flag probed now through the root
    /// check Import uses (Home Status, PRJ-FR-17 section 4). Both stay unknown,
    /// never zero, for a retired or offline location and for a root or volume
    /// that cannot be read.
    ///
    /// # Errors
    /// Catalog read failures.
    pub async fn list_locations(&self) -> Result<Vec<Location>, LibraryError> {
        let mut locations = self.catalog.list_locations().await?;
        let probes = locations.clone();
        let spaces =
            blocking(move || Ok(probes.iter().map(volume_space).collect::<Vec<_>>())).await?;
        for (location, space) in locations.iter_mut().zip(spaces) {
            location.free_bytes = space.map(|(free, _)| free);
            location.low_space = space.map(|(_, low)| low);
        }
        Ok(locations)
    }

    /// Register a qualified native root without scanning or modifying its files.
    ///
    /// # Errors
    /// Refuses invalid roots, unknown identity, overlap or persistence failure.
    pub async fn register_location(
        &self,
        path: NativePath,
        name: String,
        role: LocationRole,
    ) -> Result<Location, LibraryError> {
        let root = path.to_path_buf()?;
        let observed = blocking(move || inventory::observe_root(&root)).await?;
        let location = self
            .catalog
            .register_location(&LocationRegistration {
                name,
                path,
                role,
                identity: observed.identity,
                volume_kind: observed.volume_kind,
            })
            .await?;
        Ok(self.location_changed(location))
    }

    /// Restore a location only when its registered volume and folder still match.
    ///
    /// # Errors
    /// Returns access, identity, stale revision or persistence errors.
    pub async fn reselect_location(
        &self,
        id: Uuid,
        expected: Revision,
        path: NativePath,
    ) -> Result<Location, LibraryError> {
        let root = path.to_path_buf()?;
        let identity = blocking(move || inventory::observe_root_identity(&root)).await?;
        let location = self.catalog.reselect_location(id, expected, &path, &identity).await?;
        Ok(self.location_changed(location))
    }

    /// Register a feature's records that hold asset ids (see [`AssetReferences`]).
    pub async fn register_references(&self, source: Arc<dyn AssetReferences>) {
        self.references.write().await.push(source);
    }

    /// Durably review Retire location, naming the Projects and calibration
    /// records of every registered source that hold its copies. No file or
    /// record changes.
    ///
    /// # Errors
    /// Returns catalog or reference-source errors; see
    /// [`Catalog::review_retire_location`].
    pub async fn review_retire_location(
        &self,
        location_id: Uuid,
    ) -> Result<RetireReview, LibraryError> {
        let references = self.read_references(location_id).await?;
        self.catalog.review_retire_location(location_id, &references).await
    }

    /// Confirm a reviewed Retire location after reading every reference again.
    /// Catalog-only: no file bytes are read or changed.
    ///
    /// # Errors
    /// `Conflict` when the review is stale, the location's availability differs
    /// from the review or a scan of the location is Running; see
    /// [`Catalog::retire_location`].
    pub async fn retire_location(
        &self,
        review_id: Uuid,
        location_id: Uuid,
        expected: Revision,
    ) -> Result<Location, LibraryError> {
        let references = self.read_references(location_id).await?;
        let location =
            self.catalog.retire_location(review_id, location_id, expected, &references).await?;
        Ok(self.location_changed(location))
    }

    async fn read_references(&self, location_id: Uuid) -> Result<LocationReferences, LibraryError> {
        let assets: BTreeSet<Uuid> =
            self.catalog.location_assets(location_id).await?.iter().map(|asset| asset.id).collect();
        let sources = self.references.read().await.clone();
        let mut references = Vec::new();
        let mut consulted = Vec::with_capacity(sources.len());
        for source in sources {
            consulted.push(source.kind());
            references.extend(source.references_to(&assets).await?);
        }
        Ok(LocationReferences { assets, references, consulted })
    }

    /// Return only after the Running operation is durably recorded.
    ///
    /// # Errors
    /// Refuses an unknown location, overlapping active scan or failed durable write.
    pub async fn start_scan(
        self: &Arc<Self>,
        location_id: Uuid,
        relative_scope: Option<NativePath>,
    ) -> Result<ScanOperation, LibraryError> {
        let operation = self.catalog.begin_scan(location_id, relative_scope.clone()).await?;
        self.supervise_scan(&operation, relative_scope, None).await;
        Ok(operation)
    }

    /// Supervise a new scan confined to the reviewed relative subtree.
    ///
    /// # Errors
    /// Refuses invalid scope, unknown location, concurrent scan or persistence failure.
    pub async fn retry_scope(
        self: &Arc<Self>,
        location_id: Uuid,
        scope: NativePath,
    ) -> Result<ScanOperation, LibraryError> {
        let operation = self.catalog.retry_scope(location_id, scope.clone()).await?;
        self.supervise_scan(&operation, Some(scope), None).await;
        Ok(operation)
    }

    /// Scan a location, or the `scope` folder of it, splitting the sessions
    /// it forms within `margins` rather than the Settings: an import indexes
    /// its lights within its own split limits (CF2, owner 2026-10-20).
    ///
    /// # Errors
    /// As [`Self::start_scan`] and [`Self::retry_scope`].
    pub(crate) async fn scan_within(
        self: &Arc<Self>,
        location_id: Uuid,
        scope: Option<NativePath>,
        margins: FramingMargins,
    ) -> Result<ScanOperation, LibraryError> {
        let operation = match &scope {
            None => self.catalog.begin_scan(location_id, None).await?,
            Some(scope) => self.catalog.retry_scope(location_id, scope.clone()).await?,
        };
        self.supervise_scan(&operation, scope, Some(margins)).await;
        Ok(operation)
    }

    /// `margins` split the sessions the scan forms; `None` reads the Settings.
    async fn supervise_scan(
        self: &Arc<Self>,
        operation: &ScanOperation,
        relative_scope: Option<NativePath>,
        margins: Option<FramingMargins>,
    ) {
        let canceled = Arc::new(AtomicBool::new(false));
        self.scans.lock().await.insert(
            operation.id,
            ScanControl { canceled: Arc::clone(&canceled), pending_failure: None },
        );
        let library = Arc::clone(self);
        let id = operation.id;
        tokio::spawn(async move {
            let outcome = library.run_scan(id, relative_scope, margins, &canceled).await;
            let finished = match outcome {
                Ok(()) => true,
                Err(error) => match library.catalog.scan_status(id).await {
                    Ok(recorded) if recorded.state != ScanState::Running => {
                        let _ = library.progress.send(recorded);
                        true
                    }
                    _ => {
                        if let Ok(failed) = library
                            .catalog
                            .abort_scan(id, ScanState::Failed, &error.to_string())
                            .await
                        {
                            let _ = library.progress.send(failed);
                            true
                        } else {
                            if let Some(control) = library.scans.lock().await.get_mut(&id) {
                                control.pending_failure = Some(error.to_string());
                            }
                            false
                        }
                    }
                },
            };
            if finished {
                library.scans.lock().await.remove(&id);
            }
        });
    }

    /// Request cancellation without claiming that the worker already stopped.
    ///
    /// # Errors
    /// Returns unknown operation, missing supervisor or persistence errors.
    pub async fn cancel_scan(&self, id: Uuid) -> Result<ScanOperation, LibraryError> {
        let operation = self.catalog.scan_status(id).await?;
        if operation.state == ScanState::Running {
            let scans = self.scans.lock().await;
            let control = scans.get(&id).ok_or_else(|| {
                LibraryError::SourceUnavailable(
                    "scan supervisor is not active; reload durable status".into(),
                )
            })?;
            control.canceled.store(true, Ordering::Release);
            let pending = control.pending_failure.clone();
            drop(scans);
            if let Some(reason) = pending {
                let failed = self.catalog.abort_scan(id, ScanState::Failed, &reason).await?;
                self.scans.lock().await.remove(&id);
                let _ = self.progress.send(failed.clone());
                return Ok(failed);
            }
        }
        // Acknowledges the request; the durable operation may still be Running.
        Ok(operation)
    }

    /// Rank the complete saved and seed candidate set using shared normalization.
    ///
    /// # Errors
    /// Returns invalid query/cone/limit or catalog read errors.
    pub async fn search_targets(
        &self,
        query: &TargetQuery,
    ) -> Result<Vec<TargetSearchHit>, LibraryError> {
        let saved = self.saved_targets().await?;
        self.targets.search(query, &saved)
    }

    /// Return explicit provider evidence; local search does not require a provider.
    ///
    /// # Errors
    /// Returns invalid/unknown/ambiguous queries or `ProviderUnavailable`.
    pub async fn resolve_target(&self, query: &str) -> Result<TargetCandidate, LibraryError> {
        let provider = self.provider.as_ref().ok_or_else(|| {
            LibraryError::ProviderUnavailable(
                "no online provider configured; local target search remains available".into(),
            )
        })?;
        provider.resolve(query).await
    }

    /// Inspect recorded membership and non-confirming target evidence.
    ///
    /// # Errors
    /// Returns `NotFound` or catalog read errors; never measures or modifies sources.
    pub async fn session(&self, id: Uuid) -> Result<LibrarySession, LibraryError> {
        let detail = self.catalog.session(id).await?;
        let frames = detail.assets.iter().map(|asset| asset.effective.clone()).collect::<Vec<_>>();
        let saved = self.saved_targets().await?;
        let target_assessments = self.targets.candidates_for_frames(&frames, &saved);
        Ok(LibrarySession { detail, target_assessments })
    }

    pub(crate) async fn saved_targets(&self) -> Result<Arc<Vec<TargetCandidate>>, LibraryError> {
        const PAGE: u32 = 1000;
        let mut cached = self.saved_targets.lock().await;
        let generation = self.catalog.target_generation().await?;
        if let Some((recorded, candidates)) = &*cached {
            if *recorded == generation {
                return Ok(Arc::clone(candidates));
            }
        }
        for _ in 0..4 {
            let before = self.catalog.target_generation().await?;
            let mut offset = 0_u32;
            let mut saved = Vec::new();
            loop {
                let page = self.catalog.list_targets(offset, PAGE).await?;
                let count = u32::try_from(page.len()).map_err(|_| {
                    LibraryError::PersistenceFailure("target page exceeds u32".into())
                })?;
                saved.extend(page.into_iter().map(|record| record.candidate));
                if count < PAGE {
                    break;
                }
                offset = offset.checked_add(count).ok_or_else(|| {
                    LibraryError::PersistenceFailure("target index exceeds u32".into())
                })?;
            }
            if self.catalog.target_generation().await? == before {
                let candidates = Arc::new(saved);
                *cached = Some((before, Arc::clone(&candidates)));
                drop(cached);
                return Ok(candidates);
            }
        }
        Err(LibraryError::PersistenceFailure(
            "target catalog changed repeatedly during search; retry".into(),
        ))
    }

    /// The framing margins intake splits sessions with (LIB-FR-04): the
    /// workflow settings, else their defaults. Read once per intake, so the
    /// margins in force when frames arrive set their split.
    ///
    /// # Errors
    /// Returns the catalog's read errors.
    pub async fn framing_margins(&self) -> Result<FramingMargins, LibraryError> {
        Ok(self.catalog.workflow_settings().await?.0.framing)
    }

    /// Preview a correction and the regroup it causes under the current
    /// framing margins; nothing but the plan is recorded. A correction no
    /// patched copy can deliver is refused here, as Apply refuses it again
    /// (PREP-FR-03, D-W123): a field no header keyword carries, a cleared
    /// value the frame's header holds, or a text value FITS can't hold in
    /// the card it is written to.
    ///
    /// # Errors
    /// `CorrectionUndeliverable` naming the frame and field of such a
    /// correction; the catalog's preview errors.
    pub async fn preview_correction(
        &self,
        expected: &[ExpectedAsset],
        corrections: &[CorrectionInput],
    ) -> Result<CorrectionPreview, LibraryError> {
        let margins = self.framing_margins().await?;
        self.preview_correction_within(expected, corrections, &margins).await
    }

    /// [`Self::preview_correction`] within `margins`: the limits a frame
    /// the correction moves out of its session starts a new one under.
    pub(crate) async fn preview_correction_within(
        &self,
        expected: &[ExpectedAsset],
        corrections: &[CorrectionInput],
        margins: &FramingMargins,
    ) -> Result<CorrectionPreview, LibraryError> {
        let refusals = self.refuse_undeliverable(expected, corrections, None).await?;
        let preview =
            self.catalog.preview_correction(expected, corrections, Intake(margins)).await?;
        self.patched_entry_refusals.lock().await.insert(
            preview.id,
            PatchedEntryRefusalBasis {
                expected: expected.to_vec(),
                corrections: corrections.to_vec(),
                refusals,
            },
        );
        Ok(preview)
    }

    /// Confirm a reviewed correction preview, then re-derive the target suggestion
    /// of every resulting session: those holding a corrected asset and every
    /// successor of the regroup. A preview holding a correction no patched
    /// copy can deliver is refused, as its preview was.
    ///
    /// # Errors
    /// `CorrectionUndeliverable` as [`Self::preview_correction`]; the
    /// catalog's confirmation errors; a refresh failure after commit is
    /// reported in [`ConfirmedCorrection::association_refresh`] instead.
    pub async fn confirm_correction(
        &self,
        preview_id: Uuid,
        expected: &[crate::ExpectedAsset],
    ) -> Result<ConfirmedCorrection, LibraryError> {
        let margins = self.framing_margins().await?;
        self.confirm_correction_within(preview_id, expected, &margins).await
    }

    /// [`Self::confirm_correction`] within `margins`, as
    /// [`Self::preview_correction_within`].
    pub(crate) async fn confirm_correction_within(
        &self,
        preview_id: Uuid,
        expected: &[crate::ExpectedAsset],
        margins: &FramingMargins,
    ) -> Result<ConfirmedCorrection, LibraryError> {
        let preview = self.catalog.correction_preview(preview_id).await?;
        let cached = self.patched_entry_refusals.lock().await.remove(&preview_id);
        let cached = cached.filter(|basis| {
            basis.expected.len() == expected.len()
                && basis.expected.iter().all(|item| {
                    expected.iter().any(|candidate| {
                        candidate.asset_id == item.asset_id
                            && candidate.decision_revision == item.decision_revision
                            && candidate.fingerprint.equivalent(&item.fingerprint)
                    })
                })
                && basis.corrections.len() == preview.corrections.len()
                && basis.corrections.iter().zip(&preview.corrections).all(|(left, right)| {
                    left.asset_id == right.asset_id
                        && left.field == right.field
                        && left.value == right.value
                })
        });
        self.refuse_undeliverable(expected, &preview.corrections, cached).await?;
        let outcome =
            self.catalog.confirm_correction(preview_id, expected, Intake(margins)).await?;
        let association_refresh = match self.refresh_sessions(&outcome).await {
            Ok(()) => None,
            Err(error) => Some(error.response(Some(preview_id), None)),
        };
        Ok(ConfirmedCorrection { outcome, association_refresh })
    }

    /// The first of `corrections` no isolated patched copy can deliver, as
    /// a coded refusal naming its frame and field (PREP-FR-03, D-W123).
    /// Each corrected frame is loaded in one batch; header evidence is captured
    /// at preview and reused on confirm while the preview inputs still match.
    /// Unknown frames remain the catalog correction transaction's responsibility;
    /// cache misses, including after restart, recompute validation before confirmation.
    async fn refuse_undeliverable(
        &self,
        expected: &[ExpectedAsset],
        corrections: &[CorrectionInput],
        basis: Option<PatchedEntryRefusalBasis>,
    ) -> Result<HashMap<(Uuid, String), Option<crate::PatchRefusal>>, LibraryError> {
        let named: HashSet<Uuid> = expected.iter().map(|item| item.asset_id).collect();
        let correction_ids: Vec<Uuid> = corrections
            .iter()
            .filter(|item| named.contains(&item.asset_id))
            .map(|item| item.asset_id)
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        let entries = self.catalog.correction_entry_assets(&correction_ids).await?;
        let has_basis = basis.is_some();
        let prior = basis.map(|basis| basis.refusals).unwrap_or_default();
        let mut refusals = prior;
        let mut frames = HashMap::with_capacity(entries.len());
        for entry in entries {
            let source = entry
                .root
                .as_deref()
                .zip(entry.asset.relative_path.relative_path().ok())
                .map(|(root, relative)| root.join(relative));
            let needs_alias_read = !has_basis
                && ["telescope", "camera"].iter().any(|field| {
                    corrections
                        .iter()
                        .any(|item| item.asset_id == entry.asset.id && item.field == *field)
                });
            #[cfg(test)]
            if needs_alias_read && matches!(entry.asset.format, crate::ImageFormat::Fits) {
                self.patched_entry_header_reads.fetch_add(1, Ordering::Relaxed);
            }
            let aliases = if needs_alias_read
                && matches!(entry.asset.format, crate::ImageFormat::Fits)
            {
                source.as_deref().and_then(|path| metadata_fits::patch::hierarch_aliases(path).ok())
            } else {
                None
            };

            frames.insert(
                entry.asset.id,
                EntryFrame { observed: entry.asset.observed, hierarch_aliases: aliases },
            );
        }
        for correction in corrections {
            if !named.contains(&correction.asset_id) {
                continue;
            }
            let Some(frame) = frames.get(&correction.asset_id) else { continue };
            let key = (correction.asset_id, correction.field.clone());
            if refusals.contains_key(&key) {
                continue;
            }
            let refusal = patched_copy::entry_refusal(&correction.field, &correction.value, frame);
            refusals.insert(key, refusal);
            if let Some(refusal) = refusal {
                return Err(LibraryError::CorrectionUndeliverable {
                    identity: correction.asset_id,
                    path: None,
                    field: correction.field.clone(),
                    refusal,
                });
            }
        }
        Ok(refusals)
    }
    /// others were attempted.
    async fn refresh_sessions(&self, outcome: &CorrectionOutcome) -> Result<(), LibraryError> {
        let saved = self.saved_targets().await?;
        let mut sessions: Vec<Uuid> = outcome.sessions.iter().map(|session| session.id).collect();
        for successor in outcome.lineage.iter().flat_map(|lineage| &lineage.successors) {
            if !sessions.contains(successor) {
                sessions.push(*successor);
            }
        }
        let mut failure = None;
        for session in sessions {
            if let Err(error) = self.refresh_session_suggestion(session, &saved).await {
                failure.get_or_insert(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }

    async fn refresh_target_suggestions(&self, location_id: Uuid) -> Result<(), LibraryError> {
        let saved = self.saved_targets().await?;
        let mut offset = 0_u32;
        loop {
            let rows = self
                .catalog
                .list_sessions(&SessionQuery {
                    location_id: Some(location_id),
                    include_superseded: false,
                    filter: None,
                    offset,
                    limit: 1000,
                })
                .await?;
            let count = u32::try_from(rows.len())
                .map_err(|_| LibraryError::PersistenceFailure("session page exceeds u32".into()))?;
            for row in rows {
                match self.refresh_session_suggestion(row.session.id, &saved).await {
                    // Still conflicting after every re-read: the session is marked for
                    // review instead of keeping an assessment nobody recorded.
                    Err(LibraryError::Conflict { .. }) => {
                        self.catalog.mark_assessment_conflict(row.session.id).await?;
                    }
                    other => other?,
                }
            }
            if count < 1000 {
                return Ok(());
            }
            offset = offset.checked_add(count).ok_or_else(|| {
                LibraryError::PersistenceFailure("session index exceeds u32".into())
            })?;
        }
    }

    /// Read, assess and record one session. A `Conflict` means a concurrent writer
    /// (a quality decision, a correction or another location's scan) changed it
    /// after the read: the session is re-read and re-assessed, at most
    /// [`ASSESSMENT_ATTEMPTS`] times, and a superseded session hands over to its
    /// successors. A conflict that persists is returned to the caller.
    async fn refresh_session_suggestion(
        &self,
        session_id: Uuid,
        saved: &[TargetCandidate],
    ) -> Result<(), LibraryError> {
        let mut queue = vec![session_id];
        let mut visited = Vec::new();
        while let Some(id) = queue.pop() {
            if visited.contains(&id) {
                continue;
            }
            visited.push(id);
            let mut attempt = 0;
            loop {
                attempt += 1;
                let detail = self.catalog.session(id).await?;
                if !detail.summary.successors.is_empty() {
                    queue.extend(detail.summary.successors);
                    break;
                }
                match self.record_assessment(&detail, saved).await {
                    Ok(()) => break,
                    Err(LibraryError::Conflict { successors, .. }) if !successors.is_empty() => {
                        queue.extend(successors);
                        break;
                    }
                    Err(LibraryError::Conflict { .. }) if attempt < ASSESSMENT_ATTEMPTS => {}
                    Err(error) => return Err(error),
                }
            }
        }
        Ok(())
    }

    /// Assess one read of a session and record the result against exactly that read.
    ///
    /// # Errors
    /// `Conflict` when the session changed after `detail` was read.
    async fn record_assessment(
        &self,
        detail: &SessionDetail,
        saved: &[TargetCandidate],
    ) -> Result<(), LibraryError> {
        let session_id = detail.summary.session.id;
        // One frame per logical capture: identical copies are one observation.
        let frames = detail
            .members
            .iter()
            .filter_map(|member| {
                detail.assets.iter().find(|asset| member.copies.contains(&asset.id))
            })
            .map(|asset| asset.effective.clone())
            .collect::<Vec<_>>();
        let assessments = self.targets.candidates_for_frames(&frames, saved);
        let mut qualified =
            assessments.iter().filter(|assessment| assessment.state == AssociationState::Suggested);
        let first = qualified.next();
        let unique = first.filter(|_| qualified.next().is_none());
        let (subject_id, state, evidence, provenance) = if let Some(assessment) = unique {
            if matches!(assessment.candidate.provenance, crate::Provenance::Seed { .. }) {
                self.catalog.record_seed_target(&assessment.candidate).await?;
            }
            (
                Some(assessment.candidate.id),
                AssociationState::Suggested,
                assessment.evidence.clone(),
                assessment.provenance.clone(),
            )
        } else {
            let state = if assessments.is_empty() {
                AssociationState::Unresolved
            } else {
                AssociationState::NeedsReview
            };
            (
                None,
                state,
                vec![crate::EvidenceItem::Unknown { field: "qualified unique target".into() }],
                crate::Provenance::Inferred { rule: crate::targets::ASSOCIATION_RULE.into() },
            )
        };
        #[cfg(test)]
        if self
            .forced_conflicts
            .try_update(Ordering::AcqRel, Ordering::Acquire, |left| left.checked_sub(1))
            .is_ok()
        {
            return Err(LibraryError::Conflict {
                id: session_id,
                current: detail.summary.session.grouping_revision,
                successors: Vec::new(),
            });
        }
        let recorded = self
            .catalog
            .record_suggestions(&[SuggestedAssociation {
                session_id,
                grouping_revision: detail.summary.session.grouping_revision,
                expected_observations: detail
                    .assets
                    .iter()
                    .map(|asset| (asset.id, asset.fingerprint.clone()))
                    .collect(),
                expected_decisions: detail
                    .assets
                    .iter()
                    .map(|asset| (asset.id, asset.decision_revision))
                    .collect(),
                expected_observation_revisions: detail
                    .assets
                    .iter()
                    .map(|asset| (asset.id, asset.observation_revision))
                    .collect(),
                kind: AssociationKind::Target,
                subject_id,
                state,
                evidence,
                provenance,
            }])
            .await;
        recorded.map(drop)
    }

    /// Hash the cross-location duplicate candidates of a scan whose walk finished
    /// readable, in CAS-bound chunks with a progress event after each, stopping at
    /// the next file once the scan is canceled. A canceled or failed walk hashes
    /// nothing; unhashed candidates keep their totals provisional.
    async fn verify_copies(
        &self,
        id: Uuid,
        state: ScanState,
        canceled: &Arc<AtomicBool>,
    ) -> Result<(), LibraryError> {
        if !matches!(state, ScanState::Completed | ScanState::Partial)
            || canceled.load(Ordering::Acquire)
        {
            return Ok(());
        }
        let work = self.catalog.duplicate_verification_work(id).await?;
        // One run of reads: every chunk reuses the probe of each root's volume.
        let probe = InventoryProbe::default();
        for chunk in work.chunks(COPY_CHUNK) {
            if canceled.load(Ordering::Acquire) {
                break;
            }
            let status = self
                .catalog
                .verify_duplicate_candidates(id, chunk, probe.clone(), Arc::clone(canceled))
                .await?;
            let _ = self.progress.send(status);
        }
        Ok(())
    }

    async fn run_scan(
        self: &Arc<Self>,
        id: Uuid,
        relative_scope: Option<NativePath>,
        margins: Option<FramingMargins>,
        canceled: &Arc<AtomicBool>,
    ) -> Result<(), LibraryError> {
        let operation = self.catalog.scan_status(id).await?;
        let location = self.catalog.location(operation.location_id).await?;
        let margins = match margins {
            Some(margins) => margins,
            None => self.framing_margins().await?,
        };
        let catalog = Arc::clone(&self.catalog);
        let progress = self.progress.clone();
        let flag = Arc::clone(canceled);
        let handle = tokio::runtime::Handle::current();
        let scan_location = location.clone();
        let library = Arc::clone(self);
        let observation = blocking(move || {
            let options = ScanOptions { relative_scope, ..ScanOptions::default() };
            let mut next_assessment = u64::try_from(options.batch_size).unwrap_or(u64::MAX);
            inventory::scan(
                &scan_location,
                &options,
                |batch| {
                    // The platform probe runs outside the writer lock. Catalog
                    // compares it with both registration and scan-begin identity.
                    let identity = inventory::validate_location_root(&scan_location)?;
                    let applied = handle.block_on(catalog.apply_scan_batch(
                        id,
                        &identity,
                        &batch,
                        Intake(&margins),
                    ))?;
                    let _ = progress.send(applied);
                    if batch.progress.metadata_read >= next_assessment {
                        handle.block_on(library.refresh_target_suggestions(scan_location.id))?;
                        next_assessment = batch.progress.metadata_read.saturating_mul(2);
                    }
                    Ok(())
                },
                &flag,
            )
        })
        .await;
        match observation {
            Ok(observation) => {
                // Cross-location duplicate candidates are hashed before the terminal
                // state, so totals leave provisional scope with the scan (D16).
                self.verify_copies(id, observation.state, canceled).await?;
                let catalog = Arc::clone(&self.catalog);
                let handle = tokio::runtime::Handle::current();
                let completed = blocking(move || {
                    handle.block_on(catalog.finish_scan(
                        id,
                        &observation,
                        inventory::validate_location_root,
                        Intake(&margins),
                    ))
                })
                .await?;
                self.refresh_target_suggestions(location.id).await?;
                // Calibration is matched after the commit (LIB-FR-23).
                self.match_calibration_after_commit().await;
                let _ = self.progress.send(completed);
                Ok(())
            }
            Err(error) => {
                let checked_location = location.clone();
                if let Err(root_error) =
                    blocking(move || inventory::validate_location_root(&checked_location)).await
                {
                    if let Some(availability) = root_failure(&root_error) {
                        self.catalog
                            .mark_location_unavailable(
                                location.id,
                                availability,
                                &root_error.to_string(),
                            )
                            .await?;
                    }
                }
                Err(error)
            }
        }
    }
}

pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, LibraryError> + Send + 'static,
) -> Result<T, LibraryError> {
    tokio::task::spawn_blocking(work).await.map_err(|error| {
        LibraryError::SourceUnavailable(format!("library worker interrupted: {error}"))
    })?
}

/// The share of a volume's capacity below which its free space is low, in
/// percent. Current specs give no number; this is legacy spec 030 §11.1 and
/// FR-121 ("a volume drops below 10% free").
const LOW_SPACE_PERCENT: u64 = 10;

/// Free bytes on the volume of an Active, Available location and whether
/// they are low; `None` when the location is not probed or cannot be.
fn volume_space(location: &Location) -> Option<(u64, bool)> {
    if location.lifecycle != LocationLifecycle::Active
        || location.availability != Availability::Available
    {
        return None;
    }
    let root = mounted_root(location).ok()?;
    let free = fs4::available_space(&root).ok()?;
    let capacity = fs4::total_space(&root).ok().filter(|&capacity| capacity > 0)?;
    Some((free, low_space(free, capacity)))
}

/// Whether `free` is under [`LOW_SPACE_PERCENT`] of `capacity`, exactly.
fn low_space(free: u64, capacity: u64) -> bool {
    u128::from(free) * 100 < u128::from(capacity) * u128::from(LOW_SPACE_PERCENT)
}

/// How a root that failed its identity check reads: Offline when it is gone,
/// Unreadable when access is denied, `IdentityConflict` for another volume or
/// folder; `None` for any other failure.
pub(crate) fn root_failure(error: &LibraryError) -> Option<Availability> {
    match error {
        LibraryError::Context { error, .. } => root_failure(error),
        LibraryError::IdentityConflict(_) => Some(Availability::IdentityConflict),
        LibraryError::AccessDenied(_) => Some(Availability::Unreadable),
        LibraryError::SourceUnavailable(_) | LibraryError::NotFound(_) => {
            Some(Availability::Offline)
        }
        _ => None,
    }
}

#[cfg(test)]
#[path = "../tests/support/mod.rs"]
pub(crate) mod fixtures;

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::inventory::{OsVolumes, Probed, VolumeCache, VolumeProbe};
    use crate::scan_support::scan_to_end;
    use crate::{ExpectedAsset, Quality};

    #[test]
    fn a_volume_is_low_just_below_the_low_space_share_and_not_at_it() {
        let capacity = 1_000_000_000_000;
        let at = capacity / 100 * LOW_SPACE_PERCENT;
        assert!(low_space(at - 1, capacity), "just below the share is low");
        assert!(!low_space(at, capacity), "exactly the share is not low");
        assert!(!low_space(capacity, capacity));
        assert!(low_space(0, capacity));
        assert!(!low_space(u64::MAX, u64::MAX), "no overflow at the largest volume");
    }

    fn target_basis(detail: &SessionDetail) -> BTreeMap<Uuid, ObservationFingerprint> {
        detail
            .associations
            .iter()
            .find(|association| association.kind == AssociationKind::Target)
            .map(|association| association.observation_basis.clone())
            .expect("the scan recorded a target assessment")
    }

    async fn scanned_library(
        temp: &tempfile::TempDir,
        roots: &[&str],
    ) -> (Arc<Library>, Vec<Location>, Vec<(std::path::PathBuf, String)>) {
        let fields = [
            ("IMAGETYP", "'LIGHT'"),
            ("FILTER", "'Ha'"),
            ("EXPTIME", "300"),
            ("DATE-OBS", "'2026-09-18T22:00:00'"),
            ("OBJECT", "'M31'"),
            ("RA", "10.684708"),
            ("DEC", "41.26875"),
            ("FOCALLEN", "1"),
            ("XPIXSZ", "3.76"),
        ];
        let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
        let mut locations = Vec::new();
        let mut originals = Vec::new();
        for name in roots {
            let root = temp.path().join(name);
            std::fs::create_dir(&root).unwrap();
            let light = root.join("light.fits");
            super::fixtures::fits(&light, &fields).unwrap();
            originals.push((light.clone(), super::fixtures::digest(&light)));
            let location = library
                .register_location(
                    NativePath::from_path(&root),
                    (*name).into(),
                    LocationRole::Captures,
                )
                .await
                .unwrap();
            locations.push(location);
        }
        (library, locations, originals)
    }

    fn unchanged(originals: &[(std::path::PathBuf, String)]) {
        for (path, digest) in originals {
            assert_eq!(&super::fixtures::digest(path), digest, "{}", path.display());
        }
    }

    #[tokio::test]
    async fn correction_entry_preview_batches_and_confirm_reuses_header_results() {
        let temp = tempfile::tempdir().unwrap();
        let (library, locations, _) = scanned_library(&temp, &["captures"]).await;
        assert_eq!(scan_to_end(&library, locations[0].id).await.state, ScanState::Completed);
        let asset = library.catalog.location_assets(locations[0].id).await.unwrap().remove(0);
        let expected = [ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        }];
        let corrections = [CorrectionInput {
            asset_id: asset.id,
            field: "camera".into(),
            value: serde_json::Value::String("ASI2600".into()),
        }];
        persistence_library::Catalog::reset_correction_entry_batch_reads_for_test();
        let preview = library.preview_correction(&expected, &corrections).await.unwrap();
        assert_eq!(persistence_library::Catalog::correction_entry_batch_reads_for_test(), 1);
        persistence_library::Catalog::reset_correction_entry_batch_reads_for_test();
        library.patched_entry_header_reads.store(0, Ordering::Relaxed);
        library.confirm_correction(preview.id, &expected).await.unwrap();
        assert_eq!(persistence_library::Catalog::correction_entry_batch_reads_for_test(), 1);
        assert_eq!(library.patched_entry_header_reads.load(Ordering::Relaxed), 0);
    }
    #[tokio::test]
    async fn correction_entry_refusal_cache_evicts_older_previews() {
        let temp = tempfile::tempdir().unwrap();
        let (library, locations, _) = scanned_library(&temp, &["captures"]).await;
        assert_eq!(scan_to_end(&library, locations[0].id).await.state, ScanState::Completed);
        let asset = library.catalog.location_assets(locations[0].id).await.unwrap().remove(0);
        let expected = [ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        }];
        let corrections = [CorrectionInput {
            asset_id: asset.id,
            field: "camera".into(),
            value: serde_json::Value::String("ASI2600".into()),
        }];
        let mut oldest_preview = None;
        let mut newest_preview = None;
        for _ in 0..(PATCHED_ENTRY_REFUSAL_CACHE_CAPACITY * 2) {
            let preview = library.preview_correction(&expected, &corrections).await.unwrap();
            oldest_preview.get_or_insert(preview.id);
            newest_preview = Some(preview.id);
        }

        let cache = library.patched_entry_refusals.lock().await;
        assert_eq!(cache.entries.len(), PATCHED_ENTRY_REFUSAL_CACHE_CAPACITY);
        assert!(!cache.entries.contains_key(&oldest_preview.unwrap()));
        assert!(cache.entries.contains_key(&newest_preview.unwrap()));
        assert_eq!(cache.insertion_order.len(), PATCHED_ENTRY_REFUSAL_CACHE_CAPACITY);
    }

    #[tokio::test]
    async fn correction_entry_confirm_without_preview_cache_revalidates_headers() {
        let temp = tempfile::tempdir().unwrap();
        let (library, locations, _) = scanned_library(&temp, &["captures"]).await;
        assert_eq!(scan_to_end(&library, locations[0].id).await.state, ScanState::Completed);
        let asset = library.catalog.location_assets(locations[0].id).await.unwrap().remove(0);
        let expected = [ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        }];
        let corrections = [CorrectionInput {
            asset_id: asset.id,
            field: "camera".into(),
            value: serde_json::Value::String("x".repeat(69)),
        }];
        let preview = library
            .catalog
            .preview_correction(&expected, &corrections, Intake(&FramingMargins::default()))
            .await
            .unwrap();
        persistence_library::Catalog::reset_correction_entry_batch_reads_for_test();
        let result = library.confirm_correction(preview.id, &expected).await;
        assert!(matches!(result, Err(LibraryError::CorrectionUndeliverable { .. })));
        assert_eq!(persistence_library::Catalog::correction_entry_batch_reads_for_test(), 1);
        assert_eq!(library.patched_entry_header_reads.load(Ordering::Relaxed), 1);
    }
    /// A writer committing between the session read and the record of its
    /// assessment is the scan-time race; it is injected here deterministically.
    #[tokio::test]
    async fn a_decision_committed_after_the_session_read_is_refused_then_re_read() {
        let temp = tempfile::tempdir().unwrap();
        let (library, locations, originals) = scanned_library(&temp, &["captures"]).await;
        assert_eq!(scan_to_end(&library, locations[0].id).await.state, ScanState::Completed);
        let sessions = library.catalog.list_sessions(&SessionQuery::default()).await.unwrap();
        let session_id = sessions[0].session.id;
        let stale = library.catalog.session(session_id).await.unwrap();
        let asset = &stale.assets[0];
        let expected = ExpectedAsset {
            asset_id: asset.id,
            decision_revision: asset.decision_revision,
            fingerprint: asset.fingerprint.clone(),
        };
        library
            .catalog
            .set_quality(&[expected], Quality::Usable, InventoryProbe::default())
            .await
            .unwrap();

        let saved = library.saved_targets().await.unwrap();
        let refused = library.record_assessment(&stale, &saved).await.unwrap_err();
        assert!(matches!(refused, LibraryError::Conflict { .. }), "{refused:?}");
        let skipped = library.catalog.session(session_id).await.unwrap();
        assert_eq!(target_basis(&skipped), target_basis(&stale), "nothing recorded");
        assert!(target_basis(&skipped)[&asset.id].content_sha256.is_none());

        library.refresh_session_suggestion(session_id, &saved).await.unwrap();
        let refreshed = library.catalog.session(session_id).await.unwrap();
        let current = &refreshed.assets[0].fingerprint;
        assert!(current.content_sha256.is_some(), "the decision bound the reviewed bytes");
        assert_eq!(&target_basis(&refreshed)[&asset.id], current, "re-read and re-derived");
        unchanged(&originals);
    }

    #[tokio::test]
    async fn conflicting_assessments_are_retried_then_reported_and_marked_for_review() {
        let temp = tempfile::tempdir().unwrap();
        let (library, locations, originals) = scanned_library(&temp, &["captures"]).await;
        assert_eq!(scan_to_end(&library, locations[0].id).await.state, ScanState::Completed);
        let session_id =
            library.catalog.list_sessions(&SessionQuery::default()).await.unwrap()[0].session.id;
        let saved = library.saved_targets().await.unwrap();
        let target_state = |detail: &SessionDetail| {
            detail
                .associations
                .iter()
                .find(|association| association.kind == AssociationKind::Target)
                .map(|association| (association.state.clone(), association.provenance.clone()))
        };

        // Two concurrent writers in a row: the third read records the assessment.
        library.forced_conflicts.store(ASSESSMENT_ATTEMPTS - 1, Ordering::Release);
        library.refresh_session_suggestion(session_id, &saved).await.unwrap();
        assert_eq!(library.forced_conflicts.load(Ordering::Acquire), 0, "every attempt used");
        let recorded = library.catalog.session(session_id).await.unwrap();
        assert_eq!(target_state(&recorded).unwrap().0, AssociationState::Suggested);

        // Conflicting through every re-read: reported, never silently dropped.
        library.forced_conflicts.store(ASSESSMENT_ATTEMPTS, Ordering::Release);
        let error = library.refresh_session_suggestion(session_id, &saved).await.unwrap_err();
        assert!(matches!(error, LibraryError::Conflict { .. }), "{error:?}");
        // The scan's final pass marks the session for review instead.
        library.forced_conflicts.store(ASSESSMENT_ATTEMPTS, Ordering::Release);
        library.refresh_target_suggestions(locations[0].id).await.unwrap();
        let marked = library.catalog.session(session_id).await.unwrap();
        assert_eq!(
            target_state(&marked).unwrap(),
            (
                AssociationState::NeedsReview,
                crate::Provenance::Inferred { rule: "assessment-conflict".into() }
            ),
            "observable instead of a stale Suggested row"
        );

        // A confirmed correction reports it in associationRefresh.
        let expected: Vec<ExpectedAsset> = marked
            .assets
            .iter()
            .map(|asset| ExpectedAsset {
                asset_id: asset.id,
                decision_revision: asset.decision_revision,
                fingerprint: asset.fingerprint.clone(),
            })
            .collect();
        let corrections: Vec<crate::CorrectionInput> = expected
            .iter()
            .map(|asset| crate::CorrectionInput {
                asset_id: asset.asset_id,
                field: "object".into(),
                value: serde_json::json!("M 31"),
            })
            .collect();
        let preview = library.preview_correction(&expected, &corrections).await.unwrap();
        library.forced_conflicts.store(usize::MAX, Ordering::Release);
        let confirmed = library.confirm_correction(preview.id, &expected).await.unwrap();
        let reported = confirmed.association_refresh.expect("the conflict is reported");
        assert_eq!(reported.code.as_str(), "conflict");
        unchanged(&originals);
    }

    /// Walk a location into a still-running scan operation without finishing it.
    async fn walk_without_finishing(library: &Arc<Library>, location: &Location) -> Uuid {
        let operation = library.catalog.begin_scan(location.id, None).await.unwrap();
        let catalog = Arc::clone(&library.catalog);
        let handle = tokio::runtime::Handle::current();
        let walked = location.clone();
        let id = operation.id;
        blocking(move || {
            inventory::scan(
                &walked,
                &ScanOptions::default(),
                |batch| {
                    let identity = inventory::validate_location_root(&walked)?;
                    handle.block_on(catalog.apply_scan_batch(
                        id,
                        &identity,
                        &batch,
                        Intake(&FramingMargins::default()),
                    ))?;
                    Ok(())
                },
                &AtomicBool::new(false),
            )
        })
        .await
        .unwrap();
        id
    }

    async fn hashed(library: &Arc<Library>, locations: &[Location]) -> usize {
        let mut hashed = 0;
        for location in locations {
            for asset in library.catalog.location_assets(location.id).await.unwrap() {
                hashed += usize::from(asset.fingerprint.content_sha256.is_some());
            }
        }
        hashed
    }

    #[tokio::test]
    async fn duplicate_hashing_runs_only_for_readable_uncanceled_walks_and_reports_progress() {
        let temp = tempfile::tempdir().unwrap();
        let (library, locations, originals) = scanned_library(&temp, &["T7", "NAS"]).await;
        assert_eq!(scan_to_end(&library, locations[0].id).await.state, ScanState::Completed);
        let id = walk_without_finishing(&library, &locations[1]).await;
        let clear = Arc::new(AtomicBool::new(false));
        for state in [ScanState::Canceled, ScanState::Failed] {
            library.verify_copies(id, state, &clear).await.unwrap();
        }
        library
            .verify_copies(id, ScanState::Completed, &Arc::new(AtomicBool::new(true)))
            .await
            .unwrap();
        assert_eq!(hashed(&library, &locations).await, 0, "canceled or failed walks hash nothing");

        let mut progress = library.subscribe_scan_progress();
        library.verify_copies(id, ScanState::Completed, &clear).await.unwrap();
        assert_eq!(hashed(&library, &locations).await, 2, "both copies hashed");
        let event = progress.try_recv().expect("a progress event per bound chunk");
        assert_eq!(
            (event.progress.duplicate_candidates, event.progress.duplicates_verified),
            (2, 2)
        );
        unchanged(&originals);
    }

    /// This host's volume under a swappable stable id: the id its handles
    /// report and its probe answers. Counts the probes.
    struct Swappable {
        mounted: Arc<std::sync::Mutex<String>>,
        probes: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl VolumeProbe for Swappable {
        fn probe(&self, path: &Path, meta: &std::fs::Metadata) -> Result<Probed, LibraryError> {
            self.probes.fetch_add(1, Ordering::SeqCst);
            let mut probed = OsVolumes.probe(path, meta)?;
            probed.volume.stable_id = Some(self.mounted.lock().unwrap().clone());
            Ok(probed)
        }

        fn handle_volume_id(&self, _path: &Path) -> Option<String> {
            Some(self.mounted.lock().unwrap().clone())
        }
    }

    /// On Windows each contained read probed the volume three times, each a
    /// PowerShell CIM query (astro-plan-c6fna). The reads of one run probe
    /// each root's volume once, and again when the volume's id changes.
    #[tokio::test]
    async fn a_run_of_reads_probes_each_root_volume_once_and_again_after_a_swap() {
        const READS: usize = 5;
        let temp = tempfile::tempdir().unwrap();
        let (library, locations, originals) = scanned_library(&temp, &["T7", "NAS"]).await;
        let mut assets = Vec::new();
        for location in &locations {
            assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
            assets.extend(library.catalog.location_assets(location.id).await.unwrap());
        }
        let registered = locations[0].identity.volume.stable_id.clone().unwrap();
        let mounted = Arc::new(std::sync::Mutex::new(registered.clone()));
        let probes = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let run = InventoryProbe {
            volumes: Arc::new(VolumeCache::over(Swappable {
                mounted: Arc::clone(&mounted),
                probes: Arc::clone(&probes),
            })),
        };
        let read = |asset: Uuid| library.catalog.open_contained(asset, run.clone(), |_| Ok(()));
        let probe_count = || probes.load(Ordering::SeqCst);

        for _ in 0..READS {
            for asset in &assets {
                read(asset.id).await.unwrap();
            }
        }
        assert_eq!(
            probe_count(),
            locations.len(),
            "{} reads probe each of {} roots once",
            READS * assets.len(),
            locations.len()
        );

        *mounted.lock().unwrap() = "0BADF00D".into();
        let refused = read(assets[0].id).await.unwrap_err();
        assert_eq!(refused.code().as_str(), "identity_conflict", "{refused}");
        assert_eq!(probe_count(), locations.len() + 1, "the swapped volume is probed again");

        *mounted.lock().unwrap() = registered;
        read(assets[0].id).await.unwrap();
        assert_eq!(probe_count(), locations.len() + 1, "the registered volume's probe still holds");
        unchanged(&originals);
    }
}
