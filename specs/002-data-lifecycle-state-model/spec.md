# Feature Specification: Data Lifecycle State Model

**Feature Branch**: `002-data-lifecycle-state-model`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify the data states and lifecycle model discussed for observed files, inferred metadata, reviewed decisions, generated views, plans, and applied mutations."

### SpecKit Refinement Note (2026-05-15)

This is the detailed follow-on specification for the lifecycle/state behavior introduced in Spec 001.

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

- Metadata parser returns incomplete or contradictory values.
- The same physical file is discovered through two configured sources.
- A generated project view becomes stale after the source item changes.
- A mutation fails after some filesystem work has already been applied.
- A user manually edits a value previously inferred by metadata.

### Domain Questions To Resolve

- **Resolved:** User-facing timeline views show workflow-significant lifecycle events by default; diagnostic events are separate.
- **Unresolved:** Which metadata fields require explicit review before project creation?

### Decisions

- **Accepted:** Lifecycle is asset-first / asset-centric-first. Assets are the primary lifecycle subject, and important values inside each asset carry field-level provenance for source and review status.
- **Accepted:** User-facing timelines default to workflow-significant lifecycle events only (for example: state transitions, confirmations, project linkage changes, plan status milestones). Diagnostic/adapter/parser/retry/cache/request-level events are intentionally excluded from default timeline visibility and are available in logs or expanded lifecycle detail.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The model MUST keep observed facts, inferred metadata, reviewed decisions, generated projections, planned mutations, and applied mutations in distinct lifecycle families.
- **FR-002**: Any lifecycle transition MUST produce an auditable event containing actor, timestamp, from-state, to-state, and transition trigger.
- **FR-003**: Generated projections MUST transition to `Stale` when their source input changes and MUST be clearly visible as stale in detail or list views.
- **FR-004**: Filesystem plan execution MUST represent terminal outcomes as `Succeeded`, `Partially Failed`, `Failed`, or `Cancelled`, preserving which mutations completed versus those not applied.
- **FR-005**: Session and calibration candidate reviews MUST preserve immutable snapshots of their observed/inferred/reviewed context for audit, while allowing new snapshots for later rescans.
- **FR-006**: Ledger rows MUST stay lean and omit confidence/evidence/provenance columns, while detail views and logs expose structured provenance with request/entity metadata automatically.
- **FR-007**: All lifecycle transitions MUST be anchored on a `Data Asset`; value-centric events are represented as field-level provenance on that asset (including source and review status), so lifecycle meaning is testable at both asset and value granularity.
- **FR-008**: Default lifecycle timeline rendering MUST display only workflow-significant events; diagnostics (adapter/parser/retry/cache/request-level events) MUST be excluded by default but remain retrievable through logs and expanded event-detail views to preserve full audit completeness.

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
