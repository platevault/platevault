# Two-stage verification — Per-project output watcher + artifact attribution repair

> Area: PROJECTS · Spec 012 (processing-artifact-observation)
> PRs #400 (per-project watcher, merged) and #409 (startup re-attribution
> repair, merged into `redesign-ui-platevault`).
> Shared runner mechanics: see `e2e-agentic-test/AGENT-RUNNER.md`.
> Stage 1 MUST fully pass before Stage 2.

## Change facts (context)

- Spec 012 FRs: FR-001 (observe the project's configured output folder),
  FR-002 (observed file → `ProcessingArtifact` row), FR-003 (`kind` ∈
  intermediate|master|final with confidence), FR-005 (manual override),
  FR-006 (missing files → `missing` state, never silent deletion), FR-007
  (never write/modify outputs), FR-008 (audit events), FR-009 (surface in the
  project drawer's outputs section).
- PR #400: watcher is attached to the OPEN project's own output folder only
  (was one always-on watcher over every library drive that mis-attributed
  files); detach on close/switch; reopen rescans so nothing written while
  closed is missed. Adds per-tool "watch these file extensions" setting.
- PR #409: startup runs a one-time idempotent repair re-linking rows recorded
  under a library ROOT to the project that owns each file (longest-prefix
  path match, case-insensitive on Windows); unmatched rows are left untouched
  and logged — never deleted, never guessed.
- Commands: `artifact_watcher_attach`, `artifact_watcher_detach`,
  `artifact_list`, `artifact_classify`, `artifact_mark_resolved`.
- UI: Tool Launches accordion (`[data-testid="tool-launches-accordion"]`) in
  the project bottom panel groups artifacts by launch; unattributed group
  label exists; low-confidence and manual-override badges present.
- Touches Rust backend (both PRs) — RECOMPILE TRAP applies on deploy.

## Preconditions — setup / reset + fixture recipe

1. Deploy `origin/redesign-ui-platevault`; touch changed `.rs` files
   (`crates/app/core/src/artifact*`, `crates/workflow/artifacts/src/*` or
   simply `crates/persistence/db/src/lib.rs`) after reset; relaunch so cargo
   rebuilds (stale-binary symptom: watcher commands "not found").
2. Fixture:
   a. Fresh DB → setup (Lights + Inbox + Projects folders) → ingest fixture
      lights → create TWO projects `Attr One` and `Attr Two`, each with one
      source, in sibling folders under the Projects root (note both absolute
      folder paths from `projects_get`).
3. Window 1100×720; real backend only; `ipc_monitor` on.

## Stage 1 — Agent validation via Tauri MCP

### Test 1.1 — Watcher attaches per project, detaches on close (PR #400)
1. Open `Attr One`'s detail.
2. Expected: captured `artifact_watcher_attach` scoped to `Attr One`'s id /
   output folder (payload must reference that project, not a library root).
3. Navigate away (Projects list or `Attr Two`).
4. Expected: captured `artifact_watcher_detach` for `Attr One`; opening
   `Attr Two` attaches a watcher for `Attr Two` only.
5. FAIL if: no attach/detach pair; attach payload is root-scoped; watcher for
   the closed project stays attached.

### Test 1.2 — Live detection lands in the owning project (FR-001/002/009)
1. With `Attr One` OPEN, write a file into ITS output folder:
   `Set-Content 'C:\...\Attr One\output\integration_Ha.xisf' 'x'`
   (create the folder if the tool-output convention requires; use the path
   from `projects_get`).
2. Expected: within a few seconds an artifact row appears in `Attr One`'s
   Tool Launches accordion; captured `artifact_list` refresh shows the row
   with a `kind` + confidence (FR-003); `read_logs` shows the detection
   audit event (FR-008).
3. Open `Attr Two`: the file MUST NOT appear there (attribution correctness).
4. Screenshot: `s1-live-detection.png`.
5. FAIL if: no row in the owner; row appears under the wrong project; no
   audit event.

### Test 1.3 — Closed-project catch-up rescan (PR #400)
1. Navigate AWAY from `Attr One` (watcher detached), then write
   `...\Attr One\output\master_flat.xisf` on disk.
2. Reopen `Attr One`.
3. Expected: the reopen rescan picks the file up — the new artifact row
   appears without needing an app restart.
4. FAIL if: the file written while closed is permanently missed.

### Test 1.4 — Startup re-attribution repair (PR #409)
This simulates the legacy bug's data shape, then verifies the startup repair.
1. Quit the app (`Get-Process desktop_shell,cargo | Stop-Process -Force`).
2. Using sqlite against `C:\dev\astro-plan\wizard-test.db` (from WSL use the
   read-write CLI carefully, or PowerShell sqlite3), UPDATE one existing
   artifact row for the `Attr One` file so its owner key points at the
   library ROOT instead of the project (mirror of the legacy mis-keyed rows;
   inspect the artifacts table schema first and record the before state).
   If direct DB surgery proves too risky, mark 1.4 BLOCKED with the schema
   dump instead of guessing.
3. Relaunch the app.
4. Expected:
   - `read_logs` shows the one-time repair running at startup (before any
     watcher attaches) and re-linking the row (longest-prefix match).
   - `Attr One`'s outputs list shows the artifact again; cleanup/archive
     surfaces would now see it (asserted deeply in the 017 scenarios).
   - Running a second restart performs no further changes (idempotent —
     log shows zero rows re-keyed).
5. FAIL if: repair deletes the row, attributes it to the wrong project, or
   re-runs non-idempotently.

### Test 1.5 — Never modify outputs (FR-007) + missing state (FR-006)
1. Record the artifact file's mtime/size before and after all tests —
   MUST be byte-identical (the app never writes to outputs).
2. Delete `integration_Ha.xisf` from disk; refresh/reopen the project.
3. Expected: the row transitions to a `missing` state (visible marker), it is
   NOT silently dropped from the list.
4. FAIL if: file content/mtime changed, or the row vanished.

### Test 1.6 — Logs & layout
1. `read_logs`: no panics; repair + detection events present.
2. 1100×720: accordion scrolls within content; action bar pinned.

Stage 1 verdict: PASS = 1.1, 1.2, 1.3, 1.5, 1.6 green; 1.4 green or BLOCKED
with schema evidence (a BLOCKED 1.4 must be escalated, not ignored).

## Stage 2 — Final Claude Desktop pass (human judgment)

1. Watch the live-detection moment by eye: drop a file while the project is
   open and judge the latency/feedback (row appears without user action).
2. Attribution trust: with both projects side by side, confirm a human can
   tell which outputs belong to which project (launch grouping labels,
   unattributed group naming).
3. Kind/confidence presentation: low-confidence badge and manual-override
   badge are understandable; exercise a manual reclassification
   (`artifact_classify`) via the row's UI if exposed and judge the flow.
4. Missing-state presentation: the deleted file's row reads as "missing",
   not as an error explosion.
5. Themes: outputs accordion in `warm-clay` and `observatory-dark`.
6. Layout 1100×720: long file paths truncate gracefully; only content
   scrolls.
7. Sign-off PASS/FAIL + screenshots.
