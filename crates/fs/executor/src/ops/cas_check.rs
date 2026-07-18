// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Compare-and-swap (CAS) check for per-item FS revalidation (R-FS-1).
//!
//! Before each item mutation the executor checks that the source file's
//! current `(mtime, size_bytes)` matches the snapshot taken at approval
//! time. On mismatch the item transitions to `stale` and the run pauses.
//!
//! Constitution §II: no silent overwrite; freshness verified per item.

use std::time::SystemTime;

use camino::Utf8Path;

use crate::failure::{FailureCode, PlanItemFailure};

/// Snapshot recorded at plan approval time (R-FS-1).
///
/// Both fields are optional because legacy plans may not have them.
/// When both are `None` the CAS check is skipped (permissive mode).
#[derive(Clone, Debug)]
pub struct CasSnapshot {
    /// ISO-8601 mtime string as stored in `plan_items.approved_mtime`.
    pub approved_mtime: Option<String>,
    /// Byte size as stored in `plan_items.approved_size_bytes`.
    pub approved_size_bytes: Option<i64>,
}

/// Check whether `path` still matches the approval-time snapshot.
///
/// Returns `Ok(())` when:
/// - Both snapshot fields are `None` (no snapshot was taken; permissive).
/// - The current mtime and size match the stored snapshot.
///
/// Returns `Err(PlanItemFailure { code: ItemStale })` on mismatch.
/// Returns `Err(PlanItemFailure { code: SourceMissing })` if the path
/// no longer exists.
///
/// # Errors
///
/// Returns `Err(PlanItemFailure)` on mismatch or filesystem access error.
pub fn check_cas(path: &Utf8Path, snapshot: &CasSnapshot) -> Result<(), PlanItemFailure> {
    // Both absent → skip check (no snapshot was recorded at approval).
    if snapshot.approved_mtime.is_none() && snapshot.approved_size_bytes.is_none() {
        return Ok(());
    }

    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(PlanItemFailure::with_code(
                FailureCode::SourceMissing,
                format!("source path no longer exists: {path}"),
            ));
        }
        Err(e) => {
            return Err(PlanItemFailure::from_io(&e, &format!("stat {path}")));
        }
    };

    // Check size if present.
    if let Some(approved_size) = snapshot.approved_size_bytes {
        let current_size = i64::try_from(meta.len()).unwrap_or(i64::MAX);
        if current_size != approved_size {
            return Err(PlanItemFailure::with_code(
                FailureCode::ItemStale,
                format!(
                    "source size changed since approval: was {approved_size} bytes, \
                     now {current_size} bytes ({path})"
                ),
            ));
        }
    }

    // Check mtime if present.
    if let Some(ref approved_mtime_str) = snapshot.approved_mtime {
        // Parse the stored ISO-8601 mtime.
        if let Ok(current_mtime) = meta.modified() {
            if let Some(approved_ts) = parse_iso_to_system_time(approved_mtime_str) {
                // Allow ±1 second tolerance for filesystem mtime resolution.
                let current_secs = to_unix_secs(current_mtime);
                let approved_secs = to_unix_secs(approved_ts);
                if (i128::from(current_secs) - i128::from(approved_secs)).unsigned_abs() > 1 {
                    return Err(PlanItemFailure::with_code(
                        FailureCode::ItemStale,
                        format!(
                            "source mtime changed since approval: was {approved_mtime_str}, \
                             now {current_secs} unix secs ({path})"
                        ),
                    ));
                }
            }
            // If parse fails, skip mtime check (permissive fallback).
        }
    }

    Ok(())
}

/// Capture the current `(mtime, size)` of a real file on disk as a fresh
/// [`CasSnapshot`] (R-FS-1). Meant to be called at plan-approval time
/// (`approve_plan`) to stamp `approved_mtime`/`approved_size_bytes`, so the
/// *later* `check_cas` call at apply time has something to compare against
/// instead of silently skipping (permissive mode — #829).
///
/// Returns `None` if the path cannot be stat'd (already gone, or the mtime
/// cannot be represented as RFC 3339) — callers should treat this the same
/// as "no snapshot" rather than fail the approval outright: a missing source
/// will be caught for real at apply time (`SourceMissing`).
#[must_use]
pub fn snapshot_from_metadata(path: &Utf8Path) -> Option<CasSnapshot> {
    let meta = std::fs::metadata(path).ok()?;
    let size = i64::try_from(meta.len()).unwrap_or(i64::MAX);
    let mtime = meta.modified().ok().and_then(system_time_to_iso);
    Some(CasSnapshot { approved_mtime: mtime, approved_size_bytes: Some(size) })
}

fn system_time_to_iso(st: SystemTime) -> Option<String> {
    time::OffsetDateTime::from(st).format(&time::format_description::well_known::Rfc3339).ok()
}

fn parse_iso_to_system_time(iso: &str) -> Option<SystemTime> {
    // Use time crate for RFC3339 parsing.
    let odt =
        time::OffsetDateTime::parse(iso, &time::format_description::well_known::Rfc3339).ok()?;
    let unix_nanos = odt.unix_timestamp_nanos();
    let secs = u64::try_from(unix_nanos / 1_000_000_000).ok()?;
    let nanos = u32::try_from(unix_nanos % 1_000_000_000).unwrap_or(0);
    Some(SystemTime::UNIX_EPOCH + std::time::Duration::new(secs, nanos))
}

fn to_unix_secs(st: SystemTime) -> u64 {
    st.duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn utf8(p: &std::path::Path) -> camino::Utf8PathBuf {
        camino::Utf8PathBuf::from_path_buf(p.to_path_buf()).expect("temp dir path is UTF-8")
    }

    #[test]
    fn skips_check_when_no_snapshot() {
        let snapshot = CasSnapshot { approved_mtime: None, approved_size_bytes: None };
        // Path does not need to exist when snapshot is absent.
        let result = check_cas(Utf8Path::new("/nonexistent"), &snapshot);
        assert!(result.is_ok());
    }

    #[test]
    fn detects_size_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let file = utf8(dir.path()).join("test.fits");
        std::fs::write(&file, b"hello").unwrap();

        let snapshot = CasSnapshot {
            approved_mtime: None,
            approved_size_bytes: Some(999), // wrong size
        };
        let err = check_cas(&file, &snapshot).unwrap_err();
        assert_eq!(err.code, FailureCode::ItemStale);
        assert!(err.message.contains("size changed"));
    }

    #[test]
    fn passes_when_size_matches() {
        let dir = tempfile::tempdir().unwrap();
        let file = utf8(dir.path()).join("test.fits");
        std::fs::write(&file, b"hello").unwrap(); // 5 bytes

        let snapshot = CasSnapshot { approved_mtime: None, approved_size_bytes: Some(5) };
        assert!(check_cas(&file, &snapshot).is_ok());
    }

    #[test]
    fn returns_source_missing_for_absent_file() {
        let snapshot = CasSnapshot { approved_mtime: None, approved_size_bytes: Some(10) };
        let err = check_cas(Utf8Path::new("/absolutely/does/not/exist/file.fits"), &snapshot)
            .unwrap_err();
        assert_eq!(err.code, FailureCode::SourceMissing);
    }

    #[test]
    fn detects_mtime_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let file = utf8(dir.path()).join("test.fits");
        {
            let mut f = std::fs::File::create(&file).unwrap();
            f.write_all(b"data").unwrap();
        }
        let meta = std::fs::metadata(&file).unwrap();
        let current_size = meta.len();

        // Use a very old mtime string — this will differ by hours.
        let snapshot = CasSnapshot {
            approved_mtime: Some("1970-01-01T00:00:00Z".to_owned()),
            approved_size_bytes: Some(i64::try_from(current_size).unwrap()),
        };
        let err = check_cas(&file, &snapshot).unwrap_err();
        assert_eq!(err.code, FailureCode::ItemStale);
    }

    // ── #829: snapshot_from_metadata (approval-time stamping) ─────────────────

    #[test]
    fn snapshot_from_metadata_round_trips_through_check_cas() {
        let dir = tempfile::tempdir().unwrap();
        let file = utf8(dir.path()).join("approved.fits");
        std::fs::write(&file, b"approved contents").unwrap();

        let snapshot = snapshot_from_metadata(&file).expect("stat must succeed for a real file");
        assert!(snapshot.approved_mtime.is_some());
        assert_eq!(snapshot.approved_size_bytes, Some(17));

        // Unchanged file: the snapshot taken "at approval" must still pass.
        assert!(check_cas(&file, &snapshot).is_ok());
    }

    #[test]
    fn snapshot_from_metadata_then_check_cas_catches_a_later_size_change() {
        let dir = tempfile::tempdir().unwrap();
        let file = utf8(dir.path()).join("modified.fits");
        std::fs::write(&file, b"original").unwrap();

        let snapshot = snapshot_from_metadata(&file).unwrap();

        // Source modified after approval (#829's exact repro: content changes
        // between approve and apply).
        std::fs::write(&file, b"modified-longer-content").unwrap();

        let err = check_cas(&file, &snapshot).unwrap_err();
        assert_eq!(err.code, FailureCode::ItemStale);
    }

    #[test]
    fn snapshot_from_metadata_returns_none_for_missing_file() {
        assert!(snapshot_from_metadata(Utf8Path::new("/absolutely/does/not/exist.fits")).is_none());
    }
}
