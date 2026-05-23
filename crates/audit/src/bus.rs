//! Hybrid event bus: live broadcast via tokio + durable SQLite events table.
//!
//! T010b: durable side wired in this module. Publishes to both the SQLite
//! `events` table (durable, survives restart) and a tokio broadcast channel
//! (in-process, non-durable). Replay reads from the `events` table with a
//! monotonic `event_id` cursor.

use serde::Serialize;
use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::event_bus::{EventEnvelope, Source};

/// Capacity of the broadcast channel.  Lagging receivers are dropped with
/// `RecvError::Lagged`; they must re-subscribe and query the durable table.
const DEFAULT_BUS_CAPACITY: usize = 256;

/// Error type for event bus operations.
#[derive(Debug, thiserror::Error)]
pub enum BusError {
    #[error("serialisation error: {0}")]
    Serialise(#[from] serde_json::Error),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Hybrid live + durable event bus.
///
/// Clone to share across tasks — clones share the same underlying channel and pool.
#[derive(Clone, Debug)]
pub struct EventBus {
    sender: broadcast::Sender<EventEnvelope<serde_json::Value>>,
    pool: SqlitePool,
}

impl EventBus {
    /// Construct with a SQLite pool (durable side) and channel capacity (live side).
    #[must_use]
    pub fn new(pool: SqlitePool, channel_capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(channel_capacity);
        Self { sender, pool }
    }

    /// Convenience constructor with default channel capacity.
    #[must_use]
    pub fn with_pool(pool: SqlitePool) -> Self {
        Self::new(pool, DEFAULT_BUS_CAPACITY)
    }

    /// Publish a typed payload on the given topic.
    ///
    /// 1. Serialises the payload to `serde_json::Value`.
    /// 2. Inserts a durable row into the `events` table.
    /// 3. Broadcasts the envelope to live subscribers.
    ///
    /// Returns the number of active live receivers that received the event.
    /// A return value of `0` is not an error — it just means no live listeners.
    ///
    /// # Errors
    /// Returns `BusError::Serialise` if payload serialisation fails.
    /// Returns `BusError::Database` if the durable write fails.
    pub async fn publish<P: Serialize>(
        &self,
        topic: &str,
        source: Source,
        payload: P,
    ) -> Result<usize, BusError> {
        let value = serde_json::to_value(&payload)?;
        let envelope = EventEnvelope::new(topic, source, value.clone());

        // 1. Write durable row.
        let source_str = match source {
            Source::User => "user",
            Source::Restore => "restore",
            Source::System => "system",
        };
        let emitted_at = envelope.emitted_at.as_offset_date_time()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());
        let payload_str = serde_json::to_string(&value)?;

        sqlx::query(
            "INSERT INTO events (topic, source, emitted_at, payload) VALUES (?, ?, ?, ?)",
        )
        .bind(topic)
        .bind(source_str)
        .bind(&emitted_at)
        .bind(&payload_str)
        .execute(&self.pool)
        .await?;

        // 2. Broadcast to live subscribers.
        // `send` errors only when there are NO receivers at all (which is fine).
        Ok(self.sender.send(envelope).unwrap_or(0))
    }

    /// Subscribe to all live events on the bus.
    ///
    /// Receiver is non-blocking (async). Missed events due to capacity overflow
    /// come back as `RecvError::Lagged`.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<EventEnvelope<serde_json::Value>> {
        self.sender.subscribe()
    }

    /// Replay events from the durable `events` table.
    ///
    /// - `topic_filter`: if `Some`, only events with that topic are returned.
    /// - `since`: if `Some`, only events with `event_id > since` are returned (cursor).
    ///
    /// All replayed events have `source` overridden to `Source::Restore` per
    /// spec 002 R-Source-1 (replay = restore semantics).
    ///
    /// # Errors
    /// Returns `BusError::Database` if the query fails.
    pub async fn replay(
        &self,
        topic_filter: Option<&str>,
        since: Option<i64>,
    ) -> Result<Vec<EventEnvelope<serde_json::Value>>, BusError> {
        // Use runtime-checked queries (sqlx::query) rather than sqlx::query! macros
        // because the DATABASE_URL env var is not set at compile time for this crate.
        let since_id = since.unwrap_or(0);

        let rows: Vec<(i64, String, String, String)> = if let Some(topic) = topic_filter {
            sqlx::query_as::<_, (i64, String, String, String)>(
                "SELECT event_id, topic, emitted_at, payload \
                 FROM events WHERE event_id > ? AND topic = ? ORDER BY event_id ASC",
            )
            .bind(since_id)
            .bind(topic)
            .fetch_all(&self.pool)
            .await?
        } else {
            sqlx::query_as::<_, (i64, String, String, String)>(
                "SELECT event_id, topic, emitted_at, payload \
                 FROM events WHERE event_id > ? ORDER BY event_id ASC",
            )
            .bind(since_id)
            .fetch_all(&self.pool)
            .await?
        };

        let mut envelopes = Vec::with_capacity(rows.len());
        for (_event_id, topic, _emitted_at, payload_str) in rows {
            let payload: serde_json::Value = serde_json::from_str(&payload_str)?;
            // Restore semantics: always emit with Source::Restore (R-Source-1).
            let envelope = EventEnvelope::new(&topic, Source::Restore, payload);
            envelopes.push(envelope);
        }

        Ok(envelopes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_bus::Source;

    async fn make_test_bus() -> EventBus {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("in-memory pool");
        // Apply the events table migration manually.
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS events (\
             event_id INTEGER PRIMARY KEY AUTOINCREMENT,\
             topic TEXT NOT NULL,\
             source TEXT NOT NULL,\
             emitted_at TEXT NOT NULL,\
             payload TEXT NOT NULL\
             )",
        )
        .execute(&pool)
        .await
        .expect("create events table");
        EventBus::with_pool(pool)
    }

    #[tokio::test]
    async fn publish_and_receive_event() {
        let bus = make_test_bus().await;
        let mut rx = bus.subscribe();

        bus.publish("test.topic", Source::System, serde_json::json!({"ok": true}))
            .await
            .expect("publish");

        let envelope = rx.try_recv().expect("should receive");
        assert_eq!(envelope.topic, "test.topic");
        assert_eq!(envelope.payload["ok"], true);
    }

    #[tokio::test]
    async fn publish_to_no_receivers_is_not_an_error() {
        let bus = make_test_bus().await;
        let count = bus
            .publish("test.topic", Source::System, serde_json::json!({}))
            .await
            .expect("publish");
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn publish_three_events_durable_and_live() {
        let bus = make_test_bus().await;
        let mut rx = bus.subscribe();

        // Publish 3 events.
        for i in 0..3u32 {
            bus.publish("test.topic", Source::User, serde_json::json!({"i": i}))
                .await
                .expect("publish");
        }

        // Verify 3 received on broadcast channel.
        for i in 0..3u32 {
            let envelope = rx.try_recv().expect("should receive");
            assert_eq!(envelope.payload["i"], i);
        }

        // Verify 3 durable rows in the events table.
        let count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = 'test.topic'")
                .fetch_one(&bus.pool)
                .await
                .expect("count");
        assert_eq!(count.0, 3);
    }

    #[tokio::test]
    async fn replay_returns_restore_source() {
        let bus = make_test_bus().await;

        // Publish 3 events with Source::User.
        for i in 0..3u32 {
            bus.publish("replay.topic", Source::User, serde_json::json!({"i": i}))
                .await
                .expect("publish");
        }

        // Replay without cursor.
        let replayed = bus.replay(Some("replay.topic"), None).await.expect("replay");
        assert_eq!(replayed.len(), 3);

        // All replayed events must have Source::Restore (R-Source-1).
        for envelope in &replayed {
            assert_eq!(envelope.source, Source::Restore, "replay must use Restore source");
        }
    }

    #[tokio::test]
    async fn replay_cursor_since() {
        let bus = make_test_bus().await;

        // Publish 3 events and note their event_ids via count.
        for i in 0..3u32 {
            bus.publish("cursor.topic", Source::System, serde_json::json!({"i": i}))
                .await
                .expect("publish");
        }

        // Get the event_id of the first two rows.
        let first_id: (i64,) =
            sqlx::query_as("SELECT MIN(event_id) FROM events WHERE topic = 'cursor.topic'")
                .fetch_one(&bus.pool)
                .await
                .expect("min id");

        // Replay since first_id — should return only the 2 events after it.
        let replayed = bus.replay(Some("cursor.topic"), Some(first_id.0)).await.expect("replay");
        assert_eq!(replayed.len(), 2, "should return 2 events after cursor");
    }
}
