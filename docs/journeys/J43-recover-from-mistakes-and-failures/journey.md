---
id: J43
title: Recover from routine mistakes and failures: retry interrupted work, change a wrong Target, act on a refusal, undo marks and discard a draft
version: 3
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [locations, indexing, status-bar, home, activity, sessions, targets, projects, view, frame-review, wrap-up]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S8, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#round-2-foundation, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, P-SB3, D-W33, D-W37, D-W42, D-W54, D-W72, D09, apps/prototype/src/store/operations.ts, apps/prototype/src/components/app/refusal.tsx, apps/prototype/src/components/app/operation-panel.tsx, apps/prototype/src/domain/issues.ts, apps/prototype/src/domain/derive.ts, apps/prototype/src/store/actions/library.ts, apps/prototype/src/features/v5/a-home/parts.tsx, apps/prototype/messages/en-GB.json, ui-harness-v5@b5e813a5, HIGH-LEVEL-DESIGN.md#10, docs/journeys/J11-mistake-recovery/journey.md, docs/journeys/J12-failure-refusal-handling/journey.md, specs/063-clean-rebuild-contract/spec.md#FR-029-FR-032, specs/063-clean-rebuild-contract/workflow-decisions.md#D-W93-D-W106, specs/064-library-inventory/spec.md#LIB-FR-05-LIB-FR-23, specs/065-project-goals/spec.md#PRJ-FR-08-PRJ-FR-30, specs/067-frame-review/spec.md#PIX-FR-13-PIX-FR-14-PIX-FR-18, specs/069-application-handoff/spec.md#PREP-FR-06-PREP-FR-09, D-W93, D-W94, D-W96, D-W97, D-W100, D-W105]
---

## Goal

The user recovers from an interrupted rescan, corrects a session's wrong Target, handles a failed Apply, continues a Closed Project by duplicating it, and undoes mistaken library-quality marks. Each outcome is visible, reversible where the action permits it, and leaves original capture files unchanged. Done means:

- Quitting during the rescan asks first, and canceling the prompt keeps the rescan running. The interrupted rescan is found in the status bar, Home's Work box and Activity, resumes with Retry, and indexes the new night exactly once.
- The wrongly confirmed session shows a mismatch warning, is re-confirmed to the right Target, which clears the warning, and Project suggestions follow both times, without changing any file header or the sessions a Project holds.
- A failed Apply reads Failed, names the affected source, leaves the current View unchanged, and can be retried after the source is restored and verified.
- A reversible library-quality mark takes effect at once and its Undo action restores the previous quality without leaving a pending Project change.
- No recovery action deletes, moves or rewrites a file.

Recoveries that other journeys own end to end are referenced, not repeated (G5).

## Preconditions

- P1: Open Project `NGC 7000 HOO` holds 214 lights in five Ready sessions grouped by rig and framing, has an applied View and no pending changes, and has no measurement cached. The input manifest and session frame counts are recorded outside PlateVault before S1.
- P2: The open Project `IC 1396 Ha` (subject IC 1396, rig `RedCat`), created through New Project as in J20, has no held sessions and no suggestions.
- P3: After J21, outside PlateVault, `Astro-T7/Captures/2026-10-06/` was added with 10 Ha 300 s `RedCat` lights from the night of 6 Oct. Their OBJECT is `IC 1396` (the capture application's label), and their pointing lies within NGC 7000's footprint and outside IC 1396's. PlateVault has not indexed the folder.
- P4: The J19/P5 manifest, extended with the 6 Oct folder, and the catalog's session list with the frame count of each session, recorded outside PlateVault before S1.
- P5: Two named 30 Sep frames, F-a and F-b, and three named 26 Sep frames, F-c, F-d and F-e, are Usable frames in sessions held by `NGC 7000 HOO`.
- P6: A test helper can change one included original's bytes after Apply has captured its source snapshot, preserving its size and modification time, and can restore the P4 bytes afterward.
- P7: Closed Project `NGC 7000 Closed` exists with its groups, sessions, goals, notes and settings. It has no pending changes.

## Steps

### S1 — Rescan and quit mid-way {#S1}

- **Do:** In Settings › Locations, choose **Rescan** on `Astro-T7 captures`. While it runs, quit PlateVault and read the prompt. Cancel the prompt and read the status bar and Home's Work box. Quit again and confirm quitting.
- **Expect:** While the rescan runs, the status bar's middle shows it as plain text with a mini progress bar, and Cancel appears on hover or focus. Home's Work box lists it with its progress, Pause and Cancel. Quitting opens a confirmation that names the running rescan, `Indexing Astro-T7 captures`, before PlateVault closes. After the prompt is canceled, PlateVault stays open, and the rescan is still running with its progress still advancing. After quitting is confirmed, PlateVault closes.
- **Expect (negative):** Canceling the prompt neither cancels, pauses nor restarts the rescan, and closes no window. Quitting does not close PlateVault before the user confirms.
- **Trace:** P-SB3 · LIB-FR-03 · D-W89

### S2 — Find the interrupted work after relaunch {#S2}

- **Do:** Launch PlateVault. Read the status bar, open the severity counter for interrupted work, then open Home and Activity.
- **Expect:** The status bar shows a count only; activating it opens the owning page filtered to affected rows, not a list of issues. Home's Status section and Activity show `Indexing Astro-T7 captures` as interrupted with **Retry** and the message "PlateVault restarted while this was running. Recorded progress is kept; Retry resumes it."
- **Expect (negative):** The rescan does not restart by itself.
- **Trace:** FR-032; LIB-FR-03; D-W89; P-SB3

### S3 — Retry and read the outcome {#S3}

- **Do:** Click **Retry** in Home's Work box and wait until it finishes. Open Sessions.
- **Expect:** The rescan resumes from its recorded progress and settles once, with one outcome in Activity. Sessions lists one new session, `6 Oct` (Ha, 10 frames, `RedCat`), in Needs a Target. It is not suggested to a Project until its Target, rig, frame review and calibration are settled. The Duplicates filter shows no duplicate badge for it.
- **Expect (negative):** No session is listed twice and no frame is counted twice: every other session's frame count equals P4, and the 10 new frames appear once. No file is written or moved.
- **Trace:** D09; LIB-FR-20; LIB-FR-22; PRJ-FR-09

### S4 — Confirm the wrong Target {#S4}

- **Do:** Open the `6 Oct` session. Read its Target box, then choose IC 1396 (as its OBJECT says) and click **Confirm Target**.
- **Expect:** Before confirming, the Target picker preselects NGC 7000, the Target evidence lists the pointing, and OBJECT `IC 1396` appears only as a label of the session. Confirming IC 1396 is allowed: after confirming, the Target pill reads IC 1396 as confirmed, and the session's Target box shows a mismatch warning that the session's pointing disagrees with IC 1396. After the user confirms its RedCat rig, reviews all its frames and finishes review, the session becomes Ready and `IC 1396 Ha` lists it as a suggestion (1 session, 10 frames). Activity records `Target confirmed` with "IC 1396. Catalog only; source headers unchanged."
- **Expect (negative):** OBJECT is never listed as Target evidence and never preselects IC 1396. The mismatch warning does not block or undo the confirmation. No FITS header changes and no file moves.
- **Trace:** LIB-FR-05; PRJ-FR-09; D-W96

### S5 — Change the Target and watch suggestions follow {#S5}

- **Do:** In the same Target box, choose NGC 7000 and click **Confirm Target**. Open `IC 1396 Ha` and `NGC 7000 HOO`.
- **Expect:** The Target pill reads NGC 7000 as confirmed, and the mismatch warning is gone from the Target box. Activity records a second `Target confirmed` with "NGC 7000. Catalog only; source headers unchanged." `IC 1396 Ha` has no suggestions again. `NGC 7000 HOO` lists `6 Oct` among its suggestions.
- **Expect (negative):** Changing a Target changes suggestions only; it does not add or remove a session held by either Project. No FITS header changes and no file moves, because `6 Oct` was indexed in place.
- **Trace:** LIB-FR-05; PRJ-FR-08; PRJ-FR-09; D-W94; D-W96

### S6 — Recover from a failed Apply {#S6}

- **Do:** Add the Ready `6 Oct` session to `NGC 7000 HOO`. Choose Apply. With the test helper, change one included original after Apply records its source snapshot, then let the operation settle. Restore the original bytes from P4 and retry Apply.
- **Expect:** The first Apply reads Failed and names the source drift. The current `View/` remains byte-identical to its pre-Apply state, `View (building)/` is not swapped in, and the session addition remains pending. After the original bytes are restored and reverified, Retry builds the new View from the originals and swaps it in; the former View becomes `View (previous)/`.
- **Expect (negative):** No source file is written or moved. A failed Apply never presents the old View as the newly applied View.
- **Trace:** PREP-AC-14; PREP-FR-06; PREP-FR-09; PV-PREP-SC-05; D-W100

### S7 — Continue a Closed Project by duplicating it {#S7}

- **Do:** Open `NGC 7000 Closed` and inspect its Project menu. Choose **Duplicate…** and keep its sessions, groups, overrides, goals, notes and settings selected.
- **Expect:** The Closed Project offers Duplicate… and no Reopen. The new Project is open, keeps the selected Project records, has no files copied and has no View until its first Apply. Editing the duplicate does not change the Closed Project.
- **Expect (negative):** The Closed Project cannot be edited or applied, and no restore action reopens it.
- **Trace:** PRJ-FR-25; PRJ-FR-30; D-W96; D-W97

### S8 — Undo mistaken Unusable marks {#S8}

- **Do:** In the session's frame review, select F-a and F-b and press **X**. Use the offered **Undo** action.
- **Expect:** X marks both frames Unusable immediately. Undo restores their previous Usable quality and removes the resulting pending changes from open Projects that hold the session.
- **Expect (negative):** No review draft or revision is created, and no file moves or reaches the OS Trash.
- **Trace:** FR-029; PIX-FR-13; PIX-FR-14; PIX-FR-18; VSEL-FR-12

### S9 — Undo a mistaken Usable mark {#S9}

- **Do:** Select F-c, F-d and F-e in frame review and press **P**. Use the offered **Undo** action.
- **Expect:** P marks the three frames Usable immediately. Undo restores their previous Usable quality; no unsaved Review draft appears.
- **Expect (negative):** Undo saves no revision and moves no file.
- **Trace:** FR-029; PIX-FR-13; PIX-FR-14

### S10 — Confirm nothing changed on disk {#S10}

- **Do:** Outside PlateVault, recompute the P4 manifest.
- **Expect:** Every path, size and SHA-256 matches P4.
- **Expect (negative):** No recovery in S1 to S9 deletes, moves, renames or rewrites an original capture. The failed Apply leaves the previous View unchanged until a successful retry.
- **Trace:** README §Reviewable filesystem mutation

## Success criteria

- SC1: S1 shows exactly 1 quit confirmation per quit attempt, and the rescan is still running after the first is canceled. After S3, the catalog holds exactly 1 more session than P4 (`6 Oct`, 10 frames), every other session's frame count equals P4, and 0 work issues remain.
- SC2: After S4, `IC 1396 Ha` has 1 suggestion and `6 Oct`'s Target box shows 1 mismatch warning; after S5, it has 0 suggestions, the warning is gone, and `NGC 7000 HOO` lists `6 Oct` as a suggestion; `NGC 7000 HOO` holds 214 lights throughout.
- SC3: S6 records one failed Apply with source drift named, leaves the current View byte-identical and preserves the pending session addition until a successful retry.
- SC4: After S7, the Closed Project still has no Reopen or edit action, and its duplicate is open and independent.
- SC5: After S8 and S9, F-a through F-e have their original Usable quality, no pending mark from those actions remains, and no unsaved draft exists.
- SC6: S10 manifest matches P4 for 100% of files.

## Known gaps

- G1: Not validated. The rebuilt application does not implement these flows in this form yet; the behavior follows the harness v5 design (ui-harness-v5 @ b5e813a5: HARNESS-V5-IA.md §S1, §S5, §S6, §S8, §S12, §Round 2/2b foundations and §Fix pass; HARNESS-V5-FEEDBACK-R1.md §Copy rules and §Round 5; Round 6 @ 4f470775, which the prototype does not yet implement).
- G2: Unresolved implementation qualification: S1 needs a rescan long enough to quit PlateVault mid-way, cancel the quit prompt and quit again; S6 needs a controlled source change after Apply snapshots it. No throttle or source-drift fixture exists. Blocks readiness.
- G3: (dissolved 2026-10-12): answered by Round 6 "Confirming a Target the pointing disagrees with"; S4 now asserts that confirming IC 1396 is allowed and that the session's Target box shows a mismatch warning, and S5 asserts that the warning clears after changing the Target to NGC 7000.
- G4: (dissolved 2026-10-12): answered by Round 6 "Quit asks"; S1 now asserts that quitting during the rescan opens a confirmation naming it, that canceling the prompt keeps the rescan running, and that confirming quits, after which S2 and S3 relaunch and Retry as before.
- G5: Out of scope here, owned end to end elsewhere: retrying failed imports and calibration processes (J31, J36); skipping or undoing a Wrap up step before approval (J34); restoring a hidden calibration master offer (J36); Put back from the OS Trash after a trash move (J27, J34, J39); restarting during an unsaved session review (J22); status-bar mechanics (J38); an offline location during indexing (J19). Apply failure and recovery are covered in S6.
- G6: Not validated. A live-product replay must verify that a Closed Project offers Duplicate… without Reopen and that the duplicated Project is independent (PRJ-FR-25, PRJ-FR-30). Blocks readiness.

## Delta log
- **Δ3** 2026-10-15 · S3, S5, S6, S7, S8, S9 · behavior-change
  Target correction changes Project suggestions but not held sessions. Failed Apply preserves the current View; Closed Projects have no Reopen and continue only through Duplicate. Reversible frame marks take effect immediately and offer Undo.
  Evidence: D-W93 to D-W106 in specs/063-clean-rebuild-contract/workflow-decisions.md, PREP-AC-14, PREP-FR-06, PREP-FR-09, FR-029, PIX-FR-14, PRJ-FR-08, PRJ-FR-25, PRJ-FR-30 · by: SpecF4Writer2 (intent-gated)
