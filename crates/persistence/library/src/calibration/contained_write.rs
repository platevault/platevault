// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The catalog's one file write (D05, R15): a create-new temporary file in a
//! verified destination folder, a streaming copy hashed as it is written and
//! synced, a no-replace install followed by a folder sync, and a re-read of the
//! installed copy. A temporary file is removed only while its name still holds
//! the file this process created or the identity an earlier attempt recorded;
//! nothing at the destination is ever replaced, moved or removed.

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use platevault_model::{
    CreatedFile, FileIdentity, LibraryError, NativePath, ObservationFingerprint,
};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use crate::{
    device_of, fingerprint_matches, hash_contained, lstat, open_contained, real_directory,
    root_stamp_matches, scoped, stamp_of, stat_matches, OpenedChain, Result, SourceProbe,
    SourceRoot, Stamp, HASH_BUFFER,
};

/// The message of [`require_supported`]'s refusal.
pub const UNSUPPORTED: &str =
    "master adoption needs a folder sync after a no-replace install, which this platform build \
     does not provide";

/// Refuse adoption where the install cannot be made durable without replacing.
///
/// # Errors
/// `SourceUnavailable` on a platform without a folder sync after install.
pub fn require_supported() -> Result<()> {
    if cfg!(unix) {
        Ok(())
    } else {
        Err(LibraryError::SourceUnavailable(UNSUPPORTED.into()))
    }
}

/// The parent folder of a destination below its location root: real
/// directories on the root's device, re-verified before every file effect.
pub struct Folder {
    path: PathBuf,
    chain: OpenedChain,
}

impl Folder {
    /// Prove every folder from `root` down to the parent of `relative`.
    ///
    /// # Errors
    /// `InvalidInput` for a path that is not a plain relative file path;
    /// `NotFound` for a missing folder (CAL creates no directories);
    /// `IdentityConflict` for a link, a non-directory, a nested volume or a
    /// root that is not the registered folder.
    pub fn of(root: &SourceRoot, relative: &Path) -> Result<Self> {
        let parts = relative
            .components()
            .map(|part| match part {
                Component::Normal(name) => Ok(name),
                _ => Err(LibraryError::InvalidInput(
                    "relativePath must name a file below the location".into(),
                )),
            })
            .collect::<Result<Vec<_>>>()?;
        let Some((_, folders)) = parts.split_last() else {
            return Err(LibraryError::InvalidInput("relativePath names the location root".into()));
        };
        let mut current = root.path.clone();
        let root_metadata = real_directory(&current)?;
        if !root_stamp_matches(&root.location.identity, &root_metadata) {
            return Err(scoped(
                LibraryError::IdentityConflict("root folder is not the registered folder".into()),
                root.location.path.clone(),
                Some(root.location.id),
            ));
        }
        let device = device_of(&root_metadata);
        let mut chain = OpenedChain { folders: vec![(current.clone(), stamp_of(&root_metadata))] };
        for folder in folders {
            current.push(folder);
            let metadata = real_directory(&current)?;
            if device_of(&metadata) != device {
                return Err(scoped(
                    LibraryError::IdentityConflict(
                        "the destination lies below a nested volume boundary".into(),
                    ),
                    NativePath::from_path(&current),
                    None,
                ));
            }
            chain.folders.push((current.clone(), stamp_of(&metadata)));
        }
        Ok(Self { path: current, chain })
    }

    fn verify_unchanged(&self) -> Result<()> {
        self.chain.verify_unchanged()
    }
}

/// An existing entry at the destination: adoption never replaces anything.
pub fn occupied(path: &Path) -> LibraryError {
    scoped(
        LibraryError::IdentityConflict(
            "an entry already exists at the adoption destination; nothing is replaced".into(),
        ),
        NativePath::from_path(path),
        None,
    )
}

/// Whether any entry, a link included, exists at `path`.
///
/// # Errors
/// Access errors other than absence.
pub fn entry_exists(path: &Path) -> Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(LibraryError::from_io(path, &error)),
    }
}

/// Prove the destination folder and that nothing exists at the destination.
///
/// # Errors
/// [`Folder::of`] errors, or `IdentityConflict` scoped to an existing entry.
pub fn require_vacant(root: &SourceRoot, relative: &Path) -> Result<Folder> {
    let folder = Folder::of(root, relative)?;
    let target = root.path.join(relative);
    if entry_exists(&target)? {
        return Err(occupied(&target));
    }
    Ok(folder)
}

/// A create-new temporary file this process holds open.
pub struct Temporary {
    file: NamedTempFile,
    stamp: Stamp,
    pub created: CreatedFile,
}

/// Create `name` beside the destination with create-new semantics and record
/// the identity of the file the handle refers to.
///
/// # Errors
/// Access errors, or `IdentityConflict` when the folder or the new name
/// changed while it was created; the file is then removed again.
pub fn create_temporary<P: SourceProbe>(
    folder: &Folder,
    relative: &Path,
    name: &str,
    probe: &P,
) -> Result<Temporary> {
    folder.verify_unchanged()?;
    let mut builder = tempfile::Builder::new();
    builder.prefix(name).rand_bytes(0).disable_cleanup(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o666));
    }
    let path = folder.path.join(name);
    let file =
        builder.tempfile_in(&folder.path).map_err(|error| LibraryError::from_io(&path, &error))?;
    let stamp = match file.as_file().metadata() {
        Ok(metadata) => stamp_of(&metadata),
        Err(error) => {
            // Without its handle stamp the file cannot be proven ours; it stays named.
            return Err(LibraryError::from_io(&path, &error));
        }
    };
    let relative_path = relative.parent().unwrap_or_else(|| Path::new("")).join(name);
    let recorded = bound_identity(&path, stamp, probe).and_then(|identity| {
        folder.verify_unchanged()?;
        Ok(identity)
    });
    match recorded {
        Ok(identity) => Ok(Temporary {
            file,
            stamp,
            created: CreatedFile { relative_path: NativePath::from_path(&relative_path), identity },
        }),
        Err(error) => {
            remove_if_stamp(&path, stamp)?;
            Err(error)
        }
    }
}

/// The probe's identity of `path` while its name still refers to `stamp`.
fn bound_identity<P: SourceProbe>(path: &Path, stamp: Stamp, probe: &P) -> Result<FileIdentity> {
    let fingerprint = probe.fingerprint(path)?;
    if stamp_of(&lstat(path)?) != stamp {
        return Err(scoped(
            LibraryError::IdentityConflict("the new file was replaced while it was created".into()),
            NativePath::from_path(path),
            None,
        ));
    }
    Ok(fingerprint.identity)
}

/// Stream the reviewed source into the temporary file, hashing every byte, and
/// sync it. The source must still be its reviewed observation before and after
/// reading and hash to the reviewed SHA-256.
///
/// # Errors
/// Access errors, and `IdentityConflict` naming the source when it changed.
pub fn copy_verified<P: SourceProbe>(
    temporary: &mut Temporary,
    root: &SourceRoot,
    relative: &Path,
    reviewed: &ObservationFingerprint,
    sha256: &str,
    probe: &P,
) -> Result<()> {
    root.verify(probe)?;
    let path = root.path.join(relative);
    let changed =
        |why: &str| scoped(LibraryError::IdentityConflict(why.into()), root.source(relative), None);
    let unchanged = |probe: &P| -> Result<()> {
        if fingerprint_matches(reviewed, &probe.fingerprint(&path)?) {
            Ok(())
        } else {
            Err(changed("the source differs from its reviewed observation"))
        }
    };
    unchanged(probe)?;
    let (mut source, chain) = open_contained(root, relative)?;
    let read_error = |error: std::io::Error| LibraryError::from_io(&path, &error);
    let same_stats = |file: &std::fs::File| -> Result<bool> {
        Ok(stat_matches(
            &file.metadata().map_err(read_error)?,
            reviewed.size_bytes,
            reviewed.modified_ns,
        ))
    };
    if !same_stats(&source)? {
        return Err(changed("the source differs from its reviewed observation"));
    }
    let temporary_path = temporary.file.path().to_path_buf();
    let write_error = |error: std::io::Error| LibraryError::from_io(&temporary_path, &error);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER];
    loop {
        let read = source.read(&mut buffer).map_err(read_error)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        temporary.file.as_file_mut().write_all(&buffer[..read]).map_err(write_error)?;
    }
    if !same_stats(&source)? {
        return Err(changed("the source changed while it was copied"));
    }
    chain.verify_unchanged()?;
    unchanged(probe)?;
    if hex::encode(hasher.finalize()) != sha256 {
        return Err(changed("the source bytes no longer hash to the reviewed SHA-256"));
    }
    temporary.file.as_file().sync_all().map_err(write_error)?;
    root.verify(probe)
}

/// Why an install did not complete.
pub enum InstallFailure {
    /// Nothing was installed; the temporary file is handed back for removal.
    NotInstalled(Box<Temporary>, LibraryError),
    /// The copy is at the destination but could not be proven or synced.
    Installed(LibraryError),
}

/// Install the temporary file at `relative` without replacing anything, sync the
/// folder and record the identity the destination name now holds.
///
/// # Errors
/// [`InstallFailure`]: `IdentityConflict` scoped to an occupied destination.
pub fn install<P: SourceProbe>(
    temporary: Temporary,
    root: &SourceRoot,
    folder: &Folder,
    relative: &Path,
    probe: &P,
) -> std::result::Result<(CreatedFile, ObservationFingerprint), InstallFailure> {
    if let Err(error) = root.verify(probe).and_then(|()| folder.verify_unchanged()) {
        return Err(InstallFailure::NotInstalled(Box::new(temporary), error));
    }
    let target = root.path.join(relative);
    let Temporary { file, stamp, created } = temporary;
    let temporary_path = file.path().to_path_buf();
    let handle = match file.persist_noclobber(&target) {
        Ok(handle) => handle,
        Err(failed) => {
            let error = if failed.error.kind() == std::io::ErrorKind::AlreadyExists {
                occupied(&target)
            } else {
                LibraryError::from_io(&target, &failed.error)
            };
            let temporary = Temporary { file: failed.file, stamp, created };
            return Err(InstallFailure::NotInstalled(Box::new(temporary), error));
        }
    };
    let proven = || -> Result<(CreatedFile, ObservationFingerprint)> {
        // A link-and-unlink install may leave the temporary name as a second link.
        remove_if_stamp(&temporary_path, stamp)?;
        sync_folder(&folder.path)?;
        let fingerprint = probe.fingerprint(&target)?;
        let held = handle.metadata().map_err(|error| LibraryError::from_io(&target, &error))?;
        if stamp_of(&held) != stamp || stamp_of(&lstat(&target)?) != stamp {
            return Err(scoped(
                LibraryError::IdentityConflict(
                    "the destination name does not hold the installed copy".into(),
                ),
                NativePath::from_path(&target),
                None,
            ));
        }
        folder.verify_unchanged()?;
        let identity = fingerprint.identity.clone();
        Ok((CreatedFile { relative_path: NativePath::from_path(relative), identity }, fingerprint))
    };
    proven().map_err(InstallFailure::Installed)
}

/// SHA-256 of the installed copy, re-opened without following links, which must
/// still hold the recorded identity and the stats observed after install.
///
/// # Errors
/// Access errors, and `IdentityConflict` when the destination changed.
pub fn rehash_installed<P: SourceProbe>(
    root: &SourceRoot,
    relative: &Path,
    installed: &CreatedFile,
    observed: &ObservationFingerprint,
    probe: &P,
) -> Result<String> {
    root.verify(probe)?;
    let target = root.path.join(relative);
    if probe.fingerprint(&target)?.identity != installed.identity {
        return Err(scoped(
            LibraryError::IdentityConflict(
                "the destination no longer holds the recorded installed copy".into(),
            ),
            NativePath::from_path(&target),
            None,
        ));
    }
    let sha256 = hash_contained(root, relative, observed.size_bytes, observed.modified_ns)?;
    root.verify(probe)?;
    Ok(sha256)
}

/// Remove the temporary file while its name still refers to the file this
/// process created; anything else at that name is left in place.
///
/// # Errors
/// Access errors while inspecting or removing the name.
pub fn discard(temporary: Temporary) -> Result<()> {
    let path = temporary.file.path().to_path_buf();
    remove_if_stamp(&path, temporary.stamp)?;
    drop(temporary);
    Ok(())
}

/// Remove a temporary file an earlier attempt recorded, only while its name
/// still holds the recorded identity on a volume with stable file ids.
///
/// # Errors
/// Access errors while inspecting or removing the name.
pub fn discard_recorded<P: SourceProbe>(
    root: &SourceRoot,
    recorded: &CreatedFile,
    probe: &P,
) -> Result<bool> {
    let relative = recorded.relative_path.relative_path()?;
    Folder::of(root, &relative)?;
    let path = root.path.join(&relative);
    if !entry_exists(&path)? {
        return Ok(false);
    }
    let provable = recorded.identity.volume.file_ids_stable && recorded.identity.file_id.is_some();
    if !provable || probe.fingerprint(&path)?.identity != recorded.identity {
        return Ok(false);
    }
    let stamp = stamp_of(&lstat(&path)?);
    remove_if_stamp(&path, stamp)
}

fn remove_if_stamp(path: &Path, stamp: Stamp) -> Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.is_file()
                && !fs_pathsafe::is_link_or_junction_metadata(&metadata)
                && stamp_of(&metadata) == stamp =>
        {
            std::fs::remove_file(path).map_err(|error| LibraryError::from_io(path, &error))?;
            Ok(true)
        }
        Ok(_) => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(LibraryError::from_io(path, &error)),
    }
}

#[cfg(unix)]
fn sync_folder(path: &Path) -> Result<()> {
    std::fs::File::open(path)
        .and_then(|folder| folder.sync_all())
        .map_err(|error| LibraryError::from_io(path, &error))
}

#[cfg(not(unix))]
fn sync_folder(path: &Path) -> Result<()> {
    Err(scoped(
        LibraryError::SourceUnavailable(UNSUPPORTED.into()),
        NativePath::from_path(path),
        None,
    ))
}
