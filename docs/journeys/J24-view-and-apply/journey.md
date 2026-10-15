---
id: J24
title: Build and open a Project View
version: 6
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [preparation, projects, sessions, applications, status-bar]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 069-application-handoff, 070-results-reuse, D02, D04, D09, D13, D15, D19, D-W3, D-W5, D-W49, D-W51, D-W67, D-W72, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/069-application-handoff/spec.md, specs/070-results-reuse/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-f-prepare-and-open-the-view, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#c-run-and-run-group, HARNESS-V5-FEEDBACK-R1.md#b-projects-project-new-project-start-run-trash-wrap-up, HARNESS-V5-FEEDBACK-R1.md#round-5, P-SB3, HARNESS-V5-FEEDBACK-R1.md#round-6, HARNESS-V5-FEEDBACK-R1.md#round-7, P-PREP3, RUN-VIEWS-OPTIONS.md, 066-view-selection, 068-calibration-inputs, 071-storage-custody, D-W94, D-W98, D-W99, D-W100, D-W101, specs/066-view-selection/spec.md, specs/068-calibration-inputs/spec.md, specs/071-storage-custody/spec.md]
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
- **Expect:** The sheet names the Project, Siril, Symlinks mode, all 208 light entries, pinned calibration, source paths, counts, footprint, free space and the exact first-Apply changes. Its folder tree puts lights and assigned flats in `NIGHT_2026-09-28/Lights/Ha/` and `NIGHT_2026-09-28/Flats/Ha/`. With one group the `NIGHT_` folders and one-camera `Darks/` and `Bias/` sit at the top level, with no `GROUP_` level. The sheet does not count unknown or omitted inputs as placed.
- **Expect (negative):** Opening the sheet creates no files, changes no original and makes no calibration assignment. The sheet has no per-Project calibration matching controls.
- **Trace:** VSEL-FR-14, VSEL-FR-16 · PREP-FR-08, PREP-FR-16 · CAL-FR-09 · D-W99, D-W100, D-W101

### S8a — Refuse Apply while an original is offline {#S8a}

- **Do:** Close the sheet, take one named original needed by the View offline, and open **Apply…** again.
- **Expect:** The sheet names the offline original and Apply is disabled. After the original is back online, reopening the sheet lists it as available.
- **Expect (negative):** The View and `View (previous)/` remain unchanged while the original is offline. Apply never omits it silently.
- **Trace:** VSEL-FR-14 · PREP-FR-06 · D-W100

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
- **Expect:** The tree has `GROUP_` folders for RedCat and `RedCat · 2`, then hyphenated `NIGHT_` folders with `Lights/Ha/` and assigned `Flats/Ha/`. `Darks/` and `Bias/` are shared at the top for the one camera. Copies are fresh copies from originals and are clones on the fixture volume that supports clones. The previous View is removed after its recorded entries are safely removed.
- **Expect (negative):** No hard link points to an original, and no Result is inside View or written into Output by Siril.
- **Trace:** PREP-FR-04, PREP-FR-06, PREP-FR-16 · STO-FR-10 · D-W98, D-W99, D-W100

## Success criteria

- SC1: The first Apply installs exactly 208 verified light entries and all pinned calibration inputs, with no original changed (S8, S9).
- SC2: An offline original is named, Apply is disabled and both View folders stay unchanged until it returns (S8a).
- SC3: Symlinks is the default, Copies is the only alternative, and Windows with Developer Mode off refuses Symlinks Apply without creating files (S1, S1a).
- SC4: The first single-group tree has no `GROUP_` level; after the split it has group folders, hyphenated `NIGHT_` folders, filter-value subfolders and the one-camera shared `Darks/` and `Bias/` folders (S7, S8, S17).
- SC5: Siril launches 0 times when an executable is missing or an input differs from its Apply snapshot, and launches after the originals are restored and entries verify (S10, S10a, S11).
- SC6: Group and mode changes leave the current View unchanged until Apply, and the Apply sheet names the move, mode, folder tree, layout note and space for two Views (S12, S13, S14).
- SC7: While Windows holds a View entry, Apply waits after building; cancel keeps the current View, and releasing the file allows a later Apply to swap in the complete new View (S15, S15a, S16).
- SC8: Copies on the clone-capable volume read as cloned; old entries are not reused, symlinks are removed without following targets, and no original changes (S16, S17).

## Known gaps

- G1: The rebuilt application has not been validated; the Project View behavior is specified by 066, 069 and 071 as amended for D-W94 to D-W106.
- G2: The Windows file-lock fixture in P8 is not yet available in the rebuilt application. S15 and S15a depend on that fixture.

## Delta log
- **Δ6** 2026-10-15 · S1, S1a, S4, S5, S6, S7, S8, +S8a, S9, S10, S10a, S11, S12, S13, S14, S15, S15a, S16, S17 · behavior-change
  The Project's first Apply builds its View from originals; later group and mode changes stay pending until Apply. The sheet, folder tree, safe swap, Windows file-use wait and verified Open describe the Project View rather than a processing run.
  Evidence: D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, VSEL-FR-12 to VSEL-FR-21, PREP-FR-01 to PREP-FR-19, STO-FR-10 · by: SpecF4Writer2 (intent-gated)
