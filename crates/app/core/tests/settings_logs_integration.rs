#![allow(clippy::doc_markdown)]
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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

/// Updating a **noisy** key (e.g. `rememberFollowLogs`) must NOT emit a
/// per-change `settings.changed` audit event, while updating a **non-noisy**
/// key (e.g. `logLevel`) must emit one.  Separately, `emit_snapshot` must
/// publish a `settings.snapshot` event.
///
/// `protectedCategories` is also `noisy` but is deliberately NOT used as the
/// example here: spec 016 (plan.md E-016-3) carves out a named exception for
/// it — see `global_protection_default_update_persists_and_emits_protection_event`
/// below, which asserts it (and its sibling protection-default keys) DOES
/// emit an audit event despite being noisy.
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

    // ── noisy key: rememberFollowLogs ─────────────────────────────────────
    //
    // `protectedCategories` is ALSO a noisy key, but spec 016 (plan.md
    // E-016-3) carves out a named exception for it: it must always emit
    // `protection.default.changed` because it is a global protection default,
    // not a generic noisy key. See
    // `global_protection_default_update_persists_and_emits_protection_event`
    // below for that behaviour.
    let before_noisy: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_CHANGED)
        .fetch_one(pool)
        .await
        .expect("count query");

    let req_noisy = SettingsUpdateRequest {
        key: "rememberFollowLogs".to_owned(),
        value: JsonAny::from(serde_json::json!(true)),
    };
    let resp_noisy =
        settings::update_setting(pool, &bus, &req_noisy).await.expect("update rememberFollowLogs");
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
        "noisy rememberFollowLogs update must NOT emit a settings.changed event"
    );

    // ── emit_snapshot publishes settings.snapshot ─────────────────────────
    let before_snap: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
        .bind(TOPIC_SETTINGS_SNAPSHOT)
        .fetch_one(pool)
        .await
        .expect("snapshot count query");

    let dedupe = settings::SnapshotDedupe::new();
    settings::emit_snapshot(pool, &bus, "test", &dedupe)
        .await
        .expect("emit_snapshot must not error");

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

// ── spec 016 T-003/T-004/T-005: global protection defaults ──────────────────

/// The three global protection-default keys (`defaultProtection`,
/// `blockPermanentDelete`, `protectedCategories`) MUST persist to the
/// dedicated `protection_defaults` table (T-003, migration 0035) and emit
/// `protection.default.changed` (T-004) when saved through the same
/// `settings.update` use case the desktop Cleanup settings pane calls
/// (T-005) — INCLUDING `protectedCategories`, which is marked `noisy` for the
/// generic `settings.changed` topic (see
/// `noisy_key_update_does_not_emit_changed_event_non_noisy_does` above) but is
/// a named exception per plan.md E-016-3.
#[tokio::test]
async fn global_protection_default_update_persists_and_emits_protection_event() {
    use audit::event_bus::TOPIC_PROTECTION_DEFAULT_CHANGED;

    let (db, _repo, bus) = support::setup().await;
    let pool = db.pool();

    for (key, value) in [
        ("defaultProtection", serde_json::json!("unprotected")),
        ("blockPermanentDelete", serde_json::json!(false)),
        ("protectedCategories", serde_json::json!(["lights", "masters", "finals", "raw"])),
    ] {
        let before: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
            .bind(TOPIC_PROTECTION_DEFAULT_CHANGED)
            .fetch_one(pool)
            .await
            .expect("count query");

        let req =
            SettingsUpdateRequest { key: key.to_owned(), value: JsonAny::from(value.clone()) };
        let resp = settings::update_setting(pool, &bus, &req)
            .await
            .unwrap_or_else(|e| panic!("update {key} must succeed: {e:?}"));
        assert_eq!(resp.status, SettingsUpdateStatus::Success, "{key} update must succeed");
        assert!(
            resp.audit_id.is_some(),
            "{key} update must emit an audit event (T-004), even though \
             protectedCategories is marked noisy for the generic topic"
        );

        let after: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events WHERE topic = ?")
            .bind(TOPIC_PROTECTION_DEFAULT_CHANGED)
            .fetch_one(pool)
            .await
            .expect("count query");
        assert_eq!(
            after.0,
            before.0 + 1,
            "{key} update must emit exactly one protection.default.changed event"
        );

        // Persisted to the dedicated protection_defaults table (T-003), not
        // just the legacy generic settings table — this is what
        // `app_core::protection::load_global_protection` actually reads, so
        // this is the assertion that proves the save path is really wired
        // (T-005) rather than silently landing in a table nobody reads.
        let stored: (String,) = sqlx::query_as(
            "SELECT value FROM protection_defaults WHERE scope = 'global' AND key = ?",
        )
        .bind(key)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|e| panic!("{key} must be persisted in protection_defaults: {e:?}"));
        let stored_value: serde_json::Value =
            serde_json::from_str(&stored.0).expect("stored value must be valid JSON");
        assert_eq!(stored_value, value, "{key} persisted value must match the update");

        // `resolve_setting` is what `settings.get` AND the safety-critical
        // `archive.permanently_delete` command use to read `blockPermanentDelete`
        // — it must reflect the update too, not just the raw table (T-005).
        let resolved = settings::resolve_setting(pool, key, None)
            .await
            .unwrap_or_else(|e| panic!("resolve_setting({key}) must succeed: {e:?}"));
        assert_eq!(resolved, value, "resolve_setting({key}) must reflect the persisted update");
    }
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
