# Implementation Plan: Guided First Project Flow

**Feature**: 010-guided-first-project-flow
**Status**: Draft (planning only; no implementation)
**Depends On**: spec 003 (first-run setup wizard), spec 008 (project create),
spec 002 (data lifecycle state model)

## Constitution Check

- **I. Local-First File Custody**: The coach reads only existing app state and
  events. It does not touch image files, does not seed demo files, and does not
  mutate the filesystem. Pass.
- **II. Reviewable Filesystem Mutation**: The coach issues no filesystem plans.
  Any user action it points at goes through the normal reviewable plan path.
  Pass.
- **III. PixInsight Boundary**: The "open in tool" step uses the existing
  tool-open contract from the workflow profile; the coach observes the event
  rather than driving processing. Pass.
- **IV. Research-Led Domain Modeling**: Overlay UX, trigger taxonomy, and
  completion event sourcing are recorded in `research.md` before code lands.
  Pass.
- **V. Portable Contracts and Durable Records**: Coach state is exposed via the
  three JSON Schema contracts in `contracts/`. The desktop UI is the first
  adapter; a future remote adapter can read the same surface. Pass.

## Architecture Overview

The coach is a thin UI layer over a small state machine. It owns no domain
data; it only mirrors lifecycle and inventory events into step transitions and
renders overlay hints anchored to existing controls.

### Components

- `crates/app/core/guided_flow/`: state machine, step registry, persistence
  port, event subscriptions. Pure Rust; depends on `crates/domain/core` and
  `crates/audit` event types only.
- `crates/persistence/db/guided_flow_repo`: SQLite-backed durable record of
  completed step ids, current step pointer, and dismissed-at timestamp.
- `crates/contracts/core/guided/`: Rust DTOs for `guided.state.get`,
  `guided.step.complete`, and `guided.dismiss` contracts.
- `apps/desktop/src/features/guided/`: React overlay layer. Wraps a
  [react-joyride v3](https://github.com/gilbarbara/react-joyride) instance in
  controlled mode via the `useJoyride()` hook. Steps mirror the state machine
  below. Step content (text, anchor selector, primary action) is declared in
  a `GuidedFlowStep` registry. Joyride handles focus management, scroll-into-
  view, spotlight cutouts (`spotlightClicks: true` keeps the underlying UI
  interactive), and dismissal callbacks. Joyride does its own positioning and
  renders into a portal, so it composes cleanly with Base UI's Floating-UI-
  backed popovers without z-index or stack conflicts. Route-aware anchor
  resolution, hint renderer wiring, and the Settings restart entry live in
  this folder. (Library decision and license rationale: see
  `research.md` §R1; Shepherd was set aside because of its AGPL-or-commercial
  relicense.)

### State Machine

```
Idle → Active(current_step) → Active(next_step) → ... → Completed
                  │
                  └──► Dismissed (terminal until user restarts)
```

Transitions:

- `setup_completed` (from spec 003): `Idle → Active(first uncompleted step)`.
- `completion_event(step.id)` for current or any earlier step:
  `Active(step) → Active(next uncompleted step)`; on no more steps,
  `→ Completed`.
- `dismiss`: `Active(_) → Dismissed`.
- `restart` (from Settings):
  - `Dismissed → Active(lowest uncompleted)`: resumes at the lowest uncompleted
    step; previously completed steps remain completed.
  - `Completed → Idle`: resets all progress and replays from step 1.
    This is in-scope for v1 (A1 ratified 2026-05-22).

### Event Bus

The coach subscribes to the existing lifecycle event bus published by
`crates/domain/core`. Topic names use dot-notation lowercase (project
convention per trigger-taxonomy decision C, 2026-05-22):

- `inventory.confirmed` → completes step `inbox.confirm_first`.
- `project.created` → completes step `project.create_first`.
- `tool.opened` → completes step `tool.open_first`.

Each event envelope carries a `source: enum("user", "restore", "system")`
field (spec 002 §6 R-Source-1). The guided-flow subscriber MUST filter
`source != "restore"`: replay events from audit-log recovery MUST NOT
advance coach steps.

The coach does not synthesize events. It listens. If an event arrives before
the coach is active (because the user moved fast or because the coach is
dismissed), the step is still recorded as completed on the next state load.

### Overlay Hints

Hints are React portals anchored to DOM nodes selected by a stable
`data-guide-anchor` attribute. The renderer:

- Resolves the anchor for the current step on the current route.
- If absent, parks the hint as "deferred" with a small route-pointer
  indicator instead of pointing at nothing.
- Never blocks pointer events on the underlying control.
- Provides a single dismiss affordance per hint that routes to
  `guided.dismiss`.

### Persistence

Single row table `guided_flow_state` with columns: `current_step_id`,
`completed_step_ids` (JSON array), `dismissed_at` (nullable ISO timestamp),
`updated_at`. Read on app start, written on every transition.

### Contracts

- `guided.state.get`: read current state for UI hydration.
- `guided.step.complete`: explicit completion path for cases where the event
  bus is not the source of truth (e.g. Settings "mark complete" diagnostic).
- `guided.dismiss`: dismiss the coach.

## Phases

- **Phase 0 - Research**: complete `research.md` decisions on overlay UX,
  trigger taxonomy, completion sourcing, persistence shape, and optionality.
- **Phase 1 - Design**: lock `data-model.md` and `contracts/` JSON Schemas;
  re-run constitution check.
- **Phase 2 - Tasks**: produce `tasks.md` grouped by user story priority.
- **Phase 3 - Implementation**: only after upstream specs 003 and 008 land.

## Risks

- Anchor drift: UI changes can move or rename anchors. Mitigation: centralize
  `data-guide-anchor` constants and lint for orphans.
- Event misfire: a stray `InventoryConfirmed` from background reconciliation
  could prematurely complete P1. Mitigation: require the event payload to be
  tied to a user-initiated action id sourced by the UI command path.
- Restart vs reset confusion: restart resumes; users may expect reset.
  Mitigation: research decision documents wording and Settings copy.
