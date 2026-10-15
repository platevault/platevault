// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Linux installs (decision D6: the AppImage, deb and rpm channels stay as
//! they are). Both run only once the user chose Install, so the deb/rpm
//! polkit prompt never appears before a click.

use std::fs::{self, File};
use std::path::PathBuf;
use std::process::Command;

use super::Installed;
use crate::update::signature::Staged;
use crate::update::{Package, UpdateError};

/// Replace the running AppImage, which the AppImage runtime names in
/// `$APPIMAGE`. The new file is written next to it and renamed over it, so
/// the path always holds a complete AppImage; the running copy keeps its open
/// inode.
pub(super) fn replace_appimage(staged: &Staged) -> Result<Installed, UpdateError> {
    let target = std::env::var_os("APPIMAGE").map(PathBuf::from).ok_or_else(|| {
        UpdateError::Install(
            "PlateVault is not running as an AppImage ($APPIMAGE is unset)".to_owned(),
        )
    })?;
    let dir = target.parent().ok_or_else(|| {
        UpdateError::Install(format!("{} has no parent directory", target.display()))
    })?;
    let permissions = fs::metadata(&target)?.permissions();
    let mut replacement =
        tempfile::Builder::new().prefix(".platevault-update-").tempfile_in(dir)?;
    std::io::copy(&mut File::open(staged.file())?, replacement.as_file_mut())?;
    replacement.as_file().sync_all()?;
    fs::set_permissions(replacement.path(), permissions)?;
    replacement.persist(&target).map_err(|error| UpdateError::Io(error.error))?;
    Ok(Installed::Relaunch)
}

/// Install a deb or rpm with `pkexec`, the polkit prompt the plugin used.
pub(super) fn install_package(staged: &Staged, package: Package) -> Result<Installed, UpdateError> {
    let (tool, flag) = if package == Package::Rpm { ("rpm", "-U") } else { ("dpkg", "-i") };
    let status = Command::new("pkexec").arg(tool).arg(flag).arg(staged.file()).status().map_err(
        |error| UpdateError::Install(format!("cannot run pkexec to install the update: {error}")),
    )?;
    if status.success() {
        return Ok(Installed::Relaunch);
    }
    Err(UpdateError::Install(format!("pkexec {tool} {flag} did not install the update ({status})")))
}
