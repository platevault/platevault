# Implementation Plan: Targets Planner — Ephemeris & Observer-Location Engine (Track B)

**Branch**: `044-targets-planner-track-b` | **Date**: 2026-07-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/044-targets-planner-astronomy/spec.md`

## Summary

Replace the planner's placeholder astronomy with a real, per-site, per-date ephemeris engine.
The engine runs **entirely on the frontend** via `astronomy-engine` (MIT, offline, ±1′ — see
[research.md](./research.md) R1 and [ADR-0001](../../docs/adr/0001-astronomy-compute-boundary.md)):
it computes each target's altitude over the night, transit/rise/set, best-imaging date, and the
Moon's geometry (altitude, target↔Moon separation, Moon-up windows, dark window), then derives the
band-free total imaging time and — by integrating Track A's (spec 047) per-band Moon-avoidance rule —
the per-filter moon-free time. The **only** persistent/backend work is extending the spec-018 settings
store with an `ObserverSite` collection (default + active) and promoting the usable-altitude threshold
from localStorage into settings, plus one migration. A first-run wizard step creates the default site so
the planner works out of the box.

## Technical Context

**Language/Version**: TypeScript 5.x (desktop frontend — the bulk); Rust 1.75+ (settings extension only).
**Primary Dependencies**:
- New frontend: **`astronomy-engine` npm `2.1.19`** (add **once**; spec 047 imports the same),
  `@visx/scale|shape|group|threshold@4.0.0` (detail-pane chart), and wiring the
  **already-installed-but-unused** `@tanstack/react-table@8.21.3` (net-zero) into the table.
- Reused backend: `crates/domain/core` (`SettingsState`), `crates/app/settings`,
  `crates/persistence/db` (SQLite settings table + migration), `crates/contracts/core`, `crates/audit`,
  the settings Tauri adapter `apps/desktop/src-tauri/src/commands/settings.rs`.
**Storage**: SQLite `settings` table (spec-018 store) gains an `observing` scope (sites + default/active +
global usable-altitude threshold). No astronomy values are persisted — positions are a read-only
client-side projection.
**Testing**: `cargo test --workspace` (settings round-trip + migration), `vitest` (engine unit tests vs
reference ephemeris, mock→real swap, instant-derivation), `verify-on-windows` (site UI + wizard + recompute).
**Target Platform**: Desktop (Tauri v2 on Windows/macOS/Linux).
**Project Type**: Desktop app with a layered Rust core; astronomy compute lives in the React shell.
**Performance Goals**: threshold / Moon-parameter changes re-derive with **no perceptible delay and no
position recompute** (SC-003); a full planner load computes positions for hundreds of rows on a 10-min grid
without blocking render (compute off the render path; memoize per `(site, date)`).
**Constraints**: fully offline (FR-027); planning-grade accuracy (≈1′ / ≈±1 min, J2000→date precession
applied — FR-026); no new astronomy IPC command (compute is frontend, ADR-0001).
**Scale/Scope**: whole visible target list (tens–hundreds of rows) × one night; one Moon; multiple sites.

## Constitution Check

*GATE: passed before Phase 0 research; re-checked after this design.*

- **I. Local-First File Custody** — PASS. Reads target coordinates + FITS observer location; writes only
  settings. No image files touched; sites/threshold are metadata in the existing durable store.
- **II. Reviewable Filesystem Mutation** — N/A. This feature performs no filesystem mutation. (Settings
  writes flow through the existing audited settings path.)
- **III. PixInsight Boundary** — PASS. Planning-grade observability only; explicitly no pointing-grade
  astrometry, no image processing (FR-026, FR-028). Best-date is anti-solar transit, not opposition physics.
- **IV. Research-Led Domain Modeling** — PASS. Engine choice, accuracy, observer model, offline, track
  boundary, precession, timezone, caching are resolved in [research.md](./research.md); the compute-boundary
  is [ADR-0001](../../docs/adr/0001-astronomy-compute-boundary.md).
- **V. Portable Contracts and Durable Records** — PASS *with a recorded, accepted deviation*. Astronomy math
  lives in the shell, not behind the contract boundary — justified in ADR-0001 because the values are
  UI-derived, non-persisted, non-audited decorations; the durable record (sites, threshold) **does** go
  through the portable settings contract. Revisit trigger documented in the ADR.

**Post-design re-check**: no new violations. The one Principle-V tension is the ADR-0001 deviation above;
no `crates/ephemeris/core` is introduced (would be premature per research R1). See Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/044-targets-planner-astronomy/
├── spec.md            # committed
├── research.md        # Phase 0 (this plan) — engine/accuracy/observer/boundary decisions
├── plan.md            # this file
├── data-model.md      # Phase 1 — ObserverSite + settings extension + engine result shapes
├── contracts/         # Phase 1 — settings `observing` scope schema (no new astronomy command)
└── tasks.md           # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/desktop/src/features/targets/            # frontend engine + presentation (bulk of the work)
├── planner-astronomy.ts        # NEW — astronomy-engine wrapper: night observability per (target, site, date)
│                               #        (altitude grid, transit/rise/set, Moon alt/sep/up-windows, dark window)
├── planner-derive.ts           # NEW — pure derivations over cached samples: total imaging time,
│                               #        visible-tonight, 3 separation scalars, per-band moon-free time
│                               #        (consumes Track A's Lorentzian rule module)
├── planner-altitude.ts         # REPLACE the mock internals (STUB_OBSERVER_LAT_DEG=52.1, hash-dec,
│                               #        lunarDistanceDeg<60, midnight-transit) with real engine output;
│                               #        keep the RowAltitude/AltPoint shape the consumers already use
├── altitude-settings.ts        # RETIRE the localStorage threshold; read usable-altitude from settings
├── AltitudeSparkline.tsx       # keep hand-rolled; back x/y with the shared @visx/scale helper;
│                               #        shade usable-uptime + (chosen band) Moon-interference
├── TargetDetailV2.tsx          # replace altitudeCurve() mock; detail graph via @visx primitives
├── TargetsTable.tsx            # wire @tanstack/react-table (sort/filter/group) into existing .alm-* markup
├── observing-sites/            # NEW — site CRUD UI (list, add/edit, default/active, IANA-tz picker) + date picker
└── *.test.ts(x)                # engine vs reference, instant-derivation, no-site state, DST

apps/desktop/src/app/first-run.ts               # ADD the observing-site wizard step (coordinate w/ spec 048)
apps/desktop/src-tauri/src/commands/settings.rs # reused scope/values path — carries the `observing` scope
crates/domain/core/src/settings.rs              # SettingsState += ObserverSite[], default/active, usable_altitude_deg
crates/persistence/db/migrations/00NN_observer_sites.sql   # NEW — next free number AT IMPL TIME (see below)
```

**Structure Decision**: Frontend-first. The astronomy engine is a pair of pure TS modules
(`planner-astronomy.ts` for positions, `planner-derive.ts` for threshold/band derivations) feeding the
existing planner surfaces. The backend change is a bounded extension of the spec-018 settings store — no
new crate, no new IPC command.

### Phase topology (for tasks.md)

1. **Backend settings extension** (US3/US4 foundation): `ObserverSite` in `SettingsState`, the `observing`
   scope on the settings command, one migration, use-case + persistence round-trip, contract schema.
2. **Frontend engine core** (US1): `planner-astronomy.ts` (astronomy-engine, precession, 10-min grid,
   exact rise/set/transit) + `planner-derive.ts` (total imaging time, visible-tonight) → wire into
   `planner-altitude.ts`/`AltitudeSparkline`/`TargetDetailV2`/`TargetsTable`, replacing the mock.
3. **Site management + threshold-from-settings** (US3): site CRUD UI, active/default, usable-altitude from
   settings (retire localStorage), instant re-derivation on threshold change.
4. **Arbitrary date + best-date** (US2): date picker, `(site, date)` parameterization, anti-solar best-date.
5. **Twilight + horizon** (US4): per-site twilight (−18°/−12°) and minimum-horizon; empty-dark-window handling.
6. **Moon geometry + per-band moon-free time** (US5): Moon alt/sep series, 3 scalars, Moon-up windows,
   integrate Track A's Lorentzian rule; per-band display + sparkline interference shading.
7. **Site-first + wizard** (US6): no-site prompt; first-run wizard step; optional FITS observer-location seed.
8. **Charts/table polish + verification**: `@visx` detail graph, react-table wiring, engine-vs-reference
   tests, `verify-on-windows`.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|-----------|------------|--------------------------------------|
| Astronomy math in the frontend, not behind the contract boundary (Principle V) | Interactive recompute with no IPC; values are non-persisted/non-audited UI decorations; no viable Rust ephemeris crate exists (research R1) | A Rust core crate now means adopting a dormant crate (`astro`) or hand-porting Meeus for zero present benefit; deferred behind the ADR-0001 revisit trigger |
| Track A owns the Moon-avoidance rule that Track B integrates | Keeps the filter-domain rule + params in one place (047) while only Track B has `sep(t)`/Moon-up geometry | Track B keeping its own single separation threshold → two Moon-interference semantics across the tracks (rejected in research R5) |

## Cross-cutting coordination (see the orchestrator handover)

- **047 unification**: confirm spec 047 targets the same frontend `astronomy-engine` (shared
  `crates/ephemeris/core` dropped); the npm dep is added once.
- **Migration numbering**: the `observer_sites` migration MUST take the **next free number at implementation
  time after checking open PRs** — latest committed is `0050`; convoy reservations exist (0052 in flight,
  0056–0059). Duplicate versions abort fresh-DB migrate.
- **Wizard/spec 048**: the observing-site wizard step edits `apps/desktop/src/app/first-run.ts` (+ wizard
  step components) — coordinate with spec 048's wizard hook to avoid conflicting edits (FR-025).
- **RA/Dec**: already available — `target.list`'s `TargetListItem` carries `raDeg`/`decDeg` (verified;
  integration test `crates/app/targets/src/target_management.rs:612–629`). No plumbing needed.
