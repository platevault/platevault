// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `inbox_source_groups` rows: per-leaf-folder scan records
//! (spec 041, migration 0044).

use domain_core::ids::Timestamp;
use serde::{Deserialize, Serialize};
use sqlx::{Executor, Sqlite, SqliteConnection, SqlitePool};

use persistence_core::DbResult;

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
    /// Files the scan found in the folder, excluding detected calibration
    /// masters (which get their own item rows). Refreshed on every rescan.
    pub file_count: i64,
}

/// Upsert one `inbox_source_groups` row (spec 041 T065, R-10/R-12).
///
/// INSERT on first scan; on rescan updates `last_scanned_at` and
/// `content_signature` only — preserves `discovered_at` and `child_count`.
///
/// Accepts any [`sqlx::Executor`] so callers can pass either `&SqlitePool`
/// (auto-commit) or `&mut Transaction` (batched commit).
///
/// # Errors
/// Returns `persistence_core::DbError::Database` on constraint or connection failure.
pub async fn upsert_inbox_source_group<'e, E>(
    executor: E,
    group: &UpsertSourceGroup<'_>,
) -> DbResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    let now = Timestamp::now_iso();
    sqlx::query(
        "INSERT INTO inbox_source_groups
            (id, root_id, relative_path, discovered_at, last_scanned_at,
             content_signature, format, lane, child_count, file_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(root_id, relative_path) DO UPDATE SET
             last_scanned_at   = excluded.last_scanned_at,
             content_signature = excluded.content_signature,
             format            = excluded.format,
             lane              = excluded.lane,
             file_count        = excluded.file_count",
    )
    .bind(group.id)
    .bind(group.root_id)
    .bind(group.relative_path)
    .bind(&now)
    .bind(&now)
    .bind(group.content_signature)
    .bind(group.format)
    .bind(group.lane)
    .bind(group.file_count)
    .execute(executor)
    .await?;
    Ok(())
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
/// Returns `persistence_core::DbError::Database` on query failure.
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

/// Connection-level variant of `update_source_group_child_count`.
///
/// # Errors
/// Returns `persistence_core::DbError::Database` on connection failure.
pub async fn update_source_group_child_count_conn(
    conn: &mut SqliteConnection,
    source_group_id: &str,
    child_count: i64,
) -> DbResult<()> {
    sqlx::query("UPDATE inbox_source_groups SET child_count = ? WHERE id = ?")
        .bind(child_count)
        .bind(source_group_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Delete every inbox row stored for the folder `relative_path` under
/// `root_id` — its items, the source groups at that path, and through their
/// `ON DELETE CASCADE` keys the items' classification, evidence, breakdown,
/// file metadata and the groups' file overrides — when all of them are
/// unconfirmed.
///
/// The folder's rows are the items that are not masters at that path or in a
/// source group at that path. They are unconfirmed when each is still
/// `pending_classification` or `classified` and no plan links it. When any is
/// not, nothing at that path is deleted, so a confirmed or plan-linked
/// sub-item keeps its siblings, its group and the group's overrides.
///
/// A master item is never one of the folder's rows. A master file can be
/// stored at the same path, as `g/h.fits` is when an earlier scan stored the
/// folder `g\h.fits` under that text (bd astro-plan-3pvvc), and its own
/// source group (the one `set_overrides` creates) is then a group at that
/// path. The master item, its state and its group stay; only the overrides
/// that group holds for files below that path, the folder's, are deleted.
///
/// # Errors
/// Returns `persistence_core::DbError::Database` on connection failure.
pub async fn delete_unconfirmed_folder_rows_conn(
    conn: &mut SqliteConnection,
    root_id: &str,
    relative_path: &str,
) -> DbResult<()> {
    // The folder's items, as one literal in each statement: sqlx accepts only
    // literal SQL here.
    let kept: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM inbox_items
         WHERE root_id = ?1 AND is_master_item = 0
           AND (relative_path = ?2
                OR source_group_id IN (
                    SELECT id FROM inbox_source_groups WHERE root_id = ?1 AND relative_path = ?2))
           AND (state NOT IN ('pending_classification', 'classified')
                OR id IN (SELECT inbox_item_id FROM inbox_plan_links))",
    )
    .bind(root_id)
    .bind(relative_path)
    .fetch_one(&mut *conn)
    .await?;
    if kept > 0 {
        return Ok(());
    }
    sqlx::query(
        "DELETE FROM inbox_items
         WHERE root_id = ?1 AND is_master_item = 0
           AND (relative_path = ?2
                OR source_group_id IN (
                    SELECT id FROM inbox_source_groups WHERE root_id = ?1 AND relative_path = ?2))",
    )
    .bind(root_id)
    .bind(relative_path)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "DELETE FROM inbox_file_overrides
         WHERE source_group_id IN (
                   SELECT id FROM inbox_source_groups WHERE root_id = ?1 AND relative_path = ?2)
           AND substr(relative_file_path, 1, length(?2) + 1) = ?2 || '/'",
    )
    .bind(root_id)
    .bind(relative_path)
    .execute(&mut *conn)
    .await?;
    delete_unreferenced_groups_at_conn(conn, root_id, relative_path).await
}

/// Delete the source groups at `relative_path` under `root_id` that no inbox
/// item refers to; their file overrides go with them.
pub(super) async fn delete_unreferenced_groups_at_conn(
    conn: &mut SqliteConnection,
    root_id: &str,
    relative_path: &str,
) -> DbResult<()> {
    sqlx::query(
        "DELETE FROM inbox_source_groups
         WHERE root_id = ? AND relative_path = ?
           AND NOT EXISTS (
               SELECT 1 FROM inbox_items WHERE inbox_items.source_group_id = inbox_source_groups.id
           )",
    )
    .bind(root_id)
    .bind(relative_path)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// One scanned-but-unclassified folder for the Inbox list (spec 058 FR-016).
///
/// Deliberately carries no item id: a source-group row is non-confirmable
/// *structurally*, because there is nothing to pass to `inbox.confirm` — not
/// because a guard refuses one.
///
/// `lane` is the source group's `move`/`catalogue` value, NOT the `fits`/`video`
/// item lane. The two columns share a name and do not share a meaning.
#[derive(Clone, Debug, sqlx::FromRow)]
pub struct InboxSourceGroupListRow {
    pub id: String,
    pub root_id: String,
    pub root_path: String,
    pub relative_path: String,
    pub file_count: i64,
    pub format: Option<String>,
    pub lane: Option<String>,
    pub content_signature: Option<String>,
    pub discovered_at: String,
}

/// List source groups that have produced **no** `inbox_items` rows yet — the
/// folders scan has discovered but classification has not yet split (FR-016).
///
/// FR-017 ("the source-group row is replaced by the folder's item rows") falls
/// out of this predicate rather than being a separate step: the moment
/// `materialize_sub_items` writes item rows the group stops matching here and
/// its items appear in the item list instead.
///
/// `file_count > 0` carries the FR-015 master carve-out. A folder of detected
/// calibration masters has nothing left for classification to split, and its
/// masters are `inbox_items` rows with a NULL `source_group_id`
/// (`q_desktop.rs::insert_inbox_master_item`), stored under the master FILE's
/// own `relative_path` (`scan.rs` `rel_path`) rather than the folder's — so
/// the `NOT EXISTS` clause alone would surface such a folder as an
/// unclassified row *in addition to* the master rows already representing
/// it. Scan writes `file_count` excluding masters, so that folder scores 0
/// here.
///
/// # Errors
/// Returns `persistence_core::DbError::Database` on connection failure.
pub async fn list_unclassified_source_groups(
    pool: &SqlitePool,
    limit: i64,
) -> DbResult<Vec<InboxSourceGroupListRow>> {
    let rows = sqlx::query_as::<_, InboxSourceGroupListRow>(
        "SELECT
             g.id,
             g.root_id,
             r.path AS root_path,
             g.relative_path,
             g.file_count,
             g.format,
             g.lane,
             g.content_signature,
             g.discovered_at
         FROM inbox_source_groups g
         JOIN registered_sources r ON r.id = g.root_id
         WHERE g.file_count > 0
           AND NOT EXISTS (
             SELECT 1 FROM inbox_items i WHERE i.source_group_id = g.id
         )
         ORDER BY r.path, g.relative_path
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
