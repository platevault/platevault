# Feature Specification: Inbox Mixed Folder Split

**Feature Branch**: `005-inbox-mixed-folder-split`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify how mixed folders are detected in Inbox, warned about, split into separate Inbox folders, and only then moved into Inventory."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Detect Mixed Folders (Priority: P1)

As a user scanning Inbox, I want folders that mix lights and calibration frames to be flagged so that mixed data cannot be silently added to Inventory.

**Why this priority**: Mixed folders break frame-type trust and downstream matching.

**Independent Test**: Scan a fixture folder containing lights and calibration frames and confirm it appears as mixed with a warning.

**Acceptance Scenarios**:

1. **Given** a folder contains multiple frame types, **When** scan completes, **Then** the Inbox row is marked as mixed.
2. **Given** a mixed row, **When** the user selects it, **Then** the detail panel explains why it cannot move directly to Inventory.

---

### User Story 2 - Split Mixed Folder Inside Inbox (Priority: P2)

As a user, I want to split a mixed Inbox folder into separate frame-type folders before moving them to Inventory.

**Why this priority**: The agreed workflow is to resolve mixed folders inside Inbox.

**Independent Test**: Select a mixed folder, split it, and confirm separate Inbox items are created for lights and calibration types.

**Acceptance Scenarios**:

1. **Given** a mixed folder is selected, **When** the user chooses Split, **Then** the app shows proposed frame-type groups.
2. **Given** the user confirms the split, **When** the operation completes, **Then** separate Inbox items exist and the original mixed row is resolved.

### Edge Cases

- Mixed folder contains unknown or unsupported files.
- Split destination names already exist.
- Split fails halfway.
- The folder is read-only or protected.

### Domain Questions To Resolve

- Does split physically move files inside Inbox or create logical sub-items first?
- Should split proposals be editable before applying?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Mixed folders MUST NOT be movable directly into Inventory.
- **FR-002**: Mixed folders MUST show a warning in the selected detail panel.
- **FR-003**: Users MUST be able to split mixed folders into frame-type groups inside Inbox.
- **FR-004**: Split operations that mutate the filesystem MUST use a warning/confirmation dialog.
- **FR-005**: Split failures MUST roll back partial changes where possible and log an error.
- **FR-006**: Split results MUST be reviewable as normal Inbox items.

### Key Entities

- **Mixed Inbox Item**: Folder candidate containing more than one frame type.
- **Split Proposal**: Proposed frame-type groups and destinations.
- **Split Result**: New Inbox items created by the split.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Mixed folders cannot enter Inventory without split resolution.
- **SC-002**: Users can split representative mixed fixture folders in under 2 minutes.
- **SC-003**: Failed splits leave no ambiguous Inventory records.

## Assumptions

- Frame type detection uses metadata where available and path/name hints otherwise.
- User confirmation is required before filesystem mutation.

## Out of Scope

- Automatic split without review.
- Moving split items directly into projects.
