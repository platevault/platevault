# Handover — Spec 040 (Calibration Master Detection) + session context

**Date:** 2026-06-19
**Branch context:** all work merged to `main` (PRs #290, #292, #293). Deployed and running on the Windows dev box.

This document hands off to the next agent. It covers (1) what spec 040 delivered and how it's built, (2) how to extend the detector system, (3) the Windows validation loop and its traps, and (4) the still-open backlog.

---

## 1. Spec 040 — Calibration Master Detection: COMPLETE

**Problem:** calibration frames didn't detect XISF masters. Users have XISF/FITS bias/dark/flat *masters* (stacked, already processed) sitting alongside raw sub-frames. The app grouped whole folders and never recognized a master as an individual calibration artifact. Also the scan/inbox "filetype" column always showed `FITS` even for XISF.

**Delivered (three PRs):**

- **#290 — Phase 1: detection engine.**
  - New crate `crates/calibration/master-detect/` — a per-tool detector system (see §2).
  - `crates/metadata/fits/` + `crates/metadata/xisf/` now extract `STACKCNT` (FITS) / `NCOMBINE` fallback → `stack_count`.
  - `crates/app/core/src/inbox/classify.rs` builds a `DetectInput` from raw metadata and calls `detect_master()`; when a master is detected it uses the detected `frame_type` + `is_master` (bypassing the IMAGETYP normalization table), else the existing path.
  - Migration `0042` added `is_master` + `master_detector` to `inbox_classification_evidence`.

- **#292 — Phase 2a: individual master items + real format.**
  - Masters get their **own** `inbox_items` row (`relative_path = <file path>`, `is_master_item = 1`); non-master sub-frames stay folder-grouped. A folder that is *all* masters produces only master rows (no folder row). Idempotent via `INSERT OR IGNORE` on `(root_id, relative_path)`.
  - New `format` column (`"fits" | "xisf" | "video" | "mixed"`) carries the **actual** file type. `Lane` (Fits/Video) remains the internal routing/filter concept. **This fixed the "filetype always FITS" bug** — `StepScan.tsx` now shows `format`, falling back to `lane` only for legacy rows.
  - Contract: `InboxItemSummary` + `InboxListItem` gained `format`, `isMaster`, `masterFrameType`, `masterFilter`, `masterExposureS`. Bindings regenerated.
  - 7 integration tests in `crates/app/core/tests/scan_masters_integration.rs`.

- **#293 — Phase 2b: surface masters on the Calibration page (Path 1) + lane→"file types" rename.**
  - On inbox **confirm** of a master item, `crates/app/core/src/inbox/confirm.rs` takes a **fast path**: it creates a `calibration_session` row (state `'confirmed'`) + a `calibration_fingerprint` row from the master's `master_frame_type` / `master_filter` / `master_exposure_s`, sets the inbox item to `resolved`, and **creates no filesystem plan** (masters are already at their final path on disk — confirm = register, not move).
  - The Calibration page reads `calibration_master_view` (migration 0041 — joins `calibration_session` + `calibration_fingerprint`), so registered masters surface automatically; no query change needed.
  - Contract: `InboxConfirmResponse.registered_as_master: bool`. Frontend `InboxPage.tsx handleConfirm` branches on `registeredAsMaster` (toast "registered as calibration master" + refresh, instead of the plan flow).
  - Migration `0044` added `source_inbox_item_id` to `calibration_session` (traceability).
  - User-facing "lane"/"lanes" strings renamed to "file type"/"file types" (`InboxList.tsx`). Internal `Lane` enum / `lane` field identifiers were intentionally left unchanged.
  - 4 integration tests in `crates/app/core/tests/confirm_master_integration.rs`.

**Detection rules (researched — see `specs/040-calibration-masters-detection/research.md`):**
- **Siril** keeps the base `IMAGETYP` (e.g. `Dark`) and marks a master via `STACKCNT > 1` and/or a `_stacked.fit` filename. Detector: `is_master = stack_count > 1 OR path looks like master/_stacked`, and requires an `IMAGETYP` that parses to dark/bias/flat.
- **PixInsight/WBPP** writes `IMAGETYP` containing `"Master"` (e.g. `Master Dark`) + path/filename fallback. Detector: `is_master = IMAGETYP contains "master" OR path looks like master`.

---

## 2. The detector system — how to add a new tool

Architecture mandate from the user: *"create a detection mechanism system so that we can always expand it … a separate detector library crate."*

`crates/calibration/master-detect/`:
- `DetectInput<'a> { imagetyp, stack_count, file_name, rel_path }` — the normalized inputs a detector sees.
- `MasterDetection { frame_type: FrameType, is_master: bool, detector: &'static str }`.
- `trait MasterDetector { fn id(); fn detect(&self, input) -> Option<MasterDetection>; }`.
- `detectors() -> Vec<Box<dyn MasterDetector>>` — registry, **order matters** (PixInsight first, Siril second).
- `detect_master(input)` — runs detectors first-wins.
- Helpers: `parse_frame_type()`, `path_looks_like_master()`.

**To add a tool (e.g. APP, NINA, DSS):**
1. Add a `struct FooDetector;` implementing `MasterDetector` with its labeling convention.
2. Register it in `detectors()` at the right precedence.
3. Add unit tests in the crate (there are 23 existing as a template).
4. If it needs a new metadata key, add extraction in `crates/metadata/fits` or `/xisf` and a field on `DetectInput`.

No other layer needs to change — `classify.rs` already consumes `detect_master()` generically.

---

## 3. Windows validation loop (READ THIS before deploying)

The app is validated on a native Windows build (`C:\dev\astro-plan`), driven from WSL via PowerShell. See memory `windows-dev-loop.md`.

**Deploy/reset (use PowerShell natively — NOT `/mnt/c` + cmd quoting, which broke repeatedly):**
```
cd /mnt/c/dev/astro-plan && git fetch origin main && git checkout -f origin/main
powershell.exe -NoProfile -Command "Get-Process desktop_shell,cargo -EA SilentlyContinue | Stop-Process -Force; \
  Remove-Item 'C:\dev\astro-plan\wizard-test.db*' -Force -EA SilentlyContinue; \
  Start-Process cmd.exe -ArgumentList '/k','C:\dev\astro-plan\run-dev.bat' -WorkingDirectory 'C:\dev\astro-plan'"
```
`run-dev.bat` sets `ALM_DB_URL=sqlite://C:\dev\astro-plan\wizard-test.db?mode=rwc` then `cargo tauri dev`. First build after a pull takes ~90–110s. **Do not** build `set X=... && cmd` chains — a trailing space in the DB URL crashed SQLite.

**Traps that keep recurring (all in MEMORY.md):**
- **Mock mode hides real-backend bugs.** `VITE_USE_MOCKS` short-circuits IPC, so dotted-command-name mismatches, snake_case-vs-camelCase payloads, unmanaged `SqlitePool` state, and wrong JOIN tables only appear on the real Windows build. Generated bindings (`apps/desktop/src/bindings/index.ts`) are **authoritative**; the old `commands.ts` wrappers caused drift. Prefer real-backend integration tests.
- **Page layout convention** (memory `page-layout-convention.md`): `.alm-page` / `.alm-page__bar` (pinned, `flex-shrink:0`) / `.alm-page__scroll` (`flex:1; min-height:0; overflow-y:auto`); `#root` is a bounded flex column (`reset.css`). Verify at 1100×720. Action bars are always visible (app-wide convention).
- Inbox model: persistent `inbox_items` (migration 0020), keyed `(root_id, relative_path)`. Cross-root list = `list_unacknowledged_across_roots` joining `registered_sources` (NOT `library_root` — that was bug C1, fixed #287), WHERE state IN ('pending_classification','classified').

---

## 4. Open backlog (not started / deferred)

Priority is the user's call; nothing below blocks 040.

- **Spec 037 Phase 3/4** — migrate remaining callers off hand-written wrappers to generated bindings, then delete the wrappers. P1/P2 done (`ipc.ts` switcher + 73 wrappers delegated). Guard test: `commands.bindings-guard.test.ts`.
- **Targets page features** (large; needs design decisions): filter/sort/group by catalogue / type / in-a-project / project / session; search fix; opposition + altitude graphs per target; an observing-location world-map picker with per-target/session location override + a user default location. These were flagged during validation; no spec yet.
- **Min-screen pass** for Targets and Inbox (the layout convention was applied broadly but those two weren't individually verified at 1100×720).
- **Perf note from Phase 2a:** `try_detect_master` opens every FITS/XISF file in a FITS-lane folder to check for masters. Fine for calibration folders (<100 files); a filename-heuristic short-circuit before opening would help very large sub-frame folders. Optimize only if it bites.
- **XISF master edge case:** detection relies on `XisfExtractor` parsing; non-standard XISF blocks fall through to name-only heuristics (consistent with Phase 1).

---

## 5. Validate 040 on Windows (suggested smoke test)
1. Fresh wizard → add the source folder containing your XISF/FITS calibration **masters**.
2. Scan → masters appear as **individual rows** (one per file), each showing the correct **format** (XISF/FITS, not always FITS), with frame type / filter / exposure.
3. Raw sub-frame folders remain **grouped** (one folder row).
4. Confirm a master in the Inbox → toast "registered as calibration master", item leaves the inbox.
5. Open the **Calibration** page → the confirmed master is listed (dark/flat/bias) with its filter/exposure.
6. Confirm the inbox **file-type filter** reads "file types" (not "lanes").
