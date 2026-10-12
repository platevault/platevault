---
id: J35
title: Find, favourite and narrow Targets on the Targets page's All view with search, presets, a rig selector and Fit
version: 2
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [targets, planning, equipment, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 072-observing-plans, D17, D18, D-W16, D-W17, D-W18, D-W19, D-W23, D-W31, D-W37, D-W60, D-W61, D-W62, specs/072-observing-plans/spec.md, specs/065-project-goals/spec.md, HARNESS-V5-IA.md#S10, HARNESS-V5-IA.md#S3, HARNESS-V5-IA.md#S16, HARNESS-V5-FEEDBACK-R1.md#round-5, P-PLAN2, "HARNESS-V5-FEEDBACK-R1.md#round-5 Click a result to act", "HARNESS-V5-FEEDBACK-R1.md#round-5 Best tonight shows nothing", apps/prototype/src/features/v5/e-targets-plan-settings/targets.tsx @b5e813a5, apps/prototype/messages/en-GB.json @b5e813a5]
---

## Goal

The user opens the Targets page, sees their own Targets on the All view with the
night's planning columns and a compact altitude sparkline, finds and adds new
Targets through search, browses the bundled catalogues, and narrows the list with
presets and a rig. Done means: My targets lists exactly the ★ favourites plus
every open Project subject with its Project badge. Search names each result's
source, and clicking a result adds that Target; no result row carries an Add
button. Browse catalogues lists nothing until a catalogue or preset is chosen.
Best tonight lists only Targets with a usable window, best first. A saved preset
survives a restart. With a rig selected, the Filters strip shows only that rig's
bands, narrowband presets follow its filters, and Fit reads per rig. Nothing on
the page writes library data except ★ and adding a Target from a result.

## Preconditions

- P1: Fresh replay of J15, J19 and J20, with J21 to J34 not run. The rigs `RedCat` and `Esprit` exist as J15 left them. `RedCat` is mono with the filters Ha, OIII and Halpha and a field of about 5.4° × 3.6°. `Esprit` is OSC with an empty filter list and a field of about 1.2° × 1.2°. Settings holds Backyard and `Remote site`. Project `NGC 7000 HOO` is open as J20 left it: subject NGC 7000, rigs `RedCat` and `Esprit`, and the run `NGC7000-HOO-Siril` at Select with no saved membership. Seven sessions, six on `RedCat` and one on `Esprit`, have confirmed Target NGC 7000. No Target is marked ★.
- P2: A second open Project `Summer nebulae`, created with New Project as in J20, has the single subject IC 1396 and the rigs `RedCat` and `Esprit`, and no run. IC 1396 is not marked ★.
- P3: The bundled catalogues (Messier, NGC, IC, Sharpless, LBN, LDN, Caldwell, Barnard) are installed. SIMBAD is reachable until S6, and a network control can then block it (G2).
- P4: The planning site picker reads Backyard and the header date picker reads tonight, its default. A development-build clock control (D17) fixes tonight to one date, so the S1 and S3 values can be compared.
- P5: Backyard lies north of 43° N, so NGC 5139 (declination about −47°) never rises above its horizon there.

## Steps

### S1 — Open the Targets page {#S1}

- **Do:** Open the Targets page from main navigation, then hover or focus the altitude sparkline of the NGC 7000 row.
- **Expect:** The All view is selected, showing My targets, and the header date picker reads tonight. My targets lists exactly NGC 7000, with a `NGC 7000 HOO` badge, and IC 1396, with a `Summer nebulae` badge. The columns are ★, Designation, Type, the altitude sparkline, Max alt, Lunar, Img time, Filters, Opposition, Sessions and Captured, sorted by Designation ascending. Each sparkline plots altitude across tonight with the dark window shaded and the row's best window marked; NGC 7000's tooltip states a maximum altitude equal to its Max alt and the time it is reached. Moon illumination and phase appear once, in the toolbar, for tonight at Backyard.
- **Expect (negative):** No catalogue object that is neither ★ nor a Project subject is listed. No row repeats the Moon illumination. The page shows no wide altitude timeline.
- **Trace:** Targets page, All view · PLAN-TGT-FR-01, PLAN-TGT-FR-04, PLAN-TGT-FR-07 · PLAN-TGT-AC-01, PLAN-TGT-AC-05, PLAN-TGT-AC-16 · D-W17, D-W18, D-W60 · HARNESS-V5-IA.md S10 · Round 5 P-PLAN2

### S2 — Read Sessions and Captured, and sort {#S2}

- **Do:** Read the NGC 7000 and IC 1396 rows, open NGC 7000's Target page, then return and sort by Img time descending and again ascending.
- **Expect:** NGC 7000's Sessions equals the number of sessions its Target page lists. Its Captured reads Ha 12h 35m, from the Ha sessions on both rigs, and OIII equals the OIII captured integration on its Target page. IC 1396 reads "-" for Sessions. Each sort reorders the rows by Img time, and a row with an unknown value sorts last both times.
- **Expect (negative):** The ★ column offers no sort.
- **Trace:** Targets list · PLAN-TGT-FR-04, PLAN-TGT-FR-08 · PLAN-TGT-AC-08 · D-W18

### S3 — Open a Target's detail from its row {#S3}

- **Do:** Select the NGC 7000 row, read its Target detail, then go back.
- **Expect:** NGC 7000's Target detail opens with tonight at Backyard, its identity, Fit on `RedCat` and on `Esprit`, the Project `NGC 7000 HOO` with its goal lines, and captured time per channel with its sessions. It offers Add to Plan, Add to Project and New Project. The row's Max alt equals the detail's peak altitude tonight, and its Img time equals the total of the detail's windows tonight under the same criteria. Going back restores the All view, its sort and the date picker, because the view lives in the URL.
- **Expect (negative):** Opening and reading the detail changes no ★, plan, Project or session record.
- **Trace:** Targets list, Target detail · PLAN-TGT-FR-05, PLAN-TGT-FR-14, PLAN-FR-08 · PV-PLAN-SC-04 · D-W16, D-W18 · HARNESS-V5-IA.md S10 (Target detail, the view lives in the URL)

### S4 — Toggle a favourite {#S4}

- **Do:** Back on the Targets page, mark IC 1396 ★, then clear its ★.
- **Expect:** The ★ toggles each time. IC 1396 stays listed with its `Summer nebulae` badge in both states.
- **Expect (negative):** Toggling ★ changes no subject of `Summer nebulae` and no Project record.
- **Trace:** Targets list · PLAN-TGT-FR-01 · PLAN-TGT-AC-16 · D-W60

### S5 — Search and add a Target by clicking its result {#S5}

- **Do:** Search `m 31`, then `M31` and `m31`. Click the Messier M 31 result row. Then search `ngc 5139`, click the NGC 5139 result the same way, and clear the search.
- **Expect:** All three queries return the same M 31 matches, from the bundled catalogues and from SIMBAD, each naming its source in the Source column. Clicking the M 31 result adds it: the search stays open, and the result shows it is in My targets. My targets then lists M 31 and NGC 5139 with ★ set, beside NGC 7000 and IC 1396.
- **Expect (negative):** No result row shows an **Add to targets** button; the row's menu keeps the other actions. Before a result is clicked, My targets is unchanged: typing a query writes nothing.
- **Trace:** Targets list · PLAN-TGT-FR-03 · PLAN-TGT-AC-03 · D-W17 · Round 5 "Click a result to act"

### S5a — Read a zero imaging time {#S5a}

- **Do:** Read the NGC 5139 row.
- **Expect:** Img time reads 0 with the altitude reason, and its sparkline marks no best window.
- **Expect (negative):** NGC 5139's Max alt, Img time and Opposition are not left blank without a reason.
- **Trace:** Targets list · PLAN-TGT-FR-05 · PLAN-TGT-AC-06 · D-W18

### S6 — Search without SIMBAD {#S6}

- **Do:** Block SIMBAD with the P3 control, search `m 57`, and click the Messier result row. Unblock SIMBAD.
- **Expect:** Matches from My targets and the bundled catalogues are listed with their sources, and the results state that SIMBAD was not searched ("SIMBAD unreachable"). M 57 joins My targets with ★ set.
- **Expect (negative):** The results do not read as a complete search ("SIMBAD searched" is not shown), and no SIMBAD source is shown.
- **Trace:** Targets list · PLAN-TGT-FR-03 · PLAN-TGT-AC-04 · D-W17 · Round 5 "Click a result to act"

### S7 — Browse the catalogues {#S7}

- **Do:** On the All view, switch to Browse catalogues with no catalogue and no preset chosen, then choose Messier.
- **Expect:** With nothing chosen, no rows are listed and the page asks the user to choose a catalogue or a preset. After choosing Messier, the Messier objects M 1 to M 110 are listed, and M 31 and M 57 show ★.
- **Expect (negative):** Browsing writes nothing to My targets.
- **Trace:** Targets list · PLAN-TGT-FR-02 · PLAN-TGT-AC-02 · PV-PLAN-SC-05 · D-W17 · HARNESS-V5-IA.md S10 (Browse needs a catalogue or a preset)

### S8 — Apply a built-in preset {#S8}

- **Do:** With no rig selected, open the preset menu, then apply Galaxies dark sky to the Messier list.
- **Expect:** The menu offers exactly Best tonight, Narrowband (Moon up), Emission nebulae Ha, Galaxies dark sky and Planetary nebulae OIII, each with its definition shown. Mosaic candidates and Fits nicely are not offered. After applying, every listed row is a galaxy with Img time above zero while the Moon is below the horizon.
- **Expect (negative):** "Avoid tonight" is not offered.
- **Trace:** Targets list · PLAN-TGT-FR-09, PLAN-TGT-FR-12 · PLAN-TGT-AC-09 · D-W19 · HARNESS-V5-IA.md S10 (built-in presets)

### S8a — Apply Best tonight {#S8a}

- **Do:** With no rig selected, apply Best tonight to the Messier list.
- **Expect:** At least one row is listed. Every listed row has Img time above zero on tonight's night, and the rows are ordered by Img time, longest first.
- **Expect (negative):** Best tonight does not show an empty list while a Messier object has a usable window tonight, and no row with Img time 0 is listed.
- **Trace:** Targets list · PLAN-TGT-FR-09 · D-W19 · Round 5 "Best tonight shows nothing"

### S9 — Save, restore, rename and delete a preset {#S9}

- **Do:** With Browse catalogues, Messier, Galaxies dark sky and Img time descending in effect, save them as the preset "Autumn galaxies". Quit and relaunch PlateVault, open the Targets page, and apply "Autumn galaxies". Rename it to "Autumn galaxies M", then delete it. Try to rename and delete Galaxies dark sky.
- **Expect:** After the relaunch, "Autumn galaxies" is listed after the built-ins, and applying it restores Browse catalogues, Messier, Galaxies dark sky and the Img time descending sort. The rename and the delete each take effect in the menu.
- **Expect (negative):** The built-in Galaxies dark sky offers no rename or delete and stays listed.
- **Trace:** Targets list · PLAN-TGT-FR-10 · PLAN-TGT-AC-10 · D-W19

### S10 — Select the mono rig `RedCat` {#S10}

- **Do:** Switch back to My targets and open the rig selector. Choose `RedCat`, apply Fits nicely, then Mosaic candidates, then Best tonight.
- **Expect:** The selector offers no rig, `RedCat` and `Esprit`. With `RedCat` selected, a Fit column appears: NGC 7000 reads "fits (N%)" with N from 25 to 90, and M 57 reads "tiny". The Filters strip shows only Ha and OIII. Mosaic candidates, Fits nicely and the narrowband presets are offered. Fits nicely lists only rows reading "fits", and M 57 is absent. Mosaic candidates lists only rows that need 2 or more panels. Best tonight lists only rows with Img time above zero, longest first, and NGC 5139 is absent.
- **Expect (negative):** "This Project's rigs" is not offered outside a Project context. The Filters strip shows no L, R, G, B or SII band.
- **Trace:** Targets list · PLAN-TGT-FR-06, PLAN-TGT-FR-11, PLAN-TGT-FR-12, PLAN-EQ-FR-03 · PLAN-TGT-AC-11 · PV-PLAN-SC-06 · D-W23, D-W31, D-W61 · Round 5 "Best tonight shows nothing" (for the selected rig)

### S11 — Select the OSC rig `Esprit` {#S11}

- **Do:** Choose `Esprit` in the rig selector, open the preset menu, and apply Mosaic candidates.
- **Expect:** The Filters strip shows only R, G and B. NGC 7000's Fit reads "N panels" with N of 2 or more, and M 57 reads "tiny". Mosaic candidates lists NGC 7000.
- **Expect (negative):** Narrowband (Moon up), Emission nebulae Ha and Planetary nebulae OIII are hidden, because no filter on `Esprit` passes Ha, SII or OIII.
- **Trace:** Targets list · PLAN-TGT-FR-06, PLAN-TGT-FR-11, PLAN-TGT-FR-12, PLAN-TGT-FR-13 · PLAN-TGT-AC-12 · PV-PLAN-SC-06 · D-W23, D-W31

### S12 — Open the Targets page from a two-rig Project {#S12}

- **Do:** Open the `Summer nebulae` Project page and click **Planner** in its Planning section. Apply Mosaic candidates, then Fits nicely. Then clear the Project context.
- **Expect:** The Targets page opens scoped to the Project (`?project=`): the list is limited to IC 1396, with the `Summer nebulae` context shown and the rig selector reading "This Project's rigs (2)". Fit shows two values, labeled `RedCat` and `Esprit`. The Filters strip shows R, G, B, Ha and OIII, the union of both rigs' bands. Both Mosaic candidates and Fits nicely list IC 1396, because it matches on either rig. Clearing the context returns the list to My targets.
- **Expect (negative):** NGC 7000 is not listed while the `Summer nebulae` context is shown. Opening the scoped page writes no Project record.
- **Trace:** Targets list · PLAN-FR-10, PLAN-TGT-FR-06, PLAN-TGT-FR-11, PLAN-TGT-FR-12 · PLAN-TGT-AC-14 · PRJ-FR-02 · D-W16, D-W37, D-W62 · HARNESS-V5-IA.md S3 (Planning), S10 (rig selector, `?project=` the default there)

### S13 — Add a dual-band filter to the OSC rig {#S13}

- **Do:** In Settings → Equipment, choose **Add filter** on `Esprit`, enter the name `L-eXtreme`, matching FILTER value `L-eXtreme`, with the bands Ha and OIII, and save. Return to the Targets page and select `Esprit`.
- **Expect:** `Esprit`'s filter list shows `L-eXtreme` with the bands Ha and OIII and a Dual-band mark. The Filters strip shows R, G, B, Ha and OIII, and the narrowband presets are offered.
- **Expect (negative):** `RedCat`'s strip still shows only Ha and OIII, and Settings → Goal templates lists the same templates as before.
- **Trace:** Targets list, Settings → Equipment · PLAN-EQ-FR-01, PLAN-EQ-FR-02, PLAN-EQ-FR-03, PLAN-TGT-FR-13 · PLAN-TGT-AC-13, PLAN-EQ-AC-05 · D-W30, D-W31 · HARNESS-V5-IA.md S16 (Equipment)

## Success criteria

- SC1: At S1 My targets lists exactly 2 rows, NGC 7000 and IC 1396, each with 1 Project badge. After S6 it lists exactly 5 rows: those 2 plus M 31, NGC 5139 and M 57.
- SC2: 0 Targets are added by typing a query or browsing alone (S5, S6, S7), and 0 result rows show an **Add to targets** button (S5, S6).
- SC3: Browse catalogues lists 0 rows with no catalogue and no preset (S7).
- SC4: The preset menu with no rig offers exactly 5 built-ins and 0 "Avoid tonight" (S8). "Autumn galaxies" restores its 4 saved settings after a relaunch (S9).
- SC5: For each rig state, the Filters strip shows exactly these bands. `RedCat`: Ha, OIII. `Esprit`: R, G, B. "This Project's rigs": R, G, B, Ha, OIII. `Esprit` after S13: R, G, B, Ha, OIII (S10 through S13).
- SC6: 0 narrowband presets are offered for `Esprit` before S13 (S11).
- SC7: NGC 7000's Max alt and Img time equal its Target detail's values for the same site, night and criteria (S3), and its sparkline tooltip's maximum altitude equals its Max alt (S1).
- SC8: Best tonight lists at least 1 row and 0 rows with Img time 0, in descending Img time order, with no rig and with `RedCat` (S8a, S10).

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the harness v5 design (HARNESS-V5-IA.md S10, S3 and S16; HARNESS-V5-FEEDBACK-R1.md Round 5 P-PLAN2, "Best tonight shows nothing" and "Click a result to act", at ui-harness-v5 b5e813a5), the specs, and the workflow decisions D-W16 to D-W19, D-W23, D-W31, D-W37 and D-W60 to D-W62. No implementation has been validated against them.
- G2: Unresolved implementation qualification: no network control yet blocks SIMBAD alone (P3), and no fault control fails adding a Target from a result to exercise its Retry (PLAN-TGT-FR-03). S6 depends on the first. Blocks readiness.
- G3: Out of scope for this journey: the Moon and darkness reasons for a zero Img time (PLAN-TGT-AC-06) and a Target without catalogued coordinates (PLAN-TGT-AC-07) need fixture nights and Targets that are not specified. Blocks readiness until covered by a step or a journey.
- G4: Out of scope for this journey: Fit's "Size unknown" and "Field of view unknown" reasons (072 edge cases, PLAN-EQ-FR-05) are not exercised. Blocks readiness until covered by a step or a journey. J19/S6a covers the Targets page with no saved planning site (PLAN-TGT-AC-15).
- G5: Out of scope for this journey: no session is Trashed here. J34/S7 covers trashed frames leaving Sessions and the Captured column of Target NGC 7000 (PLAN-TGT-FR-08, D-W43). A wholly Trashed session (PLAN-TGT-AC-08) is not exercised. Blocks readiness until covered by a step or a journey.
- G6: Unresolved implementation qualification: the bundled catalogue's angular sizes for NGC 7000, IC 1396 and M 57 are assumed to place them as S10, S11 and S12 state for the J15 fields of view. A different catalogue value changes the expected Fit readings. Blocks readiness.
- G7: Unresolved product question: Round 5 P-PLAN2 describes the All view as "catalogues and My targets, filters, presets" without saying whether the IA S10 choice between My targets (the default) and Browse catalogues stays inside it. S1, S7, S10 and S12 assume it stays. Blocks readiness.
- G8: Unresolved product question: Round 5 "Click a result to act" removes the Add button from result rows, but it does not say what clicking a result that is already in My targets does (open its Target detail, or nothing). S5 does not click such a result. Blocks readiness.

## Delta log

- **Δ2** 2026-10-10 · S1, S3, S5, S5a, S6, S7, S8, S10, S12, S13, +S8a · behavior-change
  Targets and Plan are one Targets page: the All view opens with a header date picker on tonight and a compact altitude sparkline column; a row opens its Target detail. Clicking a search result adds the Target, with no Add button on result rows.
  Best tonight lists only Targets with a usable window, best first, for the selected rig. Fit reads "fits (N%)", the Project scope reads "This Project's rigs (2)", and filters are added with **Add filter**.
  Evidence: HARNESS-V5-IA.md §Screens S10, S3, S16; HARNESS-V5-FEEDBACK-R1.md §Round 5 P-PLAN2, "Best tonight shows nothing", "Click a result to act" (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); messages/en-GB.json fit_fits, targets_project_rigs, equipment_add_filter @ b5e813a5; user instruction 2026-10-10 · by: JourneysV5.U6Targets (intent-gated)
