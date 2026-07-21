// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Real-OS failure classification (issue #1232).
//!
//! Every other test of [`fs_executor::failure`] drives `classify_io_error`
//! with a **synthesised** `io::Error`, which proves only that the match arms
//! are wired to each other — not that a real OS produces the kind we assume.
//! These tests provoke genuine kernel errors against a real temp filesystem
//! and assert the resulting `FailureCode`.
//!
//! Constitution §II: a refusal must explain itself. A misclassified error
//! surfaces as `Unknown`, which tells the user nothing about their read-only
//! drive or their too-long path.

use camino::{Utf8Path, Utf8PathBuf};

use fs_executor::failure::FailureCode;
use fs_executor::ops::move_file;

fn utf8(path: &std::path::Path) -> Utf8PathBuf {
    Utf8PathBuf::from_path_buf(path.to_path_buf()).expect("temp dir path must be UTF-8")
}

fn write_source(dir: &Utf8Path, name: &str) -> Utf8PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, b"payload").expect("failed to seed the test source file");
    path
}

/// A genuinely unwritable destination directory must classify as
/// `PermissionDenied`, not `Unknown`.
///
/// Skips (rather than passing vacuously) when the process can write into a
/// mode-`0o555` directory anyway — root bypasses DAC, so under `sudo` or in a
/// root CI container this test can prove nothing and must say so.
#[cfg(unix)]
#[test]
fn permission_denied_on_unwritable_destination_is_classified() {
    use std::os::unix::fs::PermissionsExt;

    let tmp = tempfile::tempdir().unwrap();
    let root = utf8(tmp.path());

    let source = write_source(&root, "source.fits");
    let locked = root.join("locked");
    std::fs::create_dir_all(&locked).unwrap();

    let mut perms = std::fs::metadata(&locked).unwrap().permissions();
    perms.set_mode(0o555);
    std::fs::set_permissions(&locked, perms).unwrap();

    // Probe the guarantee this test depends on before asserting on it.
    if std::fs::write(locked.join("privilege_probe"), b"x").is_ok() {
        eprintln!(
            "SKIP permission_denied_on_unwritable_destination_is_classified: \
             this process can write into a 0o555 directory (running as root), \
             so a real EACCES cannot be provoked here"
        );
        return;
    }

    let (failure, _) = move_file(&source, &locked.join("dest.fits"))
        .expect_err("moving into a mode-0o555 directory must fail");

    assert_eq!(
        failure.code,
        FailureCode::PermissionDenied,
        "real EACCES must classify as permission.denied, got {}: {}",
        failure.code.as_str(),
        failure.message
    );
    assert!(failure.recoverable, "the user can fix permissions and retry");
}

/// A path past the OS name limit must classify as `PathInvalid`.
///
/// The kernel reports `ENAMETOOLONG` on Unix, and on Windows either
/// `ERROR_INVALID_NAME` or the filename-exceeds-range error raised past
/// `MAX_PATH`; `std` folds all three into
/// `io::ErrorKind::InvalidFilename`. Before issue #1232 that kind had no arm
/// and degraded to `Unknown`.
#[test]
fn path_too_long_is_classified_as_path_invalid_not_unknown() {
    let tmp = tempfile::tempdir().unwrap();
    let root = utf8(tmp.path());

    let source = write_source(&root, "source.fits");
    // 400 chars exceeds the 255-byte per-component limit on Linux/macOS and
    // pushes the full path past MAX_PATH (260) on Windows.
    let too_long = root.join("x".repeat(400));

    let (failure, _) =
        move_file(&source, &too_long).expect_err("a 400-character name must be refused by the OS");

    assert_eq!(
        failure.code,
        FailureCode::PathInvalid,
        "an over-long path must name itself, not degrade to unknown; got {}: {}",
        failure.code.as_str(),
        failure.message
    );
    assert!(source.exists(), "a refused move must leave the source intact");
}

/// Case-variant destination collision, asserted against the filesystem's
/// actual case behaviour rather than against a `cfg!(windows)` guess —
/// macOS ships case-insensitive APFS by default but can be formatted
/// case-sensitive, and Linux can mount case-insensitive volumes.
///
/// Issue #1232 predicted `destination.exists()` returns false for a
/// case-variant on a case-insensitive filesystem; it does not — `exists()`
/// stats through the OS, which resolves case-insensitively. This test pins
/// that behaviour so a future change to the guard cannot silently start
/// clobbering files.
#[test]
fn case_variant_destination_collision_matches_filesystem_case_behaviour() {
    let tmp = tempfile::tempdir().unwrap();
    let root = utf8(tmp.path());

    let occupied = root.join("dest.fits");
    std::fs::write(&occupied, b"existing").unwrap();
    let case_insensitive = root.join("DEST.FITS").exists();

    let source = write_source(&root, "source.fits");
    let result = move_file(&source, &root.join("DEST.FITS"));

    if case_insensitive {
        let (failure, _) = result.expect_err(
            "on a case-insensitive filesystem a case-variant destination is the same file \
             and must be refused rather than overwritten (constitution §II)",
        );
        assert_eq!(failure.code, FailureCode::ConflictDestinationExists);
        assert_eq!(
            std::fs::read(&occupied).unwrap(),
            b"existing",
            "the occupying file must not be clobbered"
        );
    } else {
        result.expect(
            "on a case-sensitive filesystem DEST.FITS is a distinct path and the move is legal",
        );
        assert_eq!(std::fs::read(&occupied).unwrap(), b"existing");
        assert!(root.join("DEST.FITS").exists());
    }
}
