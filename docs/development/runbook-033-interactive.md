# Spec 033 — Interactive Test Runbook (Windows-native)

**Purpose (FR-035):** a per-screen, manually-validated checklist run against the **real** Windows binary
(visible `desktop_shell.exe` window, real Rust backend, real SQLite). Each item is `do X → expect Y`,
tagged with the FR(s) it proves. Traces 1:1 to `traceability-033.md`.

> **This is the human acceptance pass.** The reproducible automated half (Rust/vitest/conformance + CI) is
> green; this runbook proves the real-IPC end-to-end behavior that the headless harness can't (no built
> binary). Run it after the Windows rebuild (clean DB → boots into setup).

## Pre-flight (the operator/agent does this)
1. `git push origin 033-validation-bugfix-remediation` (from WSL).
2. On Windows `C:\dev\astro-plan`: kill `desktop_shell`/`cargo`/`node`; `git fetch origin`;
   `git reset --hard origin/033-validation-bugfix-remediation`; `pnpm install`; `pnpm rebuild esbuild`.
3. **Wipe the DB** so first-run setup shows: delete the app data dir
   (`%APPDATA%`/local-share `dev.astro-plan.astro-library-manager\alm.db`).
4. Launch detached: `pnpm tauri dev` (first build recompiles Rust — minutes). Wait for the window.

## Core journey (SC-001) — do these in order

| ID | Screen | Do | Expect | FR |
|----|--------|----|--------|----|
| RB-0 | App start | Launch with a wiped DB | Lands on **Setup** wizard (not an error boundary); returning launch (DB present) lands on `/sessions`, never a crash | R-1, FR-037 |
| RB-1 | Setup / index | Complete the 4-step setup; then reopen the app | `/` redirects to `/sessions` cleanly; `/calibration` opens without crash even with null fingerprints | R-1, R-2, FR-037 |
| RB-2 | Sessions / inventory | Register a library root and ingest a real folder of captures | Sessions appear **grouped under their library root**; counts look right | FR-012 ⚠ |
| RB-3 | Inbox | Open a mixed folder; pick a **destructive destination** (Archive vs System trash); confirm split | The destructive-destination toggle is visible and the chosen value is honored (not silently "archive") | FR-032, FR-038 |
| RB-3a | Inbox | Change the **Group** dropdown | Options are date / image-vs-video / state — **no "lane" jargon** | FR-040 |
| RB-3b | Inbox / Cmd+K | Open Cmd+K → "Show ignored items" | Entry exists and navigates to the ignored view | FR-033 |
| RB-4 | Calibration | Open the Calibration ledger | Masters load from **real rows** (not "command not found"); suggestions reflect real fingerprints; aging pill uses the configured threshold | FR-013, FR-023 |
| RB-5a | Targets | Select a target | Detail loads **without "Failed to load target"**; shows its real linked sessions/projects | FR-014, FR-044 |
| RB-5b | Targets | Use group (type/constellation) + sort (name/sessions/hours) | Grouping & sorting apply with clear labels | FR-041 |
| RB-5c | Targets | Click **New project** on a target | Opens the new-project **wizard inside the main window** (not bottom/no-layout) | FR-043 |
| RB-6a | Projects | Drive a project through a user transition and let an auto-transition occur | Both views show one consistent lifecycle state | FR-019 |
| RB-6b | Project detail | Trigger a real block (e.g., missing source) | Blocked banner shows the **specific typed reason** (e.g., source missing), not a generic note | FR-020 |
| RB-6c | Project detail | Cause auto block/ready/unarchive | Audit log records each; unarchive emits its event | FR-021 |
| RB-6d/6e | Projects list | Use the lifecycle **multiselect** filter; change **sort** (updated/created/name/sources) | Multiselect works; sort options present | FR-022, FR-042 |
| RB-7 | Create project (wizard) | In the wizard, select **sessions** (step 2) and **calibration frames** (step 3); review; **Create** | Selections stick; create **succeeds** → toast + navigate to the project | FR-043 |
| RB-7a | Plan / apply | Generate a reviewable plan; attempt to apply an item that escapes the root or follows a symlink | Refused **before mutation** with a clear reason; nothing moved | FR-001, FR-002 |
| RB-7b | Plan / apply | Apply a destructive item with no confirm; then confirm; set destination = trash | Blocked until destructive-confirm; trashes to OS bin (archive fallback if unavailable) | FR-003, FR-006 |
| RB-7c | Plan / apply | Apply a plan where a file changed on disk since approval; cause a partial failure | Stale item refused; library left recoverable, no silent loss | FR-004, FR-007 |
| RB-7d | Audit / plan | Bulk-cancel pending items | Each cancelled item has its own audit row | FR-005 |
| RB-8a | Workflow | Complete a workflow run | A project **manifest auto-generates** and persists (no manual step) | FR-008 |
| RB-8b | Artifacts | Drop a processing artifact into a watched project root | It's detected + classified; events fire | FR-009 |
| RB-9 | Guided coach | Start the guided first-project flow; perform each real step | Coach **auto-advances** on the real event; non-modal (UI stays usable); dismissible | FR-010, FR-011 |
| RB-10 | Cmd+K | Type a real target name / alias | Returns real cross-entity results (targets/aliases/sessions/projects) | FR-015, FR-033 |
| RB-11 | Cleanup / protection | Mark a source protected; generate a cleanup/archive plan over it | Plan is **blocked**; protected items identify their source; block is audited | FR-016, FR-017 |
| RB-11b | Settings / protection | Change the global default protection | Persists across reload; audit records the change | FR-018 |
| RB-12a | Settings / calibration | Change the aging threshold; reload | **Persists** and the Calibration view uses it (no silent drop) | FR-023 |
| RB-12b | Settings | Change a setting and wait | Snapshot/debounce fires (observe in logs) | FR-024 |
| RB-12c | (any IPC) | Exercise log viewer export + diagnostic resume | Export writes to a chosen path with a status; diagnostic resume continues from cursor (no full replay) | FR-025 |
| RB-13 | Catalog (fixtures) | (When the catalog repo ships) import a catalog with a tampered signature / unknown license | Rejected; valid one accepted | FR-026..029 |
| RB-14a | Dev build | In a `VITE_DEV_TOOLS=true` build, exercise an op then export from /dev/contracts | Auto-captured; export succeeds to a chosen path | FR-030 |
| RB-14b | Release build | In a normal build, look for the developer surface | `/dev/contracts` is **absent** (not just hidden) | FR-031 |

## Notes for the tester
- ⚠ **RB-2 (FR-012):** if real sessions don't group under their root, that's the known **T036a** gap (the
  scan→session pipeline must call the root_id helper) — record it; don't treat as a surprise.
- Anything that says "command not found" / "Failed to load X" on a freshly-rebuilt binary is a **real** bug
  (stale-binary was ruled out by the clean rebuild) — capture it with the screen + console.
- The agent drives the rebuild/launch and reads `tauri-dev.log` + the SQLite DB; you observe the window and
  click. Report each row pass/fail.
