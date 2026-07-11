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
        Materialization::Copy => std::fs::copy(source, destination)
            .map(|_| ())
            .map_err(|e| PlanItemFailure::from_io(&e, "copy file")),
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
}
