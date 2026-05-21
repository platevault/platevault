# Feature Specification: Project Lifecycle Model

**Feature Branch**: `009-project-lifecycle-model`  
**Created**: 2026-05-09  
**Status**: Draft  
**Input**: User description: "Specify project lifecycle state, project detail structure, actions by phase, and cleanup/archive readiness without ambiguous Plan columns or unexplained top action strips."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See Project State And Next Actions (Priority: P1)

As a user, I want each project to show its lifecycle state and available actions in a consistent way so that I know whether to review, prepare, open, process, archive, or clean up.

**Why this priority**: The project list must communicate useful workflow state without unclear columns such as "Plan".

**Independent Test**: Create projects in draft, ready, prepared, active processing, completed, archived, and blocked states and confirm each shows a plain state label, source summary, and phase-appropriate actions.

**Acceptance Scenarios**:

1. **Given** a project is missing required sources, **When** it appears in the project list, **Then** its state indicates that setup is incomplete and actions focus on editing the project.
2. **Given** a project has reviewed sources, **When** it appears in the project list, **Then** its state indicates it is ready to open or prepare.
3. **Given** a project has cleanup/archive candidates, **When** it is selected, **Then** the detail pane shows lifecycle information and cleanup/archive plan links.

---

### User Story 2 - Inspect Project Detail (Priority: P2)

As a user, I want the project side panel and opened project view to show structured details, sources, channels, lifecycle events, and actions so that I can manage the project without duplicated row text.

**Why this priority**: The user called the previous side panel chaotic and overlapping.

**Independent Test**: Select a project with multiple light sessions, flats, darks, bias, and generated outputs; confirm the detail pane uses structured rows and expandable sections.

**Acceptance Scenarios**:

1. **Given** a project is selected, **When** the detail pane opens, **Then** it shows project fields in a structured table-like layout.
2. **Given** sources are listed under a project, **When** the user clicks a source, **Then** the app opens the linked Inventory item.
3. **Given** channels or generated views exist, **When** the user expands the relevant section, **Then** details are shown without layout overlap.

### Edge Cases

- Project source becomes stale or missing.
- Generated prepared source is out of date.
- Processing-tool path is not configured.
- Cleanup/archive plan exists but is not reviewed.
- Project was onboarded from an existing folder with partial markers.

### Domain Questions To Resolve

- Final project lifecycle states and transitions.
- Which actions are available in each lifecycle phase.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Project lifecycle state MUST be a domain field, not a decorative badge-only UI treatment.
- **FR-002**: Project rows MUST NOT use an ambiguous "Plan" column unless it is explicitly a cleanup/archive plan count or link.
- **FR-003**: Project actions MUST be phase-aware and use the shared primary action plus More menu pattern.
- **FR-004**: The project surface MUST NOT show unexplained top action strips such as Candidate, Source mapping, Prepared, or Processing when those states are already represented by project data.
- **FR-005**: Project details MUST list sources directly.
- **FR-006**: Clicking a source in a project MUST navigate to or open the linked Inventory item.
- **FR-007**: Project detail layout MUST use structured rows and expandable sections for channels, generated views, lifecycle events, and plans.
- **FR-008**: Lifecycle transitions MUST be logged and auditable.
- **FR-009**: Blocked states MUST identify the blocking reason and the action that resolves it.

### Key Entities

- **Project Lifecycle State**: Setup incomplete, ready, prepared, processing, completed, archived, blocked, or other final planned state.
- **Project Action**: Open, edit, open in tool, prepare, archive review, cleanup review, or delete/remove where allowed.
- **Project Source**: Inventory link used by the project.
- **Generated View**: Prepared source or tool-specific projection derived from Inventory.
- **Project Lifecycle Event**: State transition, source change, processing artifact observation, plan creation, or failure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify why a project is blocked from the row and detail pane.
- **SC-002**: Users can open any project source directly from project details.
- **SC-003**: The project detail pane has no duplicated row description content.
- **SC-004**: State filtering supports multiselect for lifecycle states.

## Assumptions

- The exact final lifecycle vocabulary may be refined during implementation planning.
- Project source links reference Inventory items.

## Out of Scope

- Running processing tools.
- Full cleanup/archive execution.
- Cloud synchronization.

## Implementation Status

**Mockup-implemented (apps/desktop):**

- Seven Project lifecycle states (`setup_incomplete`, `ready`, `prepared`,
  `processing`, `completed`, `archived`, `blocked`) are modeled in
  `apps/desktop/src/data/mock.ts` (`ProjectLifecycle`, `projectLifecycleSteps`,
  `lifecycleLabel`, `lifecycleTone`).
- Canonical transition graph lives in `apps/desktop/src/data/store.ts` as
  `PROJECT_TRANSITIONS`, with `isProjectTransitionAllowed` guarding the edge
  table and `setProjectLifecycle(id, next, actionLabel?)` writing the new
  state, deriving a default action label, and emitting an audit log line.
- Project drawer renders the stepper at the top of `ProjectsPage.tsx`, with
  contextual footer actions per lifecycle (`projectFooter`):
  - `setup_incomplete`: Continue setup, Edit, overflow.
  - `ready`/`prepared`: Open in {tool}, Mark as Processing, overflow.
  - `processing`: Open in {tool}, Mark as Completed, overflow.
  - `completed`: Open in {tool}, Generate cleanup plan (if sources remain),
    overflow.
  - `archived`: Unarchive (primary, re-enters via `processing`), read-only
    notice.
  - `blocked`: Resolve blocker, Edit, overflow.
- Row overflow surfaces phase-appropriate actions through
  `rowMenuGroupsForLifecycle`. Archived rows expose only View (read-only),
  Reveal manifest folder, and Unarchive.
- `lastAction { label, when }` is recorded on every successful transition and
  surfaced in row, drawer header, and detail table.

**Transition graph (canonical edges):**

| From               | Allowed `to`                                            |
| ------------------ | ------------------------------------------------------- |
| `setup_incomplete` | `ready`, `blocked`                                       |
| `ready`            | `prepared`, `processing`, `blocked`                      |
| `prepared`         | `ready`, `processing`, `blocked`                         |
| `processing`       | `completed`, `blocked`                                   |
| `completed`        | `archived`, `processing` (re-open)                       |
| `archived`         | `processing` (Unarchive)                                 |
| `blocked`          | `ready`, `prepared`, `processing`, `setup_incomplete`    |

Forbidden: `processing → ready` (would lie about progress); `archived →
completed` (no implicit re-completion); any direct skip past `setup_incomplete`
into `prepared` or later without passing `ready`.

**Surface behavior (FR alignment):**

- FR-001/FR-002: Lifecycle is a domain field rendered as a labeled stepper;
  rows display state via `StateLabel`/`lifecycleTone` rather than a
  decorative-only badge. No ambiguous "Plan" column appears in the project
  table; plan counts/links are scoped to detail expandable rows.
- FR-003: Footer uses the shared primary + secondary + overflow pattern.
- FR-004: Phase-only top-action strips are removed; the stepper plus footer
  carries all phase context.
- FR-005/FR-006: Project detail enumerates sources with inventory deep-links.
- FR-007: Channels, plans, manifests, lifecycle events render as expandable
  sections.
- FR-008: Every transition appends an audit log entry; full auditing routes
  through spec 002's `lifecycle.transition` contract.
- FR-009: `Project.blockedReason?` and a resolve-action label identify the
  unblock path.

**Deferred to implementation (post-mockup):**

- Auto-`blocked` detection (missing inventory link, stale prepared source,
  unconfigured tool path). The mockup permits only user-triggered transitions.
- Filesystem mutation on `ready → prepared` and on cleanup generation flows
  through spec 017 (filesystem plan) / spec 025; `setProjectLifecycle` is a
  pure state write in the mockup.
- Cross-spec audit fan-out via the persistence boundary
  (`crates/persistence/db/`).
