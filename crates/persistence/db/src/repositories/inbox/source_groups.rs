// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `inbox_source_groups` rows: per-leaf-folder scan records
//! (spec 041, migration 0044).

use domain_core::ids::Timestamp;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::DbResult;

/// Flat row from the `inbox_source_groups` table (spec 041, migration 0048).
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxSourceGroupRow {
    pub id: String,
    pub root_id: String,
    pub relative_path: String,
    pub discovered_at: String,
    pub last_scanned_at: String,
    pub content_signature: Option<String>,
    pub format: Option<String>,
    pub lane: Option<String>,
    pub child_count: i64,
}

/// Data required to upsert one `inbox_source_groups` row at scan time.
///
/// On first discovery the row is inserted; on rescan `last_scanned_at` and
/// `content_signature` are refreshed via `ON CONFLICT … DO UPDATE`.
/// `discovered_at` and `child_count` are preserved on conflict so repeated
/// scans do not reset the discovery timestamp or lose the classify-written
/// child_count.
#[derive(Clone, Debug)]
pub struct UpsertSourceGroup<'a> {
    pub id: &'a str,
    pub root_id: &'a str,
    pub relative_path: &'a str,
    pub content_signature: Option<&'a str>,
    /// Dominant file format: `"fits"` | `"xisf"` | `"video"` | `"mixed"`.
    pub format: Option<&'a str>,
    /// Move-vs-catalogue lane: `"move"` (unorganized) or `"catalogue"` (organized).
    pub lane: Option<&'a str>,
}

/// Upsert one `inbox_source_groups` row (spec 041 T065, R-10/R-12).
///
/// INSERT on first scan; on rescan updates `last_scanned_at` and
/// `content_signature` only — preserves `discovered_at` and `child_count`.
///
/// # Errors
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn upsert_inbox_source_group(
    pool: &SqlitePool,
    group: &UpsertSourceGroup<'_>,
) -> DbResult<()> {
    let now = Timestamp::now_iso();
    sqlx::query(
        "INSERT INTO inbox_source_groups
            (id, root_id, relative_path, discovered_at, last_scanned_at,
             content_signature, format, lane, child_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(root_id, relative_path) DO UPDATE SET
             last_scanned_at   = excluded.last_scanned_at,
             content_signature = excluded.content_signature,
             format            = excluded.format,
             lane              = excluded.lane",
    )
    .bind(group.id)
    .bind(group.root_id)
    .bind(group.relative_path)
    .bind(&now)
    .bind(&now)
    .bind(group.content_signature)
    .bind(group.format)
    .bind(group.lane)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetch one `inbox_source_groups` row by `(root_id, relative_path)`.
///
/// Returns `None` when no matching row exists.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_inbox_source_group_by_path(
    pool: &SqlitePool,
    root_id: &str,
    relative_path: &str,
) -> DbResult<Option<InboxSourceGroupRow>> {
    let row = sqlx::query_as::<_, InboxSourceGroupRow>(
        "SELECT id, root_id, relative_path, discovered_at, last_scanned_at,
                content_signature, format, lane, child_count
         FROM inbox_source_groups
         WHERE root_id = ? AND relative_path = ?",
    )
    .bind(root_id)
    .bind(relative_path)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Most recent `inbox_source_groups.last_scanned_at` per `root_id` (P6a —
/// `roots.list`'s `lastScanned` field).
///
/// `inbox_source_groups.root_id` is not FK-constrained to any legacy table
/// (unlike `file_record`), so it holds `registered_sources` ids directly for
/// every root kind that has ever been scanned via `inbox.scan_folder`
/// (raw/calibration/project/inbox — the setup wizard and Settings "Rescan"
/// both scan every kind, not just inbox sources). Roots with no source-group
/// rows (never scanned) are simply absent from the returned map.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn last_scanned_by_root(
    pool: &SqlitePool,
) -> DbResult<std::collections::HashMap<String, String>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT root_id, MAX(last_scanned_at) FROM inbox_source_groups GROUP BY root_id",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

// ── InboxItem CRUD ────────────────────────────────────────────────────────────

/// Update `child_count` on a source group to reflect how many single-type
/// sub-items were materialised during classify (spec 041 T066, R-12).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn update_source_group_child_count(
    pool: &SqlitePool,
    source_group_id: &str,
    child_count: i64,
) -> DbResult<()> {
    sqlx::query("UPDATE inbox_source_groups SET child_count = ? WHERE id = ?")
        .bind(child_count)
        .bind(source_group_id)
        .execute(pool)
        .await?;
    Ok(())
}
