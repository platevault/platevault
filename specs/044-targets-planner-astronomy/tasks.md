---
description: "Task list — 044 Track B: Ephemeris & Observer-Location Engine"
---

# Tasks: Targets Planner — Ephemeris & Observer-Location Engine (Track B)

**Input**: Design documents in `specs/044-targets-planner-astronomy/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/ (all present)
**Tests**: included — the spec defines per-story Independent Tests and SC-001..013 acceptance criteria.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency)
- **[Story]**: US1..US6 (spec priorities: **US1 & US6 = P1**; US2/US3/US5 = P2; US4 = P3)
- Paths are exact (see plan.md → Source Code).

**Boundary reminder**: spec-only handoff — implementation begins after this plan passes review and the
user is grilled on the pre-implementation decisions (orchestrator handover §8). Do not implement yet.

---

## Phase 1: Setup (shared)

- [ ] T001 [P] Add `astronomy-engine@2.1.19` to `apps/desktop/package.json` (mcp-package-version check first;
      spec 047 imports the SAME dep — add ONCE, coordinate so it isn't added twice).
- [ ] T002 [P] Add `@visx/scale`, `@visx/shape`, `@visx/group`, `@visx/threshold` (`^4.0.0`) to
      `apps/desktop/package.json`. Do NOT add `@visx/gradient`, `@visx/axis`, or `@visx/xychart`.
- [ ] T003 [P] Bundle a static IANA-timezone list asset for the offline site picker (research R7);
      place under `apps/desktop/src/features/targets/observing-sites/`.

---

## Phase 2: Foundational — settings extension (BLOCKING)

**⚠️ Blocks US1/US2/US3/US4/US5/US6 — every story reads the active site and/or the usable-altitude threshold.**

- [ ] T004 [US3] Extend `SettingsState` in `crates/domain/core/src/settings.rs` with the `observing.*` values:
      `observing.sites: Vec<ObserverSite>`, `observing.default_site_id: Option<String>`,
      `observing.active_site_id: Option<String>`, `observing.usable_altitude_deg: f64` (default 30). Add the
      `ObserverSite` struct + validation (data-model.md §1) with serde.
- [ ] T005 [US3] Add migration `crates/persistence/db/migrations/00NN_observer_sites.sql` seeding the four
      keys with defaults. **Choose `00NN` = next free number AT IMPL TIME after checking open PRs** (latest
      committed `0050`; convoy reservations 0052 in flight, 0056–0059). Touch `crates/persistence/db/.../lib.rs`
      to force sqlx re-embed on Windows dev.
- [ ] T006 [US3] Register the four `observing.*` keys in the settings key enum + value sub-schemas
      (`packages/contracts` `settings.state.v1.json` + the settings command key list in
      `apps/desktop/src-tauri/src/commands/settings.rs`), per `contracts/settings.observing.json`. No new command.
- [ ] T007 [US3] Wire read/write through the use-case (`crates/app/settings/src/lib.rs`) + persistence
      (`crates/persistence/db/src/repositories/settings.rs`) so `observing.*` round-trips like existing
      structured keys. Regenerate TS bindings.
- [ ] T008 [P] [US3] Backend test: `observing.*` get/update round-trip incl. `ObserverSite[]`, default/active
      validity invariants, and fresh-DB migrate (`crates/app/settings` or persistence integration test).

**Checkpoint**: settings store carries observing sites + threshold end-to-end.

---

## Phase 3: US1 — Real tonight observability per target (P1) 🎯 MVP

**Goal**: real max-alt, sparkline, transit, visible-tonight, total imaging time for tonight/active site;
instant threshold updates. **Independent test**: spec.md US1 Independent Test.

- [ ] T009 [US1] `apps/desktop/src/features/targets/planner-astronomy.ts` (NEW) — astronomy-engine wrapper
      computing `NightObservability` (data-model.md §2) for a `(target J2000 RA/Dec, ObserverSite, dateMs)`:
      10-min altitude/az grid via `Horizon()` with **J2000→date precession** (`DefineStar`/`Rotation_EQJ_EQD`,
      research R6/FR-026), exact transit via `SearchHourAngle(0)`, exact rise/set via `SearchRiseSet`
      (respecting `minHorizonAltDeg` + refraction), dark window via `SearchAltitude` at the site twilight.
- [ ] T010 [US1] `apps/desktop/src/features/targets/planner-derive.ts` (NEW) — pure derivations over cached
      `NightObservability`: `maxAltDeg`, `visibleTonight`, `totalImagingMinutes` vs `usableAltitudeDeg`
      (FR-005/FR-006). Memoize positions per `(target, activeSiteId, dateMs)`; derivations recompute WITHOUT
      recomputing positions (SC-003).
- [ ] T011 [US1] Replace the mock internals in
      `apps/desktop/src/features/targets/planner-altitude.ts` (`STUB_OBSERVER_LAT_DEG=52.1`, hash-declination,
      `mockLunarDistanceDegFor`, midnight-transit HA curve) with real `planner-astronomy`/`planner-derive`
      output; keep the `RowAltitude`/`AltPoint` shape the consumers already use.
- [ ] T012 [US1] Update consumers to the real data: `AltitudeSparkline.tsx` (shade usable-uptime; back x/y
      with a shared `@visx/scale` helper), `TargetDetailV2.tsx` (`altitudeCurve()` → real), `TargetsTable.tsx`
      columns (max-alt, visible-tonight, imaging time, transit) — FR-007.
- [ ] T013 [US1] Handle the un-plannable target (null RA/Dec) + never-usable target as spec edge cases (no
      error; "needs coordinates" / not-visible zero imaging time).
- [ ] T014 [P] [US1] Tests: engine max-alt/transit/curve vs an independent reference ephemeris to planning
      grade (SC-001); instant-derivation on threshold change with no position recompute (SC-003); never-visible
      target → not-visible/zero (edge case). `apps/desktop/src/features/targets/*.test.ts`.

**Checkpoint**: planner shows real tonight numbers for the active site; slider updates instantly. MVP.

---

## Phase 4: US6 — Works out of the box: default site from the wizard (P1) 🎯

**Goal**: no-site prompt + first-run wizard default site. **Depends on**: Phase 2. **Independent test**: US6.

- [ ] T015 [US6] No-site state: the planner renders no astronomy and shows a clear "add an observing site"
      prompt when `observing.sites` is empty / no active site (FR-024/SC-011) — `TargetsTable.tsx` +
      `TargetDetailV2.tsx` guard on `PlanningContext.activeSite`.
- [ ] T016 [US6] First-run wizard step in `apps/desktop/src/app/first-run.ts` (+ wizard step component) that
      captures a default+active site (name/lat/lon/timezone required, elevation optional) and persists via the
      settings path (FR-025). **Coordinate the wizard edit with spec 048** so the two don't conflict.
- [ ] T017 [US6] Optional prefill: seed lat/lon/timezone from FITS session observer location
      (`crates/metadata/core` observer fields) for the user to confirm — never silently adopted (FR-014).
- [ ] T018 [P] [US6] Tests: completing the wizard step yields a persisted default+active site + immediate real
      observability; no-site → prompt + no astronomy (SC-011).

**Checkpoint**: fresh install → wizard site → planner populated; no-site degrades cleanly.

---

## Phase 5: US3 — Manage observing sites (P2)

**Goal**: site CRUD + default/active + threshold from settings. **Depends on**: Phase 2.

- [ ] T019 [US3] `observing-sites/` UI: list, add/edit/delete named sites (name, lat, lon, elevation, IANA-tz
      picker from the bundled list, twilight, min-horizon), mark default, choose active — fully offline
      (FR-011/FR-012). Keep `.alm-*` markup.
- [ ] T020 [US3] Enforce default/active validity across edits/deletes (delete active → reselect default/none;
      delete default → valid/empty) — FR-013; wire into the settings write path.
- [ ] T021 [US3] Retire the localStorage usable-altitude: replace
      `apps/desktop/src/features/targets/altitude-settings.ts` (`getAltitudeThreshold`, `ALTITUDE_THRESHOLD_KEY`)
      with the settings-backed `observing.usable_altitude_deg`; update `altitude-settings.test.ts` (FR-004).
- [ ] T022 [US3] Switching active site recomputes all observability for the new coordinates; active site
      persists across relaunch (SC-005).
- [ ] T023 [P] [US3] Tests: two sites give different numbers; switch/relaunch persistence; delete keeps
      selection valid; threshold now survives relaunch (SC-005/SC-006).

**Checkpoint**: full multi-site management; threshold is durable, not device-local.

---

## Phase 6: US2 — Plan an arbitrary future night (P2)

**Goal**: date picker + `(site, date)` parameterization + best-imaging date. **Depends on**: Phase 3.

- [ ] T024 [US2] Date picker in the planner; thread `dateMs` into `PlanningContext`; defaults to "tonight"
      each launch, not persisted (FR-008/SC-004). All observability + the altitude graph follow the chosen date.
- [ ] T025 [US2] Best-imaging date (FR-009): the date the target transits at local midnight (anti-solar RA);
      present as date + "in N days", sortable by days-until. Deep-sky only — no magnitude/size change.
- [ ] T026 [P] [US2] Tests: a future date changes all values to that night vs tonight (SC-004); navigating to
      best-date → midnight transit; DST-boundary date reports correct local times (SC-012).

**Checkpoint**: arbitrary-date planning + best-date column.

---

## Phase 7: US5 — Real Moon geometry & per-filter moon-free time (P2)

**Goal**: Moon alt/sep series, 3 scalars, Moon-up windows, per-band moon-free time. **Depends on**: Phase 3;
**consumes Track A (spec 047)** shared Lorentzian module.

- [ ] T027 [US5] Extend `planner-astronomy.ts`: Moon altitude(t) + target↔Moon separation(t) aligned to the
      grid (`Illumination`/`AngleBetween`), Moon-up windows ∩ dark window, illuminated fraction (FR-019/FR-021).
- [ ] T028 [US5] Extend `planner-derive.ts`: three separation scalars (transit / min-over-dark / dark-midpoint,
      "Moon not up" where below horizon — FR-020) and per-band `moonFreeMinutesByBand` = Σ dark intervals where
      `alt ≥ usable ∧ ¬(MoonUp ∧ sep(t) < lorentzianMinSep(band, moonAge))`, importing `lorentzianMinSep` from
      **047's shared module** (FR-022/FR-023). Recompute on band-param change without position recompute (SC-003).
- [ ] T029 [US5] Display: per-band moon-free hours (e.g. "Ha 4.2h · OIII 2.1h · LRGB 0h"); sparkline shades the
      chosen band's interference intervals (default: band with most moon-free time) — FR-007/FR-152 note.
- [ ] T030 [P] [US5] Tests: three separations vs reference (SC-009); per-band moon-free equals the summed
      intervals and a tolerant band ≥ a stricter band (SC-010); Moon-below-all-night → moon-free == total
      imaging time (edge case).

**Checkpoint**: real Moon geometry + per-filter moon-free time; no duplicate Moon computation with 047 (SC-013).

---

## Phase 8: US4 — Darkness & horizon definition (P3)

**Goal**: per-site twilight (−18°/−12°) + minimum-horizon. **Depends on**: Phase 3/Phase 5.

- [ ] T031 [US4] Per-site twilight drives the dark window used for imaging-time (total + per-band) and the graph
      night shading (FR-015/FR-016); switching astronomical↔nautical widens/narrows the window.
- [ ] T032 [US4] Minimum-horizon altitude affects rise/set, visibility, usable time, and Moon-up (FR-018);
      standard refraction at the true horizon.
- [ ] T033 [US4] Empty-dark-window (high-lat summer): report "no dark window", zero total + per-band imaging
      time, no fabrication/error (FR-017/SC-008).
- [ ] T034 [P] [US4] Tests: nautical vs astronomical changes the window + imaging time (SC-007); raised horizon
      shrinks a low target's usable time; no-dark-window case (SC-008).

**Checkpoint**: per-site darkness/horizon overrides.

---

## Phase 9: Polish & verification

- [ ] T035 [P] Detail-pane altitude graph via `@visx/scale|shape|group|threshold` (usable-altitude band +
      twilight bands; fills from `--alm-*` theme tokens); `TargetDetailV2.tsx`. Share the scale helper with the
      sparkline.
- [ ] T036 [P] Wire the already-installed `@tanstack/react-table` into `TargetsTable.tsx` (sort/filter/group)
      replacing the hand-rolled `[...rows].sort()`/`useMemo`; keep `.alm-*` markup (net-zero dep).
- [ ] T037 [P] Hand-roll the moon-phase SVG fed by `Illumination`/`MoonPhase` (do not add a second astro lib).
- [ ] T038 `just lint` + `just test` + `just typecheck` green.
- [ ] T039 **verify-on-windows**: real Tauri app — wizard site step, site CRUD + active switch, date picker,
      threshold slider instant update, per-band moon-free display; spot-check M31/M42 vs Stellarium/Telescopius
      within planning tolerance. (Use the `verify-on-windows` skill.)
- [ ] T040 Update `specs/SPEC_STATUS.md` 044 row (placeholder → implemented) after merge.

---

## Dependencies (exhaustive graph)

```
Setup T001,T002,T003
   └─> Foundational (Phase 2) T004 ─> T005 ─> T006 ─> T007 ─> T008
          │  (BLOCKS every user story — active site + threshold)
          ├─> US1 (Phase 3) T009 ─> T010 ─> T011 ─> T012 ─> T013 ; T014[P]
          │        │
          │        ├─> US2 (Phase 6) T024 ─> T025 ; T026[P]
          │        ├─> US5 (Phase 7) T027 ─> T028 ─> T029 ; T030[P]   (consumes spec 047 module)
          │        └─> US4 (Phase 8) T031 ─> T032 ─> T033 ; T034[P]   (US4 also uses US5 Moon-up for horizon)
          ├─> US6 (Phase 4) T015 ─> T016 ─> T017 ; T018[P]           (co-P1 w/ US1; needs settings)
          └─> US3 (Phase 5) T019 ─> T020 ; T021 ; T022 ; T023[P]
   Polish (Phase 9) T035[P],T036[P],T037[P] after their consumer stories; T038 ─> T039 ─> T040 last
```

**Critical path (MVP)**: T001/T002 → T004→T008 → T009→T012 → (seed one site or T016) → usable planner.

**Parallelizable**: T001–T003; all `[P]` test tasks vs their story code; T035/T036/T037 across different files.
US2, US3, US5 can proceed in parallel once US1 (Phase 3) lands, on disjoint files. **US5 is gated on spec 047's
shared Lorentzian module existing** — coordinate with the 047 lane.

## Independent test criteria (per story → SC)

| Story | Independent test | SCs |
|-------|------------------|-----|
| US1 | tonight numbers match reference; slider instant | SC-001, SC-003 |
| US2 | future date changes values; best-date=midnight transit | SC-004, SC-012 |
| US3 | two sites differ; persist/relaunch; delete keeps valid | SC-005, SC-006 |
| US4 | twilight widens window; horizon shrinks usable; no-dark | SC-007, SC-008 |
| US5 | 3 separations match; per-band moon-free ordering | SC-009, SC-010, SC-013 |
| US6 | wizard → default+active site + real numbers; no-site prompt | SC-011 |
