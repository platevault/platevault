// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Windows install: start the NSIS or MSI installer, which needs the app
//! to exit while it replaces the files. The arguments are the ones
//! `tauri-plugin-updater` passed in its default passive mode.

use std::path::PathBuf;
use std::process::Command;

use super::{InstallMode, Installed};
use crate::update::signature::Staged;
use crate::update::{Package, UpdateError};

pub(super) fn launch_installer(
    staged: &Staged,
    package: Package,
    mode: InstallMode,
) -> Result<Installed, UpdateError> {
    let relaunch = mode == InstallMode::Now;
    let mut command = if package == Package::Msi {
        let msiexec = std::env::var_os("SYSTEMROOT").map_or_else(
            || PathBuf::from("msiexec.exe"),
            |root| PathBuf::from(root).join(r"System32\msiexec.exe"),
        );
        let mut command = Command::new(msiexec);
        command.arg("/i").arg(staged.file()).args(["/passive", "/promptrestart"]);
        if relaunch {
            command.arg("AUTOLAUNCHAPP=True");
        }
        command
    } else {
        // `/P` passive, `/UPDATE` skips the first-install steps, `/R` starts
        // the app once the install is done.
        let mut command = Command::new(staged.file());
        command.args(["/P", "/UPDATE"]);
        if relaunch {
            command.arg("/R");
        }
        command
    };
    command.spawn().map_err(|error| {
        UpdateError::Install(format!(
            "the {} installer did not start: {error}",
            package.manifest_name()
        ))
    })?;
    // The installer reads the payload after this process has exited.
    staged.keep();
    Ok(Installed::Handoff)
}
