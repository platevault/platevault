// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Windows install: start the NSIS or MSI installer, which needs the app
//! to exit while it replaces the files. The arguments are the ones
//! `tauri-plugin-updater` passed in its default passive mode.
//!
//! Compiled everywhere for tests; only Windows installs through it.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::InstallMode;
#[cfg(windows)]
use super::Installed;
#[cfg(windows)]
use crate::update::signature::Payload;
use crate::update::Package;
#[cfg(windows)]
use crate::update::UpdateError;

/// Where Windows is when `%SystemRoot%` is unset.
const DEFAULT_SYSTEM_ROOT: &str = r"C:\Windows";

#[cfg(windows)]
pub(super) fn launch_installer(
    payload: &Payload<'_>,
    package: Package,
    mode: InstallMode,
) -> Result<Installed, UpdateError> {
    installer_command(package, payload.path(), mode, std::env::var_os("SYSTEMROOT"))
        .spawn()
        .map_err(|error| {
            UpdateError::Install(format!(
                "the {} installer did not start: {error}",
                package.manifest_name()
            ))
        })?;
    // The installer reads the payload after this process has exited; a later
    // run removes the directory (`signature::remove_stale_payloads`).
    payload.keep();
    Ok(Installed::Handoff)
}

/// The installer process for `package` at `installer`. Each argument is
/// passed on its own, and `Command` quotes it for the Windows command line.
/// `msiexec` is named by absolute path under `system_root`.
pub(super) fn installer_command(
    package: Package,
    installer: &Path,
    mode: InstallMode,
    system_root: Option<OsString>,
) -> Command {
    let relaunch = mode == InstallMode::Now;
    if package == Package::Msi {
        let msiexec = PathBuf::from(system_root.unwrap_or_else(|| DEFAULT_SYSTEM_ROOT.into()))
            .join("System32")
            .join("msiexec.exe");
        let mut command = Command::new(msiexec);
        command.arg("/i").arg(installer).args(["/passive", "/promptrestart"]);
        if relaunch {
            command.arg("AUTOLAUNCHAPP=True");
        }
        command
    } else {
        // `/P` passive, `/UPDATE` skips the first-install steps, `/R` starts
        // the app once the install is done.
        let mut command = Command::new(installer);
        command.args(["/P", "/UPDATE"]);
        if relaunch {
            command.arg("/R");
        }
        command
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    use super::installer_command;
    use crate::update::install::InstallMode;
    use crate::update::Package;

    const INSTALLER: &str =
        r"C:\Users\Some User\AppData\Local\Temp\platevault-update-payload-x\update.msi";

    fn args(command: &std::process::Command) -> Vec<&OsStr> {
        command.get_args().collect()
    }

    #[test]
    fn install_now_runs_the_nsis_installer_passively_and_restarts_the_app() {
        let installer = Path::new(r"C:\Temp\x\update-setup.exe");
        let command = installer_command(Package::Nsis, installer, InstallMode::Now, None);
        assert_eq!(command.get_program(), installer.as_os_str());
        assert_eq!(args(&command), ["/P", "/UPDATE", "/R"]);
    }

    #[test]
    fn install_on_quit_runs_the_nsis_installer_without_a_restart() {
        let installer = Path::new(r"C:\Temp\x\update-setup.exe");
        let command = installer_command(Package::Nsis, installer, InstallMode::OnQuit, None);
        assert_eq!(args(&command), ["/P", "/UPDATE"]);
    }

    #[test]
    fn the_msi_runs_through_msiexec_under_the_system_root() {
        let command = installer_command(
            Package::Msi,
            Path::new(INSTALLER),
            InstallMode::Now,
            Some(r"D:\Win".into()),
        );
        assert_eq!(
            command.get_program(),
            PathBuf::from(r"D:\Win").join("System32").join("msiexec.exe").as_os_str()
        );
        // The path stays one argument, spaces and all.
        assert_eq!(
            args(&command),
            ["/i", INSTALLER, "/passive", "/promptrestart", "AUTOLAUNCHAPP=True"]
        );
    }

    #[test]
    fn without_a_system_root_msiexec_is_still_an_absolute_path() {
        let command =
            installer_command(Package::Msi, Path::new(INSTALLER), InstallMode::OnQuit, None);
        assert_eq!(
            command.get_program(),
            PathBuf::from(r"C:\Windows").join("System32").join("msiexec.exe").as_os_str()
        );
        assert_eq!(args(&command), ["/i", INSTALLER, "/passive", "/promptrestart"]);
    }
}
