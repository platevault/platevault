// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Real-backend integration test for the backend-authoritative onboarding tick
//! subscriber (spec 056 T022, FR-016): a real `EventBus` + real migrated
//! `SqlitePool` + real `start_onboarding_subscriber`, driven by published
//! envelopes. This is the ONLY coverage of the bus→subscriber→persist path
//! wired together — the pure resolver (`ticked_item_ids`) and the persist use
//! case (`tick_from_event`) each have unit tests in isolation, but nothing else
//! exercises them through a live broadcast subscription.
//!
//! **Out of scope here (deferred to e2e):** the `onboarding:state-changed`
//! `Emitter::emit` and its event-name round-trip. The mock Tauri app provides an
//! `AppHandle` so the subscriber can run, but has no webview listening; the emit
//! no-ops and the subscriber `let _ =`-ignores its result, so these tests assert
//! only the persisted tick, never the emit.

use audit::bus::EventBus;
use audit::event_bus::Source;
use contracts_core::onboarding::{
    OnboardingItemState, OnboardingManualState, OnboardingStateSource,
};
use persistence_db::Database;

use desktop_shell::commands::onboarding::start_onboarding_subscriber;

/// Build a real migrated in-memory DB + bus + a mock Tauri app, then start the
/// subscriber. `start_onboarding_subscriber` calls `bus.subscribe()`
/// synchronously before spawning its loop, so events published after this
/// returns are never lost. The returned `App` MUST stay bound for the whole
/// test: the spawned loop holds an `AppHandle` clone and emits through it.
async fn setup() -> (tauri::App<tauri::test::MockRuntime>, sqlx::SqlitePool, EventBus) {
    let db = Database::in_memory().await.expect("in-memory database");
    db.migrate().await.expect("run migrations");
    let pool = db.pool().clone();
    let bus = EventBus::with_pool(pool.clone());

    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");

    start_onboarding_subscriber(app.handle().clone(), pool.clone(), &bus);
    (app, pool, bus)
}

/// Poll `onboarding.state.get` until `item_id` reaches `want`, or panic at the
/// 5s deadline. The subscriber persists ticks asynchronously on another pooled
/// connection; the `sleep().await` yields so the spawned loop is scheduled.
async fn wait_for_state(
    pool: &sqlx::SqlitePool,
    item_id: &str,
    want: OnboardingItemState,
) -> contracts_core::onboarding::OnboardingItemDto {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let resp = app_core::onboarding::get_state(pool).await.expect("get_state");
        let item = resp
            .state
            .items
            .into_iter()
            .find(|i| i.item_id == item_id)
            .expect("registry item present after seed");
        if item.state == want {
            return item;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "timed out waiting for {item_id} == {want:?}, still {:?}",
            item.state
        );
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

async fn item_state(pool: &sqlx::SqlitePool, item_id: &str) -> OnboardingItemState {
    app_core::onboarding::get_state(pool)
        .await
        .expect("get_state")
        .state
        .items
        .into_iter()
        .find(|i| i.item_id == item_id)
        .expect("registry item present after seed")
        .state
}

/// FR-016: a record processed during restore/replay must never tick. The
/// subscriber skips `source == Restore` server-side. Proven without a bare
/// timeout: publish the restore event, then a live `project.created` barrier;
/// the bus is FIFO to the subscriber's single receiver and the first publish is
/// awaited before the second, so once the barrier tick lands the restore event
/// is provably consumed-and-skipped.
#[tokio::test]
async fn restore_sourced_event_never_ticks() {
    let (_app, pool, bus) = setup().await;

    bus.publish("inventory.confirmed", Source::Restore, serde_json::json!({}))
        .await
        .expect("publish restore inventory.confirmed");
    bus.publish("project.created", Source::User, serde_json::json!({}))
        .await
        .expect("publish live project.created");

    // Barrier: the later live event's tick is only observable after the
    // subscriber has already drained past the restore event.
    wait_for_state(&pool, "projects.create_first", OnboardingItemState::AutoChecked).await;

    assert_eq!(
        item_state(&pool, "inbox.confirm_first").await,
        OnboardingItemState::Unchecked,
        "restore-sourced inventory.confirmed must not tick inbox.confirm_first (FR-016)"
    );
}

/// Live round-trip: a `source == User` (i.e. non-restore) `inventory.confirmed`
/// ticks its mapped registry item to `auto_checked` with `source == event` —
/// the real bus→subscriber→persist path, not just the pure resolver.
#[tokio::test]
async fn live_inventory_confirmed_ticks_inbox_confirm_first() {
    let (_app, pool, bus) = setup().await;

    bus.publish("inventory.confirmed", Source::User, serde_json::json!({}))
        .await
        .expect("publish live inventory.confirmed");

    let item = wait_for_state(&pool, "inbox.confirm_first", OnboardingItemState::AutoChecked).await;
    assert_eq!(
        item.source,
        OnboardingStateSource::Event,
        "a live tick must be sourced from the event, not seed/user"
    );
}

/// Topic-map completeness: `project.created` (otherwise untested end-to-end)
/// ticks its registry item.
#[tokio::test]
async fn live_project_created_ticks_projects_create_first() {
    let (_app, pool, bus) = setup().await;

    bus.publish("project.created", Source::User, serde_json::json!({}))
        .await
        .expect("publish live project.created");

    wait_for_state(&pool, "projects.create_first", OnboardingItemState::AutoChecked).await;
}

/// Settled-never-downgraded, end-to-end: a user-dismissed item is not flipped
/// back to `auto_checked` by a later live event on its completion topic
/// (`tick_from_event`'s `upsert_if_unsettled` guard, exercised through the bus).
#[tokio::test]
async fn live_event_never_downgrades_a_dismissed_item() {
    let (_app, pool, bus) = setup().await;

    app_core::onboarding::set_item_state(
        &pool,
        &contracts_core::onboarding::OnboardingItemSetStateRequest {
            item_id: "inbox.confirm_first".to_owned(),
            state: OnboardingManualState::Dismissed,
        },
    )
    .await
    .expect("dismiss inbox.confirm_first");

    bus.publish("inventory.confirmed", Source::User, serde_json::json!({}))
        .await
        .expect("publish live inventory.confirmed");

    // Barrier: a second live event on a different topic gives the subscriber a
    // provable point past the dismissed-item event without a bare timeout.
    bus.publish("project.created", Source::User, serde_json::json!({}))
        .await
        .expect("publish live project.created");
    wait_for_state(&pool, "projects.create_first", OnboardingItemState::AutoChecked).await;

    assert_eq!(
        item_state(&pool, "inbox.confirm_first").await,
        OnboardingItemState::Dismissed,
        "a live tick must never downgrade a settled (dismissed) item"
    );
}
