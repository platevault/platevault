// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Repository query functions for `app_core_targets`' resolver-settings,
//! target-management, and target-resolve use cases (db-boundary-zero drain).
//!
//! Moved out of `crates/app/targets/src/{resolver_settings,target_management,
//! target_resolve}.rs` verbatim (same tables/columns/WHERE/ORDER, same
//! bindings) so those files hold zero raw sqlx sites; business logic, error
//! mapping, and transaction-free multi-step orchestration stay in the app
//! layer.
//!
//! Tables: `resolver_settings` (singleton row, id = 1), `canonical_target`,
//! `target_alias`, `audit_log_entry`.
//!
//! Constitution §I: read/write SQLite metadata only; no filesystem mutations.
//! Constitution §V: SQLite is the durable record.

use sqlx::SqlitePool;

use crate::DbResult;

// ── Row types ─────────────────────────────────────────────────────────────────

/// Full `resolver_settings` row (`resolver_settings.rs::read_row`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ResolverSettingsRow {
    pub online_enabled: i64,
    pub simbad_endpoint: String,
    pub debounce_ms: i64,
    pub request_timeout_secs: i64,
}

/// `resolver_settings` row projected to only the columns `target_resolve.rs`'s
/// `read_settings` needs (no `debounce_ms`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ResolverSettingsOnlineRow {
    pub online_enabled: i64,
    pub simbad_endpoint: String,
    pub request_timeout_secs: i64,
}

/// Flat row returned by [`list_target_aliases`].
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TargetAliasRow {
    pub id: String,
    pub alias: String,
    pub kind: String,
}

// ── resolver_settings ────────────────────────────────────────────────────────

/// Read the singleton `resolver_settings` row (id = 1), all four columns.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_resolver_settings(pool: &SqlitePool) -> DbResult<Option<ResolverSettingsRow>> {
    let row = sqlx::query_as::<_, ResolverSettingsRow>(
        "SELECT online_enabled, simbad_endpoint, debounce_ms, request_timeout_secs
         FROM resolver_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Read the singleton `resolver_settings` row (id = 1), the three columns the
/// live resolve path needs (`online_enabled`, `simbad_endpoint`,
/// `request_timeout_secs`).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_resolver_settings_online(
    pool: &SqlitePool,
) -> DbResult<Option<ResolverSettingsOnlineRow>> {
    let row = sqlx::query_as::<_, ResolverSettingsOnlineRow>(
        "SELECT online_enabled, simbad_endpoint, request_timeout_secs
         FROM resolver_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Upsert the singleton `resolver_settings` row (id = 1).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn upsert_resolver_settings(
    pool: &SqlitePool,
    online_enabled: i64,
    simbad_endpoint: &str,
    debounce_ms: i64,
    request_timeout_secs: i64,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO resolver_settings
            (id, online_enabled, simbad_endpoint, debounce_ms, request_timeout_secs)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            online_enabled       = excluded.online_enabled,
            simbad_endpoint      = excluded.simbad_endpoint,
            debounce_ms          = excluded.debounce_ms,
            request_timeout_secs = excluded.request_timeout_secs",
    )
    .bind(online_enabled)
    .bind(simbad_endpoint)
    .bind(debounce_ms)
    .bind(request_timeout_secs)
    .execute(pool)
    .await?;
    Ok(())
}

// ── canonical_target / target_alias ─────────────────────────────────────────

/// Whether a `canonical_target` row exists for `target_id`.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn target_exists(pool: &SqlitePool, target_id: &str) -> DbResult<bool> {
    let row: Option<(String,)> = sqlx::query_as("SELECT id FROM canonical_target WHERE id = ?")
        .bind(target_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// List `target_alias` rows for `target_id`, ordered by `alias ASC`.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_target_aliases(
    pool: &SqlitePool,
    target_id: &str,
) -> DbResult<Vec<TargetAliasRow>> {
    let rows = sqlx::query_as::<_, TargetAliasRow>(
        "SELECT id, alias, kind
         FROM target_alias
         WHERE target_id = ?
         ORDER BY alias ASC",
    )
    .bind(target_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Read the `kind` of a `target_alias` row scoped to `target_id`.
///
/// Scoping by both `id` and `target_id` distinguishes "alias not found" from
/// "alias exists but belongs to a different target".
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn get_alias_kind(
    pool: &SqlitePool,
    alias_id: &str,
    target_id: &str,
) -> DbResult<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT kind FROM target_alias WHERE id = ? AND target_id = ?")
            .bind(alias_id)
            .bind(target_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(kind,)| kind))
}

// ── acquisition_session ──────────────────────────────────────────────────────

/// `(target_id, session_count)` pairs for every target with at least one
/// linked `acquisition_session` (#877, planner Sessions column). A session
/// links via the spec-035 `canonical_target_id` when set, else the legacy
/// `target_id` (mirrors `app_core::sessions::list_sessions`'s own fallback) —
/// never double-counted since at most one of the two is non-NULL per row.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn session_counts_by_target(pool: &SqlitePool) -> DbResult<Vec<(String, i64)>> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT COALESCE(canonical_target_id, target_id) AS tid, COUNT(*)
         FROM acquisition_session
         WHERE COALESCE(canonical_target_id, target_id) IS NOT NULL
         GROUP BY tid",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

// ── audit_log_entry ──────────────────────────────────────────────────────────

/// Insert a durable `audit_log_entry` row for a resolution outcome
/// (`target.resolved` / `target.user_override`), entity type
/// `canonical_target`.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
#[allow(clippy::too_many_arguments)] // mirrors the columns of a fixed audit-row shape
pub async fn insert_resolution_audit(
    pool: &SqlitePool,
    audit_id: &str,
    target_id: &str,
    trigger: &str,
    actor: &str,
    request_id: &str,
    at: &str,
    payload: &str,
) -> DbResult<()> {
    sqlx::query(
        "INSERT INTO audit_log_entry \
         (audit_id, entity_type, entity_id, from_state, to_state, trigger, actor, \
          outcome, severity, request_id, at, payload) \
         VALUES (?, 'canonical_target', ?, NULL, NULL, ?, ?, 'applied', 'workflow', ?, ?, ?)",
    )
    .bind(audit_id)
    .bind(target_id)
    .bind(trigger)
    .bind(actor)
    .bind(request_id)
    .bind(at)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    async fn insert_target(pool: &SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO canonical_target
             (id, simbad_oid, primary_designation, object_type, ra_deg, dec_deg, source, resolved_at)
             VALUES (?, NULL, 'Test Target', 'galaxy', 10.0, 20.0, 'seed', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .execute(pool)
        .await
        .expect("insert_target failed");
    }

    async fn insert_alias(pool: &SqlitePool, id: &str, target_id: &str, alias: &str, kind: &str) {
        sqlx::query(
            "INSERT INTO target_alias (id, target_id, alias, normalized, kind) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(target_id)
        .bind(alias)
        .bind(alias.to_lowercase())
        .bind(kind)
        .execute(pool)
        .await
        .expect("insert_alias failed");
    }

    // ── resolver_settings ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn resolver_settings_seeded_row_is_readable() {
        let db = setup().await;
        let row = get_resolver_settings(db.pool()).await.unwrap();
        assert!(row.is_some(), "migration 0031 seeds the singleton row");

        let online_row = get_resolver_settings_online(db.pool()).await.unwrap();
        assert!(online_row.is_some());
    }

    #[tokio::test]
    async fn resolver_settings_upsert_round_trips() {
        let db = setup().await;
        upsert_resolver_settings(db.pool(), 0, "https://example.test/tap", 500, 20).await.unwrap();

        let row = get_resolver_settings(db.pool()).await.unwrap().unwrap();
        assert_eq!(row.online_enabled, 0);
        assert_eq!(row.simbad_endpoint, "https://example.test/tap");
        assert_eq!(row.debounce_ms, 500);
        assert_eq!(row.request_timeout_secs, 20);
    }

    // ── canonical_target / target_alias ──────────────────────────────────────

    #[tokio::test]
    async fn target_exists_true_and_false() {
        let db = setup().await;
        insert_target(db.pool(), "t-001").await;
        assert!(target_exists(db.pool(), "t-001").await.unwrap());
        assert!(!target_exists(db.pool(), "t-missing").await.unwrap());
    }

    #[tokio::test]
    async fn list_target_aliases_orders_by_alias_asc() {
        let db = setup().await;
        insert_target(db.pool(), "t-001").await;
        insert_alias(db.pool(), "a-1", "t-001", "Zeta", "user").await;
        insert_alias(db.pool(), "a-2", "t-001", "Alpha", "user").await;

        let rows = list_target_aliases(db.pool(), "t-001").await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].alias, "Alpha");
        assert_eq!(rows[1].alias, "Zeta");
    }

    #[tokio::test]
    async fn get_alias_kind_scopes_by_target() {
        let db = setup().await;
        insert_target(db.pool(), "t-001").await;
        insert_target(db.pool(), "t-002").await;
        insert_alias(db.pool(), "a-1", "t-001", "Alpha", "user").await;

        assert_eq!(
            get_alias_kind(db.pool(), "a-1", "t-001").await.unwrap().as_deref(),
            Some("user")
        );
        assert!(get_alias_kind(db.pool(), "a-1", "t-002").await.unwrap().is_none());
        assert!(get_alias_kind(db.pool(), "a-missing", "t-001").await.unwrap().is_none());
    }

    // ── acquisition_session ───────────────────────────────────────────────────

    #[tokio::test]
    async fn session_counts_by_target_prefers_canonical_and_falls_back_to_legacy() {
        let db = setup().await;
        insert_target(db.pool(), "canon-1").await;
        sqlx::query(
            "INSERT INTO target (id, primary_designation, created_at)
             VALUES ('legacy-1', 'Legacy Target', '2026-01-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, canonical_target_id, created_at)
             VALUES ('s-1', 'K1', '[]', 'canon-1', '2026-01-01T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, canonical_target_id, created_at)
             VALUES ('s-2', 'K2', '[]', 'canon-1', '2026-01-02T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, target_id, created_at)
             VALUES ('s-3', 'K3', '[]', 'legacy-1', '2026-01-03T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO acquisition_session (id, session_key, frame_ids, created_at)
             VALUES ('s-unlinked', 'K4', '[]', '2026-01-04T00:00:00Z')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        let mut counts = session_counts_by_target(db.pool()).await.unwrap();
        counts.sort();
        assert_eq!(counts, vec![("canon-1".to_owned(), 2), ("legacy-1".to_owned(), 1)]);
    }

    // ── audit_log_entry ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn insert_resolution_audit_writes_row() {
        let db = setup().await;
        insert_target(db.pool(), "t-001").await;
        insert_resolution_audit(
            db.pool(),
            "audit-1",
            "t-001",
            "target.resolved",
            "system",
            "req-1",
            "2026-01-01T00:00:00Z",
            "{}",
        )
        .await
        .unwrap();

        let (n,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM audit_log_entry WHERE audit_id = 'audit-1'")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(n, 1);
    }
}
