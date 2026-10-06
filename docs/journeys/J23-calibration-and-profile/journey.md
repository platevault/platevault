---
id: J23
title: Calibrate a processing run automatically, resolve an exception and choose an application profile
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [calibration, run-workspace, preparation, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 068-calibration-inputs, 069-application-handoff, D04, D13, D15, D19, D-W3, D-W5, D-W37, D-W49, D-W50, D-W55, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-e-choose-calibration-and-application-preparation]
---

## Goal

When the reviewed processing run reaches Calibrate, PlateVault assigns
every fully compatible dark and flat without user action. The readiness line
reports the result, and Review matches explains each assignment. The user
replaces one automatic flat with an alternative whose compatibility is
unknown, records a scoped exception with a reason, picks a maintained
application profile, and decides how a catalog correction reaches the
application. Done means:
- Every light group is Automatic, Accepted, or Excepted with its reason.
- The Siril profile is chosen and its capability evidence is shown.
- The review names the effective value Siril will read for the corrected session.
- No calibration or source file is created or changed.

## Preconditions

- P1: J22 completed. Run `NGC7000-HOO-Siril` in Project `NGC 7000 HOO` (subject NGC 7000, rig RedCat) has a saved membership of 208 lights / 17h 20m in five sessions (18, 24, 26, 28 and 30 Sep) and stands at its Review step. Its calibration policy is the default, with automatic assignment on.
- P2: The calibration fixture in `Astro-T7/Calibration`, indexed in J19:
  - Darks match camera, dimensions, binning, gain, offset, image type, 300 s exposure and recorded temperature exactly.
  - Raw Ha flats have Ha channel and RedCat optical-train evidence.
  - Raw OIII flats taken 30 Sep have OIII channel and RedCat optical-train evidence.
  - For 24 Sep, the 30 Sep OIII flats match every D13 flat criterion and are the top-ranked compatible match. The 26 Sep OIII flats lack optical-train evidence.
- P3: The same location also holds darks from a second camera and flats taken on a second optical train, both indexed in J19 and neither part of rig RedCat.
- P4: Siril is installed at a known path and not yet configured in PlateVault.
- P5: The J19/P5 manifest is available.

## Steps

### S1 — Reach Calibrate {#S1}

- **Do:** In `NGC7000-HOO-Siril`, move from Review to the Calibrate step.
- **Expect:** Without any user action, the readiness line reads `Calibration ready · 5 of 5 groups matched`. The light groups are formed by camera, settings, channel and relevant geometry.
- **Expect (negative):** No match with an unknown or incompatible criterion is assigned automatically. PlateVault writes no file.
- **Trace:** flow E1 · CAL-FR-02, CAL-FR-09 · CAL-AC-01 · D-W5

### S2 — Open Review matches {#S2}

- **Do:** Click **Review matches**.
- **Expect:** One row per light group and calibration type (dark, flat). Each row shows its assigned input, the state Automatic, and **Why this match**. The table groups by settings, channel and geometry, not by camera.
- **Expect (negative):** The P3 darks are not listed as candidates. The P3 flats are listed only as incompatible on optical train and are never assigned.
- **Trace:** flow E1 · CAL-FR-01, CAL-FR-09, CAL-FR-10 · CAL-AC-14 · D-W37

### S3 — Ask why a match was assigned {#S3}

- **Do:** Open **Why this match** for the automatic Ha flat assignment.
- **Expect:** Compatible, incompatible and unknown criteria are listed separately, covering camera, dimensions, binning, gain/offset, image type, channel and optical-train evidence.
- **Expect (negative):** No temperature tolerance is applied unless it is shown.
- **Trace:** flow E1 · CAL-FR-03 · D13

### S4 — Hand raw flats to the application {#S4}

- **Do:** Inspect the automatic Ha flat assignment.
- **Expect:** It reads as a raw calibration set that goes to the external application, which builds its own masters.
- **Expect (negative):** PlateVault writes no master file.
- **Trace:** flow E1 · CAL-FR-04 · root FR-015

### S5 — Replace 24 Sep's flat with the 26 Sep set {#S5}

- **Do:** In Review matches, open **Why this match** for 24 Sep's automatic 30 Sep OIII flats and for the 26 Sep OIII flats. Choose the 26 Sep set instead, then click **Review preparation**.
- **Expect:**
  - The 30 Sep set lists every criterion as compatible. The 26 Sep set lists its optical-train state as unknown.
  - 24 Sep's row reads Needs review, and the readiness line reads `4 of 5 groups matched · 1 needs review`.
  - Preparation review lists 24 Sep's flat as unresolved. The offered choices are: another input (the 30 Sep set), exclude the session, defer, or record a scoped exception with a reason.
- **Expect (negative):** The 26 Sep set is not shown as compatible, and the unresolved flat is not counted as a handoff input. The 30 Sep set is not reassigned automatically while the user's replacement stands.
- **Trace:** flow E2 · CAL-FR-03, CAL-FR-05, CAL-FR-08, CAL-FR-09 · CAL-AC-02, CAL-AC-06 · D-W5

### S6 — Record a scoped exception {#S6}

- **Do:** Record an exception for 24 Sep using the 26 Sep flats, with reason `Same rotation as 26 Sep; train not changed`.
- **Expect:** 24 Sep's row reads Excepted, showing the unknown criterion and the reason. The readiness line counts 4 groups matched, 1 excepted and 0 needing review. The 30 Sep set stays listed as an unassigned compatible alternative.
- **Expect (negative):** The 26 Sep flat set's own evidence still reads optical-train unknown. The exception does not make the set compatible anywhere else.
- **Trace:** flow E2 · CAL-FR-05, CAL-FR-09 · CAL-AC-03 · D-W5

### S7 — Confirm the exception is run-scoped {#S7}

- **Do:** In Project `NGC 7000 HOO`, start a processing run `24 Sep flat check` on subject NGC 7000 and rig RedCat. The session picker starts with every candidate selected; leave only 24 Sep selected, save the run, and move to Calibrate.
- **Expect:** The readiness line reads every group matched. The 24 Sep flat row reads Automatic with the 30 Sep OIII flats. Review matches lists the 26 Sep flats with optical-train state unknown and no exception attached.
- **Expect (negative):** The S6 exception does not appear in this run.
- **Trace:** flow E2 · VSEL-FR-03 · CAL-FR-02, CAL-FR-05 · CAL-AC-01, CAL-AC-03 · D-W49, D-W50

### S7a — Turn automatic assignment off {#S7a}

- **Do:** In `24 Sep flat check`, turn the calibration policy's automatic assignment off. Read Review matches, then accept the 30 Sep flat suggestion.
- **Expect:** With the policy off, every compatible match reads Suggested and none is assigned, and the readiness line counts them as needing review. After acceptance the flat row reads Accepted, distinct from Automatic and Suggested, and **Why this match** remains available.
- **Expect (negative):** No suggestion is treated as a handoff input before it is accepted.
- **Trace:** flow E1 · CAL-FR-02, CAL-FR-08, CAL-FR-09 · CAL-AC-11 · D-W5, D-W55

### S8 — Choose the Siril profile {#S8}

- **Do:** In `NGC7000-HOO-Siril`, choose application Siril and locate its executable.
- **Expect:** The profile shows its installed or documented capability evidence: supported input, layout, configuration, product-input kinds and input-write behavior. Unsupported configuration is named.
- **Expect (negative):** No capability is claimed as verified without that evidence. The profile does not claim that renaming files overrides headers. Siril is not launched.
- **Trace:** flow E3 · PREP-FR-01 · D04 · G2

### S9 — See the generic alternative {#S9}

- **Do:** In `24 Sep flat check`, choose **Open in...**.
- **Expect:** It asks for an executable and launch arguments, and reads as not a verified preparation profile. Its input-write behavior is unknown, so Linked View and Direct source read blocked, and isolated Copy or supported Clone is offered.
- **Trace:** flow E3 alternative · PREP-FR-02, PREP-FR-04 · PREP-AC-11 · D04

### S10 — See a corrected value {#S10}

- **Do:** In `NGC7000-HOO-Siril`, open **Review preparation** and open the 28 Sep entry.
- **Expect:** The review shows the catalog's effective focal length from the confirmed equipment (J19/S10) next to the value Siril will read from the header (absent). The options are: supported application configuration, isolated patched copies or clones, accept the source-header value, or exclude the inputs.
- **Trace:** flow E4 · PREP-FR-03 · D15

### S11 — Accept the source value for this handoff {#S11}

- **Do:** Choose **accept the source-header value** for 28 Sep.
- **Expect:** The review names the header value as the effective handoff value, with materialization mode not patched.
- **Expect (negative):** The correction is not claimed as delivered. No original is patched, and the manifest still equals P5.
- **Trace:** flow E4 · PREP-FR-03 · PREP-AC-06 · D15

## Success criteria

- SC1: At S1 all 5 light groups read Automatic with 0 user actions. No assignment with an unknown or incompatible criterion is ever Automatic (S1, S5).
- SC2: 24 Sep reads Needs review from the S5 replacement until S6. Its exception record shows both the unknown criterion and the reason, and the 30 Sep set is reassigned 0 times without the user's choice.
- SC3: The 26 Sep flat evidence is unchanged, and `24 Sep flat check` shows it unknown with no exception (S7).
- SC4: With automatic assignment off, 0 matches are assigned until one is accepted (S7a).
- SC5: The P3 inputs are assigned 0 times (S2).
- SC6: PlateVault creates 0 calibration files, and the manifest equals P5 at S11.
- SC7: The Siril profile shows its capability evidence (S8). **Open in...** reads unverified, with Linked View and Direct source blocked (S9).
- SC8: For 28 Sep the review names the header value as effective and claims no delivered correction (S11).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs, the decisions D04, D13, D15 and D19 set by the authorized autonomous run, and the user's workflow decisions D-W3 to D-W55 cited above. No implementation has been validated against them.
- G2: Unresolved implementation qualification: Siril profile capability probes (D04) must exist before S8 can show verified evidence. The PixInsight/WBPP and SETI Astro Suite Pro profiles are not exercised in this journey. Blocks readiness.
- G3: Out of scope for this journey: per-panel calibration in a mosaic run group (CAL-FR-11, CAL-AC-13) is not exercised here. Blocks readiness until covered by a step or a journey.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S4, S5, S6, S7, +S7a, S9 · behavior-change
  Calibration is automatic: compatible matches are assigned on reaching Calibrate, a readiness line reports them, and Review matches holds the table. The standalone View is now run `24 Sep flat check` in the Project. Matching is limited to the run's rig.
  Evidence: specs/068-calibration-inputs CAL-FR-02, CAL-FR-09, CAL-FR-10, CAL-AC-01, CAL-AC-11, CAL-AC-14; D-W5, D-W37, D-W55 · by: JourneysC (intent-gated)
