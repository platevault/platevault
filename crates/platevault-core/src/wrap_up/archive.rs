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
//! and verified; then its catalog record moves to the copy; then every
//! kept-View link that read the original is rebuilt to read the copy after
//! a no-follow check that it is still the recorded link, and recorded beside
//! the frozen manifest; only then is the original retired to the OS Trash,
//! re-verified first. A link that can't be repointed keeps the original.
//! Every step is durable, so a stop resumes from the recorded phase and the
//! archive settles its Project Archived, or Closed when nothing moved.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use persistence_library::{ArchiveAsset, ArchiveDraft, ArchiveRun, KeptLinkRecord};
use platevault_pixels::measure;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::project_folder;
use crate::custody::trash::OsTrash;
use crate::custody::{observe_entry, same_identity};
use crate::import::{classify, naming_metadata, writability};
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
        let destination_ready = {
            let root = root.clone();
            let online = destination.availability == Availability::Available;
            blocking(move || Ok(online && writability(&root) == Writability::Writable)).await?
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
                } else if !destination_ready {
                    Some((
                        ReasonCode::WriteFailed,
                        format!("location '{}' is not online and writable", destination.name),
                    ))
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
    /// type's template folder, then its file name. `{target}` reads the
    /// header's OBJECT, else the session's confirmed Target. `Err` names why
    /// the template can't lay it out.
    pub(crate) async fn archive_layout(
        &self,
        asset: &ArchiveAsset,
    ) -> Result<Result<(NativePath, Vec<NamingFallback>), String>, LibraryError> {
        let frame = &asset.asset;
        let Some(frame_type) = classify(&frame.effective, &frame.relative_path) else {
            return Ok(Err("the frame has no frame-type header to choose its template".into()));
        };
        let mut metadata = naming_metadata(&frame.effective, frame_type);
        if metadata.target.is_none() {
            metadata.target.clone_from(&asset.target);
        }
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
            if run.moves[index].outcome.is_none() {
                return Ok(run.progress(&locations));
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
    // recorded resume point.
    #[allow(clippy::too_many_lines)]
    async fn archive_one(
        &self,
        run: &ArchiveRun,
        index: usize,
        trash: &Arc<dyn OsTrash>,
        control: &dyn ArchiveControl,
        locations: &BTreeMap<Uuid, Location>,
    ) -> Result<(), LibraryError> {
        let catalog = self.catalog();
        let storage = run.storage_operation_id;
        let step = &run.moves[index];
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
            self.step_storage_operation(storage, Arc::clone(trash)).await?;
        };
        if let Some(outcome) = item.outcome {
            return self.settle_move(storage, step.seq, step.repointed, outcome, item.reason).await;
        }
        if item.phase == ItemPhase::DestinationVerified {
            let to = absolute(locations, step.to_location_id, &step.to_path).ok_or_else(|| {
                LibraryError::PersistenceFailure(format!(
                    "archive move {} has no destination",
                    step.seq
                ))
            })?;
            if !step.repointed {
                let Some(fingerprint) = verified_copy(&item, &to).await? else {
                    let reason = ItemReason::new(
                        ReasonCode::DestinationChanged,
                        format!(
                            "{} changed after it was verified; the original stays",
                            to.display()
                        ),
                    );
                    return self
                        .keep_source(storage, &item, ArchiveMoveOutcome::Blocked, reason)
                        .await;
                };
                match catalog.record_archive_repoint(storage, step.seq, &fingerprint).await {
                    Ok(()) => {}
                    Err(LibraryError::IdentityConflict(detail)) => {
                        let reason = ItemReason::new(
                            ReasonCode::DestinationOccupied,
                            format!(
                                "{detail}; the original stays and {} is left for review",
                                to.display()
                            ),
                        );
                        return self
                            .keep_source(storage, &item, ArchiveMoveOutcome::Blocked, reason)
                            .await;
                    }
                    Err(error) => return Err(error),
                }
                if control.interrupted() {
                    return Ok(());
                }
            }
            let from =
                absolute(locations, step.from_location_id, &step.from_path).ok_or_else(|| {
                    LibraryError::PersistenceFailure(format!(
                        "archive move {} has no source",
                        step.seq
                    ))
                })?;
            let done: BTreeSet<EntryKey> = run.repointed_links.iter().map(key).collect();
            let records =
                catalog.kept_view_links(run.project_id, &BTreeSet::from([step.asset_id])).await?;
            for record in records.iter().filter(|record| !done.contains(&key(&record.link))) {
                match self.repoint(storage, record, locations, &from, &to).await? {
                    Ok(identity) => {
                        let link = absolute_link(record).map_or_else(
                            || record.link.clone(),
                            |link| KeptViewLink { link, ..record.link.clone() },
                        );
                        catalog
                            .record_kept_link_repoint(storage, step.seq, &link, &identity)
                            .await?;
                    }
                    Err(reason) => {
                        return self
                            .keep_source(storage, &item, ArchiveMoveOutcome::SourceRetained, reason)
                            .await;
                    }
                }
            }
            if control.interrupted() {
                return Ok(());
            }
        }
        let item = loop {
            let item = self.journal_item(storage, step.seq).await?;
            if item.outcome.is_some() {
                break item;
            }
            self.step_storage_operation(storage, Arc::clone(trash)).await?;
        };
        let outcome = item.outcome.unwrap_or(ItemOutcome::Uncertain);
        self.settle_move(storage, step.seq, true, outcome, item.reason).await
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

    /// Settle a verified file without retiring its original.
    async fn keep_source(
        &self,
        storage: Uuid,
        item: &StorageItem,
        outcome: ArchiveMoveOutcome,
        reason: ItemReason,
    ) -> Result<(), LibraryError> {
        let change = ItemChange {
            phase: ItemPhase::Settled,
            outcome: Some(ItemOutcome::SourceKept),
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

/// The archive copy's observation with the verified digest, while it is
/// still the copy the journal wrote; `None` otherwise.
async fn verified_copy(
    item: &StorageItem,
    destination: &Path,
) -> Result<Option<ObservationFingerprint>, LibraryError> {
    let (Some(written), Some(sha256)) = (item.written.clone(), item.source.sha256.clone()) else {
        return Ok(None);
    };
    let probe = destination.to_path_buf();
    let observed = blocking(move || Ok(inventory::probe_fingerprint(&probe))).await?;
    Ok(observed
        .ok()
        .filter(|observed| same_identity(&observed.identity, &written.identity))
        .map(|observed| ObservationFingerprint { content_sha256: Some(sha256), ..observed }))
}

/// Rebuild the link at `link`, recorded with `identity` and reading
/// `from`, to read `to` (STO-FR-06): a new link is made beside it and
/// atomically exchanged with it; the old entry, proven by a no-follow check
/// to be the recorded link, is then deleted, since a link holds no data.
/// Anything else at the path is swapped back untouched. A link already
/// reading `to` is this archive's own after a stop.
#[cfg(unix)]
fn repoint_link(
    link: &Path,
    identity: &FileIdentity,
    from: &Path,
    to: &Path,
    staged: &Path,
) -> Result<FileIdentity, ItemReason> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};

    let failed = |detail: String| ItemReason::new(ReasonCode::WriteFailed, detail);
    let changed = || {
        ItemReason::new(
            ReasonCode::DestinationChanged,
            format!("{} changed outside PlateVault; it and its original stay", link.display()),
        )
    };
    let ours = |evidence: &EntryEvidence| {
        matches!(&evidence.kind, EntryKind::Link { target } if *target == NativePath::from_path(from))
            && same_identity(&evidence.fingerprint.identity, identity)
    };
    let observe = |path: &Path| {
        observe_entry(path).map_err(|error| failed(format!("{}: {error}", path.display())))
    };
    // The old link a stop left beside it after the exchange.
    if observe_entry(staged).is_ok_and(|old| ours(&old)) {
        let _ = fs::remove_file(staged);
    }
    if fs::read_link(link).is_ok_and(|target| target == to) {
        return observe(link).map(|now| now.fingerprint.identity);
    }
    if !ours(&observe(link)?) {
        return Err(changed());
    }
    std::os::unix::fs::symlink(to, staged)
        .map_err(|error| failed(format!("{}: {error}", staged.display())))?;
    let discard = || {
        if fs::read_link(staged).is_ok_and(|target| target == to) {
            let _ = fs::remove_file(staged);
        }
    };
    if let Err(error) = renameat_with(CWD, staged, CWD, link, RenameFlags::EXCHANGE) {
        discard();
        return Err(failed(format!("{} cannot be exchanged: {error}", link.display())));
    }
    if !observe_entry(staged).is_ok_and(|old| ours(&old)) {
        if renameat_with(CWD, staged, CWD, link, RenameFlags::EXCHANGE).is_ok() {
            discard();
            return Err(changed());
        }
        return Err(ItemReason::new(
            ReasonCode::Interrupted,
            format!(
                "{} could not be swapped back; the old link is at {}",
                link.display(),
                staged.display()
            ),
        ));
    }
    fs::remove_file(staged).map_err(|error| failed(format!("{}: {error}", staged.display())))?;
    observe(link).map(|now| now.fingerprint.identity)
}

#[cfg(not(unix))]
fn repoint_link(
    link: &Path,
    _identity: &FileIdentity,
    _from: &Path,
    _to: &Path,
    _staged: &Path,
) -> Result<FileIdentity, ItemReason> {
    Err(ItemReason::new(
        ReasonCode::WriteFailed,
        format!(
            "repointing the kept View link {} is supported on macOS and Linux only; its original stays",
            link.display()
        ),
    ))
}
