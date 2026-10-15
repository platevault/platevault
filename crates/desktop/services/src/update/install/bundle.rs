// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The macOS install: swap the running `.app` for the verified update
//! (decision D4, astro-plan-eub2i).
//!
//! Before the swap, the new bundle must satisfy the installed app's
//! designated requirement: the identity its code signature pins. That is on
//! top of the minisign check, which already passed for every [`Staged`]
//! payload. Failing it aborts the swap and keeps the installed app.
//!
//! An ad-hoc signed (or unsigned) installed copy has no stable identity: its
//! designated requirement is its own code hash, which no other build
//! satisfies. The check is skipped for it, which is what lets ad-hoc installs
//! move to the self-signed identity once (astro-plan-sl25q).
//!
//! Compiled on every Unix for tests; only macOS installs through it.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;

#[cfg(test)]
use super::{InstallMode, Installed, Installer};
use crate::update::signature::Staged;
use crate::update::UpdateError;

/// The code-signing identity of an installed app.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Identity {
    /// Ad-hoc signed: no identity survives an update.
    AdHoc,
    Unsigned,
    /// Signed with a certificate; the designated requirement in `codesign`
    /// requirement language.
    Designated(String),
}

/// Reads and checks code signatures: `codesign` on macOS, a fake in tests.
pub trait CodeSigning: Send + Sync {
    /// How the app at `bundle` is signed.
    fn identity(&self, bundle: &Path) -> Result<Identity, UpdateError>;

    /// Whether the code at `bundle` has a valid signature that satisfies
    /// `requirement`.
    fn satisfies(&self, bundle: &Path, requirement: &str) -> Result<bool, UpdateError>;
}

/// Install `staged` over the app bundle this process runs from.
#[cfg(target_os = "macos")]
pub(super) fn install_running_app(staged: &Staged) -> Result<super::Installed, UpdateError> {
    let installed = running_app_bundle()?;
    install_bundle(&installed, staged.file(), &super::codesign::Codesign)?;
    Ok(super::Installed::Relaunch)
}

/// The `.app` directory holding this executable (`X.app/Contents/MacOS/x`).
#[cfg(target_os = "macos")]
fn running_app_bundle() -> Result<PathBuf, UpdateError> {
    let executable = std::env::current_exe()?;
    executable
        .ancestors()
        .nth(3)
        .filter(|bundle| bundle.extension().is_some_and(|extension| extension == "app"))
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            UpdateError::Install(format!(
                "{} is not inside an app bundle, so it cannot update itself",
                executable.display()
            ))
        })
}

/// Replace `installed` with the bundle in the `.app.tar.gz` at `archive`,
/// once the new bundle passes the identity check against `installed`.
/// `installed` is left as it was whenever this fails.
pub fn install_bundle(
    installed: &Path,
    archive: &Path,
    signing: &dyn CodeSigning,
) -> Result<(), UpdateError> {
    let identity = signing.identity(installed)?;
    let staging = staging_dir(installed)?;
    tar::Archive::new(GzDecoder::new(fs::File::open(archive)?)).unpack(staging.path())?;
    let update = single_bundle(staging.path())?;
    match &identity {
        Identity::Designated(requirement) => {
            if !signing.satisfies(&update, requirement)? {
                return Err(UpdateError::Identity(format!(
                    "the update is not signed by the identity of the installed app ({requirement})"
                )));
            }
        }
        Identity::AdHoc | Identity::Unsigned => tracing::info!(
            ?identity,
            "the installed app has no stable code-signing identity; skipping the designated-requirement check"
        ),
    }
    swap(installed, &update, &staging.path().join("previous.app"))?;
    #[cfg(target_os = "macos")]
    {
        // A fresh modification date makes Launch Services re-read the bundle.
        let _ = std::process::Command::new("/usr/bin/touch").arg(installed).status();
    }
    Ok(())
}

/// A private directory on the installed bundle's volume, so the swap is two
/// renames: the system temp dir when it is there, next to the app otherwise.
fn staging_dir(installed: &Path) -> Result<tempfile::TempDir, UpdateError> {
    use std::os::unix::fs::MetadataExt as _;

    let device = fs::symlink_metadata(installed)?.dev();
    let root = [Some(std::env::temp_dir()), installed.parent().map(Path::to_path_buf)]
        .into_iter()
        .flatten()
        .find(|dir| dir.metadata().is_ok_and(|metadata| metadata.dev() == device))
        .ok_or_else(|| {
            UpdateError::Install(
                "no temporary directory shares the installed app's volume".to_owned(),
            )
        })?;
    Ok(tempfile::Builder::new().prefix("platevault-update-app-").tempdir_in(root)?)
}

/// The one `.app` directory the archive unpacked into `dir`.
fn single_bundle(dir: &Path) -> Result<PathBuf, UpdateError> {
    let mut bundles = fs::read_dir(dir)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<io::Result<Vec<_>>>()?
        .into_iter()
        .filter(|path| {
            path.extension().is_some_and(|extension| extension == "app") && path.is_dir()
        });
    match (bundles.next(), bundles.next()) {
        (Some(bundle), None) => Ok(bundle),
        _ => Err(UpdateError::Install(
            "the update archive does not hold exactly one app bundle".to_owned(),
        )),
    }
}

/// Move `update` to `installed`, parking the current bundle at `backup`
/// (inside the staging directory, which is removed afterwards). A failed
/// second move puts the current bundle back.
fn swap(installed: &Path, update: &Path, backup: &Path) -> Result<(), UpdateError> {
    match fs::rename(installed, backup) {
        Ok(()) => {
            if let Err(error) = fs::rename(update, installed) {
                // Best effort: the error worth reporting is the failed move.
                let _ = fs::rename(backup, installed);
                return Err(error.into());
            }
            Ok(())
        }
        #[cfg(target_os = "macos")]
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            privileged_swap(installed, update, backup)
        }
        Err(error) => Err(error.into()),
    }
}

/// The same moves as [`swap`] with administrator rights, for an app the user
/// may not write to. macOS shows its own authorization prompt.
#[cfg(target_os = "macos")]
fn privileged_swap(installed: &Path, update: &Path, backup: &Path) -> Result<(), UpdateError> {
    let (installed, update, backup) = (sh_quote(installed), sh_quote(update), sh_quote(backup));
    let command = format!(
        "mv -f {installed} {backup} && {{ mv -f {update} {installed} || {{ mv -f {backup} {installed}; exit 1; }}; }} && rm -rf {backup}"
    );
    let script =
        format!("do shell script {} with administrator privileges", applescript_string(&command));
    let output = std::process::Command::new("/usr/bin/osascript").arg("-e").arg(script).output()?;
    if output.status.success() {
        return Ok(());
    }
    Err(UpdateError::Install(format!(
        "the update could not be moved into place with administrator rights: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

/// `path` as one `sh` word, whatever characters it holds.
#[cfg(target_os = "macos")]
fn sh_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', r"'\''"))
}

/// `text` as a string literal in `osascript`'s language.
#[cfg(target_os = "macos")]
fn applescript_string(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', r"\\").replace('"', "\\\""))
}

/// The macOS installer over an explicit installed bundle, for tests.
#[cfg(test)]
pub struct BundleInstaller<C> {
    pub installed: PathBuf,
    pub signing: C,
}

#[cfg(test)]
impl<C: CodeSigning> Installer for BundleInstaller<C> {
    fn install(&self, staged: &Staged, _mode: InstallMode) -> Result<Installed, UpdateError> {
        install_bundle(&self.installed, staged.file(), &self.signing)?;
        Ok(Installed::Relaunch)
    }
}
