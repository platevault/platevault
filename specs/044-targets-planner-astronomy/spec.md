# Spec 044 — Targets Planner Astronomy (placeholder)

Status: **PLACEHOLDER / deferred**. Frontend is **mocked** now; real astronomy
is out of scope until the ephemeris backend lands. Created from live-review scope
expansion on the targets table during spec 043 (branch `redesign-ui-platevault`).

This document reserves scope and records decisions. It is intentionally light —
it is NOT yet plan/research/tasks ready. Do not implement real calculations
against it until the dependencies below are resolved and it is promoted to a
full SpecKit feature (plan.md / research.md / data-model.md / contracts/ /
tasks.md).

## 1. Goal

Turn the Targets "Planner" table into a real observation-planning surface:
per-target, per-night observability and moon-aware filter guidance, sortable and
filterable, with a user-configurable usable-altitude threshold. Model the
presentation on Telescopius's observability/filter guidance.

## 2. Scope (requested)

Columns / data per target row (for "tonight" at the observer's location):

- **Opposition time** — already added as a column (mocked). Make it sortable.
- **Max altitude** — peak altitude tonight. Sortable.
- **Sessions** — count of acquisition sessions for the target. Sortable.
- **Visibility** — visible-tonight flag / window. Sortable.
- **Lunar distance** — angular separation (degrees) between the target and the
  Moon tonight.
- **Filters possible** — recommended filter set (broadband vs narrowband, e.g.
  L/R/G/B vs Ha/OIII/SII) derived from **moon phase + lunar distance**. Model
  the presentation on how Telescopius surfaces this (phase- and
  separation-dependent guidance). Research item — see §5.
- **Imaging time tonight** — hours the target spends above the usable-altitude
  threshold tonight (integral of the altitude curve above the threshold).

Interaction:

- **Sort** on: opposition time, max altitude, sessions, visibility (plus the
  existing designation sort).
- **Filter by filter** — filter the target list by which filters are
  possible/recommended.

Settings:

- New setting **Usable altitude threshold** (degrees above the horizon used for
  the "imaging time tonight" / visible-tonight calculation). **Default 30°.**
  Replaces the hardcoded `USABLE_ALT_DEG = 30` in
  `apps/desktop/src/features/targets/planner-altitude.ts`.

## 3. Current implementation (this branch — MOCKED)

Per the product owner: **wire/mock the frontend only for now.** Follow the
existing STUB pattern in `planner-altitude.ts` (deterministic pseudo-values keyed
off the designation so a target renders stably; clearly commented as NOT
astronomy). New mocked fields (lunar distance, filters-possible, imaging-time)
are derived the same deterministic way and surfaced in the table + sorts +
filter + the new settings threshold. UI, sorting, filtering, and the settings
control are real and testable; the underlying numbers are placeholders.

## 4. Dependencies (block the real implementation)

- **#58 — altitude ephemeris + observer location.** Real max altitude, imaging
  time, and visibility require true target altitude curves and the user's
  observer location (lat/long/elevation/timezone). Today
  `STUB_OBSERVER_LAT_DEG = 52.1` is hardcoded.
- **#57 — targets list-endpoint enrichment** (RA/Dec/magnitude/constellation),
  needed to compute any per-row observability + the target↔Moon separation.

Note: **lunar filtering is the LEAST blocked piece.** The Moon's phase and sky
position for a given night is a well-known **one-time, cacheable calculation**
(standard low-precision lunar ephemeris — Meeus-style; no per-target ephemeris
pipeline needed). Given that + the target RA/Dec (#57), the target↔Moon angular
separation is a direct spherical-distance calc, and "filters possible" is then
**logical bracketing** on (moon brightness from phase, separation degrees). So it
can land ahead of the full #58 altitude work, depending only on #57 + a small
standalone moon module.

## 5. Open questions / research (for promotion to a real spec)

- **Filters-possible model**: capture exactly how Telescopius maps (moon phase,
  lunar separation, target type/brightness) → recommended filters, and decide
  the bands/thresholds we adopt. Keep configurable where plausible.
  Computation shape (per the product owner): compute the Moon's phase + position
  for the night ONCE and cache it; compute each target's angular separation from
  the Moon; then do **logical bracketing** — bright moon + small separation →
  narrowband only (Ha/OIII/SII); dim moon and/or large separation → broadband OK
  (L/R/G/B). Use a standard low-precision lunar ephemeris (Meeus, *Astronomical
  Algorithms*) and cross-check thresholds against Telescopius's presentation.
- **Observer location source**: settings field vs system geolocation vs per-root.
- **"Tonight" definition**: astronomical/nautical dusk→dawn window, timezone
  handling, and how opposition time is presented (date vs in-N-months).
- Whether calculations run client-side (JS astronomy lib) or backend (Rust
  ephemeris crate) — ties to #58.

## 6. Out of scope

Real ephemeris/astronomy, observer-location capture, and the Telescopius filter
model are all deferred to this spec's future promotion. No backend work is done
under this placeholder.
