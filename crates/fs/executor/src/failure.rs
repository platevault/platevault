//! Failure taxonomy for plan item apply operations (spec 025, research R3).
//!
//! Maps raw `std::io::Error` and domain conditions to structured
//! `PlanItemFailure` codes. The `recoverable` flag indicates whether
//! per-item retry or `plan.retry` is likely to help.
//!
//! Constitution §II: failures retain structured error info for audit;
//! recoverable failures support retry without re-approval.

use std::io;

use serde::{Deserialize, Serialize};

// ── PlanItemFailure ────────────────────────────────────────────────────────────

/// Structured failure record stored on a plan item when it transitions
/// to `failed`. Preserved across re-apply; cleared only when the item
/// transitions back to `applying` via per-item retry.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PlanItemFailure {
    /// Failure code from the taxonomy below.
    pub code: FailureCode,
    /// Human-readable detail including the raw OS error where relevant.
    pub message: String,
    /// True if per-item retry or plan.retry is expected to help.
    pub recoverable: bool,
}

impl PlanItemFailure {
    /// Build a failure from an `io::Error` with context about the operation.
    #[must_use]
    pub fn from_io(err: &io::Error, context: &str) -> Self {
        let (code, recoverable) = classify_io_error(err);
        Self { code, message: format!("{context}: {err}"), recoverable }
    }

    /// Build a pre-classified failure.
    #[must_use]
    pub fn with_code(code: FailureCode, message: impl Into<String>) -> Self {
        let recoverable = code.is_recoverable();
        Self { code, message: message.into(), recoverable }
    }
}

impl std::fmt::Display for PlanItemFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

// ── FailureCode ────────────────────────────────────────────────────────────────

/// Typed failure codes (research R3, plan.apply.json contract).
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureCode {
    /// Source file or directory is not accessible (OS permission error).
    PermissionDenied,
    /// Destination already exists; no-overwrite policy (constitution §II).
    ConflictDestinationExists,
    /// Source path no longer exists at apply time.
    SourceMissing,
    /// Source path is locked by another process.
    SourceLocked,
    /// The volume the source or destination lives on is not available.
    VolumeUnavailable,
    /// Destination volume has insufficient free space.
    DiskFull,
    /// Path resolves outside a registered library root (FR-014).
    PathInvalid,
    /// Item is protected by source policy (FR-008).
    ProtectedSource,
    /// OS trash not available on this platform / volume combination.
    TrashUnavailable,
    /// Cross-volume copy succeeded but the source delete failed.
    /// Source file is intact; destination copy is complete.
    CopySucceededDeleteFailed,
    /// Cross-volume copy succeeded, source delete failed, and rollback
    /// of the destination copy also failed.
    CopySucceededDeleteFailedRollbackFailed,
    /// Per-item FS revalidation mismatch (mtime or size changed since
    /// approval) — non-skippable; requires re-approval (R-FS-1).
    ItemStale,
    /// OS trash unavailable (alias kept for contract compatibility).
    OsTrashUnavailable,
    /// OS trash is full.
    OsTrashFull,
    /// Permission denied for OS trash operation.
    OsTrashPermissionDenied,
    /// Unclassified OS error.
    Unknown,
}

impl FailureCode {
    /// Return the wire-format string for the code (matches contract enum).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PermissionDenied => "permission.denied",
            Self::ConflictDestinationExists => "conflict.destination_exists",
            Self::SourceMissing => "source.missing",
            Self::SourceLocked => "source.locked",
            Self::VolumeUnavailable => "volume.unavailable",
            Self::DiskFull => "disk.full",
            Self::PathInvalid => "path.invalid",
            Self::ProtectedSource => "protected.source",
            Self::TrashUnavailable => "trash.unavailable",
            Self::CopySucceededDeleteFailed => "copy.succeeded.delete.failed",
            Self::CopySucceededDeleteFailedRollbackFailed => {
                "copy.succeeded.delete.failed.rollback.failed"
            }
            Self::ItemStale => "item.stale",
            Self::OsTrashUnavailable => "os_trash.unavailable",
            Self::OsTrashFull => "os_trash.full",
            Self::OsTrashPermissionDenied => "os_trash.permission.denied",
            Self::Unknown => "unknown",
        }
    }

    /// True if per-item retry or plan.retry is likely to resolve this.
    #[must_use]
    pub const fn is_recoverable(self) -> bool {
        match self {
            // Transient or user-resolvable conditions.
            Self::PermissionDenied
            | Self::SourceLocked
            | Self::VolumeUnavailable
            | Self::DiskFull
            | Self::ItemStale
            | Self::OsTrashUnavailable
            | Self::OsTrashFull
            | Self::OsTrashPermissionDenied
            | Self::CopySucceededDeleteFailed => true,
            // Not recoverable by retry alone.
            Self::ConflictDestinationExists
            | Self::SourceMissing
            | Self::PathInvalid
            | Self::ProtectedSource
            | Self::TrashUnavailable
            | Self::CopySucceededDeleteFailedRollbackFailed
            | Self::Unknown => false,
        }
    }

    /// True if this code should trigger a run pause (R-Pause-1).
    #[must_use]
    pub const fn triggers_pause(self) -> bool {
        matches!(self, Self::VolumeUnavailable | Self::DiskFull | Self::ItemStale)
    }
}

// ── IO error classifier ────────────────────────────────────────────────────────

fn classify_io_error(err: &io::Error) -> (FailureCode, bool) {
    match err.kind() {
        io::ErrorKind::PermissionDenied => (FailureCode::PermissionDenied, true),
        io::ErrorKind::AlreadyExists => (FailureCode::ConflictDestinationExists, false),
        io::ErrorKind::NotFound => (FailureCode::SourceMissing, false),
        io::ErrorKind::WouldBlock => (FailureCode::SourceLocked, true),
        io::ErrorKind::StorageFull => (FailureCode::DiskFull, true),
        _ => {
            // Inspect raw OS error for volume / cross-device clues.
            #[cfg(unix)]
            if let Some(raw) = err.raw_os_error() {
                // EXDEV = 18 (cross-device link, not an apply error per se)
                // ENODEV = 19 / ENXIO = 6 — volume not mounted
                if matches!(raw, 6 | 19) {
                    return (FailureCode::VolumeUnavailable, true);
                }
            }
            (FailureCode::Unknown, false)
        }
    }
}

// ── RollbackOutcome ────────────────────────────────────────────────────────────

/// Result of a rollback attempt (FR-007: logged separately, never assumed).
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RollbackOutcome {
    Succeeded,
    Failed,
    NotApplicable,
}

impl RollbackOutcome {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::NotApplicable => "not_applicable",
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_denied_io_maps_correctly() {
        let err = io::Error::from(io::ErrorKind::PermissionDenied);
        let f = PlanItemFailure::from_io(&err, "move /a to /b");
        assert_eq!(f.code, FailureCode::PermissionDenied);
        assert!(f.recoverable);
        assert!(f.message.contains("move /a to /b"));
    }

    #[test]
    fn already_exists_io_maps_to_conflict() {
        let err = io::Error::from(io::ErrorKind::AlreadyExists);
        let f = PlanItemFailure::from_io(&err, "copy");
        assert_eq!(f.code, FailureCode::ConflictDestinationExists);
        assert!(!f.recoverable);
    }

    #[test]
    fn not_found_io_maps_to_source_missing() {
        let err = io::Error::from(io::ErrorKind::NotFound);
        let f = PlanItemFailure::from_io(&err, "move");
        assert_eq!(f.code, FailureCode::SourceMissing);
        assert!(!f.recoverable);
    }

    #[test]
    fn item_stale_triggers_pause() {
        assert!(FailureCode::ItemStale.triggers_pause());
        assert!(FailureCode::VolumeUnavailable.triggers_pause());
        assert!(FailureCode::DiskFull.triggers_pause());
        assert!(!FailureCode::PermissionDenied.triggers_pause());
    }

    #[test]
    fn failure_code_wire_strings_match_contract() {
        assert_eq!(FailureCode::PermissionDenied.as_str(), "permission.denied");
        assert_eq!(FailureCode::ItemStale.as_str(), "item.stale");
        assert_eq!(
            FailureCode::CopySucceededDeleteFailedRollbackFailed.as_str(),
            "copy.succeeded.delete.failed.rollback.failed"
        );
    }

    #[test]
    fn rollback_outcome_as_str() {
        assert_eq!(RollbackOutcome::Succeeded.as_str(), "succeeded");
        assert_eq!(RollbackOutcome::NotApplicable.as_str(), "not_applicable");
    }

    #[test]
    fn with_code_sets_recoverable_from_code() {
        let f = PlanItemFailure::with_code(FailureCode::SourceMissing, "gone");
        assert!(!f.recoverable);

        let f2 = PlanItemFailure::with_code(FailureCode::VolumeUnavailable, "drive ejected");
        assert!(f2.recoverable);
    }
}
