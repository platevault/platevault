// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application preparation of a single run (spec 069 PREP-FR-01..11,
//! PREP-FR-14; D04, D09, D19): review, Prepare, Retry, the outcome and Open.
//!
//! Review is read-only. Prepare records a new revision Running in a new
//! folder that never existed before, then settles each input: it snapshots
//! the source (no-follow identity and SHA-256), refuses a snapshot differing
//! from the confirmed membership or the calibration assignment's digest, and
//! writes the entry by the chosen mode through the custody primitives. Copies
//! go through the verified transfer, clones and hardlinks are re-read, links
//! are recorded by their own identity and target. Immediately before terminal
//! success every source and entry is re-verified; drift blocks the item. Open
//! re-verifies every entry again before each launch and refuses on drift.
//! Nothing here marks a run Complete, and no source is ever written.
//!
//! PREP feeds the run lifecycle ports: a Running revision blocks Mark
//! Complete and Move run to Trash ([`RunOperationGuard`]), every revision's
//! folder and the run's Results folder are named for Empty Trash
//! ([`RunFolders`]), and [`PreparationFailed`] is the run blocker Home reads.

use std::collections::{BTreeSet, HashMap};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Weak};

use persistence_library::{
    EntryUpdate, MembershipBasis, NewPreparation, NewPreparedEntry, PreparationRecord,
    RecordedFolders,
};
use uuid::Uuid;

use crate::custody::{self, observe_entry, transfer, verify_source};
use crate::library::{blocking, Library};
use crate::run_lifecycle::{BlockersFuture, FoldersFuture, RunFolders, RunOperationGuard};
use crate::{header_patch, layout};
use crate::{
    Asset, Availability, BasisOrigin, BlockedInput, CalibrationHandoff, CorrectedField,
    CorrectionChoice, CorrectionOption, EntryEvidence, EntryKind, EntryState, ImageFormat,
    InputMode, ItemReason, LibraryError, LifecycleBlocker, LinkKind, LocationCheck, MemberState,
    Membership, ModeOption, NativePath, OpenOutcome, PlannedCorrection, PlannedEntry,
    PreparationFailed, PreparationOutcome, PreparationReview, PreparationRevision,
    PreparationState, PrepareRequest, PrepareStep, PreparedEntry, PreparedEntryKind,
    PreparedFolder, PreparedInput, Profile, ReasonCode, Revision, RunFolderSet, RunLocation,
    RunOperationKind, RunStage, SourceBasis, TransferDestination, View, Writability, WrittenCopy,
};

/// Whether this platform makes verified clones: APFS `clonefile` on macOS and
/// the `FICLONE` reflink on Linux. A volume that refuses one blocks the item;
/// nothing is copied in its place.
const CLONE_SUPPORTED: bool = cfg!(any(target_os = "macos", target_os = "linux"));

/// What Prepare and Retry ask while a revision is Running (PREP-FR-09).
pub trait PrepareControl: Send + Sync {
    /// Asked before each entry: continue, or stop where it is safe.
    fn step(&self) -> PrepareStep;
    /// Each entry as it settles; the outcome read shows the same progress.
    fn settled(&self, entry: &PreparedEntry);
}

fn invalid(message: impl Into<String>) -> LibraryError {
    LibraryError::InvalidInput(message.into())
}

fn reason(code: ReasonCode, detail: impl Into<String>) -> ItemReason {
    ItemReason::new(code, detail)
}

/// The recorded basis an input's snapshot must match (D19): the confirmed
/// membership's copy fingerprint, or the calibration assignment's digest.
/// Prepare records it with each entry; Retry verifies against that record.
type Basis = SourceBasis;

/// One input review resolved to a source.
#[derive(Clone, Debug)]
struct SourceInput {
    member_key: Option<Uuid>,
    asset_id: Option<Uuid>,
    master_id: Option<Uuid>,
    input: PreparedInput,
    source: PathBuf,
    size_bytes: u64,
}

/// A review with the anchors its inputs are snapshotted against.
struct Planned {
    review: PreparationReview,
    anchors: HashMap<PathBuf, Basis>,
}

impl Library {
    /// Review preparation (PREP-FR-08): the run's Project and subject, the
    /// immutable committed selection, profile and capability gaps, each input
    /// mode with its refusal, the location, every entry with its path, what is
    /// blocked, calibration choices, operation count, footprint and free
    /// space. Read-only: nothing is created until Prepare.
    ///
    /// # Errors
    /// `InvalidInput` for a run in the Trash, a panel run or a run without a
    /// saved membership, or a name that is no folder name; `NotFound` for an
    /// unknown run or profile.
    pub async fn review_preparation(
        &self,
        view: Uuid,
        request: &PrepareRequest,
    ) -> Result<PreparationReview, LibraryError> {
        Ok(self.plan_preparation(view, request).await?.review)
    }

    /// Prepare run (PREP-FR-09): materialize the committed membership at
    /// `membership_revision` in a new revision folder and end in exactly one
    /// of Prepared, Partial, Failed, Canceled or Paused.
    ///
    /// # Errors
    /// `Conflict` when the run's committed membership moved past
    /// `membership_revision`; `InvalidInput` naming every refusal of the
    /// review, or when the folder appeared since; catalog errors. A failure
    /// after the revision was recorded ends it Failed.
    pub async fn prepare_run(
        &self,
        view: Uuid,
        request: &PrepareRequest,
        membership_revision: Revision,
        control: &dyn PrepareControl,
    ) -> Result<PreparationOutcome, LibraryError> {
        let Planned { review, anchors } = self.plan_preparation(view, request).await?;
        if review.membership_revision != membership_revision {
            return Err(LibraryError::Conflict {
                id: view,
                current: review.membership_revision,
                successors: Vec::new(),
            });
        }
        if !review.refusals.is_empty() {
            return Err(invalid(review.refusals.join("; ")));
        }
        let location =
            review.location.clone().ok_or_else(|| invalid("choose a parent folder for the run"))?;
        let recorded_results = self.catalog().view_results_folder(view).await?.is_some();
        let folders: BTreeSet<PathBuf> = review
            .entries
            .iter()
            .filter(|entry| entry.kind != PreparedEntryKind::DirectSource)
            .map(|entry| &entry.path)
            .chain(review.blocked.iter().filter_map(|blocked| blocked.path.as_ref()))
            .filter_map(|path| path.to_path_buf().ok()?.parent().map(Path::to_path_buf))
            .filter(|parent| parent.starts_with(location.folder.to_path_buf().unwrap_or_default()))
            .collect();
        let target = location.clone();
        let created = blocking(move || create_folders(&target, &folders, recorded_results)).await?;
        let basis_of = |source: Option<&NativePath>| {
            source.and_then(|source| anchors.get(&source.to_path_buf().ok()?).cloned())
        };
        // Only an offered, chosen patch reaches the entry of its source,
        // a blocked one included, so Retry patches it too (PREP-FR-03).
        let patched: HashMap<PathBuf, &[CorrectedField]> = review
            .corrections
            .iter()
            .filter(|correction| correction.delivered)
            .filter_map(|correction| {
                Some((correction.source.to_path_buf().ok()?, correction.fields.as_slice()))
            })
            .collect();
        let patch_of = |source: Option<&NativePath>| {
            source
                .and_then(|source| patched.get(&source.to_path_buf().ok()?))
                .map_or_else(Vec::new, |fields| fields.to_vec())
        };
        let mut entries: Vec<NewPreparedEntry> = review
            .entries
            .iter()
            .map(|entry| NewPreparedEntry {
                member_key: entry.member_key,
                asset_id: entry.asset_id,
                master_id: entry.master_id,
                input: entry.input,
                kind: entry.kind,
                path: entry.path.clone(),
                source: Some(entry.source.clone()),
                size_bytes: entry.size_bytes,
                basis: basis_of(Some(&entry.source)),
                header_changes: patch_of(Some(&entry.source)),
                blocked: None,
            })
            .collect();
        entries.extend(review.blocked.iter().map(|blocked| NewPreparedEntry {
            member_key: blocked.member_key,
            asset_id: None,
            master_id: None,
            input: blocked.input,
            kind: entry_kind(review.mode, review.link),
            path: blocked.path.clone().unwrap_or_else(|| location.folder.clone()),
            source: blocked.source.clone(),
            size_bytes: blocked.size_bytes,
            basis: basis_of(blocked.source.as_ref()),
            header_changes: patch_of(blocked.source.as_ref()),
            blocked: Some(blocked.reason.clone()),
        }));
        let input = NewPreparation {
            view_id: view,
            n: review.preparation_number,
            membership_revision,
            profile_id: review.profile.id,
            mode: review.mode,
            link: review.link,
            output: location.output.clone(),
            folder: location.folder.clone(),
            results_folder: location.results.clone(),
            entries,
        };
        let record = match self.catalog().start_preparation(&input).await {
            Ok(record) => record,
            Err(error) => {
                blocking(move || {
                    created.remove();
                    Ok(())
                })
                .await?;
                return Err(error);
            }
        };
        self.run_preparation(record, &anchors, control).await
    }

    /// Retry a Partial or Paused revision in its own folder (PREP-AC-14): an
    /// entry is prepared only when its source matches a fresh snapshot and,
    /// once written, its entry re-reads to match.
    ///
    /// # Errors
    /// `InvalidInput` as [`persistence_library::Catalog::resume_preparation`];
    /// catalog errors. A failure after it resumed ends it Failed.
    pub async fn retry_preparation(
        &self,
        id: Uuid,
        control: &dyn PrepareControl,
    ) -> Result<PreparationOutcome, LibraryError> {
        let record = self.catalog().resume_preparation(id).await?;
        let revision = &record.revision;
        let resolved = async {
            let basis =
                self.catalog().view_membership(revision.view_id, Membership::Committed).await?;
            let calibration =
                self.calibration_handoff(revision.view_id, revision.membership_revision).await?;
            let roots = self.input_roots(&basis, &calibration).await?;
            let ((_, anchors), _, _) = resolve_inputs(&basis, &calibration, &roots)?;
            Ok::<_, LibraryError>(anchors)
        }
        .await;
        match resolved {
            Ok(anchors) => self.run_preparation(record, &anchors, control).await,
            Err(error) => {
                self.catalog()
                    .finish_preparation(id, PreparationState::Failed, Some(&error.to_string()))
                    .await?;
                Err(error)
            }
        }
    }

    /// The outcome of a revision: prepared, blocked, pending and drifted
    /// entries and what it offers. Running reads as progress.
    ///
    /// # Errors
    /// `NotFound` for an unknown revision.
    pub async fn preparation_outcome(&self, id: Uuid) -> Result<PreparationOutcome, LibraryError> {
        let record = self.catalog().preparation(id).await?;
        let stage = self.catalog().view(record.revision.view_id).await?.view.stage;
        Ok(outcome(record, stage))
    }

    /// The run blocker preparation feeds (Home's blocked run): the run's
    /// latest revision Failed, Partial, or with entries Open found changed.
    ///
    /// # Errors
    /// Catalog errors.
    pub async fn preparation_blocker(
        &self,
        view: Uuid,
    ) -> Result<Option<PreparationFailed>, LibraryError> {
        let revisions = self.catalog().view_preparations(view).await?;
        let Some(latest) = revisions.last() else {
            return Ok(None);
        };
        Ok(self.preparation_outcome(latest.id).await?.failed_blocker())
    }

    /// Open (PREP-FR-10): immediately before the launch, re-verify under D19
    /// every byte the application will read; drift refuses the launch and
    /// names the changed entries. A missing executable offers Choose
    /// application or Reveal run folder. Launching never marks the run
    /// Complete, and the application exiting changes nothing.
    ///
    /// # Errors
    /// `InvalidInput` for a revision that is not Prepared or a run in the
    /// Trash; `NotFound` for an unknown revision; catalog errors.
    pub async fn open_preparation(&self, id: Uuid) -> Result<OpenOutcome, LibraryError> {
        let record = self.catalog().preparation(id).await?;
        if record.revision.state != PreparationState::Prepared {
            return Err(invalid(format!(
                "preparation '{}' is {}; only a verified Prepared revision opens",
                record.revision.name(),
                record.revision.state
            )));
        }
        let view = self.catalog().view(record.revision.view_id).await?.view;
        if view.trashed_at.is_some() {
            return Err(invalid(format!(
                "run {} is in the Project's Trash; restore it first",
                view.id
            )));
        }
        let entries = record.entries.clone();
        let drifted = blocking(move || Ok(reverify_all(&entries))).await?;
        let checked = self.catalog().record_open_check(id, &drifted).await?;
        if !drifted.is_empty() {
            let drifted =
                checked.entries.into_iter().filter(|e| e.state == EntryState::Drifted).collect();
            return Ok(OpenOutcome::Refused { drifted });
        }
        let profile = self.catalog().profile(checked.revision.profile_id).await?;
        let folder = checked.revision.folder.clone();
        let Some(executable) = profile.executable.as_ref() else {
            return Ok(OpenOutcome::ChooseApplication {
                folder,
                detail: format!("profile '{}' has no application configured", profile.name),
            });
        };
        let executable = executable.to_path_buf()?;
        let args = launch_args(&profile, &checked)?;
        let cwd = folder.to_path_buf()?;
        blocking(move || Ok(launch(&executable, &args, &cwd, folder))).await
    }

    #[allow(clippy::too_many_lines)]
    async fn plan_preparation(
        &self,
        view_id: Uuid,
        request: &PrepareRequest,
    ) -> Result<Planned, LibraryError> {
        let catalog = self.catalog();
        let record = catalog.view(view_id).await?;
        let view = &record.view;
        if view.trashed_at.is_some() {
            return Err(invalid(format!(
                "run {} is in the Project's Trash; restore it first",
                view.id
            )));
        }
        if view.group_id.is_some() {
            return Err(invalid(format!(
                "run {} is a panel run; it is prepared with its run group",
                view.id
            )));
        }
        let header = record.revision.as_ref().ok_or_else(|| {
            invalid(format!("run {} has no saved membership; save it before preparing", view.id))
        })?;
        let project = catalog.project(view.project_id).await?;
        let subject_name = project
            .subjects
            .iter()
            .find(|subject| subject.id == view.subject_id)
            .map(|subject| subject.name.clone().unwrap_or_else(|| subject.designation.clone()))
            .unwrap_or_default();
        let profile = catalog.profile(request.profile_id).await?;
        let basis = catalog.view_membership(view.id, Membership::Committed).await?;
        let calibration = self.calibration_handoff(view.id, view.revision).await?;
        let revisions = catalog.view_preparations(view.id).await?;
        let n = revisions.iter().map(|revision| revision.n).max().unwrap_or(0) + 1;
        let output = match &request.output {
            Some(output) => Some(output.clone()),
            None => catalog.last_preparation_output().await?,
        };
        let results = catalog.view_results_folder(view.id).await?;
        let recorded = catalog.recorded_preparation_folders().await?;
        let roots = self.input_roots(&basis, &calibration).await?;
        let ((mut inputs, anchors), mut blocked, excluded) =
            resolve_inputs(&basis, &calibration, &roots)?;
        let corrections = self.plan_corrections(&inputs, request).await?;
        inputs.retain(|input| {
            !corrections.iter().any(|correction| {
                correction.choice == Some(CorrectionChoice::Exclude)
                    && input.asset_id == Some(correction.asset_id)
            })
        });
        let link =
            (request.mode == InputMode::LinkedView).then(|| request.link.unwrap_or_default());
        let mut refusals = Vec::new();
        if request.link.is_some() && request.mode != InputMode::LinkedView {
            refusals.push("a link kind applies to Linked View only".to_owned());
        }
        if view.completion == crate::RunCompletion::Complete {
            refusals.push(format!("run {} is Complete; reopen it before preparing", view.id));
        }
        if let Some(refusal) = mode_refusal(&profile, request.mode) {
            refusals.push(refusal);
        }
        refusals.extend(correction_refusals(&corrections));
        let disk = DiskPlan {
            output: output.as_ref().map(NativePath::to_path_buf).transpose()?,
            project: project.name.clone(),
            run: header.name.clone(),
            n,
            folder_name: request.folder_name.clone(),
            results,
            recorded,
            inputs,
            kind: entry_kind(request.mode, link),
            folder_handoff: request.mode == InputMode::DirectSource
                && !profile.capability_evidence.input_list,
        };
        let disk = blocking(move || check_disk(&disk)).await?;
        blocked.extend(disk.blocked);
        refusals.extend(disk.refusals);
        if let Some(refusal) = link.and_then(|link| disk.links.refusal(link)) {
            refusals.push(refusal);
        }
        if let Some(refusal) = location_refusal(&disk.check) {
            refusals.push(refusal);
        }
        if disk.entries.is_empty() {
            refusals.push("no input of the run can be prepared as reviewed".to_owned());
        }
        let created = disk.entries.iter().filter(|entry| entry.kind.created()).count();
        let footprint_bytes = disk
            .entries
            .iter()
            .filter(|entry| entry.kind == PreparedEntryKind::Copy)
            .map(|entry| entry.size_bytes)
            .sum();
        let review = PreparationReview {
            view_id: view.id,
            membership_revision: view.revision,
            draft_unsaved: record.draft.is_some(),
            project_name: project.name.clone(),
            subject_name,
            run_name: header.name.clone(),
            verified_profile: profile.verified(),
            unproven: profile.capability_evidence.unproven(),
            suggested_mode: suggested_mode(&profile, &disk.links),
            mode: request.mode,
            link,
            modes: mode_options(&profile, &disk.links),
            preparation_number: n,
            location: disk.location,
            location_check: disk.check,
            entries: disk.entries,
            blocked,
            excluded,
            corrections,
            calibration,
            operations: u64::try_from(created).unwrap_or(u64::MAX),
            footprint_bytes,
            free_bytes: disk.free_bytes,
            writability: disk.writability,
            refusals,
            profile,
        };
        Ok(Planned { review, anchors })
    }

    /// Every location root the membership and calibration inputs live on.
    async fn input_roots(
        &self,
        basis: &MembershipBasis,
        calibration: &CalibrationHandoff,
    ) -> Result<HashMap<Uuid, PathBuf>, LibraryError> {
        let ids: BTreeSet<Uuid> = basis
            .members
            .iter()
            .flat_map(|member| member.copies.iter().map(|copy| copy.location_id))
            .chain(
                calibration
                    .assignments
                    .iter()
                    .flat_map(|assignment| assignment.inputs.iter().map(|file| file.location_id)),
            )
            .collect();
        let mut roots = HashMap::new();
        for id in ids {
            roots.insert(id, self.catalog().location(id).await?.path.to_path_buf()?);
        }
        Ok(roots)
    }

    /// Every input a confirmed catalog correction changed, as review shows
    /// it (PREP-FR-03, PREP-AC-06). Read-only: a corrected FITS source's
    /// header is read to tell whether a patched Copy or Clone can carry it.
    async fn plan_corrections(
        &self,
        inputs: &[SourceInput],
        request: &PrepareRequest,
    ) -> Result<Vec<PlannedCorrection>, LibraryError> {
        let corrected: BTreeSet<Uuid> =
            self.catalog().corrected_asset_ids().await?.into_iter().collect();
        let mut found = Vec::new();
        for input in inputs {
            if let Some(asset_id) = input.asset_id.filter(|id| corrected.contains(id)) {
                found.push((input.clone(), self.catalog().asset(asset_id).await?));
            }
        }
        if found.is_empty() {
            return Ok(Vec::new());
        }
        let (mode, choices) = (request.mode, request.corrections.clone());
        blocking(move || {
            Ok(found
                .iter()
                .filter_map(|(input, asset)| {
                    plan_correction(input, asset, mode, choices.get(&asset.id).copied())
                })
                .collect())
        })
        .await
    }

    /// Settle every entry not yet prepared, re-verify every prepared one
    /// immediately before the end, and record the terminal state.
    async fn run_preparation(
        &self,
        record: PreparationRecord,
        anchors: &HashMap<PathBuf, Basis>,
        control: &dyn PrepareControl,
    ) -> Result<PreparationOutcome, LibraryError> {
        let id = record.revision.id;
        match self.settle_all(record, anchors, control).await {
            Ok(record) => {
                let stage = self.catalog().view(record.revision.view_id).await?.view.stage;
                Ok(outcome(record, stage))
            }
            Err(error) => {
                self.catalog()
                    .finish_preparation(id, PreparationState::Failed, Some(&error.to_string()))
                    .await?;
                Err(error)
            }
        }
    }

    async fn settle_all(
        &self,
        record: PreparationRecord,
        anchors: &HashMap<PathBuf, Basis>,
        control: &dyn PrepareControl,
    ) -> Result<PreparationRecord, LibraryError> {
        let revision = record.revision;
        let mut entries = record.entries;
        for entry in &mut entries {
            if entry.state == EntryState::Prepared || entry.source.is_none() {
                continue;
            }
            match control.step() {
                PrepareStep::Continue => {}
                PrepareStep::Cancel => {
                    return self
                        .catalog()
                        .finish_preparation(revision.id, PreparationState::Canceled, None)
                        .await;
                }
                PrepareStep::Pause => {
                    return self
                        .catalog()
                        .finish_preparation(revision.id, PreparationState::Paused, None)
                        .await;
                }
            }
            *entry = self.settle_entry(&revision, entry, anchors, control).await?;
        }
        // Immediately before terminal success, every entry must still be in
        // the selection as reviewed, and every source and entry must still
        // match its snapshot (D19).
        for entry in entries.iter().filter(|entry| entry.state == EntryState::Prepared) {
            let checked = entry.clone();
            let drift = match still_selected(entry, anchors) {
                Err(reason) => reason,
                Ok(()) => match blocking(move || Ok(reverify(&checked))).await? {
                    Err(drift) => drift,
                    Ok(()) => continue,
                },
            };
            let update = EntryUpdate {
                state: EntryState::Blocked,
                source_evidence: entry.source_evidence.clone(),
                entry_identity: entry.entry_identity.clone(),
                written: entry.written.clone(),
                reason: Some(drift),
            };
            let settled =
                self.catalog().settle_prepared_entry(revision.id, entry.seq, &update).await?;
            control.settled(&settled);
        }
        let record = self.catalog().preparation(revision.id).await?;
        let prepared = record.entries.iter().filter(|e| e.state == EntryState::Prepared).count();
        let state = if prepared == record.entries.len() {
            PreparationState::Prepared
        } else if prepared > 0 {
            PreparationState::Partial
        } else {
            PreparationState::Failed
        };
        self.catalog().finish_preparation(revision.id, state, None).await
    }

    /// Snapshot one source and write its entry by the revision's mode.
    #[allow(clippy::too_many_lines)]
    async fn settle_entry(
        &self,
        revision: &PreparationRevision,
        entry: &PreparedEntry,
        anchors: &HashMap<PathBuf, Basis>,
        control: &dyn PrepareControl,
    ) -> Result<PreparedEntry, LibraryError> {
        let source = entry
            .source
            .as_ref()
            .ok_or_else(|| invalid("an entry without a source stays blocked"))?
            .to_path_buf()?;
        if let Err(reason) = still_selected(entry, anchors) {
            let (identity, written) = (entry.entry_identity.clone(), entry.written.clone());
            return self
                .record(revision, entry, None, identity, written, Err(reason), control)
                .await;
        }
        // The basis Prepare recorded, never one rebuilt for this attempt.
        let basis = entry.basis.clone();
        let previous = entry.source_evidence.clone();
        let snapshot =
            blocking(move || Ok(snapshot(&source, basis.as_ref(), previous.as_ref()))).await?;
        let mut written = entry.written.clone();
        let result = match snapshot {
            Err(reason) => Err((None, reason)),
            Ok(snapshot) => {
                let written_entry = match (&entry.entry_identity, entry.kind) {
                    // Written by an earlier attempt: it must re-read to match.
                    (Some(identity), kind) => {
                        let (checked, identity) = (snapshot.clone(), identity.clone());
                        let changes = entry.header_changes.clone();
                        blocking(move || {
                            Ok(verify_entry(kind, &checked, Some(&identity), &changes)
                                .map(|()| Some(identity)))
                        })
                        .await?
                    }
                    (None, PreparedEntryKind::Copy) => {
                        let destination = TransferDestination {
                            root: revision.folder.clone(),
                            relative: relative_to(&entry.path, &revision.folder)?,
                        };
                        if written.is_none() {
                            let (operation, seq, target) =
                                (revision.id, entry.seq, destination.clone());
                            let begun =
                                blocking(move || Ok(transfer::begin(operation, seq, &target)))
                                    .await?;
                            match begun {
                                Ok(copy) => {
                                    let update = EntryUpdate {
                                        state: EntryState::Pending,
                                        source_evidence: Some(snapshot.clone()),
                                        entry_identity: None,
                                        written: Some(copy.clone()),
                                        reason: None,
                                    };
                                    self.catalog()
                                        .settle_prepared_entry(revision.id, entry.seq, &update)
                                        .await?;
                                    written = Some(copy);
                                }
                                Err(reason) => {
                                    return self
                                        .record(
                                            revision,
                                            entry,
                                            Some(snapshot),
                                            None,
                                            None,
                                            Err(reason),
                                            control,
                                        )
                                        .await;
                                }
                            }
                        }
                        let (checked, copy) = (snapshot.clone(), written.clone());
                        let changes = entry.header_changes.clone();
                        blocking(move || {
                            Ok(copy_entry(&checked, &destination, copy.as_ref(), &changes))
                        })
                        .await?
                    }
                    (None, PreparedEntryKind::DirectSource) => Ok(None),
                    (None, kind) => {
                        let (checked, path) = (snapshot.clone(), entry.path.to_path_buf()?);
                        let changes = entry.header_changes.clone();
                        blocking(move || {
                            Ok(link_or_clone(kind, &checked, &path, &changes).map(Some))
                        })
                        .await?
                    }
                };
                match written_entry {
                    Ok(identity) => Ok((snapshot, identity)),
                    Err(reason) => Err((Some(snapshot), reason)),
                }
            }
        };
        match result {
            Ok((snapshot, identity)) => {
                self.record(revision, entry, Some(snapshot), identity, written, Ok(()), control)
                    .await
            }
            Err((snapshot, reason)) => {
                let identity = entry.entry_identity.clone();
                self.record(revision, entry, snapshot, identity, written, Err(reason), control)
                    .await
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn record(
        &self,
        revision: &PreparationRevision,
        entry: &PreparedEntry,
        snapshot: Option<EntryEvidence>,
        identity: Option<EntryEvidence>,
        written: Option<WrittenCopy>,
        settled: Result<(), ItemReason>,
        control: &dyn PrepareControl,
    ) -> Result<PreparedEntry, LibraryError> {
        let (state, reason) = match settled {
            Ok(()) => (EntryState::Prepared, None),
            Err(reason) => (EntryState::Blocked, Some(reason)),
        };
        let update = EntryUpdate {
            state,
            source_evidence: snapshot.or_else(|| entry.source_evidence.clone()),
            entry_identity: identity,
            written,
            reason,
        };
        let settled = self.catalog().settle_prepared_entry(revision.id, entry.seq, &update).await?;
        control.settled(&settled);
        Ok(settled)
    }
}

fn outcome(record: PreparationRecord, stage: RunStage) -> PreparationOutcome {
    let mut prepared = Vec::new();
    let mut blocked = Vec::new();
    let mut pending = Vec::new();
    let mut drifted = Vec::new();
    for entry in record.entries {
        match entry.state {
            EntryState::Prepared => prepared.push(entry),
            EntryState::Blocked => blocked.push(entry),
            EntryState::Pending => pending.push(entry),
            EntryState::Drifted => drifted.push(entry),
        }
    }
    let offers = PreparationOutcome::offers_for(record.revision.state, !drifted.is_empty());
    PreparationOutcome {
        revision: record.revision,
        stage,
        prepared,
        blocked,
        pending,
        drifted,
        offers,
    }
}

const fn entry_kind(mode: InputMode, link: Option<LinkKind>) -> PreparedEntryKind {
    match (mode, link) {
        (InputMode::LinkedView, Some(LinkKind::Hardlink)) => PreparedEntryKind::Hardlink,
        (InputMode::LinkedView, _) => PreparedEntryKind::Symlink,
        (InputMode::DirectSource, _) => PreparedEntryKind::DirectSource,
        (InputMode::Copy, _) => PreparedEntryKind::Copy,
        (InputMode::Clone, _) => PreparedEntryKind::Clone,
    }
}

/// Why `profile` refuses `mode` (D04, PREP-FR-04/05).
fn mode_refusal(profile: &Profile, mode: InputMode) -> Option<String> {
    match mode {
        InputMode::LinkedView | InputMode::DirectSource if !profile.reads_only() => {
            let name = if mode == InputMode::LinkedView { "Linked View" } else { "Direct source" };
            Some(format!(
                "profile '{}' has {} input behaviour: {name} would hand it library originals, an \
                 input-write risk; choose an isolated Copy{}",
                profile.name,
                profile.capability_evidence.input_behavior,
                if CLONE_SUPPORTED { " or Clone" } else { "" }
            ))
        }
        InputMode::DirectSource
            if profile.capability_evidence.input_list
                && !profile.args.iter().any(|arg| arg == "{inputs}") =>
        {
            Some(format!(
                "profile '{}' passes no {{inputs}} argument, so Direct source has no input list",
                profile.name
            ))
        }
        InputMode::Clone if !CLONE_SUPPORTED => {
            Some("this platform makes no verified clone; choose Copy".to_owned())
        }
        _ => None,
    }
}

/// Every input mode with its semantics and refusal for `profile` and the
/// link support probed at the destination (PREP-AC-03/08).
fn mode_options(profile: &Profile, links: &LinkSupport) -> Vec<ModeOption> {
    let options = [
        (
            InputMode::LinkedView,
            Some(LinkKind::Symlink),
            "Symbolic links to the library originals: no extra storage; the application reads \
             the originals",
        ),
        (
            InputMode::LinkedView,
            Some(LinkKind::Hardlink),
            "Hardlinks to the library originals: an explicit choice; same volume only, no extra \
             storage, and a write through the link changes the original",
        ),
        (
            InputMode::DirectSource,
            None,
            "The exact original paths through the application's input list; nothing is created",
        ),
        (InputMode::Copy, None, "Isolated verified copies: full storage; originals untouched"),
        (
            InputMode::Clone,
            None,
            "Isolated copy-on-write clones on volumes that support them: storage shared until \
             changed; a volume that refuses blocks the item",
        ),
    ];
    options
        .into_iter()
        .map(|(mode, link, semantics)| ModeOption {
            mode,
            link,
            semantics: semantics.to_owned(),
            refusal: mode_refusal(profile, mode)
                .or_else(|| link.and_then(|link| links.refusal(link))),
        })
        .collect()
}

/// The mode review suggests (PREP-FR-04): Linked View's symlinks for a
/// verified read-only profile whose destination holds them, else an
/// isolated Copy. Hardlinks are never suggested: they need an explicit
/// choice (PREP-AC-08).
fn suggested_mode(profile: &Profile, links: &LinkSupport) -> InputMode {
    if profile.verified() && profile.reads_only() && links.symlink.is_none() {
        InputMode::LinkedView
    } else {
        InputMode::Copy
    }
}

/// One corrected input as review shows it (PREP-FR-03, PREP-AC-06): each
/// field's catalog value next to the header value, every choice with its
/// refusal, and whether the application reads the catalog values. Only an
/// isolated Copy or Clone of a FITS source is patched; links and
/// Direct-source originals never are, so there the correction is not
/// delivered. `None` when no field differs from the header.
fn plan_correction(
    input: &SourceInput,
    asset: &Asset,
    mode: InputMode,
    choice: Option<CorrectionChoice>,
) -> Option<PlannedCorrection> {
    let fields = header_patch::corrected_fields(&asset.observed, &asset.effective);
    if fields.is_empty() {
        return None;
    }
    let source = input.source.display();
    let patch = match mode {
        InputMode::LinkedView | InputMode::DirectSource => Some(format!(
            "{source}: links and Direct-source originals are never patched, so the application \
             reads its header; switch to Copy or Clone to deliver the correction"
        )),
        InputMode::Copy | InputMode::Clone if asset.format != ImageFormat::Fits => {
            Some(format!("{source}: PlateVault patches FITS headers only"))
        }
        InputMode::Copy | InputMode::Clone => header_patch::cards_for(&input.source, &fields)
            .err()
            .map(|detail| format!("{source} cannot be patched: {detail}")),
    };
    let options =
        [CorrectionChoice::Patch, CorrectionChoice::AcceptSource, CorrectionChoice::Exclude]
            .into_iter()
            .map(|offered| CorrectionOption {
                choice: offered,
                refusal: if offered == CorrectionChoice::Patch { patch.clone() } else { None },
            })
            .collect();
    Some(PlannedCorrection {
        member_key: input.member_key,
        asset_id: asset.id,
        input: input.input,
        source: NativePath::from_path(&input.source),
        fields,
        options,
        choice,
        delivered: choice == Some(CorrectionChoice::Patch) && patch.is_none(),
    })
}

/// Why Prepare is refused for the corrections as chosen (PREP-FR-03): a
/// correction is never handed over undecided, since the application would
/// read the original value, and a refused choice is named.
fn correction_refusals(corrections: &[PlannedCorrection]) -> Vec<String> {
    corrections
        .iter()
        .filter_map(|correction| match correction.choice {
            None => {
                let fields: Vec<String> = correction
                    .fields
                    .iter()
                    .map(|field| {
                        format!(
                            "{} '{}' (header '{}')",
                            field.field,
                            field.catalog.as_deref().unwrap_or("unknown"),
                            field.header.as_deref().unwrap_or("none")
                        )
                    })
                    .collect();
                Some(format!(
                    "{}: the catalog corrects {} and the application reads the header; choose a \
                     patched Copy or Clone, the source value or excluding the input",
                    correction.source.display(),
                    fields.join(", ")
                ))
            }
            Some(choice) => correction
                .options
                .iter()
                .find(|option| option.choice == choice)
                .and_then(|option| option.refusal.clone()),
        })
        .collect()
}

/// Whether the planned parent can hold each link kind (PREP-AC-03/08,
/// PREP-FR-04): `None` once a probe link of that kind was created there,
/// else why not. Nothing is refused while no parent is ready to probe.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct LinkSupport {
    symlink: Option<String>,
    hardlink: Option<String>,
}

impl LinkSupport {
    fn refusal(&self, link: LinkKind) -> Option<String> {
        let (refused, name) = match link {
            LinkKind::Symlink => (&self.symlink, "symbolic links"),
            LinkKind::Hardlink => (&self.hardlink, "hardlinks"),
        };
        refused.as_ref().map(|detail| {
            format!(
                "Linked View with {name} is refused: {detail}; choose Copy{}",
                if CLONE_SUPPORTED { " or Clone" } else { "" }
            )
        })
    }
}

/// Probe link support in `folder`, the planned project folder or its
/// parent: create a probe file, then a symlink and a hardlink to it, each
/// under a fresh hidden name, and remove exactly what was created. exFAT
/// and FAT volumes, and Windows without the symlink privilege, refuse them.
fn probe_links(folder: &Path) -> LinkSupport {
    let name = format!(".platevault-link-probe-{}", Uuid::new_v4().simple());
    let target = folder.join(&name);
    if let Err(error) = fs::OpenOptions::new().write(true).create_new(true).open(&target) {
        let detail = format!("links cannot be probed in {}: {error}", folder.display());
        return LinkSupport { symlink: Some(detail.clone()), hardlink: Some(detail) };
    }
    let probe = |kind: &str, link: fn(&Path, &Path) -> std::io::Result<()>| {
        let path = folder.join(format!("{name}.{kind}"));
        match link(&target, &path) {
            Ok(()) => {
                let _ = fs::remove_file(&path);
                None
            }
            Err(error) => Some(format!("{} cannot hold one ({error})", folder.display())),
        }
    };
    let support = LinkSupport {
        symlink: probe("symlink", fs_pathsafe::create_symlink),
        hardlink: probe("hardlink", |target, path| fs::hard_link(target, path)),
    };
    let _ = fs::remove_file(&target);
    support
}

fn location_refusal(check: &LocationCheck) -> Option<String> {
    match check {
        LocationCheck::Ready => None,
        LocationCheck::ChooseParent => {
            Some("choose a parent folder: there is no assumed root".to_owned())
        }
        LocationCheck::ParentUnavailable { detail } => {
            Some(format!("the parent folder is unavailable ({detail}); choose another explicitly"))
        }
        LocationCheck::InsidePreparedFolder { folder } => Some(format!(
            "the parent folder lies inside the prepared folder {}; choose a parent outside it",
            folder.display()
        )),
        LocationCheck::FolderExists { folder } => Some(format!(
            "{} already exists and is never reused; choose another name or location",
            folder.display()
        )),
        LocationCheck::NotWritable { detail } => {
            Some(format!("the parent folder cannot take new folders: {detail}"))
        }
    }
}

type Resolved = ((Vec<SourceInput>, HashMap<PathBuf, Basis>), Vec<BlockedInput>, u64);

/// The committed membership's included members and every calibration input
/// of an automatic, accepted or excepted assignment, each with its basis;
/// unresolved members and requirements are blocked.
fn resolve_inputs(
    basis: &MembershipBasis,
    calibration: &CalibrationHandoff,
    roots: &HashMap<Uuid, PathBuf>,
) -> Result<Resolved, LibraryError> {
    let root = |id: &Uuid| {
        roots
            .get(id)
            .ok_or_else(|| LibraryError::PersistenceFailure(format!("location {id} is unknown")))
    };
    let mut inputs = Vec::new();
    let mut anchors = HashMap::new();
    let mut blocked = Vec::new();
    let mut excluded = 0;
    for member in &basis.members {
        if member.member.state != MemberState::Included {
            excluded += 1;
            continue;
        }
        let key = member.member.member_key;
        let available =
            member.copies.iter().find(|copy| copy.availability == Availability::Available);
        let Some(copy) = available else {
            blocked.push(BlockedInput {
                member_key: Some(key),
                input: PreparedInput::Light,
                source: None,
                path: None,
                size_bytes: 0,
                reason: reason(
                    ReasonCode::SourceUnavailable,
                    format!("member {key} has no available copy; it stays unresolved"),
                ),
            });
            continue;
        };
        let recorded = member
            .member
            .copies
            .iter()
            .find(|recorded| recorded.asset_id == copy.asset_id)
            .map_or_else(
                || copy.current.fingerprint.clone(),
                |recorded| recorded.fingerprint.clone(),
            );
        let source = root(&copy.location_id)?.join(copy.path.relative_path()?);
        anchors.insert(
            source.clone(),
            Basis { fingerprint: recorded, origin: BasisOrigin::Membership },
        );
        inputs.push(SourceInput {
            member_key: Some(key),
            asset_id: Some(copy.asset_id),
            master_id: None,
            input: PreparedInput::Light,
            source,
            size_bytes: copy.current.fingerprint.size_bytes,
        });
    }
    for assignment in &calibration.assignments {
        for file in &assignment.inputs {
            let source = root(&file.location_id)?.join(file.relative_path.relative_path()?);
            if anchors.contains_key(&source) {
                continue;
            }
            anchors.insert(
                source.clone(),
                Basis {
                    fingerprint: file.fingerprint.clone(),
                    origin: BasisOrigin::CalibrationAssignment,
                },
            );
            inputs.push(SourceInput {
                member_key: None,
                asset_id: file.asset_id,
                master_id: file.master_id,
                input: assignment.kind.into(),
                source,
                size_bytes: file.fingerprint.size_bytes,
            });
        }
    }
    for unresolved in &calibration.unresolved {
        blocked.push(BlockedInput {
            member_key: None,
            input: unresolved.kind.into(),
            source: None,
            path: None,
            size_bytes: 0,
            reason: reason(
                ReasonCode::SourceUnavailable,
                format!(
                    "the {} requirement of light group '{}' is unresolved ({:?})",
                    unresolved.kind.as_str(),
                    unresolved.light_group.channel.as_deref().unwrap_or("unknown channel"),
                    unresolved.reason
                ),
            ),
        });
    }
    Ok(((inputs, anchors), blocked, excluded))
}

/// What review checks on disk, off the async runtime.
struct DiskPlan {
    output: Option<PathBuf>,
    project: String,
    run: String,
    n: u32,
    folder_name: Option<String>,
    results: Option<NativePath>,
    recorded: RecordedFolders,
    inputs: Vec<SourceInput>,
    kind: PreparedEntryKind,
    folder_handoff: bool,
}

struct DiskCheck {
    location: Option<RunLocation>,
    check: LocationCheck,
    entries: Vec<PlannedEntry>,
    blocked: Vec<BlockedInput>,
    refusals: Vec<String>,
    free_bytes: Option<u64>,
    writability: Option<Writability>,
    links: LinkSupport,
}

fn check_disk(plan: &DiskPlan) -> Result<DiskCheck, LibraryError> {
    let (location, check, writability, free_bytes) = check_location(plan)?;
    let mut entries = Vec::new();
    let mut blocked = Vec::new();
    let mut refusals = Vec::new();
    let mut names: HashMap<(PathBuf, OsString), usize> = HashMap::new();
    if let Some(location) = &location {
        for input in &plan.inputs {
            if let Some(name) = input.source.file_name() {
                *names.entry((subfolder(input.input), name.to_owned())).or_default() += 1;
            }
        }
        let folder = location.folder.to_path_buf()?;
        let output = location.output.to_path_buf()?;
        for input in &plan.inputs {
            let path = if plan.kind == PreparedEntryKind::DirectSource {
                input.source.clone()
            } else {
                folder.join(subfolder(input.input)).join(entry_name(input, &names))
            };
            if let Err(reason) = source_present(&input.source, plan.kind, &output) {
                blocked.push(BlockedInput {
                    member_key: input.member_key,
                    input: input.input,
                    source: Some(NativePath::from_path(&input.source)),
                    path: Some(NativePath::from_path(&path)),
                    size_bytes: input.size_bytes,
                    reason,
                });
                continue;
            }
            entries.push(PlannedEntry {
                member_key: input.member_key,
                asset_id: input.asset_id,
                master_id: input.master_id,
                input: input.input,
                kind: plan.kind,
                source: NativePath::from_path(&input.source),
                path: NativePath::from_path(&path),
                size_bytes: input.size_bytes,
            });
        }
    }
    if plan.folder_handoff {
        refusals.extend(folder_handoff_refusal(&plan.inputs));
    }
    let links = match (&location, &check) {
        (Some(location), LocationCheck::Ready | LocationCheck::FolderExists { .. }) => {
            probe_links(&probe_folder(location)?)
        }
        _ => LinkSupport::default(),
    };
    Ok(DiskCheck { location, check, entries, blocked, refusals, free_bytes, writability, links })
}

type LocationRead = (Option<RunLocation>, LocationCheck, Option<Writability>, Option<u64>);

fn check_location(plan: &DiskPlan) -> Result<LocationRead, LibraryError> {
    let Some(output) = &plan.output else {
        return Ok((None, LocationCheck::ChooseParent, None, None));
    };
    let unavailable =
        |detail: String| Ok((None, LocationCheck::ParentUnavailable { detail }, None, None));
    match fs::symlink_metadata(output) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return unavailable(format!("{} is not a real folder", output.display())),
        Err(error) => return unavailable(format!("{}: {error}", output.display())),
    }
    // The chosen parent is what the revision records and Open hands the
    // application; its canonical form only answers containment. On Windows
    // `fs::canonicalize` returns `\\?\` paths other applications may refuse.
    if !output.is_absolute() {
        return unavailable(format!("{} is not an absolute path", output.display()));
    }
    let canonical = match fs::canonicalize(output) {
        Ok(path) => path,
        Err(error) => return unavailable(format!("{}: {error}", output.display())),
    };
    for recorded in plan.recorded.prepared.iter().chain(&plan.recorded.results) {
        let path = recorded.to_path_buf()?;
        let path = fs::canonicalize(&path).unwrap_or(path);
        if layout::inside(&canonical, &path) {
            let check = LocationCheck::InsidePreparedFolder { folder: recorded.clone() };
            return Ok((None, check, None, None));
        }
    }
    let output = output.clone();
    let location = layout::run_location(
        &output,
        &plan.project,
        &plan.run,
        plan.n,
        plan.folder_name.as_deref(),
        plan.results.as_ref(),
    )?;
    let folder = location.folder.to_path_buf()?;
    let results = location.results.to_path_buf()?;
    let project = folder.parent().unwrap_or(&output).to_path_buf();
    let free_bytes = fs4::available_space(&output).ok();
    let writable_root = match fs::symlink_metadata(&project) {
        Ok(metadata)
            if metadata.is_dir() && !fs_pathsafe::is_link_or_junction_metadata(&metadata) =>
        {
            project
        }
        Ok(_) => {
            let detail = format!("{} is not a real folder", project.display());
            return Ok((
                Some(location),
                LocationCheck::ParentUnavailable { detail },
                None,
                free_bytes,
            ));
        }
        Err(_) => output,
    };
    let writability = crate::import::writability(&writable_root);
    // A recorded folder collides even when it is missing on disk: the
    // catalog never records one folder twice (PREP-FR-06).
    let taken = |path: &Path, recorded: &[NativePath]| {
        fs::symlink_metadata(path).is_ok()
            || recorded
                .iter()
                .filter_map(|folder| folder.to_path_buf().ok())
                .any(|folder| same_place(&folder, path))
    };
    let check = if taken(&folder, &plan.recorded.prepared) {
        LocationCheck::FolderExists { folder: location.folder.clone() }
    } else if plan.results.is_none() && taken(&results, &plan.recorded.results) {
        LocationCheck::FolderExists { folder: location.results.clone() }
    } else if let Writability::NotWritable { detail } = &writability {
        LocationCheck::NotWritable { detail: detail.clone() }
    } else {
        LocationCheck::Ready
    };
    Ok((Some(location), check, Some(writability), free_bytes))
}

/// Whether two paths name one folder: equal as written, or once each one's
/// nearest existing ancestor is resolved, so a recorded folder missing on
/// disk is still found in another path form.
fn same_place(left: &Path, right: &Path) -> bool {
    left == right || resolved(left) == resolved(right)
}

fn resolved(path: &Path) -> PathBuf {
    if let Ok(path) = fs::canonicalize(path) {
        return path;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => resolved(parent).join(name),
        _ => path.to_path_buf(),
    }
}

/// Where review probes link support: the planned project folder once it
/// exists, else the chosen parent it will be made in.
fn probe_folder(location: &RunLocation) -> Result<PathBuf, LibraryError> {
    let output = location.output.to_path_buf()?;
    let project = location.folder.to_path_buf()?.parent().map(Path::to_path_buf);
    Ok(project
        .filter(|project| fs::symlink_metadata(project).is_ok_and(|metadata| metadata.is_dir()))
        .unwrap_or(output))
}

/// The folder below the run folder an input goes to.
fn subfolder(input: PreparedInput) -> PathBuf {
    match input {
        PreparedInput::Light => PathBuf::from("Lights"),
        PreparedInput::Dark => Path::new("Calibration").join("Darks"),
        PreparedInput::Flat => Path::new("Calibration").join("Flats"),
        PreparedInput::Bias => Path::new("Calibration").join("Bias"),
    }
}

/// The entry's file name: the source's, with its asset or master id when
/// another input of the same folder has the same name. A name never stands
/// in for a header (D04): the application still reads each file's own.
fn entry_name(input: &SourceInput, names: &HashMap<(PathBuf, OsString), usize>) -> OsString {
    let name = input.source.file_name().map(OsStr::to_owned).unwrap_or_default();
    if names.get(&(subfolder(input.input), name.clone())).copied().unwrap_or(0) <= 1 {
        return name;
    }
    let id =
        input.asset_id.or(input.master_id).map(|id| id.simple().to_string()).unwrap_or_default();
    let path = Path::new(&name);
    let mut unique = path.file_stem().map(OsStr::to_owned).unwrap_or_default();
    unique.push(format!("-{}", id.get(..8).unwrap_or(&id)));
    if let Some(extension) = path.extension() {
        unique.push(".");
        unique.push(extension);
    }
    unique
}

/// Source presence and, for a hardlink, eligibility (PREP-FR-04/08).
fn source_present(source: &Path, kind: PreparedEntryKind, output: &Path) -> Result<(), ItemReason> {
    let metadata = fs::symlink_metadata(source).map_err(|error| {
        reason(ReasonCode::SourceUnavailable, format!("{}: {error}", source.display()))
    })?;
    if fs_pathsafe::is_link_or_junction_metadata(&metadata) || !metadata.is_file() {
        return Err(reason(
            ReasonCode::SourceDrift,
            format!("{} is not a regular file; links are not followed", source.display()),
        ));
    }
    if kind == PreparedEntryKind::Hardlink {
        hardlink_eligible(source, &metadata, output)?;
    }
    Ok(())
}

#[cfg(unix)]
fn hardlink_eligible(
    source: &Path,
    metadata: &fs::Metadata,
    output: &Path,
) -> Result<(), ItemReason> {
    use std::os::unix::fs::MetadataExt;
    let ineligible = |detail: String| reason(ReasonCode::WriteFailed, detail);
    let folder = fs::metadata(output)
        .map_err(|error| ineligible(format!("{}: {error}", output.display())))?;
    if folder.dev() != metadata.dev() {
        return Err(ineligible(format!(
            "a hardlink needs the source's volume; {} is on another volume than {}",
            source.display(),
            output.display()
        )));
    }
    rustix::fs::access(source, rustix::fs::Access::READ_OK).map_err(|error| {
        ineligible(format!("{} cannot be read for a hardlink: {error}", source.display()))
    })
}

#[cfg(not(unix))]
fn hardlink_eligible(
    source: &Path,
    _metadata: &fs::Metadata,
    _output: &Path,
) -> Result<(), ItemReason> {
    Err(reason(
        ReasonCode::WriteFailed,
        format!(
            "hardlink eligibility of {} cannot be checked on this platform; choose another mode",
            source.display()
        ),
    ))
}

/// A Direct-source folder handoff is allowed only when every source folder
/// holds exactly the reviewed inputs (PREP-FR-05).
fn folder_handoff_refusal(inputs: &[SourceInput]) -> Vec<String> {
    let sources: BTreeSet<&Path> = inputs.iter().map(|input| input.source.as_path()).collect();
    let folders: BTreeSet<&Path> = sources.iter().filter_map(|source| source.parent()).collect();
    let mut refusals = Vec::new();
    for folder in folders {
        let others = fs::read_dir(folder).map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_ok_and(|kind| !kind.is_dir()))
                .filter(|entry| !sources.contains(entry.path().as_path()))
                .count()
        });
        match others {
            Ok(0) => {}
            Ok(count) => refusals.push(format!(
                "folder handoff refused: {} holds {count} files outside the reviewed membership; \
                 choose Linked View, Copy or Clone",
                folder.display()
            )),
            Err(error) => refusals.push(format!(
                "folder handoff refused: {} cannot be listed ({error})",
                folder.display()
            )),
        }
    }
    refusals
}

/// The folders Prepare created, so a refused record removes them again.
struct CreatedFolders {
    folders: Vec<PathBuf>,
}

impl CreatedFolders {
    /// Remove the empty folders this Prepare created, deepest first. A folder
    /// that holds anything stays.
    fn remove(self) {
        for folder in self.folders.iter().rev() {
            let _ = fs::remove_dir(folder);
        }
    }
}

/// Create the revision's new folder, its input subfolders and, on the first
/// revision, the Results folder. An existing folder is never reused.
fn create_folders(
    location: &RunLocation,
    subfolders: &BTreeSet<PathBuf>,
    results_recorded: bool,
) -> Result<CreatedFolders, LibraryError> {
    let folder = location.folder.to_path_buf()?;
    let results = location.results.to_path_buf()?;
    let output = location.output.to_path_buf()?;
    let project = folder.parent().unwrap_or(&output).to_path_buf();
    let mut created = CreatedFolders { folders: Vec::new() };
    let made = (|| {
        match fs::symlink_metadata(&project) {
            Ok(metadata)
                if metadata.is_dir() && !fs_pathsafe::is_link_or_junction_metadata(&metadata) => {}
            Ok(_) => {
                return Err(invalid(format!("{} is not a real folder", project.display())));
            }
            Err(_) => make_folder(&project, &mut created)?,
        }
        make_folder(&folder, &mut created)?;
        for sub in subfolders {
            let relative = sub
                .strip_prefix(&folder)
                .map_err(|_| invalid(format!("{} lies outside the run folder", sub.display())))?;
            let mut current = folder.clone();
            for part in relative.components() {
                current.push(part);
                if fs::symlink_metadata(&current).is_err() {
                    make_folder(&current, &mut created)?;
                }
            }
        }
        if !results_recorded || fs::symlink_metadata(&results).is_err() {
            make_folder(&results, &mut created)?;
        }
        Ok(())
    })();
    match made {
        Ok(()) => Ok(created),
        Err(error) => {
            created.remove();
            Err(error)
        }
    }
}

/// Create one new folder and sync its parent; an existing entry refuses.
fn make_folder(path: &Path, created: &mut CreatedFolders) -> Result<(), LibraryError> {
    match fs::create_dir(path) {
        Ok(()) => created.folders.push(path.to_path_buf()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(invalid(format!(
                "{} already exists and is never reused; choose another name or location",
                path.display()
            )));
        }
        Err(error) => return Err(LibraryError::from_io(path, &error)),
    }
    let parent = path.parent().unwrap_or(path);
    transfer::sync_folder(parent).map_err(|error| LibraryError::from_io(parent, &error))
}

fn relative_to(path: &NativePath, folder: &NativePath) -> Result<NativePath, LibraryError> {
    let path = path.to_path_buf()?;
    let folder = folder.to_path_buf()?;
    let relative = path
        .strip_prefix(&folder)
        .map_err(|_| invalid(format!("{} lies outside {}", path.display(), folder.display())))?;
    Ok(NativePath::from_path(relative))
}

/// An entry is prepared only while the run's current selection still holds
/// its source with the basis Prepare recorded (D19, PREP-FR-09). `anchors` is
/// the current membership and calibration handoff: a source it no longer
/// names, or names with another basis since review (a changed calibration
/// assignment, a moved copy), needs a new review.
fn still_selected(
    entry: &PreparedEntry,
    anchors: &HashMap<PathBuf, Basis>,
) -> Result<(), ItemReason> {
    let source = entry.source.as_ref().map(NativePath::display).unwrap_or_default();
    let current = entry.source.as_ref().and_then(|path| anchors.get(&path.to_path_buf().ok()?));
    match (&entry.basis, current) {
        (Some(recorded), Some(current)) if recorded == current => Ok(()),
        (Some(recorded), Some(_)) => Err(reason(
            ReasonCode::SourceDrift,
            format!(
                "{source}: {} changed since review, so it is no longer in the reviewed \
                 selection; review again",
                recorded.origin
            ),
        )),
        _ => Err(reason(
            ReasonCode::SourceDrift,
            format!("{source} is no longer in the reviewed selection; review again"),
        )),
    }
}

/// The source's snapshot (D19): its no-follow identity and SHA-256, which
/// must match its recorded basis and any earlier snapshot of this entry.
fn snapshot(
    source: &Path,
    basis: Option<&Basis>,
    previous: Option<&EntryEvidence>,
) -> Result<EntryEvidence, ItemReason> {
    let snapshot = observe_entry(source)
        .map_err(|error| reason(ReasonCode::SourceUnavailable, error.to_string()))?;
    if snapshot.kind != EntryKind::File {
        return Err(reason(
            ReasonCode::SourceDrift,
            format!("{} is a link, not the reviewed file", source.display()),
        ));
    }
    if let Some(basis) = basis {
        let recorded = &basis.fingerprint;
        let observed = &snapshot.fingerprint;
        let same_file = observed.identity.volume == recorded.identity.volume
            && (!recorded.identity.volume.file_ids_stable
                || observed.identity.file_id == recorded.identity.file_id);
        if !same_file
            || observed.size_bytes != recorded.size_bytes
            || observed.modified_ns != recorded.modified_ns
        {
            return Err(reason(
                ReasonCode::SourceDrift,
                format!("{} differs from {}", source.display(), basis.origin),
            ));
        }
        if recorded.content_sha256.as_ref().is_some_and(|sha| snapshot.sha256.as_ref() != Some(sha))
        {
            return Err(reason(
                ReasonCode::SourceDrift,
                format!(
                    "{} differs from the SHA-256 recorded for {}",
                    source.display(),
                    basis.origin
                ),
            ));
        }
    }
    if previous.is_some_and(|previous| previous.sha256 != snapshot.sha256) {
        return Err(reason(
            ReasonCode::SourceDrift,
            format!("{} no longer holds the bytes it was first prepared from", source.display()),
        ));
    }
    Ok(snapshot)
}

/// Copy through the verified transfer: write the recorded partial, install
/// without replacing anything and re-read it against the snapshot. A
/// patched copy then takes its reviewed header cards and re-reads to differ
/// from the snapshot only by them (PREP-FR-03/09).
fn copy_entry(
    snapshot: &EntryEvidence,
    destination: &TransferDestination,
    written: Option<&WrittenCopy>,
    changes: &[CorrectedField],
) -> Result<Option<EntryEvidence>, ItemReason> {
    let written = written.ok_or_else(|| {
        reason(ReasonCode::Interrupted, "the copy's partial file was never recorded")
    })?;
    transfer::write(snapshot, destination, written)?;
    let path = destination
        .root
        .to_path_buf()
        .and_then(|root| Ok(root.join(destination.relative.relative_path()?)))
        .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
    if !changes.is_empty() {
        let cards = patch_cards(snapshot, changes)?;
        custody::patch_entry(&path, &written.identity, &cards)?;
        let entry = observe_entry(&path)
            .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
        custody::verify_patched(&entry, snapshot.sha256.as_deref(), &cards)?;
        return Ok(Some(entry));
    }
    transfer::verify(snapshot, destination, written)?;
    let fingerprint = crate::inventory::probe_fingerprint(&path)
        .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
    Ok(Some(EntryEvidence {
        path: NativePath::from_path(&path),
        kind: EntryKind::File,
        fingerprint,
        sha256: snapshot.sha256.clone(),
    }))
}

/// The header cards an isolated patched entry carries for `changes`, read
/// from the snapshotted source (PREP-FR-03).
fn patch_cards(
    snapshot: &EntryEvidence,
    changes: &[CorrectedField],
) -> Result<Vec<header_patch::Card>, ItemReason> {
    let source = snapshot
        .path
        .to_path_buf()
        .map_err(|error| reason(ReasonCode::SourceUnavailable, error.to_string()))?;
    header_patch::cards_for(&source, changes).map_err(|detail| {
        reason(ReasonCode::WriteFailed, format!("{} cannot be patched: {detail}", source.display()))
    })
}

fn occupied_or_failed(path: &Path, error: &std::io::Error) -> ItemReason {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        reason(
            ReasonCode::DestinationOccupied,
            format!("{} already holds an entry; nothing is replaced", path.display()),
        )
    } else {
        reason(ReasonCode::WriteFailed, format!("{}: {error}", path.display()))
    }
}

/// Write a symlink, hardlink or clone entry at `path` and prove it. Only a
/// clone takes `header_changes`, its reviewed header cards: links are never
/// patched.
fn link_or_clone(
    kind: PreparedEntryKind,
    snapshot: &EntryEvidence,
    path: &Path,
    header_changes: &[CorrectedField],
) -> Result<EntryEvidence, ItemReason> {
    let source = snapshot
        .path
        .to_path_buf()
        .map_err(|error| reason(ReasonCode::SourceUnavailable, error.to_string()))?;
    let changed = |detail: String| reason(ReasonCode::DestinationChanged, detail);
    let entry = match kind {
        PreparedEntryKind::Symlink => {
            fs_pathsafe::create_symlink(&source, path)
                .map_err(|error| occupied_or_failed(path, &error))?;
            let entry = observe_entry(path).map_err(|error| changed(error.to_string()))?;
            if entry.kind != (EntryKind::Link { target: snapshot.path.clone() }) {
                return Err(changed(format!(
                    "{} does not point at {}",
                    path.display(),
                    source.display()
                )));
            }
            entry
        }
        PreparedEntryKind::Hardlink => {
            fs::hard_link(&source, path).map_err(|error| occupied_or_failed(path, &error))?;
            EntryEvidence {
                path: NativePath::from_path(path),
                kind: EntryKind::File,
                fingerprint: snapshot.fingerprint.clone(),
                sha256: snapshot.sha256.clone(),
            }
        }
        PreparedEntryKind::Clone => {
            clone_file(&source, path).map_err(|error| occupied_or_failed(path, &error))?;
            if !header_changes.is_empty() {
                let cards = patch_cards(snapshot, header_changes)?;
                let clone = crate::inventory::probe_fingerprint(path)
                    .map_err(|error| changed(error.to_string()))?;
                custody::patch_entry(path, &clone.identity, &cards)?;
            }
            let folder = path.parent().unwrap_or(path);
            transfer::sync_folder(folder).map_err(|error| {
                reason(ReasonCode::WriteFailed, format!("{}: {error}", folder.display()))
            })?;
            observe_entry(path).map_err(|error| changed(error.to_string()))?
        }
        PreparedEntryKind::Copy | PreparedEntryKind::DirectSource => {
            return Err(reason(
                ReasonCode::WriteFailed,
                format!("{kind:?} entries are not links or clones"),
            ));
        }
    };
    verify_entry(kind, snapshot, Some(&entry), header_changes)?;
    Ok(entry)
}

#[cfg(target_os = "macos")]
fn clone_file(source: &Path, path: &Path) -> std::io::Result<()> {
    let folder = path.parent().unwrap_or(path);
    let name = path.file_name().ok_or_else(|| std::io::Error::other("no file name"))?;
    let source = fs::File::open(source)?;
    let folder = fs::File::open(folder)?;
    rustix::fs::fclonefileat(&source, &folder, name, rustix::fs::CloneFlags::NOFOLLOW)?;
    fs::File::open(path)?.sync_all()
}

#[cfg(target_os = "linux")]
fn clone_file(source: &Path, path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let source = fs::File::open(source)?;
    let out = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    if let Err(error) = rustix::fs::ioctl_ficlone(&out, &source) {
        // Remove only the empty file this clone created, while it is ours.
        let ours = out.metadata()?;
        if fs::symlink_metadata(path)
            .is_ok_and(|now| now.dev() == ours.dev() && now.ino() == ours.ino())
        {
            let _ = fs::remove_file(path);
        }
        return Err(error.into());
    }
    out.sync_all()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn clone_file(_source: &Path, _path: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "this platform makes no verified clone",
    ))
}

/// D19 for one entry: the source against its snapshot, then the entry as
/// written: a link by its identity and target, a copy, clone or hardlink by
/// its identity and the snapshot's SHA-256. A patched copy or clone differs
/// from the snapshot only by the header cards of its reviewed `changes`.
fn verify_entry(
    kind: PreparedEntryKind,
    snapshot: &EntryEvidence,
    entry: Option<&EntryEvidence>,
    changes: &[CorrectedField],
) -> Result<(), ItemReason> {
    verify_source(snapshot)?;
    if let Some(entry) = entry {
        if !changes.is_empty() {
            let cards = patch_cards(snapshot, changes)?;
            return custody::verify_patched(entry, snapshot.sha256.as_deref(), &cards);
        }
        let mismatch = |detail: String| reason(ReasonCode::DestinationMismatch, detail);
        verify_source(entry).map_err(|failure| mismatch(failure.detail))?;
        if kind != PreparedEntryKind::Symlink && entry.sha256 != snapshot.sha256 {
            return Err(mismatch(format!(
                "{} differs from the source snapshot",
                entry.path.display()
            )));
        }
    }
    Ok(())
}

/// Re-verify one prepared entry (terminal success, Open).
fn reverify(entry: &PreparedEntry) -> Result<(), ItemReason> {
    let snapshot = entry.source_evidence.as_ref().ok_or_else(|| {
        reason(ReasonCode::Interrupted, format!("{} has no source snapshot", entry.path.display()))
    })?;
    if entry.kind.created() && entry.entry_identity.is_none() {
        return Err(reason(
            ReasonCode::DestinationChanged,
            format!("{} has no recorded entry", entry.path.display()),
        ));
    }
    verify_entry(entry.kind, snapshot, entry.entry_identity.as_ref(), &entry.header_changes)
}

/// Every prepared or drifted entry that no longer matches its snapshot.
fn reverify_all(entries: &[PreparedEntry]) -> Vec<(u32, ItemReason)> {
    entries
        .iter()
        .filter(|entry| matches!(entry.state, EntryState::Prepared | EntryState::Drifted))
        .filter_map(|entry| reverify(entry).err().map(|drift| (entry.seq, drift)))
        .collect()
}

/// The profile's arguments with `{folder}`, `{results}` and `{inputs}` (one
/// argument per prepared entry) expanded.
fn launch_args(
    profile: &Profile,
    record: &PreparationRecord,
) -> Result<Vec<OsString>, LibraryError> {
    let folder = record.revision.folder.to_path_buf()?;
    let results = record.revision.results_folder.to_path_buf()?;
    let mut args = Vec::new();
    for arg in &profile.args {
        if arg == "{inputs}" {
            for entry in record.entries.iter().filter(|entry| entry.state == EntryState::Prepared) {
                args.push(entry.path.to_path_buf()?.into_os_string());
            }
            continue;
        }
        let mut expanded = OsString::new();
        let mut rest = arg.as_str();
        while let Some(start) = rest.find('{') {
            expanded.push(&rest[..start]);
            let tail = &rest[start..];
            if let Some(after) = tail.strip_prefix("{folder}") {
                expanded.push(&folder);
                rest = after;
            } else if let Some(after) = tail.strip_prefix("{results}") {
                expanded.push(&results);
                rest = after;
            } else {
                expanded.push("{");
                rest = &tail[1..];
            }
        }
        expanded.push(rest);
        args.push(expanded);
    }
    Ok(args)
}

/// Launch the application detached; its exit is reaped and changes nothing.
fn launch(executable: &Path, args: &[OsString], cwd: &Path, folder: NativePath) -> OpenOutcome {
    if !fs::metadata(executable).is_ok_and(|metadata| metadata.is_file()) {
        return OpenOutcome::ChooseApplication {
            folder,
            detail: format!("{} is missing", executable.display()),
        };
    }
    let spawned = Command::new(executable)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    match spawned {
        Ok(mut child) => {
            let process_id = child.id();
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            OpenOutcome::Launched { process_id, folder }
        }
        Err(error) => OpenOutcome::LaunchFailed {
            folder,
            detail: format!("{}: {error}", executable.display()),
        },
    }
}

/// PREP's run lifecycle sources: Running revisions block Mark Complete and
/// Move run to Trash; every revision's folder and the run's Results folder
/// are named for Empty Trash.
struct PreparationSources {
    library: Weak<Library>,
}

impl PreparationSources {
    fn library(&self) -> Result<Arc<Library>, LibraryError> {
        self.library
            .upgrade()
            .ok_or_else(|| LibraryError::PersistenceFailure("the library is closed".into()))
    }
}

impl RunOperationGuard for PreparationSources {
    fn blockers<'a>(&'a self, view: &'a View) -> BlockersFuture<'a> {
        Box::pin(async move {
            let library = self.library()?;
            let revisions = library.catalog().view_preparations(view.id).await?;
            Ok(revisions
                .into_iter()
                .filter(|revision| revision.state == PreparationState::Running)
                .map(|revision| LifecycleBlocker::RunningOperation {
                    operation_id: revision.id,
                    operation: RunOperationKind::Preparation,
                    name: revision.name(),
                })
                .collect())
        })
    }
}

impl RunFolders for PreparationSources {
    fn folders<'a>(&'a self, view: &'a View) -> FoldersFuture<'a> {
        Box::pin(async move {
            let library = self.library()?;
            let revisions = library.catalog().view_preparations(view.id).await?;
            let results = library.catalog().view_results_folder(view.id).await?;
            Ok(RunFolderSet {
                prepared: revisions
                    .into_iter()
                    .map(|revision| PreparedFolder {
                        preparation_revision: Revision::from(revision.n),
                        path: revision.folder,
                    })
                    .collect(),
                results: results.into_iter().collect(),
            })
        })
    }
}

/// Register PREP's lifecycle sources and pause every revision an earlier
/// process left Running: closing `PlateVault` never prepares or completes a run.
///
/// # Errors
/// Catalog errors.
pub(crate) async fn register(library: &Arc<Library>) -> Result<(), LibraryError> {
    library.catalog().pause_interrupted_preparations().await?;
    let sources = Arc::new(PreparationSources { library: Arc::downgrade(library) });
    library.register_run_guard(Arc::clone(&sources) as Arc<dyn RunOperationGuard>).await;
    library.register_run_folders(sources).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Capability, CapabilityEvidence, CapabilityProof, InputBehavior, ProfileKind};

    fn verified_read_only() -> Profile {
        let proofs = Capability::ALL
            .into_iter()
            .map(|capability| CapabilityProof { capability, evidence: "fixture".into() })
            .collect();
        Profile {
            id: Uuid::new_v4(),
            name: "Siril".into(),
            kind: ProfileKind::Siril,
            executable: None,
            args: vec!["{inputs}".into()],
            capability_evidence: CapabilityEvidence {
                input_behavior: InputBehavior::ReadOnly,
                input_list: true,
                proofs,
            },
            revision: 1,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn linked(options: &[ModeOption], link: LinkKind) -> &ModeOption {
        options.iter().find(|option| option.link == Some(link)).unwrap()
    }

    /// PREP-AC-03/08, PREP-FR-04: a destination whose probe refuses links
    /// refuses both Linked View options with the reason, suggests an
    /// isolated Copy instead, and leaves Copy and Direct source offered.
    #[test]
    fn unsupported_links_refuse_linked_view() {
        let profile = verified_read_only();
        assert_eq!(suggested_mode(&profile, &LinkSupport::default()), InputMode::LinkedView);
        let unsupported = LinkSupport {
            symlink: Some("/Volumes/EXFAT cannot hold one (Operation not supported)".into()),
            hardlink: Some("/Volumes/EXFAT cannot hold one (Operation not supported)".into()),
        };
        let options = mode_options(&profile, &unsupported);
        for link in [LinkKind::Symlink, LinkKind::Hardlink] {
            let refusal = linked(&options, link).refusal.clone().unwrap_or_default();
            assert!(refusal.contains("/Volumes/EXFAT cannot hold one"), "{refusal}");
        }
        for mode in [InputMode::Copy, InputMode::DirectSource] {
            let option = options.iter().find(|option| option.mode == mode).unwrap();
            assert_eq!(option.refusal, None, "{mode:?}");
        }
        assert!(matches!(
            suggested_mode(&profile, &unsupported),
            InputMode::Copy | InputMode::Clone
        ));
        let hardlinks_only = LinkSupport { hardlink: None, ..unsupported };
        let options = mode_options(&profile, &hardlinks_only);
        assert!(linked(&options, LinkKind::Symlink).refusal.is_some());
        assert_eq!(linked(&options, LinkKind::Hardlink).refusal, None);
        assert_eq!(suggested_mode(&profile, &hardlinks_only), InputMode::Copy, "never hardlinks");
    }

    /// The probe creates its links in the folder and removes exactly what it
    /// created.
    #[test]
    fn probe_links_leaves_the_folder_as_it_was() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("kept.txt"), b"kept").unwrap();
        assert_eq!(probe_links(folder.path()), LinkSupport::default());
        let left: Vec<_> =
            fs::read_dir(folder.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, ["kept.txt"]);
        let missing = folder.path().join("missing");
        let refused = probe_links(&missing);
        assert!(refused.symlink.is_some() && refused.hardlink.is_some());
    }
}
