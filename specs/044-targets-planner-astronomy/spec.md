# Feature Specification: Targets Planner — Track A (Moon-Aware, Filter-Aware Planning)

**Feature Branch**: `044-targets-planner-track-a`

**Created**: 2026-07-04

**Status**: Draft (Track A; supersedes the 2026 placeholder version of this spec)

**Input**: User description: "Track A of the Targets Planner: moon-aware,
filter-aware target planning using existing target data and simple well-known
astronomy formulas. Track B (ephemeris/observer engine) is explicitly out of
scope and handled separately; Track A must not depend on it."

## Track Split (governing scope rule)

The original spec 044 placeholder covered the whole planner-astronomy surface.
That scope is now split:

- **Track A (THIS spec)** — everything computable from **date/time plus each
  target's catalogued sky coordinates (RA/Dec)** at *planning granularity*
  (whole-degree, whole-date precision). This covers Moon phase, Moon
  illumination, Moon sky position (geocentric), target↔Moon angular
  separation, moon-driven filter guidance, and opposition/best-season
  indication.
- **Track B (separate, research-gated effort — NOT this spec)** — everything
  requiring the **observer's location** (latitude/longitude/elevation/timezone
  precision): true altitude curves, max altitude tonight, imaging time above a
  threshold, visible-tonight determination, rise/set/transit times, moonrise
  and moonset, and observer-location capture itself.

**Boundary rule**: if a value cannot be computed without observer coordinates,
it belongs to Track B and stays a clearly-labeled placeholder in the planner
until Track B lands. Track A MUST NOT introduce any dependency on observer
location, and nothing in Track A blocks on Track B.

Planning-granularity tolerance is explicit and acceptable: the Moon's position
is evaluated geocentrically, which can differ from the observer's true
(topocentric) view by up to about 1 degree — irrelevant for deciding whether a
target is "near" or "far from" the Moon for filter selection.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tonight's Moon at a glance (Priority: P1)

An astrophotographer opens the Targets Planner while deciding what to image
tonight. The planner shows the real Moon situation for tonight: phase name
(e.g., "Waxing Gibbous"), illumination percentage, and whether the Moon is
waxing or waning. The imager immediately knows whether tonight is a
"broadband night" (dark, near new Moon) or a "narrowband night" (bright Moon).

**Why this priority**: every other moon-aware feature derives from the nightly
Moon state; it is independently valuable even before any per-target column
exists, and it retires the first piece of fake data in the planner.

**Independent Test**: open the planner on a known date and compare the shown
phase name and illumination percentage against a published lunar almanac for
that date; repeat for dates around new Moon, full Moon, and both quarters.

**Acceptance Scenarios**:

1. **Given** tonight is a night near full Moon, **When** the user opens the
   Planner, **Then** the moon summary shows "Full Moon" (or the correct
   neighboring phase name) and an illumination percentage within tolerance of
   published almanac values for that date.
2. **Given** tonight is near new Moon, **When** the user opens the Planner,
   **Then** the summary shows a low illumination percentage and a
   new-Moon-adjacent phase name.
3. **Given** the app stays open across local midnight into the same night,
   **When** the user looks at the summary, **Then** the values still describe
   the same observing night (no mid-night flip to "tomorrow").

---

### User Story 2 - Real lunar distance per target (Priority: P1)

While comparing candidate targets, the imager sees, for each target row in the
planner, the real angular separation between that target and tonight's Moon,
and can sort the table by it — putting the most Moon-safe targets on top.

**Why this priority**: lunar separation is the per-target half of the
moon-avoidance decision and the direct replacement for the most misleading
mocked column. It requires only target RA/Dec (already available on every
planner row) plus the nightly Moon position from Story 1.

**Independent Test**: on a known date, compare the displayed separation for
several well-known targets (e.g., M31, M42) against a planetarium reference;
verify sorting orders rows by the displayed values.

**Acceptance Scenarios**:

1. **Given** a target with known catalogued coordinates, **When** the planner
   renders its row, **Then** the lunar distance column shows the real
   target↔Moon separation for tonight, in whole degrees, within the documented
   planning tolerance of a reference value.
2. **Given** the user clicks the lunar distance column header, **When** the
   sort applies, **Then** rows order by separation (ascending/descending
   toggle), with ties broken deterministically.
3. **Given** a target whose coordinates are not yet known to the library,
   **When** its row renders, **Then** the lunar distance shows an explicit
   "unknown" placeholder (not a fabricated number) and sorts after all rows
   with known values.

---

### User Story 3 - Filter guidance from Moon conditions (Priority: P2)

For each target, the planner recommends which filter class is sensible tonight
— narrowband only (Ha/OIII/SII) when the Moon is bright and close, broadband
OK (L/R/G/B, plus narrowband) when the Moon is dim or far — and the imager can
filter the target list to only the targets where their intended filter class
works tonight. The user can see why a recommendation was made and can adjust
the brightness/separation thresholds that drive it.

**Why this priority**: this is the planner's headline decision-support value
("what can I shoot tonight with the Moon up?"), but it depends on Stories 1–2
landing first.

**Independent Test**: with a bright-Moon date, verify targets close to the
Moon show "narrowband only" and distant targets show "broadband OK"; change
the thresholds in Settings and verify recommendations update accordingly.

**Acceptance Scenarios**:

1. **Given** tonight's Moon illumination is above the "bright Moon" threshold
   and a target's lunar distance is below the "close to Moon" threshold,
   **When** the row renders, **Then** the filter guidance shows narrowband
   only (Ha/OIII/SII).
2. **Given** the Moon is below the brightness threshold OR the target is
   beyond the separation threshold, **When** the row renders, **Then** the
   guidance shows broadband OK (L/R/G/B and narrowband).
3. **Given** the user applies the planner's guidance filter set to
   "narrowband only", **When** the list refreshes, **Then** only targets with
   that recommendation remain visible.
4. **Given** the user inspects a row's guidance, **When** they hover or focus
   the guidance cell, **Then** an explanation states the inputs that produced
   it (tonight's illumination and this target's lunar distance versus the
   active thresholds).
5. **Given** the user changes the guidance thresholds in Settings, **When**
   they return to the planner, **Then** recommendations reflect the new
   thresholds, and a "reset to defaults" action restores the shipped values.
6. **Given** a target with unknown coordinates, **When** its row renders,
   **Then** the guidance shows an explicit "unknown" state rather than a
   recommendation.

---

### User Story 4 - Opposition / best-season indication (Priority: P3)

The imager sees, per target, when that target is next "in season" — the date
it culminates near local midnight (its opposition-like best-visibility
moment) — and can sort by it to find targets peaking soon. This replaces the
current empty "—" opposition column with real, date-level values.

**Why this priority**: valuable for seasonal planning but less
decision-critical night-to-night than the Moon columns; it is independent of
the Moon work and only needs target RA plus the Sun's seasonal position at
date-level precision.

**Independent Test**: verify well-known seasonal anchors (e.g., Orion-region
targets culminate near midnight in December, Sagittarius-region targets in
June/July) within the documented date tolerance, and that sorting orders rows
by soonest-next-opposition.

**Acceptance Scenarios**:

1. **Given** a target with known coordinates, **When** its row renders,
   **Then** the opposition column shows the next date (at date-level
   precision) the target culminates near local midnight, replacing the "—"
   stub.
2. **Given** the user sorts by opposition, **When** the sort applies, **Then**
   rows order by how soon that date arrives (targets at/near opposition now
   first), deterministically.
3. **Given** a target with unknown coordinates, **When** its row renders,
   **Then** the opposition column shows the explicit "unknown" placeholder and
   sorts last.

---

### Edge Cases

- Target exactly at a threshold value (illumination or separation equal to
  the configured boundary): guidance MUST be deterministic and documented
  (boundary values count as "bright"/"close").
- Targets missing coordinates (never resolved, or user-created without
  lookup): all Track A columns show an explicit unknown state, never invented
  numbers; unknowns group after known values under any sort.
- Night spanning local midnight: all Track A values for "tonight" refer to one
  observing night, not the calendar date, so nothing flips at 00:00 while the
  user is planning.
- Date/clock changes (system timezone change, DST transition, user returns
  the next day with the app still open): the planner presents the correct
  current observing night after refresh/reopen; a stale night is never mixed
  with a fresh one within one rendered view.
- Extreme dates far in the past/future: values stay plausible (no crashes or
  nonsense such as illumination outside 0–100% or separation outside 0–180°).
- Threshold settings set to extremes (e.g., "close" = 180°): guidance follows
  the configured rule literally; the settings surface constrains inputs to
  valid ranges so no invalid state is storable.

## Requirements *(mandatory)*

### Functional Requirements

**Nightly Moon state**

- **FR-001**: The system MUST compute, for the current observing night, the
  Moon's phase (including waxing/waning direction) and illumination fraction
  from date/time alone, using well-established published low-precision lunar
  formulas, with no dependency on observer location.
- **FR-002**: The planner MUST display a moon summary for tonight: phase name
  (standard eight-phase vocabulary), illumination percentage, and
  waxing/waning direction.
- **FR-003**: Illumination MUST be within ±3 percentage points, and the phase
  name correct or adjacent-boundary-correct, versus published almanac values
  for any date within at least the 2000–2050 range.
- **FR-004**: The system MUST compute the Moon's sky position for the night at
  planning granularity (geocentric; documented tolerance approximately 1°
  versus a topocentric view) for use in per-target separation.
- **FR-005**: All Track A values shown together at one time MUST describe the
  same single observing night, defined as the night containing the upcoming
  (or in-progress) local midnight; values MUST NOT flip mid-night at 00:00.

**Per-target lunar distance**

- **FR-006**: For every planner row with known target coordinates, the system
  MUST show the real target↔Moon angular separation for tonight, in whole
  degrees (0–180°), replacing the previous placeholder values.
- **FR-007**: Lunar distance MUST be sortable ascending/descending with
  deterministic tie-breaking; rows with unknown coordinates MUST show an
  explicit unknown state and group after all known values.
- **FR-008**: Displayed separations MUST be within ±2° of reference
  planetarium values for the same date (planning tolerance, inclusive of the
  geocentric simplification).

**Filter guidance**

- **FR-009**: The system MUST derive a per-target filter recommendation for
  tonight by bracketing on (a) tonight's Moon illumination and (b) the
  target's lunar distance: bright Moon AND close target → narrowband only
  (Ha/OIII/SII); otherwise → broadband OK (L/R/G/B plus narrowband). This
  replaces the previous placeholder rule with real inputs.
- **FR-010**: The two bracketing thresholds ("bright Moon" illumination
  percentage, default 40%; "close to Moon" separation, default 60°) MUST be
  user-configurable within valid ranges, MUST persist, and MUST offer a
  reset-to-defaults action. Boundary values count as bright/close.
- **FR-011**: The user MUST be able to filter the planner's target list by
  recommendation category, and the existing group-by-recommendation behavior
  MUST operate on the real values.
- **FR-012**: Each recommendation MUST be explainable in place: the user can
  see the inputs (tonight's illumination, this target's separation) and the
  active thresholds that produced it.
- **FR-013**: Targets with unknown coordinates MUST show an unknown guidance
  state, excluded from recommendation-based filters except via an explicit
  "unknown" choice.

**Opposition / best season**

- **FR-014**: For every planner row with known coordinates, the system MUST
  show the next date (date-level precision, tolerance ±7 days) the target
  culminates near local midnight, derived from the target's catalogued
  position and the Sun's seasonal position — no observer coordinates —
  replacing the "—" stub. The column MUST be sortable by soonest-next.

**Boundary and placeholder integrity**

- **FR-015**: The planner columns that require observer location — max
  altitude, imaging time tonight, visible tonight, and the per-row altitude
  sparkline — MUST remain in place but stay clearly presented as
  estimates/placeholders, unchanged in behavior, until Track B delivers real
  values. Track A MUST NOT alter their semantics and MUST NOT request or use
  observer location.
- **FR-016**: The existing usable-altitude threshold setting MUST be retained
  unchanged (it continues to drive the placeholder columns and will carry
  over to Track B).
- **FR-017**: After Track A ships, no moon-related or opposition value in the
  planner may be derived from placeholder/deterministic-hash sources; every
  displayed Track A number is a real planning-granularity computation or an
  explicit unknown state.
- **FR-018**: All new visible text MUST follow the product's existing
  localization approach, and new columns/controls MUST remain operable
  keyboard-first with correct sort-state announcement, consistent with the
  product's accessibility baseline (WCAG AA).

### Key Entities

- **Observing Night**: the single night all planner values describe; carries
  the Moon's phase name, waxing/waning direction, illumination fraction, and
  planning-granularity sky position for that night. One per night; shared by
  the summary and every row.
- **Target Planning Row**: a library target as seen in the planner; key
  planning attributes: designation/label, catalogued coordinates (may be
  unknown), lunar distance tonight, filter recommendation tonight, next
  opposition date, plus the existing Track-B placeholder fields.
- **Filter Guidance Policy**: the pair of user-configurable thresholds
  (bright-Moon illumination, close-to-Moon separation) with shipped defaults
  and valid ranges; produces one of: narrowband-only, broadband-OK, unknown.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For any date between 2000 and 2050, the planner's Moon
  illumination is within ±3 percentage points of published almanac values,
  and the phase name matches (or is boundary-adjacent within one day of a
  phase transition).
- **SC-002**: For a benchmark set of at least 10 well-known targets across
  the sky on at least 5 spread dates, displayed lunar distances are within
  ±2° of planetarium reference values in 100% of cases.
- **SC-003**: For a benchmark set of seasonal anchor targets, the opposition
  date is within ±7 days of reference best-visibility dates in 100% of cases.
- **SC-004**: Zero planner values in the moon/filter/opposition columns
  originate from placeholder generators after release; audit of the planner
  on any date shows real values or explicit unknown states only.
- **SC-005**: A user can go from opening the planner to a Moon-safe shortlist
  (sorted by lunar distance, filtered to their filter class) in under 30
  seconds using only planner controls.
- **SC-006**: 100% of guidance recommendations expose an in-place explanation
  of their inputs and thresholds.
- **SC-007**: With a library of 5,000 planner targets, enabling the new
  columns does not perceptibly degrade planner responsiveness (interaction
  remains under typical desktop-app responsiveness expectations, e.g.,
  sorting completes without visible stall).
- **SC-008**: Changing either guidance threshold updates every visible
  recommendation without restart, and reset-to-defaults restores shipped
  behavior in one action.

## Assumptions

- **Tonight-only planning**: Track A plans for the current observing night
  only. Choosing an arbitrary future night (date picker) is out of scope
  unless promoted later (flagged as an open question).
- **Observing-night definition**: "tonight" is the night containing the
  upcoming or in-progress local midnight, using the system clock/timezone;
  the nightly Moon state is evaluated once per night at local midnight,
  which is sufficient at planning granularity (the Moon moves ~0.5°/hour;
  well inside the ±2° separation tolerance across a session).
- **Guidance model is two-tier and Moon-only**: narrowband-only vs
  broadband-OK, driven solely by Moon illumination and separation. Target
  type/brightness (e.g., "galaxies don't benefit from narrowband") does NOT
  influence Track A guidance; a richer Telescopius-style model is a candidate
  follow-up (flagged as an open question).
- **Fixed filter vocabulary**: the recommendation vocabulary is the fixed
  broadband set L/R/G/B and narrowband set Ha/OIII/SII; it is not derived
  from the user's actual filter inventory in session metadata.
- **Default thresholds**: bright Moon ≥ 40% illumination; close to Moon
  < 60° separation — carried over from the placeholder rule's shape and
  aligned with common community guidance; user-adjustable per FR-010.
- **Coordinates are available**: target coordinates (RA/Dec) are already
  supplied per planner row by the existing target list (the former
  enrichment blocker is resolved); Track A consumes them and never looks up
  coordinates itself. Rows can still legitimately lack coordinates.
- **Opposition presentation**: shown at date-level precision (e.g., month +
  day); the exact display form (absolute date vs relative "in N months") is
  a presentation decision deferred to design, but sorting is by
  soonest-next in all cases.
- **Moonrise/moonset excluded**: rise/set times require observer location →
  Track B, so the Track A moon summary deliberately omits them.
- **No processing**: the planner recommends and organizes only; it never
  processes, calibrates, or edits images (PixInsight boundary preserved).
- **Existing planner behaviors retained**: catalogue filtering, grouping,
  designation sort, and the usable-altitude setting continue unchanged;
  Track A only replaces the values feeding the moon/filter/opposition
  columns and adds the moon summary.

## Out of Scope (Track B and beyond)

- Observer location capture (settings, geolocation, per-root) and anything
  derived from it: altitude curves, max altitude, imaging time, visibility,
  rise/set/transit, moonrise/moonset, twilight times (dusk/dawn windows).
- Arbitrary-night planning (date picker), multi-night calendars, session
  scheduling.
- Telescopius-parity guidance modeling that weighs target type, surface
  brightness, or the user's filter inventory.
- Any image processing, stacking, or calibration (constitutional boundary).
