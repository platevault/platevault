# Calibration

PlateVault tracks your *master* calibration frames — master darks, flats, and
bias — as individually identified library items, and matches them against the
acquisition sessions that need them. It does not build masters (that is your
processing tool's job); it makes sure that when you sit down to calibrate,
the right master for each session is one confident suggestion away.

## Getting masters into the library

Master calibration files enter through the same [Inbox](./02-inbox.md)
pipeline as everything else. A folder containing several master files — say
two darks, a flat, and a bias — classifies as separate individual items, not
one folder-level blob. Each item carries its own kind and fingerprint: gain,
sensor temperature, exposure, binning, and filter where relevant. Confirm and
apply as usual, and each master lands in the calibration store.

## The Calibration page

The **Calibration** page shows one row per master file, grouped by kind
(**DARKS**, **FLATS**, **BIAS**) or by camera, searchable ("Search camera,
kind, filter…") and sortable (including by age). Fingerprint columns are
kind-conditional: a bias has no meaningful temperature or exposure, so those
cells show a dash — by design, not as missing data. Master *light* frames
never appear here.

[screenshot: the Calibration page with masters grouped by kind]

Selecting a master opens its detail rail: **Master fingerprint** (kind,
exposure, temperature, sensor mode), **Reuse policy**, and **Usage stats**
(**Sessions matched**, **Projects linked**, or "unused"). An older master
shows an aging chip ("aging {days}d"). Actions include **Use in project**,
**Replace master**, and a native reveal (**Reveal in Explorer**).

## Matching masters to sessions

The **Compatible sessions** panel answers "what can this master calibrate?":

- Select a master and PlateVault ranks candidate sessions, each shown with
  real context — target, filter, night, frame count — never opaque IDs.
- Sessions that fail a *hard rule* (wrong camera, wrong gain…) are shown with
  a mismatch indicator rather than silently hidden: "Hard-rule mismatch:
  {dims}. Confirm to force-assign." You can **Force-assign** if you know
  better, but you have to say so explicitly.
- Softer disagreements lower confidence instead of blocking, and ambiguity
  is flagged: "Multiple sessions at similar confidence — review before
  assigning."
- Flats get an extra honesty check on rotation: "Rotation differs by {deg}° —
  flat may not be valid for these lights."

Assigning is always advisory-then-confirm: **Assign** proposes, **Confirm
assign** records it (with usage counts updated); cancelling changes nothing.
No match is ever applied automatically.

[screenshot: compatible sessions panel with ranked candidates and one mismatch indicator]

If nothing matches, the panel says why and where to go: "No acquisition
sessions matched this master's fingerprint. Adjust tolerances in
Settings → Calibration."

## Tolerances

**Settings → Calibration → Matching criteria** controls what "matching"
means, per field (**Camera**, **Gain**, **Offset**, **Sensor temp**,
**Binning**, **Dark / bias age**): whether the field is required for a match,
its tolerance (e.g. degrees Celsius for sensor temperature, days for master
age), and its severity — as the pane explains, "Toggle a field off to exclude
it from matching (e.g. ignore gain). Soft/warn fields never block a match —
they only lower confidence." The **Offset** tolerance, for example, controls
whether sessions taken at a different sensor offset can still match a master.
Changes persist across restarts and take effect immediately in the matching
panel.

> **Note:** the Calibration page covers dark, flat, and bias masters. More
> exotic kinds (dark-flats, bad-pixel maps) are not surfaced in this version —
> by design.

## Related journeys

- [Journey 8 — Calibration: ingest cal frames → masters → matching](../product/user-journeys.md#journey-8--calibration-ingest-cal-frames--masters--matching)

Click-by-click scenario scripts:

- `e2e-agentic-test/040-calibration-masters/masters-detection-individual-items/scenario.md`
- `e2e-agentic-test/007-calibration-matching/match-suggest-assign-tolerances/scenario.md`
- `e2e-agentic-test/journeys/calibration-journey-ingest-to-match/scenario.md`
