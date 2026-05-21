# Research: Cleanup And Archive Review Plans

**Feature**: 017-cleanup-archive-review-plans  
**Date**: 2026-05-20  
**Status**: Decisions recorded against the existing mockup implementation.

## 1. Plan review UX

**Question**: What review surface gives users enough context to safely approve
destructive filesystem work without overwhelming them?

**Options considered**:

- **A. Single list with inline action buttons.** Familiar, but obscures
  per-item context and makes "review before approve" feel optional.
- **B. List + dedicated detail page with two-pane review (items + per-item
  detail).** Forces the user through a context-rich page before any approval.
  Higher click cost but matches the safety story.
- **C. Modal review on top of the list.** Good for short plans, poor for
  thousand-item restructure plans because modals constrain viewport.

**Decision**: **B.** The mockup already ships option B with a left items table
and a right detail pane showing source, destination, action, reason,
protection, linked records, and provenance.

**Rationale**: The constitution requires reviewable mutation; a dedicated
detail page is the only option that scales to large item counts and gives the
detail pane room to show provenance and protection state.

## 2. Retry semantics for failed plans

**Question**: When a plan ends in `failed` or `partially_applied`, should
retry mutate the parent or create a new plan?

**Options considered**:

- **A. In-place reset.** Cheaper UI, but obliterates the audit story: the
  parent plan's history is overwritten or lost.
- **B. New plan referencing the parent by id.** Each attempt has its own
  audit trail; the parent stays terminal and immutable.
- **C. Sub-plan nested under the parent.** Mirrors retry attempts as children,
  but doubles the data model (plans + sub-plans) for marginal value.

**Decision**: **B — retry is a new plan with `parentPlanId`.**

**Rationale**: Spec 002 §2.2 already commits to "retry plan is a NEW plan"
and the mockup mirrors this with the "Generate retry plan for failures" CTA.
This keeps each apply attempt audit-immutable and lets the list show retry
chains by following parent links.

**Open option**: Whether the retry plan defaults to "failed items only" or
"all items". The contract supports both via `items_filter`; the UX default in
the mockup is failed-items-only.

## 3. Cancellation semantics with partial progress

**Question**: When the user cancels an `applying` plan that has already
applied some items, what state does the plan end in and what happens to the
applied items?

**Options considered**:

- **A. Cancel implies rollback.** Reverse every applied item. Maximises user
  surprise minimisation, but introduces a second mutation engine and risks
  cascading rollback failures.
- **B. Cancel halts forward progress; applied items stay applied; plan moves
  to `cancelled`.** The plan ends with a partial-progress record but no
  rollback. Retry path uses the same "new plan referencing parent" flow.
- **C. Cancel halts and forces the plan to `partially_applied`.** Conflates
  "user cancelled" with "executor reported partial failure".

**Decision**: **B.** Cancellation is a forward-progress halt. Applied items
remain applied; pending items remain pending; the plan transitions to
`cancelled`. Retry handles recovery.

**Rationale**: Rollback is its own destructive operation that needs its own
plan and approval gate. Conflating it with cancellation would smuggle
destructive work past the approval gate. Distinct `cancelled` and
`partially_applied` states preserve audit fidelity.

**Coordination with spec 025**: The apply executor is the only writer of
`cancelled`. The review surface only exposes the Cancel button while the plan
is `applying`.

## 4. Archive versus trash by platform

**Question**: For destructive plan items in v1, do we use platform trash, an
app-managed archive folder, or permanent delete?

**Options considered**:

- **A. Permanent delete.** Smallest disk footprint, biggest blast radius.
  Rejected by the constitution unless explicitly approved.
- **B. Platform trash (Recycle Bin / Trash / FreeDesktop trash).** Cross-
  platform support varies; external drives often skip system trash.
- **C. App-managed archive folder under each library root.** Predictable
  behavior across platforms and external drives; user owns the archive.

**Decision**: **C for v1, with B as a future option.** Permanent delete is
deferred past v1.

**Rationale**: Constitution principle II prefers archive workflows. Platform
trash inconsistency on external drives (a common astro storage location)
makes B unreliable. An app-managed archive is reviewable, predictable, and
reversible without piping through OS trash semantics.

## 5. Dry-run preview

**Question**: Do plans need a separate "dry-run" mode beyond the existing
review state?

**Decision**: **No separate dry-run.** The review state already represents a
dry run — items show source, destination, action, and reason without
mutation. A second "dry-run apply" mode would duplicate the review surface
and confuse the state machine.

**Rationale**: The review state is the dry run. Adding a parallel mode
multiplies states without adding safety.

**Future note**: If users ask for execution simulation (timing, conflict
detection at apply time), that belongs in spec 025 as a `preflight` phase
inside `applying`, not as a new review-side state.

## 6. Multi-origin plan ordering

**Question**: When the list contains plans from multiple origins (inbox,
restructure, cleanup, archive, project source-map) in mixed states, what is
the default ordering?

**Options considered**:

- **A. Strict creation-order descending.** Familiar but buries failures.
- **B. Failed-first, then creation-order.** Surfaces the most attention-worthy
  plans at the top.
- **C. Grouped by origin.** Helpful for power users but adds visual
  complexity; users with mostly one origin lose the failure signal.

**Decision**: **B — failed-first ordering as the default**, with creation-time
descending as the secondary sort.

**Rationale**: A failed plan needs attention before any new draft; surfacing
failures by default makes the "Generate retry plan" CTA discoverable. Origin
grouping is available via the origin filter rather than as the default sort.

**Implementation evidence**: The mockup's `PlansListPage` already implements
failed-first ordering and exposes state and origin filters.

## 7. Concurrent reviewers

**Question**: What happens if two windows attempt to approve or discard the
same plan?

**Decision**: The plan state is the source of truth; the review use cases
perform a state-precondition check (`plan.invalid_state`) and reject the
second call. The audit log records both attempts.

## 8. Resolved + open summary

Resolved:

- Two-pane review surface (Q1).
- Retry = new plan with `parentPlanId` (Q2).
- Cancel = halt without rollback; distinct from partial-applied (Q3).
- Archive folder, no permanent delete in v1 (Q4).
- No separate dry-run state (Q5).
- Default ordering: failed-first, then creation-time descending (Q6).
- Concurrency: state-precondition rejects the loser (Q7).

Open:

- Default retry filter: failed-only versus all (deferred to UX testing).
- Whether the retry chain UI displays a tree, breadcrumbs, or a flat parent
  link (deferred to spec 019/020 work on cross-surface linking).
- Whether approving a plan also writes a checkpoint of the affected
  filesystem state for spec 025 to validate before applying.
