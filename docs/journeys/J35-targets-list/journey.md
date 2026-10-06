---
id: J35
title: Find, favourite and narrow Targets on the Targets list with presets, a rig selector and Fit
version: 1
status: draft
last_reviewed: 2026-10-06
actors: [primary-user]
surfaces: [targets, planning, equipment, projects]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 065-project-goals, 072-observing-plans, D17, D18, D-W16, D-W17, D-W18, D-W19, D-W23, D-W31, D-W37, D-W60, D-W61, D-W62, specs/072-observing-plans/spec.md, specs/065-project-goals/spec.md]
---

## Goal

The user opens the Targets page, sees their own Targets with tonight's planning
columns, finds and adds new Targets through search, browses the bundled
catalogues, and narrows the list with presets and a rig. Done means: My targets
lists exactly the ★ favourites plus every open Project subject with its Project
badge. Search names each result's source and adds a Target only on **Add to
targets**. Browse catalogues lists nothing until a catalogue or preset is
chosen. A saved preset survives a restart. With a rig selected, the Filters
strip shows only that rig's bands, narrowband presets follow its filters, and
Fit reads per rig. Nothing on the page writes library data except ★ and **Add to
targets**.

## Preconditions

- P1: Fresh replay of J15, J19 and J20, with J21 to J34 not run. The rigs `RedCat` and `Esprit` exist as J15 left them. `RedCat` is mono with the filters Ha, OIII and Halpha and a field of about 5.4° × 3.6°. `Esprit` is OSC with an empty filter list and a field of about 1.2° × 1.2°. Settings holds Backyard and `Remote site`. Project `NGC 7000 HOO` is open with subject NGC 7000 and rig `RedCat`. No Target is marked ★.
- P2: A second open Project `Summer nebulae`, created with New Project as in J20, has the single subject IC 1396 and the rigs `RedCat` and `Esprit`, and no run. IC 1396 is not marked ★.
- P3: The bundled catalogues (Messier, NGC, IC, Sharpless, LBN, LDN, Caldwell, Barnard) are installed. SIMBAD is reachable until S6, and a network control can then block it (G2).
- P4: The planning site selector reads Backyard. A development-build clock control (D17) fixes tonight to one date, so the S1 and S3 values can be compared.
- P5: Backyard lies north of 43° N, so NGC 5139 (declination about −47°) never rises above its horizon there.

## Steps

### S1 — Open the Targets page {#S1}

- **Do:** Open the Targets page from main navigation.
- **Expect:** "My targets" is selected. It lists exactly NGC 7000, with a `NGC 7000 HOO` badge, and IC 1396, with a `Summer nebulae` badge. The columns are ★, Designation, Type, Max alt, Lunar, Img time, Filters, Opposition, Sessions and Captured, sorted by Designation ascending. Moon illumination and phase appear once, in the toolbar, for tonight at Backyard.
- **Expect (negative):** No catalogue object that is neither ★ nor a Project subject is listed. No row repeats the Moon illumination.
- **Trace:** Targets list · PLAN-TGT-FR-01, PLAN-TGT-FR-04, PLAN-TGT-FR-07 · PLAN-TGT-AC-01, PLAN-TGT-AC-05, PLAN-TGT-AC-16 · D-W17, D-W18, D-W60

### S2 — Read Sessions and Captured, and sort {#S2}

- **Do:** Read the NGC 7000 and IC 1396 rows, open NGC 7000's Target page, then return and sort by Img time descending and again ascending.
- **Expect:** NGC 7000's Sessions equals the number of sessions its Target page lists. Its Captured reads Ha 9h 15m, and OIII equals the OIII captured integration on its Target page. IC 1396 reads "-" for Sessions. Each sort reorders the rows by Img time, and a row with an unknown value sorts last both times.
- **Expect (negative):** The ★ column offers no sort.
- **Trace:** Targets list · PLAN-TGT-FR-04, PLAN-TGT-FR-08 · PLAN-TGT-AC-08 · D-W18

### S3 — Open a Target's Plan area from its row {#S3}

- **Do:** Select the NGC 7000 row.
- **Expect:** NGC 7000's Plan area opens at Backyard. The row's Max alt equals the Plan area's peak altitude tonight, and its Img time equals the total of the Plan area's windows tonight under the same criteria.
- **Trace:** Targets list · PLAN-TGT-FR-05, PLAN-TGT-FR-14, PLAN-FR-08 · PV-PLAN-SC-04 · D-W16, D-W18

### S4 — Toggle a favourite {#S4}

- **Do:** Back on the Targets page, mark IC 1396 ★, then clear its ★.
- **Expect:** The ★ toggles each time. IC 1396 stays listed with its `Summer nebulae` badge in both states.
- **Expect (negative):** Toggling ★ changes no subject of `Summer nebulae` and no Project record.
- **Trace:** Targets list · PLAN-TGT-FR-01 · PLAN-TGT-AC-16 · D-W60

### S5 — Search and add a Target {#S5}

- **Do:** Search `m 31`, then `M31` and `m31`. Choose **Add to targets** on the Messier M 31 result. Then search `ngc 5139` and add NGC 5139 the same way, and close the search.
- **Expect:** All three queries return the same M 31 matches, from the bundled catalogues and from SIMBAD, each naming its source and offering **Add to targets**. After **Add to targets** the search stays open, and the M 31 result shows it is in My targets instead of the offer. My targets then lists M 31 and NGC 5139 with ★ set, beside NGC 7000 and IC 1396.
- **Expect (negative):** Before **Add to targets**, My targets is unchanged: searching alone writes nothing.
- **Trace:** Targets list · PLAN-TGT-FR-03 · PLAN-TGT-AC-03 · D-W17

### S5a — Read a zero imaging time {#S5a}

- **Do:** Read the NGC 5139 row.
- **Expect:** Img time reads 0 with the altitude reason.
- **Expect (negative):** NGC 5139's Max alt, Img time and Opposition are not left blank without a reason.
- **Trace:** Targets list · PLAN-TGT-FR-05 · PLAN-TGT-AC-06 · D-W18

### S6 — Search without SIMBAD {#S6}

- **Do:** Block SIMBAD with the P3 control, search `m 57`, and choose **Add to targets** on the Messier result. Unblock SIMBAD.
- **Expect:** Matches from My targets and the bundled catalogues are listed with their sources, and the results state that SIMBAD was not searched. M 57 joins My targets with ★ set.
- **Expect (negative):** The results do not read as a complete search, and no SIMBAD source is shown.
- **Trace:** Targets list · PLAN-TGT-FR-03 · PLAN-TGT-AC-04 · D-W17

### S7 — Browse the catalogues {#S7}

- **Do:** Switch to Browse catalogues with no catalogue and no preset chosen, then choose Messier.
- **Expect:** With nothing chosen, no rows are listed and the page asks the user to choose a catalogue or a preset. After choosing Messier, the Messier objects M 1 to M 110 are listed, and M 31 and M 57 show ★.
- **Expect (negative):** Browsing writes nothing to My targets.
- **Trace:** Targets list · PLAN-TGT-FR-02 · PLAN-TGT-AC-02 · PV-PLAN-SC-05 · D-W17

### S8 — Apply a built-in preset {#S8}

- **Do:** With no rig selected, open the preset menu, then apply Galaxies dark sky to the Messier list.
- **Expect:** The menu offers exactly Best tonight (broadband), Narrowband (Moon up), Emission nebulae Ha, Galaxies dark sky and Planetary nebulae OIII, each with its definition shown. Mosaic candidates and Fits nicely are not offered. After applying, every listed row is a galaxy with Img time above zero while the Moon is below the horizon.
- **Expect (negative):** "Avoid tonight" is not offered.
- **Trace:** Targets list · PLAN-TGT-FR-09, PLAN-TGT-FR-12 · PLAN-TGT-AC-09 · D-W19

### S9 — Save, restore, rename and delete a preset {#S9}

- **Do:** With Browse catalogues, Messier, Galaxies dark sky and Img time descending in effect, save them as the preset "Autumn galaxies". Quit and relaunch PlateVault, open the Targets page, and apply "Autumn galaxies". Rename it to "Autumn galaxies M", then delete it. Try to rename and delete Galaxies dark sky.
- **Expect:** After the relaunch, "Autumn galaxies" is listed after the built-ins, and applying it restores Browse catalogues, Messier, Galaxies dark sky and the Img time descending sort. The rename and the delete each take effect in the menu.
- **Expect (negative):** The built-in Galaxies dark sky offers no rename or delete and stays listed.
- **Trace:** Targets list · PLAN-TGT-FR-10 · PLAN-TGT-AC-10 · D-W19

### S10 — Select the mono rig `RedCat` {#S10}

- **Do:** Switch back to My targets and open the rig selector. Choose `RedCat`, apply Fits nicely, then apply Mosaic candidates.
- **Expect:** The selector offers no rig, `RedCat` and `Esprit`. With `RedCat` selected, a Fit column appears: NGC 7000 reads "fits" and M 57 reads "tiny". The Filters strip shows only Ha and OIII. Mosaic candidates, Fits nicely and the narrowband presets are offered. Fits nicely lists only rows reading "fits", and M 57 is absent. Mosaic candidates lists only rows that need 2 or more panels.
- **Expect (negative):** "this Project's rigs" is not offered outside a Project context. The Filters strip shows no L, R, G, B or SII band.
- **Trace:** Targets list · PLAN-TGT-FR-06, PLAN-TGT-FR-11, PLAN-TGT-FR-12, PLAN-EQ-FR-03 · PLAN-TGT-AC-11 · PV-PLAN-SC-06 · D-W23, D-W31, D-W61

### S11 — Select the OSC rig `Esprit` {#S11}

- **Do:** Choose `Esprit` in the rig selector, open the preset menu, and apply Mosaic candidates.
- **Expect:** The Filters strip shows only R, G and B. NGC 7000's Fit reads "N panels" with N of 2 or more, and M 57 reads "tiny". Mosaic candidates lists NGC 7000.
- **Expect (negative):** Narrowband (Moon up), Emission nebulae Ha and Planetary nebulae OIII are hidden, because no filter on `Esprit` passes Ha, SII or OIII.
- **Trace:** Targets list · PLAN-TGT-FR-06, PLAN-TGT-FR-11, PLAN-TGT-FR-12, PLAN-TGT-FR-13 · PLAN-TGT-AC-12 · PV-PLAN-SC-06 · D-W23, D-W31

### S12 — Open the Planner from a two-rig Project {#S12}

- **Do:** Open the `Summer nebulae` Project page and click **Open in Planner**. Apply Mosaic candidates, then Fits nicely. Then clear the Project context.
- **Expect:** The list is limited to IC 1396, with the `Summer nebulae` context shown and the rig selector reading "this Project's rigs". Fit shows two values, labeled `RedCat` and `Esprit`. The Filters strip shows R, G, B, Ha and OIII, the union of both rigs' bands. Both Mosaic candidates and Fits nicely list IC 1396, because it matches on either rig. Clearing the context returns the list to My targets.
- **Expect (negative):** NGC 7000 is not listed while the `Summer nebulae` context is shown. Opening the Planner writes no Project record.
- **Trace:** Targets list · PLAN-FR-10, PLAN-TGT-FR-06, PLAN-TGT-FR-11, PLAN-TGT-FR-12 · PLAN-TGT-AC-14 · PRJ-FR-02 · D-W16, D-W37, D-W62

### S13 — Add a dual-band filter to the OSC rig {#S13}

- **Do:** In Settings → Equipment, add the filter `L-eXtreme` to `Esprit`, matching FILTER value `L-eXtreme` and passing Ha and OIII, and save. Return to the Targets page and select `Esprit`.
- **Expect:** The Filters strip shows R, G, B, Ha and OIII, and the narrowband presets are offered.
- **Expect (negative):** `RedCat`'s strip still shows only Ha and OIII, and Settings → Goal templates lists the same templates as before.
- **Trace:** Targets list, Settings → Equipment · PLAN-EQ-FR-01, PLAN-EQ-FR-02, PLAN-EQ-FR-03, PLAN-TGT-FR-13 · PLAN-TGT-AC-13, PLAN-EQ-AC-05 · D-W30, D-W31

## Success criteria

- SC1: At S1 My targets lists exactly 2 rows, NGC 7000 and IC 1396, each with 1 Project badge. After S6 it lists exactly 5 rows: those 2 plus M 31, NGC 5139 and M 57.
- SC2: 0 Targets are added by searching or browsing alone (S5, S6, S7).
- SC3: Browse catalogues lists 0 rows with no catalogue and no preset (S7).
- SC4: The preset menu with no rig offers exactly 5 built-ins and 0 "Avoid tonight" (S8). "Autumn galaxies" restores its 4 saved settings after a relaunch (S9).
- SC5: For each rig state, the Filters strip shows exactly these bands. `RedCat`: Ha, OIII. `Esprit`: R, G, B. "this Project's rigs": R, G, B, Ha, OIII. `Esprit` after S13: R, G, B, Ha, OIII (S10 through S13).
- SC6: 0 narrowband presets are offered for `Esprit` before S13 (S11).
- SC7: NGC 7000's Max alt and Img time equal its Plan area's values for the same site, night and criteria (S3).

## Known gaps

- G1: Not validated. The rebuilt application does not exist. Product behavior follows the specs and the workflow decisions D-W16 to D-W19, D-W23, D-W31, D-W37 and D-W60 to D-W62. No implementation has been validated against them.
- G2: Unresolved implementation qualification: no network control yet blocks SIMBAD alone (P3), and no fault control fails **Add to targets** to exercise its Retry (PLAN-TGT-FR-03). S6 depends on the first. Blocks readiness.
- G3: Out of scope for this journey: the Moon and darkness reasons for a zero Img time (PLAN-TGT-AC-06) and a Target without catalogued coordinates (PLAN-TGT-AC-07) need fixture nights and Targets that are not specified. Blocks readiness until covered by a step or a journey.
- G4: Out of scope for this journey: Fit's "Size unknown" and "Field of view unknown" reasons (072 edge cases, PLAN-EQ-FR-05) and the Targets page with no saved planning site (PLAN-TGT-AC-15) are not exercised. Blocks readiness until covered by a step or a journey.
- G5: Out of scope for this journey: Trashed sessions leaving Sessions and Captured (PLAN-TGT-AC-08, D-W43) need the trash fixture of J34 and are not exercised here. Blocks readiness until covered by a step or a journey.
- G6: Unresolved implementation qualification: the bundled catalogue's angular sizes for NGC 7000, IC 1396 and M 57 are assumed to place them as S10, S11 and S12 state for the J15 fields of view. A different catalogue value changes the expected Fit readings. Blocks readiness.

## Delta log

- No entries (initial draft, version 1).
