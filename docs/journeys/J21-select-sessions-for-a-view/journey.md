---
id: J21
title: Select sessions for a View by metadata and sky coverage
version: 1
status: draft
last_reviewed: 2026-10-03
actors: [primary-user]
surfaces: [view-review, sessions]
interfaces: [desktop-ui, desktop-ui-macos]
trace: [063-clean-rebuild-contract, 066-view-selection, D01, D02, D08, specs/063-clean-rebuild-contract/decisions.md, specs/066-view-selection/spec.md, docs/reviews/2026-10-03-product-flow-and-journeys.md#journey-c-select-sessions-for-a-view]
---

## Goal

In one persistent workspace the user names a View, accepts geometry-based session
suggestions, adds sessions that lack qualifying geometry by hand, browses with
filters and sorting without losing the selection, deals explicitly with an
offline source, and saves the draft. Done means: saved View
`NGC7000 HOO - Siril` holds exactly the five worked-example sessions, each with
a visible selection reason, with their available frames included (214 lights /
17h 50m) and no unresolved member; the offline 12 Sep session is not part of the
selection.

## Preconditions

- P1: J20 completed through S8; the workspace for Project `NGC 7000 HOO` is open.
- P2: No measurement has run for any fixture frame.

## Steps

### S1 — Orient in the workspace {#S1}

- **Do:** Move among Sessions, Frames, Preview, and Calibration, and toggle **Sky coverage** on and off.
- **Expect:** One workspace holds the session table, selection summary, frame-review area, and calibration area. All areas share one selection; **Sky coverage** shows and hides a linked spatial view.
- **Expect (negative):** No Next/Back wizard gates movement between areas.
- **Trace:** flow C1 · VSEL-FR-02

### S2 — Name the View {#S2}

- **Do:** Enter `NGC7000 HOO - Siril`, keep the Project association, and leave the application profile unset.
- **Expect:** The workspace shows the name and Project `NGC 7000 HOO`; the profile reads not chosen and selection remains available.
- **Trace:** flow C1 · VSEL-FR-02

### S3 — Inspect geometric suggestions {#S3}

- **Do:** Read the session table's suggestions.
- **Expect:** 26 Sep, 28 Sep, and 30 Sep are preselected with reason geometry suggestion, each having confirmed framing, confirmed Project equipment, pointing, orientation, and footprint overlap; 26 Sep is preselected despite its `Cygnus field` label. Each candidate shows session, date/time, channel, exposure, camera/optical train, frame count, integration, availability, distance, and footprint evidence where available. The other-camera session and the 12 Sep session (observed, not confirmed, equipment; Offline) are listed and unselected.
- **Expect (negative):** Preselection does not merge sessions, rewrite headers, or change Target assignments. Angular separation alone makes no session eligible.
- **Trace:** flow C2 · VSEL-FR-03 · VSEL-AC-01 · D01

### S4 — Recover or bypass missing geometry {#S4}

- **Do:** Open the geometry evidence of 28 Sep, 18 Sep, and 24 Sep. Then check 18 Sep and 24 Sep.
- **Expect:** 28 Sep shows **FOV from confirmed equipment** with its inputs (image dimensions, effective focal length, pixel scale, binning). 18 Sep is listed by radius as pointing-only and shows no footprint. 24 Sep reads **Position unknown** and has no distance value. After checking, 18 Sep and 24 Sep are selected with reason manual inclusion; five sessions are selected.
- **Expect (negative):** Neither 18 Sep nor 24 Sep was preselected. 24 Sep never shows a distance of 0 or a footprint derived from its Target or an OBJECT label.
- **Trace:** flow C3, cross-flow "Missing geometry", "Missing OBJECT" · VSEL-FR-04 · VSEL-AC-02 · D01

### S5 — Filter and sort {#S5}

- **Do:** Open **Filters** and set channel Ha. Then replace it with **Missing OBJECT**, then with quality state Unreviewed. Open the expanded metadata controls. Sort by sky distance.
- **Expect:** With Ha, an active filter chip and a matching-session count appear, and **Selected outside current filters: 3** shows. **Missing OBJECT** matches only 24 Sep. Unreviewed shows rows with per-state frame counts; measurement columns read **Not measured**. Expanded controls offer Target, camera, gain, offset, binning, and temperature. Sky-distance sort orders sessions with evidence; 24 Sep has no distance value.
- **Expect (negative):** No filter changes the selected session IDs or session definitions. No filter starts measurement or marks a frame Usable.
- **Trace:** flow C4, cross-flow "Selection hidden by filters" · VSEL-FR-05, VSEL-FR-06 · VSEL-AC-03 · PIX-AC-06

### S6 — Review the selection {#S6}

- **Do:** Clear filters and click **Show selected**.
- **Expect:** Exactly five sessions are listed with their reasons. The summary reports included frames and integration by channel from each session's available frames: Ha 111 / 9h 15m, OIII 103 / 8h 35m, total 214 / 17h 50m, with no unresolved member. Unreviewed and library-Unusable counts stay visible.
- **Expect (negative):** Including a session's frames applies no quality action; every frame still reads Unreviewed.
- **Trace:** flow C5 · VSEL-FR-06, VSEL-FR-08 · D02

### S7 — Keep the selection while browsing {#S7}

- **Do:** Sort by two different columns, change page if the table pages, toggle **Sky coverage**, click a footprint, then click a row.
- **Expect:** The selection stays five sessions throughout. Clicking a footprint highlights its session row; clicking a row highlights its footprint.
- **Trace:** flow C5 · VSEL-FR-06, VSEL-FR-07 · VSEL-AC-03

### S8 — Handle an offline source {#S8}

- **Do:** Check the 12 Sep Cold-1 session, read its state, then remove it from the draft explicitly.
- **Expect:** While selected it reads Offline, its last-observed counts are marked unverified, and its frames are named as unresolved members in the summary. After removal the selection is five sessions, the summary again reads 214 / 17h 50m with no unresolved member, and Sessions still lists 12 Sep as Offline.
- **Expect (negative):** The offline session is never dropped silently or counted as verified.
- **Trace:** flow C6, cross-flow "Location offline" · VSEL-FR-09 · D02

### S9 — Save, then start and clear a standalone View {#S9}

- **Do:** Click **Save View**. From Sessions, select 18 Sep and 28 Sep and click **Create View**. In that new workspace click **Clear selection**. Reopen `NGC7000 HOO - Siril`.
- **Expect:** After **Save View** the View reads saved as a committed revision. The new workspace has no Project association and starts with the two sessions. **Clear selection** leaves it with zero selected. `NGC7000 HOO - Siril` still holds its five sessions.
- **Expect (negative):** Clearing one draft does not change another View or the library. The main View never reads saved before its write succeeds.
- **Trace:** flow B4, C5 · VSEL-FR-01, VSEL-FR-06, VSEL-FR-13 · D08

## Success criteria

- SC1: The S3 preselected set is exactly {26 Sep, 28 Sep, 30 Sep}; the other-camera and 12 Sep sessions are listed and unselected.
- SC2: 18 Sep and 24 Sep enter only through manual checks at S4; 24 Sep shows no numeric distance at S4 or S5.
- SC3: The selected set stays exactly five sessions through S5–S7; under the Ha filter the hidden-selected count is 3.
- SC4: S5 starts 0 measurement jobs and changes 0 quality states.
- SC5: The summary reads 214 / 17h 50m at S6 and after S8; 12 Sep is named unresolved while selected and leaves only by explicit removal (S8).
- SC6: After S9 the main View is a saved revision with five sessions.

## Known gaps

- G1: Not validated — the rebuilt application does not exist. Product behavior follows the specs and the defaults that the authorized autonomous run set in decisions D01, D02, and D08; no implementation has been validated against them.
- G2: Unresolved implementation qualification — the configured overlap criterion (D01) has no fixed value; the S3/S4 fixture geometry must overlap or miss NGC 7000 by an unambiguous margin once the value is chosen. Blocks readiness.
- G3: Out of scope for this journey — D08 stale-overwrite refusal with reload/review needs a second concurrent writer and is not exercised. Blocks readiness until covered by a step or a journey.

## Delta log

- No entries (initial draft, version 1).
