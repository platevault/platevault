// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Read-only, progressive inventory of one registered location.
//!
//! The walker never writes, renames or follows links. It reuses the
//! `metadata_fits`/`metadata_xisf` header adapters and the `fs_pathsafe`
//! link/junction classifier.
//!
//! # Scope semantics
//!
//! Relative paths are lossless [`NativePath`]s; the empty path is the location
//! root. A complete scope covers its whole subtree, minus every incomplete
//! scope. Each per-entry failure, unreadable directory, skipped link, nested
//! foreign volume and unverified file is an incomplete scope and an issue, so
//! an unobserved path counts as absent only through [`absence_provable`].
//! Canceled and failed observations carry no complete scope.
//!
//! # Identity
//!
//! A location root must be an absolute folder on a volume with a remount-stable
//! volume ID and folder ID; roots without a qualified folder ID (FAT, `exFAT`,
//! `ReFS`) are refused before any batch. The registered root identity is
//! verified before the walk and again before the final batch. Before every
//! batch the root's same-session continuity stamp is rechecked; a change ends
//! the scan as `Failed`, discarding the undelivered batch.

#[path = "inventory/identity.rs"]
mod identity;

use std::ffi::OsString;
use std::fs::{self, Metadata};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use metadata_core::{MetadataExtractError, MetadataExtractor};
use metadata_fits::FitsExtractor;
use metadata_xisf::XisfExtractor;

use crate::{
    Availability, CaptureMetadata, FileIdentity, ImageFormat, LibraryError, Location, NativePath,
    ObservationFingerprint, ScanBatch, ScanFile, ScanIssue, ScanObservation, ScanOptions,
    ScanProgress, ScanState, VolumeIdentity,
};

use identity::Stamp;

/// Observe the remount-stable identity of a folder for registration.
///
/// # Errors
/// `SourceUnavailable`/`AccessDenied` when the root cannot be inspected,
/// `InvalidInput` for a relative path, `..`, a link or a junction root, and
/// `IdentityConflict` when the volume or the root folder ID cannot be
/// qualified on this host and filesystem.
pub fn observe_root_identity(root: &Path) -> Result<FileIdentity, LibraryError> {
    identity::observe(root).map(|observation| observation.identity)
}

/// Re-observe a registered root and refuse it unless it is the registered
/// volume and folder. Intended inside final reconciliation transactions.
///
/// # Errors
/// As [`observe_root_identity`], plus `IdentityConflict` on any mismatch.
pub fn validate_location_root(location: &Location) -> Result<FileIdentity, LibraryError> {
    let root = location.path.to_path_buf().map_err(|error| locate(error, location))?;
    let observed = identity::observe(&root).map_err(|error| locate(error, location))?;
    identity::compare(&location.identity, &observed.identity, &root)
        .map_err(|error| locate(error, location))?;
    Ok(observed.identity)
}

/// Observe one file's current fingerprint: no-follow size, nanosecond mtime,
/// remount-stable volume identity and qualified file ID. Reads no content.
///
/// # Errors
/// `InvalidInput` for links, junctions and non-regular files, the I/O error
/// kind when the entry cannot be inspected, and `IdentityConflict` when the
/// volume identity cannot be qualified.
pub fn probe_fingerprint(path: &Path) -> Result<ObservationFingerprint, LibraryError> {
    let meta = fs::symlink_metadata(path).map_err(|error| LibraryError::from_io(path, &error))?;
    if fs_pathsafe::is_link_or_junction_metadata(&meta) || !meta.is_file() {
        return Err(identity::scoped(
            LibraryError::InvalidInput("not a regular file; links are not followed".into()),
            path,
        ));
    }
    let volume = identity::volume_of(path, &meta)?;
    let file_id = identity::file_id(path, &meta, &volume).map_err(|error| {
        if error.kind() == std::io::ErrorKind::InvalidInput {
            identity::scoped(LibraryError::InvalidInput(error.to_string()), path)
        } else {
            LibraryError::from_io(path, &error)
        }
    })?;
    let modified_ns = meta.modified().ok().and_then(nanos_since_epoch).ok_or_else(|| {
        identity::scoped(
            LibraryError::SourceUnavailable("modification time unavailable".into()),
            path,
        )
    })?;
    Ok(fingerprint(file_id, &meta, &volume, modified_ns))
}

/// Whether an unobserved relative path may be reconciled as absent.
///
/// True only for a completed or partial observation, when the path lies
/// inside a complete scope and inside no incomplete scope. The caller still
/// checks that the path was not observed and revalidates the root identity.
#[must_use]
pub fn absence_provable(observation: &ScanObservation, relative_path: &NativePath) -> bool {
    if !matches!(observation.state, ScanState::Completed | ScanState::Partial) {
        return false;
    }
    let Ok(path) = relative_path.relative_path() else {
        return false;
    };
    let covers = |scope: &NativePath| scope.relative_path().map(|scope| path.starts_with(scope));
    observation.complete_scopes.iter().any(|scope| covers(scope).unwrap_or(false))
        && !observation.incomplete_scopes.iter().any(|scope| covers(scope).unwrap_or(true))
}

/// Walk a registered location and report its observations progressively.
///
/// `progress` receives each batch of files and issues with cumulative
/// counters; sessions can be persisted and browsed before the walk ends.
///
/// # Errors
/// Root, identity and scope failures before the walk, an unlistable scan
/// scope, and any error returned by `progress` (which stops the scan). Once
/// walking, cancellation returns `Canceled` and a lost root returns `Failed`
/// observations instead.
pub fn scan(
    location: &Location,
    options: &ScanOptions,
    mut progress: impl FnMut(ScanBatch) -> Result<(), LibraryError>,
    canceled: &AtomicBool,
) -> Result<ScanObservation, LibraryError> {
    let root = location.path.to_path_buf().map_err(|error| locate(error, location))?;
    let scope =
        scope_path(options.relative_scope.as_ref()).map_err(|error| locate(error, location))?;
    let anchor = identity::observe(&root)
        .and_then(|observed| {
            identity::compare(&location.identity, &observed.identity, &root).map(|()| observed)
        })
        .map_err(|error| locate(error, location))?;
    let scope_stamp =
        enter_scope(&root, &scope, &anchor.stamp).map_err(|error| locate(error, location))?;

    let mut walk = Walk {
        location,
        root: &root,
        root_stamp: anchor.stamp,
        volume: &anchor.identity.volume,
        batch_size: options.batch_size.max(1),
        canceled,
        progress: &mut progress,
        pending: ScanBatch::default(),
        totals: ScanProgress::default(),
        files: Vec::new(),
        issues: Vec::new(),
        incomplete: Vec::new(),
    };
    let halt = walk.run(&scope, scope_stamp).err();
    let Walk { totals, files, mut issues, mut incomplete, .. } = walk;
    let scope = NativePath::from_path(&scope);

    let state = match halt {
        None => {
            let state =
                if incomplete.is_empty() { ScanState::Completed } else { ScanState::Partial };
            return Ok(ScanObservation {
                location_id: location.id,
                root_identity: anchor.identity,
                files,
                issues,
                complete_scopes: vec![scope],
                incomplete_scopes: incomplete,
                progress: totals,
                state,
            });
        }
        Some(Halt::Callback(error) | Halt::Failed(error)) => return Err(error),
        Some(Halt::Canceled) => ScanState::Canceled,
        Some(Halt::RootLost(issue)) => {
            issues.push(issue);
            ScanState::Failed
        }
    };
    incomplete.push(scope);
    Ok(ScanObservation {
        location_id: location.id,
        root_identity: anchor.identity,
        files,
        issues,
        complete_scopes: Vec::new(),
        incomplete_scopes: incomplete,
        progress: totals,
        state,
    })
}

/// Attach the location identity (and root scope when none) to an error.
fn locate(error: LibraryError, location: &Location) -> LibraryError {
    match error {
        LibraryError::Context { error, scope, identity: None } => {
            LibraryError::Context { error, scope, identity: Some(location.id) }
        }
        error @ LibraryError::Context { .. } => error,
        error => LibraryError::Context {
            error: Box::new(error),
            scope: location.path.clone(),
            identity: Some(location.id),
        },
    }
}

/// Normalized relative scan scope; `.` components are dropped.
fn scope_path(scope: Option<&NativePath>) -> Result<PathBuf, LibraryError> {
    let Some(scope) = scope else {
        return Ok(PathBuf::new());
    };
    Ok(scope
        .relative_path()?
        .components()
        .filter(|part| matches!(part, Component::Normal(_)))
        .collect())
}

/// Descend to the scan scope without following links or leaving the volume.
fn enter_scope(root: &Path, scope: &Path, root_stamp: &Stamp) -> Result<Stamp, LibraryError> {
    let mut current = root.to_path_buf();
    let mut stamp = *root_stamp;
    for part in scope.components() {
        current.push(part);
        let meta = fs::symlink_metadata(&current)
            .map_err(|error| LibraryError::from_io(&current, &error))?;
        let refusal = if fs_pathsafe::is_link_or_junction_metadata(&meta) {
            Some(LibraryError::InvalidInput("scan scope passes through a link or junction".into()))
        } else if !meta.is_dir() {
            Some(LibraryError::InvalidInput("scan scope is not a directory".into()))
        } else if !identity::stamp(&meta).same_device(root_stamp) {
            Some(LibraryError::IdentityConflict("scan scope is on a different volume".into()))
        } else {
            None
        };
        if let Some(error) = refusal {
            return Err(identity::scoped(error, &current));
        }
        stamp = identity::stamp(&meta);
    }
    Ok(stamp)
}

enum Halt {
    Canceled,
    RootLost(ScanIssue),
    Callback(LibraryError),
    Failed(LibraryError),
}

struct Walk<'a, F> {
    location: &'a Location,
    root: &'a Path,
    root_stamp: Stamp,
    volume: &'a VolumeIdentity,
    batch_size: usize,
    canceled: &'a AtomicBool,
    progress: &'a mut F,
    pending: ScanBatch,
    totals: ScanProgress,
    files: Vec<ScanFile>,
    issues: Vec<ScanIssue>,
    incomplete: Vec<NativePath>,
}

impl<F: FnMut(ScanBatch) -> Result<(), LibraryError>> Walk<'_, F> {
    fn run(&mut self, scope: &Path, scope_stamp: Stamp) -> Result<(), Halt> {
        let mut stack = vec![(scope.to_path_buf(), scope_stamp)];
        while let Some((directory, expected)) = stack.pop() {
            self.check_canceled()?;
            let is_scope = directory.as_path() == scope;
            let Some(names) = self.list(&directory, expected, is_scope)? else {
                continue;
            };
            let mut children = Vec::new();
            for name in names {
                self.check_canceled()?;
                self.visit(directory.join(name), &mut children)?;
            }
            stack.extend(children.into_iter().rev());
        }
        // Full remount-stable revalidation plus same-session continuity guard
        // the final batch and the completeness claim.
        if let Err(error) = identity::observe(self.root).and_then(|observed| {
            identity::compare(&self.location.identity, &observed.identity, self.root)
        }) {
            return Err(Halt::RootLost(root_issue(&error)));
        }
        if self.pending.files.is_empty() && self.pending.issues.is_empty() {
            return self.check_root();
        }
        self.flush()
    }

    fn check_canceled(&self) -> Result<(), Halt> {
        if self.canceled.load(Ordering::Acquire) {
            return Err(Halt::Canceled);
        }
        Ok(())
    }

    /// Sorted entry names of a directory, or `None` when it was excluded.
    ///
    /// A failure at the scan scope itself ends the scan with an error; below
    /// it, the directory becomes an issue and an incomplete scope.
    fn list(
        &mut self,
        directory: &Path,
        expected: Stamp,
        is_scope: bool,
    ) -> Result<Option<Vec<OsString>>, Halt> {
        let path = self.root.join(directory);
        let unchanged = || {
            fs::symlink_metadata(&path).is_ok_and(|meta| {
                !fs_pathsafe::is_link_or_junction_metadata(&meta)
                    && meta.is_dir()
                    && identity::stamp(&meta) == expected
            })
        };
        let mut names = Vec::new();
        let failure = if unchanged() {
            match fs::read_dir(&path) {
                Ok(entries) => {
                    let mut interrupted = None;
                    for entry in entries {
                        match entry {
                            Ok(entry) => names.push(entry.file_name()),
                            Err(error) => {
                                interrupted = Some(error);
                                break;
                            }
                        }
                    }
                    // A listing taken from a directory swapped mid-read is not
                    // evidence of its contents.
                    if unchanged() {
                        interrupted
                            .map(|error| ListingFailure::io("listing interrupted", &error, true))
                    } else {
                        Some(ListingFailure::changed())
                    }
                }
                Err(error) => Some(ListingFailure::io("unreadable", &error, false)),
            }
        } else {
            Some(ListingFailure::changed())
        };
        let Some(failure) = failure else {
            self.totals.complete_directories += 1;
            names.sort();
            return Ok(Some(names));
        };
        if is_scope {
            return Err(Halt::Failed(locate(
                identity::scoped(failure.error, &path),
                self.location,
            )));
        }
        self.totals.unreadable += 1;
        self.exclude(directory, failure.reason, failure.availability);
        // Entries read before an interruption are still observations; their
        // subtree is already excluded from absence reconciliation.
        if failure.keep_names {
            names.sort();
            return Ok(Some(names));
        }
        Ok(None)
    }

    fn visit(
        &mut self,
        relative: PathBuf,
        children: &mut Vec<(PathBuf, Stamp)>,
    ) -> Result<(), Halt> {
        let path = self.root.join(&relative);
        match fs::symlink_metadata(&path) {
            Err(error) => {
                self.totals.unreadable += 1;
                self.exclude(
                    &relative,
                    format!("entry unreadable: {error}"),
                    io_availability(&error),
                );
            }
            Ok(meta) if fs_pathsafe::is_link_or_junction_metadata(&meta) => {
                self.exclude(
                    &relative,
                    "link or junction not followed".into(),
                    Availability::Unreadable,
                );
            }
            Ok(meta) if meta.is_dir() => {
                let stamp = identity::stamp(&meta);
                if stamp.same_device(&self.root_stamp) {
                    children.push((relative, stamp));
                } else {
                    self.exclude(
                        &relative,
                        "a different volume is mounted here; not traversed".into(),
                        Availability::IdentityConflict,
                    );
                }
            }
            Ok(meta) => {
                self.totals.discovered += 1;
                let format =
                    if meta.is_file() { format_of(&relative) } else { ImageFormat::Unsupported };
                match format {
                    ImageFormat::Fits => self.read(&relative, &path, &meta, format, &FitsExtractor),
                    ImageFormat::Xisf => self.read(&relative, &path, &meta, format, &XisfExtractor),
                    ImageFormat::Unsupported => self.totals.unsupported += 1,
                }
            }
        }
        if self.pending.files.len() + self.pending.issues.len() >= self.batch_size {
            self.flush()?;
        }
        Ok(())
    }

    fn read(
        &mut self,
        relative: &Path,
        path: &Path,
        before: &Metadata,
        format: ImageFormat,
        extractor: &dyn MetadataExtractor,
    ) {
        let raw = match extractor.extract(path) {
            Ok(Some(raw)) => raw,
            Ok(None) => {
                self.totals.unreadable += 1;
                self.exclude(
                    relative,
                    "metadata unreadable: the adapter declined the file".into(),
                    Availability::Available,
                );
                return;
            }
            Err(MetadataExtractError::Io { msg, .. }) => {
                self.totals.unreadable += 1;
                self.exclude(
                    relative,
                    format!("header unreadable: {msg}"),
                    Availability::Unreadable,
                );
                return;
            }
            Err(MetadataExtractError::Parse { msg, .. }) => {
                self.totals.unreadable += 1;
                self.exclude(
                    relative,
                    format!("metadata unreadable: {msg}"),
                    Availability::Available,
                );
                return;
            }
        };
        // The adapters open by path; the header only counts if the entry is
        // still the regular file observed before the read.
        let after = fs::symlink_metadata(path);
        let unchanged = after.as_ref().is_ok_and(|after| {
            !fs_pathsafe::is_link_or_junction_metadata(after)
                && after.is_file()
                && identity::stamp(after) == identity::stamp(before)
                && after.len() == before.len()
                && after.modified().ok() == before.modified().ok()
        });
        let modified_ns = before.modified().ok().and_then(nanos_since_epoch);
        let Some(modified_ns) = modified_ns.filter(|_| unchanged) else {
            self.totals.unreadable += 1;
            let reason = if unchanged {
                "modification time unavailable"
            } else {
                "file changed while its header was read"
            };
            self.exclude(relative, reason.into(), Availability::Unreadable);
            return;
        };
        let file_id = match identity::file_id(path, before, self.volume) {
            Ok(file_id) => file_id,
            Err(error) => {
                self.totals.unreadable += 1;
                self.exclude(
                    relative,
                    format!("file ID unreadable: {error}"),
                    Availability::Unreadable,
                );
                return;
            }
        };
        self.totals.metadata_read += 1;
        self.pending.files.push(ScanFile {
            relative_path: NativePath::from_path(relative),
            fingerprint: fingerprint(file_id, before, self.volume, modified_ns),
            format,
            metadata: CaptureMetadata::from(&raw),
        });
    }

    /// Record an issue and exclude its subtree from absence reconciliation.
    fn exclude(&mut self, relative: &Path, reason: String, availability: Availability) {
        let relative_path = NativePath::from_path(relative);
        self.incomplete.push(relative_path.clone());
        self.pending.issues.push(ScanIssue { relative_path, reason, availability });
    }

    /// Deliver the pending batch once cancellation and root continuity pass.
    fn flush(&mut self) -> Result<(), Halt> {
        self.check_canceled()?;
        self.check_root()?;
        let batch = ScanBatch {
            files: std::mem::take(&mut self.pending.files),
            issues: std::mem::take(&mut self.pending.issues),
            progress: self.totals.clone(),
        };
        self.files.extend(batch.files.iter().cloned());
        self.issues.extend(batch.issues.iter().cloned());
        (self.progress)(batch).map_err(Halt::Callback)
    }

    /// Same-session continuity of the root validated at the start.
    fn check_root(&self) -> Result<(), Halt> {
        let root = NativePath::from_path(Path::new(""));
        match fs::symlink_metadata(self.root) {
            Err(error) => Err(Halt::RootLost(ScanIssue {
                relative_path: root,
                reason: format!("location root became unavailable during the scan: {error}"),
                availability: Availability::Offline,
            })),
            Ok(meta)
                if fs_pathsafe::is_link_or_junction_metadata(&meta)
                    || !meta.is_dir()
                    || identity::stamp(&meta) != self.root_stamp =>
            {
                Err(Halt::RootLost(ScanIssue {
                    relative_path: root,
                    reason: "location root was replaced during the scan".into(),
                    availability: Availability::IdentityConflict,
                }))
            }
            Ok(_) => Ok(()),
        }
    }
}

fn root_issue(error: &LibraryError) -> ScanIssue {
    let inner = match error {
        LibraryError::Context { error, .. } => error.as_ref(),
        error => error,
    };
    let availability = match inner {
        LibraryError::SourceUnavailable(_) | LibraryError::NotFound(_) => Availability::Offline,
        LibraryError::AccessDenied(_) => Availability::Unreadable,
        _ => Availability::IdentityConflict,
    };
    ScanIssue {
        relative_path: NativePath::from_path(Path::new("")),
        reason: format!("location root failed final revalidation: {inner}"),
        availability,
    }
}

fn io_availability(error: &std::io::Error) -> Availability {
    match error.kind() {
        std::io::ErrorKind::NotFound => Availability::Offline,
        _ => Availability::Unreadable,
    }
}

/// Why a directory below the scan scope could not serve as listing evidence.
struct ListingFailure {
    reason: String,
    availability: Availability,
    error: LibraryError,
    keep_names: bool,
}

impl ListingFailure {
    fn changed() -> Self {
        let reason = "directory changed during the scan";
        Self {
            reason: reason.into(),
            availability: Availability::Unreadable,
            error: LibraryError::SourceUnavailable(reason.into()),
            keep_names: false,
        }
    }

    fn io(what: &str, error: &std::io::Error, keep_names: bool) -> Self {
        let message = error.to_string();
        Self {
            reason: format!("directory {what}: {message}"),
            availability: io_availability(error),
            error: match error.kind() {
                std::io::ErrorKind::PermissionDenied => LibraryError::AccessDenied(message),
                std::io::ErrorKind::NotFound => LibraryError::NotFound(message),
                _ => LibraryError::SourceUnavailable(message),
            },
            keep_names,
        }
    }
}

/// Ordinary observations carry no content digest; the catalog hashes lazily
/// for explicitly reviewed decisions and custody work.
fn fingerprint(
    file_id: Option<String>,
    meta: &Metadata,
    volume: &VolumeIdentity,
    modified_ns: i128,
) -> ObservationFingerprint {
    ObservationFingerprint {
        identity: FileIdentity { volume: volume.clone(), file_id },
        size_bytes: meta.len(),
        modified_ns,
        content_sha256: None,
    }
}

/// Supported header format, decided by the adapters' own extension rules.
fn format_of(path: &Path) -> ImageFormat {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return ImageFormat::Unsupported;
    };
    let extension = extension.to_ascii_lowercase();
    if FitsExtractor.supports_extension(&extension) {
        ImageFormat::Fits
    } else if XisfExtractor.supports_extension(&extension) {
        ImageFormat::Xisf
    } else {
        ImageFormat::Unsupported
    }
}

/// Signed nanoseconds since the Unix epoch, losslessly.
fn nanos_since_epoch(time: SystemTime) -> Option<i128> {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => i128::try_from(after.as_nanos()).ok(),
        Err(before) => i128::try_from(before.duration().as_nanos()).ok().map(|nanos| -nanos),
    }
}
