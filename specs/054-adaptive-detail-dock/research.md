# Phase 0 Research: Adaptive Detail-Panel Dock

**Feature**: 054-adaptive-detail-dock | **Date**: 2026-07-17 | **Plan**: [plan.md](./plan.md)

## Status

The domain research for this feature is **already settled** and this document
records it rather than re-opening it. The placement strategy, the two layout
shapes, the Inbox amendment, the Targets pinning rule, and the rejected
alternatives were decided by the owner on 2026-07-17 and captured verbatim in
`spec.md` §Clarifications. They descend from
`docs/development/design-review-2026-07-11.md`, "Viewport strategy Phase 1 —
adaptive dock" (epic #632). **Do not relitigate the settled decisions.**

What remains genuinely open are a small number of *implementation* decisions
that the spec explicitly defers to planning (FR-002: "exact per-page value is a
plan decision, not a spec commitment"). Those are decided below.

## Settled (recorded, not re-opened)

| # | Decision | Source |
|---|----------|--------|
| S1 | Adaptive placement in the shared layout: side dock when wide, bottom when narrow; per-page pin persists; bottom is the universal narrow fallback. | spec §Clarifications, FR-001/FR-003 |
| S2 | Two shapes, one mechanism: **list-dominant side dock** (adaptive, Sessions/Calibration/Archive/Projects/Targets) and **detail-dominant split** (permanent, Inbox only). | spec §Overview, FR-004/FR-014 |
| S3 | Inbox = permanent list-left (~360px) / detail-right split at every width; no bottom mode; absorbs #553. | spec §Clarifications (amendment), FR-014/FR-015 |
| S4 | Targets side dock engages at ≥ 1500px logical; pinned star + designation; permanent importance column order; conditional h-scroll of non-pinned columns; no auto-hide. | spec §Clarifications, FR-002/FR-006/FR-007/FR-008 |
| S5 | Scroll containment fixed at the **container** level; absorbs #816. | spec §Clarifications, FR-009 |
| S6 | Prerequisite: migrate `TargetDetailV2` to the shared `DetailPanel`. | spec §Clarifications, FR-010 |
| S7 | Resizable side panel/split, ~320px min to ~50% window max, width persisted with placement. | spec §Clarifications, FR-005 |
| S8 | No overlay/focus-trap variant; keyboard behaviours (J16 S3/S4) placement-neutral. | spec §Clarifications, FR-012/FR-013 |
| S9 | Rejected: Inbox bottom dock; automatic column-hiding priority ladder; overlay/modal variant. | spec §Out of Scope |

### Owner amplification 2026-07-17 (this session)

The owner restated the intent during planning: **"the panels should be
completely shared components that the individual pages can fill out with data;
the layout should be completely consistent."** This hardens S6 into a general
principle (D5 below) and makes the Archive detail migration in-scope, not
optional.

## Open implementation decisions (decided here)

### D1 — Wide/narrow threshold value

**Decision.** Targets engages the side dock at **≥ 1500px logical window
width** (spec-committed, FR-002). The other adopting pages (Sessions,
Calibration, Archive, Projects) use a **single shared default threshold of
1400px logical window width**, exposed as one named constant so it is tuned in
one place.

**Rationale.** The design review's ground truth is a 1200–1600px window beside a
processing tool. Targets is the widest table and was tuned to fit 1100×720 at
full width, so it needs the most room before a side panel is worth engaging →
1500px. The narrower tables (Sessions/Calibration/Archive/Projects details are
bounded side panels, not full splits) benefit from the side dock a little
sooner → 1400px. Both sit inside the review's band. A per-page override always
wins, so the exact numbers are a starting heuristic, not a hard contract.
**Alternatives rejected:** a single global threshold for all pages (Targets
genuinely needs a higher bar); a container-query-per-page auto-fit with no
fixed number (non-deterministic at the boundary — the spec's edge case demands
a defined side of the boundary with no oscillation).

### D2 — Width hook: which width(s) to measure

**Decision.** The hook measures **two** widths, not one:

1. **Window width** (logical CSS px of the viewport) — drives the
   wide/narrow **threshold** comparison (FR-001/FR-002).
2. **Page-available width** (the content region *after* the collapsible
   sidebar, measured with a `ResizeObserver` on the `.alm-page` element) —
   drives the **pin→bottom fallback** (FR-003: a pinned side placement must
   fall back to bottom when the window cannot fit the bounded minimum side
   width alongside a usable table) and the resize **min/max clamp** (FR-005).

**Rationale.** The sidebar is collapsible (`sidebarCollapsed` preference), so
window width alone cannot decide whether a side panel + a usable table fit.
Using only the window width would mis-decide the fallback whenever the sidebar
state differs from the default. Measuring the actual page region is the honest
signal for "does a side layout fit here." **Alternative rejected:** deriving
available width arithmetically from window width minus a hardcoded sidebar
constant — brittle against sidebar collapse, density changes, and future chrome.

**Implementation note.** Debounce/round the measured widths to avoid layout
thrash and threshold oscillation (spec edge case: "no flicker or oscillation
while resizing across it"). Use a small hysteresis band around the threshold or
compare on rounded integer px so a 1px jitter cannot flip the dock.

### D3 — "Usable table" floor for the pin→bottom fallback

**Decision.** A pinned **side** placement falls back to **bottom** when
`page_available_width − min_side_width (320px) < table_floor`, where
`table_floor` is a shared constant (**640px** for the list-dominant pages).
Inbox is exempt — it never falls back (permanent split, FR-014); its own
minimum geometry is list 320px + detail 360px enforced by the resize bounds.

**Rationale.** 320 (min side) + 640 (table floor) = 960px, below the 900px
usable width at the 1100×720 minimum after the sidebar — so at the minimum
window the fallback correctly forces bottom mode (SC-006/FR-011). The number is
one constant, tunable in one place. **Alternative rejected:** a per-page table
floor — unnecessary precision; the bounded side panel is the same shape on all
four list-dominant pages, and Targets' special column behaviour (h-scroll)
means it stays usable at narrower table widths than the others, so a single
conservative floor is safe.

### D4 — Persistence shape and store

**Decision.** Persist per-page placement preferences in the existing
`preferences.ts` store (localStorage key `alm-preferences`,
`useSyncExternalStore`), mirroring the existing `projectViewModes: {}`
per-page-keyed-map pattern. New `AppPreferences` field:
`detailDock: Record<PageKey, { mode: 'adaptive' | 'side' | 'bottom'; width: number }>`.
See [data-model.md](./data-model.md). No new IPC/contract — this is local UI
preference state, not durable library data (spec Assumptions; §V:
preference state is not part of the durable relationship/audit record).

**Rationale.** Reuses the one established UI-preference rail; no new store, no
zustand, no schema/migration. **Alternative rejected:** a feature-local
localStorage store per page (the codebase has several — `useFavourites`,
`planner-date-store`, `altitude-settings`) — rejected because placement is a
cross-page concern with one shape, and the keyed-map in `AppPreferences` is the
existing precedent for exactly "per-page UI mode."

### D5 — Fully-shared components (owner amplification)

**Decision.** Every list page renders its detail through the **one** shared
`DetailPanel` and its list+detail through the **one** shared `ListPageLayout`;
pages provide only data (`title`, `facts`, `children`, `aux`, `actions`,
`subtitle`). No page hand-rolls a panel or a bespoke layout. This requires
migrating **both** remaining deviants: `TargetDetailV2` (fully hand-rolled,
FR-010) **and** Archive's detail (currently raw `DetailPane` + `DetailHeader`,
bypassing `DetailPanel`). The dead `side-and-bottom` dual path in
`ListPageLayout` (currently unused by any page) is **deleted**, not revived —
Projects unifies onto the single adaptive mechanism (FR-004).

**Rationale.** Directly encodes the owner's "completely shared / completely
consistent" mandate and the standing one-shared-component rule. Container-level
containment (S5/FR-009) only delivers "scrolls regardless of consumer markup"
if every consumer actually routes through the shared container — so the
migrations and the containment fix are the same work. **Alternative rejected:**
fixing containment in the container while leaving Archive/Targets on their own
wrappers — would leave two consumers outside the guarantee and violate the
consistency mandate.

## No new contracts

This feature changes no UI↔core transport. It adds no Tauri command, no DTO, no
schema, and no migration. See [contracts/README.md](./contracts/README.md).
All new state is client-side UI preference persisted in localStorage.

## Constitution note

Principle IV (Research-Led Domain Modeling) is satisfied by the settled design
review + owner clarifications above; there is no open domain-modeling question
gating implementation. Principle V (Portable Contracts) is unaffected — no
contract changes, and the preference state is explicitly outside the durable
record. Full gate assessment in [plan.md](./plan.md) §Constitution Check.
