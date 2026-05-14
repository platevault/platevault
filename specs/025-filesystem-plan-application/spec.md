# Feature Specification: Filesystem Plan Application

**Feature Branch**: `025-filesystem-plan-application`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify applying reviewed filesystem plans, including per-item outcomes, rollback where possible, progress, failures, and audit records."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Apply A Reviewed Plan (Priority: P1)

As a user, I want to apply a reviewed filesystem plan only after approval so that moves, archive actions, generated-resource cleanup, and deletes are deliberate.

**Why this priority**: Plan review is only useful if apply behavior is explicit and auditable.

**Independent Test**: Approve a plan with move, archive, remove generated source view, and skipped items; apply it and confirm per-item outcomes and lifecycle state.

**Acceptance Scenarios**:

1. **Given** a plan is not approved, **When** the user tries to apply it, **Then** the app blocks the operation.
2. **Given** a plan is approved, **When** the user applies it, **Then** each item shows progress and final outcome.
3. **Given** an item fails, **When** apply completes, **Then** the plan state is partially failed and successful items remain recorded.

---

### User Story 2 - Handle Failure Safely (Priority: P2)

As a user, I want failures during plan application to be logged and recoverable so that I can retry or adjust without losing track of what happened.

**Why this priority**: Filesystem operations can fail due to permissions, missing files, destination conflicts, or removable drives.

**Independent Test**: Apply a plan where one destination is blocked and confirm the app logs success/failure per item and keeps retry context.

**Acceptance Scenarios**:

1. **Given** a destination conflict appears during apply, **When** that item runs, **Then** the item fails with a reason and later items follow the plan policy.
2. **Given** rollback is possible for a failed operation, **When** rollback runs, **Then** rollback outcome is logged separately.
3. **Given** rollback is not possible, **When** apply ends, **Then** the app clearly marks manual recovery steps.

### Edge Cases

- Source path disappears after review.
- Destination path appears between review and apply.
- User cancels while apply is running.
- Permanent delete is included and requires confirmation.
- Some items are protected by source policy.

### Domain Questions To Resolve

- Default failure policy: stop on first failure or continue safe independent items.
- Which operations support automatic rollback.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Filesystem plans MUST require approval before apply.
- **FR-002**: Apply MUST show progress and per-item outcomes.
- **FR-003**: Apply MUST log request id, entity metadata, operation, and item outcome.
- **FR-004**: Permanent delete items MUST require destructive confirmation immediately before apply.
- **FR-005**: Failed items MUST retain retry context and failure reason.
- **FR-006**: Partial success MUST result in a clear partially applied/partially failed state.
- **FR-007**: Rollback attempts MUST be logged and may not be assumed to succeed.
- **FR-008**: Source protection MUST be enforced during apply, not only during plan generation.

### Key Entities

- **Approved Filesystem Plan**: Review object authorized for apply.
- **Plan Apply Run**: One execution attempt against a plan.
- **Plan Item Outcome**: Success, skipped, blocked, failed, rolled back, or manual recovery needed.
- **Rollback Outcome**: Result of any attempted reversal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can reconstruct every applied filesystem operation from the plan apply record.
- **SC-002**: Partial failures never leave the plan with an ambiguous final state.
- **SC-003**: Protected-source delete attempts are blocked or confirmed according to source policy.

## Assumptions

- Plan generation and review are covered by cleanup/archive review plans.
- The app can record audit events even if filesystem mutation fails.

## Out of Scope

- Background scheduling.
- Remote filesystem operations.
