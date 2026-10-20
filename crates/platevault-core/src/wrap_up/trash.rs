// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Wrap up's Trash step (spec 065 PRJ-FR-15/16, 071 STO-FR-14 to STO-FR-16;
//! D19, D-W43, D-W70, D-W74, D-W116): three rows, each moving to the OS
//! Trash only when the user ticks it.
//!
//! - Rejected frames: the Project's light frames whose applicable library
//!   quality is Unusable, every copy or none. A frame another open Project's
//!   View places is refused with its name; a Closed or Archived Project's
//!   kept View doesn't block. Only copies in Captures locations move.
//! - `Processing/` files: every file and link below the Project's
//!   `Processing/`, except what the Output protection keeps (the masters it
//!   offered, which the step names so the user can adopt them first).
//!   `Output/` is never walked.
//! - Duplicate copies: the extra byte-identical copies of the Project's
//!   light and calibration frames. The kept copy is the one in a Captures or
//!   Calibration location, the earliest registered, else the earliest
//!   registered location; a tie in one location keeps the copy catalogued
//!   first. A copy another open Project's View places is refused.
//!
//! Every refusal is listed with its reason. Execution recomputes the review
//! and refuses a sheet that moved, re-verifies each copy (and the kept copy
//! a duplicate relies on) immediately before its move through the storage
//! journal, and moves a rejected frame whole or not at all. Moved library
//! copies are recorded Trashed.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use persistence_library::{TrashBasis, TrashItemDraft, TrashedFrame, WrapUpTrash};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::project_folder;
use crate::apply::files;
use crate::custody::trash::OsTrash;
use crate::custody::{observe_entry, verify_source};
use crate::layout::PROCESSING_FOLDER;
use crate::library::{blocking, Library};
use crate::project_output::OutputProtection;
use crate::{
    ApplicableQuality, Asset, Availability, EntryEvidence, EntryKind, ItemChange, ItemOutcome,
    ItemPhase, ItemReason, KeptCopy, LibraryError, Location, LocationRole, NativePath,
    ObservationFingerprint, ReasonCode, StorageItem, StorageOperationState, TrashCandidate,
    TrashGroup, TrashGroupOffer, TrashRefusal, TrashReport, TrashRequest, TrashReview,
    TrashSupport, WrapUpOutcome, WrapUpStep,
};

/// One row's items with what each journals.
struct Planned {
    candidate: TrashCandidate,
    items: Vec<TrashItemDraft>,
}

/// The review and, per row, the journal drafts its items record.
struct Offers {
    review: TrashReview,
    planned: BTreeMap<TrashGroup, Vec<Planned>>,
}

impl Library {
    /// The Trash step as it opens: its three rows with what each moves,
    /// keeps and refuses, the custody refusals of `trash` included. It hashes
    /// the `Processing/` files so execution can re-verify them; it moves and
    /// records nothing.
    ///
    /// # Errors
    /// `InvalidInput` for a Project that is not open; `NotFound` for an
    /// unknown Project; catalog errors.
    pub async fn trash_review(
        &self,
        project_id: Uuid,
        trash: Arc<dyn OsTrash>,
    ) -> Result<TrashReview, LibraryError> {
        Ok(self.trash_offers(project_id, trash).await?.review)
    }

    /// Execute the Trash step for the rows the user ticked (D-W43) and record
    /// it: Finished, or Skipped when nothing was ticked though something was
    /// offered. An unticked row moves nothing.
    ///
    /// # Errors
    /// `Conflict` when the review moved since the user saw it; `InvalidInput`
    /// while Wrap up doesn't open or before Clean up is recorded; journal and
    /// catalog failures.
    pub async fn wrap_up_trash(
        &self,
        request: &TrashRequest,
        trash: Arc<dyn OsTrash>,
    ) -> Result<TrashReport, LibraryError> {
        let project_id = request.project_id;
        let mut offers = self.trash_offers(project_id, Arc::clone(&trash)).await?;
        if offers.review.digest != request.digest {
            return Err(LibraryError::Conflict {
                id: project_id,
                current: offers.review.desired_revision,
                successors: Vec::new(),
            });
        }
        let ticked: BTreeSet<TrashGroup> = request.ticked.iter().copied().collect();
        let mut seen = BTreeSet::new();
        let mut items = Vec::new();
        for group in TrashGroup::ORDER.into_iter().filter(|group| ticked.contains(group)) {
            for planned in offers.planned.remove(&group).unwrap_or_default() {
                // A copy the rejected-frames row moves isn't moved again.
                items.extend(
                    planned
                        .items
                        .into_iter()
                        .filter(|item| seen.insert(item.draft.source.path.clone())),
                );
            }
        }
        if items.is_empty() {
            let offered = offers.review.groups.iter().any(|group| !group.items.is_empty());
            let outcome = if offered { WrapUpOutcome::Skipped } else { WrapUpOutcome::Finished };
            let record = self
                .catalog()
                .record_wrap_up_step(
                    project_id,
                    offers.review.desired_revision,
                    WrapUpStep::Trash,
                    outcome,
                )
                .await?;
            return Ok(TrashReport { record, moved: Vec::new(), refused: Vec::new() });
        }
        let journal =
            self.catalog().begin_trash(project_id, offers.review.desired_revision, &items).await?;
        self.drive_trash(journal, &trash).await
    }

    async fn trash_offers(
        &self,
        project_id: Uuid,
        trash: Arc<dyn OsTrash>,
    ) -> Result<Offers, LibraryError> {
        let status = self.catalog().wrap_up_status(project_id).await?;
        if !status.lifecycle.is_open() {
            return Err(LibraryError::InvalidInput(format!(
                "a {} Project is locked; its Trash step is a read-only record",
                status.lifecycle
            )));
        }
        let basis = self.catalog().trash_basis(project_id).await?;
        let protection = self.output_protection(project_id).await?;
        blocking(move || offers(&basis, &protection, trash.as_ref())).await
    }

    /// Run or resume a journaled Trash step until it settles, record the
    /// Trashed library copies, which announces their locations to new-capture
    /// discovery ([`Library::record_trashed`]), and the step Finished.
    pub(super) async fn drive_trash(
        &self,
        journal: WrapUpTrash,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<TrashReport, LibraryError> {
        let catalog = self.catalog();
        let storage = journal.storage_operation_id;
        let operation = catalog.storage_operation(storage).await?;
        if operation.state == StorageOperationState::Reviewed {
            catalog.start_storage_operation(storage).await?;
        }
        self.refuse_partial_frames(&journal, trash).await?;
        let operation = self.run_storage_operation(storage, Arc::clone(trash)).await?;
        let mut trashed = Vec::new();
        let mut recorded = Vec::new();
        for item in journal.items.iter().filter(|item| !item.recorded) {
            let step = &operation.items[item.seq as usize];
            if step.outcome != Some(ItemOutcome::Trashed) {
                continue;
            }
            recorded.push(item.seq);
            if let (Some(asset_id), Some(sha256)) = (item.asset_id, step.source.sha256.clone()) {
                trashed.push(TrashedFrame { asset_id, sha256 });
            }
        }
        if !trashed.is_empty() {
            self.record_trashed(storage, &trashed).await?;
        }
        catalog.mark_wrap_up_trash_recorded(storage, &recorded).await?;
        let record = catalog.finish_trash(&journal).await?;
        let mut moved = Vec::new();
        let mut refused = Vec::new();
        for (item, step) in journal.items.iter().zip(&operation.items) {
            match (step.outcome, &step.reason) {
                (Some(ItemOutcome::Trashed), _) => moved.push(step.source.path.clone()),
                (_, Some(reason)) => refused.push(TrashRefusal {
                    id: item.item_id,
                    path: step.source.path.clone(),
                    reason: reason.clone(),
                }),
                _ => {}
            }
        }
        Ok(TrashReport { record, moved, refused })
    }

    /// A rejected frame moves whole (STO-FR-15): before the first of its
    /// copies moves, every copy re-verifies, and one that doesn't refuses
    /// them all, naming it.
    async fn refuse_partial_frames(
        &self,
        journal: &WrapUpTrash,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<(), LibraryError> {
        let catalog = self.catalog();
        let storage = journal.storage_operation_id;
        let mut frames: BTreeMap<Uuid, Vec<u32>> = BTreeMap::new();
        for item in journal.items.iter().filter(|item| item.group == TrashGroup::RejectedFrames) {
            if let Some(frame) = item.item_id {
                frames.entry(frame).or_default().push(item.seq);
            }
        }
        for seqs in frames.values() {
            let operation = catalog.storage_operation(storage).await?;
            let steps: Vec<StorageItem> =
                operation.items.into_iter().filter(|step| seqs.contains(&step.seq)).collect();
            if !steps.iter().all(|step| step.phase == ItemPhase::Pending) {
                continue;
            }
            let sources: Vec<EntryEvidence> =
                steps.iter().map(|step| step.source.clone()).collect();
            let trash = Arc::clone(trash);
            let refusal = blocking(move || {
                Ok(sources.iter().find_map(|source| {
                    movable(source, trash.as_ref()).err().map(|why| (source.path.clone(), why))
                }))
            })
            .await?;
            let Some((path, reason)) = refusal else { continue };
            for step in &steps {
                let why = if step.source.path == path {
                    reason.clone()
                } else {
                    ItemReason::new(
                        reason.code,
                        format!(
                            "another copy of this frame was refused: {}: {}",
                            path.display(),
                            reason.detail
                        ),
                    )
                };
                let change = ItemChange {
                    phase: ItemPhase::Settled,
                    outcome: Some(ItemOutcome::Blocked),
                    reason: Some(why),
                    written: None,
                };
                catalog.advance_storage_item(storage, step.seq, step.revision, &change).await?;
            }
        }
        Ok(())
    }
}

/// D19 for one copy about to move: its volume keeps what the OS Trash
/// receives, and it still holds its reviewed identity and digest.
fn movable(source: &EntryEvidence, trash: &dyn OsTrash) -> Result<(), ItemReason> {
    let path = source
        .path
        .to_path_buf()
        .map_err(|error| ItemReason::new(ReasonCode::SourceUnavailable, error.to_string()))?;
    if let TrashSupport::Unsupported { reason, detail } =
        trash.support(&path, source.fingerprint.size_bytes)
    {
        return Err(ItemReason::new(
            ReasonCode::TrashUnsupported,
            format!("{detail} ({reason:?})"),
        ));
    }
    verify_source(source)
}

/// The three rows in one pass over the basis, in the step's order; kept
/// together because each row's refusals read the same location and View
/// facts.
#[allow(clippy::too_many_lines)]
fn offers(
    basis: &TrashBasis,
    protection: &OutputProtection,
    trash: &dyn OsTrash,
) -> Result<Offers, LibraryError> {
    let locations: BTreeMap<Uuid, (usize, &Location)> = basis
        .locations
        .iter()
        .enumerate()
        .map(|(order, location)| (location.id, (order, location)))
        .collect();
    let file = |asset: &Asset| -> Option<PathBuf> {
        let (_, location) = locations.get(&asset.location_id)?;
        Some(location.path.to_path_buf().ok()?.join(asset.relative_path.relative_path().ok()?))
    };
    let mut planned: BTreeMap<TrashGroup, Vec<Planned>> = BTreeMap::new();
    let mut refused: BTreeMap<TrashGroup, Vec<TrashRefusal>> = BTreeMap::new();

    // Rejected frames.
    for frame in basis
        .frames
        .iter()
        .filter(|frame| frame.light && frame.quality == ApplicableQuality::Unusable)
    {
        let copies: Vec<&Asset> =
            frame.copies.iter().filter(|copy| copy.availability != Availability::Missing).collect();
        let Some(first) = copies.first() else { continue };
        let mut items = Vec::new();
        let mut refusal = None;
        for copy in &copies {
            match library_copy(copy, file(copy), &locations, &basis.in_open_views, trash, true) {
                Ok(evidence) => items.push(TrashItemDraft {
                    group: TrashGroup::RejectedFrames,
                    item_id: Some(frame.key),
                    asset_id: Some(copy.id),
                    draft: crate::StorageItemDraft {
                        source: evidence,
                        relied_on: Vec::new(),
                        destination: None,
                    },
                }),
                Err(refusal_of) => {
                    refusal = Some(refusal_of);
                    break;
                }
            }
        }
        match refusal {
            Some((path, reason)) => {
                refused.entry(TrashGroup::RejectedFrames).or_default().push(TrashRefusal {
                    id: Some(frame.key),
                    path: path
                        .unwrap_or_else(|| NativePath::from_path(&file(first).unwrap_or_default())),
                    reason,
                });
            }
            None => planned.entry(TrashGroup::RejectedFrames).or_default().push(Planned {
                candidate: TrashCandidate {
                    id: Some(frame.key),
                    files: items.iter().map(|item| item.draft.source.path.clone()).collect(),
                    size_bytes: items
                        .iter()
                        .map(|item| item.draft.source.fingerprint.size_bytes)
                        .sum(),
                    kept: None,
                },
                items,
            }),
        }
    }

    // Processing files: a `Processing/` that is a link, or holds anything
    // that can't be read, is refused as such, never offered in part.
    let mut protected_masters = Vec::new();
    if let Some(project) = project_folder(basis.parent.as_ref(), &basis.name)? {
        let processing = project.join(PROCESSING_FOLDER);
        match files::files_below(&processing) {
            Ok(found) => {
                for relative in found {
                    let path = processing.join(&relative);
                    if protection.protects(&path) {
                        protected_masters.push(NativePath::from_path(&path));
                        continue;
                    }
                    match processing_file(&path, trash) {
                        Ok(evidence) => {
                            planned.entry(TrashGroup::ProcessingFiles).or_default().push(
                                Planned {
                                    candidate: TrashCandidate {
                                        id: None,
                                        files: vec![evidence.path.clone()],
                                        size_bytes: evidence.fingerprint.size_bytes,
                                        kept: None,
                                    },
                                    items: vec![TrashItemDraft {
                                        group: TrashGroup::ProcessingFiles,
                                        item_id: None,
                                        asset_id: None,
                                        draft: crate::StorageItemDraft {
                                            source: evidence,
                                            relied_on: Vec::new(),
                                            destination: None,
                                        },
                                    }],
                                },
                            );
                        }
                        Err(reason) => {
                            refused.entry(TrashGroup::ProcessingFiles).or_default().push(
                                TrashRefusal { id: None, path: NativePath::from_path(&path), reason },
                            );
                        }
                    }
                }
            }
            Err(unreadable) => refused.entry(TrashGroup::ProcessingFiles).or_default().extend(
                unreadable.into_iter().map(|(path, reason)| TrashRefusal {
                    id: None,
                    path: NativePath::from_path(&path),
                    reason,
                }),
            ),
        }
    }

    // Duplicate copies.
    for frame in &basis.frames {
        let mut by_bytes: BTreeMap<&str, Vec<&Asset>> = BTreeMap::new();
        for copy in frame.copies.iter().filter(|copy| copy.availability != Availability::Missing) {
            if let Some(sha) = copy.fingerprint.content_sha256.as_deref() {
                by_bytes.entry(sha).or_default().push(copy);
            }
        }
        for copies in by_bytes.into_values().filter(|copies| copies.len() > 1) {
            let Some(keeper) = keeper(&copies, &locations, &basis.first_observed) else { continue };
            let kept_path = file(keeper);
            for extra in copies.iter().filter(|copy| copy.id != keeper.id) {
                let kept = kept_copy(keeper, kept_path.as_deref());
                let checked = kept.and_then(|kept| {
                    library_copy(extra, file(extra), &locations, &basis.in_open_views, trash, false)
                        .map_err(|(_, reason)| reason)
                        .map(|evidence| (evidence, kept))
                });
                match checked {
                    Ok((evidence, kept)) => {
                        planned.entry(TrashGroup::DuplicateCopies).or_default().push(Planned {
                            candidate: TrashCandidate {
                                id: Some(extra.id),
                                files: vec![evidence.path.clone()],
                                size_bytes: evidence.fingerprint.size_bytes,
                                kept: Some(kept.path.clone()),
                            },
                            items: vec![TrashItemDraft {
                                group: TrashGroup::DuplicateCopies,
                                item_id: Some(extra.id),
                                asset_id: Some(extra.id),
                                draft: crate::StorageItemDraft {
                                    source: evidence,
                                    relied_on: vec![kept],
                                    destination: None,
                                },
                            }],
                        });
                    }
                    Err(reason) => {
                        refused.entry(TrashGroup::DuplicateCopies).or_default().push(
                            TrashRefusal {
                                id: Some(extra.id),
                                path: NativePath::from_path(&file(extra).unwrap_or_default()),
                                reason,
                            },
                        );
                    }
                }
            }
        }
    }

    let groups: Vec<TrashGroupOffer> = TrashGroup::ORDER
        .into_iter()
        .map(|group| {
            let items: Vec<TrashCandidate> = planned
                .get(&group)
                .into_iter()
                .flatten()
                .map(|planned| planned.candidate.clone())
                .collect();
            TrashGroupOffer {
                group,
                size_bytes: items.iter().map(|item| item.size_bytes).sum(),
                items,
                refused: refused.remove(&group).unwrap_or_default(),
                preselected: false,
            }
        })
        .collect();
    let digest = {
        let encoded = serde_json::to_vec(&(&groups, &protected_masters))
            .map_err(|error| LibraryError::PersistenceFailure(error.to_string()))?;
        hex::encode(Sha256::digest(encoded))
    };
    Ok(Offers {
        review: TrashReview {
            project_id: basis.project_id,
            desired_revision: basis.desired_revision,
            digest,
            groups,
            protected_masters,
        },
        planned,
    })
}

/// The custody checks of one library copy, reading no bytes (STO-FR-15/16):
/// another open Project's View must not place it, its location must be
/// online with an OS Trash that keeps what it receives (and a Captures
/// location for a rejected frame), and it needs a recorded digest. Returns
/// its snapshot: the catalog observation with that digest.
fn library_copy(
    copy: &Asset,
    path: Option<PathBuf>,
    locations: &BTreeMap<Uuid, (usize, &Location)>,
    in_open_views: &BTreeMap<Uuid, Vec<String>>,
    trash: &dyn OsTrash,
    captures_only: bool,
) -> Result<EntryEvidence, (Option<NativePath>, ItemReason)> {
    let shown = path.as_deref().map(NativePath::from_path);
    let refuse =
        |code: ReasonCode, detail: String| Err((shown.clone(), ItemReason::new(code, detail)));
    let Some(path) = path else {
        return refuse(
            ReasonCode::SourceUnavailable,
            format!("copy {} has no registered location", copy.id),
        );
    };
    if let Some(projects) = in_open_views.get(&copy.id) {
        return refuse(
            ReasonCode::Protected,
            format!("{} is in the View of {}", path.display(), projects.join(", ")),
        );
    }
    let Some((_, location)) = locations.get(&copy.location_id) else {
        return refuse(
            ReasonCode::SourceUnavailable,
            format!("{} has no location", path.display()),
        );
    };
    if captures_only && location.role != LocationRole::Captures {
        return refuse(
            ReasonCode::Protected,
            format!("{} is not in a Captures location; only Captures copies move", path.display()),
        );
    }
    if copy.availability != Availability::Available
        || location.availability != Availability::Available
    {
        return refuse(ReasonCode::SourceUnavailable, format!("{} is not online", path.display()));
    }
    let Some(sha256) = copy.fingerprint.content_sha256.clone() else {
        return refuse(
            ReasonCode::SourceDrift,
            format!("{} has no recorded digest", path.display()),
        );
    };
    if let TrashSupport::Unsupported { reason, detail } =
        trash.support(&path, copy.fingerprint.size_bytes)
    {
        return refuse(ReasonCode::TrashUnsupported, format!("{detail} ({reason:?})"));
    }
    Ok(EntryEvidence {
        path: NativePath::from_path(&path),
        kind: EntryKind::File,
        fingerprint: ObservationFingerprint { content_sha256: None, ..copy.fingerprint.clone() },
        sha256: Some(sha256),
    })
}

/// A `Processing/` file's snapshot, hashed now so execution re-verifies it;
/// a link is recorded by its own identity, never followed.
fn processing_file(path: &Path, trash: &dyn OsTrash) -> Result<EntryEvidence, ItemReason> {
    let evidence = observe_entry(path)
        .map_err(|error| ItemReason::new(ReasonCode::SourceUnavailable, error.to_string()))?;
    if let TrashSupport::Unsupported { reason, detail } =
        trash.support(path, evidence.fingerprint.size_bytes)
    {
        return Err(ItemReason::new(
            ReasonCode::TrashUnsupported,
            format!("{detail} ({reason:?})"),
        ));
    }
    if evidence.kind != EntryKind::File && fs::read_link(path).is_err() {
        return Err(ItemReason::new(
            ReasonCode::SourceUnavailable,
            format!("{} is unreadable", path.display()),
        ));
    }
    Ok(evidence)
}

/// The kept copy of byte-identical `copies` (D-W74, D-W116): Captures or
/// Calibration first, then the earliest-registered location, then the copy
/// catalogued first.
fn keeper<'a>(
    copies: &[&'a Asset],
    locations: &BTreeMap<Uuid, (usize, &Location)>,
    first_observed: &BTreeMap<Uuid, i64>,
) -> Option<&'a Asset> {
    copies
        .iter()
        .copied()
        .filter_map(|copy| {
            let (order, location) = locations.get(&copy.location_id)?;
            let library =
                matches!(location.role, LocationRole::Captures | LocationRole::Calibration);
            Some((
                (
                    !library,
                    *order,
                    first_observed.get(&copy.id).copied().unwrap_or(i64::MAX),
                    copy.id,
                ),
                copy,
            ))
        })
        .min_by_key(|(rank, _)| *rank)
        .map(|(_, copy)| copy)
}

/// The kept copy a duplicate's move relies on; it must be online to be
/// re-verified before the move.
fn kept_copy(keeper: &Asset, path: Option<&Path>) -> Result<KeptCopy, ItemReason> {
    let (Some(path), Some(sha256)) = (path, keeper.fingerprint.content_sha256.clone()) else {
        return Err(ItemReason::new(
            ReasonCode::KeptCopyUnproven,
            "the kept copy has no recorded digest",
        ));
    };
    if keeper.availability != Availability::Available {
        return Err(ItemReason::new(
            ReasonCode::KeptCopyUnproven,
            format!("the kept copy {} is not online", path.display()),
        ));
    }
    Ok(KeptCopy {
        path: NativePath::from_path(path),
        fingerprint: ObservationFingerprint { content_sha256: None, ..keeper.fingerprint.clone() },
        sha256,
    })
}
