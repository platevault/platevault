// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The live log viewer stream (spec 019): every durable `events` row, projected
//! to a [`LogEntry`], in event-id order.
//!
//! The audit bus broadcast is only the wake-up signal. On each one the feed
//! reads every row past its cursor, so each entry carries its real `event_id`
//! (and thus the `aud:<n>` id `log.recent` returns for the same row).

use std::collections::VecDeque;

use app_core::log_stream::{self, LOG_BUFFER_SIZE};
use audit::bus::EventBus;
use audit::event_bus::EventEnvelope;
use contracts_core::log::{LogEntry, LogLevel};
use persistence_lifecycle::repositories::events;
use sqlx::SqlitePool;
use tokio::sync::broadcast::{self, error::RecvError};

use crate::channels::Feed;

/// Where the feed reads from next.
#[derive(Clone, Copy)]
enum Cursor {
    /// Not seeded yet: the first [`Feed::next`] seeds it and catches up.
    Unseeded,
    /// The highest event id a broadcast-driven read consumed.
    At(i64),
    /// The feed has ended.
    Ended,
}

/// [`LogEntry`] values at or above a level, for a host to show live.
///
/// **Startup.** The first read replays the rows committed before the feed
/// started, bounded to the newest [`LOG_BUFFER_SIZE`] events: the frontend
/// ring buffer's capacity, so a wider replay could only evict the rows it just
/// delivered. Older rows are the ones `log.recent` declines to return; they
/// stay reachable through `log.export`, which is uncapped.
///
/// That replay does NOT consume its rows: the cursor stays at the seed until a
/// broadcast-driven read. A host typically starts the feed before any UI
/// listener exists, and an advanced cursor would put those rows beyond every
/// later read. The next broadcast re-delivers them; the frontend dedupes by
/// entry id, so the one-time overlap is invisible.
///
/// **Seed failure.** If the rewound cursor cannot be determined the feed
/// ends. It must not fall back to cursor `0`, which would replay the whole
/// `events` table and defeat the bound. The failure goes to `tracing`, not to a
/// diagnostic entry: no UI listener exists yet to receive one.
///
/// **Lag.** A lagged broadcast yields a diagnostic entry pointing at export,
/// and the next read still covers every row past the cursor.
pub struct LogFeed {
    bus: broadcast::Receiver<EventEnvelope<serde_json::Value>>,
    pool: SqlitePool,
    level: LogLevel,
    cursor: Cursor,
    pending: VecDeque<LogEntry>,
    diagnostics: u64,
}

impl LogFeed {
    /// Subscribe to `bus` now; rows are read from `pool` once the feed is
    /// first polled.
    #[must_use]
    pub fn subscribe(bus: &EventBus, pool: SqlitePool, level: LogLevel) -> Self {
        Self {
            bus: bus.subscribe(),
            pool,
            level,
            cursor: Cursor::Unseeded,
            pending: VecDeque::new(),
            diagnostics: 0,
        }
    }

    /// Queue every row newer than `cursor` at or above the feed's level,
    /// returning the advanced cursor.
    ///
    /// A query failure leaves the cursor untouched so the next read retries the
    /// same range rather than skipping it.
    async fn read_since(&mut self, cursor: i64) -> i64 {
        let rows = match events::list_since(&self.pool, cursor).await {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!("log forwarder: db query failed: {e}");
                return cursor;
            }
        };

        let mut cursor = cursor;
        for row in rows {
            cursor = cursor.max(row.event_id);
            let entry =
                log_stream::project_event(row.event_id, &row.topic, &row.emitted_at, &row.payload);
            if entry.level.rank() >= self.level.rank() {
                self.pending.push_back(entry);
            }
        }
        cursor
    }

    /// Seed the cursor and queue the startup replay without consuming it.
    async fn seed(&mut self) -> Cursor {
        // Rewind rather than jumping to the table maximum: a jump discards every
        // row committed between app start and feed start.
        let window = i64::try_from(LOG_BUFFER_SIZE).unwrap_or(i64::MAX);
        match events::rewound_cursor(&self.pool, window).await {
            Ok(seed) => {
                self.read_since(seed).await;
                Cursor::At(seed)
            }
            Err(e) => {
                // No retry here: `persistence_core::BUSY_TIMEOUT` already gives
                // sqlx a 5s window for lock contention, so an error past it is
                // not transient. Ending keeps the bound intact; `log.recent`
                // still serves the durable history.
                tracing::error!("log forwarder: cursor init failed, not streaming: {e}");
                Cursor::Ended
            }
        }
    }

    /// Advance on the next broadcast.
    async fn follow(&mut self, cursor: i64) -> Cursor {
        match self.bus.recv().await {
            Ok(_envelope) => Cursor::At(self.read_since(cursor).await),
            Err(RecvError::Closed) => {
                tracing::debug!("log forwarder: broadcast channel closed");
                Cursor::Ended
            }
            Err(RecvError::Lagged(n)) => {
                tracing::warn!("log forwarder: lagged by {n} events");
                // Point at export, not refresh: a refresh re-pulls the newest
                // 500 via `log.recent`, which cannot reach rows outside that
                // window. `log.export` is uncapped and can.
                self.diagnostics += 1;
                self.pending.push_back(LogEntry::diagnostic(
                    self.diagnostics,
                    LogLevel::Warn,
                    format!(
                        "Log stream lagged: {n} events not shown live. Export the log to see them."
                    ),
                ));
                Cursor::At(cursor)
            }
        }
    }
}

impl Feed for LogFeed {
    type Item = LogEntry;

    async fn next(&mut self) -> Option<LogEntry> {
        loop {
            if let Some(entry) = self.pending.pop_front() {
                return Some(entry);
            }
            self.cursor = match self.cursor {
                Cursor::Unseeded => self.seed().await,
                Cursor::At(cursor) => self.follow(cursor).await,
                Cursor::Ended => return None,
            };
        }
    }
}
