# Feature Specification: Generated Project Source View Removal

**Feature Branch**: `026-generated-project-source-view-removal`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify removing generated project source views and app-created links/folders without touching original Inventory data."

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
