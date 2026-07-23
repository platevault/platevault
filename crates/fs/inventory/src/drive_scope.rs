// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 049 (T007): drive-scope classification for source-view generation.
//!
//! Classifies a source path relative to a generation destination as
//! `intra_drive` (same volume) or `cross_drive` (different volumes), driving
//! the per-item link-kind resolution in `domain_core::source_view`.

use camino::{Utf8Path, Utf8PathBuf};
use domain_core::source_view::DriveScope;

/// Classify `source` relative to `destination` by volume identity.
///
/// Falls back to the nearest existing ancestor when a path does not exist yet
/// (e.g. the destination directory tree has not been created before plan
/// build). Returns `CrossDrive` conservatively when volume identity cannot be
/// determined for either side — the cross-drive settings default is always
/// achievable (never `hardlink`, per FR-004a), so this is a safe default
/// rather than a silent wrong classification.
#[must_use]
pub fn classify(source: &Utf8Path, destination: &Utf8Path) -> DriveScope {
    match (volume_id(source), volume_id(destination)) {
        (Some(a), Some(b)) if a == b => DriveScope::IntraDrive,
        _ => DriveScope::CrossDrive,
    }
}

#[cfg(unix)]
fn volume_id(path: &Utf8Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let existing = nearest_existing(path)?;
    std::fs::metadata(&existing).ok().map(|m| m.dev().to_string())
}

#[cfg(windows)]
fn volume_id(path: &Utf8Path) -> Option<String> {
    // Windows has no cheap cross-platform std API for a real volume serial
    // number here; approximate by the path's root component (drive letter or
    // UNC `\\server\share`). This is a documented approximation — it does not
    // detect substituted/mapped drives that alias the same physical volume,
    // matching the precision of this crate's other Windows path helpers.
    // Real per-volume-id detection is a Windows real-app follow-up (see
    // `docs/development` verify-on-windows guidance for spec 049).
    let candidate = nearest_existing(path).unwrap_or_else(|| path.to_path_buf());
    let root: Utf8PathBuf = candidate.components().take(1).collect();
    let root_str = root.as_str().to_lowercase();
    if root_str.is_empty() {
        None
    } else {
        Some(root_str)
    }
}

#[cfg(not(any(unix, windows)))]
fn volume_id(_path: &Utf8Path) -> Option<String> {
    None
}

fn nearest_existing(path: &Utf8Path) -> Option<Utf8PathBuf> {
    let mut current: Option<Utf8PathBuf> = Some(path.to_path_buf());
    while let Some(p) = current {
        if p.exists() {
            return Some(p);
        }
        current = p.parent().map(Utf8Path::to_path_buf);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::classify;
    use domain_core::source_view::DriveScope;

    #[test]
    fn same_directory_is_intra_drive() {
        let dir = tempfile::tempdir().unwrap();
        let a = camino::Utf8PathBuf::from_path_buf(dir.path().join("a")).unwrap();
        let b = camino::Utf8PathBuf::from_path_buf(dir.path().join("b")).unwrap();
        std::fs::write(&a, b"x").unwrap();
        assert_eq!(classify(&a, &b), DriveScope::IntraDrive);
    }

    #[test]
    fn nonexistent_destination_under_same_root_is_intra_drive() {
        let dir = tempfile::tempdir().unwrap();
        let a = camino::Utf8PathBuf::from_path_buf(dir.path().join("a")).unwrap();
        std::fs::write(&a, b"x").unwrap();
        let dest =
            camino::Utf8PathBuf::from_path_buf(dir.path().join("not/yet/created/dest")).unwrap();
        assert_eq!(classify(&a, &dest), DriveScope::IntraDrive);
    }
}
