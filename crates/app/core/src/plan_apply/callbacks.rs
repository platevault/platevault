use super::{
    apply_repo, deterministic_entity_id, json, new_id, AuditLogEntry, EntityType, EventBus,
    ExecutorCallbacks, ItemProgressEvent, OpEventEmitter, OperationEventType, Outcome,
    PlanItemProgress, Severity, Source, SqlitePool, TOPIC_PLAN_ITEM_PROGRESS,
};

// ── Executor callbacks implementation ────────────────────────────────────────

pub(super) struct PlanApplyCallbacks {
    pub(super) pool: SqlitePool,
    pub(super) bus: EventBus,
    pub(super) plan_id: String,
    pub(super) run_id: String,
    /// Optional live long-op projection (spec 042 US16). `None` when the caller
    /// (e.g. a unit test) does not subscribe; the DB audit trail is unaffected.
    pub(super) op_emitter: Option<OpEventEmitter>,
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
pub(super) async fn audit_item_cancelled(
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
