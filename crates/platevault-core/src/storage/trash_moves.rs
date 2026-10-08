// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The three OS Trash moves of a Done Project's Done / Archive sheet (spec
//! 071 STO-FR-14/15/16, STO-AC-18/19/21/23; spec 065 PRJ-AC-17; spec 064
//! LIB-FR-18, LIB-AC-19; D19, D-W43, D-W70, D-W74).
//!
//! Each move executes one approval of one offer at the sheet's Project
//! revision. It recomputes the sheet, so every offer refusal is re-checked
//! now and an item the offer no longer lists as approved is refused as
//! stale; then the custody checks refuse what cannot go: a rejected frame
//! copy outside a Captures location, an Offline or unreadable location, a
//! location with no OS Trash, a copy without a recorded digest. The rest
//! runs through the storage journal, which re-verifies each copy (and the
//! kept copy a duplicate relies on) immediately before its move and moves it
//! to the OS Trash only. Every copy of a rejected frame is re-verified before
//! the first of them moves, so a frame moves whole or not at all. Moved
//! library copies are recorded Trashed through their trash episode; a moved
//! Results file reads Missing. Nothing runs while an Archive transfer of the
//! Project is running or was left interrupted.

use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Arc;

use persistence_library::{TrashMoveItem, TrashMoveRecord, TrashTarget, TrashedFrame};
use uuid::Uuid;

use super::archive::{same_observation, CustodyClaim};
use crate::custody::trash::OsTrash;
use crate::custody::{observe_entry, verify_source};
use crate::library::{blocking, Library};
use crate::{
    inventory, ApprovedFrame, Availability, DoneArchiveSheet, DuplicatesApproval, EntryEvidence,
    EntryKind, FrameCopy, IntermediatesApproval, ItemChange, ItemOutcome, ItemPhase, ItemReason,
    KeptCopy, LibraryError, Location, LocationLifecycle, LocationRole, MoveRefusal, MovedItem,
    NativePath, ObservationFingerprint, OfferRefusal, ReasonCode, RefusedCopy, RefusedFrame,
    RefusedIntermediate, RefusedMove, RejectedFramesApproval, StorageItemDraft, StorageOperation,
    StorageOperationKind, StorageOperationState, TrashMoveSummary, TrashOffer, TrashSupport,
    UncertainMove,
};

/// The detail prefix of a copy refused because another copy of its frame was.
const SIBLING: &str = "another copy of this frame was refused: ";

/// One copy an approved item moves.
struct Move {
    target: TrashTarget,
    evidence: EntryEvidence,
    relied_on: Vec<KeptCopy>,
}

/// One approved item that passed the offer and custody checks.
struct Candidate {
    id: Uuid,
    moves: Vec<Move>,
    complete_view_ids: Vec<Uuid>,
}

impl Library {
    /// Execute "Move N rejected frames to Trash (size)" for the frames the
    /// user approved (STO-FR-14/15). Every copy of a frame moves to the OS
    /// Trash, or none does; moved frames are recorded Trashed (LIB-FR-18).
    /// An unsettled earlier move of this offer is resumed instead, and no
    /// new approval applies.
    ///
    /// # Errors
    /// `InvalidInput` while an Archive transfer or another move of the
    /// Project runs, or for a Project that is not Done; `Conflict` when the
    /// Project changed since the approved sheet; journal and catalog failures.
    pub async fn trash_rejected_execute(
        &self,
        project_id: Uuid,
        approval: &RejectedFramesApproval,
        trash: Arc<dyn OsTrash>,
    ) -> Result<TrashMoveSummary, LibraryError> {
        let offer = TrashOffer::RejectedFrames;
        let _claim = self.custody_gate(project_id).await?;
        if let Some(summary) = self.resume_move(project_id, offer, &trash).await? {
            return Ok(summary);
        }
        let sheet = self.approved_sheet(project_id, approval.project_revision, &trash).await?;
        let context = Context::new(self).await?;
        let mut candidates = Vec::new();
        let mut refused = Vec::new();
        for approved in &approval.frames {
            match self.rejected_frame(&sheet, approved, &context, trash.as_ref()).await? {
                Ok(candidate) => candidates.push(candidate),
                Err(refusal) => refused.push(refusal),
            }
        }
        self.run_move(project_id, offer, sheet.project_revision, candidates, refused, &trash).await
    }

    /// Execute "Move N processing intermediates to Trash (size)" for the
    /// items the user approved (STO-FR-16): each recognized intermediate,
    /// and each adopted master's generated source after its kept library
    /// copy re-verifies.
    ///
    /// # Errors
    /// As [`Self::trash_rejected_execute`].
    pub async fn trash_intermediates_execute(
        &self,
        project_id: Uuid,
        approval: &IntermediatesApproval,
        trash: Arc<dyn OsTrash>,
    ) -> Result<TrashMoveSummary, LibraryError> {
        let offer = TrashOffer::Intermediates;
        let _claim = self.custody_gate(project_id).await?;
        if let Some(summary) = self.resume_move(project_id, offer, &trash).await? {
            return Ok(summary);
        }
        let sheet = self.approved_sheet(project_id, approval.project_revision, &trash).await?;
        let context = Context::new(self).await?;
        let mut candidates = Vec::new();
        let mut refused = Vec::new();
        for approved in &approval.items {
            match self.intermediate(&sheet, *approved, &context, trash.as_ref()).await? {
                Ok(candidate) => candidates.push(candidate),
                Err(refusal) => refused.push(refusal),
            }
        }
        self.run_move(project_id, offer, sheet.project_revision, candidates, refused, &trash).await
    }

    /// Execute "Move N duplicate copies to Trash (size)" for the copies the
    /// user approved (STO-FR-16, D-W74): each moves on its own after its
    /// rehash and its kept copy's re-verification both match. Its frame
    /// keeps its record, quality and memberships, one copy fewer.
    ///
    /// # Errors
    /// As [`Self::trash_rejected_execute`].
    pub async fn trash_duplicates_execute(
        &self,
        project_id: Uuid,
        approval: &DuplicatesApproval,
        trash: Arc<dyn OsTrash>,
    ) -> Result<TrashMoveSummary, LibraryError> {
        let offer = TrashOffer::DuplicateCopies;
        let _claim = self.custody_gate(project_id).await?;
        if let Some(summary) = self.resume_move(project_id, offer, &trash).await? {
            return Ok(summary);
        }
        let sheet = self.approved_sheet(project_id, approval.project_revision, &trash).await?;
        let context = Context::new(self).await?;
        let mut candidates = Vec::new();
        let mut refused = Vec::new();
        for approved in &approval.copies {
            let found = self
                .duplicate_copy(
                    &sheet,
                    approved.asset_id,
                    approved.kept_asset_id,
                    &context,
                    trash.as_ref(),
                )
                .await?;
            match found {
                Ok(candidate) => candidates.push(candidate),
                Err(refusal) => refused.push(refusal),
            }
        }
        self.run_move(project_id, offer, sheet.project_revision, candidates, refused, &trash).await
    }

    /// Claim the Project's custody and refuse while one of its Archive
    /// transfers is running or was left interrupted.
    async fn custody_gate(&self, project_id: Uuid) -> Result<CustodyClaim, LibraryError> {
        let claim = CustodyClaim::claim(project_id)?;
        if let Some(transfer) = self.catalog().running_archive_transfers(project_id).await?.first()
        {
            return Err(LibraryError::InvalidInput(format!(
                "Archive transfer {transfer} of Project {project_id} is running or was \
                 interrupted; run it until it settles before moving anything to the Trash"
            )));
        }
        Ok(claim)
    }

    /// The sheet now, for an approval given at `approved_revision`.
    async fn approved_sheet(
        &self,
        project_id: Uuid,
        approved_revision: u64,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<DoneArchiveSheet, LibraryError> {
        let sheet = self.done_archive_review(project_id, Arc::clone(trash)).await?;
        if sheet.project_revision != approved_revision {
            return Err(LibraryError::Conflict {
                id: project_id,
                current: sheet.project_revision,
                successors: Vec::new(),
            });
        }
        Ok(sheet)
    }

    async fn resume_move(
        &self,
        project_id: Uuid,
        offer: TrashOffer,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<Option<TrashMoveSummary>, LibraryError> {
        match self.catalog().unsettled_trash_move(project_id, offer).await? {
            Some(op_id) => Ok(Some(self.drive_move(op_id, trash, true).await?)),
            None => Ok(None),
        }
    }

    /// Re-check one approved rejected frame against the sheet now, then
    /// every copy against the custody rules without moving anything.
    async fn rejected_frame(
        &self,
        sheet: &DoneArchiveSheet,
        approved: &ApprovedFrame,
        context: &Context,
        trash: &dyn OsTrash,
    ) -> Result<Result<Candidate, RefusedMove>, LibraryError> {
        let offer = &sheet.rejected_frames;
        if let Some(refused) =
            offer.refused.iter().find(|frame| frame.frame_key == approved.frame_key)
        {
            let paths = context.paths(&refused.copies)?;
            let reasons = offer_reasons(&refused.reasons, &refused.custody);
            return Ok(Err(RefusedMove { id: approved.frame_key, paths, reasons }));
        }
        let Some(frame) = offer.frames.iter().find(|frame| frame.frame_key == approved.frame_key)
        else {
            return Ok(Err(stale(
                approved.frame_key,
                Vec::new(),
                "the rejected-frames offer no longer lists it",
            )));
        };
        let paths = context.paths(&frame.copies)?;
        let listed: BTreeSet<Uuid> = frame.copies.iter().map(|copy| copy.asset_id).collect();
        if listed != approved.copies.iter().copied().collect() {
            return Ok(Err(stale(
                approved.frame_key,
                paths,
                "its copies changed since the sheet listed them",
            )));
        }
        let digest = frame.copies.iter().find_map(|copy| copy.sha256.clone());
        let mut moves = Vec::new();
        let mut reasons = Vec::new();
        for copy in &frame.copies {
            match self.library_copy(copy, digest.as_deref(), true, context, trash).await? {
                Ok(evidence) => moves.push(Move {
                    target: TrashTarget::Asset(copy.asset_id),
                    evidence,
                    relied_on: Vec::new(),
                }),
                Err(reason) => reasons.push(reason),
            }
        }
        if !reasons.is_empty() {
            whole_frame(&mut reasons, frame.copies.len());
            return Ok(Err(RefusedMove { id: approved.frame_key, paths, reasons }));
        }
        let complete_view_ids = self.catalog().complete_runs_holding(&listed).await?;
        Ok(Ok(Candidate { id: approved.frame_key, moves, complete_view_ids }))
    }

    /// Re-check one approved extra copy and the kept copy it relies on.
    async fn duplicate_copy(
        &self,
        sheet: &DoneArchiveSheet,
        asset_id: Uuid,
        kept_asset_id: Uuid,
        context: &Context,
        trash: &dyn OsTrash,
    ) -> Result<Result<Candidate, RefusedMove>, LibraryError> {
        for frame in &sheet.duplicates.frames {
            if let Some(refused) =
                frame.refused.iter().find(|refused| refused.copy.asset_id == asset_id)
            {
                let paths = context.paths(std::slice::from_ref(&refused.copy))?;
                let reasons = offer_reasons(&refused.reasons, &refused.custody);
                return Ok(Err(RefusedMove { id: asset_id, paths, reasons }));
            }
            let Some(copy) = frame.offered.iter().find(|copy| copy.asset_id == asset_id) else {
                continue;
            };
            let paths = context.paths(std::slice::from_ref(copy))?;
            if frame.kept.asset_id != kept_asset_id {
                return Ok(Err(stale(
                    asset_id,
                    paths,
                    "the frame keeps another copy than the one approved",
                )));
            }
            let evidence =
                match self.library_copy(copy, Some(&frame.sha256), false, context, trash).await? {
                    Ok(evidence) => evidence,
                    Err(reason) => {
                        return Ok(Err(RefusedMove { id: asset_id, paths, reasons: vec![reason] }))
                    }
                };
            let kept = self.catalog().asset(frame.kept.asset_id).await?;
            let kept = KeptCopy {
                path: NativePath::from_path(&context.file(&frame.kept)?),
                fingerprint: ObservationFingerprint { content_sha256: None, ..kept.fingerprint },
                sha256: frame.sha256.clone(),
            };
            let moves = vec![Move {
                target: TrashTarget::Asset(asset_id),
                evidence,
                relied_on: vec![kept],
            }];
            return Ok(Ok(Candidate { id: asset_id, moves, complete_view_ids: Vec::new() }));
        }
        Ok(Err(stale(asset_id, Vec::new(), "the duplicate-copies offer no longer lists it")))
    }

    /// Re-check one approved intermediate or generated master source, and
    /// record its snapshot: its observation must still be the one the
    /// Results scan recorded, and it is hashed now.
    async fn intermediate(
        &self,
        sheet: &DoneArchiveSheet,
        result_id: Uuid,
        context: &Context,
        trash: &dyn OsTrash,
    ) -> Result<Result<Candidate, RefusedMove>, LibraryError> {
        let offer = &sheet.intermediates;
        if let Some(refused) = offer.refused.iter().find(|item| item.result_id == result_id) {
            let reasons = offer_reasons(&refused.reasons, &refused.custody);
            return Ok(Err(RefusedMove {
                id: result_id,
                paths: vec![refused.path.clone()],
                reasons,
            }));
        }
        let Some(item) = offer.items.iter().find(|item| item.result_id == result_id) else {
            return Ok(Err(stale(
                result_id,
                Vec::new(),
                "the intermediates offer no longer lists it",
            )));
        };
        let paths = vec![item.path.clone()];
        let refuse = |code: ReasonCode, detail: String| {
            Ok(Err(RefusedMove {
                id: result_id,
                paths: paths.clone(),
                reasons: vec![MoveRefusal::Custody {
                    path: item.path.clone(),
                    reason: ItemReason::new(code, detail),
                }],
            }))
        };
        let record = self.catalog().result(result_id).await?;
        let Some(recorded) = record.fingerprint.clone() else {
            return refuse(
                ReasonCode::SourceUnavailable,
                "the Results scan recorded no observation of it".into(),
            );
        };
        if let Err(refusal) = file_custody(&item.path, item.size_bytes, trash)? {
            return Ok(Err(RefusedMove { id: result_id, paths, reasons: vec![refusal] }));
        }
        let path = item.path.to_path_buf()?;
        let probe = path.clone();
        let observed = blocking(move || {
            Ok(inventory::probe_fingerprint(&probe).and_then(|current| {
                if same_observation(&current, &recorded) {
                    observe_entry(&probe).map(Some)
                } else {
                    Ok(None)
                }
            }))
        })
        .await?;
        let evidence = match observed {
            Ok(Some(evidence)) => evidence,
            Ok(None) => {
                return refuse(
                    ReasonCode::SourceDrift,
                    format!("{} changed since the Results scan recorded it", path.display()),
                );
            }
            Err(error) => return refuse(ReasonCode::SourceUnavailable, error.to_string()),
        };
        let mut relied_on = Vec::new();
        if let Some(kept) = &item.verified_duplicate_of {
            if evidence.sha256.as_deref() != Some(kept.sha256.as_str()) {
                return refuse(
                    ReasonCode::SourceDrift,
                    format!(
                        "{} no longer holds the bytes of its kept library copy",
                        path.display()
                    ),
                );
            }
            let location = context.location(kept.location_id)?;
            let fingerprint = match kept.asset_id {
                Some(asset) => self.catalog().asset(asset).await?.fingerprint,
                None => self.catalog().adopted_master_fingerprint(kept.master_id).await?,
            };
            relied_on.push(KeptCopy {
                path: NativePath::from_path(
                    &location.path.to_path_buf()?.join(kept.relative_path.relative_path()?),
                ),
                fingerprint: ObservationFingerprint { content_sha256: None, ..fingerprint },
                sha256: kept.sha256.clone(),
            });
        }
        let moves = vec![Move { target: TrashTarget::Result(result_id), evidence, relied_on }];
        Ok(Ok(Candidate { id: result_id, moves, complete_view_ids: Vec::new() }))
    }

    /// The custody checks of one library copy, reading no bytes, against its
    /// catalog record now ([`copy_custody`]). Returns its snapshot: the
    /// catalog observation with the recorded digest.
    async fn library_copy(
        &self,
        copy: &FrameCopy,
        digest: Option<&str>,
        captures_only: bool,
        context: &Context,
        trash: &dyn OsTrash,
    ) -> Result<Result<EntryEvidence, MoveRefusal>, LibraryError> {
        let asset = self.catalog().asset(copy.asset_id).await?;
        let now = FrameCopy {
            size_bytes: asset.fingerprint.size_bytes,
            sha256: asset.fingerprint.content_sha256.clone().or_else(|| digest.map(str::to_owned)),
            availability: asset.availability,
            ..copy.clone()
        };
        let sha256 = match copy_custody(&now, captures_only, context, trash)? {
            Ok(sha256) => sha256,
            Err(refusal) => return Ok(Err(refusal)),
        };
        Ok(Ok(EntryEvidence {
            path: NativePath::from_path(&context.file(copy)?),
            kind: EntryKind::File,
            fingerprint: ObservationFingerprint { content_sha256: None, ..asset.fingerprint },
            sha256: Some(sha256),
        }))
    }

    /// `sheet` with every custody refusal (STO-FR-14/15/16) its read-only
    /// checks find on `trash` and the registered locations: an offered item
    /// that fails one moves to the offer's refused items, out of N and Size,
    /// and a refused one lists it beside its offer refusals. No byte is read.
    pub(crate) async fn with_custody(
        &self,
        sheet: DoneArchiveSheet,
        trash: Arc<dyn OsTrash>,
    ) -> Result<DoneArchiveSheet, LibraryError> {
        let context = Context::new(self).await?;
        blocking(move || add_custody(sheet, &context, trash.as_ref())).await
    }

    /// Journal the candidates and drive the move until it settles.
    async fn run_move(
        &self,
        project_id: Uuid,
        offer: TrashOffer,
        project_revision: u64,
        candidates: Vec<Candidate>,
        refused: Vec<RefusedMove>,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<TrashMoveSummary, LibraryError> {
        if candidates.is_empty() {
            return Ok(TrashMoveSummary {
                project_id,
                offer,
                operation_id: None,
                state: StorageOperationState::Settled,
                resumed: false,
                moved: Vec::new(),
                refused,
                uncertain: Vec::new(),
                moved_bytes: 0,
            });
        }
        let mut drafts = Vec::new();
        let mut items = Vec::new();
        for candidate in candidates {
            for step in candidate.moves {
                items.push(TrashMoveItem {
                    seq: u32::try_from(drafts.len())
                        .map_err(|_| LibraryError::InvalidInput("too many items to move".into()))?,
                    item_id: candidate.id,
                    target: step.target,
                    complete_view_ids: candidate.complete_view_ids.clone(),
                    recorded: false,
                });
                drafts.push(StorageItemDraft {
                    source: step.evidence,
                    relied_on: step.relied_on,
                    destination: None,
                });
            }
        }
        let operation =
            self.catalog().record_storage_operation(StorageOperationKind::Trash, &drafts).await?;
        self.catalog()
            .record_trash_move(operation.id, project_id, offer, project_revision, &refused, &items)
            .await?;
        self.drive_move(operation.id, trash, false).await
    }

    /// Run or resume a recorded move: one approved item at a time, every
    /// copy of a multi-copy frame re-verified before the first one moves;
    /// each Trashed outcome recorded in the catalog.
    async fn drive_move(
        &self,
        op_id: Uuid,
        trash: &Arc<dyn OsTrash>,
        resumed: bool,
    ) -> Result<TrashMoveSummary, LibraryError> {
        let record = self.catalog().trash_move(op_id).await?;
        let mut operation = self.catalog().storage_operation(op_id).await?;
        if operation.state == StorageOperationState::Reviewed {
            operation = self.catalog().start_storage_operation(op_id).await?;
        }
        for group in groups(&record.items) {
            operation = self.move_group(&record, operation, &group, trash).await?;
        }
        let mut operation = self.catalog().storage_operation(op_id).await?;
        if operation.state != StorageOperationState::Settled
            && operation.items.iter().all(|step| step.outcome.is_some())
        {
            operation = self.catalog().settle_storage_operation(op_id).await?;
        }
        let record = self.catalog().trash_move(op_id).await?;
        if operation.state == StorageOperationState::Settled
            && record.items.iter().all(|item| item.recorded || !trashed(&operation, item.seq))
        {
            self.catalog().settle_trash_move(op_id).await?;
        }
        Ok(summary(&record, &operation, resumed))
    }

    /// Move one approved item's copies: a multi-copy frame none of whose
    /// copies started is re-verified whole first; then each open copy moves,
    /// and the catalog records what reached the OS Trash.
    async fn move_group(
        &self,
        record: &TrashMoveRecord,
        mut operation: StorageOperation,
        group: &[&TrashMoveItem],
        trash: &Arc<dyn OsTrash>,
    ) -> Result<StorageOperation, LibraryError> {
        let op_id = record.op_id;
        let open = |operation: &StorageOperation, seq: u32| {
            journal(operation, seq).is_some_and(|step| step.outcome.is_none())
        };
        let untouched = group.len() > 1
            && group.iter().all(|item| {
                journal(&operation, item.seq).is_some_and(|step| step.phase == ItemPhase::Pending)
            });
        if untouched {
            if let Some(reason) = self.frame_refusal(&operation, group, trash).await? {
                self.refuse_group(op_id, group, &reason).await?;
                operation = self.catalog().storage_operation(op_id).await?;
            }
        }
        for item in group {
            if open(&operation, item.seq) {
                operation = self.step_storage_operation(op_id, Arc::clone(trash)).await?;
            }
        }
        self.record_outcomes(record, &operation, group).await?;
        Ok(operation)
    }

    /// Re-verify every copy of a frame (D19) and its OS Trash support before
    /// any of them moves; the first refusal refuses the frame.
    async fn frame_refusal(
        &self,
        operation: &StorageOperation,
        group: &[&TrashMoveItem],
        trash: &Arc<dyn OsTrash>,
    ) -> Result<Option<(u32, ItemReason)>, LibraryError> {
        for item in group {
            let Some(step) = journal(operation, item.seq) else { continue };
            let source = step.source.clone();
            let trash = Arc::clone(trash);
            let refusal = blocking(move || Ok(movable(&source, trash.as_ref()))).await?;
            if let Err(reason) = refusal {
                return Ok(Some((item.seq, reason)));
            }
        }
        Ok(None)
    }

    /// Settle every open copy of a refused frame Blocked: the refused copy
    /// with its reason, the others naming it.
    async fn refuse_group(
        &self,
        op_id: Uuid,
        group: &[&TrashMoveItem],
        (refused, reason): &(u32, ItemReason),
    ) -> Result<(), LibraryError> {
        let operation = self.catalog().storage_operation(op_id).await?;
        let path = journal(&operation, *refused)
            .map(|step| step.source.path.display())
            .unwrap_or_default();
        for item in group {
            let Some(step) = journal(&operation, item.seq).filter(|step| step.outcome.is_none())
            else {
                continue;
            };
            let reason = if item.seq == *refused {
                reason.clone()
            } else {
                ItemReason::new(reason.code, format!("{SIBLING}{path}: {}", reason.detail))
            };
            let change = ItemChange {
                phase: ItemPhase::Settled,
                outcome: Some(ItemOutcome::Blocked),
                reason: Some(reason),
                written: None,
            };
            self.catalog().advance_storage_item(op_id, step.seq, step.revision, &change).await?;
        }
        Ok(())
    }

    /// Record the catalog side of each Trashed copy of `group` not yet
    /// recorded: a library copy turns Trashed with its episode, a Results
    /// file reads Missing.
    async fn record_outcomes(
        &self,
        record: &TrashMoveRecord,
        operation: &StorageOperation,
        group: &[&TrashMoveItem],
    ) -> Result<(), LibraryError> {
        let pending: Vec<&TrashMoveItem> = group
            .iter()
            .copied()
            .filter(|item| !item.recorded && trashed(operation, item.seq))
            .collect();
        if pending.is_empty() {
            return Ok(());
        }
        let frames: Vec<TrashedFrame> = pending
            .iter()
            .filter_map(|item| {
                let TrashTarget::Asset(asset_id) = item.target else { return None };
                let sha256 = journal(operation, item.seq)?.source.sha256.clone()?;
                Some(TrashedFrame {
                    asset_id,
                    sha256,
                    complete_view_ids: item.complete_view_ids.clone(),
                })
            })
            .collect();
        if !frames.is_empty() {
            self.catalog().record_trashed(record.op_id, &frames).await?;
        }
        let seqs: Vec<u32> = pending.iter().map(|item| item.seq).collect();
        self.catalog().record_trash_move_outcomes(record.op_id, &seqs).await
    }
}

/// D19 for one copy about to move: its volume keeps what the OS Trash
/// receives, and the copy still holds its reviewed identity and digest.
fn movable(source: &EntryEvidence, trash: &dyn OsTrash) -> Result<(), ItemReason> {
    let path = source
        .path
        .to_path_buf()
        .map_err(|error| ItemReason::new(ReasonCode::SourceUnavailable, error.to_string()))?;
    if let TrashSupport::Unsupported { detail, .. } =
        trash.support(&path, source.fingerprint.size_bytes)
    {
        return Err(ItemReason::new(
            ReasonCode::TrashUnsupported,
            format!("{detail}; it stays in place"),
        ));
    }
    verify_source(source)
}

/// An item's sheet refusals as move refusals: its offer refusals, then the
/// custody refusals the sheet's read-only checks found.
fn offer_reasons(reasons: &[OfferRefusal], custody: &[MoveRefusal]) -> Vec<MoveRefusal> {
    reasons
        .iter()
        .cloned()
        .map(|refusal| MoveRefusal::Offer { refusal })
        .chain(custody.iter().cloned())
        .collect()
}

/// A refused copy refuses its whole frame (STO-FR-15): with more than one
/// copy, `reasons` also names the frame incomplete.
fn whole_frame(reasons: &mut Vec<MoveRefusal>, copies: usize) {
    if copies > 1 {
        if let Some(path) = reasons.iter().find_map(refused_path) {
            reasons.push(MoveRefusal::FrameIncomplete { refused: path });
        }
    }
}

/// The read-only custody checks of one library copy as `copy` records it
/// (STO-FR-15): a Captures location for a rejected frame, an active
/// location, an Available copy, a recorded digest and an OS Trash. Returns
/// the digest the move re-verifies.
fn copy_custody(
    copy: &FrameCopy,
    captures_only: bool,
    context: &Context,
    trash: &dyn OsTrash,
) -> Result<Result<String, MoveRefusal>, LibraryError> {
    let location = context.location(copy.location_id)?;
    let path = context.file(copy)?;
    let native = NativePath::from_path(&path);
    let custody = |code: ReasonCode, detail: String| {
        Ok(Err(MoveRefusal::Custody {
            path: native.clone(),
            reason: ItemReason::new(code, detail),
        }))
    };
    if captures_only && location.role != LocationRole::Captures {
        return Ok(Err(MoveRefusal::OutsideCaptures {
            path: native,
            location: location.name.clone(),
        }));
    }
    if location.lifecycle != LocationLifecycle::Active {
        return custody(
            ReasonCode::SourceUnavailable,
            format!("location '{}' is retired", location.name),
        );
    }
    if copy.availability != Availability::Available {
        return custody(
            ReasonCode::SourceUnavailable,
            format!(
                "{} reads {:?} in location '{}'",
                path.display(),
                copy.availability,
                location.name
            ),
        );
    }
    let Some(sha256) = copy.sha256.clone() else {
        return Ok(Err(MoveRefusal::NoRecordedDigest { path: native }));
    };
    if let TrashSupport::Unsupported { detail, .. } = trash.support(&path, copy.size_bytes) {
        return custody(ReasonCode::TrashUnsupported, format!("{detail}; it stays in place"));
    }
    Ok(Ok(sha256))
}

/// The read-only custody check of a Results file at `path`: its volume
/// keeps what the OS Trash receives.
fn file_custody(
    path: &NativePath,
    size_bytes: u64,
    trash: &dyn OsTrash,
) -> Result<Result<(), MoveRefusal>, LibraryError> {
    Ok(match trash.support(&path.to_path_buf()?, size_bytes) {
        TrashSupport::Supported => Ok(()),
        TrashSupport::Unsupported { detail, .. } => Err(MoveRefusal::Custody {
            path: path.clone(),
            reason: ItemReason::new(
                ReasonCode::TrashUnsupported,
                format!("{detail}; it stays in place"),
            ),
        }),
    })
}

/// Move each offered item of `sheet` that fails a read-only custody check
/// into its offer's refused items, and list the custody refusals of each
/// refused one (STO-FR-14/16).
fn add_custody(
    mut sheet: DoneArchiveSheet,
    context: &Context,
    trash: &dyn OsTrash,
) -> Result<DoneArchiveSheet, LibraryError> {
    let frame_custody = |copies: &[FrameCopy]| -> Result<Vec<MoveRefusal>, LibraryError> {
        let digest = copies.iter().find_map(|copy| copy.sha256.clone());
        let mut reasons = Vec::new();
        for copy in copies {
            let copy = FrameCopy {
                sha256: copy.sha256.clone().or_else(|| digest.clone()),
                ..copy.clone()
            };
            reasons.extend(copy_custody(&copy, true, context, trash)?.err());
        }
        whole_frame(&mut reasons, copies.len());
        Ok(reasons)
    };
    let offer = &mut sheet.rejected_frames;
    for refused in &mut offer.refused {
        refused.custody = frame_custody(&refused.copies)?;
    }
    for frame in std::mem::take(&mut offer.frames) {
        let custody = frame_custody(&frame.copies)?;
        if custody.is_empty() {
            offer.frames.push(frame);
            continue;
        }
        offer.n -= 1;
        offer.size_bytes -= frame.size_bytes;
        let (frame_key, copies) = (frame.frame_key, frame.copies);
        offer.refused.push(RefusedFrame { frame_key, copies, reasons: Vec::new(), custody });
    }
    let offer = &mut sheet.intermediates;
    for refused in &mut offer.refused {
        refused.custody = file_custody(&refused.path, 0, trash)?.err().into_iter().collect();
    }
    for item in std::mem::take(&mut offer.items) {
        let Err(refusal) = file_custody(&item.path, item.size_bytes, trash)? else {
            offer.items.push(item);
            continue;
        };
        offer.n -= 1;
        offer.size_bytes -= item.size_bytes;
        offer.refused.push(RefusedIntermediate {
            result_id: item.result_id,
            owner: item.owner,
            path: item.path,
            reasons: Vec::new(),
            custody: vec![refusal],
        });
    }
    let offer = &mut sheet.duplicates;
    for frame in &mut offer.frames {
        for refused in &mut frame.refused {
            refused.custody =
                copy_custody(&refused.copy, false, context, trash)?.err().into_iter().collect();
        }
        for copy in std::mem::take(&mut frame.offered) {
            let Err(refusal) = copy_custody(&copy, false, context, trash)? else {
                frame.offered.push(copy);
                continue;
            };
            offer.n -= 1;
            offer.size_bytes -= copy.size_bytes;
            frame.refused.push(RefusedCopy { copy, reasons: Vec::new(), custody: vec![refusal] });
        }
    }
    Ok(sheet)
}

/// Locations by id, for paths and custody checks.
struct Context {
    locations: HashMap<Uuid, Location>,
}

impl Context {
    async fn new(library: &Library) -> Result<Self, LibraryError> {
        let locations = library
            .catalog()
            .list_locations()
            .await?
            .into_iter()
            .map(|location| (location.id, location))
            .collect();
        Ok(Self { locations })
    }

    fn location(&self, id: Uuid) -> Result<&Location, LibraryError> {
        self.locations.get(&id).ok_or_else(|| LibraryError::NotFound(format!("location {id}")))
    }

    fn file(&self, copy: &FrameCopy) -> Result<PathBuf, LibraryError> {
        let root = self.location(copy.location_id)?.path.to_path_buf()?;
        Ok(root.join(copy.relative_path.relative_path()?))
    }

    fn paths(&self, copies: &[FrameCopy]) -> Result<Vec<NativePath>, LibraryError> {
        copies.iter().map(|copy| self.file(copy).map(|path| NativePath::from_path(&path))).collect()
    }
}

fn stale(id: Uuid, paths: Vec<NativePath>, detail: &str) -> RefusedMove {
    RefusedMove { id, paths, reasons: vec![MoveRefusal::Stale { detail: detail.into() }] }
}

fn refused_path(reason: &MoveRefusal) -> Option<NativePath> {
    match reason {
        MoveRefusal::Custody { path, .. }
        | MoveRefusal::OutsideCaptures { path, .. }
        | MoveRefusal::NoRecordedDigest { path } => Some(path.clone()),
        MoveRefusal::Offer { .. }
        | MoveRefusal::Stale { .. }
        | MoveRefusal::FrameIncomplete { .. } => None,
    }
}

fn journal(operation: &StorageOperation, seq: u32) -> Option<&crate::StorageItem> {
    operation.items.iter().find(|step| step.seq == seq)
}

fn trashed(operation: &StorageOperation, seq: u32) -> bool {
    journal(operation, seq).is_some_and(|step| step.outcome == Some(ItemOutcome::Trashed))
}

/// The items of each approved item, in journal order.
fn groups(items: &[TrashMoveItem]) -> Vec<Vec<&TrashMoveItem>> {
    let mut groups: Vec<Vec<&TrashMoveItem>> = Vec::new();
    for item in items {
        match groups.last_mut() {
            Some(group) if group[0].item_id == item.item_id => group.push(item),
            _ => groups.push(vec![item]),
        }
    }
    groups
}

/// The exact summary: each approved item moved whole, refused whole with
/// every reason, or left uncertain naming what did move.
fn summary(
    record: &TrashMoveRecord,
    operation: &StorageOperation,
    resumed: bool,
) -> TrashMoveSummary {
    let mut moved = Vec::new();
    let mut refused = record.refused.clone();
    let mut uncertain = Vec::new();
    let mut moved_bytes = 0;
    for group in groups(&record.items) {
        let steps: Vec<&crate::StorageItem> =
            group.iter().filter_map(|item| journal(operation, item.seq)).collect();
        let id = group[0].item_id;
        let paths: Vec<NativePath> = steps.iter().map(|step| step.source.path.clone()).collect();
        let outcomes: Vec<Option<ItemOutcome>> = steps.iter().map(|step| step.outcome).collect();
        if outcomes.iter().all(|outcome| *outcome == Some(ItemOutcome::Trashed)) {
            let size_bytes = steps.iter().map(|step| step.source.fingerprint.size_bytes).sum();
            moved_bytes += size_bytes;
            moved.push(MovedItem { id, paths, size_bytes });
        } else if outcomes.iter().all(|outcome| *outcome == Some(ItemOutcome::Blocked)) {
            let failing = steps
                .iter()
                .find(|step| {
                    step.reason.as_ref().is_some_and(|reason| !reason.detail.starts_with(SIBLING))
                })
                .map(|step| step.source.path.clone());
            let reasons = steps
                .iter()
                .filter_map(|step| {
                    let reason = step.reason.clone()?;
                    if reason.detail.starts_with(SIBLING) {
                        failing.clone().map(|refused| MoveRefusal::FrameIncomplete { refused })
                    } else {
                        Some(MoveRefusal::Custody { path: step.source.path.clone(), reason })
                    }
                })
                .collect();
            refused.push(RefusedMove { id, paths, reasons });
        } else {
            let moved_paths = steps
                .iter()
                .filter(|step| step.outcome == Some(ItemOutcome::Trashed))
                .map(|step| step.source.path.clone())
                .collect();
            let reasons = steps.iter().filter_map(|step| step.reason.clone()).collect();
            uncertain.push(UncertainMove { id, paths, moved: moved_paths, reasons });
        }
    }
    TrashMoveSummary {
        project_id: record.project_id,
        offer: record.offer,
        operation_id: Some(record.op_id),
        state: operation.state,
        resumed,
        moved,
        refused,
        uncertain,
        moved_bytes,
    }
}
