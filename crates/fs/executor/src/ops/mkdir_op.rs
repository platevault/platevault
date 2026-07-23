// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Directory-creation primitive for `mkdir` plan items.
//!
//! Used by project folder-structure scaffolding plans (spec 008). Creation is
//! idempotent: an already-existing directory is a success, because nothing is
//! written into it and no user data can be lost. A non-directory entry at the
//! destination is a `conflict.destination_exists` failure — constitution §II:
//! never overwrite silently.

use camino::Utf8Path;

use crate::failure::{FailureCode, PlanItemFailure};

/// Create the directory at `destination` (including missing parents).
///
/// - Destination already a directory → `Ok(())` (idempotent, nothing written).
/// - Destination exists but is not a directory → `ConflictDestinationExists`.
/// - Creation error → mapped from the underlying io error.
///
/// # Errors
///
/// Returns a [`PlanItemFailure`] describing the conflict or io failure.
pub fn make_dir(destination: &Utf8Path) -> Result<(), PlanItemFailure> {
    if destination.exists() {
        if destination.is_dir() {
            return Ok(());
        }
        return Err(PlanItemFailure::with_code(
            FailureCode::ConflictDestinationExists,
            format!("destination exists and is not a directory; cannot create: {destination}"),
        ));
    }

    std::fs::create_dir_all(destination)
        .map_err(|e| PlanItemFailure::from_io(&e, &format!("create directory {destination}")))
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
    fn creates_nested_directories() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join("projects/m31/lights");
        make_dir(&dest).expect("nested create must succeed");
        assert!(dest.is_dir());
    }

    #[test]
    fn existing_directory_is_idempotent_success() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join("lights");
        std::fs::create_dir(&dest).unwrap();
        make_dir(&dest).expect("existing directory must be a success");
        assert!(dest.is_dir());
    }

    #[test]
    fn existing_file_at_destination_fails_with_conflict() {
        let (_guard, root) = utf8_tempdir();
        let dest = root.join("lights");
        std::fs::write(&dest, b"not a directory").unwrap();
        let failure = make_dir(&dest).expect_err("file at destination must fail");
        assert_eq!(failure.code, FailureCode::ConflictDestinationExists);
        // The file is untouched (never overwrite silently).
        assert_eq!(std::fs::read(&dest).unwrap(), b"not a directory");
    }
}
