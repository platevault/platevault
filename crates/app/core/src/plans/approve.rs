// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `approve_plan` (US3).

use audit::bus::EventBus;
use audit::event_bus::{PlanApproved, Source, TOPIC_PLAN_APPROVED};
use camino::Utf8PathBuf;
use contracts_core::lifecycle::PlanState;
use contracts_core::plans::PlanApproveResponse;
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::Timestamp;
use fs_executor::ops::cas_check::snapshot_from_metadata;
use persistence_db::repositories::plans as repo;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::errors::bus_err;

use super::{build_root_map, db_err, parse_plan_state};

// ── approve_plan ──────────────────────────────────────────────────────────────

/// Approve a plan (US3, T025, T026).
///
/// Preconditions:
/// - Plan must be in `ready_for_review` state.
/// - Plan must have at least one item (`plan.items.empty`).
///
/// On success:
/// - Transitions plan to `approved`.
/// - Snapshots per-item FS metadata (`approvedMtime`, `approvedSizeBytes`) — R-FS-1.
/// - Issues an `approvalToken` (HMAC placeholder — real signing is added with spec 025).
/// - Emits a `plan.approved` audit event.
///
/// # Errors
///
/// Returns `ContractError` with code:
/// - `plan.not_found` — no matching plan.
/// - `plan.invalid_state` — plan is not in `ready_for_review`.
/// - `plan.items.empty` — plan has no items.
pub async fn approve_plan(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
    actor: &str,
) -> Result<PlanApproveResponse, ContractError> {
    let row = repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    // State precondition: must be ready_for_review.
    let state = parse_plan_state(&row.state)?;
    if state != PlanState::ReadyForReview {
        return Err(ContractError::new(
            ErrorCode::PlanInvalidState,
            format!(
                "plan must be ready_for_review before approval; current state is {:?}",
                row.state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Non-empty items invariant.
    if row.items_total == 0 {
        return Err(ContractError::new(
            ErrorCode::PlanItemsEmpty,
            "cannot approve a plan with no items".to_owned(),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let approved_at = Timestamp::now_iso();

    // Approval token: HMAC placeholder. Spec 025 will consume and verify this.
    // For now: a stable UUID derived from plan_id + approved_at.
    let approval_token = format!("tok-{}-{}", plan_id, Uuid::new_v4());

    // Persist state transition + token.
    repo::set_approved(pool, plan_id, &approved_at, &approval_token).await.map_err(db_err)?;

    // Snapshot per-item FS metadata (R-FS-1), so `check_cas` at apply time has
    // a real baseline instead of silently skipping in permissive mode (#829:
    // this call was documented but never wired, leaving stale/modified
    // sources undetected for every plan type). Best-effort: a stat failure
    // (source already gone, or a destination-only item with no source) just
    // leaves the snapshot columns NULL — apply-time `SourceMissing` is the
    // real backstop for a genuinely absent file.
    let item_rows = repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    let item_refs: Vec<&repo::PlanItemRow> = item_rows.iter().collect();
    let root_map = build_root_map(pool, &item_refs).await;
    for item in &item_rows {
        if item.from_relative_path.is_empty() {
            continue; // no source (e.g. mkdir) — nothing to snapshot
        }
        let abs_path = match item.from_root_id.as_deref().and_then(|rid| root_map.get(rid)) {
            Some(root) => root.join(&item.from_relative_path),
            None => Utf8PathBuf::from(&item.from_relative_path),
        };
        if let Some(snapshot) = snapshot_from_metadata(&abs_path) {
            if let Err(e) = repo::update_item_fs_snapshot(
                pool,
                &item.id,
                snapshot.approved_mtime.as_deref(),
                snapshot.approved_size_bytes,
            )
            .await
            {
                tracing::error!(item_id = %item.id, error=%e, "failed to persist FS snapshot at approval");
            }
        }
    }

    // Emit audit event (T026, A7).
    bus.publish(
        TOPIC_PLAN_APPROVED,
        Source::User,
        PlanApproved {
            plan_id: plan_id.to_owned(),
            prior_state: row.state.clone(),
            actor: actor.to_owned(),
            approved_at: approved_at.clone(),
        },
    )
    .await
    .map_err(bus_err)?;

    Ok(PlanApproveResponse {
        plan_id: plan_id.to_owned(),
        new_state: "approved".to_owned(),
        approval_token,
        approved_at,
    })
}
