# Feature Specification: Cleanup And Archive Review Plans

**Feature Branch**: `017-cleanup-archive-review-plans`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify what cleanup/archive plans mean, how users review them, and how destructive operations are gated."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review A Cleanup Plan (Priority: P1)

As a user, I want cleanup candidates collected into a review plan so that I can understand every proposed filesystem change before anything is applied.

**Why this priority**: The user asked what "plans" means and destructive operations require a reviewable model.

**Independent Test**: Generate a cleanup plan for a completed project and confirm each proposed action shows source, destination or deletion target, reason, protection state, and review status.

**Acceptance Scenarios**:

1. **Given** cleanup candidates exist, **When** a plan is generated, **Then** no filesystem mutation occurs.
2. **Given** a plan item is selected, **When** detail opens, **Then** the app shows source path, proposed action, reason, protection, and linked project/Inventory records.
3. **Given** a plan contains permanent delete candidates, **When** the user approves the plan, **Then** those items require destructive confirmation.

---

### User Story 2 - Apply An Archive Plan (Priority: P2)

As a user, I want archive moves to be planned, reviewed, applied, and logged so that completed projects can be moved safely.

**Why this priority**: Archive location patterns and source protection require plan-based review.

**Independent Test**: Build an archive plan from a project, review the generated destination pattern, approve it, and confirm applied moves and lifecycle events.

**Acceptance Scenarios**:

1. **Given** an archive location pattern is configured, **When** a plan is generated, **Then** destination paths are previewed per item.
2. **Given** a destination conflict exists, **When** the plan is reviewed, **Then** the item is blocked until resolved.
3. **Given** applying the plan partially fails, **When** the operation ends, **Then** the app logs applied and failed items separately and leaves plan state clear.

### Edge Cases

- Destination path already exists.
- Source path is missing after plan generation.
- Protected source blocks a proposed delete.
- User edits archive pattern after a plan was generated.
- Permanent delete is disabled for reviewed plans.

### Domain Questions To Resolve

- Final names for plan states.
- Whether permanent delete is available in first release.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cleanup/archive plans MUST be explicit review objects, not immediate actions.
- **FR-002**: Plan generation MUST be read-only.
- **FR-003**: Plan items MUST show proposed action, source path, destination path when relevant, reason, protection state, and linked entity.
- **FR-004**: Permanent delete MUST require a destructive warning popup and explicit confirmation.
- **FR-005**: Plans MUST support reviewed, skipped, blocked, approved, applied, partially applied, and failed states or equivalent final vocabulary.
- **FR-006**: Plan apply MUST log every item outcome.
- **FR-007**: Failed plan apply MUST not leave ambiguous project or Inventory lifecycle state.
- **FR-008**: Archive destination paths MUST come from the token pattern builder.

### Key Entities

- **Cleanup Plan**: Reviewable set of proposed delete, ignore, or cleanup actions.
- **Archive Plan**: Reviewable set of proposed move/archive actions.
- **Plan Item**: One proposed filesystem operation.
- **Plan State**: Review and apply lifecycle state.
- **Destructive Confirmation**: Explicit user confirmation for permanent delete.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can inspect every planned filesystem mutation before approval.
- **SC-002**: No permanent delete happens without a warning popup.
- **SC-003**: Plan apply results are recoverable from logs and lifecycle events.

## Assumptions

- Cleanup/archive review can apply across projects and Inventory.
- Source protection affects plan approval.

## Out of Scope

- Cloud archive services.
- Background scheduled deletion.
