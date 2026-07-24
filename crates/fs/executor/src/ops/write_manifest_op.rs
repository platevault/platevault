// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! App-owned project marker writer for `write_manifest` plan items
//! (astro-plan-l3y0).
//!
//! Renders the marker via `project_structure::render_marker` and writes it to
//! the plan item's destination path atomically: content lands in a temp file
//! in the same directory and is renamed into place, so an interrupted write
//! never leaves a truncated marker that poisons the idempotency check on the
//! next retry with `ConflictDestinationExists` (GF-27). Idempotent when a file
//! with identical content already exists (safe re-apply/retry); any other
//! pre-existing entry is a `conflict.destination_exists` failure — constitution
//! §II: never overwrite silently.

use camino::Utf8Path;

use crate::failure::{FailureCode, PlanItemFailure};

/// Write the project marker for `project_id` at `destination`.
///
/// # Errors
///
/// Returns a [`PlanItemFailure`] when `project_id` is empty (the plan item
/// was not linked to a project), the destination is occupied by a
/// non-identical file or non-file entry, or the write fails at the OS level.
pub fn write_marker(destination: &Utf8Path, project_id: &str) -> Result<(), PlanItemFailure> {
    if project_id.trim().is_empty() {
        return Err(PlanItemFailure::with_code(
            FailureCode::PathInvalid,
            format!("write_manifest item for {destination} has no linked project id"),
        ));
    }

    let content = project_structure::render_marker(project_id);

    if destination.exists() {
        if !destination.is_file() {
            return Err(PlanItemFailure::with_code(
                FailureCode::ConflictDestinationExists,
                format!("destination exists and is not a file; cannot write marker: {destination}"),
            ));
        }
        return match std::fs::read_to_string(destination) {
            Ok(existing) if existing == content => Ok(()),
            Ok(_) => Err(PlanItemFailure::with_code(
                FailureCode::ConflictDestinationExists,
                format!("marker file already exists with different content: {destination}"),
            )),
            Err(e) => {
                Err(PlanItemFailure::from_io(&e, &format!("read existing marker {destination}")))
            }
        };
    }

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            PlanItemFailure::from_io(
                &e,
                &format!("create parent directory for marker {destination}"),
            )
        })?;
    }

    // Write to a temp file in the same directory and rename into place so that
    // a crash or interrupt never leaves a truncated marker at the destination
    // path (GF-27): a partial file at the final path fails the idempotency
    // check above and returns ConflictDestinationExists on every retry.
    let dest_dir = destination.parent().unwrap_or_else(|| camino::Utf8Path::new("."));
    let tmp = tempfile::Builder::new().prefix(".astroplan-marker-").tempfile_in(dest_dir).map_err(
        |e| PlanItemFailure::from_io(&e, &format!("create temp file for marker {destination}")),
    )?;
    std::fs::write(tmp.path(), content.as_bytes()).map_err(|e| {
        PlanItemFailure::from_io(&e, &format!("write temp marker for {destination}"))
    })?;
    tmp.persist(destination).map(|_| ()).map_err(|e| {
        PlanItemFailure::from_io(&e.error, &format!("persist marker to {destination}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use camino::Utf8PathBuf;

    fn utf8_tempdir() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        (dir, path)
    }

    #[test]
    fn writes_marker_file_to_disk() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join(".astro-plan-project.json");
        write_marker(&dest, "proj-123").expect("write must succeed");
        assert!(dest.is_file());
        let content = std::fs::read_to_string(&dest).unwrap();
        assert!(content.contains("proj-123"));
        assert!(content.contains("\"version\""));
    }

    #[test]
    fn creates_missing_parent_directories() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join("proj/nested").join(".astro-plan-project.json");
        write_marker(&dest, "proj-nested").expect("write must succeed");
        assert!(dest.is_file());
    }

    #[test]
    fn identical_content_is_idempotent() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join(".astro-plan-project.json");
        write_marker(&dest, "proj-123").unwrap();
        write_marker(&dest, "proj-123").expect("re-apply with identical content must succeed");
    }

    #[test]
    fn differing_content_is_a_conflict_and_does_not_overwrite() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join(".astro-plan-project.json");
        write_marker(&dest, "proj-123").unwrap();
        let failure =
            write_marker(&dest, "proj-456").expect_err("differing project id must be refused");
        assert_eq!(failure.code, FailureCode::ConflictDestinationExists);
        // Never overwrite silently — original content is untouched.
        let content = std::fs::read_to_string(&dest).unwrap();
        assert!(content.contains("proj-123"));
    }

    #[test]
    fn directory_at_destination_is_a_conflict() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join(".astro-plan-project.json");
        std::fs::create_dir(&dest).unwrap();
        let failure = write_marker(&dest, "proj-123").expect_err("directory must be refused");
        assert_eq!(failure.code, FailureCode::ConflictDestinationExists);
    }

    #[test]
    fn empty_project_id_is_rejected() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join(".astro-plan-project.json");
        let failure = write_marker(&dest, "").expect_err("empty project id must be refused");
        assert_eq!(failure.code, FailureCode::PathInvalid);
        assert!(!dest.exists());
    }

    // ── retry-poison regression (GF-27) ──────────────────────────────────────

    /// Manually placed truncated content at the destination path must return
    /// `ConflictDestinationExists`, not silently overwrite it. This is the
    /// pre-fix poison scenario: a non-atomic write leaves a partial file at
    /// the final path, which the idempotency check catches as a mismatch and
    /// permanently blocks the operation. With the new atomic temp+rename
    /// implementation the partial file can only land at the temp path (which
    /// is discarded), so the destination path is never occupied by a partial
    /// write — but we keep this test to verify the constitution §II guard
    /// still fires for any externally-placed mismatch.
    #[test]
    fn truncated_marker_at_dest_returns_conflict_not_overwrite() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join(".astro-plan-project.json");
        // Simulate a partial/truncated file planted at the destination.
        std::fs::write(&dest, b"{\"partial\":").unwrap();

        let failure = write_marker(&dest, "proj-abc")
            .expect_err("truncated/partial content must be a conflict");
        assert_eq!(failure.code, FailureCode::ConflictDestinationExists);
        // Never overwrote the partial file.
        let on_disk = std::fs::read_to_string(&dest).unwrap();
        assert_eq!(on_disk, "{\"partial\":", "original truncated content must be untouched");
    }

    /// After a write-level failure, the destination path must remain absent —
    /// no partial temp file leaks to the final path. Uses a read-only
    /// directory to force the `tempfile_in` call to fail.
    #[cfg(unix)]
    #[test]
    fn write_failure_leaves_dest_absent() {
        use std::os::unix::fs::PermissionsExt;

        let (_guard, root) = utf8_tempdir();
        let dest = root.join(".astro-plan-project.json");
        // Make the directory read-only so tempfile_in cannot create a temp entry.
        std::fs::set_permissions(&*root, std::fs::Permissions::from_mode(0o555)).unwrap();

        let result = write_marker(&dest, "proj-xyz");

        // Restore permissions before any assertion so the TempDir cleanup succeeds.
        std::fs::set_permissions(&*root, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert!(result.is_err(), "write must fail when directory is read-only");
        assert!(!dest.exists(), "destination must remain absent after a failed write");
    }
}
