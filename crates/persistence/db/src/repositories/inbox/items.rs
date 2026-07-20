// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `inbox_items` rows: item CRUD, single-type sub-items, and the
//! source-group membership columns (spec 005, spec 041 T066).

use domain_core::ids::Timestamp;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::{DbError, DbResult};

/// Flat row from the `inbox_items` table.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxItemRow {
    pub id: String,
    pub root_id: String,
    pub relative_path: String,
    /// FK to `inbox_source_groups`; NULL for legacy `plan_open` rows (migration 0048).
    pub source_group_id: Option<String>,
    /// Deterministic canonical group key (R-11). Empty string for legacy rows.
    pub group_key: String,
    /// Human-readable display label `"(root) · <type> · <dims>"` (R-12).
    pub group_label: Option<String>,
    /// Authoritative frame type for this sub-item; NULL until classified (migration 0048).
    pub frame_type: Option<String>,
    pub file_count: i64,
    pub discovered_at: String,
    pub last_scanned_at: String,
    pub content_signature: Option<String>,
    pub state: String,
    pub lane: String,
    /// File format (`"fits"` | `"xisf"` | `"video"` | `"mixed"`).  Spec 040 FR-006.
    pub format: Option<String>,
    /// Non-zero when this row represents a single detected calibration master file.
    pub is_master_item: i64,
    pub master_frame_type: Option<String>,
    pub master_filter: Option<String>,
    pub master_exposure_s: Option<f64>,
}

/// Data required to insert a new inbox item.
#[derive(Clone, Debug)]
pub struct InsertInboxItem<'a> {
    pub id: &'a str,
    pub root_id: &'a str,
    pub relative_path: &'a str,
    pub file_count: i64,
    pub content_signature: Option<&'a str>,
    pub lane: &'a str,
}

/// Backfill the folder PLACEHOLDER item's (`group_key = ''`) link to its
/// source group when the link is still NULL (rows inserted before scan wrote
/// the link, or by older builds). Materialized single-type sub-items carry
/// their own linkage and are deliberately not touched.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn link_placeholder_to_source_group(
    pool: &SqlitePool,
    root_id: &str,
    relative_path: &str,
    source_group_id: &str,
) -> DbResult<()> {
    sqlx::query(
        "UPDATE inbox_items SET source_group_id = ?
         WHERE root_id = ? AND relative_path = ? AND group_key = ''
           AND source_group_id IS NULL",
    )
    .bind(source_group_id)
    .bind(root_id)
    .bind(relative_path)
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert a new inbox item in `pending_classification` state.
///
/// # Errors
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn insert_inbox_item(pool: &SqlitePool, item: &InsertInboxItem<'_>) -> DbResult<()> {
    let now = Timestamp::now_iso();
    sqlx::query(
        "INSERT INTO inbox_items
            (id, root_id, relative_path, file_count, discovered_at, last_scanned_at,
             content_signature, state, lane)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_classification', ?)",
    )
    .bind(item.id)
    .bind(item.root_id)
    .bind(item.relative_path)
    .bind(item.file_count)
    .bind(&now)
    .bind(&now)
    .bind(item.content_signature)
    .bind(item.lane)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetch an inbox item by ID. Returns `DbError::NotFound` if absent.
///
/// # Errors
/// Returns [`DbError::NotFound`] or [`DbError::Database`].
pub async fn get_inbox_item(pool: &SqlitePool, id: &str) -> DbResult<InboxItemRow> {
    sqlx::query_as::<_, InboxItemRow>("SELECT * FROM inbox_items WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("InboxItem not found: {id}")))
}

/// Update `state` and `last_scanned_at` for an inbox item.
///
/// # Errors
/// Returns [`DbError::NotFound`] if no row was updated, or [`DbError::Database`].
pub async fn update_inbox_item_state(pool: &SqlitePool, id: &str, state: &str) -> DbResult<()> {
    let now = Timestamp::now_iso();
    let rows = sqlx::query("UPDATE inbox_items SET state = ?, last_scanned_at = ? WHERE id = ?")
        .bind(state)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();

    if rows == 0 {
        return Err(DbError::NotFound(format!("InboxItem not found: {id}")));
    }
    Ok(())
}

/// Update `content_signature` and `file_count` (and `last_scanned_at`).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn update_inbox_item_scan(
    pool: &SqlitePool,
    id: &str,
    content_signature: &str,
    file_count: i64,
) -> DbResult<()> {
    let now = Timestamp::now_iso();
    sqlx::query(
        "UPDATE inbox_items
         SET content_signature = ?, file_count = ?, last_scanned_at = ?
         WHERE id = ?",
    )
    .bind(content_signature)
    .bind(file_count)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

// ── Sub-item CRUD (spec 041 T066) ─────────────────────────────────────────────

/// Data required to upsert one single-type `inbox_items` sub-item row.
///
/// Identity = `(root_id, relative_path, group_key)` — the UNIQUE constraint
/// from migration 0048. On conflict the mutable fields are updated so rescans
/// of unchanged content converge to the same row (FR-042 determinism).
#[derive(Clone, Debug)]
pub struct UpsertInboxSubItem<'a> {
    pub id: &'a str,
    pub root_id: &'a str,
    /// Relative path of the *source folder* (same as the source group's path).
    pub relative_path: &'a str,
    pub source_group_id: &'a str,
    /// Deterministic canonical group key (R-11).
    pub group_key: &'a str,
    /// Human-readable label `"(root) · <type> · <dims>"` (R-12).
    pub group_label: &'a str,
    /// Authoritative frame type for this group (CHECK constraint values only).
    pub frame_type: Option<&'a str>,
    /// Per-sub-group content signature (R-11): folder_signature over the sorted
    /// per-file signatures of only the files belonging to this group.
    pub content_signature: &'a str,
    /// Number of files in this group.
    pub file_count: i64,
    pub lane: &'a str,
}

/// Upsert one single-type `inbox_items` sub-item row (spec 041 T066, R-9/R-11).
///
/// The identity `(root_id, relative_path, group_key)` is stable across rescans
/// when file content is unchanged (FR-042). On conflict the signature, label,
/// file_count, and state are refreshed.
///
/// # Errors
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn upsert_inbox_sub_item(
    pool: &SqlitePool,
    item: &UpsertInboxSubItem<'_>,
) -> DbResult<String> {
    let now = Timestamp::now_iso();
    // `RETURNING id` yields the id of the row that actually persists: the new
    // `item.id` on INSERT, but the PRE-EXISTING row's id on ON CONFLICT DO
    // UPDATE. Callers MUST seed evidence/metadata/classification against this
    // returned id, never the caller-supplied `item.id` — on a conflicting
    // re-materialization the two diverge and seeding the discarded fresh id
    // FK-fails (inbox_classification_evidence/inbox_classifications reference
    // inbox_items(id) ON DELETE CASCADE), silently orphaning the real row's
    // cache rows and stranding it evidence-less (issue #854).
    let (persisted_id,): (String,) = sqlx::query_as(
        "INSERT INTO inbox_items
            (id, root_id, relative_path, source_group_id, group_key, group_label,
             frame_type, file_count, discovered_at, last_scanned_at,
             content_signature, state, lane)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'classified', ?)
         ON CONFLICT(root_id, relative_path, group_key) DO UPDATE SET
             group_label        = excluded.group_label,
             frame_type         = excluded.frame_type,
             file_count         = excluded.file_count,
             last_scanned_at    = excluded.last_scanned_at,
             content_signature  = excluded.content_signature,
             state              = 'classified'
         RETURNING id",
    )
    .bind(item.id)
    .bind(item.root_id)
    .bind(item.relative_path)
    .bind(item.source_group_id)
    .bind(item.group_key)
    .bind(item.group_label)
    .bind(item.frame_type)
    .bind(item.file_count)
    .bind(&now)
    .bind(&now)
    .bind(item.content_signature)
    .bind(item.lane)
    .fetch_one(pool)
    .await?;
    Ok(persisted_id)
}

/// Clear the `__needs_review__` sentinel on an item's `group_key` in place,
/// promoting it to a resolved single-type group (issue #724).
///
/// `reclassify` (v1) determines the item is fully resolved (single frame type,
/// no remaining missing-mandatory files) but — unlike `reclassify_v2` /
/// `materialize_sub_items` — never re-splits into fresh sub-item rows. Without
/// this, `inbox_items.group_key` stays `__needs_review__` forever and
/// `inbox_confirm`'s sentinel gate rejects the item permanently even after
/// every file has been corrected. The new key embeds the item id to guarantee
/// it cannot collide with the `(root_id, relative_path, group_key)` UNIQUE
/// constraint against a sibling group already materialised for this folder.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn clear_needs_review_sentinel(
    pool: &SqlitePool,
    inbox_item_id: &str,
    frame_type: &str,
) -> DbResult<()> {
    let resolved_key = format!("type={frame_type}·resolved={inbox_item_id}");
    sqlx::query(
        "UPDATE inbox_items SET group_key = ?, frame_type = ?, state = 'classified'
         WHERE id = ? AND group_key = '__needs_review__'",
    )
    .bind(&resolved_key)
    .bind(frame_type)
    .bind(inbox_item_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a sub-item row by id, but ONLY when it is not linked to a plan.
///
/// Used by classify re-materialization to purge stale single-type groups that no
/// longer have any files (a file moved groups), without disturbing plan-open
/// items (spec 041 R-11/FR-042; T067 churn regression).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn delete_sub_item_if_unlinked(pool: &SqlitePool, id: &str) -> DbResult<()> {
    sqlx::query(
        "DELETE FROM inbox_items
         WHERE id = ?
           AND id NOT IN (SELECT inbox_item_id FROM inbox_plan_links)",
    )
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// List all single-type sub-items belonging to a source group, ordered by
/// `group_key` for deterministic display (spec 041 T066).
///
/// Excludes placeholder rows (`group_key = ''`) — the transient
/// `pending_classification` placeholder is replaced by the real sub-items once
/// classify runs. Plan-open items retain a non-empty `group_key` so they are
/// included correctly.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_inbox_sub_items(
    pool: &SqlitePool,
    source_group_id: &str,
) -> DbResult<Vec<InboxItemRow>> {
    let rows = sqlx::query_as::<_, InboxItemRow>(
        "SELECT * FROM inbox_items
         WHERE source_group_id = ?
           AND group_key != ''
         ORDER BY group_key",
    )
    .bind(source_group_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── Classification CRUD ───────────────────────────────────────────────────────

/// Fetch the `source_group_id` for a given `inbox_item_id`.
///
/// Returns `None` when the item does not exist or has no source group (legacy
/// pre-T065 items).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_source_group_id_for_item(
    pool: &SqlitePool,
    inbox_item_id: &str,
) -> DbResult<Option<String>> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT source_group_id FROM inbox_items WHERE id = ?")
            .bind(inbox_item_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|(sg,)| sg))
}

/// Find the inbox items belonging to a source group, ordered by id (R-12).
///
/// Used by `inbox.target_recommendations` when the caller passes a
/// `sourceGroupId` instead of an `inboxItemId`.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_item_ids_for_source_group(
    pool: &SqlitePool,
    source_group_id: &str,
) -> DbResult<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT id FROM inbox_items WHERE source_group_id = ? ORDER BY id")
            .bind(source_group_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

// ── Stats aggregates (spec 041 US6) ──────────────────────────────────────────
