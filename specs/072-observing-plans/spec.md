# Feature Specification: Observing plans, Targets list, rig filters, reminders, calendar export

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `072-observing-plans`

**Created**: 2026-10-03

**Amended**: 2026-10-06, to the workflow decisions D-W1 to D-W63 settled by the user that day, on 2026-10-12 to 2026-10-14 to the Round 9 decisions D-W87 to D-W89, on 2026-10-14 to the F4 Project model, D-W93 to D-W106, and on 2026-10-19 to the owner's answers on rig versions, My targets and the session filter prompt (astro-plan-rzbzu.1). Tags such as (D-W16) name the decision a requirement follows.

**Amended**: 2026-10-26, to the Round 11 decisions D-W142 and D-W147, to the Rounds 5 to 9 decisions recorded that day (D-W151, D-W152 and D-W160) and to the owner's answer D-W155. Amended 2026-10-29 to the owner's answer D-W170. Home's planning criteria have no defaults, and the setup wizard sets them (PLAN-FR-11, PLAN-AC-17).

**Amended**: 2026-10-27, to the owner's answer D-W164, which settles the click-to-act search with no Add button (PLAN-TGT-FR-03, PLAN-TGT-AC-03).

**Status**: Backend landed; frontend and acceptance open (reconciled 2026-10-26, `specs/SPEC_STATUS.md`). Landed: the planning, calendar and reminder backend (#1780-#1783), moved onto Projects in the F4 cut-over (#1851). Remains: the Plan area, Sites and Targets surfaces (astro-plan-mp25r) and verification. Product defaults and all human-approval gate waivers follow the root autonomous objective.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Observing plans, reminders, calendar export (Priority: P1)

Astronomical windows for a Target from a chosen planning site, opt-in reminders limited to the default site, a one-time ICS snapshot, and the Tonight and calendar data that Home shows. Planning works on Targets. A Project page shows planning for its own subjects and links to the Planner.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **PLAN-AC-01**: Given Backyard as default and a second saved site, when the planning site is switched, then windows recalculate for that site and time zone. Project subjects, the sessions each Project holds and session capture sites are unchanged. (D-W16, D-W94)
- **PLAN-AC-02**: Given reminders enabled at Backyard, when the user plans at another site, then no reminder is scheduled for that site and every reminder names Backyard.
- **PLAN-AC-03**: Given plans on two upcoming nights, when the user exports the calendar from the "Planned" view, then the .ics holds exactly the windows of both plans. Each window names the displayed site and time zone. Later criteria changes leave the saved file unchanged. (D-W151)
- **PLAN-AC-04**: Given no default site, when Enable notifications is chosen, then the user is directed to set one and no reminder is scheduled without a named site.
- **PLAN-AC-05**: Given reminders were never enabled, then no background reminder activity occurs; enabling reminders starts no indexing.
- **PLAN-AC-06**: Given notifications are disabled, when enabling is requested without explicit criteria or lead time, then no reminder starts. The confirmed site, criteria and lead time are shown before activation.
- **PLAN-AC-07**: Given a reminder was delivered for a target/site/window identity, when the app restarts or resumes inside that window's lead time and recomputes upcoming windows, then that identity is not delivered again. No app-closed delivery capability is claimed without an installed, tested scheduler.
- **PLAN-AC-08**: Given OS notification permission is denied, when activation is requested, then denial remains visible with Settings and Retry, and no delivery success is claimed.
- **PLAN-AC-09**: Given M 101 is a subject of no Project, when its Plan area opens, then windows compute, and its row offers Add to plan. After Add to plan, the "Planned" view lists M 101 for that night, and its header offers Enable notifications and Export calendar, all without a Project. (D-W16, D-W151)
- **PLAN-AC-10**: Given the Project "Summer nebulae" with subjects NGC 7000 and IC 1396, when the Project page opens, then its planning lists windows for those two subjects only. "Open in Planner" opens the Targets page limited to those subjects, with the rig selector set to "this Project's rigs". (D-W16, D-W37)
- **PLAN-AC-11**: Given a default site and an open Project with unfinished Ha and OIII goals on subject NGC 7000, when Home requests Tonight, then it receives each of those goals graded good, marginal or poor for tonight under the channel's Moon-avoidance curve, with the best window's start, end and peak altitude, and the Moon's illumination, phase, rise and set and tonight's darkness window. Each value names the site and time zone. When no goal suits tonight, it receives the next good night's date instead. (D-W88, D-W89)
- **PLAN-AC-12**: Given no saved planning site, when Home requests Tonight or the calendar, then it receives no windows and the reason "Add a site to see tonight's darkness and Moon." (D-W89)
- **PLAN-AC-13**: Given the user enables a reminder, then the lead time is a number with a unit (minutes, hours or days) that the user can type, plus presets, prefilled from the default lead time setting, which reads 12 hours until the user changes it. Typing 30 minutes or less, in the reminder or in the setting, shows an inline error and cannot be saved. (D-W88)
- **PLAN-AC-14**: Given a default site and one Target in the plan for Friday, when Home requests the calendar, then it receives five weeks of nights, starting with the week of the request. Each night has its Moon phase, hours of darkness, number of goals it suits and number of Targets in its plan, and Friday counts one. The card for a night lists its dark window and the Moon's illumination, moonrise and moonset. It also lists the goals the night suits, best first, the goals the Moon rules out, and the Targets in its plan. (D-W89, D-W151)
- **PLAN-AC-15**: Given reminders enabled for five Targets and PlateVault closed for two nights, where two windows ended while it was closed and three are open at start-up (one has started, two are inside their lead time), when PlateVault starts, then Activity records the two ended windows as "Missed while PlateVault was closed" with no notification. One notice names three Targets, or three and "1 more" when a fourth is open, and opens Targets for tonight. None of the three open windows notifies again, and the next window that enters its lead time notifies on its own. (D-W88)
- **PLAN-AC-16**: Given the editor for site Backyard, when the user picks the place search result "Utrecht", then the latitude and longitude fields show its coordinates, and saving stores those numbers. A map that can't load leaves the editor reading "map unavailable", and typed coordinates still save the site. (D-W160)
- **PLAN-AC-17**: Given a default site and no saved planning criteria, when Home requests Tonight or the calendar, then it receives no window or grade. After the setup wizard saves criteria, Home's requests use them. (D-W170)

### User Story 2 - Targets list (Priority: P1)

The Targets page lists the user's Targets with tonight's planning columns. Search covers the user's Targets, the bundled catalogues and SIMBAD. Presets and a rig selector narrow the list.

**Why this priority**: The Targets page is where planning starts for Targets in and outside Projects (D-W16).

**Independent Test**: Open the Targets page with fixture Targets, sessions, rigs and a saved site, and check the rows, columns, search results and presets against the stated values.

**Acceptance Scenarios**:

- **PLAN-TGT-AC-01**: Given M 31 and NGC 7000 in My targets and the bundled catalogues installed, when the Targets page opens, then "My targets" is selected and only M 31 and NGC 7000 are listed. (D-W17)
- **PLAN-TGT-AC-02**: Given Browse catalogues is selected with no catalogue and no preset, then no rows are listed and the page asks the user to choose a catalogue or a preset. After choosing Messier, the Messier objects are listed. (D-W17)
- **PLAN-TGT-AC-03**: Given the query "m 31", when search runs, then matches from My targets, the bundled catalogues and SIMBAD are listed, each with its source. Clicking a match not in My targets adds it to My targets as a favourite, with a star in its Favourite column, and the search stays open. Clicking a match already in My targets opens its Target. No result row has an Add button (PLAN-TGT-FR-03). (D-W17, D-W142, D-W152, D-W164)
- **PLAN-TGT-AC-04**: Given SIMBAD cannot be reached, when search runs, then matches from My targets and the bundled catalogues are listed and the results state that SIMBAD was not searched. (D-W17)
- **PLAN-TGT-AC-05**: Given a saved planning site, when the list shows, then the columns are Favourite, Designation, Type, Altitude, Max alt, Lunar, Img time, Filters, Opposition, Sessions and Captured. Moon illumination appears once, in the toolbar, and in no row. (D-W18, D-W142, D-W151)
- **PLAN-TGT-AC-06**: Given a Target that never clears the altitude criterion tonight, then its Img time is 0 with the altitude reason. A Target with zero time because of the Moon shows the Moon reason, and one with zero time because there is no darkness shows the darkness reason. (D-W18)
- **PLAN-TGT-AC-07**: Given a Target without catalogued coordinates, then Max alt, Lunar, Img time and Opposition show "-" with the reason "This target has no catalogued coordinates, so visibility can't be computed." (D-W18)
- **PLAN-TGT-AC-08**: Given M 31 with 2h00m of Ha sessions and 1h30m of OIII sessions, where one 30m OIII session is Trashed, then Captured shows Ha 2h00m and OIII 1h00m. Sessions leaves out the Trashed session. (D-W18, D-W43)
- **PLAN-TGT-AC-09**: Given no rig is selected, then the preset menu offers exactly Best tonight (broadband), Narrowband (Moon up), Emission nebulae Ha, Galaxies dark sky, Planetary nebulae OIII and the user's saved presets. "Avoid tonight" is not offered. (D-W19)
- **PLAN-TGT-AC-10**: Given the user saves the current filters as "Autumn galaxies", when the app restarts, then "Autumn galaxies" is listed under saved presets and applying it restores the same filters. A saved preset can be renamed or deleted; a built-in preset cannot. (D-W19)
- **PLAN-TGT-AC-11**: Given the rig "Esprit 100 + ASI2600MM" is selected, then a Fit column appears showing "fits", "N panels" or "tiny" per Target. The presets Mosaic candidates and Fits nicely become available. Mosaic candidates lists only Targets that need 2 or more panels. Fits nicely lists only Targets that cover 25% to 90% of the field. (D-W23)
- **PLAN-TGT-AC-12**: Given a selected rig whose filters are L, R, G and B, then the Filters strip shows only L, R, G and B. The presets Narrowband (Moon up), Emission nebulae Ha and Planetary nebulae OIII are hidden. (D-W23, D-W31)
- **PLAN-TGT-AC-13**: Given a selected OSC rig with a dual-band filter that passes Ha and OIII, then the Filters strip shows R, G, B, Ha and OIII, and the narrowband presets are offered. (D-W31)
- **PLAN-TGT-AC-14**: Given the Targets page opened through "Open in Planner" from a Project with two rigs, then the rig selector shows "this Project's rigs". Fit shows one value per rig, labeled with the rig name. The Filters strip shows the union of the bands either rig can capture, and Mosaic candidates and Fits nicely match a Target when it matches on either rig. (D-W37, D-W62)
- **PLAN-TGT-AC-15**: Given no saved planning site, when the Targets page opens, then the planning columns show "-" and the page shows "Add an observing site in Settings". Search, clicking a result to add or open it, Favourite and Sessions still work. (D-W18, D-W142, D-W152)
- **PLAN-TGT-AC-16**: Given M 31 marked as a favourite and the open Project "Summer nebulae" with subject IC 1396, which is not a favourite, when My targets opens, then it lists M 31 and IC 1396. IC 1396 carries a "Summer nebulae" Project badge. (D-W60, D-W142)
- **PLAN-TGT-AC-17**: Given the Targets page on tonight, when the user chooses next week twice, then every column shows values for the night two weeks ahead and the night picker names it. Today returns the page to tonight. When Home's calendar opens Targets for a night, the page opens set to that night. (D-W88)
- **PLAN-TGT-AC-18**: Given a night with a 60 % lit Moon, when the user chooses Ha and OIII in Suitable filters, then the table lists every Target for which Ha or OIII is good or marginal, sorted by the longer of the two bands' clear times, and each band's grade comes from its Moon-avoidance curve, so Img time and the Filters strip agree. A poor band shows in the danger tone and a marginal band in the warning tone. (D-W88)
- **PLAN-TGT-AC-19**: Given an indexed session whose Target is NGC 7000, when the user opens My targets, then NGC 7000 appears even if it is neither a favourite nor the subject of an open Project. Clicking its search result opens NGC 7000 and adds nothing (PLAN-TGT-FR-03; owner's answer, 2026-10-19, astro-plan-rzbzu.1). (D-W152)
- **PLAN-TGT-AC-20**: Given My targets with M 31 and M 33, of which only M 31 is a favourite, when the user sets the Favourite filter to Yes, then only M 31 is listed. Its Favourite column shows a star, and the URL keeps the choice in `?fav=`. No lists only M 33, and All lists both. A preset saved with Yes restores it when applied. (D-W142)
- **PLAN-TGT-AC-21**: Given the Target page of M 33, which is not a favourite, when the user turns on the Favourite toggle beside its title, then M 33 becomes a favourite. Its Targets row shows a star. A refused write shows its alert on a row under the page header; the toggle stays in place, and M 33 stays not a favourite. (D-W142)
- **PLAN-TGT-AC-22**: Given Browse catalogues with Messier chosen and M 31 in My targets but not a favourite, then M 31's row shows a check in the My targets column. Its Favourite column shows no star. (D-W142)
- **PLAN-TGT-AC-23**: Given NGC 7000 in tonight's plan, when the user sets the night picker to the next night, then the "Planned" view lists no Target and NGC 7000's row offers Add to plan. After Add to plan, the next night's plan lists NGC 7000, and tonight's plan still lists it once. Remove from plan on the next night leaves tonight's plan unchanged. (D-W151)
- **PLAN-TGT-AC-24**: Given a saved planning site, when the All or the "Planned" view shows, then each row's Altitude column plots the Target's altitude across the night. The plot shades the dark window and marks the best window. Its tooltip states the same maximum altitude as Max alt, with its time. The page shows no wide altitude timeline. (D-W151)

### User Story 3 - Equipment: rigs compose a camera, a telescope and filters (Priority: P2)

In Settings > Equipment the user keeps cameras, telescopes and filters as their own records, and each rig (optical train) selects one camera, one telescope and the filters it uses. A rig's filters drive the Targets band strip, the Targets narrowband presets and the Fit column's rig. A filter name in a FITS header that matches no filter on the rig prompts the user to add a filter to it. Editing a rig creates a dated rig version, and each session keeps the version it was captured with. Cameras of the same model are told apart by alias, and a camera can be set to "Don't use darks" or "Don't use bias".

**Why this priority**: Without the rig's filters, the Targets band strip and presets would offer bands the user cannot capture (D-W23, D-W31).

**Independent Test**: Configure fixture rigs with mono and OSC cameras, index sessions with known and unknown FILTER values, and check the Equipment page, the prompt and the Targets page. Edit a rig between two capture nights, add a second camera of one model, and set a camera to "Don't use darks", then check the sessions' rig versions and calibration states.

**Acceptance Scenarios**:

- **PLAN-EQ-AC-01**: Given filter records L, R, G, B, Ha, SII and OIII, each with its band, when the user selects all seven in the rig "Esprit 100 + ASI2600MM" with a mono camera, then the rig is saved with those filters. The Targets Filters strip for that rig shows all seven bands. (D-W31, D-W87)
- **PLAN-EQ-AC-02**: Given a rig whose camera is OSC, then Settings > Equipment shows the rig as OSC, taken from the camera, with no Mono/OSC control on the rig. With no filters selected the rig captures R, G and B. (D-W31, D-W87)
- **PLAN-EQ-AC-03**: Given a session on the mono rig "Esprit 100 + ASI2600MM" with the FILTER header "Halpha", which no filter on the rig matches, then the session shows the filter as unknown. It offers "Add Halpha to Esprit 100 + ASI2600MM". When the user adds it with band Ha, a filter record named Halpha that matches the header value "Halpha" and passes Ha is created and selected in the rig, and the Targets Filters strip updates. The session's header bytes and observed evidence are unchanged. (D-W31, D-W87)
- **PLAN-EQ-AC-04**: Given the user declines the prompt, then the session keeps the observed value "Halpha" marked unknown and the rig's filters are unchanged. The prompt stays available on the session and in Settings > Equipment. (D-W31, D-W87)
- **PLAN-EQ-AC-05**: Given two rigs with different filters, when Settings > Goal templates opens, then the same templates are listed whichever rig is selected anywhere in the app. (D-W30, D-W31)
- **PLAN-EQ-AC-06**: Given saving a rig or a filter fails, then the edit remains visibly unsaved with Retry and the previous record stays in effect. (D-W31, D-W87)
- **PLAN-EQ-AC-07**: Given camera ASI2600MM used by two rigs, when the user edits a rig, then the rig editor offers only the choice of camera, telescope and filters and no camera or telescope property. The camera's Used by shows a popover listing both rigs, each linking to it. (D-W87)
- **PLAN-EQ-AC-08**: Given rig RedCat at version 1, with light sessions of 1 Oct and 5 Oct pinned to the flats of 1 Oct, when the user edits the rig and the new version starts on 8 Oct, then RedCat lists both versions with their start dates. The 1 Oct and 5 Oct sessions still record version 1 and keep their flats. A session captured on 9 Oct records version 2: the 1 Oct flats are not offered for it, and its darks and bias still match by camera. (D-W102, D-W104)
- **PLAN-EQ-AC-09**: Given the same rig, when the user edits it and dates the new version 3 Oct, then the 5 Oct session still records version 1 and keeps its flats, and no Project that holds it gets a pending change. This is provisional. (D-W104)
- **PLAN-EQ-AC-10**: Given one camera of model ASI2600MM, when darks of that model are imported, then they match its sessions with no question. When the user adds a second ASI2600MM, Settings > Equipment asks for an alias for each of the two and refuses to save while an alias is missing or another camera uses it. With aliases `ASI2600 A` and `ASI2600 B`, Import asks which camera took the next ASI2600MM darks, and a session from a rig with `ASI2600 A` is matched only to darks and bias linked to `ASI2600 A`. (D-W104)
- **PLAN-EQ-AC-11**: Given camera ASI533MC set to "Don't use darks", when a session from a rig with that camera is ingested, then its darks read No darks with no warning, no dark is matched or suggested, and the session counts as settled for darks. When the user pins a dark on that session, it keeps the dark, and the camera's other sessions stay No darks. (D-W104, D-W105)
- **PLAN-EQ-AC-12**: Given RedCat's first rig version starts on 2026-10-05 and a session was captured on 2026-10-02 before that version, when the session records its rig version, then it records RedCat version 1. When the user creates a new rig version, its start date defaults to today and the user may edit it before saving. (PLAN-EQ-FR-07; owner's answer, 2026-10-19, astro-plan-rzbzu.1)
- **PLAN-EQ-AC-13**: Given `Halpha-test` on confirmed rig `RedCat` with an unknown observed FILTER value `Halpha`, when the session opens, then it offers **Add Halpha to RedCat** and asks which bands the filter passes. If the user declines, the value remains unknown and the prompt is still available. The prototype needs the session control (owner's answer, 2026-10-19, astro-plan-rzbzu.1).
- **PLAN-EQ-AC-14**: Given Settings > Equipment, when the user opens Add equipment in the page header, then it offers Camera…, Telescope…, Reducer…, Filter… and Rig…, each opening that record's add dialog. No section that holds records has an Add button of its own. With no filter records, the Filters section's empty state offers its own Add…. (D-W147, D-W155)
- **PLAN-EQ-AC-15**: Given rig `RedCat` with a 250 mm telescope, a reducer record with the factor 0.8 and that reducer selected in the rig, then the rig's field of view is computed from 200 mm. Fit on the Targets page and the rig's framing groups use that field of view. (D-W155)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

- No saved planning site: planning columns, windows and Tonight show "-" or no windows with "Add an observing site in Settings"; nothing is computed for an assumed location. (D-W18, D-W39)
- A Target with no catalogued angular size: Fit shows "-" with "Size unknown". A rig with no known field of view: Fit shows "-" with "Field of view unknown"; Mosaic candidates and Fits nicely leave such Targets out. (D-W23)
- A session whose rig is not yet confirmed: the unknown-filter prompt waits until the rig is confirmed, because the prompt adds a filter to a rig. (D-W31, D-W87)
- Trashed sessions and frames never count toward Sessions or Captured. (D-W43)

## Requirements

### Functional Requirements

- **PLAN-FR-01**: Saved sites and a default site are set in Settings. The planning-site selector is independent of Projects and capture sites; changing it leaves Project subjects, the sessions a Project holds and session sites as they are. The site editor shows a map of OpenStreetMap tiles with a place search and Use my location. Its latitude and longitude fields stay the source of truth: a point on the map, a search result or Use my location fills them, and saving stores the fields. When the map can't load, the editor reads "map unavailable", and the fields still work. (D-W16, D-W94, D-W160)
- **PLAN-FR-02**: A Target's Plan area sets altitude, darkness, Moon and minimum-duration criteria. The Moon criterion is one Moon-avoidance curve per filter: the separation it requires from the Moon is greatest at full Moon and shrinks as the Moon dims (the Lorentzian curve of ACP and Target Scheduler; R10-MOON-MODEL.md on `ui-harness-v5`). A sample counts when the Moon is below the horizon or at least that far away. Windows, Img time and band grades all use the same curve. Windows show their site and time-zone basis, and the active planning site is shown. Each open Project that has the Target as a subject shows its per-channel goal gap beside coverage. The gap names its "in project" and "captured" amounts with those labels. In a mosaic Project the gap shows per panel group, because each panel keeps its own goals (PRJ-FR-03, PRJ-FR-29). (D-W16, D-W88, D-W95, D-W96)
- **PLAN-FR-03**: Add to plan and Enable notifications are explicit opt-ins. Reminders use the displayed default site, and every reminder names it. Reminders follow the default site only, whatever site the user plans at. Enabling reminders starts only the reminder schedule. (D-W151)
- **PLAN-FR-04**: Export calendar sits in the "Planned" view's header. It confirms the site, the time zone and the windows of every upcoming night that has a plan, not only the chosen night. The confirmed export is saved as an .ics file through the native save dialog, a one-time snapshot. (D-W151)
- **PLAN-FR-05**: Suitability is astronomical only: no weather, equipment, or processing-readiness claims, and no provider account or authorization.
- **PLAN-FR-06**: Notifications require explicit criteria and lead time plus the default site, all named before activation. The lead time is typed as a number with a unit (minutes, hours or days) or picked from presets. The default lead time is a user setting in Settings, 12 hours until the user changes it, and a new reminder starts from it. Every preset, the setting and any typed value are longer than 30 minutes. Each delivered reminder's target/site/window identity is recorded durably. Resume and restart recompute upcoming windows and suppress repeats of recorded identities (D07). At start-up, a window that ended while PlateVault was closed is recorded in Activity as "Missed while PlateVault was closed" and notifies nothing. Every window whose lead time has begun and that has not ended, including a window that has started, is gathered into one notice. The notice names at most 3 Targets, then "{n} more", and opens Targets for tonight. Every identity it covers is recorded as delivered, and normal delivery resumes after it. App-closed delivery needs an installed, tested scheduler; otherwise that capability is explicitly unavailable. (D-W88)
- **PLAN-FR-07**: Permission denial remains visible and offers Settings and Retry. No scheduler acknowledgment is represented as actual notification delivery.
- **PLAN-FR-08**: Rust computes astronomical planning windows, Targets list values, Fit and Tonight through qualified shared skymath contracts. The frontend presents them and their controls without reimplementing scientific calculations. (D-W18, D-W23, D-W39)
- **PLAN-FR-09**: Planning is keyed by Target. A Target can be added to a night's plan, given reminders and exported without belonging to any Project. A Project owns no windows. Its page shows the windows of its own subjects, from the same Target planning at the active planning site, and offers "Open in Planner". (D-W16, D-W151)
- **PLAN-FR-10**: "Open in Planner" opens the Targets page in the Project's context. The list is limited to the Project's subjects and the rig selector is set to "this Project's rigs". The Project context is shown and can be cleared, which returns the list to My targets. (D-W16, D-W37)
- **PLAN-FR-11**: Tonight supplies Home's Tonight section for the default site. It holds:
  - every unfinished goal of an open Project, graded good, marginal or poor for tonight for its channel under the Moon-avoidance curve (PLAN-FR-02), with the best window's start, end and peak altitude;
  - the Moon's illumination, phase, rise and set;
  - tonight's darkness window.

  Each value names its site and time zone. When no goal suits tonight, Tonight gives the date of the next good night. Provisional: a panel group's goals are graded from the subject's window, like any other goal. The same computation tells Home whether a subject has a window tonight. The user changes the site on Targets. Home has no site control. (D-W35, D-W39, D-W88, D-W89, D-W95)

  Tonight and the calendar (PLAN-FR-12) grade under Home's planning criteria, which take the form PLAN-FR-02 defines. These criteria have no defaults, and the setup wizard sets them (LIB-FR-01). Before the wizard saves them, Tonight and the calendar return no window, grade or suited-goal count. (D-W170)
- **PLAN-FR-12**: The calendar supplies Home's calendar for the default site: five weeks of nights, starting with the week of the request. Each night has its Moon phase, its hours of darkness, the number of unfinished goals it suits and the number of Targets in its plan. A card opens on hover or focus with the night's dark window and the Moon's illumination, moonrise and moonset. The card also lists the goals the night suits, best first, the goals the Moon rules out, and the Targets in its plan. Choosing a night opens Targets set to that night (PLAN-TGT-FR-16). (D-W88, D-W89, D-W151)

#### Targets list

- **PLAN-TGT-FR-01**: The Targets page shows either "My targets" (the default) or "Browse catalogues". My targets lists the favourites, every subject of an open Project, and every Target with at least one session. An open-Project subject carries a badge naming its Project. Favourite adds or removes the favourite (PLAN-TGT-FR-17); an open-Project subject stays listed with its badge either way. (D-W17, D-W60, D-W142; owner's answer, 2026-10-19, astro-plan-rzbzu.1)
- **PLAN-TGT-FR-02**: Browse catalogues lists rows only once at least one bundled catalogue (Messier, NGC, IC, Sharpless, LBN, LDN, Caldwell, Barnard) or a preset is chosen. With neither chosen, it lists no rows and asks for a catalogue or a preset. (D-W17)
- **PLAN-TGT-FR-03**: Search covers My targets, the bundled catalogues and SIMBAD. It ignores case and whitespace, so "M31", "M 31" and "m31" match the same Target. It searches every row, not only rows already shown, and each result names its source. Clicking a result not in My targets adds it as a favourite (PLAN-TGT-FR-17): the Target is written into the library and My targets, and the search stays open (D-W17). A Target with no session and no open Project is in My targets only as a favourite (PLAN-TGT-FR-01). A failed add shows the error with Retry. Clicking a result already in My targets opens that Target. Result rows carry no Add button, and the row's menu keeps the other actions (D-W152, D-W164). Searching alone writes nothing. When SIMBAD cannot be reached, the results say SIMBAD was not searched. (D-W17, D-W142, D-W152, D-W164)
- **PLAN-TGT-FR-04**: The table has these columns, with values for the selected night (tonight by default, PLAN-TGT-FR-16) at the active planning site under the planning criteria:
  - Favourite: a star on each favourite (PLAN-TGT-FR-17).
  - Designation and Type.
  - Altitude: a sparkline of the Target's altitude across the night, with the dark window shaded and its best window marked. Its tooltip states the maximum altitude and its time (PLAN-TGT-FR-18).
  - Max alt: peak altitude tonight.
  - Lunar: angular separation from the Moon tonight.
  - Img time: hours tonight that meet the planning criteria, such as 2h10m.
  - Filters: the band strip (PLAN-TGT-FR-06).
  - Opposition: next opposition date.
  - Sessions: count of linked sessions, "-" when none.
  - Captured: compact integration per channel (PLAN-TGT-FR-08).

  Every column sorts ascending or descending. Unknown values sort last, and the default sort is Designation ascending. A Target without catalogued coordinates shows "-" with the reason. (D-W18, D-W142)
- **PLAN-TGT-FR-05**: An Img time of zero shows why: altitude, Moon or darkness. Img time for a Target equals the total of its Plan area windows for tonight under the same site and criteria. (D-W18)
- **PLAN-TGT-FR-06**: The Filters strip shows bands L, R, G, B, Ha, SII and OIII, each graded good, marginal or poor for the night under its Moon-avoidance curve (PLAN-FR-02), with a recommendation label. A poor band uses the danger tone and a marginal band the warning tone. With a rig selected it shows only the bands the rig's filters pass (PLAN-EQ-FR-03); with several rigs, such as "this Project's rigs", it shows the union of their bands. With no rig selected it shows all seven. (D-W18, D-W23, D-W31, D-W62, D-W88)
- **PLAN-TGT-FR-07**: Moon illumination and phase appear once, in the toolbar, for tonight at the active planning site. No row repeats them. (D-W18)
- **PLAN-TGT-FR-08**: Captured shows, per channel, the integration of every session whose confirmed Target is this Target, whatever its quality. Trashed sessions and frames count toward neither Captured nor Sessions. (D-W18, D-W43)
- **PLAN-TGT-FR-09**: The built-in presets are Best tonight (broadband), Narrowband (Moon up), Emission nebulae Ha, Galaxies dark sky and Planetary nebulae OIII. Mosaic candidates and Fits nicely join them under PLAN-TGT-FR-12. The app offers no "Avoid tonight" preset. Each preset's definition is shown with it:
  - Best tonight (broadband): Img time above zero with a broadband band viable, sorted by Img time descending.
  - Narrowband (Moon up): Img time above zero with Ha, SII or OIII viable while the Moon is up.
  - Emission nebulae Ha: emission nebulae with Ha viable.
  - Galaxies dark sky: galaxies with Img time above zero while the Moon is below the horizon.
  - Planetary nebulae OIII: planetary nebulae with OIII viable.

  (D-W19)
- **PLAN-TGT-FR-10**: The user can save the current Show mode, catalogues, preset, Favourite filter, Fit filter and sort as a named preset, and rename or delete saved presets. Saved presets persist across restarts and sit in a Custom presets dropdown after the built-ins. Built-in presets cannot be edited or deleted. A saved preset that needs a rig or a narrowband filter follows the same availability rules as a built-in one. (D-W19, D-W88, D-W142)
- **PLAN-TGT-FR-11**: The toolbar's rig selector offers:
  - no rig, the default;
  - each rig from Settings > Equipment;
  - "this Project's rigs", in a Project's context.

  With a rig selected, the Fit column appears. Fit compares the Target's catalogued angular size with the rig's field of view. Coverage is the Target's major axis as a share of the field's shorter side. Fit reads "fits" when the Target fits in one field with coverage of at least 25%, "N panels" when it needs a grid of N fields, and "tiny" below 25%. With two or more rigs, Fit shows one value per rig, labeled with the rig name. A Target or rig without the size or field of view shows "-" with the reason. (D-W23, D-W37, D-W61, D-W62)
- **PLAN-TGT-FR-12**: Mosaic candidates (2 or more panels) and Fits nicely (coverage of 25% to 90%) are offered only with a rig selected. With two or more rigs, a Target matches when it matches on any of them. (D-W23, D-W37, D-W62)
- **PLAN-TGT-FR-13**: Narrowband (Moon up), Emission nebulae Ha and Planetary nebulae OIII are hidden when a rig is selected and no filter on it passes Ha, SII or OIII. (D-W23, D-W31)
- **PLAN-TGT-FR-14**: Selecting a row opens that Target's detail on the Targets page, with its Plan area (PLAN-FR-02). (D-W16, D-W151)
- **PLAN-TGT-FR-15**: **Suitable filters**, which replaces "Good tonight for", is a toolbar filter that takes one or more bands. A Target qualifies when any chosen band is good or marginal for it on the selected night, and the list sorts by the longest clear time among the chosen bands, descending. (D-W88)
- **PLAN-TGT-FR-16**: A night picker in the Targets toolbar sets the planning night, tonight by default, with previous week, next week and Today, which returns to tonight. Every value this section gives "for tonight" is given for the selected night. Opening Targets from a night on Home's calendar sets that night. (D-W88)
- **PLAN-TGT-FR-17**: Every label for a favourite says Favourite; no label says Star or Unstar. Every Targets table has a Favourite column, which shows a star on each favourite, and a Favourite filter: All, Yes or No. The URL keeps the filter as `?fav=`, and so does a saved preset (PLAN-TGT-FR-10). The row's Favourite action and the Favourite toggle beside the Target page's title (LIB-FR-08) add or remove the favourite. A refused write shows its alert on a row under the page header, so the toggle stays where the pointer is, and the favourite stays as it was. In Browse catalogues and in search results, a My targets column shows a check on each Target in My targets, so the star means only Favourite. Favourite leaves the rest of My targets membership unchanged (PLAN-TGT-FR-01). (D-W142)
- **PLAN-TGT-FR-18**: The Targets page has two views. All holds My targets, Browse catalogues, the filters and the presets. The "Planned" view holds the chosen night's plan as a schedule in order, with each Target's windows. Each night has its own plan: Add to plan adds the row's Target to the chosen night, and Remove from plan removes it. Both are row actions. The "Planned" view's header holds Enable notifications and Export calendar (PLAN-FR-03, PLAN-FR-04), and that view has no Favourite filter. Both views show the Altitude column of PLAN-TGT-FR-04, and the page has no wide altitude timeline. (D-W151)

#### Equipment: cameras, telescopes, filters and rigs

- **PLAN-EQ-FR-01**: Settings > Equipment has a section each for cameras, telescopes, reducers, filters and rigs. Its header has one Add equipment menu, with Camera…, Telescope…, Reducer…, Filter… and Rig…, in place of an Add button per section. An empty section keeps its own Add… in its empty state (D-W147). A reducer is its own record, with a name and a factor (D-W155). A filter is its own record, with a name, the FITS FILTER values it matches, and the bands it passes (one or more of L, R, G, B, Ha, SII, OIII). A rig selects one camera, one telescope, at most one reducer and any number of filters, with the same form for mono and OSC cameras. Each record's properties are edited only on that record, with Edit…. Each camera, telescope, reducer, filter and rig shows what uses it as a Used by popover that lists every user and links to it. (D-W31, D-W76, D-W87, D-W147, D-W155)
- **PLAN-EQ-FR-02**: Mono or OSC comes from the rig's camera, not from its filters. An OSC rig captures R, G and B without a filter; on any rig, each selected filter adds the bands it passes. (D-W31, D-W87)
- **PLAN-EQ-FR-03**: A rig's filters drive the Targets Filters strip (PLAN-TGT-FR-06) and the visibility of the narrowband presets (PLAN-TGT-FR-13). The selected rig's field of view drives Fit (PLAN-TGT-FR-11). Filters never filter Goal templates. (D-W30, D-W31, D-W87)
- **PLAN-EQ-FR-04**: When a session's FILTER header value matches no filter on its confirmed rig, the session shows the filter as unknown and offers "Add {value} to {rig}" in the session. Settings > Equipment lists the unknown values seen per rig. Adding asks for the bands the filter passes, creates a filter record that matches the value and selects it in the rig; header bytes and observed evidence stay unchanged. When an existing filter record matches the value, the prompt also offers that record, as Settings > Unknown filters does (D-W132; owner's answer, 2026-10-20). Declining leaves the value unknown and the prompt available. (D-W31, D-W87; owner's answer, 2026-10-19, astro-plan-rzbzu.1)
- **PLAN-EQ-FR-05**: A rig's field of view comes from its camera's sensor size and pixel size and its effective focal length. The effective focal length is the telescope's focal length, times the factor of the rig's reducer when it selects one. Framing and coverage matching use the same effective focal length (PRJ-FR-31). When any of these values is unknown, the field of view is unknown and Fit says so. (D-W23, D-W87, D-W155)
- **PLAN-EQ-FR-06**: A failed save of a rig or an equipment record stays visibly unsaved with Retry, and the last saved record stays in effect. (D-W31, D-W87)
- **PLAN-EQ-FR-07**: Editing a rig creates a new rig version that starts on a date, defaulting to today and editable by the user, and the rig lists its versions with their start dates. Each session records the version it was captured with (LIB-FR-26); if it was captured before the rig's first version, it records that first version. Versions never invalidate anything retroactively: a new version never changes a session's recorded version, its pinned calibration or its group. Provisional: a version dated before an existing session leaves that session's version unchanged as well. Provisional: renaming a rig changes no component, so it starts no new version. A version change affects flats only: flats of an earlier version never match a session of a later one (CAL-FR-19), darks and bias follow the camera (PLAN-EQ-FR-08), and a new version starts a new group only when the optics change (PRJ-FR-31). (D-W102, D-W104; owner's answer, 2026-10-19, astro-plan-rzbzu.1)
- **PLAN-EQ-FR-08**: Darks and bias match a session by its camera (CAL-FR-21). When the rigs hold only one camera of a model, darks and bias of that model match it automatically. With two or more cameras of one model, each needs an alias that no other camera uses, and Settings > Equipment refuses to save one without it. Import then links darks and bias of that model to one of those cameras, and a camera the user confirms at import counts as the explicit match (LIB-FR-26). A camera can be set to "Don't use darks" or "Don't use bias": its sessions are then settled as No darks or No bias automatically, with no warning, and the user can override that per session (CAL-FR-22). (D-W104, D-W105)

### Owned interaction steps

- B3
- K
- Targets list: Show mode, search where clicking a result adds or opens it, columns, the Favourite filter, presets and rig selector (D-W17, D-W18, D-W19, D-W23, D-W37, D-W142, D-W152)
- The "Planned" view: a plan per night, reminders and the calendar export (D-W151)
- Settings > Equipment: the Add equipment menu, cameras, telescopes, reducers, filters and rigs, rig versions, camera aliases and defaults, and the unknown-filter prompt (D-W31, D-W87, D-W104, D-W147, D-W155)
- Tonight and calendar data for Home (D-W39, D-W89)

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

- **Rig version**: a dated version of a rig. Each session records the one it was captured with, and only flats depend on it. (D-W102, D-W104)
- **My targets**: the Targets the user has marked as a favourite, every subject of an open Project, shown with its Project badge, and every Target with at least one session. (D-W60, D-W125, D-W142)
- **Favourite**: a Target the user marks with Favourite. The star in the Favourite column means only this; a check in the My targets column shows membership. (D-W142)
- **Rig**: an optical train from Settings > Equipment that selects one camera, one telescope, at most one reducer and its filters; its field of view follows from them. Editing it creates a rig version. (D-W155)
- **Filter**: an Equipment record with a name, matched FITS FILTER values and passed bands, which rigs select. (D-W87)
- **Reducer**: an Equipment record with a name and a factor, which a rig may select. The factor scales the telescope's focal length. (D-W155)
- **Targets preset**: a named set of Targets list filters, either built in or saved by the user.
- **Tonight**: the default site's grades for tonight for every unfinished goal, with the Moon and the darkness window.

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
- A Project's subjects and rig list, which only find its suggestions (D-W94, D-W96), its goals (D-W29, D-W90, D-W96) and its Closed state (D-W97) are defined by the Project feature; this feature reads them.

## Decisions before feature approval

- Root decisions D07 and D18 define opt-in reminders, explicit site/criteria/lead time, repeat suppression, permission recovery, honest scheduler capability and shared scientific calculations. Scheduler delivery claims require real platform evidence.
- Root decision D19 has no PLAN consumer: no planning path consumes a recorded file, and calendar export writes computed windows.
- Workflow decisions D-W16, D-W17, D-W18, D-W19, D-W23, D-W31, D-W37, D-W60, D-W61, D-W62 and section 4 of D-W39 define Target-keyed planning, the Targets list, rig filters and Tonight. D-W30, D-W35, D-W43, D-W96 and D-W97 are read here where they constrain this feature's outputs.
- Workflow decision D-W87 (Round 9 user item astro-plan-ngm9g, 2026-10-12) supersedes D-W31's ownership: filters, cameras and telescopes are their own Equipment records, and a rig selects them. The rest of D-W31 still applies, and the unknown-filter prompt now adds a filter record to the rig.
- Workflow decision D-W88 (Round 9 C2 and C6, C8, user items, 2026-10-12 to 2026-10-13) sets one Moon-avoidance curve per filter for windows, Img time and grades, renames "Good tonight for" to Suitable filters with several bands, adds the night picker, moves saved presets into a Custom presets dropdown and makes the reminder lead time free entry with units, longer than 30 minutes. The owner's answers of 2026-10-14 let a Target qualify when any chosen band suits, sort by the longest clear time, set the default lead time to a user setting of 12 hours, and gather reminders missed while the app was closed into Activity and one start-up notice.
- Workflow decision D-W89 (Round 9 C8 and decision astro-plan-b66vy, 2026-10-13) supersedes section 4 of D-W39: Home's Tonight holds the unfinished goals graded for tonight, and PV-PLAN also supplies Home's five-week calendar.
- Workflow decisions D-W94, D-W95 and D-W104 (the F4 Project model, owner, 2026-10-14) replace runs with Projects, replace mosaic subjects and D-W63's mosaic centre with panel groups, and add rig versions, camera aliases and the per-camera "Don't use darks" and "Don't use bias" defaults (PLAN-EQ-FR-07, PLAN-EQ-FR-08). Provisional: a version dated before an existing session leaves it unchanged, a rename starts no rig version, and a panel group's goals are graded from the subject's window.
- The owner's answer, 2026-10-19 (astro-plan-rzbzu.1), settles PLAN-EQ-FR-07 (J15/G12): a session captured before the rig's first version records that first version; new versions default to today, editable.
- Workflow decisions D-W142 and D-W147 (Round 11, owner, 2026-10-23, astro-plan-qk9ri) replace ★ with Favourite (PLAN-TGT-FR-17). Favourite adds a column, a filter kept in the URL and in saved presets, and a toggle on the Target page. Settings > Equipment gets one Add equipment menu (PLAN-EQ-FR-01). The Favourite column sorts like the others, as in the harness's Targets table. The owner's answer of 2026-10-26 (D-W155) makes a reducer its own Equipment record with a factor, which a rig may select. The factor scales the telescope's focal length for field of view and matching (PLAN-EQ-FR-05).
- Workflow decision D-W151 (Round 5 P-PLAN2 and Round 6, user, 2026-10-10) merges Plan into the Targets page, with an All view and a "Planned" view. Each night has a plan, with Add to plan and Remove from plan. Reminders and the calendar export sit in the "Planned" view's header, and both views show an Altitude column.
- Workflow decision D-W152 (Round 6, user, 2026-10-10) replaces the inline Add to targets. Clicking a search result adds it to My targets, or opens it when it is already there (PLAN-TGT-FR-03).
- Workflow decision D-W160 (Round 9 C5, user, 2026-10-12) gives the site editor a map with a place search and Use my location. The coordinate fields stay the source of truth, with a "map unavailable" fallback (PLAN-FR-01).
