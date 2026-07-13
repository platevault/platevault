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

use camino::Utf8Path;

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
        |p| std::fs::remove_file(p),
    )
}

/// Same as [`move_file`], with the `rename`/`remove_file` syscalls taken as
/// parameters.
///
/// This is the injectable seam behind [`move_file`]: production code always
/// calls it with the real `std::fs` functions. Tests use it to force the
/// `EXDEV` cross-device branch — which `tempfile::tempdir()` can never
/// reach, since a temp dir is a single filesystem — and to force delete
/// failures deterministically for the rollback branches. A rename-only seam
/// cannot exercise `CopySucceededDeleteFailedRollbackFailed`: making the
/// rollback delete fail via real directory permissions would also block the
/// preceding copy (both need write access on the same directory entry), so
/// `remove_file` is injected too.
fn move_file_with_ops(
    source: &Utf8Path,
    destination: &Utf8Path,
    rename: impl Fn(&Utf8Path, &Utf8Path) -> std::io::Result<()>,
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
    if let Err(copy_err) = std::fs::copy(source, destination) {
        return Err((
            PlanItemFailure::from_io(&copy_err, &format!("copy {source} to {destination}")),
            no_rollback,
        ));
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

    #[test]
    fn move_cross_volume_success() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        let src = root.join("source.fits");
        let dst = root.join("dest.fits");
        std::fs::write(&src, b"cross-volume data").unwrap();

        move_file_with_ops(&src, &dst, fake_exdev, |p| std::fs::remove_file(p)).unwrap();

        assert!(!src.exists(), "source should be gone");
        assert!(dst.exists(), "destination should exist");
        assert_eq!(std::fs::read(&dst).unwrap(), b"cross-volume data");
    }

    #[test]
    fn move_cross_volume_copy_fails_leaves_no_rollback() {
        let dir = tempfile::tempdir().unwrap();
        let root = utf8(dir.path());
        // Source is a directory: `std::fs::copy` fails to open it for reading.
        let src = root.join("source_dir");
        std::fs::create_dir_all(&src).unwrap();
        let dst = root.join("dest.fits");

        let (failure, move_result) =
            move_file_with_ops(&src, &dst, fake_exdev, |p| std::fs::remove_file(p)).unwrap_err();

        // The io::Error kind for "copy a directory" differs across OSes (e.g.
        // InvalidInput on Unix vs. PermissionDenied on Windows), so the
        // resulting FailureCode is not pinned here — the invariant under test
        // is that the failure is reported and no rollback residue is left.
        assert!(!failure.message.is_empty());
        assert!(!move_result.rollback_attempted, "copy never succeeded, no rollback to attempt");
        assert_eq!(move_result.rollback_outcome, RollbackOutcome::NotApplicable);
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
            move_file_with_ops(&src, &dst, fake_exdev, remove_file).unwrap_err();

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
            move_file_with_ops(&src, &dst, fake_exdev, remove_file).unwrap_err();

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
}
