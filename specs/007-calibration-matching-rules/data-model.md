# Data Model: Calibration Matching Rules

**Feature**: 007-calibration-matching-rules
**Date**: 2026-05-20

## Entities

### CalibrationType

Enum.

| Value      | Notes                                        |
|------------|----------------------------------------------|
| `dark`     | Long-exposure thermal-pattern calibration    |
| `flat`     | Flat-field illumination calibration          |
| `bias`     | Read-noise calibration (gain/offset only)    |
| `dark_flat`| Reserved; not part of v1 user stories        |

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
| `suggest_auto_assign` | bool            | UI may auto-call assign if confidence high |

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
| `optic_train`               | Hard  | —                 | —                   |
| `rotation`                  | Soft  | ±0.5°             | 0.5                 |
| `observing_night_proximity` | Soft  | 0 nights preferred, ±7 nights tolerated | 0.4 |
| `gain`                      | Soft  | exact preferred   | 0.2                 |

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
3. `confidence` ∈ [0.0, 1.0] inclusive.
4. `(session_id, calibration_type)` is unique in `CalibrationAssignment`.
5. `dimensions_matched ∪ dimensions_mismatched` covers every dimension declared
   active for the calibration type.
