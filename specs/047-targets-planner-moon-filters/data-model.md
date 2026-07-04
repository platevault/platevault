# Data Model: Targets Planner — Track A (spec 047)

**Scope**: one persisted settings key (spec-018 store) + non-persisted
frontend-derived shapes. No new tables, no SQL migration (the spec-018
`settings` table is a generic key/value store; adding a key is a
registry/descriptor change only). Per ADR-0001, all astronomy values are
UI-derived decorations and MUST NOT be persisted or audited.

## Persisted state

### Settings key: `plannerMoonAvoidance` (spec-018 settings store)

One structured JSON value (precedent: the `PatternsByType` structured key).

```jsonc
{
  "L":    { "distanceDeg": 120, "widthDays": 14 },
  "R":    { "distanceDeg": 120, "widthDays": 14 },
  "G":    { "distanceDeg": 120, "widthDays": 14 },
  "B":    { "distanceDeg": 120, "widthDays": 14 },
  "Ha":   { "distanceDeg": 60,  "widthDays": 7 },
  "SII":  { "distanceDeg": 60,  "widthDays": 7 },
  "OIII": { "distanceDeg": 110, "widthDays": 10 }
}
```

| Property | Value |
| --- | --- |
| Key | `plannerMoonAvoidance` |
| Value shape | object with **exactly** the seven band keys `L,R,G,B,Ha,SII,OIII`; each value `{ distanceDeg: number, widthDays: number }` |
| Validation | `distanceDeg ∈ [0, 180]`; `widthDays ∈ [0.5, 30]`; unknown/missing band keys or extra properties → `value.invalid` |
| Default | table above (LRGB 120/14 · Ha/SII 60/7 · OIII 110/10) |
| `noisy` | false (explicit user edits; audited normally) |
| `overridable` (per-source) | false |
| Reset | included in `settings.restore-defaults` (whole key restored atomically) |

Backend changes (all within the existing spec-018 machinery):

- `crates/app/settings/src/descriptors.rs`: new `Descriptor` +
  `ValidationRule::MoonAvoidanceBands` (structured-object rule, modelled on
  `PatternsByType`).
- `SettingsState` (contracts core DTO): new field
  `planner_moon_avoidance` / `plannerMoonAvoidance` with serde default =
  shipped table (old persisted states hydrate cleanly — no migration).
- Default-value + hydration arms in `crates/app/settings/src/lib.rs`
  (`default_value_for_key`, `apply_value_to_state`), covered by the existing
  `descriptor_keys_match_state_defaults` test.

### Explicitly NOT persisted

- Moon phase/illumination/position, lunar separations, viability pills,
  derived recommendation, opposition dates — recomputed per observing night
  (ADR-0001 revisit-trigger applies if that ever changes).
- The usable-altitude threshold stays in localStorage untouched (FR-016;
  Track B promotes it to settings).
- The observing night itself (pure function of the system clock).

## Derived (frontend-only) shapes

### `ObservingNight`

Produced once per night by `features/targets/astro/observing-night.ts` +
`moon-state.ts`; memo key `nightKey`.

| Field | Type | Notes |
| --- | --- | --- |
| `nightKey` | `string` | local calendar date of the anchoring midnight (e.g. `2026-07-05`) |
| `midnight` | `Date` | the upcoming/in-progress local midnight instant (evaluation time) |
| `phaseName` | 8-phase enum | `new · waxing-crescent · first-quarter · waxing-gibbous · full · waning-gibbous · last-quarter · waning-crescent` (i18n-rendered) |
| `waxing` | `boolean` | phase angle < 180° |
| `illuminationFrac` | `number 0..1` | `Illumination(Body.Moon).phase_fraction` |
| `moonAgeFromFullDays` | `number 0..14.77` | `|phaseAngle − 180| / 360 × 29.530588` — Lorentzian input |
| `moonVec` | unit vector | geocentric Moon direction at `midnight` |

### `RowMoonPlanning` (per target row; replaces the mocked fields)

| Field | Type | Notes |
| --- | --- | --- |
| `lunarSeparationDeg` | `number 0..180 \| null` | null = unknown coordinates |
| `bandViability` | `Record<Band, boolean> \| null` | `sep ≥ minSep(band, age, params)`; boundary counts viable |
| `recommendation` | `'broadband-ok' \| 'narrowband-only' \| 'avoid-tonight' \| 'unknown'` | derived from `bandViability` |
| `nextOppositionDate` | `string (ISO date) \| null` | date-level; null = unknown coordinates |
| `daysToOpposition` | `number \| null` | sort key, soonest-next; unknowns last |

`Band = 'L' | 'R' | 'G' | 'B' | 'Ha' | 'SII' | 'OIII'` (fixed, v1).

### `MoonAvoidanceParams`

Frontend mirror of the settings key value: `Record<Band, { distanceDeg:
number; widthDays: number }>`. Exported from `astro/moon-avoidance.ts`
together with `DEFAULT_MOON_AVOIDANCE` so Track B (spec 044) imports the same
types, defaults, and rule functions — single shared module, single settings
key.

## Relationships

```text
settings store ──plannerMoonAvoidance──▶ MoonAvoidanceParams ─┐
system clock  ──────────▶ ObservingNight (1 per night) ───────┼─▶ RowMoonPlanning (per target)
target.list row ─raDeg/decDeg──────────────────────────────────┘
ObserverSite existence (Track B key) ──▶ site gate (render/no-render only; never an input)
```
