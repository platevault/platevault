# Feature Specification: Guided First Project Flow

**Feature Branch**: `010-guided-first-project-flow`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify the guided first-step flow that uses real UI actions to move sample Inbox placeholders into Inventory, confirm them, and create the first project."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Move Sample Items To Inventory (Priority: P1)

As a new user, I want guided first-step hints to walk me through selecting and moving sample darks, bias, flats, and lights from Inbox to Inventory.

**Why this priority**: The first useful learning loop is understanding Inbox-to-Inventory promotion.

**Independent Test**: Start guided first steps after setup, scan Inbox, and complete the darks, bias, flats, and lights move steps using real UI actions.

**Acceptance Scenarios**:

1. **Given** guided first steps are active, **When** the user scans Inbox, **Then** sample placeholders appear for darks, bias, flats, and lights.
2. **Given** a sample item is selected, **When** the user clicks Move to Inventory, **Then** that item appears in Inventory and the guide advances.

---

### User Story 2 - Confirm Inventory Items (Priority: P2)

As a new user, I want the guide to make me inspect and confirm each moved item so that Inventory confirmation is explicit.

**Why this priority**: Confirmation is central to app safety and source truth.

**Independent Test**: Complete the Inventory steps for darks, bias, flats, and lights and verify each selected detail panel is shown before confirmation.

**Acceptance Scenarios**:

1. **Given** a guided Inventory item exists, **When** the user selects it, **Then** the guide records the verify step.
2. **Given** the item is selected, **When** the user confirms it, **Then** the guide advances to the next item.

---

### User Story 3 - Create First Project (Priority: P3)

As a new user, I want the guide to walk me through creating the first project from the confirmed items.

**Why this priority**: The first project proves that source confirmation enables project setup.

**Independent Test**: Complete the Projects guided steps through project info, lights/flats, calibration, and final creation.

**Acceptance Scenarios**:

1. **Given** confirmed lights, flats, darks, and bias exist, **When** the user opens Add project, **Then** the guide points through each setup step.
2. **Given** project setup is complete, **When** the user creates the project, **Then** the project appears in Projects and references selected sources.

### Edge Cases

- Inbox is empty before guide scan.
- User skips guided hints after setup.
- User navigates away mid-step.
- User has already moved or confirmed a guided item.
- Sample placeholders conflict with real user records.

### Domain Questions To Resolve

- Should sample placeholders be persisted as demo records or ephemeral guide-only records?
- How should guided actions be reset after restarting setup?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Guided first steps MUST be optional and skippable at the first hint.
- **FR-002**: Guided first steps MUST use real UI actions, not mock buttons.
- **FR-003**: The guide MUST include separate darks, bias, flats, and lights placeholder items.
- **FR-004**: The guide MUST require item selection before move or confirm actions.
- **FR-005**: The guide MUST move selected Inbox items into Inventory.
- **FR-006**: The guide MUST confirm each moved Inventory item separately.
- **FR-007**: The guide MUST walk through first project setup after confirmation.
- **FR-008**: The guide MUST recover when a guided item was already completed.

### Key Entities

- **Guided Placeholder**: A sample dark, bias, flat, or light item used for onboarding.
- **Guide Step**: A target UI element and completion event.
- **First Project Draft**: Project setup state created during onboarding.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can complete the full guided flow from setup completion to first project creation without reading external docs.
- **SC-002**: Each guide step advances only after the corresponding real UI action occurs.
- **SC-003**: The guide can be skipped without leaving orphaned sample records.
- **SC-004**: The flow works after setup wizard restart.

## Assumptions

- The setup wizard has completed or was skipped before guided first steps begin.
- Sample placeholders are safe and do not represent real filesystem mutations.

## Out of Scope

- Full tutorial content.
- Processing images.
- Permanent demo data import.
