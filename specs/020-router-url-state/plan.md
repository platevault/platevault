# Implementation Plan: Router And URL State

**Branch**: `020-router-url-state` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/020-router-url-state/spec.md`

## Summary

The desktop app uses TanStack Router with code-based route definitions and a
hash history adapter to support Tauri's `file://` origin. Each ledger route
declares its accepted search params through `validateSearch`, the index route
acts as a first-run resolver, and Settings uses a path-param section. URL state
captures filters and selection ids so workflows are reloadable, shareable, and
restorable. This plan ratifies the mockup at `apps/desktop/src/app/router.tsx`
as the desktop surface and defines the `RouteContract` interface every page
must implement before promotion.

## Technical Context

**Language/Version**: TypeScript 5.x (desktop)  
**Primary Dependencies**: `@tanstack/react-router`, `@tanstack/react-table` (table state sync), React 18, Tauri 2.x (host shell)  
**Storage**: URL hash carries route + search state; no backend persistence for the route layer itself.  
**Testing**: Vitest for `validateSearch` shape checks; Playwright MCP for in-app navigation and refresh smoke; future contract tests for `url.resolve`.  
**Target Platform**: Desktop (Tauri shell on Windows/macOS/Linux). Future web adapter is anticipated but not in scope.  
**Project Type**: Desktop application; single SPA entry point.  
**Performance Goals**: Route transitions feel synchronous (<16ms re-render budget); search-param merges do not retrigger ledger data loads when only selection changes.  
**Constraints**: Tauri loads from `file://` so a hash history is mandatory until a custom protocol is adopted. Routes must be statically declarable at build time to keep cold start fast.  
**Scale/Scope**: 9 declared routes today; up to ~20 in the v1 horizon.

## Constitution Check

- **Local-first file custody**: PASS. Route state references entity ids, never raw file paths. Library roots remain modeled by data layers.
- **Reviewable filesystem mutation**: PASS. The router does not perform filesystem mutations; it only routes to pages that, where applicable, present reviewable plans.
- **PixInsight boundary**: N/A. Routing does not touch image processing.
- **Research-led domain modeling**: PASS. Hash vs history mode, URL vs component state, and stale-id behavior are decided in `research.md` rather than assumed.
- **Portable contracts and durable records**: PASS. The `url.resolve` contract is a language-neutral JSON Schema describing the entity-resolution boundary; the route table itself is captured as a typed `RouteContract` so future adapters can mirror it.
- **Cross-platform path safety**: N/A for the router layer; path params are entity ids, not filesystem paths.

## Project Structure

### Documentation (this feature)

```text
specs/020-router-url-state/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── url.resolve.json
└── tasks.md
```

### Source Code (repository root)

```text
apps/desktop/src/
├── app/
│   ├── router.tsx                  # TanStack Router definition, hash history, validateSearch
│   └── Shell.tsx                   # Root layout
├── features/
│   ├── inventory/InventoryPage.tsx
│   ├── inbox/InboxPage.tsx
│   ├── projects/ProjectsPage.tsx
│   ├── plans/PlansListPage.tsx
│   ├── plans/PlanDetailPage.tsx
│   ├── settings/SettingsPage.tsx
│   └── welcome/WelcomePage.tsx
└── lib/
    └── route-contract.ts           # future: shared RouteContract typing + helpers

packages/contracts/
└── url/
    └── url.resolve.json            # mirrored from specs/.../contracts/

crates/
└── app/core/usecases/url_resolve.rs # future: backend resolver for url.resolve contract
```

**Structure Decision**: Routing lives entirely in the desktop edge. The
`RouteContract` is exported from `apps/desktop/src/lib/route-contract.ts` so
all ledger pages share one shape definition. A backend-side `url.resolve`
use-case is reserved for entity resolution when shared links arrive but is not
required for v1 navigation.

## Architecture

### Routing Framework

TanStack Router with code-based (not file-based) route definitions. Code-based
routes were chosen because the route surface is small and bounded, and because
explicit registration makes the route table easy to audit against the spec.
Routes are composed under a single `rootRoute` whose component renders the
`<Shell>` layout with an `<Outlet>`.

### History Mode

`createHashHistory()` is the only supported history adapter for the desktop
shell. Tauri loads the SPA from a `file://` origin (or a custom `tauri://`
scheme), which makes HTML5 history unreliable across navigation, reload, and
external open events. The hash adapter keeps refresh-safety and link
portability while sidestepping origin quirks. A future browser/web adapter can
swap to `createBrowserHistory()` behind a feature flag once a real HTTP origin
exists.

### Route Validation

Every ledger route declares `validateSearch(search) => Shape`. The validator
narrows `Record<string, unknown>` to the page's typed shape and drops unknown
keys. Today the desktop uses a thin `parseId(value)` helper for string-or-undef
keys; the plan promotes this to a shared `parseSearch` utility per type
(string, enum, csv-list) under `apps/desktop/src/lib/route-contract.ts`.
Invalid values fall back to `undefined` and the route loads with the bad
fragment removed from the URL on first commit.

### URL State Pattern

Ledger pages express filters and selection through search params, not
component state. The contract:

1. `useSearch({ from: route.id })` returns the typed shape.
2. `useNavigate({ from: route.id })` is called with `{ search: prev => ({ ...prev, key: nextValue }) }` for updates.
3. Setting a value to `undefined` removes the key from the URL.
4. Pages MUST NOT mirror search state into local `useState`; derived state only.
5. Selection (`id`) and filter keys are merged into one search object; the route does not split selection into a sub-route in v1.

Detail panes for selected entities remain in-page (selection-as-search-param),
not nested routes. Nested routes are reserved for cases where the detail view
needs its own data boundary (e.g. plan detail) and changes the layout shape.

### Index Resolver

`/` is a component-only route that checks
`localStorage.getItem("alm.first-run.completed") === "1"` and issues a
`<Navigate replace>` to either `/welcome` or `/inventory`. The resolver MUST
NOT read any backend state because it runs before the data layer is ready.
First-run completion is a desktop-only signal and remains in localStorage.

### Stale-Id Handling

A selected entity id that no longer exists is treated as "selection clears,
filters keep". The page is responsible for issuing one
`navigate({ search: prev => ({ ...prev, id: undefined }), replace: true })`
when its data layer confirms the id is missing. The URL is rewritten with
`replace: true` so the browser/back-stack does not accumulate dead entries.
Plan detail (`/plans/$planId`) instead renders a "not found" empty state and
offers a link back to `/plans`; it does not auto-redirect because the user may
want to copy the bad id for support.

### Guided Flow Integration

The first-project guide drives transitions through `useNavigate`. The guide
never mutates `window.location.hash`. Cross-route progress is encoded in
durable state outside the URL (see spec 010 guided flow); the router only
carries the current page and its filters/selection.

### Shareable Link Boundary

The `url.resolve` contract is the backend-side entry point a future "open
shared link" affordance will call. It accepts a link, parses route + search
shape, and reports whether each referenced entity (path-param or `id` search
key) exists in the current library. The desktop uses the response to (a) jump
to the target route with filters preserved and (b) decide whether to clear or
keep selection. The contract is defined now to lock the boundary even though
the consumer ships later.

## Complexity Tracking

No constitution violations.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    |            |                                      |
