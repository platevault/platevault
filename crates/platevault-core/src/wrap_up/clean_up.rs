// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Wrap up's Clean up (spec 071 STO-FR-01/02/04/05/10; D19, D-W81, D-W98):
//! the entries Apply placed in `View/`, Copies ticked and Symlinks unticked,
//! and whatever `View (previous)/` still holds, unticked. Only the rows the
//! user confirmed are retired. A link `PlateVault` placed is deleted after
//! its no-follow check proves it is still the recorded link pointing at its
//! original; a copy goes to the OS Trash once it still holds the bytes
//! `PlateVault` placed and its original re-verifies, both immediately
//! before the move; a leftover goes to the OS Trash after its recorded
//! evidence re-verifies. Anything that fails stays, named. `Processing/`,
//! `Output/`, originals and library frames are never listed.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use persistence_library::ApplyInputs;
use uuid::Uuid;

use super::project_folder;
use crate::apply::files;
use crate::custody::same_identity;
use crate::custody::trash::{self, OsTrash, Retirement};
use crate::layout::{VIEW_FOLDER, VIEW_PREVIOUS_FOLDER};
use crate::library::{blocking, Library};
use crate::{
    inventory, CleanUpEntry, CleanUpEntryKind, CleanUpOutcome, CleanUpReport, CleanUpRequest,
    CleanUpResult, CleanUpReview, EntryEvidence, EntryKind, EntryPlacement, EntrySource,
    ItemReason, KeptCopy, LibraryError, ManifestEntry, NativePath, ObservationFingerprint,
    PreviousItemReview, ReasonCode, WrapUpOutcome, WrapUpStep,
};

impl Library {
    /// The Clean up step as it opens (STO-FR-01): every entry still in the
    /// installed View, Copies preselected, and every file `View (previous)/`
    /// still holds, unticked. Read-only; it hashes nothing.
    ///
    /// # Errors
    /// `InvalidInput` for a Project that is not open; `NotFound` for an
    /// unknown Project; catalog errors.
    pub async fn clean_up_review(&self, project_id: Uuid) -> Result<CleanUpReview, LibraryError> {
        let inputs = self.catalog().apply_inputs(project_id).await?;
        if !inputs.lifecycle.is_open() {
            return Err(LibraryError::InvalidInput(format!(
                "a {} Project is locked; its Clean up is a read-only record",
                inputs.lifecycle
            )));
        }
        let removed = match &inputs.installed {
            Some(installed) => {
                self.catalog().view_entry_removals(project_id, installed.generation).await?
            }
            None => BTreeSet::new(),
        };
        blocking(move || review(&inputs, &removed)).await
    }

    /// Clean up the rows the user confirmed (STO-FR-04/05) and record the
    /// step: Finished, or Skipped when nothing was selected though something
    /// was offered. Once `View/` holds nothing more it is removed and its
    /// manifest retired; once `View (previous)/` is empty it goes too.
    ///
    /// # Errors
    /// `Conflict` when the Project or its View moved since the review;
    /// `InvalidInput` for a row the review doesn't offer, while Wrap up
    /// doesn't open or out of order; catalog errors.
    #[allow(clippy::too_many_lines)]
    pub async fn clean_up(
        &self,
        request: &CleanUpRequest,
        trash: Arc<dyn OsTrash>,
    ) -> Result<CleanUpReport, LibraryError> {
        let project_id = request.project_id;
        let review = self.clean_up_review(project_id).await?;
        if review.desired_revision != request.desired_revision
            || review.generation != request.generation
        {
            return Err(LibraryError::Conflict {
                id: project_id,
                current: review.desired_revision,
                successors: Vec::new(),
            });
        }
        let selected: BTreeSet<&NativePath> = request.selected.iter().collect();
        if let Some(stray) =
            selected.iter().find(|path| review.entries.iter().all(|entry| entry.path != ***path))
        {
            return Err(LibraryError::InvalidInput(format!(
                "Clean up doesn't offer {}; review it again",
                stray.display()
            )));
        }
        if selected.is_empty() {
            let outcome = if review.entries.is_empty() {
                WrapUpOutcome::Finished
            } else {
                WrapUpOutcome::Skipped
            };
            let record = self
                .catalog()
                .record_wrap_up_step(
                    project_id,
                    review.desired_revision,
                    WrapUpStep::CleanUp,
                    outcome,
                )
                .await?;
            return Ok(CleanUpReport { record, results: Vec::new(), view_removed: false });
        }
        let operation = self.catalog().begin_clean_up(project_id, review.desired_revision).await?;
        let inputs = self.catalog().apply_inputs(project_id).await?;
        let protection = self.output_protection(project_id).await?;
        let project = project_folder(inputs.parent.as_ref(), &inputs.name)?.ok_or_else(|| {
            LibraryError::InvalidInput("the Project has no processing location yet".into())
        })?;
        let mut results = Vec::with_capacity(selected.len());
        let mut previous_touched = false;
        for entry in review.entries.iter().filter(|entry| selected.contains(&entry.path)) {
            let absolute = project.join(entry.path.relative_path()?);
            let outcome = if protection.protects(&absolute) {
                kept(ReasonCode::Protected, format!("{} is protected Output", absolute.display()))
            } else {
                match &entry.kind {
                    CleanUpEntryKind::Placed { seq, .. } => {
                        let installed =
                            inputs.installed.as_ref().ok_or_else(|| LibraryError::Conflict {
                                id: project_id,
                                current: review.desired_revision,
                                successors: Vec::new(),
                            })?;
                        let placed = installed
                            .entries
                            .iter()
                            .find(|placed| placed.seq == *seq)
                            .cloned()
                            .ok_or_else(|| LibraryError::NotFound(format!("View entry {seq}")))?;
                        let original = original_of(&inputs, &placed);
                        let trash = Arc::clone(&trash);
                        let outcome = blocking(move || {
                            Ok(remove_placed(
                                &absolute,
                                &placed,
                                original.as_deref(),
                                trash.as_ref(),
                            ))
                        })
                        .await?;
                        if let CleanUpOutcome::Deleted | CleanUpOutcome::Trashed = outcome {
                            self.catalog()
                                .record_view_entry_removal(
                                    &operation,
                                    installed.generation,
                                    *seq,
                                    outcome == CleanUpOutcome::Trashed,
                                )
                                .await?;
                        }
                        outcome
                    }
                    CleanUpEntryKind::Leftover { .. } => {
                        previous_touched = true;
                        self.trash_leftover(project_id, &inputs, &entry.path, &trash).await?
                    }
                }
            };
            results.push(CleanUpResult { path: entry.path.clone(), outcome });
        }
        let removed = match &inputs.installed {
            Some(installed) => {
                self.catalog().view_entry_removals(project_id, installed.generation).await?
            }
            None => BTreeSet::new(),
        };
        let every_entry_removed = inputs
            .installed
            .as_ref()
            .is_some_and(|installed| installed.entries.iter().all(|e| removed.contains(&e.seq)));
        let (view_removed, previous_gone) = blocking({
            let project = project.clone();
            move || Ok(remove_emptied(&project, every_entry_removed, previous_touched))
        })
        .await?;
        if previous_gone && inputs.previous.is_some() {
            self.catalog().retire_previous_view(project_id).await?;
        }
        let record = self.catalog().finish_clean_up(&operation, view_removed).await?;
        Ok(CleanUpReport { record, results, view_removed })
    }

    /// Move one leftover the user ticked to the OS Trash once it is still the
    /// recorded file, and record its review.
    async fn trash_leftover(
        &self,
        project_id: Uuid,
        inputs: &ApplyInputs,
        path: &NativePath,
        trash: &Arc<dyn OsTrash>,
    ) -> Result<CleanUpOutcome, LibraryError> {
        let Some(item) = inputs.leftovers.iter().find(|item| item.path == *path).cloned() else {
            return Ok(kept(ReasonCode::SourceUnavailable, format!("{} is gone", path.display())));
        };
        let trash = Arc::clone(trash);
        let retired = blocking(move || {
            Ok(retirement(trash::retire(trash.as_ref(), &item.evidence, &[], || Ok(()))))
        })
        .await?;
        if retired == CleanUpOutcome::Trashed {
            self.catalog()
                .review_previous_item(project_id, path, PreviousItemReview::Trashed)
                .await?;
        }
        Ok(retired)
    }
}

fn kept(code: ReasonCode, detail: String) -> CleanUpOutcome {
    CleanUpOutcome::Kept { reason: ItemReason::new(code, detail) }
}

fn retirement(retired: Retirement) -> CleanUpOutcome {
    match retired {
        Retirement::Moved => CleanUpOutcome::Trashed,
        Retirement::Unsupported(reason)
        | Retirement::Blocked(reason)
        | Retirement::Uncertain(reason) => CleanUpOutcome::Kept { reason },
    }
}

fn review(inputs: &ApplyInputs, removed: &BTreeSet<u32>) -> Result<CleanUpReview, LibraryError> {
    let project = project_folder(inputs.parent.as_ref(), &inputs.name)?;
    let mut entries = Vec::new();
    if let (Some(project), Some(installed)) = (&project, &inputs.installed) {
        let view = project.join(VIEW_FOLDER);
        for entry in installed.entries.iter().filter(|entry| !removed.contains(&entry.seq)) {
            let relative = entry.path.relative_path()?;
            let Ok(metadata) = fs::symlink_metadata(view.join(&relative)) else { continue };
            let link = entry.placement == EntryPlacement::Symlink;
            entries.push(CleanUpEntry {
                path: NativePath::from_path(&Path::new(VIEW_FOLDER).join(&relative)),
                kind: CleanUpEntryKind::Placed { seq: entry.seq, placement: entry.placement },
                size_bytes: if link { 0 } else { metadata.len() },
                preselected: !link,
            });
        }
    }
    for item in &inputs.leftovers {
        entries.push(CleanUpEntry {
            path: item.path.clone(),
            kind: CleanUpEntryKind::Leftover { reason: item.reason },
            size_bytes: item.evidence.fingerprint.size_bytes,
            preselected: false,
        });
    }
    Ok(CleanUpReview {
        project_id: inputs.project_id,
        desired_revision: inputs.desired_revision,
        generation: inputs.installed.as_ref().map(|installed| installed.generation),
        entries,
    })
}

/// The current path of a placed entry's original.
fn original_of(inputs: &ApplyInputs, entry: &ManifestEntry) -> Option<PathBuf> {
    let id = match entry.source {
        EntrySource::Light { asset_id, .. } | EntrySource::CalibrationFrame { asset_id, .. } => {
            asset_id
        }
        EntrySource::Master { master_id, .. } => master_id,
    };
    inputs.sources.get(&id).and_then(|source| source.path.to_path_buf().ok())
}

/// Retire one placed entry (STO-FR-04): a link deleted once it is still the
/// recorded link pointing at its original, never followed; a copy moved to
/// the OS Trash once it still holds the bytes `PlateVault` placed and its
/// original still holds them too.
fn remove_placed(
    path: &Path,
    entry: &ManifestEntry,
    original: Option<&Path>,
    trash: &dyn OsTrash,
) -> CleanUpOutcome {
    match entry.placement {
        EntryPlacement::Symlink => {
            let original = original.map(Path::to_path_buf);
            match files::old_link(path, entry, original.as_ref()) {
                Ok(()) => match fs::remove_file(path) {
                    Ok(()) => CleanUpOutcome::Deleted,
                    Err(error) => {
                        kept(ReasonCode::WriteFailed, format!("{}: {error}", path.display()))
                    }
                },
                Err(_) => kept(
                    ReasonCode::DestinationChanged,
                    format!(
                        "{} is no longer the link PlateVault placed to its original; it stays",
                        path.display()
                    ),
                ),
            }
        }
        EntryPlacement::Copy | EntryPlacement::Clone => {
            let Some(original) = original else {
                return kept(
                    ReasonCode::KeptCopyUnproven,
                    format!("the original of {} is not on record; the copy stays", path.display()),
                );
            };
            let ours = inventory::probe_fingerprint(path).ok().filter(|observed| {
                entry
                    .written
                    .as_ref()
                    .is_some_and(|written| same_identity(&observed.identity, written))
            });
            let Some(observed) = ours else {
                return kept(
                    ReasonCode::SourceDrift,
                    format!("{} is no longer the copy PlateVault placed; it stays", path.display()),
                );
            };
            let original_now = match inventory::probe_fingerprint(original) {
                Ok(fingerprint) => fingerprint,
                Err(error) => {
                    return kept(
                        ReasonCode::KeptCopyUnproven,
                        format!("its original {} can't be read: {error}", original.display()),
                    )
                }
            };
            let copy = EntryEvidence {
                path: NativePath::from_path(path),
                kind: EntryKind::File,
                fingerprint: ObservationFingerprint { content_sha256: None, ..observed },
                sha256: Some(entry.source_sha256.clone()),
            };
            let retained = KeptCopy {
                path: NativePath::from_path(original),
                fingerprint: ObservationFingerprint { content_sha256: None, ..original_now },
                sha256: entry.source_sha256.clone(),
            };
            retirement(trash::retire(trash, &copy, &[retained], || Ok(())))
        }
    }
}

/// Remove `View/` once every entry left it and it holds nothing, and
/// `View (previous)/` once it holds nothing; only emptied folders go, never
/// anything recursively. Returns whether each is gone.
fn remove_emptied(
    project: &Path,
    every_entry_removed: bool,
    previous_touched: bool,
) -> (bool, bool) {
    let view = project.join(VIEW_FOLDER);
    let view_gone = every_entry_removed && {
        if files::holds_nothing(&view) {
            files::remove_empty_folders(&view);
        }
        fs::symlink_metadata(&view).is_err()
    };
    let previous = project.join(VIEW_PREVIOUS_FOLDER);
    let previous_gone = previous_touched && {
        if files::holds_nothing(&previous) {
            files::remove_empty_folders(&previous);
        }
        fs::symlink_metadata(&previous).is_err()
    };
    (view_gone, previous_gone)
}
