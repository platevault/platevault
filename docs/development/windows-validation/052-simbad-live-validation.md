# Windows validation — spec 052 SIMBAD resolver: persistent cache, persistence-gating, broad search, cone-search suggestions

> For: Claude computer-use ("cowork") on the Windows machine running PlateVault.
> You have NO access to the source repo. Everything you need is in this document.
> Report each Test as PASS / FAIL with what you observed.

## Change facts (context — you do not act on this section)

- Spec / feature: 052 SIMBAD resolver caching + dual-lookup + cone-search (T035)
- Branch to test: `main` (all merged: PRs #684, #687, #689, #691)
- Touches Rust backend? **yes** · Frontend only? no
- New/changed Tauri commands: `target.resolve` (typeahead), `target.resolve_explicit`
  (deliberate NED/VizieR broad search), `target.cache.clear`,
  `target.cone_search.suggest`, `target.cone_search.confirm`
- Changed surfaces: the target search box (in the Targets page "Add target"
  dialog and the Create Project dialog), Settings → ONLINE RESOLUTION section,
  Inbox light-group detail → "Suggested target" section
- What changed for the user: typing a target name looks it up live in SIMBAD but
  **never** saves anything until the target is deliberately used (added,
  favourited, put in a project, or confirmed in the Inbox). Lookups are cached in
  a persistent local cache file that survives restarts and can be cleared from
  Settings. When SIMBAD has no match, an explicit "Search more catalogues
  (NED/VizieR)" action (also triggered by Enter) searches further. Inbox light
  groups now get coordinate-driven target suggestions with confidence labels and
  an explicit Confirm.

## Preconditions — get the app to the right state

1. Deploy `main` on the Windows checkout `C:\dev\astro-plan`:
   - `git fetch origin`
   - `git reset --hard origin/main`   (run as its OWN command)
   - **Force rebuild (mtime trap)** — `git reset --hard` restores content with an
     old mtime so cargo skips recompiling and the app stays stale. Touch the
     changed Rust files:
     ```powershell
     Get-ChildItem 'C:\dev\astro-plan\apps\desktop\src-tauri\src\main.rs','C:\dev\astro-plan\apps\desktop\src-tauri\src\commands\target_lookup.rs','C:\dev\astro-plan\crates\targeting\resolver\src\simbad.rs' | ForEach-Object { $_.LastWriteTime = Get-Date }
     ```
2. Reset to a clean first-run (DB is the first-run source of truth):
   ```powershell
   Remove-Item 'C:\dev\astro-plan\wizard-test.db*' -Force
   Remove-Item "$env:APPDATA\dev.astro-plan.astro-library-manager\simbad-cache.redb" -Force -ErrorAction SilentlyContinue
   ```
   The second file is the new persistent resolve cache — it lives in AppData and
   is NOT removed by deleting the dev DB.
3. Launch:
   ```powershell
   powershell.exe -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','C:\dev\astro-plan\run-dev.bat' -WorkingDirectory 'C:\dev\astro-plan'"
   ```
   Wait for the window; app process is `desktop_shell.exe`, Vite on `localhost:5173`.
   The first Rust build after the touch takes several minutes — wait for the window.
4. Complete the first-run wizard: accept defaults; when asked for a library
   folder, create and choose `C:\Temp\pv-lib`; leave the "Online SIMBAD
   resolution" toggle **ON**.
5. Sanity: the app renders (not a blank window). If blank → see Troubleshooting.
6. Internet must be reachable (SIMBAD queries go to the network).

## Tests

### Test 1 — typing never saves a target (persistence gating, SC-002)
Steps:
1. Open the **Targets** page from the left navigation. Note it lists no targets
   (fresh DB). If it shows any rows, record them as the baseline.
2. Click **Add target**. In the dialog's search box ("Search for a target"),
   type `M 31`. Wait ~1 second.
3. Observe the suggestion list (a "Searching SIMBAD…" status may flash first).
4. Without clicking any suggestion, clear the box and type `NGC 7000`; wait for
   suggestions; then type `Veil Nebula`; wait for suggestions.
5. Close the dialog WITHOUT selecting or adding anything (Esc or Cancel).
6. Look at the Targets page list.
Expected:
- Each query produced live suggestions (e.g. "M 31 (Andromeda Galaxy)").
- After closing, the Targets list is **unchanged from step 1** — browsing/typing
  saved nothing.
FAIL if:
- Any of the searched objects (M 31, NGC 7000, Veil) now appears as a Targets
  row without having been added, or suggestions never appear (spinner forever /
  error toast).

### Test 2 — deliberate add persists the target WITH magnitude + constellation
Steps:
1. On the Targets page, click **Add target**, type `M 31`, click the M 31 /
   Andromeda Galaxy suggestion, and confirm the dialog's add action.
2. The Targets list should now show the target. Open its detail view (click the
   row).
3. Find the properties (fields labelled **Magnitude** and **Constellation**).
Expected:
- Exactly one new target exists (M 31 / Andromeda Galaxy).
- Its detail shows a numeric **Magnitude** (≈ 3.4) and **Constellation**
  "Andromeda" — both filled in automatically, not blank.
FAIL if:
- The add fails ("Failed to add target"), or Magnitude/Constellation are empty
  (an em-dash / blank) on a freshly added M 31.

### Test 3 — resolve cache is persistent across an app restart
Steps:
1. Open **Add target** and type `UGC 12158` (a long-tail galaxy that is NOT in
   the bundled seed). Wait for a suggestion to appear (this proves a live SIMBAD
   fetch). Close the dialog without adding.
2. Quit the app: `Get-Process desktop_shell,cargo | Stop-Process -Force`, then
   relaunch via the same `run-dev.bat` command as in Preconditions (no DB reset).
3. Go to **Settings** and find the **ONLINE RESOLUTION** section. Turn the
   toggle "Online SIMBAD resolution" **OFF**.
4. Open the Targets page → **Add target**, type `UGC 12158`.
5. Then clear the box and type `UGC 12588` (never searched before).
Expected:
- Step 4: `UGC 12158` still appears as a suggestion **while offline** — it was
  served from the persistent local cache that survived the restart.
- Step 5: `UGC 12588` yields no match — the list shows the hint
  "No matches in SIMBAD —" with a "Search more catalogues (NED/VizieR)" button
  (do not click it in this test).
FAIL if:
- `UGC 12158` no longer resolves after the restart (cache not persistent), or
  `UGC 12588` resolves while online resolution is OFF (the offline gate leaks).

### Test 4 — Clear resolve cache re-warms from the seed
Steps:
1. Still with "Online SIMBAD resolution" OFF, go to **Settings → ONLINE
   RESOLUTION** and click **Clear resolve cache**.
2. Wait for the status message.
3. Open **Add target** and type `UGC 12158`; then clear and type `M 42`.
Expected:
- Step 2: a success message "Resolve cache cleared and re-warmed with {count}
  entries." with a count greater than zero. The M 31 target added in Test 2 is
  still on the Targets page (clearing the cache never deletes saved targets).
- Step 3: `UGC 12158` no longer appears (its cached entry was wiped and the app
  is offline), but `M 42` (Orion Nebula) still resolves — it comes from the
  re-warmed bundled seed.
FAIL if:
- An error message ("Could not clear the resolve cache…"), a zero count, the
  M 31 target disappearing, or `M 42` failing to resolve offline.

### Test 5 — explicit "Search more catalogues" (NED/VizieR) + keyboard accelerator
Steps:
1. In **Settings → ONLINE RESOLUTION**, turn "Online SIMBAD resolution" back
   **ON**.
2. Open **Add target** and type a query SIMBAD won't match, e.g. `zzqx object 9`.
   Wait for the typeahead to finish.
3. Observe the empty-result state. Do NOT click — press **Enter**.
4. Watch what happens while the broader search runs, and what it ends with.
Expected:
- Step 3: an inline line "No matches in SIMBAD —" followed by a
  "Search more catalogues (NED/VizieR)" button (framed as a next step, not an
  error).
- Step 3→4: pressing **Enter** activates that button (it is the only actionable
  thing). A "Searching more catalogues…" status appears while the search runs.
- Step 4: it finishes with either results or the text "Still no matching
  targets." — a calm outcome either way, no error toast. (For a nonsense query,
  "Still no matching targets." is the likely correct outcome.)
- The broader search does NOT fire on its own while typing — only after
  Enter/click.
FAIL if:
- No "No matches in SIMBAD —" affordance appears, Enter does nothing, no
  "Searching more catalogues…" state shows, the search auto-fires per keystroke,
  or it ends in an error toast / crash.

### Test 6 — Inbox cone-search suggestion (plate-solved → High confidence, confirm persists)
Steps:
1. Open the **Inbox** page. Add an inbox source folder that contains real light
   frames: pick a folder under `D:\astrophotography` whose FITS files are
   plate-solved (WBPP/processed outputs usually are; raw camera lights usually
   are not). Let the scan finish.
2. Open a **light** group's detail view.
3. Find the **"Suggested target"** section (it runs automatically). Note each
   suggestion row: name, a confidence pill ("High confidence" / "Medium
   confidence" / "Low confidence"), optionally "Excluded by default", a
   "…° from centre" distance, and a **Confirm** button.
4. If the section instead says "No reliable sky position is available for this
   light group.", the folder's files carry no usable coordinates — try a
   different folder (step 1) and note which folders you tried.
5. Click **Confirm** on the top suggestion.
6. Open the **Targets** page.
Expected:
- Suggestions appear with explicit confidence pills. For plate-solved files the
  top suggestion is "High confidence" and its Confirm button is visually
  primary (pre-selected); for mount-coordinates-only files the best is "Medium
  confidence" and nothing is pre-selected as high.
- Nothing is ever applied without the click: before step 5 the group has no
  confirmed target.
- Step 5: a banner "Confirmed as this light group's target. (<designation>)".
- Step 6: the confirmed target now exists on the Targets page (confirm = in-use
  = persisted).
FAIL if:
- No "Suggested target" section on a light group, an error banner instead of
  suggestions, a target linked without clicking Confirm, Confirm errors, or the
  confirmed target does not appear on the Targets page.

### Test 7 — Inbox suggestions offline degrade gracefully
Steps:
1. In **Settings → ONLINE RESOLUTION**, turn "Online SIMBAD resolution" **OFF**.
2. Back in the Inbox, open another light group's detail (or the same one and
   press **Re-check** in the "Suggested target" section header).
Expected:
- An informational note "Target suggestions are unavailable offline." — no
  spinner that never resolves, no error banner.
FAIL if:
- An error banner, endless loading, or suggestions that silently fire a network
  call while resolution is off.
Cleanup: turn "Online SIMBAD resolution" back ON.

## Troubleshooting
- Blank window (empty content): restart the dev server; if still blank, run
  `pnpm install` in `C:\dev\astro-plan` with `$env:CI="true"`, relaunch.
- A command "not found" / stale behavior: the binary is stale — confirm you
  touched the `.rs` files after reset so cargo rebuilt (Preconditions step 1),
  then relaunch.
- The first-run wizard reappears unexpectedly: the dev DB was removed —
  complete it again (Preconditions step 4).

## Report back
For each Test: PASS / FAIL + one line of what you saw. On any FAIL, capture a
screenshot and the exact on-screen text / any toast. For Test 6 also report
which `D:\astrophotography` folder you used and whether its files were
plate-solved (High) or mount-only (Medium).

---

## E2E-sync (for the repo maintainer — not part of the Windows run)

- **Typeahead persistence-gating (Test 1/2)** — automatable; already covered at
  Layer 1 (`crates/app/core/tests/resolution_e2e.rs`,
  `simbad_resolution_integration.rs`, FakeResolver) and by the existing Layer-2
  journey `first_run_resolve_create_project` (offline seed hit). No new journey.
- **Cache clear (Test 4)** — automatable offline: add a
  `resolver_cache_clear` journey to
  `crates/e2e-tests/tests/settings_journeys.rs` asserting the success banner +
  re-warm count > 0 via `target.cache.clear`.
- **Broad search NED/VizieR (Test 5)** — real-network path: **manual only**
  (CI must not depend on CDS/NED availability); the UX affordance itself is
  covered by vitest (`TargetSearch.test.tsx`).
- **Cone-search suggest/confirm (Test 6)** — suggest needs live SIMBAD:
  **manual only** for the network path; confirm/persistence is Layer-1-covered
  (P3 integration tests). Offline banner (Test 7) is automatable if a journey is
  ever added.

---

# Live-run results — 2026-07-14 (Tauri MCP bridge, headless)

Executed against `main` @ `1efdc0c5` on the Windows dev app (fresh `wizard-test.db`,
fresh resolve cache, real SIMBAD network), driven from WSL via the Tauri MCP
bridge instead of a human/vision agent. Deviations from the script: first-run
wizard folders set via the `VITE_E2E` path inputs; the two Test-6 inbox roots
were registered via `roots_register_batch` backend IPC (the Data Sources "+ Add
source folder" opens a native picker the bridge cannot drive); Test-6 WCS data
= real M 51 lights with injected `CRVAL/CTYPE/CD/CROTA2` headers (the library
holds no FITS-keyword plate solves — PixInsight stores solutions as XISF
properties).

| Test | Verdict | Evidence |
|---|---|---|
| 1 — typing never saves (SC-002) | **PASS** | M 31 (`seed`), NGC 7000 / Veil / UGC 12158 (`resolved`) browsed; `canonical_target` count stayed 0 |
| 2 — add persists + enrichment | **PASS** (finding #696) | NGC 2903 → `magnitude=9.07, constellation='Leo'` in DB + detail UI; M 31 seed-add → `magnitude=NULL` (seed asset has no `v_mag`) |
| 3 — cache survives restart | **PASS** (finding #694) | after restart + online OFF: UGC 12158 still resolves (cache), UGC 12588 doesn't; offline no-match shows no feedback at all |
| 4 — clear resolve cache | **PASS** (finding #695) | "Resolve cache cleared and re-warmed with 13076 entries." (13,073 seed + 3 durable) — but ~12 min synchronous "Clearing…"; post-clear: UGC 12158 gone, M 42 seed hit, saved targets untouched |
| 5 — broad search + Enter | **PARTIAL** (finding #697) | inline "No matches in SIMBAD — [Search more catalogues (NED/VizieR)]" ✓; click path ✓ ("Searching more catalogues…" → "Still no matching targets."); **Enter clears the query instead of firing the search** (3× repro incl. fresh reload) |
| 6 — cone-search suggestions | **PASS** (findings #698, #699) | WCS group: **"M 51 (Whirlpool)" High confidence, ranked #1, primary/pre-selected Confirm**; confirm → banner + `canonical_target` M 51 (`CVn`, mag 8.36) + per-file `target='M 51'` overrides; `inbox_file_metadata.wcs_ra/dec_deg` exact (202.469575/47.195258, solved files only). Mount group: Medium top as designed, **but M 51 absent from its 8 suggestions** (#698); all rows "0.00° from centre" (#699) |
| 7 — offline suggestions | **PASS** | "Target suggestions are unavailable offline." banner, no error/spinner |

Filed from this run: [#694](https://github.com/nightwatch-astro/alm/issues/694)
offline no-match feedback (user decision), [#695](https://github.com/nightwatch-astro/alm/issues/695)
instant wipe + batched/background re-warm, [#696](https://github.com/nightwatch-astro/alm/issues/696)
regenerate seed with `v_mag`, [#697](https://github.com/nightwatch-astro/alm/issues/697)
Enter accelerator, [#698](https://github.com/nightwatch-astro/alm/issues/698)
top-N truncation drops prominent object, [#699](https://github.com/nightwatch-astro/alm/issues/699)
separation display units.

Not covered live (Layer-1 only): project-create / session-link / favourite
in-use promotion (project creation is a 6-step wizard needing library sessions;
the test library is empty), positive Sesame/NED-VizieR fallback hit (needs an object
in NED/VizieR but not SIMBAD), wcs_rotation_deg value semantics (synthetic CD matrix
was not a valid rotation matrix — re-verify with a genuine plate solve).
