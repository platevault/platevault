---
id: J15
title: Register rigs with their filter lists and observing sites in Settings
version: 6
status: draft
last_reviewed: 2026-07-14
actors: [primary-user]
surfaces: [equipment, observing-sites, sessions, settings, locations, indexing]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 068-calibration-inputs, 072-observing-plans, D11, D17, D-W23, D-W30, D-W31, D-W87, D-W94, D-W95, D-W98, D-W100, D-W101, D-W102, D-W104, D-W105, D-W106, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/068-calibration-inputs/spec.md, specs/072-observing-plans/spec.md, docs/product/journeys/J15-equipment-observing-site-setup/journey.md @42c596d6, HARNESS-V5-IA.md#S16, "HARNESS-V5-FEEDBACK-R1.md#domain-and-seed-foundation Sites", HARNESS-V5-FEEDBACK-R1.md#round-6, apps/prototype/src/features/v5/e-targets-plan-settings/settings-equipment.tsx @b5e813a5, apps/prototype/src/features/t1/settings/sites-page.tsx @b5e813a5, apps/prototype/src/features/t1/lib/sites.ts @b5e813a5, apps/prototype/src/domain/sites.ts @b5e813a5, apps/prototype/src/domain/indexing.ts @4f470775, apps/prototype/messages/en-GB.json @b5e813a5]
---

## Goal

The user records cameras, telescopes, filters and observing sites in Settings,
then composes cameras and telescopes into rigs. Two cameras of the same model
need distinct aliases, and a camera can be set to **Don't use darks** or
**Don't use bias**. A later session associates with the hand-made rig; which
version a session captured before the rig existed records is open (G12). A FITS FILTER value that a session's rig does not list prompts
the user to add a filter to that rig. Sites carry at most one Default pill, set
only by **Make default**, and removing the default site hands the pill to the
first remaining site by name. Done means: `RedCat` (mono) and `Esprit` (OSC)
exist with their fields of view, `Halpha-test` associates `RedCat` with no
detected duplicate, and its Ha band is added without changing header bytes.
Goal templates are the same whichever rig is selected. Three test sites were
added and removed with the Default pill moving as stated, and Backyard and
`Remote site` are saved with no default site designated.

## Preconditions

- P1: A clean development build of the rebuilt PlateVault (D17). Onboarding is complete with one disposable Captures location `Filter-test/Captures`, registered and indexed while empty. Outside it, the folder `Filter-test/Incoming/Halpha-test` holds one session `Halpha-test` of 10 mono 300 s lights captured on 2026-10-02 with OBJECT `NGC 7000`, INSTRUME `ZWO ASI2600MM Pro`, TELESCOP `RedCat 51`, FOCALLEN `250` and FILTER `Halpha`; S3b copies it into the location. No camera, telescope, rig or observing site is saved or detected yet.
- P2: The equipment datasheet values: ASI2600MM is mono with 6248 × 4176 pixels of 3.76 µm; ASI533MC is OSC with 3008 × 3008 pixels of 3.76 µm; RedCat 51 has a 250 mm focal length; Esprit 100 has a 550 mm focal length.
- P3: Backyard's coordinates are 52.09° N, 5.12° E and its IANA time zone is `Europe/Amsterdam`; the J19/P2 fixture headers carry these values. Its minimum altitude is 25° and darkness is astronomical (prototype seed.ts:805 at a2ec1297). `Remote site` uses the J19/P3 coordinates, at least 15° of longitude and one time zone away from Backyard (J20/P2).
- P4: A fault control that makes the next save of a rig's filter list fail until it is disarmed (G5).
- P5: A SHA-256 of every `Halpha-test` file is recorded before S3b.
- P6: A network control that takes the machine offline and back online, for the map-unavailable check in S6.
- P7: Before S6, the OS grants PlateVault location permission and reports a fixed test location, the `Remote site` coordinates of P3, so **Use my location** returns them without a prompt.

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
- **Trace:** PLAN-EQ-FR-02, PLAN-EQ-FR-05, PLAN-EQ-FR-08 · D-W87, D-W104 · D11 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Rigs: detection plus manual add" (gear not yet imaged with)

### S2a — Tell two cameras of one model apart, then remove the spare {#S2a}

- **Do:** Add a second ASI2600MM camera with the P2 pixel count and pixel size and no alias, and save it. Then give it the alias `ASI2600MM B` and save. On `ASI2600MM B`, set **Don't use darks** and **Don't use bias**. Then remove `ASI2600MM B`.
- **Expect:** While two ASI2600MM cameras exist, the save without an alias is refused inline, because each camera of that model needs an alias that no other camera uses; the first camera keeps `ZWO ASI2600MM Pro`. `ASI2600MM B` then saves with its alias and shows **Don't use darks** and **Don't use bias** set. No rig uses it, so its removal succeeds, and Settings → Equipment again lists the cameras ASI2600MM and ASI533MC.
- **Expect (negative):** Setting the defaults on `ASI2600MM B` changes no session, because no session was captured with it, and nothing on ASI2600MM or ASI533MC changes.
- **Trace:** PLAN-EQ-FR-08 · PLAN-EQ-AC-10 · CAL-FR-22 · D-W104

### S3 — Compose the mono rig `RedCat` {#S3}

- **Do:** Add an optical train named `RedCat` with telescope RedCat 51, the camera matched by alias `ZWO ASI2600MM Pro`, and focal length 250 mm. Then try to remove that camera.
- **Expect:** `RedCat` appears in the Optical trains table as Mono, taken from its camera, with a field of view of about 5.4° × 3.6° (a 23.5 × 15.7 mm sensor at 250 mm). Its filter list is empty. The rig starts at version 1. Removing the camera is refused with a message naming `RedCat`.
- **Expect (negative):** The filter list offers no Mono/OSC control. Saving a train without a numeric focal length is rejected inline. The refused removal deletes no camera and leaves `RedCat` unchanged.
- **Trace:** PLAN-EQ-FR-01, PLAN-EQ-FR-02, PLAN-EQ-FR-05, PLAN-EQ-FR-07 · D-W23, D-W87, D-W104

### S3a — Compose the OSC rig `Esprit` {#S3a}

- **Do:** Add an optical train named `Esprit` with telescope Esprit 100, camera ASI533MC and focal length 550 mm, and leave its filter list empty.
- **Expect:** `Esprit` reads OSC, taken from its camera, captures R, G and B with its empty filter list, and shows a field of view of about 1.2° × 1.2°.
- **Expect (negative):** No Mono/OSC control is offered on its filter list.
- **Trace:** PLAN-EQ-FR-02, PLAN-EQ-FR-05 · PLAN-EQ-AC-02 · D-W31

### S3b — Index a session shot with the registered gear {#S3b}

- **Do:** Outside PlateVault, copy `Filter-test/Incoming/Halpha-test` into `Filter-test/Captures`. In Settings › Locations, click **Rescan** on the `Filter-test/Captures` row. Open `Halpha-test` in Sessions, then open Settings → Equipment.
- **Expect:** Sessions lists `Halpha-test` with 10 lights. Its rig evidence lists INSTRUME `ZWO ASI2600MM Pro`, TELESCOP `RedCat 51` and FOCALLEN `250 mm`, and associates the rig `RedCat` without confirming it. The camera alias `ZWO ASI2600MM Pro` identifies camera ASI2600MM. Which rig version the session records, given that it was captured on 2026-10-02, before S3 created `RedCat`, is G12. Settings → Equipment lists exactly the cameras ASI2600MM and ASI533MC, the telescopes RedCat 51 and Esprit 100, and the rigs `RedCat` and `Esprit`.
- **Expect (negative):** Indexing detects no camera, telescope or rig: no entry reads Detected, and no rig named from the header values appears beside `RedCat`. Indexing changes none of `RedCat`'s fields and leaves its filter list empty. Every `Halpha-test` file still matches its P5 SHA-256.
- **Trace:** LIB-FR-05, LIB-FR-23, LIB-FR-26 · PLAN-EQ-FR-07, PLAN-EQ-FR-08 · D11, D-W104, D-W105 · HARNESS-V5-FEEDBACK-R1.md §Round 6 "Rigs: detection plus manual add" · G12

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

### S6 — Add the Backyard observing site with the map {#S6}

- **Do:** In Settings → Observing sites, start adding Backyard with a name, its P3 IANA time zone and no elevation, leaving **Make default** unchecked. Search for a place, choose a result and inspect the map. Then choose **Use my location** (P7). Set **Min. altitude** to 25° and **Darkness** to astronomical, as in P3. Re-enter the P3 latitude and longitude and save. Take the machine offline (P6). Open Backyard's site editor again. Change the latitude and longitude fields to different valid numbers. Verify that each field contains the edited value. Cancel without saving. Reopen Backyard's editor and confirm that its saved latitude and longitude are still the P3 coordinates. Bring the machine back online.
- **Expect:** The map uses Leaflet and OpenStreetMap tiles, and its marker follows the latitude and longitude fields. A search result fills those fields with its place coordinates, and **Use my location** fills them with the P7 location, the `Remote site` coordinates. The fields are the record. Backyard appears in the sites table with the P3 coordinates, 25° minimum altitude, astronomical darkness and time zone, not the searched or located ones. It carries no Default pill, and the page shows "No default site". When offline, "Map unavailable" replaces the map and place search. The latitude and longitude fields still accept edits. After cancellation, the saved P3 coordinates remain unchanged.
- **Expect (negative):** Saving Backyard does not make it the default. Latitude outside ±90°, longitude outside ±180°, or a non-numeric elevation is each rejected inline, and no site is saved.
- **Trace:** baseline J15 v1/S6 · PLAN-FR-01 · PLAN-AC-04 · D-W16 · HARNESS-V5-IA.md S16 · HARNESS-V5-FEEDBACK-R1.md Round 9 C5

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
- SC8: After S3b, Settings → Equipment lists exactly 2 cameras, 2 telescopes and 2 rigs, 0 of them Detected, and `Halpha-test` associates `RedCat` (S2, S2a, S3b).
- SC9: In S2a, saving a second ASI2600MM without an alias that no other camera uses is refused once, and removing it leaves exactly 2 cameras (S2a).

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
- G12: Out of scope for this journey: rig versions (PLAN-EQ-FR-07) are not walked. S4 to S4d edit `RedCat`'s filters after `Halpha-test` is indexed, but no step asserts the versions those edits create or their start dates, because the fixture fixes no date for them. A camera's Don't use darks and Don't use bias defaults on a session (PLAN-EQ-AC-11) are not exercised either. Unresolved product question, listed open in PR #1804: which version a session captured before a rig's first version gets, and the default start date of a new version. `Halpha-test` was captured on 2026-10-02, before S3 creates `RedCat`, so S3b and SC8 assert no version for it. Blocks readiness until the owner answers and a step or a journey covers it.

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
- **Δ5** 2026-10-15 · S2a, S3, S3b · behavior-change
  Two cameras of one model need distinct aliases, a camera can be set to Don't use darks or Don't use bias, and a rig starts at version 1. Which version `Halpha-test` records is left open (G12), because it was captured before `RedCat` existed.
  Evidence: D-W104 (F4 Project model, owner's answers of 2026-10-14) in PR #1804, 072 PLAN-EQ-FR-07, PLAN-EQ-FR-08, PLAN-EQ-AC-10, 064 LIB-FR-26 · by: SpecF4Writer2 (intent-gated)
- **Δ6** 2026-10-17 · S6, +P6, +P7 · behavior-change
  The observing-site editor has a Leaflet and OpenStreetMap map, place search and **Use my location**, which fill the latitude and longitude fields; the fields are the record. New P7 grants location permission with a fixed test location. Offline (new P6), "Map unavailable" replaces the map and the search.
  Evidence: HARNESS-V5-FEEDBACK-R1.md Round 9 C5 · PLAN-FR-01 · prototype pickers (picker_map_unavailable, catalogue_pickers_location_desc) on ui-harness-v5 · by: JourneysR9c (intent-gated)
