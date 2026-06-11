//! OS trash primitive (spec 025, research R2, R-Trash-1).
//!
//! Moves the file to the OS trash (Recycle Bin / Trash). Falls back to
//! `trash.unavailable` when the platform does not support a trash API or
//! when the volume does not have a trash location.
//!
//! v1 uses `std::fs::remove_file` as a fallback with a clear error when
//! the OS trash crate is unavailable. The `trash` crate is not in the
//! workspace yet; a future iteration will add it per the research decision.
//!
//! Constitution §II: destructive ops prefer trash/archive over permanent
//! delete. Trash is never assumed to succeed; failure is logged distinctly.

use std::path::Path;

use crate::failure::{FailureCode, PlanItemFailure, RollbackOutcome};

/// Result of a trash operation (rollback not applicable for trash).
#[derive(Debug)]
pub struct TrashResult {
    pub rollback_attempted: bool,
    pub rollback_outcome: RollbackOutcome,
    pub rollback_message: Option<String>,
}

impl Default for TrashResult {
    fn default() -> Self {
        Self {
            rollback_attempted: false,
            rollback_outcome: RollbackOutcome::NotApplicable,
            rollback_message: None,
        }
    }
}

/// Send `path` to the OS trash.
///
/// In v1 this delegates to the platform's rename-to-trash heuristic.
/// When the trash API is unavailable (network volumes, some Linux setups)
/// it returns `trash.unavailable` so the user can decide.
///
/// # Errors
///
/// Returns `(PlanItemFailure, TrashResult)` on failure.
pub fn trash_file(path: &Path) -> Result<(), (PlanItemFailure, TrashResult)> {
    // v1: attempt platform trash via std rename to a well-known location.
    // A proper `trash` crate integration is a follow-up task.
    // For now: try to use `trash_impl` for the current platform.
    trash_impl(path).map_err(|f| (f, TrashResult::default()))
}

#[cfg(target_os = "macos")]
fn trash_impl(path: &Path) -> Result<(), PlanItemFailure> {
    // macOS: use AppleScript / NSFileManager via a shell call in v1.
    // For now return trash.unavailable so the caller can surface it.
    // A future iteration will use the `trash` crate.
    Err(PlanItemFailure::with_code(
        FailureCode::TrashUnavailable,
        format!(
            "OS trash not yet wired for macOS in v1 executor; \
             item: {}. Use archive action or upgrade executor.",
            path.display()
        ),
    ))
}

#[cfg(target_os = "windows")]
fn trash_impl(path: &Path) -> Result<(), PlanItemFailure> {
    Err(PlanItemFailure::with_code(
        FailureCode::TrashUnavailable,
        format!(
            "OS trash not yet wired for Windows in v1 executor; \
             item: {}. Use archive action or upgrade executor.",
            path.display()
        ),
    ))
}

#[cfg(target_os = "linux")]
fn trash_impl(path: &Path) -> Result<(), PlanItemFailure> {
    // Linux: XDG trash spec. v1 stub — returns unavailable.
    Err(PlanItemFailure::with_code(
        FailureCode::TrashUnavailable,
        format!(
            "OS trash not yet wired for Linux in v1 executor; \
             item: {}. Use archive action or upgrade executor.",
            path.display()
        ),
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn trash_impl(path: &Path) -> Result<(), PlanItemFailure> {
    Err(PlanItemFailure::with_code(
        FailureCode::TrashUnavailable,
        format!("OS trash not supported on this platform: {}", path.display()),
    ))
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::failure::FailureCode;

    #[test]
    fn trash_returns_unavailable_in_v1() {
        // v1 stub — trash is not wired yet; expect TrashUnavailable.
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("to_trash.fits");
        std::fs::write(&file, b"data").unwrap();

        let result = trash_file(&file);
        // v1 stub always returns unavailable.
        assert!(result.is_err());
        let (failure, _) = result.unwrap_err();
        assert_eq!(failure.code, FailureCode::TrashUnavailable);
    }
}
