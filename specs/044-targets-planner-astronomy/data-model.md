# Data Model: Targets Planner — Ephemeris & Observer-Location Engine (Track B)

**Feature**: 044 Track B | **Date**: 2026-07-04 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Two data surfaces: (1) **persisted** — an `ObserverSite` collection + a global threshold on the spec-018
settings store (the only durable record this feature adds); (2) **ephemeral frontend** — the astronomy
engine's per-night result shapes and the shared planning context (read-only projections, never persisted).

---

## 1. Persisted — settings extension (spec 018 store)

Added to `SettingsState` in `crates/domain/core/src/settings.rs`, persisted in the SQLite `settings`
table via a new migration, exposed through the **existing** scope/values IPC under a new **`observing`**
scope. The scope/values transport already round-trips structured arrays (`pattern: PatternPart[]`,
`protectedCategories: string[]`), so `ObserverSite[]` needs no new transport.

### Entity: `ObserverSite`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` (stable id) | Immutable identity; referenced by `defaultSiteId`/`activeSiteId`. |
| `name` | `string` (non-empty) | User label (e.g. "Home", "Dark site"). |
| `latitudeDeg` | `number` [−90, 90] | Manual entry; no online lookup. |
| `longitudeDeg` | `number` [−180, 180] | Manual entry. East-positive. |
| `elevationM` | `number \| null` | Metres; optional (nullable). Passed to the engine when present. |
| `timezone` | `string` (IANA id) | Picked from a bundled IANA list (offline). Drives local-time rendering + DST. |
| `twilight` | `"astronomical" \| "nautical"` | Per-site night definition. Default `"astronomical"` (Sun −18°). |
| `minHorizonAltDeg` | `number` [0, 90] | Local-obstruction floor. Default `0`. Standard refraction still applied at the true horizon. |

**Invariants**:
- `id` values are unique within the collection.
- At most one site is the default (`defaultSiteId`); at most one active (`activeSiteId`).
- Deleting a site MUST leave `defaultSiteId`/`activeSiteId` valid or cleared to the no-site state (US6):
  deleting the active site reselects the default (or none); deleting the default leaves a valid/empty default.
- `latitudeDeg`/`longitudeDeg` are required and range-checked; `elevationM` may be null.

### `observing` scope value bag

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `sites` | `ObserverSite[]` | `[]` | The named-site collection. Empty = no-site state (US6). |
| `defaultSiteId` | `string \| null` | `null` | Which site is default. |
| `activeSiteId` | `string \| null` | `null` | Which site the planner currently computes for; **persists across relaunch**. |
| `usableAltitudeDeg` | `number` [0, 90] | `30` | Global lowest-worthwhile altitude. **Replaces** the localStorage `ALTITUDE_THRESHOLD_KEY` and the `USABLE_ALT_DEG` constant. |

**Migration**: one new file `crates/persistence/db/migrations/00NN_observer_sites.sql` seeding the four
keys with defaults. **`00NN` = the next free number chosen at implementation time after checking open PRs**
(latest committed is `0050`; convoy reservations exist — duplicate versions abort fresh-DB migrate).

**Seed (optional)**: a first site MAY be proposed from the FITS session observer location
(`crates/metadata/core` observer latitude/longitude — from `SITELAT`/`SITELONG`/`OBSGEO-*`) plus an
inferred timezone, presented in the wizard for the user to confirm/complete (never silently adopted — FR-014).

---

## 2. Ephemeral — frontend engine result shapes (not persisted)

Computed by `planner-astronomy.ts` from a target's J2000 coordinates + the active `ObserverSite` + the
planning date, then reduced by `planner-derive.ts`. These are read-only projections (ADR-0001) — no DB,
no audit, no IPC.

### Input: `PlannableTarget`

Consumed from the existing `target.list` `TargetListItem` (already carries `raDeg`/`decDeg` J2000). A target
with null coordinates is **un-plannable** (rendered as "needs coordinates", FR row / edge case) — never
computed against a default.

### `NightObservability` (per target, per site, per date)

| Field | Type | Notes |
|-------|------|-------|
| `samples` | `{ tMs: number; altDeg: number; azDeg: number }[]` | 10-min grid across the night (FR-001). Precessed J2000→date before `Horizon()` (FR-026). |
| `transit` | `{ tMs: number; altDeg: number }` | Exact culmination via `SearchHourAngle(0)` (FR-002). |
| `rise` / `set` | `{ tMs: number } \| null` | Exact via `SearchRiseSet`, respecting `minHorizonAltDeg` + refraction; `null` for circumpolar/never-rising (FR-003). |
| `darkWindow` | `{ startMs: number; endMs: number } \| null` | From `SearchAltitude` at the site's twilight depression; `null` when no dark exists (high-lat summer — FR-017). |
| `moonSamples` | `{ tMs: number; moonAltDeg: number; separationDeg: number }[]` | Aligned to `samples`; Moon altitude + target↔Moon separation over the night (FR-019). |
| `moonUpWindows` | `{ startMs: number; endMs: number }[]` | Contiguous Moon-above-horizon intervals ∩ dark window (FR-021). |
| `moonIllumination` | `number` [0,1] | Illuminated fraction for the night (from Track A's shared module; carried for display). |

### `DerivedObservability` (per target) — from `NightObservability` + thresholds

| Field | Type | Derivation |
|-------|------|------------|
| `maxAltDeg` | `number` | max of `samples[].altDeg` (= transit alt). |
| `visibleTonight` | `boolean` | any dark-window sample with `altDeg ≥ usableAltitudeDeg` (FR-005). |
| `totalImagingMinutes` | `number` | Σ dark-window intervals where `altDeg ≥ usableAltitudeDeg` (band-free — FR-005). |
| `bestDate` | `{ dateMs: number; inDays: number }` | Date the target transits at local midnight (anti-solar; FR-009). Sortable by `inDays`. |
| `separationScalars` | `{ atTransitDeg; minOverDarkDeg; atDarkMidpointDeg }` (each `number \| "moon-not-up"`) | Three reference separations (FR-020). |
| `moonFreeMinutesByBand` | `Record<Band, number>` | Per band `b`: Σ dark-window intervals where `altDeg ≥ usableAltitudeDeg` **AND NOT** (`moonAlt > minHorizon` **AND** `separation < lorentzianMinSep(b, moonAge)`). The per-band rule + params come from **Track A (047)**; Track B integrates (FR-022). Bands: `Ha, SII, OIII, L, R, G, B`. |

**Instant-update invariant (FR-006 / SC-003)**: `DerivedObservability` MUST recompute from cached
`NightObservability` when `usableAltitudeDeg` (or Track A's per-band params) change — **without**
recomputing `NightObservability`. Positions are memoized per `(target, activeSiteId, dateMs)`.

### `PlanningContext` (single shared object; not persisted except where noted)

| Field | Source | Persisted? |
|-------|--------|-----------|
| `activeSite` | `observing.activeSiteId` → the site | yes (settings) |
| `dateMs` | date picker | no — defaults to "tonight" each launch (FR-008) |
| `usableAltitudeDeg` | `observing.usableAltitudeDeg` | yes (settings) |
| `twilight` / `minHorizonAltDeg` | on `activeSite` | yes (settings) |
| `sparklineBand` | chosen band for interference shading (default: band with most moon-free time) | no (v1); later global picker |

The planner table and target-detail view both compute against this one context (US1–US5), so switching site
or date recomputes everything consistently (SC-005/SC-004).

---

## 3. Ownership boundary (Track A / spec 047)

**Not defined here** (Track B consumes them): the per-band Lorentzian rule
`min_sep(moonAge) = distance / (1 + (moonAge/width)²)`, the per-band `(distance, width)` parameters
(Ha/SII/OIII/L/R/G/B, LRGB included), Moon phase/illumination presentation, per-band viability pills, and
the filter recommendation. These live in one shared frontend module + shared settings owned by 047;
`planner-derive.ts` imports `lorentzianMinSep(band, moonAge)` from it (FR-023).

---

## 4. Iterate 2026-07-15 — Camera sensor type (equipment extension)

The planner observability iterate (FR-035–FR-038; decision record
`docs/research/044-047-planner-observability-ux-iterate.md` D7) extends the
**equipment Camera model** — owned by the equipment/settings surface
(`apps/desktop/src/features/settings/Equipment.tsx`, camera DTO today
`{ id, name, aliases, autoDetected }`) — with:

| Field | Type | Notes |
|-------|------|-------|
| `sensorType` | `'mono' \| 'osc' \| null` | `null`/absent = unknown → planner behaves as mono (FR-038). |
| `passband` | `'rgb' \| Band[]` (OSC only) | `'rgb'` = plain color camera; a band subset (e.g. `['Ha','OIII']`) = dual/tri-band filter. |

Consumed ephemerally by `planner-derive.ts` for the OSC single-pass
aggregation (FR-036: strictest-band `max` of Track A's `minSeparationDeg`
across the passband). No new parameter store; the per-band Lorentzian
parameters remain spec-047-owned. Contract + generated bindings updated in
`packages/contracts`; migration numbering follows the same next-free-number
rule as §1.
