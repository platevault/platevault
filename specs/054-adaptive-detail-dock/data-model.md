# Data Model: Adaptive Detail-Panel Dock (reconciled)

**Feature**: 054-adaptive-detail-dock | **Reconciled**: 2026-07-19 (#1069) |
**Plan**: [plan.md](./plan.md)

This feature introduces **no durable (SQLite) data** and **no contract DTOs**,
as the original design also concluded. It differs from the original design in
**where** and **how** the client-side UI-preference state is stored.

## Entity: Detail placement preference (per page) — as shipped

The original design (research.md D4) proposed a typed field on the existing
`AppPreferences` object, mirroring the `projectViewModes` keyed-map
precedent. **That was not built.** What shipped
(`apps/desktop/src/ui/useAdaptiveDock.ts:58-71`) is a pair of raw
`localStorage` keys per `dockId`, entirely outside the `AppPreferences` /
`preferences.ts` store:

```ts
// As shipped — apps/desktop/src/ui/useAdaptiveDock.ts
const STORAGE_PREFIX = 'alm-dock';

// key: `${STORAGE_PREFIX}-placement-${dockId}` → 'side' | 'bottom' (absent = null = auto)
// key: `${STORAGE_PREFIX}-width-${dockId}`     → string(number), parsed with Number()
```

`dockId` defaults to the page's `detailLabel` (`ListPageLayout.tsx:157`) when
not explicitly passed, so persistence is scoped per adopting page as long as
each page's `detailLabel` (or explicit `dockId`) is stable and unique.

### Field semantics (shipped)

| Key | Type | Rule |
|---|---|---|
| `alm-dock-placement-<dockId>` | `'side' \| 'bottom'` string, or absent | Absent/invalid ⇒ `null` (follow the width heuristic). Set on every pin-toggle click; **never cleared by the current UI** — the `alm-listpage__detail-pin` button only ever writes `'side'` or `'bottom'`, so once set this key persists until localStorage is cleared manually. This is the root cause of #1066. |
| `alm-dock-width-<dockId>` | numeric string | Default `420` (`defaultWidth`). Clamped to `[minWidth=320, round(window.innerWidth * 0.5)]` on every write (`clampWidth`, `useAdaptiveDock.ts:95-102`) — including the initial read, since `readStoredWidth` is only guarded by `Number.isFinite`, and the *first* render's `width` state is the raw stored value until the next `setWidth` call re-clamps it. |

### What the original design's typed field would have added (not present)

The branch's `DetailDockPreference { mode: 'adaptive' | 'side' | 'bottom';
width: number }` shape, keyed by a closed `DetailDockPageKey` union
(`'sessions' | 'calibration' | 'archive' | 'projects' | 'targets' | 'inbox'`)
and integrated into `AppPreferences`, does not exist. Practical
consequences of the gap:

- No IPC/backend visibility into dock placement — it is pure browser
  `localStorage`, not part of whatever sync/export path `AppPreferences`
  might have.
- `dockId` is a free-form string (defaults to `detailLabel`, an i18n-derived
  label), not a closed enum — a page renaming its `detailLabel` without
  passing an explicit `dockId` silently loses its persisted placement/width
  (new key, old key orphaned). No adopting page currently hits this because
  none pass a dynamic `detailLabel`, but it is a latent footgun the typed
  design's closed `DetailDockPageKey` union would have prevented.
- No single source of truth for "which pages have dock state" — an
  `AppPreferences.detailDock` map would enumerate adopting pages; the
  shipped design has no such registry, only whatever `dockId` values happen
  to appear in `localStorage`.

None of these are currently tracked as bugs; noting them here per #1069's
instruction to record the gap rather than paper over it.

### Page-level override (not built)

The original design's `forcedPlacement?: 'bottom' | 'side' | 'split'` page
capability (research.md D6), which would have won over both the user pin and
the adaptive heuristic, **does not exist**. `ListPageLayout`'s
`detailPlacement` prop is the only placement-shaping input available to a
page, and it is a static JSX prop set once per page (not resolved through a
precedence chain against a live user pin) — see `ListPageLayout.tsx:67-112`.

### Derived (not persisted) runtime state — as shipped

Computed each render inside `useAdaptiveDock` from `window.innerWidth` (via a
`resize` listener) + the persisted `override`:

- **`placement`**: `'side' | 'bottom'` — `useAdaptiveDock.ts:126-132`.
  `sideAvailable = windowWidth >= minWidth * 2` gates whether a non-null
  `override` is honored; below that, the width-threshold comparison wins
  regardless of the pin.
- **`resizing`**: `boolean`, true only during an active pointer-drag.

### Validation / migration

- No SQLite migration (localStorage only) — same conclusion as the original
  design.
- Backward compatibility: an absent key for a given `dockId` behaves as
  `override = null`, `width = defaultWidth` (420) — equivalent in spirit to
  the original design's "absent key ⇒ page default," but there is no single
  `detailDock: {}` object to be absent; each `dockId`'s two keys are
  independently absent or present.
- Width is clamped on every `setWidth` call (including the value passed on
  the initial persisted read being re-clamped the next time it's set), not
  specifically gated as a one-time "on restore" step the way the original
  design's `data-model.md` described it — functionally similar outcome
  (an out-of-range persisted width self-corrects), different mechanism.

## Non-data entities

- **Placement** (`'side' | 'bottom'`) is a rendering concept computed by the
  hook, not stored directly — only the `override` and `width` are persisted,
  matching the original design's intent that placement itself is derived.

## Summary

| Concern | Original design | Shipped |
|---|---|---|
| SQLite tables | none | none (unchanged) |
| SQLite migration | none | none (unchanged) |
| Contract DTOs | none | none (unchanged) |
| Tauri commands | none | none (unchanged) |
| New persisted state | `AppPreferences.detailDock: Record<DetailDockPageKey, DetailDockPreference>` | Raw `localStorage['alm-dock-placement-<dockId>']` / `localStorage['alm-dock-width-<dockId>']`, `dockId` a free-form string |
| Placements modeled | 3 (`side`/`bottom`/`split`) | 2 (`side`/`bottom`) |
