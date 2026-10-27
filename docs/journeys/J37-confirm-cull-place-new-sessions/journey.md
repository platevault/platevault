---
id: J37
title: Confirm, cull and place a new night's sessions after an import
version: 7
status: draft
last_reviewed: 2026-10-27
actors: [primary-user]
surfaces: [status-bar, home, sessions, frame-review, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 067-frame-review, LIB-FR-05, LIB-FR-17, PRJ-FR-19, PIX-FR-18, D-W14, D-W94, D-W30, D-W96, D-W95, D-W89, D-W79, D-W59, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/067-frame-review/spec.md, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S4, HARNESS-V5-IA.md#S6, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-FEEDBACK-R1.md#screens-slices, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HIGH-LEVEL-DESIGN.md#glossary, P-SB3, P-IMP2, apps/prototype/src/features/v5/a-home/home.tsx, apps/prototype/src/features/v5/a-home/sessions.tsx, apps/prototype/src/features/v5/a-home/session.tsx, apps/prototype/src/features/v5/a-home/parts.tsx, apps/prototype/src/domain/issues.ts, 066-view-selection, 068-calibration-inputs, LIB-FR-12, LIB-FR-20, LIB-FR-23, LIB-FR-24, PRJ-FR-08, PRJ-FR-09, PRJ-FR-17, PRJ-FR-18, PRJ-FR-27, PIX-FR-14, VSEL-FR-12, VSEL-FR-15, D-W93, D-W100, D-W101, D-W105, specs/066-view-selection/spec.md, specs/068-calibration-inputs/spec.md]
---

## Goal

After import, the user resolves Target and rig associations, reviews new sessions through intake, and explicitly adds Ready sessions with settled calibration to a Project. Home and Sessions show Project suggestions, which are never added automatically. OBJECT remains a label, and confirming a Target changes catalog metadata but never moves imported files. Done means:

- The Needs a Target filter reads 0. The pending-work rows and Sessions filters distinguish sessions that need review, need calibration, or are not held by a Project.
- Each of the 10 light sessions has a Target and a rig, Confirmed by the user or Associated from its pointing and optics keywords. The reviewed `2 Oct Ha`, `2 Oct OIII` and `4 Oct Ha` sessions are Ready with settled calibration before they are added.
- `2 Oct Ha` reads 32 Usable and 3 Unusable frames, and `4 Oct Ha` reads 12 Picked, with every mark at library scope.
- `NGC 7000 HOO` holds only the sessions the user added, has rigs `RedCat` and `Esprit`, and shows unadded matching Ready sessions as suggestions.
- Every file under the registered locations is byte-identical to the pre-run manifest; confirming Targets, confirming rigs, reviewing frames, creating a Project and adding sessions move no file.

## Preconditions

- P1: J31 completed through S9. `Astro-T7 captures`, `Cold-1 captures` and `Astro-T7 calibration` are registered and online. Rigs `RedCat` (RedCat 51 + ASI2600MM) and `Esprit` (Esprit 100 + ASI533MC) exist, detected by indexing and renamed at J19/S9b. No Project exists. No `NGC 7000/Ha/2026-10-04/` folder exists. After J31, the user settled the calibration of every listed light session. J19/S10a pinned 26 Sep's flats. The user confirmed the flats that J19/S7a only suggested: the 30 Sep OIII flats for 12 and 24 Sep, and the 18 Sep Ha flats for 28 Sep. For the other-camera session, for which indexing found no calibration (J19/S7a), the user chose No darks, No flats and No bias. Each kind the J31 imports left unsettled on `2 Oct Ha`, `2 Oct OIII` and `4 Oct Ha` is pinned or set to its No choice (J31 G9). So each dark, flat and bias kind of each listed light session is pinned or set to its No choice. The raw calibration processes that J19/S7a and J31/S6 made still await Stack.
- P2: The catalog holds 10 light sessions:

  | Session | Frames | Target | Rig | OBJECT | Pointing |
  | --- | --- | --- | --- | --- | --- |
  | 12, 18, 24, 26, 28 and 30 Sep (J19) | 24, 55, 20, 35, 56, 48 | NGC 7000 Confirmed: 24 and 26 Sep at J19/S10, the rest at their intake after J31 (P3) | `RedCat` Confirmed (J19/S10) | as J19/P2, P3 | as J19/P2, P3 |
  | other camera (J19) | 40 | NGC 7000 Confirmed at its intake after J31 (P3) | `Esprit` Confirmed (J19/S11) | NGC 7000 | within NGC 7000's footprint |
  | `2 Oct Ha` (J31/S6, S8) | 35 | NGC 7000 Confirmed in the Import preview, prefilled from its pointing (J31/S3, S6) | `RedCat` Associated from its optics keywords (G3) | `NGC 7000` | within NGC 7000's footprint |
  | `2 Oct OIII` (J31/S5a, S6) | 6 | NGC 7000 Confirmed in the Import preview (J31/S5a) | Needs review: no TELESCOP or FOCALLEN | none | none |
  | `4 Oct Ha` (J31/S9) | 12 | none: Unclassified at import, its frames under `unclassified/Ha/2026-10-04/light/` in `Astro-T7 captures` | `RedCat` Associated from its optics keywords (G3) | `NGC7000` | none |

- P3: Every frame in `2 Oct Ha`, `2 Oct OIII` and `4 Oct Ha` reads Unreviewed. J19 left every frame of its sessions Unreviewed (J19 SC6), and it left the Targets of 12, 18, 28 and 30 Sep and the other-camera session associated by pointing (J19 SC4). After J31, the user took the seven J19 sessions through intake (LIB-FR-20). At the Target step of the five associated sessions they confirmed the NGC 7000 Target that the pointing preselected, and they finished each review. So all seven read NGC 7000 Confirmed and are Ready. Among `2 Oct Ha`, `Light_Ha_0005.fits`, `Light_Ha_0017.fits` and `Light_Ha_0023.fits` are clouded (J31/P2).
- P4: No location is offline or unreadable, no work has failed or been interrupted, and no frame or pinned calibration assignment has drifted.
- P5: A manifest (relative path, size, SHA-256) of every file under the three registered locations, recorded outside PlateVault before S1.

## Steps

### S1 — Start from the status bar {#S1}

- **Do:** Read the status bar. Open its ℹ counter, read its menu and choose `Sessions · 9`, then return and choose its ⚠ counter.
- **Expect:** The status bar shows the ⚠ warnings and ℹ info counters and no ⛔ errors counter. No counter opens a list of issues. The ℹ counter opens a menu naming `Sessions · 9` (`9 not in a Project`), which opens Sessions filtered to **Not in any Project**, and `Calibration · <n>` (`<n> to stack`) for the raw calibration processes that J19/S7a and J31/S6 left awaiting Stack. The ⚠ counter reads 1 and opens a menu naming `Sessions · 1`, which opens Sessions filtered to **Needs a Target**. The filters read All 10, Needs a Target 1, Needs calibration 0, Not in any Project 9 and Trashed 0, and Needs a Target lists exactly `4 Oct Ha`.
- **Expect (negative):** Choosing a counter changes no session, Target, rig or Project. Neither `2 Oct Ha` nor `2 Oct OIII` is listed under Needs a Target, because their Targets were confirmed at import.
- **Trace:** LIB-FR-17, LIB-FR-23, PRJ-FR-17 · D-W92, D-W105

### S2 — Read Home's Pending work {#S2}

- **Do:** Open Home and read its Pending work section.
- **Expect:** Home's Pending work section includes one session needing a Target, `4 Oct Ha`, with `OBJECT NGC7000` shown only as a label. It also lists sessions not held by a Project. Home has no Sessions summary box or Ready to add group.
- **Expect (negative):** `4 Oct Ha` is not offered `Confirm NGC 7000` or any other Target suggested from its OBJECT. Home shows no issues strip or top line.
- **Trace:** LIB-FR-17 · PRJ-FR-17, PRJ-FR-19 · D-W89, D-W96

### S3 — Confirm a Target and rig for the Unclassified session {#S3}

- **Do:** On `4 Oct Ha`, click **Choose Target**. In its Target box, choose NGC 7000 and click **Confirm Target**. Confirm its rig as `RedCat` using the session's equipment evidence.
- **Expect:**
  - The session detail opens at its Target box, which reads `Unsettled`. Its Target evidence lists the pointing as `No pointing in header`, and its header line shows `OBJECT NGC7000` as a label. The Target picker opens on `Choose a Target`, with no Target chosen.
  - The 12 lights remain at `unclassified/Ha/2026-10-04/light/` in `Astro-T7 captures`, with their basenames unchanged.
  - After the catalog changes are confirmed, the Target box reads NGC 7000 Confirmed and the Rig box reads `RedCat` Confirmed. The label still reads `OBJECT NGC7000`. The 12 files remain under `unclassified/Ha/2026-10-04/light/` with their P5 sizes and SHA-256.
  - The filters read Needs a Target 0, which shows `None need a Target`. The session is not suggested to a Project until it is Ready.
- **Expect (negative):** The OBJECT label is not listed as Target evidence, is not preselected and does not count towards the confirmation. No file moves (P5 still matches). Confirming catalog associations writes no header. The session joins no Project until it is Ready, has settled calibration and the user adds it.
- **Trace:** LIB-FR-05, LIB-FR-12, LIB-FR-17, LIB-FR-20, LIB-FR-23 · D-W94, D-W96, D-W105

### S4 — Confirm a rig from Sessions {#S4}

- **Do:** In Sessions, choose **Not in any Project**. Right-click `2 Oct OIII` and choose **Confirm rig**. In the Rig box, choose `RedCat` and click **Confirm rig**. Open its intake Review step, select all six frames with **⌘A** (Ctrl+A off macOS), press **P**, read the confirmation and confirm it, then choose **Finish review**.
- **Expect:** Before confirmation, the `2 Oct OIII` row reads `Rig needs review`, its Rig box reads `Unsettled`, and its Target box reads NGC 7000 Confirmed from import. Afterwards, the Rig box reads `RedCat` Confirmed. **P** on the ⌘A selection opens the bulk confirmation `Mark 6 frames Usable?`. After confirming, the six frames read Picked, and **Finish review** makes the session Ready; its settled calibration allows it to be suggested to Projects listing its Target and rig.
- **Expect (negative):** Confirming changes no frame count, header or file, and no move is offered. No frame changes before the bulk confirmation is accepted. `2 Oct OIII` joins no Project.
- **Trace:** LIB-FR-05, LIB-FR-20, LIB-FR-23, PRJ-FR-09 · PIX-FR-14, PIX-AC-21 · D-W78, D-W104, D-W105, D-W118

### S5 — Read the pointing evidence of a session indexed in place {#S5}

- **Do:** Open `30 Sep`. Read its Target and Rig boxes and its Project membership.
- **Expect:** The Target box reads NGC 7000 Confirmed (P3) next to its original evidence, which lists the pointing as `<angle> from NGC 7000 centre`, and the header line shows `OBJECT NGC 7000` as a label. The Rig box reads `RedCat` Confirmed (J19/S10). The session is Ready and not held by a Project, and Sessions' Not in any Project filter lists it.
- **Expect (negative):** Reading the session changes no filter count and no Project suggestion. No evidence list names OBJECT. No mismatch warning appears, because the pointing lies within NGC 7000's footprint. The session's 48 frames stay at their J19 paths, and no move is offered.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 (association uses pointing within the Target's footprint and the user's confirmation only), §Round 6 (Confirming a Target the pointing disagrees with shows a mismatch warning) · HARNESS-V5-IA.md §Screens S12 · LIB-FR-05, LIB-FR-17, LIB-FR-20

### S6 — Cull the new night's frames with library marks {#S6}

- **Do:** In Sessions, open the `2 Oct Ha` session's intake Review step. Mark `Light_Ha_0005.fits`, `Light_Ha_0017.fits` and `Light_Ha_0023.fits` with X, one at a time. Select every remaining Unreviewed frame shown with ⌘A, then press P, read the confirmation and confirm it. Choose **Finish review**.
- **Expect:**
  - Intake's Review step opens filtered to Unreviewed, with 35 frames.
  - Each X marks its frame Unusable in the library at once, without a confirmation.
  - Pressing P on the 32 frames selected with ⌘A opens the bulk confirmation `Mark 32 frames Usable?`. After confirming, the three X frames read Rejected and the rest read Picked, and the review counts 32 Picked, 3 Rejected and 0 Unreviewed. **Finish review** makes the session Ready.
  - The session detail reads 32 Usable and 3 Unusable frames, still 35 frames in all, and the session reads Ready.
- **Expect (negative):** While the bulk confirmation is open, the 32 frames still read Unreviewed. The marks change library quality only. The 3 Unusable frames stay on disk: no file is written, moved, renamed or sent to the OS Trash (P5 still matches), and Sessions' Trashed filter still reads 0. No Project-only reject is offered. No Project membership changes because the session has not been added.
- **Trace:** LIB-FR-20, LIB-FR-23 · PIX-FR-13, PIX-FR-14, PIX-FR-18, PIX-AC-20, PIX-AC-21 · D-W78, D-W79, D-W105, D-W118

### S7 — Create a Project prefilled from a session {#S7}

- **Do:** On the `2 Oct Ha` detail, point at **Create Project**, then click it. Name the Project `NGC 7000 HOO`, keep the prefilled subject and rig, choose the HOO goal template and click **Create Project**. Read the Project page's Sessions step, then choose **Add to Project** on `2 Oct Ha`. Open the `2 Oct Ha` detail, then Sessions' Not in any Project filter.
- **Expect:**
  - The button's tooltip reads `Prefilled with this Target and rig`, and the New Project sheet opens with subject NGC 7000 and rig `RedCat`.
  - The Project's Sessions step lists Ready RedCat sessions with confirmed Target NGC 7000 as suggestions. `2 Oct Ha` is suggested, not held automatically.
  - The Project initially holds no sessions. After **Add to Project** on `2 Oct Ha`, that session appears in its group. No other suggestion joins without the user adding it.
  - The `2 Oct Ha` detail lists `NGC 7000 HOO` as a Project that holds the session.
  - Sessions' Not in any Project filter reads 9 and lists every light session except `2 Oct Ha`.
- **Expect (negative):** Creating the Project adds no session automatically. No session's frames, marks or files change when the Project is created or the Ready session is added.
- **Trace:** LIB-FR-17 · PRJ-FR-01, PRJ-FR-02, PRJ-FR-08, PRJ-FR-09, PRJ-FR-12 · D-W94, D-W96, D-W105

### S8 — Add the other-camera session and its rig {#S8}

- **Do:** In Sessions, choose **Not in any Project**. On the other-camera session, open **Add to Project** and choose `NGC 7000 HOO`. Read the preview and click **Add session**.
- **Expect:**
  - The menu entry reads `NGC 7000 HOO` with `+ rig Esprit`.
  - The preview, titled `Add <session> to NGC 7000 HOO?`, lists `Adds rig Esprit` and the session it adds. It lists no subject change, because NGC 7000 is already a subject.
  - After **Add session**, a notice reads `Added <session> to NGC 7000 HOO`, with `Also adds the rig Esprit to NGC 7000 HOO.`
  - The Project's rigs are `RedCat` and `Esprit`. It holds the sessions the user added, while matching Ready sessions it does not hold remain suggestions.
  - Not in any Project reads 8. The status bar's ℹ counter menu names `Sessions · 8`, which still opens Sessions filtered to Not in any Project.
- **Expect (negative):** Adding a session changes no source file and never adds a subject unless the Project lacks that Target. The session joins only after the user chooses Add to Project.
- **Trace:** LIB-FR-17 · PRJ-FR-02, PRJ-FR-08 · D-W59, D-W94, D-W96, D-W105

### S9 — Finish intake review for `4 Oct Ha` {#S9}

- **Do:** Open `4 Oct Ha`'s intake Review step from Sessions. Select all 12 frames with ⌘A, press P, confirm, then choose **Finish review**.
- **Expect:** Review opens filtered to Unreviewed with 12 frames. P opens the bulk confirmation `Mark 12 frames Usable?`. After confirming, all 12 frames read Picked. **Finish review** makes the session Ready, and the Project suggests it because its confirmed Target and rig match and its calibration is settled.
- **Expect (negative):** No frame reads Picked before the confirmation is accepted. No Project-only reject is offered, and the Ready session is not added to the Project automatically.
- **Trace:** LIB-FR-20, LIB-FR-23 · PIX-FR-14, PIX-FR-18, PIX-AC-20, PIX-AC-21 · PRJ-FR-09 · D-W78, D-W79, D-W105, D-W118

### S10 — Add the other Ready sessions explicitly {#S10}

- **Do:** In Project `NGC 7000 HOO`'s Sessions step, choose **Add sessions…** and add `2 Oct OIII` and `4 Oct Ha`.
- **Expect:** Both sessions are Ready, have settled calibration, and are offered in the Project's suggestions. After the user adds them, the Project holds the four explicitly added sessions and still lists other matching Ready sessions as suggestions. Not in any Project reads 6.
- **Expect (negative):** Opening the suggestions adds no session. Sessions join only after the user adds them.
- **Trace:** LIB-FR-20, LIB-FR-23 · PRJ-FR-08, PRJ-FR-09 · VSEL-FR-03 · D-W94, D-W96, D-W105

### S11 — Verify custody {#S11}

- **Do:** Outside PlateVault, recompute the P5 manifest.
- **Expect:** Every path, size and SHA-256 matches P5, including the 12 `4 Oct Ha` lights under `unclassified/Ha/2026-10-04/light/`.
- **Expect (negative):** Confirming Targets and rigs, marking frames, creating the Project and adding sessions wrote, moved or trashed no file. No file is missing, duplicated or in the OS Trash, and the 3 Unusable frames are still on disk.
- **Trace:** root SC-002 · LIB-AC-02

## Success criteria

- SC1: At S1 the filters read exactly All 10, Needs a Target 1, Needs calibration 0, Not in any Project 9 and Trashed 0. The ℹ counter's menu names `Sessions · 9`, and the ⚠ counter reads 1 and its menu names `Sessions · 1`, not a list of issues.
- SC2: After S3, Needs a Target reads 0, and confirming the Target and rig changes zero source paths. 0 Targets were taken from an OBJECT label: `4 Oct Ha`'s picker opened with no Target chosen (S3), and no evidence list named OBJECT (S3, S5).
- SC3: After S6, `2 Oct Ha` reads 32 Usable, 3 Unusable and 0 Unreviewed frames, still 35 frames in all, and the Trashed filter reads 0.
- SC4: After S7, the Project holds only the Ready session the user explicitly added. After S8 and S10, it holds exactly four user-added sessions, lists rigs `RedCat` and `Esprit`, and keeps unadded matching Ready sessions as suggestions.
- SC5: After S9, `4 Oct Ha` reads 12 Picked frames and Ready. All three ⌘A marks (6 frames at S4, 32 at S6, 12 at S9) asked first, and 0 frames changed before the confirmation.
- SC6: At S10, both Ready sessions with settled calibration are added only after the user's action, and other matching Ready sessions remain suggestions.
- SC7: The S11 manifest equals P5 for 100% of files.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Behavior follows the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 6, `apps/prototype/` on ui-harness-v5 @ b5e813a5; the prototype at 4f470775 does not yet implement Round 6) and specs 064, 065 and 067. No implementation has been validated against it.
- G2: Unresolved implementation qualification: P1 chains J19 through S14 and J31 through S9, so it inherits their fixture tooling gaps (J19 G3, G5 and G9; J31 G2). P1 and P3 also add the calibration choices, Target confirmations and intake reviews the user made after J31, which no step here walks. Because P3 confirms every J19 Target, this journey's counts hold whatever the answer to J19 G11. No seeded-catalog builder exists that could reach P2 directly. Blocks readiness.
- G3: Unresolved implementation qualification: P2 assumes that the RedCat optics keywords of `2 Oct Ha` and `4 Oct Ha` associate rig `RedCat` without user action (LIB-FR-05). The v5 design does not state the equipment-matching rule for a session whose TELESCOP and FOCALLEN match an existing rig. Blocks readiness.
- G4: Out of scope for this journey, covered elsewhere: reopening a Ready session's Review and its labelled pending changes on open Projects (J22), moving Unusable frames to Trash during Wrap up (J44, J34), status-bar counters opening their owning pages (J38), Home's Open work and Next action (J32), creating rigs and filter lists (J15), first Apply and later View changes (J21, J24, J25), and a failed catalog write while confirming (J19/S11).
- G5: Out of scope for this journey: a Trashed session (Sessions' Trashed filter), reviewing a session whose location is offline, a confirmation made stale by a concurrent edit, and Create Project from a session with no Target, which opens unprefilled. Blocks readiness until covered by a step or a journey.
- G6: (dissolved 2026-10-16): D-W118 settles confirmation for every mark made on a ⌘A or threshold selection, regardless of count; single-frame and hand-picked marks never ask. S4 (6 frames), S6 (32 frames) and S9 (12 frames) assert ⌘A confirmation, and S6's three X marks require none. “Mark rest usable” also asks and names the count (owner's answer, 2026-10-19, astro-plan-rzbzu.1); no step in this journey uses that separate control.
- G7: (dissolved 2026-10-15): D-W94 and LIB-FR-12 make confirming a Target a change to the session's catalog association only, so no move review follows it. Imported files stay at the paths listed in the Import preview; this journey verifies that P5 remains unchanged (LIB-FR-12, STO-IMP-FR-02).
- G8: Rests on provisional F4 items, pending the owner's confirmation in PR #1804: D-W96's matching rule, which makes Ready RedCat sessions with Target NGC 7000 suggestions of `NGC 7000 HOO` (S7, S10), and D-W94's rig list that only decides suggestions (S8). If the owner changes one, the steps that cite it change.

## Delta log

- **Δ2** 2026-10-12 · S1, S2, S3, S4, S5, S6, S9, S11 · behavior-change
  Imports confirm Targets in the preview, so only `4 Oct Ha` arrives Unclassified. S3 files it under NGC 7000 with one reviewed move, S4 confirms only `2 Oct OIII`'s rig, and S5 confirms the association of `30 Sep`, which was indexed in place. `2 Oct Ha` arrives Confirmed.
  X marks a frame Unusable in the library and leaves its file on disk. ⌘A marks ask `Mark N frames Usable?` (S6, S9). Adds G6 and G7.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "P-IMP2: confirm Targets in the Import preview", "Confirming a Target the pointing disagrees with", "Reject is library-wide by default", "Large bulk marks need confirmation" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6A (intent-gated)
- **Δ3** 2026-10-15 · S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11 · behavior-change
  Import never waits for calibration: only Ready sessions with settled calibration can be added. Frame review is the session intake step, and Finish review makes a fully reviewed session Ready. Project membership is explicit, matching sessions remain suggestions, and confirming a Target never moves imported files, so S3 confirms a Target and rig with no move and SC7 expects no changed path. The status bar counters open their Sessions filters, S2 reads Home's Pending work, and Not in any Project reads 9, 8 and 6 as the user adds sessions at S7, S8 and S10.
  Evidence: D-W89, D-W92, D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 064 LIB-FR-17, LIB-FR-20, LIB-FR-23, LIB-FR-24, 065 PRJ-FR-08, PRJ-FR-09, 066 VSEL-FR-03, 067 PIX-FR-18, 068 CAL-FR-02, CAL-FR-09 · by: SpecF4Writer2 (intent-gated)
- **Δ4** 2026-10-16 · S4, S6, S9 · behavior-change
  Every mark on a ⌘A selection asks first, whatever its count: S4 reads `Mark 6 frames Usable?`, S6 `Mark 32 frames Usable?` and S9 `Mark 12 frames Usable?`, and single-frame marks never ask. G6 is dissolved.
  Evidence: D-W118 (owner's second batch of 2026-10-16) in PR #1804, PIX-FR-14, PIX-AC-21 · by: EncodeOwnerAnswers2 (intent-gated)
- **Δ5** 2026-10-26 · S1, SC1 · behavior-change
  A counter with one issue opens the same menu of owning pages as a counter with several, so the ⚠ counter's menu names `Sessions · 1`.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 11 (OWNER, 2026-10-23) on ui-harness-v5 @ 5dc245244; D-W144, FR-032 · by: SpecAmend (intent-gated)
- **Δ7** 2026-10-27 · G6 · behavior-change
  D-W118's ⌘A and threshold-selection distinction is settled and J37's steps assert it. The separate Mark rest usable answer applies to another flow; no J37 step invokes that control.
  Evidence: D-W118, PIX-FR-14, PIX-AC-21 · astro-plan-rzbzu owner answer 2026-10-16; astro-plan-rzbzu.1 answer 2026-10-19 · by: SpecOwner2 (intent-gated)
