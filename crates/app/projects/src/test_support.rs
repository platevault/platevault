//! Shared test fixtures for project-path anchoring (Constitution I).
//!
//! Cross-platform note: a leading-slash path like `/library/...` is absolute
//! on Unix but NOT on Windows (`Path::is_absolute` requires a drive or UNC
//! prefix there), so it would fall into the relative-anchoring branch of
//! `project_setup::create` and be rejected. Tests therefore either submit
//! paths relative to the registered [`TEST_PROJECT_ROOT`], or build
//! platform-absolute paths with [`abs`].

use domain_core::ids::new_id;
use sqlx::SqlitePool;

/// Platform-absolute path of the project folder registered by test setups.
#[cfg(windows)]
pub(crate) const TEST_PROJECT_ROOT: &str = "C:/library/projects-root";
#[cfg(not(windows))]
pub(crate) const TEST_PROJECT_ROOT: &str = "/library/projects-root";

/// Make a Unix-style test path absolute on the current platform.
pub(crate) fn abs(path: &str) -> String {
    if cfg!(windows) {
        format!("C:{path}")
    } else {
        path.to_owned()
    }
}

/// Register a project-kind source so relative request paths have an anchor
/// (mirrors the first-run wizard registering a project folder).
pub(crate) async fn register_project_root(pool: &SqlitePool, path: &str) {
    sqlx::query(
        "INSERT INTO registered_sources \
         (id, kind, path, scan_depth, created_at, created_via, organization_state) \
         VALUES (?, 'project', ?, 'recursive', '2026-01-01T00:00:00Z', 'first_run', 'organized')",
    )
    .bind(new_id())
    .bind(path)
    .execute(pool)
    .await
    .unwrap();
}
