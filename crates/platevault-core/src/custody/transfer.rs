// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Verified transfer (STO-FR-07, STO-FR-12, STO-IMP-FR-04).
//!
//! A transfer copies the reviewed source snapshot into a partial file created
//! with create-new semantics beside its destination and recorded by identity
//! before any byte is written. The copy is hashed as it is written and must
//! match the reviewed SHA-256; it is synced, installed at the destination with
//! a no-replace rename or link, or, where the volume has neither (macOS exFAT),
//! as a verified copy onto a file it creates there, and the folder is synced.
//! Verification re-reads the installed copy through a handle proven to be the
//! recorded file. An existing entry at the destination is never replaced; the
//! only files this module ever removes are a partial copy it wrote itself,
//! while that name still holds the recorded identity, an unfinished copy of
//! such a partial that an interrupted install left at its destination,
//! which holds nothing the partial doesn't, and the source of a move made
//! by copy that an interruption left moved aside, once proven to be that
//! source, or found beside the copy holding its bytes and time, and to hold
//! nothing its copy doesn't. Such a source that its copy no longer holds
//! goes back to its name, or to a visible one beside it, never staying
//! hidden.

use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Component, Path, PathBuf};

use uuid::Uuid;

#[cfg(unix)]
use super::{open_unchanged, Opened};
use super::{read_unchanged, same_identity, Check, Expect};
#[cfg(unix)]
use crate::layout;
use crate::{
    inventory, EntryEvidence, FileIdentity, ItemReason, NativePath, ReasonCode,
    TransferDestination, WrittenCopy,
};

fn reason(code: ReasonCode, detail: impl Into<String>) -> ItemReason {
    ItemReason::new(code, detail)
}

fn occupied(path: &Path) -> ItemReason {
    reason(
        ReasonCode::DestinationOccupied,
        format!("{} already holds an entry; nothing is replaced", path.display()),
    )
}

fn changed(detail: impl Into<String>) -> ItemReason {
    reason(ReasonCode::DestinationChanged, detail)
}

fn write_failed(path: &Path, error: &impl std::fmt::Display) -> ItemReason {
    reason(ReasonCode::WriteFailed, format!("{}: {error}", path.display()))
}

/// The destination folder below its root and the destination file path.
fn layout(destination: &TransferDestination) -> Result<(PathBuf, PathBuf, PathBuf), ItemReason> {
    let invalid = |error: crate::LibraryError| changed(error.to_string());
    let root = destination.root.to_path_buf().map_err(invalid)?;
    let relative = destination.relative.relative_path().map_err(invalid)?;
    let folder = relative.parent().unwrap_or_else(|| Path::new("")).to_path_buf();
    let file = root.join(&relative);
    Ok((root, folder, file))
}

/// Prove `root` is a real folder and create the missing folders of `relative`
/// below it, one level at a time, never following a link.
pub(crate) fn ensure_folder(root: &Path, relative: &Path) -> Result<PathBuf, ItemReason> {
    let root_metadata = real_folder(root)?;
    let mut current = root.to_path_buf();
    for part in relative.components() {
        let Component::Normal(name) = part else {
            return Err(changed("a destination is a plain relative path"));
        };
        let parent = current.clone();
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match fs::create_dir(&current) {
                    Ok(()) => {
                        sync_folder(&parent).map_err(|error| write_failed(&parent, &error))?;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(write_failed(&current, &error)),
                }
            }
            Err(error) => return Err(write_failed(&current, &error)),
        }
        let metadata = real_folder(&current)?;
        if !same_device(&root_metadata, &metadata) {
            return Err(changed(format!(
                "{} lies on another volume than the destination root",
                current.display()
            )));
        }
    }
    Ok(current)
}

fn real_folder(path: &Path) -> Result<fs::Metadata, ItemReason> {
    let metadata = fs::symlink_metadata(path).map_err(|error| write_failed(path, &error))?;
    if super::is_link(&metadata) || !metadata.is_dir() {
        return Err(changed(format!(
            "{} is not a real folder; links are not followed",
            path.display()
        )));
    }
    Ok(metadata)
}

#[cfg(unix)]
fn same_device(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev()
}

#[cfg(not(unix))]
const fn same_device(_left: &fs::Metadata, _right: &fs::Metadata) -> bool {
    true
}

fn vacant(path: &Path) -> Result<(), ItemReason> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(occupied(path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(write_failed(path, &error)),
    }
}

/// Whether `path` holds the regular file recorded as `identity`.
fn holds(path: &Path, identity: &FileIdentity) -> bool {
    inventory::probe_fingerprint(path)
        .is_ok_and(|observed| same_identity(&observed.identity, identity))
}

/// Remove a file this operation wrote (a partial copy, a clone), only while
/// its name still holds it.
pub(crate) fn discard(partial: &Path, identity: &FileIdentity) {
    if holds(partial, identity) {
        let _ = fs::remove_file(partial);
    }
}

/// Pending → Writing: create the destination's missing folders, refuse an
/// occupied destination, and create the partial copy whose identity the item
/// records before any byte is written.
pub(crate) fn begin(
    operation: Uuid,
    seq: u32,
    destination: &TransferDestination,
) -> Result<WrittenCopy, ItemReason> {
    let (root, relative_folder, file) = layout(destination)?;
    let folder = ensure_folder(&root, &relative_folder)?;
    vacant(&file)?;
    let mut builder = tempfile::Builder::new();
    let prefix = format!(".pv-{}-{seq}-", operation.simple());
    builder.prefix(&prefix).suffix(".partial").rand_bytes(6).disable_cleanup(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(fs::Permissions::from_mode(0o666));
    }
    let partial = builder.tempfile_in(&folder).map_err(|error| write_failed(&folder, &error))?;
    let path = partial.path().to_path_buf();
    drop(partial);
    let identity =
        inventory::probe_fingerprint(&path).map_err(|error| write_failed(&path, &error))?.identity;
    Ok(WrittenCopy { partial: NativePath::from_path(&path), identity })
}

/// Writing → Installed: stream the reviewed source into the recorded partial
/// copy, prove the bytes are the snapshot, sync, and install without replacing
/// anything ([`install`]); returns the copy now at the destination. A resumed
/// item whose copy was already installed is recognized by its recorded
/// identity once the partial name is gone, or as the partial's second link.
/// While the partial is still a file of its own the install runs again: an
/// unfinished copy an interrupted install left at the destination is never
/// taken for the entry, since on a volume without stable file IDs any file
/// there carries the recorded identity.
pub(crate) fn write(
    source: &EntryEvidence,
    destination: &TransferDestination,
    written: &WrittenCopy,
) -> Result<WrittenCopy, ItemReason> {
    let partial = written.partial.to_path_buf().map_err(|error| changed(error.to_string()))?;
    let (_, _, file) = layout(destination)?;
    if !holds(&partial, &written.identity) {
        if holds(&file, &written.identity) {
            return Ok(written.clone());
        }
        return Err(changed(format!(
            "the partial copy {} this item recorded is gone and no copy of it is installed",
            partial.display()
        )));
    }
    if second_link(&partial, &file) {
        // A link-and-unlink install stopped before it removed the partial name.
        discard(&partial, &written.identity);
        return Ok(written.clone());
    }
    fill_from_source(source, written)?;
    install(destination, written)
}

/// Whether `partial` and `file` are two names of one regular file.
#[cfg(unix)]
fn second_link(partial: &Path, file: &Path) -> bool {
    match (fs::symlink_metadata(partial), fs::symlink_metadata(file)) {
        (Ok(partial), Ok(file)) => partial.is_file() && super::same_entry(&partial, &file),
        _ => false,
    }
}

/// Windows installs by rename only, so a partial never has a second name.
#[cfg(not(unix))]
const fn second_link(_partial: &Path, _file: &Path) -> bool {
    false
}

/// Whether `name` is a partial copy this module writes (`.pv-…partial`), or
/// the temporary file `xisf-header` writes beside one while it edits it in
/// place (`.` + the partial's name + `.tmp-<pid>`). Either is only ever an
/// unfinished copy `PlateVault` wrote, left by an interruption.
pub(crate) fn is_partial_name(name: &str) -> bool {
    let partial = |name: &str| name.starts_with(".pv-") && name.ends_with(".partial");
    partial(name)
        || name.strip_prefix('.').and_then(|rest| rest.rsplit_once(".tmp-")).is_some_and(
            |(edited, pid)| {
                partial(edited) && !pid.is_empty() && pid.bytes().all(|byte| byte.is_ascii_digit())
            },
        )
}

/// Copy the reviewed source into the recorded partial copy through handles
/// proven to be both, prove the bytes are the snapshot, give the copy the
/// source's modification time and sync it. A partial that fails is removed.
pub(crate) fn fill_from_source(
    source: &EntryEvidence,
    written: &WrittenCopy,
) -> Result<(), ItemReason> {
    let source_path = super::path_of(&source.path)?;
    fill_partial(written, source.fingerprint.modified_ns, |out| {
        let digest =
            read_unchanged(&source_path, &Expect::source(source), |bytes| out.write_all(bytes))
                .map_err(|check| match check {
                    Check::Unavailable(detail) => reason(ReasonCode::SourceUnavailable, detail),
                    Check::Changed(detail) => reason(ReasonCode::SourceDrift, detail),
                })?;
        if Some(digest.as_str()) == source.sha256.as_deref() {
            return Ok(());
        }
        Err(reason(
            ReasonCode::SourceDrift,
            format!(
                "{} no longer holds its reviewed bytes (SHA-256 differs)",
                source_path.display()
            ),
        ))
    })
}

/// Write the recorded partial copy afresh with `fill`, through a handle
/// proven to be it, then give it the modification time `modified_ns` and
/// sync it. A partial that fails is removed.
pub(crate) fn fill_partial<T>(
    written: &WrittenCopy,
    modified_ns: i128,
    fill: impl FnOnce(&mut fs::File) -> Result<T, ItemReason>,
) -> Result<T, ItemReason> {
    let partial = written.partial.to_path_buf().map_err(|error| changed(error.to_string()))?;
    let filled = open_partial(&partial, &written.identity).and_then(|mut out| {
        out.set_len(0).map_err(|error| write_failed(&partial, &error))?;
        let value = fill(&mut out)?;
        settle(&out, &partial, modified_ns)?;
        Ok(value)
    });
    if filled.is_err() {
        discard(&partial, &written.identity);
    }
    filled
}

/// Give the recorded partial copy the modification time `modified_ns` and
/// sync it, through a handle proven to be it.
pub(crate) fn settle_partial(written: &WrittenCopy, modified_ns: i128) -> Result<(), ItemReason> {
    let partial = written.partial.to_path_buf().map_err(|error| changed(error.to_string()))?;
    let out = open_partial(&partial, &written.identity)?;
    settle(&out, &partial, modified_ns)
}

/// The recorded partial copy, opened for writing through a handle proven to
/// be it.
fn open_partial(partial: &Path, identity: &FileIdentity) -> Result<fs::File, ItemReason> {
    let inspected = fs::symlink_metadata(partial).map_err(|error| write_failed(partial, &error))?;
    let out = OpenOptions::new()
        .write(true)
        .open(partial)
        .map_err(|error| write_failed(partial, &error))?;
    if !super::handle_is(&out, &inspected, identity) {
        return Err(changed(format!("{} was replaced while it was opened", partial.display())));
    }
    Ok(out)
}

fn settle(out: &fs::File, partial: &Path, modified_ns: i128) -> Result<(), ItemReason> {
    if let Some(modified) = modified_time(modified_ns) {
        out.set_modified(modified).map_err(|error| write_failed(partial, &error))?;
    }
    sync(out).map_err(|error| write_failed(partial, &error))
}

/// Install the recorded partial copy at the destination without replacing
/// anything ([`move_noreplace`]) and sync its folder; returns the copy now
/// there. Where the volume has neither a no-replace rename nor hard links
/// (macOS exFAT), that is a verified copy of the partial onto a file created
/// at the destination, with an identity of its own, and the partial goes once
/// the copy is verified. The transfer journal names the partial and the
/// destination before the first byte, so an interruption of that copy leaves
/// at the destination at most an unfinished copy of the partial, which the
/// next install removes before it copies again ([`remove_unfinished_copy`]).
/// Anything else there is never replaced. A partial that can't be installed
/// is removed.
pub(crate) fn install(
    destination: &TransferDestination,
    written: &WrittenCopy,
) -> Result<WrittenCopy, ItemReason> {
    let partial = written.partial.to_path_buf().map_err(|error| changed(error.to_string()))?;
    let (_, _, file) = layout(destination)?;
    let mut moved = move_noreplace(&partial, &file);
    if moved.as_ref().is_err_and(|error| error.kind() == std::io::ErrorKind::AlreadyExists)
        && remove_unfinished_copy(&file, &partial)
    {
        moved = move_noreplace(&partial, &file);
    }
    let installed = match moved {
        Ok(Moved::Renamed) => written.clone(),
        #[cfg(unix)]
        Ok(Moved::Copied(identity)) => WrittenCopy { identity, ..written.clone() },
        Err(error) => {
            discard(&partial, &written.identity);
            return Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
                occupied(&file)
            } else {
                write_failed(&file, &error)
            });
        }
    };
    // A link-and-unlink install may leave the partial name as a second link.
    discard(&partial, &written.identity);
    let folder = file.parent().unwrap_or_else(|| Path::new(""));
    sync_folder(folder).map_err(|error| write_failed(folder, &error))?;
    Ok(installed)
}

fn modified_time(nanos: i128) -> Option<std::time::SystemTime> {
    let magnitude = std::time::Duration::from_nanos(u64::try_from(nanos.unsigned_abs()).ok()?);
    if nanos >= 0 {
        std::time::UNIX_EPOCH.checked_add(magnitude)
    } else {
        std::time::UNIX_EPOCH.checked_sub(magnitude)
    }
}

/// `Installed` → `DestinationVerified`: re-read the destination through a handle
/// proven to be the recorded copy and compare its SHA-256 with the snapshot.
/// Its modification time is not compared: a volume may not keep it exactly.
pub(crate) fn verify(
    source: &EntryEvidence,
    destination: &TransferDestination,
    written: &WrittenCopy,
) -> Result<(), ItemReason> {
    let expected = source.sha256.as_deref();
    verify_bytes(destination, written, source.fingerprint.size_bytes, expected)
}

/// Re-read the destination through a handle proven to be the recorded copy:
/// it must hold `size_bytes` bytes whose SHA-256 is `sha256`.
pub(crate) fn verify_bytes(
    destination: &TransferDestination,
    written: &WrittenCopy,
    size_bytes: u64,
    sha256: Option<&str>,
) -> Result<(), ItemReason> {
    let (_, _, file) = layout(destination)?;
    if !holds(&file, &written.identity) {
        return Err(changed(format!(
            "{} no longer holds the copy this operation wrote",
            file.display()
        )));
    }
    let expect = Expect { identity: &written.identity, size_bytes, modified_ns: None, root: None };
    match read_unchanged(&file, &expect, |_| Ok(())) {
        Ok(digest) if Some(digest.as_str()) == sha256 => Ok(()),
        Ok(_) => Err(reason(
            ReasonCode::DestinationMismatch,
            format!("the re-read of {} differs from the bytes written", file.display()),
        )),
        Err(Check::Changed(detail)) => Err(changed(detail)),
        Err(Check::Unavailable(detail)) => Err(reason(ReasonCode::DestinationMismatch, detail)),
    }
}

#[cfg(unix)]
pub(crate) fn sync_folder(folder: &Path) -> std::io::Result<()> {
    sync(&fs::File::open(folder)?)
}

/// Flush what `file` holds to its volume, as `File::sync_all` does. On
/// macOS `sync_all` is `fcntl(F_FULLFSYNC)`, which only some file systems
/// implement: smbfs answers `ENOTSUP` for a file and a folder alike
/// (astro-plan-wdlol), so every copy onto an SMB share would fail. Where
/// the volume has no full sync, this falls back to `fsync`, the strongest
/// sync it has (smbfs sends it to the server as a flush), as SQLite's
/// `fullfsync` does. Any other error is the sync's.
pub(crate) fn sync(file: &fs::File) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        full_sync_or_fsync(file, |file| rustix::fs::fcntl_fullfsync(file))
    }
    #[cfg(not(target_os = "macos"))]
    {
        file.sync_all()
    }
}

/// [`sync`] with the full sync `full`; tests stand in a volume without it.
#[cfg(target_os = "macos")]
fn full_sync_or_fsync(
    file: &fs::File,
    full: impl Fn(&fs::File) -> rustix::io::Result<()>,
) -> std::io::Result<()> {
    use rustix::io::{retry_on_intr, Errno};

    match retry_on_intr(|| full(file)) {
        // As `move_noreplace` classifies an operation the volume lacks.
        Err(errno)
            if [Errno::INVAL, Errno::NOTSUP, Errno::OPNOTSUPP, Errno::NOSYS].contains(&errno) =>
        {
            Ok(retry_on_intr(|| rustix::fs::fsync(file))?)
        }
        result => Ok(result?),
    }
}

/// Windows offers no folder sync through a safe handle; NTFS journals the
/// install's directory entry, and the re-read proves the installed bytes.
#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
pub(crate) const fn sync_folder(_folder: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Make `path` a copy-on-write clone of the file `source` holds open: APFS
/// `clonefile` on macOS, the `FICLONE` reflink on Linux. The source is the
/// handle, never a path, so what is cloned is the entry it was opened as.
/// Nothing is copied when the volume or the platform can't clone; the error
/// says so and `path` stays free.
#[cfg(target_os = "macos")]
pub(crate) fn clone_file(source: &fs::File, path: &Path) -> std::io::Result<()> {
    let folder = path.parent().unwrap_or(path);
    let name = path.file_name().ok_or_else(|| std::io::Error::other("no file name"))?;
    let folder = fs::File::open(folder)?;
    rustix::fs::fclonefileat(source, &folder, name, rustix::fs::CloneFlags::NOFOLLOW)?;
    sync(&fs::File::open(path)?)
}

#[cfg(target_os = "linux")]
pub(crate) fn clone_file(source: &fs::File, path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let out = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    if let Err(error) = rustix::fs::ioctl_ficlone(&out, source) {
        // Remove only the empty file this clone created, while it is ours.
        let ours = out.metadata()?;
        if fs::symlink_metadata(path)
            .is_ok_and(|now| now.dev() == ours.dev() && now.ino() == ours.ino())
        {
            let _ = fs::remove_file(path);
        }
        return Err(error.into());
    }
    sync(&out)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn clone_file(_source: &fs::File, _path: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "this platform makes no verified clone",
    ))
}

/// Rename `from` to `to` on one volume without replacing what is at `to`
/// (STO-FR-12, PREP-FR-06). No path checks `to` and then renames: a plain
/// rename replaces an empty folder on Unix, and on Windows 10 1607 and later
/// where the volume supports `FileRenameInfoEx` (the platform notes of
/// `std::fs::rename`), so a folder that appears between the check and the
/// rename would be replaced.
///
/// - macOS and Linux: `renamex_np(RENAME_EXCL)` and
///   `renameat2(RENAME_NOREPLACE)` (rustix `RenameFlags::NOREPLACE`), which
///   refuse an existing `to` with `EEXIST`.
/// - Windows: `MoveFileExW(from, to, 0)`, without `MOVEFILE_REPLACE_EXISTING`
///   (`fs_noreplace_windows`, which holds the one `unsafe` call so this crate
///   keeps `forbid`). The filesystem fails it with `ERROR_ALREADY_EXISTS`
///   when anything is at `to`; it moves a folder with its children on one
///   volume, and a link as the link itself. tempfile's `persist_noclobber`
///   isn't used: it first sets the source's attributes through its path,
///   which follows a link to an original.
/// - A Unix volume that answers the no-replace rename as unsupported
///   (`EINVAL`, `ENOTSUP`, `EOPNOTSUPP`, `ENOSYS`: macOS exFAT, some network
///   and FUSE mounts), and other Unix platforms: [`without_noreplace`]. A folder moves
///   over an empty placeholder it claimed itself; the one exception to
///   "never replaces" is an empty folder another process swaps in for that
///   placeholder before the rename (owner decision of 2026-10-20, so Apply
///   keeps working on such volumes). A file moves with a no-replace hard
///   link, or where the volume has none, as a verified copy onto a file it
///   created with `create_new` ([`copy_onto_new`]), which replaces nothing.
///
/// Evidence (astro-plan-nfsgg, a 64 MB exFAT image from `hdiutil create -fs
/// ExFAT` on macOS 26): `renamex_np(RENAME_EXCL)` answers `ENOTSUP` onto a
/// free name and `EEXIST` onto an existing entry; `mkdir` and
/// `open(O_CREAT | O_EXCL)` onto an existing name answer `EEXIST`; `rename`
/// over an empty folder moves the folder with its files; over a folder
/// holding a file it answers `ENOTEMPTY` and over a file `ENOTDIR`, both
/// leaving either side unchanged; `link`, `renamex_np(RENAME_SWAP)`,
/// `exchangedata` and `clonefile` answer `ENOTSUP`, so no file can be
/// published under a new name there without replacing what may hold it.
///
/// # Errors
/// `AlreadyExists` when `to` is taken; the platform's rename error.
pub(crate) fn rename_noreplace(from: &Path, to: &Path) -> std::io::Result<()> {
    move_noreplace(from, to).map(drop)
}

/// How [`move_noreplace`] put an entry at its new name.
#[derive(Debug)]
pub(crate) enum Moved {
    /// `to` is `from` under its new name, with its identity.
    Renamed,
    /// `to` is a verified copy of the regular file `from`, with this
    /// identity of its own, and `from` is gone ([`copy_onto_new`]).
    /// Unix only: Windows always has the no-replace `MoveFileExW`.
    #[cfg(unix)]
    Copied(FileIdentity),
}

/// [`rename_noreplace`], telling whether the entry was renamed or, on a
/// volume without a no-replace rename or hard links, copied.
pub(crate) fn move_noreplace(from: &Path, to: &Path) -> std::io::Result<Moved> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use rustix::fs::{renameat_with, RenameFlags, CWD};
        use rustix::io::Errno;
        match renameat_with(CWD, from, CWD, to, RenameFlags::NOREPLACE) {
            Ok(()) => Ok(Moved::Renamed),
            // macOS has both ENOTSUP and EOPNOTSUPP; Linux one value for both.
            Err(errno)
                if [Errno::INVAL, Errno::NOTSUP, Errno::OPNOTSUPP, Errno::NOSYS]
                    .contains(&errno) =>
            {
                without_noreplace(from, to)
            }
            Err(error) => Err(error.into()),
        }
    }
    #[cfg(windows)]
    {
        fs_noreplace_windows::move_noreplace(from, to).map(|()| Moved::Renamed)
    }
    #[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
    {
        without_noreplace(from, to)
    }
}

/// [`move_noreplace`] where the volume has no no-replace rename. A file
/// goes through tempfile's no-clobber persist, whose hard link refuses an
/// existing name atomically, and where the volume has no hard links either
/// is copied by [`copy_onto_new`] and then removed. A folder goes
/// [`over_placeholder`] once `mkdir` claimed `to`, which fails when anything
/// is there.
#[cfg(unix)]
fn without_noreplace(from: &Path, to: &Path) -> std::io::Result<Moved> {
    let metadata = fs::symlink_metadata(from)?;
    if metadata.is_dir() {
        fs::create_dir(to)?;
        let placeholder = open_no_follow(to)?;
        return over_placeholder(from, to, placeholder).map(|()| Moved::Renamed);
    }
    let mut moving = tempfile::TempPath::try_from_path(from)?;
    moving.disable_cleanup(true);
    match moving.persist_noclobber(to) {
        Ok(()) => Ok(Moved::Renamed),
        Err(failure) if metadata.is_file() && lacks_links(&failure.error) => {
            let copied = copy_onto_new(from, to)?;
            remove_source(from, to, copied).map(Moved::Copied)
        }
        Err(failure) => Err(failure.error),
    }
}

/// Whether a no-clobber persist failed because the volume has neither a
/// no-replace rename nor hard links: tempfile reports the rename's error,
/// or the link's after a rename the volume rejects as `EINVAL` or `ENOSYS`.
/// macOS exFAT answers both with `ENOTSUP`, Linux reports a volume without
/// hard links as `EPERM`, and a FUSE server lacking an operation answers
/// `ENOSYS` (as `fs_pathsafe::export_dest` classifies them).
#[cfg(unix)]
fn lacks_links(error: &std::io::Error) -> bool {
    use rustix::io::Errno;

    Errno::from_io_error(error).is_some_and(|errno| {
        [Errno::NOTSUP, Errno::OPNOTSUPP, Errno::NOSYS, Errno::PERM].contains(&errno)
    })
}

/// What [`copy_onto_new`] proved: a no-follow handle on the source entry it
/// read, the handle of the file it created and that file's identity. Both
/// stay open until their entry is compared for the last time, so neither
/// inode can be handed to another entry while the move runs: ext4 gives a
/// just-freed inode number to the next file created, and macOS exFAT numbers
/// an entry by its first cluster.
#[cfg(unix)]
struct Copied {
    source: fs::File,
    created: fs::File,
    identity: FileIdentity,
}

/// Copy the regular file `from` onto a file created at `to` with
/// `create_new`, which fails when anything is there, the way a verified
/// transfer fills its partial copy: the source is streamed through a handle
/// proven to be it and hashed as it is written ([`read_unchanged`]), the copy
/// takes the source's own extended attributes ([`carry_xattrs`]) and
/// modification time and is synced with its folder, and the copy is re-read
/// through a handle proven to be the created file and must have the
/// source's SHA-256.
///
/// `from` is read by its path: every caller moves an entry of a folder
/// `PlateVault` keeps itself (a partial copy, a file of `View (previous)/`),
/// never a catalog source below a registered root, whose reads go through
/// [`super::rooted`] instead.
///
/// Until the copy is verified, `to` holds an unfinished copy under its final
/// name, since no other name can be published there without replacing. A
/// copy that fails is removed while `to` still names the created file. An
/// interruption leaves it with the source intact: `to` reads as taken, and a
/// caller whose journal names the move removes it with
/// [`remove_unfinished_copy`] before it moves again.
///
/// The created file is recognised through its open handle, compared each
/// time: macOS exFAT reports a placeholder inode for an empty file and the
/// first cluster once data is written, so an inode noted at creation no
/// longer matches.
#[cfg(unix)]
fn copy_onto_new(from: &Path, to: &Path) -> std::io::Result<Copied> {
    copy_onto_new_with(from, to, set_xattr)
}

/// [`copy_onto_new`], setting each carried xattr with `set`; tests stand in
/// a copy that can't take one.
#[cfg(unix)]
fn copy_onto_new_with(from: &Path, to: &Path, set: SetXattr) -> std::io::Result<Copied> {
    let fingerprint = inventory::probe_fingerprint(from).map_err(std::io::Error::other)?;
    let source = open_no_follow(from)?;
    let mut out = OpenOptions::new().read(true).write(true).create_new(true).open(to)?;
    let filled = (|| {
        let digest =
            read_unchanged(from, &Expect::recorded(&fingerprint), |bytes| out.write_all(bytes))
                .map_err(|check| std::io::Error::other(check.detail().to_owned()))?;
        carry_xattrs(&source, &out, set)?;
        settle(&out, to, fingerprint.modified_ns)
            .map_err(|failed| std::io::Error::other(failed.detail))?;
        sync_folder(to.parent().unwrap_or_else(|| Path::new("")))?;
        let identity = inventory::probe_fingerprint(to).map_err(std::io::Error::other)?.identity;
        let expect = Expect {
            identity: &identity,
            size_bytes: fingerprint.size_bytes,
            modified_ns: None,
            root: None,
        };
        let reread = read_unchanged(to, &expect, |_| Ok(()))
            .map_err(|check| std::io::Error::other(check.detail().to_owned()))?;
        if reread != digest || !names(to, &out) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("the re-read of {} differs from the bytes written", to.display()),
            ));
        }
        Ok(identity)
    })();
    match filled {
        Ok(identity) => Ok(Copied { source, created: out, identity }),
        Err(error) => {
            if names_and_close(to, out) {
                let _ = fs::remove_file(to);
            }
            Err(error)
        }
    }
}

/// Set the xattr `name` to `value` on the file a handle holds.
#[cfg(unix)]
type SetXattr = fn(&fs::File, &[u8], &[u8]) -> std::io::Result<()>;

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn set_xattr(file: &fs::File, name: &[u8], value: &[u8]) -> std::io::Result<()> {
    Ok(rustix::fs::fsetxattr(file, name, value, rustix::fs::XattrFlags::empty())?)
}

/// Give the file `copy` holds every extended attribute of the file `source`
/// holds that [`carries`] names the user's, each set with `set`. A volume
/// without native xattrs keeps them in the file's `._` `AppleDouble`
/// companion, which macOS removes with the file, so a copy without them
/// would lose them once its source is removed. A volume that keeps no
/// xattrs has none to carry. A carried one the copy can't take fails the
/// copy, which keeps its source.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn carry_xattrs(source: &fs::File, copy: &fs::File, set: SetXattr) -> std::io::Result<()> {
    use rustix::fs::{fgetxattr, flistxattr};
    use rustix::io::Errno;

    let names = match sized(|buffer| flistxattr(source, buffer)) {
        Ok(names) => names,
        Err(errno) if [Errno::NOTSUP, Errno::OPNOTSUPP].contains(&errno) => return Ok(()),
        Err(errno) => return Err(errno.into()),
    };
    for name in names.split(|&byte| byte == 0).filter(|name| !name.is_empty() && carries(name)) {
        let value = sized(|buffer| fgetxattr(source, name, buffer))?;
        set(copy, name, &value)?;
    }
    Ok(())
}

/// Whether the xattr `name` is the user's, so a move carries it. Linux:
/// only the `user.*` namespace. `security.*`, `trusted.*` and `system.*`
/// (security-module labels, file capabilities, POSIX ACLs) belong to the
/// kernel and its security modules, so the copy takes its destination's, as
/// a plain `cp` leaves them.
#[cfg(target_os = "linux")]
fn carries(name: &[u8]) -> bool {
    name.starts_with(b"user.")
}

/// Whether the xattr `name` is the user's, so a move carries it. macOS:
/// every name but those the system owns, which the copy gets from the
/// system or not at all:
/// - `com.apple.system.*`, which the kernel keeps private (xnu
///   `xattr_protected`, `bsd/vfs/vfs_xattr.c`), the ACL among them;
/// - `com.apple.rootless` (System Integrity Protection) and
///   `com.apple.macl` (TCC), which only the system may set;
/// - `com.apple.root.installed`, whose `EPERM` copyfile(3) ignores
///   (copyfile.c, `XATTR_ROOT_INSTALLED_NAME`);
/// - `com.apple.provenance`, which the kernel writes on every file a process
///   creates, the copy included, and a user's write leaves unchanged.
///
/// copyfile(3) documents no protected list of its own; it skips
/// `com.apple.quarantine` only to reapply it through the quarantine API, so
/// here it is carried, and the copy stays quarantined.
#[cfg(target_os = "macos")]
fn carries(name: &[u8]) -> bool {
    const SYSTEM: [&[u8]; 4] = [
        b"com.apple.rootless",
        b"com.apple.macl",
        b"com.apple.root.installed",
        b"com.apple.provenance",
    ];
    !name.starts_with(b"com.apple.system.") && !SYSTEM.contains(&name)
}

/// Where the platform has no xattr calls nothing proves a copy carries them,
/// so the copy fails and its source stays.
#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn carry_xattrs(_source: &fs::File, _copy: &fs::File, _set: SetXattr) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "a copy can't carry extended attributes on this platform",
    ))
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn set_xattr(_file: &fs::File, _name: &[u8], _value: &[u8]) -> std::io::Result<()> {
    Err(std::io::ErrorKind::Unsupported.into())
}

/// What a sized xattr call fills: asked for the size first, then filled,
/// and asked again whenever the value grew in between: the fill answers
/// `ERANGE`, or, from a size-0 query on macOS, which passes no buffer, the
/// new size, longer than the buffer.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn sized(
    mut call: impl FnMut(&mut [u8]) -> rustix::io::Result<usize>,
) -> rustix::io::Result<Vec<u8>> {
    loop {
        let mut buffer = vec![0; call(&mut [])?];
        match call(&mut buffer) {
            Ok(len) if len <= buffer.len() => {
                buffer.truncate(len);
                return Ok(buffer);
            }
            Ok(_) => {}
            Err(errno) if errno == rustix::io::Errno::RANGE => {}
            Err(errno) => return Err(errno),
        }
    }
}

/// Remove the source of a verified [`copy_onto_new`], returning the copy's
/// identity. `from` first moves to an unguessable name beside it, so the
/// entry unlinked is the one found there, which must be the entry that was
/// read: an entry swapped in at `from` after the copy is never lost, but goes
/// back to `from` and stays, and the copy holds the bytes read. A source that
/// can't be removed goes back and keeps its bytes, and the copy is removed
/// while `to` still names the created file.
#[cfg(unix)]
fn remove_source(from: &Path, to: &Path, copied: Copied) -> std::io::Result<FileIdentity> {
    let Copied { source, created, identity } = copied;
    let drop_copy = |created| {
        if names_and_close(to, created) {
            let _ = fs::remove_file(to);
        }
    };
    // A plain rename: the name is unguessable, and this volume has no other.
    let aside = aside_of(from);
    match fs::rename(from, &aside) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(identity),
        Err(error) => {
            drop_copy(created);
            return Err(error);
        }
    }
    let put_back = || {
        rename_noreplace(&aside, from).map_err(|error| {
            std::io::Error::other(format!(
                "{} stays at {}: {error}",
                from.display(),
                aside.display()
            ))
        })
    };
    if !names_and_close(&aside, source) {
        return put_back().map(|()| identity);
    }
    if let Err(error) = fs::remove_file(&aside) {
        put_back()?;
        drop_copy(created);
        return Err(error);
    }
    let _ = sync_folder(from.parent().unwrap_or_else(|| Path::new("")));
    Ok(identity)
}

/// The hidden name [`remove_source`] moves the source at `from` to, beside
/// it, before unlinking it: `.pv-<uuid>.removing`, unguessable.
#[cfg(unix)]
fn aside_of(from: &Path) -> PathBuf {
    from.with_file_name(format!("{ASIDE_PREFIX}{}{ASIDE_SUFFIX}", Uuid::new_v4().simple()))
}

/// The hidden name [`restore_left_aside`] moves a source left aside to
/// before it puts it back at the `number`-th name [`put_back_name`] gives:
/// `.pv-<uuid>.restoring-<number>`, unguessable. It records that name
/// before a volume without a no-replace rename starts the copy there, as
/// a journal claims a destination, so the unfinished copy an interruption
/// leaves there is known for its own.
#[cfg(unix)]
fn restoring_of(from: &Path, number: u32) -> PathBuf {
    let id = Uuid::new_v4().simple();
    from.with_file_name(format!("{ASIDE_PREFIX}{id}{RESTORING_SUFFIX}{number}"))
}

const ASIDE_PREFIX: &str = ".pv-";
const ASIDE_SUFFIX: &str = ".removing";
const RESTORING_SUFFIX: &str = ".restoring-";

/// A hidden name [`aside_of`] or [`restoring_of`] gives.
#[derive(Clone, Copy)]
enum AsideName {
    /// [`aside_of`]'s.
    Removing,
    /// [`restoring_of`]'s, claiming the put-back name with this number.
    Restoring(u32),
}

impl AsideName {
    /// `name` read as one; `None` for any other name.
    fn of(name: &std::ffi::OsStr) -> Option<Self> {
        let (id, kind) = name.to_str()?.strip_prefix(ASIDE_PREFIX)?.split_at_checked(32)?;
        if !id.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')) {
            return None;
        }
        if kind == ASIDE_SUFFIX {
            return Some(Self::Removing);
        }
        let number = kind.strip_prefix(RESTORING_SUFFIX)?;
        if number.starts_with('0') || !number.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        number.parse().ok().map(Self::Restoring)
    }

    /// The put-back name's number it claims, if any. Windows moves by
    /// rename only and never looks for one.
    #[cfg_attr(not(unix), allow(dead_code))]
    const fn claimed(self) -> Option<u32> {
        match self {
            Self::Removing => None,
            Self::Restoring(number) => Some(number),
        }
    }
}

/// Whether `name` is one [`aside_of`] or [`restoring_of`] gives.
pub(crate) fn is_aside_name(name: &std::ffi::OsStr) -> bool {
    AsideName::of(name).is_some()
}

/// The `number`-th name a source left aside beside `from` is put back
/// under: `from` first, then [`layout::kept_name`]'s (`notes-2.txt`).
#[cfg(unix)]
fn put_back_name(from: &Path, number: u32) -> Option<PathBuf> {
    Some(from.with_file_name(layout::kept_name(from.file_name()?, number)))
}

/// The entries beside `from` an interruption of [`remove_source`] or
/// [`restore_left_aside`] may have left of the regular file `source` that
/// a move made by copy took from `from`: each name [`aside_of`] or
/// [`restoring_of`] gives there that is still `source`, reached below
/// `root` without following a link through a handle proven to hold
/// `source`'s recorded identity, size and modification time, with the
/// put-back name's number it claimed, if any. Anything else under such a
/// name is the user's.
#[cfg(unix)]
fn proven_asides(
    root: &Path,
    from: &Path,
    source: &EntryEvidence,
) -> Vec<(PathBuf, Opened, Option<u32>)> {
    let Some(folder) = from.parent() else { return Vec::new() };
    let Ok(entries) = fs::read_dir(folder) else { return Vec::new() };
    let root = NativePath::from_path(root);
    let expect = Expect { root: Some(&root), ..Expect::recorded(&source.fingerprint) };
    entries
        .flatten()
        .map(|entry| entry.file_name())
        .filter_map(|name| AsideName::of(&name).map(|kind| (name, kind.claimed())))
        .filter_map(|(name, claimed)| {
            let aside = folder.join(name);
            open_unchanged(&aside, &expect).ok().map(|opened| (aside, opened, claimed))
        })
        .collect()
}

/// The no-follow metadata of `copy` when it is a regular file, another
/// entry than the file `held` holds (`found`), with exactly its length and
/// bytes, `held` read from its start.
#[cfg(unix)]
fn copy_of(copy: &Path, held: &mut fs::File, found: &fs::Metadata) -> Option<fs::Metadata> {
    let mut original = open_no_follow(copy).ok()?;
    let whole = original.metadata().ok()?;
    (whole.is_file()
        && whole.len() == found.len()
        && !super::same_entry(found, &whole)
        && starts_with(&mut original, held, found.len()))
    .then_some(whole)
}

/// Remove what an interruption of [`remove_source`] or
/// [`restore_left_aside`] left of the regular file `source` that a move
/// made by copy took from `from` to `copy`: the source moved aside beside
/// `from` and never unlinked ([`proven_asides`]). One is removed only when
/// `copy`, another regular file, holds exactly its bytes: removing it loses
/// nothing. One a put-back had claimed a name for takes along the
/// unfinished copy an interruption left there, which holds nothing it
/// doesn't ([`remove_unfinished_copy`]). It is removed only while its name
/// still names that handle's file. Anything else stays, whatever its name.
/// Returns whether it was removed.
#[cfg(unix)]
pub(crate) fn remove_left_aside(
    root: &Path,
    from: &Path,
    source: &EntryEvidence,
    copy: &Path,
) -> bool {
    for (aside, Opened { file: mut held, below, .. }, claimed) in proven_asides(root, from, source)
    {
        let Ok(found) = held.metadata() else { continue };
        if copy_of(copy, &mut held, &found).is_none()
            || below.is_some_and(|below| !below.holds_path())
        {
            continue;
        }
        if let Some(at) = claimed.and_then(|number| put_back_name(from, number)) {
            if at != copy && fs::symlink_metadata(&at).is_ok() {
                remove_unfinished_copy(&at, &aside);
            }
        }
        if names_and_close(&aside, held) && fs::remove_file(&aside).is_ok() {
            let _ = sync_folder(from.parent().unwrap_or_else(|| Path::new("")));
            return true;
        }
    }
    false
}

/// Windows moves by rename only and leaves no source aside.
#[cfg(not(unix))]
pub(crate) const fn remove_left_aside(
    _root: &Path,
    _from: &Path,
    _source: &EntryEvidence,
    _copy: &Path,
) -> bool {
    false
}

/// Put back what an interruption of [`remove_source`] left of the regular
/// file `source` that a move made by copy took from `from`, where no copy
/// holds its bytes any more: the source moved aside beside `from`, proven
/// to be it ([`proven_asides`]). It goes back to the first free name
/// [`put_back_name`] gives, `from` first, then `notes-2.txt` and on, with
/// a no-replace rename. Before each it is moved to a hidden name claiming
/// that one ([`restoring_of`]), since on a volume without a no-replace
/// rename the put-back is a copy that an interruption may leave unfinished
/// there: resumed, the put-back removes that unfinished copy, which holds
/// nothing the source doesn't ([`remove_unfinished_copy`]), and goes on
/// there, never past it. A taken name holding exactly its bytes, such as
/// the complete copy an interrupted put-back made, already holds all of
/// it, and the source is removed; so does a claimed name that is a second
/// link of it, which a link-and-unlink put-back stopped before its unlink
/// left, and the hidden name goes. It never stays hidden. Returns where it
/// is now; `None` when no entry beside `from` is proven to be the source.
///
/// # Errors
/// The rename's error, the source still at a hidden name.
#[cfg(unix)]
pub(crate) fn restore_left_aside(
    root: &Path,
    from: &Path,
    source: &EntryEvidence,
) -> std::io::Result<Option<PathBuf>> {
    restore_left_aside_with(root, from, source, rename_noreplace)
}

/// A rename that never replaces; tests stand in one closed mid copy.
#[cfg(unix)]
type NoReplace = fn(&Path, &Path) -> std::io::Result<()>;

/// [`restore_left_aside`], putting the source back with `rename_noreplace`.
#[cfg(unix)]
fn restore_left_aside_with(
    root: &Path,
    from: &Path,
    source: &EntryEvidence,
    rename_noreplace: NoReplace,
) -> std::io::Result<Option<PathBuf>> {
    let Some((mut aside, Opened { file, below, .. }, mut claimed)) =
        proven_asides(root, from, source).into_iter().next()
    else {
        return Ok(None);
    };
    if below.is_some_and(|below| !below.holds_path()) {
        return Ok(None);
    }
    // Closed first: a volume may refuse to rename an open entry (smbfs).
    drop(file);
    let mut number = claimed.unwrap_or(1);
    loop {
        let at = put_back_name(from, number).ok_or(std::io::ErrorKind::InvalidInput)?;
        match fs::symlink_metadata(&at) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if claimed != Some(number) {
                    // A plain rename: the name is unguessable.
                    let claim = restoring_of(from, number);
                    fs::rename(&aside, &claim)?;
                    (aside, claimed) = (claim, Some(number));
                }
                match rename_noreplace(&aside, &at) {
                    Ok(()) => return Ok(Some(at)),
                    Err(error) if error.kind() != std::io::ErrorKind::AlreadyExists => {
                        return Err(error);
                    }
                    Err(_) => {}
                }
            }
            Err(error) => return Err(error),
            Ok(_) => {
                // A link-and-unlink put-back stopped before it removed the
                // hidden name: the claimed name is already the source.
                if claimed == Some(number) && second_link(&aside, &at) {
                    fs::remove_file(&aside)?;
                    let _ = sync_folder(from.parent().unwrap_or_else(|| Path::new("")));
                    return Ok(Some(at));
                }
                if remove_copied(&aside, &at, |_, _| true) {
                    let _ = sync_folder(from.parent().unwrap_or_else(|| Path::new("")));
                    return Ok(Some(at));
                }
                if claimed == Some(number) && remove_unfinished_copy(&at, &aside) {
                    continue;
                }
            }
        }
        number = number.checked_add(1).ok_or(std::io::ErrorKind::AlreadyExists)?;
    }
}

/// Windows moves by rename only and leaves no source aside.
#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
pub(crate) const fn restore_left_aside(
    _root: &Path,
    _from: &Path,
    _source: &EntryEvidence,
) -> std::io::Result<Option<PathBuf>> {
    Ok(None)
}

/// Remove `aside` when it is what an interruption of [`remove_source`]
/// left of a partial copy [`install`] put at `copy` by copy, beside it: a
/// regular file, never a link, under a name [`aside_of`] gives, and `copy`,
/// another regular file, holds exactly its bytes and the modification time
/// [`copy_onto_new`] gives a copy, its source's. Removing it loses
/// nothing. It is removed only while its name still names the file
/// compared. Returns whether it was removed.
#[cfg(unix)]
pub(crate) fn remove_aside_of_copy(aside: &Path, copy: &Path) -> bool {
    aside.file_name().is_some_and(is_aside_name)
        && remove_copied(aside, copy, |found, whole| whole.modified().ok() == found.modified().ok())
}

/// Remove the regular file `aside`, never a link, when `copy`, another
/// regular file, holds exactly its bytes ([`copy_of`]) and `also` holds of
/// their metadata, `aside`'s first; only while its name still names the
/// file compared. Returns whether it was removed.
#[cfg(unix)]
fn remove_copied(
    aside: &Path,
    copy: &Path,
    also: impl FnOnce(&fs::Metadata, &fs::Metadata) -> bool,
) -> bool {
    let Ok(mut held) = open_no_follow(aside) else { return false };
    let Ok(found) = held.metadata() else { return false };
    found.is_file()
        && copy_of(copy, &mut held, &found).is_some_and(|whole| also(&found, &whole))
        && names_and_close(aside, held)
        && fs::remove_file(aside).is_ok()
}

/// Windows installs by rename only and leaves no partial aside.
#[cfg(not(unix))]
pub(crate) const fn remove_aside_of_copy(_aside: &Path, _copy: &Path) -> bool {
    false
}

/// Remove `candidate` when it is an unfinished copy of the regular file
/// `of`: a regular file, never a link, holding no more bytes than `of` and
/// exactly its first ones, which is what an interrupted [`copy_onto_new`]
/// of `of` leaves under its final name. It holds nothing `of` doesn't, so
/// removing it loses nothing. It is compared through one handle and removed
/// only while `candidate` still names that handle's file; anything else
/// stays. Returns whether it was removed.
#[cfg(unix)]
pub(crate) fn remove_unfinished_copy(candidate: &Path, of: &Path) -> bool {
    let (Ok(mut held), Ok(mut original)) = (open_no_follow(candidate), open_no_follow(of)) else {
        return false;
    };
    let (Ok(found), Ok(whole)) = (held.metadata(), original.metadata()) else { return false };
    if !found.is_file()
        || !whole.is_file()
        || found.len() > whole.len()
        || super::same_entry(&found, &whole)
        || !starts_with(&mut original, &mut held, found.len())
    {
        return false;
    }
    names(candidate, &held) && fs::remove_file(candidate).is_ok()
}

/// Windows installs and moves by rename only and makes no unfinished copy.
#[cfg(not(unix))]
pub(crate) const fn remove_unfinished_copy(_candidate: &Path, _of: &Path) -> bool {
    false
}

#[cfg(unix)]
fn open_no_follow(path: &Path) -> std::io::Result<fs::File> {
    use rustix::fs::{open, Mode, OFlags};
    let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
    Ok(fs::File::from(open(path, flags, Mode::empty())?))
}

/// Whether the first `len` bytes of `whole` are those `prefix` holds.
#[cfg(unix)]
fn starts_with(whole: &mut fs::File, prefix: &mut fs::File, len: u64) -> bool {
    use std::io::Read as _;
    const CHUNK: usize = 64 * 1024;
    let (mut left, mut right) = (vec![0_u8; CHUNK], vec![0_u8; CHUNK]);
    let mut remaining = len;
    while remaining > 0 {
        let step = usize::try_from(remaining).map_or(CHUNK, |rest| rest.min(CHUNK));
        if whole.read_exact(&mut left[..step]).is_err()
            || prefix.read_exact(&mut right[..step]).is_err()
            || left[..step] != right[..step]
        {
            return false;
        }
        remaining -= step as u64;
    }
    true
}

/// Whether `path` names the file `handle` holds open right now.
#[cfg(unix)]
fn names(path: &Path, handle: &fs::File) -> bool {
    match (fs::symlink_metadata(path), handle.metadata()) {
        (Ok(named), Ok(held)) => super::same_entry(&held, &named),
        _ => false,
    }
}

/// [`names`], closing `handle`. Each caller removes `path` once this holds:
/// the handle is closed first, since a volume may refuse to remove an entry
/// that is still open (macOS smbfs answers `EBUSY`), and closing it frees no
/// inode, as the entry is still linked under `path`.
#[cfg(unix)]
fn names_and_close(path: &Path, handle: fs::File) -> bool {
    let named = names(path, &handle);
    drop(handle);
    named
}

/// Rename the folder `from` over the empty `placeholder` this rename created
/// at `to` and holds open. Rename replaces only an empty folder, so a file
/// another process put in the placeholder fails it with `ENOTEMPTY`, and a
/// file in its place with `ENOTDIR`; either is reported as `to` taken,
/// nothing moved. A failed rename removes the placeholder while it is still
/// that folder and empty, closing it first ([`names_and_close`]). The open
/// handle keeps the placeholder's inode from being reused until then, so a
/// folder another process made in its place never reads as it: ext4 gives a
/// just-freed inode number to the next entry created.
///
/// It stays open during the rename, which is when the placeholder may be
/// swapped: closed before it, nothing would tell a folder made under its
/// freed number from it afterwards. A volume may refuse to rename over an
/// open folder (POSIX allows `EBUSY`); that fails closed, with nothing moved
/// and the placeholder removed.
#[cfg(unix)]
fn over_placeholder(from: &Path, to: &Path, placeholder: fs::File) -> std::io::Result<()> {
    use std::io::ErrorKind;

    let Err(error) = fs::rename(from, to) else {
        return Ok(());
    };
    // Only while it lists nothing: macOS also removes a folder holding only
    // `._` AppleDouble files, and them with it.
    if fs::read_dir(to).is_ok_and(|mut entries| entries.next().is_none())
        && names_and_close(to, placeholder)
    {
        let _ = fs::remove_dir(to);
    }
    Err(match error.kind() {
        ErrorKind::DirectoryNotEmpty | ErrorKind::NotADirectory | ErrorKind::AlreadyExists => {
            std::io::Error::new(
                ErrorKind::AlreadyExists,
                format!("{} was taken while it was being claimed ({error})", to.display()),
            )
        }
        _ => error,
    })
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::*;

    /// [`without_noreplace`] as a [`Rename`](crate::apply::files::Rename).
    #[cfg(unix)]
    fn without_primitive(from: &Path, to: &Path) -> io::Result<()> {
        without_noreplace(from, to).map(drop)
    }

    /// `View/` holding one file, and the name beside it a rename targets.
    fn view_in(temp: &tempfile::TempDir) -> (PathBuf, PathBuf) {
        let view = temp.path().join("View");
        fs::create_dir(&view).unwrap();
        fs::write(view.join("Light_001.fits"), b"old view").unwrap();
        (view, temp.path().join("View (previous)"))
    }

    fn kept(view: &Path) {
        assert_eq!(fs::read(view.join("Light_001.fits")).unwrap(), b"old view", "the old View");
    }

    #[test]
    fn a_folder_rename_refuses_an_empty_destination_folder() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        fs::create_dir(&previous).unwrap();
        let error = rename_noreplace(&view, &previous).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        kept(&view);
        assert_eq!(fs::read_dir(&previous).unwrap().count(), 0);
    }

    #[test]
    fn a_folder_rename_refuses_a_destination_folder_that_holds_files() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        fs::create_dir(&previous).unwrap();
        fs::write(previous.join("theirs.txt"), b"theirs").unwrap();
        let error = rename_noreplace(&view, &previous).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        kept(&view);
        assert_eq!(fs::read(previous.join("theirs.txt")).unwrap(), b"theirs");
    }

    #[test]
    fn a_folder_rename_onto_a_free_name_moves_the_folder() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        rename_noreplace(&view, &previous).unwrap();
        assert!(!view.exists());
        kept(&previous);
    }

    /// A plain rename replaces an empty folder on Unix: why no check before
    /// it is safe, and why a placeholder of its own can be renamed over.
    #[cfg(unix)]
    #[test]
    fn a_plain_rename_replaces_an_empty_folder() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        fs::create_dir(&previous).unwrap();
        fs::rename(&view, &previous).unwrap();
        kept(&previous);
    }

    #[cfg(unix)]
    #[test]
    fn without_the_primitive_a_folder_moves_onto_a_free_name() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        without_noreplace(&view, &previous).unwrap();
        assert!(!view.exists());
        kept(&previous);
    }

    #[cfg(unix)]
    #[test]
    fn without_the_primitive_a_folder_rename_refuses_an_existing_destination() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        fs::create_dir(&previous).unwrap();
        let error = without_noreplace(&view, &previous).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "onto an empty folder: {error}");
        fs::write(previous.join("theirs.txt"), b"theirs").unwrap();
        let error = without_noreplace(&view, &previous).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "onto a folder with files: {error}");
        kept(&view);
        assert_eq!(fs::read(previous.join("theirs.txt")).unwrap(), b"theirs");
    }

    /// `to` claimed with an empty placeholder held open, as
    /// [`without_noreplace`] does.
    #[cfg(unix)]
    fn claimed(to: &Path) -> fs::File {
        fs::create_dir(to).unwrap();
        open_no_follow(to).unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn a_file_put_in_the_placeholder_refuses_the_rename_and_nothing_is_lost() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        let placeholder = claimed(&previous);
        fs::write(previous.join("theirs.txt"), b"theirs").unwrap();
        let error = over_placeholder(&view, &previous, placeholder).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        kept(&view);
        assert_eq!(fs::read(previous.join("theirs.txt")).unwrap(), b"theirs");
    }

    #[cfg(unix)]
    #[test]
    fn a_file_in_place_of_the_placeholder_refuses_the_rename_and_stays() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        let placeholder = claimed(&previous);
        fs::remove_dir(&previous).unwrap();
        fs::write(&previous, b"theirs").unwrap();
        let error = over_placeholder(&view, &previous, placeholder).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        kept(&view);
        assert_eq!(fs::read(&previous).unwrap(), b"theirs");
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_rename_removes_only_its_own_placeholder() {
        let temp = tempfile::tempdir().unwrap();
        let (gone, to) = (temp.path().join("gone"), temp.path().join("to"));
        let placeholder = claimed(&to);
        let error = over_placeholder(&gone, &to, placeholder).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound, "{error}");
        assert!(!to.exists(), "its own empty placeholder is removed");

        let placeholder = claimed(&to);
        fs::remove_dir(&to).unwrap();
        claimed(&to);
        over_placeholder(&gone, &to, placeholder).unwrap_err();
        assert!(to.is_dir(), "another process's folder stays");
    }

    #[cfg(unix)]
    #[test]
    fn without_the_primitive_a_file_moves_only_onto_a_free_name() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = (temp.path().join("a.fits"), temp.path().join("b.fits"));
        fs::write(&from, b"ours").unwrap();
        fs::write(&to, b"theirs").unwrap();
        let error = without_noreplace(&from, &to).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        assert_eq!(fs::read(&to).unwrap(), b"theirs");
        fs::remove_file(&to).unwrap();
        without_noreplace(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read(&to).unwrap(), b"ours");
    }

    /// A source file and the free name a move targets.
    #[cfg(unix)]
    fn file_in(temp: &tempfile::TempDir) -> (PathBuf, PathBuf) {
        let (from, to) = (temp.path().join("notes.txt"), temp.path().join("moved.txt"));
        fs::write(&from, b"the user's notes").unwrap();
        (from, to)
    }

    #[cfg(unix)]
    #[test]
    fn a_verified_copy_moves_the_bytes_and_the_modification_time() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        let modified = fs::metadata(&from).unwrap().modified().unwrap();
        let copied = copy_onto_new(&from, &to).unwrap();
        remove_source(&from, &to, copied).unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read(&to).unwrap(), b"the user's notes");
        assert_eq!(fs::metadata(&to).unwrap().modified().unwrap(), modified);
    }

    #[cfg(unix)]
    #[test]
    fn a_verified_copy_never_replaces_an_existing_file() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        fs::write(&to, b"theirs").unwrap();
        let Err(error) = copy_onto_new(&from, &to) else { panic!("not refused") };
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        assert_eq!(fs::read(&from).unwrap(), b"the user's notes");
        assert_eq!(fs::read(&to).unwrap(), b"theirs");
    }

    /// Interrupted after the copy was verified, before the source was
    /// removed: both hold the bytes, and a retry replaces and loses nothing.
    #[cfg(unix)]
    #[test]
    fn a_retry_after_the_copy_but_before_the_source_removal_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        drop(copy_onto_new(&from, &to).unwrap());
        for retry in [rename_noreplace as fn(&Path, &Path) -> io::Result<()>, without_primitive] {
            let error = retry(&from, &to).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
            assert_eq!(fs::read(&from).unwrap(), b"the user's notes");
            assert_eq!(fs::read(&to).unwrap(), b"the user's notes");
        }
    }

    /// Interrupted while copying: the unfinished copy at `to` and the intact
    /// source both stay, and a retry replaces and loses nothing.
    #[cfg(unix)]
    #[test]
    fn a_retry_after_an_interrupted_copy_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        fs::write(&to, b"the user's").unwrap();
        for retry in [rename_noreplace as fn(&Path, &Path) -> io::Result<()>, without_primitive] {
            let error = retry(&from, &to).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
            assert_eq!(fs::read(&from).unwrap(), b"the user's notes");
            assert_eq!(fs::read(&to).unwrap(), b"the user's");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_copy_removes_only_the_file_it_created_and_keeps_the_source() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        fs::set_permissions(&from, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::File::open(&from).is_ok() {
            // A volume mounted without owners (exFAT `noowners`) ignores the
            // mode, so the source can't be made unreadable there.
            eprintln!("skipped: {} ignores file modes", temp.path().display());
            return;
        }
        let failed = copy_onto_new(&from, &to);
        fs::set_permissions(&from, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(failed.is_err(), "the source can't be read");
        assert!(!to.exists(), "the created file is removed");
        assert_eq!(fs::read(&from).unwrap(), b"the user's notes");
    }

    #[cfg(unix)]
    #[test]
    fn a_source_replaced_after_the_copy_is_left_alone() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        let copied = copy_onto_new(&from, &to).unwrap();
        fs::remove_file(&from).unwrap();
        fs::write(&from, b"another file").unwrap();
        remove_source(&from, &to, copied).unwrap();
        assert_eq!(fs::read(&from).unwrap(), b"another file");
        assert_eq!(fs::read(&to).unwrap(), b"the user's notes");
    }

    /// vmv9s: interrupted on the copy fallback after the source moved aside
    /// ([`aside_of`]) and before it was unlinked. The source at its hidden
    /// name is removed once proven to be the source whose bytes the copy
    /// holds; a file under such a name that isn't the source, or a copy
    /// that differs from it, leaves everything in place.
    #[cfg(unix)]
    #[test]
    fn a_source_left_aside_is_removed_only_once_proven() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        let source = super::super::observe_source(temp.path(), &from).unwrap();
        drop(copy_onto_new(&from, &to).unwrap());
        let theirs = aside_of(&from);
        fs::copy(&from, &theirs).unwrap();
        let aside = aside_of(&from);
        fs::rename(&from, &aside).unwrap();
        let other = temp.path().join("other.txt");
        fs::write(&other, b"the user's NOTES").unwrap();

        assert!(!remove_left_aside(temp.path(), &from, &source, &other), "the copy differs");
        assert!(aside.exists());
        assert!(remove_left_aside(temp.path(), &from, &source, &to));
        assert!(!aside.exists(), "the proven source is removed");
        assert!(!remove_left_aside(temp.path(), &from, &source, &to));
        assert_eq!(fs::read(&theirs).unwrap(), b"the user's notes", "their file stays");
        assert_eq!(fs::read(&to).unwrap(), b"the user's notes");
    }

    /// zx3l2: interrupted on the copy fallback after the source moved aside
    /// and before it was unlinked, its copy then changed. The source proven
    /// to be the recorded file goes back to its name; a file under such a
    /// name that isn't the source stays where it is.
    #[cfg(unix)]
    #[test]
    fn a_source_left_aside_its_copy_no_longer_holds_goes_back_to_its_name() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        let source = super::super::observe_source(temp.path(), &from).unwrap();
        drop(copy_onto_new(&from, &to).unwrap());
        let theirs = aside_of(&from);
        fs::copy(&from, &theirs).unwrap();
        let aside = aside_of(&from);
        fs::rename(&from, &aside).unwrap();
        fs::write(&to, b"the user's edit").unwrap();

        assert!(!remove_left_aside(temp.path(), &from, &source, &to), "the copy differs");
        assert_eq!(restore_left_aside(temp.path(), &from, &source).unwrap(), Some(from.clone()));
        assert!(!aside.exists(), "nothing stays hidden");
        assert_eq!(fs::read(&from).unwrap(), b"the user's notes");
        assert_eq!(restore_left_aside(temp.path(), &from, &source).unwrap(), None);
        assert_eq!(fs::read(&theirs).unwrap(), b"the user's notes", "their file stays");
        assert_eq!(fs::read(&to).unwrap(), b"the user's edit");
    }

    /// zx3l2: the source left aside finds its name taken. A file there
    /// holding exactly its bytes, the copy an interrupted put-back made,
    /// already holds all of it, so it is removed; anything else keeps the
    /// name, and the source takes a visible one beside it.
    #[cfg(unix)]
    #[test]
    fn a_source_left_aside_whose_name_was_taken_never_stays_hidden() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        let source = super::super::observe_source(temp.path(), &from).unwrap();
        drop(copy_onto_new(&from, &to).unwrap());
        let aside = aside_of(&from);
        fs::rename(&from, &aside).unwrap();
        fs::remove_file(&to).unwrap();
        fs::write(&from, b"another file").unwrap();
        let visible = temp.path().join("notes-2.txt");
        fs::write(&visible, b"theirs too").unwrap();

        let restored = restore_left_aside(temp.path(), &from, &source).unwrap();
        let at = temp.path().join("notes-3.txt");
        assert_eq!(restored, Some(at.clone()));
        assert!(!aside.exists(), "nothing stays hidden");
        assert_eq!(fs::read(&at).unwrap(), b"the user's notes");
        assert_eq!(fs::read(&from).unwrap(), b"another file", "their file keeps the name");
        assert_eq!(fs::read(&visible).unwrap(), b"theirs too");

        let source = super::super::observe_source(temp.path(), &at).unwrap();
        let aside = aside_of(&at);
        fs::rename(&at, &aside).unwrap();
        fs::copy(&aside, &at).unwrap();
        assert_eq!(restore_left_aside(temp.path(), &at, &source).unwrap(), Some(at.clone()));
        assert!(!aside.exists(), "the copy at its name holds all of it");
        assert_eq!(fs::read(&at).unwrap(), b"the user's notes");
    }

    /// The copy fallback of a put-back with `PlateVault` closing mid copy:
    /// a file created at `to` holding the first half of `from`'s bytes.
    /// `to` taken fails as the no-replace rename does.
    #[cfg(unix)]
    fn closed_mid_copy(from: &Path, to: &Path) -> io::Result<()> {
        let bytes = fs::read(from)?;
        let mut out = OpenOptions::new().write(true).create_new(true).open(to)?;
        out.write_all(&bytes[..bytes.len() / 2])?;
        panic!("PlateVault closed mid copy");
    }

    /// `F4ReviewCustody` on #1879 (3): a put-back on a volume with hard
    /// links but no no-replace rename links the claimed name and then
    /// unlinks the hidden one; `PlateVault` closing between the two leaves
    /// both names on one file. The resumed put-back ends there: only the
    /// claimed name stays, holding the bytes, and nothing stays hidden.
    #[cfg(unix)]
    #[test]
    fn a_put_back_closed_between_its_link_and_unlink_ends_at_its_name() {
        let temp = tempfile::tempdir().unwrap();
        let (from, _) = file_in(&temp);
        let source = super::super::observe_source(temp.path(), &from).unwrap();
        let claim = restoring_of(&from, 1);
        fs::rename(&from, &claim).unwrap();
        fs::hard_link(&claim, &from).unwrap();

        assert_eq!(restore_left_aside(temp.path(), &from, &source).unwrap(), Some(from.clone()));
        let mut names: Vec<_> = fs::read_dir(temp.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["notes.txt"], "one name, nothing hidden");
        assert_eq!(fs::read(&from).unwrap(), b"the user's notes");
    }

    /// `F4ReviewCustody` on #1879 (2): a source put back where its name was
    /// taken, on a volume where the put-back is a copy, with `PlateVault`
    /// closing mid copy. The next put-back removes the unfinished copy at
    /// the name it took and finishes there, so no truncated file is left in
    /// sight looking like the user's, and nothing stays hidden.
    #[cfg(unix)]
    #[test]
    fn a_put_back_closed_mid_copy_leaves_no_unfinished_copy_in_sight() {
        let temp = tempfile::tempdir().unwrap();
        let (from, _) = file_in(&temp);
        let source = super::super::observe_source(temp.path(), &from).unwrap();
        fs::rename(&from, aside_of(&from)).unwrap();
        fs::write(&from, b"another file").unwrap();
        let closed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            restore_left_aside_with(temp.path(), &from, &source, closed_mid_copy)
        }));
        assert!(closed.is_err(), "closed mid copy");

        let visible = temp.path().join("notes-2.txt");
        assert_eq!(restore_left_aside(temp.path(), &from, &source).unwrap(), Some(visible.clone()));
        assert_eq!(fs::read(&visible).unwrap(), b"the user's notes");
        assert!(!temp.path().join("notes-3.txt").exists(), "no unfinished copy stays in sight");
        let hidden: Vec<_> = fs::read_dir(temp.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name())
            .filter(|name| name.to_string_lossy().starts_with(".pv-"))
            .collect();
        assert!(hidden.is_empty(), "nothing stays hidden: {hidden:?}");
        assert_eq!(fs::read(&from).unwrap(), b"another file");
    }

    /// zx3l2: a partial installed by copy, interrupted after the copy was
    /// verified and before the partial was unlinked, leaves the partial
    /// moved aside beside the copy. It is removed once the copy holds its
    /// bytes and time; one beside a copy that differs, a link under such a
    /// name, or a file under another name stays.
    #[cfg(unix)]
    #[test]
    fn a_partial_left_aside_is_removed_only_beside_its_copy() {
        let temp = tempfile::tempdir().unwrap();
        let (partial, file) = (temp.path().join(".pv-x-1-abc.partial"), temp.path().join("a.fits"));
        fs::write(&partial, b"SIMPLE  =                    T").unwrap();
        drop(copy_onto_new(&partial, &file).unwrap());
        let aside = aside_of(&partial);
        fs::rename(&partial, &aside).unwrap();
        let other = temp.path().join("b.fits");
        fs::write(&other, b"SIMPLE  =                    F").unwrap();
        let link = aside_of(&partial);
        std::os::unix::fs::symlink(&file, &link).unwrap();
        let named = temp.path().join("a copy.fits");
        fs::copy(&aside, &named).unwrap();

        assert!(!remove_aside_of_copy(&aside, &other), "the copy differs");
        assert!(!remove_aside_of_copy(&link, &file), "a link is never taken for one");
        assert!(!remove_aside_of_copy(&named, &file), "not a name an aside takes");
        assert!(remove_aside_of_copy(&aside, &file));
        assert!(!aside.exists());
        assert!(fs::symlink_metadata(&link).is_ok() && named.exists());
        assert_eq!(fs::read(&file).unwrap(), b"SIMPLE  =                    T");
    }

    /// An xattr name of the user's on this platform.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    const USERS: &str =
        if cfg!(target_os = "linux") { "user.platevault" } else { "com.platevault" };

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn a_copy_that_cant_take_a_carried_xattr_fails_and_keeps_the_source() {
        fn refuse(_file: &fs::File, _name: &[u8], _value: &[u8]) -> io::Result<()> {
            Err(rustix::io::Errno::PERM.into())
        }
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = file_in(&temp);
        // The precondition, not the behaviour under test: tmpfs before Linux
        // 6.6 keeps no `user.*` xattrs.
        match rustix::fs::setxattr(&from, USERS, b"tagged", rustix::fs::XattrFlags::empty()) {
            Ok(()) => {}
            Err(errno)
                if [rustix::io::Errno::NOTSUP, rustix::io::Errno::OPNOTSUPP].contains(&errno) =>
            {
                eprintln!("skipped: {} keeps no {USERS} xattr ({errno})", temp.path().display());
                return;
            }
            Err(errno) => panic!("{USERS} can't be set on {}: {errno}", from.display()),
        }
        let Err(error) = copy_onto_new_with(&from, &to, refuse) else { panic!("not refused") };
        assert_eq!(error.raw_os_error(), Some(rustix::io::Errno::PERM.raw_os_error()), "{error}");
        assert!(!to.exists(), "the copy is removed");
        assert_eq!(fs::read(&from).unwrap(), b"the user's notes");
        let mut value = [0_u8; 16];
        let len = rustix::fs::getxattr(&from, USERS, &mut value[..]).unwrap();
        assert_eq!(&value[..len], b"tagged", "the source keeps its xattr");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn only_the_user_namespace_is_carried() {
        assert!(carries(b"user.platevault"));
        for name in ["security.selinux", "trusted.overlay.opaque", "system.posix_acl_access"] {
            assert!(!carries(name.as_bytes()), "{name}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn every_name_but_the_systems_is_carried() {
        for name in
            ["com.platevault", "com.apple.metadata:_kMDItemUserTags", "com.apple.quarantine"]
        {
            assert!(carries(name.as_bytes()), "{name}");
        }
        for name in [
            "com.apple.system.Security",
            "com.apple.rootless",
            "com.apple.macl",
            "com.apple.root.installed",
            "com.apple.provenance",
        ] {
            assert!(!carries(name.as_bytes()), "{name}");
        }
    }

    /// A value that grows after its size-0 query is asked for again, never
    /// carried empty.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn a_value_that_grew_since_its_size_was_asked_is_read_again() {
        let mut answers = [Ok(0), Ok(6), Ok(6)].into_iter();
        let value = sized(|buffer| {
            answers.next().unwrap_or_else(|| {
                buffer.copy_from_slice(b"tagged");
                Ok(6)
            })
        })
        .unwrap();
        assert_eq!(value, b"tagged");
    }

    /// Apply's move of a ticked foreign file from `View (previous)/` into the
    /// new `View/`, and its refusal where the new View holds the name.
    #[cfg(unix)]
    #[test]
    fn apply_moves_a_ticked_foreign_file_and_never_over_an_entry() {
        use crate::apply::files::{foreign_files, move_foreign};
        use crate::{ForeignItem, ForeignItemFailure, ForeignItemState};

        let temp = tempfile::tempdir().unwrap();
        let (previous, view) = (temp.path().join("View (previous)"), temp.path().join("View"));
        fs::create_dir_all(previous.join("notes")).unwrap();
        fs::create_dir(&view).unwrap();
        fs::write(previous.join("notes/session.txt"), b"the user's notes").unwrap();
        // macOS also writes `._` AppleDouble files beside these on exFAT.
        let (path, evidence) = foreign_files(&previous, &std::collections::BTreeSet::new())
            .unwrap()
            .into_iter()
            .find(|(path, _)| path == Path::new("notes/session.txt"))
            .unwrap();
        let item = ForeignItem {
            seq: 0,
            path: NativePath::from_path(&path),
            evidence,
            ticked: true,
            state: ForeignItemState::Pending,
            reason: None,
        };

        let none = std::collections::BTreeSet::new();
        fs::create_dir(view.join("notes")).unwrap();
        fs::write(view.join("notes/session.txt"), b"placed").unwrap();
        let refused = move_foreign(&previous, &view, &none, &item, false);
        assert_eq!(
            (refused.state, refused.reason),
            (ForeignItemState::Failed, Some(ForeignItemFailure::NameTaken)),
            "{refused:?}"
        );
        assert_eq!(fs::read(view.join("notes/session.txt")).unwrap(), b"placed");
        assert_eq!(fs::read(previous.join("notes/session.txt")).unwrap(), b"the user's notes");

        fs::remove_file(view.join("notes/session.txt")).unwrap();
        let placed = std::collections::BTreeSet::from([PathBuf::from("notes/session.txt")]);
        let refused = move_foreign(&previous, &view, &placed, &item, false);
        assert_eq!(
            (refused.state, refused.reason),
            (ForeignItemState::Failed, Some(ForeignItemFailure::NameTaken)),
            "a placed name: {refused:?}"
        );
        assert!(!view.join("notes/session.txt").exists());

        let moved = move_foreign(&previous, &view, &none, &item, false);
        assert_eq!(moved.state, ForeignItemState::Moved, "{moved:?}");
        assert!(!previous.join("notes/session.txt").exists());
        assert_eq!(fs::read(view.join("notes/session.txt")).unwrap(), b"the user's notes");
    }

    /// nfsgg, e6tgr: where a file moves as a verified copy (macOS exFAT), a
    /// resumed move whose destination this Apply's journal claimed removes
    /// the unfinished copy an interruption left in the new View and moves
    /// again, and one whose source is gone accepts the reviewed bytes there
    /// though the copy has an identity of its own. Without the claim
    /// (5u6x7), whatever is there stays and the name is taken.
    #[cfg(unix)]
    #[test]
    fn a_resumed_foreign_move_redoes_an_unfinished_copy_and_accepts_a_finished_one() {
        use crate::apply::files::{foreign_files, move_foreign};
        use crate::{ForeignItem, ForeignItemState};

        let temp = tempfile::tempdir().unwrap();
        let (previous, view) = (temp.path().join("View (previous)"), temp.path().join("View"));
        fs::create_dir_all(previous.join("notes")).unwrap();
        fs::create_dir_all(view.join("notes")).unwrap();
        fs::write(previous.join("notes/session.txt"), b"the user's notes").unwrap();
        let (path, evidence) = foreign_files(&previous, &std::collections::BTreeSet::new())
            .unwrap()
            .into_iter()
            .find(|(path, _)| path == Path::new("notes/session.txt"))
            .unwrap();
        let item = ForeignItem {
            seq: 0,
            path: NativePath::from_path(&path),
            evidence,
            ticked: true,
            state: ForeignItemState::Pending,
            reason: None,
        };
        let none = std::collections::BTreeSet::new();
        let moved_to = view.join("notes/session.txt");
        fs::write(&moved_to, b"the user's").unwrap();
        let unclaimed = move_foreign(&previous, &view, &none, &item, false);
        assert_eq!(unclaimed.reason, Some(crate::ForeignItemFailure::NameTaken), "{unclaimed:?}");
        assert_eq!(fs::read(&moved_to).unwrap(), b"the user's", "never removed unclaimed");
        let moved = move_foreign(&previous, &view, &none, &item, true);
        assert_eq!(moved.state, ForeignItemState::Moved, "{moved:?}");
        assert_eq!(fs::read(&moved_to).unwrap(), b"the user's notes");
        assert!(!previous.join("notes/session.txt").exists());

        // The copy a volume without a no-replace rename makes: same bytes,
        // another file.
        fs::remove_file(&moved_to).unwrap();
        fs::write(&moved_to, b"the user's notes").unwrap();
        let resumed = move_foreign(&previous, &view, &none, &item, true);
        assert_eq!(resumed.state, ForeignItemState::Moved, "{resumed:?}");
        assert_eq!(fs::read(&moved_to).unwrap(), b"the user's notes");
    }

    /// The swap's first step, `View/` → `View (previous)/`, onto a name an
    /// empty folder took after the swap checked it was free.
    #[tokio::test]
    async fn the_swap_reports_the_refusal_and_keeps_the_old_view() {
        use crate::apply::files::{move_aside, Aside, Rename};
        use crate::apply::Unattended;

        let poll = std::time::Duration::from_millis(1);
        for rename in [
            rename_noreplace as Rename,
            #[cfg(unix)]
            without_primitive,
        ] {
            let temp = tempfile::tempdir().unwrap();
            let (view, previous) = view_in(&temp);
            fs::create_dir(&previous).unwrap();
            let moved = move_aside(rename, poll, &view, &previous, &Unattended).await;
            assert!(matches!(moved, Aside::Failed), "not refused: {moved:?}");
            kept(&view);
            assert_eq!(fs::read_dir(&previous).unwrap().count(), 0, "the empty folder stays");
        }
    }

    /// A transfer's destination below `temp`, its file, and a partial copy
    /// recorded for it holding `bytes`, as `begin` and a fill leave it.
    #[cfg(unix)]
    fn partial_for(
        temp: &tempfile::TempDir,
        bytes: &[u8],
    ) -> (TransferDestination, PathBuf, WrittenCopy) {
        let destination = TransferDestination {
            root: NativePath::from_path(temp.path()),
            relative: NativePath::from_path(Path::new("night/Light_001.fits")),
        };
        let file = temp.path().join("night/Light_001.fits");
        let written = begin(Uuid::new_v4(), 1, &destination).unwrap();
        fill_partial(&written, 0, |out| out.write_all(bytes).map_err(|e| write_failed(&file, &e)))
            .unwrap();
        (destination, file, written)
    }

    /// e6tgr: an install interrupted while it copied left an unfinished copy
    /// of the partial at the destination. The next install removes it and
    /// installs; anything else there stays and refuses the install.
    #[cfg(unix)]
    #[test]
    fn an_install_removes_only_the_unfinished_copy_an_interruption_left() {
        let temp = tempfile::tempdir().unwrap();
        let (destination, file, written) = partial_for(&temp, b"the frame's bytes");
        fs::write(&file, b"theirs").unwrap();
        let refused = install(&destination, &written).unwrap_err();
        assert_eq!(refused.code, ReasonCode::DestinationOccupied, "{refused:?}");
        assert_eq!(fs::read(&file).unwrap(), b"theirs", "another file is never replaced");
        fs::remove_file(&file).unwrap();

        let (destination, file, written) = partial_for(&temp, b"the frame's bytes");
        fs::write(&file, b"the frame").unwrap();
        let installed = install(&destination, &written).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"the frame's bytes");
        let digest = hex::encode(<sha2::Sha256 as sha2::Digest>::digest(b"the frame's bytes"));
        verify_bytes(&destination, &installed, 17, Some(&digest)).unwrap();
        assert!(!written.partial.to_path_buf().unwrap().exists(), "the partial is gone");
    }

    /// e6tgr: a resumed `Writing` item whose destination holds an unfinished
    /// copy never takes it for the installed entry, though its identity may
    /// match on a volume without stable file IDs: the install runs again.
    #[cfg(unix)]
    #[test]
    fn a_resumed_write_reinstalls_over_an_unfinished_copy() {
        let temp = tempfile::tempdir().unwrap();
        let source_path = temp.path().join("Light_001.fits");
        fs::write(&source_path, b"the frame's bytes").unwrap();
        let source = crate::custody::observe_entry(&source_path).unwrap();
        let (destination, file, written) = partial_for(&temp, b"half");
        fs::write(&file, b"the fr").unwrap();
        let installed = write(&source, &destination, &written).unwrap();
        verify(&source, &destination, &installed).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"the frame's bytes");
    }

    #[cfg(unix)]
    #[test]
    fn only_a_prefix_of_the_file_counts_as_its_unfinished_copy() {
        let temp = tempfile::tempdir().unwrap();
        let (of, candidate) = (temp.path().join("of"), temp.path().join("candidate"));
        fs::write(&of, b"the frame's bytes").unwrap();
        for (theirs, kept) in
            [(&b"the frame's bytes and more"[..], "longer"), (&b"the frAme"[..], "different bytes")]
        {
            fs::write(&candidate, theirs).unwrap();
            assert!(!remove_unfinished_copy(&candidate, &of), "{kept}");
            assert_eq!(fs::read(&candidate).unwrap(), theirs, "{kept}");
        }
        fs::remove_file(&candidate).unwrap();
        // exFAT makes neither links nor hard links.
        if std::os::unix::fs::symlink(&of, &candidate).is_ok() {
            assert!(!remove_unfinished_copy(&candidate, &of), "a link is never removed");
            fs::remove_file(&candidate).unwrap();
        }
        if fs::hard_link(&of, &candidate).is_ok() {
            assert!(!remove_unfinished_copy(&candidate, &of), "nor the file itself");
            fs::remove_file(&candidate).unwrap();
        }
        fs::write(&candidate, b"the frame").unwrap();
        assert!(remove_unfinished_copy(&candidate, &of));
        assert!(!candidate.exists());
        assert_eq!(fs::read(&of).unwrap(), b"the frame's bytes");
    }

    /// wdlol: a volume without a full sync (macOS smbfs answers
    /// `F_FULLFSYNC` with `ENOTSUP`) is synced with `fsync` instead, and
    /// a full sync that fails any other way fails the sync.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_volume_without_a_full_sync_is_synced_with_fsync() {
        use rustix::io::Errno;

        let temp = tempfile::tempdir().unwrap();
        let copy = fs::File::create(temp.path().join("copy")).unwrap();
        let asked = std::cell::Cell::new(0);
        let without_full_sync = |_: &fs::File| {
            asked.set(asked.get() + 1);
            Err(Errno::NOTSUP)
        };
        full_sync_or_fsync(&copy, without_full_sync).unwrap();
        assert_eq!(asked.get(), 1, "the full sync is asked once");

        let error = full_sync_or_fsync(&copy, |_: &fs::File| Err(Errno::IO)).unwrap_err();
        assert_eq!(error.raw_os_error(), Some(Errno::IO.raw_os_error()), "{error}");
    }
}
