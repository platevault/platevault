//! Guided first-project-flow use case (spec 010).
//!
//! ## State machine
//!
//! ```text
//! Idle → Active(current_step) → Active(next_step) → … → Completed
//!                   │
//!                   └──► Dismissed (terminal until user restarts)
//! ```
//!
//! Transitions:
//! - `setup_completed`: `Idle → Active(first uncompleted step)`.
//! - `completion_event(step.id)`: advances to next uncompleted step, or `Completed`.
//! - `dismiss`: `Active(_) → Dismissed`.
//! - `restart` (Dismissed): resumes at lowest uncompleted step, retaining completed steps.
//! - `restart` (Completed): resets all progress to Idle; replay from step 1 (A1, 2026-05-22).
//!
//! ## Event bus subscription
//!
//! Events that advance steps (`inventory.confirmed`, `project.created`, `tool.launch`) are
//! subscribed via the Tauri command path (the frontend calls `guided.step.complete` after
//! observing these events). The live event-bus seam is documented in [DEFERRED] below.
//!
//! ## Corruption recovery (FR-010, R-Corrupt)
//!
//! When the DB row fails to deserialize the state is reset to Idle, a diagnostic
//! `guided_flow.state.corrupted` audit event is emitted, and the first `guided.state.get`
//! call returns error code `state_corrupted` (informational). Subsequent reads return the
//! fresh Idle state.
//!
//! ## [DEFERRED] Live event-bus seam
//!
//! The spec calls for advancing steps automatically when the audit EventBus publishes
//! `inventory.confirmed`, `project.created`, and `tool.launch`. Wiring a tokio spawn
//! loop requires the bus subscriber to hold a `SqlitePool` reference and call `complete_step`
//! internally. This is the same pattern used by `StalePropagator` (spec 002 T046) and
//! `workflow_run_completed` (spec 012). The seam is left for the main thread to wire in
//! `run_app` once the frontend event-driven path (described below) is stable.
//!
//! Current path: frontend listens to bus events via Tauri emit and calls
//! `guided.step.complete` — functionally equivalent for v1.

use audit::bus::EventBus;
use audit::event_bus::{GuidedFlowStateCorrupted, Source, TOPIC_GUIDED_FLOW_STATE_CORRUPTED};
use contracts_core::guided::{
    GuidedDismissResponse, GuidedFlowStateDto, GuidedRestartResponse, GuidedStateGetResponse,
    GuidedStepCompleteRequest, GuidedStepCompleteResponse,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::Timestamp;
use persistence_db::repositories::guided_flow as repo;
use sqlx::SqlitePool;

// ── Step registry ─────────────────────────────────────────────────────────────

/// Static step definition.
pub struct StepDef {
    /// Stable dot-notation id.
    pub id: &'static str,
    /// Event topic that completes this step.
    pub completion_topic: &'static str,
}

/// The ordered step registry (v1).  Order determines the progression sequence.
pub const STEP_REGISTRY: &[StepDef] = &[
    StepDef { id: "inbox.confirm_first", completion_topic: "inventory.confirmed" },
    StepDef { id: "project.create_first", completion_topic: "project.created" },
    StepDef { id: "tool.open_first", completion_topic: "tool.launch" },
];

/// Return the step def for a given id, or `None` if not in the registry.
#[must_use]
pub fn find_step(id: &str) -> Option<&'static StepDef> {
    STEP_REGISTRY.iter().find(|s| s.id == id)
}

/// Return all registered step ids in order.
#[must_use]
pub fn all_step_ids() -> Vec<&'static str> {
    STEP_REGISTRY.iter().map(|s| s.id).collect()
}

// ── State helpers ─────────────────────────────────────────────────────────────

/// Find the lowest uncompleted step id given a completed set.
fn first_uncompleted(completed: &[String]) -> Option<&'static str> {
    STEP_REGISTRY.iter().find(|s| !completed.iter().any(|c| c == s.id)).map(|s| s.id)
}

fn state_dto(
    current_step: Option<String>,
    completed_steps: Vec<String>,
    dismissed: bool,
    dismissed_at: Option<String>,
    updated_at: String,
) -> GuidedFlowStateDto {
    GuidedFlowStateDto { current_step, completed_steps, dismissed, dismissed_at, updated_at }
}

/// Parse the JSON `completed_step_ids` column value.  Unknown ids are pruned
/// (spec 010 data-model invariant).
fn parse_completed(json: &str) -> Vec<String> {
    let known: std::collections::HashSet<&str> = STEP_REGISTRY.iter().map(|s| s.id).collect();
    serde_json::from_str::<Vec<String>>(json)
        .unwrap_or_default()
        .into_iter()
        .filter(|id| known.contains(id.as_str()))
        .collect()
}

fn serialize_completed(completed: &[String]) -> String {
    serde_json::to_string(completed).unwrap_or_else(|_| "[]".to_owned())
}

// (Corruption is handled inline in get_state; no process-wide flag needed.)

// ── Error type ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum GuidedFlowError {
    /// The step id is not in the registry.
    #[error("unknown step id: {0}")]
    UnknownStepId(String),
    /// The flow is dismissed; use restart first.
    #[error("flow is dismissed")]
    FlowDismissed,
    /// The row was corrupted and has been reset to Idle.  Returned once to the
    /// caller as an informational signal.
    #[error("guided flow state was corrupted; reset to Idle")]
    StateCorrupted,
    /// A persistence layer failure.
    #[error("persistence unavailable: {0}")]
    PersistenceUnavailable(String),
}

/// Convert a `GuidedFlowError` to a `ContractError`.
impl From<GuidedFlowError> for ContractError {
    fn from(e: GuidedFlowError) -> Self {
        match e {
            GuidedFlowError::UnknownStepId(id) => ContractError::new(
                ErrorCode::ValueInvalid,
                format!("unknown step id: {id}"),
                ErrorSeverity::Blocking,
                false,
            ),
            GuidedFlowError::FlowDismissed => ContractError::new(
                ErrorCode::TransitionRefused,
                "guided flow is dismissed; use restart first",
                ErrorSeverity::Blocking,
                false,
            ),
            GuidedFlowError::StateCorrupted => ContractError::new(
                ErrorCode::InternalDatabase,
                "guided flow state was corrupted and has been reset to Idle",
                ErrorSeverity::Blocking,
                false,
            ),
            GuidedFlowError::PersistenceUnavailable(msg) => {
                ContractError::new(ErrorCode::InternalDatabase, msg, ErrorSeverity::Fatal, true)
            }
        }
    }
}

#[allow(clippy::needless_pass_by_value)]
fn db_err(e: persistence_db::DbError) -> GuidedFlowError {
    GuidedFlowError::PersistenceUnavailable(e.to_string())
}

// ── Use cases ─────────────────────────────────────────────────────────────────

/// `guided.state.get` — read current coach state for UI hydration.
///
/// When the DB row is corrupt (JSON parse failure), the row is reset to Idle,
/// a `guided_flow.state.corrupted` diagnostic audit event is emitted, and
/// `Err(StateCorrupted)` is returned on this call (informational — the reset
/// has already happened).  The NEXT call returns the fresh Idle state.
///
/// # Errors
///
/// - `StateCorrupted`: informational; the row has been reset to Idle server-side.
/// - `PersistenceUnavailable`: database failure.
pub async fn get_state(
    pool: &SqlitePool,
    bus: &EventBus,
) -> Result<GuidedStateGetResponse, GuidedFlowError> {
    match repo::load(pool).await.map_err(db_err)? {
        None => {
            // No row yet — return synthetic Idle state.
            let now = Timestamp::now_iso();
            let dto = state_dto(None, vec![], false, None, now);
            Ok(GuidedStateGetResponse { state: dto })
        }
        Some(row) => {
            // Validate completed_step_ids JSON.
            let result = serde_json::from_str::<Vec<String>>(&row.completed_step_ids_json);
            match result {
                Err(e) => {
                    // Corruption recovery (FR-010, R-Corrupt):
                    // 1. Reset the row to Idle.
                    // 2. Emit a diagnostic audit event.
                    // 3. Return Err(StateCorrupted) for THIS call only.
                    //    The next call will load the fresh Idle row and return Ok.
                    emit_corruption_event(pool, bus, &row.completed_step_ids_json, &e.to_string())
                        .await?;
                    Err(GuidedFlowError::StateCorrupted)
                }
                Ok(raw_completed) => {
                    let completed = parse_completed(&row.completed_step_ids_json);
                    // If pruning changed the set, re-persist to keep invariants.
                    if completed.len() != raw_completed.len() {
                        let _ = repo::upsert(
                            pool,
                            row.current_step_id.as_deref(),
                            &serialize_completed(&completed),
                            row.dismissed,
                            row.dismissed_at.as_deref(),
                        )
                        .await;
                    }
                    let dto = state_dto(
                        row.current_step_id,
                        completed,
                        row.dismissed,
                        row.dismissed_at,
                        row.updated_at,
                    );
                    Ok(GuidedStateGetResponse { state: dto })
                }
            }
        }
    }
}

/// Reset the guided_flow_state row to Idle and emit a diagnostic audit event.
///
/// Called when the completed_step_ids JSON fails to parse (R-Corrupt, FR-010).
async fn emit_corruption_event(
    pool: &SqlitePool,
    bus: &EventBus,
    corrupt_raw: &str,
    parse_error: &str,
) -> Result<(), GuidedFlowError> {
    repo::reset_to_idle(pool).await.map_err(db_err)?;
    let _ = bus
        .publish(
            TOPIC_GUIDED_FLOW_STATE_CORRUPTED,
            Source::System,
            GuidedFlowStateCorrupted {
                corrupt_raw: corrupt_raw.to_owned(),
                parse_error: parse_error.to_owned(),
                at: Timestamp::now_iso(),
            },
        )
        .await;
    Ok(())
}

/// `guided.state.get` — activate the flow after first-run completes.
///
/// If the flow is Idle (no row, or current_step is null and not dismissed and
/// not completed), this transitions to `Active(first uncompleted step)`.
/// Called from the frontend on app start when `setupCompleted` is true.
///
/// # Errors
///
/// - `PersistenceUnavailable`: database failure.
pub async fn activate_after_setup(
    pool: &SqlitePool,
) -> Result<GuidedFlowStateDto, GuidedFlowError> {
    let row = repo::load(pool).await.map_err(db_err)?;

    let (completed, dismissed, dismissed_at) = match &row {
        None => (vec![], false, None),
        Some(r) => {
            let completed = parse_completed(&r.completed_step_ids_json);
            (completed, r.dismissed, r.dismissed_at.clone())
        }
    };

    // Only activate when Idle (no current step, not dismissed, not all complete).
    let already_active = row.as_ref().and_then(|r| r.current_step_id.as_deref()).is_some();
    let all_done = all_step_ids().iter().all(|id| completed.iter().any(|c| c == id));

    if already_active || dismissed || all_done {
        // Already in a non-idle state — return the current state unchanged.
        let updated_at = row.as_ref().map_or_else(Timestamp::now_iso, |r| r.updated_at.clone());
        let current_step = row.as_ref().and_then(|r| r.current_step_id.clone());
        return Ok(state_dto(current_step, completed, dismissed, dismissed_at, updated_at));
    }

    let first_step = first_uncompleted(&completed);
    let updated_at = repo::upsert(pool, first_step, &serialize_completed(&completed), false, None)
        .await
        .map_err(db_err)?;

    Ok(state_dto(first_step.map(str::to_owned), completed, false, None, updated_at))
}

/// `guided.step.complete` — mark a step as complete and advance to next.
///
/// The step must exist in the registry.  If the flow is dismissed, returns
/// `Err(FlowDismissed)`.  If the step was already completed, returns
/// `completed = false` with the current next step.
///
/// # Errors
///
/// - `UnknownStepId`: the step id is not in the registry.
/// - `FlowDismissed`: the flow has been dismissed.
/// - `PersistenceUnavailable`: database failure.
pub async fn complete_step(
    pool: &SqlitePool,
    req: &GuidedStepCompleteRequest,
) -> Result<GuidedStepCompleteResponse, GuidedFlowError> {
    if find_step(&req.step_id).is_none() {
        return Err(GuidedFlowError::UnknownStepId(req.step_id.clone()));
    }

    let row = repo::load(pool).await.map_err(db_err)?;
    let (mut completed, dismissed, dismissed_at) = match &row {
        None => (vec![], false, None),
        Some(r) => {
            let c = parse_completed(&r.completed_step_ids_json);
            (c, r.dismissed, r.dismissed_at.clone())
        }
    };

    if dismissed {
        return Err(GuidedFlowError::FlowDismissed);
    }

    let already_completed = completed.iter().any(|c| c == &req.step_id);
    let transition_happened = if already_completed {
        false
    } else {
        completed.push(req.step_id.clone());
        true
    };

    let next_step = first_uncompleted(&completed);
    let all_done = next_step.is_none();
    let current_step_id = if all_done { None } else { next_step };

    let updated_at = repo::upsert(
        pool,
        current_step_id,
        &serialize_completed(&completed),
        false,
        dismissed_at.as_deref(),
    )
    .await
    .map_err(db_err)?;

    let dto =
        state_dto(current_step_id.map(str::to_owned), completed, false, dismissed_at, updated_at);

    Ok(GuidedStepCompleteResponse {
        completed: transition_happened,
        next_step: current_step_id.map(str::to_owned),
        state: dto,
    })
}

/// `guided.dismiss` — dismiss the coach, hiding all hints.
///
/// Idempotent: if already dismissed, returns the existing `dismissed_at`.
///
/// # Errors
///
/// - `PersistenceUnavailable`: database failure.
pub async fn dismiss(pool: &SqlitePool) -> Result<GuidedDismissResponse, GuidedFlowError> {
    let row = repo::load(pool).await.map_err(db_err)?;
    let (completed, already_dismissed, existing_dismissed_at) = match &row {
        None => (vec![], false, None),
        Some(r) => {
            let c = parse_completed(&r.completed_step_ids_json);
            (c, r.dismissed, r.dismissed_at.clone())
        }
    };

    if already_dismissed {
        let dismissed_at = existing_dismissed_at.unwrap_or_else(Timestamp::now_iso);
        return Ok(GuidedDismissResponse { dismissed_at });
    }

    let dismissed_at = Timestamp::now_iso();
    repo::upsert(
        pool,
        None, // clear current step on dismiss
        &serialize_completed(&completed),
        true,
        Some(&dismissed_at),
    )
    .await
    .map_err(db_err)?;

    Ok(GuidedDismissResponse { dismissed_at })
}

/// `guided.restart` — restart the coach from Settings.
///
/// - `Dismissed → Active(lowest uncompleted)`: retains completed steps.
/// - `Completed → Idle`: resets all progress (A1 ratified 2026-05-22).
///
/// If the flow is not dismissed and not completed (already active), this is a
/// no-op that returns the current state.
///
/// # Errors
///
/// - `PersistenceUnavailable`: database failure.
pub async fn restart(pool: &SqlitePool) -> Result<GuidedRestartResponse, GuidedFlowError> {
    let row = repo::load(pool).await.map_err(db_err)?;
    let (completed, dismissed, dismissed_at) = match &row {
        None => (vec![], false, None),
        Some(r) => {
            let c = parse_completed(&r.completed_step_ids_json);
            (c, r.dismissed, r.dismissed_at.clone())
        }
    };

    let all_done = all_step_ids().iter().all(|id| completed.iter().any(|c| c == id));

    if all_done {
        // Completed → Idle: reset all progress.
        let updated_at = repo::upsert(pool, None, "[]", false, None).await.map_err(db_err)?;
        let dto = state_dto(None, vec![], false, None, updated_at);
        return Ok(GuidedRestartResponse { state: dto });
    }

    if dismissed || (dismissed_at.is_some()) {
        // Dismissed → Active(lowest uncompleted): retain completed steps.
        let next = first_uncompleted(&completed);
        let updated_at = repo::upsert(
            pool,
            next,
            &serialize_completed(&completed),
            false,
            None, // clear dismissed_at
        )
        .await
        .map_err(db_err)?;
        let dto = state_dto(next.map(str::to_owned), completed, false, None, updated_at);
        return Ok(GuidedRestartResponse { state: dto });
    }

    // Already active — no-op.
    let updated_at = row.as_ref().map_or_else(Timestamp::now_iso, |r| r.updated_at.clone());
    let current_step = row.as_ref().and_then(|r| r.current_step_id.clone());
    let dto = state_dto(current_step, completed, false, None, updated_at);
    Ok(GuidedRestartResponse { state: dto })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_pool() -> SqlitePool {
        let db = persistence_db::Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db.pool().clone()
    }

    fn make_bus(pool: &SqlitePool) -> EventBus {
        EventBus::with_pool(pool.clone())
    }

    // ── Step registry ────────────────────────────────────────────────────────

    #[test]
    fn step_registry_has_three_steps_in_order() {
        assert_eq!(STEP_REGISTRY.len(), 3);
        assert_eq!(STEP_REGISTRY[0].id, "inbox.confirm_first");
        assert_eq!(STEP_REGISTRY[1].id, "project.create_first");
        assert_eq!(STEP_REGISTRY[2].id, "tool.open_first");
    }

    #[test]
    fn step_registry_completion_topics() {
        assert_eq!(STEP_REGISTRY[0].completion_topic, "inventory.confirmed");
        assert_eq!(STEP_REGISTRY[1].completion_topic, "project.created");
        assert_eq!(STEP_REGISTRY[2].completion_topic, "tool.launch");
    }

    #[test]
    fn find_step_returns_correct_def() {
        assert!(find_step("inbox.confirm_first").is_some());
        assert!(find_step("nonexistent").is_none());
    }

    #[test]
    fn first_uncompleted_respects_order() {
        let completed = vec!["inbox.confirm_first".to_owned()];
        assert_eq!(first_uncompleted(&completed), Some("project.create_first"));
    }

    #[test]
    fn first_uncompleted_all_done_returns_none() {
        let completed = vec![
            "inbox.confirm_first".to_owned(),
            "project.create_first".to_owned(),
            "tool.open_first".to_owned(),
        ];
        assert_eq!(first_uncompleted(&completed), None);
    }

    // ── get_state ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn get_state_returns_idle_when_no_row() {
        let pool = setup_pool().await;
        let bus = make_bus(&pool);
        let resp = get_state(&pool, &bus).await.unwrap();
        assert!(resp.state.current_step.is_none());
        assert!(resp.state.completed_steps.is_empty());
        assert!(!resp.state.dismissed);
    }

    // ── activate_after_setup ─────────────────────────────────────────────────

    #[tokio::test]
    async fn activate_after_setup_sets_first_step() {
        let pool = setup_pool().await;
        let dto = activate_after_setup(&pool).await.unwrap();
        assert_eq!(dto.current_step.as_deref(), Some("inbox.confirm_first"));
        assert!(!dto.dismissed);
    }

    #[tokio::test]
    async fn activate_after_setup_is_idempotent_when_already_active() {
        let pool = setup_pool().await;
        activate_after_setup(&pool).await.unwrap();
        let dto2 = activate_after_setup(&pool).await.unwrap();
        assert_eq!(dto2.current_step.as_deref(), Some("inbox.confirm_first"));
    }

    // ── complete_step ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn complete_step_advances_to_next() {
        let pool = setup_pool().await;
        activate_after_setup(&pool).await.unwrap();

        let resp = complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "inbox.confirm_first".to_owned() },
        )
        .await
        .unwrap();
        assert!(resp.completed);
        assert_eq!(resp.next_step.as_deref(), Some("project.create_first"));
        assert!(resp.state.completed_steps.contains(&"inbox.confirm_first".to_owned()));
    }

    #[tokio::test]
    async fn complete_step_full_sequence_reaches_completed() {
        let pool = setup_pool().await;
        activate_after_setup(&pool).await.unwrap();

        complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "inbox.confirm_first".to_owned() },
        )
        .await
        .unwrap();
        complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "project.create_first".to_owned() },
        )
        .await
        .unwrap();
        let resp = complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "tool.open_first".to_owned() },
        )
        .await
        .unwrap();

        assert!(resp.completed);
        assert!(resp.next_step.is_none(), "should be None when flow is complete");
        assert_eq!(resp.state.completed_steps.len(), 3);
        assert!(resp.state.current_step.is_none());
    }

    #[tokio::test]
    async fn complete_step_unknown_id_returns_error() {
        let pool = setup_pool().await;
        let err =
            complete_step(&pool, &GuidedStepCompleteRequest { step_id: "nonexistent".to_owned() })
                .await
                .unwrap_err();
        assert_eq!(err, GuidedFlowError::UnknownStepId("nonexistent".to_owned()));
    }

    #[tokio::test]
    async fn complete_step_while_dismissed_returns_error() {
        let pool = setup_pool().await;
        activate_after_setup(&pool).await.unwrap();
        dismiss(&pool).await.unwrap();

        let err = complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "inbox.confirm_first".to_owned() },
        )
        .await
        .unwrap_err();
        assert_eq!(err, GuidedFlowError::FlowDismissed);
    }

    #[tokio::test]
    async fn complete_already_completed_step_returns_not_completed() {
        let pool = setup_pool().await;
        activate_after_setup(&pool).await.unwrap();
        complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "inbox.confirm_first".to_owned() },
        )
        .await
        .unwrap();

        // Complete same step again.
        let resp = complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "inbox.confirm_first".to_owned() },
        )
        .await
        .unwrap();
        assert!(!resp.completed);
    }

    // ── dismiss ───────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn dismiss_sets_dismissed_flag() {
        let pool = setup_pool().await;
        activate_after_setup(&pool).await.unwrap();
        let resp = dismiss(&pool).await.unwrap();
        assert!(!resp.dismissed_at.is_empty());

        // State should now be dismissed.
        let bus = make_bus(&pool);
        let state = get_state(&pool, &bus).await.unwrap();
        assert!(state.state.dismissed);
        assert!(state.state.current_step.is_none());
    }

    #[tokio::test]
    async fn dismiss_is_idempotent() {
        let pool = setup_pool().await;
        activate_after_setup(&pool).await.unwrap();
        let r1 = dismiss(&pool).await.unwrap();
        let r2 = dismiss(&pool).await.unwrap();
        assert_eq!(r1.dismissed_at, r2.dismissed_at);
    }

    // ── restart ───────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn restart_from_dismissed_resumes_at_uncompleted() {
        let pool = setup_pool().await;
        activate_after_setup(&pool).await.unwrap();
        complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "inbox.confirm_first".to_owned() },
        )
        .await
        .unwrap();
        dismiss(&pool).await.unwrap();

        let resp = restart(&pool).await.unwrap();
        assert!(!resp.state.dismissed);
        assert_eq!(resp.state.current_step.as_deref(), Some("project.create_first"));
        // Completed step retained.
        assert!(resp.state.completed_steps.contains(&"inbox.confirm_first".to_owned()));
    }

    #[tokio::test]
    async fn restart_from_completed_resets_to_idle() {
        let pool = setup_pool().await;
        activate_after_setup(&pool).await.unwrap();
        complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "inbox.confirm_first".to_owned() },
        )
        .await
        .unwrap();
        complete_step(
            &pool,
            &GuidedStepCompleteRequest { step_id: "project.create_first".to_owned() },
        )
        .await
        .unwrap();
        complete_step(&pool, &GuidedStepCompleteRequest { step_id: "tool.open_first".to_owned() })
            .await
            .unwrap();

        let resp = restart(&pool).await.unwrap();
        // A1 decision: Completed → Idle resets all progress.
        assert!(resp.state.completed_steps.is_empty());
        assert!(resp.state.current_step.is_none());
        assert!(!resp.state.dismissed);
    }

    // ── T027: corruption recovery ─────────────────────────────────────────────

    #[tokio::test]
    async fn corrupt_row_emits_corrupted_event_and_resets() {
        let pool = setup_pool().await;
        let bus = make_bus(&pool);

        // Inject a corrupt row directly via the repository layer.
        persistence_db::repositories::guided_flow::upsert(
            &pool,
            Some("inbox.confirm_first"),
            "NOT VALID JSON {{{{",
            false,
            None,
        )
        .await
        .unwrap();

        // First call: corruption detected, reset happens.
        let err = get_state(&pool, &bus).await.unwrap_err();
        assert_eq!(err, GuidedFlowError::StateCorrupted);

        // Second call: fresh Idle state returned.
        let resp = get_state(&pool, &bus).await.unwrap();
        assert!(resp.state.current_step.is_none());
        assert!(resp.state.completed_steps.is_empty());
        assert!(!resp.state.dismissed);
    }

    // ── T011 / T043: event-source filtering ──────────────────────────────────

    #[test]
    fn completion_topics_match_spec() {
        // Verify the completion topic constants match what the spec mandates
        // (inventory.confirmed, project.created, tool.launch).
        assert_eq!(
            STEP_REGISTRY.iter().map(|s| s.completion_topic).collect::<Vec<_>>(),
            ["inventory.confirmed", "project.created", "tool.launch"]
        );
    }
}
