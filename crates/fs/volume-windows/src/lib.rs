// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The volume holding a path on Windows, read through Win32 calls
//! (astro-plan-f2di3): no process is spawned, so a probe costs microseconds
//! where the PowerShell CIM query it replaces took seconds.
//!
//! [`volume`] asks `GetVolumePathNameW` for the mount point of the volume
//! holding the path, a drive root such as `C:\` or a mounted folder such as
//! `C:\Volumes\Captures\`, then reads that root's file system name and serial
//! (`GetVolumeInformationW`), its drive type (`GetDriveTypeW`) and the
//! `\\?\Volume{GUID}\` name of the local volume mounted there
//! (`GetVolumeNameForVolumeMountPointW`). A mapped network drive answers with
//! the file system and serial its server reports for the share, and has no
//! such name; neither has a SUBST drive. The answer describes the volume the
//! path names; a caller that needs the volume an entry is actually on
//! compares the serial with the one a handle on the entry reports.
//! [`drive_type`] is `GetDriveTypeW` alone, for a drive letter's root.
//!
//! The crate allows `unsafe` at those four calls, so `platevault_core` keeps
//! the workspace `forbid`. On every other target it is empty.
#![cfg(windows)]

use std::ffi::{OsStr, OsString};
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use fs_pathsafe::long_path;

use windows_sys::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetVolumeInformationW, GetVolumeNameForVolumeMountPointW,
    GetVolumePathNameW,
};

/// `MAX_PATH`, the longest name `GetVolumeInformationW` reports.
const MAX_PATH: u32 = 260;

/// The volume holding a path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Volume {
    /// The volume's mount point, with its trailing `\`, as a plain drive path
    /// (`C:\`, `C:\Volumes\Captures\`) where Windows names it in its `\\?\`
    /// form.
    pub root: PathBuf,
    /// The file system name, such as `NTFS`, `ReFS`, `FAT32` or `exFAT`.
    pub filesystem: String,
    /// The volume serial number.
    pub serial: u32,
    /// The `GetDriveTypeW` answer: 2 removable, 3 fixed, 4 remote (a mapped
    /// share), 5 optical, 6 RAM disk; 0 or 1 where Windows cannot tell.
    pub drive_type: u32,
    /// The `\\?\Volume{GUID}\` name of the local volume mounted at `root`;
    /// `None` where `root` is no volume mount point, as for a mapped share or
    /// a SUBST drive.
    pub name: Option<OsString>,
}

/// The volume holding `path`.
///
/// An absolute path reaches `GetVolumePathNameW` in its `\\?\` form
/// ([`fs_pathsafe::long_path`]), so a path longer than `MAX_PATH` resolves as
/// a short one does. A relative path names the boot volume, as
/// `GetVolumePathNameW` documents, so a caller makes it absolute first.
///
/// # Errors
/// `InvalidInput` when the path holds a NUL; otherwise the error the failing
/// Win32 call reports, such as `ERROR_NOT_READY` for a drive without media.
pub fn volume(path: &Path) -> io::Result<Volume> {
    let path = wide(long_path(path).as_os_str())?;
    // The mount point is a prefix of the path plus at most a trailing `\`;
    // a relative path's boot volume root fits in `MAX_PATH`.
    let mut root = vec![0_u16; (path.len() + 1).max(MAX_PATH as usize + 1)];
    let capacity = u32::try_from(root.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "the path is too long"))?;
    // SAFETY: `path` is a NUL-terminated UTF-16 buffer and `root` a writable
    // one of `capacity` units; both outlive the call, which only reads `path`
    // and writes at most `capacity` units of `root` during it.
    #[allow(unsafe_code)]
    let found = unsafe { GetVolumePathNameW(path.as_ptr(), root.as_mut_ptr(), capacity) };
    if found == 0 {
        return Err(io::Error::last_os_error());
    }
    let root = plain_drive_root(until_nul(&root));
    let root_z = wide(&OsString::from_wide(root))?;

    let mut serial = 0_u32;
    let mut filesystem = [0_u16; MAX_PATH as usize + 1];
    // SAFETY: `root_z` is a NUL-terminated UTF-16 buffer, `serial` a writable
    // `u32` and `filesystem` a writable buffer of `MAX_PATH + 1` units, all
    // outliving the call; the null pointers are the optional outputs the call
    // documents as skipped when null, with a zero-length volume name buffer.
    #[allow(unsafe_code)]
    let read = unsafe {
        GetVolumeInformationW(
            root_z.as_ptr(),
            std::ptr::null_mut(),
            0,
            &raw mut serial,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            filesystem.as_mut_ptr(),
            MAX_PATH + 1,
        )
    };
    if read == 0 {
        return Err(io::Error::last_os_error());
    }

    // SAFETY: `root_z` is a NUL-terminated UTF-16 buffer that outlives the
    // call, which only reads it during it.
    #[allow(unsafe_code)]
    let drive_type = unsafe { GetDriveTypeW(root_z.as_ptr()) };

    let mut name = [0_u16; MAX_PATH as usize + 1];
    // SAFETY: `root_z` is a NUL-terminated UTF-16 buffer and `name` a
    // writable one of `MAX_PATH + 1` units; both outlive the call, which only
    // reads `root_z` and writes at most that many units of `name` during it.
    #[allow(unsafe_code)]
    let named = unsafe {
        GetVolumeNameForVolumeMountPointW(root_z.as_ptr(), name.as_mut_ptr(), MAX_PATH + 1)
    };
    let name = until_nul(&name);
    let prefix = r"\\?\Volume{".encode_utf16();
    let is_volume_name = name.iter().copied().take(prefix.clone().count()).eq(prefix);

    Ok(Volume {
        root: PathBuf::from(OsString::from_wide(root)),
        filesystem: String::from_utf16_lossy(until_nul(&filesystem)),
        serial,
        drive_type,
        name: (named != 0 && is_volume_name).then(|| OsString::from_wide(name)),
    })
}

/// The `GetDriveTypeW` answer for `root`, a root with its trailing `\` such
/// as `Z:\`; 1 (`DRIVE_NO_ROOT_DIR`) where nothing is mounted there.
///
/// # Errors
/// `InvalidInput` when the root holds a NUL.
pub fn drive_type(root: &Path) -> io::Result<u32> {
    let root = wide(root.as_os_str())?;
    // SAFETY: `root` is a NUL-terminated UTF-16 buffer that outlives the
    // call, which only reads it during it.
    #[allow(unsafe_code)]
    Ok(unsafe { GetDriveTypeW(root.as_ptr()) })
}

/// The total disk space available to the caller on the volume at `root`.
///
/// # Errors
/// `InvalidInput` when the root holds a NUL; otherwise the error reported by
/// `GetDiskFreeSpaceExW`. The returned total may be limited by a disk quota.
pub fn capacity(root: &Path) -> io::Result<u64> {
    let root = wide(root.as_os_str())?;
    let mut total = 0_u64;
    // SAFETY: `root` is a NUL-terminated UTF-16 buffer and `total` a writable
    // `u64`, both outliving the call; null pointers skip the optional outputs.
    #[allow(unsafe_code)]
    let found = unsafe {
        GetDiskFreeSpaceExW(
            root.as_ptr(),
            std::ptr::null_mut(),
            &raw mut total,
            std::ptr::null_mut(),
        )
    };
    if found == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(total)
}

/// A `\\?\X:\…` mount point in its plain `X:\…` form, which every volume
/// call takes; any other root is returned as given.
fn plain_drive_root(root: &[u16]) -> &[u16] {
    const VERBATIM: [u16; 4] = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    match root.strip_prefix(&VERBATIM[..]) {
        Some(drive @ [letter, colon, ..])
            if *colon == u16::from(b':')
                && u8::try_from(*letter).is_ok_and(|letter| letter.is_ascii_alphabetic()) =>
        {
            drive
        }
        _ => root,
    }
}

/// The units of a Win32 output buffer before its terminating NUL.
fn until_nul(buffer: &[u16]) -> &[u16] {
    buffer.iter().position(|&unit| unit == 0).map_or(buffer, |end| &buffer[..end])
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

    #[test]
    fn a_temp_folder_is_on_a_fixed_ntfs_drive_root() {
        let temp = tempfile::tempdir().unwrap();
        let volume = volume(temp.path()).unwrap();
        assert_eq!(volume.filesystem, "NTFS", "{volume:?}");
        assert_eq!(volume.drive_type, 3, "{volume:?}");
        assert!(temp.path().starts_with(&volume.root), "{volume:?}");
        assert!(volume.root.as_os_str().to_string_lossy().ends_with('\\'), "{volume:?}");
        let name = volume.name.as_ref().map(|name| name.to_string_lossy().into_owned());
        assert!(name.is_some_and(|name| name.starts_with(r"\\?\Volume{")), "{volume:?}");
        assert_eq!(drive_type(Path::new(&volume.root)).unwrap(), 3, "{volume:?}");
        assert_eq!(volume, super::volume(&volume.root).unwrap(), "the root names itself");
    }

    #[test]
    fn a_file_a_verbatim_path_and_a_long_path_name_the_same_volume() {
        let temp = tempfile::tempdir().unwrap();
        let expected = volume(temp.path()).unwrap();
        let file = temp.path().join("light_001.fits");
        fs::write(&file, b"frame").unwrap();
        assert_eq!(volume(&file).unwrap(), expected);

        let verbatim = fs::canonicalize(temp.path()).unwrap();
        assert!(verbatim.as_os_str().to_string_lossy().starts_with(r"\\?\"), "{verbatim:?}");
        assert_eq!(volume(&verbatim).unwrap(), expected, "a verbatim path's root is plain");

        let mut deep = temp.path().to_path_buf();
        while deep.as_os_str().len() < 300 {
            deep.push("a-folder-name-of-forty-characters-long-x");
        }
        fs::create_dir_all(&deep).unwrap();
        assert_eq!(volume(&deep).unwrap(), expected);
    }

    #[test]
    fn a_path_holding_a_nul_or_naming_no_volume_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let error = volume(&temp.path().join("light\0x")).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{error}");
        assert!(volume(Path::new(r"\\?\Volume{00000000-0000-0000-0000-000000000000}\")).is_err());
    }

    #[test]
    fn only_a_verbatim_drive_root_loses_its_prefix() {
        let units = |text: &str| text.encode_utf16().collect::<Vec<_>>();
        assert_eq!(plain_drive_root(&units(r"\\?\C:\")), units(r"C:\"));
        assert_eq!(plain_drive_root(&units(r"\\?\d:\mnt\")), units(r"d:\mnt\"));
        for given in [r"C:\", r"\\?\UNC\nas\astro\", r"\\?\Volume{1}\", r"\\server\share\"] {
            assert_eq!(plain_drive_root(&units(given)), units(given), "{given}");
        }
    }
}
