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
//! while that name still holds the recorded identity, and an unfinished copy
//! of such a partial that an interrupted install left at its destination,
//! which holds nothing the partial doesn't.

use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Component, Path, PathBuf};

use uuid::Uuid;

use super::{read_unchanged, same_identity, Check, Expect};
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
    out.sync_all().map_err(|error| write_failed(partial, &error))
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
    fs::File::open(folder)?.sync_all()
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
    fs::File::open(path)?.sync_all()
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
    out.sync_all()
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
    let aside = from.with_file_name(format!(".pv-{}.removing", Uuid::new_v4().simple()));
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
        let refused = move_foreign(&previous, &view, &none, &item);
        assert_eq!(
            (refused.state, refused.reason),
            (ForeignItemState::Failed, Some(ForeignItemFailure::NameTaken)),
            "{refused:?}"
        );
        assert_eq!(fs::read(view.join("notes/session.txt")).unwrap(), b"placed");
        assert_eq!(fs::read(previous.join("notes/session.txt")).unwrap(), b"the user's notes");

        fs::remove_file(view.join("notes/session.txt")).unwrap();
        let placed = std::collections::BTreeSet::from([PathBuf::from("notes/session.txt")]);
        let refused = move_foreign(&previous, &view, &placed, &item);
        assert_eq!(
            (refused.state, refused.reason),
            (ForeignItemState::Failed, Some(ForeignItemFailure::NameTaken)),
            "a placed name: {refused:?}"
        );
        assert!(!view.join("notes/session.txt").exists());

        let moved = move_foreign(&previous, &view, &none, &item);
        assert_eq!(moved.state, ForeignItemState::Moved, "{moved:?}");
        assert!(!previous.join("notes/session.txt").exists());
        assert_eq!(fs::read(view.join("notes/session.txt")).unwrap(), b"the user's notes");
    }

    /// nfsgg, e6tgr: where a file moves as a verified copy (macOS exFAT), a
    /// resumed move removes the unfinished copy an interruption left in the
    /// new View and moves again, and one whose source is gone accepts the
    /// reviewed bytes there though the copy has an identity of its own.
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
        let moved = move_foreign(&previous, &view, &none, &item);
        assert_eq!(moved.state, ForeignItemState::Moved, "{moved:?}");
        assert_eq!(fs::read(&moved_to).unwrap(), b"the user's notes");
        assert!(!previous.join("notes/session.txt").exists());

        // The copy a volume without a no-replace rename makes: same bytes,
        // another file.
        fs::remove_file(&moved_to).unwrap();
        fs::write(&moved_to, b"the user's notes").unwrap();
        let resumed = move_foreign(&previous, &view, &none, &item);
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
}
