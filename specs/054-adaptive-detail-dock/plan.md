# Implementation Plan: Adaptive Detail-Panel Dock

**Branch**: shipped directly on `main` (#1003, #1035, #1060) | **Reconciled**:
2026-07-19 (#1069) | **Spec**: [spec.md](./spec.md)

**Input**: This plan describes the implementation that actually shipped. The
original plan (written for the now-closed `feat/adaptive-detail-dock` branch,
PR #1007) proposed a different, more elaborate architecture that was never
built — see spec.md's Reconciliation note and the "Not delivered" sections
below.

## Summary

One shared hook (`useAdaptiveDock`) drives one shared layout
(`ListPageLayout`'s `detailPlacement="adaptive"` mode), adopted by all six
list pages (Sessions, Calibration, Inbox, Archive, Targets, Projects) without
per-page opt-in code — the default `detailPlacement` prop value is
`'adaptive'`.

- **`apps/desktop/src/ui/useAdaptiveDock.ts`** resolves `'side' | 'bottom'`
  from `window.innerWidth` vs. a per-call `threshold` (default 1400px), an
  explicit `override` (persisted per `dockId`), and a drag-resizable,
  persisted `width`.
- **`apps/desktop/src/ui/ResizeHandle.tsx`** is the pointer-drag divider,
  paired via `onResizeStart`.
- **`apps/desktop/src/components/ListPageLayout.tsx`** wires the hook into
  the shared list-page scaffold: `detailPlacement` prop (default
  `'adaptive'`), `dockId` prop (defaults to `detailLabel`) for persistence
  scope, `adaptiveThreshold` prop to override the 1400px default per page (not
  currently used by any adopting page).
- **`apps/desktop/src/components/DetailPanel.tsx`** is the shared detail
  container (3-zone facts/content/aux grid, single scroll region). Adopted by
  all six pages (Sessions via `SessionDetail`, Calibration via
  `MasterDetail`, Inbox via `InboxDetail`, Archive via `ArchiveDetail`,
  Targets via `TargetDetailV2`, Projects via `ProjectDetail`) — the last
  three migrated by **PR #1072**, closing #1067.

Three follow-up PRs fixed bugs in this area without changing the mechanism:
**#1035** closed #816 (Target detail content clipping — a scroll-containment
bug, unrelated to placement logic) and fixed unrelated Target-detail issues
(#856, #612, #796); **#1060** shipped SegControl accessibility work (Refs
#1010) that **#1070** later reused to build the 3-state Auto/Bottom/Right
`DetailDockPlacementControl`, closing #1066.

## What the original plan proposed but was NOT built

The original plan (`feat/adaptive-detail-dock`, PR #1007, closed as
superseded) proposed:

1. A **page-width** hook (`useDetailDock`, `ResizeObserver` on `.alm-page`)
   measuring both window width (threshold) and page-available width
   (pin→bottom safety fallback + resize clamp), with named constants
   `TABLE_FLOOR = 640` and `MIN_SIDE_WIDTH = 320`.
2. A third **`'split'`** placement — Inbox's permanent detail-dominant right
   split, expressed via a page-level `forcedPlacement` prop with precedence
   over the user pin.
3. Typed persistence in `AppPreferences.detailDock` (mirroring the existing
   `projectViewModes` keyed-map pattern), replacing raw `localStorage`.
4. A first-class Auto/Bottom/Right Settings control plus an in-page toggle
   (both writing the same typed preference).
5. Migrating **all six** detail consumers (including Archive and Targets) to
   the shared `DetailPanel`, plus a CI guard against bespoke panel markup.
6. Targets-specific pinned identity columns and conditional horizontal scroll.

**Items 4 and 5 have since shipped**, just not exactly as originally
designed: item 4's Auto/Bottom/Right control landed via **PR #1070**
(closing #1066) on top of the shipped `useAdaptiveDock`/`localStorage`
mechanism rather than a typed preference; item 5's full `DetailPanel`
migration + shared-component guard test landed via **PR #1072** (closing
#1067). **Items 1, 3, and 6 still do not exist on `main`** — item 3 (typed
`AppPreferences` persistence) has no tracked follow-up; item 6 (Targets
pinned columns) has no tracked follow-up; item 2 (the `'split'` placement)
is **withdrawn**, not merely open — #1068 was decided against building it
(see spec.md's Deferred / superseded section).

## Technical Context

**Language/Version**: TypeScript/React (desktop shell); no Rust changes in
the dock mechanism itself (#1035's #816 fix touched `apps/desktop/src/app/router.tsx`
and Target-detail-adjacent files — verify per-PR, not part of this
mechanism's own diff).

**Primary Dependencies**: React only — no new runtime dependency. No viewport
library; `useAdaptiveDock` is a small in-house hook using
`window.addEventListener('resize', ...)`, not `ResizeObserver` (unlike the
unshipped branch design).

**Storage**: `localStorage`, raw keys under the `alm-dock-` prefix
(`alm-dock-placement-<dockId>`, `alm-dock-width-<dockId>`) — not integrated
with the existing `preferences.ts` / `AppPreferences` store. No SQLite, no
migration, no IPC.

**Testing**: `pnpm vitest run` component tests exist for `ListPageLayout`
(including its `'side-and-bottom'` variant coverage in
`ListPageLayout.test.tsx`, and `DetailPanel.containment.test.tsx`). No
dedicated `useAdaptiveDock` unit test file was found in this reconciliation
pass — verify current coverage before relying on this claim in future work.

**Target Platform**: Desktop (Windows primary dev target, plus macOS/Linux)
via Tauri.

**Project Type**: Desktop app, frontend-only feature — entirely in
`apps/desktop/src/`.

**Constraints**: No PixInsight boundary concerns (pure UI layout); no
contract/transport change (Constitution §V — this is local UI-preference
state, same conclusion as the original plan reached, just via a different
storage mechanism).

## Constitution Check

| Principle | Assessment |
|-----------|------------|
| I. Local-First File Custody | **PASS (N/A).** No image files touched; no filesystem access. Pure UI layout + a `localStorage` preference. |
| II. Reviewable Filesystem Mutation | **PASS (N/A).** No filesystem mutation, no plans, no destructive operation. |
| III. PixInsight Boundary | **PASS (N/A).** No calibrate/register/integrate/edit; layout only. |
| IV. Research-Led Domain Modeling | **PASS**, on a narrower footprint than the original plan assumed. The placement strategy (adaptive side/bottom, per-page pin, drag-resize) traces to the 2026-07-11 design review. The architecture that actually shipped (window-width-only, two placements, raw localStorage) was an implementation simplification made during coding on the `#1003` branch, not separately re-researched — this reconciliation is the first point that simplification is recorded against the spec/plan trail. |
| V. Portable Contracts & Durable Records | **PASS.** No contract change. Placement/width is client-side UI preference, outside the durable relationship/audit record — true of both the original typed-`AppPreferences` design and the shipped raw-`localStorage` implementation. |

**Result**: PASS, reconciled retroactively. No violation is introduced by the
architecture gap between plan and shipped code — the simplification stayed
within the same constitutional footprint (no new contracts, no new durable
data) — but the SpecKit record itself was missing until this document
(#1069's premise).

## Project Structure

### Documentation (this feature)

```text
specs/054-adaptive-detail-dock/
├── plan.md              # This file — reconciled against shipped code
├── research.md          # Reconciled: which original decisions match main, which don't
├── data-model.md        # Reconciled: actual persistence shape (localStorage, not AppPreferences)
├── contracts/README.md  # N/A — no transport change (true in both designs)
└── tasks.md             # Reconciled: delivered / open / superseded status per task
```

### Source code (as shipped)

```text
apps/desktop/src/
├── ui/
│   ├── useAdaptiveDock.ts        # window-width placement resolver + persisted override/width
│   └── ResizeHandle.tsx          # pointer-drag divider
├── components/
│   ├── ListPageLayout.tsx        # detailPlacement/dockId/adaptiveThreshold props; wires useAdaptiveDock
│   ├── DetailDockPlacementControl.tsx  # 3-state Auto/Bottom/Right control (PR #1070, closes #1066)
│   └── DetailPanel.tsx           # shared detail container (6 of 6 pages adopted — PR #1072, closes #1067)
└── features/
    ├── sessions/SessionsPage.tsx        # default adaptive placement, DetailPanel via SessionDetail
    ├── calibration/CalibrationPage.tsx  # default adaptive placement, DetailPanel via MasterDetail
    ├── inbox/InboxPage.tsx              # default adaptive placement, DetailPanel via InboxDetail
    ├── archive/ArchivePage.tsx          # default adaptive placement, DetailPanel via ArchiveDetail
    ├── targets/TargetsPage.tsx          # default adaptive placement, DetailPanel via TargetDetailV2
    └── projects/ProjectsPage.tsx        # default adaptive placement (see note below), DetailPanel via ProjectDetail
```

**Note on Projects**: `ProjectsPage.tsx`'s module docstring (as of this
reconciliation) still claims it uses `detailPlacement="side-and-bottom"`
(task #104 from spec 043). Reading the actual JSX shows it passes no
`detailPlacement` at all — it defaults to `'adaptive'` like every other page.
`'side-and-bottom'` remains a real, tested capability of `ListPageLayout` (see
`ListPageLayout.test.tsx`) but is not currently used by any page. This is a
pre-existing doc/code drift in `ProjectsPage.tsx` itself; tracked as **#1108**
(open PR) rather than fixed here, since fixing `ProjectsPage.tsx` is out of
scope for this documentation-only reconciliation.

## Risks & mitigations (reconciled)

- **Placement couldn't return to Auto once pinned** — was a live bug, now
  fixed: #1066, closed by PR #1070's `DetailDockPlacementControl`.
- **`DetailPanel` adoption was inconsistent (3/6 pages)** — resolved: PR
  #1072 migrated Archive/Projects/Targets, closing #1067, so the container
  scroll-containment guarantee (#1035's #816 fix) now applies to all six
  adopters uniformly.
- **No page currently differentiates its threshold** — every page uses the
  1400px default via `adaptiveThreshold`'s absence. If a specific page's
  table needs a different value (the original design reserved 1500px for
  Targets), it is a one-line prop change, not an architecture change. No
  tracked issue.
- **Inbox direction is now decided** (#1068): the owner chose to keep the
  adaptive dock and the Format column, withdrawing the permanent-split
  design (its driving need, #553, was independently fixed by PR #939). Do
  not build the permanent split without a new product ask that reopens this.
- **New, from real-app validation of the shipped mechanism**: #1106 (icon-only
  placement control, detail-panel overflow, stable `dockId`s — open PR) and
  #1107 (vertical clipping of `.alm-listpage__detail-body` — open issue).
