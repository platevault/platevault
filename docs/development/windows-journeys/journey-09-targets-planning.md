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
- **CRITICAL, verified against the actual code on 2026-07-05 — read before
  testing**: spec 047 (Moon phase, per-target lunar separation, filter
  guidance, opposition) and spec 044 Track B (real per-site altitude,
  rise/set, imaging time) are both **implemented in code** on `main`
  (`apps/desktop/src/features/targets/planner-altitude.ts`,
  `TargetsTable.tsx`, `astro/moon-state.ts`) — but **every one of those real
  values is gated behind a default "observing site" existing**
  (`apps/desktop/src/features/targets/site-gate.ts`, spec 047 decision D7),
  and `readSiteExists()` is **hardcoded to always return `false`** with a
  `TODO(spec-044)` comment — there is currently **no UI or backend command on
  `main` that can create an ObserverSite at all** (that ships with spec 044
  US3 / PR #440, which is **open, not merged**, as of this writing). This
  means: **on `main` today, the real astronomy your cowork session will
  actually see rendered is NONE of it** — every target row and the target
  detail's astronomy will show the "set up your observing site" prompt /
  the placeholder fallback, no matter how the code looks. Do not be
  surprised if Tests 6a/6b below show placeholders; that is the CORRECT,
  expected, verified-against-code behavior right now, not a bug in your
  test run. Re-run this journey once PR #440 merges to actually exercise the
  real astronomy path (see Test 6c).
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
  `driver_session host=<gateway> port=9223`, invoke via `webview_execute_js` →
  `window.__TAURI__.core.invoke('<snake_command>', {args})`. There is no
  known backend command to fake an ObserverSite for this pre-#440 test —
  don't try to force Test 6c until #440 actually merges.

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

### Test 6b — Confirm the site-setup prompt is the ONLY path shown (regression check)
Steps:
1. Look for any way, in the current UI, to create/configure an observing
   site (wizard step, Settings pane, or a button in the prompt itself).
Expected:
- No functional site-creation UI exists yet on `main` (spec 044 US3 / PR #440
  is still open). If a "set up your site" button exists, clicking it either
  does nothing yet or navigates to an incomplete pane.
FAIL if:
- You find a WORKING site-creation flow that actually flips
  `readSiteExists()` — if so, this is significant news: it means #440 (or
  equivalent) landed since this document was written and the whole
  "gated-off" framing above is stale. Report this explicitly as a finding,
  re-run Test 6c, and flag this document for an update.

### Test 6c — (Only run after PR #440 merges) Real astronomy renders once a site exists
Steps:
1. Create a default observing site via the (now-merged) site-creation UI.
2. Re-open Targets and a target's detail page.
Expected:
- Max altitude, sparkline, Opposition, Lunar separation, Filters, and Image
  time now compute from the real per-site ephemeris (spec 044 Track B +
  047 Track A), still with an "approximate" disclosure where the model has
  known limits, but no longer literal placeholders.
FAIL if:
- Values still look like the old hash-derived placeholder pattern (stable
  across reloads but not reacting to a changed site/date), which would mean
  the site-gate flip point wasn't actually wired despite #440 merging.

## Troubleshooting
- Blank window: restart the dev server; if still blank, `pnpm install` with
  `$env:CI="true"`, relaunch.
- If you see real astronomy values on `main` WITHOUT doing anything special
  in Test 6c's precondition — that itself is a finding (means the site gate
  changed) — do not assume your test setup is wrong; report it.

## Report back
Per Test: PASS / FAIL + one line of what you saw. Explicitly call out in your
report whether Test 6a/6b behaved as documented (gated-off) or whether you
found working real astronomy on `main` without #440 — that would be
important, unexpected news either way.

## E2E-sync (coverage bookkeeping — not for the Windows agent)

- **Everything in this journey** — `automatable` in principle, but **zero
  Layer-2 coverage and zero mock coverage today**, and spec 047's own task
  list explicitly defers verify-on-windows to a separate lane (this
  document). Flagged in the batched new-journey plan as **"Batch: Targets
  catalog + SIMBAD resolve-on-demand + identity"** (testable today,
  independent of the site gate) and separately **"Batch: Real planner
  astronomy end-to-end"** (blocked on PR #440 merging — until then, a
  Layer-2 journey here could only prove the gated-off prompt renders, not
  the real astronomy, which is arguably still useful as a regression guard
  but should be named honestly, e.g. `targets_planner_site_gate_prompt`
  rather than implying real-astronomy coverage it can't yet provide).
- The stub-disclosure requirement (Test 6a) is explicitly called out in the
  product journey doc as safety-critical — this is a good first Layer-2
  candidate since it's independent of the site-gate blocker: assert that
  every one of the six astronomy columns and the altitude graph carry a
  disclosure affordance, regardless of gate state.
