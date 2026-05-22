# Data Model: Calibration Matching Rules

**Feature**: 007-calibration-matching-rules
**Date**: 2026-05-20

## Entities

### CalibrationType

Enum.

| Value      | Notes                                                                                    |
|------------|------------------------------------------------------------------------------------------|
| `dark`     | Long-exposure thermal-pattern calibration                                                |
| `flat`     | Flat-field illumination calibration                                                      |
| `bias`     | Read-noise calibration (gain/offset only)                                                |
| `dark_flat`| Reserved for forward-compat; NOT matched, suggested, or assigned in v1 (R-DarkFlat-Reserved). Files with dark_flat IMAGETYP values land as `unclassified` at inbox level (spec 005 ripple). Not exposed in any v1 UI. |

### CalibrationMaster

Provided by upstream crates; referenced here for completeness.

| Field            | Type           | Notes                                |
|------------------|----------------|--------------------------------------|
| `master_id`      | Uuid           | Primary key                          |
| `calibration_type` | CalibrationType | dark / flat / bias                |
| `metadata`       | MetadataRecord | Extracted FITS/XISF metadata         |
| `is_file_master` | bool           | True when user supplied a single file |
| `session_id`     | Option<Uuid>   | Optional originating capture session |

### MatchingRuleConfig

Persisted user configuration per calibration type.

| Field             | Type                | Notes                                  |
|-------------------|---------------------|----------------------------------------|
| `calibration_type` | CalibrationType    | Primary key                            |
| `hard_dimensions` | Vec<Dimension>      | Excluded on mismatch                   |
| `soft_dimensions` | Vec<SoftDimension>  | Dimension + tolerance + max penalty    |
| `prefill_suggestion` | bool           | When true (default), the assign dialog opens pre-filled with the top candidate; user must click Confirm to call `calibration.match.assign`. When false, dialog opens empty. UI NEVER bypasses confirmation (R-Prefill, A7). Settings key: `calibration.prefill_suggestion: boolean` (default true) — spec 018 ripple flagged. |

### Dimension

Enum.

`gain | offset | exposure | temperature | filter | rotation | binning | optic_train | observing_night_proximity | date_proximity`

### SoftDimension

| Field          | Type    | Notes                                       |
|----------------|---------|---------------------------------------------|
| `dimension`    | Dimension | The metadata field                        |
| `tolerance`    | f64     | Units depend on dimension (C, %, °, nights) |
| `max_penalty`  | f64     | 0.0–1.0 cap on confidence reduction         |

### CalibrationMatch

Returned by `calibration.match.suggest`.

| Field                   | Type            | Notes                                       |
|-------------------------|-----------------|---------------------------------------------|
| `session_id`            | Uuid            | Light session                                |
| `master_id`             | Uuid            | Candidate master                            |
| `calibration_type`      | CalibrationType | Type being matched                          |
| `confidence`            | f64             | 0.0–1.0                                     |
| `dimensions_matched`    | Vec<MatchedDim> | Dimension + observed value + reference value|
| `dimensions_mismatched` | Vec<MismatchedDim> | Dimension + reason + delta or `metadata_missing` |
| `selection_reason`      | SelectionReason | `same_session` / `same_night` / `compatible_fallback` |

### CalibrationAssignment

Persisted result of `calibration.match.assign`.

| Field                | Type            | Notes                                  |
|----------------------|-----------------|----------------------------------------|
| `assignment_id`      | Uuid            | Primary key                            |
| `session_id`         | Uuid            | Light session                          |
| `calibration_type`   | CalibrationType | Unique with `session_id`               |
| `master_id`          | Uuid            | Assigned master                        |
| `confidence`         | f64             | Captured at assignment time            |
| `was_override`       | bool            | True when `override=true` was sent     |
| `mismatched_dimensions` | Vec<Dimension> | Recorded for audit                  |
| `assigned_at`        | DateTime<Utc>   | Audit timestamp                        |

## Matching Rule Tables (defaults)

### Dark

| Dimension     | Class | Default tolerance | Default max penalty |
|---------------|-------|-------------------|---------------------|
| `gain`        | Hard  | —                 | —                   |
| `offset`      | Hard  | —                 | —                   |
| `exposure`    | Soft  | ±5%               | 0.3                 |
| `temperature` | Soft  | ±2C               | 0.4                 |

### Flat

| Dimension                   | Class | Default tolerance | Default max penalty |
|-----------------------------|-------|-------------------|---------------------|
| `filter`                    | Hard  | —                 | —                   |
| `binning`                   | Hard  | —                 | —                   |
| `optic_train`               | Hard  | —                 | — (R-OpticTrain: telescope+camera+filter wheel+focuser+rotator owns the vignetting pattern; cross-train flats are unsafe) |
| `rotation`                  | Soft  | ±0.5°             | 0.5                 |
| `observing_night_proximity` | Soft  | 0 nights preferred, ±7 nights tolerated | 0.4 |
| `gain`                      | Soft  | exact preferred   | 0.2 (configurable hard via `calibration.flat.gain.tolerance_hard: boolean`, default false — spec 018 ripple) |

Note: Flat soft cap sum = 0.5 + 0.4 + 0.2 = 1.1. The confidence formula clamps to [0.0, 1.0] preventing negative values (R-OverridePenalty, D3 fix). See research.md R4.

### Bias

| Dimension | Class | Default tolerance | Default max penalty |
|-----------|-------|-------------------|---------------------|
| `gain`    | Hard  | —                 | —                   |
| `offset`  | Hard  | —                 | —                   |

## Invariants

1. A `CalibrationMatch` returned by suggest MUST satisfy all hard dimensions
   of the active `MatchingRuleConfig` for its type, OR be excluded.
2. A `CalibrationAssignment` MAY violate hard dimensions only when
   `was_override = true`.
3. `confidence` ∈ [0.0, 1.0] inclusive. The confidence formula applies
   `clamp(…, 0.0, 1.0)` to prevent negative values from summed soft penalties.
4. `(session_id, calibration_type)` is unique in `CalibrationAssignment`.
5. `dimensions_matched ∪ dimensions_mismatched` covers every dimension declared
   active for the calibration type.
6. `calibration_types` enum in all contracts MUST NOT include `dark_flat` in v1.
   The `CalibrationType` Rust enum reserves the slot; contracts do not expose it.
7. **Mixed-session guard** (E5): If the input `AcquisitionSession.type == "mixed"`,
   `calibration.match.suggest` and `calibration.match.assign` MUST reject with
   error code `session.mixed_state`. The user must split the session first (spec
   005 reclassify). A mixed session has no coherent calibration requirements.
8. **Observer-location guard** (A6): If `AcquisitionSession.observer_location`
   is null OR `exposure_start_utc` is null, the matcher returns
   `status: "observer_location_missing"` (for suggest) or rejects with
   `match.observer_location_missing` (for assign). No fallback matching.

## Settings Keys (A5 — spec 018 ripples, flagged, not yet applied to spec 018)

| Key | Type | Default | Description |
|---|---|---|---|
| `calibration.dark_temp_tolerance` | number | 2.0 | Dark temperature soft dimension tolerance in °C |
| `calibration.flat.gain.tolerance_hard` | boolean | false | When true, gain becomes a hard dimension for flat matching |
| `calibration.dark.override_penalty` | number | 0.3 | Confidence penalty applied when a dark is assigned as override |
| `calibration.flat.override_penalty` | number | 0.3 | Confidence penalty applied when a flat is assigned as override |
| `calibration.bias.override_penalty` | number | 0.3 | Confidence penalty applied when a bias is assigned as override |
| `calibration.prefill_suggestion` | boolean | true | When true, the assign dialog pre-fills with the top candidate (pre-fill only; user must confirm) |
