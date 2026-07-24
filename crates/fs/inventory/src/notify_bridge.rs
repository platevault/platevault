// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared `notify`-event classification + UTF-8-safe path conversion, used by
//! both [`crate::watcher`] and [`crate::artifact_watcher`] (duplication-and-
//! abstraction audit Tier 3).

use camino::{Utf8Path, Utf8PathBuf};
use notify::EventKind;

/// The three event kinds both watcher event enums distinguish. `notify`
/// event kinds outside these three (Access, Other, ...) are not forwarded.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SimpleEventKind {
    Created,
    Modified,
    Removed,
}

/// Classify a raw `notify::EventKind` into the shared 3-way kind, or `None`
/// for event kinds neither watcher forwards (e.g. `Access`).
pub fn classify(kind: EventKind) -> Option<SimpleEventKind> {
    match kind {
        EventKind::Create(_) => Some(SimpleEventKind::Created),
        EventKind::Modify(_) => Some(SimpleEventKind::Modified),
        EventKind::Remove(_) => Some(SimpleEventKind::Removed),
        _ => None,
    }
}

/// Convert a `notify`-yielded `std::path::Path` to a faithful UTF-8 path, or
/// `None` if it cannot be represented as one.
///
/// `notify` yields `std::path::PathBuf`, which can be non-UTF-8 on a raw
/// disk. We never lossy-convert (that would corrupt a path that later
/// crosses the IPC boundary as a wire string) — a non-UTF-8 path is skipped
/// with a `diagnostic_source`-tagged stderr diagnostic instead. Constitution
/// §I (Local-First custody): never silently mangle a user path.
pub fn utf8_path_or_skip(path: &std::path::Path, diagnostic_source: &str) -> Option<Utf8PathBuf> {
    if let Some(utf8) = Utf8Path::from_path(path) {
        Some(utf8.to_owned())
    } else {
        eprintln!(
            "{diagnostic_source}: skipping non-UTF-8 path (cannot emit faithful UTF-8 event): {}",
            path.to_string_lossy()
        );
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_maps_create_modify_remove() {
        assert_eq!(
            classify(EventKind::Create(notify::event::CreateKind::File)),
            Some(SimpleEventKind::Created)
        );
        assert_eq!(
            classify(EventKind::Modify(notify::event::ModifyKind::Any)),
            Some(SimpleEventKind::Modified)
        );
        assert_eq!(
            classify(EventKind::Remove(notify::event::RemoveKind::File)),
            Some(SimpleEventKind::Removed)
        );
    }

    #[test]
    fn classify_ignores_other_kinds() {
        assert_eq!(classify(EventKind::Access(notify::event::AccessKind::Any)), None);
    }

    #[test]
    fn utf8_path_or_skip_converts_valid_utf8() {
        let p = std::path::Path::new("/tmp/valid.fits");
        assert_eq!(utf8_path_or_skip(p, "test"), Some(Utf8PathBuf::from("/tmp/valid.fits")));
    }
}
