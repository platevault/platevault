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
pub mod transfer;
pub mod trash;

use std::fs::{self, File, Metadata};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};

use crate::header_patch::Card;
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
            (EntryKind::File, Some(sha256)) => {
                Ok(KeptCopy { path: evidence.path, fingerprint: evidence.fingerprint, sha256 })
            }
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
        scope: NativePath::from_path(path),
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
/// its target text. PREP snapshots its sources and written entries with it.
pub(crate) fn observe_entry(path: &Path) -> Result<EntryEvidence, LibraryError> {
    if !path.is_absolute() {
        return Err(LibraryError::InvalidInput("custody paths must be absolute".into()));
    }
    let metadata = lstat(path)?;
    if is_link(&metadata) {
        let (fingerprint, target) = link_fingerprint(path, &metadata)?;
        return Ok(EntryEvidence {
            path: NativePath::from_path(path),
            kind: EntryKind::Link { target },
            fingerprint,
            sha256: None,
        });
    }
    let fingerprint = inventory::probe_fingerprint(path)?;
    let expect = Expect::recorded(&fingerprint);
    let sha256 = read_unchanged(path, &expect, |_| Ok(()))
        .map_err(|check| scoped(LibraryError::IdentityConflict(check.detail().to_owned()), path))?;
    Ok(EntryEvidence {
        path: NativePath::from_path(path),
        kind: EntryKind::File,
        fingerprint,
        sha256: Some(sha256),
    })
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
/// where the volume qualifies its file IDs as stable.
#[cfg(unix)]
#[allow(clippy::unnecessary_wraps)]
fn entry_file_id(
    _path: &Path,
    metadata: &Metadata,
    volume: &VolumeIdentity,
) -> Result<Option<String>, LibraryError> {
    use std::os::unix::fs::MetadataExt;
    Ok(volume.file_ids_stable.then(|| metadata.ino().to_string()))
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

/// Same volume, and the same file ID where the volume's IDs are stable.
pub(crate) fn same_identity(observed: &FileIdentity, recorded: &FileIdentity) -> bool {
    observed.volume == recorded.volume
        && (!recorded.volume.file_ids_stable || observed.file_id == recorded.file_id)
}

/// Why a re-read did not prove the recorded entry.
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
}

impl<'a> Expect<'a> {
    const fn recorded(fingerprint: &'a ObservationFingerprint) -> Self {
        Self {
            identity: &fingerprint.identity,
            size_bytes: fingerprint.size_bytes,
            modified_ns: Some(fingerprint.modified_ns),
        }
    }
}

/// Stream a regular file's bytes through `sink` and return their SHA-256,
/// proving the open handle is the expected entry and that it did not change
/// while it was read. Links are never followed.
fn read_unchanged(
    path: &Path,
    expect: &Expect<'_>,
    mut sink: impl FnMut(&[u8]) -> std::io::Result<()>,
) -> Result<String, Check> {
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
    let mut file = File::open(path).map_err(|error| unavailable(path, &error))?;
    if !handle_is(&file, &before, expect.identity) {
        return Err(Check::Changed(format!("{} was replaced while it was opened", path.display())));
    }
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

/// Whether an opened handle is the inspected entry rather than a replacement.
#[cfg(unix)]
fn handle_is(file: &File, inspected: &Metadata, _identity: &FileIdentity) -> bool {
    file.metadata().is_ok_and(|handle| same_entry(inspected, &handle))
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
/// identity, without reading its bytes.
pub(crate) fn in_place(source: &EntryEvidence) -> bool {
    let Ok(path) = source.path.to_path_buf() else {
        return false;
    };
    match &source.kind {
        EntryKind::File => inventory::probe_fingerprint(&path)
            .is_ok_and(|observed| observed.equivalent(&source.fingerprint)),
        EntryKind::Link { target } => link_holds(&path, &source.fingerprint, target).is_ok(),
    }
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
        EntryKind::Link { target } => link_holds(&path, &source.fingerprint, target),
        EntryKind::File => {
            read_unchanged(&path, &Expect::recorded(&source.fingerprint), |_| Ok(())).and_then(
                |digest| {
                    if Some(digest.as_str()) == source.sha256.as_deref() {
                        Ok(())
                    } else {
                        Err(Check::Changed(format!(
                            "{} no longer holds its reviewed bytes (SHA-256 differs)",
                            path.display()
                        )))
                    }
                },
            )
        }
    };
    checked.map_err(|check| match check {
        Check::Unavailable(detail) => ItemReason::new(ReasonCode::SourceUnavailable, detail),
        Check::Changed(detail) => ItemReason::new(ReasonCode::SourceDrift, detail),
    })
}

/// D19 for a retained original or kept copy: identity and SHA-256 re-read.
fn verify_kept(kept: &KeptCopy) -> Result<(), ItemReason> {
    let path = path_of(&kept.path)?;
    let digest = read_unchanged(&path, &Expect::recorded(&kept.fingerprint), |_| Ok(()))
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

/// Write `cards` into the isolated entry at `path` while it still holds
/// `identity`: a patched Copy or Clone the preparation itself wrote, never
/// an original or a link (PREP-FR-03). A card already holding its patched
/// bytes is written unchanged, so a resumed item patches again safely.
pub(crate) fn patch_entry(
    path: &Path,
    identity: &FileIdentity,
    cards: &[Card],
) -> Result<(), ItemReason> {
    let foreign = || {
        ItemReason::new(
            ReasonCode::DestinationChanged,
            format!("{} is not the file this preparation wrote", path.display()),
        )
    };
    let failed = |error: std::io::Error| {
        ItemReason::new(ReasonCode::WriteFailed, format!("{}: {error}", path.display()))
    };
    let inspected = fs::symlink_metadata(path).map_err(failed)?;
    if is_link(&inspected)
        || !inspected.is_file()
        || cards.iter().any(|card| card.offset + Card::LEN > inspected.len())
    {
        return Err(foreign());
    }
    let probed = inventory::probe_fingerprint(path).map_err(|_| foreign())?;
    let mut file = fs::OpenOptions::new().write(true).open(path).map_err(failed)?;
    if !same_identity(&probed.identity, identity) || !handle_is(&file, &inspected, identity) {
        return Err(foreign());
    }
    for card in cards {
        file.seek(SeekFrom::Start(card.offset)).map_err(failed)?;
        file.write_all(&card.patched).map_err(failed)?;
    }
    file.sync_all().map_err(failed)
}

/// D19 for an isolated patched entry (PREP-FR-09): re-read, it still holds
/// its recorded bytes, and it differs from the source snapshot only by
/// `cards`, each holding its patched bytes where the source held the
/// original ones.
pub(crate) fn verify_patched(
    entry: &EntryEvidence,
    source_sha256: Option<&str>,
    cards: &[Card],
) -> Result<(), ItemReason> {
    let path = path_of(&entry.path)?;
    let mismatch = |detail: String| ItemReason::new(ReasonCode::DestinationMismatch, detail);
    let beyond = || {
        mismatch(format!(
            "{} differs from the source snapshot beyond its reviewed header change",
            path.display()
        ))
    };
    if cards.iter().any(|card| card.offset + Card::LEN > entry.fingerprint.size_bytes) {
        return Err(beyond());
    }
    let index = |value: u64| usize::try_from(value).unwrap_or(usize::MAX);
    let mut unpatched = Sha256::new();
    let mut offset = 0_u64;
    let mut holds_cards = true;
    let digest = read_unchanged(&path, &Expect::recorded(&entry.fingerprint), |bytes| {
        let end = offset + u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        let mut at = offset;
        for card in
            cards.iter().filter(|card| card.offset < end && card.offset + Card::LEN > offset)
        {
            let from = card.offset.max(offset);
            let to = (card.offset + Card::LEN).min(end);
            unpatched.update(&bytes[index(at - offset)..index(from - offset)]);
            let span = index(from - card.offset)..index(to - card.offset);
            holds_cards &=
                bytes[index(from - offset)..index(to - offset)] == card.patched[span.clone()];
            unpatched.update(&card.original[span]);
            at = to;
        }
        unpatched.update(&bytes[index(at - offset)..]);
        offset = end;
        Ok(())
    })
    .map_err(|check| mismatch(check.detail().to_owned()))?;
    let unpatched = hex::encode(unpatched.finalize());
    if !holds_cards
        || Some(digest.as_str()) != entry.sha256.as_deref()
        || Some(unpatched.as_str()) != source_sha256
    {
        return Err(beyond());
    }
    Ok(())
}
