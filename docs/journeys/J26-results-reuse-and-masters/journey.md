---
id: J26
title: Discover and attach Results, reuse them as run inputs, and adopt a master offered once
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [results, view-review, preparation, calibration, projects, targets]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 070-results-reuse, 068-calibration-inputs, 069-application-handoff, 071-storage-custody, D04, D05, D09, D13, D19, D-W4, D-W5, D-W8, D-W51, D-W55, D-W56, D-W64, D-W67, D-W70, D-W71, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/070-results-reuse/spec.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, specs/071-storage-custody/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-h-results-and-generated-masters]
---

## Goal

After processing in Siril, the user opens the run's Results step and finds
what Siril wrote to `NGC7000-HOO-Siril Results/`. The user attaches a file
saved elsewhere through the visible **Attach Result** action and accepts the
valuable products with honest lineage. Two accepted channel products then
become the inputs of a new run in the Project. The generated master flat is
offered once in the Results step and is adopted into the calibration
library from Calibration. Done means:
- Three accepted products appear on the run, the Project and the Target with their actual lineage.
- Every discovered candidate names the prepared revision it came from, also when two revisions share one Results folder.
- The new run lists two product inputs and no raw integration. An accepted product of an Abandoned run is still offered.
- The master is reusable only after explicit adoption and a verified durable copy.
- An accepted product or adopted master whose bytes change is not offered for reuse.
- Nothing is accepted, adopted or upgraded in lineage automatically.

## Preconditions

- P1: J24 completed. Siril processing of `NGC7000-HOO-Siril` has written these files into `Work/Processing/NGC 7000 HOO/NGC7000-HOO-Siril Results/`: calibrated and registered intermediates, an Ha linear stack, an OIII linear stack, a master flat generated from the Ha raw flats, and a log. Siril also left one sequence file inside the run folder `NGC7000-HOO-Siril/`.
- P2: A helper process keeps appending to one further file in `NGC7000-HOO-Siril Results/` during S1.
- P3: A final TIFF saved by the user outside the run, at `Work/Finals/NGC7000-HOO.tif`.
- P4: The J19/P5 manifest is available.
- P5: A helper outside PlateVault saves a file's bytes and nanosecond mtime, then overwrites the file in place with a same-size variant whose pixel bytes differ and restores the saved mtime. The helper later restores the saved bytes and mtime.
- P6: A fault control pauses adoption after the destination copy re-reads and verifies and before the master is registered (G4).
- P7: An open Project `NGC 7000 SHO` (subject NGC 7000, rigs RedCat and Esprit) holds a run on rig Esprit with one accepted OIII linear product. That run was then marked Abandoned.
- P8: After J24, Siril processing of each prepared revision of `28 Sep Ha copy check` wrote one Ha stack, and nothing else, into `Work/Outputs/28 Sep Ha copy check Results/`: one stack from `28 Sep Ha copy check/` and one from `28 Sep Ha copy check (rev 2)/`. Each stack's FITS HISTORY names the prepared folder it was stacked from (G6).

## Steps

### S1 — Discover outputs {#S1}

- **Do:** In `NGC7000-HOO-Siril`, open the Results step.
- **Expect:** Candidates come from `NGC7000-HOO-Siril Results/`. Each shows type, path, availability, processing state where known, and the preparation revision it came from (revision 1). The growing file reads Pending. Recognized intermediates are listed apart from the result candidates.
- **Expect (negative):**
  - No candidate reads accepted, and none is claimed to come from the complete reviewed selection.
  - The sequence file inside the run folder is not listed.
  - The Results step offers no action that moves the recognized intermediates to the Trash.
- **Trace:** flow H1 · RES-FR-01 · RES-AC-01 · STO-FR-16 · D-W4, D-W51, D-W67, D-W70

### S1a — Tell two revisions apart in one Results folder {#S1a}

- **Do:** Open the Results step of `28 Sep Ha copy check`.
- **Expect:** Both P8 stacks are listed as candidates from `Work/Outputs/28 Sep Ha copy check Results/`. The stack from `28 Sep Ha copy check/` names preparation revision 1, and the stack from `28 Sep Ha copy check (rev 2)/` names revision 2.
- **Expect (negative):** Neither stack reads accepted. Nothing is discovered inside either prepared folder, and no second Results folder is listed for revision 2.
- **Trace:** flow H1 · RES-FR-01, PREP-FR-07 · RES-AC-16 · D-W67 · G6

### S2 — Attach an external output {#S2}

- **Do:** In the Results step, click **Attach Result** beside the discovered list. Choose `Work/Finals/NGC7000-HOO.tif`, choose kind Final image, and keep run `NGC7000-HOO-Siril`.
- **Expect:** **Attach Result** is shown on the step itself, not inside a menu. The file is listed beside the discovered candidates, labeled attached, as a Final image. Its run association reads User-linked, and its input-frame lineage reads Unknown.
- **Expect (negative):** Lineage is not shown as Tool-recorded.
- **Trace:** flow H2 · RES-FR-02, RES-FR-03 · RES-AC-02 · D-W4

### S3 — Accept products {#S3}

- **Do:** Inspect the Ha stack, the OIII stack and the final image. With the P5 helper, save the final image, overwrite it with its same-size variant, and restore its mtime. Select all three and click **Accept Result**.
- **Expect:** The Ha and OIII stacks appear on the run, on Project `NGC 7000 HOO` and on Target NGC 7000. They read protected Keep and show the SHA-256 recorded at acceptance. The final image is refused as changed since inspection and asks to be inspected again.
- **Expect (negative):** The final image is not accepted. Acceptance changes no lineage value, and nothing claims that all 208 planned frames were used.
- **Trace:** flow H3, cross-flow "External changes" · RES-FR-04 · RES-AC-03, RES-AC-10 · D19

### S3a — Accept the re-inspected image {#S3a}

- **Do:** With the P5 helper, restore the final image's saved bytes and mtime. Inspect it again and click **Accept Result**.
- **Expect:** The final image appears on the run, the Project and the Target. It reads protected Keep and shows the SHA-256 recorded at acceptance.
- **Expect (negative):** Its lineage stays User-linked.
- **Trace:** flow H3 · RES-FR-04 · RES-AC-10 · D19

### S4 — Create a run from accepted Results {#S4}

- **Do:** In Project `NGC 7000 HOO`, start a processing run `NGC7000 HOO combine` on subject NGC 7000 and rig RedCat. In its input filters, deselect every session, open **Results**, and pick the accepted Ha and OIII stacks.
- **Expect:**
  - The Results picker groups products by originating Project and run, and shows kind, subject, rig, path, availability and lineage.
  - The new run lists two product inputs, each with its originating run `NGC7000-HOO-Siril`, shown apart from raw sessions.
  - Project `NGC 7000 HOO` gains no members, and its goals gain no integration.
- **Expect (negative):** No raw session integration is added to the new run, and no raw-frame calibration is applied to the products.
- **Trace:** flow H3a · RES-FR-05 · RES-AC-04 · D-W4

### S4a — See products from another Project and rig {#S4a}

- **Do:** In the same picker, read the group for Project `NGC 7000 SHO` without picking from it.
- **Expect:** The P7 OIII product is offered with its originating run, Project `NGC 7000 SHO`, and the label rig Esprit. Its originating run reads Abandoned, and the product is offered like any other accepted product.
- **Expect (negative):** No raw Esprit session is offered in this run's inputs. `NGC7000 HOO combine` still lists exactly two product inputs.
- **Trace:** flow H3a · RES-FR-05, RES-FR-09 · RES-AC-13, RES-AC-14, RES-AC-17 · D-W8, D-W56, D-W64, D-W71 · G3

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

- **Do:** With the P5 helper, save the accepted OIII stack, overwrite it with its same-size variant, and restore its mtime. Open `NGC7000 HOO combine`. Then start another run in the Project and read its Results input filter without saving the run.
- **Expect:** The OIII product input reads drifted: its rehash differs from its acceptance digest, and it requires review. Its acceptance and lineage show as history for the earlier bytes. The picker lists the OIII stack as drifted and does not offer it, while the Ha stack is still offered.
- **Expect (negative):** Equal size and mtime are not read as unchanged content. The accepted product is not silently replaced, re-accepted or offered for reuse.
- **Trace:** flow H3a, cross-flow "External changes" · RES-FR-04, RES-FR-05 · RES-AC-09

### S7a — Restore the accepted bytes {#S7a}

- **Do:** With the P5 helper, restore the OIII stack's saved bytes and mtime. Open `NGC7000 HOO combine` and the Results input filter of a new run again, then discard the new run.
- **Expect:** The rehash matches the acceptance digest. The OIII product input reads accepted with its original lineage, and the picker offers it again.
- **Expect (negative):** No new acceptance is recorded, and no lineage value changes.
- **Trace:** flow H3a · RES-FR-05 · RES-AC-09

### S8 — Meet the once-only master offer {#S8}

- **Do:** Reopen the Results step of `NGC7000-HOO-Siril` and read the generated master flat. Choose **Dismiss** on its offer. Close and reopen the Results step, then open Calibration and the Review matches of `28 Sep Ha copy check`.
- **Expect:**
  - The Results step lists the master flat as a candidate and offers **Add to calibration library** once, with its type, camera/settings, channel, source evidence and origin.
  - After Dismiss and reopening, the offer does not return.
  - Calibration still lists the master flat as a detected candidate with **Add to calibration library**.
- **Expect (negative):** The candidate is not assigned or suggested in `28 Sep Ha copy check` or in any other run.
- **Trace:** flow H4 · CAL-FR-06 · CAL-AC-04, CAL-AC-12 · RES-FR-01 · RES-AC-15 · D05, D-W55

### S8a — Meet an occupied adoption path {#S8a}

- **Do:** In Calibration, click **Add to calibration library** for the master flat. Choose `Astro-T7/Calibration` as the durable destination, and read the destination path in the review. Outside PlateVault, create an unrelated text file at that path and record its SHA-256. Then confirm.
- **Expect:** Adoption is refused for that path. The refusal names the existing file and asks for another name or destination.
- **Expect (negative):** The unrelated file still matches its recorded SHA-256. No copy is written, no master is registered, and the generated source remains in `NGC7000-HOO-Siril Results/`.
- **Trace:** flow H4, cross-flow "Destination collision" · CAL-FR-07 · CAL-AC-08 · D05

### S8b — Change the master after review {#S8b}

- **Do:** Enter a free file name under `Astro-T7/Calibration` and read the review, which shows the master flat's SHA-256. With the P5 helper, save the master flat, overwrite it with its same-size variant, and restore its mtime. Then confirm.
- **Expect:** Adoption is blocked because the source's bytes differ from the reviewed digest, and a new review is required. Any copy already written is named as unregistered.
- **Expect (negative):** No master is registered, and no run is offered the master or any copy of it. PlateVault does not write to the generated source.
- **Trace:** flow H4, cross-flow "External changes" · CAL-FR-07 · CAL-AC-09 · D05

### S8c — Change the master before registration {#S8c}

- **Do:** With the P5 helper, restore the master flat's saved bytes and mtime. Review adoption again with another free file name, arm the P6 pause, and confirm. When the pause reports the copy verified and awaiting registration, save the master flat with the P5 helper, overwrite it with its variant, restore its mtime, and release the pause.
- **Expect:** Adoption is blocked with source drift named, and a new review is required. The verified copy is named as unregistered.
- **Expect (negative):** No master is registered or offered to any run, and the unregistered copy is not offered for reuse. PlateVault does not write to the generated source.
- **Trace:** flow H4 · CAL-FR-07 · CAL-AC-09 · D05

### S9 — Adopt the master {#S9}

- **Do:** With the P5 helper, restore the master flat's saved bytes and mtime. Review adoption again with another free file name under `Astro-T7/Calibration`, and confirm. Then open Review matches in `28 Sep Ha copy check`.
- **Expect:**
  - The review shows the current SHA-256.
  - PlateVault copies the master, re-reads and hash-verifies the copy, and revalidates the source against the reviewed digest. Only then does it register the master in Calibration, with origin `NGC7000-HOO-Siril` and its provenance.
  - In `28 Sep Ha copy check`, the adopted master is listed as a compatible input for the 28 Sep Ha flat row, with every criterion compatible in **Why this match**.
- **Expect (negative):**
  - The generated source in `NGC7000-HOO-Siril Results/` remains in place, and the S8a file is unchanged.
  - Neither the S8b nor the S8c copy is registered or offered.
  - The calibration of `28 Sep Ha copy check`'s existing preparation revisions is unchanged.
- **Trace:** flow H4 · CAL-FR-06, CAL-FR-07 · CAL-AC-05, CAL-AC-07, CAL-AC-08, CAL-AC-09 · D05, D-W5 · G5

### S9a — Change the adopted master {#S9a}

- **Do:** With the P5 helper, save the adopted master in `Astro-T7/Calibration`, overwrite it with its variant, and restore its mtime. Open Calibration, then Review matches in `28 Sep Ha copy check`.
- **Expect:** Calibration lists the adopted master as drifted against its adoption digest, needing review. `28 Sep Ha copy check` does not list it as an input, and it cannot be assigned or accepted there.
- **Expect (negative):** The master is not removed, re-adopted or offered to any run, and its adoption provenance stays as history.
- **Trace:** flow H4, cross-flow "External changes" · CAL-FR-08 · CAL-AC-10 · D05, D19

### S9b — Restore the adopted master {#S9b}

- **Do:** With the P5 helper, restore the adopted master's saved bytes and mtime, then reopen Review matches in `28 Sep Ha copy check`.
- **Expect:** The rehash matches the adoption digest, and the master is listed again as a compatible input.
- **Expect (negative):** No new adoption is recorded.
- **Trace:** flow H4 · CAL-FR-08 · CAL-AC-10 · D19

## Success criteria

- SC1: At S1 the growing file reads Pending, 0 candidates read accepted, and 0 files from inside the run folder are listed. At S1a both P8 stacks name their revision, 1 and 2, from 1 Results folder.
- SC2: **Attach Result** is visible on the Results step, and the attached file reads User-linked (S2). 0 lineage values change on acceptance (S3, S3a).
- SC3: `NGC7000 HOO combine` has exactly 2 product inputs and 0 raw session integration. The Project gains 0 members from them (S4, S4a). The Abandoned run's P7 product is offered (S4a).
- SC4: Product-input support is either listed or refused by name, never converted (S5).
- SC5: Same-stat drift is flagged for review, and the drifted product is offered for reuse 0 times (S7). After S7a it is offered again with 0 new acceptances.
- SC6: The master is offered exactly once in the Results step and returns 0 times after Dismiss. It is offered to 0 runs before adoption (S8). It is registered only after a verified copy, and its source remains (S9).
- SC7: The occupied adoption path is refused, and its file changes 0 bytes (S8a).
- SC8: 0 masters are registered while the source differs from its reviewed digest (S8b, S8c). Exactly 1 is registered after a fresh review (S9).
- SC9: The product changed after inspection is accepted 0 times until it is inspected again (S3, S3a).
- SC10: The drifted adopted master is offered 0 times (S9a), and it is offered again with 0 new adoptions after S9b.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs, the decisions D04, D05, D09, D13 and D19 set by the authorized autonomous run, and the user's workflow decisions cited above. No implementation has been validated against them.
- G2: Unresolved implementation qualification: Siril's product-input capability (D04) decides which S5 branch applies. S6 runs only on the supported branch. Blocks readiness.
- G3: Out of scope for this journey: picking a product from another Project into a run (RES-AC-13) is only read in S4a, not prepared. Mixed raw and product inputs in one run, **Add accepted results** in an existing run, and a run group with no group Result (RES-AC-12) are not exercised. Blocks readiness until covered by a step or a journey. J33/S11 and J33/S12 cover a mosaic group Result (RES-AC-11).
- G4: Unresolved implementation qualification: no fault control yet pauses adoption between destination verification and registration (P6), and S8c depends on it. Blocks readiness.
- G5: Unresolved product question: the specs do not say whether adopting a master re-ranks the automatic assignments of an existing run that is already prepared. S9 asserts only that the master is listed as a compatible input. Blocks readiness.
- G6: Unresolved product question: RES-FR-01 says each discovered Result records the prepared revision it came from, but the specs do not say how PlateVault decides it. S1a assumes that the P8 header evidence decides it, because both stacks were written after revision 2 existed. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1, +S1a, S2, S4, +S4a, S6, S7, S8, S8a, S9, S9a, S9b · behavior-change
  Results are discovered in the sibling `<Run> Results/` folder, one folder for every revision, and each candidate records its revision. Attach Result is a visible action on the Results step. Reuse is through a new run's Results input filter, across Projects and rigs, and includes products of an Abandoned run. Intermediates are never trashed from the Results step. The new master is offered once in the Results step, with Dismiss.
  Evidence: specs/070-results-reuse RES-FR-01, RES-FR-02, RES-FR-05, RES-AC-01, RES-AC-13, RES-AC-14, RES-AC-15; specs/068-calibration-inputs CAL-FR-06, CAL-AC-12; D-W4, D-W55, D-W56, D-W67 at e4476231; D-W64, D-W67, D-W70, D-W71; 070 RES-FR-01, RES-FR-05, RES-FR-09, RES-AC-16, RES-AC-17; 069 PREP-FR-07; 071 STO-FR-16 at d45a22ad · by: JourneysC (intent-gated)
