// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The macOS install: swap the running `.app` for the verified update
//! (decision D4, astro-plan-eub2i).
//!
//! Before the swap, the new bundle must satisfy the installed app's
//! designated requirement: the identity its code signature pins. That is on
//! top of the minisign check, which already passed for every payload. Failing
//! it aborts the swap and keeps the installed app.
//!
//! An ad-hoc signed (or unsigned) installed copy has no stable identity: its
//! designated requirement is its own code hash, which no other build
//! satisfies. The check is skipped for it, which is what lets ad-hoc installs
//! move to the self-signed identity once (astro-plan-sl25q).
//!
//! The swap is the one `tauri-plugin-updater` 2.13.3 made: the two bundles are
//! exchanged in one step where the file system can (APFS), so the app path
//! never stands empty, and moved with a restore elsewhere. A previous app
//! that could not be put back is kept, never deleted.
//!
//! Compiled on every Unix for tests; only macOS installs through it.

use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;

#[cfg(test)]
use super::{InstallMode, Installed, Installer};
#[cfg(test)]
use crate::update::signature::Payload;
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

/// Install the `.app.tar.gz` read from `archive` over the app bundle this
/// process runs from.
#[cfg(target_os = "macos")]
pub(super) fn install_running_app(archive: &mut fs::File) -> Result<super::Installed, UpdateError> {
    let installed = running_app_bundle()?;
    install_bundle(&installed, archive, &super::codesign::Codesign)?;
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

/// Replace `installed` with the bundle in the `.app.tar.gz` read from
/// `archive`, once the new bundle passes the identity check against
/// `installed`. Whenever this fails, `installed` is left as it was, except
/// when the previous app could not be put back after a failed move: it is
/// then kept where [`UpdateError::PreviousAppNotRestored`] says.
pub fn install_bundle(
    installed: &Path,
    archive: impl Read,
    signing: &dyn CodeSigning,
) -> Result<(), UpdateError> {
    let identity = signing.identity(installed)?;
    let staging = staging_dir(installed)?;
    tar::Archive::new(GzDecoder::new(archive)).unpack(staging.path())?;
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
    let backup = staging.path().join("previous.app");
    if let Err(error) = swap(installed, &update, &backup) {
        let home = std::env::home_dir();
        return Err(
            match keep_backup_if_not_restored(installed, staging, &backup, home.as_deref()) {
                Some(kept) => {
                    tracing::error!(%error, kept = %kept.display(), "the update failed and the previous app could not be put back");
                    UpdateError::PreviousAppNotRestored { kept, cause: Box::new(error) }
                }
                None => error,
            },
        );
    }
    #[cfg(target_os = "macos")]
    {
        // A fresh modification date makes Launch Services re-read the bundle.
        let _ = std::process::Command::new("/usr/bin/touch").arg(installed).status();
    }
    Ok(())
}

/// A private directory on the installed bundle's volume, so the swap needs
/// no copy: the system temp dir when it is there, next to the app otherwise.
fn staging_dir(installed: &Path) -> Result<tempfile::TempDir, UpdateError> {
    let candidates = [Some(std::env::temp_dir()), installed.parent().map(Path::to_path_buf)];
    staging_dir_among(installed, candidates.into_iter().flatten())
}

/// [`staging_dir`] in the first of `candidates` on `installed`'s volume.
fn staging_dir_among(
    installed: &Path,
    candidates: impl IntoIterator<Item = PathBuf>,
) -> Result<tempfile::TempDir, UpdateError> {
    use std::os::unix::fs::MetadataExt as _;

    let device = fs::symlink_metadata(installed)?.dev();
    let root = candidates
        .into_iter()
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
        _ => Err(UpdateError::Manifest(
            "the update archive does not hold exactly one app bundle".to_owned(),
        )),
    }
}

/// Put `update` at `installed`. Where the file system can, the two are
/// exchanged in one step and the previous app ends up at `update`; elsewhere
/// `installed` moves to `backup` first and comes back if the second move
/// fails. An app the user cannot rename is swapped with administrator rights.
fn swap(installed: &Path, update: &Path, backup: &Path) -> Result<(), UpdateError> {
    // File systems report a missing exchange differently (`ENOTSUP` on HFS+,
    // `EINVAL` elsewhere), so anything but a permission error, which needs the
    // privileged swap, gets the fallback.
    let moved = match exchange(installed, update) {
        Err(error) if error.kind() != io::ErrorKind::PermissionDenied => {
            tracing::debug!(%error, "cannot exchange the app bundles; moving them instead");
            replace(installed, update, backup)
        }
        other => other,
    };
    match moved {
        Ok(()) => Ok(()),
        #[cfg(target_os = "macos")]
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            privileged_swap(installed, update, backup)
        }
        Err(error) => Err(error.into()),
    }
}

/// Exchange `installed` and `update` atomically (`renamex_np` with
/// `RENAME_SWAP` on macOS, `renameat2` with `RENAME_EXCHANGE` on Linux).
fn exchange(installed: &Path, update: &Path) -> io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};

    renameat_with(CWD, update, CWD, installed, RenameFlags::EXCHANGE).map_err(io::Error::from)
}

/// Move `update` to `installed`, keeping what was at `installed` in `backup`
/// until that has succeeded. If the second move fails, the first is undone
/// as far as the file system lets it.
fn replace(installed: &Path, update: &Path, backup: &Path) -> io::Result<()> {
    fs::rename(installed, backup)?;
    if let Err(error) = fs::rename(update, installed) {
        // Best effort: the error worth reporting is the failed move, and a
        // failed restore is caught by `keep_backup_if_not_restored`.
        let _ = fs::rename(backup, installed);
        return Err(error);
    }
    Ok(())
}

/// The swap with administrator rights, for an app the user may not rename.
/// macOS shows its own authorization prompt.
#[cfg(target_os = "macos")]
fn privileged_swap(installed: &Path, update: &Path, backup: &Path) -> Result<(), UpdateError> {
    use std::os::unix::fs::MetadataExt as _;

    let owner = fs::symlink_metadata(installed)?;
    let command = privileged_swap_command(installed, update, backup, (owner.uid(), owner.gid()));
    let script =
        format!("do shell script {} with administrator privileges", applescript_string(&command));
    let output = std::process::Command::new("/usr/bin/osascript").arg("-e").arg(script).output()?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    // AppleScript's "User canceled" error.
    if stderr.contains("(-128)") {
        return Err(UpdateError::Permission(
            "the administrator prompt to move the update into place was cancelled".to_owned(),
        ));
    }
    Err(UpdateError::Install(format!(
        "the update could not be moved into place with administrator rights: {}",
        stderr.trim()
    )))
}

/// Exchanges the two paths it is given like [`exchange`], for the privileged
/// swap: the shell has no command for it, but `osascript` running this
/// JavaScript for Automation can call `renamex_np` (`2` is `RENAME_SWAP`). It
/// prints `swapped` or `failed`, so the script can tell a swap that did not
/// happen from an `osascript` failure that leaves unknown whether it did.
#[cfg(target_os = "macos")]
const SWAP_JXA: &str = r#"function run(argv) {
  ObjC.import("stdio");
  return $.renamex_np(argv[0], argv[1], 2) === 0 ? "swapped" : "failed";
}"#;

/// The shell command the privileged swap runs as root. It first gives
/// `update` to the owner of `installed` (`uid`:`gid`), so a standard user's
/// update does not leave an admin-installed app writable by that user. Then it
/// makes the same swap as [`swap`]: the exchange, and where the file system
/// cannot exchange, the moves, deleting the previous app only once the new
/// one is in place. The moves run only once the exchange is known not to have
/// happened, since after one they would put the previous app back.
#[cfg(target_os = "macos")]
fn privileged_swap_command(
    installed: &Path,
    update: &Path,
    backup: &Path,
    (uid, gid): (u32, u32),
) -> String {
    let swap = sh_quote(SWAP_JXA);
    let installed = sh_quote(&installed.to_string_lossy());
    let update = sh_quote(&update.to_string_lossy());
    let backup = sh_quote(&backup.to_string_lossy());
    format!(
        "/usr/sbin/chown -hR {uid}:{gid} {update} && case \"$(/usr/bin/osascript -l JavaScript -e {swap} {update} {installed} 2>/dev/null)\" in swapped) /bin/rm -rf {update};; failed) /bin/mv -f {installed} {backup} && {{ /bin/mv -f {update} {installed} || {{ /bin/mv -f {backup} {installed}; exit 1; }}; }} && /bin/rm -rf {backup};; *) exit 1;; esac"
    )
}

/// `text` as one `sh` word, whatever characters it holds.
#[cfg(target_os = "macos")]
fn sh_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

/// `text` as a string literal in `osascript`'s language.
#[cfg(target_os = "macos")]
fn applescript_string(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', r"\\").replace('"', "\\\""))
}

/// After a failed swap, where the previous app is if it never made it back to
/// `installed`. `backup` is then the only copy left, inside `staging`, which
/// is deleted on drop and sits in the system temp dir that macOS empties on
/// its own. So it moves next to `installed`, or to `fallback_dir` (the home
/// folder) when that is not writable, as `<name> (previous version).app`. If
/// neither works, `staging` is kept rather than deleted.
fn keep_backup_if_not_restored(
    installed: &Path,
    staging: tempfile::TempDir,
    backup: &Path,
    fallback_dir: Option<&Path>,
) -> Option<PathBuf> {
    if fs::symlink_metadata(installed).is_ok() || fs::symlink_metadata(backup).is_err() {
        return None;
    }
    let mut name = installed.file_stem().unwrap_or_default().to_os_string();
    name.push(" (previous version)");
    if let Some(extension) = installed.extension() {
        name.push(".");
        name.push(extension);
    }
    let kept = [installed.parent(), fallback_dir]
        .into_iter()
        .flatten()
        .map(|dir| dir.join(&name))
        // `rename` replaces an empty directory, so never move onto anything
        // already there.
        .filter(|kept| fs::symlink_metadata(kept).is_err())
        .find(|kept| fs::rename(backup, kept).is_ok());
    if kept.is_some() {
        return kept;
    }
    let _ = staging.keep();
    Some(backup.to_path_buf())
}

/// The macOS installer over an explicit installed bundle, for tests.
#[cfg(test)]
pub struct BundleInstaller<C> {
    pub installed: PathBuf,
    pub signing: C,
}

#[cfg(test)]
impl<C: CodeSigning> Installer for BundleInstaller<C> {
    fn install(
        &self,
        mut payload: Payload<'_>,
        _mode: InstallMode,
    ) -> Result<Installed, UpdateError> {
        install_bundle(&self.installed, payload.reader(), &self.signing)?;
        Ok(Installed::Relaunch)
    }
}

#[cfg(test)]
mod tests {
    //! The swap, ported from `tauri-plugin-updater` 2.13.3's tests
    //! (`replace_bundle_*`, `swap_bundle_*`, `privileged_install_*`,
    //! `keep*_backup_*`), with the ownership step this port adds.

    use std::fs;
    use std::os::unix::fs::MetadataExt as _;
    use std::path::{Path, PathBuf};
    #[cfg(target_os = "macos")]
    use std::process::Command;

    #[cfg(target_os = "macos")]
    use super::{applescript_string, privileged_swap_command};
    use super::{exchange, keep_backup_if_not_restored, replace, staging_dir_among, swap};

    /// A bundle directory at `path` holding a `version` file.
    fn bundle(path: &Path, version: &str) {
        fs::create_dir(path).expect("bundle");
        fs::write(path.join("version"), version).expect("version");
    }

    fn version(path: &Path) -> String {
        fs::read_to_string(path.join("version")).expect("version")
    }

    #[cfg(target_os = "macos")]
    fn owner(path: &Path) -> (u32, u32) {
        let metadata = fs::symlink_metadata(path).expect("metadata");
        (metadata.uid(), metadata.gid())
    }

    /// Whether `path` is on APFS, the file system macOS can exchange on.
    #[cfg(target_os = "macos")]
    fn is_apfs(path: &Path) -> bool {
        let stat = rustix::fs::statfs(path).expect("statfs");
        let name: Vec<u8> = stat
            .f_fstypename
            .iter()
            .take_while(|&&byte| byte != 0)
            .map(|&byte| u8::try_from(byte).unwrap_or(b'?'))
            .collect();
        name == b"apfs"
    }

    #[test]
    fn replace_moves_the_update_into_place() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, update, backup) =
            (dir.path().join("App.app"), dir.path().join("update"), dir.path().join("backup"));
        bundle(&installed, "old");
        bundle(&update, "new");

        replace(&installed, &update, &backup).expect("replace");

        assert_eq!(version(&installed), "new");
        assert_eq!(version(&backup), "old");
        assert!(!update.exists());
    }

    #[test]
    fn replace_puts_the_installed_bundle_back_when_the_move_fails() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, backup) = (dir.path().join("App.app"), dir.path().join("backup"));
        bundle(&installed, "old");

        let error = replace(&installed, &dir.path().join("missing"), &backup).expect_err("missing");

        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
        assert_eq!(version(&installed), "old");
        assert!(!backup.exists());
    }

    #[test]
    fn a_missing_update_leaves_the_installed_app_intact() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, backup) = (dir.path().join("App.app"), dir.path().join("backup"));
        bundle(&installed, "old");

        let error = swap(&installed, &dir.path().join("missing"), &backup).expect_err("missing");

        assert!(
            matches!(&error, crate::update::UpdateError::Io(io) if io.kind() == std::io::ErrorKind::NotFound),
            "{error}"
        );
        assert_eq!(version(&installed), "old");
        assert!(!backup.exists());
    }

    /// A temp dir on a file system without the exchange proves nothing here,
    /// but on APFS it has to work: the install would otherwise always fall
    /// back to two moves.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_exchange_swaps_the_two_bundles_in_place() {
        let dir = tempfile::tempdir().expect("tempdir");
        if !is_apfs(dir.path()) {
            return;
        }
        let (installed, update) = (dir.path().join("App.app"), dir.path().join("update"));
        bundle(&installed, "old");
        bundle(&update, "new");

        exchange(&installed, &update).expect("exchange");

        assert_eq!(version(&installed), "new");
        assert_eq!(version(&update), "old");
    }

    #[test]
    fn the_swap_installs_the_update_and_keeps_the_previous_app_in_staging() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, update) = (dir.path().join("App.app"), dir.path().join("update"));
        bundle(&installed, "old");
        bundle(&update, "new");
        let backup = dir.path().join("backup");

        swap(&installed, &update, &backup).expect("swap");

        assert_eq!(version(&installed), "new");
        let previous = if exchange_supported(dir.path()) { update } else { backup };
        assert_eq!(version(&previous), "old", "the previous app waits in the staging dir");
    }

    fn exchange_supported(dir: &Path) -> bool {
        let (a, b) = (dir.join("probe-a"), dir.join("probe-b"));
        fs::create_dir(&a).expect("probe");
        fs::create_dir(&b).expect("probe");
        let supported = exchange(&a, &b).is_ok();
        fs::remove_dir(&a).expect("probe");
        fs::remove_dir(&b).expect("probe");
        supported
    }

    #[test]
    fn the_staging_dir_is_on_the_installed_apps_volume() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        bundle(&installed, "old");

        // `/dev` is its own file system, so it is passed over.
        let staging =
            staging_dir_among(&installed, [PathBuf::from("/dev"), dir.path().to_path_buf()])
                .expect("staging dir");

        assert_eq!(staging.path().parent(), Some(dir.path()));
        assert_eq!(
            fs::metadata(staging.path()).expect("staging").dev(),
            fs::metadata(&installed).expect("installed").dev()
        );
    }

    #[test]
    fn no_staging_dir_off_the_installed_apps_volume() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        bundle(&installed, "old");

        let error = staging_dir_among(&installed, [PathBuf::from("/dev")]).expect_err("no dir");

        assert!(matches!(error, crate::update::UpdateError::Install(_)), "{error}");
    }

    /// A directory whose name `sh` and `AppleScript` would both misread
    /// unquoted.
    #[cfg(target_os = "macos")]
    fn hostile_dir() -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix("it's \"a\" \\ $(touch pwned) `dir`\n")
            .tempdir()
            .expect("tempdir")
    }

    /// Stage the privileged swap in `dir` and return its command.
    #[cfg(target_os = "macos")]
    fn stage_privileged_swap(dir: &Path, backup: &Path) -> String {
        let installed = dir.join("Bob's \"App\".app");
        let update = dir.join("update");
        bundle(&installed, "old");
        bundle(&update, "new");
        privileged_swap_command(&installed, &update, backup, owner(&installed))
    }

    #[cfg(target_os = "macos")]
    fn assert_privileged_swap_moved(dir: &Path) {
        let installed = dir.join("Bob's \"App\".app");
        assert_eq!(version(&installed), "new");
        assert!(!dir.join("update").exists(), "the previous app is deleted");
        assert!(!dir.join("backup").exists());
        assert!(!dir.join("pwned").exists(), "no path was run as a command");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_privileged_swap_quotes_every_path() {
        let dir = hostile_dir();
        let command = stage_privileged_swap(dir.path(), &dir.path().join("backup"));

        let status = Command::new("/bin/sh")
            .arg("-c")
            .arg(&command)
            .current_dir(dir.path())
            .status()
            .expect("sh");

        assert!(status.success());
        assert_privileged_swap_moved(dir.path());
    }

    /// The command as it is handed to `AppleScript`, only without `with
    /// administrator privileges`, so it runs without a prompt.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_privileged_swap_script_quotes_every_path() {
        let dir = hostile_dir();
        let command = stage_privileged_swap(dir.path(), &dir.path().join("backup"));

        let output = Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(format!("do shell script {}", applescript_string(&command)))
            .current_dir(dir.path())
            .output()
            .expect("osascript");

        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert_privileged_swap_moved(dir.path());
    }

    /// On APFS the privileged swap exchanges the bundles and never touches the
    /// backup: one in a directory that does not exist must not matter.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_privileged_swap_exchanges_the_bundles_on_apfs() {
        let dir = tempfile::tempdir().expect("tempdir");
        if !is_apfs(dir.path()) {
            return;
        }
        let command = stage_privileged_swap(dir.path(), &dir.path().join("missing").join("backup"));

        let status = Command::new("/bin/sh").arg("-c").arg(&command).status().expect("sh");

        assert!(status.success());
        assert_privileged_swap_moved(dir.path());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_privileged_swap_hands_the_update_to_the_installed_apps_owner() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, update) = (dir.path().join("App.app"), dir.path().join("update"));
        bundle(&installed, "old");
        bundle(&update, "new");
        let (uid, gid) = owner(&installed);

        let command =
            privileged_swap_command(&installed, &update, &dir.path().join("backup"), (uid, gid));

        assert!(
            command.starts_with(&format!(
                "/usr/sbin/chown -hR {uid}:{gid} '{}' && ",
                update.display()
            )),
            "{command}"
        );
        // Run unprivileged, the chown can only hand the update to its own
        // owner, which proves the command runs, not the ownership change.
        let status = Command::new("/bin/sh").arg("-c").arg(&command).status().expect("sh");
        assert!(status.success());
        assert_eq!(owner(&installed), (uid, gid));
        assert_eq!(version(&installed), "new");
    }

    #[test]
    fn a_previous_app_that_was_not_put_back_moves_next_to_the_installed_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        let staging = tempfile::tempdir_in(dir.path()).expect("staging");
        let staging_path = staging.path().to_path_buf();
        let backup = staging_path.join("previous.app");
        bundle(&backup, "old");

        let kept = keep_backup_if_not_restored(&installed, staging, &backup, None);

        let expected = dir.path().join("App (previous version).app");
        assert_eq!(kept.as_deref(), Some(expected.as_path()));
        assert_eq!(version(&expected), "old");
        assert!(!staging_path.exists(), "the empty staging dir is removed");
    }

    #[test]
    fn a_previous_app_that_cannot_go_next_to_the_installed_path_goes_to_the_fallback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        fs::write(dir.path().join("App (previous version).app"), "other").expect("other");
        let staging = tempfile::tempdir_in(dir.path()).expect("staging");
        let backup = staging.path().join("previous.app");
        bundle(&backup, "old");
        let fallback = tempfile::tempdir_in(dir.path()).expect("fallback");

        let kept = keep_backup_if_not_restored(&installed, staging, &backup, Some(fallback.path()));

        let expected = fallback.path().join("App (previous version).app");
        assert_eq!(kept.as_deref(), Some(expected.as_path()));
        assert_eq!(version(&expected), "old");
    }

    #[test]
    fn a_previous_app_that_cannot_move_stays_in_the_kept_staging_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        // A file where the previous app would go, which must not be replaced.
        fs::write(dir.path().join("App (previous version).app"), "other").expect("other");
        let staging = tempfile::tempdir_in(dir.path()).expect("staging");
        let backup = staging.path().join("previous.app");
        bundle(&backup, "old");

        let kept = keep_backup_if_not_restored(
            &installed,
            staging,
            &backup,
            Some(&dir.path().join("missing")),
        );

        assert_eq!(kept.as_deref(), Some(backup.as_path()));
        assert_eq!(version(&backup), "old", "the staging dir was not deleted");
        assert_eq!(
            fs::read_to_string(dir.path().join("App (previous version).app")).expect("other"),
            "other"
        );
        fs::remove_dir_all(backup.parent().expect("staging")).expect("clean up the kept dir");
    }

    #[test]
    fn a_previous_app_back_in_place_needs_no_backup() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        bundle(&installed, "old");
        let staging = tempfile::tempdir_in(dir.path()).expect("staging");
        let staging_path = staging.path().to_path_buf();
        let backup = staging_path.join("previous.app");
        bundle(&backup, "older");

        assert!(keep_backup_if_not_restored(&installed, staging, &backup, None).is_none());
        assert!(!staging_path.exists());
    }
}
