---
id: J36
title: Stack raw calibration frames into masters and keep the master library
version: 4
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [calibration, calibration-process, settings, applications, issues, status-bar, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [HARNESS-V5-IA.md#S14, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2b-foundation-status-bar-and-p-cal3-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions-user-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-5-user-2026-10-10, HARNESS-V5-FEEDBACK-R1.md#copy-rules-every-screen-every-slice, P-CAL2, P-CAL3, P-SB3, apps/prototype/src/domain/calibration-process.ts, apps/prototype/src/store/actions/calibration.ts, apps/prototype/src/store/simulation.ts, apps/prototype/src/features/v5/e-targets-plan-settings/calibration.tsx, apps/prototype/src/features/v5/e-targets-plan-settings/settings-calibration.tsx, apps/prototype/messages/en-GB.json, 068-calibration-inputs, specs/068-calibration-inputs/spec.md, HARNESS-V5-FEEDBACK-R1.md#round-6]
---

## Goal

Indexing found raw darks, bias and flats in the Calibration location. The user
turns each raw session into a master through its calibration process. Stack
hands the raw frames to a stacking application, and PlateVault watches the
application's output folder. It detects the master, imports it into structured
calibration storage and registers it with the file it came from, recording no
inputs (D-W93). It then
moves the raw frames to the OS Trash unless the user keeps them. Masters
stacked elsewhere are picked as files, checked in a match preview and imported
into storage. The user reads the master library, opens a master's details, and
hides and restores one.
Light sessions are later matched to these masters at ingestion (J23). Done means:
- Each of the four raw sessions has a registered master in its structured storage folder, and three masters stacked elsewhere are imported, so the library holds 7 masters.
- Every raw frame either went to the OS Trash after its master registered, or stayed in place because the user kept it.
- Every refusal and failure named its reason, and each failed process resumed from the step where it stopped.
- No file is permanently deleted, and the sources of the imported masters are unchanged.

## Preconditions

- P1: J19 completed, and nothing after it: no Project exists. `Astro-T7/Calibration` is the registered Calibration location, and J19/S7a made each P2 raw session a calibration process awaiting Stack. Settings › Calibration › **Keep raw calibration frames** is off, the default.
- P2: The raw calibration fixture that J19 indexed in `Astro-T7/Calibration` (J19/P4, J23/P2). Every frame has INSTRUME `ZWO ASI2600MM Pro`, the J15 alias of camera ASI2600MM, so the `{camera}` folder token reads `ASI2600MM` as in J31. Every frame also has the dimensions, 1x1 binning, gain, offset and set temperature of the J19/P2 RedCat lights. This fixture fixes those values as gain 100, offset 50 and −10 °C:
  - `Raw/Darks/300s/2026-09-20/`: 20 darks of 300 s.
  - `Raw/Bias/2026-09-20/`: 50 bias frames.
  - `Raw/Flats/Ha/2026-09-18/`: 30 Ha flats with TELESCOP `RedCat 51`, the RedCat optical-train evidence.
  - `Raw/Flats/OIII/2026-09-30/`: 30 OIII flats with TELESCOP `RedCat 51`.
- P3: `Astro-T7/Stacked elsewhere/`, outside every registered location, holds a plain-text `notes.txt` and four masters stacked in another application, each with IMAGETYP master and NCOMBINE:
  - `MasterFlat_OIII_2026-09-26.xisf`: an OIII flat of the night of 2026-09-26, NCOMBINE 25, with INSTRUME `ZWO ASI2600MM Pro` and the P2 dimensions, binning, gain and offset. It has no TELESCOP, so it carries no optical-train evidence.
  - `MasterFlat_OIII_Esprit.xisf`: an OIII flat of the night of 2026-09-22, NCOMBINE 20, with INSTRUME `ZWO ASI2600MM Pro`, the P2 dimensions, binning, gain and offset, and TELESCOP `Esprit 100`, the optical train of rig Esprit.
  - `MasterDark_ASI294MM_300s.xisf`: a 300 s dark of the night of 2026-09-12, NCOMBINE 30, with INSTRUME `ZWO ASI294MM Pro`, a camera on no rig.
  - `MasterBias_2026-06-15.xisf`: a bias master of the night of 2026-06-15, NCOMBINE 40, with INSTRUME `ZWO ASI2600MM Pro` and the P2 dimensions, 1x1 binning, gain 100, offset 50 and −10 °C. Its kind and settings match the bias master that S8 registers, and its bytes differ. Its night is further from every J19 and J33 session than 20 Sep, so it is never the closest version for them.
- P4: Settings › Applications holds the PixInsight and Siril profiles, and both can stack masters. PixInsight's executable reads found, located as in J41. Siril is installed, but its executable is not located, as J23/P4 needs.
- P5: A stand-in for PixInsight (G2). On demand, it writes into a given folder the master that PixInsight's WBPP writes for a raw session. The master has IMAGETYP master of the session's kind and NCOMBINE equal to its raw frame count. It keeps the raw frames' camera, dimensions, gain, offset, binning, filter and telescope, and has a WBPP name such as `masterDark_BIN-1_EXPOSURE-300.00s.xisf`.
- P6: A manifest (relative path, size, SHA-256) of `Astro-T7/Calibration/` and `Astro-T7/Stacked elsewhere/`, recorded outside PlateVault before S1.

## Steps

### S1 — Find the raw sessions waiting to stack {#S1}

- **Do:** Open the Calibration library and read it.
- **Expect:**
  - Process lists four rows, one per raw session, each with its frame count: `Dark 300 s · 20 Sep` (20), `Bias · 20 Sep` (50), `Flat Ha · 18 Sep` (30) and `Flat OIII · 30 Sep` (30).
  - Each row reads `To stack` and offers a Tool picker and **Stack**. Its steps Stack → Detect → Import → Register → Raws each read `To do`, and Stack is current.
  - Masters reads `No masters`.
- **Expect (negative):** No raw session is listed as a master, and none appears in Sessions. Every file under `Astro-T7/Calibration/` still matches P6. The waiting state shows on the Process rows themselves, with no Issues hub to visit.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3 steps 1–2 · HARNESS-V5-IA.md §Screens S14 and §Round 2b foundation (routing) · CAL-FR-01 · D-W92 (no Issues hub; problems show on their row)

### S2 — Stack with an application that is not set up {#S2}

- **Do:** On `Dark 300 s · 20 Sep`, pick Siril in the Tool picker and click **Stack**.
- **Expect:** The row shows the refusal `Stack blocked` with the blocker `Siril not set up` in its disclosure, linked to Settings › Applications. The row still reads `To stack`.
- **Expect (negative):** No output folder is created, no work starts, and nothing is handed to Siril.
- **Trace:** HARNESS-V5-IA.md §Screens S14 (tool picker, failure as a terse Refusal) and §Round 2b foundation (store actions refused with reasons) · HARNESS-V5-FEEDBACK-R1.md §Copy rules (terse refusals)

### S3 — Stack the darks and relaunch while PixInsight works {#S3}

- **Do:** Pick PixInsight and click **Stack**. Before the P5 stand-in writes anything, quit PlateVault, launch it again and reopen the Calibration library.
- **Expect:**
  - Stack reads Done and Detect reads Running. The row reads `Stacking` and offers **Detect now** and **Cancel**.
  - The empty output folder `Astro-T7/Calibration/Stacking/Dark 300 s 20 Sep/` exists, and the row's ① note names it as its Output.
  - PlateVault hands PixInsight the 20 raw darks together with that output folder (G2).
  - The status bar's running work reads `Stack Dark 300 s · 20 Sep`, with a progress bar of unknown size and Cancel on hover or focus.
  - After the relaunch the row still reads `Stacking` with Detect Running, and the watch is still listed as running work.
- **Expect (negative):** No master is registered, and no raw dark moves. The relaunch raises no failed or interrupted work issue for the watch.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3 steps 2–3 and §Round 5 P-SB3 · HARNESS-V5-IA.md §Round 2b foundation (`startStack`, the watch survives a restart, `stackOutputFolder`)

### S4 — Meet an occupied master path at Import {#S4}

- **Do:** Outside PlateVault, create an unrelated file at `Astro-T7/Calibration/Darks/ASI2600MM/300s_g100_o50_-10C/MasterDark_2026-09-20.xisf` and record its SHA-256. Then make the P5 stand-in write the dark master into the S3 output folder, and wait without acting.
- **Expect:**
  - Detect reads Done with no user action, and the row's ① note reads Detected `masterDark_BIN-1_EXPOSURE-300.00s.xisf · NCOMBINE 20`.
  - Import reads Failed. The row reads Failed, shows `Import failed · Name taken` and offers **Retry**.
  - Activity records the stack as failed with `Name taken at Import.`
- **Expect (negative):**
  - Register and Raws stay To do: no master is registered or listed.
  - All 20 raw darks stay in `Raw/Darks/300s/2026-09-20/`, and nothing is in the OS Trash.
  - The unrelated file keeps its recorded SHA-256, and the detected master in the output folder is unchanged.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3 steps 3–4 · HARNESS-V5-IA.md §Round 2b foundation (structured storage, `importMaster` failures, issue `calibration-failed`) · CAL-FR-07

### S5 — Retry after clearing the path {#S5}

- **Do:** Outside PlateVault, move the S4 file to `Astro-T7/Holding/`. Click **Retry** on `Dark 300 s · 20 Sep`.
- **Expect:**
  - Import, Register and Raws read Done in that order, and the row reads `Done`. The Raws step's tooltip reads Trashed.
  - The master is stored at `Astro-T7/Calibration/Darks/ASI2600MM/300s_g100_o50_-10C/MasterDark_2026-09-20.xisf` with the detected master's SHA-256. Masters lists it under Darks with 20 frames.
  - The 20 raw darks are in the OS Trash, and Activity records `Trash raws of Dark 300 s · 20 Sep`.
  - The row shows `Done` in place of `Import failed · Name taken`, and the three other Process rows still read `To stack`.
- **Expect (negative):** No raw dark reached the OS Trash before Register read Done. None is permanently deleted: each can be put back from the OS Trash. The moved S4 file keeps its SHA-256.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3 steps 4–6 · HARNESS-V5-IA.md §Screens S14 (Retry) and §Round 2b foundation (`importMaster`, Raws) · D-W92 (problems show on their row)

### S6 — Detect before the application has written {#S6}

- **Do:** On `Flat OIII · 30 Sep`, keep PixInsight, click **Stack** and then at once **Detect now**. Then make the P5 stand-in write the OIII flat master into that process's output folder, and click **Retry**.
- **Expect:**
  - Detect now fails. The row reads Failed and shows `Detect failed · Tool output not found`, with the output folder `Flat OIII 30 Sep` as its blocker.
  - The Tool picker shows again, and the row menu offers **Retry** and **Stack again**. The watch is no longer running work.
  - After Retry, Detect, Import, Register and Raws read Done. The master is stored under `Astro-T7/Calibration/Flats/`, in the RedCat train's folder, as `OIII/2026-09-30/MasterFlat_2026-09-30.xisf`. The 30 raw OIII flats are in the OS Trash.
- **Expect (negative):** While Detect read Failed, no master was registered and no raw flat moved. Retry does not hand the raws to PixInsight again: Stack keeps the time of its first Done.
- **Trace:** HARNESS-V5-IA.md §Screens S14 (Detect now, Retry, failure as a terse Refusal) and §Round 2b foundation (`detectMasters`: "Tool output not found") · HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3

### S7 — Cancel a stack and start again {#S7}

- **Do:** On `Flat Ha · 18 Sep`, click **Stack** with PixInsight, then click **Cancel** before the stand-in writes. Then click **Stack** again and make the stand-in write the Ha flat master.
- **Expect:**
  - After Cancel the row reads `To stack` again. Stack reads To do with the reason `Canceled`, Detect reads To do, and the watch is no longer running work.
  - After the second Stack, the watch detects the master by itself. Detect, Import, Register and Raws read Done with no further user action.
  - The master is stored under `Astro-T7/Calibration/Flats/`, in the RedCat train's folder, as `Ha/2026-09-18/MasterFlat_2026-09-18.xisf`. The notification history records `MasterFlat_2026-09-18.xisf registered from 30 frames.`
  - The 30 raw Ha flats are in the OS Trash.
- **Expect (negative):** Cancel moves no raw flat and registers nothing.
- **Trace:** HARNESS-V5-IA.md §Screens S14 (Cancel) and §Round 2b foundation (Cancel puts Stack back to todo) · HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3

### S8 — Keep the raw bias frames {#S8}

- **Do:** Open Settings › Calibration and turn **Keep raw calibration frames** on. In the Calibration library, click **Stack** on `Bias · 20 Sep` with PixInsight, and make the stand-in write the bias master. Then turn the setting off again.
- **Expect:**
  - Settings › Calibration first shows the switch off, with the ⓘ help `Off: raws go to the OS Trash once their master registers.` It names the Calibration location, the master layout templates and the stacking tools, linked to Locations, Naming and Applications.
  - The bias master is stored at `Astro-T7/Calibration/Bias/ASI2600MM/g100_o50/MasterBias_2026-09-20.xisf` and listed under Bias with 50 frames. Raws reads Done with `Kept`, and the row offers **Trash raws**.
  - With the setting off again, Raws still reads Kept and **Trash raws** is still offered.
- **Expect (negative):** The 50 raw bias frames stay in `Raw/Bias/2026-09-20/`, also after the setting is turned off, and nothing goes to the OS Trash.
- **Trace:** HARNESS-V5-IA.md §Screens S16 (Calibration: Keep raw calibration frames, off by default) and §Round 2b foundation (`setKeepRawCalibration`, `keepRaws`) · HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3 step 6

### S9 — Import master files and review their matches {#S9}

- **Do:** In the Calibration library, click **Import masters**. In the native file dialog, open `Astro-T7/Stacked elsewhere/`, select `MasterFlat_OIII_2026-09-26.xisf`, `MasterFlat_OIII_Esprit.xisf` and `MasterDark_ASI294MM_300s.xisf` together, read the preview table and confirm. Then click **Import masters** again, select the same three files and read the preview.
- **Expect:**
  - The dialog picks files, several at once, not a folder, and filters to FITS and XISF files, so `notes.txt` is not offered.
  - The first preview lists the three files, each with its kind, camera, gain and offset, temperature and exposure read from its headers, and each reads **New**, because no library master has its kind and settings. Nothing is imported before the confirmation.
  - After the confirmation the import reads `3 masters imported`. Process gains three rows that read `Done`, one per file: `Flat · MasterFlat_OIII_2026-09-26.xisf`, `Flat · MasterFlat_OIII_Esprit.xisf` and `Dark · MasterDark_ASI294MM_300s.xisf`. In each, Stack reads Skipped, and no raw frame is involved.
  - Each master is copied into its structured storage folder. The two flats go under `Astro-T7/Calibration/Flats/` in the filter and night folders `OIII/2026-09-26/` and `OIII/2026-09-22/`, as `MasterFlat_2026-09-26.xisf` and `MasterFlat_2026-09-22.xisf`. The dark goes under `Astro-T7/Calibration/Darks/ZWO ASI294MM Pro/` as `MasterDark_2026-09-12.xisf`.
  - The second preview reads **Duplicate** for all three files, and its confirmation imports none.
- **Expect (negative):** The three sources and `notes.txt` stay in `Astro-T7/Stacked elsewhere/` and match P6. The second import writes no copy and adds no process.
- **Trace:** CAL-FR-13, CAL-AC-15 · D-W82, D-W103 · HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3 ("A stacked master from elsewhere imports directly"), Round 9 C9 (Import masters selects files, then a preview table with each file's match) · HARNESS-V5-IA.md §Screens S14 (Import masters)

### S9a — Import a new version of the bias master {#S9a}

- **Do:** Click **Import masters**, select `MasterBias_2026-06-15.xisf` in `Astro-T7/Stacked elsewhere/`, read the preview and confirm. Open the bias master's details.
- **Expect:**
  - The preview reads **New version of** the S8 bias master, named by its kind and camera (`New version of {master}`, provisional copy), with the file's kind, camera, gain and offset and temperature read from its headers.
  - After the confirmation, Process gains a `Bias · MasterBias_2026-06-15.xisf` row that reads `Done`, with Stack Skipped. The file is copied into the bias master's structured storage folder, `Astro-T7/Calibration/Bias/ASI2600MM/g100_o50/`.
  - The bias master lists two dated versions, 15 Jun and 20 Sep, with no Latest mark. Masters still lists 7 masters, and Bias still lists 1.
- **Expect (negative):** The import adds no master record and repoints no session's pinned bias. The source file stays in `Astro-T7/Stacked elsewhere/` and matches P6.
- **Trace:** CAL-FR-13, CAL-FR-14, CAL-AC-15, CAL-AC-16 · D-W82, D-W103 · HARNESS-V5-FEEDBACK-R1.md Round 9 C9 · prototype calibration.ts masterImportMatch (ui-harness-v5)

### S10 — Read the master library by its storage keys {#S10}

- **Do:** In Masters, with the All filter, read each kind's box.
- **Expect:**
  - Flats lists 4 masters by train, filter and night: RedCat Ha 18 Sep (30 frames), RedCat OIII 30 Sep (30), Esprit OIII 22 Sep (20), and OIII 26 Sep with its train `–` (25).
  - Darks lists 2 masters by camera, exposure, gain, offset and temperature: ASI2600MM 300 s, gain 100, offset 50, −10 °C (20 frames), and ZWO ASI294MM Pro 300 s (30).
  - Bias lists 1 master by camera, gain and offset: ASI2600MM, gain 100, offset 50, with its 20 Sep version of 50 frames and its 15 Jun version from S9a.
- **Expect (negative):** No raw frame or raw session is listed among the masters, including the 50 kept raw bias frames. No master is listed twice.
- **Trace:** HARNESS-V5-IA.md §Screens S14 (masters grouped by kind in their structured-storage keys) · HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3 step 4

### S11 — Open a master's details {#S11}

- **Do:** Open the details of the master dark `MasterDark_2026-09-20.xisf`, then those of the imported OIII flat `MasterFlat_2026-09-26.xisf`.
- **Expect:**
  - The dark's details read: kind Dark, camera ASI2600MM, optical train and filter absent (each an en dash), exposure 300 s, gain 100 / offset 50, temperature −10 °C, binning 1x1 and frame count 20. They also show its created date, the file it was imported from in the application's output folder, its storage path and the SHA-256 recorded in S5. Used by counts no session (J23 reads it with sessions), and the panel offers **Hide**.
  - The OIII flat's details read optical train –, filter OIII and frame count 25, with the source imported from `Astro-T7/Stacked elsewhere/MasterFlat_OIII_2026-09-26.xisf`.
- **Expect (negative):** Opening details changes no master and no file, and Used by never expands the master row.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Calibration (master details panel; Used by is a popover)

### S12 — Hide a master and restore it {#S12}

- **Do:** Open the details of the ZWO ASI294MM Pro master dark `MasterDark_2026-09-12.xisf`, read its Used by, and click **Hide**. Read Masters with the All filter, then turn on **Show hidden** and click **Restore** on the dark. Read Masters with the All filter again.
- **Expect:**
  - Its Used by names no session, so Hide is accepted. The dark leaves the master list: with the All filter, Darks lists only the ASI2600MM 300 s master and Masters lists 6 masters. **Show hidden** lists the dark with **Restore**.
  - After Restore the dark is listed under Darks again with its storage path, SHA-256 and frame count 30, Masters lists 7 masters as in S10, and **Show hidden** lists no master.
- **Expect (negative):** Neither action moves, renames or deletes the master's file. It keeps its storage path and its SHA-256, and nothing goes to the OS Trash. No other master changes, and no confirmation or refusal names a Project.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Domain and seed P-CAL2 (dismiss is reversible), §Round 5 Calibration (Dismiss and Restore) and §Round 6 Calibration ("A dismissed master is never matched; Restore brings it back") · HARNESS-V5-IA.md §Screens S14 (Dismissed filter with Restore) · CAL-FR-16, CAL-FR-17 · D-W76 (Dismiss becomes Hide, with Show hidden), D-W106

## Success criteria

- SC1: After S9, Process lists 7 rows that read Done (4 stacked, 3 imported), and Masters lists exactly 7 masters: 4 flats, 2 darks and 1 bias (S10).
- SC2: 80 raw frames are in the OS Trash (20 darks, 30 Ha flats and 30 OIII flats), and the 50 raw bias frames stay in place. 0 raw frames moved before their master's Register read Done (S4 to S8).
- SC3: 0 files are permanently deleted, and every trashed raw frame can be put back (S5 to S7).
- SC4: Each refusal or failure registers 0 masters, moves 0 raw frames and names its reason: `Siril not set up` (S2), `Name taken` (S4) and `Tool output not found` (S6); in S9 the second preview reads Duplicate for 3 of 3 files and imports 0. Each failed process resumes at its failed step (S5, S6).
- SC5: The dark watch survives 1 relaunch (S3) and detects its master with 0 user actions (S4). The Ha flat watch registers its master with 0 user actions after Stack (S7).
- SC6: The P3 sources, `notes.txt` and the S4 file keep their recorded SHA-256 (S4, S5, S9, S9a).
- SC7: Hide and Restore change 0 bytes on disk. While the dark is hidden Masters lists 6 masters, and after Restore it lists 7 with the dark under Darks again (S12).
- SC8: At S9a the preview reads New version of the bias master for 1 of 1 file, and the import adds 0 master records and 1 version, so the bias master holds 2 versions (S9a, S10).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Behavior follows the harness v5 design, which the user instructed on 2026-10-12 that journeys describe. Its sources are `HARNESS-V5-IA.md` §Screens S14 and S16 and §Round 2b foundation, and `HARNESS-V5-FEEDBACK-R1.md` §Round 1b P-CAL3, §Domain and seed P-CAL2 and §Round 5 Calibration (apps/prototype/design/ on ui-harness-v5 @ b5e813a5), §Round 6 (@ 4f470775, not yet implemented in the prototype), plus the prototype's calibration process. No implementation has been validated against them.
- G2: Unresolved implementation qualification: the P5 stand-in does not exist. The design also does not say how PlateVault hands raw frames to a profile (a script, launch arguments or a watched folder), so S3 asserts only the output folder and the running watch. A real PixInsight or Siril stack is not exercised. Blocks readiness.
- G3: (dissolved 2026-10-12): answered by Round 6 "Dismiss is refused while a run uses the master", now Hide (D-W76); S12 asserts that a master no session uses hides, leaves the master list (6 masters) and returns with Restore (7). Hide and Move to Trash are refused while an open or finished Project (Closed or Archived) uses the master through its sessions (CAL-FR-17, provisional); no Project exists in this journey, so no step exercises that refusal.
- G4: Out of scope for this journey, and blocks readiness until covered by a step or a journey (dark flats are not on this list, because PlateVault never matches, suggests or assigns them):
  - Import routing raw calibration frames into a process awaiting Stack (J31);
  - Import failures for offline storage, `Copy did not verify` and `Write permission removed`;
  - a Raws failure that keeps refused frames;
  - **Trash raws** on kept raws;
  - a profile that cannot stack.

## Delta log

- **Δ2** 2026-10-12 · S12 · behavior-change
  Dismissing a master no run uses takes it out of the master list until Restore brings it back; a master that runs use cannot be dismissed (exercised in J23 and J26).
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Dismiss is refused while a run uses the master" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6D (intent-gated)
- **Δ3** 2026-10-15 · S11, S12 · behavior-change
  A master is Hidden, not Dismissed, with Show hidden and Restore, and its details name the file it was imported from but record no inputs. Light sessions are matched to masters at ingestion instead of runs being assigned them.
  Evidence: D-W76, D-W93, D-W101, D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 068 CAL-FR-02, CAL-FR-16, CAL-FR-17 · by: SpecF4Writer2 (intent-gated)
- **Δ4** 2026-10-17 · S1, S4, S5, S6, S8, S9, +S9a, S10, P3, +SC8 · behavior-change
  Import masters picks master files, several at once with FITS and XISF filters, and shows a preview table with each file's match (New, New version of {master}, Duplicate) before anything is imported; a repeat import reads Duplicate instead of a refusal. New S9a imports P3's new bias file as a second version of the S8 bias master. With no Issues hub, S1, S4, S5, S6 and S8 read the state on the Calibration rows and in Activity.
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C9 · D-W82, D-W92, D-W103 · CAL-FR-13, CAL-FR-14, CAL-AC-15, CAL-AC-16 · prototype calibration.ts masterImportMatch (ui-harness-v5) · by: JourneysR9c (intent-gated)
