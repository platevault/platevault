---
id: J31
title: Import from a card or folder with Copy or Move and templated paths
version: 1
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [home, import, settings, sessions, calibration, locations, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 071-storage-custody, D19, D-W7, D-W11, D-W12, D-W20, D-W24, D-W33, D-W39, D-W58, specs/063-clean-rebuild-contract/spec.md, specs/064-library-inventory/spec.md, specs/071-storage-custody/spec.md]
---

## Goal

The user brings new captures into the library the way Lightroom imports
photos. They pick a card, folder or OS-mounted network path, check a preview
of the templated destination paths and choose Copy or Move. Lights land in a
Captures location as sessions, and calibration frames land in the Calibration
library. Untyped frames, duplicates and files still being written are held
back. A saved source supports "Import new", and an already organized folder is
added in place. Done means:

- Every imported file sits at its templated path with its original basename and matches its source's SHA-256.
- Copy leaves every source unchanged. Move sends a source to the OS Trash only after its destination verifies, and keeps it where the OS cannot trash it.
- Held, duplicate and blocked items add nothing to the catalog.
- Nothing is permanently deleted or overwritten.

## Preconditions

- P1: J19 completed through S14. `Astro-T7 captures` and `Cold-1 captures` are registered Captures locations and both are online. `Astro-T7/Calibration` is the registered Calibration location. No Project exists. Settings > Naming holds the default templates.
- P2: Removable volume `Card-1` supports the OS Trash and holds, for the night of 2026-10-02:
  - 30 NGC 7000 Ha 300 s RedCat lights with OBJECT and pointing. 12 of them have a DATE-OBS after local midnight on 3 Oct.
  - 6 OIII 300 s lights with no OBJECT and no pointing.
  - 10 Ha flats and 10 darks of 300 s.
  - 2 frames with no frame-type header.
  - 5 byte-identical copies of 28 Sep Ha lights under new names.
  - `Light_Ha_0031.fits`, a light that a fixture writer keeps appending to until it is told to stop.
- P3: `Astro-T7/Calibration/` already holds, at the folder the default dark template gives Card-1's darks, a file with the same basename as one Card-1 dark and different bytes.
- P4: Removable volume `Card-2` supports the OS Trash and holds 12 NGC 7000 Ha 300 s RedCat lights from the night of 2026-10-04.
- P5: An SMB share that macOS has already mounted at `/Volumes/astro-share` holds `incoming/` with 20 NGC 7000 OIII 300 s RedCat lights from the night of 2026-10-05. Removing a file on this share deletes it immediately; the share has no OS Trash.
- P6: `Astro-T7/Archive-2025/` is an organized folder of 2025 light sessions outside every registered location.
- P7: Manifests (relative path, size, SHA-256) of `Card-1`, `Card-2`, `astro-share/incoming`, `Archive-2025` and both destination locations, recorded outside PlateVault before S1.

## Steps

### S1 — Open Import from Home {#S1}

- **Do:** On Home, click **Import** in the Actions section.
- **Expect:** The Import page opens; main navigation also has its own Import entry. It offers a source picker for a local folder, a removable volume or a network path the OS has mounted, an empty saved-sources list, and **Add existing library folder** beside Import.
- **Expect (negative):** No "File into library" action or Inbox exists anywhere. No field accepts an SMB or URL address, and PlateVault offers no way to mount a share.
- **Trace:** Import · STO-IMP-FR-01 · LIB-FR-10, LIB-FR-19 · PRJ-FR-17 · D-W7, D-W11, D-W12, D-W39

### S2 — Pick Card-1 and choose the destination {#S2}

- **Do:** Choose `Card-1` as the source. When asked for a Captures location, choose `Astro-T7 captures`.
- **Expect:** Because Captures has two locations, PlateVault asks the user to choose one for this import. Calibration needs no choice, because it has one location.
- **Expect (negative):** Nothing is written to either destination (P7 still matches).
- **Trace:** Import routing · STO-IMP-FR-02 · LIB-FR-01 · D-W24

### S3 — Read the preview {#S3}

- **Do:** Read the full preview without starting the import.
- **Expect:** Each source file is listed with its templated destination path, and files keep their original basenames.
  - The 30 Ha lights are listed under `NGC7000/Ha/2026-10-02/light/` in `Astro-T7 captures`, including the 12 taken after midnight.
  - The 6 OIII lights are listed under `unclassified/OIII/2026-10-02/light/`, and the preview names the `{target}` fallback it used.
  - The 10 flats are listed under `flats/Ha/2026-10-02/` and the 10 darks under their `darks/{exposure}/` folder in the Calibration location.
  - The P3 dark is blocked as a collision with a different file at its path.
  - The 2 untyped frames are listed as Unclassified and held for a type.
  - `Light_Ha_0031.fits` is listed as waiting to settle.
  - The 5 copies of 28 Sep frames are listed as duplicates skipped by SHA-256.

  The preview shows counts and bytes per destination and each destination volume's free space and writability. Copy and Move are offered for the whole import.
- **Expect (negative):** Nothing is written before the user starts the import, and the collision is never resolved by overwriting.
- **Trace:** Import preview · STO-IMP-FR-02, STO-IMP-FR-03, STO-IMP-FR-05, STO-IMP-FR-07 · STO-IMP-AC-01, STO-IMP-AC-06, STO-IMP-AC-10 · D-W11, D-W20, D-W24

### S4 — Change the light naming template {#S4}

- **Do:** Open Settings > Naming. With the chip editor, change the light template to `{target}/{date}/{filter}/`, then type `..` as an extra segment. Remove it and save. Return to the Card-1 preview. Then open Settings > Naming again, choose **Restore defaults** and save.
- **Expect:** The live preview shows the sample path for the new template and names any fallback token it used. With `..` the editor shows an inline error and Save is unavailable. After saving, the Card-1 preview lists the Ha lights under `NGC7000/2026-10-02/Ha/` and the OIII lights under `unclassified/2026-10-02/OIII/`. After **Restore defaults**, the preview lists the S3 paths again.
- **Expect (negative):** No template change writes, renames or moves any file. The template has no "Auto-apply pattern" checkbox.
- **Trace:** Settings > Naming · STO-IMP-FR-07 · STO-IMP-AC-08 · D-W20, D-W58

### S5 — Type one frame and leave the collision out {#S5}

- **Do:** In the preview, set one Unclassified frame to flat and leave the other unset. Choose to leave the blocked dark out of this import.
- **Expect:** The typed frame moves to a flat path in the Calibration location and counts as a flat. The other frame stays Unclassified and held. The collision item reads left out, and the Calibration counts read 11 flats and 9 darks.
- **Expect (negative):** The existing P3 file is unchanged.
- **Trace:** Import preview · STO-IMP-FR-02, STO-IMP-FR-05 · STO-IMP-AC-06, STO-IMP-AC-07 · D-W24

### S6 — Save the source and import with Copy {#S6}

- **Do:** Save the source under the name `Card-1`. Choose **Copy** and start the import, with the fixture writer still appending to `Light_Ha_0031.fits`.
- **Expect:** Progress shows per item. The summary reads 56 items imported (36 lights, 11 flats and 9 darks). It also lists 5 duplicates skipped, 1 frame held Unclassified, 1 file waiting to settle and 1 item left out. Every destination file is re-read and matches its source's SHA-256. Activity records the import with the same counts. `Card-1` appears in the saved-sources list.
- **Expect (negative):** Every Card-1 file except the still-growing `Light_Ha_0031.fits` matches P7. Copy sends nothing to the OS Trash. No file is overwritten.
- **Trace:** Import · STO-IMP-FR-01, STO-IMP-FR-04, STO-IMP-FR-06 · STO-IMP-AC-02 · D-W11

### S7 — See where the files landed {#S7}

- **Do:** Open Sessions, the **Needs a Target** filter and the Calibration library. Open the 28 Sep session.
- **Expect:** Sessions lists a new 2 Oct Ha session of 30 frames with Target NGC 7000 and a new 2 Oct OIII session of 6 frames. **Needs a Target** lists the 2 Oct OIII session. Every new frame reads Unreviewed. The Calibration library lists the 11 flats and 9 darks. 28 Sep still reads 56 frames, each with one copy.
- **Expect (negative):** No Inbox and no confirm step appears. No flat or dark appears in Sessions. The held frame, the waiting file, the duplicates and the left-out dark are absent from the catalog.
- **Trace:** Import landing · LIB-FR-16, LIB-FR-17, LIB-FR-09 · LIB-AC-17 · STO-IMP-FR-08 · STO-IMP-AC-10 · D-W24, D-W33

### S8 — Import new from the saved source {#S8}

- **Do:** Stop the fixture writer. Write 4 more Ha lights from the night of 2026-10-02 to `Card-1`, and copy 2 already imported Ha lights back to it under new names. Choose the saved source `Card-1` and click **Import new**. Start a Copy import.
- **Expect:** The preview offers 5 lights to import: the 4 new ones and the now settled `Light_Ha_0031.fits`. It lists 7 duplicates skipped by SHA-256 (the 2 copied-back lights and the 5 copies of 28 Sep frames). The held Unclassified frame and the blocked dark are listed again with their earlier states. After the import, the summary reads 5 imported and 7 duplicates skipped, and the 2 Oct Ha session reads 35 frames.
- **Expect (negative):** The 56 files imported at S6 are not offered again, and no second copy of any frame is created.
- **Trace:** Import new · STO-IMP-FR-01, STO-IMP-FR-02 · STO-IMP-AC-04 · LIB-FR-16 · D-W11, D-W24

### S9 — Import with Move from Card-2 {#S9}

- **Do:** Choose `Card-2` as the source and `Astro-T7 captures` as the Captures location. Choose **Move** and start the import. Open the OS Trash.
- **Expect:** The summary reads 12 imported and 12 sources moved to the OS Trash. Each source went to the Trash only after its destination verified against the source snapshot. The 12 files are in the OS Trash and can be put back. Sessions lists a new 4 Oct Ha session of 12 frames.
- **Expect (negative):** No source is permanently deleted, and no source reached the Trash before its destination verified.
- **Trace:** Import · STO-IMP-FR-04, STO-IMP-FR-06 · STO-IMP-AC-03 · D19, D-W11

### S10 — Move from a network share that drops mid-import {#S10}

- **Do:** Choose `/Volumes/astro-share/incoming` as the source. Choose **Move** and start the import. After at least 5 items read verified, unmount the share in the OS. Mount it again and click **Retry**.
- **Expect:** The source is flagged as a network volume, and hashing shows progress. After the unmount, verified items keep their state, the source reads Offline and the rest stay pending. Retry resumes the recorded work and imports the remaining items. The summary reads 20 imported, and every source reads copied with the source kept, because the share has no OS Trash. Sessions lists a new 5 Oct OIII session of 20 frames.
- **Expect (negative):** No file on the share is removed, and no file is reported Missing. Retry does not copy a verified item again and does not decide what is done by checking whether a filename exists.
- **Trace:** Import · STO-IMP-FR-01, STO-IMP-FR-04, STO-IMP-FR-06 · STO-IMP-AC-03, STO-IMP-AC-09 · LIB-FR-19 · LIB-AC-20 · D-W11, D-W12

### S11 — Add an existing library folder {#S11}

- **Do:** On the Import page, choose **Add existing library folder** and pick `Astro-T7/Archive-2025` with role Captures.
- **Expect:** The folder appears as a registered Captures location and is indexed in place. Its 2025 sessions appear in Sessions at their existing paths.
- **Expect (negative):** No file is copied, renamed or moved, and no Import summary or Trash action is produced.
- **Trace:** Import · STO-IMP-FR-01 · STO-IMP-AC-05 · LIB-FR-02 · D-W11

### S12 — Verify custody {#S12}

- **Do:** Outside PlateVault, recompute the P7 manifests and compare them with P7 and with the import summaries.
- **Expect:** `Card-1` matches P7 apart from `Light_Ha_0031.fits`, which grew until S8, and the 6 files that S8 added. `astro-share/incoming` and `Archive-2025` match P7. `Card-2`'s 12 lights match their P7 entries in the OS Trash. Each imported destination file has the size and SHA-256 of its source and the source's basename. The P3 file matches P7.
- **Expect (negative):** No source file is missing outside the OS Trash, and no existing destination file was changed.
- **Trace:** root FR-017, SC-002 · STO-IMP-FR-04, STO-IMP-FR-05 · D19

## Success criteria

- SC1: Zero bytes are written before S6 starts (S2 to S5).
- SC2: The S6 summary reads exactly 56 imported, 5 duplicates, 1 Unclassified held, 1 waiting to settle and 1 left out, and Activity shows the same counts.
- SC3: After S7, 0 flats or darks appear in Sessions and 0 held, duplicate or left-out files appear in the catalog.
- SC4: Import new at S8 imports exactly 5 files and creates 0 second copies.
- SC5: Move at S9 puts exactly 12 sources in the OS Trash. At S10, 0 share files are removed and 0 verified items are copied twice.
- SC6: S11 copies, renames or moves 0 files.
- SC7: At S12, 100% of imported destination files match their source's SHA-256, and 0 files were permanently deleted or overwritten.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Behavior follows specs 064 and 071 at d45a22ad and the 2026-10-06 workflow decisions. No implementation has been validated against them.
- G2: Unresolved implementation qualification: the growing-file writer (P2) and unmounting the share at a known point (S10) need fixture tooling that does not exist yet. Blocks readiness.
- G3: Out of scope for this journey: a failed destination verification and a source that changes after its snapshot (STO-IMP-AC-03, STO-AC-14) need fault injection. They are not exercised. Blocks readiness until covered by a step or a journey.
- G4: Out of scope for this journey: a role with no location, which blocks its items with the missing role named (STO-IMP-FR-02), and the unknown-filter prompt in the preview (STO-IMP-FR-03, PLAN-EQ-FR-04) are not exercised. Blocks readiness until covered by a step or a journey.
- G5: Unresolved implementation qualification: S3 assumes `{target}` resolves NGC 7000 to `NGC7000`, as in the STO-IMP-AC-01 example. The sanitizing rule for the space is not stated in STO-IMP-FR-07. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
