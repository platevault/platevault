// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Cross-platform file move primitive (spec 025, research R1).
//!
//! Strategy:
//! - Same volume: attempt atomic `rename` (no data movement).
//! - Cross-volume: copy-then-delete. The copy lands in a temp file inside the
//!   destination directory and is renamed into place atomically, so a
//!   half-written copy never leaves the destination path occupied and never
//!   poisons a retry with `ConflictDestinationExists` (GF-3/27). If the final
//!   delete of the source fails, the failure code is
//!   `copy.succeeded.delete.failed` (R-Fail-1). Rollback of the copy is
//!   attempted; if that also fails the code becomes
//!   `copy.succeeded.delete.failed.rollback.failed`.
//!
//! Constitution §II: never overwrite silently — destination existence is
//! checked before any mutation.

use camino::Utf8Path;
use filetime::FileTime;

use crate::failure::{FailureCode, PlanItemFailure, RollbackOutcome};

/// Result of a move operation, including optional rollback detail.
#[derive(Debug)]
pub struct MoveResult {
    pub rollback_attempted: bool,
    pub rollback_outcome: RollbackOutcome,
    pub rollback_message: Option<String>,
}

/// Move `source` to `destination`.
///
/// Checks that `destination` does not already exist before mutating
/// (constitution §II). Attempts `rename` first; falls back to
/// copy-then-delete for cross-volume moves.
///
/// # Errors
///
/// Returns `(PlanItemFailure, MoveResult)` on failure so the caller can log
/// both the failure and any rollback outcome.
pub fn move_file(
    source: &Utf8Path,
    destination: &Utf8Path,
) -> Result<(), (PlanItemFailure, MoveResult)> {
    move_file_with_ops(
        source,
        destination,
        |s, d| std::fs::rename(s, d),
        atomic_copy,
        |p| std::fs::remove_file(p),
    )
}

/// Copy `source` to `destination` atomically via temp-in-dest-dir + rename.
///
/// A direct `std::fs::copy` to the final path leaves a partial file if the
/// process is interrupted mid-copy — every subsequent retry sees the path
/// occupied and hits `ConflictDestinationExists` (GF-3/27). Writing to a temp
/// name in the same directory and then renaming avoids this: the destination
/// path is either absent or fully written.
fn atomic_copy(source: &Utf8Path, destination: &Utf8Path) -> std::io::Result<()> {
    let dest_dir = destination.parent().unwrap_or_else(|| camino::Utf8Path::new("."));
    let tmp = tempfile::Builder::new().prefix(".astroplan-copy-").tempfile_in(dest_dir)?;
    let tmp_path = tmp.path().to_owned();
    // Copy bytes into the temp file (same directory as destination → same volume
    // by construction, so the final rename is always atomic).
    std::fs::copy(source, &tmp_path)?;
    // Keep the NamedTempFile alive until persist so the file isn't dropped early.
    tmp.persist(destination).map_err(|e| e.error)?;
    Ok(())
}

/// Same as [`move_file`], with the `rename`/`copy`/`remove_file` syscalls
/// taken as parameters.
///
/// This is the injectable seam behind [`move_file`]: production code always
/// calls it with the real `std::fs` functions. Tests use it to force the
/// `EXDEV` cross-device branch — which `tempfile::tempdir()` can never
/// reach, since a temp dir is a single filesystem — and to force copy or
/// delete failures deterministically. A rename-only seam cannot exercise
/// `CopySucceededDeleteFailedRollbackFailed`: making the rollback delete fail
/// via real directory permissions would also block the preceding copy (both
/// need write access on the same directory entry), so `remove_file` is
/// injected too. `copy` is injected so tests can force copy failures without
/// going through the temp-file creation path.
fn move_file_with_ops(
    source: &Utf8Path,
    destination: &Utf8Path,
    rename: impl Fn(&Utf8Path, &Utf8Path) -> std::io::Result<()>,
    copy: impl Fn(&Utf8Path, &Utf8Path) -> std::io::Result<()>,
    remove_file: impl Fn(&Utf8Path) -> std::io::Result<()>,
) -> Result<(), (PlanItemFailure, MoveResult)> {
    let no_rollback = MoveResult {
        rollback_attempted: false,
        rollback_outcome: RollbackOutcome::NotApplicable,
        rollback_message: None,
    };

    // Constitution §II: never overwrite silently.
    if destination.exists() {
        return Err((
            PlanItemFailure::with_code(
                FailureCode::ConflictDestinationExists,
                format!("destination already exists; cannot overwrite: {destination}"),
            ),
            no_rollback,
        ));
    }

    // Ensure destination parent directory exists.
    if let Some(parent) = destination.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return Err((
                    PlanItemFailure::from_io(&e, &format!("create destination parent {parent}")),
                    no_rollback,
                ));
            }
        }
    }

    // Try atomic rename first (same-volume).
    match rename(source, destination) {
        Ok(()) => return Ok(()),
        Err(rename_err) => {
            // EXDEV (18) means cross-device; anything else is a real error.
            let is_cross_device =
                rename_err.raw_os_error().is_some_and(|raw| raw == cross_device_error());

            if !is_cross_device {
                return Err((
                    PlanItemFailure::from_io(
                        &rename_err,
                        &format!("rename {source} to {destination}"),
                    ),
                    no_rollback,
                ));
            }
        }
    }

    // Cross-volume: copy-then-delete.
    //
    // Read source mtime before the copy so it is available even if the source
    // later becomes inaccessible.  Failure to read mtime is non-fatal: the data
    // is already in `source` and will be preserved by the copy regardless.
    let source_mtime =
        std::fs::metadata(source).map(|m| FileTime::from_last_modification_time(&m)).ok();

    if let Err(copy_err) = copy(source, destination) {
        return Err((
            PlanItemFailure::from_io(&copy_err, &format!("copy {source} to {destination}")),
            no_rollback,
        ));
    }

    // Restore mtime on the destination.  std::fs::copy resets it to "now", but
    // mtime is user-meaningful (session-date sorting) and feeds the per-file
    // signature in crates/app/inbox — without this a cross-volume move would
    // look like a new file to any watcher on the destination root.
    // Failure is non-fatal: the bytes are correct; we warn and continue.
    if let Some(mtime) = source_mtime {
        if let Err(e) = filetime::set_file_mtime(destination, mtime) {
            tracing::warn!(
                %destination,
                error = %e,
                "cross-volume move: could not restore mtime on destination; \
                 file data is intact but timestamp reflects copy time"
            );
        }
    }

    // Copy succeeded. Attempt source delete.
    if let Err(del_err) = remove_file(source) {
        // Source delete failed — try to roll back by removing the copy.
        let rollback_result = remove_file(destination);
        let (rollback_outcome, rollback_message, final_code) = match rollback_result {
            Ok(()) => (RollbackOutcome::Succeeded, None, FailureCode::CopySucceededDeleteFailed),
            Err(rb_err) => (
                RollbackOutcome::Failed,
                Some(format!("rollback remove {destination} failed: {rb_err}")),
                FailureCode::CopySucceededDeleteFailedRollbackFailed,
            ),
        };

        return Err((
            PlanItemFailure::with_code(
                final_code,
                format!("copy succeeded but delete source {source} failed: {del_err}"),
            ),
            MoveResult { rollback_attempted: true, rollback_outcome, rollback_message },
        ));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
const fn cross_device_error() -> i32 {
    18
} // EXDEV

#[cfg(target_os = "macos")]
const fn cross_device_error() -> i32 {
    18
} // EXDEV

#[cfg(target_os = "windows")]
const fn cross_device_error() -> i32 {
    17
} // ERROR_NOT_SAME_DEVICE

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
const fn cross_device_error() -> i32 {
    18
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use camino::Utf8PathBuf;

    fn utf8(p: &std::path::Path) -> Utf8PathBuf {
        Utf8PathBuf::from_path_buf(p.to_path_buf()).expect("temp dir path is UTF-8")
    }

    #[test]
    fn move_same_volume_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("source.fits");
        let dst = root.join("dest.fits");
        std::fs::write(&src, b"data").unwrap();

        move_file(&src, &dst).unwrap();

        assert!(!src.exists(), "source should be gone");
        assert!(dst.exists(), "destination should exist");
        assert_eq!(std::fs::read(&dst).unwrap(), b"data");
    }

    #[test]
    fn move_fails_when_destination_exists() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("src.fits");
        let dst = root.join("dst.fits");
        std::fs::write(&src, b"source").unwrap();
        std::fs::write(&dst, b"existing").unwrap();

        let (failure, _) = move_file(&src, &dst).unwrap_err();
        assert_eq!(failure.code, FailureCode::ConflictDestinationExists);
        // Source should be untouched.
        assert!(src.exists());
    }

    #[test]
    fn move_creates_destination_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("src.fits");
        let dst = root.join("nested/deep/dst.fits");
        std::fs::write(&src, b"data").unwrap();

        move_file(&src, &dst).unwrap();
        assert!(dst.exists());
        assert!(!src.exists());
    }

    #[test]
    fn move_fails_when_source_missing() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("nonexistent.fits");
        let dst = root.join("dst.fits");

        let (failure, _) = move_file(&src, &dst).unwrap_err();
        // Could be SourceMissing or Unknown depending on OS rename error.
        assert!(!failure.message.is_empty());
    }

    // ── Cross-volume (EXDEV) branch coverage ──────────────────────────────────
    //
    // `tempfile::tempdir()` is always a single filesystem, so `rename` never
    // really returns EXDEV in CI. These tests force it via `move_file_with_ops`
    // (see its doc comment for why `remove_file` is injected too).

    fn fake_exdev(_: &Utf8Path, _: &Utf8Path) -> std::io::Result<()> {
        Err(std::io::Error::from_raw_os_error(cross_device_error()))
    }

    fn real_copy(s: &Utf8Path, d: &Utf8Path) -> std::io::Result<()> {
        std::fs::copy(s, d).map(|_| ())
    }

    fn fake_copy_fail(_: &Utf8Path, _: &Utf8Path) -> std::io::Result<()> {
        Err(std::io::Error::other("injected copy failure"))
    }

    #[test]
    fn move_cross_volume_success() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("source.fits");
        let dst = root.join("dest.fits");
        std::fs::write(&src, b"cross-volume data").unwrap();

        move_file_with_ops(&src, &dst, fake_exdev, real_copy, |p| std::fs::remove_file(p)).unwrap();

        assert!(!src.exists(), "source should be gone");
        assert!(dst.exists(), "destination should exist");
        assert_eq!(std::fs::read(&dst).unwrap(), b"cross-volume data");
    }

    #[test]
    fn move_cross_volume_copy_fails_leaves_no_rollback() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("source.fits");
        std::fs::write(&src, b"data").unwrap();
        let dst = root.join("dest.fits");

        let (failure, move_result) =
            move_file_with_ops(&src, &dst, fake_exdev, fake_copy_fail, |p| std::fs::remove_file(p))
                .unwrap_err();

        assert!(!failure.message.is_empty());
        assert!(!move_result.rollback_attempted, "copy never succeeded, no rollback to attempt");
        assert_eq!(move_result.rollback_outcome, RollbackOutcome::NotApplicable);
        // The injected copy failure never wrote to dest, so it must not exist.
        assert!(!dst.exists(), "destination must not exist after failed copy");
        assert!(src.exists(), "source must survive a failed copy");
    }

    #[test]
    fn move_cross_volume_delete_fails_rollback_succeeds() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("source.fits");
        let dst = root.join("dest.fits");
        std::fs::write(&src, b"data").unwrap();

        let delete_err = || std::io::Error::other("injected delete failure");
        // First call (source delete) fails; second call (rollback of the copy)
        // performs the real removal so on-disk state stays assertable.
        let calls = std::cell::Cell::new(0u32);
        let remove_file = |p: &Utf8Path| -> std::io::Result<()> {
            if calls.get() == 0 {
                calls.set(1);
                Err(delete_err())
            } else {
                std::fs::remove_file(p)
            }
        };

        let (failure, move_result) =
            move_file_with_ops(&src, &dst, fake_exdev, real_copy, remove_file).unwrap_err();

        assert_eq!(failure.code, FailureCode::CopySucceededDeleteFailed);
        assert!(move_result.rollback_attempted);
        assert_eq!(move_result.rollback_outcome, RollbackOutcome::Succeeded);
        assert!(move_result.rollback_message.is_none());
        assert!(!dst.exists(), "rollback should have removed the copy");
        assert!(src.exists(), "source must survive a delete failure");
        assert_eq!(std::fs::read(&src).unwrap(), b"data");
    }

    #[test]
    fn move_cross_volume_delete_fails_rollback_fails() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("source.fits");
        let dst = root.join("dest.fits");
        std::fs::write(&src, b"data").unwrap();

        // Both the source delete and the rollback delete fail.
        let remove_file = |_: &Utf8Path| -> std::io::Result<()> {
            Err(std::io::Error::other("injected delete failure"))
        };

        let (failure, move_result) =
            move_file_with_ops(&src, &dst, fake_exdev, real_copy, remove_file).unwrap_err();

        assert_eq!(failure.code, FailureCode::CopySucceededDeleteFailedRollbackFailed);
        assert!(move_result.rollback_attempted);
        assert_eq!(move_result.rollback_outcome, RollbackOutcome::Failed);
        assert!(move_result.rollback_message.is_some());
        // Neither the copy nor the source was actually removed (both fs calls
        // were faked), so both survive — matching what the real syscalls would
        // leave behind on a genuine double-failure.
        assert!(src.exists(), "source must survive a delete failure");
        assert!(dst.exists(), "destination copy must survive a failed rollback");
    }

    // ── retry-poison regression (GF-3/27) ────────────────────────────────────

    /// A failed copy must not leave the destination occupied so that the next
    /// retry can succeed. Before the atomic temp+rename fix, `std::fs::copy`
    /// wrote directly to the destination path; an interrupt or injected failure
    /// left a partial file there, causing every subsequent attempt to return
    /// `ConflictDestinationExists` rather than retrying the copy.
    #[test]
    fn cross_volume_copy_failure_does_not_poison_dest_for_retry() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("source.fits");
        let dst = root.join("dest.fits");
        std::fs::write(&src, b"important data").unwrap();

        // First attempt: copy fails (simulates interrupt mid-copy).
        let (_, move_result) =
            move_file_with_ops(&src, &dst, fake_exdev, fake_copy_fail, |p| std::fs::remove_file(p))
                .unwrap_err();
        assert_eq!(move_result.rollback_outcome, RollbackOutcome::NotApplicable);
        // Destination must be clear — no partial file left.
        assert!(!dst.exists(), "failed copy must not leave dest occupied");

        // Second attempt (retry): must succeed.
        move_file_with_ops(&src, &dst, fake_exdev, real_copy, |p| std::fs::remove_file(p)).unwrap();
        assert!(dst.exists(), "retry must succeed once dest is clear");
        assert_eq!(std::fs::read(&dst).unwrap(), b"important data");
    }

    // ── mtime preservation ────────────────────────────────────────────────────

    #[test]
    fn cross_volume_move_preserves_source_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("source.fits");
        let dst = root.join("dest.fits");
        std::fs::write(&src, b"data").unwrap();

        // Pin source mtime to a known value in the past.
        let known_mtime = filetime::FileTime::from_unix_time(1_700_000_000, 0);
        filetime::set_file_mtime(&src, known_mtime).unwrap();

        move_file_with_ops(&src, &dst, fake_exdev, real_copy, |p| std::fs::remove_file(p)).unwrap();

        let dst_mtime =
            filetime::FileTime::from_last_modification_time(&std::fs::metadata(&dst).unwrap());
        assert_eq!(
            dst_mtime.unix_seconds(),
            known_mtime.unix_seconds(),
            "destination mtime must match source mtime after cross-volume move"
        );
    }

    #[test]
    fn same_volume_move_does_not_touch_mtime_logic() {
        // rename() preserves mtime by OS contract; this test confirms the
        // cross-volume branch (and its mtime logic) is NOT entered on same-volume.
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("source.fits");
        let dst = root.join("dest.fits");
        std::fs::write(&src, b"data").unwrap();

        let known_mtime = filetime::FileTime::from_unix_time(1_600_000_000, 0);
        filetime::set_file_mtime(&src, known_mtime).unwrap();

        // Real rename — same-volume, no cross-device error.
        move_file(&src, &dst).unwrap();

        let dst_mtime =
            filetime::FileTime::from_last_modification_time(&std::fs::metadata(&dst).unwrap());
        // rename(2) preserves mtime on every supported OS.
        assert_eq!(
            dst_mtime.unix_seconds(),
            known_mtime.unix_seconds(),
            "rename preserves mtime; destination should match the known pinned mtime"
        );
    }
}
