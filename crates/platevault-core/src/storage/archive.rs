// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Archive of a Done Project's sessions and the reviewed restore of archived
//! ones (spec 071 STO-FR-06/07/08/13, STO-AC-05/07/10/17/22; spec 065
//! PRJ-AC-27; D06, D19, D-W20, D-W46, D-W69).
//!
//! Review lays every frame copy of each session the Done / Archive sheet
//! offers out by the naming templates, records its source snapshot, the
//! prepared entries of any run that read it and the destination's volume,
//! free space and writability, and holds back what cannot go. Execution never
//! trusts the review: it re-checks the sheet's kept sessions, the destination
//! volume and each record before anything is written. Each item then runs
//! through the verified-transfer journal (a Move): the copy is written and
//! re-read, every reference is updated (a prepared link is rebuilt to the new
//! path, the frame's catalog record is repointed with its decisions and
//! memberships), and only after every reference re-verifies is the source
//! retired to the OS Trash, which re-verifies the source and destination
//! again (D19). A failed check retains the source. Restore runs the same
//! transfer back to the path each frame left.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use persistence_library::{
    ArchiveAsset, ArchiveItemChange, ArchiveRecord, ArchiveRepoint, EntryReference, EntryRepoint,
    NewArchiveItem, NewArchiveTransfer,
};
use uuid::Uuid;

use crate::custody::trash::OsTrash;
use crate::custody::{in_place, observe_entry, same_identity};
use crate::import::{classify, naming_metadata, writability};
use crate::library::{blocking, Library};
use crate::{
    inventory, ArchiveDestination, ArchiveHold, ArchiveItem, ArchiveKind, ArchiveOutcome,
    ArchivePhase, ArchiveReference, ArchiveState, ArchiveTransfer, ArchivedFrame, Asset,
    Availability, EntryEvidence, EntryKind, EntryState, ItemChange, ItemOutcome, ItemPhase,
    ItemReason, LibraryError, Location, LocationLifecycle, NamingFallback, NativePath,
    ObservationFingerprint, PreparedEntryKind, ReasonCode, ReferenceState, ReferenceUpdate,
    SessionArchiveState, SessionArchiveStatus, StorageItem, StorageItemDraft, StorageOperation,
    StorageOperationKind, StorageOperationState, TransferDestination, Writability,
};

/// Projects whose Done / Archive custody step runs in this process now.
static CLAIMED: LazyLock<Mutex<HashSet<Uuid>>> = LazyLock::new(Mutex::default);

/// Exclusive claim on a Project's Done / Archive custody: one Archive,
/// restore or trash move at a time; released on drop.
pub(super) struct CustodyClaim(Uuid);

impl CustodyClaim {
    pub(super) fn claim(project: Uuid) -> Result<Self, LibraryError> {
        let claimed =
            CLAIMED.lock().unwrap_or_else(std::sync::PoisonError::into_inner).insert(project);
        if !claimed {
            return Err(LibraryError::InvalidInput(format!(
                "an Archive transfer or trash move of Project {project} is running; it must \
                 settle first"
            )));
        }
        Ok(Self(project))
    }
}

impl Drop for CustodyClaim {
    fn drop(&mut self) {
        CLAIMED.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&self.0);
    }
}

impl Library {
    /// Review Archive of Done Project `project_id`'s member sessions to the
    /// registered location `destination` (STO-FR-06, STO-FR-13): every live
    /// copy of each session the sheet offers, laid out by the naming
    /// templates, with its source snapshot and the prepared entries that read
    /// it. The sessions the sheet keeps are listed with the Projects that use
    /// them. Records the review; writes and moves nothing.
    ///
    /// # Errors
    /// `InvalidInput` for a Project that is not Done, a retired destination,
    /// or nothing to archive; `NotFound` for an unknown Project or location.
    pub async fn archive_review(
        &self,
        project_id: Uuid,
        destination: Uuid,
    ) -> Result<ArchiveTransfer, LibraryError> {
        let sheet = self.done_archive_review(project_id).await?;
        let location = self.catalog().location(destination).await?;
        if location.lifecycle != LocationLifecycle::Active {
            return Err(LibraryError::InvalidInput(format!(
                "location '{}' is retired; Archive writes only to an active location",
                location.name
            )));
        }
        let sessions: BTreeSet<Uuid> = sheet.archive.sessions.iter().copied().collect();
        if sessions.is_empty() {
            return Err(LibraryError::InvalidInput(
                "the Done / Archive sheet offers no session to archive: every member session is \
                 kept by a Project that is not Done"
                    .into(),
            ));
        }
        let assets = self.catalog().archive_assets(&sessions).await?;
        let mut plan = Plan::new(self, &assets).await?;
        let mut items = Vec::with_capacity(assets.len());
        for asset in &assets {
            let layout = self.layout(asset).await?;
            items.push(plan.item(self, asset.session_id, &asset.asset, &location, layout).await?);
        }
        let kept = sheet.archive.kept;
        let input = plan
            .finish(ArchiveKind::Archive, project_id, sheet.project_revision, kept, items)
            .await?;
        Ok(self.catalog().record_archive_transfer(&input).await?.transfer)
    }

    /// Review the restore of archived `sessions` to the paths their frames
    /// left (STO-FR-13): the same verified transfer as Archive, back. Records
    /// the review; writes and moves nothing.
    ///
    /// # Errors
    /// `InvalidInput` for no session, a session with no archived frame, or
    /// sessions that different Projects archived.
    pub async fn archive_restore_review(
        &self,
        sessions: &[Uuid],
    ) -> Result<ArchiveTransfer, LibraryError> {
        let wanted: BTreeSet<Uuid> = sessions.iter().copied().collect();
        if wanted.is_empty() {
            return Err(LibraryError::InvalidInput("choose an archived session to restore".into()));
        }
        let frames = self.catalog().session_frames(&wanted).await?;
        let archived: Vec<_> = frames
            .iter()
            .filter_map(|frame| {
                let repoint = frame.repoint.as_ref()?;
                at_archive(&frame.asset, repoint).then_some((frame, repoint))
            })
            .collect();
        for session in &wanted {
            if !archived.iter().any(|(frame, _)| frame.session_id == *session) {
                return Err(LibraryError::InvalidInput(format!(
                    "session {session} has no frame at an archive path to restore"
                )));
            }
        }
        let projects: BTreeSet<Uuid> =
            archived.iter().map(|(_, repoint)| repoint.project.id).collect();
        let [project_id] = projects.into_iter().collect::<Vec<_>>()[..] else {
            return Err(LibraryError::InvalidInput(
                "restore the sessions of one Project's Archive at a time".into(),
            ));
        };
        let project = self.catalog().project(project_id).await?;
        let assets: Vec<ArchiveAsset> = archived
            .iter()
            .map(|(frame, _)| ArchiveAsset {
                session_id: frame.session_id,
                asset: frame.asset.clone(),
                target: None,
            })
            .collect();
        let mut plan = Plan::new(self, &assets).await?;
        let mut items = Vec::with_capacity(archived.len());
        for (frame, repoint) in &archived {
            let location = self.catalog().location(repoint.source_location_id).await?;
            let layout = Ok((repoint.source_path.clone(), Vec::new()));
            items.push(plan.item(self, frame.session_id, &frame.asset, &location, layout).await?);
        }
        let input = plan
            .finish(ArchiveKind::Restore, project_id, project.revision, Vec::new(), items)
            .await?;
        Ok(self.catalog().record_archive_transfer(&input).await?.transfer)
    }

    /// Execute or resume a reviewed Archive or restore transfer until every
    /// item has an outcome. Starting re-checks the review against the
    /// catalog, the sheet and the destination volume; an item that no longer
    /// holds is held back, and a destination that changed refuses the start
    /// with nothing written. Items that end blocked or source-retained do not
    /// stop the others. Calling it again on an interrupted transfer resumes
    /// each item from its recorded phase.
    ///
    /// # Errors
    /// `InvalidInput` while a custody step of the same Project runs, or when
    /// the Project of an Archive is no longer Done; `IdentityConflict` when a
    /// destination is no longer the reviewed volume; journal and catalog
    /// failures.
    pub async fn archive_execute(
        &self,
        id: Uuid,
        trash: Arc<dyn OsTrash>,
    ) -> Result<ArchiveTransfer, LibraryError> {
        let record = self.catalog().archive_record(id).await?;
        let _claim = CustodyClaim::claim(record.transfer.project.id)?;
        let record = self.catalog().archive_record(id).await?;
        match record.transfer.state {
            ArchiveState::Settled => return Ok(record.transfer),
            ArchiveState::Reviewed => {
                if self.start(record).await?.transfer.state == ArchiveState::Settled {
                    return Ok(self.catalog().archive_record(id).await?.transfer);
                }
            }
            ArchiveState::Running => {}
        }
        self.advance(id, &trash).await?;
        Ok(self.catalog().archive_record(id).await?.transfer)
    }

    /// A transfer as review recorded it, with each item's current phase.
    ///
    /// # Errors
    /// `NotFound` for an unknown transfer.
    pub async fn archive_transfer(&self, id: Uuid) -> Result<ArchiveTransfer, LibraryError> {
        Ok(self.catalog().archive_record(id).await?.transfer)
    }

    /// Whether each of `sessions` shows as Archived (STO-FR-13, PRJ-AC-27):
    /// its live frames that an Archive moved and no restore moved back, at
    /// their archive paths, Offline while the archive volume is unmounted.
    /// Reopening the Project changes nothing here.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn session_archive_state(
        &self,
        sessions: &[Uuid],
    ) -> Result<Vec<SessionArchiveState>, LibraryError> {
        let wanted: BTreeSet<Uuid> = sessions.iter().copied().collect();
        let frames = self.catalog().session_frames(&wanted).await?;
        let names: HashMap<Uuid, String> = self
            .catalog()
            .list_locations()
            .await?
            .into_iter()
            .map(|location| (location.id, location.name))
            .collect();
        let mut seen = HashSet::new();
        Ok(sessions
            .iter()
            .filter(|session| seen.insert(**session))
            .map(|session| {
                let live: Vec<_> =
                    frames.iter().filter(|frame| frame.session_id == *session).collect();
                let archived: Vec<ArchivedFrame> = live
                    .iter()
                    .filter_map(|frame| {
                        let repoint = frame.repoint.as_ref()?;
                        at_archive(&frame.asset, repoint).then(|| ArchivedFrame {
                            asset_id: frame.asset.id,
                            location_id: frame.asset.location_id,
                            location_name: names
                                .get(&frame.asset.location_id)
                                .cloned()
                                .unwrap_or_default(),
                            path: frame.asset.relative_path.clone(),
                            availability: frame.asset.availability,
                            transfer_id: repoint.transfer_id,
                            project: repoint.project.clone(),
                            archived_at: repoint.repointed_at.clone(),
                        })
                    })
                    .collect();
                let status = if archived.is_empty() {
                    SessionArchiveStatus::NotArchived
                } else if archived.len() == live.len() {
                    SessionArchiveStatus::Archived
                } else {
                    SessionArchiveStatus::PartlyArchived
                };
                SessionArchiveState { session_id: *session, status, archived }
            })
            .collect())
    }

    /// The templated destination of an archived frame: its type's template
    /// folder, then its file name. The `{target}` token reads the header's
    /// OBJECT, else the session's confirmed Target.
    async fn layout(
        &self,
        asset: &ArchiveAsset,
    ) -> Result<Result<(NativePath, Vec<NamingFallback>), ArchiveHold>, LibraryError> {
        let frame = &asset.asset;
        let Some(frame_type) = classify(&frame.effective, &frame.relative_path) else {
            return Ok(Err(ArchiveHold::Naming {
                detail: "the frame has no frame-type header to choose its template".into(),
            }));
        };
        let mut metadata = naming_metadata(&frame.effective, frame_type);
        if metadata.target.is_none() {
            metadata.target.clone_from(&asset.target);
        }
        let resolution = match self.resolve_naming(frame_type, &metadata).await {
            Ok(resolution) => resolution,
            Err(LibraryError::InvalidInput(detail)) => {
                return Ok(Err(ArchiveHold::Naming { detail }))
            }
            Err(error) => return Err(error),
        };
        let source = frame.relative_path.relative_path()?;
        let name = source.file_name().ok_or_else(|| {
            LibraryError::InvalidInput(format!("{} names no file", source.display()))
        })?;
        let mut relative = PathBuf::new();
        for segment in resolution.relative_path.split('/').filter(|part| !part.is_empty()) {
            relative.push(segment);
        }
        relative.push(name);
        Ok(Ok((NativePath::from_path(&relative), resolution.fallbacks)))
    }

    /// Start a reviewed transfer: re-check every item and destination, hold
    /// back what no longer holds, and record the journal operation that
    /// transfers the rest.
    async fn start(&self, record: ArchiveRecord) -> Result<ArchiveRecord, LibraryError> {
        let transfer = &record.transfer;
        let kept: HashMap<Uuid, ArchiveHold> = match transfer.kind {
            ArchiveKind::Archive => {
                let sheet = self.done_archive_review(transfer.project.id).await?;
                let mut kept: HashMap<Uuid, ArchiveHold> = sheet
                    .archive
                    .kept
                    .into_iter()
                    .map(|session| {
                        (session.session_id, ArchiveHold::Kept { projects: session.projects })
                    })
                    .collect();
                let members: HashSet<Uuid> = sheet.archive.sessions.into_iter().collect();
                for item in &transfer.items {
                    if !members.contains(&item.session_id) && !kept.contains_key(&item.session_id) {
                        kept.insert(
                            item.session_id,
                            ArchiveHold::Changed {
                                detail: "the session is no longer a member session of the Project"
                                    .into(),
                            },
                        );
                    }
                }
                kept
            }
            ArchiveKind::Restore => HashMap::new(),
        };
        let open: Vec<(&ArchiveItem, &persistence_library::ArchiveItemState)> = transfer
            .items
            .iter()
            .zip(&record.states)
            .filter(|(item, _)| item.outcome.is_none())
            .collect();
        let locations = self.locations_of(&transfer.items).await?;
        self.recheck_destinations(transfer, &open, &locations).await?;
        let assets: BTreeSet<Uuid> = open.iter().map(|(item, _)| item.asset_id).collect();
        let now = references_by_asset(self.catalog().entry_references(&assets).await?);
        let mut holds = Vec::new();
        let mut drafts = Vec::new();
        let mut seqs = Vec::new();
        for (item, state) in open {
            if let Some(kept) = kept.get(&item.session_id) {
                holds.push((item.seq, kept.clone(), None));
                continue;
            }
            match self.recheck_item(item, state.evidence.as_ref(), &now, &locations).await? {
                Err(changed) => holds.push((item.seq, changed, None)),
                Ok(draft) => {
                    seqs.push((item.seq, u32::try_from(drafts.len()).map_err(|_| too_many())?));
                    drafts.push(draft);
                }
            }
        }
        if drafts.is_empty() {
            return self.catalog().start_archive_transfer(transfer.id, &holds, None).await;
        }
        let operation =
            self.catalog().record_storage_operation(StorageOperationKind::Move, &drafts).await?;
        self.catalog()
            .start_archive_transfer(transfer.id, &holds, Some((operation.id, &seqs)))
            .await
    }

    async fn locations_of(
        &self,
        items: &[ArchiveItem],
    ) -> Result<HashMap<Uuid, Location>, LibraryError> {
        let mut locations = HashMap::new();
        for id in
            items.iter().flat_map(|item| [item.source_location_id, item.destination_location_id])
        {
            if let std::collections::hash_map::Entry::Vacant(entry) = locations.entry(id) {
                entry.insert(self.catalog().location(id).await?);
            }
        }
        Ok(locations)
    }

    /// Each destination must still be the reviewed volume and folder,
    /// writable, with room for what is still to be written; otherwise
    /// nothing starts.
    async fn recheck_destinations(
        &self,
        transfer: &ArchiveTransfer,
        open: &[(&ArchiveItem, &persistence_library::ArchiveItemState)],
        locations: &HashMap<Uuid, Location>,
    ) -> Result<(), LibraryError> {
        for reviewed in &transfer.destinations {
            let needed: u64 = open
                .iter()
                .filter(|(item, _)| item.destination_location_id == reviewed.location_id)
                .map(|(item, _)| item.size_bytes)
                .sum();
            if needed == 0 {
                continue;
            }
            let location = locations.get(&reviewed.location_id).cloned().ok_or_else(|| {
                LibraryError::NotFound(format!("location {}", reviewed.location_id))
            })?;
            if location.lifecycle != LocationLifecycle::Active {
                return Err(LibraryError::InvalidInput(format!(
                    "location '{}' is retired",
                    location.name
                )));
            }
            let observed = observe_destination(location, needed).await?;
            if let Some(blocked) = observed.blocked {
                return Err(LibraryError::InvalidInput(format!(
                    "nothing is written to '{}': {blocked}",
                    reviewed.name
                )));
            }
            if observed.identity != reviewed.identity {
                return Err(LibraryError::IdentityConflict(format!(
                    "a different volume or folder is mounted at '{}' than the transfer reviewed; \
                     review it again",
                    reviewed.name
                )));
            }
        }
        Ok(())
    }

    /// Never trust the review: the catalog record must still be where and
    /// what review recorded, and the prepared entries that read it the same.
    async fn recheck_item(
        &self,
        item: &ArchiveItem,
        evidence: Option<&EntryEvidence>,
        references: &HashMap<Uuid, Vec<EntryReference>>,
        locations: &HashMap<Uuid, Location>,
    ) -> Result<Result<StorageItemDraft, ArchiveHold>, LibraryError> {
        let changed = |detail: &str| Ok(Err(ArchiveHold::Changed { detail: detail.into() }));
        let Some(evidence) = evidence else {
            return changed("the item has no reviewed snapshot");
        };
        let asset = self.catalog().asset(item.asset_id).await?;
        if asset.location_id != item.source_location_id || asset.relative_path != item.source_path {
            return changed("the frame's catalog record moved since review");
        }
        if !same_observation(&asset.fingerprint, &evidence.fingerprint) {
            return changed("the frame's catalog record changed since review");
        }
        if asset.availability != Availability::Available {
            return Ok(Err(ArchiveHold::Unavailable { availability: asset.availability }));
        }
        let current: BTreeSet<(Uuid, u32)> = references
            .get(&item.asset_id)
            .into_iter()
            .flatten()
            .filter(|entry| tracked(entry))
            .map(|entry| (entry.preparation_id, entry.seq))
            .collect();
        let reviewed: BTreeSet<(Uuid, u32)> = item
            .references
            .iter()
            .map(|reference| (reference.preparation_id, reference.entry_seq))
            .collect();
        if current != reviewed {
            return changed("the prepared entries that read the frame changed since review");
        }
        if let Some(occupant) = self
            .catalog()
            .asset_recorded_at(item.destination_location_id, &item.destination_path)
            .await?
        {
            if occupant != item.asset_id {
                return Ok(Err(ArchiveHold::Occupied { path: item.destination_path.clone() }));
            }
        }
        let root = &locations
            .get(&item.destination_location_id)
            .ok_or_else(|| {
                LibraryError::NotFound(format!("location {}", item.destination_location_id))
            })?
            .path;
        Ok(Ok(StorageItemDraft {
            source: evidence.clone(),
            relied_on: Vec::new(),
            destination: Some(TransferDestination {
                root: root.clone(),
                relative: item.destination_path.clone(),
            }),
        }))
    }

    /// Advance a running transfer through its journal until it settles.
    async fn advance(&self, id: Uuid, trash: &Arc<dyn OsTrash>) -> Result<(), LibraryError> {
        loop {
            let record = self.catalog().archive_record(id).await?;
            if record.transfer.state != ArchiveState::Running {
                return Ok(());
            }
            let op_id = record.transfer.storage_operation_id.ok_or_else(|| {
                LibraryError::PersistenceFailure(format!("running transfer {id} has no journal"))
            })?;
            let operation = self.catalog().storage_operation(op_id).await?;
            if self.take_outcomes(&record, &operation).await? {
                continue;
            }
            let Some(next) = operation.items.iter().find(|item| item.outcome.is_none()) else {
                if operation.state != StorageOperationState::Settled {
                    self.catalog().settle_storage_operation(op_id).await?;
                }
                self.catalog().settle_archive_transfer(id).await?;
                return Ok(());
            };
            let (item, state) = record
                .transfer
                .items
                .iter()
                .zip(&record.states)
                .find(|(_, state)| state.journal_seq == Some(next.seq))
                .ok_or_else(|| {
                    LibraryError::PersistenceFailure(format!(
                        "journal item {} of transfer {id} names no transfer item",
                        next.seq
                    ))
                })?;
            if item.outcome.is_some() {
                // The item settled before its journal item did: settle that too.
                let reason = item.reason.clone().unwrap_or_else(|| {
                    ItemReason::new(
                        ReasonCode::Interrupted,
                        "the transfer item settled before its journal",
                    )
                });
                self.settle_journal(op_id, next, reason).await?;
                continue;
            }
            match (next.phase, item.phase) {
                (ItemPhase::DestinationVerified, ArchivePhase::Pending) => {
                    let change = ArchiveItemChange {
                        phase: ArchivePhase::DestinationVerified,
                        outcome: None,
                        reason: None,
                        references: item.references.clone(),
                    };
                    self.catalog()
                        .advance_archive_item(id, item.seq, state.revision, &change)
                        .await?;
                }
                (
                    ItemPhase::DestinationVerified,
                    ArchivePhase::DestinationVerified | ArchivePhase::Repairing,
                ) => {
                    self.repair(&record, item, state.revision, op_id, next, trash).await?;
                }
                (ItemPhase::DestinationVerified, ArchivePhase::ReferenceUpdated) => {
                    match self.references_hold(item).await? {
                        Ok(()) => {
                            self.step_storage_operation(op_id, Arc::clone(trash)).await?;
                        }
                        Err(reason) => {
                            self.settle_journal(op_id, next, reason.clone()).await?;
                            self.settle_item(
                                id,
                                item,
                                state.revision,
                                ArchiveOutcome::SourceRetained,
                                reason,
                                item.references.clone(),
                            )
                            .await?;
                        }
                    }
                }
                _ => {
                    self.step_storage_operation(op_id, Arc::clone(trash)).await?;
                }
            }
        }
    }

    /// Take each settled journal item's outcome into its open transfer item.
    /// Returns whether anything changed.
    async fn take_outcomes(
        &self,
        record: &ArchiveRecord,
        operation: &StorageOperation,
    ) -> Result<bool, LibraryError> {
        let mut changed = false;
        for (item, state) in record.transfer.items.iter().zip(&record.states) {
            let Some(journal) = state.journal_seq.and_then(|seq| operation.items.get(index(seq)))
            else {
                continue;
            };
            let (None, Some(outcome)) = (item.outcome, journal.outcome) else { continue };
            let verified = matches!(
                item.phase,
                ArchivePhase::DestinationVerified
                    | ArchivePhase::Repairing
                    | ArchivePhase::ReferenceUpdated
            );
            let outcome = match outcome {
                ItemOutcome::Moved => ArchiveOutcome::Archived,
                ItemOutcome::SourceKept => ArchiveOutcome::SourceRetained,
                ItemOutcome::Blocked if verified => ArchiveOutcome::SourceRetained,
                ItemOutcome::Blocked => ArchiveOutcome::Blocked,
                ItemOutcome::Uncertain | ItemOutcome::Trashed | ItemOutcome::Copied => {
                    ArchiveOutcome::Uncertain
                }
            };
            let change = ArchiveItemChange {
                phase: ArchivePhase::Settled,
                outcome: Some(outcome),
                reason: journal.reason.clone(),
                references: item.references.clone(),
            };
            self.catalog()
                .advance_archive_item(record.transfer.id, item.seq, state.revision, &change)
                .await?;
            changed = true;
        }
        Ok(changed)
    }

    async fn settle_journal(
        &self,
        op_id: Uuid,
        item: &StorageItem,
        reason: ItemReason,
    ) -> Result<(), LibraryError> {
        let change = ItemChange {
            phase: ItemPhase::Settled,
            outcome: Some(ItemOutcome::Blocked),
            reason: Some(reason),
            written: item.written.clone(),
        };
        self.catalog().advance_storage_item(op_id, item.seq, item.revision, &change).await?;
        Ok(())
    }

    async fn settle_item(
        &self,
        id: Uuid,
        item: &ArchiveItem,
        revision: u64,
        outcome: ArchiveOutcome,
        reason: ItemReason,
        references: Vec<ArchiveReference>,
    ) -> Result<(), LibraryError> {
        let change = ArchiveItemChange {
            phase: ArchivePhase::Settled,
            outcome: Some(outcome),
            reason: Some(reason),
            references,
        };
        self.catalog().advance_archive_item(id, item.seq, revision, &change).await?;
        Ok(())
    }

    /// Update every reference of a destination-verified item: rebuild each
    /// prepared link to the destination, then, when every reference is
    /// updated, repoint the frame's catalog record with the entries in one
    /// transaction. Any reference that cannot be updated retains the source.
    async fn repair(
        &self,
        record: &ArchiveRecord,
        item: &ArchiveItem,
        revision: u64,
        op_id: Uuid,
        journal: &StorageItem,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<(), LibraryError> {
        let id = record.transfer.id;
        let locations = self.locations_of(std::slice::from_ref(item)).await?;
        let destination =
            absolute(&locations, item.destination_location_id, &item.destination_path)?;
        let resumed = item.phase == ArchivePhase::Repairing;
        let mut revision = revision;
        if !resumed {
            let change = ArchiveItemChange {
                phase: ArchivePhase::Repairing,
                outcome: None,
                reason: None,
                references: item.references.clone(),
            };
            let updated =
                self.catalog().advance_archive_item(id, item.seq, revision, &change).await?;
            revision = state_of(&updated, item.seq)?.revision;
        }
        let retained = Retained { op_id, journal, id, item, revision };
        let Some(fingerprint) = verified_copy(item, journal, &destination).await? else {
            let reason = ItemReason::new(
                ReasonCode::DestinationChanged,
                format!("{} no longer holds the verified copy", destination.display()),
            );
            return self.retain(&retained, reason, blocked_all(&item.references)).await;
        };
        let updates =
            self.update_references(item, &destination, &fingerprint, resumed, trash).await?;
        if let Some(blocked) =
            updates.references.iter().find_map(|reference| reference.reason.clone())
        {
            // The links that were rebuilt read the verified copy now; record that.
            self.catalog().record_entry_repoints(&updates.rebuilt).await?;
            return self.retain(&retained, blocked, updates.references).await;
        }
        let evidence = state_of(record, item.seq)?.evidence.as_ref().ok_or_else(|| {
            LibraryError::PersistenceFailure("transfer item without its snapshot".into())
        })?;
        let repoint = ArchiveRepoint {
            asset_id: item.asset_id,
            from_location_id: item.source_location_id,
            from_path: item.source_path.clone(),
            from_fingerprint: ObservationFingerprint {
                content_sha256: evidence.sha256.clone(),
                ..evidence.fingerprint.clone()
            },
            to_location_id: item.destination_location_id,
            to_path: item.destination_path.clone(),
            to_fingerprint: fingerprint,
            entries: updates.repoints,
        };
        match self
            .catalog()
            .repoint_archive_item(id, item.seq, revision, &repoint, &updates.references)
            .await
        {
            Ok(_) => Ok(()),
            Err(LibraryError::IdentityConflict(detail)) => {
                self.catalog().record_entry_repoints(&updates.rebuilt).await?;
                let reason = ItemReason::new(ReasonCode::DestinationMismatch, detail);
                self.retain(&retained, reason, updates.references).await
            }
            Err(error) => Err(error),
        }
    }

    /// Settle an item whose destination verified Source-retained, with its
    /// journal item, naming why its source stays.
    async fn retain(
        &self,
        retained: &Retained<'_>,
        reason: ItemReason,
        references: Vec<ArchiveReference>,
    ) -> Result<(), LibraryError> {
        self.settle_journal(retained.op_id, retained.journal, reason.clone()).await?;
        self.settle_item(
            retained.id,
            retained.item,
            retained.revision,
            ArchiveOutcome::SourceRetained,
            reason,
            references,
        )
        .await
    }

    /// Update each reference of `item` to read the verified copy at
    /// `destination`, recording what each one now reads.
    async fn update_references(
        &self,
        item: &ArchiveItem,
        destination: &Path,
        fingerprint: &ObservationFingerprint,
        resumed: bool,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<Updates, LibraryError> {
        let source_evidence = EntryEvidence {
            path: NativePath::from_path(destination),
            kind: EntryKind::File,
            fingerprint: ObservationFingerprint { content_sha256: None, ..fingerprint.clone() },
            sha256: fingerprint.content_sha256.clone(),
        };
        let assets = BTreeSet::from([item.asset_id]);
        let entries = references_by_asset(self.catalog().entry_references(&assets).await?);
        let current = entries.get(&item.asset_id).cloned().unwrap_or_default();
        let target = NativePath::from_path(destination);
        let mut updates = Updates::default();
        for reference in &item.references {
            let entry = current.iter().find(|entry| {
                entry.preparation_id == reference.preparation_id && entry.seq == reference.entry_seq
            });
            let outcome = match entry {
                None => Err(ItemReason::new(
                    ReasonCode::DestinationMismatch,
                    format!(
                        "prepared entry {} is no longer recorded",
                        reference.entry_path.display()
                    ),
                )),
                Some(entry) => {
                    self.update_reference(entry, reference.update, &target, resumed, trash).await?
                }
            };
            let mut reported = reference.clone();
            match (outcome, entry) {
                (Ok(identity), Some(entry)) => {
                    reported.state = ReferenceState::Completed;
                    reported.reason = None;
                    if entry.source.as_ref() != Some(&target) {
                        let repoint = EntryRepoint {
                            preparation_id: entry.preparation_id,
                            seq: entry.seq,
                            previous_source: entry.source.clone().unwrap_or_else(|| target.clone()),
                            source: target.clone(),
                            source_evidence: source_evidence.clone(),
                            entry_identity: identity,
                        };
                        if repoint.entry_identity.is_some() {
                            updates.rebuilt.push(repoint.clone());
                        }
                        updates.repoints.push(repoint);
                    }
                }
                (Ok(_), None) => {}
                (Err(reason), _) => {
                    reported.state = if reason.code == ReasonCode::Interrupted {
                        ReferenceState::Uncertain
                    } else {
                        ReferenceState::Blocked
                    };
                    reported.reason = Some(reason);
                }
            }
            updates.references.push(reported);
        }
        Ok(updates)
    }

    /// Update one reference to read `target`: a prepared link is rebuilt, a
    /// hardlink keeps its local copy once it re-verifies, a copy or clone
    /// needs nothing on disk. Returns a rebuilt link's evidence.
    async fn update_reference(
        &self,
        entry: &EntryReference,
        update: ReferenceUpdate,
        target: &NativePath,
        resumed: bool,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<Result<Option<EntryEvidence>, ItemReason>, LibraryError> {
        let drift = |entry: &EntryReference| {
            ItemReason::new(
                ReasonCode::DestinationMismatch,
                format!(
                    "{} changed outside PlateVault since it was prepared",
                    entry.path.display()
                ),
            )
        };
        if entry.source.as_ref() == Some(target) {
            return Ok(Ok(None));
        }
        match update {
            ReferenceUpdate::RetainedOriginal => Ok(Ok(None)),
            ReferenceUpdate::KeepLocalCopy => {
                let Some(identity) = entry.entry_identity.clone() else {
                    return Ok(Err(drift(entry)));
                };
                let holds = blocking(move || Ok(in_place(&identity))).await?;
                Ok(if holds { Ok(None) } else { Err(drift(entry)) })
            }
            ReferenceUpdate::RepointLink => {
                let Some(recorded) = entry.entry_identity.clone() else {
                    return Ok(Err(drift(entry)));
                };
                let (target, trash) = (target.to_path_buf()?, Arc::clone(trash));
                let link = entry.path.to_path_buf()?;
                let rebuilt = blocking(move || {
                    Ok(relink(&link, &recorded, &target, resumed, trash.as_ref()))
                })
                .await?;
                Ok(rebuilt.map(Some))
            }
        }
    }

    /// Immediately before retirement (D06): every reference still reads the
    /// destination copy and the catalog record names it.
    async fn references_hold(
        &self,
        item: &ArchiveItem,
    ) -> Result<Result<(), ItemReason>, LibraryError> {
        let asset = self.catalog().asset(item.asset_id).await?;
        if asset.location_id != item.destination_location_id
            || asset.relative_path != item.destination_path
        {
            return Ok(Err(ItemReason::new(
                ReasonCode::DestinationChanged,
                "the frame's catalog record no longer names the archive copy",
            )));
        }
        let locations = self.locations_of(std::slice::from_ref(item)).await?;
        let target = NativePath::from_path(&absolute(
            &locations,
            item.destination_location_id,
            &item.destination_path,
        )?);
        let entries = references_by_asset(
            self.catalog().entry_references(&BTreeSet::from([item.asset_id])).await?,
        );
        let current = entries.get(&item.asset_id).cloned().unwrap_or_default();
        for reference in &item.references {
            let Some(entry) = current.iter().find(|entry| {
                entry.preparation_id == reference.preparation_id && entry.seq == reference.entry_seq
            }) else {
                return Ok(Err(ItemReason::new(
                    ReasonCode::DestinationMismatch,
                    format!(
                        "prepared entry {} is no longer recorded",
                        reference.entry_path.display()
                    ),
                )));
            };
            if entry.source.as_ref() != Some(&target) {
                return Ok(Err(ItemReason::new(
                    ReasonCode::DestinationMismatch,
                    format!("{} no longer reads the archive copy", entry.path.display()),
                )));
            }
            if reference.update == ReferenceUpdate::RetainedOriginal {
                continue;
            }
            let Some(identity) = entry.entry_identity.clone() else {
                return Ok(Err(ItemReason::new(
                    ReasonCode::DestinationMismatch,
                    format!("{} has no recorded entry", entry.path.display()),
                )));
            };
            if !blocking(move || Ok(in_place(&identity))).await? {
                return Ok(Err(ItemReason::new(
                    ReasonCode::DestinationMismatch,
                    format!(
                        "{} changed outside PlateVault after it was updated",
                        entry.path.display()
                    ),
                )));
            }
        }
        Ok(Ok(()))
    }
}

/// Whether the frame's record is still at the archive path its latest
/// repoint, an Archive's, took it to.
fn at_archive(asset: &Asset, repoint: &persistence_library::LatestRepoint) -> bool {
    repoint.kind == ArchiveKind::Archive
        && asset.location_id == repoint.destination_location_id
        && asset.relative_path == repoint.destination_path
}

/// Identity, size and modification time, ignoring where the digest lives.
pub(super) fn same_observation(
    left: &ObservationFingerprint,
    right: &ObservationFingerprint,
) -> bool {
    let bare = |fingerprint: &ObservationFingerprint| ObservationFingerprint {
        content_sha256: None,
        ..fingerprint.clone()
    };
    bare(left).equivalent(&bare(right))
}

/// A prepared entry the reference update covers: one that was written, a
/// Direct-source path included (it holds its item back).
const fn tracked(entry: &EntryReference) -> bool {
    !matches!(entry.state, EntryState::Blocked)
}

fn references_by_asset(entries: Vec<EntryReference>) -> HashMap<Uuid, Vec<EntryReference>> {
    let mut by_asset: HashMap<Uuid, Vec<EntryReference>> = HashMap::new();
    for entry in entries {
        by_asset.entry(entry.asset_id).or_default().push(entry);
    }
    by_asset
}

fn blocked_all(references: &[ArchiveReference]) -> Vec<ArchiveReference> {
    references
        .iter()
        .map(|reference| ArchiveReference { state: ReferenceState::Blocked, ..reference.clone() })
        .collect()
}

fn absolute(
    locations: &HashMap<Uuid, Location>,
    location: Uuid,
    path: &NativePath,
) -> Result<PathBuf, LibraryError> {
    let root = locations
        .get(&location)
        .ok_or_else(|| LibraryError::NotFound(format!("location {location}")))?
        .path
        .to_path_buf()?;
    Ok(root.join(path.relative_path()?))
}

/// An item whose source a failed check retains, with its journal item.
struct Retained<'a> {
    op_id: Uuid,
    journal: &'a StorageItem,
    id: Uuid,
    item: &'a ArchiveItem,
    revision: u64,
}

/// What updating an item's references did.
#[derive(Default)]
struct Updates {
    references: Vec<ArchiveReference>,
    /// Entries that now read the destination copy.
    repoints: Vec<EntryRepoint>,
    /// The links among them that were rebuilt on disk.
    rebuilt: Vec<EntryRepoint>,
}

/// The destination copy's observation with the reviewed digest, while it is
/// still the copy the journal wrote and verified; `None` otherwise.
async fn verified_copy(
    item: &ArchiveItem,
    journal: &StorageItem,
    destination: &Path,
) -> Result<Option<ObservationFingerprint>, LibraryError> {
    let written = journal.written.clone().ok_or_else(|| {
        LibraryError::PersistenceFailure(format!(
            "verified journal item {} names no written copy",
            journal.seq
        ))
    })?;
    let sha256 = item.sha256.clone().ok_or_else(|| {
        LibraryError::PersistenceFailure(format!(
            "transfer item {} has no reviewed digest",
            item.seq
        ))
    })?;
    let probe = destination.to_path_buf();
    let observed = blocking(move || Ok(inventory::probe_fingerprint(&probe))).await?;
    Ok(match observed {
        Ok(observed) if same_identity(&observed.identity, &written.identity) => {
            Some(ObservationFingerprint { content_sha256: Some(sha256), ..observed })
        }
        Ok(_) | Err(_) => None,
    })
}

fn too_many() -> LibraryError {
    LibraryError::InvalidInput("too many transfer items".into())
}

/// A recorded seq as a position; seqs count from 0 in order.
fn index(seq: u32) -> usize {
    usize::try_from(seq).unwrap_or(usize::MAX)
}

fn state_of(
    record: &ArchiveRecord,
    seq: u32,
) -> Result<&persistence_library::ArchiveItemState, LibraryError> {
    record.states.get(index(seq)).ok_or_else(|| {
        LibraryError::PersistenceFailure(format!(
            "transfer {} has no item {seq}",
            record.transfer.id
        ))
    })
}

/// What review found at a destination location.
struct ObservedDestination {
    identity: Option<crate::FileIdentity>,
    free_bytes: Option<u64>,
    writability: Writability,
    blocked: Option<String>,
}

/// Observe a destination's registered volume and folder, free space and
/// writability without writing anything.
async fn observe_destination(
    location: Location,
    needed: u64,
) -> Result<ObservedDestination, LibraryError> {
    blocking(move || Ok(destination_now(&location, needed))).await
}

fn destination_now(location: &Location, needed: u64) -> ObservedDestination {
    let identity = match inventory::validate_location_root(location) {
        Ok(identity) => identity,
        Err(error) => {
            return ObservedDestination {
                identity: None,
                free_bytes: None,
                writability: Writability::NotWritable { detail: error.to_string() },
                blocked: Some(format!(
                    "its registered folder is not mounted as registered: {error}"
                )),
            };
        }
    };
    let root = location.path.to_path_buf().ok();
    let free_bytes = root.as_deref().and_then(|root| fs4::available_space(root).ok());
    let writability = root.as_deref().map_or_else(
        || Writability::NotWritable { detail: "the folder path is not native".into() },
        writability,
    );
    let blocked = match (&writability, free_bytes) {
        (Writability::NotWritable { detail }, _) => Some(format!("it is not writable: {detail}")),
        (_, Some(free)) if free < needed => {
            Some(format!("it has {free} bytes free and the transfer writes {needed}"))
        }
        _ => None,
    };
    ObservedDestination { identity: Some(identity), free_bytes, writability, blocked }
}

/// Review state shared by every item of one transfer.
struct Plan {
    references: HashMap<Uuid, Vec<EntryReference>>,
    /// Destination paths earlier unheld items of this transfer write.
    claimed: HashMap<(Uuid, NativePath), u32>,
    next_seq: u32,
    locations: HashMap<Uuid, Location>,
}

impl Plan {
    async fn new(library: &Library, assets: &[ArchiveAsset]) -> Result<Self, LibraryError> {
        let ids: BTreeSet<Uuid> = assets.iter().map(|asset| asset.asset.id).collect();
        let references = references_by_asset(library.catalog().entry_references(&ids).await?);
        let locations = library
            .catalog()
            .list_locations()
            .await?
            .into_iter()
            .map(|location| (location.id, location))
            .collect();
        Ok(Self { references, claimed: HashMap::new(), next_seq: 0, locations })
    }

    /// Review one frame copy for `destination` at `layout`: its holds, its
    /// snapshot and the prepared entries that read it.
    async fn item(
        &mut self,
        library: &Library,
        session_id: Uuid,
        asset: &Asset,
        destination: &Location,
        layout: Result<(NativePath, Vec<NamingFallback>), ArchiveHold>,
    ) -> Result<NewArchiveItem, LibraryError> {
        let seq = self.next_seq;
        self.next_seq = seq.checked_add(1).ok_or_else(too_many)?;
        let entries = self.references.get(&asset.id).cloned().unwrap_or_default();
        let (destination_path, fallbacks) = match &layout {
            Ok((path, fallbacks)) => (path.clone(), fallbacks.clone()),
            Err(_) => (asset.relative_path.clone(), Vec::new()),
        };
        let mut item = NewArchiveItem {
            session_id,
            asset_id: asset.id,
            source_location_id: asset.location_id,
            source_path: asset.relative_path.clone(),
            destination_location_id: destination.id,
            destination_path: destination_path.clone(),
            size_bytes: asset.fingerprint.size_bytes,
            evidence: None,
            fallbacks,
            references: entries.iter().filter_map(reference_of).collect(),
            hold: None,
            reason: None,
        };
        let hold = self.hold(library, asset, destination, layout, &entries).await?;
        match hold {
            Some(hold) => item.hold = Some(hold),
            None => match self.evidence(asset).await? {
                Ok(evidence) => item.evidence = Some(evidence),
                Err(hold) => item.hold = Some(hold),
            },
        }
        if item.hold.is_none() {
            self.claimed.insert((destination.id, destination_path), seq);
        }
        Ok(item)
    }

    async fn hold(
        &self,
        library: &Library,
        asset: &Asset,
        destination: &Location,
        layout: Result<(NativePath, Vec<NamingFallback>), ArchiveHold>,
        entries: &[EntryReference],
    ) -> Result<Option<ArchiveHold>, LibraryError> {
        if asset.location_id == destination.id {
            return Ok(Some(ArchiveHold::AlreadyThere));
        }
        if asset.availability != Availability::Available {
            return Ok(Some(ArchiveHold::Unavailable { availability: asset.availability }));
        }
        let role = self.locations.get(&asset.location_id).map(|location| location.role);
        if role != Some(destination.role) {
            return Ok(Some(ArchiveHold::RoleMismatch { role: role.unwrap_or(destination.role) }));
        }
        let path = match layout {
            Ok((path, _)) => path,
            Err(hold) => return Ok(Some(hold)),
        };
        if let Some(earlier) = self.claimed.get(&(destination.id, path.clone())) {
            return Ok(Some(ArchiveHold::CollidesWithItem { seq: *earlier }));
        }
        for entry in entries.iter().filter(|entry| tracked(entry)) {
            if entry.kind == PreparedEntryKind::DirectSource {
                return Ok(Some(ArchiveHold::DirectSource {
                    run: entry.run.clone(),
                    preparation: entry.preparation,
                }));
            }
            let unsettled = match entry.state {
                EntryState::Pending => Some("is being written"),
                EntryState::Drifted => Some("drifted since it was prepared"),
                EntryState::Prepared | EntryState::Blocked => None,
            }
            .or_else(|| entry.source.is_none().then_some("records no source"))
            .or_else(|| {
                (entry.kind != PreparedEntryKind::Copy
                    && entry.kind != PreparedEntryKind::Clone
                    && entry.entry_identity.is_none())
                .then_some("records no entry")
            });
            if let Some(detail) = unsettled {
                return Ok(Some(ArchiveHold::ReferenceUnsettled {
                    run: entry.run.clone(),
                    preparation: entry.preparation,
                    detail: format!("prepared entry {} {detail}", entry.path.display()),
                }));
            }
        }
        if library.catalog().asset_recorded_at(destination.id, &path).await?.is_some() {
            return Ok(Some(ArchiveHold::Occupied { path }));
        }
        let file = destination.path.to_path_buf()?.join(path.relative_path()?);
        if blocking(move || Ok(std::fs::symlink_metadata(&file).is_ok())).await? {
            return Ok(Some(ArchiveHold::Occupied { path }));
        }
        Ok(None)
    }

    /// The reviewed snapshot: the catalog's verified digest bound to the
    /// observation still on disk, else the copy hashed now.
    async fn evidence(
        &self,
        asset: &Asset,
    ) -> Result<Result<EntryEvidence, ArchiveHold>, LibraryError> {
        let location = self
            .locations
            .get(&asset.location_id)
            .ok_or_else(|| LibraryError::NotFound(format!("location {}", asset.location_id)))?;
        let source = location.path.to_path_buf()?.join(asset.relative_path.relative_path()?);
        let recorded = asset.fingerprint.clone();
        blocking(move || Ok(snapshot(&source, recorded))).await
    }

    /// Record the review: each destination as observed now, the kept
    /// sessions and the expected reclaim.
    async fn finish(
        self,
        kind: ArchiveKind,
        project_id: Uuid,
        project_revision: u64,
        kept: Vec<crate::KeptSession>,
        items: Vec<NewArchiveItem>,
    ) -> Result<NewArchiveTransfer, LibraryError> {
        let mut destinations = Vec::new();
        let ids: BTreeSet<Uuid> = items.iter().map(|item| item.destination_location_id).collect();
        for id in ids {
            let location = self
                .locations
                .get(&id)
                .cloned()
                .ok_or_else(|| LibraryError::NotFound(format!("location {id}")))?;
            let needed: u64 = items
                .iter()
                .filter(|item| item.destination_location_id == id && item.hold.is_none())
                .map(|item| item.size_bytes)
                .sum();
            let observed = observe_destination(location.clone(), needed).await?;
            destinations.push(ArchiveDestination {
                location_id: id,
                name: location.name,
                root: location.path,
                role: location.role,
                identity: observed.identity,
                free_bytes: observed.free_bytes,
                writability: observed.writability,
                needed_bytes: needed,
                blocked: observed.blocked,
            });
        }
        let expected_reclaim_bytes = items
            .iter()
            .filter(|item| {
                item.hold.is_none()
                    && !item
                        .references
                        .iter()
                        .any(|reference| reference.update == ReferenceUpdate::KeepLocalCopy)
            })
            .map(|item| item.size_bytes)
            .sum();
        Ok(NewArchiveTransfer {
            kind,
            project_id,
            project_revision,
            destinations,
            kept,
            expected_reclaim_bytes,
            items,
        })
    }
}

/// The reviewed snapshot of `source`, whose catalog observation is
/// `recorded`: that observation with its verified digest while the file
/// still matches it, else the file hashed now.
fn snapshot(source: &Path, recorded: ObservationFingerprint) -> Result<EntryEvidence, ArchiveHold> {
    let changed = |detail: String| Err(ArchiveHold::Changed { detail });
    match inventory::probe_fingerprint(source) {
        Ok(observed) if same_observation(&observed, &recorded) => {}
        Ok(_) => return changed(format!("{} changed since it was indexed", source.display())),
        Err(_) => return Err(ArchiveHold::Unavailable { availability: Availability::Unreadable }),
    }
    if let Some(sha256) = recorded.content_sha256.clone() {
        return Ok(EntryEvidence {
            path: NativePath::from_path(source),
            kind: EntryKind::File,
            fingerprint: ObservationFingerprint { content_sha256: None, ..recorded },
            sha256: Some(sha256),
        });
    }
    match observe_entry(source) {
        Ok(evidence) if same_observation(&evidence.fingerprint, &recorded) => Ok(evidence),
        Ok(_) | Err(_) => changed(format!("{} changed while it was hashed", source.display())),
    }
}

/// The reference update an entry gets: a link is rebuilt, a hardlink keeps
/// its local copy, a copy or clone keeps its bytes. A Direct-source path
/// holds the item back instead.
fn reference_of(entry: &EntryReference) -> Option<ArchiveReference> {
    if !tracked(entry) {
        return None;
    }
    let update = match entry.kind {
        PreparedEntryKind::Symlink => ReferenceUpdate::RepointLink,
        PreparedEntryKind::Hardlink => ReferenceUpdate::KeepLocalCopy,
        PreparedEntryKind::Copy | PreparedEntryKind::Clone => ReferenceUpdate::RetainedOriginal,
        PreparedEntryKind::DirectSource => return None,
    };
    Some(ArchiveReference {
        run: entry.run.clone(),
        preparation_id: entry.preparation_id,
        preparation: entry.preparation,
        entry_seq: entry.seq,
        entry_path: entry.path.clone(),
        mode: entry.kind,
        update,
        state: ReferenceState::Pending,
        reason: None,
    })
}

/// Rebuild the prepared link at `link` to point at `target`: a new link is
/// created beside it and atomically exchanged with it, the old entry is
/// proven to be the recorded link and only then leaves through the OS Trash,
/// never followed. Anything else at the path is swapped back untouched.
/// After an interruption (`resumed`) a link already pointing at `target` is
/// this transfer's own.
#[cfg(unix)]
fn relink(
    link: &Path,
    recorded: &EntryEvidence,
    target: &Path,
    resumed: bool,
    trash: &dyn OsTrash,
) -> Result<EntryEvidence, ItemReason> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};

    use crate::custody::trash::{self, Retirement};
    use crate::TrashSupport;

    let failed = |detail: String| ItemReason::new(ReasonCode::WriteFailed, detail);
    let observe = |path: &Path| {
        observe_entry(path).map_err(|error| failed(format!("{}: {error}", path.display())))
    };
    if resumed && std::fs::read_link(link).is_ok_and(|current| current == target) {
        return observe(link);
    }
    if !in_place(recorded) {
        return Err(ItemReason::new(
            ReasonCode::DestinationMismatch,
            format!("{} changed outside PlateVault since it was prepared", link.display()),
        ));
    }
    if let TrashSupport::Unsupported { detail, .. } =
        trash.support(link, recorded.fingerprint.size_bytes)
    {
        return Err(ItemReason::new(
            ReasonCode::TrashUnsupported,
            format!("the old link {} cannot go to the OS Trash: {detail}", link.display()),
        ));
    }
    let folder =
        link.parent().ok_or_else(|| failed(format!("{} has no folder", link.display())))?;
    let staged = folder.join(format!(".pv-relink-{}", Uuid::new_v4().simple()));
    std::os::unix::fs::symlink(target, &staged)
        .map_err(|error| failed(format!("{}: {error}", staged.display())))?;
    let discard = |path: &Path| {
        // Only the link this function just created, never followed.
        if std::fs::read_link(path).is_ok_and(|current| current == target) {
            let _ = std::fs::remove_file(path);
        }
    };
    if let Err(error) = renameat_with(CWD, &staged, CWD, link, RenameFlags::EXCHANGE) {
        discard(&staged);
        return Err(failed(format!("{} cannot be exchanged: {error}", link.display())));
    }
    let old = EntryEvidence { path: NativePath::from_path(&staged), ..recorded.clone() };
    let swap_back = |reason: ItemReason| {
        if renameat_with(CWD, &staged, CWD, link, RenameFlags::EXCHANGE).is_ok() {
            discard(&staged);
            reason
        } else {
            ItemReason::new(
                ReasonCode::Interrupted,
                format!(
                    "{} could not be swapped back; the recorded link is at {}",
                    link.display(),
                    staged.display()
                ),
            )
        }
    };
    if !in_place(&old) {
        return Err(swap_back(ItemReason::new(
            ReasonCode::DestinationMismatch,
            format!("{} changed outside PlateVault while it was rebuilt", link.display()),
        )));
    }
    match trash::retire(trash, &old, &[], || Ok(())) {
        Retirement::Moved => observe(link),
        Retirement::Unsupported(reason) | Retirement::Blocked(reason) => Err(swap_back(reason)),
        Retirement::Uncertain(reason) => {
            Err(ItemReason::new(ReasonCode::Interrupted, reason.detail))
        }
    }
}

#[cfg(not(unix))]
fn relink(
    link: &Path,
    _recorded: &EntryEvidence,
    _target: &Path,
    _resumed: bool,
    _trash: &dyn OsTrash,
) -> Result<EntryEvidence, ItemReason> {
    Err(ItemReason::new(
        ReasonCode::WriteFailed,
        format!(
            "rebuilding the prepared link {} is supported on macOS and Linux only; the source stays",
            link.display()
        ),
    ))
}
