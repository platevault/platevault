//! Per-root symlink/junction gating (spec 048 T004).
//!
//! Constitution product constraint: "The product MUST avoid following
//! symlinks or junctions during scans unless the user explicitly enables that
//! behavior for a root". This module is the single place that decides whether
//! a filesystem entry is a link that should be skipped, and provides a
//! link-aware directory walker used both by live watches
//! ([`crate::watcher::WatcherService::start`]) and by the raw-frame reconcile
//! walker (spec 048 US2/T003+).
//!
//! Detection is a plain `symlink_metadata().file_type().is_symlink()` check.
//! On Windows this also covers NTFS junctions/mount points — modern Rust
//! standard library reports directory junctions as symlinks via
//! `is_symlink()` because both are surfaced as reparse points. Where that is
//! not the case for an exotic reparse point kind, the walker still won't
//! *recurse* into an unexpected reparse point because `read_dir` on it will
//! either fail or return the junction's target contents, which is exactly
//! the traversal we must avoid — callers should treat any doubt as "skip".

use std::fs;
use std::path::{Path, PathBuf};

/// Returns `true` when `path` is a symlink or (on Windows) a junction /
/// reparse-point directory, as reported by `symlink_metadata`.
///
/// Uses `symlink_metadata` (not `metadata`) so the check inspects the entry
/// itself rather than following it — inspecting a link's target would defeat
/// the purpose of the gate.
#[must_use]
pub fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink())
}

/// Recursively collect every real (non-link) directory under `root`,
/// including `root` itself when it is not a link.
///
/// When `follow_symlinks` is `true`, this simply returns `[root]` — the
/// caller is expected to use a recursive watch/walk from there instead
/// (matching the pre-gate behaviour). When `false` (the default), the
/// returned list never includes a symlinked/junction directory or descends
/// through one, satisfying the constitution's "MUST NOT follow symlinks or
/// junctions ... unless explicitly enabled" requirement.
///
/// Unreadable directories are skipped rather than failing the whole walk —
/// a single permission-denied subtree should not abort discovery of the rest
/// of the root.
#[must_use]
pub fn real_dirs_under(root: &Path, follow_symlinks: bool) -> Vec<PathBuf> {
    if follow_symlinks {
        return vec![root.to_path_buf()];
    }
    if is_link(root) {
        return Vec::new();
    }

    let mut dirs = vec![root.to_path_buf()];
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if is_link(&path) {
                continue;
            }
            if path.is_dir() {
                dirs.push(path.clone());
                stack.push(path);
            }
        }
    }

    dirs
}

/// Recursively collect every real (non-link) **file** under `root`.
///
/// Mirrors [`real_dirs_under`]'s gating: a symlinked/junction directory is
/// never descended into, and a symlinked file is never yielded, unless
/// `follow_symlinks` is `true`. Used by the raw-frame reconcile walker to
/// enumerate on-disk frames without ever following a link (spec 048 R6).
#[must_use]
pub fn real_files_under(root: &Path, follow_symlinks: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();

    if !follow_symlinks && is_link(root) {
        return files;
    }

    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !follow_symlinks && is_link(&path) {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() {
                files.push(path);
            }
        }
    }

    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_directory_is_not_a_link() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_link(dir.path()));
    }

    #[test]
    fn real_dirs_under_includes_nested_real_directories() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();

        let dirs = real_dirs_under(dir.path(), false);
        assert!(dirs.contains(&dir.path().to_path_buf()));
        assert!(dirs.contains(&dir.path().join("a")));
        assert!(dirs.contains(&nested));
    }

    #[test]
    fn real_files_under_finds_nested_files() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("frame.fits"), b"data").unwrap();
        std::fs::write(dir.path().join("top.fits"), b"data").unwrap();

        let mut files = real_files_under(dir.path(), false);
        files.sort();
        assert_eq!(files.len(), 2);
        assert!(files.contains(&nested.join("frame.fits")));
        assert!(files.contains(&dir.path().join("top.fits")));
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_directory_is_detected_and_skipped() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let real_target = dir.path().join("real_target");
        std::fs::create_dir_all(&real_target).unwrap();
        std::fs::write(real_target.join("hidden.fits"), b"data").unwrap();

        let scan_root = dir.path().join("scan_root");
        std::fs::create_dir_all(&scan_root).unwrap();
        let link_path = scan_root.join("link_to_target");
        symlink(&real_target, &link_path).unwrap();

        assert!(is_link(&link_path));

        // The linked subdirectory must not be descended into.
        let dirs = real_dirs_under(&scan_root, false);
        assert!(!dirs.contains(&link_path));

        let files = real_files_under(&scan_root, false);
        assert!(files.is_empty(), "must not see files behind an un-enabled symlink");
    }

    #[cfg(unix)]
    #[test]
    fn follow_symlinks_true_traverses_link() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let real_target = dir.path().join("real_target");
        std::fs::create_dir_all(&real_target).unwrap();
        std::fs::write(real_target.join("visible.fits"), b"data").unwrap();

        let scan_root = dir.path().join("scan_root");
        std::fs::create_dir_all(&scan_root).unwrap();
        symlink(&real_target, scan_root.join("link_to_target")).unwrap();

        // With follow_symlinks true, real_dirs_under intentionally just
        // returns the root (caller does a recursive OS-level watch/walk that
        // will itself follow links) — verify that contract explicitly.
        let dirs = real_dirs_under(&scan_root, true);
        assert_eq!(dirs, vec![scan_root.clone()]);
    }
}
