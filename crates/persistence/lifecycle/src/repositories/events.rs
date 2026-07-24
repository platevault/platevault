// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Durable event-bus table repository (migration `0003_events.sql`).
//!
//! Backs `audit::bus::EventBus` (publish/replay) and, in future, the log
//! panel readers (`log_stream::recent_entries` / `export_entries`,
//! `commands::log`) — hence the retention-gap and time-range read shapes
//! below, not just the two `EventBus::replay` variants.

use sqlx::SqlitePool;

use persistence_core::DbResult;

/// One row from `events`, as read back (no `source` column — no reader needs
/// it today; writers pass `source` explicitly to `insert_event`).
#[derive(Clone, Debug, sqlx::FromRow)]
pub struct EventRow {
    pub event_id: i64,
    pub topic: String,
    pub emitted_at: String,
    pub payload: String,
}

/// Append a durable event row. Returns the assigned `event_id`.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn insert_event(
    pool: &SqlitePool,
    topic: &str,
    source: &str,
    emitted_at: &str,
    payload: &str,
) -> DbResult<i64> {
    let result =
        sqlx::query("INSERT INTO events (topic, source, emitted_at, payload) VALUES (?, ?, ?, ?)")
            .bind(topic)
            .bind(source)
            .bind(emitted_at)
            .bind(payload)
            .execute(pool)
            .await?;
    Ok(result.last_insert_rowid())
}

/// List all events with `event_id > since_id`, oldest first.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_since(pool: &SqlitePool, since_id: i64) -> DbResult<Vec<EventRow>> {
    let rows = sqlx::query_as::<_, EventRow>(
        "SELECT event_id, topic, emitted_at, payload \
         FROM events WHERE event_id > ? ORDER BY event_id ASC",
    )
    .bind(since_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// List events on a single topic with `event_id > since_id`, oldest first.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_since_by_topic(
    pool: &SqlitePool,
    since_id: i64,
    topic: &str,
) -> DbResult<Vec<EventRow>> {
    let rows = sqlx::query_as::<_, EventRow>(
        "SELECT event_id, topic, emitted_at, payload \
         FROM events WHERE event_id > ? AND topic = ? ORDER BY event_id ASC",
    )
    .bind(since_id)
    .bind(topic)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Most-recent `limit` events with `event_id > since_id`, newest first
/// (caller reverses for oldest-first display — mirrors the former
/// `log_stream::recent_entries` query shape).
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_recent_since(
    pool: &SqlitePool,
    since_id: i64,
    limit: i64,
) -> DbResult<Vec<EventRow>> {
    let rows = sqlx::query_as::<_, EventRow>(
        "SELECT event_id, topic, emitted_at, payload \
         FROM events WHERE event_id > ? ORDER BY event_id DESC LIMIT ?",
    )
    .bind(since_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// List events whose `emitted_at` falls in `[since, until)` (either bound
/// optional), oldest first — mirrors the former `log_stream::export_entries`
/// query shape.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn list_by_emitted_at_range(
    pool: &SqlitePool,
    since: Option<&str>,
    until: Option<&str>,
) -> DbResult<Vec<EventRow>> {
    let rows = match (since, until) {
        (Some(s), Some(u)) => {
            sqlx::query_as::<_, EventRow>(
                "SELECT event_id, topic, emitted_at, payload \
                 FROM events WHERE emitted_at >= ? AND emitted_at < ? ORDER BY event_id ASC",
            )
            .bind(s)
            .bind(u)
            .fetch_all(pool)
            .await?
        }
        (Some(s), None) => {
            sqlx::query_as::<_, EventRow>(
                "SELECT event_id, topic, emitted_at, payload \
                 FROM events WHERE emitted_at >= ? ORDER BY event_id ASC",
            )
            .bind(s)
            .fetch_all(pool)
            .await?
        }
        (None, Some(u)) => {
            sqlx::query_as::<_, EventRow>(
                "SELECT event_id, topic, emitted_at, payload \
                 FROM events WHERE emitted_at < ? ORDER BY event_id ASC",
            )
            .bind(u)
            .fetch_all(pool)
            .await?
        }
        (None, None) => {
            sqlx::query_as::<_, EventRow>(
                "SELECT event_id, topic, emitted_at, payload FROM events ORDER BY event_id ASC",
            )
            .fetch_all(pool)
            .await?
        }
    };
    Ok(rows)
}

/// Largest assigned `event_id`, or `0` if the table is empty. Used to seed a
/// live forwarder's cursor so only events emitted after subscribe are sent.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn max_event_id(pool: &SqlitePool) -> DbResult<i64> {
    let (max_id,): (i64,) =
        sqlx::query_as("SELECT COALESCE(MAX(event_id), 0) FROM events").fetch_one(pool).await?;
    Ok(max_id)
}

/// Smallest retained `event_id`, or `None` if the table is empty. Used to
/// detect a retention/eviction gap between a caller's cursor and the oldest
/// row still on disk.
///
/// # Errors
/// Returns [`DbError::Database`] on query failure.
pub async fn min_event_id(pool: &SqlitePool) -> DbResult<Option<i64>> {
    let min_id: Option<i64> =
        sqlx::query_scalar("SELECT MIN(event_id) FROM events").fetch_one(pool).await?;
    Ok(min_id)
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;

    use super::{
        insert_event, list_by_emitted_at_range, list_recent_since, list_since, list_since_by_topic,
        max_event_id, min_event_id,
    };

    async fn setup() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory pool");
        sqlx::query(
            "CREATE TABLE events (\
             event_id INTEGER PRIMARY KEY AUTOINCREMENT,\
             topic TEXT NOT NULL,\
             source TEXT NOT NULL,\
             emitted_at TEXT NOT NULL,\
             payload TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("create events table");
        pool
    }

    #[tokio::test]
    async fn insert_and_list_since_round_trips() {
        let pool = setup().await;
        let id1 = insert_event(&pool, "t.a", "system", "2026-01-01T00:00:00Z", "{}")
            .await
            .expect("insert 1");
        insert_event(&pool, "t.b", "system", "2026-01-01T00:00:01Z", "{}").await.expect("insert 2");

        let all = list_since(&pool, 0).await.expect("list_since");
        assert_eq!(all.len(), 2);

        let after_first = list_since(&pool, id1).await.expect("list_since cursor");
        assert_eq!(after_first.len(), 1);
        assert_eq!(after_first[0].topic, "t.b");
    }

    #[tokio::test]
    async fn list_since_by_topic_filters() {
        let pool = setup().await;
        insert_event(&pool, "t.a", "system", "2026-01-01T00:00:00Z", "{}").await.unwrap();
        insert_event(&pool, "t.b", "system", "2026-01-01T00:00:01Z", "{}").await.unwrap();

        let filtered = list_since_by_topic(&pool, 0, "t.b").await.expect("list_since_by_topic");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].topic, "t.b");
    }

    #[tokio::test]
    async fn list_recent_since_orders_newest_first() {
        let pool = setup().await;
        for i in 0..3 {
            insert_event(&pool, "t.a", "system", &format!("2026-01-01T00:00:0{i}Z"), "{}")
                .await
                .unwrap();
        }

        let recent = list_recent_since(&pool, 0, 2).await.expect("list_recent_since");
        assert_eq!(recent.len(), 2);
        assert!(recent[0].event_id > recent[1].event_id);
    }

    #[tokio::test]
    async fn list_by_emitted_at_range_bounds() {
        let pool = setup().await;
        insert_event(&pool, "t.a", "system", "2026-01-01T00:00:00Z", "{}").await.unwrap();
        insert_event(&pool, "t.a", "system", "2026-01-02T00:00:00Z", "{}").await.unwrap();
        insert_event(&pool, "t.a", "system", "2026-01-03T00:00:00Z", "{}").await.unwrap();

        let all = list_by_emitted_at_range(&pool, None, None).await.expect("no bounds");
        assert_eq!(all.len(), 3);

        let lower = list_by_emitted_at_range(&pool, Some("2026-01-02T00:00:00Z"), None)
            .await
            .expect("lower bound");
        assert_eq!(lower.len(), 2);

        let upper = list_by_emitted_at_range(&pool, None, Some("2026-01-02T00:00:00Z"))
            .await
            .expect("upper bound");
        assert_eq!(upper.len(), 1);

        let both = list_by_emitted_at_range(
            &pool,
            Some("2026-01-02T00:00:00Z"),
            Some("2026-01-03T00:00:00Z"),
        )
        .await
        .expect("both bounds");
        assert_eq!(both.len(), 1);
    }

    #[tokio::test]
    async fn max_event_id_empty_is_zero() {
        let pool = setup().await;
        assert_eq!(max_event_id(&pool).await.expect("max_event_id"), 0);

        let id1 = insert_event(&pool, "t.a", "system", "2026-01-01T00:00:00Z", "{}").await.unwrap();
        insert_event(&pool, "t.b", "system", "2026-01-01T00:00:01Z", "{}").await.unwrap();
        assert_eq!(max_event_id(&pool).await.expect("max_event_id"), id1 + 1);
    }

    #[tokio::test]
    async fn min_event_id_empty_is_none() {
        let pool = setup().await;
        assert_eq!(min_event_id(&pool).await.expect("min_event_id"), None);

        insert_event(&pool, "t.a", "system", "2026-01-01T00:00:00Z", "{}").await.unwrap();
        assert_eq!(min_event_id(&pool).await.expect("min_event_id"), Some(1));
    }
}
