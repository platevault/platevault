---
id: J15
title: Register rigs with their filter lists and observing sites in Settings
version: 2
status: draft
last_reviewed: 2026-07-14
actors: [primary-user]
surfaces: [equipment, observing-sites, sessions, settings]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 064-library-inventory, 065-project-goals, 072-observing-plans, D11, D17, D-W23, D-W30, D-W31, D-W37, specs/064-library-inventory/spec.md, specs/065-project-goals/spec.md, specs/072-observing-plans/spec.md, docs/product/journeys/J15-equipment-observing-site-setup/journey.md @42c596d6]
---

## Goal

The user records the cameras and telescopes they own, composes them into rigs
(optical trains) with the list of filters each rig carries, and saves the sites
they observe from, all in Settings. A FITS FILTER value that a session's rig
does not list prompts the user to add it to that rig. Done means: the rigs
`RedCat` (mono) and `Esprit` (OSC) exist with their fields of view, and `RedCat`
lists Ha, OIII and the prompted `Halpha` filter. The Halpha session reads band
Ha without any change to its header bytes. Goal templates are the same whichever
rig is selected, and Backyard and `Remote site` are saved with no default site
designated.

## Preconditions

- P1: A clean development build of the rebuilt PlateVault (D17). Onboarding is complete with one disposable Captures location `Filter-test/Captures`, registered and indexed. It holds one session `Halpha-test` of 10 mono 300 s lights with OBJECT `NGC 7000`, INSTRUME `ZWO ASI2600MM Pro`, TELESCOP `RedCat 51`, FOCALLEN `250` and FILTER `Halpha`. No camera, telescope, rig or observing site is saved yet.
- P2: The equipment datasheet values: ASI2600MM is mono with 6248 × 4176 pixels of 3.76 µm; ASI533MC is OSC with 3008 × 3008 pixels of 3.76 µm; RedCat 51 has a 250 mm focal length; Esprit 100 has a 550 mm focal length.
- P3: Backyard's coordinates and IANA time zone are the ones the J19/P2 fixture headers carry. `Remote site` uses the J19/P3 coordinates, at least 15° of longitude and one time zone away from Backyard (J20/P2).
- P4: A fault control that makes the next save of a rig's filter list fail until it is disarmed (G5).
- P5: A SHA-256 of every `Halpha-test` file is recorded.

## Steps

### S1 — Open Settings → Equipment {#S1}

- **Do:** From Settings, open the Equipment pane.
- **Expect:** The Cameras, Telescopes and Optical trains sections each load their current list or an empty-state message independently.
- **Expect (negative):** A load failure in one section shows its own inline error and does not block the other sections from loading.
- **Trace:** baseline J15 v1/S1 · LIB-FR-10

### S2 — Register the cameras and telescopes {#S2}

- **Do:** Add the camera ASI2600MM with the alias `ZWO ASI2600MM Pro`, mono, and its P2 pixel count and pixel size. Add ASI533MC as OSC the same way. Add the telescopes RedCat 51 and Esprit 100 with their P2 focal lengths.
- **Expect:** Each entry appears in its table immediately. Each camera shows Mono or OSC and its sensor size, and aliases render as the comma-joined list.
- **Expect (negative):** Saving with the name field blank is rejected inline before any request is sent, and no row is added.
- **Trace:** baseline J15 v1/S2 · PLAN-EQ-FR-02, PLAN-EQ-FR-05 · D11

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

### S4 — Add filters to `RedCat` {#S4}

- **Do:** On `RedCat`, add the filter Ha matching FITS FILTER value `Ha` with band Ha, and the filter OIII matching `OIII` with band OIII. Save the list.
- **Expect:** The list is saved and shows each filter with its matched FILTER values and its band. `RedCat` now captures Ha and OIII.
- **Expect (negative):** The list sets no limit on the number of filters, and adding a filter to `RedCat` leaves `Esprit`'s list empty.
- **Trace:** PLAN-EQ-FR-01, PLAN-EQ-FR-02 · PLAN-EQ-AC-01 · D-W31

### S4a — Recover from a failed filter-list save {#S4a}

- **Do:** Arm the P4 fault. On `RedCat`'s OIII filter, add the matched FILTER value `O3` and save. Then disarm the fault and click **Retry**.
- **Expect:** The first save fails: the edit stays visibly unsaved with **Retry**, and the saved list (OIII matching `OIII` only) stays in effect. After **Retry** the OIII filter matches `OIII` and `O3`.
- **Expect (negative):** No durable success is reported before the retried save commits.
- **Trace:** PLAN-EQ-FR-06 · PLAN-EQ-AC-06 · LIB-FR-11 · D-W31

### S4b — Confirm the session's rig and meet the unknown filter {#S4b}

- **Do:** In Sessions, open `Halpha-test`. Note its filter, then choose **Confirm equipment** with the rig `RedCat`.
- **Expect:** Before the rig is confirmed, the session shows the observed FILTER value `Halpha` with no prompt. After confirmation it reads rig `RedCat`, shows the filter `Halpha` as unknown, and offers "Add Halpha to RedCat".
- **Expect (negative):** No prompt names a rig before the session's rig is confirmed. Confirming the rig changes no header byte.
- **Trace:** LIB-FR-05, PLAN-EQ-FR-04 · PLAN-EQ-AC-03, edge case "rig not yet confirmed" · D-W31, D-W37

### S4c — Decline the prompt {#S4c}

- **Do:** Dismiss "Add Halpha to RedCat" on the session, then open Settings → Equipment.
- **Expect:** The session keeps the observed value `Halpha` marked unknown, and the prompt is still offered on the session. Settings → Equipment lists `Halpha` as an unknown value seen on `RedCat`, with the same prompt.
- **Expect (negative):** `RedCat`'s filter list is unchanged: Ha and OIII.
- **Trace:** PLAN-EQ-FR-04 · PLAN-EQ-AC-04 · D-W31

### S4d — Add the unknown filter from Settings {#S4d}

- **Do:** In Settings → Equipment, choose "Add Halpha to RedCat", select band Ha and save. Return to `Halpha-test`.
- **Expect:** `RedCat`'s list includes a filter matching `Halpha` with band Ha. The session reads band Ha instead of an unknown filter, and `Halpha` leaves the unknown values listed for `RedCat`.
- **Expect (negative):** Every `Halpha-test` file still matches its P5 SHA-256, and the session's observed FILTER evidence still reads `Halpha`. `Esprit`'s filter list is unchanged.
- **Trace:** PLAN-EQ-FR-04 · PLAN-EQ-AC-03 · LIB-FR-05 · D-W31

### S4e — Goal templates ignore the rig {#S4e}

- **Do:** In the Targets toolbar, select the rig `RedCat` and open Settings → Goal templates. Then select `Esprit` and open Settings → Goal templates again.
- **Expect:** Both times the same templates are listed: the built-ins HOO, SHO, LRGB, OSC broadband and OSC dual-band.
- **Expect (negative):** No template is hidden or reordered because `Esprit` has no narrowband filter.
- **Trace:** PLAN-EQ-FR-03 · PLAN-EQ-AC-05 · PRJ-AC-14 · D-W30, D-W31

### S6 — Add the Backyard observing site {#S6}

- **Do:** In the observing sites section of Settings, add Backyard with a name, the P3 latitude, longitude and IANA time zone, and no elevation.
- **Expect:** Backyard appears in the sites table with its formatted coordinates and time zone. It is not marked default.
- **Expect (negative):** Latitude outside ±90°, longitude outside ±180°, or a non-numeric elevation is each rejected inline, and no site is saved.
- **Trace:** baseline J15 v1/S6 · PLAN-FR-01 · PLAN-AC-04 · D-W16

### S7 — Add a second site {#S7}

- **Do:** Add `Remote site` with its P3 coordinates and time zone.
- **Expect:** Both sites are listed with their own coordinates and time zones, and neither is marked default until the user designates one (J29/S5).
- **Expect (negative):** Adding `Remote site` changes none of Backyard's fields and no session's capture site.
- **Trace:** PLAN-FR-01 · PLAN-AC-01, PLAN-AC-04 · D-W16

## Success criteria

- SC1: Two rigs exist: `RedCat` reads Mono with a field of view of about 5.4° × 3.6°, and `Esprit` reads OSC, about 1.2° × 1.2°, capturing R, G and B with an empty list (S3, S3a).
- SC2: After S4d, `RedCat` lists exactly 3 filters (Ha, OIII and Halpha) and `Esprit` lists 0 (S4, S4c, S4d).
- SC3: 0 `Halpha-test` files change across S4b, S4c and S4d, and its observed FILTER evidence stays `Halpha`.
- SC4: The failed save leaves the previous list in effect and reports 0 durable successes before **Retry** (S4a).
- SC5: Settings → Goal templates lists the same 5 built-in templates with `RedCat` and with `Esprit` selected (S4e).
- SC6: 2 sites are saved and 0 are marked default (S6, S7).

## Known gaps

- G1: (dissolved 2026-07-15) — tracked as issue #879; registered equipment not consumed elsewhere.
- G2: (dissolved 2026-07-15) — tracked as issue #659; no duplicate-name check for most equipment.
- G3: (dissolved 2026-10-06): the fixed per-band moon-avoidance table and the separate Filters list are not part of the rebuild contract. Each rig's filter list drives the Targets band strip and presets (PLAN-EQ-FR-03, D-W31).
- G4: Not validated. The rebuilt application does not exist. Product behavior follows the specs and the workflow decisions D-W23, D-W30, D-W31 and D-W37. No implementation has been validated against them.
- G5: Unresolved implementation qualification: no fault control yet fails a filter-list save (P4). S4a depends on it. Blocks readiness.
- G6: Out of scope for this journey: removing a site, and how the default site moves when the default site is removed, are not exercised. The default site is set in J29/S5. Blocks readiness until covered by a step or a journey.
- G7: Out of scope for this journey: the unknown-filter prompt in the Import preview (STO-IMP-FR-03) and the Targets Filters strip a rig drives (PLAN-TGT-FR-06) are not exercised here. J35 covers the strip. Blocks readiness until the Import prompt is covered by a step or a journey.
- G8: Unresolved implementation qualification: the flow names no Settings pane or label for observing sites, and it does not state whether the first saved site becomes the default. S6 and S7 follow J20/P2 and J29/S4, which need no default after both sites are saved. Blocks readiness.

## Delta log

- **Δ2** 2026-10-06 · S1, S2, S3, S4, S6, S7, +S3a, +S4a, +S4b, +S4c, +S4d, +S4e · behavior-change
  Filters now belong to each rig as a plain list, with Mono or OSC taken from the camera and a field of view per rig. A FILTER value the rig does not list prompts "Add {value} to {rig}". Goal templates ignore the rig. Steps 5, 8 and 9 (audit rows, site removal, the moon-avoidance table) and the separate Filters list are retired.
  Evidence: D-W23, D-W30, D-W31, D-W37 (workflow decisions, settled 2026-10-06); 072 PLAN-EQ-FR-01 to PLAN-EQ-FR-06, PLAN-EQ-AC-01 to PLAN-EQ-AC-06; 064 LIB-FR-05 at e4476231 · by: agent (intent-gated, user instruction)
