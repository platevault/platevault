// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Applying a verified payload on this machine.
//!
//! Every step here receives a [`Payload`], which [`Staged::reverify`] checked
//! against its minisign signature just before, so nothing unverified reaches
//! an installer. Every program an install runs is named by absolute path. A
//! step that runs as root checks the payload again once it holds those rights
//! (astro-plan-ryj83): the deb/rpm and macOS root scripts against
//! [`Payload`]'s size and SHA-256. The Windows installers are not re-checked
//! after the UAC prompt; they inherit the verified handle, which keeps
//! ordinary writers out until they exit but not code running as the user
//! (`windows::launch_installer`).
//!
//! [`Staged::reverify`]: super::signature::Staged::reverify

#[cfg(any(target_os = "macos", all(test, unix)))]
mod bundle;
#[cfg(target_os = "macos")]
mod codesign;
#[cfg(any(target_os = "linux", all(test, unix)))]
mod linux;
#[cfg(any(windows, test))]
mod windows;

use std::fs::File;
use std::io::{Read as _, Seek as _};

#[cfg(all(test, unix))]
pub use self::bundle::{install_bundle, BundleInstaller, CodeSigning, Identity, LaunchedBundle};
use super::signature::Payload;
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
    /// Install `payload`. `admin_prompt` is the text of the administrator
    /// prompt an install that needs more rights shows, where the OS lets the
    /// app word it (macOS); in the user's language.
    fn install(
        &self,
        payload: Payload<'_>,
        mode: InstallMode,
        admin_prompt: &str,
    ) -> Result<Installed, UpdateError>;
}

/// The app this process was launched from, read at startup. The macOS
/// install replaces that app or nothing (astro-plan-uyguq); elsewhere it
/// holds nothing.
#[derive(Clone, Debug)]
pub struct LaunchedApp {
    /// The bundle holding the running executable, or the English detail of
    /// why there is none, which a macOS install then fails with.
    #[cfg(target_os = "macos")]
    bundle: Result<bundle::LaunchedBundle, String>,
}

impl LaunchedApp {
    /// Read where this process was launched from. Call it first at startup:
    /// the app an update replaces must still be the one this read found.
    #[must_use]
    pub fn record() -> Self {
        Self {
            #[cfg(target_os = "macos")]
            bundle: bundle::LaunchedBundle::running().map_err(|error| error.to_string()),
        }
    }

    /// The launched bundle a macOS install replaces.
    #[cfg(target_os = "macos")]
    fn bundle(&self) -> Result<&bundle::LaunchedBundle, UpdateError> {
        self.bundle.as_ref().map_err(|reason| UpdateError::Install(reason.clone()))
    }
}

/// The installer for the package this copy was installed from.
pub struct OsInstaller {
    package: Option<Package>,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    launched: LaunchedApp,
}

impl OsInstaller {
    pub const fn new(package: Option<Package>, launched: LaunchedApp) -> Self {
        Self { package, launched }
    }
}

impl Installer for OsInstaller {
    #[cfg_attr(not(windows), allow(unused_variables))]
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    fn install(
        &self,
        mut payload: Payload<'_>,
        mode: InstallMode,
        admin_prompt: &str,
    ) -> Result<Installed, UpdateError> {
        let Some(package) = self.package else {
            return Err(UpdateError::Unsupported(
                "this copy of PlateVault was not installed from a release package".to_owned(),
            ));
        };
        check_format(payload.reader(), package)?;
        match package {
            #[cfg(windows)]
            Package::Nsis | Package::Msi => windows::launch_installer(&mut payload, package, mode),
            #[cfg(target_os = "macos")]
            Package::App => {
                bundle::install_launched_app(self.launched.bundle()?, &mut payload, admin_prompt)
            }
            #[cfg(target_os = "linux")]
            Package::AppImage => linux::replace_appimage(payload.reader()),
            #[cfg(target_os = "linux")]
            Package::Deb | Package::Rpm => linux::install_package(&mut payload, package),
            other => Err(UpdateError::Unsupported(format!(
                "a {} update cannot be installed on this operating system",
                other.manifest_name()
            ))),
        }
    }
}

/// Refuse a payload that is not the kind of file `package` installs, such as
/// a manifest entry that points at another bundle: its signature is valid,
/// but the install step would fail halfway or misread it. Leaves `file` at
/// its start.
fn check_format(file: &mut File, package: Package) -> Result<(), UpdateError> {
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
    let read = file.read_exact(head);
    file.rewind()?;
    if read.is_err() || head != magic {
        return Err(UpdateError::Manifest(format!(
            "the downloaded update is not a {} package",
            package.manifest_name()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::{Read as _, Write as _};

    use super::{check_format, InstallMode, Installer as _, LaunchedApp, OsInstaller};
    use crate::update::{Package, UpdateError};

    const PACKAGES: [(Package, &[u8]); 6] = [
        (Package::App, b"\x1f\x8b\x08\0rest of a gzip stream"),
        (Package::AppImage, b"\x7fELF\x02\x01\x01rest of an image"),
        (Package::Deb, b"!<arch>\ndebian-binary"),
        (Package::Rpm, b"\xed\xab\xee\xdb\x03\0rest of an rpm"),
        (Package::Nsis, b"MZ\x90\0rest of an exe"),
        (Package::Msi, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest of an msi"),
    ];

    fn file_holding(bytes: &[u8]) -> std::fs::File {
        let mut file = tempfile::tempfile().expect("temp file");
        file.write_all(bytes).expect("write");
        std::io::Seek::rewind(&mut file).expect("rewind");
        file
    }

    #[test]
    fn each_package_accepts_its_own_format_and_stays_at_the_start() {
        for (package, bytes) in PACKAGES {
            let mut file = file_holding(bytes);
            check_format(&mut file, package).unwrap_or_else(|error| panic!("{package:?}: {error}"));
            let mut read = Vec::new();
            file.read_to_end(&mut read).expect("read");
            assert_eq!(read, bytes, "{package:?}: the installer reads the whole file");
        }
    }

    #[test]
    fn a_payload_of_another_package_type_is_refused() {
        for (package, _) in PACKAGES {
            for (other, bytes) in PACKAGES.iter().filter(|(other, _)| *other != package) {
                let error = check_format(&mut file_holding(bytes), package)
                    .expect_err("another package's bytes");
                assert!(
                    matches!(&error, UpdateError::Manifest(message) if message.contains(package.manifest_name())),
                    "{package:?} given {other:?}: {error}"
                );
            }
        }
    }

    #[test]
    fn a_payload_shorter_than_its_magic_is_refused() {
        let error = check_format(&mut file_holding(b"\x7f"), Package::AppImage).expect_err("short");
        assert!(matches!(error, UpdateError::Manifest(_)), "{error}");
    }

    /// A staged payload for `package`, verified, for the OS installer.
    async fn staged(package: Package, bytes: &[u8]) -> crate::update::signature::Staged {
        crate::update::tests::stage(package, bytes).await
    }

    #[tokio::test]
    async fn a_build_without_a_package_cannot_install() {
        let staged = staged(Package::AppImage, b"\x7fELF").await;
        let error = OsInstaller::new(None, LaunchedApp::record())
            .install(staged.reverify().expect("verified"), InstallMode::Now, "")
            .expect_err("no package");
        assert!(matches!(error, UpdateError::Unsupported(_)), "{error}");
    }

    #[tokio::test]
    async fn a_package_this_os_does_not_install_is_refused() {
        let foreign = if cfg!(windows) { Package::Deb } else { Package::Msi };
        let bytes = PACKAGES.iter().find(|(package, _)| *package == foreign).expect("bytes").1;
        let staged = staged(foreign, bytes).await;
        let error = OsInstaller::new(Some(foreign), LaunchedApp::record())
            .install(staged.reverify().expect("verified"), InstallMode::Now, "")
            .expect_err("foreign package");
        assert!(
            matches!(&error, UpdateError::Unsupported(message) if message.contains(foreign.manifest_name())),
            "{error}"
        );
    }

    /// A test binary is not inside an `.app`, so its launch record says so,
    /// and the macOS install refuses to guess what to replace.
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn the_macos_install_needs_to_run_from_an_app_bundle() {
        let bytes = PACKAGES[0].1;
        let staged = staged(Package::App, bytes).await;
        let error = OsInstaller::new(Some(Package::App), LaunchedApp::record())
            .install(staged.reverify().expect("verified"), InstallMode::Now, "")
            .expect_err("not in a bundle");
        assert!(
            matches!(&error, UpdateError::Install(message) if message.contains("not inside an app bundle")),
            "{error}"
        );
    }
}
