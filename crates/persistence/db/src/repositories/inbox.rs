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

/// Flat row from `inbox_classification_evidence`.
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

/// Flat row from `inbox_plan_links`.
#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct InboxPlanLinkRow {
    pub inbox_item_id: String,
    pub plan_id: String,
    pub linked_at: String,
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
    Ok(sqlx::query_as::<_, InboxEvidenceRow>(
        "SELECT * FROM inbox_classification_evidence WHERE inbox_item_id = ? ORDER BY relative_file_path",
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
}

/// Return all `inbox_items` whose `state` is **unacknowledged**
/// (`pending_classification` or `classified`) across every registered root,
/// joined with the root's path so the UI can label/group by root.
///
/// Items whose state is `plan_open` or `resolved` are excluded — the
/// `resolved` state is the terminal acknowledged state; `plan_open` means the
/// user has already acted and is awaiting plan application.
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
             i.master_exposure_s
         FROM inbox_items i
         JOIN registered_sources r ON r.id = i.root_id
         WHERE i.state IN ('pending_classification', 'classified')
         ORDER BY r.path, i.relative_path
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
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

        let c = UpsertClassification {
            inbox_item_id: "item-3",
            result: "single_type",
            frame_type: Some("light"),
            content_signature: "sig-xyz",
            unclassified_file_count: 0,
        };
        upsert_classification(db.pool(), &c).await.unwrap();

        let row = get_classification(db.pool(), "item-3").await.unwrap().unwrap();
        assert_eq!(row.result, "single_type");
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
        use contracts_core::first_run::{
            RegisterSourceBatchRequest, RegisterSourceRequest, ScanDepth, SourceKind,
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
    }
}
