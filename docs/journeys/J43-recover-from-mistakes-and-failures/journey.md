---
id: J43
title: Recover from routine mistakes and failures: retry interrupted work, change a wrong Target, act on a refusal, undo marks and discard a draft
version: 2
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [locations, indexing, status-bar, issues, home, activity, sessions, targets, projects, view-review, frame-review, project-trash, duplicates]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S8, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#round-2-foundation, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, P-SB3, D-W33, D-W37, D-W42, D-W54, D-W72, D09, apps/prototype/src/store/operations.ts, apps/prototype/src/components/app/refusal.tsx, apps/prototype/src/components/app/operation-panel.tsx, apps/prototype/src/domain/issues.ts, apps/prototype/src/domain/derive.ts, apps/prototype/src/store/actions/library.ts, apps/prototype/src/store/actions/runs.ts, apps/prototype/src/features/v5/a-home/parts.tsx, apps/prototype/messages/en-GB.json, ui-harness-v5@b5e813a5, HIGH-LEVEL-DESIGN.md#10, docs/journeys/J11-mistake-recovery/journey.md, docs/journeys/J12-failure-refusal-handling/journey.md]
---

## Goal

The user makes the everyday mistakes and meets the everyday failures of a library: they quit PlateVault in the middle of a rescan, past the confirmation that quitting asks while work runs, they confirm a session to the wrong Target because its OBJECT header said so, an action is refused while other work runs, and they mark frames by accident or start a Review draft they do not want. They need each one to be visible where they look, reversible with one action, and free of side effects. Done means:

- Quitting during the rescan asks first, and canceling the prompt keeps the rescan running. The interrupted rescan is found in the status bar, Home's Work box and Activity, resumes with Retry, and indexes the new night exactly once.
- The wrongly confirmed session shows a mismatch warning, is re-confirmed to the right Target, which clears the warning, and Project candidates follow both times, without changing any file header or run membership.
- A refused Move to Trash reads as one terse line with its blocker in a disclosure; after the blocker is cleared the retry succeeds, and Restore brings the run back as it was.
- Mistaken library marks are undone with U, and an unsaved Review draft is discarded back to the saved revision.
- No recovery action deletes, moves or rewrites a file.

Recoveries that other journeys own end to end are referenced, not repeated (G5).

## Preconditions

- P1: Fresh replay of J19, J20 and J21: run `NGC7000-HOO-Siril` of Project `NGC 7000 HOO` (subject NGC 7000, rig `RedCat`) holds saved membership revision 1, "Saved r1", of 214 lights in the five sessions, all Unreviewed, with no measurement cached (as J22/P1), and stands at Review.
- P2: The open Project `IC 1396 Ha` (subject IC 1396, rig `RedCat`), created through New Project as in J20, has no runs and no candidates.
- P3: After J21, outside PlateVault, `Astro-T7/Captures/2026-10-06/` was added with 10 Ha 300 s `RedCat` lights from the night of 6 Oct. Their OBJECT is `IC 1396` (the capture application's label), and their pointing lies within NGC 7000's footprint and outside IC 1396's. PlateVault has not indexed the folder.
- P4: The J19/P5 manifest, extended with the 6 Oct folder, and the catalog's session list with the frame count of each session, recorded outside PlateVault before S1.
- P5: Two named 30 Sep frames, F-a and F-b, and three named 26 Sep frames, F-c, F-d and F-e, all members of `NGC7000-HOO-Siril`.

## Steps

### S1 — Rescan and quit mid-way {#S1}

- **Do:** In Settings › Locations, choose **Rescan** on `Astro-T7 captures`. While it runs, quit PlateVault and read the prompt. Cancel the prompt and read the status bar and Home's Work box. Quit again and confirm quitting.
- **Expect:** While the rescan runs, the status bar's middle shows it as plain text with a mini progress bar, and Cancel appears on hover or focus. Home's Work box lists it with its progress, Pause and Cancel. Quitting opens a confirmation that names the running rescan, `Indexing Astro-T7 captures`, before PlateVault closes. After the prompt is canceled, PlateVault stays open, and the rescan is still running with its progress still advancing. After quitting is confirmed, PlateVault closes.
- **Expect (negative):** Canceling the prompt neither cancels, pauses nor restarts the rescan, and closes no window. Quitting does not close PlateVault before the user confirms.
- **Trace:** Feedback §Round 5 P-SB3, §Round 6 (Quit asks while an import, index or prepare runs) · IA §Screens S1 (Work box) · operations.ts startIndexing

### S2 — Find the interrupted work after relaunch {#S2}

- **Do:** Launch PlateVault. Read the status bar, open its ⚠ warnings counter, then open Home and Activity.
- **Expect:** The status bar's middle reads "Idle". The ⚠ counter's popout lists `Indexing Astro-T7 captures interrupted`, whose action leads to Activity. Home's Work box lists the rescan as interrupted with **Retry**. Activity lists it with "PlateVault restarted while this was running. Recorded progress is kept; Retry resumes it."
- **Expect (negative):** The rescan does not restart by itself, and no ⛔ error counter appears for it.
- **Trace:** operations.ts interruptRunningOperations · issues.ts (work-interrupted, warning, link /activity) · P-SB3

### S3 — Retry and read the outcome {#S3}

- **Do:** Click **Retry** in Home's Work box and wait until it finishes. Open Sessions.
- **Expect:** The rescan resumes from its recorded progress and settles once, with one outcome in Activity. The ⚠ issue for it is gone. Sessions lists one new session, `6 Oct` (Ha, 10 frames, `RedCat`), in Needs a Target, with NGC 7000 suggested from pointing. The automatic duplicate scan after the index raises no duplicate issue.
- **Expect (negative):** No session is listed twice and no frame is counted twice: every other session's frame count equals P4, and the 10 new frames appear once. No file is written or moved.
- **Trace:** operations.ts resumeOperation ("Retry resumes from the recorded state and never infers progress from file names", D09) · Feedback §Round 5 (duplicates scanned after each index) · J19

### S4 — Confirm the wrong Target {#S4}

- **Do:** Open the `6 Oct` session. Read its Target box, then choose IC 1396 (as its OBJECT says) and click **Confirm Target**.
- **Expect:** Before confirming, the Target picker preselects NGC 7000, the Target evidence lists the pointing, and OBJECT `IC 1396` appears only as a label of the session. Confirming IC 1396 is allowed: after confirming, the Target pill reads IC 1396 as confirmed, and the session's Target box shows a mismatch warning that the session's pointing disagrees with IC 1396. The session leaves Needs a Target, and `IC 1396 Ha` lists it as a candidate (1 session, 10 frames). Activity records `Target confirmed` with "IC 1396. Catalog only; source headers unchanged."
- **Expect (negative):** OBJECT is never listed as Target evidence and never preselects IC 1396. The mismatch warning does not block or undo the confirmation. No FITS header changes and no file moves.
- **Trace:** Feedback §Round 5 Sessions (OBJECT is a label, never evidence), §Round 6 (Confirming a Target the pointing disagrees with is allowed; the Target box shows a mismatch warning) · HIGH-LEVEL-DESIGN.md §10 · library.ts confirmTarget · parts.tsx ConfirmTargetControl · D-W33, D-W37

### S5 — Change the Target and watch candidates follow {#S5}

- **Do:** In the same Target box, choose NGC 7000 and click **Confirm Target**. Open `IC 1396 Ha` and `NGC 7000 HOO`.
- **Expect:** The Target pill reads NGC 7000 as confirmed, and the mismatch warning is gone from the Target box. Activity records a second `Target confirmed` with "NGC 7000. Catalog only; source headers unchanged." `IC 1396 Ha` has no candidates again. `NGC 7000 HOO` lists `6 Oct` among its candidates as a session in no run.
- **Expect (negative):** `NGC7000-HOO-Siril` still reads "Saved r1" with 214 lights; changing a Target never adds a session to a run. No FITS header changes and no file moves, because `6 Oct` was indexed in place.
- **Trace:** library.ts confirmTarget (catalog correction) · D-W33, D-W37 · J25 (adding a new night to a run)

### S6 — Read a refusal and its blockers {#S6}

- **Do:** Open `NGC7000-HOO-Siril`'s Review and start **Measure frames**. While it runs, choose **Move to Trash** on the run, then open the refusal's disclosure (▸).
- **Expect:** The run stays where it is and a terse refusal reads "Move to Trash blocked · 1 blocker". Its disclosure lists one chip, "Measure frames is running". Activity records the refusal with that reason.
- **Expect (negative):** The run is not trashed, measuring continues, and nothing else is written.
- **Trace:** Feedback §Copy rules (terse refusals) · refusal.tsx · derive.ts trashRefusals · runs.ts trashRun

### S7 — Clear the blocker, retry, then restore {#S7}

- **Do:** Hover or focus Measure frames in the status bar and click its Cancel. Choose **Move to Trash** again. Open the Project's Trash and **Restore** the run.
- **Expect:** Measuring settles Canceled with "Canceled. N of 214 items finished before cancel; nothing else was changed." and the status bar reads "Idle". Move to Trash now succeeds: the run leaves the Project's Runs and is listed in the Project's Trash with the step it was at (Review). Restore puts it back in Runs at Review, reading "Saved r1" with 214 lights. (J27 owns Trash and Empty Trash.)
- **Expect (negative):** Neither Move to Trash nor Restore moves, trashes or writes a file, and Restore changes no membership.
- **Trace:** P-SB3 (Cancel on hover/focus) · operations.ts cancelOperation · IA §Screens S8 · runs.ts restoreRun (D-W72) · J27

### S8 — Undo mistaken marks with U {#S8}

- **Do:** In Review, select F-a and F-b, press **X**, then press **U** with both still selected.
- **Expect:** After X, both read Rejected with scope Library, they leave the run's draft, and Review's status line reads "2 rejected, unsaved" with **Save run** and **Discard**, while Select still reads "Saved r1". After U, both read Unreviewed again and Review's status line no longer reads unsaved.
- **Expect (negative):** No revision is saved, Select keeps "Saved r1" throughout, and no file is moved or trashed.
- **Trace:** IA §Fix pass (review drafts) · IA §Screens S6 (P/X/U) · library.ts markFrames, applyToDraft · derive.ts reviewDraftNote · D-W42, D-W54 · J22 · HARNESS-V5-FEEDBACK-R1.md §Round 6 (Reject is library-wide by default) · G6

### S9 — Discard an unsaved Review draft {#S9}

- **Do:** Select F-c, F-d and F-e, press **X**, then click **Discard** in Review's status line. Then select the same three frames and press **U**.
- **Expect:** After X, the three frames read Rejected with scope Library ("Library scope: every run and Target sees this decision."), they leave the run's draft, and the status line reads "3 rejected, unsaved" with **Save run** and **Discard**. After Discard and then U, the three frames read Unreviewed, the status line no longer reads unsaved, no new unsaved draft appears, and Select reads "Saved r1" with 214 lights. What Discard alone does to the frames' library quality is not asserted (G6).
- **Expect (negative):** Discard saves no revision and moves no file.
- **Trace:** IA §Fix pass (Save run and Discard) · runs.ts discardRunDraft ("Back to the latest revision; nothing else changes") · library.ts (store_library_scope_detail) · G6

### S10 — Confirm nothing changed on disk {#S10}

- **Do:** Outside PlateVault, recompute the P4 manifest.
- **Expect:** Every path, size and SHA-256 matches P4.
- **Expect (negative):** No recovery in S1 to S9 deleted, moved, renamed or rewrote a file.
- **Trace:** README §Reviewable filesystem mutation

## Success criteria

- SC1: S1 shows exactly 1 quit confirmation per quit attempt, and the rescan is still running after the first is canceled. After S3, the catalog holds exactly 1 more session than P4 (`6 Oct`, 10 frames), every other session's frame count equals P4, and 0 work issues remain.
- SC2: After S4, `IC 1396 Ha` has 1 candidate and `6 Oct`'s Target box shows 1 mismatch warning; after S5, it has 0 candidates, the warning is gone, and `NGC 7000 HOO` lists `6 Oct` as a candidate; `NGC7000-HOO-Siril` reads Saved r1 with 214 lights throughout.
- SC3: S6 shows 1 refusal line with exactly 1 blocker chip, and the run is trashed only after the blocker is cleared (S7).
- SC4: After S7, the restored run reads Review and Saved r1 with 214 lights.
- SC5: After S8 and S9, the 5 frames F-a to F-e read Unreviewed and Review shows no unsaved draft.
- SC6: S10 manifest matches P4 for 100% of files.

## Known gaps

- G1: Not validated. The rebuilt application does not implement these flows in this form yet; the behavior follows the harness v5 design (ui-harness-v5 @ b5e813a5: HARNESS-V5-IA.md §S1, §S5, §S6, §S8, §S12, §Round 2/2b foundations and §Fix pass; HARNESS-V5-FEEDBACK-R1.md §Copy rules and §Round 5; Round 6 @ 4f470775, which the prototype does not yet implement).
- G2: Unresolved implementation qualification: S1 needs the rescan to run long enough to quit PlateVault mid-way, cancel the quit prompt and quit again, and S6 needs Measure frames to run long enough to try Move to Trash. No throttle or pause fixture exists for either. Blocks readiness.
- G3: (dissolved 2026-10-12): answered by Round 6 "Confirming a Target the pointing disagrees with"; S4 now asserts that confirming IC 1396 is allowed and that the session's Target box shows a mismatch warning, and S5 asserts that the warning clears after changing the Target to NGC 7000.
- G4: (dissolved 2026-10-12): answered by Round 6 "Quit asks"; S1 now asserts that quitting during the rescan opens a confirmation naming it, that canceling the prompt keeps the rescan running, and that confirming quits, after which S2 and S3 relaunch and Retry as before.
- G5: Out of scope here, owned end to end elsewhere: retrying failed (⛔) imports, preparations and calibration steps (J31, J24, J36); skipping and undoing a Wrap up step before approval (J34); restoring a dismissed master offer from the Calibration library's Dismissed filter (J36, J26); Put back from the OS Trash after a trash move (J27, J34, J39); Empty Trash (J27); restarting with an unsaved Review change (J22); status-bar and Issues hub mechanics (J38); an offline location during indexing (J19).
- G6: Unresolved product question, shared with J22 G9: Round 6 makes X a library-wide Unusable mark under which the frame "leaves every run", and the Review draft that X makes offers Discard. Round 6 does not say what Discard does to that draft. Options: (a, recommended) Discard also returns the frames its X marks covered to their previous library quality, so they rejoin the run consistently; (b) Discard resets only the draft ("Back to the latest revision; nothing else changes"), so the frames stay Unusable while the saved revision still counts them, which contradicts "leaves every run"; (c) Review offers no Discard for library rejections, and only U or P undoes them, so S9's Discard is unavailable. S9 asserts only the state after X and after Discard plus U. Blocks readiness.

## Delta log

- **Δ2** 2026-10-12 · S1, S4, S5, S8, S9 · behavior-change
  Quitting while the rescan runs now asks first: canceling keeps the rescan running, and confirming quits (S1). Confirming IC 1396 against the pointing is allowed, and the session's Target box shows a mismatch warning until the Target is changed to NGC 7000 (S4, S5). X's frames leave the run's draft (S8), and S9 no longer asserts what Discard alone does to them. Dissolves G3 and G4, and adds G6.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Quit asks", "Confirming a Target the pointing disagrees with", "Reject is library-wide by default" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6A (intent-gated)
