// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! App-owned project marker writer for `write_manifest` plan items
//! (astro-plan-l3y0).
//!
//! Renders the marker via `project_structure::render_marker` and writes it to
//! the plan item's destination path. Idempotent when a file with identical
//! content already exists (safe re-apply/retry); any other pre-existing entry
//! is a `conflict.destination_exists` failure — constitution §II: never
//! overwrite silently.

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

    std::fs::write(destination, content.as_bytes())
        .map_err(|e| PlanItemFailure::from_io(&e, &format!("write marker {destination}")))
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
}
