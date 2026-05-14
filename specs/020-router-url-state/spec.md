# Feature Specification: Router And URL State

**Feature Branch**: `020-router-url-state`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify routing and route state for the desktop prototype and future app using TanStack Router."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navigate Predictably (Priority: P1)

As a user, I want Inbox, Inventory, Projects, Settings, and framework review pages to have stable routes so that navigation, guided flows, and future deep links are reliable.

**Why this priority**: Routing was moved to TanStack Router and should remain a first-class app structure.

**Independent Test**: Navigate each primary route, refresh the app, and confirm the same page and relevant route state are restored.

**Acceptance Scenarios**:

1. **Given** the user navigates to Inventory, **When** the app refreshes, **Then** Inventory remains active.
2. **Given** the user opens a project detail route or selected project state, **When** the route is shared or restored, **Then** the same project can be reopened if it still exists.
3. **Given** guided first steps are active, **When** route changes are required, **Then** the guide uses route navigation rather than manual hash mutation.

---

### User Story 2 - Persist Workflow Filters In Route State (Priority: P2)

As a user, I want important filters and selected entities to be reflected in route/search state so that workflow context can be restored.

**Why this priority**: Tables need consistent route-aware filtering and selection behavior.

**Independent Test**: Apply frame type filter, lifecycle multiselect, and selected item/project id, then reload and confirm state restoration.

**Acceptance Scenarios**:

1. **Given** Inventory is filtered by frame type, **When** the route reloads, **Then** the filter remains active.
2. **Given** Projects are filtered by multiple lifecycle states, **When** the route reloads, **Then** the multiselect state remains active.
3. **Given** a selected entity no longer exists, **When** the route loads, **Then** the app clears selection and shows a useful empty state.

### Edge Cases

- Route references deleted or archived entity.
- Setup wizard opens over a route.
- Guided flow needs to advance across routes.
- Search query contains special characters.
- Desktop hash history differs from future browser/web adapter.

### Domain Questions To Resolve

- Which route search parameters are stable public app contract versus internal prototype state.
- Whether selected detail panes get nested routes or search parameters.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST use TanStack Router for route definitions and navigation.
- **FR-002**: The desktop adapter MUST support hash history unless Tauri navigation later provides a better route base.
- **FR-003**: App navigation MUST use router links/navigation APIs, not manual hash writes.
- **FR-004**: Route state MUST support filters, selected entity ids, and guided flow progress where needed.
- **FR-005**: Route loaders or future data loading boundaries MUST preserve local-first behavior.
- **FR-006**: Invalid selected entity route state MUST fail gracefully.
- **FR-007**: Routing decisions MUST be documented in prototype and implementation specs.

### Key Entities

- **App Route**: Inbox, Inventory, Projects, Settings, Framework Review, or future feature route.
- **Route Search State**: Filter, selected id, query, wizard/guide state, and view options.
- **Route Loader**: Future data boundary for local store reads.
- **Navigation Event**: Route transition relevant to guided flow or audit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Primary navigation works without manual hash mutation.
- **SC-002**: Filters can be reloaded from route state.
- **SC-003**: Guided first-project flow can move between Inbox, Inventory, and Projects using router navigation.

## Assumptions

- TanStack Router remains the selected routing framework.
- TanStack Table handles table state and may sync selected state to the router.

## Out of Scope

- Server-side routing.
- Public web deployment routing.
