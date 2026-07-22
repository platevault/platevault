# Matching Settings Contracts

This surface validates and versions settings used by future suggestions.
Accepted sessions and revisions retain the settings revision used for their
decision.

## DTOs

```text
MatchingSettings {
  revision: uint64,
  sameSession: GeometryThresholds,
  sibling: GeometryThresholds,
  mosaic: {
    overlapMinPercent: decimal,
    overlapMaxPercent: decimal,
    residualSkyRotationCapDeg: decimal = 10
  },
  darkThermal: {
    moderateDeg: decimal,
    severeDeg: decimal
  },
  calibrationAge: BoundedList<
    {
      cameraId: string,
      kind: "dark" | "bias",
      freshThroughDays: uint32,
      redAfterDays: uint32
    }
  , 500>,
  flatOrientation: {
    normalThroughDeg: decimal,
    redAboveDeg: decimal
  },
  flatAge: {
    redAfterNights: uint32
  },
  fixedRules: {
    opticalProfileSameMaxPercent: 5,
    opticalProfileReviewMaxPercent: 10,
    opticalProfileEvidenceConflictPercent: 10,
    flatSameNightFreshMaxNights: 1,
    flatYellowStartsNights: 2
  },
  updatedAt: timestamp,
  updatedBy: string
}

GeometryThresholds {
  coverageMinPercent: decimal,
  centerSeparationMaxPercent: decimal,
  rotationMaxDeg: decimal
}

SettingsValidation {
  valid: boolean,
  issues: BoundedList<SettingsIssue, 500>,
  effective: MatchingSettings
}

SettingsIssue {
  code: string,
  severity: "yellow" | "red",
  fieldPaths: BoundedList<string, 50>,
  values: BoundedList<{ fieldPath: string, value: decimal | uint32 }, 50>,
  messageKey: string
}
```

Red issues make `valid` false and prevent save. Yellow issues keep `valid`
true and must be returned to the caller.

## Defaults, bounds, and warnings

All interval endpoints are inclusive unless a condition says `above` or
`below`.

| Field | Default | Hard bounds | Yellow condition |
|---|---:|---:|---|
| `sameSession.coverageMinPercent` | 95 | 90 to 99.5 | Below 93 |
| `sameSession.centerSeparationMaxPercent` | 2 | 0.5 to 5 | Above 3 |
| `sameSession.rotationMaxDeg` | 1 | 0.25 to 3 | Above 2 |
| `sibling.coverageMinPercent` | 90 | 80 to 95 | Below 85 |
| `sibling.centerSeparationMaxPercent` | 5 | 2 to 15 | Above 10 |
| `sibling.rotationMaxDeg` | 5 | 1 to 15 | Above 10 |
| `mosaic.overlapMinPercent` | 5 | 1 to 20 | Below 3 |
| `mosaic.overlapMaxPercent` | 40 | 20 to 60 | Above 50 |
| `darkThermal.moderateDeg` | 0.5 | 0.1 to 2 | Above 1 |
| `darkThermal.severeDeg` | 2 | 0.5 to 5 | Above 3 |
| `calibrationAge` item `freshThroughDays` | 270 | 0 to 1,795 | None |
| `calibrationAge` item `redAfterDays` | 365 | 30 to 1,825 | Above 730 |
| `flatOrientation.normalThroughDeg` | 2 | 0.5 to 5 | Above 3 |
| `flatOrientation.redAboveDeg` | 5 | Above `normalThroughDeg`, up to 15 | Above 8 |
| `flatAge.redAfterNights` | 7 | 7 to 365 | Above 90 |

`calibrationAge` defaults apply per registered camera and per kind when no
override exists.

## Cross-field validation

| Code | Red condition |
|---|---|
| `settings.sibling_coverage_stricter` | Sibling minimum coverage is greater than same-session minimum coverage. |
| `settings.sibling_center_stricter` | Sibling maximum centre separation is less than same-session maximum centre separation. |
| `settings.sibling_rotation_stricter` | Sibling maximum rotation is less than same-session maximum rotation. |
| `settings.mosaic_overlap_order` | Mosaic minimum overlap is greater than or equal to mosaic maximum overlap. |
| `settings.mosaic_sibling_gap` | Mosaic maximum overlap is greater than sibling minimum coverage minus 10 percentage points. |
| `settings.dark_thermal_gap` | Severe dark-thermal threshold is less than moderate threshold plus 0.5 degrees. |
| `settings.calibration_age_gap` | Red age is less than fresh age plus 30 days. |
| `settings.flat_orientation_order` | Flat red orientation is less than or equal to the normal orientation boundary. |

## Queries

### `matching_settings.get`

- Type: read-only.
- Request: `{ revision?: uint64 }`.
- Response: `MatchingSettings`.
- Errors: `matching_settings.revision_not_found`.

### `matching_settings.validate`

- Type: read-only.
- Request: `{ baseRevision, patch }`.
- Response: `SettingsValidation`.
- Notes: omitted patch fields retain their base-revision values.
- Notes: validation returns all red and yellow issues in field-path order.

## Commands

### `matching_settings.update`

- Type: database mutation.
- Request: `{ expectedRevision, patch, acknowledgedWarningCodes: BoundedList<string, 500>, mutationContext }`.
- Response: `{ settings: MatchingSettings, warnings: SettingsValidation.issues, auditId }`.
- Guard: the expected revision must equal the accepted settings revision.
- Guard: the patch must have no red issue.
- Guard: every returned yellow issue code must appear in `acknowledgedWarningCodes`.
- Effect: the patch, calibration-age overrides, acknowledgements, and effective
  values commit as one immutable settings revision or do not commit.
- Effect: only suggestions created after commit use the new revision.
- Effect: accepted sessions, proposals, group revisions, and suppression fingerprints retain their original settings revision.
- Idempotency: the shared `commandId` rule applies.

## Matching outcome semantics

| Rule | Normal | Yellow | Red or blocked |
|---|---|---|---|
| Regulated dark thermal 95th percentile | At most `moderateDeg` | Above moderate through severe | Above severe requires explicit audited approval |
| Dark or bias age | At most `freshThroughDays` | Above fresh through `redAfterDays` | Above red requires explicit audited selection |
| Flat physical orientation delta | At most `normalThroughDeg` | Above normal through `redAboveDeg` | Above red requires explicit approval |
| Flat age | 0 to 1 nights | 2 nights through `redAfterNights` | Above red requires explicit approval |

Fewer than 80 percent valid dark-temperature readings blocks an automatic
thermally stable result. Missing and invalid readings are excluded from the
minimum, median, maximum, and 95th-percentile statistics.

Flat physical orientation uses a confirmed mechanical rotator field and minimum
circular delta modulo 360. It does not use 180-degree equivalence. Missing or
unverified physical angle yields a yellow compatibility-unverified warning.

## Events

| Event | Payload |
|---|---|
| `matching_settings.updated` | `{ previousRevision, revision, changedFieldPaths: BoundedList<string, 500>, warningCodes: BoundedList<string, 500> }` |

## Error codes

| Code | Condition | Required details |
|---|---|---|
| `matching_settings.revision_not_found` | A requested revision does not exist. | `revision` |
| `matching_settings.out_of_bounds` | One or more values violate hard bounds. | `issues: BoundedList<SettingsIssue, 500>` |
| `matching_settings.cross_constraint` | One or more cross-field constraints fail. | `issues: BoundedList<SettingsIssue, 500>` |
| `matching_settings.warning_unacknowledged` | A valid risky value lacks acknowledgement. | `warningCodes: BoundedList<string, 500>` |

## Audit expectations

- A successful update records previous and successor revisions, changed field paths, and acknowledged warnings.
- A refused update records all red or unacknowledged yellow issue codes.
- Validation and get operations do not write audit entries.
