# Feature Specification: Router And URL State

> **UI Revised**: The UI design in this spec follows
> [Spec 030 — UI Audit & Revision](../030-ui-audit-revision/spec.md) and the
> merged **design-v4** implementation. Routes, navigation, and layout match the
> shipped app shell.
>
> **Rescoped 2026-06-10**: This spec was originally written against an earlier
> route surface (`/inventory`, `/plans`, `/welcome`, filters-as-the-only-purpose
> of URL state). Design-v4 restructured navigation. The spec is realigned to the
> shipped routes and **rescoped to the features that pay off in a local-first
> Tauri desktop app**: in-session **back/forward that restores filters +
> selection**, **multi-window** views, and **testability** (URL is the single
> source of truth for a ledger view). Web-only incentives are deferred — see
> *Out of Scope / Deferred*. Rationale recorded in
> `docs/development/autonomous-run-2026-06-decisions.md` (DV-006, D-007).

**Feature Branch**: `020-router-url-state`
**Created**: 2026-05-09
**Status**: Active (rescoped) — realigned to design-v4
**Input**: User description: "Specify routing and route state for the desktop
prototype and future app using TanStack Router." + 2026-06-10 rescope:
"implement back/forwards, multi-window, testability — the features that pay off
on desktop."

## Why desktop changes the calculus

This is a chromeless, local-first, single-user Tauri app. The classic web
motivations for URL-as-state are weak or absent here: there is **no address
bar** (users never see/copy/bookmark the URL), **no refresh button** (reloads
only on relaunch/crash/HMR), and **no sharing/SEO/server resolution**. The
motivations that *do* pay off on desktop, and that this spec targets, are:

1. **Back/forward that remembers filters + selection** — history entries carry
   the full view, so navigating back from a detail restores the exact list view.
2. **Multi-window** — a fully URL-described view can be opened in a second
   independent Tauri window.
3. **Testability / single source of truth** — a ledger view is deterministic to
   render from a route + typed search params; no filter/selection state hides in
   component-local `useState`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Navigate Predictably (Priority: P1) 🎯 MVP

As a user, I want every primary surface (Sessions, Inbox, Calibration, Targets,
Projects, Archive, Settings) to have a stable route, and my selection to live in
the URL, so navigation is reliable and refresh-safe.

**Independent Test**: Navigate each route, select an entity, reload; the same
page and the same selection are restored.

**Acceptance Scenarios**:

1. **Given** the user is on Projects with a project selected, **When** the app
   reloads, **Then** Projects is active and the same project is selected.
2. **Given** the user opens a detail path route `/sessions/$id`, **When** it
   loads, **Then** it normalizes to `/sessions?selected=$id` and focuses that
   session.
3. **Given** guided/programmatic navigation, **When** route changes are needed,
   **Then** it uses router navigation APIs, never manual hash mutation.

---

### User Story 2 - Back/Forward Restores Filters & Selection (Priority: P1)

As a user, I want my ledger filters and selected entity reflected in route/search
state so that the browser-style **back/forward** history restores my exact view,
and reload never loses context.

**Why this priority**: This is the primary desktop payoff — drilling into a
detail and going back must restore the filtered list and selection.

**Independent Test**: On a ledger page, apply filters and select an entity,
navigate elsewhere, press Back; confirm filters + selection are restored. Reload
and confirm the same.

**Acceptance Scenarios**:

1. **Given** Inbox is filtered by type and an item is selected, **When** the user
   navigates away and presses Back, **Then** the filter and selection are
   restored from the URL.
2. **Given** Projects is filtered by lifecycle, **When** the route reloads,
   **Then** the lifecycle filter remains active.
3. **Given** a selected entity no longer exists, **When** the route loads,
   **Then** selection clears (once, via `replace`), filters are preserved, and a
   useful empty detail is shown.

---

### User Story 3 - Graceful Stale-Id Fallback (Priority: P2)

As a user, I want a route that references a deleted/archived/unknown entity id to
recover gracefully so that stale deep links never strand me or throw.

**Independent Test**: Visit `/projects?selected=999999`, `/sessions/missing`,
`/inbox?selected=0`; confirm each clears selection, preserves filters, surfaces a
useful empty state, and never throws.

**Acceptance Scenarios**:

1. **Given** a deep link with `?selected=` referencing a missing entity, **When**
   the route loads, **Then** selection clears exactly once (`replace: true`), the
   filter params are preserved, and the empty detail renders.
2. **Given** a detail path route for an unknown id (`/sessions/missing`), **When**
   it loads, **Then** it normalizes to the ledger with no crash.
3. **Given** an unknown route segment, **When** the user lands on it, **Then** the
   app falls through to the index resolver without flashing a blank page.

---

### User Story 4 - Open View In A New Window (Priority: P3)

As a user, I want to open my current ledger view (route + filters + selection) in
a **second desktop window** so I can compare two entities or keep a reference
view while working in another.

**Why this priority**: Multi-window is a genuine desktop affordance that a fully
URL-described view unlocks for free; it replaces the web "shareable link" story.

**Independent Test**: From a ledger page with filters + selection applied, invoke
"Open in new window"; a new Tauri window opens at the same route + search and
renders the identical view, independently navigable.

**Acceptance Scenarios**:

1. **Given** Projects is filtered and a project is selected, **When** the user
   invokes "Open in new window", **Then** a new window opens at the same
   `/projects?...` URL showing the same filters + selection.
2. **Given** two windows are open, **When** the user navigates in one, **Then** the
   other is unaffected (independent histories).
3. **Given** the app runs outside Tauri (browser/dev), **When** "Open in new
   window" is invoked, **Then** it degrades gracefully (no crash; opens a tab or
   is hidden).

### Edge Cases

- Route references deleted or archived entity → US3.
- Setup wizard opens over a route (`/setup` is outside the shell).
- Search query contains special characters → must round-trip via encode/decode.
- Search params with unknown keys arrive from an older app version → dropped.
- Invalid value for a known typed key (not in its enum allow-list) → dropped.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST use TanStack Router for route definitions and
  navigation. *(met by design-v4)*
- **FR-002**: The desktop adapter MUST use hash history (`createHashHistory`).
  *(met)*
- **FR-003**: Navigation MUST use router APIs (`useNavigate`/`<Link>`), never
  manual `window.location.hash` writes.
- **FR-004**: Each ledger route's **selection and filters MUST live in URL search
  state**, not component-local `useState`. The route + search is the single
  source of truth for the view.
- **FR-005**: Each ledger route MUST declare its accepted search params via
  `validateSearch`. Unknown keys MUST be dropped silently (forward-compat).
  Invalid values of known typed keys MUST be dropped (v1: silently; an error
  banner is deferred polish).
- **FR-006**: Detail path routes (`/sessions/$id`, `/calibration/$id`,
  `/targets/$id`, `/projects/$id`) MUST normalize to the ledger route with
  `?selected=$id` rather than rendering a separate detail surface.
- **FR-007**: Invalid/stale `selected` ids MUST fail gracefully: clear `selected`
  from the URL once via `replace: true`, preserve the other params, render an
  empty detail. No uncaught errors.
- **FR-008**: The app MUST be able to **open the current route + search in a new
  desktop window** (Tauri `WebviewWindow`); each window is an independent
  instance. Outside Tauri the affordance MUST degrade gracefully.
- **FR-009**: Typed search params MUST be parsed/validated through a shared
  `route-contract.ts` (typed parsers + enum allow-lists sourced from
  `apps/desktop/src/bindings`), so validators are unit-testable in isolation.
- **FR-010**: Routing decisions MUST be documented in this spec and the
  decisions log.

### Key Entities

- **App Route**: Sessions, Inbox, Calibration, Targets, Projects, Archive,
  Settings, Setup, or future feature route.
- **Route Search State**: typed `selected` id + per-page filter keys + view
  options.
- **Route Contract**: the declared shape (path, params, search keys + types)
  every page obeys, defined once in `route-contract.ts`.
- **Window**: an independent Tauri webview rendering a route + search.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Primary navigation works without manual hash mutation.
- **SC-002**: Filters + selection reload from route state on every ledger route.
- **SC-003**: Back/forward restores the filtered + selected view.
- **SC-004**: 100% of declared ledger search-param keys round-trip through the
  URL (including special characters).
- **SC-005**: Zero uncaught errors on stale-id deep links across all ledger
  routes (smoke pass).
- **SC-006**: "Open in new window" reproduces the current view in a second
  window (or degrades cleanly outside Tauri).

## Implementation Status (design-v4 baseline)

`apps/desktop/src/app/router.tsx` uses TanStack Router with `createHashHistory`
and a single `Shell` root layout. Shipped routes:

| Path                  | Component        | Notes                                             |
|-----------------------|------------------|---------------------------------------------------|
| `/`                   | index resolver   | Redirects to `/setup` unless first-run complete.  |
| `/setup`              | `SetupPage`      | Standalone, outside the shell.                     |
| `/sessions`           | `SessionsPage`   | Default landing ledger.                            |
| `/sessions/$id`       | redirect         | → `/sessions?selected=$id`.                        |
| `/inbox`              | `InboxPage`      | Ledger.                                            |
| `/calibration`        | `CalibrationPage`| Ledger.                                            |
| `/calibration/$id`    | normalize        | → `/calibration?selected=$id`.                     |
| `/targets`            | `TargetsPage`    | Ledger.                                            |
| `/targets/$id`        | normalize        | → `/targets?selected=$id`.                         |
| `/projects`           | `ProjectsPage`   | Ledger.                                            |
| `/projects/$id`       | normalize        | → `/projects?selected=$id`.                        |
| `/projects/new`       | `WizardPage`     | New-project wizard.                                |
| `/archive`            | `ArchivePage`    | Ledger.                                            |
| `/settings`           | `SettingsPage`   | Section via `/settings/$pane`.                     |
| `/settings/$pane`     | `SettingsPage`   | Path param selects the active settings section.    |

### Search Param Keys (per ledger route)

All `selected` ids are **numbers** (fixture ids). Filter keys are typed enums
validated against allow-lists in `bindings`.

| Route          | Key        | Type                         | Purpose                         |
|----------------|------------|------------------------------|---------------------------------|
| `/sessions`    | `selected` | number?                      | Selected session id.            |
| `/sessions`    | `group`    | `none\|target\|month`?        | Grouping.                       |
| `/sessions`    | `state`    | `SessionState`?              | Session-state filter.           |
| `/inbox`       | `selected` | number?                      | Selected inbox item id.         |
| `/inbox`       | `type`     | `light\|dark\|flat\|bias`?    | Frame-type filter.              |
| `/inbox`       | `group`    | `none\|type\|date`?           | Grouping.                       |
| `/calibration` | `selected` | number?                      | Selected master id.             |
| `/calibration` | `kind`     | `CalibrationKind`?           | Kind filter.                    |
| `/targets`     | `selected` | number?                      | Selected target id.             |
| `/projects`    | `selected` | number?                      | Selected project id.            |
| `/projects`    | `lifecycle`| `ProjectState`? (csv)         | Lifecycle filter (multi).       |
| `/archive`     | `selected` | number?                      | Selected archived item id.      |

Each ledger page reads search state via `useSearch({ from })` and writes via
`useNavigate({ from })` with merged `search`. Unknown keys are dropped by the
per-route `validateSearch`. Stale `selected` ids clear once via `replace`.

## Assumptions

- TanStack Router remains the routing framework; hash history on desktop.
- Fixture ids are numeric and stable for the prototype.

## Out of Scope / Deferred

Deferred because the desktop context does not (yet) justify them; revisit if the
named trigger appears:

- **`?lib=<library_id>` scoping + cross-library refusal** (old FR-010/011) —
  only matters when links are shared across library contexts; a single library
  is open at a time. *Trigger: cross-library link sharing.*
- **"Copy shareable link" UX** — no address bar; "Open in new window" is the
  desktop analog. *Trigger: a notes/manifest feature (spec 024) that embeds
  jump-to-view links.*
- **Rust `url.resolve` use-case + `url.resolve` contract** — the frontend router
  owns routing; a Rust resolver only earns its keep for **OS deep-linking**
  (`astro-plan://…`). *Trigger: committing to OS deep links.*
- **`DeprecatedParamMap`** — no legacy param names exist against the fresh
  design-v4 routes.
- **Two-tier validator error banner** — v1 silently drops invalid known-key
  values; the banner is future polish.
- Server-side routing, public web deployment, auth-gated routes.
