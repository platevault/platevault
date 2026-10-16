// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared `notify`-event classification + UTF-8-safe path conversion, used by
//! both [`crate::watcher`] and [`crate::artifact_watcher`] (duplication-and-
//! abstraction audit Tier 3, DS-2 extraction).

use camino::{Utf8Path, Utf8PathBuf};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};

/// The three event kinds both watcher event enums distinguish. `notify`
/// event kinds outside these three (Access, Other, ...) are not forwarded.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SimpleEventKind {
    Created,
    Modified,
    Removed,
}

/// Classify a raw `notify::EventKind` into the shared 3-way kind, or `None`
/// for event kinds neither watcher forwards (e.g. `Access`).
#[must_use]
pub fn classify(kind: EventKind) -> Option<SimpleEventKind> {
    match kind {
        EventKind::Create(_) => Some(SimpleEventKind::Created),
        EventKind::Modify(_) => Some(SimpleEventKind::Modified),
        EventKind::Remove(_) => Some(SimpleEventKind::Removed),
        _ => None,
    }
}

/// Convert a `notify`-yielded `std::path::Path` to a faithful UTF-8 path, or
/// `None` if it cannot be represented as one.
///
/// `notify` yields `std::path::PathBuf`, which can be non-UTF-8 on a raw
/// disk. We never lossy-convert (that would corrupt a path that later
/// crosses the IPC boundary as a wire string) — a non-UTF-8 path is skipped
/// with a `diagnostic_source`-tagged stderr diagnostic instead. Constitution
/// §I (Local-First custody): never silently mangle a user path.
#[must_use]
pub fn utf8_path_or_skip(path: &std::path::Path, diagnostic_source: &str) -> Option<Utf8PathBuf> {
    if let Some(utf8) = Utf8Path::from_path(path) {
        Some(utf8.to_owned())
    } else {
        eprintln!(
            "{diagnostic_source}: skipping non-UTF-8 path (cannot emit faithful UTF-8 event): {}",
            path.to_string_lossy()
        );
        None
    }
}

/// Outcome of registering watch paths — reports which paths were skipped due
/// to OS-level errors so callers can log per-path failures without aborting the
/// entire watcher start (bead kyo7.74 item d).
#[derive(Debug, Default)]
pub struct WatchRegistrationReport {
    /// Paths successfully registered with the OS watcher.
    pub watched: Vec<std::path::PathBuf>,
    /// `(path, error_message)` pairs for directories that could not be watched.
    pub skipped: Vec<(std::path::PathBuf, String)>,
}

/// Register `paths` with `watcher`, using the symlink-safe two-mode strategy
/// shared by both `WatcherService::start` (the per-project watcher) and
/// `start_artifact_watcher`.
///
/// When `follow_symlinks` is `false`, each path is walked via
/// [`fs_pathsafe::real_dirs_under`] and every real (non-link) subdirectory is
/// watched individually with `RecursiveMode::NonRecursive`. That lister
/// leaves out a folder swapped for a link or junction while it lists, with
/// what it found there, so no folder outside the path is watched through
/// one.
///
/// Every path is registered in one batch ([`Watcher::paths_mut`]): `FSEvents`
/// (macOS) stops its stream once and restarts it once with every path, where
/// one `watch` call per folder restarted it once per folder. The other
/// backends register each path as it is added.
///
/// When `fail_fast` is `true`, the first per-directory error aborts the entire
/// registration (backwards-compatible with root-path failures). When `false`,
/// per-subdirectory failures are collected in `WatchRegistrationReport::skipped`
/// and do not abort (item d: partial start tolerance).
///
/// These three behaviours came with the tree watcher (astro-plan-ef440) and
/// hold for every caller: the one batch, the swap-checked listing, and a
/// path that probes as a real folder yet lists no folders failing the
/// registration instead of reporting a watch on nothing.
///
/// # Errors
///
/// Returns an error string if a root path cannot be watched (always fatal),
/// if a root lists no folders once it probed fine (it changed, or could not
/// be read, meanwhile), if any subdirectory fails when `fail_fast` is
/// `true`, or if the batch cannot be applied. The watcher is then left
/// unspecified: drop it.
pub fn register_watch_paths(
    watcher: &mut RecommendedWatcher,
    paths: &[Utf8PathBuf],
    follow_symlinks: bool,
    fail_fast: bool,
) -> Result<WatchRegistrationReport, String> {
    register(watcher, paths, follow_symlinks, fail_fast, false, |root| {
        fs_pathsafe::real_dirs_under(root, false)
    })
}

/// [`register_watch_paths`] without following links and without failing
/// fast, over the folders of each path's own volume only
/// ([`fs_pathsafe::real_dirs_on_volume`]): a volume mounted inside the tree
/// is not watched, as a scan never enters it.
///
/// Each folder is checked, without following links, right before it is
/// added: one that is no longer a real folder, or is reached through a link
/// or junction above it (swapped in after the tree was listed), is left out.
/// Once the batch is applied each one is checked again, so a folder swapped
/// while the batch registered fails the registration.
///
/// # Errors
/// As [`register_watch_paths`], and a folder that changed while it was
/// registered.
pub fn register_tree_paths(
    watcher: &mut RecommendedWatcher,
    paths: &[Utf8PathBuf],
) -> Result<WatchRegistrationReport, String> {
    register(watcher, paths, false, false, true, fs_pathsafe::real_dirs_on_volume)
}

/// Register `paths`; without `follow_symlinks`, each one's folders as `dirs`
/// lists them, the path itself first. With `verify`, each folder is checked
/// around its registration as [`register_tree_paths`] describes.
fn register(
    watcher: &mut RecommendedWatcher,
    paths: &[Utf8PathBuf],
    follow_symlinks: bool,
    fail_fast: bool,
    verify: bool,
    dirs: impl Fn(&std::path::Path) -> Vec<std::path::PathBuf>,
) -> Result<WatchRegistrationReport, String> {
    let mut report = WatchRegistrationReport::default();
    let mut recorded = Vec::new();
    let mut batch = watcher.paths_mut();

    for path in paths {
        if follow_symlinks {
            batch
                .add(path.as_std_path(), RecursiveMode::Recursive)
                .map_err(|e| format!("failed to watch {path}: {e}"))?;
            report.watched.push(path.as_std_path().to_path_buf());
            continue;
        }

        // The `fs_pathsafe` listers answer with an empty list for a root they refuse,
        // which would leave the loop below with nothing to do and report
        // success while watching nothing. Probe first so an unwatchable root is
        // an error rather than an empty success.
        //
        // `GatedLink` is the exception: observing nothing under a symlinked
        // root while `follow_symlinks` is off is the constitution's gate doing
        // its job, not a failure, so it is recorded as skipped and the
        // registration continues.
        match fs_pathsafe::probe_root(path.as_std_path(), false) {
            Ok(()) => {}
            Err(fs_pathsafe::RootUnavailable::GatedLink) => {
                let reason = fs_pathsafe::RootUnavailable::GatedLink.to_string();
                tracing::info!(root = %path, "not watching a symlinked root: {reason}");
                report.skipped.push((path.as_std_path().to_path_buf(), reason));
                continue;
            }
            Err(reason) => return Err(format!("failed to watch {path}: {reason}")),
        }

        let dirs = dirs(path.as_std_path());
        // The listers name a real root first. Nothing listed means the root
        // changed, or could not be read, after the probe: an empty success
        // would watch nothing.
        if dirs.is_empty() {
            return Err(format!("failed to watch {path}: its folders could not be listed"));
        }
        // Root path (dirs[0]) failure is always fatal — if we cannot watch the
        // root itself, there is nothing useful the watcher can do.
        let mut is_root = true;
        for dir in dirs {
            if verify {
                // Swapped for a link or junction since it was listed, or
                // reached through one: what is there now is not in the tree.
                let Some(identity) = tree_identity(path.as_std_path(), &dir) else {
                    if is_root {
                        return Err(format!(
                            "failed to watch {}: not a real folder",
                            dir.display()
                        ));
                    }
                    continue;
                };
                recorded.push((path.as_std_path(), dir.clone(), identity));
            }
            match batch.add(&dir, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    report.watched.push(dir);
                }
                Err(e) if is_root || fail_fast => {
                    return Err(format!("failed to watch {}: {e}", dir.display()));
                }
                Err(e) => {
                    tracing::warn!(dir = %dir.display(), error = %e, "skipping unwatchable subdirectory");
                    report.skipped.push((dir, e.to_string()));
                }
            }
            is_root = false;
        }
    }

    batch.commit().map_err(|e| format!("failed to start watching: {e}"))?;
    if let Some((_, dir, _)) =
        recorded.iter().find(|(root, dir, identity)| !still_folder(root, dir, identity))
    {
        return Err(format!("{} changed while it was registered", dir.display()));
    }
    Ok(report)
}

/// A real folder's identity from its no-follow metadata: its device and
/// inode on Unix; elsewhere only that it is a real folder, since a junction
/// or symlink put in its place reads as a reparse point. `None` for anything
/// else, a link or junction included.
fn folder_identity(path: &std::path::Path) -> Option<FolderIdentity> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if fs_pathsafe::is_link_or_junction_metadata(&meta) || !meta.is_dir() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(FolderIdentity(meta.dev(), meta.ino()))
    }
    #[cfg(not(unix))]
    {
        Some(FolderIdentity)
    }
}

#[cfg(unix)]
#[derive(Debug, PartialEq, Eq)]
struct FolderIdentity(u64, u64);

#[cfg(not(unix))]
#[derive(Debug, PartialEq, Eq)]
struct FolderIdentity;

/// The identity of `dir` below `root` while every folder from `root` down to
/// it is a real folder: a folder reached through a link or junction above
/// it is `None` too, though it may be the same folder moved elsewhere.
fn tree_identity(root: &std::path::Path, dir: &std::path::Path) -> Option<FolderIdentity> {
    let relative = dir.strip_prefix(root).ok()?;
    let mut path = root.to_path_buf();
    let mut identity = folder_identity(&path)?;
    for part in relative.components() {
        path.push(part);
        identity = folder_identity(&path)?;
    }
    Some(identity)
}

/// Whether `dir` below `root` is still the folder `identity` was recorded
/// for, or was removed from real folders above it: a watch on a removed
/// folder holds nothing outside the tree.
fn still_folder(root: &std::path::Path, dir: &std::path::Path, identity: &FolderIdentity) -> bool {
    if let Some(now) = tree_identity(root, dir) {
        return now == *identity;
    }
    let parent_real =
        dir != root && dir.parent().is_some_and(|parent| tree_identity(root, parent).is_some());
    parent_real
        && std::fs::symlink_metadata(dir)
            .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_maps_create_modify_remove() {
        assert_eq!(
            classify(EventKind::Create(notify::event::CreateKind::File)),
            Some(SimpleEventKind::Created)
        );
        assert_eq!(
            classify(EventKind::Modify(notify::event::ModifyKind::Any)),
            Some(SimpleEventKind::Modified)
        );
        assert_eq!(
            classify(EventKind::Remove(notify::event::RemoveKind::File)),
            Some(SimpleEventKind::Removed)
        );
    }

    #[test]
    fn classify_ignores_other_kinds() {
        assert_eq!(classify(EventKind::Access(notify::event::AccessKind::Any)), None);
    }

    #[test]
    fn utf8_path_or_skip_converts_valid_utf8() {
        let p = std::path::Path::new("/tmp/valid.fits");
        assert_eq!(utf8_path_or_skip(p, "test"), Some(Utf8PathBuf::from("/tmp/valid.fits")));
    }

    #[test]
    fn register_watch_paths_succeeds_on_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let mut watcher =
            notify::recommended_watcher(|_: Result<notify::Event, notify::Error>| {}).unwrap();
        let report = register_watch_paths(&mut watcher, &[path], false, false).unwrap();
        assert_ne!(report.watched, [] as [std::path::PathBuf; 0]);
        assert_eq!(report.skipped, [] as [(std::path::PathBuf, String); 0]);
    }

    #[test]
    fn register_watch_paths_root_failure_is_fatal() {
        let path = Utf8PathBuf::from("/nonexistent/path/that/should/not/exist");
        let mut watcher =
            notify::recommended_watcher(|_: Result<notify::Event, notify::Error>| {}).unwrap();
        let result = register_watch_paths(&mut watcher, &[path], false, false);
        assert!(result.is_err());
    }

    /// A folder of the tree is swapped for a link to its moved original
    /// after the tree was listed and before it is registered: the tree
    /// watcher leaves it out instead of watching what the link points at.
    #[cfg(unix)]
    #[test]
    fn a_folder_swapped_for_a_link_before_registration_is_not_watched() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        let root = base.join("Captures");
        std::fs::create_dir_all(root.join("night/Ha")).unwrap();
        let moved = base.join("moved");
        let mut watcher =
            notify::recommended_watcher(|_: Result<notify::Event, notify::Error>| {}).unwrap();
        let paths = [Utf8PathBuf::from_path_buf(root.clone()).unwrap()];

        let report = register(&mut watcher, &paths, false, false, true, |root| {
            let listed = fs_pathsafe::real_dirs_on_volume(root);
            std::fs::rename(root.join("night"), &moved).unwrap();
            std::os::unix::fs::symlink(&moved, root.join("night")).unwrap();
            listed
        })
        .unwrap();

        assert_eq!(report.watched, [root]);
        assert_eq!(report.skipped, [] as [(std::path::PathBuf, String); 0]);
    }

    /// The root probes fine, then its folders cannot be listed (it changed,
    /// or a read failed, meanwhile): the registration fails instead of
    /// reporting a watch on nothing.
    #[test]
    fn a_root_whose_folders_cannot_be_listed_fails_the_registration() {
        let dir = tempfile::tempdir().unwrap();
        let paths = [Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).unwrap()];
        let mut watcher =
            notify::recommended_watcher(|_: Result<notify::Event, notify::Error>| {}).unwrap();

        let result = register(&mut watcher, &paths, false, false, true, |_| Vec::new());

        assert!(result.is_err(), "registered nothing as a success: {result:?}");
    }
}
