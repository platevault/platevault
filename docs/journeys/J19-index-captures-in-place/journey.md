---
id: J19
title: Index capture folders in place and inspect sessions on first use
version: 4
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [onboarding, locations, indexing, home, sessions, targets, planning, status-bar, issues, calibration-process, duplicates, equipment]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 072-observing-plans, D01, D08, D11, D15, D18, D-W7, D-W12, D-W17, D-W33, D-W35, D-W37, D-W39, D-W43, specs/063-clean-rebuild-contract/spec.md, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/072-observing-plans/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-a-first-use-and-indexing, HARNESS-V5-IA.md#source-list, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S10, HARNESS-V5-IA.md#S11, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#S14, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HIGH-LEVEL-DESIGN.md#glossary, P-SB3, P-STO2, P-PLAN2, P-CAL3, apps/prototype/src/features/t1/setup/setup-pages.tsx, apps/prototype/src/features/t1/settings/locations-page.tsx, apps/prototype/src/features/v5/e-targets-plan-settings/settings-equipment.tsx @4f470775, apps/prototype/src/domain/indexing.ts @4f470775, apps/prototype/messages/en-GB.json @4f470775]
---

## Goal

The user registers folders that already hold captures and calibration frames,
indexes them where they are, inspects sessions and the evidence behind each
Target and rig association, and names and completes the rigs that indexing
detected. No Project, processing application, account, network connection,
workspace root, or file reorganization is required. After onboarding the app
opens on Home, the control-panel dashboard. Done means:

- Sessions lists the seven fixture light sessions as separate metadata-homogeneous sessions.
- A session whose pointing lies within a Target's footprint reads that Target as Associated. A session without such pointing reads Needs a Target instead of a guess, and the Needs a Target filter lists it. OBJECT shows only as a label.
- Raw calibration frames wait as calibration processes awaiting Stack, and no light session holds them.
- Indexing detects one rig per camera and telescope pair. The user renames them `RedCat` and `Esprit` and adds their missing pixel size in Settings › Equipment, so each has a field of view.
- An unreadable or offline location reads as uncertain rather than Missing, in the status bar and in Settings › Locations.
- Every file in the registered folders is byte-identical to the pre-run manifest.

## Preconditions

- P1: A clean development build of the rebuilt PlateVault (D17) with no catalog, no saved observing site and no network connection. First launch shows onboarding.
- P2: Volume `Astro-T7` holds `Captures/` with one subfolder per session. The five dated sessions use mono 300 s lights from rig `RedCat` (RedCat 51 + ASI2600MM) at one gain, offset, temperature and 1x1 binning, captured at the Backyard coordinates. The `other camera` session holds 300 s lights from rig `Esprit` (Esprit 100 + ASI533MC). A plain-text note is an unsupported item. The 30 Sep session also carries the frame-review properties of J22/P2. Every pointing in the table lies within NGC 7000's footprint. RedCat lights (here and in P3) carry INSTRUME `ZWO ASI2600MM Pro`, TELESCOP `RedCat 51` and FOCALLEN `250` at 6248 × 4176 pixels, except that 28 Sep lacks TELESCOP and FOCALLEN. Other-camera lights carry INSTRUME `ZWO ASI533MC Pro`, TELESCOP `Esprit 100`, FOCALLEN `550` and a Bayer pattern at 3008 × 3008 pixels. No light carries a pixel size (XPIXSZ); both cameras have 3.76 µm pixels (J15/P2).

  | Session | Channel | Lights | OBJECT | Pointing | Orientation | Optics keywords |
  | --- | --- | --- | --- | --- | --- | --- |
  | 18 Sep | Ha | 55 | NGC 7000 | yes | no | yes |
  | 24 Sep | OIII | 20 | absent | absent | absent | yes |
  | 26 Sep | OIII | 35 | `Cygnus field` | yes, overlapping NGC 7000 | yes | yes |
  | 28 Sep | Ha | 56 | NGC 7000 | yes | yes | telescope and focal length absent |
  | 30 Sep | OIII | 48 | NGC 7000 | yes | yes | yes |
  | other camera | Ha | 40 | NGC 7000 | yes, overlapping | yes | Esprit 100 and ASI533MC |

- P3: Volume `Cold-1` is mounted and holds `Captures/` with a 12 Sep session of 24 OIII 300 s RedCat lights (OBJECT, pointing and orientation present, the pointing within NGC 7000's footprint). It was captured at the coordinates of `Remote site`, the second saved site of J15/S7 and J20/P2.
- P4: `Astro-T7/Calibration/` holds the raw calibration fixture of J36/P2 (the raw sets that J23/P2 uses once J36 has stacked them into masters).
- P5: A manifest (relative path, size, SHA-256) of every file under the three folders, recorded outside PlateVault before S1. No two of these files are byte-identical.
- P6: A catalog-write fault fixture that makes the next catalog write fail on demand (G3).

## Steps

### S1 — Read the Welcome and Locations steps {#S1}

- **Do:** Launch PlateVault. On Welcome, click **Set up locations**, then read the Locations step without adding anything.
- **Expect:** Onboarding shows three steps, Welcome, Locations and Index, and opens on Welcome. Welcome lists what PlateVault does and what it never does, including `Needs an account or a network connection`. On Locations, Captures is marked Required. Calibration and Results are marked Optional, and each offers **Set up later**. **Continue** is unavailable and names Captures as the missing role: `Add a capture location to continue. Captures is the only required role.`
- **Expect (negative):** No step asks for a processing application, a Project, a processing-run folder, a workspace root, or an account.
- **Trace:** flow A1 · LIB-FR-01 · root FR-001, FR-015 · D18 · HARNESS-V5-IA.md §Screens (onboarding kept at its v4 path, `src/features/t1/setup/setup-pages.tsx`)

### S2 — Add the first capture location {#S2}

- **Do:** Click **Add capture location**, choose `Astro-T7/Captures` in the native folder picker, and enter the display name `Astro-T7 captures`.
- **Expect:** A row shows `Astro-T7 captures` with its path and role Captures. The row also shows its volume kind, its access state, and Online.
- **Expect (negative):** No indexing progress appears before S5. No file under the folder is created, renamed, moved, or deleted (P5 still matches).
- **Trace:** flow A1 · LIB-FR-01, LIB-FR-02 · D-W12

### S3 — Add another folder for the same role {#S3}

- **Do:** Click **Add another location**, choose `Cold-1/Captures` with role Captures, and enter the display name `Cold-1 captures`.
- **Expect:** A second Captures row, `Cold-1 captures`, appears with its own path and Online state. The first row is unchanged.
- **Trace:** flow A1 · LIB-FR-01

### S4 — Configure the optional roles {#S4}

- **Do:** Click **Add calibration location**, choose `Astro-T7/Calibration` and enter the display name `Astro-T7 calibration`. Leave Results unset and continue.
- **Expect:** Onboarding continues to its Index step. Results reads as not set.
- **Expect (negative):** The unset Results role is not shown as an error, warning, or failed setup.
- **Trace:** flow A2 · LIB-FR-01 · LIB-AC-01

### S5 — Start indexing with one denied location {#S5}

- **Do:** Outside PlateVault, remove read permission from `Astro-T7/Calibration`. Click **Start indexing**.
- **Expect:** Progress shows these counts:
  - files discovered and metadata read;
  - unsupported items, at least the P2 note file;
  - unreadable items and completed scope.

  The Calibration row names the access failure and offers **Choose folder again** and **Retry**. Both Captures locations keep indexing.
- **Expect (negative):** The denied folder is not reported as empty, and none of its files is labelled Missing.
- **Trace:** flow A3, A4 · LIB-FR-03, LIB-FR-06, LIB-FR-07 · LIB-AC-07

### S6 — Browse while indexing runs {#S6}

- **Do:** Before indexing finishes, click **Open library**. The orientation walk opens on its own after setup (J18/S1); skip or finish it (J18/S2, S3). Read Home, the source list and the status bar, then open Sessions.
- **Expect:** Home opens, not the Targets list. Its header offers **Plan tonight**, **New Project** and **Import**. Its boxes are Projects, which reads `No Projects`, Sessions, Tonight, Goals and Work. Home shows the Getting started checklist (J18/S6). Work lists the indexing operation with its progress. The source list offers Home, Projects, Targets, Sessions and Calibration, with Activity and Settings in its footer, and the toolbar offers Import. The status bar shows the indexing operation as running work with a mini progress bar. Its ⛔ errors counter opens a popout that lists `Astro-T7 calibration unreadable`, with its action leading to Settings › Locations. In Sessions, the sessions read so far can be inspected. Totals name the locations they cover and read Provisional.
- **Expect (negative):** Home shows no issues strip or top line. The source list has no Storage or Plan entry. No total implies that unscanned folders or data outside the registered locations are included. No screen asks for an account or a network connection.
- **Trace:** flow A4 · LIB-FR-03, LIB-FR-10 · LIB-AC-07, LIB-AC-09 · PRJ-FR-17 · D-W7, D-W39 · HARNESS-V5-IA.md §Source list, §Screens S1, §Round 2b (Status bar) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3, Home has no issues strip, Navigation, P-STO2, P-PLAN2), §Round 6 "Onboarding: walk plus checklist" · J18/G4 (the page setup hands over to) · G5

### S6a — Read planning before any site exists {#S6a}

- **Do:** On Home, read Tonight. Open Targets and search for `NGC 7000`.
- **Expect:** Tonight reads `No site` and offers **Add site**, which leads to Settings › Observing sites. Targets opens on My targets, with tonight in its header date picker and a toggle to Browse catalogues. My targets holds no Target, the altitude column draws no sparkline and the page offers **Add site**. The search lists NGC 7000 from the bundled catalogues with its source. The row's primary action, on a click, is Add to targets, and the row shows no separate Add button. The results read `SIMBAD off` or `SIMBAD unreachable`, never `SIMBAD searched`.
- **Expect (negative):** No window, altitude or Img time is computed for an assumed location. Searching writes nothing: this step clicks no result row, and My targets stays empty.
- **Trace:** PLAN-FR-11 · PLAN-AC-12 · PLAN-TGT-FR-01, PLAN-TGT-FR-03 · PLAN-TGT-AC-04, PLAN-TGT-AC-15 · D-W17, D-W39 · HARNESS-V5-IA.md §Screens S1 (Tonight), S10, S11 · HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-PLAN2, Click a result to act), §Round 6 "Targets opens on My targets", "Clicking a result" · G10

### S7 — Recover the denied location {#S7}

- **Do:** Restore read permission on `Astro-T7/Calibration` and click **Retry** on its row.
- **Expect:** The row clears its failure and the calibration frames are indexed. The status bar's ⛔ errors counter disappears.
- **Expect (negative):** Retrying one location does not reset or re-create sessions already read from the Captures locations.
- **Trace:** flow A4 · LIB-FR-07

### S7a — Find the raw calibration frames {#S7a}

- **Do:** After indexing completes, open the Calibration library, then Sessions. Open the status bar's ℹ info counter.
- **Expect:** The Calibration library lists one calibration process for each raw calibration session in P4. Each reads `Calibration → stack`, with the steps Stack, Detect, Import, Register and Raws, and Stack reads To do. The ℹ popout lists `<n> to stack`, where n is the number of those processes, and its action leads to the Calibration library. Sessions lists no calibration session.
- **Expect (negative):** No process starts Stack by itself. No tool is launched, and no master or stacking folder is written. No raw frame goes to the OS Trash (P5 still matches). No master made from P4's raw frames is listed.
- **Trace:** CAL · HARNESS-V5-IA.md §Screens S12, S14, §Round 2b (P-CAL3: Routing, Issues `calibration-waiting`) · HARNESS-V5-FEEDBACK-R1.md §Round 1b (P-CAL3)

### S8 — Inspect the resulting sessions {#S8}

- **Do:** After indexing completes, review Sessions. Toggle display grouping by night on and off. Open Activity.
- **Expect:** Sessions lists exactly seven light sessions: the six P2 sessions and the 12 Sep Cold-1 session. Each shows its channel, exposure, frame count and location. Calibration frames do not appear as light sessions. Grouping by night changes the display only. Session boundaries and counts are identical with grouping on and off. Activity records a duplicate scan that started by itself after indexing and finished.
- **Expect (negative):** No session mixes Ha and OIII frames. No frame reads Usable, and every frame reads Unreviewed. The duplicate scan raises no duplicate-copies issue, because no two P5 files are byte-identical.
- **Trace:** flow A3, A4 · LIB-FR-04, LIB-FR-09 · LIB-AC-03 · HARNESS-V5-FEEDBACK-R1.md §Round 5 (Duplicates are scanned automatically)

### S9 — Review association evidence {#S9}

- **Do:** Open the session detail of 30 Sep, 24 Sep, 26 Sep and 28 Sep.
- **Expect:** Each detail shows its Target evidence and its rig evidence, with observed and confirmed evidence shown separately. It shows OBJECT only as a label beside the frame count, such as `OBJECT NGC 7000` or `No OBJECT`.
  - 30 Sep reads Target NGC 7000 Associated from its pointing evidence. Its rig evidence lists INSTRUME `ZWO ASI2600MM Pro`, TELESCOP `RedCat 51` and FOCALLEN `250 mm`, and names the rig detected from them, marked `(detected)`.
  - 24 Sep has no Target: its Target box reads `Unsettled`, and its pointing evidence reads `No pointing in header`.
  - 26 Sep reads Target NGC 7000 Associated from its pointing. Its label reads `OBJECT Cygnus field`.
  - 28 Sep reads Target NGC 7000 Associated from its pointing, and its rig evidence reads Needs review.
- **Expect (negative):** No evidence list names OBJECT as Target evidence. No OBJECT label agrees with, conflicts with, preselects or settles a Target. 24 Sep is not assigned a guessed Target. No `Cygnus field` Target exists, and no OBJECT supplies coordinates.
- **Trace:** flow A3 · LIB-FR-05 · LIB-AC-03 · D01, D11 · HARNESS-V5-IA.md §Screens S12 (session detail) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (OBJECT is a label, never evidence), §Round 6 "Rigs: detection plus manual add" · HIGH-LEVEL-DESIGN.md §10 Glossary (OBJECT) · messages indexing_train_detected @ 4f470775

### S9a — Read the new-session filters, Home's Sessions box and the status bar {#S9a}

- **Do:** In Sessions, read the filter counts, then choose the **Needs a Target** filter, then **Not in any Project**. Open Home and read its Sessions box. Open the status bar's ⚠ and ℹ counters.
- **Expect:**
  - The filters read All 7, Needs a Target 1, Not in any Project 6 and Trashed 0.
  - **Needs a Target** lists exactly 24 Sep, and its row offers **Choose Target**.
  - **Not in any Project** lists exactly 12 Sep, 18 Sep, 26 Sep, 28 Sep, 30 Sep and the other-camera session. Each row reads `No Project` and offers **Add to Project**. Its menu reads `No open Project` and offers **Create Project…**.
  - Home's Sessions box shows the same sessions under Needs a Target (1) and Not in any Project (6). Unreviewed and Ready to add read `None`.
  - The ⚠ popout lists `1 needs a Target`, which leads to Sessions filtered to Needs a Target.
  - The ℹ popout lists `6 not in a Project`, which leads to Sessions filtered to Not in any Project, beside the S7a calibration processes waiting to stack.
- **Expect (negative):** Neither filter assigns a session to a Project or a processing run. No session is a candidate of any Project, because no Project exists. Home shows no issues strip or top line.
- **Trace:** cross-flow "Missing OBJECT" · LIB-FR-17 · LIB-AC-18 · PRJ-FR-19 · PRJ-AC-20 · D-W33, D-W43 · HARNESS-V5-IA.md §Screens S1 (Sessions box), S12 · HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3, Home has no issues strip)

### S9b — Name and complete the detected rigs {#S9b}

- **Do:** Open Settings › Equipment and read its rigs. On the rig detected from the RedCat lights choose **Rename**, enter `RedCat` and save. Rename the rig detected from the other-camera lights to `Esprit` the same way. Then choose **Edit optics** on each rig, enter the pixel size 3.76 µm and save. Reopen the 30 Sep session detail.
- **Expect:**
  - Before any change, Settings › Equipment lists exactly two rigs, each named from its TELESCOP and INSTRUME values. One has telescope `RedCat 51`, camera `ZWO ASI2600MM Pro` (Mono, 6248 × 4176) and 250 mm. The other has `Esprit 100`, `ZWO ASI533MC Pro` (OSC, 3008 × 3008) and 550 mm. Each reads `Field of view unknown`, because no light carries a pixel size.
  - After the renames the rigs read `RedCat` and `Esprit`. After Edit optics, `RedCat`'s field of view reads about 5.4° × 3.6° and `Esprit`'s about 1.2° × 1.2°.
  - 30 Sep's rig evidence now names `RedCat`, still Associated and not Confirmed.
- **Expect (negative):** Renaming and editing change no source byte (P5), no folder name and no session's Target, frame count or association status. No third rig appears, and 28 Sep's rig evidence still reads Needs review. No session's rig reads Confirmed before S10.
- **Trace:** LIB-FR-05 · PLAN-EQ-FR-02, PLAN-EQ-FR-05 · D11 · HARNESS-V5-IA.md §Screens S16 (Equipment) · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Rigs: detection plus manual add" (renaming and editing detected ones) · settings-equipment.tsx (Rename, Edit optics), indexing.ts trainFor, messages equipment_rename, equipment_edit_optics, domain_fov_unknown @ 4f470775

### S10 — Confirm and correct associations in the catalog {#S10}

- **Do:** In 24 Sep's Target box, choose NGC 7000 and click **Confirm Target**. Do the same for 26 Sep. Choose **Confirm rig** with rig `RedCat` for the six RedCat sessions: 12, 18, 24, 26, 28 and 30 Sep.
- **Expect:** 24 Sep's Target picker opens on `Choose a Target`, with no Target chosen. After each confirmation, the Target box reads NGC 7000 Confirmed next to the original evidence. 26 Sep still displays its `Cygnus field` label, and 28 Sep's rig no longer reads Needs review. Each of the six sessions reads rig `RedCat` Confirmed. A grouping revision created by a confirmation keeps the previous session identity traceable. **Needs a Target** now reads 0 with `None need a Target`, and **Not in any Project** lists all seven. The status bar's ⚠ counter disappears.
- **Expect (negative):** Source bytes still match P5, including the 26 Sep OBJECT keyword and the absent 28 Sep optics keywords. Session boundaries and frame counts do not change. No picker offers or preselects a Target from an OBJECT label.
- **Trace:** flow A3 · LIB-FR-05, LIB-FR-12, LIB-FR-17 · LIB-AC-06 · root FR-002 · D11, D15, D-W37 · HARNESS-V5-IA.md §Screens S12 (Confirm Target / Confirm rig) · S9b (names the rigs)

### S11 — See a failed catalog write {#S11}

- **Do:** Arm the P6 fault. Choose **Confirm rig** with rig `Esprit` for the other-camera session. Disarm the fault and click **Retry**.
- **Expect:** While the fault is armed, the edited value stays visibly unsaved with an error and **Retry**. After Retry it reads saved.
- **Expect (negative):** The value never reads Saved before the write succeeds.
- **Trace:** flow cross-flow "Unsaved catalog write fails" · LIB-FR-11 · LIB-AC-08 · root FR-012 · D08

### S12 — Rescan with an unreadable session folder {#S12}

- **Do:** Remove read permission from the 18 Sep subfolder. In Settings › Locations, click **Rescan** on `Astro-T7 captures`.
- **Expect:** The 18 Sep frames read unreadable or of unknown scope, and the scan scope is named incomplete. The session keeps its last-observed metadata. Other sessions reconcile normally.
- **Expect (negative):** No 18 Sep frame reads Missing and the session is not removed.
- **Trace:** flow A3, cross-flow "Partial scan" · LIB-FR-06 · LIB-AC-04 · Settings › Locations row action Rescan (`src/features/t1/settings/locations-page.tsx`)

### S13 — Restore the session folder {#S13}

- **Do:** Restore read permission on the 18 Sep subfolder. In Settings › Locations, click **Rescan** on `Astro-T7 captures`.
- **Expect:** 18 Sep reads 55 frames with no uncertainty marker.
- **Expect (negative):** No duplicate 18 Sep session appears.
- **Trace:** flow A3 · LIB-FR-06

### S14 — Verify custody {#S14}

- **Do:** Outside PlateVault, recompute the manifest of the three folders and compare it with P5.
- **Expect:** Every path, size, and SHA-256 matches.
- **Trace:** root SC-002 · LIB-AC-02

### S15 — Take Cold-1 offline {#S15}

- **Do:** Eject `Cold-1`. Read the status bar, then open Settings › Locations.
- **Expect:** The status bar's locations count reads `2 of 3 online`. Its ⚠ popout lists `Cold-1 captures offline`, with its action leading to Settings › Locations. In Settings › Locations, the `Cold-1 captures` row reads Offline, and each `Astro-T7` row shows its disk use: the bytes PlateVault catalogues in that location, plus the free space of the `Astro-T7` volume. The 12 Sep session stays listed with its last-observed metadata and an Offline state. Its metadata is marked as last observed rather than currently verified.
- **Expect (negative):** No 12 Sep frame reads Missing and the session is not removed.
- **Trace:** flow A3, cross-flow "Location offline" · LIB-FR-07 · LIB-AC-05 · D11 · HARNESS-V5-IA.md §Round 2b (Status bar, Left: locations online) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3, P-STO2), §Round 6 "Disk use per location"

## Success criteria

- SC1: After S8, exactly 7 light sessions exist and none mixes channels. Night grouping leaves boundaries and counts identical (S8).
- SC2: The S14 manifest equals P5 for 100% of files.
- SC3: Zero frames read Missing at S5, S12, and S15. 18 Sep reads 55 frames again after S13.
- SC4: After S10, 24 Sep and 26 Sep read NGC 7000 Confirmed, and 12, 18, 28 and 30 Sep and the other-camera session read NGC 7000 Associated. The six RedCat sessions read rig `RedCat` Confirmed, and their source headers equal P5 (S10, S14).
- SC5: After S7, the Calibration row has no failure and its frames are indexed. The failure offered both recovery actions (S5). At S7a, every raw calibration session in P4 has exactly one process with Stack To do, and 0 masters are written and 0 raw frames are trashed.
- SC6: At the end, 0 frames read Usable (S8).
- SC7: A failing catalog write never reads Saved (S11).
- SC8: Home is the first surface after onboarding (S6). At S9a the filters read exactly All 7, Needs a Target 1, Not in any Project 6 and Trashed 0, and the ⚠ popout lists exactly `1 needs a Target`. After S10, **Needs a Target** lists 0 sessions.
- SC9: With no saved site, 0 windows and 0 Img time values are computed (S6a).
- SC10: 0 Targets are taken from an OBJECT label: no evidence list names OBJECT at S9, and 24 Sep's picker opens with no Target chosen at S10.
- SC11: At S15 the status bar reads `2 of 3 online`, and 0 duplicate-copies issues are raised after indexing (S8).
- SC12: After S9b exactly 2 rigs exist, `RedCat` at about 5.4° × 3.6° and `Esprit` at about 1.2° × 1.2°, 0 of them created by hand, and 0 source bytes differ from P5 (S9b, S14).

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the specs, the defaults that the authorized autonomous run set in decisions D01, D08, D11, D15, and D18, and the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 5, `apps/prototype/` on ui-harness-v5 @ b5e813a5, and HARNESS-V5-FEEDBACK-R1.md Round 6 @ 4f470775). No implementation has been validated against them.
- G2: (dissolved 2026-10-12): answered by Round 6 "Rigs: detection plus manual add"; S9 and S9b now assert that indexing detects one rig per camera and telescope pair, which the user renames `RedCat` and `Esprit` and completes with Edit optics before S10 and S11 confirm them. The unanswered locate/remap remainder moves unchanged to G9.
- G3: Unresolved implementation qualification: no fault-injection mechanism exists yet for the S11 catalog-write failure (P6). Blocks readiness.
- G5: Unresolved implementation qualification: S6 needs indexing to run long enough to observe. Fixture sizing or a slow volume is unspecified. Blocks readiness.
- G6: Out of scope for this journey: the P2 fixture has no single night holding both Ha and OIII 300 s lights, so the same-night channel split of LIB-AC-03 is not exercised. Blocks readiness until covered by a step or a journey.
- G7: Out of scope for this journey: the release-build exclusion of the development MCP bridge (LIB-AC-13, D17) is a build check that no running-product step observes. Release-build verification evidence is required. Blocks readiness until it exists.
- G9: Unresolved implementation qualification (carried from G2 unchanged): same-asset locate/remap (LIB-FR-07, D11) and "locate a known copy" are not exercised in this journey. Blocks readiness.
- G10: Unresolved product question: Round 6 defines My targets as "yours plus favourites", while HARNESS-V5-IA.md S10 says "the ★ favourites plus open-Project subjects". Neither says whether a Target that only has indexed sessions (NGC 7000 at S6a, associated by pointing, with no ★ and no Project) is "yours". S6a keeps the IA reading: My targets holds no Target, and NGC 7000's search result is added on a click. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S6, S10, S11, +S6a, +S9a · behavior-change
  The app opens on Home, the Projects dashboard, and main navigation gives Import and Planning (Targets) their own entries. S6a checks planning with no saved site. S9a checks the Needs a Target and Not in any Project filters and Home's top line. S10 confirms the RedCat rig for all six RedCat sessions, because a candidate needs a confirmed rig. P2 gives the other-camera session 40 lights at 300 s.
  Evidence: D-W7 (navigation), D-W12, D-W17, D-W33, D-W35, D-W37, D-W39 (workflow decisions, settled 2026-10-06), 064 LIB-FR-10, LIB-FR-17, LIB-FR-19, 065 PRJ-FR-17, PRJ-FR-19 and 072 PLAN-AC-12, PLAN-TGT-AC-15 at e4476231. Rig names `RedCat` and `Esprit` (J15/S3, S3a) and site `Remote site` (J15/S7); spec text for these steps unchanged at d45a22ad · by: agent (intent-gated, user instruction)
- **Δ3** 2026-10-12 · S1, S3, S4, S6, S6a, S7, +S7a, S8, S9, S9a, S10, S11, S12, S13, S15 · behavior-change
  Onboarding runs Welcome, Locations, Index, and Open library lands on Home's boxes with no top line. The status bar carries locations online, running work and the ⛔/⚠/ℹ counters. Settings › Locations, with Rescan and disk use, replaces the Storage tab, and Targets absorbs Plan. Confirm equipment is now Confirm rig.
  OBJECT is only a label. Pointing within NGC 7000's footprint associates 12, 18, 26, 28 and 30 Sep and the other-camera session, so only 24 Sep needs a Target, and the S9a filters read 1 and 6. This retires G8 (answered) and G4 (Rescan exists).
  New S7a: raw calibration frames wait as calibration processes awaiting Stack. A duplicate scan follows indexing (S8). P2 and P3 place every pointing within NGC 7000's footprint, and S3 and S4 name `Cold-1 captures` and `Astro-T7 calibration`.
  Evidence: HARNESS-V5-IA.md §Source list, §Screens S1, S10, S11, S12, S14, §Round 2b (Status bar, P-CAL3); HARNESS-V5-FEEDBACK-R1.md §Round 1b P-CAL3, §Round 5 (P-SB3, Home has no issues strip, Navigation, P-PLAN2, Click a result to act, OBJECT is a label never evidence, P-STO2, Duplicates are scanned automatically); HIGH-LEVEL-DESIGN.md §10 Glossary (OBJECT); prototype src/features/t1/setup/setup-pages.tsx, src/features/t1/settings/locations-page.tsx (Rescan), src/domain/derive.ts (sessionTargetId), src/domain/issues.ts (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U1Intake (intent-gated)
- **Δ4** 2026-10-12 · S6, S6a, S9, +S9b, S10, S15 · behavior-change
  Indexing detects the rigs; new S9b renames them `RedCat` and `Esprit` and adds their pixel size with Edit optics (P2 now names the optics headers and has no XPIXSZ). The orientation walk opens after setup and Home shows the Getting started checklist (J18).
  Targets opens on My targets with a toggle to Browse catalogues, and disk use per location is the catalogued bytes plus the volume's free space.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Rigs: detection plus manual add", "Onboarding: walk plus checklist", "Targets opens on My targets", "Clicking a result", "Disk use per location" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6F (intent-gated)
