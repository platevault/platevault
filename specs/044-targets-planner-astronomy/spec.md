# Feature Specification: Targets Planner — Ephemeris & Observer-Location Engine (Track B)

**Feature Branch**: `044-targets-planner-astronomy`

**Created**: 2026-07-04

**Status**: Draft

**Input**: User description: "Give the Targets planner real, per-site, per-date observability. For each deep-sky target (and the Moon), compute where it is in the sky over a chosen night from a chosen observing site: altitude over time, when it transits, when it rises/sets, its best imaging date, and its angular separation from the Moon. Let the user keep several named observing sites, pick which one is active, choose how dark 'night' has to be, set the lowest usable altitude, and plan any date — not just tonight — so the planner table's max-altitude, altitude sparkline, visible-tonight, and imaging-time columns show real numbers instead of placeholders."

## Context & Motivation

The Targets planner table and the target detail view already expose columns and an altitude graph for observability — maximum altitude, an altitude sparkline over the night, a "visible tonight" flag, imaging time above a usable altitude, transit / best-date, and a filter recommendation — but those values are currently driven by placeholder logic. The usable-altitude cutoff is a hardcoded constant (`USABLE_ALT_DEG`), there is no real observing site behind the numbers, "tonight" is the only planning horizon, and the Moon-separation figure is not a real angular separation. The planner looks like a planning tool without yet being one.

This feature (Track B) provides the real **ephemeris and observer-location engine** behind those surfaces: given an observing site and a date, it computes the threshold-independent facts about each target's night (altitude samples, transit, rise, set, best imaging date, Moon separation over time) so the planner and target detail can show truthful, testable observability for the site and date the user actually cares about. It also introduces the user-facing model the engine needs: multiple named observing sites with a default and an active choice, a per-site definition of how dark "night" must be, and a configurable lowest-usable-altitude threshold that replaces the hardcoded constant.

### Track A / Track B boundary

The astronomy work for the planner is split into two independently specified tracks that share a common astronomy-math dependency:

- **Track B (this spec)** owns everything about **time × position**: per-target altitude over the night, transit / rise / set times, best imaging date, the night-darkness window, the observing-site model, the usable-altitude threshold, and **target-to-Moon angular separation at a given time**. Its outputs are threshold-independent facts about a (site, date).
- **Track A (separate spec)** owns **Moon phase and illumination guidance and filter recommendation** — how bright the Moon is on a night and what that implies for filter choice (the `FiltersRecommendation` the detail view consumes). Track A consumes the Moon position/separation that Track B produces but is not specified here.

Both tracks depend on a single shared astronomy-math capability. The internals of that shared capability (how positions and times are computed, whether by a ported algorithm or a third-party library) are a **plan / research concern** and are intentionally not specified in this document, which stays user- and workflow-focused per the constitution.

### Compute boundary (hybrid)

Observability has a threshold-independent part (where a target is, and when) and a threshold-dependent part (how that reads against *this user's* usable-altitude cutoff). To keep the usable-altitude slider instant, the engine computes and returns the **threshold-independent** facts for a (site, date) — the altitude samples across the night and the transit / rise / set times — while the **threshold-dependent** values (imaging time above the usable altitude, and the visible-tonight flag) are derived from those samples against the current threshold **without recomputing positions**. Where the derivation runs is a plan concern; the user-facing requirement is that changing the threshold updates the derived columns immediately.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Real tonight observability per target (Priority: P1)

An astrophotographer opens the Targets planner for their default observing site and sees, for each deep-sky target, real numbers for tonight: the maximum altitude the target reaches, an altitude sparkline across the night, whether it is worth imaging tonight, the imaging time it spends above the usable altitude, and when it transits. They drag the usable-altitude slider and the imaging-time and visible-tonight values update instantly.

**Why this priority**: This is the core value — turning the planner from placeholder columns into a real per-night observability view. It is the smallest slice that makes the planner trustworthy and is a viable MVP on its own (using the default site and tonight's date).

**Independent Test**: With a default observing site configured, load the planner and confirm each target's max altitude, altitude sparkline, transit time, visible-tonight flag, and imaging-time-above-threshold match an independent ephemeris for that site and tonight; then move the usable-altitude slider and confirm the imaging-time and visible-tonight columns change without re-fetching positions.

**Acceptance Scenarios**:

1. **Given** a default observing site and a target with known coordinates, **When** the planner loads for tonight, **Then** the target's maximum altitude, transit time, and altitude sparkline match an independent ephemeris to planning-grade accuracy.
2. **Given** the planner is showing tonight's observability, **When** the user changes the usable-altitude threshold, **Then** the imaging-time-above-threshold and visible-tonight values recompute immediately from the existing samples with no position recomputation.
3. **Given** a target that never rises above the usable altitude tonight from the active site, **When** the planner loads, **Then** the target is marked not visible tonight with zero imaging time, without error.

---

### User Story 2 - Plan an arbitrary future night (Priority: P2)

The user is deciding which night next month to image a target. They pick a future date in the planner and every observability column and the altitude graph update to that night, for the active site, so they can compare candidate nights.

**Why this priority**: Arbitrary-date planning is what makes the tool a *planner* rather than a *tonight dashboard*, but it builds directly on US1 and is not required for the first useful slice.

**Independent Test**: Change the planner's date to a specific future date and confirm the max altitude, transit, rise/set, and altitude sparkline for a target match an independent ephemeris for that date and the active site (not tonight's values).

**Acceptance Scenarios**:

1. **Given** the planner is set to the active site, **When** the user selects a future date, **Then** all observability values and the altitude graph reflect that date's night for that site.
2. **Given** a target with a computed best imaging date, **When** the user navigates to that date, **Then** the target transits near local midnight (anti-solar) as indicated.

---

### User Story 3 - Manage observing sites (Priority: P2)

The user keeps more than one observing location (a home site and a dark-sky site). They add, edit, and delete named sites, mark one as the default, and switch which site the planner is currently computing for. Observability across the whole planner follows the active site.

**Why this priority**: Multiple sites are essential for real users but a single default site is enough to deliver US1; full site management is the next increment.

**Independent Test**: Create two sites with different coordinates, set one active, verify the planner's numbers match that site; switch to the other and verify the numbers change to match the second site; delete a non-default site and confirm it is gone and the active/default selection remains valid.

**Acceptance Scenarios**:

1. **Given** no sites exist, **When** the user adds a site with a name, latitude, longitude, elevation, and timezone, **Then** it is persisted and can be marked default and made active.
2. **Given** two sites exist, **When** the user switches the active site, **Then** every observability value in the planner recomputes for the newly active site.
3. **Given** a site is marked default, **When** the user deletes a different (non-default) site, **Then** the default and active selections remain valid and the deleted site no longer appears.
4. **Given** the app extracted an observer location from imported session metadata, **When** no site exists yet, **Then** the app MAY offer to seed a first site from that location for the user to confirm.

---

### User Story 4 - Choose how dark "night" must be (Priority: P3)

The user sets, per site, whether the observable night is bounded by astronomical twilight (a fully dark sky) or nautical twilight (a looser bound), and the night window used for imaging-time and the altitude graph shading follows that choice.

**Why this priority**: A sensible default (astronomical twilight) works for most users; per-site override is a refinement that matters mainly for high-latitude or bright-target cases.

**Independent Test**: For a site and date, switch the twilight definition from astronomical to nautical and confirm the night window (and therefore imaging-time-above-threshold and the graph's night shading) widens accordingly.

**Acceptance Scenarios**:

1. **Given** a site set to astronomical twilight, **When** the planner computes the night window, **Then** the window runs between the sun reaching −18° in the evening and rising back to −18° in the morning.
2. **Given** the user switches that site to nautical twilight, **When** the planner recomputes, **Then** the night window uses the sun at −12° and the imaging-time figures update to the wider window.

---

### User Story 5 - Real target-to-Moon separation (Priority: P2)

For each target, the user sees the real angular separation between the target and the Moon over the planned night (for the active site and date), so they can judge how much the Moon will interfere.

**Why this priority**: Moon proximity is a primary go/no-go factor for a night, and it is a distinct, independently valuable slice from raw altitude.

**Independent Test**: For a target and the Moon on a given night and site, confirm the reported angular separation matches an independent ephemeris to planning-grade accuracy, and that a target near the Moon reports a small separation while a target on the opposite side of the sky reports a large one.

**Acceptance Scenarios**:

1. **Given** a target and a date/site, **When** the planner computes Moon separation, **Then** the reported separation matches an independent ephemeris to planning-grade accuracy.
2. **Given** the Moon is below the horizon for the whole night, **When** separation is computed, **Then** the surface indicates the Moon is not up rather than reporting a misleading number.

---

### Edge Cases

- **No astronomical dark (high-latitude summer)**: At high latitudes in summer the sun never reaches −18° (or even −12°); the night window is empty. The engine MUST report that there is no dark window for that site/date rather than fabricating one, and imaging-time MUST be zero (or reflect the looser twilight if the user chose nautical and it applies).
- **Circumpolar targets**: A target that never sets from the active site has no rise/set time; the engine MUST represent transit and altitude samples normally and mark rise/set as not applicable rather than erroring.
- **Never-rises targets**: A target that never clears the horizon (or the usable altitude) from the active site MUST be marked not visible with zero imaging time, with no rise/set/transit failure.
- **Missing or no default site**: With no sites configured (or none marked default/active), the planner MUST degrade to a clear "choose or add an observing site" state rather than showing wrong or blank numbers.
- **DST / timezone boundaries on arbitrary dates**: When a planned night crosses a daylight-saving transition (or the site's timezone rules differ from the app host's), rise/set/transit and the night window MUST be reported in the site's local time correctly across the transition.
- **Moon below the horizon**: When the Moon is not up during (part of) the night, separation for that interval MUST be presented as "Moon not up" rather than a raw angle that implies interference.
- **Target coordinates missing**: A target without resolved coordinates cannot be placed; the planner MUST show it as un-plannable (needs coordinates) rather than computing against a default.

## Requirements *(mandatory)*

### Functional Requirements

**Tonight observability (US1)**

- **FR-001**: For a given observing site and date, the system MUST compute, for each deep-sky target with known coordinates, a set of altitude samples across the night sufficient to render an altitude curve and to derive maximum altitude.
- **FR-002**: The system MUST compute each target's transit time (moment of maximum altitude) for the site and date.
- **FR-003**: The system MUST compute each target's rise and set times for the site and date where they exist, and MUST represent their absence for circumpolar and never-rising targets without error.
- **FR-004**: The system MUST expose a configurable **usable-altitude threshold** (the lowest altitude at which imaging is considered worthwhile), defaulting to 30°, replacing the current hardcoded constant. The threshold is a user setting.
- **FR-005**: The system MUST derive, for each target, the imaging time spent above the usable-altitude threshold during the night's dark window, and a "visible tonight" indication, from the computed altitude samples and the night window.
- **FR-006**: The threshold-dependent values (imaging time above threshold, visible-tonight) MUST be derived from the already-computed threshold-independent samples so that changing the usable-altitude threshold updates them immediately, without recomputing target positions.
- **FR-007**: The altitude samples and derived observability MUST be presented in the planner table and the target detail altitude graph (maximum altitude, altitude sparkline/curve, visible-tonight, imaging time, transit), replacing placeholder values.

**Arbitrary-date planning (US2)**

- **FR-008**: The planner MUST let the user choose the planning date (not only "tonight"), and all observability outputs MUST be computed for that chosen date and the active site.
- **FR-009**: The system MUST compute, for each target, a **best imaging date** defined as the date on which the target transits at local midnight (anti-solar / opposition-to-the-sun in the imaging sense), and MUST present it as the target's best-imaging date. This is the best-imaging date, not planetary opposition.
- **FR-010**: Observability computation MUST be parameterized by (site, date); the same target MUST yield different, date-appropriate results as the planning date changes.

**Observing sites (US3)**

- **FR-011**: The system MUST let the user create, edit, and delete named observing sites, each with a name, latitude, longitude, elevation, and timezone, persisted alongside the existing application settings.
- **FR-012**: The system MUST let the user mark exactly one site as the default and choose which site is currently active for planning; all planner observability MUST follow the active site.
- **FR-013**: The system MUST keep the default and active selections valid across site edits and deletions (e.g. deleting the active or default site MUST leave a valid selection or a clear "no site" state).
- **FR-014**: The system MAY offer to seed a first observing site from an observer location extracted from imported session metadata, with the user confirming before it is saved (never silently adopted).

**Night-darkness definition (US4)**

- **FR-015**: The system MUST bound the observable night by a twilight definition, defaulting to astronomical twilight (sun 18° below the horizon), and MUST let the user switch it to nautical twilight (sun 12° below the horizon) per site.
- **FR-016**: The chosen twilight definition MUST determine the night window used for imaging-time-above-threshold and for the altitude graph's night shading.
- **FR-017**: When no qualifying dark window exists for a site and date under the chosen twilight definition (e.g. high-latitude summer), the system MUST report the absence of a dark window rather than fabricating one, and imaging-time MUST reflect that absence.

**Target-to-Moon separation (US5)**

- **FR-018**: The system MUST compute the angular separation between each target and the Moon for the active site and planned date, over the night, treating the Moon as the single moving body in scope.
- **FR-019**: When the Moon is below the horizon during (part of) the night, the system MUST present that interval as "Moon not up" rather than reporting a separation that implies interference.

**Accuracy & scope discipline (cross-cutting)**

- **FR-020**: All computed positions and times MUST be **planning-grade**: approximately 1 arcminute in altitude and approximately ±1 minute for rise, set, and transit. The engine MUST NOT claim or attempt pointing-grade precision.
- **FR-021**: The engine MUST operate fully locally (no online ephemeris service or network dependency) for all in-scope computations, consistent with local-first custody.
- **FR-022**: Target scope MUST be limited to deep-sky (fixed RA/Dec) targets and the Moon; the engine MUST NOT compute planets, comets, asteroids, or other moving bodies.

### Key Entities *(include if feature involves data)*

- **Observing site**: A named location the user observes from — name, latitude, longitude, elevation, timezone, and its chosen twilight definition. One site is the default; one is active for planning. New persisted entity extending the existing settings store.
- **Usable-altitude threshold**: A user setting (default 30°) for the lowest altitude at which a target is considered worth imaging; drives the threshold-dependent observability derivation. Replaces the hardcoded `USABLE_ALT_DEG` constant.
- **Twilight definition**: A per-site choice of how dark the sky must be (astronomical −18° default, or nautical −12°) that bounds the observable night window.
- **Night observability (per target, per site, per date)**: The threshold-independent result set — altitude samples across the night, transit time, rise time, set time, best imaging date, and Moon separation over time — from which threshold-dependent values are derived.
- **Derived observability (per target)**: The threshold-dependent read of the night observability against the current usable-altitude threshold — maximum altitude, visible-tonight, imaging time above threshold.
- **Planning context**: The (active site, planning date, twilight definition, usable-altitude threshold) under which the planner is currently computing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a configured site and date, each in-scope target's maximum altitude and transit time match an independent reference ephemeris to within planning-grade accuracy (≈1 arcmin altitude, ≈±1 min transit) in 100% of sampled cases.
- **SC-002**: Rise and set times for targets that have them match an independent reference to within ≈±1 minute; circumpolar and never-rising targets are correctly reported as having none, with zero errors.
- **SC-003**: Changing the usable-altitude threshold updates the imaging-time and visible-tonight columns for all targets without any recomputation of positions and without a perceptible delay (updates reflect immediately from existing samples).
- **SC-004**: Selecting a different planning date changes every target's observability to that date's values (distinct from tonight's) in 100% of cases, matching the reference ephemeris for the chosen date.
- **SC-005**: Switching the active observing site recomputes all planner observability for the new site's coordinates in 100% of cases; the numbers differ appropriately between two sites with materially different latitude/longitude.
- **SC-006**: A user can create, edit, delete, set-default, and activate observing sites, and the default/active selection remains valid after any such change in 100% of operations.
- **SC-007**: Switching a site between astronomical and nautical twilight changes the night window and the resulting imaging-time figures consistently with the chosen sun-depression angle.
- **SC-008**: At a high-latitude site/date with no dark window under the chosen twilight, the planner reports no dark window and zero imaging time rather than fabricating a window, with no error.
- **SC-009**: Target-to-Moon angular separation matches an independent reference ephemeris to planning-grade accuracy; a target adjacent to the Moon reads a small separation and one across the sky reads a large one.
- **SC-010**: With no observing site configured, the planner shows a clear prompt to choose or add a site rather than blank or incorrect observability values, in 100% of cases.
- **SC-011**: Rise/set/transit and the night window are reported correctly in the site's local time across a daylight-saving transition on an arbitrary planned date.

## Out of Scope / Non-Goals

- **Planets, comets, asteroids, and other moving bodies** — only deep-sky fixed targets and the Moon are in scope (FR-022).
- **Planetary opposition** — "best date" is best-imaging date (transit at local midnight / anti-solar), not planetary opposition (FR-009).
- **Pointing-grade astrometry** — no precession, nutation, aberration, or proper-motion correction; pointing is the mount's / PixInsight's job, respecting the PixInsight boundary (FR-020).
- **Online ephemeris / catalog services** — all computation is local (FR-021).
- **Moon phase / illumination and filter recommendation** — owned by Track A, a separate spec; this spec provides only Moon position and separation.
- **The shared astronomy-math implementation choice** (ported algorithm vs. library) — a plan / research concern, not specified here.
- **Target coordinate resolution / catalog lookup** — supplied by the existing target-identity/resolution features; this engine consumes coordinates, it does not resolve them.

## Assumptions

- **Observing site is a new persisted entity**: The existing settings store gains a named-site collection (name, lat, lon, elevation, timezone, twilight definition) with a default and an active selection; the existing per-session `ObserverLocation` (tz, lat, lon) remains the acquisition-time record and MAY seed a first site.
- **Threshold-independent / threshold-dependent split**: The engine returns altitude samples and rise/set/transit (threshold-independent) for a (site, date); imaging-time and visible-tonight are derived against the current usable-altitude threshold so the slider stays instant. Where the derivation executes is a plan concern.
- **Planning-grade, not pointing-grade**: ≈1 arcmin altitude and ≈±1 min times are sufficient for planning; the engine deliberately omits pointing-grade corrections (constitution III — the PixInsight boundary).
- **Local-first**: All computation is offline; no network ephemeris dependency (constitution I).
- **Shared math with Track A**: Both tracks depend on one shared astronomy-math capability; Track A consumes the Moon position/separation this track computes. The shared capability's internals are specified at plan time.
- **Target coordinates already available**: Targets carry resolved coordinates from existing target-identity features; targets without coordinates are shown as un-plannable rather than computed against a default.
- **Existing planner surfaces consume the outputs**: The planner table columns and the target-detail altitude graph already exist and are wired to placeholder logic; this feature replaces the placeholder inputs with real engine outputs rather than redesigning those surfaces.

## Dependencies

- Existing settings/configuration store (spec 018) — extended with the observing-site collection, default/active selection, twilight definition, and usable-altitude threshold.
- Existing acquisition-session `ObserverLocation` model — as an optional seed for a first site.
- Existing target-identity / coordinate resolution — supplies target RA/Dec.
- Existing planner table and target-detail altitude graph surfaces — the consumers of the engine's outputs.
- A shared astronomy-math capability co-developed with Track A (Moon phase / filter guidance) — internals specified at plan time.
