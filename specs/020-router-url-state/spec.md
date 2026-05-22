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

---

### User Story 3 - Graceful Stale-Id Fallback (Priority: P3)

As a user, I want a route that references a deleted, archived, or unknown entity id to recover gracefully so that stale bookmarks and shared links never strand me.

**Why this priority**: Shared/exported links and old bookmarks will inevitably point at entities that have moved, been archived, or were never present in this library.

**Independent Test**: Visit `/inventory?id=does-not-exist`, `/plans/missing`, and `/projects?id=archived` and confirm each clears the selection, surfaces a useful empty/redirect state, and never throws.

**Acceptance Scenarios**:

1. **Given** a deep link to `/plans/$planId` for an unknown plan, **When** the route loads, **Then** the app shows a "plan not found" empty state with a link back to the plans list, and the URL is replaced with `/plans`.
2. **Given** a deep link with `?id=` referencing a deleted entity, **When** the route loads, **Then** the selection clears, the filter portion of the search is preserved, and the URL is cleaned up.
3. **Given** a route segment is unknown (e.g. `/unknown-route`), **When** the user lands on it, **Then** the app redirects to the index resolver and does not flash a blank page.

---

### User Story 4 - Export Shareable Links (Priority: P4)

As a user, I want to copy a link that captures my current ledger view (route + filters + selection) so that I can paste it into notes, tickets, or another machine running the same library.

**Why this priority**: Cross-machine link portability and note-pinning is a future affordance; the URL state pattern must already support it.

**Independent Test**: From any ledger page with filters and a selection applied, invoke "copy link", paste into a fresh app instance, and confirm the same view restores (subject to entity existence and library identity).

**Acceptance Scenarios**:

1. **Given** Inventory is filtered and an item is selected, **When** the user copies the link and pastes it into a new window, **Then** the same filters and selection are restored.
2. **Given** a link encodes a filter with a special character, **When** the link is decoded, **Then** the filter is restored without corruption.
3. **Given** a link is pasted into a library that does not contain the referenced entity, **When** the route loads, **Then** the filter portion still applies and the selection clears with a clear notice.
4. **Given** a link carries a `lib` param that differs from the currently-open library, **When** the route loads, **Then** the app refuses the link with the banner "This link is from a different library." and does not navigate.

### Edge Cases

- Route references deleted or archived entity.
- Setup wizard opens over a route.
- Guided flow needs to advance across routes.
- Search query contains special characters.
- Desktop hash history differs from future browser/web adapter.
- Search params with unknown keys arrive from older app versions.
- Library identity mismatch between exporter and importer of a link.

### Domain Questions To Resolve

- Which route search parameters are stable public app contract versus internal prototype state.
- Whether selected detail panes get nested routes or search parameters.
- Whether shared links should include a library identifier prefix.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST use TanStack Router for route definitions and navigation.
- **FR-002**: The desktop adapter MUST support hash history unless Tauri navigation later provides a better route base.
- **FR-003**: App navigation MUST use router links/navigation APIs, not manual hash writes.
- **FR-004**: Route state MUST support filters, selected entity ids, and guided flow progress where needed.
- **FR-005**: Route loaders or future data loading boundaries MUST preserve local-first behavior.
- **FR-006**: Invalid selected entity route state MUST fail gracefully.
- **FR-007**: Routing decisions MUST be documented in prototype and implementation specs.
- **FR-008**: Each ledger route MUST declare its accepted search params through `validateSearch`. Unknown keys MUST be dropped silently (forward-compat for older shared links). Invalid values of known keys MUST trigger an error banner and the param MUST be dropped from the URL.
- **FR-009**: Stale entity ids MUST clear from the URL when the entity is confirmed missing, preserving filters in the URL.
- **FR-010**: All internally generated links (from `<Link>` components and `useNavigate` call sites) MUST include a `?lib=<current_library_id>` search param.
- **FR-011**: When a link is resolved and its `lib` param does not match the currently-open library, the app MUST refuse the link and display an inline banner: "This link is from a different library." The resolution MUST NOT silently clear the selection.

### Key Entities

- **App Route**: Inbox, Inventory, Projects, Plans, Settings, Welcome, or future feature route.
- **Route Search State**: Filter, selected id, query, wizard/guide state, and view options.
- **Route Loader**: Future data boundary for local store reads.
- **Navigation Event**: Route transition relevant to guided flow or audit.
- **Route Contract**: The declared shape (path, params, search-param keys) every page must obey.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Primary navigation works without manual hash mutation.
- **SC-002**: Filters can be reloaded from route state.
- **SC-003**: Guided first-project flow can move between Inbox, Inventory, and Projects using router navigation.
- **SC-004**: 100% of declared ledger search-param keys round-trip through copy-paste of the current URL.
- **SC-005**: Zero uncaught errors on stale-id deep links in a smoke pass across all ledger routes.

## Implementation Status

The desktop mockup at `apps/desktop/src/app/router.tsx` already encodes the route surface this spec ratifies. It uses TanStack Router with a hash history (`createHashHistory`) and a single `Shell` root layout. The following routes are implemented and wired into the running app:

### Routes

| Path                    | Component         | Notes                                                                                  |
|-------------------------|-------------------|----------------------------------------------------------------------------------------|
| `/`                     | index resolver    | Redirects to `/welcome` or `/inventory` based on `alm.first-run.completed`.            |
| `/welcome`              | `WelcomePage`     | First-run guided entry.                                                                |
| `/inventory`            | `InventoryPage`   | Ledger; selection + filter via search params.                                          |
| `/inbox`                | `InboxPage`       | Ledger; selection + filter via search params.                                          |
| `/projects`             | `ProjectsPage`    | Ledger; selection + filter via search params.                                          |
| `/plans`                | `PlansListPage`   | Ledger; filter via search params.                                                      |
| `/plans/$planId`        | `PlanDetailPage`  | Path param for the plan id; no filters.                                                |
| `/settings`             | redirect          | Redirects to `/settings/$section` with `section = "data-sources"`.                     |
| `/settings/$section`    | `SettingsPage`    | Path param selects the active settings section.                                        |

### Search Param Keys (per page)

| Route        | Key         | Type     | Purpose                                            |
|--------------|-------------|----------|----------------------------------------------------|
| `/inventory` | `id`        | string?  | Selected inventory item id.                        |
| `/inventory` | `source`    | string?  | Filter by data source id.                          |
| `/inventory` | `frame`     | string?  | Filter by frame type.                              |
| `/inventory` | `reviewFilter` | string?  | Filter by review state (canonical key; was `review` — see DeprecatedParamMap). |
| `/inbox`     | `id`        | string?  | Selected inbox item id.                            |
| `/inbox`     | `type`      | string?  | Filter by inbox item type.                         |
| `/inbox`     | `source`    | string?  | Filter by source id.                               |
| `/projects`  | `id`        | string?  | Selected project id.                               |
| `/projects`  | `lifecycle` | string?  | Lifecycle filter (single or comma-list).           |
| `/projects`  | `tool`      | string?  | Tool filter.                                       |
| `/plans`     | `state`     | string?  | Plan state filter.                                 |
| `/plans`     | `origin`    | string?  | Plan origin filter.                                |

Each ledger page reads its search state through TanStack Router's `useSearch` and writes via `useNavigate({ from })` with merged `search` updates. Unknown keys are dropped by the per-route `validateSearch` helper. Stale selection ids today fall through to an empty detail pane rather than crashing.

### Deep-Linkable Scenarios

- `/inventory?frame=light&reviewFilter=needs-review` opens Inventory with frame and review filters applied.
- `/projects?lifecycle=processing&id=proj-123` opens Projects with the lifecycle filter and selection focused.
- `/plans/plan-2026-05-20-cleanup-001` opens a specific plan detail.
- `/settings/calibration` opens Settings on the calibration section.
- `/inbox?type=mixed&source=src-drive-a` opens Inbox filtered to mixed-folder items from a specific source.

## Assumptions

- TanStack Router remains the selected routing framework.
- TanStack Table handles table state and may sync selected state to the router.
- Every internal link carries `?lib=<library_id>` in v1; cross-library links are refused with a banner (see FR-010, FR-011).

## Out of Scope

- Server-side routing.
- Public web deployment routing.
- Authentication-gated routes.
