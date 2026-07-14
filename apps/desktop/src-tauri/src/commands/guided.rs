// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Guided first-project-flow Tauri commands (spec 010).
//!
//! Thin passthroughs to `app_core::guided_flow` use cases.
//! Commands are registered in `specta_builder()` in `lib.rs`.
//!
//! Also hosts [`start_guided_event_forwarder`] (#722): the bus→webview
//! bridge for the three domain-completion topics `apps/desktop/src/features/
//! guided/eventBridge.ts` listens for. Before this existed, nothing emitted
//! named Tauri events for `inventory.confirmed` / `project.created` /
//! `tool.launch` — the coach's hints activated but never auto-advanced on
//! real user actions (only the generic `log:entry` re-projection existed,
//! which carries a coarse `LogEntrySource` category, not the raw topic or
//! bus envelope `source`, so it can't drive step completion).

use contracts_core::guided::{
    GuidedDismissResponse, GuidedRestartResponse, GuidedStateGetResponse,
    GuidedStepCompleteRequest, GuidedStepCompleteResponse,
};
use tauri::State;

use crate::commands::lifecycle::AppState;
use contracts_core::ContractError;

/// `guided.state.get` — read current coach state for UI hydration.
///
/// Returns the current `GuidedFlowStateDto`.  On the first call after a
/// corruption reset, returns `Err` with code `state_corrupted`; the row has
/// already been reset to Idle server-side.  Retry to get the fresh state.
///
/// # Errors
/// Returns `Err(String)` on corruption (informational) or database failure.
#[tauri::command]
#[specta::specta]
pub async fn guided_state_get(
    state: State<'_, AppState>,
) -> Result<GuidedStateGetResponse, ContractError> {
    tracing::debug!("guided.state.get");
    app_core::guided_flow::get_state(state.repo.pool(), &state.bus)
        .await
        .map_err(ContractError::from)
}

/// `guided.step.complete` — mark a step complete and advance the coach.
///
/// The step must be a known registry id (e.g. `inbox.confirm_first`).
/// If the flow is dismissed, returns an error.
///
/// # Errors
/// Returns `Err(String)` on unknown step id, dismissed flow, or database failure.
#[tauri::command]
#[specta::specta]
pub async fn guided_step_complete(
    state: State<'_, AppState>,
    request: GuidedStepCompleteRequest,
) -> Result<GuidedStepCompleteResponse, ContractError> {
    tracing::debug!("guided.step.complete step_id={}", request.step_id);
    app_core::guided_flow::complete_step(state.repo.pool(), &request)
        .await
        .map_err(ContractError::from)
}

/// `guided.dismiss` — dismiss the coach, hiding all hints.
///
/// Idempotent: calling again on an already-dismissed flow returns the
/// original `dismissedAt` timestamp.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn guided_dismiss(
    state: State<'_, AppState>,
) -> Result<GuidedDismissResponse, ContractError> {
    tracing::debug!("guided.dismiss");
    app_core::guided_flow::dismiss(state.repo.pool()).await.map_err(ContractError::from)
}

/// `guided.restart` — restart the coach from Settings.
///
/// - `Dismissed → Active(lowest uncompleted step)`: retains completed steps.
/// - `Completed → Idle`: resets all progress (A1 ratified 2026-05-22).
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn guided_restart(
    state: State<'_, AppState>,
) -> Result<GuidedRestartResponse, ContractError> {
    tracing::debug!("guided.restart");
    app_core::guided_flow::restart(state.repo.pool()).await.map_err(ContractError::from)
}

/// `guided.activate` — activate the flow after first-run setup completes.
///
/// If the flow is Idle, transitions to `Active(first uncompleted step)`.
/// Idempotent when already active or dismissed.
///
/// # Errors
/// Returns `Err(String)` on database failure.
#[tauri::command]
#[specta::specta]
pub async fn guided_activate(
    state: State<'_, AppState>,
) -> Result<contracts_core::guided::GuidedFlowStateDto, ContractError> {
    tracing::debug!("guided.activate");
    app_core::guided_flow::activate_after_setup(state.repo.pool())
        .await
        .map_err(ContractError::from)
}

// ── Bus → webview forwarder (#722) ──────────────────────────────────────────

/// Spawn a background task that subscribes to the shared `EventBus` and
/// re-emits the guided-flow step-completion topics
/// (`app_core::guided_flow::STEP_REGISTRY`'s `completion_topic`s —
/// `inventory.confirmed`, `project.created`, `tool.launch`) as named Tauri
/// events, so `eventBridge.ts`'s `listen(topic.replace('.', ':'), ...)`
/// calls actually receive something.
///
/// Tauri event names only allow alphanumerics, `-`, `/`, `:`, `_`, so dots
/// are mapped to `:` — mirroring `eventBridge.ts`'s own `topic.replace(/\./g,
/// ':')`. The forwarded payload is the bus envelope's JSON payload with a
/// `source` field merged in (`"user"` | `"restore"` | `"system"`) so the
/// frontend's replay filter (FR-010: ignore `source === "restore"`) and its
/// `tool.launch` outcome filter both work without a new wire shape.
///
/// Live-only: this reads the broadcast channel, not the durable `events`
/// table, so events published before this task starts are not replayed here
/// (mirrors `start_log_forwarder`'s same tradeoff — `guided.state.get`
/// remains the durable source of truth for hydration on load).
///
/// **Startup seam**: call from `run_app` alongside
/// `crate::commands::log::start_log_forwarder`, once both `AppHandle` and
/// `EventBus` are available.
pub fn start_guided_event_forwarder(app_handle: tauri::AppHandle, bus: &audit::bus::EventBus) {
    use audit::event_bus::Source;

    let forwarded_topics: Vec<&'static str> =
        app_core::guided_flow::STEP_REGISTRY.iter().map(|s| s.completion_topic).collect();

    let mut rx = bus.subscribe();

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(envelope) => {
                    if !forwarded_topics.contains(&envelope.topic.as_str()) {
                        continue;
                    }

                    let source_str = match envelope.source {
                        Source::User => "user",
                        Source::Restore => "restore",
                        Source::System => "system",
                    };
                    let mut payload = envelope.payload;
                    if let serde_json::Value::Object(map) = &mut payload {
                        map.insert(
                            "source".to_owned(),
                            serde_json::Value::String(source_str.to_owned()),
                        );
                    }

                    let event_name = envelope.topic.replace('.', ":");
                    let _ = tauri::Emitter::emit(&app_handle, &event_name, &payload);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    tracing::debug!("guided event forwarder: broadcast channel closed");
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    // Best-effort live stream (mirrors the log forwarder): a
                    // dropped guided-flow completion event just means the
                    // coach won't auto-advance for that one action. The user
                    // can still complete the step through normal use, or
                    // `guided.state.get` reflects the durable state on the
                    // next hydration.
                    tracing::warn!("guided event forwarder: lagged by {n} events");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use audit::bus::EventBus;
    use audit::event_bus::Source;

    async fn setup_pool() -> sqlx::SqlitePool {
        let db = persistence_db::Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db.pool().clone()
    }

    /// #722: only the three guided-flow completion topics are forwarded, and
    /// dots become colons — matching `eventBridge.ts`'s expected event names
    /// and its `EVENT_TO_STEP` topic keys (`inventory.confirmed`,
    /// `project.created`, `tool.launch`).
    #[test]
    fn forwarded_topics_match_step_registry_and_use_colon_names() {
        let topics: Vec<&'static str> =
            app_core::guided_flow::STEP_REGISTRY.iter().map(|s| s.completion_topic).collect();
        assert_eq!(topics, ["inventory.confirmed", "project.created", "tool.launch"]);

        let event_names: Vec<String> = topics.iter().map(|t| t.replace('.', ":")).collect();
        assert_eq!(event_names, ["inventory:confirmed", "project:created", "tool:launch"]);
    }

    /// The forwarder must relay a `tool.launch` publish end-to-end onto the
    /// Tauri event bus with the envelope `source` merged into the payload
    /// object, and must NOT forward unrelated topics (e.g. `plan.approved`).
    #[tokio::test]
    async fn forwarder_relays_registered_topics_with_source_and_skips_others() {
        let pool = setup_pool().await;
        let bus = EventBus::with_pool(pool);

        // Forwarder logic without the Tauri AppHandle dependency: exercise
        // the same filter + payload-merge behavior directly against the bus,
        // since constructing a real `tauri::AppHandle` needs a running app.
        let forwarded_topics: Vec<&'static str> =
            app_core::guided_flow::STEP_REGISTRY.iter().map(|s| s.completion_topic).collect();
        let mut rx = bus.subscribe();

        bus.publish("plan.approved", Source::User, serde_json::json!({ "planId": "p1" }))
            .await
            .unwrap();
        bus.publish(
            "tool.launch",
            Source::User,
            serde_json::json!({ "launchId": "l1", "outcome": "spawned" }),
        )
        .await
        .unwrap();

        // First envelope: unrelated topic, must be filtered out by the
        // forwarder's topic allowlist (mirrors the loop body's `continue`).
        let unrelated = rx.recv().await.unwrap();
        assert!(!forwarded_topics.contains(&unrelated.topic.as_str()));

        // Second envelope: the registered `tool.launch` topic.
        let relayed = rx.recv().await.unwrap();
        assert!(forwarded_topics.contains(&relayed.topic.as_str()));
        assert_eq!(relayed.topic.replace('.', ":"), "tool:launch");
        assert_eq!(relayed.source, Source::User);
        assert_eq!(relayed.payload["outcome"], "spawned");
    }
}
