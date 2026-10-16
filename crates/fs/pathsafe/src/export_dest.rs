// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Validation and no-replace write for a webview-supplied export destination.
//!
//! Constitution II ("MUST never overwrite silently") makes an existing
//! destination a rejection, not a replacement.
//!
//! The write target is always `canonical_parent.join(file_name)`, so no segment
//! of the caller's string can move the write outside the directory that was
//! canonicalized and checked. The temporary file is created inside that same
//! directory with `create_new`, which refuses to follow a symlink planted after
//! validation. The final step itself refuses a taken name, so a file,
//! directory or symlink that appears at the destination after validation is
//! kept as it is, however late it appears.

use std::fmt;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;

/// Why an export destination is refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DestinationRejected {
    /// The path is relative. Export destinations cross a process boundary, so a
    /// path that resolves against the app's working directory is refused.
    NotAbsolute,
    /// The path has no parent component.
    NoParent,
    /// The path has no final component (it ends in `.` , `..`, or a separator).
    NoFileName,
    /// The parent directory does not exist or cannot be canonicalized.
    ParentMissing,
    /// The parent path exists but is not a directory.
    ParentNotDirectory,
    /// The final component is a Windows reserved device name.
    ReservedName,
    /// Something already exists at the destination.
    AlreadyExists,
}

impl DestinationRejected {
    /// Stable message for the caller's own error envelope.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::NotAbsolute => "export destination must be an absolute path",
            Self::NoParent => "export destination has no parent directory",
            Self::NoFileName => "export destination has no file name",
            Self::ParentMissing => "export destination parent directory does not exist",
            Self::ParentNotDirectory => "export destination parent is not a directory",
            Self::ReservedName => "export destination is a reserved device name",
            Self::AlreadyExists => "export destination already exists",
        }
    }
}

/// A destination that passed [`validate_export_destination`].
#[derive(Clone, Debug)]
pub struct ExportDestination {
    dir: PathBuf,
    final_path: PathBuf,
}

/// Validate `dest` as a write destination.
///
/// # Errors
/// Returns the first [`DestinationRejected`] rule the path violates.
pub fn validate_export_destination(dest: &Path) -> Result<ExportDestination, DestinationRejected> {
    if !dest.is_absolute() {
        return Err(DestinationRejected::NotAbsolute);
    }
    let parent = dest.parent().ok_or(DestinationRejected::NoParent)?;
    let file_name = dest.file_name().ok_or(DestinationRejected::NoFileName)?;

    // A verbatim Windows path (`\\?\C:\...`) gives `..` no special meaning, so
    // `file_name` returns it as an ordinary component and the traversal check
    // has to reject it here.
    let name = file_name.to_string_lossy();
    safe_filename::step3_traversal_check(&name).map_err(|_| DestinationRejected::NoFileName)?;

    // Windows resolves a device name from the text before the FIRST dot, so
    // `CON.foo.json` names the console where `file_stem` would keep `CON.foo`.
    let device = name.split('.').next().unwrap_or(&name);
    safe_filename::step4_reserved_name_check(device)
        .map_err(|_| DestinationRejected::ReservedName)?;

    let dir = parent.canonicalize().map_err(|_| DestinationRejected::ParentMissing)?;
    if !dir.is_dir() {
        return Err(DestinationRejected::ParentNotDirectory);
    }

    let final_path = dir.join(file_name);
    if final_path.symlink_metadata().is_ok() {
        return Err(DestinationRejected::AlreadyExists);
    }

    Ok(ExportDestination { dir, final_path })
}

/// Distinguishes a refused destination from a failure while writing to it.
#[derive(Debug)]
pub enum ExportWriteError {
    Rejected(DestinationRejected),
    Io(io::Error),
    /// The copy fallback failed after it claimed the destination name, and the
    /// export's own unfinished file is still there.
    LeftUnfinished(UnfinishedFile),
}

impl fmt::Display for ExportWriteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rejected(rejected) => f.write_str(rejected.message()),
            Self::Io(e) => e.fmt(f),
            Self::LeftUnfinished(file) => file.fmt(f),
        }
    }
}

impl std::error::Error for ExportWriteError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Rejected(_) => None,
            Self::Io(e) => Some(e),
            Self::LeftUnfinished(file) => std::error::Error::source(file),
        }
    }
}

/// The export's own unfinished file at the destination, left by a copy
/// fallback that failed after it claimed the name. It is never removed by
/// name, because another process can put its own entry at that name, so a
/// retry to that name is refused until the user deletes it.
#[derive(Debug)]
pub struct UnfinishedFile {
    path: PathBuf,
    source: io::Error,
    /// Truncating the file and syncing that succeeded; otherwise it may still
    /// hold part of the export.
    emptied: bool,
}

impl UnfinishedFile {
    /// Where the file remains: the validated destination under its
    /// canonicalized parent, which the path the caller passed in may no
    /// longer reach once a symlink in it is retargeted.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// [`Self::path`], owned.
    #[must_use]
    pub fn into_path(self) -> PathBuf {
        self.path
    }
}

impl fmt::Display for UnfinishedFile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let file = if self.emptied {
            "an empty file"
        } else {
            "a file that may still hold part of the export"
        };
        write!(
            f,
            "the export failed ({}) and {file} remains at {}",
            self.source,
            self.path.display()
        )
    }
}

impl std::error::Error for UnfinishedFile {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

impl From<DestinationRejected> for ExportWriteError {
    fn from(value: DestinationRejected) -> Self {
        Self::Rejected(value)
    }
}

impl From<io::Error> for ExportWriteError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

impl ExportDestination {
    /// The validated write target.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.final_path
    }

    /// Write through a temporary file inside the validated directory, then
    /// move it onto the destination without replacing anything there.
    /// Returns the byte count written.
    ///
    /// The final step is [`NamedTempFile::persist_noclobber`], which fails
    /// when an entry holds the destination name at that moment: a no-replace
    /// rename (Linux `renameat2` with `RENAME_NOREPLACE`, macOS
    /// `renameatx_np` with `RENAME_EXCL`, Windows `MoveFileExW` without
    /// `MOVEFILE_REPLACE_EXISTING`), or a hard link followed by removing the
    /// temporary name where the volume rejects that rename. A Unix volume
    /// that answers the no-replace rename as unsupported gets the hard link
    /// tried as well. One with neither (exFAT on macOS, some FUSE mounts) gets
    /// the destination claimed with `create_new` and the bytes copied in:
    /// still never a replacement, but the copy is visible while it is written.
    /// If the process dies during that copy, a truncated file remains at the
    /// destination name; if the copy fails, the export's own file stays there,
    /// emptied where truncating it succeeds, because removing it by name could
    /// remove an entry another process put there. Either way a retry to that
    /// name is refused as existing.
    ///
    /// The temporary file is removed on every path, a panic in `write`
    /// included.
    ///
    /// # Errors
    /// Returns [`ExportWriteError::Rejected`] with
    /// [`DestinationRejected::AlreadyExists`] when an entry took the
    /// destination name after validation,
    /// [`ExportWriteError::LeftUnfinished`] when the copy fallback failed and
    /// left the export's own file at the destination, and
    /// [`ExportWriteError::Io`] for other filesystem and serialisation
    /// failures.
    pub fn write_atomically<W>(&self, write: W) -> Result<u64, ExportWriteError>
    where
        W: FnOnce(&mut File) -> io::Result<()>,
    {
        self.write_then_install(write, |_| {})
    }

    /// [`Self::write_atomically`] with `before_install` run between the synced
    /// write and the final step, the last window in which a concurrent process
    /// can take the destination name; tests race the final step through it.
    fn write_then_install<W, B>(&self, write: W, before_install: B) -> Result<u64, ExportWriteError>
    where
        W: FnOnce(&mut File) -> io::Result<()>,
        B: FnOnce(&Path),
    {
        let mut temp = self.create_temp()?;
        write(temp.as_file_mut()).and_then(|()| temp.as_file().sync_all())?;
        let bytes = temp.as_file().metadata().map_or(0, |m| m.len());
        before_install(&self.final_path);
        settle_install(temp.persist_noclobber(&self.final_path), &self.final_path)?;
        Ok(bytes)
    }

    /// `create_new` under a random name: a name taken by a concurrent export
    /// or a planted symlink is skipped, never shared or followed.
    fn create_temp(&self) -> io::Result<NamedTempFile> {
        let mut builder = tempfile::Builder::new();
        builder.prefix(".export-").suffix(".tmp");
        // tempfile defaults to 0o600; 0o666 leaves the mode to the umask, as
        // `File::create` does.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(std::fs::Permissions::from_mode(0o666));
        }
        builder.tempfile_in(&self.dir)
    }
}

/// Turns the outcome of the no-replace persist into the export's result.
/// `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` works on every Windows
/// volume, FAT32 and exFAT included, so only a Unix volume can lack the
/// primitive and move on to `link_or_copy`.
fn settle_install(
    persisted: Result<File, tempfile::PersistError>,
    final_path: &Path,
) -> Result<(), ExportWriteError> {
    match persisted {
        Ok(_) => Ok(()),
        #[cfg(unix)]
        Err(failed) if is_unsupported(&failed.error) => link_or_copy(failed.file, final_path),
        Err(failed) => Err(refusal_or_io(failed.error, final_path)),
    }
}

/// The error that reports a taken name differs between platforms and between
/// the kinds of entry holding it, so any failure while the name is taken is
/// the existing-destination refusal.
fn refusal_or_io(error: io::Error, final_path: &Path) -> ExportWriteError {
    if error.kind() == io::ErrorKind::AlreadyExists || final_path.symlink_metadata().is_ok() {
        DestinationRejected::AlreadyExists.into()
    } else {
        error.into()
    }
}

/// Whether an install step failed because the volume does not offer it.
/// `persist_noclobber` reports the rename's error, or the hard link's after a
/// rename the volume rejects as `EINVAL` or `ENOSYS`: macOS exFAT answers
/// `RENAME_EXCL` and `link` with `ENOTSUP`, Linux reports a volume without
/// hard links as `EPERM`, and a FUSE server lacking an operation answers
/// `ENOSYS`.
#[cfg(unix)]
fn is_unsupported(error: &io::Error) -> bool {
    use rustix::io::Errno;

    Errno::from_io_error(error).is_some_and(|errno| {
        [Errno::NOTSUP, Errno::OPNOTSUPP, Errno::NOSYS, Errno::PERM].contains(&errno)
    })
}

/// Publishes `temp` at `final_path` with a hard link, which fails on any
/// entry already there, and falls back to [`copy_into_new`] where the volume
/// has no hard links. tempfile tries the link itself only after `EINVAL` or
/// `ENOSYS` from the rename, so a volume that answers it with `ENOTSUP` gets
/// the link here. Dropping `temp` removes the temporary name.
#[cfg(unix)]
fn link_or_copy(mut temp: NamedTempFile, final_path: &Path) -> Result<(), ExportWriteError> {
    match std::fs::hard_link(temp.path(), final_path) {
        Ok(()) => Ok(()),
        Err(e) if is_unsupported(&e) => copy_into_new(temp.as_file_mut(), final_path, |_| {}),
        Err(e) => Err(refusal_or_io(e, final_path)),
    }
}

/// Claims `final_path` with `create_new`, which fails on any entry already
/// there, and copies the synced temporary file into it.
///
/// Only for a Unix volume that offers neither a no-replace rename nor hard
/// links: nothing at the name is ever replaced, but unlike a rename a reader
/// can see the copy while it is written. If the process dies during the copy,
/// a truncated file remains at the destination name.
///
/// A copy that fails part-way is emptied and synced through its own handle and
/// left at the name, reported as [`ExportWriteError::LeftUnfinished`] so the
/// user learns that a file remains there and where. Removing it would go by
/// name, and between any check of the name and the removal another process
/// can put its own entry there. When the name no longer holds the export's
/// file at that point, the failure is a plain [`ExportWriteError::Io`], so the
/// error does not send the user to delete an entry that is someone else's.
/// That inode check narrows the window but cannot close it: an entry swapped
/// in after the check is still reported as the export's leftover. The check
/// only shapes the report, never an action on the name.
/// `before_cleanup` runs right before the cleanup; tests race it through it.
#[cfg(unix)]
fn copy_into_new<R: io::Read + io::Seek>(
    temp: &mut R,
    final_path: &Path,
    before_cleanup: impl FnOnce(&Path),
) -> Result<(), ExportWriteError> {
    use std::io::SeekFrom;

    let mut out = File::options()
        .write(true)
        .create_new(true)
        .open(final_path)
        .map_err(|e| refusal_or_io(e, final_path))?;
    let copied = temp
        .seek(SeekFrom::Start(0))
        .and_then(|_| io::copy(temp, &mut out))
        .and_then(|_| out.sync_all());
    let Err(source) = copied else {
        return Ok(());
    };
    before_cleanup(final_path);
    let emptied = out.set_len(0).and_then(|()| out.sync_all()).is_ok();
    if names(final_path, &out) {
        Err(ExportWriteError::LeftUnfinished(UnfinishedFile {
            path: final_path.to_path_buf(),
            source,
            emptied,
        }))
    } else {
        Err(source.into())
    }
}

/// Whether `path` names `file` right now.
#[cfg(unix)]
fn names(path: &Path, file: &File) -> bool {
    use std::os::unix::fs::MetadataExt;

    match (path.symlink_metadata(), file.metadata()) {
        (Ok(named), Ok(held)) => (named.dev(), named.ino()) == (held.dev(), held.ino()),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// The canonical path matters on macOS, where `/var` is a symlink to
    /// `/private/var` and the validator returns the resolved parent.
    fn tempdir() -> (tempfile::TempDir, PathBuf) {
        let guard = tempfile::tempdir().expect("temp dir");
        let path = guard.path().canonicalize().expect("canonicalize temp dir");
        (guard, path)
    }

    fn write_hello(dest: &ExportDestination) -> Result<u64, ExportWriteError> {
        dest.write_atomically(|f| f.write_all(b"hello"))
    }

    #[test]
    fn relative_path_with_parent_escape_is_refused() {
        let err = validate_export_destination(Path::new("../../etc/passwd")).unwrap_err();
        assert_eq!(err, DestinationRejected::NotAbsolute);
    }

    #[test]
    fn absolute_path_outside_any_root_is_accepted_but_never_overwrites() {
        let (_guard, dir) = tempdir();
        let dest = dir.join("out.json");
        let validated = validate_export_destination(&dest).expect("fresh destination");
        assert_eq!(write_hello(&validated).expect("write"), 5);

        let err = validate_export_destination(&dest).unwrap_err();
        assert_eq!(err, DestinationRejected::AlreadyExists);
        assert_eq!(std::fs::read(&dest).expect("read back"), b"hello");
    }

    #[test]
    fn dotdot_inside_an_absolute_path_cannot_move_the_write_out_of_the_parent() {
        let (_guard, dir) = tempdir();
        let nested = dir.join("nested");
        std::fs::create_dir_all(&nested).expect("create nested");
        let dest = nested.join("..").join("out.json");

        let validated = validate_export_destination(&dest).expect("valid");
        assert_eq!(validated.path().parent(), Some(dir.as_path()));
        write_hello(&validated).expect("write");
        assert!(dir.join("out.json").exists());
    }

    #[test]
    fn parent_that_is_not_a_directory_is_refused() {
        let (_guard, dir) = tempdir();
        let file = dir.join("regular");
        std::fs::write(&file, b"x").expect("write file");

        let err = validate_export_destination(&file.join("child.json")).unwrap_err();
        assert!(
            matches!(
                err,
                DestinationRejected::ParentMissing | DestinationRejected::ParentNotDirectory
            ),
            "{err:?}"
        );
    }

    #[test]
    fn missing_parent_is_refused() {
        let (_guard, dir) = tempdir();
        let err = validate_export_destination(&dir.join("absent").join("out.json")).unwrap_err();
        assert_eq!(err, DestinationRejected::ParentMissing);
    }

    #[test]
    fn path_without_a_file_name_is_refused() {
        let (_guard, dir) = tempdir();
        // `join` collapses `..` on a verbatim Windows path, which would leave the
        // parent directory rather than a path terminating in `..`.
        let dest = PathBuf::from(format!("{}{}..", dir.display(), std::path::MAIN_SEPARATOR));

        let err = validate_export_destination(&dest).unwrap_err();
        assert_eq!(err, DestinationRejected::NoFileName);
    }

    #[test]
    fn windows_reserved_device_name_is_refused_on_every_platform() {
        let (_guard, dir) = tempdir();
        for name in ["CON", "con.json", "NUL.txt", "com1.json", "CON.foo.json", "nul.a.b"] {
            let err = validate_export_destination(&dir.join(name)).unwrap_err();
            assert_eq!(err, DestinationRejected::ReservedName, "{name}");
        }
    }

    #[test]
    fn existing_destination_is_refused_before_anything_is_written() {
        let (_guard, dir) = tempdir();
        let dest = dir.join("keep.json");
        std::fs::write(&dest, b"original").expect("seed");

        let err = validate_export_destination(&dest).unwrap_err();
        assert_eq!(err, DestinationRejected::AlreadyExists);
        assert_eq!(std::fs::read(&dest).expect("read"), b"original");
    }

    #[test]
    fn temporary_file_lands_inside_the_validated_directory() {
        let (_guard, dir) = tempdir();
        let validated = validate_export_destination(&dir.join("out.json")).expect("valid");
        validated
            .write_atomically(|f| {
                let seen: Vec<PathBuf> = std::fs::read_dir(&validated.dir)
                    .expect("read dir")
                    .filter_map(|e| e.ok().map(|e| e.path()))
                    .collect();
                assert_eq!(seen.len(), 1, "{seen:?}");
                assert_eq!(seen[0].parent(), Some(validated.dir.as_path()));
                f.write_all(b"x")
            })
            .expect("write");
    }

    /// Pins the behaviour the validator replaces: a bare `create` + `rename`
    /// pair reports success while destroying whatever was at the destination.
    /// Both halves must hold, so reverting either sink to that sequence fails
    /// this test.
    #[test]
    fn the_unvalidated_create_and_rename_sequence_replaces_an_existing_file() {
        let (_guard, dir) = tempdir();
        let dest = dir.join("keep.json");
        std::fs::write(&dest, b"user data").expect("seed");

        let temp = dir.join("keep.json.tmp");
        std::fs::File::create(&temp)
            .expect("create temp")
            .write_all(b"export")
            .expect("write temp");
        std::fs::rename(&temp, &dest).expect("rename replaces silently");
        assert_eq!(std::fs::read(&dest).expect("read"), b"export");

        assert_eq!(
            validate_export_destination(&dest).unwrap_err(),
            DestinationRejected::AlreadyExists
        );
    }

    #[test]
    fn a_failed_write_leaves_no_temporary_file_behind() {
        let (_guard, dir) = tempdir();
        let validated = validate_export_destination(&dir.join("out.json")).expect("valid");
        let err = validated
            .write_atomically(|_| Err(io::Error::other("serialise failed")))
            .expect_err("write fails");

        assert!(matches!(err, ExportWriteError::Io(_)), "{err:?}");
        assert_eq!(std::fs::read_dir(&dir).expect("read dir").count(), 0);
    }

    #[test]
    fn a_destination_appearing_after_validation_is_not_replaced() {
        let (_guard, dir) = tempdir();
        let dest = dir.join("out.json");
        let validated = validate_export_destination(&dest).expect("valid");

        let err = validated
            .write_atomically(|f| {
                std::fs::write(&dest, b"raced").expect("racing writer");
                f.write_all(b"export")
            })
            .expect_err("final step refused");

        assert!(
            matches!(err, ExportWriteError::Rejected(DestinationRejected::AlreadyExists)),
            "{err:?}"
        );
        assert_eq!(std::fs::read(&dest).expect("read"), b"raced");
    }

    /// Creates the destination after every check and immediately before the
    /// final step, the last moment a concurrent process can take the name. A
    /// check followed by `rename` replaces the entry here.
    #[test]
    fn a_destination_created_just_before_the_final_step_is_kept_byte_identical() {
        let (_guard, dir) = tempdir();
        let dest = dir.join("out.json");
        let validated = validate_export_destination(&dest).expect("valid");
        let planted: &[u8] = b"written by another process\x00\xff";

        let err = validated
            .write_then_install(
                |f| f.write_all(b"export"),
                |final_path| std::fs::write(final_path, planted).expect("racing writer"),
            )
            .expect_err("final step refused");

        assert!(
            matches!(err, ExportWriteError::Rejected(DestinationRejected::AlreadyExists)),
            "{err:?}"
        );
        assert_eq!(std::fs::read(&dest).expect("read"), planted);
        let left: Vec<PathBuf> =
            std::fs::read_dir(&dir).expect("read dir").map(|e| e.expect("entry").path()).collect();
        assert_eq!(left, [dest], "the temporary file is removed");
    }

    /// A symlink planted at that moment is refused as well: neither replaced
    /// nor written through.
    #[cfg(unix)]
    #[test]
    fn a_symlink_created_just_before_the_final_step_is_kept() {
        let (_guard, dir) = tempdir();
        let (_outside_guard, outside_dir) = tempdir();
        let outside = outside_dir.join("outside.json");
        std::fs::write(&outside, b"outside").expect("seed outside");
        let dest = dir.join("out.json");
        let validated = validate_export_destination(&dest).expect("valid");

        let err = validated
            .write_then_install(
                |f| f.write_all(b"export"),
                |final_path| std::os::unix::fs::symlink(&outside, final_path).expect("plant"),
            )
            .expect_err("final step refused");

        assert!(
            matches!(err, ExportWriteError::Rejected(DestinationRejected::AlreadyExists)),
            "{err:?}"
        );
        assert_eq!(std::fs::read_link(&dest).expect("still the planted symlink"), outside);
        assert_eq!(std::fs::read(&outside).expect("read"), b"outside");
    }

    /// A directory planted at that moment is refused and left alone. Whatever
    /// code the platform reports for a directory at the target, the taken name
    /// makes it the existing-destination refusal.
    #[test]
    fn a_directory_created_just_before_the_final_step_is_left_alone() {
        let (_guard, dir) = tempdir();
        let dest = dir.join("out.json");
        let validated = validate_export_destination(&dest).expect("valid");

        let err = validated
            .write_then_install(
                |f| f.write_all(b"export"),
                |final_path| std::fs::create_dir(final_path).expect("plant dir"),
            )
            .expect_err("final step refused");

        assert!(
            matches!(err, ExportWriteError::Rejected(DestinationRejected::AlreadyExists)),
            "{err:?}"
        );
        assert!(dest.symlink_metadata().expect("planted dir").is_dir());
        assert_eq!(std::fs::read_dir(&dest).expect("read planted dir").count(), 0);
        let left: Vec<PathBuf> =
            std::fs::read_dir(&dir).expect("read dir").map(|e| e.expect("entry").path()).collect();
        assert_eq!(left, [dest], "the temporary file is removed");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_at_the_destination_is_refused_rather_than_followed() {
        let (_guard, dir) = tempdir();
        let (_outside_guard, outside_dir) = tempdir();
        let outside = outside_dir.join("outside.json");
        std::fs::write(&outside, b"outside").expect("seed outside");
        let link = dir.join("out.json");
        std::os::unix::fs::symlink(&outside, &link).expect("symlink");

        let err = validate_export_destination(&link).unwrap_err();
        assert_eq!(err, DestinationRejected::AlreadyExists);
        assert_eq!(std::fs::read(&outside).expect("read"), b"outside");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_parent_is_resolved_before_the_write() {
        let (_real_guard, real) = tempdir();
        let (_link_guard, link_parent) = tempdir();
        let link_dir = link_parent.join("link");
        std::os::unix::fs::symlink(&real, &link_dir).expect("symlink dir");

        let validated =
            validate_export_destination(&link_dir.join("out.json")).expect("valid through link");
        assert_eq!(validated.path().parent(), Some(real.as_path()));
        write_hello(&validated).expect("write");
        assert!(real.join("out.json").exists());
    }

    /// `create_temp` and the copy fallback rely on `create_new` refusing a name
    /// already taken by a symlink. The temporary name is random, so this test
    /// plants a name of its own.
    #[cfg(unix)]
    #[test]
    fn create_new_refuses_a_symlink_instead_of_writing_through_it() {
        let (_guard, dir) = tempdir();
        let (_outside_guard, outside_dir) = tempdir();
        let outside = outside_dir.join("target.json");
        std::fs::write(&outside, b"outside").expect("seed");
        let planted = dir.join(".export-planted.tmp");
        std::os::unix::fs::symlink(&outside, &planted).expect("plant symlink");

        let err = File::options()
            .write(true)
            .create_new(true)
            .open(&planted)
            .expect_err("create_new refuses the planted symlink");

        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&outside).expect("read"), b"outside");
    }

    /// The fallback for a volume with neither a no-replace rename nor hard
    /// links, exercised on whatever volume the temp dir is on.
    #[cfg(unix)]
    #[test]
    fn the_copy_fallback_fills_a_free_name_and_never_replaces_a_taken_one() {
        let (_guard, dir) = tempdir();
        let mut temp = tempfile::tempfile_in(&dir).expect("temp");
        temp.write_all(b"export").expect("write temp");

        let free = dir.join("free.json");
        copy_into_new(&mut temp, &free, |_| {}).expect("copy into a free name");
        assert_eq!(std::fs::read(&free).expect("read"), b"export");

        let taken = dir.join("taken.json");
        std::fs::write(&taken, b"user data").expect("seed");
        let err = copy_into_new(&mut temp, &taken, |_| {}).expect_err("taken name refused");
        assert!(
            matches!(err, ExportWriteError::Rejected(DestinationRejected::AlreadyExists)),
            "{err:?}"
        );
        assert_eq!(std::fs::read(&taken).expect("read"), b"user data");
    }

    /// Serves `bytes` once and then fails, like a copy that runs out of space
    /// part-way through.
    #[cfg(unix)]
    struct FailsAfter<'a> {
        bytes: &'a [u8],
        served: bool,
    }

    #[cfg(unix)]
    impl io::Read for FailsAfter<'_> {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.served {
                return Err(io::Error::other("the copy ran out of space"));
            }
            let n = self.bytes.len().min(buf.len());
            buf[..n].copy_from_slice(&self.bytes[..n]);
            self.served = true;
            Ok(n)
        }
    }

    #[cfg(unix)]
    impl io::Seek for FailsAfter<'_> {
        fn seek(&mut self, _: io::SeekFrom) -> io::Result<u64> {
            Ok(0)
        }
    }

    /// A copy that fails after writing part of the export empties the file it
    /// created, leaves that same file at the name, and says so with its path.
    #[cfg(unix)]
    #[test]
    fn a_copy_failing_part_way_empties_its_own_file_and_reports_it() {
        use std::os::unix::fs::MetadataExt;

        let (_guard, dir) = tempdir();
        let dest = dir.join("out.json");
        let mut source = FailsAfter { bytes: b"partial export", served: false };
        let mut before = None;

        let err = copy_into_new(&mut source, &dest, |final_path| {
            let claimed = final_path.symlink_metadata().expect("claimed file");
            before = Some((claimed.ino(), claimed.len()));
        })
        .expect_err("copy fails");

        let (ino, written) = before.expect("cleanup ran");
        assert_eq!(written, 14, "the copy wrote part of the export before failing");
        match &err {
            ExportWriteError::LeftUnfinished(file) => {
                assert_eq!(file.path(), dest);
                assert_eq!(file.source.to_string(), "the copy ran out of space");
                assert!(file.emptied);
            }
            other => panic!("expected LeftUnfinished, got {other:?}"),
        }
        assert!(err.to_string().contains("an empty file remains at"), "{err}");
        let left = dest.symlink_metadata().expect("the export's own file stays");
        assert_eq!((left.ino(), left.len()), (ino, 0), "the same file, emptied");
        let names: Vec<PathBuf> =
            std::fs::read_dir(&dir).expect("read dir").map(|e| e.expect("entry").path()).collect();
        assert_eq!(names, [dest]);
    }

    /// An entry another process swaps in under the name just before a failed
    /// copy's cleanup acts is kept, and the error does not point the user at
    /// it as the export's leftover: the name no longer holds the export's file.
    #[cfg(unix)]
    #[test]
    fn a_failed_copy_keeps_an_entry_swapped_in_just_before_its_cleanup() {
        let (_guard, dir) = tempdir();
        let dest = dir.join("out.json");
        let theirs = dir.join("theirs");
        let mut source = FailsAfter { bytes: b"partial export", served: false };

        let err = copy_into_new(&mut source, &dest, |final_path| {
            std::fs::write(&theirs, b"another process").expect("seed");
            std::fs::rename(&theirs, final_path).expect("swap another inode in");
        })
        .expect_err("copy fails");

        assert!(matches!(err, ExportWriteError::Io(_)), "{err:?}");
        assert_eq!(std::fs::read(&dest).expect("still there"), b"another process");
    }

    /// tempfile tries a hard link itself only after `EINVAL` or `ENOSYS` from
    /// the no-replace rename. A volume that answers it with `ENOTSUP` but has
    /// hard links still gets the atomic link, not the visible copy. Needs the
    /// temp dir on a volume with hard links; exFAT takes the copy instead.
    #[cfg(unix)]
    #[test]
    fn an_unsupported_no_replace_rename_publishes_by_hard_link_before_copying() {
        use std::os::unix::fs::MetadataExt;

        let (_guard, dir) = tempdir();
        let mut temp = tempfile::Builder::new().tempfile_in(&dir).expect("temp");
        temp.write_all(b"export").expect("write temp");
        let temp_path = temp.path().to_path_buf();
        let ino = temp.as_file().metadata().expect("temp metadata").ino();
        let dest = dir.join("out.json");
        let enotsup = io::Error::from_raw_os_error(rustix::io::Errno::NOTSUP.raw_os_error());

        settle_install(Err(tempfile::PersistError { error: enotsup, file: temp }), &dest)
            .expect("installed");

        assert_eq!(dest.symlink_metadata().expect("installed").ino(), ino, "linked, not copied");
        assert_eq!(std::fs::read(&dest).expect("read"), b"export");
        assert!(temp_path.symlink_metadata().is_err(), "the temporary name is removed");
    }

    /// The hard link refuses a taken name like every other route.
    #[cfg(unix)]
    #[test]
    fn an_unsupported_no_replace_rename_onto_a_taken_name_is_refused() {
        let (_guard, dir) = tempdir();
        let mut temp = tempfile::Builder::new().tempfile_in(&dir).expect("temp");
        temp.write_all(b"export").expect("write temp");
        let temp_path = temp.path().to_path_buf();
        let dest = dir.join("out.json");
        std::fs::write(&dest, b"user data").expect("seed");
        let enotsup = io::Error::from_raw_os_error(rustix::io::Errno::NOTSUP.raw_os_error());

        let err = settle_install(Err(tempfile::PersistError { error: enotsup, file: temp }), &dest)
            .expect_err("taken name refused");

        assert!(
            matches!(err, ExportWriteError::Rejected(DestinationRejected::AlreadyExists)),
            "{err:?}"
        );
        assert_eq!(std::fs::read(&dest).expect("read"), b"user data");
        assert!(temp_path.symlink_metadata().is_err(), "the temporary name is removed");
    }

    /// Pins which failures move on to the next install route (no-replace
    /// rename, then hard link, then copy): only an operation the volume lacks,
    /// never a taken name, a permission or argument error, or a cross-device
    /// move.
    #[cfg(unix)]
    #[test]
    fn only_an_unsupported_operation_moves_on_to_the_next_route() {
        use rustix::io::Errno;

        let moves_on =
            |errno: Errno| is_unsupported(&io::Error::from_raw_os_error(errno.raw_os_error()));
        for errno in [Errno::NOTSUP, Errno::OPNOTSUPP, Errno::NOSYS, Errno::PERM] {
            assert!(moves_on(errno), "{errno:?} moves on to the next route");
        }
        for errno in [Errno::EXIST, Errno::ACCESS, Errno::INVAL, Errno::XDEV] {
            assert!(!moves_on(errno), "{errno:?} is reported");
        }
        assert!(!is_unsupported(&io::Error::other("not an OS error")));
    }

    #[cfg(windows)]
    #[test]
    fn a_destination_differing_only_by_case_is_refused() {
        let (_guard, dir) = tempdir();
        std::fs::write(dir.join("Export.json"), b"original").expect("seed");

        let err = validate_export_destination(&dir.join("export.JSON")).unwrap_err();
        assert_eq!(err, DestinationRejected::AlreadyExists);
    }

    /// A case variant of the name planted just before the final step takes the
    /// name on a case-insensitive volume, so it is refused and kept.
    #[cfg(windows)]
    #[test]
    fn a_case_variant_created_just_before_the_final_step_is_kept() {
        let (_guard, dir) = tempdir();
        let validated = validate_export_destination(&dir.join("out.json")).expect("valid");
        let planted = dir.join("OUT.JSON");

        let err = validated
            .write_then_install(
                |f| f.write_all(b"export"),
                |_| std::fs::write(&planted, b"original").expect("plant case variant"),
            )
            .expect_err("final step refused");

        assert!(
            matches!(err, ExportWriteError::Rejected(DestinationRejected::AlreadyExists)),
            "{err:?}"
        );
        assert_eq!(std::fs::read(&planted).expect("read"), b"original");
        let names: Vec<std::ffi::OsString> = std::fs::read_dir(&dir)
            .expect("read dir")
            .map(|e| e.expect("entry").file_name())
            .collect();
        assert_eq!(names, ["OUT.JSON"], "the temporary file is removed");
    }

    #[cfg(windows)]
    #[test]
    fn a_unc_path_to_a_missing_share_is_refused() {
        let err = validate_export_destination(Path::new(r"\\127.0.0.1\no-such-share\out.json"))
            .unwrap_err();
        assert_eq!(err, DestinationRejected::ParentMissing);
    }

    #[cfg(not(windows))]
    #[test]
    fn a_unc_path_is_refused_as_relative_off_windows() {
        let err = validate_export_destination(Path::new(r"\\server\share\out.json")).unwrap_err();
        assert_eq!(err, DestinationRejected::NotAbsolute);
    }
}
