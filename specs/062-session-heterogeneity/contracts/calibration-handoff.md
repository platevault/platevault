# Calibration Candidate and External Handoff Contracts

This surface finds dark, bias, and flat sessions for an external processor. It
creates immutable handoff snapshots. It does not construct, revise, or identify
a native calibration master.

## DTOs

### `CalibrationRequirement`

```text
CalibrationRequirement {
  requirementId: string,
  kind: "dark" | "bias" | "flat",
  cameraId?: string,
  opticalProfileId?: string,
  filterIdentity?:
    | { state: "known", normalizedCapturedLabelId: string }
    | { state: "absent" },
  targetLightSessionId?: string,
  targetObservingNight?: LocalDate,
  recipeId: string,
  recipeRevisionId: string,
  requiredRecipeEvidenceRef: string,
  requiredRecipeEvidenceComplete: boolean,
  missingRequiredFields: BoundedList<string, 100>
}
```

Required dark evidence covers cooling mode, normalized exposure, gain, offset,
binning, optional readout mode, and raster dimensions. A regulated dark also
requires an exact cooling set point. Required bias evidence covers camera,
gain, offset, binning, optional readout mode, and raster dimensions. Bias
evidence does not use exposure or temperature.

Required flat evidence covers optical profile, a profile-scoped normalized
captured filter label or explicit absent-filter state, gain, offset, separate
horizontal and vertical binning, optional readout mode, raster dimensions,
applicable camera geometry, and physical-orientation evidence. Flat evidence
does not use exposure duration. A dark or bias requirement names `cameraId`.
A flat requirement names `opticalProfileId`, `filterIdentity`,
`targetLightSessionId`, and `targetObservingNight`.

`requiredRecipeEvidenceComplete` is false when a required field is unknown,
contradictory, or unresolved. An explicit absent or unverified flat-orientation
state is resolved evidence even when it has no angle. `missingRequiredFields`
names every unresolved field.

### `CalibrationCandidateEvidence`

```text
CalibrationCandidateEvidence {
  evidenceId: string,
  sessionId: string,
  requirementId: string,
  recipeCompatibility: "compatible" | "incompatible" | "unknown",
  recipeEvidenceRef: string,
  recipeEvidenceComplete: boolean,
  missingRecipeFields: BoundedList<string, 100>,
  temperatureMode: "regulated" | "unregulated" | "unknown" | "not_applicable",
  age:
    | {
        basis: "elapsed_days",
        state: "fresh" | "yellow" | "red" | "unknown",
        ageDays?: uint32,
        freshThroughDays: uint32,
        redAfterDays: uint32,
        settingsRevision: uint64
      }
    | {
        basis: "observing_night_distance",
        state: "fresh" | "yellow" | "red" | "unknown",
        ageNights?: uint32,
        freshThroughNights: 1,
        redAfterNights: uint32,
        settingsRevision: uint64
      },
  thermal: {
    state: "normal" | "yellow" | "red" | "unknown" | "not_applicable",
    validReadingPercent?: decimal,
    minimumAbsoluteDeviationDeg?: decimal,
    medianAbsoluteDeviationDeg?: decimal,
    maximumAbsoluteDeviationDeg?: decimal,
    percentile95AbsoluteDeviationDeg?: decimal,
    missingReadingCount: uint32,
    invalidReadingCount: uint32,
    settingsRevision?: uint64
  },
  orientation: {
    state: "normal" | "yellow" | "red" | "unknown" | "not_applicable",
    minimumCircularDeltaDeg?: decimal,
    normalThroughDeg?: decimal,
    redAboveDeg?: decimal,
    settingsRevision?: uint64
  },
  sourceAvailability: {
    indexedFrameCount: uint32,
    availableReadableIndexedFrameCount: uint32,
    checkedAt: timestamp
  },
  sufficient: boolean,
  automaticEligibility: "eligible" | "review_required" | "blocked",
  warningCodes: BoundedList<string, 100>,
  basisFingerprint: Digest
}
```

Age evidence uses these kind-specific rules:

- Dark and bias age is measured at query or snapshot creation time from the
  immutable session acquisition date. Its defaults are fresh through 270 days,
  yellow from 271 through 365 days, and red beyond 365 days.
- Flat age is the absolute observing-night distance from the light requirement.
  Its defaults are fresh at 0 or 1 nights, yellow at 2 through 7 nights, and red
  above 7 nights. The flat red boundary is configurable from 7 through 365
  nights and warns above 90 nights.
- The referenced settings revision supplies the configured boundaries.

Regulated dark thermal state uses the 95th-percentile absolute deviation from
the cooling set point. Fewer than 80 percent valid readings yields `unknown`
and blocks automatic selection. Missing and invalid readings are excluded from
all thermal statistics.

Bias uses `not_applicable` for `temperatureMode` and `thermal.state`.
Unregulated darks use `not_applicable` for `thermal.state`. Unknown-temperature
darks use `unknown` for `temperatureMode` and `thermal.state`.

Dark and bias candidates use `not_applicable` for `orientation.state`. Flat
orientation uses a confirmed physical rotator angle and minimum circular delta
modulo 360 without 180-degree equivalence. The defaults are normal through 2
degrees, yellow above 2 through 5 degrees, and red above 5 degrees. Missing or
unverified physical orientation yields `unknown` with a yellow
compatibility-unverified warning. It is never inferred from solved sky
orientation.

For a flat, `recipeCompatibility` compares optical profile, profile-scoped
filter identity, gain, offset state and value, separate binning axes, readout
state and value, raster dimensions, and applicable camera geometry. Exposure
duration does not participate. Each flat family is additionally scoped to one
physical-orientation evidence state and one observing night. Candidate discovery
can relate another flat family through the shared recipe signature. Orientation
delta and observing-night distance then determine its warning and review state.

`sufficient` has one narrow meaning. It is true only when the required recipe
evidence is complete and the session has at least one source frame that is
indexed, available, and readable at `checkedAt`. It imposes no frame-count or
scientific-quality minimum.

Automatic eligibility requires all of these conditions:

- `recipeCompatibility` is `compatible`.
- Both required and candidate recipe evidence are complete.
- `sufficient` is true.
- A dark or bias age is `fresh` or `yellow`.
- A regulated dark has `normal` or `yellow` thermal state.
- Temperature mode is `regulated` for a dark or `not_applicable` for a bias or
  flat.
- A flat candidate belongs to the same observing night as its light
  requirement.
- A flat has `normal`, `yellow`, or `unknown` orientation state.

Red age, red regulated-dark thermal evidence, red flat orientation, unregulated
temperature mode, and every cross-night flat yield `review_required`. A
one-night-old flat remains fresh but requires review because it is not from the
same observing night. Unknown age, unknown compatibility, incomplete recipe
evidence, unknown dark temperature mode, and insufficient source availability
yield `blocked`. Unknown flat physical orientation remains reviewable and
visible with its compatibility-unverified warning. Review cannot override a
blocked state.

### `CalibrationSelection`

```text
CalibrationSelection {
  selectionId: string,
  requirementId: string,
  sessionId: string,
  evidenceId: string,
  source: "automatic" | "reviewed",
  selectedAt: timestamp,
  review?: {
    reviewId: string,
    reviewedAt: timestamp,
    decisionReason: SafeText,
    acknowledgedWarningCodes: BoundedList<string, 100>
  }
}
```

Each requirement has at most one automatic selection. Reviewed selections are
additive and do not change the automatic selection. A reviewed selection is
required for every added session, every red or unregulated dark or bias
session, every cross-night flat session, and every flat with red physical
orientation.

### `CalibrationHandoffSnapshot`

```text
CalibrationHandoffSnapshot {
  handoffId: string,
  handoffHeadGeneration: uint64,
  snapshotId: string,
  predecessorSnapshotId?: string,
  projectId: string,
  externalProcessor: "pixinsight_wbpp" | "siril",
  requirementCount: uint32,
  selectionCount: uint32,
  frameCount: uint64,
  sourceByteCount: uint64,
  maximumSourceBytes: 17592186044416,
  matchingSettingsRevision: uint64,
  evaluationAt: timestamp,
  createdAt: timestamp,
  createdBy: string,
  basisFingerprint: Digest,
  warningCodes: BoundedList<string, 100>
}

CalibrationHandoffOperation {
  operationId: string,
  handoffId: string,
  state: "verifying" | "cancelling" | "cancelled" | "applied" | "failed",
  verifiedFrameCount: uint64,
  totalFrameCount: uint64,
  verifiedSourceBytes: uint64,
  totalSourceBytes: uint64,
  cancelSafe: boolean,
  snapshotId?: string,
  reviewId?: string,
  failureCode?:
    | "calibration.source_unavailable"
    | "calibration.source_identity_changed"
    | "calibration.source_fingerprint_changed"
    | "calibration.handoff_too_large"
    | "calibration.cancel_deadline_exceeded"
    | "calibration.verification_failed",
  failureDetail?: SafeText,
  updatedAt: timestamp
}

CalibrationHandoffFrame =
  | {
      visibility: "authorized",
      selectionId: string,
      sessionId: string,
      sessionMembershipOrdinal: uint32,
      frameId: string,
      sourceState: "indexed_readable",
      fileRecordId: string,
      sourceRootId: string,
      sourceRelativePath: CanonicalRelativePath,
      stableFileIdentity: string,
      strongContentFingerprint: Digest,
      byteSize: uint64,
      noFollow: true,
      identityVerifiedAt: timestamp
    }
  | {
      visibility: "redacted",
      selectionId: string,
      sessionId: string,
      sessionMembershipOrdinal: uint32,
      frameId: string,
      sourceState: "indexed_readable"
    }
```

`failureCode` and `failureDetail` are present only when an operation is
`failed`. The detail is bounded by `SafeText` and follows the shared redaction
and anti-enumeration rules; it never contains paths, stable file identities,
fingerprints, SQL, or operating-system messages.

A snapshot contains every frame membership from every selected session. Every
selected session is all-or-nothing: creation is refused unless every member
frame is indexed, readable, and strongly verified. Candidate display retains
the narrower `sufficient` rule of at least one readable frame. The application
does not exclude individual frames or sessions by scientific quality. The
external processor owns calibration, stacking, and scientific frame rejection.

Every frame pins a source root, canonical relative path, stable file identity,
byte size, and strong content fingerprint. An opaque path or optional
fingerprint is not a handoff identity. The trusted core resolves each path
component from the pinned root with no-follow semantics. It rejects symlinks,
junctions, reparse points, mount escapes, and a changed root or file identity.

Snapshots and their selection evidence are immutable. A reviewed addition
creates a successor snapshot. Later session ingestion, metadata resolution,
settings updates, and source availability changes do not edit an existing
snapshot.

Selections, their candidate evidence, reviews, and verified frame identities
are immutable stable records. Successor snapshots reference retained selection
IDs through ordered mappings and add only the new selection mapping. They do
not duplicate retained frame rows; snapshot frame queries resolve through the
mapping.

## Queries

All list requests use `{ limit: uint16, cursor?: OpaqueCursor }` as `page`, with
`limit` from 1 through 500. A cursor is bound to the command name, caller-visible
filters, sort direction, authorization projection, and query watermark. Changing
any bound value requires a new first-page request.

`calibration.candidate.list` establishes a watermark from `asOf`, the canonical
requirement digest, its recipe revision, the matching-settings revision, and the
source-availability projection revision. Every continuation must use that exact
watermark. A changed availability projection refuses the continuation with
`calibration.page_stale`; the caller restarts from the first page. This prevents
a continuation from silently mixing candidate evaluations from different
availability states.

The handoff requirement, selection, and frame lists use the immutable
`snapshotId` as their data watermark. Their cursors also bind the optional
`requirementId` or `selectionId` filter. Cursor state contains the last complete
sort key. Continuation uses a strict keyset comparison and never an offset.

### `calibration.candidate.list`

- Type: read-only.
- Request: `{ requirement, asOf, automaticEligibility?, page }`.
- Response: `Page<CalibrationCandidateEvidence>`.
- Guard: `requirement.kind` must be `dark`, `bias`, or `flat`.
- Effect: each result is evaluated against the named recipe revision and the settings revision active at `asOf`.
- Total order: compatibility rank ascending, sufficiency rank ascending,
  observing night descending, creation timestamp descending, then session ID
  ascending. Compatibility ranks are compatible `0`, unknown `1`, and
  incompatible `2`. Sufficiency ranks are true `0` and false `1`. The final
  session ID is the unique tie-breaker.
- Notes: read-only evaluation does not reserve or select a session.

### `calibration.handoff.query`

- Type: read-only.
- Request: `{ handoffId, snapshotId?: string }`.
- Response: `CalibrationHandoffSnapshot`.
- Errors: `calibration.handoff_not_found`.

### `calibration.handoff.requirement.list`

- Type: read-only.
- Request: `{ snapshotId, page }`.
- Response: `Page<CalibrationRequirement>`.
- Total order: `requirementId` ascending. Requirement ID is unique within the
  snapshot.

### `calibration.handoff.selection.list`

- Type: read-only.
- Request: `{ snapshotId, requirementId?, page }`.
- Response: `Page<CalibrationSelection>`.
- Total order: `selectedAt` ascending, then `selectionId` ascending. Selection
  ID is the unique tie-breaker.

### `calibration.handoff.frame.list`

- Type: read-only.
- Request: `{ snapshotId, selectionId?, page }`.
- Response: `Page<CalibrationHandoffFrame>`.
- Total order: `selectionId` ascending, session membership ordinal ascending,
  then `frameId` ascending. The tuple is unique because an immutable selection
  references each session membership ordinal once.
- Security: callers with local source authorization receive the `authorized`
  response variant. Other callers receive the `redacted` variant without file
  record IDs, source roots, paths, stable identities, sizes, verification
  timestamps, or fingerprints. A cursor is bound to this projection and cannot
  be replayed across authorization variants.

### `calibration.handoff.operation.query`

- Type: read-only execution query.
- Request: `{ operationId }`.
- Response: `CalibrationHandoffOperation`.
- Guard: project and source authorization use the shared anti-enumeration policy.

### `calibration.handoff.cancel`

- Type: authorized idempotent execution control.
- Request: `{ operationId, mutationContext }`.
- Response: `CalibrationHandoffOperation`.
- Effect: hashing checks cancellation at least every 8 MiB and every 100
  milliseconds. Cancellation reaches `cancelled` within one second, records one
  audit result, and commits no handoff snapshot.

## Commands

### `calibration.handoff.create`

- Type: asynchronous verification with one final atomic database commit.
- Request: `{ projectId, externalProcessor, requirements: BoundedList<CalibrationRequirement, 100>, expectedProjectRevision, mutationContext }`.
- Response: `{ operation: CalibrationHandoffOperation }`.
- Guard: each requirement must name an accepted recipe revision with complete required evidence.
- Effect: the trusted core captures `evaluationAt` from its clock and evaluates
  candidate evidence once at that instant. Caller input cannot set it.
- Effect: each requirement selects the newest compatible, sufficient, automatically eligible session.
- Effect: deterministic ordering uses observing night descending, creation timestamp descending, then session ID ascending.
- Effect: each requirement receives at most one automatic selection.
- Effect: a requirement with no automatically eligible candidate remains unselected and adds `calibration.no_automatic_candidate` to snapshot warnings.
- Effect: a flat requirement automatically selects only a same-observing-night
  candidate. A cross-night candidate remains available for reviewed addition
  with its fresh, yellow, or red observing-night age evidence.
- Effect: the command records all selected-session frame memberships without scientific-quality filtering.
- Guard: the selected sessions contain at most 17,592,186,044,416 aggregate
  source bytes. A larger handoff or one individually larger session is refused
  before hashing with `calibration.handoff_too_large`.
- Guard: every frame in every selected session must be indexed and readable.
  One unavailable or unreadable member refuses the complete snapshot.
- Effect: before commit, the core captures every frame's pinned identity and
  opens it once through no-follow root-relative resolution. It hashes the bytes
  read through that handle and records the resulting strong fingerprint. A
  batch contains at most 100
  requirements and 500 selections; frame membership is streamed into storage
  in bounded chunks of at most 500 records.
- Effect: no calibration master is constructed or revised.
- Idempotency: replay returns the same recorded operation response. After an
  applied terminal response, the caller reads immutable selections and evidence
  through the snapshot's paginated queries.

### `calibration.handoff.reviewed_add`

- Type: asynchronous verification with one final atomic successor commit.
- Request: `{ handoffId, snapshotId, expectedHandoffHeadGeneration, sessionId, requirementId, expectedSnapshotBasisFingerprint: Digest, evidenceId, decisionReason: SafeText, acknowledgedWarningCodes: BoundedList<string, 100>, mutationContext }`.
- Response: `{ operation: CalibrationHandoffOperation }`.
- Guard: the source snapshot, requirement, session, and evidence must exist.
- Guard: the source snapshot and expected generation must still be the handoff
  head; a stale successor attempt is refused by CAS.
- Guard: the evidence basis must match the source snapshot basis and requirement recipe revision.
- Guard: the candidate must be compatible and sufficient.
- Guard: candidate recipe evidence must be complete.
- Guard: `decisionReason` must be non-empty.
- Guard: every candidate warning code must be acknowledged.
- Guard: the session must not already be selected for the requirement.
- Effect: a reviewed selection is appended in an immutable successor snapshot.
- Effect: red age, red regulated-dark thermal state, unregulated temperature
  mode, cross-night flat age, flat physical-orientation state, and
  compatibility-unverified orientation remain visible in evidence and
  warnings.
- Effect: the automatic selection and prior reviewed selections remain unchanged.
- Effect: every frame membership from the added session is included without scientific-quality filtering.
- Guard: every frame in the added session must be indexed and readable. One
  unavailable or unreadable member refuses the successor snapshot.
- Guard: the successor's aggregate source bytes must remain at or below
  17,592,186,044,416. The complete addition is refused above the ceiling.
- Effect: frame identities and strong fingerprints are verified before the
  successor snapshot commits. Each frame is opened once through no-follow
  root-relative resolution and hashed through that handle. Membership is
  streamed in chunks of at most 500 records.
- Effect: the same fenced operation, progress query, 8-MiB/100-millisecond
  cancellation checkpoints, and one-second cancellation deadline as creation
  apply to the reviewed addition. Cancellation commits no successor or head.
- Effect: verification runs outside the writer transaction. The final
  `BEGIN IMMEDIATE` transaction revalidates the source snapshot and head
  generation, inserts the successor snapshot and review, advances the head by
  CAS, and commits audit, outbox, and terminal result atomically.
- Effect: progress is coalesced to at most ten updates per second and announces
  verification, cancellation, failure, or the applied snapshot ID.
- Effect: no calibration master is constructed or revised.
- Idempotency: replay returns the same successor snapshot and review ID.

### `calibration.handoff.open_frame`

- Type: trusted local read operation.
- Request: `{ snapshotId, frameId }`.
- Response: a bounded local stream handle and `{ byteSize, strongContentFingerprint }`.
- Guard: the caller must be authorized for the project and local source root.
- Guard: root identity, component-by-component no-follow resolution, stable file
  identity, and byte size must match the immutable frame record.
- Guard: bytes are consumed and hashed through the same opened handle returned
  to the external processor. A final digest mismatch aborts use and closes the
  handle; no reopened path is substituted.
- Effect: the operation never returns an absolute source path.

## Events

| Event | Payload |
|---|---|
| `calibration.handoff_created` | `{ projectId, handoffId, snapshotId, automaticSelectionIds: BoundedList<string, 100>, unselectedRequirementIds: BoundedList<string, 100>, warningCodes: BoundedList<string, 100> }` |
| `calibration.handoff_reviewed_selection_added` | `{ projectId, handoffId, predecessorSnapshotId, snapshotId, requirementId, selectionId, sessionId, reviewId, warningCodes: BoundedList<string, 100> }` |

## Error codes

| Code | Condition | Required details |
|---|---|---|
| `calibration.requirement_invalid` | A requirement has unsupported kind, incomplete evidence, an invalid recipe revision, or lacks its kind-specific camera, optical-profile, filter, target-session, or observing-night field. | `requirementId`, `fields: BoundedList<FieldError, 100>` |
| `calibration.candidate_not_found` | The session is not a candidate for the requirement. | `sessionId`, `requirementId` |
| `calibration.candidate_blocked` | Unknown compatibility, incomplete evidence, unknown dark temperature mode, unknown age, or insufficient source availability blocks selection. | `sessionId`, `requirementId`, `blockingCodes: BoundedList<string, 100>` |
| `calibration.handoff_too_large` | A handoff or one selected session exceeds the aggregate source-byte ceiling. | `handoffId?`, `sessionId?`, `sourceByteCount`, `maximumSourceBytes` |
| `calibration.handoff_operation_not_cancellable` | Verification is terminal or inside its bounded final commit. | `operationId`, `state`, `cancelSafe` |
| `calibration.candidate_incompatible` | Recipe evidence is complete and incompatible. | `sessionId`, `requirementId`, `evidenceId` |
| `calibration.warning_unacknowledged` | Reviewed selection omits a candidate warning acknowledgement. | `sessionId`, `warningCodes: BoundedList<string, 100>` |
| `calibration.selection_duplicate` | The session is already selected for the requirement. | `snapshotId`, `sessionId`, `requirementId` |
| `calibration.handoff_not_found` | The handoff ID is unknown, or the optional snapshot does not belong to it. | `handoffId`, `snapshotId?` |
| `calibration.handoff_stale_basis` | The expected fingerprint differs from the source snapshot basis. | `snapshotId`, `expectedBasisFingerprint`, `actualBasisFingerprint` |
| `calibration.source_unavailable` | At least one selected-session frame is not indexed, available, and readable. | `sessionId`, `frameId`, `evidenceId` |
| `calibration.source_identity_changed` | A pinned source root, file identity, size, or strong fingerprint does not match. | `snapshotId`, `frameId`, `fileRecordId` |
| `calibration.page_invalid` | A cursor is malformed or does not match the command, filters, projection, sort, or watermark supplied by the request. | `field: "page.cursor"` |
| `calibration.page_stale` | The source-availability projection changed after the candidate-list watermark was established. | `expectedProjectionRevision`, `actualProjectionRevision` |

## Audit expectations

- Handoff creation records the recipe revisions, settings revision, candidate evidence IDs, deterministic ordering basis, automatic selections, and unselected requirements.
- Reviewed addition records the predecessor and successor snapshot IDs, evidence ID, decision reason, reviewer, and acknowledged warnings.
- Refused selection records the blocking or unacknowledged warning codes without creating a successor snapshot.
- Audit entries reference frame and source evidence by identifier. They do not duplicate paths or metadata.
