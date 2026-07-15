---
id: J12
title: See why an action failed or was refused, and what to do next
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [plans, projects, audit]
interfaces: [desktop-ui]
trace:
  - docs/product/journeys/J12-failure-refusal-handling/journey.md @ 66026463
  - specs/030-ui-audit-revision/spec.md (FR-130-134 §8.3, FR-135-140 §12)
  - deltas/2026-07-14-q15-t127.md (partially folded; see Known gaps)
  - deltas/2026-07-14-q16-t130.md (not folded; see open questions)
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
- P1: A project exists whose current lifecycle state cannot satisfy at least
  one transition control offered on its page.
- P2: A source/plan-generating action (e.g. a cleanup or archive scan) can be
  run against a library state that matches zero candidates.
- P3: A confirmed filesystem plan is pending apply, and at least one item it
  references can be made to fail during apply (e.g. its source file is
  removed or made inaccessible after confirm but before apply).
- P4: A confirmed, not-yet-applied plan exists whose referenced source data
  can be changed on disk after confirmation, to force staleness.
- P5: Audit Log access is available for the project/plan touched above.

## Steps

### S1 — A refused lifecycle transition explains itself inline {#S1}
- **Do:** Open a project whose current state cannot satisfy one of its
  offered lifecycle transitions, and attempt that transition.
- **Expect:** The refusal reason renders inline next to the control, in the
  user's language; a transition that can never succeed from the current
  state is disabled with that same reason shown, rather than only appearing
  disabled with no explanation.
- **Expect (negative):** The control is never clickable-and-silent — a
  disabled control with no visible reason, or a click that produces no
  feedback, both fail this step.

### S2 — An empty generated plan states why it is empty {#S2}
- **Do:** Run a plan-generating action (cleanup/archive scan, or similar)
  against library state that matches nothing.
- **Expect:** The resulting plan view states the reason no items were
  produced (e.g. that current rules matched no candidates), instead of only
  disabling the Approve control.
- **Expect (negative):** Approve is never simply greyed out with no
  accompanying explanation of why there is nothing to approve.

### S3 — A partial apply failure names failures and offers retry {#S3}
- **Do:** Apply a confirmed plan where at least one item fails during apply
  (e.g. its source file went missing or became inaccessible after confirm).
- **Expect:** Failed items are listed by name with a per-item reason;
  previously succeeded items in the same run keep their applied state
  visible; a retry-failed-only action is offered.
- **Do:** Trigger retry-failed-only.
- **Expect:** Only the previously failed subset is re-attempted; items that
  already succeeded are not reapplied.
- **Expect (negative):** A partial failure never hides or rolls back the
  items that already succeeded, and never presents a single undifferentiated
  "plan failed" message in place of per-item detail.

### S4 — A stale plan refuses to apply and offers regeneration {#S4}
- **Do:** Attempt to apply a plan whose referenced source data changed on
  disk after it was confirmed.
- **Expect:** Apply is refused; the plan is visibly marked stale and the
  changed file(s)/items are identifiable; a regenerate action is offered in
  place of apply.
- **Expect (negative):** Apply never proceeds silently against stale plan
  data, and the stale state is never indistinguishable from a normal
  pending-apply plan.

### S5 — Every refusal and failure is later findable in the Audit Log {#S5}
- **Do:** After triggering a refusal/failure from S1-S4, open the Audit Log
  for the affected project/plan.
- **Expect:** Lifecycle-transition refusals (S1) appear as durable audit
  entries with an outcome and the same reason text the user saw inline.
- **Expect (negative):** The reason text shown in the Audit Log never
  diverges from the reason text the user saw at the moment of refusal.
- **Trace:** see Known gaps — plan-apply outcomes (S3/S4) are not yet
  covered by this step's durability guarantee.

## Success criteria
- SC1: Every impossible lifecycle transition control (S1) shows a reason at
  the moment it is attempted or rendered; zero silent disables are observed
  across a full pass of a project's lifecycle controls.
- SC2: Every plan-generating action that yields zero items (S2) shows an
  explanatory message; no run ends with just a disabled Approve and no text.
- SC3: In a partial-apply run (S3), failed item count + succeeded item count
  always equals the run's total item count, and retry-failed-only only
  re-attempts the failed subset (verified by item id set before/after retry).
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
- G2: A concurrent, unmerged fix (branch `fix/guided-event-emission`,
  issues #722 and #723) is addressing two related failure-surfacing defects
  in the guided first-project flow (spec 010): #723/FR-010 — the
  corrupted-state recovery signal serializes as the generic
  `internal.database` error code instead of the contracted
  `state_corrupted` code, so a caller cannot distinguish it from an
  unrelated persistence failure; #722 — the events that should let the
  guided flow advance automatically are never emitted from backend to the
  webview. Neither is merged to `main` as of 2026-07-14. This journey does
  not exercise the guided flow directly, but the underlying expectation —
  that a system-detected, self-corrected failure state is disclosed with a
  distinct, contract-conformant reason rather than an overloaded or silent
  code — is the same one S1-S4 assert for other refusal classes, so this
  is recorded here as a known cross-cutting violation until #722/#723 land.

## Delta log
