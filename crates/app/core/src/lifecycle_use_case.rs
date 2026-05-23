//! `transition_lifecycle` use case — stub wiring for spec 002.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! Flow (full impl lands in T003/T044):
//! 1. Load current state from repository.
//! 2. Validate (entity_type, from, to) against the canonical edge table.
//! 3. Perform atomic CAS via `repository.record_transition`.
//! 4. Publish `lifecycle.transition.applied` on the event bus.
//!
//! This file proves the wiring compiles. Business-rule enforcement (plan
//! requirement checks, actor/blocked gate, provenance review gate) is
//! deferred to T044/T045/T046.

use std::collections::HashMap;

use audit::bus::EventBus;
use audit::event_bus::{LifecycleTransitionApplied, Source, TOPIC_LIFECYCLE_TRANSITION_APPLIED};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use persistence_db::repositories::lifecycle::{
    LifecycleRepository, TransitionRecord, TransitionRequest,
};

/// Metadata carried on an allowed transition edge.
#[derive(Clone, Debug)]
pub struct EdgeMeta {
    /// True when this edge requires a `FilesystemPlan` to be approved first.
    pub requires_plan: bool,
}

/// Canonical transition edge table (spec 002 data-model.md §Plan-Requirement Edge Table).
///
/// Only edges that have special constraints are listed here.
/// Unlisted edges default to `requires_plan = false` and are permitted.
///
/// TODO T044: wire the full table from data-model.md and enforce at runtime.
#[must_use]
pub fn build_edge_table() -> HashMap<EntityType, Vec<([&'static str; 2], EdgeMeta)>> {
    let mut m: HashMap<EntityType, Vec<([&'static str; 2], EdgeMeta)>> = HashMap::new();

    // project edges that require a plan
    m.entry(EntityType::Project).or_default().extend([
        (["ready", "prepared"], EdgeMeta { requires_plan: true }),
        (["prepared", "ready"], EdgeMeta { requires_plan: true }),
        (["completed", "archived"], EdgeMeta { requires_plan: true }),
        (["blocked", "archived"], EdgeMeta { requires_plan: true }),
    ]);

    // prepared_source: all → retired requires plan
    m.entry(EntityType::PreparedSource)
        .or_default()
        .push((["*", "retired"], EdgeMeta { requires_plan: true }));

    m
}

/// Error type for the lifecycle use case.
#[derive(Debug, thiserror::Error)]
pub enum LifecycleError {
    #[error("transition refused: {0}")]
    Refused(String),
    #[error("entity not found: {entity_id}")]
    NotFound { entity_id: EntityId },
    #[error("persistence error: {0}")]
    Persistence(#[from] persistence_db::DbError),
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
/// Returns `Ok(None)` when `from_state == to_state` (noop — no audit row, no event).
///
/// # Errors
/// - `LifecycleError::Refused` when the edge requires a plan that is not approved
///   (full validation deferred to T044).
/// - `LifecycleError::Persistence` on repository failure.
pub async fn transition_lifecycle<R, S>(
    repo: &R,
    bus: &EventBus,
    cmd: TransitionCommand,
    _edge_table: &HashMap<EntityType, Vec<([&'static str; 2], EdgeMeta)>, S>,
) -> Result<Option<TransitionRecord>, LifecycleError>
where
    R: LifecycleRepository + Sync,
    S: std::hash::BuildHasher,
{
    // Noop: caller-requested next_state equals current_state.
    if cmd.from_state == cmd.to_state {
        return Ok(None);
    }

    // TODO T044: validate edge against _edge_table; check plan-requirement gate.
    // TODO T045: enforce actor/blocked gate (actor == system only on blocked edges).
    // TODO T046: provenance.unreviewed gate for action-critical fields.

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
            },
        )
        .await;

    Ok(Some(record))
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::lifecycle::InMemoryLifecycleRepository;

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
        let table = build_edge_table();

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
            &table,
        )
        .await
        .unwrap();

        assert!(result.is_none());
    }

    #[tokio::test]
    async fn successful_transition_returns_record_and_publishes_event() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;
        let mut rx = bus.subscribe();
        let table = build_edge_table();

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
            &table,
        )
        .await
        .unwrap()
        .expect("should have a record");

        assert_eq!(record.from_state, "ready");
        assert_eq!(record.to_state, "processing");

        let envelope = rx.try_recv().expect("event should be published");
        assert_eq!(envelope.topic, TOPIC_LIFECYCLE_TRANSITION_APPLIED);
    }
}
