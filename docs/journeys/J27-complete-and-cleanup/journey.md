---
id: J27
title: Complete a processing run, clean up its prepared entries, reopen a run, and trash and restore one
version: 3
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [results, cleanup, view-review, projects, project-trash, activity, status-bar]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 066-view-selection, 069-application-handoff, 070-results-reuse, 071-storage-custody, 065-project-goals, D09, D16, D19, D-W26, D-W43, D-W51, D-W66, D-W70, D-W72, P-WRAP1, P-SB3, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/066-view-selection/spec.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, specs/071-storage-custody/spec.md, specs/065-project-goals/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-i-completion-and-selectable-cleanup, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S8, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed, HARNESS-V5-FEEDBACK-R1.md#b-projects, HARNESS-V5-FEEDBACK-R1.md#c-run-and-run-group, HARNESS-V5-FEEDBACK-R1.md#round-5]
---

## Goal

The user records that a processing run is finished, whether it has an
accepted Result. The run's Clean up, on its Done step, then sends the run's
prepared entries (links, clones and copies) to the OS Trash. The run's Results
folder, the originals, accepted products and masters stay out of Clean up
entirely. The user also reopens a run, moves one to the Project Trash, restores
it, and empties it from the Trash. Done means:
- Both runs read Complete, and completing them removed nothing.
- Clean up listed only prepared entries, every one preselected beside the run's footprint, and removed only the reviewed selection, to the OS Trash, without following link targets.
- An entry that may hold the last copy of a capture was refused.
- A location without safe Trash refused removal, with no permanent-delete fallback.
- Move to Trash was refused, naming its blocker, while the run's Clean up was Running and while another run used the run's accepted Results. Moving a run to the Project Trash moved no file and changed no goal number, and Restore brought it back exactly as it was. Emptying it from the Trash on a location without OS Trash ran one trash operation, left its prepared folders in place and named them, and sent its ticked Results folder to the OS Trash.

## Preconditions

- P1: Fresh replay of J24 and J26 (J25 not run). Siril is not running. `NGC7000-HOO-Siril Results/` also holds one file PlateVault does not recognize.
- P2: From J24/S16 and J24/S17, `28 Sep Ha copy check` is Prepared on `Scratch`, which has no OS Trash. Revision 1 holds 56 copies and revision 2 holds 55. The run has no accepted Result. Its Results folder `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/` holds the two unaccepted J26/P8 stacks.
- P3: In an isolated test OS account or disposable VM containing only these generated fixtures, unlink one named 30 Sep capture directly from its generated source folder, without using or emptying the OS Trash. Its prepared hardlink in `NGC7000-HOO-Siril/` becomes the fixture's last copy. Record the exact fixture path and its pre-unlink hash. Real libraries and unrelated Trash contents are outside this setup.
- P4: Record a baseline inventory of the isolated account's Trash without deleting anything. Also record a manifest of the remaining captures, every file in `NGC7000-HOO-Siril Results/`, and the adopted master. Trash checks compare only this journey's newly added entries against that baseline.
- P5: A second final image saved by the user outside the run, at `Work/Finals/NGC7000-HOO-crop.tif`.
- P6: Run `26 Sep symlink check` in Project `NGC 7000 HOO`, created from the 26 Sep session, prepared under `Work/Processing/NGC 7000 HOO/26 Sep symlink check/` in Linked View with 35 symlink entries, then marked Complete with no Result. Outside PlateVault, its run folder also receives `extra/`, holding a byte copy of one named 26 Sep capture. Record the J19/P5 entries of the 26 Sep session.
- P7: A helper outside PlateVault saves a named file's bytes and nanosecond mtime, then overwrites the file in place with a same-size variant whose bytes differ and restores the saved mtime. The helper later restores the saved bytes and mtime.
- P8: `24 Sep flat check` reads Complete (J24/S15). Its stage before completion was Calibrate (J23/S7), and it has no preparation revision.
- P9: A fault control holds a run's Clean up operation Running after its first entry moves, until it is released (G5).

## Steps

### S1 — Complete a run with no Result {#S1}

- **Do:** Open `28 Sep Ha copy check`, choose **Complete**, read the preview and confirm.
- **Expect:** The preview lists each step that is not Done. Results is among them and reads that it stays Needs review, because neither J26/P8 stack is accepted. The preview reads "Nothing is removed." After confirming, the run reads Complete with no accepted Result, and its Done step offers **Clean up** as a separate action.
- **Expect (negative):** No file is removed and no cleanup starts.
- **Trace:** flow I1, cross-flow "Completion with no Result" · RES-FR-06 · RES-AC-06 · root SC-006 · HARNESS-V5-IA.md S5, Fix pass

### S2 — Complete the main run {#S2}

- **Do:** Open `NGC7000-HOO-Siril` and choose **Complete**, confirming its preview if one opens.
- **Expect:** The run reads Complete, its accepted Results are unchanged, and the Project page's Runs table lists it at Done with status Complete.
- **Expect (negative):** Completion removes nothing and does not claim that Siril processing stopped or succeeded.
- **Trace:** flow I1 · RES-FR-06 · PRJ-FR-20 · D09, D-W26 · HARNESS-V5-IA.md S3, S5 · HARNESS-V5-FEEDBACK-R1.md Round 5 (runs read as one model)

### S3 — Edit a Complete run {#S3}

- **Do:** In `NGC7000-HOO-Siril`, try **Exclude from run** on an included frame. Then edit the run's notes, attach `Work/Finals/NGC7000-HOO-crop.tif` as a Final image, and accept it.
- **Expect:** The exclusion is refused until **Reopen** is chosen explicitly, because it would create a new membership revision. The notes edit and the Result acceptance go through, the crop reads User-linked, and the run stays Complete.
- **Expect (negative):** No membership or preparation revision takes effect while the run reads Complete. Editing notes and accepting a Result neither reopen the run nor change its fixed membership.
- **Trace:** RES-FR-07 · RES-AC-08 · D09

### S4 — Open Clean up {#S4}

- **Do:** Open the run's Done step and read its Clean up list.
- **Expect:** The list holds one group, the prepared folder `NGC7000-HOO-Siril/`, with the 208 hardlink entries of revision 1, each with its kind, size and proposed action. Every entry starts selected, and the run's footprint, the bytes of its prepared entries, is shown beside the list.
- **Expect (negative):**
  - Nothing in `NGC7000-HOO-Siril Results/` is listed: not the intermediates, the log, the unknown file, the accepted stacks, the attached images, or the generated master source.
  - No original capture or library frame is listed.
  - The selection does not cover the whole run directory.
  - Clean up offers no way to move rejected frames or processing intermediates to the Trash. Both are offered only in step 2, Trash, of the Project's Wrap up stage.
- **Trace:** flow I2 · STO-FR-01, STO-FR-03, STO-FR-16 · STO-AC-01, STO-AC-20 · PREP-FR-14 · PREP-AC-19 · RES-FR-01 · D-W26, D-W43, D-W70 · HARNESS-V5-IA.md S5, S9 · HARNESS-V5-FEEDBACK-R1.md Domain and seed (P-WRAP1, Storage), Screens C

### S5 — Inspect and choose entries {#S5}

- **Do:** In the Clean up list, deselect one hardlink entry.
- **Expect:** Each entry shows its path, its role, other run or Project references, retained-original evidence and estimated bytes. The group reads 207 of 208 selected.
- **Expect (negative):** Link sizes are not presented as guaranteed reclaimed bytes.
- **Trace:** flow I3 · STO-FR-02

### S7 — Review cleanup {#S7}

- **Do:** Choose **Clean up…** and read the review.
- **Expect:**
  - The review lists exactly the 207 selected entries and the 1 retained entry, and its one action moves the selected entries to the OS Trash.
  - Trash support for `Work` shows movable and blocked counts.
  - The P3 hardlink entry is blocked for insufficient retained-original proof. The other 206 selected entries show a verified retained original.
- **Expect (negative):** No entry with stale identity, missing retained-original proof, an unavailable source or ambiguous ownership is approved.
- **Trace:** flow I4 · STO-FR-04 · STO-AC-04

### S8 — Send the selected entries to Trash {#S8}

- **Do:** With the P7 helper, overwrite the original capture behind one selected hardlink entry after the review. Then confirm the move to the OS Trash. Afterwards, restore that capture's saved bytes and mtime with the helper.
- **Expect:**
  - Progress shows per-item outcomes and a partial summary that names both blocked entries: the P3 hardlink entry, and the entry whose bytes changed since review.
  - The run records which prepared entries were removed and which remain. The 205 removed entries are newly in the OS Trash.
  - The run still reads Complete.
- **Expect (negative):**
  - Link targets are not followed. After the restore, the remaining captures, every file in `NGC7000-HOO-Siril Results/` and the adopted master match P4.
  - The deselected entry, the changed entry and the P3 hardlink entry remain.
  - Reviewed cleanup neither reopens the run nor changes its fixed membership.
- **Trace:** flow I5 · STO-FR-04, STO-FR-05 · STO-AC-15 · root SC-006 · D09, D19

### S9 — Restore from the OS Trash {#S9}

- **Do:** In the OS Trash, put back one removed hardlink entry.
- **Expect:** The entry returns to its run folder path. PlateVault states that restoration cannot be guaranteed after the Trash is emptied.
- **Trace:** flow I5 recovery · STO-FR-05

### S10 — Meet a location without safe Trash {#S10}

- **Do:** In `28 Sep Ha copy check`, open the Done step, keep both preselected groups, choose **Clean up…**, and confirm the move to the OS Trash.
- **Expect:** Clean up lists the 56 copies of revision 1 and the 55 copies of revision 2 in separate groups. Trash support reads unsupported for `Scratch`, all 111 copies are refused, and **Keep files** and **Reveal location** are offered.
- **Expect (negative):** No permanent-delete fallback is offered, and no copy is removed. Neither J26/P8 stack nor any other file in `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/` is listed.
- **Trace:** flow I4, I5, cross-flow "Cleanup/Trash failure" · STO-FR-01, STO-FR-04, STO-FR-05 · STO-AC-03 · PREP-FR-11 · root FR-010 · D-W51

### S11 — Remove symlink entries {#S11}

- **Do:** Open `26 Sep symlink check` at its Done step and keep the preselected group of its 35 symlink entries. Arm the P9 hold, then choose **Clean up…** and confirm the move to the OS Trash.
- **Expect:** The group lists the 35 symlink entries, and the review shows each link's identity and target path. The Clean up runs as one operation, and the P9 hold keeps it Running after its first link moves. The status bar's running work names it with a mini progress bar.
- **Expect (negative):** The `extra/` copy is not listed, because the preparation did not create it.
- **Trace:** flow I4, I5 · STO-FR-01, STO-FR-04, STO-FR-05 · STO-AC-08 · PREP-AC-19 · HARNESS-V5-FEEDBACK-R1.md Round 5 (P-SB3)

### S11a — Try to trash a run while its Clean up runs {#S11a}

- **Do:** While the P9 hold keeps the S11 Clean up Running, choose **Move to Trash** on `26 Sep symlink check`. Then release the hold, let the Clean up finish, and read the run.
- **Expect:**
  - Move to Trash is refused with the terse refusal `Move to Trash blocked`, whose disclosure names the running Clean up as its blocker. The run stays Complete in the Project's Runs table, and the Project Trash does not list it.
  - After the release, the 35 links are newly in the OS Trash, and the run still reads Complete.
- **Expect (negative):**
  - The refusal moves no file and does not stop or change the Clean up.
  - The `extra/` copy remains. No file under `Astro-T7/Captures/26 Sep` reaches the Trash, every 26 Sep capture matches its P6 record, and no link target or target directory is traversed or removed.
- **Trace:** RES-FR-10 · flow I5 · STO-FR-04, STO-FR-05 · STO-AC-08 · PREP-AC-19 · D-W72 · HARNESS-V5-IA.md S5 (Refusals) · HARNESS-V5-FEEDBACK-R1.md Copy rules · G5

### S12 — Reopen a Complete run {#S12}

- **Do:** Open `24 Sep flat check` and choose **Reopen**.
- **Expect:** The run reads open again, back at Calibrate, the stage it was in when it was marked Complete. Its membership and calibration decisions are unchanged, and **Exclude from run** is available again.
- **Expect (negative):** Reopening removes no file and does not create a membership revision. Clean up is not offered, because the run is not Complete.
- **Trace:** RES-FR-07 · RES-AC-08 · VSEL-FR-17 · PREP-FR-14, STO-FR-01 · D09

### S13 — Try to trash a run whose Results another run uses {#S13}

- **Do:** In `NGC7000-HOO-Siril`, choose **Move to Trash**.
- **Expect:** Move to Trash is refused with the terse refusal `Move to Trash blocked`, whose disclosure names one blocker, `NGC7000 HOO combine`, which uses the run's accepted Ha and OIII stacks as inputs (J26/S4). The run still reads Complete and stays in the Project's Runs table.
- **Expect (negative):** No file moves, and the run's membership, prepared folder and Results folder are unchanged.
- **Trace:** RES-FR-05, RES-FR-10 · RES-AC-20 · root FR-009 · D-W72 · HARNESS-V5-IA.md S5 (Refusals) · HARNESS-V5-FEEDBACK-R1.md Copy rules

### S14 — Move a run to the Project's Trash {#S14}

- **Do:** In `28 Sep Ha copy check`, choose **Move to Trash…**, read the confirmation and confirm. Then open Project `NGC 7000 HOO`, read its Runs section and the Ha goal, and open its Trash page.
- **Expect:**
  - The confirmation names the Project's Trash and Done, the stage at which the run waits there.
  - The Runs table lists `NGC7000-HOO-Siril`, `24 Sep flat check`, `26 Sep symlink check` and `NGC7000 HOO combine`, and the section's Trash reads **Trash (1)**. `28 Sep Ha copy check` is not in the table, and neither Home nor any run picker lists it.
  - The Project Trash page lists `28 Sep Ha copy check` with stage Complete, its 111 prepared entries, and its Results with an unticked box. Its row offers **Restore**, its row menu adds **Empty this run…**, and the page header offers **Empty Trash…**.
  - The Ha goal's "in project" and "captured" numbers are unchanged, because the 28 Sep frames are still candidates and still count once through `NGC7000-HOO-Siril`.
- **Expect (negative):** No file moves: both `Scratch` folders keep their 111 copies, and the Results folder keeps both J26/P8 stacks. The confirmation lists no file to move, and no 28 Sep capture, library quality decision or other run changes.
- **Trace:** RES-FR-10 · RES-AC-19 · PRJ-FR-04, PRJ-FR-20 · PREP-FR-14 · root FR-009, FR-022 · D-W66, D-W72 · HARNESS-V5-IA.md S3, S8 · HARNESS-V5-FEEDBACK-R1.md Screens B (Trash)

### S14a — Restore the run {#S14a}

- **Do:** On the Project Trash page, choose **Restore** on `28 Sep Ha copy check`, read the confirmation, confirm **Restore run**, and open the run.
- **Expect:** The confirmation reads "Back as it was when trashed." The run is back in the Runs table at Done and reads Complete. It lists both membership revisions and both preparation revisions, `28 Sep Ha copy check/` with 56 copies and `28 Sep Ha copy check (rev 2)/` with 55. Its Results step lists both J26/P8 stacks as candidates, naming revisions 1 and 2. The Trash page reads "Trash is empty".
- **Expect (negative):** Restore moves no file, reopens nothing and saves no new revision. The Ha goal's numbers still read as they did before S14.
- **Trace:** RES-FR-10 · RES-AC-21 · PRJ-FR-20 · root FR-009 · D-W72 · HARNESS-V5-IA.md S8

### S14b — Empty the run from the Trash on a location without OS Trash {#S14b}

- **Do:** Choose **Move to Trash…** on `28 Sep Ha copy check` again and confirm. On the Project Trash page, tick its Results, choose **Empty this run…** from its row menu, read the preview and confirm **Empty run**. Then read the Trash page and Activity.
- **Expect:**
  - The preview lists the run record and both prepared folders, `Scratch/Processing/NGC 7000 HOO/28 Sep Ha copy check/` (56 copies) and `28 Sep Ha copy check (rev 2)/` (55 copies). Each is named as staying in place, because `Scratch` has no OS Trash.
  - The preview lists the ticked Results folder `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/`, with the two J26/P8 stacks, as going to the OS Trash.
  - Confirming runs one trash operation, and Activity lists it once. After it, that Results folder and its two stacks are newly in the OS Trash. The run leaves the Trash page, which reads "Trash is empty", and nothing offers to Restore it. The operation's summary names both `Scratch` folders with their paths as left in place.
  - The Ha goal's "in project" and "captured" numbers are still unchanged.
- **Expect (negative):** No copy on `Scratch` is removed, and no permanent-delete fallback is offered. No 28 Sep capture, library quality decision or other run changes.
- **Trace:** RES-FR-10 · RES-AC-22 · STO-FR-05, STO-FR-17 · STO-AC-24 · PRJ-FR-04, PRJ-FR-20 · PREP-FR-14 · root FR-009, FR-019 · D-W66, D-W72 · HARNESS-V5-IA.md S8, S17

## Success criteria

- SC1: Completing either run removes 0 files and starts 0 cleanups (S1, S2).
- SC2: Clean up lists only prepared entries: 208 hardlinks (S4), 111 copies (S10) and 35 symlinks (S11). It lists 0 files from a Results folder, 0 originals and 0 files the preparation did not create.
- SC3: Every removed entry is in the OS Trash, and the P4 manifest still matches after the restore (S8).
- SC4: The last-copy hardlink is refused and remains (S7, S8).
- SC5: On `Scratch`, 0 files are removed, and no permanent-delete action exists (S10).
- SC6: A Complete run refuses membership edits until Reopen and accepts a notes edit and a Result acceptance. It still reads Complete after reviewed cleanup (S3, S8).
- SC7: Trashing 35 symlinks leaves 100% of the 26 Sep captures and the `extra/` copy matching P6 (S11, S11a).
- SC8: An entry whose bytes changed after review is removed 0 times (S8).
- SC9: Move to Trash on `NGC7000-HOO-Siril` is refused, names exactly 1 blocker, `NGC7000 HOO combine`, and moves 0 files (S13).
- SC10: Moving `28 Sep Ha copy check` to the Project Trash moves 0 files, leaves 4 runs in the Project's Runs table and changes the Ha "in project" and "captured" numbers by 0. Restore returns it at Done with 2 membership revisions, 2 preparation revisions and 2 Results candidates (S14, S14a).
- SC11: Emptying `28 Sep Ha copy check` from the Trash runs exactly 1 trash operation, sends exactly 1 folder holding 2 files to the OS Trash, leaves all 111 `Scratch` copies in place, and changes the Ha numbers by 0 (S14b).
- SC12: While the Clean up of `26 Sep symlink check` is Running, Move to Trash is refused 1 time, names exactly 1 blocker, the running Clean up, and moves 0 files. The Clean up then moves exactly 35 links (S11, S11a).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design (HARNESS-V5-IA.md S3, S5, S8 and Fix pass; HARNESS-V5-FEEDBACK-R1.md Copy rules, Screens B and C, and Round 5, on ui-harness-v5 @ b5e813a5), the specs, the decisions D09, D16 and D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G2: Out of scope for this journey: Direct-source Clean up needs a prepared Direct-source run, and no journey prepares one yet. That Clean up shows that preparation created no entries and offers nothing to remove (PREP-AC-20, STO-AC-02). Blocks readiness until covered.
- G3: Out of scope for this journey: removing replaced prepared entries before the run is Complete (STO-FR-10, D09) is not exercised. Blocks readiness until covered by a step or a journey.
- G5: Unresolved implementation qualification: no fault control yet holds a run's Clean up operation Running (P9). S11a depends on it. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S4, S5, S7, S8, S9, S10, S11, +S12, +S13, +S14, +S14a, +S14b · behavior-change
  Run Clean up lists only prepared links, clones and copies, and starts them selected. The Results folder, the originals and rejected frames are never listed, so the protected-product step and the duplicate step are retired (old ids 6 and 11a). Views are runs in the Project. A Complete run can be reopened, and a run that is no longer wanted goes to the Project's Trash. Move run to Trash is refused while another run uses its Results and moves no file. Restore brings the run back unchanged, and Empty Trash sends its prepared folders and a ticked Results folder to the OS Trash and leaves in place what cannot go there (G4 retired, answered by D-W72).
  Evidence: specs/071-storage-custody STO-FR-01, STO-FR-03, STO-AC-01, STO-AC-20. specs/069-application-handoff PREP-FR-14, PREP-AC-19. D-W26, D-W43 at e4476231. D-W66, D-W70, D-W72. 070 RES-FR-01, RES-FR-07, RES-FR-10, RES-AC-19 to RES-AC-22. 066 VSEL-FR-17 and 065 PRJ-FR-04, PRJ-FR-20. 071 STO-FR-01, STO-FR-10, STO-FR-16, STO-FR-17, STO-AC-24 and 069 PREP-FR-14 · by: JourneysC (intent-gated)
- **Δ3** 2026-10-10 · S1, S2, S4, S5, S7, S8, S10, S11, +S11a, S13, S14, S14a, S14b · behavior-change
  Runs use Complete, which previews open steps, and Clean up is the Done step's list of prepared entries, all preselected beside the run's footprint. Rejected frames and intermediates move only in the Project's Wrap up. Move to Trash gives a terse refusal naming each blocker, now also while the run's Clean up is Running (new P9 hold, G5).
  The Project Trash is its own page: trashed runs with their stage, Restore per row, Empty this run in the row menu and Empty Trash in the header, each Empty Trash running one trash operation.
  Evidence: HARNESS-V5-IA.md §Screens S3, S5, S8, S9 and §Fix pass; HARNESS-V5-FEEDBACK-R1.md §Copy rules, §Domain and seed (P-WRAP1, Storage), §Screens B and C, §Round 5 (P-SB3, runs read as one model) (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-10 · by: JourneysV5.U5WrapUp (intent-gated)
