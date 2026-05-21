# Feature Specification: Cleanup And Archive Review Plans

**Feature Branch**: `017-cleanup-archive-review-plans`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify what cleanup/archive plans mean, how users review them, and how destructive operations are gated."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review A Cleanup Plan (Priority: P1)

As a user, I want cleanup candidates collected into a review plan so that I can
understand every proposed filesystem change before anything is applied.

**Why this priority**: The user asked what "plans" means and destructive
operations require a reviewable model.

**Independent Test**: Generate a cleanup plan for a completed project and
confirm each proposed action shows source, destination or deletion target,
reason, protection state, and review status.

**Acceptance Scenarios**:

1. **Given** cleanup candidates exist, **When** a plan is generated, **Then**
   no filesystem mutation occurs.
2. **Given** a plan item is selected, **When** detail opens, **Then** the app
   shows source path, proposed action, reason, protection, and linked
   project/Inventory records.
3. **Given** a plan contains permanent delete candidates, **When** the user
   approves the plan, **Then** those items require destructive confirmation.

---

### User Story 2 - Apply An Archive Plan (Priority: P2)

As a user, I want archive moves to be planned, reviewed, applied, and logged so
that completed projects can be moved safely.

**Why this priority**: Archive location patterns and source protection require
plan-based review.

**Independent Test**: Build an archive plan from a project, review the
generated destination pattern, approve it, and confirm applied moves and
lifecycle events.

**Acceptance Scenarios**:

1. **Given** an archive location pattern is configured, **When** a plan is
   generated, **Then** destination paths are previewed per item.
2. **Given** a destination conflict exists, **When** the plan is reviewed,
   **Then** the item is blocked until resolved.
3. **Given** applying the plan partially fails, **When** the operation ends,
   **Then** the app logs applied and failed items separately and leaves plan
   state clear.

---

### User Story 3 - Approve And Hand Off To Apply (Priority: P3)

As a user, I want a single approval gate that hands an approved plan to the
apply executor so that destructive work cannot start until I explicitly
acknowledge it.

**Why this priority**: The state machine separates *review* (this spec) from
*application* (spec 025); the handoff edge must be specified here so both
specs agree on the contract.

**Independent Test**: From a `ready_for_review` plan, exercise Approve, observe
the plan move to `approved`, then trigger Apply and confirm the plan transitions
into `applying` exactly once.

**Acceptance Scenarios**:

1. **Given** a plan in `ready_for_review`, **When** the user approves, **Then**
   state becomes `approved` and no items are mutated.
2. **Given** an `approved` plan, **When** the user clicks "Apply now", **Then**
   state becomes `applying` and control passes to the apply executor (spec 025).
3. **Given** an `approved` plan, **When** the user reopens it as draft, **Then**
   the approval is invalidated and the plan returns to `draft`.

---

### User Story 4 - Discard An Unwanted Plan (Priority: P4)

As a user, I want to discard a plan I no longer trust so that stale drafts do
not accumulate.

**Why this priority**: A growing list of stale plans creates review fatigue and
hides actionable items.

**Independent Test**: Discard a `draft` plan, confirm it disappears from the
list, and confirm the audit log retains a record.

**Acceptance Scenarios**:

1. **Given** a plan in `draft`, `ready_for_review`, or any terminal state,
   **When** the user discards it, **Then** it is removed from the active list
   and recorded in the audit log.
2. **Given** a plan in `applying`, **When** the user attempts to discard,
   **Then** the operation is refused with `plan.in_progress`.

---

### User Story 5 - Retry After Partial Or Total Failure (Priority: P5)

As a user, when a plan finishes with failures, I want to generate a new retry
plan covering the failed items so the original audit trail stays intact.

**Why this priority**: Retrying in-place mutates history; the agreed model is
"retry plan is a NEW plan" referencing its parent.

**Independent Test**: From a `failed` or `partially_applied` plan, click
"Generate retry plan", confirm a new plan is created with `parentPlanId` set,
containing only the failed items (or all items, per the chosen filter).

**Acceptance Scenarios**:

1. **Given** a `partially_applied` plan, **When** the user retries failed
   items, **Then** a new plan is created in `draft` referencing the parent.
2. **Given** a `failed` plan, **When** the user retries all items, **Then** the
   new plan contains every item from the parent, reset to `pending`.
3. **Given** any non-terminal plan, **When** retry is attempted, **Then** the
   call is refused with `parent.not_terminal`.

### Edge Cases

- Destination path already exists.
- Source path is missing after plan generation.
- Protected source blocks a proposed delete.
- User edits archive pattern after a plan was generated.
- Permanent delete is disabled for reviewed plans in v1.
- A plan's parent was discarded — retry must still be possible if the parent's
  item records survive.
- A plan accumulates many items (1000+); list/detail must remain responsive.
- Concurrent attempts to approve or discard the same plan from two windows.

### Domain Questions To Resolve

- Final names for plan states. (See research.md §1.)
- Whether permanent delete is available in first release. (Deferred; v1 uses
  archive/trash only.)
- Default ordering of plans. (See research.md §5; default: failed-first.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cleanup/archive plans MUST be explicit review objects, not
  immediate actions.
- **FR-002**: Plan generation MUST be read-only.
- **FR-003**: Plan items MUST show proposed action, source path, destination
  path when relevant, reason, protection state, and linked entity.
- **FR-004**: Permanent delete MUST require a destructive warning popup and
  explicit confirmation. (Deferred in v1 — archive/trash only.)
- **FR-005**: Plans MUST expose the state vocabulary: `draft`,
  `ready_for_review`, `approved`, `applying`, `applied`, `partially_applied`,
  `failed`, `cancelled`.
- **FR-006**: Plan apply MUST log every item outcome. (Apply itself is owned by
  spec 025; this spec only requires that the contract surfaces the per-item
  log.)
- **FR-007**: Failed plan apply MUST NOT leave ambiguous project or Inventory
  lifecycle state.
- **FR-008**: Archive destination paths MUST come from the token pattern
  builder (spec 015).
- **FR-009**: Plans list MUST default to failed-first ordering, with secondary
  sort by creation time descending.
- **FR-010**: Plans list MUST support filtering by state and by origin
  (inbox, restructure, cleanup, archive, project source-map).
- **FR-011**: The plan detail surface MUST present a state-aware action bar:
  draft → Approve & Apply; approved → Apply now; applying → Pause/Cancel;
  applied → Back; partially_applied/failed → Generate retry plan; cancelled →
  Back.
- **FR-012**: A retry plan MUST be a new plan referencing the parent via
  `parentPlanId`. The parent plan MUST NOT be mutated by retry.
- **FR-013**: Discarding a plan MUST be refused while the plan is `applying`.
- **FR-014**: Approve MUST be refused for plans with zero items.
- **FR-015**: The plans surface MUST render a three-branch empty state: no
  plans, no matches under current filter, or table with results.

### Key Entities

- **Plan**: Reviewable set of proposed filesystem operations, with state,
  origin, item counters, and optional parent reference.
- **Plan Item**: One proposed filesystem operation, with source, destination,
  action, reason, protection, and per-item state.
- **Plan State**: Review and apply lifecycle state, drawn from the eight-state
  vocabulary in FR-005.
- **Plan Origin**: Where the plan came from (inbox, restructure, cleanup,
  archive, project source-map).
- **Destructive Confirmation**: Explicit user confirmation for permanent
  delete. (Deferred in v1.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can inspect every planned filesystem mutation before
  approval.
- **SC-002**: No permanent delete happens without a warning popup. (v1: no
  permanent delete is offered.)
- **SC-003**: Plan apply results are recoverable from logs and lifecycle
  events.
- **SC-004**: 100% of failed plans expose a "Generate retry plan" path that
  creates a new plan rather than mutating the parent.
- **SC-005**: Filter and sort changes on the plans list render in under 100 ms
  for up to 200 plans.

## Implementation Status

Mockup-only implementation already exists in `apps/desktop/`:

- `src/features/plans/PlansListPage.tsx` — failed-first ordering, state/origin
  filters, three-branch empty state.
- `src/features/plans/PlanDetailPage.tsx` — two-pane review (items + detail),
  applying pane, state-aware action bar covering all eight states.
- `src/data/store.ts` — `usePlans`, `getPlanById`, `updatePlanState`,
  `discardPlan`, and a `simulateApply` that mirrors the eventual apply
  executor's per-item progression and final-state computation.
- `src/data/mock.ts` — `Plan`, `PlanItem`, `PlanState`, plus seed plans
  covering every state in the vocabulary.

No backend, persistence, or filesystem mutation exists yet. The
mockup's `simulateApply` is a stand-in for spec 025's apply executor; the
review surface — list, detail, action bar, approve, discard, retry-as-new-plan
— is owned by this spec.

### Coordination With Spec 025

This spec owns the **review** surface: list, detail, approve, discard, retry.
Spec 025 owns the **apply** executor: per-item execution, pause/cancel
semantics, partial-progress accounting, and post-apply state computation.

The handoff is the `approved → applying` transition. Both specs MUST agree
that:

- The plan's state is the single source of truth across review and apply.
- The apply executor is the only writer of `applying`, `applied`,
  `partially_applied`, `failed`, and `cancelled`.
- This spec is the only writer of `draft`, `ready_for_review`, and `approved`.
- Retry creates a new plan whose `parentPlanId` points at the terminal parent.

## Assumptions

- Cleanup/archive review can apply across projects and Inventory.
- Source protection (spec 016) affects plan approval and per-item protection
  flags.
- The token pattern builder (spec 015) supplies archive destination paths.
- The lifecycle state-machine vocabulary (spec 002 §2.2) is canonical.

## Out of Scope

- Cloud archive services.
- Background scheduled deletion.
- Permanent delete (deferred past v1).
- The apply executor itself (spec 025).
- Audit log presentation surface (spec 019).
