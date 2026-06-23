//! Repository methods for Inbox items, classifications, evidence, and plan links
//! (spec 005, migration 0020).
//!
//! All state-machine enforcement lives in `crates/app/core/src/inbox/`.

use domain_core::ids::Timestamp;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::{DbError, DbResult};

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Row types ─────────────────────────────────────────────────────────────────

/// Flat row from the `inbox_items` table.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxItemRow {
    pub id: String,
    pub root_id: String,
    pub relative_path: String,
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

/// Flat row from `inbox_classifications`.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxClassificationRow {
    pub inbox_item_id: String,
    pub result: String,
    pub frame_type: Option<String>,
    pub computed_at: String,
    pub content_signature: String,
    pub unclassified_file_count: i64,
}

/// Data to upsert an `inbox_classifications` row.
#[derive(Clone, Debug)]
pub struct UpsertClassification<'a> {
    pub inbox_item_id: &'a str,
    pub result: &'a str,
    pub frame_type: Option<&'a str>,
    pub content_signature: &'a str,
    pub unclassified_file_count: i64,
}

/// Flat row from `inbox_classification_evidence`, joined with per-file override
/// values from `inbox_file_overrides` (migration 0048).
///
/// The three non-type override fields (`override_filter`, `override_exposure_s`,
/// `override_binning`) are now sourced from `inbox_file_overrides` via the
/// `list_evidence` JOIN query. The struct API is stable so that callers in
/// `app_core` continue to read `row.override_filter` etc. unchanged.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxEvidenceRow {
    pub id: String,
    pub inbox_item_id: String,
    pub relative_file_path: String,
    pub frame_type: Option<String>,
    pub evidence_source: String,
    pub raw_value: Option<String>,
    pub unclassified: i64,
    pub manual_override: Option<String>,
    /// 1 when this file was detected as a calibration master (spec 040). Needed
    /// by the confirm path (spec 041 T052) to select the master destination
    /// pattern variant per file.
    pub is_master: i64,
    /// Non-type override fields (migration 0048): populated from
    /// `inbox_file_overrides` (property_key = 'filter'/'exposureS'/'binning')
    /// via the JOIN in `list_evidence`. NULL when no override has been set.
    pub override_filter: Option<String>,
    pub override_exposure_s: Option<f64>,
    pub override_binning: Option<String>,
    /// 1 when any override recorded for this file is stale (file size/mtime
    /// changed since it was set — spec 041 R-4).
    pub override_stale: i64,
}

/// Data to insert an `inbox_classification_evidence` row.
#[derive(Clone, Debug)]
pub struct InsertEvidence<'a> {
    pub id: &'a str,
    pub inbox_item_id: &'a str,
    pub relative_file_path: &'a str,
    pub frame_type: Option<&'a str>,
    pub evidence_source: &'a str,
    pub raw_value: Option<&'a str>,
    pub unclassified: bool,
    pub manual_override: Option<&'a str>,
    /// Whether this file was detected as a calibration master (spec 040).
    pub is_master: bool,
    /// Provenance string from the detector, e.g. `"siril"` or `"pixinsight"`.
    pub master_detector: Option<&'a str>,
}

/// Flat row from `inbox_classification_breakdown`.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxBreakdownRow {
    pub id: String,
    pub inbox_item_id: String,
    pub kind: String,
    pub count: i64,
    pub destination_preview: Option<String>,
    pub sample_files: String,
}

/// Flat row from `inbox_file_metadata` (spec 041 US2, migration 0045).
///
/// Per-file extracted image-header metadata, keyed 1:1 with the matching
/// `inbox_classification_evidence` row by `(inbox_item_id, relative_file_path)`.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxFileMetadataRow {
    pub id: String,
    pub inbox_item_id: String,
    pub relative_file_path: String,
    pub filter: Option<String>,
    pub exposure_s: Option<f64>,
    pub gain: Option<String>,
    pub binning_x: Option<i64>,
    pub binning_y: Option<i64>,
    pub temperature_c: Option<f64>,
    pub object: Option<String>,
    pub date_obs: Option<String>,
    pub instrume: Option<String>,
    pub telescop: Option<String>,
    pub naxis1: Option<i64>,
    pub naxis2: Option<i64>,
    pub stack_count: Option<i64>,
    pub file_size_bytes: Option<i64>,
    pub file_mtime: Option<String>,
}

/// Data to upsert one `inbox_file_metadata` row (spec 041 US2).
///
/// `gain` stays a string: some cameras report a non-integer/scaled gain value,
/// so the column is TEXT and we never coerce it to a number.
#[derive(Clone, Debug, Default)]
pub struct UpsertFileMetadata<'a> {
    pub inbox_item_id: &'a str,
    pub relative_file_path: &'a str,
    pub filter: Option<&'a str>,
    pub exposure_s: Option<f64>,
    pub gain: Option<&'a str>,
    pub binning_x: Option<i64>,
    pub binning_y: Option<i64>,
    pub temperature_c: Option<f64>,
    pub object: Option<&'a str>,
    pub date_obs: Option<&'a str>,
    pub instrume: Option<&'a str>,
    pub telescop: Option<&'a str>,
    pub naxis1: Option<i64>,
    pub naxis2: Option<i64>,
    pub stack_count: Option<i64>,
    pub file_size_bytes: Option<i64>,
    pub file_mtime: Option<&'a str>,
}

/// Flat row from `inbox_plan_links`.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxPlanLinkRow {
    pub inbox_item_id: String,
    pub plan_id: String,
    pub linked_at: String,
}

// ── SourceGroup CRUD ──────────────────────────────────────────────────────────

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

// ── InboxItem CRUD ────────────────────────────────────────────────────────────

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

// ── Classification CRUD ───────────────────────────────────────────────────────

/// Upsert the `inbox_classifications` row for an item.
///
/// # Errors
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn upsert_classification(
    pool: &SqlitePool,
    c: &UpsertClassification<'_>,
) -> DbResult<()> {
    let now = Timestamp::now_iso();
    sqlx::query(
        "INSERT INTO inbox_classifications
            (inbox_item_id, result, frame_type, computed_at, content_signature,
             unclassified_file_count)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(inbox_item_id) DO UPDATE SET
             result = excluded.result,
             frame_type = excluded.frame_type,
             computed_at = excluded.computed_at,
             content_signature = excluded.content_signature,
             unclassified_file_count = excluded.unclassified_file_count",
    )
    .bind(c.inbox_item_id)
    .bind(c.result)
    .bind(c.frame_type)
    .bind(&now)
    .bind(c.content_signature)
    .bind(c.unclassified_file_count)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetch the classification for an item, if any.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_classification(
    pool: &SqlitePool,
    inbox_item_id: &str,
) -> DbResult<Option<InboxClassificationRow>> {
    Ok(sqlx::query_as::<_, InboxClassificationRow>(
        "SELECT * FROM inbox_classifications WHERE inbox_item_id = ?",
    )
    .bind(inbox_item_id)
    .fetch_optional(pool)
    .await?)
}

// ── Evidence CRUD ─────────────────────────────────────────────────────────────

/// Insert a new evidence row.
///
/// # Errors
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn insert_evidence(pool: &SqlitePool, ev: &InsertEvidence<'_>) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO inbox_classification_evidence
            (id, inbox_item_id, relative_file_path, frame_type, evidence_source,
             raw_value, unclassified, manual_override, is_master, master_detector)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(ev.id)
    .bind(ev.inbox_item_id)
    .bind(ev.relative_file_path)
    .bind(ev.frame_type)
    .bind(ev.evidence_source)
    .bind(ev.raw_value)
    .bind(i64::from(ev.unclassified))
    .bind(ev.manual_override)
    .bind(i64::from(ev.is_master))
    .bind(ev.master_detector)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete all evidence rows for an item (used before re-scan).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn delete_evidence_for_item(pool: &SqlitePool, inbox_item_id: &str) -> DbResult<()> {
    sqlx::query("DELETE FROM inbox_classification_evidence WHERE inbox_item_id = ?")
        .bind(inbox_item_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Fetch all evidence rows for an item.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_evidence(
    pool: &SqlitePool,
    inbox_item_id: &str,
) -> DbResult<Vec<InboxEvidenceRow>> {
    // Join inbox_file_overrides to recover the three non-type override values
    // (filter/exposureS/binning) that were migrated out of the evidence table
    // in migration 0048. The source_group_id is looked up from inbox_items.
    // Three separate LEFT JOINs are used (one per property_key) so that each
    // value is available as a distinct column in the result row, which
    // sqlx::FromRow maps to the named struct fields.
    Ok(sqlx::query_as::<_, InboxEvidenceRow>(
        "SELECT
             ice.id,
             ice.inbox_item_id,
             ice.relative_file_path,
             ice.frame_type,
             ice.evidence_source,
             ice.raw_value,
             ice.unclassified,
             ice.manual_override,
             ice.is_master,
             ov_filter.value   AS override_filter,
             CAST(ov_exp.value AS REAL) AS override_exposure_s,
             ov_bin.value      AS override_binning,
             ice.override_stale
         FROM inbox_classification_evidence ice
         LEFT JOIN inbox_items ii
             ON ii.id = ice.inbox_item_id
         LEFT JOIN inbox_file_overrides ov_filter
             ON ov_filter.source_group_id = ii.source_group_id
            AND ov_filter.relative_file_path = ice.relative_file_path
            AND ov_filter.property_key = 'filter'
         LEFT JOIN inbox_file_overrides ov_exp
             ON ov_exp.source_group_id = ii.source_group_id
            AND ov_exp.relative_file_path = ice.relative_file_path
            AND ov_exp.property_key = 'exposureS'
         LEFT JOIN inbox_file_overrides ov_bin
             ON ov_bin.source_group_id = ii.source_group_id
            AND ov_bin.relative_file_path = ice.relative_file_path
            AND ov_bin.property_key = 'binning'
         WHERE ice.inbox_item_id = ?
         ORDER BY ice.relative_file_path",
    )
    .bind(inbox_item_id)
    .fetch_all(pool)
    .await?)
}

/// Apply a manual override to one evidence row.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn set_manual_override(
    pool: &SqlitePool,
    inbox_item_id: &str,
    relative_file_path: &str,
    override_type: &str,
) -> DbResult<bool> {
    let rows = sqlx::query(
        "UPDATE inbox_classification_evidence
         SET manual_override = ?, evidence_source = 'manual_override'
         WHERE inbox_item_id = ? AND relative_file_path = ?",
    )
    .bind(override_type)
    .bind(inbox_item_id)
    .bind(relative_file_path)
    .execute(pool)
    .await?
    .rows_affected();

    Ok(rows > 0)
}

/// Apply a full set of non-type overrides (filter, exposure, binning) and
/// optionally a frame-type override.
///
/// After migration 0048 the non-type overrides (filter/exposure_s/binning) are
/// stored in `inbox_file_overrides` keyed by `(source_group_id,
/// relative_file_path, property_key)`. This function:
///
///   1. Looks up `source_group_id` from `inbox_items` for the given item.
///   2. Upserts each non-None non-type value into `inbox_file_overrides`.
///   3. Updates `manual_override` on the evidence row (frame-type correction).
///   4. Resets `override_stale = 0` on the evidence row.
///
/// `source_group_id` may be NULL for pre-0048 migrated items; in that case the
/// non-type overrides are silently skipped (only frame-type is written). This
/// is safe because: (a) legacy `plan_open` items cannot be reclassified until
/// their plan resolves; (b) on next classify after plan close, classify creates
/// a proper source group and overrides can be re-applied via the UI.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn set_overrides(
    pool: &SqlitePool,
    inbox_item_id: &str,
    relative_file_path: &str,
    frame_type: Option<&str>,
    filter: Option<&str>,
    exposure_s: Option<f64>,
    binning: Option<&str>,
) -> DbResult<bool> {
    use uuid::Uuid;

    // Step 1: update manual_override + reset override_stale on the evidence row.
    let rows = sqlx::query(
        "UPDATE inbox_classification_evidence
         SET manual_override = COALESCE(?, manual_override),
             override_stale  = 0,
             evidence_source = 'manual_override'
         WHERE inbox_item_id = ? AND relative_file_path = ?",
    )
    .bind(frame_type)
    .bind(inbox_item_id)
    .bind(relative_file_path)
    .execute(pool)
    .await?
    .rows_affected();

    // Step 2: look up source_group_id from inbox_items.
    let source_group_id: Option<String> = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT source_group_id FROM inbox_items WHERE id = ?",
    )
    .bind(inbox_item_id)
    .fetch_optional(pool)
    .await?
    .and_then(|(sg,)| sg);

    // Step 3: upsert non-type overrides into inbox_file_overrides.
    // Skip when source_group_id is NULL (legacy plan_open migration path).
    if let Some(ref sg_id) = source_group_id {
        let now = time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());

        // Helper: upsert a single property_key/value pair.
        // Uses INSERT OR REPLACE so subsequent set_overrides calls overwrite.
        let upsert_override = |key: &'static str, val: String| {
            let id = Uuid::new_v4().to_string();
            let sg = sg_id.clone();
            let rfp = relative_file_path.to_owned();
            let ts = now.clone();
            async move {
                sqlx::query(
                    "INSERT INTO inbox_file_overrides \
                     (id, source_group_id, relative_file_path, property_key, value, \
                      override_stale, set_at) \
                     VALUES (?, ?, ?, ?, ?, 0, ?) \
                     ON CONFLICT(source_group_id, relative_file_path, property_key) \
                     DO UPDATE SET value = excluded.value, \
                                   override_stale = 0, \
                                   set_at = excluded.set_at",
                )
                .bind(id)
                .bind(sg)
                .bind(rfp)
                .bind(key)
                .bind(val)
                .bind(ts)
                .execute(pool)
                .await
            }
        };

        if let Some(f) = filter {
            upsert_override("filter", f.to_owned()).await?;
        }
        if let Some(e) = exposure_s {
            upsert_override("exposureS", e.to_string()).await?;
        }
        if let Some(b) = binning {
            upsert_override("binning", b.to_owned()).await?;
        }
    }

    Ok(rows > 0)
}

/// Mark the override for a file as stale (file size/mtime changed since the
/// override was recorded — spec 041 R-4).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn mark_override_stale(
    pool: &SqlitePool,
    inbox_item_id: &str,
    relative_file_path: &str,
) -> DbResult<()> {
    sqlx::query(
        "UPDATE inbox_classification_evidence
         SET override_stale = 1
         WHERE inbox_item_id = ? AND relative_file_path = ?",
    )
    .bind(inbox_item_id)
    .bind(relative_file_path)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetch a single per-file metadata row for an item+path combination.
///
/// Returns `None` when no row has been persisted yet (file not yet classified).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_file_metadata(
    pool: &SqlitePool,
    inbox_item_id: &str,
    relative_file_path: &str,
) -> DbResult<Option<InboxFileMetadataRow>> {
    Ok(sqlx::query_as::<_, InboxFileMetadataRow>(
        "SELECT * FROM inbox_file_metadata
         WHERE inbox_item_id = ? AND relative_file_path = ?",
    )
    .bind(inbox_item_id)
    .bind(relative_file_path)
    .fetch_optional(pool)
    .await?)
}

// ── Breakdown CRUD ────────────────────────────────────────────────────────────

/// Delete all breakdown rows for an item.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn delete_breakdown_for_item(pool: &SqlitePool, inbox_item_id: &str) -> DbResult<()> {
    sqlx::query("DELETE FROM inbox_classification_breakdown WHERE inbox_item_id = ?")
        .bind(inbox_item_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Upsert a single breakdown row.
///
/// # Errors
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn upsert_breakdown_row(
    pool: &SqlitePool,
    id: &str,
    inbox_item_id: &str,
    kind: &str,
    count: i64,
    destination_preview: Option<&str>,
    sample_files_json: &str,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO inbox_classification_breakdown
            (id, inbox_item_id, kind, count, destination_preview, sample_files)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(inbox_item_id, kind) DO UPDATE SET
             count = excluded.count,
             destination_preview = excluded.destination_preview,
             sample_files = excluded.sample_files",
    )
    .bind(id)
    .bind(inbox_item_id)
    .bind(kind)
    .bind(count)
    .bind(destination_preview)
    .bind(sample_files_json)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetch breakdown rows for an item.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_breakdown(
    pool: &SqlitePool,
    inbox_item_id: &str,
) -> DbResult<Vec<InboxBreakdownRow>> {
    Ok(sqlx::query_as::<_, InboxBreakdownRow>(
        "SELECT * FROM inbox_classification_breakdown WHERE inbox_item_id = ? ORDER BY kind",
    )
    .bind(inbox_item_id)
    .fetch_all(pool)
    .await?)
}

// ── File metadata CRUD (spec 041 US2) ─────────────────────────────────────────

/// Upsert one per-file metadata row, keyed on
/// `UNIQUE(inbox_item_id, relative_file_path)`.
///
/// Called from the classify/reclassify loop alongside the evidence row.
///
/// # Errors
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn upsert_inbox_file_metadata(
    pool: &SqlitePool,
    m: &UpsertFileMetadata<'_>,
) -> DbResult<()> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO inbox_file_metadata
            (id, inbox_item_id, relative_file_path, filter, exposure_s, gain,
             binning_x, binning_y, temperature_c, object, date_obs, instrume,
             telescop, naxis1, naxis2, stack_count, file_size_bytes, file_mtime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(inbox_item_id, relative_file_path) DO UPDATE SET
             filter = excluded.filter,
             exposure_s = excluded.exposure_s,
             gain = excluded.gain,
             binning_x = excluded.binning_x,
             binning_y = excluded.binning_y,
             temperature_c = excluded.temperature_c,
             object = excluded.object,
             date_obs = excluded.date_obs,
             instrume = excluded.instrume,
             telescop = excluded.telescop,
             naxis1 = excluded.naxis1,
             naxis2 = excluded.naxis2,
             stack_count = excluded.stack_count,
             file_size_bytes = excluded.file_size_bytes,
             file_mtime = excluded.file_mtime",
    )
    .bind(&id)
    .bind(m.inbox_item_id)
    .bind(m.relative_file_path)
    .bind(m.filter)
    .bind(m.exposure_s)
    .bind(m.gain)
    .bind(m.binning_x)
    .bind(m.binning_y)
    .bind(m.temperature_c)
    .bind(m.object)
    .bind(m.date_obs)
    .bind(m.instrume)
    .bind(m.telescop)
    .bind(m.naxis1)
    .bind(m.naxis2)
    .bind(m.stack_count)
    .bind(m.file_size_bytes)
    .bind(m.file_mtime)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete all per-file metadata rows for an item (used before a re-scan so
/// stale rows do not linger).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn delete_file_metadata_for_item(pool: &SqlitePool, inbox_item_id: &str) -> DbResult<()> {
    sqlx::query("DELETE FROM inbox_file_metadata WHERE inbox_item_id = ?")
        .bind(inbox_item_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Fetch all per-file metadata rows for an item, ordered by relative path.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_inbox_file_metadata(
    pool: &SqlitePool,
    inbox_item_id: &str,
) -> DbResult<Vec<InboxFileMetadataRow>> {
    Ok(sqlx::query_as::<_, InboxFileMetadataRow>(
        "SELECT * FROM inbox_file_metadata WHERE inbox_item_id = ? ORDER BY relative_file_path",
    )
    .bind(inbox_item_id)
    .fetch_all(pool)
    .await?)
}

// ── Stats aggregates (spec 041 US6) ──────────────────────────────────────────

/// Per-frame-type aggregate row returned by [`inbox_stats`].
#[derive(Clone, Debug)]
pub struct InboxStatsRow {
    pub frame_type: String,
    pub folder_count: i64,
    pub master_count: i64,
    pub image_count: i64,
}

/// Aggregate per-frame-type counts across all unacknowledged inbox items.
///
/// "Unacknowledged" = items whose `state` is one of
/// `pending_classification`, `classified`, or `plan_open` — the same
/// predicate used by `list_unacknowledged_across_roots`.
///
/// Semantics per type:
/// - `folder_count` — distinct non-master inbox items that have at least one
///   file of that effective frame type.
/// - `master_count` — evidence rows where `is_master = 1` of that type.
/// - `image_count` — non-master evidence rows of that type.
///
/// Effective frame type = `COALESCE(manual_override, frame_type)`.
/// Rows with NULL effective type (unclassified) are excluded.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn inbox_stats(pool: &SqlitePool) -> DbResult<Vec<InboxStatsRow>> {
    // sqlx does not derive FromRow for plain tuples with more than 3 elements
    // in some configurations, so we map manually via a named intermediate.
    #[derive(sqlx::FromRow)]
    struct StatsRow {
        eff_type: String,
        folder_count: i64,
        master_count: i64,
        image_count: i64,
    }

    let rows = sqlx::query_as::<_, StatsRow>(
        "SELECT
             COALESCE(ev.manual_override, ev.frame_type)          AS eff_type,
             COUNT(DISTINCT CASE WHEN i.is_master_item = 0
                                 THEN i.id END)                   AS folder_count,
             CAST(SUM(CASE WHEN ev.is_master = 1 THEN 1 ELSE 0 END) AS INTEGER)
                                                                   AS master_count,
             CAST(SUM(CASE WHEN ev.is_master = 0 THEN 1 ELSE 0 END) AS INTEGER)
                                                                   AS image_count
         FROM inbox_items i
         JOIN inbox_classification_evidence ev ON ev.inbox_item_id = i.id
         WHERE i.state IN ('pending_classification', 'classified', 'plan_open')
           AND COALESCE(ev.manual_override, ev.frame_type) IS NOT NULL
         GROUP BY eff_type
         ORDER BY eff_type",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| InboxStatsRow {
            frame_type: r.eff_type,
            folder_count: r.folder_count,
            master_count: r.master_count,
            image_count: r.image_count,
        })
        .collect())
}

/// Count distinct unacknowledged inbox folders that carry at least one
/// classified file, across all frame types.
///
/// Unlike summing the per-type `folder_count` returned by [`inbox_stats`], this
/// counts each folder once even when it contains multiple frame types (e.g.
/// lights + darks), so it is the correct value for a "total folders in queue"
/// figure. Uses the same unacknowledged-state predicate as `inbox_stats` and
/// [`list_unacknowledged_across_roots`].
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn count_distinct_inbox_folders(pool: &SqlitePool) -> DbResult<i64> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT i.id)
         FROM inbox_items i
         JOIN inbox_classification_evidence ev ON ev.inbox_item_id = i.id
         WHERE i.state IN ('pending_classification', 'classified', 'plan_open')
           AND COALESCE(ev.manual_override, ev.frame_type) IS NOT NULL",
    )
    .fetch_one(pool)
    .await?;
    Ok(count)
}

// ── Plan link CRUD ────────────────────────────────────────────────────────────

/// Insert a plan link, establishing the "open plan" invariant.
///
/// Fails with [`DbError::Database`] if a link already exists (PK conflict).
///
/// # Errors
/// Returns [`DbError::Database`] on constraint or connection failure.
pub async fn insert_plan_link(
    pool: &SqlitePool,
    inbox_item_id: &str,
    plan_id: &str,
) -> DbResult<()> {
    let now = Timestamp::now_iso();
    sqlx::query(
        "INSERT INTO inbox_plan_links (inbox_item_id, plan_id, linked_at)
         VALUES (?, ?, ?)",
    )
    .bind(inbox_item_id)
    .bind(plan_id)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Fetch the plan link for an item, if any.
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_plan_link(
    pool: &SqlitePool,
    inbox_item_id: &str,
) -> DbResult<Option<InboxPlanLinkRow>> {
    Ok(sqlx::query_as::<_, InboxPlanLinkRow>(
        "SELECT * FROM inbox_plan_links WHERE inbox_item_id = ?",
    )
    .bind(inbox_item_id)
    .fetch_optional(pool)
    .await?)
}

/// Delete the plan link for an item (called when a plan closes).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn delete_plan_link(pool: &SqlitePool, inbox_item_id: &str) -> DbResult<()> {
    sqlx::query("DELETE FROM inbox_plan_links WHERE inbox_item_id = ?")
        .bind(inbox_item_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Fetch the plan link row by plan ID (used by the plan listener).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn get_plan_link_by_plan_id(
    pool: &SqlitePool,
    plan_id: &str,
) -> DbResult<Option<InboxPlanLinkRow>> {
    Ok(sqlx::query_as::<_, InboxPlanLinkRow>("SELECT * FROM inbox_plan_links WHERE plan_id = ?")
        .bind(plan_id)
        .fetch_optional(pool)
        .await?)
}

/// Find all inbox item IDs whose linked plan is in a terminal state.
///
/// Used by the background repair query. (Ref: R-PlanOpen)
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn find_orphaned_plan_links(
    pool: &SqlitePool,
) -> DbResult<Vec<(String, String, String)>> {
    // Returns (inbox_item_id, plan_id, plan_state)
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT l.inbox_item_id, l.plan_id, p.state
         FROM inbox_plan_links l
         JOIN plans p ON p.id = l.plan_id
         WHERE p.state IN ('applied','partially_applied','failed','cancelled','discarded')",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── Cross-root unacknowledged listing ────────────────────────────────────────

/// A row returned by [`list_unacknowledged_across_roots`].
///
/// Carries both the item's own fields and the root path so the UI can group
/// by root without a second query.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxListRow {
    pub id: String,
    pub root_id: String,
    pub root_path: String,
    pub relative_path: String,
    pub file_count: i64,
    pub discovered_at: String,
    pub last_scanned_at: String,
    pub content_signature: Option<String>,
    pub state: String,
    pub lane: String,
    /// Real file format (`"fits"` | `"xisf"` | `"video"` | `"mixed"`).  Spec 040 FR-006.
    pub format: Option<String>,
    /// Non-zero when this row represents a single detected calibration master file.
    pub is_master: i64,
    pub master_frame_type: Option<String>,
    pub master_filter: Option<String>,
    pub master_exposure_s: Option<f64>,
    /// Organization state of the owning registered source
    /// (`"organized"` / `"unorganized"`), joined from `registered_sources`.
    pub organization_state: String,
}

/// Return all `inbox_items` whose `state` is **unacknowledged**
/// (`pending_classification`, `classified`, or `plan_open`) across every
/// registered root, joined with the root's path so the UI can label/group by
/// root.
///
/// `plan_open` IS included — spec 041 keeps items awaiting plan application on
/// the plan surface so the user can review/apply them. Only the terminal
/// `resolved` (acknowledged) state is excluded. `inbox_stats` uses the same
/// predicate, so the queue list and the stats summary always agree.
///
/// Results are ordered by root path then by relative path.
/// Pass `limit` to cap the result set (FR-006 bounding).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn list_unacknowledged_across_roots(
    pool: &SqlitePool,
    limit: i64,
) -> DbResult<Vec<InboxListRow>> {
    let rows = sqlx::query_as::<_, InboxListRow>(
        "SELECT
             i.id,
             i.root_id,
             r.path              AS root_path,
             i.relative_path,
             i.file_count,
             i.discovered_at,
             i.last_scanned_at,
             i.content_signature,
             i.state,
             i.lane,
             i.format,
             COALESCE(i.is_master_item, 0) AS is_master,
             i.master_frame_type,
             i.master_filter,
             i.master_exposure_s,
             COALESCE(r.organization_state, 'unorganized') AS organization_state
         FROM inbox_items i
         JOIN registered_sources r ON r.id = i.root_id
         WHERE i.state IN ('pending_classification', 'classified', 'plan_open')
         ORDER BY r.path, i.relative_path
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── Per-item grouping aggregates (spec 041 — multi-level grouping UI) ──────────

/// Per-item aggregate grouping keys for the inbox list, computed across each
/// item's persisted per-file metadata (`inbox_file_metadata`) and classification
/// evidence (`inbox_classification_evidence`).
///
/// Each field is a presentation LABEL the UI groups by. For the header
/// dimensions (target, date, filter, exposure, instrument) the value follows
/// the distinct-count rule applied by [`grouping_keys_for_items`]:
///   - 0 distinct non-null values  -> `None`
///   - exactly 1 distinct value    -> `Some(value)`
///   - 2+ distinct values          -> `Some("Mixed")`
///
/// `group_frame_type` is the item's DOMINANT effective frame type (the largest
/// `COALESCE(manual_override, frame_type)` group), never `"Mixed"`; `None` when
/// no frame type is known.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InboxItemGroupingKeys {
    pub group_target: Option<String>,
    pub group_frame_type: Option<String>,
    pub group_date: Option<String>,
    pub group_filter: Option<String>,
    pub group_exposure: Option<String>,
    pub group_instrument: Option<String>,
}

/// Raw per-dimension aggregate row from the metadata GROUP BY.
///
/// `*_distinct` is the number of distinct non-null values; `*_min` is one such
/// value (used directly when the distinct count is exactly 1).
#[derive(Clone, Debug, sqlx::FromRow)]
struct MetadataAggRow {
    inbox_item_id: String,
    object_distinct: i64,
    object_min: Option<String>,
    date_distinct: i64,
    date_min: Option<String>,
    filter_distinct: i64,
    filter_min: Option<String>,
    exposure_distinct: i64,
    exposure_min: Option<f64>,
    instrume_distinct: i64,
    instrume_min: Option<String>,
}

/// Format an exposure in seconds like `"300s"` — trailing zeros trimmed
/// (`300.0` -> `"300s"`, `1.5` -> `"1.5s"`).
fn format_exposure_label(secs: f64) -> String {
    // {} on f64 already drops a trailing `.0` for whole numbers and avoids
    // fixed-precision padding, so 300.0 -> "300" and 1.5 -> "1.5".
    format!("{secs}s")
}

/// Apply the distinct-count rule to one header dimension.
fn label_from_distinct(distinct: i64, value: Option<String>) -> Option<String> {
    match distinct {
        0 => None,
        1 => value,
        _ => Some("Mixed".to_owned()),
    }
}

/// Compute per-item grouping keys for the given inbox item IDs in a single pass.
///
/// Runs two GROUP BY queries (metadata aggregate + dominant frame type) over the
/// supplied item IDs — no per-item full-table scans. Items with no metadata /
/// evidence rows are returned with all-`None` keys (or omitted; the caller
/// defaults missing entries to `None`). The date label is derived from the
/// `DATE-OBS` value truncated to its first 10 chars (`YYYY-MM-DD`).
///
/// # Errors
/// Returns [`DbError::Database`] on connection failure.
pub async fn grouping_keys_for_items(
    pool: &SqlitePool,
    item_ids: &[String],
) -> DbResult<std::collections::HashMap<String, InboxItemGroupingKeys>> {
    use std::collections::HashMap;

    let mut out: HashMap<String, InboxItemGroupingKeys> = HashMap::new();
    if item_ids.is_empty() {
        return Ok(out);
    }

    // Build a single `IN (?, ?, …)` placeholder list shared by both queries.
    let placeholders = vec!["?"; item_ids.len()].join(",");

    // ── 1. Header dimensions from inbox_file_metadata ─────────────────────────
    // Date is truncated to YYYY-MM-DD *inside* the aggregate so distinctness is
    // computed on the date, not the full timestamp.
    let meta_sql = format!(
        "SELECT
             inbox_item_id,
             COUNT(DISTINCT object)              AS object_distinct,
             MIN(object)                         AS object_min,
             COUNT(DISTINCT substr(date_obs, 1, 10)) AS date_distinct,
             MIN(substr(date_obs, 1, 10))        AS date_min,
             COUNT(DISTINCT filter)              AS filter_distinct,
             MIN(filter)                         AS filter_min,
             COUNT(DISTINCT exposure_s)          AS exposure_distinct,
             MIN(exposure_s)                     AS exposure_min,
             COUNT(DISTINCT instrume)            AS instrume_distinct,
             MIN(instrume)                       AS instrume_min
         FROM inbox_file_metadata
         WHERE inbox_item_id IN ({placeholders})
         GROUP BY inbox_item_id"
    );
    // SQL is built only from a fixed `?` placeholder count (no user strings in
    // the text); all IDs flow through `bind`. AssertSqlSafe is the repo pattern
    // for dynamic `IN (?, …)` lists (see lifecycle.rs).
    let mut meta_q = sqlx::query_as::<_, MetadataAggRow>(sqlx::AssertSqlSafe(meta_sql));
    for id in item_ids {
        meta_q = meta_q.bind(id);
    }
    for row in meta_q.fetch_all(pool).await? {
        let entry = out.entry(row.inbox_item_id.clone()).or_default();
        entry.group_target = label_from_distinct(row.object_distinct, row.object_min);
        entry.group_date = label_from_distinct(row.date_distinct, row.date_min);
        entry.group_filter = label_from_distinct(row.filter_distinct, row.filter_min);
        entry.group_exposure = match row.exposure_distinct {
            0 => None,
            1 => row.exposure_min.map(format_exposure_label),
            _ => Some("Mixed".to_owned()),
        };
        entry.group_instrument = label_from_distinct(row.instrume_distinct, row.instrume_min);
    }

    // ── 2. Dominant effective frame type from evidence ────────────────────────
    // COALESCE(manual_override, frame_type) is the effective frame type. We take
    // the largest non-null group per item (ties broken by frame type name for
    // determinism).
    let ft_sql = format!(
        "SELECT inbox_item_id, eff_frame_type
         FROM (
             SELECT
                 inbox_item_id,
                 COALESCE(manual_override, frame_type) AS eff_frame_type,
                 COUNT(*) AS n,
                 ROW_NUMBER() OVER (
                     PARTITION BY inbox_item_id
                     ORDER BY COUNT(*) DESC, COALESCE(manual_override, frame_type) ASC
                 ) AS rn
             FROM inbox_classification_evidence
             WHERE inbox_item_id IN ({placeholders})
               AND COALESCE(manual_override, frame_type) IS NOT NULL
             GROUP BY inbox_item_id, eff_frame_type
         )
         WHERE rn = 1"
    );
    let mut ft_q = sqlx::query_as::<_, (String, Option<String>)>(sqlx::AssertSqlSafe(ft_sql));
    for id in item_ids {
        ft_q = ft_q.bind(id);
    }
    for (item_id, eff) in ft_q.fetch_all(pool).await? {
        out.entry(item_id).or_default().group_frame_type = eff;
    }

    Ok(out)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    fn sample_item(id: &str) -> InsertInboxItem<'_> {
        InsertInboxItem {
            id,
            root_id: "root-1",
            relative_path: "2025-10-10/lights",
            file_count: 20,
            content_signature: Some("sig-abc"),
            lane: "fits",
        }
    }

    #[tokio::test]
    async fn insert_and_get_inbox_item() {
        let db = test_db().await;
        insert_inbox_item(db.pool(), &sample_item("item-1")).await.unwrap();
        let row = get_inbox_item(db.pool(), "item-1").await.unwrap();
        assert_eq!(row.id, "item-1");
        assert_eq!(row.state, "pending_classification");
        assert_eq!(row.lane, "fits");
    }

    #[tokio::test]
    async fn update_inbox_item_state_transitions() {
        let db = test_db().await;
        insert_inbox_item(db.pool(), &sample_item("item-2")).await.unwrap();
        update_inbox_item_state(db.pool(), "item-2", "classified").await.unwrap();
        let row = get_inbox_item(db.pool(), "item-2").await.unwrap();
        assert_eq!(row.state, "classified");
    }

    #[tokio::test]
    async fn upsert_classification_and_get() {
        let db = test_db().await;
        insert_inbox_item(db.pool(), &sample_item("item-3")).await.unwrap();

        // Migration 0048 renamed 'single_type' → 'classified' in the CHECK constraint.
        let c = UpsertClassification {
            inbox_item_id: "item-3",
            result: "classified",
            frame_type: Some("light"),
            content_signature: "sig-xyz",
            unclassified_file_count: 0,
        };
        upsert_classification(db.pool(), &c).await.unwrap();

        let row = get_classification(db.pool(), "item-3").await.unwrap().unwrap();
        assert_eq!(row.result, "classified");
        assert_eq!(row.frame_type, Some("light".to_owned()));
    }

    #[tokio::test]
    async fn insert_and_list_evidence() {
        let db = test_db().await;
        insert_inbox_item(db.pool(), &sample_item("item-4")).await.unwrap();

        let ev = InsertEvidence {
            id: "ev-1",
            inbox_item_id: "item-4",
            relative_file_path: "2025-10-10/lights/frame_001.fits",
            frame_type: Some("light"),
            evidence_source: "imagetyp_header",
            raw_value: Some("Light Frame"),
            unclassified: false,
            manual_override: None,
            is_master: false,
            master_detector: None,
        };
        insert_evidence(db.pool(), &ev).await.unwrap();

        let rows = list_evidence(db.pool(), "item-4").await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].relative_file_path, "2025-10-10/lights/frame_001.fits");
        assert_eq!(rows[0].frame_type, Some("light".to_owned()));
    }

    #[tokio::test]
    async fn set_manual_override_updates_row() {
        let db = test_db().await;
        insert_inbox_item(db.pool(), &sample_item("item-5")).await.unwrap();

        let ev = InsertEvidence {
            id: "ev-2",
            inbox_item_id: "item-5",
            relative_file_path: "frame_002.fits",
            frame_type: None,
            evidence_source: "none",
            raw_value: None,
            unclassified: true,
            manual_override: None,
            is_master: false,
            master_detector: None,
        };
        insert_evidence(db.pool(), &ev).await.unwrap();

        let updated =
            set_manual_override(db.pool(), "item-5", "frame_002.fits", "dark").await.unwrap();
        assert!(updated);

        let rows = list_evidence(db.pool(), "item-5").await.unwrap();
        assert_eq!(rows[0].manual_override, Some("dark".to_owned()));
        assert_eq!(rows[0].evidence_source, "manual_override");
    }

    #[tokio::test]
    async fn plan_link_insert_and_get() {
        let db = test_db().await;
        insert_inbox_item(db.pool(), &sample_item("item-6")).await.unwrap();

        // Need a real plan row to satisfy FK
        let plan_insert = crate::repositories::plans::InsertPlan {
            id: "plan-inbox-1",
            title: "Inbox Split",
            origin: "inbox",
            origin_path: None,
            plan_type: "split",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        };
        crate::repositories::plans::insert_plan(db.pool(), &plan_insert).await.unwrap();

        insert_plan_link(db.pool(), "item-6", "plan-inbox-1").await.unwrap();
        let link = get_plan_link(db.pool(), "item-6").await.unwrap().unwrap();
        assert_eq!(link.plan_id, "plan-inbox-1");
    }

    #[tokio::test]
    async fn duplicate_plan_link_fails() {
        let db = test_db().await;
        insert_inbox_item(db.pool(), &sample_item("item-7")).await.unwrap();

        let plan_insert = crate::repositories::plans::InsertPlan {
            id: "plan-inbox-2",
            title: "Inbox Split 2",
            origin: "inbox",
            origin_path: None,
            plan_type: "split",
            destructive_destination: "archive",
            parent_plan_id: None,
            total_bytes_required: 0,
        };
        crate::repositories::plans::insert_plan(db.pool(), &plan_insert).await.unwrap();

        insert_plan_link(db.pool(), "item-7", "plan-inbox-2").await.unwrap();
        // Second insert must fail (PK constraint)
        let err = insert_plan_link(db.pool(), "item-7", "plan-inbox-2").await;
        assert!(err.is_err());
    }

    /// C1 integration test (no mocks): register a real source via
    /// `register_source_batch`, insert an inbox item for that source's id, then
    /// call `list_unacknowledged_across_roots` and assert the row comes back
    /// with the correct `root_path`. Verifies the JOIN hits `registered_sources`
    /// not the absent `library_root` table.
    #[tokio::test]
    async fn list_unacknowledged_joins_registered_sources() {
        use domain_core::first_run::{
            OrganizationState, RegisterSourceBatchRequest, RegisterSourceRequest, ScanDepth,
            SourceKind,
        };

        let db = test_db().await;
        let pool = db.pool();

        // Register a source via the real batch function (same path the wizard uses).
        let batch_req = RegisterSourceBatchRequest {
            sources: vec![RegisterSourceRequest {
                kind: SourceKind::Inbox,
                path: "/astro/inbox".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Unorganized,
            }],
        };
        let batch_resp =
            crate::repositories::first_run::register_source_batch(pool, &batch_req).await.unwrap();
        let source_id = batch_resp.items[0].source_id.as_deref().unwrap().to_owned();

        // Insert an inbox item pointing at that source id.
        let item = InsertInboxItem {
            id: "cross-root-item-1",
            root_id: &source_id,
            relative_path: "2025-11-01/lights",
            file_count: 5,
            content_signature: Some("sig-cross"),
            lane: "fits",
        };
        insert_inbox_item(pool, &item).await.unwrap();

        // Must return ≥1 row with the correct root_path.
        let rows = list_unacknowledged_across_roots(pool, 100).await.unwrap();
        assert_eq!(rows.len(), 1, "expected 1 unacknowledged item");
        assert_eq!(
            rows[0].root_path, "/astro/inbox",
            "root_path must match registered_sources.path"
        );
        assert_eq!(rows[0].id, "cross-root-item-1");
        assert_eq!(rows[0].state, "pending_classification");
        assert_eq!(
            rows[0].organization_state, "unorganized",
            "org-state must be carried from registered_sources (inbox ⇒ unorganized)"
        );
    }

    /// Spec 041 regression: the inbox list must carry each item's owning source
    /// organization_state (not a hardcoded "unorganized"), so the grouping
    /// "Org. state" dimension is correct for organized library roots too.
    #[tokio::test]
    async fn list_unacknowledged_carries_real_organization_state() {
        use domain_core::first_run::{
            OrganizationState, RegisterSourceBatchRequest, RegisterSourceRequest, ScanDepth,
            SourceKind,
        };

        let db = test_db().await;
        let pool = db.pool();

        // Two sources: an unorganized inbox and an organized light-frames library,
        // each registered via the real batch path the wizard uses.
        let batch_req = RegisterSourceBatchRequest {
            sources: vec![
                RegisterSourceRequest {
                    kind: SourceKind::Inbox,
                    path: "/astro/inbox".to_owned(),
                    kind_subtype: None,
                    scan_depth: ScanDepth::Recursive,
                    organization_state: OrganizationState::Unorganized,
                },
                RegisterSourceRequest {
                    kind: SourceKind::LightFrames,
                    path: "/astro/library".to_owned(),
                    kind_subtype: None,
                    scan_depth: ScanDepth::Recursive,
                    organization_state: OrganizationState::Organized,
                },
            ],
        };
        let batch_resp =
            crate::repositories::first_run::register_source_batch(pool, &batch_req).await.unwrap();
        let inbox_id = batch_resp.items[0].source_id.as_deref().unwrap().to_owned();
        let library_id = batch_resp.items[1].source_id.as_deref().unwrap().to_owned();

        insert_inbox_item(
            pool,
            &InsertInboxItem {
                id: "org-item-inbox",
                root_id: &inbox_id,
                relative_path: "2025-11-01/lights",
                file_count: 3,
                content_signature: Some("sig-inbox"),
                lane: "fits",
            },
        )
        .await
        .unwrap();
        insert_inbox_item(
            pool,
            &InsertInboxItem {
                id: "org-item-library",
                root_id: &library_id,
                relative_path: "M31/lights",
                file_count: 7,
                content_signature: Some("sig-library"),
                lane: "fits",
            },
        )
        .await
        .unwrap();

        let rows = list_unacknowledged_across_roots(pool, 100).await.unwrap();
        let by_id: std::collections::HashMap<&str, &InboxListRow> =
            rows.iter().map(|r| (r.id.as_str(), r)).collect();

        assert_eq!(by_id.get("org-item-inbox").unwrap().organization_state, "unorganized");
        assert_eq!(
            by_id.get("org-item-library").unwrap().organization_state,
            "organized",
            "organized library source must surface as 'organized' in the list"
        );
    }

    // ── grouping_keys_for_items (spec 041 multi-level grouping) ───────────────

    /// Helper: upsert one metadata row with the common header fields set.
    #[allow(clippy::too_many_arguments)]
    async fn meta_row(
        pool: &SqlitePool,
        item: &str,
        path: &str,
        object: Option<&str>,
        date_obs: Option<&str>,
        filter: Option<&str>,
        exposure_s: Option<f64>,
        instrume: Option<&str>,
    ) {
        let m = UpsertFileMetadata {
            inbox_item_id: item,
            relative_file_path: path,
            object,
            date_obs,
            filter,
            exposure_s,
            instrume,
            ..Default::default()
        };
        upsert_inbox_file_metadata(pool, &m).await.unwrap();
    }

    #[tokio::test]
    async fn grouping_uniform_metadata_yields_single_values() {
        let db = test_db().await;
        let pool = db.pool();
        insert_inbox_item(pool, &sample_item("g-uniform")).await.unwrap();

        // Two files agree on every dimension; date_obs carries a full timestamp.
        meta_row(
            pool,
            "g-uniform",
            "a.fits",
            Some("M31"),
            Some("2025-10-10T22:01:00"),
            Some("Ha"),
            Some(300.0),
            Some("ASI2600"),
        )
        .await;
        meta_row(
            pool,
            "g-uniform",
            "b.fits",
            Some("M31"),
            Some("2025-10-10T23:59:00"),
            Some("Ha"),
            Some(300.0),
            Some("ASI2600"),
        )
        .await;

        let keys = grouping_keys_for_items(pool, &["g-uniform".to_owned()]).await.unwrap();
        let g = keys.get("g-uniform").expect("item present");
        assert_eq!(g.group_target.as_deref(), Some("M31"));
        // Same calendar day despite differing timestamps -> single date label.
        assert_eq!(g.group_date.as_deref(), Some("2025-10-10"));
        assert_eq!(g.group_filter.as_deref(), Some("Ha"));
        // 300.0 trims to "300s".
        assert_eq!(g.group_exposure.as_deref(), Some("300s"));
        assert_eq!(g.group_instrument.as_deref(), Some("ASI2600"));
    }

    #[tokio::test]
    async fn grouping_divergent_metadata_yields_mixed() {
        let db = test_db().await;
        let pool = db.pool();
        insert_inbox_item(pool, &sample_item("g-mixed")).await.unwrap();

        meta_row(
            pool,
            "g-mixed",
            "a.fits",
            Some("M31"),
            Some("2025-10-10T22:00:00"),
            Some("Ha"),
            Some(300.0),
            Some("ASI2600"),
        )
        .await;
        meta_row(
            pool,
            "g-mixed",
            "b.fits",
            Some("NGC7000"),
            Some("2025-10-11T22:00:00"),
            Some("OIII"),
            Some(120.0),
            Some("ASI1600"),
        )
        .await;

        let keys = grouping_keys_for_items(pool, &["g-mixed".to_owned()]).await.unwrap();
        let g = keys.get("g-mixed").unwrap();
        assert_eq!(g.group_target.as_deref(), Some("Mixed"));
        assert_eq!(g.group_date.as_deref(), Some("Mixed"));
        assert_eq!(g.group_filter.as_deref(), Some("Mixed"));
        assert_eq!(g.group_exposure.as_deref(), Some("Mixed"));
        assert_eq!(g.group_instrument.as_deref(), Some("Mixed"));
    }

    #[tokio::test]
    async fn grouping_absent_metadata_yields_none() {
        let db = test_db().await;
        let pool = db.pool();
        insert_inbox_item(pool, &sample_item("g-empty")).await.unwrap();

        // No metadata, no evidence rows at all.
        let keys = grouping_keys_for_items(pool, &["g-empty".to_owned()]).await.unwrap();
        // Either absent from the map or present with all-None — both default to None.
        let g = keys.get("g-empty").cloned().unwrap_or_default();
        assert_eq!(g.group_target, None);
        assert_eq!(g.group_frame_type, None);
        assert_eq!(g.group_date, None);
        assert_eq!(g.group_filter, None);
        assert_eq!(g.group_exposure, None);
        assert_eq!(g.group_instrument, None);
    }

    #[tokio::test]
    async fn grouping_partial_nulls_count_as_distinct_non_null() {
        let db = test_db().await;
        let pool = db.pool();
        insert_inbox_item(pool, &sample_item("g-partial")).await.unwrap();

        // One file has a filter, the other is null -> 1 distinct non-null value.
        meta_row(pool, "g-partial", "a.fits", None, None, Some("Lum"), None, None).await;
        meta_row(pool, "g-partial", "b.fits", None, None, None, None, None).await;

        let keys = grouping_keys_for_items(pool, &["g-partial".to_owned()]).await.unwrap();
        let g = keys.get("g-partial").unwrap();
        assert_eq!(g.group_filter.as_deref(), Some("Lum"));
        assert_eq!(g.group_target, None);
        assert_eq!(g.group_exposure, None);
    }

    #[tokio::test]
    async fn grouping_exposure_fractional_label() {
        let db = test_db().await;
        let pool = db.pool();
        insert_inbox_item(pool, &sample_item("g-frac")).await.unwrap();

        meta_row(pool, "g-frac", "a.fits", None, None, None, Some(1.5), None).await;

        let keys = grouping_keys_for_items(pool, &["g-frac".to_owned()]).await.unwrap();
        let g = keys.get("g-frac").unwrap();
        assert_eq!(g.group_exposure.as_deref(), Some("1.5s"));
    }

    #[tokio::test]
    async fn grouping_dominant_frame_type_from_evidence() {
        let db = test_db().await;
        let pool = db.pool();
        insert_inbox_item(pool, &sample_item("g-dom")).await.unwrap();

        // 3 darks vs 1 light -> dominant = "dark" (NOT "Mixed").
        for (i, ft) in [("e1", "dark"), ("e2", "dark"), ("e3", "dark"), ("e4", "light")] {
            let path = format!("{i}.fits");
            let ev = InsertEvidence {
                id: i,
                inbox_item_id: "g-dom",
                relative_file_path: &path,
                frame_type: Some(ft),
                evidence_source: "imagetyp_header",
                raw_value: Some(ft),
                unclassified: false,
                manual_override: None,
                is_master: false,
                master_detector: None,
            };
            insert_evidence(pool, &ev).await.unwrap();
        }

        let keys = grouping_keys_for_items(pool, &["g-dom".to_owned()]).await.unwrap();
        let g = keys.get("g-dom").unwrap();
        assert_eq!(g.group_frame_type.as_deref(), Some("dark"));
    }

    #[tokio::test]
    async fn grouping_dominant_frame_type_respects_manual_override() {
        let db = test_db().await;
        let pool = db.pool();
        insert_inbox_item(pool, &sample_item("g-ovr")).await.unwrap();

        // Two files extracted as light, but both overridden to flat -> dominant flat.
        for (i, ft) in [("o1", "light"), ("o2", "light")] {
            let path = format!("{i}.fits");
            let ev = InsertEvidence {
                id: i,
                inbox_item_id: "g-ovr",
                relative_file_path: &path,
                frame_type: Some(ft),
                evidence_source: "imagetyp_header",
                raw_value: Some(ft),
                unclassified: false,
                manual_override: Some("flat"),
                is_master: false,
                master_detector: None,
            };
            insert_evidence(pool, &ev).await.unwrap();
        }

        let keys = grouping_keys_for_items(pool, &["g-ovr".to_owned()]).await.unwrap();
        assert_eq!(keys.get("g-ovr").unwrap().group_frame_type.as_deref(), Some("flat"));
    }

    #[tokio::test]
    async fn grouping_empty_ids_returns_empty_map() {
        let db = test_db().await;
        let pool = db.pool();
        let keys = grouping_keys_for_items(pool, &[]).await.unwrap();
        assert!(keys.is_empty());
    }

    /// set_overrides writes the frame-type override and resets override_stale.
    ///
    /// NOTE (migration 0048): override_filter/override_exposure_s/override_binning
    /// have been moved to inbox_file_overrides. set_overrides now only updates
    /// manual_override (frame-type correction) on the evidence row. Non-type
    /// override parameters (_filter, _exposure_s, _binning) are accepted but
    /// silently ignored until T069 rewrites the override persistence layer.
    #[tokio::test]
    async fn set_overrides_writes_all_columns_and_resets_stale() {
        let db = test_db().await;
        let pool = db.pool();

        // Set up: source group + item + evidence row.
        // An inbox_source_groups row is required so set_overrides can write
        // non-type values to inbox_file_overrides (migration 0048 data path).
        sqlx::query(
            "INSERT INTO inbox_source_groups \
             (id, root_id, relative_path, discovered_at, last_scanned_at, child_count) \
             VALUES ('sg-overrides-1', 'root-1', '2025-10-10/lights', \
                     '2025-10-10T20:00:00Z', '2025-10-10T20:00:00Z', 1)",
        )
        .execute(pool)
        .await
        .unwrap();

        // Insert the inbox_item with source_group_id set.
        sqlx::query(
            "INSERT INTO inbox_items \
             (id, root_id, relative_path, source_group_id, group_key, \
              discovered_at, last_scanned_at, state, lane) \
             VALUES ('item-overrides-1', 'root-1', '2025-10-10/lights', \
                     'sg-overrides-1', '', \
                     '2025-10-10T20:00:00Z', '2025-10-10T20:00:00Z', \
                     'pending_classification', 'fits')",
        )
        .execute(pool)
        .await
        .unwrap();

        insert_evidence(
            pool,
            &InsertEvidence {
                id: "ev-overrides-1",
                inbox_item_id: "item-overrides-1",
                relative_file_path: "folder/file.fits",
                frame_type: None,
                evidence_source: "none",
                raw_value: None,
                unclassified: true,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        // First manually mark stale so we can verify it is reset.
        mark_override_stale(pool, "item-overrides-1", "folder/file.fits").await.unwrap();

        // Apply full overrides — now actually writes non-type values to
        // inbox_file_overrides and frame-type to the evidence row.
        let updated = set_overrides(
            pool,
            "item-overrides-1",
            "folder/file.fits",
            Some("dark"),
            Some("Ha"),
            Some(120.0),
            Some("2x2"),
        )
        .await
        .unwrap();
        assert!(updated, "set_overrides must return true (row found)");

        // Read back via list_evidence — override values are JOIN'd from
        // inbox_file_overrides by the updated query.
        let rows = list_evidence(pool, "item-overrides-1").await.unwrap();
        assert_eq!(rows.len(), 1);
        let ev = &rows[0];
        assert_eq!(ev.manual_override.as_deref(), Some("dark"));
        assert_eq!(ev.override_stale, 0, "freshly-set override must not be stale");
        assert_eq!(ev.evidence_source, "manual_override");
        // Non-type overrides are read back from inbox_file_overrides via the JOIN.
        assert_eq!(ev.override_filter.as_deref(), Some("Ha"));
        assert_eq!(ev.override_exposure_s, Some(120.0));
        assert_eq!(ev.override_binning.as_deref(), Some("2x2"));
    }

    /// mark_override_stale sets override_stale=1.
    #[tokio::test]
    async fn mark_override_stale_sets_flag() {
        let db = test_db().await;
        let pool = db.pool();

        insert_inbox_item(pool, &sample_item("item-stale-1")).await.unwrap();
        insert_evidence(
            pool,
            &InsertEvidence {
                id: "ev-stale-1",
                inbox_item_id: "item-stale-1",
                relative_file_path: "folder/stale.fits",
                frame_type: None,
                evidence_source: "none",
                raw_value: None,
                unclassified: true,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        // Initially stale=0 (DEFAULT).
        let rows_before = list_evidence(pool, "item-stale-1").await.unwrap();
        assert_eq!(rows_before[0].override_stale, 0);

        mark_override_stale(pool, "item-stale-1", "folder/stale.fits").await.unwrap();

        let rows_after = list_evidence(pool, "item-stale-1").await.unwrap();
        assert_eq!(rows_after[0].override_stale, 1, "override_stale must be 1 after mark");
    }

    /// get_file_metadata returns None before any classify and Some after upsert.
    #[tokio::test]
    async fn get_file_metadata_returns_row_after_upsert() {
        let db = test_db().await;
        let pool = db.pool();

        insert_inbox_item(pool, &sample_item("item-getmeta-1")).await.unwrap();

        // Before upsert: None.
        let before = get_file_metadata(pool, "item-getmeta-1", "folder/light.fits").await.unwrap();
        assert!(before.is_none());

        // Upsert metadata.
        upsert_inbox_file_metadata(
            pool,
            &UpsertFileMetadata {
                inbox_item_id: "item-getmeta-1",
                relative_file_path: "folder/light.fits",
                filter: Some("Ha"),
                exposure_s: Some(300.0),
                file_size_bytes: Some(4_194_304),
                file_mtime: Some("2025-10-10T22:00:00Z"),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        // After upsert: row present.
        let after =
            get_file_metadata(pool, "item-getmeta-1", "folder/light.fits").await.unwrap().unwrap();
        assert_eq!(after.filter.as_deref(), Some("Ha"));
        assert_eq!(after.exposure_s, Some(300.0));
        assert_eq!(after.file_size_bytes, Some(4_194_304));
    }

    /// T040 — `inbox_stats` returns per-type counts across active items.
    ///
    /// Fixture:
    ///   item-stats-1  (state=classified):  2 light frames (is_master=0)
    ///   item-stats-2  (state=classified):  1 dark frame  (is_master=0)
    ///   item-stats-3  (state=classified):  1 dark master (is_master=1)
    ///
    /// Expected stats:
    ///   light → folder_count=1, image_count=2, master_count=0
    ///   dark  → folder_count=2, image_count=1, master_count=1
    #[tokio::test]
    #[allow(clippy::too_many_lines)]
    async fn inbox_stats_returns_per_type_counts() {
        let db = test_db().await;
        let pool = db.pool();

        // item-stats-1: two light frames
        insert_inbox_item(
            pool,
            &InsertInboxItem {
                id: "item-stats-1",
                root_id: "root-1",
                relative_path: "2025-10-10/lights-stats",
                file_count: 2,
                content_signature: Some("sig-s1"),
                lane: "fits",
            },
        )
        .await
        .unwrap();
        update_inbox_item_state(pool, "item-stats-1", "classified").await.unwrap();
        for (ev_id, path) in [
            ("ev-stats-1a", "lights-stats/frame_001.fits"),
            ("ev-stats-1b", "lights-stats/frame_002.fits"),
        ] {
            insert_evidence(
                pool,
                &InsertEvidence {
                    id: ev_id,
                    inbox_item_id: "item-stats-1",
                    relative_file_path: path,
                    frame_type: Some("light"),
                    evidence_source: "imagetyp_header",
                    raw_value: Some("Light Frame"),
                    unclassified: false,
                    manual_override: None,
                    is_master: false,
                    master_detector: None,
                },
            )
            .await
            .unwrap();
        }

        // item-stats-2: one dark frame
        insert_inbox_item(
            pool,
            &InsertInboxItem {
                id: "item-stats-2",
                root_id: "root-1",
                relative_path: "2025-10-10/darks-stats",
                file_count: 1,
                content_signature: Some("sig-s2"),
                lane: "fits",
            },
        )
        .await
        .unwrap();
        update_inbox_item_state(pool, "item-stats-2", "classified").await.unwrap();
        insert_evidence(
            pool,
            &InsertEvidence {
                id: "ev-stats-2",
                inbox_item_id: "item-stats-2",
                relative_file_path: "darks-stats/dark_001.fits",
                frame_type: Some("dark"),
                evidence_source: "imagetyp_header",
                raw_value: Some("Dark Frame"),
                unclassified: false,
                manual_override: None,
                is_master: false,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        // item-stats-3: one dark master (is_master=true)
        insert_inbox_item(
            pool,
            &InsertInboxItem {
                id: "item-stats-3",
                root_id: "root-1",
                relative_path: "2025-10-10/dark-masters-stats",
                file_count: 1,
                content_signature: Some("sig-s3"),
                lane: "fits",
            },
        )
        .await
        .unwrap();
        update_inbox_item_state(pool, "item-stats-3", "classified").await.unwrap();
        insert_evidence(
            pool,
            &InsertEvidence {
                id: "ev-stats-3",
                inbox_item_id: "item-stats-3",
                relative_file_path: "dark-masters-stats/master_dark.fits",
                frame_type: Some("dark"),
                evidence_source: "imagetyp_header",
                raw_value: Some("Dark Frame"),
                unclassified: false,
                manual_override: None,
                is_master: true,
                master_detector: None,
            },
        )
        .await
        .unwrap();

        let rows = inbox_stats(pool).await.unwrap();

        let light = rows.iter().find(|r| r.frame_type == "light").unwrap();
        assert_eq!(light.image_count, 2, "light image_count");
        assert_eq!(light.master_count, 0, "light master_count");
        assert_eq!(light.folder_count, 1, "light folder_count");

        let dark = rows.iter().find(|r| r.frame_type == "dark").unwrap();
        assert_eq!(dark.image_count, 1, "dark image_count");
        assert_eq!(dark.master_count, 1, "dark master_count");
        assert_eq!(dark.folder_count, 2, "dark folder_count");
    }

    // ── Source-group upsert tests (T065) ──────────────────────────────────────

    /// First scan inserts the source group row with the expected fields.
    #[tokio::test]
    async fn upsert_source_group_inserts_on_first_scan() {
        let db = test_db().await;
        let pool = db.pool();

        upsert_inbox_source_group(
            pool,
            &UpsertSourceGroup {
                id: "sg-t065-1",
                root_id: "root-1",
                relative_path: "2025-10-10/lights",
                content_signature: Some("sig-abc123"),
                format: Some("fits"),
                lane: Some("move"),
            },
        )
        .await
        .unwrap();

        let row = get_inbox_source_group_by_path(pool, "root-1", "2025-10-10/lights")
            .await
            .unwrap()
            .expect("source group must exist after upsert");

        assert_eq!(row.id, "sg-t065-1");
        assert_eq!(row.root_id, "root-1");
        assert_eq!(row.relative_path, "2025-10-10/lights");
        assert_eq!(row.content_signature.as_deref(), Some("sig-abc123"));
        assert_eq!(row.format.as_deref(), Some("fits"));
        assert_eq!(row.lane.as_deref(), Some("move"));
        assert_eq!(row.child_count, 0, "child_count starts at 0 (classify sets it)");
    }

    /// Rescan refreshes last_scanned_at and content_signature without duplicating the row.
    #[tokio::test]
    async fn upsert_source_group_rescan_refreshes_without_duplicate() {
        let db = test_db().await;
        let pool = db.pool();

        // First scan.
        upsert_inbox_source_group(
            pool,
            &UpsertSourceGroup {
                id: "sg-t065-2",
                root_id: "root-2",
                relative_path: "2025-11-01/darks",
                content_signature: Some("sig-old"),
                format: Some("fits"),
                lane: Some("catalogue"),
            },
        )
        .await
        .unwrap();

        let first = get_inbox_source_group_by_path(pool, "root-2", "2025-11-01/darks")
            .await
            .unwrap()
            .unwrap();

        // Record discovered_at so we can verify it is preserved on rescan.
        let discovered_at_first = first.discovered_at.clone();

        // Rescan: same (root_id, relative_path), new signature.
        upsert_inbox_source_group(
            pool,
            &UpsertSourceGroup {
                id: "sg-t065-2-ignored", // id ignored on conflict; original preserved
                root_id: "root-2",
                relative_path: "2025-11-01/darks",
                content_signature: Some("sig-new"),
                format: Some("fits"),
                lane: Some("catalogue"),
            },
        )
        .await
        .unwrap();

        let second = get_inbox_source_group_by_path(pool, "root-2", "2025-11-01/darks")
            .await
            .unwrap()
            .unwrap();

        // Row count is still 1 (not duplicated).
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM inbox_source_groups WHERE root_id = 'root-2' AND relative_path = '2025-11-01/darks'",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(count.0, 1, "rescan must not duplicate the source group row");

        // content_signature updated.
        assert_eq!(second.content_signature.as_deref(), Some("sig-new"));

        // discovered_at preserved.
        assert_eq!(second.discovered_at, discovered_at_first);

        // child_count still 0 (classify hasn't run).
        assert_eq!(second.child_count, 0);
    }

    /// Two distinct leaf folders under the same root produce two source group rows.
    #[tokio::test]
    async fn upsert_source_group_two_leaf_folders_produce_two_rows() {
        let db = test_db().await;
        let pool = db.pool();

        for (id, path) in [("sg-t065-a", "session/lights"), ("sg-t065-b", "session/darks")] {
            upsert_inbox_source_group(
                pool,
                &UpsertSourceGroup {
                    id,
                    root_id: "root-multi",
                    relative_path: path,
                    content_signature: Some("sig"),
                    format: Some("fits"),
                    lane: Some("move"),
                },
            )
            .await
            .unwrap();
        }

        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM inbox_source_groups WHERE root_id = 'root-multi'")
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(count.0, 2, "each leaf folder is a distinct source group row");
    }

    /// Video-lane leaf folder is stored with lane = "move" (video sources are never
    /// catalogue-in-place).  Format field carries "video".
    #[tokio::test]
    async fn upsert_source_group_video_lane_stored() {
        let db = test_db().await;
        let pool = db.pool();

        upsert_inbox_source_group(
            pool,
            &UpsertSourceGroup {
                id: "sg-t065-vid",
                root_id: "root-vid",
                relative_path: "planetary/jupiter",
                content_signature: None,
                format: Some("video"),
                lane: Some("move"),
            },
        )
        .await
        .unwrap();

        let row = get_inbox_source_group_by_path(pool, "root-vid", "planetary/jupiter")
            .await
            .unwrap()
            .expect("video source group must be persisted");

        assert_eq!(row.format.as_deref(), Some("video"));
        assert_eq!(row.lane.as_deref(), Some("move"));
    }
}
