---
id: J32
title: Work from the Home dashboard and follow each Project's Next action
version: 8
status: draft
last_reviewed: 2026-10-27
actors: [primary-user]
surfaces: [home, projects, sessions, frame-review, targets, planning, view-review, wrap-up, locations, indexing, duplicates, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 067-frame-review, 072-observing-plans, D-W14, D-W27, D-W96, D-W89, D-W36, D-W95, D-W40, D-W59, D-W60, D-W63, D-W118, astro-plan-rzbzu.1, specs/063-clean-rebuild-contract/spec.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/067-frame-review/spec.md, specs/072-observing-plans/spec.md, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S9, HARNESS-V5-IA.md#S10, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, P-PLAN2, P-STO2, P-WRAP1, apps/prototype/src/features/v5/a-home/home.tsx, apps/prototype/src/domain/derive.ts#projectNext, 068-calibration-inputs, 070-results-reuse, D-W92, D-W94, D-W98, D-W100, D-W101, D-W105, D-W106, PRJ-FR-17, PRJ-FR-18, PRJ-FR-19, PRJ-AC-18, PRJ-AC-20, LIB-FR-17, LIB-FR-20, LIB-FR-23, CAL-FR-06, RES-FR-11]
---

## Goal

The user opens PlateVault and decides what to do next from Home. Home shows pending ingestions, pending work, open Projects and their next actions, status, tonight and the calendar. Done means:

- Home has no header buttons or summary line. Its sections are Pending ingestions, Pending work, Open work, Status, Tonight and Calendar in the order defined by PRJ-FR-17, with no issues list.
- Each open Project's Next action follows PRJ-FR-18: review matching sessions that need review; open a Project step waiting on the user, including a suggested session that needs calibration or a failed Apply; plan tonight for an unmet goal with an observing window; otherwise apply changes, open the tool or add sessions. A Closed or Archived Project is not in Open work.
- A Project row opens its Project page.
- Finishing review of a session can move a Project's Next to its matching suggestion waiting in Needs calibration; Home shows both the queue item and the suggestion.
- A Closed or Archived Project never appears in Open work, and Home offers no Show done control.
- Reading Home and following its actions changes no file or quality state and does not Apply pending Project changes.

## Preconditions

- P1: A development catalog seeded to the state in P2 to P4 at 2026-10-06 18:00 local time (G2). It reuses the NGC 7000 worked example and the `Veil Mosaic HOO` Project of J33. The rigs are `RedCat` (RedCat 51 + ASI2600MM) and `Esprit` (Esprit 100 + ASI533MC), as J15 creates them. Backyard is the default site. The Targets page, on tonight at Backyard, shows a window for NGC 7000, the Veil Mosaic centre, M 31, IC 1396 and M 33. The seed has finished setup, Activity records a completed import that brought frames into the catalog, the Projects exist, and the `IC 1396 Ha` Project has a View opened in Siril. No processing run is part of the fixture.
- P2: Four open Projects and one Closed or Archived Project:

  | Project | Subject | Rig | Goals | Progress | Open work / Next |
  | --- | --- | --- | --- | --- | --- |
  | `NGC 7000 HOO` | NGC 7000 | `RedCat` | Ha 10h, OIII 10h | Ha 6h10 in project · 9h15 captured; OIII 4h00 in project · 14h35 captured | 1 session needs review; Next opens Sessions filtered to Needs review |
  | `Veil Mosaic HOO` | mosaic `Veil Mosaic`, Panels 1 to 4 | `RedCat` | Ha 10h and OIII 10h per panel | 0h00 in project for every panel | Next: Plan tonight |
  | `M 31 OSC` | M 31 | `Esprit` | OSC broadband 10h | 3h00 in project · 4h30 captured | Apply failed; Next opens the Project's View step |
  | `IC 1396 Ha` | IC 1396 | `RedCat` | Ha 5h | 5h20 in project · 6h40 captured | `1 Oct Ha` suggested with unsettled flats; Next: Choose its flats first |
  | `Pleiades 2025` (Closed) | M 45 | `Esprit` | LRGB | any | Not listed in Open work |

- P3: Sessions needing work:
  - `2 Oct OIII`: 48 frames, all Unreviewed, with unsettled flats, so it waits in Needs calibration. It can join a Project only once it is Ready and its calibration is settled.
  - `12 Sep`, `24 Sep`, `26 Sep` and `30 Sep`, the worked example's OIII sessions: 127 frames, reviewed Ready sessions suggested to `NGC 7000 HOO`, and not added to it.
  - `1 Oct Ha`: reviewed and Ready, with unsettled flats. It waits in Needs calibration, appears in Home's Pending work and is suggested to `IC 1396 Ha` with "Choose its flats first"; it has not been added.
  - `4 Oct M 33`: reviewed and Ready, with confirmed Target M 33 on rig `RedCat`, and not yet held by a Project. Its calibration is settled.
  - `3 Oct` (OBJECT `Cygnus field`, conflicting pointing) and `5 Oct` (no OBJECT, no pointing): no confirmed Target.

  `NGC 7000 HOO` holds the worked example's Ha sessions `18 Sep` and `28 Sep` (111 frames). Its other matching Ready sessions are suggestions until the user adds them. No session joins a Project automatically, and `2 Oct OIII` cannot be added before review and settled calibration.
- P4: M 33 is a favourite in My targets, and M 45 is not a favourite. The plan at Backyard for the night of 7 Oct holds NGC 7000, and no other night has a Target in its plan.
- P5: A manifest (relative path, size, SHA-256) of every file under the registered locations, recorded outside PlateVault before S1.
- P6: No two files under the registered locations are byte-identical, so a duplicate scan finds no duplicate copies.

## Steps

### S1 — Open Home {#S1}

- **Do:** Launch PlateVault.
- **Expect:** Home is the first surface shown. At 1280 px it has two columns: Pending ingestions, Pending work and Open work on the left; Status, Tonight and Calendar on the right. The order is fixed. Pending work's Needs calibration lists 2 sessions, `1 Oct Ha` and `2 Oct OIII`, and Pending work includes `1 Oct Ha`'s suggestion to `IC 1396 Ha`. Open work lists the four open Projects and their Next actions. Status reads `Nothing running`.
- **Expect (negative):** Home has no alerts list or Issues hub. It has no header buttons or Getting started checklist. The Targets page is not the first surface, and no Inbox exists.
- **Trace:** PRJ-FR-17, PRJ-FR-19 · PRJ-AC-18, PRJ-AC-20, PRJ-AC-23 · LIB-FR-17, LIB-FR-23 · D-W89, D-W92, D-W94, D-W105

### S2 — Read Open work {#S2}

- **Do:** Read each Project row.
- **Expect:** Open work lists exactly four open Projects. Each row shows its Project progress, current status and one Next action. The Closed `Pleiades 2025` Project is not listed.
  - `NGC 7000 HOO` reads Ha `6h10 in project / 9h15 captured · goal 10h` and OIII `4h00 in project / 14h35 captured · goal 10h`. Its Next reads **1 session needs review**.
  - `Veil Mosaic HOO` reads Ha and OIII each at `0h00 in project`. Its Next reads **Plan tonight**.
  - `M 31 OSC` reads `3h00 in project / 4h30 captured · goal 10h`. Its Project row shows that Apply failed; Next opens its View step.
  - `IC 1396 Ha` reads Ha `5h20 in project / 6h40 captured · goal 5h`, met. Its Next reads **Choose its flats first** for the suggested `1 Oct Ha` session.
- **Expect (negative):** `Pleiades 2025` is not listed because it is Closed. `NGC 7000 HOO` shows the session-review action before its calibration suggestion. No Project row offers Wrap up or a processing-run action as Next. No goal shows "in project" above "captured", and no goal reads met from its "captured" value.
- **Trace:** PRJ-FR-17, PRJ-FR-18, PRJ-FR-32, PRJ-FR-21 · PRJ-AC-19, PRJ-AC-22, PRJ-AC-23 · D-W89, D-W94, D-W96, D-W97, D-W105

### S2a — Open a Project from its row {#S2a}

- **Do:** Click the `NGC 7000 HOO` row outside its Next button and its links. Return to Home and open the same row's menu.
- **Expect:** The click opens the `NGC 7000 HOO` Project page, whose Sessions step shows its groups, sessions, suggestions and pending changes. The Project menu offers **Edit…** and **Duplicate…**, and its Next action opens Sessions filtered to Needs review.
- **Expect (negative):** Opening the row applies no changes, marks no frame and changes no Project.
- **Trace:** PRJ-FR-07, PRJ-FR-27, PRJ-FR-30 · D-W94, D-W95, D-W96

### S3 — Follow 1 session needs review {#S3}

- **Do:** On the `NGC 7000 HOO` Open work row, click **1 session needs review**. Open `2 Oct OIII` from the filtered Sessions list and return without marking a frame.
- **Expect:** Sessions opens filtered to Needs review and lists `2 Oct OIII` with its 48 Unreviewed frames. The session has not been added to the Project.
- **Expect (negative):** Opening and leaving the review changes no frame's quality.
- **Trace:** PRJ-FR-18, PRJ-AC-19 · LIB-FR-17, LIB-FR-20 · D-W78, D-W94

### S4 — Finish the session's review and watch Next move {#S4}

- **Do:** Open `2 Oct OIII` from Sessions filtered to Needs review. Select all 48 frames with **⌘A** (Ctrl+A off macOS) and press **P**, read the confirmation and confirm it, then choose **Finish review**. Return to Home and follow `NGC 7000 HOO`'s Next action.
- **Expect:** The session's Review step lists the 48 frames. **P** on the ⌘A selection opens the bulk confirmation `Mark 48 frames Usable?`. After confirming and finishing review, all 48 read Usable and the session becomes Ready. Its calibration is unsettled, so it stays in Needs calibration, appears as a suggestion to `NGC 7000 HOO` on Home, and the Project's Next reads **Choose its flats first**.
- **Expect (negative):** No frame changes before the confirmation is accepted. Review changes no Project membership or goal until the user adds the session, and the unsettled session cannot be added. No file changes before Apply.
- **Trace:** PRJ-FR-08, PRJ-FR-09, PRJ-FR-18 · PRJ-AC-23 · LIB-FR-20, LIB-FR-23 · PIX-FR-14 · PIX-AC-21 · D-W94, D-W96, D-W100, D-W105, D-W118; astro-plan-rzbzu, owner's answer 2026-10-16

### S5 — Follow the other Next actions {#S5}

- **Do:** Return to Home after each action. Click `M 31 OSC`'s Next, then `Veil Mosaic HOO`'s **Plan tonight**. Then click the `IC 1396 Ha` row and, on its Project page, open the **Wrap up** step.
- **Expect:**
  - `M 31 OSC`'s Next opens its View step, where the failed Apply is shown on the Project.
  - **Plan tonight** on `Veil Mosaic HOO` opens the Targets page with its night set to tonight and scoped to that Project (`?project=`). It lists `Veil Mosaic` with its panels and unmet goals, and its best window and altitude are computed for the mosaic's centre at Backyard.
  - The `IC 1396 Ha` row opens its Project page, and the Wrap up step there shows Clean up, Trash and Archive, followed by **Close project…**.
- **Expect (negative):** Following these actions moves, trashes or archives nothing and Applies no changes. `IC 1396 Ha` remains Open, and its View and Output are unchanged. No Open work row offers Wrap up as its Next, and Home has no header **Plan tonight** button. No action opens a separate Plan page: `/plan` redirects to the Targets page.
- **Trace:** PRJ-FR-14, PRJ-FR-17, PRJ-FR-18 · PRJ-AC-19 · PLAN-FR-11 · D-W89, D-W94, D-W97

### S6 — Act on sessions needing work {#S6}

- **Do:** In Home's Pending work, open **Create Project…** on the `4 Oct M 33` row. Name the Project `M 33`, keep the prefilled subject and rig and the template None, and click **Create Project**. Return to Home, follow `M 33`'s Next to its Sessions step, inspect the suggestion, then cancel without adding it.
- **Expect:** Before the action, Home's Pending work includes:
  - `3 Oct` with `OBJECT Cygnus field` and `5 Oct` with `No OBJECT`, both needing a Target.
  - `4 Oct M 33`, which is not in a Project and offers **Create Project…** or **Add to Project**.
  - `1 Oct Ha` and `2 Oct OIII` in Needs calibration, each suggested with "Choose its flats first": `1 Oct Ha` to `IC 1396 Ha` and `2 Oct OIII` to `NGC 7000 HOO`.
  - `12 Sep`, `24 Sep`, `26 Sep` and `30 Sep` as Ready suggestions to `NGC 7000 HOO`.

  The New Project sheet opens prefilled with subject M 33 and rig `RedCat`. Creating it opens the `M 33` Project page but does not add the session. Back on Home, the two Needs a Target sessions remain, `4 Oct M 33` remains outside the Project, and `M 33`'s Next is **Add sessions**. Its Sessions step lists `4 Oct M 33` as a suggestion; it cannot be added until the user chooses it.
- **Expect (negative):** OBJECT `Cygnus field` is shown only as a label: no Target is suggested or preselected from it, so the `3 Oct` row offers no **Confirm** action. Creating a Project adds no session automatically, and cancelling the Add sessions sheet leaves `4 Oct M 33` outside the Project.
- **Trace:** PRJ-FR-08, PRJ-FR-09, PRJ-FR-17, PRJ-FR-18, PRJ-FR-19 · PRJ-AC-18, PRJ-AC-20 · LIB-FR-17, LIB-FR-23 · D-W89, D-W94, D-W96, D-W105

### S7 — Read Tonight {#S7}

- **Do:** Read the Tonight box. Open Targets, keep the night on tonight at Backyard, and compare each Tonight window with that Target's altitude column.
- **Expect:** Tonight lists the best window, with start, end, peak altitude and Moon separation, for NGC 7000, Veil Mosaic, M 31, IC 1396 and M 33, with M 33 marked as a favourite. The Veil Mosaic window uses the mosaic's centre. The box shows tonight's darkness window, plus the Moon's phase, illumination, moonrise and moonset. Every value names Backyard and its time zone. Each listed Target's window matches the best window marked in its altitude column on the Targets page, whose tooltip states the same peak altitude and time.
- **Expect (negative):** M 45 is not listed, because its Project is Closed and it is not a favourite. No window is listed for a Target without one tonight.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 Tonight · HARNESS-V5-FEEDBACK-R1.md Round 5 P-PLAN2 · PLAN-FR-11 · PLAN-AC-11 · PV-PLAN-SC-04 · D-W39, D-W60, D-W63

### S7a — Inspect and open a calendar night {#S7a}

- **Do:** Read Home's Calendar. Hover over the night of 7 Oct, then keyboard-focus it. Read its card, then choose the night.
- **Expect:** The Calendar shows five weeks of nights, starting with the week of 6 Oct. Each night shows its Moon phase, its hours of darkness, the number of unfinished goals it suits and the number of Targets planned for it. The night of 7 Oct counts 1 planned Target, and every other night counts 0. The card for 7 Oct lists its dark window, the Moon's illumination, rise and set, the goals it suits best first, the goals the Moon rules out, and NGC 7000 as its planned Target. Choosing the night opens Targets set to 7 Oct.
- **Expect (negative):** Hovering, focusing or choosing a night creates no plan or reminder and changes no Project.
- **Trace:** PRJ-FR-17 · PLAN-FR-12 · PLAN-AC-14 · D-W89 · HARNESS-V5-FEEDBACK-R1.md Round 9 C8

### S8 — Read goal progress in Open work {#S8}

- **Do:** Read the goal progress on Home's Open work rows.
- **Expect:** Open work shows each open Project's goal progress, including what remains in project:
  - NGC 7000: Ha 3h50 and OIII 6h00.
  - `Veil Mosaic · Panel 1` to `Veil Mosaic · Panel 4`: Ha 10h00 and OIII 10h00 each.
  - M 31: 7h00.
- **Expect (negative):** Home has no separate Goals section. IC 1396's goal is met in project, and `M 33` has no goals. No need is computed from "captured".
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 Goals · PRJ-FR-04, PRJ-FR-17 · D-W36, D-W39

### S9 — Confirm finished Projects are not in Open work {#S9}

- **Do:** Read Home's Open work and compare it with the Closed or Archived `Pleiades 2025` Project.
- **Expect:** Open work lists the five open Projects and does not list `Pleiades 2025`, which is Closed or Archived.
- **Expect (negative):** Home offers no Show done control, and reading Open work changes no Project state.
- **Trace:** PRJ-FR-17, PRJ-FR-32 · PRJ-AC-22 · D-W89, D-W97

### S10 — Watch running work {#S10}

- **Do:** In Settings › Locations, click **Rescan** on `Astro-T7 captures`. Read Home's Status section until it reads `Nothing running` again. Open Activity.
- **Expect:** While the rescan runs, Status lists it with its progress and a Cancel control. When it finishes, it leaves Status, and the automatic duplicate scan that follows is listed with its progress until it finishes. Activity records both outcomes, the duplicate scan with no duplicate copies (P6).
- **Expect (negative):** Status never reports an operation finished before Activity records a durable outcome. The duplicate scan moves or trashes no file and raises no duplicate issue.
- **Trace:** PRJ-FR-17 · LIB-FR-03, LIB-FR-10 · root FR-012 · D-W89

### S11 — Confirm Home changed nothing on disk {#S11}

- **Do:** Outside PlateVault, recompute the P5 manifest.
- **Expect:** Every path, size and SHA-256 matches P5.
- **Expect (negative):** Reading Home and following its actions wrote, moved or trashed no file. The only catalog changes are the S4 quality marks and the S6 Project.
- **Trace:** root SC-002 · PRJ-FR-05

## Success criteria

- SC1: At S1 Home shows the 6 PRJ-FR-17 sections in their fixed order, with no header buttons, summary line, Issues hub or alerts list.
- SC2: At S2, Open work lists exactly 4 open Projects. Their Next actions follow PRJ-FR-18: session review for `NGC 7000 HOO`, Plan tonight for `Veil Mosaic HOO`, the failed Apply for `M 31 OSC` and the unsettled calibration suggestion for `IC 1396 Ha`.
- SC3: After S4, `2 Oct OIII` is Ready, appears in Needs calibration and as a Home suggestion to `NGC 7000 HOO`; its Next reads **Choose its flats first**, and it is not added automatically.
- SC4: After S6, Needs a Target lists 2 sessions, `4 Oct M 33` remains outside `M 33` until added by the user, and its Next is **Add sessions**; no session is added automatically.
- SC5: Tonight lists exactly 5 Targets, and every value names Backyard (S7).
- SC6: `Pleiades 2025` is Closed and never appears in Home's Open work (S2, S9).
- SC7: The S11 manifest equals P5 for 100% of files.
- SC8: At S2a one click on a Project row opens that Project's page, and S5 moves, trashes or archives 0 files.
- SC9: The Calendar shows 5 weeks starting with the week of 6 Oct. Exactly 1 night, 7 Oct, counts a planned Target (P4), and choosing it opens Targets set to 7 Oct with 0 plans created (S7a).

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Expected behavior follows specs 063, 064, 065, 067, 068, 070 and 072 at head and workflow decisions D-W93 to D-W116. No implementation has been validated against them.
- G2: Unresolved implementation qualification: P1 and P2 need a seeded catalog in a known state at a fixed local time. No fixture builder exists, and the windows depend on Backyard's coordinates. Blocks readiness.
- G5: Out of scope for this journey: a session that qualifies for more than one Pending work category, and the Status section's Pause, Resume and Retry actions, are not exercised. Blocks readiness until covered by a step or a journey.
- G6: (dissolved 2026-10-16): answered by the owner's D-W118 (PIX-FR-14): every mark on a ⌘A or threshold selection asks, whatever its count, so S4 reads `Mark 48 frames Usable?` and no frame changes before it is confirmed. Single-frame and hand-picked marks never ask (J22/S9a). **Mark rest usable** also asks and names the count (owner's answer, 2026-10-19, astro-plan-rzbzu.1); this journey does not invoke that control.
- G7: Rests on provisional F4 items, pending the owner's confirmation in PR #1804: D-W105's "Choose its flats first" copy (S2, S4, S6), D-W96's matching rule and its "captured" count (S2, S4, S6, S8), and PRJ-FR-18's provisional "Add sessions" Next copy and the step a waiting Project opens at (S2, S6). If the owner changes one, the steps that cite it change.

## Delta log

- **Δ2** 2026-10-12 · S1, S2, +S2a, S3, S4, S5, S6, S7, S8, S9, S10 · behavior-change
  Home is the harness v5 dashboard: header actions Plan tonight, New Project and Import over the boxes Projects, Sessions, Tonight, Goals and Work, with no issues strip (the top line is gone). A Project row opens its Project page, an Unreviewed session is reviewed in a sheet over Home, and Next follows the v5 rule order, so `IC 1396 Ha` now reads Wrap up.
  Plan tonight opens the merged Targets page, and the rescan runs from Settings › Locations, followed by the automatic duplicate scan. Gaps G3 (no rescan control) and G4 (where Plan tonight opens) are resolved and retired.
  Evidence: HARNESS-V5-IA.md §Screens S1, S3, S9, S10; HARNESS-V5-FEEDBACK-R1.md §Round 5 "Home has no issues strip", "Home rows open the Project page", P-PLAN2, P-STO2, "Duplicates are scanned automatically", "OBJECT is a label, never evidence" (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); prototype src/domain/derive.ts projectNext and src/features/t1/settings/locations-page.tsx Rescan; user instruction 2026-10-12 · by: JourneysV5.U2Projects (intent-gated)
- **Δ3** 2026-10-12 · S1, S4 · behavior-change
  Home shows a Getting started checklist until setup, a first import, a first Project and a first run are done; in this fixture all four are done, so S1 asserts its absence. S4's ⌘A bulk mark may now ask for confirmation, and G6 records that the size that triggers it is undecided.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Onboarding: walk plus checklist", "Large bulk marks need confirmation" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6C (intent-gated)
- **Δ4** 2026-10-15 · S1, S2, S2a, S3, S4, S5, S6, S7, S8, S9, S10 · behavior-change
  Home now follows the F4 contract: its sections show pending sessions and suggestions, open Projects and their Next actions, status and planning. Projects replace runs; review, calibration, Apply, View and Output govern the Project flow. Home has no header buttons or Show done, so S5 opens Wrap up from the Project page and S9 lists no Closed or Archived Project; P2's `IC 1396 Ha` Next is **Choose its flats first**, and S2 to S4 are retitled for Open work and session intake.
  Evidence: D-W89, D-W93 to D-W106 in PR #1804, 063 FR-032, 064 LIB-FR-17/LIB-FR-20/LIB-FR-23, 065 PRJ-FR-17 to PRJ-FR-19, 068 CAL-FR-06, 070 RES-FR-11 · by: SpecF4Writer2 (intent-gated)
- **Δ5** 2026-10-16 · S4 · behavior-change
  S4 marks the 48 frames with ⌘A and P, and the mark asks `Mark 48 frames Usable?` before any frame changes. G6 is dissolved.
  Evidence: D-W118 (owner's second batch of 2026-10-16) in PR #1804, PIX-FR-14, PIX-AC-21 · by: EncodeOwnerAnswers2 (intent-gated)
- **Δ6** 2026-10-17 · +S7a, +SC9, P4 · behavior-change
  New S7a checks Home's five-week Calendar: each night's Moon phase, darkness, suited goals and planned Targets, and the card on hover or focus. Choosing a night opens Targets set to that night. P4 now plans NGC 7000 for 7 Oct, so that night counts one planned Target.
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C8 (decision astro-plan-b66vy) · D-W89 · PLAN-FR-12, PLAN-AC-14 · by: JourneysR9c (intent-gated)
- **Δ7** 2026-10-26 · P4, S7 · behavior-change
  ★ becomes Favourite: Tonight marks a favourite as one, in the wording of the Targets page's Favourite column.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 11 (OWNER, 2026-10-23) on ui-harness-v5 @ 5dc245244; D-W142, PLAN-TGT-FR-17 · by: SpecAmend (intent-gated)
- **Δ8** 2026-10-27 · S4, G6 · behavior-change
  S4's ⌘A confirmation remains traced to owner answer D-W118; the separate “Mark rest usable” answer is documented without implying J32 invokes that control.
  Evidence: D-W118, PIX-FR-14, PIX-AC-21 · astro-plan-rzbzu owner answer 2026-10-16 · by: SpecOwner2 (intent-gated)
