//! Contract-shaped lifecycle transition use case (spec 002 T036/T038/T044).
//!
//! Translates a discriminated `contracts_core::lifecycle::TransitionRequest`
//! into a [`TransitionCommand`], enforces the spec 002 invariants
//! (noop, allowed-edge, actor=system, plan-required), then either dispatches
//! to [`transition_lifecycle`] for the persisted mutation or returns a
//! refusal envelope.
//!
//! Action-bound provenance review (FR-009/FR-010) is intentionally out of
//! scope for this module — that data lives on the entity row and is
//! enforced by a follow-up consumer (T038 second clause). The plumbing
//! here ensures the use case is the single place that gate adds onto.

use std::collections::HashMap;

use audit::bus::EventBus;
use contracts_core::lifecycle::{
    TransitionActor, TransitionError, TransitionErrorCode, TransitionRequest, TransitionResponse,
};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use domain_core::lifecycle::{
    data_source, inventory, plan as plan_lifecycle, plan_requirement::requires_plan,
    prepared_source, project, projection, session,
};
use persistence_db::repositories::lifecycle::LifecycleRepository;
use serde::Serialize;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::lifecycle_use_case::{
    transition_lifecycle, EdgeMeta, LifecycleError, TransitionCommand,
};

/// Apply a lifecycle transition given a contract `TransitionRequest`.
///
/// Decision order (data-model.md §AuditLogEntry §Invariants + research.md §5):
/// 1. Parse request.
/// 2. Same-state no-op → `TransitionResponse::noop`.
/// 3. Edge not in the domain table → `transition.refused`.
/// 4. `actor=system` on non-`blocked`-touching edge → `transition.refused`.
/// 5. `requires_plan(...)` true → `plan.required` (plan creation deferred).
/// 6. Hand off to [`transition_lifecycle`].
pub async fn apply_transition<R, S>(
    repo: &R,
    bus: &EventBus,
    request: TransitionRequest,
    edge_table: &HashMap<EntityType, Vec<([&'static str; 2], EdgeMeta)>, S>,
) -> TransitionResponse
where
    R: LifecycleRepository + Sync,
    S: std::hash::BuildHasher,
{
    let parsed = match parse_request(request) {
        Ok(parsed) => parsed,
        Err(err) => {
            return TransitionResponse::error(
                Uuid::nil(),
                TransitionError {
                    code: TransitionErrorCode::TransitionRefused,
                    message: err,
                    details: None,
                },
            );
        }
    };

    let ParsedRequest { request_id, command, prior_state } = parsed;

    // 2. Same-state no-op (research.md §5 — no audit row, no event).
    if command.from_state == command.to_state {
        return TransitionResponse::noop(request_id);
    }

    // 3. Edge validity per domain transition table.
    if !validate_edge(command.entity_type, &command.from_state, &command.to_state) {
        return TransitionResponse::error(
            request_id,
            TransitionError {
                code: TransitionErrorCode::TransitionRefused,
                message: format!(
                    "edge ({}, {} -> {}) not in canonical transition table",
                    command.entity_type, command.from_state, command.to_state
                ),
                details: None,
            },
        );
    }

    // 4. actor=system policy (GRILL spec 009 ratification, data-model.md
    //    §AuditLogEntry §Invariants): only allowed on edges entering or
    //    leaving `blocked`.
    if command.actor == "system" && !touches_blocked(&command.from_state, &command.to_state) {
        return TransitionResponse::error(
            request_id,
            TransitionError {
                code: TransitionErrorCode::ActorNotAuthorised,
                message: "actor=system is only permitted on edges entering or leaving `blocked`"
                    .to_owned(),
                details: None,
            },
        );
    }

    // 5. Plan-required gate (T044): callers MUST NOT pass requires_plan;
    //    we derive it from the canonical table. Plan creation is deferred
    //    to a separate task; this branch surfaces `plan.required` so the
    //    caller knows to drive a `FilesystemPlan` flow before retrying.
    if requires_plan(command.entity_type, &command.from_state, &command.to_state) {
        return TransitionResponse::error(
            request_id,
            TransitionError {
                code: TransitionErrorCode::PlanRequired,
                message: format!(
                    "edge ({}, {} -> {}) requires an approved FilesystemPlan",
                    command.entity_type, command.from_state, command.to_state
                ),
                details: None,
            },
        );
    }

    // 6. Hand off — record + publish.
    match transition_lifecycle(repo, bus, command, edge_table).await {
        Ok(None) => TransitionResponse::noop(request_id),
        Ok(Some(record)) => {
            let applied_at = record
                .applied_at
                .as_offset_date_time()
                .format(&Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());
            TransitionResponse::success(
                request_id,
                applied_at,
                prior_state,
                record.to_state,
                record.audit_id.as_uuid(),
            )
        }
        Err(LifecycleError::NotFound { entity_id }) => TransitionResponse::error(
            request_id,
            TransitionError {
                code: TransitionErrorCode::EntityNotFound,
                message: format!("entity {entity_id} not found"),
                details: None,
            },
        ),
        Err(LifecycleError::Refused(reason)) => TransitionResponse::error(
            request_id,
            TransitionError {
                code: TransitionErrorCode::TransitionRefused,
                message: reason,
                details: None,
            },
        ),
        Err(LifecycleError::Persistence(err)) => TransitionResponse::error(
            request_id,
            TransitionError {
                code: TransitionErrorCode::TransitionRefused,
                message: err.to_string(),
                details: None,
            },
        ),
    }
}

/// Look up `(from, to)` in the appropriate domain transition table.
fn validate_edge(entity_type: EntityType, from: &str, to: &str) -> bool {
    match entity_type {
        EntityType::Project => {
            parse_state(from).zip(parse_state(to)).is_some_and(|(f, t)| project::is_allowed(f, t))
        }
        EntityType::Plan | EntityType::FilesystemPlan => parse_plan(from)
            .zip(parse_plan(to))
            .is_some_and(|(f, t)| plan_lifecycle::is_allowed(f, t)),
        EntityType::AcquisitionSession
        | EntityType::CalibrationSession
        | EntityType::InventorySession => parse_session(from)
            .zip(parse_session(to))
            .is_some_and(|(f, t)| session::is_allowed(f, t)),
        EntityType::FileRecord => parse_file_record(from)
            .zip(parse_file_record(to))
            .is_some_and(|(f, t)| inventory::is_allowed(f, t)),
        EntityType::DataSource | EntityType::LibraryRoot => parse_data_source(from)
            .zip(parse_data_source(to))
            .is_some_and(|(f, t)| data_source::is_allowed(f, t)),
        EntityType::PreparedSource => parse_prepared_source(from)
            .zip(parse_prepared_source(to))
            .is_some_and(|(f, t)| prepared_source::is_allowed(f, t)),
        EntityType::Projection | EntityType::ProcessingArtifact => parse_projection(from)
            .zip(parse_projection(to))
            .is_some_and(|(f, t)| projection::is_allowed(f, t)),
    }
}

fn touches_blocked(from: &str, to: &str) -> bool {
    from == "blocked" || to == "blocked"
}

// ── string → enum parsers ────────────────────────────────────────────────

fn parse_state(s: &str) -> Option<project::ProjectState> {
    Some(match s {
        "setup_incomplete" => project::ProjectState::SetupIncomplete,
        "ready" => project::ProjectState::Ready,
        "prepared" => project::ProjectState::Prepared,
        "processing" => project::ProjectState::Processing,
        "completed" => project::ProjectState::Completed,
        "archived" => project::ProjectState::Archived,
        "blocked" => project::ProjectState::Blocked,
        _ => return None,
    })
}

fn parse_plan(s: &str) -> Option<plan_lifecycle::PlanState> {
    Some(match s {
        "draft" => plan_lifecycle::PlanState::Draft,
        "ready_for_review" => plan_lifecycle::PlanState::ReadyForReview,
        "approved" => plan_lifecycle::PlanState::Approved,
        "applying" => plan_lifecycle::PlanState::Applying,
        "paused" => plan_lifecycle::PlanState::Paused,
        "applied" => plan_lifecycle::PlanState::Applied,
        "partially_applied" => plan_lifecycle::PlanState::PartiallyApplied,
        "failed" => plan_lifecycle::PlanState::Failed,
        "cancelled" => plan_lifecycle::PlanState::Cancelled,
        "discarded" => plan_lifecycle::PlanState::Discarded,
        _ => return None,
    })
}

fn parse_session(s: &str) -> Option<session::SessionState> {
    Some(match s {
        "discovered" => session::SessionState::Discovered,
        "candidate" => session::SessionState::Candidate,
        "needs_review" => session::SessionState::NeedsReview,
        "confirmed" => session::SessionState::Confirmed,
        "rejected" => session::SessionState::Rejected,
        "ignored" => session::SessionState::Ignored,
        _ => return None,
    })
}

fn parse_file_record(s: &str) -> Option<inventory::InventoryState> {
    Some(match s {
        "observed" => inventory::InventoryState::Observed,
        "changed" => inventory::InventoryState::Changed,
        "classified" => inventory::InventoryState::Classified,
        "missing" => inventory::InventoryState::Missing,
        "rejected" => inventory::InventoryState::Rejected,
        "protected" => inventory::InventoryState::Protected,
        _ => return None,
    })
}

fn parse_data_source(s: &str) -> Option<data_source::DataSourceState> {
    Some(match s {
        "active" => data_source::DataSourceState::Active,
        "missing" => data_source::DataSourceState::Missing,
        "disabled" => data_source::DataSourceState::Disabled,
        "reconnect_required" => data_source::DataSourceState::ReconnectRequired,
        _ => return None,
    })
}

fn parse_prepared_source(s: &str) -> Option<prepared_source::PreparedSourceState> {
    Some(match s {
        "not_created" => prepared_source::PreparedSourceState::NotCreated,
        "planned" => prepared_source::PreparedSourceState::Planned,
        "ready" => prepared_source::PreparedSourceState::Ready,
        "stale" => prepared_source::PreparedSourceState::Stale,
        "retired" => prepared_source::PreparedSourceState::Retired,
        _ => return None,
    })
}

fn parse_projection(s: &str) -> Option<projection::ProjectionState> {
    Some(match s {
        "current" => projection::ProjectionState::Current,
        "stale" => projection::ProjectionState::Stale,
        "regenerating" => projection::ProjectionState::Regenerating,
        _ => return None,
    })
}

// ── contract → command translation ───────────────────────────────────────

struct ParsedRequest {
    request_id: Uuid,
    command: TransitionCommand,
    prior_state: String,
}

fn parse_request(request: TransitionRequest) -> Result<ParsedRequest, String> {
    macro_rules! to_command {
        ($req:expr, $entity_type:expr) => {{
            let req = $req;
            let entity_type = $entity_type;
            let prior_state = state_str(&req.current_state);
            let next_state = state_str(&req.next_state);
            let actor = match req.actor {
                TransitionActor::User => "user".to_owned(),
                TransitionActor::System => "system".to_owned(),
            };
            let trigger = req.action_label.clone().unwrap_or_else(|| {
                format!("{}: {} -> {}", req.entity_type, prior_state, next_state)
            });
            Ok(ParsedRequest {
                request_id: req.request_id,
                prior_state: prior_state.clone(),
                command: TransitionCommand {
                    entity_id: EntityId::from_uuid(req.entity_id),
                    entity_type,
                    from_state: prior_state,
                    to_state: next_state,
                    trigger,
                    actor,
                    request_id: EntityId::from_uuid(req.request_id),
                },
            })
        }};
    }

    match request {
        TransitionRequest::Project(r) => to_command!(r, EntityType::Project),
        TransitionRequest::Plan(r) => to_command!(r, EntityType::Plan),
        TransitionRequest::InventorySession(r) => to_command!(r, EntityType::InventorySession),
        TransitionRequest::CalibrationSession(r) => to_command!(r, EntityType::CalibrationSession),
        TransitionRequest::DataSource(r) => to_command!(r, EntityType::DataSource),
        TransitionRequest::PreparedSource(r) => to_command!(r, EntityType::PreparedSource),
        TransitionRequest::Projection(r) => to_command!(r, EntityType::Projection),
        TransitionRequest::FileRecord(r) => to_command!(r, EntityType::FileRecord),
    }
}

fn state_str<T: Serialize>(state: &T) -> String {
    serde_json::to_value(state).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts_core::lifecycle::{ProjectState, ProjectTransitionRequest};
    use persistence_db::repositories::lifecycle::InMemoryLifecycleRepository;

    async fn test_bus() -> EventBus {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS events (\
             event_id INTEGER PRIMARY KEY AUTOINCREMENT,\
             topic TEXT NOT NULL, source TEXT NOT NULL, emitted_at TEXT NOT NULL, payload TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        EventBus::with_pool(pool)
    }

    fn project_request(
        current: ProjectState,
        next: ProjectState,
        actor: TransitionActor,
    ) -> TransitionRequest {
        TransitionRequest::Project(ProjectTransitionRequest {
            contract_version: "2.0.0".to_owned(),
            request_id: Uuid::new_v4(),
            entity_type: "project".to_owned(),
            entity_id: Uuid::new_v4(),
            current_state: current,
            next_state: next,
            action_label: None,
            actor,
        })
    }

    #[tokio::test]
    async fn rejects_disallowed_edge() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;
        let table = crate::lifecycle_use_case::build_edge_table();

        // processing → ready is explicitly disallowed (research.md §2.1).
        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Processing, ProjectState::Ready, TransitionActor::User),
            &table,
        )
        .await;

        assert!(matches!(
            resp.error.as_ref().map(|e| e.code),
            Some(TransitionErrorCode::TransitionRefused)
        ));
    }

    #[tokio::test]
    async fn rejects_system_on_non_blocked_edge() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;
        let table = crate::lifecycle_use_case::build_edge_table();

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Ready, ProjectState::Processing, TransitionActor::System),
            &table,
        )
        .await;

        assert_eq!(
            resp.error.as_ref().map(|e| e.code),
            Some(TransitionErrorCode::ActorNotAuthorised)
        );
    }

    #[tokio::test]
    async fn allows_system_on_blocked_recovery() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;
        let table = crate::lifecycle_use_case::build_edge_table();

        // blocked → ready does not require a plan; system actor is allowed.
        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Blocked, ProjectState::Ready, TransitionActor::System),
            &table,
        )
        .await;

        // success or noop are both acceptable terminal states (the in-memory
        // repo returns Ok(record) by default); the important thing is that
        // it didn't refuse with ActorNotAuthorised.
        assert!(
            resp.error.is_none()
                || resp.error.as_ref().unwrap().code != TransitionErrorCode::ActorNotAuthorised
        );
    }

    #[tokio::test]
    async fn flags_plan_required_for_ready_to_prepared() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;
        let table = crate::lifecycle_use_case::build_edge_table();

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Ready, ProjectState::Prepared, TransitionActor::User),
            &table,
        )
        .await;

        assert_eq!(resp.error.as_ref().map(|e| e.code), Some(TransitionErrorCode::PlanRequired));
    }

    #[tokio::test]
    async fn same_state_returns_noop() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;
        let table = crate::lifecycle_use_case::build_edge_table();

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Ready, ProjectState::Ready, TransitionActor::User),
            &table,
        )
        .await;

        assert_eq!(resp.status, contracts_core::lifecycle::TransitionStatus::Noop);
    }
}
