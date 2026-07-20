# Implementation Plan: Targets Planner — Track A (Moon-Aware, Filter-Aware Planning)

**Branch**: `047-targets-planner-moon-filters` | **Date**: 2026-07-04 | **Spec**: `specs/047-targets-planner-moon-filters/spec.md`

**Input**: Feature specification from `specs/047-targets-planner-moon-filters/spec.md`

## Summary

Replace the planner's mocked moon/filter/opposition values with real
planning-granularity computation done entirely in the React/TypeScript
frontend via `astronomy-engine` (per ADR-0001): a nightly Moon summary (phase
name, illumination, waxing/waning), real per-target lunar separation, per-band
filter viability from the Moon-avoidance Lorentzian rule (fixed band set
L/R/G/B/Ha/SII/OIII, per-band tunables persisted in the spec-018 settings
store), and a real next-opposition date — all gated behind
prompt-for-site-first, with unknown-coordinate rows shown as explicit unknown
states. No Rust astronomy code, no new IPC commands, no SQL migration.

## Technical Context

- **Language/stack**: TypeScript / React 19 (apps/desktop, Tauri shell).
  Backend touch is limited to the spec-018 settings crate (Rust) for one new
  settings key.
- **New dependency**: `astronomy-engine` npm `2.1.19` (cosinekitty; MIT,
  zero runtime deps, native TS, ~48 KB gzip; version re-verified current via
  mcp-package-version 2026-07-04). **Added ONCE across 044/047**: Track B's
  plan.md does not exist yet (its handover pre-dates planning), so 047 adds
  the dependency and Track B imports it. If Track B lands its plan first and
  claims the dep, 047's setup task degrades to a no-op import check.
- **Engine boundary (decided, ADR-0001)**: ALL moon math — phase,
  illumination, elongation/age, geocentric position, angular separation — is
  frontend `astronomy-engine`. The shared Rust ephemeris crate was dropped;
  no Rust lunar code anywhere in this spec.
- **Persistence**: one new spec-018 settings key (`plannerMoonAvoidance`,
  see data-model.md). The `settings` table is a generic key/value store
  (migration `0013_settings.sql`), so **no SQL migration is required** — the
  key gets a descriptor, default, validation rule, `SettingsState` field, and
  contract-enum entry. Migration-ledger discipline noted for completeness:
  had a migration been needed it would take the next free number at
  implementation time after checking open PRs (convoy currently holds 0052 /
  0056–0059; #414 adds 0060) — not applicable here.
- **Contracts**: no new IPC commands. Compute is frontend-only;
  `target.list`'s `TargetListItem` already carries `raDeg`/`decDeg` (J2000,
  verified end-to-end in `crates/app/targets/src/target_management.rs`),
  plus `magnitude`/`constellation`. Settings flow through the existing
  spec-018 `settings.get` / `settings.update` / `settings.restore-defaults`
  commands; their key enums are extended (see contracts/).
- **Testing**: Vitest component/unit tests (frontend), `cargo test -p
  app_settings` (settings key), almanac/planetarium fixture tests for
  SC-001/002/003 tolerances. `just lint` / `just test` / `just typecheck`.
- **i18n**: all new strings via the Paraglide message catalog (spec 046
  discipline; no literal UI strings).
- **A11y**: keyboard-first sorting via the existing shared `SortHeader`
  component with sort-state announcement (WCAG AA baseline).
- **Performance goal**: 5,000-row planner stays responsive (SC-007) — the
  nightly Moon state is computed once per observing night; per-row work is
  O(1) trigonometry memoized with the existing row-derivation `useMemo`.

## Constitution Check

*GATE: checked at plan creation; re-check after Phase 1 design — PASS.*

- **I. Local-First File Custody** — PASS. No image files touched; feature is
  read-only presentation over already-catalogued target metadata.
- **II. Reviewable Filesystem Mutation** — PASS (N/A). No filesystem
  operations, no plans. The one persisted change (settings key) flows through
  the existing audited settings pipeline. Guidance is advisory display, and
  every inferred value is either a real computation with documented tolerance
  or an explicit unknown state (no fabricated confidence).
- **III. PixInsight Boundary** — PASS. Planning/recommendation only; no
  calibration, stacking, or image processing. Filter guidance recommends
  acquisition choices; it never processes data.
- **IV. Research-Led Domain Modeling** — PASS. Engine selection and the
  filter-guidance model are documented research decisions:
  `docs/adr/0001-astronomy-compute-boundary.md` (frontend astronomy-engine;
  options compared, tradeoffs recorded) and
  `docs/research/044-frontend-astronomy-libraries.md` §1–§3 (Lorentzian
  moon-avoidance rule with prior art — BAIT/ACP/NINA Target Scheduler —
  per-band defaults, "Opposition" naming). Defaults remain user-configurable
  per library variation. No open research questions remain → **no
  research.md artifact** (one residual range in the research doc — OIII
  distance "~100–120°" — is resolved as a recorded default decision of 110°,
  midpoint, tunable; a parameter choice, not a research question).
- **V. Portable Contracts and Durable Records** — PASS with recorded
  rationale. Astronomy values are UI-derived, non-persisted, non-audited
  decorations (ADR-0001); the only durable state is the settings key, carried
  by the existing language-neutral settings contracts. ADR-0001 defines the
  triggers that would move computation behind the contract boundary.

**Product constraints check**: no hashing, no symlink traversal, no cleanup
semantics involved. PASS.

## Project Structure

### Documentation (this feature)

```text
specs/047-targets-planner-moon-filters/
├── spec.md              # amended: Lorentzian per-band model + site gate
├── plan.md              # this file
├── data-model.md        # settings key + derived (non-persisted) shapes
├── contracts/           # spec-018 settings-surface extension (no new IPC)
│   └── settings.plannerMoonAvoidance.md
└── tasks.md             # dependency-ordered tasks by user story
```

No `research.md` (see Constitution Check IV). No `quickstart.md` (feature is
UI-visible; verification is test-driven plus verify-on-windows).

### Source Code (repository root)

> **Reconciliation note (2026-07-19, issue #764)**: the `SettingsState`
> struct file path below was wrong — corrected to
> `crates/domain/core/src/settings.rs` (`contracts_core::settings`
> re-exports it; `crates/app/settings/` only holds the descriptor table
> that operates on it, per `crates/app/settings/src/descriptors.rs`'s own
> module doc).

```text
apps/desktop/src/features/targets/
├── astro/                          # NEW — Track A astronomy (frontend-only)
│   ├── observing-night.ts          # night anchor: upcoming/in-progress local midnight
│   ├── moon-state.ts               # phase name, illumination, waxing/waning, age, geo vector
│   ├── lunar-separation.ts         # target RA/Dec ↔ Moon angular separation
│   ├── opposition.ts               # next anti-solar (midnight-culmination) date from RA
│   └── moon-avoidance.ts           # SHARED Lorentzian rule module (047 owns; 044 consumes)
├── guidance-settings.ts            # NEW — settings-backed per-band params (hook + reads)
├── planner-altitude.ts             # MODIFIED — moon/filter/opposition mocks removed;
│                                   #   altitude placeholder path retained (FR-015)
├── TargetsTable.tsx                # MODIFIED — real lunarDist/filters/opposition cells + sorts
├── TargetsPage.tsx                 # MODIFIED — moon summary + site-gate prompt state
├── FilterBadges.tsx                # MODIFIED — parameterised per-band viability pills
└── MoonSummary.tsx                 # NEW — nightly moon summary (incl. small phase SVG)

apps/desktop/src/features/settings/
└── PlannerSettings.tsx             # MODIFIED — compact per-band (distance,width) table + reset

crates/app/settings/src/            # MODIFIED — descriptor + validation
crates/domain/core/src/settings.rs  # MODIFIED — SettingsState field (canonical
                                     #   struct definition; NOT crates/app/settings/)
crates/contracts/core/src/          # MODIFIED — re-exports SettingsState from domain_core

specs/018-settings-configuration-model/contracts/
                                    # MODIFIED — key enum additions (get/update/restore-defaults)
apps/desktop/messages/              # MODIFIED — new i18n strings
```

**Structure Decision**: all astronomy lives in a new
`features/targets/astro/` folder so the Track A compute surface is one
importable unit; `moon-avoidance.ts` is deliberately self-contained (pure
functions over `(band, ageDays, params)`) because Track B (spec 044)
integrates the same rule over its time-sampled geometry — one shared module,
one parameter store, per the Track B handover §6.

## Design Decisions

### D1 — Observing night anchor (FR-005)

"Tonight" = the night containing the upcoming or in-progress local midnight,
from the system clock/timezone. The nightly Moon state is evaluated once per
night **at that local-midnight instant** (Moon moves ~0.5°/h; well inside the
±2° separation tolerance). `observing-night.ts` exposes a stable `nightKey`
(e.g. the local calendar date of that midnight) used as the memoization key;
values change only when the night rolls over (next local noon boundary), so
nothing flips at 00:00 mid-session. A lightweight re-check on window focus /
hourly tick picks up day changes, DST shifts, and clock changes (edge cases).

### D2 — Moon state (FR-001..004)

`astronomy-engine`: `Illumination(Body.Moon, t)` → illuminated fraction;
`MoonPhase(t)` → ecliptic phase angle (0=new, 180=full) → standard 8-phase
name + waxing/waning (angle <180 waxing); geocentric Moon position via
`GeoVector(Body.Moon, t, true)`. Moon **age for the Lorentzian rule** = days
from full: `|phaseAngle − 180| / 360 × 29.530588`. Accuracy (±1 arcmin class)
vastly exceeds the ±3-percentage-point / ±2° planning tolerances.

### D3 — Lunar separation (FR-006..008)

Target unit vector from catalogued J2000 RA/Dec (`VectorFromSphere` /
inline trig) vs the geocentric Moon vector; `AngleBetween` → 0–180°,
displayed whole-degree. Geocentric simplification (≤ ~1° vs topocentric) is
inside the documented ±2° tolerance. No precession needed at this tolerance
for a separation angle (both vectors same epoch treatment; documented in the
module header). Unknown coordinates (`raDeg`/`decDeg` null) → explicit
unknown state; sorts after all known values with deterministic designation
tie-break.

### D4 — Filter guidance: shared Lorentzian module (FR-009..013)

`moon-avoidance.ts` (pure, no React):

```ts
minSeparationDeg(band, ageDays, params) = params[band].distanceDeg
    / (1 + (ageDays / params[band].widthDays)²)
bandViable(band) = separationDeg >= minSeparationDeg(band, age, params)
```

Fixed band set `{L,R,G,B,Ha,SII,OIII}`. Derived summary category:
`broadband-ok` (every band viable — LRGB share params so broadband is
all-or-none) · `narrowband-only` (no broadband band viable, ≥1 narrowband
viable) · `avoid-tonight` (no band viable) · `unknown` (no coordinates).
Boundary: `>=` counts as viable (deterministic, spec edge case). The rule and
its parameters are owned by 047; Track B consumes the exported functions and
the same settings key — it must not fork tolerances, pills, or the
recommendation (Track B handover §6, FR-023 there).

No target-type modulation, no narrowband/broadband mode selector in v1
(decided). Explanation affordance (FR-012): hover/focus popover on the
guidance cell listing tonight's illumination + Moon age, the row's
separation, and each band's required minimum separation.

### D5 — Settings persistence (FR-010)

One structured spec-018 settings key `plannerMoonAvoidance`: JSON object
mapping each of the seven bands to `{ distanceDeg, widthDays }`. Defaults:
LRGB 120°/14d, Ha/SII 60°/7d, OIII 110°/10d. Validation: exactly the seven
band keys; `distanceDeg ∈ [0, 180]`; `widthDays ∈ [0.5, 30]`. One key (not
14 numeric keys) keeps the descriptor table, audit events, and
reset-to-defaults atomic, mirroring the `PatternsByType` structured-value
precedent. Non-noisy (explicit user edits only). Frontend reads it through
the existing settings hydration; `guidance-settings.ts` exposes a hook and a
non-hook getter (sort comparators). Reset-to-defaults uses the existing
`settings.restore-defaults` machinery. **The usable-altitude threshold
(localStorage) is untouched** (FR-016 — Track B promotes it).

### D6 — Opposition (FR-014)

For fixed-RA targets, opposition ≈ the date the Sun's apparent RA equals
`target RA − 12h`. Compute with a coarse daily scan of solar RA
(`Equator(Body.Sun, …)`) from tonight forward (≤ 366 days) picking the
minimal-angular-difference date — date-level precision well inside ±7 days;
no observer coordinates. Column keeps the **"Opposition"** name (decided;
research doc §3), shows the date plus relative "in N days/months" form, and
sorts by soonest-next with unknowns last.

### D7 — Site gate (FR-019)

The planner renders no astronomy until a default `ObserverSite` exists —
prompt-for-site-first, no location-independent fallback rendering (decided).
047 only **consumes** a site-existence signal via a small
`useObserverSiteExists()` selector over the spec-018 settings surface; the
ObserverSite model, wizard step, and site CRUD are Track B / spec 048 scope.
**Cross-track sequencing risk**: if 047 implements before Track B's
ObserverSite settings extension exists, there is nothing to read. Mitigation
encoded in tasks: the gate task lands last in the foundational phase behind a
narrow interface (`siteExists(): boolean`) with a temporary
`false`-until-available binding compiled against whatever the settings
surface exposes at implementation time; the binding is one function to swap
when Track B's key lands. This is flagged as an open coordination question
for the orchestrator (see §Cross-track).

### D8 — Mock retirement (FR-015, FR-017, SC-004)

`planner-altitude.ts` keeps its pseudo-declination altitude sampling — those
placeholder columns (max altitude, imaging time, visible tonight, sparkline)
are Track B's to replace and stay clearly presented as estimates. Removed
outright: `MOCK_MOON_PHASE_FRAC`, `mockLunarDistanceDegFor`, and the mock
`filtersFor` bracketing rule (its i18n labels are reused). A final audit task
greps for the mock symbols to enforce FR-017/SC-004.

## Cross-track coordination (Track B handover reconciliation)

Checked against `docs/development/track-b-044-plan-handover-2026-07-04.md`
(commit `969bbd53` on `044-targets-planner-track-b`) and ADR-0001:

- **Consistent**: engine (frontend astronomy-engine, Rust crate dropped);
  047 owns the Lorentzian rule + per-band params + pills + recommendation,
  Track B integrates the rule over its geometry; single npm dep added once;
  `target.list` RA/Dec already flows; "Opposition" naming; usable-altitude
  threshold untouched by 047; the single `min_lunar_separation_deg` knob is
  dead (047's per-band key replaces it — nothing in 047 recreates it).
- **Conflict found & resolved (spec-side)**: the authored 047 spec carried an
  interim two-threshold guidance model (bright ≥40% AND close <60°) that
  contradicted the decided per-band Lorentzian model the Track B handover
  assumes 047 owns. Resolved by amending 047's spec.md (commit
  "encode decided Lorentzian per-band guidance + site-first gate") — the
  Lorentzian model is authoritative. Track B's artifacts already state the
  correct model; no edit needed on the 044 side. **Revert note**: if the
  product owner reinstates the two-threshold model, revert that 047 spec
  commit and renegotiate Track B handover §6 (per-filter moon-free time
  integration depends on the per-band rule).
- **Handover default vs recorded default**: handover §6 lists OIII as
  "~100–120°/~10d" (a range); 047 fixes the shipped default at 110°/10d
  (tunable). Within the handed-over range — not a conflict.
- **Settings namespace** (handover §8 item 2): confirmed — the per-band
  Lorentzian params live in 047's settings key `plannerMoonAvoidance`;
  Track B must consume that key, not duplicate it.
- **Open coordination items for the orchestrator** (also in report):
  1. ObserverSite availability ordering (D7) — who lands first; 047's gate
     binding is the swap point.
  2. `astronomy-engine` dep claim — 047 adds it unless Track B's plan lands
     the dep first (both plans must not both add it blindly; trivial merge
     either way).
  3. If Track B later wants a per-band pill rendering, it must reuse the
     parameterised `FilterBadges`, not clone it (shared-component rule).

## Complexity Tracking

No constitution violations; table not required.

## Iterate 2026-07-15 — planner observability UX (pointer)

Spec-side changes only (FR-015/FR-016 supersession, FR-020 consumer-side
passband aggregation, FR-014 sizing annotation). All implementation lands
under spec 044's Phase 10 (tasks T040–T049). Decision record:
`docs/research/044-047-planner-observability-ux-iterate.md` (approved
2026-07-14, PR #819).
