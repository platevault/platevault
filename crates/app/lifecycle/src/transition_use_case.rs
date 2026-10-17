// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Contract-shaped lifecycle transition use case
//! (spec 002 T036/T038/T044/T050).
//!
//! Translates a discriminated `contracts_core::lifecycle::TransitionRequest`
//! into a [`TransitionCommand`], enforces the spec 002 invariants
//! (noop, allowed-edge, actor=system, action-bound review, plan-required),
//! then either dispatches to [`transition_lifecycle`] for the persisted
//! mutation or returns a refusal envelope.
//!
//! Action-bound review (FR-009/FR-010, T050) is enforced here field-level:
//! for each `(entity_type, from, to)` cell present in
//! `domain_core::lifecycle::action_review_requirement::TABLE`, the gate
//! reads `ProvenancedValue.origin` per listed field via
//! `LifecycleRepository::field_origins` and refuses the edge with
//! `provenance.unreviewed` (populating `details.blockingFields`) when any
//! required field is not yet `reviewed`. Review state is derived from
//! field-level provenance — it is NOT a per-entity column.

use audit::bus::EventBus;
use contracts_core::lifecycle::{
    TransitionActor, TransitionError, TransitionErrorCode, TransitionRequest, TransitionResponse,
};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use domain_core::lifecycle::provenance::ProvenanceTag;
use domain_core::lifecycle::{
    action_review_requirement::action_critical_fields, data_source, inventory,
    plan as plan_lifecycle, plan_requirement::requires_plan, prepared_source, project, projection,
};
use persistence_lifecycle::repositories::lifecycle::{
    LifecycleRepository, TransitionRequest as RepoTransitionRequest,
};
use serde::Serialize;
use sqlx::SqliteConnection;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::lifecycle_use_case::{
    transition_lifecycle, transition_lifecycle_conn, LifecycleError, StagedTransition,
    TransitionCommand,
};

/// Apply a lifecycle transition given a contract `TransitionRequest`.
///
/// Decision order (data-model.md §AuditLogEntry §Invariants + research.md §5):
/// 1. Parse request.
/// 2. Same-state no-op → `TransitionResponse::noop`.
/// 3. Edge not in the domain table → `transition.refused`.
/// 4. `actor=system` on non-`blocked`-touching edge → `transition.refused`.
/// 5. Action-bound review (FR-009/FR-010): any action-critical field whose
///    provenance origin is not `reviewed` → `provenance.unreviewed`.
/// 6. `requires_plan(...)` true → `plan.required` (plan creation deferred).
/// 7. Hand off to [`transition_lifecycle`].
pub async fn apply_transition<R>(
    repo: &R,
    bus: &EventBus,
    request: TransitionRequest,
) -> TransitionResponse
where
    R: LifecycleRepository + Sync,
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
        let message = format!(
            "edge ({}, {} -> {}) not in canonical transition table",
            command.entity_type, command.from_state, command.to_state
        );
        let params = serde_json::json!({
            "entityType": command.entity_type.as_str(),
            "fromState": command.from_state,
            "toState": command.to_state,
        });
        return record_refused(
            repo,
            &command,
            request_id,
            Refusal {
                code: TransitionErrorCode::TransitionRefused,
                code_str: "transition.refused",
                message,
                details: None,
                detail_params: Some(params),
            },
        )
        .await;
    }

    // 4. actor=system policy (GRILL spec 009 ratification, data-model.md
    //    §AuditLogEntry §Invariants + A4 reconciliation): allowed on edges
    //    entering or leaving `blocked` AND on the invariant-driven
    //    `setup_incomplete → ready` auto-transition (R-Ready-Trigger).
    if command.actor == "system" && !is_system_permitted(&command.from_state, &command.to_state) {
        return record_refused(
            repo,
            &command,
            request_id,
            Refusal {
                code: TransitionErrorCode::ActorNotAuthorised,
                code_str: "actor.not_authorised",
                message: "actor=system is only permitted on edges entering or leaving `blocked`, or on the setup_incomplete → ready invariant transition".to_owned(),
                details: None,
                // Static template — no params, but the code alone is unambiguous.
                detail_params: Some(serde_json::json!({})),
            },
        )
        .await;
    }

    // 5. Action-bound review gate (T050, FR-009/FR-010). Field-level review
    //    state is derived from `ProvenancedValue.origin` — it is NOT a
    //    per-entity column. See data-model.md §Action-Bound Review.
    if let Some(refusal) = check_action_review(repo, &command, request_id).await {
        return refusal;
    }

    // 6. Plan-required gate (T044): callers MUST NOT pass requires_plan;
    //    we derive it from the canonical table. Plan creation is deferred
    //    to a separate task; this branch surfaces `plan.required` so the
    //    caller knows to drive a `FilesystemPlan` flow before retrying.
    if requires_plan(command.entity_type, &command.from_state, &command.to_state) {
        let message = format!(
            "edge ({}, {} -> {}) requires an approved FilesystemPlan",
            command.entity_type, command.from_state, command.to_state
        );
        let params = serde_json::json!({
            "entityType": command.entity_type.as_str(),
            "fromState": command.from_state,
            "toState": command.to_state,
        });
        return record_refused(
            repo,
            &command,
            request_id,
            Refusal {
                code: TransitionErrorCode::PlanRequired,
                code_str: "plan.required",
                message,
                details: None,
                detail_params: Some(params),
            },
        )
        .await;
    }

    // 7. Hand off — record + publish.
    dispatch_to_repository(repo, bus, command, request_id, prior_state).await
}

/// Final dispatch step of [`apply_transition`]. Extracted to keep
/// `apply_transition` itself under clippy's `too_many_lines` limit and to
/// keep the refusal-audit recovery (for CAS-loss and not-found errors) in
/// a single locus.
async fn dispatch_to_repository<R>(
    repo: &R,
    bus: &EventBus,
    command: TransitionCommand,
    request_id: Uuid,
    prior_state: String,
) -> TransitionResponse
where
    R: LifecycleRepository + Sync,
{
    // Clone for refusal-audit recovery in case `transition_lifecycle` itself
    // fails after our pre-checks (e.g. CAS lost a race, missing entity).
    // The clone is cheap (UUIDs + short strings).
    let command_for_refusal = command.clone();
    match transition_lifecycle(repo, bus, command).await {
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
        // EntityNotFound: the entity didn't exist when CAS ran. We still
        // record the attempted refusal — it's evidence of an attempted
        // operation. The entity_id in the audit row points at a missing
        // entity, which is fine (audit_log_entry has no FK).
        Err(LifecycleError::NotFound { entity_id }) => {
            let params = serde_json::json!({ "entityId": entity_id.to_string() });
            record_refused(
                repo,
                &command_for_refusal,
                request_id,
                Refusal {
                    code: TransitionErrorCode::EntityNotFound,
                    code_str: "entity.not_found",
                    message: format!("entity {entity_id} not found"),
                    details: None,
                    detail_params: Some(params),
                },
            )
            .await
        }
        Err(LifecycleError::Refused(reason)) => {
            record_refused(
                repo,
                &command_for_refusal,
                request_id,
                Refusal {
                    code: TransitionErrorCode::TransitionRefused,
                    code_str: "transition.refused",
                    message: reason,
                    details: None,
                    // Free-form reason — no template params; frontend falls
                    // back to the stored English message.
                    detail_params: None,
                },
            )
            .await
        }
        // Persistence-layer error: do NOT also write a refused audit row,
        // because the audit write itself would likely fail. Surface the
        // refusal envelope only.
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

/// Inspect action-critical fields and return a `provenance.unreviewed`
/// refusal envelope when any required field is not yet `Reviewed`.
/// Returns `None` when the edge has no review requirement or all fields
/// satisfy it. Surfaces persistence errors as `transition.refused`.
async fn check_action_review<R>(
    repo: &R,
    command: &TransitionCommand,
    request_id: Uuid,
) -> Option<TransitionResponse>
where
    R: LifecycleRepository + Sync,
{
    let critical =
        action_critical_fields(command.entity_type, &command.from_state, &command.to_state);
    if critical.is_empty() {
        return None;
    }
    let origins = match repo.field_origins(command.entity_id, command.entity_type).await {
        Ok(map) => map,
        Err(err) => {
            return Some(
                record_refused(
                    repo,
                    command,
                    request_id,
                    Refusal {
                        code: TransitionErrorCode::TransitionRefused,
                        code_str: "transition.refused",
                        message: err.to_string(),
                        details: None,
                        // Wrapped persistence error — heterogeneous message,
                        // no template params (English fallback).
                        detail_params: None,
                    },
                )
                .await,
            );
        }
    };

    let blocking: Vec<serde_json::Value> = critical
        .iter()
        .filter(|field| origins.get(**field).is_none_or(|t| *t != ProvenanceTag::Reviewed))
        .map(|field| serde_json::json!({ "fieldPath": *field, "requiredOrigin": "reviewed" }))
        .collect();
    if blocking.is_empty() {
        return None;
    }
    let message = format!(
        "edge ({}, {} -> {}) requires reviewed provenance on {} field(s)",
        command.entity_type,
        command.from_state,
        command.to_state,
        blocking.len()
    );
    let params = serde_json::json!({ "count": blocking.len().to_string() });
    Some(
        record_refused(
            repo,
            command,
            request_id,
            Refusal {
                code: TransitionErrorCode::ProvenanceUnreviewed,
                code_str: "provenance.unreviewed",
                message,
                details: Some(serde_json::json!({ "blockingFields": blocking })),
                detail_params: Some(params),
            },
        )
        .await,
    )
}

/// Everything [`record_refused`] needs to persist and surface one refusal.
///
/// - `details` goes into the response envelope only (`TransitionError.details`,
///   e.g. `blockingFields`).
/// - `detail_params` is persisted as `payload.refusal.params` (see
///   [`LifecycleRepository::record_refused_transition`]).
struct Refusal {
    code: TransitionErrorCode,
    code_str: &'static str,
    message: String,
    details: Option<serde_json::Value>,
    detail_params: Option<serde_json::Value>,
}

/// Helper for all refusal paths in [`apply_transition`]. Writes a `refused`
/// audit row (data-model.md §242 / §378 — refusals MUST be durable, not
/// just observable in the response envelope), then returns the refusal
/// response. Best-effort: a persistence failure on the audit row MUST NOT
/// mask the user-facing refusal (the response is what the caller sees).
///
/// Audit-write failures are surfaced via `tracing::error!` so an external
/// watchdog can alert on gap rates — silently dropping them would defeat the
/// "reviewable mutation" principle (Constitution §II).
///
/// `detail_params` (D23 upgrade): structured display parameters persisted as
/// `payload.refusal.params`. Pass `Some(...)` ONLY when the `(code_str,
/// params)` pair unambiguously identifies the message template — the Audit
/// Log frontend uses their presence to select a localized catalog message
/// instead of the stored English `message`. Heterogeneous refusal messages
/// (e.g. wrapped persistence errors under `transition.refused`) MUST pass
/// `None` so they keep rendering the stored English fallback.
async fn record_refused<R>(
    repo: &R,
    command: &TransitionCommand,
    request_id: Uuid,
    refusal: Refusal,
) -> TransitionResponse
where
    R: LifecycleRepository + Sync,
{
    let Refusal { code, code_str, message, details, detail_params } = refusal;
    if let Err(err) = repo
        .record_refused_transition(
            RepoTransitionRequest {
                entity_id: command.entity_id,
                entity_type: command.entity_type,
                from_state: command.from_state.clone(),
                to_state: command.to_state.clone(),
                trigger: command.trigger.clone(),
                actor: command.actor.clone(),
                request_id: command.request_id,
            },
            code_str,
            &message,
            detail_params,
        )
        .await
    {
        tracing::error!(
            entity_id = %command.entity_id,
            entity_type = %command.entity_type,
            code = code_str,
            error = %err,
            "audit: failed to persist refused row"
        );
    }

    TransitionResponse::error(
        request_id,
        TransitionError { code, message, details: details.map(contracts_core::JsonAny::new) },
    )
}

/// `transition_preview` — read-only dry-run of [`apply_transition`] (T039).
///
/// Walks the same decision tree (noop → edge → actor=system → plan-required)
/// but never touches the repository and never publishes events. The returned
/// envelope carries `status: "success"` when the transition would be allowed,
/// `status: "noop"` for identity edges, and `status: "error"` with the same
/// refusal codes as the apply path. Useful for UI button enabling.
#[must_use]
pub fn preview_transition(request: TransitionRequest) -> TransitionResponse {
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

    if command.from_state == command.to_state {
        return TransitionResponse::noop(request_id);
    }
    if let Some(err) = repository_free_refusal(&command) {
        return TransitionResponse::error(request_id, err);
    }

    // Success — applied_at is omitted (dry-run produces no audit row).
    TransitionResponse::success(
        request_id,
        String::new(),
        prior_state,
        command.to_state,
        Uuid::nil(),
    )
}

/// [`apply_transition`] inside the caller's transaction, for a transition
/// that must commit or roll back with the caller's own writes (the inbox
/// confirm reopens a completed project in the transaction that opens the
/// plan bringing it new frames, F-Framing-6).
///
/// Runs the gates [`preview_transition`] runs (noop, edge, actor=system,
/// plan-required), then writes the transition and its audit row on `conn`
/// through `transition_lifecycle_conn`. Nothing is published: publish the
/// returned [`StagedTransition`] once the transaction commits. Returns
/// `Ok(None)` for a same-state noop.
///
/// Takes Project transitions only. The event a staged transition publishes
/// names the owning project only for a Project, because this path cannot
/// read the owning project of another entity; [`apply_transition`] publishes
/// that resolved project id, so a Projection or PreparedSource transition
/// goes through it instead.
///
/// Unlike [`apply_transition`], a refusal records no `refused` audit row:
/// the caller rolls its transaction back with the refusal, and the row with
/// it. The action-bound review gate (FR-009/FR-010) reads provenance through
/// the repository, so an edge that needs one is refused here outright; none
/// does since spec 041 FR-051 emptied its table.
///
/// # Errors
/// The refusal of the gate that stopped the transition, or
/// `transition.refused` carrying the write failure (a lost CAS included).
pub async fn apply_transition_conn(
    conn: &mut SqliteConnection,
    request: TransitionRequest,
) -> Result<Option<StagedTransition>, TransitionError> {
    let ParsedRequest { command, .. } = parse_request(request).map_err(refused)?;
    if command.entity_type != EntityType::Project {
        return Err(refused(format!(
            "{} transitions do not run inside a caller's transaction; only project transitions do",
            command.entity_type
        )));
    }
    if command.from_state == command.to_state {
        return Ok(None);
    }
    if let Some(err) = repository_free_refusal(&command) {
        return Err(err);
    }
    if !action_critical_fields(command.entity_type, &command.from_state, &command.to_state)
        .is_empty()
    {
        return Err(refused(format!(
            "edge ({}, {} -> {}) needs an action-bound review, which only the repository path runs",
            command.entity_type, command.from_state, command.to_state
        )));
    }
    transition_lifecycle_conn(conn, command).await.map_err(|err| refused(err.to_string()))
}

const fn refused(message: String) -> TransitionError {
    TransitionError { code: TransitionErrorCode::TransitionRefused, message, details: None }
}

/// The gates of [`apply_transition`] that need no repository: edge
/// legality, the actor=system policy and the plan requirement. `None` when
/// the transition passes all three.
fn repository_free_refusal(command: &TransitionCommand) -> Option<TransitionError> {
    if !validate_edge(command.entity_type, &command.from_state, &command.to_state) {
        return Some(refused(format!(
            "edge ({}, {} -> {}) not in canonical transition table",
            command.entity_type, command.from_state, command.to_state
        )));
    }
    if command.actor == "system" && !is_system_permitted(&command.from_state, &command.to_state) {
        return Some(TransitionError {
            code: TransitionErrorCode::ActorNotAuthorised,
            message: "actor=system is only permitted on edges entering or leaving `blocked`, or on the setup_incomplete → ready invariant transition"
                .to_owned(),
            details: None,
        });
    }
    if requires_plan(command.entity_type, &command.from_state, &command.to_state) {
        return Some(TransitionError {
            code: TransitionErrorCode::PlanRequired,
            message: format!(
                "edge ({}, {} -> {}) requires an approved FilesystemPlan",
                command.entity_type, command.from_state, command.to_state
            ),
            details: None,
        });
    }
    None
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
        // Spec 030 T120: Settings/Protection/Equipment are audit-only tags
        // with no lifecycle transition table; they are never dispatched
        // through `lifecycle.transition` (see `EntityType` doc comment).
        // Framing (spec 008 Q27) and Calibration (#1120) join the same
        // audit-only precedent.
        EntityType::Settings
        | EntityType::Protection
        | EntityType::Equipment
        | EntityType::Framing
        | EntityType::Calibration => {
            unreachable!(
                "{entity_type:?} has no lifecycle transition table; it never flows through lifecycle.transition"
            )
        }
    }
}

/// Returns true when `actor=system` is permitted on this edge.
///
/// Per data-model.md §A4 (reconciliation note, GRILL 2026-05-22):
/// system actor is allowed on:
/// 1. All edges that enter or leave `blocked` (`* → blocked`, `blocked → *`).
/// 2. The deterministic invariant-driven `setup_incomplete → ready`
///    auto-transition (R-Ready-Trigger). This is the only non-blocked edge
///    that may be driven by actor=system.
fn is_system_permitted(from: &str, to: &str) -> bool {
    let from_state = project::ProjectState::parse_str(from);
    let to_state = project::ProjectState::parse_str(to);
    match (from_state, to_state) {
        (Some(f), Some(t)) => {
            f == project::ProjectState::Blocked
                || t == project::ProjectState::Blocked
                || (f == project::ProjectState::SetupIncomplete
                    && t == project::ProjectState::Ready)
        }
        // Non-project entities pass raw strings; the original logic applies.
        _ => from == "blocked" || to == "blocked" || (from == "setup_incomplete" && to == "ready"),
    }
}

// ── string → enum parsers (strum-backed) ─────────────────────────────────

fn parse_state(s: &str) -> Option<project::ProjectState> {
    project::ProjectState::parse_str(s)
}

fn parse_plan(s: &str) -> Option<plan_lifecycle::PlanState> {
    plan_lifecycle::PlanState::parse_str(s)
}

fn parse_file_record(s: &str) -> Option<inventory::InventoryState> {
    s.parse().ok()
}

fn parse_data_source(s: &str) -> Option<data_source::DataSourceState> {
    s.parse().ok()
}

fn parse_prepared_source(s: &str) -> Option<prepared_source::PreparedSourceState> {
    s.parse().ok()
}

fn parse_projection(s: &str) -> Option<projection::ProjectionState> {
    s.parse().ok()
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
            let trigger = req
                .action_label
                .clone()
                .unwrap_or_else(|| format!("{}: {} -> {}", entity_type, prior_state, next_state));
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
    use persistence_lifecycle::repositories::lifecycle::InMemoryLifecycleRepository;

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
            entity_id: Uuid::new_v4(),
            current_state: current,
            next_state: next,
            action_label: None,
            actor,
        })
    }

    // ── parse_plan (audit T1-b sibling parser) ─────────────────────────────

    #[test]
    fn parse_plan_accepts_every_snake_case_variant() {
        for (raw, expected) in [
            ("draft", plan_lifecycle::PlanState::Draft),
            ("ready_for_review", plan_lifecycle::PlanState::ReadyForReview),
            ("approved", plan_lifecycle::PlanState::Approved),
            ("applying", plan_lifecycle::PlanState::Applying),
            ("paused", plan_lifecycle::PlanState::Paused),
            ("applied", plan_lifecycle::PlanState::Applied),
            ("partially_applied", plan_lifecycle::PlanState::PartiallyApplied),
            ("failed", plan_lifecycle::PlanState::Failed),
            ("cancelled", plan_lifecycle::PlanState::Cancelled),
            ("discarded", plan_lifecycle::PlanState::Discarded),
        ] {
            assert_eq!(parse_plan(raw), Some(expected), "for {raw:?}");
        }
    }

    #[test]
    fn parse_plan_rejects_unknown_value() {
        assert_eq!(parse_plan("bogus_corrupt_state"), None);
    }

    #[tokio::test]
    async fn rejects_disallowed_edge() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        // processing → ready is explicitly disallowed (research.md §2.1).
        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Processing, ProjectState::Ready, TransitionActor::User),
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

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Ready, ProjectState::Processing, TransitionActor::System),
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

        // blocked → ready does not require a plan; system actor is allowed.
        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Blocked, ProjectState::Ready, TransitionActor::System),
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

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Ready, ProjectState::Prepared, TransitionActor::User),
        )
        .await;

        assert_eq!(resp.error.as_ref().map(|e| e.code), Some(TransitionErrorCode::PlanRequired));
    }

    #[tokio::test]
    async fn same_state_returns_noop() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Ready, ProjectState::Ready, TransitionActor::User),
        )
        .await;

        assert_eq!(resp.status, contracts_core::lifecycle::TransitionStatus::Noop);
    }

    // R-Ready-Trigger (A4): system actor IS permitted on setup_incomplete → ready
    #[tokio::test]
    async fn allows_system_on_setup_incomplete_to_ready() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(
                ProjectState::SetupIncomplete,
                ProjectState::Ready,
                TransitionActor::System,
            ),
        )
        .await;

        // Must NOT be ActorNotAuthorised
        assert!(
            resp.error.is_none()
                || resp.error.as_ref().map(|e| e.code)
                    != Some(TransitionErrorCode::ActorNotAuthorised),
            "system actor must be permitted on setup_incomplete → ready"
        );
    }

    // A4: system actor must still be rejected on non-permitted non-blocked edges
    #[tokio::test]
    async fn rejects_system_on_ready_to_processing() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Ready, ProjectState::Processing, TransitionActor::System),
        )
        .await;

        assert_eq!(
            resp.error.as_ref().map(|e| e.code),
            Some(TransitionErrorCode::ActorNotAuthorised)
        );
    }

    // Plan-required: completed → archived requires plan
    #[tokio::test]
    async fn flags_plan_required_for_completed_to_archived() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Completed, ProjectState::Archived, TransitionActor::User),
        )
        .await;

        assert_eq!(resp.error.as_ref().map(|e| e.code), Some(TransitionErrorCode::PlanRequired));
    }

    // Plan-required: blocked → archived requires plan
    #[tokio::test]
    async fn flags_plan_required_for_blocked_to_archived() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        // blocked → archived: system actor is permitted (touches blocked), but plan is required
        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Blocked, ProjectState::Archived, TransitionActor::User),
        )
        .await;

        assert_eq!(resp.error.as_ref().map(|e| e.code), Some(TransitionErrorCode::PlanRequired));
    }

    // Plan-required: archived → ready requires plan (R-Unarchive)
    #[tokio::test]
    async fn flags_plan_required_for_archived_to_ready() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Archived, ProjectState::Ready, TransitionActor::User),
        )
        .await;

        assert_eq!(resp.error.as_ref().map(|e| e.code), Some(TransitionErrorCode::PlanRequired));
    }

    // Plan-required: archived → processing requires plan
    #[tokio::test]
    async fn flags_plan_required_for_archived_to_processing() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(
                ProjectState::Archived,
                ProjectState::Processing,
                TransitionActor::User,
            ),
        )
        .await;

        assert_eq!(resp.error.as_ref().map(|e| e.code), Some(TransitionErrorCode::PlanRequired));
    }

    // Forbidden edge: processing → ready must be refused
    #[tokio::test]
    async fn rejects_processing_to_ready() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Processing, ProjectState::Ready, TransitionActor::User),
        )
        .await;

        assert_eq!(
            resp.error.as_ref().map(|e| e.code),
            Some(TransitionErrorCode::TransitionRefused)
        );
    }

    // Forbidden edge: blocked → completed must be refused (A3)
    #[tokio::test]
    async fn rejects_blocked_to_completed() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Blocked, ProjectState::Completed, TransitionActor::User),
        )
        .await;

        assert_eq!(
            resp.error.as_ref().map(|e| e.code),
            Some(TransitionErrorCode::TransitionRefused)
        );
    }

    // Forbidden edge: archived → completed must be refused
    #[tokio::test]
    async fn rejects_archived_to_completed() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Archived, ProjectState::Completed, TransitionActor::User),
        )
        .await;

        assert_eq!(
            resp.error.as_ref().map(|e| e.code),
            Some(TransitionErrorCode::TransitionRefused)
        );
    }

    // Allowed unrestricted edges: ready → processing (no plan, user actor)
    #[tokio::test]
    async fn allows_ready_to_processing_user() {
        let repo = InMemoryLifecycleRepository;
        let bus = test_bus().await;

        let resp = apply_transition(
            &repo,
            &bus,
            project_request(ProjectState::Ready, ProjectState::Processing, TransitionActor::User),
        )
        .await;

        assert!(resp.error.is_none(), "ready → processing (user) should be allowed");
    }

    // ── apply_transition_conn ──────────────────────────────────────────────

    /// The transaction-bound path runs the gates `apply_transition` runs:
    /// `completed → archived` needs an approved plan (spec 017 C5), so it is
    /// refused, and the caller's transaction has nothing of it to commit.
    #[tokio::test]
    async fn apply_transition_conn_refuses_a_plan_required_edge_and_writes_nothing() {
        let db = persistence_core::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let project_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO projects \
             (id, name, tool, lifecycle, path, notes, channel_drift, created_at, updated_at) \
             VALUES (?, 'M42', 'PixInsight', 'completed', 'projects/m42', NULL, 0, \
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(project_id.to_string())
        .execute(db.pool())
        .await
        .unwrap();

        let mut tx = db.pool().begin().await.unwrap();
        let err = apply_transition_conn(
            &mut tx,
            TransitionRequest::Project(ProjectTransitionRequest {
                contract_version: "2.0.0".to_owned(),
                request_id: Uuid::new_v4(),
                entity_id: project_id,
                current_state: ProjectState::Completed,
                next_state: ProjectState::Archived,
                action_label: None,
                actor: TransitionActor::User,
            }),
        )
        .await
        .expect_err("completed → archived needs an approved plan");
        tx.commit().await.unwrap();

        assert_eq!(err.code, TransitionErrorCode::PlanRequired);
        let lifecycle: String = sqlx::query_scalar("SELECT lifecycle FROM projects WHERE id = ?")
            .bind(project_id.to_string())
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(lifecycle, "completed");
        let audit_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log_entry")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(audit_rows, 0);
    }

    /// A non-Project transition is refused on the transaction path, whose
    /// event could not name the entity's owning project, and writes nothing.
    /// The projection row is really `current`, so without the refusal the
    /// `current → stale` write would go through.
    #[tokio::test]
    async fn apply_transition_conn_refuses_a_non_project_entity() {
        let db = persistence_core::Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        let now = "2026-01-01T00:00:00Z";
        sqlx::query(
            "INSERT INTO library_root (id, label, current_path, kind, state, created_at) \
             VALUES ('root1', 'r', '/tmp', 'local', 'active', ?)",
        )
        .bind(now)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO file_record \
             (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at) \
             VALUES ('fr1', 'root1', 'a.fits', 1, ?, 'observed', ?, ?)",
        )
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(db.pool())
        .await
        .unwrap();
        let artifact_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO processing_artifact \
             (id, project_id, file_record_id, kind, staleness, created_at) \
             VALUES (?, NULL, 'fr1', 'manifest', 'current', ?)",
        )
        .bind(artifact_id.to_string())
        .bind(now)
        .execute(db.pool())
        .await
        .unwrap();

        let mut tx = db.pool().begin().await.unwrap();
        let err = apply_transition_conn(
            &mut tx,
            TransitionRequest::Projection(contracts_core::lifecycle::ProjectionTransitionRequest {
                contract_version: "2.0.0".to_owned(),
                request_id: Uuid::new_v4(),
                entity_id: artifact_id,
                current_state: contracts_core::lifecycle::ProjectionState::Current,
                next_state: contracts_core::lifecycle::ProjectionState::Stale,
                action_label: None,
                actor: TransitionActor::User,
            }),
        )
        .await
        .expect_err("a projection transition must not run on the transaction path");
        tx.commit().await.unwrap();

        assert_eq!(err.code, TransitionErrorCode::TransitionRefused);
        let staleness: String =
            sqlx::query_scalar("SELECT staleness FROM processing_artifact WHERE id = ?")
                .bind(artifact_id.to_string())
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(staleness, "current", "the projection is not transitioned");
        let audit_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log_entry")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert_eq!(audit_rows, 0);
    }
}
