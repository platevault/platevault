---
id: J19
title: Index capture folders in place and inspect sessions on first use
version: 10
status: draft
last_reviewed: 2026-10-29
actors: [primary-user]
surfaces: [onboarding, locations, indexing, home, sessions, targets, planning, status-bar, issues, calibration, duplicates, equipment]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 068-calibration-inputs, 072-observing-plans, D01, D08, D11, D15, D18, D-W89, D-W12, D-W17, D-W96, D-W95, D-W43, D-W94, D-W101, D-W105, specs/063-clean-rebuild-contract/spec.md, specs/063-clean-rebuild-contract/decisions.md, specs/064-library-inventory/spec.md, specs/068-calibration-inputs/spec.md, specs/065-project-goals/spec.md, specs/072-observing-plans/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-a-first-use-and-indexing, HARNESS-V5-IA.md#source-list, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S10, HARNESS-V5-IA.md#S11, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#S14, HARNESS-V5-IA.md#S16, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-FEEDBACK-R1.md#round-1b-decisions, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HIGH-LEVEL-DESIGN.md#glossary, P-SB3, P-STO2, P-PLAN2, P-CAL3, apps/prototype/src/features/t1/setup/setup-pages.tsx, apps/prototype/src/features/t1/settings/locations-page.tsx, apps/prototype/src/features/v5/e-targets-plan-settings/settings-equipment.tsx @4f470775, apps/prototype/src/domain/indexing.ts @4f470775, apps/prototype/messages/en-GB.json @4f470775]
---

## Goal

The user registers folders that already hold captures and calibration frames,
indexes them where they are, inspects sessions and the evidence behind each
Target and rig association, and names and completes the rigs that indexing
detected. Calibration is matched at ingestion and pinned on eligible sessions;
a match outside its window is only suggested until the user confirms it, and an
unsettled session never delays indexing or Import. No Project, processing application, account, network connection,
workspace root, or file reorganization is required. After onboarding the app
opens on Home, the control-panel dashboard. Done means:

- Sessions lists the seven fixture light sessions as separate metadata-homogeneous sessions.
- A session whose pointing lies within a Target's footprint reads that Target as Associated. A session without such pointing reads Needs a Target instead of a guess, and the Needs a Target filter lists it. OBJECT shows only as a label.
- Raw calibration frames wait as calibration processes awaiting Stack. Indexing also matches calibration to the light sessions: compatible raw sets are pinned, a match outside its window is only suggested, and the user confirms the 26 Sep flats suggestion, which settles that session's calibration (LIB-FR-23, CAL-FR-02, CAL-FR-04, CAL-FR-05).
- Indexing detects one rig per camera and telescope pair. The user renames them `RedCat` and `Esprit` and adds their missing pixel size in Settings › Equipment, so each has a field of view.
- An unreadable or offline location reads as uncertain rather than Missing, in the status bar and in Settings › Locations.
- Every file in the registered folders is byte-identical to the pre-index manifest.

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
- **Expect:** Onboarding shows three steps, Welcome, Locations and Index, and opens on Welcome. Welcome lists what PlateVault does and what it never does, including `Needs an account or a network connection`. On Locations, Captures is marked Required. Calibration and Results are marked Optional, and each offers **Set up later**. **Continue** is unavailable and names Captures as the missing role: `Add a capture location to continue. Captures is the only required role.` Calibration is optional because compatible masters can be imported later; raw calibration indexed in a registered location is matched at ingestion (LIB-FR-01, LIB-FR-23).
- **Expect (negative):** No step asks for a processing application, a Project, a workspace root, or an account.
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
- **Expect:** Onboarding continues to its Index step. Results reads as not set, and the registered Calibration location lets indexing match its raw sets to eligible light sessions.
- **Expect (negative):** The unset Results role is not shown as an error, warning, or failed setup.
- **Trace:** flow A2 · LIB-FR-01 · LIB-AC-01

### S5 — Start indexing with one denied location {#S5}

- **Do:** Outside PlateVault, remove read permission from `Astro-T7/Calibration`. In the Index step, read **Start indexing**, then set Home's planning criteria:
  - Minimum altitude 25°
  - Darkness Astronomical
  - Moon No limit
  - Shortest window 60 min

  Click **Start indexing**.
- **Expect:** The Index step asks for Home's planning criteria and fills in no value. After **Start indexing**, progress shows these counts:
  - files discovered and metadata read;
  - unsupported items, at least the P2 note file;
  - unreadable items and completed scope.

  The Calibration row names the access failure and offers **Choose folder again** and **Retry**. Both Captures locations keep indexing.
- **Expect (negative):** The denied folder is not reported as empty, and none of its files is labelled Missing. **Start indexing** stays unavailable until the user sets Home's planning criteria.
- **Trace:** flow A3, A4 · LIB-FR-03, LIB-FR-06, LIB-FR-07, LIB-FR-31 · LIB-AC-07, LIB-AC-47 · D-W170

### S6 — Browse while indexing runs {#S6}

- **Do:** Before indexing finishes, click **Open library**. The orientation walk opens on its own after setup (J18/S1); skip or finish it (J18/S2, S3). Read Home, the source list and the status bar, then open Sessions.
- **Expect:** Home opens, not the Targets list. It shows Pending ingestions, Pending work, Open work, Status, Tonight and the calendar, with no tabs and no header buttons. Open work reads **No Projects in progress.**, Home has no Getting started checklist (J18/S6), and Status lists the indexing operation with its progress. The source list offers Home, Projects, Targets, Sessions and Calibration, with Activity and Settings in its footer, and the toolbar offers Import. The status bar shows the indexing operation as running work with a mini progress bar. Its ⛔ errors counter reads 1 and opens a menu naming `Settings › Locations · 1`, which opens Settings › Locations filtered to the `Astro-T7 calibration` row, which names the access failure (FR-032, D-W144). In Sessions, the sessions read so far can be inspected. Totals name the locations they cover and read Provisional.
- **Expect (negative):** Home shows no issues strip, summary line or alerts list, and no counter opens a list of issues. The source list has no Storage or Plan entry. No total implies that unscanned folders or data outside the registered locations are included. No screen asks for an account or a network connection.
- **Trace:** flow A4 · LIB-FR-03, LIB-FR-10 · LIB-AC-07, LIB-AC-09 · PRJ-FR-17 · D-W89, D-W92 · HARNESS-V5-IA.md §Source list, §Screens S1, §Round 2b (Status bar) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3, Home has no issues strip, Navigation, P-STO2, P-PLAN2), §Round 6 "Onboarding: walk plus checklist" · J18/G4 (the page setup hands over to) · G5

### S6a — Read planning before any site exists {#S6a}

- **Do:** When both Captures locations finish indexing, on Home, read Tonight. Open Targets and search for `NGC 7000`.
- **Expect:** Tonight reads `No site` and offers **Add site**, which leads to Settings › Observing sites. Targets opens on My targets, with tonight in its header date picker and a toggle to Browse catalogues. My targets lists NGC 7000, because its sessions are indexed, not as a favourite and with no Project badge. The altitude column draws no sparkline and the page offers **Add site**. The search lists NGC 7000 from the bundled catalogues with its source, and the result shows it is in My targets, so clicking it would open NGC 7000 and add nothing (PLAN-TGT-FR-03). The results read `SIMBAD off` or `SIMBAD unreachable`, never `SIMBAD searched`.
- **Expect (negative):** No window, altitude or Img time is computed for an assumed location or for criteria other than those from S5. Searching writes nothing: this step clicks no result row, and the search adds no Target to My targets.
- **Trace:** PLAN-FR-11 · PLAN-AC-12 · PLAN-TGT-FR-01, PLAN-TGT-FR-03 · PLAN-TGT-AC-03, PLAN-TGT-AC-04, PLAN-TGT-AC-15 · D-W17, D-W39, D-W170 · HARNESS-V5-IA.md §Screens S1 (Tonight), S10, S11 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Targets opens on My targets"

### S7 — Recover the denied location {#S7}

- **Do:** Restore read permission on `Astro-T7/Calibration` and click **Retry** on its row.
- **Expect:** The row clears its failure and the calibration frames are indexed. The status bar's ⛔ errors counter disappears.
- **Expect (negative):** Retrying one location does not reset or re-create sessions already read from the Captures locations.
- **Trace:** flow A4 · LIB-FR-07

### S7a — Find the raw calibration frames {#S7a}

- **Do:** After indexing completes, open the Calibration library, then Sessions. Open the status bar's ℹ info counter.
- **Expect:** The Calibration library lists one calibration process for each raw calibration session in P4. Each reads `Calibration → stack`, with the steps Stack, Detect, Import, Register and Raws, and Stack reads To do. The ℹ counter's menu names `Calibration · <n>` (`<n> to stack`), where n is the number of those processes, and that entry opens the Calibration library filtered to them. Sessions lists no calibration session. Indexing also matches calibration to the light sessions (LIB-FR-23, CAL-FR-02, CAL-FR-04, CAL-FR-19 to CAL-FR-21). The raw darks and bias are pinned to the six RedCat sessions, the Ha flats to the 18 Sep session and the OIII flats to the 30 Sep session, each taken the same night as those lights. Flats taken outside the default same-or-next-night window are only suggested (CAL-FR-20): the OIII flats, taken on 30 Sep, for 12, 24 and 26 Sep, and the Ha flats, taken on 18 Sep, for 28 Sep. The other-camera session's darks, flats and bias read not found, because no raw set in P4 comes from its camera or optical train. So only 18 and 30 Sep are settled. 26 Sep's calibration stays unsettled until the user confirms its suggestion (S10a), and indexing never waits for it (LIB-FR-24). Sessions' **Needs calibration** filter lists every session whose calibration isn't settled, Ready or not (LIB-FR-17), so it lists the five unsettled sessions while their frames are Unreviewed.
- **Expect (negative):** No process starts Stack by itself. No tool is launched, and no master or stacking folder is written. No raw frame goes to the OS Trash (P5 still matches). No master made from P4's raw frames is listed.
- **Trace:** LIB-FR-23, LIB-FR-24, LIB-FR-26 · CAL-FR-02, CAL-FR-09, CAL-FR-19 to CAL-FR-23 · D-W101, D-W102, D-W103, D-W104, D-W105

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

### S9a — Read the new-session filters, Home's Pending work and the status bar {#S9a}

- **Do:** In Sessions, read the filter counts, then choose the **Needs a Target** filter, then **Not in any Project**. Open Home and read its Pending work section. Choose the status bar's ⚠ counter, then its ℹ counter.
- **Expect:**
  - The filters read All 7, Needs calibration 5 and Trashed 0. **Needs calibration** lists 12, 24, 26 and 28 Sep and the other-camera session (S7a): none of them is Ready, and the filter lists every session whose calibration isn't settled (LIB-FR-17).
  - **Needs a Target** lists 24 Sep, which has no Target, and its row offers **Choose Target**. It lists none of 12, 18, 26, 28 and 30 Sep and the other-camera session, whose Target is associated by pointing, because an associated Target counts as confirmed.
  - **Not in any Project** doesn't list 24 Sep. It lists 12, 18, 26, 28 and 30 Sep and the other-camera session, because their associated Target counts as confirmed. Each row it lists reads `No Project` and offers **Add to Project**, and its menu reads `No open Project` and offers **Create Project…**.
  - Home's Pending work reports the same counts as the Sessions filters, with 24 Sep among the sessions needing a Target and the five S7a sessions as needing calibration.
  - The ⚠ counter opens Sessions filtered to the rows its warnings affect, 24 Sep among them.
  - The ℹ counter opens a menu naming `Calibration · <n>` for the S7a processes waiting to stack, and `Sessions · <n>` for the sessions not in a Project.
- **Expect (negative):** Neither filter assigns a session to a Project. No session is suggested to any Project, because no Project exists. Home shows no Sessions box, issues strip or summary line, and no counter opens a list of issues.
- **Trace:** cross-flow "Missing OBJECT" · LIB-FR-17 · LIB-AC-18 · PRJ-FR-17, PRJ-FR-19 · PRJ-AC-20 · D-W33, D-W43, D-W78, D-W89, D-W92, D-W105 · HARNESS-V5-IA.md §Screens S12 · HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3, Home has no issues strip)

### S9b — Edit detected rigs and enter missing camera data {#S9b}

- **Do:** Open Settings › Equipment and read its rigs. On the rig detected from the RedCat lights choose **Edit…**, set its name to `RedCat` and save. Edit the rig detected from the other-camera lights the same way, setting its name to `Esprit`. Then choose **Edit…** on each rig's camera record, enter the pixel size 3.76 µm and save. Reopen the 30 Sep session detail.
- **Expect:**
  - Before any change, Settings › Equipment lists exactly two rigs, each named from its TELESCOP and INSTRUME values. One has telescope `RedCat 51`, camera `ZWO ASI2600MM Pro` (Mono, 6248 × 4176) and 250 mm. The other has `Esprit 100`, `ZWO ASI533MC Pro` (OSC, 3008 × 3008) and 550 mm. Each reads `Field of view unknown`, because no light carries a pixel size.
  - After the edits the rigs read `RedCat` and `Esprit`, each still with one rig version, because editing a name changes no component (PLAN-EQ-FR-07). After the camera edits, `RedCat`'s field of view reads about 5.4° × 3.6° and `Esprit`'s about 1.2° × 1.2°.
  - 30 Sep's rig evidence now names `RedCat`, still Associated and not Confirmed.
- **Expect (negative):** Editing changes no source byte (P5), no folder name and no session's Target, frame count or association status. No third rig appears, and 28 Sep's rig evidence still reads Needs review. No session's rig reads Confirmed before S10.
- **Trace:** LIB-FR-05 · PLAN-EQ-FR-01, PLAN-EQ-FR-02, PLAN-EQ-FR-05, PLAN-EQ-FR-07 · D11, D-W76, D-W87, D-W104 · HARNESS-V5-IA.md §Screens S16 (Equipment) · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Rigs: detection plus manual add" · HARNESS-V5-FEEDBACK-R1.md Round 9 C2 (one Edit… verb)

### S10 — Confirm and correct associations in the catalog {#S10}

- **Do:** In 24 Sep's Target box, choose NGC 7000 and click **Confirm Target**. Do the same for 26 Sep. Choose **Confirm rig** with rig `RedCat` for the six RedCat sessions: 12, 18, 24, 26, 28 and 30 Sep. Then open the intake Target and Rig steps of 24 Sep, 28 Sep and 30 Sep.
- **Expect:** 24 Sep's Target picker opens on `Choose a Target`, with no Target chosen. After each confirmation, the Target box reads NGC 7000 Confirmed next to the original evidence. 26 Sep still displays its `Cygnus field` label. Each of the six sessions reads rig `RedCat` Confirmed, including 28 Sep, whose rig read Needs review before. **Needs a Target** lists neither 24 nor 26 Sep, **Not in any Project** lists both, and 24 Sep's row carries no Needs a Target warning. 12, 18, 28 and 30 Sep and the other-camera session, whose Target is still associated by pointing, stay out of **Needs a Target** and in **Not in any Project**, because an associated Target counts as confirmed.
- **Expect:** 24 Sep's Target step shows a Corrections table with the columns Field, Recorded and Corrected (provisional copy, from the prototype). Its Target row reads "–" recorded and NGC 7000 corrected. 28 Sep's Rig step shows the same table with one Equipment row, "–" recorded and `RedCat` corrected, because its rig had no associated value. 30 Sep's rig was already associated as `RedCat`, and its Target is still associated by pointing, so neither of its steps shows a Corrections table.
- **Expect (negative):** Source bytes still match P5, including the 26 Sep OBJECT keyword and the absent 28 Sep optics keywords. Session boundaries and frame counts do not change. No picker offers or preselects a Target from an OBJECT label. A correction writes no header.
- **Trace:** flow A3 · LIB-FR-05, LIB-FR-12, LIB-FR-17, LIB-FR-20 · LIB-AC-06 · root FR-002 · D11, D15, D-W37, D-W122 · HARNESS-V5-IA.md §Screens S12 (Confirm Target / Confirm rig) · S9b (names the rigs) · HARNESS-V5-FEEDBACK-R1.md Round 9 C15 (corrections recorded at ingestion)

### S10a — Confirm the suggested flats for 26 Sep {#S10a}

- **Do:** Open the 26 Sep session's details and read its darks, flats and bias. On flats, confirm the suggested OIII flats.
- **Expect:** Before the confirmation, darks and bias read pinned, and flats read suggested with the OIII flats' capture date, 30 Sep, and their evidence. After it, flats read pinned to the OIII flats, so the 26 Sep session's calibration is settled. Each kind offers **Reassign…**. **Needs calibration** then lists 4 sessions, without 26 Sep.
- **Expect (negative):** Indexing never confirmed the suggestion by itself. Confirming changes no source byte (P5), no file in `Astro-T7/Calibration` and no other session's calibration.
- **Trace:** LIB-FR-17, LIB-FR-23 · CAL-FR-05, CAL-FR-20 · D-W102, D-W105

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

- **Do:** Eject `Cold-1`. Read the status bar, open its ⚠ counter and choose `Settings › Locations · 1` in its menu.
- **Expect:** The status bar's locations count reads `2 of 3 online`. Its ⚠ counter opens a menu naming `Sessions · <n>` and `Settings › Locations · 1`. n counts the session warnings: 4 for the sessions still in Needs calibration after S10a (12, 24 and 28 Sep and the other-camera session). No session carries a Needs a Target warning: after S10, 24 and 26 Sep are confirmed and every other session has a Target associated by pointing, which counts as confirmed. `Settings › Locations · 1` opens Settings › Locations filtered to the `Cold-1 captures` row. In Settings › Locations, the `Cold-1 captures` row reads Offline, and each `Astro-T7` row shows its disk use: the bytes PlateVault catalogues in that location, plus the free space of the `Astro-T7` volume. The 12 Sep session stays listed with its last-observed metadata and an Offline state. Its metadata is marked as last observed rather than currently verified.
- **Expect (negative):** No 12 Sep frame reads Missing and the session is not removed.
- **Trace:** flow A3, cross-flow "Location offline" · LIB-FR-07, LIB-FR-17 · LIB-AC-05 · 063 FR-032 · D11, D-W92 · HARNESS-V5-IA.md §Round 2b (Status bar, Left: locations online) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3, P-STO2), §Round 6 "Disk use per location"

## Success criteria

- SC1: After S8, exactly 7 light sessions exist and none mixes channels. Night grouping leaves boundaries and counts identical (S8).
- SC2: The S14 manifest equals P5 for 100% of files.
- SC3: Zero frames read Missing at S5, S12, and S15. 18 Sep reads 55 frames again after S13.
- SC4: After S10, 24 Sep and 26 Sep read NGC 7000 Confirmed, and 12, 18, 28 and 30 Sep and the other-camera session read NGC 7000 Associated. The six RedCat sessions read rig `RedCat` Confirmed, and their source headers equal P5 (S10, S14).
- SC5: After S7, the Calibration row has no failure and its frames are indexed. The failure offered both recovery actions (S5). At S7a, every raw calibration session in P4 has exactly one process with Stack To do, and 0 masters are written and 0 raw frames are trashed. Indexing pinned the raw darks and bias on the six RedCat sessions, the Ha flats on 18 Sep and the OIII flats on 30 Sep, so 2 sessions are settled and 5 are not, 26 Sep among them with the OIII flats suggested. After S10a the 26 Sep session's flats are pinned, its calibration is settled, and **Needs calibration** lists 4 sessions.
- SC6: At the end, 0 frames read Usable (S8).
- SC7: A failing catalog write never reads Saved (S11).
- SC8: Home is the first surface after onboarding (S6). At S9a the filters read exactly All 7, Needs calibration 5 and Trashed 0, Needs a Target lists 24 Sep and none of the sessions whose Target is associated by pointing (12, 18, 26, 28 and 30 Sep and the other-camera session), and Home's Pending work reports the same counts as the filters. After S10, **Needs a Target** lists neither 24 nor 26 Sep, and **Not in any Project** lists 24 and 26 Sep and every session whose Target is associated by pointing.
- SC9: With no saved site, 0 windows and 0 Img time values are computed (S6a).
- SC10: 0 Targets are taken from an OBJECT label: no evidence list names OBJECT at S9, and 24 Sep's picker opens with no Target chosen at S10.
- SC11: At S15 the status bar reads `2 of 3 online`, and 0 duplicate-copies issues are raised after indexing (S8).
- SC12: After S9b exactly 2 rigs exist, `RedCat` at about 5.4° × 3.6° and `Esprit` at about 1.2° × 1.2°, 0 of them created by hand, and 0 source bytes differ from P5 (S9b, S14).

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows specs 064, 068 and 072, the defaults that the authorized autonomous run set in decisions D01, D08, D11, D15, and D18, D-W94 and D-W101 to D-W105 in the F4 workflow decisions, and the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 5, `apps/prototype/` on ui-harness-v5 @ b5e813a5, and HARNESS-V5-FEEDBACK-R1.md Round 6 @ 4f470775). No implementation has been validated against them.
- G2: (dissolved 2026-10-12): answered by Round 6 "Rigs: detection plus manual add"; S9 and S9b now assert that indexing detects one rig per camera and telescope pair, which the user names `RedCat` and `Esprit` and completes with **Edit…** (Round 9 C2) before S10 and S11 confirm them. The unanswered locate/remap remainder moves unchanged to G9.
- G3: Unresolved implementation qualification: no fault-injection mechanism exists yet for the S11 catalog-write failure (P6). Blocks readiness.
- G5: Unresolved implementation qualification: S6 needs indexing to run long enough to observe. Fixture sizing or a slow volume is unspecified. Blocks readiness.
- G6: Out of scope for this journey: the P2 fixture has no single night holding both Ha and OIII 300 s lights, so the same-night channel split of LIB-AC-03 is not exercised. Blocks readiness until covered by a step or a journey.
- G7: Out of scope for this journey: the release-build exclusion of the development MCP bridge (LIB-AC-13, D17) is a build check that no running-product step observes. Release-build verification evidence is required. Blocks readiness until it exists.
- G9: Unresolved implementation qualification (carried from G2 unchanged): same-asset locate/remap (LIB-FR-07, D11) and "locate a known copy" are not exercised in this journey. Blocks readiness.
- G10: (dissolved 2026-10-19): the owner's answer in astro-plan-rzbzu.1 settles My targets: favourites, subjects of open Projects, and every Target that has at least one session. S6a now asserts that My targets lists NGC 7000 once its sessions are indexed, and that its search result shows it is in My targets.
- G11: (dissolved 2026-10-19): the owner's answer in astro-plan-rzbzu.1: a Target associated by agreeing pointing counts as confirmed for Needs a Target, Not in any Project and Ready. S9a, S10, S15 and SC8 now assert it for the sessions whose Target is associated by pointing. J14, J20, J28 and J35 already assumed this answer.
- G12: D-W141 is not observed: no fixture has a correction whose successor matches another session of that night. LIB-AC-37 states the rule. Blocks readiness until a fixture does (D-W141, owner's answer, 2026-10-20).
- G13: D-W131 not observed: no fixture re-splits a session with a user-set name and notes through a metadata correction, so no step shows the name and notes staying with the part that holds its first frame (LIB-FR-12, LIB-FR-28, LIB-AC-38; D-W131; owner's answer, 2026-10-20). Blocks readiness until a fixture does.

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
- **Δ5** 2026-10-15 · S1, S4, S6, S7a, S9a, S9b, S10, +S10a, S15 · behavior-change
  Indexing matches calibration to light sessions and pins it, a match outside its window is only suggested, and an unsettled session never delays indexing or Import. S10a confirms the flats suggested for 26 Sep, which settles its calibration. Raw calibration still waits as calibration processes awaiting Stack. Pixel size is entered on the camera record, and renaming a rig starts no rig version. Home shows Pending ingestions, Pending work and Open work instead of boxes, header buttons or a checklist, S9a reads Pending work and every Sessions filter, and each status bar counter opens its owning page instead of a list of issues.
  Evidence: D-W78, D-W89, D-W92, D-W101 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 064 LIB-FR-17, LIB-FR-23, LIB-FR-24, 065 PRJ-FR-17, 068 CAL-FR-02, CAL-FR-04, CAL-FR-05, CAL-FR-20 · by: SpecF4Writer2 (intent-gated)
- **Δ6** 2026-10-16 · S7a, S9a, S10a · behavior-change
  Needs calibration lists every session whose calibration isn't settled, Ready or not, so it reads 5 at S9a and 4 after S10a. S7a names each session's calibration after indexing: 18 and 30 Sep are settled, the flats of 12, 24, 26 and 28 Sep are only suggested, and the other-camera session finds no calibration.
  Evidence: LIB-FR-17 as corrected in PR #1804 (commit 8660e090), CAL-FR-20, CAL-FR-21, D-W105, D-W114 · by: EncodeOwnerAnswers2 (intent-gated)
- **Δ7** 2026-10-17 · S9b, S10, G2 · behavior-change
  One **Edit…** verb replaces Rename and Edit optics: S9b names the detected rigs and enters the camera's pixel size through **Edit…**.
  Metadata corrections are recorded at ingestion: S10 reads 24 Sep's Target and 28 Sep's rig in the Corrections tables of their intake steps.
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C2, C15 · D-W76 · PLAN-EQ-FR-07, LIB-FR-12 · prototype session-intake.tsx Corrections (ui-harness-v5) · by: JourneysR9c (intent-gated)
- **Δ8** 2026-10-19 · S6a, S9a, S10, S15, SC8 · behavior-change
  My targets lists every Target with at least one session, so at S6a it lists NGC 7000, and NGC 7000's search result offers no Add to targets.
  A Target associated by agreeing pointing counts as confirmed: at S9a and S10 the sessions associated by pointing are not in Needs a Target and are in Not in any Project.
  Evidence: owner's answers of 2026-10-19 in astro-plan-rzbzu.1 (My targets, associated Target), PLAN-TGT-FR-03, LIB-FR-17, LIB-FR-20 · by: Main (intent-gated)
- **Δ9** 2026-10-26 · S6, S6a · behavior-change
  A status-bar counter with one issue opens the same menu of owning pages as several do, and My targets marks a favourite in its Favourite column instead of with ★.
  At S6a, clicking NGC 7000's search result would open it, because a click on a result adds it or opens it and no result row has an Add button.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 11 (OWNER, 2026-10-23) and §Round 6 "Clicking a result" on ui-harness-v5 @ 5dc245244; D-W142, D-W144, D-W152, FR-032 · by: SpecAmend (intent-gated)
- **Δ10** 2026-10-29 · S5, S6a · behavior-change
  The setup wizard's Index step asks for Home's planning criteria, which have no defaults. S5 sets them before indexing starts. S6a computes nothing under assumed criteria.
  Evidence: D-W170, LIB-FR-31, LIB-AC-47, PLAN-FR-11 · owner's answer, 2026-10-29, astro-plan-0v2o0.4 · by: Amend5Fix (intent-gated)
