// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `transition_lifecycle` — the shared lifecycle write-primitive.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! This is intentionally a thin, **un-gated** primitive: it CAS-writes a
//! lifecycle transition and publishes `lifecycle.transition.applied`. It does
//! NOT enforce business rules.
//!
//! Business-rule enforcement (edge legality, actor/blocked gate, provenance
//! review gate, plan-requirement gate) lives one layer up in
//! [`crate::transition_use_case::apply_transition`], which is what the
//! `lifecycle.transition.apply` command calls. `apply_transition` runs every
//! gate and only then reaches this primitive.
//!
//! The one caller that reaches this primitive directly, bypassing the gates,
//! is the archive-closure path (`app_core::plan_apply::finalize_archive_lifecycle`):
//! there the `completed → archived` plan was already reviewed, approved, and
//! applied, so re-running the requires-plan gate would wrongly refuse it. That
//! bypass is deliberate and documented at the call site.

use audit::bus::EventBus;
use audit::event_bus::{LifecycleTransitionApplied, Source, TOPIC_LIFECYCLE_TRANSITION_APPLIED};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use persistence_lifecycle::repositories::lifecycle::{
    LifecycleRepository, TransitionRecord, TransitionRequest,
};

/// Error type for the lifecycle use case.
#[derive(Debug, thiserror::Error)]
pub enum LifecycleError {
    #[error("transition refused: {0}")]
    Refused(String),
    #[error("entity not found: {entity_id}")]
    NotFound { entity_id: EntityId },
    #[error("persistence error: {0}")]
    Persistence(#[from] persistence_core::DbError),
}

/// Inputs for the `transition_lifecycle` use case.
#[derive(Clone, Debug)]
pub struct TransitionCommand {
    pub entity_id: EntityId,
    pub entity_type: EntityType,
    pub from_state: String,
    pub to_state: String,
    pub trigger: String,
    pub actor: String,
    pub request_id: EntityId,
}

/// Apply a lifecycle transition via the repository, then publish an event.
///
/// Un-gated by design: this primitive assumes the caller already validated the
/// transition (edge legality, actor, provenance, plan requirement). Callers
/// reaching business rules must go through
/// [`crate::transition_use_case::apply_transition`]; the archive-closure path
/// is the one deliberate exception (see the module docs).
///
/// Returns `Ok(None)` when `from_state == to_state` (noop — no audit row, no event).
///
/// # Errors
/// - `LifecycleError::Persistence` on repository failure (including the atomic
///   CAS in `record_transition` rejecting a stale `from_state`).
pub async fn transition_lifecycle<R>(
    repo: &R,
    bus: &EventBus,
    cmd: TransitionCommand,
) -> Result<Option<TransitionRecord>, LifecycleError>
where
    R: LifecycleRepository + Sync,
{
    // Noop: caller-requested next_state equals current_state.
    if cmd.from_state == cmd.to_state {
        return Ok(None);
    }

    let record = repo
        .record_transition(TransitionRequest {
            entity_id: cmd.entity_id,
            entity_type: cmd.entity_type,
            from_state: cmd.from_state.clone(),
            to_state: cmd.to_state.clone(),
            trigger: cmd.trigger,
            actor: cmd.actor.clone(),
            request_id: cmd.request_id,
        })
        .await?;

    // FR-003 (#713): trivial project_id resolution — this primitive has no
    // pool access to look up a non-Project entity's owning project (that
    // lookup lives in `SqliteLifecycleRepository::record_transition`, which
    // publishes its own `lifecycle.transition.applied` with the fully
    // resolved value); `None` here is a StalePropagator no-op, not a bug.
    let project_id = (cmd.entity_type == EntityType::Project).then(|| cmd.entity_id.to_string());

    // Publish event (durable write to `events` table + live broadcast).
    let _ = bus
        .publish(
            TOPIC_LIFECYCLE_TRANSITION_APPLIED,
            Source::User,
            LifecycleTransitionApplied {
                entity_type: cmd.entity_type,
                entity_id: cmd.entity_id.to_string(),
                from_state: cmd.from_state,
                to_state: cmd.to_state,
                actor: cmd.actor,
                at: record.applied_at,
                project_id,
            },
        )
        .await;

    Ok(Some(record))
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_lifecycle::repositories::lifecycle::InMemoryLifecycleRepository;

    async fn test_bus() -> EventBus {
        let pool =
            sqlx::SqlitePool::connect("sqlite::memory:").await.expect("in-memory pool for test");
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS events (\
             event_id INTEGER PRIMARY KEY AUTOINCREMENT,\
             topic TEXT NOT NULL,\
             source TEXT NOT NULL,\
             emitted_at TEXT NOT NULL,\
             payload TEXT NOT NULL\
             )",
        )
        .execute(&pool)
        .await
        .expect("create events table");
        EventBus::with_pool(pool)
    }

    #[tokio::test]
    async fn noop_returns_none_without_persisting() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;
        let mut rx = bus.subscribe();

        let result = transition_lifecycle(
            &repo,
            &bus,
            TransitionCommand {
                entity_id: EntityId::new(),
                entity_type: EntityType::Project,
                from_state: "ready".to_owned(),
                to_state: "ready".to_owned(),
                trigger: "No-op".to_owned(),
                actor: "user".to_owned(),
                request_id: EntityId::new(),
            },
        )
        .await
        .unwrap();

        assert!(result.is_none());
        // "Without persisting": the noop guard must short-circuit before the
        // repository write AND before the event publish. InMemoryLifecycleRepository
        // has no inspectable state (it would even return Err for from==to if
        // record_transition were reached), so the bus is the only observable
        // side channel proving the guard fired before any write.
        assert!(
            rx.try_recv().is_err(),
            "noop transition must not publish lifecycle.transition.applied"
        );
    }

    #[tokio::test]
    async fn successful_transition_returns_record_and_publishes_event() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;
        let mut rx = bus.subscribe();

        let record = transition_lifecycle(
            &repo,
            &bus,
            TransitionCommand {
                entity_id: EntityId::new(),
                entity_type: EntityType::Project,
                from_state: "ready".to_owned(),
                to_state: "processing".to_owned(),
                trigger: "Started processing".to_owned(),
                actor: "user".to_owned(),
                request_id: EntityId::new(),
            },
        )
        .await
        .unwrap()
        .expect("should have a record");

        assert_eq!(record.from_state, "ready");
        assert_eq!(record.to_state, "processing");

        let envelope = rx.try_recv().expect("event should be published");
        assert_eq!(envelope.topic, TOPIC_LIFECYCLE_TRANSITION_APPLIED);
    }

    // Spec 017 C5: `completed → archived` requires a plan, so the user-driven
    // `apply_transition` refuses it with PlanRequired (asserted in
    // `transition_use_case` tests). This primitive — invoked by the plan-apply
    // path AFTER a successful `origin = archive` apply — is the one legitimate
    // closure of that gate: `transition_lifecycle` does not re-run the
    // requires-plan check, so it drives the project into `archived`.
    #[tokio::test]
    async fn archive_closure_drives_completed_to_archived() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let record = transition_lifecycle(
            &repo,
            &bus,
            TransitionCommand {
                entity_id: EntityId::new(),
                entity_type: EntityType::Project,
                from_state: "completed".to_owned(),
                to_state: "archived".to_owned(),
                trigger: "archive.plan.applied".to_owned(),
                actor: "user".to_owned(),
                request_id: EntityId::new(),
            },
        )
        .await
        .expect("closure transition must not error")
        .expect("a non-noop transition yields a record");

        assert_eq!(record.from_state, "completed");
        assert_eq!(record.to_state, "archived");
    }
}
