// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Reparse-aware link/junction detection + safe directory/file walking,
//! shared by `fs_inventory` and `fs_executor` (duplication-and-abstraction
//! audit T1-a).
//!
//! Constitution product constraint: "The product MUST avoid following
//! symlinks or junctions during scans unless the user explicitly enables that
//! behavior for a root". This crate is the single place that decides whether
//! a filesystem entry is a link that should be skipped, and provides
//! link-aware directory/file walkers plus a reparse-aware `create_symlink`
//! dispatch.
//!
//! Detection combines `symlink_metadata().file_type().is_symlink()` with an
//! explicit Windows `FILE_ATTRIBUTE_REPARSE_POINT` check. Modern Rust
//! reports NTFS junctions as symlinks via `is_symlink()` because both are
//! surfaced as reparse points, but the explicit attribute check is defence
//! in depth for reparse-point kinds `is_symlink()` might not classify as a
//! symlink — callers should treat any doubt as "skip".

pub mod contain;
pub mod export_dest;
#[cfg(any(test, feature = "test-fixture"))]
pub mod test_support;

use std::fs::{self, Metadata};
use std::io;
use std::path::{Path, PathBuf};

use camino::Utf8Path;

/// Returns `true` when `path` is a symlink or (on Windows) a junction /
/// reparse-point entry, as reported by `symlink_metadata`.
///
/// Uses `symlink_metadata` (not `metadata`) so the check inspects the entry
/// itself rather than following it — inspecting a link's target would defeat
/// the purpose of the gate.
///
/// Fails closed. `NotFound` answers `false`, because a path that does not
/// exist is determinately not a link. Every other stat failure (permission
/// denied, stale mount, I/O error) answers `true`: the result feeds a refusal
/// decision, so "cannot determine" must refuse rather than let the caller
/// descend or traverse. Callers that must distinguish the cases should stat
/// the path themselves and call [`is_link_or_junction_metadata`].
#[must_use]
pub fn is_link_or_junction(path: &Path) -> bool {
    match fs::symlink_metadata(path) {
        Ok(meta) => is_link_or_junction_metadata(&meta),
        Err(e) => e.kind() != io::ErrorKind::NotFound,
    }
}

/// Classify already-fetched [`Metadata`] (from `symlink_metadata`, never
/// `metadata`) as a symlink or junction/reparse-point.
///
/// Split out from [`is_link_or_junction`] so callers that already hold a
/// `symlink_metadata()` result (e.g. a per-component path walk that also
/// needs to distinguish "not found" from "other stat error") can classify it
/// without a second stat syscall.
#[must_use]
pub fn is_link_or_junction_metadata(meta: &Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// Why a root cannot be walked by [`real_files_under_reporting`] /
/// [`real_dirs_under`].
///
/// Callers need this because both walkers return no files for a root they
/// refuse to descend, which is indistinguishable from a genuinely empty root.
/// Treating the two as the same thing lets an unmounted drive read as "every
/// file was deleted".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RootUnavailable {
    /// The path does not exist (unmounted drive, deleted root).
    Missing,
    /// The path exists but is not a directory.
    NotADirectory,
    /// The root itself is a symlink/junction and `follow_symlinks` is off, so
    /// the walkers will not descend it.
    GatedLink,
    /// The path exists as a directory but cannot be stat'd or listed
    /// (permission denied, I/O error, stale network mount).
    Unreadable,
}

impl std::fmt::Display for RootUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Missing => "root path does not exist",
            Self::NotADirectory => "root path is not a directory",
            Self::GatedLink => "root path is a symlink or junction and follow_symlinks is disabled",
            Self::Unreadable => "root path could not be read",
        })
    }
}

/// Check that `root` is a directory the link-aware walkers will actually
/// descend, under the same `follow_symlinks` rule they apply.
///
/// This is the availability precondition for [`real_files_under_reporting`] and
/// [`real_dirs_under`]: it must be checked with the same `follow_symlinks`
/// value, because a symlinked root is walkable with `true` and gated with
/// `false`. Note that `Path::is_dir()` alone is not a substitute — it follows
/// links, so it accepts a symlinked root the gated walkers then refuse.
///
/// # Errors
///
/// Returns the [`RootUnavailable`] reason; `Ok(())` means the walkers will
/// traverse this root.
pub fn probe_root(root: &Path, follow_symlinks: bool) -> Result<(), RootUnavailable> {
    let meta = fs::symlink_metadata(root).map_err(|e| match e.kind() {
        io::ErrorKind::NotFound => RootUnavailable::Missing,
        _ => RootUnavailable::Unreadable,
    })?;

    if is_link_or_junction_metadata(&meta) {
        if !follow_symlinks {
            return Err(RootUnavailable::GatedLink);
        }
        // Following is enabled: classify the link's target instead.
        let target = fs::metadata(root).map_err(|e| match e.kind() {
            io::ErrorKind::NotFound => RootUnavailable::Missing,
            _ => RootUnavailable::Unreadable,
        })?;
        if !target.is_dir() {
            return Err(RootUnavailable::NotADirectory);
        }
    } else if !meta.is_dir() {
        return Err(RootUnavailable::NotADirectory);
    }

    fs::read_dir(root).map(|_| ()).map_err(|_| RootUnavailable::Unreadable)
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
    if is_link_or_junction(root) {
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
            if is_link_or_junction(&path) {
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

/// Recursively collect every real (non-link) **file** under `root`, together
/// with the paths whose state the walk could not observe.
///
/// Mirrors [`real_dirs_under`]'s gating: a symlinked/junction directory is
/// never descended into, and a symlinked file is never yielded, unless
/// `follow_symlinks` is `true`. A root that is itself a link while
/// `follow_symlinks` is off yields nothing; check [`probe_root`] first.
///
/// The walk skips what it cannot read rather than aborting, which makes "no
/// file here" ambiguous between absent and unreadable. Each path in the
/// second list is unknown, together with everything below it; treat it as
/// unknown state, never as absence. It is one of:
///
/// - a directory whose `read_dir` failed;
/// - a directory whose listing failed part-way, so entries may be missing;
/// - an entry whose metadata could not be read, which may be a file or a
///   directory. A directory with read but no search permission (mode 644 on
///   Unix) lists its names but fails this for every entry;
/// - `root` itself when its metadata cannot be read, for example a network
///   share that went stale after [`probe_root`] passed.
///
/// When `follow_symlinks` is on, directories are deduplicated by their
/// canonical path so a link pointing at an ancestor terminates instead of
/// re-entering the subtree forever, and a link whose target cannot be read
/// (dangling, or on an unmounted drive) is unknown.
#[must_use]
pub fn real_files_under_reporting(
    root: &Path,
    follow_symlinks: bool,
) -> (Vec<PathBuf>, Vec<PathBuf>) {
    walk_files(root, follow_symlinks, |dir| {
        fs::read_dir(dir).map(|entries| entries.map(|entry| entry.map(|entry| entry.path())))
    })
}

/// The walk behind [`real_files_under_reporting`], with directory listing
/// passed in so a test can fail a listing part-way.
fn walk_files<Entries>(
    root: &Path,
    follow_symlinks: bool,
    list: impl Fn(&Path) -> io::Result<Entries>,
) -> (Vec<PathBuf>, Vec<PathBuf>)
where
    Entries: Iterator<Item = io::Result<PathBuf>>,
{
    let mut files = Vec::new();
    let mut unreadable = Vec::new();

    if !follow_symlinks {
        match fs::symlink_metadata(root) {
            Ok(meta) if is_link_or_junction_metadata(&meta) => return (files, unreadable),
            Ok(_) => {}
            Err(_) => {
                unreadable.push(root.to_path_buf());
                return (files, unreadable);
            }
        }
    }

    let mut visited = std::collections::HashSet::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if follow_symlinks
            && !visited.insert(fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone()))
        {
            continue;
        }
        let Ok(entries) = list(&dir) else {
            unreadable.push(dir);
            continue;
        };
        for entry in entries {
            // A listing error leaves the rest of `dir` unseen. Stop reading
            // it: a platform may repeat the same error forever.
            let Ok(path) = entry else {
                unreadable.push(dir);
                break;
            };
            match walk_kind(&path, follow_symlinks) {
                Ok(WalkKind::Dir) => stack.push(path),
                Ok(WalkKind::File) => files.push(path),
                Ok(WalkKind::Skip) => {}
                Err(_) => unreadable.push(path),
            }
        }
    }

    (files, unreadable)
}

/// What a file walk does with one listed entry.
enum WalkKind {
    Dir,
    File,
    /// A gated link, or neither a file nor a directory.
    Skip,
}

/// Classify `path` from its own metadata, or from its target's when it is a
/// link and `follow_symlinks` is on.
fn walk_kind(path: &Path, follow_symlinks: bool) -> io::Result<WalkKind> {
    let mut meta = fs::symlink_metadata(path)?;
    if is_link_or_junction_metadata(&meta) {
        if !follow_symlinks {
            return Ok(WalkKind::Skip);
        }
        meta = fs::metadata(path)?;
    }
    Ok(if meta.is_dir() {
        WalkKind::Dir
    } else if meta.is_file() {
        WalkKind::File
    } else {
        WalkKind::Skip
    })
}

/// Create a symlink from `source` to `destination`, pointing at a **file**
/// (`std::os::windows::fs::symlink_file` on Windows — this crate does not
/// yet materialize directory junctions; see `Materialization::Junction`
/// callers).
///
/// # Errors
///
/// Returns the underlying `io::Error` from the platform symlink call, or an
/// "unsupported platform" error on targets that are neither unix nor
/// windows.
pub fn create_symlink(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, destination)
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(source, destination)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (source, destination);
        Err(io::Error::other("symlink not supported on this platform"))
    }
}

// ── Wire-path helpers ─────────────────────────────────────────────────────────

/// Convert `path` to the UTF-8 text wire and contract fields carry, with `/`
/// as the separator.
///
/// Only Windows needs a conversion: there `\` is a separator and never part
/// of a name, so it becomes `/` without loss. On macOS and Linux `/` is
/// already the separator and `\` is an ordinary name character, so the text
/// is kept as it is. A file named `a\b.fits` and the nested `a/b.fits` keep
/// distinct wire text, and `root.join(wire)` names the entry the text came
/// from on every platform (bd `astro-plan-3pvvc`).
///
/// Uses `camino::Utf8Path` for a lossless conversion when the path is valid
/// UTF-8, falling back to `to_string_lossy` (which replaces invalid sequences
/// with U+FFFD) for the rare non-UTF-8 path. The fallback is defensive only;
/// in production all paths pass the non-UTF-8 skip at the `read_dir` boundary
/// before reaching this function.
///
/// This is the canonical single home for the separator rule on a `Path` so
/// the wire format (`relative_file_path` contract field) cannot drift between
/// scan, classify, and confirm (bd `astro-plan-kyo7.88`).
#[must_use]
pub fn wire_path(path: &Path) -> String {
    let text =
        Utf8Path::from_path(path).map_or_else(|| path.to_string_lossy(), |u| u.as_str().into());
    if cfg!(windows) {
        text.replace('\\', "/")
    } else {
        text.into_owned()
    }
}

/// Compute the [`wire_path`] of `path` relative to `root`.
///
/// Strips the `root` prefix via `strip_prefix`; falls back to `wire_path(path)`
/// if `path` does not start with `root`. Callers must ensure `path` is a
/// descendant of `root` — the fallback is purely defensive.
#[must_use]
pub fn relative_wire_path(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    wire_path(rel)
}

/// The last name in `wire`, the text a [`wire_path`] call produced: what
/// follows its last separator, or all of it when it has none.
///
/// The separators follow [`wire_path`]. On macOS and Linux only `/`
/// separates, so `folder/a\b.fits` names `a\b.fits`. On Windows `\` never
/// belongs to a name, so it separates as well; wire text holds none, but text
/// written into a wire column without passing [`wire_path`] still splits
/// there (bd `astro-plan-3pvvc`).
///
/// Use it on wire text only. A native path splits by its own platform's
/// rules (`Path::file_name`).
#[must_use]
pub fn wire_file_name(wire: &str) -> &str {
    let last = if cfg!(windows) { wire.rfind(['/', '\\']) } else { wire.rfind('/') };
    last.map_or(wire, |idx| &wire[idx + 1..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_directory_is_not_a_link() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_link_or_junction(dir.path()));
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
    fn probe_root_classifies_unwalkable_roots() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(probe_root(dir.path(), false), Ok(()));

        let file = dir.path().join("frame.fits");
        std::fs::write(&file, b"data").unwrap();
        assert_eq!(probe_root(&file, false), Err(RootUnavailable::NotADirectory));

        assert_eq!(probe_root(&dir.path().join("absent"), false), Err(RootUnavailable::Missing));
    }

    #[cfg(unix)]
    #[test]
    fn probe_root_gates_a_symlinked_root_unless_following_is_enabled() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir_all(&real).unwrap();
        let link = dir.path().join("link");
        symlink(&real, &link).unwrap();

        assert_eq!(probe_root(&link, false), Err(RootUnavailable::GatedLink));
        assert_eq!(probe_root(&link, true), Ok(()));

        // A link whose target is gone is Missing, not GatedLink, when following.
        std::fs::remove_dir_all(&real).unwrap();
        assert_eq!(probe_root(&link, true), Err(RootUnavailable::Missing));
    }

    #[test]
    fn a_missing_path_is_not_a_link() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_link_or_junction(&dir.path().join("absent")));
    }

    #[cfg(unix)]
    #[test]
    fn real_files_under_reporting_names_the_unreadable_directory() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let locked = dir.path().join("locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::write(locked.join("hidden.fits"), b"data").unwrap();
        std::fs::write(dir.path().join("top.fits"), b"data").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();

        let readable = std::fs::read_dir(&locked).is_ok();
        let (files, unreadable) = real_files_under_reporting(dir.path(), false);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();

        if readable {
            eprintln!("skipping: this environment can read a mode-000 directory (root?)");
            return;
        }
        assert_eq!(files, vec![dir.path().join("top.fits")]);
        assert_eq!(unreadable, vec![locked]);
    }

    /// Regression (astro-plan-5r71): a directory with read but no search
    /// permission lists its names while every entry's stat fails. The walk
    /// skipped such entries silently, so they read as absent.
    #[cfg(unix)]
    #[test]
    fn real_files_under_reporting_names_entries_it_cannot_stat() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let listable = dir.path().join("listable");
        std::fs::create_dir_all(&listable).unwrap();
        std::fs::write(listable.join("hidden.fits"), b"data").unwrap();
        std::fs::write(dir.path().join("top.fits"), b"data").unwrap();
        std::fs::set_permissions(&listable, std::fs::Permissions::from_mode(0o644)).unwrap();

        let enforced = std::fs::symlink_metadata(listable.join("hidden.fits")).is_err();
        let (files, unreadable) = real_files_under_reporting(dir.path(), false);
        std::fs::set_permissions(&listable, std::fs::Permissions::from_mode(0o755)).unwrap();

        if !enforced {
            eprintln!("skipping: this environment can stat below a mode-644 directory (root?)");
            return;
        }
        assert_eq!(files, vec![dir.path().join("top.fits")]);
        assert_eq!(unreadable, vec![listable.join("hidden.fits")]);
    }

    /// A root that cannot be stat'd (here: its parent has no search
    /// permission) was answered as a gated link, so the walk returned nothing
    /// and every frame below it read as absent. It must be reported instead.
    #[cfg(unix)]
    #[test]
    fn real_files_under_reporting_names_a_root_it_cannot_stat() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().join("share");
        let root = parent.join("root");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("frame.fits"), b"data").unwrap();
        std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o644)).unwrap();

        let enforced = std::fs::symlink_metadata(&root).is_err();
        let walked = real_files_under_reporting(&root, false);
        std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o755)).unwrap();

        if !enforced {
            eprintln!("skipping: this environment can stat below a mode-644 directory (root?)");
            return;
        }
        assert_eq!(walked, (Vec::new(), vec![root]));
    }

    /// A listing that fails part-way may have hidden any entry of that
    /// directory, so the directory itself is unknown; what it did list and
    /// its readable siblings still count.
    #[test]
    fn listing_error_part_way_reports_the_directory() {
        let dir = tempfile::tempdir().unwrap();
        let partial = dir.path().join("partial");
        std::fs::create_dir_all(&partial).unwrap();
        std::fs::write(partial.join("seen.fits"), b"data").unwrap();
        std::fs::write(dir.path().join("top.fits"), b"data").unwrap();

        let (mut files, unreadable) = walk_files(dir.path(), false, |listed: &Path| {
            let mut entries: Vec<io::Result<PathBuf>> =
                fs::read_dir(listed)?.map(|entry| entry.map(|entry| entry.path())).collect();
            if listed == partial {
                entries.push(Err(io::Error::other("readdir failed")));
                entries.push(Ok(partial.join("never-reached.fits")));
            }
            Ok(entries.into_iter())
        });
        files.sort();

        assert_eq!(files, vec![partial.join("seen.fits"), dir.path().join("top.fits")]);
        assert_eq!(unreadable, vec![partial]);
    }

    /// A listed entry whose metadata cannot be read is unknown, never
    /// absent; here it vanished between the listing and the stat.
    #[test]
    fn entry_whose_stat_fails_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("top.fits"), b"data").unwrap();
        let vanished = dir.path().join("vanished.fits");

        let (files, unreadable) = walk_files(dir.path(), false, |listed: &Path| {
            let mut entries: Vec<io::Result<PathBuf>> =
                fs::read_dir(listed)?.map(|entry| entry.map(|entry| entry.path())).collect();
            entries.push(Ok(vanished.clone()));
            Ok(entries.into_iter())
        });

        assert_eq!(files, vec![dir.path().join("top.fits")]);
        assert_eq!(unreadable, vec![vanished]);
    }

    #[test]
    fn real_files_under_reporting_finds_nested_files() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("frame.fits"), b"data").unwrap();
        std::fs::write(dir.path().join("top.fits"), b"data").unwrap();

        let (mut files, unreadable) = real_files_under_reporting(dir.path(), false);
        assert_eq!(unreadable, Vec::<PathBuf>::new(), "the whole tree is readable");
        files.sort();
        assert_eq!(files.len(), 2);
        assert!(files.contains(&nested.join("frame.fits")));
        assert!(files.contains(&dir.path().join("top.fits")));
    }

    #[test]
    fn create_symlink_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.fits");
        let link = dir.path().join("link.fits");
        std::fs::write(&target, b"data").unwrap();

        create_symlink(&target, &link).unwrap();

        assert!(is_link_or_junction(&link));
        assert_eq!(std::fs::read(&link).unwrap(), b"data");
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

        assert!(is_link_or_junction(&link_path));

        // The linked subdirectory must not be descended into.
        let dirs = real_dirs_under(&scan_root, false);
        assert!(!dirs.contains(&link_path));

        let (files, unreadable) = real_files_under_reporting(&scan_root, false);
        assert!(files.is_empty(), "must not see files behind an un-enabled symlink");
        assert_eq!(unreadable, Vec::<PathBuf>::new(), "a gated link is skipped, not unknown");
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
        assert_eq!(dirs, vec![scan_root]);
    }

    /// Windows-only: a directory junction (`mklink /J`) is a reparse point
    /// that is NOT reported by `is_symlink()` on some toolchains — this is
    /// exactly the gap the explicit `FILE_ATTRIBUTE_REPARSE_POINT` check in
    /// [`is_link_or_junction_metadata`] closes. Creates the junction via the
    /// `mklink` shell builtin (no admin privilege required for junctions,
    /// unlike symlinks) rather than adding a dependency for one test.
    #[cfg(windows)]
    #[test]
    fn junction_directory_is_detected_and_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let real_target = dir.path().join("real_target");
        std::fs::create_dir_all(&real_target).unwrap();
        std::fs::write(real_target.join("hidden.fits"), b"data").unwrap();

        let scan_root = dir.path().join("scan_root");
        std::fs::create_dir_all(&scan_root).unwrap();
        let junction_path = scan_root.join("junction_to_target");

        let status = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                junction_path.to_str().unwrap(),
                real_target.to_str().unwrap(),
            ])
            .status()
            .expect("mklink invocation failed");
        assert!(status.success(), "mklink /J failed to create the test junction");

        assert!(is_link_or_junction(&junction_path));

        let dirs = real_dirs_under(&scan_root, false);
        assert!(!dirs.contains(&junction_path));

        let (files, unreadable) = real_files_under_reporting(&scan_root, false);
        assert!(files.is_empty(), "must not see files behind an un-enabled junction");
        assert_eq!(unreadable, Vec::<PathBuf>::new(), "a gated junction is skipped, not unknown");
    }

    #[test]
    fn wire_path_separates_nested_components_with_a_slash() {
        let nested = Path::new("a").join("b").join("c.fits");
        assert_eq!(wire_path(&nested), "a/b/c.fits");

        let root = Path::new("inbox");
        assert_eq!(relative_wire_path(root, &root.join(&nested)), "a/b/c.fits");
    }

    /// On macOS and Linux `\` is an ordinary name character: a file named
    /// `a\b.fits` and the nested `a/b.fits` are different files, so they must
    /// get different wire text, and joining the wire text back onto the root
    /// must name the file or folder it came from (bd `astro-plan-3pvvc`).
    #[cfg(unix)]
    #[test]
    fn wire_path_keeps_a_unix_backslash_name_apart_from_a_nested_path() {
        let root = Path::new("/inbox");
        let cases = [
            (root.join("a\\b.fits"), "a\\b.fits"),
            (root.join("a").join("b.fits"), "a/b.fits"),
            (root.join("c\\d").join("x.fits"), "c\\d/x.fits"),
            (root.join("c").join("d").join("x.fits"), "c/d/x.fits"),
        ];

        for (path, expected) in &cases {
            let wire = relative_wire_path(root, path);
            assert_eq!(wire, *expected);
            assert_eq!(&root.join(&wire), path, "{wire} must join back onto its own path");
            assert_eq!(wire_path(Path::new(&wire)), wire, "{wire} must survive a round trip");
        }
    }

    /// Windows refuses `\` in a name, so there it is only ever a separator and
    /// becomes `/` on the wire.
    #[cfg(windows)]
    #[test]
    fn wire_path_turns_windows_separators_into_slashes() {
        assert_eq!(wire_path(Path::new(r"a\b.fits")), "a/b.fits");
        assert_eq!(wire_path(Path::new(r"a\b/c.fits")), "a/b/c.fits");
        assert_eq!(
            relative_wire_path(Path::new(r"C:\inbox"), Path::new(r"C:\inbox\a\b.fits")),
            "a/b.fits"
        );
    }

    #[test]
    fn wire_file_name_is_the_text_after_the_last_slash() {
        assert_eq!(wire_file_name("masters/darks/300/master.xisf"), "master.xisf");
        assert_eq!(wire_file_name("master.xisf"), "master.xisf");
        assert_eq!(wire_file_name(""), "");
    }

    /// On macOS and Linux a `\` in wire text is part of a name.
    #[cfg(unix)]
    #[test]
    fn wire_file_name_keeps_a_unix_backslash_in_the_name() {
        assert_eq!(wire_file_name("folder/a\\b.fits"), "a\\b.fits");
        assert_eq!(wire_file_name("a\\b.fits"), "a\\b.fits");
        assert_eq!(wire_file_name("c\\d/x.fits"), "x.fits");
    }

    /// On Windows a `\` only ever separates.
    #[cfg(windows)]
    #[test]
    fn wire_file_name_splits_on_a_windows_backslash() {
        assert_eq!(wire_file_name(r"folder\a\b.fits"), "b.fits");
        assert_eq!(wire_file_name(r"c\d/x.fits"), "x.fits");
    }
}
