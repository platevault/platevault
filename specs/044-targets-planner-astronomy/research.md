# Research: Targets Planner — Ephemeris & Observer-Location Engine (Track B)

**Feature**: 044 Track B | **Date**: 2026-07-04 | **Spec**: [spec.md](./spec.md)
**Gate**: Constitution Principle IV (Research-Led Domain Modeling) — research precedes the plan.
**Primary source**: [`docs/research/044-frontend-astronomy-libraries.md`](../../docs/research/044-frontend-astronomy-libraries.md)
(library survey, all versions/licenses verified live on 2026-07-04) and
[ADR-0001](../../docs/adr/0001-astronomy-compute-boundary.md).

This document records the decisions the plan depends on. Each is a resolved research question;
none is left as `NEEDS CLARIFICATION`.

---

## R1 — Ephemeris engine choice

**Decision**: Adopt **`astronomy-engine`** (cosinekitty, npm `2.1.19`) on the **frontend** (React/TS).
No Rust ephemeris crate, no ported Meeus algorithms, no ERFA/SOFA binding.

**Rationale**:
- **Coverage**: one dependency covers the entire planner — coordinate transforms, `Horizon()`
  (altitude curve), `SearchHourAngle`/`SearchRiseSet` (transit/rise/set), `SearchAltitude` at
  −6/−12/−18° (twilight → dark window), `Illumination`/`MoonPhase` (Moon), `AngleBetween`
  (target↔Moon separation). No other single library spans this.
- **License**: MIT — safe to ship in a desktop app (verified from the repo, not just npm metadata).
- **Offline/self-contained**: embedded VSOP87; **no data files**, no network. Satisfies the
  local-first constitution and FR-027.
- **Accuracy**: ±1 arcmin vs NOVAS / JPL Horizons — far tighter than planning-grade needs (R2).
- **Bundle**: ~48 KB gzip, tree-shakeable ESM, native TypeScript types.
- **Maintenance**: single-maintainer but pure TS with zero deps → trivially vendorable/pinnable if
  a needed fix never reaches npm. npm `2.1.19` is safe as-is; the only unpublished fix
  (`VectorObserver` convergence) is entirely outside the functions this feature uses.

**Alternatives rejected**:
- **Rust crate now** (`astro`/saurvs): dormant since 2019 with known unfixed bugs. ANISE:
  flight-grade but heavy (SPICE binary kernels, a frames/states programming model) — disproportionate.
  `hifitime`: time-scales only, no body positions. → No viable maintained pure-Rust ephemeris crate.
- **Hand-port Meeus into a Rust core crate**: higher implementation cost (moon phase + alt/az +
  rise/set + best-date) for **no present benefit**, since these are non-persisted UI decorations.
  Deferred, not rejected — it is the revisit path in ADR-0001.

**Compute-boundary (Constitution Principle V)**: recorded in **ADR-0001** (Accepted). Frontend/JS is
acceptable because the computed values are UI-derived, **not persisted and not audited** — no durable
record depends on them. The ADR's revisit trigger: server-side/catalog-wide batch visibility scoring,
or any of these values becoming persisted/audited.

## R2 — Accuracy target

**Decision**: **Planning-grade** — ≈1 arcmin in altitude, ≈±1 minute for rise/set/transit. Explicitly
**not** pointing-grade.

**Rationale**: the planner answers "is this target above 30° for 2+ hours tonight, and is the Moon a
problem" — a planning question. `astronomy-engine`'s ±1′ exceeds it comfortably. Pointing correction
(nutation/aberration/proper motion) is the mount's / PixInsight's job (Constitution Principle III).
**One correction is mandatory**: stored coordinates are J2000; they MUST be precessed to the date of
observation before horizontal-coordinate computation (R6) — ~20′ drift by 2026 → ~1–2 min on rise/set,
which matters at ±1-min grade. (SC-001/SC-002, FR-026.)

## R3 — Observer model & persistence

**Decision**: A new persisted **`ObserverSite`** collection on the **spec-018 settings store** — multiple
named sites, one `default`, one `active`. Each site: name, latitude, longitude, elevation, IANA timezone,
twilight definition, minimum-horizon altitude. Plus a **global** `usable_altitude_deg` threshold promoted
from localStorage into settings. Optional seed from FITS session observer location (confirmed, never silent).

**Rationale**: sites are durable user configuration, exactly the settings store's role. The scope/values
IPC already round-trips **structured arrays** (`pattern: PatternPart[]`, `protectedCategories: string[]`),
so an `ObserverSite[]` needs no new transport — only a new settings scope + one migration. The existing
per-session `ObserverLocation` (in `crates/metadata/core`) stays the acquisition-time record and merely
seeds a site.

**Privacy**: coordinates are entered manually and stored locally; **no online geocoding** and no telemetry
(FR-011, FR-027). Timezone is picked from a **bundled IANA list** (see R7).

**Alternatives rejected**: single hard-coded site (fails multi-site real users); a separate new DB table
outside settings (needless — settings already models durable structured config with audit + migration).

## R4 — Offline requirement

**Decision**: **Everything computes locally.** No online ephemeris service, no geocoding, no tile/catalog
fetch for any in-scope computation.

**Rationale**: Constitution Principle I (local-first custody) and FR-027. `astronomy-engine` embeds its
own theory (VSOP87) so this is satisfied by construction; the only external-data temptation (timezone
lookup, geocoding) is removed by manual entry + a bundled IANA list.

## R5 — Scope boundary vs Track A (spec 047)

**Decision**: **Track B owns time × observer-location × position** (raw geometry over the night);
**Track A owns the Moon-avoidance product rule** (per-band Lorentzian + filter advice). Track B *consumes*
Track A's rule to integrate per-band moon-free time but never defines the tolerances.

**Interface (so the tracks don't block each other)**:
- Track B **produces**, per target/site/date: altitude samples, transit, rise/set, best-imaging date,
  Moon altitude(t), target↔Moon separation(t), three separation scalars (transit / min-over-dark /
  dark-midpoint), Moon-up windows, the dark window, and the band-free total imaging time.
- Track A **produces** a shared frontend module + shared settings: the per-band Lorentzian
  `min_sep(moonAge) = distance / (1 + (moonAge/width)²)` with tunable `(distance, width)` per band
  (Ha/SII/OIII/L/R/G/B, LRGB included), phase/illumination, per-band viability pills, filter recommendation.
- Track B **integrates**: `moonFreeTime(b) = Σ` intervals where `alt ≥ usable ∧ t ∈ dark ∧
  ¬(MoonUp ∧ sep(t) < lorentzian_min_sep(b, moonAge))`.

**Consequence — engine unification**: both tracks use the ONE frontend `astronomy-engine`; the previously
planned shared `crates/ephemeris/core` is **dropped**. The npm dep is added **once**; the second track
imports it. Only shared backend work across tracks = the ObserverSite settings model.

**Alternatives rejected**: Track B keeping its own single conservative `min_lunar_separation_deg` threshold
for a column while Track A shows per-band → two Moon-interference semantics; rejected as inconsistent. The
single knob is retired.

## R6 — Precession (J2000 → of-date)

**Decision**: Precess stored J2000 RA/Dec to the **date of observation** before any horizontal-coordinate
(`Horizon()`) call — via `astronomy-engine`'s `DefineStar` + of-date `Equator`, or `Rotation_EQJ_EQD`.
`Constellation(ra, dec)` takes J2000 directly (no precession).

**Rationale**: ~20′ drift by 2026 → ~1–2 min on rise/set; at ±1-min planning grade this is not negligible.
The current mocks skip it; the plan must not. Note the library-research "Tier-3 skip list" mentions
`DefineStar`/rotation internals — that skip guidance is superseded here: the of-date path is required.
(FR-026, SC-001/SC-002.)

## R7 — Timezone source (offline site picker)

**Decision**: Bundle a static **IANA timezone list** for the site picker; resolve local time from the
site's IANA zone. No online timezone/geo lookup.

**Rationale**: sites store an IANA zone (e.g. `Europe/Amsterdam`); rise/set/transit and the night window
render in the site's local time, correct across DST (FR-011, SC-012). A bundled list keeps entry offline.
Implementation detail (a static list vs the platform tz database) is a plan/impl choice; the constraint is
offline + IANA-keyed.

## R8 — Refresh / caching model

**Decision**: **On-demand, client-side, no persistence.** Positions/times are computed once per
`(active site, date)`; **threshold- and Moon-parameter-dependent values re-derive from the already-computed
positions without recomputing where anything is in the sky.**

**Rationale**: FR-006 / SC-003 require instant updates when the usable-altitude slider or Track A's per-band
parameters change — a pure derivation over cached samples, not a re-solve. Positions are a read-only
projection (nothing persisted or audited), consistent with ADR-0001. Sampling is a fixed **10-minute grid**
for the curve/sparkline/imaging-time/interference windows; the three headline event times
(rise/set/transit) are **refined exactly** via `SearchRiseSet`/`SearchHourAngle` (window-edge ±5 min is
immaterial at planning grade, uniform + cheap across hundreds of rows).

---

## Presentation-layer decisions (from the library research; plan-stage, not spec)

Carried for the plan; they are UI concerns, not product requirements:

- **Charts**: adopt exactly four visx primitives — `@visx/scale`, `@visx/shape`, `@visx/group`,
  `@visx/threshold` (dual-fill for the usable-altitude band + twilight bands + 047's interference shading).
  **Skip** `@visx/gradient` (fills from `--alm-*` theme tokens), `@visx/axis` (keep the hand-rolled
  theme-consistent ticks), and `@visx/xychart` (hard no — ~50 KB, per-instance context/event bus,
  catastrophic at 50–200 mini charts).
- **Sparkline**: keep `AltitudeSparkline.tsx` **hand-rolled**, backed by the **same `@visx/scale` helper**
  as the detail chart (one coordinate-mapping path, per the shared-component rule).
- **Table**: wire the **already-installed-but-unused** `@tanstack/react-table@8.21.3` into `TargetsTable`
  for sort/filter/group (net-zero dependency), keeping the `.alm-*` markup (headless lib).
- **Moon-phase widget**: hand-roll a ~30-line terminator-ellipse SVG fed by `Illumination`/`MoonPhase`;
  do not add a second astronomy lib.

## Out of scope (owned elsewhere — do not pull in)

- Track A (047): the Lorentzian rule, per-band `(distance, width)`, viability pills, filter recommendation,
  Moon phase/illumination presentation.
- Orchestrator/backend: publishable `fits-header`/`xisf-header` crate extraction (own tinyspec off `main`,
  **not** this UI branch); sky/finder charts (d3-celestial / Aladin Lite) are phase-2.
- Planets/comets/asteroids; pointing-grade astrometry; online services (FR-028/FR-026/FR-027).
