// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Windows rename that never replaces its destination (astro-plan-nfsgg,
//! STO-FR-12, PREP-FR-06), for files and folders alike.
//!
//! [`move_noreplace`] is `MoveFileExW(from, to, 0)`: without
//! `MOVEFILE_REPLACE_EXISTING` the call fails when anything already holds
//! `to`, an empty folder included, and the filesystem makes that refusal as
//! part of the rename (`FILE_RENAME_INFORMATION` with `ReplaceIfExists`
//! false), so no other process can take the name between a check and the
//! move. Without `MOVEFILE_COPY_ALLOWED` it never copies: a folder moves
//! with its children on one volume, and a move to another volume fails. A
//! link moves as the link itself; nothing is done to what it points to.
//!
//! `std::fs::rename` is no substitute: on Windows 10 1607 and later it
//! replaces an empty folder where the volume supports `FileRenameInfoEx`.
//! tempfile's `persist_noclobber` reaches the same `MoveFileExW`, but first
//! sets the source's attributes through its path, which follows a link to
//! the file it names.
//!
//! The crate allows `unsafe` at that one call, so `platevault_core` keeps the
//! workspace `forbid`. On every other target it is empty.
#![cfg(windows)]

use std::borrow::Cow;
use std::ffi::{OsStr, OsString};
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::{Component, Path, Prefix};

use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

/// Move `from` to `to` on one volume, refusing if anything is at `to`.
///
/// An absolute path reaches `MoveFileExW` in its `\\?\` form
/// ([`long_path`]), so a path longer than `MAX_PATH` moves as it does
/// through `std::fs::rename`, without the process opting in to long paths;
/// a failure never moves anything.
///
/// # Errors
/// `AlreadyExists` (`ERROR_ALREADY_EXISTS`, `ERROR_FILE_EXISTS`) when `to`
/// is taken; `InvalidInput` when a path holds a NUL; otherwise the error
/// `MoveFileExW` reports, such as `ERROR_NOT_SAME_DEVICE` for another volume.
pub fn move_noreplace(from: &Path, to: &Path) -> io::Result<()> {
    let (from, to) = (wide(&long_path(from))?, wide(&long_path(to))?);
    // SAFETY: `from` and `to` are NUL-terminated UTF-16 buffers that outlive
    // the call, and `MoveFileExW` only reads them during it.
    #[allow(unsafe_code)]
    let moved = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// `path` in the `\\?\` form that lifts the `MAX_PATH` limit:
/// `\\?\C:\…` for a drive path, `\\?\UNC\server\share\…` for a share. Win32
/// doesn't normalize such a path, so it is built only from an absolute path
/// of plain names, joined with `\`; any other path (relative, holding `.`
/// or `..`, already verbatim, or a device path) is passed as given.
fn long_path(path: &Path) -> Cow<'_, OsStr> {
    let given = Cow::Borrowed(path.as_os_str());
    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else { return given };
    let mut long = OsString::new();
    match prefix.kind() {
        Prefix::Disk(letter) => {
            long.push(r"\\?\");
            long.push(format!("{}:", char::from(letter)));
        }
        Prefix::UNC(server, share) => {
            long.push(r"\\?\UNC\");
            long.push(server);
            long.push(r"\");
            long.push(share);
        }
        _ => return given,
    }
    if components.next() != Some(Component::RootDir) {
        return given;
    }
    let mut named = false;
    for component in components {
        let Component::Normal(name) = component else { return given };
        long.push(r"\");
        long.push(name);
        named = true;
    }
    if !named {
        long.push(r"\");
    }
    Cow::Owned(long)
}

/// `path` as the NUL-terminated UTF-16 string Win32 takes; a NUL inside it
/// would end the string early and name another path.
fn wide(path: &OsStr) -> io::Result<Vec<u16>> {
    let mut wide: Vec<u16> = path.encode_wide().collect();
    if wide.contains(&0) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "the path holds a NUL"));
    }
    wide.push(0);
    Ok(wide)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn folder_with_a_file(temp: &tempfile::TempDir) -> (std::path::PathBuf, std::path::PathBuf) {
        let from = temp.path().join("View");
        fs::create_dir(&from).unwrap();
        fs::write(from.join("Light_001.fits"), b"old view").unwrap();
        (from, temp.path().join("View (previous)"))
    }

    #[test]
    fn a_folder_moves_onto_a_free_name() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = folder_with_a_file(&temp);
        move_noreplace(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read(to.join("Light_001.fits")).unwrap(), b"old view");
    }

    #[test]
    fn a_folder_never_replaces_a_folder_empty_or_not() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = folder_with_a_file(&temp);
        fs::create_dir(&to).unwrap();
        let error = move_noreplace(&from, &to).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        fs::write(to.join("theirs.txt"), b"theirs").unwrap();
        let error = move_noreplace(&from, &to).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        assert_eq!(fs::read(from.join("Light_001.fits")).unwrap(), b"old view");
        assert_eq!(fs::read(to.join("theirs.txt")).unwrap(), b"theirs");
    }

    #[test]
    fn a_file_never_replaces_a_file() {
        let temp = tempfile::tempdir().unwrap();
        let (from, to) = (temp.path().join("a.fits"), temp.path().join("b.fits"));
        fs::write(&from, b"ours").unwrap();
        fs::write(&to, b"theirs").unwrap();
        let error = move_noreplace(&from, &to).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        assert_eq!(fs::read(&from).unwrap(), b"ours");
        assert_eq!(fs::read(&to).unwrap(), b"theirs");
    }

    #[test]
    fn a_path_holding_a_nul_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let (from, _) = folder_with_a_file(&temp);
        let error = move_noreplace(&from, &temp.path().join("View\0x")).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert!(from.exists());
    }

    #[test]
    fn absolute_paths_take_their_long_form_and_others_stay_as_given() {
        let long = |path: &str| long_path(Path::new(path)).into_owned();
        assert_eq!(long(r"C:\Work\View"), OsString::from(r"\\?\C:\Work\View"));
        assert_eq!(long("C:/Work/View"), OsString::from(r"\\?\C:\Work\View"));
        assert_eq!(long(r"\\nas\astro\View"), OsString::from(r"\\?\UNC\nas\astro\View"));
        assert_eq!(long(r"C:\"), OsString::from(r"\\?\C:\"));
        for given in [r"\\?\C:\Work", r"Work\View", r"C:Work", r"C:\Work\..\View", r"\\.\COM1"] {
            assert_eq!(long(given), OsString::from(given), "{given}");
        }
    }

    /// astro-plan-nfsgg: a move whose paths pass `MAX_PATH` (260) succeeds,
    /// as it does through `std::fs::rename`.
    #[test]
    fn a_folder_moves_where_its_path_is_longer_than_max_path() {
        let temp = tempfile::tempdir().unwrap();
        let mut deep = temp.path().to_path_buf();
        while deep.as_os_str().len() < 300 {
            deep.push("a-folder-name-of-forty-characters-long-x");
        }
        fs::create_dir_all(&deep).unwrap();
        let (from, to) = (deep.join("View"), deep.join("View (previous)"));
        fs::create_dir(&from).unwrap();
        fs::write(from.join("Light_001.fits"), b"old view").unwrap();
        move_noreplace(&from, &to).unwrap();
        assert_eq!(fs::read(to.join("Light_001.fits")).unwrap(), b"old view");
        fs::create_dir(&from).unwrap();
        let error = move_noreplace(&to, &from).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
    }
}
