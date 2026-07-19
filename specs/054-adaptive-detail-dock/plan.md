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
  three of six pages (Sessions via `SessionDetail`, Calibration via
  `MasterDetail`, Inbox via `InboxDetail`); Archive, Projects, and Targets
  still hand-roll their own detail markup (#1067, open).

Two follow-up PRs fixed bugs in this area without changing the mechanism:
**#1035** closed #816 (Target detail content clipping — a scroll-containment
bug, unrelated to placement logic) and fixed unrelated Target-detail issues
(#856, #612, #796); **#1060** shipped SegControl accessibility work (Refs
#1010) that the pending #1066 fix is expected to reuse.

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

**None of 1–6 exist on `main`.** What shipped (#1003) is architecturally
simpler: one width signal, two placements, untyped `localStorage`, a 2-state
toggle, partial `DetailPanel` adoption, and no Targets column work. Items 3
and 4 are tracked as open follow-ups (#1066 for the control, #1067 for the
`DetailPanel` migrations); item 2 is an open product decision (#1068); items 1
and 6 have no tracked follow-up as of this reconciliation.

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
│   └── DetailPanel.tsx           # shared detail container (3 of 6 pages adopted — #1067 open)
└── features/
    ├── sessions/SessionsPage.tsx        # default adaptive placement, DetailPanel via SessionDetail
    ├── calibration/CalibrationPage.tsx  # default adaptive placement, DetailPanel via MasterDetail
    ├── inbox/InboxPage.tsx              # default adaptive placement, DetailPanel via InboxDetail
    ├── archive/ArchivePage.tsx          # default adaptive placement, detail NOT on DetailPanel (#1067)
    ├── targets/TargetsPage.tsx          # default adaptive placement, detail NOT on DetailPanel (#1067)
    └── projects/ProjectsPage.tsx        # default adaptive placement (see note below), detail NOT on DetailPanel (#1067)
```

**Note on Projects**: `ProjectsPage.tsx`'s module docstring (as of this
reconciliation) still claims it uses `detailPlacement="side-and-bottom"`
(task #104 from spec 043). Reading the actual JSX shows it passes no
`detailPlacement` at all — it defaults to `'adaptive'` like every other page.
`'side-and-bottom'` remains a real, tested capability of `ListPageLayout` (see
`ListPageLayout.test.tsx`) but is not currently used by any page. This is a
pre-existing doc/code drift in `ProjectsPage.tsx` itself, out of scope for
this documentation-only reconciliation to fix — flagging it here so it isn't
mistaken for a claim in this spec record.

## Risks & mitigations (reconciled)

- **Placement can't return to Auto once pinned** — live bug, not a risk:
  #1066, PR #1070 open.
- **Inconsistent `DetailPanel` adoption** (3/6 pages) means the container
  scroll-containment guarantee (#1035's #816 fix) is proven for its adopters
  but not verified for Archive/Projects/Targets, which hand-roll their own
  scroll structure. Tracked as #1067.
- **No page currently differentiates its threshold** — every page uses the
  1400px default via `adaptiveThreshold`'s absence. If a specific page's
  table needs a different value (the original design reserved 1500px for
  Targets), it is a one-line prop change, not an architecture change.
- **Undecided Inbox direction** (#1068) — do not build either the permanent
  split or remove the Format column without a recorded product decision.
