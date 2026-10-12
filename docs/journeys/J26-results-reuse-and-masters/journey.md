---
id: J26
title: Discover and attach Results, reuse them as run inputs, and adopt a master offered once
version: 4
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [results, view-review, preparation, calibration, projects, targets, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 070-results-reuse, 068-calibration-inputs, 069-application-handoff, 071-storage-custody, D04, D05, D09, D13, D19, D-W4, D-W5, D-W8, D-W51, D-W55, D-W56, D-W67, D-W70, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/070-results-reuse/spec.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-h-results-and-generated-masters, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S14, HARNESS-V5-IA.md#round-2b-foundation-status-bar-and-p-cal3-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#domain-and-seed-foundation, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions-user-2026-10-09, P-CAL2, P-CAL3, apps/prototype/src/features/v5/c-runs/results-step.tsx, apps/prototype/src/features/v5/c-runs/select-step.tsx, apps/prototype/src/features/v5/c-runs/actions.ts, apps/prototype/src/features/v5/e-targets-plan-settings/calibration.tsx, apps/prototype/messages/en-GB.json, J36, HARNESS-V5-FEEDBACK-R1.md#round-6]
---

## Goal

After processing in Siril, the user opens the run's Results step and finds
what Siril wrote to `NGC7000-HOO-Siril Results/`. The user attaches a file
saved elsewhere through the visible **Attach…** action and accepts the
valuable products with honest lineage. Two accepted channel products then
become the inputs of a new run in the Project. The generated master flat is
offered once in the Results step. The user dismisses it, restores it from the
Calibration library's Dismissed filter and adds it to the library, which files
it into structured calibration storage. Done means:
- Three accepted products appear on the run, the Project and the Target with their actual lineage.
- Every discovered candidate names the prepared revision it came from, also when two revisions share one Results folder. Tool evidence decides it; without tool evidence it is marked Inferred.
- The new run lists two product inputs and no raw integration. An accepted product of a Complete run in another Project and on another rig is offered.
- The master is reusable only after explicit adoption and a verified copy in structured calibration storage, and a dismissed offer stays restorable.
- An accepted product or adopted master whose bytes change is not offered for reuse.
- Nothing is accepted, adopted or upgraded in lineage automatically, and adopting a better master reassigns no run.

## Preconditions

- P1: J24 completed. Siril processing of `NGC7000-HOO-Siril` has written these files into `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril Results/`: calibrated and registered intermediates, an Ha linear stack, an OIII linear stack, a log, and a master flat `masterFlat_BIN-1_FILTER-Ha.fit`. The two stacks' FITS HISTORY lists their input frames from `NGC7000-HOO-Siril/`; the log names no input frame. Siril stacked that master flat from Ha flats the user gave it outside PlateVault, because a run hands Siril masters only (P-CAL3), and wrote it on 2026-10-01. Siril also left one sequence file inside the run folder `NGC7000-HOO-Siril/`.
- P2: A helper process keeps appending to one further file in `NGC7000-HOO-Siril Results/` during S1.
- P3: A final TIFF saved by the user outside the run, at `Work/Finals/NGC7000-HOO.tif`.
- P4: The J19/P5 manifest is available.
- P5: A helper outside PlateVault saves a file's bytes and nanosecond mtime, then overwrites the file in place with a same-size variant whose pixel bytes differ and restores the saved mtime. The helper later restores the saved bytes and mtime.
- P6: A fault control pauses adoption after the destination copy re-reads and verifies and before the master is registered (G4).
- P7: An open Project `NGC 7000 SHO` (subject NGC 7000, rigs RedCat and Esprit) holds a Complete run on rig Esprit with one accepted OIII linear product.
- P8: After J24, Siril processing of each prepared revision of `28 Sep Ha copy check` wrote one Ha stack, and nothing else, into `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/`: one stack from `28 Sep Ha copy check/` and one from `28 Sep Ha copy check (rev 2)/`. Both stacks appeared after revision 2 was prepared, and each stack's FITS HISTORY names the prepared folder it was stacked from. The run's 28 Sep Ha flat is assigned `MasterFlat_2026-09-18.xisf` automatically (J24/S12).

## Steps

### S1 — Discover outputs {#S1}

- **Do:** In `NGC7000-HOO-Siril`, open the Results step.
- **Expect:** Candidates come from `NGC7000-HOO-Siril Results/`. Each shows type, path, availability, processing state where known, and the preparation revision it came from (revision 1). The Ha and OIII stacks name revision 1 from Tool evidence. The log, which records no input list, names revision 1 marked Inferred. The growing file reads Pending. Recognized intermediates are listed apart from the result candidates.
- **Expect (negative):**
  - No candidate reads accepted, and none is claimed to come from the complete reviewed selection. The log does not read Tool evidence.
  - The sequence file inside the run folder is not listed.
  - The Results step offers no action that moves the recognized intermediates to the Trash.
- **Trace:** flow H1 · RES-FR-01 · RES-AC-01 · STO-FR-16 · D-W4, D-W51, D-W67, D-W70

### S1a — Tell two revisions apart in one Results folder {#S1a}

- **Do:** Open the Results step of `28 Sep Ha copy check`.
- **Expect:** Both P8 stacks are listed as candidates from `Work/Outputs/NGC 7000 HOO/28 Sep Ha copy check Results/`. The stack from `28 Sep Ha copy check/` names preparation revision 1, and the stack from `28 Sep Ha copy check (rev 2)/` names revision 2, each from Tool evidence.
- **Expect (negative):** The revision-1 stack is not given revision 2, although revision 2 was current when it appeared, and neither stack reads Inferred. Neither stack reads accepted. Nothing is discovered inside either prepared folder, and no second Results folder is listed for revision 2.
- **Trace:** flow H1 · RES-FR-01, PREP-FR-07 · RES-AC-16 · D-W67 · HARNESS-V5-FEEDBACK-R1.md §Round 6 Calibration ("Result revision")

### S2 — Attach an external output {#S2}

- **Do:** In the Results step, click **Attach…** on the Results folder box. Choose `Work/Finals/NGC7000-HOO.tif` and kind Final image. The file attaches to `NGC7000-HOO-Siril`.
- **Expect:** **Attach…** is shown on the step itself, not inside a menu. The file is listed beside the discovered candidates, labeled Attached, as a Final image. Its run association reads User-linked, and its input-frame lineage reads `Lineage unknown`.
- **Expect (negative):** Lineage is not shown as Tool-recorded.
- **Trace:** flow H2 · RES-FR-02, RES-FR-03 · RES-AC-02 · D-W4

### S3 — Accept products {#S3}

- **Do:** Inspect the Ha stack, the OIII stack and the final image. With the P5 helper, save the final image, overwrite it with its same-size variant, and restore its mtime. Click **Accept** on each of the three.
- **Expect:** The Ha and OIII stacks appear on the run, on Project `NGC 7000 HOO` and on Target NGC 7000. They read protected Keep and show the SHA-256 recorded at acceptance. The final image is refused as changed since inspection and asks to be inspected again.
- **Expect (negative):** The final image is not accepted. Acceptance changes no lineage value, and nothing claims that all 208 planned frames were used.
- **Trace:** flow H3, cross-flow "External changes" · RES-FR-04 · RES-AC-03, RES-AC-10 · D19

### S3a — Accept the re-inspected image {#S3a}

- **Do:** With the P5 helper, restore the final image's saved bytes and mtime. Inspect it again and click **Accept**.
- **Expect:** The final image appears on the run, the Project and the Target. It reads protected Keep and shows the SHA-256 recorded at acceptance.
- **Expect (negative):** Its lineage stays User-linked.
- **Trace:** flow H3 · RES-FR-04 · RES-AC-10 · D19

### S4 — Create a run from accepted Results {#S4}

- **Do:** In Project `NGC 7000 HOO`, click **Start run…**, choose subject NGC 7000 and rig RedCat, and start the run. On the run header choose **Rename** and enter `NGC7000 HOO combine`. In its Select step, deselect every session, click **Add products…**, pick the accepted Ha and OIII stacks, and click **Use 2 products**.
- **Expect:**
  - The run starts with the automatic name `NGC 7000 RedCat`. After Rename its header and the Project's Runs table read `NGC7000 HOO combine`.
  - The **Add products** picker lists each accepted product of another run with its file name, kind, originating run and rig.
  - The new run lists two product inputs, each with its originating run `NGC7000-HOO-Siril`, shown apart from raw sessions.
  - Project `NGC 7000 HOO` gains no members, and its goals gain no integration.
- **Expect (negative):** No raw session integration is added to the new run, and no raw-frame calibration is applied to the products.
- **Trace:** flow H3a · RES-FR-05 · RES-AC-04 · D-W4 · HARNESS-V5-FEEDBACK-R1.md §Round 6 Projects and runs ("Rename runs and Projects")

### S4a — See products from another Project and rig {#S4a}

- **Do:** In the same picker, read the P7 OIII product of Project `NGC 7000 SHO` without picking it.
- **Expect:** The P7 OIII product is offered with its originating run and rig Esprit, marked `Another rig`. Its originating run reads Complete, and the product is offered like any other accepted product.
- **Expect (negative):** No raw Esprit session is offered in this run's inputs. `NGC7000 HOO combine` still lists exactly two product inputs.
- **Trace:** flow H3a · RES-FR-05 · RES-AC-13, RES-AC-14 · D-W8, D-W56 · G3

### S5 — Choose a profile for product inputs {#S5}

- **Do:** Choose the Siril profile and click **Review preparation**.
- **Expect:** If the profile's capability evidence supports these product-input kinds, the review lists both products with their paths. Otherwise preparation is refused, and the review names the unsupported product inputs.
- **Expect (negative):** Products are not silently converted, and PlateVault does not combine channels or stitch panels itself.
- **Trace:** flow H3a · RES-FR-05 · RES-AC-05 · D04

### S6 — Prepare and open the product run {#S6}

- **Do:** Only if S5 listed both products: confirm membership and read the suggested run location. Click **Choose location...**, choose `Work/Processing`, prepare, and click **Open in Siril**. Then quit Siril.
- **Expect:**
  - The suggestion is `Scratch/Processing/NGC 7000 HOO/NGC7000 HOO combine/`, under the last parent chosen in J24/S13.
  - After the choice, the run folder is `Work/Processing/NGC 7000 HOO/NGC7000 HOO combine/`, with its sibling `NGC7000 HOO combine Results/`.
  - The run reads Prepared with exactly two entries, and Siril opens on it.
- **Expect (negative):** No parent is substituted without the user's choice. Quitting Siril does not mark the run Complete.
- **Trace:** flow H3a, F2, F5, F6 · PREP-FR-06, PREP-FR-07, PREP-FR-09, PREP-FR-10 · D-W51

### S7 — Detect same-stat reference drift {#S7}

- **Do:** With the P5 helper, save the accepted OIII stack, overwrite it with its same-size variant, and restore its mtime. Open `NGC7000 HOO combine`. Then open the Select step of `28 Sep Ha copy check`, click **Add products…**, read the picker and close it without picking.
- **Expect:** The OIII product input reads drifted: its rehash differs from its acceptance digest, and it requires review. Its acceptance and lineage show as history for the earlier bytes. The picker lists the OIII stack as drifted and does not offer it, while the Ha stack is still offered.
- **Expect (negative):** Equal size and mtime are not read as unchanged content. The accepted product is not silently replaced, re-accepted or offered for reuse. Reading the picker changes neither the membership nor the prepared revisions of `28 Sep Ha copy check`, and no run is created.
- **Trace:** flow H3a, cross-flow "External changes" · RES-FR-04, RES-FR-05 · RES-AC-09

### S7a — Restore the accepted bytes {#S7a}

- **Do:** With the P5 helper, restore the OIII stack's saved bytes and mtime. Open `NGC7000 HOO combine`, then the **Add products…** picker of `28 Sep Ha copy check` again, and close it without picking.
- **Expect:** The rehash matches the acceptance digest. The OIII product input reads accepted with its original lineage, and the picker offers it again.
- **Expect (negative):** No new acceptance is recorded, no lineage value changes, and `28 Sep Ha copy check`'s membership is unchanged.
- **Trace:** flow H3a · RES-FR-05 · RES-AC-09

### S8 — Meet the once-only master offer and restore it after Dismiss {#S8}

- **Do:** Reopen the Results step of `NGC7000-HOO-Siril` and read **Masters found**. Click **Dismiss** on the master flat. Close and reopen the Results step, and click **Look again**. Open the Calibration library's Dismissed filter, then Matches in `28 Sep Ha copy check`. Back in the Dismissed filter, click **Restore** on the master flat, then reopen the Results step of `NGC7000-HOO-Siril`.
- **Expect:**
  - **Masters found** lists the master flat `masterFlat_BIN-1_FILTER-Ha.fit` once, with kind Flat, channel Ha, its dimensions and its binning. It offers **Add to library** and **Dismiss**.
  - After Dismiss, reopening and **Look again**, it reads `None pending` and `1 dismissed`, which links to the Calibration library's Dismissed filter. Activity records `Dismissed masterFlat_BIN-1_FILTER-Ha.fit`.
  - The Dismissed filter lists the master flat with run `NGC7000-HOO-Siril`, its Project, the time it was dismissed and **Restore**.
  - After Restore the library reads `Offer restored`, and the Dismissed filter no longer lists the master flat. **Masters found** in `NGC7000-HOO-Siril` lists it again with **Add to library** and **Dismiss**.
- **Expect (negative):** While dismissed or offered, the candidate is not assigned or suggested in `28 Sep Ha copy check` or in any other run, and no other run is offered it. Dismiss and Restore write no file: the master flat stays in `NGC7000-HOO-Siril Results/` with its SHA-256 unchanged.
- **Trace:** flow H4 · CAL-FR-06 · CAL-AC-04, CAL-AC-12 · RES-FR-01 · RES-AC-15 · D05, D-W55 · HARNESS-V5-FEEDBACK-R1.md §Domain and seed P-CAL2 · HARNESS-V5-IA.md §Screens S5, S14

### S8a — Meet an occupied adoption path {#S8a}

- **Do:** Click **Add to library** on the master flat and read the confirmation. Outside PlateVault, create an unrelated text file at the destination it names and record that file's SHA-256. Then confirm.
- **Expect:** **Add to library** opens a confirmation that names the destination in structured calibration storage, `Astro-T7/Calibration/Flats/RedCat/Ha/2026-10-01/MasterFlat_2026-10-01.fit`, and the master flat's SHA-256. On confirm, adoption is refused with `Name taken`, and the refusal names the existing file. No other destination or file name is offered.
- **Expect (negative):** Nothing is copied or registered before the confirmation. The unrelated file still matches its recorded SHA-256. No copy is written, no master is registered, and the generated source remains in `NGC7000-HOO-Siril Results/`. The offer stays pending.
- **Trace:** flow H4, cross-flow "Destination collision" · CAL-FR-07 · CAL-AC-08 · D05 · HARNESS-V5-IA.md §Round 2b foundation (`masterStoragePath`) · HARNESS-V5-FEEDBACK-R1.md §Round 6 Calibration ("Adopting a master")

### S8b — Change the master after review {#S8b}

- **Do:** Outside PlateVault, move the S8a file to `Astro-T7/Holding/`. Click **Add to library** again and read the confirmation, which names the same structured path and the master flat's SHA-256. With the P5 helper, save the master flat, overwrite it with its same-size variant, and restore its mtime. Then confirm.
- **Expect:** On confirm PlateVault re-verifies the master flat's bytes against the SHA-256 the confirmation showed. They differ, so adoption is blocked with source drift named, and a new review is required.
- **Expect (negative):** No copy is written to the structured path, no master is registered, and no run is offered the master. PlateVault does not write to the generated source.
- **Trace:** flow H4, cross-flow "External changes" · CAL-FR-07 · CAL-AC-09 · D05 · HARNESS-V5-FEEDBACK-R1.md §Round 6 Calibration ("Adopting a master")

### S8c — Change the master before registration {#S8c}

- **Do:** With the P5 helper, restore the master flat's saved bytes and mtime. Click **Add to library** again; the confirmation names the same structured path and the restored SHA-256. Arm the P6 pause and confirm. When the pause reports the copy verified and awaiting registration, save the master flat with the P5 helper, overwrite it with its variant, restore its mtime, and release the pause.
- **Expect:** The re-verification on confirm passes, so the copy is written and verified before the pause. After the release, adoption is blocked with source drift named, and a new review is required. The verified copy is named as unregistered.
- **Expect (negative):** No master is registered or offered to any run, and the unregistered copy is not offered for reuse. PlateVault does not write to the generated source.
- **Trace:** flow H4 · CAL-FR-07 · CAL-AC-09 · D05 · G4, G9

### S9 — Adopt the master {#S9}

- **Do:** With the P5 helper, restore the master flat's saved bytes and mtime. Click **Add to library** again and confirm. Then open the Calibrate step of `28 Sep Ha copy check` and its Matches.
- **Expect:**
  - The confirmation names `Astro-T7/Calibration/Flats/RedCat/Ha/2026-10-01/MasterFlat_2026-10-01.fit` and the master flat's current SHA-256.
  - On confirm PlateVault re-verifies the source against that SHA-256, copies the master, re-reads and hash-verifies the copy, and revalidates the source. Only then does it register the master in the Calibration library at that path, with origin `Run Results`, `NGC7000-HOO-Siril` and its provenance. **Masters found** reads `None pending`.
  - In `28 Sep Ha copy check`, the 28 Sep Ha flat row still reads Automatic with `MasterFlat_2026-09-18.xisf`, and Calibrate shows "Better match available": the adopted master's night, 2026-10-01, is 3 nights from 28 Sep against 10 for the assigned one. Matches lists the adopted master as a compatible alternative for that row, with `All 8 criteria compatible` in its criteria.
- **Expect (negative):**
  - The generated source in `NGC7000-HOO-Siril Results/` remains in place, and the S8a file keeps its SHA-256 in `Astro-T7/Holding/`.
  - S8b wrote no copy, and the S8c copy is not registered as a second master or offered (G9).
  - No silent re-rank: the 28 Sep Ha flat row of `28 Sep Ha copy check` is not reassigned, and its recorded master and SHA-256 are unchanged. Both prepared revisions keep their 56 and 55 entries and their calibration, and no new preparation revision is proposed. `NGC7000-HOO-Siril` keeps every assigned master.
- **Trace:** flow H4 · CAL-FR-06, CAL-FR-07 · CAL-AC-05, CAL-AC-07, CAL-AC-08, CAL-AC-09 · D05, D-W5 · HARNESS-V5-IA.md §Round 2b foundation (C: Add to calibration library files into structured storage) · HARNESS-V5-FEEDBACK-R1.md §Round 6 Calibration ("Adopting a master", "No silent re-rank") · G9

### S9a — Change the adopted master {#S9a}

- **Do:** With the P5 helper, save the adopted master at its structured storage path, overwrite it with its variant, and restore its mtime. Open the Calibration library, then Matches in `28 Sep Ha copy check`.
- **Expect:** The Calibration library lists the adopted master as drifted against its adoption digest, needing review. `28 Sep Ha copy check` does not list it as an input, it cannot be assigned or accepted there, and Calibrate no longer shows "Better match available".
- **Expect (negative):** The master is not removed, re-adopted or offered to any run, and its adoption provenance stays as history.
- **Trace:** flow H4, cross-flow "External changes" · CAL-FR-08 · CAL-AC-10 · D05, D19

### S9b — Restore the adopted master {#S9b}

- **Do:** With the P5 helper, restore the adopted master's saved bytes and mtime, then reopen Matches in `28 Sep Ha copy check`.
- **Expect:** The rehash matches the adoption digest. The master is listed again as a compatible alternative, and Calibrate shows "Better match available" again, while the 28 Sep Ha flat row still reads `MasterFlat_2026-09-18.xisf`.
- **Expect (negative):** No new adoption is recorded, and no assignment changes.
- **Trace:** flow H4 · CAL-FR-08 · CAL-AC-10 · D19

### S9c — Dismiss an unused master and restore it {#S9c}

- **Do:** In the Calibration library, open the adopted master's details, read its Used by, and click **Dismiss**. Open the Calibrate step of `28 Sep Ha copy check` and its Matches. Then open the Calibration library's Dismissed filter, click **Restore** on the master, and reopen the Calibrate step of `28 Sep Ha copy check` and its Matches.
- **Expect:**
  - Its Used by names no run, and Dismiss is accepted: the master leaves the Flats list and is listed under the Dismissed filter with **Restore**.
  - While it is dismissed, Matches in `28 Sep Ha copy check` does not list it for the 28 Sep Ha flat row, and Calibrate does not show "Better match available".
  - After Restore it is listed under Flats again, Matches lists it as a compatible alternative, and Calibrate shows "Better match available" again.
- **Expect (negative):** Dismiss and Restore move, rename and write no file: the master keeps its structured storage path and SHA-256. The 28 Sep Ha flat row keeps `MasterFlat_2026-09-18.xisf` throughout, and no new adoption is recorded.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 6 Calibration ("A dismissed master is never matched; Restore brings it back") · P-CAL2 · HARNESS-V5-IA.md §Screens S14

## Success criteria

- SC1: At S1 the growing file reads Pending, 0 candidates read accepted, 0 files from inside the run folder are listed, and the log reads revision 1 marked Inferred. At S1a both P8 stacks name their revision, 1 and 2, from Tool evidence and 1 Results folder.
- SC2: **Attach…** is visible on the Results step, and the attached file reads User-linked (S2). 0 lineage values change on acceptance (S3, S3a).
- SC3: `NGC7000 HOO combine` starts as `NGC 7000 RedCat` and is renamed (S4). It has exactly 2 product inputs and 0 raw session integration. The Project gains 0 members from them (S4, S4a). The P7 product of the other Project's Esprit run is offered (S4a).
- SC4: Product-input support is either listed or refused by name, never converted (S5).
- SC5: Same-stat drift is flagged for review, and the drifted product is offered for reuse 0 times (S7). After S7a it is offered again with 0 new acceptances. Reading the picker creates 0 runs (S7, S7a).
- SC6: The master is offered exactly once in the Results step, and it returns 0 times after Dismiss until it is restored from the Dismissed filter. It is offered to 0 other runs (S8). It is registered only after a verified copy in structured calibration storage, and its source remains (S9).
- SC7: The occupied adoption path is refused, and its file changes 0 bytes (S8a).
- SC8: 0 masters are registered while the source differs from the SHA-256 its confirmation showed, and 0 copies are written when the bytes differ on confirm (S8b, S8c). Exactly 1 is registered after a fresh confirmation (S9).
- SC9: The product changed after inspection is accepted 0 times until it is inspected again (S3, S3a).
- SC10: The drifted adopted master is offered 0 times (S9a), and it is offered again with 0 new adoptions after S9b.
- SC11: After adoption, `28 Sep Ha copy check` shows "Better match available", its 28 Sep Ha flat is reassigned 0 times, and its 2 prepared revisions change 0 entries (S9, S9b).
- SC12: The adopted master, used by 0 runs, dismisses. While dismissed it is listed as a match 0 times and "Better match available" shows 0 times; after Restore both return (S9c).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design, which the user instructed on 2026-10-12 that journeys describe: `HARNESS-V5-IA.md` §Screens S5 and S14 and §Round 2b foundation, and `HARNESS-V5-FEEDBACK-R1.md` §Domain and seed P-CAL2 and §Round 1b P-CAL3 (apps/prototype/design/ on ui-harness-v5 @ b5e813a5) and §Round 6 (@ 4f470775), which the prototype does not implement yet. It also follows the specs, the decisions D04, D05, D09, D13 and D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G2: Unresolved implementation qualification: Siril's product-input capability (D04) decides which S5 branch applies. S6 runs only on the supported branch. Blocks readiness.
- G3: Out of scope for this journey: picking a product from another Project into a run (RES-AC-13) is only read in S4a, not prepared. Mixed raw and product inputs in one run, **Add accepted results** in an existing run, and a run group with no group Result (RES-AC-12) are not exercised. Blocks readiness until covered by a step or a journey. J33/S11 and J33/S12 cover a mosaic group Result (RES-AC-11).
- G4: Unresolved implementation qualification: no fault control yet pauses adoption between destination verification and registration (P6), and S8c depends on it. Blocks readiness.
- G5: (dissolved 2026-10-12): answered by Round 6 "No silent re-rank"; S9 now asserts that the prepared run keeps `MasterFlat_2026-09-18.xisf` and both revisions unchanged while Calibrate shows "Better match available", and S9a to S9c assert that the notice follows the adopted master's availability.
- G6: (dissolved 2026-10-12): answered by Round 6 "Result revision"; S1 and S1a now assert that tool evidence decides each stack's revision, also against the revision current when it appeared, and that the log, without it, is marked Inferred.
- G7: (dissolved 2026-10-12): answered by Round 6 "Rename runs and Projects"; S4 now asserts that the run starts as `NGC 7000 RedCat` and is renamed `NGC7000 HOO combine` on the run header, and S7 and S7a read the picker of the existing `28 Sep Ha copy check` instead of starting throwaway runs.
- G8: (dissolved 2026-10-12): answered by Round 6 "Adopting a master"; S8a to S9 now assert that **Add to library** opens a confirmation naming the destination path and SHA-256 and re-verifies the bytes on confirm, so S8b writes no copy. G9 records what stays open.
- G9: Unresolved product question: S8c leaves a verified copy, named unregistered, at the one fixed destination `Astro-T7/Calibration/Flats/RedCat/Ha/2026-10-01/MasterFlat_2026-10-01.fit`, and S9 adopts to that same path. CAL-AC-09 keeps that copy unregistered and CAL-AC-08 refuses an occupied path, but neither the design nor Round 6 says whether S9 is refused with `Name taken`, registers the existing copy once its bytes re-verify, or replaces PlateVault's own unregistered copy. S9 asserts the registration without deciding it. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1, +S1a, S2, S4, +S4a, S6, S7, S8, S8a, S9, S9a, S9b · behavior-change
  Results are discovered in the sibling `<Run> Results/` folder, one folder for every revision, and each candidate records its revision. Attach Result is a visible action on the Results step. Reuse is through a new run's Results input filter, across Projects and rigs. Intermediates are never trashed from the Results step. The new master is offered once in the Results step, with Dismiss.
  Evidence: specs/070-results-reuse RES-FR-01, RES-FR-02, RES-FR-05, RES-AC-01, RES-AC-13, RES-AC-14, RES-AC-15. specs/068-calibration-inputs CAL-FR-06, CAL-AC-12. D-W4, D-W55, D-W56, D-W67 at e4476231. D-W67, D-W70. 070 RES-FR-01, RES-FR-05, RES-AC-16, 069 PREP-FR-07 and 071 STO-FR-16 · by: JourneysC (intent-gated)
- **Δ3** 2026-10-12 · S2, S3, S3a, S4, S4a, S7, S7a, S8, S8a, S8b, S8c, S9, S9a, S9b · behavior-change
  Attach is **Attach…**, Accept works per product, and reuse goes through a run's **Add products…** picker, where another rig reads `Another rig`. Siril's master flat no longer comes from raw flats PlateVault handed it.
  Dismiss is reversible: the offer goes to the Calibration library's Dismissed filter, where Restore offers it again. Add to library files the master at a fixed path in structured calibration storage, so no destination or file name is chosen.
  Evidence: HARNESS-V5-IA.md §Screens S5, S14, §Round 2b foundation (C: masters only, `masterStoragePath`); HARNESS-V5-FEEDBACK-R1.md §Domain and seed P-CAL2, §Round 1b P-CAL3; prototype src/features/v5/c-runs/results-step.tsx, select-step.tsx, actions.ts (`answerMasterOffer`), messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U4Calibration (intent-gated)
- **Δ4** 2026-10-12 · S1, S1a, S4, S7, S7a, S8a, S8b, S8c, S9, S9a, S9b, +S9c · behavior-change
  A Result's revision comes from tool evidence, else it is marked Inferred. The combine run starts auto-named and is renamed on the run header, and drift is read in an existing run's picker.
  **Add to library** opens a confirmation with the destination and SHA-256 and re-verifies the bytes on confirm. A better adopted master reassigns nothing: Calibrate shows "Better match available". A master no run uses can be dismissed and is not matched until restored.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Result revision", "Rename runs and Projects", "Adopting a master", "No silent re-rank", "Dismiss is refused while a run uses the master" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6D (intent-gated)
