// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Apply's file work (spec 069 PREP-FR-03/04/09/15/18, 071 STO-FR-10; D19,
//! D-W81, D-W98, D-W100, D-W122): blocking, no catalog access.
//!
//! Every entry is made from an original whose bytes were just snapshotted,
//! never from an entry of the current or previous View: a symlink to the
//! original, or a clone or verified copy of it. A copy of a frame with a
//! recorded correction is an isolated patched copy: it then takes the
//! header cards planned from its original and is re-read to differ from
//! the snapshot only by them. Nothing is ever hard-linked, so each Copies
//! entry is its own file (D-W81, 063 FR-005). Nothing here replaces an
//! existing entry or follows a link. Old entries leave `View (previous)/`
//! only once proven: a link that is still the one `PlateVault` placed and
//! points at its original, a copy that still holds the bytes `PlateVault`
//! placed while its original still holds them too. Everything else stays,
//! named, for the user's review.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use uuid::Uuid;

use super::plan::PlanEntry;
use super::ApplyControl;
use crate::custody::{observe_entry, same_identity, transfer, verify_source};
use crate::layout::VIEW_PREVIOUS_FOLDER;
use crate::patched_copy;
use crate::{
    CorrectedField, EntryEvidence, EntryKind, EntryPlacement, FileIdentity, ForeignItem,
    ForeignItemState, ItemReason, ManifestEntry, NativePath, ObservationFingerprint, PreviousItem,
    PreviousItemReason, PreviousItemReview, ReasonCode, TransferDestination,
};

fn reason(code: ReasonCode, detail: impl Into<String>) -> ItemReason {
    ItemReason::new(code, detail)
}

fn failed(path: &Path, error: &io::Error) -> ItemReason {
    if error.kind() == io::ErrorKind::AlreadyExists {
        reason(
            ReasonCode::DestinationOccupied,
            format!("{} already holds an entry; nothing is replaced", path.display()),
        )
    } else {
        reason(ReasonCode::WriteFailed, format!("{}: {error}", path.display()))
    }
}

// ── Symlink capability ───────────────────────────────────────────────────────

/// Why symlinks can't be probed or made in a folder.
#[derive(Debug)]
pub enum SymlinkProbe {
    /// The folder can't hold even a plain file.
    Unwritable(String),
    /// The folder takes files but no symlink: Windows without Developer
    /// Mode, or a volume without links (FAT, exFAT).
    Unsupported(String),
}

/// Whether `folder` can hold a symlink: create a probe file and a symlink
/// to it under fresh hidden names, then remove exactly those.
pub fn probe_symlinks(folder: &Path) -> Result<(), SymlinkProbe> {
    let name = format!(".platevault-symlink-probe-{}", Uuid::new_v4().simple());
    let target = folder.join(format!("{name}.file"));
    fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|error| {
        SymlinkProbe::Unwritable(format!("{} can't hold a file: {error}", folder.display()))
    })?;
    let link = folder.join(format!("{name}.link"));
    let made = fs_pathsafe::create_symlink(&target, &link);
    if made.is_ok() {
        let _ = fs::remove_file(&link);
    }
    let _ = fs::remove_file(&target);
    made.map_err(|error| {
        SymlinkProbe::Unsupported(format!("{} can't hold a symlink: {error}", folder.display()))
    })
}

// ── Sources ──────────────────────────────────────────────────────────────────

/// Same file, size and modification time as the recorded basis; the file ID
/// counts where the volume keeps it stable. The digest isn't read here.
pub fn same_file(observed: &ObservationFingerprint, recorded: &ObservationFingerprint) -> bool {
    same_identity(&observed.identity, &recorded.identity)
        && observed.size_bytes == recorded.size_bytes
        && observed.modified_ns == recorded.modified_ns
}

/// The original's snapshot (D19): its no-follow identity and SHA-256, which
/// must still be the file, size, time and digest its basis recorded.
pub fn snapshot(
    path: &Path,
    basis: &ObservationFingerprint,
    sha256: Option<&str>,
) -> Result<EntryEvidence, ItemReason> {
    let evidence = observe_entry(path)
        .map_err(|error| reason(ReasonCode::SourceUnavailable, error.to_string()))?;
    if evidence.kind != EntryKind::File {
        return Err(reason(
            ReasonCode::SourceDrift,
            format!("{} is a link, not the original", path.display()),
        ));
    }
    let digest = sha256.or(basis.content_sha256.as_deref());
    if !same_file(&evidence.fingerprint, basis)
        || digest.is_some_and(|digest| evidence.sha256.as_deref() != Some(digest))
    {
        return Err(reason(
            ReasonCode::SourceDrift,
            format!("{} changed since it was chosen", path.display()),
        ));
    }
    Ok(evidence)
}

// ── Patched copies ───────────────────────────────────────────────────────────

/// One isolated patched copy a build plans (PREP-FR-03): its snapshotted
/// original, that original's digest and the reviewed change.
#[derive(Clone, Debug)]
pub struct PlannedPatch {
    pub original: PathBuf,
    pub source_sha256: String,
    pub changes: Vec<CorrectedField>,
}

/// Whether the old patched copy `copy` still holds exactly what
/// `PlateVault` placed: its original's recorded bytes with its recorded
/// change, proven on `original`, which must hold those bytes.
pub fn holds_patch(copy: &EntryEvidence, entry: &ManifestEntry, original: &Path) -> bool {
    patched_copy::holds_patch(copy, original, &entry.source_sha256, &entry.header_patch)
}

// ── Build ────────────────────────────────────────────────────────────────────

/// How one entry was written.
#[derive(Clone, Debug)]
pub struct Written {
    pub placement: EntryPlacement,
    pub identity: FileIdentity,
}

/// What placing one entry needs, owned so it runs off the async runtime.
pub struct Placing {
    pub entry: PlanEntry,
    pub snapshot: EntryEvidence,
    pub building: PathBuf,
    pub operation: Uuid,
}

/// Write one entry below `View (building)/` and prove it against the
/// snapshot: a symlink must point at the original, a clone or copy must hold
/// the snapshot's bytes.
pub fn place(placing: &Placing) -> Result<Written, ItemReason> {
    let entry = &placing.entry;
    let path = placing.building.join(&entry.path);
    let folder = entry.path.parent().unwrap_or_else(|| Path::new(""));
    transfer::ensure_folder(&placing.building, folder)?;
    let original = placing
        .snapshot
        .path
        .to_path_buf()
        .map_err(|error| reason(ReasonCode::SourceUnavailable, error.to_string()))?;
    match entry.placement {
        EntryPlacement::Symlink => {
            fs_pathsafe::create_symlink(&original, &path).map_err(|error| failed(&path, &error))?;
            let link = observe_entry(&path)
                .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
            if link.kind != (EntryKind::Link { target: placing.snapshot.path.clone() }) {
                return Err(reason(
                    ReasonCode::DestinationChanged,
                    format!("{} does not point at {}", path.display(), original.display()),
                ));
            }
            Ok(Written { placement: EntryPlacement::Symlink, identity: link.fingerprint.identity })
        }
        EntryPlacement::Copy | EntryPlacement::Clone => copy(placing, &original, &path),
    }
}

/// A copy of the original; for a frame with a recorded correction, the
/// isolated patched copy the patched-copy seam writes and proves
/// (PREP-FR-03, PREP-FR-09), which removes one that fails so Retry makes
/// it again.
fn copy(placing: &Placing, original: &Path, path: &Path) -> Result<Written, ItemReason> {
    let changes = &placing.entry.header_patch;
    if changes.is_empty() {
        return plain_copy(placing, original, path);
    }
    let outcome = patched_copy::patch_copy(&placing.snapshot, path, changes, || {
        plain_copy(placing, original, path).map(|written| (written.placement, written.identity))
    })?;
    Ok(Written { placement: outcome.placement, identity: outcome.identity })
}

/// A clone where the volume makes one, else a verified copy (PREP-FR-04).
fn plain_copy(placing: &Placing, original: &Path, path: &Path) -> Result<Written, ItemReason> {
    let snapshot = &placing.snapshot;
    if transfer::clone_file(original, path).is_ok() {
        let clone = observe_entry(path)
            .map_err(|error| reason(ReasonCode::DestinationChanged, error.to_string()))?;
        if clone.sha256 == snapshot.sha256 && clone.kind == EntryKind::File {
            return Ok(Written {
                placement: EntryPlacement::Clone,
                identity: clone.fingerprint.identity,
            });
        }
        transfer::discard(path, &clone.fingerprint.identity);
        return Err(reason(
            ReasonCode::DestinationMismatch,
            format!("the clone {} differs from its original", path.display()),
        ));
    }
    let destination = TransferDestination {
        root: NativePath::from_path(&placing.building),
        relative: NativePath::from_path(&placing.entry.path),
    };
    let written = transfer::begin(placing.operation, placing.entry.seq, &destination)?;
    transfer::write(snapshot, &destination, &written)?;
    transfer::verify(snapshot, &destination, &written)?;
    Ok(Written { placement: EntryPlacement::Copy, identity: written.identity })
}

/// Immediately before the swap (PREP-FR-09): each original still holds its
/// snapshot, and each entry is still the one written.
pub fn verify_built(
    building: &Path,
    entries: &[ManifestEntry],
    snapshots: &BTreeMap<Uuid, EntryEvidence>,
) -> Vec<(PathBuf, ItemReason)> {
    let mut failures = Vec::new();
    for snapshot in snapshots.values() {
        if let Err(drift) = verify_source(snapshot) {
            failures.push((PathBuf::from(snapshot.path.display()), drift));
        }
    }
    for entry in entries {
        let Ok(relative) = entry.path.relative_path() else { continue };
        let path = building.join(&relative);
        let holds = entry.written.as_ref().is_some_and(|written| holds_identity(&path, written));
        if !holds {
            failures.push((
                relative,
                reason(ReasonCode::DestinationChanged, format!("{} changed", path.display())),
            ));
        }
    }
    failures
}

/// Whether `path` is still the entry recorded as `identity`, never following
/// a link.
fn holds_identity(path: &Path, identity: &FileIdentity) -> bool {
    match fs::symlink_metadata(path) {
        Ok(metadata) if fs_pathsafe::is_link_or_junction_metadata(&metadata) => observe_entry(path)
            .is_ok_and(|link| same_identity(&link.fingerprint.identity, identity)),
        Ok(_) => crate::inventory::probe_fingerprint(path)
            .is_ok_and(|observed| same_identity(&observed.identity, identity)),
        Err(_) => false,
    }
}

/// What of a `View (building)/` is this Project's own: a copy holding the
/// bytes of an original just snapshotted, by its digest, or a patched copy
/// at the path the build plans one, holding its original's bytes with the
/// planned cards.
pub struct Ours {
    pub digests: BTreeSet<String>,
    /// By path relative to `View (building)/`.
    pub patches: Arc<BTreeMap<PathBuf, PlannedPatch>>,
}

impl Ours {
    fn holds(&self, relative: &Path, file: &EntryEvidence) -> bool {
        file.sha256.as_ref().is_some_and(|sha| self.digests.contains(sha))
            || self.patches.get(relative).is_some_and(|patch| {
                patched_copy::holds_patch(
                    file,
                    &patch.original,
                    &patch.source_sha256,
                    &patch.changes,
                )
            })
    }
}

/// Empty the `View (building)/` an earlier Apply of this Project left, then
/// remove it: a symlink holds no data, a partial copy is this module's own,
/// and so is every file of `ours`. Anything else stays and is returned; the
/// folder then stays too.
pub fn clear_building(building: &Path, ours: &Ours) -> Vec<PathBuf> {
    let (files, unreadable) = walk(building);
    let mut kept: Vec<PathBuf> = unreadable;
    for path in files {
        let removable = match fs::symlink_metadata(&path) {
            Ok(metadata) if fs_pathsafe::is_link_or_junction_metadata(&metadata) => true,
            Ok(metadata) if metadata.is_file() => {
                let partial = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(".pv-") && name.ends_with(".partial"));
                let relative = path.strip_prefix(building).unwrap_or(&path);
                partial || observe_entry(&path).is_ok_and(|file| ours.holds(relative, &file))
            }
            _ => false,
        };
        if !(removable && fs::remove_file(&path).is_ok()) {
            kept.push(path);
        }
    }
    remove_empty_folders(building);
    kept
}

/// Every file and link below `root`, never following a link, and the
/// folders that couldn't be read.
fn walk(root: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut files = Vec::new();
    let mut unreadable = Vec::new();
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let Ok(entries) = fs::read_dir(&folder) else {
            unreadable.push(folder);
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            match fs::symlink_metadata(&path) {
                Ok(metadata)
                    if metadata.is_dir()
                        && !fs_pathsafe::is_link_or_junction_metadata(&metadata) =>
                {
                    folders.push(path);
                }
                Ok(_) => files.push(path),
                Err(_) => unreadable.push(path),
            }
        }
    }
    files.sort();
    (files, unreadable)
}

/// Remove `root` and every folder below it that holds nothing, deepest
/// first. A folder that holds anything stays; nothing is removed
/// recursively.
pub fn remove_empty_folders(root: &Path) {
    let mut folders = vec![root.to_path_buf()];
    let mut index = 0;
    while index < folders.len() {
        if let Ok(entries) = fs::read_dir(&folders[index]) {
            for entry in entries.flatten() {
                let path = entry.path();
                if fs::symlink_metadata(&path).is_ok_and(|metadata| {
                    metadata.is_dir() && !fs_pathsafe::is_link_or_junction_metadata(&metadata)
                }) {
                    folders.push(path);
                }
            }
        }
        index += 1;
    }
    for folder in folders.iter().rev() {
        let _ = fs::remove_dir(folder);
    }
}

/// Whether `folder` holds no file or link at any depth.
pub fn holds_nothing(folder: &Path) -> bool {
    let (files, unreadable) = walk(folder);
    files.is_empty() && unreadable.is_empty()
}

/// Every file `folder` holds, relative to it, never following a link.
pub fn files_below(folder: &Path) -> Vec<PathBuf> {
    walk(folder)
        .0
        .into_iter()
        .filter_map(|path| path.strip_prefix(folder).ok().map(Path::to_path_buf))
        .collect()
}

// ── Foreign files ────────────────────────────────────────────────────────────

/// The files in `view` that `PlateVault` didn't place (VSEL-FR-20): every
/// file or link not at a path of `placed`, with folders expanded to their
/// files, with its no-follow evidence.
pub fn foreign_files(view: &Path, placed: &BTreeSet<PathBuf>) -> Vec<(PathBuf, EntryEvidence)> {
    walk(view)
        .0
        .into_iter()
        .filter_map(|path| {
            let relative = path.strip_prefix(view).ok()?.to_path_buf();
            if placed.contains(&relative) {
                return None;
            }
            observe_entry(&path).ok().map(|evidence| (relative, evidence))
        })
        .collect()
}

/// Move one ticked foreign file from `View (previous)/` into the new
/// `View/` at the same place, once it is still the reviewed entry; never
/// over an entry the new View placed.
pub fn move_foreign(previous: &Path, view: &Path, item: &ForeignItem) -> ForeignItem {
    let mut item = item.clone();
    if !item.ticked {
        item.state = ForeignItemState::Stayed;
        return item;
    }
    let outcome = (|| {
        let relative = item.path.relative_path().map_err(|error| error.to_string())?;
        let from = previous.join(&relative);
        let to = view.join(&relative);
        if !from.exists()
            && fs::symlink_metadata(&to).is_ok_and(|_| is_reviewed(&to, &item.evidence))
        {
            return Ok(());
        }
        if !is_reviewed(&from, &item.evidence) {
            return Err(format!("{} changed after the Apply sheet listed it", from.display()));
        }
        let folder = relative.parent().unwrap_or_else(|| Path::new(""));
        transfer::ensure_folder(view, folder).map_err(|failure| failure.detail)?;
        transfer::rename_noreplace(&from, &to).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                format!("the new View already holds {}", relative.display())
            } else {
                format!("{}: {error}", from.display())
            }
        })
    })();
    match outcome {
        Ok(()) => item.state = ForeignItemState::Moved,
        Err(detail) => {
            item.state = ForeignItemState::Failed;
            item.reason = Some(detail);
        }
    }
    item
}

/// Whether `path` holds the reviewed entry: the same file and bytes, or the
/// same link with the same target, by identity rather than by name.
fn is_reviewed(path: &Path, reviewed: &EntryEvidence) -> bool {
    observe_entry(path).is_ok_and(|now| {
        same_identity(&now.fingerprint.identity, &reviewed.fingerprint.identity)
            && now.kind == reviewed.kind
            && now.sha256 == reviewed.sha256
    })
}

// ── The swap ─────────────────────────────────────────────────────────────────

/// A rename that never replaces; tests stand in a tool holding a file.
pub type Rename = fn(&Path, &Path) -> io::Result<()>;

/// Whether a rename failed only because a tool holds a file open in the
/// folder: on Windows a sharing, lock or access violation; elsewhere a busy
/// resource.
pub fn held_by_a_tool(error: &io::Error) -> bool {
    let windows = cfg!(windows) && matches!(error.raw_os_error(), Some(5 | 32 | 33));
    windows || error.kind() == io::ErrorKind::ResourceBusy
}

/// How moving the old View aside ended.
#[derive(Debug)]
pub enum Aside {
    Moved {
        waited: bool,
    },
    /// Cancel while waiting: nothing moved.
    Canceled,
    Failed(String),
}

/// Move `from` to `to`, waiting while a tool holds a file in `from`
/// (PREP-FR-18): the user reads "Waiting for a tool to release a file in
/// View", it continues by itself once the file is released, and Cancel
/// keeps the old View.
pub async fn move_aside(
    rename: Rename,
    poll: Duration,
    from: &Path,
    to: &Path,
    control: &dyn ApplyControl,
) -> Aside {
    let mut waited = false;
    let outcome = loop {
        let (source, target) = (from.to_path_buf(), to.to_path_buf());
        let attempt = tokio::task::spawn_blocking(move || rename(&source, &target)).await;
        match attempt {
            Ok(Ok(())) => break Aside::Moved { waited },
            Ok(Err(error)) if held_by_a_tool(&error) => {
                if !waited {
                    waited = true;
                    control.waiting(Some(from));
                }
                if control.canceled() {
                    break Aside::Canceled;
                }
                tokio::time::sleep(poll).await;
                if control.canceled() {
                    break Aside::Canceled;
                }
            }
            Ok(Err(error)) => break Aside::Failed(format!("{}: {error}", from.display())),
            Err(error) => {
                break Aside::Failed(format!("the move of {} failed: {error}", from.display()))
            }
        }
    };
    if waited {
        control.waiting(None);
    }
    outcome
}

// ── Retiring the previous View ───────────────────────────────────────────────

/// What retiring `View (previous)/` left for review, and whether the folder
/// is gone.
#[derive(Clone, Debug, Default)]
pub struct Retired {
    pub leftovers: Vec<PreviousItem>,
    pub gone: bool,
}

/// Retire the replaced View in `<Project>/View (previous)/` (STO-FR-10):
/// delete each old copy outright once it still holds the bytes `PlateVault`
/// placed and its original, at `sources`, still holds them too; unlink each
/// old link that is still the recorded one pointing at its original. A copy
/// that changed, one whose original can't be verified, a link that fails
/// the check and every file `PlateVault` didn't place stay, named.
/// Emptied folders are removed, never anything recursively.
pub fn retire(
    project: &Path,
    entries: &[ManifestEntry],
    sources: &BTreeMap<Uuid, PathBuf>,
) -> Retired {
    let previous = project.join(VIEW_PREVIOUS_FOLDER);
    let mut reasons: BTreeMap<PathBuf, PreviousItemReason> = BTreeMap::new();
    for entry in entries {
        let Ok(relative) = entry.path.relative_path() else { continue };
        let path = previous.join(&relative);
        if fs::symlink_metadata(&path).is_err() {
            continue;
        }
        let original = sources.get(&source_id(entry));
        let verdict = match entry.placement {
            EntryPlacement::Symlink => old_link(&path, entry, original),
            EntryPlacement::Copy | EntryPlacement::Clone => old_copy(&path, entry, original),
        };
        match verdict {
            Ok(()) => {
                if fs::remove_file(&path).is_err() {
                    reasons.insert(relative, unverified(entry));
                }
            }
            Err(why) => {
                reasons.insert(relative, why);
            }
        }
    }
    let mut leftovers = Vec::new();
    for relative in files_below(&previous) {
        let reason = reasons.remove(&relative).unwrap_or(PreviousItemReason::UntickedFile);
        let path = previous.join(&relative);
        let Ok(evidence) = observe_entry(&path) else { continue };
        leftovers.push(PreviousItem {
            path: NativePath::from_path(&Path::new(VIEW_PREVIOUS_FOLDER).join(&relative)),
            reason,
            evidence,
            review: PreviousItemReview::Pending,
        });
    }
    remove_empty_folders(&previous);
    Retired { leftovers, gone: fs::symlink_metadata(&previous).is_err() }
}

/// The asset or master id an entry's original is recorded under.
pub const fn source_id(entry: &ManifestEntry) -> Uuid {
    match entry.source {
        crate::EntrySource::Light { asset_id, .. }
        | crate::EntrySource::CalibrationFrame { asset_id, .. } => asset_id,
        crate::EntrySource::Master { master_id, .. } => master_id,
    }
}

const fn unverified(entry: &ManifestEntry) -> PreviousItemReason {
    match entry.placement {
        EntryPlacement::Symlink => PreviousItemReason::UnverifiedLink,
        _ => PreviousItemReason::UnverifiedCopy,
    }
}

/// An old link goes once it is still the link `PlateVault` placed, by its
/// own identity, and points at its original's current path.
pub fn old_link(
    path: &Path,
    entry: &ManifestEntry,
    original: Option<&PathBuf>,
) -> Result<(), PreviousItemReason> {
    let link = observe_entry(path).map_err(|_| PreviousItemReason::UnverifiedLink)?;
    let EntryKind::Link { target } = &link.kind else {
        return Err(PreviousItemReason::UnverifiedLink);
    };
    let ours = entry
        .written
        .as_ref()
        .is_some_and(|written| same_identity(&link.fingerprint.identity, written));
    let points = original.is_some_and(|original| *target == NativePath::from_path(original));
    if ours && points {
        Ok(())
    } else {
        Err(PreviousItemReason::UnverifiedLink)
    }
}

/// An old copy goes once it still holds the bytes `PlateVault` placed and
/// its original still exists and matches the recorded digest. An old
/// patched copy holds them once it differs from that verified original only
/// by the cards its recorded change plans on it.
fn old_copy(
    path: &Path,
    entry: &ManifestEntry,
    original: Option<&PathBuf>,
) -> Result<(), PreviousItemReason> {
    let copy = observe_entry(path).map_err(|_| PreviousItemReason::ChangedCopy)?;
    let placed = copy.kind == EntryKind::File
        && entry
            .written
            .as_ref()
            .is_some_and(|written| same_identity(&copy.fingerprint.identity, written));
    let unpatched = entry.header_patch.is_empty();
    if !placed || (unpatched && copy.sha256.as_deref() != Some(entry.source_sha256.as_str())) {
        return Err(PreviousItemReason::ChangedCopy);
    }
    let verified = original.filter(|original| {
        observe_entry(original).is_ok_and(|now| {
            now.kind == EntryKind::File
                && now.sha256.as_deref() == Some(entry.source_sha256.as_str())
        })
    });
    match verified {
        None => Err(PreviousItemReason::UnverifiedCopy),
        Some(_) if unpatched => Ok(()),
        Some(original) if holds_patch(&copy, entry, original) => Ok(()),
        Some(_) => Err(PreviousItemReason::ChangedCopy),
    }
}

/// `path` relative to the Project folder's `View (previous)/`, refusing
/// anything else.
pub fn in_previous(path: &NativePath) -> Option<PathBuf> {
    let relative = path.relative_path().ok()?;
    let mut parts = relative.components();
    match parts.next() {
        Some(Component::Normal(first)) if first == VIEW_PREVIOUS_FOLDER => {
            let rest: PathBuf = parts.collect();
            (!rest.as_os_str().is_empty()).then_some(rest)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;

    static BUSY: AtomicUsize = AtomicUsize::new(0);

    /// A tool holds a file in the View for the first two attempts.
    fn busy_twice(from: &Path, to: &Path) -> io::Result<()> {
        if BUSY.fetch_add(1, Ordering::SeqCst) < 2 {
            return Err(io::ErrorKind::ResourceBusy.into());
        }
        transfer::rename_noreplace(from, to)
    }

    fn always_busy(_from: &Path, _to: &Path) -> io::Result<()> {
        Err(io::ErrorKind::ResourceBusy.into())
    }

    #[derive(Default)]
    struct Control {
        cancel: AtomicBool,
        held: std::sync::Mutex<Option<PathBuf>>,
        released: AtomicBool,
    }

    impl ApplyControl for Control {
        fn canceled(&self) -> bool {
            self.cancel.load(Ordering::SeqCst)
        }
        fn waiting(&self, held: Option<&Path>) {
            match held {
                Some(folder) => *self.held.lock().unwrap() = Some(folder.to_path_buf()),
                None => self.released.store(true, Ordering::SeqCst),
            }
        }
    }

    fn view_in(temp: &tempfile::TempDir) -> (PathBuf, PathBuf) {
        let view = temp.path().join("View");
        fs::create_dir(&view).unwrap();
        fs::write(view.join("Light_001.fits"), b"held by a tool").unwrap();
        (view, temp.path().join(VIEW_PREVIOUS_FOLDER))
    }

    #[tokio::test]
    async fn apply_waits_for_a_tool_to_release_a_file_and_continues_by_itself() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        let control = Control::default();
        let moved =
            move_aside(busy_twice, Duration::from_millis(1), &view, &previous, &control).await;
        assert!(matches!(moved, Aside::Moved { waited: true }), "{moved:?}");
        assert_eq!(control.held.lock().unwrap().as_deref(), Some(view.as_path()), "it names View");
        assert!(control.released.load(Ordering::SeqCst));
        assert!(!view.exists());
        assert_eq!(fs::read(previous.join("Light_001.fits")).unwrap(), b"held by a tool");
    }

    #[tokio::test]
    async fn cancel_while_waiting_keeps_the_old_view() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        let control = Control::default();
        control.cancel.store(true, Ordering::SeqCst);
        let moved =
            move_aside(always_busy, Duration::from_millis(1), &view, &previous, &control).await;
        assert!(matches!(moved, Aside::Canceled), "{moved:?}");
        assert!(view.join("Light_001.fits").exists());
        assert!(!previous.exists());
    }

    #[test]
    fn only_a_held_file_waits() {
        assert!(held_by_a_tool(&io::ErrorKind::ResourceBusy.into()));
        assert!(!held_by_a_tool(&io::ErrorKind::NotFound.into()));
        assert_eq!(held_by_a_tool(&io::Error::from_raw_os_error(32)), cfg!(windows));
    }

    #[test]
    fn a_rename_never_replaces_what_is_there() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = (temp.path().join("View (building)"), temp.path().join("View"));
        fs::create_dir(&from).unwrap();
        fs::create_dir(&to).unwrap();
        let error = transfer::rename_noreplace(&from, &to).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert!(from.exists() && to.exists());
    }
}
