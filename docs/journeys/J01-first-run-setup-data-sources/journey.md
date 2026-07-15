---
id: J01
title: Register data source folders and keep them current
version: 1
status: draft
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [setup, data-sources]
interfaces: [desktop-ui]
trace: [docs/product/journeys/J01-first-run-setup-data-sources/journey.md, docs/product/journeys/J01-first-run-setup-data-sources/deltas/2026-07-14-jval-docdrift.md, docs/product/journeys/J01-first-run-setup-data-sources/deltas/2026-07-14-q15-t123.md, docs/product/journeys/J01-first-run-setup-data-sources/deltas/2026-07-14-q15-t125.md, docs/development/journey-run-2026-07-14.md, PR-440, PR-686, PR-404, PR-405, PR-826, issue-647, spec-030 FR-130-FR-134]
---

## Goal
An astrophotographer takes a fresh PlateVault install from an empty database
to a configured library — light, calibration, project-output, and inbox
folders registered, a processing tool pointed at, and an observing site set —
then keeps those data sources current over time (rescan, remap a moved
drive, disable/re-enable, retire an offline one) without ever risking an
unreviewed filesystem mutation. Done means: setup is marked complete and
skipped on every later relaunch, and every data-source lifecycle action
produces both a visible answer-back and a durable audit record.

## Preconditions
- P1: Empty database (first launch), or the user has chosen **Settings →
  Advanced → Restart first-run setup** and confirmed (a confirm-gated
  control distinct from the guided-tour "Restart guided flow" button).
- P2 (for S9–S14 only): setup has already been completed with at least one
  registered source.

## Steps
### S1 — Open the setup wizard {#S1}
- **Do:** Launch the app for the first time, or trigger a first-run restart
  (P1) and confirm.
- **Expect:** The app opens a 6-step wizard: Source Folders, Processing
  Tools, Configuration, Observing Site, Confirm, Scan. On a restart, all
  previously registered folders are pre-filled.
- **Expect (negative):** A first-run restart never deletes previously
  registered folders.
- **Trace:** PR-440 (Observing Site step introduced as part of spec 030's
  wizard rewrite, making the wizard 6 steps), PR-686 (map picker added to
  that step).

### S2 — Add source folders (Step: Source Folders) {#S2}
- **Do:** For each folder category — Light frames, Calibration, Project
  outputs, Inbox — add zero or more folders via the native OS picker,
  choosing **organized** or **unorganized** for each (Inbox has no such
  choice; it is unorganized by definition).
- **Expect:** Light frames AND Project outputs are required categories — the
  wizard blocks progress past this step while either is empty; Calibration
  and Inbox stay optional. At add time, an empty path, a path already
  registered under the same category, and a path already registered under a
  different category are each rejected inline with a distinct reason.
- **Expect:** A path that doesn't exist, isn't a directory, or isn't
  readable is accepted into the working buffer at add time (there is no
  client-side check for these) and is only rejected when actually
  registered — batched at S6 (Confirm), where a failing entry surfaces as
  part of a batch-failure message rather than an inline per-row error at add
  time.
- **Expect (negative):** Nothing is registered with the backend at this
  point — this is a working buffer the user can still edit; no source
  registration call fires until S6 (Confirm).
- **Trace:** `apps/desktop/src/features/setup/sources-store.ts`
  `REQUIRED_KINDS`, `validatePath` (empty/same-kind/cross-kind checks only);
  `crates/app/core/src/first_run.rs` `check_path`/`check_duplicate`
  (existence, directory, permission, duplicate checks — backend-only).

### S3 — Point at a processing tool (Step: Processing Tools) {#S3}
- **Do:** Select PixInsight/WBPP (or another supported tool), or skip.
- **Expect:** The step accepts skip or default with no error and carries the
  choice (or its absence) into S6's summary.

### S4 — Configure basic settings (Step: Configuration) {#S4}
- **Do:** Confirm or adjust basic configuration — including the default
  source-protection level (protected / normal / unprotected) applied to
  newly registered sources — or skip.
- **Expect:** The step accepts skip or default with no error; leaving the
  protection level untouched keeps it at "protected".
- **Trace:** `apps/desktop/src/features/setup/steps/StepCatalogs.tsx`
  `DefaultProtectionControl`.

### S5 — Register an observing site (Step: Observing Site) {#S5}
- **Do:** Use the map picker or manual entry to set Name / Latitude /
  Longitude / Elevation / Timezone.
- **Expect:** The step can be left entirely blank; Continue is not blocked
  while any of Name, Latitude, or Longitude is empty. Once all three are
  filled, Continue blocks until Latitude is in [-90, 90], Longitude is in
  [-180, 180], and Elevation (if given) parses as a number.
- **Expect:** Values entered here carry into S6's summary and, on Finish
  (S8), are saved as both the default and the active observing site with a
  fixed astronomical-twilight/0°-horizon default (changeable later in
  Settings → Target Planner, which also exposes twilight and horizon —
  fields this wizard step does not).
- **Trace:** PR-440, PR-686;
  `apps/desktop/src/features/setup/steps/StepSite.tsx`
  (`siteStepHasSite`, `siteStepError`);
  `apps/desktop/src/features/setup/SetupWizard.tsx` (`canProceed` for the
  Site step).

### S6 — Confirm sources (Step: Confirm) {#S6}
- **Do:** Review the summary of every category added across S2–S5, then
  proceed.
- **Expect:** The summary states, per folder, category, organization state,
  and scan depth; it also lists enabled processing tools with their
  configured path and a "what happens next" note. Proceeding here is what
  actually registers every source with the backend and starts scanning.
- **Expect:** If any folder fails to register, the wizard shows a
  batch-failure message and does not advance to Scan.
- **Expect (negative):** No scan starts before the user leaves this step.
- **Trace:** `apps/desktop/src/features/setup/steps/StepConfirm.tsx`;
  `apps/desktop/src/features/setup/SetupWizard.tsx` `handleEnterScan`.

### S7 — Scan registered folders (Step: Scan) {#S7}
- **Do:** Wait for every registered folder to scan.
- **Expect:** Each source reaches a terminal state, including "0 items" for
  an empty folder.
- **Expect (negative):** Finish never enables while any source is still
  scanning.

### S8 — Finish setup {#S8}
- **Do:** Click Finish.
- **Expect:** Setup is marked complete and the app lands on the Inbox. The
  completion flag persists — fully quitting and relaunching the app goes
  straight to Inbox, never back to `/setup`.

### S9 — Rescan a data source {#S9}
- **Do:** From Settings → Data Sources, click Rescan on a registered card.
- **Expect:** The scan re-runs without re-prompting for a path, with an
  explicit started→finished signal and a count delta at the control. A
  user-initiated rescan writes a durable, workflow-severity audit row.
- **Expect (negative):** An automatic/periodic rescan writes only a
  diagnostic-severity audit row, never a workflow one.
- **Trace:** issue-647, spec-030 FR-130-FR-134, PR-826.

### S10 — Remap a data source {#S10}
- **Do:** Click Remap, paste a different valid existing path, click Verify,
  then — only if Verify succeeds — click Apply remap.
- **Expect:** Verify samples files at the new path with no file movement;
  Apply remap persists the new path in PlateVault's own record and writes a
  durable audit row recording old→new path.
- **Expect:** Editing the path after a Verify invalidates that result — Apply
  remap becomes unavailable again until a fresh Verify runs against the
  edited path.
- **Expect (negative):** Verify on an empty or nonexistent path never
  reports success; Apply remap is not clickable before a successful Verify;
  no file on disk moves at any point, regardless of outcome.
- **Trace:** issue-647, spec-030 FR-130-FR-134, PR-826;
  `apps/desktop/src/features/settings/RemapRootDialog.tsx`.

### S11 — Disable / re-enable a data source {#S11}
- **Do:** Click Disable on a source card, confirm; click Enable on the same
  card to re-enable.
- **Expect:** The state visibly flips and persists across reload; a disabled
  source drops out of scan/ingest; each transition writes a durable audit
  row with before→after state.
- **Expect (negative):** Disabling requires a confirm step (it stops a
  source from being scanned/ingested, so it is confirm-gated); re-enabling
  is restorative and applies immediately with no confirm step; disabling
  never hides the source's prior history.
- **Trace:** PR-404; issue-647, spec-030 FR-130-FR-134, PR-826;
  `apps/desktop/src/features/settings/DataSources.tsx` (disable/enable
  handlers), `DataSources.disable-delete.test.tsx`.

### S12 — Delete (un-register) an offline data source {#S12}
- **Do:** Click Delete on a source that is currently offline.
- **Expect:** A confirm appears; confirming un-registers the source and
  writes a durable audit row. If the source has dependent records
  (sessions/projects), Delete is blocked/disabled with an explanatory
  message instead.
- **Expect (negative):** Delete never removes files from disk; it never
  succeeds while dependent records exist; the Delete control is not offered
  at all on a source card while that source is online.
- **Trace:** PR-404; issue-647, spec-030 FR-130-FR-134, PR-826;
  `DataSources.disable-delete.test.tsx`.

### S13 — Set / remove a per-source protection override {#S13}
- **Do:** Set a protection override on a source, confirm it is listed, then
  remove it.
- **Expect:** The change is visible in the pane and confirmed by a backend
  readback; each of set and remove writes a durable audit row with a
  resolvable `auditId`; "Restore defaults" states which settings it resets
  and every one of them is visible somewhere in the pane.
- **Expect (negative):** Merely opening or reading the Data Sources pane
  produces no audit row.
- **Trace:** issue-647, spec-030 FR-130-FR-134, PR-826.

### S14 — Reveal a source folder in the OS file manager {#S14}
- **Do:** Click the "Show in File Explorer" (or platform-equivalent) control
  on a source card.
- **Expect:** The OS-native file manager opens at exactly that folder, not a
  parent directory.

## Success criteria
- SC1: S1–S8 complete once per install; after S8, relaunching the app never
  re-shows `/setup`.
- SC2: Each of S9–S13 produces both a visible answer-back at its control and
  a durable audit row; S10 and S12 leave zero filesystem mutation beyond
  PlateVault's own registration state.
- SC3: Required-category gating holds at S2 — Light frames and Project
  outputs block progress when empty; Calibration and Inbox never do.

## Known gaps
<!-- - G1: <step or environment that cannot be validated, and why> -->

## Delta log
<!-- Window since last_reviewed. Format:
- **Δ<version>** <date> · <step ids> · behavior-change
  <what changed, user-visibly>
  Evidence: <PR/spec/commit refs> · by: <author>
-->
