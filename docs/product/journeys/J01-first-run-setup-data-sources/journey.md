## Journey 1 — First-run setup → data sources

**Goal:** get a fresh install from an empty database to a working library:
register the folders that hold raw lights, calibration frames, project
outputs, and the inbox drop zone, then keep managing those folders over time
(rename/move a drive, temporarily disable a folder, retire one).

**Preconditions:** empty database (first launch, or after "Restart first-run
setup").

**Narrative flow:**

1. On first launch — or after choosing **Settings → Advanced → Restart
   first-run setup** (a confirm-gated control distinct from the guided-tour
   "Restart guided flow" button) — the app opens the setup wizard
   ("Setup · Step 1 of 5"). If this is a restart, the previously-registered
   folders are pre-filled; nothing is deleted.
2. **Step 1 — Source Folders.** One page presents four folder categories as
   compact cards: Light frames (required), Calibration, Project outputs, and
   Inbox (all optional). For each folder the user adds, they choose whether
   it is **organized** (already sorted into a structure PlateVault should
   respect) or **unorganized** (PlateVault should propose where files belong).
   The inbox category has no such choice — an inbox is unorganized by
   definition. Duplicate or invalid paths are rejected inline; nothing is
   registered with the backend yet (this is a working buffer you can still
   edit).
3. **Steps 2–3 — Processing Tools, Configuration.** The user points at
   PixInsight/WBPP (or another supported tool) and confirms basic
   configuration; both can be skipped/defaulted.
4. **Step 4 — Confirm.** A summary of all four source categories. Only here
   does the wizard actually register the sources and kick off a scan.
5. **Step 5 — Scan.** Each registered folder is scanned; the step completes
   once every source's scan reaches a terminal state (including "0 items" for
   an empty folder). Finish is only enabled once everything is done.
6. Finishing marks setup complete and lands on the Inbox. The completion flag
   sticks — reopening the app goes straight past `/setup`.
7. **Ongoing management (Settings → Data Sources):** each registered root
   shows as a card. From here the user can:
   - **Rescan** a folder to pick up new files.
   - **Remap** a folder whose drive moved: paste the new path, **Verify**
     samples the files at that path (no mutation), and only once verified
     does **Apply remap** persist the new path — PlateVault never moves files
     to follow a remap, it just re-points its own record.
   - **Disable** a source temporarily (reversible, no confirm needed to
     re-enable) — a disabled source drops out of scan/ingest but its history
     stays visible.
   - **Delete** (un-register) an **offline** source permanently — this only
     removes PlateVault's registration; files on disk are never touched, and
     the button is blocked if other records still depend on that root.

**Touch & validate:**

- Wizard: every step's forward/back/skip; the organized/unorganized choice on
  each category card; step navigation affordance (clickable? keyboard?);
  entering an invalid path, a duplicate path, a nested/overlapping root, and
  a file-not-folder path — each must be rejected inline *at add time* with a
  named reason, before anything registers.
- Confirm step: summary must state, per folder, category **and** organization
  state; Finish must stay disabled until every scan is terminal, including a
  0-item folder.
- Completion: landing page after Finish; relaunch skips `/setup`; "Restart
  first-run setup" pre-fills prior folders and deletes nothing.
- Data Sources cards: **Rescan** (feedback: started → finished, count delta),
  **Disable** then re-**Enable** (state visibly flips, persists across
  reload, disabled source provably drops out of scan), **Remap** (Verify on
  an empty folder must not report success; Apply blocked until verified;
  record re-points with no file movement), **Delete** on an offline root
  (blocked-with-reason when dependents exist), **Override** protection
  (set → visible change → *and* backend readback agrees → remove override).
- Per-source setting override widget: set an override, confirm it is listed,
  remove it; "Restore defaults" states which settings it resets and every one
  of them is visible somewhere in the pane.
- Signals: every button above produces an explicit success or failure signal
  at the control, not just a log line.

**Safety & trust notes:** remap is preview-then-apply and never touches
files; delete is registration-only and blocked when dependents exist; native
folder pickers and "Show in File Explorer" reveal use OS-native affordances
rather than ad-hoc dialogs.

**Scenario files:**
`e2e-agentic-test/003-first-run-source-setup/wizard-fresh-db-journey/scenario.md`,
`.../restart-first-run/scenario.md`,
`.../data-sources-remap-rescan/scenario.md`,
`.../data-sources-disable-delete/scenario.md`,
`e2e-agentic-test/004-native-filesystem-controls/picker-reveal-controls/scenario.md`,
`e2e-agentic-test/016-source-protection-defaults/protection-defaults-take-effect/scenario.md`.

**Known gaps (2026-07-04):**
- Disable/Delete on Data Sources cards require **PR #404** (open) — pre-#404
  these buttons are `console.log` stubs.
- The spec's aspirational 8-step wizard (Welcome → Raw → Calibration →
  Project → Inbox → Detect Tools → Download Catalogs → Finish) never
  shipped; the real wizard is 5 steps as described above.
- Global source-protection defaults (Settings → Cleanup) only started
  actually gating plan-safety checks after PR #405 (now merged) — before that
  it was a silent no-op.
