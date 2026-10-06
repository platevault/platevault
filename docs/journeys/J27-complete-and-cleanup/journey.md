---
id: J27
title: Complete a processing run, clean up its prepared entries, and abandon or reopen a run
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [results, cleanup, storage, run-workspace, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 069-application-handoff, 070-results-reuse, 071-storage-custody, 065-project-goals, D09, D16, D19, D-W26, D-W43, D-W51, D-W64, D-W65, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, specs/071-storage-custody/spec.md, specs/065-project-goals/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-i-completion-and-selectable-cleanup]
---

## Goal

The user records that a processing run is finished, whether it has an
accepted Result. Clean up then sends the run's prepared entries (links,
clones and copies) to the OS Trash. The run's Results folder, the
originals, accepted products and masters stay out of Clean up entirely. The
user also abandons a run and reopens it. Done means:
- Both runs read Complete, and completing them removed nothing.
- Clean up listed only prepared entries and removed only the reviewed selection, to the OS Trash, without following link targets.
- An entry that may hold the last copy of a capture was refused.
- A location without safe Trash refused removal, with no permanent-delete fallback.
- The abandoned run was read-only until it was reopened with its decisions unchanged.

## Preconditions

- P1: Fresh replay of J24 and J26 (J25 not run). Siril is not running. `NGC7000-HOO-Siril Results/` also holds one file PlateVault does not recognize.
- P2: From J24/S16 and J24/S17, `28 Sep Ha copy check` is Prepared on `Scratch`, which has no OS Trash. Revision 1 holds 56 copies and revision 2 holds 55. The run has no Result.
- P3: In an isolated test OS account or disposable VM containing only these generated fixtures, unlink one named 30 Sep capture directly from its generated source folder, without using or emptying the OS Trash. Its prepared hardlink in `NGC7000-HOO-Siril/` becomes the fixture's last copy. Record the exact fixture path and its pre-unlink hash. Real libraries and unrelated Trash contents are outside this setup.
- P4: Record a baseline inventory of the isolated account's Trash without deleting anything. Also record a manifest of the remaining captures, every file in `NGC7000-HOO-Siril Results/`, and the adopted master. Trash checks compare only this journey's newly added entries against that baseline.
- P5: A second final image saved by the user outside the run, at `Work/Finals/NGC7000-HOO-crop.tif`.
- P6: Run `26 Sep symlink check` in Project `NGC 7000 HOO`, created from the 26 Sep session, prepared under `Work/Processing/NGC 7000 HOO/26 Sep symlink check/` in Linked View with 35 symlink entries, then marked Complete with no Result. Outside PlateVault, its run folder also receives `extra/`, holding a byte copy of one named 26 Sep capture. Record the J19/P5 entries of the 26 Sep session.
- P7: A helper outside PlateVault saves a named file's bytes and nanosecond mtime, then overwrites the file in place with a same-size variant whose bytes differ and restores the saved mtime. The helper later restores the saved bytes and mtime.
- P8: `24 Sep flat check` reads Complete (J24/S15). It has no preparation revision.

## Steps

### S1 — Complete a run with no Result {#S1}

- **Do:** Open `28 Sep Ha copy check` and click **Mark processing complete**.
- **Expect:** The run reads Complete with no accepted Result, and **Clean up** is offered as a separate action.
- **Expect (negative):** No file is removed and no cleanup starts.
- **Trace:** flow I1, cross-flow "Completion with no Result" · RES-FR-06 · RES-AC-06 · root SC-006

### S2 — Complete the main run {#S2}

- **Do:** Open `NGC7000-HOO-Siril` and click **Mark processing complete**.
- **Expect:** The run reads Complete, its accepted Results are unchanged, and the Project page's stage rail shows it at Done.
- **Expect (negative):** Completion removes nothing and does not claim that Siril processing stopped or succeeded.
- **Trace:** flow I1 · RES-FR-06 · PRJ-FR-20 · D09, D-W26

### S3 — Edit a Complete run {#S3}

- **Do:** In `NGC7000-HOO-Siril`, try **Exclude from run** on an included frame. Then edit the run's notes, attach `Work/Finals/NGC7000-HOO-crop.tif` as a Final image, and accept it.
- **Expect:** The exclusion is refused until **Reopen** is chosen explicitly, because it would create a new membership revision. The notes edit and the Result acceptance go through, the crop reads User-linked, and the run stays Complete.
- **Expect (negative):** No membership or preparation revision takes effect while the run reads Complete. Editing notes and accepting a Result neither reopen the run nor change its fixed membership.
- **Trace:** RES-FR-07 · RES-AC-08 · D09

### S4 — Open Clean up {#S4}

- **Do:** Click **Clean up**.
- **Expect:** One group, **Prepared hardlinks**, lists the 208 entries of revision 1 in `NGC7000-HOO-Siril/`, with count, size, proposed action and **Inspect files**. The group starts selected.
- **Expect (negative):**
  - Nothing in `NGC7000-HOO-Siril Results/` is listed: not the intermediates, the log, the unknown file, the accepted stacks, the attached images, or the generated master source.
  - No original capture or library frame is listed.
  - The selection does not cover the whole run directory.
  - Clean up offers no way to move rejected frames to the Trash.
- **Trace:** flow I2 · STO-FR-01, STO-FR-03 · STO-AC-01, STO-AC-20 · PREP-FR-14 · PREP-AC-19 · D-W26, D-W43

### S5 — Inspect and choose entries {#S5}

- **Do:** Click **Inspect files** and deselect one hardlink entry.
- **Expect:** Each entry shows its path, its role, other run or Project references, retained-original evidence and estimated bytes. The group reads 207 of 208 selected.
- **Expect (negative):** Link sizes are not presented as guaranteed reclaimed bytes.
- **Trace:** flow I3 · STO-FR-02

### S7 — Review cleanup {#S7}

- **Do:** Click **Review cleanup**.
- **Expect:**
  - The review lists exactly the 207 selected entries and the 1 retained entry. The default action is **Send to OS Trash**.
  - Trash support for `Work` shows movable and blocked counts.
  - The P3 hardlink entry is blocked for insufficient retained-original proof. The other 206 selected entries show a verified retained original.
- **Expect (negative):** No entry with stale identity, missing retained-original proof, an unavailable source or ambiguous ownership is approved.
- **Trace:** flow I4 · STO-FR-04 · STO-AC-04

### S8 — Send the selected entries to Trash {#S8}

- **Do:** With the P7 helper, overwrite the original capture behind one selected hardlink entry after the review. Then confirm **Send selected entries to Trash**. Afterwards, restore that capture's saved bytes and mtime with the helper.
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

- **Do:** In `28 Sep Ha copy check`, click **Clean up**, keep both preselected groups, review, and confirm **Send selected entries to Trash**.
- **Expect:** Clean up lists the 56 copies of revision 1 and the 55 copies of revision 2 in separate groups. Trash support reads unsupported for `Scratch`, all 111 copies are refused, and **Keep files** and **Reveal location** are offered.
- **Expect (negative):** No permanent-delete fallback is offered, and no copy is removed. Nothing in `Work/Outputs/28 Sep Ha copy check Results/` is listed.
- **Trace:** flow I4, I5, cross-flow "Cleanup/Trash failure" · STO-FR-01, STO-FR-04, STO-FR-05 · STO-AC-03 · PREP-FR-11 · root FR-010 · D-W51

### S11 — Remove symlink entries {#S11}

- **Do:** Open `26 Sep symlink check`, click **Clean up**, keep the preselected **Prepared symlinks** group, click **Review cleanup**, and confirm **Send selected entries to Trash**.
- **Expect:** The group lists the 35 symlink entries, and the review shows each link's identity and target path. After execution the 35 links are newly in the OS Trash.
- **Expect (negative):**
  - The `extra/` copy is not listed and remains, because the preparation did not create it.
  - No file under `Astro-T7/Captures/26 Sep` reaches the Trash, every 26 Sep capture matches its P6 record, and no link target or target directory is traversed or removed.
- **Trace:** flow I4, I5 · STO-FR-01, STO-FR-04, STO-FR-05 · STO-AC-08 · PREP-AC-19

### S12 — Reopen a Complete run {#S12}

- **Do:** Open `24 Sep flat check` and choose **Reopen**.
- **Expect:** The run reads open, not Complete. Its membership and calibration decisions are unchanged, and **Exclude from run** is available again.
- **Expect (negative):** Reopening removes no file and does not create a membership revision. Clean up is not offered, because the run is not Complete.
- **Trace:** RES-FR-07 · RES-AC-08 · PREP-FR-14 · D09

### S13 — Abandon a run {#S13}

- **Do:** In `24 Sep flat check`, choose **Abandon run**. Then try **Exclude from run** and a change in Review matches. Open Project `NGC 7000 HOO` and read the OIII goal.
- **Expect:**
  - The run reads Abandoned, and the stage rail shows it as Abandoned. It is kept read-only: the exclusion and the Review matches change are refused, each naming Abandoned.
  - The OIII goal's "in project" number is unchanged, because the 24 Sep frames still count once through `NGC7000-HOO-Siril`.
- **Expect (negative):** Abandoning removes no file and changes no other run's membership or quality state.
- **Trace:** PRJ-FR-04, PRJ-FR-20 · D-W64

### S14 — Reopen the abandoned run {#S14}

- **Do:** Choose **Reopen** on `24 Sep flat check`.
- **Expect:** The run is open again, at the stage it held before it was abandoned. Its membership, the S7a accepted flat assignment from J23 and its notes are unchanged, and edits are accepted again.
- **Expect (negative):** Reopening creates no membership revision and moves no file.
- **Trace:** D-W64

## Success criteria

- SC1: Completing either run removes 0 files and starts 0 cleanups (S1, S2).
- SC2: Clean up lists only prepared entries: 208 hardlinks (S4), 111 copies (S10) and 35 symlinks (S11). It lists 0 files from a Results folder, 0 originals and 0 files the preparation did not create.
- SC3: Every removed entry is in the OS Trash, and the P4 manifest still matches after the restore (S8).
- SC4: The last-copy hardlink is refused and remains (S7, S8).
- SC5: On `Scratch`, 0 files are removed, and no permanent-delete action exists (S10).
- SC6: A Complete run refuses membership edits until Reopen and accepts a notes edit and a Result acceptance. It still reads Complete after reviewed cleanup (S3, S8).
- SC7: Trashing 35 symlinks leaves 100% of the 26 Sep captures and the `extra/` copy matching P6 (S11).
- SC8: An entry whose bytes changed after review is removed 0 times (S8).
- SC9: The abandoned run accepts 0 edits until reopened, and the OIII "in project" number changes by 0 (S13). Reopening restores editing with 0 changes to its decisions (S14).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs, the decisions D09, D16 and D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G2: Out of scope for this journey: Direct-source Clean up needs a prepared Direct-source run, and no journey prepares one yet. That Clean up shows that preparation created no entries and offers nothing to remove (PREP-AC-20, STO-AC-02). Blocks readiness until covered.
- G3: Out of scope for this journey: removing replaced prepared entries before Complete (STO-FR-10, D09) is not exercised. Blocks readiness until covered by a step or a journey.
- G4: Unresolved product question: D-W64 has no spec requirement yet. The specs do not say which stage an Abandoned run reopens to, or how an Abandoned run with a prepared revision counts for the Done / Archive trash refusals. S13 and S14 follow D-W64 alone. Blocks readiness.
- G5: Out of scope for this journey: D-W65's refusal to remove a rig from a Project while a run that is not Abandoned uses it is not exercised. Blocks readiness until covered by a step or a journey.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S4, S5, S7, S8, S9, S10, S11, +S12, +S13, +S14 · behavior-change
  Run Clean up lists only prepared links, clones and copies, and starts them selected. The Results folder, the originals and rejected frames are never listed, so the protected-product step and the duplicate step are retired (old ids 6 and 11a). Views are runs in the Project. A run can be reopened, or abandoned (kept read-only) and reopened.
  Evidence: specs/071-storage-custody STO-FR-01, STO-FR-03, STO-AC-01, STO-AC-20; specs/069-application-handoff PREP-FR-14, PREP-AC-19; D-W26, D-W43, D-W64 · by: JourneysC (intent-gated)
