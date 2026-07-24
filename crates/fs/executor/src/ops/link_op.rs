// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Link-creation primitive for `link` plan items (spec 049 — source view
//! generation first-materialization).
//!
//! Before this module, `link` plan items (spec 026's regeneration plans) were
//! mapped to `ExecutorItemAction::NoOp` — apply never actually created
//! anything on disk. Spec 049 restores the missing generation path, so this
//! is the first real link materialization primitive.
//!
//! - `symlink`: real symbolic link (file), the constitution-preferred default.
//! - `hardlink`: real hard link (same-volume only by definition).
//! - `copy`: real byte copy — only ever chosen with an explicit per-generation
//!   opt-in (FR-003); never the silent default.
//! - `junction`: Windows directory reparse points are not yet implemented by
//!   this executor. Requesting `junction` fails with
//!   `materialization.unsupported` rather than silently falling back to a
//!   different kind or a no-op (Constitution §II — never silently produce a
//!   wrong result). `fs_inventory::capability::probe` never advertises
//!   junction as available, so `domain_core::source_view::resolve_link_kind`
//!   should not select it in practice; this is defence in depth.

use camino::Utf8Path;
use domain_core::source_view::Materialization;
use filetime::FileTime;

use crate::failure::{FailureCode, PlanItemFailure};

/// Create a link (or, with `Materialization::Copy`, a real copy) from
/// `source` to `destination`.
///
/// - Destination already exists → `ConflictDestinationExists` (constitution
///   §II: never overwrite silently).
/// - Source does not exist → `SourceMissing`.
/// - `Materialization::Junction` → `MaterializationUnsupported` (not yet
///   implemented; see module docs).
///
/// # Errors
///
/// Returns a [`PlanItemFailure`] describing the conflict or io failure.
pub fn create_link(
    source: &Utf8Path,
    destination: &Utf8Path,
    kind: Materialization,
) -> Result<(), PlanItemFailure> {
    if destination.exists() || destination.symlink_metadata().is_ok() {
        return Err(PlanItemFailure::with_code(
            FailureCode::ConflictDestinationExists,
            format!("destination already exists; cannot create {}: {destination}", kind.as_str()),
        ));
    }

    if !source.exists() {
        return Err(PlanItemFailure::with_code(
            FailureCode::SourceMissing,
            format!("source does not exist: {source}"),
        ));
    }

    match kind {
        Materialization::Symlink => {
            fs_pathsafe::create_symlink(source.as_std_path(), destination.as_std_path())
                .map_err(|e| PlanItemFailure::from_io(&e, "create symlink"))
        }
        Materialization::Hardlink => std::fs::hard_link(source, destination)
            .map_err(|e| PlanItemFailure::from_io(&e, "create hardlink")),
        Materialization::Copy => {
            // Read source mtime before copying so it survives even if the source
            // later becomes inaccessible.
            let source_mtime =
                std::fs::metadata(source).map(|m| FileTime::from_last_modification_time(&m)).ok();

            std::fs::copy(source, destination)
                .map_err(|e| PlanItemFailure::from_io(&e, "copy file"))?;

            // Restore mtime: std::fs::copy resets it to "now".  mtime feeds the
            // per-file signature in crates/app/inbox, so without this a Copy
            // materialization would look like a new file to any watcher.
            // Failure is non-fatal — bytes are correct; warn and continue.
            if let Some(mtime) = source_mtime {
                if let Err(e) = filetime::set_file_mtime(destination, mtime) {
                    tracing::warn!(
                        %destination,
                        error = %e,
                        "link Copy: could not restore mtime on destination; \
                         file data is intact but timestamp reflects copy time"
                    );
                }
            }

            Ok(())
        }
        Materialization::Junction => Err(PlanItemFailure::with_code(
            FailureCode::MaterializationUnsupported,
            "junction materialization is not yet implemented by this executor",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::create_link;
    use crate::failure::FailureCode;
    use domain_core::source_view::Materialization;

    fn utf8(p: std::path::PathBuf) -> camino::Utf8PathBuf {
        camino::Utf8PathBuf::from_path_buf(p).unwrap()
    }

    #[test]
    fn symlink_creates_real_link_resolving_to_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = utf8(dir.path().join("source.fits"));
        let dest = utf8(dir.path().join("dest.fits"));
        std::fs::write(&source, b"data").unwrap();

        create_link(&source, &dest, Materialization::Symlink).unwrap();

        assert!(dest.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(&dest).unwrap(), b"data");
    }

    #[test]
    fn hardlink_creates_real_link() {
        let dir = tempfile::tempdir().unwrap();
        let source = utf8(dir.path().join("source.fits"));
        let dest = utf8(dir.path().join("dest.fits"));
        std::fs::write(&source, b"data").unwrap();

        create_link(&source, &dest, Materialization::Hardlink).unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"data");
    }

    #[test]
    fn copy_creates_independent_file() {
        let dir = tempfile::tempdir().unwrap();
        let source = utf8(dir.path().join("source.fits"));
        let dest = utf8(dir.path().join("dest.fits"));
        std::fs::write(&source, b"data").unwrap();

        create_link(&source, &dest, Materialization::Copy).unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"data");
        // Independent copy: mutating the source does not change the copy.
        std::fs::write(&source, b"changed").unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"data");
    }

    #[test]
    fn refuses_to_overwrite_existing_destination() {
        let dir = tempfile::tempdir().unwrap();
        let source = utf8(dir.path().join("source.fits"));
        let dest = utf8(dir.path().join("dest.fits"));
        std::fs::write(&source, b"data").unwrap();
        std::fs::write(&dest, b"pre-existing").unwrap();

        let err = create_link(&source, &dest, Materialization::Symlink).unwrap_err();
        assert_eq!(err.code, FailureCode::ConflictDestinationExists);
        assert_eq!(std::fs::read(&dest).unwrap(), b"pre-existing");
    }

    #[test]
    fn refuses_missing_source() {
        let dir = tempfile::tempdir().unwrap();
        let source = utf8(dir.path().join("missing.fits"));
        let dest = utf8(dir.path().join("dest.fits"));

        let err = create_link(&source, &dest, Materialization::Symlink).unwrap_err();
        assert_eq!(err.code, FailureCode::SourceMissing);
    }

    #[test]
    fn junction_is_explicitly_unsupported() {
        let dir = tempfile::tempdir().unwrap();
        let source = utf8(dir.path().join("source.fits"));
        let dest = utf8(dir.path().join("dest"));
        std::fs::write(&source, b"data").unwrap();

        let err = create_link(&source, &dest, Materialization::Junction).unwrap_err();
        assert_eq!(err.code, FailureCode::MaterializationUnsupported);
        assert!(!dest.exists());
    }

    #[test]
    fn copy_materialization_preserves_source_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let source = utf8(dir.path().join("source.fits"));
        let dest = utf8(dir.path().join("dest.fits"));
        std::fs::write(&source, b"data").unwrap();

        // Pin source mtime to a known value in the past.
        let known_mtime = filetime::FileTime::from_unix_time(1_700_000_000, 0);
        filetime::set_file_mtime(&source, known_mtime).unwrap();

        create_link(&source, &dest, Materialization::Copy).unwrap();

        let dest_mtime =
            filetime::FileTime::from_last_modification_time(&std::fs::metadata(&dest).unwrap());
        assert_eq!(
            dest_mtime.unix_seconds(),
            known_mtime.unix_seconds(),
            "Copy materialization must restore source mtime on destination"
        );
    }

    #[test]
    fn symlink_and_hardlink_do_not_use_mtime_restore_path() {
        // Symlinks and hardlinks share the underlying inode or target mtime by
        // OS contract; no filetime call is made by the executor for these kinds.
        // This test confirms they succeed and the destination is accessible.
        let dir = tempfile::tempdir().unwrap();
        let source = utf8(dir.path().join("source.fits"));
        std::fs::write(&source, b"data").unwrap();

        let known_mtime = filetime::FileTime::from_unix_time(1_600_000_000, 0);
        filetime::set_file_mtime(&source, known_mtime).unwrap();

        let dest_sym = utf8(dir.path().join("sym.fits"));
        create_link(&source, &dest_sym, Materialization::Symlink).unwrap();
        assert_eq!(std::fs::read(&dest_sym).unwrap(), b"data");

        let dest_hard = utf8(dir.path().join("hard.fits"));
        create_link(&source, &dest_hard, Materialization::Hardlink).unwrap();
        assert_eq!(std::fs::read(&dest_hard).unwrap(), b"data");
    }
}
