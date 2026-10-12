---
id: J32
title: Work from the Home dashboard and follow each Project's Next action
version: 3
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [home, projects, sessions, frame-review, targets, planning, view-review, wrap-up, locations, indexing, duplicates, activity]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 067-frame-review, 072-observing-plans, D-W14, D-W27, D-W33, D-W35, D-W36, D-W37, D-W39, D-W40, D-W48, D-W59, D-W60, D-W63, D-W66, specs/063-clean-rebuild-contract/spec.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/067-frame-review/spec.md, specs/072-observing-plans/spec.md, HARNESS-V5-IA.md#S1, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S9, HARNESS-V5-IA.md#S10, HARNESS-V5-FEEDBACK-R1.md#round-5, HARNESS-V5-FEEDBACK-R1.md#round-6, P-PLAN2, P-STO2, P-WRAP1, apps/prototype/src/features/v5/a-home/home.tsx, apps/prototype/src/domain/derive.ts#projectNext]
---

## Goal

The user opens PlateVault and decides what to do next from Home, the Projects
dashboard. Home's header offers Plan tonight, New Project and Import. Its boxes
show every open Project with its goals, stage and one Next action, the sessions
that need work, tonight's windows, unmet goals and running work. Done means:

- Home shows the three header actions and the five boxes Projects, Sessions, Tonight, Goals and Work, and no issues strip.
- Each Project's Next action is the first rule that applies, in the order review new frames, a blocked run, Wrap up, Plan tonight, Start a processing run, and following it opens the named place. A Done Project has no Next.
- A Project row opens its Project page.
- Reviewing the new frames in the sheet over Home moves that Project's Next to its blocked run.
- Done Projects appear only behind **Show done**.
- Reading Home and following its actions changes no file, run or quality state, and moves nothing in Wrap up.

## Preconditions

- P1: A development catalog seeded to the state in P2 to P4 at 2026-10-06 18:00 local time (G2). It reuses the NGC 7000 worked example and the `Veil Mosaic HOO` Project of J33. The rigs are `RedCat` (RedCat 51 + ASI2600MM) and `Esprit` (Esprit 100 + ASI533MC), as J15 creates them. Backyard is the default site. The Targets page, on tonight at Backyard, shows a window for NGC 7000, the Veil Mosaic centre, M 31, IC 1396 and M 33. The seed has finished setup, Activity records a completed import that brought frames into the catalog, Projects exist, and `IC1396-Ha-Siril` was prepared and opened in Siril before it was marked Complete (P2). So every Getting started item (setup, first import, first Project, first run) is done under each reading of J18/G5, as J18 completes them.
- P2: Four open Projects and one Done Project:

  | Project | Subject | Rig | Goals | Progress | Runs |
  | --- | --- | --- | --- | --- | --- |
  | `NGC 7000 HOO` | NGC 7000 | `RedCat` | Ha 10h, OIII 10h | Ha 6h10 in project · 9h15 captured; OIII 4h00 in project · 14h35 captured | `NGC7000-HOO-Siril` waits at Calibrate with calibration needing review |
  | `Veil Mosaic HOO` | mosaic `Veil Mosaic`, Panels 1 to 4 | `RedCat` | Ha 10h and OIII 10h per panel | 0h00 in project for every panel | none |
  | `M 31 OSC` | M 31 | `Esprit` | OSC broadband 10h | 3h00 in project · 4h30 captured | `M31-OSC-Siril` at Prepare with a failed preparation |
  | `IC 1396 Ha` | IC 1396 | `RedCat` | Ha 5h | 5h20 in project · 6h40 captured | `IC1396-Ha-Siril` Complete |
  | `Pleiades 2025` (Done) | M 45 | `Esprit` | LRGB | any | all Complete |

- P3: Sessions needing work:
  - `2 Oct OIII`: 48 frames, all Unreviewed. It is a member of `NGC7000-HOO-Siril`.
  - `12 Sep`, `24 Sep`, `26 Sep` and `30 Sep`, the worked example's OIII sessions: 127 frames, reviewed, candidates of `NGC 7000 HOO`, and members of none of its runs.
  - `1 Oct Ha`: reviewed, a candidate of `IC 1396 Ha`, and a member of none of its runs.
  - `4 Oct M 33`: reviewed, with confirmed Target M 33 on rig `RedCat`, a candidate of no Project and a member of no run.
  - `3 Oct` (OBJECT `Cygnus field`, conflicting pointing) and `5 Oct` (no OBJECT, no pointing): no confirmed Target.

  `NGC7000-HOO-Siril` holds the worked example's Ha sessions `18 Sep` and `28 Sep` (111 frames) and `2 Oct OIII`. Its saved membership includes 74 of those Ha frames and all 48 `2 Oct OIII` frames. Every other candidate of an open Project is a member of one of that Project's runs, and every other frame in the catalog is reviewed.
- P4: My targets holds ★ M 33. M 45 is not ★.
- P5: A manifest (relative path, size, SHA-256) of every file under the registered locations, recorded outside PlateVault before S1.
- P6: No two files under the registered locations are byte-identical, so a duplicate scan finds no duplicate copies.

## Steps

### S1 — Open Home {#S1}

- **Do:** Launch PlateVault.
- **Expect:** Home is the first surface shown. Its header offers **Plan tonight**, **New Project…** and **Import…**. Below it, five boxes are titled Projects, Sessions, Tonight, Goals and Work. Work reads `Nothing running`.
- **Expect (negative):** Home shows no issues strip: no issue pill and no `No issues` line, although two sessions need a Target (P3). Home shows no Getting started checklist, because all four of its items are done (P1). The Targets page is not the first surface, and no Inbox exists.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 · HARNESS-V5-FEEDBACK-R1.md Round 5 "Home has no issues strip" · root FR-020 · PRJ-FR-17, PRJ-FR-19 · PRJ-AC-18, PRJ-AC-20 · LIB-AC-09 · D-W39

### S2 — Read the Projects box {#S2}

- **Do:** Read each Project row.
- **Expect:** Exactly four Projects are listed, each with its subjects and rig count, one goal line per channel, its stage and one Next action. **Show done** is off, with a muted `1 hidden` beside it.
  - `NGC 7000 HOO` reads Ha `6h10 in project / 9h15 captured · goal 10h` and OIII `4h00 in project / 14h35 captured · goal 10h`. Its stage reads `Blocked at Calibrate`, where `NGC7000-HOO-Siril` waits, and Next reads **Review 48 new frames**.
  - `Veil Mosaic HOO` reads Ha and OIII each at `0h00 in project`, and its stage reads `No runs yet`. Next reads **Plan tonight**.
  - `M 31 OSC` reads `3h00 in project / 4h30 captured · goal 10h`. Its stage reads `Blocked at Prepare`, and Next names the run, `Open M31-OSC-Siril`, with the blocked glyph.
  - `IC 1396 Ha` reads Ha `5h20 in project / 6h40 captured · goal 5h`, met. Its stage reads `Wrap up`, and Next reads **Wrap up**, because every run is Complete.
- **Expect (negative):** `Pleiades 2025` is not listed. `NGC 7000 HOO` does not show its blocked run as Next, because reviewing new frames comes first. `IC 1396 Ha` offers neither Plan tonight nor Start a processing run as Next. No row says "not in a run", no goal shows "in project" above "captured", and no goal reads met from its "captured" value.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 "Next rule order (D-W35)" · PRJ-FR-04, PRJ-FR-17, PRJ-FR-18, PRJ-FR-20, PRJ-FR-21 · PRJ-AC-03, PRJ-AC-19, PRJ-AC-22 · root FR-020, FR-022, FR-023 · P-WRAP1 · D-W27, D-W35, D-W36, D-W48, D-W66

### S2a — Open a Project from its row {#S2a}

- **Do:** Click the `NGC 7000 HOO` row outside its Next button and its links. Return to Home and open the same row's menu.
- **Expect:** The click opens the `NGC 7000 HOO` Project page, whose Runs section lists `NGC7000-HOO-Siril`. The row's menu lists the other actions, among them the Next action **Review 48 new frames** and **Start run…**.
- **Expect (negative):** Opening the row starts no run, marks no frame and changes no Project.
- **Trace:** HARNESS-V5-FEEDBACK-R1.md Round 5 "Home rows open the Project page" · HARNESS-V5-IA.md S1, S3

### S3 — Follow Review 48 new frames {#S3}

- **Do:** On `NGC 7000 HOO`, click **Review 48 new frames**. Read the review, then click **Done** without marking a frame.
- **Expect:** The Project's candidate review opens (`?candidates=unreviewed`) with the filter set to Unreviewed and lists exactly the 48 frames of `2 Oct OIII`. **Done** returns to the Project page.
- **Expect (negative):** Opening and leaving the review changes no frame's quality.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S3 Candidates · PRJ-FR-18 · PRJ-AC-19 · PIX-FR-18 · D-W35

### S4 — Review the frames in the sheet over Home and watch Next move {#S4}

- **Do:** Return to Home. In the Sessions box's Unreviewed group, click **Review** on `2 Oct OIII`. Switch frame review to the grid view with G. Select all 48 frames with ⌘A and press P, confirming the bulk mark if PlateVault asks for it (G6). Close the sheet and click `NGC 7000 HOO`'s Next action.
- **Expect:** Frame review opens in a sheet over Home (`?review=<sessionId>`) with the filter set to Unreviewed and lists the 48 frames. All 48 frames read Usable. After the sheet closes, the Unreviewed group reads `None`. `NGC 7000 HOO`'s Next now names `NGC7000-HOO-Siril`, at Calibrate. Clicking it opens that run at its Calibrate step, with its readiness line and **Review matches**.
- **Expect (negative):** The sheet sets library marks only and offers no "Reject for this Project only". Marking the frames changes no run's saved membership and no goal's "in project" value; OIII still reads 4h00 in project.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 Sessions ("reviewed in a sheet over Home, library marks only"), S6 · PRJ-FR-18 · PRJ-AC-23 · PIX-FR-18 · D-W14, D-W40, D-W48

### S5 — Follow the other Next actions {#S5}

- **Do:** Return to Home after each action. Click `M 31 OSC`'s Next, then `Veil Mosaic HOO`'s **Plan tonight**, then `IC 1396 Ha`'s **Wrap up**. Then click **Plan tonight** in Home's header.
- **Expect:**
  - `M 31 OSC`'s Next opens `M31-OSC-Siril` at Prepare with its failed preparation named.
  - **Plan tonight** on `Veil Mosaic HOO` opens the Targets page with its night set to tonight and scoped to that Project (`?project=`). It lists `Veil Mosaic` with its panels and unmet goals, and its best window and altitude are computed for the mosaic's centre at Backyard.
  - **Wrap up** opens the Wrap up stage of `IC 1396 Ha` (`?stage=wrap-up`). Its stage strip marks Wrap up current, and its steps read in order Clean up runs, Trash, Archive and Done.
  - The header's **Plan tonight** opens the Targets page with its night set to tonight and no Project scope.
- **Expect (negative):** Following these actions moves, trashes or archives nothing and creates no run. `IC 1396 Ha` still lists exactly one run, `IC1396-Ha-Siril` Complete, and stays Open. No action opens a separate Plan page: `/plan` redirects to the Targets page.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1, S9 · HARNESS-V5-FEEDBACK-R1.md Round 5 P-PLAN2 · P-WRAP1 · PRJ-FR-10, PRJ-FR-18 · PRJ-AC-19 · PLAN-FR-11 · D-W35, D-W48, D-W63

### S6 — Act on sessions needing work {#S6}

- **Do:** Read the Sessions box. On the `4 Oct M 33` row, open **Add to Project** and choose **Create Project…**. Name the Project `M 33`, keep the prefilled subject and rig and the template None, and click **Create Project**. Return to Home and click `M 33`'s Next. Read the sheet, then cancel it.
- **Expect:** Before the action, the Sessions box has four groups, and each row has one action:
  - Needs a Target lists `3 Oct` with `OBJECT Cygnus field` and `5 Oct` with `No OBJECT`, each offering **Choose Target**.
  - Not in any Project lists `4 Oct M 33`, whose **Add to Project** menu lists the open Projects and **Create Project…**.
  - Unreviewed reads `None` after S4.
  - Ready to add lists `12 Sep`, `24 Sep`, `26 Sep` and `30 Sep` under `NGC 7000 HOO`, and `1 Oct Ha` under `IC 1396 Ha`.

  The New Project sheet opens prefilled with subject M 33 and rig `RedCat`. Creating it opens the `M 33` Project page. Back on Home, Needs a Target still lists 2 sessions and Not in any Project reads `None`. Projects lists `M 33` with Next **Start a processing run**, and `4 Oct M 33` moves to Ready to add under `M 33`. `M 33`'s Next opens the Start run sheet with subject M 33, rig `RedCat` and **Profile (optional)**.
- **Expect (negative):** OBJECT `Cygnus field` is shown only as a label: no Target is suggested or preselected from it, so the `3 Oct` row offers no **Confirm** action. Creating the Project assigns `4 Oct M 33` to no run, and cancelling the Start run sheet creates no run.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 Sessions, S4 · HARNESS-V5-FEEDBACK-R1.md Round 5 "OBJECT is a label, never evidence", §B Start run sheet · PRJ-FR-17, PRJ-FR-18, PRJ-FR-19 · PRJ-AC-18, PRJ-AC-20 · LIB-FR-17 · D-W33, D-W35, D-W37, D-W39, D-W59

### S7 — Read Tonight {#S7}

- **Do:** Read the Tonight box. Open Targets, keep the night on tonight at Backyard, and compare each Tonight window with that Target's altitude column.
- **Expect:** Tonight lists the best window, with start, end, peak altitude and Moon separation, for NGC 7000, Veil Mosaic, M 31, IC 1396 and M 33, with M 33 marked ★. The Veil Mosaic window uses the mosaic's centre. The box shows tonight's darkness window and the Moon's phase, illumination, rise and set. Every value names Backyard and its time zone. Each listed Target's window matches the best window marked in its altitude column on the Targets page, whose tooltip states the same peak altitude and time.
- **Expect (negative):** M 45 is not listed, because its Project is Done and it is not ★. No window is listed for a Target without one tonight.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 Tonight · HARNESS-V5-FEEDBACK-R1.md Round 5 P-PLAN2 · PLAN-FR-11 · PLAN-AC-11 · PV-PLAN-SC-04 · D-W39, D-W60, D-W63

### S8 — Read Goals {#S8}

- **Do:** Read the Goals box.
- **Expect:** It lists each unmet goal of an open Project per subject and channel, with what it still needs in project:
  - NGC 7000: Ha 3h50 and OIII 6h00.
  - `Veil Mosaic · Panel 1` to `Veil Mosaic · Panel 4`: Ha 10h00 and OIII 10h00 each.
  - M 31: 7h00.
- **Expect (negative):** IC 1396 is not listed, because its goal is met in project, and `M 33` adds no row, because it has no goals. No need is computed from "captured".
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 Goals · PRJ-FR-04, PRJ-FR-17 · D-W36, D-W39

### S9 — Show and hide Done Projects {#S9}

- **Do:** Turn on **Show done**, then turn it off.
- **Expect:** With Show done on, `Pleiades 2025` is listed with a Done pill next to the five open Projects, and its Next cell reads `–`. With it off, only the five open Projects are listed and `1 hidden` shows beside the switch.
- **Expect (negative):** Toggling Show done changes no Project's state. The Done Project offers no Next action.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 ("a Done Project has no Next") · PRJ-FR-17 · PRJ-AC-22 · root FR-020 · D-W48

### S10 — Watch running work {#S10}

- **Do:** In Settings › Locations, click **Rescan** on `Astro-T7 captures`. Read Home's Work box until it reads `Nothing running` again. Open Activity.
- **Expect:** While the rescan runs, Work lists it with its progress and a Cancel control. When it finishes, it leaves Work, and the automatic duplicate scan that follows it is listed with its progress until it finishes. Activity records both outcomes, the duplicate scan with no duplicate copies (P6).
- **Expect (negative):** Work never reports an operation finished before Activity records a durable outcome. The duplicate scan moves or trashes no file and raises no duplicate issue.
- **Trace:** Home dashboard · HARNESS-V5-IA.md S1 Work · HARNESS-V5-FEEDBACK-R1.md Round 5 P-STO2, "Duplicates are scanned automatically" · PRJ-FR-17 · LIB-FR-03, LIB-FR-10 · root FR-012

### S11 — Confirm Home changed nothing on disk {#S11}

- **Do:** Outside PlateVault, recompute the P5 manifest.
- **Expect:** Every path, size and SHA-256 matches P5.
- **Expect (negative):** Reading Home and following its actions wrote, moved or trashed no file. The only catalog changes are the S4 quality marks and the S6 Project.
- **Trace:** root SC-002 · PRJ-FR-05

## Success criteria

- SC1: At S1 Home shows exactly 3 header actions and 5 boxes, 0 issue pills and 0 Getting started checklists.
- SC2: At S2, 4 Projects are listed and each shows the Next of the first applicable rule: review new frames, Plan tonight, the blocked run and Wrap up for `NGC 7000 HOO`, `Veil Mosaic HOO`, `M 31 OSC` and `IC 1396 Ha`.
- SC3: After S4, `NGC 7000 HOO`'s Next names `NGC7000-HOO-Siril` at Calibrate, and OIII still reads 4h00 in project.
- SC4: After S6, Needs a Target lists 2 sessions, Not in any Project lists 0, `M 33`'s Next is Start a processing run, and 0 runs have been created.
- SC5: Tonight lists exactly 5 Targets, and every value names Backyard (S7).
- SC6: `Pleiades 2025` is listed only while Show done is on, and it has 0 Next actions (S2, S9).
- SC7: The S11 manifest equals P5 for 100% of files.
- SC8: At S2a one click on a Project row opens that Project's page, and S5 moves, trashes or archives 0 files.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Behavior follows the harness v5 design (HARNESS-V5-IA.md and HARNESS-V5-FEEDBACK-R1.md through Round 5, apps/prototype/design/ on ui-harness-v5 @ b5e813a5), on top of specs 063, 065 and 072 at d45a22ad and the 2026-10-06 workflow decisions. No implementation has been validated against them.
- G2: Unresolved implementation qualification: P1 and P2 need a seeded catalog in a known state at a fixed local time. No fixture builder exists, and the windows depend on Backyard's coordinates. Blocks readiness.
- G5: Out of scope for this journey: a session that qualifies for two Sessions groups at once (the v5 prototype lists a candidate in no run with Unreviewed frames under both Unreviewed and Ready to add), and the Work box's Pause, Resume and Retry, are not exercised. Blocks readiness until covered by a step or a journey.
- G6: Unresolved product question: Round 6 asks for confirmation on large bulk marks ("⌘A then P/X/U on many frames", "Mark 120 frames Unusable?") but sets no size, so S4 cannot say whether ⌘A then P on 48 frames asks first. Options: (a, recommended) every mark on a ⌘A selection asks, whatever its count, so S4 reads a "Mark 48 frames Usable?" confirmation and no frame changes before it is confirmed; (b) a fixed count; (c) every mark on more than one frame. Single-frame P, X and U never ask. Mirrors J22/G8. Blocks readiness.

## Delta log

- **Δ2** 2026-10-12 · S1, S2, +S2a, S3, S4, S5, S6, S7, S8, S9, S10 · behavior-change
  Home is the harness v5 dashboard: header actions Plan tonight, New Project and Import over the boxes Projects, Sessions, Tonight, Goals and Work, with no issues strip (the top line is gone). A Project row opens its Project page, an Unreviewed session is reviewed in a sheet over Home, and Next follows the v5 rule order, so `IC 1396 Ha` now reads Wrap up.
  Plan tonight opens the merged Targets page, and the rescan runs from Settings › Locations, followed by the automatic duplicate scan. Gaps G3 (no rescan control) and G4 (where Plan tonight opens) are resolved and retired.
  Evidence: HARNESS-V5-IA.md §Screens S1, S3, S9, S10; HARNESS-V5-FEEDBACK-R1.md §Round 5 "Home has no issues strip", "Home rows open the Project page", P-PLAN2, P-STO2, "Duplicates are scanned automatically", "OBJECT is a label, never evidence" (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); prototype src/domain/derive.ts projectNext and src/features/t1/settings/locations-page.tsx Rescan; user instruction 2026-10-12 · by: JourneysV5.U2Projects (intent-gated)
- **Δ3** 2026-10-12 · S1, S4 · behavior-change
  Home shows a Getting started checklist until setup, a first import, a first Project and a first run are done; in this fixture all four are done, so S1 asserts its absence. S4's ⌘A bulk mark may now ask for confirmation, and G6 records that the size that triggers it is undecided.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Onboarding: walk plus checklist", "Large bulk marks need confirmation" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6C (intent-gated)
