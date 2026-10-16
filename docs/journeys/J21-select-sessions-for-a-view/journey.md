---
id: J21
title: Select sessions for a Project View
version: 5
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [projects, sessions, view]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 066-view-selection, D01, D02, D08, D-W3, D-W33, D-W34, D-W37, D-W49, D-W50, D-W66, D-W72, specs/063-clean-rebuild-contract/decisions.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-c-select-sessions-for-a-view, HARNESS-V5-IA.md#S5, HARNESS-V5-IA.md#fix-pass, HARNESS-V5-FEEDBACK-R1.md#round-5, P-SB3, HARNESS-V5-FEEDBACK-R1.md#round-6, 064-library-inventory, 068-calibration-inputs, 069-application-handoff, 070-results-reuse, D-W93, D-W94, D-W95, D-W96, D-W97, D-W98, D-W99, D-W100, D-W101, D-W102, D-W103, D-W104, D-W105, D-W106, FR-033, FR-034, FR-035, LIB-FR-17, LIB-FR-20, LIB-FR-23, CAL-FR-09, PRJ-FR-04, PRJ-FR-07, PRJ-FR-08, PRJ-FR-09, PRJ-FR-27, PRJ-FR-31, VSEL-FR-02, VSEL-FR-03, VSEL-FR-04, VSEL-FR-05, VSEL-FR-06, VSEL-FR-07, VSEL-FR-08, VSEL-FR-09, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16]
---

## Goal

On the Sessions step of Project `NGC 7000 HOO`, the user reviews suggestions,
checks geometry and ordering, filters and sorts without losing a selection, and
adds the four available RedCat sessions. The offline 12 Sep session and the
Esprit session are not added, and 30 Sep, which still needs review, is not
suggested (J22 reviews and adds it). The user reviews the Apply sheet and builds
the Project's View from originals. Done means the Project holds the four
sessions, with 166 lights / 13h 50m in its View and no unresolved input. The
Project counts those sessions "in project" and its matching suggestions as
"captured".

## Preconditions

- P1: J20 completed through S9. Project `NGC 7000 HOO` has subject NGC 7000, rigs `RedCat` and `Esprit`, goals Ha 10h and OIII 12h (if J20/S9 changed the goals, J20/G9, the validator sets them back to these values first), and no held sessions. It suggests the five RedCat sessions 12, 18, 24, 26 and 28 Sep and the other-camera Esprit session. Ha reads `0h00 in project · 12h35 captured · goal 10h` and OIII reads `0h00 in project · 6h35 captured · goal 12h`. No View exists yet.
- P2: The J19 catalog holds the five Ready, fully reviewed RedCat sessions 12, 18, 24, 26 and 28 Sep with settled calibration, confirmed Target NGC 7000 and confirmed rig `RedCat`. The 30 Sep session reads Needs review with its 48 frames Unreviewed, so the Project doesn't suggest it (J20/P1). `Cold-1` is offline, so 12 Sep reads Offline with 24 last-observed OIII frames. The Ready, reviewed and calibrated other-camera session holds 40 Ha 300 s lights with confirmed Target NGC 7000 and rig `Esprit`.
- P3: No frame measurement has been computed for any fixture frame.

## Steps

### S1 — Orient on the Project page {#S1}

- **Do:** Open Project `NGC 7000 HOO`. Read the steps Sessions, Calibrate, View, Output and Wrap up. On Sessions, toggle **Sky coverage** on and off; open Calibrate and read its diagram, then return to Sessions.
- **Expect:** The Project page lists Sessions, Calibrate, View, Output and Wrap up. Calibrate is a read-only check with a WBPP-style diagram of the groups, nights and pinned calibration or No choices. **Sky coverage** shows and hides the linked spatial view. View holds the application, the input mode and **Apply…**; Symlinks is the default mode.
- **Expect (negative):** Reading Project steps or the calibration diagram makes no calibration assignment, changes no source file and builds no View. Moving between steps creates no membership revision and computes no measurement.
- **Trace:** PRJ-FR-07, PRJ-FR-27, PRJ-FR-31 · CAL-FR-09 · VSEL-FR-02, VSEL-FR-07 · FR-033, FR-035 · D-W94, D-W95, D-W101

### S2 — Read the Project identity {#S2}

- **Do:** Read the Project name, subjects, rigs and goals.
- **Expect:** The Project is named `NGC 7000 HOO`, has subject NGC 7000, rigs `RedCat` and `Esprit`, and goals Ha 10h and OIII 12h. Sessions, groups and suggestions belong to the Project; neither a per-session Project membership revision nor a separate per-rig processing workspace exists.
- **Expect (negative):** Adding or removing a subject or rig changes suggestions only. Sessions already held by the Project remain in their groups.
- **Trace:** PRJ-FR-01, PRJ-FR-02, PRJ-FR-08, PRJ-FR-27 · VSEL-FR-01 · D-W94, D-W96

### S3 — Read the suggestions {#S3}

- **Do:** On Sessions, open **Add sessions…** and read the suggestions.
- **Expect:** The suggestions list has five RedCat sessions and the Esprit session, each with its match reason. It does not select or add them automatically. 12 Sep is Offline with 24 last-observed OIII frames. Each row shows session, date/time, channel, exposure, frame count, integration, availability, distance and footprint evidence. Sessions with a footprint sort by overlap and angular separation; 18 Sep (pointing only) follows them, and 24 Sep (Position unknown) comes last. The available RedCat sessions total 166 lights / 13h 50m.
- **Expect (negative):** No suggestion joins the Project until the user adds it. The `Cygnus field` OBJECT label neither changes its Target nor removes the session from suggestions. The 30 Sep session is not listed, because it still needs review.
- **Trace:** PRJ-FR-08, PRJ-FR-09, PRJ-FR-27, PRJ-FR-31 · VSEL-FR-03, VSEL-FR-04, VSEL-FR-08 · LIB-FR-20, LIB-FR-23 · D-W94, D-W95, D-W96, D-W105

### S4 — Inspect geometry evidence {#S4}

- **Do:** Open the geometry evidence of 28 Sep, 18 Sep and 24 Sep in **Add sessions…**.
- **Expect:** 28 Sep shows **FOV from confirmed equipment** with its inputs (image dimensions, effective focal length, pixel scale, binning). 18 Sep shows a distance from its pointing and no footprint. 24 Sep reads **Position unknown** and has no distance value. Missing geometry does not prevent adding a suggestion to the Project.
- **Expect (negative):** Neither 18 Sep nor 24 Sep shows a distance of 0 or a footprint derived from its Target or an OBJECT label. Geometry never removes a suggestion.
- **Trace:** VSEL-FR-03, VSEL-FR-04 · VSEL-AC-02 · PRJ-FR-31 · D-W95, D-W96

### S5 — Filter and sort {#S5}

- **Do:** In **Add sessions…**, set channel Ha. Replace it with **Missing OBJECT**, then with availability Offline. Open the expanded filter controls, sort by sky distance, clear all filters and search for `other camera`.
- **Expect:** With Ha, an active filter chip and matching-session count appear. **Missing OBJECT** matches only 24 Sep. Offline matches 12 Sep, whose measurement columns read **Not measured**. The expanded controls offer gain, offset, binning, temperature, rig and group. Sorting by sky distance orders sessions with evidence; 24 Sep has no distance value. Searching `other camera` finds the Esprit suggestion.
- **Expect (negative):** Filters change the suggestion list, not session definitions. No filter starts a measurement or changes a frame's library quality.
- **Trace:** VSEL-FR-05, VSEL-FR-06 · VSEL-AC-03 · D-W95, D-W96

### S6 — Review, clear and restore the selection {#S6}

- **Do:** Clear filters, set rig `RedCat` and availability Available, then select the four matching sessions. Clear that selection and use **Select matching** with the same filters.
- **Expect:** The selection contains exactly the four available RedCat sessions. The summary reports their available frames and integration by channel: Ha 111 / 9h 15m, OIII 55 / 4h 35m, total 166 / 13h 50m, with no unresolved input. Unusable and Unreviewed counts remain visible. Clearing selection leaves zero selected and a summary of 0 lights; **Select matching** restores the same four sessions and 166 / 13h 50m.
- **Expect (negative):** Selecting sessions changes no library quality. **Select matching** with Available does not select 12 Sep.
- **Trace:** VSEL-FR-06, VSEL-FR-08 · D-W95, D-W96

### S7 — Keep the selection while browsing {#S7}

- **Do:** Sort by two different columns, change page if the table pages, toggle **Sky coverage**, click a footprint, then click a suggestion row.
- **Expect:** The selected set stays the same four sessions throughout. Clicking a footprint highlights its suggestion row, and clicking a row highlights its footprint.
- **Trace:** VSEL-FR-06, VSEL-FR-07 · VSEL-AC-03 · D-W95, D-W96

### S8 — Handle an offline suggestion {#S8}

- **Do:** Select the 12 Sep suggestion and read its state. Then clear its checkbox.
- **Expect:** While selected, 12 Sep reads Offline and its 24 last-observed frames are marked unverified. The summary names them as unresolved inputs and offers reconnect, locate and remove. After it is cleared, four sessions remain selected and the summary reads 166 / 13h 50m with no unresolved input; 12 Sep remains an Offline suggestion.
- **Expect (negative):** The offline session is never dropped silently or counted as verified. It is not added to the Project.
- **Trace:** VSEL-FR-09 · VSEL-AC-09 · D-W100

### S9 — Add sessions and apply the View {#S9}

- **Do:** Confirm adding the four selected sessions to Project `NGC 7000 HOO`. On View, choose **Apply…**, review the change list and folder tree, then apply. Read the Project's sessions, groups and goals.
- **Expect:** The Project's Sessions step lists the four added RedCat sessions in groups by rig and framing. The Apply sheet lists the additions and the resulting View tree; after Apply, `NGC 7000 HOO/View/` holds the four sessions. Ha reads `9h15 in project · 12h35 captured · goal 10h` and OIII reads `4h35 in project · 6h35 captured · goal 12h`. "captured" is unchanged from P1 because these sessions were already suggestions. Both goals stay unmet.
- **Expect (negative):** Apply makes no change if any original it needs is Offline; this Apply needs only the four online originals. It changes no library quality state and creates no folder beside or from the original captures. 12 Sep, 30 Sep and the Esprit session are not held by the Project. No goal reads "in project" above "captured".
- **Trace:** PRJ-FR-04, PRJ-FR-07, PRJ-FR-08, PRJ-FR-27, PRJ-FR-31 · VSEL-FR-12, VSEL-FR-14, VSEL-FR-16 · FR-033, FR-034 · D-W94, D-W95, D-W96, D-W100

## Success criteria

- SC1: At S3 the suggestion list holds 5 RedCat and 1 Esprit session; the selection at S6 and S9 is exactly {18, 24, 26, 28 Sep}.
- SC2: 24 Sep shows no numeric distance at S3 or S4, and 0 sessions show a distance of 0.
- SC3: The selected set stays exactly four sessions through S5 and S7; under the Ha filter the matching-session count is observable and selection is unchanged.
- SC4: S5 computes 0 frame measurements and changes 0 library quality states.
- SC5: The summary reads 166 / 13h 50m at S6 and after S8; 12 Sep is named unresolved while selected and leaves the selection only by explicit clearing.
- SC6: After S9 the Project holds exactly four RedCat sessions and its View contains them. The Project reads Ha 9h15 in project and 12h35 captured, and OIII 4h35 in project and 6h35 captured.

## Known gaps

- G1: Not validated: the rebuilt application does not exist. Expected behavior follows specs 063 to 072 at head and workflow decisions D-W93 to D-W116. No implementation has been validated against the F4 Project model.
- G2: Unresolved implementation qualification: the footprint overlap used for ordering (D01) has no fixed value. The S3 fixture geometry must order the footprint sessions by an unambiguous margin once the value is chosen. Blocks readiness.
- G3: Out of scope for this journey: D08 stale-overwrite refusal with reload/review needs a second concurrent writer and is not exercised. Blocks readiness until covered by a step or a journey.
- G4: (dissolved 2026-10-15): D-W94 removes processing runs, so no Start run sheet chooses one subject among several (VSEL-AC-17) and no run starts from a Target (VSEL-AC-16). A Project may hold several Target subjects (PRJ-FR-01); this journey adds sessions to the Project and builds its View.
- G5: (dissolved 2026-10-12): answered by Round 6 "Select keeps the selection tools from spec 066"; S1 and S7 now assert the linked Sky coverage view, S3 and S4 the distance from the Target, footprint evidence and geometry ordering, S5 the quality, Missing OBJECT and expanded filters, search and the hidden-selection count (`Selected outside current filters: 3`), and S6 Show selected and Select matching (VSEL-FR-03 to VSEL-FR-07, D-W37).
- G6: Rests on provisional F4 items, pending the owner's confirmation in PR #1804: D-W96's matching rule and its "captured" count of every matching suggestion (S3, S9), D-W94's rig list that only decides suggestions (S2), and D-W100's rule that the first Apply builds the View with no separate Start processing (S9). If the owner changes one, the steps that cite it change.

## Delta log
- **Δ2** 2026-10-06 · S1 to S9 · behavior-change
  The View becomes processing run `NGC7000-HOO-Siril` in Project `NGC 7000 HOO`, with a fixed subject and rig. Every available Target-and-rig candidate starts selected, replacing geometric preselection and manual inclusion; the standalone View is gone, and Save run feeds "in project".
  Evidence: specs/066-view-selection VSEL-FR-01 to VSEL-FR-03, VSEL-FR-16, VSEL-AC-01, VSEL-AC-18, specs/065-project-goals PRJ-AC-10 and workflow decisions D-W3, D-W33, D-W37, D-W49, D-W50. D-W66 and D-W72 with VSEL-FR-02, RES-FR-10, PRJ-FR-04, PRJ-FR-21 and root FR-023. Rig names `RedCat` and `Esprit` from J15, OIII goal 12h from J20/S4 · by: journey-scribe (intent-gated)
- **Δ3** 2026-10-12 · S1, S2, S6, S9 · behavior-change
  The run header shows status Open with subject and rig as fixed values and Complete and Move to Trash, with no profile. The step bar has exactly one Next, Save run, which focuses Select's Save button and never points at the step being shown.
  The status bar shows the selection count. Save reads "Save revision 1", and Select then reads `Saved r1`.
  Evidence: HARNESS-V5-IA.md §Screens S5 and §Fix pass ("Next never points at the screen it is on", "Review drafts"); HARNESS-V5-FEEDBACK-R1.md §Round 5 P-SB3; prototype src/features/v5/c-runs/run.tsx, select-step.tsx and messages/en-GB.json (apps/prototype/ on ui-harness-v5 @ b5e813a5); user instruction 2026-10-12 · by: JourneysV5.U3Runs (intent-gated)
- **Δ4** 2026-10-12 · S1, S3, S4, S5, S6, S7 · behavior-change
  The Select step keeps spec 066's selection tools in harness v5: Sky coverage, distance from the Target, footprint evidence and geometry ordering, the filters and search, Show selected, Select matching and the hidden-selection count.
  The run header also offers Rename.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Select keeps the selection tools from spec 066", "Rename runs and Projects" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6B (intent-gated)
- **Δ5** 2026-10-15 · S1, S2, S3, S4, S5, S6, S7, S8, S9 · behavior-change
  The Project's Sessions step holds user-added sessions in groups by rig and framing, with matching suggestions kept separate. Selecting and adding sessions updates the Project's desired inputs; Apply builds its View from originals, without membership revisions. J21 owns adding sessions and the first Apply; J20/S8 no longer adds any. 30 Sep still needs review, so J21 adds four sessions (166 lights / 13h 50m) and leaves 30 Sep for J22/S10. G4 is dissolved and G6 is new.
  Evidence: D-W78, D-W93 to D-W106 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, FR-033 to FR-035, CAL-FR-09, LIB-FR-17, LIB-FR-20, LIB-FR-23, PRJ-FR-04, PRJ-FR-07 to PRJ-FR-09, PRJ-FR-27, PRJ-FR-31, VSEL-FR-02 to VSEL-FR-09, VSEL-FR-12, VSEL-FR-14, VSEL-FR-16 · by: SpecF4Writer2 (intent-gated)
