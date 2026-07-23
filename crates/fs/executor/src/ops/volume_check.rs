// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Proactive volume/disk-space probes for pause-condition re-validation
//! (R-Pause-1 resume, spec 025 T049/T050).
//!
//! Unlike the reactive path in `failure.rs` (which only classifies
//! `volume.unavailable`/`disk.full` after an OS error surfaces from a real
//! mutation attempt), these functions actively probe the filesystem so
//! `resume_plan` can refuse to resume while the condition is still present
//! instead of silently flipping state back to `applying` (constitution §II).

use camino::Utf8Path;

use crate::failure::{FailureCode, PlanItemFailure};

/// Whether `path` is currently accessible (a plain existence/readability
/// probe, platform-agnostic by construction — `std::fs::metadata` fails
/// with the same "not found" outcome on every platform for a nonexistent
/// path).
///
/// This is checked *before* `fs4::available_space` below because that call
/// alone is not a reliable "does this path exist" proxy across platforms:
/// on Windows, `GetDiskFreeSpaceExW` only needs to identify the *volume* a
/// path would live on and commonly succeeds even when the specific (missing)
/// leaf directory doesn't exist, as long as the drive itself is still
/// present — unlike unix's `statvfs`, which fails for any nonexistent path
/// component. Without this explicit check, a disconnected/missing directory
/// on a drive that itself is still mounted would pass re-validation on
/// Windows while correctly failing on unix.
fn path_is_accessible(path: &Utf8Path) -> bool {
    std::fs::metadata(path.as_std_path()).is_ok()
}

/// Re-check that `path`'s volume is currently reachable.
///
/// A `statvfs` (unix) / `GetDiskFreeSpaceEx` (Windows) call is the cheapest
/// available proof-of-life for a mount: it fails immediately if the volume
/// is unmounted, disconnected, or otherwise inaccessible — the same failure
/// mode the reactive classifier maps to `VolumeUnavailable` during a real
/// mutation.
///
/// # Errors
///
/// Returns `Err(PlanItemFailure { code: VolumeUnavailable })` if the probe fails.
pub fn recheck_volume_available(path: &Utf8Path) -> Result<(), PlanItemFailure> {
    if !path_is_accessible(path) {
        return Err(PlanItemFailure::with_code(
            FailureCode::VolumeUnavailable,
            format!("volume still unreachable at {path}: path is not accessible"),
        ));
    }

    fs4::available_space(path.as_std_path()).map(|_| ()).map_err(|e| {
        PlanItemFailure::with_code(
            FailureCode::VolumeUnavailable,
            format!("volume still unreachable at {path}: {e}"),
        )
    })
}

/// Re-check that `path`'s volume currently has at least `required_bytes` free.
///
/// A probe failure (e.g. the volume disappeared entirely) is also reported
/// as `DiskFull` here: from the resume caller's perspective the pause
/// condition is not resolved either way, and the run must stay paused.
///
/// # Errors
///
/// Returns `Err(PlanItemFailure { code: DiskFull })` if free space is
/// insufficient or the volume cannot be probed.
pub fn recheck_disk_space(path: &Utf8Path, required_bytes: u64) -> Result<(), PlanItemFailure> {
    if !path_is_accessible(path) {
        return Err(PlanItemFailure::with_code(
            FailureCode::DiskFull,
            format!("could not probe free space at {path}: path is not accessible"),
        ));
    }

    let available = fs4::available_space(path.as_std_path()).map_err(|e| {
        PlanItemFailure::with_code(
            FailureCode::DiskFull,
            format!("could not probe free space at {path}: {e}"),
        )
    })?;

    if available < required_bytes {
        return Err(PlanItemFailure::with_code(
            FailureCode::DiskFull,
            format!(
                "insufficient free space at {path}: {available} bytes available, \
                 {required_bytes} required"
            ),
        ));
    }

    Ok(())
}

/// Bytes currently free on the volume containing `path` (issue #876).
///
/// Unlike [`recheck_disk_space`] (a pass/fail gate against a required byte
/// count, used for pause-resume re-validation), this returns the raw number
/// so a caller can *report* a fit estimate — e.g. "plan needs 4.2 GB, 1.1 GB
/// free at destination" — before the user approves a plan, rather than only
/// discovering insufficient space after an apply attempt fails.
///
/// # Errors
///
/// Returns `Err(PlanItemFailure { code: VolumeUnavailable })` if `path` is
/// inaccessible or its volume cannot be probed.
pub fn available_space_bytes(path: &Utf8Path) -> Result<u64, PlanItemFailure> {
    if !path_is_accessible(path) {
        return Err(PlanItemFailure::with_code(
            FailureCode::VolumeUnavailable,
            format!("could not probe free space at {path}: path is not accessible"),
        ));
    }

    fs4::available_space(path.as_std_path()).map_err(|e| {
        PlanItemFailure::with_code(
            FailureCode::VolumeUnavailable,
            format!("could not probe free space at {path}: {e}"),
        )
    })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn utf8(p: &std::path::Path) -> camino::Utf8PathBuf {
        camino::Utf8PathBuf::from_path_buf(p.to_path_buf()).expect("temp dir path is UTF-8")
    }

    #[test]
    fn volume_available_for_existing_dir() {
        let dir = tempfile::tempdir().unwrap();
        assert!(recheck_volume_available(&utf8(dir.path())).is_ok());
    }

    #[test]
    fn volume_unavailable_for_missing_path() {
        let err = recheck_volume_available(Utf8Path::new("/absolutely/does/not/exist/nested/path"))
            .unwrap_err();
        assert_eq!(err.code, FailureCode::VolumeUnavailable);
    }

    #[test]
    fn disk_space_sufficient_for_small_requirement() {
        let dir = tempfile::tempdir().unwrap();
        assert!(recheck_disk_space(&utf8(dir.path()), 1).is_ok());
    }

    #[test]
    fn disk_space_insufficient_for_absurd_requirement() {
        let dir = tempfile::tempdir().unwrap();
        // No real volume has an exabyte free; this deterministically fails
        // without needing to fabricate a full disk.
        let err = recheck_disk_space(&utf8(dir.path()), u64::MAX / 2).unwrap_err();
        assert_eq!(err.code, FailureCode::DiskFull);
    }

    #[test]
    fn available_space_bytes_reports_a_positive_number_for_existing_dir() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = available_space_bytes(&utf8(dir.path())).unwrap();
        assert!(bytes > 0, "a real volume must report nonzero free space");
    }

    #[test]
    fn available_space_bytes_fails_for_missing_path() {
        let err = available_space_bytes(Utf8Path::new("/absolutely/does/not/exist/nested/path"))
            .unwrap_err();
        assert_eq!(err.code, FailureCode::VolumeUnavailable);
    }
}
