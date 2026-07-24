// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use domain_core::first_run::{
    BatchStatus, ItemStatus, RegisterSourceBatchRequest, RegisterSourceRequest, ScanDepth,
    SourceKind,
};

use super::*;
use persistence_core::{Database, DbError};

async fn setup_db() -> SqlitePool {
    let db = Database::in_memory().await.expect("in-memory connect");
    db.migrate().await.expect("migrations");
    db.pool().clone()
}

#[tokio::test]
async fn register_and_list_source() {
    let pool = setup_db().await;
    let req = RegisterSourceRequest {
        kind: SourceKind::LightFrames,
        path: "/astro/raw".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };

    let resp = register_source(&pool, &req).await.unwrap();
    assert_eq!(resp.kind, SourceKind::LightFrames);
    assert_eq!(resp.path, "/astro/raw");
    assert!(!resp.source_id.is_empty());

    let all = list_sources(&pool).await.unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].source_id, resp.source_id);
}

#[tokio::test]
async fn duplicate_kind_path_fails() {
    let pool = setup_db().await;
    let req = RegisterSourceRequest {
        kind: SourceKind::LightFrames,
        path: "/astro/raw".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };

    register_source(&pool, &req).await.unwrap();
    let result = register_source(&pool, &req).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn remove_source_succeeds() {
    let pool = setup_db().await;
    let req = RegisterSourceRequest {
        kind: SourceKind::Project,
        path: "/astro/projects".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };

    let resp = register_source(&pool, &req).await.unwrap();
    remove_source(&pool, &resp.source_id).await.unwrap();

    let all = list_sources(&pool).await.unwrap();
    assert!(all.is_empty());
}

#[tokio::test]
async fn remove_nonexistent_returns_not_found() {
    let pool = setup_db().await;
    let result = remove_source(&pool, "nonexistent-id").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn first_run_state_default_when_no_row() {
    let pool = setup_db().await;
    let state = get_first_run_state(&pool).await.unwrap();
    assert_eq!(state.last_step, "source_folders");
    assert!(state.completed_at.is_none());
}

#[tokio::test]
async fn complete_first_run_requires_light_and_project() {
    let pool = setup_db().await;

    // No sources: should fail.
    let result = complete_first_run(&pool).await;
    assert!(result.is_err());

    // Only light_frames: should fail (project missing).
    let req = RegisterSourceRequest {
        kind: SourceKind::LightFrames,
        path: "/astro/raw".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };
    register_source(&pool, &req).await.unwrap();
    let result = complete_first_run(&pool).await;
    assert!(result.is_err());

    // Add project: light + project present — inbox is not required (spec 039).
    let req = RegisterSourceRequest {
        kind: SourceKind::Project,
        path: "/astro/projects".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };
    register_source(&pool, &req).await.unwrap();
    let resp = complete_first_run(&pool).await.unwrap();
    assert!(!resp.completed_at.is_empty());

    // Verify state updated.
    let state = get_first_run_state(&pool).await.unwrap();
    assert_eq!(state.last_step, "complete");
    assert!(state.completed_at.is_some());
}

#[tokio::test]
async fn restart_first_run_clears_completed_at() {
    let pool = setup_db().await;

    let raw = RegisterSourceRequest {
        kind: SourceKind::LightFrames,
        path: "/astro/lights".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };
    let proj = RegisterSourceRequest {
        kind: SourceKind::Project,
        path: "/astro/projects".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };
    let inbox = RegisterSourceRequest {
        kind: SourceKind::Inbox,
        path: "/astro/inbox".to_owned(),
        kind_subtype: None,
        scan_depth: ScanDepth::Recursive,
        organization_state: OrganizationState::Organized,
    };
    register_source(&pool, &raw).await.unwrap();
    register_source(&pool, &proj).await.unwrap();
    register_source(&pool, &inbox).await.unwrap();
    complete_first_run(&pool).await.unwrap();

    let resp = restart_first_run(&pool).await.unwrap();
    assert_eq!(resp.prefilled_sources.len(), 3);

    let state = get_first_run_state(&pool).await.unwrap();
    assert!(state.completed_at.is_none());
    assert_eq!(state.last_step, "source_folders");
}

#[tokio::test]
async fn batch_register_partial_success() {
    let pool = setup_db().await;

    let req = RegisterSourceBatchRequest {
        sources: vec![
            RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
            RegisterSourceRequest {
                kind: SourceKind::LightFrames,
                path: "/astro/raw".to_owned(), // duplicate — will fail
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        ],
    };

    let resp = register_source_batch(&pool, &req).await.unwrap();
    assert_eq!(resp.status, BatchStatus::Partial);
    assert_eq!(resp.items[0].status, ItemStatus::Success);
    assert!(resp.items[0].source_id.is_some());
    assert_eq!(resp.items[1].status, ItemStatus::Failure);
    assert!(resp.items[1].error.is_some());
}

/// C2: `complete_first_run` must succeed with only light_frames + project
/// (no inbox source required — spec 039 removed inbox from REQUIRED_KINDS).
#[tokio::test]
async fn complete_first_run_succeeds_without_inbox() {
    let pool = setup_db().await;

    register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/lights".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/astro/projects".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    // No inbox registered — must succeed now.
    let resp = complete_first_run(&pool).await.unwrap();
    assert!(!resp.completed_at.is_empty(), "completed_at must be set");
    assert_eq!(resp.registered_source_count, 2);

    let state = get_first_run_state(&pool).await.unwrap();
    assert_eq!(state.last_step, "complete");
}

/// C2 boundary: still fails when only light_frames is registered (project missing).
#[tokio::test]
async fn complete_first_run_still_requires_light_and_project() {
    let pool = setup_db().await;

    register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/lights".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    let err = complete_first_run(&pool).await;
    assert!(err.is_err(), "should fail without a project source");
}

/// H1: `remove_source` must delete orphaned `inbox_items` for the removed
/// source so no zombie rows remain.
#[tokio::test]
async fn remove_source_deletes_inbox_items() {
    use persistence_inbox::repositories::inbox::{insert_inbox_item, InsertInboxItem};

    let pool = setup_db().await;

    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/astro/inbox".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        },
    )
    .await
    .unwrap();
    let source_id = resp.source_id;

    // Insert an inbox item for this source.
    insert_inbox_item(
        &pool,
        &InsertInboxItem {
            id: "orphan-item-1",
            root_id: &source_id,
            relative_path: "2025-10-01/lights",
            file_count: 3,
            content_signature: None,
            lane: "fits",
        },
    )
    .await
    .unwrap();

    // Verify it exists.
    let count_before: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM inbox_items WHERE root_id = ?")
        .bind(&source_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_before.0, 1, "inbox item should exist before removal");

    // Remove the source.
    remove_source(&pool, &source_id).await.unwrap();

    // Inbox items for that root must be gone.
    let count_after: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM inbox_items WHERE root_id = ?")
        .bind(&source_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_after.0, 0, "inbox items must be deleted with the source");
}

// ── spec 041 US4: organization-state read/write ──────────────────────────

#[tokio::test]
async fn inbox_source_always_unorganized_on_write() {
    let pool = setup_db().await;
    // Even if the caller requests `organized`, an inbox source is stored as
    // `unorganized` (T029 invariant).
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/astro/inbox".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();
    assert!(matches!(resp.organization_state, OrganizationState::Unorganized));

    let read = get_source_organization_state(&pool, &resp.source_id).await.unwrap();
    assert_eq!(read, Some(OrganizationState::Unorganized));
}

#[tokio::test]
async fn set_org_state_rejects_inbox_organized() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/astro/inbox".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        },
    )
    .await
    .unwrap();

    let err = set_source_organization_state(&pool, &resp.source_id, OrganizationState::Organized)
        .await
        .unwrap_err();
    match err {
        DbError::CasFailed(msg) => {
            assert!(msg.contains("source.invalid_organization_state"), "got: {msg}");
        }
        other => panic!("expected CasFailed, got {other:?}"),
    }

    // State unchanged.
    let read = get_source_organization_state(&pool, &resp.source_id).await.unwrap();
    assert_eq!(read, Some(OrganizationState::Unorganized));
}

#[tokio::test]
async fn set_org_state_round_trips_for_non_inbox() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/lights".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    // Flip organized → unorganized and back.
    set_source_organization_state(&pool, &resp.source_id, OrganizationState::Unorganized)
        .await
        .unwrap();
    assert_eq!(
        get_source_organization_state(&pool, &resp.source_id).await.unwrap(),
        Some(OrganizationState::Unorganized)
    );

    set_source_organization_state(&pool, &resp.source_id, OrganizationState::Organized)
        .await
        .unwrap();
    assert_eq!(
        get_source_organization_state(&pool, &resp.source_id).await.unwrap(),
        Some(OrganizationState::Organized)
    );
}

#[tokio::test]
async fn set_org_state_not_found() {
    let pool = setup_db().await;
    let err = set_source_organization_state(&pool, "nope", OrganizationState::Organized)
        .await
        .unwrap_err();
    assert!(matches!(err, DbError::NotFound(_)));
}

// ── P6a: root remap repository functions ────────────────────────────────

#[tokio::test]
async fn get_source_kind_and_path_roundtrips() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    let (kind, path) = get_source_kind_and_path(&pool, &resp.source_id).await.unwrap().unwrap();
    assert_eq!(kind, SourceKind::LightFrames);
    assert_eq!(path, "/astro/raw");
}

#[tokio::test]
async fn get_source_kind_and_path_missing_returns_none() {
    let pool = setup_db().await;
    let result = get_source_kind_and_path(&pool, "nonexistent-id").await.unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn set_source_path_updates_row() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    set_source_path(&pool, &resp.source_id, "/mnt/new/raw").await.unwrap();

    let (_, path) = get_source_kind_and_path(&pool, &resp.source_id).await.unwrap().unwrap();
    assert_eq!(path, "/mnt/new/raw");
}

#[tokio::test]
async fn set_source_path_missing_returns_not_found() {
    let pool = setup_db().await;
    let result = set_source_path(&pool, "nonexistent-id", "/mnt/new").await;
    assert!(matches!(result, Err(DbError::NotFound(_))));
}

#[tokio::test]
async fn relative_paths_for_root_empty_when_no_records() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::Calibration,
            path: "/astro/cals".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    let paths = relative_paths_for_root(&pool, &resp.source_id).await.unwrap();
    assert!(paths.is_empty());
}

#[tokio::test]
async fn relative_paths_for_root_is_exhaustive_and_ordered() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    // `file_record.root_id` FKs the legacy `library_root` table, not
    // `registered_sources` (see `app_targets::ingest_sessions` doc
    // comment). The real ingest pipeline mirrors the `registered_sources`
    // row into `library_root` under the SAME id before inserting
    // `file_record` rows; mirror that here so the FK constraint holds.
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
         VALUES (?, ?, ?, 'local', 'active', '2026-01-01T00:00:00Z')",
    )
    .bind(&resp.source_id)
    .bind(&resp.source_id)
    .bind(&resp.path)
    .execute(&pool)
    .await
    .unwrap();

    // 6 file_record rows -- no LIMIT means all of them must come back
    // (issue #560 failure mode 2: a bounded 5-path sample missed items).
    for (i, relative_path) in [
        "M31/light_003.fits",
        "M31/light_001.fits",
        "M31/light_002.fits",
        "M31/light_004.fits",
        "M31/light_005.fits",
        "M31/light_006.fits",
    ]
    .iter()
    .enumerate()
    {
        sqlx::query(
            "INSERT INTO file_record \
             (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
             VALUES (?, ?, ?, 0, '2026-01-01T00:00:00Z', 'observed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(format!("fr-{i}"))
        .bind(&resp.source_id)
        .bind(relative_path)
        .execute(&pool)
        .await
        .unwrap();
    }

    let paths = relative_paths_for_root(&pool, &resp.source_id).await.unwrap();
    assert_eq!(
        paths,
        vec![
            "M31/light_001.fits",
            "M31/light_002.fits",
            "M31/light_003.fits",
            "M31/light_004.fits",
            "M31/light_005.fits",
            "M31/light_006.fits",
        ]
    );
}

/// Issue #560 failure mode 1: a root only scanned into the Inbox (never
/// ingested through plan-apply) has zero `file_record` rows but real
/// `inbox_items` rows — the old `file_record`-only sample reported those
/// vacuously as "all verified". A `resolved` inbox item (already moved
/// out by a prior plan-apply) must NOT be included.
#[tokio::test]
async fn relative_paths_for_root_includes_pending_inbox_items_excludes_resolved() {
    use persistence_inbox::repositories::inbox::{insert_inbox_item, InsertInboxItem};

    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/astro/inbox".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        },
    )
    .await
    .unwrap();

    insert_inbox_item(
        &pool,
        &InsertInboxItem {
            id: "item-pending",
            root_id: &resp.source_id,
            relative_path: "2026-01-01/lights",
            file_count: 3,
            content_signature: None,
            lane: "fits",
        },
    )
    .await
    .unwrap();
    insert_inbox_item(
        &pool,
        &InsertInboxItem {
            id: "item-resolved",
            root_id: &resp.source_id,
            relative_path: "2026-01-02/lights",
            file_count: 2,
            content_signature: None,
            lane: "fits",
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE inbox_items SET state = 'resolved' WHERE id = 'item-resolved'")
        .execute(&pool)
        .await
        .unwrap();

    let paths = relative_paths_for_root(&pool, &resp.source_id).await.unwrap();
    assert_eq!(paths, vec!["2026-01-01/lights"]);
}

// ── P6b: active flag repository functions ────────────────────────────────

#[tokio::test]
async fn new_sources_default_active() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    let flags = list_active_flags(&pool).await.unwrap();
    assert_eq!(flags.get(&resp.source_id), Some(&true));
}

#[tokio::test]
async fn set_source_active_round_trips() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    set_source_active(&pool, &resp.source_id, false).await.unwrap();
    let flags = list_active_flags(&pool).await.unwrap();
    assert_eq!(flags.get(&resp.source_id), Some(&false));

    set_source_active(&pool, &resp.source_id, true).await.unwrap();
    let flags = list_active_flags(&pool).await.unwrap();
    assert_eq!(flags.get(&resp.source_id), Some(&true));
}

#[tokio::test]
async fn set_source_active_missing_returns_not_found() {
    let pool = setup_db().await;
    let result = set_source_active(&pool, "nonexistent-id", false).await;
    assert!(matches!(result, Err(DbError::NotFound(_))));
}

// ── P6b: root dependents repository function ─────────────────────────────

#[tokio::test]
async fn count_root_dependents_all_zero_for_fresh_source() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::Project,
            path: "/astro/projects".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    let counts = count_root_dependents(&pool, &resp.source_id).await.unwrap();
    assert!(counts.is_empty(), "fresh source should have zero dependents: {counts:?}");
    assert_eq!(counts.total(), 0);
}

#[tokio::test]
async fn count_root_dependents_counts_inbox_items() {
    use persistence_inbox::repositories::inbox::{insert_inbox_item, InsertInboxItem};

    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/astro/inbox".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        },
    )
    .await
    .unwrap();

    insert_inbox_item(
        &pool,
        &InsertInboxItem {
            id: "item-1",
            root_id: &resp.source_id,
            relative_path: "2026-01-01/lights",
            file_count: 5,
            content_signature: None,
            lane: "fits",
        },
    )
    .await
    .unwrap();

    let counts = count_root_dependents(&pool, &resp.source_id).await.unwrap();
    assert_eq!(counts.inbox_items, 1);
    assert_eq!(counts.total(), 1);
    assert!(!counts.is_empty());
}

#[tokio::test]
async fn count_root_dependents_counts_sessions_and_file_records() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::LightFrames,
            path: "/astro/raw".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Organized,
        },
    )
    .await
    .unwrap();

    // `file_record.root_id`/`acquisition_session.root_id` FK the legacy
    // `library_root` table (mirrored under the SAME id — see
    // `relative_paths_for_root_is_exhaustive_and_ordered` above).
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
         VALUES (?, ?, ?, 'local', 'active', '2026-01-01T00:00:00Z')",
    )
    .bind(&resp.source_id)
    .bind(&resp.source_id)
    .bind(&resp.path)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO file_record \
         (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
         VALUES ('fr-1', ?, 'M31/light_001.fits', 0, '2026-01-01T00:00:00Z', 'observed', \
         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(&resp.source_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO acquisition_session (id, session_key, root_id, created_at) \
         VALUES ('acq-1', 'sess-key-1', ?, '2026-01-01T00:00:00Z')",
    )
    .bind(&resp.source_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO calibration_session (id, session_key, kind, root_id, created_at) \
         VALUES ('cal-1', 'cal-key-1', 'dark', ?, '2026-01-01T00:00:00Z')",
    )
    .bind(&resp.source_id)
    .execute(&pool)
    .await
    .unwrap();

    let counts = count_root_dependents(&pool, &resp.source_id).await.unwrap();
    assert_eq!(counts.file_records, 1);
    assert_eq!(counts.acquisition_sessions, 1);
    assert_eq!(counts.calibration_sessions, 1);
    assert_eq!(counts.plan_items, 0);
    assert_eq!(counts.total(), 3);
}

#[tokio::test]
async fn count_root_dependents_counts_plan_items() {
    let pool = setup_db().await;
    let resp = register_source(
        &pool,
        &RegisterSourceRequest {
            kind: SourceKind::Inbox,
            path: "/astro/inbox".to_owned(),
            kind_subtype: None,
            scan_depth: ScanDepth::Recursive,
            organization_state: OrganizationState::Unorganized,
        },
    )
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO plans (id, number, title, origin, state, plan_type, created_at) \
         VALUES ('plan-1', 1, 'Test plan', 'inbox', 'draft', 'restructure', '2026-01-01T00:00:00Z')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO plan_items \
         (id, plan_id, item_index, name, action, created_at, source_id) \
         VALUES ('pi-1', 'plan-1', 0, 'item', 'move', '2026-01-01T00:00:00Z', ?)",
    )
    .bind(&resp.source_id)
    .execute(&pool)
    .await
    .unwrap();

    let counts = count_root_dependents(&pool, &resp.source_id).await.unwrap();
    assert_eq!(counts.plan_items, 1);
    assert_eq!(counts.total(), 1);
}
