---
id: J38
title: Handle issues from the status bar and on their rows
version: 7
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [issues, status-bar, shell, home, sessions, projects, view, output, calibration, calibration-process, locations, import, indexing, activity, duplicates]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#shell-and-navigation-foundation, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions-user-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-2c-user-2026-10-10, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-8-user-2026-10-12, P-SB3, P-ISS1, P-STO2, P-CAL2, P-CAL3, HARNESS-V5-IA.md#round-2b-foundation-status-bar-and-p-cal3-2026-10-09, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S17, apps/prototype/src/domain/issues.ts, apps/prototype/src/app/issues-hub.tsx, apps/prototype/src/app/status-bar.tsx, apps/prototype/src/store/issues.ts, apps/prototype/src/store/notifications.ts, apps/prototype/src/store/operations.ts, apps/prototype/messages/en-GB.json, D-W11, D-W24, D-W74, specs/064-library-inventory/spec.md, specs/071-storage-custody/spec.md, D-W92, specs/063-clean-rebuild-contract/spec.md#FR-032, specs/064-library-inventory/spec.md#LIB-FR-17, specs/064-library-inventory/spec.md#LIB-FR-23, specs/065-project-goals/spec.md#PRJ-FR-17, specs/065-project-goals/spec.md#PRJ-FR-18, specs/068-calibration-inputs/spec.md#CAL-FR-06, specs/070-results-reuse/spec.md#RES-FR-11, D-W94, D-W98, D-W100, D-W101, D-W105]
---

## Goal

The user keeps an eye on what needs attention without leaving their work. Each
issue shows on the row it affects, with one action that leads to where it can be
fixed, and the status bar's severity counters count the same issues. There is no
Issues hub (D-W92). The bottom bar
also shows which locations are online, how many rows are selected, what work is
running, and the notifications history. Done means:

- At every step the ⛔, ⚠ and ℹ counters add up to the issues shown on their rows and not dismissed. A counter shows a count only: it opens the owning page filtered to the affected rows, or a menu of those pages when there are several.
- Following an issue's action opens the place that owns it: the location, the Project's View step after a failed Apply, the Calibration library, a session or the Project's Output step.
- An offline drive, interrupted work and a duplicates result raise their issue. Reconnecting the drive and retrying the work clear it without any other action.
- Running work shows with its progress, and "Idle" shows when nothing runs. Cancel appears on hover or keyboard focus.
- With no issues the bar shows only a muted ✓. A counter never reads 0.
- Dismissing an issue (×) on its row hides it from the counts until it changes, and leaves the state behind it unchanged. Show dismissed on the owning page lists it with Restore. Every issue has a row-level Dismiss action.
- Choosing a counter or opening the notification history changes no file, catalog record or Project.

## Preconditions

- P1: A development catalog seeded to the J32/P1 to J32/P4 state. `M 31 OSC` has a failed Apply shown on its Project's View step. Sessions `3 Oct` and `5 Oct` have no confirmed Target, `4 Oct M 33` is Ready with settled calibration and is not in a Project, and `1 Oct Ha` waits in Needs calibration. The seed adds the following (G2):
  - `1 Oct Ha` is a Ready session whose calibration is unsettled; it appears in Home's Needs calibration queue and as a suggestion to `IC 1396 Ha`.
  - The `M 31 OSC` Project's Output step has exactly 1 pending master offer from `Processing/`, with Add to calibration library and Hide actions.
  - One raw calibration session, 10 Ha flats of 2 Oct on rig `RedCat`, awaits Stack in the Calibration library. No calibration process has failed.
  - One Usable `1 Oct Ha` frame, F-drift, had its bytes replaced in place by a same-size file with different pixel bytes after review, as in J22/P5. PlateVault has read the change, and F-drift reads Changed content.
  - Nothing else needs attention. No operation is running, failed or interrupted, no adopted master has changed, and no frame has a byte-identical second copy.
- P2: Exactly three locations are registered, `Astro-T7 captures`, `Cold-1 captures` and `Astro-T7/Calibration`, and all three are online. `Cold-1` can be ejected and mounted again.
- P3: The notification history was opened once before S1, so no notification is unread.
- P4: Removable volume `Card-2` is as in J31/P4: 12 NGC 7000 Ha 300 s `RedCat` lights from the night of 2026-10-04, with OBJECT `NGC7000` and no pointing. It has not been imported, and none of its files is byte-identical to a library file.
- P5: Volume `Spare` is mounted, has an OS Trash and is not registered. `Spare/Captures/` holds byte-identical copies of two `4 Oct M 33` lights, M-1 and M-2. Each file is 52,191,360 bytes.
- P6: A second development catalog, catalog B, holds only the Closed Project `Pleiades 2025`. Its sessions have confirmed Targets and remain held by that Project. Its one registered location, `Astro-T7 captures`, is online, and nothing else needs attention (G2).
- P7: Manifests (relative path, size, SHA-256) of every file on `Astro-T7`, `Cold-1`, `Card-2` and `Spare`, recorded outside PlateVault before S1.

## Steps

### S1 — Read the bar and the affected rows at rest {#S1}

- **Do:** Launch PlateVault on the P1 catalog. Read the status bar, then open each page that lists an affected row: Home, Sessions, the two Projects, the Calibration library and the `1 Oct Ha` session.
- **Expect:** The status bar reads, left to right:
  - `3 of 3 online`, with no selection count.
  - "Idle" in the middle.
  - ⛔ 1, ⚠ 3 and ℹ 3 on the right, then the bell with no unread count.

  The 7 issues show on the rows they affect, each with its action:
  - Sessions: `2 need a Target` (Assign) on Home's Pending work and the Needs a Target rows, and `1 not in a Project` (Add) on the `4 Oct M 33` row.
  - Projects: `M 31 OSC` Apply failed (Open View) on its Project row and in Home's Open work.
  - Sessions and calibration: `1 needs calibration` (Choose flats) on `1 Oct Ha` in Sessions' Needs calibration queue and Home's Pending work; `1 to stack` (Stack) on the 2 Oct Ha flat process row in the Calibration library.
  - Output: `M 31 OSC`'s `1 master offered` (Add to calibration library) on its Project's Output step and Open work.
  - Drift: `1 changed` (Review) on the `1 Oct Ha` session row, and Changed content on the F-drift frame row.
- **Expect (negative):** The toolbar has no Issues button and the app has no Issues hub. Home has no alerts list. The status bar shows no pills and no inline notification. Opening these pages changes no catalog or Project record and no file.
- **Trace:** PRJ-FR-17 · D-W89, D-W92, D-W94, D-W105 · 063 FR-032, FR-038 · 064 LIB-FR-17, LIB-FR-23 · 065 PRJ-FR-17, PRJ-FR-18 · 070 RES-FR-11

### S2 — Open each severity counter {#S2}

- **Do:** Choose the ⛔ counter, then the ⚠ counter, then the ℹ counter, going back after each.
- **Expect:** No counter opens a list of issues. A counter whose issues all have one owning page opens it filtered to the affected rows; a counter whose issues have several owners opens a menu naming each page with its count, and each entry opens that page filtered:
  - ⛔ opens `M 31 OSC` filtered to its Project row; its View step shows the failed Apply.
  - ⚠ offers `Sessions · 3` (the two sessions that need a Target, `1 Oct Ha` needing calibration and its drift issue).
  - ℹ offers `Sessions · 1` (`4 Oct M 33`, not in a Project), `M 31 OSC · 1` (`1 master offered`) and `Calibration · 1` (`1 to stack`).

  Together the filtered pages show the 7 issues of S1, each exactly once. The `1 Oct Ha` row carries separate Needs calibration and drift issues; following the drift row's Review opens the session, where F-drift reads Changed content.
- **Expect (negative):** No counter or menu lists an issue's text, and no filtered page shows a row with no issue. Choosing a counter changes nothing.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 · D-W92 (counts only, each opening the owning page filtered; owner's answer of 2026-10-14, F7) · src/domain/issues.ts severities · D-W144, D-W158 · 063 FR-032, FR-038

### S3 — Follow the failed Apply issue {#S3}

- **Do:** From the ⛔ counter's filtered `M 31 OSC` page, follow the failed Apply issue (Open View) on the Project row.
- **Expect:** `M 31 OSC` opens at its View step. The failed Apply and its refusal reason are shown on the Project. The ⛔ 1 counter is still shown.
- **Expect (negative):** Opening the Project does not retry Apply or change Project state. The issue stays until Apply succeeds.
- **Trace:** PRJ-FR-17, PRJ-FR-18 · D-W92, D-W94, D-W100 · 063 FR-032

### S4 — Follow the informational issues {#S4}

- **Do:** From the ℹ counter's menu, open `Calibration · 1` and follow `1 to stack` (Stack) on its row. From the menu again, open `M 31 OSC · 1` and follow `1 master offered` on the Project's Output step. Finally open `Sessions · 1` and follow `1 not in a Project` (Add) on `4 Oct M 33`.
- **Expect:**
  - Stack opens the 2 Oct Ha flat process, listed as awaiting Stack.
  - The offer opens `M 31 OSC` at its Output step, with the one pending master offer, Add to calibration library and Hide actions.
  - `Sessions · 1` opens Sessions filtered to `4 Oct M 33`, and Add offers Create Project and Add to Project.

  ℹ still reads 3.
- **Expect (negative):** Following an issue starts no stack, adopts or hides no master, and adds no session to a Project.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3, §Round 1 P-CAL2 · D-W92 · src/domain/issues.ts master-offer, not-in-project · 063 FR-032

### S5 — Take a drive offline and reconnect it {#S5}

- **Do:** Eject `Cold-1`. Read the status bar, then choose the ⚠ counter and open `Settings › Locations · 1` from its menu. Then mount `Cold-1` again.
- **Expect:** After the eject:
  - The left of the bar reads `2 of 3 online` and ⚠ reads 4.
  - The ⚠ menu adds `Settings › Locations · 1`.
  - It opens Settings › Locations filtered to the `Cold-1 captures` row, which reads Offline.

  After mounting, the bar reads `3 of 3 online` and ⚠ reads 3, and the row no longer shows the issue, with no action from the user.
- **Expect (negative):** No `12 Sep` frame reads Missing, and no session is removed. No other issue appears or disappears.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "Left: locations online" · HARNESS-V5-IA.md §Round 2b "locations online (links to Settings › Locations)" · src/domain/issues.ts location-offline · J19/S15 · 063 FR-032, FR-038 · 064 LIB-FR-07, LIB-AC-44 · D-W144, D-W158

### S5a — Dismiss two issues on their rows and restore them {#S5a}

- **Do:** On the affected rows, read which issues have an ×. Dismiss `1 to stack` on the 2 Oct Ha flat process row and `1 master offered` on `M 31 OSC`'s Output row. Read the counters. Then turn on **Show dismissed** on the Calibration library, choose Restore on the flat process row, and do the same on the Project's Output step.
- **Expect:**
  - Every issue has an × with the tooltip "Dismiss".
  - After both dismissals, ℹ reads 1, while ⛔ 1 and ⚠ 3 are unchanged, and the ℹ counter opens Sessions filtered to `4 Oct M 33` directly.
  - The rows keep their state: the 2 Oct Ha flat process still awaits Stack, and `M 31 OSC`'s Output step still shows its pending master offer with Add to calibration library and Hide actions.
  - With Show dismissed on, each page lists its dismissed issue on its row with **Restore**. After the first Restore ℹ reads 2, and after the second it reads 3.
- **Expect (negative):** Dismissing or restoring an issue starts no stack, hides no master offer, and changes no Project, calibration process or file. No counter counts a dismissed issue, and no counter reads 0.
- **Trace:** D-W92 · 063 FR-032 · 064 LIB-AC-44 · PRJ-FR-17 · CAL-FR-06 · RES-FR-11 (Dismiss and Restore act on rows; counters count undismissed issues).

### S5b — A dismissed issue returns when it changes {#S5b}

- **Do:** Eject `Cold-1`, then dismiss `Cold-1 captures offline` on its row in Settings › Locations. Read the bar and the row. Mount `Cold-1`, eject it again and read the row and the ⚠ counter. Then mount `Cold-1` again.
- **Expect:**
  - After the dismissal, ⚠ reads 3. The left of the bar still reads `2 of 3 online`, and the `Cold-1 captures` row in Settings › Locations still reads Offline.
  - After the mount, the bar reads `3 of 3 online` and ⚠ reads 3.
  - After the second eject, the `Cold-1 captures` row shows `Cold-1 captures offline` again with its ×, and ⚠ reads 4.
  - After the final mount, the bar reads `3 of 3 online` and ⚠ reads 3.
- **Expect (negative):** Dismissing the issue marks no location online. No `12 Sep` frame reads Missing, and no session is removed.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 8 P-ISS1 ("A dismissed issue stays hidden until it changes … a location going offline again brings it back", "its page still shows it") · D-W92 · src/domain/issues.ts location-offline · 063 FR-032 · 064 LIB-AC-44 · D-W158

### S6 — Read the selection count {#S6}

- **Do:** Open Project `NGC 7000 HOO` and, in **Add sessions…** on its Sessions step, select the `12 Sep` and `24 Sep` sessions. Then clear the selection.
- **Expect:** While the two sessions are selected, the left of the status bar reads `2 selected` after the locations. After clearing, the selection count is gone.
- **Expect (negative):** Selecting starts no operation and changes no counter.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "then the selection count when a list has a selection" · src/app/status-selection.ts · 063 FR-038

### S7 — Watch an import {#S7}

- **Do:** Open Import on `Card-2`. In the preview, choose NGC 7000 as the `4 Oct` Ha session's Target (its lights carry no pointing, so none is prefilled; `OBJECT NGC7000` is only a hint), then import into `Astro-T7 captures` with Copy. While it runs, hover the running work in the status bar, move the pointer away, then move keyboard focus onto it.
- **Expect:** The middle of the bar shows the import as plain text with a mini progress bar, in place of "Idle". Cancel appears while the pointer hovers the item, disappears when the pointer leaves, and appears again when the item has keyboard focus.
- **Expect (negative):** Running work raises no issue, and no counter changes because of it. Cancel is not activated.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "running work as plain text with a mini progress bar and Cancel on hover/focus" · src/app/status-bar.tsx OperationItem · HARNESS-V5-FEEDBACK-R1.md §Round 6 P-IMP2 · J31/S6 · 063 FR-038

### S8 — Retry interrupted work {#S8}

- **Do:** Once at least 4 items have been copied and verified, quit PlateVault and read the confirmation. Cancel it, then quit again and confirm. Launch PlateVault again. Choose the ⚠ counter and open `Activity · 1` from its menu, which opens Activity filtered to the interrupted import, and choose Retry.
- **Expect:** While the import runs, quitting first asks for confirmation. Cancelling it leaves PlateVault open with the import still shown as running work; confirming quits. After relaunch, ⚠ reads 4, and the import's row in Activity reads interrupted. Activity shows the import as Interrupted with "Interrupted when PlateVault restarted. Retry continues from the recorded progress."
  - After Retry, the import resumes from its recorded progress, shows again as running work, and finishes with 12 lights imported.
  - ⚠ returns to 3, and no row shows the interrupted issue.
  - Sessions lists a new `4 Oct` Ha session of 12 frames with its Target NGC 7000 confirmed. Home's Pending work still reads `2 need a Target`, equal to the number of sessions under the Sessions filter Needs a Target.
- **Expect (negative):** PlateVault does not quit while the import runs without that confirmation. No verified item is copied a second time, and every `Card-2` file still matches P7. The imported session is not listed under Needs a Target.
- **Trace:** src/store/operations.ts interruptRunningOperations, resumeOperation · messages op_interrupted_summary · src/domain/issues.ts work-interrupted · D-W11 · HARNESS-V5-FEEDBACK-R1.md §Round 6 P-IMP2 · J31/S10 · 063 FR-032, FR-038, FR-039 · 064 LIB-FR-17 · 071 STO-IMP-FR-06 · D-W149

### S9 — See the automatic duplicate scan {#S9}

- **Do:** After the import finishes, read the status bar, then open Activity.
- **Expect:** A duplicate scan starts as background work in the middle of the bar after the import. Activity records that scan after the import with an outcome of no duplicates. The bar then reads "Idle".
- **Expect (negative):** The scan raises no duplicates issue and moves, renames or writes no file. `Card-2`, still connected and now holding 12 sources byte-identical to the imported lights, is not part of the scan: no duplicate copy is counted and no `Card-2` path is listed.
- **Trace:** src/store/actions/storage.ts duplicate-scan · HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Capture cards never raise the duplicates warning" · 063 FR-038 · 064 LIB-AC-43 · D-W164

### S10 — Cancel running work by keyboard {#S10}

- **Do:** In Settings › Locations, start Rescan on `Astro-T7 captures`. While it runs, move keyboard focus onto it in the status bar and activate Cancel.
- **Expect:** The rescan stops, and Activity records it as Canceled. The middle of the bar reads "Idle", and keyboard focus moves to the bell.
- **Expect (negative):** Canceling removes no session and changes no file.
- **Trace:** HARNESS-V5-IA.md §Round 2b "cancelling moves focus to the next operation, else to the notifications trigger" · messages setup_footer_canceled, location_rescan · src/store/operations.ts cancelOperation · 063 FR-037, FR-038 · D-W121, D-W150, D-W162

### S11 — Raise and follow the duplicates issue {#S11}

- **Do:** Register `Spare/Captures` as a Captures location (Add existing library folder) and let it index. Read the status bar, then choose the ⚠ counter's `Sessions · 3` entry, which opens Sessions filtered to the affected rows, and choose the Duplicates badge on `4 Oct M 33`.
- **Expect:** The left of the bar reads `4 of 4 online`. After the index, a duplicate scan runs on its own. Then:
  - ⚠ reads 4.
  - Sessions, filtered to the affected rows, lists `4 Oct M 33` with the badge `2 copies · 104 MB` (LIB-FR-22).
  - Following it opens the Duplicates review with 2 groups, M-1 and M-2. Each group has two copies, one in `Astro-T7 captures` and one in `Spare captures`. The review names no keeper and offers no removal (LIB-FR-22); the Project's Wrap up names the kept copy (J39/S3).

  J39 continues the clean-up from here, with each duplicates issue on its session row and a row-level Dismiss.
- **Expect (negative):** Neither the index, the scan nor opening the review moves, trashes or writes a file. Sessions still lists `4 Oct M 33` with the same frame count. The 12 `Card-2` sources, still connected, are not counted: the issue does not read 14 copies, and no group lists a `Card-2` path.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Storage and duplicates (⚠ issue "N duplicate copies · 2.1 GB" opening the Duplicates review) · HARNESS-V5-FEEDBACK-R1.md §Round 6 "registered library locations only … the copy in the earliest-registered location" · J39 · 063 FR-032 · 064 LIB-FR-22 · 065 PRJ-FR-15 · 071 STO-FR-16

### S12 — Read and clear the notification history {#S12}

- **Do:** Read the bell, then open the notification history. Follow the import's entry. Open the history again and follow its Activity link.
- **Expect:**
  - Before opening, the bell shows an unread count equal to the number of history entries added since S1.
  - The history lists the latest entries newest first, including one that reads `… finished · 12 frames` for the import and the canceled rescan.
  - Opening the history removes the unread count.
  - The import's entry opens the surface that owns its outcome. The Activity link opens Activity, which lists the same events.
- **Expect (negative):** Opening the history or following an entry changes no counter and no catalog record.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "the bell with the unread count, opening the notification history" · HARNESS-V5-IA.md §Round 2b "history trigger with the unread count (latest 12, each linked to its surface, plus Activity). Opening the history marks every notification read" · src/store/notifications.ts · 063 FR-038 · D-W92, D-W150

### S13 — Confirm nothing changed outside the actions {#S13}

- **Do:** Outside PlateVault, recompute the P7 manifests.
- **Expect:** `Cold-1`, `Card-2` and `Spare` match P7. On `Astro-T7`, the only new files are the 12 imported `Card-2` lights, each with its source's SHA-256, filed at once under the Target confirmed in S7: `Astro-T7/Captures/NGC 7000/Ha/2026-10-04/light/` (the default Lights template). Every other file matches P7.
- **Expect (negative):** No file was moved, trashed or deleted. No imported light sits in an Unclassified folder.
- **Trace:** specs/071-storage-custody/spec.md · D-W11 · 063 FR-040 · 071 STO-IMP-FR-06

### S14 — Read a bar with no issues {#S14}

- **Do:** Quit PlateVault and launch it on catalog B (P6). Read the status bar, then open Home and the `Pleiades 2025` Project.
- **Expect:** The right of the bar shows only a muted ✓ before the bell. No row on Home or the Project page shows an issue, and the toolbar has no Issues button. The left of the bar reads `1 of 1 online`.
- **Expect (negative):** No counter shows 0, and there are no pills or "0 issues" text.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3 "With no issues: a muted ✓ and nothing else" · messages issues_none · 063 FR-032, FR-038

## Success criteria

- SC1: At S1, S5, S8, S11 and S14 the counters add up to the number of issues shown on rows: 1 + 3 + 3 = 7, then 1 + 4 + 3 = 8, then 7, 8 and 0. In S2 every one of the 7 issues appears on exactly one filtered page. In S5a and S5b the counters add up to the issues not dismissed at every reading: 5, 6, 7, then 7, 7, 8 and 7.
- SC2: Each issue's action opens its owner in one step: the Project's View step at the failed Apply (S3), the Calibration library, the Project's Output step and the Sessions filter (S4), Settings › Locations (S5), Activity with Retry (S8) and the Duplicates review (S11).
- SC3: The offline issue appears within one status-bar update of the eject and clears on remount with 0 user actions (S5). The interrupted issue clears when Retry finishes, and the import ends with exactly 12 lights imported and 0 copied twice (S8).
- SC4: Running work shows instead of "Idle" while an operation runs (S7, S9, S10). Cancel is visible on hover and on focus only, and after Cancel focus lands on the bell (S10).
- SC5: The duplicates badge reads exactly `2 copies · 104 MB`, and its review lists 2 groups (S11).
- SC6: 0 files are moved, trashed or deleted, and the only new files are the 12 imported lights (S13).
- SC7: All 7 of the 7 issues have an × (S5a). Dismissing 2 lowers the counters' total from 7 to 5, and Restore on each row returns it to 7, with no Project, master offer, calibration process or file changed (S5a). The dismissed offline issue returns on the next eject with 0 user actions on the dismissed entry (S5b).

## Known gaps

- G1: Not validated. Behavior follows the harness v5 design: HARNESS-V5-FEEDBACK-R1.md §Shell and navigation 1, §Round 1b, §Round 2c and §Round 5 P-SB3, and HARNESS-V5-IA.md §Round 2b (apps/prototype/design/ on ui-harness-v5 @ b5e813a5). The prototype at b5e813a5 still shows P-SB2 pills and inline notifications, and P-SB3 and the duplicates issue are Round 5 work in progress. The Round 6 decisions S7 to S13 assert (HARNESS-V5-FEEDBACK-R1.md §Round 6 at ui-harness-v5 @ 4f470775: Targets confirmed in the Import preview, Quit asks, library-only duplicate scan) are not yet in the prototype, nor is the Round 8 P-ISS1 dismissal that S5a and S5b assert. No implementation has been validated against this journey.
- G2: Unresolved implementation qualification: P1 and P6 need seeded catalogs in a known state, including a Project Output master offer, a raw flat session awaiting Stack, a Ready session in Needs calibration and a drifted frame. No fixture builder exists. Blocks readiness.
- G3: Unresolved implementation qualification: S8 needs the import interrupted at a known point, and S10 needs a rescan that runs long enough to focus. No pacing or fault fixture exists. Blocks readiness.
- G4: Out of scope for this journey: failed work (`… failed`, ⛔, from an operation that fails) and an unreadable location (`… unreadable`, ⛔, Fix). Both need fault injection. A failed calibration process belongs to the calibration process journey, and an adopted master that changed belongs to J26. Blocks readiness until covered by a step or a journey.
- G5: Out of scope for this journey: the bar at narrow widths, when running work overflows into `+N more running`, and in other languages.
- G6: (dissolved 2026-10-15): D-W92 removes the Issues hub, so there is no hub group to assert. The duplicates issue sits on its session row, and the ⚠ counter opens Sessions filtered to that row (S11).

## Delta log

- **Δ2** 2026-10-12 · S7, S8, S9, S11, S13 · behavior-change
  The Card-2 session's Target is confirmed in the Import preview, so the import files its lights under `NGC 7000/` at once and adds nothing to Needs a Target. Quitting during the import asks first.
  The duplicate scan covers registered library locations only: the connected Card-2 sources raise no duplicates; the keeper is the copy in the earlier-registered location.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "P-IMP2: confirm Targets in the Import preview", "Quit asks", "The duplicate scan covers registered library locations only" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6G (intent-gated)
- **Δ3** 2026-10-12 · +S5a, +S5b · behavior-change
  P-ISS1: each issue has an × (Dismiss) except a run's next step (`run-blocked`, `calibration-review`). Dismissed issues leave the counters and badge and sit under `Dismissed (N)` with Restore and Restore all, and an offline drive that goes offline again brings its issue back.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 8 (user, 2026-10-12) P-ISS1 (apps/prototype/design/ on ui-harness-v5) · by: R8JourneysDocs (intent-gated)
- **Δ4** 2026-10-14 · S1, S2, S3, S4, S5, S5a, S5b, S8, S11, S14 · behavior-change
  No Issues hub and no toolbar Issues button: each issue shows on the row it affects. The ⛔ ⚠ ℹ counters show counts only and open the owning page filtered to the affected rows, or a menu of those pages, with no list of issues. Dismiss and Restore live on the rows, with Show dismissed on the owning page.
  Evidence: owner's answers of 2026-10-14 (Q12, F7), D-W92 and 063 FR-032 in PR #1804 · by: SpecAmendmentsR9 (intent-gated)
- **Δ5** 2026-10-15 · S1, S2, S3, S4, S5a, S6, S7, S8, S9, S11, S14 · behavior-change
  Issues now sit on F4 Project, session and Output rows: a failed Apply, a session in Needs calibration and a master offer on the Project's Output step replace run-row examples. The counter arithmetic remains 1 + 3 + 3 = 7 at S1; dismissal counts reflect row-level actions. S11's Duplicates review names no keeper, because the Project's Wrap up names the kept copy (J39/S3), and G6 is dissolved with the Issues hub.
  Evidence: D-W92, D-W93 to D-W106 in PR #1804, 063 FR-032, 064 LIB-FR-17/LIB-FR-22/LIB-FR-23, 065 PRJ-FR-15/PRJ-FR-17/PRJ-FR-18, 068 CAL-FR-06, 070 RES-FR-11 · by: SpecF4Writer2 (intent-gated)
- **Δ6** 2026-10-26 · S8 · behavior-change
  Work a restart interrupted reads "Interrupted when PlateVault restarted. Retry continues from the recorded progress."
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 11 (OWNER, 2026-10-23) on ui-harness-v5 @ 5dc245244; D-W149 · by: SpecAmend (intent-gated)
- **Δ7** 2026-10-28 · S1, S2, S3, S4, S5a, S5b, S7, S8, S9, S10, S11, S12, S13, S14 · trace-only
  Steps now also cite their owning FR/AC: status-bar groups (063 FR-038), row-level issues (063 FR-032), dismissal and recurrence (064 LIB-AC-44) and the automatic duplicate scan (064 LIB-AC-43). No step's behaviour changes.
  Evidence: 063 FR-032, FR-037 to FR-040 · 064 LIB-FR-07, LIB-FR-17, LIB-FR-22, LIB-AC-43, LIB-AC-44 · 065 PRJ-FR-15 · 071 STO-FR-16, STO-IMP-FR-06 · D-W144, D-W149, D-W150, D-W158, D-W164 · astro-plan-0v2o0.2, astro-plan-ocyuc.5 · by: omp-lead-20261004 (intent-gated)
