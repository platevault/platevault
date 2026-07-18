// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Onboarding Tauri commands + backend-authoritative tick subscriber (spec 056).
//!
//! Thin passthroughs to `app_core::onboarding` use cases (registered in
//! `specta_builder()` in `lib.rs` under their Rust fn names — never renamed,
//! so the generated invoke strings match the Tauri registration).
//!
//! Also hosts [`start_onboarding_subscriber`]: the bus→persistence tick bridge
//! (research R5). Unlike the removed spec-010 forwarder (which only
//! *re-emitted* topics for the webview to act on), this subscriber is
//! backend-authoritative — it maps each domain-completion topic to its
//! registry item, applies the item's payload filter, persists the tick
//! directly via `app_core::onboarding::tick_from_event`, then emits a single
//! `onboarding:state-changed` hint. This keeps `auto_checked` unreachable from
//! any command or mock-mode UI (FR-021): only real bus events tick.

use contracts_core::onboarding::{
    OnboardingItemSetStateRequest, OnboardingItemSetStateResponse,
    OnboardingOrientationCompleteRequest, OnboardingOrientationCompleteResponse,
    OnboardingRestoreResponse, OnboardingSectionSetRequest, OnboardingSectionSetResponse,
    OnboardingStateChangedEvent, OnboardingStateGetResponse,
};
use contracts_core::ContractError;
use tauri::State;

use crate::commands::lifecycle::AppState;

/// The Tauri notification emitted after any persisted tick. A hint only — the
/// frontend re-reads full state via `onboarding.state.get`.
const EVENT_STATE_CHANGED: &str = "onboarding:state-changed";

// ── Commands ────────────────────────────────────────────────────────────────

/// `onboarding.state.get` — read the full projection for UI hydration.
///
/// # Errors
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn onboarding_state_get(
    state: State<'_, AppState>,
) -> Result<OnboardingStateGetResponse, ContractError> {
    tracing::debug!("onboarding.state.get");
    app_core::onboarding::get_state(state.repo.pool()).await.map_err(ContractError::from)
}

/// `onboarding.item.set_state` — manual check-off or dismiss (FR-017).
///
/// # Errors
/// Returns `Err(ContractError)` on unknown item id or database failure.
#[tauri::command]
#[specta::specta]
pub async fn onboarding_item_set_state(
    state: State<'_, AppState>,
    request: OnboardingItemSetStateRequest,
) -> Result<OnboardingItemSetStateResponse, ContractError> {
    tracing::debug!("onboarding.item.set_state item_id={}", request.item_id);
    app_core::onboarding::set_item_state(state.repo.pool(), &request)
        .await
        .map_err(ContractError::from)
}

/// `onboarding.orientation.complete` — mark the L1 walk finished/skipped
/// (both set done-forever, FR-004). Idempotent.
///
/// # Errors
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn onboarding_orientation_complete(
    state: State<'_, AppState>,
    request: OnboardingOrientationCompleteRequest,
) -> Result<OnboardingOrientationCompleteResponse, ContractError> {
    tracing::debug!("onboarding.orientation.complete");
    app_core::onboarding::orientation_complete(state.repo.pool(), &request)
        .await
        .map_err(ContractError::from)
}

/// `onboarding.section.set` — explicit remove (FR-013) + collapse persistence
/// (FR-012). `hidden` accepts only `true`; unhiding is exclusively
/// `onboarding.restore`.
///
/// # Errors
/// Returns `Err(ContractError)` on an empty/`hidden: false` request or database
/// failure.
#[tauri::command]
#[specta::specta]
pub async fn onboarding_section_set(
    state: State<'_, AppState>,
    request: OnboardingSectionSetRequest,
) -> Result<OnboardingSectionSetResponse, ContractError> {
    tracing::debug!("onboarding.section.set");
    app_core::onboarding::section_set(state.repo.pool(), &request)
        .await
        .map_err(ContractError::from)
}

/// `onboarding.restore` — the single Settings → Advanced restore/reset
/// (FR-014). Re-derives AUTOMATIC items from recorded data; user progress is
/// preserved. Idempotent.
///
/// # Errors
/// Returns `Err(ContractError)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn onboarding_restore(
    state: State<'_, AppState>,
) -> Result<OnboardingRestoreResponse, ContractError> {
    tracing::debug!("onboarding.restore");
    app_core::onboarding::restore(state.repo.pool()).await.map_err(ContractError::from)
}

// ── Bus → persistence tick subscriber (research R5) ─────────────────────────

/// Pure topic→item resolution: the registry items a live event on `topic`
/// with `payload` should tick (applying each item's `payload_filter`). Split
/// out from the subscriber loop so it is unit-testable without a running
/// Tauri app. Envelope-`source` filtering (FR-016) happens in the loop, not
/// here — it is a property of the envelope, not the topic/payload.
fn ticked_item_ids(topic: &str, payload: &serde_json::Value) -> Vec<&'static str> {
    app_core::onboarding::ITEM_REGISTRY
        .iter()
        .filter_map(|item| {
            if item.completion_topic? != topic {
                return None;
            }
            if let Some(filter) = item.payload_filter {
                if !filter(payload) {
                    return None;
                }
            }
            Some(item.item_id)
        })
        .collect()
}

/// Spawn the backend-authoritative onboarding tick subscriber (research R5).
///
/// Subscribes to the shared `EventBus`, and for every live envelope whose
/// `source` is not `restore` (FR-016), persists a tick for each registry item
/// its topic+payload match, then emits `onboarding:state-changed`. Ticks are
/// idempotent and never downgrade a settled item (handled in
/// `app_core::onboarding::tick_from_event`).
///
/// **Startup seam**: call from `run_app` alongside the other bus subscribers,
/// once both `AppHandle` and `EventBus` exist and BEFORE the webview can
/// invoke (PQ-005 ordering).
///
/// Live-only: reads the broadcast channel, not the durable `events` table, so
/// events published before this task starts are not replayed here —
/// `onboarding.state.get`'s seed derivation is the durable source of truth for
/// pre-existing milestones (mirrors `start_log_forwarder`'s tradeoff).
pub fn start_onboarding_subscriber<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    pool: sqlx::SqlitePool,
    bus: &audit::bus::EventBus,
) {
    use audit::event_bus::Source;

    let mut rx = bus.subscribe();

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(envelope) => {
                    // FR-016: replayed history must never tick, regardless of
                    // frontend state — filtered server-side here.
                    if envelope.source == Source::Restore {
                        continue;
                    }
                    for item_id in ticked_item_ids(&envelope.topic, &envelope.payload) {
                        if let Err(e) = app_core::onboarding::tick_from_event(&pool, item_id).await
                        {
                            tracing::warn!("onboarding tick for {item_id} failed: {e}");
                            continue;
                        }
                        // Hint only; the frontend re-reads full state. Emit
                        // unconditionally on a match — a redundant hint against
                        // an already-settled item is harmless.
                        let _ = tauri::Emitter::emit(
                            &app_handle,
                            EVENT_STATE_CHANGED,
                            &OnboardingStateChangedEvent { item_id: Some(item_id.to_owned()) },
                        );
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    tracing::debug!("onboarding subscriber: broadcast channel closed");
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    // Best-effort live stream (mirrors the log forwarder): a
                    // dropped completion event just means that one auto-tick is
                    // missed live; `onboarding.state.get`'s seed derivation
                    // still surfaces the milestone on the next hydration.
                    tracing::warn!("onboarding subscriber: lagged by {n} events");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_topic_to_registry_item() {
        let ids = ticked_item_ids("inventory.confirmed", &serde_json::json!({}));
        assert_eq!(ids, ["inbox.confirm_first"]);
    }

    #[test]
    fn unrelated_topic_ticks_nothing() {
        assert!(ticked_item_ids("plan.approved", &serde_json::json!({})).is_empty());
    }

    #[test]
    fn tool_launch_requires_spawned_outcome() {
        assert_eq!(
            ticked_item_ids("tool.launch", &serde_json::json!({ "outcome": "spawned" })),
            ["projects.launch_tool"]
        );
        assert!(ticked_item_ids("tool.launch", &serde_json::json!({ "outcome": "spawn_failed" }))
            .is_empty());
        assert!(ticked_item_ids("tool.launch", &serde_json::json!({})).is_empty());
    }
}
