//! Project notes disk-sync service.
//!
//! One-way sync: DB -> disk (per research R9). Reads notes from the database
//! for a given project and writes them to the specified directory on disk.
//!
//! Stub implementation — the real version will query notes from the project
//! notes table and write individual markdown/text files.

use std::path::Path;

use sqlx::SqlitePool;

/// Sync project notes from the database to disk.
///
/// Reads all notes associated with `project_id` from the database and writes
/// them as individual files under `notes_dir`. Existing files are overwritten
/// if the database version is newer.
///
/// This is a one-way sync (DB -> disk) per research decision R9. The database
/// is the authoritative store; disk files are reproducible projections.
///
/// # Errors
///
/// Returns an error string if the database query fails, the notes directory
/// cannot be created, or a file write fails.
pub async fn sync_notes_to_disk(
    _pool: &SqlitePool,
    _project_id: &str,
    notes_dir: &Path,
) -> Result<u32, String> {
    // Ensure the target directory exists.
    tokio::fs::create_dir_all(notes_dir)
        .await
        .map_err(|e| format!("failed to create notes directory {}: {e}", notes_dir.display()))?;

    // Stub: no notes to sync yet. The real implementation will:
    // 1. Query `project_notes` table for all notes with matching project_id.
    // 2. For each note, write content to `notes_dir/{note_slug}.md`.
    // 3. Return the count of files written.
    tracing::debug!(
        "stub: sync_notes_to_disk project_id=<redacted> notes_dir={}",
        notes_dir.display()
    );

    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sync_returns_zero_for_stub() {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory pool");
        let dir = std::env::temp_dir().join("astro-test-notes-sync");
        let result = sync_notes_to_disk(&pool, "proj-001", &dir).await;
        assert_eq!(result.unwrap(), 0);
        // Clean up.
        let _ = std::fs::remove_dir_all(&dir);
    }
}
