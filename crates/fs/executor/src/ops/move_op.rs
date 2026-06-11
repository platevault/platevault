//! Cross-platform file move primitive (spec 025, research R1).
//!
//! Strategy:
//! - Same volume: attempt atomic `rename` (no data movement).
//! - Cross-volume: copy-then-delete. If the delete fails, the source is
//!   left intact and the failure code is `copy.succeeded.delete.failed`
//!   (R-Fail-1). Rollback of the copy is attempted; if that also fails the
//!   code becomes `copy.succeeded.delete.failed.rollback.failed`.
//!
//! Constitution §II: never overwrite silently — destination existence is
//! checked before any mutation.

use std::path::Path;

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
pub fn move_file(source: &Path, destination: &Path) -> Result<(), (PlanItemFailure, MoveResult)> {
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
                format!("destination already exists; cannot overwrite: {}", destination.display()),
            ),
            no_rollback,
        ));
    }

    // Ensure destination parent directory exists.
    if let Some(parent) = destination.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return Err((
                    PlanItemFailure::from_io(
                        &e,
                        &format!("create destination parent {}", parent.display()),
                    ),
                    no_rollback,
                ));
            }
        }
    }

    // Try atomic rename first (same-volume).
    match std::fs::rename(source, destination) {
        Ok(()) => return Ok(()),
        Err(rename_err) => {
            // EXDEV (18) means cross-device; anything else is a real error.
            let is_cross_device =
                rename_err.raw_os_error().is_some_and(|raw| raw == cross_device_error());

            if !is_cross_device {
                return Err((
                    PlanItemFailure::from_io(
                        &rename_err,
                        &format!("rename {} to {}", source.display(), destination.display()),
                    ),
                    no_rollback,
                ));
            }
        }
    }

    // Cross-volume: copy-then-delete.
    if let Err(copy_err) = std::fs::copy(source, destination) {
        return Err((
            PlanItemFailure::from_io(
                &copy_err,
                &format!("copy {} to {}", source.display(), destination.display()),
            ),
            no_rollback,
        ));
    }

    // Copy succeeded. Attempt source delete.
    if let Err(del_err) = std::fs::remove_file(source) {
        // Source delete failed — try to roll back by removing the copy.
        let rollback_result = std::fs::remove_file(destination);
        let (rollback_outcome, rollback_message, final_code) = match rollback_result {
            Ok(()) => (RollbackOutcome::Succeeded, None, FailureCode::CopySucceededDeleteFailed),
            Err(rb_err) => (
                RollbackOutcome::Failed,
                Some(format!("rollback remove {} failed: {rb_err}", destination.display())),
                FailureCode::CopySucceededDeleteFailedRollbackFailed,
            ),
        };

        return Err((
            PlanItemFailure::with_code(
                final_code,
                format!("copy succeeded but delete source {} failed: {del_err}", source.display()),
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

    #[test]
    fn move_same_volume_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("source.fits");
        let dst = dir.path().join("dest.fits");
        std::fs::write(&src, b"data").unwrap();

        move_file(&src, &dst).unwrap();

        assert!(!src.exists(), "source should be gone");
        assert!(dst.exists(), "destination should exist");
        assert_eq!(std::fs::read(&dst).unwrap(), b"data");
    }

    #[test]
    fn move_fails_when_destination_exists() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.fits");
        let dst = dir.path().join("dst.fits");
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
        let src = dir.path().join("src.fits");
        let dst = dir.path().join("nested/deep/dst.fits");
        std::fs::write(&src, b"data").unwrap();

        move_file(&src, &dst).unwrap();
        assert!(dst.exists());
        assert!(!src.exists());
    }

    #[test]
    fn move_fails_when_source_missing() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("nonexistent.fits");
        let dst = dir.path().join("dst.fits");

        let (failure, _) = move_file(&src, &dst).unwrap_err();
        // Could be SourceMissing or Unknown depending on OS rename error.
        assert!(!failure.message.is_empty());
    }
}
