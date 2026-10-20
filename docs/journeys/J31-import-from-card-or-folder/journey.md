---
id: J31
title: Import from a card or folder with Copy or Move and templated paths
version: 9
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [home, import, settings, naming, sessions, calibration, calibration-process, locations, activity, status-bar, issues, duplicates]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 068-calibration-inputs, 071-storage-custody, D19, D-W89, D-W11, D-W12, D-W20, D-W24, D-W96, D-W58, D-W93, D-W94, D-W101, D-W102, D-W103, D-W104, D-W105, specs/063-clean-rebuild-contract/spec.md, specs/064-library-inventory/spec.md, specs/068-calibration-inputs/spec.md, specs/071-storage-custody/spec.md, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#S13, HARNESS-V5-IA.md#S14, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2-foundation, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, P-CAL3, P-SB3, P-IMP2, apps/prototype/src/domain/devices.ts, apps/prototype/src/domain/templates.ts, apps/prototype/src/features/v5/a-home/import-model.ts, apps/prototype/src/features/v5/a-home/import-run.ts, D-W107]
---

## Goal

The user brings new captures into the library the way Lightroom imports
photos. They connect a capture device, whose capture layout PlateVault
recognises, or pick a saved source, a folder or an OS-mounted network path.
The preview splits each night's lights into sessions by framing, which the user
can merge or re-split, and lists each incoming light session with its Target, prefilled
from its pointing, with OBJECT shown only as a hint, and each session's darks, flats and bias
as pinned automatically, suggested (confirm it) or not found. The user
confirms the Target there, changes it, or picks Unclassified. They check the templated
destinations and choose Copy or Move. The import runs as an operation and
then lists what it filled. Lights land in a Captures location as sessions,
already filed under their Target or under the Unclassified folder. Raw
calibration frames wait in the Calibration location as calibration processes
awaiting Stack, and a master goes straight to structured calibration
storage. Import never waits for calibration: a light session whose
calibration isn't settled waits in Needs calibration. Frames with no frame
type and files still being written are held.
SHA-256 duplicates and destinations already taken by other bytes are
skipped. A source that vanishes mid-import pauses the import as Interrupted
until Retry. A saved source supports Import new, and an already organized
folder is added in place. Done means:

- Every imported light session carries the Target its preview showed at import, Confirmed, and its frames sit under that Target's `{target}` folder, or under `unclassified/…` when the user picked Unclassified. OBJECT never fills a Target or `{target}` by itself, and no file moves after an import.
- Intake splits a night's lights into sessions by framing: a meridian flip keeps one session, a larger shift starts a "… · framing 2" session, and the user can merge and re-split in the preview before anything is written.
- Every imported light and raw calibration file sits at its templated path with its original basename, the master sits at its structured-storage path, and every imported file matches its source's SHA-256.
- Copy leaves every source unchanged. Move sends a source to the OS Trash only after its destination verifies, and Move is unavailable for a source with no OS Trash.
- Held, duplicate and skipped items add nothing to the catalog, and files on a capture card raise no duplicates warning.
- Nothing is permanently deleted or overwritten.

## Preconditions

- P1: J19 completed through S14. `Astro-T7 captures` and `Cold-1 captures` are registered Captures locations and both are online. `Astro-T7 calibration` (`Astro-T7/Calibration`) is the registered Calibration location. The Target NGC 7000 exists (J19/S10). No Project exists. Settings › Naming holds the default templates: lights `{target}/{filter}/{date}/light/`, raw flats `Raw/Flats/{filter}/{date}/`, raw darks `Raw/Darks/{exposure}/{date}/` and master darks `Darks/{camera}/{exposure}_g{gain}_o{offset}_{set_temp}/`. Settings › Calibration › **Keep raw calibration frames** is off, the default.
- P2: Removable volume `Card-1` supports the OS Trash and is connected. It holds an ASIAIR layout: its frames sit under `Autorun/`, beside a `Plan/` folder. For the night of 2026-10-02 it holds:
  - 30 NGC 7000 Ha 300 s RedCat lights with OBJECT `NGC 7000` and pointing within NGC 7000's footprint, the first starting at 20:30 local time. 12 of them have a DATE-OBS after local midnight on 3 Oct. Three of them, `Light_Ha_0005.fits`, `Light_Ha_0017.fits` and `Light_Ha_0023.fits`, are clouded (J37/S6).
  - 6 OIII 300 s lights with no OBJECT, no pointing, and no TELESCOP or FOCALLEN, the first starting at 23:10 local time, after the first Ha light.
  - 10 Ha flats and 10 darks of 300 s.
  - 1 master dark stacked elsewhere, `dark-300s-stack.xisf`: IMAGETYP `Master Dark`, NCOMBINE 40, 300 s, INSTRUME `ASI2600MM`, gain 100, offset 50, CCD-TEMP −10 °C, DATE-OBS on the night of 2026-10-02.
  - 2 frames with no frame-type header.
  - 5 byte-identical copies of 28 Sep Ha lights under new names.
  - `Light_Ha_0031.fits`, a light that a fixture writer keeps appending to until it is told to stop.
- P3: `Astro-T7/Calibration/Raw/Darks/300s/2026-10-02/`, the folder the default raw dark template gives Card-1's darks, already holds a file with the same basename as one Card-1 dark and different bytes. It was written outside PlateVault after J19 and is not in the catalog.
- P4: Removable volume `Card-2` supports the OS Trash and is not connected before S9. Its folder `Night 2026-10-04/` matches no capture-layout rule and holds 12 NGC 7000 Ha 300 s RedCat lights from the night of 2026-10-04, with OBJECT `NGC7000` and no pointing (J37).
- P5: An SMB share that macOS has already mounted at `/Volumes/astro-share` holds `incoming/` with 20 NGC 7000 OIII 300 s RedCat lights from the night of 2026-10-05, with OBJECT `NGC 7000` and pointing within NGC 7000's footprint. Removing a file on this share deletes it immediately; the share has no OS Trash.
- P6: `Astro-T7/Archive-2025/` is an organized folder of 2025 light sessions outside every registered location.
- P7: Manifests (relative path, size, SHA-256) of `Card-1`, `Card-2`, `Card-4`, `astro-share/incoming`, `Archive-2025` and both destination locations, recorded outside PlateVault before S1. No file on `Card-2`, `Card-4`, `astro-share/incoming` or `Archive-2025` is byte-identical to a library frame or to another of these files.
- P8: Removable volume `Card-4` supports the OS Trash and is not connected before S10a. In an ASIAIR layout it holds 34 NGC 7000 Ha 300 s RedCat lights from the night of 2026-10-06. They have OBJECT `NGC 7000` and pointing within NGC 7000's footprint. The first 14 are at framing A, the next 10 at framing B after the meridian flip, with B's centre 12′ from A's and a rotation difference of 6°, and the last 10 return to A.

## Steps

### S1 — Open Import from Home {#S1}

- **Do:** On Home, click **Import** in the header.
- **Expect:** The Import sheet opens over Home with two tabs, `From a source` and `Library folder`. The toolbar also has its own Import entry. The source tab shows these sections:
  - **Removable devices** lists `Card-1` read as ASIAIR, with `65 files` and `60 new`. Its note `How Card-1 was recognised` names `Autorun and Plan folders`.
  - **Saved sources** reads `None saved`.
  - **Choose folder…** opens a picker for a device, a folder or a mounted share.

  Card-1 is preselected, because it is the connected device with new frames.
- **Expect (negative):** No "File into library" action or Inbox exists anywhere. No field accepts an SMB or URL address, and PlateVault offers no way to mount a share. Opening the sheet writes nothing (P7 still matches).
- **Trace:** Import · STO-IMP-FR-01 · LIB-FR-10, LIB-FR-19 · PRJ-FR-17 · D-W7, D-W11, D-W12, D-W39 · HARNESS-V5-IA.md §Screens S13, §Round 2 foundation (`devices.ts`) · HARNESS-V5-FEEDBACK-R1.md §Domain and seed (Import sources), §Screens A (Import)

### S2 — Pick Card-1 and choose the destination {#S2}

- **Do:** Keep `Card-1` as the source. In the destination, set the Captures location to `Astro-T7 captures`.
- **Expect:** The destination offers both Captures locations, `Astro-T7 captures` and `Cold-1 captures`. Calibration shows its one location, `Astro-T7 calibration`, and needs no choice.
- **Expect (negative):** Nothing is written to either destination (P7 still matches).
- **Trace:** Import routing · STO-IMP-FR-02 · LIB-FR-01 · D-W24

### S3 — Read the preview {#S3}

- **Do:** Read the full preview without starting the import.
- **Expect:** The preview lists each incoming light session with its Target, then each planned file with its destination and its route. Lights and raw calibration files keep their original basenames.
  - `2 Oct Ha` (30 lights) reads Target NGC 7000, prefilled from its pointing, with `OBJECT NGC 7000` shown beside it only as a hint.
  - `2 Oct OIII` (6 lights) is one session with no framing split, because its lights have no pointing. **Unclassified is preselected**, so Import is available without choosing a Target; choose one only to file the session under that Target. It shows no OBJECT hint.
  - The 30 Ha lights are listed under `NGC 7000/Ha/2026-10-02/light/` in `Astro-T7 captures`, routed to Sessions, including the 12 taken after midnight.
  - The 6 OIII lights are not listed under `NGC 7000/` or under any other Target's folder until the user chooses a Target (G8; owner's answer, 2026-10-19, astro-plan-rzbzu.1; import_no_target).
  - The 10 flats are listed under `Raw/Flats/Ha/2026-10-02/` and the darks under `Raw/Darks/300s/2026-10-02/` in `Astro-T7 calibration`, routed `Calibration → stack`.
  - The master dark is listed at `Darks/ASI2600MM/300s_g100_o50_-10C/MasterDark_2026-10-02.xisf`, routed `Calibration library`.
  - Under Skipped, the P3 dark reads `Name taken`, and its note reads `holds different bytes; nothing is overwritten`.
  - Under Skipped, the 5 copies of 28 Sep frames read `5 duplicates`, matched by `SHA-256 of a library frame`.
  - Under Held, the 2 untyped frames read Unclassified, and each offers **Type as…**.
  - Under Held, `Light_Ha_0031.fits` reads `Writing`, held `until the file stops changing`.

  For each destination volume, the preview shows its free space and the space the import needs, and reads `Writable`. Copy and Move are offered for the whole import. The footer reads `56 frames` with the total size, and the start button reads **Import 56 frames**.
- **Expect (negative):** Nothing is written before the user starts the import, and the collision is never resolved by overwriting. `2 Oct Ha`'s Target is attributed to its pointing, never to its OBJECT.
- **Trace:** Import preview · STO-IMP-FR-02, STO-IMP-FR-03, STO-IMP-FR-05, STO-IMP-FR-07 · STO-IMP-AC-01, STO-IMP-AC-06, STO-IMP-AC-10 · LIB-FR-04 · LIB-AC-34 · D-W11, D-W20, D-W24, D-W107 · HARNESS-V5-IA.md §Screens S13, §Round 2b (P-CAL3: structured storage, Routing) · HARNESS-V5-FEEDBACK-R1.md §Round 6 (P-IMP2) · owner's answer, 2026-10-19 (astro-plan-rzbzu.1; import_no_target) · `templates.ts` DEFAULT_NAMING, resolveNamingTemplate

### S4 — Change the light naming template {#S4}

- **Do:** Open Settings › Naming. With the chip editor, change the Lights template to `{target}/{date}/{filter}/`, then add `..` as an extra folder. Remove it and save. Return to the Card-1 preview. Then open Settings › Naming again, choose **Restore default** for Lights and save.
- **Expect:** The editor offers 11 tokens, `{target}`, `{filter}`, `{date}`, `{frame_type}`, `{train}`, `{camera}`, `{exposure}`, `{gain}`, `{offset}`, `{binning}` and `{set_temp}`, each with its fallback. Its frame types include Lights, Flats, Darks and Bias and the master types, including master dark flats. The live preview shows the sample path for the new template and names any fallback token it used. With `..` the editor reads "A folder cannot be `..`" and Save is unavailable. After saving, the Card-1 preview lists the Ha lights under `NGC 7000/2026-10-02/Ha/`, and `2 Oct Ha` still reads Target NGC 7000 from its pointing. After **Restore default**, the preview lists the S3 paths again.
- **Expect (negative):** No template change writes, renames or moves any file. The template has no "Auto-apply pattern" checkbox.
- **Trace:** Settings › Naming · STO-IMP-FR-07 · STO-IMP-AC-08 · D-W20, D-W58 · HARNESS-V5-IA.md §Screens S16, §Round 2b (Left to the units: `{train}`, `{offset}`, master dark flat) · `templates.ts` NAMING_TOKENS

### S5 — Type one held frame {#S5}

- **Do:** Under Held, type one Unclassified frame as Flat with **Type as…**, and leave the other unset.
- **Expect:** The typed frame leaves Held for a raw flat path under `Raw/Flats/` in `Astro-T7 calibration`. It reads `Typed Flat`, offers **Undo**, and counts toward `Calibration → stack`. The other frame stays Unclassified and held. The P3 dark still reads `Name taken`. The import now reads 57 frames: 36 lights to Sessions, 11 flats and 9 darks to `Calibration → stack`, and 1 master to `Calibration library`.
- **Expect (negative):** The existing P3 file is unchanged, and no control overwrites or renames it.
- **Trace:** Import preview · STO-IMP-FR-02, STO-IMP-FR-05 · STO-IMP-AC-06, STO-IMP-AC-07 · D-W24 · HARNESS-V5-IA.md §Screens S13 (Holds, Skips)

### S5a — Keep one Target and change another in the preview {#S5a}

- **Do:** Keep the prefilled NGC 7000 for `2 Oct Ha`. Open the Target picker of `2 Oct OIII`, read its choices, and choose NGC 7000.
- **Expect:** The picker offers NGC 7000 and Unclassified. After the choice, `2 Oct OIII` reads Target NGC 7000, and its 6 lights are listed under `NGC 7000/OIII/2026-10-02/light/` in `Astro-T7 captures` with their original basenames. `2 Oct Ha` still reads NGC 7000 and lists its lights under `NGC 7000/Ha/2026-10-02/light/`. The import still reads 57 frames.
- **Expect (negative):** Choosing a Target in the preview writes nothing (P7 still matches) and changes no other session's Target.
- **Trace:** Import preview · HARNESS-V5-FEEDBACK-R1.md §Round 6 (P-IMP2: the user confirms or changes the Target there, or picks Unclassified) · LIB-FR-05

### S6 — Save the source and import with Copy {#S6}

- **Do:** Enter the source name `Card-1` and click **Save source**. Choose **Copy** and click **Import 57 frames** while the fixture writer is still appending to `Light_Ha_0031.fits`.
- **Expect:**
  - The import runs as an operation. The status bar shows it as running work with a mini progress bar, and the sheet shows progress for each destination folder as `<done> of <total> verified`.
  - When it finishes, its summary reads `57 frames · <size> · 2 sessions · 20 calibration → stack · 1 master · 5 duplicates skipped · 2 held`.
  - Under **Imported**, the sheet lists what the import filled: the 2 Oct Ha and 2 Oct OIII sessions, each with Target NGC 7000, the raw flat and dark sessions marked `Calibration → stack`, and `1 master` marked `Calibration library`.
  - Every destination file is re-read and matches its source's SHA-256.
  - The bell's unread count rises by 1, and its history lists the Card-1 import with its frame count.
  - Activity records the import with the same counts, and `Card-1` appears under Saved sources.
- **Expect (negative):** Every Card-1 file except the still-growing `Light_Ha_0031.fits` matches P7. Copy sends nothing to the OS Trash. No file is overwritten.
- **Trace:** Import · STO-IMP-FR-01, STO-IMP-FR-04, STO-IMP-FR-06 · STO-IMP-AC-02 · D-W11 · HARNESS-V5-IA.md §Screens S13 (runs as an operation, lists what it filled), §Round 2b (Status bar) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3)

### S7 — See where the files landed {#S7}

- **Do:** Read the finished import's actions and choose **Review sessions** (provisional copy, from the prototype), then go back to the import. Click **Show in Sessions**. Read the new sessions, then choose the **Needs a Target** filter. Open the Calibration library and then the 28 Sep session. Read the status bar after the duplicate scan settles.
- **Expect:**
  - The finished import offers **Review sessions** (provisional copy) first, before **Show in Sessions**. **Review sessions** opens the first session of this import that the Sessions **Needs review** queue holds. The queue runs oldest night first, then by start time, and only this import's sessions are candidates, so sessions that earlier journeys left in the queue never come first. Both new sessions share the night of 2 Oct, and `2 Oct Ha` starts earlier (P2), so it opens `2 Oct Ha`. Its Target is confirmed and its rig associated, so it opens at its Review step.
  - Sessions opens with the import highlighted (`?import=<operation>`). A notice names the import and `2 sessions`.
  - The 2 Oct Ha session, 30 frames, and the 2 Oct OIII session, 6 frames, are listed first, each marked `New`, and each reads Target NGC 7000 Confirmed. Their frames sit under `NGC 7000/Ha/2026-10-02/light/` and `NGC 7000/OIII/2026-10-02/light/` in `Astro-T7 captures`.
  - **Needs a Target** lists neither new session. Every new frame reads Unreviewed.
  - The Calibration library lists the raw flats and darks as calibration processes that read `Calibration → stack`, with Stack To do: 11 flats and 9 darks in all.
  - Under Darks, the Calibration library lists the master dark with camera ASI2600MM, 300 s, gain 100, offset 50 and −10 °C.
  - 28 Sep still reads 56 frames, each with one copy.
  - A duplicate scan runs after the import, and no duplicate-copies issue appears, although `Card-1`, still connected, holds a byte-identical source for every imported file and the 5 copies of 28 Sep frames.
- **Expect (negative):** No Inbox and no later Target confirmation or filing step appears, and no imported file moves after the import: every one is still at the path its preview listed. No duplicates warning counts or names a `Card-1` file. No flat, dark or master appears in Sessions. The held frames, the duplicates and the name-taken dark are absent from the catalog. No calibration process starts Stack by itself, Import never waits for calibration matching, and no raw frame goes to the OS Trash.
- **Trace:** Import landing · LIB-FR-09, LIB-FR-16, LIB-FR-17, LIB-FR-20, LIB-FR-23, LIB-FR-24 · LIB-AC-17 · STO-IMP-FR-02, STO-IMP-FR-03, STO-IMP-FR-08 · STO-IMP-AC-10, STO-IMP-AC-11 · CAL-FR-02 · PIX-FR-18 · D-W24, D-W78, D-W101 to D-W105 · HARNESS-V5-IA.md §Screens S12 (`?import=`), S14 · HARNESS-V5-FEEDBACK-R1.md §Round 1b (P-CAL3), §Round 5 (Duplicates are scanned automatically), §Round 6 (P-IMP2: no Inbox and no later move; the duplicate scan covers registered library locations only), Round 9 C14 (Import ends by opening the first session that needs review)

### S8 — Import new from the saved source {#S8}

- **Do:** Stop the fixture writer. Write 4 more Ha lights from the night of 2026-10-02 to `Card-1`, and copy 2 already imported Ha lights back to it under new names. Under Saved sources, choose **Import new** on `Card-1`, keep the prefilled Target, then import with **Copy**. Read the status bar after the duplicate scan settles.
- **Expect:** The preview offers 5 lights: the 4 new ones and the now settled `Light_Ha_0031.fits`, in `2 Oct Ha` with Target NGC 7000 prefilled from its pointing and listed under `NGC 7000/Ha/2026-10-02/light/`. Skipped lists `59 imported before` (the 57 S6 files and the 2 copied-back lights, matched by SHA-256) and `5 duplicates`. The held frame with no frame type and the name-taken dark are listed again with their earlier states. After the import, the summary reads `5 frames · <size> · 1 session · 5 duplicates skipped · 59 imported before · 1 held`, and the 2 Oct Ha session reads 35 frames.
- **Expect (negative):** The 57 files imported at S6 are not offered again, and no second copy of any frame is created. The duplicate scan raises no duplicate-copies issue for the 2 copied-back lights on `Card-1`.
- **Trace:** Import new · STO-IMP-FR-01, STO-IMP-FR-02 · STO-IMP-AC-04 · LIB-FR-16 · D-W11, D-W24 · HARNESS-V5-IA.md §Screens S13 (saved source, Import new)

### S9 — Import with Move from Card-2 {#S9}

- **Do:** Connect `Card-2`. Choose it as the source and `Astro-T7 captures` as the Captures location. Read the preview. `4 Oct Ha` has no pointing and no matching Target, so Unclassified is preselected and Import is available; choosing a Target is only to file the session under it (owner's answer, 2026-10-19, astro-plan-rzbzu.1). Leave it Unclassified. Choose **Move**, click **Move 12 frames** and confirm. Open the OS Trash.
- **Expect:**
  - Card-2 appears under Removable devices once connected, read as `USB device` with no recognised layout.
  - The preview lists `4 Oct Ha` (12 lights) as one session with no framing split and no Target prefilled, because its lights have no pointing, with `OBJECT NGC7000` shown beside it only as a hint. **Unclassified is preselected**, so Import is available; a Target may be chosen only to file it under that Target. Before choosing a Target, none of its lights is listed under `NGC7000/` or `NGC 7000/`.
  - Its 12 lights remain listed under `unclassified/Ha/2026-10-04/light/` in `Astro-T7 captures`, and the preview names the `{target}` fallback it used.
  - The confirmation `Move 12 frames?` lists `Copies 12 frames (<size>) into Astro-T7 captures`, `Verifies each copy (SHA-256)` and `Sends 12 verified sources on Card-2 to the OS Trash`.
  - The summary reads `12 frames · <size> · 1 session · sources → OS Trash`. A second operation, `Move import sources to the OS Trash`, moves the 12 sources only after every copy verified against its source snapshot.
  - The 12 files are in the OS Trash and can be put back.
  - Sessions lists a new 4 Oct Ha session of 12 frames with no Target, under **Needs a Target**, with `OBJECT NGC7000` shown as a label. Its frames sit under `unclassified/Ha/2026-10-04/light/`.
- **Expect (negative):** No source is permanently deleted, and no source reached the Trash before its destination verified. OBJECT `NGC7000` sets neither the session's Target nor `{target}`: no `NGC7000/` folder and no `NGC 7000/Ha/2026-10-04/` folder is created, and no file moves after the import.
- **Trace:** Import · STO-IMP-FR-04, STO-IMP-FR-06 · STO-IMP-AC-03 · LIB-FR-04, LIB-FR-17 · LIB-AC-34 · D19, D-W11, D-W107 · owner's answer, 2026-10-19 (astro-plan-rzbzu.1) · HARNESS-V5-IA.md §Screens S13 (Move verifies, then sends the source to the OS Trash) · HARNESS-V5-FEEDBACK-R1.md §Domain and seed (removable devices detected when connected), §Round 5 (OBJECT is a label, never evidence), §Round 6 (P-IMP2: OBJECT shown only as a hint; Unclassified sessions go to an Unclassified folder)

### S10 — Import from a network share that drops mid-import {#S10}

- **Do:** Click **Choose folder…** and pick `/Volumes/astro-share/incoming`. Keep the prefilled Target of `5 Oct OIII`. Try to choose **Move**, then choose **Copy** and start the import. After at least 5 items read verified, unmount the share in the OS and read the import and the status bar's ⚠ counter. Mount it again and click **Retry**.
- **Expect:** The preview lists `5 Oct OIII` (20 lights) with Target NGC 7000 prefilled from its pointing, under `NGC 7000/OIII/2026-10-05/light/`. Move is unavailable and reads `No OS Trash`, so the import uses Copy. The source is flagged as a network volume, and hashing shows progress. After the unmount, the import pauses and reads `Interrupted`: verified items keep their state, the source reads Offline and the rest stay pending. The status bar's ⚠ counter counts the interrupted import and leads to Activity filtered to it, not to a list of issues. Retry resumes the recorded work and imports the remaining items. The summary reads `20 frames · <size> · 1 session`, every share file stays in place, and Sessions lists a new 5 Oct OIII session of 20 frames with Target NGC 7000 Confirmed.
- **Expect (negative):** The vanished source does not fail the import: no item reads failed or `source gone`. No file on the share is removed, and no file is reported Missing. Retry does not copy a verified item again and does not decide what is done by checking whether a filename exists.
- **Trace:** Import · STO-IMP-FR-01, STO-IMP-FR-04, STO-IMP-FR-06 · STO-IMP-AC-03, STO-IMP-AC-09 · LIB-FR-19 · LIB-AC-20 · D-W11, D-W12 · HARNESS-V5-IA.md §Screens S13 · `import-model.ts` (Move needs a source with an OS Trash) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3), §Round 6 (Import source vanishes mid-import) · G2

### S10a — Review a framing split, merge it and split it again {#S10a}

- **Do:** Connect `Card-4`. Choose it as the source and `Astro-T7 captures` as the Captures location, and read the preview's sessions. Merge the two Ha sessions and read the preview, then re-split the merged session. Set the centre limit to 12′ and read the preview, then raise the rotation limit to 6° and read it again. Choose **Copy** and start the import with both limits still set. Then, in Settings, open the global Project grouping preferences and read the framing limits.
- **Expect:**
  - The preview lists two sessions with Target NGC 7000 prefilled from their pointing: "NGC 7000 · Ha · 300 s · 6 Oct" with the 24 lights from either side of the meridian flip, and "NGC 7000 · Ha · 300 s · 6 Oct · framing 2" with the other 10. Both list their lights under `NGC 7000/Ha/2026-10-06/light/`.
  - The first session's 24 lights include the 10 that return to framing A after framing B.
  - After the merge, the preview lists one session of 34 lights. After the re-split, the two sessions of 24 and 10 lights return with the same names.
  - With a centre limit of 12′, the preview still shows sessions of 24 and 10, because framing B's rotation differs by 6°.
  - With the centre limit at 12′ and the rotation limit at 6°, the preview shows one session of 34.
  - The import splits with the limits set when it started, so the summary reads `34 frames · <size> · 1 session`, and Sessions lists one session, "NGC 7000 · Ha · 300 s · 6 Oct", with 34 frames. This needs both import limits: under either Settings limit, framing B starts a second session.
  - Settings still reads the default limits, a centre limit of 5′ and rotation within 5°.
- **Expect (negative):** The meridian flip starts no session. Merging and re-splitting write nothing, and no file is written before the import starts. Slider changes also write nothing.
- **Trace:** Import · STO-IMP-FR-03 · LIB-FR-04, LIB-FR-24 · LIB-AC-31 · D-W107 · D-W114

### S11 — Add an existing library folder {#S11}

- **Do:** In the Import sheet, open the **Library folder** tab. Click **Choose library folder** and pick `Astro-T7/Archive-2025`, keep the role Captures, enter the display name `Archive 2025` and click **Add and index**.
- **Expect:** The folder appears as a registered Captures location and is indexed in place. The sheet shows indexing progress and then offers **Show in Sessions**. Its 2025 sessions appear in Sessions at their existing paths. A duplicate scan runs after the index, and no duplicate-copies issue appears.
- **Expect (negative):** No file is copied, renamed or moved, and no naming template applies. No Import summary or Trash action is produced.
- **Trace:** Import · STO-IMP-FR-01 · STO-IMP-AC-05 · LIB-FR-02 · D-W11 · HARNESS-V5-IA.md §Screens S13 (a second tab adds an existing library folder) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (Duplicates are scanned automatically)

### S12 — Verify custody {#S12}

- **Do:** Outside PlateVault, recompute the P7 manifests and compare them with P7 and with the import summaries.
- **Expect:**
  - `Card-1` matches P7, apart from `Light_Ha_0031.fits`, which grew until S8, and the 6 files that S8 added.
  - `Card-4`, `astro-share/incoming` and `Archive-2025` match P7, and `Card-2`'s 12 lights match their P7 entries in the OS Trash.
  - Each imported destination file has the size and SHA-256 of its source. Lights and raw calibration files carry the source's basename, and the master carries its structured-storage name.
  - Each imported light sits in the folder its preview listed: `NGC 7000/Ha/2026-10-02/light/` (35), `NGC 7000/OIII/2026-10-02/light/` (6), `unclassified/Ha/2026-10-04/light/` (12), `NGC 7000/OIII/2026-10-05/light/` (20) and `NGC 7000/Ha/2026-10-06/light/` (34) in `Astro-T7 captures`.
  - The P3 file matches P7.
- **Expect (negative):** No source file is missing outside the OS Trash, and no existing destination file was changed. No imported file moved after its import, and no folder named after an OBJECT value (`NGC7000/`) exists.
- **Trace:** root FR-017, SC-002 · STO-IMP-FR-04, STO-IMP-FR-05 · D19

## Success criteria

- SC1: Zero bytes are written before S6 starts (S2 to S5a).
- SC2: The S6 summary reads exactly `57 frames`, `2 sessions`, `20 calibration → stack`, `1 master`, `5 duplicates skipped` and `2 held`. The preview's Skipped list held exactly 1 name taken, and Activity shows the same counts.
- SC3: After S7, 0 flats, darks or masters appear in Sessions, 0 held, duplicate or name-taken files appear in the catalog, and 0 calibration processes have started Stack.
- SC4: Import new at S8 imports exactly 5 files and creates 0 second copies.
- SC5: Move at S9 puts exactly 12 sources in the OS Trash. At S10, Move is unavailable, the import reads `Interrupted` after the unmount, 0 share files are removed and 0 verified items are copied twice.
- SC6: S11 copies, renames or moves 0 files.
- SC7: At S12, 100% of imported destination files match their source's SHA-256, and 0 files were permanently deleted or overwritten.
- SC8: Card-1 reads ASIAIR (S1) and Card-2 reads USB device (S9). 0 duplicate-copies issues are raised after S6, S8, S9, S10, S10a or S11, and 0 duplicates warnings name a `Card-1` file.
- SC9: The 5 imported light sessions land with the Target their preview showed: 4 with NGC 7000 Confirmed (`2 Oct Ha`, `5 Oct OIII` and the 6 Oct session of S10a prefilled from pointing, `2 Oct OIII` changed at S5a) and 1 with no Target under `unclassified/`, where Unclassified was preselected (`4 Oct Ha`, S9; owner's answer, 2026-10-19, astro-plan-rzbzu.1). 0 Targets and 0 folders come from OBJECT, and 0 files move after an import (S10a, S12).
- SC10: At S10a the preview lists exactly 2 sessions, of 24 and 10 lights. The merge shows 1 session of 34, the re-split restores the 2 sessions, and 0 bytes are written before the import starts. The import, started with a 12′ centre limit and a 6° rotation limit, lands 1 session of 34, and Settings still reads 5′ and 5°.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Behavior follows specs 064 and 071 at d45a22ad, the 2026-10-06 workflow decisions and the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 6, `apps/prototype/` on ui-harness-v5 @ b5e813a5; the prototype at 4f470775 does not yet implement Round 6). No implementation has been validated against them.
- G2: Unresolved implementation qualification: the growing-file writer (P2) and unmounting the share at a known point (S10) need fixture tooling that does not exist yet. Blocks readiness.
- G3: Out of scope for this journey: a failed destination verification and a source that changes after its snapshot (STO-IMP-AC-03, STO-AC-14) need fault injection. They are not exercised. Blocks readiness until covered by a step or a journey.
- G4: Out of scope for this journey: a role with no location, which blocks its items with the missing role named (STO-IMP-FR-02; `No Captures location`), and the unknown-filter prompt in the preview (STO-IMP-FR-03, PLAN-EQ-FR-04) are not exercised. Blocks readiness until covered by a step or a journey.
- G6: (dissolved 2026-10-12): answered by Round 6 "P-IMP2: confirm Targets in the Import preview"; S3, S5a, S8, S9 and S10 now assert that a session's Target is prefilled only from its pointing, with OBJECT shown as a hint, and that the user keeps it, changes it or picks Unclassified there; S7, S9 and S12 assert that the import files frames under that `{target}` or under `unclassified/` at once, with no later move and no OBJECT-named folder.
- G7: (dissolved 2026-10-12): answered by Round 6 "Import source vanishes mid-import"; S10 now asserts that the import pauses as `Interrupted`, fails no item, and resumes on Retry. Unmounting the share at a known point still needs the fixture tooling that G2 records.
- G8: (dissolved 2026-10-19): the owner's answer in astro-plan-rzbzu.1 (import_no_target) settles the import preview for sessions with no pointing or no matching Target: preselect Unclassified, so Import is always available; a Target is chosen only to file the session under it. S3 and S9 assert this for 2 Oct OIII and 4 Oct Ha.
- G9: Unresolved implementation qualification: the Card-1 fixture doesn't fix the calibration evidence of its two light sessions, so no step asserts which Import review state their darks, flats and bias read (LIB-FR-24, STO-IMP-AC-11). Blocks readiness until a fixture fixes them.
- G10: (dissolved 2026-10-16): answered by the owner's amendment of D-W107 (LIB-FR-04, LIB-AC-34): frames with no pointing stay in one session, because without pointing there is no framing split. S3 and S9 assert that `2 Oct OIII` and `4 Oct Ha` each read as one session in the preview.

## Delta log

- **Δ2** 2026-10-12 · S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12 · behavior-change
  Import is a sheet. Connected removable devices show their recognised capture layout (Card-1 ASIAIR, Card-2 USB device) beside Saved sources, Choose folder… and a Library folder tab. Raw flats and darks go under `Raw/…` as calibration processes awaiting Stack, and a master goes to structured storage. `{target}` keeps its space (`NGC 7000/`), and Naming has 11 tokens. A name-taken file is skipped automatically, so the user no longer leaves it out by hand. This retires G5 and adds G6 and G7.
  The import runs as an operation in the status bar and the bell, and then lists what it filled. Show in Sessions highlights the filled sessions, and a duplicate scan follows each import and index. Move is unavailable for a source with no OS Trash, so S10 imports with Copy. P2 adds a master dark, the ASIAIR layout and J37's clouded frames. P4 gives Card-2 OBJECT `NGC7000`, no pointing and a late connection.
  Evidence: HARNESS-V5-IA.md §Screens S1, S12, S13, S14, S16, §Round 2 foundation (`devices.ts`), §Round 2b (Status bar, P-CAL3 structured storage and Routing, Left to the units); HARNESS-V5-FEEDBACK-R1.md §Domain and seed (Import sources), §Screens A (Import), §Round 1b P-CAL3, §Round 5 (P-SB3, OBJECT is a label never evidence, Duplicates are scanned automatically); prototype src/domain/devices.ts, src/domain/templates.ts, src/features/v5/a-home/import-model.ts, import-run.ts, import.tsx, messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U1Intake (intent-gated)
- **Δ3** 2026-10-12 · S3, S4, S6, S7, S8, S9, S10, S12, +S5a · behavior-change
  The Import preview lists each incoming session with its Target, prefilled from pointing, with OBJECT shown only as a hint. The user changes `2 Oct OIII` to NGC 7000 (S5a) and picks Unclassified for `4 Oct Ha` (S9). The import files frames under `{target}/…` or `unclassified/…` at once and moves nothing later.
  A share that drops mid-import pauses the import as Interrupted until Retry (S10), and capture-card files raise no duplicates warning (S7, S8). P5 gives the share's lights OBJECT and pointing. Dissolves G6 and G7, and adds G8.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "P-IMP2: confirm Targets in the Import preview", "Import source vanishes mid-import", "The duplicate scan covers registered library locations only" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6A (intent-gated)
- **Δ4** 2026-10-15 · S7, S10 · behavior-change
  Import review shows each new light session's darks, flats and bias as pinned automatically, suggested or not found, and Import never waits for calibration: an unsettled session waits in Needs calibration. The toolbar has no Issues hub, and S10's ⚠ counter leads to Activity instead of listing the interrupted import.
  Evidence: D-W92, D-W101 to D-W105 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 064 LIB-FR-23, LIB-FR-24, 071 STO-IMP-FR-02, STO-IMP-AC-11 · by: SpecF4Writer2 (intent-gated)
- **Δ5** 2026-10-16 · +S10a, S12 · behavior-change
  Intake splits a night's lights into sessions by framing, and the import preview shows each split, which the user can merge or re-split before starting the import. A meridian flip doesn't split. The Goal and Done means name the split, and SC9 counts S10a's two sessions among the 6 imported light sessions.
  Evidence: D-W107 (owner's answers of 2026-10-15/16) in PR #1804, LIB-FR-04, LIB-FR-24, LIB-AC-31, STO-IMP-FR-03 · by: SpecF4Answers (intent-gated)
- **Δ6** 2026-10-16 · S3, S9 · behavior-change
  Lights with no pointing stay one session with no framing split: S3 and S9 now assert this for `2 Oct OIII` and `4 Oct Ha`. G10 is dissolved.
  Evidence: D-W107 as amended by the owner's second batch of 2026-10-16 in PR #1804, LIB-FR-04, LIB-FR-24, LIB-AC-34 · by: EncodeOwnerAnswers2 (intent-gated)
- **Δ7** 2026-10-17 · S7, P2 · behavior-change
  The finished import leads with **Review sessions**, which opens this import's first session in the Needs review queue (oldest night, then start time), here `2 Oct Ha` at its Review step; Show in Sessions stays as the second action. P2 gives the 2 Oct lights their start times.
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C14 · D-W78 · LIB-FR-20, PIX-FR-18 · prototype import.tsx OutcomeStep, derive.ts reviewQueue and importReviewLink (ui-harness-v5) · by: JourneysR9c (intent-gated)
- **Δ8** 2026-10-19 · S3, S9, SC9 · behavior-change
  When a session has no pointing or no matching Target, the preview preselects Unclassified so Import is available; choosing a Target only files it under that Target.
  Evidence: STO-IMP-FR-03 · owner's answer of 2026-10-19 in astro-plan-rzbzu.1 · by: OwnerAnswersDocsFix (intent-gated)
- **Δ9** 2026-10-20 · P8, S10a, SC9, SC10 · behavior-change
  The centre limit is an angle, 5′ by default, and lights that return to an earlier framing rejoin its session, so P8 has 14 lights at framing A, 10 at framing B and 10 back at A. In the import preview the user moves the centre and rotation sliders, and the split recalculates live without saving. S10a starts the import with a 12′ centre limit and a 6° rotation limit, which only together keep B in the session, so it lands one 6 Oct session of 34 and SC9 counts 5 imported light sessions, while Settings keeps the defaults.
  Evidence: D-W107 and D-W114 (owner's answers of 2026-10-20) in PR #1850, LIB-FR-04, LIB-FR-24, LIB-AC-31 · by: Main (intent-gated)
