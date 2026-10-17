// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Read-only, progressive inventory of one registered location.
//!
//! The walker never writes, renames or follows links. It reuses the
//! `metadata_fits`/`metadata_xisf` header adapters and the `fs_pathsafe`
//! link/junction classifier. An entry counts only while every folder from the
//! root down to it is still the directory it was listed from, checked before
//! and after its header is read, so a folder swapped for a link mid-scan never
//! brings an outside file into the location.
//!
//! # Scope semantics
//!
//! Relative paths are lossless [`NativePath`]s; the empty path is the location
//! root. A complete scope covers its whole subtree, minus every incomplete
//! scope. Each per-entry failure, unreadable directory, skipped link, nested
//! foreign volume and unverified file is an incomplete scope and an issue, so
//! an unobserved path counts as absent only inside a complete scope and
//! outside every incomplete scope, which is the rule the catalog applies.
//! Canceled and failed observations carry no complete scope.
//!
//! # Identity
//!
//! A location root must be an absolute folder on a volume with a remount-stable
//! volume ID and folder ID; roots without a qualified folder ID (FAT, `exFAT`,
//! `ReFS`) are refused before any batch. The registered root identity is
//! verified before the walk and again before the final batch. Before every
//! batch the root's same-session continuity stamp is rechecked; a change ends
//! the scan as `Failed`, discarding the undelivered batch.

#[path = "inventory/identity.rs"]
mod identity;

use std::cell::Cell;
use std::ffi::{OsStr, OsString};
use std::fs::{self, Metadata};
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use metadata_core::{MetadataExtractError, MetadataExtractor};
use metadata_fits::FitsExtractor;
use metadata_xisf::XisfExtractor;

use crate::{
    Availability, CaptureMetadata, FileIdentity, ImageFormat, LibraryError, Location, NativePath,
    ObservationFingerprint, ScanBatch, ScanFile, ScanIssue, ScanObservation, ScanOptions,
    ScanProgress, ScanState, VolumeIdentity, VolumeKind,
};

pub use identity::FolderId;
#[cfg(test)]
pub(crate) use identity::Probed;
use identity::Stamp;
pub(crate) use identity::{OsVolumes, VolumeCache, VolumeProbe};

/// A folder observed for registration: its identity and the kind of volume it
/// is on.
#[derive(Clone, Debug)]
pub struct ObservedRoot {
    pub identity: FileIdentity,
    pub volume_kind: VolumeKind,
}

/// Observe a folder for registration: its remount-stable identity and whether
/// it is on a local, removable or network volume (LIB-FR-01).
///
/// # Errors
/// `SourceUnavailable`/`AccessDenied` when the root cannot be inspected,
/// `InvalidInput` for an SMB or URL address (refused before any file system
/// access), a relative path, `..`, a link or a junction root, and
/// `IdentityConflict` when the volume or the root folder ID cannot be
/// qualified on this host and filesystem.
pub fn observe_root(root: &Path) -> Result<ObservedRoot, LibraryError> {
    identity::observe(root, &OsVolumes).map(|observation| ObservedRoot {
        identity: observation.identity,
        volume_kind: observation.kind,
    })
}

/// Observe the remount-stable identity of a folder.
///
/// # Errors
/// As [`observe_root`].
pub fn observe_root_identity(root: &Path) -> Result<FileIdentity, LibraryError> {
    observe_root(root).map(|observed| observed.identity)
}

/// Observe a folder's identity without following a link: its qualified volume
/// and, where the volume's file IDs are stable, its folder ID. Unlike
/// [`observe_root`], a folder without a remount-stable ID (FAT, `exFAT`) is
/// accepted; its identity then names the volume only.
///
/// # Errors
/// `InvalidInput` for a link, a junction or anything but a folder, the I/O
/// error kind when the folder cannot be inspected, and `IdentityConflict`
/// when the volume identity cannot be qualified.
pub fn observe_folder_identity(root: &Path) -> Result<FileIdentity, LibraryError> {
    let meta = fs::symlink_metadata(root).map_err(|error| LibraryError::from_io(root, &error))?;
    if fs_pathsafe::is_link_or_junction_metadata(&meta) || !meta.is_dir() {
        return Err(identity::scoped(
            LibraryError::InvalidInput("not a folder; links are not followed".into()),
            root,
        ));
    }
    let volume = identity::volume_of(root, &meta, &OsVolumes)?;
    let file_id = identity::file_id(root, &meta, &volume)
        .map_err(|error| LibraryError::from_io(root, &error))?;
    Ok(FileIdentity { volume, file_id })
}

/// Re-observe a registered root and refuse it unless it is the registered
/// volume and folder. Intended inside final reconciliation transactions.
///
/// # Errors
/// As [`observe_root_identity`], plus `IdentityConflict` on any mismatch, and
/// `SourceUnavailable` for a network location whose share is not mounted.
pub fn validate_location_root(location: &Location) -> Result<FileIdentity, LibraryError> {
    validate_location_root_in(location, &OsVolumes)
}

/// As [`validate_location_root`], qualifying the volume through `volumes`:
/// a run's [`VolumeCache`] probes each root's volume once (see its invariant).
///
/// # Errors
/// As [`validate_location_root`].
pub(crate) fn validate_location_root_in(
    location: &Location,
    volumes: &impl VolumeProbe,
) -> Result<FileIdentity, LibraryError> {
    let root = location.path.to_path_buf().map_err(|error| locate(error, location))?;
    let observed = identity::observe(&root, volumes).map_err(|error| locate(error, location))?;
    identity::compare(location, &observed, &root).map_err(|error| locate(error, location))?;
    Ok(observed.identity)
}

/// Why [`check_location_root`] refused a root.
#[derive(Debug)]
pub(crate) enum RootRefusal {
    /// The root was observed and is not the registered folder on the
    /// registered volume (or the registered share is not mounted there). It
    /// stays refused until the folder at the path changes.
    Mismatch(LibraryError),
    /// The root or its volume could not be observed, as when a volume query
    /// fails or times out: it may pass when checked again.
    Unobserved(LibraryError),
}

/// [`validate_location_root`], telling a root that was observed and refused
/// from one that could not be observed.
///
/// # Errors
/// The refusal, as [`validate_location_root`] reports it.
pub(crate) fn check_location_root(location: &Location) -> Result<(), RootRefusal> {
    let root = location
        .path
        .to_path_buf()
        .map_err(|error| RootRefusal::Mismatch(locate(error, location)))?;
    let observed = identity::observe(&root, &OsVolumes)
        .map_err(|error| RootRefusal::Unobserved(locate(error, location)))?;
    identity::compare(location, &observed, &root)
        .map_err(|error| RootRefusal::Mismatch(locate(error, location)))
}

/// Observe one file's current fingerprint: no-follow size, nanosecond mtime,
/// remount-stable volume identity and qualified file ID. Reads no content.
///
/// # Errors
/// `InvalidInput` for links, junctions and non-regular files, the I/O error
/// kind when the entry cannot be inspected, and `IdentityConflict` when the
/// volume identity cannot be qualified or the entry changed while its file ID
/// was read (a file still being written).
pub fn probe_fingerprint(path: &Path) -> Result<ObservationFingerprint, LibraryError> {
    probe_fingerprint_in(path, &OsVolumes)
}

/// As [`probe_fingerprint`], qualifying the volume through `volumes`: below
/// a root a run's [`VolumeCache`] already probed, its probe is reused.
///
/// # Errors
/// As [`probe_fingerprint`].
pub(crate) fn probe_fingerprint_in(
    path: &Path,
    volumes: &impl VolumeProbe,
) -> Result<ObservationFingerprint, LibraryError> {
    let meta = fs::symlink_metadata(path).map_err(|error| LibraryError::from_io(path, &error))?;
    if fs_pathsafe::is_link_or_junction_metadata(&meta) || !meta.is_file() {
        return Err(identity::scoped(
            LibraryError::InvalidInput("not a regular file; links are not followed".into()),
            path,
        ));
    }
    let volume = identity::volume_of(path, &meta, volumes)?;
    let file_id = identity::file_id(path, &meta, &volume)
        .map_err(|error| identity::file_id_error(path, &error))?;
    let modified_ns = meta.modified().ok().and_then(nanos_since_epoch).ok_or_else(|| {
        identity::scoped(
            LibraryError::SourceUnavailable("modification time unavailable".into()),
            path,
        )
    })?;
    Ok(fingerprint(file_id, &meta, &volume, modified_ns))
}

/// A location root's same-session continuity evidence, taken when new-capture
/// discovery starts watching it: the same folder on the same mounted volume
/// keeps it, while an unmounted, remounted or replaced root does not.
///
/// Besides the root's [`Stamp`], which the walker compares its folders
/// against, it holds the root's [`FolderId`]. On Windows the stamp holds only
/// the creation time, which a replacement folder can share (NTFS can carry
/// it over to a folder created under a name that was just renamed away), so
/// the folder ID tells the two apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RootStamp {
    stamp: Stamp,
    folder: Option<FolderId>,
}

impl RootStamp {
    /// The root's folder ID; `None` on a platform that reports none.
    pub(crate) const fn folder(self) -> Option<FolderId> {
        self.folder
    }
}

/// The stamp of the real folder at `root`, or `None` when it is absent,
/// unreadable, a link, a junction or not a folder. One no-follow `stat`, and
/// on Windows a query of a handle on the folder itself for its folder ID.
pub(crate) fn root_stamp(root: &Path) -> Option<RootStamp> {
    let meta = fs::symlink_metadata(root).ok()?;
    if !meta.is_dir() || fs_pathsafe::is_link_or_junction_metadata(&meta) {
        return None;
    }
    let folder = identity::folder_id(root, &meta).ok()?;
    Some(RootStamp { stamp: identity::stamp(&meta), folder })
}

/// What an entry below a location root is to the walker, decided from its
/// no-follow metadata alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Entry {
    /// A supported frame: the next scan reads its header.
    Frame,
    /// A real folder on the root's volume: the walker enters it.
    Folder,
    /// Absent, or nothing the walker reads: a link, a junction, an unsupported
    /// file, a nested foreign volume, or anything below one of those.
    Other,
    /// Not observed: its metadata, or that of a folder above it, could not be
    /// read for another reason than its absence (a share's brief I/O error,
    /// a folder without search permission), or a folder above it changed
    /// while it was looked up. What it is stays unknown.
    Unobserved,
}

/// One entry by the walker's rules, from its no-follow metadata. The scan
/// ([`Walk::visit`]) and new-capture discovery ([`entry_of`]) both decide by
/// it, so discovery counts exactly the files the next scan reads.
enum Kind {
    /// A link or junction: never followed.
    Link,
    /// A real folder on the root's volume, entered; its stamp.
    Folder(Stamp),
    /// A real folder on another volume: never entered.
    ForeignVolume,
    /// Anything else, with its format: `Unsupported` unless it is a regular
    /// file with a supported extension.
    File(ImageFormat),
}

fn kind(meta: &Metadata, relative: &Path, root: &Stamp) -> Kind {
    if fs_pathsafe::is_link_or_junction_metadata(meta) {
        Kind::Link
    } else if meta.is_dir() {
        let stamp = identity::stamp(meta);
        if stamp.same_device(root) {
            Kind::Folder(stamp)
        } else {
            Kind::ForeignVolume
        }
    } else if meta.is_file() {
        Kind::File(format_of(relative))
    } else {
        Kind::File(ImageFormat::Unsupported)
    }
}

/// What one entry is to discovery, by the walker's rules ([`Kind`]).
fn entry_of(kind: &Kind) -> Entry {
    match kind {
        Kind::Folder(_) => Entry::Folder,
        Kind::File(ImageFormat::Fits | ImageFormat::Xisf) => Entry::Frame,
        Kind::Link | Kind::ForeignVolume | Kind::File(ImageFormat::Unsupported) => Entry::Other,
    }
}

/// What `relative` (a path below `root`, whose stamp is `stamp`) is by the
/// walker's rules: every folder from the root down must be a real folder on
/// the root's volume. See [`entry_at_with`].
pub(crate) fn entry_at(root: &Path, stamp: RootStamp, relative: &Path) -> Entry {
    entry_at_with(root, stamp, relative, |path| fs::symlink_metadata(path))
}

/// [`entry_at`], reading each entry's no-follow metadata on the way down
/// through `stat`.
///
/// An entry, or a folder above it, that is not there is [`Entry::Other`]; one
/// whose metadata could not be read for another reason is
/// [`Entry::Unobserved`]. Each folder above the entry is checked only before
/// the lookup steps into it, so, as the walker does ([`changed_folder`]), the
/// root and every folder above the entry are checked again once the lookup
/// ended: when the root no longer carries `stamp` (its folder ID included,
/// as [`root_stamp`] reads it) or a folder above the entry is no longer the
/// real folder recorded on the way down (swapped for a link or junction
/// meanwhile, which a later step followed), the result is not the tree's and
/// is [`Entry::Unobserved`].
pub(crate) fn entry_at_with(
    root: &Path,
    stamp: RootStamp,
    relative: &Path,
    mut stat: impl FnMut(&Path) -> std::io::Result<Metadata>,
) -> Entry {
    let depth = relative.components().count();
    if depth == 0 || relative.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Entry::Other;
    }
    // The stamps of the folders above the entry, as the lookup found them.
    let mut above = Vec::with_capacity(depth - 1);
    let mut path = root.to_path_buf();
    let found = 'lookup: {
        for (step, part) in relative.components().enumerate() {
            path.push(part);
            let meta = match stat(&path) {
                Ok(meta) => meta,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    break 'lookup Entry::Other;
                }
                Err(_) => break 'lookup Entry::Unobserved,
            };
            let kind = kind(&meta, relative, &stamp.stamp);
            if step + 1 == depth {
                break 'lookup entry_of(&kind);
            }
            let Kind::Folder(folder) = kind else {
                break 'lookup Entry::Other;
            };
            above.push(folder);
        }
        Entry::Other
    };
    let mut path = root.to_path_buf();
    let unchanged = root_stamp(root) == Some(stamp)
        && relative.components().zip(&above).all(|(part, recorded)| {
            path.push(part);
            still_folder(&path, recorded)
        });
    if unchanged {
        found
    } else {
        Entry::Unobserved
    }
}

/// What [`frame_paths`] found below a location root, as relative paths.
#[derive(Debug, Default)]
pub(crate) struct Listing {
    /// Every supported frame.
    pub(crate) frames: Vec<NativePath>,
    /// Every folder entered below the root, listed or not.
    pub(crate) folders: Vec<PathBuf>,
    /// The folders below the root that could not be listed, or only in part
    /// (an entry that could not be read or `stat`ed): what they hold is
    /// missing from `frames`, or may be.
    pub(crate) unlisted: Vec<PathBuf>,
}

/// Every supported frame below `root`, listed by the walker's rules (no
/// link, junction or nested foreign volume is entered) without reading a
/// header: the files the next scan of the location reads. A folder below
/// the root that cannot be listed, or only in part, is skipped or kept with
/// what it listed, as a scan would name it incomplete, and named in
/// [`Listing::unlisted`]. Cancellation ends the listing with what it found;
/// a listing canceled before it starts touches nothing.
///
/// As the scan's walker does, each folder is listed only while it, and every
/// folder above it, is still the real folder found when it was queued: one
/// swapped for a link or junction is not entered, and a listing taken while
/// one was swapped is dropped, so no listing reaches outside the root.
///
/// The root's stamp is checked before and after the listing, as a scan
/// checks it before its final batch: a drive pulled mid-walk leaves its
/// remaining folders unreadable, and that partial listing is not the root's.
///
/// # Errors
/// `SourceUnavailable` when `root` no longer carries `stamp`, and the I/O
/// error kind when the root itself cannot be listed.
pub(crate) fn frame_paths(
    root: &Path,
    stamp: RootStamp,
    canceled: &AtomicBool,
) -> Result<Listing, LibraryError> {
    if canceled.load(Ordering::Acquire) {
        return Ok(Listing::default());
    }
    still_root(root, stamp)?;
    let mut listed = Listing::default();
    let mut pending = vec![Rc::new(Folder {
        relative: PathBuf::new(),
        path: root.to_path_buf(),
        stamp: stamp.stamp,
        parent: None,
        excluded: Cell::new(false),
    })];
    while let Some(folder) = pending.pop() {
        if canceled.load(Ordering::Acquire) {
            return Ok(listed);
        }
        match list_folder(&folder, &stamp.stamp) {
            Ok(Some(FolderListing { frames, folders, complete })) => {
                listed.frames.extend(frames);
                listed.folders.extend(folders.iter().map(|child| child.relative.clone()));
                pending.extend(folders);
                if !complete {
                    listed.unlisted.push(folder.relative.clone());
                }
            }
            // Swapped for a link or junction: what is there now is not below
            // the root, and an event names its path.
            Ok(None) => {}
            Err(error) if folder.parent.is_none() => {
                return Err(LibraryError::from_io(root, &error));
            }
            Err(_) => listed.unlisted.push(folder.relative.clone()),
        }
    }
    still_root(root, stamp)?;
    Ok(listed)
}

/// The supported frames and the real folders one folder holds, as relative
/// paths.
struct FolderListing {
    frames: Vec<NativePath>,
    folders: Vec<Rc<Folder>>,
    /// Whether every entry was read and `stat`ed.
    complete: bool,
}

/// List `folder` while it and every folder above it are still the real
/// folders recorded: `None` when one of them changed before or during the
/// listing. An entry that cannot be read or `stat`ed, unless it was removed
/// meanwhile, leaves the listing incomplete.
///
/// # Errors
/// The folder could not be listed.
fn list_folder(folder: &Rc<Folder>, root: &Stamp) -> std::io::Result<Option<FolderListing>> {
    if changed_folder(folder).is_some() {
        return Ok(None);
    }
    let mut listing = FolderListing { frames: Vec::new(), folders: Vec::new(), complete: true };
    for entry in fs::read_dir(&folder.path)? {
        let Ok(entry) = entry else {
            // The read stopped part-way.
            listing.complete = false;
            break;
        };
        let relative = folder.relative.join(entry.file_name());
        let path = folder.path.join(entry.file_name());
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) => {
                listing.complete &= error.kind() == std::io::ErrorKind::NotFound;
                continue;
            }
        };
        match kind(&meta, &relative, root) {
            Kind::Folder(stamp) => listing.folders.push(Rc::new(Folder {
                relative,
                path,
                stamp,
                parent: Some(Rc::clone(folder)),
                excluded: Cell::new(false),
            })),
            Kind::File(ImageFormat::Fits | ImageFormat::Xisf) => {
                listing.frames.push(NativePath::from_path(&relative));
            }
            Kind::Link | Kind::ForeignVolume | Kind::File(ImageFormat::Unsupported) => {}
        }
    }
    // A listing read through a folder swapped mid-read names entries outside
    // the root.
    Ok(changed_folder(folder).is_none().then_some(listing))
}

/// `read` applied to `relative`, a folder below `root` (whose stamp is
/// `stamp`; empty for the root itself), while the root still carries
/// `stamp` and every folder from the root down to it is a real folder on
/// the root's volume, checked without following links before the read and
/// after it. A folder, or one above it, swapped for a link or junction
/// before the read is not read, and a read taken through one swapped while
/// it ran is discarded. `None` when a check failed.
fn read_real_folder<T>(
    root: &Path,
    stamp: RootStamp,
    relative: &Path,
    read: impl FnOnce(&Path) -> T,
) -> Option<T> {
    let in_tree = || {
        root_stamp(root) == Some(stamp)
            && (relative.as_os_str().is_empty() || entry_at(root, stamp, relative) == Entry::Folder)
    };
    if !in_tree() {
        return None;
    }
    let outcome = read(&root.join(relative));
    in_tree().then_some(outcome)
}

/// Whether `relative`, a folder below `root` (whose stamp is `stamp`), opens
/// for listing, by [`read_real_folder`]'s checks: what a link swapped in
/// reaches does not count.
pub(crate) fn opens(root: &Path, stamp: RootStamp, relative: &Path) -> bool {
    read_real_folder(root, stamp, relative, |folder| fs::read_dir(folder).is_ok()) == Some(true)
}

/// Whether `relative`, a folder below `root` (whose stamp is `stamp`), can
/// now be listed in full: it opens, and every entry is read and `stat`ed (or
/// was removed meanwhile). [`read_real_folder`] checks it, so a listing read
/// through a folder swapped for a link is discarded.
pub(crate) fn lists_fully(root: &Path, stamp: RootStamp, relative: &Path) -> bool {
    let listed = read_real_folder(root, stamp, relative, |folder| {
        fs::read_dir(folder).is_ok_and(|entries| {
            entries.into_iter().all(|entry| {
                entry.is_ok_and(|entry| match fs::symlink_metadata(entry.path()) {
                    Ok(_) => true,
                    Err(error) => error.kind() == std::io::ErrorKind::NotFound,
                })
            })
        })
    });
    listed == Some(true)
}

/// `SourceUnavailable` unless `root` still carries `stamp`.
fn still_root(root: &Path, stamp: RootStamp) -> Result<(), LibraryError> {
    if root_stamp(root) == Some(stamp) {
        return Ok(());
    }
    Err(identity::scoped(
        LibraryError::SourceUnavailable("the location root is no longer the watched folder".into()),
        root,
    ))
}

/// Walk a registered location and report its observations progressively.
///
/// `progress` receives each batch of files and issues with cumulative
/// counters; sessions can be persisted and browsed before the walk ends.
///
/// # Errors
/// Root, identity and scope failures before the walk, an unlistable scan
/// scope, and any error returned by `progress` (which stops the scan). Once
/// walking, cancellation returns `Canceled` and a lost root returns `Failed`
/// observations instead.
pub fn scan(
    location: &Location,
    options: &ScanOptions,
    mut progress: impl FnMut(ScanBatch) -> Result<(), LibraryError>,
    canceled: &AtomicBool,
) -> Result<ScanObservation, LibraryError> {
    let root = location.path.to_path_buf().map_err(|error| locate(error, location))?;
    let scope =
        scope_path(options.relative_scope.as_ref()).map_err(|error| locate(error, location))?;
    let anchor = identity::observe(&root, &OsVolumes)
        .and_then(|observed| identity::compare(location, &observed, &root).map(|()| observed))
        .map_err(|error| locate(error, location))?;
    let scope_folder =
        enter_scope(&root, &scope, &anchor.stamp).map_err(|error| locate(error, location))?;

    let mut walk = Walk {
        location,
        root: &root,
        root_stamp: anchor.stamp,
        volume: &anchor.identity.volume,
        batch_size: options.batch_size.max(1),
        canceled,
        progress: &mut progress,
        pending: ScanBatch::default(),
        totals: ScanProgress::default(),
        files: Vec::new(),
        issues: Vec::new(),
        incomplete: Vec::new(),
    };
    let halt = walk.run(&scope_folder).err();
    let Walk { totals, files, mut issues, mut incomplete, .. } = walk;
    let scope = NativePath::from_path(&scope);

    let state = match halt {
        None => {
            let state =
                if incomplete.is_empty() { ScanState::Completed } else { ScanState::Partial };
            return Ok(ScanObservation {
                location_id: location.id,
                root_identity: anchor.identity,
                files,
                issues,
                complete_scopes: vec![scope],
                incomplete_scopes: incomplete,
                progress: totals,
                state,
            });
        }
        Some(Halt::Callback(error) | Halt::Failed(error)) => return Err(error),
        Some(Halt::Canceled) => ScanState::Canceled,
        Some(Halt::RootLost(issue)) => {
            issues.push(issue);
            ScanState::Failed
        }
    };
    incomplete.push(scope);
    Ok(ScanObservation {
        location_id: location.id,
        root_identity: anchor.identity,
        files,
        issues,
        complete_scopes: Vec::new(),
        incomplete_scopes: incomplete,
        progress: totals,
        state,
    })
}

/// Attach the location identity (and root scope when none) to an error.
fn locate(error: LibraryError, location: &Location) -> LibraryError {
    match error {
        LibraryError::Context { error, scope, identity: None } => {
            LibraryError::Context { error, scope, identity: Some(location.id) }
        }
        error @ LibraryError::Context { .. } => error,
        error => LibraryError::Context {
            error: Box::new(error),
            scope: Some(location.path.clone()),
            identity: Some(location.id),
        },
    }
}

/// Normalized relative scan scope; `.` components are dropped.
fn scope_path(scope: Option<&NativePath>) -> Result<PathBuf, LibraryError> {
    let Some(scope) = scope else {
        return Ok(PathBuf::new());
    };
    Ok(scope
        .relative_path()?
        .components()
        .filter(|part| matches!(part, Component::Normal(_)))
        .collect())
}

/// Descend to the scan scope without following links or leaving the volume.
fn enter_scope(root: &Path, scope: &Path, root_stamp: &Stamp) -> Result<Rc<Folder>, LibraryError> {
    let mut folder = Rc::new(Folder {
        relative: PathBuf::new(),
        path: root.to_path_buf(),
        stamp: *root_stamp,
        parent: None,
        excluded: Cell::new(false),
    });
    for part in scope.components() {
        let path = folder.path.join(part);
        let meta =
            fs::symlink_metadata(&path).map_err(|error| LibraryError::from_io(&path, &error))?;
        let refusal = if fs_pathsafe::is_link_or_junction_metadata(&meta) {
            Some(LibraryError::InvalidInput("scan scope passes through a link or junction".into()))
        } else if !meta.is_dir() {
            Some(LibraryError::InvalidInput("scan scope is not a directory".into()))
        } else if !identity::stamp(&meta).same_device(root_stamp) {
            Some(LibraryError::IdentityConflict("scan scope is on a different volume".into()))
        } else {
            None
        };
        if let Some(error) = refusal {
            return Err(identity::scoped(error, &path));
        }
        folder = Rc::new(Folder {
            relative: folder.relative.join(part),
            path,
            stamp: identity::stamp(&meta),
            parent: Some(folder),
            excluded: Cell::new(false),
        });
    }
    Ok(folder)
}

/// A folder the walk entered or listed, with the stamp it had then.
///
/// Entries are reached by path, which resolves every folder above them again.
/// An entry counts only while each folder from the root down still holds its
/// recorded stamp, so a folder swapped for a link or junction after it was
/// listed never redirects its listed entries outside the root.
struct Folder {
    relative: PathBuf,
    path: PathBuf,
    stamp: Stamp,
    parent: Option<Rc<Self>>,
    /// Already recorded as an incomplete scope; its subtree is uncertain.
    excluded: Cell<bool>,
}

/// The topmost folder from the root down to `folder` that is no longer the
/// real directory the walk recorded, if any.
fn changed_folder(folder: &Folder) -> Option<&Folder> {
    folder
        .parent
        .as_deref()
        .and_then(changed_folder)
        .or_else(|| (!still_folder(&folder.path, &folder.stamp)).then_some(folder))
}

/// Whether the entry at `path` is still the real folder recorded with
/// `stamp`: not a link or junction, a folder, and the same stamp. One
/// no-follow `stat`.
fn still_folder(path: &Path, stamp: &Stamp) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| {
        !fs_pathsafe::is_link_or_junction_metadata(&meta)
            && meta.is_dir()
            && identity::stamp(&meta) == *stamp
    })
}

enum Halt {
    Canceled,
    RootLost(ScanIssue),
    Callback(LibraryError),
    Failed(LibraryError),
}

struct Walk<'a, F> {
    location: &'a Location,
    root: &'a Path,
    root_stamp: Stamp,
    volume: &'a VolumeIdentity,
    batch_size: usize,
    canceled: &'a AtomicBool,
    progress: &'a mut F,
    pending: ScanBatch,
    totals: ScanProgress,
    files: Vec<ScanFile>,
    issues: Vec<ScanIssue>,
    incomplete: Vec<NativePath>,
}

impl<F: FnMut(ScanBatch) -> Result<(), LibraryError>> Walk<'_, F> {
    fn run(&mut self, scope: &Rc<Folder>) -> Result<(), Halt> {
        let mut stack = vec![Rc::clone(scope)];
        while let Some(directory) = stack.pop() {
            self.check_canceled()?;
            let is_scope = Rc::ptr_eq(&directory, scope);
            let Some(names) = self.list(&directory, is_scope)? else {
                continue;
            };
            let mut children = Vec::new();
            for name in names {
                self.check_canceled()?;
                self.visit(&directory, &name, &mut children)?;
            }
            stack.extend(children.into_iter().rev());
        }
        // Full remount-stable revalidation plus same-session continuity guard
        // the final batch and the completeness claim.
        if let Err(error) = identity::observe(self.root, &OsVolumes)
            .and_then(|observed| identity::compare(self.location, &observed, self.root))
        {
            return Err(Halt::RootLost(root_issue(&error)));
        }
        if self.pending.files.is_empty() && self.pending.issues.is_empty() {
            return self.check_root();
        }
        self.flush()
    }

    fn check_canceled(&self) -> Result<(), Halt> {
        if self.canceled.load(Ordering::Acquire) {
            return Err(Halt::Canceled);
        }
        Ok(())
    }

    /// Sorted entry names of a directory, or `None` when it was excluded.
    ///
    /// A failure at the scan scope itself ends the scan with an error; below
    /// it, the directory becomes an issue and an incomplete scope.
    fn list(&mut self, folder: &Folder, is_scope: bool) -> Result<Option<Vec<OsString>>, Halt> {
        let mut names = Vec::new();
        let failure = if let Some(changed) = changed_folder(folder) {
            Some((changed, ListingFailure::changed()))
        } else {
            match fs::read_dir(&folder.path) {
                Ok(entries) => {
                    let mut interrupted = None;
                    for entry in entries {
                        match entry {
                            Ok(entry) => names.push(entry.file_name()),
                            Err(error) => {
                                interrupted = Some(error);
                                break;
                            }
                        }
                    }
                    // A listing taken from a directory swapped mid-read, or
                    // through a swapped folder above it, is not evidence of
                    // its contents.
                    match changed_folder(folder) {
                        Some(changed) => Some((changed, ListingFailure::changed())),
                        None => interrupted.map(|error| {
                            (folder, ListingFailure::io("listing interrupted", &error, true))
                        }),
                    }
                }
                Err(error) => Some((folder, ListingFailure::io("unreadable", &error, false))),
            }
        };
        let Some((at, failure)) = failure else {
            self.totals.complete_directories += 1;
            names.sort();
            return Ok(Some(names));
        };
        if is_scope {
            return Err(Halt::Failed(locate(
                identity::scoped(failure.error, &at.path),
                self.location,
            )));
        }
        self.totals.unreadable += 1;
        self.exclude_folder(at, failure.reason, failure.availability);
        // Entries read before an interruption are still observations; their
        // subtree is already excluded from absence reconciliation.
        if failure.keep_names {
            names.sort();
            return Ok(Some(names));
        }
        Ok(None)
    }

    fn visit(
        &mut self,
        parent: &Rc<Folder>,
        name: &OsStr,
        children: &mut Vec<Rc<Folder>>,
    ) -> Result<(), Halt> {
        let relative = parent.relative.join(name);
        let path = parent.path.join(name);
        match fs::symlink_metadata(&path) {
            Err(error) => {
                self.totals.unreadable += 1;
                self.exclude(
                    &relative,
                    format!("entry unreadable: {error}"),
                    io_availability(&error),
                );
            }
            Ok(meta) => match kind(&meta, &relative, &self.root_stamp) {
                Kind::Link => self.exclude(
                    &relative,
                    "link or junction not followed".into(),
                    Availability::Unreadable,
                ),
                Kind::Folder(stamp) => children.push(Rc::new(Folder {
                    relative,
                    path,
                    stamp,
                    parent: Some(Rc::clone(parent)),
                    excluded: Cell::new(false),
                })),
                Kind::ForeignVolume => self.exclude(
                    &relative,
                    "a different volume is mounted here; not traversed".into(),
                    Availability::IdentityConflict,
                ),
                Kind::File(format) => {
                    self.totals.discovered += 1;
                    match format {
                        ImageFormat::Fits => {
                            self.read(parent, &relative, &path, &meta, format, &FitsExtractor);
                        }
                        ImageFormat::Xisf => {
                            self.read(parent, &relative, &path, &meta, format, &XisfExtractor);
                        }
                        ImageFormat::Unsupported => self.totals.unsupported += 1,
                    }
                }
            },
        }
        if self.pending.files.len() + self.pending.issues.len() >= self.batch_size {
            self.flush()?;
        }
        Ok(())
    }

    fn read(
        &mut self,
        parent: &Folder,
        relative: &Path,
        path: &Path,
        before: &Metadata,
        format: ImageFormat,
        extractor: &dyn MetadataExtractor,
    ) {
        // The adapters open by path: never open one through a folder that is
        // no longer the one its name was listed from.
        if self.above_changed(parent) {
            return;
        }
        // Every header the adapters cannot turn into metadata is one per-file
        // issue with Unreadable availability: the catalog records it, keeps the
        // file out of absence reconciliation and commits its readable siblings.
        let raw = match extractor.extract(path) {
            Ok(Some(raw)) => raw,
            Ok(None) => {
                self.totals.unreadable += 1;
                self.exclude(
                    relative,
                    "metadata unreadable: the adapter declined the file".into(),
                    Availability::Unreadable,
                );
                return;
            }
            Err(MetadataExtractError::Io { msg, .. }) => {
                self.totals.unreadable += 1;
                self.exclude(
                    relative,
                    format!("header unreadable: {msg}"),
                    Availability::Unreadable,
                );
                return;
            }
            Err(MetadataExtractError::Parse { msg, .. }) => {
                self.totals.unreadable += 1;
                self.exclude(
                    relative,
                    format!("metadata unreadable: {msg}"),
                    Availability::Unreadable,
                );
                return;
            }
        };
        // The adapters open by path; the header only counts if the entry is
        // still the regular file observed before the read.
        let after = fs::symlink_metadata(path);
        let unchanged = after.as_ref().is_ok_and(|after| {
            !fs_pathsafe::is_link_or_junction_metadata(after)
                && after.is_file()
                && identity::stamp(after) == identity::stamp(before)
                && after.len() == before.len()
                && after.modified().ok() == before.modified().ok()
        });
        let modified_ns = before.modified().ok().and_then(nanos_since_epoch);
        let Some(modified_ns) = modified_ns.filter(|_| unchanged) else {
            self.totals.unreadable += 1;
            let reason = if unchanged {
                "modification time unavailable"
            } else {
                "file changed while its header was read"
            };
            self.exclude(relative, reason.into(), Availability::Unreadable);
            return;
        };
        let file_id = match identity::file_id(path, before, self.volume) {
            Ok(file_id) => file_id,
            Err(error) => {
                self.totals.unreadable += 1;
                self.exclude(
                    relative,
                    format!("file ID unreadable: {error}"),
                    Availability::Unreadable,
                );
                return;
            }
        };
        // The header and file ID were read by path: they describe an entry
        // below the root only if every folder above it is still unchanged.
        if self.above_changed(parent) {
            return;
        }
        self.totals.metadata_read += 1;
        self.pending.files.push(ScanFile {
            relative_path: NativePath::from_path(relative),
            fingerprint: fingerprint(file_id, before, self.volume, modified_ns),
            format,
            metadata: CaptureMetadata::from(&raw),
        });
    }

    /// Record an issue and exclude its subtree from absence reconciliation.
    fn exclude(&mut self, relative: &Path, reason: String, availability: Availability) {
        let relative_path = NativePath::from_path(relative);
        self.incomplete.push(relative_path.clone());
        self.pending.issues.push(ScanIssue { relative_path, reason, availability });
    }

    /// Exclude a folder once; later failures below it are already uncertain.
    fn exclude_folder(&mut self, folder: &Folder, reason: String, availability: Availability) {
        if !folder.excluded.replace(true) {
            self.exclude(&folder.relative, reason, availability);
        }
    }

    /// Refuse an entry when a folder from the root down to `parent` changed
    /// since the walk recorded it: the entry counts as unreadable and the
    /// topmost changed folder becomes an incomplete scope.
    fn above_changed(&mut self, parent: &Folder) -> bool {
        let Some(changed) = changed_folder(parent) else {
            return false;
        };
        self.totals.unreadable += 1;
        let failure = ListingFailure::changed();
        self.exclude_folder(changed, failure.reason, failure.availability);
        true
    }

    /// Deliver the pending batch once cancellation and root continuity pass.
    fn flush(&mut self) -> Result<(), Halt> {
        self.check_canceled()?;
        self.check_root()?;
        let batch = ScanBatch {
            files: std::mem::take(&mut self.pending.files),
            issues: std::mem::take(&mut self.pending.issues),
            progress: self.totals.clone(),
        };
        self.files.extend(batch.files.iter().cloned());
        self.issues.extend(batch.issues.iter().cloned());
        (self.progress)(batch).map_err(Halt::Callback)
    }

    /// Same-session continuity of the root validated at the start.
    fn check_root(&self) -> Result<(), Halt> {
        let root = NativePath::from_path(Path::new(""));
        match fs::symlink_metadata(self.root) {
            Err(error) => Err(Halt::RootLost(ScanIssue {
                relative_path: root,
                reason: format!("location root became unavailable during the scan: {error}"),
                availability: Availability::Offline,
            })),
            Ok(meta)
                if fs_pathsafe::is_link_or_junction_metadata(&meta)
                    || !meta.is_dir()
                    || identity::stamp(&meta) != self.root_stamp =>
            {
                // An unmounted share leaves its mount point folder behind on a
                // local volume: the share is offline, not replaced (LIB-FR-19).
                let unmounted = meta.is_dir()
                    && !fs_pathsafe::is_link_or_junction_metadata(&meta)
                    && self.location.volume_kind == VolumeKind::Network
                    && identity::observe(self.root, &OsVolumes).is_ok_and(|observed| {
                        identity::share_unmounted(self.location.volume_kind, observed.kind)
                    });
                Err(Halt::RootLost(if unmounted {
                    ScanIssue {
                        relative_path: root,
                        reason: format!("{} during the scan", identity::SHARE_UNMOUNTED),
                        availability: Availability::Offline,
                    }
                } else {
                    ScanIssue {
                        relative_path: root,
                        reason: "location root was replaced during the scan".into(),
                        availability: Availability::IdentityConflict,
                    }
                }))
            }
            Ok(_) => Ok(()),
        }
    }
}

fn root_issue(error: &LibraryError) -> ScanIssue {
    let inner = match error {
        LibraryError::Context { error, .. } => error.as_ref(),
        error => error,
    };
    let availability = match inner {
        LibraryError::SourceUnavailable(_) | LibraryError::NotFound(_) => Availability::Offline,
        LibraryError::AccessDenied(_) => Availability::Unreadable,
        _ => Availability::IdentityConflict,
    };
    ScanIssue {
        relative_path: NativePath::from_path(Path::new("")),
        reason: format!("location root failed final revalidation: {inner}"),
        availability,
    }
}

fn io_availability(error: &std::io::Error) -> Availability {
    match error.kind() {
        std::io::ErrorKind::NotFound => Availability::Offline,
        _ => Availability::Unreadable,
    }
}

/// Why a directory below the scan scope could not serve as listing evidence.
struct ListingFailure {
    reason: String,
    availability: Availability,
    error: LibraryError,
    keep_names: bool,
}

impl ListingFailure {
    fn changed() -> Self {
        let reason = "directory changed during the scan";
        Self {
            reason: reason.into(),
            availability: Availability::Unreadable,
            error: LibraryError::SourceUnavailable(reason.into()),
            keep_names: false,
        }
    }

    fn io(what: &str, error: &std::io::Error, keep_names: bool) -> Self {
        let message = error.to_string();
        Self {
            reason: format!("directory {what}: {message}"),
            availability: io_availability(error),
            error: match error.kind() {
                std::io::ErrorKind::PermissionDenied => LibraryError::AccessDenied(message),
                std::io::ErrorKind::NotFound => LibraryError::NotFound(message),
                _ => LibraryError::SourceUnavailable(message),
            },
            keep_names,
        }
    }
}

/// Ordinary observations carry no content digest; the catalog hashes lazily
/// for explicitly reviewed decisions and custody work.
fn fingerprint(
    file_id: Option<String>,
    meta: &Metadata,
    volume: &VolumeIdentity,
    modified_ns: i128,
) -> ObservationFingerprint {
    ObservationFingerprint {
        identity: FileIdentity { volume: volume.clone(), file_id },
        size_bytes: meta.len(),
        modified_ns,
        content_sha256: None,
    }
}

/// Supported header format, decided by the adapters' own extension rules.
fn format_of(path: &Path) -> ImageFormat {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return ImageFormat::Unsupported;
    };
    let extension = extension.to_ascii_lowercase();
    if FitsExtractor.supports_extension(&extension) {
        ImageFormat::Fits
    } else if XisfExtractor.supports_extension(&extension) {
        ImageFormat::Xisf
    } else {
        ImageFormat::Unsupported
    }
}

/// Signed nanoseconds since the Unix epoch, losslessly.
fn nanos_since_epoch(time: SystemTime) -> Option<i128> {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => i128::try_from(after.as_nanos()).ok(),
        Err(before) => i128::try_from(before.duration().as_nanos()).ok().map(|nanos| -nanos),
    }
}

/// [`list_folder`] refuses a folder swapped for a link once it was queued, so
/// a walk never lists outside the root through one.
#[cfg(all(test, unix))]
mod swapped_folders {
    use std::os::unix::fs::symlink;

    use super::*;

    /// `relative` below `root`, as a walk queues it: each folder from the
    /// root down with the stamp it has now.
    fn queued(root: &Path, relative: &str) -> Rc<Folder> {
        let stamp = |path: &Path| identity::stamp(&fs::symlink_metadata(path).unwrap());
        let mut folder = Rc::new(Folder {
            relative: PathBuf::new(),
            path: root.to_path_buf(),
            stamp: stamp(root),
            parent: None,
            excluded: Cell::new(false),
        });
        for part in Path::new(relative).components() {
            let path = folder.path.join(part);
            folder = Rc::new(Folder {
                relative: folder.relative.join(part),
                stamp: stamp(&path),
                path,
                parent: Some(folder),
                excluded: Cell::new(false),
            });
        }
        folder
    }

    fn frames(folder: &Rc<Folder>, root: &Path) -> Option<usize> {
        let root = identity::stamp(&fs::symlink_metadata(root).unwrap());
        list_folder(folder, &root).unwrap().map(|listing| listing.frames.len())
    }

    #[test]
    fn a_folder_swapped_for_a_link_once_queued_is_not_listed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Captures");
        fs::create_dir_all(root.join("night")).unwrap();
        fs::write(root.join("night/Ha_001.fits"), b"").unwrap();
        let outside = dir.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("Ha_901.fits"), b"").unwrap();
        fs::write(outside.join("Ha_902.fits"), b"").unwrap();
        let night = queued(&root, "night");
        assert_eq!(frames(&night, &root), Some(1));

        fs::rename(root.join("night"), dir.path().join("moved")).unwrap();
        symlink(&outside, root.join("night")).unwrap();
        assert_eq!(frames(&night, &root), None, "nothing outside the root is listed");
    }

    /// The link points at the moved original, so the queued folder itself
    /// still reads the same through it: only the folder above it changed.
    #[test]
    fn a_folder_reached_through_a_swapped_parent_is_not_listed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Captures");
        fs::create_dir_all(root.join("night/Ha")).unwrap();
        fs::write(root.join("night/Ha/Ha_001.fits"), b"").unwrap();
        let filter = queued(&root, "night/Ha");
        assert_eq!(frames(&filter, &root), Some(1));

        let moved = dir.path().join("moved");
        fs::rename(root.join("night"), &moved).unwrap();
        symlink(&moved, root.join("night")).unwrap();
        assert_eq!(frames(&filter, &root), None, "listed through a link above it");
    }

    /// A folder a walk could not list in full is probed again at a sweep,
    /// and a folder the watcher refused is checked for whether it opens;
    /// once it, or a folder above it, is swapped for a link, neither reads
    /// through the link.
    #[test]
    fn a_folder_swapped_for_a_link_is_never_probed_through_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Captures");
        fs::create_dir_all(root.join("night/Ha")).unwrap();
        let stamp = root_stamp(&root).unwrap();
        assert!(lists_fully(&root, stamp, Path::new("night/Ha")));
        assert!(opens(&root, stamp, Path::new("night/Ha")));

        let moved = dir.path().join("moved");
        fs::rename(root.join("night"), &moved).unwrap();
        symlink(&moved, root.join("night")).unwrap();
        for folder in ["night/Ha", "night"] {
            let folder = Path::new(folder);
            assert!(!lists_fully(&root, stamp, folder), "{folder:?} listed through a link");
            assert!(!opens(&root, stamp, folder), "{folder:?} opened through a link");
        }
    }

    /// The root itself swapped for a link to its moved original: nothing
    /// below it is probed through the link, the root included.
    #[test]
    fn nothing_is_probed_through_a_root_swapped_for_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Captures");
        fs::create_dir_all(root.join("night")).unwrap();
        let stamp = root_stamp(&root).unwrap();
        assert!(opens(&root, stamp, Path::new("")), "the root itself opens");

        let moved = dir.path().join("moved");
        fs::rename(&root, &moved).unwrap();
        symlink(&moved, &root).unwrap();
        for folder in ["night", ""] {
            let folder = Path::new(folder);
            assert!(!lists_fully(&root, stamp, folder), "{folder:?} listed through the root link");
            assert!(!opens(&root, stamp, folder), "{folder:?} opened through the root link");
        }
    }

    /// A folder above an entry is swapped for a link once the lookup checked
    /// it, before the entry is read: what was read through the link is not
    /// the tree's.
    #[test]
    fn an_ancestor_swapped_during_a_lookup_leaves_the_entry_unobserved() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Captures");
        fs::create_dir_all(root.join("night")).unwrap();
        let outside = dir.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("Ha_901.fits"), b"").unwrap();
        let stamp = root_stamp(&root).unwrap();
        let frame = Path::new("night/Ha_901.fits");

        let mut swapped = false;
        let entry = entry_at_with(&root, stamp, frame, |path| {
            if path == root.join(frame) && !swapped {
                swapped = true;
                fs::rename(root.join("night"), dir.path().join("moved"))?;
                symlink(&outside, root.join("night"))?;
            }
            fs::symlink_metadata(path)
        });
        assert!(swapped);
        assert_eq!(entry, Entry::Unobserved, "read through the swapped folder");
        assert_eq!(entry_at(&root, stamp, frame), Entry::Other, "below a link");
    }
}

/// [`entry_at`] tells a path that is not there from one whose metadata, or
/// that of a folder above it, could not be read.
#[cfg(test)]
mod entry_lookups {
    use super::*;

    /// `fs::symlink_metadata`, failing for `failed` as a share's brief I/O
    /// error does.
    fn failing_at(failed: &Path) -> impl FnMut(&Path) -> std::io::Result<Metadata> + '_ {
        move |path| {
            if path == failed {
                Err(std::io::Error::other("the share did not answer"))
            } else {
                fs::symlink_metadata(path)
            }
        }
    }

    #[test]
    fn an_unreadable_entry_is_unobserved_not_absent() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Captures");
        fs::create_dir_all(root.join("night")).unwrap();
        fs::write(root.join("night/Ha_001.fits"), b"").unwrap();
        let stamp = root_stamp(&root).unwrap();
        let frame = Path::new("night/Ha_001.fits");
        assert_eq!(entry_at(&root, stamp, frame), Entry::Frame);

        let above = root.join("night");
        let unread = entry_at_with(&root, stamp, frame, failing_at(&above));
        assert_eq!(unread, Entry::Unobserved, "a folder above it could not be read");
        let itself = root.join(frame);
        let unread = entry_at_with(&root, stamp, frame, failing_at(&itself));
        assert_eq!(unread, Entry::Unobserved, "it could not be read");
        assert_eq!(entry_at(&root, stamp, Path::new("night/Ha_002.fits")), Entry::Other);
        assert_eq!(entry_at(&root, stamp, Path::new("gone/Ha_001.fits")), Entry::Other);
    }
}

/// A root's continuity stamp tells apart two folders whose [`Stamp`] matches,
/// as on Windows a folder created at the same time as the root it replaced
/// does, by their folder IDs.
#[cfg(test)]
mod root_stamps {
    use super::*;

    #[test]
    fn folders_with_one_stamp_but_two_folder_ids_have_two_root_stamps() {
        let dir = tempfile::tempdir().unwrap();
        let stamp = identity::stamp(&fs::symlink_metadata(dir.path()).unwrap());
        let folder =
            |index| RootStamp { stamp, folder: Some(identity::FolderId { volume: 7, index }) };

        assert_eq!(folder(1), folder(1));
        assert_ne!(folder(1), folder(2), "a replacement with the same stamp passed as the root");
    }

    /// The root is renamed away and a new folder, given the old one's
    /// creation time, takes its name: only the folder ID differs.
    #[cfg(windows)]
    #[test]
    fn a_root_replaced_by_a_folder_created_at_the_same_time_has_another_stamp() {
        use std::os::windows::fs::{FileTimesExt, OpenOptionsExt};
        /// `FILE_WRITE_ATTRIBUTES`, which setting a time needs.
        const WRITE_ATTRIBUTES: u32 = 0x0100;
        /// `FILE_FLAG_BACKUP_SEMANTICS`, which opening a folder needs.
        const BACKUP_SEMANTICS: u32 = 0x0200_0000;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Captures");
        fs::create_dir(&root).unwrap();
        let watched = root_stamp(&root).unwrap();
        let created = fs::symlink_metadata(&root).unwrap().created().unwrap();

        fs::rename(&root, dir.path().join("moved")).unwrap();
        fs::create_dir(&root).unwrap();
        let replacement = fs::OpenOptions::new()
            .access_mode(WRITE_ATTRIBUTES)
            .custom_flags(BACKUP_SEMANTICS)
            .open(&root)
            .unwrap();
        replacement.set_times(fs::FileTimes::new().set_created(created)).unwrap();
        drop(replacement);

        let now = fs::symlink_metadata(&root).unwrap();
        assert_eq!(now.created().unwrap(), created, "the replacement has the root's creation time");
        assert_eq!(identity::stamp(&now), watched.stamp, "its stamp alone matches the root's");
        assert_ne!(root_stamp(&root), Some(watched), "the replacement passed as the root");
    }
}
