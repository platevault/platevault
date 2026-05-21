# Feature Specification: Generated Project Source View Removal

**Feature Branch**: `026-generated-project-source-view-removal`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify removing generated project source views and app-created links/folders without touching original Inventory data."

## Implementation Status: NOT IMPLEMENTED

This feature is specified only. No application code, persistence schema,
contract handlers, or UI surfaces have been written. The canonical project
database remains the source of truth; prepared source views are reproducible
projections and removing them MUST be reversible by regeneration.

### User Story 3 - Regenerate a Removed Source View (Priority: P2)

As a user, after removing a generated source view to free disk space, I want to
regenerate it from the canonical database so that the workflow remains
reproducible without re-importing inventory.

**Why this priority**: Removal is only safe if regeneration is cheap, reviewed,
and produces the same logical view.

**Independent Test**: Remove a view, then issue a regenerate request and confirm
a new plan is produced that re-creates the same item set from canonical sources.

**Acceptance Scenarios**:

1. **Given** a previously removed source view, **When** the user requests
   regeneration, **Then** a new filesystem plan is produced from the canonical
   database with the same logical item set.
2. **Given** the canonical inventory references have changed since removal,
   **When** the user regenerates, **Then** the plan reflects the current
   canonical state and flags any unresolved references.

### User Story 4 - Detect Stale Source Views (Priority: P3)

As a user, I want the app to detect when a generated source view has gone stale
(inventory moved, removed, or remapped) so that I can decide to remove or
regenerate it before it misleads downstream tools.

**Acceptance Scenarios**:

1. **Given** a source view references an inventory item that no longer resolves,
   **When** the project is opened, **Then** the view is marked stale with the
   broken reference visible.

### User Story 5 - Audit Source View Removal (Priority: P3)

Every view removal MUST emit per-item audit events covering attempted action,
outcome, and any failures, consistent with the constitution's reviewable
filesystem mutation principle.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Remove Generated Source Views (Priority: P1)

As a user, I want to remove generated project source views when a project is changed or cleaned up so that app-created links/folders do not linger.

**Why this priority**: Earlier 'Prepared Sources' wording represented generated workflow source views; removal needs a bounded spec with clear source-truth boundaries.

**Independent Test**: Generate project source views, remove them through a reviewed plan, and confirm original Inventory files remain untouched.

**Acceptance Scenarios**:

1. **Given** a project has generated source views, **When** the user creates a removal plan, **Then** only app-created links/folders are included.
2. **Given** the plan is applied, **When** removal succeeds, **Then** original Inventory files remain unchanged and project lifecycle records the removal.
3. **Given** a generated source view cannot be removed, **When** apply completes, **Then** the item is marked failed with retry context.

---

### User Story 2 - Distinguish Generated Views From Source Data (Priority: P2)

As a user, I want the UI to clearly distinguish generated project views from original data so that cleanup is safe.

**Why this priority**: The app must never make generated views look like canonical data.

**Independent Test**: Open project detail and confirm generated source views show their source Inventory references and generated state.

**Acceptance Scenarios**:

1. **Given** a generated source view exists, **When** it is shown in project detail, **Then** it references the Inventory item it projects.
2. **Given** a generated view is stale, **When** the project opens, **Then** the app indicates it needs regeneration or removal.

### Edge Cases

- Generated source view points through a symlink or junction.
- User manually deleted generated view outside the app.
- Generated view path conflicts with a user-owned folder.
- Removal plan includes both generated views and archive actions.

### Domain Questions To Resolve

- Which generated view strategies are supported at first release.
- Whether stale generated views are automatically included in cleanup plans.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Generated source views MUST be tracked separately from Inventory data.
- **FR-002**: Removal plans MUST include only app-created links/folders unless the user explicitly adds other reviewed items.
- **FR-003**: Removal MUST happen through filesystem plan review and apply.
- **FR-004**: Project detail MUST show generated source view state and source Inventory references.
- **FR-005**: Missing generated views MUST be marked missing or stale, not silently removed from history.
- **FR-006**: Removal outcomes MUST be logged per item.

### Key Entities

- **Generated Source View**: App-created link/folder/view used by a project workflow.
- **Source View Removal Plan**: Reviewable plan for removing generated views.
- **Generated View State**: Current, stale, missing, removed, or failed.
- **Source View Reference**: Link back to source Inventory item and project.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A removal plan can prove it will not touch original Inventory files.
- **SC-002**: Project detail clearly identifies generated views and their Inventory sources.
- **SC-003**: Missing or failed generated view removals remain visible until resolved.

## Assumptions

- Generated project source views replace the older user-facing "Prepared Sources" wording.
- Filesystem plan application handles the actual removal operation.

## Out of Scope

- Processing-tool execution.
- Deleting original source data without cleanup/archive review.
