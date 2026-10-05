// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application operations over the clean catalog. Image paths are read-only.

use std::collections::{BTreeSet, HashMap};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::{broadcast, Mutex};
use uuid::Uuid;

use crate::grouping::group_assets;
use crate::inventory;
use crate::targets::{
    SimbadConfig, SimbadTargetResolver, TargetAssessment, TargetIndex, TargetQuery, TargetSearchHit,
};
use crate::{
    AssetReference, AssociationKind, AssociationState, Availability, FileIdentity, LibraryError,
    Location, LocationRole, NativePath, ObservationFingerprint, ReferenceKind, RemapReview,
    RetireReview, Revision, ScanOperation, ScanOptions, ScanState, TargetCandidate,
};
use persistence_library::{
    Catalog, CorrectionOutcome, LocationReferences, LocationRegistration, SessionDetail,
    SessionQuery, SuggestedAssociation,
};

/// What [`AssetReferences::references_to`] returns.
pub type ReferencesFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<AssetReference>, LibraryError>> + Send + 'a>>;

/// The seam VSEL (fixed View memberships and prepared revisions), PRJ (Projects)
/// and RES (Results) implement for the records that hold library asset ids.
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
    catalog: Arc<Catalog>,
    targets: Arc<TargetIndex>,
    provider: Option<SimbadTargetResolver>,
    saved_targets: Mutex<Option<(u64, Arc<Vec<TargetCandidate>>)>>,
    scans: Mutex<HashMap<Uuid, ScanControl>>,
    progress: broadcast::Sender<ScanOperation>,
    references: tokio::sync::RwLock<Vec<Arc<dyn AssetReferences>>>,
    /// Test-only: the next N assessments are refused as if a concurrent writer
    /// had committed between the session read and the record.
    #[cfg(test)]
    forced_conflicts: std::sync::atomic::AtomicUsize,
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
pub struct ConfirmedCorrection {
    #[serde(flatten)]
    pub outcome: CorrectionOutcome,
    pub association_refresh: Option<crate::ErrorResponse>,
}

pub struct InventoryProbe;

impl persistence_library::SourceProbe for InventoryProbe {
    fn fingerprint(&self, path: &Path) -> Result<ObservationFingerprint, LibraryError> {
        inventory::probe_fingerprint(path)
    }

    fn root_identity(&self, location: &Location) -> Result<FileIdentity, LibraryError> {
        inventory::validate_location_root(location)
    }
}

impl Library {
    /// Open a fresh-schema catalog and load the offline target dataset.
    /// Interrupted scan recovery is owned by the catalog.
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
        Ok(Arc::new(Self {
            catalog,
            targets: Arc::new(targets),
            provider,
            scans: Mutex::new(HashMap::new()),
            saved_targets: Mutex::new(None),
            progress,
            references: tokio::sync::RwLock::new(Vec::new()),
            #[cfg(test)]
            forced_conflicts: std::sync::atomic::AtomicUsize::new(0),
        }))
    }

    #[must_use]
    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    #[must_use]
    pub fn subscribe_scan_progress(&self) -> broadcast::Receiver<ScanOperation> {
        self.progress.subscribe()
    }

    #[must_use]
    pub fn seed_target(&self, id: Uuid) -> Option<TargetCandidate> {
        self.targets.candidate(id)
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
        let identity = blocking(move || inventory::observe_root_identity(&root)).await?;
        self.catalog.review_remap(location_id, expected, &proposed, &identity, InventoryProbe).await
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
        let identity = blocking(move || inventory::observe_root_identity(&root)).await?;
        self.catalog.register_location(&LocationRegistration { name, path, role, identity }).await
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
        self.catalog.reselect_location(id, expected, &path, &identity).await
    }

    /// Register a feature's records that hold asset ids (see [`AssetReferences`]).
    pub async fn register_references(&self, source: Arc<dyn AssetReferences>) {
        self.references.write().await.push(source);
    }

    /// Durably review Retire location, naming the Views, Projects and Results of
    /// every registered source that hold its copies. No file or record changes.
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
        self.catalog.retire_location(review_id, location_id, expected, &references).await
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
        self.supervise_scan(&operation, relative_scope).await;
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
        self.supervise_scan(&operation, Some(scope)).await;
        Ok(operation)
    }

    async fn supervise_scan(
        self: &Arc<Self>,
        operation: &ScanOperation,
        relative_scope: Option<NativePath>,
    ) {
        let canceled = Arc::new(AtomicBool::new(false));
        self.scans.lock().await.insert(
            operation.id,
            ScanControl { canceled: Arc::clone(&canceled), pending_failure: None },
        );
        let library = Arc::clone(self);
        let id = operation.id;
        tokio::spawn(async move {
            let outcome = library.run_scan(id, relative_scope, &canceled).await;
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

    async fn saved_targets(&self) -> Result<Arc<Vec<TargetCandidate>>, LibraryError> {
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

    /// Confirm a reviewed correction preview, then re-derive the target suggestion
    /// of every resulting session: those holding a corrected asset and every
    /// successor of the regroup.
    ///
    /// # Errors
    /// Returns the catalog's confirmation errors; a refresh failure after commit is
    /// reported in [`ConfirmedCorrection::association_refresh`] instead.
    pub async fn confirm_correction(
        &self,
        preview_id: Uuid,
        expected: &[crate::ExpectedAsset],
    ) -> Result<ConfirmedCorrection, LibraryError> {
        let outcome = self.catalog.confirm_correction(preview_id, expected, group_assets).await?;
        let association_refresh = match self.refresh_sessions(&outcome).await {
            Ok(()) => None,
            Err(error) => Some(error.response(Some(preview_id), None)),
        };
        Ok(ConfirmedCorrection { outcome, association_refresh })
    }

    /// Refresh every resulting session; the first failure is reported after the
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
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |left| left.checked_sub(1))
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
        for chunk in work.chunks(COPY_CHUNK) {
            if canceled.load(Ordering::Acquire) {
                break;
            }
            let status = self
                .catalog
                .verify_duplicate_candidates(id, chunk, InventoryProbe, Arc::clone(canceled))
                .await?;
            let _ = self.progress.send(status);
        }
        Ok(())
    }

    async fn run_scan(
        self: &Arc<Self>,
        id: Uuid,
        relative_scope: Option<NativePath>,
        canceled: &Arc<AtomicBool>,
    ) -> Result<(), LibraryError> {
        let operation = self.catalog.scan_status(id).await?;
        let location = self.catalog.location(operation.location_id).await?;
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
                        group_assets,
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
                        group_assets,
                    ))
                })
                .await?;
                self.refresh_target_suggestions(location.id).await?;
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

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, LibraryError> + Send + 'static,
) -> Result<T, LibraryError> {
    tokio::task::spawn_blocking(work).await.map_err(|error| {
        LibraryError::SourceUnavailable(format!("library worker interrupted: {error}"))
    })?
}

fn root_failure(error: &LibraryError) -> Option<Availability> {
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
mod fixtures;

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::time::Duration;

    use super::*;
    use crate::{ExpectedAsset, Quality};

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

    async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
        let mut progress = library.subscribe_scan_progress();
        let started = library.start_scan(location, None).await.unwrap();
        tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                let operation = progress.recv().await.unwrap();
                if operation.id == started.id && operation.state != ScanState::Running {
                    return operation;
                }
            }
        })
        .await
        .expect("scan must publish its terminal state")
    }

    fn unchanged(originals: &[(std::path::PathBuf, String)]) {
        for (path, digest) in originals {
            assert_eq!(&super::fixtures::digest(path), digest, "{}", path.display());
        }
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
        library.catalog.set_quality(&[expected], Quality::Usable, InventoryProbe).await.unwrap();

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
        let preview = library
            .catalog
            .preview_correction(&expected, &corrections, group_assets)
            .await
            .unwrap();
        library.forced_conflicts.store(usize::MAX, Ordering::Release);
        let confirmed = library.confirm_correction(preview.id, &expected).await.unwrap();
        let reported = confirmed.association_refresh.expect("the conflict is reported");
        assert_eq!(reported.kind, "conflict");
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
                        group_assets,
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
}
