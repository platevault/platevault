// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Archive and Close (spec 065 PRJ-FR-14/25, 071 STO-FR-06 to STO-FR-08,
//! STO-FR-13; D06, D19, D-W80, D-W111, D-W120).
//!
//! Archive's review lays out every file of the Project's sessions by the
//! naming templates, keeps each session another open Project holds (or
//! whose files its View places) at its path and names that Project, and
//! lists the kept-View links it repoints. A Closed or Archived Project
//! doesn't keep a session, and a suggestion doesn't count. Close project…
//! records the Archive step, the Closed snapshot and the lifecycle in one
//! transaction, then the archive runs while the Project reads Closing.
//!
//! Each file goes through the verified-transfer journal: copied, re-read
//! and verified; then its catalog record moves to the copy, and the
//! destination is announced to new-capture discovery
//! ([`Library::subscribe_recorded_paths`]); then every kept-View link that
//! read the original is rebuilt to read the copy after a no-follow check
//! that it is still the recorded link, and recorded beside the frozen
//! manifest; only then is the original retired to the OS Trash, re-verified
//! first. Once the original settled, retired or kept, the source is
//! announced; until then discovery holds the original at its path by the
//! size and time the move started from. A link that can't be repointed
//! keeps the original. Every step is durable, so a stop resumes from the
//! recorded phase and the archive settles its Project Archived, or Closed
//! when nothing moved.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use persistence_library::{ArchiveAsset, ArchiveDraft, ArchiveRun, KeptLinkRecord};
use platevault_pixels::measure;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::project_folder;
use crate::custody::trash::OsTrash;
use crate::custody::{observe_entry, same_identity, transfer};
use crate::import::{classify, naming_metadata, writability};
use crate::inventory::RootRefusal;
use crate::layout::VIEW_FOLDER;
use crate::library::{blocking, Library};
use crate::{
    inventory, ArchiveFile, ArchiveMoveOutcome, ArchiveProgress, ArchiveReview, ArchiveSelection,
    ArchiveSessionOffer, Availability, CloseReport, CloseRequest, EntryEvidence, EntryKind,
    FileIdentity, ItemChange, ItemOutcome, ItemPhase, ItemReason, KeptViewLink, LibraryError,
    Location, LocationLifecycle, MeasurementMethod, NamingFallback, NativePath,
    ObservationFingerprint, ReasonCode, Revision, StorageItem, StorageItemDraft,
    StorageOperationState, TransferDestination, Writability,
};

/// What an archive asks while it runs.
pub trait ArchiveControl: Send + Sync {
    /// `PlateVault` is closing: stop before the next durable step. The next
    /// start resumes from it ([`Library::recover_wrap_up`]).
    fn interrupted(&self) -> bool {
        false
    }
}

impl ArchiveControl for crate::apply::Unattended {}

/// Archives this process is running now.
static RUNNING: LazyLock<Mutex<HashSet<Uuid>>> = LazyLock::new(Mutex::default);

/// Exclusive claim on one archive for this process; released on drop.
struct Claim(Uuid);

impl Claim {
    fn take(id: Uuid) -> Result<Self, LibraryError> {
        if RUNNING.lock().unwrap_or_else(std::sync::PoisonError::into_inner).insert(id) {
            Ok(Self(id))
        } else {
            Err(LibraryError::InvalidInput(format!("archive {id} is already running")))
        }
    }
}

impl Drop for Claim {
    fn drop(&mut self) {
        RUNNING.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&self.0);
    }
}

/// An archive review and the journal drafts of each selectable session.
struct Plan {
    review: ArchiveReview,
    drafts: BTreeMap<Uuid, Vec<ArchiveDraft>>,
}

type EntryKey = (Uuid, Revision, u32);

const fn key(link: &KeptViewLink) -> EntryKey {
    (link.project_id, link.generation, link.seq)
}

impl Library {
    /// Archive's review of a Project's Wrap up (STO-FR-06/13): its sessions
    /// laid out for `destination`, the ones other open Projects keep, and
    /// the kept-View links the archive repoints. Writes and moves nothing.
    ///
    /// # Errors
    /// `InvalidInput` for a Project that is not open or a retired
    /// destination; `NotFound` for an unknown Project or location.
    pub async fn wrap_up_archive_review(
        &self,
        project_id: Uuid,
        destination: Uuid,
    ) -> Result<ArchiveReview, LibraryError> {
        let sessions = self.archivable_sessions(project_id).await?;
        Ok(self.archive_plan(Some(project_id), &sessions, destination).await?.review)
    }

    /// Sessions > Archive's review (LIB-FR-17, STO-FR-13): the same rule for
    /// the sessions the user selected; no Project closes or changes.
    ///
    /// # Errors
    /// As [`Self::wrap_up_archive_review`].
    pub async fn sessions_archive_review(
        &self,
        sessions: &[Uuid],
        destination: Uuid,
    ) -> Result<ArchiveReview, LibraryError> {
        let sessions: BTreeSet<Uuid> = sessions.iter().copied().collect();
        Ok(self.archive_plan(None, &sessions, destination).await?.review)
    }

    /// Run Sessions > Archive as reviewed: the kept Views of Closed and
    /// Archived Projects that read the moved files are repointed.
    ///
    /// # Errors
    /// `Conflict` when the review moved; `InvalidInput` for a session that
    /// can't move or that an open Project now keeps; journal and catalog
    /// failures.
    pub async fn sessions_archive(
        &self,
        selection: &ArchiveSelection,
        trash: Arc<dyn OsTrash>,
        control: &dyn ArchiveControl,
    ) -> Result<ArchiveProgress, LibraryError> {
        let sessions: BTreeSet<Uuid> = selection.sessions.iter().copied().collect();
        let drafts = self.confirmed(None, &sessions, selection).await?;
        let storage = self.catalog().begin_sessions_archive(&drafts).await?;
        self.run_archive(storage, &trash, control).await
    }

    /// Close project… (PRJ-FR-14/25): Archive's Proceed. Records the Archive
    /// step, takes the Closed snapshot and locks the Project for good, then
    /// runs the selected archive while the Project reads Closing; it ends
    /// Archived, or Closed when nothing was archived. With no session
    /// selected the Project closes with no archive. A stop (`control`)
    /// leaves the Project Closing until [`Self::recover_wrap_up`] resumes it.
    ///
    /// # Errors
    /// `Conflict` when the Project or the archive review moved since the
    /// user saw it; `InvalidInput` while Wrap up doesn't open, before Trash
    /// is recorded, or for a session that can't move; catalog and journal
    /// failures.
    pub async fn close_project(
        &self,
        request: &CloseRequest,
        trash: Arc<dyn OsTrash>,
        control: &dyn ArchiveControl,
    ) -> Result<CloseReport, LibraryError> {
        let project_id = request.project_id;
        let drafts = match &request.archive {
            Some(selection) if !selection.sessions.is_empty() => {
                let sessions = self.archivable_sessions(project_id).await?;
                self.confirmed(Some(project_id), &sessions, selection).await?
            }
            _ => Vec::new(),
        };
        let method = MeasurementMethod::new(measure::METHOD.name, measure::METHOD.version);
        let closed = self
            .catalog()
            .close_project(project_id, request.desired_revision, &method, &drafts)
            .await?;
        let archive = match closed.storage_operation_id {
            Some(storage) => Some(self.run_archive(storage, &trash, control).await?),
            None => None,
        };
        let lifecycle = self.catalog().wrap_up_status(project_id).await?.lifecycle;
        Ok(CloseReport { lifecycle, snapshot: closed.snapshot, archive })
    }

    async fn archivable_sessions(&self, project_id: Uuid) -> Result<BTreeSet<Uuid>, LibraryError> {
        let desired = self.catalog().project_desired(project_id).await?;
        if !desired.lifecycle.is_open() {
            return Err(LibraryError::InvalidInput(format!(
                "a {} Project is locked; its Archive is a read-only record",
                desired.lifecycle
            )));
        }
        Ok(desired.sessions.iter().map(|held| held.session_id).collect())
    }

    /// The drafts of the sessions `selection` confirmed, against the review
    /// as it stands now.
    async fn confirmed(
        &self,
        project: Option<Uuid>,
        sessions: &BTreeSet<Uuid>,
        selection: &ArchiveSelection,
    ) -> Result<Vec<ArchiveDraft>, LibraryError> {
        let mut plan = self.archive_plan(project, sessions, selection.destination).await?;
        if plan.review.digest != selection.digest {
            return Err(LibraryError::Conflict {
                id: project.unwrap_or(selection.destination),
                current: 0,
                successors: Vec::new(),
            });
        }
        let mut drafts = Vec::new();
        for session in &selection.sessions {
            let Some(session_drafts) = plan.drafts.remove(session) else {
                let why = plan
                    .review
                    .sessions
                    .iter()
                    .find(|offer| offer.session_id == *session)
                    .map_or_else(
                        || "it is not one of the reviewed sessions".to_owned(),
                        |offer| match (&offer.hold, offer.kept_by.is_empty()) {
                            (_, false) => format!("{} holds it", offer.kept_by.join(", ")),
                            (Some(hold), true) => hold.detail.clone(),
                            (None, true) => "it has no file to move".to_owned(),
                        },
                    );
                return Err(LibraryError::InvalidInput(format!(
                    "session {session} can't be archived: {why}"
                )));
            };
            drafts.extend(session_drafts);
        }
        if drafts.is_empty() {
            return Err(LibraryError::InvalidInput("the archive has no file to move".into()));
        }
        Ok(drafts)
    }

    // One pass lays out, holds and drafts each file in review order, as the
    // run Prepare planner does (prepare.rs); splitting it scatters the holds.
    #[allow(clippy::too_many_lines)]
    async fn archive_plan(
        &self,
        project: Option<Uuid>,
        sessions: &BTreeSet<Uuid>,
        destination_id: Uuid,
    ) -> Result<Plan, LibraryError> {
        let catalog = self.catalog();
        let destination = catalog.location(destination_id).await?;
        if destination.lifecycle != LocationLifecycle::Active {
            return Err(LibraryError::InvalidInput(format!(
                "location '{}' is retired; Archive writes only to an active location",
                destination.name
            )));
        }
        let root = destination.path.to_path_buf()?;
        let assets = catalog.archive_assets(sessions).await?;
        let holders = catalog.archive_holders(project, sessions).await?;
        let asset_ids: BTreeSet<Uuid> = assets.iter().map(|asset| asset.asset.id).collect();
        let links = catalog.kept_view_links(project, &asset_ids).await?;
        let locations: BTreeMap<Uuid, Location> = catalog
            .list_locations()
            .await?
            .into_iter()
            .map(|location| (location.id, location))
            .collect();
        let destination_refusal = {
            let destination = destination.clone();
            blocking(move || Ok(write_refusal(&destination))).await?
        };
        let mut layouts = BTreeMap::new();
        for asset in &assets {
            layouts.insert(asset.asset.id, self.archive_layout(asset).await?);
        }
        let mut claimed: BTreeSet<PathBuf> = BTreeSet::new();
        let mut offers = Vec::new();
        let mut drafts = BTreeMap::new();
        let mut listed_links = Vec::new();
        for session in sessions {
            let kept_by = holders.get(session).cloned().unwrap_or_default();
            let mut files = Vec::new();
            let mut hold: Option<ItemReason> = None;
            let mut session_drafts = Vec::new();
            for archived in assets.iter().filter(|asset| asset.session_id == *session) {
                let asset = &archived.asset;
                let Some(from) = absolute(&locations, asset.location_id, &asset.relative_path)
                else {
                    continue;
                };
                let laid_out = layouts.remove(&asset.id).unwrap_or_else(|| Err(String::new()));
                let to_path = match &laid_out {
                    Ok((to_path, _)) => Some(to_path.clone()),
                    Err(detail) => {
                        hold.get_or_insert_with(|| {
                            ItemReason::new(ReasonCode::WriteFailed, format!("naming: {detail}"))
                        });
                        None
                    }
                };
                let to =
                    to_path.as_ref().and_then(|path| Some(root.join(path.relative_path().ok()?)));
                files.push(ArchiveFile {
                    asset_id: asset.id,
                    from: NativePath::from_path(&from),
                    to: to
                        .as_deref()
                        .map_or_else(|| destination.path.clone(), NativePath::from_path),
                    size_bytes: asset.fingerprint.size_bytes,
                });
                let (Some(to_path), Some(to)) = (to_path, to) else { continue };
                let refusal = if asset.location_id == destination_id {
                    Some((
                        ReasonCode::DestinationOccupied,
                        "it is already in the archive location".into(),
                    ))
                } else if asset.availability != Availability::Available {
                    Some((
                        ReasonCode::SourceUnavailable,
                        format!("{} is not online", from.display()),
                    ))
                } else if asset.fingerprint.content_sha256.is_none() {
                    Some((
                        ReasonCode::SourceDrift,
                        format!("{} has no recorded digest", from.display()),
                    ))
                } else if let Some(refusal) = &destination_refusal {
                    Some((refusal.code, refusal.detail.clone()))
                } else if fs::symlink_metadata(&to).is_ok() || !claimed.insert(to.clone()) {
                    Some((ReasonCode::DestinationOccupied, format!("{} is taken", to.display())))
                } else {
                    None
                };
                if let Some((code, detail)) = refusal {
                    hold.get_or_insert_with(|| ItemReason::new(code, detail));
                    continue;
                }
                let reads: Vec<KeptViewLink> = links
                    .iter()
                    .filter(|record| record.link.asset_id == asset.id)
                    .filter_map(|record| {
                        absolute_link(record)
                            .map(|link| KeptViewLink { link, ..record.link.clone() })
                    })
                    .collect();
                listed_links.extend(reads.iter().cloned());
                session_drafts.push(ArchiveDraft {
                    session_id: *session,
                    asset: asset.clone(),
                    to_location_id: destination_id,
                    to_path: to_path.clone(),
                    links: reads,
                    draft: StorageItemDraft {
                        source: EntryEvidence {
                            path: NativePath::from_path(&from),
                            root: locations.get(&asset.location_id).map(|at| at.path.clone()),
                            kind: EntryKind::File,
                            fingerprint: ObservationFingerprint {
                                content_sha256: None,
                                ..asset.fingerprint.clone()
                            },
                            sha256: asset.fingerprint.content_sha256.clone(),
                        },
                        relied_on: Vec::new(),
                        destination: Some(TransferDestination {
                            root: destination.path.clone(),
                            relative: to_path,
                        }),
                    },
                });
            }
            if kept_by.is_empty() && hold.is_none() && !session_drafts.is_empty() {
                drafts.insert(*session, session_drafts);
            }
            offers.push(ArchiveSessionOffer { session_id: *session, files, kept_by, hold });
        }
        let selectable: BTreeSet<Uuid> = drafts.keys().copied().collect();
        let review_links: Vec<KeptViewLink> = listed_links
            .into_iter()
            .filter(|link| {
                assets.iter().any(|asset| {
                    asset.asset.id == link.asset_id && selectable.contains(&asset.session_id)
                })
            })
            .collect();
        let digest = {
            let encoded = serde_json::to_vec(&(&offers, &review_links, destination_id))
                .map_err(|error| LibraryError::PersistenceFailure(error.to_string()))?;
            hex::encode(Sha256::digest(encoded))
        };
        Ok(Plan {
            review: ArchiveReview {
                project_id: project,
                destination: destination_id,
                sessions: offers,
                links: review_links,
                digest,
            },
            drafts,
        })
    }

    /// The templated destination of an archived frame (STO-IMP-FR-07): its
    /// type's template folder, then its file name. `{target}` uses the
    /// session's confirmed Target; without one it falls back to `unclassified`
    /// as in import (D-W107, D-W129). Header OBJECT is only a label. `Err`
    /// names why the template can't lay it out.
    pub(crate) async fn archive_layout(
        &self,
        asset: &ArchiveAsset,
    ) -> Result<Result<(NativePath, Vec<NamingFallback>), String>, LibraryError> {
        let frame = &asset.asset;
        let Some(frame_type) = classify(&frame.effective, &frame.relative_path) else {
            return Ok(Err("the frame has no frame-type header to choose its template".into()));
        };
        let mut metadata = naming_metadata(&frame.effective, frame_type);
        metadata.target.clone_from(&asset.target);
        let resolution = match self.resolve_naming(frame_type, &metadata).await {
            Ok(resolution) => resolution,
            Err(LibraryError::InvalidInput(detail)) => return Ok(Err(detail)),
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

    /// Run or resume a journaled archive until every file has an outcome,
    /// then settle it and its Closing Project. Returns where it stands; a
    /// stop leaves it resumable.
    pub(super) async fn run_archive(
        &self,
        storage: Uuid,
        trash: &Arc<dyn OsTrash>,
        control: &dyn ArchiveControl,
    ) -> Result<ArchiveProgress, LibraryError> {
        let _claim = Claim::take(storage)?;
        let catalog = self.catalog();
        let locations: BTreeMap<Uuid, Location> = catalog
            .list_locations()
            .await?
            .into_iter()
            .map(|location| (location.id, location))
            .collect();
        let mut run = catalog.archive_run(storage).await?;
        for index in 0..run.moves.len() {
            if run.moves[index].outcome.is_some() {
                continue;
            }
            if control.interrupted() {
                return Ok(run.progress(&locations));
            }
            self.archive_one(&run, index, trash, control, &locations).await?;
            run = catalog.archive_run(storage).await?;
            let step = &run.moves[index];
            if step.outcome.is_none() {
                return Ok(run.progress(&locations));
            }
            // Its record moved and its original settled, retired to the OS
            // Trash or kept beside the copy: the source no longer records
            // the path at all, so new-capture discovery reads it again. Until
            // now the catalog reported the original held there.
            if step.repointed {
                self.recorded_paths_changed(step.from_location_id);
            }
        }
        let operation = catalog.storage_operation(storage).await?;
        if operation.state != StorageOperationState::Settled {
            catalog.settle_storage_operation(storage).await?;
        }
        catalog.settle_archive(storage).await?;
        Ok(catalog.archive_run(storage).await?.progress(&locations))
    }

    /// Advance one file to its outcome, stopping at a durable step when
    /// `control` asks.
    // The file's durable steps in their journal order; each early return is a
    // recorded resume point. Each journal step and reference move follows a
    // check of the destination root (STO-FR-06/07).
    async fn archive_one(
        &self,
        run: &ArchiveRun,
        index: usize,
        trash: &Arc<dyn OsTrash>,
        control: &dyn ArchiveControl,
        locations: &BTreeMap<Uuid, Location>,
    ) -> Result<(), LibraryError> {
        let storage = run.storage_operation_id;
        let step = &run.moves[index];
        let destination = locations.get(&step.to_location_id).ok_or_else(|| {
            LibraryError::PersistenceFailure(format!(
                "archive move {} has no destination",
                step.seq
            ))
        })?;
        let item = loop {
            let item = self.journal_item(storage, step.seq).await?;
            if item.outcome.is_some()
                || matches!(item.phase, ItemPhase::DestinationVerified | ItemPhase::Retiring)
            {
                break item;
            }
            if control.interrupted() {
                return Ok(());
            }
            // Each journal step writes below the destination root.
            if let Err(reason) = destination_root(destination).await? {
                return self.keep_source(storage, &item, ArchiveMoveOutcome::Blocked, reason).await;
            }
            self.step_storage_operation(storage, Arc::clone(trash)).await?;
        };
        if let Some(outcome) = item.outcome {
            return self.settle_move(storage, step.seq, step.repointed, outcome, item.reason).await;
        }
        if item.phase == ItemPhase::DestinationVerified
            && self.move_references(run, index, &item, control, locations).await?.is_break()
        {
            return Ok(());
        }
        let item = loop {
            let item = self.journal_item(storage, step.seq).await?;
            if item.outcome.is_some() {
                break item;
            }
            // Retiring settles the file archived on the copy at the root; a
            // retirement already requested is resumed whatever the root.
            if item.phase == ItemPhase::DestinationVerified {
                if let Err(reason) = destination_root(destination).await? {
                    return self
                        .keep_source(storage, &item, ArchiveMoveOutcome::SourceRetained, reason)
                        .await;
                }
            }
            self.step_storage_operation(storage, Arc::clone(trash)).await?;
        };
        let outcome = item.outcome.unwrap_or(ItemOutcome::Uncertain);
        self.settle_move(storage, step.seq, true, outcome, item.reason).await
    }

    /// Move a verified file's catalog record, then each of its kept-View
    /// links, to the archive copy; `Break` once the file settled without
    /// retiring its original, or `control` asked to stop.
    async fn move_references(
        &self,
        run: &ArchiveRun,
        index: usize,
        item: &StorageItem,
        control: &dyn ArchiveControl,
        locations: &BTreeMap<Uuid, Location>,
    ) -> Result<ControlFlow<()>, LibraryError> {
        let catalog = self.catalog();
        let storage = run.storage_operation_id;
        let step = &run.moves[index];
        let missing = |what: &str| {
            LibraryError::PersistenceFailure(format!("archive move {} has no {what}", step.seq))
        };
        let destination =
            locations.get(&step.to_location_id).ok_or_else(|| missing("destination"))?;
        let to = absolute(locations, step.to_location_id, &step.to_path)
            .ok_or_else(|| missing("destination"))?;
        let from = absolute(locations, step.from_location_id, &step.from_path)
            .ok_or_else(|| missing("source"))?;
        let settled = |outcome, reason| async move {
            self.keep_source(storage, item, outcome, reason).await.map(|()| ControlFlow::Break(()))
        };
        // The record and every link move only to the registered root's copy
        // whose bytes were just read again. Refused before the record moved,
        // the source stays catalogued.
        let checked = match destination_root(destination).await? {
            Ok(()) => verified_copy(item, &to).await?,
            Err(reason) => Err(reason),
        };
        let fingerprint = match checked {
            Ok(fingerprint) => fingerprint,
            Err(reason) if step.repointed => {
                return settled(ArchiveMoveOutcome::SourceRetained, reason).await;
            }
            Err(reason) => return settled(ArchiveMoveOutcome::Blocked, reason).await,
        };
        if !step.repointed {
            match catalog.record_archive_repoint(storage, step.seq, &fingerprint).await {
                // The record now reads the copy's path: new-capture discovery
                // reads the destination again. The source is read again once
                // the original settled (`run_archive`).
                Ok(()) => self.recorded_paths_changed(step.to_location_id),
                Err(LibraryError::IdentityConflict(detail)) => {
                    let reason = ItemReason::new(
                        ReasonCode::DestinationOccupied,
                        format!(
                            "{detail}; the original stays and {} is left for review",
                            to.display()
                        ),
                    );
                    return settled(ArchiveMoveOutcome::Blocked, reason).await;
                }
                Err(error) => return Err(error),
            }
            if control.interrupted() {
                return Ok(ControlFlow::Break(()));
            }
        }
        let done: BTreeSet<EntryKey> = run.repointed_links.iter().map(key).collect();
        let records =
            catalog.kept_view_links(run.project_id, &BTreeSet::from([step.asset_id])).await?;
        for record in records.iter().filter(|record| !done.contains(&key(&record.link))) {
            let repointed = match destination_root(destination).await? {
                Ok(()) => self.repoint(storage, record, locations, &from, &to).await?,
                Err(reason) => Err(reason),
            };
            let identity = match repointed {
                Ok(identity) => identity,
                Err(reason) => return settled(ArchiveMoveOutcome::SourceRetained, reason).await,
            };
            let link = absolute_link(record).map_or_else(
                || record.link.clone(),
                |link| KeptViewLink { link, ..record.link.clone() },
            );
            catalog.record_kept_link_repoint(storage, step.seq, &link, &identity).await?;
        }
        if control.interrupted() {
            return Ok(ControlFlow::Break(()));
        }
        Ok(ControlFlow::Continue(()))
    }

    async fn journal_item(&self, storage: Uuid, seq: u32) -> Result<StorageItem, LibraryError> {
        self.catalog()
            .storage_operation(storage)
            .await?
            .items
            .into_iter()
            .find(|item| item.seq == seq)
            .ok_or_else(|| LibraryError::PersistenceFailure(format!("journal item {seq} is gone")))
    }

    /// Record a file's outcome from its journal outcome: once its record
    /// moved, a source the journal kept is retained beside the archive copy.
    async fn settle_move(
        &self,
        storage: Uuid,
        seq: u32,
        repointed: bool,
        outcome: ItemOutcome,
        reason: Option<ItemReason>,
    ) -> Result<(), LibraryError> {
        let outcome = match (outcome, repointed) {
            (ItemOutcome::Moved, true) => ArchiveMoveOutcome::Archived,
            (ItemOutcome::Uncertain, _) => ArchiveMoveOutcome::Uncertain,
            (_, true) => ArchiveMoveOutcome::SourceRetained,
            (_, false) => ArchiveMoveOutcome::Blocked,
        };
        let reason = reason.or_else(|| {
            (outcome != ArchiveMoveOutcome::Archived).then(|| {
                ItemReason::new(
                    ReasonCode::Interrupted,
                    "the file settled without its record moving",
                )
            })
        });
        self.catalog().settle_archive_move(storage, seq, outcome, reason.as_ref()).await
    }

    /// Settle a file without retiring its original: a verified copy stays
    /// beside the source it kept, an unverified one is blocked where the
    /// journal left it. A journal not yet started starts so its first file
    /// can settle.
    async fn keep_source(
        &self,
        storage: Uuid,
        item: &StorageItem,
        outcome: ArchiveMoveOutcome,
        reason: ItemReason,
    ) -> Result<(), LibraryError> {
        let kept = if item.phase == ItemPhase::DestinationVerified {
            ItemOutcome::SourceKept
        } else {
            ItemOutcome::Blocked
        };
        if item.phase == ItemPhase::Pending {
            self.catalog().start_storage_operation(storage).await?;
        }
        let change = ItemChange {
            phase: ItemPhase::Settled,
            outcome: Some(kept),
            reason: Some(reason.clone()),
            written: item.written.clone(),
        };
        self.catalog().advance_storage_item(storage, item.seq, item.revision, &change).await?;
        self.catalog().settle_archive_move(storage, item.seq, outcome, Some(&reason)).await
    }

    /// Rebuild one kept-View link to read the archive copy.
    async fn repoint(
        &self,
        storage: Uuid,
        record: &KeptLinkRecord,
        locations: &BTreeMap<Uuid, Location>,
        from: &Path,
        to: &Path,
    ) -> Result<Result<FileIdentity, ItemReason>, LibraryError> {
        let Some(link) = absolute_link(record).and_then(|link| link.to_path_buf().ok()) else {
            return Ok(Err(ItemReason::new(
                ReasonCode::SourceUnavailable,
                format!("{}'s kept View has no folder on record", record.project_name),
            )));
        };
        let (identity, reads) = match &record.repointed {
            Some((location, path, identity)) => {
                let Some(reads) = absolute(locations, *location, path) else {
                    return Ok(Err(ItemReason::new(
                        ReasonCode::SourceUnavailable,
                        format!("{} reads a location no longer on record", link.display()),
                    )));
                };
                (identity.clone(), reads)
            }
            None => match &record.entry.written {
                Some(identity) => (identity.clone(), from.to_path_buf()),
                None => {
                    return Ok(Err(ItemReason::new(
                        ReasonCode::DestinationChanged,
                        format!("{} has no recorded identity to check", link.display()),
                    )))
                }
            },
        };
        let staged = link.with_file_name(format!(".pv-repoint-{storage}-{}", record.link.seq));
        let to = to.to_path_buf();
        blocking(move || Ok(repoint_link(&link, &identity, &reads, &to, &staged))).await
    }
}

/// `path` below `location`'s root.
fn absolute(
    locations: &BTreeMap<Uuid, Location>,
    location: Uuid,
    path: &NativePath,
) -> Option<PathBuf> {
    Some(locations.get(&location)?.path.to_path_buf().ok()?.join(path.relative_path().ok()?))
}

/// A kept-View link's absolute path: `<Project>/View/<entry>`.
fn absolute_link(record: &KeptLinkRecord) -> Option<NativePath> {
    let project = project_folder(record.parent.as_ref(), &record.project_name).ok()??;
    Some(NativePath::from_path(
        &project.join(VIEW_FOLDER).join(record.entry.path.relative_path().ok()?),
    ))
}

/// Why `location` can't receive an archive now: not online, not the folder
/// it was registered as, or not writable; `None` when it can.
fn write_refusal(location: &Location) -> Option<ItemReason> {
    let offline = || {
        ItemReason::new(
            ReasonCode::WriteFailed,
            format!("location '{}' is not online and writable", location.name),
        )
    };
    if location.availability != Availability::Available {
        return Some(offline());
    }
    if let Err(reason) = root_refusal(location) {
        return Some(reason);
    }
    let root = location.path.to_path_buf().ok()?;
    (writability(&root) != Writability::Writable).then(offline)
}

/// Refuse `location` unless its root is still the registered folder on the
/// registered volume (STO-FR-06/07): a folder replaced or remounted at the
/// same path receives nothing.
fn root_refusal(location: &Location) -> Result<(), ItemReason> {
    inventory::check_location_root(location).map_err(|refusal| match refusal {
        RootRefusal::Mismatch(error) => {
            tracing::info!(location = %location.id, %error, "archive: destination root is not the registered folder");
            ItemReason::new(
                ReasonCode::DestinationChanged,
                format!(
                    "location '{}' is no longer the folder it was registered as; nothing is \
                     written to it",
                    location.name
                ),
            )
        }
        RootRefusal::Unobserved(error) => {
            tracing::warn!(location = %location.id, %error, "archive: destination root could not be checked");
            ItemReason::new(
                ReasonCode::WriteFailed,
                format!("location '{}' is not online", location.name),
            )
        }
    })
}

/// [`root_refusal`] off the async runtime, immediately before an archive
/// writes below the destination or moves a record or link to it.
async fn destination_root(location: &Location) -> Result<Result<(), ItemReason>, LibraryError> {
    let location = location.clone();
    blocking(move || Ok(root_refusal(&location))).await
}

/// The archive copy's observation with its digest, hashed again through a
/// handle proven to be the copy the journal wrote (STO-FR-07): a copy that
/// is no longer that file, or was rewritten since its verification, even in
/// place, is refused.
async fn verified_copy(
    item: &StorageItem,
    destination: &Path,
) -> Result<Result<ObservationFingerprint, ItemReason>, LibraryError> {
    let changed = ItemReason::new(
        ReasonCode::DestinationChanged,
        format!("{} changed after it was verified; the original stays", destination.display()),
    );
    let (Some(written), Some(sha256), Some(target)) =
        (item.written.clone(), item.source.sha256.clone(), item.destination.clone())
    else {
        return Ok(Err(changed));
    };
    let (source, path) = (item.source.clone(), destination.to_path_buf());
    blocking(move || {
        let observe = || {
            inventory::probe_fingerprint(&path)
                .ok()
                .filter(|observed| same_identity(&observed.identity, &written.identity))
        };
        let Some(before) = observe() else { return Ok(Err(changed)) };
        if let Err(reason) = transfer::verify(&source, &target, &written) {
            return Ok(Err(reason));
        }
        // Unchanged across the re-read: the digest is of these bytes.
        Ok(match observe() {
            Some(after) if after == before => {
                Ok(ObservationFingerprint { content_sha256: Some(sha256), ..after })
            }
            _ => Err(changed),
        })
    })
    .await
}

/// Rebuild the link at `link`, recorded with `identity` and reading
/// `from`, to read `to` (STO-FR-06, D-W111). A new link is made at `staged`
/// beside it and takes its place: by an atomic exchange on macOS and Linux,
/// and on Windows by moving the old link aside and installing the new one
/// under its name, neither rename ever replacing an entry. The old entry,
/// proven by a no-follow check to be the recorded link, is then deleted,
/// since a link holds no data; anything else found at the path is put back
/// untouched. A link already reading `to` is this archive's own after a
/// stop. Junctions are never made.
fn repoint_link(
    link: &Path,
    identity: &FileIdentity,
    from: &Path,
    to: &Path,
    staged: &Path,
) -> Result<FileIdentity, ItemReason> {
    let repoint = Repoint::new(link, identity, from, to, staged);
    #[cfg(unix)]
    let swap = Repoint::exchange;
    #[cfg(not(unix))]
    let swap = Repoint::move_aside;
    repoint.run(swap)
}

/// One kept-View link [`repoint_link`] rebuilds.
struct Repoint<'a> {
    link: &'a Path,
    identity: &'a FileIdentity,
    from: &'a Path,
    to: &'a Path,
    staged: &'a Path,
    /// Where the old link waits while the new one takes its name.
    aside: PathBuf,
}

impl<'a> Repoint<'a> {
    fn new(
        link: &'a Path,
        identity: &'a FileIdentity,
        from: &'a Path,
        to: &'a Path,
        staged: &'a Path,
    ) -> Self {
        let mut aside = staged.as_os_str().to_owned();
        aside.push(".old");
        Self { link, identity, from, to, staged, aside: PathBuf::from(aside) }
    }

    /// Check the link, stage its replacement and `swap` it in place.
    fn run(
        &self,
        swap: impl Fn(&Self) -> Result<(), ItemReason>,
    ) -> Result<FileIdentity, ItemReason> {
        self.settle_leftovers()?;
        if self.reads_to(self.link) {
            return link_identity(self.link);
        }
        let current = observe_entry(self.link).map_err(|error| write_failed(self.link, &error))?;
        if !self.recorded(&current) {
            return Err(self.changed());
        }
        fs_pathsafe::create_symlink(self.to, self.staged)
            .map_err(|error| write_failed(self.staged, &error))?;
        swap(self)?;
        link_identity(self.link)
    }

    /// What a stop left beside the link. The old link, after the new one
    /// took its name, is deleted; while the name is still free it is put
    /// back. A new link not yet in place is removed.
    fn settle_leftovers(&self) -> Result<(), ItemReason> {
        for old in [self.staged, self.aside.as_path()] {
            if !self.recorded_at(old) {
                continue;
            }
            if vacant(self.link) {
                transfer::rename_noreplace(old, self.link)
                    .map_err(|error| write_failed(self.link, &error))?;
            } else if self.reads_to(self.link) {
                let _ = fs::remove_file(old);
            }
        }
        self.discard();
        Ok(())
    }

    /// Exchange the staged link with the link atomically, then delete the
    /// old one once it proves to be the recorded link.
    #[cfg(unix)]
    fn exchange(&self) -> Result<(), ItemReason> {
        use rustix::fs::{renameat_with, RenameFlags, CWD};

        let exchange = || renameat_with(CWD, self.staged, CWD, self.link, RenameFlags::EXCHANGE);
        if let Err(error) = exchange() {
            self.discard();
            return Err(ItemReason::new(
                ReasonCode::WriteFailed,
                format!("{} cannot be exchanged: {error}", self.link.display()),
            ));
        }
        if !self.recorded_at(self.staged) {
            if exchange().is_ok() {
                self.discard();
                return Err(self.changed());
            }
            return Err(self.stranded(self.staged));
        }
        fs::remove_file(self.staged).map_err(|error| write_failed(self.staged, &error))
    }

    /// Move the link aside, install the staged link under its name, then
    /// delete the old one, which proved to be the recorded link once aside.
    /// Windows has no exchange, so this swap is not atomic: between its two
    /// renames the link's name is free. Neither rename replaces an entry
    /// ([`transfer::rename_noreplace`]), so a name taken in between fails
    /// the install, the old link goes back and nothing is lost; a stop in
    /// between leaves the old link aside, which the next run puts back
    /// before it checks the link again ([`Self::settle_leftovers`]).
    #[cfg(any(not(unix), test))]
    fn move_aside(&self) -> Result<(), ItemReason> {
        if let Err(error) = transfer::rename_noreplace(self.link, &self.aside) {
            self.discard();
            return Err(write_failed(self.link, &error));
        }
        let put_back = || transfer::rename_noreplace(&self.aside, self.link).is_ok();
        if !self.recorded_at(&self.aside) {
            if put_back() {
                self.discard();
                return Err(self.changed());
            }
            return Err(self.stranded(&self.aside));
        }
        if let Err(error) = transfer::rename_noreplace(self.staged, self.link) {
            if put_back() {
                self.discard();
                return Err(write_failed(self.link, &error));
            }
            return Err(self.stranded(&self.aside));
        }
        fs::remove_file(&self.aside).map_err(|error| write_failed(&self.aside, &error))
    }

    /// Whether `evidence` is the recorded link: a link reading `from` with
    /// the recorded identity.
    fn recorded(&self, evidence: &EntryEvidence) -> bool {
        matches!(&evidence.kind, EntryKind::Link { target } if *target == NativePath::from_path(self.from))
            && same_identity(&evidence.fingerprint.identity, self.identity)
    }

    /// Whether `path` holds the recorded link, by a no-follow check.
    fn recorded_at(&self, path: &Path) -> bool {
        observe_entry(path).is_ok_and(|evidence| self.recorded(&evidence))
    }

    /// Whether `path` is a link reading the archive copy.
    fn reads_to(&self, path: &Path) -> bool {
        fs::read_link(path).is_ok_and(|target| target == self.to)
    }

    /// Remove the staged link while it is still a link reading `to`.
    fn discard(&self) {
        if self.reads_to(self.staged) {
            let _ = fs::remove_file(self.staged);
        }
    }

    fn changed(&self) -> ItemReason {
        ItemReason::new(
            ReasonCode::DestinationChanged,
            format!("{} changed outside PlateVault; it and its original stay", self.link.display()),
        )
    }

    fn stranded(&self, at: &Path) -> ItemReason {
        ItemReason::new(
            ReasonCode::Interrupted,
            format!(
                "{} could not be put back; the entry that was there is at {}",
                self.link.display(),
                at.display()
            ),
        )
    }
}

fn write_failed(path: &Path, error: &impl std::fmt::Display) -> ItemReason {
    ItemReason::new(ReasonCode::WriteFailed, format!("{}: {error}", path.display()))
}

/// The no-follow identity of the link at `path`.
fn link_identity(path: &Path) -> Result<FileIdentity, ItemReason> {
    observe_entry(path)
        .map(|now| now.fingerprint.identity)
        .map_err(|error| write_failed(path, &error))
}

/// Whether nothing is at `path`.
fn vacant(path: &Path) -> bool {
    fs::symlink_metadata(path).is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
}

/// The repoint contract covers the current platform's swap. On Windows the
/// tests exercise `move_aside`; they skip only when Developer Mode is off.
#[cfg(test)]
mod tests {
    use std::io;

    use super::*;

    #[cfg(unix)]
    const SWAPS: &[bool] = &[true, false];
    #[cfg(not(unix))]
    const SWAPS: &[bool] = &[false];

    fn create_symlink(source: &Path, destination: &Path) -> io::Result<()> {
        fs_pathsafe::create_symlink(source, destination)
    }

    fn developer_mode_off(error: &io::Error) -> bool {
        cfg!(windows) && error.raw_os_error() == Some(1314)
    }

    /// A captures original, its archive copy and a View link reading the
    /// original, all on one volume.
    struct View {
        _temp: tempfile::TempDir,
        from: PathBuf,
        to: PathBuf,
        link: PathBuf,
        staged: PathBuf,
    }

    impl View {
        fn new() -> Option<Self> {
            let temp = tempfile::tempdir().unwrap();
            let root = fs::canonicalize(temp.path()).unwrap();
            for folder in ["captures", "archive", "View"] {
                fs::create_dir(root.join(folder)).unwrap();
            }
            let from = root.join("captures/Light_001.fits");
            let to = root.join("archive/Light_001.fits");
            fs::write(&from, b"frame").unwrap();
            fs::write(&to, b"frame").unwrap();
            let link = root.join("View/Light_001.fits");
            if let Err(error) = create_symlink(&from, &link) {
                if developer_mode_off(&error) {
                    eprintln!("skipping repoint contract test: Windows Developer Mode is off, so creating file symlinks requires elevation");
                    return None;
                }
                panic!("failed to create test symlink {link:?} -> {from:?}: {error}");
            }
            let staged = root.join("View/.pv-repoint-op-0");
            Some(Self { _temp: temp, from, to, link, staged })
        }

        fn identity(&self) -> FileIdentity {
            observe_entry(&self.link).unwrap().fingerprint.identity
        }

        fn aside(&self) -> PathBuf {
            Repoint::new(&self.link, &self.identity(), &self.from, &self.to, &self.staged).aside
        }

        fn repoint(
            &self,
            identity: &FileIdentity,
            exchange: bool,
        ) -> Result<FileIdentity, ItemReason> {
            let repoint = Repoint::new(&self.link, identity, &self.from, &self.to, &self.staged);
            #[cfg(unix)]
            if exchange {
                return repoint.run(Repoint::exchange);
            }
            #[cfg(unix)]
            let _ = exchange;
            #[cfg(not(unix))]
            let _ = exchange;
            repoint.run(Repoint::move_aside)
        }

        /// Nothing is left beside the link and both files are untouched.
        fn tidy(&self, aside: &Path) {
            assert!(vacant(&self.staged) && vacant(aside), "a staged or old link is left");
            assert_eq!(fs::read(&self.from).unwrap(), b"frame");
            assert_eq!(fs::read(&self.to).unwrap(), b"frame");
        }
    }

    #[test]
    fn the_recorded_link_is_rebuilt_to_read_the_copy() {
        for &exchange in SWAPS {
            let Some(view) = View::new() else { return };
            let aside = view.aside();
            let identity = view.repoint(&view.identity(), exchange).unwrap();
            assert_eq!(fs::read_link(&view.link).unwrap(), view.to, "exchange: {exchange}");
            assert!(same_identity(&view.identity(), &identity));
            view.tidy(&aside);
        }
    }

    #[test]
    fn a_link_replaced_since_it_was_recorded_stays() {
        for &exchange in SWAPS {
            let Some(view) = View::new() else { return };
            let aside = view.aside();
            let recorded = view.identity();
            fs::remove_file(&view.link).unwrap();
            // Same target, another link: its identity is not the recorded one.
            let other = view.link.with_file_name("other");
            create_symlink(&view.from, &other).unwrap();
            fs::rename(&other, &view.link).unwrap();
            let refused = view.repoint(&recorded, exchange).unwrap_err();
            assert_eq!(refused.code, ReasonCode::DestinationChanged, "exchange: {exchange}");
            assert_eq!(fs::read_link(&view.link).unwrap(), view.from);
            view.tidy(&aside);
        }
    }

    #[test]
    fn a_file_at_the_link_path_is_never_touched() {
        for &exchange in SWAPS {
            let Some(view) = View::new() else { return };
            let aside = view.aside();
            let recorded = view.identity();
            fs::remove_file(&view.link).unwrap();
            fs::write(&view.link, b"user data").unwrap();
            let refused = view.repoint(&recorded, exchange).unwrap_err();
            assert_eq!(refused.code, ReasonCode::DestinationChanged, "exchange: {exchange}");
            assert_eq!(fs::read(&view.link).unwrap(), b"user data");
            view.tidy(&aside);
        }
    }

    #[test]
    fn a_link_already_reading_the_copy_is_this_archives_own() {
        for &exchange in SWAPS {
            let Some(view) = View::new() else { return };
            let aside = view.aside();
            let recorded = view.identity();
            fs::remove_file(&view.link).unwrap();
            create_symlink(&view.to, &view.link).unwrap();
            let identity = view.repoint(&recorded, exchange).unwrap();
            assert!(same_identity(&view.identity(), &identity), "exchange: {exchange}");
            view.tidy(&aside);
        }
    }

    /// A stop between moving the old link aside and installing the new one
    /// left the name free: the old link goes back first, then is rebuilt.
    #[test]
    fn a_stop_with_the_old_link_aside_puts_it_back_first() {
        for &exchange in SWAPS {
            let Some(view) = View::new() else { return };
            let aside = view.aside();
            let recorded = view.identity();
            fs::rename(&view.link, &aside).unwrap();
            create_symlink(&view.to, &view.staged).unwrap();
            view.repoint(&recorded, exchange).unwrap();
            assert_eq!(fs::read_link(&view.link).unwrap(), view.to, "exchange: {exchange}");
            view.tidy(&aside);
        }
    }

    /// A stop after the new link took the name left the old one beside it,
    /// where each swap puts it: it is deleted.
    #[test]
    fn a_stop_after_the_swap_deletes_the_old_link() {
        for &exchange in SWAPS {
            let Some(view) = View::new() else { return };
            let aside = view.aside();
            let recorded = view.identity();
            let beside = if exchange { view.staged.clone() } else { aside.clone() };
            fs::rename(&view.link, &beside).unwrap();
            create_symlink(&view.to, &view.link).unwrap();
            view.repoint(&recorded, exchange).unwrap();
            assert_eq!(fs::read_link(&view.link).unwrap(), view.to, "exchange: {exchange}");
            view.tidy(&aside);
        }
    }
}
