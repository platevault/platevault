---
id: J21
title: Pick the candidate sessions for a processing run
version: 3
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [view-review, sessions, projects, status-bar]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 066-view-selection, D01, D02, D08, D-W3, D-W33, D-W34, D-W37, D-W49, D-W50, D-W66, D-W72, specs/063-clean-rebuild-contract/decisions.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-c-select-sessions-for-a-view, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#round-5, P-SB3]
---

## Goal

In the Select step of processing run `NGC7000-HOO-Siril`, the user reads the
candidates that PlateVault derived from the subject's Target and the run's rig.
The user checks the evidence and ordering, filters and sorts without losing
the selection, deals explicitly with an offline candidate, and saves the run.
Done means the run's first saved membership revision holds exactly the five
available RedCat sessions, each with the reason
`Target NGC 7000 on RedCat`, with 214 lights / 17h 50m and no
unresolved member. Project `NGC 7000 HOO` then counts those five sessions
"in project", below the "captured" value of its seven candidates. The offline
12 Sep session and the Esprit session are not part of the run.

## Preconditions

- P1: J20 completed through S9. Project `NGC 7000 HOO` has subject NGC 7000, rigs `RedCat` and `Esprit`, goals Ha 10h and OIII 12h, and 7 candidates. Ha reads `0h00 in project · 12h35 captured · goal 10h` and OIII reads `0h00 in project · 10h35 captured · goal 12h`. Its processing run `NGC7000-HOO-Siril` (subject NGC 7000, rig `RedCat`) is open at its Select step, and no membership revision is saved yet.
- P2: The J19 catalog holds the six RedCat sessions 12, 18, 24, 26, 28 and 30 Sep with confirmed Target NGC 7000 and confirmed rig `RedCat`. `Cold-1` is offline, so 12 Sep reads Offline with 24 last-observed OIII frames. The other-camera session holds 40 Ha 300 s lights with confirmed Target NGC 7000 and rig `Esprit`.
- P3: No measurement has run for any fixture frame.

## Steps

### S1 — Orient in the run workspace {#S1}

- **Do:** Move along the run's step bar through Select, Review, Calibrate and Prepare, then return to Select. Toggle **Sky coverage** on and off.
- **Expect:** The step bar lists Select, Review, Calibrate, Prepare, Results and Done for this run, each with its state, and Select reads Unsaved. Each later step opens and names what it still needs: Prepare's checks read "Save the run first." for the saved membership and "Choose a profile in Prepare." for the application profile. Every step shows the same selection. Exactly one Next shows: on Select it reads **Save run** and moves focus to the Save button; on Review, Calibrate and Prepare it also reads **Save run** and leads back to Select's Save button, never to the step being shown. **Sky coverage** shows and hides a linked spatial view. On each of these four steps the run header offers **Complete** and **Move to Trash**, which this journey does not use.
- **Expect (negative):** Neither the step bar nor Next gates movement: every step opens from the bar. Moving between steps saves no revision, creates no folder on disk and starts no measurement.
- **Trace:** flow C1 · VSEL-FR-02 · RES-FR-10 · D-W3, D-W72 · HARNESS-V5-IA.md S5, Fix pass "Next never points at the screen it is on"

### S2 — Read the run's fixed identity {#S2}

- **Do:** Read the run header.
- **Expect:** It reads name `NGC7000-HOO-Siril`, a link to Project `NGC 7000 HOO`, status Open, subject NGC 7000 and rig `RedCat`. The subject and rig show as fixed values ("Subject (fixed)", "Rig (fixed)") with no edit control. The header shows no profile; the profile is chosen in Prepare.
- **Expect (negative):** No control changes the subject or rig, or moves or shares the run with another Project.
- **Trace:** flow C1 · VSEL-FR-01 · D-W8, D-W50 · HARNESS-V5-IA.md S5 header

### S3 — Read the candidates {#S3}

- **Do:** Read the candidate list.
- **Expect:** The list holds exactly the six RedCat sessions. 18, 24, 26, 28 and 30 Sep start selected, each with reason `Target NGC 7000 on RedCat`. 26 Sep is selected although its OBJECT reads `Cygnus field`. 12 Sep is listed as Offline and not selected. Each row shows session, date/time, channel, exposure, frame count, integration, availability, distance and footprint evidence. Sessions with a footprint come first, ordered by overlap and then angular separation. 18 Sep (pointing only) follows them, and 24 Sep (Position unknown) comes last. The summary reads 214 lights / 17h 50m.
- **Expect (negative):** The Esprit other-camera session is not listed. Listing candidates merges no session, rewrites no header and changes no Target. The `Cygnus field` label removes no candidate.
- **Trace:** flow C2 · VSEL-FR-03 · VSEL-AC-01, VSEL-AC-08 · D-W33, D-W37, D-W49

### S4 — Inspect missing geometry {#S4}

- **Do:** Open the geometry evidence of 28 Sep, 18 Sep and 24 Sep. Clear the 24 Sep checkbox, then check it again.
- **Expect:** 28 Sep shows **FOV from confirmed equipment** with its inputs (image dimensions, effective focal length, pixel scale, binning). 18 Sep shows a distance from its pointing and no footprint. 24 Sep reads **Position unknown** and has no distance value. Its checkbox clears and checks like any other, and the summary returns to 214 lights / 17h 50m.
- **Expect (negative):** Neither 18 Sep nor 24 Sep shows a distance of 0 or a footprint derived from its Target or an OBJECT label. Unknown geometry removes no candidate.
- **Trace:** flow C3, cross-flow "Missing geometry", "Missing OBJECT" · VSEL-FR-04 · VSEL-AC-02 · D01, D-W33

### S5 — Filter and sort {#S5}

- **Do:** Open **Filters** and set channel Ha. Then replace it with **Missing OBJECT**, then with quality state Unreviewed. Open the expanded filter controls. Sort by sky distance. Clear all filters and search for `other camera`.
- **Expect:** With Ha, an active filter chip and a matching-session count appear, and **Selected outside current filters: 3** shows. **Missing OBJECT** matches only 24 Sep. Unreviewed shows rows with per-state frame counts, and measurement columns read **Not measured**. The expanded controls offer gain, offset, binning and temperature. Sorting by sky distance orders sessions with evidence; 24 Sep has no distance value. The search matches no row.
- **Expect (negative):** No filter changes the selected session IDs or session definitions. The filters offer no camera or equipment control. No filter or search shows the Esprit session. No filter starts measurement or marks a frame Usable.
- **Trace:** flow C4, cross-flow "Selection hidden by filters" · VSEL-FR-05, VSEL-FR-06 · VSEL-AC-03, VSEL-AC-18 · PIX-AC-06 · D-W37

### S6 — Review, clear and restore the selection {#S6}

- **Do:** Clear filters and click **Show selected**. Click **Clear selection**. Set the availability filter to Available and click **Select matching**, then clear filters.
- **Expect:** **Show selected** lists exactly the five sessions with their reasons. The summary reports included frames and integration by channel from each session's available frames: Ha 111 / 9h 15m, OIII 103 / 8h 35m, total 214 / 17h 50m, with no unresolved member. Unreviewed and library-Unusable counts stay visible. While five sessions are selected, the status bar's selection count reads `5 selected`. **Clear selection** leaves zero selected, the summary at 0 lights, and no selection count in the status bar. **Select matching** selects the same five sessions again, the summary reads 214 / 17h 50m, and the status bar reads `5 selected` again.
- **Expect (negative):** Including a session's frames applies no quality action; every frame still reads Unreviewed. **Select matching** with Available does not select 12 Sep.
- **Trace:** flow C5 · VSEL-FR-06, VSEL-FR-08 · D02 · HARNESS-V5-FEEDBACK-R1.md Round 5 P-SB3 (selection count)

### S7 — Keep the selection while browsing {#S7}

- **Do:** Sort by two different columns, change page if the table pages, toggle **Sky coverage**, click a footprint, then click a row.
- **Expect:** The selection stays five sessions throughout. Clicking a footprint highlights its session row, and clicking a row highlights its footprint.
- **Trace:** flow C5 · VSEL-FR-06, VSEL-FR-07 · VSEL-AC-03

### S8 — Handle an offline candidate {#S8}

- **Do:** Check the 12 Sep session and read its state. Then clear its checkbox.
- **Expect:** While selected it reads Offline, its 24 last-observed frames are marked unverified, and the summary names them as unresolved members with reconnect, locate and remove offered. After it is cleared the selection is five sessions, the summary reads 214 / 17h 50m with no unresolved member, and the list still shows 12 Sep as an Offline candidate.
- **Expect (negative):** The offline session is never dropped silently or counted as verified.
- **Trace:** flow C6, cross-flow "Location offline" · VSEL-FR-09 · VSEL-AC-09 · D02

### S9 — Save the run {#S9}

- **Do:** Click the Save button, which reads **Save revision 1**. Read the step bar. Open Project `NGC 7000 HOO` and read its members and goals.
- **Expect:** A notice reads "Saved revision 1". The Select footer reads Revision 1 with its save time, and the run holds the five sessions with their reasons. In the step bar Select reads `Saved r1`, and Next no longer reads Save run. The Project lists those five sessions as members through `NGC7000-HOO-Siril`. Ha reads `9h15 in project · 12h35 captured · goal 10h` and OIII reads `8h35 in project · 10h35 captured · goal 12h`. "captured" is unchanged from P1, because every member was already a candidate. Both goals stay unmet.
- **Expect (negative):** The run never reads saved before its write succeeds. Saving changes no quality state and creates no folder on disk. 12 Sep and the Esprit session are not Project members, and no label calls them "not in a run". No goal reads "in project" above "captured". The Project offers no action that assigns a session to itself.
- **Trace:** flow C5 · VSEL-FR-12, VSEL-FR-13, VSEL-FR-16 · PRJ-FR-04, PRJ-FR-21 · PRJ-AC-03, PRJ-AC-10 · root FR-023 · D08, D-W34, D-W36, D-W66 · HARNESS-V5-IA.md Fix pass "Review drafts" (Select keeps "Saved r1")

## Success criteria

- SC1: At S3 the list holds exactly 6 sessions, the selected set is exactly {18, 24, 26, 28, 30 Sep}, and 0 Esprit sessions appear at S3 or S5.
- SC2: 24 Sep shows no numeric distance at S3 or S4, and 0 sessions show a distance of 0.
- SC3: The selected set stays exactly five sessions through S5 and S7; under the Ha filter the hidden-selected count is 3.
- SC4: S5 starts 0 measurement jobs and changes 0 quality states.
- SC5: The summary reads 214 / 17h 50m at S6 and after S8; 12 Sep is named unresolved while selected and leaves only by explicit clearing.
- SC6: After S9 the run holds saved membership revision 1 with five sessions. The Project reads Ha 9h15 in project and 12h35 captured, and OIII 8h35 in project and 10h35 captured.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the harness v5 design (`apps/prototype/design/HARNESS-V5-IA.md` S5 and Fix pass, `HARNESS-V5-FEEDBACK-R1.md` Round 5, on `ui-harness-v5` @ b5e813a5), the specs at d45a22ad, the defaults set in decisions D01, D02 and D08 and workflow decisions D-W3, D-W33, D-W34, D-W37, D-W49, D-W50, D-W66 and D-W72. No implementation has been validated against them.
- G2: Unresolved implementation qualification: the footprint overlap used for ordering (D01) has no fixed value. The S3 fixture geometry must order the footprint sessions by an unambiguous margin once the value is chosen. Blocks readiness.
- G3: Out of scope for this journey: D08 stale-overwrite refusal with reload/review needs a second concurrent writer and is not exercised. Blocks readiness until covered by a step or a journey.
- G4: Covered elsewhere: choosing one subject among several (VSEL-AC-17) is exercised by J14/S2b, where the Start run sheet offers two subjects. Starting a run from a Target in no Project (VSEL-AC-16) no longer exists in the v5 design: a Target page offers Add to Plan, Add to Project or New Project, and runs start only inside a Project (HARNESS-V5-IA.md §Screens S10; J14 v3). VSEL-AC-16 needs a contract amendment.
- G5: Unresolved product question: the harness v5 Select step lists candidates by night with Night, Channel, Frames, Integration, Reason and State columns, a channel filter and "Selected only". It shows no Sky coverage, no distance or footprint evidence, no overlap ordering, no Missing OBJECT, quality or expanded filters, no search, and no Show selected or Select matching, and the v5 IA neither keeps nor drops them. S1, S3 to S7 keep the contract's evidence, ordering, filters and Sky coverage (VSEL-FR-03 to VSEL-FR-07, D-W37) until this is decided. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1 to S9 · behavior-change
  The View becomes processing run `NGC7000-HOO-Siril` in Project `NGC 7000 HOO`, with a fixed subject and rig. Every available Target-and-rig candidate starts selected, replacing geometric preselection and manual inclusion; the standalone View is gone, and Save run feeds "in project".
  Evidence: specs/066-view-selection VSEL-FR-01 to VSEL-FR-03, VSEL-FR-16, VSEL-AC-01, VSEL-AC-18, specs/065-project-goals PRJ-AC-10 and workflow decisions D-W3, D-W33, D-W37, D-W49, D-W50. D-W66 and D-W72 with VSEL-FR-02, RES-FR-10, PRJ-FR-04, PRJ-FR-21 and root FR-023. Rig names `RedCat` and `Esprit` from J15, OIII goal 12h from J20/S4 · by: journey-scribe (intent-gated)
- **Δ3** 2026-10-12 · S1, S2, S6, S9 · behavior-change
  The run header shows status Open with subject and rig as fixed values and Complete and Move to Trash, with no profile. The step bar has exactly one Next, Save run, which focuses Select's Save button and never points at the step being shown.
  The status bar shows the selection count. Save reads "Save revision 1", and Select then reads `Saved r1`.
  Evidence: HARNESS-V5-IA.md §Screens S5 and §Fix pass ("Next never points at the screen it is on", "Review drafts"); HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3; prototype src/features/v5/c-runs/run.tsx, select-step.tsx and messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U3Runs (intent-gated)
