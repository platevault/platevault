---
id: J12
title: See why an action failed or was refused, and what to do next
version: 1
status: draft
last_reviewed: 2026-07-14
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
- **Trace:** Confirmed unmet in the running app (2026-07-14 live run):
  deleting a plan item's source file before apply produced
  `itemsFailed=0`/`itemsApplied=2` — silent success, not a listed failure.
  Root cause: `approve_plan` never snapshots per-item FS metadata, so the
  CAS staleness check permissively skips universally (issue #829, open,
  SAFETY; DB-wide, 0/26 `plan_items` have `approved_mtime` populated). Even
  when an item does fail, the per-item id/reason payload is discarded
  before reaching the UI, leaving only an aggregate count (issue #607,
  open, P1, `usePlanApplyProgress.ts:74-76`). Retry mechanism verified in
  code: `apps/desktop/src/features/plans/PlanReviewOverlay.tsx`
  (`handleGenerateRetryPlan`) creates a new plan from the failed subset —
  it does not re-apply the original plan in place; the separate in-run
  per-item `retry_plan_item` path (`crates/app/core/src/plan_apply.rs:1978`)
  is for retrying within a still-active apply and never re-executes queued
  retries (issue #742, open). Unresolved-chip claim verified via
  `apps/desktop/src/components/RenderValue.tsx:76-87` and
  `RenderValue.test.tsx`/`PropertyTable.test.tsx`; no dedicated per-item
  failure indicator exists yet to compare it against (#607), so the
  "never confusable with a failure indicator" half of this claim is
  unverified until #607 ships. See report for candidate Known gap.

### S4 — A stale plan refuses to apply and offers regeneration {#S4}
- **Do:** Attempt to apply a plan whose referenced source data changed on
  disk after it was confirmed.
- **Expect:** Apply is refused; the plan is visibly marked stale and the
  changed file(s)/items are identifiable; a regenerate action is offered in
  place of apply.
- **Expect (negative):** Apply never proceeds silently against stale plan
  data, and the stale state is never indistinguishable from a normal
  pending-apply plan.
- **Trace:** Confirmed unmet in the running app (2026-07-14 live run): a
  plan whose source file was deleted after confirm applied silently
  (`itemsFailed=0`), with no stale marking and no regenerate action offered
  — same root cause as S3 (issue #829, open, SAFETY). The stale-plan-refusal
  mechanism this step describes is currently unwired for every plan type
  (catalogue/mkdir/link actions cannot detect it at all; move/archive/
  trash/delete actions may still surface a real IO error for a *deleted*
  source, untested, but a *modified* source is never caught). See report
  for candidate Known gap.

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
- G1: Durable audit rows for plan-apply outcomes (partial-apply failures,
  S3; stale-plan refusals, S4) do not exist yet — `crates/app/core/src/
  plan_apply.rs` only emits live `EventBus::publish` events
  (`plan.item.progress`, `plan.applying.completed`), not the durable
  `audit_log_entry` rows the Audit Log UI reads. PR #826 (merged) extended
  durable audit to settings, protection, equipment, and source/root
  mutations (FR-130-134), but issue #647 (open) tracks the remaining
  action classes, including plan apply. SC5 currently only holds for S1
  (lifecycle transitions), which write durable rows via the pre-existing
  `LifecycleRepository::record_transition`/`record_refused_transition` path.

## Delta log
