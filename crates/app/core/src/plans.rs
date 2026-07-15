// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Plan review use cases (spec 017).
//!
//! Entry points:
//! - `list_plans`  — list plans with optional state/origin/date filters, failed-first order.
//! - `get_plan`    — fetch a single plan with its items.
//! - `approve_plan` — transition `ready_for_review` (or `draft`) → `approved`; snapshot item FS metadata.
//! - `discard_plan` — soft-delete a plan (any state except `applying`/`paused`).
//! - `retry_plan`   — create a new plan from failed/cancelled/all items of a terminal parent.
//! - `send_archive_to_trash`       — send `<library_root>/.astro-plan-archive/<planId>/` to OS trash.
//! - `permanently_delete_archive`  — permanently remove archive subtree (requires "DELETE" confirm text + spec-016 guard).
//!
//! The apply-side state transitions (`applying`, `paused`, `applied`, `partially_applied`,
//! `failed`, `cancelled`) are exclusively owned by spec 025's executor; this module
//! guards against overwriting those states.

//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b). Its only
//! cross-module dependency was on the now-extracted `app_core_errors` leaf and
//! nothing else in `app_core` references it. `app_core` re-exports this crate at
//! `app_core::plans` so the public surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use audit::bus::EventBus;
use audit::event_bus::{
    ArchivePermanentlyDeleted, ArchiveSentToTrash, PlanApproved, PlanDiscarded, PlanRetryCreated,
    Source, TOPIC_ARCHIVE_PERMANENTLY_DELETED, TOPIC_ARCHIVE_SENT_TO_TRASH, TOPIC_PLAN_APPROVED,
    TOPIC_PLAN_DISCARDED, TOPIC_PLAN_RETRY_CREATED,
};
use camino::Utf8PathBuf;
use contracts_core::lifecycle::PlanState;
use contracts_core::plans::{
    ArchivePermanentlyDeleteResponse, ArchiveSendToTrashResponse, DestructiveDestination,
    PlanApproveResponse, PlanDetail, PlanDiscardResponse, PlanItemAction, PlanItemDetail,
    PlanItemProtection, PlanItemState, PlanListRequest, PlanListResponse, PlanOrigin,
    PlanRetryResponse, PlanSummary, PlanType, RetryItemsFilter,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use domain_core::ids::{new_id, Timestamp};
use fs_executor::failure::FailureCode;
use fs_executor::ops::{delete_op, trash_op};
use persistence_db::repositories::plans as repo;
use sqlx::SqlitePool;
use std::collections::HashMap;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::errors::bus_err;
use crate::plan_apply::resolve_root_path;

// ── State helpers ─────────────────────────────────────────────────────────────

/// Returns true for terminal plan states (retry creates a NEW plan from these).
fn is_terminal(state: PlanState) -> bool {
    matches!(
        state,
        PlanState::Applied
            | PlanState::PartiallyApplied
            | PlanState::Failed
            | PlanState::Cancelled
            | PlanState::Discarded
    )
}

// ── Constants ─────────────────────────────────────────────────────────────────

/// Default age cutoff for plan list (R-Ret-1). Overridable via spec 018 setting.
pub const DEFAULT_AGE_CUTOFF_DAYS: i64 = 90;

/// Confirm text required for `permanently_delete_archive` (spec 017, T046).
pub const PERMANENT_DELETE_CONFIRM_TEXT: &str = "DELETE";

// ── Error helpers ─────────────────────────────────────────────────────────────

fn db_err(e: persistence_db::DbError) -> ContractError {
    match e {
        persistence_db::DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::PlanNotFound, msg, ErrorSeverity::Blocking, false)
        }
        other => crate::errors::db_err(other),
    }
}

// ── Row mapping helpers ───────────────────────────────────────────────────────

/// Parses a stored plan-state string via `PlanState`'s `serde` mapping
/// (`#[serde(rename_all = "snake_case")]`) so an unrecognised/corrupt value
/// ERRORS instead of silently coercing to `Draft` (audit T1-b).
fn parse_plan_state(s: &str) -> Result<PlanState, ContractError> {
    serde_json::from_value(serde_json::Value::String(s.to_owned())).map_err(|e| {
        ContractError::new(
            ErrorCode::InternalData,
            format!("corrupt plan state {s:?}: {e}"),
            ErrorSeverity::Fatal,
            false,
        )
    })
}

fn parse_plan_origin(s: &str) -> PlanOrigin {
    match s {
        "inbox" => PlanOrigin::Inbox,
        "restructure" => PlanOrigin::Restructure,
        "archive" => PlanOrigin::Archive,
        "project" => PlanOrigin::Project,
        "prepared_view_removal" => PlanOrigin::PreparedViewRemoval,
        "prepared_view_regeneration" => PlanOrigin::PreparedViewRegeneration,
        "prepared_view_generation" => PlanOrigin::PreparedViewGeneration,
        _ => PlanOrigin::Cleanup,
    }
}

fn parse_plan_type(s: &str) -> PlanType {
    match s {
        "split" => PlanType::Split,
        "restructure" => PlanType::Restructure,
        "archive" => PlanType::Archive,
        "source_map" => PlanType::SourceMap,
        "project_create" => PlanType::ProjectCreate,
        "source_view_removal" => PlanType::SourceViewRemoval,
        "source_view_regeneration" => PlanType::SourceViewRegeneration,
        "source_view_generation" => PlanType::SourceViewGeneration,
        _ => PlanType::Cleanup,
    }
}

fn parse_destructive_destination(s: &str) -> DestructiveDestination {
    if s == "trash" {
        DestructiveDestination::OsTrash
    } else {
        DestructiveDestination::Archive
    }
}

fn parse_item_action(s: &str) -> PlanItemAction {
    match s {
        "archive" => PlanItemAction::Archive,
        "delete" => PlanItemAction::Delete,
        "link" => PlanItemAction::Link,
        "write" => PlanItemAction::Write,
        _ => PlanItemAction::Move,
    }
}

fn parse_item_protection(s: &str) -> PlanItemProtection {
    if s == "protected" {
        PlanItemProtection::Protected
    } else {
        PlanItemProtection::Normal
    }
}

fn parse_item_state(s: &str) -> PlanItemState {
    match s {
        "applying" => PlanItemState::Applying,
        "succeeded" => PlanItemState::Succeeded,
        "failed" => PlanItemState::Failed,
        "skipped" => PlanItemState::Skipped,
        "cancelled" => PlanItemState::Cancelled,
        _ => PlanItemState::Pending,
    }
}

fn row_to_summary(row: repo::PlanRow) -> Result<PlanSummary, ContractError> {
    Ok(PlanSummary {
        id: row.id,
        number: row.number,
        title: row.title,
        origin: parse_plan_origin(&row.origin),
        origin_path: row.origin_path,
        state: parse_plan_state(&row.state)?,
        created_at: row.created_at,
        discarded_at: row.discarded_at,
        items_total: row.items_total,
        items_applied: row.items_applied,
        items_failed: row.items_failed,
        items_skipped: row.items_skipped,
        items_cancelled: row.items_cancelled,
        items_pending: row.items_pending,
        total_bytes_required: row.total_bytes_required,
        destructive_destination: parse_destructive_destination(&row.destructive_destination),
        plan_type: parse_plan_type(&row.plan_type),
        parent_plan_id: row.parent_plan_id,
    })
}

fn item_row_to_detail(row: repo::PlanItemRow) -> PlanItemDetail {
    // Resolve absolute paths: currently stored as relative paths.
    // For now surface relative paths; a root-resolver layer is added in spec 025.
    let from = if row.from_relative_path.is_empty() {
        row.from_root_id.clone().unwrap_or_default()
    } else {
        row.from_relative_path.clone()
    };
    let to = if row.to_relative_path.is_empty() {
        row.to_root_id.clone().unwrap_or_default()
    } else {
        row.to_relative_path.clone()
    };

    // Parse provenance JSON if present.
    let provenance = row.provenance.as_deref().and_then(|json| {
        serde_json::from_str::<Vec<contracts_core::plans::ProvenanceEntry>>(json).ok()
    });

    PlanItemDetail {
        id: row.id,
        index: row.item_index,
        name: row.name,
        action: parse_item_action(&row.action),
        from,
        to,
        reason: row.reason,
        protection: parse_item_protection(&row.protection),
        linked: row.linked_entity,
        state: parse_item_state(&row.item_state),
        failure_reason: row.failure_reason,
        provenance,
        approved_mtime: row.approved_mtime,
        approved_size_bytes: row.approved_size_bytes,
        archive_path: row.archive_path,
    }
}

// ── list_plans ────────────────────────────────────────────────────────────────

/// List plans (US1, T012).
///
/// Ordering: failed/partially_applied first, then descending creation time (R-Ret-1).
/// Default age cutoff: 90 days unless overridden by `req.created_after`.
///
/// # Errors
///
/// Returns `ContractError` on database failure.
pub async fn list_plans(
    pool: &SqlitePool,
    req: &PlanListRequest,
) -> Result<PlanListResponse, ContractError> {
    let state_filter = req.state_filter.clone().unwrap_or_default();
    let origin_filter = req.origin_filter.clone().unwrap_or_default();

    // Apply the age cutoff from the request or derive the default (R-Ret-1).
    let cutoff_owned;
    let created_after: Option<&str> = if let Some(ref ca) = req.created_after {
        Some(ca.as_str())
    } else {
        // Derive 90-day default cutoff.
        let cutoff = OffsetDateTime::now_utc() - time::Duration::days(DEFAULT_AGE_CUTOFF_DAYS);
        cutoff_owned = cutoff
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());
        Some(cutoff_owned.as_str())
    };

    let limit = req.limit.unwrap_or(100).clamp(1, 500);

    let rows = repo::list_plans(pool, &state_filter, &origin_filter, created_after, limit)
        .await
        .map_err(db_err)?;

    let plans = rows.into_iter().map(row_to_summary).collect::<Result<Vec<_>, _>>()?;
    Ok(PlanListResponse { plans })
}

// ── get_plan ──────────────────────────────────────────────────────────────────

/// Fetch a single plan with all its items (US1, T013).
///
/// Returns `plan.not_found` if the plan does not exist or is discarded.
///
/// # Errors
///
/// Returns `ContractError` on not-found or database failure.
pub async fn get_plan(pool: &SqlitePool, plan_id: &str) -> Result<PlanDetail, ContractError> {
    let row = repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;
    let item_rows = repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;

    Ok(PlanDetail {
        id: row.id,
        number: row.number,
        title: row.title,
        origin: parse_plan_origin(&row.origin),
        origin_path: row.origin_path,
        state: parse_plan_state(&row.state)?,
        plan_type: parse_plan_type(&row.plan_type),
        destructive_destination: parse_destructive_destination(&row.destructive_destination),
        parent_plan_id: row.parent_plan_id,
        items_total: row.items_total,
        items_applied: row.items_applied,
        items_failed: row.items_failed,
        items_skipped: row.items_skipped,
        items_cancelled: row.items_cancelled,
        items_pending: row.items_pending,
        total_bytes_required: row.total_bytes_required,
        approved_at: row.approved_at,
        discarded_at: row.discarded_at,
        created_at: row.created_at,
        items: item_rows.into_iter().map(item_row_to_detail).collect(),
    })
}

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

// ── mkdir-only auto-apply (user decision 2026-07-04) ─────────────────────────

/// Actor recorded on the `plan.approved` audit event when a plan is
/// auto-approved by the mkdir-only auto-apply path.
pub const AUTO_APPLY_MKDIR_ACTOR: &str = "auto.mkdir_only";

/// Returns `true` when a plan's actions qualify for mkdir-only auto-apply.
///
/// Constitution II nuance (user decision 2026-07-04, supersedes handover D16):
/// the reviewable plan record and the full per-action audit trail are STILL
/// written — only the approval *click* is skipped, and only when the plan
/// creates app-owned structure and touches no user file:
///
/// - every action is `mkdir` (directory creation) or `write_manifest` (the
///   app-owned project-marker record item that accompanies the scaffolding
///   mkdirs; the executor performs no user-file mutation for it), and
/// - at least one action is `mkdir`.
///
/// Any user-file action — `move`, `copy`, `link`, `delete`, `archive`,
/// `trash`, `catalogue`, or anything unrecognised — disables auto-apply and
/// the plan goes through the normal review flow unchanged.
pub fn plan_qualifies_for_mkdir_auto_apply<'a, I>(actions: I) -> bool
where
    I: IntoIterator<Item = &'a str>,
{
    let mut saw_mkdir = false;
    for action in actions {
        match action {
            "mkdir" => saw_mkdir = true,
            "write_manifest" => {}
            _ => return false,
        }
    }
    saw_mkdir
}

/// Auto-approve and start applying a freshly persisted plan when (and only
/// when) it qualifies under [`plan_qualifies_for_mkdir_auto_apply`].
///
/// Returns `Ok(None)` when the plan does not qualify — the normal review flow
/// is untouched. When it qualifies, this drives the SAME [`approve_plan`] and
/// [`crate::plan_apply::apply_plan`] use-cases as the manual path (mirroring
/// the Inbox pipeline in `crate::inbox_plan::apply_inbox_plan`), so the plan
/// row, the `plan.approved` audit event (actor [`AUTO_APPLY_MKDIR_ACTOR`]),
/// the per-item apply audit records, and the failure handling are identical
/// to a user-clicked apply. A failed auto-apply surfaces exactly like a
/// failed manual apply and leaves the plan reviewable.
///
/// # Errors
///
/// Propagates `ContractError` from the approve or apply use-cases; the plan
/// remains in its current (reviewable) state when this errors.
pub async fn auto_apply_mkdir_only_plan(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
) -> Result<Option<contracts_core::plan_apply::PlanApplyResponse>, ContractError> {
    let items = repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    if !plan_qualifies_for_mkdir_auto_apply(items.iter().map(|i| i.action.as_str())) {
        return Ok(None);
    }

    let approve = approve_plan(pool, bus, plan_id, AUTO_APPLY_MKDIR_ACTOR).await?;
    let resp =
        crate::plan_apply::apply_plan(pool, bus, plan_id, &approve.approval_token, None).await?;
    Ok(Some(resp))
}

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

// ── retry_plan ────────────────────────────────────────────────────────────────

/// Create a retry plan from a terminal parent plan (US5, T035, T036).
///
/// The parent must be in a terminal state (`applied`, `partially_applied`,
/// `failed`, `cancelled`, or `discarded`). The new plan starts in `draft`.
/// `parentPlanId` is set on the new plan; the parent is not mutated (T033).
///
/// Default `items_filter` is `"failed"` (R-Retry-1).
///
/// # Errors
///
/// Returns `ContractError` with code:
/// - `parent.not_found` — parent plan does not exist.
/// - `parent.not_terminal` — parent is not in a terminal state.
/// - `no.items.to.retry` — no items match the filter.
#[allow(clippy::too_many_lines)]
pub async fn retry_plan(
    pool: &SqlitePool,
    bus: &EventBus,
    parent_plan_id: &str,
    items_filter: RetryItemsFilter,
) -> Result<PlanRetryResponse, ContractError> {
    // Load parent (including discarded — discarded plans can have retry children).
    let parent = repo::get_plan(pool, parent_plan_id, true).await.map_err(|_| {
        ContractError::new(
            ErrorCode::ParentNotFound,
            format!("parent plan {parent_plan_id} not found"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    let parent_state = parse_plan_state(&parent.state)?;

    // Must be terminal.
    if !is_terminal(parent_state) {
        return Err(ContractError::new(
            ErrorCode::ParentNotTerminal,
            format!("parent plan state {:?} is not terminal", parent.state),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Load parent items to determine which to carry forward.
    let parent_items = repo::list_plan_items(pool, parent_plan_id).await.map_err(db_err)?;

    let items_to_retry: Vec<&repo::PlanItemRow> = match items_filter {
        RetryItemsFilter::Failed => {
            parent_items.iter().filter(|i| i.item_state == "failed").collect()
        }
        RetryItemsFilter::Cancelled => {
            parent_items.iter().filter(|i| i.item_state == "cancelled").collect()
        }
        RetryItemsFilter::All => parent_items.iter().collect(),
    };

    if items_to_retry.is_empty() {
        return Err(ContractError::new(
            ErrorCode::NoItemsToRetry,
            "no items match the specified filter".to_owned(),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let new_plan_id = new_id();
    let at = Timestamp::now_iso();

    // Create new plan (draft) referencing parent.
    repo::insert_plan(
        pool,
        &repo::InsertPlan {
            id: &new_plan_id,
            title: &format!("Retry of plan #{}", parent.number),
            origin: &parent.origin,
            origin_path: parent.origin_path.as_deref(),
            plan_type: &parent.plan_type,
            destructive_destination: &parent.destructive_destination,
            parent_plan_id: Some(parent_plan_id),
            total_bytes_required: 0,
        },
    )
    .await
    .map_err(db_err)?;

    // Copy selected items as `pending` into the new plan.
    for (idx, item) in items_to_retry.iter().enumerate() {
        let new_item_id = new_id();
        repo::insert_plan_item(
            pool,
            &repo::InsertPlanItem {
                id: &new_item_id,
                plan_id: &new_plan_id,
                item_index: i64::try_from(idx + 1).unwrap_or(i64::MAX),
                name: &item.name,
                action: &item.action,
                from_root_id: item.from_root_id.as_deref(),
                from_relative_path: &item.from_relative_path,
                to_root_id: item.to_root_id.as_deref(),
                to_relative_path: &item.to_relative_path,
                reason: &item.reason,
                protection: &item.protection,
                linked_entity: item.linked_entity.as_deref(),
                provenance_json: item.provenance.as_deref(),
                archive_path: item.archive_path.as_deref(),
                // Propagate real source identity when retrying items (FR-016).
                source_id: item.source_id.as_deref(),
                category: item.category.as_deref(),
            },
        )
        .await
        .map_err(db_err)?;
    }

    let items_total = i64::try_from(items_to_retry.len()).unwrap_or(i64::MAX);

    // Emit audit event (T036, A7).
    let filter_label = match items_filter {
        RetryItemsFilter::Failed => "failed",
        RetryItemsFilter::Cancelled => "cancelled",
        RetryItemsFilter::All => "all",
    };

    bus.publish(
        TOPIC_PLAN_RETRY_CREATED,
        Source::User,
        PlanRetryCreated {
            new_plan_id: new_plan_id.clone(),
            parent_plan_id: parent_plan_id.to_owned(),
            items_filter: filter_label.to_owned(),
            items_total,
            at,
        },
    )
    .await
    .map_err(bus_err)?;

    Ok(PlanRetryResponse { new_plan_id, parent_plan_id: parent_plan_id.to_owned(), items_total })
}

// ── Archive management (US6) ──────────────────────────────────────────────────

/// Resolve an archived item's on-disk absolute path.
///
/// `archive_path` is stored root-relative when the item has a `from_root_id`
/// (mirrors the spec-025 executor's `resolve_item_path`, `crates/fs/executor/src/run.rs`);
/// archive-plan generators that predate a resolved root (`archive_generator`,
/// `cleanup_generator`) store an already-absolute path with `from_root_id: None`,
/// so the "no root" branch uses `archive_path` as-is rather than erroring.
fn resolve_archive_abs_path(
    archive_path: &str,
    from_root_id: Option<&str>,
    root_map: &HashMap<String, Utf8PathBuf>,
) -> Utf8PathBuf {
    match from_root_id.and_then(|rid| root_map.get(rid)) {
        Some(root) => root.join(archive_path),
        None => Utf8PathBuf::from(archive_path),
    }
}

/// Map a trash-primitive failure to the closed `archive.send_to_trash` error set.
fn trash_failure_error_code(code: FailureCode) -> ErrorCode {
    match code {
        FailureCode::OsTrashPermissionDenied | FailureCode::PermissionDenied => {
            ErrorCode::OsTrashPermissionDenied
        }
        _ => ErrorCode::OsTrashUnavailable,
    }
}

/// Map a delete-primitive failure to the closed `archive.permanently_delete` error set.
fn delete_failure_error_code(code: FailureCode) -> ErrorCode {
    match code {
        FailureCode::PermissionDenied | FailureCode::ProtectedSource => {
            ErrorCode::PathPermissionDenied
        }
        // Non-permission delete failures (source vanished, volume unavailable,
        // disk full, unknown) — NOT `OsTrashUnavailable`, which is trash-specific
        // and semantically wrong for a non-trash delete failure (review #1).
        _ => ErrorCode::ArchiveDeleteFailed,
    }
}

/// Build a `from_root_id → absolute library root path` map for the given
/// archived items (T023a pattern, `crate::plan_apply::resolve_root_path`).
async fn build_root_map(
    pool: &SqlitePool,
    items: &[&repo::PlanItemRow],
) -> HashMap<String, Utf8PathBuf> {
    let mut root_map = HashMap::new();
    for rid in items.iter().filter_map(|i| i.from_root_id.as_deref()) {
        if root_map.contains_key(rid) {
            continue;
        }
        if let Some(path) = resolve_root_path(pool, rid).await {
            root_map.insert(rid.to_owned(), Utf8PathBuf::from(path));
        }
    }
    root_map
}

/// Send the app-managed archive subtree for a plan to the OS trash (T045).
///
/// Archive path: `<library_root>/.astro-plan-archive/<planId>/`. Sends every
/// archived item's real file to the OS trash via `fs_executor::ops::trash_op`
/// (constitution §II: prefer trash over permanent delete). An item whose
/// on-disk file is already gone (e.g. a repeated call) is a no-op, not a
/// failure. `itemsMoved` on success always reflects real trash outcomes, never
/// the DB item count (the prior stub's bug, #732).
///
/// # Errors
///
/// Returns `ContractError` with code:
/// - `plan.not_found` — no matching plan.
/// - `archive.empty` — plan has no archived items.
/// - `os_trash.unavailable` / `os_trash.permission.denied` — every item's real
///   trash attempt failed (no items were moved).
pub async fn send_archive_to_trash(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
) -> Result<ArchiveSendToTrashResponse, ContractError> {
    let row = repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    let items = repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    let archive_items: Vec<&repo::PlanItemRow> =
        items.iter().filter(|i| i.archive_path.is_some()).collect();

    if archive_items.is_empty() {
        return Err(ContractError::new(
            ErrorCode::ArchiveEmpty,
            format!("plan {} has no archived items", row.id),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let root_map = build_root_map(pool, &archive_items).await;

    let mut items_moved: i64 = 0;
    let mut last_failure: Option<(FailureCode, String)> = None;
    for item in &archive_items {
        // Filtered by `archive_path.is_some()` above.
        let archive_rel = item.archive_path.as_deref().unwrap_or_default();
        let abs_path =
            resolve_archive_abs_path(archive_rel, item.from_root_id.as_deref(), &root_map);

        if !abs_path.exists() {
            // Already gone (e.g. a repeated call) — not a failure, no-op.
            continue;
        }

        match trash_op::trash_file(&abs_path, None) {
            Ok(_) => items_moved += 1,
            Err((failure, _)) => {
                tracing::warn!(item_id = %item.id, path = %abs_path, error = %failure, "archive item trash failed");
                last_failure = Some((failure.code, failure.message));
            }
        }
    }

    if items_moved == 0 {
        if let Some((code, message)) = last_failure {
            return Err(ContractError::new(
                trash_failure_error_code(code),
                message,
                ErrorSeverity::Blocking,
                code.is_recoverable(),
            ));
        }
    }

    let at = Timestamp::now_iso();
    let audit_id = new_id();

    // Emit audit event (T045) — real outcome, not the DB item count (#732).
    bus.publish(
        TOPIC_ARCHIVE_SENT_TO_TRASH,
        Source::User,
        ArchiveSentToTrash { plan_id: plan_id.to_owned(), items_moved, at },
    )
    .await
    .map_err(bus_err)?;

    Ok(ArchiveSendToTrashResponse { plan_id: plan_id.to_owned(), items_moved, audit_id })
}

/// Permanently delete the app-managed archive subtree for a plan (T046).
///
/// Requires `confirm_text == "DELETE"` guard. Honors spec-016 protection —
/// if `block_permanent_delete` is true in settings, this operation is blocked.
///
/// # Errors
///
/// Returns `ContractError` with code:
/// - `confirm.text.mismatch` — confirm text is not "DELETE".
/// - `plan.blocked_by_protection` — spec-016 blockPermanentDelete is enabled.
/// - `plan.not_found` — no matching plan.
/// - `archive.empty` — plan has no archived items.
/// - `path.permission_denied` / `archive.delete_failed` — every item's real
///   delete attempt failed (no items were deleted).
pub async fn permanently_delete_archive(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
    confirm_text: &str,
    block_permanent_delete: bool,
) -> Result<ArchivePermanentlyDeleteResponse, ContractError> {
    // Confirm text guard.
    if confirm_text != PERMANENT_DELETE_CONFIRM_TEXT {
        return Err(ContractError::new(
            ErrorCode::ConfirmTextMismatch,
            "confirm text must be exactly \"DELETE\"".to_owned(),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Spec-016 protection guard.
    if block_permanent_delete {
        return Err(ContractError::new(
            ErrorCode::PlanBlockedByProtection,
            "permanent delete is disabled by the blockPermanentDelete setting (spec 016)"
                .to_owned(),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let row = repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    let items = repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    let archive_items: Vec<&repo::PlanItemRow> =
        items.iter().filter(|i| i.archive_path.is_some()).collect();

    if archive_items.is_empty() {
        return Err(ContractError::new(
            ErrorCode::ArchiveEmpty,
            format!("plan {} has no archived items", row.id),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let root_map = build_root_map(pool, &archive_items).await;

    let mut items_deleted: i64 = 0;
    let mut last_failure: Option<(FailureCode, String)> = None;
    for item in &archive_items {
        let archive_rel = item.archive_path.as_deref().unwrap_or_default();
        let abs_path =
            resolve_archive_abs_path(archive_rel, item.from_root_id.as_deref(), &root_map);

        if !abs_path.exists() {
            // Already gone (e.g. a repeated call) — not a failure, no-op.
            continue;
        }

        // `confirm_required = true`: the confirm-text guard above already
        // gated entry into this function (constitution §II: permanent
        // delete is always behind explicit confirmation).
        match delete_op::delete_file(&abs_path, true) {
            Ok(()) => items_deleted += 1,
            Err((failure, _)) => {
                tracing::warn!(item_id = %item.id, path = %abs_path, error = %failure, "archive item permanent delete failed");
                last_failure = Some((failure.code, failure.message));
            }
        }
    }

    if items_deleted == 0 {
        if let Some((code, message)) = last_failure {
            return Err(ContractError::new(
                delete_failure_error_code(code),
                message,
                ErrorSeverity::Blocking,
                code.is_recoverable(),
            ));
        }
    }

    let at = Timestamp::now_iso();
    let audit_id = new_id();

    // Emit audit event (T046) — real outcome, not the DB item count (#732).
    bus.publish(
        TOPIC_ARCHIVE_PERMANENTLY_DELETED,
        Source::User,
        ArchivePermanentlyDeleted { plan_id: plan_id.to_owned(), items_deleted, at },
    )
    .await
    .map_err(bus_err)?;

    Ok(ArchivePermanentlyDeleteResponse { plan_id: plan_id.to_owned(), items_deleted, audit_id })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use audit::EventBus;
    use persistence_db::{repositories::plans as repo, Database};

    async fn setup() -> (Database, EventBus) {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    async fn insert_draft(db: &Database, id: &str) {
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id,
                title: "Test",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "archive",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();
    }

    async fn add_item(db: &Database, plan_id: &str, item_id: &str, action: &str) {
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: item_id,
                plan_id,
                item_index: 1,
                name: "file.fits",
                action,
                from_root_id: None,
                from_relative_path: "raw/file.fits",
                to_root_id: None,
                to_relative_path: "archive/file.fits",
                reason: "test",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: Some(".astro-plan-archive/p1/file.fits"),
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();
    }

    /// Like `add_item`, but `archive_path` points at a real, caller-supplied
    /// absolute path (`from_root_id: None`, matching every real archive
    /// generator — `resolve_archive_abs_path` then uses it as-is), so
    /// `send_archive_to_trash`/`permanently_delete_archive` real-fs tests can
    /// exercise an on-disk file.
    async fn add_item_with_real_archive_path(
        db: &Database,
        plan_id: &str,
        item_id: &str,
        archive_abs_path: &str,
    ) {
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: item_id,
                plan_id,
                item_index: 1,
                name: "file.fits",
                action: "archive",
                from_root_id: None,
                from_relative_path: "raw/file.fits",
                to_root_id: None,
                to_relative_path: archive_abs_path,
                reason: "test",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: Some(archive_abs_path),
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();
    }

    // ── list_plans ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_plans_returns_non_discarded() {
        let (db, _bus) = setup().await;
        insert_draft(&db, "p1").await;
        insert_draft(&db, "p2").await;
        repo::soft_delete_plan(db.pool(), "p2", "2026-06-01T00:00:00Z").await.unwrap();

        let resp = list_plans(
            db.pool(),
            &PlanListRequest {
                created_after: Some("1970-01-01T00:00:00Z".to_owned()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(resp.plans.len(), 1);
        assert_eq!(resp.plans[0].id, "p1");
    }

    #[tokio::test]
    async fn list_plans_failed_first_ordering() {
        let (db, _bus) = setup().await;
        insert_draft(&db, "p-draft").await;
        insert_draft(&db, "p-failed").await;
        repo::update_plan_state(db.pool(), "p-failed", "failed").await.unwrap();

        let resp = list_plans(
            db.pool(),
            &PlanListRequest {
                state_filter: Some(vec!["draft".to_owned(), "failed".to_owned()]),
                created_after: Some("1970-01-01T00:00:00Z".to_owned()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(resp.plans[0].id, "p-failed", "failed plan should be first");
    }

    // ── get_plan ──────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn get_plan_returns_not_found_for_missing() {
        let (db, _bus) = setup().await;
        let err = get_plan(db.pool(), "does-not-exist").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotFound);
    }

    #[tokio::test]
    async fn get_plan_returns_items() {
        let (db, _bus) = setup().await;
        insert_draft(&db, "p1").await;
        add_item(&db, "p1", "item-1", "move").await;

        let detail = get_plan(db.pool(), "p1").await.unwrap();
        assert_eq!(detail.id, "p1");
        assert_eq!(detail.items.len(), 1);
        assert_eq!(detail.items[0].name, "file.fits");
    }

    // ── parse_plan_state (audit T1-b) ────────────────────────────────────────

    #[test]
    fn parse_plan_state_accepts_every_stored_snake_case_value() {
        for (raw, expected) in [
            ("draft", PlanState::Draft),
            ("ready_for_review", PlanState::ReadyForReview),
            ("approved", PlanState::Approved),
            ("applying", PlanState::Applying),
            ("paused", PlanState::Paused),
            ("applied", PlanState::Applied),
            ("partially_applied", PlanState::PartiallyApplied),
            ("failed", PlanState::Failed),
            ("cancelled", PlanState::Cancelled),
            ("discarded", PlanState::Discarded),
        ] {
            assert_eq!(parse_plan_state(raw).unwrap(), expected, "for {raw:?}");
        }
    }

    #[test]
    fn parse_plan_state_errors_on_unknown_value_instead_of_defaulting() {
        // Previously silently coerced to `PlanState::Draft` (T1-b bug). A
        // `plans.state` CHECK constraint (migration) additionally blocks a
        // corrupt value from ever being persisted via SQL, so the direct
        // parser-level regression below is the reachable case; `parse_plan_state`
        // is still the load-bearing guard against pre-constraint or
        // out-of-band-corrupted rows.
        let err = parse_plan_state("bogus_corrupt_state").unwrap_err();
        assert_eq!(err.code, ErrorCode::InternalData);
    }

    // ── approve_plan ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn approve_plan_rejects_wrong_state() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        add_item(&db, "p1", "item-1", "move").await;

        let err = approve_plan(db.pool(), &bus, "p1", "tester").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanInvalidState);
    }

    #[tokio::test]
    async fn approve_plan_rejects_empty_plan() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        repo::update_plan_state(db.pool(), "p1", "ready_for_review").await.unwrap();

        let err = approve_plan(db.pool(), &bus, "p1", "tester").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanItemsEmpty);
    }

    #[tokio::test]
    async fn approve_plan_happy_path() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        add_item(&db, "p1", "item-1", "move").await;
        repo::update_plan_state(db.pool(), "p1", "ready_for_review").await.unwrap();

        let resp = approve_plan(db.pool(), &bus, "p1", "tester").await.unwrap();
        assert_eq!(resp.plan_id, "p1");
        assert_eq!(resp.new_state, "approved");
        assert!(!resp.approval_token.is_empty());

        let row = repo::get_plan(db.pool(), "p1", false).await.unwrap();
        assert_eq!(row.state, "approved");
    }

    // ── discard_plan ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn discard_plan_happy_path() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;

        let resp = discard_plan(db.pool(), &bus, "p1").await.unwrap();
        assert_eq!(resp.plan_id, "p1");
        assert!(!resp.discarded_at.is_empty());

        let err = get_plan(db.pool(), "p1").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotFound);
    }

    #[tokio::test]
    async fn discard_plan_rejects_applying() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        repo::update_plan_state(db.pool(), "p1", "applying").await.unwrap();

        let err = discard_plan(db.pool(), &bus, "p1").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanInProgress);
    }

    #[tokio::test]
    async fn discard_plan_idempotent_already_discarded() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        discard_plan(db.pool(), &bus, "p1").await.unwrap();

        // Second call should return the existing discarded_at without error.
        let resp = discard_plan(db.pool(), &bus, "p1").await.unwrap();
        assert_eq!(resp.plan_id, "p1");
    }

    // ── retry_plan ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn retry_plan_requires_terminal_parent() {
        let (db, bus) = setup().await;
        insert_draft(&db, "parent").await;

        let err =
            retry_plan(db.pool(), &bus, "parent", RetryItemsFilter::Failed).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ParentNotTerminal);
    }

    #[tokio::test]
    async fn retry_plan_no_items_to_retry() {
        let (db, bus) = setup().await;
        insert_draft(&db, "parent").await;
        add_item(&db, "parent", "item-1", "move").await;
        repo::update_plan_state(db.pool(), "parent", "failed").await.unwrap();
        // item is still in "pending" state (not failed).

        let err =
            retry_plan(db.pool(), &bus, "parent", RetryItemsFilter::Failed).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::NoItemsToRetry);
    }

    #[tokio::test]
    async fn retry_plan_all_filter_creates_new_plan() {
        let (db, bus) = setup().await;
        insert_draft(&db, "parent").await;
        add_item(&db, "parent", "item-1", "move").await;
        repo::update_plan_state(db.pool(), "parent", "failed").await.unwrap();

        let resp = retry_plan(db.pool(), &bus, "parent", RetryItemsFilter::All).await.unwrap();
        assert_eq!(resp.parent_plan_id, "parent");
        assert_eq!(resp.items_total, 1);

        // Parent is not mutated.
        let parent_row = repo::get_plan(db.pool(), "parent", false).await.unwrap();
        assert_eq!(parent_row.state, "failed");

        // New plan has parent_plan_id set.
        let new_row = repo::get_plan(db.pool(), &resp.new_plan_id, false).await.unwrap();
        assert_eq!(new_row.parent_plan_id, Some("parent".to_owned()));
        assert_eq!(new_row.state, "draft");
        assert_eq!(new_row.items_total, 1);
    }

    // ── permanently_delete_archive ────────────────────────────────────────────

    #[tokio::test]
    async fn permanently_delete_requires_delete_confirm_text() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;

        let err =
            permanently_delete_archive(db.pool(), &bus, "p1", "wrong", false).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ConfirmTextMismatch);
    }

    #[tokio::test]
    async fn permanently_delete_blocked_by_spec016_protection() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        add_item(&db, "p1", "item-1", "move").await;

        let err =
            permanently_delete_archive(db.pool(), &bus, "p1", "DELETE", true).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanBlockedByProtection);
    }

    /// #732: `permanently_delete_archive` must actually remove the on-disk
    /// archived file, not just record an audit event over an untouched
    /// filesystem. Deterministic (unlike OS trash): `delete_op::delete_file`
    /// is a direct `std::fs::remove_file`.
    #[tokio::test]
    async fn permanently_delete_archive_removes_real_file() {
        let (db, bus) = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("archived.fits");
        std::fs::write(&file, b"data").unwrap();
        let abs_path = file.to_str().unwrap();

        insert_draft(&db, "p1").await;
        add_item_with_real_archive_path(&db, "p1", "item-1", abs_path).await;

        let resp =
            permanently_delete_archive(db.pool(), &bus, "p1", "DELETE", false).await.unwrap();
        assert_eq!(resp.items_deleted, 1);
        assert!(!file.exists(), "the real archived file must be gone from disk");
    }

    /// A repeated call (file already deleted) is an idempotent no-op, not a
    /// failure — the item's archive_path row survives a first successful
    /// call, so a second click must not error.
    #[tokio::test]
    async fn permanently_delete_archive_is_idempotent_when_already_gone() {
        let (db, bus) = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("already_gone.fits");
        // Never created on disk.
        let abs_path = file.to_str().unwrap();

        insert_draft(&db, "p1").await;
        add_item_with_real_archive_path(&db, "p1", "item-1", abs_path).await;

        let resp =
            permanently_delete_archive(db.pool(), &bus, "p1", "DELETE", false).await.unwrap();
        assert_eq!(resp.items_deleted, 0);
    }

    // ── send_archive_to_trash ─────────────────────────────────────────────────

    #[tokio::test]
    async fn send_archive_to_trash_rejects_empty_archive() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        // Item with no `archive_path` set (`add_item` always sets one; build
        // this row directly so the archive-empty precondition is real).
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: "item-1",
                plan_id: "p1",
                item_index: 1,
                name: "file.fits",
                action: "move",
                from_root_id: None,
                from_relative_path: "raw/file.fits",
                to_root_id: None,
                to_relative_path: "moved/file.fits",
                reason: "test",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: None,
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();

        let err = send_archive_to_trash(db.pool(), &bus, "p1").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ArchiveEmpty);
    }

    /// #732: exercises the real `fs_executor::ops::trash_op` primitive.
    /// OS trash availability is environment-dependent (CI sandboxes may lack
    /// XDG trash) — mirrors `trash_op`'s own test precedent
    /// (`crates/fs/executor/src/ops/trash_op.rs`): assert on the contract
    /// invariant (no silent success without either the file being gone or a
    /// real, typed trash error) rather than a single hard-coded outcome.
    #[tokio::test]
    async fn send_archive_to_trash_moves_real_file_or_reports_real_failure() {
        let (db, bus) = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("archived.fits");
        std::fs::write(&file, b"data").unwrap();
        let abs_path = file.to_str().unwrap();

        insert_draft(&db, "p1").await;
        add_item_with_real_archive_path(&db, "p1", "item-1", abs_path).await;

        match send_archive_to_trash(db.pool(), &bus, "p1").await {
            Ok(resp) => {
                assert_eq!(resp.items_moved, 1);
                assert!(!file.exists(), "trashed file must be gone from its original path");
            }
            Err(err) => {
                assert!(
                    matches!(
                        err.code,
                        ErrorCode::OsTrashUnavailable | ErrorCode::OsTrashPermissionDenied
                    ),
                    "unexpected error code: {:?}",
                    err.code
                );
                // No silent loss: the file must survive a genuinely failed trash.
                assert!(file.exists());
            }
        }
    }

    /// Review #2: `cleanup_generator::generate_raw_frame_plan` sets
    /// `from_root_id: Some(row.root_id)` with a root-*relative* `archive_path`
    /// (`protection::compute_archive_destination`) — the `Some(root) =>
    /// root.join(archive_path)` branch of `resolve_archive_abs_path` is a real
    /// production path, not just the `from_root_id: None`/absolute-path shape
    /// every other test above exercises. Registers a real source (mirrors
    /// `plan_apply::resolve_root_path_reflects_remap_not_stale_cache`) so
    /// `resolve_root_path`'s `registered_sources` fallback resolves it, then
    /// exercises BOTH commands against real files anchored under that root.
    #[tokio::test]
    async fn archive_commands_resolve_root_relative_archive_path_via_registered_root() {
        use contracts_core::first_run::{
            OrganizationState, RegisterSourceRequest, ScanDepth, SourceKind,
        };

        let (db, bus) = setup().await;
        let root_dir = tempfile::tempdir().unwrap();

        let reg = crate::first_run::register_source(
            db.pool(),
            &bus,
            &RegisterSourceRequest {
                kind: SourceKind::Project,
                path: root_dir.path().to_str().unwrap().to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();
        let root_id = reg.source_id;

        // Plan A: send_archive_to_trash, root-relative archive_path.
        let trash_rel = "raw/.astro-plan-archive/plan-a/item-1-file.fits";
        std::fs::create_dir_all(root_dir.path().join("raw/.astro-plan-archive/plan-a")).unwrap();
        let trash_abs = root_dir.path().join(trash_rel);
        std::fs::write(&trash_abs, b"data").unwrap();

        insert_draft(&db, "plan-a").await;
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: "item-a-1",
                plan_id: "plan-a",
                item_index: 1,
                name: "file.fits",
                action: "archive",
                from_root_id: Some(&root_id),
                from_relative_path: "raw/file.fits",
                to_root_id: None,
                to_relative_path: "",
                reason: "test",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: Some(trash_rel),
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();

        match send_archive_to_trash(db.pool(), &bus, "plan-a").await {
            Ok(resp) => {
                assert_eq!(resp.items_moved, 1);
                assert!(
                    !trash_abs.exists(),
                    "root-relative archive_path must resolve to a real, trashable file"
                );
            }
            Err(err) => {
                // Environment-dependent (no OS trash in CI sandbox, review #732
                // precedent) — the root MUST still have resolved (a failure to
                // resolve the root at all would surface as archive.empty, not
                // a trash-specific code).
                assert!(matches!(
                    err.code,
                    ErrorCode::OsTrashUnavailable | ErrorCode::OsTrashPermissionDenied
                ));
                assert!(trash_abs.exists());
            }
        }

        // Plan B: permanently_delete_archive, root-relative archive_path.
        // Deterministic (std::fs::remove_file, no OS-trash dependency).
        let delete_rel = "raw/.astro-plan-archive/plan-b/item-1-file.fits";
        std::fs::create_dir_all(root_dir.path().join("raw/.astro-plan-archive/plan-b")).unwrap();
        let delete_abs = root_dir.path().join(delete_rel);
        std::fs::write(&delete_abs, b"data").unwrap();

        insert_draft(&db, "plan-b").await;
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: "item-b-1",
                plan_id: "plan-b",
                item_index: 1,
                name: "file.fits",
                action: "archive",
                from_root_id: Some(&root_id),
                from_relative_path: "raw/file.fits",
                to_root_id: None,
                to_relative_path: "",
                reason: "test",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: Some(delete_rel),
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();

        let resp =
            permanently_delete_archive(db.pool(), &bus, "plan-b", "DELETE", false).await.unwrap();
        assert_eq!(resp.items_deleted, 1);
        assert!(
            !delete_abs.exists(),
            "root-relative archive_path must resolve to a real, deletable file"
        );
    }

    // ── mkdir-only auto-apply predicate (user decision 2026-07-04) ────────────

    #[test]
    fn predicate_accepts_mkdir_only_plan() {
        assert!(plan_qualifies_for_mkdir_auto_apply(["mkdir", "mkdir", "mkdir"]));
    }

    #[test]
    fn predicate_accepts_scaffolding_shape_mkdir_plus_write_manifest() {
        // The project scaffolding plan: N mkdir folders + 1 app-owned marker.
        assert!(plan_qualifies_for_mkdir_auto_apply(["mkdir", "mkdir", "write_manifest"]));
    }

    #[test]
    fn predicate_rejects_single_user_file_action_among_mkdirs() {
        for user_action in ["move", "copy", "link", "delete", "archive", "trash", "catalogue"] {
            assert!(
                !plan_qualifies_for_mkdir_auto_apply(["mkdir", user_action, "mkdir"]),
                "one '{user_action}' action must disable auto-apply"
            );
        }
    }

    #[test]
    fn predicate_rejects_unknown_actions() {
        assert!(!plan_qualifies_for_mkdir_auto_apply(["mkdir", "junction"]));
        assert!(!plan_qualifies_for_mkdir_auto_apply(["frobnicate"]));
    }

    #[test]
    fn predicate_rejects_empty_plan() {
        assert!(!plan_qualifies_for_mkdir_auto_apply([]));
    }

    #[test]
    fn predicate_rejects_write_manifest_only_plan() {
        // No directory creation → nothing to auto-apply; keep review flow.
        assert!(!plan_qualifies_for_mkdir_auto_apply(["write_manifest"]));
    }

    // ── mkdir-only auto-apply use-case ─────────────────────────────────────────

    /// Insert a `ready_for_review` plan with the given item actions and
    /// per-item destination paths.
    async fn insert_review_plan(db: &Database, id: &str, actions: &[(&str, &str)]) {
        insert_draft(db, id).await;
        for (idx, (action, dest)) in actions.iter().enumerate() {
            repo::insert_plan_item(
                db.pool(),
                &repo::InsertPlanItem {
                    id: &format!("{id}-item-{idx}"),
                    plan_id: id,
                    item_index: i64::try_from(idx).unwrap(),
                    name: "entry",
                    action,
                    from_root_id: None,
                    from_relative_path: "",
                    to_root_id: None,
                    to_relative_path: dest,
                    reason: "test",
                    protection: "normal",
                    linked_entity: None,
                    provenance_json: None,
                    archive_path: None,
                    source_id: None,
                    category: None,
                },
            )
            .await
            .unwrap();
        }
        repo::update_plan_state(db.pool(), id, "ready_for_review").await.unwrap();
    }

    /// Poll until the plan reaches a terminal state (bounded).
    async fn wait_terminal(db: &Database, plan_id: &str) -> String {
        for _ in 0..200 {
            let row = repo::get_plan(db.pool(), plan_id, false).await.unwrap();
            match row.state.as_str() {
                "applied" | "partially_applied" | "failed" | "cancelled" | "paused" | "stale" => {
                    return row.state;
                }
                _ => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
            }
        }
        panic!("plan {plan_id} never reached a terminal state");
    }

    /// A qualifying mkdir-only plan is approved + applied and the directories
    /// really exist on disk afterwards (same executor as manual apply).
    #[tokio::test]
    async fn auto_apply_creates_directories_for_mkdir_only_plan() {
        let (db, bus) = setup().await;
        let root = tempfile::tempdir().unwrap();
        let base = root.path().to_str().unwrap().to_owned();

        insert_review_plan(
            &db,
            "p-auto",
            &[
                ("mkdir", &format!("{base}/proj/lights")),
                ("mkdir", &format!("{base}/proj/darks")),
                ("write_manifest", &format!("{base}/proj/.marker.json")),
            ],
        )
        .await;

        let resp = auto_apply_mkdir_only_plan(db.pool(), &bus, "p-auto").await.unwrap();
        assert!(resp.is_some(), "qualifying plan must be auto-applied");

        let terminal = wait_terminal(&db, "p-auto").await;
        assert_eq!(terminal, "applied");
        assert!(std::path::Path::new(&format!("{base}/proj/lights")).is_dir());
        assert!(std::path::Path::new(&format!("{base}/proj/darks")).is_dir());
    }

    /// A plan containing a user-file action is left untouched in
    /// `ready_for_review` (normal review flow).
    #[tokio::test]
    async fn auto_apply_skips_plan_with_user_file_action() {
        let (db, bus) = setup().await;
        insert_review_plan(&db, "p-mixed", &[("mkdir", "/tmp/x"), ("move", "/tmp/y")]).await;

        let resp = auto_apply_mkdir_only_plan(db.pool(), &bus, "p-mixed").await.unwrap();
        assert!(resp.is_none(), "non-qualifying plan must not be auto-applied");

        let row = repo::get_plan(db.pool(), "p-mixed", false).await.unwrap();
        assert_eq!(row.state, "ready_for_review", "plan must remain reviewable");
        assert!(row.approval_token.is_none(), "no approval may be recorded");
    }

    /// A failed auto-apply surfaces like a failed manual apply: the plan ends
    /// in a terminal failure state and remains visible/reviewable.
    #[tokio::test]
    async fn auto_apply_failure_leaves_plan_reviewable() {
        let (db, bus) = setup().await;
        let root = tempfile::tempdir().unwrap();
        let base = root.path().to_str().unwrap().to_owned();
        // Destination exists as a FILE → mkdir fails with
        // conflict.destination_exists (never overwrite silently).
        let blocker = format!("{base}/blocked");
        std::fs::write(&blocker, b"file in the way").unwrap();

        insert_review_plan(&db, "p-fail", &[("mkdir", &blocker)]).await;

        let resp = auto_apply_mkdir_only_plan(db.pool(), &bus, "p-fail").await.unwrap();
        assert!(resp.is_some(), "the apply run must start");

        let terminal = wait_terminal(&db, "p-fail").await;
        assert_eq!(terminal, "failed", "failed apply must land in the failed state");
        // The blocking file was not overwritten.
        assert_eq!(std::fs::read(&blocker).unwrap(), b"file in the way");
    }
}
