---
id: J37
title: Confirm, cull and place a new night's sessions after an import
version: 2
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [status-bar, issues, home, sessions, frame-review, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 067-frame-review, LIB-FR-05, LIB-FR-17, PRJ-FR-19, PIX-FR-18, D-W14, D-W25, D-W30, D-W33, D-W34, D-W37, D-W39, D-W42, D-W59, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/067-frame-review/spec.md, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S4, HARNESS-V5-IA.md#S6, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-FEEDBACK-R1.md#screens-slices, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, HIGH-LEVEL-DESIGN.md#glossary, P-SB3, P-IMP2, apps/prototype/src/features/v5/a-home/home.tsx, apps/prototype/src/features/v5/a-home/sessions.tsx, apps/prototype/src/features/v5/a-home/session.tsx, apps/prototype/src/features/v5/a-home/parts.tsx, apps/prototype/src/domain/issues.ts]
---

## Goal

After an import, the user works through the new night's sessions from the
status bar, Home's Sessions box and Sessions. The import already confirmed
the Targets chosen in its preview (J31), so the Target work here is a
session the import left Unclassified, filed under its Target with one
reviewed move, and a session indexed in place whose Target was only
Associated. Each session needs a settled Target and rig, and its frames are
culled with library marks: X marks a frame Unusable in the library, and a
large bulk mark asks first. Each session must also sit in a Project's
candidates. The user creates the Project from a session, prefilled, and adds
a session from another rig to it. OBJECT never decides a Target, and nothing
on disk changes except the one reviewed move. Done means:

- Sessions' Needs a Target and Not in any Project filters both read 0, and the status bar shows no ⚠ counter and no not-in-a-Project issue.
- Each of the 10 light sessions has a Target and a rig, Confirmed by the user or Associated from its pointing and optics keywords, and is a candidate of `NGC 7000 HOO`.
- `2 Oct Ha` reads 32 Usable and 3 Unusable frames, and `4 Oct Ha` reads 12 Picked, with every mark at library scope.
- `NGC 7000 HOO` has rigs `RedCat` and `Esprit`, 10 candidates and no run.
- Every file under the registered locations is byte-identical to the pre-run manifest, and only the 12 `4 Oct Ha` lights changed folder, from `unclassified/Ha/2026-10-04/light/` to `NGC 7000/Ha/2026-10-04/light/`.

## Preconditions

- P1: J31 completed through S9. `Astro-T7 captures`, `Cold-1 captures` and `Astro-T7 calibration` are registered and online. Rigs `RedCat` (RedCat 51 + ASI2600MM) and `Esprit` (Esprit 100 + ASI533MC) exist, detected by indexing and renamed at J19/S9b. No Project and no processing run exist. No `NGC 7000/Ha/2026-10-04/` folder exists.
- P2: The catalog holds 10 light sessions:

  | Session | Frames | Target | Rig | OBJECT | Pointing |
  | --- | --- | --- | --- | --- | --- |
  | 12, 18, 24, 26, 28 and 30 Sep (J19) | 24, 55, 20, 35, 56, 48 | NGC 7000: 24 and 26 Sep Confirmed, the rest Associated (J19/S10) | `RedCat` Confirmed (J19/S10) | as J19/P2, P3 | as J19/P2, P3 |
  | other camera (J19) | 40 | NGC 7000 Associated | `Esprit` Confirmed (J19/S11) | NGC 7000 | within NGC 7000's footprint |
  | `2 Oct Ha` (J31/S6, S8) | 35 | NGC 7000 Confirmed in the Import preview, prefilled from its pointing (J31/S3, S6) | `RedCat` Associated from its optics keywords (G3) | `NGC 7000` | within NGC 7000's footprint |
  | `2 Oct OIII` (J31/S5a, S6) | 6 | NGC 7000 Confirmed in the Import preview (J31/S5a) | Needs review: no TELESCOP or FOCALLEN | none | none |
  | `4 Oct Ha` (J31/S9) | 12 | none: Unclassified at import, its frames under `unclassified/Ha/2026-10-04/light/` in `Astro-T7 captures` | `RedCat` Associated from its optics keywords (G3) | `NGC7000` | none |

- P3: Every frame reads Unreviewed. Among the `2 Oct Ha` frames, `Light_Ha_0005.fits`, `Light_Ha_0017.fits` and `Light_Ha_0023.fits` are clouded (J31/P2).
- P4: No location is offline or unreadable, no work has failed or been interrupted, and no frame or master has drifted. Raw calibration processes from J19/S7a and J31/S6 wait to stack.
- P5: A manifest (relative path, size, SHA-256) of every file under the three registered locations, recorded outside PlateVault before S1.

## Steps

### S1 — Start from the status bar {#S1}

- **Do:** Read the status bar. Open its ⚠ counter, then its ℹ counter. Follow `1 needs a Target`.
- **Expect:** The status bar shows the ⚠ warnings and ℹ info counters and no ⛔ errors counter. The ⚠ popout lists exactly one issue, `1 needs a Target`. The ℹ popout lists `9 not in a Project` and the calibration processes waiting to stack, each with its action. The toolbar's Issues hub lists the same two Sessions issues with the same counts. Following `1 needs a Target` opens Sessions filtered to **Needs a Target**. The filters read All 10, Needs a Target 1, Not in any Project 9 and Trashed 0, and the list shows exactly `4 Oct Ha`.
- **Expect (negative):** Opening a popout or following an issue changes no session, Target, rig or Project. Neither `2 Oct Ha` nor `2 Oct OIII` is listed under Needs a Target, because their Targets were confirmed at import.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3) · HARNESS-V5-IA.md §Round 2b (Status bar, `Issue.kind`), §Screens S12 · LIB-FR-17 · D-W25, D-W33

### S2 — Read Home's Sessions box {#S2}

- **Do:** Open Home and read its Sessions box.
- **Expect:** The Needs a Target group reads 1. It lists `4 Oct Ha` with `OBJECT NGC7000` and offers **Choose Target**. The Not in any Project group reads 9, and each of its rows offers **Add to Project**. Unreviewed and Ready to add read `None`, because no Project exists.
- **Expect (negative):** `4 Oct Ha` is not offered `Confirm NGC 7000` or any other Target suggested from its OBJECT. Home shows no issues strip or top line.
- **Trace:** HARNESS-V5-IA.md §Screens S1 (Sessions box) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (Home has no issues strip; OBJECT is a label, never evidence) · PRJ-FR-19 · D-W33, D-W39

### S3 — File the Unclassified session under its Target with one reviewed move {#S3}

- **Do:** On `4 Oct Ha`, click **Choose Target**. In its Target box, choose NGC 7000 and click **Confirm Target**. Read the review of the move that files the session, then confirm it.
- **Expect:**
  - The session detail opens at its Target box, which reads `Unsettled`. Its Target evidence lists the pointing as `No pointing in header`, and its header line shows `OBJECT NGC7000` as a label. The Target picker opens on `Choose a Target`, with no Target chosen.
  - The review lists one move of the session's 12 lights from `unclassified/Ha/2026-10-04/light/` to `NGC 7000/Ha/2026-10-04/light/` in `Astro-T7 captures`, with their basenames unchanged.
  - After the move is confirmed, the Target box reads NGC 7000 Confirmed and shows `Target: NGC 7000`. The label still reads `OBJECT NGC7000`. The 12 files sit under `NGC 7000/Ha/2026-10-04/light/` with their P5 sizes and SHA-256, and `unclassified/Ha/2026-10-04/light/` holds none of them.
  - The filters read Needs a Target 0, which shows `None need a Target`, and Not in any Project 10. The status bar's ⚠ counter is gone, and its ℹ popout lists `10 not in a Project`.
- **Expect (negative):** The OBJECT label is not listed as Target evidence, is not preselected and does not count towards the confirmation. No file moves before the move is confirmed (P5 still matches while the review is open). The move copies nothing, leaves no second copy, sends nothing to the OS Trash and writes no header. The session joins no Project and no run.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 (OBJECT is a label, never evidence), §Round 6 (P-IMP2: Unclassified sessions go to an Unclassified folder and can be filed later with one reviewed move) · HARNESS-V5-IA.md §Screens S12 (session detail, Confirm Target) · HIGH-LEVEL-DESIGN.md §10 Glossary (OBJECT) · LIB-FR-05, LIB-FR-17 · G7

### S4 — Confirm a rig from Sessions {#S4}

- **Do:** In Sessions, choose **Not in any Project**. Right-click `2 Oct OIII` and choose **Confirm rig**. In the Rig box, choose `RedCat` and click **Confirm rig**.
- **Expect:** Before the confirmation, the `2 Oct OIII` row reads `Rig needs review` in its Rig column, the detail's Rig box reads `Unsettled`, and its Target box reads NGC 7000 Confirmed from the import. Afterwards, the Rig box reads `RedCat` Confirmed. The filters still read Needs a Target 0 and Not in any Project 10.
- **Expect (negative):** Confirming changes no frame count, header or file, and no move is offered. `2 Oct OIII` joins no Project.
- **Trace:** HARNESS-V5-IA.md §Screens S12 (row actions: Confirm rig) · LIB-FR-05 · D-W37

### S5 — Confirm the pointing association of a session indexed in place {#S5}

- **Do:** Open `30 Sep`. Read its Target and Rig boxes and its Projects and Runs boxes. Click **Confirm Target**, keeping the preselected NGC 7000.
- **Expect:** Before confirming, the Target box reads NGC 7000 Associated. Its evidence lists the pointing as `<angle> from NGC 7000 centre`, and the header line shows `OBJECT NGC 7000` as a label. The Rig box reads `RedCat` Confirmed (J19/S10). The Target picker preselects NGC 7000 from the pointing. The Projects box reads `None`, and the Runs box reads 0. After confirming, the Target box reads NGC 7000 Confirmed. Not in any Project still reads 10.
- **Expect (negative):** Confirming an Associated Target changes no filter count and no candidate state. No evidence list names OBJECT. No mismatch warning appears, because the pointing lies within NGC 7000's footprint. The session's 48 frames stay at their J19 paths, and no move is offered.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 (association uses pointing within the Target's footprint and the user's confirmation only), §Round 6 (Confirming a Target the pointing disagrees with shows a mismatch warning) · HARNESS-V5-IA.md §Screens S12 · LIB-FR-05

### S6 — Cull the new night's frames with library marks {#S6}

- **Do:** In Sessions, click **Review** on the `2 Oct Ha` row. Mark `Light_Ha_0005.fits`, `Light_Ha_0017.fits` and `Light_Ha_0023.fits` with X, one at a time. Select every remaining Unreviewed frame shown with ⌘A, then press P, read the confirmation and confirm it. Switch to the session's Detail tab.
- **Expect:**
  - The session opens on its Review tab (`?view=review`), filtered to Unreviewed, with 35 frames. The Review tab's badge reads 35.
  - Each X marks its frame Unusable in the library at once, without a confirmation.
  - Pressing P on the 32 selected frames opens a confirmation in the form of Round 6's "Mark 120 frames Unusable?", reading `Mark 32 frames Usable?`. After confirming, the three X frames read Rejected and the rest read Picked, and the review counts 32 Picked, 3 Rejected and 0 Unreviewed.
  - On Detail, the frames table reads 32 Usable and 3 Unusable, the Review tab has no badge, and the session still reads 35 frames.
- **Expect (negative):** While the bulk confirmation is open, the 32 frames still read Unreviewed. The marks change library quality only. The 3 Unusable frames stay on disk: no file is written, moved, renamed or sent to the OS Trash (P5 still matches), and Sessions' Trashed filter still reads 0. No **Reject for this Project** choice is offered, because this review works at library scope with no Project. No run membership exists or changes.
- **Trace:** HARNESS-V5-IA.md §Screens S6 (two-level quality), S12 (Review, library marks only) · HARNESS-V5-FEEDBACK-R1.md §Screens D (session context), §Round 6 (Reject is library-wide by default; Large bulk marks need confirmation) · PIX-FR-18 · D-W14, D-W42 · G6

### S7 — Create a Project prefilled from a session {#S7}

- **Do:** On the `2 Oct Ha` detail, point at **Create Project**, then click it. Name the Project `NGC 7000 HOO`, keep the prefilled subject and rig, choose the HOO goal template and click **Create Project**. Open the Project page, then the `2 Oct Ha` detail.
- **Expect:**
  - The button's tooltip reads `Prefilled with this Target and rig`, and the New Project sheet opens with subject NGC 7000 and rig `RedCat`.
  - The Project's Candidates list exactly the nine sessions with Target NGC 7000 on rig `RedCat`: 12, 18, 24, 26, 28 and 30 Sep, `2 Oct Ha`, `2 Oct OIII` and `4 Oct Ha`. The other-camera session is not a candidate.
  - The Project's Runs section is empty.
  - The `2 Oct Ha` detail's Projects box lists `NGC 7000 HOO` as Candidate.
  - Sessions' Not in any Project filter reads 1 and lists only the other-camera session.
- **Expect (negative):** Creating the Project creates no run and assigns no session to a run. No session's frames, marks or files change.
- **Trace:** HARNESS-V5-IA.md §Screens S3 (Candidates), S4 (a session prefills its Target and rig), S12 (Create Project prefilled) · PRJ-FR-19 · D-W30, D-W33, D-W34, D-W37

### S8 — Add the other-camera session and its rig {#S8}

- **Do:** In Sessions, choose **Not in any Project**. On the other-camera session, open **Add to Project** and choose `NGC 7000 HOO`. Read the preview and click **Add session**.
- **Expect:**
  - The menu entry reads `NGC 7000 HOO` with `+ rig Esprit`.
  - The preview, titled `Add <session> to NGC 7000 HOO?`, lists `Adds rig Esprit` and `<session> becomes a candidate`. It lists no subject change, because NGC 7000 is already a subject.
  - After **Add session**, a notice reads `Added <session> to NGC 7000 HOO`, with `Also adds the rig Esprit to NGC 7000 HOO.`
  - The Project's rigs are `RedCat` and `Esprit`, and it has 10 candidates.
  - Not in any Project reads 0 and shows `All in a Project`. The status bar's ℹ popout no longer lists a not-in-a-Project issue.
- **Expect (negative):** Add to Project creates no run, assigns no session to a run and adds no subject. No file changes.
- **Trace:** HARNESS-V5-IA.md §Screens S12 (Add to Project also adds the rig, with a visible note) · PRJ-FR-19 · D-W59

### S9 — Review an Unreviewed candidate in a sheet over Home {#S9}

- **Do:** Open Home. In the Sessions box's Unreviewed group, click **Review** on `4 Oct Ha`. Select all 12 frames with ⌘A, press P, confirm, and close the sheet.
- **Expect:** Before the review, Unreviewed reads 9: the Project's candidates with Unreviewed frames, each with its count and `NGC 7000 HOO`. `2 Oct Ha` is not among them. The review opens in a sheet over Home (`?review=<sessionId>`), filtered to Unreviewed, with 12 frames and an **Open session** link. P opens the bulk confirmation `Mark 12 frames Usable?`. After confirming, all 12 frames read Picked. After the sheet closes, Home shows the same boxes, and Unreviewed reads 8.
- **Expect (negative):** No frame reads Picked before the confirmation is accepted. No **Reject for this Project** choice is offered in this library-scope sheet, and no run membership changes. Closing the sheet leaves the user on Home.
- **Trace:** HARNESS-V5-IA.md §Screens S1 (an Unreviewed session is reviewed in a sheet over Home, library marks only) · HARNESS-V5-FEEDBACK-R1.md §Screens A (Home: Unreviewed sessions offer Review frames in place), §Round 6 (Large bulk marks need confirmation) · PIX-FR-18 · D-W14 · G6

### S10 — Read Ready to add {#S10}

- **Do:** In Home's Sessions box, read the Ready to add group.
- **Expect:** Ready to add reads 10, the Project's candidates that none of its runs holds. Each row names `NGC 7000 HOO` and offers **Start run**, because the Project has no run.
- **Expect (negative):** Reading Ready to add creates no run, and no session joins a run.
- **Trace:** HARNESS-V5-IA.md §Screens S1 (Sessions box: ready to add to a run) · PRJ-FR-19 · D-W34, D-W39

### S11 — Verify custody {#S11}

- **Do:** Outside PlateVault, recompute the P5 manifest.
- **Expect:** Every path, size and SHA-256 matches P5, except that the 12 `4 Oct Ha` lights now sit under `NGC 7000/Ha/2026-10-04/light/` instead of `unclassified/Ha/2026-10-04/light/`, each with its P5 basename, size and SHA-256.
- **Expect (negative):** Apart from the S3 move, confirming Targets and rigs, marking frames, creating the Project and adding sessions wrote, moved or trashed no file. No file is missing, duplicated or in the OS Trash, and the 3 Unusable frames are still on disk.
- **Trace:** root SC-002 · LIB-AC-02

## Success criteria

- SC1: At S1 the filters read exactly All 10, Needs a Target 1, Not in any Project 9 and Trashed 0, and the ⚠ popout lists exactly 1 issue, `1 needs a Target`.
- SC2: After S3, Needs a Target reads 0, and exactly 1 reviewed move has filed 12 files. 0 Targets were taken from an OBJECT label: `4 Oct Ha`'s picker opened with no Target chosen (S3), and no evidence list named OBJECT (S3, S5).
- SC3: After S6, `2 Oct Ha` reads 32 Usable, 3 Unusable and 0 Unreviewed frames, still 35 frames in all, and the Trashed filter reads 0.
- SC4: After S7, `NGC 7000 HOO` has exactly 9 candidates and 0 runs. After S8, it has 10 candidates, rigs `RedCat` and `Esprit` and 0 runs, and Not in any Project reads 0.
- SC5: After S9, `4 Oct Ha` reads 12 Picked frames, and Home's Unreviewed group reads 8. Both ⌘A marks (32 frames at S6, 12 at S9) asked first, and 0 frames changed before the confirmation.
- SC6: At S10, Ready to add reads 10 and 0 runs exist.
- SC7: The S11 manifest equals P5 for 100% of files, apart from the 12 `4 Oct Ha` paths that S3 moved, whose sizes and SHA-256 are unchanged.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Behavior follows the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 6, `apps/prototype/` on ui-harness-v5 @ b5e813a5; the prototype at 4f470775 does not yet implement Round 6) and specs 064, 065 and 067. No implementation has been validated against it.
- G2: Unresolved implementation qualification: P1 chains J19 through S14 and J31 through S9, so it inherits their fixture tooling gaps (J19 G3, G5 and G9; J31 G2). No seeded-catalog builder exists that could reach P2 directly. Blocks readiness.
- G3: Unresolved implementation qualification: P2 assumes that the RedCat optics keywords of `2 Oct Ha` and `4 Oct Ha` associate rig `RedCat` without user action (LIB-FR-05). The v5 design does not state the equipment-matching rule for a session whose TELESCOP and FOCALLEN match an existing rig. Blocks readiness.
- G4: Out of scope for this journey, covered elsewhere: run-scoped frame review and **Reject for this Project** (J22), Unusable frames as purge candidates that a library clean-up and Wrap up offer to move to the OS Trash (J44, J34), the Issues hub's grouping and actions (J38), Home's Projects box and Next actions (J32), creating rigs and filter lists (J15), starting a run and adding Ready to add sessions to it (J14, J21, J25), and a failed catalog write while confirming (J19/S11).
- G5: Out of scope for this journey: a Trashed session (Sessions' Trashed filter), reviewing a session whose location is offline, a confirmation made stale by a concurrent edit, Create Project from a session with no Target, which opens unprefilled, and canceling the S3 move review. Blocks readiness until covered by a step or a journey.
- G6: Unresolved product question, shared with J22 G8: Round 6 asks for confirmation on large bulk marks ("Mark 120 frames Unusable?") but sets no size. S6 (32 frames) and S9 (12 frames) assert a confirmation, which holds under option (a) or (c). Options: (a, recommended) every mark on a ⌘A selection asks, whatever its count; (b) a fixed count, which may leave S9's 12 frames unconfirmed; (c) every mark on more than one frame. Single-frame marks never ask. Blocks readiness.
- G7: Unresolved product question: P-IMP2 says an Unclassified session "can be filed later with one reviewed move" but not whether Confirm Target and the move are one action. Options: (a, recommended) one action: confirming a Target for an Unclassified session opens the move review, and canceling it leaves the session Unclassified, so a session's folder never disagrees with its Target; (b) two actions: Confirm Target settles the Target at once, and the session then offers a separate filing move, so a Confirmed session can stay under `unclassified/` until it is filed. S3 asserts only the state before Confirm Target and after the confirmed move. Blocks readiness.

## Delta log

- **Δ2** 2026-10-12 · S1, S2, S3, S4, S5, S6, S9, S11 · behavior-change
  Imports confirm Targets in the preview, so only `4 Oct Ha` arrives Unclassified. S3 files it under NGC 7000 with one reviewed move, S4 confirms only `2 Oct OIII`'s rig, and S5 confirms the association of `30 Sep`, which was indexed in place. `2 Oct Ha` arrives Confirmed.
  X marks a frame Unusable in the library and leaves its file on disk. ⌘A marks ask `Mark N frames Usable?` (S6, S9). Adds G6 and G7.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "P-IMP2: confirm Targets in the Import preview", "Confirming a Target the pointing disagrees with", "Reject is library-wide by default", "Large bulk marks need confirmation" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6A (intent-gated)
