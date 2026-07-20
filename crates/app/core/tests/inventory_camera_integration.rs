// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! #1343 — the camera shown on a Sessions inventory row.
//!
//! Every row previously rendered a blank camera regardless of registered
//! equipment (`camera: None` was hardcoded). These tests pin the two halves
//! of the replacement: a registered camera renders its user-facing name, and
//! an unregistered one still renders the raw header string rather than
//! blanking.
//!
//! The camera is sourced from `inbox_file_metadata.instrume` — the column the
//! metadata extraction pipeline actually writes — so the seeding here mirrors
//! a confirmed inbox item: `file_record` rows joined to metadata rows through
//! the item's root and relative path.

mod support;

use app_core::inventory;
use app_core_calibration::equipment::create_camera;
use contracts_core::equipment::CreateCamera;
use uuid::Uuid;

// ── seeding ───────────────────────────────────────────────────────────────────

async fn insert_library_root(pool: &sqlx::SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
         VALUES (?, 'Test Root', '/data/lights', 'local', 'active', '2026-01-01T00:00:00Z')",
    )
    .bind(id)
    .execute(pool)
    .await
    .expect("insert library_root");
}

/// Seed a session whose single active frame carries `instrume` in the inbox
/// metadata table, wired exactly as the confirm pipeline leaves it.
async fn insert_session_with_camera(
    pool: &sqlx::SqlitePool,
    root_id: &str,
    session_id: &str,
    relative_path: &str,
    instrume: Option<&str>,
) {
    let frame_id = Uuid::new_v4().to_string();
    let item_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO acquisition_session \
         (id, session_key, root_id, frame_ids, created_at) \
         VALUES (?, 'M31|Ha|1x1|100|2026-05-01', ?, ?, '2026-05-01T00:00:00Z')",
    )
    .bind(session_id)
    .bind(root_id)
    .bind(format!("[\"{frame_id}\"]"))
    .execute(pool)
    .await
    .expect("insert acquisition_session");

    sqlx::query(
        "INSERT INTO file_record \
         (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
         VALUES (?, ?, ?, 1024, '2026-05-01T00:00:00Z', 'classified', \
                 '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')",
    )
    .bind(&frame_id)
    .bind(root_id)
    .bind(relative_path)
    .execute(pool)
    .await
    .expect("insert file_record");

    sqlx::query(
        "INSERT INTO inbox_items \
         (id, root_id, relative_path, file_count, discovered_at, last_scanned_at, state) \
         VALUES (?, ?, 'M31/Ha', 1, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', 'resolved')",
    )
    .bind(&item_id)
    .bind(root_id)
    .execute(pool)
    .await
    .expect("insert inbox_items");

    sqlx::query(
        "INSERT INTO inbox_file_metadata (id, inbox_item_id, relative_file_path, instrume) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&item_id)
    .bind(relative_path)
    .bind(instrume)
    .execute(pool)
    .await
    .expect("insert inbox_file_metadata");
}

/// The single session's camera as `inventory.list` renders it.
async fn listed_camera(pool: &sqlx::SqlitePool) -> Option<String> {
    let sources = inventory::list(pool, None).await.expect("inventory::list");
    assert_eq!(sources.len(), 1, "expected exactly one source");
    assert_eq!(sources[0].sessions.len(), 1, "expected exactly one session");
    sources[0].sessions[0].camera.clone()
}

// ── tests ─────────────────────────────────────────────────────────────────────

/// A registered camera renders its user-facing name, not the raw header
/// string the capture program wrote — the blank-camera regression this fixes.
#[tokio::test]
async fn inventory_row_shows_registered_camera_name_not_raw_header() {
    let (db, _repo, bus) = support::setup().await;
    let root_id = Uuid::new_v4().to_string();

    insert_library_root(db.pool(), &root_id).await;
    insert_session_with_camera(
        db.pool(),
        &root_id,
        &Uuid::new_v4().to_string(),
        "M31/Ha/frame-001.fits",
        Some("ASI2600MM"),
    )
    .await;

    create_camera(
        db.pool(),
        &bus,
        &CreateCamera {
            name: "Main Imaging Rig".to_owned(),
            aliases: vec!["ASI2600MM".to_owned()],
            sensor_type: None,
            passband: None,
        },
    )
    .await
    .expect("create camera");

    assert_eq!(
        listed_camera(db.pool()).await,
        Some("Main Imaging Rig".to_owned()),
        "a registered camera must render its user-facing name"
    );
}

/// Alias matching ignores the case and surrounding whitespace differences
/// capture programs introduce for the same physical camera.
#[tokio::test]
async fn inventory_row_resolves_camera_name_ignoring_case_and_whitespace() {
    let (db, _repo, bus) = support::setup().await;
    let root_id = Uuid::new_v4().to_string();

    insert_library_root(db.pool(), &root_id).await;
    insert_session_with_camera(
        db.pool(),
        &root_id,
        &Uuid::new_v4().to_string(),
        "M31/Ha/frame-001.fits",
        Some("  asi2600mm "),
    )
    .await;

    create_camera(
        db.pool(),
        &bus,
        &CreateCamera {
            name: "Main Imaging Rig".to_owned(),
            aliases: vec!["ASI2600MM".to_owned()],
            sensor_type: None,
            passband: None,
        },
    )
    .await
    .expect("create camera");

    assert_eq!(listed_camera(db.pool()).await, Some("Main Imaging Rig".to_owned()));
}

/// An unregistered camera falls back to the raw header string. Guards the
/// fallback, so it must pass both before and after the fix in the revert
/// probe — a blank here would be the old bug wearing a new mask.
#[tokio::test]
async fn inventory_row_falls_back_to_raw_header_for_unregistered_camera() {
    let (db, _repo, _bus) = support::setup().await;
    let root_id = Uuid::new_v4().to_string();

    insert_library_root(db.pool(), &root_id).await;
    insert_session_with_camera(
        db.pool(),
        &root_id,
        &Uuid::new_v4().to_string(),
        "M31/Ha/frame-001.fits",
        Some("ASI2600MM"),
    )
    .await;

    assert_eq!(
        listed_camera(db.pool()).await,
        Some("ASI2600MM".to_owned()),
        "an unregistered camera must still identify the gear"
    );
}

/// A session whose frames carry no camera string renders blank rather than an
/// empty-string placeholder.
#[tokio::test]
async fn inventory_row_camera_is_absent_when_no_metadata_records_one() {
    let (db, _repo, _bus) = support::setup().await;
    let root_id = Uuid::new_v4().to_string();

    insert_library_root(db.pool(), &root_id).await;
    insert_session_with_camera(
        db.pool(),
        &root_id,
        &Uuid::new_v4().to_string(),
        "M31/Ha/frame-001.fits",
        None,
    )
    .await;

    assert_eq!(listed_camera(db.pool()).await, None);
}

/// Renaming a registered camera changes what the next `inventory.list` call
/// renders. The calibration masters list embeds resolved names in a
/// process-global snapshot cache and needed explicit invalidation (#879); the
/// inventory projection reads the pool on every call, and this pins that.
#[tokio::test]
async fn renaming_a_camera_changes_the_next_inventory_listing() {
    let (db, _repo, bus) = support::setup().await;
    let root_id = Uuid::new_v4().to_string();

    insert_library_root(db.pool(), &root_id).await;
    insert_session_with_camera(
        db.pool(),
        &root_id,
        &Uuid::new_v4().to_string(),
        "M31/Ha/frame-001.fits",
        Some("ASI2600MM"),
    )
    .await;

    let camera = create_camera(
        db.pool(),
        &bus,
        &CreateCamera {
            name: "Old Name".to_owned(),
            aliases: vec!["ASI2600MM".to_owned()],
            sensor_type: None,
            passband: None,
        },
    )
    .await
    .expect("create camera");

    assert_eq!(listed_camera(db.pool()).await, Some("Old Name".to_owned()));

    app_core_calibration::equipment::update_camera(
        db.pool(),
        &bus,
        &contracts_core::equipment::UpdateCamera {
            id: camera.id,
            name: "New Name".to_owned(),
            aliases: vec!["ASI2600MM".to_owned()],
            sensor_type: None,
            passband: None,
        },
    )
    .await
    .expect("update camera");

    assert_eq!(
        listed_camera(db.pool()).await,
        Some("New Name".to_owned()),
        "a rename must reach the inventory row without a restart"
    );
}
