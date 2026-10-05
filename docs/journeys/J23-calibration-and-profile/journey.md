---
id: J23
title: Resolve calibration and choose an application profile for a reviewed View
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [calibration, view-review, preparation]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 068-calibration-inputs, 069-application-handoff, D04, D13, D15, specs/063-clean-rebuild-contract/decisions.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-e-choose-calibration-and-application-preparation]
---

## Goal

For the reviewed selection, the user explicitly accepts explainable calibration
suggestions, prefers an alternative flat whose compatibility is unknown for one
session and records a scoped exception with a reason, picks a maintained
application profile, and decides how a catalog correction reaches the
application. Done means: every calibration input
is accepted or carries a recorded exception with its reason; the Siril profile is
chosen with its capability evidence shown; the review names the effective value
the application will read for the corrected session; and no calibration or
source file is created or changed.

## Preconditions

- P1: J22 completed.
- P2: Calibration fixture in `Astro-T7/Calibration`, indexed in J19:
  - Darks match camera, dimensions, binning, gain, offset, image type, 300 s exposure and recorded temperature exactly.
  - Raw Ha flats have Ha channel and RedCat optical-train evidence.
  - Raw OIII flats taken 30 Sep have OIII channel and RedCat optical-train evidence.
  - For 24 Sep, the 30 Sep OIII flats match every D13 flat criterion and are the compatible suggestion. The 26 Sep OIII flats lack optical-train evidence and are an alternative candidate.
- P3: Siril is installed at a known path and not yet configured in PlateVault.
- P4: The J19/P5 manifest is available.

## Steps

### S1 — Open calibration review {#S1}

- **Do:** In `NGC7000 HOO - Siril`, open the Calibration area.
- **Expect:** Inputs are grouped by camera, settings, channel, and relevant geometry. Compatible darks and flats are preselected per group and marked as suggestions.
- **Expect (negative):** No suggestion reads accepted before S3.
- **Trace:** flow E1 · CAL-FR-01, CAL-FR-02 · CAL-AC-01 · D13

### S2 — Ask why a match was suggested {#S2}

- **Do:** Open **Why this match** for the Ha flat suggestion.
- **Expect:** Compatible, incompatible, and unknown criteria are listed separately, covering camera, dimensions, binning, gain/offset, image type, channel, and optical-train evidence.
- **Expect (negative):** No temperature tolerance is applied unless it is shown.
- **Trace:** flow E1 · CAL-FR-03 · D13

### S3 — Accept the compatible suggestions {#S3}

- **Do:** Accept every suggestion except 24 Sep's flat suggestion.
- **Expect:** Those assignments read accepted and are visually distinct from suggestions; **Why this match** remains available on each. 24 Sep's 30 Sep OIII flat suggestion still reads a suggestion.
- **Trace:** flow E1 · CAL-FR-02, CAL-FR-03 · D13

### S4 — Hand raw flats to the application {#S4}

- **Do:** Inspect the accepted Ha flat assignment.
- **Expect:** It reads as a raw calibration set to be handed to the external application, which builds its own masters.
- **Expect (negative):** PlateVault writes no master file.
- **Trace:** flow E1 · CAL-FR-04 · root FR-015

### S5 — Choose the alternative flat for 24 Sep {#S5}

- **Do:** For 24 Sep, open **Why this match** for the suggested 30 Sep OIII flats and for the 26 Sep OIII flats. Choose the 26 Sep set instead of the suggestion, then click **Review preparation**.
- **Expect:** The 30 Sep set lists every criterion compatible; the 26 Sep set lists optical-train state unknown. The review lists 24 Sep's flat as unresolved because the chosen 26 Sep set has an unknown criterion. The offered choices are another input (the compatible 30 Sep suggestion), exclude the session, defer preparation, or record a scoped exception with a reason.
- **Expect (negative):** The 26 Sep set is not shown as compatible, and the unresolved flat is not counted as a handoff input. The 30 Sep suggestion is neither accepted nor substituted without the user's choice.
- **Trace:** flow E2, C1 · CAL-FR-03, CAL-FR-05, CAL-FR-08 · CAL-AC-02, CAL-AC-06 · D13

### S6 — Record a scoped exception {#S6}

- **Do:** Record an exception for 24 Sep using the 26 Sep flats with reason `Same rotation as 26 Sep; train not changed`.
- **Expect:** The review shows the exception with the unknown criterion and the reason; 24 Sep no longer reads unresolved. The 30 Sep set stays listed as an unassigned compatible alternative.
- **Expect (negative):** The 26 Sep flat set's own evidence still reads optical-train unknown; the exception does not make it compatible elsewhere.
- **Trace:** flow E2 · CAL-FR-05 · CAL-AC-03 · D13

### S7 — Confirm the exception is View-scoped {#S7}

- **Do:** From Sessions, create a standalone View from 24 Sep only and open its Calibration area.
- **Expect:** The 30 Sep OIII flats are suggested as compatible, and the 26 Sep flats read optical-train unknown with no exception attached.
- **Trace:** flow E2 · CAL-FR-05 · CAL-AC-03

### S8 — Choose the Siril profile {#S8}

- **Do:** In `NGC7000 HOO - Siril`, choose application Siril and locate its executable.
- **Expect:** The profile shows its installed or documented capability evidence: supported input, layout, configuration, product-input kinds, and input-write behavior. Unsupported configuration is named.
- **Expect (negative):** No capability is claimed as verified without that evidence. The profile does not claim that renaming files overrides headers. Siril is not launched.
- **Trace:** flow E3 · PREP-FR-01 · D04 · G2

### S9 — See the generic alternative {#S9}

- **Do:** In the standalone 24 Sep View, choose **Open in...**.
- **Expect:** It asks for an executable and launch arguments and reads as not a verified preparation profile. Because its input-write behavior is unknown, Linked View and Direct source read blocked and isolated Copy or supported Clone is offered.
- **Trace:** flow E3 alternative · PREP-FR-02, PREP-FR-04 · D04

### S10 — See a corrected value {#S10}

- **Do:** In `NGC7000 HOO - Siril`, return to **Review preparation** and open the 28 Sep entry.
- **Expect:** The review shows the catalog's effective focal length from the confirmed equipment (J19/S10) next to the value Siril will read from the header (absent). Options: supported application configuration, isolated patched copies or clones, accept the source-header value, or exclude the inputs.
- **Trace:** flow E4 · PREP-FR-03 · D15

### S11 — Accept the source value for this handoff {#S11}

- **Do:** Choose **accept the source-header value** for 28 Sep.
- **Expect:** The review names the effective handoff value as the header value and the materialization mode as not patched.
- **Expect (negative):** The correction is not claimed as delivered. No original is patched; the manifest still equals P4.
- **Trace:** flow E4 · PREP-FR-03 · PREP-AC-06 · D15

## Success criteria

- SC1: Compatible suggestions remain distinct from assignments until S3 explicitly accepts them; 24 Sep's compatible 30 Sep suggestion is never accepted or substituted silently (S3, S5, S6).
- SC2: 24 Sep reads unresolved from choosing the 26 Sep set in S5 until S6, and its exception record shows both the unknown criterion and the reason.
- SC3: The 26 Sep flat evidence is unchanged, and another View shows it unknown with no exception (S7).
- SC4: PlateVault creates 0 calibration files, and the manifest equals P4 at S11.
- SC5: The Siril profile shows its capability evidence (S8); **Open in...** reads unverified with Linked and Direct source blocked (S9).
- SC6: For 28 Sep the review names the header value as effective and claims no delivered correction (S11).

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D04, D13, and D15; no implementation has been validated against them.
- G2: Unresolved implementation qualification — profile capability probes for Siril (D04) must exist before S8 can show verified evidence; PixInsight/WBPP and SETI Astro Suite Pro profiles are not exercised in this journey. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
