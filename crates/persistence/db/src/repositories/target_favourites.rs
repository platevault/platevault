//! Repository query functions for the spec-051 US2 `target_favourite` table
//! (migration 0061).
//!
//! One row per favourited canonical target; absence of a row means "not
//! favourited" (no boolean column). Replaces the `localStorage`-only stub in
//! `apps/desktop/src/features/targets/useFavourites.ts`.
//!
//! Constitution §I: read/write SQLite metadata only; no filesystem mutations.
//! Constitution §V: SQLite is the durable record.

use sqlx::SqlitePool;

use crate::DbResult;
use domain_core::ids::Timestamp;

/// List the ids of every currently-favourited target, newest-favourited first.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn list_favourites(pool: &SqlitePool) -> DbResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT target_id FROM target_favourite ORDER BY favourited_at DESC, target_id ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Mark `target_id` as favourited. Upsert-safe: a target that is already
/// favourited is left with its original `favourited_at` (no-op on repeat
/// calls), matching the "add twice -> single row" invariant (data-model.md
/// §E1).
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure (including a foreign-key
/// violation if `target_id` does not reference an existing
/// `canonical_target` row).
pub async fn add_favourite(pool: &SqlitePool, target_id: &str) -> DbResult<()> {
    let favourited_at = Timestamp::now_iso();
    sqlx::query(
        "INSERT INTO target_favourite (target_id, favourited_at) VALUES (?, ?)
         ON CONFLICT(target_id) DO NOTHING",
    )
    .bind(target_id)
    .bind(favourited_at.as_str())
    .execute(pool)
    .await?;
    Ok(())
}

/// Unmark `target_id` as favourited. No-op (not an error) if the target was
/// never favourited.
///
/// # Errors
///
/// Returns [`DbError::Database`] on query failure.
pub async fn remove_favourite(pool: &SqlitePool, target_id: &str) -> DbResult<()> {
    sqlx::query("DELETE FROM target_favourite WHERE target_id = ?")
        .bind(target_id)
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

    #[tokio::test]
    async fn add_then_list_returns_favourite() {
        let db = setup().await;
        insert_target(db.pool(), "t-001").await;

        add_favourite(db.pool(), "t-001").await.unwrap();
        let ids = list_favourites(db.pool()).await.unwrap();
        assert_eq!(ids, vec!["t-001".to_owned()]);
    }

    #[tokio::test]
    async fn add_twice_is_idempotent_single_row() {
        let db = setup().await;
        insert_target(db.pool(), "t-002").await;

        add_favourite(db.pool(), "t-002").await.unwrap();
        add_favourite(db.pool(), "t-002").await.unwrap();

        let ids = list_favourites(db.pool()).await.unwrap();
        assert_eq!(ids, vec!["t-002".to_owned()], "second add must not duplicate the row");
    }

    #[tokio::test]
    async fn remove_makes_favourite_absent() {
        let db = setup().await;
        insert_target(db.pool(), "t-003").await;

        add_favourite(db.pool(), "t-003").await.unwrap();
        remove_favourite(db.pool(), "t-003").await.unwrap();

        let ids = list_favourites(db.pool()).await.unwrap();
        assert!(ids.is_empty());
    }

    #[tokio::test]
    async fn remove_never_favourited_is_noop_no_error() {
        let db = setup().await;
        insert_target(db.pool(), "t-004").await;

        // Never favourited — removing must succeed silently.
        remove_favourite(db.pool(), "t-004").await.unwrap();
        let ids = list_favourites(db.pool()).await.unwrap();
        assert!(ids.is_empty());
    }

    #[tokio::test]
    async fn list_empty_when_no_favourites() {
        let db = setup().await;
        let ids = list_favourites(db.pool()).await.unwrap();
        assert!(ids.is_empty());
    }

    #[tokio::test]
    async fn cascade_delete_drops_favourite_row() {
        let db = setup().await;
        insert_target(db.pool(), "t-005").await;
        add_favourite(db.pool(), "t-005").await.unwrap();

        sqlx::query("DELETE FROM canonical_target WHERE id = ?")
            .bind("t-005")
            .execute(db.pool())
            .await
            .expect("delete canonical_target");

        let ids = list_favourites(db.pool()).await.unwrap();
        assert!(ids.is_empty(), "ON DELETE CASCADE should remove the favourite row");
    }
}
