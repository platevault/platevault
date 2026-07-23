# HANDOVER — Windows validation campaign (2026-07-09)

**Read this, then open the tracker and continue from the first non-✅ test.**

## Source of truth (READ FIRST, ALWAYS refer to it)

- **`docs/development/windows-validation-journeys-tracker.md`** — all 10 journeys,
  detailed steps, **live per-test status**, epic + issue links. You MUST update it
  as you go.
- Detailed run log + persistent backlog (B1–B22, evidence, issue IDs):
  `docs/development/windows-validation-run-2026-07-09.md`.
- GitHub epics: **#518–#527** (one per journey; labels `epic` + `journey-N`).
  Attached issues query `label:journey-N`. Update/comment epics as journeys run.

## Workspace & rules

- Worktree: `/home/sjors/tmp/worktrees/astro-plan/campaign-ws0`, branch
  `ws3-mcp-validation-run` (tracks origin/main). **Commit + push after every
  meaningful step. No AI attribution in commits** (`-c commit.gpgsign=false`).
- The primary checkout `~/dev/astro-plan` is shared — do not switch its branch.
- **Read-only on product code** (an orchestrator owns code lanes). Your writes:
  tracker, run log, journey-doc drift fixes, GitHub issues/epics, test fixtures.
- Interactive protocol: this run is human-checkpointed — report + wait after each
  test unless told to batch.

## Current app state (LIVE)

- Windows app is **running** (relaunched, real backend, `VITE_E2E=1`), bridge on
  `localhost:9223`. Setup is **complete** (`firstrun_state=complete`); it boots to
  a main page, not `/setup`.
- **14 OptMatrix roots are registered** (`D:\astrophotography\ALM test\OptMatrix\`,
  the org×depth×category matrix). `roots_list` = 14. Use these for Journey 1
  Tests 5–9 (Data Sources) and downstream.
- Commit under test: **`8097d9c6`** (≡ origin/main for app behaviour).

## What's DONE

- **Journey 1**: T1 (fresh→wizard), T2 (add folder, buffer-only), T3 (Confirm+Scan),
  T4 (Finish→Inbox + relaunch persistence) — all ✅. Wizard **steps 2–5 deep-validated**
  (Tools, Config, Site, Confirm). Full org×depth×category matrix registered.
- **16 issues filed** (see tracker's issue table): #491/#496/#497/#501/#502/#504/#505/
  #506/#509/#510/#511/#512/#513/#514/#515/#516. Bugs: #501 (overlapping roots),
  #504 (theme selector), #509 (scan-depth no-op), #511 (binary picker), #513
  (scan preview).
- **10 epics** #518–#527 + `journey-1..10` labels created; J1/J8 issues attached.
- **Comprehensive detection fixture library** committed:
  `docs/development/fixtures/gen_detection_matrix.py` (+ README, manifest on run).

## Key learnings (don't relearn the hard way)

- Fresh-install reset needs **BOTH** `Remove-Item wizard-test.db*` **AND**
  `localStorage.clear()` (DB wipe alone rehydrates stale wizard buffer/theme — B6).
- Bridge commands are **underscored** (`roots_list`, `roots_register_batch`,
  `firstrun_state`) via `window.__TAURI__.core.invoke(name, args)`.
- Read DOM **in a separate call after** a click (same-tick reads are stale); **one
  mutation per call** (card/select changes race the re-render). Async
  set→await→click→await→read in one IIFE works for inputs/selects.
- Native pickers can't be driven → use `VITE_E2E=1` `data-testid` stand-ins for
  folder adds; the binary picker needs a human (or is untestable via bridge).
- **Detection is header-first**: `organization_state` IS consumed (organized→
  catalogue-in-place, unorganized→move); `scan_depth` `single` is a **no-op**
  (#509). Master/type detection = IMAGETYP first, path/name master-only fallback.

## FIXES TO RUN (next-agent action list, in priority order)

1. **FIXTURE-LIBRARY RETRY (the master-detection re-verification).** The 2026-07-09
   calibration check used inadequate fixtures — the real `Darks/` are stacked
   masters with **stripped headers** (no `IMAGETYP`), so they were unclassifiable
   and vanished from the scan preview (looked like a bug; was a fixture problem →
   #513). Re-verify properly:
   - `python3 docs/development/fixtures/gen_detection_matrix.py "/mnt/d/astrophotography/ALM test/DetectionMatrix"`
     (~93 realistic fixtures + `manifest.json`).
   - Register the roots (`…\DetectionMatrix\Lights`, `…\DetectionMatrix\Calibration`,
     `…\DetectionMatrix\Unsorted`, `…\DetectionMatrix\Conflicts`, `…\Unknown`) and
     scan.
   - Compare the scan/ingest classification against `manifest.json`:
     header-first wins in `Conflicts/*`; path-fallback masters detected; raw
     name-only + unknown-imagetyp stay **unclassified**; multi-sub sessions group.
   - Feed results into **#514** (add the missing unit/integration permutations:
     bias raw, bias-master-STACKCNT, darkflat, path-based, conflict, master lights)
     and re-check **#513** (preview counts must reconcile; masters/unclassified
     surfaced; root row named).
2. **Journey 1 Tests 5–9** — Data Sources card actions on the registered roots:
   Rescan, Remap (Verify→Apply, **no files move**), Disable (reversible), Delete
   (registration-only, blocked with dependents), "Show in File Explorer".
3. **Journeys 2–10** — per the tracker's detailed steps. Verify **#327** in
   Journey 5 (Project-wizard Calibration mock masters). Probe observing-site
   lat/long range validation in Journey 9.
4. **Trivial doc-drift fixes** (your lane): journey-01 doc says "Step 1 of 5" →
   6 steps (B1); reset recipe in the journey docs is incomplete → add
   `localStorage.clear()` (B6).

## Resume mechanics

- Connect: `driver_session action=start host=localhost port=9223`.
- If the app is down: kill `desktop_shell,node,cargo`; relaunch (no DB reset to keep
  state) with the detached `pnpm tauri dev --config src-tauri\tauri.dev.conf.json`
  command (env `VITE_USE_MOCKS=false VITE_E2E=1 ALM_DB_URL=sqlite://C:\dev\astro-plan\wizard-test.db?mode=rwc`);
  poll `/dev/tcp/127.0.0.1/9223`. Full commands in the run log's Environment section.
- For a from-scratch first-run: kill, `Remove-Item wizard-test.db*`, `localStorage.clear()`,
  relaunch.
