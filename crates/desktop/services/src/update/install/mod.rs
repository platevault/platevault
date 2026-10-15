// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Applying a verified payload on this machine.
//!
//! Every step here receives a [`Staged`] payload, which only exists once its
//! minisign signature verified, so nothing unverified reaches an installer.

#[cfg(any(target_os = "macos", all(test, unix)))]
mod bundle;
#[cfg(target_os = "macos")]
mod codesign;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;

use std::fs::File;
use std::io::Read as _;

#[cfg(all(test, unix))]
pub use self::bundle::{install_bundle, BundleInstaller, CodeSigning, Identity};
use super::signature::Staged;
use super::{Package, UpdateError};

/// When the install runs, which decides what follows it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstallMode {
    /// The user chose Install now: the app relaunches into the new version.
    Now,
    /// The app is quitting: nothing relaunches.
    OnQuit,
}

/// What the host does once an install succeeded.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Installed {
    /// The new version is in place; restart into it.
    #[cfg_attr(windows, allow(dead_code))]
    Relaunch,
    /// An installer process took over and needs the app to exit.
    #[cfg_attr(not(windows), allow(dead_code))]
    Handoff,
}

/// The OS side of the updater: the platform installer in the app, a fake in
/// tests.
pub trait Installer: Send + Sync {
    fn install(&self, staged: &Staged, mode: InstallMode) -> Result<Installed, UpdateError>;
}

/// The installer for the package this copy was installed from.
pub struct OsInstaller {
    package: Option<Package>,
}

impl OsInstaller {
    pub const fn new(package: Option<Package>) -> Self {
        Self { package }
    }
}

impl Installer for OsInstaller {
    #[cfg_attr(not(windows), allow(unused_variables))]
    fn install(&self, staged: &Staged, mode: InstallMode) -> Result<Installed, UpdateError> {
        let Some(package) = self.package else {
            return Err(UpdateError::Install(
                "this copy of PlateVault was not installed from a release package".to_owned(),
            ));
        };
        check_format(staged, package)?;
        match package {
            #[cfg(windows)]
            Package::Nsis | Package::Msi => windows::launch_installer(staged, package, mode),
            #[cfg(target_os = "macos")]
            Package::App => bundle::install_running_app(staged),
            #[cfg(target_os = "linux")]
            Package::AppImage => linux::replace_appimage(staged),
            #[cfg(target_os = "linux")]
            Package::Deb | Package::Rpm => linux::install_package(staged, package),
            other => Err(UpdateError::Install(format!(
                "a {} update cannot be installed on this operating system",
                other.manifest_name()
            ))),
        }
    }
}

/// Refuse a payload that is not the kind of file `package` installs, such as
/// a manifest entry that points at another bundle: its signature is valid,
/// but the install step would fail halfway or misread it.
fn check_format(staged: &Staged, package: Package) -> Result<(), UpdateError> {
    let magic: &[u8] = match package {
        Package::App => b"\x1f\x8b",
        Package::AppImage => b"\x7fELF",
        Package::Deb => b"!<arch>\n",
        Package::Rpm => b"\xed\xab\xee\xdb",
        Package::Nsis => b"MZ",
        Package::Msi => b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
    };
    let mut head = [0_u8; 8];
    let head = &mut head[..magic.len()];
    let read = File::open(staged.file()).and_then(|mut file| file.read_exact(head));
    if read.is_err() || head != magic {
        return Err(UpdateError::Install(format!(
            "the downloaded update is not a {} package",
            package.manifest_name()
        )));
    }
    Ok(())
}
