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
/// shared by both `WatcherService::start` and `start_artifact_watcher`.
///
/// When `follow_symlinks` is `false`, each path is walked via
/// [`fs_pathsafe::real_dirs_under`] and every real (non-link) subdirectory is
/// watched individually with `RecursiveMode::NonRecursive`.
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
/// # Errors
///
/// Returns an error string if a root path cannot be watched (always fatal), if
/// any subdirectory fails when `fail_fast` is `true`, or if the batch cannot
/// be applied. The watcher is then left unspecified: drop it.
pub fn register_watch_paths(
    watcher: &mut RecommendedWatcher,
    paths: &[Utf8PathBuf],
    follow_symlinks: bool,
    fail_fast: bool,
) -> Result<WatchRegistrationReport, String> {
    register(watcher, paths, follow_symlinks, fail_fast, |root| {
        fs_pathsafe::real_dirs_under(root, false)
    })
}

/// [`register_watch_paths`] without following links and without failing
/// fast, over the folders of each path's own volume only
/// ([`fs_pathsafe::real_dirs_on_volume`]): a volume mounted inside the tree
/// is not watched, as a scan never enters it.
///
/// # Errors
/// As [`register_watch_paths`].
pub fn register_tree_paths(
    watcher: &mut RecommendedWatcher,
    paths: &[Utf8PathBuf],
) -> Result<WatchRegistrationReport, String> {
    register(watcher, paths, false, false, fs_pathsafe::real_dirs_on_volume)
}

/// Register `paths`; without `follow_symlinks`, each one's folders as `dirs`
/// lists them, the path itself first.
fn register(
    watcher: &mut RecommendedWatcher,
    paths: &[Utf8PathBuf],
    follow_symlinks: bool,
    fail_fast: bool,
    dirs: impl Fn(&std::path::Path) -> Vec<std::path::PathBuf>,
) -> Result<WatchRegistrationReport, String> {
    let mut report = WatchRegistrationReport::default();
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
        // Root path (dirs[0]) failure is always fatal — if we cannot watch the
        // root itself, there is nothing useful the watcher can do.
        let mut is_root = true;
        for dir in dirs {
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
    Ok(report)
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
}
