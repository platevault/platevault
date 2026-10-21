// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Linux kernel file handle of a filesystem entry (astro-plan-yju9s), as
//! `name_to_handle_at(2)` encodes it, for the file IDs `PlateVault` records
//! (`platevault_model::FileIdentity::unix_file_id`).
//!
//! ext4 hands a just-freed inode number to the next entry created, so an
//! inode number alone reads an entry made in place of a recorded one as that
//! entry. The handle a filesystem encodes for an inode also carries its
//! generation, which ext4, xfs and btrfs change whenever they reuse an inode
//! number, and is what an NFS server gives out to name a file across its
//! restarts, so it tells the two apart and stays the same over a remount.
//!
//! Where no handle can be read the entry reads as having none, `Ok(None)`,
//! and the caller records the inode number alone, which can't tell a reused
//! number apart and never matches an ID with a handle
//! (`platevault_model::file_ids_match`), so a read refused at one check
//! and not another fails closed:
//! - `EOPNOTSUPP`: the filesystem encodes no handles (cifs, for one);
//! - `ENOSYS`: the kernel lacks the call;
//! - `EPERM`: a sandbox forbids it (Docker's default seccomp profile does);
//! - `EOVERFLOW`: the entry's handle doesn't fit `MAX_HANDLE_SZ`, or it
//!   can't be encoded at all (an nfs4 automount point not yet mounted).
//!
//! Other Unix platforms have no such call and always read no handle.
//!
//! XFS encodes another handle type on an `inode32` mount than on an
//! `inode64` one, so after a remount with the other option no file ID
//! recorded with a handle matches again: a registered root on that volume
//! reads as not the registered folder (an identity conflict, no scan), and
//! its recorded files as changed, until the location is registered again.
//! An ID recorded without a handle matches only an ID read without one.
//!
//! The crate allows `unsafe` at that one call, so `platevault_core` and
//! `persistence_library` keep the workspace `forbid`.
#![cfg(unix)]

use std::io;
use std::os::fd::AsFd;
use std::path::Path;

/// The handle of the entry at `path`, never following a link it names: a
/// link's own handle, never its target's. The text is the handle type and its
/// bytes in hex, joined by `-`; it never holds a `:`.
///
/// # Errors
/// The entry can't be reached (`NotFound`, `PermissionDenied`, ...), or the
/// path holds a NUL (`InvalidInput`). An entry whose handle can't be read
/// (see the crate docs) is `Ok(None)`, not an error.
pub fn of_path(path: &Path) -> io::Result<Option<String>> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::ffi::OsStrExt;
        let path = std::ffi::CString::new(path.as_os_str().as_bytes())?;
        linux::encode(libc::AT_FDCWD, &path, 0, linux::ROOM)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        Ok(None)
    }
}

/// The handle of the entry `file` holds open, encoded as [`of_path`] does.
///
/// # Errors
/// The handle can't be read for the open entry; an entry whose handle can't
/// be read (see the crate docs) is `Ok(None)`, not an error.
pub fn of_file(file: &impl AsFd) -> io::Result<Option<String>> {
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        linux::encode(file.as_fd().as_raw_fd(), c"", libc::AT_EMPTY_PATH, linux::ROOM)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = file.as_fd();
        Ok(None)
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::ffi::{c_int, CStr};
    use std::fmt::Write as _;
    use std::io;
    use std::os::fd::RawFd;

    /// The room for handle bytes: the kernel's `MAX_HANDLE_SZ`, the largest
    /// handle any filesystem encodes.
    pub const ROOM: u32 = 128;

    /// A `struct file_handle` followed by room for the largest handle.
    #[repr(C)]
    struct Buffer {
        header: libc::file_handle,
        bytes: [u8; ROOM as usize],
    }

    /// Whether `name_to_handle_at` failing with `errno` means the entry has no
    /// handle that can be read, rather than that it can't be reached.
    pub const fn no_handle(errno: c_int) -> bool {
        matches!(errno, libc::EOPNOTSUPP | libc::ENOSYS | libc::EPERM | libc::EOVERFLOW)
    }

    /// `name_to_handle_at(dir, path, .., flags)` with `room` handle bytes, at
    /// most [`ROOM`], encoded as text.
    pub fn encode(dir: RawFd, path: &CStr, flags: c_int, room: u32) -> io::Result<Option<String>> {
        let mut buffer = Buffer {
            header: libc::file_handle {
                handle_bytes: room.min(ROOM),
                handle_type: 0,
                f_handle: [],
            },
            bytes: [0; ROOM as usize],
        };
        let mut mount_id: c_int = 0;
        // SAFETY: `path` is NUL-terminated and outlives the call. The handle
        // pointer is derived from the whole `buffer`, a `#[repr(C)]`
        // `struct file_handle` followed by `ROOM` bytes, and `handle_bytes`,
        // at most `ROOM`, tells the kernel it may write no more than that
        // many bytes after the header (it fails with `EOVERFLOW` instead).
        // `mount_id` is a `c_int` the call writes. Neither pointer is kept
        // past the call.
        #[allow(unsafe_code)]
        let answer = unsafe {
            libc::name_to_handle_at(
                dir,
                path.as_ptr(),
                (&raw mut buffer).cast::<libc::file_handle>(),
                &raw mut mount_id,
                flags,
            )
        };
        if answer == -1 {
            let error = io::Error::last_os_error();
            return match error.raw_os_error() {
                Some(errno) if no_handle(errno) => Ok(None),
                _ => Err(error),
            };
        }
        let bytes = usize::try_from(buffer.header.handle_bytes)
            .ok()
            .and_then(|len| buffer.bytes.get(..len))
            .ok_or_else(|| io::Error::other("the kernel reported a handle longer than its room"))?;
        let mut text = format!("{:x}-", buffer.header.handle_type);
        for byte in bytes {
            let _ = write!(text, "{byte:02x}");
        }
        Ok(Some(text))
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::fs;
    use std::os::unix::fs::{symlink, MetadataExt};

    use super::*;

    fn handle(path: &Path) -> String {
        of_path(path).unwrap().expect("the test folder's filesystem encodes handles")
    }

    #[test]
    fn a_path_and_its_open_file_have_one_handle() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("frame.fits");
        fs::write(&path, b"frame").unwrap();
        let recorded = handle(&path);
        assert!(!recorded.contains(':'), "{recorded}");
        assert_eq!(of_file(&fs::File::open(&path).unwrap()).unwrap(), Some(recorded.clone()));
        let moved = temp.path().join("moved.fits");
        fs::rename(&path, &moved).unwrap();
        assert_eq!(handle(&moved), recorded, "a rename keeps it");
    }

    #[test]
    fn a_link_has_its_own_handle_not_its_targets() {
        let temp = tempfile::tempdir().unwrap();
        let (target, link) = (temp.path().join("target"), temp.path().join("link"));
        fs::write(&target, b"frame").unwrap();
        symlink(&target, &link).unwrap();
        assert_ne!(handle(&link), handle(&target));
    }

    /// The case an inode number alone can't tell apart: an entry removed and
    /// another made in its place, which ext4 gives the freed number.
    #[test]
    fn an_entry_made_in_place_of_a_removed_one_has_another_handle() {
        let temp = tempfile::tempdir().unwrap();
        let link = temp.path().join("link");
        symlink("frame.fits", &link).unwrap();
        let (inode, recorded) = (fs::symlink_metadata(&link).unwrap().ino(), handle(&link));
        fs::remove_file(&link).unwrap();
        symlink("frame.fits", &link).unwrap();
        let reused = fs::symlink_metadata(&link).unwrap().ino() == inode;
        assert_ne!(handle(&link), recorded, "inode number reused: {reused}");
    }

    #[test]
    fn a_missing_entry_is_an_error() {
        let temp = tempfile::tempdir().unwrap();
        let error = of_path(&temp.path().join("gone")).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
    }

    /// A handle that doesn't fit the room the call is given fails with
    /// `EOVERFLOW`, as one larger than `MAX_HANDLE_SZ` does: no handle.
    #[test]
    fn a_handle_that_does_not_fit_reads_as_none() {
        use std::os::unix::ffi::OsStrExt;
        let temp = tempfile::tempdir().unwrap();
        let path = std::ffi::CString::new(temp.path().as_os_str().as_bytes()).unwrap();
        assert!(linux::encode(libc::AT_FDCWD, &path, 0, linux::ROOM).unwrap().is_some());
        assert_eq!(linux::encode(libc::AT_FDCWD, &path, 0, 0).unwrap(), None);
    }

    /// A sandbox that forbids the call, a filesystem or kernel without it
    /// and an entry that can't be encoded read as no handle; an entry that
    /// can't be reached stays an error.
    #[test]
    fn only_an_unreadable_handle_reads_as_none() {
        for errno in [libc::EPERM, libc::EOVERFLOW, libc::EOPNOTSUPP, libc::ENOSYS] {
            assert!(linux::no_handle(errno), "{errno}");
        }
        for errno in [libc::ENOENT, libc::EACCES, libc::ENOTDIR, libc::ELOOP, libc::EINVAL] {
            assert!(!linux::no_handle(errno), "{errno}");
        }
    }
}
