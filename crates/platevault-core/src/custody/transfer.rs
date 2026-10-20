// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Verified transfer (STO-FR-07, STO-FR-12, STO-IMP-FR-04).
//!
//! A transfer copies the reviewed source snapshot into a partial file created
//! with create-new semantics beside its destination and recorded by identity
//! before any byte is written. The copy is hashed as it is written and must
//! match the reviewed SHA-256; it is synced, installed at the destination with
//! a no-replace link or rename, and the folder is synced. Verification re-reads
//! the installed copy through a handle proven to be the recorded file. An
//! existing entry at the destination is never replaced; the only file this
//! module ever removes is a partial copy it wrote itself, while that name still
//! holds the recorded identity.

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
/// anything. A resumed item whose copy was already installed is recognized by
/// its recorded identity, never by the destination name.
pub(crate) fn write(
    source: &EntryEvidence,
    destination: &TransferDestination,
    written: &WrittenCopy,
) -> Result<(), ItemReason> {
    let partial = written.partial.to_path_buf().map_err(|error| changed(error.to_string()))?;
    let (_, _, file) = layout(destination)?;
    if holds(&file, &written.identity) {
        // Installed before an interruption; a link-and-unlink install may
        // also have left the partial name as a second link.
        discard(&partial, &written.identity);
        return Ok(());
    }
    if !holds(&partial, &written.identity) {
        return Err(changed(format!(
            "the partial copy {} this item recorded is gone and no copy of it is installed",
            partial.display()
        )));
    }
    fill_from_source(source, written)?;
    install(destination, written)
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
/// anything, and sync its folder. A partial that can't be installed is
/// removed.
pub(crate) fn install(
    destination: &TransferDestination,
    written: &WrittenCopy,
) -> Result<(), ItemReason> {
    let partial = written.partial.to_path_buf().map_err(|error| changed(error.to_string()))?;
    let (_, _, file) = layout(destination)?;
    let mut installing = match tempfile::TempPath::try_from_path(&partial) {
        Ok(installing) => installing,
        Err(error) => {
            discard(&partial, &written.identity);
            return Err(write_failed(&partial, &error));
        }
    };
    installing.disable_cleanup(true);
    if let Err(failure) = installing.persist_noclobber(&file) {
        discard(&partial, &written.identity);
        return Err(if failure.error.kind() == std::io::ErrorKind::AlreadyExists {
            occupied(&file)
        } else {
            write_failed(&file, &failure.error)
        });
    }
    // A link-and-unlink install may leave the partial name as a second link.
    discard(&partial, &written.identity);
    let folder = file.parent().unwrap_or_else(|| Path::new(""));
    sync_folder(folder).map_err(|error| write_failed(folder, &error))
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

/// Make `path` a copy-on-write clone of `source`: APFS `clonefile` on macOS,
/// the `FICLONE` reflink on Linux. Nothing is copied when the volume or the
/// platform can't clone; the error says so and `path` stays free.
#[cfg(target_os = "macos")]
pub(crate) fn clone_file(source: &Path, path: &Path) -> std::io::Result<()> {
    let folder = path.parent().unwrap_or(path);
    let name = path.file_name().ok_or_else(|| std::io::Error::other("no file name"))?;
    let source = fs::File::open(source)?;
    let folder = fs::File::open(folder)?;
    rustix::fs::fclonefileat(&source, &folder, name, rustix::fs::CloneFlags::NOFOLLOW)?;
    fs::File::open(path)?.sync_all()
}

#[cfg(target_os = "linux")]
pub(crate) fn clone_file(source: &Path, path: &Path) -> std::io::Result<()> {
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
pub(crate) fn clone_file(_source: &Path, _path: &Path) -> std::io::Result<()> {
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
///   (`EINVAL`, `ENOTSUP`, `ENOSYS`: macOS exFAT, some network and FUSE
///   mounts), and other Unix platforms: [`without_noreplace`]. A folder moves
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
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use rustix::fs::{renameat_with, RenameFlags, CWD};
        use rustix::io::Errno;
        match renameat_with(CWD, from, CWD, to, RenameFlags::NOREPLACE) {
            Ok(()) => Ok(()),
            Err(Errno::INVAL | Errno::NOTSUP | Errno::NOSYS) => without_noreplace(from, to),
            Err(error) => Err(error.into()),
        }
    }
    #[cfg(windows)]
    {
        fs_noreplace_windows::move_noreplace(from, to)
    }
    #[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
    {
        without_noreplace(from, to)
    }
}

/// [`rename_noreplace`] where the volume has no no-replace rename. A file
/// goes through tempfile's no-clobber persist, whose hard link refuses an
/// existing name atomically, and where the volume has no hard links either
/// is copied by [`copy_onto_new`] and then removed. A folder goes
/// [`over_placeholder`] once `mkdir` claimed `to`, which fails when anything
/// is there.
#[cfg(unix)]
fn without_noreplace(from: &Path, to: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(from)?;
    if metadata.is_dir() {
        fs::create_dir(to)?;
        let placeholder = fs::symlink_metadata(to)?;
        return over_placeholder(from, to, &placeholder);
    }
    let mut moving = tempfile::TempPath::try_from_path(from)?;
    moving.disable_cleanup(true);
    match moving.persist_noclobber(to) {
        Ok(()) => Ok(()),
        Err(failure) if metadata.is_file() && lacks_links(&failure.error) => {
            let copied = copy_onto_new(from, to)?;
            remove_source(from, to, &copied)
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

/// What [`copy_onto_new`] proved: the source entry it read, as a no-follow
/// observation, and the handle of the file it created.
#[cfg(unix)]
struct Copied {
    source: fs::Metadata,
    created: fs::File,
}

/// Copy the regular file `from` onto a file created at `to` with
/// `create_new`, which fails when anything is there, the way a verified
/// transfer fills its partial copy: the source is streamed through a handle
/// proven to be it and hashed as it is written ([`read_unchanged`]), the copy
/// takes the source's modification time and is synced with its folder, and
/// the copy is re-read through a handle proven to be the created file and
/// must have the source's SHA-256. The transfer's `install` is not reused: it
/// is the no-clobber persist this volume lacks.
///
/// Until the copy is verified, `to` holds an unfinished copy under its final
/// name, since no other name can be published there without replacing. A
/// copy that fails is removed while `to` still names the created file; an
/// interruption leaves it, with the source intact, and a retry is refused
/// as `to` taken.
///
/// The created file is recognised through its open handle, compared each
/// time: macOS exFAT reports a placeholder inode for an empty file and the
/// first cluster once data is written, so an inode noted at creation no
/// longer matches.
#[cfg(unix)]
fn copy_onto_new(from: &Path, to: &Path) -> std::io::Result<Copied> {
    let fingerprint = inventory::probe_fingerprint(from).map_err(std::io::Error::other)?;
    let source = fs::symlink_metadata(from)?;
    let mut out = OpenOptions::new().read(true).write(true).create_new(true).open(to)?;
    let filled = (|| {
        let digest = read_unchanged(from, &Expect::recorded(&fingerprint), |bytes| {
            out.write_all(bytes)
        })
        .map_err(|check| std::io::Error::other(check.detail().to_owned()))?;
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
        Ok(())
    })();
    match filled {
        Ok(()) => Ok(Copied { source, created: out }),
        Err(error) => {
            if names(to, &out) {
                let _ = fs::remove_file(to);
            }
            Err(error)
        }
    }
}

/// Remove the source of a verified [`copy_onto_new`], only while `from` is
/// still the entry that was read; another entry there is left alone, and the
/// copy holds the bytes read. A source that can't be removed keeps it, and
/// the copy is removed while `to` still names the created file.
#[cfg(unix)]
fn remove_source(from: &Path, to: &Path, copied: &Copied) -> std::io::Result<()> {
    let still_source =
        fs::symlink_metadata(from).is_ok_and(|now| super::same_entry(&copied.source, &now));
    if !still_source {
        return Ok(());
    }
    if let Err(error) = fs::remove_file(from) {
        if names(to, &copied.created) {
            let _ = fs::remove_file(to);
        }
        return Err(error);
    }
    let _ = sync_folder(from.parent().unwrap_or_else(|| Path::new("")));
    Ok(())
}

/// Whether `path` names the file `handle` holds open right now.
#[cfg(unix)]
fn names(path: &Path, handle: &fs::File) -> bool {
    match (fs::symlink_metadata(path), handle.metadata()) {
        (Ok(named), Ok(held)) => super::same_entry(&held, &named),
        _ => false,
    }
}

/// Rename the folder `from` over the empty `placeholder` this rename created
/// at `to`. Rename replaces only an empty folder, so a file another process
/// put in the placeholder fails it with `ENOTEMPTY`, and a file in its place
/// with `ENOTDIR`; either is reported as `to` taken, nothing moved. A failed
/// rename removes the placeholder while it is still that folder and empty.
#[cfg(unix)]
fn over_placeholder(from: &Path, to: &Path, placeholder: &fs::Metadata) -> std::io::Result<()> {
    use std::io::ErrorKind;
    use std::os::unix::fs::MetadataExt;

    let Err(error) = fs::rename(from, to) else {
        return Ok(());
    };
    if fs::symlink_metadata(to)
        .is_ok_and(|now| now.dev() == placeholder.dev() && now.ino() == placeholder.ino())
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

    /// `to` claimed with an empty placeholder, as [`without_noreplace`] does.
    #[cfg(unix)]
    fn claimed(to: &Path) -> fs::Metadata {
        fs::create_dir(to).unwrap();
        fs::symlink_metadata(to).unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn a_file_put_in_the_placeholder_refuses_the_rename_and_nothing_is_lost() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        let placeholder = claimed(&previous);
        fs::write(previous.join("theirs.txt"), b"theirs").unwrap();
        let error = over_placeholder(&view, &previous, &placeholder).unwrap_err();
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
        let error = over_placeholder(&view, &previous, &placeholder).unwrap_err();
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
        let error = over_placeholder(&gone, &to, &placeholder).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound, "{error}");
        assert!(!to.exists(), "its own empty placeholder is removed");

        let placeholder = claimed(&to);
        fs::remove_dir(&to).unwrap();
        claimed(&to);
        over_placeholder(&gone, &to, &placeholder).unwrap_err();
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
        remove_source(&from, &to, &copied).unwrap();
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
        for retry in [rename_noreplace as fn(&Path, &Path) -> io::Result<()>, without_noreplace] {
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
        for retry in [rename_noreplace as fn(&Path, &Path) -> io::Result<()>, without_noreplace] {
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
        remove_source(&from, &to, &copied).unwrap();
        assert_eq!(fs::read(&from).unwrap(), b"another file");
        assert_eq!(fs::read(&to).unwrap(), b"the user's notes");
    }

    /// Apply's move of a ticked foreign file from `View (previous)/` into the
    /// new `View/`, and its refusal where the new View holds the name.
    #[cfg(unix)]
    #[test]
    fn apply_moves_a_ticked_foreign_file_and_never_over_an_entry() {
        use crate::apply::files::{foreign_files, move_foreign};
        use crate::{ForeignItem, ForeignItemState};

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

        fs::create_dir(view.join("notes")).unwrap();
        fs::write(view.join("notes/session.txt"), b"placed").unwrap();
        let refused = move_foreign(&previous, &view, &item);
        assert_eq!(refused.state, ForeignItemState::Failed, "{refused:?}");
        assert_eq!(fs::read(view.join("notes/session.txt")).unwrap(), b"placed");
        assert_eq!(fs::read(previous.join("notes/session.txt")).unwrap(), b"the user's notes");

        fs::remove_file(view.join("notes/session.txt")).unwrap();
        let moved = move_foreign(&previous, &view, &item);
        assert_eq!(moved.state, ForeignItemState::Moved, "{moved:?}");
        assert!(!previous.join("notes/session.txt").exists());
        assert_eq!(fs::read(view.join("notes/session.txt")).unwrap(), b"the user's notes");
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
            without_noreplace,
        ] {
            let temp = tempfile::tempdir().unwrap();
            let (view, previous) = view_in(&temp);
            fs::create_dir(&previous).unwrap();
            let moved = move_aside(rename, poll, &view, &previous, &Unattended).await;
            let Aside::Failed(detail) = moved else { panic!("not refused: {moved:?}") };
            assert!(detail.contains(&view.display().to_string()), "{detail}");
            kept(&view);
            assert_eq!(fs::read_dir(&previous).unwrap().count(), 0, "the empty folder stays");
        }
    }
}
