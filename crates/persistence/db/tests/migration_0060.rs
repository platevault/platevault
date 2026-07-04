//! Migration 0060 integration tests (project path root-anchor fix).
//!
//! Migrations run before any rows exist in these tests, so the data fix is
//! exercised by seeding legacy-shaped rows and re-running the migration file's
//! SQL directly (the statement is idempotent for already-absolute rows).
//!
//! Asserts:
//!   - A legacy relative `projects.path` is anchored under the earliest
//!     project-kind registered source.
//!   - Absolute rows (POSIX, drive-letter, UNC/backslash) are untouched.
//!   - Relative rows are left alone when no project root is registered.
//!   - Re-running the fix does not double-anchor (absolute guard).

use persistence_db::Database;
use uuid::Uuid;

const MIGRATION_0060: &str = include_str!("../migrations/0060_project_path_anchor.sql");

async fn setup() -> Database {
    let db = Database::in_memory().await.expect("in-memory db");
    db.migrate().await.expect("migrations should apply cleanly");
    db
}

async fn seed_project_source(pool: &sqlx::SqlitePool, path: &str, created_at: &str) {
    sqlx::query(
        "INSERT INTO registered_sources \
         (id, kind, path, scan_depth, created_at, created_via, organization_state) \
         VALUES (?, 'project', ?, 'recursive', ?, 'first_run', 'organized')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(path)
    .bind(created_at)
    .execute(pool)
    .await
    .expect("seed registered_source");
}

async fn seed_project(pool: &sqlx::SqlitePool, id: &str, path: &str) {
    sqlx::query(
        "INSERT INTO projects (id, name, tool, lifecycle, path, created_at, updated_at) \
         VALUES (?, ?, 'PixInsight', 'setup_incomplete', ?, \
                 '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z')",
    )
    .bind(id)
    .bind(format!("Project {id}"))
    .bind(path)
    .execute(pool)
    .await
    .expect("seed project");
}

async fn project_path(pool: &sqlx::SqlitePool, id: &str) -> String {
    let (path,): (String,) = sqlx::query_as("SELECT path FROM projects WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("project row");
    path
}

async fn run_fix(pool: &sqlx::SqlitePool) {
    sqlx::query(MIGRATION_0060).execute(pool).await.expect("0060 SQL must apply");
}

#[tokio::test]
async fn relative_path_is_anchored_to_earliest_project_root() {
    let db = setup().await;
    let pool = db.pool();
    seed_project_source(pool, "/library/projects/", "2026-01-01T00:00:00Z").await;
    seed_project_source(pool, "/other/projects", "2026-02-01T00:00:00Z").await;
    seed_project(pool, "p-rel", "projects/m31").await;

    run_fix(pool).await;

    assert_eq!(
        project_path(pool, "p-rel").await,
        "/library/projects/projects/m31",
        "relative row must be anchored under the earliest project root (trailing '/' stripped)"
    );
}

#[tokio::test]
async fn absolute_paths_are_untouched() {
    let db = setup().await;
    let pool = db.pool();
    seed_project_source(pool, "/library/projects", "2026-01-01T00:00:00Z").await;
    seed_project(pool, "p-posix", "/data/astro/m31").await;
    seed_project(pool, "p-drive", "D:\\astro\\m31").await;
    seed_project(pool, "p-unc", "\\\\nas\\astro\\m31").await;

    run_fix(pool).await;

    assert_eq!(project_path(pool, "p-posix").await, "/data/astro/m31");
    assert_eq!(project_path(pool, "p-drive").await, "D:\\astro\\m31");
    assert_eq!(project_path(pool, "p-unc").await, "\\\\nas\\astro\\m31");
}

#[tokio::test]
async fn relative_path_without_project_root_is_left_alone() {
    let db = setup().await;
    let pool = db.pool();
    seed_project(pool, "p-orphan", "projects/m31").await;

    run_fix(pool).await;

    assert_eq!(project_path(pool, "p-orphan").await, "projects/m31");
}

#[tokio::test]
async fn rerunning_the_fix_does_not_double_anchor() {
    let db = setup().await;
    let pool = db.pool();
    seed_project_source(pool, "/library/projects", "2026-01-01T00:00:00Z").await;
    seed_project(pool, "p-once", "m31").await;

    run_fix(pool).await;
    run_fix(pool).await;

    assert_eq!(project_path(pool, "p-once").await, "/library/projects/m31");
}
