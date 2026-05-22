# Research: Guided First Project Flow

**Feature**: 010-guided-first-project-flow
**Status**: Draft

This document captures the research decisions needed before the coach can be
designed in detail. Each decision lists the options considered, the chosen
default, and the open variables for project-level configuration.

## R1. Coach UX Surface: Overlay, Sidebar, Or Tooltip

**Options**:

- **Overlay popover** anchored to a DOM element via portal, with a callout
  pointer and dismiss control.
- **Persistent sidebar** that lists all steps and current focus.
- **Native tooltip** attached to the target element.

**Decision**: Overlay popover, implemented with [Shepherd](https://github.com/shipshapecode/shepherd)
backed by [Floating UI](https://github.com/floating-ui/floating-ui) for anchor
positioning.

**Why**: The overlay can be repositioned per route, does not consume layout
real estate, and can defer gracefully when the anchor is absent. A sidebar
duplicates information visible in Settings and breaks responsive layout for
narrow desktop windows. Tooltips depend on hover and are not discoverable from
keyboard for accessibility.

**Library choice rationale**: Shepherd is the canonical product-tour library
for web apps — it provides step navigation, focus management, scroll-into-view,
spotlight cutouts, and dismissal hooks out of the box. Building these from
scratch would duplicate well-understood UX primitives. Shepherd v12+ uses
Floating UI internally for anchor positioning, which is the same engine Base
UI (spec 022) uses for popover/tooltip positioning — so the entire app shares
one positioning runtime. This avoids two competing implementations of collision
detection, flip behavior, and arrow placement.

**Integration boundary**: `crates/app/core/guided_flow/` emits step transitions;
the React layer (`apps/desktop/src/features/guided/`) wires those transitions
to a `Shepherd.Tour` instance. Step content (text, anchor selector, primary
action) is rendered via Shepherd's step API. Anchor selectors come from a stable
`data-guided-anchor` attribute convention on the underlying UI elements
(documented at the touch points in `apps/desktop/`; see R6 for missing-anchor
behavior).
Dismissal and step completion are reported back through the guided state
contracts.

**Open variables**: Visual treatment (callout vs. spotlight — Shepherd
supports both via its `modalOverlay` option), keyboard focus behavior on
appearance, and whether to dim non-anchor regions.

## R2. Trigger Taxonomy

**Options**:

- **Event-bus triggers only**: completion bound to lifecycle/inventory/project
  events.
- **Click/path triggers**: completion bound to UI events such as
  "user clicked confirm".
- **Hybrid with timeouts**: events plus elapsed-time fallback.

**Decision**: Event-bus triggers only.

**Why**: The lifecycle event bus is already canonical for inventory and project
state. Binding the coach to those events guarantees the coach can never declare
a step done when the underlying domain state did not change. UI-click triggers
would diverge from reality on failure. Timeouts violate FR-008 by guessing.

**Open variables**: Which exact event names map to which step ids (see
`data-model.md`).

## R3. Completion Criteria Per Step

| Step id                  | Source event           | Required payload          |
| ------------------------ | ---------------------- | ------------------------- |
| `inbox.confirm_first`    | `InventoryConfirmed`   | any item id               |
| `project.create_first`   | `ProjectCreated`       | any project id            |
| `tool.open_first`        | `ToolOpened`           | any project id + profile  |

**Decision**: First occurrence of each event completes the step. The coach is
about the *first* time, not a count.

**Resolved (R-Source-1, 2026-05-22)**: The event envelope carries a top-level
`source: enum("user", "restore", "system")` field (see spec 002 §6 R-Source-1).
The guided-flow subscriber ignores events where `source == "restore"`. This
ensures that audit-log replay during recovery does not prematurely advance
coach steps. `source == "user"` and `source == "system"` events are accepted.
No further open variables on this decision.

## R4. Progress Persistence

**Options**:

- **SQLite single-row** in `guided_flow_state`.
- **JSON file** under the app config dir.
- **In-memory only**.

**Decision**: SQLite single-row.

**Why**: The persistence crate already owns SQLite. A single row keeps schema
migrations trivial. JSON would split state across two stores. In-memory loses
progress on restart and violates FR-006.

**Resolved (R-Corrupt, 2026-05-22)**: Write a `diagnostic` audit event on each
transition. If the state row is corrupt on read, the system resets to Idle,
emits a `guided_flow.state.corrupted` diagnostic audit event with the raw
corrupt value and parse error, and returns `STATE_CORRUPTED` on the first
`guided.state.get` call (informational; subsequent reads return fresh Idle).
See data-model.md §Recovery Rules for the full protocol.

## R5. Optionality And Activation

**Options**:

- **Auto-activate** once after setup completes, then stay dormant unless
  restarted.
- **Opt-in** via Settings.
- **Always-on** until completed or dismissed.

**Decision**: Auto-activate once, then dormant unless restarted.

**Why**: The product brief calls for low friction onboarding. Opt-in defeats
the purpose; always-on annoys returning users. Auto-once-then-dormant matches
the "in-app coach, not a tutorial" intent and aligns with FR-001 and FR-004.

**Open variables**: Whether to expose a "show again" toggle in Settings for
users who installed before this feature shipped. Default: yes, with a one-line
explanation.

## R6. Anchor Resolution On Missing Routes

**Decision**: If the current route does not host the anchor for the current
step, render a small route-pointer hint near the navigation entry to the
required route instead of suppressing the coach entirely. This keeps the user
oriented without forcing navigation.

## R7. Accessibility

**Decision**: Overlay hints must be reachable by keyboard, must announce
themselves via `aria-live=polite`, and must not trap focus. Dismiss must be
operable via Escape when the hint has focus.
