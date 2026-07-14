#![allow(clippy::doc_markdown)]

// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Layer-1 real-backend integration tests for processing tool registration/listing
//! and processing artifact observation (spec 011/012, feature 037 T010/T011).
//!
//! CONSTITUTION III: no external processing tool is launched. Tool-launch wiring
//! is verified via `FakeSpawner` (records spawn calls without executing them) and
//! via the `tools_validate_path` / `list_profiles` entry points that exercise the
//! DB path without spawning anything. Artifact observation is tested by creating
//! real files in a `tempfile::tempdir()` and calling `artifact::detect`.

mod support;

use app_core::artifact;
use app_core::tool_launch;
use contracts_core::tools::UpdateProcessingTool;
use workflow_profiles::launch::FakeSpawner;

// ── helpers ───────────────────────────────────────────────────────────────────

/// Insert a minimal `library_root` row so the launch cwd-containment check can
/// succeed for a given root path.
async fn insert_library_root(pool: &sqlx::SqlitePool, path: &str) {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
         VALUES (?, 'Integration Test Root', ?, 'local', 'active', '2026-01-01T00:00:00Z')",
    )
    .bind(&id)
    .bind(path)
    .execute(pool)
    .await
    .expect("insert library_root");
}

/// Insert a minimal `projects` row (the table used by `project_setup::list` and
/// `tool_launch::launch`). Returns the project ID string.
async fn insert_projects_row(pool: &sqlx::SqlitePool, path: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) \
         VALUES (?, 'Integration Project', 'PixInsight', 'setup_incomplete', ?, NULL, 0, \
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(&id)
    .bind(path)
    .execute(pool)
    .await
    .expect("insert projects row");
    id
}

// ── Test 1: validate_path (pure, no DB) ──────────────────────────────────────

/// `validate_path` is a synchronous pure function that checks filesystem
/// accessibility. Tested here with a real tempdir path so integration results
/// differ from the unit tests in `tool_launch::tests` (which only test non-existent
/// paths). Using a real file confirms the happy-path branch returns `valid = true`.
#[tokio::test]
async fn validate_path_accepts_real_existing_absolute_path() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file_path = dir.path().join("fake_pixinsight");
    std::fs::write(&file_path, b"").expect("write fake binary");

    let path_str = file_path.to_str().expect("utf-8 path");
    let result = tool_launch::validate_path(path_str);

    assert!(result.valid, "expected valid=true for an existing absolute path; got {result:?}");
    assert!(result.reason.is_none(), "expected no reason when valid; got {:?}", result.reason);
    assert_eq!(result.path, path_str);
}

// ── Test 2: list_profiles reads seeded catalog and reflects DB settings ───────

/// `list_profiles` joins the hard-coded seed catalog with settings stored in the
/// real SQLite DB. On a fresh DB all tools should be returned but none configured.
/// After `update_tool` writes a path, `list_profiles` must reflect the change —
/// this tests the full read→write→read round-trip through real SQLite.
#[tokio::test]
async fn list_profiles_round_trips_through_real_db() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    // Fresh DB: all seeded profiles returned, none configured.
    let before = tool_launch::list_profiles(pool).await.expect("list_profiles");
    assert!(
        before.tools.len() >= 2,
        "expected at least 2 seeded tool profiles, got {}",
        before.tools.len()
    );
    for t in &before.tools {
        assert!(!t.configured, "tool {} should not be configured on a fresh DB", t.id);
        assert!(t.executable_path.is_none(), "tool {} should have no path set", t.id);
    }

    // Persist a path for the first tool via update_tool.
    let first_id = before.tools[0].id.clone();
    let dir = tempfile::tempdir().expect("tempdir");
    let fake_exe = dir.path().join("fake_tool");
    std::fs::write(&fake_exe, b"").expect("write fake exe");
    let fake_exe_str = fake_exe.to_str().expect("utf-8").to_owned();

    tool_launch::update_tool(
        pool,
        UpdateProcessingTool {
            id: first_id.clone(),
            path: Some(fake_exe_str.clone()),
            enabled: true,
            watch_extensions: None,
        },
    )
    .await
    .expect("update_tool");

    // After update: list_profiles must show the tool as configured.
    let after = tool_launch::list_profiles(pool).await.expect("list_profiles after update");
    let updated = after.tools.iter().find(|t| t.id == first_id).expect("tool in list");
    assert!(updated.configured, "tool should be configured after update_tool");
    assert_eq!(
        updated.executable_path.as_deref(),
        Some(fake_exe_str.as_str()),
        "executable_path should match what was written"
    );
    assert!(updated.enabled, "tool should be enabled");
}

// ── Test 3: update_tool persists enabled=false ────────────────────────────────

/// Disabling a tool via `update_tool` must be durable: a subsequent `list_profiles`
/// call on the same pool must return `enabled = false` for that tool.
#[tokio::test]
async fn update_tool_persists_disabled_state() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    // List to find a real seeded tool id.
    let profiles = tool_launch::list_profiles(pool).await.expect("list_profiles");
    let tool_id = profiles.tools[0].id.clone();

    // Disable it (no path change).
    let summary = tool_launch::update_tool(
        pool,
        UpdateProcessingTool {
            id: tool_id.clone(),
            path: None,
            enabled: false,
            watch_extensions: None,
        },
    )
    .await
    .expect("update_tool disable");

    assert!(!summary.enabled, "returned summary should report enabled=false");

    // Re-read via list_profiles to confirm DB persistence.
    let after = tool_launch::list_profiles(pool).await.expect("list_profiles after disable");
    let tool = after.tools.iter().find(|t| t.id == tool_id).expect("tool in list");
    assert!(!tool.enabled, "tool {tool_id} should remain disabled after round-trip through DB");
}

// ── Test 4: artifact::detect records a new file and list returns it ───────────

/// `artifact::detect` observes a path, classifies it, and persists a row to the
/// `processing_artifact` table. `artifact::list` must then return that row.
/// We create a real file in a tempdir so the path is concrete, but we NEVER
/// invoke a processing tool — the `detect` entry point accepts the path as a
/// caller-supplied string (the watcher/scanner provides it in production).
#[tokio::test]
async fn artifact_detect_records_new_file_and_list_returns_it() {
    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    let dir = tempfile::tempdir().expect("tempdir");
    let output_file = dir.path().join("MasterDark_bin1x1_30s.xisf");
    std::fs::write(&output_file, b"fake xisf content").expect("write output file");
    let path_str = output_file.to_str().expect("utf-8 path").to_owned();

    let project_id = "proj-tools-artifacts-037";
    let detected_at = "2026-06-19T10:00:00Z";
    let file_mtime = "2026-06-19T09:58:00Z";

    let artifact_id = artifact::detect(
        pool,
        &bus,
        project_id,
        &path_str,
        "pixinsight",
        4096,
        file_mtime,
        detected_at,
    )
    .await
    .expect("artifact::detect should succeed");

    assert!(!artifact_id.is_empty(), "returned artifact_id must be non-empty");

    // list must return exactly the one artifact we just observed.
    let artifacts = artifact::list(pool, project_id, &[]).await.expect("artifact::list");
    assert_eq!(artifacts.len(), 1, "expected 1 artifact, got {}", artifacts.len());

    let art = &artifacts[0];
    assert_eq!(art.id, artifact_id, "listed artifact id must match detected id");
    assert_eq!(art.project_id, project_id);
    assert_eq!(art.path, path_str, "artifact path must match observed file path");
    assert_eq!(art.tool, "pixinsight");
    assert_eq!(art.state, "present", "newly detected artifact must be in 'present' state");
    // A MasterDark filename should be classified as 'master' by the rule engine.
    assert_eq!(
        art.kind, "master",
        "MasterDark_*.xisf should classify as 'master'; got '{}'",
        art.kind
    );
}

// ── Test 5: launch wiring — FakeSpawner records call, DB row persisted ────────

/// Verifies the full tool-launch wiring path using `FakeSpawner` (no real process).
/// Asserts that the `tool_launches` row is persisted and the response carries the
/// expected launch_id and status. CONSTITUTION III: `FakeSpawner::ok()` captures
/// the spawn request without executing it.
#[tokio::test]
async fn launch_wiring_with_fake_spawner_persists_row() {
    use app_core::tool_launch::{launch, update_tool};
    use contracts_core::tools::ToolLaunchRequest;
    use contracts_core::tools::ToolLaunchStatus;

    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    // Create a real tempdir as both the library root and the project path.
    let dir = tempfile::tempdir().expect("tempdir");
    let root_path = dir.path().to_str().expect("utf-8").to_owned();
    let project_path = root_path.clone();

    // Insert library root so cwd-containment check passes.
    insert_library_root(pool, &root_path).await;

    // Insert project row with path inside the library root.
    let project_id = insert_projects_row(pool, &project_path).await;

    // Create a fake executable inside the tempdir.
    let fake_exe = dir.path().join("pixinsight");
    std::fs::write(&fake_exe, b"").expect("write fake exe");
    let fake_exe_str = fake_exe.to_str().expect("utf-8").to_owned();

    // Register the executable path in settings.
    update_tool(
        pool,
        UpdateProcessingTool {
            id: "pixinsight".to_owned(),
            path: Some(fake_exe_str.clone()),
            enabled: true,
            watch_extensions: None,
        },
    )
    .await
    .expect("update_tool");

    // Launch with FakeSpawner — does NOT exec the binary.
    let spawner = FakeSpawner::ok();
    let req = ToolLaunchRequest {
        project_id: project_id.clone(),
        tool_id: "pixinsight".to_owned(),
        force: false,
    };
    let resp = launch(pool, &bus, &spawner, req).await.expect("launch");

    assert_eq!(resp.status, ToolLaunchStatus::Success, "expected Success; got {resp:?}");
    assert!(resp.launch_id.is_some(), "launch_id must be set on success");
    assert!(!resp.prior_instance_alive, "prior_instance_alive must be false on first launch");

    // FakeSpawner must have recorded exactly one spawn call.
    let calls = spawner.drain();
    assert_eq!(calls.len(), 1, "FakeSpawner should record exactly 1 spawn call");
    assert_eq!(calls[0].executable, fake_exe_str, "spawned executable must match configured path");

    // The tool_launches row must be persisted.
    let launch_id = resp.launch_id.unwrap();
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM tool_launches WHERE id = ? AND outcome = 'spawned'")
            .bind(&launch_id)
            .fetch_one(pool)
            .await
            .expect("query tool_launches");

    assert_eq!(count, 1, "expected 1 tool_launches row with outcome='spawned', found {count}");
}

/// Like `insert_projects_row`, but with a caller-supplied `name` so a single
/// test can register more than one project (the `projects` table has a
/// `UNIQUE(name)` constraint that the shared helper's hardcoded name would
/// otherwise violate).
async fn insert_named_project_row(pool: &sqlx::SqlitePool, name: &str, path: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO projects \
         (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) \
         VALUES (?, ?, 'PixInsight', 'setup_incomplete', ?, NULL, 0, \
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    )
    .bind(&id)
    .bind(name)
    .bind(path)
    .execute(pool)
    .await
    .expect("insert named projects row");
    id
}

// ── WP-012-A: path → project attribution (watcher mis-attribution fix) ───────
//
// The retired global artifact watcher (spec 033 T028, replaced by #400's
// per-project watchers) watched entire registered library roots, not a
// single project's output folder, and stored the watched ROOT's id as
// `project_id` verbatim — a placeholder that never matched a real
// project, so watcher-detected artifacts never surfaced in `artifact.list` /
// the Tool Launches accordion. These tests exercise the real DB-backed
// resolver (`artifact::resolve_project_id_for_path`) and the one-time
// re-attribution fix-up (`artifact::reattribute_root_keyed_artifacts`) for
// pre-existing mis-keyed rows.

/// A root can contain multiple projects; the resolver must pick the project
/// that actually owns the path (longest-prefix match), not just any project
/// under the same root.
#[tokio::test]
async fn resolve_project_id_for_path_picks_the_owning_project_under_a_shared_root() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let root_dir = tempfile::tempdir().expect("tempdir");
    let root_path = root_dir.path().to_str().expect("utf-8").to_owned();
    insert_library_root(pool, &root_path).await;

    let m31_dir = root_dir.path().join("projects").join("M31");
    let ngc7000_dir = root_dir.path().join("projects").join("NGC7000");
    std::fs::create_dir_all(&m31_dir).expect("mkdir project M31");
    std::fs::create_dir_all(&ngc7000_dir).expect("mkdir project NGC7000");

    let m31_project_id =
        insert_named_project_row(pool, "M31 Project", m31_dir.to_str().expect("utf-8")).await;
    let ngc7000_project_id =
        insert_named_project_row(pool, "NGC7000 Project", ngc7000_dir.to_str().expect("utf-8"))
            .await;

    let artifact_path = ngc7000_dir.join("MasterFlat_bin1x1.xisf");
    std::fs::write(&artifact_path, b"fake").expect("write artifact file");

    let resolved =
        artifact::resolve_project_id_for_path(pool, artifact_path.to_str().expect("utf-8"))
            .await
            .expect("resolve_project_id_for_path");

    assert_eq!(
        resolved,
        Some(ngc7000_project_id),
        "must resolve to the project actually owning the path, not {m31_project_id}"
    );
}

/// A path that falls under a registered root but outside every registered
/// project's folder must resolve to `None` — the resolver must never
/// fabricate an attribution.
#[tokio::test]
async fn resolve_project_id_for_path_returns_none_when_no_project_claims_it() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let root_dir = tempfile::tempdir().expect("tempdir");
    let root_path = root_dir.path().to_str().expect("utf-8").to_owned();
    insert_library_root(pool, &root_path).await;

    let project_dir = root_dir.path().join("projects").join("M31");
    std::fs::create_dir_all(&project_dir).expect("mkdir project");
    insert_projects_row(pool, project_dir.to_str().expect("utf-8")).await;

    // A file living directly under the root, outside any project folder
    // (e.g. still-unsorted inbox content).
    let unsorted_dir = root_dir.path().join("unsorted");
    std::fs::create_dir_all(&unsorted_dir).expect("mkdir unsorted");
    let stray_path = unsorted_dir.join("random.fits");
    std::fs::write(&stray_path, b"fake").expect("write stray file");

    let resolved = artifact::resolve_project_id_for_path(pool, stray_path.to_str().expect("utf-8"))
        .await
        .expect("resolve_project_id_for_path");

    assert!(resolved.is_none(), "path outside every project must not resolve to any project");
}

/// End-to-end regression guard for the original bug: simulating the fixed
/// watcher flow (resolve, then detect) must persist the artifact under the
/// real project id — never under the root's id.
#[tokio::test]
async fn watcher_flow_attributes_artifact_to_real_project_not_root_id() {
    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    let root_dir = tempfile::tempdir().expect("tempdir");
    let root_path = root_dir.path().to_str().expect("utf-8").to_owned();
    insert_library_root(pool, &root_path).await;
    let root_id: String = sqlx::query_scalar("SELECT id FROM library_root WHERE current_path = ?")
        .bind(&root_path)
        .fetch_one(pool)
        .await
        .expect("read back root id");

    let project_dir = root_dir.path().join("projects").join("M31");
    std::fs::create_dir_all(&project_dir).expect("mkdir project");
    let project_id = insert_projects_row(pool, project_dir.to_str().expect("utf-8")).await;

    let artifact_path = project_dir.join("MasterDark_bin1x1.xisf");
    std::fs::write(&artifact_path, b"fake").expect("write artifact file");
    let path_str = artifact_path.to_str().expect("utf-8").to_owned();

    // Mirror the watcher's fixed flow: resolve first, then call detect with
    // the resolved id (never the root id).
    let resolved_project_id = artifact::resolve_project_id_for_path(pool, &path_str)
        .await
        .expect("resolve_project_id_for_path")
        .expect("a project should own this path");
    assert_eq!(resolved_project_id, project_id);
    assert_ne!(resolved_project_id, root_id, "must never attribute to the root's id");

    artifact::detect(
        pool,
        &bus,
        &resolved_project_id,
        &path_str,
        "pixinsight",
        4096,
        "2026-07-03T09:58:00Z",
        "2026-07-03T10:00:00Z",
    )
    .await
    .expect("artifact::detect");

    let artifacts = artifact::list(pool, &project_id, &[]).await.expect("artifact::list");
    assert_eq!(artifacts.len(), 1);
    assert_eq!(artifacts[0].project_id, project_id);

    // Querying by the (wrong) root id must return nothing — proving the
    // artifact is NOT hidden under the root id anymore.
    let under_root = artifact::list(pool, &root_id, &[]).await.expect("artifact::list");
    assert!(under_root.is_empty(), "artifact must not be attributed to the root id");
}

/// One-time re-attribution fix-up: a legacy row keyed by the ROOT's id (the
/// pre-fix bug) must be corrected to the real project id, and a second pass
/// must be a no-op (idempotent).
#[tokio::test]
async fn reattribute_root_keyed_artifacts_fixes_legacy_rows_idempotently() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let root_dir = tempfile::tempdir().expect("tempdir");
    let root_path = root_dir.path().to_str().expect("utf-8").to_owned();
    insert_library_root(pool, &root_path).await;
    let root_id: String = sqlx::query_scalar("SELECT id FROM library_root WHERE current_path = ?")
        .bind(&root_path)
        .fetch_one(pool)
        .await
        .expect("read back root id");

    let project_dir = root_dir.path().join("projects").join("M31");
    std::fs::create_dir_all(&project_dir).expect("mkdir project");
    let project_id = insert_projects_row(pool, project_dir.to_str().expect("utf-8")).await;

    let artifact_path = project_dir.join("MasterDark_bin1x1.xisf");
    std::fs::write(&artifact_path, b"fake").expect("write artifact file");
    let path_str = artifact_path.to_str().expect("utf-8").to_owned();

    // Simulate a legacy row created by the pre-fix watcher: project_id is
    // actually the root's id.
    let artifact_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO processing_artifacts \
         (id, project_id, tool_launch_id, path, kind, tool, detected_at, last_seen_at, state, \
          classification_confidence, classification_source, size_bytes, file_mtime, content_hash) \
         VALUES (?, ?, NULL, ?, 'intermediate', 'pixinsight', '2026-07-01T00:00:00Z', \
                 '2026-07-01T00:00:00Z', 'present', 0.1, 'fallback', 4096, \
                 '2026-07-01T00:00:00Z', NULL)",
    )
    .bind(&artifact_id)
    .bind(&root_id)
    .bind(&path_str)
    .execute(pool)
    .await
    .expect("insert legacy mis-keyed artifact row");

    // First pass: must correct the row.
    let (fixed, unmatched) = artifact::reattribute_root_keyed_artifacts(pool)
        .await
        .expect("reattribute_root_keyed_artifacts");
    assert_eq!(fixed, 1, "expected exactly one legacy row to be corrected");
    assert_eq!(unmatched, 0);

    let (stored_project_id,): (String,) =
        sqlx::query_as("SELECT project_id FROM processing_artifacts WHERE id = ?")
            .bind(&artifact_id)
            .fetch_one(pool)
            .await
            .expect("read back artifact row");
    assert_eq!(stored_project_id, project_id, "row must now be keyed to the real project");

    // Second pass: idempotent no-op — the row is no longer root-keyed.
    let (fixed_again, unmatched_again) = artifact::reattribute_root_keyed_artifacts(pool)
        .await
        .expect("reattribute_root_keyed_artifacts (second pass)");
    assert_eq!(fixed_again, 0, "second pass must not re-touch an already-corrected row");
    assert_eq!(unmatched_again, 0);
}

/// A legacy root-keyed row whose path no longer matches any registered
/// project must be left as-is (not deleted) and reported as unmatched.
#[tokio::test]
async fn reattribute_root_keyed_artifacts_leaves_unmatched_rows_in_place() {
    let (db, _repo, _bus) = support::setup().await;
    let pool = db.pool();

    let root_dir = tempfile::tempdir().expect("tempdir");
    let root_path = root_dir.path().to_str().expect("utf-8").to_owned();
    insert_library_root(pool, &root_path).await;
    let root_id: String = sqlx::query_scalar("SELECT id FROM library_root WHERE current_path = ?")
        .bind(&root_path)
        .fetch_one(pool)
        .await
        .expect("read back root id");

    // No project registered at all — the stray path can never resolve.
    let stray_dir = root_dir.path().join("unsorted");
    std::fs::create_dir_all(&stray_dir).expect("mkdir unsorted");
    let stray_path = stray_dir.join("random.fits");
    std::fs::write(&stray_path, b"fake").expect("write stray file");
    let stray_path_str = stray_path.to_str().expect("utf-8").to_owned();

    let artifact_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO processing_artifacts \
         (id, project_id, tool_launch_id, path, kind, tool, detected_at, last_seen_at, state, \
          classification_confidence, classification_source, size_bytes, file_mtime, content_hash) \
         VALUES (?, ?, NULL, ?, 'intermediate', 'pixinsight', '2026-07-01T00:00:00Z', \
                 '2026-07-01T00:00:00Z', 'present', 0.1, 'fallback', 4096, \
                 '2026-07-01T00:00:00Z', NULL)",
    )
    .bind(&artifact_id)
    .bind(&root_id)
    .bind(&stray_path_str)
    .execute(pool)
    .await
    .expect("insert legacy mis-keyed artifact row");

    let (fixed, unmatched) = artifact::reattribute_root_keyed_artifacts(pool)
        .await
        .expect("reattribute_root_keyed_artifacts");
    assert_eq!(fixed, 0);
    assert_eq!(unmatched, 1, "unresolvable row must be flagged, not silently dropped");

    // The row must still exist, untouched (still root-keyed) — not deleted.
    let (stored_project_id,): (String,) =
        sqlx::query_as("SELECT project_id FROM processing_artifacts WHERE id = ?")
            .bind(&artifact_id)
            .fetch_one(pool)
            .await
            .expect("row must still exist");
    assert_eq!(stored_project_id, root_id, "unmatched row must be left as-is, not deleted");
}
