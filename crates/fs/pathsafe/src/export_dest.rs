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
    /// with neither (exFAT on macOS, some FUSE mounts) gets the destination
    /// claimed with `create_new` and the bytes copied in: still never a
    /// replacement, but the copy is visible while it is written. If the
    /// process dies during that copy, a truncated file remains at the
    /// destination name, and a retry to that name is refused as existing.
    ///
    /// The temporary file is removed on every path, a panic in `write`
    /// included.
    ///
    /// # Errors
    /// Returns [`ExportWriteError::Rejected`] with
    /// [`DestinationRejected::AlreadyExists`] when an entry took the
    /// destination name after validation, and [`ExportWriteError::Io`] for
    /// filesystem and serialisation failures.
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
        install(temp, &self.final_path)?;
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

/// Moves `temp` onto `final_path` unless an entry holds that name at that
/// moment.
#[cfg(unix)]
fn install(temp: NamedTempFile, final_path: &Path) -> Result<(), ExportWriteError> {
    let temp_path = temp.path().to_path_buf();
    match temp.persist_noclobber(final_path) {
        Ok(installed) => {
            // The hard-link route ignores a failed removal of the temporary
            // name, which would stay behind as a second link to the export.
            remove_if_names(&temp_path, &installed);
            Ok(())
        }
        Err(mut failed) if lacks_no_replace_primitives(&failed.error) => {
            copy_into_new(failed.file.as_file_mut(), final_path)
        }
        Err(failed) => Err(refusal_or_io(failed.error, final_path)),
    }
}

/// Moves `temp` onto `final_path` unless an entry holds that name at that
/// moment. `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` works on every
/// Windows volume, FAT32 and exFAT included, and leaves no second name.
#[cfg(not(unix))]
fn install(temp: NamedTempFile, final_path: &Path) -> Result<(), ExportWriteError> {
    match temp.persist_noclobber(final_path) {
        Ok(_) => Ok(()),
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

/// Whether `persist_noclobber` failed because the volume offers neither a
/// no-replace rename nor hard links. It reports the hard link's error after a
/// rename the volume rejects as `EINVAL`, and the rename's error otherwise:
/// macOS exFAT answers `RENAME_EXCL` with `ENOTSUP`, Linux reports a volume
/// without hard links as `EPERM`, and a FUSE server lacking either operation
/// answers `ENOSYS`.
#[cfg(unix)]
fn lacks_no_replace_primitives(error: &io::Error) -> bool {
    use rustix::io::Errno;

    Errno::from_io_error(error).is_some_and(|errno| {
        [Errno::NOTSUP, Errno::OPNOTSUPP, Errno::NOSYS, Errno::PERM].contains(&errno)
    })
}

/// Claims `final_path` with `create_new`, which fails on any entry already
/// there, and copies the synced temporary file into it.
///
/// Only for a Unix volume that offers neither a no-replace rename nor hard
/// links: nothing at the name is ever replaced, but unlike a rename a reader
/// can see the copy while it is written. A copy that fails part-way is removed
/// while the name still holds it. If the process dies during the copy, a
/// truncated file remains at the destination name.
#[cfg(unix)]
fn copy_into_new(temp: &mut File, final_path: &Path) -> Result<(), ExportWriteError> {
    use std::io::{Seek, SeekFrom};

    let mut out = File::options()
        .write(true)
        .create_new(true)
        .open(final_path)
        .map_err(|e| refusal_or_io(e, final_path))?;
    let copied = temp
        .seek(SeekFrom::Start(0))
        .and_then(|_| io::copy(temp, &mut out))
        .and_then(|_| out.sync_all());
    if let Err(e) = copied {
        remove_if_names(final_path, &out);
        return Err(e.into());
    }
    Ok(())
}

/// Removes `path` only while it still names `file`, so an entry another
/// process put at that name is left alone.
#[cfg(unix)]
fn remove_if_names(path: &Path, file: &File) {
    use std::os::unix::fs::MetadataExt;

    if let (Ok(named), Ok(held)) = (path.symlink_metadata(), file.metadata()) {
        if (named.dev(), named.ino()) == (held.dev(), held.ino()) {
            let _ = std::fs::remove_file(path);
        }
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
        copy_into_new(&mut temp, &free).expect("copy into a free name");
        assert_eq!(std::fs::read(&free).expect("read"), b"export");

        let taken = dir.join("taken.json");
        std::fs::write(&taken, b"user data").expect("seed");
        let err = copy_into_new(&mut temp, &taken).expect_err("taken name refused");
        assert!(
            matches!(err, ExportWriteError::Rejected(DestinationRejected::AlreadyExists)),
            "{err:?}"
        );
        assert_eq!(std::fs::read(&taken).expect("read"), b"user data");
    }

    /// A copy that fails after the name is claimed removes the file it
    /// created. A write-only temporary file makes the copy's read fail with
    /// `EBADF` once `create_new` has succeeded.
    #[cfg(unix)]
    #[test]
    fn a_failed_copy_removes_the_file_it_claimed() {
        let (_guard, dir) = tempdir();
        let temp_path = dir.join("temp");
        let mut temp = File::options().write(true).create_new(true).open(&temp_path).expect("temp");
        temp.write_all(b"export").expect("write temp");
        let dest = dir.join("out.json");

        let err = copy_into_new(&mut temp, &dest).expect_err("copy fails");

        let ebadf = rustix::io::Errno::BADF.raw_os_error();
        assert!(
            matches!(&err, ExportWriteError::Io(e) if e.raw_os_error() == Some(ebadf)),
            "{err:?}"
        );
        assert!(dest.symlink_metadata().is_err(), "the claimed name is removed");
        let left: Vec<PathBuf> =
            std::fs::read_dir(&dir).expect("read dir").map(|e| e.expect("entry").path()).collect();
        assert_eq!(left, [temp_path]);
    }

    /// The cleanup removes a name only while it holds the file the export
    /// created; an entry another process swapped in under that name stays.
    #[cfg(unix)]
    #[test]
    fn cleanup_leaves_an_entry_swapped_in_under_the_name() {
        let (_guard, dir) = tempdir();
        let dest = dir.join("out.json");
        let ours = File::options().write(true).create_new(true).open(&dest).expect("claim");
        let theirs = dir.join("theirs");
        std::fs::write(&theirs, b"another process").expect("seed");
        std::fs::rename(&theirs, &dest).expect("swap another inode in under the name");

        remove_if_names(&dest, &ours);

        assert_eq!(std::fs::read(&dest).expect("still there"), b"another process");
    }

    /// Pins which `persist_noclobber` failures take the copy fallback: only a
    /// volume lacking the primitives, never a taken name, a permission or
    /// argument error, or a cross-device move.
    #[cfg(unix)]
    #[test]
    fn only_a_missing_primitive_routes_to_the_copy_fallback() {
        use rustix::io::Errno;

        let routed = |errno: Errno| {
            lacks_no_replace_primitives(&io::Error::from_raw_os_error(errno.raw_os_error()))
        };
        for errno in [Errno::NOTSUP, Errno::OPNOTSUPP, Errno::NOSYS, Errno::PERM] {
            assert!(routed(errno), "{errno:?} takes the copy fallback");
        }
        for errno in [Errno::EXIST, Errno::ACCESS, Errno::INVAL, Errno::XDEV] {
            assert!(!routed(errno), "{errno:?} is reported, not copied around");
        }
        assert!(!lacks_no_replace_primitives(&io::Error::other("not an OS error")));
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
