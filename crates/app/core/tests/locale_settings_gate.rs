#![allow(clippy::doc_markdown)]
// "SQLite" is a proper noun, not code -- matches wal_journal_mode.rs
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Layer-1 gate (spec 061 T004, research D8) — the only test in this feature
//! that proves the `locale` settings key is actually durable.
//!
//! `settings.update` returns `Ok` for an unregistered key too (it is silently
//! skipped by `apps/desktop/src-tauri/src/commands/settings.rs`'s allowlist
//! filter, and `app_core_settings::update_setting` itself no-ops on an
//! unknown key before persisting). Asserting `resp.status ==
//! SettingsUpdateStatus::Success` therefore passes in both the broken state
//! (key unregistered, write silently dropped) and the fixed state — it is
//! not evidence of persistence. This test writes `locale` through the real
//! settings use case against a real, file-backed SQLite database, drops
//! every handle to it (simulating app exit), reopens a fresh `Database` over
//! the same file (simulating app restart), and asserts the value read back
//! is the one that was written.

use app_core::settings;
use audit::bus::EventBus;
use contracts_core::settings::{SettingsUpdateRequest, SettingsUpdateStatus};
use contracts_core::JsonAny;
use persistence_core::Database;

#[tokio::test]
async fn locale_survives_close_and_reopen() {
    let dir = tempfile::tempdir().expect("tempdir");
    let url = format!("sqlite://{}/locale-gate.db?mode=rwc", dir.path().display());

    // Session 1: write `locale`, then drop every handle (simulates app exit).
    {
        app_core_settings::caches::invalidate_settings_bag();
        let db = Database::connect(&url).await.expect("connect");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());

        let req = SettingsUpdateRequest {
            key: "locale".to_owned(),
            value: JsonAny::from(serde_json::json!("pt-BR")),
        };
        let resp = settings::update_setting(db.pool(), &bus, &req)
            .await
            .expect("update_setting should succeed");
        assert_eq!(resp.status, SettingsUpdateStatus::Success);
    } // `db` (and its connection pool) dropped here.

    // Session 2: a fresh `Database` over the SAME file — simulates restart.
    app_core_settings::caches::invalidate_settings_bag();
    let db2 = Database::connect(&url).await.expect("reconnect");
    db2.migrate().await.expect("migrations idempotent on reopen");

    let stored = settings::resolve_setting(db2.pool(), "locale", None)
        .await
        .expect("resolve_setting should succeed");

    // THE GATE: assert the stored value, not that some call returned Ok.
    assert_eq!(
        stored,
        serde_json::json!("pt-BR"),
        "locale must still read back 'pt-BR' after a real close + reopen of the settings store"
    );
}

/// A store that has never had `locale` written answers the base locale
/// (`en-GB`, data-model.md "Stored state"), not an empty/null value, even
/// after a real reopen.
#[tokio::test]
async fn locale_defaults_to_base_locale_across_reopen_when_never_written() {
    let dir = tempfile::tempdir().expect("tempdir");
    let url = format!("sqlite://{}/locale-gate-default.db?mode=rwc", dir.path().display());

    {
        app_core_settings::caches::invalidate_settings_bag();
        let db = Database::connect(&url).await.expect("connect");
        db.migrate().await.expect("migrations");
        // No write — the store starts empty.
    }

    app_core_settings::caches::invalidate_settings_bag();
    let db2 = Database::connect(&url).await.expect("reconnect");
    db2.migrate().await.expect("migrations idempotent on reopen");

    let stored = settings::resolve_setting(db2.pool(), "locale", None)
        .await
        .expect("resolve_setting should succeed");
    assert_eq!(stored, serde_json::json!("en-GB"));
}
