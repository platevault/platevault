// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application operations over the clean catalog. Image paths are read-only.

use std::collections::HashMap;
use std::path::Path;
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
    AssociationKind, AssociationState, Availability, FileIdentity, LibraryError, Location,
    LocationRole, NativePath, ObservationFingerprint, RemapReview, Revision, ScanOperation,
    ScanOptions, ScanState, TargetCandidate,
};
use persistence_library::{
    Catalog, CorrectionOutcome, LocationRegistration, SessionDetail, SessionQuery,
    SuggestedAssociation,
};

pub struct Library {
    catalog: Arc<Catalog>,
    targets: Arc<TargetIndex>,
    provider: Option<SimbadTargetResolver>,
    saved_targets: Mutex<Option<(u64, Arc<Vec<TargetCandidate>>)>>,
    scans: Mutex<HashMap<Uuid, ScanControl>>,
    progress: broadcast::Sender<ScanOperation>,
}

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
/// suggestions of the sessions now holding the corrected assets.
///
/// The correction is durable whether or not the refresh succeeds. A failed refresh
/// leaves the catalog's fail-closed `NeedsReview` state in place, and the next
/// scan or correction retries it.
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
    /// of every session that now holds a corrected asset.
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

    async fn refresh_sessions(&self, outcome: &CorrectionOutcome) -> Result<(), LibraryError> {
        let saved = self.saved_targets().await?;
        for session in &outcome.sessions {
            self.refresh_session_suggestion(session.id, &saved).await?;
        }
        Ok(())
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
                self.refresh_session_suggestion(row.session.id, &saved).await?;
            }
            if count < 1000 {
                return Ok(());
            }
            offset = offset.checked_add(count).ok_or_else(|| {
                LibraryError::PersistenceFailure("session index exceeds u32".into())
            })?;
        }
    }

    async fn refresh_session_suggestion(
        &self,
        session_id: Uuid,
        saved: &[TargetCandidate],
    ) -> Result<(), LibraryError> {
        let detail = self.catalog.session(session_id).await?;
        let frames = detail.assets.iter().map(|asset| asset.effective.clone()).collect::<Vec<_>>();
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
        self.catalog
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
            .await?;
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
