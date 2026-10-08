// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Application preparation of a run and of a run group (spec 069
//! PREP-FR-01..14; D04, D09, D19): review, Prepare, Retry, the outcome and
//! Open, and Prepare all.
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
//! Prepare all prepares every panel run of a run group the same way, each in
//! its own `Panel N/` folder of one new group folder, with its own outcome;
//! the group's outcome follows them, and Open on the group needs every panel
//! run verified.
//!
//! PREP feeds the run lifecycle ports: a Running revision or Prepare all
//! blocks Mark Complete and Move run to Trash ([`RunOperationGuard`]), every
//! revision's folder and the run's Results folder are named for Empty Trash
//! ([`RunFolders`]), and [`PreparationFailed`] is the run blocker Home reads.

use std::collections::{BTreeSet, HashMap};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Weak};

use persistence_library::{
    EntryUpdate, GroupPanel, GroupPreparationRecord, MembershipBasis, NewGroupPreparation,
    NewPanelPreparation, NewPreparation, NewPreparedEntry, PanelPreparationRecord,
    PreparationRecord, RecordedFolders,
};
use uuid::Uuid;

use crate::custody::{observe_entry, transfer, verify_source};
use crate::layout;
use crate::library::{blocking, Library};
use crate::run_lifecycle::{BlockersFuture, FoldersFuture, RunFolders, RunOperationGuard};
use crate::{
    Availability, BlockedInput, CalibrationHandoff, CalibrationReadiness, EntryEvidence, EntryKind,
    EntryState, GroupCalibrationReadiness, GroupLocation, GroupPreparation,
    GroupPreparationOutcome, GroupPreparationReview, GroupPrepareBasis, InputMode, ItemReason,
    LibraryError, LifecycleBlocker, LinkKind, LocationCheck, MemberState, Membership, ModeOption,
    NativePath, ObservationFingerprint, OpenOutcome, PanelOutcome, PanelPreparationOutcome,
    PanelPreparationReview, PanelResult, PlannedEntry, PreparationFailed, PreparationOutcome,
    PreparationReview, PreparationRevision, PreparationState, PrepareRequest, PrepareStep,
    PreparedEntry, PreparedEntryKind, PreparedFolder, PreparedInput, Profile, ReasonCode, Revision,
    RunCompletion, RunFolderSet, RunLocation, RunOperationKind, RunStage, TransferDestination,
    View, ViewGroup, Writability, WrittenCopy,
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
#[derive(Clone, Debug)]
struct Basis {
    fingerprint: ObservationFingerprint,
    what: &'static str,
}

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
        let folder = location.folder.to_path_buf()?;
        let folders = entry_folders(&review.entries, &review.blocked, &folder);
        let target = location.clone();
        let created = blocking(move || create_folders(&target, &folders, recorded_results)).await?;
        let entries = new_entries(
            &review.entries,
            &review.blocked,
            entry_kind(review.mode, review.link),
            &location.folder,
        );
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
        let resolved = self.anchors_of(&record.revision).await;
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
        let cwd = folder.to_path_buf()?;
        let results = checked.revision.results_folder.to_path_buf()?;
        let args = launch_args(&profile, &cwd, &results, &checked.entries)?;
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
        let ((inputs, anchors), mut blocked, excluded) =
            resolve_inputs(&basis, &calibration, &roots)?;
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
        let modes = mode_options(&profile);
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
        if let Some(refusal) = location_refusal(&disk.check) {
            refusals.push(refusal);
        }
        if disk.entries.is_empty() {
            refusals.push("no input of the run can be prepared as reviewed".to_owned());
        }
        let created = disk.entries.iter().filter(|entry| entry.kind.created()).count();
        let footprint_bytes = footprint(&disk.entries);
        let review = PreparationReview {
            view_id: view.id,
            membership_revision: view.revision,
            draft_unsaved: record.draft.is_some(),
            project_name: project.name.clone(),
            subject_name,
            run_name: header.name.clone(),
            verified_profile: profile.verified(),
            unproven: profile.capability_evidence.unproven(),
            suggested_mode: suggested_mode(&profile),
            mode: request.mode,
            link,
            modes,
            preparation_number: n,
            location: disk.location,
            location_check: disk.check,
            entries: disk.entries,
            blocked,
            excluded,
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

    /// The anchors a revision's inputs are snapshotted against, resolved
    /// again from its run's committed membership and calibration handoff.
    async fn anchors_of(
        &self,
        revision: &PreparationRevision,
    ) -> Result<HashMap<PathBuf, Basis>, LibraryError> {
        let basis = self.catalog().view_membership(revision.view_id, Membership::Committed).await?;
        let calibration =
            self.calibration_handoff(revision.view_id, revision.membership_revision).await?;
        let roots = self.input_roots(&basis, &calibration).await?;
        let ((_, anchors), _, _) = resolve_inputs(&basis, &calibration, &roots)?;
        Ok(anchors)
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
        // Immediately before terminal success, every source and entry must
        // still match its snapshot (D19).
        for entry in entries.iter().filter(|entry| entry.state == EntryState::Prepared) {
            let checked = entry.clone();
            let Err(drift) = blocking(move || Ok(reverify(&checked))).await? else {
                continue;
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
        let basis = anchors.get(&source).cloned();
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
                        blocking(move || {
                            Ok(verify_entry(kind, &checked, Some(&identity))
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
                        blocking(move || Ok(copy_entry(&checked, &destination, copy.as_ref())))
                            .await?
                    }
                    (None, PreparedEntryKind::DirectSource) => Ok(None),
                    (None, kind) => {
                        let (checked, path) = (snapshot.clone(), entry.path.to_path_buf()?);
                        blocking(move || Ok(link_or_clone(kind, &checked, &path).map(Some))).await?
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

/// Linked View for a verified read-only profile, else isolated Copy.
fn suggested_mode(profile: &Profile) -> InputMode {
    if profile.verified() && profile.reads_only() {
        InputMode::LinkedView
    } else {
        InputMode::Copy
    }
}

/// The storage the planned copies take.
fn footprint(entries: &[PlannedEntry]) -> u64 {
    entries
        .iter()
        .filter(|entry| entry.kind == PreparedEntryKind::Copy)
        .map(|entry| entry.size_bytes)
        .sum()
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

/// Every input mode with its semantics and refusal for `profile`.
fn mode_options(profile: &Profile) -> Vec<ModeOption> {
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
            refusal: mode_refusal(profile, mode),
        })
        .collect()
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
            Basis { fingerprint: recorded, what: "the confirmed membership" },
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
                Basis { fingerprint: file.fingerprint.clone(), what: "its calibration assignment" },
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
}

fn check_disk(plan: &DiskPlan) -> Result<DiskCheck, LibraryError> {
    let (location, check, writability, free_bytes) = check_location(plan)?;
    let (entries, blocked) = match &location {
        Some(location) => plan_entries(
            &plan.inputs,
            plan.kind,
            &location.folder.to_path_buf()?,
            &location.output.to_path_buf()?,
        ),
        None => (Vec::new(), Vec::new()),
    };
    let refusals =
        if plan.folder_handoff { folder_handoff_refusal(&plan.inputs) } else { Vec::new() };
    Ok(DiskCheck { location, check, entries, blocked, refusals, free_bytes, writability })
}

/// Each input's entry in `folder` (its source for Direct source), or the
/// reason its source cannot be prepared.
fn plan_entries(
    inputs: &[SourceInput],
    kind: PreparedEntryKind,
    folder: &Path,
    output: &Path,
) -> (Vec<PlannedEntry>, Vec<BlockedInput>) {
    let mut entries = Vec::new();
    let mut blocked = Vec::new();
    let mut names: HashMap<(PathBuf, OsString), usize> = HashMap::new();
    for input in inputs {
        if let Some(name) = input.source.file_name() {
            *names.entry((subfolder(input.input), name.to_owned())).or_default() += 1;
        }
    }
    for input in inputs {
        let path = if kind == PreparedEntryKind::DirectSource {
            input.source.clone()
        } else {
            folder.join(subfolder(input.input)).join(entry_name(input, &names))
        };
        if let Err(reason) = source_present(&input.source, kind, output) {
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
            kind,
            source: NativePath::from_path(&input.source),
            path: NativePath::from_path(&path),
            size_bytes: input.size_bytes,
        });
    }
    (entries, blocked)
}

type LocationRead = (Option<RunLocation>, LocationCheck, Option<Writability>, Option<u64>);

fn check_location(plan: &DiskPlan) -> Result<LocationRead, LibraryError> {
    let output = match chosen_parent(plan.output.as_deref(), &plan.recorded)? {
        Ok(output) => output,
        Err(check) => return Ok((None, check, None, None)),
    };
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
    let writable_root = match writable_root(&project, &output) {
        Ok(root) => root,
        Err(detail) => {
            let check = LocationCheck::ParentUnavailable { detail };
            return Ok((Some(location), check, None, free_bytes));
        }
    };
    let writability = crate::import::writability(&writable_root);
    let exists = |path: &Path| fs::symlink_metadata(path).is_ok();
    let check = if exists(&folder) {
        LocationCheck::FolderExists { folder: location.folder.clone() }
    } else if plan.results.is_none() && exists(&results) {
        LocationCheck::FolderExists { folder: location.results.clone() }
    } else if let Writability::NotWritable { detail } = &writability {
        LocationCheck::NotWritable { detail: detail.clone() }
    } else {
        LocationCheck::Ready
    };
    Ok((Some(location), check, Some(writability), free_bytes))
}

/// The chosen parent, canonical, or why it cannot take a preparation: none
/// was chosen, it is unavailable, or it lies inside a recorded prepared,
/// group or Results folder.
fn chosen_parent(
    output: Option<&Path>,
    recorded: &RecordedFolders,
) -> Result<Result<PathBuf, LocationCheck>, LibraryError> {
    let Some(output) = output else {
        return Ok(Err(LocationCheck::ChooseParent));
    };
    let unavailable = |detail: String| Ok(Err(LocationCheck::ParentUnavailable { detail }));
    match fs::symlink_metadata(output) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return unavailable(format!("{} is not a real folder", output.display())),
        Err(error) => return unavailable(format!("{}: {error}", output.display())),
    }
    let output = match fs::canonicalize(output) {
        Ok(path) => path,
        Err(error) => return unavailable(format!("{}: {error}", output.display())),
    };
    for recorded in recorded.prepared.iter().chain(&recorded.results) {
        let path = recorded.to_path_buf()?;
        let path = fs::canonicalize(&path).unwrap_or(path);
        if layout::inside(&output, &path) {
            return Ok(Err(LocationCheck::InsidePreparedFolder { folder: recorded.clone() }));
        }
    }
    Ok(Ok(output))
}

/// The folder review reads writability of: the Project folder when it exists
/// as a real folder, else the parent; a Project entry that is no real folder
/// is named.
fn writable_root(project: &Path, output: &Path) -> Result<PathBuf, String> {
    match fs::symlink_metadata(project) {
        Ok(metadata)
            if metadata.is_dir() && !fs_pathsafe::is_link_or_junction_metadata(&metadata) =>
        {
            Ok(project.to_path_buf())
        }
        Ok(_) => Err(format!("{} is not a real folder", project.display())),
        Err(_) => Ok(output.to_path_buf()),
    }
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

/// The planned folders below `folder` that entries go to: never a
/// Direct-source path's.
fn entry_folders(
    entries: &[PlannedEntry],
    blocked: &[BlockedInput],
    folder: &Path,
) -> BTreeSet<PathBuf> {
    entries
        .iter()
        .filter(|entry| entry.kind != PreparedEntryKind::DirectSource)
        .map(|entry| &entry.path)
        .chain(blocked.iter().filter_map(|blocked| blocked.path.as_ref()))
        .filter_map(|path| path.to_path_buf().ok()?.parent().map(Path::to_path_buf))
        .filter(|parent| parent.starts_with(folder))
        .collect()
}

/// The entries a new revision records: every planned entry pending, every
/// blocked input with its reason.
fn new_entries(
    entries: &[PlannedEntry],
    blocked: &[BlockedInput],
    kind: PreparedEntryKind,
    folder: &NativePath,
) -> Vec<NewPreparedEntry> {
    entries
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
            blocked: None,
        })
        .chain(blocked.iter().map(|blocked| NewPreparedEntry {
            member_key: blocked.member_key,
            asset_id: None,
            master_id: None,
            input: blocked.input,
            kind,
            path: blocked.path.clone().unwrap_or_else(|| folder.clone()),
            source: blocked.source.clone(),
            size_bytes: blocked.size_bytes,
            blocked: Some(blocked.reason.clone()),
        }))
        .collect()
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
        real_folder(&project, &mut created)?;
        make_folder(&folder, &mut created)?;
        make_subfolders(&folder, subfolders, &mut created)?;
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

/// Prepare all's new folders (PREP-FR-12): the group folder, each panel run's
/// `Panel N/` folder and its input subfolders, and each Results folder in
/// `results` that is not recorded yet or went missing. An existing folder is
/// never reused.
fn create_group_folders(
    location: &GroupLocation,
    subfolders: &BTreeSet<PathBuf>,
    results: &[(PathBuf, bool)],
) -> Result<CreatedFolders, LibraryError> {
    let folder = location.folder.to_path_buf()?;
    let output = location.output.to_path_buf()?;
    let project = folder.parent().unwrap_or(&output).to_path_buf();
    let mut created = CreatedFolders { folders: Vec::new() };
    let made = (|| {
        real_folder(&project, &mut created)?;
        make_folder(&folder, &mut created)?;
        for panel in &location.panels {
            make_folder(&panel.folder.to_path_buf()?, &mut created)?;
        }
        make_subfolders(&folder, subfolders, &mut created)?;
        for (path, recorded) in results {
            if !recorded || fs::symlink_metadata(path).is_err() {
                real_folder(path.parent().unwrap_or(&project), &mut created)?;
                make_folder(path, &mut created)?;
            }
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

/// A real folder at `path`, created when missing; an entry there that is no
/// real folder refuses.
fn real_folder(path: &Path, created: &mut CreatedFolders) -> Result<(), LibraryError> {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.is_dir() && !fs_pathsafe::is_link_or_junction_metadata(&metadata) =>
        {
            Ok(())
        }
        Ok(_) => Err(invalid(format!("{} is not a real folder", path.display()))),
        Err(_) => make_folder(path, created),
    }
}

/// Every missing folder from `folder` down to each of `subfolders`.
fn make_subfolders(
    folder: &Path,
    subfolders: &BTreeSet<PathBuf>,
    created: &mut CreatedFolders,
) -> Result<(), LibraryError> {
    for sub in subfolders {
        let relative = sub
            .strip_prefix(folder)
            .map_err(|_| invalid(format!("{} lies outside the prepared folder", sub.display())))?;
        let mut current = folder.to_path_buf();
        for part in relative.components() {
            current.push(part);
            if fs::symlink_metadata(&current).is_err() {
                make_folder(&current, created)?;
            }
        }
    }
    Ok(())
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
                format!("{} differs from {}", source.display(), basis.what),
            ));
        }
        if recorded.content_sha256.as_ref().is_some_and(|sha| snapshot.sha256.as_ref() != Some(sha))
        {
            return Err(reason(
                ReasonCode::SourceDrift,
                format!(
                    "{} differs from the SHA-256 recorded for {}",
                    source.display(),
                    basis.what
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
/// without replacing anything and re-read it against the snapshot.
fn copy_entry(
    snapshot: &EntryEvidence,
    destination: &TransferDestination,
    written: Option<&WrittenCopy>,
) -> Result<Option<EntryEvidence>, ItemReason> {
    let written = written.ok_or_else(|| {
        reason(ReasonCode::Interrupted, "the copy's partial file was never recorded")
    })?;
    transfer::write(snapshot, destination, written)?;
    transfer::verify(snapshot, destination, written)?;
    let path = destination
        .root
        .to_path_buf()
        .and_then(|root| Ok(root.join(destination.relative.relative_path()?)))
        .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
    let fingerprint = crate::inventory::probe_fingerprint(&path)
        .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
    Ok(Some(EntryEvidence {
        path: NativePath::from_path(&path),
        kind: EntryKind::File,
        fingerprint,
        sha256: snapshot.sha256.clone(),
    }))
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

/// Write a symlink, hardlink or clone entry at `path` and prove it.
fn link_or_clone(
    kind: PreparedEntryKind,
    snapshot: &EntryEvidence,
    path: &Path,
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
    verify_entry(kind, snapshot, Some(&entry))?;
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
/// its identity and the snapshot's SHA-256.
fn verify_entry(
    kind: PreparedEntryKind,
    snapshot: &EntryEvidence,
    entry: Option<&EntryEvidence>,
) -> Result<(), ItemReason> {
    verify_source(snapshot)?;
    if let Some(entry) = entry {
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
    verify_entry(entry.kind, snapshot, entry.entry_identity.as_ref())
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
    folder: &Path,
    results: &Path,
    entries: &[PreparedEntry],
) -> Result<Vec<OsString>, LibraryError> {
    let mut args = Vec::new();
    for arg in &profile.args {
        if arg == "{inputs}" {
            for entry in entries.iter().filter(|entry| entry.state == EntryState::Prepared) {
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
                expanded.push(folder);
                rest = after;
            } else if let Some(after) = tail.strip_prefix("{results}") {
                expanded.push(results);
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

// ---------------------------------------------------------------------------
// Run group: Prepare all (PREP-FR-07/12/13, D-W38, D-W73)
// ---------------------------------------------------------------------------

/// A Prepare all review with each panel run's anchors, by run.
struct GroupPlanned {
    review: GroupPreparationReview,
    anchors: HashMap<Uuid, HashMap<PathBuf, Basis>>,
}

/// One panel run as review resolved it, before the disk check.
struct PanelPlan {
    review: PanelPreparationReview,
    inputs: Vec<SourceInput>,
    results: Option<NativePath>,
    anchors: HashMap<PathBuf, Basis>,
}

impl Library {
    /// Review Prepare all on a run group (PREP-FR-08/12, PREP-AC-16): one
    /// review over every panel run outside the Project's Trash, with the
    /// group folder and each `Panel N/` folder, each panel run's Results
    /// folder and the group's Assembled folder, each panel's entries and own
    /// calibration choices, the shared setup once, one total footprint and
    /// the free space. Read-only: nothing is created until Prepare all.
    ///
    /// # Errors
    /// `InvalidInput` for a name that is no folder name; `NotFound` for an
    /// unknown run group or profile.
    pub async fn review_group_preparation(
        &self,
        group: Uuid,
        request: &PrepareRequest,
    ) -> Result<GroupPreparationReview, LibraryError> {
        Ok(self.plan_group_preparation(group, request).await?.review)
    }

    /// Prepare all (PREP-FR-12/13): record the group revision Running in its
    /// new group folder, prepare each panel run under its `Panel N/` folder in
    /// turn, each ending in its own outcome, and end in the outcome the
    /// panel runs give. One panel's blocked items never block another's.
    ///
    /// # Errors
    /// `Conflict` when the run group or a panel run's committed membership
    /// moved past `expected`; `InvalidInput` naming every refusal of the
    /// review, or when a folder appeared since; catalog errors.
    pub async fn prepare_group(
        &self,
        group: Uuid,
        request: &PrepareRequest,
        expected: &GroupPrepareBasis,
        control: &dyn PrepareControl,
    ) -> Result<GroupPreparationOutcome, LibraryError> {
        let GroupPlanned { review, anchors } = self.plan_group_preparation(group, request).await?;
        if review.basis() != *expected {
            return Err(LibraryError::Conflict {
                id: group,
                current: review.group_revision,
                successors: Vec::new(),
            });
        }
        if !review.refusals.is_empty() {
            return Err(invalid(review.refusals.join("; ")));
        }
        let location = review
            .location
            .clone()
            .ok_or_else(|| invalid("choose a parent folder for the run group"))?;
        let kind = entry_kind(review.mode, review.link);
        let mut subfolders = BTreeSet::new();
        let mut results = Vec::with_capacity(review.panels.len() + 1);
        let mut panels = Vec::with_capacity(review.panels.len());
        for (panel, place) in review.panels.iter().zip(&location.panels) {
            subfolders.extend(entry_folders(
                &panel.entries,
                &panel.blocked,
                &place.folder.to_path_buf()?,
            ));
            let recorded = self.catalog().view_results_folder(panel.view_id).await?.is_some();
            results.push((place.results.to_path_buf()?, recorded));
            panels.push(NewPanelPreparation {
                view_id: panel.view_id,
                n: panel.preparation_number,
                membership_revision: panel.membership_revision,
                folder: place.folder.clone(),
                results_folder: place.results.clone(),
                entries: new_entries(&panel.entries, &panel.blocked, kind, &place.folder),
            });
        }
        let recorded = self.catalog().group_assembled_folder(group).await?.is_some();
        results.push((location.assembled.to_path_buf()?, recorded));
        let target = location.clone();
        let created =
            blocking(move || create_group_folders(&target, &subfolders, &results)).await?;
        let input = NewGroupPreparation {
            group_id: group,
            n: review.preparation_number,
            profile_id: review.profile.id,
            mode: review.mode,
            link: review.link,
            output: location.output,
            folder: location.folder,
            assembled: location.assembled,
            panels,
        };
        let record = match self.catalog().start_group_preparation(&input).await {
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
        self.run_group_preparation(record, &anchors, control).await
    }

    /// Retry a Partial or Paused Prepare all in its own group folder: every
    /// Partial or Paused panel run continues as Retry does for a run.
    ///
    /// # Errors
    /// `InvalidInput` as
    /// [`persistence_library::Catalog::resume_group_preparation`]; catalog
    /// errors.
    pub async fn retry_group_preparation(
        &self,
        id: Uuid,
        control: &dyn PrepareControl,
    ) -> Result<GroupPreparationOutcome, LibraryError> {
        let record = self.catalog().resume_group_preparation(id).await?;
        let mut anchors = HashMap::new();
        for panel in &record.panels {
            let revision = &panel.record.revision;
            if revision.state != PreparationState::Running {
                continue;
            }
            match self.anchors_of(revision).await {
                Ok(found) => {
                    anchors.insert(revision.view_id, found);
                }
                Err(error) => {
                    self.catalog()
                        .finish_preparation(
                            revision.id,
                            PreparationState::Failed,
                            Some(&error.to_string()),
                        )
                        .await?;
                }
            }
        }
        self.run_group_preparation(record, &anchors, control).await
    }

    /// The outcome of a Prepare all: each panel run's own outcome, the
    /// Assembled folder, and what the group offers. Running reads as progress.
    ///
    /// # Errors
    /// `NotFound` for an unknown one.
    pub async fn group_preparation_outcome(
        &self,
        id: Uuid,
    ) -> Result<GroupPreparationOutcome, LibraryError> {
        let record = self.catalog().group_preparation(id).await?;
        self.group_outcome(record).await
    }

    /// Open on the run group's folder (PREP-FR-13): only when every panel
    /// run is verified, and immediately before the launch every panel run's
    /// entries are re-verified under D19; drift refuses the launch and names
    /// the changed entries. `{folder}` is the group folder and `{results}` the
    /// Assembled folder. Launching never marks a panel run Complete.
    ///
    /// # Errors
    /// `InvalidInput` for a Prepare all that is not Prepared, a panel run not
    /// Prepared or one in the Project's Trash; `NotFound` for an unknown one.
    pub async fn open_group_preparation(&self, id: Uuid) -> Result<OpenOutcome, LibraryError> {
        let record = self.catalog().group_preparation(id).await?;
        let preparation = &record.preparation;
        if preparation.outcome != PreparationState::Prepared {
            return Err(invalid(format!(
                "Prepare all '{}' is {}; Open on the group needs every panel run verified",
                preparation.name(),
                preparation.outcome
            )));
        }
        for panel in &record.panels {
            let revision = &panel.record.revision;
            if revision.state != PreparationState::Prepared {
                return Err(invalid(format!(
                    "Panel {} is {}; Open on the group needs every panel run verified",
                    panel.number, revision.state
                )));
            }
            if self.catalog().view(revision.view_id).await?.view.trashed_at.is_some() {
                return Err(invalid(format!(
                    "Panel {} is in the Project's Trash; restore it before opening the group",
                    panel.number
                )));
            }
        }
        let mut drifted = Vec::new();
        let mut inputs = Vec::new();
        for panel in &record.panels {
            let entries = panel.record.entries.clone();
            let found = blocking(move || Ok(reverify_all(&entries))).await?;
            let checked =
                self.catalog().record_open_check(panel.record.revision.id, &found).await?;
            for entry in checked.entries {
                if entry.state == EntryState::Drifted {
                    drifted.push(entry);
                } else {
                    inputs.push(entry);
                }
            }
        }
        if !drifted.is_empty() {
            return Ok(OpenOutcome::Refused { drifted });
        }
        let profile = self.catalog().profile(preparation.profile_id).await?;
        let folder = preparation.folder.clone();
        let Some(executable) = profile.executable.as_ref() else {
            return Ok(OpenOutcome::ChooseApplication {
                folder,
                detail: format!("profile '{}' has no application configured", profile.name),
            });
        };
        let executable = executable.to_path_buf()?;
        let assembled = self.assembled_folder(preparation).await?.to_path_buf()?;
        let cwd = folder.to_path_buf()?;
        let args = launch_args(&profile, &cwd, &assembled, &inputs)?;
        blocking(move || Ok(launch(&executable, &args, &cwd, folder))).await
    }

    /// Prepare each Running panel run in panel order, stop every one left
    /// when the user cancels or pauses, and end Prepare all in the outcome
    /// its panel runs give.
    async fn run_group_preparation(
        &self,
        record: GroupPreparationRecord,
        anchors: &HashMap<Uuid, HashMap<PathBuf, Basis>>,
        control: &dyn PrepareControl,
    ) -> Result<GroupPreparationOutcome, LibraryError> {
        let id = record.preparation.id;
        let mut stopped = None;
        let mut failure = None;
        for panel in record.panels {
            let (view, state) = (panel.record.revision.view_id, panel.record.revision.state);
            let (PreparationState::Running, Some(anchors)) = (state, anchors.get(&view)) else {
                continue;
            };
            // A panel run's blocked items or failure end only that panel run.
            match self.run_preparation(panel.record, anchors, control).await {
                Ok(outcome)
                    if matches!(
                        outcome.revision.state,
                        PreparationState::Canceled | PreparationState::Paused
                    ) =>
                {
                    stopped = Some(outcome.revision.state);
                    break;
                }
                Ok(_) => {}
                Err(error) => failure = Some(error.to_string()),
            }
        }
        let (remaining, reason) = match stopped {
            Some(state) => (state, None),
            None => (
                PreparationState::Failed,
                Some(failure.unwrap_or_else(|| {
                    "Prepare all ended before this panel run was prepared".to_owned()
                })),
            ),
        };
        let record =
            self.catalog().finish_group_preparation(id, remaining, reason.as_deref()).await?;
        self.group_outcome(record).await
    }

    async fn group_outcome(
        &self,
        record: GroupPreparationRecord,
    ) -> Result<GroupPreparationOutcome, LibraryError> {
        let assembled = self.assembled_folder(&record.preparation).await?;
        let mut panels = Vec::with_capacity(record.panels.len());
        for PanelPreparationRecord { number, panel_id, record } in record.panels {
            let stage = self.catalog().view(record.revision.view_id).await?.view.stage;
            panels.push(PanelPreparationOutcome {
                number,
                panel_id,
                outcome: outcome(record, stage),
            });
        }
        let verified = GroupPreparationOutcome::every_panel_verified(&panels);
        let offers = PreparationOutcome::offers_for(record.preparation.outcome, !verified);
        Ok(GroupPreparationOutcome { preparation: record.preparation, panels, assembled, offers })
    }

    async fn assembled_folder(
        &self,
        preparation: &GroupPreparation,
    ) -> Result<NativePath, LibraryError> {
        self.catalog().group_assembled_folder(preparation.group_id).await?.ok_or_else(|| {
            LibraryError::PersistenceFailure(format!(
                "Prepare all '{}' has no recorded Assembled folder",
                preparation.name()
            ))
        })
    }

    #[allow(clippy::too_many_lines)]
    async fn plan_group_preparation(
        &self,
        group_id: Uuid,
        request: &PrepareRequest,
    ) -> Result<GroupPlanned, LibraryError> {
        let catalog = self.catalog();
        let basis = catalog.group_preparation_basis(group_id).await?;
        let group = &basis.group;
        let project = catalog.project(group.project_id).await?;
        let subject_name = project
            .subjects
            .iter()
            .find(|subject| subject.id == group.subject_id)
            .map(|subject| subject.name.clone().unwrap_or_else(|| subject.designation.clone()))
            .unwrap_or_default();
        let profile = catalog.profile(request.profile_id).await?;
        let readiness = self.calibration_group_readiness(group_id).await?;
        let output = match &request.output {
            Some(output) => Some(output.clone()),
            None => catalog.last_preparation_output().await?,
        };
        let recorded = catalog.recorded_preparation_folders().await?;
        let link =
            (request.mode == InputMode::LinkedView).then(|| request.link.unwrap_or_default());
        let mut refusals = Vec::new();
        if group.setup.profile_id != Some(profile.id) {
            refusals.push(format!(
                "run group '{}' does not share profile '{}'; set the group's setup first",
                group.name, profile.name
            ));
        }
        if group.setup.input_mode != Some(request.mode) {
            refusals.push(format!(
                "run group '{}' does not share this input mode; set the group's setup first",
                group.name
            ));
        }
        if request.link.is_some() && request.mode != InputMode::LinkedView {
            refusals.push("a link kind applies to Linked View only".to_owned());
        }
        if let Some(refusal) = mode_refusal(&profile, request.mode) {
            refusals.push(refusal);
        }
        if let Some(running) =
            basis.preparations.iter().find(|done| done.outcome == PreparationState::Running)
        {
            refusals.push(format!("Prepare all '{}' is Running", running.name()));
        }
        let n = basis.preparations.iter().map(|done| done.n).max().unwrap_or(0) + 1;
        let mut skipped = Vec::new();
        let mut plans = Vec::new();
        for panel in &basis.panels {
            if panel.view.trashed_at.is_some() {
                skipped.push(PanelOutcome {
                    panel_id: panel.panel_id,
                    number: panel.number,
                    view_id: panel.view.id,
                    result: PanelResult::Refused {
                        reason: format!(
                            "Panel {} is in the Project's Trash; Prepare all skips it",
                            panel.number
                        ),
                    },
                });
                continue;
            }
            plans.push(self.plan_panel(group, panel, &readiness).await?);
        }
        if plans.is_empty() {
            refusals.push(format!(
                "run group '{}' has no panel run outside the Project's Trash",
                group.name
            ));
        }
        let disk = GroupDiskPlan {
            output: output.as_ref().map(NativePath::to_path_buf).transpose()?,
            project: project.name.clone(),
            mosaic: group.name.clone(),
            n,
            folder_name: request.folder_name.clone(),
            panels: plans
                .iter()
                .map(|plan| PanelDisk {
                    number: plan.review.number,
                    view_id: plan.review.view_id,
                    results: plan.results.clone(),
                    inputs: plan.inputs.clone(),
                })
                .collect(),
            assembled: basis.assembled.clone(),
            recorded,
            kind: entry_kind(request.mode, link),
            folder_handoff: request.mode == InputMode::DirectSource
                && !profile.capability_evidence.input_list,
        };
        let disk = blocking(move || check_group_disk(&disk)).await?;
        if let Some(refusal) = location_refusal(&disk.check) {
            refusals.push(refusal);
        }
        let mut anchors = HashMap::new();
        let mut panels = Vec::with_capacity(plans.len());
        for (plan, checked) in plans.into_iter().zip(disk.panels) {
            let mut review = plan.review;
            let number = review.number;
            review.blocked.extend(checked.blocked);
            review
                .refusals
                .extend(checked.refusals.into_iter().map(|r| format!("Panel {number}: {r}")));
            let created = checked.entries.iter().filter(|entry| entry.kind.created()).count();
            review.operations = u64::try_from(created).unwrap_or(u64::MAX);
            review.footprint_bytes = footprint(&checked.entries);
            review.entries = checked.entries;
            refusals.extend(review.refusals.iter().cloned());
            anchors.insert(review.view_id, plan.anchors);
            panels.push(review);
        }
        let review = GroupPreparationReview {
            group_id: group.id,
            group_revision: group.revision,
            project_name: project.name.clone(),
            subject_name,
            mosaic_name: group.name.clone(),
            verified_profile: profile.verified(),
            unproven: profile.capability_evidence.unproven(),
            suggested_mode: suggested_mode(&profile),
            mode: request.mode,
            link,
            modes: mode_options(&profile),
            calibration_policy: group.setup.calibration_policy,
            preparation_number: n,
            location: disk.location,
            location_check: disk.check,
            operations: panels.iter().map(|panel| panel.operations).sum(),
            footprint_bytes: panels.iter().map(|panel| panel.footprint_bytes).sum(),
            free_bytes: disk.free_bytes,
            writability: disk.writability,
            panels,
            skipped,
            refusals,
            profile,
        };
        Ok(GroupPlanned { review, anchors })
    }

    /// One panel run's part of the Prepare all review: its committed
    /// selection, its own calibration choices and readiness, its inputs and
    /// its refusals.
    async fn plan_panel(
        &self,
        group: &ViewGroup,
        panel: &GroupPanel,
        readiness: &GroupCalibrationReadiness,
    ) -> Result<PanelPlan, LibraryError> {
        let catalog = self.catalog();
        let number = panel.number;
        let record = catalog.view(panel.view.id).await?;
        let view = &record.view;
        let revisions = catalog.view_preparations(view.id).await?;
        let mut refusals = Vec::new();
        if view.completion == RunCompletion::Complete {
            refusals.push(format!("Panel {number} is Complete; reopen it before preparing"));
        }
        if view.profile_id != group.setup.profile_id
            || view.calibration_policy != group.setup.calibration_policy
        {
            refusals.push(format!("Panel {number} does not hold the run group's shared setup"));
        }
        if let Some(running) =
            revisions.iter().find(|revision| revision.state == PreparationState::Running)
        {
            refusals.push(format!("Panel {number}: preparation '{}' is Running", running.name()));
        }
        let calibration_review = readiness
            .panels
            .iter()
            .find(|line| line.view_id == view.id)
            .and_then(|line| line.readiness.as_ref())
            .and_then(CalibrationReadiness::needs_review_blocker);
        let mut review = PanelPreparationReview {
            number,
            panel_id: panel.panel_id,
            view_id: view.id,
            run_name: record
                .revision
                .as_ref()
                .map(|header| header.name.clone())
                .or_else(|| record.draft.as_ref().map(|draft| draft.name.clone()))
                .unwrap_or_default(),
            membership_revision: view.revision,
            draft_unsaved: record.draft.is_some(),
            membership_changed: revisions
                .last()
                .is_some_and(|latest| latest.membership_revision != view.revision),
            preparation_number: revisions.iter().map(|revision| revision.n).max().unwrap_or(0) + 1,
            entries: Vec::new(),
            blocked: Vec::new(),
            excluded: 0,
            calibration: None,
            calibration_review,
            operations: 0,
            footprint_bytes: 0,
            refusals,
        };
        let results = catalog.view_results_folder(view.id).await?;
        if record.revision.is_none() {
            review
                .refusals
                .push(format!("Panel {number} has no saved membership; save it before preparing"));
            return Ok(PanelPlan { review, inputs: Vec::new(), results, anchors: HashMap::new() });
        }
        let basis = catalog.view_membership(view.id, Membership::Committed).await?;
        let calibration = self.calibration_handoff(view.id, view.revision).await?;
        let roots = self.input_roots(&basis, &calibration).await?;
        let ((inputs, anchors), blocked, excluded) = resolve_inputs(&basis, &calibration, &roots)?;
        if inputs.is_empty() && blocked.is_empty() {
            review.refusals.push(format!("Panel {number} has no input to prepare"));
        }
        review.blocked = blocked;
        review.excluded = excluded;
        review.calibration = Some(calibration);
        Ok(PanelPlan { review, inputs, results, anchors })
    }
}

/// What Prepare all review checks on disk, off the async runtime.
struct GroupDiskPlan {
    output: Option<PathBuf>,
    project: String,
    mosaic: String,
    n: u32,
    folder_name: Option<String>,
    panels: Vec<PanelDisk>,
    assembled: Option<NativePath>,
    recorded: RecordedFolders,
    kind: PreparedEntryKind,
    folder_handoff: bool,
}

struct PanelDisk {
    number: u32,
    view_id: Uuid,
    results: Option<NativePath>,
    inputs: Vec<SourceInput>,
}

struct PanelDiskCheck {
    entries: Vec<PlannedEntry>,
    blocked: Vec<BlockedInput>,
    refusals: Vec<String>,
}

struct GroupDiskCheck {
    location: Option<GroupLocation>,
    check: LocationCheck,
    /// In the order of [`GroupDiskPlan::panels`].
    panels: Vec<PanelDiskCheck>,
    free_bytes: Option<u64>,
    writability: Option<Writability>,
}

fn check_group_disk(plan: &GroupDiskPlan) -> Result<GroupDiskCheck, LibraryError> {
    let (location, check, writability, free_bytes) = check_group_location(plan)?;
    let output = location.as_ref().map(|location| location.output.to_path_buf()).transpose()?;
    let mut panels = Vec::with_capacity(plan.panels.len());
    for (index, panel) in plan.panels.iter().enumerate() {
        let folder = location
            .as_ref()
            .and_then(|location| location.panels.get(index))
            .map(|place| place.folder.to_path_buf())
            .transpose()?;
        let (entries, blocked) = match (folder, &output) {
            (Some(folder), Some(output)) => plan_entries(&panel.inputs, plan.kind, &folder, output),
            _ => (Vec::new(), Vec::new()),
        };
        let refusals =
            if plan.folder_handoff { folder_handoff_refusal(&panel.inputs) } else { Vec::new() };
        panels.push(PanelDiskCheck { entries, blocked, refusals });
    }
    Ok(GroupDiskCheck { location, check, panels, free_bytes, writability })
}

type GroupLocationRead = (Option<GroupLocation>, LocationCheck, Option<Writability>, Option<u64>);

fn check_group_location(plan: &GroupDiskPlan) -> Result<GroupLocationRead, LibraryError> {
    let output = match chosen_parent(plan.output.as_deref(), &plan.recorded)? {
        Ok(output) => output,
        Err(check) => return Ok((None, check, None, None)),
    };
    let paths: Vec<layout::PanelPaths<'_>> = plan
        .panels
        .iter()
        .map(|panel| layout::PanelPaths {
            number: panel.number,
            view_id: panel.view_id,
            results: panel.results.as_ref(),
        })
        .collect();
    let location = layout::group_location(
        &output,
        &plan.project,
        &plan.mosaic,
        plan.n,
        plan.folder_name.as_deref(),
        &paths,
        plan.assembled.as_ref(),
    )?;
    let folder = location.folder.to_path_buf()?;
    let project = folder.parent().unwrap_or(&output).to_path_buf();
    let free_bytes = fs4::available_space(&output).ok();
    let writable_root = match writable_root(&project, &output) {
        Ok(root) => root,
        Err(detail) => {
            let check = LocationCheck::ParentUnavailable { detail };
            return Ok((Some(location), check, None, free_bytes));
        }
    };
    let writability = crate::import::writability(&writable_root);
    let check = group_folders_check(&location, plan, &folder, &project, &writability)?;
    Ok((Some(location), check, Some(writability), free_bytes))
}

/// Whether the group folder and every Results folder recorded for the
/// first time can be created: none exists yet, and `<Mosaic> Results/` is a
/// real folder when present.
fn group_folders_check(
    location: &GroupLocation,
    plan: &GroupDiskPlan,
    folder: &Path,
    project: &Path,
    writability: &Writability,
) -> Result<LocationCheck, LibraryError> {
    if fs::symlink_metadata(folder).is_ok() {
        return Ok(LocationCheck::FolderExists { folder: location.folder.clone() });
    }
    let fresh = location
        .panels
        .iter()
        .zip(&plan.panels)
        .filter(|(_, panel)| panel.results.is_none())
        .map(|(place, _)| &place.results)
        .chain(plan.assembled.is_none().then_some(&location.assembled));
    for results in fresh {
        let path = results.to_path_buf()?;
        if fs::symlink_metadata(&path).is_ok() {
            return Ok(LocationCheck::FolderExists { folder: results.clone() });
        }
        if let Some(parent) = path.parent().filter(|parent| *parent != project) {
            if let Err(detail) = writable_root(parent, parent) {
                return Ok(LocationCheck::ParentUnavailable { detail });
            }
        }
    }
    Ok(match writability {
        Writability::NotWritable { detail } => {
            LocationCheck::NotWritable { detail: detail.clone() }
        }
        _ => LocationCheck::Ready,
    })
}

/// PREP's run lifecycle sources: Running revisions, and a Running Prepare all
/// on each of its panel runs, block Mark Complete and Move run to Trash;
/// every revision's folder (a panel run's `Panel N/` in each group folder) and
/// the run's Results folder are named for Empty Trash.
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
            let groups = library.catalog().running_group_preparations(view.id).await?;
            let revisions = library.catalog().view_preparations(view.id).await?;
            let in_group = |revision: &PreparationRevision| {
                revision.group_preparation_id.is_some_and(|id| groups.iter().any(|g| g.id == id))
            };
            let running = revisions
                .iter()
                .filter(|revision| revision.state == PreparationState::Running)
                .filter(|revision| !in_group(revision))
                .map(|revision| LifecycleBlocker::RunningOperation {
                    operation_id: revision.id,
                    operation: RunOperationKind::Preparation,
                    name: revision.name(),
                });
            Ok(groups
                .iter()
                .map(|group| LifecycleBlocker::RunningOperation {
                    operation_id: group.id,
                    operation: RunOperationKind::Preparation,
                    name: group.name(),
                })
                .chain(running)
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
