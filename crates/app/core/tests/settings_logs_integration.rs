#![allow(clippy::doc_markdown)]
//! Layer-1 integration tests for settings/configuration model (#19) and
//! bottom log viewer (#20) — feature 037 (T006/T007).
//!
//! All tests run against a real in-memory SQLite database with all migrations
//! applied via the shared `support::setup()` harness.

mod support;

use app_core::log_stream::{self, RecentOptions};
use app_core::settings;
use audit::event_bus::{TOPIC_SETTINGS_CHANGED, TOPIC_SETTINGS_SNAPSHOT};
use contracts_core::settings::{
    RestoreDefaultsRequest, RestoreDefaultsStatus, SettingsUpdateRequest, SettingsUpdateStatus,
};
use contracts_core::JsonAny;

// ── settings: update + get round-trip ────────────────────────────────────────

/// Update a setting, then read it back via `get_settings` and assert the
/// persisted value is present — a restart-equivalent round-trip.
#[tokio::test]
async fn setting_update_persists_and_reads_back() {
    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    // Default log_level is "info"; update to "debug".
    let req = SettingsUpdateRequest {
        key: "logLevel".to_owned(),
        value: JsonAny::from(serde_json::Value::String("debug".to_owned())),
    };
    let resp =
        settings::update_setting(pool, &bus, &req).await.expect("update_setting should succeed");

    assert_eq!(
        resp.status,
        SettingsUpdateStatus::Success,
        "expected Success status, got {:?}",
        resp.status
    );
    assert_eq!(resp.key, "logLevel");

    // Re-read via get_settings (simulates a restart / fresh load).
    let get_resp = settings::get_settings(pool, &bus).await.expect("get_settings should succeed");

    assert_eq!(
        get_resp.settings.log_level, "debug",
        "log_level should be 'debug' after update, got '{}'",
        get_resp.settings.log_level
    );
}

// ── settings: no-op guard ─────────────────────────────────────────────────────

/// Writing a value identical to the stored value must return `Noop` and not
/// emit an audit event.
#[tokio::test]
async fn setting_update_noop_when_value_unchanged() {
    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    // First write: set hashOnScan to "eager".
    let req = SettingsUpdateRequest {
        key: "hashOnScan".to_owned(),
        value: JsonAny::from(serde_json::Value::String("eager".to_owned())),
    };
    settings::update_setting(pool, &bus, &req).await.expect("first update should succeed");

    // Count events before the no-op attempt.
    let (before,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_CHANGED)
        .fetch_one(pool)
        .await
        .expect("events count query failed");

    // Second write with same value — must be a no-op.
    let resp =
        settings::update_setting(pool, &bus, &req).await.expect("second update should succeed");

    assert_eq!(
        resp.status,
        SettingsUpdateStatus::Noop,
        "expected Noop on identical value, got {:?}",
        resp.status
    );

    let (after,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_CHANGED)
        .fetch_one(pool)
        .await
        .expect("events count query failed");

    assert_eq!(before, after, "no audit event should be emitted for a no-op update");
}

// ── settings: restore_defaults round-trip ────────────────────────────────────

/// Change a setting, then restore it to default and assert the default value
/// reads back from `get_settings`.
#[tokio::test]
async fn restore_defaults_reverts_to_default_value() {
    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    // Mutate logLevel away from its in-code default ("info") to "debug".
    let req = SettingsUpdateRequest {
        key: "logLevel".to_owned(),
        value: JsonAny::from(serde_json::Value::String("debug".to_owned())),
    };
    settings::update_setting(pool, &bus, &req).await.expect("update logLevel should succeed");

    // Confirm mutation landed.
    let get1 = settings::get_settings(pool, &bus).await.expect("get_settings after mutation");
    assert_eq!(get1.settings.log_level, "debug", "precondition: should be 'debug' after write");

    // Restore only the logLevel key.
    let restore_req = RestoreDefaultsRequest { keys: vec!["logLevel".to_owned()] };
    let restore_resp = settings::restore_defaults(pool, &bus, &restore_req)
        .await
        .expect("restore_defaults should succeed");

    assert_eq!(
        restore_resp.status,
        RestoreDefaultsStatus::Success,
        "expected Success from restore, got {:?}",
        restore_resp.status
    );
    assert!(
        restore_resp.restored.contains(&"logLevel".to_owned()),
        "restored list should include 'logLevel'"
    );

    // Read back after restore — should be back at the in-code default ("info").
    let get2 = settings::get_settings(pool, &bus).await.expect("get_settings after restore");
    assert_eq!(
        get2.settings.log_level, "info",
        "logLevel should revert to 'info' (in-code default) after restore_defaults"
    );
}

// ── T017: noisy key suppression + emit_snapshot ───────────────────────────────

/// Updating a **noisy** key (e.g. `protectedCategories`) must NOT emit a
/// per-change `settings.changed` audit event, while updating a **non-noisy**
/// key (e.g. `logLevel`) must emit one.  Separately, `emit_snapshot` must
/// publish a `settings.snapshot` event.
#[tokio::test]
async fn noisy_key_update_does_not_emit_changed_event_non_noisy_does() {
    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    // ── non-noisy key: logLevel ───────────────────────────────────────────
    let before_non_noisy: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_CHANGED)
        .fetch_one(pool)
        .await
        .expect("count query");

    let req_non_noisy = SettingsUpdateRequest {
        key: "logLevel".to_owned(),
        value: JsonAny::from(serde_json::json!("warn")),
    };
    let resp_non_noisy =
        settings::update_setting(pool, &bus, &req_non_noisy).await.expect("update logLevel");
    assert_eq!(resp_non_noisy.status, SettingsUpdateStatus::Success);
    // Non-noisy: audit_id must be present.
    assert!(resp_non_noisy.audit_id.is_some(), "non-noisy key update must return an audit_id");

    let after_non_noisy: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_CHANGED)
        .fetch_one(pool)
        .await
        .expect("count query");
    assert_eq!(
        after_non_noisy.0,
        before_non_noisy.0 + 1,
        "non-noisy logLevel update must emit exactly one settings.changed event"
    );

    // ── noisy key: protectedCategories ───────────────────────────────────
    let before_noisy: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_CHANGED)
        .fetch_one(pool)
        .await
        .expect("count query");

    let req_noisy = SettingsUpdateRequest {
        key: "protectedCategories".to_owned(),
        value: JsonAny::from(serde_json::json!(["lights", "masters", "finals", "raw"])),
    };
    let resp_noisy =
        settings::update_setting(pool, &bus, &req_noisy).await.expect("update protectedCategories");
    assert_eq!(resp_noisy.status, SettingsUpdateStatus::Success);
    // Noisy: audit_id must be absent.
    assert!(resp_noisy.audit_id.is_none(), "noisy key update must NOT return an audit_id");

    let after_noisy: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_CHANGED)
        .fetch_one(pool)
        .await
        .expect("count query");
    assert_eq!(
        after_noisy.0, before_noisy.0,
        "noisy protectedCategories update must NOT emit a settings.changed event"
    );

    // ── emit_snapshot publishes settings.snapshot ─────────────────────────
    let before_snap: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_SNAPSHOT)
        .fetch_one(pool)
        .await
        .expect("snapshot count query");

    settings::emit_snapshot(pool, &bus, "test").await.expect("emit_snapshot must not error");

    let after_snap: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_SNAPSHOT)
        .fetch_one(pool)
        .await
        .expect("snapshot count query");
    assert_eq!(
        after_snap.0,
        before_snap.0 + 1,
        "emit_snapshot must persist exactly one settings.snapshot event"
    );
}

// ── log stream: events written by settings surface in recent_entries ──────────

/// Updating a non-noisy setting emits an event to the `events` table. Assert
/// that `recent_entries` returns at least that entry.
#[tokio::test]
async fn log_stream_recent_entries_returns_emitted_events() {
    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    // Precondition: no events yet.
    let empty = log_stream::recent_entries(pool, RecentOptions::default())
        .await
        .expect("recent_entries on empty db should succeed");
    assert!(
        empty.entries.is_empty(),
        "expected empty log on fresh DB, got {} entries",
        empty.entries.len()
    );

    // Trigger an audit event via a non-noisy setting update (logLevel is not noisy).
    let req = SettingsUpdateRequest {
        key: "logLevel".to_owned(),
        value: JsonAny::from(serde_json::Value::String("warn".to_owned())),
    };
    settings::update_setting(pool, &bus, &req).await.expect("update_setting should succeed");

    // recent_entries should now include at least one entry.
    let result = log_stream::recent_entries(pool, RecentOptions::default())
        .await
        .expect("recent_entries should succeed after event emit");

    assert!(
        !result.entries.is_empty(),
        "expected at least one log entry after settings update, got 0"
    );

    // The entry's id must follow the "aud:<n>" convention.
    let first = &result.entries[0];
    assert!(
        first.id.starts_with("aud:"),
        "log entry id should start with 'aud:', got '{}'",
        first.id
    );
}
