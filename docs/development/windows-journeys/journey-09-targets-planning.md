# Windows validation — Journey 9: Targets & planning

> For: Claude computer-use ("cowork") on the Windows machine running PlateVault.
> You have NO access to the source repo. Everything you need is in this document.
> Report each Test as PASS / FAIL with what you observed.

## Journey facts (context — you do not act on this section)
- Product journey: `docs/product/user-journeys.md` Journey 9 (specs 023, 035,
  044 Track B, 047 Track A).
- Branch to test: `main` (unless a specific PR branch was named to you).
- Touches Rust backend? yes — real `target.resolve` (SIMBAD/offline seed
  cache), target CRUD/alias/notes commands. Frontend-only for the astronomy
  columns (astronomy-engine runs client-side).
- Changed surfaces: **Targets** page (catalog list, Add target, target
  detail), the planner's astronomy columns and altitude graph.
- **UPDATED 2026-07-09 — the gated-off framing below (Tests 6a/6b/6c) is now
  STALE and describes a state `main` no longer has.** Since this doc was
  written: spec 044 US3 (site CRUD, PR #440-equivalent) merged, and
  `site-gate.ts`'s `readSiteExists()` was fixed to read the real observing-site
  store instead of a hardcoded `false` (PR #450, commit `4e5c3a4f`). **A
  working site-creation UI now exists** (first-run wizard Site step, and
  Settings → Target Planner → Observing Sites), and once a default site
  exists, spec 047 (Moon phase, lunar separation, filter guidance, opposition)
  and spec 044 Track B (real per-site altitude, rise/set, imaging time, date
  picker, per-band moon-free hours, dark-window disclosure — see Test 7) all
  render for real. Tests 6a/6b/6c are KEPT below as regression checks for the
  no-site (gated-off) state, which is still a real, reachable state (a fresh
  install with no site configured) — but do NOT expect them to represent
  "the only state `main` can be in" the way the original note implied. If you
  see real astronomy on a fresh install with no wizard site step completed,
  that's a regression in the gate itself — report it.
- Automated coverage baseline today: **this journey has NO Layer-2 coverage
  and no Playwright mock coverage at all** (confirmed by both
  `verify-on-windows-journeys.md` and
  `e2e-mock-coverage-audit-2026-07-05.md`); `all_top_level_screens_load`
  only proves `/targets` renders without crashing. Spec 047's own task list
  (`specs/SPEC_STATUS.md` row 80) explicitly defers "T028 verify-on-windows"
  to "a separate campaign lane" — **this document is that lane.** ~23 vitest
  component files exist under `features/targets/` (including
  `__setSiteExistsForTest` seams that exercise the real-astronomy rendering
  path in isolation, since the real app can't reach it yet) but none of them
  are a real-backend or real-UI proof.

## Windows environment mechanics (read once, applies to every Test below)

- Windows checkout: `C:\dev\astro-plan`. Deploy: `git fetch origin`, then
  `git reset --hard origin/main` as its OWN command.
- **Recompile trap**: touch changed `.rs` files after a reset if Rust
  changed; otherwise a hard refresh suffices (this journey's astronomy
  columns are pure frontend — a hard refresh is enough for those; target
  resolve/CRUD are backend, so a full relaunch after a Rust change is
  required for those Tests).
- Reset to fresh first-run if needed:
  `Remove-Item 'C:\dev\astro-plan\wizard-test.db*' -Force`.
- Launch: `powershell.exe -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','C:\dev\astro-plan\run-dev.bat' -WorkingDirectory 'C:\dev\astro-plan'"`.
  Kill: `Get-Process desktop_shell,cargo | Stop-Process -Force`.
- Blank window recovery: restart dev server; if still blank, `pnpm install`
  with `$env:CI="true"`, relaunch.
- Tauri MCP bridge (optional): `cargo tauri dev --config
  src-tauri\tauri.dev.conf.json` (bridge WS on `0.0.0.0:9223`), connect with
  `driver_session host=localhost port=9223`, invoke via `webview_execute_js` →
  `window.__TAURI__.core.invoke('<snake_command>', {args})`. To fake an
  ObserverSite via the bridge instead of the UI, call `settings_update` with
  scope `'observing'` and values `{observingSites: [...], observingActiveSiteId,
  observingDefaultSiteId, usableAltitudeDeg}` (see `observing-sites/site-store.ts`
  for the exact shape) — the real site-creation UI (Test 6b) is the normal path.

## Preconditions
1. Deploy as above; complete first-run setup (bundled seed catalog loads
   automatically).
2. Network connection available for the SIMBAD resolve-on-demand test.
3. Sanity: Targets is reachable from the left nav and renders rows.

## Tests

### Test 1 — Catalog list, search, sort
Steps:
1. Open **Targets**. Search "M31", then separately search "Andromeda".
2. Sort by any column.
Expected:
- Thousands of rows render with smooth virtualized scroll. Both searches
  resolve to the same row. Sorting shows a single active sort indicator.
FAIL if:
- Either search fails to find the row, or scrolling stutters badly, or more
  than one sort indicator is active at once.

### Test 2 — Add target (local match, no duplicate)
Steps:
1. Click **Add target**, type a name that's in the local seed, confirm.
2. Repeat with the exact same name.
Expected:
- Exactly one row persists after both attempts (re-adding never creates a
  duplicate).
FAIL if:
- A second row appears after re-adding.

### Test 3 — SIMBAD resolve-on-demand (success + failure)
Steps:
1. Add a target name NOT in the local seed, with network available.
2. Separately, try an unresolvable/garbage name (or disconnect network).
Expected:
- Step 1: a real SIMBAD lookup happens and the result is cached (adding it
  again later should resolve instantly/offline).
  Step 2: an inline "not found"/unreachable message appears — never a
  fabricated row.
FAIL if:
- A row is fabricated for an unresolvable name, or no inline message
  appears on failure.

### Test 4 — Target detail identity, aliases, notes
Steps:
1. Open a target's detail page.
2. Add a user alias; search for it from the Targets list.
3. Try removing a catalog-provided alias.
Expected:
- Identity fields (designation, type, coordinates, source, catalog id where
  present) are real. The new alias becomes searchable immediately.
  Catalog-provided aliases cannot be removed (no delete control, or a
  disabled one); only user-added ones can be removed.
FAIL if:
- A catalog-provided alias can be removed, or a new user alias isn't
  searchable.

### Test 5 — Favourites is localStorage-only (expected, not a bug)
Steps:
1. Toggle "Favourites"/"My Targets" on a target.
2. Close and reopen the app.
Expected:
- It persisted (same browser profile / same app data). This is
  `localStorage`-only — it will NOT survive a profile reset or follow the
  user across machines. Confirm this is the actual behavior; it's expected,
  not a regression.
FAIL if:
- It doesn't persist across a normal relaunch (that WOULD be a real
  regression, since even the localStorage-only implementation should
  survive a same-machine relaunch).

### Test 6a — Astronomy columns render a disclosed placeholder, not a fabricated value (expected state on `main` today)
Steps:
1. On the Targets table, hover/inspect the Max altitude, sparkline,
   Opposition, Lunar separation, Filters, and Image time columns.
2. Open a target's detail page and look at the altitude graph.
Expected (per the Journey facts above — no ObserverSite can exist on `main`
yet):
- Every one of these shows a "set up your observing site" prompt or an
  explicit approximate/placeholder disclosure — **never** a concrete-looking
  fabricated number with no disclosure. The Sessions column renders a dash.
FAIL if:
- Any column renders a concrete-looking value with NO disclosure — this is
  a constitutional-level failure (a stub must never be mistaken for real
  data) regardless of whether the underlying value happens to be
  placeholder or real.

### Test 6b — A working site-creation path exists (Settings and/or first-run wizard)
Steps:
1. Reset to fresh first-run (see Windows environment mechanics) and check
   whether the setup wizard has a "Site" step (name/lat/lon/timezone).
2. Separately, go to Settings → Target Planner → Observing Sites and add a
   site there.
Expected:
- BOTH paths work: completing the wizard's Site step OR adding a site in
  Settings persists a real, active `ObserverSite` and the planner starts
  rendering real astronomy immediately (no relaunch needed).
FAIL if:
- Neither path actually persists a site (i.e. `readSiteExists()`/the planner
  never flips to real astronomy) — that would mean a real regression in the
  already-merged site-gate fix (PR #450) or site CRUD (spec 044 US3).

### Test 6c — Real astronomy renders once a site exists
Steps:
1. Create a default observing site via either path in Test 6b.
2. Re-open Targets and a target's detail page.
Expected:
- Max altitude, sparkline, Opposition, Lunar separation, Filters, and Image
  time now compute from the real per-site ephemeris (spec 044 Track B +
  047 Track A) — genuine numbers that change when you switch the active site
  or the usable-altitude threshold, not a placeholder pattern.
FAIL if:
- Values look like the old hash-derived placeholder pattern (stable across
  reloads but not reacting to a changed site/threshold) — that would be a
  real regression, not expected behavior.

### Test 7 — Track B: date picker, best-imaging date, Moon separation, moon-free hours, dark-window disclosure, altitude graph (spec 044 Track B, requires Test 6b's site to exist)
Steps:
1. In the Targets top bar, find the date field (label "Plan for") next to
   the Moon summary widget. Note today's Max altitude / Visible / Image time
   values for one target row.
2. Change the date to ~6 months from today. Observe the same target's Max
   altitude / Visible / Image time.
3. Click "Tonight" (appears once you've changed the date) to reset.
4. Open a target's detail page. In the Tonight panel, find a "Best date"
   stat row alongside Max alt / Img time / Lunar dist.
5. In the same detail page, open the Filters guidance popover (hover/click
   the filter pills). Look for a per-band "Xh moon-free" figure next to each
   band's required-separation figure (e.g. next to "Ha: needs ≥ 60°").
6. Look at the Tonight altitude graph. Note the shaded band (usable-altitude
   region, should hug the curve where it's above the dashed guide line, not
   a static full-width band) and — if the current site/date has any evening/
   morning twilight before/after full darkness — a faint muted shading at
   the very start/end of the graph.
7. If your site/date has a genuine no-dark-window night (try a far-north
   site like 65-70°N latitude in June/July), check that the Visible column
   shows an explicit "No dark window" state (not "peaks below threshold"),
   and the detail page shows an info banner saying so above the (still-real)
   altitude curve.
Expected:
- Step 2: the values change to genuinely different numbers for the new date
  (not the same as tonight's).
- Step 3: values return to matching today's from step 1.
- Step 4: a real date + "in N days"/"in N months" appears, in the same
  format as the Targets table's existing "Opposition" column (this is
  intentional — they're the same underlying anti-solar-transit
  calculation for a fixed deep-sky target, just surfaced in two different
  places; NOT a bug if they show the same date for the same target).
- Step 5: every band shows a distinct, plausible hour figure (0 to roughly
  the target's total imaging hours for the night); a narrowband figure
  (Ha/SII/OIII) should generally be ≥ a broadband one (L/R/G/B) for the same
  target/night (narrowband tolerates the Moon much more closely).
- Step 6: the green/ok shading only covers the portion of the curve that is
  actually above the dashed usable-altitude line — it should visibly follow
  the curve's shape, not just be a fixed horizontal band.
- Step 7: "No dark window" (or equivalent wording), never a silent/generic
  "not visible", and never a fabricated dark window.
FAIL if:
- Changing the date doesn't change any values (date picker not wired).
- The per-band moon-free figures are all identical/zero regardless of band
  or clearly implausible (e.g. exceeding the total imaging time for the
  night).
- The usable-altitude shading is a static band unrelated to the curve.
- A genuinely no-dark-window night shows a concrete (fabricated) imaging
  time or "peaks below threshold" instead of an explicit no-dark-window
  disclosure.

## Troubleshooting
- Blank window: restart the dev server; if still blank, `pnpm install` with
  `$env:CI="true"`, relaunch.
- If you see real astronomy values on `main` WITHOUT doing anything special
  in Test 6c's precondition — that itself is a finding (means the site gate
  changed) — do not assume your test setup is wrong; report it.

## Report back
Per Test: PASS / FAIL + one line of what you saw. Explicitly call out in your
report whether the no-site (Test 6a) and site-created (Test 6b/6c/7) paths
both behaved as documented — that both states are reachable, and each renders
what it should.

## E2E-sync (coverage bookkeeping — not for the Windows agent)

- **Everything in this journey** — `automatable` in principle. The site-gate
  blocker described in earlier revisions of this doc is resolved (PR #450 +
  spec 044 US3), so a Layer-2/Playwright-mock journey covering Test 6b/6c/7
  is no longer blocked on backend state the way it once was; it remains
  unimplemented as of this revision (this document is still the only
  verification lane for Test 7's specific behaviors — date picker,
  best-imaging date, per-band moon-free hours, dark-window disclosure, the
  visx altitude graph).
- The stub-disclosure requirement (Test 6a) remains safety-critical:
  assert that every astronomy column and the altitude graph carry a
  disclosure affordance in the no-site state, regardless of what real
  astronomy Test 6b/6c/7 can show once a site exists.
