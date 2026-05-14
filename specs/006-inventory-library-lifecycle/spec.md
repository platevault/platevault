# Feature Specification: Inventory Lifecycle

**Feature Branch**: `006-inventory-library-lifecycle`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify the Inventory lifecycle, replacing Library tags/handling ambiguity with clear frame types, review state, source details, and consistent actions."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Move Reviewed Inbox Items To Inventory (Priority: P1)

As a user, I want Inbox items to become Inventory items through a clear move action so that accepted data is available for calibration and project workflows.

**Why this priority**: Inventory is the stable working library. It must not inherit ambiguous Inbox state.

**Independent Test**: Select a dark, bias, flat, and light from Inbox, move each to Inventory, and confirm they appear with frame type, source, session, review state, and actions.

**Acceptance Scenarios**:

1. **Given** an Inbox item has a single frame type, **When** the user moves it to Inventory, **Then** the Inventory item records frame type, source, session, and lifecycle event.
2. **Given** a mixed folder is selected, **When** the user tries to move it to Inventory, **Then** the app blocks the move and directs the user to split the folder in Inbox first.
3. **Given** an Inventory item is selected, **When** the detail pane opens, **Then** it shows selected item data only, in structured rows.

---

### User Story 2 - Confirm Inventory Metadata (Priority: P2)

As a user, I want to review and confirm Inventory metadata before using it in projects so that calibration and light matching decisions are explicit.

**Why this priority**: Project creation depends on reviewed source and calibration information.

**Independent Test**: Open an Inventory item, review its details, confirm it, and verify its review state changes without creating a badge-style bubble or a separate Handling field.

**Acceptance Scenarios**:

1. **Given** an Inventory item has inferred frame type or session data, **When** the user confirms it, **Then** the item records a reviewed decision.
2. **Given** an Inventory item is not confirmed, **When** it is offered for project selection, **Then** the UI indicates that review is still needed.
3. **Given** a user corrects metadata, **When** the correction is saved, **Then** the corrected value becomes the reviewed value and the inferred value remains traceable.

### Edge Cases

- Duplicate physical files discovered through different sources.
- Folder contains mixed lights and calibration frames.
- Inventory item source root is missing or moved.
- Metadata is incomplete, contradictory, or unavailable.
- User needs to open the item location in the native file browser.

### Domain Questions To Resolve

- Which Inventory review fields are mandatory before a project can reference an item?
- Which stale source conditions block project use versus only warn?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product name for the stable library surface MUST be "Inventory".
- **FR-002**: Inventory rows MUST include frame type filtering for light, dark, flat, bias, and dark flat where supported.
- **FR-003**: Inventory MUST NOT use ambiguous "tags" or "handling" fields as primary workflow controls.
- **FR-004**: Inventory MUST show review state as plain text or structured data, not as decorative state bubbles.
- **FR-005**: Inventory detail panes MUST show selected item details only.
- **FR-006**: Inventory actions MUST use the same primary action plus small More menu pattern as Inbox and Projects.
- **FR-007**: Open location MUST use the native OS file browser when the Tauri integration is available.
- **FR-008**: Inventory MUST preserve lifecycle references back to Inbox/source observations.
- **FR-009**: Mixed folders MUST be split before they can become Inventory items.

### Key Entities

- **Inventory Item**: Reviewed or reviewable source data available for calibration and project workflows.
- **Inventory Review State**: Needs review, confirmed, warning, blocked, or stale.
- **Frame Type**: Light, dark, flat, bias, or dark flat.
- **Source Reference**: Original configured source root and discovered path.
- **Inventory Lifecycle Event**: Move, review, correction, stale source, archive, or removal event.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can filter Inventory by frame type in one interaction.
- **SC-002**: A selected Inventory item can be understood from the detail pane without reading row descriptions.
- **SC-003**: Confirming sample dark, bias, flat, and light items supports the guided first-project flow.
- **SC-004**: No Inventory table column is named Tags or Handling.

## Assumptions

- Inventory is local-first and backed by SQLite.
- Source data remains externally owned unless a specific mutation plan is approved.

## Out of Scope

- Cleanup/archive execution.
- Target catalog lookup.
- Processing-tool execution.
