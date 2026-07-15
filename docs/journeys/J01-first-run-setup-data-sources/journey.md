---
id: J01
title: Go from an empty install to a scanned, manageable library
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [setup, settings]
interfaces: [desktop-ui]
trace:
  - docs/product/journeys/J01-first-run-setup-data-sources/journey.md @ 66026463
  - docs/journeys/J01-first-run-setup-data-sources/journey.md pilot @ 71e88aae (S12 grafted)
  - deltas/2026-07-14-jval-docdrift.md (PR #686)
  - deltas/2026-07-14-q15-t123.md (PR #826, spec-030 FR-130-134)
  - deltas/2026-07-14-q15-t125.md (PR #826, spec-030 FR-130-134)
---

## Goal
A user with a fresh install (or an empty database) registers the folders that
hold their library — light frames, calibration frames, project outputs, an
optional inbox drop zone, and an optional home observing site — and ends up
with every folder scanned and the app landed on the Inbox. "Done" for setup
means: the completion flag is set (relaunch skips the wizard), every
registered folder reached a terminal scan state, and the folders are visible
and manageable afterward from Settings → Data Sources (rescan, remap, disable,
delete) without ever moving or deleting a file on disk.

## Preconditions
- P1: Empty database — first launch, or after **Settings → Advanced →
  Restart first-run setup** (a confirm-gated control, distinct from the
  separate "Restart guided flow" button that resets the first-project tour).

## Steps

### S1 — Open the setup wizard {#S1}
- **Do:** Launch the app for the first time, or trigger "Restart first-run
  setup" from Settings → Advanced.
- **Expect:** The app opens a 6-step wizard ("Step 1 of 6"): Source Folders,
  Processing Tools, Configuration, Observing Site, Confirm, Scan.
- **Expect:** If this is a restart, folders registered in a prior run are
  pre-filled into the working buffer.
- **Expect (negative):** A restart does not delete any previously registered
  folder or its history.

### S2 — Register source folders {#S2}
- **Do:** On Step 1 (Source Folders), add one or more folders under each of
  four categories: Light frames, Calibration, Project outputs, Inbox. For
  every non-inbox folder, choose whether it is **organized** (already sorted
  into a structure the app should respect) or **unorganized** (the app should
  propose where files belong). Inbox has no such choice — it is always
  unorganized.
- **Expect:** Light frames and Project outputs are required categories;
  Calibration and Inbox remain optional. Continue to the next step is
  disabled while either required category has zero folders.
- **Expect:** Adding an empty path, a duplicate path already registered under
  the same category, or a path already registered under a different
  category is rejected inline at add time, with a distinct reason shown for
  each case.
- **Expect (negative):** Nothing is registered with the backend at this
  point — this step is a local working buffer the user can still edit or
  remove entries from.

### S3 — Configure processing tools and defaults {#S3}
- **Do:** On Step 2 (Processing Tools), optionally point at PixInsight/WBPP or
  another supported tool. On Step 3 (Configuration), optionally set the
  default source-protection level (protected/normal/unprotected) and other
  first-run defaults.
- **Expect:** Both steps can be skipped or left at their defaults; Continue
  is never blocked by them.

### S4 — Set an optional observing site {#S4}
- **Do:** On Step 4 (Observing Site), optionally use the map picker or type
  Name / Latitude / Longitude / Elevation / Timezone.
- **Expect:** The step can be left entirely blank; Continue is not blocked by
  an empty site.
- **Expect:** If any of name/latitude/longitude is filled in, the other two
  become required and latitude/longitude must be in range before Continue is
  enabled.
- **Trace:** spec 044 Track B, US6 T016.

### S5 — Confirm and register {#S5}
- **Do:** On Step 5 (Confirm), review the summary — folder paths grouped by
  category with each one's scan depth, enabled processing tools with their
  configured path, and a "what happens next" note — then advance.
- **Expect:** Advancing from Confirm is what registers every source folder
  with the backend for the first time and moves to the Scan step.
- **Expect:** If any folder fails to register, the wizard shows the failure
  reason and does not silently drop it or advance past Confirm.
- **Expect (negative):** Nothing is registered by any step before Confirm.

### S6 — Scan and finish {#S6}
- **Do:** Wait for Step 6 (Scan) to process every registered folder, then
  select Finish.
- **Expect:** Each registered source reaches a terminal scan state (including
  "0 items" for an empty folder); Finish stays disabled until every source is
  terminal.
- **Expect:** Finishing marks first-run setup complete and lands on the
  Inbox.
- **Expect (negative):** Relaunching the app after Finish does not reopen the
  setup wizard.

### S7 — Rescan a registered folder {#S7}
- **Do:** From Settings → Data Sources, trigger Rescan on a folder's card.
- **Expect:** The card shows an explicit started → finished signal and any
  item-count delta at the control, not only in a log.
- **Expect:** The rescan writes a durable audit row; an automatic/periodic
  rescan (not user-triggered) writes a diagnostic-severity row instead of a
  workflow-severity one.
- **Trace:** spec-030 FR-130–FR-134 (PR #826).

### S8 — Remap a folder whose drive moved {#S8}
- **Do:** On a folder's card, choose Remap, paste the new path, select
  Verify, review the sampled files, then select Apply remap.
- **Expect:** Verify samples relative paths at the new location without
  mutating anything, and reports per-sample found/not-found.
- **Expect:** Apply remap is disabled until Verify has produced a result for
  the current path; editing the path after a Verify invalidates that result
  and forces a fresh Verify before Apply is enabled again.
- **Expect:** Applying re-points the stored path only; a durable audit row
  records the old and new path.
- **Expect (negative):** Verifying or applying a remap never moves, copies,
  or deletes any file on disk.

### S9 — Disable and re-enable a folder {#S9}
- **Do:** Disable a folder's card, then re-enable it.
- **Expect:** The state visibly flips at the control and persists across a
  reload; a disabled source is excluded from scan/ingest while its prior
  history stays visible.
- **Expect:** Both the disable and the re-enable write a durable audit row
  with before→after state.
- **Expect (negative):** Re-enabling a source requires no confirmation
  dialog (only disabling registered history is what's guarded elsewhere).

### S10 — Delete an offline folder {#S10}
- **Do:** On an offline source's card, choose Delete.
- **Expect:** The un-registration succeeds only for offline sources and only
  when no other record still depends on that root; when dependents exist,
  the button is blocked with the reason shown.
- **Expect:** A successful delete writes a durable audit row.
- **Expect (negative):** Delete never touches the files on disk — it only
  removes the app's registration record.

### S11 — Set and remove a per-source protection override {#S11}
- **Do:** On a folder's card, set a protection override, confirm it is
  listed, then remove it.
- **Expect:** Setting the override is visible at the control and confirmed
  by a backend readback; removing it returns the control to the inherited
  default.
- **Expect:** Both the set and the remove write a durable audit row whose
  returned audit id resolves to an entry in the Audit Log.
- **Expect (negative):** Merely viewing the Data Sources pane produces no
  audit row.
- **Trace:** spec-030 FR-130–FR-134 (PR #826).

### S12 — Reveal a source folder in the OS file manager {#S12}
- **Do:** Click the "Show in File Explorer" (or platform-equivalent) control
  on a source card.
- **Expect:** The OS-native file manager opens at exactly that folder, not a
  parent directory.

## Success criteria
- SC1: From an empty database, a user with at least one Light-frames folder
  and one Project-outputs folder reaches Finish and lands on the Inbox
  (S1–S6) without any step silently registering a folder before S5.
- SC2: Every registered folder's Data Sources card supports Rescan, Remap
  (verify-then-apply), Disable/Enable, and — once offline and dependent-free
  — Delete, each producing an explicit success/failure signal at the control
  (S7–S10).
- SC3: Every source lifecycle action in S7–S11 (register, rescan, remap,
  enable/disable, delete, protection override) resolves to a durable
  `audit_log_entry` row, not only a live bus event.

## Known gaps

## Delta log
