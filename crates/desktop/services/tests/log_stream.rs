// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Real-backend coverage of the log viewer stream's contracts: the
//! pre-broadcast catch-up, the refusal to replay the whole `events` table when
//! the cursor cannot be seeded, the bound on what a replay yields, the
//! catch-up leaving its rows for the next broadcast, and the lag diagnostic.

use std::time::Duration;

use audit::bus::EventBus;
use audit::event_bus::Source;
use contracts_core::log::{LogEntry, LogLevel};
use desktop_services::channels::Feed;
use desktop_services::log_stream::LogFeed;
use persistence_core::Database;

async fn setup() -> (sqlx::SqlitePool, EventBus) {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());
    (pool, bus)
}

async fn seed_rows(pool: &sqlx::SqlitePool, count: usize) {
    for i in 0..count {
        persistence_lifecycle::repositories::events::insert_event(
            pool,
            "lifecycle.transition.applied",
            "system",
            &format!("2026-01-01T00:00:00.{i:04}Z"),
            "{}",
        )
        .await
        .expect("seed event");
    }
}

async fn publish(bus: &EventBus) {
    bus.publish("lifecycle.transition.applied", Source::System, serde_json::json!({}))
        .await
        .expect("publish event");
}

/// The next entry, failing the test if none arrives in time.
async fn next_entry(feed: &mut LogFeed) -> LogEntry {
    tokio::time::timeout(Duration::from_secs(5), feed.next())
        .await
        .expect("an entry within 5s")
        .expect("the feed is still live")
}

async fn next_ids(feed: &mut LogFeed, count: usize) -> Vec<String> {
    let mut ids = Vec::with_capacity(count);
    for _ in 0..count {
        ids.push(next_entry(feed).await.id);
    }
    ids
}

/// Whether the feed is parked: nothing to yield, but not ended.
async fn is_parked(feed: &mut LogFeed) -> bool {
    tokio::time::timeout(Duration::from_millis(200), feed.next()).await.is_err()
}

/// A `rewound_cursor` failure must end the feed, never seed cursor `0`.
/// Seeding `0` would make the next `list_since(&pool, 0)` load and yield every
/// row in `events`, defeating the bounded `LOG_BUFFER_SIZE` catch-up.
///
/// Dropping the table is a genuine query failure against a live pool: no
/// injected error type, and the same `DbError` a corrupt or migrating DB yields.
/// The failure goes to `tracing`, not to a diagnostic entry: the feed starts
/// before any UI listener exists, so an entry yielded here reaches nobody.
#[tokio::test]
async fn a_seed_failure_ends_the_feed_instead_of_replaying_everything() {
    let (pool, bus) = setup().await;
    sqlx::query("DROP TABLE events").execute(&pool).await.expect("drop events table");

    let mut feed = LogFeed::subscribe(&bus, pool, LogLevel::Debug);
    let ended = tokio::time::timeout(Duration::from_secs(5), feed.next()).await;

    assert!(
        matches!(ended, Ok(None)),
        "the feed must end, yielding nothing, when its cursor cannot be seeded; a live \
         feed fell back to cursor 0 and is replaying the whole table: {ended:?}"
    );
}

/// A replay that skips history yields the window's rows and nothing else.
///
/// The frontend ring buffer holds exactly `LOG_BUFFER_SIZE` entries and evicts
/// oldest-first (`apps/desktop/src/data/logStore.ts`), so any extra startup entry
/// costs one of the rows the replay exists to deliver. Asserting on the yielded
/// ids (not just their count) is what catches a re-added startup diagnostic: a
/// `dia:` entry would both appear here and push `aud:1` out of the panel.
#[tokio::test]
async fn a_skipped_history_replay_yields_only_the_window_rows() {
    let (pool, bus) = setup().await;
    // One row beyond the window, so `rewound_cursor` must skip history.
    let seeded = app_core::log_stream::LOG_BUFFER_SIZE + 1;
    seed_rows(&pool, seeded).await;

    let mut feed = LogFeed::subscribe(&bus, pool, LogLevel::Debug);
    let ids = next_ids(&mut feed, app_core::log_stream::LOG_BUFFER_SIZE).await;

    // The newest `window` rows, oldest-first: ids 2..=seeded. Row 1 is outside
    // the window and is reachable through `log.export`.
    let expected: Vec<String> = (2..=seeded).map(|i| format!("aud:{i}")).collect();
    assert_eq!(ids, expected, "the replay must yield exactly the window rows, oldest first");
    assert!(is_parked(&mut feed).await, "no entry follows the window rows");
}

/// Production ordering: the host forwards the startup catch-up before any UI
/// listener exists, so those entries reach nobody. If the catch-up consumed
/// its rows, they would be past the cursor of every later read and no
/// broadcast could ever deliver them: permanent loss, not delay.
///
/// The broadcast stands in for the first event after the window opens.
#[tokio::test]
async fn the_catch_up_leaves_its_rows_for_the_next_broadcast() {
    let (pool, bus) = setup().await;
    seed_rows(&pool, 3).await;

    let mut feed = LogFeed::subscribe(&bus, pool, LogLevel::Debug);
    assert_eq!(next_ids(&mut feed, 3).await, ["aud:1", "aud:2", "aud:3"], "catch-up");

    publish(&bus).await;
    assert_eq!(
        next_ids(&mut feed, 4).await,
        ["aud:1", "aud:2", "aud:3", "aud:4"],
        "the rows the catch-up yielded are read again with the broadcast's row"
    );
}

/// The catch-up runs before the feed waits for a broadcast: rows already
/// inside the rewound window are yielded with no broadcast at all, and the
/// feed then parks rather than ending.
#[tokio::test]
async fn pre_existing_rows_are_yielded_without_a_broadcast() {
    let (pool, bus) = setup().await;
    seed_rows(&pool, 3).await;

    let mut feed = LogFeed::subscribe(&bus, pool, LogLevel::Debug);
    assert_eq!(next_ids(&mut feed, 3).await, ["aud:1", "aud:2", "aud:3"], "every row, in id order");
    assert!(is_parked(&mut feed).await, "the feed stays live after catching up");
}

/// A lagged broadcast yields a warning diagnostic pointing at export, and the
/// next broadcast still reads every row past the cursor.
#[tokio::test]
async fn a_lagged_broadcast_yields_a_diagnostic_and_loses_no_row() {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::new(pool.clone(), 1);

    let mut feed = LogFeed::subscribe(&bus, pool, LogLevel::Debug);
    // Seed the cursor before anything is published, so the three rows below
    // reach the feed only through the lagged broadcast.
    assert!(is_parked(&mut feed).await, "an empty table yields nothing");
    for _ in 0..3 {
        publish(&bus).await;
    }

    let diagnostic = next_entry(&mut feed).await;
    assert_eq!(diagnostic.id, "dia:1");
    assert_eq!(diagnostic.level, LogLevel::Warn);
    assert!(diagnostic.message.contains("2 events not shown live"), "{}", diagnostic.message);
    assert_eq!(next_ids(&mut feed, 3).await, ["aud:1", "aud:2", "aud:3"]);
}
