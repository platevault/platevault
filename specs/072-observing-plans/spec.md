# Feature Specification: Observing plans, Targets list, rig filters, reminders, calendar export

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `072-observing-plans`

**Created**: 2026-10-03

**Amended**: 2026-10-06, to the workflow decisions D-W1 to D-W63 settled by the user that day. Tags such as (D-W16) name the decision a requirement follows.

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Observing plans, reminders, calendar export (Priority: P1)

Astronomical windows for a Target from a chosen planning site, opt-in reminders limited to the default site, a one-time ICS snapshot, and the Tonight data that Home shows. Planning works on Targets. A Project page shows planning for its own subjects and links to the Planner.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **PLAN-AC-01**: Given Backyard as default and a second saved site, when the planning site is switched, then windows recalculate for that site and time zone. Project subjects, the sessions in each processing run (View), and session capture sites are unchanged. (D-W16)
- **PLAN-AC-02**: Given reminders enabled at Backyard, when the user plans at another site, then no reminder is scheduled for that site and every reminder names Backyard.
- **PLAN-AC-03**: Given selected windows, when the calendar is exported, then the .ics holds exactly the confirmed windows with the displayed site and time zone; later criteria changes leave the saved file unchanged.
- **PLAN-AC-04**: Given no default site, when Enable notifications is chosen, then the user is directed to set one and no reminder is scheduled without a named site.
- **PLAN-AC-05**: Given reminders were never enabled, then no background reminder activity occurs; enabling reminders starts no indexing.
- **PLAN-AC-06**: Given notifications are disabled, when enabling is requested without explicit criteria or lead time, then no reminder starts. The confirmed site, criteria and lead time are shown before activation.
- **PLAN-AC-07**: Given a reminder was delivered for a target/site/window identity, when the app restarts or resumes inside that window's lead time and recomputes upcoming windows, then that identity is not delivered again. No app-closed delivery capability is claimed without an installed, tested scheduler.
- **PLAN-AC-08**: Given OS notification permission is denied, when activation is requested, then denial remains visible with Settings and Retry, and no delivery success is claimed.
- **PLAN-AC-09**: Given M 101 is a subject of no Project, when its Plan area opens, then windows compute, and Mark Planned, Enable notifications and Export calendar are available without creating or choosing a Project. (D-W16)
- **PLAN-AC-10**: Given the Project "Summer nebulae" with subjects NGC 7000 and IC 1396, when the Project page opens, then its planning lists windows for those two subjects only. "Open in Planner" opens the Targets page limited to those subjects, with the rig selector set to "this Project's rigs". (D-W16, D-W37)
- **PLAN-AC-11**: Given a default site, M 31 in My targets, and an open Project with subject NGC 7000, when Home requests Tonight, then it receives:
  - the best window tonight for M 31 and for NGC 7000, each with start, end and peak altitude, leaving out a Target with no window tonight;
  - the Moon's illumination, phase, rise and set;
  - tonight's darkness window.

  Each value names the site and time zone. (D-W39)
- **PLAN-AC-12**: Given no saved planning site, when Home requests Tonight, then it receives no windows and the reason "Add an observing site in Settings". (D-W39)

### User Story 2 - Targets list (Priority: P1)

The Targets page lists the user's Targets with tonight's planning columns. Search covers the user's Targets, the bundled catalogues and SIMBAD. Presets and a rig selector narrow the list.

**Why this priority**: The Targets page is where planning starts for Targets in and outside Projects (D-W16).

**Independent Test**: Open the Targets page with fixture Targets, sessions, rigs and a saved site, and check the rows, columns, search results and presets against the stated values.

**Acceptance Scenarios**:

- **PLAN-TGT-AC-01**: Given M 31 and NGC 7000 in My targets and the bundled catalogues installed, when the Targets page opens, then "My targets" is selected and only M 31 and NGC 7000 are listed. (D-W17)
- **PLAN-TGT-AC-02**: Given Browse catalogues is selected with no catalogue and no preset, then no rows are listed and the page asks the user to choose a catalogue or a preset. After choosing Messier, the Messier objects are listed. (D-W17)
- **PLAN-TGT-AC-03**: Given the query "m 31", when search runs, then matches from My targets, the bundled catalogues and SIMBAD are listed, each with its source. A match not in My targets shows "Add to targets"; choosing it adds the Target to My targets and the search stays open. (D-W17)
- **PLAN-TGT-AC-04**: Given SIMBAD cannot be reached, when search runs, then matches from My targets and the bundled catalogues are listed and the results state that SIMBAD was not searched. (D-W17)
- **PLAN-TGT-AC-05**: Given a saved planning site, when the list shows, then the columns are ★, Designation, Type, Max alt, Lunar, Img time, Filters, Opposition, Sessions and Captured. Moon illumination appears once, in the toolbar, and in no row. (D-W18)
- **PLAN-TGT-AC-06**: Given a Target that never clears the altitude criterion tonight, then its Img time is 0 with the altitude reason. A Target with zero time because of the Moon shows the Moon reason, and one with zero time because there is no darkness shows the darkness reason. (D-W18)
- **PLAN-TGT-AC-07**: Given a Target without catalogued coordinates, then Max alt, Lunar, Img time and Opposition show "-" with the reason "This target has no catalogued coordinates, so visibility can't be computed." (D-W18)
- **PLAN-TGT-AC-08**: Given M 31 with 2h00m of Ha sessions and 1h30m of OIII sessions, where one 30m OIII session is Trashed, then Captured shows Ha 2h00m and OIII 1h00m. Sessions leaves out the Trashed session. (D-W18, D-W43)
- **PLAN-TGT-AC-09**: Given no rig is selected, then the preset menu offers exactly Best tonight (broadband), Narrowband (Moon up), Emission nebulae Ha, Galaxies dark sky, Planetary nebulae OIII and the user's saved presets. "Avoid tonight" is not offered. (D-W19)
- **PLAN-TGT-AC-10**: Given the user saves the current filters as "Autumn galaxies", when the app restarts, then "Autumn galaxies" is listed under saved presets and applying it restores the same filters. A saved preset can be renamed or deleted; a built-in preset cannot. (D-W19)
- **PLAN-TGT-AC-11**: Given the rig "Esprit 100 + ASI2600MM" is selected, then a Fit column appears showing "fits", "N panels" or "tiny" per Target. The presets Mosaic candidates and Fits nicely become available. Mosaic candidates lists only Targets that need 2 or more panels. Fits nicely lists only Targets that cover 25% to 90% of the field. (D-W23)
- **PLAN-TGT-AC-12**: Given a selected rig whose filters are L, R, G and B, then the Filters strip shows only L, R, G and B. The presets Narrowband (Moon up), Emission nebulae Ha and Planetary nebulae OIII are hidden. (D-W23, D-W31)
- **PLAN-TGT-AC-13**: Given a selected OSC rig with a dual-band filter that passes Ha and OIII, then the Filters strip shows R, G, B, Ha and OIII, and the narrowband presets are offered. (D-W31)
- **PLAN-TGT-AC-14**: Given the Targets page opened through "Open in Planner" from a Project with two rigs, then the rig selector shows "this Project's rigs". Fit shows one value per rig, labeled with the rig name. The Filters strip shows the union of the bands either rig can capture, and Mosaic candidates and Fits nicely match a Target when it matches on either rig. (D-W37, D-W62)
- **PLAN-TGT-AC-15**: Given no saved planning site, when the Targets page opens, then the planning columns show "-" and the page shows "Add an observing site in Settings". Search, Add to targets, ★ and Sessions still work. (D-W18)
- **PLAN-TGT-AC-16**: Given M 31 marked ★ and the open Project "Summer nebulae" with subject IC 1396, which is not marked ★. When the Targets page opens on My targets, then it lists M 31 and IC 1396, and IC 1396 carries a "Summer nebulae" Project badge. (D-W60)

### User Story 3 - Filters on optical trains (Priority: P2)

In Settings > Equipment the user lists the filters on each rig (optical train). The list drives the Targets band strip, the Targets narrowband presets and the Fit column's rig. A filter name in a FITS header that the rig does not list prompts the user to add it.

**Why this priority**: Without the rig's filters, the Targets band strip and presets would offer bands the user cannot capture (D-W23, D-W31).

**Independent Test**: Configure fixture rigs with mono and OSC cameras, index sessions with known and unknown FILTER values, and check the Equipment page, the prompt and the Targets page.

**Acceptance Scenarios**:

- **PLAN-EQ-AC-01**: Given the rig "Esprit 100 + ASI2600MM" with a mono camera, when the user adds L, R, G, B, Ha, SII and OIII to its filter list, then the list is saved with each filter's band. The Targets Filters strip for that rig shows all seven bands. (D-W31)
- **PLAN-EQ-AC-02**: Given a rig whose camera is OSC, then Settings > Equipment shows the rig as OSC, taken from the camera, with no Mono/OSC control on the filter list. With an empty filter list the rig captures R, G and B. (D-W31)
- **PLAN-EQ-AC-03**: Given a session on the mono rig "Esprit 100 + ASI2600MM" with the FILTER header "Halpha", which no filter on the rig matches, then the session shows the filter as unknown. It offers "Add Halpha to Esprit 100 + ASI2600MM". When the user adds it with band Ha, the filter list includes it and the Targets Filters strip updates. The session's header bytes and observed evidence are unchanged. (D-W31)
- **PLAN-EQ-AC-04**: Given the user declines the prompt, then the session keeps the observed value "Halpha" marked unknown and the rig's list is unchanged. The prompt stays available on the session and in Settings > Equipment. (D-W31)
- **PLAN-EQ-AC-05**: Given two rigs with different filter lists, when Settings > Goal templates opens, then the same templates are listed whichever rig is selected anywhere in the app. (D-W30, D-W31)
- **PLAN-EQ-AC-06**: Given saving a filter list fails, then the edit remains visibly unsaved with Retry and the previous list stays in effect. (D-W31)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- No saved planning site: planning columns, windows and Tonight show "-" or no windows with "Add an observing site in Settings"; nothing is computed for an assumed location. (D-W18, D-W39)
- A Target with no catalogued angular size: Fit shows "-" with "Size unknown". A rig with no known field of view: Fit shows "-" with "Field of view unknown"; Mosaic candidates and Fits nicely leave such Targets out. (D-W23)
- A session whose rig is not yet confirmed: the unknown-filter prompt waits until the rig is confirmed, because the filter list belongs to a rig. (D-W31)
- Trashed sessions and frames never count toward Sessions or Captured. (D-W43)

## Requirements

### Functional Requirements

- **PLAN-FR-01**: Saved sites and a default site are set in Settings. The planning-site selector is independent of Projects and capture sites; changing it never alters Project subjects, run sessions or session sites. (D-W16)
- **PLAN-FR-02**: A Target's Plan area sets altitude, darkness, Moon and minimum-duration criteria. Windows show their site and time-zone basis, and the active planning site is shown. Each open Project that has the Target as a subject shows its per-channel goal gap beside coverage. The gap names its "in project" and "captured" amounts with those labels. For a mosaic subject, the Plan area lists each of its panels. (D-W16, D-W36, D-W63)
- **PLAN-FR-03**: Mark Planned and Enable notifications are explicit opt-ins. Reminders use the displayed default site, and every reminder names it. Planning elsewhere never enables reminders there. Enabling reminders starts no indexing or image processing.
- **PLAN-FR-04**: Export calendar confirms site, date range, time zone, and selected windows, then saves an .ics file through the native save dialog as a one-time snapshot.
- **PLAN-FR-05**: Suitability is astronomical only: no weather, equipment, or processing-readiness claims, and no provider account or authorization.
- **PLAN-FR-06**: Notifications require explicit criteria and lead time plus the default site, all named before activation. Each delivered reminder's target/site/window identity is recorded durably. Resume and restart recompute upcoming windows and suppress repeats of recorded identities. App-closed delivery needs an installed, tested scheduler; otherwise that capability is explicitly unavailable.
- **PLAN-FR-07**: Permission denial remains visible and offers Settings and Retry. No scheduler acknowledgment is represented as actual notification delivery.
- **PLAN-FR-08**: Rust computes astronomical planning windows, Targets list values, Fit and Tonight through qualified shared skymath contracts. The frontend presents them and their controls without reimplementing scientific calculations. (D-W18, D-W23, D-W39)
- **PLAN-FR-09**: Planning is keyed by Target. A Target can be planned, marked Planned, given reminders and exported without belonging to any Project. A Project owns no windows. Its page shows the windows of its own subjects, from the same Target planning at the active planning site, and offers "Open in Planner". (D-W16)
- **PLAN-FR-10**: "Open in Planner" opens the Targets page in the Project's context. The list is limited to the Project's subjects and the rig selector is set to "this Project's rigs". The Project context is shown and can be cleared, which returns the list to My targets. (D-W16, D-W37)
- **PLAN-FR-11**: Tonight supplies Home's Tonight section for the default site. It holds:
  - the best window tonight, with start, end and peak altitude, for each subject of a Project not marked Done and each Target in My targets;
  - the Moon's illumination, phase, rise and set;
  - tonight's darkness window.

  Each value names its site and time zone. Targets without a window tonight are left out. A mosaic subject's window uses the mosaic's center. The same computation tells Home whether a subject has a window tonight. (D-W39, D-W35, D-W63)

#### Targets list

- **PLAN-TGT-FR-01**: The Targets page shows either "My targets" (the default) or "Browse catalogues". My targets lists the ★ favourites plus every subject of an open Project, and each such subject carries a badge naming its Project. ★ on a row adds or removes the favourite; a subject of an open Project stays listed with its badge either way. (D-W17, D-W60)
- **PLAN-TGT-FR-02**: Browse catalogues lists rows only once at least one bundled catalogue (Messier, NGC, IC, Sharpless, LBN, LDN, Caldwell, Barnard) or a preset is chosen. With neither chosen, it lists no rows and asks for a catalogue or a preset. (D-W17)
- **PLAN-TGT-FR-03**: Search covers My targets, the bundled catalogues and SIMBAD. It ignores case and whitespace, so "M31", "M 31" and "m31" match the same Target. It searches every row, not only rows already shown, and each result names its source. A result not in My targets offers "Add to targets" inline. Adding writes the Target into the library and My targets; a failed add shows the error with Retry. Searching alone writes nothing. When SIMBAD cannot be reached, the results say SIMBAD was not searched. (D-W17)
- **PLAN-TGT-FR-04**: The table has these columns, with values for tonight at the active planning site under the planning criteria:
  - ★: favourite toggle, not sortable.
  - Designation and Type.
  - Max alt: peak altitude tonight.
  - Lunar: angular separation from the Moon tonight.
  - Img time: hours tonight that meet the planning criteria, such as 2h10m.
  - Filters: the band strip (PLAN-TGT-FR-06).
  - Opposition: next opposition date.
  - Sessions: count of linked sessions, "-" when none.
  - Captured: compact integration per channel (PLAN-TGT-FR-08).

  Every column except ★ sorts ascending or descending. Unknown values sort last, and the default sort is Designation ascending. A Target without catalogued coordinates shows "-" with the reason. (D-W18)
- **PLAN-TGT-FR-05**: An Img time of zero shows why: altitude, Moon or darkness. Img time for a Target equals the total of its Plan area windows for tonight under the same site and criteria. (D-W18)
- **PLAN-TGT-FR-06**: The Filters strip shows bands L, R, G, B, Ha, SII and OIII, each marked viable or limited by the Moon tonight, with a recommendation label. With a rig selected it shows only the bands the rig's filters pass (PLAN-EQ-FR-03); with several rigs, such as "this Project's rigs", it shows the union of their bands. With no rig selected it shows all seven. (D-W18, D-W23, D-W31, D-W62)
- **PLAN-TGT-FR-07**: Moon illumination and phase appear once, in the toolbar, for tonight at the active planning site. No row repeats them. (D-W18)
- **PLAN-TGT-FR-08**: Captured shows, per channel, the integration of every session whose confirmed Target is this Target, whatever its quality. Trashed sessions and frames count toward neither Captured nor Sessions. (D-W18, D-W43)
- **PLAN-TGT-FR-09**: The built-in presets are Best tonight (broadband), Narrowband (Moon up), Emission nebulae Ha, Galaxies dark sky and Planetary nebulae OIII. Mosaic candidates and Fits nicely join them under PLAN-TGT-FR-12. The app offers no "Avoid tonight" preset. Each preset's definition is shown with it:
  - Best tonight (broadband): Img time above zero with a broadband band viable, sorted by Img time descending.
  - Narrowband (Moon up): Img time above zero with Ha, SII or OIII viable while the Moon is up.
  - Emission nebulae Ha: emission nebulae with Ha viable.
  - Galaxies dark sky: galaxies with Img time above zero while the Moon is below the horizon.
  - Planetary nebulae OIII: planetary nebulae with OIII viable.

  (D-W19)
- **PLAN-TGT-FR-10**: The user can save the current Show mode, catalogues, preset, Fit filter and sort as a named preset, and rename or delete saved presets. Saved presets persist across restarts and are listed after the built-ins. Built-in presets cannot be edited or deleted. A saved preset that needs a rig or a narrowband filter follows the same availability rules as a built-in one. (D-W19)
- **PLAN-TGT-FR-11**: The toolbar's rig selector offers:
  - no rig, the default;
  - each rig from Settings > Equipment;
  - "this Project's rigs", in a Project's context.

  With a rig selected, the Fit column appears. Fit compares the Target's catalogued angular size with the rig's field of view. Coverage is the Target's major axis as a share of the field's shorter side. Fit reads "fits" when the Target fits in one field with coverage of at least 25%, "N panels" when it needs a grid of N fields, and "tiny" below 25%. With two or more rigs, Fit shows one value per rig, labeled with the rig name. A Target or rig without the size or field of view shows "-" with the reason. (D-W23, D-W37, D-W61, D-W62)
- **PLAN-TGT-FR-12**: Mosaic candidates (2 or more panels) and Fits nicely (coverage of 25% to 90%) are offered only with a rig selected. With two or more rigs, a Target matches when it matches on any of them. (D-W23, D-W37, D-W62)
- **PLAN-TGT-FR-13**: Narrowband (Moon up), Emission nebulae Ha and Planetary nebulae OIII are hidden when a rig is selected and no filter on it passes Ha, SII or OIII. (D-W23, D-W31)
- **PLAN-TGT-FR-14**: Selecting a row opens that Target's Plan area (PLAN-FR-02). (D-W16)

#### Filters on optical trains

- **PLAN-EQ-FR-01**: In Settings > Equipment each rig (optical train) holds a plain list of filters, with no limit on their number and the same form for mono and OSC cameras. Each filter has a name, the FITS FILTER values it matches, and the bands it passes (one or more of L, R, G, B, Ha, SII, OIII). (D-W31)
- **PLAN-EQ-FR-02**: Mono or OSC comes from the rig's camera, not from the filter list. An OSC rig captures R, G and B without a filter; on any rig, each listed filter adds the bands it passes. (D-W31)
- **PLAN-EQ-FR-03**: A rig's filter list drives the Targets Filters strip (PLAN-TGT-FR-06) and the visibility of the narrowband presets (PLAN-TGT-FR-13). The selected rig's field of view drives Fit (PLAN-TGT-FR-11). The filter list never filters Goal templates. (D-W30, D-W31)
- **PLAN-EQ-FR-04**: When a session's FILTER header value matches no filter on its confirmed rig, the session shows the filter as unknown and offers "Add {value} to {rig}". Settings > Equipment lists the unknown values seen per rig. Adding asks for the bands the filter passes and changes only the rig's settings; header bytes and observed evidence stay unchanged. Declining leaves the value unknown and the prompt available. (D-W31)
- **PLAN-EQ-FR-05**: A rig's field of view comes from its camera's sensor size and pixel size and the rig's focal length. When any of these is unknown, the field of view is unknown and Fit says so. (D-W23)
- **PLAN-EQ-FR-06**: A failed filter-list save stays visibly unsaved with Retry, and the last saved list stays in effect. (D-W31)

### Owned interaction steps

- B3
- K
- Targets list: Show mode, search with Add to targets, columns, presets and rig selector (D-W17, D-W18, D-W19, D-W23, D-W37)
- Settings > Equipment filter lists and the unknown-filter prompt (D-W31)
- Tonight data for Home (D-W39)

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Processing run (View)**: the root View; this spec calls it a run. Planning never changes which sessions a run holds.
- **My targets**: the Targets the user has marked ★, plus every subject of an open Project, shown with its Project badge. (D-W60)
- **Rig**: an optical train from Settings > Equipment: telescope, camera, focal length, field of view and filter list.
- **Rig filter**: one entry in a rig's filter list: name, matched FITS FILTER values and passed bands.
- **Targets preset**: a named set of Targets list filters, either built in or saved by the user.
- **Tonight**: tonight's best windows for Project subjects and My targets, the Moon and the darkness window at the default site.

## Success Criteria

### Measurable Outcomes

- **PV-PLAN-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-PLAN-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-PLAN-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.
- **PV-PLAN-SC-04**: For every fixture Target, the Targets list's Max alt and Img time match the Plan area for the same site, night and criteria. Tonight's windows match the Plan area's best window. (D-W18, D-W39)
- **PV-PLAN-SC-05**: Browse catalogues lists zero rows while no catalogue and no preset is chosen. (D-W17)
- **PV-PLAN-SC-06**: For every fixture rig, the Filters strip shows exactly the bands its filter list passes. No narrowband preset appears for a rig without a narrowband filter. (D-W23, D-W31)

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.
- A Project's rigs (D-W37), Project subjects and goals (D-W9, D-W29, D-W36) and the Project Done state (D-W26, D-W46) are defined by the Project feature; this feature reads them.

## Decisions before feature approval

- Root decisions D07 and D18 define opt-in reminders, explicit site/criteria/lead time, repeat suppression, permission recovery, honest scheduler capability and shared scientific calculations. Scheduler delivery claims require real platform evidence.
- Root decision D19 has no PLAN consumer: no planning path consumes a recorded file, and calendar export writes computed windows.
- Workflow decisions D-W16, D-W17, D-W18, D-W19, D-W23, D-W31, D-W37, D-W60, D-W61, D-W62, D-W63 and section 4 of D-W39 define Target-keyed planning, the Targets list, rig filters and Tonight. D-W30, D-W35, D-W36, D-W43 and D-W46 are read here where they constrain this feature's outputs.
