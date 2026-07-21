// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Read-only cross-table projections for the Inbox list surface: per-frame-type
//! stats, the unacknowledged-item list, and per-item grouping keys.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::DbResult;

/// SQL predicate that excludes a folder placeholder (`group_key = ''`) whose
/// source group has genuinely SPLIT — i.e. `classify()` materialized two or
/// more distinct single-type sub-items for it.
///
/// #711 (Instance A): after a split, `classify()` flips the placeholder's state
/// to `'classified'` but never updates its `group_key`/`frame_type`, so the
/// aggregate row renders a misleading "Classified" badge next to its own
/// sub-items and disagrees with `inbox_classify` for that same id. Once the
/// group has split, the sub-items are the authoritative rows and the aggregate
/// placeholder is dead weight. Unscoped by sub-item state: a fully-processed
/// folder must stay gone, not resurface as a lone aggregate placeholder.
///
/// The `> 1` bound is load-bearing, not a stylistic choice. `classify()` runs
/// `materialize_sub_items` for EVERY source-group-backed item, so an ordinary
/// UNSPLIT folder (all files one group, or all files in the
/// `__needs_review__` sentinel bucket) also gets exactly one sub-item. In that
/// case the placeholder is still the row the whole workflow is bound to — the
/// user selects it, confirms it, and the resulting plan links to its id — so
/// hiding it silently cleared the UI selection and dropped its plan from
/// `list_open_inbox_plans` (which reads this same query), breaking Confirm and
/// "Review plans" outright. See the Layer-2 journeys
/// `inbox_ui_catalogue_in_place_zero_moves_byte_identical`,
/// `inbox_ui_confirm_does_not_move_then_apply_moves_to_shown_destination`, and
/// `inbox_ui_unclassified_gate_bulk_reclassify_unblocks_confirm`.
///
/// Legacy rows with a NULL `source_group_id` and master items (also NULL) are
/// never hidden. Applied identically by `list_unacknowledged_across_roots`,
/// [`inbox_stats`], and [`count_distinct_inbox_folders`] so the queue list and
/// the stats summary always agree.
macro_rules! exclude_split_placeholder {
    () => {
        "AND NOT (
             i.group_key = ''
             AND i.source_group_id IS NOT NULL
             AND (
                 SELECT COUNT(DISTINCT sub.group_key) FROM inbox_items sub
                 WHERE sub.source_group_id = i.source_group_id
                   AND sub.group_key <> ''
             ) > 1
         )"
    };
}

// Re-exported crate-internally so `q_desktop::count_unacknowledged_inbox_items`
// applies the identical predicate. It lives in another module, which is how it
// was missed when the predicate was introduced — the status-bar badge counted
// superseded placeholders the queue list had already hidden.
pub(crate) use exclude_split_placeholder;
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

    let rows = sqlx::query_as::<_, StatsRow>(concat!(
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
           ",
        exclude_split_placeholder!(),
        "
         GROUP BY eff_type
         ORDER BY eff_type"
    ))
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
    let (count,): (i64,) = sqlx::query_as(concat!(
        "SELECT COUNT(DISTINCT i.id)
         FROM inbox_items i
         JOIN inbox_classification_evidence ev ON ev.inbox_item_id = i.id
         WHERE i.state IN ('pending_classification', 'classified', 'plan_open')
           AND COALESCE(ev.manual_override, ev.frame_type) IS NOT NULL
           ",
        exclude_split_placeholder!()
    ))
    .fetch_one(pool)
    .await?;
    Ok(count)
}

// ── Plan link CRUD ────────────────────────────────────────────────────────────

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
    /// FK to `inbox_source_groups`; `None` for legacy rows that predate
    /// source groups (spec 041 Phase 12, T072/FR-043).
    pub source_group_id: Option<String>,
    /// Deterministic canonical group key (R-11). Empty string for legacy
    /// rows not yet materialized into a single-type sub-item.
    pub group_key: String,
    /// Human-readable display label `"(root) · <type> · <dims>"` (R-12).
    pub group_label: Option<String>,
    /// Authoritative single frame type for this sub-item; `None` until
    /// classified.
    pub frame_type: Option<String>,
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
/// Placeholders of genuinely split source groups are excluded — see
/// `exclude_split_placeholder!` for why the split bound matters.
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
    let rows = sqlx::query_as::<_, InboxListRow>(concat!(
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
             COALESCE(r.organization_state, 'unorganized') AS organization_state,
             i.source_group_id,
             i.group_key,
             i.group_label,
             i.frame_type
         FROM inbox_items i
         JOIN registered_sources r ON r.id = i.root_id
         WHERE i.state IN ('pending_classification', 'classified', 'plan_open')
           ",
        exclude_split_placeholder!(),
        "
         ORDER BY r.path, i.relative_path
         LIMIT ?"
    ))
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
    /// `inbox_classifications.result` for this item, DB vocabulary
    /// (`"classified"` / `"unclassified"`) — the SAME cached value
    /// `inbox.classify` reads (`classify.rs::build_response_from_cache`).
    /// `None` when the item has never been classified.
    ///
    /// Added for issue #711 Instance A's *unsplit*-folder variant: `classify()`
    /// unconditionally sets `inbox_items.state = "classified"` (step 9) once a
    /// folder has been scanned, regardless of whether it actually resolved to
    /// a single type — so the list's `state`-based badge fallback lies for a
    /// folder that is empty/mixed/needs-review with no dominant frame type
    /// (`group_frame_type` is also `None` in that case). Sourcing this field
    /// from the same cache `inbox.classify` uses, rather than trusting
    /// `state`, makes the list and detail panel agree by construction.
    pub classification_result: Option<String>,
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
///
/// Public because this is the app-wide exposure-label vocabulary: project
/// source snapshots (`app_core_projects::project_setup`) must produce labels
/// that `parse_exposure_seconds` and the `{exposure}` path token read back
/// identically to the ones written here.
#[must_use]
pub fn format_exposure_label(secs: f64) -> String {
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

    // ── 3. Cached classification result (issue #711 Instance A unsplit) ──────
    // One row per item at most (`inbox_classifications` is keyed by
    // `inbox_item_id`) — plain lookup, not a GROUP BY.
    let cls_sql = format!(
        "SELECT inbox_item_id, result FROM inbox_classifications
         WHERE inbox_item_id IN ({placeholders})"
    );
    let mut cls_q = sqlx::query_as::<_, (String, String)>(sqlx::AssertSqlSafe(cls_sql));
    for id in item_ids {
        cls_q = cls_q.bind(id);
    }
    for (item_id, result) in cls_q.fetch_all(pool).await? {
        out.entry(item_id).or_default().classification_result = Some(result);
    }

    Ok(out)
}

// ── Tests ─────────────────────────────────────────────────────────────────────
