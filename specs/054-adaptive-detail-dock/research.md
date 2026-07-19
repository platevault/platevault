# Research: Adaptive Detail-Panel Dock (reconciled)

**Feature**: 054-adaptive-detail-dock | **Reconciled**: 2026-07-19 (#1069) |
**Plan**: [plan.md](./plan.md)

## Status

This document replaces the original `feat/adaptive-detail-dock` branch's
research.md (PR #1007, closed as superseded). That document recorded design
decisions S1–S9 and implementation decisions D1–D6 for an architecture that
was **not built**. This reconciliation records, for each of those decisions,
whether the shipped `#1003` implementation matches it, deviates from it, or
never addressed it — verified against `main` source, not assumed from the
branch's intent.

## Original decisions vs. what shipped

| # | Original decision | Shipped reality | Verified against |
|---|---|---|---|
| S1 | Adaptive placement, side wide / bottom narrow, per-page pin, bottom is universal fallback | **Matches**, but the width signal differs (see D2 below) | `useAdaptiveDock.ts:127-132` |
| S2 | Two shapes: list-dominant side dock (5 pages) + detail-dominant split (Inbox) | **Not built.** Only one shape shipped — Inbox uses the same adaptive side/bottom mechanism as every other page | grep for `'split'` / `useDetailDock` across `apps/desktop/src` returns no hits; Inbox uses default `ListPageLayout` |
| S3 | Inbox = permanent list-left/detail-right split, absorbs #553 | **Not built.** Open product decision, #1068, comparing this against the Format column `main` shipped instead | `InboxPage.tsx` passes no `detailPlacement`; `InboxList.tsx:41,138,193-194,408-414,507` shows a shipped Format column instead |
| S4 | Targets side dock at ≥1500px; pinned star+designation; permanent column order; conditional h-scroll | **Not built.** No per-page threshold differentiation shipped (all pages use the 1400px default); no pinned-column or h-scroll work found in `TargetsTable`/`TargetsPage` | `TargetsPage.tsx:543-603` passes no `adaptiveThreshold` |
| S5 | Scroll containment fixed at the container level, absorbs #816 | **Built, but narrower than "every consumer".** #1035 fixed #816 for the Target detail specifically; the container guarantee is proven for `DetailPanel`'s three current adopters (Sessions/Calibration/Inbox), not for Archive/Projects/Targets which don't route through `DetailPanel` at all (#1067) | commit `fa863492`, `DetailPanel.tsx` |
| S6 | Migrate `TargetDetailV2` to shared `DetailPanel` | **Not built.** `TargetDetailV2`/`TargetsTable` are not among the files using `DetailPanel` | `grep -rln DetailPanel apps/desktop/src` excludes `features/targets/` |
| S7 | Resizable side panel, ~320px min to ~50% window max, width persisted with placement | **Built as designed** | `useAdaptiveDock.ts:76-77,95-102` (`minWidth=320`, `maxWidthFraction=0.5`, `clampWidth`) |
| S8 | No overlay/focus-trap variant; keyboard behaviors placement-neutral | **Built**, but as a pre-existing `ListPageLayout` behavior (spec 043, #771/#906) rather than new work for this feature — the Escape handler in `ListPageLayout.tsx` is one `document`-level listener regardless of `detailPlacement` | `ListPageLayout.tsx:175-193` |
| S9 | Rejected: Inbox bottom dock; auto column-hiding; overlay/modal variant | **Moot for the shipped design** — S9 rejected alternatives to the branch's *own* Inbox split proposal, which itself was not built. No new rejection needed for the shipped mechanism. | — |
| D1 | Thresholds: Targets 1500px, others 1400px, one constant | **Not built as a per-page differentiation.** `useAdaptiveDock`'s `threshold` param defaults to 1400 and is configurable via `ListPageLayout`'s `adaptiveThreshold` prop, but no adopting page currently passes a non-default value | `useAdaptiveDock.ts:75`, no `adaptiveThreshold=` usage found in any `features/*/​*Page.tsx` |
| D2 | Two-measurement width hook: window width (threshold) + page-available width (`ResizeObserver` on `.alm-page`, fallback/clamp) | **Not built.** Shipped hook measures only `window.innerWidth`, via a `resize` event listener, not `ResizeObserver` | `useAdaptiveDock.ts:80,89-93` |
| D3 | Pin→bottom fallback floor: `page_available_width − 320 < 640` | **Not built as designed**, but a narrower related check exists: `sideAvailable = windowWidth >= minWidth * 2` (i.e. `windowWidth >= 640` when `minWidth=320`) gates whether an override is honored at all — a single-threshold heuristic on window width, not the branch's two-term page-available-width calculation | `useAdaptiveDock.ts:126-132` |
| D4 | Persistence in `preferences.ts` / `AppPreferences.detailDock`, mirroring `projectViewModes` | **Not built.** Shipped persistence is raw `localStorage` under an `alm-dock-` prefix, entirely separate from the `AppPreferences` store | `useAdaptiveDock.ts:58-71` (`STORAGE_PREFIX`, `readStoredPlacement`, `readStoredWidth`) |
| D5 | Fully-shared components: migrate `TargetDetailV2` **and** Archive to `DetailPanel`; delete the dead `'side-and-bottom'` path | **Not built** for Archive/Targets (tracked as #1067). The `'side-and-bottom'` path was **not deleted** — it remains a live, tested `ListPageLayout` capability, just currently unused by any page (see plan.md's note on `ProjectsPage.tsx`'s stale docstring) | `ListPageLayout.tsx:92,207-266`, `ListPageLayout.test.tsx:102-176` |
| D6 | Page-level `forcedPlacement?: 'bottom'\|'side'\|'split'` prop, precedence over user pin, subsuming the Inbox split | **Not built.** No `forcedPlacement` prop exists on `ListPageLayout`; `detailPlacement` is the only placement-shaping prop and it is page-static (set once in JSX), not resolved through the same precedence chain as a user pin | `ListPageLayout.tsx:67-112` props list |

## What the shipped design got instead (not in the original research)

The shipped `useAdaptiveDock` makes one simplification the branch design
didn't consider: collapsing "does the window have room for a side panel at
all" and "did the window cross the placement threshold" into two checks
against the **same** width signal (`window.innerWidth`) rather than two
different signals (window width vs. page-available width). This trades the
branch's sidebar-collapse-aware accuracy (D2's stated rationale — window
width alone can't tell if a side panel + a usable table fit when the sidebar
is expanded vs. collapsed) for a much smaller hook with no `ResizeObserver`
wiring. No issue currently tracks this gap; it hasn't been reported as a live
bug, unlike #1066 (the Auto-return bug) and #1067 (the DetailPanel adoption
gap), which were.

## No new contracts

Confirmed still true of the shipped design: no Tauri command, no contract
DTO, no SQLite schema or migration. All new state is `localStorage` (a
narrower footprint than the originally planned `AppPreferences` field, but
the same constitutional conclusion). See [contracts/README.md](./contracts/README.md).

## Constitution note

Principle IV (Research-Led Domain Modeling) is satisfied by the 2026-07-11
design review's core prescription (adaptive placement, per-page pin,
drag-resize), which the shipped mechanism honors. The *implementation*
decisions D1–D6 above were largely not carried forward as designed; this
reconciliation is the first record of that gap against the SpecKit trail,
closing the workflow violation issue #1069 identified (a spec.md existing
only on a superseded branch, with no mainline record for what actually
shipped).
