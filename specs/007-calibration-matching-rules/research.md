# Research: Calibration Matching Rules

**Feature**: 007-calibration-matching-rules
**Date**: 2026-05-20

## R1. Matching dimensions per calibration type

### Decision

Each calibration type has a fixed set of dimensions split into **hard** (exclude
on mismatch) and **soft** (tolerated within range, reduces confidence).

| Type   | Hard dimensions               | Soft dimensions (default tolerance)       |
|--------|-------------------------------|-------------------------------------------|
| Dark   | gain, offset                  | exposure (±5%), temperature (±2C)         |
| Flat   | filter, binning, telescope/optic train | rotation (±0.5°), observing-night proximity (±N nights, default 7), gain (exact preferred, soft warning otherwise) |
| Bias   | gain, offset                  | (none by default; exposure NOT considered) |

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

Observing-night identity is provided by the sessions crate. A flat is
"same-night" with a light frame when both belong to the same observing-night
record, regardless of calendar date. When the flat session record carries no
observing-night identity, fall back to a date window centered on the local
acquisition timestamp (default ±12 hours), then to compatibility-only matching.

### Rationale

After-midnight flats are common and breaking sessions on calendar boundaries
discards valid pairings. Sessions crate already groups capture by observing
night, so the matcher delegates instead of reinventing.

## R4. Confidence model

### Decision

Confidence is a single scalar 0.0–1.0, computed as:

```
confidence = 1.0
           - Σ soft_penalty(dim)
           - override_penalty (if any)
           - metadata_gap_penalty (per missing soft dim)
```

with `soft_penalty(dim) = clamp(|delta|/tolerance, 0, max_per_dim)`. Returned
alongside `dimensions_matched` and `dimensions_mismatched` arrays so the UI can
render structured explanations without re-deriving the scalar.

### Alternatives considered

- Structured confidence object: keeps richer detail but forces the UI and any
  external integration to render multiple axes. Deferred to a later spec if
  the scalar proves insufficient.

## R5. Auto-match vs manual override policy

### Decision

- `calibration.match.suggest` is read-only and returns ranked candidates only.
- `calibration.match.assign` persists the chosen master.
- Assigning a hard-rule mismatch requires `override=true`; the response
  records the override and the mismatched dimensions in audit history.
- Suggestions never auto-apply. The Settings "Suggest auto-calibration" toggle
  controls whether the UI calls `assign` automatically when exactly one
  high-confidence candidate is returned; it never bypasses the contract.

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

## Open questions deferred to implementation

- Whether the matcher should expose batch matching (project-wide) as a
  separate contract for performance, or rely on the single-session contract
  called per session.
- Whether confidence thresholds for "auto-apply" should be a global setting or
  per-calibration-type.
- Whether rotation tolerance should be expressed in degrees or sky-PA degrees
  for refractor setups without a derotator.
