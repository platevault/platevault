# Research handover — astronomy libraries & frontend presentation (spec 044 + simplification pass)

**Date:** 2026-07-04
**Audience:** (A) the agent implementing **spec 044 — Targets Planner Astronomy**, and (B) the **orchestrator** (for the non-044 backend/infra items).
**Status:** research only. No spec artifacts or code changed by this pass. All library data verified live (crates.io / npm / GitHub / bundlephobia) on 2026-07-04.

This document exists so the mocked astronomy in the planner can be replaced with real
computation, and so hand-rolled presentation code can be reduced where a stable library
genuinely wins. It also records where hand-rolling is (still) the right call.

---

## TL;DR decision table

| Area | Decision | Owner |
|---|---|---|
| Planner astronomy math (altitude, moon, opposition, lunar distance) | **Adopt `astronomy-engine` (npm)** on the frontend | 044 |
| JS-vs-Rust astronomy boundary | **Frontend/JS for now** (non-persisted, UI-derived) — record an ADR | 044 + orchestrator |
| Moon-aware filter recommendation | **Hand-rolled Lorentzian rule table**; `distance` + `width` tunable per band; include **LRGB** | 044 |
| "Opposition" column | **Keep the term**; compute as anti-solar-RA / midnight transit | 044 |
| Detail-pane charts (altitude curve, twilight/threshold bands, polar az-alt) | **Adopt visx à-la-carte primitives** (not xychart) | 044 |
| Per-row altitude sparkline | **Keep hand-rolled**; share scale helper with detail chart | 044 |
| Targets table sort/filter/group | **Wire up the already-installed `@tanstack/react-table`** | 044 |
| Moon-phase widget | **Hand-roll ~30-line SVG**, fed by `astronomy-engine` | 044 |
| Sky/finder charts (d3-celestial / Aladin Lite) | **Phase-2**, optional; not v1 | orchestrator |
| FITS / XISF readers | **Keep hand-rolled**; do NOT adopt `fitsrs` yet | orchestrator |
| FITS/XISF publishable crate | **Extract the pure parser into a standalone, dependency-free crate** (new work) | orchestrator |

---

## 1. Planner astronomy — adopt `astronomy-engine`

`astronomy-engine` (cosinekitty) — MIT, native TypeScript, zero runtime deps, ~42–48 KB
gzip, single tree-shakeable ESM bundle, ±1 arcmin (validated vs NOVAS / JPL Horizons).
**One dependency covers the entire planner.** No Rust crate comes close (see §9), and no
other JS lib covers opposition + rise/set + moon + transforms in one package.

- npm `2.1.19`, published 2023-12-14. GitHub `master` is ~28 commits ahead but the version
  string is unchanged. **npm is safe to consume as-is** — the only unpublished bug fix
  (`VectorObserver` convergence, issue #347) is entirely in the Tier-3 / skip surface below.
  No vendoring/pinning needed unless a future feature reaches `ObserverVector`/
  `VectorObserver`/`ObserverGravity`.
- Types are excellent (authored in TS, full `.d.ts`, no `any` in the public surface).

### Tier 1 — adopt now for the 044 planner core (~12 functions)

Powers altitude curve, max altitude, imaging-time-above-threshold, visibility window,
twilight dark-window, moon phase, lunar distance, opposition/best-date:

- `MakeTime` / `AstroTime`, `Observer(lat, lon, height)`
- `Equator` / `GeoVector` — target/planet RA/Dec at a time
- `Horizon(date, observer, ra, dec, refraction)` — the altitude curve (sample across the night)
- `SearchHourAngle` / `HourAngle` — culmination → **max altitude + transit time**
- `SearchRiseSet` — target/Moon/Sun rise & set → visibility window
- `SearchAltitude` at −6 / −12 / −18° with the Sun — **twilight boundaries** (there is no
  dedicated twilight helper; this is the documented pattern) → the "tonight" dark window
- `MoonPhase` + `Illumination(Body.Moon, …)` — phase angle + illuminated fraction
- `AngleBetween(targetVec, moonVec)` — **lunar distance** (there is no dedicated function;
  compose it from two vectors — this is the intended usage)
- `SearchRelativeLongitude(body, 0, startDate)` — **opposition / best-date** (planets)

### Tier 2 — cheap, non-persisted UI wins (near-free once the lib is in)

These reuse vectors/times already computed for Tier 1 and match the "compute on the
frontend if it isn't persisted" principle:

- `Constellation(ra, dec)` — constellation label for a target
- `NextMoonQuarter` — "next new moon in N days" (narrowband planning)
- `SearchLunarApsis` — supermoon / perigee context badge
- `Seasons(year)` — annual planning markers (longest night, etc.)
- `AngleFromSun` / `SearchMaxElongation` — twilight-glow warnings; inner-planet best dates
- planet `Illumination` (`mag`, Saturn `ring_tilt`) — brightness in target info panels

### Tier 3 — skip (outside PlateVault's product boundary, Principle III)

Eclipses (`SearchLunarEclipse`/`SearchGlobalSolarEclipse`/`SearchLocalSolarEclipse`),
Mercury/Venus transits, `GravitySimulator`, `ObserverVector`/`VectorObserver`/
`ObserverGravity`/`SiderealTime` (pointing/geodesy-grade), `DefineStar`, Lagrange points,
raw rotation-matrix internals.

### The JS-vs-Rust boundary — record an ADR before implementing

There is a real tension with Constitution **Principle V** (core owns product semantics,
portable to a future non-Tauri backend). The recommendation is **frontend/JS** because:

- altitude/visibility are inherently interactive UI concerns (recompute on slider drag /
  location change with no IPC round-trip);
- these values are **UI-derived and not persisted / not audited** — they are decorations,
  not durable records;
- there is **no viable Rust ephemeris crate** (§9), so a Rust implementation means
  vendoring a dormant crate or hand-porting Meeus.

**Trigger to revisit (→ Rust):** the day the app needs server-side / catalog-wide batch
visibility scoring, or persists/audits any of these values. At that point either shell out
to the same JS engine or invest in a Rust port. **Capture this decision as an ADR**
(`docs/adr/NNNN-astronomy-compute-boundary.md`, MADR) and reference it from the 044 spec.

---

## 2. Moon-aware filter recommendation — hand-rolled Lorentzian rule table

No library encodes broadband-vs-narrowband filter guidance; every tool hand-rolls it. Use
the **Moon-Avoidance Lorentzian** (originated by BAIT; used by ACP Scheduler and NINA
Target Scheduler — the open-source `tcpalmer/nina.plugin.assistant` is the best prior art):

```
min_separation(age) = distance / (1 + (age / width)²)
```

- `age` = days from full moon (0 at full; derive from illuminated fraction)
- `distance` = required separation (°) at full moon
- `width` = days from full at which the requirement halves

**Requirements from the product owner:**

- Expose **`distance` AND `width` as user-tunable settings, per band** (not hard-coded).
- The recommended set must **include broadband L/R/G/B**, not only narrowband.

**Default parameters (starting points, all user-tunable):**

| Band | `distance` (° at full) | `width` (days) | Notes |
|---|---|---|---|
| Broadband **L / R / G / B** | 120 | 14 | most moon-sensitive |
| Narrowband **Ha / SII** | 60 | 7 | tolerant of moonlight |
| Narrowband **OIII** | ~100–120 | ~10 | empirically the most moon-sensitive NB band — stricter than Ha/SII |

Illustrative resulting table (informal community consensus — keep tunable):

| Moon illumination | L/R/G/B min sep | Ha/SII min sep | OIII min sep | Default recommendation |
|---|---|---|---|---|
| ≤10% (near new) | 0° | 0° | 0° | Broadband + all narrowband viable |
| ~25% | ~30° | ~15° | ~20° | Broadband generally fine; NB unrestricted |
| ~50% (quarter) | ~60° | ~30° | ~45° | Prefer Ha/SII unless well separated |
| ~75% (gibbous) | ~90° | ~45° | ~75° | Ha/SII preferred; avoid OIII unless far |
| 100% (full) | ~120° | ~60° | ~100°+ | Ha/SII only, well separated; avoid OIII + broadband |

This replaces the current arbitrary mock (`lunarDistanceDeg < 60` in
`apps/desktop/src/features/targets/planner-altitude.ts`). "Tonight" window = astronomical
twilight (Sun ≤ −18°); default imaging altitude floor = **30°** (2×-airmass rule),
already user-configurable via the spec-044 usable-altitude setting. Consider a separate,
looser ~15–20° "still in season" indicator distinct from the per-night imaging threshold.

---

## 3. "Opposition" column — keep the term

Keep it. Opposition = 180° from the Sun → rises at sunset, **transits at local midnight**,
up all night in the dark — which is exactly the optimal-observation condition, and the
astro community uses it for DSOs. Only nuance: a DSO does not brighten/enlarge at
"opposition" the way a planet does (no Earth-object distance change), so **don't attach a
magnitude/size change** to a DSO's opposition. Computationally it's the same solve either
way — the date the target's RA is anti-solar (RA ≈ RA_Sun + 12h) / midnight meridian
transit. `SearchRelativeLongitude(body, 0)` gives it directly for solar-system bodies; for
a fixed-coordinate DSO it's a trivial "when does the Sun's RA reach RA_target − 12h".

---

## 4. Charts — visx à-la-carte primitives (not raw d3, not xychart)

**Adopt exactly:** `@visx/scale`, `@visx/shape`, `@visx/group`, `@visx/gradient`,
`@visx/threshold` (optionally `@visx/axis`). All released v4.0.0 on 2026-06-11 (current).

- `@visx/shape`/`@visx/scale` **are** `d3-shape`/`d3-scale` wrapped as typed React
  components with **zero styling lock-in** — you keep full `<path>` + CSS-token control, so
  the "React owns the SVG / BEM-CSS-token" model is preserved.
- `@visx/threshold` is purpose-built for the **filled min-altitude band + twilight bands**
  (dual-fill that switches by which curve is on top) — the strongest concrete win over
  hand-rolling.
- `@visx/shape` exports `LineRadial` for the **polar azimuth–altitude path**.
- For **yearly small-multiples**, use only these stateless primitives — **avoid
  `@visx/xychart`** (≈50 KB, per-instance React context + event bus; wrong for 50–200
  mini charts).
- Risk: visx is effectively single-maintainer (bus factor ≈ 1). Mitigation: depend only on
  the small primitive packages (trivial to vendor/fork); stay off `xychart`.

Raw d3 (`d3-scale`/`d3-shape`/`d3-time`) is the acceptable fallback if visx is ever
dropped — same math, minus the typed React wrappers, plus `@types/d3-*` from
DefinitelyTyped.

---

## 5. Per-row sparkline — keep hand-rolled

Nothing clears the bar: `react-sparklines` (9-yr stale), `@visx/sparkline` (doesn't
exist), `uPlot`/`reaviz` (the heavy "one chart instance per row" trap at 50–200×),
`react-tiny-sparkline` (2★, 4 months old, unproven). **Keep `AltitudeSparkline.tsx`
hand-rolled**, but back its x/y math with the **same `@visx/scale`/`d3-scale` helper** as
the detail chart so there's one coordinate-mapping path. The "stroke turns usable colour
above threshold" is a two-`<path>` split at the crossing — the same technique
`@visx/threshold` uses internally, no dependency needed.

---

## 6. Targets table — wire up the already-installed react-table

`@tanstack/react-table@8.21.3` **is already in `apps/desktop/package.json` and the
lockfile but is never imported** — a dead dependency you already ship. `@tanstack/
react-virtual@3.13.2` **is** used widely (TargetsTable, TargetList, LogPanel, sessions,
inbox, TargetSearch). The Targets table currently hand-rolls sort/grouping via
`[...rows].sort()` + `useMemo` in `TargetsTable.tsx`.

**Action:** roll up react-table — wire it into `TargetsTable` (column defs + sorting +
faceted filtering + grouping) to replace the hand-rolled state, keeping the existing
`.alm-*` markup/classes (headless lib → no imposed DOM). Net new dependency cost: **zero**.

---

## 7. Moon-phase widget — hand-roll, fed by astronomy-engine

The dedicated React moon-phase component ecosystem is dead/toy-quality. Hand-roll a
~30-line terminator-ellipse SVG driven by `Illumination(Body.Moon).phase_fraction` +
`MoonPhase()` from `astronomy-engine` (already in for Tier 1). Do **not** add a second
astronomy lib (e.g. suncalc) just for phase.

---

## 8. Sky / finder charts — phase-2 (orchestrator)

Optional, not v1. Two layers if pursued later:

- **d3-celestial** (ofrohn, BSD-3) — offline vector star/constellation chart. It's quiet
  (real commits stop ~2022) but renders a **fixed** star catalog, so "quiet" ≠ "wrong
  data". No maintained alternative exists (Stellarium-Web is AGPL; WWT is MIT but
  streaming-first/heavy; the rest are decorative or unlicensed). If adopted: **vendor/fork
  it** (BSD-3 allows) and patch only for ESM/Vite/React-19 compat.
- **Aladin Lite** (CDS, LGPL-3.0) — real DSS photographic imagery + FOV overlay, genuine
  value for **framing/mosaic** planning. Effort **medium**: no maintained React wrapper or
  TS types → hand-roll a lifecycle wrapper. Local-first is achievable (point the survey
  base URL at a localhost/app-data tile cache; per-field footprint is KB–MB, not the
  multi-TB full survey) **but requires building the prefetch-and-cache subsystem** — that's
  the real work, distinct from the render wrapper. Sequence as a "framing view" after core
  planning ships; design the offline cache explicitly (don't ship an online-only best-effort).

---

## 9. FITS / XISF — keep hand-rolled + extract a publishable crate

### 9a. Do NOT adopt `fitsrs` (yet)

`fitsrs` (cds-astro) is the one good pure-Rust, MSVC-safe FITS crate, but:

- It has **zero Cargo features** — no `default-features = false` path to header-only. You'd
  unconditionally carry an async facade + WCS/astrometry (`wcs`/`mapproj`/`enum_dispatch`)
  + compression subtree the app never calls.
- It provides **no new header capability** today — same generic-keyword-map behavior the
  existing 640-line reader already has (confirmed it surfaces non-standard capture-software
  keywords like `OBJCTRA`, `XBINNING`, `GAIN`).
- It has a **demonstrated 0.x breaking-change history** (0.3.0 changed the HDU model and
  `Header.get` signature), no 1.0 roadmap. "Adopt now to avoid a later refactor" is
  **not supported** — it front-loads a *different* refactor for zero present benefit.
- **Trigger to revisit:** the day a spec needs pixel decode, RICE/tile-compressed
  extensions, multi-HDU tables, or WCS math (all currently PixInsight/WBPP's job per
  Principle III). Re-evaluate against fitsrs's API *at that time*.

Same conclusion for XISF: no production-grade, permissive, header-scoped library exists in
any language. Keep the quick-xml reader.

### 9b. NEW work — extract a standalone, publishable FITS-header crate

Product-owner directive: keep hand-rolling, **but split the reusable parser into its own
crate so it can be published later** (it fills a genuine ecosystem gap — a lightweight,
pure-Rust, header-only FITS reader). Current state and plan:

- The FITS reader **is already a crate** (`crates/metadata/fits`, package `metadata_fits`)
  but it is **coupled to the app** — it imports from `metadata_core`: `RawFileMetadata`,
  the `MetadataExtractor` trait, `MetadataExtractError`, and the `sexagesimal_ra_to_deg` /
  `sexagesimal_dec_to_deg` / `parse_f64` / `parse_i64` helpers. So it is **not** publishable
  as-is.
- **Plan:** extract the pure parser (raw 2880-byte block reading, 80-byte card parsing,
  END/HIERARCH/comment handling, keyword→value map, numeric/sexagesimal value parsing)
  into a new **dependency-free** crate (suggested `fits-header`, MIT/Apache-2.0, with its
  own `README`, `description`, `keywords`, `categories`, and `publish = true`). It should
  return a **generic keyword map / typed `Header`**, not app domain types.
- `metadata_fits` then becomes a **thin app adapter**: depends on `fits-header` +
  `metadata_core`, and implements `MetadataExtractor` by mapping the keyword map →
  `RawFileMetadata`. The sexagesimal/number helpers move to (or are duplicated in) the
  standalone crate; `metadata_core` re-exports or keeps its own for other callers
  (`app/inbox`, `app/targets`, `calibration/master-detect`, `metadata/xisf` also depend on
  `metadata_core` — do not break them).
- Apply the **same split to XISF** (`metadata_xisf` → publishable `xisf-header` +
  adapter) — XISF is even more niche, so a clean pure-Rust header crate has real value.

**Routing:** this is **backend crate restructuring — it must NOT land on the
`redesign-ui-platevault` UI branch** (backend churn on a UI branch, and the concurrent UI
agent shares that checkout). Give it its **own small backend spec/tinyspec on its own
branch off `main`**. It is independent of spec 044.

---

## Action items

### For the spec-044 agent (frontend)

1. Promote spec 044 to a full feature and adopt **`astronomy-engine`** (Tier 1 fn set
   above); wire real values into `planner-altitude.ts` / `TargetDetailV2.tsx`, replacing
   the mocks.
2. Implement the **Lorentzian filter model** with `distance` + `width` **tunable per band**
   and **LRGB included**; defaults in §2.
3. Keep the **"Opposition"** label; compute it as anti-solar-RA / midnight transit.
4. Adopt **visx primitives** for the detail-pane altitude/opposition/polar graphs; keep the
   **sparkline hand-rolled** sharing the scale helper.
5. **Wire up the already-installed `@tanstack/react-table`** in `TargetsTable` (replaces
   hand-rolled sort/filter/group).
6. Hand-roll the **moon-phase SVG** fed by `astronomy-engine`.
7. Surface Tier-2 cheap wins where they fit the UI (constellation label, next-new-moon
   countdown, seasons, elongation warnings).

### For the orchestrator (non-044)

1. **Record an ADR** on the astronomy compute boundary (JS-now / Rust-when-persisted;
   Principle V) before 044 implementation; reference it from the 044 spec.
2. **Extract a publishable `fits-header` crate** (and later `xisf-header`) per §9b — its
   own backend spec/tinyspec, own branch off `main`, **not** on the UI branch.
3. **Keep** the FITS/XISF/video readers otherwise; watch `fitsrs` for the future-growth
   trigger in §9a.
4. Sky/finder charts (d3-celestial / Aladin Lite) are **phase-2** — schedule only after
   core planning ships; the offline tile-cache subsystem is the real cost for Aladin.

---

## Evidence appendix (verified 2026-07-04)

| Library | Version | License | Signal |
|---|---|---|---|
| `astronomy-engine` | npm 2.1.19 (2023-12-14) | MIT | ~48 KB gzip, native TS, ±1 arcmin vs NOVAS/Horizons; repo triaged into 2026; one unpublished fix in skip-surface only |
| `@visx/*` | 4.0.0 (2026-06-11) | MIT | current; shape/scale = typed d3 wrappers; single-maintainer bus factor |
| `d3-scale`/`d3-shape`/`d3-time` | 4.0.2 / 3.2.0 / 3.1.0 | ISC | frozen-but-infrastructure (250M+/mo); no bundled types |
| `@tanstack/react-table` | 8.21.3 | MIT | already installed, **unused**; MIT headless |
| `@tanstack/react-virtual` | 3.13.2 | MIT | already installed, **in use** |
| `d3-celestial` | 0.7.35 | BSD-3 | offline vector catalog; last real commit ~2022 (fixed data → low risk) |
| `aladin-lite` | 3.9.0-beta (2026-06-01) | LGPL-3.0+ | CDS-backed, active; no React wrapper / TS types; needs offline tile cache |
| `fitsrs` (Rust) | 0.4.1 | MIT/Apache-2.0 | pure-Rust MSVC-safe, **zero Cargo features**, 0.x breaking history; header API surfaces arbitrary keywords |
| `fitsio` (Rust) | 0.21.x | Apache/MIT/CFITSIO | **rejected** — wraps cfitsio C, Windows-MSVC unsupported |

Prior art for the filter model: `tcpalmer/nina.plugin.assistant` (C#, open source),
`astroplan` (Python, constraints only — no filter logic).

---

## Addendum (2026-07-04, product owner) — §4 charts refined

Final visx decision, superseding §4's package list:

**Adopt exactly four:** `@visx/scale` (one time-scale x = night hours + one linear
y = altitude; SHARE this scale helper with the hand-rolled row sparkline — single
coordinate-mapping path per the shared-component rule), `@visx/shape`
(LinePath/AreaClosed; LineRadial later for polar az/alt), `@visx/group`,
`@visx/threshold` (the reason to adopt: purpose-built dual-fill switching for the
usable-altitude band + twilight/dark-window bands + 047's interference shading).

**Skip:** `@visx/gradient` — fills come from `--alm-*` CSS theme tokens so charts
track all 4 themes; don't let a lib own color. `@visx/axis` — keep the existing
lightweight hand-rolled theme-consistent ticks. `@visx/xychart` — hard no
(~50 KB, per-instance React context/event bus; catastrophic at 50–200 mini charts).

**Guardrails:** visx shape/scale emit plain `<path>` — React-owns-the-SVG +
`.alm-*` BEM/token styling stays intact. Bus-factor mitigation is structural:
tiny individually-forkable primitives only; fallback is raw `d3-scale`+`d3-shape`
(ISC) with identical math. The d3-only alternative remains defensible if
minimizing single-maintainer deps ever outweighs `@visx/threshold`'s convenience.
