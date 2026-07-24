use super::{
    apply_repo, audit_item_cancelled, bus_err, check_overlap_and_register, compute_plan_path_set,
    db_err, deterministic_entity_id, execute_plan, finalize_archive_lifecycle,
    finalize_calibration_master_archive, finalize_calibration_master_restore,
    finalize_project_create_manifest, finalize_restore_lifecycle, finalize_view_generation,
    finalize_view_regeneration, finalize_view_removal, item_row_to_executor_item, json, new_id,
    plans_repo, resolve_root_path, verify_approval_token, ActiveRun, ActiveRunGuard, ApplyOutcome,
    AuditLogEntry, CancellationToken, ContractError, EntityType, ErrorCode, ErrorSeverity,
    EventBus, ExecutorItem, HashMap, OpEventEmitter, OperationEventSink, OperationEventType,
    OperationId, OperationStatus, Outcome, PlanApplyCallbacks, PlanApplyResponse,
    PlanApplyingCompleted, PlanApplyingPaused, PlanApplyingStarted, RetryQueue, Severity, SkipSet,
    Source, SqlitePool, TerminalCounts, Timestamp, Utf8PathBuf, TOPIC_PLAN_APPLYING_COMPLETED,
    TOPIC_PLAN_APPLYING_PAUSED, TOPIC_PLAN_APPLYING_STARTED,
};

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
pub(super) struct SpawnExecutorParams {
    pub(super) pool: SqlitePool,
    pub(super) bus: EventBus,
    pub(super) plan_id: String,
    pub(super) run_id: String,
    pub(super) executor_items: Vec<ExecutorItem>,
    pub(super) plan_origin: String,
    pub(super) plan_project_id: Option<String>,
    pub(super) cancel_token: CancellationToken,
    pub(super) skip_set: SkipSet,
    pub(super) retry_queue: RetryQueue,
    pub(super) run_guard: ActiveRunGuard,
    pub(super) op_emitter: Option<OpEventEmitter>,
}

/// Fetch the plan's up-to-date cumulative item counters.
///
/// Each flush (`batch_flush_item_states`) and `batch_cancel_pending_items`
/// increments `plans.items_applied` etc. in real time via `PlanApplyCallbacks`,
/// so the plan row already reflects the
/// *whole* run's history — including a pre-pause phase from before a resume
/// (issue #575). The `TerminalCounts` returned by a single `execute_plan`
/// invocation only covers the items just processed in that segment, which
/// would silently regress the plan's counters if fed directly to
/// `complete_run`/`pause_run` after a resume continues a previously-paused
/// run. Falls back to `segment_counts` if the fetch fails (best-effort,
/// matching this function's existing `let _ = ...` error-swallowing
/// elsewhere).
pub(super) async fn cumulative_counts(
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
pub(super) fn spawn_executor_run(params: SpawnExecutorParams) {
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

        let callbacks = PlanApplyCallbacks::new(
            pool.clone(),
            bus.clone(),
            plan_id.clone(),
            run_id.clone(),
            op_emitter.clone(),
        );

        let outcome =
            execute_plan(executor_items, &callbacks, &cancel_token, &skip_set, &retry_queue).await;

        // Mandatory flush: drain any items buffered in the last partial window
        // before the outcome branches below read cumulative plan counters.
        callbacks.flush().await;

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

                // #885: on a fully-applied restore (un-archive) plan, drive the
                // owning project back out of `archived`. Only a clean `applied`
                // terminal qualifies — a partial/failed apply leaves files only
                // partly moved back, so the project must stay `archived` until a
                // retry plan finishes the job (mirrors the archive closure guard).
                if terminal == "applied" && plan_origin == "restore" {
                    if let Some(project_id) = plan_project_id.as_deref() {
                        finalize_restore_lifecycle(&pool, &bus, project_id).await;
                    }
                }

                // #886: on a fully-applied calibration-master archive/restore
                // plan, close the master's archived flag the same way the
                // project archive/restore closures do above — only a clean
                // `applied` terminal qualifies (a partial apply leaves the
                // file only partly moved).
                if terminal == "applied" && plan_origin == "calibration_master_archive" {
                    if let Some(master_id) = plan_project_id.as_deref() {
                        finalize_calibration_master_archive(&pool, &plan_id, master_id).await;
                    }
                }
                if terminal == "applied" && plan_origin == "calibration_master_restore" {
                    if let Some(master_id) = plan_project_id.as_deref() {
                        finalize_calibration_master_restore(&pool, master_id).await;
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
/// of caller have no token in hand and no reason to build a `Channel`:
///
/// - The spec 037 Layer-2 WebDriver test harness, which drives the real
///   backend via `window.__PV_E2E__.invoke(...)`. It *could* build a
///   `Channel` — one is just `__CHANNEL__:${id}` from
///   `__TAURI_INTERNALS__.transformCallback`, and the harness already runs
///   arbitrary JS in the real webview — but doing so would mean reaching into
///   Tauri-internal plumbing from a test, so the harness deliberately does
///   not. This variant is the supported route instead.
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
