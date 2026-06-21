//! Permanent delete primitive (spec 025, FR-004, FR-017).
//!
//! Requires `confirm_required = true` on the plan item. If the caller does
//! not pass the destructive confirmation flag, the operation fails with
//! `protected.source`.
//!
//! Constitution §II: permanent delete is always behind a confirmation gate.
//! Rollback is not applicable for permanent delete.

use camino::Utf8Path;

use crate::failure::{FailureCode, PlanItemFailure, RollbackOutcome};

/// Result of a delete operation.
#[derive(Debug)]
pub struct DeleteResult {
    pub rollback_attempted: bool,
    pub rollback_outcome: RollbackOutcome,
}

/// Permanently delete `path`.
///
/// `confirm_required` must be `true` (from `plan_items.protection` or the
/// item's `confirm_required` flag). If it is false the operation returns
/// `protected.source` without touching the filesystem.
///
/// # Errors
///
/// Returns `(PlanItemFailure, DeleteResult)` on failure.
pub fn delete_file(
    path: &Utf8Path,
    confirm_required: bool,
) -> Result<(), (PlanItemFailure, DeleteResult)> {
    let no_rollback = DeleteResult {
        rollback_attempted: false,
        rollback_outcome: RollbackOutcome::NotApplicable,
    };

    if !confirm_required {
        return Err((
            PlanItemFailure::with_code(
                FailureCode::ProtectedSource,
                format!("permanent delete requires explicit confirmation; blocked: {path}"),
            ),
            no_rollback,
        ));
    }

    std::fs::remove_file(path)
        .map_err(|e| (PlanItemFailure::from_io(&e, &format!("delete {path}")), no_rollback))
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
    fn delete_fails_without_confirmation() {
        let dir = tempfile::tempdir().unwrap();
        let file = utf8(dir.path()).join("important.fits");
        std::fs::write(&file, b"precious").unwrap();

        let (failure, _) = delete_file(&file, false).unwrap_err();
        assert_eq!(failure.code, FailureCode::ProtectedSource);
        // File must still exist.
        assert!(file.exists());
    }

    #[test]
    fn delete_with_confirmation_removes_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = utf8(dir.path()).join("to_delete.fits");
        std::fs::write(&file, b"data").unwrap();

        delete_file(&file, true).unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn delete_missing_file_returns_error() {
        let result = delete_file(Utf8Path::new("/nonexistent/file.fits"), true);
        assert!(result.is_err());
    }
}
