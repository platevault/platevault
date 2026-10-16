---
id: J24
title: Build and open a Project View
version: 8
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [preparation, projects, sessions, applications, status-bar]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 069-application-handoff, 070-results-reuse, D02, D04, D09, D13, D15, D19, D-W3, D-W5, D-W94, D-W98, D-W100, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-f-prepare-and-open-the-view, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#c-run-and-run-group, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-5, P-SB3, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-7, P-PREP3, RUN-VIEWS-OPTIONS.md, 066-view-selection, 068-calibration-inputs, 071-storage-custody, D-W99, D-W101, specs/066-view-selection/spec.md, specs/068-calibration-inputs/spec.md, specs/071-storage-custody/spec.md, D-W113]
---

## Goal

The user builds the Project's View from its selected originals, reviews the exact inputs and layout before applying, and opens the View in Siril only after its entries verify. The first Apply builds `View/`; later changes stay pending until Apply. Symlinks is the default mode and links to catalogue originals. Copies is the alternative, and becomes clones where the volume supports it. The Project folder holds `View/`, `Processing/<Tool>/` and `Output/`, not a separate folder for each processing attempt.

Done means:
- `Work/Processing/NGC 7000 HOO/View/` contains all 208 selected light entries and the pinned calibration inputs, with each entry verified against its original snapshot.
- The first Apply builds `View (building)/`, checks it, swaps it into `View/`, and does not change an original.
- On Windows with Developer Mode off, Apply in Symlinks mode is refused and creates no View.
- The folder tree puts lights and flats beneath hyphenated `NIGHT_` folders, uses `GROUP_` folders only once the Project has several groups, and keeps tool work in `Processing/Siril/` and Results in `Output/`.
- Open in Siril launches only after it re-verifies the inputs in View; quitting Siril does not close the Project.
- Later membership, group and mode changes remain pending until Apply; Apply builds from originals and leaves any replaced View as `View (previous)/` until its entries are safely removed or retained for review.

## Preconditions

- P1: Project `NGC 7000 HOO` has one RedCat group with 208 Usable light frames, including a 56-frame session from 28 Sep. Every session is Ready and has settled, pinned calibration. All required originals are online and their manifest is recorded.
- P2: Siril is installed and added in Settings > Applications. Its profile has verified folder-input and read-only capability evidence, and its executable can be restored after the missing-application check.
- P3: `Work/Processing` is writable, supports symbolic links and file clones, and has free space for two complete Views. It holds the capture and Calibration locations.
- P4: `Scratch/Processing/NGC 7000 HOO/keep.txt` exists with unrelated content and a recorded SHA-256. `Scratch/Processing` is writable and can be unmounted during the journey; it does not support symbolic links.
- P5: The first chosen processing location is not set for this Project. The Project folder at `Work/Processing/NGC 7000 HOO/` does not exist.
- P6: The J19/P5 source manifest is available.
- P7: On the Windows `desktop-ui` lane, Developer Mode is off initially and can be enabled in Windows Settings. The macOS lane has no Developer Mode prerequisite.
- P8: A Windows file-handle fixture can hold one current View entry in use and release it on demand.
- P9: The master flat pinned on the 28 Sep session has a backup of its bytes and mtime and a same-size variant with different bytes, both kept outside PlateVault.

## Steps

### S1 — Choose the Project application and View mode {#S1}

- **Do:** Open the View step of Project `NGC 7000 HOO`. Read the application and input-mode controls, then choose Siril.
- **Expect:** The application dropdown lists only detected or added applications, including Siril. The View step shows the selected application, Symlinks as the Settings default, and Copies as the alternative. The mode descriptions distinguish links to originals (`Linked · 0 B`) from copies (`N frames copied · X GB`); on a clone-capable volume, the copy footprint says `(cloned)`.
- **Expect (negative):** The View step offers no Direct-source, file-list, Automatic or separate Clone mode. Changing the mode does not write a file or silently change another mode.
- **Trace:** PREP-FR-01, PREP-FR-02, PREP-FR-04 · VSEL-FR-16 · D-W83, D-W98, D-W100

### S1a — Meet the Windows Developer Mode refusal {#S1a}

- **Do:** On the Windows lane with Developer Mode off, choose Symlinks and click **Apply…**. Read the refusal, choose **Open Windows settings**, enable Developer Mode, return to PlateVault and choose **Check again**.
- **Expect:** Apply is refused with "Can't apply · symlinks need Windows Developer Mode ▸" and offers **Open Windows settings**, **Check again** and **Use copies for this Project**. After enabling Developer Mode, the refusal clears. On macOS there is no Developer Mode check.
- **Expect (negative):** The refused Apply creates no Project folder or View and does not switch the mode to Copies. The Settings default stays Symlinks.
- **Trace:** PREP-FR-15 · D-W81, D-W98, D-W100

### S4 — Choose a parent with an unrelated Project folder {#S4}

- **Do:** Choose `Scratch/Processing` as the processing location for this Project.
- **Expect:** The proposed Project path is `Scratch/Processing/NGC 7000 HOO/`. PlateVault identifies the existing folder and asks for another location or name instead of using it.
- **Expect (negative):** `keep.txt` and its containing folder remain byte-identical. PlateVault does not adopt, clear or write into the unrelated folder.
- **Trace:** PREP-FR-06 · D-W98, D-W100

### S5 — Lose the chosen processing location {#S5}

- **Do:** Unmount `Scratch` before choosing a replacement.
- **Expect:** PlateVault marks the chosen location unavailable and asks the user to choose another.
- **Expect (negative):** No other volume is substituted silently, and no Project folder is created on another volume.
- **Trace:** PREP-FR-06 · D-W98

### S6 — Choose the Project processing location {#S6}

- **Do:** Choose `Work/Processing` as the processing location.
- **Expect:** The proposed Project path is `Work/Processing/NGC 7000 HOO/`, marked new. Its layout preview contains `View/`, `Processing/Siril/` and `Output/`.
- **Trace:** PREP-FR-06, PREP-FR-07 · RES-FR-01 · D-W98

### S7 — Read the View and Output layout {#S7}

- **Do:** Read the Project layout preview.
- **Expect:** `View/` is the input folder. `Processing/Siril/` is Siril's working and output folder. `Output/` is the Project's Results folder; every file saved there is a Result, and no tool writes there.
- **Expect (negative):** No separate per-session processing folder, shared Results folder or output-as-input path is proposed.
- **Trace:** PREP-FR-06, PREP-FR-07 · RES-FR-01 · D-W93, D-W98

### S8 — Review the first Apply sheet {#S8}

- **Do:** Open **Apply…** and inspect the proposed inputs, calibration and layout.
- **Expect:** The sheet names the Project, Siril, Symlinks mode, all 208 light entries, pinned calibration, source paths, counts, footprint, free space and the exact first-Apply changes. Its folder tree puts lights and assigned flats in `NIGHT_2026-09-28/Lights/Ha_300s/` and `NIGHT_2026-09-28/Flats/Ha/`. With one group the `NIGHT_` folders and one-camera `Darks/` and `Bias/` sit at the top level, with no `GROUP_` level. The sheet does not count unknown or omitted inputs as placed.
- **Expect (negative):** Opening the sheet creates no files, changes no original and makes no calibration assignment. The sheet has no per-Project calibration matching controls.
- **Trace:** VSEL-FR-14, VSEL-FR-16 · PREP-FR-08, PREP-FR-16 · CAL-FR-09 · D-W99, D-W100, D-W101

### S8a — Refuse Apply while an original is offline {#S8a}

- **Do:** Close the sheet, take one named original needed by the View offline, and open **Apply…** again.
- **Expect:** The sheet names the offline original and Apply is disabled. After the original is back online, reopening the sheet lists it as available.
- **Expect (negative):** The View and `View (previous)/` remain unchanged while the original is offline. Apply never omits it silently.
- **Trace:** VSEL-FR-14 · PREP-FR-06 · D-W100

### S8b — Refuse Apply while a pinned flat file changed {#S8b}

- **Do:** Close the sheet. Outside PlateVault, overwrite the 28 Sep session's pinned master flat with its P9 variant and restore its mtime. Open the 28 Sep session in Sessions and read the **Needs calibration** filter, then open **Apply…** again. Restore the flat's P9 backup, read **Needs calibration** again and reopen **Apply…**.
- **Expect:** The session still shows the master flat pinned and reads it as changed, with **Reassign…**, and **Needs calibration** lists it. The sheet names the changed flat with a link to reassign it on the session, and Apply is refused. After the backup is restored, the session leaves **Needs calibration**, the reopened sheet names no changed flat, and Apply is available.
- **Expect (negative):** No other flat is pinned or placed by itself, and the pin is not removed. The View and `View (previous)/` stay unchanged while the flat differs, and the Project keeps the session.
- **Trace:** VSEL-FR-14 · CAL-FR-08 · LIB-FR-17, LIB-FR-23 · VSEL-AC-35, CAL-AC-29, LIB-AC-33 · D-W113

### S9 — Build the first View {#S9}

- **Do:** Confirm **Apply** and wait for the operation to settle.
- **Expect:** PlateVault builds `View (building)/` from the originals, verifies each entry and source snapshot, then installs the complete folder as `View/`. The operation ends Applied only after the swap. The 208 light entries match the selected inputs; Symlinks entries resolve to their verified originals and the footprint reads `Linked · 0 B`.
- **Expect (negative):** No original is moved, patched or changed. An acknowledgement or partial build does not read as Applied.
- **Trace:** PREP-FR-06, PREP-FR-09 · VSEL-FR-16 · D-W98, D-W100

### S10 — Open with a missing application {#S10}

- **Do:** Move the Siril executable out of its located path, then choose **Open in Siril**.
- **Expect:** Open is refused and names Siril as not located. The Project and its View remain in place.
- **Expect (negative):** PlateVault does not launch another application or change Project inputs to resolve the missing executable.
- **Trace:** PREP-FR-02, PREP-FR-10 · D-W83, D-W100

### S10a — Refuse Open after an original changed {#S10a}

- **Do:** Restore the Siril executable. Overwrite one named Symlinks target in place with a same-size variant, restore its recorded mtime, then choose **Open in Siril**.
- **Expect:** Open is refused and identifies the entry whose bytes differ from its Apply snapshot. The View reads unverified until the original bytes return or a new Apply replaces it.
- **Expect (negative):** Siril is not launched against the changed entry, and PlateVault writes nothing to the original or link.
- **Trace:** PREP-FR-10 · PREP-AC-15 · D19, D-W100

### S11 — Open Siril on the Project View {#S11}

- **Do:** Restore the original bytes and mtime. Choose **Open in Siril**, inspect the inputs, then quit Siril.
- **Expect:** Open re-verifies the entries against their Apply snapshots and launches Siril on `Work/Processing/NGC 7000 HOO/View/`. The last launch reads Opened.
- **Expect (negative):** Quitting Siril does not close the Project, change its stage or change the View.
- **Trace:** PREP-FR-10 · D-W93, D-W100

### S12 — Split a group and move a session {#S12}

- **Do:** In Sessions, split the RedCat group and move its 28 Sep session into the new group. Keep the suggested name `RedCat · 2`.
- **Expect:** Sessions shows the new group and the session's new group assignment. The group move and new group are pending Project changes.
- **Expect (negative):** The folder tree and current View do not change before Apply.
- **Trace:** VSEL-FR-12 · PRJ-FR-31 · D-W95, D-W100

### S13 — Switch the Project to Copies {#S13}

- **Do:** In the View step, switch the Project input mode from Symlinks to Copies.
- **Expect:** The mode switch is pending and the current View remains Symlinks until Apply. The View step shows Copies' storage requirements.
- **Expect (negative):** PlateVault does not fall back between modes, create copies early or alter the Settings default.
- **Trace:** PREP-FR-04 · VSEL-FR-12, VSEL-FR-16 · D-W98, D-W100

### S14 — Review the group and mode changes {#S14}

- **Do:** Open **Apply…** and inspect the changes and proposed folder tree.
- **Expect:** The sheet lists the session move with its from and to groups and the Copies mode switch. It shows the additional `GROUP_` level, the new tree, the note "re-add View in your tool", and the space needed for two full Views while Copies is built.
- **Expect (negative):** No group move or file change occurs until Apply is confirmed.
- **Trace:** VSEL-FR-14 · PREP-FR-08, PREP-FR-16 · D-W99, D-W100

### S15 — Wait for a file in use on Windows {#S15}

- **Do:** On Windows, hold one current View entry open using P8, confirm Apply, and wait until the new View has been built.
- **Expect:** After the build, Apply reads "Waiting for a tool to release a file in View" and waits for the file to be released.
- **Expect (negative):** The current View stays installed while Apply waits. PlateVault does not swap around the in-use file.
- **Trace:** PREP-FR-18 · D-W100

### S15a — Cancel the waiting Apply {#S15a}

- **Do:** Choose **Cancel** while Apply is waiting for the file to be released.
- **Expect:** Apply is canceled and the current View remains installed. The Project's pending group and mode changes remain available for another Apply.
- **Expect (negative):** The old View is not removed or sent to Trash, and no original changes.
- **Trace:** PREP-FR-18 · PREP-FR-09 · D-W100

### S16 — Release the file while Apply waits {#S16}

- **Do:** Hold the same View entry open again, confirm Apply, and release the file handle while Apply reads "Waiting for a tool to release a file in View".
- **Expect:** Apply continues by itself once the file is released, with no further confirmation, and swaps the new View into place. The old View becomes `View (previous)/`; old symlinks are removed with no-follow checks.
- **Expect (negative):** Apply does not move or reuse entries from the old View or change an original.
- **Trace:** PREP-FR-06, PREP-FR-09 · STO-FR-10 · D-W100

### S17 — Verify the rebuilt group layout and copies {#S17}

- **Do:** Inspect the new View tree and the Project's Apply details.
- **Expect:** The tree has `GROUP_` folders for RedCat and `RedCat · 2`, then hyphenated `NIGHT_` folders with `Lights/Ha_300s/` and assigned `Flats/Ha/`. `Darks/` and `Bias/` are shared at the top for the one camera. Copies are fresh copies from originals and are clones on the fixture volume that supports clones. The previous View is removed after its recorded entries are safely removed.
- **Expect (negative):** No View entry is a hard link, to an original or to another copy, and no Result is inside View or written into Output by Siril.
- **Trace:** PREP-FR-04, PREP-FR-06, PREP-FR-16 · STO-FR-10 · D-W81, D-W98, D-W99, D-W100

## Success criteria

- SC1: The first Apply installs exactly 208 verified light entries and all pinned calibration inputs, with no original changed (S8, S9).
- SC2: An offline original is named, Apply is disabled and both View folders stay unchanged until it returns (S8a).
- SC3: Symlinks is the default, Copies is the only alternative, and Windows with Developer Mode off refuses Symlinks Apply without creating files (S1, S1a).
- SC4: The first single-group tree has no `GROUP_` level; after the split it has group folders, hyphenated `NIGHT_` folders, light folders named by filter and exposure, flat folders named by filter and the one-camera shared `Darks/` and `Bias/` folders (S7, S8, S17).
- SC5: Siril launches 0 times when an executable is missing or an input differs from its Apply snapshot, and launches after the originals are restored and entries verify (S10, S10a, S11).
- SC6: Group and mode changes leave the current View unchanged until Apply, and the Apply sheet names the move, mode, folder tree, layout note and space for two Views (S12, S13, S14).
- SC7: While Windows holds a View entry, Apply waits after building; cancel keeps the current View, and releasing the file allows a later Apply to swap in the complete new View (S15, S15a, S16).
- SC8: Copies on the clone-capable volume read as cloned; old entries are not reused, symlinks are removed without following targets, and no original changes (S16, S17).
- SC9: A changed pinned flat refuses Apply with a link to reassign it, 0 other flats are pinned, and the pin stays (S8b).

## Known gaps

- G1: Not validated: the rebuilt application has not been validated; the Project View behavior is specified by 066, 069 and 071 as amended by D-W93 to D-W116.
- G2: Unresolved implementation qualification: Siril's exact handoff and its input-write behavior (P2) need a profile capability probe (D04). S1 depends on it. Blocks readiness.
- G3: (dissolved 2026-10-12): answered by §Round 7 P-PREP3: Run view is one mode per run, Symlinks or Copies, so no preparation mixes entry kinds, and no original is re-hashed after a run.
- G4: Unresolved implementation qualification: the specs do not say which Apply phases offer Cancel "where safe" (PREP-FR-09) besides the file-in-use wait of S15a. The Canceled outcome of the other phases is not exercised. Blocks readiness.
- G5: (dissolved 2026-10-15): there is no Prepare to pause. S15 and S15a stop Apply on a file in use instead (D-W100, PREP-FR-18), and the fixture they need is G11.
- G6: (dissolved 2026-10-12): answered by §Round 7 P-PREP3 (Symlinks by default from Settings, Copies as the alternative, no hard links or junctions); S1 asserts Symlinks preselected, S1a the Windows Developer Mode refusal, S9 and S16 the footprints ("Linked · 0 B", "56 frames copied · 12.4 GB"), and S10a an original's change caught when Open re-verifies.
- G7: (dissolved 2026-10-12): answered by Round 6 "Results location override stays"; S14 now asserts the default Results folder beside the run folder and the override to `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/`.
- G8: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S12 now asserts the run starting as `NGC 7000 RedCat` and its rename on the run header to `28 Sep Ha copy check`.
- G9: (dissolved 2026-10-12): answered by Round 6 "Reject is library-wide by default"; S17 now makes revision 2 with "Reject for this Project only" on one 28 Sep frame, whose library quality stays Usable, as in J22/S11b.
- G10: (dissolved 2026-10-15): D-W94 removes runs and their saved and prepared revisions. A library rejection becomes a labelled pending change on every open Project that holds the frame (D-W100, VSEL-FR-12), so there is no other run's revision to define.
- G11: Unresolved implementation qualification: the Windows file-handle fixture of P8 does not exist in the rebuilt application yet, and S15, S15a and S16 depend on it. Blocks readiness.
- G12: Rests on provisional F4 items, pending the owner's confirmation in PR #1804: D-W100's rule that the first Apply builds the View with no separate Start processing (S8, S9), the "Use copies for this Project" refusal copy of PREP-FR-15 (S1a), D-W95's "re-add View in your tool" layout note (S14), and D-W108's exposure part that ends every light folder name, `Ha_300s` (S8, S17). If the owner changes one, the steps that cite it change.

## Delta log
- **Δ2** 2026-10-06 · S1, S4, S6, S7, S8, S9, S10, S12, S13, S14, S15, +S17 · behavior-change
  Views are processing runs in a Project. A run prepares to `<output>/<Project>/<Run>/`, Results go to the sibling `<Run> Results/`, and each new revision gets a `(rev 2)` folder that shares that one Results folder. The check runs are created in the Project, and their pickers start with every candidate selected. A running preparation refuses Move run to Trash exactly as it refuses Mark processing complete.
  Evidence: specs/069-application-handoff PREP-FR-06, PREP-FR-07, PREP-FR-11, PREP-AC-01, PREP-AC-21. D-W3, D-W49, D-W51, D-W67 at e4476231. D-W67, D-W72. 069 PREP-FR-06, PREP-FR-07, PREP-FR-11 and PREP-AC-21 as amended. 070 RES-FR-07, RES-FR-10, RES-AC-20 · by: JourneysC (intent-gated)
- **Δ3** 2026-10-12 · S1, old 2, old 3, S4, S6, S7, S8, S9, S10, S10a, S11, S12, S13, S14, S15, S15a, S16, S17 · behavior-change
  Prepare shows Application (profile cards with evidence), Input mode (Linked run, Direct source, Copy, Clone, none preselected) and a layout preview, with checks and a confirmation that names what it creates. The outcome shows the footprint (prepared bytes), "Partial 53/56" with Prepared and Blocked lists, and "(rev 2)".
  Open refuses tersely with its blockers ("Siril not located", changed entries), replacing Choose application / Reveal run folder. The header's actions read Complete and Move to Trash. Start run takes the profile as optional.
  Evidence: HARNESS-V5-IA.md §Screens S5 (Prepare: "profile, mode, layout preview, (rev N), Partial lists, Open re-verifies"; Refusals) and §Fix pass ("Gate words"); HARNESS-V5-FEEDBACK-R1.md §Copy rules, §Screens B (Start run sheet) and C ("show the footprint (prepared bytes)"), §Round 5 P-SB3; prototype src/features/v5/c-runs/prepare-step.tsx, actions.ts, run.tsx and messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U3Runs (intent-gated)
- **Δ4** 2026-10-12 · S1, old 2, old 3, S8, S9, S10a, S11, S12, S13, S14, S16, S17 · behavior-change
  Input mode is Automatic by default, with Independent copy, Link to originals (opt-in, with a warning) and Give PixInsight the file list (not for Siril); hard links and Direct source are gone. Entries are cloned or copied, read-only once verified, and the footprint shows the real extra space ("0 B extra · cloned", "12.4 GB copied").
  The check run starts auto-named and is renamed on the run header, keeps the Results location override, and gets revision 2 from a Project-only reject.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Rename runs and Projects", "Results location override stays", "Reject is library-wide by default" (apps/prototype/design/ on ui-harness-v5 @ 4f470775) and §Input modes (user, 2026-10-10) P-PREP2 (@ d609ff55; research INPUT-MODES-RESEARCH.md); user answers to the PR #1788 journey questions · by: JourneysV5.R6B (intent-gated)
- **Δ5** 2026-10-12 · S1, +S1a, retired old 2 and 3, S8, S9, S10a, S11, S13, S14, S16 · behavior-change
  Run view replaces Input mode: Symlinks by default from Settings ("Linked · 0 B"), or Copies, which are temporary and removed when the run completes ("56 frames copied · 12.4 GB"). On Windows, Prepare in Symlinks needs Developer Mode and is refused without it, offering Open Windows settings, Check again and Use copies for this run. Old steps 2 (the file-list mode) and 3 (the linked-originals warning) are retired, and no original is re-hashed after a run.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 7 (user, 2026-10-12) P-PREP3 (apps/prototype/design/ on ui-harness-v5 @ 12638a7c; research RUN-VIEWS-OPTIONS.md) · by: JourneysV5.R7Prep3 (intent-gated)
- **Δ6** 2026-10-15 · S1, S1a, S4, S5, S6, S7, S8, +S8a, S9, S10, S10a, S11, S12, S13, S14, S15, S15a, S16, S17 · behavior-change
  The Project's first Apply builds its View from originals; later group and mode changes stay pending until Apply. The sheet, folder tree, safe swap, Windows file-use wait and verified Open describe the Project View rather than a processing run. Δ2 to Δ5 above stay as the run journey's history. G2 and G4 stay open, G5 and G10 are dissolved, and G11 and G12 are new.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, VSEL-FR-12 to VSEL-FR-21, PREP-FR-01 to PREP-FR-19, STO-FR-10 · by: SpecF4Writer2 (intent-gated)
- **Δ7** 2026-10-16 · +S8b · behavior-change
  When a pinned calibration file changes, the pin stays, the session reads the file as changed, and Apply refuses with a link to reassign it; nothing switches by itself.
  Evidence: D-W113 (owner's answers of 2026-10-15/16) in PR #1804, CAL-FR-08, LIB-FR-23, VSEL-FR-14, VSEL-AC-35, CAL-AC-29 · by: SpecF4Answers (intent-gated)
- **Δ8** 2026-10-16 · S8, S8b, S17 · behavior-change
  A session whose pinned flat changed waits in Needs calibration until the file is restored, and the Project keeps it. Light folders end in their exposure, `Lights/Ha_300s/` (provisional), while flat folders keep the filter name.
  Evidence: D-W108 and D-W113 as amended by the owner's second batch of 2026-10-16 in PR #1804, PREP-FR-16, LIB-FR-17, LIB-FR-23, LIB-AC-33, CAL-AC-29 · by: EncodeOwnerAnswers2 (intent-gated)
