# Windows manual-verification checklist — all 10 user journeys

Actionable checklist for running the `verify-on-windows` procedure (real Tauri
app, real backend, no mocks) against every journey in
`docs/product/user-journeys.md`. Use this as the scenario source when
generating a `docs/development/windows-validation/<slug>.md` via the
`verify-on-windows` skill, or execute it directly against the Windows checkout.

As of 2026-07-05 all PRs that `e2e-agentic-test/MASTER-PLAN.md` lists as
gating (#404, #408, #413, #414, #415) are **merged** — no journey below is
blocked on an open PR. Re-check `gh pr view <n>` if this doc ages.

## Shared mechanics (read once)

- Windows checkout: `C:\dev\astro-plan`. Deploy: `git fetch origin && git
  reset --hard origin/<branch>` (own command), then **touch changed `.rs`
  files** before relaunch — `git reset --hard` leaves a stale mtime and cargo
  skips recompiling (symptom: a shipped command reports "not found").
- Launch: `powershell.exe -NoProfile -Command "Start-Process -FilePath
  'cmd.exe' -ArgumentList '/k','C:\dev\astro-plan\run-dev.bat'
  -WorkingDirectory 'C:\dev\astro-plan'"`. Kill: `Get-Process
  desktop_shell,cargo | Stop-Process -Force`.
- **Reset to fresh first-run** (needed before Journeys 1–3, 5–8 unless noted
  "reuses prior state"): `Remove-Item 'C:\dev\astro-plan\wizard-test.db*'
  -Force`, then relaunch. Clearing `localStorage` alone is NOT a reset (causes
  a `/`↔`/setup` redirect loop) — the DB is the first-run source of truth.
- Full mechanics (canonical: launch, reset, recompile trap, bridge connect,
  `VITE_E2E` native-picker stand-ins, blank-screen recovery):
  `docs/development/windows-native-rust-dev.md` §"Validation driving (MCP bridge,
  reset, recompile trap)". The blocks above are the copy-once summary; that doc
  is the source of truth.

## Automated coverage baseline (what you do NOT need to re-prove by hand)

Layer-2 real-backend, real-UI journeys (`crates/e2e-tests/tests/journeys.rs`,
`tests/smoke.rs`, run via `just test-e2e` / tauri-driver, Windows or CI Stage B
only — WSL has no webview):

| Test | Covers |
|---|---|
| `first_run_resolve_create_project` | Journey 1 core flow (wizard → registered sources → scan) |
| `plan_review_apply_with_audit` | Journey 2/3 plan review → apply → `plan_apply_events` audit proof |
| `ingestion_sessions_search` | Journey 2 → 4 → 8: ingest → session grouping → calibration suggest → global search |
| `lifecycle_integrity` | Journey 5/7: lifecycle transition + `lifecycle.ledger.list` read |
| `cleanup_plan_review` | Journey 6: cleanup scan → review → apply |
| `all_top_level_screens_load` | Smoke: every top-level route renders via `AppErrorBoundary`, no route crashes |

These prove the IPC round-trip and DOM assertions on **some** OS (CI runs both
Windows and Linux runners); they do not prove Windows-specific things: native
file pickers/Explorer reveal, OS trash semantics, window chrome, DPI/theme
rendering, or anything gated behind `manual` scenario steps below. Journeys 7
(archive/delete), 9 (targets/planning), and 10 (settings/appearance/i18n) have
**no Layer-2 coverage at all** — every step in those sections is manual-only.

---

## Journey 1 — First-run setup → data sources

**Automated:** wizard happy path (`first_run_resolve_create_project`).
**Manual-only:** remap/rescan, disable/delete, native picker + reveal.

**Preconditions:** fresh DB reset.

1. Launch app → expect "Setup · Step 1 of 5". FAIL if it lands on `/` instead.
2. Add a Light frames folder (required) via the native OS folder picker →
   expect the path appears as a card, marked organized/unorganized per your
   choice. FAIL if the picker doesn't open or the path silently drops.
3. Skip Steps 2–3, reach Step 4 (Confirm) → expect a summary of all added
   categories, nothing registered yet (no scan running). FAIL if a scan
   already started before this step.
4. Click through Step 5 (Scan) → expect each source reaches a terminal state
   and Finish enables only when all are done.
5. Finish → land on Inbox. Relaunch the app (no reset) → expect it goes
   straight to Inbox, not `/setup`. FAIL if it re-shows the wizard.
6. **Settings → Data Sources**: click **Rescan** on the registered card →
   expect it re-runs without re-prompting for a path.
7. Click **Remap**, paste a different valid path, click **Verify** → expect a
   sample-file check with no mutation, then **Apply remap** persists it. FAIL
   if any file moved on disk.
8. Click **Disable** on a source → expect it drops out of Inbox scan/ingest
   but history stays visible; re-enable needs no confirm.
9. On an **offline** source, click **Delete** → expect a confirm, then the
   registration is removed but no file on disk is touched; button is disabled
   if dependents exist.
10. Use "Show in File Explorer" on a source card → expect Windows Explorer
    opens at that exact folder (not a parent).

---

## Journey 2 — Ingest → review/reclassify → confirm (move mode)

**Automated:** ingest → confirm → plan apply → audit
(`plan_review_apply_with_audit`, `ingestion_sessions_search`).
**Manual-only:** mixed-folder single-type splitting visual, needs-review
banner/badges, bulk reclassify UI, root-picker prompt.

**Preconditions:** fresh DB, an inbox root + a light-frames root registered,
a folder with mixed frame types (e.g. lights + darks) dropped into the inbox.

1. **Inbox → Rescan** → expect the mixed folder materializes as separate
   single-type items (e.g. `light · Ha · 300s`, `dark · 300s`), each still
   showing its shared source folder. FAIL if it shows one ambiguous "mixed"
   row.
2. Drop a file missing a mandatory field (e.g. no filter, no target) →
   rescan → expect a danger banner naming exactly what's missing, "needs
   `<attribute>`" badges on affected rows, and **Confirm** disabled.
3. Select the affected rows → bulk reclassify → set the missing value → apply
   → expect the item re-partitions into a clean single-type item and Confirm
   re-enables. Rescan again → expect the override survives.
4. Click **Confirm** on a light-frame item with 2+ registered light roots →
   expect a root-picker prompt before a plan generates. With exactly one
   valid root → no prompt, auto-chosen.
5. Confirm again → expect the item stays visible in the queue marked
   "planned" (does not disappear).
6. Open the plan review overlay → expect the full destination path shown
   (e.g. `{target}/{filter}/{date}/light/`) before Apply. Apply → expect
   files physically move to that path on disk (verify via Explorer).
7. Edit the source file on disk after confirm but before apply, then try to
   apply → expect a stale-plan refusal, not a silent apply of outdated
   actions.

---

## Journey 3 — Ingest → confirm (catalogue-in-place)

**Automated:** covered by `plan_review_apply_with_audit` if its fixture is
catalogue-mode; otherwise manual-only.
**Manual-only:** the move-vs-catalogue branch itself, byte-identity check.

**Preconditions:** fresh DB, a light-frames root registered as **organized**,
already-sorted files under it.

1. Rescan the organized root → expect items classify like Journey 2.
2. Confirm an item → expect the plan reports move count 0, catalogue count =
   file count, and **no destination-root picker** appears.
3. Open the review overlay → expect catalogue actions listed (not move
   actions), still showing the Archive-vs-Trash destructive-destination
   control even though these actions don't need it.
4. Apply → expect the files' bytes/hashes are unchanged (spot-check a file's
   modified timestamp and content in Explorer) and the item now appears in
   Sessions.

---

## Journey 4 — Sessions review (derived groupings)

**Automated:** `ingestion_sessions_search` (session grouping after apply).
**Manual-only:** absence-of-controls check, rescan-idempotency check.

**Preconditions:** reuses Journey 2 or 3's applied state (no reset needed).

1. Before any plan applies, open **Sessions** → expect it's empty for that
   data.
2. After applying (Journey 2/3), open **Sessions** → expect the session
   appears automatically with counts matching what was moved/catalogued, no
   extra "review" step.
3. Confirm the session list/detail has **no** Confirm/Re-open/Reject/Ignore
   buttons and no review-state pills. FAIL if any appear — that would be a
   regression of the removed lifecycle state machine.
4. Edit session notes → expect it saves without any lifecycle transition or
   re-confirm prompt.
5. Rescan the inbox again (no new files) → expect no duplicate sessions and
   no review state reappears.

---

## Journey 5 — Project lifecycle: create → attach → manifests → launch → artifacts

**Automated:** `lifecycle_integrity` (transition + ledger read).
**Manual-only:** create-wizard validation, folder-on-disk location, source
attach/remove UX, manifest/notes UI, tool launch spawn, artifact watcher.

**Preconditions:** fresh DB with ≥1 confirmed session (Journey 2/3 done); a
processing-tool executable path configured (e.g. point at any `.exe` for the
spawn test).

1. `/projects/new` → type a name that already exists (case-insensitive) →
   expect an inline field error immediately, creation blocked. FAIL if a
   generic toast appears instead.
2. Create with a unique name → expect a toast confirming creation, and
   verify in Explorer that `lights/`, `darks/`, `flats/` subfolders exist
   **under your registered project library root** (not the app's working
   directory — this was PR #414's fix, now merged).
3. Edit pane → **Add sources** → expect the picker only lists unlinked,
   already-confirmed sessions (unconfirmed inbox data must not appear).
4. Remove all but one source, then try removing the last one → expect an
   inline confirm ("You can't remove the last confirmed source.").
5. Check the per-channel breakdown → expect real sub-frame counts and
   integration time in hours/minutes, not a placeholder dash.
6. Edit the Notes field, stop typing, wait a few seconds → expect an
   auto-save with a live byte counter; no manual Save button exists.
7. Click "Open in {tool}" → expect the configured executable actually
   spawns (a new process appears in Task Manager). Point the working
   directory outside every registered root (if reachable) → expect launch
   refuses with a plain message, not a silent no-op.
8. With the project open, drop a new file into its output folder → expect
   it's picked up and listed as an artifact with a kind/confidence; close
   and reopen the project after dropping another file while closed → expect
   that one is picked up too.

---

## Journey 6 — Cleanup: scan → review → apply

**Automated:** `cleanup_plan_review`.
**Manual-only:** protection-acknowledgement gate, live per-item progress UI,
post-apply re-scan.

**Preconditions:** fresh DB, a project with mixed-kind outputs
(intermediate/master/final), at least one output marked protected.

1. Project → Outputs/Cleanup → **Scan for cleanup candidates** → expect a
   read-only preview grouped by kind, protected items locked/unselectable,
   nothing touched on disk yet.
2. Choose **Archive folder** (default) or **System trash**, click
   **Generate cleanup plan** → expect this is the point a real plan is
   created; destination now fixed and shown read-only in the review overlay.
3. If a protected item is included, try **Approve & apply** before
   acknowledging → expect it stays disabled until the protection checkbox is
   explicitly ticked.
4. Apply → expect live "Applying N of M…" progress, then verify via Explorer
   the files landed at the chosen destination (not deleted outright if
   Archive was chosen).
5. Re-scan → expect the applied items no longer appear as candidates.
6. Try approving an empty plan (deselect everything) → expect Approve stays
   disabled.

---

## Journey 7 — Archive → delete from archive

**No automated coverage — manual-only journey.**

**Preconditions:** fresh DB, a project in `completed` lifecycle state.

1. Click **Archive** on the completed project with no plan yet generated →
   expect a refusal (lifecycle does not flip silently).
2. Generate the archive plan (backend command — no shipped UI button
   generates it yet per the product doc's Journey 7 gap; use the same
   review overlay flow as cleanup once a plan exists), review it (protected
   items require acknowledgement), approve, apply → expect files move into
   `.astro-plan-archive/<planId>/` on disk (verify via Explorer) and **only
   then** the project's lifecycle flips to `archived`.
3. Open the project's Edit pane → expect it's now read-only.
4. Open the **Archive** page → expect the project is listed with real audit
   history (not placeholder rows). Confirm there is **no** Masters/Targets
   tab, **no** Sessions tab, and the Restore button is hidden/disabled
   (deferred by design, decision D15) — these are expected absences, not
   bugs.
5. Click **Send to trash** → expect the files move to the Windows Recycle
   Bin (verify by opening it).
6. On a different archived project, click **Delete permanently** → type a
   lowercase or partial "delete" → expect the confirm button stays disabled.
   Type the literal `DELETE` → expect it enables and permanently removes the
   files.
7. Click "Show in File Explorer" (or the disabled state when nothing to
   reveal) → expect the Windows-native label and correct disabled state.

---

## Journey 8 — Calibration: ingest cal frames → masters → matching

**Automated:** `ingestion_sessions_search` covers "calibration suggest" at
the IPC level.
**Manual-only:** masters list UI, fingerprint columns, matching-candidate UI,
offset-tolerance setting persistence.

**Preconditions:** fresh DB, a calibration root registered, several master
files (2 darks, a flat, a bias) plus light frames to match against.

1. Ingest the calibration folder → expect it classifies as separate
   individual master items (not one folder aggregate), each with its own
   fingerprint (gain/temperature/binning/filter where relevant).
2. Confirm + apply → open **Calibration** page → expect one row per master
   file, kind-conditional fingerprint columns (a bias shows a dash for
   temperature/gain, by design), and no master *light* frames listed here.
3. Select a master → expect ranked candidate sessions with real context
   (target, filter, night, frame count); a session with a hard-rule
   mismatch (e.g. wrong gain) shows a mismatch indicator, not hidden.
4. Assign a master to a session, then Cancel → expect no backend call fired
   (verify via the bottom log panel / no new audit row). Confirm instead →
   expect the assignment records with a usage count.
5. **Settings → Calibration** → change "Offset tolerance" → restart the app
   → expect the value persisted and the matching view immediately reflects
   the new tolerance.

---

## Journey 9 — Targets & planning

**No automated coverage — manual-only journey.** Read the "stubbed/pending"
narrative in `docs/product/user-journeys.md` Journey 9 before testing: several
columns are **intentional placeholders**, not bugs.

**Preconditions:** setup completed (bundled seed catalog loads automatically);
network connection for the SIMBAD test.

1. Open **Targets** → expect the seeded catalog renders (thousands of rows,
   smooth virtualized scroll). Search "M31" and separately "Andromeda" →
   expect both resolve to the same row.
2. Sort by any column → expect a single active sort indicator; verify
   `aria-sort` is set on that column header (inspect via DevTools/Explorer
   accessibility tree, or a screen reader) — this requires PR #415, now
   merged.
3. **Add target**, type a name in the local seed → confirm → expect exactly
   one row persists (re-add the same target → still one row, no duplicate).
4. Add a target NOT in the local seed with network available → expect a
   SIMBAD resolve-on-demand lookup, then caches the result. Disconnect
   network (or use an unresolvable name) → expect an inline "not found" /
   unreachable message, never a fabricated row.
5. Open a target's detail page → verify identity fields (designation, type,
   coordinates, source, catalog id where present); add a user alias →
   expect it becomes searchable from the Targets list immediately; try
   removing a catalog-provided alias → expect it can't be removed (only
   user-added ones can).
6. On the same detail page, hover the Max altitude / sparkline / Opposition
   / Lunar separation / Filters / Image time columns and the altitude graph
   → **expect explicit "approximate"/placeholder-latitude disclosure
   tooltips**. FAIL if any of these renders a concrete-looking value with NO
   disclosure — a fabricated-looking stub is treated as a verification
   failure per the constitution, even though the stub itself is expected.
   Opposition and Sessions columns should render as a dash.
7. Toggle "Favourites"/"My Targets" → close and reopen the app → expect it
   persisted only if you're on the same browser profile (it's
   `localStorage`-only, not DB-backed) — confirm this is the *actual*
   behavior, not a surprise regression.

---

## Journey 10 — Settings, appearance, and i18n

**No automated coverage — manual-only journey** (cross-cutting layout/i18n
checks apply to every screen you touch in Journeys 1–9 too).

**Preconditions:** setup completed with ≥1 registered source.

1. Open **Settings** → expect 12 panes grouped into Library / Processing /
   Application sections, no global "Save" button anywhere (every field
   auto-saves).
2. **Appearance**: switch through all 4 named themes + "System" → expect
   each applies live with no reload. Restart the app → expect the last
   choice persisted. Change Density/Font-size → confirm Font-size is
   visual-only (no effect outside the pane) — expected, not a bug.
3. **Ingestion** pane: toggle symlink-following/hashing eagerness, restart →
   expect values persisted (no scan pipeline consumes them yet — expected).
4. **Target Planner** pane: set "usable altitude" to a value outside 0–90 →
   expect it clamps; set a valid value → expect it immediately affects the
   (stub) Targets planner view.
5. Bottom log panel: expand it → expect it shrinks the main content area
   (not an overlay). Filter by each severity chip; turn log level to Debug →
   expect deep diagnostics now show; export the visible window → expect a
   JSON file, matching only what's currently filtered/visible.
6. Resize the window to exactly 1100×720 (minimum supported) → expect every
   page's header/action bar stays pinned while only the content area
   scrolls (page-layout convention). FAIL if a header scrolls out of view.
7. Trigger a backend error (e.g. attempt an invalid remap path) → expect the
   error banner/toast shows a translated message, never a raw error code or
   English-only backend string, even in a non-English UI language if one is
   configured.
8. Open the command palette (Ctrl+K) → search for a target/session by name →
   expect live backend-search results, and navigation via keyboard only
   (no mouse) works end-to-end.
9. Collapse/expand the left sidebar → reload the app → expect the
   collapsed/expanded state persisted.

---

## Reporting

Use the `verify-on-windows` skill's scenario template
(`~/.claude/skills/verify-on-windows/references/scenario-template.md`) to turn
any subset of the above into a standalone Windows computer-use scenario, and
follow the E2E-sync step to add/update rows in
`specs/037-e2e-integration-testing/contracts/coverage-matrix.md` for anything
found to be automatable but not yet covered by `crates/e2e-tests/tests/`.
