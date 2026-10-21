// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Storage custody primitives (spec 071): reviewed entry evidence and its
//! re-verification immediately before each move (D19), the OS Trash adapter,
//! verified transfer and the resumable operation journal.
//!
//! Review records an entry by its own no-follow identity: a file with its
//! SHA-256, a link with its target text, never its target. Execution re-reads
//! that evidence through a handle proven to be the reviewed entry, so a file
//! changed in place with its size and modification time preserved still fails
//! the comparison. Nothing here permanently deletes a reviewed entry: an entry
//! leaves its path only through the OS Trash, and when the OS Trash cannot keep
//! it the entry stays where it is.

pub mod journal;
pub(crate) mod rooted;
pub mod transfer;
pub mod trash;

use std::fs::{self, File, Metadata};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};

#[cfg(unix)]
use crate::file_ids_match;
use crate::inventory;
use crate::library::Library;
use crate::{
    EntryEvidence, EntryKind, FileIdentity, ItemReason, KeptCopy, LibraryError, NativePath,
    ObservationFingerprint, ReasonCode, VolumeIdentity,
};

const HASH_BUFFER: usize = 1 << 20;

impl Library {
    /// Review one entry for a storage operation. A file is recorded with its
    /// no-follow fingerprint and SHA-256; a link with its own identity and
    /// target text, without following, opening or hashing the target.
    ///
    /// # Errors
    /// `InvalidInput` for a relative path or an entry that is neither a regular
    /// file nor a link; access, identity and source errors from the probe.
    pub async fn review_storage_entry(
        &self,
        path: NativePath,
    ) -> Result<EntryEvidence, LibraryError> {
        let path = path.to_path_buf()?;
        blocking(move || observe_entry(&path)).await?
    }

    /// Review the retained original or kept copy an item relies on.
    ///
    /// # Errors
    /// As [`Self::review_storage_entry`], plus `InvalidInput` for a link: a
    /// link holds no bytes of its own to keep.
    pub async fn review_kept_copy(&self, path: NativePath) -> Result<KeptCopy, LibraryError> {
        let evidence = self.review_storage_entry(path).await?;
        match (evidence.kind, evidence.sha256) {
            (EntryKind::File, Some(sha256)) => Ok(KeptCopy {
                path: evidence.path,
                root: None,
                fingerprint: evidence.fingerprint,
                sha256,
            }),
            _ => Err(LibraryError::InvalidInput(
                "a kept copy is a regular file; a link holds no bytes of its own".into(),
            )),
        }
    }
}

/// Run blocking filesystem work off the async runtime.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, LibraryError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| LibraryError::PersistenceFailure(format!("custody task failed: {error}")))
}

fn scoped(error: LibraryError, path: &Path) -> LibraryError {
    if matches!(error, LibraryError::Context { .. }) {
        return error;
    }
    LibraryError::Context {
        error: Box::new(error),
        scope: Some(NativePath::from_path(path)),
        identity: None,
    }
}

fn lstat(path: &Path) -> Result<Metadata, LibraryError> {
    fs::symlink_metadata(path).map_err(|error| LibraryError::from_io(path, &error))
}

fn is_link(metadata: &Metadata) -> bool {
    fs_pathsafe::is_link_or_junction_metadata(metadata)
}

/// Signed nanoseconds since the Unix epoch, losslessly.
fn modified_nanos(metadata: &Metadata) -> Option<i128> {
    match metadata.modified().ok()?.duration_since(UNIX_EPOCH) {
        Ok(after) => i128::try_from(after.as_nanos()).ok(),
        Err(before) => i128::try_from(before.duration().as_nanos()).ok().map(|nanos| -nanos),
    }
}

/// The no-follow evidence of one entry: a file with its SHA-256, a link with
/// its target text. PREP snapshots its written entries with it.
pub(crate) fn observe_entry(path: &Path) -> Result<EntryEvidence, LibraryError> {
    observe(path, None)
}

/// [`observe_entry`] for a catalog source below its registered `root`
/// (STO-FR-07): the entry is reached from the root one folder at a time,
/// never following a link, and its evidence keeps the root so that every
/// later check reaches it the same way.
pub(crate) fn observe_source(root: &Path, path: &Path) -> Result<EntryEvidence, LibraryError> {
    observe(path, Some(NativePath::from_path(root)))
}

fn observe(path: &Path, root: Option<NativePath>) -> Result<EntryEvidence, LibraryError> {
    if !path.is_absolute() {
        return Err(LibraryError::InvalidInput("custody paths must be absolute".into()));
    }
    let conflict =
        |check: Check| scoped(LibraryError::IdentityConflict(check.detail().to_owned()), path);
    let metadata = rooted_check(root.as_ref(), path, || Ok(lstat(path))).map_err(conflict)??;
    if is_link(&metadata) {
        let (fingerprint, target) =
            rooted_check(root.as_ref(), path, || Ok(link_fingerprint(path, &metadata)))
                .map_err(conflict)??;
        return Ok(EntryEvidence {
            path: NativePath::from_path(path),
            root,
            kind: EntryKind::Link { target },
            fingerprint,
            sha256: None,
        });
    }
    let fingerprint = inventory::probe_fingerprint(path)?;
    let expect = Expect { root: root.as_ref(), ..Expect::recorded(&fingerprint) };
    let sha256 = read_unchanged(path, &expect, |_| Ok(())).map_err(conflict)?;
    Ok(EntryEvidence {
        path: NativePath::from_path(path),
        root,
        kind: EntryKind::File,
        fingerprint,
        sha256: Some(sha256),
    })
}

/// The folders between `root` and `path`'s entry, entered without
/// following a link ([`rooted`]).
fn enter_below(root: &NativePath, path: &Path) -> Result<rooted::Below, Check> {
    let root = root
        .to_path_buf()
        .map_err(|error| Check::Unavailable(format!("{error}: {}", path.display())))?;
    rooted::Below::enter(&root, path)
}

/// Run `check`, which observes the entry at `path` by its path alone. With a
/// `root`, the folders above the entry are entered from it first and must
/// still be the ones `path` names once `check` is done, so what `check` saw
/// was the entry below its root.
fn rooted_check<T>(
    root: Option<&NativePath>,
    path: &Path,
    check: impl FnOnce() -> Result<T, Check>,
) -> Result<T, Check> {
    let below = root.map(|root| enter_below(root, path)).transpose()?;
    let checked = check()?;
    if below.is_some_and(|below| !below.holds_path()) {
        return Err(folder_changed(path));
    }
    Ok(checked)
}

fn folder_changed(path: &Path) -> Check {
    Check::Changed(format!(
        "a folder above {} changed while it was checked; links are not followed",
        path.display()
    ))
}

/// The link's own fingerprint and its target text. The target is never read.
fn link_fingerprint(
    path: &Path,
    metadata: &Metadata,
) -> Result<(ObservationFingerprint, NativePath), LibraryError> {
    let target = fs::read_link(path).map_err(|error| LibraryError::from_io(path, &error))?;
    let folder = path
        .parent()
        .ok_or_else(|| LibraryError::InvalidInput("a link entry lives in a folder".into()))?;
    let volume = inventory::observe_root_identity(folder)?.volume;
    let file_id = entry_file_id(path, metadata, &volume)?;
    let modified_ns = modified_nanos(metadata).ok_or_else(|| {
        scoped(LibraryError::SourceUnavailable("modification time unavailable".into()), path)
    })?;
    let fingerprint = ObservationFingerprint {
        identity: FileIdentity { volume, file_id },
        size_bytes: metadata.len(),
        modified_ns,
        content_sha256: None,
    };
    Ok((fingerprint, NativePath::from_path(&target)))
}

/// Remount-stable ID of the entry itself (never a link target), recorded only
/// where the volume qualifies its file IDs as stable: on Unix the inode
/// number and, on Linux, the entry's own kernel file handle, as every Unix
/// entry's ([`inventory::file_id`]).
#[cfg(unix)]
fn entry_file_id(
    path: &Path,
    metadata: &Metadata,
    volume: &VolumeIdentity,
) -> Result<Option<String>, LibraryError> {
    inventory::file_id(path, metadata, volume).map_err(|error| LibraryError::from_io(path, &error))
}

#[cfg(windows)]
fn entry_file_id(
    path: &Path,
    _metadata: &Metadata,
    volume: &VolumeIdentity,
) -> Result<Option<String>, LibraryError> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    let handle = fs::OpenOptions::new()
        .access_mode(0)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| LibraryError::from_io(path, &error))?;
    let info = winapi_util::file::information(&handle)
        .map_err(|error| LibraryError::from_io(path, &error))?;
    if volume.stable_id.as_deref() != Some(format!("{:08X}", info.volume_serial_number()).as_str())
    {
        return Err(scoped(
            LibraryError::IdentityConflict("entry is not on its folder's volume".into()),
            path,
        ));
    }
    Ok(volume.file_ids_stable.then(|| format!("{:016X}", info.file_index())))
}

#[cfg(not(any(unix, windows)))]
fn entry_file_id(
    path: &Path,
    _metadata: &Metadata,
    _volume: &VolumeIdentity,
) -> Result<Option<String>, LibraryError> {
    Err(scoped(LibraryError::IdentityConflict("no entry identity on this platform".into()), path))
}

/// Same volume, and the same file ID where the volume's IDs are stable
/// ([`FileIdentity::is_recorded`]).
pub(crate) fn same_identity(observed: &FileIdentity, recorded: &FileIdentity) -> bool {
    observed.is_recorded(recorded)
}

/// Why a re-read did not prove the recorded entry.
#[derive(Debug)]
enum Check {
    /// The entry is missing or cannot be read.
    Unavailable(String),
    /// Something other than the recorded entry, or different bytes, is there.
    Changed(String),
}

impl Check {
    fn detail(&self) -> &str {
        match self {
            Self::Unavailable(detail) | Self::Changed(detail) => detail,
        }
    }
}

fn unavailable(path: &Path, error: &std::io::Error) -> Check {
    Check::Unavailable(format!("{} cannot be read: {error}", path.display()))
}

/// What a re-read must find at a path.
struct Expect<'a> {
    identity: &'a FileIdentity,
    size_bytes: u64,
    /// `None` where the volume may not keep the recorded time exactly.
    modified_ns: Option<i128>,
    /// The registered root the entry is reached from without following a
    /// link; `None` for an entry read by its path alone.
    root: Option<&'a NativePath>,
}

impl<'a> Expect<'a> {
    const fn recorded(fingerprint: &'a ObservationFingerprint) -> Self {
        Self {
            identity: &fingerprint.identity,
            size_bytes: fingerprint.size_bytes,
            modified_ns: Some(fingerprint.modified_ns),
            root: None,
        }
    }

    /// What a reviewed source must still be, reached from its root.
    const fn source(source: &'a EntryEvidence) -> Self {
        Self { root: source.root.as_ref(), ..Self::recorded(&source.fingerprint) }
    }
}

/// A regular file opened for reading through a handle proven to be the
/// expected entry, with the no-follow observation it was proven against
/// and the folders entered from its root.
struct Opened {
    file: File,
    before: Metadata,
    below: Option<rooted::Below>,
}

/// Open the regular file at `path` as [`read_unchanged`] does, without
/// reading it. With a root, the handle is opened through the folders
/// entered from it.
fn open_unchanged(path: &Path, expect: &Expect<'_>) -> Result<Opened, Check> {
    let below = expect.root.map(|root| enter_below(root, path)).transpose()?;
    let before = fs::symlink_metadata(path).map_err(|error| unavailable(path, &error))?;
    if is_link(&before) || !before.is_file() {
        return Err(Check::Changed(format!("{} is no longer a regular file", path.display())));
    }
    let probed = inventory::probe_fingerprint(path)
        .map_err(|error| Check::Unavailable(format!("{}: {error}", path.display())))?;
    if !same_identity(&probed.identity, expect.identity) {
        return Err(Check::Changed(format!("{} is not the reviewed entry", path.display())));
    }
    if probed.size_bytes != expect.size_bytes
        || expect.modified_ns.is_some_and(|modified| probed.modified_ns != modified)
    {
        return Err(Check::Changed(format!(
            "{} changed size or modification time since its review",
            path.display()
        )));
    }
    let file = match &below {
        Some(below) => below.open_entry()?,
        None => File::open(path).map_err(|error| unavailable(path, &error))?,
    };
    if !handle_is(&file, &before, expect.identity) {
        return Err(Check::Changed(format!("{} was replaced while it was opened", path.display())));
    }
    Ok(Opened { file, before, below })
}

/// The reviewed source opened for reading, reached from its root without
/// following a link and proven to be the reviewed entry with its recorded
/// size and modification time. Its bytes are not read here: whatever reads
/// them through this handle reads the entry below the root, and proves
/// their digest itself (a clone, astro-plan-nlewt).
pub(crate) fn open_source(source: &EntryEvidence) -> Result<File, ItemReason> {
    let path = path_of(&source.path)?;
    open_unchanged(&path, &Expect::source(source)).map(|opened| opened.file).map_err(|check| {
        match check {
            Check::Unavailable(detail) => ItemReason::new(ReasonCode::SourceUnavailable, detail),
            Check::Changed(detail) => ItemReason::new(ReasonCode::SourceDrift, detail),
        }
    })
}

/// Stream a regular file's bytes through `sink` and return their SHA-256,
/// proving the open handle is the expected entry and that it did not change
/// while it was read. Links are never followed. With a root, the handle is
/// opened through the folders entered from it, so the bytes read are always
/// those of an entry below the root.
fn read_unchanged(
    path: &Path,
    expect: &Expect<'_>,
    mut sink: impl FnMut(&[u8]) -> std::io::Result<()>,
) -> Result<String, Check> {
    let Opened { mut file, before, below } = open_unchanged(path, expect)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER];
    loop {
        let read = file.read(&mut buffer).map_err(|error| unavailable(path, &error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        sink(&buffer[..read]).map_err(|error| {
            Check::Unavailable(format!("copy of {} failed: {error}", path.display()))
        })?;
    }
    let read_stats = file.metadata().map_err(|error| unavailable(path, &error))?;
    let after = fs::symlink_metadata(path).map_err(|error| unavailable(path, &error))?;
    if !same_stats(&before, &read_stats)
        || !same_entry(&before, &after)
        || !same_stats(&before, &after)
    {
        return Err(Check::Changed(format!("{} changed while it was read", path.display())));
    }
    if below.is_some_and(|below| !below.holds_path()) {
        return Err(folder_changed(path));
    }
    Ok(hex::encode(hasher.finalize()))
}

fn same_stats(left: &Metadata, right: &Metadata) -> bool {
    left.len() == right.len() && modified_nanos(left) == modified_nanos(right)
}

/// Whether two no-follow observations are the same directory entry.
#[cfg(unix)]
fn same_entry(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino() && is_link(right) == is_link(left)
}

#[cfg(not(unix))]
fn same_entry(left: &Metadata, right: &Metadata) -> bool {
    left.file_type() == right.file_type() && left.created().ok() == right.created().ok()
}

/// Whether an opened handle is the inspected entry rather than a replacement
/// and, where the volume's file IDs are stable, holds the recorded file ID:
/// the handle's inode number and, on Linux, the kernel file handle read
/// through it ([`FileIdentity::unix_file_id`]). A failed handle read proves
/// nothing, and an ID without a handle never matches one with
/// ([`file_ids_match`]).
#[cfg(unix)]
fn handle_is(file: &File, inspected: &Metadata, identity: &FileIdentity) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Ok(handle) = file.metadata() else {
        return false;
    };
    same_entry(inspected, &handle)
        && (!identity.volume.file_ids_stable
            || fs_file_handle_linux::of_file(file).is_ok_and(|kernel| {
                let opened = FileIdentity::unix_file_id(handle.ino(), kernel.as_deref());
                file_ids_match(identity.file_id.as_deref(), Some(&opened))
            }))
}

#[cfg(windows)]
fn handle_is(file: &File, inspected: &Metadata, identity: &FileIdentity) -> bool {
    let Ok(info) = winapi_util::file::information(file) else {
        return false;
    };
    let serial = format!("{:08X}", info.volume_serial_number());
    if identity.volume.stable_id.as_deref() != Some(serial.as_str()) {
        return false;
    }
    if identity.volume.file_ids_stable
        && identity.file_id.as_deref() != Some(format!("{:016X}", info.file_index()).as_str())
    {
        return false;
    }
    file.metadata().is_ok_and(|handle| same_stats(inspected, &handle))
}

#[cfg(not(any(unix, windows)))]
const fn handle_is(_file: &File, _inspected: &Metadata, _identity: &FileIdentity) -> bool {
    false
}

/// Whether the reviewed entry is still at its path with its recorded
/// identity, without reading its bytes; a source with a root is reached
/// from it without following a link.
pub(crate) fn in_place(source: &EntryEvidence) -> bool {
    let Ok(path) = source.path.to_path_buf() else {
        return false;
    };
    rooted_check(source.root.as_ref(), &path, || match &source.kind {
        EntryKind::File => inventory::probe_fingerprint(&path)
            .ok()
            .filter(|observed| observed.equivalent(&source.fingerprint))
            .map(|_| ())
            .ok_or_else(|| Check::Changed(format!("{} is not the reviewed entry", path.display()))),
        EntryKind::Link { target } => link_holds(&path, &source.fingerprint, target),
    })
    .is_ok()
}

fn link_holds(
    path: &Path,
    recorded: &ObservationFingerprint,
    target: &NativePath,
) -> Result<(), Check> {
    let metadata = fs::symlink_metadata(path).map_err(|error| unavailable(path, &error))?;
    if !is_link(&metadata) {
        return Err(Check::Changed(format!("{} is no longer a link", path.display())));
    }
    let (observed, observed_target) = link_fingerprint(path, &metadata)
        .map_err(|error| Check::Unavailable(format!("{}: {error}", path.display())))?;
    if observed_target != *target {
        return Err(Check::Changed(format!("{} points somewhere else now", path.display())));
    }
    if !observed.equivalent(recorded) {
        return Err(Check::Changed(format!("{} is not the reviewed link", path.display())));
    }
    Ok(())
}

/// D19: the source still holds its reviewed identity and, for a file, its
/// reviewed SHA-256. A link is checked without following it.
pub(crate) fn verify_source(source: &EntryEvidence) -> Result<(), ItemReason> {
    let path = path_of(&source.path)?;
    let checked = match &source.kind {
        EntryKind::Link { target } => rooted_check(source.root.as_ref(), &path, || {
            link_holds(&path, &source.fingerprint, target)
        }),
        EntryKind::File => {
            read_unchanged(&path, &Expect::source(source), |_| Ok(())).and_then(|digest| {
                if Some(digest.as_str()) == source.sha256.as_deref() {
                    Ok(())
                } else {
                    Err(Check::Changed(format!(
                        "{} no longer holds its reviewed bytes (SHA-256 differs)",
                        path.display()
                    )))
                }
            })
        }
    };
    checked.map_err(|check| match check {
        Check::Unavailable(detail) => ItemReason::new(ReasonCode::SourceUnavailable, detail),
        Check::Changed(detail) => ItemReason::new(ReasonCode::SourceDrift, detail),
    })
}

/// D19 for a retained original or kept copy: identity and SHA-256 re-read,
/// reached from its registered root without following a link where it has
/// one.
fn verify_kept(kept: &KeptCopy) -> Result<(), ItemReason> {
    let path = path_of(&kept.path)?;
    let expect = Expect { root: kept.root.as_ref(), ..Expect::recorded(&kept.fingerprint) };
    let digest = read_unchanged(&path, &expect, |_| Ok(()))
        .map_err(|check| ItemReason::new(ReasonCode::KeptCopyUnproven, check.detail()))?;
    if digest == kept.sha256 {
        Ok(())
    } else {
        Err(ItemReason::new(
            ReasonCode::KeptCopyUnproven,
            format!("{} no longer holds the bytes this item relies on", path.display()),
        ))
    }
}

fn path_of(path: &NativePath) -> Result<PathBuf, ItemReason> {
    path.to_path_buf()
        .map_err(|error| ItemReason::new(ReasonCode::SourceUnavailable, error.to_string()))
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::MetadataExt;

    use super::*;

    /// The recorded identity of the regular file at `path`, as review
    /// records it; `None`, with the reason printed, where the test folder's
    /// volume doesn't keep stable file IDs and there is no file ID to check.
    fn recorded(path: &Path) -> Option<FileIdentity> {
        let identity = inventory::probe_fingerprint(path).unwrap().identity;
        if !identity.volume.file_ids_stable {
            eprintln!("skipped: {} keeps no stable file IDs", identity.volume.filesystem);
            return None;
        }
        Some(identity)
    }

    fn with_file_id(identity: &FileIdentity, file_id: String) -> FileIdentity {
        FileIdentity { file_id: Some(file_id), ..identity.clone() }
    }

    /// An opened handle is the recorded entry only with its recorded file ID:
    /// its inode number and, on Linux, its kernel file handle. A recorded
    /// handle the open entry doesn't have, or a recorded id without the
    /// handle the open entry has, is another entry.
    #[test]
    fn an_open_handle_is_the_recorded_entry_only_with_its_kernel_handle() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("frame.fits");
        fs::write(&path, b"frame").unwrap();
        let Some(identity) = recorded(&path) else { return };
        let before = fs::symlink_metadata(&path).unwrap();
        let file = File::open(&path).unwrap();
        assert!(handle_is(&file, &before, &identity));
        let other = with_file_id(&identity, FileIdentity::unix_file_id(before.ino(), Some("0-00")));
        assert!(!handle_is(&file, &before, &other), "another kernel handle");
        if fs_file_handle_linux::of_path(&path).unwrap().is_some() {
            let refused = with_file_id(&identity, FileIdentity::unix_file_id(before.ino(), None));
            assert!(!handle_is(&file, &before, &refused), "an id recorded without the handle");
        }
    }

    /// astro-plan-clqvu: ext4 hands a removed entry's inode number to the next
    /// entry made, and only the kernel file handle tells that entry apart. A
    /// handle read the kernel refuses (`EPERM` under a seccomp sandbox,
    /// `EOVERFLOW`) gives the inode number alone, as it is built here: such an
    /// id never reads as the recorded entry, nor does the new entry read as
    /// one recorded under a refused read.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_refused_handle_read_never_reads_a_reused_inode_as_the_recorded_entry() {
        /// `statfs(2)`'s `f_type` for ext2, ext3 and ext4.
        const EXT4_SUPER_MAGIC: i128 = 0xEF53;
        let temp = tempfile::tempdir().unwrap();
        // Only ext4 is known to hand a freed inode number to the next entry
        // made in the folder; tmpfs and btrfs don't, so nothing is reused.
        let f_type = rustix::fs::statfs(temp.path()).unwrap().f_type;
        if i128::from(f_type) != EXT4_SUPER_MAGIC {
            eprintln!("skipped: the test folder is not on ext4 (f_type {f_type:#x})");
            return;
        }
        let path = temp.path().join("frame.fits");
        fs::write(&path, b"frame").unwrap();
        let Some(identity) = recorded(&path) else { return };
        let inode = fs::symlink_metadata(&path).unwrap().ino();
        fs::remove_file(&path).unwrap();
        // ext4 gives the lowest free number in the folder's group: an entry
        // that took a lower one is kept aside until the freed one is reused.
        let number_taken_again = (0..64).any(|attempt| {
            fs::write(&path, b"frame").unwrap();
            if fs::symlink_metadata(&path).unwrap().ino() == inode {
                return true;
            }
            fs::rename(&path, temp.path().join(format!("aside-{attempt}"))).unwrap();
            false
        });
        assert!(number_taken_again, "the test folder's filesystem reuses a freed inode number");
        let observed = recorded(&path).unwrap();
        assert!(!observed.is_recorded(&identity), "the kernel handle tells it apart");
        let refused = with_file_id(&observed, FileIdentity::unix_file_id(inode, None));
        assert!(!refused.is_recorded(&identity), "a refused handle read is no proof");
        assert!(!observed.is_recorded(&refused), "nor is an id recorded under one");
        let before = fs::symlink_metadata(&path).unwrap();
        let file = File::open(&path).unwrap();
        assert!(!handle_is(&file, &before, &identity), "the open entry is not the recorded one");
        assert!(!handle_is(&file, &before, &refused), "nor one recorded without its handle");
        let expect = Expect { identity: &refused, size_bytes: 5, modified_ns: None, root: None };
        assert!(
            matches!(open_unchanged(&path, &expect), Err(Check::Changed(_))),
            "custody refuses it as another entry"
        );
    }
}
