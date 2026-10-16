---
id: J27
title: Wrap up a Project and clean up its files
version: 6
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [wrap-up, cleanup, projects, results, activity, status-bar]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 066-view-selection, 069-application-handoff, 070-results-reuse, 071-storage-custody, 065-project-goals, D09, D16, D19, D-W26, D-W43, D-W98, D-W96, D-W97, D-W94, P-WRAP1, P-SB3, P-PREP3, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/066-view-selection/spec.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, specs/071-storage-custody/spec.md, specs/065-project-goals/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-i-completion-and-selectable-cleanup, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S8, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#copy-rules, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed, HARNESS-V5-FEEDBACK-R1.md#b-projects, HARNESS-V5-FEEDBACK-R1.md#c-run-and-run-group, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-7-user-2026-10-12-run-views-research-designrun-views-optionsmd, D-W100]
---

## Goal

The user wraps up the open Project `NGC 7000 HOO` through Clean up, Trash and Archive, then closes it. Clean up offers to remove the Project's View and shows what `View (previous)/` still holds. Trash offers rejected frames, `Processing/` files and duplicate copies, but never `Output/`. Done means:
- Clean up offers to remove the View, selected by default for Copies and not selected for Symlinks, and lists remaining `View (previous)/` entries separately.
- Reviewed Copies go to the OS Trash only when retained-original proof succeeds. PlateVault-placed Symlinks are deleted only after a no-follow identity and target check.
- Changed entries, missing retained-original proof and unsupported Trash leave files in place; no permanent-delete fallback is offered.
- Trash offers rejected frames, files in `Processing/` and duplicate copies; `Output/` and protected master files stay out of the offers.
- Archive shows source and destination paths, retains sessions held by another open Project, and closes the Project after selected transfers succeed. Closed and Archived Projects cannot be reopened.

## Preconditions

- P1: Project `NGC 7000 HOO` is open, its View is in Copies mode with 208 entries, and `View (previous)/` holds one copy whose original could not be verified and a notes file left unticked during Apply.
- P2: A second open Project has a Symlinks View with 35 PlateVault-placed links. Its recorded link identities, target paths and target digests are available for comparison.
- P3: A Copies View on `Scratch` contains 111 entries; `Scratch` has no safe OS Trash.
- P4: Record a baseline inventory of the isolated account's OS Trash and a manifest of the remaining captures, View entries, Processing files, Output files and adopted master. Compare only new Trash entries against that baseline.
- P5: A helper outside PlateVault saves a selected copy's original bytes and nanosecond mtime, then changes the original in place to same-size different bytes and restores its mtime; it can restore the saved bytes and mtime later.
- P6: Forty frames have library quality Unusable; three are in the View of another open Project and four are also held by a Closed Project.
- P7: The Project's `Processing/` contains 118 tool files and the generated source of an adopted master whose library copy is known. Its `Output/` contains two Results.
- P8: A frame has byte-identical copies in Captures location A and B; B was registered later. The B copy is a source of a Symlinks View in another open Project.
- P9: A fault control can hold Apply running on a separate open Project until released.
- P10: The Project to close holds four sessions, `Wrap-1` to `Wrap-4`. Another open Project also holds `Wrap-2`; an online Archive location is available for the selected sessions.

## Steps

### S1 — Open Wrap up after clearing pending changes {#S1}

- **Do:** With two group moves pending, open Wrap up and read the gate. Choose its link to View, discard both pending changes, then open Wrap up again.
- **Expect:** Before the changes are cleared, Wrap up reads "Apply or discard 2 changes first ▸" and leads to View. Once no change or Project operation is pending, Wrap up opens at Clean up and shows the ordered steps Clean up → Trash → Archive.
- **Expect (negative):** Trash and Archive are not available for editing before Clean up is Finished or Skipped.
- **Trace:** PRJ-FR-14, PRJ-FR-32 · VSEL-FR-12 · D-W80, D-W97

### S2 — Review Copy-mode cleanup offers {#S2}

- **Do:** In Project `NGC 7000 HOO`'s Clean up step, read the View and `View (previous)/` rows and expand the previous-view entries.
- **Expect:** The View removal row starts selected for Copies. The unverifiable copy and the notes file in `View (previous)/` are listed separately and start unselected, with their exact paths and sizes.
- **Expect (negative):** `Processing/`, `Output/`, originals and library files are not listed for Clean up.
- **Trace:** STO-FR-01, STO-AC-01 · PRJ-FR-14 · D-W97, D-W100

### S3 — Review Symlinks-mode cleanup offers {#S3}

- **Do:** Open the other Project's Clean up step and read the Symlinks View row.
- **Expect:** The View removal row starts unselected. Its item count and proposed action identify the 35 links PlateVault placed.
- **Expect (negative):** The View target files and target directories are not included in the selection.
- **Trace:** STO-FR-01, STO-AC-01 · PRJ-FR-14 · D-W81, D-W97

### S4 — Inspect cleanup entries {#S4}

- **Do:** Expand the selected View row and inspect its entries before changing the selection.
- **Expect:** Each entry shows its path, role, other Project references, retained-original evidence and estimated bytes. Each copy is its own entry with its own size, and no entry is a hard link (PREP-FR-04).
- **Expect (negative):** Link sizes are not presented as guaranteed reclaim, and files outside the View and `View (previous)/` are not included.
- **Trace:** STO-FR-01, STO-FR-02 · STO-AC-08 · PREP-FR-04 · D-W81, D-W97

### S5 — Choose View entries for cleanup {#S5}

- **Do:** Deselect one entry in the Copies View and leave the `View (previous)/` entries unticked.
- **Expect:** The selected count falls by one, and the deselected entry remains visible with its path and evidence.
- **Expect (negative):** No file moves when the selection changes; unticked entries remain in place.
- **Trace:** STO-FR-01, STO-FR-02 · D-W97, D-W100

### S7 — Review the selected cleanup plan {#S7}

- **Do:** Choose the Clean up review action and read the proposed filesystem changes.
- **Expect:** The review lists exactly the selected View and `View (previous)/` entries, with their identities, content digests and retained-original evidence; copies are proposed for the OS Trash and verified PlateVaul-placed symlinks for deletion.
- **Expect (negative):** An entry with stale identity, missing retained-original proof, unavailable source or ambiguous ownership is not approved for removal.
- **Trace:** STO-FR-04, STO-AC-04 · D19, D-W97, D-W100

### S8 — Apply the reviewed cleanup {#S8}

- **Do:** With the P5 helper, change the original behind one selected copy after review, then confirm cleanup.
- **Expect:** Progress reports per-entry outcomes. The copy whose original no longer matches its retained-original evidence is refused and named; other selected copies are moved to the OS Trash. The Project records removed and remaining entries.
- **Expect (negative):** The changed copy and all unticked entries remain in place; no symlink target is followed and no file is permanently deleted.
- **Trace:** STO-FR-04, STO-FR-05 · STO-AC-09, STO-AC-15 · D19, D-W100

### S9 — Restore a removed View copy {#S9}

- **Do:** Put one removed View copy back from the OS Trash before emptying the Trash.
- **Expect:** The copy is restored by the OS; PlateVault's cleanup summary and record identify the entries it removed and the entries left in place.
- **Expect (negative):** PlateVault does not promise restoration after the OS Trash has been emptied.
- **Trace:** STO-FR-05 · D-W97

### S10 — Refuse cleanup without safe Trash {#S10}

- **Do:** In the Copies Project on `Scratch`, select the View for Clean up and review the Trash support.
- **Expect:** All 111 copies are blocked because `Scratch` has no safe OS Trash; **Keep files** and **Reveal location** are offered.
- **Expect (negative):** No copy is removed and no permanent-delete fallback is offered. `Processing/` and `Output/` files do not appear in the cleanup list.
- **Trace:** STO-FR-04, STO-FR-05 · STO-AC-03 · D-W97

### S11 — Remove verified Symlinks {#S11}

- **Do:** In the Symlinks Project, select its View for Clean up, review the 35 link entries and confirm removal.
- **Expect:** The operation deletes verified PlateVault-placed symlinks without following them, reports per-entry outcomes and records what remains. The recorded target files remain byte-identical.
- **Expect (negative):** Symlink targets and target directories are not traversed, changed or sent to the OS Trash.
- **Trace:** STO-FR-01, STO-FR-04, STO-FR-05 · STO-AC-08, STO-AC-25 · D-W81, D-W97

### S11a — Refuse Wrap up during an Apply {#S11a}

- **Do:** Arm P9 to hold Apply running on a separate open Project, then try to open that Project's Wrap up. Release Apply after reading the refusal.
- **Expect:** Wrap up is refused and names the running Apply operation. After Apply settles and no change is pending, the Project can enter Wrap up.
- **Expect (negative):** The refusal starts no cleanup or Trash move and does not stop Apply.
- **Trace:** PRJ-FR-14 · RES-AC-07 · PREP-FR-19 · D-W97, D-W100

### S12 — Review rejected-frame Trash offers {#S12}

- **Do:** In the Trash step of Wrap up, review the rejected-frame offer for the 40 Unusable frames in P6.
- **Expect:** The offer covers 37 frames. The three frames in another open Project are not selectable and name that Project; the four frames also held by a Closed Project are included.
- **Expect (negative):** Frames still in the View of another open Project are not moved, and no View copy is offered as a rejected original.
- **Trace:** PRJ-FR-15 · STO-FR-14, STO-FR-15 · STO-AC-18 · D-W43, D-W79, D-W97

### S13 — Review Processing and duplicate-copy offers {#S13}

- **Do:** Review the other groups in Wrap up's Trash step for the Project in P7 and the duplicate-copy fixture in P8.
- **Expect:** The step offers `Processing/` files and eligible duplicate copies as separate groups. Its file list identifies the kept library copy for a duplicate. For the P8 frame, the kept copy is the one in location A, the earlier-registered Captures location, and the B copy is listed as not selectable with a "Linked by" reason that names the other open Project, whose Symlinks View links it. `Output/` Results are excluded; the generated source of an adopted master is identified as a duplicate and names the kept library copy.
- **Expect (negative):** No file in `Output/` or protected candidate-master source is offered, the P8 frame's B copy is not offered for the move, and no duplicate is moved unless the kept copy re-verifies.
- **Trace:** PRJ-FR-14, PRJ-FR-15 · PRJ-AC-30 · STO-FR-16 · STO-AC-21, STO-AC-23 · RES-FR-06 · D-W74, D-W97, D-W98

### S14 — Archive sessions and close the Project {#S14}

- **Do:** In the Archive step, review the sessions for `NGC 7000 HOO`, expand the selected rows and confirm each file's from and to paths. Choose **Close project…** and confirm.
- **Expect:** `Wrap-2` is not selectable and names the other open Project that holds it. The selected sessions show their source and archive paths. After confirmation the Project reads Closing while the transfer runs, then Archived when it succeeds; `Output/` remains in place.
- **Expect (negative):** No file moves before confirmation. `Wrap-2` stays at its source path, and files in `Output/` are neither archived nor trashed.
- **Trace:** PRJ-FR-14 · STO-FR-06, STO-FR-07, STO-FR-13 · STO-AC-17 · RES-FR-06 · D-W97, D-W98

### S14a — Confirm the Closed Project stays locked {#S14a}

- **Do:** Open the Closed or Archived Project's menu and inspect its available actions.
- **Expect:** The Project is read-only and has no Reopen action. **Duplicate…** is available as the route to continue working from its sessions and settings.
- **Expect (negative):** Library or calibration changes do not edit the Closed or Archived Project, and it cannot be reopened.
- **Trace:** PRJ-FR-25, PRJ-FR-30 · STO-FR-13 · D-W96, D-W97

### S14b — Duplicate the closed Project without files {#S14b}

- **Do:** Choose **Duplicate…** from the Closed Project's menu and open the new Project.
- **Expect:** The new open Project has the copied sessions, groups, overrides, goals, notes and settings, but no files. It has no link or "Duplicated from" note; its first Apply builds a new View from the originals.
- **Expect (negative):** Duplicate… does not copy `View/`, `Processing/` or `Output/` files.
- **Trace:** PRJ-FR-30 · STO-AC-07 · D-W96, D-W97

## Success criteria

- SC1: Wrap up remains gated until pending changes and Project operations are cleared, and presents Clean up → Trash → Archive in order (S1).
- SC2: The Copies View starts selected for removal, the Symlinks View starts unselected, and `View (previous)/` entries are listed separately and unticked (S2, S3).
- SC3: Cleanup review lists exactly selected View entries, excludes originals, `Processing/` and `Output/`, and only removes files after the review succeeds (S4, S5, S7, S8).
- SC4: A copy without retained-original proof and an entry changed after review are refused; verified Symlinks are deleted without following targets (S8, S9, S11).
- SC5: Unsupported Trash moves 0 files and offers no permanent-delete fallback (S10).
- SC6: Wrap up is refused while Apply runs and names the operation; a later step cannot proceed before Clean up is Finished or Skipped (S1, S11a).
- SC7: The rejected-frame offer covers 37 of the 40 Unusable frames and names the 3 held by another open Project as not selectable (S12).
- SC8: Trash offers `Processing/` files and eligible duplicate copies, identifies each kept copy, and excludes `Output/` (S13).
- SC9: Archive identifies each file's source and destination, retains `Wrap-2` while another open Project holds it, and closes the Project only after the selected transfer succeeds (S14).
- SC10: Closed and Archived Projects cannot be reopened; Duplicate… copies Project data but copies 0 files (S14a, S14b).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Expected behavior follows specs 063 to 072 and workflow decisions D-W93 to D-W116 in PR #1804; no implementation has been validated against them.
- G2: (dissolved 2026-10-12): answered by §Round 7 P-PREP3: there is no file-list mode, so every run's Clean up lists the entries of its run folder.
- G3: (dissolved 2026-10-15): D-W100 replaces preparation revisions with `View (previous)/`. S2 lists what it still holds in Clean up, and J25/S7c covers its review before the next Apply (STO-FR-10).
- G5: Unresolved implementation qualification: no fault control yet holds Apply running on a separate open Project (P9), and S11a depends on it. Blocks readiness.
- G6: (dissolved 2026-10-12): answered by §Round 7 P-PREP3 ("No verification of originals after a run"): no original is re-hashed after a run.
- G7: (dissolved 2026-10-15): there is no Complete confirmation. Wrap up's Clean up removes the View (S7, S8, S11) under D-W97, and S7 and S8 refuse a copy without verified retained-original proof (STO-FR-04).
- G8: Rests on provisional F4 items, pending the owner's confirmation in PR #1804: D-W97's Clean up offer of the View with Copies ticked and Symlinks unticked, plus whatever `View (previous)/` still holds (S2, S3, SC2), and its "Apply or discard N changes first" gate copy (S1). If the owner changes one, the steps that cite it change.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S4, S5, S7, S8, S9, S10, S11, +S12, +S13, +S14, +S14a, +S14b · behavior-change
  Run Clean up lists only prepared links, clones and copies, and starts them selected. The Results folder, the originals and rejected frames are never listed, so the protected-product step and the duplicate step are retired (old ids 6 and 11a). Views are runs in the Project. A Complete run can be reopened, and a run that is no longer wanted goes to the Project's Trash. Move run to Trash is refused while another run uses its Results and moves no file. Restore brings the run back unchanged, and Empty Trash sends its prepared folders and a ticked Results folder to the OS Trash and leaves in place what cannot go there (G4 retired, answered by D-W72).
  Evidence: specs/071-storage-custody STO-FR-01, STO-FR-03, STO-AC-01, STO-AC-20. specs/069-application-handoff PREP-FR-14, PREP-AC-19. D-W26, D-W43 at e4476231. D-W66, D-W70, D-W72. 070 RES-FR-01, RES-FR-07, RES-FR-10, RES-AC-19 to RES-AC-22. 066 VSEL-FR-17 and 065 PRJ-FR-04, PRJ-FR-20. 071 STO-FR-01, STO-FR-10, STO-FR-16, STO-FR-17, STO-AC-24 and 069 PREP-FR-14 · by: JourneysC (intent-gated)
- **Δ3** 2026-10-12 · S1, S2, S4, S5, S7, S8, S10, S11, +S11a, S13, S14, S14a, S14b · behavior-change
  Runs use Complete, which previews open steps, and Clean up is the Done step's list of prepared entries, all preselected beside the run's footprint. Rejected frames and intermediates move only in the Project's Wrap up. Move to Trash gives a terse refusal naming each blocker, now also while the run's Clean up is Running (new P9 hold, G5).
  The Project Trash is its own page: trashed runs with their stage, Restore per row, Empty this run in the row menu and Empty Trash in the header, each Empty Trash running one trash operation.
  Evidence: HARNESS-V5-IA.md §Screens S3, S5, S8, S9 and §Fix pass; HARNESS-V5-FEEDBACK-R1.md §Copy rules, §Domain and seed (P-WRAP1, Storage), §Screens B and C, §Round 5 (P-SB3, runs read as one model) (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U5WrapUp (intent-gated)
- **Δ4** 2026-10-12 · S1, S2, S3, S4, S5, S7, S8, S9, S12 · behavior-change
  There is no Exclude from run, so a Complete run's locked membership is shown by trying to clear a session in Select, and Reopen makes Select editable again. Library-Unusable frames are offered by Wrap up and by the library clean-up (J44), never by run Clean up.
  P-PREP2: `NGC7000-HOO-Siril` holds clones and `26 Sep symlink check` uses Link to originals. Completing a run offers its Clean up with the real footprint (`<size> copied`, or `0 B extra · cloned` and frees no space), and an entry whose original changed since review is refused.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Reject is library-wide by default", "There is no separate Exclude from run" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); §Input modes (user, 2026-10-10) P-PREP2 (@ d609ff55); user answers to the PR #1788 journey questions · by: JourneysV5.R6E (intent-gated)
- **Δ5** 2026-10-12 · S1, S2, S4, S5, S7, S8 · behavior-change
  `NGC7000-HOO-Siril` and `26 Sep symlink check` use the Symlinks run view, and `28 Sep Ha copy check` uses Copies. Complete's confirmation offers **Remove run view** and the run's intermediates, both ticked and both through the OS Trash; S1 and S2 untick them. The last-copy fixture (old P3) and the re-hash of originals are gone.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3, "No verification of originals after a run", "Intermediates cleanup stays" (apps/prototype/design/ on ui-harness-v5 @ 12638a7c; research RUN-VIEWS-OPTIONS.md) · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ6** 2026-10-15 · S1, S2, S3, S4, S5, S7, S8, S9, S10, S11, S11a, S12, S13, S14, S14a, S14b · behavior-change
  Projects now close through Wrap up: Clean up removes the View and surfaces `View (previous)/`, Trash offers rejected frames, `Processing/` files and duplicate copies, and Archive precedes Close project…. `Output/` is kept, and Closed or Archived Projects cannot be reopened. G2 and G6 stay dissolved, G3 and G7 are dissolved, G5 now covers the Apply hold, and G8 is new. P10's sessions are `Wrap-1` to `Wrap-4`, so their names don't collide with step ids.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 065 PRJ-FR-14 and PRJ-FR-15, 071 STO-FR-01 to STO-FR-05, STO-FR-10, STO-FR-14 to STO-FR-16 · by: SpecF4Writer2 (intent-gated)
