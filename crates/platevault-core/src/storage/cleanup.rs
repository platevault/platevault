// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Run Clean up and Empty Trash execution (spec 071 STO-FR-01..05/10/17,
//! PREP-FR-14, RES-FR-10, RES-AC-22, PV-PREP-SC-04; D-W26, D-W72, D-W75).
//!
//! Clean up lists only the entries a run's preparation revisions created
//! (links, clones and copies), grouped by kind and preselected; once the run
//! is Complete every such entry, before then only the entries of revisions a
//! later one replaced. A Direct-source run lists nothing. Empty Trash, for a
//! run in its Project's Trash, lists every entry of each prepared folder and,
//! only when the user ticks it, of the Results folder; each folder follows its
//! entries to the OS Trash once nothing but empty folders remains in it, and
//! then the run record goes with every row it owns. A panel run's folders are
//! its `Panel N/` folders and `<Mosaic> Results/Panel N/`; Empty Trash of the
//! last panel run left in its run group also takes each group folder, once
//! its `Panel N/` folders are gone, and the ticked `Assembled/` folder unless
//! another run uses one of its accepted Results (D-W75). Every folder comes
//! from PREP's records: one recorded with the form it resolved to when
//! Prepare made it must still resolve there, so a retargeted symlinked parent
//! never turns run removal on another folder (PREP-FR-07).
//!
//! Review reads each moving entry's evidence (a file with its SHA-256, a link
//! by its own identity and target text, never followed) and the retained
//! original a hardlink, clone or copy relies on, and records them with the
//! storage journal; execution re-verifies both immediately before each move
//! (D19) and resumes from the journal after an interruption. A patched copy
//! or clone moves against its own patched digest (PREP-FR-03), its retained
//! original against the source's. A hardlink whose original no longer holds
//! its bytes is the last copy and stays. An item on a location without an OS
//! Trash, an item whose evidence drifted, and any library frame or original
//! source stay where they are and are named with their reason. Nothing is
//! ever deleted: the OS Trash is the only way out, with no fallback.

use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};

use persistence_library::{
    CleanupDisposition, CleanupFolderDraft, CleanupItemDraft, PreparationRecord, RecordedFolder,
    RunCleanupDraft, RunCleanupFolder, RunCleanupRecord, RunFolders,
};
use uuid::Uuid;

use crate::custody::journal::Live;
use crate::custody::trash::OsTrash;
use crate::custody::{observe_entry, same_identity, verify_source};
use crate::library::{blocking, Library};
use crate::prepare::resolved;
use crate::run_lifecycle::{BlockersFuture, RunOperationGuard};
use crate::{
    inventory, CleanupFolder, CleanupFolderRole, CleanupGroup, CleanupItem, CleanupItemState,
    CleanupKind, CleanupOutcome, CleanupRequest, CleanupReview, CleanupRole, CleanupSelection,
    CleanupState, EntryEvidence, EntryKind, FileIdentity, ItemOutcome, ItemPhase, ItemReason,
    KeptCopy, LibraryError, LifecycleBlocker, NativePath, PreparationState, PreparedEntryKey,
    PreparedEntryKind, PreparedInput, ReasonCode, RunCompletion, RunOperationKind, StayingItem,
    StorageItemDraft, TrashSupport, View, ViewRecord,
};

const CLEAN_UP_STATEMENT: &str = "Clean up moves each selected prepared entry to the OS Trash \
    after re-verifying it and the original it relies on. Original sources, Direct-source paths, \
    library frames and the Results folder are never listed, and selecting a group never removes \
    a folder. Nothing moves until Clean up is confirmed; an item that cannot go to the OS Trash \
    stays in place.";

const NOTHING_CREATED_STATEMENT: &str = "This run's preparation created no entries, so Clean up \
    offers nothing to remove.";

const NOTHING_REPLACED_STATEMENT: &str = "Until the run is Complete, Clean up offers only the \
    entries of preparation revisions a later revision replaced, and there are none.";

const NOTHING_LEFT_STATEMENT: &str = "Every entry this run's preparation created has already \
    gone to the OS Trash, so Clean up offers nothing to remove.";

const EMPTY_TRASH_STATEMENT: &str = "Empty Trash moves every entry of the run's prepared folders \
    to the OS Trash, then each emptied folder, and removes the run record; the Results folder \
    goes only when ticked. Library frames, their quality decisions and other runs never change. \
    An item that cannot go to the OS Trash stays in place and is named. Putting items back from \
    the OS Trash restores files, never the run.";

/// The group order of a review.
const ROLES: [CleanupRole; 6] = [
    CleanupRole::Symlink,
    CleanupRole::Hardlink,
    CleanupRole::Copy,
    CleanupRole::Clone,
    CleanupRole::Unprepared,
    CleanupRole::Result,
];

/// The position of `role` in [`ROLES`].
const fn group_index(role: CleanupRole) -> usize {
    match role {
        CleanupRole::Symlink => 0,
        CleanupRole::Hardlink => 1,
        CleanupRole::Copy => 2,
        CleanupRole::Clone => 3,
        CleanupRole::Unprepared => 4,
        CleanupRole::Result => 5,
    }
}

/// One item a review lists, before its evidence is read.
struct Candidate {
    path: PathBuf,
    role: CleanupRole,
    input: Option<PreparedInput>,
    entry: Option<PreparedEntryKey>,
    revision: Option<u32>,
    /// The original source a prepared entry was made from.
    source: Option<PathBuf>,
    /// The entry as preparation wrote it.
    written: Option<EntryEvidence>,
    source_sha256: Option<String>,
    size_bytes: u64,
    selected: bool,
    /// Index into the review's folders.
    folder: usize,
}

/// One folder a review covers.
struct FolderPlan {
    path: PathBuf,
    role: CleanupFolderRole,
    /// Its identity, or why it stays as a whole: it is not the folder
    /// preparation wrote, or another run still needs what it holds.
    identity: Result<FileIdentity, ItemReason>,
}

/// One item with what review decided for it.
struct Assessed {
    candidate: Candidate,
    state: CleanupItemState,
    draft: Option<StorageItemDraft>,
    relies_on: Option<PathBuf>,
}

impl Library {
    /// Review Clean up or Empty Trash for one run and record what the user
    /// will confirm: each moving entry with its evidence and the retained
    /// original it relies on, every item that stays with its reason, and for
    /// Empty Trash every folder. Nothing on disk changes, and a review of the
    /// run that never started is replaced.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; `InvalidInput` while one of its
    /// preparations or another removal of it is running, for Clean up of a run
    /// in its Project's Trash, for Empty Trash of a run outside it or of one
    /// whose accepted Result another run uses; catalog and folder errors.
    pub async fn review_cleanup(
        &self,
        request: &CleanupRequest,
        trash: Arc<dyn OsTrash>,
    ) -> Result<CleanupReview, LibraryError> {
        let view_id = request.view_id();
        let run = self.catalog().view(view_id).await?;
        let run_name = run_name(&run);
        if let Some((id, kind)) = self.catalog().running_run_cleanup(view_id).await? {
            return Err(LibraryError::InvalidInput(format!(
                "{} {id} of run '{run_name}' is running; it finishes before another review",
                kind_name(kind)
            )));
        }
        let preparations = self.preparations(view_id, &run_name).await?;
        let recorded = self.catalog().run_folders(view_id).await?;
        let (selection, results_folder, ticked) = match request {
            CleanupRequest::CleanUp { selection, .. } => {
                if run.view.trashed_at.is_some() {
                    return Err(LibraryError::InvalidInput(format!(
                        "run '{run_name}' is in its Project's Trash; Empty Trash removes its \
                         prepared folders"
                    )));
                }
                (selection.clone(), None, false)
            }
            CleanupRequest::EmptyTrash { results, .. } => {
                if run.view.trashed_at.is_none() {
                    return Err(LibraryError::InvalidInput(format!(
                        "run '{run_name}' is not in its Project's Trash"
                    )));
                }
                let users = self.catalog().run_result_users(view_id).await?;
                if !users.is_empty() {
                    let named: Vec<String> = users.iter().map(ToString::to_string).collect();
                    return Err(LibraryError::InvalidInput(format!(
                        "run '{run_name}' cannot be removed: an accepted Result of it is an \
                         input to run {}",
                        named.join(", ")
                    )));
                }
                let folder = recorded.results.as_ref().map(|results| results.path.clone());
                (CleanupSelection::default(), folder, *results)
            }
        };
        let (folders, candidates) = match request.kind() {
            CleanupKind::CleanUp => {
                let removed = self.catalog().removed_prepared_entries(view_id).await?;
                let scope = clean_up_scope(&run.view, &preparations);
                let prepared = recorded.prepared;
                blocking(move || Ok(clean_up_candidates(&scope, &prepared, &removed, &selection)))
                    .await?
            }
            CleanupKind::EmptyTrash => {
                let records = preparations.clone();
                blocking(move || empty_trash_candidates(&records, &recorded, ticked)).await?
            }
        };
        let protected = self.protected_paths(&folders, &preparations).await?;
        let kind = request.kind();
        let check = Arc::clone(&trash);
        let (folders, assessed) = blocking(move || {
            let supports: Vec<TrashSupport> =
                folders.iter().map(|folder| check.support(&folder.path, 0)).collect();
            let assessed = candidates
                .into_iter()
                .map(|candidate| {
                    let folder_staying = (kind == CleanupKind::EmptyTrash)
                        .then(|| {
                            folder_staying(&folders[candidate.folder], &supports[candidate.folder])
                        })
                        .flatten();
                    assess(candidate, check.as_ref(), &protected, folder_staying)
                })
                .collect::<Vec<_>>();
            Ok((folders.into_iter().zip(supports).collect::<Vec<_>>(), assessed))
        })
        .await?;
        let mut review = self
            .record_review(request, run_name, folders, assessed, results_folder, ticked)
            .await?;
        if kind == CleanupKind::CleanUp && review.groups.is_empty() {
            review.statement = nothing_to_clean(&run.view, &preparations).into();
        }
        Ok(review)
    }

    /// Execute a recorded Clean up: every recorded entry goes to the OS Trash
    /// once it and the original it relies on re-verify (D19); an entry that
    /// does not stays where it is. A running Clean up resumes from the
    /// journal; a settled one returns its outcome.
    ///
    /// # Errors
    /// `NotFound` for an unknown review; `InvalidInput` for an Empty Trash
    /// review, while the review is already executing in this process, or when
    /// the run moved to its Project's Trash since the review.
    pub async fn run_cleanup(
        &self,
        id: Uuid,
        trash: Arc<dyn OsTrash>,
    ) -> Result<CleanupOutcome, LibraryError> {
        let _live = Live::claim(id)?;
        require_kind(&self.catalog().run_cleanup(id).await?, CleanupKind::CleanUp)?;
        let record = self.catalog().start_run_cleanup(id).await?;
        if record.state == CleanupState::Running {
            if let Some(operation) = record.operation_id {
                self.run_storage_operation(operation, trash).await?;
            }
            self.catalog().settle_run_cleanup(id).await?;
        }
        self.cleanup_outcome(id).await
    }

    /// Execute a recorded Empty Trash (STO-FR-17): every recorded entry goes
    /// to the OS Trash once it and the original it relies on re-verify (D19),
    /// then each folder left holding nothing but empty folders, and then the
    /// run record is removed with every row it owns. Items that cannot go
    /// stay where they are and are named in the outcome. Library frames and
    /// quality decisions never change. A running Empty Trash resumes.
    ///
    /// # Errors
    /// `NotFound` for an unknown review; `InvalidInput` for a Clean up
    /// review, while the review is already executing in this process, when
    /// the run left its Project's Trash since the review, or when an accepted
    /// Result of it became another run's input.
    pub async fn empty_trash(
        &self,
        id: Uuid,
        trash: Arc<dyn OsTrash>,
    ) -> Result<CleanupOutcome, LibraryError> {
        let _live = Live::claim(id)?;
        require_kind(&self.catalog().run_cleanup(id).await?, CleanupKind::EmptyTrash)?;
        let record = self.catalog().start_run_cleanup(id).await?;
        if record.state == CleanupState::Running {
            if let Some(operation) = record.operation_id {
                self.run_storage_operation(operation, Arc::clone(&trash)).await?;
            }
            self.retire_folders(id, &trash).await?;
            self.catalog().remove_trashed_run(id).await?;
        }
        self.cleanup_outcome(id).await
    }

    /// Where a recorded Clean up or Empty Trash stands: what went to the OS
    /// Trash and every item left behind with its path and reason (STO-FR-05).
    ///
    /// # Errors
    /// `NotFound` for an unknown review; catalog errors.
    pub async fn cleanup_outcome(&self, id: Uuid) -> Result<CleanupOutcome, LibraryError> {
        let record = self.catalog().run_cleanup(id).await?;
        let operation = match record.operation_id {
            Some(operation) => Some(self.catalog().storage_operation(operation).await?),
            None => None,
        };
        let journal: HashMap<u32, (Option<ItemOutcome>, Option<ItemReason>)> = operation
            .iter()
            .flat_map(|operation| &operation.items)
            .map(|item| (item.seq, (item.outcome, item.reason.clone())))
            .collect();
        let covering: Vec<&RunCleanupFolder> = record
            .folders
            .iter()
            .filter(|folder| {
                folder.outcome == Some(ItemOutcome::Blocked) && folder.reason.is_some()
            })
            .collect();
        let mut moved = Vec::new();
        let mut left = Vec::new();
        for item in &record.items {
            let covered = || {
                let path = item.path.to_path_buf().ok();
                covering.iter().any(|folder| {
                    folder.path.to_path_buf().is_ok_and(|folder| {
                        path.as_ref().is_some_and(|path| path.starts_with(&folder))
                    })
                })
            };
            match (&item.staying, item.storage_seq.and_then(|seq| journal.get(&seq))) {
                (Some(_), _) if covered() => {}
                (Some(reason), _) => left.push(staying(&item.path, false, reason.clone())),
                (None, Some((Some(ItemOutcome::Trashed), _))) => moved.push(item.path.clone()),
                (None, Some((Some(_), reason))) => left.push(staying(
                    &item.path,
                    false,
                    reason.clone().unwrap_or_else(|| {
                        ItemReason::new(ReasonCode::TrashFailed, "the move was not proven")
                    }),
                )),
                (None, _) => {}
            }
        }
        for folder in &record.folders {
            match (folder.outcome, &folder.reason) {
                (Some(ItemOutcome::Trashed), _) => moved.push(folder.path.clone()),
                (Some(_), Some(reason)) => left.push(staying(&folder.path, true, reason.clone())),
                _ => {}
            }
        }
        let run_removed = record.run_removed_at.is_some();
        let summary = summary(&record, &moved, &left, run_removed);
        Ok(CleanupOutcome {
            id,
            kind: record.kind,
            view_id: record.view_id,
            run_name: record.run_name,
            state: record.state,
            operation_id: record.operation_id,
            moved,
            left,
            run_removed,
            summary,
        })
    }

    /// Every preparation revision of the run with its entries; none may be
    /// Running.
    async fn preparations(
        &self,
        view: Uuid,
        run_name: &str,
    ) -> Result<Vec<PreparationRecord>, LibraryError> {
        let mut records = Vec::new();
        for revision in self.catalog().view_preparations(view).await? {
            if revision.state == PreparationState::Running {
                return Err(LibraryError::InvalidInput(format!(
                    "preparation {} of run '{run_name}' is running; it finishes first",
                    revision.name()
                )));
            }
            records.push(self.catalog().preparation(revision.id).await?);
        }
        Ok(records)
    }

    /// The paths run removal never touches: every library frame recorded in
    /// a registered location that overlaps one of the folders, each original
    /// source and each Direct-source path. Each is in the form its parent
    /// resolves to ([`entry_place`]), and folders and locations overlap by
    /// where they resolve, so a folder or location reached through a
    /// symlinked parent is still compared where it is (PREP-FR-07).
    async fn protected_paths(
        &self,
        folders: &[FolderPlan],
        preparations: &[PreparationRecord],
    ) -> Result<HashSet<PathBuf>, LibraryError> {
        let mut named = Vec::new();
        for entry in preparations.iter().flat_map(|record| &record.entries) {
            if entry.kind == PreparedEntryKind::DirectSource {
                named.extend(entry.path.to_path_buf().ok());
            }
            named.extend(entry.source.as_ref().and_then(|source| source.to_path_buf().ok()));
        }
        let places: Vec<PathBuf> = folders.iter().map(|folder| folder.path.clone()).collect();
        let roots: Vec<(Uuid, PathBuf)> = self
            .catalog()
            .list_locations()
            .await?
            .into_iter()
            .filter_map(|location| Some((location.id, location.path.to_path_buf().ok()?)))
            .collect();
        let (mut protected, overlapping) = blocking(move || {
            let places: Vec<PathBuf> = places.iter().map(|place| resolved(place)).collect();
            let overlapping: Vec<(Uuid, PathBuf)> = roots
                .into_iter()
                .map(|(id, root)| (id, resolved(&root)))
                .filter(|(_, root)| {
                    places.iter().any(|place| place.starts_with(root) || root.starts_with(place))
                })
                .collect();
            let protected: HashSet<PathBuf> = named.iter().map(|path| entry_place(path)).collect();
            Ok((protected, overlapping))
        })
        .await?;
        for (id, root) in overlapping {
            for asset in self.catalog().location_assets(id).await? {
                protected
                    .extend(asset.relative_path.relative_path().ok().map(|rel| root.join(rel)));
            }
        }
        Ok(protected)
    }

    async fn record_review(
        &self,
        request: &CleanupRequest,
        run_name: String,
        folders: Vec<(FolderPlan, TrashSupport)>,
        assessed: Vec<Assessed>,
        results_folder: Option<NativePath>,
        ticked: bool,
    ) -> Result<CleanupReview, LibraryError> {
        let kind = request.kind();
        let view_id = request.view_id();
        let excluded = match request {
            CleanupRequest::CleanUp { selection, .. } => selection.excluded_roles.as_slice(),
            CleanupRequest::EmptyTrash { .. } => &[],
        };
        let (folder_views, folder_drafts, mut staying_items) =
            plan_folders(kind, &folders, &assessed);
        let (groups, item_drafts) =
            plan_groups(kind, excluded, &folders, assessed, &mut staying_items);
        let moves: u32 = groups.iter().map(|group| group.moves).sum();
        let moves_bytes = groups.iter().map(|group| group.estimated_bytes).sum();
        let statement = match kind {
            CleanupKind::EmptyTrash => EMPTY_TRASH_STATEMENT,
            CleanupKind::CleanUp => CLEAN_UP_STATEMENT,
        };
        let records = kind == CleanupKind::EmptyTrash || moves > 0;
        let id = if records {
            let draft = RunCleanupDraft {
                kind,
                view_id,
                results_ticked: ticked,
                items: item_drafts,
                folders: folder_drafts,
            };
            Some(self.catalog().record_run_cleanup(&draft).await?.id)
        } else {
            None
        };
        Ok(CleanupReview {
            id,
            kind,
            view_id,
            run_name,
            groups,
            folders: folder_views,
            staying: staying_items,
            moves,
            moves_bytes,
            results_folder,
            results_ticked: ticked,
            statement: statement.into(),
        })
    }

    /// Move each Empty Trash folder that holds nothing but empty folders to
    /// the OS Trash, recording the intent before each move.
    async fn retire_folders(&self, id: Uuid, trash: &Arc<dyn OsTrash>) -> Result<(), LibraryError> {
        let record = self.catalog().run_cleanup(id).await?;
        let named = self.named_paths(&record).await?;
        for folder in record.folders.iter().filter(|folder| folder.phase != ItemPhase::Settled) {
            let (Ok(path), Some(identity)) = (folder.path.to_path_buf(), folder.identity.clone())
            else {
                let reason = ItemReason::new(
                    ReasonCode::SourceUnavailable,
                    "the folder's reviewed path or identity cannot be read",
                );
                self.catalog()
                    .advance_cleanup_folder(id, folder.n, Some(ItemOutcome::Blocked), Some(&reason))
                    .await?;
                continue;
            };
            let checker = Arc::clone(trash);
            let (check_path, check_identity, check_named) =
                (path.clone(), identity.clone(), named.clone());
            let ready = blocking(move || {
                Ok(folder_ready(checker.as_ref(), &check_path, &check_identity, &check_named))
            })
            .await?;
            if let Err(stop) = ready {
                let (outcome, reason) = match (folder.phase, stop) {
                    // The move was requested before an interruption and the
                    // folder is no longer in place: its fate is unproven.
                    (ItemPhase::Retiring, FolderStop::Gone(_)) => (
                        ItemOutcome::Uncertain,
                        Some(ItemReason::new(
                            ReasonCode::Interrupted,
                            format!(
                                "the move of {} to the OS Trash was requested before an \
                                 interruption and the folder is no longer in place; check the \
                                 OS Trash",
                                path.display()
                            ),
                        )),
                    ),
                    (_, FolderStop::Gone(reason) | FolderStop::Kept(Some(reason))) => {
                        (ItemOutcome::Blocked, Some(reason))
                    }
                    (_, FolderStop::Kept(None)) => (ItemOutcome::Blocked, None),
                };
                self.catalog()
                    .advance_cleanup_folder(id, folder.n, Some(outcome), reason.as_ref())
                    .await?;
                continue;
            }
            if folder.phase == ItemPhase::Pending {
                self.catalog().advance_cleanup_folder(id, folder.n, None, None).await?;
            }
            let mover = Arc::clone(trash);
            let (outcome, reason) =
                blocking(move || Ok(move_folder(mover.as_ref(), &path, &identity))).await?;
            self.catalog()
                .advance_cleanup_folder(id, folder.n, Some(outcome), reason.as_ref())
                .await?;
        }
        Ok(())
    }

    /// The paths a review or its execution already names as staying.
    async fn named_paths(
        &self,
        record: &RunCleanupRecord,
    ) -> Result<HashSet<PathBuf>, LibraryError> {
        let operation = match record.operation_id {
            Some(operation) => Some(self.catalog().storage_operation(operation).await?),
            None => None,
        };
        let not_moved: HashSet<u32> = operation
            .iter()
            .flat_map(|operation| &operation.items)
            .filter(|item| item.outcome != Some(ItemOutcome::Trashed))
            .map(|item| item.seq)
            .collect();
        Ok(record
            .items
            .iter()
            .filter(|item| {
                item.staying.is_some()
                    || item.storage_seq.is_some_and(|seq| not_moved.contains(&seq))
            })
            .filter_map(|item| item.path.to_path_buf().ok())
            .collect())
    }
}

/// Each folder's Trash support with its moving and staying counts; for
/// Empty Trash also its record, and its own staying item when it stays as a
/// whole.
fn plan_folders(
    kind: CleanupKind,
    folders: &[(FolderPlan, TrashSupport)],
    assessed: &[Assessed],
) -> (Vec<CleanupFolder>, Vec<CleanupFolderDraft>, Vec<StayingItem>) {
    let mut views = Vec::with_capacity(folders.len());
    let mut drafts = Vec::new();
    let mut staying_items = Vec::new();
    for (index, (folder, support)) in folders.iter().enumerate() {
        let in_folder = || assessed.iter().filter(move |item| item.candidate.folder == index);
        let moves = count(in_folder().filter(|item| item.state == CleanupItemState::Moves));
        let stays =
            count(in_folder().filter(|item| matches!(item.state, CleanupItemState::Stays { .. })));
        let path = NativePath::from_path(&folder.path);
        let reason = folder_staying(folder, support);
        if kind == CleanupKind::EmptyTrash {
            if let Some(reason) = &reason {
                staying_items.push(staying(&path, true, reason.clone()));
            }
            drafts.push(CleanupFolderDraft {
                path: path.clone(),
                role: folder.role,
                identity: folder.identity.clone().ok(),
                staying: reason.clone(),
            });
        }
        views.push(CleanupFolder {
            path,
            role: folder.role,
            support: support.clone(),
            moves,
            stays,
            folder_moves: kind == CleanupKind::EmptyTrash && reason.is_none(),
        });
    }
    (views, drafts, staying_items)
}

/// The review's groups in [`ROLES`] order and the item records. Each item
/// that stays is named in `staying_items` unless a folder staying as a whole
/// already names it.
fn plan_groups(
    kind: CleanupKind,
    excluded: &[CleanupRole],
    folders: &[(FolderPlan, TrashSupport)],
    assessed: Vec<Assessed>,
    staying_items: &mut Vec<StayingItem>,
) -> (Vec<CleanupGroup>, Vec<CleanupItemDraft>) {
    let covered = |path: &Path| {
        kind == CleanupKind::EmptyTrash
            && folders.iter().any(|(folder, support)| {
                folder_staying(folder, support).is_some() && path.starts_with(&folder.path)
            })
    };
    let mut drafts = Vec::new();
    let mut groups: Vec<CleanupGroup> = ROLES
        .into_iter()
        .map(|role| CleanupGroup {
            role,
            selected: !excluded.contains(&role),
            count: 0,
            moves: 0,
            stays: 0,
            estimated_bytes: 0,
            reclaim_guaranteed: role.reclaim_guaranteed(),
            items: Vec::new(),
        })
        .collect();
    for Assessed { candidate, state, draft, relies_on } in assessed {
        let role = candidate.role;
        let group = &mut groups[group_index(role)];
        let path = NativePath::from_path(&candidate.path);
        group.count += 1;
        let disposition = match (&state, draft) {
            (CleanupItemState::Moves, Some(draft)) => {
                group.moves += 1;
                group.estimated_bytes += candidate.size_bytes;
                Some(CleanupDisposition::Moves(Box::new(draft)))
            }
            (CleanupItemState::Stays { reason }, _) => {
                group.stays += 1;
                if !covered(&candidate.path) {
                    staying_items.push(staying(&path, false, reason.clone()));
                }
                Some(CleanupDisposition::Stays(reason.clone()))
            }
            _ => None,
        };
        if let Some(disposition) = disposition {
            drafts.push(CleanupItemDraft {
                path: path.clone(),
                role,
                entry: candidate.entry,
                disposition,
            });
        }
        group.items.push(CleanupItem {
            path,
            role,
            input: candidate.input,
            entry: candidate.entry,
            preparation_revision: candidate.revision,
            source: candidate.source.as_deref().map(NativePath::from_path),
            estimated_bytes: candidate.size_bytes,
            reclaim_guaranteed: role.reclaim_guaranteed(),
            relies_on: relies_on.as_deref().map(NativePath::from_path),
            state,
        });
    }
    groups.retain(|group| group.count > 0);
    (groups, drafts)
}

/// Why an Empty Trash folder does not move now.
enum FolderStop {
    /// It is missing or not the reviewed folder.
    Gone(ItemReason),
    /// Entries remain in it; the reason names any not already named.
    Kept(Option<ItemReason>),
}

/// Whether the reviewed folder is in place, holds nothing but empty folders
/// and can go to the OS Trash.
fn folder_ready(
    trash: &dyn OsTrash,
    path: &Path,
    identity: &FileIdentity,
    named: &HashSet<PathBuf>,
) -> Result<(), FolderStop> {
    match inventory::observe_folder_identity(path) {
        Ok(observed) if same_identity(&observed, identity) => {}
        Ok(_) => {
            return Err(FolderStop::Gone(ItemReason::new(
                ReasonCode::SourceDrift,
                format!("{} is not the reviewed folder", path.display()),
            )));
        }
        Err(error) => {
            return Err(FolderStop::Gone(ItemReason::new(
                ReasonCode::SourceUnavailable,
                format!("{}: {error}", path.display()),
            )));
        }
    }
    if let TrashSupport::Unsupported { reason, detail } = trash.support(path, 0) {
        return Err(FolderStop::Kept(Some(ItemReason::new(
            ReasonCode::TrashUnsupported,
            format!("{detail} ({reason:?}); {} stays in place", path.display()),
        ))));
    }
    let remaining = walk(path).map_err(|error| {
        FolderStop::Kept(Some(ItemReason::new(
            ReasonCode::SourceUnavailable,
            format!("{} cannot be read: {error}", path.display()),
        )))
    })?;
    if remaining.is_empty() {
        return Ok(());
    }
    let unnamed = remaining.iter().filter(|entry| !named.contains(*entry)).count();
    Err(FolderStop::Kept((unnamed > 0).then(|| {
        ItemReason::new(
            ReasonCode::SourceDrift,
            format!(
                "{} holds {unnamed} entr{} Empty Trash did not review; the folder and \
                 {} stay in place",
                path.display(),
                if unnamed == 1 { "y" } else { "ies" },
                if unnamed == 1 { "it" } else { "them" },
            ),
        )
    })))
}

/// Ask the OS Trash to move a reviewed folder and decide from where it is
/// afterwards.
fn move_folder(
    trash: &dyn OsTrash,
    path: &Path,
    identity: &FileIdentity,
) -> (ItemOutcome, Option<ItemReason>) {
    let in_place = || {
        inventory::observe_folder_identity(path)
            .is_ok_and(|observed| same_identity(&observed, identity))
    };
    let refused = trash.move_to_trash(path).err();
    let gone = matches!(
        fs::symlink_metadata(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    );
    let failed = |detail: String| Some(ItemReason::new(ReasonCode::TrashFailed, detail));
    match (refused, gone) {
        (None, true) => (ItemOutcome::Trashed, None),
        (Some(refusal), false) if in_place() => {
            (ItemOutcome::Blocked, failed(format!("the OS Trash refused: {refusal}")))
        }
        (None, false) if in_place() => (
            ItemOutcome::Blocked,
            failed("the OS Trash reported the move but the folder is still in place".into()),
        ),
        (Some(refusal), _) => (
            ItemOutcome::Uncertain,
            failed(format!(
                "the OS Trash refused ({refusal}) but the folder is no longer in place"
            )),
        ),
        (None, false) => (
            ItemOutcome::Uncertain,
            failed("another entry appeared at the folder's path after the move".into()),
        ),
    }
}

/// Why a folder stays as a whole: it is not the folder preparation wrote, or
/// its location has no OS Trash.
fn folder_staying(folder: &FolderPlan, support: &TrashSupport) -> Option<ItemReason> {
    if let Err(reason) = &folder.identity {
        return Some(reason.clone());
    }
    match support {
        TrashSupport::Supported => None,
        TrashSupport::Unsupported { reason, detail } => Some(ItemReason::new(
            ReasonCode::TrashUnsupported,
            format!(
                "{detail} ({reason:?}); {} and everything in it stay in place: Keep files or \
                 Reveal location",
                folder.path.display()
            ),
        )),
    }
}

/// Why a Clean up lists nothing (PREP-AC-20): the preparation created no
/// entries, no revision is replaced yet, or every entry already went.
fn nothing_to_clean(view: &View, preparations: &[PreparationRecord]) -> &'static str {
    let created = preparations
        .iter()
        .flat_map(|record| &record.entries)
        .any(|entry| entry.kind.created() && entry.entry_identity.is_some());
    if !created {
        NOTHING_CREATED_STATEMENT
    } else if view.completion == RunCompletion::Complete {
        NOTHING_LEFT_STATEMENT
    } else {
        NOTHING_REPLACED_STATEMENT
    }
}

/// The revisions Clean up covers: every revision of a Complete run; before
/// Complete only the revisions a later Prepared or Partial one replaced
/// (STO-FR-10).
fn clean_up_scope(view: &View, preparations: &[PreparationRecord]) -> Vec<PreparationRecord> {
    if view.completion == RunCompletion::Complete {
        return preparations.to_vec();
    }
    let current = preparations
        .iter()
        .filter(|record| {
            matches!(record.revision.state, PreparationState::Prepared | PreparationState::Partial)
        })
        .map(|record| record.revision.n)
        .max();
    current.map_or_else(Vec::new, |current| {
        preparations.iter().filter(|record| record.revision.n < current).cloned().collect()
    })
}

const fn role_of(kind: PreparedEntryKind) -> Option<CleanupRole> {
    match kind {
        PreparedEntryKind::Symlink => Some(CleanupRole::Symlink),
        PreparedEntryKind::Hardlink => Some(CleanupRole::Hardlink),
        PreparedEntryKind::Copy => Some(CleanupRole::Copy),
        PreparedEntryKind::Clone => Some(CleanupRole::Clone),
        PreparedEntryKind::DirectSource => None,
    }
}

/// One folder a review covers, by its chosen path. A folder recorded with
/// the form it resolved to when Prepare made it must still resolve there,
/// so a symlinked parent retargeted since never makes run removal act on
/// another folder (PREP-FR-07); such a folder stays as a whole.
fn folder_plan(
    path: PathBuf,
    canonical: Option<&NativePath>,
    role: CleanupFolderRole,
) -> FolderPlan {
    let identity = match resolves_elsewhere(&path, canonical) {
        Some(reason) => Err(reason),
        None => inventory::observe_folder_identity(&path).map_err(|error| {
            ItemReason::new(
                ReasonCode::SourceDrift,
                format!("{} is not the folder PlateVault wrote: {error}", path.display()),
            )
        }),
    };
    FolderPlan { path, role, identity }
}

/// Why `path` is no longer the folder Prepare made at `canonical`: it now
/// resolves elsewhere. `None` without a recorded form, or when `path` cannot
/// be resolved (its identity check then names that).
fn resolves_elsewhere(path: &Path, canonical: Option<&NativePath>) -> Option<ItemReason> {
    let made = canonical?.to_path_buf().ok()?;
    let now = fs::canonicalize(path).ok()?;
    (now != made).then(|| {
        ItemReason::new(
            ReasonCode::SourceDrift,
            format!(
                "{} now resolves to {}, not to {} where Prepare made it; it stays in place",
                path.display(),
                now.display(),
                made.display()
            ),
        )
    })
}

/// The recorded resolved form of revision `n`'s folder.
fn canonical_of(prepared: &[(u32, RecordedFolder)], n: u32) -> Option<&NativePath> {
    prepared
        .iter()
        .find(|(number, _)| *number == n)
        .and_then(|(_, folder)| folder.canonical.as_ref())
}

/// Clean up: only the entries the revisions created and wrote, not removed
/// by an earlier Clean up; originals and Direct-source paths never.
fn clean_up_candidates(
    scope: &[PreparationRecord],
    recorded: &[(u32, RecordedFolder)],
    removed: &HashSet<PreparedEntryKey>,
    selection: &CleanupSelection,
) -> (Vec<FolderPlan>, Vec<Candidate>) {
    let mut folders = Vec::new();
    let mut candidates = Vec::new();
    for record in scope {
        let Ok(path) = record.revision.folder.to_path_buf() else {
            continue;
        };
        let folder = folders.len();
        let n = record.revision.n;
        folders.push(folder_plan(
            path,
            canonical_of(recorded, n),
            CleanupFolderRole::Prepared { preparation_revision: n },
        ));
        for entry in &record.entries {
            let key = PreparedEntryKey { preparation_id: record.revision.id, seq: entry.seq };
            let (Some(role), Some(written), Ok(path)) =
                (role_of(entry.kind), &entry.entry_identity, entry.path.to_path_buf())
            else {
                continue;
            };
            if removed.contains(&key) {
                continue;
            }
            candidates.push(Candidate {
                path,
                role,
                input: Some(entry.input),
                entry: Some(key),
                revision: Some(record.revision.n),
                source: source_of(entry.source_evidence.as_ref(), entry.source.as_ref()),
                written: Some(written.clone()),
                source_sha256: entry.source_sha256.clone(),
                size_bytes: entry.size_bytes,
                selected: !selection.excluded_roles.contains(&role)
                    && !selection.excluded_entries.contains(&key),
                folder,
            });
        }
    }
    (folders, candidates)
}

fn source_of(evidence: Option<&EntryEvidence>, source: Option<&NativePath>) -> Option<PathBuf> {
    evidence.map(|evidence| &evidence.path).or(source).and_then(|path| path.to_path_buf().ok())
}

/// Empty Trash: every entry below each prepared folder and, when ticked, the
/// Results folder. A recorded prepared entry keeps its retained-original
/// rule; anything else in a prepared folder is an unprepared entry. Folders
/// come child before parent, the order they go in. For the last panel run of
/// a run group the group's folders follow: each group folder lists nothing
/// and goes once its `Panel N/` folders are gone, and `Assembled/` joins the
/// ticked Results unless another run uses one of the group's accepted
/// Results (D-W75, PREP-FR-07).
fn empty_trash_candidates(
    preparations: &[PreparationRecord],
    recorded: &RunFolders,
    ticked: bool,
) -> Result<(Vec<FolderPlan>, Vec<Candidate>), LibraryError> {
    let mut folders = Vec::new();
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for record in preparations {
        let Some(path) = existing(&record.revision.folder) else {
            continue;
        };
        let folder = folders.len();
        let n = record.revision.n;
        let plan = folder_plan(
            path,
            canonical_of(&recorded.prepared, n),
            CleanupFolderRole::Prepared { preparation_revision: n },
        );
        let entries: HashMap<PathBuf, _> = record
            .entries
            .iter()
            .filter_map(|entry| entry.path.to_path_buf().ok().map(|path| (path, entry)))
            .collect();
        let walked = if plan.identity.is_ok() { walk(&plan.path)? } else { Vec::new() };
        folders.push(plan);
        for path in walked {
            if !seen.insert(path.clone()) {
                continue;
            }
            let size_bytes = fs::symlink_metadata(&path).map_or(0, |metadata| metadata.len());
            let prepared = entries.get(&path).and_then(|entry| {
                Some((role_of(entry.kind)?, entry.entry_identity.clone()?, *entry))
            });
            candidates.push(match prepared {
                Some((role, written, entry)) => Candidate {
                    path,
                    role,
                    input: Some(entry.input),
                    entry: Some(PreparedEntryKey {
                        preparation_id: record.revision.id,
                        seq: entry.seq,
                    }),
                    revision: Some(record.revision.n),
                    source: source_of(entry.source_evidence.as_ref(), entry.source.as_ref()),
                    written: Some(written),
                    source_sha256: entry.source_sha256.clone(),
                    size_bytes: entry.size_bytes,
                    selected: true,
                    folder,
                },
                None => plain(
                    path,
                    CleanupRole::Unprepared,
                    Some(record.revision.n),
                    size_bytes,
                    folder,
                ),
            });
        }
    }
    if ticked {
        if let Some(results) = &recorded.results {
            push_results(
                results,
                CleanupFolderRole::Results,
                &mut folders,
                &mut candidates,
                &mut seen,
            )?;
        }
    }
    let Some(group) = &recorded.group else {
        return Ok((folders, candidates));
    };
    for (n, recorded) in &group.folders {
        if let Some(path) = existing(&recorded.path) {
            let role = CleanupFolderRole::Group { group_preparation: *n };
            folders.push(folder_plan(path, recorded.canonical.as_ref(), role));
        }
    }
    match (&group.assembled, group.assembled_users.as_slice()) {
        (Some(assembled), []) if ticked => push_results(
            assembled,
            CleanupFolderRole::Assembled,
            &mut folders,
            &mut candidates,
            &mut seen,
        )?,
        (Some(assembled), users) if ticked => {
            if let Some(path) = existing(&assembled.path) {
                let named: Vec<String> = users.iter().map(ToString::to_string).collect();
                let reason = ItemReason::new(
                    ReasonCode::Protected,
                    format!(
                        "an accepted Result in {} is an input to run {}; it stays in place",
                        path.display(),
                        named.join(", ")
                    ),
                );
                folders.push(FolderPlan {
                    path,
                    role: CleanupFolderRole::Assembled,
                    identity: Err(reason),
                });
            }
        }
        _ => {}
    }
    Ok((folders, candidates))
}

/// A ticked Results folder with every entry below it as a Result item.
fn push_results(
    recorded: &RecordedFolder,
    role: CleanupFolderRole,
    folders: &mut Vec<FolderPlan>,
    candidates: &mut Vec<Candidate>,
    seen: &mut HashSet<PathBuf>,
) -> Result<(), LibraryError> {
    let Some(path) = existing(&recorded.path) else {
        return Ok(());
    };
    let folder = folders.len();
    let plan = folder_plan(path, recorded.canonical.as_ref(), role);
    let walked = if plan.identity.is_ok() { walk(&plan.path)? } else { Vec::new() };
    folders.push(plan);
    for path in walked {
        if seen.insert(path.clone()) {
            let size_bytes = fs::symlink_metadata(&path).map_or(0, |metadata| metadata.len());
            candidates.push(plain(path, CleanupRole::Result, None, size_bytes, folder));
        }
    }
    Ok(())
}

const fn plain(
    path: PathBuf,
    role: CleanupRole,
    revision: Option<u32>,
    size_bytes: u64,
    folder: usize,
) -> Candidate {
    Candidate {
        path,
        role,
        input: None,
        entry: None,
        revision,
        source: None,
        written: None,
        source_sha256: None,
        size_bytes,
        selected: true,
        folder,
    }
}

/// The recorded path when an entry is there, without following a link.
fn existing(path: &NativePath) -> Option<PathBuf> {
    let path = path.to_path_buf().ok()?;
    fs::symlink_metadata(&path).is_ok().then_some(path)
}

/// Where an entry is, without following it: its parent folder as it
/// resolves now with the entry's own name, so a link is never resolved to
/// its target.
fn entry_place(path: &Path) -> PathBuf {
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => resolved(parent).join(name),
        _ => path.to_path_buf(),
    }
}

/// Every entry below `folder` that is not itself a folder, without following
/// links: a link to a folder is an entry of its own.
fn walk(folder: &Path) -> Result<Vec<PathBuf>, LibraryError> {
    let mut entries = Vec::new();
    let mut pending = vec![folder.to_path_buf()];
    while let Some(current) = pending.pop() {
        let listing =
            fs::read_dir(&current).map_err(|error| LibraryError::from_io(&current, &error))?;
        for entry in listing {
            let path = entry.map_err(|error| LibraryError::from_io(&current, &error))?.path();
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| LibraryError::from_io(&path, &error))?;
            if metadata.is_dir() && !fs_pathsafe::is_link_or_junction_metadata(&metadata) {
                pending.push(path);
            } else {
                entries.push(path);
            }
        }
    }
    entries.sort();
    Ok(entries)
}

fn stays(code: ReasonCode, detail: impl Into<String>) -> CleanupItemState {
    CleanupItemState::Stays { reason: ItemReason::new(code, detail) }
}

/// Decide one item: the evidence it moves with, or why it stays.
fn assess(
    candidate: Candidate,
    trash: &dyn OsTrash,
    protected: &HashSet<PathBuf>,
    folder_staying: Option<ItemReason>,
) -> Assessed {
    let relies_on =
        candidate.role.needs_retained_original().then(|| candidate.source.clone()).flatten();
    let decided = |state: CleanupItemState, candidate: Candidate| Assessed {
        candidate,
        state,
        draft: None,
        relies_on: relies_on.clone(),
    };
    if !candidate.selected {
        return decided(CleanupItemState::NotSelected, candidate);
    }
    let path = candidate.path.display().to_string();
    if protected.contains(&entry_place(&candidate.path)) {
        let state = stays(
            ReasonCode::Protected,
            format!(
                "{path} is a library frame or an original source; run removal never touches it"
            ),
        );
        return decided(state, candidate);
    }
    if let Some(reason) = folder_staying {
        return decided(CleanupItemState::Stays { reason }, candidate);
    }
    if let TrashSupport::Unsupported { reason, detail } =
        trash.support(&candidate.path, candidate.size_bytes)
    {
        let state = stays(
            ReasonCode::TrashUnsupported,
            format!("{detail} ({reason:?}); {path} stays in place: Keep files or Reveal location"),
        );
        return decided(state, candidate);
    }
    let evidence = match &candidate.written {
        Some(written) => verify_source(written).map(|()| written.clone()),
        None => observe_entry(&candidate.path)
            .map_err(|error| ItemReason::new(ReasonCode::SourceUnavailable, error.to_string())),
    };
    let evidence = match evidence {
        Ok(evidence) => evidence,
        Err(reason) => return decided(CleanupItemState::Stays { reason }, candidate),
    };
    let kept = if candidate.role.needs_retained_original() {
        match retained_original(&candidate) {
            Ok(kept) => vec![kept],
            Err(reason) => return decided(CleanupItemState::Stays { reason }, candidate),
        }
    } else {
        Vec::new()
    };
    Assessed {
        candidate,
        state: CleanupItemState::Moves,
        draft: Some(StorageItemDraft { source: evidence, relied_on: kept, destination: None }),
        relies_on,
    }
}

/// The retained original a hardlink, clone or copy relies on: a regular file
/// at its recorded source path that still holds the bytes it was prepared
/// from. Without it the entry may hold the last copy (STO-AC-04).
fn retained_original(candidate: &Candidate) -> Result<KeptCopy, ItemReason> {
    let unproven = |detail: String| {
        ItemReason::new(
            ReasonCode::KeptCopyUnproven,
            format!(
                "insufficient retained-original proof: {detail}; {} may hold the last copy and \
                 stays in place",
                candidate.path.display()
            ),
        )
    };
    let (Some(source), Some(sha256)) = (&candidate.source, &candidate.source_sha256) else {
        return Err(unproven("no original source is recorded".into()));
    };
    match observe_entry(source) {
        Ok(EntryEvidence { path, kind: EntryKind::File, fingerprint, sha256: Some(digest) })
            if digest == *sha256 =>
        {
            Ok(KeptCopy { path, fingerprint, sha256: digest })
        }
        Ok(_) => Err(unproven(format!(
            "{} no longer holds the bytes it was prepared from",
            source.display()
        ))),
        Err(error) => Err(unproven(format!("{}: {error}", source.display()))),
    }
}

fn count<'a>(items: impl Iterator<Item = &'a Assessed>) -> u32 {
    u32::try_from(items.count()).unwrap_or(u32::MAX)
}

fn staying(path: &NativePath, folder: bool, reason: ItemReason) -> StayingItem {
    StayingItem { path: path.clone(), folder, reason }
}

fn run_name(record: &ViewRecord) -> String {
    record
        .revision
        .as_ref()
        .map(|revision| revision.name.clone())
        .or_else(|| record.draft.as_ref().map(|draft| draft.name.clone()))
        .unwrap_or_default()
}

const fn kind_name(kind: CleanupKind) -> &'static str {
    match kind {
        CleanupKind::CleanUp => "Clean up",
        CleanupKind::EmptyTrash => "Empty Trash",
    }
}

fn require_kind(record: &RunCleanupRecord, kind: CleanupKind) -> Result<(), LibraryError> {
    if record.kind == kind {
        Ok(())
    } else {
        Err(LibraryError::InvalidInput(format!(
            "review {} is a {}, not a {}",
            record.id,
            kind_name(record.kind),
            kind_name(kind)
        )))
    }
}

/// The exact complete or partial summary (STO-FR-05): what moved, and every
/// item left behind with its path and reason.
fn summary(
    record: &RunCleanupRecord,
    moved: &[NativePath],
    left: &[StayingItem],
    run_removed: bool,
) -> String {
    let what = kind_name(record.kind);
    let mut text = match record.state {
        CleanupState::Reviewed => {
            format!("{what} of '{}' has not started; nothing moved.", record.run_name)
        }
        CleanupState::Running => format!(
            "{what} of '{}' is running: {} moved to the OS Trash so far.",
            record.run_name,
            moved.len()
        ),
        CleanupState::Settled if left.is_empty() => format!(
            "{what} of '{}' moved {} item(s) to the OS Trash; nothing stays behind.",
            record.run_name,
            moved.len()
        ),
        CleanupState::Settled => format!(
            "{what} of '{}' moved {} of {} item(s) to the OS Trash; {} stay in place.",
            record.run_name,
            moved.len(),
            moved.len() + left.len(),
            left.len()
        ),
    };
    for item in left {
        let _ = write!(text, " {}: {}.", item.path.display(), item.reason.detail);
    }
    if run_removed {
        text.push_str(" The run record is removed.");
    }
    text.push_str(" Nothing was permanently deleted.");
    text
}

/// PV-STO's lifecycle guard: a running Clean up or Empty Trash is a storage
/// mutation affecting the run, so it blocks Mark Complete and Move run to
/// Trash (RES-FR-07, RES-FR-10).
struct CleanupGuard {
    library: Weak<Library>,
}

impl RunOperationGuard for CleanupGuard {
    fn blockers<'a>(&'a self, view: &'a View) -> BlockersFuture<'a> {
        Box::pin(async move {
            let library = self
                .library
                .upgrade()
                .ok_or_else(|| LibraryError::PersistenceFailure("the library is closed".into()))?;
            Ok(library
                .catalog()
                .running_run_cleanup(view.id)
                .await?
                .map(|(id, kind)| LifecycleBlocker::RunningOperation {
                    operation_id: id,
                    operation: RunOperationKind::StorageMutation,
                    name: kind_name(kind).into(),
                })
                .into_iter()
                .collect())
        })
    }
}

/// Register PV-STO's Clean up and Empty Trash lifecycle guard.
pub async fn register(library: &Arc<Library>) {
    library.register_run_guard(Arc::new(CleanupGuard { library: Arc::downgrade(library) })).await;
}
