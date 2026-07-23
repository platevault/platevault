// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Notes file adapter for spec 024.
//!
//! Reads and writes `<project_root>/notes/project-notes.md` atomically.
//! The disk file is the projection; the database row is the durable record.
//!
//! Constitution II: writes are atomic (temp-file + rename). Failed writes
//! leave the existing file intact.

use std::path::Path;

/// Adapter trait for the notes file, making the adapter testable without real
/// I/O. Implement this trait with a test double in unit tests that must avoid
/// filesystem access; use [`RealNotesAdapter`] in production.
pub trait NotesFileAdapter: Send + Sync {
    /// Write `content` to `notes/project-notes.md` under `project_root`,
    /// creating the `notes/` directory if needed.
    ///
    /// The write is atomic: the content is first written to a temp file and
    /// then renamed into place. An empty `content` string removes the file.
    ///
    /// # Errors
    /// Returns a descriptive error string on I/O failure.
    fn write<'a>(
        &'a self,
        project_root: &'a Path,
        content: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>>;

    /// Read `notes/project-notes.md` under `project_root`.
    ///
    /// Returns `Ok(None)` when the file does not exist.
    ///
    /// # Errors
    /// Returns a descriptive error string on I/O failure (other than
    /// `NotFound`).
    fn read<'a>(
        &'a self,
        project_root: &'a Path,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Option<String>, String>> + Send + 'a>,
    >;
}

/// Canonical file name for the notes file inside the project's `notes/` folder.
pub const NOTES_FILENAME: &str = "project-notes.md";

/// Real (non-mock) implementation backed by `std::fs`.
///
/// spec 042 (T251): the notes I/O is synchronous `std::fs` (atomic tmp +
/// rename, directory creation), wrapped in an immediately-ready future so the
/// async [`NotesFileAdapter`] seam — and the exact behaviour consumers rely on
/// — is preserved without pulling `tokio` into this pure project-envelope
/// crate. The async runtime now lives entirely in the consumer.
#[derive(Clone, Copy, Debug, Default)]
pub struct RealNotesAdapter;

impl RealNotesAdapter {
    /// Synchronous notes write (atomic tmp + rename; empty content removes the
    /// file). Shared by the async trait impl.
    fn write_sync(project_root: &Path, content: &str) -> Result<(), String> {
        let notes_dir = project_root.join("notes");
        std::fs::create_dir_all(&notes_dir)
            .map_err(|e| format!("create notes dir {}: {e}", notes_dir.display()))?;

        let target = notes_dir.join(NOTES_FILENAME);

        if content.is_empty() {
            // Empty content → remove the file (best-effort; not-found is ok).
            match std::fs::remove_file(&target) {
                Ok(()) | Err(_) => {}
            }
            return Ok(());
        }

        // Atomic write: write to temp file, then rename.
        let tmp_path = notes_dir.join(".project-notes.md.tmp");
        std::fs::write(&tmp_path, content.as_bytes())
            .map_err(|e| format!("write tmp notes {}: {e}", tmp_path.display()))?;

        std::fs::rename(&tmp_path, &target).map_err(|e| {
            format!("rename notes {} -> {}: {e}", tmp_path.display(), target.display())
        })?;

        Ok(())
    }

    /// Synchronous notes read; `Ok(None)` when the file does not exist.
    fn read_sync(project_root: &Path) -> Result<Option<String>, String> {
        let target = project_root.join("notes").join(NOTES_FILENAME);
        match std::fs::read_to_string(&target) {
            Ok(content) => Ok(Some(content)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("read notes {}: {e}", target.display())),
        }
    }
}

impl NotesFileAdapter for RealNotesAdapter {
    fn write<'a>(
        &'a self,
        project_root: &'a Path,
        content: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move { Self::write_sync(project_root, content) })
    }

    fn read<'a>(
        &'a self,
        project_root: &'a Path,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Option<String>, String>> + Send + 'a>,
    > {
        Box::pin(async move { Self::read_sync(project_root) })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn write_creates_notes_file() {
        let dir = tempfile::tempdir().unwrap();
        let adapter = RealNotesAdapter;
        adapter.write(dir.path(), "Hello notes").await.unwrap();
        let content = std::fs::read_to_string(dir.path().join("notes/project-notes.md")).unwrap();
        assert_eq!(content, "Hello notes");
    }

    #[tokio::test]
    async fn write_empty_removes_file() {
        let dir = tempfile::tempdir().unwrap();
        let adapter = RealNotesAdapter;
        adapter.write(dir.path(), "Some content").await.unwrap();
        adapter.write(dir.path(), "").await.unwrap();
        let target = dir.path().join("notes/project-notes.md");
        assert!(!target.exists());
    }

    #[tokio::test]
    async fn read_returns_none_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let adapter = RealNotesAdapter;
        let result = adapter.read(dir.path()).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn read_returns_content() {
        let dir = tempfile::tempdir().unwrap();
        let adapter = RealNotesAdapter;
        adapter.write(dir.path(), "# My Notes\n\nContent here.").await.unwrap();
        let result = adapter.read(dir.path()).await.unwrap();
        assert_eq!(result.as_deref(), Some("# My Notes\n\nContent here."));
    }

    #[tokio::test]
    async fn write_overwrites_existing() {
        let dir = tempfile::tempdir().unwrap();
        let adapter = RealNotesAdapter;
        adapter.write(dir.path(), "First").await.unwrap();
        adapter.write(dir.path(), "Second").await.unwrap();
        let result = adapter.read(dir.path()).await.unwrap();
        assert_eq!(result.as_deref(), Some("Second"));
    }
}
