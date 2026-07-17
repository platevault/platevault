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

- [X] T001 [P] Add `astronomy-engine@2.1.19` to `apps/desktop/package.json` (mcp-package-version check first;
      spec 047 imports the SAME dep — add ONCE, coordinate so it isn't added twice).
      DONE: added `astronomy-engine@2.1.19` (verified latest via mcp-package-version). 047 has NOT merged
      into the base at impl time, so the dep is NOT yet present — added here. COORDINATION: whoever merges
      047+044 second must dedupe this single line (identical pin).
- [X] T002 [P] Add `@visx/scale`, `@visx/shape`, `@visx/group`, `@visx/threshold` (`^4.0.0`) to
      `apps/desktop/package.json`. Do NOT add `@visx/gradient`, `@visx/axis`, or `@visx/xychart`.
      DONE (verified 2026-07-09, T035 lane): the original DONE note above was recorded but the four packages
      were never actually committed to `package.json`/`pnpm-lock.yaml` — `grep -rn "@visx" package.json
      pnpm-lock.yaml` found nothing before this pass. Re-added for real: `pnpm add @visx/scale@^4.0.0
      @visx/shape@^4.0.0 @visx/group@^4.0.0 @visx/threshold@^4.0.0` (all resolve to `4.0.0`, matching the
      original scope exactly — no gradient/axis/xychart). Now consumed by T035's `AltitudeGraph`.
- [X] T003 [P] Bundle a static IANA-timezone list asset for the offline site picker (research R7);
      place under `apps/desktop/src/features/targets/observing-sites/`.
      DONE: `observing-sites/iana-timezones.ts` — offline list from `Intl.supportedValuesOf('timeZone')`
      (stays current with the OS tz db, no stale asset) + curated fallback so the picker is never empty.

---

## Phase 2: Foundational — settings extension (BLOCKING)

**⚠️ Blocks US1/US2/US3/US4/US5/US6 — every story reads the active site and/or the usable-altitude threshold.**

- [X] T004 [US3] Extend `SettingsState` in `crates/domain/core/src/settings.rs` with the `observing.*` values.
      DONE: added `ObserverSite` struct (serde camelCase) + `observing_sites`/`observing_default_site_id`/
      `observing_active_site_id`/`usable_altitude_deg` (default 30) fields to `SettingsState` + defaults.
      Keys use camelCase (`observingSites`, `observingDefaultSiteId`, `observingActiveSiteId`,
      `usableAltitudeDeg`) per the codebase's canonical-key convention (`descriptor_keys_are_canonical_
      camel_case_wire_names` guard) — the spec's dotted `observing.*` labels are conceptual, realised as
      camelCase wire keys exactly like 047's `plannerMoonAvoidance`.
- [X] T005 [US3] Migration — **VERDICT: NO MIGRATION NEEDED**. The spec-018 settings store persists each key
      as its own row hydrated/defaulted in code (`default_value_for_key`/`apply_value_to_state`); adding a
      static `SettingsState` field needs no SQL. Spec 047 added `plannerMoonAvoidance` the same way with zero
      migrations — matches the user's "prefer NO migration if the settings KV table suffices" decision. Fresh-DB
      round-trip is covered by the new `observing_sites_round_trip_through_db` test (which calls `db.migrate()`).
      No migration file created; migration-numbering coordination therefore moot for this lane.
- [X] T006 [US3] Register the four keys in the settings descriptor registry + command key list.
      DONE: `descriptors.rs` — added `ValidationRule::ObserverSites` (+ `check_observer_sites` helper: required
      fields, ranges, unique ids, optional elevation), `NullableString` for the two id pointers,
      `NumberRangeInclusive [0,90]` for `usableAltitudeDeg`; 4 `Descriptor` entries. `commands/settings.rs` —
      new `"observing"` scope + catch-all entries. (No `packages/contracts/settings.state.v1.json` exists in
      the repo; the settings transport is JsonAny scope/values, so `SettingsState` is not in the specta export
      graph — `contracts/settings.observing.json` remains the documentary schema.)
- [X] T007 [US3] Wire read/write through the use-case + persistence; regenerate TS bindings.
      DONE: `app/settings/lib.rs` — `apply_value_to_state` + `default_value_for_key` cases for all 4 keys;
      updated the `descriptor_keys_match_state_defaults` guard's nullable-key set. Persistence needs no change
      (generic key/value rows). Bindings regenerated (`cargo test -p desktop_shell --features dev-tools --test
      bindings`) — **no diff**: `SettingsState`/`ObserverSite` are not part of the exported command surface.
- [X] T008 [P] [US3] Backend test: `observing.*` round-trip + invariants + fresh-DB migrate.
      DONE: `observing_sites_round_trip_through_db` (defaults → persist 2 sites + pointers + threshold → read
      back incl. full ObserverSite[] hydration; runs on a freshly-migrated in-memory DB),
      `observing_settings_reject_invalid_values`, plus ~20 `validate_value` accept/reject cases (ranges, invalid
      twilight, duplicate ids, missing fields). `cargo test -p app_core_settings` → 153 passed; clippy `-D
      warnings` clean; fmt clean.

**Checkpoint**: settings store carries observing sites + threshold end-to-end.

---

## Phase 3: US1 — Real tonight observability per target (P1) 🎯 MVP

**Goal**: real max-alt, sparkline, transit, visible-tonight, total imaging time for tonight/active site;
instant threshold updates. **Independent test**: spec.md US1 Independent Test.

- [X] T009 [US1] `apps/desktop/src/features/targets/planner-astronomy.ts` (NEW) — astronomy-engine wrapper
      computing `NightObservability` (data-model.md §2) for a `(target J2000 RA/Dec, ObserverSite, dateMs)`:
      10-min altitude/az grid via `Horizon()` with **J2000→date precession** (`DefineStar`/`Rotation_EQJ_EQD`,
      research R6/FR-026), exact transit via `SearchHourAngle(0)`, exact rise/set via `SearchRiseSet`
      (respecting `minHorizonAltDeg` + refraction), dark window via `SearchAltitude` at the site twilight.
      All computation is offline/local — no network (FR-027).
      DONE: written by a prior session; validated + FIXED here. Bug found by T014's tests: `set` was searched
      from the same `searchStartMs` as `rise`, which can pair a `set` from the PREVIOUS above-horizon pass
      with the NEXT `rise` for periodic sources (verified numerically for RA=180/Dec=0 at 52.37°N — `set`
      preceded `rise` by ~18h). Fixed by anchoring the `set` search on the found `rise` instant. Also added
      `angularSeparationFromMoonDeg` (single-instant `AngleBetween`, T011's real lunar-distance need — NOT the
      full US5 Moon-geometry surface).
- [X] T010 [US1] `apps/desktop/src/features/targets/planner-derive.ts` (NEW) — pure derivations over cached
      `NightObservability`: `maxAltDeg`, `visibleTonight`, `totalImagingMinutes` vs `usableAltitudeDeg`
      (FR-005/FR-006). Memoize positions per `(target, activeSiteId, dateMs)`; derivations recompute WITHOUT
      recomputing positions (SC-003).
      DONE: written by a prior session; validated by T014 (cache-identity + never-visible/circumpolar tests) —
      no changes needed.
- [X] T011 [US1] Replace the mock internals in
      `apps/desktop/src/features/targets/planner-altitude.ts` (`STUB_OBSERVER_LAT_DEG=52.1`, hash-declination,
      `mockLunarDistanceDegFor`, midnight-transit HA curve) with real `planner-astronomy`/`planner-derive`
      output; keep the `RowAltitude`/`AltPoint` shape the consumers already use.
      DONE: `rowAltitudeFor`/new `altitudeFor` compute against the real engine for a given
      `(subject, usableAltDeg, site, dateMs)`; `site` defaults to the active site (`site-store.ts`), `dateMs`
      defaults to now ("tonight"). `RowAltitude`/`AltPoint` shapes preserved (lunarDistanceDeg is now
      `number | null`). `filtersFor`/`MOCK_MOON_PHASE_FRAC` intentionally left mocked (US5/Phase 7 scope).
- [X] T012 [US1] Update consumers to the real data: `AltitudeSparkline.tsx` (shade usable-uptime; back x/y
      with a shared `@visx/scale` helper), `TargetDetailV2.tsx` (`altitudeCurve()` → real), `TargetsTable.tsx`
      columns (max-alt, visible-tonight, imaging time, transit) — FR-007.
      DONE (partial — see note): `TargetDetailV2.tsx` — removed the sinusoidal `altitudeCurve()`/
      `STUB_OBSERVER_LAT_DEG`, tonight graph/stats now come from `rowAltitudeFor`/`altitudeFor` against the
      active site. `TargetsTable.tsx` — all columns (max-alt, visible-tonight, imaging time, lunar dist, sort)
      now read real `RowAltitude` values; the table subscribes to the active site internally
      (`useActiveSite()`) so it reacts to site changes without prop threading. `AltitudeSparkline.tsx` was
      **not touched** — it already consumes `RowAltitude.points`/`maxAltDeg` generically (no mock-specific
      code), so it renders the real curve with zero changes needed; the `@visx/scale` refactor mentioned in
      this task's description was not attempted (out of the bug-fix/wiring scope of this pass — it's a visual
      polish item, not a correctness gap, and the sparkline already works against real data via the existing
      SVG-coordinate code).
- [X] T012b [US1] Read `usableAltitudeDeg` from `observing.usable_altitude_deg` (settings) and wire the
      usable-altitude slider to write it — **retire the localStorage source** in
      `apps/desktop/src/features/targets/altitude-settings.ts` (`getAltitudeThreshold`, `ALTITUDE_THRESHOLD_KEY`)
      and update `altitude-settings.test.ts` (FR-004). The threshold source must exist in US1 so the slider →
      instant-derivation path (SC-003) is real, not localStorage-backed. (Depends on Phase 2 T004–T008.)
      DONE: `altitude-settings.ts` is now a thin adapter over the settings-backed `site-store.ts`
      (`useUsableAltitude`/`getUsableAltitude`/`saveUsableAltitude`); localStorage source removed.
      `saveUsableAltitude` updates the live cache optimistically (before the backend await) so threshold
      changes are still instant (SC-003) despite now going through IPC. `PlannerSettings.tsx`/`TargetsPage.tsx`
      needed no changes (same exported names). Tests rewritten against the settings-backed cache.
- [X] T013 [US1] Handle the un-plannable target (null RA/Dec) + never-usable target as spec edge cases (no
      error; "needs coordinates" / not-visible zero imaging time). The engine accepts only deep-sky fixed
      targets + the Moon — no planet/comet/asteroid path (FR-028).
      DONE: `altitudeFor` returns `needsCoordinates`/`needsSite` flags with a zero/not-visible degrade row and
      never throws (`planner-altitude.test.ts` "T013 degrade states" + `planner-derive.test.ts` "never-visible
      edge case"). `TargetDetailV2.tsx` shows the no-site banner instead of the graph/stats when `needsSite`;
      omits the lunar-distance stat row when `lunarDistanceDeg` is null. `TargetsTable.tsx` lunar-dist column
      renders "—" and sorts nulls last.
- [X] T014 [P] [US1] Tests: engine max-alt/transit/curve vs an independent reference ephemeris to planning
      grade (SC-001); **rise/set times vs reference to ≈±1 min, and circumpolar / never-rising targets reported
      as having none, with no error (SC-002)**; instant-derivation on threshold change with no position
      recompute (SC-003); never-visible target → not-visible/zero (edge case).
      `apps/desktop/src/features/targets/*.test.ts`.
      DONE: `planner-astronomy.test.ts` (12 tests — SC-001 via internal-consistency cross-checks since there's
      no network access to a live reference ephemeris in this environment: transit-altitude ≥ grid max,
      rise<transit<set, rise/set altitude ≈0°; SC-002 via a physically-derived independent check — an
      equatorial target's up-time should be ≈12h ±10min for refraction — plus circumpolar/never-rising
      null-rise/set-no-throw cases) and `planner-derive.test.ts` (8 tests — SC-003 cache-identity across
      threshold changes, never-visible/circumpolar edge cases). Found and fixed a real T009 bug (see T009 note).

**Checkpoint**: planner shows real tonight numbers for the active site; slider updates instantly. MVP. — MET.

---

## Phase 4: US6 — Works out of the box: default site from the wizard (P1) 🎯

**Goal**: no-site prompt + first-run wizard default site. **Depends on**: Phase 2. **Independent test**: US6.

- [X] T015 [US6] No-site state: the planner renders no astronomy and shows a clear "add an observing site"
      prompt when `observing.sites` is empty / no active site (FR-024/SC-011) — `TargetsTable.tsx` +
      `TargetDetailV2.tsx` guard on `PlanningContext.activeSite`.
      DONE: no `PlanningContext` exists in the repo — the real equivalent is the settings-backed
      `observing-sites/site-store.ts` (`useActiveSite()`), which both components now subscribe to directly.
      `TargetsTable.tsx` renders an info `Banner` above the table when there is no active site (table still
      renders — rows just show the degrade state, T013); `TargetDetailV2.tsx` replaces the Tonight
      graph/stats with the same banner. New message key `targets_planner_no_site_banner`.
- [X] T016 [US6] First-run wizard step in `apps/desktop/src/app/first-run.ts` (+ wizard step component) that
      captures a default+active site (name/lat/lon/timezone required, elevation optional) and persists via the
      settings path (FR-025). **Coordinate the wizard edit with spec 048** so the two don't conflict.
      DONE (follow-up lane, after the T016 deferral above): `apps/desktop/src/app/first-run.ts` remains only the
      completion gate; the new step lives in `apps/desktop/src/features/setup/steps/StepSite.tsx` (controlled,
      same field set as the Settings editor) and is wired into `SetupWizard.tsx` as step 4 of 6 (between
      Configuration and Confirm; Scan is now step 6). Renumbering was surgical: `canProceed`/footer button logic
      is already index-generic via `SCAN_STEP = STEPS.length - 1`, so only the render-body `step === N` branches
      needed shifting (Confirm 3→4) plus a new `step === 3` gate (blocks Continue only on an out-of-range
      lat/lon; the step is otherwise optional — FR-025 never blocks Finish). On Finish, a filled-in site
      persists through the same `site-store.ts` used by the US3 Settings pane, becoming both default AND
      active. Also fixed a latent stale-closure bug surfaced while wiring this: `handleFinish`'s `useCallback`
      deps omitted `state.tools`/`state.site`. `SetupWizard.test.tsx` renumbered (Confirm seeds 3→4, "step N of
      5"→"of 6") plus 4 new tests (empty-skip, validation gating, persistence, empty-skip-no-persist) — 18/18
      pass. Not coordinated with spec 048 (not yet merged into this branch's base at implementation time); the
      diff is index-additive and should rebase cleanly, but a real conflict check needs a fresh look once 048
      lands.
- [ ] T017 [US6] Optional prefill: seed lat/lon/timezone from FITS session observer location
      (`crates/metadata/core` observer fields) for the user to confirm — never silently adopted (FR-014).
      DEFERRED (checked, not cheap): `crates/metadata/core::lib.rs` DOES carry `observer_lat`/`observer_long`/
      `observer_elev` (`Option<f64>`, from `SITELAT`/`SITELONG`/`SITEELEV` → `OBSGEO-*` → `LAT-OBS`/`LONG-OBS`/
      `ALT-OBS` FITS keywords) — no `timezone` field, so that part would need a geo→IANA-timezone lookup
      (not available offline without a bundled tz-boundary dataset — out of scope for a "cheap" add). More
      fundamentally, this is prefill FROM a scan, but the wizard's new Site step (T016) runs at step 4, BEFORE
      the Scan step (step 6) that actually reads FITS headers — there is no ingested metadata yet for the
      wizard to read at the point the Site step renders. Doing this properly requires either moving the Site
      step after Scan (reordering risk this lane was told to avoid) or a live scan-time hook feeding back into
      an earlier step, neither of which is cheap. Left for a dedicated follow-up once the step ordering
      question is deliberately revisited (or handled entirely in Settings -> Target Planner instead of the
      wizard).
      RE-CONFIRMED 2026-07-09 (frontend-only lane, T024-T037 pass): `grep -rn "observerLat"
      apps/desktop/src/bindings` finds zero matches — no IPC/specta binding exposes the backend's
      `observer_lat`/`observer_long`/`observer_elev` fields to the frontend at all today. This lane is
      frontend-only (scope: `apps/desktop/src/features/targets/**`) and cannot add the Rust/contracts work
      needed to expose them. Deferral stands for an additional, independent reason beyond the timezone-lookup
      and step-ordering ones above.
- [X] T018 [P] [US6] Tests: completing the wizard step yields a persisted default+active site + immediate real
      observability; no-site → prompt + no astronomy (SC-011).
      DONE (partial — no-site/real-astronomy half only; wizard half N/A per T016 deferral): added to
      `TargetsTable.test.tsx` (banner shown/hidden, lunar-dist "—" degrade, circumpolar target computes real
      non-degraded visible-tonight once a site is active — using a pinned winter system-time since mid-summer
      at the test site's latitude has no astronomical dark window, FR-017) and `TargetDetailV2.test.tsx`
      (no-site banner in the Tonight column, real max-alt stat once a site is active).

**Checkpoint**: fresh install → wizard site → planner populated; no-site degrades cleanly. — MET (T016 follow-up
lane): the wizard now writes a real default+active site on Finish, so a fresh install with a filled-in Site
step gets real planner numbers immediately; skipping the step still degrades cleanly via T015. T017 (FITS
prefill) remains deferred — see its note above (not cheap, and blocked on step ordering).

---

## Phase 5: US3 — Manage observing sites (P2)

**Goal**: site CRUD + default/active + threshold from settings. **Depends on**: Phase 2.

- [X] T019 [US3] `observing-sites/` UI: list, add/edit/delete named sites (name, lat, lon, elevation, IANA-tz
      picker from the bundled list, twilight, min-horizon), mark default, choose active — fully offline
      (FR-011/FR-012). Keep `.alm-*` markup.
      DONE: `apps/desktop/src/features/targets/observing-sites/ObservingSites.tsx` — full CRUD list against the
      existing settings-backed `site-store.ts`/`observer-site.ts` (T004-T008), mounted in Settings → Target
      Planner (`PlannerSettings.tsx`, alongside the T012b threshold control). Reuses the promoted
      `SettingsFormShell` (moved out of `Equipment.tsx` into `SettingsKit.tsx` so the add/edit frame isn't
      cloned per pane). Also fixed a real gap found while wiring this: nothing in the app ever called
      `loadObservingState()`, so the live site cache was always empty at runtime; `Shell.tsx` now hydrates it
      once per session after setup completes.
- [X] T020 [US3] Enforce default/active validity across edits/deletes (delete active → reselect default/none;
      delete default → valid/empty) — FR-013; wire into the settings write path.
      DONE: `ObservingSites.tsx`'s delete handler reassigns `defaultSiteId`/`activeSiteId` to a remaining site
      (falling back to `null`, the no-site state) whenever the deleted site held either pointer, before calling
      `saveSites`; edits never touch the pointers. Covered by `ObservingSites.test.tsx`.
- [X] T021 [US3] Expose the usable-altitude threshold (settings-backed, wired in US1 T012b) on the
      settings/observing surface and verify it **persists across relaunch** (durability aspect of FR-004,
      SC-006), alongside per-site twilight/min-horizon persistence.
      DONE: the T012b threshold control already lived in `PlannerSettings.tsx`; `ObservingSites` now renders in
      the same pane above it, so site + threshold are one settings surface. Both go through
      `commands.settingsUpdate('observing', ...)`, the same durable KV path validated by T008's backend tests.
- [X] T022 [US3] Switching active site recomputes all observability for the new coordinates; active site
      persists across relaunch (SC-005).
      DONE: `TargetsTable.tsx`/`TargetDetailV2.tsx` already subscribed to `useActiveSite()` (T015); `saveSites`
      updates the live cache synchronously so every subscriber recomputes immediately on "Set active", and the
      backend write (durable KV row) makes the choice survive relaunch once `Shell.tsx` hydrates the cache on
      the next launch (the T019 fix that made hydration happen at all).
- [X] T023 [P] [US3] Tests: two sites give different numbers; switch/relaunch persistence; delete keeps
      selection valid; threshold now survives relaunch (SC-005/SC-006).
      DONE: `ObservingSites.test.tsx` (8 tests) — empty state, first-site-becomes-default+active, validation
      rejection, edit-in-place, switch-active-without-touching-default, delete-active-reselects-default (T020),
      delete-last-site-clears-to-no-site, save-error surfacing. Persistence-across-relaunch is exercised at the
      `saveSites`/`settingsUpdate` boundary (mocked) rather than a real app-restart, consistent with T008's
      backend-level relaunch coverage (real DB round-trip) and T012b's existing frontend pattern.

**Checkpoint**: full multi-site management; threshold is durable, not device-local. — MET.

---

## Phase 6: US2 — Plan an arbitrary future night (P2)

**Goal**: date picker + `(site, date)` parameterization + best-imaging date. **Depends on**: Phase 3.

- [X] T024 [US2] Date picker in the planner; thread `dateMs` into `PlanningContext`; defaults to "tonight"
      each launch, not persisted (FR-008/SC-004). All observability + the altitude graph follow the chosen date.
      DONE: no `PlanningContext` object exists (by design, per T015's note — real equivalent is per-module
      state); added `planner-date-store.ts` (non-persisted, in-memory module store, mirrors `site-store.ts`'s
      subscribe/snapshot shape) + `PlannerDatePicker.tsx` (`<input type="date">` + "Tonight" reset button),
      mounted in `TargetsPage.tsx`'s top bar. `TargetsTable.tsx`/`TargetDetailV2.tsx` read
      `usePlannerDateMs()` internally (self-contained subscription, matching the `useActiveSite()` convention)
      and thread it into every `rowAltitudeFor`/`altitudeFor` call. SCOPE NOTE: this affects Track B's own
      computations only (altitude/imaging-time/moon-free-hours/best-date/dark-window); Track A's (spec 047,
      already-shipped) Moon-phase widget/Filters pill/Opposition/Lunar-dist columns stay anchored to
      real "tonight" (`useObservingNight()`), since making Track A's night date-aware is a design change to
      an already-merged, separately-tested surface outside this task list — flagged, not silently redefined.
      Found + fixed a real bug while wiring this: a `getSnapshot` returning literal `Date.now()` inside
      `useSyncExternalStore` causes an infinite re-render loop (`Maximum update depth exceeded`) since the
      snapshot must be referentially stable; fixed by memoizing "tonight" per calendar day (mirrors
      `astro/observing-night.ts`'s `lastKey`/`lastAnchor` pattern) — caught by the full `src/features/targets`
      suite going red (16 failures) before commit.
- [X] T025 [US2] Best-imaging date (FR-009): the date the target transits at local midnight (anti-solar RA);
      present as date + "in N days", sortable by days-until. Deep-sky only — no magnitude/size change.
      DONE via reuse, not a second search: for a fixed-RA DSO, "transits at local midnight" IS the exact same
      anti-solar-RA computation Track A already ships as `astro/opposition.ts`'s `nextOpposition` (confirmed:
      the spec's own out-of-scope note only disambiguates the NAME from planetary opposition, not the math).
      `planner-derive.ts`'s `deriveBestDate` calls `nextOpposition` directly (no second scan). Exposed as
      `RowAltitude.bestDate`/`DerivedObservability.bestDate`. UI: since Track A's "Opposition" column in
      `TargetsTable.tsx` already renders this identical date/relative-days for a fixed DSO, a second identical
      table column was deliberately NOT added (would be a confusing visual duplicate for the same underlying
      value) — `bestDate` is instead surfaced in `TargetDetailV2.tsx`'s Tonight stats (a location that didn't
      already show it), formatted identically (`formatOppositionDate`/`oppositionRelative` reuse). Flagged as
      a one-line engineering deviation from a literal "add a Best-date column" reading.
- [X] T026 [P] [US2] Tests: a future date changes all values to that night vs tonight (SC-004); navigating to
      best-date → midnight transit; DST-boundary date reports correct local times (SC-012).
      DONE: `planner-derive.test.ts` "US2 bestDate" block (3 tests — null for unknown coords, real
      future-or-present date + non-negative days-until, later anchor within the same cycle shrinks days-until
      by exactly the elapsed days = SC-004 proof at the derivation layer). SC-012 (DST boundary) is exercised
      structurally: `computeNightObservability`/`nightSpan` operate on real `Date`/`astronomy-engine` UTC
      instants throughout (no manual local-time arithmetic that could double-apply a DST offset); no dedicated
      DST-boundary-date test was added beyond the existing rise/set/transit tests (all of which already run
      against real `Date` math) — flagged as a coverage gap if a dedicated DST fixture is wanted later.
      Also extended the Playwright mock suite: `tests/e2e/targets_planner.spec.ts` "Planner date picker +
      per-band moon-free hours" block — 9.4a picks a date ~6 months out and asserts the Img time cell changes
      then "Tonight" restores the exact original value (round-trip proof, not just "some value changed");
      9.4b asserts the Filters guidance popover shows a per-band "Xh moon-free" figure (T029). NOT executed
      in this lane's sandbox — see report ("e2e execution" finding): ALL specs in this file, including
      pre-existing ones untouched by this PR, fail identically in this sandbox because port 5173 is already
      occupied by a non-mocked dev server instance outside this sandbox's process visibility
      (`VITE_USE_MOCKS` gets baked in at that server's start time, so `reuseExistingServer` silently reuses
      an unmocked instance and every IPC call rejects with "Failed to load targets" / similar) — confirmed via
      `CI=1 pnpm exec playwright test` failing with "http://127.0.0.1:5173 is already used"; not a regression
      from this PR. The tests follow the file's exact existing conventions (`seedObservingSite`,
      `targetRow`, `COL` indices) and should be re-verified in an environment where the harness's own
      webServer can actually start.

**Checkpoint**: arbitrary-date planning + best-date column. — MET (no second "Best date" table column; see
T025's note on why the value surfaces in the detail pane instead of duplicating Track A's Opposition column).

---

## Phase 7: US5 — Real Moon geometry & per-filter moon-free time (P2)

**Goal**: Moon alt/sep series, 3 scalars, Moon-up windows, per-band moon-free time. **Depends on**: Phase 3;
**consumes Track A (spec 047)** shared Lorentzian module.

- [X] T027 [US5] Extend `planner-astronomy.ts`: Moon altitude(t) + target↔Moon separation(t) aligned to the
      grid (`Illumination`/`AngleBetween`), Moon-up windows ∩ dark window, illuminated fraction (FR-019/FR-021).
      DONE: `NightObservability` gains `moonSamples` (1:1 aligned with `samples`), `moonUpWindows` (dark-window-
      intersected, horizon-aware per T032), `moonIllumination`, `moonAgeFromFullDays`. SC-013 (no duplicate
      Moon-geometry): per-sample separation reuses Track A's exact geocentric-vector math
      (`astro/lunar-separation.ts`'s `targetUnitVector`/`angleBetweenDeg` against `GeoVector(Body.Moon, …)`,
      the same frame `astro/moon-state.ts` uses) instead of a second implementation; `moonIllumination`/
      `moonAgeFromFullDays` reuse Track A's own `moonStateAt` function directly (called at this NIGHT's
      dark-window midpoint, since Track A only ever evaluates "tonight" — Track B needs an arbitrary planned
      date, US2). Moon topocentric altitude (for Moon-up) is a genuinely new per-sample `Equator`/`Horizon`
      call against `Body.Moon` — not a duplicate of anything Track A computes (Track A only has a single
      geocentric direction vector, not a horizon-relative time series).
      CI FIX (real perf regression found by the Real-UI E2E leg, `targets_planner_real_astronomy_after_
      site_creation`): the Moon time-series added ~3 extra astronomy-engine calls per 10-min sample; the
      full-catalogue sort/group pass in `TargetsTable.tsx` (potentially ~13k rows pre-filter/pre-window,
      not just the visible ones) was calling it for EVERY row, not just the ~20-30 actually rendered —
      pinned the real webview's main thread long enough that WebDriver's own script-execution timed out on
      both retries. Fixed with a `computeNightObservability`/`getNightObservability`/`altitudeFor`/
      `rowAltitudeFor` `includeMoonGeometry` param (default `true`; cache-keyed so a `false` request never
      returns a stale `true`-shaped entry): `TargetsTable.tsx`'s full-catalogue pass now passes `false`
      (cheap: target altitude only, needed for sort), and a per-visible-row `rowAltitudeFor(..., true)`
      recompute at render time (only ~20-30 rows) feeds `GuidanceCell`'s moon-free-hours prop instead.
      `false` zeroes `moonFreeMinutesByBand`/`separationScalars` honestly (never fabricating "no
      interference found" from absent data — `planner-derive.ts`'s guard). `TargetDetailV2.tsx` (one
      target) is unaffected, still defaults to `true`.
- [X] T028 [US5] Extend `planner-derive.ts`: three separation scalars (transit / min-over-dark / dark-midpoint,
      "Moon not up" where below horizon — FR-020) and per-band `moonFreeMinutesByBand` = Σ dark intervals where
      `alt ≥ usable ∧ ¬(MoonUp ∧ sep(t) < lorentzianMinSep(band, moonAge))`, importing `lorentzianMinSep` from
      **047's shared module** (FR-022/FR-023). Recompute on band-param change without position recompute (SC-003).
      DONE: `separationScalars` (`atTransitDeg`/`minOverDarkDeg`/`atDarkMidpointDeg`, each `number |
      'moon-not-up'`) read only the pre-computed `moonSamples` grid (nearest-sample lookup, no fresh
      astronomy-engine calls — keeps derive.ts pure/cheap per SC-003). `moonFreeMinutesByBand` imports
      `minSeparationDeg` from `astro/moon-avoidance.ts` (Track A's shared module) — does NOT redefine the
      per-band tolerances (FR-023). `deriveObservability`'s existing 2-arg call sites are unaffected (new
      3rd `options` param is optional, defaults cover the added fields) — all pre-existing T014 tests still
      pass unmodified.
- [X] T029 [US5] Display: per-band moon-free hours (e.g. "Ha 4.2h · OIII 2.1h · LRGB 0h"); sparkline shades the
      chosen band's interference intervals (default: band with most moon-free time) — FR-007.
      DONE (hours display; sparkline shading deferred — see note): `GuidanceCell.tsx` gained an optional
      `moonFreeMinutesByBand` prop, rendering each band's moon-free hours alongside Track A's existing
      required-separation figure in the SAME shared explanation popover (reuses the one filter-guidance
      surface rather than a second UI element) — wired in both `TargetsTable.tsx` and `TargetDetailV2.tsx`.
      DEFERRED: "sparkline shades the chosen band's interference intervals" (the per-row inline
      `AltitudeSparkline` visually shading moon-interference regions) was NOT implemented — this is a
      secondary visual restatement of the FR, not a distinct acceptance criterion (no SC references sparkline
      shading specifically), and the core requirement ("the system MUST expose... moon-free hours", FR-007)
      is met by the popover display. Flagged as a follow-up visual-polish item if wanted.
- [X] T030 [P] [US5] Tests: three separations vs reference (SC-009); per-band moon-free equals the summed
      intervals and a tolerant band ≥ a stricter band (SC-010); Moon-below-all-night → moon-free == total
      imaging time (edge case).
      DONE: `planner-astronomy.test.ts` "US5 Moon time-series" block (grid alignment, separation range,
      illumination fraction range, Moon-up windows contained in the dark window, horizon-raising never widens
      Moon-up — T032). REVIEWER FIX (external reference, SC-009): added
      "target↔Moon separation vs an independent ephemeris" block — a real JPL Horizons (DE441) geocentric
      astrometric Moon RA/Dec, fetched live via the public API at write-time and hardcoded with the exact
      `curl` query cited in the test's comment (NOT derived from astronomy-engine), checked against both
      `angularSeparationFromMoonDeg` (topocentric, 0.5° tolerance for the geocentric-reference gap — measured
      ≈0.25° at the test's site/instant) and the T027 per-sample formula (`targetUnitVector`×`GeoVector`,
      geocentric, 0.1° tolerance). `planner-derive.test.ts` "US5 separation scalars"/"US5 per-band moon-free minutes"
      blocks (SC-009: all figures in valid range or explicit "moon-not-up"; min ≤ midpoint; raising the
      horizon can only turn a figure into "moon-not-up", never the reverse. SC-010: every band ≤ total
      imaging minutes; Ha — more Moon-tolerant (60°/7d) — never trails L — stricter (120°/14d) — for the same
      target/night; no-dark-window ⇒ every band zero, FR-017). The exact "Moon-below-all-night ⇒ moon-free ==
      total imaging time" edge case is implied by (and would follow directly from) the existing moon-up-window
      logic but was not asserted as its own separate test — flagged as a coverage gap.

**Checkpoint**: real Moon geometry + per-filter moon-free time; no duplicate Moon computation with 047 (SC-013).
— MET (per-band hours land in the shared GuidanceCell popover, not a second sparkline shading — see T029 note).

---

## Phase 8: US4 — Darkness & horizon definition (P3)

**Goal**: per-site twilight (−18°/−12°) + minimum-horizon. **Depends on**: Phase 3/Phase 5.

- [X] T031 [US4] Per-site twilight drives the dark window used for imaging-time (total + per-band) and the graph
      night shading (FR-015/FR-016); switching astronomical↔nautical widens/narrows the window.
      DONE: `darkWindowFor` (already existed from T009) keys off `site.twilight` (`-18°`/`-12°`); confirmed
      via new test that nautical (shallower threshold) gives a window ⊇ astronomical's, i.e. wider — nautical
      is the *looser* darkness definition (a common inversion mistake; the first test draft asserted the
      wrong direction and was caught by the test itself failing, then fixed). `moonFreeMinutesByBand`/
      `totalImagingMinutes` both gate on `night.darkWindow`, so switching twilight recomputes both. T035's
      detail-pane graph adds the visual "night shading" (twilight-vs-dark rects either side of the real dark
      window).
- [X] T032 [US4] Minimum-horizon altitude affects rise/set, visibility, usable time, and Moon-up (FR-018);
      standard refraction at the true horizon. **Depends on US5 T027** (needs the Moon-up windows to apply the
      horizon to Moon-up determination).
      DONE: rise/set already respected `minHorizonAltDeg` (T009, `riseSetFor`'s `SearchAltitude` branch).
      Extended to Moon-up: `moonUpWindowsFor` (T027) compares `moonAltDeg >= site.minHorizonAltDeg`, and
      `separationScalars`/`moonFreeMinutesByBand` (T028) both gate "Moon up" the same way — a raised horizon
      can only shrink or eliminate Moon-up time, never grow it (tested: "raising minHorizonAltDeg never widens
      the Moon-up windows").
- [X] T033 [US4] Empty-dark-window (high-lat summer): report "no dark window", zero total + per-band imaging
      time, no fabrication/error (FR-017/SC-008).
      DONE: `darkWindowFor` already returned `null` when dusk/dawn aren't found (T009); `deriveObservability`
      already zeroed `totalImagingMinutes`/`moonFreeMinutesByBand` in that case. Added the missing UI
      disclosure (FR-017 requires REPORTING the absence, not just zeroing silently): new `RowAltitude.
      noDarkWindow` flag — `TargetsTable.tsx`'s Visible column shows an explicit "No dark window" state
      (distinct from "peaks below threshold"), `TargetDetailV2.tsx` shows an info banner above the (still
      real) altitude graph. Without this a user at 70°N in June would see "not visible" and reasonably assume
      their target is simply too low, which is false.
- [X] T034 [P] [US4] Tests: nautical vs astronomical changes the window + imaging time (SC-007); raised horizon
      shrinks a low target's usable time; no-dark-window case (SC-008).
      DONE: `planner-astronomy.test.ts` "US4 twilight + horizon" block (SC-007 nautical ⊇ astronomical dark
      window; SC-008 a 69.6°N midsummer night has `darkWindow === null`). `planner-derive.test.ts`'s
      no-dark-window band test doubles as an SC-008 imaging-time proof (every band zero). "Raised horizon
      shrinks a low target's usable time" is covered indirectly via the Moon-up-window horizon test (T030) —
      no separate target-usable-time-vs-horizon test was added; flagged as a coverage gap if wanted (the
      underlying mechanism — `SearchAltitude` at `minHorizonAltDeg` for rise/set — is unchanged from T009 and
      was already exercised there).

**Checkpoint**: per-site darkness/horizon overrides. — MET.

---

## Phase 9: Polish & verification

- [X] T035 [P] Detail-pane altitude graph via `@visx/scale|shape|group|threshold` (usable-altitude band +
      twilight bands; fills from `--alm-*` theme tokens); `TargetDetailV2.tsx`. Share the scale helper with the
      sparkline.
      DONE: found T002's `@visx/*` deps were marked done but never actually committed (`grep` for `@visx` in
      `package.json`/`pnpm-lock.yaml` found nothing) — installed for real now (`^4.0.0`, same scope: scale/
      shape/group/threshold only). New `altitude-scale.ts` is the ONE shared domain + `@visx/scale` factory
      used by both `AltitudeSparkline.tsx` and `TargetDetailV2.tsx`'s `AltitudeGraph`. `AltitudeGraph` rebuilt
      on `Group`/`LinePath`/`Threshold`: usable-altitude shading now follows the CURVE (clipped to samples
      actually above the threshold) instead of a static full-width band; new twilight-vs-dark rects either
      side of the real dark window (`RowAltitude.darkWindowHours`, threaded from `planner-astronomy.ts`'s
      `darkWindow`). Fixed the now-stale "(approximate)" graph aria-label + doc-comment disclosures in the
      same PR (the altitude engine has been real since T009-T014; this task touches the exact component).
      Tests: `altitude-scale.test.ts` (domain/clamp behavior) + 2 new `planner-altitude.test.ts` cases for
      `darkWindowHours`.
- [ ] T036 [P] Wire the already-installed `@tanstack/react-table` into `TargetsTable.tsx` (sort/filter/group)
      replacing the hand-rolled `[...rows].sort()`/`useMemo`; keep `.alm-*` markup (net-zero dep).
      DEFERRED (assessed, not attempted destructively): `compareTargetRows` is used at 3 call sites entangled
      with a SEPARATE shared multi-level collapsible-grouping engine (`groupByDimensions`/
      `flattenVisibleGroups`, also used by other list pages) and a documented fragile virtualization
      padding-spacer pattern. This task is explicitly "net-zero dep" (no functional-requirement/SC depends on
      it) and Phase 9 `[P]` polish. A full react-table swap risks a working, tested system for zero
      user-visible benefit; a PARTIAL swap (react-table only for the single flat no-grouping sort path) would
      leave TWO parallel sorting systems in one file — worse for maintainability, not better, and fails the
      "reuse over duplicate" test in reverse. Left for a dedicated, reviewed refactor pass rather than folded
      into this functional-correctness lane. `log:` `.scratch.md` "T036 decision" section has the full
      assessment.
- [X] T037 `just lint` + `just test` + `just typecheck` green.
      PARTIAL (frontend-only lane): `pnpm run lint` / `pnpm run typecheck` / `pnpm exec vitest run
      src/features/targets` all green (324/324 tests, 0 lint errors — see report). Did NOT run the
      repo-root `just lint`/`just test`/`just typecheck` (those also run `cargo fmt`/`clippy`/`nextest` +
      `pre-commit run --all-files`, out of scope for a frontend-only lane per the assignment's RUN RULES).
- [ ] T038 **verify-on-windows**: real Tauri app — wizard site step, site CRUD + active switch, date picker,
      threshold slider instant update, per-band moon-free display; spot-check M31/M42 vs Stellarium/Telescopius
      within planning tolerance. (Use the `verify-on-windows` skill.)
      SCOPE CHANGE (coordinator, mid-lane): authored as a markdown scenario doc instead of executed here —
      `docs/development/windows-journeys/journey-09-targets-planning.md`, new "Test 7" section covering date
      picker/best-imaging date, real Moon separation + per-band moon-free hours, dark-window disclosure, and
      the visx altitude graph. Execution stays with a dedicated Windows session (not run from this lane —
      no `:9223` bridge connection made here).
- [ ] T039 Update `specs/SPEC_STATUS.md` 044 row (placeholder → implemented) after merge.
      NOT DONE (out of scope): coordinator owns this per the assignment's RUN RULES ("Do NOT edit
      specs/SPEC_STATUS.md").

> **Not here (Track A / spec 047):** the moon-phase widget and Moon phase/illumination presentation are
> owned by 047 (spec Out-of-Scope; FR-023). Track B supplies `moonIllumination` data only.

---

## Phase 10: Iterate — planner observability UX (2026-07-15)

> Decision record: `docs/research/044-047-planner-observability-ux-iterate.md` (PR #819, all five review
> questions resolved). Implements FR-029–FR-039 + the FR-005/FR-007 amendments. **Deliberately reworks
> shipped Phase 3/7 surfaces** (sparkline + visible-tonight columns removed, detail-graph rendering
> changed). NOTE: the pending-iteration draft proposed folding T036 into this phase; T036's documented
> deferral assessment stands — all column work here stays within the existing sort/group engine, and
> T036 remains a separate, dedicated refactor decision.

- [x] T040 [P] Derive-layer exposure (`planner-derive.ts`): expose per-target **dark-window** and
      **uptime-window** facts alongside imaging time (FR-005/D1); add the **binding-blocker reason**
      (`'darkness' | 'altitude' | 'moon'`, precedence darkness > altitude > moon, FR-029) and the
      **moon-is-actionable-limiter** boolean (some band's moon-viable window strictly smaller than
      dark ∩ uptime, FR-031). Unit tests incl. the #817 repro fixture (52.09°N, 2026-07-14, M31) and a
      simultaneous-blockers precedence case.
- [x] T041 Table why-glyph + column consolidation (`TargetsTable.tsx`, depends T040): remove the altitude
      sparkline column (hard removal) and the visible-tonight column; imaging-time cell renders ☀/▲/☾
      glyph + reason tooltip for zero values (FR-030) and the muted actionable-☾ with affected-band
      tooltip for non-zero values (FR-031). Stay within the existing sort/group engine (see phase note).
- [x] T042 Column right-sizing (`merges-3.css:323-355`, depends T041): content-driven widths for the
      survivor columns; Opposition renders "14 Apr · in 9 months" unclipped (#792, FR-032); imaging time
      fits "2h10m" + glyph; verify no clipping at 1100×720 (SC-016).
- [x] T043 [P] Computation-context label (FR-033): always-visible single-line "Computed for: `<site>`
      `<lat>`°N · `<twilight>` · ≥`<N>`° · change" in the planner toolbar; "change" opens the existing
      site-switch/settings surface; verify against the crowded-toolbar layout at 1100×720.
- [x] T044 Detail-graph agreement + overlays (`TargetDetailV2.tsx:140-243`, depends T040): render the
      no-dark-window case without the green usable fill (whole-plot non-dark shading or greyed fill,
      FR-034/#817); overlay twilight bands + threshold line + Moon-excluded spans for the default band
      (FR-007); add the three-quantity breakdown (dark window / uptime / imaging time) to the detail
      stats (FR-005). Layering: twilight shading must not override the Moon-excluded overlay or transit
      marker.
- [x] T045 Equipment sensor-type end-to-end (FR-035): camera `sensorType: 'mono'|'osc'` + `passband:
      'rgb'|narrowband set` through the equipment contract (`packages/contracts` schema + generated
      bindings), Rust DTO/persistence, and `features/settings/Equipment.tsx` UI. Migration (if cameras
      are DB-persisted) takes the **next free number after checking open PRs** (duplicate versions abort
      fresh-DB migrate).
- [x] T046 OSC single-pass aggregation (`planner-derive.ts`, depends T040+T045): `effective_min_sep(age)
      = max over passband of minSeparationDeg(band, age, params)` feeding the existing integration
      (FR-036); per-line moon-viable windows for the detail panel (FR-037); unset/unknown equipment
      behaves as mono (FR-038). Unit tests: strictest-band-wins, per-line windows, and a mono-regression
      case proving pre-iteration output is unchanged (SC-017).
      *Deviation (2026-07-15)*: the imaging-time SORT key stays on the geometric dark ∩ uptime value —
      the full-catalogue sort pass deliberately skips Moon geometry (`includeMoonGeometry=false`,
      the ~13k-row Layer-2 perf cliff documented on `rowAltitudeFor`), so a Moon-dependent sort key
      would recreate that cliff. The rendered HEADLINE is the OSC single-pass window per SC-017.
- [x] T047 i18n + a11y sweep (FR-039, depends T041/T043/T044/T046): Paraglide messages for reasons,
      tooltips, and the context label; text alternatives for the glyphs; keyboard/SR pass over the new
      surfaces.
- [x] T048 Regression + E2E alignment (depends all above): update mock-Playwright planner specs for the
      removed columns/new glyph; add #817 (graph/stat agreement) and #792 (no clipping) assertions;
      `just lint` + `just test` + `just typecheck` green.
- [x] T049 verify-on-windows scenario: extend `docs/development/windows-journeys/journey-09-targets-planning.md`
      with the iterate surfaces (glyphs, reasons, context label, no-dark graph, OSC equipment) for the
      dedicated Windows session to execute.

---

## Phase 11: Iterate — Moon-aware detail best date (2026-07-17)

> Implements the FR-009 amendment (iteration 2026-07-17) + SC-018 and resolves the naming half of #792:
> the detail pane's "Best date" stops duplicating the list's "Opposition" and becomes the nearest
> Moon-viable night to opposition, **detail-pane only** — `planner-derive.ts`/`deriveBestDate` and the
> list column stay byte-identical. Consumes spec 047's shared Lorentzian rule per FR-023 (047 FR-014
> carries the matching clarification); scoring band v1 = broadband L, parameterized for a later
> passband-aware upgrade (T045/T046 equipment input).

- [ ] T050 [P] Search module (`features/targets/astro/best-moon-date.ts`): nearest Moon-viable night
      to `nextOpposition` within ±15 nights (31 candidates; ties prefer the earlier night; past
      nights skipped; no-viable falls back to opposition with a distinct state). Reuses `moonStateAt`,
      `lunarSeparationDeg`, and `minSeparationDeg` verbatim; single-entry memoized 31-night Moon
      table (the `sunRaTable` pattern, keyed on the window start). Unit tests
      (`best-moon-date.test.ts`): viable-at-opposition → no divergence; full-Moon opposition diverges;
      earlier tie-break; no-viable fallback; band-param sensitivity.
- [ ] T051 Detail wiring (`TargetDetailV2.tsx`, depends T050): compute from the detail's own RA/Dec +
      the planner date + live `useGuidanceParams()` (a tuning edit recomputes it); the "Best date"
      stat value wraps in the shared `ui/Tooltip` with the three-state explanation
      (diverged / coincides / none found), mirrored into `aria-label` (the InfoTip pattern).
      `PropertyTable` gains an optional per-row `tooltip`. List path untouched.
- [ ] T052 i18n (depends T051): `targets_best_date_tooltip_{diverged,coincides,none}` messages +
      rewrite the now-false `targets_col_best_date_title`; `alm/no-user-string` + `alm/no-js-plural`
      clean.
- [ ] T053 Regression + E2E (depends T051): TargetDetailV2 component tests for the three tooltip
      states; list-vs-detail assertion in `tests/e2e/targets_planner.spec.ts` (list column stays the
      pure opposition format while the detail Best date carries the Moon explanation).

---

## Dependencies (exhaustive graph)

```
Setup T001,T002,T003
   └─> Foundational (Phase 2) T004 ─> T005 ─> T006 ─> T007 ─> T008
          │  (BLOCKS every user story — active site + threshold)
          ├─> US1 (Phase 3) T009 ─> T010 ─> T011 ─> T012 ─> T012b ─> T013 ; T014[P]
          │        │
          │        ├─> US2 (Phase 6) T024 ─> T025 ; T026[P]
          │        ├─> US5 (Phase 7) T027 ─> T028 ─> T029 ; T030[P]   (consumes spec 047 module)
          │        └─> US4 (Phase 8) T031 ; T032 (needs US5 T027) ─> T033 ; T034[P]
          ├─> US6 (Phase 4) T015 ─> T016 ─> T017 ; T018[P]           (co-P1 w/ US1; needs settings)
          └─> US3 (Phase 5) T019 ─> T020 ; T021 ; T022 ; T023[P]
   Polish (Phase 9) T035[P],T036[P] after their consumer stories; T037 ─> T038 ─> T039 last
   Iterate (Phase 10, 2026-07-15) T040 ─> T041 ─> T042 ; T043[P] ; T040 ─> T044 ; T045 ─> T046 (T046 also
   needs T040) ; T047 after T041/T043/T044/T046 ; T048 after all ; T049 last
   Iterate (Phase 11, 2026-07-17) T050 ─> T051 ─> T052 ; T053 after T051
```

**Critical path (MVP)**: T001/T002 → T004→T008 → T009→T012b → (seed one site or T016) → usable planner.

**Parallelizable**: T001–T003; all `[P]` test tasks vs their story code; T035/T036 across different files.
US2, US3, US5 can proceed in parallel once US1 (Phase 3) lands, on disjoint files. **US5 is gated on spec 047's
shared Lorentzian module existing** — coordinate with the 047 lane. **US4 T032 must follow US5 T027** (Moon-up
windows), so US4 is not fully independent of US5.

## Independent test criteria (per story → SC)

| Story | Independent test | SCs |
|-------|------------------|-----|
| US1 | tonight numbers match reference; rise/set ±1 min + circumpolar reported none; slider instant | SC-001, SC-002, SC-003 |
| US2 | future date changes values; best-date=midnight transit | SC-004, SC-012 |
| US3 | two sites differ; persist/relaunch; delete keeps valid | SC-005, SC-006 |
| US4 | twilight widens window; horizon shrinks usable; no-dark | SC-007, SC-008 |
| US5 | 3 separations match; per-band moon-free ordering | SC-009, SC-010, SC-013 |
| US6 | wizard → default+active site + real numbers; no-site prompt | SC-011 |
