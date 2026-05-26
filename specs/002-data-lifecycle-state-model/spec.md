# Feature Specification: Data Lifecycle State Model

> **See Spec 030**: UI implementation of this feature must follow
> [Spec 030 — UI Audit & Revision](../030-ui-audit-revision/spec.md)
> for layout, navigation, and component patterns.

**Feature Branch**: `002-data-lifecycle-state-model`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify the data states and lifecycle model discussed for observed files, inferred metadata, reviewed decisions, generated views, plans, and applied mutations."

### SpecKit Refinement Note (2026-05-15)

This is the detailed follow-on specification for the lifecycle/state behavior introduced in Spec 001.

## Implementation Status

A non-production UI mockup currently shadows a subset of this lifecycle model
inside the desktop shell. It is the canonical reference for "what the model
looks like as a user interacts with it", but it is NOT a substitute for the
durable, audited Rust + persistence implementation called for by the
constitution. Treat the mockup as a reviewable prototype that exercises shape,
labels, and transition gating; the canonical model still belongs in
`crates/domain/core/` and `crates/audit/`.

Wired files (mockup-only, in `apps/desktop/`):

- `apps/desktop/src/data/mock.ts` — shadow domain types and labels:
  `ProjectLifecycle` (`setup_incomplete | ready | prepared | processing |
  completed | archived | blocked`), `PlanState` (`draft | ready_for_review |
  approved | applying | applied | partially_applied | failed | cancelled`),
  `InventorySession.state` — canonical 6-state vocabulary
  (`discovered | candidate | needs_review | confirmed | rejected | ignored`);
  the current mockup only exercises a partial subset
  (`confirmed | needs_review | rejected`) and MUST be brought up to the full
  6-state set in the Rust port,
  `InventorySource.state` (`active | missing | disabled | reconnect_required`),
  plus `lifecycleLabel`, `lifecycleTone`, `planStateLabel`, `planStateTone`,
  `inventoryStateLabel`, `inventoryStateTone`.
- `apps/desktop/src/data/store.ts`:
  - `PROJECT_TRANSITIONS` table encodes the allowed project lifecycle graph
    (forward, blocked-recovery, archive resume).
  - `isProjectTransitionAllowed(from, to)` enforces the graph.
  - `setProjectLifecycle(id, next, actionLabel?)` refuses disallowed
    transitions, writes an audit log line, and updates `lastAction`.
  - `setSessionReviewState(sessionId, state)` is idempotent (no-op when state
    is unchanged, no log entry).
  - `simulateApply(planId)` walks `pending → applying → succeeded|failed`
    item-by-item and resolves the plan to `applied | partially_applied |
    failed`, mirroring FR-004 terminal outcomes.
  - `usePendingPlansCount()` partitions pending plans into `needsAction`
    (`draft | ready_for_review | approved`) and `needsAttention`
    (`failed | partially_applied`), exposing the spec's distinction between
    in-flight review and post-failure recovery.
- `apps/desktop/src/features/projects/ProjectsPage.tsx` — surfaces the project
  lifecycle stepper and is the primary consumer of `setProjectLifecycle`.
- `apps/desktop/src/features/plans/PlanDetailPage.tsx` — surfaces plan terminal
  states and the "Needs attention" partitioning produced by the apply
  simulator.
- `apps/desktop/src/features/inventory/InventoryPage.tsx` — surfaces session
  review state and consumes `setSessionReviewState`.

Invariants the mockup currently enforces:

1. Project lifecycle transitions are gated by an explicit edge list; disallowed
   transitions are refused at the store layer, not at the UI layer.
2. Refused transitions emit a `warn` log entry that names the source entity
   and the rejected edge (FR-002 audit shape, minus durable persistence).
3. Same-state writes are no-ops: identical-state `setSessionReviewState` calls
   neither mutate nor log, and identical-state `setProjectLifecycle` returns
   early.
4. Plan apply resolves to exactly one of `applied | partially_applied |
   failed`, with item-level state preserved on each entry (FR-004 shape).
5. Project lifecycle changes update `lastAction` (label + timestamp), which is
   the user-visible projection of the audit event.

Invariants explicitly NOT yet enforced by the mockup (deferred to Rust port):

- Persistence and crash-safe audit-log durability.
- Field-level provenance separation (`observed | inferred | reviewed`) on
  individual values inside a Data Asset.
- Action-bound review gating (FR-009/FR-010) — the mockup tracks session-level
  `needs_review` but not per-action critical-value blocking.
- Generated-projection `Stale` state on source change (FR-003).
- Immutable snapshot capture for session/calibration reviews (FR-005).
- Session-key derivation from metadata (FR-011/FR-012).
- Diagnostic vs. workflow-significant event partitioning at the audit layer
  (FR-008) — the log panel currently shows whatever the store appends.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand Data State (Priority: P1)

As a user reviewing astrophotography data, I want the app to clearly distinguish observed facts, inferred metadata, reviewed decisions, generated project views, and planned filesystem changes so that I know what is source truth and what is app output.

**Why this priority**: The app is trusted only if users can tell whether data came from the filesystem, metadata parsing, user review, or a generated projection.

**Independent Test**: Load an item with filesystem observations, parsed metadata, user-reviewed frame kind, generated project source links, and a cleanup plan; confirm each state is identifiable in the detail view without relying on confidence or evidence columns in ledger rows.

**Acceptance Scenarios**:

1. **Given** an item has filesystem and metadata observations, **When** it is shown in a ledger, **Then** routine rows show only workflow-relevant state and omit confidence/evidence fields.
2. **Given** an item is opened in detail, **When** the user expands its lifecycle information, **Then** observed facts, inferred values, reviewed decisions, generated projections, and planned mutations are separated.
3. **Given** a user confirms or corrects inferred metadata, **When** the decision is saved, **Then** the item records a reviewed decision without overwriting the original observation.

---

### User Story 2 - Trace Lifecycle Transitions (Priority: P2)

As a user, I want lifecycle transitions to be auditable so that I can understand how an item moved from Inbox to Inventory, into a project, and eventually into archive or cleanup review.

**Why this priority**: Filesystem organization and cleanup require a clear historical record.

**Independent Test**: Move an item through Inbox, Inventory confirmation, project linking, and cleanup planning; confirm the lifecycle timeline records each transition and actor.

**Acceptance Scenarios**:

1. **Given** an Inbox item is moved to Inventory, **When** the move completes, **Then** a lifecycle event records the source item, target Inventory item, and resulting state.
2. **Given** an Inventory item is linked into a project, **When** the project source is created, **Then** the generated projection is recorded separately from the original Inventory item.
3. **Given** a cleanup/archive plan is created, **When** the plan is reviewed, **Then** planned state remains separate from applied mutation state.

### Edge Cases

- Mixed folders can contain files with divergent session keys, producing multiple session candidates that share some folder/path provenance and have independent action-critical review state.
- Metadata parser returns incomplete or contradictory values.
- The same physical file is discovered through two configured sources.
- A generated project view becomes stale after the source item changes.
- A mutation fails after some filesystem work has already been applied.
- A user manually edits a value previously inferred by metadata.

### Domain Questions To Resolve

- **Resolved:** User-facing timeline views show workflow-significant lifecycle events by default; diagnostic events are separate.
- **Resolved:** Which metadata fields require explicit review before project creation?
  - Review is action-bound, not a universal per-field gate. The app must capture reviewed values only for the specific action being executed (for example, session confirmation, project creation, or move to Inventory), and unresolved/contradictory action-critical values block only that action.

### Clarifications

#### Session 2026-05-23

- Q: For the `acquisition_session` action-bound review gate, should the cell guard the entry-to-review edge (`candidate → needs_review`) or the confirmation edges (`candidate → confirmed` and `needs_review → confirmed`)? → A: Move the gate to the confirmation edges and drop the entry-to-review cell — the entry edge is a pipeline-driven auto-transition triggered by extraction failure, not a user action the gate refuses. (Recorded in `data-model.md` §Action-Bound Review.)

### Decisions

- **Accepted:** Lifecycle is asset-first / asset-centric-first. Assets are the primary lifecycle subject, and important values inside each asset carry field-level provenance for source and review status.
- **Accepted:** User-facing timelines default to workflow-significant lifecycle events only (for example: state transitions, confirmations, project linkage changes, plan status milestones). Diagnostic/adapter/parser/retry/cache/request-level events are intentionally excluded from default timeline visibility and are available in logs or expanded lifecycle detail.
- **Accepted:** Review is action-bound. There is no universal explicit per-field review gate before project creation; actions define which fields are review-critical in that moment and require confirmation for those fields only.
- **Accepted:** Session candidates MUST be grouped/split by a metadata-derived session key generated from FITS/XISF/video metadata. Folder boundaries are scan boundaries and human hints, not authoritative session identity. Multiple folders may contribute to one session candidate when session keys match.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The model MUST keep observed facts, inferred metadata, reviewed decisions, generated projections, planned mutations, and applied mutations in distinct lifecycle families.
- **FR-002**: Any lifecycle transition MUST produce an auditable event containing actor, timestamp, from-state, to-state, and transition trigger.
- **FR-003**: Generated projections MUST transition to `Stale` when their source input changes and MUST be clearly visible as stale in detail or list views.
- **FR-004**: Filesystem plan execution MUST represent terminal outcomes as `Succeeded`, `Partially Failed`, `Failed`, or `Cancelled`, preserving which mutations completed versus those not applied.
- **FR-005**: Session and calibration candidate reviews MUST preserve immutable snapshots of their observed/inferred/reviewed context for audit, while allowing new snapshots for later rescans.
- **FR-006**: Ledger rows MUST stay lean and omit confidence/evidence/provenance columns, while detail views and logs expose structured provenance with request/entity metadata automatically. Default ledger views for `InventorySession` and `CalibrationSession` MUST filter `state != rejected`; detail surfaces MUST always show rejected entries; a 'show rejected' toggle MUST be available to re-include them in ledger views.
- **FR-007**: All lifecycle transitions MUST be anchored on a `Data Asset`; value-centric events are represented as field-level provenance on that asset (including source and review status), so lifecycle meaning is testable at both asset and value granularity.
- **FR-008**: Default lifecycle timeline rendering MUST display only workflow-significant events; diagnostics (adapter/parser/retry/cache/request-level events) MUST be excluded by default but remain retrievable through logs and expanded event-detail views to preserve full audit completeness.
- **FR-009**: Action confirmation flows (for example, confirm session, create/move project, or mark items for processing) MUST record reviewed decisions scoped to the action, including which values were accepted, corrected, or explicitly left unresolved.
- **FR-010**: If action-critical metadata or decision values are missing, contradictory, or unresolved, the current action MUST be blocked with a clear list of required corrections; unresolved values that are not critical to that action MAY remain unresolved.
- **FR-011**: Session candidate formation MUST be based on grouping by a metadata-derived session key from FITS/XISF/video metadata. The session key is the tuple `(target_id, filter, binning, gain, observing_night)`, where `observing_night` is derived from each frame's UTC capture timestamp using the configured `observer_location` (spec 018) at local-solar-noon boundaries (consistent with spec 013/023). See research.md §2.5 for the derivation algorithm.
- **FR-012**: Mixed-folder discovery inputs MUST split into separate session candidates whenever session keys differ; each candidate MUST retain the originating folder/path as provenance information, without treating path as authoritative session identity.

### Key Entities

- **Data Asset**: A file, folder, session, calibration set, or generated project view tracked by the app.
- **Observation**: A filesystem or parser-derived fact.
- **Inference**: A value derived from observations before user review.
- **Review Decision**: A user-confirmed or corrected value.
- **Generated Projection**: A project source, prepared source, marker, manifest, or derived app-owned representation.
- **Mutation Plan**: A proposed filesystem change pending review.
- **Lifecycle Event**: Auditable transition or failure record.

### State Families

- **Data Source**: `Draft`, `Previewed`, `Active`, `Disconnected`, `Disabled`, `ReconnectRequired`, `Retired`
- **Inventory Record**: `Observed`, `Missing`, `Changed`, `Classified`, `Rejected`, `Protected`
- **Session Candidate / Calibration Candidate**: `Discovered`, `Candidate`, `Needs Review`, `Confirmed`, `Ignored`
- **Project**: `Candidate`, `Source Mapping`, `Prepared`, `Processing`, `Finalized`, `Cleanup Reviewed`, `Archived`
- **Prepared Source**: `Not Created`, `Planned`, `Ready`, `Stale`, `Retired`
- **Filesystem Plan**: `Draft`, `Ready for Review`, `Approved`, `Executing`, `Succeeded`, `Partially Failed`, `Failed`, `Cancelled`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify the source of important detail values without reading logs.
- **SC-002**: Ledger rows stay focused on direct workflow fields and do not require horizontal scanning for confidence/evidence.
- **SC-003**: A lifecycle audit can reconstruct Inbox-to-Inventory-to-Project-to-Archive movement for a representative item.
- **SC-004**: Failed filesystem operations leave no ambiguous lifecycle state.

## Assumptions

- Logs include request and entity metadata automatically.

## Out of Scope

- Building the persistence schema.
- Implementing cleanup/archive apply logic.
- Remote synchronization.
