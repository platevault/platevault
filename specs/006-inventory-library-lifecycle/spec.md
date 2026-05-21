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

## Implementation Status

The desktop mockup at `apps/desktop/src/features/inventory/InventoryPage.tsx`
already realises the visual and interaction shape of Inventory against the
mock store in `apps/desktop/src/data/store.ts` and `apps/desktop/src/data/mock.ts`.
Implementation for this spec moves the underlying data and state machine into
Rust crates and a portable contract; the UI shell does not need to change.

The following surfaces are already shipped in the mockup and serve as the
visual contract this spec ratifies:

- **Grouped ledger by source root**: `InventoryPage` groups sessions by
  `InventorySource.path`, with a per-group header showing `kind` and
  source `state` as meta text. This satisfies FR-005's "details only in
  the detail pane" constraint while exposing source identity at the group
  level instead of as a row column.
- **Frame-type filter**: A `Frame type` Select offers `light | dark | flat |
  bias | mixed` (FR-002). `mixed` is rendered in the filter to surface
  unclassifiable inputs without forcing premature split; the move-to-Inventory
  flow still blocks mixed folders per FR-009.
- **Review-state filter**: A `Review` Select offers `confirmed | needs_review
  | rejected`, sourced from `InventorySession.state`. State surfaces as a
  `StateLabel` row cell and a `State` fact in the drawer; no badge bubble
  shows alongside row content (FR-004).
- **Action-bound primary CTA**: The drawer's primary `Confirm` button only
  renders when the selected session is in `needs_review`. This is the
  action-bound review pattern defined in spec 002 — the CTA exists because
  the action is available, not as decoration.
- **Action-bound overflow**: `Re-open review` appears in the row/drawer
  overflow Menu only when the session is NOT in `needs_review`. `Reject
  session` is grouped in a separate Menu section with `tone: "danger"`. Both
  call `setSessionReviewState`, which is idempotent (re-applying the same
  state is a no-op in the store).
- **Source-state surfacing**: `InventorySource.state` (`active | missing |
  disabled | reconnect_required`) is rendered in the group meta line. The
  spec keeps "stale source" semantics aligned with `LibraryRoot.state` from
  spec 002's data model; surfacing them at the group header avoids polluting
  every row.

Phase 0 research, Phase 1 plan / data model / contracts, and Phase 2 tasks
treat the mockup as the visual and interaction contract. The Rust port keeps
hook signatures (`useInventorySources`, `setSessionReviewState`,
`getInventorySources`) intact so the component tree under
`apps/desktop/src/features/inventory/` is not touched by the migration.
