// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Verified transfer (STO-FR-07, STO-FR-12, STO-IMP-FR-04).
//!
//! A transfer copies the reviewed source snapshot into a partial file created
//! with create-new semantics beside its destination and recorded by identity
//! before any byte is written. The copy is hashed as it is written and must
//! match the reviewed SHA-256; it is synced, installed at the destination with
//! a no-replace link or rename, and the folder is synced. Verification re-reads
//! the installed copy through a handle proven to be the recorded file. An
//! existing entry at the destination is never replaced; the only file this
//! module ever removes is a partial copy it wrote itself, while that name still
//! holds the recorded identity.

use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Component, Path, PathBuf};

use uuid::Uuid;

use super::{read_unchanged, same_identity, Check, Expect};
use crate::{
    inventory, EntryEvidence, FileIdentity, ItemReason, NativePath, ReasonCode,
    TransferDestination, WrittenCopy,
};

fn reason(code: ReasonCode, detail: impl Into<String>) -> ItemReason {
    ItemReason::new(code, detail)
}

fn occupied(path: &Path) -> ItemReason {
    reason(
        ReasonCode::DestinationOccupied,
        format!("{} already holds an entry; nothing is replaced", path.display()),
    )
}

fn changed(detail: impl Into<String>) -> ItemReason {
    reason(ReasonCode::DestinationChanged, detail)
}

fn write_failed(path: &Path, error: &impl std::fmt::Display) -> ItemReason {
    reason(ReasonCode::WriteFailed, format!("{}: {error}", path.display()))
}

/// The destination folder below its root and the destination file path.
fn layout(destination: &TransferDestination) -> Result<(PathBuf, PathBuf, PathBuf), ItemReason> {
    let invalid = |error: crate::LibraryError| changed(error.to_string());
    let root = destination.root.to_path_buf().map_err(invalid)?;
    let relative = destination.relative.relative_path().map_err(invalid)?;
    let folder = relative.parent().unwrap_or_else(|| Path::new("")).to_path_buf();
    let file = root.join(&relative);
    Ok((root, folder, file))
}

/// Prove `root` is a real folder and create the missing folders of `relative`
/// below it, one level at a time, never following a link.
fn ensure_folder(root: &Path, relative: &Path) -> Result<PathBuf, ItemReason> {
    let root_metadata = real_folder(root)?;
    let mut current = root.to_path_buf();
    for part in relative.components() {
        let Component::Normal(name) = part else {
            return Err(changed("a destination is a plain relative path"));
        };
        let parent = current.clone();
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match fs::create_dir(&current) {
                    Ok(()) => {
                        sync_folder(&parent).map_err(|error| write_failed(&parent, &error))?;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(write_failed(&current, &error)),
                }
            }
            Err(error) => return Err(write_failed(&current, &error)),
        }
        let metadata = real_folder(&current)?;
        if !same_device(&root_metadata, &metadata) {
            return Err(changed(format!(
                "{} lies on another volume than the destination root",
                current.display()
            )));
        }
    }
    Ok(current)
}

fn real_folder(path: &Path) -> Result<fs::Metadata, ItemReason> {
    let metadata = fs::symlink_metadata(path).map_err(|error| write_failed(path, &error))?;
    if super::is_link(&metadata) || !metadata.is_dir() {
        return Err(changed(format!(
            "{} is not a real folder; links are not followed",
            path.display()
        )));
    }
    Ok(metadata)
}

#[cfg(unix)]
fn same_device(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev()
}

#[cfg(not(unix))]
const fn same_device(_left: &fs::Metadata, _right: &fs::Metadata) -> bool {
    true
}

fn vacant(path: &Path) -> Result<(), ItemReason> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(occupied(path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(write_failed(path, &error)),
    }
}

/// Whether `path` holds the regular file recorded as `identity`.
fn holds(path: &Path, identity: &FileIdentity) -> bool {
    inventory::probe_fingerprint(path)
        .is_ok_and(|observed| same_identity(&observed.identity, identity))
}

/// Remove a file this operation wrote (a partial copy, a clone), only while
/// its name still holds it.
pub(crate) fn discard(partial: &Path, identity: &FileIdentity) {
    if holds(partial, identity) {
        let _ = fs::remove_file(partial);
    }
}

/// Pending → Writing: create the destination's missing folders, refuse an
/// occupied destination, and create the partial copy whose identity the item
/// records before any byte is written.
pub(crate) fn begin(
    operation: Uuid,
    seq: u32,
    destination: &TransferDestination,
) -> Result<WrittenCopy, ItemReason> {
    let (root, relative_folder, file) = layout(destination)?;
    let folder = ensure_folder(&root, &relative_folder)?;
    vacant(&file)?;
    let mut builder = tempfile::Builder::new();
    let prefix = format!(".pv-{}-{seq}-", operation.simple());
    builder.prefix(&prefix).suffix(".partial").rand_bytes(6).disable_cleanup(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(fs::Permissions::from_mode(0o666));
    }
    let partial = builder.tempfile_in(&folder).map_err(|error| write_failed(&folder, &error))?;
    let path = partial.path().to_path_buf();
    drop(partial);
    let identity =
        inventory::probe_fingerprint(&path).map_err(|error| write_failed(&path, &error))?.identity;
    Ok(WrittenCopy { partial: NativePath::from_path(&path), identity })
}

/// Writing → Installed: stream the reviewed source into the recorded partial
/// copy, prove the bytes are the snapshot, sync, and install without replacing
/// anything. A resumed item whose copy was already installed is recognized by
/// its recorded identity, never by the destination name.
pub(crate) fn write(
    source: &EntryEvidence,
    destination: &TransferDestination,
    written: &WrittenCopy,
) -> Result<(), ItemReason> {
    let partial = written.partial.to_path_buf().map_err(|error| changed(error.to_string()))?;
    let (_, _, file) = layout(destination)?;
    if holds(&file, &written.identity) {
        // Installed before an interruption; a link-and-unlink install may
        // also have left the partial name as a second link.
        discard(&partial, &written.identity);
        return Ok(());
    }
    if !holds(&partial, &written.identity) {
        return Err(changed(format!(
            "the partial copy {} this item recorded is gone and no copy of it is installed",
            partial.display()
        )));
    }
    if let Err(reason) = fill(source, &partial, &written.identity) {
        discard(&partial, &written.identity);
        return Err(reason);
    }
    let mut installing = match tempfile::TempPath::try_from_path(&partial) {
        Ok(installing) => installing,
        Err(error) => {
            discard(&partial, &written.identity);
            return Err(write_failed(&partial, &error));
        }
    };
    installing.disable_cleanup(true);
    if let Err(failure) = installing.persist_noclobber(&file) {
        discard(&partial, &written.identity);
        return Err(if failure.error.kind() == std::io::ErrorKind::AlreadyExists {
            occupied(&file)
        } else {
            write_failed(&file, &failure.error)
        });
    }
    // A link-and-unlink install may leave the partial name as a second link.
    discard(&partial, &written.identity);
    let folder = file.parent().unwrap_or_else(|| Path::new(""));
    sync_folder(folder).map_err(|error| write_failed(folder, &error))
}

/// Copy the source into the partial file through handles proven to be the
/// reviewed source and the recorded partial, then set the source's
/// modification time and sync.
fn fill(source: &EntryEvidence, partial: &Path, identity: &FileIdentity) -> Result<(), ItemReason> {
    let source_path = super::path_of(&source.path)?;
    let inspected = fs::symlink_metadata(partial).map_err(|error| write_failed(partial, &error))?;
    let mut out = OpenOptions::new()
        .write(true)
        .open(partial)
        .map_err(|error| write_failed(partial, &error))?;
    if !super::handle_is(&out, &inspected, identity) {
        return Err(changed(format!("{} was replaced while it was opened", partial.display())));
    }
    out.set_len(0).map_err(|error| write_failed(partial, &error))?;
    let digest = read_unchanged(&source_path, &Expect::recorded(&source.fingerprint), |bytes| {
        out.write_all(bytes)
    })
    .map_err(|check| match check {
        Check::Unavailable(detail) => reason(ReasonCode::SourceUnavailable, detail),
        Check::Changed(detail) => reason(ReasonCode::SourceDrift, detail),
    })?;
    if Some(digest.as_str()) != source.sha256.as_deref() {
        return Err(reason(
            ReasonCode::SourceDrift,
            format!(
                "{} no longer holds its reviewed bytes (SHA-256 differs)",
                source_path.display()
            ),
        ));
    }
    let modified = modified_time(source.fingerprint.modified_ns);
    if let Some(modified) = modified {
        out.set_modified(modified).map_err(|error| write_failed(partial, &error))?;
    }
    out.sync_all().map_err(|error| write_failed(partial, &error))
}

fn modified_time(nanos: i128) -> Option<std::time::SystemTime> {
    let magnitude = std::time::Duration::from_nanos(u64::try_from(nanos.unsigned_abs()).ok()?);
    if nanos >= 0 {
        std::time::UNIX_EPOCH.checked_add(magnitude)
    } else {
        std::time::UNIX_EPOCH.checked_sub(magnitude)
    }
}

/// `Installed` → `DestinationVerified`: re-read the destination through a handle
/// proven to be the recorded copy and compare its SHA-256 with the snapshot.
/// Its modification time is not compared: a volume may not keep it exactly.
pub(crate) fn verify(
    source: &EntryEvidence,
    destination: &TransferDestination,
    written: &WrittenCopy,
) -> Result<(), ItemReason> {
    let (_, _, file) = layout(destination)?;
    if !holds(&file, &written.identity) {
        return Err(changed(format!(
            "{} no longer holds the copy this operation wrote",
            file.display()
        )));
    }
    let expect = Expect {
        identity: &written.identity,
        size_bytes: source.fingerprint.size_bytes,
        modified_ns: None,
    };
    match read_unchanged(&file, &expect, |_| Ok(())) {
        Ok(digest) if Some(digest.as_str()) == source.sha256.as_deref() => Ok(()),
        Ok(_) => Err(reason(
            ReasonCode::DestinationMismatch,
            format!("the re-read of {} differs from the source snapshot", file.display()),
        )),
        Err(Check::Changed(detail)) => Err(changed(detail)),
        Err(Check::Unavailable(detail)) => Err(reason(ReasonCode::DestinationMismatch, detail)),
    }
}

#[cfg(unix)]
pub(crate) fn sync_folder(folder: &Path) -> std::io::Result<()> {
    fs::File::open(folder)?.sync_all()
}

/// Windows offers no folder sync through a safe handle; NTFS journals the
/// install's directory entry, and the re-read proves the installed bytes.
#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
pub(crate) const fn sync_folder(_folder: &Path) -> std::io::Result<()> {
    Ok(())
}
