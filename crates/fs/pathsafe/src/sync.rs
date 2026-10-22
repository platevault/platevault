// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Durably flush files and folders on the volume that owns them.

use std::fs::File;
use std::io;

/// Flush what `file` holds to its volume, as `File::sync_all` does. On
/// macOS `sync_all` is `fcntl(F_FULLFSYNC)`, which only some file systems
/// implement: smbfs answers `ENOTSUP` for files and folders alike
/// (astro-plan-wdlol), so writes to a share would fail. Where the volume has
/// no full sync, this falls back to `fsync`, the strongest sync it has
/// (smbfs sends it to the server as a flush), as SQLite's `fullfsync` does.
/// On a local volume whose drive refuses a cache flush, fallback `fsync` is
/// the volume's own limit, as SQLite accepts. Any other error from the full
/// sync or its `fsync` fallback is returned.
///
/// # Errors
/// Returns the underlying I/O error unless an unsupported full-sync operation
/// is followed by a successful `fsync` fallback.
pub fn sync(file: &File) -> io::Result<()> {
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
    file: &File,
    full: impl Fn(&File) -> rustix::io::Result<()>,
) -> io::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A volume without a full sync (macOS smbfs answers `F_FULLFSYNC` with
    /// `ENOTSUP`) is synced with `fsync` instead, and a full sync that fails
    /// any other way fails the sync.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_volume_without_a_full_sync_is_synced_with_fsync() {
        use rustix::io::Errno;

        let temp = tempfile::tempdir().unwrap();
        let copy = File::create(temp.path().join("copy")).unwrap();
        let asked = std::cell::Cell::new(0);
        let without_full_sync = |_: &File| {
            asked.set(asked.get() + 1);
            Err(Errno::NOTSUP)
        };
        full_sync_or_fsync(&copy, without_full_sync).unwrap();
        assert_eq!(asked.get(), 1, "the full sync is asked once");

        let error = full_sync_or_fsync(&copy, |_: &File| Err(Errno::IO)).unwrap_err();
        assert_eq!(error.raw_os_error(), Some(Errno::IO.raw_os_error()), "{error}");
    }
}
