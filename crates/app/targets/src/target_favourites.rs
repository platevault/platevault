//! `targets.favourites.list` / `targets.favourites.add` / `targets.favourites.remove`
//! use cases (spec 051 US2).
//!
//! Thin orchestration over the `target_favourite` repository functions
//! (`persistence_db::repositories::target_favourites`): validates the target
//! exists (for `add`) and maps repository results to contract DTOs.
//!
//! ## Constitution
//!
//! - §I No filesystem mutations: read/write SQLite metadata only.
//! - §V SQLite (`target_favourite`) is the durable record.

use sqlx::SqlitePool;

use contracts_core::targets::{
    TargetFavouriteAddResult, TargetFavouriteRemoveResult, TargetFavouriteRequest,
    TargetFavouritesListResult, TargetOpError,
};
use domain_core::ids::Timestamp;
use persistence_db::repositories::target_favourites;

fn db_err(e: impl std::fmt::Display) -> TargetOpError {
    TargetOpError { code: "internal.database".to_owned(), message: format!("{e}"), details: None }
}

fn not_found(id: &str) -> TargetOpError {
    TargetOpError {
        code: "target.not_found".to_owned(),
        message: format!("Target '{id}' not found."),
        details: None,
    }
}

/// `targets.favourites.list` — return the ids of every currently-favourited
/// canonical target.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `internal.database`.
pub async fn list(pool: &SqlitePool) -> Result<TargetFavouritesListResult, TargetOpError> {
    let target_ids = target_favourites::list_favourites(pool).await.map_err(db_err)?;
    Ok(TargetFavouritesListResult { target_ids })
}

/// `targets.favourites.add` — favourite a canonical target. Idempotent: adding
/// an already-favourited target succeeds with no error and does not reset
/// `favouritedAt`.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `target.not_found` (the id does not
/// reference an existing `canonical_target` row) or `internal.database`.
pub async fn add(
    pool: &SqlitePool,
    req: &TargetFavouriteRequest,
) -> Result<TargetFavouriteAddResult, TargetOpError> {
    let exists = target_favourites::target_exists(pool, &req.target_id).await.map_err(db_err)?;
    if !exists {
        return Err(not_found(&req.target_id));
    }

    let favourited_at = Timestamp::now_iso();
    target_favourites::add_favourite(pool, &req.target_id, &favourited_at).await.map_err(db_err)?;

    // Re-read the stored favourited_at: a repeat add is a no-op and must
    // reflect the *original* timestamp, not the one just computed above.
    let stored_at = target_favourites::get_favourited_at(pool, &req.target_id)
        .await
        .map_err(db_err)?
        .unwrap_or(favourited_at);

    Ok(TargetFavouriteAddResult { target_id: req.target_id.clone(), favourited_at: stored_at })
}

/// `targets.favourites.remove` — unfavourite a canonical target. Idempotent:
/// removing a target that was never favourited succeeds with no error.
///
/// # Errors
///
/// Returns [`TargetOpError`] with code `internal.database`.
pub async fn remove(
    pool: &SqlitePool,
    req: &TargetFavouriteRequest,
) -> Result<TargetFavouriteRemoveResult, TargetOpError> {
    target_favourites::remove_favourite(pool, &req.target_id).await.map_err(db_err)?;
    Ok(TargetFavouriteRemoveResult { target_id: req.target_id.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;

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
    async fn list_is_empty_when_nothing_favourited() {
        let db = setup().await;
        let result = list(db.pool()).await.unwrap();
        assert!(result.target_ids.is_empty());
    }

    #[tokio::test]
    async fn add_then_list_includes_target() {
        let db = setup().await;
        insert_target(db.pool(), "t-001").await;

        let added = add(db.pool(), &TargetFavouriteRequest { target_id: "t-001".to_owned() })
            .await
            .unwrap();
        assert_eq!(added.target_id, "t-001");
        assert!(!added.favourited_at.is_empty());

        let listed = list(db.pool()).await.unwrap();
        assert_eq!(listed.target_ids, vec!["t-001".to_owned()]);
    }

    #[tokio::test]
    async fn add_unknown_target_returns_not_found() {
        let db = setup().await;
        let err = add(db.pool(), &TargetFavouriteRequest { target_id: "missing".to_owned() })
            .await
            .unwrap_err();
        assert_eq!(err.code, "target.not_found");
    }

    #[tokio::test]
    async fn add_twice_is_idempotent_and_preserves_original_timestamp() {
        let db = setup().await;
        insert_target(db.pool(), "t-002").await;

        let first = add(db.pool(), &TargetFavouriteRequest { target_id: "t-002".to_owned() })
            .await
            .unwrap();
        let second = add(db.pool(), &TargetFavouriteRequest { target_id: "t-002".to_owned() })
            .await
            .unwrap();

        assert_eq!(first.favourited_at, second.favourited_at);

        let listed = list(db.pool()).await.unwrap();
        assert_eq!(listed.target_ids.len(), 1);
    }

    #[tokio::test]
    async fn remove_deletes_and_list_no_longer_includes_it() {
        let db = setup().await;
        insert_target(db.pool(), "t-003").await;
        add(db.pool(), &TargetFavouriteRequest { target_id: "t-003".to_owned() }).await.unwrap();

        let removed = remove(db.pool(), &TargetFavouriteRequest { target_id: "t-003".to_owned() })
            .await
            .unwrap();
        assert_eq!(removed.target_id, "t-003");

        let listed = list(db.pool()).await.unwrap();
        assert!(listed.target_ids.is_empty());
    }

    #[tokio::test]
    async fn remove_of_never_favourited_id_is_a_noop() {
        let db = setup().await;
        insert_target(db.pool(), "t-004").await;
        let removed = remove(db.pool(), &TargetFavouriteRequest { target_id: "t-004".to_owned() })
            .await
            .unwrap();
        assert_eq!(removed.target_id, "t-004");
    }
}
