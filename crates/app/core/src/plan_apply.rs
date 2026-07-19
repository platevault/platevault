// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Plan apply use-case orchestration (spec 025).
//!
//! Entry points:
//! - `apply_plan`        — start applying an approved plan (CAS, R-CAS-1, R-Concur-1).
//! - `cancel_plan`       — cancel an in-flight apply (US3).
//! - `pause_plan`        — (internal, called by executor callbacks on pause conditions).
//! - `resume_plan`       — resume a paused run (R-Pause-1).
//! - `skip_plan_item`    — skip a pending item within an active apply (US4).
//! - `retry_plan_item`   — retry a failed item within an active apply (US4).
//! - `get_apply_status`  — fetch current run state + counters.
//!
//! This module wires `crates/fs/executor` (pure filesystem logic) with
//! `crates/persistence/db` (state + audit records) and `crates/audit`
//! (event bus).
//!
//! Constitution §II: apply is gated by approval token; per-item FS CAS check
//! before each mutation (R-FS-1); audit event per state transition (FR-003).

#![allow(clippy::too_many_lines)]

//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b). Its only
//! cross-module dependency was on the now-extracted `app_core_errors` leaf and
//! nothing else in `app_core` references it. `app_core` re-exports this crate at
//! `app_core::plan_apply` so the public surface stays byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use audit::bus::EventBus;
use audit::event_bus::{
    PlanApplyingCompleted, PlanApplyingPaused, PlanApplyingResumed, PlanApplyingStarted,
    PlanItemProgress, Source, TOPIC_PLAN_APPLYING_COMPLETED, TOPIC_PLAN_APPLYING_PAUSED,
    TOPIC_PLAN_APPLYING_RESUMED, TOPIC_PLAN_APPLYING_STARTED, TOPIC_PLAN_ITEM_PROGRESS,
};
use audit::{AuditLogEntry, Outcome, Severity};
use camino::{Utf8Path, Utf8PathBuf};
use contracts_core::plan_apply::{
    PlanApplyResponse, PlanApplyStatus, PlanCancelResponse, PlanItemRetryResponse,
    PlanItemSkipResponse, PlanResumeResponse,
};
use contracts_core::{
    error_code::ErrorCode, ContractError, ErrorSeverity, OperationEvent, OperationEventType,
    OperationHandle, OperationId, OperationName, OperationStatus,
};
use domain_core::ids::{new_id, Timestamp};
use domain_core::lifecycle::data_asset::EntityType;
use fs_executor::ops::cas_check::CasSnapshot;
use fs_executor::run::{
    execute_plan, ApplyOutcome, CancellationToken, ExecutorCallbacks, ExecutorItem,
    ExecutorItemAction, ItemProgressEvent, RetryQueue, SkipSet, TerminalCounts,
};
use persistence_db::repositories::first_run as first_run_repo;
use persistence_db::repositories::inventory as inventory_repo;
use persistence_db::repositories::plan_apply as apply_repo;
use persistence_db::repositories::plans as plans_repo;
use persistence_db::DbError;
use serde_json::json;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::audit_ids::deterministic_entity_id;
use crate::caches;
use crate::errors::bus_err;
use crate::path_set::PlanPathSet;
use dashmap::DashMap;

// ── Long-operation event sink (spec 042 US16, T240) ───────────────────────────

/// Operation name carried by the long-op contract for plan-apply runs.
pub const OP_NAME_PLAN_APPLY: &str = "plan.apply";

/// Live projection sink for [`OperationEvent`]s emitted by a plan-apply run.
///
/// This is the **live UI projection** of progress (spec 042 US16). It is
/// additive to — and never a replacement for — the durable DB audit trail
/// (`apply_repo::append_event`, constitution §II). The Tauri command supplies
/// a sink that forwards events over a `tauri::ipc::Channel<OperationEvent>`;
/// `app_core` itself stays transport-agnostic (no `tauri` dependency).
///
/// Sends are best-effort and infallible from the caller's perspective: if the
/// webview channel is gone, the closure swallows the error so the run still
/// completes and the audit record is still written.
pub type OperationEventSink = Arc<dyn Fn(OperationEvent) + Send + Sync>;

/// Monotonic per-run sequence + sink wrapper so every emitted event carries a
/// strictly increasing `sequence` (the UI uses it to order/dedupe).
#[derive(Clone)]
struct OpEventEmitter {
    operation_id: OperationId,
    sink: OperationEventSink,
    sequence: Arc<AtomicU64>,
}

impl OpEventEmitter {
    fn new(operation_id: OperationId, sink: OperationEventSink) -> Self {
        Self { operation_id, sink, sequence: Arc::new(AtomicU64::new(0)) }
    }

    /// Build the [`OperationHandle`] for this run at the given status.
    fn handle(&self, status: OperationStatus) -> OperationHandle {
        OperationHandle::new(
            self.operation_id.clone(),
            OperationName(OP_NAME_PLAN_APPLY.to_owned()),
            status,
        )
    }

    /// Emit one event with the next sequence number.
    fn emit(&self, event_type: OperationEventType, payload: serde_json::Value) {
        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst);
        let event = OperationEvent::new(self.operation_id.clone(), event_type, sequence, payload);
        (self.sink)(event);
    }
}

// ── Active runs registry ──────────────────────────────────────────────────────

/// Global registry of in-flight plan apply runs.
/// Keyed by `plan_id`; each entry holds the shared control objects.
///
/// Backed by a `DashMap` (concurrent map with internal sharded locking) so the
/// registry can be accessed from sync contexts without holding a `.await` lock.
/// Entries are inserted at apply start and removed by an [`ActiveRunGuard`] RAII
/// guard owned by the executor's background task. Because removal happens in the
/// guard's `Drop`, it runs on every scope exit — completion, cancel, pause, *or*
/// an unwind if `execute_plan` panics (FR-017) — guaranteeing no leaked entries.
static ACTIVE_RUNS: std::sync::OnceLock<Arc<DashMap<String, ActiveRun>>> =
    std::sync::OnceLock::new();

fn active_runs() -> Arc<DashMap<String, ActiveRun>> {
    ACTIVE_RUNS.get_or_init(|| Arc::new(DashMap::new())).clone()
}

struct ActiveRun {
    cancel_token: CancellationToken,
    skip_set: SkipSet,
    retry_queue: RetryQueue,
    #[allow(dead_code)] // retained for run introspection / diagnostics
    run_id: String,
    /// The (source ∪ destination ∪ archive) path prefixes this run claims,
    /// compared against pending applies by the FR-017 overlap check
    /// (R-Concur-1).
    path_set: PlanPathSet,
}

/// RAII guard that removes a plan's [`ActiveRun`] entry from the registry on
/// **any** scope exit — normal return, early break, *or* unwind from a panic
/// inside `execute_plan` (spec 042 US12/FR-017, acceptance scenario 2).
///
/// A plain sequential `registry.remove(&plan_id)` after `execute_plan(...)`
/// returns is skipped if `execute_plan` panics, because the unwind jumps past
/// it. The leaked entry then defeats the no-double-apply guard
/// (`check_overlap_and_register`) for that plan id forever. Holding this guard for the
/// duration of `execute_plan` makes removal run during the unwind instead.
///
/// The guard is constructed at the same point the entry is inserted and owned
/// by the spawned task scope, so its `Drop` is the single removal site for the
/// non-panic outcomes too (Completed / Cancelled / Paused) — removal happens
/// exactly once, regardless of how the task scope exits.
struct ActiveRunGuard {
    registry: Arc<DashMap<String, ActiveRun>>,
    plan_id: String,
}

impl Drop for ActiveRunGuard {
    fn drop(&mut self) {
        self.registry.remove(&self.plan_id);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn db_err(e: DbError) -> ContractError {
    match e {
        DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::PlanNotFound, msg, ErrorSeverity::Blocking, false)
        }
        DbError::CasFailed(msg) => {
            ContractError::new(ErrorCode::PlanInvalidState, msg, ErrorSeverity::Blocking, false)
        }
        other => crate::errors::db_err(other),
    }
}

// ── Source view generation finalization (spec 049) ───────────────────────────

/// Terminal step of a `project_create` plan apply: fire the `Created`
/// manifest trigger (#665 — this and the source add/remove triggers had no
/// emitters at all; only the unrelated `workflow.run_completed` trigger was
/// wired). The project's folder structure (including `notes/`) only exists
/// on disk once this plan applies, so this is the earliest point the write
/// can succeed.
///
/// `origin_path` on a `project_create` plan is the project's filesystem
/// path, not its id (unlike every other plan origin) — recovered via
/// `projects::path_exists`.
///
/// Best-effort: the project already exists, so a manifest failure here must
/// NOT fail the apply. Every failure is logged for an external watchdog (§II).
async fn finalize_project_create_manifest(pool: &SqlitePool, bus: &EventBus, project_path: &str) {
    use app_core_projects::project_manifests::{
        build_source_calibration_snapshot, write, WriteManifestParams,
    };
    use contracts_core::manifests::ManifestReason as DtoManifestReason;
    use persistence_db::repositories::projects as projects_repo;

    let project_id = match projects_repo::path_exists(pool, project_path, None).await {
        Ok(Some(id)) => id,
        Ok(None) => {
            tracing::warn!(%project_path, "project_create manifest: no project at this path");
            return;
        }
        Err(e) => {
            tracing::warn!(%project_path, error=%e, "project_create manifest: path lookup failed");
            return;
        }
    };
    let lifecycle = match projects_repo::get_project(pool, &project_id).await {
        Ok(row) => row.lifecycle,
        Err(e) => {
            tracing::warn!(%project_id, error=%e, "project_create manifest: project lookup failed");
            return;
        }
    };
    let (source_map, calibration) = build_source_calibration_snapshot(pool, &project_id).await;
    let result = write(
        pool,
        bus,
        WriteManifestParams {
            project_id: &project_id,
            reason: DtoManifestReason::Created,
            project_root: std::path::Path::new(project_path),
            lifecycle_state: &lifecycle,
            source_map,
            calibration,
            workflow_profile: None,
        },
    )
    .await;
    if let Err(e) = result {
        tracing::warn!(%project_id, error=%e, "project_create manifest write failed");
    }
}

/// Terminal step of a `prepared_view_generation` plan apply: write the
/// first-materialization `PreparedSourceView` (state `current`) plus one
/// `PreparedSourceViewItem` per successfully-applied `link` item.
///
/// Best-effort: the links are already on disk, so a failure here must NOT
/// fail the apply. Every failure is logged for an external watchdog (§II).
/// Idempotent: a re-entrant call (e.g. a retried terminal transition) skips
/// item rows that already exist for this view id.
async fn finalize_view_generation(pool: &SqlitePool, plan_id: &str, project_id: &str) {
    use domain_core::source_view::Materialization;
    use persistence_db::repositories::prepared_source_views as views_repo;

    let items = match plans_repo::list_plan_items(pool, plan_id).await {
        Ok(items) => items,
        Err(e) => {
            tracing::error!(%plan_id, error=%e, "generation finalize: failed to load plan items");
            return;
        }
    };

    let succeeded: Vec<_> =
        items.iter().filter(|i| i.action == "link" && i.item_state == "succeeded").collect();

    if succeeded.is_empty() {
        tracing::warn!(%plan_id, "generation finalize: no succeeded link items; no view recorded");
        return;
    }

    // The view's display `kind` is the dominant per-item materialization
    // (spec 026 FR-008 amended, CL-2) — the first succeeded item's kind is a
    // reasonable representative; per-item kind remains authoritative.
    let dominant_kind = succeeded
        .first()
        .map_or(Materialization::Symlink, |row| materialization_from_provenance(row));

    let view_id = new_id();
    if let Err(e) = views_repo::insert_view(
        pool,
        &views_repo::InsertPreparedSourceView {
            id: &view_id,
            project_id,
            kind: dominant_kind.as_str(),
        },
    )
    .await
    {
        tracing::error!(%plan_id, %view_id, error=%e, "generation finalize: failed to insert view");
        return;
    }

    for item in succeeded {
        let Some(inventory_item_id) = item.linked_entity.as_deref() else {
            tracing::warn!(
                %plan_id, item_id = %item.id,
                "generation finalize: link item missing linked_entity (inventory reference); skipped"
            );
            continue;
        };
        let materialization = materialization_from_provenance(item);
        let view_item_id = new_id();
        if let Err(e) = views_repo::insert_view_item(
            pool,
            &views_repo::InsertPreparedSourceViewItem {
                id: &view_item_id,
                view_id: &view_id,
                inventory_item_id,
                view_relative_path: &item.to_relative_path,
                materialization: materialization.as_str(),
            },
        )
        .await
        {
            tracing::error!(
                %plan_id, %view_id, item_id = %item.id, error=%e,
                "generation finalize: failed to insert view item"
            );
        }
    }
}

// ── Source view removal/regeneration finalization (spec 026 T017/T018) ───────

/// Look up the `PreparedSourceView` id a `prepared_view_removal`/
/// `prepared_view_regeneration` plan targets, from any item's
/// `linked_entity` (every item in these plans is linked to the same view —
/// `prepared_views::remove_prepared_view`/`regenerate_prepared_view`).
async fn view_id_for_plan(pool: &SqlitePool, plan_id: &str) -> Option<String> {
    match plans_repo::list_plan_items(pool, plan_id).await {
        Ok(items) => items.into_iter().find_map(|i| i.linked_entity),
        Err(e) => {
            tracing::error!(%plan_id, error=%e, "view finalize: failed to load plan items");
            None
        }
    }
}

/// Terminal step of a `prepared_view_removal` plan apply (T017/T018).
///
/// A clean `applied` terminal means every item was archived away, so the
/// view's on-disk representation is fully gone — recorded explicitly via
/// `mark_view_removed` (A4: membership preserved indefinitely for later
/// regeneration; this is not derivable from a staleness sweep, which cannot
/// distinguish "removed by this plan" from "some items independently went
/// missing").
///
/// A partial apply leaves a genuinely mixed on-disk state; rather than guess,
/// this rides the stale-detection sweep (T014) to recompute real per-item
/// state from disk, same as any other spec-026 US3 sweep.
///
/// Best-effort: failures are logged only, never fail the apply (§II).
async fn finalize_view_removal(pool: &SqlitePool, plan_id: &str, terminal: &str) {
    use persistence_db::repositories::prepared_source_views as views_repo;

    let Some(view_id) = view_id_for_plan(pool, plan_id).await else {
        tracing::warn!(%plan_id, "removal finalize: no linked view id on plan items; skipped");
        return;
    };

    if terminal == "applied" {
        if let Err(e) = views_repo::mark_view_removed(pool, &view_id).await {
            tracing::error!(%plan_id, %view_id, error=%e, "removal finalize: failed to mark view removed");
        }
    } else if let Err(e) =
        app_core_projects::source_view_verify::sweep_view_staleness(pool, &view_id).await
    {
        tracing::error!(%plan_id, %view_id, error=?e, "removal finalize: sweep failed after partial apply");
    }
}

/// Terminal step of a `prepared_view_regeneration` plan apply (T017/T018).
///
/// Unlike removal, a successful regeneration doesn't have a single new
/// terminal DB state to write — the freshly-created links are just real
/// files again. Rides the same stale-detection sweep (T014) used for
/// on-demand staleness checks, so the recorded `state`/`last_observed_state`
/// reflect the actual outcome (including any items a partial apply left
/// broken) rather than a hand-maintained approximation.
///
/// A successful regeneration is the one legitimate way out of the terminal
/// `removed` state (A4) — but `sweep_view_staleness` intentionally skips
/// `removed`/`kind_diverged` views (they have nothing meaningful to sweep in
/// the general list-load path). So a `removed` view is first cleared to a
/// neutral non-terminal state here, purely so the sweep actually runs and
/// re-evaluates the freshly-recreated links, rather than leaving the view
/// stuck `removed` forever after a successful regeneration.
///
/// Best-effort: failures are logged only, never fail the apply (§II).
async fn finalize_view_regeneration(pool: &SqlitePool, plan_id: &str) {
    use persistence_db::repositories::prepared_source_views as views_repo;

    let Some(view_id) = view_id_for_plan(pool, plan_id).await else {
        tracing::warn!(%plan_id, "regeneration finalize: no linked view id on plan items; skipped");
        return;
    };

    if let Ok(view) = views_repo::get_view(pool, &view_id).await {
        if view.state == "removed" {
            if let Err(e) = views_repo::update_view_state(pool, &view_id, "stale").await {
                tracing::error!(%plan_id, %view_id, error=%e, "regeneration finalize: failed to clear removed state pre-sweep");
            }
        }
    }

    if let Err(e) =
        app_core_projects::source_view_verify::sweep_view_staleness(pool, &view_id).await
    {
        tracing::error!(%plan_id, %view_id, error=?e, "regeneration finalize: sweep failed");
    }
}

// ── Archive lifecycle closure (spec 017 C5) ──────────────────────────────────

/// Terminal step of a successful `origin = archive` plan apply: drive the owning
/// project into the `archived` lifecycle state (C5). This is the ONE legitimate
/// closure of the requires-plan gate — the plan was reviewed, approved, and just
/// applied, so the filesystem move that `completed → archived` requires has
/// happened. We call the low-level [`transition_lifecycle`] directly (which does
/// not re-run the requires-plan gate that `apply_transition` enforces) and then
/// record `archived_via_plan_id` so the archive-management commands can act on
/// this plan.
///
/// Best-effort: the files are already archived, so a failure here must NOT fail
/// the apply. Every failure is logged for an external watchdog (§II).
async fn finalize_archive_lifecycle(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
    project_id: &str,
) {
    use crate::lifecycle::lifecycle_use_case::{transition_lifecycle, TransitionCommand};
    use domain_core::ids::EntityId;
    use domain_core::lifecycle::data_asset::EntityType;
    use persistence_db::repositories::lifecycle::SqliteLifecycleRepository;
    use persistence_db::repositories::projects as projects_repo;

    // The lifecycle repo keys entities on their UUID id.
    let uuid = match uuid::Uuid::parse_str(project_id) {
        Ok(u) => u,
        Err(e) => {
            tracing::error!(%project_id, error=%e, "archive lifecycle closure: project id is not a uuid");
            return;
        }
    };

    // Read the current lifecycle so the transition CAS matches whatever the
    // project is in (typically `completed` or `blocked`).
    let current = match projects_repo::get_project(pool, project_id).await {
        Ok(p) => p.lifecycle,
        Err(e) => {
            tracing::error!(%project_id, error=%e, "archive lifecycle closure: project not found");
            return;
        }
    };

    // Idempotent: an already-archived project just needs the plan link recorded.
    if current == "archived" {
        if let Err(e) = projects_repo::set_archived_via_plan_id(pool, project_id, plan_id).await {
            tracing::error!(%project_id, error=%e, "archive lifecycle closure: failed to record archived_via_plan_id");
        }
        return;
    }

    // Edge-legality guard (Constitution §II). `transition_lifecycle` is un-gated
    // and `record_transition` only CAS-checks `from_state`, so this closure would
    // otherwise CAS `<any state> → archived`. Per the domain edge table
    // (`domain_core::lifecycle::project::is_allowed`) the ONLY legal edges into
    // `archived` are `completed → archived` and `blocked → archived`. Archive
    // plans should only ever target completed/blocked projects; if we somehow
    // reach here from another state, refuse to record an illegal edge and log
    // for an external watchdog rather than corrupt lifecycle history.
    if !matches!(current.as_str(), "completed" | "blocked") {
        tracing::error!(
            %project_id, %plan_id, from_state = %current,
            "archive lifecycle closure: refusing illegal edge into 'archived' (legal sources: completed, blocked); leaving lifecycle unchanged"
        );
        return;
    }

    let repo = SqliteLifecycleRepository::new(pool.clone(), bus.clone());
    let cmd = TransitionCommand {
        entity_id: EntityId::from_uuid(uuid),
        entity_type: EntityType::Project,
        from_state: current,
        to_state: "archived".to_owned(),
        trigger: "archive.plan.applied".to_owned(),
        actor: "user".to_owned(),
        request_id: EntityId::new(),
    };

    match transition_lifecycle(&repo, bus, cmd).await {
        Ok(_) => {
            if let Err(e) = projects_repo::set_archived_via_plan_id(pool, project_id, plan_id).await
            {
                tracing::error!(%project_id, error=%e, "archive lifecycle closure: transition succeeded but recording archived_via_plan_id failed");
            }
        }
        Err(e) => {
            tracing::error!(%project_id, %plan_id, error=%e, "archive lifecycle closure: transition to archived failed");
        }
    }
}

// ── Overlap check (FR-017, R-Concur-1) ────────────────────────────────────────

/// Serializes the FR-017 overlap check with the registry insert so two
/// concurrent `apply_plan` calls cannot both pass the check and then both
/// register overlapping runs. Sync-only critical section: the lock is never
/// held across an `.await`.
static OVERLAP_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Resolve one claimed relative path the same way the executor resolves item
/// paths (`resolve_item_path`): join against the root when known, then
/// lexically normalize. Unrooted paths normalize as-is — they never falsely
/// prefix-match rooted absolute paths.
fn resolve_claimed_path(relative: &str, root: Option<&Utf8PathBuf>) -> Utf8PathBuf {
    use fs_executor::ops::path_gate::lexical_normalize;
    match root {
        Some(r) => lexical_normalize(&r.join(relative)),
        None => lexical_normalize(Utf8Path::new(relative)),
    }
}

/// Compute the plan's claimed (source ∪ destination ∪ archive) path set for
/// the FR-017 overlap check (research R7).
///
/// The destination prefers the destination root when it resolves and falls
/// back to the source root — over-claiming rather than under-claiming, which
/// is the safe direction for a concurrency guard. Absolute archive paths
/// (pre-computed at plan generation) are claimed verbatim.
fn compute_plan_path_set(
    item_rows: &[plans_repo::PlanItemRow],
    root_map: &HashMap<String, Utf8PathBuf>,
) -> PlanPathSet {
    use fs_executor::ops::path_gate::lexical_normalize;

    let mut set = PlanPathSet::new();
    for row in item_rows {
        let from_root = row.from_root_id.as_deref().and_then(|rid| root_map.get(rid));
        let to_root = row.to_root_id.as_deref().and_then(|rid| root_map.get(rid)).or(from_root);

        if !row.from_relative_path.is_empty() {
            set.insert(resolve_claimed_path(&row.from_relative_path, from_root));
        }
        if !row.to_relative_path.is_empty() {
            set.insert(resolve_claimed_path(&row.to_relative_path, to_root));
        }
        if let Some(archive) = row.archive_path.as_deref().filter(|a| !a.is_empty()) {
            let p = Utf8Path::new(archive);
            if p.is_absolute() {
                set.insert(lexical_normalize(p));
            } else {
                set.insert(resolve_claimed_path(archive, to_root));
            }
        }
    }
    set
}

/// Check the FR-017 concurrency invariants and, when they hold, register the
/// run in [`ACTIVE_RUNS`] — atomically with respect to other apply calls
/// (guarded by [`OVERLAP_GATE`]).
///
/// Returns the RAII removal guard on success. On failure nothing is
/// registered:
/// - `plan.invalid_state` — this plan already has an active run (same-plan
///   double-apply backstop, T021; the state CAS blocks the common path).
/// - `plan.conflict.overlap` — the plan's path set overlaps an active run's
///   path set at subtree-prefix granularity (FR-017, R-Concur-1).
#[allow(clippy::result_large_err)]
fn check_overlap_and_register(
    plan_id: &str,
    run: ActiveRun,
) -> Result<ActiveRunGuard, ContractError> {
    let registry = active_runs();
    let _gate = OVERLAP_GATE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);

    if registry.contains_key(plan_id) {
        return Err(ContractError::new(
            ErrorCode::PlanInvalidState,
            format!("plan {plan_id} already has an active apply run"),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    for entry in registry.iter() {
        if let Some((mine, theirs)) = run.path_set.first_overlap(&entry.value().path_set) {
            return Err(ContractError::new(
                ErrorCode::PlanConflictOverlap,
                format!(
                    "plan {plan_id} path '{mine}' overlaps path '{theirs}' claimed by \
                     active plan {}; wait for that apply to finish",
                    entry.key()
                ),
                ErrorSeverity::Blocking,
                false,
            ));
        }
    }

    registry.insert(plan_id.to_owned(), run);
    Ok(ActiveRunGuard { registry: registry.clone(), plan_id: plan_id.to_owned() })
}

// ── Approval token verification (A1) ─────────────────────────────────────────

/// Verify the approval token is present and non-empty.
///
/// v1: the token is the value produced by `approve_plan`
/// (`"tok-<planId>-<uuid>"`). The spec calls for HMAC verification; this
/// is documented as a future upgrade. For v1 we check that the stored
/// `approval_token` on the plan row matches what the caller supplies.
#[allow(clippy::result_large_err)]
fn verify_approval_token(
    stored_token: Option<&str>,
    supplied_token: &str,
) -> Result<(), ContractError> {
    match stored_token {
        None => Err(ContractError::new(
            ErrorCode::PlanApprovalStale,
            "no approval token on record; plan must be approved before apply".to_owned(),
            ErrorSeverity::Blocking,
            false,
        )),
        Some(stored) if stored != supplied_token => Err(ContractError::new(
            ErrorCode::PlanApprovalStale,
            "approval token mismatch; plan may have been re-approved or tampered".to_owned(),
            ErrorSeverity::Blocking,
            false,
        )),
        Some(_) => Ok(()),
    }
}

// ── Item → ExecutorItem mapping ───────────────────────────────────────────────

/// Parse the recorded link-materialization kind out of a plan item's
/// free-form `provenance` JSON (`[{"label":"materialization","value":"..."}]`,
/// spec 049 generation/regeneration plan builders). Falls back to `Symlink`
/// (the constitution-preferred default) when absent or unparseable, rather
/// than guessing a destructive kind.
fn materialization_from_provenance(
    row: &plans_repo::PlanItemRow,
) -> domain_core::source_view::Materialization {
    row.provenance
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(raw).ok())
        .and_then(|entries| {
            entries.into_iter().find_map(|entry| {
                if entry.get("label").and_then(serde_json::Value::as_str) == Some("materialization")
                {
                    entry
                        .get("value")
                        .and_then(serde_json::Value::as_str)
                        .and_then(domain_core::source_view::Materialization::from_str_opt)
                } else {
                    None
                }
            })
        })
        .unwrap_or(domain_core::source_view::Materialization::Symlink)
}

/// Convert a `PlanItemRow` into an `ExecutorItem`, resolving the source and
/// destination roots from the provided root-id → absolute-path map (T023a).
///
/// When `root_map` contains the `from_root_id` for this item, `library_root`
/// is set to the absolute path so the path-escape/symlink/staleness gate in
/// the executor fires on real items. When the root cannot be resolved (no
/// `from_root_id` or id absent from the map), `library_root` is `None` and
/// the gate is skipped (legacy/test mode).
///
/// `destination_root` is resolved independently from `to_root_id` (falling
/// back to `library_root` when `to_root_id` is absent or unresolvable, same
/// as `compute_plan_path_set`'s `to_root` fallback) so a cross-root move
/// joins `to_relative_path` against the *picked* destination root instead of
/// silently reusing the source root (#765).
///
/// `plan_destructive_destination` is the *plan-level* `plans.destructive_destination`
/// choice ("archive" | "trash"), not a per-item column: both `cleanup_generator`
/// and `archive_generator` always store `action = "archive"` for a
/// destructive-but-reversible item (the item-level `"trash"` action string is
/// otherwise dead — no generator ever writes it). Without consulting this, a
/// user's review-time "System trash" choice had no effect at apply time —
/// every such item silently archived into `.astro-plan-archive` instead.
fn item_row_to_executor_item(
    row: &plans_repo::PlanItemRow,
    root_map: &HashMap<String, Utf8PathBuf>,
    plan_destructive_destination: &str,
) -> ExecutorItem {
    // DB path columns are stored as `String` (unchanged DB representation,
    // Local-First custody §I). Rust strings are already UTF-8, so building a
    // `Utf8PathBuf` from them is infallible and lossless.
    let action = match row.action.as_str() {
        "move" => ExecutorItemAction::Move,
        // The user's review-time "System trash" choice (plan-level) routes an
        // `action = "archive"` item through OS trash instead of the app
        // archive folder — see this function's doc comment.
        "archive" if plan_destructive_destination == "trash" => {
            ExecutorItemAction::Trash { fallback_archive_destination: None }
        }
        "archive" => {
            // archive_path stores the pre-computed relative archive path.
            let archive_dest = row
                .archive_path
                .as_deref()
                .map_or_else(|| Utf8PathBuf::from(&row.to_relative_path), Utf8PathBuf::from);
            ExecutorItemAction::Archive { archive_destination: archive_dest }
        }
        // T022: map "trash" action to the Trash variant.
        "trash" => ExecutorItemAction::Trash { fallback_archive_destination: None },
        "delete" => ExecutorItemAction::Delete,
        // spec 041: catalogue = record-in-place, no filesystem mutation.
        "catalogue" => ExecutorItemAction::Catalogue,
        // spec 008 scaffolding: create the destination directory for real
        // (previously fell through to NoOp, so applied mkdir plans never
        // created anything on disk).
        "mkdir" => ExecutorItemAction::Mkdir,
        // spec 049: create a real link (or, with explicit copy opt-in, a real
        // copy). Previously fell through to NoOp, so applied source-view
        // generation/regeneration plans never created anything on disk. The
        // recorded materialization kind rides the free-form `provenance` JSON
        // array (`[{"label":"materialization","value":"symlink"}]`, spec 014
        // convention); an unparseable/missing value conservatively falls back
        // to `symlink` (the constitution-preferred default) rather than
        // guessing a destructive kind.
        "link" => ExecutorItemAction::Link { kind: materialization_from_provenance(row) },
        _ => ExecutorItemAction::NoOp,
    };

    // T023a: Resolve library_root from the DB root map.
    // When from_root_id is set and the root exists in the map, the path gate
    // (T018: escape/symlink/staleness) will fire on this item.
    let library_root: Option<Utf8PathBuf> =
        row.from_root_id.as_deref().and_then(|rid| root_map.get(rid)).cloned();

    // #765: destination_root resolves independently from to_root_id, falling
    // back to library_root — NOT reusing from_root_id's resolution outright —
    // so a cross-root move/link/mkdir joins to_relative_path against the
    // destination root the user actually picked.
    let destination_root: Option<Utf8PathBuf> = row
        .to_root_id
        .as_deref()
        .and_then(|rid| root_map.get(rid))
        .cloned()
        .or_else(|| library_root.clone());

    // Paths are stored as relative to the library root.
    let source_path = if row.from_relative_path.is_empty() {
        None
    } else {
        Some(Utf8PathBuf::from(&row.from_relative_path))
    };

    let destination_path = if row.to_relative_path.is_empty() {
        None
    } else {
        Some(Utf8PathBuf::from(&row.to_relative_path))
    };

    let is_protected = row.protection == "protected";

    // T020: `requires_destructive_confirm` is derived from action type,
    // independent of `is_protected`. Replaces the old `confirm_required = is_protected` inversion.
    let requires_destructive_confirm = matches!(row.action.as_str(), "delete" | "trash")
        || row.requires_destructive_confirm.unwrap_or(0) != 0;

    // T023a: `destructive_confirmed` is now a real DB column (migration 0033).
    let destructive_confirmed = row.destructive_confirmed != 0;

    ExecutorItem {
        id: row.id.clone(),
        plan_id: row.plan_id.clone(),
        action,
        source_path,
        destination_path,
        library_root,
        destination_root,
        cas_snapshot: CasSnapshot {
            approved_mtime: row.approved_mtime.clone(),
            approved_size_bytes: row.approved_size_bytes,
        },
        is_protected,
        requires_destructive_confirm,
        destructive_confirmed,
        current_state: row.item_state.clone(),
    }
}

// ── Executor callbacks implementation ────────────────────────────────────────

struct PlanApplyCallbacks {
    pool: SqlitePool,
    bus: EventBus,
    plan_id: String,
    run_id: String,
    /// Optional live long-op projection (spec 042 US16). `None` when the caller
    /// (e.g. a unit test) does not subscribe; the DB audit trail is unaffected.
    op_emitter: Option<OpEventEmitter>,
}

impl ExecutorCallbacks for PlanApplyCallbacks {
    fn on_item_start(
        &self,
        item_id: &str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        let pool = self.pool.clone();
        let plan_id = self.plan_id.clone();
        let item_id = item_id.to_owned();
        Box::pin(async move {
            if let Err(e) = apply_repo::item_start_applying(&pool, &item_id, &plan_id).await {
                tracing::error!(%item_id, error=%e, "failed to transition item to applying");
            }
        })
    }

    fn on_item_progress(
        &self,
        event: ItemProgressEvent,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        let pool = self.pool.clone();
        let bus = self.bus.clone();
        let plan_id = self.plan_id.clone();
        let run_id = self.run_id.clone();
        let op_emitter = self.op_emitter.clone();
        Box::pin(async move {
            let item_id = event.item_id.clone();
            let at = event.at.clone();

            // Persist item state. "refused" (destructive-unconfirmed / path-gate
            // escape-symlink refusals, run.rs:381-401 and :408-426) has no
            // distinct `plan_items.item_state` value — the CHECK constraint
            // only allows pending/applying/succeeded/failed/skipped/cancelled
            // (migration 0045) — so it persists as `failed` exactly like an
            // ordinary execution failure, via the same `item_failed` write
            // that increments `items_failed`. Without this arm a refused item
            // stayed `pending` forever and its failure was never counted,
            // letting an otherwise-clean run report `applied` (constitution
            // §II non-silent-failure violation).
            let persist_result = match event.new_state.as_str() {
                "succeeded" => apply_repo::item_succeeded(&pool, &item_id, &plan_id).await,
                "failed" | "stale" | "refused" => {
                    let reason = event
                        .failure
                        .as_ref()
                        .map(std::string::ToString::to_string)
                        .unwrap_or_default();
                    if event.new_state == "stale" {
                        apply_repo::item_stale(&pool, &item_id, &plan_id).await
                    } else {
                        apply_repo::item_failed(&pool, &item_id, &plan_id, &reason).await
                    }
                }
                "skipped" => apply_repo::item_skip(&pool, &item_id, &plan_id).await,
                _ => Ok(()),
            };

            if let Err(e) = persist_result {
                tracing::error!(%item_id, error=%e, "failed to persist item state transition");
            }

            // Append audit event.
            let failure_ref = event.failure.as_ref();
            let rollback_ref = if event.rollback_attempted {
                Some(apply_repo::EventRollback {
                    attempted: event.rollback_attempted,
                    outcome: event.rollback_outcome.as_str(),
                    message: event.rollback_message.as_deref(),
                })
            } else {
                None
            };

            if let Err(e) = apply_repo::append_event(
                &pool,
                &new_id(),
                &run_id,
                &plan_id,
                Some(&item_id),
                &event.prior_state,
                &event.new_state,
                &at,
                failure_ref
                    .map(|f| apply_repo::EventFailure {
                        code: f.code.as_str(),
                        message: &f.message,
                        recoverable: f.recoverable,
                    })
                    .as_ref(),
                rollback_ref.as_ref(),
            )
            .await
            {
                tracing::error!(%item_id, error=%e, "failed to append apply event");
            }

            // Durable audit row + live bus event (#766). `append_event` above
            // writes to the plan-apply run-history table, NOT `audit_log_entry` —
            // this is the actual durable audit write the constitution (§II)
            // and `audit::bus::EventBus::write_audit` cover; before this fix
            // the item-progress path only ever called `bus.publish` (live-only,
            // non-durable), so a succeeded plan apply left zero audit_log_entry
            // rows despite every item transitioning to a terminal state.
            let bus_payload = PlanItemProgress {
                plan_id: plan_id.clone(),
                run_id: run_id.clone(),
                item_id: item_id.clone(),
                prior_state: event.prior_state.clone(),
                new_state: event.new_state.clone(),
                at: at.clone(),
                failure_code: event.failure.as_ref().map(|f| f.code.as_str().to_owned()),
                failure_message: event.failure.as_ref().map(|f| f.message.clone()),
                failure_recoverable: event.failure.as_ref().map(|f| f.recoverable),
            };

            let outcome = match event.new_state.as_str() {
                "succeeded" => Outcome::Applied,
                "failed" => Outcome::Failed,
                // stale / refused / skipped: the item never completed a
                // mutation attempt — declined, not a failed attempt.
                _ => Outcome::Refused,
            };
            let reason_code = event
                .audit_reason
                .clone()
                .or_else(|| event.failure.as_ref().map(|f| f.code.as_str().to_owned()));

            let mut audit_entry = AuditLogEntry::new(
                EntityType::FilesystemPlan,
                deterministic_entity_id("plan_apply.item", &item_id),
                format!("plan_item.{}", event.new_state),
                "user",
                outcome,
                Severity::Workflow,
                domain_core::ids::EntityId::new(),
            )
            .with_transition(event.prior_state.clone(), event.new_state.clone())
            .with_payload(json!({
                "planId": plan_id,
                "runId": run_id,
                "itemId": item_id,
                "failureCode": event.failure.as_ref().map(|f| f.code.as_str()),
                "failureMessage": event.failure.as_ref().map(|f| f.message.clone()),
            }));
            if let Some(reason) = reason_code {
                audit_entry = audit_entry.with_reason_code(reason);
            }

            if let Err(e) = bus
                .write_audit(audit_entry, TOPIC_PLAN_ITEM_PROGRESS, Source::System, bus_payload)
                .await
            {
                tracing::error!(%item_id, error=%e, "durable audit write failed for item progress");
            }

            // Live long-op projection (spec 042 US16, T240). Additive to the
            // durable audit record above — never a replacement (§II).
            if let Some(emitter) = op_emitter.as_ref() {
                let event_type = match event.new_state.as_str() {
                    "succeeded" => OperationEventType::ItemApplied,
                    "failed" | "stale" => OperationEventType::ItemFailed,
                    _ => OperationEventType::Progress,
                };
                emitter.emit(
                    event_type,
                    json!({
                        "planId": plan_id,
                        "runId": run_id,
                        "itemId": item_id,
                        "priorState": event.prior_state,
                        "newState": event.new_state,
                        "at": at,
                        "failureCode": event.failure.as_ref().map(|f| f.code.as_str()),
                        "failureMessage": event.failure.as_ref().map(|f| f.message.clone()),
                    }),
                );
            }
        })
    }
}

/// Emit both the run-events row and a durable `audit_log_entry` row for one
/// item forced into `cancelled` by a bulk-cancel path (#750: `list_pending_items`
/// happy path, its retry, and the orphaned-`applying` sweep). The forward
/// executor loop's own terminal transitions go through `on_item_progress`
/// instead — this helper only covers the bulk-cancel paths that bypass it.
async fn audit_item_cancelled(
    pool: &SqlitePool,
    bus: &EventBus,
    run_id: &str,
    plan_id: &str,
    item_id: &str,
    prior_state: &str,
    at: &str,
) {
    let _ = apply_repo::append_event(
        pool,
        &new_id(),
        run_id,
        plan_id,
        Some(item_id),
        prior_state,
        "cancelled",
        at,
        None,
        None,
    )
    .await;

    let entry = AuditLogEntry::new(
        EntityType::FilesystemPlan,
        deterministic_entity_id("plan_apply.item", item_id),
        "plan_item.cancelled",
        "user",
        Outcome::Refused,
        Severity::Workflow,
        domain_core::ids::EntityId::new(),
    )
    .with_transition(prior_state.to_owned(), "cancelled".to_owned())
    .with_payload(json!({ "planId": plan_id, "runId": run_id, "itemId": item_id }));

    let bus_payload = PlanItemProgress {
        plan_id: plan_id.to_owned(),
        run_id: run_id.to_owned(),
        item_id: item_id.to_owned(),
        prior_state: prior_state.to_owned(),
        new_state: "cancelled".to_owned(),
        at: at.to_owned(),
        failure_code: None,
        failure_message: None,
        failure_recoverable: None,
    };

    if let Err(e) =
        bus.write_audit(entry, TOPIC_PLAN_ITEM_PROGRESS, Source::System, bus_payload).await
    {
        tracing::error!(%item_id, error=%e, "durable audit write failed for cancelled item");
    }
}

/// Resolve a `root_id` to its absolute path: legacy `library_root` table
/// first, then `registered_sources` (gen-3 source model).
///
/// Read-through `caches::library_root` (F0) wraps only the
/// `registered_sources` fallback, not the legacy `library_root` table
/// lookup: `invalidate_library_root` is only called from `first_run.rs`'s
/// writers of `registered_sources` (register / remap / delete), so caching
/// the legacy-table branch too would go stale on writes this module never
/// sees.
// `pub(crate)`: reused by `crate::plans::send_archive_to_trash` /
// `permanently_delete_archive` (spec 017 US6) to resolve the same
// root_id → absolute-path mapping the apply executor uses (T023a), so an
// archive item's `archive_path` (stored root-relative when `from_root_id`
// is set) can be turned into a real filesystem path.
pub(crate) async fn resolve_root_path(pool: &SqlitePool, root_id: &str) -> Option<String> {
    match inventory_repo::get_library_root_path(pool, root_id).await {
        Ok(Some(path)) => Some(path),
        _ => {
            if let Some(cached) = caches::library_root().get(&root_id.to_owned()) {
                Some(cached)
            } else {
                let loaded = first_run_repo::get_source_path(pool, root_id).await.ok().flatten();
                if let Some(path) = &loaded {
                    caches::library_root().insert(root_id.to_owned(), path.clone());
                }
                loaded
            }
        }
    }
}

// ── apply_plan ────────────────────────────────────────────────────────────────

/// Start applying an approved plan (US1, T018, T019, T020, T021, T055).
///
/// Preconditions:
/// - Plan must be in `approved` state (CAS, R-CAS-1).
/// - No other run may be active for this plan (R-Concur-1).
/// - Approval token must match the stored token (A1).
///
/// The executor runs on a tokio background task; this function returns
/// immediately with `PlanApplyResponse { plan_id, run_id, new_state: "applying" }`.
///
/// # Errors
///
/// Returns `ContractError` with:
/// - `plan.not_found` — plan not found.
/// - `plan.invalid_state` — plan is not approved or CAS race.
/// - `plan.approval.stale` — token mismatch.
/// - `plan.conflict.overlap` — concurrent apply running.
pub async fn apply_plan(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
    approval_token: &str,
    event_sink: Option<OperationEventSink>,
) -> Result<PlanApplyResponse, ContractError> {
    // Load plan.
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    // State check before CAS.
    if plan_row.state != "approved" {
        return Err(ContractError::new(
            ErrorCode::PlanInvalidState,
            format!(
                "plan must be in 'approved' state before apply; current state is '{}'",
                plan_row.state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Token verification (A1).
    verify_approval_token(plan_row.approval_token.as_deref(), approval_token)?;

    // Spec 017 C5: capture the archive-plan lifecycle-closure inputs before the
    // plan row is consumed. On a successful `applied` apply of an
    // `origin = archive` plan, the project (stored in `origin_path`) is driven
    // into `archived` as the terminal step.
    let plan_origin = plan_row.origin.clone();
    let plan_project_id = plan_row.origin_path.clone();

    let run_id = new_id();
    let items_total = plan_row.items_total;
    let items_pending = plan_row.items_pending;

    // Long-op contract emitter (spec 042 US16). The run id doubles as the
    // operation id so the live projection and the durable run/audit rows share
    // one correlation key. `None` when the caller does not subscribe.
    let op_emitter = event_sink.map(|sink| OpEventEmitter::new(OperationId(run_id.clone()), sink));

    // Load items for the executor. Loaded before the state CAS so the FR-017
    // overlap check below can compute this plan's claimed path set; an
    // approved plan's items are immutable, so the read stays valid across
    // the CAS.
    let item_rows = plans_repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;

    // T023a: Build a root_id → absolute_path map so the path-gate fires on
    // real items. Collect the unique root_ids referenced by this plan's items.
    let mut root_map: HashMap<String, Utf8PathBuf> = HashMap::new();
    for row in &item_rows {
        // A plan item may carry distinct source and destination roots; resolve
        // every referenced root so the executor can anchor both sides.
        for rid in [row.from_root_id.as_ref(), row.to_root_id.as_ref()].into_iter().flatten() {
            if root_map.contains_key(rid) {
                continue;
            }
            // Resolve a root id → absolute path. Roots added through the setup
            // wizard live in `registered_sources` (the gen-3 source model) and
            // are NOT mirrored into the legacy `library_root` table, so fall
            // back to `registered_sources` when `library_root` has no row.
            // Without this, inbox `move` plans resolve to bare relative paths
            // and every apply fails with `source.missing`.
            if let Some(path) = resolve_root_path(pool, rid).await {
                root_map.insert(rid.clone(), Utf8PathBuf::from(path));
            } else {
                tracing::warn!(root_id = %rid, "plan item references unknown root (not in library_root or registered_sources); path gate will be inactive for this item");
            }
        }
    }

    let executor_items: Vec<ExecutorItem> = item_rows
        .iter()
        .map(|r| item_row_to_executor_item(r, &root_map, &plan_row.destructive_destination))
        .collect();

    // Overlap check + active-run registration (FR-017, R-Concur-1): the
    // plan's claimed (source ∪ destination ∪ archive) path set must be
    // disjoint from every active run's at subtree-prefix granularity.
    // Check and insert happen atomically (OVERLAP_GATE) BEFORE the state
    // CAS, so a rejected plan is left untouched in `approved`.
    //
    // RAII removal guard (FR-017): the returned guard is *moved into the
    // spawned task* below so its `Drop` fires on the task's scope exit —
    // including an unwind if `execute_plan` panics. If the CAS below fails,
    // the guard drops on the early return and removes the just-registered
    // entry. This replaces the old explicit `registry.remove`.
    let path_set = compute_plan_path_set(&item_rows, &root_map);
    let cancel_token = CancellationToken::new();
    let skip_set = SkipSet::new();
    let retry_queue = RetryQueue::new();
    let run_guard = check_overlap_and_register(
        plan_id,
        ActiveRun {
            cancel_token: cancel_token.clone(),
            skip_set: skip_set.clone(),
            retry_queue: retry_queue.clone(),
            run_id: run_id.clone(),
            path_set,
        },
    )?;

    // Atomic CAS: approved → applying (R-CAS-1).
    apply_repo::cas_approved_to_applying(
        pool,
        plan_id,
        &run_id,
        approval_token,
        items_total,
        items_pending,
    )
    .await
    .map_err(db_err)?;

    // Emit started event (A7).
    let started_at = Timestamp::now_iso();
    bus.publish(
        TOPIC_PLAN_APPLYING_STARTED,
        Source::User,
        PlanApplyingStarted {
            plan_id: plan_id.to_owned(),
            run_id: run_id.clone(),
            items_total,
            at: started_at.clone(),
        },
    )
    .await
    .map_err(bus_err)?;

    // Append plan-level start audit event.
    let _ = apply_repo::append_event(
        pool,
        &new_id(),
        &run_id,
        plan_id,
        None,
        "approved",
        "applying",
        &started_at,
        None,
        None,
    )
    .await;

    // Emit the long-op `Started` event carrying the running OperationHandle
    // (spec 042 US16, T240).
    if let Some(emitter) = op_emitter.as_ref() {
        let handle = emitter.handle(OperationStatus::Running);
        emitter.emit(
            OperationEventType::ItemStarted,
            json!({
                "handle": handle,
                "planId": plan_id,
                "runId": run_id,
                "itemsTotal": items_total,
                "at": started_at,
            }),
        );
    }

    // Spawn executor on a background task (shared with `resume_plan` — see
    // `spawn_executor_run`, issue #575 / spec 025 T048-T050).
    spawn_executor_run(SpawnExecutorParams {
        pool: pool.clone(),
        bus: bus.clone(),
        plan_id: plan_id.to_owned(),
        run_id: run_id.clone(),
        executor_items,
        plan_origin,
        plan_project_id,
        cancel_token,
        skip_set,
        retry_queue,
        run_guard,
        op_emitter,
    });

    Ok(PlanApplyResponse { plan_id: plan_id.to_owned(), run_id, new_state: "applying".to_owned() })
}

// ── spawn_executor_run (shared by apply_plan & resume_plan) ──────────────────

/// Inputs to [`spawn_executor_run`].
///
/// Bundled into a struct (rather than ~12 positional args) per the shape
/// suggested in issue #575: `apply_plan` builds one after its `approved ->
/// applying` CAS; `resume_plan` builds one after re-validating the pause
/// condition and re-registering the `ActiveRun` for the plan's remaining
/// `pending` items.
struct SpawnExecutorParams {
    pool: SqlitePool,
    bus: EventBus,
    plan_id: String,
    run_id: String,
    executor_items: Vec<ExecutorItem>,
    plan_origin: String,
    plan_project_id: Option<String>,
    cancel_token: CancellationToken,
    skip_set: SkipSet,
    retry_queue: RetryQueue,
    run_guard: ActiveRunGuard,
    op_emitter: Option<OpEventEmitter>,
}

/// Fetch the plan's up-to-date cumulative item counters.
///
/// Each item transition (`item_succeeded`/`item_failed`/`item_skip`/
/// `batch_cancel_pending_items`) increments `plans.items_applied` etc. in
/// real time via `PlanApplyCallbacks`, so the plan row already reflects the
/// *whole* run's history — including a pre-pause phase from before a resume
/// (issue #575). The `TerminalCounts` returned by a single `execute_plan`
/// invocation only covers the items just processed in that segment, which
/// would silently regress the plan's counters if fed directly to
/// `complete_run`/`pause_run` after a resume continues a previously-paused
/// run. Falls back to `segment_counts` if the fetch fails (best-effort,
/// matching this function's existing `let _ = ...` error-swallowing
/// elsewhere).
async fn cumulative_counts(
    pool: &SqlitePool,
    plan_id: &str,
    segment_counts: &TerminalCounts,
) -> TerminalCounts {
    match plans_repo::get_plan(pool, plan_id, false).await {
        Ok(row) => TerminalCounts {
            succeeded: row.items_applied,
            failed: row.items_failed,
            skipped: row.items_skipped,
            cancelled: row.items_cancelled,
        },
        Err(e) => {
            tracing::error!(
                %plan_id, error=%e,
                "failed to fetch cumulative plan counters; using segment-local counts"
            );
            segment_counts.clone()
        }
    }
}

/// Drive `execute_plan` to completion/cancellation/pause on a background
/// task and persist the outcome (terminal state, audit trail, long-op
/// projection). Extracted from `apply_plan`'s inline `tokio::spawn` block so
/// `resume_plan` can restart the executor over a paused run's remaining
/// items instead of leaving `state = "applying"` with nothing running
/// (issue #575, R-Pause-1).
///
/// Fire-and-forget: callers get no return value; progress is observed via
/// the audit trail (`plan_apply_events`) and the optional long-op sink.
fn spawn_executor_run(params: SpawnExecutorParams) {
    let SpawnExecutorParams {
        pool,
        bus,
        plan_id,
        run_id,
        executor_items,
        plan_origin,
        plan_project_id,
        cancel_token,
        skip_set,
        retry_queue,
        run_guard,
        op_emitter,
    } = params;

    tokio::spawn(async move {
        // Own the RAII removal guard for the whole task scope. Its `Drop`
        // removes the registry entry on ANY exit — normal completion *or* an
        // unwind if `execute_plan` panics mid-apply (FR-017 scenario 2). This
        // is the single removal site; there is no explicit `registry.remove`.
        let _run_guard = run_guard;

        let callbacks = PlanApplyCallbacks {
            pool: pool.clone(),
            bus: bus.clone(),
            plan_id: plan_id.clone(),
            run_id: run_id.clone(),
            op_emitter: op_emitter.clone(),
        };

        let outcome =
            execute_plan(executor_items, &callbacks, &cancel_token, &skip_set, &retry_queue).await;

        // Compute terminal state and persist.
        match outcome {
            ApplyOutcome::Completed(counts) => {
                // `counts` covers only the items processed in THIS segment.
                // After a resume (issue #575), that undercounts a prior
                // pre-pause phase — use the plan's cumulative counters
                // instead (see `cumulative_counts`).
                let counts = cumulative_counts(&pool, &plan_id, &counts).await;
                let terminal = counts.terminal_state(false).to_owned();
                let at = Timestamp::now_iso();

                // Spec 017 C5: on a fully-applied archive plan, drive the owning
                // project into `archived` (the legitimate requires-plan closure).
                // Only a clean `applied` terminal qualifies — a partial/failed
                // apply leaves the project where it is.
                if terminal == "applied" && plan_origin == "archive" {
                    if let Some(project_id) = plan_project_id.as_deref() {
                        finalize_archive_lifecycle(&pool, &bus, &plan_id, project_id).await;
                    }
                }

                // #665: on a fully-applied project_create plan, fire the
                // Created manifest trigger — see finalize_project_create_manifest
                // for why origin_path is the project's PATH here, not its id.
                if terminal == "applied" && plan_origin == "project" {
                    if let Some(project_path) = plan_project_id.as_deref() {
                        finalize_project_create_manifest(&pool, &bus, project_path).await;
                    }
                }

                // Spec 049: on a successful (or partially-applied) generation
                // plan apply, write the first-materialization
                // `PreparedSourceView` (state `current`) from the succeeded
                // link items. Failed/skipped items are simply omitted — a
                // single missing source never blocks recording the rest of
                // the view (FR-019).
                if (terminal == "applied" || terminal == "partially_applied")
                    && plan_origin == "prepared_view_generation"
                {
                    if let Some(project_id) = plan_project_id.as_deref() {
                        finalize_view_generation(&pool, &plan_id, project_id).await;
                    }
                }

                // Spec 026 T017/T018: on a (fully or partially) applied
                // view-removal/regeneration plan, update the PreparedSourceView
                // state to match reality — see `finalize_view_removal`/
                // `finalize_view_regeneration` for why removal gets an explicit
                // terminal write while regeneration rides the staleness sweep.
                if terminal == "applied" || terminal == "partially_applied" {
                    match plan_origin.as_str() {
                        "prepared_view_removal" => {
                            finalize_view_removal(&pool, &plan_id, &terminal).await;
                        }
                        "prepared_view_regeneration" => {
                            finalize_view_regeneration(&pool, &plan_id).await;
                        }
                        _ => {}
                    }
                }

                let _ = apply_repo::complete_run(
                    &pool,
                    &plan_id,
                    &run_id,
                    &terminal,
                    counts.succeeded,
                    counts.failed,
                    counts.skipped,
                    counts.cancelled,
                )
                .await;

                let _ = apply_repo::append_event(
                    &pool,
                    &new_id(),
                    &run_id,
                    &plan_id,
                    None,
                    "applying",
                    &terminal,
                    &at,
                    None,
                    None,
                )
                .await;

                let _ = bus
                    .publish(
                        TOPIC_PLAN_APPLYING_COMPLETED,
                        Source::System,
                        PlanApplyingCompleted {
                            plan_id: plan_id.clone(),
                            run_id: run_id.clone(),
                            terminal_state: terminal.clone(),
                            items_applied: counts.succeeded,
                            items_failed: counts.failed,
                            items_skipped: counts.skipped,
                            items_cancelled: counts.cancelled,
                            at: at.clone(),
                        },
                    )
                    .await;

                // Long-op terminal event (spec 042 US16). `terminal` is
                // "completed" unless any item failed, in which case it is
                // "failed" — map that onto Completed/Failed event + status.
                if let Some(emitter) = op_emitter.as_ref() {
                    let failed_run = terminal == "failed";
                    let (event_type, status) = if failed_run {
                        (OperationEventType::Failed, OperationStatus::Failed)
                    } else {
                        (OperationEventType::Completed, OperationStatus::Completed)
                    };
                    let handle = emitter.handle(status);
                    emitter.emit(
                        event_type,
                        json!({
                            "handle": handle,
                            "planId": plan_id,
                            "runId": run_id,
                            "terminalState": terminal,
                            "itemsApplied": counts.succeeded,
                            "itemsFailed": counts.failed,
                            "itemsSkipped": counts.skipped,
                            "itemsCancelled": counts.cancelled,
                            "at": at,
                        }),
                    );
                }
            }

            ApplyOutcome::Cancelled(counts) => {
                let at = Timestamp::now_iso();

                // Batch-cancel remaining pending items (T021: emit per-item audit row for EACH).
                match apply_repo::list_pending_items(&pool, &plan_id).await {
                    Ok(pending_ids) => {
                        let _ = apply_repo::batch_cancel_pending_items(&pool, &plan_id).await;
                        for item_id in &pending_ids {
                            audit_item_cancelled(
                                &pool, &bus, &run_id, &plan_id, item_id, "pending", &at,
                            )
                            .await;
                        }
                    }
                    Err(e) => {
                        // #750: `list_pending_items` failing here is assumed
                        // transient (DB contention), not permanent — retry
                        // once before degrading to a bulk-only cancel, so the
                        // common case still gets full per-item audit rows.
                        tracing::error!(error=%e, "failed to list pending items for per-item cancel audit; retrying once");
                        match apply_repo::list_pending_items(&pool, &plan_id).await {
                            Ok(pending_ids) => {
                                let _ =
                                    apply_repo::batch_cancel_pending_items(&pool, &plan_id).await;
                                for item_id in &pending_ids {
                                    audit_item_cancelled(
                                        &pool, &bus, &run_id, &plan_id, item_id, "pending", &at,
                                    )
                                    .await;
                                }
                            }
                            Err(e2) => {
                                tracing::error!(error=%e2, "list_pending_items failed twice; falling back to a single aggregate cancel audit row");
                                let cancelled_count =
                                    apply_repo::batch_cancel_pending_items(&pool, &plan_id)
                                        .await
                                        .unwrap_or(0);
                                // Degraded but non-silent: one aggregate durable
                                // row instead of per-item rows, since item ids
                                // are unavailable without changing
                                // `batch_cancel_pending_items`'s return type
                                // (persistence_db, out of this fix's scope).
                                let entry = AuditLogEntry::new(
                                    EntityType::FilesystemPlan,
                                    deterministic_entity_id("plan_apply.bulk_cancel", &plan_id),
                                    "plan.bulk_cancel_degraded",
                                    "user",
                                    Outcome::Refused,
                                    Severity::Workflow,
                                    domain_core::ids::EntityId::new(),
                                )
                                .with_reason_code("list_pending_items_unavailable")
                                .with_payload(json!({
                                    "planId": plan_id,
                                    "runId": run_id,
                                    "cancelledCount": cancelled_count,
                                }));
                                if let Err(e3) = bus
                                    .write_audit(
                                        entry,
                                        TOPIC_PLAN_APPLYING_COMPLETED,
                                        Source::System,
                                        json!({"planId": plan_id, "cancelledCount": cancelled_count}),
                                    )
                                    .await
                                {
                                    tracing::error!(error=%e3, "durable fallback audit write failed for degraded bulk cancel");
                                }
                            }
                        }
                    }
                }

                // Sweep items orphaned `applying` by a mid-run retry whose
                // DB flip (`retry_plan_item`) landed but whose re-execution
                // never got picked up by the executor's retry-drain before
                // cancellation was observed (review fix, #742 follow-up).
                // `batch_cancel_pending_items` above only targets `pending`
                // and would otherwise leave these permanently stuck with no
                // terminal audit record.
                match apply_repo::cancel_orphaned_applying_items(&pool, &plan_id).await {
                    Ok(orphaned_ids) => {
                        for item_id in &orphaned_ids {
                            audit_item_cancelled(
                                &pool, &bus, &run_id, &plan_id, item_id, "applying", &at,
                            )
                            .await;
                        }
                    }
                    Err(e) => {
                        tracing::error!(error=%e, "failed to sweep orphaned applying items for cancel audit");
                    }
                }

                // Fetch cumulative counters (see `cumulative_counts`) AFTER
                // the batch-cancel above so the just-cancelled items are
                // included.
                let counts = cumulative_counts(&pool, &plan_id, &counts).await;

                let _ = apply_repo::complete_run(
                    &pool,
                    &plan_id,
                    &run_id,
                    "cancelled",
                    counts.succeeded,
                    counts.failed,
                    counts.skipped,
                    counts.cancelled,
                )
                .await;

                let _ = apply_repo::append_event(
                    &pool,
                    &new_id(),
                    &run_id,
                    &plan_id,
                    None,
                    "applying",
                    "cancelled",
                    &at,
                    None,
                    None,
                )
                .await;

                let _ = bus
                    .publish(
                        TOPIC_PLAN_APPLYING_COMPLETED,
                        Source::System,
                        PlanApplyingCompleted {
                            plan_id: plan_id.clone(),
                            run_id: run_id.clone(),
                            terminal_state: "cancelled".to_owned(),
                            items_applied: counts.succeeded,
                            items_failed: counts.failed,
                            items_skipped: counts.skipped,
                            items_cancelled: counts.cancelled,
                            at: at.clone(),
                        },
                    )
                    .await;

                // Long-op terminal event for a cancelled run (spec 042 US16).
                if let Some(emitter) = op_emitter.as_ref() {
                    let handle = emitter.handle(OperationStatus::Cancelled);
                    emitter.emit(
                        OperationEventType::Completed,
                        json!({
                            "handle": handle,
                            "planId": plan_id,
                            "runId": run_id,
                            "terminalState": "cancelled",
                            "itemsApplied": counts.succeeded,
                            "itemsFailed": counts.failed,
                            "itemsSkipped": counts.skipped,
                            "itemsCancelled": counts.cancelled,
                            "at": at,
                        }),
                    );
                }
            }

            ApplyOutcome::Paused { reason, counts } => {
                let at = Timestamp::now_iso();
                // See `cumulative_counts`: covers a prior pre-pause phase
                // too, so a second pause after a resume doesn't regress the
                // plan's counters.
                let counts = cumulative_counts(&pool, &plan_id, &counts).await;

                let _ = apply_repo::pause_run(
                    &pool,
                    &plan_id,
                    &run_id,
                    &reason,
                    counts.succeeded,
                    counts.failed,
                    counts.skipped,
                    counts.cancelled,
                    // items_pending: total - all resolved
                    counts.succeeded + counts.failed + counts.skipped + counts.cancelled,
                )
                .await;

                let _ = apply_repo::append_event(
                    &pool,
                    &new_id(),
                    &run_id,
                    &plan_id,
                    None,
                    "applying",
                    "paused",
                    &at,
                    None,
                    None,
                )
                .await;

                // Long-op non-terminal pause projection (spec 042 US16). The
                // run is not terminal — the UI keeps the handle and waits for a
                // resume to continue streaming. Status reflects "running" since
                // the op is still alive (paused), not Completed/Failed.
                if let Some(emitter) = op_emitter.as_ref() {
                    let handle = emitter.handle(OperationStatus::Running);
                    emitter.emit(
                        OperationEventType::Warning,
                        json!({
                            "handle": handle,
                            "planId": plan_id,
                            "runId": run_id,
                            "pauseReason": reason,
                            "at": at,
                        }),
                    );
                }

                let _ = bus
                    .publish(
                        TOPIC_PLAN_APPLYING_PAUSED,
                        Source::System,
                        PlanApplyingPaused {
                            plan_id: plan_id.clone(),
                            run_id: run_id.clone(),
                            pause_reason: reason,
                            at,
                        },
                    )
                    .await;
            }
        }
    });
}

// ── apply_plan_channel_free ───────────────────────────────────────────────────

/// Channel-free variant of [`apply_plan`] (spec 037 archive/cleanup apply).
///
/// `apply_plan` requires a caller-supplied `approval_token` (spec 025 A1) and
/// is normally reached through the webview's `tauri::ipc::Channel`-carrying
/// `plans.apply` command so live per-item progress can stream back. Two kinds
/// of caller have neither a token in hand nor a `Channel` to construct:
///
/// - The spec 037 Layer-2 WebDriver test harness, which drives the real
///   backend via `window.__ALM_E2E__.invoke(...)` and structurally cannot
///   create a `tauri::ipc::Channel` from a test script.
/// - Any archive/cleanup UI surface that only needs a fire-and-poll apply
///   (poll [`get_apply_status`] for the durable terminal counts) rather than
///   a live progress stream.
///
/// This mirrors the auto-approve-then-apply pattern `inbox_plan::
/// apply_inbox_plan` already established for inbox plans, generalised to any
/// plan id (no inbox-item link required): approve the plan if it is still
/// `ready_for_review`, tolerate an already-`approved` plan by reusing its
/// stored token, then start the same background executor as `apply_plan`
/// with no progress sink. Constitution §II (reviewable filesystem mutation +
/// audit) is preserved unchanged — this only removes the live-progress
/// transport, not any approval, CAS, or audit step.
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
/// - `plan.invalid_state` — plan is not `ready_for_review`/`approved` (e.g.
///   already applied/discarded/applying), or the approve step's non-empty
///   items invariant failed.
/// - `plan.conflict.overlap` — concurrent apply already running.
pub async fn apply_plan_channel_free(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
) -> Result<PlanApplyResponse, ContractError> {
    let approve_resp = crate::plans::approve_plan(pool, bus, plan_id, "user").await;

    let approval_token = match approve_resp {
        Ok(resp) => resp.approval_token,
        // Already approved (idempotent-ish) — fetch the stored token and carry
        // through to apply_plan. Any other state (applying/applied/discarded/
        // stale) surfaces the original error unchanged.
        Err(e) if e.code == ErrorCode::PlanInvalidState => {
            let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;
            if plan_row.state != "approved" {
                return Err(e);
            }
            plan_row.approval_token.unwrap_or_default()
        }
        Err(e) => return Err(e),
    };

    apply_plan(pool, bus, plan_id, &approval_token, None).await
}

// ── cancel_plan ───────────────────────────────────────────────────────────────

/// Cancel an in-flight plan apply (US3, T032).
///
/// Signals the cancellation token; the executor finishes the current item
/// and stops. Remaining pending items are transitioned to `cancelled` by
/// the executor's background task after it observes the cancel signal.
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
/// - `plan.not_in_apply` — plan is not in applying or paused state.
pub async fn cancel_plan(
    pool: &SqlitePool,
    plan_id: &str,
) -> Result<PlanCancelResponse, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    if !matches!(plan_row.state.as_str(), "applying" | "paused") {
        return Err(ContractError::new(
            ErrorCode::PlanNotInApply,
            format!(
                "plan {} is not in applying or paused state; current state is '{}'",
                plan_id, plan_row.state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Signal cancellation to the running executor.
    {
        let registry = active_runs();
        if let Some(run) = registry.get(plan_id) {
            run.cancel_token.cancel();
            drop(run);
        }
        drop(registry);
    }

    let cancelled_at = Timestamp::now_iso();

    Ok(PlanCancelResponse {
        plan_id: plan_id.to_owned(),
        cancelled_at,
        items_applied: plan_row.items_applied,
        items_cancelled: plan_row.items_pending,
    })
}

// ── resume_plan ───────────────────────────────────────────────────────────────

/// Resolve the path to probe when re-validating a `volume.unavailable`/
/// `disk.full` pause for `item` (spec 025 T049/T050).
///
/// `prefer_source` picks which root is tried first: `volume.unavailable`
/// passes `true` (a disconnected drive is far more often the *source* of a
/// move than its destination — probing the destination first let a still-
/// disconnected source pass re-validation whenever the destination happened
/// to be reachable, so resume proceeded and the executor immediately
/// re-paused instead of cleanly refusing); `disk.full` passes `false` (free
/// space is a destination-capacity question). Either way both roots are
/// tried as a fallback if the preferred one isn't resolvable — both are
/// registered roots, which are real, already-existing directories, so no
/// ancestor-walk is needed. Archive destinations are pre-computed absolute
/// paths that may point at a not-yet-created subdirectory (spec 017), so
/// that branch walks up to the nearest existing ancestor before probing.
async fn resolve_item_probe_path(
    pool: &SqlitePool,
    item: &plans_repo::PlanItemRow,
    prefer_source: bool,
) -> Option<Utf8PathBuf> {
    let (first, second) = if prefer_source {
        (item.from_root_id.as_deref(), item.to_root_id.as_deref())
    } else {
        (item.to_root_id.as_deref(), item.from_root_id.as_deref())
    };

    for root_id in [first, second].into_iter().flatten() {
        if let Some(root) = resolve_root_path(pool, root_id).await {
            return Some(Utf8PathBuf::from(root));
        }
    }

    if let Some(archive) = item.archive_path.as_deref().filter(|a| !a.is_empty()) {
        let p = Utf8PathBuf::from(archive);
        if p.is_absolute() {
            return Some(nearest_existing_ancestor(&p));
        }
    }
    None
}

/// Walk up from `path` to the nearest ancestor that exists on disk.
/// Returns `path` unchanged if no ancestor (including the filesystem root)
/// exists — the subsequent probe will then fail informatively rather than
/// silently mis-reporting on a bogus path.
fn nearest_existing_ancestor(path: &Utf8Path) -> Utf8PathBuf {
    let mut candidate = path.to_path_buf();
    while !candidate.exists() {
        match candidate.parent() {
            Some(parent) if parent != candidate => candidate = parent.to_path_buf(),
            _ => break,
        }
    }
    candidate
}

/// Re-validate the pause condition recorded on a paused run before allowing
/// `resume_plan` to transition it back to `applying` (contract
/// `plan.resume.json`, R-Pause-1/R-Env-1, spec 025 T048-T050).
///
/// `pause_reason` is the code stored on the run row by whichever executor
/// pause path last fired (`item.stale`, `volume.unavailable`, `disk.full`).
/// Each maps to the plan item that triggered it (the executor halts
/// immediately on the first pausing item, so the highest `item_index` among
/// matching items is always the current cause) and re-runs the same check
/// that originally paused the run against that item's current on-disk
/// state.
///
/// Returns `Ok(())` when the condition is resolved, when no matching item
/// can be found (nothing left to re-validate against), or when
/// `pause_reason` is `None`/unrecognized (permissive — v1 only classifies
/// these three R-Pause-1 conditions).
///
/// # Errors
///
/// Returns `ContractError` with `item.still.stale`, `volume.still.unavailable`,
/// or `disk.still.full` when the corresponding condition still holds.
async fn revalidate_pause_condition(
    pool: &SqlitePool,
    plan_id: &str,
    pause_reason: Option<&str>,
) -> Result<(), ContractError> {
    let Some(reason) = pause_reason else { return Ok(()) };

    match reason {
        "item.stale" => {
            let Some(item) =
                apply_repo::get_last_stale_item(pool, plan_id).await.map_err(db_err)?
            else {
                return Ok(());
            };
            let Some(root_id) = item.from_root_id.as_deref() else { return Ok(()) };
            let Some(root) = resolve_root_path(pool, root_id).await else { return Ok(()) };
            let abs = Utf8PathBuf::from(root).join(&item.from_relative_path);
            let snapshot = CasSnapshot {
                approved_mtime: item.approved_mtime.clone(),
                approved_size_bytes: item.approved_size_bytes,
            };
            fs_executor::ops::check_cas(&abs, &snapshot).map_err(|failure| {
                ContractError::new(
                    ErrorCode::ItemStillStale,
                    format!("item {} in plan {plan_id} is still stale: {failure}", item.id),
                    ErrorSeverity::Blocking,
                    false,
                )
            })
        }
        "volume.unavailable" => {
            let Some(item) =
                apply_repo::get_last_item_with_failure_prefix(pool, plan_id, "volume.unavailable")
                    .await
                    .map_err(db_err)?
            else {
                return Ok(());
            };
            let Some(probe_path) = resolve_item_probe_path(pool, &item, true).await else {
                return Ok(());
            };
            fs_executor::ops::recheck_volume_available(&probe_path).map_err(|failure| {
                ContractError::new(
                    ErrorCode::VolumeStillUnavailable,
                    format!("plan {plan_id}'s volume is still unavailable: {failure}"),
                    ErrorSeverity::Blocking,
                    false,
                )
            })
        }
        "disk.full" => {
            let Some(item) =
                apply_repo::get_last_item_with_failure_prefix(pool, plan_id, "disk.full")
                    .await
                    .map_err(db_err)?
            else {
                return Ok(());
            };
            let Some(probe_path) = resolve_item_probe_path(pool, &item, false).await else {
                return Ok(());
            };
            let required_bytes = u64::try_from(item.approved_size_bytes.unwrap_or(0)).unwrap_or(0);
            fs_executor::ops::recheck_disk_space(&probe_path, required_bytes).map_err(|failure| {
                ContractError::new(
                    ErrorCode::DiskStillFull,
                    format!("plan {plan_id}'s destination volume is still full: {failure}"),
                    ErrorSeverity::Blocking,
                    false,
                )
            })
        }
        // v1 only classifies the three R-Pause-1 conditions above; any other
        // recorded reason (or none) has nothing to re-validate against.
        _ => Ok(()),
    }
}

/// Resume a paused plan apply run (R-Pause-1, T052).
///
/// Re-validates the pause condition recorded on the run
/// ([`revalidate_pause_condition`]) before transitioning back to
/// `applying`. If the condition is still present, resume is refused with
/// the matching `*.still.*` code and the plan stays `paused` — it is never
/// silently flipped to `applying` for a run that would immediately stall
/// again (constitution §II, issue #575).
///
/// On success, re-registers an [`ActiveRun`] (R-Concur-1) and re-spawns the
/// executor (via [`spawn_executor_run`]) over the plan's remaining
/// `pending` items. Items already `failed` when the run paused — including
/// the one that triggered the pause — stay terminal for this run; per-item
/// retry is a separate affordance (`retry_plan_item`), not part of resume.
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
/// - `run.not_paused` — plan is not in paused state.
/// - `run.not_found` — no active run recorded, or `run_id` does not match it.
/// - `item.still.stale` / `volume.still.unavailable` / `disk.still.full` —
///   the pause condition has not been resolved.
/// - `plan.conflict.overlap` — another active run now claims an overlapping
///   path (FR-017, R-Concur-1) — rare, since the plan's own claim lapsed
///   while paused.
pub async fn resume_plan(
    pool: &SqlitePool,
    bus: &EventBus,
    plan_id: &str,
    run_id: &str,
) -> Result<PlanResumeResponse, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    if plan_row.state != "paused" {
        return Err(ContractError::new(
            ErrorCode::RunNotPaused,
            format!("plan {} is not paused; current state is '{}'", plan_id, plan_row.state),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Re-validate run id is the active run.
    let active_run_row = apply_repo::get_active_run(pool, plan_id).await.map_err(db_err)?;
    let active_run_row = active_run_row.ok_or_else(|| {
        ContractError::new(
            ErrorCode::RunNotFound,
            format!("no active run found for plan {plan_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    if active_run_row.id != run_id {
        return Err(ContractError::new(
            ErrorCode::RunNotFound,
            format!("run {run_id} is not the active run for plan {plan_id}"),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // R-Pause-1 / R-Env-1: refuse resume while the pause condition persists.
    revalidate_pause_condition(pool, plan_id, active_run_row.pause_reason.as_deref()).await?;

    // Load the plan's remaining pending items and rebuild the executor's
    // root map (mirrors apply_plan's item preparation, T023a).
    let item_rows = plans_repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;

    let mut root_map: HashMap<String, Utf8PathBuf> = HashMap::new();
    for row in &item_rows {
        for rid in [row.from_root_id.as_ref(), row.to_root_id.as_ref()].into_iter().flatten() {
            if root_map.contains_key(rid) {
                continue;
            }
            if let Some(path) = resolve_root_path(pool, rid).await {
                root_map.insert(rid.clone(), Utf8PathBuf::from(path));
            }
        }
    }

    // `pending` items are the genuine remaining work; `failed` items are
    // included too (not for re-execution — `execute_plan`'s forward loop
    // treats "failed" as an already-terminal state and skips it as a no-op)
    // so that `id -> ExecutorItem` lookup is complete for the resumed run.
    // Without this, `retry_plan_item` can flip a pre-pause-failed item's DB
    // row `failed -> applying` and queue it, but the executor's retry-drain
    // (`item_by_id` in `fs_executor::run::execute_plan`) has no entry for
    // it — the item is then permanently stuck `applying` with no terminal
    // audit record (review fix, resume+retry item-set mismatch).
    // succeeded/skipped/cancelled items are still excluded: they are truly
    // terminal and never eligible for retry.
    let executor_items: Vec<ExecutorItem> = item_rows
        .iter()
        .filter(|r| matches!(r.item_state.as_str(), "pending" | "failed"))
        .map(|r| item_row_to_executor_item(r, &root_map, &plan_row.destructive_destination))
        .collect();

    // Re-register the ActiveRun (R-Concur-1). A paused run has no registry
    // entry — the original spawned task's ActiveRunGuard already dropped it
    // when execute_plan returned Paused — so resume must reclaim the plan's
    // full claimed path set (all items, not just the remaining pending
    // ones: the plan still owns its whole footprint for the run's
    // duration) before the executor can run again. Cancel/skip/retry state
    // does not carry over a pause boundary; a fresh set is correct here.
    let path_set = compute_plan_path_set(&item_rows, &root_map);
    let cancel_token = CancellationToken::new();
    let skip_set = SkipSet::new();
    let retry_queue = RetryQueue::new();
    let run_guard = check_overlap_and_register(
        plan_id,
        ActiveRun {
            cancel_token: cancel_token.clone(),
            skip_set: skip_set.clone(),
            retry_queue: retry_queue.clone(),
            run_id: run_id.to_owned(),
            path_set,
        },
    )?;

    apply_repo::resume_run(pool, plan_id, run_id).await.map_err(db_err)?;

    let resumed_at = Timestamp::now_iso();

    bus.publish(
        TOPIC_PLAN_APPLYING_RESUMED,
        Source::User,
        PlanApplyingResumed {
            plan_id: plan_id.to_owned(),
            run_id: run_id.to_owned(),
            at: resumed_at.clone(),
        },
    )
    .await
    .map_err(bus_err)?;

    let _ = apply_repo::append_event(
        pool,
        &new_id(),
        run_id,
        plan_id,
        None,
        "paused",
        "applying",
        &resumed_at,
        None,
        None,
    )
    .await;

    // Restart the executor over the remaining pending items (issue #575).
    // No live progress-channel caller for resume today (the contract has no
    // `event_sink` parameter) — `op_emitter: None` matches
    // `apply_plan_channel_free`'s no-live-progress mode; the durable audit
    // trail above is unaffected.
    spawn_executor_run(SpawnExecutorParams {
        pool: pool.clone(),
        bus: bus.clone(),
        plan_id: plan_id.to_owned(),
        run_id: run_id.to_owned(),
        executor_items,
        plan_origin: plan_row.origin,
        plan_project_id: plan_row.origin_path,
        cancel_token,
        skip_set,
        retry_queue,
        run_guard,
        op_emitter: None,
    });

    Ok(PlanResumeResponse { plan_id: plan_id.to_owned(), run_id: run_id.to_owned(), resumed_at })
}

// ── skip_plan_item ────────────────────────────────────────────────────────────

/// Skip a pending item within an active apply (US4, T039).
///
/// The item must be `pending` and the plan must be `applying`.
/// The skip is registered in the in-memory SkipSet; the executor picks it
/// up before starting the next item.
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
/// - `plan.not_in_apply` — plan is not applying.
/// - `item.not_found` — item not found.
/// - `item.not_pending` — item is not in pending state.
pub async fn skip_plan_item(
    pool: &SqlitePool,
    plan_id: &str,
    item_id: &str,
) -> Result<PlanItemSkipResponse, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    if plan_row.state != "applying" {
        return Err(ContractError::new(
            ErrorCode::PlanNotInApply,
            format!(
                "plan {} is not in applying state; current state is '{}'",
                plan_id, plan_row.state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Find the item.
    let items = plans_repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    let item = items.iter().find(|i| i.id == item_id).ok_or_else(|| {
        ContractError::new(
            ErrorCode::ItemNotFound,
            format!("item {item_id} not found in plan {plan_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    if item.item_state != "pending" {
        return Err(ContractError::new(
            ErrorCode::ItemNotPending,
            format!("item {} is not pending; current state is '{}'", item_id, item.item_state),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Inject into the executor's skip set.
    {
        let registry = active_runs();
        if let Some(run) = registry.get(plan_id) {
            run.skip_set.insert(item_id);
            drop(run);
        }
        drop(registry);
    }

    Ok(PlanItemSkipResponse { item_id: item_id.to_owned(), new_state: "skipped".to_owned() })
}

// ── retry_plan_item ───────────────────────────────────────────────────────────

/// Retry a failed item within an active apply (US4, T040).
///
/// The item must be `failed` and the plan must be `applying`.
/// The item state is reset to `pending` in the database; the executor
/// will re-execute it on the next pass via the retry queue.
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
/// - `plan.not_in_apply` — plan is not applying.
/// - `item.not_found` — item not found.
/// - `item.not_failed` — item is not in failed state.
/// - `run.not_found` — the plan is `applying` in the DB but no `ActiveRun` is
///   registered (the executor task already finished and dropped its
///   registry entry — a narrow race between the run's completion and this
///   call). Rejecting here, before any DB write, avoids flipping the item to
///   `applying` with nothing left to ever re-execute or terminalize it
///   (review fix: an item stuck `applying` forever with no terminal audit
///   record).
pub async fn retry_plan_item(
    pool: &SqlitePool,
    plan_id: &str,
    item_id: &str,
) -> Result<PlanItemRetryResponse, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    if plan_row.state != "applying" {
        return Err(ContractError::new(
            ErrorCode::PlanNotInApply,
            format!("plan {plan_id} is not in applying state (use plan.retry for terminal plans)"),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    let items = plans_repo::list_plan_items(pool, plan_id).await.map_err(db_err)?;
    let item = items.iter().find(|i| i.id == item_id).ok_or_else(|| {
        ContractError::new(
            ErrorCode::ItemNotFound,
            format!("item {item_id} not found in plan {plan_id}"),
            ErrorSeverity::Blocking,
            false,
        )
    })?;

    if item.item_state != "failed" {
        return Err(ContractError::new(
            ErrorCode::ItemNotFailed,
            format!(
                "item {} is not failed; current state is '{}'. \
                 For plan-level retry use plan.retry on a terminal plan.",
                item_id, item.item_state
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Require a live ActiveRun for this plan BEFORE mutating any DB state
    // (see doc comment above). This does not fully eliminate the race (the
    // run could still finish between this check and the DB write below),
    // but it closes the common case: retrying against a plan whose run has
    // already reached a terminal state.
    if !active_runs().contains_key(plan_id) {
        return Err(ContractError::new(
            ErrorCode::RunNotFound,
            format!(
                "no active run found for plan {plan_id}; the run may have already finished. \
                 For plan-level retry use plan.retry on a terminal plan."
            ),
            ErrorSeverity::Blocking,
            false,
        ));
    }

    // Transition item back to applying in DB (failed → applying).
    apply_repo::item_retry_applying(pool, item_id, plan_id).await.map_err(db_err)?;

    // Register in the retry queue so the executor re-executes it.
    {
        let registry = active_runs();
        if let Some(run) = registry.get(plan_id) {
            run.retry_queue.push(item_id);
            drop(run);
        }
        drop(registry);
    }

    Ok(PlanItemRetryResponse { item_id: item_id.to_owned(), new_state: "applying".to_owned() })
}

// ── confirm_plan_destructive_items ────────────────────────────────────────────

/// Confirm every destructive (delete/trash) item in a plan, persisting
/// `plan_items.destructive_confirmed = 1` (FR-003, D9, issue #741).
///
/// This is the write half of the executor's destructive-confirm gate
/// (`fs_executor::run::execute_plan`'s `destructive_unconfirmed` refusal,
/// `item_row_to_executor_item`'s `requires_destructive_confirm` derivation):
/// before this function existed, `destructive_confirmed` had no writer
/// anywhere in the codebase, so every delete/trash item was permanently
/// refused at apply time regardless of what the plan's `destructiveDestination`
/// UI showed.
///
/// Plan-level (not per-item): the caller confirms a whole plan's destructive
/// items in one call, matching the existing panel-wide destructive-destination
/// control rather than requiring a per-item id round-trip the frontend DTOs
/// (`InboxPlanAction`, `PlanItemDetail`) don't carry.
///
/// Intentionally permissive on plan state: confirming while a run is
/// `applying`/`paused` cannot retroactively affect an already-snapshotted
/// forward pass, but a `paused` run's remaining `pending` items ARE re-read
/// fresh from the DB on `resume_plan`, so confirming while paused is a
/// legitimate way to unblock a stalled run before resuming.
///
/// Returns the number of items whose `destructive_confirmed` flag flipped
/// (idempotent — already-confirmed items are not re-counted).
///
/// # Errors
///
/// - `plan.not_found` — plan not found.
pub async fn confirm_plan_destructive_items(
    pool: &SqlitePool,
    plan_id: &str,
) -> Result<i64, ContractError> {
    // Existence check only — see docstring for why plan state is not gated.
    plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;

    let confirmed =
        plans_repo::confirm_plan_destructive_items(pool, plan_id).await.map_err(db_err)?;
    i64::try_from(confirmed).map_err(|e| {
        ContractError::new(
            ErrorCode::InternalDatabase,
            format!("confirmed item count overflowed i64: {e}"),
            ErrorSeverity::Fatal,
            true,
        )
    })
}

// ── get_apply_status ──────────────────────────────────────────────────────────

/// Fetch the current apply status for a plan.
///
/// # Errors
///
/// Returns `ContractError` on not-found or database failure.
pub async fn get_apply_status(
    pool: &SqlitePool,
    plan_id: &str,
) -> Result<PlanApplyStatus, ContractError> {
    let plan_row = plans_repo::get_plan(pool, plan_id, false).await.map_err(db_err)?;
    let active_run = apply_repo::get_active_run(pool, plan_id).await.map_err(db_err)?;

    let (run_id, pause_reason) = active_run.map_or((None, None), |r| (Some(r.id), r.pause_reason));

    Ok(PlanApplyStatus {
        plan_id: plan_id.to_owned(),
        run_id,
        plan_state: plan_row.state,
        items_total: plan_row.items_total,
        items_applied: plan_row.items_applied,
        items_failed: plan_row.items_failed,
        items_skipped: plan_row.items_skipped,
        items_cancelled: plan_row.items_cancelled,
        items_pending: plan_row.items_pending,
        pause_reason,
    })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use audit::EventBus;
    use persistence_db::repositories::audit::{
        count_audit_entries, list_audit_entries, AuditLogFilter,
    };
    use persistence_db::repositories::plans as repo;
    use persistence_db::Database;
    use uuid::Uuid;

    async fn setup() -> (Database, EventBus) {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        let bus = EventBus::with_pool(db.pool().clone());
        (db, bus)
    }

    async fn insert_approved_plan_with_items(db: &Database, plan_id: &str, item_count: usize) {
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: plan_id,
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

        for i in 0..item_count {
            repo::insert_plan_item(
                db.pool(),
                &repo::InsertPlanItem {
                    id: &format!("{plan_id}-item-{i}"),
                    plan_id,
                    item_index: i64::try_from(i + 1).unwrap(),
                    name: "file.fits",
                    action: "move",
                    from_root_id: None,
                    // Plan-scoped paths: tests share the process-global
                    // ACTIVE_RUNS registry and run in parallel, so identical
                    // relative paths across tests would trip the FR-017
                    // overlap guard non-deterministically.
                    from_relative_path: &format!("{plan_id}/raw/file-{i}.fits"),
                    to_root_id: None,
                    to_relative_path: &format!("{plan_id}/archive/file-{i}.fits"),
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

        repo::update_plan_state(db.pool(), plan_id, "ready_for_review").await.unwrap();
        repo::set_approved(db.pool(), plan_id, "2026-06-01T00:00:00Z", "test-token").await.unwrap();
    }

    /// Regression (FIX review, priority-check #2): `resolve_root_path`'s
    /// `registered_sources` read-through must never resurface a
    /// pre-remap path after `apply_root_remap` commits the new one.
    #[tokio::test]
    async fn resolve_root_path_reflects_remap_not_stale_cache() {
        use contracts_core::first_run::{
            OrganizationState, RegisterSourceRequest, ScanDepth, SourceKind,
        };

        // Needs two real, existing directories; "/tmp" and "/var/tmp" are Unix-only.
        if !cfg!(unix) {
            return;
        }

        let (db, bus) = setup().await;

        let reg = crate::first_run::register_source(
            db.pool(),
            &bus,
            &RegisterSourceRequest {
                kind: SourceKind::Project,
                path: "/tmp".to_owned(),
                kind_subtype: None,
                scan_depth: ScanDepth::Recursive,
                organization_state: OrganizationState::Organized,
            },
        )
        .await
        .unwrap();

        // Populate the cache via the same registered_sources fallback branch
        // apply_plan's root_map build resolves through.
        let resolved = resolve_root_path(db.pool(), &reg.source_id).await;
        assert_eq!(resolved.as_deref(), Some("/tmp"), "must resolve the registered path");

        // Remap must invalidate the cache entry after its DB write commits.
        crate::first_run::apply_root_remap(db.pool(), &bus, &reg.source_id, "/var/tmp", true)
            .await
            .unwrap();

        let after_remap = resolve_root_path(db.pool(), &reg.source_id).await;
        assert_eq!(
            after_remap.as_deref(),
            Some("/var/tmp"),
            "resolve_root_path must return the remapped path, not a stale cached one"
        );
    }

    #[tokio::test]
    async fn apply_plan_rejects_wrong_state() {
        let (db, bus) = setup().await;
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: "p-draft",
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

        let err = apply_plan(db.pool(), &bus, "p-draft", "tok", None).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanInvalidState);
    }

    #[tokio::test]
    async fn apply_plan_rejects_wrong_token() {
        let (db, bus) = setup().await;
        insert_approved_plan_with_items(&db, "p1", 1).await;

        let err = apply_plan(db.pool(), &bus, "p1", "wrong-token", None).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanApprovalStale);
    }

    #[tokio::test]
    async fn apply_plan_starts_successfully() {
        let (db, bus) = setup().await;
        insert_approved_plan_with_items(&db, "p1", 1).await;

        let resp = apply_plan(db.pool(), &bus, "p1", "test-token", None).await.unwrap();
        assert_eq!(resp.plan_id, "p1");
        assert_eq!(resp.new_state, "applying");
        assert!(!resp.run_id.is_empty());

        // The background executor is spawned via `tokio::spawn`, and the
        // `#[tokio::test]` current-thread runtime only gives it a chance to
        // run at the next `.await` yield point — which is the `get_plan`
        // call right below. On a fast/loaded runner the executor can win that
        // race and finish (this test's item has no real file on disk, so it
        // resolves to a terminal `failed` state) before this read, which is
        // not a bug in `apply_plan` (the CAS to "applying" already succeeded,
        // per `resp.new_state` above) — it's a timing artifact of reading
        // back a state the caller does not otherwise synchronize on. Accept
        // either the transient "applying" state or a terminal state the
        // now-raced-ahead executor already reached.
        let plan = repo::get_plan(db.pool(), "p1", false).await.unwrap();
        assert!(
            matches!(plan.state.as_str(), "applying" | "completed" | "failed"),
            "unexpected plan state after apply_plan: {}",
            plan.state
        );

        // Wait briefly for the background task to complete.
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

    /// T240 (spec 042 US16): a subscribed sink receives the long-op lifecycle —
    /// a `Started` (ItemStarted carrying the running handle), per-item events,
    /// then a terminal `Completed`/`Failed` carrying a terminal handle, with a
    /// strictly increasing `sequence`. The durable audit rows are still written
    /// (asserted separately) — the sink is an additive live projection (§II).
    #[tokio::test]
    async fn apply_plan_streams_operation_events() {
        use std::sync::Mutex;

        let (db, bus) = setup().await;
        insert_approved_plan_with_items(&db, "p-evt", 1).await;

        let captured: Arc<Mutex<Vec<OperationEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_store = captured.clone();
        let sink: OperationEventSink = Arc::new(move |event: OperationEvent| {
            sink_store.lock().unwrap().push(event);
        });

        let resp = apply_plan(db.pool(), &bus, "p-evt", "test-token", Some(sink)).await.unwrap();

        // Let the background executor run to completion.
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let events = captured.lock().unwrap().clone();
        assert!(!events.is_empty(), "sink must receive long-op events");

        // First event is the Started projection carrying a Running handle.
        let first = &events[0];
        assert_eq!(first.event_type, OperationEventType::ItemStarted);
        assert_eq!(first.operation_id, OperationId(resp.run_id.clone()));
        assert_eq!(first.sequence, 0);

        // Sequence is strictly increasing across the run.
        for window in events.windows(2) {
            assert!(window[1].sequence > window[0].sequence, "sequence must be monotonic");
        }

        // The run terminates with a Completed (or Failed) event carrying a
        // terminal handle.
        let last = events.last().unwrap();
        assert!(
            matches!(last.event_type, OperationEventType::Completed | OperationEventType::Failed),
            "last event must be a terminal Completed/Failed, got {:?}",
            last.event_type
        );

        // Durable audit trail is retained: the DB still holds run events.
        let plan = repo::get_plan(db.pool(), "p-evt", false).await.unwrap();
        assert_ne!(plan.state, "approved", "plan must have progressed past approved in the DB");
    }

    // ── Spec 017 C5: archive lifecycle closure ──────────────────────────────

    /// The finalize helper drives a completed project into `archived` and records
    /// the owning plan id — the legitimate closure of the requires-plan gate.
    #[tokio::test]
    async fn finalize_archive_lifecycle_archives_completed_project() {
        use persistence_db::repositories::projects as projects_repo;

        let (db, bus) = setup().await;
        let project_id = Uuid::new_v4().to_string();
        projects_repo::insert_project(
            db.pool(),
            &projects_repo::InsertProject {
                id: &project_id,
                name: "M31 LRGB",
                tool: "PixInsight",
                lifecycle: "completed",
                path: "projects/M31_LRGB",
                notes: None,
                canonical_target_id: None,
                is_mosaic: false,
            },
        )
        .await
        .unwrap();

        finalize_archive_lifecycle(db.pool(), &bus, "plan-arch-1", &project_id).await;

        let project = projects_repo::get_project(db.pool(), &project_id).await.unwrap();
        assert_eq!(project.lifecycle, "archived", "project must be driven to archived");

        // The link is recorded so archive-management commands act O(1).
        let archived = projects_repo::list_archived_projects(db.pool()).await.unwrap();
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].archived_via_plan_id.as_deref(), Some("plan-arch-1"));
    }

    /// #665: a fully-applied `project_create` plan must fire the `Created`
    /// manifest trigger — previously there was no emitter at all for it.
    #[tokio::test]
    async fn finalize_project_create_manifest_writes_created_manifest() {
        use persistence_db::repositories::manifests::list_manifests_for_project;
        use persistence_db::repositories::projects as projects_repo;

        let (db, bus) = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let project_id = Uuid::new_v4().to_string();
        projects_repo::insert_project(
            db.pool(),
            &projects_repo::InsertProject {
                id: &project_id,
                name: "M31 LRGB",
                tool: "PixInsight",
                lifecycle: "setup_incomplete",
                path: dir.path().to_str().unwrap(),
                notes: None,
                canonical_target_id: None,
                is_mosaic: false,
            },
        )
        .await
        .unwrap();

        finalize_project_create_manifest(db.pool(), &bus, dir.path().to_str().unwrap()).await;

        let (rows, _) = list_manifests_for_project(db.pool(), &project_id, None, 10).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reason, "created");
        let manifest =
            app_core_projects::project_manifests::get(db.pool(), &rows[0].id).await.unwrap();
        assert_eq!(manifest.manifest.body.lifecycle_state, "setup_incomplete");
    }

    /// An already-archived project is idempotent: the closure only (re)records
    /// the plan link and never errors.
    #[tokio::test]
    async fn finalize_archive_lifecycle_is_idempotent_for_archived_project() {
        use persistence_db::repositories::projects as projects_repo;

        let (db, bus) = setup().await;
        let project_id = Uuid::new_v4().to_string();
        projects_repo::insert_project(
            db.pool(),
            &projects_repo::InsertProject {
                id: &project_id,
                name: "M31",
                tool: "PixInsight",
                lifecycle: "archived",
                path: "projects/M31",
                notes: None,
                canonical_target_id: None,
                is_mosaic: false,
            },
        )
        .await
        .unwrap();

        finalize_archive_lifecycle(db.pool(), &bus, "plan-arch-2", &project_id).await;

        let project = projects_repo::get_project(db.pool(), &project_id).await.unwrap();
        assert_eq!(project.lifecycle, "archived");
        let archived = projects_repo::list_archived_projects(db.pool()).await.unwrap();
        assert_eq!(archived[0].archived_via_plan_id.as_deref(), Some("plan-arch-2"));
    }

    /// A non-UUID project id must not panic (best-effort logging only).
    #[tokio::test]
    async fn finalize_archive_lifecycle_non_uuid_is_noop() {
        let (db, bus) = setup().await;
        finalize_archive_lifecycle(db.pool(), &bus, "plan-x", "not-a-uuid").await;
        // No panic, no rows.
        let archived = persistence_db::repositories::projects::list_archived_projects(db.pool())
            .await
            .unwrap();
        assert!(archived.is_empty());
    }

    /// Edge-legality guard (Constitution §II): if an archive plan somehow targets
    /// a project that is NOT in a legal `* → archived` source state
    /// (`completed`/`blocked`), the closure must refuse — leaving the lifecycle
    /// unchanged and recording no archive link — rather than CAS an illegal edge
    /// into `archived`.
    #[tokio::test]
    async fn finalize_archive_lifecycle_refuses_illegal_source_state() {
        use persistence_db::repositories::projects as projects_repo;

        let (db, bus) = setup().await;
        let project_id = Uuid::new_v4().to_string();
        projects_repo::insert_project(
            db.pool(),
            &projects_repo::InsertProject {
                id: &project_id,
                name: "M31 Ready",
                tool: "PixInsight",
                lifecycle: "ready",
                path: "projects/M31_Ready",
                notes: None,
                canonical_target_id: None,
                is_mosaic: false,
            },
        )
        .await
        .unwrap();

        finalize_archive_lifecycle(db.pool(), &bus, "plan-arch-bad", &project_id).await;

        // Lifecycle untouched — no illegal edge recorded.
        let project = projects_repo::get_project(db.pool(), &project_id).await.unwrap();
        assert_eq!(
            project.lifecycle, "ready",
            "illegal archive source must leave lifecycle unchanged"
        );
        // No archive link recorded.
        let archived = projects_repo::list_archived_projects(db.pool()).await.unwrap();
        assert!(archived.is_empty(), "no archive link may be recorded for a refused closure");
    }

    #[tokio::test]
    async fn cancel_plan_rejects_non_applying() {
        let (db, _bus) = setup().await;
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: "p2",
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

        let err = cancel_plan(db.pool(), "p2").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotInApply);
    }

    #[tokio::test]
    async fn skip_item_rejects_when_not_applying() {
        let (db, _bus) = setup().await;
        insert_approved_plan_with_items(&db, "p3", 1).await;

        let err = skip_plan_item(db.pool(), "p3", "p3-item-0").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotInApply);
    }

    /// Register a minimal `ActiveRun` directly in the process-global
    /// registry, bypassing `apply_plan`/`resume_plan`'s executor spawn.
    /// `retry_plan_item` requires a live entry before it will mutate any DB
    /// state (review fix — see its doc comment); tests that exercise the
    /// success path without driving a real executor need one of these.
    /// Callers own removing it (or rely on process exit — the registry is a
    /// `static`, so a leaked test entry cannot affect other plan ids).
    fn register_fake_active_run(plan_id: &str) {
        active_runs().insert(
            plan_id.to_owned(),
            ActiveRun {
                cancel_token: CancellationToken::new(),
                skip_set: SkipSet::new(),
                retry_queue: RetryQueue::new(),
                run_id: "fake-run".to_owned(),
                path_set: crate::path_set::PlanPathSet::new(),
            },
        );
    }

    /// T038 gap-fill: `retry_plan_item`'s success path had zero coverage at
    /// any level prior to this test (only the not-applying rejection was
    /// tested). Drives the item failed -> applying transition directly
    /// (bypassing the real executor, but with a fake `ActiveRun` registered
    /// so the review-fix "run must be active" gate passes) and asserts both
    /// the response and the persisted item state.
    #[tokio::test]
    async fn retry_plan_item_transitions_failed_item_to_applying() {
        let (db, _bus) = setup().await;
        insert_approved_plan_with_items(&db, "p-retry", 1).await;
        plans_repo::update_plan_state(db.pool(), "p-retry", "applying").await.unwrap();
        apply_repo::item_failed(db.pool(), "p-retry-item-0", "p-retry", "permission.denied")
            .await
            .unwrap();
        register_fake_active_run("p-retry");

        let resp = retry_plan_item(db.pool(), "p-retry", "p-retry-item-0").await.unwrap();
        assert_eq!(resp.item_id, "p-retry-item-0");
        assert_eq!(resp.new_state, "applying");

        let items = plans_repo::list_plan_items(db.pool(), "p-retry").await.unwrap();
        let item = items.iter().find(|i| i.id == "p-retry-item-0").unwrap();
        assert_eq!(item.item_state, "applying", "retried item must move failed -> applying in DB");
    }

    /// Review fix: a retry attempted after the run has already finished
    /// (no `ActiveRun` registered) must be rejected outright, not silently
    /// flip the item to `applying` with nothing left to ever resolve it.
    #[tokio::test]
    async fn retry_plan_item_rejects_when_no_active_run() {
        let (db, _bus) = setup().await;
        insert_approved_plan_with_items(&db, "p-retry-no-run", 1).await;
        plans_repo::update_plan_state(db.pool(), "p-retry-no-run", "applying").await.unwrap();
        apply_repo::item_failed(
            db.pool(),
            "p-retry-no-run-item-0",
            "p-retry-no-run",
            "permission.denied",
        )
        .await
        .unwrap();
        // Deliberately NOT registering an ActiveRun.

        let err = retry_plan_item(db.pool(), "p-retry-no-run", "p-retry-no-run-item-0")
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::RunNotFound);

        // The DB write must never have happened — item stays failed, not
        // stuck applying with nothing to resolve it.
        let items = plans_repo::list_plan_items(db.pool(), "p-retry-no-run").await.unwrap();
        let item = items.iter().find(|i| i.id == "p-retry-no-run-item-0").unwrap();
        assert_eq!(item.item_state, "failed", "rejected retry must not mutate item state");
    }

    #[tokio::test]
    async fn retry_plan_item_rejects_non_failed_item() {
        let (db, _bus) = setup().await;
        insert_approved_plan_with_items(&db, "p-retry2", 1).await;
        plans_repo::update_plan_state(db.pool(), "p-retry2", "applying").await.unwrap();

        // Item is still `pending` (never failed) — retry must reject it
        // before reaching the active-run check (which runs after).
        let err = retry_plan_item(db.pool(), "p-retry2", "p-retry2-item-0").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ItemNotFailed);
    }

    #[tokio::test]
    async fn confirm_plan_destructive_items_rejects_unknown_plan() {
        let (db, _bus) = setup().await;
        let err = confirm_plan_destructive_items(db.pool(), "missing-plan").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanNotFound);
    }

    #[tokio::test]
    async fn confirm_plan_destructive_items_persists_flag() {
        let (db, _bus) = setup().await;
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: "p-del",
                title: "Test",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "trash",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: "p-del-item-0",
                plan_id: "p-del",
                item_index: 1,
                name: "junk.fits",
                action: "delete",
                from_root_id: None,
                from_relative_path: "p-del/raw/junk.fits",
                to_root_id: None,
                to_relative_path: "",
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

        let before = repo::list_plan_items(db.pool(), "p-del").await.unwrap();
        assert_eq!(before[0].destructive_confirmed, 0);

        let confirmed = confirm_plan_destructive_items(db.pool(), "p-del").await.unwrap();
        assert_eq!(confirmed, 1);

        let after = repo::list_plan_items(db.pool(), "p-del").await.unwrap();
        assert_eq!(after[0].destructive_confirmed, 1);

        // Idempotent second call.
        let confirmed_again = confirm_plan_destructive_items(db.pool(), "p-del").await.unwrap();
        assert_eq!(confirmed_again, 0);
    }

    /// End-to-end regression for issue #741: before this fix, a delete item
    /// was refused *permanently* at apply time (`destructive_confirmed` had
    /// no writer anywhere). Confirming via the new write path must let a
    /// subsequent apply actually delete the file on disk.
    #[tokio::test]
    async fn confirm_then_apply_executes_previously_refused_delete_item() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("junk.fits");
        std::fs::write(&file_path, b"data").unwrap();
        let abs = file_path.to_str().unwrap();

        let (db, bus) = setup().await;
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: "p-e2e",
                title: "Test",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "trash",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: "p-e2e-item-0",
                plan_id: "p-e2e",
                item_index: 1,
                name: "junk.fits",
                action: "delete",
                // No from_root_id: item_row_to_executor_item leaves
                // library_root None, so `from_relative_path` is used as-is —
                // an absolute temp-file path works (mirrors the executor
                // crate's own "legacy" no-root test items).
                from_root_id: None,
                from_relative_path: abs,
                to_root_id: None,
                to_relative_path: "",
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

        confirm_plan_destructive_items(db.pool(), "p-e2e").await.unwrap();

        repo::update_plan_state(db.pool(), "p-e2e", "ready_for_review").await.unwrap();
        repo::set_approved(db.pool(), "p-e2e", "2026-06-01T00:00:00Z", "test-token").await.unwrap();

        apply_plan(db.pool(), &bus, "p-e2e", "test-token", None).await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

        assert!(!file_path.exists(), "confirmed delete item must actually execute");
        let plan = repo::get_plan(db.pool(), "p-e2e", false).await.unwrap();
        assert_eq!(plan.state, "applied");

        // #766: a real, successful plan apply must write a durable
        // audit_log_entry row per succeeded plan_item — not just the
        // separate plan-apply run-events table.
        let audit_count = count_audit_entries(db.pool(), &AuditLogFilter::default()).await.unwrap();
        assert!(audit_count > 0, "apply_plan must write at least one durable audit_log_entry row");
    }

    /// Removes `ALM_E2E_OS_TRASH_FAKE` on drop (including panic unwind) so a
    /// failed assertion in the test body can never leak the var into other
    /// tests in this binary (this crate has no other test that exercises the
    /// `Trash` executor action, so the var is otherwise untouched here).
    struct EnvVarGuard(&'static str);
    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            std::env::remove_var(self.0);
        }
    }

    /// Regression for the "trash destination is dead code" finding: both
    /// `cleanup_generator` and `archive_generator` always store
    /// `action = "archive"` for a destructive-but-reversible item; the
    /// user's plan-level "System trash" choice (`plans.destructive_destination`)
    /// was never consulted at apply time, so it silently archived into
    /// `.astro-plan-archive` regardless of what the user picked in review.
    /// `ALM_E2E_OS_TRASH_FAKE` (headless-safe OS-trash double, added for the
    /// e2e harness) makes the OS-trash outcome deterministic here too.
    #[tokio::test]
    async fn archive_action_item_with_trash_destination_really_trashes() {
        std::env::set_var("ALM_E2E_OS_TRASH_FAKE", "1");
        let _env_guard = EnvVarGuard("ALM_E2E_OS_TRASH_FAKE");

        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("intermediate.fits");
        std::fs::write(&file_path, b"data").unwrap();
        let abs = file_path.to_str().unwrap();

        let (db, bus) = setup().await;
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: "p-trash-e2e",
                title: "Test",
                origin: "cleanup",
                origin_path: None,
                plan_type: "cleanup",
                destructive_destination: "trash",
                parent_plan_id: None,
                total_bytes_required: 0,
            },
        )
        .await
        .unwrap();
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: "p-trash-e2e-item-0",
                plan_id: "p-trash-e2e",
                item_index: 1,
                name: "intermediate.fits",
                action: "archive",
                from_root_id: None,
                from_relative_path: abs,
                to_root_id: None,
                to_relative_path: "",
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

        repo::update_plan_state(db.pool(), "p-trash-e2e", "ready_for_review").await.unwrap();
        repo::set_approved(db.pool(), "p-trash-e2e", "2026-06-01T00:00:00Z", "test-token")
            .await
            .unwrap();

        apply_plan(db.pool(), &bus, "p-trash-e2e", "test-token", None).await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

        assert!(
            !file_path.exists(),
            "an archive-action item under a trash-destination plan must actually be removed via trash"
        );
        assert!(
            !dir.path().join(".astro-plan-archive").exists(),
            "a trash-destination item must not fall through to the app archive folder"
        );
        let plan = repo::get_plan(db.pool(), "p-trash-e2e", false).await.unwrap();
        assert_eq!(plan.state, "applied");
        let items = repo::list_plan_items(db.pool(), "p-trash-e2e").await.unwrap();
        assert_eq!(items[0].item_state, "succeeded");
    }

    /// Sibling of the trash-routing regression above, guarding the inverse:
    /// a plan whose `destructive_destination` stays `"archive"` must still
    /// route its `action = "archive"` item through `ExecutorItemAction::Archive`
    /// (file lands under the archive path, never removed). Without this, a
    /// guard bug matching plain `"archive"` (routing every archive item to
    /// Trash regardless of `destructive_destination`) would pass the trash
    /// test above undetected — no existing `item_row_to_executor_item` test
    /// asserts on `item.action`.
    #[tokio::test]
    async fn archive_action_item_with_archive_destination_stays_archived() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("intermediate.fits");
        std::fs::write(&file_path, b"data").unwrap();
        let abs = file_path.to_str().unwrap();
        let archive_dest_path = dir.path().join(".astro-plan-archive/p-archive-e2e-item-0.fits");
        let archive_dest = archive_dest_path.to_str().unwrap();

        let (db, bus) = setup().await;
        repo::insert_plan(
            db.pool(),
            &repo::InsertPlan {
                id: "p-archive-e2e",
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
        repo::insert_plan_item(
            db.pool(),
            &repo::InsertPlanItem {
                id: "p-archive-e2e-item-0",
                plan_id: "p-archive-e2e",
                item_index: 1,
                name: "intermediate.fits",
                action: "archive",
                from_root_id: None,
                from_relative_path: abs,
                to_root_id: None,
                to_relative_path: "",
                reason: "test",
                protection: "normal",
                linked_entity: None,
                provenance_json: None,
                archive_path: Some(archive_dest),
                source_id: None,
                category: None,
            },
        )
        .await
        .unwrap();

        repo::update_plan_state(db.pool(), "p-archive-e2e", "ready_for_review").await.unwrap();
        repo::set_approved(db.pool(), "p-archive-e2e", "2026-06-01T00:00:00Z", "test-token")
            .await
            .unwrap();

        apply_plan(db.pool(), &bus, "p-archive-e2e", "test-token", None).await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

        assert!(!file_path.exists(), "source must be gone after a successful archive move");
        assert!(
            archive_dest_path.exists(),
            "an archive-destination plan's archive-action item must land at the archive path, not be trashed/deleted"
        );
        let plan = repo::get_plan(db.pool(), "p-archive-e2e", false).await.unwrap();
        assert_eq!(plan.state, "applied");
        let items = repo::list_plan_items(db.pool(), "p-archive-e2e").await.unwrap();
        assert_eq!(items[0].item_state, "succeeded");
    }

    /// #766: one durable `audit_log_entry` row per succeeded plan_item
    /// (query DB, not the live EventBus) — the exact SUCCESS criterion from
    /// the issue repro.
    #[tokio::test]
    async fn n766_apply_writes_one_durable_audit_row_per_succeeded_item() {
        let (db, bus) = setup().await;
        insert_approved_plan_with_items(&db, "p-audit", 2).await;

        apply_plan(db.pool(), &bus, "p-audit", "test-token", None).await.unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;

        let plan = repo::get_plan(db.pool(), "p-audit", false).await.unwrap();
        // Items have no real file on disk (from_root_id: None, relative path
        // used as-is) so they resolve to a terminal `failed` state — still a
        // real "attempted action and outcome" that must be audited (§II).
        assert_eq!(plan.items_total, 2);

        let audit_count = count_audit_entries(db.pool(), &AuditLogFilter::default()).await.unwrap();
        assert!(
            i64::from(audit_count) >= plan.items_total,
            "expected at least one audit_log_entry row per plan item ({} items), got {audit_count}",
            plan.items_total
        );

        let entries = list_audit_entries(
            db.pool(),
            &AuditLogFilter {
                entity_type: Some("filesystem_plan".to_owned()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(
            entries.iter().any(|e| e.trigger.starts_with("plan_item.")),
            "expected a plan_item.* durable audit trigger"
        );
    }

    /// #750: `audit_item_cancelled` (the per-item write both bulk-cancel
    /// paths — happy-path pending list and orphaned-`applying` sweep — funnel
    /// through) must write a durable `audit_log_entry` row, not just a
    /// run-events row, for each cancelled item.
    #[tokio::test]
    async fn n750_audit_item_cancelled_writes_durable_audit_row() {
        let (db, bus) = setup().await;
        insert_approved_plan_with_items(&db, "p-cancel", 1).await;
        repo::update_plan_state(db.pool(), "p-cancel", "applying").await.unwrap();

        audit_item_cancelled(
            db.pool(),
            &bus,
            "run-cancel",
            "p-cancel",
            "p-cancel-item-0",
            "pending",
            "2026-06-01T00:00:00Z",
        )
        .await;

        let audit_count = count_audit_entries(db.pool(), &AuditLogFilter::default()).await.unwrap();
        assert_eq!(audit_count, 1, "one durable audit_log_entry row per cancelled item");

        let entries = list_audit_entries(db.pool(), &AuditLogFilter::default()).await.unwrap();
        assert_eq!(entries[0].trigger, "plan_item.cancelled");
        assert_eq!(entries[0].outcome, "refused");
        assert_eq!(entries[0].to_state.as_deref(), Some("cancelled"));
    }

    #[tokio::test]
    async fn get_apply_status_returns_plan_state() {
        let (db, _bus) = setup().await;
        insert_approved_plan_with_items(&db, "p4", 2).await;

        let status = get_apply_status(db.pool(), "p4").await.unwrap();
        assert_eq!(status.plan_id, "p4");
        assert_eq!(status.plan_state, "approved");
        assert_eq!(status.items_total, 2);
        assert!(status.run_id.is_none());
    }

    #[tokio::test]
    async fn verify_approval_token_rejects_mismatched_token() {
        let result = verify_approval_token(Some("stored-token"), "different-token");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanApprovalStale);
    }

    #[tokio::test]
    async fn verify_approval_token_rejects_missing_token() {
        let result = verify_approval_token(None, "any-token");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn verify_approval_token_accepts_matching_token() {
        let result = verify_approval_token(Some("tok-abc"), "tok-abc");
        assert!(result.is_ok());
    }

    // ── T023a tests ───────────────────────────────────────────────────────────

    /// T023a: item_row_to_executor_item sets library_root from the root_map
    /// so the path-gate fires on real plan items.
    #[test]
    fn t023a_library_root_resolved_from_map() {
        let row = plans_repo::PlanItemRow {
            id: "item-1".to_owned(),
            plan_id: "plan-1".to_owned(),
            item_index: 1,
            name: "file.fits".to_owned(),
            action: "move".to_owned(),
            from_root_id: Some("root-001".to_owned()),
            from_relative_path: "raw/file.fits".to_owned(),
            to_root_id: Some("root-001".to_owned()),
            to_relative_path: "archive/file.fits".to_owned(),
            reason: "test".to_owned(),
            protection: "normal".to_owned(),
            linked_entity: None,
            item_state: "pending".to_owned(),
            failure_reason: None,
            provenance: None,
            approved_mtime: None,
            approved_size_bytes: None,
            archive_path: None,
            created_at: "2026-06-17T00:00:00Z".to_owned(),
            source_id: None,
            category: None,
            requires_destructive_confirm: Some(0),
            resolved_pattern: None,
            destructive_confirmed: 0,
        };

        let mut root_map = HashMap::new();
        root_map.insert("root-001".to_owned(), Utf8PathBuf::from("/mnt/library"));

        let item = item_row_to_executor_item(&row, &root_map, "archive");
        assert_eq!(
            item.library_root,
            Some(Utf8PathBuf::from("/mnt/library")),
            "library_root must be populated from the root_map so the path gate fires"
        );
    }

    /// T023a: item without from_root_id gets library_root = None (legacy/unknown mode).
    #[test]
    fn t023a_no_root_id_gives_none_library_root() {
        let row = plans_repo::PlanItemRow {
            id: "item-2".to_owned(),
            plan_id: "plan-1".to_owned(),
            item_index: 1,
            name: "file.fits".to_owned(),
            action: "move".to_owned(),
            from_root_id: None,
            from_relative_path: "raw/file.fits".to_owned(),
            to_root_id: None,
            to_relative_path: "archive/file.fits".to_owned(),
            reason: "test".to_owned(),
            protection: "normal".to_owned(),
            linked_entity: None,
            item_state: "pending".to_owned(),
            failure_reason: None,
            provenance: None,
            approved_mtime: None,
            approved_size_bytes: None,
            archive_path: None,
            created_at: "2026-06-17T00:00:00Z".to_owned(),
            source_id: None,
            category: None,
            requires_destructive_confirm: Some(0),
            resolved_pattern: None,
            destructive_confirmed: 0,
        };

        let root_map: HashMap<String, Utf8PathBuf> = HashMap::new();
        let item = item_row_to_executor_item(&row, &root_map, "archive");
        assert_eq!(item.library_root, None);
    }

    /// #765: a cross-root item (`to_root_id != from_root_id`) must resolve
    /// `destination_root` from `to_root_id`, independent of `library_root`
    /// (which stays resolved from `from_root_id`) — otherwise the executor
    /// joins the destination path against the wrong (source) root.
    #[test]
    fn n765_destination_root_resolves_independently_from_to_root_id() {
        let row = plans_repo::PlanItemRow {
            id: "item-cross-root".to_owned(),
            plan_id: "plan-1".to_owned(),
            item_index: 1,
            name: "file.fits".to_owned(),
            action: "move".to_owned(),
            from_root_id: Some("inbox-root".to_owned()),
            from_relative_path: "M51/LUM/file.fits".to_owned(),
            to_root_id: Some("lights-root".to_owned()),
            to_relative_path: "M51/LUM/file.fits".to_owned(),
            reason: "test".to_owned(),
            protection: "normal".to_owned(),
            linked_entity: None,
            item_state: "pending".to_owned(),
            failure_reason: None,
            provenance: None,
            approved_mtime: None,
            approved_size_bytes: None,
            archive_path: None,
            created_at: "2026-06-17T00:00:00Z".to_owned(),
            source_id: None,
            category: None,
            requires_destructive_confirm: Some(0),
            resolved_pattern: None,
            destructive_confirmed: 0,
        };

        let mut root_map = HashMap::new();
        root_map.insert("inbox-root".to_owned(), Utf8PathBuf::from("/mnt/inbox"));
        root_map.insert("lights-root".to_owned(), Utf8PathBuf::from("/mnt/lights/1"));

        let item = item_row_to_executor_item(&row, &root_map, "archive");
        assert_eq!(
            item.library_root,
            Some(Utf8PathBuf::from("/mnt/inbox")),
            "library_root (source) must resolve from from_root_id"
        );
        assert_eq!(
            item.destination_root,
            Some(Utf8PathBuf::from("/mnt/lights/1")),
            "destination_root must resolve from to_root_id, not from_root_id"
        );
    }

    /// #765: when `to_root_id` is absent or unresolvable, `destination_root`
    /// falls back to `library_root` (same-root actions: archive/trash/
    /// catalogue, or legacy rows without a recorded destination root).
    #[test]
    fn n765_destination_root_falls_back_to_library_root_when_to_root_id_absent() {
        let row = plans_repo::PlanItemRow {
            id: "item-same-root".to_owned(),
            plan_id: "plan-1".to_owned(),
            item_index: 1,
            name: "file.fits".to_owned(),
            action: "archive".to_owned(),
            from_root_id: Some("root-001".to_owned()),
            from_relative_path: "raw/file.fits".to_owned(),
            to_root_id: None,
            to_relative_path: "archive/file.fits".to_owned(),
            reason: "test".to_owned(),
            protection: "normal".to_owned(),
            linked_entity: None,
            item_state: "pending".to_owned(),
            failure_reason: None,
            provenance: None,
            approved_mtime: None,
            approved_size_bytes: None,
            archive_path: None,
            created_at: "2026-06-17T00:00:00Z".to_owned(),
            source_id: None,
            category: None,
            requires_destructive_confirm: Some(0),
            resolved_pattern: None,
            destructive_confirmed: 0,
        };

        let mut root_map = HashMap::new();
        root_map.insert("root-001".to_owned(), Utf8PathBuf::from("/mnt/library"));

        let item = item_row_to_executor_item(&row, &root_map, "archive");
        assert_eq!(item.destination_root, item.library_root);
        assert_eq!(item.destination_root, Some(Utf8PathBuf::from("/mnt/library")));
    }

    /// T023a: root-escaping relative path is refused by the gate when library_root is set.
    /// This proves the gate is active on real plan items (not inert).
    #[test]
    fn t023a_root_escape_gate_fires_when_library_root_is_set() {
        use fs_executor::ops::path_gate;

        let root = Utf8PathBuf::from("/mnt/library");
        // A path that escapes the root via ".." — must be refused.
        let escaping_relative = Utf8PathBuf::from("../../etc/passwd");

        let result = path_gate::resolve_and_validate(&root, &escaping_relative);
        assert!(result.is_err(), "root-escaping path must be refused when library_root is set");
        let failure = result.unwrap_err();
        assert_eq!(failure.code.as_str(), "root_escape", "failure code must be root_escape");
    }

    /// T023a: destructive_confirmed is now a real DB column (migration 0033),
    /// read directly (not defaulted via #[sqlx(default)]).
    #[test]
    fn t023a_destructive_confirmed_reads_from_db_column() {
        let row = plans_repo::PlanItemRow {
            id: "item-3".to_owned(),
            plan_id: "plan-1".to_owned(),
            item_index: 1,
            name: "file.fits".to_owned(),
            action: "delete".to_owned(),
            from_root_id: None,
            from_relative_path: "raw/file.fits".to_owned(),
            to_root_id: None,
            to_relative_path: String::new(),
            reason: "test".to_owned(),
            protection: "normal".to_owned(),
            linked_entity: None,
            item_state: "pending".to_owned(),
            failure_reason: None,
            provenance: None,
            approved_mtime: None,
            approved_size_bytes: None,
            archive_path: None,
            created_at: "2026-06-17T00:00:00Z".to_owned(),
            source_id: None,
            category: None,
            requires_destructive_confirm: Some(1),
            resolved_pattern: None,
            destructive_confirmed: 1, // user confirmed
        };

        let root_map: HashMap<String, Utf8PathBuf> = HashMap::new();
        let item = item_row_to_executor_item(&row, &root_map, "archive");
        assert!(item.destructive_confirmed, "destructive_confirmed=1 in DB must be read as true");
        assert!(
            item.requires_destructive_confirm,
            "delete action must require destructive confirm"
        );
    }

    // ── FR-017: panic-safe registry removal (US12) ──────────────────────────────

    /// Build an [`ActiveRun`] with no control wiring of consequence — the guard
    /// test only cares about presence/absence of the entry by key.
    fn dummy_active_run() -> ActiveRun {
        ActiveRun {
            cancel_token: CancellationToken::new(),
            skip_set: SkipSet::new(),
            retry_queue: RetryQueue::new(),
            run_id: "run-guard-test".to_owned(),
            path_set: PlanPathSet::new(),
        }
    }

    /// FR-017: on a *normal* scope exit the guard's `Drop` removes the entry
    /// exactly once. This is the Completed / Cancelled / Paused path.
    #[test]
    fn active_run_guard_removes_entry_on_normal_drop() {
        let registry: Arc<DashMap<String, ActiveRun>> = Arc::new(DashMap::new());
        let plan_id = "plan-guard-normal";
        registry.insert(plan_id.to_owned(), dummy_active_run());
        assert!(registry.contains_key(plan_id), "entry present after insert");

        {
            let _guard = ActiveRunGuard { registry: registry.clone(), plan_id: plan_id.to_owned() };
            // entry still present while the guard is held
            assert!(registry.contains_key(plan_id), "entry present while guard held");
        } // guard drops here

        assert!(
            !registry.contains_key(plan_id),
            "guard Drop must remove the entry on normal scope exit"
        );
    }

    /// FR-017 acceptance scenario 2: a plan run that panics mid-apply must still
    /// have its registry entry removed. The guard is owned by the same scope
    /// that runs `execute_plan`; a panic there unwinds that scope, running the
    /// guard's `Drop`. We model that scope with `catch_unwind` around a panic
    /// that occurs *after* the guard is constructed and the entry inserted —
    /// exactly the shape of `tokio::spawn(async move { let _g = guard; execute_plan().await })`
    /// when `execute_plan` panics.
    #[test]
    fn active_run_guard_removes_entry_when_scope_panics() {
        let registry: Arc<DashMap<String, ActiveRun>> = Arc::new(DashMap::new());
        let plan_id = "plan-guard-panic";
        registry.insert(plan_id.to_owned(), dummy_active_run());
        assert!(registry.contains_key(plan_id), "entry present after insert");

        let registry_for_scope = registry.clone();
        let plan_id_owned = plan_id.to_owned();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            // Guard is owned by this scope, mirroring the spawned task.
            let _guard = ActiveRunGuard { registry: registry_for_scope, plan_id: plan_id_owned };
            // Stand-in for `execute_plan(...).await` panicking mid-apply.
            panic!("execute_plan panicked mid-apply");
        }));

        assert!(result.is_err(), "the scope must have panicked");
        assert!(
            !registry.contains_key(plan_id),
            "FR-017: guard Drop must remove the registry entry even when the scope unwinds from a panic"
        );
    }

    // ── FR-017: cross-plan path-set overlap guard (R-Concur-1) ──────────────────

    /// Build a fake active run claiming the given path prefixes.
    fn fake_active_run(run_id: &str, prefixes: &[&str]) -> ActiveRun {
        ActiveRun {
            cancel_token: CancellationToken::new(),
            skip_set: SkipSet::new(),
            retry_queue: RetryQueue::new(),
            run_id: run_id.to_owned(),
            path_set: prefixes.iter().map(Utf8PathBuf::from).collect(),
        }
    }

    /// FR-017: a pending apply whose (source ∪ destination) path set overlaps
    /// an active run's path set is rejected with `plan.conflict.overlap`,
    /// the state CAS never runs (plan stays `approved`), and no registry
    /// entry is leaked for the rejected plan.
    #[tokio::test]
    async fn apply_plan_rejects_overlapping_active_plan() {
        let (db, bus) = setup().await;
        // Items claim "p-ovl-b/raw/file-0.fits" + "p-ovl-b/archive/file-0.fits"
        // (unrooted).
        insert_approved_plan_with_items(&db, "p-ovl-b", 1).await;

        // Another plan's active run claims the "p-ovl-b/raw" subtree — an
        // ancestor of this plan's source path at subtree-prefix granularity.
        let registry = active_runs();
        registry.insert("p-ovl-a".to_owned(), fake_active_run("run-ovl-a", &["p-ovl-b/raw"]));

        let result = apply_plan(db.pool(), &bus, "p-ovl-b", "test-token", None).await;
        registry.remove("p-ovl-a");

        let err = result.unwrap_err();
        assert_eq!(err.code, ErrorCode::PlanConflictOverlap);
        assert!(!registry.contains_key("p-ovl-b"), "rejected plan must not leak a registry entry");

        // The CAS never ran: the plan is untouched and can be applied later.
        let plan = repo::get_plan(db.pool(), "p-ovl-b", false).await.unwrap();
        assert_eq!(plan.state, "approved");
    }

    /// FR-017: disjoint path sets may apply concurrently — the guard only
    /// rejects overlap, not concurrency itself.
    #[tokio::test]
    async fn apply_plan_allows_disjoint_active_plan() {
        let (db, bus) = setup().await;
        insert_approved_plan_with_items(&db, "p-dis-b", 1).await;

        let registry = active_runs();
        registry.insert("p-dis-a".to_owned(), fake_active_run("run-dis-a", &["/somewhere/else"]));

        let result = apply_plan(db.pool(), &bus, "p-dis-b", "test-token", None).await;
        registry.remove("p-dis-a");

        let resp = result.unwrap();
        assert_eq!(resp.new_state, "applying");

        // Let the background executor finish so the run's own registry entry
        // is dropped before other tests run.
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

    /// FR-017: the claimed path set resolves item paths against the root map
    /// the same way the executor does, and claims absolute archive paths
    /// verbatim.
    #[test]
    fn compute_plan_path_set_resolves_roots_and_archive() {
        let row = plans_repo::PlanItemRow {
            id: "item-ps".to_owned(),
            plan_id: "plan-ps".to_owned(),
            item_index: 1,
            name: "file.fits".to_owned(),
            action: "archive".to_owned(),
            from_root_id: Some("root-001".to_owned()),
            from_relative_path: "raw/./file.fits".to_owned(),
            to_root_id: None,
            to_relative_path: "sorted/file.fits".to_owned(),
            reason: "test".to_owned(),
            protection: "normal".to_owned(),
            linked_entity: None,
            item_state: "pending".to_owned(),
            failure_reason: None,
            provenance: None,
            approved_mtime: None,
            approved_size_bytes: None,
            archive_path: Some("/vault/archive/file.fits".to_owned()),
            created_at: "2026-06-17T00:00:00Z".to_owned(),
            source_id: None,
            category: None,
            requires_destructive_confirm: Some(0),
            resolved_pattern: None,
            destructive_confirmed: 0,
        };

        let mut root_map = HashMap::new();
        root_map.insert("root-001".to_owned(), Utf8PathBuf::from("/mnt/library"));

        let set = compute_plan_path_set(std::slice::from_ref(&row), &root_map);
        assert_eq!(set.len(), 3);

        // Source: rooted + lexically normalized. Destination: falls back to
        // the source root (over-claiming, the safe direction). Archive:
        // absolute, claimed verbatim.
        let source: PlanPathSet =
            [Utf8PathBuf::from("/mnt/library/raw/file.fits")].into_iter().collect();
        let dest: PlanPathSet =
            [Utf8PathBuf::from("/mnt/library/sorted/file.fits")].into_iter().collect();
        let archive: PlanPathSet = [Utf8PathBuf::from("/vault/archive")].into_iter().collect();
        assert!(set.overlaps(&source), "source path must be claimed under its root");
        assert!(set.overlaps(&dest), "destination must fall back to the source root");
        assert!(set.overlaps(&archive), "absolute archive path must be claimed verbatim");

        let disjoint: PlanPathSet = [Utf8PathBuf::from("/elsewhere")].into_iter().collect();
        assert!(!set.overlaps(&disjoint));
    }
}
