---
id: J37
title: Confirm, cull and place a new night's sessions after an import
version: 1
status: draft
last_reviewed: 2026-10-12
actors: [primary-user]
surfaces: [status-bar, issues, home, sessions, frame-review, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 067-frame-review, LIB-FR-05, LIB-FR-17, PRJ-FR-19, PIX-FR-18, D-W14, D-W25, D-W30, D-W33, D-W34, D-W37, D-W39, D-W42, D-W59, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/067-frame-review/spec.md, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S4, HARNESS-V5-IA.md#S6, HARNESS-V5-IA.md#S12, HARNESS-V5-IA.md#round-2b-foundation, HARNESS-V5-FEEDBACK-R1.md#screens-slices, HARNESS-V5-FEEDBACK-R1.md#round-5, HIGH-LEVEL-DESIGN.md#glossary, P-SB3, apps/prototype/src/features/v5/a-home/home.tsx, apps/prototype/src/features/v5/a-home/sessions.tsx, apps/prototype/src/features/v5/a-home/session.tsx, apps/prototype/src/features/v5/a-home/parts.tsx, apps/prototype/src/domain/issues.ts]
---

## Goal

After an import, the user works through the new night's sessions from the
status bar, Home's Sessions box and Sessions. Each session needs a settled
Target and rig, and its frames are culled with library marks. Each session
must also sit in a Project's candidates. The user creates the Project from a
session, prefilled, and adds a session from another rig to it. OBJECT never
decides a Target, and nothing on disk changes. Done means:

- Sessions' Needs a Target and Not in any Project filters both read 0, and the status bar shows no ⚠ counter and no not-in-a-Project issue.
- Each of the 10 light sessions has a Target and a rig, Confirmed by the user or Associated from its pointing and optics keywords, and is a candidate of `NGC 7000 HOO`.
- `2 Oct Ha` reads 32 Usable and 3 Unusable frames, and `4 Oct Ha` reads 12 Picked, with every mark at library scope.
- `NGC 7000 HOO` has rigs `RedCat` and `Esprit`, 10 candidates and no run.
- Every file under the registered locations is byte-identical to the pre-run manifest.

## Preconditions

- P1: J31 completed through S9. `Astro-T7 captures`, `Cold-1 captures` and `Astro-T7 calibration` are registered and online. Rigs `RedCat` (RedCat 51 + ASI2600MM) and `Esprit` (Esprit 100 + ASI533MC) exist, as J15/S3 and S3a create them (J19 G2). No Project and no processing run exist.
- P2: The catalog holds 10 light sessions:

  | Session | Frames | Target | Rig | OBJECT | Pointing |
  | --- | --- | --- | --- | --- | --- |
  | 12, 18, 24, 26, 28 and 30 Sep (J19) | 24, 55, 20, 35, 56, 48 | NGC 7000: 24 and 26 Sep Confirmed, the rest Associated (J19/S10) | `RedCat` Confirmed (J19/S10) | as J19/P2, P3 | as J19/P2, P3 |
  | other camera (J19) | 40 | NGC 7000 Associated | `Esprit` Confirmed (J19/S11) | NGC 7000 | within NGC 7000's footprint |
  | `2 Oct Ha` (J31/S6, S8) | 35 | NGC 7000 Associated | `RedCat` Associated from its optics keywords (G3) | `NGC 7000` | within NGC 7000's footprint |
  | `2 Oct OIII` (J31/S6) | 6 | none | Needs review: no TELESCOP or FOCALLEN | none | none |
  | `4 Oct Ha` (J31/S9) | 12 | none | `RedCat` Associated from its optics keywords (G3) | `NGC7000` | none |

- P3: Every frame reads Unreviewed. Among the `2 Oct Ha` frames, `Light_Ha_0005.fits`, `Light_Ha_0017.fits` and `Light_Ha_0023.fits` are clouded (J31/P2).
- P4: No location is offline or unreadable, no work has failed or been interrupted, and no frame or master has drifted. Raw calibration processes from J19/S7a and J31/S6 wait to stack.
- P5: A manifest (relative path, size, SHA-256) of every file under the three registered locations, recorded outside PlateVault before S1.

## Steps

### S1 — Start from the status bar {#S1}

- **Do:** Read the status bar. Open its ⚠ counter, then its ℹ counter. Follow `2 need a Target`.
- **Expect:** The status bar shows the ⚠ warnings and ℹ info counters and no ⛔ errors counter. The ⚠ popout lists exactly one issue, `2 need a Target`. The ℹ popout lists `8 not in a Project` and the calibration processes waiting to stack, each with its action. The toolbar's Issues hub lists the same two Sessions issues with the same counts. Following `2 need a Target` opens Sessions filtered to **Needs a Target**. The filters read All 10, Needs a Target 2, Not in any Project 8 and Trashed 0, and the list shows exactly `2 Oct OIII` and `4 Oct Ha`.
- **Expect (negative):** Opening a popout or following an issue changes no session, Target, rig or Project.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 (P-SB3) · HARNESS-V5-IA.md §Round 2b (Status bar, `Issue.kind`), §Screens S12 · LIB-FR-17 · D-W25, D-W33

### S2 — Read Home's Sessions box {#S2}

- **Do:** Open Home and read its Sessions box.
- **Expect:** The Needs a Target group reads 2. It lists `2 Oct OIII` with `No OBJECT` and `4 Oct Ha` with `OBJECT NGC7000`, and each row offers **Choose Target**. The Not in any Project group reads 8, and each of its rows offers **Add to Project**. Unreviewed and Ready to add read `None`, because no Project exists.
- **Expect (negative):** `4 Oct Ha` is not offered `Confirm NGC 7000` or any other Target suggested from its OBJECT. Home shows no issues strip or top line.
- **Trace:** HARNESS-V5-IA.md §Screens S1 (Sessions box) · HARNESS-V5-FEEDBACK-R1.md §Round 5 (Home has no issues strip; OBJECT is a label, never evidence) · PRJ-FR-19 · D-W33, D-W39

### S3 — Choose a Target for a session with only an OBJECT label {#S3}

- **Do:** On `4 Oct Ha`, click **Choose Target**. In its Target box, choose NGC 7000 and click **Confirm Target**.
- **Expect:** The session detail opens at its Target box, which reads `Unsettled`. Its Target evidence lists the pointing as `No pointing in header`, and its header line shows `OBJECT NGC7000` as a label. The Target picker opens on `Choose a Target`, with no Target chosen. After Confirm Target, the box reads NGC 7000 Confirmed and shows `Target: NGC 7000`. The label still reads `OBJECT NGC7000`. Needs a Target now reads 1, and Not in any Project reads 9.
- **Expect (negative):** The OBJECT label is not listed as Target evidence, is not preselected and does not count towards the confirmation. No header is written (P5 still matches). The session joins no Project and no run.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 (OBJECT is a label, never evidence) · HARNESS-V5-IA.md §Screens S12 (session detail, Confirm Target) · HIGH-LEVEL-DESIGN.md §10 Glossary (OBJECT) · LIB-FR-05, LIB-FR-17

### S4 — Choose a Target and confirm a rig from Sessions {#S4}

- **Do:** In Sessions, choose **Needs a Target**. Right-click `2 Oct OIII` and choose **Choose Target**. Choose NGC 7000 and click **Confirm Target**. In the Rig box, choose `RedCat` and click **Confirm rig**.
- **Expect:** Before the confirmations, the `2 Oct OIII` row reads `Rig needs review` in its Rig column, and the detail's Rig box reads `Unsettled`. Afterwards, the Target box reads NGC 7000 Confirmed and the Rig box reads `RedCat` Confirmed. The filters read Needs a Target 0, which shows `None need a Target`, and Not in any Project 10. The status bar's ⚠ counter is gone, and its ℹ popout lists `10 not in a Project`.
- **Expect (negative):** Confirming changes no frame count, header or file. `2 Oct OIII` joins no Project.
- **Trace:** HARNESS-V5-IA.md §Screens S12 (row actions: Choose Target; Confirm rig) · LIB-FR-05 · D-W37

### S5 — Confirm the new night's pointing association {#S5}

- **Do:** Open `2 Oct Ha`. Read its Target and Rig boxes and its Projects and Runs boxes. Click **Confirm Target**, then **Confirm rig**, keeping the preselected NGC 7000 and `RedCat`.
- **Expect:** Before confirming, the Target box reads NGC 7000 Associated. Its evidence lists the pointing as `<angle> from NGC 7000 centre`, and the header line shows `OBJECT NGC 7000` as a label. The Rig box reads `RedCat` Associated. The Target picker preselects NGC 7000 from the pointing. The Projects box reads `None`, and the Runs box reads 0. After confirming, both boxes read Confirmed. Not in any Project still reads 10.
- **Expect (negative):** Confirming an Associated Target changes no filter count and no candidate state. No evidence list names OBJECT.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md §Round 5 (association uses pointing within the Target's footprint and the user's confirmation only) · HARNESS-V5-IA.md §Screens S12 · LIB-FR-05

### S6 — Cull the new night's frames with library marks {#S6}

- **Do:** In Sessions, click **Review** on the `2 Oct Ha` row. Mark `Light_Ha_0005.fits`, `Light_Ha_0017.fits` and `Light_Ha_0023.fits` with X. Select every remaining Unreviewed frame shown with ⌘A, then press P. Switch to the session's Detail tab.
- **Expect:** The session opens on its Review tab (`?view=review`), filtered to Unreviewed, with 35 frames. The Review tab's badge reads 35. The three X frames read Rejected and the rest read Picked, and the review counts 32 Picked, 3 Rejected and 0 Unreviewed. On Detail, the frames table reads 32 Usable and 3 Unusable, the Review tab has no badge, and the session still reads 35 frames.
- **Expect (negative):** The marks change library quality only. No file is written, moved, renamed or sent to the OS Trash (P5 still matches), and Sessions' Trashed filter still reads 0. No **Reject for this Project** choice is offered, because this review works at library scope. No run membership exists or changes.
- **Trace:** HARNESS-V5-IA.md §Screens S6 (two-level quality), S12 (Review, library marks only) · HARNESS-V5-FEEDBACK-R1.md §Screens D (session context) · PIX-FR-18 · D-W14, D-W42

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

- **Do:** Open Home. In the Sessions box's Unreviewed group, click **Review** on `4 Oct Ha`. Select all 12 frames with ⌘A, press P and close the sheet.
- **Expect:** Before the review, Unreviewed reads 9: the Project's candidates with Unreviewed frames, each with its count and `NGC 7000 HOO`. `2 Oct Ha` is not among them. The review opens in a sheet over Home (`?review=<sessionId>`), filtered to Unreviewed, with 12 frames and an **Open session** link. After P, all 12 frames read Picked. After the sheet closes, Home shows the same boxes, and Unreviewed reads 8.
- **Expect (negative):** No **Reject for this Project** choice is offered, and no run membership changes. Closing the sheet leaves the user on Home.
- **Trace:** HARNESS-V5-IA.md §Screens S1 (an Unreviewed session is reviewed in a sheet over Home, library marks only) · HARNESS-V5-FEEDBACK-R1.md §Screens A (Home: Unreviewed sessions offer Review frames in place) · PIX-FR-18 · D-W14

### S10 — Read Ready to add {#S10}

- **Do:** In Home's Sessions box, read the Ready to add group.
- **Expect:** Ready to add reads 10, the Project's candidates that none of its runs holds. Each row names `NGC 7000 HOO` and offers **Start run**, because the Project has no run.
- **Expect (negative):** Reading Ready to add creates no run, and no session joins a run.
- **Trace:** HARNESS-V5-IA.md §Screens S1 (Sessions box: ready to add to a run) · PRJ-FR-19 · D-W34, D-W39

### S11 — Verify custody {#S11}

- **Do:** Outside PlateVault, recompute the P5 manifest.
- **Expect:** Every path, size and SHA-256 matches P5.
- **Expect (negative):** Confirming Targets and rigs, marking frames, creating the Project and adding sessions wrote, moved or trashed no file.
- **Trace:** root SC-002 · LIB-AC-02

## Success criteria

- SC1: At S1 the filters read exactly All 10, Needs a Target 2, Not in any Project 8 and Trashed 0, and the ⚠ popout lists exactly 1 issue, `2 need a Target`.
- SC2: After S4, Needs a Target reads 0. 0 Targets were taken from an OBJECT label: `4 Oct Ha`'s picker opened with no Target chosen (S3), and no evidence list named OBJECT (S3, S5).
- SC3: After S6, `2 Oct Ha` reads 32 Usable, 3 Unusable and 0 Unreviewed frames, still 35 frames in all, and the Trashed filter reads 0.
- SC4: After S7, `NGC 7000 HOO` has exactly 9 candidates and 0 runs. After S8, it has 10 candidates, rigs `RedCat` and `Esprit` and 0 runs, and Not in any Project reads 0.
- SC5: After S9, `4 Oct Ha` reads 12 Picked frames, and Home's Unreviewed group reads 8.
- SC6: At S10, Ready to add reads 10 and 0 runs exist.
- SC7: The S11 manifest equals P5 for 100% of files.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Behavior follows the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 5, `apps/prototype/` on ui-harness-v5 @ b5e813a5) and specs 064, 065 and 067. No implementation has been validated against it.
- G2: Unresolved implementation qualification: P1 chains J19 through S14 and J31 through S9, so it inherits their fixture tooling gaps (J19 G2, G3 and G5; J31 G2). No seeded-catalog builder exists that could reach P2 directly. Blocks readiness.
- G3: Unresolved implementation qualification: P2 assumes that the RedCat optics keywords of `2 Oct Ha` and `4 Oct Ha` associate rig `RedCat` without user action (LIB-FR-05). The v5 design does not state the equipment-matching rule for a session whose TELESCOP and FOCALLEN match an existing rig. Blocks readiness.
- G4: Out of scope for this journey, covered elsewhere: run-scoped frame review and **Reject for this Project** (J22), the Issues hub's grouping and actions (J38), Home's Projects box and Next actions (J32), creating rigs and filter lists (J15), starting a run and adding Ready to add sessions to it (J14, J21, J25), and a failed catalog write while confirming (J19/S11).
- G5: Out of scope for this journey: a Trashed session (Sessions' Trashed filter), reviewing a session whose location is offline, a confirmation made stale by a concurrent edit, and Create Project from a session with no Target, which opens unprefilled. Blocks readiness until covered by a step or a journey.

## Delta log

- No entries (initial draft, version 1).
