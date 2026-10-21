// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Apply (spec 066 VSEL-FR-14/20/21, 069 PREP-FR-03/04/06/09/15/16/18/19/20,
//! 071 STO-FR-10; D19, D-W81, D-W98 to D-W100, D-W108, D-W110, D-W113,
//! D-W114, D-W122, D-W123):
//! the View rebuilt from the originals, a verified swap and a safe
//! retirement of the old View.
//!
//! The sheet ([`Library::apply_preview`]) lists the new View as a folder
//! tree and every reason Apply can't run: offline originals, a changed or
//! missing pinned calibration file, Symlinks where symlinks can't be made,
//! leftovers to review, another running operation. Apply refuses a sheet the
//! Project or the Library moved past. It reserves the Project, snapshots
//! every original (identity and SHA-256, against the basis recorded when it
//! was chosen or pinned), builds a complete `View (building)/` from them
//! alone, re-verifies the originals and the entries, then swaps it in beside
//! `View/`: the old View becomes `View (previous)/` and the new one `View/`.
//! The swap is two renames, not one atomic step; the journal and the folder
//! identities it recorded let the next start restore the old View or finish
//! installing the verified new one, never a partial one. On Windows a tool
//! holding a file makes Apply wait and continue by itself; Cancel keeps the
//! old View. After the swap, ticked foreign files move into the new View and
//! the old copies are deleted only once proven, with everything else kept in
//! `View (previous)/` for review.
//!
//! A Copies View places each held frame with a recorded correction as an
//! isolated patched copy whose primary header carries the corrected values
//! (PREP-FR-03, PREP-FR-20; D-W122, provisional D-W123). A correction no
//! patched copy can carry refuses Apply before it builds, naming the
//! session, the frame and the field.
//!
//! Apply doesn't wait for files the user kept in `View (previous)/`: right
//! before the old View moves aside, they move to `View (kept)/` at their
//! paths from inside the View, numbered `-2`, `-3` … where a name is taken,
//! each move proven and nothing replaced (D-W110). A kept file gone from
//! disk is named in the report, never skipped (D-W137).

pub(crate) mod files;
mod plan;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::{ApplyInputs, ApplyReservation};
use uuid::Uuid;

use self::files::{Aside, Ours, PlannedPatch, Rename};
use self::plan::{Plan, PlanEntry, PlanInput};
use crate::custody::trash::{self, OsTrash, Retirement};
use crate::custody::{observe_entry, same_identity, transfer};
use crate::inventory::{self, observe_folder_identity};
use crate::layout::{
    self, VIEW_BUILDING_FOLDER, VIEW_FOLDER, VIEW_KEPT_FOLDER, VIEW_PREVIOUS_FOLDER,
};
use crate::library::{blocking, Library};
use crate::patched_copy::{self, HeaderPatch};
use crate::{
    ApplyBlocker, ApplyFailure, ApplyJournal, ApplyOutcome, ApplyPhase, ApplyPreview, ApplyReport,
    ApplyRequest, ApplyStop, EntryEvidence, EntryPlacement, ExpectedTree, FileIdentity,
    ForeignFile, ForeignItem, ForeignItemState, InputKind, ItemReason, LibraryError, ManifestEntry,
    NativePath, PinHealth, PreviousItem, PreviousItemReview, ReasonCode, Revision,
    SymlinkCapability, ViewFootprint, ViewManifest, ViewMode, ViewPlanEntry,
};

/// What Apply asks while it runs (PREP-FR-09, PREP-FR-18).
pub trait ApplyControl: Send + Sync {
    /// Apply reserved the Project as `operation_id`. Called once, before any
    /// other question; every later one is about this operation.
    fn reserved(&self, _operation_id: Uuid) {}

    /// The user chose Cancel: stop where it is safe. Once the new View is
    /// being installed, Apply finishes instead.
    fn canceled(&self) -> bool {
        false
    }

    /// `PlateVault` is closing: stop right after `phase` is recorded. The
    /// next start restores the old View or finishes installing the new one.
    fn interrupted(&self, _phase: ApplyPhase) -> bool {
        false
    }

    /// "Waiting for a tool to release a file in View" begins, naming the
    /// folder a tool holds a file in (`Some`), or ends (`None`).
    fn waiting(&self, _held: Option<&Path>) {}
}

/// Apply with nobody to ask: never canceled or interrupted.
#[derive(Clone, Copy, Debug, Default)]
pub struct Unattended;

impl ApplyControl for Unattended {}

/// How often Apply retries moving a View a tool holds a file in.
const RELEASE_POLL: Duration = Duration::from_millis(500);

/// The operating-system boundary Apply crosses: renaming the View folders,
/// how long to wait for a tool, and the symlink and clone probes.
#[derive(Clone, Copy)]
struct Os {
    rename: Rename,
    poll: Duration,
    symlinks: fn(&Path) -> std::io::Result<SymlinkCapability>,
    /// Whether a copy of an original made in a folder becomes a clone.
    clones: fn(&Path, &Path) -> bool,
}

impl Os {
    const SYSTEM: Self = Self {
        #[cfg(not(feature = "test-pacing"))]
        rename: transfer::rename_noreplace,
        #[cfg(feature = "test-pacing")]
        rename: pacing::rename,
        poll: RELEASE_POLL,
        symlinks: files::probe_symlinks,
        clones: files::probe_clone,
    };
}

/// A test's stand-in for a tool holding a file in a folder (PREP-FR-18), so
/// a test outside this crate (the shell's IPC tests) holds a real Apply
/// where a tool would: waiting before it moves the old View aside, until the
/// test cancels it or lets the folder go.
///
/// Keyed by folder, because tests share one process: a hold affects only the
/// Apply that moves that folder.
///
/// The whole module is behind the `test-pacing` feature, which is off by
/// default and reachable only through a `[dev-dependencies]` edge, so no
/// release binary contains a way to stall a real Apply.
#[cfg(feature = "test-pacing")]
pub mod pacing {
    use std::collections::BTreeSet;
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, MutexGuard, PoisonError};

    use crate::custody::transfer;

    static HELD: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());

    /// Recovers from poisoning: a test panicking while it holds a folder must
    /// still leave the registry usable, and a panicking `Drop` would abort.
    fn held() -> MutexGuard<'static, BTreeSet<PathBuf>> {
        HELD.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A held folder; dropping it lets go, as a tool releasing its file.
    pub struct HeldFolder(PathBuf);

    impl HeldFolder {
        /// Hold `folder`: moving it reports a busy resource, as a tool
        /// holding a file in it does, until the returned value drops.
        ///
        /// # Panics
        /// If `folder` is already held.
        #[must_use]
        pub fn hold(folder: &Path) -> Self {
            assert!(held().insert(folder.to_path_buf()), "{} is already held", folder.display());
            Self(folder.to_path_buf())
        }
    }

    impl Drop for HeldFolder {
        fn drop(&mut self) {
            held().remove(&self.0);
        }
    }

    /// The host rename, unless a test holds `from`.
    pub(super) fn rename(from: &Path, to: &Path) -> io::Result<()> {
        if held().contains(from) {
            return Err(io::Error::from(io::ErrorKind::ResourceBusy));
        }
        transfer::rename_noreplace(from, to)
    }
}

impl Library {
    /// Whether `folder` can hold the symlinks of a Symlinks View: on Windows,
    /// whether Developer Mode is on; elsewhere, whether its filesystem holds
    /// links (PREP-FR-15). Setup, Settings and the Apply sheet check it.
    ///
    /// # Errors
    /// `NotFound`, `AccessDenied` or `SourceUnavailable`, scoped to
    /// `folder`, when it can't hold a file at all.
    pub async fn check_symlinks(
        &self,
        folder: NativePath,
    ) -> Result<SymlinkCapability, LibraryError> {
        let path = folder.to_path_buf()?;
        blocking(move || {
            (Os::SYSTEM.symlinks)(&path).map_err(|error| LibraryError::from_io(&path, &error))
        })
        .await
    }

    /// The Apply sheet's backend part (VSEL-FR-14): the new View as a folder
    /// tree, every reason Apply can't run, the files `PlateVault` didn't
    /// place, the copies a tool changed, and what `View (previous)/` holds,
    /// with the footprint of the new View: which copies become clones.
    /// Reads originals' fingerprints, and only the primary header of a
    /// corrected FITS original, never their other bytes; writes nothing but
    /// the hidden symlink and clone probes it removes.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; catalog errors.
    pub async fn apply_preview(&self, project_id: Uuid) -> Result<ApplyPreview, LibraryError> {
        let inputs = self.catalog().apply_inputs(project_id).await?;
        blocking(move || Ok(preview(&inputs, Os::SYSTEM))).await
    }

    /// Apply the reviewed sheet: rebuild the View from the originals, swap
    /// it in and retire the old one (PREP-FR-06/09).
    ///
    /// # Errors
    /// `Conflict` when the Project or the Library moved since the sheet;
    /// `SymlinksUnavailable` when Windows Developer Mode is off and
    /// `LinksUnsupported` when the processing location holds no links, for
    /// a Symlinks View;
    /// `CorrectionUndeliverable` naming a held frame whose recorded
    /// correction no patched copy can carry; `InvalidInput` naming every
    /// other blocker; `IdentityConflict` when
    /// both the install and restoring the old View failed (the next start
    /// recovers); catalog errors. A build that fails or is canceled reports
    /// that outcome instead.
    pub async fn apply(
        &self,
        request: &ApplyRequest,
        control: &dyn ApplyControl,
    ) -> Result<ApplyReport, LibraryError> {
        self.apply_with(request, control, Os::SYSTEM).await
    }

    /// Finish or roll back every Apply an earlier run of `PlateVault` left
    /// unsettled, by its journal and the folder identities it recorded.
    ///
    /// # Errors
    /// Catalog errors; the first recovery that couldn't finish.
    pub async fn recover_applies(&self) -> Result<Vec<ApplyReport>, LibraryError> {
        let mut reports = Vec::new();
        for journal in self.catalog().unsettled_applies().await? {
            reports.push(self.recover(journal, Os::SYSTEM).await?);
        }
        Ok(reports)
    }

    /// Review one file `View (previous)/` still holds (D-W110): keep it
    /// where it is (never asked again), move it into `View/` at the same
    /// place, or move it to the OS Trash. A file that changed since it was
    /// recorded is refused.
    ///
    /// # Errors
    /// `NotFound` for an unknown leftover; `InvalidInput` for a review it
    /// can't take, a destination `View/` already holds, or a file that
    /// changed; `IdentityConflict` when the OS Trash can't take it.
    pub async fn review_view_leftover(
        &self,
        project_id: Uuid,
        path: NativePath,
        review: PreviousItemReview,
        os_trash: &dyn OsTrash,
    ) -> Result<(), LibraryError> {
        let inputs = self.catalog().apply_inputs(project_id).await?;
        let item = inputs
            .leftovers
            .iter()
            .find(|item| item.path == path)
            .cloned()
            .ok_or_else(|| LibraryError::NotFound(format!("leftover {}", path.display())))?;
        if !item.review.can_become(review) {
            return Err(LibraryError::InvalidInput(format!(
                "{} was already reviewed ({:?})",
                path.display(),
                item.review
            )));
        }
        let project = project_folder(&inputs)?;
        match review {
            PreviousItemReview::Pending | PreviousItemReview::Kept => {}
            PreviousItemReview::Moved => {
                let project = project.clone();
                let item = item.clone();
                blocking(move || move_leftover(&project, &item)).await?;
            }
            PreviousItemReview::Trashed => {
                match trash::retire(os_trash, &item.evidence, &[], || Ok(())) {
                    Retirement::Moved => {}
                    Retirement::Unsupported(reason)
                    | Retirement::Blocked(reason)
                    | Retirement::Uncertain(reason) => {
                        return Err(LibraryError::IdentityConflict(reason.detail));
                    }
                }
            }
        }
        self.catalog().review_previous_item(project_id, &path, review).await?;
        if matches!(review, PreviousItemReview::Moved | PreviousItemReview::Trashed) {
            let previous = project.join(VIEW_PREVIOUS_FOLDER);
            let gone = blocking(move || {
                if files::holds_nothing(&previous) {
                    files::remove_empty_folders(&previous);
                }
                Ok(fs::symlink_metadata(&previous).is_err())
            })
            .await?;
            if gone {
                self.catalog().retire_previous_view(project_id).await?;
            }
        }
        Ok(())
    }

    async fn apply_with(
        &self,
        request: &ApplyRequest,
        control: &dyn ApplyControl,
        os: Os,
    ) -> Result<ApplyReport, LibraryError> {
        let inputs = self.catalog().apply_inputs(request.project_id).await?;
        if inputs.desired_revision != request.desired_revision
            || inputs.basis_digest != request.basis_digest
        {
            return Err(LibraryError::Conflict {
                id: request.project_id,
                current: inputs.desired_revision,
                successors: Vec::new(),
            });
        }
        let inputs = Arc::new(inputs);
        let shared = Arc::clone(&inputs);
        let checked = blocking(move || Ok(check(&shared, os))).await?;
        if !checked.blockers.is_empty() {
            return Err(refusal(&checked.blockers));
        }
        let (Some(project), Some(plan)) = (checked.project, checked.plan) else {
            return Err(LibraryError::InvalidInput("nothing to apply".into()));
        };
        let previous_gone = checked.previous_gone;
        let kept_missing = checked.kept_missing;
        let folder = project.clone();
        let expected = blocking(move || prepare_tree(&folder, previous_gone)).await?;
        let reserved = self
            .catalog()
            .reserve_apply(&ApplyReservation {
                project_id: request.project_id,
                desired_revision: request.desired_revision,
                basis_digest: &request.basis_digest,
                names: &plan.names,
                expected: &expected,
                previous_gone,
            })
            .await?;
        control.reserved(reserved.operation_id);
        let journal = ApplyJournal {
            operation_id: reserved.operation_id,
            project_id: request.project_id,
            generation: reserved.generation,
            phase: ApplyPhase::Reserved,
            settled_from: None,
            outcome: None,
            expected,
            stop: None,
        };
        let ticked: BTreeSet<PathBuf> =
            request.ticked.iter().filter_map(|path| path.relative_path().ok()).collect();
        let mut run = Run {
            library: self,
            control,
            os,
            journal,
            project,
            inputs,
            snapshots: Arc::new(BTreeMap::new()),
            patches: Arc::new(BTreeMap::new()),
            built: Vec::new(),
            failures: Vec::new(),
            building_made: false,
            kept_missing,
        };
        // What the reservation left, which the swap reads again (plan §3).
        let after = self.catalog().apply_inputs(request.project_id).await?;
        let Some(reserved) = Reserved::of(&run.inputs, &after) else {
            return run.end(ApplyStop::CatalogMoved).await;
        };
        run.build(plan, &ticked, &reserved).await
    }

    /// Recover one unsettled Apply after a restart.
    async fn recover(&self, journal: ApplyJournal, os: Os) -> Result<ApplyReport, LibraryError> {
        let root = journal.expected.root.to_path_buf()?;
        let expected = journal.expected.clone();
        let phase = journal.phase;
        let installed =
            blocking(move || Ok(recover_folders(&root, &expected, phase, os.rename))).await?;
        let inputs = Arc::new(self.catalog().apply_inputs(journal.project_id).await?);
        let project = journal.expected.root.to_path_buf()?;
        let mut run = Run {
            library: self,
            control: &Unattended,
            os,
            journal,
            project,
            inputs,
            snapshots: Arc::new(BTreeMap::new()),
            patches: Arc::new(BTreeMap::new()),
            built: Vec::new(),
            failures: Vec::new(),
            building_made: false,
            kept_missing: Vec::new(),
        };
        match installed {
            Recovered::Installed => {
                if before(run.journal.phase, ApplyPhase::NewInstalled) {
                    run.advance(ApplyPhase::NewInstalled, None).await?;
                }
                run.finish_installed().await
            }
            Recovered::NotInstalled => run.end(ApplyStop::Interrupted).await,
            Recovered::Stuck(detail) => Err(LibraryError::IdentityConflict(detail)),
        }
    }
}

/// Recover unsettled Applies when the library opens; one that can't finish
/// stays reserved and is retried at the next start.
pub(crate) async fn reconcile(library: &Library) {
    if let Ok(journals) = library.catalog().unsettled_applies().await {
        for journal in journals {
            let _ = library.recover(journal, Os::SYSTEM).await;
        }
    }
}

/// Whether `phase` comes before `other` in an Apply's journal.
const fn before(phase: ApplyPhase, other: ApplyPhase) -> bool {
    phase.rank() < other.rank()
}

/// The Apply refusal: `SymlinksUnavailable` when Windows Developer Mode is
/// off (PREP-FR-15, PREP-AC-08), else `LinksUnsupported` scoped to a
/// processing location that holds no links (PREP-AC-03), else
/// `CorrectionUndeliverable` for the first held frame whose correction no
/// patched copy can carry (PREP-FR-03), else `SessionNotReady` naming the
/// first held session that isn't Ready (FR-034; D-W100, D-W140), else
/// `InvalidInput`, naming every blocker.
fn refusal(blockers: &[ApplyBlocker]) -> LibraryError {
    let message = blockers.iter().map(ApplyBlocker::describe).collect::<Vec<_>>().join("; ");
    if blockers.contains(&ApplyBlocker::SymlinksUnavailable) {
        return LibraryError::SymlinksUnavailable(message);
    }
    for blocker in blockers {
        if let ApplyBlocker::LinksUnsupported { path } = blocker {
            return LibraryError::Context {
                error: Box::new(LibraryError::LinksUnsupported(message)),
                scope: Some(path.clone()),
                identity: None,
            };
        }
    }
    for blocker in blockers {
        if let ApplyBlocker::CorrectionUndeliverable { session_id, path, field, refusal } = blocker
        {
            return LibraryError::CorrectionUndeliverable {
                identity: *session_id,
                path: Some(path.clone()),
                field: field.clone(),
                refusal: *refusal,
            };
        }
    }
    for blocker in blockers {
        if let ApplyBlocker::SessionNotReady { session_id, .. } = blocker {
            return LibraryError::SessionNotReady(message).concerning(*session_id);
        }
    }
    LibraryError::InvalidInput(message)
}

fn project_folder(inputs: &ApplyInputs) -> Result<PathBuf, LibraryError> {
    let parent = inputs
        .parent
        .as_ref()
        .ok_or_else(|| LibraryError::InvalidInput("no processing location is chosen".into()))?;
    layout::project_folder(&parent.to_path_buf()?, &inputs.name)
}

// ── The sheet ────────────────────────────────────────────────────────────────

/// What the preflight found.
struct Checked {
    blockers: Vec<ApplyBlocker>,
    plan: Option<Plan>,
    project: Option<PathBuf>,
    /// `View (previous)/` is absent or holds nothing.
    previous_gone: bool,
    /// The kept files of `View (previous)/` gone from disk (D-W137).
    kept_missing: Vec<NativePath>,
    /// The current View's files `PlateVault` didn't place (VSEL-FR-20).
    foreign: Vec<(PathBuf, EntryEvidence)>,
}

fn preview(inputs: &ApplyInputs, os: Os) -> ApplyPreview {
    let checked = check(inputs, os);
    let mut clones = Clones {
        folder: checked.project.as_deref().and_then(Path::parent),
        probe: os.clones,
        volumes: BTreeMap::new(),
    };
    let entries: Vec<ViewPlanEntry> = checked
        .plan
        .iter()
        .flat_map(|plan| &plan.entries)
        .map(|entry| ViewPlanEntry {
            path: NativePath::from_path(&entry.path),
            source: entry.source,
            placement: clones.placement(entry, &inputs.sources),
            size_bytes: entry.basis.size_bytes,
        })
        .collect();
    let footprint =
        ViewFootprint::of(entries.iter().map(|entry| (entry.placement, entry.size_bytes)));
    let changed_copies = match (&checked.project, &inputs.installed) {
        (Some(project), Some(installed)) => changed_copies(&project.join(VIEW_FOLDER), installed),
        _ => Vec::new(),
    };
    let foreign = checked
        .foreign
        .into_iter()
        .map(|(path, evidence)| ForeignFile { path: NativePath::from_path(&path), evidence })
        .collect();
    ApplyPreview {
        project_id: inputs.project_id,
        desired_revision: inputs.desired_revision,
        applied_generation: inputs.installed.as_ref().map(|manifest| manifest.generation),
        basis_digest: inputs.basis_digest.clone(),
        project_folder: checked.project.as_deref().map(NativePath::from_path),
        mode: inputs.basis.mode,
        entries,
        footprint,
        foreign,
        changed_copies,
        leftovers: inputs.leftovers.clone(),
        blockers: checked.blockers,
    }
}

/// Which Copies entries the build makes as copy-on-write clones
/// (PREP-FR-04, PREP-AC-25): those whose original clones into the
/// processing location, probed once per volume the originals are on.
struct Clones<'a> {
    folder: Option<&'a Path>,
    probe: fn(&Path, &Path) -> bool,
    volumes: BTreeMap<u64, bool>,
}

impl Clones<'_> {
    /// `entry`'s placement as the build makes it: a Copies entry is a clone
    /// where its original's volume clones into the processing location; a
    /// patched copy never is.
    fn placement(
        &mut self,
        entry: &PlanEntry,
        sources: &BTreeMap<Uuid, persistence_library::SourcePath>,
    ) -> EntryPlacement {
        if entry.placement != EntryPlacement::Copy || entry.patch.is_some() {
            return entry.placement;
        }
        let Some(folder) = self.folder else { return entry.placement };
        let Some(original) =
            sources.get(&entry.source_id).and_then(|source| source.path.to_path_buf().ok())
        else {
            return entry.placement;
        };
        let Some(volume) = files::clone_volume(&original) else { return entry.placement };
        let probe = self.probe;
        if *self.volumes.entry(volume).or_insert_with(|| probe(&original, folder)) {
            EntryPlacement::Clone
        } else {
            entry.placement
        }
    }
}

/// The paths of `installed`'s entries, relative to `View/`.
fn placed(installed: &ViewManifest) -> BTreeSet<PathBuf> {
    installed.entries.iter().filter_map(|entry| entry.path.relative_path().ok()).collect()
}

/// Each entry a walk couldn't read, as the sheet's blocker naming it.
fn unreadable_blockers(unreadable: files::Unreadable) -> impl Iterator<Item = ApplyBlocker> {
    unreadable.into_iter().map(|(path, why)| ApplyBlocker::ViewUnreadable {
        path: NativePath::from_path(&path),
        reason: why.code,
    })
}

/// The current View's copies that differ from what `PlateVault` placed
/// (VSEL-AC-28, VSEL-AC-32): each re-read to the bytes it placed, a patched
/// copy's being the digest it was proven to hold. Only a size change shows
/// without reading; an equal time proves nothing (VSEL-FR-14).
fn changed_copies(view: &Path, installed: &ViewManifest) -> Vec<NativePath> {
    installed
        .entries
        .iter()
        .filter(|entry| entry.placement != EntryPlacement::Symlink)
        .filter(|entry| {
            let Ok(relative) = entry.path.relative_path() else { return false };
            let path = view.join(relative);
            match inventory::probe_fingerprint(&path) {
                // A patched copy's header may have grown; its digest decides.
                Ok(now)
                    if entry.patched_sha256.is_none()
                        && now.size_bytes != entry.source_fingerprint.size_bytes =>
                {
                    true
                }
                Ok(_) => !files::holds_placed_copy(&path, entry),
                Err(_) => fs::symlink_metadata(&path).is_ok(),
            }
        })
        .map(|entry| entry.path.clone())
        .collect()
}

/// Every reason Apply can't run now, the copies it would place and the
/// layout, from fingerprints alone.
fn check(inputs: &ApplyInputs, os: Os) -> Checked {
    let mut blockers = Vec::new();
    if !inputs.lifecycle.is_open() {
        blockers.push(ApplyBlocker::ProjectLocked { lifecycle: inputs.lifecycle });
    }
    if let Some(running) = &inputs.running {
        blockers
            .push(ApplyBlocker::OperationRunning { operation_id: running.id, kind: running.kind });
    }
    let pending =
        inputs.leftovers.iter().filter(|item| item.review == PreviousItemReview::Pending).count();
    if pending > 0 {
        blockers.push(ApplyBlocker::LeftoversPending {
            count: u64::try_from(pending).unwrap_or(u64::MAX),
        });
    }
    for (session_id, kinds) in &inputs.unsettled {
        blockers.push(ApplyBlocker::CalibrationUnsettled {
            session_id: *session_id,
            kinds: kinds.clone(),
        });
    }
    // A held session's review never reaches a Closed or Archived Project,
    // which reads only Locked (LIB-AC-22).
    if inputs.lifecycle.is_open() {
        for (session_id, readiness) in &inputs.not_ready {
            blockers.push(ApplyBlocker::SessionNotReady {
                session_id: *session_id,
                readiness: *readiness,
            });
        }
    }
    let mut project = None;
    let mut found = Found::default();
    match &inputs.parent {
        None => blockers.push(ApplyBlocker::NoProcessingLocation),
        Some(parent) => match location(parent, &inputs.name) {
            Err(blocker) => blockers.push(blocker),
            Ok((parent, folder)) => {
                found = folder_blockers(inputs, &folder, &mut blockers);
                if inputs.basis.mode == ViewMode::Symlinks {
                    if let Some(blocker) = symlink_blocker(&parent, (os.symlinks)(&parent)) {
                        blockers.push(blocker);
                    }
                }
                project = Some(folder);
            }
        },
    }
    let online: BTreeSet<Uuid> = inputs
        .locations
        .values()
        .filter(|location| inventory::validate_location_root(location).is_ok())
        .map(|location| location.id)
        .collect();
    let chosen = choose_copies(inputs, &online, &mut blockers);
    pin_health(inputs, &online, &mut blockers);
    let mut plan = match plan::plan(&PlanInput {
        basis: &inputs.basis,
        metadata: &inputs.metadata,
        sources: &inputs.sources,
        names: &inputs.names,
        chosen: &chosen,
    }) {
        Ok(plan) => Some(plan),
        Err(blocker) => {
            blockers.push(blocker);
            None
        }
    };
    if let Some(plan) = &mut plan {
        patch_corrections(inputs, plan, &mut blockers);
    }
    let mut seen = BTreeSet::new();
    blockers.retain(|blocker| seen.insert(format!("{blocker:?}")));
    Checked {
        blockers,
        plan,
        project,
        previous_gone: found.previous_gone,
        kept_missing: found.kept_missing,
        foreign: found.foreign,
    }
}

/// Every held frame placed with a recorded correction is an isolated
/// patched copy carrying it (PREP-FR-03, PREP-FR-20; D-W122): its entry
/// takes the reviewed change, as a Copy also in a Symlinks View, which
/// holds symlinks beside such copies (PREP-FR-04), so the sheet's footprint
/// counts its bytes. A frame the patched-copy seam refuses, a value its
/// header can't hold or an input neither FITS nor XISF, is a named blocker,
/// so Apply refuses before it builds and the source value never reaches
/// the tool (D-W123).
fn patch_corrections(inputs: &ApplyInputs, plan: &mut Plan, blockers: &mut Vec<ApplyBlocker>) {
    for entry in &mut plan.entries {
        let Some(corrected) = inputs.corrected.get(&entry.source_id) else { continue };
        let Some(source) = inputs.sources.get(&entry.source_id) else { continue };
        let changes = patched_copy::corrections(&corrected.observed, &corrected.effective);
        if changes.is_empty() {
            continue;
        }
        let checked = source
            .path
            .to_path_buf()
            .map_or(Ok(()), |path| patched_copy::check(&path, corrected.format, &changes));
        match checked {
            Ok(()) => {
                entry.placement = EntryPlacement::Copy;
                entry.patch = Some(HeaderPatch { format: corrected.format, changes });
            }
            Err(refused) => blockers.push(ApplyBlocker::CorrectionUndeliverable {
                session_id: corrected.session_id,
                path: source.path.clone(),
                field: refused.field,
                refusal: refused.reason,
            }),
        }
    }
}

/// The processing location as a real folder, and the Project folder in it.
fn location(parent: &NativePath, name: &str) -> Result<(PathBuf, PathBuf), ApplyBlocker> {
    let unavailable = |detail: String| ApplyBlocker::ProcessingLocationUnavailable {
        path: parent.clone(),
        detail,
    };
    let path = parent.to_path_buf().map_err(|error| unavailable(error.to_string()))?;
    match fs::metadata(&path) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return Err(unavailable("it is not a folder".into())),
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "the processing location can't be read");
            return Err(unavailable("it is missing or can't be read".into()));
        }
    }
    let folder =
        layout::project_folder(&path, name).map_err(|error| unavailable(error.to_string()))?;
    Ok((path, folder))
}

/// The blocker a Symlinks View meets in `parent`, by what the probe found
/// there: Windows Developer Mode off (PREP-AC-08), a filesystem without
/// links (PREP-AC-03), or a folder that can't hold a file at all.
fn symlink_blocker(
    parent: &Path,
    probed: std::io::Result<SymlinkCapability>,
) -> Option<ApplyBlocker> {
    match probed {
        Ok(SymlinkCapability::Available) => None,
        Ok(SymlinkCapability::DeveloperModeOff) => Some(ApplyBlocker::SymlinksUnavailable),
        Ok(SymlinkCapability::Unsupported) => {
            Some(ApplyBlocker::LinksUnsupported { path: NativePath::from_path(parent) })
        }
        Err(error) => {
            tracing::warn!(path = %parent.display(), %error, "the processing location can't hold a file");
            Some(ApplyBlocker::ProcessingLocationUnavailable {
                path: NativePath::from_path(parent),
                detail: "it can't hold a file".into(),
            })
        }
    }
}

/// What the Project folder holds that the sheet reports.
struct Found {
    /// `View (previous)/` is absent or holds nothing.
    previous_gone: bool,
    /// The files the user kept in `View (previous)/` that are gone from
    /// disk (D-W137), relative to the Project folder.
    kept_missing: Vec<NativePath>,
    /// The current View's files `PlateVault` didn't place.
    foreign: Vec<(PathBuf, EntryEvidence)>,
}

impl Default for Found {
    fn default() -> Self {
        Self { previous_gone: true, kept_missing: Vec::new(), foreign: Vec::new() }
    }
}

/// What the Project folder holds that keeps Apply from running, whether
/// `View (previous)/` is absent or empty, the kept files gone from it and
/// the current View's foreign files; an entry of either View that can't be
/// read is a blocker naming it, never left out (VSEL-FR-20, STO-FR-05/16).
fn folder_blockers(inputs: &ApplyInputs, folder: &Path, blockers: &mut Vec<ApplyBlocker>) -> Found {
    let Ok(metadata) = fs::symlink_metadata(folder) else { return Found::default() };
    if fs_pathsafe::is_link_or_junction_metadata(&metadata) || !metadata.is_dir() {
        blockers.push(ApplyBlocker::ProjectFolderOccupied { path: NativePath::from_path(folder) });
        return Found::default();
    }
    let building = folder.join(VIEW_BUILDING_FOLDER);
    if fs::symlink_metadata(&building).is_ok() {
        let ours = observe_folder_identity(&building).is_ok_and(|identity| {
            inputs
                .failed_building
                .as_ref()
                .is_some_and(|recorded| same_identity(&identity, recorded))
        });
        if !ours {
            blockers
                .push(ApplyBlocker::BuildingOccupied { path: NativePath::from_path(&building) });
        }
    }
    let previous = folder.join(VIEW_PREVIOUS_FOLDER);
    let previous_gone = fs::symlink_metadata(&previous).is_err() || files::holds_nothing(&previous);
    if !previous_gone {
        if let Err(unreadable) = files::files_below(&previous) {
            blockers.extend(unreadable_blockers(unreadable));
        }
    }
    let kept_missing = kept_missing(inputs, folder);
    let mut foreign = Vec::new();
    if let Some(installed) = &inputs.installed {
        match files::foreign_files(&folder.join(VIEW_FOLDER), &placed(installed)) {
            Ok(found) => foreign = found,
            Err(unreadable) => blockers.extend(unreadable_blockers(unreadable)),
        }
    }
    if inputs.installed.is_none() {
        let occupied = fs::read_dir(folder).into_iter().flatten().flatten().any(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            !matches!(
                name.as_ref(),
                layout::PROCESSING_FOLDER
                    | layout::OUTPUT_FOLDER
                    | VIEW_BUILDING_FOLDER
                    | VIEW_PREVIOUS_FOLDER
                    | VIEW_KEPT_FOLDER
            )
        });
        if occupied {
            blockers
                .push(ApplyBlocker::ProjectFolderOccupied { path: NativePath::from_path(folder) });
        }
    }
    Found { previous_gone, kept_missing, foreign }
}

/// The files the user kept in `View (previous)/` that are gone from disk,
/// which Apply names rather than skips (D-W137).
fn kept_missing(inputs: &ApplyInputs, folder: &Path) -> Vec<NativePath> {
    let previous = folder.join(VIEW_PREVIOUS_FOLDER);
    inputs
        .leftovers
        .iter()
        .filter(|item| item.review == PreviousItemReview::Kept)
        .filter(|item| {
            files::in_previous(&item.path).is_some_and(|relative| {
                fs::symlink_metadata(previous.join(relative))
                    .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
            })
        })
        .map(|item| item.path.clone())
        .collect()
}

/// The copy each included capture places: its first copy on an online
/// location, which must still be the file its basis recorded. A capture with
/// no online copy is offline (VSEL-AC-31).
fn choose_copies(
    inputs: &ApplyInputs,
    online: &BTreeSet<Uuid>,
    blockers: &mut Vec<ApplyBlocker>,
) -> BTreeMap<Uuid, Uuid> {
    let mut chosen = BTreeMap::new();
    let captures = inputs
        .basis
        .groups
        .iter()
        .flat_map(|group| &group.sessions)
        .flat_map(|session| &session.captures)
        .filter(|capture| capture.included);
    for capture in captures {
        let mut first_offline = None;
        let mut placed = false;
        for copy in &capture.copies {
            let Some(source) = inputs.sources.get(&copy.asset_id) else { continue };
            if !online.contains(&source.location_id) {
                first_offline.get_or_insert(source);
                continue;
            }
            let Ok(path) = source.path.to_path_buf() else { continue };
            match inventory::probe_fingerprint(&path) {
                Ok(now) if files::same_file(&now, &copy.fingerprint) => {}
                Ok(_) => blockers.push(ApplyBlocker::OriginalChanged {
                    path: source.path.clone(),
                    detail: "changed since it was added to the Project".into(),
                }),
                Err(error) => {
                    tracing::warn!(path = %path.display(), %error, "an original can't be read");
                    blockers.push(ApplyBlocker::OriginalChanged {
                        path: source.path.clone(),
                        detail: "can't be read".into(),
                    });
                }
            }
            chosen.insert(capture.capture_key, copy.asset_id);
            placed = true;
            break;
        }
        if let (false, Some(source)) = (placed, first_offline) {
            blockers.push(ApplyBlocker::OriginalOffline {
                path: source.path.clone(),
                location_id: source.location_id,
            });
        }
    }
    chosen
}

/// A pinned kind whose file changed or went missing refuses Apply with its
/// file name and the session's Reassign action (D-W113); an offline file is
/// reported as offline.
fn pin_health(inputs: &ApplyInputs, online: &BTreeSet<Uuid>, blockers: &mut Vec<ApplyBlocker>) {
    for session in inputs.basis.groups.iter().flat_map(|group| &group.sessions) {
        if !session.captures.iter().any(|capture| capture.included) {
            continue;
        }
        for kind in [InputKind::Bias, InputKind::Dark, InputKind::Flat] {
            let Some(target) = session.calibration.kind(kind).target() else { continue };
            let mut health = PinHealth::Intact;
            let mut drift_path = None;
            for file in &target.files {
                let id = match target.input {
                    crate::InputRef::Master { master_id, .. } => master_id,
                    crate::InputRef::RawSet { .. } => match file.asset_id {
                        Some(asset_id) => asset_id,
                        None => continue,
                    },
                };
                let Some(source) = inputs.sources.get(&id) else {
                    health = PinHealth::Missing;
                    continue;
                };
                if !online.contains(&source.location_id) {
                    blockers.push(ApplyBlocker::OriginalOffline {
                        path: source.path.clone(),
                        location_id: source.location_id,
                    });
                    continue;
                }
                let observed = source
                    .path
                    .to_path_buf()
                    .ok()
                    .and_then(|path| inventory::probe_fingerprint(&path).ok());
                match observed {
                    None => {
                        health = PinHealth::Missing;
                        drift_path.get_or_insert_with(|| source.path.clone());
                    }
                    Some(now) if !files::same_file(&now, &file.fingerprint) => {
                        if health == PinHealth::Intact {
                            health = PinHealth::Changed;
                        }
                        drift_path.get_or_insert_with(|| source.path.clone());
                    }
                    Some(_) => {}
                }
            }
            if health.blocks_apply() {
                let session_id = session.session_id;
                blockers.push(ApplyBlocker::PinDrift {
                    session_id,
                    kind,
                    path: drift_path,
                    health,
                });
            }
        }
    }
}

/// Make the Project folder if it is missing, remove an empty
/// `View (previous)/`, and record the identities the swap expects.
fn prepare_tree(project: &Path, previous_gone: bool) -> Result<ExpectedTree, LibraryError> {
    match fs::create_dir(project) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(LibraryError::from_io(project, &error)),
    }
    if previous_gone {
        files::remove_empty_folders(&project.join(VIEW_PREVIOUS_FOLDER));
    }
    let view = project.join(VIEW_FOLDER);
    Ok(ExpectedTree {
        root: NativePath::from_path(project),
        root_identity: observe_folder_identity(project)?,
        view: fs::symlink_metadata(&view)
            .is_ok()
            .then(|| observe_folder_identity(&view))
            .transpose()?,
        building: None,
        previous: None,
    })
}

// ── One Apply ────────────────────────────────────────────────────────────────

/// How recovery found the folders of an interrupted Apply.
enum Recovered {
    /// The verified new View is `View/`, or was just renamed there.
    Installed,
    /// The new View was never installed; the old View is in place: the
    /// Apply ends [`ApplyStop::Interrupted`].
    NotInstalled,
    /// Neither could be proven; nothing was touched.
    Stuck(String),
}

/// Put the folders of an interrupted Apply back in a state its journal can
/// settle: an Apply that recorded `NewInstalled`, or whose `View/` already is
/// the verified build, finishes; one that moved the old View aside without
/// installing the new one moves it back.
fn recover_folders(
    root: &Path,
    expected: &ExpectedTree,
    phase: ApplyPhase,
    rename: Rename,
) -> Recovered {
    let view = root.join(VIEW_FOLDER);
    let building = root.join(VIEW_BUILDING_FOLDER);
    let previous = root.join(VIEW_PREVIOUS_FOLDER);
    let is = |path: &Path, identity: Option<&FileIdentity>| {
        identity.is_some_and(|identity| {
            observe_folder_identity(path).is_ok_and(|observed| same_identity(&observed, identity))
        })
    };
    if before(phase, ApplyPhase::BuildVerified) {
        return Recovered::NotInstalled;
    }
    if is(&view, expected.building.as_ref()) {
        return Recovered::Installed;
    }
    if !before(phase, ApplyPhase::NewInstalled) {
        if fs::symlink_metadata(&view).is_err() && is(&building, expected.building.as_ref()) {
            return match rename(&building, &view) {
                Ok(()) => Recovered::Installed,
                Err(error) => {
                    Recovered::Stuck(format!("installing {} failed: {error}", building.display()))
                }
            };
        }
        return Recovered::Stuck(format!("{} is not the View this Apply built", view.display()));
    }
    if fs::symlink_metadata(&view).is_err() && is(&previous, expected.view.as_ref()) {
        return match rename(&previous, &view) {
            Ok(()) => Recovered::NotInstalled,
            Err(error) => Recovered::Stuck(format!("restoring {} failed: {error}", view.display())),
        };
    }
    Recovered::NotInstalled
}

/// What an installed View delivers: its isolated patched copies
/// (PREP-FR-03), "N corrected values written to patched copies", and its
/// footprint as the build placed it (PREP-FR-04).
#[derive(Clone, Copy, Debug, Default)]
struct Delivered {
    /// One per held session and corrected field.
    corrected_values: u64,
    patched_copies: u64,
    footprint: ViewFootprint,
}

impl Delivered {
    fn of(manifest: &ViewManifest) -> Self {
        let session_of: BTreeMap<Uuid, Uuid> = manifest
            .basis
            .groups
            .iter()
            .flat_map(|group| &group.sessions)
            .flat_map(|session| {
                session.captures.iter().map(|capture| (capture.capture_key, session.session_id))
            })
            .collect();
        let patched: Vec<&ManifestEntry> =
            manifest.entries.iter().filter(|entry| !entry.header_patch.is_empty()).collect();
        let values: BTreeSet<(Option<Uuid>, &str)> = patched
            .iter()
            .flat_map(|entry| {
                let session = match entry.source {
                    crate::EntrySource::Light { capture_key, .. } => {
                        session_of.get(&capture_key).copied()
                    }
                    _ => None,
                };
                entry.header_patch.iter().map(move |change| (session, change.field.as_str()))
            })
            .collect();
        let count = |n: usize| u64::try_from(n).unwrap_or(u64::MAX);
        Self {
            corrected_values: count(values.len()),
            patched_copies: count(patched.len()),
            footprint: ViewFootprint::of(
                manifest
                    .entries
                    .iter()
                    .map(|entry| (entry.placement, entry.source_fingerprint.size_bytes)),
            ),
        }
    }
}

/// The catalog state one Apply builds against, read right after its
/// reservation, which the swap reads again (plan §3): any desired-state
/// edit moves the Project revision, and any global change the basis
/// carries (a review, a calibration pin, a correction) moves the digest.
struct Reserved {
    desired_revision: Revision,
    /// The basis digest with the entry names the reservation added.
    basis_digest: String,
    /// The manifest generation the new View replaces.
    applied_generation: Option<Revision>,
}

impl Reserved {
    /// `after`, read once the reservation committed, when it is still the
    /// state `before` planned from. Reserving adds only entry names, which
    /// move the digest, so the parts an edit moves are compared instead: a
    /// different revision, basis, correction or installed View means an
    /// edit landed between the two reads.
    fn of(before: &ApplyInputs, after: &ApplyInputs) -> Option<Self> {
        let unmoved = after.desired_revision == before.desired_revision
            && after.basis == before.basis
            && after.corrected == before.corrected
            && applied_generation(after) == applied_generation(before);
        unmoved.then(|| Self {
            desired_revision: after.desired_revision,
            basis_digest: after.basis_digest.clone(),
            applied_generation: applied_generation(after),
        })
    }

    /// Whether `now` is still the reserved state, with the Project still
    /// held by this Apply's operation.
    fn holds(&self, now: &ApplyInputs, operation_id: Uuid) -> bool {
        now.desired_revision == self.desired_revision
            && now.basis_digest == self.basis_digest
            && applied_generation(now) == self.applied_generation
            && now.running.as_ref().is_some_and(|running| running.id == operation_id)
    }
}

fn applied_generation(inputs: &ApplyInputs) -> Option<Revision> {
    inputs.installed.as_ref().map(|manifest| manifest.generation)
}

/// One Apply from its reservation to its settlement.
struct Run<'a> {
    library: &'a Library,
    control: &'a dyn ApplyControl,
    os: Os,
    journal: ApplyJournal,
    project: PathBuf,
    inputs: Arc<ApplyInputs>,
    /// Each original's snapshot, by asset or master id.
    snapshots: Arc<BTreeMap<Uuid, EntryEvidence>>,
    /// Each patched copy the build plans, by entry path.
    patches: Arc<BTreeMap<PathBuf, PlannedPatch>>,
    built: Vec<ManifestEntry>,
    failures: Vec<ApplyFailure>,
    building_made: bool,
    /// The kept files of `View (previous)/` found gone from disk (D-W137).
    kept_missing: Vec<NativePath>,
}

impl Run<'_> {
    fn building(&self) -> PathBuf {
        self.project.join(VIEW_BUILDING_FOLDER)
    }

    async fn advance(
        &mut self,
        phase: ApplyPhase,
        expected: Option<ExpectedTree>,
    ) -> Result<(), LibraryError> {
        self.library
            .catalog()
            .advance_apply(self.journal.operation_id, phase, expected.as_ref())
            .await?;
        self.journal.phase = phase;
        if let Some(expected) = expected {
            self.journal.expected = expected;
        }
        Ok(())
    }

    fn report(
        &self,
        outcome: Option<ApplyOutcome>,
        foreign: Vec<ForeignItem>,
        leftovers: Vec<PreviousItem>,
        delivered: Delivered,
    ) -> ApplyReport {
        ApplyReport {
            project_id: self.journal.project_id,
            operation_id: self.journal.operation_id,
            generation: self.journal.generation,
            outcome,
            failures: self.failures.clone(),
            foreign,
            leftovers,
            kept_missing: self.kept_missing.clone(),
            corrected_values: delivered.corrected_values,
            patched_copies: delivered.patched_copies,
            footprint: delivered.footprint,
            stop: self.journal.stop,
        }
    }

    /// `PlateVault` is closing: stop here, the journal unsettled.
    fn interrupted(&self) -> Option<ApplyReport> {
        self.control
            .interrupted(self.journal.phase)
            .then(|| self.report(None, Vec::new(), Vec::new(), Delivered::default()))
    }

    /// End before the new View is installed, Failed or Canceled as `stop`
    /// says: the old View stays. The report carries only the code; what
    /// led to it was logged where it happened.
    async fn end(&mut self, stop: ApplyStop) -> Result<ApplyReport, LibraryError> {
        let outcome = stop.outcome();
        tracing::info!(
            operation_id = %self.journal.operation_id,
            project_id = %self.journal.project_id,
            ?stop,
            "Apply ended {outcome:?}; the current View is unchanged"
        );
        if outcome == ApplyOutcome::Canceled && self.building_made {
            let building = self.building();
            let ours = self.ours();
            blocking(move || Ok(files::clear_building(&building, &ours))).await?;
        }
        self.journal.stop = Some(stop);
        self.library.catalog().discard_apply(&self.journal, stop, &self.built).await?;
        Ok(self.report(Some(outcome), Vec::new(), Vec::new(), Delivered::default()))
    }

    async fn cancel(&mut self) -> Result<ApplyReport, LibraryError> {
        self.end(ApplyStop::Canceled).await
    }

    /// What a `View (building)/` may hold of this Apply's own: copies of the
    /// snapshotted originals and the patched copies it plans.
    fn ours(&self) -> Ours {
        Ours {
            digests: self
                .snapshots
                .values()
                .filter_map(|snapshot| snapshot.sha256.clone())
                .collect(),
            patches: Arc::clone(&self.patches),
        }
    }

    /// Record each failure for the report; how many there were.
    fn record(&mut self, failures: Vec<(PathBuf, ItemReason)>) -> u64 {
        let count = u64::try_from(failures.len()).unwrap_or(u64::MAX);
        self.failures.extend(failures.into_iter().map(|(path, reason)| ApplyFailure {
            reason: files::reported(&path, &reason),
            path: NativePath::from_path(&path),
        }));
        count
    }

    /// A fresh `View (building)/`, after clearing one an earlier failed
    /// Apply of this Project left; the files that clearing couldn't prove
    /// its own instead.
    async fn make_building(&self) -> Result<Result<FileIdentity, Vec<PathBuf>>, LibraryError> {
        let building = self.building();
        let ours = self.ours();
        blocking(move || {
            if fs::symlink_metadata(&building).is_ok() {
                let kept = files::clear_building(&building, &ours);
                if !kept.is_empty() {
                    return Ok(Err(kept));
                }
            }
            fs::create_dir(&building).map_err(|error| LibraryError::from_io(&building, &error))?;
            Ok(Ok(observe_folder_identity(&building)?))
        })
        .await
    }

    /// Every original the plan places, snapshotted once: its identity and
    /// SHA-256 against the basis it was chosen or pinned with (D19).
    async fn snapshot_sources(
        &self,
        plan: &Plan,
    ) -> Result<Result<BTreeMap<Uuid, EntryEvidence>, Vec<(PathBuf, ItemReason)>>, LibraryError>
    {
        let mut wanted: BTreeMap<Uuid, (PathBuf, PathBuf, &PlanEntry)> = BTreeMap::new();
        for entry in &plan.entries {
            if let Some((root, path)) =
                self.inputs.sources.get(&entry.source_id).and_then(|source| {
                    let root =
                        self.inputs.locations.get(&source.location_id)?.path.to_path_buf().ok()?;
                    Some((root, source.path.to_path_buf().ok()?))
                })
            {
                wanted.entry(entry.source_id).or_insert((root, path, entry));
            }
        }
        let jobs: Vec<(Uuid, PathBuf, PathBuf, crate::ObservationFingerprint, Option<String>)> =
            wanted
                .into_iter()
                .map(|(id, (root, path, entry))| {
                    (id, root, path, entry.basis.clone(), entry.sha256.clone())
                })
                .collect();
        blocking(move || {
            let mut snapshots = BTreeMap::new();
            let mut failures = Vec::new();
            for (id, root, path, basis, sha256) in jobs {
                match files::snapshot(&root, &path, &basis, sha256.as_deref()) {
                    Ok(snapshot) => {
                        snapshots.insert(id, snapshot);
                    }
                    Err(reason) => failures.push((path, reason)),
                }
            }
            Ok(if failures.is_empty() { Ok(snapshots) } else { Err(failures) })
        })
        .await
    }

    /// Every patched copy the plan places, with its snapshotted original,
    /// by entry path (PREP-FR-03).
    fn planned_patches(&self, plan: &Plan) -> BTreeMap<PathBuf, PlannedPatch> {
        plan.entries
            .iter()
            .filter_map(|entry| {
                let patch = entry.patch.as_ref()?;
                let snapshot = self.snapshots.get(&entry.source_id)?;
                let patch = PlannedPatch {
                    original: snapshot.path.to_path_buf().ok()?,
                    source_sha256: snapshot.sha256.clone()?,
                    patch: patch.clone(),
                };
                Some((entry.path.clone(), patch))
            })
            .collect()
    }

    /// Snapshot, build, verify, swap against `reserved` and settle.
    async fn build(
        &mut self,
        plan: Plan,
        ticked: &BTreeSet<PathBuf>,
        reserved: &Reserved,
    ) -> Result<ApplyReport, LibraryError> {
        if let Some(report) = self.interrupted() {
            return Ok(report);
        }
        match self.snapshot_sources(&plan).await? {
            Ok(snapshots) => self.snapshots = Arc::new(snapshots),
            Err(failures) => {
                let count = self.record(failures);
                return self.end(ApplyStop::OriginalsUnverified { count }).await;
            }
        }
        self.patches = Arc::new(self.planned_patches(&plan));
        self.advance(ApplyPhase::SourcesVerified, None).await?;
        if let Some(report) = self.interrupted() {
            return Ok(report);
        }

        let identity = match self.make_building().await? {
            Ok(identity) => identity,
            Err(kept) => {
                let failures = kept
                    .into_iter()
                    .map(|path| {
                        let detail = format!("{} is not a file PlateVault placed", path.display());
                        (path, ItemReason::new(ReasonCode::DestinationOccupied, detail))
                    })
                    .collect();
                let count = self.record(failures);
                return self.end(ApplyStop::BuildingNotCleared { count }).await;
            }
        };
        self.building_made = true;
        let mut expected = self.journal.expected.clone();
        expected.building = Some(identity);
        self.advance(ApplyPhase::Building, Some(expected)).await?;
        if let Some(report) = self.interrupted() {
            return Ok(report);
        }

        for entry in plan.entries {
            if self.control.canceled() {
                return self.cancel().await;
            }
            let Some(snapshot) = self.snapshots.get(&entry.source_id).cloned() else { continue };
            let placing = files::Placing {
                entry: entry.clone(),
                snapshot: snapshot.clone(),
                building: self.building(),
                operation: self.journal.operation_id,
            };
            match blocking(move || Ok(files::place(&placing))).await? {
                Ok(made) => {
                    self.built.push(ManifestEntry {
                        seq: entry.seq,
                        path: NativePath::from_path(&entry.path),
                        group_id: entry.group_id,
                        night: entry.night,
                        source: entry.source,
                        placement: made.placement,
                        source_sha256: snapshot.sha256.clone().unwrap_or_default(),
                        source_fingerprint: snapshot.fingerprint.clone(),
                        written: Some(made.identity),
                        header_patch: entry.patch.map(|patch| patch.changes).unwrap_or_default(),
                        patched_sha256: made.patched_sha256,
                    });
                }
                Err(reason) => {
                    self.record(vec![(entry.path, reason)]);
                    return self.end(ApplyStop::EntryNotPlaced).await;
                }
            }
        }

        // BuildVerified: the originals still hold their snapshots and every
        // entry is still the one written, immediately before the swap.
        let (building, built, snapshots) =
            (self.building(), self.built.clone(), Arc::clone(&self.snapshots));
        let failures =
            blocking(move || Ok(files::verify_built(&building, &built, &snapshots))).await?;
        if !failures.is_empty() {
            let count = self.record(failures);
            return self.end(ApplyStop::BuildUnverified { count }).await;
        }
        let foreign = match self.foreign_inventory(ticked).await? {
            Ok(foreign) => foreign,
            Err(unreadable) => {
                let count = self.record(unreadable);
                return self.end(ApplyStop::ViewUnreadable { count }).await;
            }
        };
        self.library.catalog().record_apply_build(&self.journal, &self.built, &foreign).await?;
        self.journal.phase = ApplyPhase::BuildVerified;
        if let Some(report) = self.interrupted() {
            return Ok(report);
        }
        self.swap(reserved).await
    }

    /// The current View's files `PlateVault` didn't place, with the user's
    /// ticks; or the entries that can't be read, never a partial inventory.
    async fn foreign_inventory(
        &self,
        ticked: &BTreeSet<PathBuf>,
    ) -> Result<Result<Vec<ForeignItem>, files::Unreadable>, LibraryError> {
        let Some(installed) = &self.inputs.installed else { return Ok(Ok(Vec::new())) };
        let placed = placed(installed);
        let view = self.project.join(VIEW_FOLDER);
        let found = match blocking(move || Ok(files::foreign_files(&view, &placed))).await? {
            Ok(found) => found,
            Err(unreadable) => return Ok(Err(unreadable)),
        };
        Ok(Ok((0_u32..)
            .zip(found)
            .map(|(seq, (path, evidence))| ForeignItem {
                seq,
                ticked: ticked.contains(&path),
                path: NativePath::from_path(&path),
                evidence,
                state: ForeignItemState::Pending,
                reason: None,
            })
            .collect()))
    }

    /// Move the old View aside, waiting for a tool that holds a file in it,
    /// and install the new one; restore the old one if that fails. First the
    /// catalog is read again: an edit or a global change committed during
    /// the build fails Apply here, the old View kept (plan §3). The wait for
    /// a tool has no limit, so after one the catalog is read once more, and
    /// an edit committed meanwhile puts the old View back and fails Apply.
    async fn swap(&mut self, reserved: &Reserved) -> Result<ApplyReport, LibraryError> {
        if !self.still_reserved(reserved).await? {
            return self.end(ApplyStop::CatalogMoved).await;
        }
        let view = self.project.join(VIEW_FOLDER);
        let previous = self.project.join(VIEW_PREVIOUS_FOLDER);
        let building = self.building();
        let expected = self.journal.expected.clone();
        let old = expected.view.is_some();
        if old {
            if self.control.canceled() {
                return self.cancel().await;
            }
            if let Some(stop) = self.move_kept().await? {
                return self.end(stop).await;
            }
            let (root, view_path, previous_path) =
                (self.project.clone(), view.clone(), previous.clone());
            let expected = expected.clone();
            let ready =
                blocking(move || Ok(swap_ready(&root, &view_path, &previous_path, &expected)))
                    .await?;
            if let Err(stop) = ready {
                return self.end(stop).await;
            }
            match files::move_aside(self.os.rename, self.os.poll, &view, &previous, self.control)
                .await
            {
                Aside::Moved { waited } => {
                    if waited {
                        if let Some(report) = self.after_wait(reserved).await? {
                            return Ok(report);
                        }
                    }
                    self.advance(ApplyPhase::OldMoved, None).await?;
                }
                Aside::Canceled => return self.cancel().await,
                Aside::Failed => return self.end(ApplyStop::AsideFailed).await,
            }
            if let Some(report) = self.interrupted() {
                return Ok(report);
            }
        }
        let rename = self.os.rename;
        let (from, to) = (building.clone(), view.clone());
        let installed = blocking(move || Ok(rename(&from, &to))).await?;
        if let Err(error) = installed {
            let detail = not_installed(&view, &error);
            if old {
                if let Err(restore) = self.restore_old_view().await? {
                    return Err(LibraryError::IdentityConflict(format!(
                        "{detail}; restoring the old View failed too ({restore}); PlateVault \
                         restores it at the next start"
                    )));
                }
            }
            return self.end(ApplyStop::NotInstalled).await;
        }
        self.advance(ApplyPhase::NewInstalled, None).await?;
        if let Some(report) = self.interrupted() {
            return Ok(report);
        }
        self.finish_installed().await
    }

    /// After waiting for a tool, with the old View aside: record the wait,
    /// and when the catalog moved meanwhile put the old View back and end
    /// Failed.
    async fn after_wait(
        &mut self,
        reserved: &Reserved,
    ) -> Result<Option<ApplyReport>, LibraryError> {
        self.advance(ApplyPhase::WaitingForRelease, None).await?;
        if self.still_reserved(reserved).await? {
            return Ok(None);
        }
        if let Err(restore) = self.restore_old_view().await? {
            return Err(LibraryError::IdentityConflict(format!(
                "the Project or the Library changed while Apply waited for a tool; restoring \
                 the old View failed ({restore}); PlateVault restores it at the next start"
            )));
        }
        self.end(ApplyStop::CatalogMoved).await.map(Some)
    }

    /// Whether the catalog, read now, still holds what this Apply reserved.
    async fn still_reserved(&self, reserved: &Reserved) -> Result<bool, LibraryError> {
        let now = self.library.catalog().apply_inputs(self.journal.project_id).await?;
        Ok(reserved.holds(&now, self.journal.operation_id))
    }

    /// Move the old View back from `View (previous)/`; the rename's error
    /// when it can't.
    async fn restore_old_view(&self) -> Result<Result<(), std::io::Error>, LibraryError> {
        let rename = self.os.rename;
        let (from, to) = (self.project.join(VIEW_PREVIOUS_FOLDER), self.project.join(VIEW_FOLDER));
        blocking(move || Ok(rename(&from, &to))).await
    }

    /// Move what the user kept in `View (previous)/` to `View (kept)/`, so
    /// the old View can take its place (D-W110), and record each kept file
    /// that left or is gone; one gone from disk is named in the report
    /// (D-W137). Once the folder is gone its manifest retires. A file that
    /// can't move fails Apply with the old View in place: why, if so.
    async fn move_kept(&mut self) -> Result<Option<ApplyStop>, LibraryError> {
        let project = self.project.clone();
        let moves = match blocking(move || Ok(files::move_kept(&project))).await? {
            Ok(moves) => moves,
            Err(unreadable) => {
                let count = self.record(unreadable);
                return Ok(Some(ApplyStop::PreviousUnreadable { count }));
            }
        };
        for relative in &moves.missing {
            let path = NativePath::from_path(&Path::new(VIEW_PREVIOUS_FOLDER).join(relative));
            if !self.kept_missing.contains(&path) {
                self.kept_missing.push(path);
            }
        }
        let catalog = self.library.catalog();
        let project_id = self.journal.project_id;
        for item in catalog.previous_items(project_id).await? {
            let moved_or_gone = files::in_previous(&item.path).is_some_and(|relative| {
                moves.moved.contains(&relative) || moves.missing.contains(&relative)
            });
            if item.review == PreviousItemReview::Kept
                && (moved_or_gone || self.kept_missing.contains(&item.path))
            {
                catalog
                    .review_previous_item(project_id, &item.path, PreviousItemReview::Moved)
                    .await?;
            }
        }
        if !moves.failed.is_empty() {
            let count = self.record(moves.failed);
            return Ok(Some(ApplyStop::KeptNotMoved { count }));
        }
        if moves.gone {
            catalog.retire_previous_view(project_id).await?;
        }
        Ok(None)
    }

    /// From `NewInstalled` on Apply ends Applied: commit the manifest, move
    /// the ticked foreign files and retire the old View.
    async fn finish_installed(&mut self) -> Result<ApplyReport, LibraryError> {
        let library = self.library;
        let catalog = library.catalog();
        if before(self.journal.phase, ApplyPhase::ManifestCommitted) {
            catalog.commit_apply(&self.journal).await?;
            self.journal.phase = ApplyPhase::ManifestCommitted;
            if let Some(report) = self.interrupted() {
                return Ok(report);
            }
        }
        let inputs = catalog.apply_inputs(self.journal.project_id).await?;
        let mut foreign = catalog.apply_foreign_items(self.journal.operation_id).await?;
        let view = self.project.join(VIEW_FOLDER);
        let previous = self.project.join(VIEW_PREVIOUS_FOLDER);
        if before(self.journal.phase, ApplyPhase::ForeignTransferred) {
            let items = foreign.clone();
            let placed = inputs.installed.as_ref().map(placed).unwrap_or_default();
            foreign = blocking(move || {
                Ok(items
                    .iter()
                    .map(|item| files::move_foreign(&previous, &view, &placed, item))
                    .collect::<Vec<_>>())
            })
            .await?;
            catalog.record_apply_foreign(self.journal.operation_id, &foreign).await?;
            self.journal.phase = ApplyPhase::ForeignTransferred;
            if let Some(report) = self.interrupted() {
                return Ok(report);
            }
        }
        let delivered = inputs
            .installed
            .as_ref()
            .filter(|manifest| manifest.generation == self.journal.generation)
            .map(Delivered::of)
            .unwrap_or_default();
        let Some(old) = inputs.previous.clone() else {
            catalog.settle_apply(&self.journal, &[], true).await?;
            return Ok(self.report(Some(ApplyOutcome::Applied), foreign, Vec::new(), delivered));
        };
        if before(self.journal.phase, ApplyPhase::RetiringPrevious) {
            self.advance(ApplyPhase::RetiringPrevious, None).await?;
            if let Some(report) = self.interrupted() {
                return Ok(report);
            }
        }
        let sources = files::Original::all(&inputs);
        let project = self.project.clone();
        let retired = blocking(move || Ok(files::retire(&project, &old.entries, &sources))).await?;
        catalog.settle_apply(&self.journal, &retired.leftovers, retired.gone).await?;
        Ok(self.report(Some(ApplyOutcome::Applied), foreign, retired.leftovers, delivered))
    }
}

/// The OS refused to install the new View: its error goes to the log. The
/// text returned is for a `LibraryError` message only; the report carries
/// [`ApplyStop::NotInstalled`].
fn not_installed(view: &Path, error: &std::io::Error) -> &'static str {
    tracing::warn!(view = %view.display(), %error, "the new View couldn't be installed");
    "installing the new View failed"
}

/// The Project folder and `View/` are still the ones this Apply recorded,
/// and `View (previous)/` is free, right before the swap; else why not, with
/// the folder logged.
fn swap_ready(
    root: &Path,
    view: &Path,
    previous: &Path,
    expected: &ExpectedTree,
) -> Result<(), ApplyStop> {
    let is = |path: &Path, identity: &FileIdentity| {
        observe_folder_identity(path).is_ok_and(|observed| same_identity(&observed, identity))
    };
    let refuse = |folder: &Path, stop: ApplyStop| {
        tracing::warn!(folder = %folder.display(), ?stop, "Apply won't swap the View");
        Err(stop)
    };
    if !is(root, &expected.root_identity) {
        return refuse(root, ApplyStop::ProjectFolderReplaced);
    }
    if !expected.view.as_ref().is_some_and(|identity| is(view, identity)) {
        return refuse(view, ApplyStop::ViewReplaced);
    }
    if fs::symlink_metadata(previous).is_ok() {
        return refuse(previous, ApplyStop::PreviousAppeared);
    }
    Ok(())
}

/// Move one reviewed leftover from `View (previous)/` into `View/` at the
/// same place, once it is still the recorded file, never over an entry.
fn move_leftover(project: &Path, item: &PreviousItem) -> Result<(), LibraryError> {
    let relative = files::in_previous(&item.path).ok_or_else(|| {
        LibraryError::InvalidInput(format!("{} is not in View (previous)/", item.path.display()))
    })?;
    let from = project.join(VIEW_PREVIOUS_FOLDER).join(&relative);
    let to_root = project.join(VIEW_FOLDER);
    let now = observe_entry(&from)?;
    if !same_identity(&now.fingerprint.identity, &item.evidence.fingerprint.identity)
        || now.sha256 != item.evidence.sha256
        || now.kind != item.evidence.kind
    {
        return Err(LibraryError::InvalidInput(format!(
            "{} changed since it was left in View (previous)/",
            from.display()
        )));
    }
    let folder = relative.parent().unwrap_or_else(|| Path::new(""));
    transfer::ensure_folder(&to_root, folder)
        .map_err(|reason| LibraryError::InvalidInput(reason.detail))?;
    transfer::rename_noreplace(&from, &to_root.join(&relative)).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            LibraryError::InvalidInput(format!("View/ already holds {}", relative.display()))
        } else {
            LibraryError::from_io(&from, &error)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{GroupKeywords, ProjectBasis, ProjectLifecycle};

    #[allow(clippy::unnecessary_wraps)]
    fn developer_mode_off(_folder: &Path) -> std::io::Result<SymlinkCapability> {
        Ok(SymlinkCapability::DeveloperModeOff)
    }

    #[allow(clippy::unnecessary_wraps)]
    fn no_links(_folder: &Path) -> std::io::Result<SymlinkCapability> {
        Ok(SymlinkCapability::Unsupported)
    }

    fn inputs(parent: &Path, mode: ViewMode) -> ApplyInputs {
        ApplyInputs {
            project_id: Uuid::new_v4(),
            name: "NGC 7000".into(),
            lifecycle: ProjectLifecycle::Open,
            desired_revision: 1,
            parent: Some(NativePath::from_path(parent)),
            basis: ProjectBasis { mode, keywords: GroupKeywords::default(), groups: Vec::new() },
            basis_digest: String::new(),
            unsettled: Vec::new(),
            not_ready: Vec::new(),
            metadata: BTreeMap::new(),
            corrected: BTreeMap::new(),
            sources: BTreeMap::new(),
            locations: BTreeMap::new(),
            names: BTreeMap::new(),
            installed: None,
            previous: None,
            leftovers: Vec::new(),
            running: None,
            failed_building: None,
        }
    }

    /// Windows with Developer Mode off: a Symlinks Project is refused with
    /// its own error and no other link kind is tried; Copies isn't.
    #[test]
    fn symlinks_mode_without_developer_mode_refuses_with_its_own_error() {
        let temp = tempfile::tempdir().unwrap();
        let os = Os { symlinks: developer_mode_off, ..Os::SYSTEM };
        let checked = check(&inputs(temp.path(), ViewMode::Symlinks), os);
        assert_eq!(checked.blockers, [ApplyBlocker::SymlinksUnavailable]);
        let error = refusal(&checked.blockers);
        assert!(matches!(error, LibraryError::SymlinksUnavailable(_)));
        assert_eq!(error.code().as_str(), "symlinks_unavailable");
        assert!(error.to_string().contains("Developer Mode"));
        assert_eq!(check(&inputs(temp.path(), ViewMode::Copies), os).blockers, Vec::new());
        assert!(fs::read_dir(temp.path()).unwrap().next().is_none(), "nothing was built");
    }

    /// PREP-AC-03, distinct from PREP-AC-08: a processing location whose
    /// filesystem holds no links is its own blocker and code, naming the
    /// folder and never Developer Mode; Copies is still offered there.
    #[test]
    fn symlinks_mode_on_a_volume_without_links_refuses_naming_the_folder() {
        let temp = tempfile::tempdir().unwrap();
        let os = Os { symlinks: no_links, ..Os::SYSTEM };
        let checked = check(&inputs(temp.path(), ViewMode::Symlinks), os);
        let parent = NativePath::from_path(temp.path());
        assert_eq!(checked.blockers, [ApplyBlocker::LinksUnsupported { path: parent.clone() }]);
        assert!(!checked.blockers[0].describe().contains("Developer Mode"));
        let error = refusal(&checked.blockers);
        assert_eq!(error.code().as_str(), "links_unsupported");
        assert_eq!(error.response(None, None).scope, Some(parent));
        assert_eq!(check(&inputs(temp.path(), ViewMode::Copies), os).blockers, Vec::new());
    }

    /// A blocker's wire tag is its refusal's code, so the sheet words both
    /// symlink blockers by their `err_library_<code>` messages.
    #[test]
    fn each_symlink_blocker_is_tagged_as_its_refusal_code() {
        let path = NativePath::from_path(Path::new("/Volumes/EXFAT/Processing"));
        for blocker in [ApplyBlocker::SymlinksUnavailable, ApplyBlocker::LinksUnsupported { path }]
        {
            let tag = serde_json::to_value(&blocker).unwrap()["blocker"].clone();
            let code = refusal(std::slice::from_ref(&blocker)).code();
            assert_eq!(tag, code.as_str());
        }
    }

    #[test]
    fn a_folder_that_holds_no_file_is_an_unavailable_location_without_os_text() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("missing");
        let blocker = symlink_blocker(&missing, files::probe_symlinks(&missing)).unwrap();
        let ApplyBlocker::ProcessingLocationUnavailable { detail, .. } = blocker else {
            panic!("{blocker:?}")
        };
        assert!(!detail.contains("os error"), "{detail}");
    }

    #[test]
    fn the_footprint_counts_clones_apart_from_copies() {
        let footprint = ViewFootprint::of([
            (EntryPlacement::Symlink, 7),
            (EntryPlacement::Clone, 10),
            (EntryPlacement::Copy, 5),
        ]);
        assert_eq!(footprint, ViewFootprint { frames: 2, bytes: 15, cloned: 1 });
    }

    /// PREP-AC-25: a Copies entry is a clone in the sheet only where its
    /// original's volume clones into the processing location; a second
    /// volume, or a Symlinks entry, is never one. One probe per volume.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn the_sheet_counts_a_copy_as_a_clone_only_where_its_volume_clones() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static PROBES: AtomicUsize = AtomicUsize::new(0);
        fn same_volume(_original: &Path, _folder: &Path) -> bool {
            PROBES.fetch_add(1, Ordering::SeqCst);
            true
        }
        fn other_volume(_original: &Path, _folder: &Path) -> bool {
            false
        }
        let temp = tempfile::tempdir().unwrap();
        let original = temp.path().join("Light_001.fits");
        fs::write(&original, b"light").unwrap();
        let asset = Uuid::new_v4();
        let sources = BTreeMap::from([(
            asset,
            persistence_library::SourcePath {
                location_id: Uuid::new_v4(),
                path: NativePath::from_path(&original),
            },
        )]);
        let entry = |placement| PlanEntry {
            seq: 0,
            path: PathBuf::from("Lights/Light_001.fits"),
            group_id: None,
            night: None,
            source: crate::EntrySource::Light { capture_key: asset, asset_id: asset },
            source_id: asset,
            placement,
            basis: inventory::probe_fingerprint(&original).unwrap(),
            sha256: None,
            patch: None,
        };
        let clones = |probe: fn(&Path, &Path) -> bool, folder| Clones {
            folder,
            probe,
            volumes: BTreeMap::new(),
        };
        let mut same = clones(same_volume, Some(temp.path()));
        assert_eq!(same.placement(&entry(EntryPlacement::Copy), &sources), EntryPlacement::Clone);
        assert_eq!(same.placement(&entry(EntryPlacement::Copy), &sources), EntryPlacement::Clone);
        assert_eq!(PROBES.load(Ordering::SeqCst), 1, "one probe per volume");
        let symlink = same.placement(&entry(EntryPlacement::Symlink), &sources);
        assert_eq!(symlink, EntryPlacement::Symlink);
        let mut other = clones(other_volume, Some(temp.path()));
        assert_eq!(other.placement(&entry(EntryPlacement::Copy), &sources), EntryPlacement::Copy);
        let mut unchosen = clones(same_volume, None);
        let unplaced = unchosen.placement(&entry(EntryPlacement::Copy), &sources);
        assert_eq!(unplaced, EntryPlacement::Copy);
    }

    #[test]
    fn other_blockers_refuse_as_invalid_input() {
        assert!(matches!(
            refusal(&[ApplyBlocker::NoProcessingLocation]),
            LibraryError::InvalidInput(_)
        ));
    }
}
