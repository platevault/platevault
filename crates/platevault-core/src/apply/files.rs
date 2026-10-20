// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Apply's file work (spec 069 PREP-FR-03/04/09/15/18, 071 STO-FR-10; D19,
//! D-W81, D-W98, D-W100, D-W122): blocking, no catalog access.
//!
//! Every entry is made from an original whose bytes were just snapshotted,
//! never from an entry of the current or previous View: a symlink to the
//! original, or a clone or verified copy of it. A copy of a frame with a
//! recorded correction is an isolated patched copy, in a Copies or a
//! Symlinks View (PREP-FR-04): it takes the header change planned from its
//! original, and its entry records the digest it was proven to hold.
//! Nothing is ever hard-linked, so each Copies entry is its own file (D-W81,
//! 063 FR-005). Nothing here replaces an existing entry or follows a link.
//! Old entries leave `View (previous)/` only once proven: a link that is
//! still the one `PlateVault` placed and points at its original, a copy
//! that still holds the bytes `PlateVault` placed while its original still
//! holds them too. Everything else stays, named, for the user's review.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use uuid::Uuid;

use super::plan::PlanEntry;
use super::ApplyControl;
use crate::custody::{observe_entry, observe_source, same_identity, transfer, verify_source};
use crate::layout::VIEW_PREVIOUS_FOLDER;
use crate::patched_copy::{self, HeaderPatch, PatchTarget};
use crate::{
    EntryEvidence, EntryKind, EntryPlacement, FileIdentity, ForeignItem, ForeignItemState,
    ItemReason, ManifestEntry, NativePath, ObservationFingerprint, PreviousItem,
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
/// must still be the file, size, time and digest its basis recorded. It is
/// reached from its location's `root` without following a link.
pub fn snapshot(
    root: &Path,
    path: &Path,
    basis: &ObservationFingerprint,
    sha256: Option<&str>,
) -> Result<EntryEvidence, ItemReason> {
    let evidence = observe_source(root, path)
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
    pub patch: HeaderPatch,
}

// ── Build ────────────────────────────────────────────────────────────────────

/// How one entry was written.
#[derive(Clone, Debug)]
pub struct Written {
    pub placement: EntryPlacement,
    pub identity: FileIdentity,
    /// The digest a patched copy was proven to hold.
    pub patched_sha256: Option<String>,
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
            Ok(Written {
                placement: EntryPlacement::Symlink,
                identity: link.fingerprint.identity,
                patched_sha256: None,
            })
        }
        EntryPlacement::Copy | EntryPlacement::Clone => copy(placing, &original, &path),
    }
}

/// A copy of the original; for a frame with a recorded correction, the
/// isolated patched copy the patched-copy seam writes and proves
/// (PREP-FR-03, PREP-FR-09), which removes one that fails so Retry makes
/// it again.
fn copy(placing: &Placing, original: &Path, path: &Path) -> Result<Written, ItemReason> {
    let Some(header) = &placing.entry.patch else { return plain_copy(placing, original, path) };
    let patched = patched_copy::patch_copy(&PatchTarget {
        snapshot: &placing.snapshot,
        destination: destination(placing),
        operation: placing.operation,
        seq: placing.entry.seq,
        patch: header,
    })?;
    Ok(Written {
        placement: EntryPlacement::Copy,
        identity: patched.identity,
        patched_sha256: Some(patched.sha256),
    })
}

fn destination(placing: &Placing) -> TransferDestination {
    TransferDestination {
        root: NativePath::from_path(&placing.building),
        relative: NativePath::from_path(&placing.entry.path),
    }
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
                patched_sha256: None,
            });
        }
        transfer::discard(path, &clone.fingerprint.identity);
        return Err(reason(
            ReasonCode::DestinationMismatch,
            format!("the clone {} differs from its original", path.display()),
        ));
    }
    let destination = destination(placing);
    let written = transfer::begin(placing.operation, placing.entry.seq, &destination)?;
    transfer::write(snapshot, &destination, &written)?;
    transfer::verify(snapshot, &destination, &written)?;
    Ok(Written {
        placement: EntryPlacement::Copy,
        identity: written.identity,
        patched_sha256: None,
    })
}

/// Immediately before the swap (PREP-FR-09): each original still holds its
/// snapshot, each link is still the one written, and each copy or clone is
/// still the file written, re-read to its snapshot's digest or, for a
/// patched copy, to the digest its reviewed patch was proven to give.
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
        let failure = match entry.placement {
            EntryPlacement::Symlink => (!entry
                .written
                .as_ref()
                .is_some_and(|written| holds_link(&path, written)))
            .then(|| reason(ReasonCode::DestinationChanged, format!("{} changed", path.display()))),
            EntryPlacement::Copy | EntryPlacement::Clone => {
                (!holds_placed_copy(&path, entry)).then(|| {
                    reason(
                        ReasonCode::DestinationMismatch,
                        format!("{} no longer holds the bytes written", path.display()),
                    )
                })
            }
        };
        if let Some(failure) = failure {
            failures.push((relative, failure));
        }
    }
    failures
}

/// Whether `path` is still the link written as `identity`, never following
/// it. A link's target can't change in place, so its identity proves it.
fn holds_link(path: &Path, identity: &FileIdentity) -> bool {
    observe_entry(path).is_ok_and(|link| {
        matches!(link.kind, EntryKind::Link { .. })
            && same_identity(&link.fingerprint.identity, identity)
    })
}

/// Whether `path` still holds the copy `entry` placed: the same file, by its
/// own identity, re-read to the digest it was proven to hold, its
/// original's or a patched copy's. Size and time prove nothing (VSEL-FR-14).
pub fn holds_placed_copy(path: &Path, entry: &ManifestEntry) -> bool {
    observe_entry(path).is_ok_and(|copy| {
        copy.kind == EntryKind::File
            && entry
                .written
                .as_ref()
                .is_some_and(|written| same_identity(&copy.fingerprint.identity, written))
            && copy.sha256.as_deref() == Some(entry.copy_sha256())
    })
}

/// What of a `View (building)/` is this Project's own: a copy holding the
/// bytes of an original just snapshotted, by its digest, or a patched copy
/// at the path the build plans one, holding its original's bytes with the
/// planned change.
pub struct Ours {
    pub digests: BTreeSet<String>,
    /// By path relative to `View (building)/`.
    pub patches: Arc<BTreeMap<PathBuf, PlannedPatch>>,
}

impl Ours {
    fn holds(&self, relative: &Path, file: &EntryEvidence) -> bool {
        file.sha256.as_ref().is_some_and(|sha| self.digests.contains(sha))
            || self.patches.get(relative).is_some_and(|planned| {
                patched_copy::is_planned_patch(
                    file,
                    &planned.original,
                    &planned.source_sha256,
                    &planned.patch,
                )
            })
    }
}

/// Empty the `View (building)/` an earlier Apply of this Project left, then
/// remove it: a symlink holds no data, a partial copy an interrupted write
/// left is this module's own by its name, and so is every file of `ours`.
/// Anything else stays and is returned; the folder then stays too.
pub fn clear_building(building: &Path, ours: &Ours) -> Vec<PathBuf> {
    let walked = walk(building);
    let mut kept: Vec<PathBuf> = walked.unreadable.into_iter().map(|(path, _)| path).collect();
    for path in walked.files {
        let removable = match fs::symlink_metadata(&path) {
            Ok(metadata) if fs_pathsafe::is_link_or_junction_metadata(&metadata) => true,
            Ok(metadata) if metadata.is_file() => {
                let partial = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(transfer::is_partial_name);
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

/// Entries the walkers couldn't account for, each with why: the walk's
/// root itself when it is a link, a junction or no folder, and every
/// folder or entry below it that couldn't be read.
pub type Unreadable = Vec<(PathBuf, ItemReason)>;

/// What one no-follow walk below a root found.
#[derive(Default)]
struct Walked {
    /// Every file and link, sorted.
    files: Vec<PathBuf>,
    unreadable: Unreadable,
}

/// An entry a walk couldn't read. The OS error goes to the log only.
fn unreadable(path: &Path, error: &dyn std::fmt::Display) -> (PathBuf, ItemReason) {
    tracing::warn!(path = %path.display(), %error, "an entry can't be read; it is refused");
    (
        path.to_path_buf(),
        reason(ReasonCode::SourceUnavailable, format!("{} can't be read", path.display())),
    )
}

/// Every file and link below `root`, never following a link (STO-FR-04/05/16).
/// A root that is a link, a junction or no folder is refused and nothing
/// below it is read; an absent root holds nothing. Every folder or entry
/// that can't be read is named, never left out.
fn walk(root: &Path) -> Walked {
    let mut walked = Walked::default();
    match fs::symlink_metadata(root) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return walked,
        Err(error) => {
            walked.unreadable.push(unreadable(root, &error));
            return walked;
        }
        Ok(metadata)
            if fs_pathsafe::is_link_or_junction_metadata(&metadata) || !metadata.is_dir() =>
        {
            walked.unreadable.push((
                root.to_path_buf(),
                reason(
                    ReasonCode::SourceUnavailable,
                    format!("{} is a link or not a folder; nothing below it is read", root.display()),
                ),
            ));
            return walked;
        }
        Ok(_) => {}
    }
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let entries = match fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(error) => {
                walked.unreadable.push(unreadable(&folder, &error));
                continue;
            }
        };
        for entry in entries {
            let path = match entry {
                Ok(entry) => entry.path(),
                Err(error) => {
                    walked.unreadable.push(unreadable(&folder, &error));
                    continue;
                }
            };
            match fs::symlink_metadata(&path) {
                Ok(metadata)
                    if metadata.is_dir()
                        && !fs_pathsafe::is_link_or_junction_metadata(&metadata) =>
                {
                    folders.push(path);
                }
                Ok(_) => walked.files.push(path),
                // Gone since the folder was listed: nothing to account for.
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => walked.unreadable.push(unreadable(&path, &error)),
            }
        }
    }
    walked.files.sort();
    walked.unreadable.sort_by(|left, right| left.0.cmp(&right.0));
    walked.unreadable.dedup_by(|left, right| left.0 == right.0);
    walked
}

/// Remove `root` and every folder below it that holds nothing, deepest
/// first. A folder that holds anything stays; nothing is removed
/// recursively, and a root that is a link or no folder is left alone.
pub fn remove_empty_folders(root: &Path) {
    let real_folder = fs::symlink_metadata(root).is_ok_and(|metadata| {
        metadata.is_dir() && !fs_pathsafe::is_link_or_junction_metadata(&metadata)
    });
    if !real_folder {
        return;
    }
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

/// Whether `folder` is absent or a real folder holding no file or link at
/// any depth, with nothing below it unreadable.
pub fn holds_nothing(folder: &Path) -> bool {
    let walked = walk(folder);
    walked.files.is_empty() && walked.unreadable.is_empty()
}

/// Every file `folder` holds, relative to it, never following a link; or,
/// when `folder` is a link or anything below it can't be read, what
/// couldn't be read, never a partial list.
///
/// # Errors
/// The entries that couldn't be read, each with why.
pub fn files_below(folder: &Path) -> Result<Vec<PathBuf>, Unreadable> {
    let walked = walk(folder);
    if !walked.unreadable.is_empty() {
        return Err(walked.unreadable);
    }
    Ok(walked
        .files
        .into_iter()
        .filter_map(|path| path.strip_prefix(folder).ok().map(Path::to_path_buf))
        .collect())
}

// ── Foreign files ────────────────────────────────────────────────────────────

/// The files in `view` that `PlateVault` didn't place (VSEL-FR-20): every
/// file or link not at a path of `placed`, with folders expanded to their
/// files, with its no-follow evidence.
///
/// # Errors
/// When `view` is a link or anything in it can't be read or observed, what
/// couldn't be, never a partial inventory.
pub fn foreign_files(
    view: &Path,
    placed: &BTreeSet<PathBuf>,
) -> Result<Vec<(PathBuf, EntryEvidence)>, Unreadable> {
    let walked = walk(view);
    let mut missed = walked.unreadable;
    let mut found = Vec::new();
    for path in walked.files {
        let Ok(relative) = path.strip_prefix(view).map(Path::to_path_buf) else { continue };
        if placed.contains(&relative) {
            continue;
        }
        match observe_entry(&path) {
            Ok(evidence) => found.push((relative, evidence)),
            Err(error) => missed.push(unreadable(&path, &error)),
        }
    }
    if missed.is_empty() {
        Ok(found)
    } else {
        Err(missed)
    }
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
    // An entry that can't be read stays, and so does the folder: the next
    // sheet names it as unreadable before any Apply.
    for path in walk(&previous).files {
        let Ok(relative) = path.strip_prefix(&previous).map(Path::to_path_buf) else { continue };
        let reason = reasons.remove(&relative).unwrap_or(PreviousItemReason::UntickedFile);
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

/// An old copy goes once it still holds the bytes `PlateVault` placed, its
/// original's or, for a patched copy, the digest it was proven to hold when
/// written, and its original still exists and matches the recorded digest.
fn old_copy(
    path: &Path,
    entry: &ManifestEntry,
    original: Option<&PathBuf>,
) -> Result<(), PreviousItemReason> {
    if !holds_placed_copy(path, entry) {
        return Err(PreviousItemReason::ChangedCopy);
    }
    let verified = original.is_some_and(|original| {
        observe_entry(original).is_ok_and(|now| {
            now.kind == EntryKind::File
                && now.sha256.as_deref() == Some(entry.source_sha256.as_str())
        })
    });
    if verified {
        Ok(())
    } else {
        Err(PreviousItemReason::UnverifiedCopy)
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

    /// C3: a root that is a link is refused unread; nothing below it is
    /// listed, cleared or removed.
    #[cfg(unix)]
    #[test]
    fn a_linked_root_is_refused_and_never_walked() {
        let temp = tempfile::tempdir().unwrap();
        let elsewhere = temp.path().join("elsewhere");
        fs::create_dir_all(elsewhere.join("empty")).unwrap();
        fs::write(elsewhere.join("notes.txt"), b"not ours").unwrap();
        let root = temp.path().join("View (previous)");
        std::os::unix::fs::symlink(&elsewhere, &root).unwrap();

        let refused = files_below(&root).unwrap_err();
        assert_eq!(refused.len(), 1, "{refused:?}");
        assert_eq!(refused[0].0, root);
        assert_eq!(refused[0].1.code, ReasonCode::SourceUnavailable);
        assert!(!holds_nothing(&root));
        assert!(foreign_files(&root, &BTreeSet::new()).is_err());
        let ours = Ours { digests: BTreeSet::new(), patches: Arc::default() };
        assert_eq!(clear_building(&root, &ours), [root.clone()]);
        remove_empty_folders(&root);
        assert!(elsewhere.join("empty").is_dir(), "nothing below the link is removed");
        assert!(elsewhere.join("notes.txt").exists());
    }

    /// C10: a folder that can't be read is named, and `files_below` gives
    /// no partial list; an absent root holds nothing.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_entry_is_named_never_omitted() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Processing");
        fs::create_dir_all(root.join("WBPP")).unwrap();
        fs::write(root.join("WBPP/registered.xisf"), b"registered").unwrap();
        let hidden = root.join("Siril");
        fs::create_dir(&hidden).unwrap();
        fs::set_permissions(&hidden, fs::Permissions::from_mode(0o000)).unwrap();

        let refused = files_below(&root);
        let held = holds_nothing(&root);
        fs::set_permissions(&hidden, fs::Permissions::from_mode(0o755)).unwrap();
        let refused = refused.unwrap_err();
        assert_eq!(refused.iter().map(|(path, _)| path).collect::<Vec<_>>(), [&hidden]);
        assert!(!held);
        assert_eq!(files_below(&root).unwrap(), [PathBuf::from("WBPP/registered.xisf")]);
        assert_eq!(files_below(&temp.path().join("absent")).unwrap(), [] as [PathBuf; 0]);
    }
}
