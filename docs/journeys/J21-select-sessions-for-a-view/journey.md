---
id: J21
title: Pick the candidate sessions for a processing run
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [view-review, sessions, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 066-view-selection, D01, D02, D08, D-W3, D-W33, D-W34, D-W37, D-W49, D-W50, D-W64, D-W66, specs/063-clean-rebuild-contract/decisions.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-c-select-sessions-for-a-view]
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

- **Do:** Move along the run's pipeline rail through Select, Review, Calibrate and Prepare, then return to Select. Toggle **Sky coverage** on and off.
- **Expect:** The rail lists Select, Review, Calibrate, Prepare, Results and Done for this run. Each later step opens and names what it still needs: Prepare names the unsaved membership and the profile that is not chosen. Every step shows the same selection. **Sky coverage** shows and hides a linked spatial view. Every step also offers **Abandon run**, which this journey does not use.
- **Expect (negative):** No Next/Back wizard gates movement between steps. Moving between steps saves no revision, creates no folder on disk and starts no measurement.
- **Trace:** flow C1 · VSEL-FR-02 · RES-FR-09 · D-W3, D-W64

### S2 — Read the run's fixed identity {#S2}

- **Do:** Read the run header.
- **Expect:** It reads name `NGC7000-HOO-Siril`, Project `NGC 7000 HOO`, subject NGC 7000, rig `RedCat`, and profile Not chosen. The subject and rig show as fixed values with no edit control.
- **Expect (negative):** No control changes the subject or rig, or moves or shares the run with another Project.
- **Trace:** flow C1 · VSEL-FR-01 · D-W8, D-W50

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
- **Expect:** **Show selected** lists exactly the five sessions with their reasons. The summary reports included frames and integration by channel from each session's available frames: Ha 111 / 9h 15m, OIII 103 / 8h 35m, total 214 / 17h 50m, with no unresolved member. Unreviewed and library-Unusable counts stay visible. **Clear selection** leaves zero selected and the summary at 0 lights. **Select matching** selects the same five sessions again, and the summary reads 214 / 17h 50m.
- **Expect (negative):** Including a session's frames applies no quality action; every frame still reads Unreviewed. **Select matching** with Available does not select 12 Sep.
- **Trace:** flow C5 · VSEL-FR-06, VSEL-FR-08 · D02

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

- **Do:** Click **Save run**. Open Project `NGC 7000 HOO` and read its members and goals.
- **Expect:** The run reads membership revision 1, saved, with the five sessions, their reasons and the save time. The Project lists those five sessions as members through `NGC7000-HOO-Siril`. Ha reads `9h15 in project · 12h35 captured · goal 10h` and OIII reads `8h35 in project · 10h35 captured · goal 12h`. "captured" is unchanged from P1, because every member was already a candidate. Both goals stay unmet.
- **Expect (negative):** The run never reads saved before its write succeeds. Saving changes no quality state and creates no folder on disk. 12 Sep and the Esprit session are not Project members, and no label calls them "not in a run". No goal reads "in project" above "captured". The Project offers no action that assigns a session to itself.
- **Trace:** flow C5 · VSEL-FR-12, VSEL-FR-13, VSEL-FR-16 · PRJ-FR-04, PRJ-FR-21 · PRJ-AC-03, PRJ-AC-10 · root FR-023 · D08, D-W34, D-W36, D-W66

## Success criteria

- SC1: At S3 the list holds exactly 6 sessions, the selected set is exactly {18, 24, 26, 28, 30 Sep}, and 0 Esprit sessions appear at S3 or S5.
- SC2: 24 Sep shows no numeric distance at S3 or S4, and 0 sessions show a distance of 0.
- SC3: The selected set stays exactly five sessions through S5 and S7; under the Ha filter the hidden-selected count is 3.
- SC4: S5 starts 0 measurement jobs and changes 0 quality states.
- SC5: The summary reads 214 / 17h 50m at S6 and after S8; 12 Sep is named unresolved while selected and leaves only by explicit clearing.
- SC6: After S9 the run holds saved membership revision 1 with five sessions. The Project reads Ha 9h15 in project and 12h35 captured, and OIII 8h35 in project and 10h35 captured.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Product behavior follows the specs at d45a22ad and the defaults set in decisions D01, D02 and D08 and workflow decisions D-W3, D-W33, D-W34, D-W37, D-W49, D-W50, D-W64 and D-W66. No implementation has been validated against them.
- G2: Unresolved implementation qualification: the footprint overlap used for ordering (D01) has no fixed value. The S3 fixture geometry must order the footprint sessions by an unambiguous margin once the value is chosen. Blocks readiness.
- G3: Out of scope for this journey: D08 stale-overwrite refusal with reload/review needs a second concurrent writer and is not exercised. Blocks readiness until covered by a step or a journey.
- G4: Out of scope for this journey: choosing one subject among several (VSEL-AC-17) is not exercised. Blocks readiness until covered by a step or a journey. Starting a run from a Target in no Project (VSEL-AC-16) is covered by J14/S3 to J14/S5.

## Delta log

- **Δ2** 2026-10-06 · S1 to S9 · behavior-change
  The View becomes processing run `NGC7000-HOO-Siril` in Project `NGC 7000 HOO`, with a fixed subject and rig. Every available Target-and-rig candidate starts selected, replacing geometric preselection and manual inclusion; the standalone View is gone, and Save run feeds "in project".
  Evidence: specs/066-view-selection VSEL-FR-01 to VSEL-FR-03, VSEL-FR-16, VSEL-AC-01, VSEL-AC-18, specs/065-project-goals PRJ-AC-10 and workflow decisions D-W3, D-W33, D-W37, D-W49, D-W50. D-W64 and D-W66 with VSEL-FR-02, RES-FR-09, PRJ-FR-04, PRJ-FR-21 and root FR-023 at d45a22ad. Rig names `RedCat` and `Esprit` from J15, OIII goal 12h from J20/S4 · by: journey-scribe (intent-gated)
