# Tasks: Targets Planner — Track A (Moon-Aware, Filter-Aware Planning)

**Input**: `specs/047-targets-planner-moon-filters/` — plan.md, spec.md,
data-model.md, contracts/settings.plannerMoonAvoidance.md

**Tests**: included (spec carries measurable tolerances SC-001..003 and repo
convention is test-alongside).

**Organization**: setup + foundational phases, then one phase per user story
(US1 moon summary P1 · US2 lunar distance P1 · US3 filter guidance P2 ·
US4 opposition P3), then polish. All paths repo-root-relative.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no unmet dependency)

---

## Phase 1: Setup

- [X] T001 Add `astronomy-engine@2.1.19` to `apps/desktop/package.json`
      (pnpm; version re-verified at plan time). FIRST check whether the
      044 Track B lane already added it — if present, verify version and
      skip. Confirm Vite dev + build succeed with a trivial import.

---

## Phase 2: Foundational (blocks all user stories)

- [X] T002 [P] Create `apps/desktop/src/features/targets/astro/observing-night.ts`
      — night anchor per plan D1 (`nightKey`, midnight instant, rollover at
      local noon boundary, focus/interval re-check hook) + unit tests
      `astro/observing-night.test.ts` covering midnight-span (no 00:00 flip),
      DST transition, clock/timezone change (edge cases; FR-005). Depends: —.
- [X] T003 [P] Create `apps/desktop/src/features/targets/astro/moon-state.ts`
      — phase name (8-phase), waxing/waning, illumination fraction, Moon age
      from full, geocentric Moon vector via astronomy-engine (plan D2;
      FR-001..004) + fixture tests `astro/moon-state.test.ts` against
      published almanac values for ≥6 dates across 2000–2050 incl. new/full/
      both quarters (SC-001 tolerance ±3 pp; extreme-date sanity). Depends: T001.
- [X] T004 [P] Create `apps/desktop/src/features/targets/astro/moon-avoidance.ts`
      — SHARED Lorentzian rule module (plan D4): `Band` type,
      `MoonAvoidanceParams`, `DEFAULT_MOON_AVOIDANCE`, `minSeparationDeg`,
      `bandViability`, `deriveRecommendation` (broadband-ok · narrowband-only
      · avoid-tonight · unknown); pure functions, no React + unit tests
      `astro/moon-avoidance.test.ts` (boundary `>=` viable determinism,
      full/new-moon extremes, param extremes 180°/min-width; FR-009/009a).
      Depends: — (pure math; no engine import).
- [X] T005 Backend settings key `plannerMoonAvoidance` (data-model.md,
      contracts delta): descriptor + `ValidationRule::MoonAvoidanceBands` in
      `crates/app/settings/src/descriptors.rs`; default/hydration arms +
      `SettingsState` field (serde default) in `crates/app/settings/src/lib.rs`
      and `crates/contracts/core`; extend
      `specs/018-settings-configuration-model/contracts/settings.{get,update,restore-defaults}.json`
      key enums; regenerate TS bindings; `cargo test -p app_settings`
      (validation ranges, restore-defaults, descriptor/state-defaults
      parity). NO SQL migration (key/value store). Depends: —.
- [X] T006 Create `apps/desktop/src/features/targets/guidance-settings.ts`
      — settings-backed per-band params: hook + non-hook getter over the
      hydrated settings state, falling back to `DEFAULT_MOON_AVOIDANCE`
      + tests `guidance-settings.test.ts` (live update propagation; SC-008
      groundwork). Depends: T004, T005.
- [X] T007 Site gate (FR-019, plan D7): `useObserverSiteExists()` selector
      (narrow `siteExists(): boolean` binding over the spec-018 settings
      surface; temporary `false`-until-available binding if Track B's
      ObserverSite key has not landed — single swap point, marked with a
      cross-track TODO referencing spec 044) + planner prompt state in
      `apps/desktop/src/features/targets/TargetsPage.tsx` ("set up your
      observing site" i18n prompt replacing astronomy rendering) + tests in
      `TargetsPage.test.tsx`. Depends: T005 (settings surface shape).

**Checkpoint**: engine in, night/moon/rule/params primitives tested, site
gate in place — user stories can start (in parallel if staffed).

---

## Phase 3: User Story 1 — Tonight's Moon at a glance (P1) 🎯 MVP

**Goal**: real nightly moon summary (phase name, illumination %, waxing/
waning) in the planner. **Independent test**: compare shown phase +
illumination vs a published almanac on known dates (new/full/quarters).

- [X] T008 [P] [US1] i18n strings: 8 phase names, waxing/waning, summary
      labels, site-gate prompt strings in `apps/desktop/messages/` catalog
      (Paraglide; FR-018). Depends: foundational.
- [X] T009 [US1] Create `apps/desktop/src/features/targets/MoonSummary.tsx`
      — summary widget (phase name, illumination %, direction; ~30-line
      terminator-ellipse phase SVG per research §7) + BEM `.alm-*` classes in
      the shared stylesheet; keyboard/AT-accessible text equivalent.
      Depends: T003, T008.
- [X] T010 [US1] Mount `MoonSummary` in the planner bar of
      `apps/desktop/src/features/targets/TargetsPage.tsx` behind the site
      gate; memoize `ObservingNight` once per `nightKey` and provide it to
      the table (context or prop) for US2/US3 reuse (FR-005, SC-007).
      Depends: T002, T007, T009.
- [X] T011 [US1] Component tests in `TargetsPage.test.tsx` /
      `MoonSummary.test.tsx`: fixed-date renders match fixtures; same-night
      stability across a simulated midnight; gated-off state when no site.
      Depends: T010.

**Checkpoint**: US1 shippable — first real (non-mock) astronomy in the planner.

---

## Phase 4: User Story 2 — Real lunar distance per target (P1)

**Goal**: real target↔Moon separation per row, sortable, unknowns explicit.
**Independent test**: M31/M42 separations vs planetarium reference on known
dates within ±2°; sort order matches displayed values.

- [X] T012 [P] [US2] Create `apps/desktop/src/features/targets/astro/lunar-separation.ts`
      — target J2000 RA/Dec unit vector vs Moon vector, `AngleBetween` →
      0–180° (plan D3) + fixture tests `astro/lunar-separation.test.ts`:
      ≥10 well-known targets × ≥5 spread dates vs planetarium reference
      values, all within ±2° (SC-002); null-coordinate passthrough.
      Depends: T003.
- [X] T013 [US2] Wire real separation into
      `apps/desktop/src/features/targets/TargetsTable.tsx`: derive
      `RowMoonPlanning` (data-model.md) in the existing row `useMemo` from
      `raDeg`/`decDeg` + shared `ObservingNight`; lunar-distance cell shows
      whole degrees or explicit unknown ("—" + i18n title, never a number);
      remove the row's dependence on `mockLunarDistanceDegFor`. Depends:
      T010, T012.
- [X] T014 [US2] Sorting (FR-007): `lunarDist` comparator on real values,
      asc/desc via existing `SortHeader`, unknowns always last, designation
      tie-break; tests in `TargetsTable.test.tsx` (order, unknown grouping,
      tie determinism). Depends: T013.

**Checkpoint**: US1+US2 = the Moon-safety MVP (SC-005 flow achievable).

---

## Phase 5: User Story 3 — Filter guidance from Moon conditions (P2)

**Goal**: per-band viability pills + derived recommendation + explanation +
tunable per-band params in Settings. **Independent test**: near-full-moon
date shows close targets narrowband-only / distant all-viable; changing
params in Settings updates pills live; reset restores defaults.

- [X] T015 [P] [US3] Settings UI: compact per-band (distance, width) table
      in `apps/desktop/src/features/settings/PlannerSettings.tsx` under
      Settings → Target Planner — 7 rows × 2 constrained numeric inputs
      (ranges per data-model.md), reset-to-defaults action, i18n labels,
      keyboard operable; writes via existing `settings.update`; tests
      `PlannerSettings.test.tsx` (validation clamps, reset, persistence
      round-trip) (FR-010, SC-008). Depends: T005, T006.
- [X] T016 [US3] Parameterise `apps/desktop/src/features/targets/FilterBadges.tsx`
      into per-band viability pills (ONE shared component — no clones):
      renders all seven bands with viable/not-viable state + derived
      recommendation label + unknown state; reuse/extend existing `.alm-*`
      pill classes (FR-009a, FR-013). Depends: T004, T008.
- [X] T017 [US3] Wire guidance into `TargetsTable.tsx` rows: `bandViability`
      + `recommendation` from shared rule + live params
      (`guidance-settings.ts`); replace mock `filtersFor` usage; guidance
      recomputes on settings change without restart (SC-008). Depends:
      T013, T015, T016.
- [X] T018 [US3] Explanation affordance (FR-012, SC-006): hover/focus
      popover on the guidance cell listing tonight's illumination + Moon
      age, this row's separation, and each band's required minimum
      separation from active params; keyboard-reachable, i18n. Depends: T017.
- [X] T019 [US3] Recommendation filtering + grouping (FR-011, FR-013):
      existing planner filter control + group-by-recommendation rewired to
      real derived categories incl. explicit "unknown" choice; tests in
      `TargetsTable.test.tsx` (filter set, group counts, unknown exclusion
      rule). Depends: T017.
- [X] T020 [US3] US3 test sweep: boundary determinism at exact
      `min_separation` (viable), bright/close vs dim/far scenario fixtures,
      live param-change re-render, avoid-tonight state rendering. Depends:
      T017–T019.

**Checkpoint**: headline decision-support value complete.

---

## Phase 6: User Story 4 — Opposition / best season (P3)

**Goal**: real next-opposition date per row, sortable soonest-first.
**Independent test**: Orion-region targets → ~December, Sagittarius-region →
~June/July, within ±7 days; sort orders by soonest.

- [X] T021 [P] [US4] Create `apps/desktop/src/features/targets/astro/opposition.ts`
      — next anti-solar date from target RA via daily solar-RA scan (plan
      D6) + fixture tests `astro/opposition.test.ts`: seasonal anchors
      (M42, M31, M8/M20, M13, M45 …) within ±7 days (SC-003); wrap-around
      year boundary; null coords. Depends: T001, T002.
- [X] T022 [US4] Wire the opposition column in `TargetsTable.tsx`: replace
      the "—" stub with date-level value + relative "in N days/months"
      (i18n plural rules), keep the **"Opposition"** column name; unknown
      state for null coords (FR-014). Depends: T013 (row derivation), T021.
- [X] T023 [US4] Opposition sort: soonest-next comparator (targets at/near
      opposition first), unknowns last, deterministic ties; replace the
      no-op sort; tests in `TargetsTable.test.tsx`. Depends: T022.

---

## Phase 7: Polish & cross-cutting

- [X] T024 Mock retirement audit (FR-015, FR-017, SC-004): delete
      `MOCK_MOON_PHASE_FRAC`, `mockLunarDistanceDegFor`, mock `filtersFor`
      and their tests from
      `apps/desktop/src/features/targets/planner-altitude.ts` /
      `planner-altitude.test.ts`; KEEP the pseudo-declination altitude
      sampling + `usableAltDeg` path (Track B placeholders, FR-015/016)
      with updated header comments; repo-wide grep proves no moon/filter/
      opposition value derives from hash sources. Depends: US1–US4 done.
- [X] T025 [P] A11y + i18n audit (FR-018): new columns/controls keyboard
      operable, `SortHeader` announces sort state for lunarDist/opposition,
      pills/popover have AT text, zero literal strings (catalog only).
      Depends: US1–US4.
- [X] T026 [P] Performance check (SC-007): 5,000-row planner fixture —
      per-night memoization verified (one `ObservingNight` per night),
      row derivation O(1), sorting without visible stall. Depends: US1–US4.
- [X] T027 Full gates: `just lint`, `just test`, `just typecheck`; fix
      fallout. Depends: T024–T026.
- [ ] T028 verify-on-windows scenario for the real Tauri app: site-gate
      prompt, moon summary vs almanac for the current date, lunar-distance
      sort, Settings per-band table live update + reset, opposition column.
      Depends: T027.
- [X] T029 [P] Update `specs/SPEC_STATUS.md` row for 047 (and 044's Track A
      pointer if listed). Depends: T027.

---

## Dependency graph (exhaustive)

```text
T001 ──▶ T003 ──▶ T009 ──▶ T010(+T002,T007) ──▶ T011          [US1]
  │        └────▶ T012 ──▶ T013(+T010) ──▶ T014               [US2]
  ├──────────────────▶ T021(+T002) ──▶ T022(+T013) ──▶ T023   [US4]
T002 ──▶ T010, T021
T004 ──▶ T006, T016
T005 ──▶ T006, T007, T015
T006 ──▶ T015, T017
T007 ──▶ T010
T008 ──▶ T009, T016
T013 ──▶ T017 ──▶ T018, T019 ──▶ T020                         [US3]
T015, T016 ──▶ T017
US1..US4 ──▶ T024 ──▶ T027 ──▶ T028
US1..US4 ──▶ T025, T026 ──▶ T027 ──▶ T029
External (cross-track): Track B ObserverSite settings key ──▶ final binding
inside T007 (temporary false-until-available binding allowed; swap is one
function). Track B plan claiming astronomy-engine ──▶ T001 degrades to no-op.
```

### Parallel opportunities

- After T001: T002, T003, T004, T005 in parallel (T004/T005 even before T001).
- After foundational: US1 (T008→) ∥ US2 (T012→) ∥ US4 (T021→); US3 starts
  once T013 lands (needs the row derivation) though T015/T016 can start
  right after foundational.
- Polish: T025 ∥ T026; T029 parallel to T028.

### Implementation strategy

MVP = Phase 1–4 (US1+US2): real moon summary + real lunar distance — the
SC-005 "Moon-safe shortlist in 30 s" flow. Then US3 (guidance) as the
headline increment, US4 (opposition) last. Commit + push after every task
group; no AI attribution.
