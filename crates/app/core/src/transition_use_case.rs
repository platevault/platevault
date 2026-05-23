//! Contract-shaped wrapper around [`lifecycle_use_case::transition_lifecycle`].
//!
//! The Phase 4 use case takes string `from`/`to` values; the Phase 5 Tauri
//! surface delivers a discriminated [`contracts_core::lifecycle::TransitionRequest`].
//! This module translates between them and returns the contract-shaped
//! `TransitionResponse` envelope so the boundary stays language-neutral.

use std::collections::HashMap;

use audit::bus::EventBus;
use contracts_core::lifecycle::{
    TransitionActor, TransitionError, TransitionErrorCode, TransitionRequest, TransitionResponse,
};
use domain_core::ids::EntityId;
use domain_core::lifecycle::data_asset::EntityType;
use persistence_db::repositories::lifecycle::LifecycleRepository;
use serde::Serialize;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::lifecycle_use_case::{
    transition_lifecycle, EdgeMeta, LifecycleError, TransitionCommand,
};

/// Apply a lifecycle transition given a contract `TransitionRequest`.
///
/// On success returns a `TransitionResponse` carrying `audit_id` and the
/// applied timestamp. On no-op (current_state == next_state) returns
/// `TransitionResponse::noop(...)`. On repository / validation failure
/// returns `TransitionResponse::error(...)` with a mapped error code.
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
        TransitionRequest::InventorySession(r) => {
            to_command!(r, EntityType::InventorySession)
        }
        TransitionRequest::CalibrationSession(r) => {
            to_command!(r, EntityType::CalibrationSession)
        }
        TransitionRequest::DataSource(r) => to_command!(r, EntityType::DataSource),
        TransitionRequest::PreparedSource(r) => {
            to_command!(r, EntityType::PreparedSource)
        }
        TransitionRequest::Projection(r) => to_command!(r, EntityType::Projection),
        TransitionRequest::FileRecord(r) => to_command!(r, EntityType::FileRecord),
    }
}

fn state_str<T: Serialize>(state: &T) -> String {
    serde_json::to_value(state).ok().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default()
}
