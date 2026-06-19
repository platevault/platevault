//! Integration tests for spec 040 US3 — confirm a detected calibration master
//! inbox item (Path 1: register directly, no file move).
//!
//! Tests that:
//! 1. Confirming a master inbox item creates a `calibration_session` row and a
//!    `calibration_fingerprint` row, marks the inbox item `resolved`, and
//!    returns `registered_as_master = true` with an empty `plan_id`.
//! 2. The registered master appears via `calibration.masters.list` (read from
//!    `calibration_master_view`).
//! 3. The inbox item is `resolved` and no longer appears in the unacknowledged
//!    list.
//! 4. A non-master inbox item still goes through the normal plan-creation path
//!    (regression guard).

use std::io::Write;
use std::path::Path;

use app_core::calibration::masters_list;
use app_core::inbox::confirm::{confirm, ConfirmRequest};
use persistence_db::repositories::inbox::{
    self as inbox_repo, InsertEvidence, InsertInboxItem, UpsertClassification,
};
use persistence_db::Database;

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn test_db() -> Database {
    let db = Database::in_memory().await.unwrap();
    db.migrate().await.unwrap();
    db
}

/// Write a minimal FITS file (single 2880-byte block).
fn write_fits(dir: &Path, name: &str, imagetyp: &str) {
    let mut block = vec![b' '; 2880];
    let card = format!("IMAGETYP= '{imagetyp:<8}'");
    let bytes = card.as_bytes();
    block[..bytes.len().min(80)].copy_from_slice(&bytes[..bytes.len().min(80)]);
    block[80..83].copy_from_slice(b"END");
    let path = dir.join(name);
    let mut f = std::fs::File::create(path).unwrap();
    f.write_all(&block).unwrap();
}

/// Insert a master inbox item row directly (simulating what scan does).
async fn insert_master_inbox_item(
    db: &Database,
    item_id: &str,
    relative_path: &str,
    master_frame_type: &str,
    master_filter: Option<&str>,
    master_exposure_s: Option<f64>,
    sig: &str,
) {
    let now = "2026-06-18T12:00:00Z";
    sqlx::query(
        "INSERT INTO inbox_items
            (id, root_id, relative_path, file_count, discovered_at, last_scanned_at,
             content_signature, state, lane, format, is_master_item,
             master_frame_type, master_filter, master_exposure_s)
         VALUES (?, 'root-1', ?, 1, ?, ?, ?, 'pending_classification',
                 'fits', 'fits', 1, ?, ?, ?)",
    )
    .bind(item_id)
    .bind(relative_path)
    .bind(now)
    .bind(now)
    .bind(sig)
    .bind(master_frame_type)
    .bind(master_filter)
    .bind(master_exposure_s)
    .execute(db.pool())
    .await
    .unwrap();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// T040-US3-1: confirming a master item registers it to calibration tables.
#[tokio::test]
async fn confirm_master_registers_to_calibration_and_resolves_inbox_item() {
    let tmp = tempfile::tempdir().unwrap();
    write_fits(tmp.path(), "masterDark_300s.fits", "DARK");

    let db = test_db().await;
    let item_id = "master-item-001";
    let sig = "sig-master-001";

    insert_master_inbox_item(&db, item_id, "masterDark_300s.fits", "dark", None, Some(300.0), sig)
        .await;

    let resp = confirm(
        db.pool(),
        ConfirmRequest {
            inbox_item_id: item_id.to_owned(),
            action: "confirm".to_owned(),
            content_signature: sig.to_owned(),
            destructive_destination: None,
            root_absolute_path: tmp.path().to_owned(),
        },
    )
    .await
    .unwrap();

    // Response must say registered_as_master = true, plan_id empty.
    assert!(resp.registered_as_master, "expected registered_as_master = true");
    assert!(resp.plan_id.is_empty(), "plan_id must be empty for master path");
    assert_eq!(resp.items_total, 1);

    // A calibration_session must exist.
    let session_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM calibration_session WHERE kind = 'dark'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(session_count, 1, "one calibration_session must be created");

    // A calibration_fingerprint must exist.
    let fp: Option<(String, Option<f64>)> =
        sqlx::query_as("SELECT calibration_type, exposure_s FROM calibration_fingerprint LIMIT 1")
            .fetch_optional(db.pool())
            .await
            .unwrap();
    let (cal_type, exposure_s) = fp.expect("calibration_fingerprint must exist");
    assert_eq!(cal_type, "dark");
    assert!((exposure_s.unwrap_or(0.0) - 300.0).abs() < f64::EPSILON);

    // source_inbox_item_id must link back to the inbox item.
    let source_id: Option<String> =
        sqlx::query_scalar("SELECT source_inbox_item_id FROM calibration_session LIMIT 1")
            .fetch_optional(db.pool())
            .await
            .unwrap();
    assert_eq!(source_id.as_deref(), Some(item_id));

    // Inbox item must be resolved.
    let state: String = sqlx::query_scalar("SELECT state FROM inbox_items WHERE id = ?")
        .bind(item_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(state, "resolved", "inbox item must be resolved after master confirm");
}

/// T040-US3-2: `masters_list` returns the registered master.
#[tokio::test]
async fn masters_list_returns_confirmed_master() {
    let tmp = tempfile::tempdir().unwrap();
    write_fits(tmp.path(), "masterFlat_Ha.fits", "FLAT");

    let db = test_db().await;
    let item_id = "master-item-flat";
    let sig = "sig-master-flat";

    insert_master_inbox_item(
        &db,
        item_id,
        "masterFlat_Ha.fits",
        "flat",
        Some("Ha"),
        Some(2.0),
        sig,
    )
    .await;

    confirm(
        db.pool(),
        ConfirmRequest {
            inbox_item_id: item_id.to_owned(),
            action: "confirm".to_owned(),
            content_signature: sig.to_owned(),
            destructive_destination: None,
            root_absolute_path: tmp.path().to_owned(),
        },
    )
    .await
    .unwrap();

    let masters = masters_list(db.pool()).await.unwrap();
    assert_eq!(masters.len(), 1, "one master must appear in calibration_masters_list");
    assert_eq!(
        masters[0].kind,
        contracts_core::calibration::CalibrationKind::Flat,
        "kind must be flat"
    );
    assert_eq!(masters[0].fingerprint.filter.as_deref(), Some("Ha"), "filter must be Ha");
    assert!((masters[0].fingerprint.exposure_s - 2.0).abs() < f64::EPSILON);
}

/// T040-US3-3: resolved item disappears from the unacknowledged list.
#[tokio::test]
async fn resolved_master_absent_from_unacknowledged_list() {
    let tmp = tempfile::tempdir().unwrap();
    write_fits(tmp.path(), "masterBias.fits", "BIAS");

    let db = test_db().await;
    let item_id = "master-item-bias";
    let sig = "sig-master-bias";

    // We also need a registered_source for list_unacknowledged_across_roots to work.
    sqlx::query(
        "INSERT INTO registered_sources (id, kind, path, kind_subtype, scan_depth, created_at, created_via)
         VALUES ('root-1', 'inbox', '/astro', NULL, 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
    )
    .execute(db.pool())
    .await
    .unwrap();

    insert_master_inbox_item(&db, item_id, "masterBias.fits", "bias", None, None, sig).await;

    // Before confirm: item must appear in the unacknowledged list.
    let before = inbox_repo::list_unacknowledged_across_roots(db.pool(), 100).await.unwrap();
    assert_eq!(before.len(), 1, "one unacknowledged item before confirm");

    confirm(
        db.pool(),
        ConfirmRequest {
            inbox_item_id: item_id.to_owned(),
            action: "confirm".to_owned(),
            content_signature: sig.to_owned(),
            destructive_destination: None,
            root_absolute_path: tmp.path().to_owned(),
        },
    )
    .await
    .unwrap();

    // After confirm: item must be gone from the unacknowledged list.
    let after = inbox_repo::list_unacknowledged_across_roots(db.pool(), 100).await.unwrap();
    assert!(after.is_empty(), "resolved master must not appear in unacknowledged list");
}

/// T040-US3-4: non-master items still go through the plan path (regression guard).
#[tokio::test]
async fn non_master_item_still_creates_plan() {
    let tmp = tempfile::tempdir().unwrap();
    // Write a light frame FITS
    write_fits(tmp.path(), "light_001.fits", "Light Frame");

    let db = test_db().await;
    let item_id = "non-master-item";
    let sig = "sig-non-master";

    inbox_repo::insert_inbox_item(
        db.pool(),
        &InsertInboxItem {
            id: item_id,
            root_id: "root-1",
            relative_path: "",
            file_count: 1,
            content_signature: Some(sig),
            lane: "fits",
        },
    )
    .await
    .unwrap();

    inbox_repo::upsert_classification(
        db.pool(),
        &UpsertClassification {
            inbox_item_id: item_id,
            result: "single_type",
            frame_type: Some("light"),
            content_signature: sig,
            unclassified_file_count: 0,
        },
    )
    .await
    .unwrap();

    inbox_repo::insert_evidence(
        db.pool(),
        &InsertEvidence {
            id: "ev-001",
            inbox_item_id: item_id,
            relative_file_path: "light_001.fits",
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

    let resp = confirm(
        db.pool(),
        ConfirmRequest {
            inbox_item_id: item_id.to_owned(),
            action: "confirm".to_owned(),
            content_signature: sig.to_owned(),
            destructive_destination: None,
            root_absolute_path: tmp.path().to_owned(),
        },
    )
    .await
    .unwrap();

    assert!(!resp.registered_as_master, "non-master must not set registered_as_master");
    assert!(!resp.plan_id.is_empty(), "non-master must produce a plan_id");
    assert_eq!(resp.plan_state, "ready_for_review");
    assert_eq!(resp.items_total, 1);
}
