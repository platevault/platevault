# Feature Specification: Data Lifecycle State Model

**Feature Branch**: `002-data-lifecycle-state-model`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify the data states and lifecycle model discussed for observed files, inferred metadata, reviewed decisions, generated views, plans, and applied mutations."

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

- Which lifecycle events are visible to normal users versus developer diagnostics?
- Which metadata fields require explicit review before project creation?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The domain model MUST distinguish observed filesystem facts, parsed/inferred metadata, user-reviewed decisions, generated projections, planned mutations, and applied mutations.
- **FR-002**: The UI MUST NOT surface confidence or evidence as routine ledger columns.
- **FR-003**: Detail views MUST expose provenance for important values in structured rows or expandable sections.
- **FR-004**: User-reviewed decisions MUST preserve the original observed or inferred value for audit.
- **FR-005**: Generated project views MUST reference source Inventory records instead of becoming independent source truth.
- **FR-006**: Planned cleanup/archive operations MUST remain reviewable until explicitly applied.
- **FR-007**: Failed mutations MUST record an error event and final data state.
- **FR-008**: Lifecycle state labels MUST be plain, functional, and consistent across Inbox, Inventory, Projects, Settings, logs, and documentation.

### Key Entities

- **Data Asset**: A file, folder, session, calibration set, or generated project view tracked by the app.
- **Observation**: A filesystem or parser-derived fact.
- **Inference**: A value derived from observations before user review.
- **Review Decision**: A user-confirmed or corrected value.
- **Generated Projection**: A project source, prepared source, marker, manifest, or derived app-owned representation.
- **Mutation Plan**: A proposed filesystem change pending review.
- **Lifecycle Event**: Auditable transition or failure record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify the source of important detail values without reading logs.
- **SC-002**: Ledger rows stay focused on direct workflow fields and do not require horizontal scanning for confidence/evidence.
- **SC-003**: A lifecycle audit can reconstruct Inbox-to-Inventory-to-Project-to-Archive movement for a representative item.
- **SC-004**: Failed filesystem operations leave no ambiguous lifecycle state.

## Assumptions

- SQLite remains the canonical local store for lifecycle state.
- Logs include request and entity metadata automatically.

## Out of Scope

- Building the persistence schema.
- Implementing cleanup/archive apply logic.
- Remote synchronization.
