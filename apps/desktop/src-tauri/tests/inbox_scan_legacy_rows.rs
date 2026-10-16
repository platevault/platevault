// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `inbox.scan.folder` retires the rows an earlier scan stored for a macOS or
//! Linux name containing a backslash (bd astro-plan-3pvvc).
//!
//! Before that fix the scan turned every `\` into `/`, so the folder `c\d` was
//! stored as `c/d` and the master `a\b.fits` as `a/b.fits`. The scan now
//! stores them under their own text and, in the same transaction, deletes the
//! old rows with everything hanging off them, unless a plan links one of
//! them. The command is called directly with the pool from a mock app, so this
//! covers the wiring the use-case tests cannot reach.
#![cfg(unix)]

use std::path::Path;

use app_core::inbox::classify::{classify, ClassifyRequest};
use app_core::inbox::confirm::{confirm, ConfirmRequest};
use app_core::inbox_plan::cancel_inbox_plan;
use audit::bus::EventBus;
use contracts_core::error_code::ErrorCode;
use contracts_core::inbox::InboxScanFolderRequest;
use desktop_shell::commands::inbox::inbox_scan_folder;
use persistence_core::Database;
use persistence_inbox::repositories::inbox as repo;
use sqlx::SqlitePool;
use tauri::Manager;

/// A FITS file the scan reads: a master when `stack_count` is set.
fn write_fits(dir: &Path, name: &str, imagetyp: &str, stack_count: Option<u32>) {
    write_fits_with(dir, name, imagetyp, stack_count, "Ha", "300.0");
}

/// [`write_fits`] with the given `FILTER` and `EXPTIME`.
fn write_fits_with(
    dir: &Path,
    name: &str,
    imagetyp: &str,
    stack_count: Option<u32>,
    filter: &str,
    exptime: &str,
) {
    let mut cards = vec![
        "SIMPLE  =                    T".to_owned(),
        "BITPIX  =                    8".to_owned(),
        "NAXIS   =                    2".to_owned(),
        "NAXIS1  =                    1".to_owned(),
        "NAXIS2  =                    1".to_owned(),
        format!("EXPTIME = {exptime:>20}"),
        format!("FILTER  = '{filter}'"),
        format!("IMAGETYP= '{imagetyp}'"),
    ];
    if let Some(count) = stack_count {
        cards.push(format!("STACKCNT= {count:>20}"));
    }
    let mut block = vec![b' '; 2880];
    for (idx, card) in cards.iter().enumerate() {
        block[idx * 80..idx * 80 + card.len()].copy_from_slice(card.as_bytes());
    }
    let end = cards.len() * 80;
    block[end..end + 3].copy_from_slice(b"END");
    block.extend_from_slice(&[0; 2880]);
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(dir.join(name), block).unwrap();
}

/// Give `item_id` a classification, evidence, metadata and a breakdown row.
async fn seed_classified(pool: &SqlitePool, item_id: &str, file: &str) {
    repo::upsert_classification(
        pool,
        &repo::UpsertClassification {
            inbox_item_id: item_id,
            result: "classified",
            frame_type: Some("light"),
            content_signature: "sig-old",
            unclassified_file_count: 0,
        },
    )
    .await
    .unwrap();
    repo::insert_evidence(
        pool,
        &repo::InsertEvidence {
            id: &format!("ev-{item_id}"),
            inbox_item_id: item_id,
            relative_file_path: file,
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
    repo::upsert_inbox_file_metadata(
        pool,
        &repo::UpsertFileMetadata {
            inbox_item_id: item_id,
            relative_file_path: file,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    repo::upsert_breakdown_row(pool, &format!("bd-{item_id}"), item_id, "light", 1, None, "[]")
        .await
        .unwrap();
    repo::update_inbox_item_state(pool, item_id, "classified").await.unwrap();
}

/// An old folder row as the scan and classify stored it: the folder's source
/// group with a file override, and one classified sub-item.
async fn seed_old_folder(pool: &SqlitePool, group: &str, item: &str, path: &str) {
    let row = repo::UpsertSourceGroup {
        id: group,
        root_id: "root-1",
        relative_path: path,
        content_signature: Some("sig-old"),
        format: Some("fits"),
        lane: Some("move"),
        file_count: 1,
    };
    repo::upsert_inbox_source_group(pool, &row).await.unwrap();
    let file = format!("{path}/x.fits");
    repo::set_file_override(pool, group, &file, "filter", "OIII", None, None).await.unwrap();
    let sub = repo::UpsertInboxSubItem {
        id: item,
        root_id: "root-1",
        relative_path: path,
        source_group_id: group,
        group_key: "type=light",
        group_label: "(root) · light",
        frame_type: Some("light"),
        content_signature: "sig-old",
        file_count: 1,
        lane: "fits",
        needs_review: false,
    };
    repo::upsert_inbox_sub_item(pool, &sub).await.unwrap();
    seed_classified(pool, item, &file).await;
}

/// The rows the old scan stored. The master `a/b.fits` was classified, which
/// reads the light frame at that path, and has an override. The folders
/// `c/d` and `e/f` each have a classified sub-item; `e/f`'s is linked to an
/// open plan.
async fn seed_old_rows(pool: &SqlitePool) {
    repo::insert_inbox_item(
        pool,
        &repo::InsertInboxItem {
            id: "old-master",
            root_id: "root-1",
            relative_path: "a/b.fits",
            file_count: 1,
            content_signature: Some("sig-old"),
            lane: "fits",
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE inbox_items SET is_master_item = 1 WHERE id = 'old-master'")
        .execute(pool)
        .await
        .unwrap();
    seed_classified(pool, "old-master", "a/b.fits").await;
    repo::set_overrides(pool, "old-master", "a/b.fits", None, Some("Ha"), None, None)
        .await
        .unwrap();
    seed_old_folder(pool, "old-cd", "old-cd-light", "c/d").await;
    seed_old_folder(pool, "old-ef", "old-ef-light", "e/f").await;
    let plan = persistence_plans::repositories::plans::InsertPlan {
        id: "plan-open",
        title: "Inbox confirm",
        origin: "inbox",
        origin_path: None,
        plan_type: "split",
        destructive_destination: "archive",
        parent_plan_id: None,
        total_bytes_required: 0,
    };
    persistence_plans::repositories::plans::insert_plan(pool, &plan).await.unwrap();
    repo::insert_plan_link(pool, "old-ef-light", "plan-open").await.unwrap();
    repo::update_inbox_item_state(pool, "old-ef-light", "plan_open").await.unwrap();
}

#[tokio::test]
async fn scan_retires_old_backslash_rows_with_their_children_and_keeps_linked_ones() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    // On disk: the folders `c\d` and `e\f`, and the master `a\b.fits` beside
    // the folder `a` holding a light frame named `b.fits`.
    write_fits(&root.join("c\\d"), "x.fits", "LIGHT", None);
    write_fits(&root.join("e\\f"), "x.fits", "LIGHT", None);
    write_fits(root, "a\\b.fits", "DARK", Some(30));
    write_fits(&root.join("a"), "b.fits", "LIGHT", None);

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    sqlx::query(
        "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
         VALUES ('root-1', ?, 'inbox', 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
    )
    .bind(root.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    seed_old_rows(&pool).await;

    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    app.manage(pool.clone());
    let req = InboxScanFolderRequest {
        root_id: "root-1".to_owned(),
        root_absolute_path: root.to_str().unwrap().to_owned(),
    };
    inbox_scan_folder(req, app.state::<SqlitePool>()).await.expect("scan succeeds");

    let strings = |sql: &'static str| {
        let pool = pool.clone();
        async move { sqlx::query_scalar::<_, String>(sql).fetch_all(&pool).await.unwrap() }
    };
    assert_eq!(
        strings("SELECT relative_path FROM inbox_items ORDER BY relative_path").await,
        ["a\\b.fits", "e/f"],
        "the new master row is stored; the old master and `c/d` go; linked `e/f` stays"
    );
    assert_eq!(
        strings("SELECT relative_path FROM inbox_source_groups ORDER BY relative_path").await,
        ["", "a", "c\\d", "e/f", "e\\f"],
        "the scan's groups are stored; the old `c/d` and the old master's group go"
    );
    assert_eq!(
        strings(
            "SELECT g.relative_path FROM inbox_file_overrides o \
             JOIN inbox_source_groups g ON g.id = o.source_group_id"
        )
        .await,
        ["e/f"],
        "only the kept folder's override is left"
    );
    for table in [
        "inbox_classifications",
        "inbox_classification_evidence",
        "inbox_file_metadata",
        "inbox_classification_breakdown",
    ] {
        // AssertSqlSafe: `table` comes from the fixed list above.
        let left: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT inbox_item_id FROM {table} ORDER BY 1"
        )))
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(left, ["old-ef-light"], "{table}: the deleted rows' children go with them");
    }
    let overrides: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_file_overrides")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(overrides, 1, "no override is orphaned");
}

/// Run `inbox.scan.folder` on `root` as `root-1`.
async fn scan(pool: &SqlitePool, root: &Path) {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    app.manage(pool.clone());
    let req = InboxScanFolderRequest {
        root_id: "root-1".to_owned(),
        root_absolute_path: root.to_str().unwrap().to_owned(),
    };
    inbox_scan_folder(req, app.state::<SqlitePool>()).await.expect("scan succeeds");
}

/// A plan made before the update from the old master row `a/b.fits` keeps
/// that row through the scan. Cancelling the plan removes the link and returns
/// the row to unconfirmed with no scan in between. Confirming the row again
/// must not plan the light frame at `a/b.fits` a second time: the row is
/// removed instead.
#[tokio::test]
async fn an_old_master_kept_for_its_plan_is_not_planned_again_after_cancel() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_fits(root, "a\\b.fits", "DARK", Some(30));
    write_fits(&root.join("a"), "b.fits", "LIGHT", None);

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    // The inbox, a light-frames library to plan into, and patterns that need
    // no header attributes.
    for (id, kind) in [("root-1", "inbox"), ("dest-1", "light_frames")] {
        sqlx::query(
            "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
             VALUES (?, ?, ?, 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
        )
        .bind(id)
        .bind(root.to_str().unwrap())
        .bind(kind)
        .execute(&pool)
        .await
        .unwrap();
    }
    for (key, value) in [
        ("pattern", r#"[{"id":"p0","kind":"token","value":"frame_type"}]"#),
        ("patternsByType", r#"{"light":"lights/"}"#),
    ] {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, '2026-01-01T00:00:00Z')",
        )
        .bind(key)
        .bind(value)
        .execute(&pool)
        .await
        .unwrap();
    }
    // The old master row, classified before the update on the light frame
    // that sits at `a/b.fits`.
    repo::insert_inbox_item(
        &pool,
        &repo::InsertInboxItem {
            id: "old-master",
            root_id: "root-1",
            relative_path: "a/b.fits",
            file_count: 1,
            content_signature: Some("sig-old"),
            lane: "fits",
        },
    )
    .await
    .unwrap();
    sqlx::query(
        "UPDATE inbox_items SET is_master_item = 1, frame_type = 'light' WHERE id = 'old-master'",
    )
    .execute(&pool)
    .await
    .unwrap();
    seed_classified(&pool, "old-master", "a/b.fits").await;

    let bus = EventBus::with_pool(pool.clone());
    let confirm_old = || {
        let req = ConfirmRequest {
            inbox_item_id: "old-master".to_owned(),
            content_signature: "sig-old".to_owned(),
            destructive_destination: None,
            root_absolute_path: root.to_path_buf(),
            root_id: None,
            chosen_attribution: None,
        };
        confirm(&pool, &bus, req)
    };
    confirm_old().await.expect("the plan made before the update");

    scan(&pool, root).await;
    let state: String = sqlx::query_scalar("SELECT state FROM inbox_items WHERE id = 'old-master'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "plan_open", "the scan keeps the old row while its plan is open");

    cancel_inbox_plan(&pool, &bus, "old-master").await.expect("cancel the old plan");
    let err = confirm_old().await.expect_err("the old row must not be planned again");
    assert_eq!(err.code, ErrorCode::InboxItemNotFound);

    let strings = |sql: &'static str| {
        let pool = pool.clone();
        async move { sqlx::query_scalar::<_, String>(sql).fetch_all(&pool).await.unwrap() }
    };
    assert_eq!(
        strings("SELECT relative_path FROM inbox_items ORDER BY relative_path").await,
        ["a\\b.fits"],
        "the old row is gone; the master's own row stays"
    );
    assert_eq!(strings("SELECT state FROM plans").await, ["discarded"], "no second plan was made");
    let links: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inbox_plan_links").fetch_one(&pool).await.unwrap();
    assert_eq!(links, 0);
}

/// A real master at `a/b.fits` beside the root-level master `a\b.fits`. The
/// nested row is that master's own: the scan stores it under its current text
/// and classify records master evidence for it. Confirm must plan it, not
/// remove it as a stale old-text row.
#[tokio::test]
async fn a_real_nested_master_beside_a_backslash_master_is_planned() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_fits(root, "a\\b.fits", "DARK", Some(30));
    write_fits(&root.join("a"), "b.fits", "DARK", Some(30));

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    // The inbox and a calibration library to plan masters into.
    for (id, kind) in [("root-1", "inbox"), ("dest-cal", "calibration")] {
        sqlx::query(
            "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
             VALUES (?, ?, ?, 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
        )
        .bind(id)
        .bind(root.to_str().unwrap())
        .bind(kind)
        .execute(&pool)
        .await
        .unwrap();
    }

    scan(&pool, root).await;
    let masters: Vec<(String, String)> = sqlx::query_as(
        "SELECT relative_path, id FROM inbox_items WHERE is_master_item = 1 ORDER BY relative_path",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let paths: Vec<&str> = masters.iter().map(|(path, _)| path.as_str()).collect();
    assert_eq!(paths, ["a/b.fits", "a\\b.fits"], "the scan stores both masters");
    let nested_id = masters[0].1.clone();

    let classified = classify(
        &pool,
        ClassifyRequest {
            inbox_item_id: nested_id.clone(),
            root_absolute_path: root.to_path_buf(),
            force_rescan: false,
        },
    )
    .await
    .expect("classify the nested master");
    let evidence: Vec<(String, i64)> = sqlx::query_as(
        "SELECT relative_file_path, is_master FROM inbox_classification_evidence \
         WHERE inbox_item_id = ?",
    )
    .bind(&nested_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(evidence, [("a/b.fits".to_owned(), 1)], "classify read the nested master");

    let bus = EventBus::with_pool(pool.clone());
    confirm(
        &pool,
        &bus,
        ConfirmRequest {
            inbox_item_id: nested_id.clone(),
            content_signature: classified.content_signature,
            destructive_destination: None,
            root_absolute_path: root.to_path_buf(),
            root_id: None,
            chosen_attribution: None,
        },
    )
    .await
    .expect("the nested master is planned");

    let state: String = sqlx::query_scalar("SELECT state FROM inbox_items WHERE id = ?")
        .bind(&nested_id)
        .fetch_one(&pool)
        .await
        .expect("the nested master's row stays");
    assert_eq!(state, "plan_open");
    let links: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inbox_plan_links WHERE inbox_item_id = ?")
            .bind(&nested_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(links, 1);
}

/// The real nested master `a/b.fits` beside the root-level master `a\b.fits`,
/// as in [`a_real_nested_master_beside_a_backslash_master_is_planned`], whose
/// header classify can no longer read when it is classified again. Its
/// evidence is then unclassified and not a master, which proves nothing about
/// the file: confirm refuses through its own guards, and the row stays with
/// its classification and override.
#[tokio::test]
async fn a_nested_master_classify_cannot_read_is_kept_by_confirm() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_fits(root, "a\\b.fits", "DARK", Some(30));
    write_fits(&root.join("a"), "b.fits", "DARK", Some(30));

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    for (id, kind) in [("root-1", "inbox"), ("dest-cal", "calibration")] {
        sqlx::query(
            "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
             VALUES (?, ?, ?, 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
        )
        .bind(id)
        .bind(root.to_str().unwrap())
        .bind(kind)
        .execute(&pool)
        .await
        .unwrap();
    }

    scan(&pool, root).await;
    let nested_id: String = sqlx::query_scalar(
        "SELECT id FROM inbox_items WHERE is_master_item = 1 AND relative_path = 'a/b.fits'",
    )
    .fetch_one(&pool)
    .await
    .expect("the scan stores the nested master");
    repo::set_overrides(&pool, &nested_id, "a/b.fits", None, Some("OIII"), None, None)
        .await
        .unwrap();

    // The nested file's header can no longer be read.
    std::fs::write(root.join("a").join("b.fits"), b"not a FITS header").unwrap();
    let classified = classify(
        &pool,
        ClassifyRequest {
            inbox_item_id: nested_id.clone(),
            root_absolute_path: root.to_path_buf(),
            force_rescan: true,
        },
    )
    .await
    .expect("classify the nested master again");
    let evidence: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT relative_file_path, unclassified, is_master FROM inbox_classification_evidence \
         WHERE inbox_item_id = ?",
    )
    .bind(&nested_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(evidence, [("a/b.fits".to_owned(), 1, 0)], "classify could not read the file");

    let bus = EventBus::with_pool(pool.clone());
    let err = confirm(
        &pool,
        &bus,
        ConfirmRequest {
            inbox_item_id: nested_id.clone(),
            content_signature: classified.content_signature,
            destructive_destination: None,
            root_absolute_path: root.to_path_buf(),
            root_id: None,
            chosen_attribution: None,
        },
    )
    .await
    .expect_err("an unclassified master is not confirmable");
    assert_ne!(
        err.code,
        ErrorCode::InboxItemNotFound,
        "confirm refuses; it does not remove the row"
    );

    let kept: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_items WHERE id = ?")
        .bind(&nested_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(kept, 1, "the nested master's row stays");
    let classifications: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inbox_classifications WHERE inbox_item_id = ?")
            .bind(&nested_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(classifications, 1, "its classification stays");
    let overrides: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM inbox_file_overrides WHERE relative_file_path = 'a/b.fits'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(overrides, 1, "its override stays");
}

/// The folder `c\d` beside a folder `d` in `c` that holds no frame directly,
/// only the folder `e` with one. The old scan stored `c\d` under `c/d` with a
/// classified sub-item and an override for `c/d/x.fits`, a file that is not
/// there, so confirming the sub-item would plan a missing source. The scan
/// reads `c/d` whole, deletes the old folder's rows, and stores its own groups.
#[tokio::test]
async fn an_old_folder_row_at_a_folder_with_no_frames_goes() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_fits(&root.join("c\\d"), "x.fits", "LIGHT", None);
    write_fits(&root.join("c").join("d").join("e"), "x.fits", "LIGHT", None);

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    sqlx::query(
        "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
         VALUES ('root-1', ?, 'inbox', 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
    )
    .bind(root.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    seed_old_folder(&pool, "old-cd", "old-cd-light", "c/d").await;

    scan(&pool, root).await;

    let items: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inbox_items").fetch_one(&pool).await.unwrap();
    assert_eq!(items, 0, "the old folder's sub-item goes");
    let groups: Vec<String> =
        sqlx::query_scalar("SELECT relative_path FROM inbox_source_groups ORDER BY relative_path")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(groups, ["c/d/e", "c\\d"], "the old folder's group goes; the scan's are stored");
    let overrides: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_file_overrides")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(overrides, 0, "the old folder's override goes with its group");
    let classified: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_classifications")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(classified, 0, "the old sub-item's classification goes with it");
}

/// A master row: path, id, state, master type, filter and exposure.
type MasterRow = (String, String, String, Option<String>, Option<String>, Option<f64>);

/// A database for `root` holding the row the old scan shared between the
/// master `a\b.fits` and a nested master `a/b.fits`: it wrote both to the one
/// `a/b.fits` row with `INSERT OR IGNORE`, the root-level file first, so the
/// row holds `a\b.fits`'s master type, filter and exposure (dark, Ha, 300 s).
/// A plan made before the update links the row.
async fn seed_shared_old_master(root: &Path) -> SqlitePool {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    sqlx::query(
        "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
         VALUES ('root-1', ?, 'inbox', 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
    )
    .bind(root.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    repo::insert_inbox_item(
        &pool,
        &repo::InsertInboxItem {
            id: "old-master",
            root_id: "root-1",
            relative_path: "a/b.fits",
            file_count: 1,
            content_signature: Some("sig-old"),
            lane: "fits",
        },
    )
    .await
    .unwrap();
    sqlx::query(
        "UPDATE inbox_items SET is_master_item = 1, master_frame_type = 'dark', \
         master_filter = 'Ha', master_exposure_s = 300.0 WHERE id = 'old-master'",
    )
    .execute(&pool)
    .await
    .unwrap();
    let plan = persistence_plans::repositories::plans::InsertPlan {
        id: "plan-old",
        title: "Inbox confirm",
        origin: "inbox",
        origin_path: None,
        plan_type: "split",
        destructive_destination: "archive",
        parent_plan_id: None,
        total_bytes_required: 0,
    };
    persistence_plans::repositories::plans::insert_plan(&pool, &plan).await.unwrap();
    repo::insert_plan_link(&pool, "old-master", "plan-old").await.unwrap();
    repo::update_inbox_item_state(&pool, "old-master", "plan_open").await.unwrap();
    pool
}

/// The row [`seed_shared_old_master`] seeds, beside both masters on disk.
/// The scan keeps the row as the nested master's own and rewrites its master
/// fields from the nested master, because the plan listener registers the
/// master from them when the plan applies.
#[tokio::test]
async fn a_master_row_the_old_scan_shared_takes_the_nested_masters_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_fits_with(root, "a\\b.fits", "DARK", Some(30), "Ha", "300.0");
    write_fits_with(&root.join("a"), "b.fits", "FLAT", Some(30), "L", "2.5");
    let pool = seed_shared_old_master(root).await;

    scan(&pool, root).await;

    let masters: Vec<MasterRow> = sqlx::query_as(
        "SELECT relative_path, id, state, master_frame_type, master_filter, master_exposure_s \
         FROM inbox_items WHERE is_master_item = 1 ORDER BY relative_path",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(masters.len(), 2, "{masters:?}");
    let (path, id, state, frame_type, filter, exposure) = &masters[0];
    assert_eq!(
        (path.as_str(), id.as_str(), state.as_str()),
        ("a/b.fits", "old-master", "plan_open")
    );
    assert_eq!(
        (frame_type.as_deref(), filter.as_deref(), *exposure),
        (Some("flat"), Some("L"), Some(2.5)),
        "the kept row describes the nested master"
    );
    let (path, _, _, frame_type, filter, exposure) = &masters[1];
    assert_eq!(path, "a\\b.fits");
    assert_eq!(
        (frame_type.as_deref(), filter.as_deref(), *exposure),
        (Some("dark"), Some("Ha"), Some(300.0))
    );
}

/// The row [`seed_shared_old_master`] seeds, beside the nested master and a
/// file `a\b.fits` whose header the scan can no longer read. The scan still
/// rewrites the kept row's master fields from the nested master.
#[tokio::test]
async fn a_shared_master_row_takes_the_nested_masters_fields_when_the_other_file_is_unreadable() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::write(root.join("a\\b.fits"), b"not a FITS header").unwrap();
    write_fits_with(&root.join("a"), "b.fits", "FLAT", Some(30), "L", "2.5");
    let pool = seed_shared_old_master(root).await;

    scan(&pool, root).await;

    let masters: Vec<MasterRow> = sqlx::query_as(
        "SELECT relative_path, id, state, master_frame_type, master_filter, master_exposure_s \
         FROM inbox_items WHERE is_master_item = 1 ORDER BY relative_path",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        masters,
        [(
            "a/b.fits".to_owned(),
            "old-master".to_owned(),
            "plan_open".to_owned(),
            Some("flat".to_owned()),
            Some("L".to_owned()),
            Some(2.5)
        )],
        "the kept row describes the nested master"
    );
}

/// An empty folder `c\d` is all the root holds, so the scan finds no leaf
/// folder. The old scan stored `c\d` under `c/d` with a classified sub-item
/// and an override for `c/d/x.fits`, a file that is not there. The scan
/// deletes the old folder's rows.
#[tokio::test]
async fn an_old_folder_row_of_an_empty_backslash_folder_goes() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join("c\\d")).unwrap();

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    sqlx::query(
        "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
         VALUES ('root-1', ?, 'inbox', 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
    )
    .bind(root.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    seed_old_folder(&pool, "old-cd", "old-cd-light", "c/d").await;

    scan(&pool, root).await;

    for table in
        ["inbox_items", "inbox_source_groups", "inbox_file_overrides", "inbox_classifications"]
    {
        // AssertSqlSafe: `table` comes from the fixed list above.
        let rows: i64 =
            sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(rows, 0, "{table}: the old folder's rows go");
    }
}

/// The folder `g\h.fits` beside the master `h.fits` in the folder `g`. The
/// old scan stored the folder under `g/h.fits`, the master's own text, with
/// a classified sub-item, so the queue held a folder row nobody can
/// classify. The scan deletes the folder's rows there and keeps the master
/// row, which is linked to a plan.
#[tokio::test]
async fn an_old_folder_row_at_a_masters_path_goes_and_the_master_stays() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_fits(&root.join("g\\h.fits"), "x.fits", "LIGHT", None);
    write_fits(&root.join("g"), "h.fits", "DARK", Some(30));

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    sqlx::query(
        "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
         VALUES ('root-1', ?, 'inbox', 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
    )
    .bind(root.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    repo::insert_inbox_item(
        &pool,
        &repo::InsertInboxItem {
            id: "master-gh",
            root_id: "root-1",
            relative_path: "g/h.fits",
            file_count: 1,
            content_signature: Some("sig-master"),
            lane: "fits",
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE inbox_items SET is_master_item = 1 WHERE id = 'master-gh'")
        .execute(&pool)
        .await
        .unwrap();
    let plan = persistence_plans::repositories::plans::InsertPlan {
        id: "plan-master",
        title: "Inbox confirm",
        origin: "inbox",
        origin_path: None,
        plan_type: "split",
        destructive_destination: "archive",
        parent_plan_id: None,
        total_bytes_required: 0,
    };
    persistence_plans::repositories::plans::insert_plan(&pool, &plan).await.unwrap();
    repo::insert_plan_link(&pool, "master-gh", "plan-master").await.unwrap();
    repo::update_inbox_item_state(&pool, "master-gh", "plan_open").await.unwrap();
    seed_old_folder(&pool, "old-gh", "old-gh-light", "g/h.fits").await;

    scan(&pool, root).await;

    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT id, relative_path, is_master_item FROM inbox_items ORDER BY relative_path, id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        rows,
        [("master-gh".to_owned(), "g/h.fits".to_owned(), 1)],
        "the folder's sub-item goes; the master row stays"
    );
    let groups: Vec<String> =
        sqlx::query_scalar("SELECT relative_path FROM inbox_source_groups ORDER BY relative_path")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        groups,
        ["g", "g\\h.fits"],
        "the old folder group goes; the scan's groups are stored"
    );
    let overrides: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_file_overrides")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(overrides, 0, "the old folder's override goes with its group");
    let links: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM inbox_plan_links").fetch_one(&pool).await.unwrap();
    assert_eq!(links, 1, "the master's plan link stays");
}

/// The master `a\b.fits` beside the folder `b.fits` in the folder `a`. The
/// old scan stored the master under `a/b.fits`, the folder's own text, and
/// gave it a classification and an override. A master row names a file, so
/// the scan deletes it with its override, and the folder's group, which took
/// over the master's `sg-auto-*` group, stays and is listed to classify.
#[tokio::test]
async fn an_old_master_row_at_a_folders_path_goes_and_the_folder_stays() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_fits(root, "a\\b.fits", "DARK", Some(30));
    write_fits(&root.join("a").join("b.fits"), "x.fits", "LIGHT", None);

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    sqlx::query(
        "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
         VALUES ('root-1', ?, 'inbox', 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
    )
    .bind(root.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    repo::insert_inbox_item(
        &pool,
        &repo::InsertInboxItem {
            id: "old-master",
            root_id: "root-1",
            relative_path: "a/b.fits",
            file_count: 1,
            content_signature: Some("sig-old"),
            lane: "fits",
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE inbox_items SET is_master_item = 1 WHERE id = 'old-master'")
        .execute(&pool)
        .await
        .unwrap();
    seed_classified(&pool, "old-master", "a/b.fits").await;
    repo::set_overrides(&pool, "old-master", "a/b.fits", None, Some("Ha"), None, None)
        .await
        .unwrap();

    scan(&pool, root).await;

    let items: Vec<String> =
        sqlx::query_scalar("SELECT relative_path FROM inbox_items ORDER BY relative_path")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(items, ["a\\b.fits"], "the old master row goes; the master's own row is stored");
    let unclassified: Vec<String> = repo::list_unclassified_source_groups(&pool, 100)
        .await
        .unwrap()
        .into_iter()
        .map(|group| group.relative_path)
        .collect();
    assert_eq!(unclassified, ["a/b.fits"], "the folder stays, ready to classify");
    let overrides: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_file_overrides")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(overrides, 0, "the old master's override goes");
    let classified: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_classifications")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(classified, 0, "the old master's classification goes with it");
}

/// The master `a\b.fits` beside an empty folder `b.fits` in the folder `a`.
/// The old scan stored the master under `a/b.fits` and gave it an override,
/// so its own `sg-auto-*` group is there. The scan stores no group for an
/// empty folder, so that group is no folder's: the scan deletes the old master
/// row with its classification, override and group.
#[tokio::test]
async fn an_old_master_row_at_an_empty_folders_path_goes_with_its_group() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_fits(root, "a\\b.fits", "DARK", Some(30));
    std::fs::create_dir_all(root.join("a").join("b.fits")).unwrap();

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    sqlx::query(
        "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
         VALUES ('root-1', ?, 'inbox', 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
    )
    .bind(root.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    repo::insert_inbox_item(
        &pool,
        &repo::InsertInboxItem {
            id: "old-master",
            root_id: "root-1",
            relative_path: "a/b.fits",
            file_count: 1,
            content_signature: Some("sig-old"),
            lane: "fits",
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE inbox_items SET is_master_item = 1 WHERE id = 'old-master'")
        .execute(&pool)
        .await
        .unwrap();
    seed_classified(&pool, "old-master", "a/b.fits").await;
    repo::set_overrides(&pool, "old-master", "a/b.fits", None, Some("Ha"), None, None)
        .await
        .unwrap();

    scan(&pool, root).await;

    let items: Vec<String> =
        sqlx::query_scalar("SELECT relative_path FROM inbox_items ORDER BY relative_path")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(items, ["a\\b.fits"], "the old master row goes; the master's own row is stored");
    let groups: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM inbox_source_groups WHERE relative_path = 'a/b.fits'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(groups, 0, "the old master's group goes: no folder there has one");
    let overrides: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_file_overrides")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(overrides, 0, "the old master's override goes");
    let classified: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inbox_classifications")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(classified, 0, "the old master's classification goes with it");
}

/// The folder `g\h.fits` beside the master `h.fits` in the folder `g`. The
/// old scan stored the folder's placeholder row under `g/h.fits`, the
/// master's own text, with the same empty group key a master row has, so the
/// master's insert was skipped and the master has no row. The scan deletes the
/// placeholder before it stores masters, so the master gets its row.
#[tokio::test]
async fn an_old_folder_placeholder_at_a_masters_path_gives_way_to_the_master() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    write_fits(&root.join("g\\h.fits"), "x.fits", "LIGHT", None);
    write_fits(&root.join("g"), "h.fits", "DARK", Some(30));

    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    sqlx::query(
        "INSERT INTO registered_sources (id, path, kind, scan_depth, created_at, created_via) \
         VALUES ('root-1', ?, 'inbox', 'recursive', '2026-01-01T00:00:00Z', 'first_run')",
    )
    .bind(root.to_str().unwrap())
    .execute(&pool)
    .await
    .unwrap();
    repo::insert_inbox_item(
        &pool,
        &repo::InsertInboxItem {
            id: "old-placeholder",
            root_id: "root-1",
            relative_path: "g/h.fits",
            file_count: 1,
            content_signature: Some("sig-old"),
            lane: "fits",
        },
    )
    .await
    .unwrap();

    scan(&pool, root).await;

    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT relative_path, is_master_item FROM inbox_items ORDER BY relative_path",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        rows,
        [("g/h.fits".to_owned(), 1)],
        "the placeholder goes; the master's own row is stored"
    );
}
