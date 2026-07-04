# Track B (spec 044) — Ephemeris/Observer Engine — Orchestrator Handover

**Date**: 2026-07-04
**From**: Track B speccing session (`a034419a`, resumed)
**To**: Campaign orchestrator
**Branch**: `044-targets-planner-track-b` (local-only worktree at
`/home/sjors/tmp/worktrees/astro-plan/044-track-b`, **unpushed**)
**Boundary**: SPEC ONLY — no implementation until plan→tasks pass review and the user is
grilled on the banked pre-implementation decisions.

---

## 1. Status at handover

| Phase | State |
| --- | --- |
| Research (engine choice) | ✅ done — locked to `astronomy-engine` (frontend). Recorded in ADR-0001 + `docs/research/044-frontend-astronomy-libraries.md`. **`research.md` SpecKit artifact not yet written.** |
| Specify | ✅ `spec.md` committed `3e1c4476` (full rewrite, internally consistent: FR-001..028, SC-001..013, US1..6, edge cases, deps). |
| Clarify | ✅ rounds 1 + 2 + moon-banding + wizard — all answered (see §3). |
| ADR | ✅ `docs/adr/0001-astronomy-compute-boundary.md` committed `63cf5bb3` on this branch. |
| Plan (`plan.md` + `data-model.md` + `contracts/`) | ❌ not started — the delegated plan agent died on the session limit before writing anything. |
| Tasks (`tasks.md`) | ❌ not started. |
| speckit-verify (spec-level) | ❌ pending after plan+tasks. |

**Commits on the branch:**
```
63cf5bb3 docs(adr): record ADR-0001 astronomy compute boundary (spec 044)
3e1c4476 spec(044): Track B ephemeris/observer engine — frontend pivot + per-band moon-free + wizard site-first
c2ed35a9 spec(044): draft Track B ephemeris/observer-location engine spec
```

---

## 2. Remaining artifacts for a plan lane to produce (no code)

All decisions are locked (§3); this is faithful translation into SpecKit artifacts, then verify.
Model the artifact set on `specs/018-settings-configuration-model/` (settings pattern) and
`specs/041-inbox-plan-surface/` (full plan/data-model/contracts/tasks set).

1. **`research.md`** — constitution-IV gate. Content already exists in ADR-0001 +
   `docs/research/044-frontend-astronomy-libraries.md` + the ledger. Must record: engine
   comparison (astronomy-engine vs dormant `astro`/saurvs vs ANISE vs Meeus hand-port) with
   accuracy/maintenance/**license**/bundle rationale; planning-grade accuracy justification
   (≤1′, exceeds need); offline confirmation; observer-model placement (spec-018 settings);
   scope boundary vs Track A. Small open research: bundled IANA-tz list for the offline site
   picker.
2. **`plan.md`** — topology in §4; the ONLY backend/persistent work is the ObserverSite
   settings extension + one migration (§5). Everything else is frontend astronomy-engine.
3. **`data-model.md`** — ObserverSite entity + settings-state extension (§5); the frontend
   "night observability" and "derived observability" result shapes (spec.md Key Entities).
4. **`contracts/`** — the only new contract surface is the spec-018 settings extension
   (ObserverSite CRUD + global usable-altitude threshold via existing settings get/update
   scope-values). **No new astronomy IPC command** — compute is frontend (ADR-0001).
5. **`tasks.md`** — dependency-ordered, grouped by US1..US6 (spec.md priorities: US1 & US6
   are co-P1). Include the mock→real replacement, site UI, wizard step, settings migration,
   tests, and verify-on-windows.
6. **speckit-verify** — spec-level gate before declaring tasks ready. NO implementation.

---

## 3. Locked decisions (authoritative — from user grilling)

| Decision | Choice |
| --- | --- |
| Engine | **astronomy-engine** (cosinekitty, npm `2.1.19`) — MIT, self-contained (embedded VSOP87, no data files, offline), ~48 KB gzip, ≤1′ vs NOVAS. Reversed from a Meeus hand-port on user rec. |
| Compute location | **Full frontend** (TS). No backend astronomy command, no `crates/ephemeris/core`. |
| Target scope | Deep-sky (fixed J2000 RA/Dec) + the Moon only. No planets/comets/asteroids. |
| "Best date" | Best-imaging date = transit at local midnight (anti-solar). **NOT** planetary opposition; no magnitude/size change. Shown as date + "in N days", sortable. |
| Observer model | Multiple named `ObserverSite`s, one default + one active pointer; new persisted entity in spec-018 settings; optional FITS `ObserverLocation` seed (confirmed, never silent). |
| Accuracy | Planning-grade: ≈1′ altitude, ≈±1 min rise/set/transit. Not pointing-grade. |
| Precession | **REQUIRED**: J2000 → of-date before `Horizon()` (`DefineStar` + of-date `Equator`, or `Rotation_EQJ_EQD`). ~20′ drift by 2026 → ~1–2 min on rise/set. The mocks skipped it; the plan must not. (FR-026.) |
| Night window | Per-site twilight: astronomical (sun −18°) default, switchable to nautical (−12°). Empty-dark-window (high-lat summer) reported, not fabricated. |
| Horizon | Flat 0° + standard refraction default; optional per-site minimum-altitude for obstructions. Elevation stored + passed to library. |
| Usable-altitude threshold | **Global** setting, default 30°; promoted from localStorage to spec-018 settings (survives relaunch). Replaces hardcoded `USABLE_ALT_DEG`. |
| Date range | Arbitrary-date planning (date picker); ephemeral, defaults to tonight each launch, not persisted. |
| Moon interference | Track B emits **raw geometry only**: moonAlt(t), separation(t), 3 separation scalars (transit / min-dark / dark-midpoint), Moon-up windows, dark window. **The single `min_lunar_separation_deg` knob is DEAD.** |
| Per-filter moon-free time | Track B **integrates** Track A's per-band Lorentzian rule over its geometry: `moonFreeTime(b) = Σ` intervals where `alt ≥ usable ∧ t ∈ dark ∧ ¬(MoonUp ∧ sep(t) < lorentzian_min_sep(b, moonAge))`. Display per band ("Ha 4.2h · OIII 2.1h · LRGB 0h"). |
| Sparkline | Track B draws altitude + usable-uptime; per-band interference shading keys off a chosen band (default: band with most moon-free time; later global band picker). |
| Site-first + wizard | Planner renders no astronomy until an `ObserverSite` exists; first-run wizard creates the default+active site (name/lat/lon/tz required, elevation optional, FITS prefill). |
| Caching | On-demand client-side; no persistence (read-only projection). Positions computed once per (site,date); threshold/param changes re-derive without recomputing positions. |
| Sampling | Fixed **10-min grid** for curve/sparkline/imaging-time/interference; rise/set/transit **refined exactly** via `SearchRiseSet`/`SearchHourAngle`. |
| Charts/table (plan-stage) | visx à-la-carte (`@visx/scale|shape|group|gradient|threshold`; NOT xychart); sparkline hand-rolled sharing one scale helper; wire the **already-installed-but-unused `@tanstack/react-table`** (net-zero dep); moon-phase widget = hand-rolled SVG off `Illumination`/`MoonPhase`. |

**Library map (astronomy-engine):** `SearchAltitude` (twilight −6/−12/−18°), `SearchHourAngle(0)`
(transit), `SearchRiseSet` (rise/set), `AngleBetween` (separation), `Illumination`/`MoonPhase`,
`Constellation(ra,dec)` (J2000-direct), built-in refraction. Only 8 `DefineStar` slots →
per-target one-at-a-time sampling loop.

---

## 4. Topology (plan.md skeleton)

- **Frontend (bulk of the work):** add `astronomy-engine` npm dep **once** (047 imports the same;
  mcp-package-version check at plan time). Replace the mock stack in `planner-altitude.ts` +
  `TargetDetailV2.altitudeCurve()` (currently sinusoid @ hardcoded `STUB_OBSERVER_LAT_DEG = 52.1`,
  transit hardwired to midnight, dec = hash of designation) with real compute from RA/Dec + active
  site: 10-min altitude grid, exact rise/set/transit, twilight dark window, moonAlt(t)/separation(t)/
  illumination, Moon-up + interference windows, per-band moon-free time. Add site selector, date
  picker, per-site twilight toggle. **Precess J2000→of-date before `Horizon()`.**
- **Backend (ONLY persistent work):** spec-018 `SettingsState` extension —
  `Vec<ObserverSite { id, name, lat, lon, elevation_m, timezone, twilight, min_horizon_alt }>` +
  `default_site_id` + `active_site_id` + global `usable_altitude_deg`; one new migration
  (next free number at impl time); site CRUD via existing settings IPC. Optional first-site seed
  from FITS session `ObserverLocation`.
- **No** `planner.target_night` command, no ephemeris crate, no DB cache.

---

## 5. Backend/persistent scope (the only handroll)

- **ObserverSite** collection on spec-018 `SettingsState` (fields above) + default/active pointers.
- **usable_altitude_deg** promoted from localStorage → settings.
- Per-site twilight choice + minimum-horizon on `ObserverSite`.
- Optional auto-seed of first site from FITS `ObserverLocation` (lat/lon/tz; no elevation).
- Planning date is ephemeral (defaults tonight; not persisted).
- **Migration numbering (critical):** convoy holds reservations 0052 (#404, in flight) and
  0056–0059 (mostly unused). The ObserverSite migration MUST take the next free number **at
  implementation time after checking open PRs** — duplicate versions abort fresh-DB migrate.

---

## 6. Cross-track / cross-spec coordination

- **047 engine unification (confirm applied):** both tracks use frontend astronomy-engine; the
  shared `crates/ephemeris/core` is **DROPPED**. 047 must NOT diverge onto Rust. Only shared
  backend work across tracks = the ObserverSite settings model (+1 migration). The
  `astronomy-engine` npm dep is added ONCE; the second track imports it.
- **047 owns the Moon-avoidance product rule:** per-band Lorentzian `min_sep(age) = distance /
  (1 + (age/width)²)`, per-band `(distance,width)` tunable, **LRGB included** (defaults: LRGB
  120°/14d, Ha/SII 60°/7d, OIII ~100–120°/~10d), plus phase/illumination, per-band viability
  pills, filter recommendation. Track B consumes the rule; does not define tolerances/pills/reco
  (FR-023). Rule + params live in ONE shared frontend module + shared settings.
- **spec-048 wizard hook:** Track B adds an observing-site wizard step. Must be coordinated with
  spec 048's wizard additions so the wizard isn't edited in conflicting ways (FR-025).
- **RA/Dec — RESOLVED (verified in code 2026-07-04):** `target.list`'s `TargetListItem` carries
  `raDeg`/`decDeg` (J2000) + `constellation`/`magnitude`/`aliases`; `target_management::list` →
  `cache::list_all` → `list_row_to_item` populates them; integration test
  (`crates/app/targets/src/target_management.rs:612–629`) asserts M31 (10.684708, 41.26875)
  flows end-to-end. **No RA/Dec plumbing needed.** Nulls only for unresolved targets → un-plannable.
- **Constellation:** compute frontend via `Constellation(ra,dec)` from J2000 — opportunistic
  Targets-list cleanup, owned by whichever track wires the library first; NOT a Track B blocker.
- **Keep-in-Rust (do NOT migrate):** targeting `angular_separation_deg` (inbox matching),
  sessions `observing_night`, FITS sexagesimal parsers.

---

## 7. Housekeeping / risks for the orchestrator

- **ADR duplication (benign):** untracked copies of `docs/adr/0001-*.md` + `docs/adr/README.md`
  remain in the **main checkout** (`?? docs/adr/`), authored by the sibling libraries-research
  session — left untouched (not this session's to delete in a shared checkout). They match the
  committed versions; the untracked status self-resolves when 044 merges into the integration
  branch. Orchestrator may drop them from the main checkout if it wants a clean status now.
- **Dangling ADR reference until rebase:** 044-track-b branched **before** the research-doc commit
  `36407468`, so the ADR's reference to `docs/research/044-frontend-astronomy-libraries.md`
  dangles on this branch until it rebases onto the current `redesign-ui-platevault` tip.
  **Recommend rebasing 044-track-b onto the integration tip** before the plan lane runs.
- **Branch unpushed:** `044-targets-planner-track-b` has no upstream. Push is clean (no
  `.github/workflows` changes, so no gh workflow-scope block). WSL git push needs the ssh.exe
  workaround (`GIT_SSH_COMMAND='ssh.exe'`) per prior sessions.
- **SPEC_STATUS.md** still lists 044 as "⚪ Placeholder" — update its row after the plan lands.
- **Ledger** (ephemeral): `/tmp/track-b-ephemeris-ledger.md` holds the full grilling history.
- **Do not run speckit skills from the main checkout blindly:** they pin to the main-checkout
  cwd + feature.json; the 044 spec lives in the worktree. Author into the worktree by absolute
  path or run the skill from within the worktree.

---

## 8. Pre-implementation grilling (banked for the user, per the brief)

The user asked to be grilled on decisions at the pre-implementation handoff. The specify/clarify
decisions are locked; residual items to confirm before code:

1. **Sparkline default band** — "band with most moon-free time" vs a fixed default (e.g. LRGB)
   until the later global band picker ships.
2. **ObserverSite ↔ 047 shared settings** — confirm the Lorentzian per-band params live in 047's
   settings namespace (not duplicated under Track B).
3. **Wizard/048 edit ownership** — who physically edits the wizard component (Track B vs 048) to
   avoid a conflicting-edit race.
4. **Rebase timing** — rebase 044-track-b onto the integration tip now (pulls in the research doc
   + any settings-migration reservations) vs at PR time.

---

## 9. Verification approach (for the eventual implementation)

- astronomy-engine outputs vs Stellarium / Telescopius spot-checks (M31, M42) within planning
  tolerance; property checks (altitude bounded, transit = max, rise/set bracket transit).
- Settings-migration integration test; frontend mock→real swap covered by component tests.
- `just lint` / `just test` / `just typecheck`.
- **verify-on-windows** on the real Tauri app for the site UI + wizard step + planner recompute.
- speckit-verify before declaring tasks generated (spec only — no implementation).
