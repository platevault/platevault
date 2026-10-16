// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Linux installs (decision D6: the `AppImage`, deb and rpm channels stay as
//! they are). Both run only once the user chose Install, so the deb/rpm
//! polkit prompt never appears before a click.
//!
//! Compiled on every Unix for tests; only Linux installs through it.

use std::fs::{self, File};
use std::path::Path;
use std::process::Command;

#[cfg(target_os = "linux")]
use super::Installed;
use crate::update::{Package, UpdateError};

const PKEXEC: &str = "/usr/bin/pkexec";
/// pkexec's exit status when the user dismissed the authentication dialog,
/// and when authorization was refused or could not be obtained (pkexec(1)).
#[cfg(target_os = "linux")]
const PKEXEC_NOT_AUTHORIZED: [i32; 2] = [126, 127];

/// Replace the running `AppImage`, which its runtime names in `$APPIMAGE`.
#[cfg(target_os = "linux")]
pub(super) fn replace_appimage(payload: &mut File) -> Result<Installed, UpdateError> {
    let target = std::env::var_os("APPIMAGE").map(std::path::PathBuf::from).ok_or_else(|| {
        UpdateError::Unsupported(
            "PlateVault is not running as an AppImage ($APPIMAGE is unset)".to_owned(),
        )
    })?;
    replace_file(&target, payload)?;
    Ok(Installed::Relaunch)
}

/// Write `payload` next to `target` and rename it over `target`, with
/// `target`'s permissions, so the path always holds a complete file and a
/// process running the old one keeps its open inode.
pub(super) fn replace_file(target: &Path, payload: &mut File) -> Result<(), UpdateError> {
    let dir = target.parent().ok_or_else(|| {
        UpdateError::Install(format!("{} has no parent directory", target.display()))
    })?;
    let permissions = fs::metadata(target)?.permissions();
    let mut replacement =
        tempfile::Builder::new().prefix(".platevault-update-").tempfile_in(dir)?;
    std::io::copy(payload, replacement.as_file_mut())?;
    replacement.as_file().sync_all()?;
    fs::set_permissions(replacement.path(), permissions)?;
    replacement.persist(target).map_err(|error| UpdateError::Io(error.error))?;
    Ok(())
}

/// Install a deb or rpm with `pkexec`, the polkit prompt the plugin used.
#[cfg(target_os = "linux")]
pub(super) fn install_package(path: &Path, package: Package) -> Result<Installed, UpdateError> {
    let status = package_command(package, path).status().map_err(|error| {
        UpdateError::Install(format!("cannot run {PKEXEC} to install the update: {error}"))
    })?;
    match status.code() {
        Some(0) => Ok(Installed::Relaunch),
        Some(code) if PKEXEC_NOT_AUTHORIZED.contains(&code) => Err(UpdateError::Permission(
            format!("{PKEXEC} was not authorized to install the update ({status})"),
        )),
        _ => Err(UpdateError::Install(format!(
            "the package manager did not install the update ({status})"
        ))),
    }
}

/// `pkexec` running `dpkg -i` or `rpm -U` on `path`, each by absolute path,
/// so nothing is looked up on the caller's `PATH`.
pub(super) fn package_command(package: Package, path: &Path) -> Command {
    let (tool, flag) =
        if package == Package::Rpm { ("/usr/bin/rpm", "-U") } else { ("/usr/bin/dpkg", "-i") };
    let mut command = Command::new(PKEXEC);
    command.arg(tool).arg(flag).arg(path);
    command
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::fs;
    use std::io::{Read as _, Seek as _, Write as _};
    use std::os::unix::fs::PermissionsExt as _;
    use std::path::Path;

    use super::{package_command, replace_file};
    use crate::update::Package;

    fn args(command: &std::process::Command) -> Vec<&OsStr> {
        command.get_args().collect()
    }

    #[test]
    fn a_deb_installs_through_pkexec_dpkg_by_absolute_path() {
        let path = Path::new("/tmp/platevault-update-payload-x/update.deb");
        let command = package_command(Package::Deb, path);
        assert_eq!(command.get_program(), "/usr/bin/pkexec");
        assert_eq!(
            args(&command),
            ["/usr/bin/dpkg", "-i", path.as_os_str().to_str().expect("utf-8")]
        );
    }

    #[test]
    fn an_rpm_installs_through_pkexec_rpm_by_absolute_path() {
        let path = Path::new("/tmp/it's a \"dir\"/update.rpm");
        let command = package_command(Package::Rpm, path);
        assert_eq!(command.get_program(), "/usr/bin/pkexec");
        // One argument each, whatever the path holds: no shell parses them.
        assert_eq!(
            args(&command),
            [OsStr::new("/usr/bin/rpm"), OsStr::new("-U"), path.as_os_str()]
        );
    }

    #[test]
    fn the_appimage_is_replaced_in_place_with_its_permissions() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("PlateVault.AppImage");
        fs::write(&target, b"old image").expect("old image");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o750)).expect("mode");
        let mut running = fs::File::open(&target).expect("the running copy");
        let mut payload = tempfile::tempfile().expect("payload");
        payload.write_all(b"new image").expect("payload bytes");
        payload.rewind().expect("rewind");

        replace_file(&target, &mut payload).expect("replace");

        assert_eq!(fs::read(&target).expect("target"), b"new image");
        assert_eq!(
            fs::metadata(&target).expect("metadata").permissions().mode() & 0o777,
            0o750,
            "the permissions carry over"
        );
        let mut old = Vec::new();
        running.read_to_end(&mut old).expect("read the old inode");
        assert_eq!(old, b"old image", "the running copy keeps its inode");
        let left: Vec<_> = fs::read_dir(dir.path()).expect("dir").collect();
        assert_eq!(left.len(), 1, "no temporary file is left next to the image");
    }

    #[test]
    fn a_missing_appimage_is_not_replaced() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("PlateVault.AppImage");
        let mut payload = tempfile::tempfile().expect("payload");
        assert!(replace_file(&target, &mut payload).is_err());
        assert!(!target.exists());
        assert_eq!(fs::read_dir(dir.path()).expect("dir").count(), 0);
    }
}
