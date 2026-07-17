# Implementation Plan: Adaptive Detail-Panel Dock

**Branch**: `054-adaptive-detail-dock` (impl on `feat/adaptive-detail-dock`) | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/054-adaptive-detail-dock/spec.md`

## Summary

One shared list-page mechanism, filled with data by every page, in two layout
shapes:

- **List-dominant adaptive side dock** — the detail is a bounded, drag-resizable
  side panel when the window is wide and a bottom dock when narrow, with a
  persisted per-page pin. Adopted by **Sessions, Calibration, Archive,
  Targets**, and **Projects** (which unifies onto this mechanism, replacing its
  dead hardcoded dual layout and gaining the narrow fallback it never had).
- **Detail-dominant permanent split** — a narrow item list on the left
  (~360px) and a full-height detail on the right, at every width, no bottom
  mode. **Inbox only.**

Underneath both shapes, three foundational pieces make the mechanism real and
consistent: (1) **container-level scroll containment** in the shared detail
container so every consumer scrolls correctly in every placement regardless of
its own markup (closes **#816**); (2) a **width hook** measuring both window
width and page-available width; (3) per-page **placement persistence** in the
existing `preferences.ts` store. As a prerequisite and per the owner's
"completely shared / completely consistent" mandate, the two remaining
hand-rolled detail consumers — **`TargetDetailV2`** and **Archive's detail** —
migrate onto the shared `DetailPanel` so no page owns bespoke panel markup.
Inbox's permanent split closes **#553**.

The work sequences as a **single foundational lane** (containment → width hook →
persistence → `ListPageLayout` adaptive wiring + resize → panel migrations),
then a **per-page fan-out** (side-dock adoption, Projects unify, Inbox split,
Targets pinned columns), then **CI Playwright assertions + journey deltas** as
part of "done." Everything routes through the shared mechanism, so the
foundation is strictly sequential; only the fan-out parallelises.

## Technical Context

**Language/Version**: TypeScript/React (desktop shell); no Rust changes.

**Primary Dependencies**: React + the existing in-house component layer
(`ListPageLayout`, `DetailPanel`, `DetailPane`, `PageTopBar`), `preferences.ts`
(`useSyncExternalStore` over localStorage). No new runtime dependency; no
viewport library is added — the width hook is a small in-house
`ResizeObserver` + `matchMedia`-free measurement hook.

**Storage**: localStorage `alm-preferences` (existing store) gains a
`detailDock` per-page map. No SQLite, no migration.

**Testing**: `pnpm vitest run` (component/unit: width hook, placement resolver,
preference persistence, `ListPageLayout` placement, Inbox list truncation);
mock-mode Playwright end-to-end in the GitHub CI job (FR-016 assertion set);
existing e2e pins kept/migrated deliberately; `pnpm typecheck` / `pnpm build` /
`pnpm format:check`. Real-app verification via `verify-on-windows` + a
tauri-driver Layer-2 journey where visual placement matters.

**Target Platform**: Desktop (Windows primary dev target; macOS/Linux) via
Tauri. Enforced minimum window 1100×720 (existing shell invariant).

**Project Type**: Desktop app; this feature is entirely in `apps/desktop/`
(React components, styles, hooks, preference store, e2e tests) plus
`docs/journeys/` deltas.

**Performance Goals**: No dock flicker or oscillation crossing the threshold
(SC-001); width measurement debounced/hysteretic so a 1px jitter cannot flip
the placement; resize tracks the drag smoothly.

**Constraints**: Fully workable at exactly 1100×720 on every list page
(FR-011); no overlay/focus-trap variant (FR-013); PixInsight boundary
untouched (no image work); no contract/transport change (Constitution §V —
preference state outside the durable record).

**Scale/Scope**: 6 list pages, 1 shared layout component, 1 shared detail
component, 2 panel migrations, 1 width hook, 1 preference field, ~8 journey
deltas, the FR-016 CI assertion set.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|------------|
| I. Local-First File Custody | **PASS (N/A).** No image files touched; no filesystem access. Pure UI layout + a localStorage preference. |
| II. Reviewable Filesystem Mutation | **PASS (N/A).** No filesystem mutation, no plans, no destructive operation. |
| III. PixInsight Boundary | **PASS (N/A).** No calibrate/register/integrate/edit; layout only. |
| IV. Research-Led Domain Modeling | **PASS.** The placement strategy, two shapes, Inbox amendment, and Targets rule are settled via the 2026-07-11 design review + owner clarifications (spec §Clarifications; research.md S1–S9 record them). The only open items were *implementation* decisions the spec deferred to planning (thresholds, width-measurement contract, fallback floor, persistence shape) — decided in research.md D1–D5. No open domain-modeling question gates implementation. |
| V. Portable Contracts & Durable Records | **PASS.** No contract change (contracts/README.md — N/A). Placement/width is client-side UI preference, explicitly outside the durable relationship/audit record (spec Assumptions). SQLite untouched. |

**Result**: PASS (initial) and PASS (re-checked after Phase 1 design — the
design added only a localStorage field and shared-component wiring, introducing
no new contract, table, or domain rule). Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/054-adaptive-detail-dock/
├── plan.md              # This file
├── research.md          # Phase 0 (settled decisions S1–S9 + open decisions D1–D5)
├── data-model.md        # Phase 1 (AppPreferences.detailDock; no SQLite/DTO)
├── contracts/README.md  # Phase 1 (N/A — no transport change)
└── tasks.md             # Phase 2 (/speckit-tasks output)
```

### Source Code (repository root)

```text
apps/desktop/src/
├── components/
│   ├── ListPageLayout.tsx        # adaptive placement driven by hook+override; drag-resize handle;
│   │                             #   DELETE dead 'side-and-bottom' dual path; add 'split' shape for Inbox
│   ├── DetailPanel.tsx           # container-level scroll containment (FR-009); the single shared panel
│   └── (new) useDetailDock.ts    # width hook (window + page-available) + placement resolver (research D1–D3)
├── data/
│   ├── preferences.ts            # add detailDock map (get/set per page, width clamp on restore)
│   └── (bindings/types)          # AppPreferences.detailDock shape (data-model.md)
├── styles/components/
│   ├── tables-lists.css          # container containment fix; side-dock + split geometry
│   ├── merges-2.css              # .alm-listpage__*--side (side dock) — extend, resize handle
│   └── merges-3.css              # remove dead --dual rules; Inbox split rules; Targets height-chain
├── features/
│   ├── sessions/SessionsPage.tsx        # adopt adaptive side dock (data-only fill)
│   ├── calibration/CalibrationPage.tsx  # adopt adaptive side dock
│   ├── archive/ArchivePage.tsx          # adopt adaptive side dock; migrate ArchiveDetail → DetailPanel
│   ├── projects/ProjectsPage.tsx        # unify onto adaptive mechanism (drop bespoke stack)
│   ├── inbox/
│   │   ├── InboxPage.tsx                 # permanent detail-dominant split
│   │   └── InboxList.tsx                 # narrowed presentation (name truncation + tooltip, essential cols)
│   └── targets/
│       ├── TargetsPage.tsx               # adaptive side dock at ≥1500px
│       ├── TargetDetailV2.tsx            # migrate to shared DetailPanel (FR-010)
│       └── (targets table)               # pinned star+designation, permanent column order, conditional h-scroll

apps/desktop/tests/e2e/
├── adaptive_detail_dock.spec.ts          # NEW — FR-016 assertion set (threshold, override, resize, Inbox split)
├── targets_planner.spec.ts               # keep :531/:536 full-width unclipped pin; add pinned-col + h-scroll
├── calibration_masters_matching.spec.ts  # keep/adjust :157 .alm-listpage__detail pin
└── inbox_ingest_confirm.spec.ts          # migrate :69/:135/:183 to the split semantics (FR-014)

docs/journeys/                            # deltas: J02, J03, J04, J05, J07, J08, J09, J16
```

**Structure Decision**: Frontend-only. One shared `ListPageLayout` + one shared
`DetailPanel` are the single source of layout truth; every page fills them with
data. No page keeps bespoke panel/layout markup after this feature. No new
crate, contract, table, or migration.

## Phase 0 — Research

See [research.md](./research.md). Settled decisions S1–S9 (recorded, not
re-opened). Open implementation decisions decided: **D1** thresholds (Targets
1500px, others 1400px, one constant each), **D2** two-measurement width hook
(window width for threshold; page-available width for fallback + clamp), **D3**
pin→bottom fallback floor (min-side 320 + table-floor 640), **D4** persistence
in `preferences.ts` mirroring `projectViewModes`, **D5** fully-shared components
(migrate `TargetDetailV2` **and** Archive; delete the dead dual path).

## Phase 1 — Design

See [data-model.md](./data-model.md) (the `AppPreferences.detailDock` field; no
SQLite/DTO) and [contracts/README.md](./contracts/README.md) (N/A — no
transport change).

## Sequencing spine (why the foundation is sequential)

Every page's placement, resize, persistence, and containment route through the
**same** `ListPageLayout` + `DetailPanel` + `useDetailDock`. Building the pages
before the shared mechanism exists would mean each page inventing throwaway
wiring, then colliding when the shared mechanism lands. So:

1. **Foundational lane (strictly sequential, one worktree, no fan-out):**
   containment fix (FR-009) → width hook (D2) → placement persistence (D4) →
   `ListPageLayout` adaptive wiring + drag-resize (FR-001/FR-005) → migrate
   `TargetDetailV2` + Archive to `DetailPanel` (FR-010/D5) → delete dead dual
   path.
2. **Per-page fan-out (parallelisable after the foundation):** Sessions,
   Calibration, Archive, Targets adopt the side dock; Projects unifies; Inbox
   adopts the permanent split + narrowed list; Targets adds pinned identity
   columns + conditional h-scroll. Each page is a data-only fill plus its
   page-specific behaviour — independent files, independent review.
3. **Validation as part of done:** the FR-016 CI Playwright assertion set +
   the FR-017 journey deltas (J02/J03/J04/J05/J07/J08/J09/J16). Existing pins
   kept or migrated with explicit rationale, never silently broken.

**Orchestration timing (owner directive: one coding agent at a time).** This
feature is executed by a **single** coding lane, phase by phase, to stay within
session limits — not a parallel fleet. The main session spawns one coder per
phase in its own worktree, reviews the pushed branch, merges, then spawns the
next. Step 1 (foundation) must be a single lane regardless (the pages all
depend on it); steps 2–3 also run as successive single lanes off the merged
foundation. The per-page `[P]` independence in tasks.md means safe-to-reorder,
not run-concurrently.

**Two owner mandates folded in:** (a) a **shared-component guard** (tasks.md
T012a) — an automated check that every list page renders through the shared
`DetailPanel`/`ListPageLayout`, failing CI if any page reintroduces bespoke
panel markup; (b) an **easy Auto/Bottom/Right toggle in the app configuration**
(tasks.md T021) — the placement override is a first-class Settings control, not
only an in-page affordance.

## Phased delivery

| Phase | Story | Ships | New contract? |
|-------|-------|-------|---------------|
| Foundation | US1 (P1) | container containment (#816), width hook, placement persistence, `ListPageLayout` adaptive+resize, `TargetDetailV2`+Archive migration, dead-path deletion | No |
| Side dock | US2 (P1) | Sessions/Calibration/Archive/Targets side dock + bottom fallback; Projects unify | No |
| Inbox split | US3 (P1) | Inbox permanent detail-dominant split + narrowed list (#553) | No |
| Pin & resize | US4 (P2) | per-page pin + persisted drag-resize (surfaced control + restore) | No |
| Targets columns | US5 (P2) | pinned star+designation, permanent column order, conditional h-scroll | No |
| Keyboard | US6 (P3) | placement-neutral arrow-follow + Escape (regression-pin the existing J16 behaviour) | No |
| Validation | — | FR-016 CI assertions + FR-017 journey deltas | No |

US1 is the MVP: after it, the mechanism exists and every consumer scrolls
correctly, even before the per-page shapes fully land.

## Risks & mitigations

- **Threshold oscillation at the boundary** → debounce + hysteresis in the
  width hook; deterministic side of the boundary (research D2).
- **#939 just landed Inbox detail scroll/mixed-split on main** → build the
  Inbox split *on top* of #939, do not redo or fight it; re-read `InboxDetail`/
  `InboxPage` at the merged HEAD before touching them.
- **Existing e2e pins** (`calibration_masters_matching.spec.ts:157`,
  `inbox_ingest_confirm.spec.ts:69/135/183`, `targets_planner.spec.ts:531/536`)
  → keep passing or migrate with an explicit in-diff rationale; never silent
  delete (FR-016, SC-009).
- **Windows-only visual confirmation** → the placement flip, resize, and Inbox
  geometry need real-app verification (`verify-on-windows`); flag for the
  Windows loop, don't declare visual behaviour done from Linux unit tests alone.
- **Merge conflicts across the fan-out** → each page is a distinct file; keep
  the foundation merged to `main` (or the feature base) before starting the
  fan-out so lanes branch from a stable shared mechanism.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
