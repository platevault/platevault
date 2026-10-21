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
//! The app replaced is the one this process was launched from
//! (astro-plan-uyguq): [`LaunchedBundle`] reads its device and inode at
//! launch, and the install goes ahead only while the app at that path still
//! has them. They are checked before the app's identity is read, again just
//! before the swap, and, on what the swap moved out of the app's path, right
//! after it, as root checks them. A bundle swapped in after launch is
//! refused, and put back where the swap moved it, rather than pinned as it
//! is or replaced. What that undo did is told by device and inode too, not
//! by its result: anything it leaves in the staging dir but the update is
//! kept aside, never deleted with it, and the update found at the app's path
//! after all counts as installed. Either way the user is told where what was
//! kept aside is ([`UpdateError::AppReplaced`], [`Installed::Relaunch`]).
//!
//! Residual risks, which no device and inode can tell apart:
//!
//! - The record is read when `main` starts. A bundle swapped in between the
//!   process starting and that read is recorded as the launched app.
//! - The pin names the bundle directory, not what it holds, and the identity
//!   is read from whatever the bundle holds when the install starts. An app
//!   that reads as ad-hoc signed or unsigned then is held to no identity,
//!   only to the minisign check, whether it was launched like that or a
//!   process of the user's rewrote the files inside it in place, which keeps
//!   the directory's device and inode. So is an update over the launched app
//!   when another bundle was swapped in during the identity read and back
//!   out before the next check: the identity read is that bundle's.
//! - Every move onto the app's path or onto a name a kept app takes is
//!   exclusive (`RENAME_EXCL`, `RENAME_NOREPLACE`). A file system without
//!   that rename gets a check that nothing is at the destination and then a
//!   plain rename, which replaces what another process creates there in that
//!   moment: an empty directory, or a file when what moves is a file or a
//!   link.
//!
//! The swap is the one `tauri-plugin-updater` 2.13.3 made: the two bundles are
//! exchanged in one step where the file system can (APFS), so the app path
//! never stands empty, and moved with a restore elsewhere. A previous app
//! that could not be put back is kept, never deleted: it counts as back only
//! when its device and inode are at the app's path again, and every renamed
//! back or kept entry moves onto nothing, under the next free numbered name
//! when one is taken. So does the update: an entry another process put at
//! the app's path between the two moves is left alone, and the install
//! refused. As that entry also keeps the launched app from moving back, the
//! app is then usually kept aside, and the error is
//! [`UpdateError::PreviousAppNotRestored`] with [`UpdateError::AppReplaced`]
//! as its cause.
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
use super::{InstallMode, Installer};
use super::{InstallWording, Installed};
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

/// Install the `.app.tar.gz` `payload` over `launched`, the app bundle this
/// process was launched from, with `wording`'s administrator prompt if it
/// must ask for those rights.
#[cfg(target_os = "macos")]
pub(super) fn install_launched_app(
    launched: &LaunchedBundle,
    payload: &mut Payload<'_>,
    wording: &InstallWording,
) -> Result<Installed, UpdateError> {
    install_bundle(launched, payload, &super::codesign::Codesign, wording)
}

/// An app bundle this process was launched from, and the device and inode it
/// had then: the install replaces that entry or nothing (astro-plan-uyguq).
#[derive(Clone, Debug)]
pub struct LaunchedBundle {
    path: PathBuf,
    id: (u64, u64),
}

impl LaunchedBundle {
    /// The bundle holding this executable, as it is now: read at launch.
    #[cfg(target_os = "macos")]
    pub(super) fn running() -> Result<Self, UpdateError> {
        Self::holding(&std::env::current_exe()?)
    }

    /// The `.app` directory holding `executable` (`X.app/Contents/MacOS/x`),
    /// as it is now. The bundle is found from the executable's path by name
    /// alone, made absolute so it names the same place whatever the working
    /// directory is by the time of the install.
    fn holding(executable: &Path) -> Result<Self, UpdateError> {
        let executable = std::path::absolute(executable)?;
        let bundle = executable
            .ancestors()
            .nth(3)
            .filter(|bundle| bundle.extension().is_some_and(|extension| extension == "app"))
            .ok_or_else(|| {
                UpdateError::Install(format!(
                    "{} is not inside an app bundle, so it cannot update itself",
                    executable.display()
                ))
            })?;
        Ok(Self::at(bundle.to_path_buf())?)
    }

    /// The bundle at `path` as it is now, read as the install reads it: the
    /// entry at `path` itself, a link if it is one ([`entry_id`]).
    pub fn at(path: PathBuf) -> io::Result<Self> {
        let id = entry_id(&path)?;
        Ok(Self { path, id })
    }

    /// Refuse to go on unless the entry at the bundle's path is still the one
    /// launched.
    fn check_in_place(&self) -> Result<(), UpdateError> {
        if still_at(&self.path, self.id)? {
            Ok(())
        } else {
            Err(app_replaced(&self.path, Vec::new()))
        }
    }
}

/// Whether the entry at `path` is still the one whose device and inode are
/// `id`. An empty path is not, and nor is one whose directory was replaced
/// by a file.
fn still_at(path: &Path, id: (u64, u64)) -> io::Result<bool> {
    match entry_id(path) {
        Ok(found) => Ok(found == id),
        Err(error)
            if matches!(error.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory) =>
        {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

/// The error for an `installed` path that no longer holds the app this
/// process was launched from; `kept` is where what came out of its place and
/// could not be put back is kept.
fn app_replaced(installed: &Path, kept: Vec<PathBuf>) -> UpdateError {
    UpdateError::AppReplaced { app: installed.to_path_buf(), kept }
}

/// Replace the app `launched` names with the bundle in the `.app.tar.gz`
/// `payload`, once the app at its path is found to be still the one launched
/// and the new bundle passes the identity check against it. An app this user
/// may not rename goes through [`PrivilegedInstall`], whose authorization
/// dialog says `wording`'s administrator prompt. Whenever this fails, the
/// installed app is left as it was, except when the previous app could not
/// be put back after a failed move: it is then kept where
/// [`UpdateError::PreviousAppNotRestored`] says. Another bundle found at the
/// app's path is refused ([`UpdateError::AppReplaced`]) and left there;
/// should the swap have moved it, it is put back, and kept aside as a
/// previous app is if it cannot be. Should the update be in place all the
/// same, it is installed, and [`Installed::Relaunch`] says where that bundle
/// is kept. A bundle kept aside is named for `wording`'s `set_aside`
/// ([`kept_aside_name`]).
pub fn install_bundle(
    launched: &LaunchedBundle,
    payload: &mut Payload<'_>,
    signing: &dyn CodeSigning,
    wording: &InstallWording,
) -> Result<Installed, UpdateError> {
    install_bundle_swapping(launched, payload, signing, wording, swap)
}

/// How [`move_into_place`] puts the update at the app's path: [`swap`],
/// which tests replace to race it.
type Swap = fn(&LaunchedBundle, &Path, &Path) -> Result<(), SwapError>;

/// [`install_bundle`], moving the update into place with `swap`.
fn install_bundle_swapping(
    launched: &LaunchedBundle,
    payload: &mut Payload<'_>,
    signing: &dyn CodeSigning,
    wording: &InstallWording,
    swap: Swap,
) -> Result<Installed, UpdateError> {
    let installed = launched.path.as_path();
    let identity = identify_launched(launched, signing)?;
    let staging = staging_dir(installed)?;
    tar::Archive::new(GzDecoder::new(payload.reader())).unpack(staging.path())?;
    let update = single_bundle(staging.path())?;
    check_identity(signing, &update, &identity)?;
    // The unpack and the identity check can take seconds, in which another
    // process of the user's could swap another bundle in.
    launched.check_in_place()?;
    let kept_aside =
        move_into_place(launched, payload, &update, staging, &identity, wording, swap)?;
    #[cfg(target_os = "macos")]
    {
        // A fresh modification date makes Launch Services re-read the bundle.
        let _ = std::process::Command::new("/usr/bin/touch").arg(installed).status();
    }
    Ok(Installed::Relaunch { kept_aside })
}

/// Put `update`, the verified bundle unpacked into `staging`, in place of the
/// app `launched` names with `swap`, as [`install_bundle`] says. Where what
/// was found in the app's place is kept when the update is in place all the
/// same ([`settle_not_launched`]); empty otherwise.
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
fn move_into_place(
    launched: &LaunchedBundle,
    payload: &Payload<'_>,
    update: &Path,
    staging: tempfile::TempDir,
    identity: &Identity,
    wording: &InstallWording,
    swap: Swap,
) -> Result<Vec<PathBuf>, UpdateError> {
    let installed = launched.path.as_path();
    // What tells the update apart from anything another process brings into
    // staging or to the app's path while it is moved.
    let update_id = entry_id(update)?;
    let backup = staging.path().join("previous.app");
    let home = std::env::home_dir();
    let aside = KeepAside { set_aside: &wording.set_aside, fallback_dir: home.as_deref() };
    // Only a permission error, which neither the exchange nor the moves get
    // past, needs the administrator.
    let error = match swap(launched, update, &backup) {
        Ok(()) => return Ok(Vec::new()),
        #[cfg(target_os = "macos")]
        Err(SwapError::Io(error)) if error.kind() == io::ErrorKind::PermissionDenied => {
            tracing::debug!(%error, "this user cannot move the app; asking for administrator rights");
            match PrivilegedInstall::new(launched, payload, update, identity, &wording.set_aside)
                .and_then(|install| install.run(&wording.admin_prompt))
            {
                Ok(kept) => return Ok(kept),
                Err(error) => error,
            }
        }
        Err(SwapError::Io(error)) => error.into(),
        // Another process filled the app's path after the launched app moved
        // out; what it put there is left alone.
        Err(SwapError::Occupied) => app_replaced(installed, Vec::new()),
        Err(SwapError::NotLaunched { found }) => {
            return settle_not_launched(
                installed,
                staging,
                [update, &backup],
                (update_id, found),
                aside,
            );
        }
    };
    Err(failed_swap(launched, staging, [update, &backup], update_id, error, aside))
}

/// What a swap that put nothing in place because of `error` reports, once
/// [`keep_backup_if_not_restored`] kept what it left in `staging`:
/// [`UpdateError::PreviousAppNotRestored`] when the launched app is among
/// what was kept, else `error`.
fn failed_swap(
    launched: &LaunchedBundle,
    staging: tempfile::TempDir,
    left: [&Path; 2],
    update_id: (u64, u64),
    error: UpdateError,
    aside: KeepAside<'_>,
) -> UpdateError {
    match keep_backup_if_not_restored(launched, staging, left, update_id, aside) {
        Some(kept) => {
            tracing::error!(%error, kept = %kept.display(), "the update failed and the previous app could not be put back");
            UpdateError::PreviousAppNotRestored { kept, cause: Box::new(error) }
        }
        None => error,
    }
}

/// Settle a swap that moved another bundle than the launched app out of the
/// app's path at `installed`, once [`check_moved_out`] tried to put it back.
/// Another process can change either path around that undo, so nothing is
/// taken to be where the undo should have left it. As root does, entries are
/// told apart by device and inode: `update_id` is the update's, and `found`
/// what the swap found at the app's path.
///
/// - Whatever is left at `left`, the two places in `staging` a swap moves
///   things to, other than the update is kept aside rather than deleted with
///   `staging`: the other bundle, should the undo have failed, or whatever
///   the undo brought in instead, the launched app included.
/// - The update at the app's path is an install: it is the verified bundle
///   and nothing was deleted, so this succeeds with where those entries are
///   kept, which the updater tells the user. No failure would be true, for
///   each one the UI shows says that the update could not be installed.
/// - Anything else there means that nothing was installed.
fn settle_not_launched(
    installed: &Path,
    staging: tempfile::TempDir,
    left: [&Path; 2],
    (update_id, found): ((u64, u64), Option<(u64, u64)>),
    aside: KeepAside<'_>,
) -> Result<Vec<PathBuf>, UpdateError> {
    let kept = keep_all_but(installed, staging, left, update_id, aside);
    let now = entry_id(installed).ok();
    if now == Some(update_id) {
        tracing::error!(?kept, "the update is in place, but what the swap moved out of the app's path was not the launched app and could not be put back");
        return Ok(kept);
    }
    if now != found {
        tracing::warn!(app = %installed.display(), "the app's path holds neither the update nor what the swap found there");
    }
    Err(app_replaced(installed, kept))
}

/// Keep aside, with [`move_aside`], each of `entries` in `staging` that is
/// there and is not `ours`, which includes one whose device and inode cannot
/// be read. Should one not move, `staging` is kept rather than deleted. Where
/// each kept entry is now.
fn keep_all_but(
    installed: &Path,
    staging: tempfile::TempDir,
    entries: [&Path; 2],
    ours: (u64, u64),
    aside: KeepAside<'_>,
) -> Vec<PathBuf> {
    let mut kept = Vec::new();
    let mut keep_staging = false;
    for entry in entries {
        match entry_id(entry) {
            Ok(id) if id == ours => continue,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            _ => {}
        }
        kept.push(move_aside(installed, entry, aside).unwrap_or_else(|| {
            keep_staging = true;
            entry.to_path_buf()
        }));
    }
    if keep_staging {
        let _ = staging.keep();
    }
    kept
}

/// The identity of the app `launched` names, read only once the entry at its
/// path has been found to be still the one launched: its device and inode
/// are read first, before anything else reads the app by path. A bundle
/// swapped in after launch is refused here, whatever identity it has, and so
/// is an empty path; one swapped in after this read is refused before the
/// swap, by the swap, by [`PrivilegedInstall::of`] and by root, which replace
/// the launched entry or nothing (astro-plan-ryj83).
fn identify_launched(
    launched: &LaunchedBundle,
    signing: &dyn CodeSigning,
) -> Result<Identity, UpdateError> {
    launched.check_in_place()?;
    signing.identity(&launched.path)
}

/// The device and inode of the entry at `path`, a link itself if it is one.
fn entry_id(path: &Path) -> io::Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt as _;

    let metadata = fs::symlink_metadata(path)?;
    Ok((metadata.dev(), metadata.ino()))
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

/// Why [`swap`] put nothing in place.
#[derive(Debug)]
enum SwapError {
    Io(io::Error),
    /// Something was at the app's path when the update was to move there,
    /// after the launched app had moved out: another process put it there.
    /// It was left alone, and the launched app moved back onto nothing if it
    /// could ([`move_update_in`]).
    Occupied,
    /// What the swap moved out of the app's path was not the launched app but
    /// an entry swapped in after the last check, whose device and inode were
    /// `found` (`None` when they could not be read, or when nothing was at
    /// the app's path to move: the launched app went away since the check).
    /// The swap was undone as far as that worked; [`settle_not_launched`]
    /// tells what is where now.
    NotLaunched {
        found: Option<(u64, u64)>,
    },
}

impl From<io::Error> for SwapError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Put `update` at the app `launched` names. Where the file system can, the
/// two are exchanged in one step and the previous app ends up at `update`;
/// elsewhere the app moves to `backup` first and comes back if the second
/// move fails. What came out of the app's path must be the launched app
/// ([`check_moved_out`]): anything else came from a swap after the last
/// check, so the swap is undone and nothing is installed.
fn swap(launched: &LaunchedBundle, update: &Path, backup: &Path) -> Result<(), SwapError> {
    let installed = launched.path.as_path();
    // File systems report a missing exchange differently (`ENOTSUP` on HFS+,
    // `EINVAL` elsewhere), so anything but a permission error, which the
    // moves would hit too, gets the fallback.
    match exchange(installed, update) {
        Ok(()) => check_moved_out(launched, update, || exchange(installed, update)),
        Err(error) if error.kind() != io::ErrorKind::PermissionDenied => {
            tracing::debug!(%error, "cannot exchange the app bundles; moving them instead");
            replace(launched, update, backup)
        }
        Err(error) => Err(error.into()),
    }
}

/// Go on only if what a move took out of the app's path, now at `out`, is the
/// launched app, told by its device and inode as root tells it. Anything else
/// came from a swap after the last check, and `move_back` undoes the move.
/// Its result is only logged: what the undo did is told afterwards by device
/// and inode as well ([`settle_not_launched`]).
fn check_moved_out(
    launched: &LaunchedBundle,
    out: &Path,
    move_back: impl FnOnce() -> io::Result<()>,
) -> Result<(), SwapError> {
    let found = entry_id(out).ok();
    if found == Some(launched.id) {
        return Ok(());
    }
    if let Err(error) = move_back() {
        tracing::warn!(%error, "what the swap moved out of the app's path could not be put back");
    }
    Err(SwapError::NotLaunched { found })
}

/// Exchange `installed` and `update` atomically (`renamex_np` with
/// `RENAME_SWAP` on macOS, `renameat2` with `RENAME_EXCHANGE` on Linux).
fn exchange(installed: &Path, update: &Path) -> io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};

    renameat_with(CWD, update, CWD, installed, RenameFlags::EXCHANGE).map_err(io::Error::from)
}

/// Move `from` to `to` only while nothing is at `to` (`RENAME_EXCL` on macOS,
/// `RENAME_NOREPLACE` on Linux), as root's exclusive moves do: a plain rename
/// replaces an empty directory another process put at `to`. A file system
/// without an exclusive rename gets the check that nothing is at `to` and a
/// plain rename, which leaves a moment for another process in between.
fn rename_noreplace(from: &Path, to: &Path) -> io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};
    use rustix::io::Errno;

    // `ENOTSUP` and `EOPNOTSUPP` are one value on Linux, so they are compared
    // rather than matched as patterns.
    let unsupported = [Errno::NOTSUP, Errno::OPNOTSUPP, Errno::INVAL, Errno::NOSYS];
    match renameat_with(CWD, from, CWD, to, RenameFlags::NOREPLACE) {
        Err(errno) if unsupported.contains(&errno) => {
            if fs::symlink_metadata(to).is_ok() {
                return Err(io::ErrorKind::AlreadyExists.into());
            }
            fs::rename(from, to)
        }
        other => other.map_err(io::Error::from),
    }
}

/// Move `update` to the app `launched` names, keeping what was there in
/// `backup` until that has succeeded. The first move goes onto nothing, and
/// what it brought to `backup` must be the launched app; anything else is
/// moved back, onto nothing. Should nothing be at the app's path for it, the
/// launched app moved away since the last check, or a folder above it became
/// a file: that too is [`SwapError::NotLaunched`], with nothing found. The
/// second move is [`move_update_in`].
fn replace(launched: &LaunchedBundle, update: &Path, backup: &Path) -> Result<(), SwapError> {
    let installed = launched.path.as_path();
    if let Err(error) = rename_noreplace(installed, backup) {
        let gone = matches!(error.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory)
            && matches!(still_at(installed, launched.id), Ok(false));
        return Err(if gone { SwapError::NotLaunched { found: None } } else { error.into() });
    }
    check_moved_out(launched, backup, || rename_noreplace(backup, installed))?;
    move_update_in(installed, update, backup)
}

/// The second of [`replace`]'s moves, once the launched app is in `backup`:
/// `update` to the app's path at `installed`, onto nothing. Whatever is
/// there, such as an empty directory or a link, was put there by another
/// process after the launched app moved out; it is left alone
/// ([`SwapError::Occupied`]). Should the move fail, the launched app moves
/// back, onto nothing too; when it cannot, the failed install keeps it
/// ([`keep_backup_if_not_restored`]).
fn move_update_in(installed: &Path, update: &Path, backup: &Path) -> Result<(), SwapError> {
    let Err(error) = rename_noreplace(update, installed) else {
        return Ok(());
    };
    // Best effort: the error worth reporting is the failed move, and a
    // failed restore is caught by `keep_backup_if_not_restored`.
    let _ = rename_noreplace(backup, installed);
    Err(if error.kind() == io::ErrorKind::AlreadyExists {
        SwapError::Occupied
    } else {
        error.into()
    })
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
#[cfg(target_os = "macos")]
const APP_CHANGED: i32 = 69;
#[cfg(target_os = "macos")]
const PAYLOAD_SIZE_CHANGED: i32 = 70;
#[cfg(target_os = "macos")]
const OUTCOME_UNKNOWN: i32 = 71;
/// The update is in place, but what root's exchange brought into its
/// directory stays there: the exchange back failed.
#[cfg(target_os = "macos")]
const INSTALLED_KEPT_IN_WORK_DIR: i32 = 72;
/// What [`PRIVILEGED_INSTALL`] writes before the path of an entry it kept:
/// in its own directory ([`KEPT_IN_WORK_DIR`], [`APP_CHANGED`],
/// [`OUTCOME_UNKNOWN`], [`INSTALLED_KEPT_IN_WORK_DIR`]), or next to the
/// installed app ([`KEPT_NEXT_TO_APP`]).
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
/// `root:admin 775`), where it can rename one entry over another. So root
/// works in a directory only it can enter, made with `mktemp -d` next to the
/// installed app (so on its volume, for the exchange), and from there checks
/// everything again:
///
/// 1. It enters the installed app's directory and the archive's directory with
///    `cd -P` and refuses either when `pwd -P` is not the path the app
///    resolved, so no component is a symbolic link. The app must not be a
///    link, and must be the entry this process was launched from, which the
///    user context found there again before it read the app's identity: its
///    device and inode (`$app`, `APP_CHANGED`, 69). The same `stat` reads
///    its owner, which the update is given.
/// 2. It opens the archive, refusing a link, and copies from what it opened
///    only if that is a regular file: at most one byte more than the
///    verified size, giving up after [`COPY_SECONDS`]. A link swapped in
///    between the check and the open only changes the bytes, which step 3
///    catches.
/// 3. It checks the copy's size (`PAYLOAD_SIZE_CHANGED`, 70) and SHA-256
///    (`PAYLOAD_CHANGED`, 65) against the bytes the app verified.
/// 4. It unpacks its copy, and for a certificate-signed installed app checks
///    the bundle against its designated requirement with `codesign` as root
///    (`IDENTITY_REFUSED`, 66).
/// 5. It swaps the update in as [`swap`] does. Every rename goes through
///    [`RENAME_JXA`]: the exchange, or else exclusive moves (`RENAME_EXCL`),
///    which fail on a name another process put at the destination instead of
///    moving into the directory or through the link it planted, as `mv`
///    would. What a rename brought into root's directory is told by its
///    device and inode, which only root can change there: the pinned app, or
///    root's own update. Anything else came from a swap at the installed
///    path after step 1; root renames it back and installs nothing (69).
///    Should that exchange back fail with the update at the installed path,
///    the update is installed and the other entry stays in root's directory
///    (`INSTALLED_KEPT_IN_WORK_DIR`, 72), as the user context counts such a
///    swap ([`settle_not_launched`]). An entry whose device and inode cannot
///    be read is not renamed again: what happened is unknown
///    (`OUTCOME_UNKNOWN`, 71).
///
/// Leaving, whatever the reason, including a signal, root deletes only what
/// it can tell is its own: its copy of the archive, its unused update, and
/// the previous app once one of the two renames that install the update has
/// succeeded. The pinned app at any other time, and anything root cannot
/// identify, stay in its directory, which is then opened to the user and
/// named on standard error: the app as `KEPT_IN_WORK_DIR` (68), anything
/// else with 69 unless root was already leaving with 68, 71 or 72. A previous
/// app that cannot be put back is first moved next to the installed app,
/// onto the first of the [`KEPT_NAMES`] [`kept_aside_name`]s nothing is at,
/// and named there (`KEPT_NEXT_TO_APP`, 67); a move there that fails leaves
/// it in root's directory (68).
#[cfg(target_os = "macos")]
const PRIVILEGED_INSTALL: &str = r#"ident() { /usr/bin/stat -f %d:%i -- "$1" 2>/dev/null; }
there() { [ -e "$1" ] || [ -L "$1" ]; }
rn() { /usr/bin/osascript -l JavaScript -e "$rename" "$@" </dev/null >/dev/null 2>&1; }
cd -P -- "$parent" && [ "$(pwd -P)" = "$parent" ] && [ -d "$name" ] && [ ! -L "$name" ] || exit 1
found=$(/usr/bin/stat -f '%d:%i %u:%g' -- "$name" 2>/dev/null) && [ "${found% *}" = "$app" ] || exit 69
owner=${found#* }
work=$(/usr/bin/mktemp -d .platevault-update.XXXXXXXX) && cd -P -- "$work" && here=$(ident .) || exit 1
cleanup() {
  status=$1
  trap - EXIT HUP INT TERM
  /bin/rm -f -- update.app.tar.gz
  keep=
  if [ -n "$renaming" ]; then
    for entry in previous.app "unpacked/$bundle"; do
      there "$entry" || continue
      id=$(ident "$entry")
      if [ "$id" = "$new" ] || { [ -n "$done" ] && [ "$id" = "$app" ]; }; then
        /bin/rm -rf -- "$entry"
      elif [ "$id" = "$app" ]; then
        keep=$entry status=68
      else
        [ -n "$keep" ] || keep=$entry
        case "$status" in 68|71|72) ;; *) status=69;; esac
      fi
    done
  fi
  if [ -z "$keep" ]; then
    /bin/rm -rf -- unpacked previous.app
    cd -P .. && [ "$(ident "$work")" = "$here" ] && /bin/rmdir -- "$work"
    exit "$status"
  fi
  /bin/rmdir unpacked 2>/dev/null
  /bin/chmod 755 .
  printf 'kept:%s/%s/%s' "$parent" "$work" "$keep" >&2
  exit "$status"
}
trap 'cleanup $?' EXIT
trap 'exit 1' HUP INT TERM
(cd -P -- "$archive_dir" && [ "$(pwd -P)" = "$archive_dir" ] && [ ! -L "$archive" ] && exec 3< "$archive" && [ -f /dev/fd/3 ] && exec /usr/bin/head -c "$((size + 1))" <&3) > update.app.tar.gz 2>/dev/null & copy=$!
(/bin/sleep "$copy_seconds"; /bin/kill "$copy") </dev/null >/dev/null 2>&1 & timer=$!
wait "$copy" 2>/dev/null; copied=$?
{ /bin/kill "$timer"; wait "$timer"; } 2>/dev/null
[ "$copied" = 0 ] || exit 1
[ "$(/usr/bin/stat -f %z update.app.tar.gz)" = "$size" ] || exit 70
digest=$(/usr/bin/shasum -a 256 < update.app.tar.gz) || exit 1
[ "$digest" = "$sha256  -" ] || exit 65
/bin/mkdir unpacked && /usr/bin/tar -x --no-same-owner -z -f update.app.tar.gz -C unpacked || exit 1
[ -d "unpacked/$bundle" ] && [ ! -L "unpacked/$bundle" ] && new=$(ident "unpacked/$bundle") || exit 1
[ -z "$requirement" ] || /usr/bin/codesign --verify --deep --strict --test-requirement "=$requirement" "unpacked/$bundle" || exit 66
/usr/sbin/chown -hR "$owner" "unpacked/$bundle" || exit 1
renaming=yes
rn swap "unpacked/$bundle" "../$name"
case "$(ident "unpacked/$bundle")" in
"$app") done=yes; exit 0;;
"$new") ;;
"") exit 71;;
*) rn swap "unpacked/$bundle" "../$name"
  [ "$(ident "../$name")" = "$new" ] && exit 72
  exit 69;;
esac
rn excl "../$name" previous.app
there previous.app || exit 1
moved=$(ident previous.app)
[ -n "$moved" ] || exit 71
[ "$moved" = "$app" ] || { rn excl previous.app "../$name"; exit 69; }
rn excl "unpacked/$bundle" "../$name"
there "unpacked/$bundle" || { done=yes; exit 0; }
rn excl previous.app "../$name"
there previous.app || exit 1
n=1
while [ "$n" -le "$kept_names" ]; do
  aside=$kept_head
  [ "$n" = 1 ] || aside="$aside $n"
  aside=$aside$kept_tail
  if ! there "../$aside"; then
    rn excl previous.app "../$aside"
    there previous.app && exit 68
    printf 'kept:%s/%s' "$parent" "$aside" >&2
    exit 67
  fi
  n=$((n + 1))
done
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
    /// The installed app's device and inode at launch, which the user context
    /// found again before it read the app's identity: root replaces only
    /// that entry.
    app: (u64, u64),
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
    /// The [`kept_aside_name`]s a previous app that cannot be put back is
    /// kept under, next to the installed app, in the parts either side of
    /// their number ([`kept_aside_parts`]).
    kept: (OsString, OsString),
}

#[cfg(target_os = "macos")]
impl PrivilegedInstall {
    /// The privileged install of `payload`'s bundle, unpacked by the user
    /// context at `update`, over the app `launched` names, signed as
    /// `identity`, keeping a previous app it cannot put back named for
    /// `set_aside`.
    fn new(
        launched: &LaunchedBundle,
        payload: &Payload<'_>,
        update: &Path,
        identity: &Identity,
        set_aside: &str,
    ) -> Result<Self, UpdateError> {
        Self::of(
            &launched.path,
            launched.id,
            payload.path(),
            (payload.size(), payload.sha256()),
            update,
            identity,
            set_aside,
        )
    }

    /// [`Self::new`] for the archive at `archive` whose verified bytes are
    /// `size` long and hash to `sha256`. Refused when `installed` is no
    /// longer the entry `pinned` names, the one launched: the identity check,
    /// the unpack and the failed swap may have taken seconds, in which
    /// another process of the user's could swap another bundle in.
    fn of(
        installed: &Path,
        pinned: (u64, u64),
        archive: &Path,
        (size, sha256): (u64, &str),
        update: &Path,
        identity: &Identity,
        set_aside: &str,
    ) -> Result<Self, UpdateError> {
        if !still_at(installed, pinned)? {
            return Err(app_replaced(installed, Vec::new()));
        }
        let (parent, name) = resolved_location(installed)?;
        let (archive_dir, archive) = resolved_location(archive)?;
        let bundle = update.file_name().ok_or_else(|| {
            UpdateError::Install(format!("{} has no file name", update.display()))
        })?;
        Ok(Self {
            parent,
            name,
            app: pinned,
            archive_dir,
            archive,
            size,
            sha256: sha256.to_owned(),
            bundle: bundle.to_os_string(),
            requirement: match identity {
                Identity::Designated(requirement) => Some(requirement.clone()),
                Identity::AdHoc | Identity::Unsigned => None,
            },
            kept: kept_aside_parts(installed, set_aside),
        })
    }

    /// Run the install as root once the user authorized it in a dialog that
    /// says `prompt`. Where root kept what it found in the app's place when
    /// the update is in place all the same, as [`Self::outcome`] says.
    fn run(&self, prompt: &str) -> Result<Vec<PathBuf>, UpdateError> {
        let output =
            osascript().arg("-e").arg(administrator_script(&self.command(), prompt)).output()?;
        if output.status.success() {
            return Ok(Vec::new());
        }
        self.outcome(String::from_utf8_lossy(&output.stderr).trim())
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
        let (dev, ino) = self.app;
        format!(
            "exec /usr/bin/env -i PATH={SAFE_PATH} parent={} name={} app={dev}:{ino} archive_dir={} archive={} size={} sha256={} bundle={} requirement={} kept_head={} kept_tail={} kept_names={KEPT_NAMES} rename={} copy_seconds={copy_seconds} /bin/sh -c {}",
            path(&self.parent),
            text(&self.name),
            path(&self.archive_dir),
            text(&self.archive),
            self.size,
            sh_quote(&self.sha256),
            text(&self.bundle),
            sh_quote(self.requirement.as_deref().unwrap_or_default()),
            text(&self.kept.0),
            text(&self.kept.1),
            sh_quote(rename),
            sh_quote(PRIVILEGED_INSTALL),
        )
    }

    /// What a failed run's `osascript` `message` stands for. The update is in
    /// place with the entry root kept in its directory named
    /// ([`INSTALLED_KEPT_IN_WORK_DIR`]), as after a swap that
    /// [`settle_not_launched`] finds installed the update; any other status
    /// is the [`Self::failure`].
    fn outcome(&self, message: &str) -> Result<Vec<PathBuf>, UpdateError> {
        if Self::exit_status(message) == Some(INSTALLED_KEPT_IN_WORK_DIR) {
            // Should the message not parse, the installed app's directory is
            // where the script's directory is.
            return Ok(vec![Self::kept_named(message).unwrap_or_else(|| self.parent.clone())]);
        }
        Err(self.failure(message))
    }

    /// The shell's exit status a failed run's `message` ends with, or
    /// [`USER_CANCELED`], in parentheses: `AppleScript` words it as
    /// `0:40: execution error: … (65)`.
    fn exit_status(message: &str) -> Option<i32> {
        message
            .rsplit_once('(')
            .and_then(|(_, status)| status.strip_suffix(')'))
            .and_then(|status| status.parse::<i32>().ok())
    }

    /// The entry the script kept, which `message` names after
    /// [`KEPT_MARKER`].
    fn kept_named(message: &str) -> Option<PathBuf> {
        message
            .split_once(KEPT_MARKER)
            .and_then(|(_, rest)| rest.rsplit_once(" ("))
            .map(|(kept, _)| PathBuf::from(kept))
    }

    /// The error a failed run's `message` stands for when the update is not
    /// in place.
    fn failure(&self, message: &str) -> UpdateError {
        let status = Self::exit_status(message);
        let named = Self::kept_named(message);
        let not_restored = |kept: PathBuf| UpdateError::PreviousAppNotRestored {
            kept,
            cause: Box::new(UpdateError::Install(
                "the update could not be moved into place with administrator rights".to_owned(),
            )),
        };
        let changed = "before it could be installed with administrator rights";
        match status {
            Some(USER_CANCELED) => UpdateError::Permission(
                "the administrator prompt to move the update into place was cancelled".to_owned(),
            ),
            Some(PAYLOAD_CHANGED) => UpdateError::Signature(format!("the update changed {changed}")),
            Some(PAYLOAD_SIZE_CHANGED) => {
                UpdateError::Signature(format!("the update changed size {changed}"))
            }
            Some(IDENTITY_REFUSED) => UpdateError::Identity(format!(
                "the update is not signed by the identity of the installed app ({})",
                self.requirement.as_deref().unwrap_or_default()
            )),
            // Should the message not parse, the first name is where the
            // script kept it, and the installed app's directory is where its
            // own directory is.
            Some(KEPT_NEXT_TO_APP) => not_restored(named.unwrap_or_else(|| {
                let (mut first, tail) = self.kept.clone();
                first.push(tail);
                self.parent.join(first)
            })),
            Some(KEPT_IN_WORK_DIR) => not_restored(named.unwrap_or_else(|| self.parent.clone())),
            Some(APP_CHANGED) => {
                app_replaced(&self.parent.join(&self.name), named.into_iter().collect())
            }
            Some(OUTCOME_UNKNOWN) => UpdateError::Install(format!(
                "whether the update was moved into place with administrator rights could not be told{}",
                named.map_or_else(String::new, |kept| format!(
                    "; what was found is kept at {}",
                    kept.display()
                ))
            )),
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

/// How many numbered names [`move_aside`], and root for a previous app it
/// cannot put back, try in one directory.
const KEPT_NAMES: u32 = 100;

/// `<name> (<set_aside>).app`, or `<name> (<set_aside> <number>).app` from 2
/// on: what a bundle kept aside during an update is called where it is
/// kept. `set_aside` is the user's word for that, not for what the bundle
/// is: it may be the previous app or whatever else was found in the app's
/// place (astro-plan-rx07l).
fn kept_aside_name(installed: &Path, set_aside: &str, number: u32) -> OsString {
    let (mut name, tail) = kept_aside_parts(installed, set_aside);
    if number > 1 {
        name.push(format!(" {number}"));
    }
    name.push(tail);
    name
}

/// [`kept_aside_name`] either side of the ` <number>` it takes from 2 on:
/// `<name> (<set_aside>` and `).app`, which the root script, which numbers
/// them alike, is given.
fn kept_aside_parts(installed: &Path, set_aside: &str) -> (OsString, OsString) {
    let mut head = installed.file_stem().unwrap_or_default().to_os_string();
    head.push(format!(" ({set_aside}"));
    let mut tail = OsString::from(")");
    if let Some(extension) = installed.extension() {
        tail.push(".");
        tail.push(extension);
    }
    (head, tail)
}

/// Where and under what name [`move_aside`] keeps an entry that came out of
/// the app's path: next to the installed app, or else in `fallback_dir` (the
/// home folder), named for `set_aside` ([`kept_aside_name`]).
#[derive(Clone, Copy, Debug)]
struct KeepAside<'a> {
    set_aside: &'a str,
    fallback_dir: Option<&'a Path>,
}

/// After a failed swap, where the launched app is kept when it is no longer
/// at its path, `None` when it is ([`still_at`]). Whatever another process
/// put at the app's path does not count as the app back in place. Every
/// entry at `left`, the two places in `staging` a swap moves things to, that
/// is not the update (`update_id`) is kept aside by [`keep_all_but`], so
/// nothing is deleted with `staging`: the launched app, should it not have
/// gone back, and anything else found there.
fn keep_backup_if_not_restored(
    launched: &LaunchedBundle,
    staging: tempfile::TempDir,
    left: [&Path; 2],
    update_id: (u64, u64),
    aside: KeepAside<'_>,
) -> Option<PathBuf> {
    let installed = launched.path.as_path();
    let restored = still_at(installed, launched.id).unwrap_or(false);
    let kept = keep_all_but(installed, staging, left, update_id, aside);
    let previous = kept.iter().find(|kept| entry_id(kept).is_ok_and(|id| id == launched.id));
    if restored || previous.is_none() {
        if !kept.is_empty() {
            tracing::warn!(
                ?kept,
                restored,
                "the failed swap left entries in staging that are not the update; they are kept"
            );
        }
        return None;
    }
    previous.cloned()
}

/// Move `entry`, which came out of the app's path at `installed` and must not
/// be deleted, out of the staging dir, which is deleted on drop and sits in
/// the system temp dir that macOS empties on its own: next to `installed`, or
/// into `aside`'s fallback dir (the home folder) when that is not writable,
/// under the first [`kept_aside_name`] not taken there. Where it went; `None`
/// when neither worked.
fn move_aside(installed: &Path, entry: &Path, aside: KeepAside<'_>) -> Option<PathBuf> {
    [installed.parent(), aside.fallback_dir]
        .into_iter()
        .flatten()
        .find_map(|dir| move_into(dir, installed, aside.set_aside, entry))
}

/// Move `entry` into `dir` under the first free [`kept_aside_name`] for
/// `installed` and `set_aside`, never onto anything already there; `None`
/// when `dir` takes none of them.
fn move_into(dir: &Path, installed: &Path, set_aside: &str, entry: &Path) -> Option<PathBuf> {
    for number in 1..=KEPT_NAMES {
        let kept = dir.join(kept_aside_name(installed, set_aside, number));
        match rename_noreplace(entry, &kept) {
            Ok(()) => return Some(kept),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                tracing::debug!(%error, dir = %dir.display(), "cannot keep the entry here");
                return None;
            }
        }
    }
    None
}

/// The macOS installer over an explicit launched bundle, for tests.
#[cfg(test)]
pub struct BundleInstaller<C> {
    pub launched: LaunchedBundle,
    pub signing: C,
}

#[cfg(test)]
impl<C: CodeSigning> Installer for BundleInstaller<C> {
    fn install(
        &self,
        mut payload: Payload<'_>,
        _mode: InstallMode,
        wording: &InstallWording,
    ) -> Result<Installed, UpdateError> {
        install_bundle(&self.launched, &mut payload, &self.signing, wording)
    }
}

#[cfg(test)]
mod tests {
    //! The swap, ported from `tauri-plugin-updater` 2.13.3's tests
    //! (`replace_bundle_*`, `swap_bundle_*`, `privileged_install_*`,
    //! `keep*_backup_*`), with the ownership step this port adds and the
    //! privileged install's own checks (astro-plan-ryj83).

    use std::fs;
    use std::io;
    use std::os::unix::fs::MetadataExt as _;
    use std::path::{Path, PathBuf};

    use flate2::write::GzEncoder;
    use flate2::Compression;

    use super::{
        app_replaced, check_moved_out, entry_id, exchange, failed_swap, identify_launched,
        install_bundle_swapping, keep_backup_if_not_restored, move_aside, move_update_in,
        rename_noreplace, replace, settle_not_launched, staging_dir_among, swap, CodeSigning,
        Identity, InstallWording, Installed, KeepAside, LaunchedBundle, SwapError,
    };
    use crate::update::{Package, UpdateError};

    /// Where the tests keep what must not be deleted: next to the app, or
    /// else in `fallback_dir`, named for [`InstallWording::TEST_SET_ASIDE`].
    fn aside(fallback_dir: Option<&Path>) -> KeepAside<'_> {
        KeepAside { set_aside: InstallWording::TEST_SET_ASIDE, fallback_dir }
    }

    /// A bundle directory at `path` holding a `version` file.
    fn bundle(path: &Path, version: &str) {
        fs::create_dir(path).expect("bundle");
        fs::write(path.join("version"), version).expect("version");
    }

    fn version(path: &Path) -> String {
        fs::read_to_string(path.join("version")).expect("version")
    }

    /// `app` as a `.app.tar.gz` holding it as `name`.
    fn archive_of(app: &Path, name: &str) -> Vec<u8> {
        let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        builder.append_dir_all(name, app).expect("archive the bundle");
        builder.into_inner().expect("tar").finish().expect("gzip")
    }

    /// The bundle at `path`, as launched now.
    fn launched(path: &Path) -> LaunchedBundle {
        LaunchedBundle::at(path.to_path_buf()).expect("launch")
    }

    /// Moves the app at `installed` away to `moved-away.app` and puts
    /// another bundle, `foreign`, at its name, as another process of the
    /// user's can, and of an admin user's can in `/Applications`.
    fn replace_installed(dir: &Path, installed: &Path) {
        fs::rename(installed, dir.join("moved-away.app")).expect("move the app away");
        bundle(installed, "foreign");
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

    /// Signing whose identity read swaps another bundle in at the app's path,
    /// as another process of the user's could, after moving the app to
    /// `moved_to`.
    struct SwapsWhileRead {
        moved_to: PathBuf,
    }

    impl CodeSigning for SwapsWhileRead {
        fn identity(&self, bundle_path: &Path) -> Result<Identity, UpdateError> {
            fs::rename(bundle_path, &self.moved_to).expect("move the app away");
            bundle(bundle_path, "foreign");
            Ok(Identity::Unsigned)
        }

        fn satisfies(&self, _bundle: &Path, _requirement: &str) -> Result<bool, UpdateError> {
            unreachable!("the pin checks no signature")
        }
    }

    /// The launched app is found again before its identity is read: a bundle
    /// swapped in during the read is not what that check saw, so it passes,
    /// and the pin the privileged install then refuses the swap by is the
    /// launched app's.
    #[test]
    fn the_launched_app_is_found_again_before_its_identity_is_read() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, moved) = (dir.path().join("App.app"), dir.path().join("moved-away.app"));
        bundle(&installed, "old");
        let app = fs::symlink_metadata(&installed).expect("metadata");
        let launched = LaunchedBundle::at(installed.clone()).expect("launch");

        identify_launched(&launched, &SwapsWhileRead { moved_to: moved.clone() })
            .expect("the app was still the launched one before its identity was read");

        assert_eq!(version(&installed), "foreign", "the other bundle was swapped in");
        assert_eq!(version(&moved), "old");
        assert_eq!(launched.id, (app.dev(), app.ino()), "the pin is the launched app's");
    }

    /// The launched bundle is the `.app` directory three levels above the
    /// running executable.
    #[test]
    fn the_launched_bundle_is_the_app_holding_the_executable() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app = dir.path().join("X.app");
        fs::create_dir_all(app.join("Contents/MacOS")).expect("bundle dirs");
        let executable = app.join("Contents/MacOS/x");
        fs::write(&executable, "").expect("executable");
        let entry = fs::symlink_metadata(&app).expect("metadata");

        let launched = LaunchedBundle::holding(&executable).expect("launched bundle");

        assert_eq!(launched.path, app);
        assert_eq!(launched.id, (entry.dev(), entry.ino()));
    }

    /// The launched app's folder replaced by a file reads as a replaced app,
    /// as an empty path does, not as an error reading the file system.
    #[test]
    fn a_launched_app_whose_folder_became_a_file_is_replaced() {
        let dir = tempfile::tempdir().expect("tempdir");
        let folder = dir.path().join("Applications");
        fs::create_dir(&folder).expect("folder");
        let installed = folder.join("App.app");
        bundle(&installed, "old");
        let launched = launched(&installed);
        fs::rename(&folder, dir.path().join("Moved")).expect("move the folder");
        fs::write(&folder, "a file").expect("a file in its place");

        let error = launched.check_in_place().expect_err("replaced");

        assert!(matches!(error, UpdateError::AppReplaced { .. }), "{error}");
    }

    #[test]
    fn replace_moves_the_update_into_place() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, update, backup) =
            (dir.path().join("App.app"), dir.path().join("update"), dir.path().join("backup"));
        bundle(&installed, "old");
        bundle(&update, "new");

        replace(&launched(&installed), &update, &backup).expect("replace");

        assert_eq!(version(&installed), "new");
        assert_eq!(version(&backup), "old");
        assert!(!update.exists());
    }

    #[test]
    fn replace_puts_the_installed_bundle_back_when_the_move_fails() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, backup) = (dir.path().join("App.app"), dir.path().join("backup"));
        bundle(&installed, "old");

        let error = replace(&launched(&installed), &dir.path().join("missing"), &backup);

        assert!(
            matches!(&error, Err(SwapError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound),
            "{error:?}"
        );
        assert_eq!(version(&installed), "old");
        assert!(!backup.exists());
    }

    #[test]
    fn a_missing_update_leaves_the_installed_app_intact() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, backup) = (dir.path().join("App.app"), dir.path().join("backup"));
        bundle(&installed, "old");

        let error = swap(&launched(&installed), &dir.path().join("missing"), &backup);

        assert!(
            matches!(&error, Err(SwapError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound),
            "{error:?}"
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

        swap(&launched(&installed), &update, &backup).expect("swap");

        assert_eq!(version(&installed), "new");
        let previous = if exchange_supported(dir.path()) { update } else { backup };
        assert_eq!(version(&previous), "old", "the previous app waits in the staging dir");
    }

    /// Another bundle swapped in after the last check: what the swap moved
    /// out of the app's path is not the launched app, so it goes back and the
    /// update stays in staging, whether the swap exchanged or moved.
    #[test]
    fn the_swap_puts_back_a_bundle_that_is_not_the_launched_app() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, update) = (dir.path().join("App.app"), dir.path().join("update"));
        bundle(&installed, "old");
        bundle(&update, "new");
        let backup = dir.path().join("backup");
        let launched = launched(&installed);
        replace_installed(dir.path(), &installed);

        let error = swap(&launched, &update, &backup);

        assert!(matches!(error, Err(SwapError::NotLaunched { found: Some(_) })), "{error:?}");
        assert_eq!(version(&installed), "foreign", "the other bundle is back");
        assert_eq!(version(&update), "new", "nothing was installed");
        assert_eq!(version(&dir.path().join("moved-away.app")), "old");
        assert!(!backup.exists());
    }

    /// The same in the moves alone, which APFS would otherwise never reach:
    /// the first move brought the other bundle out, so it moves back.
    #[test]
    fn replace_puts_back_a_bundle_that_is_not_the_launched_app() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, update, backup) =
            (dir.path().join("App.app"), dir.path().join("update"), dir.path().join("backup"));
        bundle(&installed, "old");
        bundle(&update, "new");
        let launched = launched(&installed);
        replace_installed(dir.path(), &installed);

        let error = replace(&launched, &update, &backup);

        assert!(matches!(error, Err(SwapError::NotLaunched { found: Some(_) })), "{error:?}");
        assert_eq!(version(&installed), "foreign", "the other bundle is back");
        assert_eq!(version(&update), "new", "nothing was installed");
        assert!(!backup.exists());
    }

    /// The launched app moved away after the last check, before the swap, or
    /// a folder above it became a file: the exchange and the first move find
    /// nothing at the app's path. That is a replaced app, which asks for a
    /// restart with nothing kept, not an error reading the file system.
    #[test]
    fn an_app_gone_before_the_swap_is_replaced() {
        fn move_the_app(dir: &Path) {
            fs::rename(dir.join("Applications/App.app"), dir.join("moved-away.app"))
                .expect("move the launched app away");
        }
        fn file_for_its_folder(dir: &Path) {
            move_the_app(dir);
            fs::remove_dir(dir.join("Applications")).expect("its folder");
            fs::write(dir.join("Applications"), "a file").expect("a file in its place");
        }
        let cases: [(&str, fn(&Path)); 2] =
            [("moved", move_the_app), ("folder became a file", file_for_its_folder)];
        for (case, gone) in cases {
            let dir = tempfile::tempdir().expect("tempdir");
            fs::create_dir(dir.path().join("Applications")).expect("Applications");
            let installed = dir.path().join("Applications/App.app");
            bundle(&installed, "old");
            let launched = launched(&installed);
            let staging = tempfile::tempdir_in(dir.path()).expect("staging");
            let update = staging.path().join("App.app");
            bundle(&update, "new");
            let update_id = entry_id(&update).expect("update");
            let backup = staging.path().join("previous.app");
            gone(dir.path());

            let swapped = swap(&launched, &update, &backup);

            assert!(
                matches!(swapped, Err(SwapError::NotLaunched { found: None })),
                "{case}: {swapped:?}"
            );
            let outcome = settle_not_launched(
                &installed,
                staging,
                [&update, &backup],
                (update_id, None),
                aside(None),
            );
            assert!(
                matches!(&outcome, Err(UpdateError::AppReplaced { kept, .. }) if kept.is_empty()),
                "{case}: {outcome:?}"
            );
            assert_eq!(version(&dir.path().join("moved-away.app")), "old", "{case}");
            assert!(!dir.path().join("Applications").join(KEPT_APP).exists(), "{case}");
        }
    }

    /// The first move goes onto nothing too: an entry already at `backup`,
    /// where only another process can have put it, stops it, and the
    /// launched app stays where it is.
    #[test]
    fn the_first_move_does_not_replace_an_entry_in_staging() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (installed, update, backup) =
            (dir.path().join("App.app"), dir.path().join("update"), dir.path().join("backup"));
        bundle(&installed, "old");
        bundle(&update, "new");
        let launched = launched(&installed);
        fs::create_dir(&backup).expect("an empty directory at the backup's name");
        let planted = entry_id(&backup).expect("planted");

        let moved = replace(&launched, &update, &backup);

        assert!(
            matches!(&moved, Err(SwapError::Io(error)) if error.kind() == io::ErrorKind::AlreadyExists),
            "{moved:?}"
        );
        assert_eq!(entry_id(&installed).ok(), Some(launched.id), "the launched app stays");
        assert_eq!(version(&installed), "old");
        assert_eq!(entry_id(&backup).ok(), Some(planted), "the planted entry is untouched");
        assert_eq!(version(&update), "new", "nothing was installed");
    }

    /// Exchange the entries at `a` and `b`, as [`exchange`] does, by renames
    /// through `dir`, which work on any file system.
    fn exchange_by_renames(a: &Path, b: &Path, dir: &Path) {
        let parked = dir.join("parked");
        fs::rename(a, &parked).expect("park");
        fs::rename(b, a).expect("move in");
        fs::rename(&parked, b).expect("unpark");
    }

    /// Where the tests keep what came out of `App.app`'s place, named as set
    /// aside whether it is the previous app or another bundle
    /// (astro-plan-rx07l).
    const KEPT_APP: &str = "App (set aside).app";

    /// What an exchange leaves when another bundle was swapped in at the
    /// app's path just before it.
    struct Exchanged {
        staging: tempfile::TempDir,
        /// The app's path, which holds the update, `new`.
        installed: PathBuf,
        /// Where the update was in `staging`, which holds the other bundle,
        /// `foreign`.
        update: PathBuf,
        /// The launched app, `old`, now at `moved-away.app`.
        launched: LaunchedBundle,
        /// The update's device and inode, read before the exchange.
        update_id: (u64, u64),
    }

    impl Exchanged {
        fn with_another_bundle(dir: &Path) -> Self {
            let installed = dir.join("App.app");
            bundle(&installed, "old");
            let launched = launched(&installed);
            let staging = tempfile::tempdir_in(dir).expect("staging");
            let update = staging.path().join("App.app");
            bundle(&update, "new");
            let update_id = entry_id(&update).expect("update");
            replace_installed(dir, &installed);
            exchange_by_renames(&installed, &update, dir);
            Self { staging, installed, update, launched, update_id }
        }

        /// What `swap` makes of it when its exchange back is `move_back`.
        fn put_back(
            self,
            move_back: impl FnOnce() -> io::Result<()>,
        ) -> Result<Vec<PathBuf>, UpdateError> {
            let Err(SwapError::NotLaunched { found }) =
                check_moved_out(&self.launched, &self.update, move_back)
            else {
                panic!("not refused");
            };
            let backup = self.staging.path().join("previous.app");
            settle_not_launched(
                &self.installed,
                self.staging,
                [&self.update, &backup],
                (self.update_id, found),
                aside(None),
            )
        }
    }

    /// The exchange back fails, as it does once another process took the
    /// other bundle out of staging or the app's path changed again: the
    /// update stays at the app's path. That is an install, not a refusal,
    /// and the other bundle is kept aside, not deleted with staging.
    #[test]
    fn a_failed_put_back_leaves_the_update_installed_and_the_other_bundle_kept() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exchanged = Exchanged::with_another_bundle(dir.path());
        let installed = exchanged.installed.clone();

        let outcome = exchanged.put_back(|| Err(io::Error::other("the exchange back failed")));

        let kept = dir.path().join(KEPT_APP);
        assert_eq!(outcome.ok(), Some(vec![kept.clone()]), "the update is in place");
        assert_eq!(version(&installed), "new");
        assert_eq!(version(&kept), "foreign", "the other bundle is kept");
        assert_eq!(version(&dir.path().join("moved-away.app")), "old");
    }

    /// Just before the exchange back, another process takes the update off
    /// the app's path and puts the launched app back there: the exchange back
    /// brings the launched app into staging. It is kept aside, not deleted
    /// with staging, and nothing was installed.
    #[test]
    fn an_entry_the_put_back_brings_into_staging_is_kept_aside() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exchanged = Exchanged::with_another_bundle(dir.path());
        let (installed, update) = (exchanged.installed.clone(), exchanged.update.clone());

        let outcome = exchanged.put_back(|| {
            fs::rename(&installed, dir.path().join("taken.app"))?;
            fs::rename(dir.path().join("moved-away.app"), &installed)?;
            exchange_by_renames(&installed, &update, dir.path());
            Ok(())
        });

        let kept = dir.path().join(KEPT_APP);
        assert!(kept.exists(), "the launched app was deleted with staging: {outcome:?}");
        assert_eq!(version(&kept), "old");
        assert!(
            matches!(&outcome, Err(UpdateError::AppReplaced { kept: at, .. }) if *at == std::slice::from_ref(&kept)),
            "{outcome:?}"
        );
        assert_eq!(version(&installed), "foreign");
        assert_eq!(version(&dir.path().join("taken.app")), "new");
    }

    /// An exchange back that brings the update back into staging leaves
    /// nothing to keep: the update goes with staging, the other bundle stays
    /// at the app's path, and nothing was installed.
    #[test]
    fn a_put_back_that_brings_back_the_update_keeps_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let exchanged = Exchanged::with_another_bundle(dir.path());
        let (installed, update) = (exchanged.installed.clone(), exchanged.update.clone());

        let outcome = exchanged.put_back(|| {
            exchange_by_renames(&installed, &update, dir.path());
            Ok(())
        });

        assert!(
            matches!(&outcome, Err(UpdateError::AppReplaced { kept, .. }) if kept.is_empty()),
            "{outcome:?}"
        );
        assert_eq!(version(&installed), "foreign");
        assert!(!dir.path().join(KEPT_APP).exists(), "nothing is kept");
        assert!(!update.exists(), "the update went with staging");
    }

    /// The moves alone: the first move brought another bundle out of the
    /// app's path, and before it moves back another process puts an empty
    /// directory there, so the exclusive move back fails. The other bundle
    /// is kept aside, not deleted with staging, the planted directory is left
    /// alone, and nothing was installed.
    #[test]
    fn a_failed_move_back_keeps_the_other_bundle_aside_and_installs_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        bundle(&installed, "old");
        let launched = launched(&installed);
        let staging = tempfile::tempdir_in(dir.path()).expect("staging");
        let (update, backup) =
            (staging.path().join("App.app"), staging.path().join("previous.app"));
        bundle(&update, "new");
        let update_id = entry_id(&update).expect("update");
        replace_installed(dir.path(), &installed);
        rename_noreplace(&installed, &backup).expect("the first move");

        let Err(SwapError::NotLaunched { found }) = check_moved_out(&launched, &backup, || {
            fs::create_dir(&installed).expect("an empty directory at the app's path");
            rename_noreplace(&backup, &installed)
        }) else {
            panic!("not refused");
        };
        let outcome = settle_not_launched(
            &installed,
            staging,
            [&update, &backup],
            (update_id, found),
            aside(None),
        );

        let kept = dir.path().join(KEPT_APP);
        assert!(
            matches!(&outcome, Err(UpdateError::AppReplaced { kept: at, .. }) if *at == [kept.clone()]),
            "{outcome:?}"
        );
        assert_eq!(version(&kept), "foreign", "the other bundle is kept, not deleted with staging");
        assert_eq!(fs::read_dir(&installed).expect("planted").count(), 0, "left alone");
        assert_eq!(version(&dir.path().join("moved-away.app")), "old");
    }

    /// Signing that reads every app as unsigned, so no requirement is checked.
    struct NoSignature;

    impl CodeSigning for NoSignature {
        fn identity(&self, _bundle: &Path) -> Result<Identity, UpdateError> {
            Ok(Identity::Unsigned)
        }

        fn satisfies(&self, _bundle: &Path, _requirement: &str) -> Result<bool, UpdateError> {
            unreachable!("an unsigned app pins no requirement")
        }
    }

    /// A swap raced as [`Exchanged`] is: another bundle is swapped in at the
    /// app's path just before the exchange, and the exchange back fails.
    fn exchange_over_another_bundle_and_fail_back(
        launched: &LaunchedBundle,
        update: &Path,
        _backup: &Path,
    ) -> Result<(), SwapError> {
        let dir = launched.path.parent().expect("the app's directory");
        replace_installed(dir, &launched.path);
        exchange_by_renames(&launched.path, update, dir);
        check_moved_out(launched, update, || Err(io::Error::other("the exchange back failed")))
    }

    /// The whole install over that race: the update is in place all the
    /// same, so it is installed, and the relaunch names where the other
    /// bundle is kept, which only the log said before.
    #[tokio::test]
    async fn an_install_with_the_update_in_place_after_a_failed_put_back_names_what_was_kept() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        bundle(&installed, "old");
        let source = tempfile::tempdir().expect("source");
        let new = source.path().join("App.app");
        bundle(&new, "new");
        let staged = crate::update::tests::stage(Package::App, &archive_of(&new, "App.app")).await;

        let outcome = install_bundle_swapping(
            &launched(&installed),
            &mut staged.reverify().expect("verified"),
            &NoSignature,
            &InstallWording::for_tests(),
            exchange_over_another_bundle_and_fail_back,
        );

        let kept = dir.path().join(KEPT_APP);
        assert_eq!(outcome.ok(), Some(Installed::Relaunch { kept_aside: vec![kept.clone()] }));
        assert_eq!(version(&installed), "new");
        assert_eq!(version(&kept), "foreign", "the other bundle is kept, not deleted with staging");
        assert_eq!(version(&dir.path().join("moved-away.app")), "old");
    }

    /// The two-moves undo moves onto nothing: an empty directory another
    /// process put at the app's path, which a plain rename would replace,
    /// stops it instead.
    #[test]
    fn the_exclusive_move_does_not_replace_an_empty_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (from, to) = (dir.path().join("from.app"), dir.path().join("to.app"));
        bundle(&from, "old");
        fs::create_dir(&to).expect("an empty directory");

        let error = rename_noreplace(&from, &to).expect_err("refused");

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error}");
        assert_eq!(version(&from), "old");
        fs::remove_dir(&to).expect("remove the empty directory");
        rename_noreplace(&from, &to).expect("onto nothing");
        assert_eq!(version(&to), "old");
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

        use sha2::{Digest as _, Sha256};

        use super::super::super::codesign::probe_bundle;
        use super::super::{
            administrator_script, applescript_string, entry_id, osascript, Identity,
            InstallWording, PrivilegedInstall, COPY_SECONDS, RENAME_JXA,
        };
        use super::{archive_of, bundle, owner, replace_installed, version};
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

        fn sha256(bytes: &[u8]) -> String {
            format!("{:x}", Sha256::digest(bytes))
        }

        /// The files of a privileged install in `dir` as the user context
        /// leaves them: an installed app, and the verified archive of `update`
        /// (as `name`) in a directory of its own, with the archive's bytes.
        fn stage_files(dir: &Path, update: &Path, name: &str) -> (PathBuf, PathBuf, Vec<u8>) {
            let installed = dir.join(INSTALLED);
            bundle(&installed, "old");
            let payload = dir.join("payload");
            fs::create_dir(&payload).expect("payload dir");
            let archive = payload.join("update.app.tar.gz");
            let bytes = archive_of(update, name);
            fs::write(&archive, &bytes).expect("archive");
            (installed, archive, bytes)
        }

        /// [`PrivilegedInstall::of`] over [`stage_files`]' files, with the
        /// app pinned as `pinned`.
        fn privileged_install(
            dir: &Path,
            (installed, archive, bytes): (&Path, &Path, &[u8]),
            pinned: (u64, u64),
            name: &str,
            identity: &Identity,
        ) -> Result<PrivilegedInstall, UpdateError> {
            // The user context's unpacked copy only lends its name.
            let unpacked = dir.join("staging").join(name);
            let size = u64::try_from(bytes.len()).expect("size");
            PrivilegedInstall::of(
                installed,
                pinned,
                archive,
                (size, &sha256(bytes)),
                &unpacked,
                identity,
                InstallWording::TEST_SET_ASIDE,
            )
        }

        /// A privileged install in `dir` as the user context leaves it, with
        /// the installed app pinned as it is.
        fn stage_with(
            dir: &Path,
            update: &Path,
            name: &str,
            identity: &Identity,
        ) -> (PathBuf, PathBuf, PrivilegedInstall) {
            let (installed, archive, bytes) = stage_files(dir, update, name);
            let pinned = entry_id(&installed).expect("pin");
            let install =
                privileged_install(dir, (&installed, &archive, &bytes), pinned, name, identity)
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

        /// What a previous app that cannot be put back is called beside it:
        /// set aside, as anything else kept is (astro-plan-rx07l).
        const KEPT: &str = "Bob's \"App\" (set aside).app";

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

        /// The re-review's case: another process of the user's changes the
        /// staged archive while the password dialog is open, keeping its
        /// size. Root's copy no longer has the digest the app verified.
        #[test]
        fn an_archive_changed_after_the_check_is_refused_on_its_digest() {
            let dir = hostile_dir();
            let (installed, archive, install) = stage(dir.path());
            let mut changed = fs::read(&archive).expect("archive");
            let last = changed.len() - 5;
            changed[last] ^= 0xff;
            fs::write(&archive, changed).expect("change the archive");

            let status = run(&install.command());

            assert_eq!(status, Some(65));
            assert_refused(dir.path(), &installed);
            let message = "0:1: execution error: The command exited with a non-zero status. (65)";
            assert!(matches!(install.failure(message), UpdateError::Signature(_)));
        }

        /// The same with another app's archive in its place, which differs in
        /// size: refused on that, before its digest (70).
        #[test]
        fn an_archive_swapped_after_the_check_is_refused_on_its_size() {
            let dir = hostile_dir();
            let (installed, archive, install) = stage(dir.path());
            let source = tempfile::tempdir().expect("source");
            let evil = source.path().join("evil.app");
            bundle(&evil, "evil, and longer");
            fs::write(&archive, archive_of(&evil, UPDATE)).expect("swap the archive");

            assert_eq!(run(&install.command()), Some(70));

            assert_refused(dir.path(), &installed);
            let message = "0:1: execution error: The command exited with a non-zero status. (70)";
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

        /// Root reads the owner off the entry it pinned, not from the user
        /// context. Run unprivileged, the `chown` can only hand the update to
        /// its own owner, which proves the step runs, not the ownership change.
        #[test]
        fn the_update_is_handed_to_the_installed_apps_owner() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let (uid, gid) = owner(&installed);
            assert!(!install.command().contains(" owner="), "no owner from the user context");
            let script = super::super::PRIVILEGED_INSTALL;
            assert!(
                script.contains(r#"found=$(/usr/bin/stat -f '%d:%i %u:%g' -- "$name""#)
                    && script.contains("owner=${found#* }"),
                "the owner comes from the stat that checks the pin"
            );
            assert!(script.contains(r#"/usr/sbin/chown -hR "$owner""#));

            assert_eq!(run(&install.command()), Some(0));

            assert_eq!(owner(&installed), (uid, gid));
            assert_installed(dir.path(), &installed);
        }

        /// JavaScript that does what [`replace_installed`] does, once, from
        /// root's directory.
        const REPLACE_INSTALLED: &str = r#"  var fm = $.NSFileManager.defaultManager;
  if (!fm.fileExistsAtPath("../moved-away.app")) {
    fm.moveItemAtPathToPathError("../" + installed, "../moved-away.app", null);
    fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError("../" + installed, false, $(), null);
    $("foreign").writeToFileAtomicallyEncodingError("../" + installed + "/version", true, 4, null);
  }"#;

        /// A rename script that runs `before` ahead of each rename, with
        /// `installed` naming the app, and then renames as [`RENAME_JXA`]
        /// does, the exchange too unless `exchange` is false.
        fn renames_after(before: &str, exchange: bool) -> String {
            let real = RENAME_JXA.replacen("function run(argv)", "function real(argv)", 1);
            format!(
                r#"{real}
function run(argv) {{
  var installed = {INSTALLED:?};
{before}
  if (argv[0] === "swap" && !{exchange}) return;
  real(argv);
}}"#
            )
        }

        /// The other bundle is there, the app is where it was moved, and
        /// root installed nothing and left nothing behind.
        fn assert_left_as_replaced(dir: &Path, installed: &Path) {
            assert_eq!(version(installed), "foreign", "nothing replaced the other bundle");
            assert_eq!(version(&dir.join("moved-away.app")), "old");
            assert_eq!(entries(dir), [INSTALLED, "moved-away.app", "payload"]);
        }

        /// The review's case: the installed name now holds another bundle,
        /// which the user could rename there but not delete. Root refuses
        /// it rather than replacing and deleting it.
        #[test]
        fn an_installed_app_replaced_before_root_runs_is_left_alone() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            replace_installed(dir.path(), &installed);
            let (dev, ino) = install.app;
            assert!(install.command().contains(&format!(" app={dev}:{ino} ")));

            assert_eq!(run(&install.command()), Some(69));

            assert_left_as_replaced(dir.path(), &installed);
            let message = "0:1: execution error: The command exited with a non-zero status. (69)";
            assert!(matches!(
                install.failure(message),
                UpdateError::AppReplaced { kept, .. } if kept.is_empty()
            ));
        }

        /// The same swap between root's check and its exchange: what the
        /// exchange brought in is not the app, so root exchanges it back.
        #[test]
        fn an_installed_app_replaced_before_the_exchange_is_exchanged_back() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let script = renames_after(REPLACE_INSTALLED, true);

            assert_eq!(run(&install.command_with(&script, COPY_SECONDS)), Some(69));

            assert_left_as_replaced(dir.path(), &installed);
        }

        /// The same swap before the first of the moves, where the file system
        /// cannot exchange: root moves the other bundle back.
        #[test]
        fn an_installed_app_replaced_before_the_moves_is_moved_back() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let script = renames_after(REPLACE_INSTALLED, false);

            assert_eq!(run(&install.command_with(&script, COPY_SECONDS)), Some(69));

            assert_left_as_replaced(dir.path(), &installed);
        }

        /// The review's case before the prompt: while the user context reads
        /// the app's identity and unpacks the update, which takes seconds,
        /// another process swaps a different bundle in. The pin was taken
        /// before, so the privileged install is refused before it starts.
        #[test]
        fn an_installed_app_replaced_after_the_pin_is_refused_before_root_runs() {
            let dir = tempfile::tempdir().expect("tempdir");
            let source = tempfile::tempdir().expect("source");
            let update = source.path().join("update.app");
            bundle(&update, "new");
            let (installed, archive, bytes) = stage_files(dir.path(), &update, UPDATE);
            let pinned = entry_id(&installed).expect("pin");
            replace_installed(dir.path(), &installed);

            let refused = privileged_install(
                dir.path(),
                (&installed, &archive, &bytes),
                pinned,
                UPDATE,
                &Identity::AdHoc,
            );

            match refused {
                Err(UpdateError::AppReplaced { kept, .. }) => {
                    assert!(kept.is_empty(), "{kept:?}");
                }
                other => panic!("not refused: {other:?}"),
            }
            assert_left_as_replaced(dir.path(), &installed);
        }

        /// After the exchange brought another bundle in, another process
        /// moves the update off the app's name and puts the app back, so
        /// root's exchange back brings the app itself into its directory.
        /// Root keeps it there and says where (68) rather than deleting it.
        #[test]
        fn an_app_brought_back_by_the_exchange_back_is_kept() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let before = format!(
                r#"{REPLACE_INSTALLED}
  else if (argv[0] === "swap" && !fm.fileExistsAtPath("../stolen.app")) {{
    fm.moveItemAtPathToPathError("../" + installed, "../stolen.app", null);
    fm.moveItemAtPathToPathError("../moved-away.app", "../" + installed, null);
  }}"#
            );
            let command = install.command_with(&renames_after(&before, true), COPY_SECONDS);

            let output = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(format!("do shell script {}", applescript_string(&command)))
                .output()
                .expect("osascript");

            let error = install.failure(String::from_utf8_lossy(&output.stderr).trim());
            let UpdateError::PreviousAppNotRestored { kept, .. } = error else {
                panic!("{error}");
            };
            assert_eq!(version(&kept), "old", "the app is kept");
            assert_eq!(version(&installed), "foreign");
            assert_eq!(version(&dir.path().join("stolen.app")), "new");
        }

        /// The exchange brought another bundle in and the exchange back did
        /// not happen: the update is at the app's path, which is an install,
        /// not a refusal (72). Root keeps the bundle it cannot identify in
        /// its directory and names it instead of deleting it, and the install
        /// reports it kept aside, as the user context's swap does
        /// (astro-plan-5n8pn).
        #[test]
        fn an_unidentified_entry_root_could_not_put_back_is_kept_and_named() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let before = format!(
                r#"  if (argv[0] === "swap" && $.NSFileManager.defaultManager.fileExistsAtPath("../moved-away.app")) return;
{REPLACE_INSTALLED}"#
            );
            let command = install.command_with(&renames_after(&before, true), COPY_SECONDS);

            let output = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(format!("do shell script {}", applescript_string(&command)))
                .output()
                .expect("osascript");

            let message = String::from_utf8_lossy(&output.stderr);
            assert!(message.trim_end().ends_with("(72)"), "{message}");
            let kept_aside = install.outcome(message.trim()).expect("the update is installed");
            let [kept] = kept_aside.as_slice() else { panic!("{kept_aside:?}") };
            assert!(kept.starts_with(&install.parent), "in root's directory: {kept:?}");
            assert_eq!(version(kept), "foreign", "the other bundle is kept, not deleted");
            assert_eq!(version(&dir.path().join("moved-away.app")), "old");
            assert_eq!(version(&installed), "new");
        }

        /// A `stat` that fails in root's directory right after the exchange
        /// leaves unknown whether it happened. Root renames nothing more and
        /// says so (71), rather than letting an exchange back do the install
        /// and report that nothing was installed. A directory this user may
        /// not search stands in for the failure, which as root takes a file
        /// system fault.
        #[test]
        fn a_failed_stat_after_the_exchange_renames_nothing_more() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let before = r#"  ObjC.import("stdlib");
  if (argv[0] === "swap") {
    if (!$.NSFileManager.defaultManager.fileExistsAtPath("../stat-fault")) {
      $.system("/usr/bin/touch ../stat-fault; /bin/chmod 000 unpacked");
      return;
    }
    $.system("/bin/chmod 755 unpacked");
  }"#;
            let command = install.command_with(&renames_after(before, true), COPY_SECONDS);

            let status = run(&command);
            let unlocked = Command::new("/bin/chmod")
                .args(["-R", "u+rwx"])
                .arg(dir.path())
                .status()
                .expect("chmod");

            assert!(unlocked.success());
            assert_eq!(status, Some(71));
            assert_eq!(version(&installed), "old", "nothing was installed");
            let message = "0:1: execution error: The command exited with a non-zero status. (71)";
            assert!(matches!(
                install.failure(message),
                UpdateError::Install(detail) if detail.contains("could not be told")
            ));
        }

        /// The previous app can be neither put back nor moved next to the
        /// installed app (68), and its `stat` then fails on the way out, as
        /// after a file system fault: root keeps it, the only copy, rather
        /// than deleting what it cannot identify. The fault is put into
        /// `ident` itself, since this user can make no `stat` fail that
        /// `[ -e ]` passes.
        #[test]
        fn a_kept_app_root_cannot_identify_on_the_way_out_is_kept() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            // No exchange, and of the moves only the app's out of its place.
            let before = r#"  ObjC.import("stdlib");
  if (argv[0] === "excl" && argv[1] !== "../" + installed) {
    if (argv[2] !== "../" + installed) $.system("/usr/bin/touch ../stat-fault");
    return;
  }"#;
            let ident = "ident() { /usr/bin/stat";
            let command = install.command_with(&renames_after(before, false), COPY_SECONDS);
            assert!(command.contains(ident));
            let command = command.replacen(
                ident,
                r#"ident() { [ "$1" != previous.app ] || [ ! -e ../stat-fault ] || return 1; /usr/bin/stat"#,
                1,
            );

            let output = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(format!("do shell script {}", applescript_string(&command)))
                .output()
                .expect("osascript");

            let message = String::from_utf8_lossy(&output.stderr);
            assert!(message.trim_end().ends_with("(68)"), "{message}");
            let error = install.failure(message.trim());
            let UpdateError::PreviousAppNotRestored { kept, .. } = error else {
                panic!("{error}");
            };
            assert_eq!(version(&kept), "old", "the app is kept");
            assert!(!installed.exists());
            assert_eq!(entries(kept.parent().expect("root's directory")), ["previous.app"]);
        }

        /// A signal between the moves, such as a shutdown, while the previous
        /// app is the only copy, in root's directory: root keeps it there and
        /// names it (68) instead of deleting it on the way out.
        #[test]
        fn a_signal_between_the_moves_keeps_the_previous_app() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            // At the move of the update into place, once the previous app is
            // out: end root's shell, as a shutdown would.
            let terminate = r#"  ObjC.import("stdlib");
  if (argv[0] === "excl" && argv[1].indexOf("unpacked/") === 0) { $.system("/bin/kill -TERM $(/bin/ps -o ppid= -p $PPID)"); return; }"#;
            let command = install.command_with(&renames_after(terminate, false), COPY_SECONDS);

            let output = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(format!("do shell script {}", applescript_string(&command)))
                .output()
                .expect("osascript");

            let error = install.failure(String::from_utf8_lossy(&output.stderr).trim());
            let UpdateError::PreviousAppNotRestored { kept, .. } = error else {
                panic!("{error}");
            };
            assert_eq!(version(&kept), "old");
            assert!(!installed.exists());
            assert_eq!(entries(kept.parent().expect("root's directory")), ["previous.app"]);
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

        /// The first set-aside name beside the app is taken: root keeps the
        /// previous app under the next free one, as the user context's move
        /// does, and names it (67).
        #[test]
        fn a_previous_app_root_cannot_put_back_takes_the_next_free_name() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            fs::write(dir.path().join(KEPT), "taken").expect("the first name is taken");
            let script = moves_only(&[&format!("../{INSTALLED}")], &[]);
            let command = install.command_with(&script, COPY_SECONDS);

            let output = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(format!("do shell script {}", applescript_string(&command)))
                .output()
                .expect("osascript");

            let message = String::from_utf8_lossy(&output.stderr);
            assert!(message.trim_end().ends_with("(67)"), "{message}");
            let UpdateError::PreviousAppNotRestored { kept, .. } = install.failure(message.trim())
            else {
                panic!("{message}");
            };
            assert_eq!(kept, install.parent.join("Bob's \"App\" (set aside 2).app"));
            assert_eq!(version(&kept), "old");
            assert_eq!(fs::read_to_string(dir.path().join(KEPT)).expect("taken"), "taken");
            assert!(entries(&installed).is_empty(), "nothing went into the planted directory");
        }

        /// With a name planted beside the app too, the previous app stays in
        /// root's directory, which `osascript` reports by path (68). Root's
        /// own copy and unused update are gone from it.
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
            assert_eq!(entries(kept.parent().expect("root's directory")), ["previous.app"]);
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
        /// archive that grew is refused on its size (70), not its digest.
        #[test]
        fn an_archive_larger_than_the_verified_one_is_refused() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, archive, install) = stage(dir.path());
            let mut grown = fs::read(&archive).expect("archive");
            grown.extend_from_slice(&[0; 4096]);
            fs::write(&archive, grown).expect("grow the archive");
            assert!(install.command().contains(r#"/usr/bin/head -c "$((size + 1))""#));

            assert_eq!(run(&install.command()), Some(70));

            assert_refused(dir.path(), &installed);
        }

        /// A FIFO in the archive's place blocks root's open of it until the
        /// copy's time limit ends the copy.
        #[test]
        fn an_archive_swapped_for_a_fifo_ends_at_the_copys_time_limit() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, archive, install) = stage(dir.path());
            fs::remove_file(&archive).expect("remove the archive");
            let made = Command::new("/usr/bin/mkfifo").arg(&archive).status().expect("mkfifo");
            assert!(made.success());
            let started = std::time::Instant::now();

            assert_eq!(run(&install.command_with(RENAME_JXA, 2)), Some(1));

            let waited = started.elapsed();
            assert!(waited >= std::time::Duration::from_secs(2), "{waited:?}: the timer ended it");
            assert!(waited < std::time::Duration::from_secs(10), "{waited:?}");
            assert_refused(dir.path(), &installed);
        }

        /// Root copies only from what it opened when that is a regular file,
        /// so a device in the archive's place, as a link swapped in after the
        /// link check would open, is refused.
        #[test]
        fn an_archive_that_opens_as_a_device_is_refused() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, mut install) = stage(dir.path());
            install.archive_dir = PathBuf::from("/dev");
            install.archive = "zero".into();

            assert_eq!(run(&install.command()), Some(1));

            assert_refused(dir.path(), &installed);
        }

        #[test]
        fn each_failure_status_maps_to_its_error() {
            let dir = tempfile::tempdir().expect("tempdir");
            let (installed, _, install) = stage(dir.path());
            let failure =
                |status: &str| install.failure(&format!("0:1: execution error: boom ({status})"));

            let kinds: Vec<&str> = ["-128", "65", "70", "66", "69", "71", "1"]
                .into_iter()
                .map(|status| match failure(status) {
                    UpdateError::Permission(_) => "permission",
                    UpdateError::Signature(_) => "signature",
                    UpdateError::Identity(_) => "identity",
                    UpdateError::AppReplaced { .. } => "app-replaced",
                    UpdateError::Install(_) => "install",
                    _ => "other",
                })
                .collect();
            assert_eq!(
                kinds,
                [
                    "permission",
                    "signature",
                    "signature",
                    "identity",
                    "app-replaced",
                    "install",
                    "install"
                ]
            );
            assert!(matches!(
                failure("67"),
                UpdateError::PreviousAppNotRestored { kept, .. }
                    if kept == install.parent.join(KEPT)
            ));
            let work = install.parent.join(".platevault-update.abc/previous.app");
            let kept_in_work =
                install.failure(&format!("0:65: execution error: kept:{} (68)", work.display()));
            assert!(matches!(
                kept_in_work,
                UpdateError::PreviousAppNotRestored { kept, .. } if kept == work
            ));
            let unidentified = install.parent.join(".platevault-update.abc/unpacked/App.app");
            let installed_kept = install
                .outcome(&format!("0:65: execution error: kept:{} (72)", unidentified.display()));
            assert_eq!(installed_kept.ok(), Some(vec![unidentified]), "installed, kept aside");
            let unnamed = install.outcome("0:1: execution error: boom (72)");
            assert_eq!(
                unnamed.ok(),
                Some(vec![install.parent.clone()]),
                "root's directory is there"
            );
            assert!(install.outcome("0:1: execution error: boom (69)").is_err(), "not installed");
            assert_eq!(version(&installed), "old", "mapping runs nothing");
        }
    }

    /// The staging dir of a two-moves swap that failed after its first move:
    /// the app at the installed path, `old`, launched as it was and then
    /// moved to `backup`, and the update, `new`, unpacked next to it.
    struct FirstMoveDone {
        staging: tempfile::TempDir,
        launched: LaunchedBundle,
        update: PathBuf,
        backup: PathBuf,
    }

    impl FirstMoveDone {
        fn at(dir: &Path, installed: &Path) -> Self {
            bundle(installed, "old");
            let launched = launched(installed);
            let staging = tempfile::tempdir_in(dir).expect("staging");
            let update = staging.path().join("App.app");
            bundle(&update, "new");
            let backup = staging.path().join("previous.app");
            fs::rename(installed, &backup).expect("the first move");
            Self { staging, launched, update, backup }
        }

        /// What the failed install makes of it.
        fn settle(self, fallback_dir: Option<&Path>) -> Option<PathBuf> {
            let update_id = entry_id(&self.update).expect("update");
            keep_backup_if_not_restored(
                &self.launched,
                self.staging,
                [&self.update, &self.backup],
                update_id,
                aside(fallback_dir),
            )
        }

        /// The second move, [`move_update_in`], onto the app's path at
        /// `installed`.
        fn move_update_in(&self, installed: &Path) -> Result<(), SwapError> {
            move_update_in(installed, &self.update, &self.backup)
        }

        /// What the install that failed with `error` reports.
        fn fail(self, error: UpdateError) -> UpdateError {
            let update_id = entry_id(&self.update).expect("update");
            failed_swap(
                &self.launched,
                self.staging,
                [&self.update, &self.backup],
                update_id,
                error,
                aside(None),
            )
        }
    }

    #[test]
    fn a_previous_app_that_was_not_put_back_moves_next_to_the_installed_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        let moves = FirstMoveDone::at(dir.path(), &installed);
        let staging_path = moves.staging.path().to_path_buf();

        let kept = moves.settle(None);

        let expected = dir.path().join(KEPT_APP);
        assert_eq!(kept.as_deref(), Some(expected.as_path()));
        assert_eq!(version(&expected), "old");
        assert!(!staging_path.exists(), "the staging dir, with the update, is removed");
    }

    #[test]
    fn a_previous_app_that_cannot_go_next_to_the_installed_path_goes_to_the_fallback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let applications = dir.path().join("Applications");
        fs::create_dir(&applications).expect("Applications");
        let installed = applications.join("App.app");
        let moves = FirstMoveDone::at(dir.path(), &installed);
        fs::remove_dir(&applications).expect("no folder to keep it next to");
        let fallback = tempfile::tempdir_in(dir.path()).expect("fallback");

        let kept = moves.settle(Some(fallback.path()));

        let expected = fallback.path().join(KEPT_APP);
        assert_eq!(kept.as_deref(), Some(expected.as_path()));
        assert_eq!(version(&expected), "old");
    }

    #[test]
    fn a_previous_app_that_cannot_move_stays_in_the_kept_staging_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let applications = dir.path().join("Applications");
        fs::create_dir(&applications).expect("Applications");
        let installed = applications.join("App.app");
        let moves = FirstMoveDone::at(dir.path(), &installed);
        fs::remove_dir(&applications).expect("no folder to keep it next to");
        let backup = moves.backup.clone();

        let kept = moves.settle(Some(&dir.path().join("missing")));

        assert_eq!(kept.as_deref(), Some(backup.as_path()));
        assert_eq!(version(&backup), "old", "the staging dir was not deleted");
        fs::remove_dir_all(backup.parent().expect("staging")).expect("clean up the kept dir");
    }

    #[test]
    fn a_previous_app_back_in_place_needs_no_backup() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        let moves = FirstMoveDone::at(dir.path(), &installed);
        fs::rename(&moves.backup, &installed).expect("the restore");
        let staging_path = moves.staging.path().to_path_buf();

        assert!(moves.settle(None).is_none());
        assert_eq!(version(&installed), "old");
        assert!(!dir.path().join(KEPT_APP).exists(), "nothing is kept");
        assert!(!staging_path.exists());
    }

    /// With the app back in place, an entry another process put in staging
    /// is still kept aside, not deleted with staging.
    #[test]
    fn an_unknown_entry_in_staging_is_kept_with_the_app_back_in_place() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        let moves = FirstMoveDone::at(dir.path(), &installed);
        fs::rename(&moves.backup, &installed).expect("the restore");
        bundle(&moves.backup, "stray");

        assert!(moves.settle(None).is_none(), "the app is back");
        assert_eq!(version(&installed), "old");
        assert_eq!(version(&dir.path().join(KEPT_APP)), "stray");
    }

    /// The two-moves fallback, after something landed at the app's path
    /// between its renames: the second rename and the restore both failed,
    /// so the launched app is still in `backup`, and the app's path holds
    /// the other entry. The launched app is kept aside, not deleted with
    /// staging.
    #[test]
    fn a_previous_app_not_put_back_behind_another_entry_is_kept() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        let moves = FirstMoveDone::at(dir.path(), &installed);
        bundle(&installed, "foreign");

        let kept = moves.settle(None);

        let expected = dir.path().join(KEPT_APP);
        assert_eq!(kept.as_deref(), Some(expected.as_path()), "the launched app is not kept");
        assert_eq!(version(&expected), "old");
        assert_eq!(version(&installed), "foreign", "the other entry is left alone");
    }

    /// The two-moves fallback, after another process put an empty directory
    /// at the app's path between its renames, as it can once the launched
    /// app has moved out: the update does not move onto it. The planted
    /// directory is left as it was, the launched app is kept, not deleted
    /// with staging, and the install fails, asking for a restart.
    #[test]
    fn an_entry_planted_before_the_update_moves_in_is_left_alone_and_the_app_kept() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        let moves = FirstMoveDone::at(dir.path(), &installed);
        fs::create_dir(&installed).expect("an empty directory planted at the app's path");
        let planted = entry_id(&installed).expect("planted");

        let second_move = moves.move_update_in(&installed);

        assert_eq!(entry_id(&installed).ok(), Some(planted), "the planted directory is untouched");
        assert_eq!(fs::read_dir(&installed).expect("planted").count(), 0, "and still empty");
        assert!(matches!(second_move, Err(SwapError::Occupied)), "{second_move:?}");
        let outcome = moves.fail(app_replaced(&installed, Vec::new()));
        let kept = dir.path().join(KEPT_APP);
        assert!(
            matches!(
                &outcome,
                UpdateError::PreviousAppNotRestored { kept: at, cause }
                    if *at == kept && matches!(**cause, UpdateError::AppReplaced { .. })
            ),
            "{outcome}"
        );
        assert_eq!(version(&kept), "old", "the launched app is kept");
        assert_eq!(entry_id(&installed).ok(), Some(planted), "still untouched");
    }

    /// A name a kept app would take is taken: the next numbered name is
    /// used, next to the app, rather than the fallback or the temp folder.
    #[test]
    fn a_kept_app_whose_name_is_taken_gets_a_numbered_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("App.app");
        fs::write(dir.path().join(KEPT_APP), "other").expect("taken");
        fs::create_dir(dir.path().join("App (set aside 2).app")).expect("taken, empty");
        let staging = tempfile::tempdir_in(dir.path()).expect("staging");
        let entry = staging.path().join("previous.app");
        bundle(&entry, "old");

        let kept = move_aside(&installed, &entry, aside(None));

        let expected = dir.path().join("App (set aside 3).app");
        assert_eq!(kept.as_deref(), Some(expected.as_path()));
        assert_eq!(version(&expected), "old");
        let empty = dir.path().join("App (set aside 2).app");
        assert_eq!(fs::read_dir(empty).expect("empty").count(), 0, "not moved onto");
    }
}
