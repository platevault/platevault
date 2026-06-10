# Feature Specification: Design v4 — Unified Detail Layout & Shell

**Feature Branch**: `design-v4-implementation`

**Created**: 2026-06-10

**Status**: Implemented (post-hoc record)

**Input**: Interactive design session — establish and roll out one consistent
detail layout, sidebar, and status bar across every screen, validated against an
HTML mock before implementation. Partially supersedes the layout/consistency
goals of `030-ui-audit-revision`.

## Why

The desktop pages were built as independent mockups: bespoke per-page layouts,
heavy inline styling, duplicated state→variant maps, inconsistent action
placement, and a broken scroll chain that pushed content out of frame. This
feature picks **one** standard and applies it everywhere so the app reads as a
single coherent product.

## User Scenarios

1. **Browse any entity** (Projects, Sessions, Targets, Calibration, Inbox,
   Archive) and see the same detail framing: identity header → metric line →
   primary column + a unified right rail, with the same iconography, spacing,
   and action placement.
2. **Scroll a long detail** and the header, metric line, toolbar, sidebar, and
   status bar stay put while only the primary column scrolls; the rail stays in
   view.
3. **Act on the selected item** from one predictable place — the toolbar action
   row — with actions that change by entity state.

## Decisions (locked)

- **Detail standard:** dashboard layout — `DetailPane fill` → `DetailHeader`
  (identity only) → `MetricLine` → `DetailGrid` (scrolling `primary` +
  `Rail`/`RailCard`). One flat rail panel, no separate boxes.
- **Scroll model:** the primary column is the only scroll region; header/metric
  line pinned, rail fixed. (Independent-scroll, not `position: sticky`.)
- **Actions:** per-item actions live in a single contextual `TopActionBar`
  row (by state); the detail header carries no buttons.
- **Density:** compact is the default (toggle retained).
- **Window:** minimum size raised to **1280×800** so the rail always fits — no
  responsive collapse needed.
- **Sidebar:** 1-line brand, workflow groups (Capture/Library/Work), count
  badges, Settings pinned at the bottom.
- **Status bar:** zoned — operation (left) / storage & cleanup health (right) /
  log toggle; inventory counts removed (they live in the nav).
- **State maps:** project + session state → label/variant centralized in
  `apps/desktop/src/lib/lifecycle.ts`.

## Functional Requirements

- **FR-001**: Every list/detail page MUST use `PageShell + ListDetailLayout +
  TopActionBar` and the detail standard above.
- **FR-002**: Detail panes MUST scroll the primary column independently while
  keeping header, metric line, and rail in view.
- **FR-003**: Per-item actions MUST render in the `TopActionBar` `right` slot,
  contextual to the selected item's state; detail headers MUST NOT contain
  action buttons.
- **FR-004**: State→label and state→variant mappings MUST come from
  `lib/lifecycle.ts`; no per-feature duplication.
- **FR-005**: Inbox keeps its three-pane confirm workflow (list + detail +
  `ActionSidebar`); its detail uses the standard header/metric-line/section
  framing without a rail.
- **FR-006**: Settings MUST sit in the standard frame (category nav as the list
  pane, active pane as detail).

## Out of Scope

- Wiring pages to the real backend (pages still render fixtures).
- Updating component/e2e tests for the new markup (follow-up).
- Relocating the "+ New" create controls into the list panes (kept in the
  toolbar for now).

## Implementation Notes

- Branch `design-v4-implementation`, commit `0e587e2`.
- New shared components: `MetricLine`, `DetailGrid`/`Rail`/`RailCard`,
  `Lifecycle`; `DetailPane` gained a `fill` mode.
- Fixed the flex scroll chain (`min-height: 0` on `.alm-frame__main`).
- `VITE_USE_MOCKS` now defaults to `false` (real backend) via `loadEnv`; e2e
  pinned to mocks. Native Windows dev runbook added under `docs/development/`.

## Relationship to 030

Implements the consistent-navigation/layout and shared-component goals of
`030-ui-audit-revision` (`ListSidebar`, `TopActionBar`, `PropertyTable`,
density). 030's backend-data and per-screen content tasks remain open.
