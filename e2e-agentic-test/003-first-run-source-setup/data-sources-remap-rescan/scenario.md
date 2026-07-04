# Data Sources — Remap and Rescan (P6a)

> Two-stage verification plan. Runner mechanics: see
> `e2e-agentic-test/AGENT-RUNNER.md`. Stage 1 must fully PASS before Stage 2.

## Coverage

- Constitution I (library roots modeled separately from relative paths so
  moved drives can be remapped without rewriting history) and II (remap is a
  preview→apply flow — nothing mutates on Verify).
- Surfaces: Settings → Data Sources root cards ("Rescan", "Remap…" buttons),
  `RemapRootDialog` (`data-testid="remap-root-dialog"`).
- Backend commands:
  - `inbox_scan_folder` — the REAL scan behind "Rescan" (the former
    `scan.start` wrapper was a dead stub; the button must NOT call it).
  - `roots_remap` — preview: samples relative paths from the current root and
    reports found/not-found under the new path. Mutates nothing.
  - `roots_remap_apply` — applies with `{ rootId, newPath, verified }` where
    `verified` = the preview's `allVerified`.

## Preconditions and fixtures

- Branch: `redesign-ui-platevault` tip (P6a is merged; no PR gate).
- Setup completed; at least one raw root registered (reuse
  `003 wizard-fresh-db-journey` end state, raw root
  `C:\dev\astro-plan\test-data\raw-lights`).
- Fixture recipe (PowerShell) — give the root real content so remap sampling
  and rescan have something to verify:

  ```
  Set-Content 'C:\dev\astro-plan\test-data\raw-lights\L_001.fits' 'stub'
  Set-Content 'C:\dev\astro-plan\test-data\raw-lights\L_002.fits' 'stub'
  # a "moved drive" copy for the remap-success case:
  Copy-Item 'C:\dev\astro-plan\test-data\raw-lights' 'C:\dev\astro-plan\test-data\raw-lights-moved' -Recurse
  # an incomplete copy for the not-all-verified case:
  New-Item -ItemType Directory -Force 'C:\dev\astro-plan\test-data\raw-lights-partial'
  Copy-Item 'C:\dev\astro-plan\test-data\raw-lights\L_001.fits' 'C:\dev\astro-plan\test-data\raw-lights-partial\'
  ```

  (Stub .fits files are fine: rescan records source groups; header parsing
  failures, if any, must be non-fatal.)
- Real backend; bridge overlay; VITE_E2E as needed for typing paths; window
  1100×720. Start `ipc_monitor` before Stage 1.

## Stage 1 — Agent validation via Tauri MCP

### Rescan

1. **Rescan calls the real scan command.** On the raw root's card click
   "Rescan".
   **Expected (IPC):** exactly one `inbox_scan_folder` call with
   `{ rootId: <root id>, rootAbsolutePath: 'C:\dev\astro-plan\test-data\raw-lights', followSymlinks: false }`.
   **No `scan_start` call is captured** (dead-stub regression guard). While
   in-flight the button reads "Rescanning…" and is disabled; afterwards the
   card reloads (a `roots_list` call follows).
2. **Rescan updates lastScanned.** After completion, read the card meta line.
   **Expected:** it shows "scanned <date>" with a fresh timestamp (derived
   from `inbox_source_groups`), and a file count once files exist.
   Cross-check via read-only DB query (AGENT-RUNNER) that
   `inbox_source_groups` rows exist for the root. [SCREENSHOT rescan-done]
3. **Symlink guard (constitution).** Assert from the captured payload that
   `followSymlinks` was `false` (scans must not follow symlinks unless
   explicitly enabled).

### Remap — happy path

4. **Open the dialog.** Click "Remap…" on the raw root card.
   **Expected:** modal `remap-root-dialog` opens, title "Remap root",
   subtitle = current path; "Current path" row shows
   `C:\dev\astro-plan\test-data\raw-lights`; "Apply remap" is DISABLED (no
   preview yet); "Verify" is disabled while the new path is empty/unchanged.
5. **Verify previews without mutating.** Enter new path
   `C:\dev\astro-plan\test-data\raw-lights-moved` (DirPicker; type via its
   input if VITE_E2E exposes one, else pick natively/defer picker to Stage 2)
   and click "Verify".
   **Expected (IPC):** one `roots_remap` call with the rootId and new path;
   NO `roots_remap_apply` yet. UI shows banner "All sample files were found at
   the new path." and a sample list where every row has a "Found" pill.
   "Apply remap" becomes enabled. Invoke `roots_list`: the root's path is
   STILL the old path (preview mutated nothing — constitution II).
   [SCREENSHOT remap-verified]
6. **Editing the path invalidates the preview.** Change one character of the
   new path.
   **Expected:** the verification banner/samples disappear and "Apply remap"
   disables again (stale preview can never be applied). Restore the correct
   path and Verify again.
7. **Apply.** Click "Apply remap".
   **Expected (IPC):** `roots_remap_apply` with
   `{ rootId, newPath: '...raw-lights-moved', verified: true }`, success
   response; dialog closes; the card now shows the NEW path. `roots_list`
   confirms the persisted path changed. History intact: re-run a Rescan on the
   remapped root and expect it to succeed against the new path.

### Remap — warn path and error path

8. **Not-all-verified warning.** Remap the root again, to
   `...\raw-lights-partial`, click "Verify".
   **Expected:** warn-variant banner "Some sample files were not found at the
   new path. Review the samples below before applying." with at least one
   "Not found" pill (L_002). "Apply remap" is still ENABLED (user may accept a
   partial move) but the request must carry `verified: false` if applied.
   Click Cancel instead — **Expected:** dialog closes, `roots_list` still
   shows `raw-lights-moved`, no `roots_remap_apply` captured.
   [SCREENSHOT remap-partial-warn]
9. **Backend failure surfaces inline.** Open Remap once more, enter a
   syntactically valid but nonexistent path `C:\no-such-dir-e2e`, Verify.
   **Expected:** either a danger banner "Remap failed: <error>" (typed
   ContractError surfaced, dialog stays open, retry possible) or a
   sample list with all "Not found" — record which contract the backend
   implements; a silent close or an unhandled promise rejection in logs is a
   FAIL.
10. **Log check.** `read_logs`: scan and remap operations logged; no
    ERROR-level entries except the deliberate step-9 failure (which must be a
    handled error, not a panic/stack trace).

### Stage 1 verdict

- **PASS**: rescan uses `inbox_scan_folder` (never `scan_start`);
  preview/apply are strictly separated (no mutation before Apply; stale
  preview unappliable); applied remap persists and rescan works post-remap;
  warn + error paths render as specified.
- **FAIL**: any `scan_start` traffic; `roots_remap` mutating the stored path;
  Apply enabled without a fresh matching preview; silent dialog close on
  error; lastScanned never updating.

## Stage 2 — Final Claude Desktop pass

1. **Dialog UX.** Run the happy-path remap once via the native picker. The
   preview table communicates clearly what was checked (relative sample paths,
   Found/Not found pills); the difference between Verify and Apply is
   understandable without reading docs; Cancel always feels safe.
2. **Copy/i18n.** All dialog and card strings are real English (Remap root /
   Current path / New path / Verify / Apply remap / Rescan / Rescanning… /
   scanned <date>); no raw keys, no `{error}`/`{date}` placeholder leakage.
3. **Layout + themes.** At 1100×720 the modal fits without clipping its
   footer buttons; the Data Sources pane header and settings nav stay fixed
   while cards scroll. Repeat [SCREENSHOT remap-verified] in a second theme;
   banner variants (info/warn/danger) remain distinguishable in both.
4. **Trust review.** Judge the flow against constitution II: at no point does
   it look like the app moved/copied files (remap is registration-only) — the
   copy must not imply file movement.
5. **Sign-off.** PASS requires all items PASS; leave the root remapped to
   `raw-lights-moved` documented in the report, or remap back to the original
   path as cleanup.
