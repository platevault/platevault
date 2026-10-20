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
            read_unchanged(&source_path, &Expect::recorded(&source.fingerprint), |bytes| {
                out.write_all(bytes)
            })
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
    let expect = Expect { identity: &written.identity, size_bytes, modified_ns: None };
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

/// Rename `from` to `to` on one volume without ever replacing what is at
/// `to`, an empty folder included (STO-FR-12, PREP-FR-06). Every path either
/// asks the filesystem for a rename that refuses an existing `to` in the same
/// step that takes the name, or refuses: none checks `to` and then renames,
/// because a plain rename replaces an empty folder on Unix, and on Windows 10
/// 1607 and later where the volume supports `FileRenameInfoEx` (the
/// platform notes of `std::fs::rename`).
///
/// - macOS and Linux: `renamex_np(RENAME_EXCL)` and
///   `renameat2(RENAME_NOREPLACE)` (rustix `RenameFlags::NOREPLACE`), which
///   the kernel refuses with `EEXIST`.
/// - Windows: `MoveFileExW(from, to, 0)`, without `MOVEFILE_REPLACE_EXISTING`
///   (`fs_noreplace_windows`, which holds the one `unsafe` call so this crate
///   keeps `forbid`). The filesystem fails it with `ERROR_ALREADY_EXISTS`
///   when anything is at `to`; it moves a folder with its children on one
///   volume, and a link as the link itself. tempfile's `persist_noclobber`
///   isn't used: it first sets the source's attributes through its path,
///   which follows a link to an original.
/// - A volume that answers the no-replace rename as unsupported (`EINVAL`,
///   `ENOTSUP`, `ENOSYS`: macOS exFAT, some network and FUSE mounts), and
///   every other platform: see [`without_noreplace`]. A folder is refused
///   there (fail closed), so Apply can't swap a View on such a volume.
///
/// # Errors
/// `AlreadyExists` when `to` is taken; `Unsupported` for a folder on a
/// volume without the no-replace rename; the platform's rename error.
pub(crate) fn rename_noreplace(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use rustix::fs::{renameat_with, RenameFlags, CWD};
        use rustix::io::Errno;
        match renameat_with(CWD, from, CWD, to, RenameFlags::NOREPLACE) {
            Ok(()) => Ok(()),
            Err(errno @ (Errno::INVAL | Errno::NOTSUP | Errno::NOSYS)) => {
                without_noreplace(from, to, &errno.into())
            }
            Err(error) => Err(error.into()),
        }
    }
    #[cfg(windows)]
    {
        fs_noreplace_windows::move_noreplace(from, to)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        without_noreplace(from, to, &std::io::ErrorKind::Unsupported.into())
    }
}

/// [`rename_noreplace`] where the volume has no no-replace rename (`cause`
/// says how it answered). A file goes through tempfile's no-clobber persist,
/// whose hard link refuses an existing name atomically; the move fails where
/// the volume has no hard links either. A folder can't be hard-linked and
/// has no other move there that refuses an existing name, so it is never
/// renamed.
#[cfg(not(windows))]
fn without_noreplace(from: &Path, to: &Path, cause: &std::io::Error) -> std::io::Result<()> {
    if fs::symlink_metadata(from)?.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            format!(
                "{} was not renamed to {}: its volume offers no rename that refuses an existing \
                 folder ({cause})",
                from.display(),
                to.display()
            ),
        ));
    }
    let mut moving = tempfile::TempPath::try_from_path(from)?;
    moving.disable_cleanup(true);
    moving.persist_noclobber(to).map_err(|failure| failure.error)
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

    /// The rename on a volume that answers the no-replace rename `ENOTSUP`.
    #[cfg(not(windows))]
    fn fallback(from: &Path, to: &Path) -> io::Result<()> {
        without_noreplace(from, to, &io::ErrorKind::Unsupported.into())
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

    /// The plain rename the old fallback ended in: on Unix it silently
    /// replaces an empty folder, which is why no check before it is safe.
    #[cfg(unix)]
    #[test]
    fn a_plain_rename_replaces_an_empty_folder() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        fs::create_dir(&previous).unwrap();
        fs::rename(&view, &previous).unwrap();
        kept(&previous);
    }

    #[cfg(not(windows))]
    #[test]
    fn without_the_primitive_a_folder_is_never_renamed() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        let error = fallback(&view, &previous).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Unsupported, "{error}");
        kept(&view);
        assert!(!previous.exists(), "nothing was created");
    }

    #[cfg(not(windows))]
    #[test]
    fn without_the_primitive_a_folder_rename_refuses_an_existing_destination() {
        let temp = tempfile::tempdir().unwrap();
        let (view, previous) = view_in(&temp);
        fs::create_dir(&previous).unwrap();
        assert!(fallback(&view, &previous).is_err(), "onto an empty folder");
        fs::write(previous.join("theirs.txt"), b"theirs").unwrap();
        assert!(fallback(&view, &previous).is_err(), "onto a folder with files");
        kept(&view);
        assert_eq!(fs::read(previous.join("theirs.txt")).unwrap(), b"theirs");
    }

    #[cfg(not(windows))]
    #[test]
    fn without_the_primitive_a_file_moves_only_onto_a_free_name() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = (temp.path().join("a.fits"), temp.path().join("b.fits"));
        fs::write(&from, b"ours").unwrap();
        fs::write(&to, b"theirs").unwrap();
        let error = fallback(&from, &to).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        assert_eq!(fs::read(&to).unwrap(), b"theirs");
        fs::remove_file(&to).unwrap();
        fallback(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read(&to).unwrap(), b"ours");
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
            #[cfg(not(windows))]
            fallback,
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
