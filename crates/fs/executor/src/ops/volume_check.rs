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
}
