// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Onboarding seed/restore derivation integration tests — spec 056 US3, T023.
//!
//! Layer-1 black-box coverage of the FR-014/PQ-001 seed/restore derivation
//! from *outside* the `app_core` crate, over the public use cases
//! ([`get_state`] = lazy first-activation seed, [`restore`] = explicit
//! re-derivation, [`set_item_state`] = manual settle) against a real in-memory
//! `SQLite` DB with real migrations. Fixtures are raw inserts into the domain
//! tables the milestone queries read (`inbox_items`, `projects`,
//! `tool_launches`) — the exact shapes the `persistence_db` repo tests use.
//!
//! Complements the in-crate unit tests in `src/onboarding.rs` (which only
//! exercise the *projects* milestone) by covering the full auto-tick matrix —
//! `inventory.confirmed`, `project.created`, and `tool.launch` — on BOTH the
//! seed and the restore path, plus the prerequisite-independence of milestone
//! derivation.
//!
//! No bus: seed/restore are pure derivations over recorded state. The live
//! auto-tick path (bus event → T005 subscriber → tick) is a separate concern
//! and is NOT covered here.

use app_core::onboarding::{get_state, reconcile_missed_events, restore, set_item_state};
use contracts_core::onboarding::{
    OnboardingItemSetStateRequest, OnboardingItemState, OnboardingManualState, OnboardingStateDto,
    OnboardingStateSource,
};
use sqlx::SqlitePool;

async fn setup_pool() -> SqlitePool {
    let db = persistence_db::Database::in_memory().await.expect("in-memory DB");
    db.migrate().await.expect("migrations");
    db.pool().clone()
}

// ── Fixtures: satisfy a milestone by writing its recorded-state row ───────────

async fn insert_confirmed_inbox_item(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO inbox_items \
            (id, root_id, relative_path, file_count, discovered_at, last_scanned_at, state, lane) \
         VALUES ('item-1', 'root-1', 'a.fits', 1, '2026-07-18T00:00:00Z', \
                 '2026-07-18T00:00:00Z', 'plan_open', 'fits')",
    )
    .execute(pool)
    .await
    .expect("insert confirmed inbox item");
}

async fn insert_project(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO projects (id, name, tool, lifecycle, path, channel_drift, is_mosaic, created_at, updated_at) \
         VALUES ('proj-1', 'Proj 1', 'PixInsight', 'setup_incomplete', 'proj-1', 0, 0, \
                 '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')",
    )
    .execute(pool)
    .await
    .expect("insert project");
}

async fn insert_spawned_tool_launch(pool: &SqlitePool) {
    sqlx::query(
        "INSERT INTO tool_launches (id, project_id, tool_id, launched_at, outcome, audit_id) \
         VALUES ('launch-1', 'proj-1', 'pixinsight', '2026-07-18T00:00:00Z', 'spawned', 'audit-1')",
    )
    .execute(pool)
    .await
    .expect("insert spawned tool launch");
}

fn item_state(state: &OnboardingStateDto, item_id: &str) -> OnboardingItemState {
    state.items.iter().find(|i| i.item_id == item_id).expect("registered item").state
}

async fn dismiss(pool: &SqlitePool, item_id: &str) {
    set_item_state(
        pool,
        &OnboardingItemSetStateRequest {
            item_id: item_id.to_owned(),
            state: OnboardingManualState::Dismissed,
        },
    )
    .await
    .expect("dismiss");
}

// ── Pre-tick on SEED (lazy first activation, PQ-001) ─────────────────────────

#[tokio::test]
async fn seed_pre_ticks_every_met_automatic_milestone() {
    let pool = setup_pool().await;
    insert_confirmed_inbox_item(&pool).await;
    insert_project(&pool).await;
    insert_spawned_tool_launch(&pool).await;

    // First-ever get_state seeds every row; met automatic milestones derive to
    // auto_checked with source=seed (never source=event — that is the bus path).
    let state = get_state(&pool).await.unwrap().state;
    for id in ["inbox.confirm_first", "projects.create_first", "projects.launch_tool"] {
        let item = state.items.iter().find(|i| i.item_id == id).unwrap();
        assert_eq!(item.state, OnboardingItemState::AutoChecked, "{id} met on seed");
        assert_eq!(item.source, OnboardingStateSource::Seed, "{id} seed-derived, not event");
    }
    // An unmet automatic item and every manual item stay unchecked.
    assert_eq!(item_state(&state, "targets.resolve_first"), OnboardingItemState::Unchecked);
    assert_eq!(item_state(&state, "sessions.review_first"), OnboardingItemState::Unchecked);
}

#[tokio::test]
async fn seed_leaves_all_items_unchecked_when_no_milestone_met() {
    let pool = setup_pool().await;
    let state = get_state(&pool).await.unwrap().state;
    assert!(
        state.items.iter().all(|i| i.state == OnboardingItemState::Unchecked),
        "no recorded data → nothing pre-ticked"
    );
    assert_eq!(state.progress.done, 0);
}

/// `target_state_for` derives purely from the item's own `seed_query`; it does
/// not consult the prerequisite. A spawned launch with no project row still
/// pre-ticks `projects.launch_tool`, even though its `projects.create_first`
/// prerequisite is unmet.
#[tokio::test]
async fn seed_pre_ticks_launch_tool_ignoring_unmet_prerequisite() {
    let pool = setup_pool().await;
    insert_spawned_tool_launch(&pool).await; // no project inserted

    let state = get_state(&pool).await.unwrap().state;
    let launch = state.items.iter().find(|i| i.item_id == "projects.launch_tool").unwrap();
    assert_eq!(launch.state, OnboardingItemState::AutoChecked);
    assert!(
        !launch.prerequisite.as_ref().expect("launch_tool has a prerequisite").met,
        "milestone derivation must not depend on prerequisite satisfaction"
    );
    assert_eq!(item_state(&state, "projects.create_first"), OnboardingItemState::Unchecked);
}

// ── Pre-tick on RESTORE (explicit re-derivation, FR-014) ─────────────────────

#[tokio::test]
async fn restore_pre_ticks_milestones_met_after_the_initial_seed() {
    let pool = setup_pool().await;
    // Seed first with no data (all unchecked), then the milestones become met.
    // A plain read must NOT surface them (subscriber-only invariant); only the
    // explicit restore re-derives.
    get_state(&pool).await.unwrap();
    insert_confirmed_inbox_item(&pool).await;
    insert_project(&pool).await;
    insert_spawned_tool_launch(&pool).await;

    let read_only = get_state(&pool).await.unwrap().state;
    assert_eq!(item_state(&read_only, "inbox.confirm_first"), OnboardingItemState::Unchecked);

    let state = restore(&pool).await.unwrap().state;
    for id in ["inbox.confirm_first", "projects.create_first", "projects.launch_tool"] {
        assert_eq!(item_state(&state, id), OnboardingItemState::AutoChecked, "{id} re-derived");
    }
    assert_eq!(item_state(&state, "targets.resolve_first"), OnboardingItemState::Unchecked);
}

#[tokio::test]
async fn restore_leaves_manual_and_dismissed_rows_untouched() {
    let pool = setup_pool().await;
    get_state(&pool).await.unwrap();
    set_item_state(
        &pool,
        &OnboardingItemSetStateRequest {
            item_id: "sessions.review_first".to_owned(),
            state: OnboardingManualState::ManuallyChecked,
        },
    )
    .await
    .unwrap();
    dismiss(&pool, "calibration.review_masters").await;

    // A newly-met automatic milestone must surface, but the two settled manual
    // rows must survive restore verbatim.
    insert_project(&pool).await;
    let state = restore(&pool).await.unwrap().state;

    assert_eq!(item_state(&state, "sessions.review_first"), OnboardingItemState::ManuallyChecked);
    assert_eq!(item_state(&state, "calibration.review_masters"), OnboardingItemState::Dismissed);
    assert_eq!(item_state(&state, "projects.create_first"), OnboardingItemState::AutoChecked);
}

// ── FR-031 settle path + restore unhide ──────────────────────────────────────

#[tokio::test]
async fn settling_the_final_open_item_hides_the_section() {
    let pool = setup_pool().await;
    let state = get_state(&pool).await.unwrap().state;
    let ids: Vec<String> = state.items.iter().map(|i| i.item_id.clone()).collect();

    // Dismiss all but the last; the section stays visible while any item is
    // still unchecked.
    for id in &ids[..ids.len() - 1] {
        dismiss(&pool, id).await;
        assert!(!get_state(&pool).await.unwrap().state.flags.section_hidden);
    }
    // The final settling transition hides the section (FR-031).
    dismiss(&pool, &ids[ids.len() - 1]).await;
    assert!(get_state(&pool).await.unwrap().state.flags.section_hidden);
}

#[tokio::test]
async fn restore_clears_section_hidden() {
    let pool = setup_pool().await;
    let state = get_state(&pool).await.unwrap().state;
    for id in state.items.iter().map(|i| i.item_id.clone()).collect::<Vec<_>>() {
        dismiss(&pool, &id).await;
    }
    assert!(get_state(&pool).await.unwrap().state.flags.section_hidden);

    let restored = restore(&pool).await.unwrap().state;
    assert!(!restored.flags.section_hidden, "restore always unhides (FR-014)");
    // Dismissed rows survive; a still-complete section stays unhidden until a
    // NEW settling transition.
    assert!(restored.items.iter().all(|i| i.state == OnboardingItemState::Dismissed));
}

// ── Idempotence (FR-014, SC-004) ─────────────────────────────────────────────

#[tokio::test]
async fn restore_is_idempotent_across_the_full_milestone_matrix() {
    let pool = setup_pool().await;
    insert_confirmed_inbox_item(&pool).await;
    insert_project(&pool).await;
    insert_spawned_tool_launch(&pool).await;
    get_state(&pool).await.unwrap();

    let first: Vec<_> = restore(&pool)
        .await
        .unwrap()
        .state
        .items
        .iter()
        .map(|i| (i.item_id.clone(), i.state))
        .collect();
    let second: Vec<_> = restore(&pool)
        .await
        .unwrap()
        .state
        .items
        .iter()
        .map(|i| (i.item_id.clone(), i.state))
        .collect();
    assert_eq!(first, second, "repeated restore is a no-op on derived state");
}

// ── Startup reconciliation of missed live events (PQ-005) ────────────────────

async fn set_unchecked(pool: &SqlitePool, item_id: &str) {
    set_item_state(
        pool,
        &OnboardingItemSetStateRequest {
            item_id: item_id.to_owned(),
            state: OnboardingManualState::Unchecked,
        },
    )
    .await
    .expect("un-check");
}

/// The miss being recovered: the milestone really happened (its recorded row
/// exists) but the row was seeded before it, and no live tick ever landed.
#[tokio::test]
async fn reconcile_recovers_a_missed_event() {
    let pool = setup_pool().await;
    let seeded = get_state(&pool).await.unwrap().state;
    assert_eq!(item_state(&seeded, "inbox.confirm_first"), OnboardingItemState::Unchecked);

    insert_confirmed_inbox_item(&pool).await;
    assert_eq!(reconcile_missed_events(&pool).await.unwrap(), 1);

    let state = get_state(&pool).await.unwrap().state;
    assert_eq!(item_state(&state, "inbox.confirm_first"), OnboardingItemState::AutoChecked);
}

#[tokio::test]
async fn reconcile_leaves_a_user_unchecked_automatic_item_alone() {
    let pool = setup_pool().await;
    insert_project(&pool).await;
    let seeded = get_state(&pool).await.unwrap().state;
    assert_eq!(item_state(&seeded, "projects.create_first"), OnboardingItemState::AutoChecked);

    set_unchecked(&pool, "projects.create_first").await;
    assert_eq!(reconcile_missed_events(&pool).await.unwrap(), 0);

    let state = get_state(&pool).await.unwrap().state;
    assert_eq!(item_state(&state, "projects.create_first"), OnboardingItemState::Unchecked);
}

#[tokio::test]
async fn reconcile_leaves_settled_rows_untouched() {
    let pool = setup_pool().await;
    get_state(&pool).await.unwrap();
    dismiss(&pool, "projects.create_first").await;
    set_item_state(
        &pool,
        &OnboardingItemSetStateRequest {
            item_id: "inbox.confirm_first".to_owned(),
            state: OnboardingManualState::Dismissed,
        },
    )
    .await
    .expect("dismiss");

    // Both milestones are now genuinely met — reconciliation must still not
    // rewrite a settled row.
    insert_project(&pool).await;
    insert_confirmed_inbox_item(&pool).await;
    assert_eq!(reconcile_missed_events(&pool).await.unwrap(), 0);

    let state = get_state(&pool).await.unwrap().state;
    assert_eq!(item_state(&state, "projects.create_first"), OnboardingItemState::Dismissed);
    assert_eq!(item_state(&state, "inbox.confirm_first"), OnboardingItemState::Dismissed);
}

/// Manual items (FR-017) have no completion topic, so there is no event for
/// reconciliation to have missed.
#[tokio::test]
async fn reconcile_never_auto_ticks_a_manual_item() {
    let pool = setup_pool().await;
    insert_confirmed_inbox_item(&pool).await;
    insert_project(&pool).await;
    insert_spawned_tool_launch(&pool).await;
    get_state(&pool).await.unwrap();
    reconcile_missed_events(&pool).await.unwrap();

    let state = get_state(&pool).await.unwrap().state;
    for id in ["sessions.review_first", "sessions.add_note", "calibration.review_masters"] {
        assert_eq!(item_state(&state, id), OnboardingItemState::Unchecked, "{id} is manual");
    }
}
