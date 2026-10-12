---
id: J25
title: Add new sessions to a prepared processing run without disturbing its prepared inputs
version: 5
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [view-review, indexing, sessions, locations, results, projects, duplicates, issues, status-bar]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 069-application-handoff, 070-results-reuse, 071-storage-custody, D02, D08, D09, D16, D19, D-W34, D-W45, D-W66, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-g-refresh-an-existing-view, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S12, HARNESS-V5-FEEDBACK-R1.md#round-5, P-STO2, P-SB3, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-7, P-PREP3]
---

## Goal

After new captures arrive, the Select step of the prepared processing run
`NGC7000-HOO-Siril` reads "2 new candidates". The user completes the run and
finds Select read-only until Reopen, then reopens it, adds one new session,
leaves the other out, and keeps a member that no longer matches the subject.
The prepared folder stays untouched under the external application.

Done means: Select lists each new candidate with its reason, keeps the run's
exclusions, flags the re-confirmed 26 Sep session "No longer matches" with
Remove, and shows an unreadable member as Unavailable. Reopen returns the run
to Prepare. The accepted change is saved as membership revision 3, which
survives restart and needs its own preparation. The prepared revision's 208
entries are unchanged throughout. Frames of an added session copied to two
locations count once, and the extra copies are raised as one duplicates
warning without any file being moved.

## Preconditions

- P1: J24 completed: `NGC7000-HOO-Siril` reads Prepared, not Complete, at `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril/` with 208 frame entries, each a symlink to its catalogue original (Symlinks run view on `Astro-T7`, J24/S9), from saved membership revision 2 (J22). Every source is readable. A listing of its entries (path, link target, size) is recorded outside PlateVault.
- P2: Two new RedCat NGC 7000 sessions with OBJECT NGC 7000, pointing and orientation evidence and RedCat equipment headers, not yet in `Astro-T7/Captures`: one Ha 300 s session and one OIII 300 s session, each of 10 frames, dated after 30 Sep.
- P3: The J19/P5 manifest is available.
- P4: A disposable writable volume `Spare` holding an empty `Captures/` folder.
- P5: A same-size variant, with different bytes, of one named new Ha frame, kept outside PlateVault.

## Steps

### S1 — Index the new arrivals {#S1}

- **Do:** Copy both P2 sessions into `Astro-T7/Captures`, and copy the new Ha session byte for byte into `Spare/Captures`. In Settings › Locations, add `Spare/Captures` as a Captures location. Index `Astro-T7 captures` again and index `Spare captures`. In each new session's detail choose **Confirm rig** `RedCat` (RedCat 51 + ASI2600MM). Read the status bar, then open the run's Select step.
- **Expect:** Sessions lists the two new sessions with 10 frames each, Target NGC 7000 and rig `RedCat`. After indexing completes, each new Ha frame lists two physical copies, on `Astro-T7` and `Spare`. The automatic duplicate scan after the index raises one warning: the status bar's ⚠ counter rises by one, and its popout lists "10 duplicate copies · <bytes>" opening the Duplicates review. Project `NGC 7000 HOO` captured Ha and captured OIII each rise by 0h 50m. Select reads "2 new candidates", whose tooltip names both new sessions, with an **Add 2** button, and both new sessions are listed unselected with their reason.
- **Expect (negative):** `NGC7000-HOO-Siril` still reads saved membership revision 2 (`Saved r2`) with 208 lights / 17h 20m, and its prepared entries equal the P1 listing. No second new Ha session appears, captured Ha does not rise by 1h 40m, and "in project" does not change. Both copies keep their bytes and locations: the duplicate scan moves nothing to the OS Trash.
- **Trace:** flow G · VSEL-FR-12, LIB-FR-08 · LIB-AC-15 · D16, D-W66 · J19/G4 · HARNESS-V5-IA.md S5 Select ("refresh flags"), S12 (Confirm rig) · HARNESS-V5-FEEDBACK-R1.md Round 5 "Duplicates are scanned automatically", P-STO2, P-SB3

### S2 — Make an existing member unreadable {#S2}

- **Do:** Remove read permission from the 18 Sep subfolder and index `Astro-T7 captures` again.
- **Expect:** 18 Sep reads unreadable or unknown scope in Sessions.
- **Trace:** flow G · LIB-FR-06

### S2a — Re-confirm a member's Target {#S2a}

- **Do:** In Sessions, choose **Confirm Target** IC 5070 for 26 Sep.
- **Expect:** 26 Sep reads Target IC 5070 (user-confirmed) next to its original evidence, and it is no longer a candidate of subject NGC 7000. Its Target box shows a mismatch warning, because its pointing lies within NGC 7000's footprint and not IC 5070's. Its OBJECT still shows as a label only. The Project's in-project and captured OIII values are unchanged, because 26 Sep is still a member of `NGC7000-HOO-Siril`.
- **Expect (negative):** The run's membership and prepared entries do not change. Source bytes still match P3, including the 26 Sep OBJECT keyword.
- **Trace:** flow G · VSEL-FR-12 · VSEL-AC-24 · D-W45, D-W66 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Confirming a Target the pointing disagrees with"

### S2b — Meet a read-only Select on a Complete run {#S2b}

- **Do:** In `NGC7000-HOO-Siril`, click **Complete** in the run header and read the confirmation. Untick **Remove run view** and confirm. Open the Select step.
- **Expect:** The confirmation names each step that stays open and offers "Remove run view · links only", ticked; it offers no intermediates, because the run has none. Afterwards the header reads Complete and offers **Reopen** and **Clean up** in place of Complete. Select still reads "2 new candidates", but offers no **Add 2**, no **Add to run** or **Remove**, and its checkboxes cannot change; Prepare reads "Read-only · Complete · Reopen to change". The run keeps saved membership revision 2.
- **Expect (negative):** Completing with **Remove run view** unticked removes no file, sends nothing to the OS Trash and claims no external success. No control on the Complete run opens a membership change or creates a draft. The prepared entries equal the P1 listing.
- **Trace:** flow G, I1 · VSEL-FR-17, RES-FR-06, RES-FR-07 · VSEL-AC-20, RES-AC-08 · D-W34 · HARNESS-V5-IA.md S5 (header Complete / Reopen / Clean up) · HARNESS-V5-FEEDBACK-R1.md §Round 7 P-PREP3 (the Complete confirmation offers removing the view) · prototype c-runs/model.ts runLock, select-step.tsx

### S3 — Reopen and compare against the saved membership {#S3}

- **Do:** Click **Reopen** in the run header, then open the Select step.
- **Expect:** The run reads Open and is back at Prepare, the step it was at when it was marked Complete, and its prepared revision and saved membership revision 2 are unchanged. Select reads "2 new candidates" with **Add 2** again, and lists both new sessions unselected, each with the reason `Target NGC 7000 on RedCat`. 18 Sep reads **Unavailable**. Select reads "1 member no longer matches", whose ① tooltip reads "Target or rig changed · counts until removed", and the 26 Sep row reads "No longer matches" with **Remove**. The six 30 Sep exclusions stay recorded.
- **Expect (negative):** 18 Sep is not listed as removed, and 26 Sep is not removed. Membership is unchanged and no draft exists until the user adds or removes a session.
- **Trace:** flow G · VSEL-FR-12, VSEL-FR-17 · VSEL-AC-06, VSEL-AC-20, VSEL-AC-24 · root edge "Refresh never removes an offline member" · D-W34, D-W45 · HARNESS-V5-IA.md S5 (Reopen; Select "refresh flags") · prototype c-runs/select-step.tsx

### S4 — Keep the run unchanged {#S4}

- **Do:** Leave the run without adding or removing anything, then open the Select step again.
- **Expect:** The run reads saved membership revision 2 (`Saved r2`) with 208 lights / 17h 20m, the Save button stays disabled, and "2 new candidates" still shows.
- **Expect (negative):** The prepared entries still equal the P1 listing. Nothing is added by leaving.
- **Trace:** flow G · VSEL-FR-12

### S5 — Accept one change and decline the others {#S5}

- **Do:** In Select, choose **Add to run** on the new Ha session only, from its row menu. Leave the new OIII session unselected, and do not click **Remove** on 26 Sep. Click **Save revision 3**. Quit PlateVault, relaunch, and open the run and Project `NGC 7000 HOO`.
- **Expect:** Before saving, the footer reads "Unsaved changes" with the added session, and 18 Sep still reads Unavailable and 26 Sep "No longer matches", not removed. A notice reads "Saved revision 3". Saved membership revision 3 adds the new Ha session's 10 available frames, each once with its `Spare` copy named. The new OIII session is not in it and Select now reads "1 new candidate", and 26 Sep stays a member. After the restart the run opens at revision 3. Review counts the 10 new frames as Unreviewed, Calibrate asks for review of the changed inputs, and Prepare reads "r2 only", with the Preparation section marked "Membership changed · prepare r3". The Project's Ha in-project value has risen by 0h 50m, and OIII in project is unchanged.
- **Expect (negative):** The prepared revision, its 208 entries and the inputs Siril reads are unchanged (P1 listing). No new arrival enters any prepared revision silently, and no member leaves without an explicit removal.
- **Trace:** flow G · VSEL-FR-08, VSEL-FR-12, VSEL-FR-13, VSEL-FR-14, VSEL-FR-16, PREP-FR-11 · VSEL-AC-12, VSEL-AC-15, VSEL-AC-24 · D02, D08, D09, D-W34, D-W45 · prototype c-runs/select-step.tsx, domain/derive.ts runPipeline

### S5a — Restore the 26 Sep Target {#S5a}

- **Do:** In Sessions, choose **Confirm Target** NGC 7000 for 26 Sep. Open the run's Select step.
- **Expect:** 26 Sep reads Target NGC 7000 (user-confirmed) and is a candidate again. Select no longer flags it: the 26 Sep row reads "In the run", and "1 member no longer matches" is gone.
- **Expect (negative):** Saved membership revision 3 is unchanged.
- **Trace:** flow G · VSEL-FR-12 · D-W45

### S6 — Restore the unreadable member {#S6}

- **Do:** Restore read permission on the 18 Sep subfolder and index `Astro-T7 captures` again.
- **Expect:** 18 Sep reads 55 frames and is still a member of both the prepared revision and saved membership revision 3.
- **Expect (negative):** No duplicate 18 Sep session appears.
- **Trace:** flow G · LIB-FR-06

### S7 — Change one copy of a new Ha frame {#S7}

- **Do:** Overwrite the P5 frame's `Spare` copy in place with its variant, restore that copy's mtime, and index `Spare captures` again.
- **Expect:** After indexing completes, the frame reads as conflicting copies on `Astro-T7` and `Spare`, needing review. NGC 7000 captured Ha integration is unchanged. The duplicates warning now reads "9 duplicate copies · <bytes>", because the changed copy is no longer byte-identical.
- **Expect (negative):** Captured Ha does not rise by 0h 05m, and the `Spare` copy is not offered in place of the `Astro-T7` copy. PlateVault changes neither file, and the changed copy is not offered for clean-up as a duplicate.
- **Trace:** flow G · LIB-FR-08 · LIB-AC-15 · D16, D19 · J19/G4 · HARNESS-V5-FEEDBACK-R1.md Round 5 "Duplicates review has clean-up" (groups of byte-identical copies)

## Success criteria

- SC1: The prepared revision's entries equal the P1 listing at S1, S2b, S3, S4, S5 and S6.
- SC2: S3 lists exactly 2 new candidates, each with a reason, 6 retained exclusions, 18 Sep as Unavailable and 26 Sep as no longer matching, with 0 removals.
- SC3: At S2b the Complete run offers 0 controls that change membership until Reopen.
- SC4: After S5 saved revision 3 contains the new Ha session's 10 frames once each, does not contain the new OIII session, still contains 26 Sep, persists across restart, and reads as needing review before preparation.
- SC5: After S1 captured Ha has risen by exactly 0h 50m, each new Ha frame lists 2 physical copies, and exactly 1 duplicates warning reads 10 duplicate copies; after S7 captured Ha is unchanged, the changed frame reads as conflicting copies, and the warning reads 9 duplicate copies. 0 files are moved or trashed at S1 and S7.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design (`apps/prototype/design/HARNESS-V5-IA.md` S5 and S12, `HARNESS-V5-FEEDBACK-R1.md` Round 5, on `ui-harness-v5` @ b5e813a5, and Round 6 @ 4f470775 and Round 7 P-PREP3 @ 12638a7c, which the prototype does not implement yet), the specs and the defaults set in decisions D02, D08, D09, D16 and D19 and workflow decisions D-W34, D-W45 and D-W66. No implementation has been validated against them.
- G2: Out of scope for this journey: preparing revision 3 into `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril (rev 2)/`, with both revisions sending their Results to `NGC7000-HOO-Siril Results/` (D09, PREP-FR-07, PREP-AC-21), and cleanup of the replaced entries before the run is Complete (STO-FR-10) are not exercised. Blocks readiness until covered by a step or a journey.
- G3: Out of scope for this journey: path repair after an archive transfer is distinct from refresh and is exercised in J28/S8.
- G4: Out of scope for this journey: Refresh while the external application is running on the prepared revision (VSEL-AC-12) is not exercised, and no member is a manual inclusion, so the D09 pinning of manual inclusions is not observed. Blocks readiness until covered by a step or a journey.
- G5: Covered elsewhere: the Duplicates review and its clean-up (Keep this copy, Move the others to the OS Trash) opened from the S1 warning are exercised by J39 (S2 to S6); this journey only reads the warning.

## Delta log

- **Δ2** 2026-10-06 · S1, S3, S4, S5, +S2a, +S2b, +S5a · behavior-change
  The run offers "Add N new sessions" for new candidates. A Complete run asks for Reopen first, and Reopen returns it to the stage it was in. A member whose Target is re-confirmed stays and is flagged "no longer matches subject" with an offer to remove it. Saving adds a membership revision that feeds "in project".
  Evidence: specs/066-view-selection VSEL-FR-12, VSEL-FR-17, VSEL-AC-06, VSEL-AC-20, VSEL-AC-24. specs/070-results-reuse RES-FR-07, RES-AC-08. Workflow decisions D-W34, D-W45, D-W66. 065 PRJ-FR-04, PRJ-FR-21, 071 STO-FR-10 and 069 PREP-FR-07. Rig name `RedCat` from J15 · by: journey-scribe (intent-gated)
- **Δ3** 2026-10-12 · S1, S2a, S2b, S3, S4, S5, S5a, S7 · behavior-change
  The refresh lives in Select: "2 new candidates" with Add 2 or per-row Add to run, and "No longer matches" with Remove, in place of a separate refresh diff with accept/decline. A Complete run's Select is read-only until Reopen in the header, which returns the run to Prepare.
  Indexing a byte-identical copy raises an automatic "10 duplicate copies" warning in the status bar, and nothing is moved.
  Evidence: HARNESS-V5-IA.md §Screens S5 (header Complete / Reopen; Select "refresh flags") and S12 (Confirm rig); HARNESS-V5-FEEDBACK-R1.md §Round 5 "Duplicates are scanned automatically", "Duplicates review has clean-up", P-STO2 and P-SB3; prototype src/features/v5/c-runs/select-step.tsx, run.tsx, model.ts and messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U3Runs (intent-gated)
- **Δ4** 2026-10-12 · S2a, S2b · behavior-change
  P1 now reads the run as 208 cloned frame entries (Independent copy) instead of hard links. Completing the run in S2b offers Clean up of its prepared copies with the footprint "0 B extra · cloned", which frees no space, and the user leaves the offer. Confirming IC 5070 against NGC 7000 pointing in S2a shows a mismatch warning in the session's Target box.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Confirming a Target the pointing disagrees with" (@ 4f470775); §Input modes (user, 2026-10-10) P-PREP2 "Independent copy", "Footprint is real", "Prepared copies are cleaned up when a run is done" (@ d609ff55) (apps/prototype/design/ on ui-harness-v5); user answers to the PR #1788 journey questions · by: JourneysV5 (lead, intent-gated)
- **Δ5** 2026-10-12 · S2b · behavior-change
  P1 reads the run's 208 entries as symlinks (Symlinks run view). Completing the run in S2b offers "Remove run view · links only", ticked, in the Complete confirmation; the user unticks it, so nothing is removed.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 (apps/prototype/design/ on ui-harness-v5 @ 12638a7c) · by: JourneysV5.R7Prep3 (intent-gated)
