// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `discard_plan` (US4).

use audit::bus::EventBus;
use audit::event_bus::{PlanDiscarded, Source, TOPIC_PLAN_DISCARDED};
use contracts_core::lifecycle::PlanState;
use contracts_core::plans::PlanDiscardResponse;
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::Timestamp;
use persistence_db::repositories::plans as repo;
use sqlx::SqlitePool;

use crate::errors::bus_err;

use super::{db_err, parse_plan_state};

// ── discard_plan ──────────────────────────────────────────────────────────────

/// Discard (soft-delete) a plan (US4, T030).
///
/// Allowed from any state except `applying` or `paused` (`plan.in_progress`).
/// The plan row is retained; `parentPlanId` references remain resolvable (A5).
/// Emits a `plan.discarded` audit event.
///
/// # Errors
///
/// Returns `ContractError` with code:
/// - `plan.not_found` — no matching plan.
/// - `plan.in_progress` — plan is currently being applied.
pub async fn discard_plan(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
) -> Result<PlanDiscardResponse, ContractError> {
    // Include discarded so the error is "not_found" only for truly missing plans.
    let row = repo::get_plan(pool, plan_id, true).await.map_err(db_err)?;

    let state = parse_plan_state(&row.state)?;

    // Guard: cannot discard while applying or paused.
    if matches!(state, PlanState::Applying | PlanState::Paused) {
        return Err(ContractError::new(
            ErrorCode::PlanInProgress,
            format!("cannot discard a plan in state {:?}", row.state),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Already discarded — idempotent return.
    if state == PlanState::Discarded {
        return Ok(PlanDiscardResponse {
            plan_id: plan_id.to_owned(),
            discarded_at: row.discarded_at.unwrap_or_else(Timestamp::now_iso),
        });
    }

    let discarded_at = Timestamp::now_iso();
    repo::soft_delete_plan(pool, plan_id, &discarded_at).await.map_err(db_err)?;

    // Emit audit event (A7, A5).
    bus.publish(
        TOPIC_PLAN_DISCARDED,
        Source::User,
        PlanDiscarded {
            plan_id: plan_id.to_owned(),
            prior_state: row.state,
            discarded_at: discarded_at.clone(),
        },
    )
    .await
    .map_err(bus_err)?;

    Ok(PlanDiscardResponse { plan_id: plan_id.to_owned(), discarded_at })
}
