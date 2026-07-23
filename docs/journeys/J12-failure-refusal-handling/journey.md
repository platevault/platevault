---
id: J12
title: See why an action failed or was refused, and what to do next
version: 2
status: draft
last_reviewed: 2026-07-20
actors: [astrophotographer]
surfaces: [plans, projects, audit]
interfaces: [desktop-ui]
trace:
  - pre-migration journey.md @ git 66026463
  - specs/030-ui-audit-revision/spec.md (FR-130-134 §8.3, FR-135-140 §12)
  - deltas/2026-07-14-q15-t127.md (folded into S5 / Known gaps G1)
  - deltas/2026-07-14-q16-t130.md (folded into S3)
  - docs/development/journey-run-2026-07-14.md (Journey 12 section — live
    Windows validation; source for step-level Trace notes below)
  - issue #1236 (re-verify S3/S4 against current main, closed by this pass)
  - PR #1041 (approve_plan FS snapshot, closes #829), PR #1054 (per-item
    failure reason threaded to PlanReviewOverlay, closes #607), PR #855
    (mid-run item retry re-execution, closes #742) — re-verification
    evidence for the 2026-07-20 Trace updates to S3/S4 below
---

## Goal
When an action the user takes fails or is refused — a lifecycle transition
that cannot succeed from the current state, a generated plan with nothing in
it, a filesystem plan that only partially applies, a plan that went stale
before apply — the user sees *what* happened, *why*, and *what to do next*
without leaving the surface they were on, and can later find the same
refusal/failure, with the same reason, in the Audit Log. Done means every
one of these classes produces a specific, actionable, already-translated
explanation in place — never a generic "failed" toast, a silently disabled
control, or a raw error code.

## Preconditions
- P1: A project exists in a lifecycle state that offers a transition control
  gated on an unmet precondition (e.g. Archive from `completed`, which
  requires an approved filesystem plan) — not a transition forbidden
  outright, since forbidden edges are never rendered as controls at all
  (`lifecycleFooterActions`, `apps/desktop/src/features/projects/
  lifecycle-actions.ts`).
- P2: A source/plan-generating action (e.g. a cleanup or archive scan) can be
  run against a library state that matches zero candidates.
- P3: A confirmed filesystem plan is pending apply, and at least one item it
  references can be made to fail during apply (e.g. its source file is
  removed or made inaccessible after confirm but before apply).
- P4: A confirmed, not-yet-applied plan exists whose referenced source data
  can be changed on disk after confirmation, to force staleness.
- P5: Audit Log access is available for the project/plan touched above.

## Steps

### S1 — A refused lifecycle transition surfaces its reason via toast or the plan-review dialog {#S1}
- **Do:** Open a project whose current lifecycle state offers a transition
  control gated on an unmet precondition (e.g. Archive from `completed`),
  and click it.
- **Expect:** The refusal surfaces at the point of the click, in the user's
  language: a `plan.required`/`plan.not_approved` edge shows an info toast
  naming that a plan is required and — for the completed/blocked→archived
  edge — auto-generates and opens the plan-review dialog for that
  transition; any other refusal shows an error toast carrying the backend's
  reason text. A transition that is structurally forbidden from the current
  lifecycle state (e.g. `processing` → `ready`) is never offered as a
  control at all, so there is no disabled-with-no-reason case to hit.
- **Expect (negative):** The control is never clickable-and-silent — every
  click produces a toast, a dialog, or a visible state change; the generic
  fallback toast ("Transition refused.") with no specific reason is never
  the only feedback shown.
- **Trace:** Live validation (2026-07-14, real Windows app) found the
  Archive-transition refusal reason was recorded correctly in the audit row
  but not perceivable at the control — issue #600 (open, P0, filed
  2026-07-11 design review, reproduced live 2026-07-14). Mechanism verified
  in code: `apps/desktop/src/features/projects/ProjectDetail.tsx:259-328`
  (`handleTransition`/`handleGenerateArchivePlan`),
  `apps/desktop/src/features/projects/lifecycle-actions.ts` (forbidden
  edges excluded from `footerActions`; doc comment: "Forbidden edges ...
  are not included"). See report for candidate Known gap.

### S2 — An empty generated plan states why it is empty {#S2}
- **Do:** Run a plan-generating action (cleanup/archive scan, or similar)
  against library state that matches nothing.
- **Expect:** The resulting plan view states the reason no items were
  produced (e.g. that current rules matched no candidates), instead of only
  disabling the Approve control.
- **Expect (negative):** Approve is never simply greyed out with no
  accompanying explanation of why there is nothing to approve.
- **Trace:** Confirmed unmet in the running app (2026-07-14 live run): an
  empty Archive plan renders "0 items · Approve & apply disabled" with zero
  explanatory text — exact reproduction of issue #603 (open, P1, filed
  2026-07-11 design review). Root cause per #603: sources resolve to zero
  files, but the UI never states this. See report for candidate Known gap.

### S3 — A partial apply failure names failures and offers retry {#S3}
- **Do:** Apply a confirmed plan where at least one item fails during apply
  (e.g. its source file went missing or became inaccessible after confirm).
- **Expect:** Failed items are listed by name with a per-item reason;
  previously succeeded items in the same run keep their applied state
  visible; a retry action is offered. A missing/unresolved metadata value
  shown anywhere in this view uses the shared muted "unresolved" chip
  (`UnresolvedChip`, `apps/desktop/src/components/RenderValue.tsx`,
  i18n `cmp_unresolved_chip`) and is never confusable with an item-failure
  indicator — the chip marks absent data, not a failed action (FR-137).
- **Do:** Trigger retry on the terminal (failed) plan.
- **Expect:** A new plan is generated scoped to only the previously-failed
  items (`plansRetry(planId, 'failed')`, the plan-review overlay's Retry
  action); items that already succeeded are not included in it.
- **Expect (negative):** A partial failure never hides or rolls back the
  items that already succeeded, and never presents a single undifferentiated
  "plan failed" message in place of per-item detail.
- **Trace:** RE-VERIFIED 2026-07-20 against current `main`: this step now
  matches the running app; the 2026-07-14 finding was accurate at the time
  but has since been fixed. `approve_plan` (`crates/app/core/src/plans.rs:
  366-396`) now snapshots per-item FS metadata (`approved_mtime`/
  `approved_size_bytes`) at approval, and `check_cas`
  (`crates/fs/executor/src/ops/cas_check.rs:43-98`) compares it at apply
  time, returning `ItemStale`/`SourceMissing` instead of skipping
  permissively — landed in PR #1041 (closes #829). The per-item id/reason
  payload is no longer discarded: `PlanReviewOverlay.tsx` (~line 414-436)
  renders a Result column with a state `Pill` plus `item.failureReason`
  text sourced from the durable `plan_items.failure_reason` column —
  landed in PR #1054 (closes #607). Integration coverage now exists for
  the exact 2026-07-14 reproduction: `crates/app/core/tests/
  plan_apply_lifecycle_integration.rs` asserts 2 succeeded + 1 failed item
  reaches plan state `partially_applied` with `items_applied=2`/
  `items_failed=1` (not the old silent `itemsFailed=0`). Retry mechanism
  re-verified: `handleGenerateRetryPlan`
  (`apps/desktop/src/features/plans/PlanReviewOverlay.tsx`, `retryable`
  gate ~line 205) is reachable once `effectiveState` is `failed`/
  `partially_applied`/`cancelled`, and calls `plansRetry(planId, 'failed')`
  which still creates a new plan scoped to the failed subset — covered by
  `PlanReviewOverlay.test.tsx` ("offers \"Generate retry plan\" after a
  partially_applied outcome and drives plans.retry", ~line 379). The
  separate in-run `retry_plan_item` path (`crates/app/core/src/
  plan_apply/lifecycle.rs:476`, module split from the old
  `plan_apply.rs:1978`) is also now fixed — issue #742 (mid-run retry never
  re-executed) landed in PR #855, covered by
  `crates/fs/executor/src/run.rs::mid_run_retry_reexecutes_already_passed_item`
  — but this remains a distinct mechanism from `plansRetry`, per the
  doc's original framing. Unresolved-chip claim re-verified via
  `apps/desktop/src/components/RenderValue.tsx:76-87`; the "never
  confusable with a failure indicator" half is now also verified — the
  Result column's failed-state `Pill` (PR #1054) is visually and
  semantically distinct from `UnresolvedChip`. A real-UI journey covering
  partial-apply recovery is now proposable: this step (and the
  `PlanReviewOverlay` surface generally) still has zero real-backend/
  real-UI coverage per this doc's own gap language, but the underlying
  mechanism is no longer a known-broken target to validate against.

### S4 — A stale plan refuses to apply and offers regeneration {#S4}
- **Do:** Attempt to apply a plan whose referenced source data changed on
  disk after it was confirmed.
- **Expect:** Apply is refused; the plan is visibly marked stale and the
  changed file(s)/items are identifiable; a regenerate action is offered in
  place of apply.
- **Expect (negative):** Apply never proceeds silently against stale plan
  data, and the stale state is never indistinguishable from a normal
  pending-apply plan.
- **Trace:** RE-VERIFIED 2026-07-20 against current `main`: the shared root
  cause (#829) is fixed — see S3 — so the original "applies silently,
  `itemsFailed=0`" reproduction no longer occurs. But this step's specific
  expectations (a visibly *stale*-marked plan, apply refused up front, a
  distinct regenerate action) still do not match the running app, so the
  "unmet" framing stands, for a different and more precise reason than the
  2026-07-14 note gave. What actually happens now: a CAS mismatch detected
  mid-apply pauses the run (R-Pause-1) rather than either applying silently
  or cleanly refusing up front — `crates/app/core/tests/
  plan_apply_lifecycle_integration.rs::apply_pauses_on_stale_item_cas_mismatch`
  asserts plan state `paused` with `pause_reason="item.stale"`, source file
  left untouched. The UI surfaces this as a generic paused badge with the
  **raw, untranslated** reason string — `PlanReviewOverlay.tsx:649-650`
  renders `m.plans_review_paused_badge({ reason: progress.pauseReason })`,
  confirmed by `PlanReviewOverlay.test.tsx` asserting the literal text
  "Paused — item.stale" — and offers only a "Resume" button (re-attempts
  the same operation), never a distinct "stale"/"regenerate" affordance.
  Separately, there is dead code aimed at exactly this step's UX: `inbox_
  plan.rs:130-135` computes `InboxPlanView.stale` as `plan_row.state ==
  "stale"`, which the frontend (`apps/desktop/src/features/inbox/
  PlanPanel.tsx:1002-1009`) uses to disable Apply and show a
  "discard and re-confirm" banner (`inbox_stale_plan_warning`) — but no
  code path in the repo ever writes the literal string `"stale"` to
  `plans.state`: `PlanState` (`crates/contracts/core/src/lifecycle.rs:
  60-72`) has no `Stale` variant, `TerminalCounts::terminal_state`
  (`crates/fs/executor/src/run.rs:59-69`) never returns it, and every raw
  `UPDATE plans SET state = ...` call site was audited (`crates/
  persistence/db/src/repositories/plan_apply.rs`, `plans.rs`,
  `projects.rs`) with none writing `'stale'`. So `InboxPlanView.stale` is
  always `false` in practice — the one code path that would satisfy this
  step's exact expectation ("visibly marked stale ... regenerate action
  offered in place of apply") is unreachable. Net: staleness detection
  itself is real and no longer silent (genuine improvement over
  2026-07-14), but it surfaces as an untranslated pause reason with a
  retry-style Resume button, not the distinct stale-marking +
  regenerate flow this step describes — still unwired for every plan
  type, now for a dead-code reason rather than a missing-snapshot reason.

### S5 — Every refusal and failure is later findable in the Audit Log {#S5}
- **Do:** After triggering a refusal/failure from S1-S4, open the Audit Log
  for the affected project/plan.
- **Expect:** Lifecycle-transition refusals (S1) appear as durable audit
  entries with an outcome and the same reason text the user saw at the
  moment of refusal.
- **Expect (negative):** The reason text shown in the Audit Log never
  diverges from the reason text the user saw at the moment of refusal.
- **Trace:** Confirmed for S1 in the running app (2026-07-14 live run): the
  Archive-transition refusal was recorded durably with a matching reason
  (`plan.required`) — but only visible via a `title=` hover on the entity
  cell, no dedicated detail/state-change column exists (issue #749, open).
  S3/S4 plan-apply outcomes are not durably audited at all — see Known
  gaps G1.

## Success criteria
- SC1: Every offered lifecycle-transition control that is refused (S1)
  surfaces a reason at the moment it is clicked (toast, or the plan-review
  dialog for plan-gated edges); zero clicks across a full pass of a
  project's lifecycle controls produce no feedback at all.
- SC2: Every plan-generating action that yields zero items (S2) shows an
  explanatory message; no run ends with just a disabled Approve and no text.
- SC3: In a partial-apply run (S3), failed item count + succeeded item count
  always equals the run's total item count, and a generated retry plan (S3)
  contains only the failed subset (verified by item id set).
- SC4: A stale plan (S4) never transitions to an applied state without an
  intervening regenerate; 0 stale-plan applies succeed silently.
- SC5: For every S1 refusal triggered, a matching durable audit row with the
  same reason text is retrievable afterward (S5).

## Known gaps
- G1: (dissolved 2026-07-15) — tracked as issues #647 and #766; plan-apply outcomes lack durable audit rows.

## Delta log

- **Δ2** 2026-07-20 · S3 · behavior-change
  Partial-apply failure handling shipped: `approve_plan` now snapshots
  per-item FS metadata and the CAS check consults it at apply time instead
  of skipping permissively, so a missing/changed source is caught rather
  than silently counted as success; the per-item failure reason now reaches
  the plan-review table (Result column) instead of being discarded to an
  aggregate count. Mid-run per-item retry re-execution also shipped.
  Evidence: PR #1041 (closes #829), PR #1054 (closes #607), PR #855
  (closes #742); re-verified against
  `crates/app/core/tests/plan_apply_lifecycle_integration.rs` and
  `apps/desktop/src/features/plans/PlanReviewOverlay.test.tsx` · by:
  re-verification pass for issue #1236 (intent-gated)

- **Δ3** 2026-07-20 · S4 · behavior-change
  The shared root cause (#829) is fixed, so a stale plan no longer applies
  with `itemsFailed=0` — a CAS mismatch now pauses the run instead. The
  step's specific expectation (a plan visibly marked stale, with a
  regenerate action offered in place of apply) still does not hold: the
  pause surfaces as an untranslated `pause_reason` string with a
  retry-style Resume action, and the one code path that would compute a
  dedicated `stale` flag (`inbox_plan.rs`'s `plan_row.state == "stale"`)
  is unreachable dead code — no plan-state write in the codebase ever sets
  the literal value `"stale"`. The "unmet" verdict stands; the mechanism
  and evidence behind it changed.
  Evidence: PR #1041 (closes #829); `crates/contracts/core/src/
  lifecycle.rs:60-72` (`PlanState` has no `Stale` variant);
  `crates/app/core/src/inbox_plan.rs:130-135`; `apps/desktop/src/features/
  plans/PlanReviewOverlay.test.tsx` ("Paused — item.stale") · by:
  re-verification pass for issue #1236 (intent-gated)
