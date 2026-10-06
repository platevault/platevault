---
id: J20
title: Open a Target and set up its required Project with rigs and goals
version: 2
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [targets, projects, planning, settings, view-review]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 066-view-selection, 072-observing-plans, D07, D10, D12, D18, D-W1, D-W3, D-W9, D-W16, D-W29, D-W30, D-W33, D-W34, D-W36, D-W37, D-W39, D-W47, D-W49, D-W50, D-W62, D-W64, D-W65, D-W66, D-W71, specs/063-clean-rebuild-contract/decisions.md, specs/063-clean-rebuild-contract/workflow-decisions.md, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/066-view-selection/spec.md, specs/072-observing-plans/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-b-target-and-optional-project]
---

## Goal

The user opens a Target to see what the library holds for it, then sets up the
Project that every processing run needs: subject, rigs and goals from a
template. They read the candidates PlateVault derives, compare planning sites
and start the first processing run from the Project page. Done means:

- The Target page shows captured, usable and Unreviewed integration per channel, with the offline contribution labelled Offline.
- The Project's candidates are exactly the sessions whose confirmed Target is NGC 7000 and whose rig is a Project rig. Nothing is assigned to the Project itself.
- Goal progress reads "in project" and "captured", "captured" never reads below "in project", and every goal is unmet while no run has a saved membership.
- Switching planning site changes only visibility.
- The run `NGC7000-HOO-Siril` opens at Select inside the Project. A rig or subject that a run that is not Abandoned uses cannot be removed.
- Project edits change no file, quality state or run.

## Preconditions

- P1: J19 completed through S15 (`Cold-1` is offline). All seven light sessions have confirmed Target NGC 7000. The six RedCat sessions read rig `RedCat`, and the other-camera session reads rig `Esprit`.
- P2: Settings holds two saved sites: Backyard and `Remote site` (J15/S6, J15/S7), at least 15° of longitude and one time zone away from Backyard. No site is designated default (J29 sets it).
- P3: No Project and no processing run exist.
- P4: The J19/P5 manifest is available.

## Steps

### S1 — Open NGC 7000 {#S1}

- **Do:** Launch PlateVault. From Home, open Targets, search for NGC 7000 and open its Target page.
- **Expect:** Home is the first surface shown, not the Targets list. The Target page shows captured integration, library-wide usable integration and Unreviewed integration by channel. Ha reads captured 12h 35m (151 frames) and OIII reads captured 10h 35m (127 frames). Usable reads 0h 00m for both, and Unreviewed equals captured for each channel. Availability is shown as a separate state: the 12 Sep OIII contribution counts in captured integration with its last-observed values and reads Offline.
- **Expect (negative):** The 12 Sep contribution is not offered as an available processing input. Search needs no network connection.
- **Trace:** flow B1 · LIB-FR-08, LIB-FR-10 · LIB-AC-05, LIB-AC-09 · D18, D-W39

### S2 — Create the Project from the Target {#S2}

- **Do:** On the Target page, click **New Project**. Enter `NGC 7000 HOO` and a note. Confirm the prefilled subject NGC 7000, add rig `RedCat`, and apply the built-in HOO goal template. Save.
- **Expect:** The form opens with subject NGC 7000 filled in and offers to add further subjects or a mosaic. The template list offers HOO, SHO, LRGB, OSC broadband and OSC dual-band plus any user templates, and it is the same list whichever rig is chosen. Applying HOO copies Ha 10h and OIII 10h into the Project as goals for NGC 7000.
- **Expect (negative):** No goal kind for exposure preference, equipment or a mixed-equipment check is offered.
- **Trace:** flow B2 · PRJ-FR-01, PRJ-FR-02, PRJ-FR-03, PRJ-FR-12 · PRJ-AC-01, PRJ-AC-07, PRJ-AC-14 · PLAN-EQ-AC-05 · D-W9, D-W29, D-W30, D-W47

### S3 — Read the derived candidates {#S3}

- **Do:** Open the Project page and read its candidates and members.
- **Expect:** The candidates are exactly the six RedCat sessions: 12, 18, 24, 26, 28 and 30 Sep. Each one shows why it is a candidate (subject NGC 7000, rig `RedCat`). Members are empty, because no run exists.
- **Expect (negative):** The other-camera session is not a candidate, because its rig is not on the Project. The Project page offers no action that assigns a session to the Project itself.
- **Trace:** Projects surface · PRJ-FR-08, PRJ-FR-09 · PRJ-AC-06, PRJ-AC-09, PRJ-AC-10 · root FR-018, FR-019 · D-W33, D-W34, D-W37

### S4 — Read goal progress, edit a goal and add a rig {#S4}

- **Do:** Read the goals. Change the OIII goal to 12h. Open Settings > Goal templates and read HOO. Back on the Project page, add rig `Esprit` and save.
- **Expect:** Before the edit, Ha reads `0h00 in project · 9h15 captured · goal 10h` and OIII reads `0h00 in project · 10h35 captured · goal 10h`. "captured" counts the six candidates, because no run has members. Both are unmet, although OIII captured exceeds its goal. After the edit OIII reads `goal 12h`, and Settings still shows HOO with OIII 10h. After adding the rig, the other-camera session is a seventh candidate and Ha reads `0h00 in project · 12h35 captured · goal 10h`. The Projects list on Home shows the Project with these goals and no run.
- **Expect (negative):** Editing a copied goal changes no template and no other Project. "captured" never reads lower than "in project", and no label reads "not in a run".
- **Trace:** flow B2 · PRJ-FR-02, PRJ-FR-04, PRJ-FR-12, PRJ-FR-21 · PRJ-AC-01, PRJ-AC-03, PRJ-AC-09, PRJ-AC-14 · root FR-019, FR-023 · D-W36, D-W37, D-W66

### S5 — Confirm the Project had no side effects {#S5}

- **Do:** Recompute the manifest of the online fixture folders and open Sessions. Compare Cold-1's manifest entries only after it is remounted, then eject it again for the next step.
- **Expect:** Online paths and hashes equal their matching J19/P5 entries, and Cold-1 matches after remount. No processing run exists. Every frame still reads Unreviewed.
- **Expect (negative):** Creating or editing the Project moved, renamed or wrote no file, created no run, and changed no quality state.
- **Trace:** flow B2 · PRJ-FR-05 · PRJ-AC-02

### S6 — Inspect capture sites {#S6}

- **Do:** On the Project page, open the candidate list.
- **Expect:** Each candidate shows its own capture site: 12 Sep reads `Remote site` and the Astro-T7 sessions read Backyard. The Project has no single capture-site field.
- **Trace:** flow B3 · PRJ-FR-06 · PRJ-AC-04

### S7 — Compare planning sites and open the Planner {#S7}

- **Do:** In the Project page's planning, choose Backyard, then `Remote site` in the planning site selector. Click **Open in Planner**, read the Targets page, then clear the Project context.
- **Expect:** Project planning lists windows for NGC 7000 only. Each change of site recalculates the windows and names that site and its time zone. **Open in Planner** opens Targets limited to NGC 7000 with the Project context shown. The rig selector reads "this Project's rigs", Fit shows one value per rig labelled with the rig's name, and the Filters strip shows the union of both rigs' bands. Clearing the context returns the list to My targets.
- **Expect (negative):** Candidates, their capture sites and the Project's subjects and rigs are identical before and after. Notifications stay disabled and no reminder is scheduled.
- **Trace:** flow B3 · PLAN-FR-01, PLAN-FR-09, PLAN-FR-10 · PLAN-AC-01, PLAN-AC-10, PLAN-TGT-AC-14 · D07, D-W16, D-W62

### S8 — Start a processing run from the Project {#S8}

- **Do:** On the Project page, click **Start a processing run**. Choose subject NGC 7000 and rig `RedCat`, and name the run `NGC7000-HOO-Siril`.
- **Expect:** The run is created inside `NGC 7000 HOO` and opens at its Select step. The stage rail lists `NGC7000-HOO-Siril` at Select. The picker lists the six RedCat candidates. The five available ones (18, 24, 26, 28 and 30 Sep) start selected, and 12 Sep is flagged Offline. Every goal is still unmet with 0h00 in project, because no membership is saved yet, and Ha still reads 12h35 captured.
- **Expect (negative):** The picker lists no Esprit session. No run folder is created on disk and no quality state changes.
- **Trace:** flow B4 · VSEL-FR-01, VSEL-FR-02, VSEL-FR-03, VSEL-FR-09 · VSEL-AC-01, VSEL-AC-18 · PRJ-FR-04, PRJ-FR-10, PRJ-FR-20 · D-W3, D-W37, D-W49, D-W50

### S9 — Try to remove the run's rig and subject {#S9}

- **Do:** Return to the Project page and try to remove rig `RedCat`, then subject NGC 7000. Then remove rig `Esprit` and add it back.
- **Expect:** Removing `RedCat` is refused, and the refusal names the run `NGC7000-HOO-Siril`, which is at Select and not Abandoned. Removing subject NGC 7000 is refused the same way and names the same run. Removing `Esprit`, which no run uses, succeeds: the other-camera session stops being a candidate, is a member of no run, and Ha captured reads 9h15 again. Adding `Esprit` back restores the seventh candidate and Ha captured 12h35.
- **Expect (negative):** The refused removals change neither the Project's subjects and rigs nor the run's subject, rig or picker.
- **Trace:** Projects surface · PRJ-FR-02, PRJ-FR-04 · PRJ-AC-06, PRJ-AC-25 · 065 edge case "Removing a subject or a rig is refused while any run that is not Abandoned uses it" · D-W37, D-W65, D-W66, D-W71

## Success criteria

- SC1: At S1, usable reads 0h 00m per channel, Unreviewed equals captured per channel, and 12 Sep reads Offline and unavailable.
- SC2: The Project has exactly 6 candidates and 0 members at S3, and 7 candidates after S4. Ha reads 0h00 in project and 12h35 captured after S4.
- SC3: Zero file or quality-state changes and zero runs exist through S5.
- SC4: The S7 windows differ between the two sites, while candidates and capture sites are identical (S6, S7).
- SC5: Exactly 1 run exists after S8. Its picker lists 6 sessions with 5 selected and 0 Esprit sessions, and every goal is unmet.
- SC6: The S9 removals of `RedCat` and of subject NGC 7000 are each refused and name `NGC7000-HOO-Siril`. The Project ends S9 with 2 rigs and subject NGC 7000.

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the specs at d45a22ad and the defaults set in decisions D07, D10, D12, D18 and the 2026-10-06 workflow decisions. No implementation has been validated against them.
- G2: Out of scope for this journey: mosaic subjects (panels by centre and rotation, run groups) are covered by J33, not here.
- G3: Unresolved implementation qualification: J15/S6 and J15/S7 save the P2 sites, but J15/G8 records that the flow names no Settings pane or label for observing sites. Blocks readiness.
- G4: Out of scope for this journey: external resolver enrichment of a saved target, its provider provenance and a resolver failure (LIB-AC-12, D18) are not exercised. Blocks readiness until covered by a step or a journey.
- G5: Out of scope for this journey: removing a rig or subject used only by an Abandoned run succeeds (PRJ-AC-25), but no run here is Abandoned, so that branch is not exercised. Blocks readiness until covered by a step or a journey.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S4, S5, S6, S7, S8, +S9 · behavior-change
  A Project is now required for every processing run and holds subjects, rigs and goals from templates. Candidates are derived from confirmed Target and rig, so S3 reads them instead of linking sessions. Goals read "in project" and "captured" (candidates plus run members), and the exposure preference is dropped. Home opens first, Open in Planner uses the Project's rigs, S8 starts the run `NGC7000-HOO-Siril`, and S9 checks that a rig or subject in use by a run that is not Abandoned cannot be removed.
  Evidence: D-W1, D-W3, D-W9, D-W16, D-W29, D-W30, D-W33, D-W34, D-W36, D-W37, D-W39, D-W50; 065 PRJ-FR-01 to PRJ-FR-12, PRJ-FR-20; 066 VSEL-FR-01; 072 PLAN-FR-10 at e4476231; D-W64, D-W65, D-W66, D-W71; 065 PRJ-FR-02, PRJ-FR-04, PRJ-FR-20, PRJ-FR-21, PRJ-AC-25; root FR-023 at d45a22ad; rig names `RedCat`, `Esprit` and site `Remote site` from J15 · by: agent (intent-gated, user instruction)
