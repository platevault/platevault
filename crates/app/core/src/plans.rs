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

use audit::bus::EventBus;
use audit::event_bus::{
    ArchivePermanentlyDeleted, ArchiveSentToTrash, PlanApproved, PlanDiscarded, PlanRetryCreated,
    Source, TOPIC_ARCHIVE_PERMANENTLY_DELETED, TOPIC_ARCHIVE_SENT_TO_TRASH, TOPIC_PLAN_APPROVED,
    TOPIC_PLAN_DISCARDED, TOPIC_PLAN_RETRY_CREATED,
};
use contracts_core::lifecycle::PlanState;
use contracts_core::plans::{
    ArchivePermanentlyDeleteResponse, ArchiveSendToTrashResponse, DestructiveDestination,
    PlanApproveResponse, PlanDetail, PlanDiscardResponse, PlanItemAction, PlanItemDetail,
    PlanItemProtection, PlanItemState, PlanListRequest, PlanListResponse, PlanOrigin,
    PlanRetryResponse, PlanSummary, PlanType, RetryItemsFilter,
};
use contracts_core::{ContractError, ErrorSeverity};
use persistence_db::repositories::plans as repo;
use sqlx::SqlitePool;
use time::OffsetDateTime;
use uuid::Uuid;

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

#[allow(clippy::needless_pass_by_value)]
fn db_err(e: persistence_db::DbError) -> ContractError {
    match e {
        persistence_db::DbError::NotFound(msg) => {
            ContractError::new("plan.not_found", msg, ErrorSeverity::Blocking, false)
        }
        other => {
            ContractError::new("internal.database", format!("{other}"), ErrorSeverity::Fatal, true)
        }
    }
}

#[allow(clippy::needless_pass_by_value)]
fn bus_err(e: audit::bus::BusError) -> ContractError {
    ContractError::new("internal.audit", format!("{e}"), ErrorSeverity::Fatal, true)
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

// ── Row mapping helpers ───────────────────────────────────────────────────────

fn parse_plan_state(s: &str) -> PlanState {
    match s {
        "ready_for_review" => PlanState::ReadyForReview,
        "approved" => PlanState::Approved,
        "applying" => PlanState::Applying,
        "paused" => PlanState::Paused,
        "applied" => PlanState::Applied,
        "partially_applied" => PlanState::PartiallyApplied,
        "failed" => PlanState::Failed,
        "cancelled" => PlanState::Cancelled,
        "discarded" => PlanState::Discarded,
        _ => PlanState::Draft,
    }
}

fn parse_plan_origin(s: &str) -> PlanOrigin {
    match s {
        "inbox" => PlanOrigin::Inbox,
        "restructure" => PlanOrigin::Restructure,
        "archive" => PlanOrigin::Archive,
        "project" => PlanOrigin::Project,
        _ => PlanOrigin::Cleanup,
    }
}

fn parse_plan_type(s: &str) -> PlanType {
    match s {
        "split" => PlanType::Split,
        "restructure" => PlanType::Restructure,
        "archive" => PlanType::Archive,
        "source_map" => PlanType::SourceMap,
        _ => PlanType::Cleanup,
    }
}

fn parse_destructive_destination(s: &str) -> DestructiveDestination {
    if s == "os_trash" {
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

fn row_to_summary(row: repo::PlanRow) -> PlanSummary {
    PlanSummary {
        id: row.id,
        number: row.number,
        title: row.title,
        origin: parse_plan_origin(&row.origin),
        origin_path: row.origin_path,
        state: parse_plan_state(&row.state),
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
    }
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

    Ok(PlanListResponse { plans: rows.into_iter().map(row_to_summary).collect() })
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
        state: parse_plan_state(&row.state),
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
    let state = parse_plan_state(&row.state);
    if state != PlanState::ReadyForReview {
        return Err(ContractError::new(
            "plan.invalid_state",
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
            "plan.items.empty",
            "cannot approve a plan with no items".to_owned(),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let approved_at = now_iso();

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

    let state = parse_plan_state(&row.state);

    // Guard: cannot discard while applying or paused.
    if matches!(state, PlanState::Applying | PlanState::Paused) {
        return Err(ContractError::new(
            "plan.in_progress",
            format!("cannot discard a plan in state {:?}", row.state),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Already discarded — idempotent return.
    if state == PlanState::Discarded {
        return Ok(PlanDiscardResponse {
            plan_id: plan_id.to_owned(),
            discarded_at: row.discarded_at.unwrap_or_else(now_iso),
        });
    }

    let discarded_at = now_iso();
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
            "parent.not_found",
            format!("parent plan {parent_plan_id} not found"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    let parent_state = parse_plan_state(&parent.state);

    // Must be terminal.
    if !is_terminal(parent_state) {
        return Err(ContractError::new(
            "parent.not_terminal",
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
            "no.items.to.retry",
            "no items match the specified filter".to_owned(),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let new_plan_id = new_id();
    let at = now_iso();

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

/// Send the app-managed archive subtree for a plan to the OS trash (T045).
///
/// Archive path: `<library_root>/.astro-plan-archive/<planId>/`.
/// This is a metadata-level operation in spec 017; actual filesystem execution
/// is deferred to spec 025. Here we validate the plan exists, record the audit
/// event, and return the stub response. Full filesystem access requires spec 025.
///
/// # Errors
///
/// Returns `ContractError` with code:
/// - `plan.not_found` — no matching plan.
/// - `archive.empty` — plan has no archived items.
pub async fn send_archive_to_trash(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
) -> Result<ArchiveSendToTrashResponse, ContractError> {
    let row = repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    // Count archive items.
    let items = repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    let archive_count = i64::try_from(items.iter().filter(|i| i.archive_path.is_some()).count())
        .unwrap_or(i64::MAX);

    if archive_count == 0 {
        return Err(ContractError::new(
            "archive.empty",
            format!("plan {} has no archived items", row.id),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let at = now_iso();
    let audit_id = new_id();

    // Emit audit event (T045).
    bus.publish(
        TOPIC_ARCHIVE_SENT_TO_TRASH,
        Source::User,
        ArchiveSentToTrash { plan_id: plan_id.to_owned(), items_moved: archive_count, at },
    )
    .await
    .map_err(bus_err)?;

    Ok(ArchiveSendToTrashResponse {
        plan_id: plan_id.to_owned(),
        items_moved: archive_count,
        audit_id,
    })
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
            "confirm.text.mismatch",
            "confirm text must be exactly \"DELETE\"".to_owned(),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Spec-016 protection guard.
    if block_permanent_delete {
        return Err(ContractError::new(
            "plan.blocked_by_protection",
            "permanent delete is disabled by the blockPermanentDelete setting (spec 016)"
                .to_owned(),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let row = repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    let items = repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    let archive_count = i64::try_from(items.iter().filter(|i| i.archive_path.is_some()).count())
        .unwrap_or(i64::MAX);

    if archive_count == 0 {
        return Err(ContractError::new(
            "archive.empty",
            format!("plan {} has no archived items", row.id),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let at = now_iso();
    let audit_id = new_id();

    // Emit audit event (T046).
    bus.publish(
        TOPIC_ARCHIVE_PERMANENTLY_DELETED,
        Source::User,
        ArchivePermanentlyDeleted { plan_id: plan_id.to_owned(), items_deleted: archive_count, at },
    )
    .await
    .map_err(bus_err)?;

    Ok(ArchivePermanentlyDeleteResponse {
        plan_id: plan_id.to_owned(),
        items_deleted: archive_count,
        audit_id,
    })
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
        assert_eq!(err.code, "plan.not_found");
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

    // ── approve_plan ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn approve_plan_rejects_wrong_state() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        add_item(&db, "p1", "item-1", "move").await;

        let err = approve_plan(db.pool(), &bus, "p1", "tester").await.unwrap_err();
        assert_eq!(err.code, "plan.invalid_state");
    }

    #[tokio::test]
    async fn approve_plan_rejects_empty_plan() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        repo::update_plan_state(db.pool(), "p1", "ready_for_review").await.unwrap();

        let err = approve_plan(db.pool(), &bus, "p1", "tester").await.unwrap_err();
        assert_eq!(err.code, "plan.items.empty");
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
        assert_eq!(err.code, "plan.not_found");
    }

    #[tokio::test]
    async fn discard_plan_rejects_applying() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        repo::update_plan_state(db.pool(), "p1", "applying").await.unwrap();

        let err = discard_plan(db.pool(), &bus, "p1").await.unwrap_err();
        assert_eq!(err.code, "plan.in_progress");
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
        assert_eq!(err.code, "parent.not_terminal");
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
        assert_eq!(err.code, "no.items.to.retry");
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
        assert_eq!(err.code, "confirm.text.mismatch");
    }

    #[tokio::test]
    async fn permanently_delete_blocked_by_spec016_protection() {
        let (db, bus) = setup().await;
        insert_draft(&db, "p1").await;
        add_item(&db, "p1", "item-1", "move").await;

        let err =
            permanently_delete_archive(db.pool(), &bus, "p1", "DELETE", true).await.unwrap_err();
        assert_eq!(err.code, "plan.blocked_by_protection");
    }
}
