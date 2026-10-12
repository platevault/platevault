---
id: J15
title: Register rigs with their filter lists and observing sites in Settings
version: 4
status: draft
last_reviewed: 2026-07-14
actors: [primary-user]
surfaces: [equipment, observing-sites, sessions, settings, locations, indexing]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 072-observing-plans, D11, D17, D-W23, D-W30, D-W31, D-W37, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/072-observing-plans/spec.md, docs/product/journeys/J15-equipment-observing-site-setup/journey.md @42c596d6, HARNESS-V5-IA.md#S16, "HARNESS-V5-FEEDBACK-R1.md#domain-and-seed-foundation Sites", HARNESS-V5-FEEDBACK-R1.md#round-6, apps/prototype/src/features/v5/e-targets-plan-settings/settings-equipment.tsx @b5e813a5, apps/prototype/src/features/t1/settings/sites-page.tsx @b5e813a5, apps/prototype/src/features/t1/lib/sites.ts @b5e813a5, apps/prototype/src/domain/sites.ts @b5e813a5, apps/prototype/src/domain/indexing.ts @4f470775, apps/prototype/messages/en-GB.json @b5e813a5]
---

## Goal

The user records the cameras and telescopes they own by hand, before imaging
with them, composes them into rigs (optical trains) with the list of filters
each rig carries, and saves the sites they observe from, all in Settings. A
session later indexed with that gear associates the hand-made rig, and no
detected duplicate appears. A FITS FILTER value that a session's rig
does not list prompts the user to add it to that rig. Sites carry at most one
Default pill, set only by **Make default**, and removing the default site hands
the pill to the first remaining site by name. Done means: the rigs `RedCat`
(mono) and `Esprit` (OSC) exist with their fields of view, `Halpha-test`
associates `RedCat` with no detected camera, telescope or rig, and `RedCat`
lists Ha, OIII and the prompted `Halpha` filter. The Halpha session reads band
Ha without any change to its header bytes. Goal templates are the same whichever
rig is selected. Three test sites were added and removed with the Default pill
moving as stated, and Backyard and `Remote site` are saved with no default site
designated.

## Preconditions

- P1: A clean development build of the rebuilt PlateVault (D17). Onboarding is complete with one disposable Captures location `Filter-test/Captures`, registered and indexed while empty. Outside it, the folder `Filter-test/Incoming/Halpha-test` holds one session `Halpha-test` of 10 mono 300 s lights with OBJECT `NGC 7000`, INSTRUME `ZWO ASI2600MM Pro`, TELESCOP `RedCat 51`, FOCALLEN `250` and FILTER `Halpha`; S3b copies it into the location. No camera, telescope, rig or observing site is saved or detected yet.
- P2: The equipment datasheet values: ASI2600MM is mono with 6248 × 4176 pixels of 3.76 µm; ASI533MC is OSC with 3008 × 3008 pixels of 3.76 µm; RedCat 51 has a 250 mm focal length; Esprit 100 has a 550 mm focal length.
- P3: Backyard's coordinates and IANA time zone are the ones the J19/P2 fixture headers carry. `Remote site` uses the J19/P3 coordinates, at least 15° of longitude and one time zone away from Backyard (J20/P2).
- P4: A fault control that makes the next save of a rig's filter list fail until it is disarmed (G5).
- P5: A SHA-256 of every `Halpha-test` file is recorded before S3b.

## Steps

### S1 — Open Settings → Equipment {#S1}

- **Do:** From Settings, open the Equipment pane.
- **Expect:** The Cameras, Telescopes and Optical trains sections each load their current list or an empty-state message independently. With no session indexed yet, each section is empty and offers to add a camera, a telescope or a rig by hand.
- **Expect (negative):** A load failure in one section shows its own inline error and does not block the other sections from loading.
- **Trace:** baseline J15 v1/S1 · LIB-FR-10

### S2 — Register the cameras and telescopes {#S2}

- **Do:** Add the camera ASI2600MM with the alias `ZWO ASI2600MM Pro`, mono, and its P2 pixel count and pixel size. Add ASI533MC as OSC the same way. Add the telescopes RedCat 51 and Esprit 100 with their P2 focal lengths.
- **Expect:** Each entry appears in its table immediately, although no indexed session uses it yet. Each camera shows Mono or OSC and its sensor size, and aliases render as the comma-joined list. No entry reads Detected.
- **Expect (negative):** Saving with the name field blank is rejected inline before any request is sent, and no row is added.
- **Trace:** baseline J15 v1/S2 · PLAN-EQ-FR-02, PLAN-EQ-FR-05 · D11 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Rigs: detection plus manual add" (gear not yet imaged with)

### S3 — Compose the mono rig `RedCat` {#S3}

- **Do:** Add an optical train named `RedCat` with telescope RedCat 51, camera ASI2600MM and focal length 250 mm. Then try to remove the camera ASI2600MM.
- **Expect:** `RedCat` appears in the Optical trains table as Mono, taken from its camera, with a field of view of about 5.4° × 3.6° (a 23.5 × 15.7 mm sensor at 250 mm). Its filter list is empty. Removing ASI2600MM is refused with a message naming `RedCat`.
- **Expect (negative):** The filter list offers no Mono/OSC control. Saving a train without a numeric focal length is rejected inline. The refused removal deletes no camera and leaves `RedCat` unchanged.
- **Trace:** baseline J15 v1/S3, S5 · PLAN-EQ-FR-01, PLAN-EQ-FR-02, PLAN-EQ-FR-05 · D-W23, D-W31, D-W37

### S3a — Compose the OSC rig `Esprit` {#S3a}

- **Do:** Add an optical train named `Esprit` with telescope Esprit 100, camera ASI533MC and focal length 550 mm, and leave its filter list empty.
- **Expect:** `Esprit` reads OSC, taken from its camera, captures R, G and B with its empty filter list, and shows a field of view of about 1.2° × 1.2°.
- **Expect (negative):** No Mono/OSC control is offered on its filter list.
- **Trace:** PLAN-EQ-FR-02, PLAN-EQ-FR-05 · PLAN-EQ-AC-02 · D-W31

### S3b — Index a session shot with the registered gear {#S3b}

- **Do:** Outside PlateVault, copy `Filter-test/Incoming/Halpha-test` into `Filter-test/Captures`. In Settings › Locations, click **Rescan** on the `Filter-test/Captures` row. Open `Halpha-test` in Sessions, then open Settings → Equipment.
- **Expect:** Sessions lists `Halpha-test` with 10 lights. Its rig evidence lists INSTRUME `ZWO ASI2600MM Pro`, TELESCOP `RedCat 51` and FOCALLEN `250 mm`, and associates the rig `RedCat` without confirming it. Settings → Equipment still lists exactly the cameras ASI2600MM and ASI533MC, the telescopes RedCat 51 and Esprit 100, and the rigs `RedCat` and `Esprit`.
- **Expect (negative):** Indexing detects no camera, telescope or rig: no entry reads Detected, and no rig named from the header values appears beside `RedCat`. Indexing changes none of `RedCat`'s fields and leaves its filter list empty. Every `Halpha-test` file still matches its P5 SHA-256.
- **Trace:** LIB-FR-05 · D11 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Rigs: detection plus manual add" · apps/prototype src/domain/indexing.ts findOrDetectCamera, associateEquipment (a header matching a camera's name or alias, or a telescope's name, reuses that record) @ 4f470775 · G11

### S4 — Add filters to `RedCat` {#S4}

- **Do:** On `RedCat`, choose **Add filter**, enter the name Ha with Matches FILTER `Ha` and the band Ha, and save. Add the filter OIII matching `OIII` with the band OIII the same way.
- **Expect:** `RedCat`'s filters table shows each filter with its Matches FILTER values and its band. `RedCat` now captures Ha and OIII.
- **Expect (negative):** The list sets no limit on the number of filters, a filter saved with no band is refused inline ("Pick a band"), and adding a filter to `RedCat` leaves `Esprit`'s list empty.
- **Trace:** PLAN-EQ-FR-01, PLAN-EQ-FR-02 · PLAN-EQ-AC-01 · D-W31 · HARNESS-V5-IA.md S16 (a simple filter list)

### S4a — Recover from a failed filter-list save {#S4a}

- **Do:** Arm the P4 fault. On `RedCat`'s OIII filter, add the matched FILTER value `O3` and save. Then disarm the fault and click **Retry**.
- **Expect:** The first save fails: the edit stays visibly unsaved with **Retry**, and the saved list (OIII matching `OIII` only) stays in effect. After **Retry** the OIII filter matches `OIII` and `O3`.
- **Expect (negative):** No durable success is reported before the retried save commits.
- **Trace:** PLAN-EQ-FR-06 · PLAN-EQ-AC-06 · LIB-FR-11 · D-W31

### S4b — Confirm the session's rig and meet the unknown filter {#S4b}

- **Do:** In Sessions, open `Halpha-test`. Note its filter, then choose **Confirm rig** with the rig `RedCat`.
- **Expect:** Before the rig is confirmed, the session reads rig `RedCat` Associated (S3b) and shows the observed FILTER value `Halpha` with no prompt. After confirmation it reads rig `RedCat` Confirmed, shows the filter `Halpha` as unknown, and offers "Add Halpha to RedCat".
- **Expect (negative):** No prompt names a rig before the session's rig is confirmed. Confirming the rig changes no header byte.
- **Trace:** LIB-FR-05, PLAN-EQ-FR-04 · PLAN-EQ-AC-03, edge case "rig not yet confirmed" · D-W31, D-W37 · HARNESS-V5-IA.md §Screens S12 (Confirm rig) · G10

### S4c — Decline the prompt {#S4c}

- **Do:** Dismiss "Add Halpha to RedCat" on the session, then open Settings → Equipment. On `RedCat`'s notice "Unknown FILTER “Halpha” · 1 session", choose **Not now**, then **Show**.
- **Expect:** The session keeps the observed value `Halpha` marked unknown, and the prompt is still offered on the session. Settings → Equipment shows the notice on `RedCat` with **Add filter** and **Not now**. **Not now** moves `Halpha` under Hidden with **Show**, and **Show** brings the notice back.
- **Expect (negative):** `RedCat`'s filter list is unchanged: Ha and OIII.
- **Trace:** PLAN-EQ-FR-04 · PLAN-EQ-AC-04 · D-W31 · HARNESS-V5-IA.md S16 · settings-equipment.tsx, messages equipment_unknown_filter, equipment_not_now, equipment_hidden @ b5e813a5

### S4d — Add the unknown filter from Settings {#S4d}

- **Do:** On `RedCat`'s "Unknown FILTER “Halpha” · 1 session" notice, choose **Add filter**. In the "Add Halpha" dialog keep the band Ha it offers and save. Return to `Halpha-test`.
- **Expect:** The dialog fixes the name `Halpha` and preselects the band Ha. `RedCat`'s list includes a filter matching `Halpha` with band Ha, and the notice is gone. The session reads band Ha instead of an unknown filter.
- **Expect (negative):** Every `Halpha-test` file still matches its P5 SHA-256, and the session's observed FILTER evidence still reads `Halpha`. `Esprit`'s filter list is unchanged.
- **Trace:** PLAN-EQ-FR-04 · PLAN-EQ-AC-03 · LIB-FR-05 · D-W31 · settings-equipment.tsx (Add {value}, guessed bands the user confirms) @ b5e813a5

### S4e — Goal templates ignore the rig {#S4e}

- **Do:** In the Targets toolbar, select the rig `RedCat` and open Settings → Goal templates. Then select `Esprit` and open Settings → Goal templates again.
- **Expect:** Both times the same templates are listed: the built-ins HOO, SHO, LRGB, OSC broadband and OSC dual-band.
- **Expect (negative):** No template is hidden or reordered because `Esprit` has no narrowband filter.
- **Trace:** PLAN-EQ-FR-03 · PLAN-EQ-AC-05 · PRJ-AC-14 · D-W30, D-W31

### S5a — Add a first site, which stays without a default {#S5a}

- **Do:** Open Settings → Observing sites. Add `Test Zeta` with the P3 Backyard coordinates and time zone, leaving **Make default** unchecked. Then choose **Make default** on its row.
- **Expect:** With no site saved, the page reads "No sites". After the save `Test Zeta` is listed without the Default pill and the page shows "No default site". After **Make default**, `Test Zeta` carries the Default pill and the notice is gone.
- **Expect (negative):** Saving the first site does not make it the default.
- **Trace:** PLAN-FR-01 · HARNESS-V5-IA.md S16 (Sites: one Default pill, Make default) · HARNESS-V5-FEEDBACK-R1.md Domain and seed (Sites) · sites-page.tsx, lib/sites.ts saveSite @ b5e813a5

### S5b — Add two more test sites {#S5b}

- **Do:** Add `Test Mu`, then `Test Alpha`, each with the P3 Backyard coordinates and time zone and **Make default** unchecked.
- **Expect:** Three sites are listed, and only `Test Zeta` carries the Default pill.
- **Expect (negative):** Adding a site moves no Default pill. A second site named `Test Mu` is refused inline ("Name: Test Mu is already a saved site.").
- **Trace:** PLAN-FR-01 · HARNESS-V5-IA.md S16 · lib/sites.ts validateSite @ b5e813a5

### S5c — Remove the default site {#S5c}

- **Do:** Choose **Remove** on `Test Zeta`, read the confirmation, and choose **Remove site**.
- **Expect:** The confirmation "Remove Test Zeta?" lists "Remove Test Zeta" and "Default: Test Alpha". After it, `Test Mu` and `Test Alpha` remain and `Test Alpha` carries the Default pill: the first remaining site by name, although `Test Mu` was added earlier.
- **Expect (negative):** `Test Mu` is not made default, no remaining site's fields change, and every `Halpha-test` file still matches its P5 SHA-256.
- **Trace:** PLAN-FR-01 · HARNESS-V5-IA.md S16 · domain/sites.ts removeSite, sites-page.tsx @ b5e813a5

### S5d — Remove the remaining test sites {#S5d}

- **Do:** Remove `Test Mu`, then `Test Alpha`, reading each confirmation.
- **Expect:** The `Test Mu` confirmation lists only "Remove Test Mu", and `Test Alpha` keeps the Default pill afterwards. The `Test Alpha` confirmation lists "Remove Test Alpha" and "No default site". Afterwards the page reads "No sites".
- **Expect (negative):** Removing a site that is not the default moves no Default pill. No site is removed before its confirmation is accepted.
- **Trace:** PLAN-FR-01 · domain/sites.ts removeSite, sites-page.tsx @ b5e813a5

### S6 — Add the Backyard observing site {#S6}

- **Do:** In Settings → Observing sites, add Backyard with a name, the P3 latitude, longitude and IANA time zone, and no elevation, leaving **Make default** unchecked.
- **Expect:** Backyard appears in the sites table with its formatted coordinates and time zone. It carries no Default pill, and the page shows "No default site".
- **Expect (negative):** Latitude outside ±90°, longitude outside ±180°, or a non-numeric elevation is each rejected inline, and no site is saved.
- **Trace:** baseline J15 v1/S6 · PLAN-FR-01 · PLAN-AC-04 · D-W16 · HARNESS-V5-IA.md S16

### S7 — Add a second site {#S7}

- **Do:** Add `Remote site` with its P3 coordinates and time zone.
- **Expect:** Both sites are listed with their own coordinates and time zones, and neither carries the Default pill until the user designates one with **Make default** (J29/S5).
- **Expect (negative):** Adding `Remote site` changes none of Backyard's fields and no session's capture site.
- **Trace:** PLAN-FR-01 · PLAN-AC-01, PLAN-AC-04 · D-W16

## Success criteria

- SC1: Two rigs exist: `RedCat` reads Mono with a field of view of about 5.4° × 3.6°, and `Esprit` reads OSC, about 1.2° × 1.2°, capturing R, G and B with an empty list (S3, S3a).
- SC2: After S4d, `RedCat` lists exactly 3 filters (Ha, OIII and Halpha) and `Esprit` lists 0 (S4, S4c, S4d).
- SC3: 0 `Halpha-test` files change across S3b, S4b, S4c and S4d, and its observed FILTER evidence stays `Halpha`.
- SC4: The failed save leaves the previous list in effect and reports 0 durable successes before **Retry** (S4a).
- SC5: Settings → Goal templates lists the same 5 built-in templates with `RedCat` and with `Esprit` selected (S4e).
- SC6: 2 sites are saved and 0 are marked default (S6, S7).
- SC7: Across S5a to S5d at most 1 Default pill shows at any time; 0 sites become default on save; removing the default `Test Zeta` makes `Test Alpha` default; after S5d 0 sites and 0 defaults remain.
- SC8: After S3b, Settings → Equipment lists exactly 2 cameras, 2 telescopes and 2 rigs, 0 of them Detected, and `Halpha-test` associates `RedCat` (S2, S3b).

## Known gaps

- G1: (dissolved 2026-07-15) — tracked as issue #879; registered equipment not consumed elsewhere.
- G2: (dissolved 2026-07-15) — tracked as issue #659; no duplicate-name check for most equipment.
- G3: (dissolved 2026-10-06): the fixed per-band moon-avoidance table and the separate Filters list are not part of the rebuild contract. Each rig's filter list drives the Targets band strip and presets (PLAN-EQ-FR-03, D-W31).
- G4: Not validated. The rebuilt application does not exist. Product behavior follows the harness v5 design (HARNESS-V5-IA.md S16 and HARNESS-V5-FEEDBACK-R1.md Domain and seed, Sites, at ui-harness-v5 b5e813a5, with its prototype's Settings → Equipment and Observing sites; HARNESS-V5-FEEDBACK-R1.md Round 6 at 4f470775), the specs and the workflow decisions D-W23, D-W30, D-W31 and D-W37. No implementation has been validated against them.
- G5: Unresolved implementation qualification: no fault control yet fails a filter-list save (P4). S4a depends on it. Blocks readiness.
- G6: (dissolved 2026-10-12): removing a site and how the default site moves when the default is removed are covered by S5c and S5d.
- G7: Out of scope for this journey: the unknown-filter prompt in the Import preview (STO-IMP-FR-03) and the Targets Filters strip a rig drives (PLAN-TGT-FR-06) are not exercised here. J35 covers the strip. Blocks readiness until the Import prompt is covered by a step or a journey.
- G8: (dissolved 2026-10-12): the pane is Settings → Observing sites, and the first saved site does not become the default (S5a, S6).
- G9: (dissolved 2026-10-12): answered by Round 6 "Rigs: detection plus manual add"; S1 to S3a now assert adding cameras, telescopes and rigs by hand before any session uses them, and S3b asserts that indexing a session shot with that gear associates the hand-made rig and detects no duplicate. J19/S9b covers renaming and editing detected rigs.
- G10: Unresolved product question (carried from G9, not answered by Round 6): the v5 prototype's session detail offers no "Add {value} to {rig}", and the v5 design (HARNESS-V5-IA.md S16) does not say either way, so S4b and S4c keep the contract text (PLAN-EQ-FR-04). Blocks readiness.
- G11: Unresolved implementation qualification: the v5 design does not state the rule that matches a header to a camera or telescope added by hand (J37/G3 records the same gap for rigs). S3b assumes the prototype's: INSTRUME equal to a camera's name or one of its aliases, and TELESCOP equal to a telescope's name. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S4, S6, S7, +S3a, +S4a, +S4b, +S4c, +S4d, +S4e · behavior-change
  Filters now belong to each rig as a plain list, with Mono or OSC taken from the camera and a field of view per rig. A FILTER value the rig does not list prompts "Add {value} to {rig}". Goal templates ignore the rig. Steps 5, 8 and 9 (audit rows, site removal, the moon-avoidance table) and the separate Filters list are retired.
  Evidence: D-W23, D-W30, D-W31, D-W37 (workflow decisions, settled 2026-10-06); 072 PLAN-EQ-FR-01 to PLAN-EQ-FR-06, PLAN-EQ-AC-01 to PLAN-EQ-AC-06; 064 LIB-FR-05 at e4476231 · by: agent (intent-gated, user instruction)
- **Δ3** 2026-10-12 · S4, S4c, S4d, S6, S7, +S5a, +S5b, +S5c, +S5d · behavior-change
  Filters are added with **Add filter** (name, Matches FILTER, bands). Settings shows an unknown FILTER value as "Unknown FILTER “Halpha” · 1 session" with **Add filter** and **Not now**, which hides it until **Show**.
  Sites live in Settings → Observing sites with at most one Default pill set by **Make default**; removing the default site makes the first remaining site by name the default, after a confirmation.
  Evidence: HARNESS-V5-IA.md §Screens S16; HARNESS-V5-FEEDBACK-R1.md §Domain and seed (Sites) (apps/prototype/design/ on ui-harness-v5 @ b5e813a5); prototype settings-equipment.tsx, sites-page.tsx, lib/sites.ts, domain/sites.ts removeSite, messages/en-GB.json @ b5e813a5; user instruction 2026-10-12 · by: JourneysV5.U6Targets (intent-gated)
- **Δ4** 2026-10-12 · S1, S2, S4b, +S3b · behavior-change
  Cameras, telescopes and rigs are added by hand in Settings → Equipment for gear not yet imaged with. `Halpha-test` is now indexed at S3b, after the gear exists, and associates the hand-made `RedCat` with no detected duplicate.
  Evidence: HARNESS-V5-FEEDBACK-R1.md §Round 6 (user, 2026-10-10) "Rigs: detection plus manual add" (apps/prototype/design/ on ui-harness-v5 @ 4f470775); user answers to the PR #1788 journey questions · by: JourneysV5.R6F (intent-gated)
