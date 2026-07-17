# Phase 1 Data Model: Adaptive Detail-Panel Dock

**Feature**: 054-adaptive-detail-dock | **Date**: 2026-07-17 | **Plan**: [plan.md](./plan.md)

This feature introduces **no durable (SQLite) data** and **no contract DTOs**.
It adds one piece of client-side UI-preference state, persisted in localStorage
via the existing `preferences.ts` store. Placement/width is explicitly *not*
part of the library's durable relationship or audit record (spec Assumptions;
Constitution §V).

## Entity: Detail placement preference (per page)

Persisted under the existing `AppPreferences` object (localStorage key
`alm-preferences`), as a per-page keyed map mirroring the existing
`projectViewModes` precedent.

### New `AppPreferences` field

```ts
// apps/desktop/src/bindings/types (or the TS-local AppPreferences shape)
type DetailDockMode = 'adaptive' | 'side' | 'bottom';

interface DetailDockPreference {
  /** User override. 'adaptive' = follow the width heuristic (default). */
  mode: DetailDockMode;
  /** Persisted side-panel / split width in logical px. Clamped on restore. */
  width: number;
}

interface AppPreferences {
  // ...existing fields (sidebarCollapsed, density, projectViewModes, ...)
  /** Per-page detail-dock placement + width. Absent key ⇒ page default. */
  detailDock: Record<DetailDockPageKey, DetailDockPreference>;
}
```

### `DetailDockPageKey`

One stable key per adopting page (not per route instance):

`'sessions' | 'calibration' | 'archive' | 'projects' | 'targets' | 'inbox'`

### Field semantics

| Field | Type | Rule |
|-------|------|------|
| `mode` | `'adaptive' \| 'side' \| 'bottom'` | Default `'adaptive'`. **Inbox is fixed** — its key, if present, is ignored for `mode` (always the permanent split); only `width` applies. `'side'`/`'bottom'` are explicit pins (FR-003). |
| `width` | number (logical px) | Side-panel width (list-dominant pages) or split position (Inbox). Default = the page's design default (Inbox list ~360px; list-dominant side panel ~420px). Bounded ~320px min to ~50% of window max (FR-005); **clamped to the current window on restore** — never restore an unusable layout (spec edge case). |

### Page-level override (not persisted)

`ListPageLayout` accepts `forcedPlacement?: 'bottom' | 'side' | 'split'` — a
page capability, not user state. It wins over the persisted `mode` and the
adaptive heuristic (research.md D6). Inbox expresses its permanent split as
`forcedPlacement='split'`; a bottom-only page passes `forcedPlacement='bottom'`.
When set, the page's persisted `detailDock[page].mode` is ignored for placement
(the `width` may still apply where the forced shape is resizable).

### Derived (not persisted) runtime state

Computed each render from the width hook (research.md D2) + the persisted
preference; never stored:

- **effectivePlacement**: `'side' | 'bottom'` (or `'split'` for Inbox) —
  resolves `mode` against the measured window width and the pin→bottom fallback
  (FR-003, research.md D3).
- **measuredWindowWidth**, **measuredPageWidth** — from the hook.

### Validation / migration

- No SQLite migration (localStorage only).
- Backward compatibility: an existing `alm-preferences` blob without
  `detailDock` reads as `{}` ⇒ every page defaults to `'adaptive'` at its
  default width. No migration step required; the store already tolerates
  absent keys (the `projectViewModes: {}` precedent).
- On restore, `width` outside `[320, 0.5 * windowWidth]` is clamped into range
  before use (FR-005, SC-002).

## Non-data entities (behavioural, from spec §Key Entities)

- **Side-layout shape** — a *rendering* concept, not stored: `list-dominant
  side dock` vs `detail-dominant split`. Encoded as a prop/variant on
  `ListPageLayout`, not as data.

## Summary

| Concern | This feature |
|---------|--------------|
| SQLite tables | none |
| SQLite migration | none |
| Contract DTOs | none |
| Tauri commands | none |
| New persisted state | `AppPreferences.detailDock` (localStorage) |
