---
id: J26
title: Discover, attach, and accept results, reuse them, and adopt a generated master
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [results, view-review, preparation, calibration, projects, targets]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 070-results-reuse, 068-calibration-inputs, 069-application-handoff, D04, D05, D09, D13, specs/063-clean-rebuild-contract/decisions.md, specs/070-results-reuse/spec.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-h-results-and-generated-masters]
---

## Goal

After processing in Siril, the user finds what the application wrote, attaches a
file saved elsewhere, accepts the valuable products with honest lineage, hands
two accepted channel products to a new View, and adopts a generated master into
the calibration library. Done means three accepted products appear on the View,
Project and Target with actual lineage. The new View lists two product inputs
and no raw integration. The master is reusable only after explicit adoption and
a verified durable copy. Nothing is accepted, adopted or upgraded in lineage
automatically.

## Preconditions

- P1: J24 completed (`28 Sep Ha copy check` is Prepared). In Siril, processing of `NGC7000-HOO-Siril` has written into `output/`: calibrated and registered intermediates, an Ha linear stack, an OIII linear stack, a master flat generated from the Ha raw flats, and a log.
- P2: A helper process keeps appending to one further file in `output/` during S1.
- P3: A final TIFF saved by the user outside the View, at `Work/Finals/NGC7000-HOO.tif`.
- P4: The J19/P5 manifest is available.

## Steps

### S1 — Discover outputs {#S1}

- **Do:** Open Results for `NGC7000 HOO - Siril`.
- **Expect:** Candidates from the recorded output location show type, path, availability, and processing state where known. The growing file reads Pending. Recognized intermediates are listed apart from result candidates.
- **Expect (negative):** No candidate reads accepted, and none is claimed to come from the complete reviewed selection.
- **Trace:** flow H1 · RES-FR-01

### S2 — Attach an external output {#S2}

- **Do:** Click **Attach Result**, choose `Work/Finals/NGC7000-HOO.tif`, choose kind Final image, and associate it with `NGC7000 HOO - Siril`.
- **Expect:** The file is listed as a Final image candidate with lineage User-linked.
- **Expect (negative):** Lineage is not shown as Tool-recorded.
- **Trace:** flow H2 · RES-FR-02, RES-FR-03 · RES-AC-02

### S3 — Accept products {#S3}

- **Do:** Inspect the Ha stack, the OIII stack, and the final image, each with its association. Select all three and click **Accept Result**.
- **Expect:** The three products appear on the View, on Project `NGC 7000 HOO`, and on Target NGC 7000, and read Keep for cleanup.
- **Expect (negative):** Acceptance does not change any lineage value, and nothing claims that all 208 planned frames were used.
- **Trace:** flow H3 · RES-FR-04 · RES-AC-03

### S4 — Create a View from accepted results {#S4}

- **Do:** Select the accepted Ha and OIII stacks, click **Create View from results**, and enter `NGC7000 HOO combine`.
- **Expect:** A result picker groups products by originating View with kind, path, availability, and lineage. The new View lists two product inputs with their originating View, shown apart from raw light sessions.
- **Expect (negative):** No raw session integration is added to the new View, and no raw-frame calibration is applied to the products.
- **Trace:** flow H3a · RES-FR-05 · RES-AC-04

### S5 — Choose a profile for product inputs {#S5}

- **Do:** Choose the Siril profile and click **Review preparation**.
- **Expect:** If the profile's capability evidence supports these product-input kinds, the review lists both products with their paths. Otherwise preparation is refused and names the unsupported product inputs.
- **Expect (negative):** Products are not silently converted, and PlateVault does not combine channels or stitch panels itself.
- **Trace:** flow H3a · RES-FR-05 · RES-AC-05 · D04

### S6 — Prepare and open the product View {#S6}

- **Do:** Only if S5 listed both products: confirm membership, keep the suggested location, prepare, and click **Open in Siril**; then quit Siril.
- **Expect:** The suggested location is a new unique subfolder under `Work/Processing`. The View reads Prepared with exactly two entries, and Siril opens on it.
- **Expect (negative):** Quitting Siril does not mark the View Complete.
- **Trace:** flow H3a, F5, F6 · PREP-FR-06, PREP-FR-09, PREP-FR-10

### S7 — Detect reference drift {#S7}

- **Do:** Overwrite the bytes of the accepted OIII stack outside PlateVault, then reopen `NGC7000 HOO combine`.
- **Expect:** The OIII product input reads as drifted and requires review.
- **Expect (negative):** The accepted product is not silently replaced or re-accepted.
- **Trace:** flow H3a, cross-flow "External changes" · RES-FR-05

### S8 — See a generated master candidate {#S8}

- **Do:** Open Calibration, then open the Calibration area of `28 Sep Ha copy check`.
- **Expect:** Calibration lists the generated master flat as a detected candidate with **Add to calibration library**, its type, camera/settings, channel, source evidence, and origin.
- **Expect (negative):** The candidate is not preselected in `28 Sep Ha copy check` or any other View.
- **Trace:** flow H4 · CAL-FR-06 · CAL-AC-04 · D05

### S8a — Meet an occupied adoption path {#S8a}

- **Do:** Click **Add to calibration library**, choose `Astro-T7/Calibration` as the durable destination, and read the destination path in the review. Outside PlateVault, create an unrelated text file at that path and record its SHA-256. Then confirm.
- **Expect:** Adoption is refused for that path, names the existing file, and asks for another name or destination.
- **Expect (negative):** The unrelated file still matches its recorded SHA-256. No copy is written, no master is registered, and the generated source remains in `output/`.
- **Trace:** flow H4, cross-flow "Destination collision" · CAL-FR-07 · CAL-AC-08 · D05

### S9 — Adopt the master {#S9}

- **Do:** Choose another file name under `Astro-T7/Calibration` and confirm. Then reopen the Calibration area of `28 Sep Ha copy check`.
- **Expect:** PlateVault copies the master, re-reads and hash-verifies the copy, and only then registers it in Calibration with origin `NGC7000 HOO - Siril` and its provenance. In `28 Sep Ha copy check` it appears as a compatible suggestion awaiting acceptance.
- **Expect (negative):** The generated source in `output/` remains in place, and the S8a file is unchanged. The adopted master is not handed off before it is accepted.
- **Trace:** flow H4 · CAL-FR-06, CAL-FR-07 · CAL-AC-05, CAL-AC-07, CAL-AC-08 · D05, D13

## Success criteria

- SC1: At S1 the growing file reads Pending and 0 candidates read accepted.
- SC2: The attached file reads User-linked (S2); 0 lineage values change on acceptance (S3).
- SC3: `NGC7000 HOO combine` has exactly 2 product inputs and 0 raw session integration (S4).
- SC4: Product-input support is either listed or refused by name, never converted (S5).
- SC5: Drift is flagged for review, with 0 silent replacements (S7).
- SC6: The master is offered to 0 Views before adoption (S8); it is registered only after a verified copy, and its source remains (S9).
- SC7: The occupied adoption path is refused and its file changes 0 bytes (S8a).

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D04, D05, D09, and D13; no implementation has been validated against them.
- G2: Unresolved implementation qualification — Siril's product-input capability (D04) decides which S5 branch applies; S6 runs only on the supported branch. Blocks readiness.
- G3: Out of scope for this journey — mixed raw/product inputs in one View and **Add accepted results** in an existing View's workspace are not exercised. Blocks readiness until covered by a step or a journey.

## Delta log

- No entries (initial draft, version 1).
