---
id: J23
title: Calibrate a processing run automatically, resolve an exception and choose an application profile
version: 3
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [calibration, view-review, preparation, projects, applications]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 068-calibration-inputs, 069-application-handoff, D04, D13, D15, D19, D-W3, D-W5, D-W37, D-W49, D-W50, D-W55, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/068-calibration-inputs/spec.md, specs/069-application-handoff/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-e-choose-calibration-and-application-preparation, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#S14, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2b-foundation-status-bar-and-p-cal3-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions-user-2026-10-09, HARNESS-V5-FEEDBACK-R1.md#round-5-user-2026-10-10, P-CAL3, apps/prototype/src/features/v5/c-runs/calibrate-step.tsx, apps/prototype/src/features/v5/c-runs/prepare-step.tsx, apps/prototype/src/domain/calibration.ts, apps/prototype/messages/en-GB.json, J36]
---

## Goal

When the reviewed processing run reaches Calibrate, PlateVault assigns every
fully compatible master from the Calibration library without user action.
Runs are assigned masters only. The readiness line reports the result per
calibration kind, and Matches explains each assignment. The user defers one
automatic flat, then uses a master whose optical-train evidence is unknown
under a scoped exception with a reason. The user checks which runs use each
master, picks a maintained application profile, and decides how a catalog
correction reaches the application. Done means:
- Every requirement (one light session and one calibration kind) is Automatic, Accepted or Exception with its reason.
- Every calibration input is a registered master, and no raw calibration frame is an input.
- The Siril profile is chosen and its capability evidence is shown.
- The review names the effective value Siril will read for the corrected session.
- No calibration or source file is created or changed.

## Preconditions

- P1: J22 completed, on a library where J36 ran right after J19 (J20 to J22 read no calibration). Run `NGC7000-HOO-Siril` in Project `NGC 7000 HOO` (subject NGC 7000, rig RedCat) has a saved membership of 208 lights / 17h 20m in five sessions (18, 24, 26, 28 and 30 Sep) and stands at its Review step. Its calibration policy is the default, with **Auto-assign** on.
- P2: The calibration fixture: the raw sets of J36/P2, which J19 indexed in `Astro-T7/Calibration` and J36 stacked into masters. The Calibration library holds these masters in their structured storage folders:
  - `MasterDark_2026-09-20.xisf` and `MasterBias_2026-09-20.xisf`: camera, dimensions, binning, gain and offset match the J19/P2 RedCat lights, and the dark matches their 300 s exposure.
  - `MasterFlat_2026-09-18.xisf`: Ha, with RedCat optical-train evidence.
  - `MasterFlat_2026-09-30.xisf`: OIII, with RedCat optical-train evidence. For 24 Sep it matches every flat criterion and is the top-ranked compatible master.
  - `MasterFlat_2026-09-26.xisf`: OIII, imported in J36/S9 with no optical-train evidence.

  The 50 raw bias frames that J36/S8 kept stay indexed in `Astro-T7/Calibration/Raw/Bias/2026-09-20/`.
- P3: The library also holds the two other masters J36/S9 imported: a master dark from a second camera (ZWO ASI294MM Pro) and an OIII master flat from a second optical train (Esprit 100). Neither is part of rig RedCat.
- P4: Siril is installed at a known path and not yet configured in PlateVault.
- P5: The J19/P5 manifest is available.

## Steps

### S1 — Reach Calibrate {#S1}

- **Do:** In `NGC7000-HOO-Siril`, move from Review to the Calibrate step.
- **Expect:** Without any user action, the readiness line reads Dark ✓, Flat ✓ and Bias ✓, with nothing to review and **Auto-assign** on. Each requirement is assigned a master automatically: one per light session and calibration kind, 15 in all (5 sessions × dark, flat and bias). The light sessions are grouped by channel, rig, dimensions, binning and gain/offset.
- **Expect (negative):** No master with an unknown or incompatible criterion is assigned automatically. PlateVault writes no file.
- **Trace:** flow E1 · CAL-FR-02, CAL-FR-09 · CAL-AC-01 · D-W5 · HARNESS-V5-IA.md §Screens S5 (Calibrate: readiness line, automatic policy)

### S2 — Open Matches {#S2}

- **Do:** Open **Matches** with **Show**.
- **Expect:** Matches lists one row per light session and calibration kind, 15 rows in two groups (Ha and OIII). Each row shows its light session, its state `Automatic`, the assigned master's file name with its SHA-256, and its criteria. The rig and camera that every group shares appear once in the table title, not as a grouping level.
- **Expect (negative):** The P3 master dark from the second camera is not listed as a candidate. The P3 Esprit master flat is listed only as incompatible on its rig (optical train) and is never assigned.
- **Trace:** flow E1 · CAL-FR-01, CAL-FR-09, CAL-FR-10 · CAL-AC-14 · D-W37 · HARNESS-V5-IA.md §Screens S5 (Review matches)

### S3 — Ask why a master was assigned {#S3}

- **Do:** Open the criteria of the automatic Ha flat assignment for 18 Sep.
- **Expect:** The criteria read `All 8 criteria compatible`. They list camera, dimensions, binning, gain, offset, image type, channel and rig (optical train), each with the light's value, the master's value and Compatible, Incompatible or Unknown. They stay available after assignment.
- **Expect (negative):** No temperature tolerance is applied unless it is shown.
- **Trace:** flow E1 · CAL-FR-03 · D13

### S4a — See that every input is a master {#S4a}

- **Do:** In Matches, read every row's master, and open the row menu of the 18 Sep bias row.
- **Expect:** Every assigned input is a master file from the Calibration library, shown with its SHA-256: `MasterDark_2026-09-20.xisf`, `MasterBias_2026-09-20.xisf`, `MasterFlat_2026-09-18.xisf` or `MasterFlat_2026-09-30.xisf`. The row menu offers masters only, as `Use MasterBias_2026-09-20.xisf`. A master with an unknown or incompatible criterion is offered only as `Use <file name> as exception…`.
- **Expect (negative):** The 50 raw bias frames kept in J36/S8 are not listed as an input or a candidate anywhere in the run, and no raw calibration session can be chosen as an input. PlateVault writes no master file.
- **Trace:** flow E1 · CAL-FR-02, CAL-FR-08 · HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3 (runs are assigned masters only) · HARNESS-V5-IA.md §Round 2b foundation (P-CAL3: masters only)

### S5 — Defer 24 Sep's flat {#S5}

- **Do:** In Matches, open the criteria of 24 Sep's automatic flat `MasterFlat_2026-09-30.xisf` and of `MasterFlat_2026-09-26.xisf`. From 24 Sep's flat row menu, choose `Use MasterFlat_2026-09-26.xisf as exception…` and cancel the dialog. Then choose **Defer** and open the Prepare step.
- **Expect:**
  - The 30 Sep master reads `All 8 criteria compatible`. The 26 Sep master lists its rig (optical train) as Unknown.
  - Cancelling the dialog leaves the row Automatic with the 30 Sep master.
  - After Defer the row reads Deferred with no master. The readiness line reads Flat 4/5 and `1 to review`.
  - Prepare's calibration check reads `1 requirement to review` and blocks preparation.
  - The row menu offers `Use MasterFlat_2026-09-30.xisf`, the 26 Sep master as an exception, `Process without flat…` and **Use automatic**.
- **Expect (negative):** The 26 Sep master is not shown as compatible, and the deferred flat is not counted as a handoff input. The 30 Sep master is not reassigned automatically while the deferral stands. Cancelling the dialog records nothing.
- **Trace:** flow E2 · CAL-FR-03, CAL-FR-05, CAL-FR-08, CAL-FR-09 · CAL-AC-02, CAL-AC-06 · D-W5

### S6 — Record a scoped exception {#S6}

- **Do:** From 24 Sep's flat row menu, choose `Use MasterFlat_2026-09-26.xisf as exception…`. Enter the reason `Same rotation as 26 Sep; train not changed` and click **Record exception**.
- **Expect:**
  - The dialog reads `this run only`.
  - 24 Sep's flat row reads Exception with the 26 Sep master. Its criteria read `Rig unknown`, and its note reads `Exception · Same rotation as 26 Sep; train not changed`.
  - The readiness line reads Dark ✓, Flat 5/5 and Bias ✓, with nothing to review. Prepare's calibration check passes with `5 masters`.
  - The row menu still offers `Use MasterFlat_2026-09-30.xisf` as a compatible alternative.
- **Expect (negative):** In the Calibration library, the 26 Sep master's own evidence still reads optical train unknown. The exception makes it compatible nowhere else.
- **Trace:** flow E2 · CAL-FR-05, CAL-FR-09 · CAL-AC-03 · D-W5

### S7 — Confirm the exception is run-scoped {#S7}

- **Do:** In Project `NGC 7000 HOO`, start a processing run `24 Sep flat check` on subject NGC 7000 and rig RedCat (G5). The session picker starts with every candidate selected. Leave only 24 Sep selected, save the run, and move to Calibrate.
- **Expect:** The readiness line reads Dark ✓, Flat ✓ and Bias ✓. The 24 Sep flat row reads Automatic with `MasterFlat_2026-09-30.xisf`. Its row menu offers the 26 Sep master only as `Use MasterFlat_2026-09-26.xisf as exception…`, with its rig unknown and no exception attached.
- **Expect (negative):** The S6 exception does not appear in this run.
- **Trace:** flow E2 · VSEL-FR-03 · CAL-FR-02, CAL-FR-05 · CAL-AC-01, CAL-AC-03 · D-W49, D-W50

### S7a — Turn automatic assignment off {#S7a}

- **Do:** In `24 Sep flat check`, turn **Auto-assign** off. Read Matches, then accept the suggested `MasterFlat_2026-09-30.xisf` for 24 Sep's flat.
- **Expect:** With **Auto-assign** off, every compatible master reads Suggested, none is assigned, and the readiness line counts them to review. After acceptance the flat row reads Accepted, distinct from Automatic and Suggested, and its criteria stay available.
- **Expect (negative):** No suggestion is treated as a handoff input before it is accepted.
- **Trace:** flow E1 · CAL-FR-02, CAL-FR-08, CAL-FR-09 · CAL-AC-11 · D-W5, D-W55 · G4

### S7b — See which runs use each master {#S7b}

- **Do:** In `24 Sep flat check`, turn **Auto-assign** back on. Open the Calibration library. Open the details of `MasterFlat_2026-09-30.xisf` and its Used by, then those of `MasterFlat_2026-09-26.xisf` and of the two P3 masters.
- **Expect:**
  - `MasterFlat_2026-09-30.xisf` reads `Used by 2 runs`. Its popover lists `NGC7000-HOO-Siril` and `24 Sep flat check`, each with its Project, and each entry opens that run's Calibrate step.
  - `MasterFlat_2026-09-26.xisf` reads `Used by 1 run`, which is `NGC7000-HOO-Siril`.
  - The two P3 masters name no run.
- **Expect (negative):** Opening Used by does not expand the master row, and reading it changes no assignment.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 Calibration (master details; Used by is a popover) · HARNESS-V5-IA.md §Screens S14 · CAL-FR-08

### S8 — Choose the Siril profile {#S8}

- **Do:** In the Prepare step of `NGC7000-HOO-Siril`, choose **Siril** under Application. Its executable state reads not found, so locate the executable in Settings › Applications (J41) and return.
- **Expect:** The Siril card shows `Verified` or `Not verified` and its input-write behavior: `Read-only`, `Write-prone` or `Writes unknown`. Behind its ① it shows the installed or documented capability evidence: supported input, layout, configuration and product-input kinds. Unsupported configuration is named.
- **Expect (negative):** No capability is claimed as verified without that evidence. The profile does not claim that renaming files overrides headers. Siril is not launched.
- **Trace:** flow E3 · PREP-FR-01 · D04 · G2 · HARNESS-V5-IA.md §Screens S5 (Prepare: profile) and S16 (Applications)

### S9 — See the generic alternative {#S9}

- **Do:** In the Prepare step of `24 Sep flat check`, choose **Other app** under Application.
- **Expect:** It reads `Not verified` and `Writes unknown`, and its executable and launch arguments are set in Settings › Applications (J41). Because its input-write behavior is unknown, `Linked run` and `Direct source` read blocked with their blockers named, and isolated `Copy` or supported `Clone` is offered.
- **Trace:** flow E3 alternative · PREP-FR-02, PREP-FR-04 · PREP-AC-11 · D04 · HARNESS-V5-IA.md §Screens S5 (Prepare: mode)

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

- SC1: At S1 all 15 requirements read Automatic with 0 user actions. No assignment with an unknown or incompatible criterion is ever Automatic (S1, S5).
- SC2: 24 Sep's flat reads Deferred from S5 until S6. Its exception record shows both the unknown criterion and the reason. The 30 Sep master is reassigned 0 times without the user's choice.
- SC3: The 26 Sep master's evidence is unchanged, and `24 Sep flat check` shows it with its rig unknown and no exception (S7).
- SC4: With **Auto-assign** off, 0 masters are assigned until one is accepted (S7a).
- SC5: The P3 masters are assigned 0 times (S2), and they are used by 0 runs (S7b).
- SC6: 100% of calibration inputs are masters, and the kept raw bias frames are listed as an input or candidate 0 times (S4a).
- SC7: `MasterFlat_2026-09-30.xisf` is used by exactly 2 runs and `MasterFlat_2026-09-26.xisf` by exactly 1 (S7b).
- SC8: PlateVault creates 0 calibration files, and the manifest equals P5 at S11.
- SC9: The Siril profile shows its capability evidence (S8). **Other app** reads Not verified, with `Linked run` and `Direct source` blocked (S9).
- SC10: For 28 Sep the review names the header value as effective and claims no delivered correction (S11).

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design, which the user instructed on 2026-10-10 that journeys describe: `HARNESS-V5-IA.md` §Screens S5, S14 and S16 and §Round 2b foundation, and `HARNESS-V5-FEEDBACK-R1.md` §Round 1b P-CAL3 and §Round 5 (apps/prototype/design/ on ui-harness-v5 @ b5e813a5). It also follows the specs, the decisions D04, D13, D15 and D19 set by the authorized autonomous run, and the workflow decisions D-W3 to D-W55 cited above. No implementation has been validated against them.
- G2: Unresolved implementation qualification: Siril profile capability probes (D04) must exist before S8 can show verified evidence. The PixInsight/WBPP and SETI Astro Suite Pro profiles are not exercised in this journey. Blocks readiness.
- G3: Out of scope for this journey: per-panel calibration in a mosaic run group (CAL-FR-11, CAL-AC-13) is covered by J33/S7.
- G4: Unresolved product question: what **Auto-assign** off does. CAL-FR-02 and CAL-AC-11 keep every compatible match as a Suggested input until it is accepted, which S7a asserts. The v5 prototype (`calibrationPlan` in `src/domain/calibration.ts`, `calibrate-step.tsx`) instead hands off no calibration when the policy is off: the readiness line reads `Off`, Matches is hidden and Prepare's calibration check passes. Blocks readiness.
- G5: Unresolved product question (raised once by the lead for every journey): S7 creates the run `24 Sep flat check`, but v5 names a new run `<subject> <rig>` (`NGC 7000 RedCat`) and offers no Rename. The fixture name is kept until that is decided. Blocks readiness.
- G6: Out of scope for this journey: when no master matches a requirement and a raw session that would stack into one awaits Stack, the row offers `Stack from <session>`, which opens that calibration process at `/calibration?process=` (P-CAL3; prototype `stackOffers`). No J36 fixture leaves a requirement without a master. Blocks readiness until covered by a step or a journey.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S5, S6, S7, +S7a, S9 · behavior-change
  Calibration is automatic: compatible matches are assigned on reaching Calibrate, a readiness line reports them, and Review matches holds the table. The standalone View is now run `24 Sep flat check` in the Project. Matching is limited to the run's rig.
  Evidence: specs/068-calibration-inputs CAL-FR-02, CAL-FR-09, CAL-FR-10, CAL-AC-01, CAL-AC-11, CAL-AC-14; D-W5, D-W37, D-W55 · by: JourneysC (intent-gated)
- **Δ3** 2026-10-10 · S1, S2, S3, +S4a, S5, S6, S7, S7a, +S7b, S8, S9 · behavior-change
  Runs are assigned masters only: the fixture is J36's masters, raw flats are no longer handed to the application (retired old step 4), and Matches offers masters only. Readiness reads per kind (Dark, Flat, Bias); the user defers a flat, then uses the unknown-train master as an exception from the row menu.
  A master's Used by lists the runs that use it. Profiles are picked in Prepare (**Other app**, `Linked run`), and executables are set in Settings › Applications.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3, §Round 5 Calibration; HARNESS-V5-IA.md §Screens S5, S14, S16, §Round 2b foundation (P-CAL3: masters only); prototype src/features/v5/c-runs/calibrate-step.tsx, prepare-step.tsx, messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-10 · by: JourneysV5.U4Calibration (intent-gated)
