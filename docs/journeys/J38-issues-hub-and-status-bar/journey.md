---
id: J38
title: Handle issues from the status bar and the Issues hub
version: 3
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [issues, status-bar, shell, home, sessions, projects, preparation, calibration, calibration-process, locations, import, indexing, activity, duplicates]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#shell-and-navigation-foundation, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions-user-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-2c-user-2026-10-10, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-8-user-2026-10-12, P-SB3, P-ISS1, P-STO2, P-CAL2, P-CAL3, HARNESS-V5-IA.md#round-2b-foundation-status-bar-and-p-cal3-2026-10-09, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S17, apps/prototype/src/domain/issues.ts, apps/prototype/src/app/issues-hub.tsx, apps/prototype/src/app/status-bar.tsx, apps/prototype/src/store/issues.ts, apps/prototype/src/store/notifications.ts, apps/prototype/src/store/operations.ts, apps/prototype/messages/en-GB.json, D-W11, D-W24, D-W74, specs/064-library-inventory/spec.md, specs/071-storage-custody/spec.md]
---

## Goal

The user keeps an eye on what needs attention without leaving their work. The
toolbar's Issues button and the status bar's severity counters show the same
issues, each with one action that leads to where it can be fixed. The bottom bar
also shows which locations are online, how many rows are selected, what work is
running, and the notifications history. Done means:

- At every step the ⛔, ⚠ and ℹ counters add up to the Issues button's count, and each counter's popout lists exactly that severity's issues from the hub.
- Following an issue's action opens the place that owns it: the location, the run at its blocker, the Calibration library, the session, or Activity with Retry.
- An offline drive, interrupted work and a duplicates result raise their issue. Reconnecting the drive and retrying the work clear it without any other action.
- Running work shows with its progress, and "Idle" shows when nothing runs. Cancel appears on hover or keyboard focus.
- With no issues the bar shows only a muted ✓. A counter never reads 0.
- Dismissing an issue (×) hid it from the hub, its popout and the counts until it changed, and left the state behind it and its page unchanged. The hub listed it under `Dismissed (N)` with Restore. The two issues that are a run's next step had no ×.
- Opening the hub, a popout or the notification history changes no file, catalog record or run.

## Preconditions

- P1: A development catalog seeded to the J32/P1 to J32/P4 state. `NGC7000-HOO-Siril` of `NGC 7000 HOO` waits at Calibrate, and `M31-OSC-Siril` of `M 31 OSC` is at Prepare with a failed preparation. Sessions `3 Oct` and `5 Oct` have no confirmed Target, and `4 Oct M 33` is a candidate of no Project. The seed adds the following (G2):
  - `NGC7000-HOO-Siril` has exactly 2 calibration matches that need review.
  - `M31-OSC-Siril` has exactly 1 pending master offer.
  - One raw calibration session, 10 Ha flats of 2 Oct on rig `RedCat`, awaits Stack in the Calibration library. No calibration process has failed.
  - One Usable `1 Oct Ha` frame, F-drift, had its bytes replaced in place by a same-size file with different pixel bytes after review, as in J22/P5. PlateVault has read the change, and F-drift reads Changed content.
  - Nothing else needs attention. No operation is running, failed or interrupted, no adopted master has changed, and no frame has a byte-identical second copy.
- P2: Exactly three locations are registered, `Astro-T7 captures`, `Cold-1 captures` and `Astro-T7/Calibration`, and all three are online. `Cold-1` can be ejected and mounted again.
- P3: The notification history was opened once before S1, so no notification is unread.
- P4: Removable volume `Card-2` is as in J31/P4: 12 NGC 7000 Ha 300 s `RedCat` lights from the night of 2026-10-04, with OBJECT `NGC7000` and no pointing. It has not been imported, and none of its files is byte-identical to a library file.
- P5: Volume `Spare` is mounted, has an OS Trash and is not registered. `Spare/Captures/` holds byte-identical copies of two `4 Oct M 33` lights, M-1 and M-2. Each file is 52,191,360 bytes.
- P6: A second development catalog, catalog B, holds only the Done Project `Pleiades 2025` with its Complete run. Every session of the catalog has a confirmed Target and is a member of that run. Its one registered location, `Astro-T7 captures`, is online, and nothing else needs attention (G2).
- P7: Manifests (relative path, size, SHA-256) of every file on `Astro-T7`, `Cold-1`, `Card-2` and `Spare`, recorded outside PlateVault before S1.

## Steps

### S1 — Read the bar and the hub at rest {#S1}

- **Do:** Launch PlateVault on the P1 catalog. Read the status bar, then open the toolbar's Issues button.
- **Expect:** The status bar reads, left to right:
  - `3 of 3 online`, with no selection count.
  - "Idle" in the middle.
  - ⛔ 1, ⚠ 3 and ℹ 3 on the right, then the bell with no unread count.

  The Issues button shows a count badge of 7, tinted as an error. The hub lists 7 issues in groups, in this order:
  - Sessions: `2 need a Target` (Assign) and `1 not in a Project` (Add).
  - Runs: `M31-OSC-Siril blocked` (Open).
  - Calibration: `NGC7000-HOO-Siril: 2 to review` (Review), `1 master offered` (Review) and `1 to stack` (Stack).
  - Drift: one issue that reads `1 changed` and names the `1 Oct Ha` session (Review).
- **Expect (negative):** Home shows no issues strip and no issue pills. The status bar shows no pills and no inline notification. Opening and closing the hub changes no catalog record, run or file.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Shell and navigation 1, §Round 5 P-SB3, "Home has no issues strip" · HARNESS-V5-IA.md §Round 2b status bar · src/domain/issues.ts deriveIssues · src/app/issues-hub.tsx

### S2 — Open each severity counter {#S2}

- **Do:** Open the ⛔ counter, then the ⚠ counter, then the ℹ counter. Close each popout before opening the next.
- **Expect:** Each popout lists its issues with their action:
  - ⛔ lists `M31-OSC-Siril blocked`.
  - ⚠ lists `2 need a Target`, `NGC7000-HOO-Siril: 2 to review` and the `1 changed` drift issue.
  - ℹ lists `1 not in a Project`, `1 master offered` and `1 to stack`.

  Together the three popouts list the hub's 7 issues, each exactly once. Following the drift issue's Review opens the `1 Oct Ha` session, where F-drift reads Changed content.
- **Expect (negative):** No hub issue is missing from the popouts, and no popout lists an issue that the hub does not. Opening a popout changes nothing.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 · §Round 2c P-SB2 invariant "the chips cover exactly the hub's issues" · src/domain/issues.ts severities · src/app/issues-hub.tsx IssueRow

### S3 — Follow the blocked run {#S3}

- **Do:** From the ⛔ popout, follow `M31-OSC-Siril blocked` (Open).
- **Expect:** `M31-OSC-Siril` opens at its Prepare step. The failed preparation is shown as the blocker, as a terse refusal with its reason. The ⛔ 1 counter is still shown.
- **Expect (negative):** Opening the run starts no preparation and changes no run state. The issue stays until the blocker is resolved.
- **Trace:** HARNESS-V5-IA.md §Screens S5 · src/domain/issues.ts run-blocked (danger for a failed preparation, link to the blocking step)

### S4 — Follow the informational issues {#S4}

- **Do:** From the ℹ popout, follow `1 to stack` (Stack). Back in the popout, follow `1 master offered` (Review). Finally follow `1 not in a Project` (Add).
- **Expect:**
  - Stack opens the Calibration library with the 2 Oct Ha flat process listed as awaiting Stack.
  - The offer's Review opens `M31-OSC-Siril` at Calibrate, with the one pending master offer and its Dismiss action.
  - Add opens Sessions filtered to Not in any Project, listing exactly `4 Oct M 33`.

  ℹ still reads 3.
- **Expect (negative):** Following an issue starts no stack, adopts or dismisses no master, and adds no session to a Project.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3, §Round 1 P-CAL2 · HARNESS-V5-IA.md §Round 2b "Issues: calibration-waiting … info, Stack → /calibration" · src/domain/issues.ts master-offer, not-in-project

### S5 — Take a drive offline and reconnect it {#S5}

- **Do:** Eject `Cold-1`. Read the status bar, then open the ⚠ counter and follow `Cold-1 captures offline` (Locations). Then mount `Cold-1` again.
- **Expect:** After the eject:
  - The left of the bar reads `2 of 3 online`, ⚠ reads 4 and the Issues button reads 8.
  - The hub lists `Cold-1 captures offline` under Locations, and the ⚠ popout lists it as well.
  - Following it opens Settings › Locations, where the `Cold-1 captures` row reads Offline.

  After mounting, the bar reads `3 of 3 online`, ⚠ reads 3 and the Issues button reads 7, with no action from the user.
- **Expect (negative):** No `12 Sep` frame reads Missing, and no session is removed. No other issue appears or disappears.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "Left: locations online" · HARNESS-V5-IA.md §Round 2b "locations online (links to Settings › Locations)" · src/domain/issues.ts location-offline · J19/S15

### S5a — Dismiss two issues and restore them {#S5a}

- **Do:** In the hub, read which issues have an ×. Dismiss `1 to stack` in the hub and `1 master offered` in the ℹ popout. Read the counters and the Issues button, then open the Calibration library and `M31-OSC-Siril` at Calibrate. Back in the hub, open `Dismissed (2)`, choose **Restore** on `1 master offered`, then **Restore all**.
- **Expect:**
  - Every issue has an × with the tooltip "Dismiss", except `M31-OSC-Siril blocked` and `NGC7000-HOO-Siril: 2 to review`, which are a run's next step.
  - After both dismissals, ℹ reads 1 and the Issues button reads 5, while ⛔ 1 and ⚠ 3 are unchanged. The ℹ popout lists only `1 not in a Project`. The hub ends with `Dismissed (2)`, collapsed.
  - The Calibration library still lists the 2 Oct Ha flat process awaiting Stack. `M31-OSC-Siril`'s Calibrate step still shows its pending master offer with its Dismiss action.
  - Opened, `Dismissed (2)` lists both issues, each with **Restore**, beside **Restore all**. After Restore on `1 master offered`, ℹ reads 2, the button reads 6 and the trigger reads `Dismissed (1)`. After Restore all, ℹ reads 3, the button reads 7, and no `Dismissed` entry shows.
- **Expect (negative):** Dismissing or restoring an issue starts no stack, dismisses or restores no master offer, and changes no run, calibration process or file. No popout lists a dismissed issue, and no counter reads 0.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 8 P-ISS1 ("Each issue in the issues hub and in the status-bar popouts has an ×", "The hub ends with 'Dismissed (N)' and Restore. The counters and badges count only issues that are not dismissed", "Dismiss hides the issue only", "No × on issues that are a run's next step (`run-blocked`, `calibration-review`)") · src/app/issues-hub.tsx

### S5b — A dismissed issue returns when it changes {#S5b}

- **Do:** Eject `Cold-1`, then dismiss `Cold-1 captures offline` in the ⚠ popout. Read the bar, the hub and Settings › Locations. Mount `Cold-1`, eject it again and read the ⚠ popout. Then mount `Cold-1` again.
- **Expect:**
  - After the dismissal, ⚠ reads 3 and the Issues button reads 7. The hub ends with `Dismissed (1)`, which lists the offline issue. The left of the bar still reads `2 of 3 online`, and the `Cold-1 captures` row in Settings › Locations still reads Offline.
  - After the mount, the bar reads `3 of 3 online`, ⚠ reads 3 and the Issues button reads 7.
  - After the second eject, `Cold-1 captures offline` is back in the hub and the ⚠ popout with its ×. ⚠ reads 4, the Issues button reads 8, and no `Dismissed` entry shows.
  - After the final mount, the bar reads `3 of 3 online`, ⚠ reads 3 and the Issues button reads 7.
- **Expect (negative):** Dismissing the issue marks no location online. No `12 Sep` frame reads Missing, and no session is removed.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 8 P-ISS1 ("A dismissed issue stays hidden until it changes … a location going offline again brings it back", "its page still shows it") · src/domain/issues.ts location-offline · J39/S5a, J39/S6

### S6 — Read the selection count {#S6}

- **Do:** Open Project `NGC 7000 HOO` and, in its Candidates, select the `12 Sep` and `24 Sep` sessions. Then clear the selection.
- **Expect:** While the two sessions are selected, the left of the status bar reads `2 selected` after the locations. After clearing, the selection count is gone.
- **Expect (negative):** Selecting starts no run and changes no counter.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "then the selection count when a list has a selection" · src/app/status-selection.ts

### S7 — Watch an import run {#S7}

- **Do:** Open Import on `Card-2`. In the preview, choose NGC 7000 as the `4 Oct` Ha session's Target (its lights carry no pointing, so none is prefilled; `OBJECT NGC7000` is only a hint), then import into `Astro-T7 captures` with Copy. While it runs, hover the running work in the status bar, move the pointer away, then move keyboard focus onto it.
- **Expect:** The middle of the bar shows the import as plain text with a mini progress bar, in place of "Idle". Cancel appears while the pointer hovers the item, disappears when the pointer leaves, and appears again when the item has keyboard focus.
- **Expect (negative):** Running work raises no issue, and no counter changes because of it. Cancel is not activated.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "running work as plain text with a mini progress bar and Cancel on hover/focus" · src/app/status-bar.tsx OperationItem · HARNESS-V5-FEEDBACK-R1.md §Round 6 P-IMP2 · J31/S6

### S8 — Retry interrupted work {#S8}

- **Do:** Once at least 4 items have been copied and verified, quit PlateVault and read the confirmation. Cancel it, then quit again and confirm. Launch PlateVault again. Open the ⚠ counter, follow the import's interrupted issue (Activity), and choose Retry.
- **Expect:** While the import runs, quitting first asks for confirmation. Cancelling it leaves PlateVault open with the import still shown as running work; confirming quits. After relaunch, ⚠ reads 4 and the hub's Work group lists the import as interrupted. Activity shows the import as Interrupted with "PlateVault restarted while this was running. Recorded progress is kept; Retry resumes it."
  - After Retry, the import runs from its recorded progress, shows again as running work, and finishes with 12 lights imported.
  - ⚠ returns to 3 and the Work group is gone.
  - Sessions lists a new `4 Oct` Ha session of 12 frames with its Target NGC 7000 confirmed. The hub still reads `2 need a Target`, equal to the number of sessions under the Sessions filter Needs a Target.
- **Expect (negative):** PlateVault does not quit while the import runs without that confirmation. No verified item is copied a second time, and every `Card-2` file still matches P7. The imported session is not listed under Needs a Target.
- **Trace:** src/store/operations.ts interruptRunningOperations, resumeOperation · messages op_interrupted_summary · src/domain/issues.ts work-interrupted · D-W11 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Quit asks while an import, index or prepare runs", P-IMP2 · J31/S10

### S9 — See the automatic duplicate scan {#S9}

- **Do:** After the import finishes, read the status bar, then open Activity.
- **Expect:** A duplicate scan runs as background work in the middle of the bar after the import. Activity records that scan after the import with an outcome of no duplicates. The bar then reads "Idle".
- **Expect (negative):** The scan raises no duplicates issue and moves, renames or writes no file. `Card-2`, still connected and now holding 12 sources byte-identical to the imported lights, is not part of the scan: no duplicate copy is counted and no `Card-2` path is listed.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates "Duplicates are scanned automatically after each index and import, as a background operation" · src/store/actions/storage.ts duplicate-scan · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Capture cards never raise the duplicates warning"

### S10 — Cancel running work by keyboard {#S10}

- **Do:** In Settings › Locations, start Rescan on `Astro-T7 captures`. While it runs, move keyboard focus onto it in the status bar and activate Cancel.
- **Expect:** The rescan stops, and Activity records it as Canceled. The middle of the bar reads "Idle", and keyboard focus moves to the bell.
- **Expect (negative):** Canceling removes no session and changes no file.
- **Trace:** HARNESS-V5-IA.md §Round 2b "cancelling moves focus to the next operation, else to the notifications trigger" · messages setup_footer_canceled, location_rescan · src/store/operations.ts cancelOperation

### S11 — Raise and follow the duplicates issue {#S11}

- **Do:** Register `Spare/Captures` as a Captures location (Add existing library folder) and let it index. Read the status bar and the ⚠ popout, then follow the duplicates issue.
- **Expect:** The left of the bar reads `4 of 4 online`. After the index, a duplicate scan runs on its own. Then:
  - ⚠ reads 4, and the Issues button reads 8.
  - The hub and the ⚠ popout list `2 duplicate copies · 104 MB`.
  - Following it opens the Duplicates review with 2 groups, M-1 and M-2. Each group has two copies, and the `Astro-T7 captures` copy, in the earlier-registered location, is preselected as the keeper.

  J39 continues the clean-up from here.
- **Expect (negative):** Neither the index, the scan nor opening the review moves, trashes or writes a file. Sessions still lists `4 Oct M 33` with the same frame count. The 12 `Card-2` sources, still connected, are not counted: the issue does not read 14 copies, and no group lists a `Card-2` path.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates (⚠ issue "N duplicate copies · 2.1 GB" opening the Duplicates review) · HARNESS-V5-FEEDBACK-R1.md §Round 6 "registered library locations only … the copy in the earliest-registered location" · J39

### S12 — Read and clear the notification history {#S12}

- **Do:** Read the bell, then open the notification history. Follow the import's entry. Open the history again and follow its Activity link.
- **Expect:**
  - Before opening, the bell shows an unread count equal to the number of history entries added since S1.
  - The history lists the latest entries newest first, including one that reads `… finished · 12 frames` for the import and the canceled rescan.
  - Opening the history removes the unread count.
  - The import's entry opens the surface that owns its outcome. The Activity link opens Activity, which lists the same events.
- **Expect (negative):** Opening the history or following an entry changes no counter and no catalog record.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "the bell with the unread count, opening the notification history" · HARNESS-V5-IA.md §Round 2b "history trigger with the unread count (latest 12, each linked to its surface, plus Activity). Opening the history marks every notification read" · src/store/notifications.ts

### S13 — Confirm nothing changed outside the actions {#S13}

- **Do:** Outside PlateVault, recompute the P7 manifests.
- **Expect:** `Cold-1`, `Card-2` and `Spare` match P7. On `Astro-T7`, the only new files are the 12 imported `Card-2` lights, each with its source's SHA-256, filed at once under the Target confirmed in S7: `Astro-T7/Captures/NGC 7000/Ha/2026-10-04/light/` (the default Lights template). Every other file matches P7.
- **Expect (negative):** No file was moved, trashed or deleted. No imported light sits in an Unclassified folder.
- **Trace:** specs/071-storage-custody/spec.md · D-W11

### S14 — Read a bar with no issues {#S14}

- **Do:** Quit PlateVault and launch it on catalog B (P6). Read the status bar and open the Issues button.
- **Expect:** The right of the bar shows only a muted ✓ before the bell. The Issues button shows no count badge, and the hub reads "No issues". The left of the bar reads `1 of 1 online`.
- **Expect (negative):** No counter shows 0, and there are no pills or "0 issues" text.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "With no issues: a muted ✓ and nothing else" · messages issues_none

## Success criteria

- SC1: At S1, S5, S8, S11 and S14 the counters add up to the Issues button's count: 1 + 3 + 3 = 7, then 1 + 4 + 3 = 8, then 7, 8 and 0. In S2 every one of the 7 hub issues appears in exactly one popout. In S5a and S5b they add up to the button's count at every reading: 5, 6, 7, then 7, 7, 8 and 7.
- SC2: Each issue's action opens its owner in one step: the run at Prepare (S3), the Calibration library, the run's Calibrate step and the Sessions filter (S4), Settings › Locations (S5), Activity with Retry (S8) and the Duplicates review (S11).
- SC3: The offline issue appears within one status-bar update of the eject and clears on remount with 0 user actions (S5). The interrupted issue clears when Retry finishes, and the import ends with exactly 12 lights imported and 0 copied twice (S8).
- SC4: Running work shows instead of "Idle" while an operation runs (S7, S9, S10). Cancel is visible on hover and on focus only, and after Cancel focus lands on the bell (S10).
- SC5: The duplicates issue reads exactly `2 duplicate copies · 104 MB`, and its review lists 2 groups (S11).
- SC6: 0 files are moved, trashed or deleted, and the only new files are the 12 imported lights (S13).
- SC7: Exactly 5 of the 7 issues have an × (S5a). Dismissing 2 lowers the button from 7 to 5, and Restore and Restore all return it to 7 with 0 runs, master offers, calibration processes or files changed (S5a). The dismissed offline issue returns on the next eject with 0 user actions on the dismissed entry (S5b).

## Known gaps

- G1: Not validated. Behavior follows the harness v5 design: HARNESS-V5-FEEDBACK-R1.md §Shell and navigation 1, §Round 1b, §Round 2c and §Round 5 P-SB3, and HARNESS-V5-IA.md §Round 2b (apps/prototype/design/ on ui-harness-v5 @ b5e813a5). The prototype at b5e813a5 still shows P-SB2 pills and inline notifications, and P-SB3 and the duplicates issue are Round 5 work in progress. The Round 6 decisions S7 to S13 assert (HARNESS-V5-FEEDBACK-R1.md §Round 6 at ui-harness-v5 @ 4f470775: Targets confirmed in the Import preview, Quit asks, library-only duplicate scan) are not yet in the prototype, nor is the Round 8 P-ISS1 dismissal that S5a and S5b assert. No implementation has been validated against this journey.
- G2: Unresolved implementation qualification: P1 and P6 need seeded catalogs in a known state, including a pending master offer, a raw flat session awaiting Stack and a drifted frame. No fixture builder exists. Blocks readiness.
- G3: Unresolved implementation qualification: S8 needs the import interrupted at a known point, and S10 needs a rescan that runs long enough to focus. No pacing or fault fixture exists. Blocks readiness.
- G4: Out of scope for this journey: failed work (`… failed`, ⛔, from an operation that fails) and an unreadable location (`… unreadable`, ⛔, Fix). Both need fault injection. A failed calibration process belongs to the calibration process journey, and an adopted master that changed belongs to J26. Blocks readiness until covered by a step or a journey.
- G5: Out of scope for this journey: the bar at narrow widths, when running work overflows into `+N more running`, and in other languages.
- G6: Not asserted: the Issues hub group that lists the duplicates issue. The v5 design does not state it, so S11 asserts only the issue's text, its severity and its action.

## Delta log

- **Δ2** 2026-10-12 · S7, S8, S9, S11, S13 · behavior-change
  The Card-2 session's Target is confirmed in the Import preview, so the import files its lights under `NGC 7000/` at once and adds nothing to Needs a Target. Quitting during the import asks first.
  The duplicate scan covers registered library locations only: the connected Card-2 sources raise no duplicates; the keeper is the copy in the earlier-registered location.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "P-IMP2: confirm Targets in the Import preview", "Quit asks", "The duplicate scan covers registered library locations only" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6G (intent-gated)
- **Δ3** 2026-10-12 · +S5a, +S5b · behavior-change
  P-ISS1: each issue has an × (Dismiss) except a run's next step (`run-blocked`, `calibration-review`). Dismissed issues leave the counters and badge and sit under `Dismissed (N)` with Restore and Restore all, and an offline drive that goes offline again brings its issue back.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 8 (user, 2026-10-12) P-ISS1 (apps/prototype/design/ on ui-harness-v5) · by: R8JourneysDocs (intent-gated)
