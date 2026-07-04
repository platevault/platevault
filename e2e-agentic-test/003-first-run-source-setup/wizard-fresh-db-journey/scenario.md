# First-run wizard end-to-end — fresh-DB journey

> Two-stage verification plan. Runner mechanics (launch, reset, bridge,
> VITE_E2E inputs, capture tools): see `e2e-agentic-test/AGENT-RUNNER.md`.
> Stage 1 must fully PASS before Stage 2 runs.

## Coverage

- Spec: `specs/003-first-run-source-setup/spec.md` — FR-001 (sequential
  page-by-page flow at `/setup`), FR-002/FR-003 (Raw required; cannot advance
  without it), FR-004 (Calibration/Inbox optional), FR-005 (path validation),
  FR-006 (duplicate detection), FR-007 (no file mutation during setup),
  FR-009 (Raw/Calibration/Project/Inbox source steps), FR-012 (explanatory
  copy per step), FR-014 (completion flag on Finish), FR-016 (`/` redirects to
  `/setup` until completed), FR-017 (per-row scan-depth override).
- Spec: `specs/038-wizard-scan-step/` — the trailing Scan step (per-source
  scan progress, Finish gated on scan completion).
- Ground truth: the shipped wizard is **5 steps** — Source Folders →
  Processing Tools → Configuration → Confirm → Scan — with all four source
  kinds as cards on ONE page (step 1). The spec's aspirational 8-step flow has
  NOT shipped. Stepper text: "Setup · Step 1 of 5".
- Backend commands exercised: `roots_register` (batched on Confirm→Scan),
  `inbox_scan_folder` (per source, Scan step), `tools_update` +
  `firstrun_complete` (Finish), `roots_list` (post-setup verification).

## Preconditions and fixtures

- Branch: `redesign-ui-platevault` tip (no unmerged PR required).
- Real backend only: `.env` has `VITE_USE_MOCKS=false`. Mock mode is
  **forbidden** — in mock mode the wizard bypasses required-kind gating
  (`canProceed` returns true unconditionally), which would mask FR-003.
- Launch with `VITE_E2E=1` and the bridge overlay (see AGENT-RUNNER).
- Fresh first-run state: kill app, delete `wizard-test.db*`, clear
  `alm-setup-wizard-state` from localStorage after relaunch if present.
- Fixture folders (PowerShell, before launch):

  ```
  New-Item -ItemType Directory -Force -Path 'C:\dev\astro-plan\test-data\raw-lights'
  New-Item -ItemType Directory -Force -Path 'C:\dev\astro-plan\test-data\calib'
  New-Item -ItemType Directory -Force -Path 'C:\dev\astro-plan\test-data\projects'
  New-Item -ItemType Directory -Force -Path 'C:\dev\astro-plan\test-data\inbox-drop'
  ```

  Empty folders are valid sources (registration does not require FITS files);
  the Scan step then reports zero/empty groups, which is an accepted outcome.
- Window sized to 1100×720 before the first screenshot.

## Stage 1 — Agent validation via Tauri MCP

Start `ipc_monitor` (capture on) before step 1 and keep it on for the whole
stage.

1. **Fresh-DB redirect (FR-016).** With the fresh DB, load the app.
   **Expected:** the app lands on `/setup` (assert
   `window.location.pathname === '/setup'` via `webview_execute_js`); the
   stepper label reads exactly "Setup · Step 1 of 5"; heading "Where does your
   data live?"; intro copy "Add the folders where your data lives. At least
   one folder is required for each required type below; raw files are never
   moved or copied." is present (FR-007/FR-012 copy). [SCREENSHOT wizard-step1]
2. **Required-kind gating (FR-002/FR-003).** Without adding any folder, locate
   the footer's primary button ("Continue to processing tools →").
   **Expected:** button is disabled (`disabled` attribute present). The
   `data-testid="requirement-status-light_frames"` element indicates the
   required/missing state, and `requirement-status-calibration` /
   `requirement-status-inbox` show "optional" (FR-004).
3. **Add Raw source via E2E input.** Using the two-call convention from
   AGENT-RUNNER, set `e2e-path-input-light_frames` to
   `C:\dev\astro-plan\test-data\raw-lights` and click
   `e2e-add-path-btn-light_frames`.
   **Expected:** a row listing the path appears inside
   `data-testid="source-group-light_frames"`; footer shows "1 folder selected";
   the Continue button becomes enabled. **No IPC command fires yet** — assert
   via `ipc_get_captured` that no `roots_register` call has occurred
   (registration is deferred to Confirm→Scan; FR-015 working buffer).
4. **Duplicate detection (FR-006).** Add the SAME path again under
   `light_frames`.
   **Expected:** inline error "This directory is already added"; no second row.
   Then add the same path under `calibration` via `e2e-path-input-calibration`.
   **Expected:** inline error "This directory is registered under
   light_frames" (cross-kind conflict); no row added. [SCREENSHOT wizard-dup-errors]
5. **Invalid path validation (FR-005).** Set `e2e-path-input-calibration` to
   `C:\does-not-exist-e2e` and add.
   **Expected:** the row appears with an inline validation error message
   attached (client-side validation marks it invalid); remove it via the row's
   remove control before continuing, and confirm the error clears.
6. **Fill remaining kinds + scan-depth override (FR-017, FR-009).** Add
   `test-data\calib` under `calibration`, `test-data\projects` under
   `project`, `test-data\inbox-drop` under `inbox`. On the raw-lights row,
   open the row's advanced expander and change the scan-depth control
   (`aria-label` "Scan depth") to a non-default value.
   **Expected:** four rows across the four cards; footer "4 folders selected";
   scan-depth select holds the chosen value.
7. **Advance through Tools and Configuration (FR-001).** Click "Continue to
   processing tools →".
   **Expected:** stepper "Setup · Step 2 of 5", heading "Processing tools",
   tool cards present (`data-testid="tool-card-pixinsight"` at minimum). Leave
   defaults. Continue.
   **Expected:** "Setup · Step 3 of 5", heading "Configuration". Leave
   defaults. Continue.
   **Expected:** "Setup · Step 4 of 5", heading "Ready to go", and the Confirm
   step summarises all four sources with their kinds. [SCREENSHOT wizard-confirm]
8. **Back navigation preserves the buffer.** Click "← Back" twice, then
   forward again to Confirm.
   **Expected:** all four source rows still present when passing step 1 —
   nothing lost (FR-015).
9. **Register + Scan (FR-014 first half).** On Confirm, click "Start scan →".
   **Expected (IPC):** captured traffic contains one `roots_register` call per
   source (4 total) with the exact paths and categories
   (`light_frames`→raw etc. per backend mapping), followed by
   `inbox_scan_folder` calls carrying each returned `rootId` and
   `rootAbsolutePath`. UI advances to "Setup · Step 5 of 5", heading
   "Scanning your library", `data-testid="step-scan"` present with one
   `scan-source-<path>` row per source.
10. **Scan completes; Finish gate.** Wait (`webview_wait_for`) until
    `data-testid="scan-summary"` appears.
    **Expected:** every source row reaches a done/error terminal state (empty
    folders: done with 0 items is valid); `data-testid="finish-button"` is
    disabled while scanning and enabled once all sources are terminal.
    [SCREENSHOT wizard-scan-done]
11. **Finish (FR-014).** Click `finish-button`.
    **Expected (IPC):** `tools_update` (×2: pixinsight, siril) then
    `firstrun_complete` succeed (no error response). App navigates to
    `/inbox`. localStorage `alm-setup-wizard-state` is removed (assert via
    `webview_execute_js`).
12. **Completion flag sticks (FR-016 inverse).** Navigate to `/` via
    `webview_execute_js` history push or app nav.
    **Expected:** NO redirect back to `/setup`; a main page renders.
13. **Sources actually registered.** Invoke `roots_list` via the bridge.
    **Expected:** 4 roots with the fixture paths, grouped under categories
    raw/calibration/project/inbox. Cross-check Settings → Data Sources renders
    the same four cards. [SCREENSHOT datasources-after-setup]
14. **No file mutation (FR-007).** From WSL, list
    `/mnt/c/dev/astro-plan/test-data/` recursively.
    **Expected:** the four fixture folders are unchanged and still empty — no
    files created, moved, or copied inside user folders. (App-owned DB/log
    files outside these folders are fine.)
15. **Log check.** `read_logs`: no ERROR-level backend entries during the
    journey; registration and scan lines present.

### Stage 1 verdict

- **PASS**: every numbered step's Expected holds; all IPC assertions matched;
  no ERROR logs; screenshots captured.
- **FAIL**: any Expected missed. Specifically fatal: Continue enabled with no
  raw source (FR-003 broken), `roots_register` firing before Confirm,
  navigation to `/inbox` without `firstrun_complete` success, redirect loop
  after Finish, or any file appearing inside the fixture folders.

## Stage 2 — Final Claude Desktop pass

Run only after Stage 1 passes, on the same build. Human judgment:

1. **Native picker journey (FR-008).** Repeat a fresh-DB setup WITHOUT the
   E2E inputs: click each card's "Add folder" button and use the real OS
   directory picker. Confirm the picker opens as a native Windows dialog,
   selecting a folder adds the row, and cancelling the picker is a graceful
   no-op (no error toast, no phantom row). Confirm the picker re-opens in the
   last-chosen directory (spec 004 FR-014).
2. **Copy and i18n.** Read every step's heading, description, button, and
   error string: all real English copy — no raw Paraglide keys (e.g.
   `setup_step_sources_heading`), no `{placeholder}` leakage, no truncated
   plural ("1 folder selected" vs "2 folders selected").
3. **Layout at 1100×720.** On each of the 5 steps: stepper and footer
   (Back/Continue) are ALWAYS visible without scrolling; only the step body
   scrolls. No overlapped cards, no clipped buttons. Repeat the step-1 and
   Confirm screenshots in a second theme (Settings → Appearance) and confirm
   contrast/readability holds in both.
4. **Flow feel.** Progressing, going back, and finishing feel immediate
   (<1s transitions); the Scan step's progress states are understandable; the
   "Start scan →" and "Finish" moments clearly communicate what is happening.
5. **Sign-off.** Record PASS/FAIL per item with screenshots; overall PASS
   requires all items PASS. Any FAIL returns the scenario to the implementers
   with the screenshot and the exact observed copy/layout.
