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
//! An app the user may not rename is installed by [`PrivilegedInstall`], a
//! root script that checks again, on its own copy, everything the user
//! context checked (astro-plan-ryj83), under a prompt worded by the app
//! (astro-plan-dwwup).
//!
//! Compiled on every Unix for tests; only macOS installs through it.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;

#[cfg(test)]
use super::{InstallMode, Installed, Installer};
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

/// Install the `.app.tar.gz` `payload` over the app bundle this process runs
/// from, asking for administrator rights with `admin_prompt` if it must.
#[cfg(target_os = "macos")]
pub(super) fn install_running_app(
    payload: &mut Payload<'_>,
    admin_prompt: &str,
) -> Result<super::Installed, UpdateError> {
    let installed = running_app_bundle()?;
    install_bundle(&installed, payload, &super::codesign::Codesign, admin_prompt)?;
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

/// Replace `installed` with the bundle in the `.app.tar.gz` `payload`, once
/// the new bundle passes the identity check against `installed`. An app this
/// user may not rename goes through [`PrivilegedInstall`], whose
/// authorization dialog says `admin_prompt`. Whenever this fails, `installed`
/// is left as it was, except when the previous app could not be put back
/// after a failed move: it is then kept where
/// [`UpdateError::PreviousAppNotRestored`] says.
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
pub fn install_bundle(
    installed: &Path,
    payload: &mut Payload<'_>,
    signing: &dyn CodeSigning,
    admin_prompt: &str,
) -> Result<(), UpdateError> {
    let identity = signing.identity(installed)?;
    let staging = staging_dir(installed)?;
    tar::Archive::new(GzDecoder::new(payload.reader())).unpack(staging.path())?;
    let update = single_bundle(staging.path())?;
    check_identity(signing, &update, &identity)?;
    let backup = staging.path().join("previous.app");
    // Only a permission error, which neither the exchange nor the moves get
    // past, needs the administrator.
    let swapped = match swap(installed, &update, &backup) {
        Ok(()) => Ok(()),
        #[cfg(target_os = "macos")]
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            tracing::debug!(%error, "this user cannot move the app; asking for administrator rights");
            PrivilegedInstall::new(installed, payload, &update, &identity)
                .and_then(|install| install.run(admin_prompt))
        }
        Err(error) => Err(error.into()),
    };
    if let Err(error) = swapped {
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

/// Refuse an `update` that does not satisfy the designated requirement of an
/// installed app signed as `identity`; one without a stable identity pins
/// nothing.
fn check_identity(
    signing: &dyn CodeSigning,
    update: &Path,
    identity: &Identity,
) -> Result<(), UpdateError> {
    match identity {
        Identity::Designated(requirement) => {
            if !signing.satisfies(update, requirement)? {
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
/// fails.
fn swap(installed: &Path, update: &Path, backup: &Path) -> io::Result<()> {
    // File systems report a missing exchange differently (`ENOTSUP` on HFS+,
    // `EINVAL` elsewhere), so anything but a permission error, which the
    // moves would hit too, gets the fallback.
    match exchange(installed, update) {
        Err(error) if error.kind() != io::ErrorKind::PermissionDenied => {
            tracing::debug!(%error, "cannot exchange the app bundles; moving them instead");
            replace(installed, update, backup)
        }
        other => other,
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

/// `AppleScript`'s "User canceled" error: the authorization prompt was
/// dismissed.
#[cfg(target_os = "macos")]
const USER_CANCELED: i32 = -128;
/// [`PRIVILEGED_INSTALL`]'s exit statuses besides 0 and 1.
#[cfg(target_os = "macos")]
const PAYLOAD_CHANGED: i32 = 65;
#[cfg(target_os = "macos")]
const IDENTITY_REFUSED: i32 = 66;
#[cfg(target_os = "macos")]
const KEPT_NEXT_TO_APP: i32 = 67;
#[cfg(target_os = "macos")]
const KEPT_IN_WORK_DIR: i32 = 68;
/// What [`PRIVILEGED_INSTALL`] writes before the path of a previous app it
/// left in its own directory ([`KEPT_IN_WORK_DIR`]).
#[cfg(target_os = "macos")]
const KEPT_MARKER: &str = "kept:";
/// The only `PATH` the privileged install's processes see; every program it
/// runs is named by absolute path anyway.
#[cfg(target_os = "macos")]
const SAFE_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
/// How long root waits for its copy of the archive. A same-user process may
/// have swapped the archive for a FIFO, which would block the copy forever.
#[cfg(target_os = "macos")]
const COPY_SECONDS: u32 = 120;

/// The root shell script of a [`PrivilegedInstall`], run with only the
/// values [`PrivilegedInstall::command`] sets in an otherwise empty
/// environment.
///
/// By the time the user has typed a password, another process of theirs may
/// have changed anything they can write: the staged archive, the tree the
/// user context unpacked, a directory on the way to either, and for a member
/// of the admin group even the installed app's directory (`/Applications` is
/// `root:admin 775`). So root works in a directory only it can enter, made
/// with `mktemp -d` next to the installed app (so on its volume, for the
/// exchange), and from there checks everything again:
///
/// 1. It enters the installed app's directory and the archive's directory with
///    `cd -P` and refuses either when `pwd -P` is not the path the app
///    resolved, so no component is a symbolic link; the app and the archive
///    must not be links either.
/// 2. It copies at most one byte more than the verified size of the archive
///    into its directory, giving up after [`COPY_SECONDS`], and checks the
///    copy's size and SHA-256 against the bytes the app verified
///    (`PAYLOAD_CHANGED`, 65).
/// 3. It unpacks its copy, and for a certificate-signed installed app checks
///    the bundle against its designated requirement with `codesign` as root
///    (`IDENTITY_REFUSED`, 66).
/// 4. It gives the bundle to the installed app's owner, then swaps it in as
///    [`swap`] does. Every rename goes through [`RENAME_JXA`]: the exchange,
///    or else exclusive moves (`RENAME_EXCL`), which fail on a name another
///    process put at the destination instead of moving into the directory
///    or through the link it planted, as `mv` would. Whether a rename
///    happened is read off root's own directory, which only root changes.
///
/// Leaving, it empties and removes its directory, which then holds the
/// previous app, unless the previous app could not be put back after a
/// failed move: it is then kept next to the installed app
/// (`KEPT_NEXT_TO_APP`, 67) or, failing that, left in the directory, which is
/// opened to the user and named on standard error (`KEPT_IN_WORK_DIR`, 68).
#[cfg(target_os = "macos")]
const PRIVILEGED_INSTALL: &str = r#"cd -P -- "$parent" && [ "$(pwd -P)" = "$parent" ] && [ -d "$name" ] && [ ! -L "$name" ] || exit 1
work=$(/usr/bin/mktemp -d .platevault-update.XXXXXXXX) && cd -P -- "$work" || exit 1
trap '/bin/rm -rf -- unpacked previous.app update.app.tar.gz; cd -P .. && /bin/rmdir -- "$work"' EXIT
there() { [ -e "$1" ] || [ -L "$1" ]; }
rn() { /usr/bin/osascript -l JavaScript -e "$rename" "$@" </dev/null >/dev/null 2>&1; }
(cd -P -- "$archive_dir" && [ "$(pwd -P)" = "$archive_dir" ] && [ -f "$archive" ] && [ ! -L "$archive" ] && exec /usr/bin/head -c "$((size + 1))" -- "$archive") > update.app.tar.gz & copy=$!
(/bin/sleep "$copy_seconds"; /bin/kill "$copy") </dev/null >/dev/null 2>&1 & timer=$!
wait "$copy"; copied=$?
{ /bin/kill "$timer"; wait "$timer"; } 2>/dev/null
[ "$copied" = 0 ] || exit 1
[ "$(/usr/bin/stat -f %z update.app.tar.gz)" = "$size" ] || exit 65
digest=$(/usr/bin/shasum -a 256 < update.app.tar.gz) || exit 1
[ "$digest" = "$sha256  -" ] || exit 65
/bin/mkdir unpacked && /usr/bin/tar -x --no-same-owner -z -f update.app.tar.gz -C unpacked || exit 1
[ -d "unpacked/$bundle" ] && [ ! -L "unpacked/$bundle" ] || exit 1
[ -z "$requirement" ] || /usr/bin/codesign --verify --deep --strict --test-requirement "=$requirement" "unpacked/$bundle" || exit 66
/usr/sbin/chown -hR "$owner" "unpacked/$bundle" || exit 1
new=$(/usr/bin/stat -f %i "unpacked/$bundle") || exit 1
rn swap "unpacked/$bundle" "../$name"
now=$(/usr/bin/stat -f %i "unpacked/$bundle") || exit 1
[ "$now" = "$new" ] || exit 0
rn excl "../$name" previous.app
there previous.app || exit 1
rn excl "unpacked/$bundle" "../$name"
there "unpacked/$bundle" || exit 0
rn excl previous.app "../$name"
there previous.app || exit 1
rn excl previous.app "../$kept"
there previous.app || exit 67
trap - EXIT
/bin/chmod 755 .
printf 'kept:%s/%s/previous.app' "$parent" "$work" >&2
exit 68"#;

/// The renames of the privileged install: the shell has no command for an
/// exchange or an exclusive move, but `osascript` running this JavaScript
/// for Automation can call `renamex_np`. `swap A B` exchanges the two paths
/// like [`exchange`] (`RENAME_SWAP`, 2); `excl A B` moves `A` to `B` only
/// while nothing is at `B` (`RENAME_EXCL`, 4). Neither follows a link.
#[cfg(target_os = "macos")]
const RENAME_JXA: &str = r#"function run(argv) {
  ObjC.import("stdio");
  $.renamex_np(argv[1], argv[2], argv[0] === "swap" ? 2 : 4);
}"#;

/// `/usr/bin/osascript` with an empty environment but [`SAFE_PATH`]: what
/// `do shell script` runs, root included, inherits it, so another process
/// of the user's cannot hand root `PERL5OPT`, exported shell functions or
/// the like.
#[cfg(target_os = "macos")]
fn osascript() -> std::process::Command {
    let mut command = std::process::Command::new("/usr/bin/osascript");
    command.env_clear().env("PATH", SAFE_PATH);
    command
}

/// The install with administrator rights, for an app this user may not
/// rename: [`PRIVILEGED_INSTALL`] as root under `do shell script ... with
/// administrator privileges`, where macOS shows its own authorization
/// prompt.
#[cfg(target_os = "macos")]
#[derive(Debug)]
struct PrivilegedInstall {
    /// The installed app's directory, with every link resolved, and the app's
    /// name there.
    parent: PathBuf,
    name: OsString,
    /// The installed app's owner, which the update is given.
    owner: (u32, u32),
    /// The verified `.app.tar.gz`'s directory, with every link resolved, its
    /// name there, and the size and SHA-256 of its verified bytes.
    archive_dir: PathBuf,
    archive: OsString,
    size: u64,
    sha256: String,
    /// The app bundle's name in the archive.
    bundle: OsString,
    /// The installed app's designated requirement; `None` when it is ad-hoc
    /// signed or unsigned, as in [`install_bundle`].
    requirement: Option<String>,
    /// The name a previous app that cannot be put back is kept under, next to
    /// the installed app.
    kept: OsString,
}

#[cfg(target_os = "macos")]
impl PrivilegedInstall {
    /// The privileged install of `payload`'s bundle, unpacked by the user
    /// context at `update`, over `installed`, signed as `identity`.
    fn new(
        installed: &Path,
        payload: &Payload<'_>,
        update: &Path,
        identity: &Identity,
    ) -> Result<Self, UpdateError> {
        Self::of(installed, payload.path(), (payload.size(), payload.sha256()), update, identity)
    }

    /// [`Self::new`] for the archive at `archive` whose verified bytes are
    /// `size` long and hash to `sha256`.
    fn of(
        installed: &Path,
        archive: &Path,
        (size, sha256): (u64, &str),
        update: &Path,
        identity: &Identity,
    ) -> Result<Self, UpdateError> {
        use std::os::unix::fs::MetadataExt as _;

        let owner = fs::symlink_metadata(installed)?;
        let (parent, name) = resolved_location(installed)?;
        let (archive_dir, archive) = resolved_location(archive)?;
        let bundle = update.file_name().ok_or_else(|| {
            UpdateError::Install(format!("{} has no file name", update.display()))
        })?;
        Ok(Self {
            parent,
            name,
            owner: (owner.uid(), owner.gid()),
            archive_dir,
            archive,
            size,
            sha256: sha256.to_owned(),
            bundle: bundle.to_os_string(),
            requirement: match identity {
                Identity::Designated(requirement) => Some(requirement.clone()),
                Identity::AdHoc | Identity::Unsigned => None,
            },
            kept: previous_version_name(installed),
        })
    }

    /// Run the install as root once the user authorized it in a dialog that
    /// says `prompt`.
    fn run(&self, prompt: &str) -> Result<(), UpdateError> {
        let output =
            osascript().arg("-e").arg(administrator_script(&self.command(), prompt)).output()?;
        if output.status.success() {
            return Ok(());
        }
        Err(self.failure(String::from_utf8_lossy(&output.stderr).trim()))
    }

    /// The shell command that runs as root: [`PRIVILEGED_INSTALL`] in a fresh
    /// `sh` whose environment holds [`SAFE_PATH`] and each value, and
    /// nothing else, whatever the shell that starts it was given.
    fn command(&self) -> String {
        self.command_with(RENAME_JXA, COPY_SECONDS)
    }

    /// [`Self::command`] with `rename` as the renames' script and
    /// `copy_seconds` as the copy's limit, which tests replace to plant names
    /// between renames and to reach the fallback moves on APFS.
    fn command_with(&self, rename: &str, copy_seconds: u32) -> String {
        let text = |value: &OsString| sh_quote(&value.to_string_lossy());
        let path = |value: &Path| sh_quote(&value.to_string_lossy());
        let (uid, gid) = self.owner;
        format!(
            "exec /usr/bin/env -i PATH={SAFE_PATH} parent={} name={} owner={uid}:{gid} archive_dir={} archive={} size={} sha256={} bundle={} requirement={} kept={} rename={} copy_seconds={copy_seconds} /bin/sh -c {}",
            path(&self.parent),
            text(&self.name),
            path(&self.archive_dir),
            text(&self.archive),
            self.size,
            sh_quote(&self.sha256),
            text(&self.bundle),
            sh_quote(self.requirement.as_deref().unwrap_or_default()),
            text(&self.kept),
            sh_quote(rename),
            sh_quote(PRIVILEGED_INSTALL),
        )
    }

    /// The error a failed run's `osascript` `message` stands for.
    /// `AppleScript` ends it with the shell's exit status, or with
    /// [`USER_CANCELED`], in parentheses: `0:40: execution error: … (65)`.
    fn failure(&self, message: &str) -> UpdateError {
        let status = message
            .rsplit_once('(')
            .and_then(|(_, status)| status.strip_suffix(')'))
            .and_then(|status| status.parse::<i32>().ok());
        let not_restored = |kept: PathBuf| UpdateError::PreviousAppNotRestored {
            kept,
            cause: Box::new(UpdateError::Install(
                "the update could not be moved into place with administrator rights".to_owned(),
            )),
        };
        match status {
            Some(USER_CANCELED) => UpdateError::Permission(
                "the administrator prompt to move the update into place was cancelled".to_owned(),
            ),
            Some(PAYLOAD_CHANGED) => UpdateError::Signature(
                "the update changed before it could be installed with administrator rights"
                    .to_owned(),
            ),
            Some(IDENTITY_REFUSED) => UpdateError::Identity(format!(
                "the update is not signed by the identity of the installed app ({})",
                self.requirement.as_deref().unwrap_or_default()
            )),
            Some(KEPT_NEXT_TO_APP) => not_restored(self.parent.join(&self.kept)),
            // The script names the directory it made; should the message not
            // parse, the installed app's directory is where it is.
            Some(KEPT_IN_WORK_DIR) => not_restored(
                message
                    .split_once(KEPT_MARKER)
                    .and_then(|(_, rest)| rest.rsplit_once(" ("))
                    .map_or_else(|| self.parent.clone(), |(kept, _)| PathBuf::from(kept)),
            ),
            _ => UpdateError::Install(format!(
                "the update could not be moved into place with administrator rights: {message}"
            )),
        }
    }
}

/// `path`'s directory with every symbolic link resolved, and its name there:
/// the root script refuses a directory it does not find at that path.
#[cfg(target_os = "macos")]
fn resolved_location(path: &Path) -> Result<(PathBuf, OsString), UpdateError> {
    match (path.parent(), path.file_name()) {
        (Some(dir), Some(name)) => Ok((fs::canonicalize(dir)?, name.to_os_string())),
        _ => Err(UpdateError::Install(format!("{} has no directory", path.display()))),
    }
}

/// The `AppleScript` that runs `command` as root once the user authorized it
/// in a dialog that says `prompt`. `osascript` runs it in a process of its
/// own, so without the prompt macOS would say that "osascript" wants to make
/// changes (astro-plan-dwwup).
#[cfg(target_os = "macos")]
fn administrator_script(command: &str, prompt: &str) -> String {
    format!(
        "do shell script {} with prompt {} with administrator privileges",
        applescript_string(command),
        applescript_string(prompt)
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

/// `<name> (previous version).app`: what a previous app that could not be put
/// back is called where it is kept.
fn previous_version_name(installed: &Path) -> OsString {
    let mut name = installed.file_stem().unwrap_or_default().to_os_string();
    name.push(" (previous version)");
    if let Some(extension) = installed.extension() {
        name.push(".");
        name.push(extension);
    }
    name
}

/// After a failed swap, where the previous app is if it never made it back to
/// `installed`. `backup` is then the only copy left, inside `staging`, which
/// is deleted on drop and sits in the system temp dir that macOS empties on
/// its own. So it moves next to `installed`, or to `fallback_dir` (the home
/// folder) when that is not writable, under [`previous_version_name`]. If
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
    let name = previous_version_name(installed);
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
        admin_prompt: &str,
    ) -> Result<Installed, UpdateError> {
        install_bundle(&self.installed, &mut payload, &self.signing, admin_prompt)?;
        Ok(Installed::Relaunch)
    }
}

#[cfg(test)]
mod tests {
    //! The swap, ported from `tauri-plugin-updater` 2.13.3's tests
    //! (`replace_bundle_*`, `swap_bundle_*`, `privileged_install_*`,
    //! `keep*_backup_*`), with the ownership step this port adds and the
    //! privileged install's own checks (astro-plan-ryj83).

    use std::fs;
    use std::os::unix::fs::MetadataExt as _;
    use std::path::{Path, PathBuf};

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

        assert_eq!(error.kind(), std::io::ErrorKind::NotFound, "{error}");
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

    /// The privileged install's tests run its root script as this user,
    /// through `sh` and through `osascript` minus `with administrator
    /// privileges`, so no prompt appears. What they cannot show is root's own
    /// view: the ownership change and the authorization dialog.
    #[cfg(target_os = "macos")]
    mod privileged {
        use std::fs;
        use std::path::{Path, PathBuf};
        use std::process::Command;

        use flate2::write::GzEncoder;
        use flate2::Compression;
        use sha2::{Digest as _, Sha256};

        use super::super::super::codesign::probe_bundle;
        use super::super::{
            administrator_script, applescript_string, osascript, Identity, PrivilegedInstall,
            COPY_SECONDS, RENAME_JXA,
        };
        use super::{bundle, owner, version};
        use crate::update::UpdateError;

        /// Names `sh` and `AppleScript` would both misread unquoted.
        const INSTALLED: &str = "Bob's \"App\".app";
        const UPDATE: &str = "New 'one' $(touch pwned).app";
        const HOSTILE_PROMPT: &str = "PlateVault's \"update\" \\ 0.7.0 $(touch pwned)";

        /// A directory whose name `sh` and `AppleScript` would both misread
        /// unquoted.
        fn hostile_dir() -> tempfile::TempDir {
            tempfile::Builder::new()
                .prefix("it's \"a\" \\ $(touch pwned) `dir`\n")
                .tempdir()
                .expect("tempdir")
        }

        /// `app` as a `.app.tar.gz` holding it as `name`.
        fn archive_of(app: &Path, name: &str) -> Vec<u8> {
            let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
            builder.append_dir_all(name, app).expect("archive the bundle");
            builder.into_inner().expect("tar").finish().expect("gzip")
        }

        fn sha256(bytes: &[u8]) -> String {
            format!("{:x}", Sha256::digest(bytes))
        }

        /// A privileged install in `dir` as the user context leaves it: an
        /// installed app, and the verified archive of `update` (as `name`) in
        /// a directory of its own.
        fn stage_with(
            dir: &Path,
            update: &Path,
            name: &str,
            identity: &Identity,
        ) -> (PathBuf, PathBuf, PrivilegedInstall) {
            let installed = dir.join(INSTALLED);
            bundle(&installed, "old");
            let payload = dir.join("payload");
            fs::create_dir(&payload).expect("payload dir");
            let archive = payload.join("update.app.tar.gz");
            let bytes = archive_of(update, name);
            fs::write(&archive, &bytes).expect("archive");
            // The user context's unpacked copy only lends its name.
            let unpacked = dir.join("staging").join(name);
            let size = u64::try_from(bytes.len()).expect("size");
            let install = PrivilegedInstall::of(
                &installed,
                &archive,
                (size, &sha256(&bytes)),
                &unpacked,
                identity,
            )
            .expect("privileged install");
            (installed, archive, install)
        }

        /// [`stage_with`] for an unsigned update at version `new`.
        fn stage(dir: &Path) -> (PathBuf, PathBuf, PrivilegedInstall) {
            let source = tempfile::tempdir().expect("source");
            let update = source.path().join("update.app");
            bundle(&update, "new");
            stage_with(dir, &update, UPDATE, &Identity::AdHoc)
        }

        /// Run `command` as root would, only as this user.
        fn run(command: &str) -> Option<i32> {
            Command::new("/bin/sh").arg("-c").arg(command).status().expect("sh").code()
        }

        /// What a previous app that cannot be put back is called beside it.
        const KEPT: &str = "Bob's \"App\" (previous version).app";

        /// A rename script for [`PrivilegedInstall::command_with`] that never
        /// exchanges, as on HFS+, leaves each source in `refuse` where it is,
        /// and plants a directory at each destination in `plant` just before
        /// moving there, as another process of the user's could. Every move
        /// it makes is [`RENAME_JXA`]'s own.
        fn moves_only(plant: &[&str], refuse: &[&str]) -> String {
            let real = RENAME_JXA.replacen("function run(argv)", "function real(argv)", 1);
            format!(
                r#"{real}
function run(argv) {{
  if (argv[0] === "swap" || {refuse:?}.indexOf(argv[1]) >= 0) return;
  if ({plant:?}.indexOf(argv[2]) >= 0) $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(argv[2], false, $(), null);
  real(argv);
}}"#
            )
        }

        /// The names left in `dir`, sorted.
        fn entries(dir: &Path) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(dir)
                .expect("dir")
                .map(|entry| entry.expect("entry").file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        }

        /// The update is installed, and root's directory, holding the
        /// previous app, is gone with nothing run as a command.
        fn assert_installed(dir: &Path, installed: &Path) {
            assert_eq!(version(installed), "new");
            assert_eq!(entries(dir), [INSTALLED, "payload"], "only the app and the payload stay");
        }

        /// The refusal left the installed app and the directory as they were.
        fn assert_refused(dir: &Path, installed: &Path) {
            assert_eq!(version(installed), "old");
            assert_eq!(entries(dir), [INSTALLED, "payload"], "root's directory is gone");
        }

        #[test]
        fn the_root_script_quotes_every_value_and_swaps_in_the_update() {
            let dir = hostile_dir();
            let (installed, _, install) = stage(dir.path());

            assert_eq!(run(&install.command()), Some(0));

            assert_installed(dir.path(), &installed);
        }

        /// The script as it reaches `AppleScript`, prompt included, only
        /// without `with administrator privileges`.
        #[test]
        fn the_administrator_script_quotes_the_command_and_the_prompt() {
            let dir = hostile_dir();
            let (installed, _, install) = stage(dir.path());
            let script = administrator_script(&install.command(), HOSTILE_PROMPT);
            assert!(
                script.ends_with(&format!(
                    " with prompt {} with administrator privileges",
                    applescript_string(HOSTILE_PROMPT)
                )),
                "{script}"
            );
            let unprivileged =
                script.strip_suffix(" with administrator privileges").expect("the admin clause");

            let output = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(unprivileged)
                .current_dir(dir.path())
                .output()
                .expect("osascript");

            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            assert_installed(dir.path(), &installed);
        }

        /// The whole script, `with administrator privileges` and all,
        /// compiles: `osacompile` checks it without running it.
        #[test]
        fn the_administrator_script_compiles_as_written() {
            let dir = hostile_dir();
            let (_, _, install) = stage(dir.path());
            let compiled = tempfile::tempdir().expect("out");

            let output = Command::new("/usr/bin/osacompile")
                .arg("-e")
                .arg(administrator_script(&install.command(), HOSTILE_PROMPT))
                .arg("-o")
                .arg(compiled.path().join("install.scpt"))
                .output()
                .expect("osacompile");

            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        }

        /// The re-review's case: another process of the user's swaps the
        /// staged archive while the password dialog is open. Root's copy no
        /// longer has the digest the app verified.
        #[test]
        fn an_archive_swapped_after_the_check_is_refused() {
            let dir = hostile_dir();
            let (installed, archive, install) = stage(dir.path());
            let source = tempfile::tempdir().expect("source");
            let evil = source.path().join("evil.app");
            bundle(&evil, "evil");
            fs::write(&archive, archive_of(&evil, UPDATE)).expect("swap the archive");

            let status = run(&install.command());

            assert_eq!(status, Some(65));
            assert_refused(dir.path(), &installed);
            let message = "0:1: execution error: The command exited with a non-zero status. (65)";
            assert!(matches!(install.failure(message), UpdateError::Signature(_)));
        }

        #[test]
        fn an_archive_directory_swapped_for_a_link_is_refused() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let elsewhere = tempfile::tempdir().expect("elsewhere");
            let moved = elsewhere.path().join("payload");
            fs::rename(dir.path().join("payload"), &moved).expect("move the payload away");
            std::os::unix::fs::symlink(&moved, dir.path().join("payload")).expect("link");

            assert_eq!(run(&install.command()), Some(1));

            assert_eq!(version(&installed), "old");
            assert_eq!(entries(dir.path()), [INSTALLED, "payload"]);
        }

        #[test]
        fn an_archive_swapped_for_a_link_is_refused() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, archive, install) = stage(dir.path());
            let elsewhere = tempfile::tempdir().expect("elsewhere");
            let moved = elsewhere.path().join("update.app.tar.gz");
            fs::rename(&archive, &moved).expect("move the archive away");
            std::os::unix::fs::symlink(&moved, &archive).expect("link");

            assert_eq!(run(&install.command()), Some(1));

            assert_refused(dir.path(), &installed);
        }

        /// The app resolves both directories' links up front; a link that
        /// appears on the installed app's path afterwards is refused.
        #[test]
        fn a_linked_component_of_the_installed_apps_path_is_refused() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, mut install) = stage(dir.path());
            let link = tempfile::tempdir().expect("link dir");
            let through_link = link.path().join("app-dir");
            std::os::unix::fs::symlink(&install.parent, &through_link).expect("link");
            install.parent = through_link;

            assert_eq!(run(&install.command()), Some(1));

            assert_refused(dir.path(), &installed);
        }

        #[test]
        fn an_installed_app_that_is_a_link_is_refused() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let elsewhere = tempfile::tempdir().expect("elsewhere");
            let moved = elsewhere.path().join(INSTALLED);
            fs::rename(&installed, &moved).expect("move the app away");
            std::os::unix::fs::symlink(&moved, &installed).expect("link");

            assert_eq!(run(&install.command()), Some(1));

            assert_eq!(version(&moved), "old");
            assert!(fs::symlink_metadata(&installed).expect("link").is_symlink());
        }

        /// Root checks the designated requirement again on its own copy:
        /// a real ad-hoc signature for the identifier passes, another
        /// identifier is refused (66), and the installed app stays.
        #[test]
        fn root_checks_the_designated_requirement_on_its_own_copy() {
            let source = tempfile::tempdir().expect("source");
            let update = probe_bundle(source.path(), Some("dev.example.update"));

            let dir = tempfile::tempdir().expect("tempdir");
            let satisfied = Identity::Designated(r#"identifier "dev.example.update""#.to_owned());
            let (installed, _, install) = stage_with(dir.path(), &update, "Probe.app", &satisfied);
            assert!(install.command().contains(r#"requirement='identifier "dev.example.update"'"#));
            assert_eq!(run(&install.command()), Some(0));
            assert!(installed.join("Contents/MacOS/probe").exists(), "the probe is installed");

            let dir = tempfile::tempdir().expect("tempdir");
            let other = Identity::Designated(r#"identifier "dev.example.other""#.to_owned());
            let (installed, _, install) = stage_with(dir.path(), &update, "Probe.app", &other);
            assert_eq!(run(&install.command()), Some(66));
            assert_refused(dir.path(), &installed);
            let message = "0:1: execution error: The command exited with a non-zero status. (66)";
            assert!(matches!(
                install.failure(message),
                UpdateError::Identity(detail) if detail.contains("dev.example.other")
            ));
        }

        /// Run unprivileged, the `chown` can only hand the update to its own
        /// owner, which proves the step runs, not the ownership change.
        #[test]
        fn the_update_is_handed_to_the_installed_apps_owner() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let (uid, gid) = owner(&installed);
            assert!(install.command().contains(&format!(" owner={uid}:{gid} ")));
            assert!(install.command().contains(r#"/usr/sbin/chown -hR "$owner""#));

            assert_eq!(run(&install.command()), Some(0));

            assert_eq!(owner(&installed), (uid, gid));
            assert_installed(dir.path(), &installed);
        }

        /// Where the file system cannot exchange, the script moves the
        /// previous app out, the update in, and deletes the previous app.
        #[test]
        fn without_the_exchange_the_moves_install_the_update() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());

            assert_eq!(run(&install.command_with(&moves_only(&[], &[]), COPY_SECONDS)), Some(0));

            assert_installed(dir.path(), &installed);
        }

        #[test]
        fn a_failed_move_puts_the_previous_app_back() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let script = moves_only(&[], &[&format!("unpacked/{UPDATE}")]);

            assert_eq!(run(&install.command_with(&script, COPY_SECONDS)), Some(1));

            assert_refused(dir.path(), &installed);
        }

        /// The review's case for a directory the user can write, such as
        /// `/Applications` for an admin: once the previous app is out,
        /// another process plants a directory at the installed path. `mv`
        /// would move the update into it; the exclusive moves refuse it, the
        /// move back too, so the previous app is kept beside it (67).
        #[test]
        fn a_directory_planted_at_the_installed_path_is_never_moved_into() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let script = moves_only(&[&format!("../{INSTALLED}")], &[]);

            assert_eq!(run(&install.command_with(&script, COPY_SECONDS)), Some(67));

            assert!(entries(&installed).is_empty(), "nothing went into the planted directory");
            assert_eq!(version(&dir.path().join(KEPT)), "old");
            assert_eq!(entries(dir.path()).len(), 3, "the app, the kept app and the payload");
            let message = "0:1: execution error: The command exited with a non-zero status. (67)";
            assert!(matches!(
                install.failure(message),
                UpdateError::PreviousAppNotRestored { kept, .. } if kept == install.parent.join(KEPT)
            ));
        }

        /// With a name planted beside the app too, the previous app stays in
        /// root's directory, which `osascript` reports by path (68).
        #[test]
        fn a_previous_app_with_nowhere_to_go_stays_in_roots_directory_and_is_named() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let script = moves_only(&[&format!("../{INSTALLED}"), &format!("../{KEPT}")], &[]);
            let command = install.command_with(&script, COPY_SECONDS);

            let output = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(format!("do shell script {}", applescript_string(&command)))
                .output()
                .expect("osascript");

            assert!(!output.status.success());
            let error = install.failure(String::from_utf8_lossy(&output.stderr).trim());
            let UpdateError::PreviousAppNotRestored { kept, .. } = error else {
                panic!("{error}");
            };
            assert_eq!(version(&kept), "old");
            assert!(kept.starts_with(&install.parent), "{}", kept.display());
            assert!(entries(&installed).is_empty() && entries(&dir.path().join(KEPT)).is_empty());
        }

        /// Another process of the user's cannot reach root through the
        /// environment: the root script runs in one of its own, whatever the
        /// shell that starts it was given, and `osascript` starts empty.
        #[test]
        fn the_root_script_ignores_the_environment_it_is_started_with() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());

            let status = Command::new("/bin/sh")
                .arg("-c")
                .arg(install.command())
                .env("PERL5OPT", "-MNo::Such::Module")
                .env("BASH_FUNC_cd%%", "() { exit 9; }")
                .status()
                .expect("sh");

            assert_eq!(status.code(), Some(0));
            assert_installed(dir.path(), &installed);
            let output = osascript()
                .arg("-e")
                .arg(r#"do shell script "/usr/bin/env""#)
                .output()
                .expect("osascript");
            // `do shell script` hands back its lines ending in CR.
            let env = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> =
                env.split(['\r', '\n']).filter(|line| !line.is_empty()).collect();
            assert!(
                lines.iter().all(|line| line.split_once('=').is_some_and(|(name, _)| [
                    "__CF_USER_TEXT_ENCODING",
                    "PATH",
                    "PWD",
                    "SHLVL",
                    "_"
                ]
                .contains(&name))),
                "{env}"
            );
            assert!(lines.contains(&"PATH=/usr/bin:/bin:/usr/sbin:/sbin"), "{env}");
        }

        /// Root copies at most one byte more than the verified size, so an
        /// archive that grew is refused on its size before its digest.
        #[test]
        fn an_archive_larger_than_the_verified_one_is_refused() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, archive, install) = stage(dir.path());
            let mut grown = fs::read(&archive).expect("archive");
            grown.extend_from_slice(&[0; 4096]);
            fs::write(&archive, grown).expect("grow the archive");
            assert!(install.command().contains(r#"/usr/bin/head -c "$((size + 1))""#));

            assert_eq!(run(&install.command()), Some(65));

            assert_refused(dir.path(), &installed);
        }

        /// A FIFO in the archive's place, which would block root's copy, is
        /// refused at once; one swapped in after that check hits the copy's
        /// time limit instead.
        #[test]
        fn an_archive_swapped_for_a_fifo_is_refused_without_waiting() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, archive, install) = stage(dir.path());
            fs::remove_file(&archive).expect("remove the archive");
            let made = Command::new("/usr/bin/mkfifo").arg(&archive).status().expect("mkfifo");
            assert!(made.success());
            let started = std::time::Instant::now();

            assert_eq!(run(&install.command_with(RENAME_JXA, 5)), Some(1));

            assert!(started.elapsed() < std::time::Duration::from_secs(5));
            assert_refused(dir.path(), &installed);
        }

        #[test]
        fn each_failure_status_maps_to_its_error() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let failure =
                |status: &str| install.failure(&format!("0:1: execution error: boom ({status})"));

            assert!(matches!(failure("-128"), UpdateError::Permission(_)));
            assert!(matches!(failure("65"), UpdateError::Signature(_)));
            assert!(matches!(failure("66"), UpdateError::Identity(_)));
            assert!(matches!(failure("1"), UpdateError::Install(_)));
            assert!(matches!(
                failure("67"),
                UpdateError::PreviousAppNotRestored { kept, .. }
                    if kept == install.parent.join("Bob's \"App\" (previous version).app")
            ));
            let work = install.parent.join(".platevault-update.abc/previous.app");
            let kept_in_work =
                install.failure(&format!("0:65: execution error: kept:{} (68)", work.display()));
            assert!(matches!(
                kept_in_work,
                UpdateError::PreviousAppNotRestored { kept, .. } if kept == work
            ));
            assert_eq!(version(&installed), "old", "mapping runs nothing");
        }
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
