//! Raw-frame reconcile walker skeleton (spec 048 T003).
//!
//! Mirrors the shape of `crates/workflow/artifacts/reconciler.rs`: a pure,
//! side-effect-free pass that walks a library root and diffs the recorded
//! `file_record` rows for that root against what is actually on disk. It
//! returns a report describing state transitions; it never touches the
//! database or the filesystem beyond read-only `stat`/`readdir` calls, and it
//! never mutates a file (Constitution II, spec 048 FR-008/INV-2).
//!
//! This module intentionally does **not** wire up any of the triggers
//! (live watch, scheduled, on-open, on-demand — spec 048 US2 T020-T026); it
//! is the walk + diff primitive those triggers will call into.
//!
//! Symlink/junction gating (spec 048 T004/R6) is applied via
//! [`fs_pathsafe::real_files_under`] so a linked subtree is never
//! traversed unless the root has explicitly enabled it.

use std::path::{Path, PathBuf};

use fs_pathsafe::real_files_under;

/// One inventoried frame's identity + expected size, as recorded in
/// `file_record` for the root being reconciled.
#[derive(Clone, Debug, PartialEq)]
pub struct KnownFrame {
    /// `file_record.id`.
    pub id: String,
    /// Path relative to the library root — the `file_record.relative_path`
    /// identity key (INV-1).
    pub relative_path: String,
    /// Previously recorded size. `0` marks a not-yet-backfilled record
    /// (spec 048 R7 / T015).
    pub recorded_size_bytes: i64,
}

/// Outcome of comparing one [`KnownFrame`] against disk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FrameOutcome {
    /// Still present at its recorded path. Carries the real on-disk size so
    /// the caller can backfill/correct `size_bytes` (FR-006/FR-012/T015)
    /// without a zero placeholder ever being mistaken for "missing".
    Present { real_size_bytes: i64 },
    /// No longer present at its recorded path (FR-007). The caller decides
    /// how to apply this per the root's `reconcile.mode` (US2 T021) — this
    /// module only reports the fact.
    Missing,
}

/// One row's outcome, paired back with its `file_record.id` for the caller.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameReconcileEntry {
    pub id: String,
    pub relative_path: String,
    pub outcome: FrameOutcome,
}

/// Result of a single reconcile pass over a root.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ReconcileReport {
    pub entries: Vec<FrameReconcileEntry>,
}

impl ReconcileReport {
    /// Entries that are still present on disk.
    #[must_use = "iterate the returned entries"]
    pub fn present(&self) -> impl Iterator<Item = &FrameReconcileEntry> {
        self.entries.iter().filter(|e| matches!(e.outcome, FrameOutcome::Present { .. }))
    }

    /// Entries no longer found at their recorded path.
    #[must_use = "iterate the returned entries"]
    pub fn missing(&self) -> impl Iterator<Item = &FrameReconcileEntry> {
        self.entries.iter().filter(|e| matches!(e.outcome, FrameOutcome::Missing))
    }

    /// Present entries whose real on-disk size differs from what was
    /// recorded — the backfill/correction set (spec 048 FR-006, T015).
    #[must_use = "iterate the returned corrections"]
    pub fn size_corrections(&self) -> impl Iterator<Item = (&FrameReconcileEntry, i64)> {
        self.entries.iter().filter_map(|e| match e.outcome {
            FrameOutcome::Present { real_size_bytes } => Some((e, real_size_bytes)),
            FrameOutcome::Missing => None,
        })
    }
}

/// Walk `root_path` and diff `known` (the root's recorded `file_record` rows)
/// against disk.
///
/// This function performs **read-only** filesystem access (`stat`/`readdir`
/// via [`fs_pathsafe::real_files_under`]) and never mutates a file.
/// Symlinked/junction subtrees are never traversed unless
/// `follow_symlinks` is `true` for this root (spec 048 R6/FR-017).
///
/// A frame moved to a different path under the same root is **not**
/// auto-followed (spec 048 R3/FR-012a): it is reported `Missing` at its old
/// path, exactly like a deleted frame. The file at its new path is simply
/// not inventoried by this pass (inventory is only written at plan apply).
///
/// # Errors
///
/// This never fails for a missing/unreadable root — an unreadable root
/// yields every known frame as `Missing` (nothing found on disk), matching
/// the "removable drive absent" edge case (frames are reported unavailable,
/// never treated as permanently deleted).
#[must_use]
pub fn reconcile_root(
    root_path: &Path,
    known: &[KnownFrame],
    follow_symlinks: bool,
) -> ReconcileReport {
    let disk_files: Vec<PathBuf> = real_files_under(root_path, follow_symlinks);

    let entries = known
        .iter()
        .map(|frame| {
            let candidate = root_path.join(&frame.relative_path);
            let outcome = if disk_files.iter().any(|p| paths_match(p, &candidate)) {
                let real_size_bytes =
                    std::fs::metadata(&candidate).map(|m| i64::try_from(m.len()).unwrap_or(0));
                match real_size_bytes {
                    Ok(size) => FrameOutcome::Present { real_size_bytes: size },
                    // Race: file vanished between the directory listing and
                    // the stat call — treat as missing rather than guessing.
                    Err(_) => FrameOutcome::Missing,
                }
            } else {
                FrameOutcome::Missing
            };
            FrameReconcileEntry {
                id: frame.id.clone(),
                relative_path: frame.relative_path.clone(),
                outcome,
            }
        })
        .collect();

    ReconcileReport { entries }
}

/// Compare two paths for equality after best-effort canonicalisation.
///
/// `real_files_under` yields paths built by walking `read_dir`, so they are
/// already normalised the same way as `root_path.join(relative_path)` on
/// POSIX; on Windows, path component casing/separators can differ, so this
/// falls back to a component-wise comparison rather than raw string equality.
fn paths_match(a: &Path, b: &Path) -> bool {
    a == b || a.components().eq(b.components())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(id: &str, relative_path: &str, recorded_size_bytes: i64) -> KnownFrame {
        KnownFrame {
            id: id.to_owned(),
            relative_path: relative_path.to_owned(),
            recorded_size_bytes,
        }
    }

    #[test]
    fn present_frame_reports_real_size() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("light_001.fits"), vec![0u8; 4096]).unwrap();

        let report = reconcile_root(dir.path(), &[known("f1", "light_001.fits", 0)], false);

        assert_eq!(report.entries.len(), 1);
        assert_eq!(report.entries[0].outcome, FrameOutcome::Present { real_size_bytes: 4096 });
    }

    #[test]
    fn deleted_frame_reports_missing() {
        let dir = tempfile::tempdir().unwrap();
        // Nothing written to disk — "f1" was deleted outside the app.
        let report = reconcile_root(dir.path(), &[known("f1", "light_001.fits", 4096)], false);

        assert_eq!(report.entries[0].outcome, FrameOutcome::Missing);
        assert_eq!(report.missing().count(), 1);
        assert_eq!(report.present().count(), 0);
    }

    #[test]
    fn moved_frame_is_reported_missing_at_old_path_never_followed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("moved_to")).unwrap();
        // File now lives at a different relative path under the same root.
        std::fs::write(dir.path().join("moved_to").join("light_001.fits"), b"data").unwrap();

        let report = reconcile_root(dir.path(), &[known("f1", "light_001.fits", 4096)], false);

        // Reported missing at the recorded (old) path — never auto-followed (R3/FR-012a).
        assert_eq!(report.entries[0].outcome, FrameOutcome::Missing);
    }

    #[test]
    fn size_change_is_reported_present_with_corrected_size_not_missing() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("light_001.fits"), vec![0u8; 8192]).unwrap();

        // Recorded size (4096) differs from the real on-disk size (8192).
        let report = reconcile_root(dir.path(), &[known("f1", "light_001.fits", 4096)], false);

        let corrections: Vec<_> = report.size_corrections().collect();
        assert_eq!(corrections.len(), 1);
        assert_eq!(corrections[0].1, 8192);
    }

    #[test]
    fn zero_byte_recorded_size_is_backfilled_to_real_size() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("dark_001.fits"), vec![0u8; 2048]).unwrap();

        // Historical row recorded with the size_bytes = 0 placeholder (pre-048).
        let report = reconcile_root(dir.path(), &[known("f1", "dark_001.fits", 0)], false);

        assert_eq!(report.entries[0].outcome, FrameOutcome::Present { real_size_bytes: 2048 });
    }

    #[test]
    fn unreadable_root_reports_every_known_frame_missing_not_deleted() {
        // A root that doesn't exist (e.g. a disconnected removable drive) —
        // frames must be reported unavailable/missing, never as an error that
        // could be mistaken for "permanently deleted".
        let missing_root = Path::new("/definitely/does/not/exist/spec-048");
        let report = reconcile_root(
            missing_root,
            &[known("f1", "a.fits", 100), known("f2", "b.fits", 0)],
            false,
        );

        assert_eq!(report.entries.len(), 2);
        assert!(report.entries.iter().all(|e| e.outcome == FrameOutcome::Missing));
    }

    #[cfg(unix)]
    #[test]
    fn frame_reachable_only_via_unenabled_symlink_is_reported_missing() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let real_target = dir.path().join("real_target");
        std::fs::create_dir_all(&real_target).unwrap();
        std::fs::write(real_target.join("flat_001.fits"), b"data").unwrap();

        let scan_root = dir.path().join("scan_root");
        std::fs::create_dir_all(&scan_root).unwrap();
        symlink(&real_target, scan_root.join("linked")).unwrap();

        let report = reconcile_root(&scan_root, &[known("f1", "linked/flat_001.fits", 4)], false);

        assert_eq!(report.entries[0].outcome, FrameOutcome::Missing);
    }
}
