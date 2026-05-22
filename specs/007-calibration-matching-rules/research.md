# Research: Calibration Matching Rules

**Feature**: 007-calibration-matching-rules
**Date**: 2026-05-20

## R1. Matching dimensions per calibration type

### Decision

Each calibration type has a fixed set of dimensions split into **hard** (exclude
on mismatch) and **soft** (tolerated within range, reduces confidence).

| Type   | Hard dimensions                        | Soft dimensions (default tolerance)       |
|--------|----------------------------------------|-------------------------------------------|
| Dark   | gain, offset                           | exposure (±5%), temperature (±2C)         |
| Flat   | filter, binning, optic_train           | rotation (±0.5°), observing-night proximity (±N nights, default 7), gain (exact preferred, soft warning otherwise) |
| Bias   | gain, offset                           | (none by default; exposure NOT considered) |

`optic_train` is a **hard** dimension for flats (R-OpticTrain). Rationale:
the optic train (telescope + camera + filter wheel + focuser + rotator
combination) owns the vignetting pattern. Flats captured with a different
optic train have a different illumination profile and are unsafe to use as
calibration frames regardless of filter or rotation match. Cross-train flats
are excluded entirely; the user must override explicitly.

`dark_flat` is reserved in the `CalibrationType` enum but is **not matched
in v1**. Modern flat panels make dark-flats largely unnecessary. Files with
dark_flat IMAGETYP values land as `unclassified` at the inbox level (spec 005
ripple). No `dark_flat` slot appears in any v1 Settings UI or contract enum
(R-DarkFlat-Reserved).

### Rationale

Hard/soft separation mirrors how seasoned astrophotographers reason: a flat
with the wrong filter is unusable, but a flat shot two nights later at the
same rotation is acceptable. WBPP applies similar reasoning by grouping on
"required matches" and allowing date and temperature drift to be configurable.

### Alternatives considered

- Single weight vector per dimension (e.g., score = Σ w_i × d_i): rejected
  because users do not have an intuition for weights, and hard exclusions
  collapse cleanly into infinite weight which obscures the model.
- Pure machine-learned ranking: rejected for v1; we have no labeled history,
  and the explainability requirement (FR-011) favors a deterministic rule
  engine.

## R2. Prior art reference: WBPP

PixInsight WBPP groups calibration by filter, binning, gain/offset, and date
window. It distinguishes "essential" matches (filter, binning) from
"tolerable drift" (exposure tolerance, days from light). Astro Library
Manager mirrors this taxonomy but exposes the tolerances as user-configurable
per type instead of bundled defaults.

We DO NOT replicate WBPP's calibration execution; only its matching
classification taxonomy.

## R3. Same-night / observing-night semantics for flats

### Decision

Observing-night identity is provided by the sessions crate. The timestamp
source for observing-night calculation is `AcquisitionSession.exposure_start_utc`
(R-Night-TS-1). Spec 005's IMAGETYP-driven classifier feeds the session; the
session aggregates `exposure_start_utc` from its earliest frame's `DATE-OBS`
keyword. The chain is: `DATE-OBS` → `exposure_start_utc` on `AcquisitionSession`
→ observing-night identity via spec 023's local-solar-noon boundary.

The matcher reads `AcquisitionSession.observer_location.tz` (per spec 002 +
spec 023 amendments) to apply spec 023's local-solar-noon boundary when
computing the observing night. The timezone is sourced from the session's
recorded observer location, not from a global settings key and not from a
hardcoded default.

**Refuse-to-match when observer_location or exposure_start_utc is null** (A6):
When `AcquisitionSession.observer_location` is null OR
`AcquisitionSession.exposure_start_utc` is null, the matcher MUST refuse to
match calibration frames for that session and return a
`match.observer_location_missing` result status. The session must be reviewed
(per spec 002 `provenance.unreviewed` mechanism) before matching can proceed.

There is NO ±12h date-window fallback. The prior fallback policy is
**replaced** by the refuse-to-match behavior. An unreviewed or missing
observer_location is a data-quality issue that must be resolved, not silently
tolerated.

### Rationale

After-midnight flats are common and breaking sessions on calendar boundaries
discards valid pairings. Sessions crate already groups capture by observing
night, so the matcher delegates instead of reinventing. Refusing to match
rather than falling back to a date window prevents incorrect calibration
assignments that appear to succeed but use the wrong night's flats.

## R4. Confidence model

### Decision

Confidence is a single scalar 0.0–1.0, computed as (R-OverridePenalty):

```
confidence = clamp(1.0 − Σ soft_penalty(dim) − override_penalty − metadata_gap_penalty, 0.0, 1.0)
```

with `soft_penalty(dim) = clamp(|delta|/tolerance, 0, max_per_dim)`.

The outer `clamp(…, 0.0, 1.0)` is **mandatory** to prevent negative confidence
values when multiple soft penalties sum above 1.0. Example: Flat soft cap sum
is rotation 0.5 + observing_night_proximity 0.4 + gain 0.2 = 1.1 — without
the clamp this would produce a negative confidence (D3 fix).

Default `override_penalty = 0.3` (R-OverridePenalty, D4). This is
per-frame-type configurable via Settings (A5):
- `calibration.<frame_type>.override_penalty: number` (default 0.3)

The penalty must be clamped: `max(0.0, override_penalty)`.

Default dark temperature tolerance: `calibration.dark_temp_tolerance = 2.0°C`
(A5). User-configurable in Settings → Calibration.

Flat gain tolerance: `calibration.flat.gain.tolerance_hard: boolean`
(default `false` — gain is Soft for flats). When set to `true`, gain becomes
a hard dimension for flats (A5).

These settings keys are spec 018 ripples — flagged for spec 018 when next
revised.

Returned alongside `dimensions_matched` and `dimensions_mismatched` arrays so
the UI can render structured explanations without re-deriving the scalar.

### Alternatives considered

- Structured confidence object: keeps richer detail but forces the UI and any
  external integration to render multiple axes. Deferred to a later spec if
  the scalar proves insufficient.

## R5. Auto-match vs manual override policy

### Decision (A7, R-Prefill)

- `calibration.match.suggest` is read-only and returns ranked candidates only.
- `calibration.match.assign` persists the chosen master.
- Assigning a hard-rule mismatch requires `override=true`; the response
  records the override and the mismatched dimensions in audit history.
- **Suggestions are pre-fill only.** The UI NEVER calls `calibration.match.assign`
  without explicit user confirmation. The assign dialog opens pre-filled with
  the top candidate when `prefill_suggestion = true` (default); the user must
  click Confirm to call `calibration.match.assign`. When `prefill_suggestion = false`,
  the dialog opens empty.
- The `MatchingRuleConfig.prefill_suggestion` field (formerly `suggest_auto_assign`)
  controls UI pre-fill behavior only. It does NOT enable silent auto-assignment.
- Loop-closing rule: `calibration.match.suggest` → UI dialog opens with
  pre-filled top candidate (if `prefill_suggestion = true`) → user clicks
  Confirm → `calibration.match.assign` is called → assignment persisted.
  No path exists where `assign` is called without an explicit user action.
- Spec 008 UI must respect the `prefill_suggestion` setting when opening the
  assign dialog in the project-detail accordion. This is a spec 008 dependency.

### Rationale

Constitution principle II (Reviewable Filesystem Mutation) extends in spirit
to non-filesystem state changes that affect downstream PixInsight prep. Every
assignment is a deliberate action with audit trail.

## R6. Metadata-gap handling

### Decision

When a candidate is missing metadata required by a soft rule, that dimension
is recorded in `dimensions_mismatched` with reason `metadata_missing` and a
fixed penalty (default 0.1). Hard-rule metadata gaps exclude the candidate
entirely; the candidate is not returned with confidence 0 because that would
be indistinguishable from "evaluated but failed".

### Rationale

Users need to distinguish "we don't have data" from "we evaluated and the
data disagrees". Surfacing the missing dimension prompts a metadata
re-extraction action (spec 003).

## R7. Persistence model

### Decision

Assignments persist in a new SQLite table `calibration_assignment` keyed by
(`session_id`, `calibration_type`) with unique constraint and override flag.
Matching rule configuration persists in a `calibration_rule_config` table
keyed by `calibration_type` with JSON tolerance payload. Suggestions are NOT
persisted; they are recomputed on demand.

### Rationale

Suggestions depend on the current master library and current rule
configuration; persisting them creates staleness risk. Assignments and rule
configurations are durable user decisions.

## Resolved questions

- **Batch matching** (R-Batch): `calibration.match.suggest.batch` ships in v1
  as a separate contract. See `contracts/calibration.match.suggest.batch.json`
  and `spec.md` US5.
- **Pre-fill vs auto-assign**: Resolved by R-Prefill (see R5 above). No
  auto-assign; Settings key is `prefill_suggestion` (spec 018 ripple flagged).

## Open questions deferred to implementation

- Whether confidence thresholds for "high-confidence match" should be a global
  setting or per-calibration-type (relevant to batch status classification).
- Whether rotation tolerance should be expressed in degrees or sky-PA degrees
  for refractor setups without a derotator.
