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
use crate::custody::rooted::{Folder, Unentered};
use crate::custody::{
    observe_entry, observe_source, open_source, same_identity, transfer, verify_source,
};
use crate::layout::VIEW_PREVIOUS_FOLDER;
use crate::patched_copy::{self, HeaderPatch, PatchTarget};
use crate::{
    EntryEvidence, EntryKind, EntryPlacement, FileIdentity, ForeignItem, ForeignItemState,
    ItemReason, ManifestEntry, NativePath, ObservationFingerprint, PreviousItem,
    PreviousItemReason, PreviousItemReview, ReasonCode, SymlinkCapability, TransferDestination,
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
        tracing::warn!(path = %path.display(), %error, "an entry couldn't be written");
        reason(ReasonCode::WriteFailed, format!("{} couldn't be written", path.display()))
    }
}

/// `reason` as an Apply response carries it (CT3): its code with a fixed
/// diagnostic. What its producer wrote, which may hold an OS error's text
/// or a path the response doesn't name, goes to the log only, as a
/// `LibraryError`'s `Display` never crosses IPC either.
pub fn reported(path: &Path, reason: &ItemReason) -> ItemReason {
    tracing::warn!(
        path = %path.display(),
        code = ?reason.code,
        detail = %reason.detail,
        "Apply couldn't place an input"
    );
    ItemReason::new(reason.code, diagnostic(reason.code))
}

/// The English diagnostic Apply reports for `code`.
const fn diagnostic(code: ReasonCode) -> &'static str {
    match code {
        ReasonCode::TrashUnsupported => "the volume has no Trash",
        ReasonCode::TrashFailed => "the Trash refused it",
        ReasonCode::SourceDrift => "it changed since it was chosen",
        ReasonCode::SourceUnavailable => "it is missing or can't be read",
        ReasonCode::KeptCopyUnproven => "it no longer holds the bytes that were kept",
        ReasonCode::DestinationOccupied => "its place already holds an entry; nothing is replaced",
        ReasonCode::DestinationMismatch => "the entry written differs from its original",
        ReasonCode::DestinationChanged => "the entry changed while it was written",
        ReasonCode::WriteFailed => "its entry couldn't be written",
        ReasonCode::Interrupted => "an interruption left a state the record can't prove",
        ReasonCode::Protected => "it is protected",
    }
}

// ── Symlink and clone capability ─────────────────────────────────────────────

/// Whether `folder` can hold a symlink (PREP-FR-15): create a probe file and
/// a symlink to it under fresh hidden names, then remove exactly those.
///
/// # Errors
/// The OS error when `folder` can't hold even a plain file.
pub fn probe_symlinks(folder: &Path) -> io::Result<SymlinkCapability> {
    let name = format!(".platevault-symlink-probe-{}", Uuid::new_v4().simple());
    let target = folder.join(format!("{name}.file"));
    fs::OpenOptions::new().write(true).create_new(true).open(&target)?;
    let link = folder.join(format!("{name}.link"));
    let made = fs_pathsafe::create_symlink(&target, &link);
    if made.is_ok() {
        let _ = fs::remove_file(&link);
    }
    let _ = fs::remove_file(&target);
    Ok(match made {
        Ok(()) => SymlinkCapability::Available,
        Err(error) => {
            tracing::info!(folder = %folder.display(), %error, "symlinks can't be made here");
            link_refusal(&error, cfg!(windows))
        }
    })
}

/// What a refused symlink says about its folder: on Windows,
/// `ERROR_PRIVILEGE_NOT_HELD` is the unprivileged symlink right Developer
/// Mode grants (PREP-AC-08); any other refusal, on Windows or elsewhere, is
/// a filesystem that holds no links (PREP-AC-03).
fn link_refusal(error: &io::Error, windows: bool) -> SymlinkCapability {
    const ERROR_PRIVILEGE_NOT_HELD: i32 = 1314;
    if windows && error.raw_os_error() == Some(ERROR_PRIVILEGE_NOT_HELD) {
        SymlinkCapability::DeveloperModeOff
    } else {
        SymlinkCapability::Unsupported
    }
}

/// Whether a copy of `source` made in `folder` becomes a copy-on-write
/// clone (PREP-FR-04): the two are on one volume whose filesystem clones
/// (APFS, Btrfs, XFS). A clone of `source` is made in `folder` under a fresh
/// hidden name and removed; it shares the original's blocks, so nothing is
/// read or copied.
pub fn probe_clone(source: &Path, folder: &Path) -> bool {
    let Ok(original) = fs::File::open(source) else { return false };
    let probe = folder.join(format!(".platevault-clone-probe-{}", Uuid::new_v4().simple()));
    let cloned = transfer::clone_file(&original, &probe).is_ok();
    if cloned {
        let _ = fs::remove_file(&probe);
    }
    cloned
}

/// The volume `path` is on, where the platform can clone; `None` elsewhere.
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn clone_volume(path: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    fs::symlink_metadata(path).ok().map(|metadata| metadata.dev())
}

/// The volume `path` is on, where the platform can clone; `None` elsewhere.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub const fn clone_volume(_path: &Path) -> Option<u64> {
    None
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
        EntryPlacement::Copy | EntryPlacement::Clone => copy(placing, &path),
    }
}

/// A copy of the original; for a frame with a recorded correction, the
/// isolated patched copy the patched-copy seam writes and proves
/// (PREP-FR-03, PREP-FR-09), which removes one that fails so Retry makes
/// it again.
fn copy(placing: &Placing, path: &Path) -> Result<Written, ItemReason> {
    let Some(header) = &placing.entry.patch else { return plain_copy(placing, path) };
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
/// Both read the original through a handle reached from its root without
/// following a link (astro-plan-nlewt): a folder swapped for a link after
/// the snapshot refuses the entry before any byte is cloned or copied.
fn plain_copy(placing: &Placing, path: &Path) -> Result<Written, ItemReason> {
    let snapshot = &placing.snapshot;
    let original = open_source(snapshot)?;
    if transfer::clone_file(&original, path).is_ok() {
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
    drop(original);
    let destination = destination(placing);
    let written = transfer::begin(placing.operation, placing.entry.seq, &destination)?;
    let installed = transfer::write(snapshot, &destination, &written)?;
    transfer::verify(snapshot, &destination, &installed)?;
    Ok(Written {
        placement: EntryPlacement::Copy,
        identity: installed.identity,
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
            EntryPlacement::Copy | EntryPlacement::Clone => (!holds_placed_copy(&path, entry))
                .then(|| {
                    reason(
                        ReasonCode::DestinationMismatch,
                        format!("{} no longer holds the bytes written", path.display()),
                    )
                }),
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
/// So is an unfinished copy of a partial beside it: where the volume has no
/// no-replace rename (macOS exFAT) the partial is installed as a verified
/// copy under the entry's name, and an interruption leaves at most the
/// partial's first bytes there ([`transfer::remove_unfinished_copy`]).
/// Anything else stays and is returned; the folder then stays too.
pub fn clear_building(building: &Path, ours: &Ours) -> Vec<PathBuf> {
    let walked = walk(building);
    let mut kept: Vec<PathBuf> = walked.unreadable.into_iter().map(|(path, _)| path).collect();
    let is_partial = |path: &Path| {
        path.file_name().and_then(|name| name.to_str()).is_some_and(transfer::is_partial_name)
    };
    let (partials, others): (Vec<PathBuf>, Vec<PathBuf>) =
        walked.files.into_iter().partition(|path| is_partial(path));
    for path in others {
        let removed = match fs::symlink_metadata(&path) {
            Ok(metadata) if fs_pathsafe::is_link_or_junction_metadata(&metadata) => {
                fs::remove_file(&path).is_ok()
            }
            Ok(metadata) if metadata.is_file() => {
                let relative = path.strip_prefix(building).unwrap_or(&path);
                if observe_entry(&path).is_ok_and(|file| ours.holds(relative, &file)) {
                    fs::remove_file(&path).is_ok()
                } else {
                    partials.iter().any(|partial| {
                        partial.parent() == path.parent()
                            && transfer::remove_unfinished_copy(&path, partial)
                    })
                }
            }
            _ => false,
        };
        if !removed {
            kept.push(path);
        }
    }
    for path in partials {
        let regular = fs::symlink_metadata(&path).is_ok_and(|metadata| {
            metadata.is_file() || fs_pathsafe::is_link_or_junction_metadata(&metadata)
        });
        if !(regular && fs::remove_file(&path).is_ok()) {
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
    walk_from(root, Path::new(""))
}

/// [`walk`] of `base/relative`, entering `base` and every folder of
/// `relative` as itself: a link anywhere from `base` down is refused, never
/// followed. Each folder is listed through its own handle and its
/// subfolders entered through it, so a folder swapped for a link while the
/// walk runs is never followed out of `base` (astro-plan-yb133).
fn walk_from(base: &Path, relative: &Path) -> Walked {
    let mut walked = Walked::default();
    match enter(base, relative) {
        Ok(Some(folder)) => walk_below(&folder, &mut walked),
        Ok(None) => {}
        Err(refusal) => walked.unreadable.push(refusal),
    }
    walked.files.sort();
    walked.unreadable.sort_by(|left, right| left.0.cmp(&right.0));
    walked.unreadable.dedup_by(|left, right| left.0 == right.0);
    walked
}

/// `base/relative` entered as itself from `base`; `None` when it is absent.
///
/// # Errors
/// The first folder on the way that is a link, a junction or no folder, or
/// can't be opened.
fn enter(base: &Path, relative: &Path) -> Result<Option<Folder>, (PathBuf, ItemReason)> {
    let opened = |result: Result<Folder, Unentered>, at: &Path| match result {
        Ok(folder) => Ok(Some(folder)),
        Err(Unentered::Io(error)) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(Unentered::Io(error)) => Err(unreadable(at, &error)),
        Err(Unentered::NotAFolder) => Err(not_a_folder(at)),
    };
    let Some(mut folder) = opened(Folder::open(base), base)? else { return Ok(None) };
    for part in relative.components() {
        let Component::Normal(name) = part else { return Err(not_a_folder(&base.join(relative))) };
        let at = folder.path().join(name);
        let Some(child) = opened(folder.child(name), &at)? else { return Ok(None) };
        folder = child;
    }
    Ok(Some(folder))
}

fn not_a_folder(path: &Path) -> (PathBuf, ItemReason) {
    (
        path.to_path_buf(),
        reason(
            ReasonCode::SourceUnavailable,
            format!("{} is a link or not a folder; nothing below it is read", path.display()),
        ),
    )
}

/// The `AppleDouble` header's magic number (RFC 1740), big-endian.
const APPLE_DOUBLE: [u8; 4] = [0x00, 0x05, 0x16, 0x07];

/// Every file and link below `folder`, through its handle. An `AppleDouble`
/// companion `._<name>` beside an entry `<name>` is part of that entry and
/// is left out (astro-plan-cyqdo): macOS keeps one beside each file it
/// writes on exFAT and other volumes without extended attributes, and
/// removes or renames it with its entry. `PlateVault` never unlinks one
/// itself; a `._` file with no entry beside it is listed like any file.
fn walk_below(folder: &Folder, walked: &mut Walked) {
    let listed = match folder.list() {
        Ok(listed) => listed,
        Err(error) => {
            walked.unreadable.push(unreadable(folder.path(), &error));
            return;
        }
    };
    let names: BTreeSet<&std::ffi::OsStr> =
        listed.iter().map(|entry| entry.name.as_os_str()).collect();
    for entry in &listed {
        let path = folder.path().join(&entry.name);
        if entry.folder {
            match folder.child(&entry.name) {
                Ok(child) => walk_below(&child, walked),
                // Gone since the folder was listed: nothing to account for.
                Err(Unentered::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
                // A link or a file now: an entry of its own, never followed.
                Err(Unentered::NotAFolder) => walked.files.push(path),
                Err(Unentered::Io(error)) => walked.unreadable.push(unreadable(&path, &error)),
            }
            continue;
        }
        let companion = entry
            .name
            .to_str()
            .and_then(|name| name.strip_prefix("._"))
            .is_some_and(|base| !base.is_empty() && names.contains(std::ffi::OsStr::new(base)))
            && folder.file_starts_with(&entry.name, &APPLE_DOUBLE);
        if !companion {
            walked.files.push(path);
        }
    }
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
    // macOS removes a folder whose only entries are `._` AppleDouble files,
    // and those files with it; one with no entry beside it is the user's
    // (astro-plan-cyqdo), so a folder is removed only once it lists nothing.
    for folder in folders.iter().rev() {
        if fs::read_dir(folder).is_ok_and(|mut entries| entries.next().is_none()) {
            let _ = fs::remove_dir(folder);
        }
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
    files_below_from(folder, Path::new(""))
}

/// [`files_below`] of `base/relative`, entering `base` and every folder of
/// `relative` as itself, so a link anywhere from `base` down refuses the
/// list rather than being followed.
///
/// # Errors
/// The entries that couldn't be read, each with why.
pub fn files_below_from(base: &Path, relative: &Path) -> Result<Vec<PathBuf>, Unreadable> {
    let walked = walk_from(base, relative);
    if !walked.unreadable.is_empty() {
        return Err(walked.unreadable);
    }
    let folder = base.join(relative);
    Ok(walked
        .files
        .into_iter()
        .filter_map(|path| path.strip_prefix(&folder).ok().map(Path::to_path_buf))
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
        match observe_source(view, &path) {
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
/// over an entry the new View placed (`placed`, relative to `View/`).
///
/// Where the volume has no no-replace rename (macOS exFAT) a file moves as a
/// verified copy, with an identity of its own. A resumed move whose source
/// is gone therefore accepts the reviewed kind and bytes at the destination,
/// and one whose copy an interruption left unfinished removes that copy,
/// which holds nothing the source doesn't, and moves again.
pub fn move_foreign(
    previous: &Path,
    view: &Path,
    placed: &BTreeSet<PathBuf>,
    item: &ForeignItem,
) -> ForeignItem {
    let mut item = item.clone();
    if !item.ticked {
        item.state = ForeignItemState::Stayed;
        return item;
    }
    let outcome = (|| {
        let relative = item.path.relative_path().map_err(|error| error.to_string())?;
        let taken = || format!("the new View already holds {}", relative.display());
        if placed.contains(&relative) {
            return Err(taken());
        }
        let from = previous.join(&relative);
        let to = view.join(&relative);
        let gone =
            fs::symlink_metadata(&from).is_err_and(|error| error.kind() == io::ErrorKind::NotFound);
        if gone && holds_reviewed_bytes(&to, &item.evidence) {
            return Ok(());
        }
        if !is_reviewed(&from, &item.evidence) {
            return Err(format!("{} changed after the Apply sheet listed it", relative.display()));
        }
        let folder = relative.parent().unwrap_or_else(|| Path::new(""));
        transfer::ensure_folder(view, folder).map_err(|failure| {
            tracing::warn!(path = %to.display(), detail = %failure.detail, "a foreign file's folder couldn't be made");
            format!("the folder of {} couldn't be made in the new View", relative.display())
        })?;
        let mut moved = transfer::rename_noreplace(&from, &to);
        if moved.as_ref().is_err_and(|error| error.kind() == io::ErrorKind::AlreadyExists)
            && transfer::remove_unfinished_copy(&to, &from)
        {
            moved = transfer::rename_noreplace(&from, &to);
        }
        moved.map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                taken()
            } else {
                tracing::warn!(path = %from.display(), %error, "a foreign file couldn't be moved");
                format!("{} couldn't be moved into the new View", relative.display())
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

/// Whether `path` holds the reviewed kind and bytes, whatever its identity:
/// the verified copy a move made where the volume has no no-replace rename.
fn holds_reviewed_bytes(path: &Path, reviewed: &EntryEvidence) -> bool {
    observe_entry(path).is_ok_and(|now| now.kind == reviewed.kind && now.sha256 == reviewed.sha256)
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
    /// The OS refused the move; the log has its error.
    Failed,
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
            Ok(Err(error)) => break aside_failed(from, &error),
            Err(error) => break aside_failed(from, &error),
        }
    };
    if waited {
        control.waiting(None);
    }
    outcome
}

/// The OS refused to move the old View aside: its error goes to the log.
fn aside_failed(from: &Path, error: &dyn std::fmt::Display) -> Aside {
    tracing::warn!(from = %from.display(), %error, "the old View couldn't be moved aside");
    Aside::Failed
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
    sources: &BTreeMap<Uuid, Original>,
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
        let Ok(evidence) = observe_source(&previous, &path) else { continue };
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

/// Where a placed entry's original is now: its path below its location's
/// registered root, from which every check reaches it without following a
/// link (STO-FR-07).
#[derive(Clone, Debug)]
pub struct Original {
    pub root: NativePath,
    pub path: NativePath,
}

impl Original {
    /// Every original `inputs` names, by asset or master id.
    pub fn all(inputs: &persistence_library::ApplyInputs) -> BTreeMap<Uuid, Self> {
        inputs
            .sources
            .iter()
            .filter_map(|(id, source)| {
                let location = inputs.locations.get(&source.location_id)?;
                Some((*id, Self { root: location.path.clone(), path: source.path.clone() }))
            })
            .collect()
    }

    /// What this original must still be for a copy `entry` placed to go:
    /// the file, size, modification time and SHA-256 its snapshot recorded
    /// when the copy was written, at its current path below its root.
    pub fn as_placed_by(&self, entry: &ManifestEntry) -> EntryEvidence {
        EntryEvidence {
            path: self.path.clone(),
            root: Some(self.root.clone()),
            kind: EntryKind::File,
            fingerprint: ObservationFingerprint {
                content_sha256: None,
                ..entry.source_fingerprint.clone()
            },
            sha256: Some(entry.source_sha256.clone()),
        }
    }
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
    original: Option<&Original>,
) -> Result<(), PreviousItemReason> {
    let link = observe_entry(path).map_err(|_| PreviousItemReason::UnverifiedLink)?;
    let EntryKind::Link { target } = &link.kind else {
        return Err(PreviousItemReason::UnverifiedLink);
    };
    let ours = entry
        .written
        .as_ref()
        .is_some_and(|written| same_identity(&link.fingerprint.identity, written));
    let points = original.is_some_and(|original| *target == original.path);
    if ours && points {
        Ok(())
    } else {
        Err(PreviousItemReason::UnverifiedLink)
    }
}

/// An old copy goes once it still holds the bytes `PlateVault` placed, its
/// original's or, for a patched copy, the digest it was proven to hold when
/// written, and its original, reached from its root without following a
/// link, is still the file its snapshot recorded with those bytes
/// (astro-plan-9w4qm): the copy is deleted outright, so its original must
/// be proven where the catalog keeps it.
fn old_copy(
    path: &Path,
    entry: &ManifestEntry,
    original: Option<&Original>,
) -> Result<(), PreviousItemReason> {
    if !holds_placed_copy(path, entry) {
        return Err(PreviousItemReason::ChangedCopy);
    }
    if original.is_some_and(|original| verify_source(&original.as_placed_by(entry)).is_ok()) {
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

    /// PREP-AC-08 against PREP-AC-03: only Windows' missing symlink right is
    /// Developer Mode; every other refusal is a filesystem without links.
    #[test]
    fn a_refused_symlink_names_its_real_cause() {
        let privilege = io::Error::from_raw_os_error(1314);
        assert_eq!(link_refusal(&privilege, true), SymlinkCapability::DeveloperModeOff);
        assert_eq!(link_refusal(&privilege, false), SymlinkCapability::Unsupported);
        let unsupported = io::Error::from_raw_os_error(50);
        assert_eq!(link_refusal(&unsupported, true), SymlinkCapability::Unsupported);
        let eperm = io::Error::from(io::ErrorKind::PermissionDenied);
        assert_eq!(link_refusal(&eperm, false), SymlinkCapability::Unsupported);
    }

    #[test]
    fn the_symlink_and_clone_probes_leave_nothing_behind() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join("Processing");
        fs::create_dir(&folder).unwrap();
        assert_eq!(probe_symlinks(&folder).unwrap(), SymlinkCapability::Available);
        let original = temp.path().join("Light_001.fits");
        fs::write(&original, b"light").unwrap();
        let cloned = probe_clone(&original, &folder);
        assert!(cloned || !cfg!(target_os = "macos"), "a macOS temp folder is on APFS");
        assert!(fs::read_dir(&folder).unwrap().next().is_none());
        assert!(probe_symlinks(&folder.join("missing")).is_err());
        assert!(!probe_clone(&temp.path().join("missing"), &folder));
    }

    /// CT3: a reported reason keeps its code and drops its producer's text.
    #[test]
    fn a_reported_reason_carries_no_os_text() {
        let error = io::Error::from_raw_os_error(13);
        let produced = failed(Path::new("/SENTINEL/View (building)/Light_001.fits"), &error);
        assert!(!produced.detail.contains("os error"), "{produced:?}");
        let raw = reason(ReasonCode::SourceUnavailable, format!("/SENTINEL: {error}"));
        let reported = reported(Path::new("Light_001.fits"), &raw);
        assert_eq!(reported.code, ReasonCode::SourceUnavailable);
        assert!(!reported.detail.contains("SENTINEL") && !reported.detail.contains("os error"));
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
        assert_eq!(clear_building(&root, &ours), std::slice::from_ref(&root));
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

    /// cyqdo: an `AppleDouble` companion `._X` beside an entry `X` is part of
    /// it and never listed; a `._` file with no entry beside it, or without
    /// the `AppleDouble` header, is listed like any file.
    #[test]
    fn an_apple_double_companion_is_part_of_its_entry() {
        let temp = tempfile::tempdir().unwrap();
        let view = temp.path().join("View");
        fs::create_dir_all(view.join("Darks")).unwrap();
        let mut companion = vec![0x00_u8, 0x05, 0x16, 0x07];
        companion.resize(4096, 0);
        fs::write(view.join("Darks/Dark_001.fits"), b"placed").unwrap();
        fs::write(view.join("Darks/._Dark_001.fits"), &companion).unwrap();
        fs::write(view.join("._Darks"), &companion).unwrap();
        fs::write(view.join("._Orphan.fits"), &companion).unwrap();
        fs::write(view.join("notes.txt"), b"the user's").unwrap();
        fs::write(view.join("._notes.txt"), b"not AppleDouble").unwrap();
        let placed = BTreeSet::from([PathBuf::from("Darks/Dark_001.fits")]);
        let foreign: Vec<PathBuf> =
            foreign_files(&view, &placed).unwrap().into_iter().map(|(path, _)| path).collect();
        assert_eq!(
            foreign,
            [
                PathBuf::from("._Orphan.fits"),
                PathBuf::from("._notes.txt"),
                PathBuf::from("notes.txt")
            ]
        );
    }

    /// yb133: a walk lists each folder through its handle and enters a
    /// subfolder through it, so a folder swapped for a link meanwhile is
    /// never followed.
    #[cfg(unix)]
    #[test]
    fn a_walk_never_follows_a_folder_swapped_while_it_runs() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("View (previous)");
        fs::create_dir_all(root.join("night")).unwrap();
        fs::write(root.join("night/Light_001.fits"), b"inside").unwrap();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("theirs.fits"), b"outside").unwrap();

        let folder = Folder::open(&root).unwrap();
        let listed = folder.list().unwrap();
        assert!(listed.iter().any(|entry| entry.name == "night" && entry.folder));
        fs::rename(root.join("night"), temp.path().join("away")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("night")).unwrap();
        assert!(matches!(folder.child(std::ffi::OsStr::new("night")), Err(Unentered::NotAFolder)));

        let walked = walk(&root);
        assert_eq!(walked.files, [root.join("night")], "the link is an entry, not followed");
        assert_eq!(walked.unreadable.len(), 0, "nothing is unreadable");
    }
}
