# Metadata, Equipment Resolution, and Reclassification Contracts

This surface resolves captured metadata against registered equipment. It also
reclassifies identity by creating replacement sessions instead of editing
accepted sessions.

## DTOs

### `MetadataEvidence`

```text
MetadataEvidence {
  evidenceId: string,
  sessionId: string,
  revision: uint64,
  captureSoftware?: string,
  fields: BoundedList<
    {
      canonicalField: string,
      sourceField: string,
      rawValue?: SafeText,
      normalizedValue?: MetadataValue,
      state: "known" | "absent" | "invalid" | "contradictory",
      confidence: "confirmed" | "reported" | "calculated"
    }
  , 256>,
  observingNight: {
    value?: date,
    timezone?: string,
    canonicalInstant?: timestamp,
    localTimestamp?: timestamp,
    state: "confirmed" | "timezone_missing" | "contradictory"
  }
}

MetadataValue = scalar | SafeText |
  BoundedList<MetadataValue, 256> |
  BoundedList<{ key: string, value: MetadataValue }, 128>
```

`MetadataValue` is limited to 8 nested collection levels and the shared
256-KiB canonical payload limit. Object keys are unique after canonical Unicode
normalization and contain at most 128 Unicode scalar values.

Capture-software profiles map representative camera, telescope, filter,
focal-length, physical-rotator, and sky-orientation fields. A profile may add
source fields without changing canonical field names.

### `EquipmentResolution`

```text
EquipmentResolution {
  resolutionId: string,
  sessionId: string,
  revision: uint64,
  state: "resolved" | "needs_review" | "blocked",
  camera: ResolutionChoice<CameraCandidate>,
  opticalProfile: ResolutionChoice<OpticalProfileCandidate>,
  warnings: BoundedList<ResolutionWarning, 100>,
  evidenceRevision: uint64,
  decidedAt?: timestamp,
  decidedBy?: string
}

ResolutionChoice<T> {
  selectedId?: string,
  candidates: BoundedList<T, 100>,
  basis: BoundedList<string, 100>,
  decision: "automatic" | "accepted" | "corrected" | "unresolved"
}

CameraCandidate {
  cameraId: string,
  displayName: string,
  matchedAliases: BoundedList<string, 100>,
  geometryCompatible: boolean,
  confidence: "exact" | "review"
}

OpticalProfileCandidate {
  opticalProfileId: string,
  displayName: string,
  reportedFocalLengthMm?: decimal,
  calculatedFocalLengthMm?: decimal,
  representativeFocalLengthMm: decimal,
  representativeDifferencePercent?: decimal,
  reportedCalculatedDifferencePercent?: decimal,
  classification: "same" | "review" | "different"
}

ResolutionWarning {
  code: string,
  severity: "yellow" | "red",
  field?: string,
  evidenceRefs: BoundedList<string, 100>
}

SessionIdentity {
  frameKind: "light" | "dark" | "bias" | "flat",
  observingNight: date,
  acquisitionTimezone?: string,
  nightDerivation: "acquisition_timezone" | "reviewed_local_fallback",
  nightEvidenceRefs: BoundedList<string, 100>,
  canonicalTargetId?: string,
  cameraId?: string,
  opticalProfileId?: string,
  filter: MetadataValue,
  exposureMs: MetadataValue,
  gain: MetadataValue,
  offset: MetadataValue,
  binningX: MetadataValue,
  binningY: MetadataValue,
  readoutMode: MetadataValue,
  rasterWidth: uint32,
  rasterHeight: uint32
}
```

`acquisitionTimezone` is required for `acquisition_timezone` derivation and
absent for `reviewed_local_fallback`. A fallback retains the reviewed local-time
evidence references and cannot invent a timezone.

Optical-profile classification is `same` at a representative difference of at
most 5 percent, `review` above 5 through 10 percent, and `different` above 10
percent. Reported-versus-calculated disagreement above 10 percent requires
review.

### `ReclassificationPlan`

```text
ReclassificationPlan {
  planId: string,
  planRevision: uint64,
  state: "open" | "applied" | "discarded" | "stale" | "refused",
  sourceSessionId: string,
  sourceSessionEvidenceRevision: uint64,
  requestedCorrections: BoundedList<
    { canonicalField: string, correctedValue: MetadataValue | null, evidenceRefs: BoundedList<string, 100> }
  , 256>,
  planResultSnapshotId: string,
  replacementSessionCount: uint64,
  panelConsequenceCount: uint64,
  predecessorGroupRetirementCount: uint64,
  panelLineageCount: uint64,
  staleMosaicEdgeCount: uint64,
  projectConsequenceCount: uint64,
  warnings: BoundedList<ResolutionWarning, 100>,
  createdAt: timestamp,
  createdBy: string
}

ReclassificationProjectConsequence {
  projectId: string,
  unchangedPinnedSessionId: string,
  replacementSessionCount: uint64,
  proposalRequired: true,
  projectReplacementProposalId?: string
}

ReclassificationReplacementSession {
  replacementKey: string,
  frameCount: uint64,
  proposedIdentity: SessionIdentity,
  proposedEquipmentResolution: EquipmentResolution
}

ReclassificationPanelConsequence {
  panelGroupId: string,
  sourceRevisionId: string,
  proposedDestinationPanelGroupId: string,
  proposedDestinationRevisionId: string,
  proposedSessionCount: uint64,
  predecessorGroupRetirementCount: uint64,
  lineageEdgeCount: uint64,
  action: "successor_revision" | "new_group" | "review_required"
}

ReclassificationPanelLineage {
  predecessorPanelGroupId: string,
  successorPanelGroupId: string,
  kind: "identity_change"
}

ReclassificationStaleMosaicEdge {
  mosaicId: string,
  mosaicRevisionId: string,
  edgeId: string,
  reasonCode: string
}

ReclassificationApplyResult {
  applyResultSnapshotId: string,
  replacementSessionCount: uint64,
  acceptedPanelRevisionCount: uint64,
  retiredPredecessorGroupCount: uint64,
  panelLineageCount: uint64,
  invalidatedMosaicEdgeCount: uint64,
  projectReplacementProposalCount: uint64
}
```

`planResultSnapshotId` names the immutable, ordered result calculated for the
plan revision. The child queries return every replacement, panel consequence,
destination identity, predecessor retirement, lineage edge, stale edge, and
unchanged project pin without truncation. The counts must equal the number of
rows reachable through those queries.

Each panel consequence preallocates its destination group and revision public
IDs. `successor_revision` uses the source group as its destination group.
`new_group` uses a distinct destination group and records every retired
predecessor plus an `identity_change` lineage edge to that destination.
`review_required` also retains its proposed IDs and topology preview, but it
cannot be applied until a later plan revision resolves the review.

The metadata reclassification aggregate owns plan state and is the sole writer
for replacement sessions, supersession links, and successor panel revisions.
It creates project replacement proposals but does not change project pins. It
marks incident mosaic edges stale but does not accept replacement mosaic
relations. Relation-proposal commands cannot duplicate these owned writes.

## Queries

### `metadata.evidence.query`

- Type: read-only.
- Request: `{ sessionId, evidenceRevision?: uint64 }`.
- Response: `MetadataEvidence`.
- Errors: `session.not_found`, `metadata.evidence_not_found`.

### `equipment.resolution.query`

- Type: read-only.
- Request: `{ sessionId, resolutionRevision?: uint64 }`.
- Response: `EquipmentResolution`.
- Errors: `session.not_found`, `equipment.resolution_not_found`.

### `metadata.reclassification.query`

- Type: read-only.
- Request: `{ planId }`.
- Response: `ReclassificationPlan`.
- Errors: `reclassification.plan_not_found`.

### `metadata.reclassification.replacement_frame.list`

- Type: read-only.
- Request: `{ planId, replacementKey, page }`.
- Response: `Page<{ frameId: string, ordinal: uint32 }>`.
- Sort: `ordinal` ascending, then `frameId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.replacement_not_found`.

### `metadata.reclassification.replacement_session.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, page }`.
- Response: `Page<ReclassificationReplacementSession>`.
- Sort: persisted result ordinal ascending, then `replacementKey` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.result_snapshot_not_found`.

### `metadata.reclassification.panel_consequence.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, page }`.
- Response: `Page<ReclassificationPanelConsequence>`.
- Sort: persisted result ordinal ascending, then `panelGroupId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.result_snapshot_not_found`.

### `metadata.reclassification.panel_consequence_session.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, panelGroupId, page }`.
- Response: `Page<{ proposedSessionId: string, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `proposedSessionId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.result_snapshot_not_found`, `reclassification.panel_consequence_not_found`.

### `metadata.reclassification.panel_consequence_retirement.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, proposedDestinationPanelGroupId, page }`.
- Response: `Page<{ predecessorPanelGroupId: string, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `predecessorPanelGroupId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.result_snapshot_not_found`, `reclassification.panel_consequence_not_found`.

### `metadata.reclassification.panel_consequence_lineage.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, proposedDestinationPanelGroupId, page }`.
- Response: `Page<{ lineage: ReclassificationPanelLineage, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `lineage.predecessorPanelGroupId` ascending,
  then `lineage.successorPanelGroupId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.result_snapshot_not_found`, `reclassification.panel_consequence_not_found`.

### `metadata.reclassification.stale_mosaic_edge.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, page }`.
- Response: `Page<ReclassificationStaleMosaicEdge>`.
- Sort: persisted result ordinal ascending, then `edgeId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.result_snapshot_not_found`.

### `metadata.reclassification.project_consequence.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, page }`.
- Response: `Page<ReclassificationProjectConsequence>`.
- Sort: `projectId` ascending, then `unchangedPinnedSessionId` ascending.
- Notes: after apply, each item exposes the proposal created for that project.
- Errors: `reclassification.plan_not_found`.

### `metadata.reclassification.project_consequence_replacement.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, projectId, unchangedPinnedSessionId, page }`.
- Response: `Page<{ replacementKey: string, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `replacementKey` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.result_snapshot_not_found`, `project.not_found`.

### `metadata.reclassification.apply_result.replacement_session.list`

- Type: read-only.
- Request: `{ planId, applyResultSnapshotId, page }`.
- Response: `Page<{ replacementSessionId: string, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `replacementSessionId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.apply_result_snapshot_not_found`.

### `metadata.reclassification.apply_result.panel_revision.list`

- Type: read-only.
- Request: `{ planId, applyResultSnapshotId, page }`.
- Response: `Page<{ revisionRef: RevisionRef, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `revisionRef.revisionId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.apply_result_snapshot_not_found`.

### `metadata.reclassification.apply_result.invalidated_edge.list`

- Type: read-only.
- Request: `{ planId, applyResultSnapshotId, page }`.
- Response: `Page<{ mosaicId: string, mosaicRevisionId: string, edgeId: string, reasonCode: string, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `edgeId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.apply_result_snapshot_not_found`.

### `metadata.reclassification.apply_result.retired_panel_group.list`

- Type: read-only.
- Request: `{ planId, applyResultSnapshotId, page }`.
- Response: `Page<{ panelGroupId: string, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `panelGroupId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.apply_result_snapshot_not_found`.

### `metadata.reclassification.apply_result.panel_lineage.list`

- Type: read-only.
- Request: `{ planId, applyResultSnapshotId, page }`.
- Response: `Page<{ lineage: ReclassificationPanelLineage, appliedReclassificationPlanRevisionId: string, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `lineage.predecessorPanelGroupId` ascending,
  then `lineage.successorPanelGroupId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.apply_result_snapshot_not_found`.

### `metadata.reclassification.apply_result.project_proposal.list`

- Type: read-only.
- Request: `{ planId, applyResultSnapshotId, page }`.
- Response: `Page<{ projectId: string, projectReplacementProposalId: string, unchangedPinnedSessionId: string, ordinal: uint64 }>`.
- Sort: `ordinal` ascending, then `projectReplacementProposalId` ascending.
- Errors: `reclassification.plan_not_found`, `reclassification.apply_result_snapshot_not_found`.

## Commands

### `equipment.resolution.decide`

- Type: database mutation.
- Request: `{ sessionId, expectedResolutionRevision, decision: { cameraId?, opticalProfileId?, markCameraUnregulated?: boolean, note }, mutationContext }`.
- Response: `{ resolution: EquipmentResolution, auditId }`.
- Guard: each selected equipment identity must be registered.
- Guard: `markCameraUnregulated` requires a selected camera and non-whitespace note.
- Guard: a flat requires an optical profile and normalized captured filter state.
- Guard: a dark without a cooling set point may not enter a regulated recipe.
- Effect: marking a camera unregulated affects suggestions created after the decision.
- Effect: accepted sessions and prior resolution records remain unchanged.
- Effect: unregulated darks remain ineligible for automatic master selection, build, and reuse.

### `metadata.reclassification.plan`

- Type: preview-generating database mutation.
- Request: `{ sessionId, expectedMetadataResolutionRevision, corrections: BoundedList<{ canonicalField: string, correctedValue: MetadataValue | null, evidenceRefs: BoundedList<string, 100> }, 256>, mutationContext }`.
- Response: `ReclassificationPlan`.
- Guard: at least one corrected field must change immutable identity or equipment resolution.
- Guard: corrected values must satisfy canonical field types and metadata-profile rules.
- Guard: dark-flat is not an accepted frame-kind correction.
- Effect: plan generation does not change sessions, groups, mosaics, or projects.
- Idempotency: repeating `commandId` returns the same plan and replacement keys.

### `metadata.reclassification.apply`

- Type: atomic database mutation.
- Request: `{ planId, expectedPlanRevision, expectedSourceSessionEvidenceRevision, expectedGroupHeadRevisionRefs: BoundedList<RevisionRef, 500>, mutationContext }`.
- Response: `{ plan: ReclassificationPlan, appliedReclassificationPlanRevisionId, predecessorSessionId, result: ReclassificationApplyResult, auditId }`.
- Guard: the plan must be `open`.
- Guard: source evidence and every affected group head must match the preview.
- Guard: each replacement contains only frames from the predecessor session.
- Guard: replacement frame sets are non-empty, disjoint, and cover the intended corrected membership.
- Guard: a successor panel revision may not contain predecessor and replacement together.
- Guard: every panel consequence must have an executable action; a
  `review_required` consequence refuses the whole apply.
- Guard: every previewed destination group and revision ID must still be
  available, and every previewed predecessor group must still be active at its
  expected head.
- Guard: previewed panel lineage must remain acyclic.
- Effect: replacement sessions and supersession links are append-only.
- Effect: the predecessor remains immutable and queryable.
- Effect: apply creates the exact previewed destination group and revision IDs,
  retires the exact previewed predecessor groups, and inserts the exact
  previewed `identity_change` lineage edges.
- Effect: each incident mosaic edge receives an immutable invalidation keyed by
  the edge and `appliedReclassificationPlanRevisionId`.
- Effect: invalidated edges become stale and require a later reviewed proposal.
- Effect: project pins remain unchanged.
- Effect: each affected project receives a separate replacement proposal.
- Effect: the apply-result snapshot and all ordered child rows are immutable.
- Effect: all changes commit in one transaction.

### `metadata.reclassification.discard`

- Type: database mutation.
- Request: `{ planId, expectedPlanRevision, mutationContext }`.
- Response: `{ planId, state: "discarded", auditId }`.
- Guard: only an `open` plan may be discarded.
- Effect: no session or relation changes.

## Calibration resolution rules

| Kind | Automatic resolution requirements |
|---|---|
| Dark | Registered camera, exact cooling set point or accepted unregulated mode, normalized exposure, exact gain, offset state/value, separate binning axes, optional readout state/value, and exact raster dimensions. |
| Bias | Registered camera, exact gain, offset state/value, separate binning axes, optional readout state/value, and exact raster dimensions. Exposure and temperature do not discriminate. |
| Flat | Optical profile, profile-scoped normalized captured filter label or explicit absent state, exact gain, offset state/value, separate binning axes, exact raster, optional readout state/value, camera geometry, and confirmed physical orientation evidence. Exposure does not discriminate. |

Dark exposure equivalence compares against one immutable representative. Its
tolerance is `max(1 ms, min(100 ms, 0.05% of representative exposure))`.
Matching never uses transitive chaining.

A dark with no cooling set point uses unknown temperature mode. It remains
blocked from automatic assignment, matching, building, and reuse until an
equipment decision marks the camera unregulated.

Dark-flat detection terminates before an Inbox item, session, resolution,
match, plan, or event in this contract can be created.

## Events

| Event | Payload |
|---|---|
| `equipment.resolution.decided` | `{ resolutionId, sessionId, revision, cameraId?, opticalProfileId?, decision }` |
| `equipment.camera_marked_unregulated` | `{ cameraId, effectiveAfter, resolutionId }` |
| `metadata.reclassification_planned` | `{ planId, sourceSessionId, planResultSnapshotId, replacementSessionCount, panelConsequenceCount, predecessorGroupRetirementCount, panelLineageCount, staleMosaicEdgeCount, projectConsequenceCount }` |
| `metadata.reclassification_applied` | `{ planId, appliedReclassificationPlanRevisionId, predecessorSessionId, applyResultSnapshotId, replacementSessionCount, acceptedPanelRevisionCount, retiredPredecessorGroupCount, panelLineageCount, invalidatedMosaicEdgeCount, projectReplacementProposalCount }` |
| `metadata.reclassification_discarded` | `{ planId }` |

## Error codes

| Code | Condition | Required details |
|---|---|---|
| `metadata.evidence_not_found` | The requested evidence revision is unknown. | `sessionId`, `evidenceRevision` |
| `metadata.identity_blocked` | Required identity metadata is absent or contradictory. | `sessionId`, `fieldStates: BoundedList<FieldState, 100>` |
| `metadata.observing_night_conflict` | Timestamp evidence changes the observing-night bucket. | `sessionId`, `evidenceRefs: BoundedList<string, 100>` |
| `equipment.resolution_not_found` | The requested resolution does not exist. | `sessionId`, `resolutionRevision` |
| `equipment.not_registered` | A selected equipment identity is unknown. | `equipmentType`, `equipmentId` |
| `equipment.optical_profile_review_required` | Focal-length evidence falls in a review range or conflicts. | `sessionId`, `differences: BoundedList<Difference, 100>` |
| `calibration.cooling_set_point_required` | A regulated dark lacks a cooling set point. | `sessionId`, `cameraId` |
| `calibration.flat_gain_required` | A flat has missing or ambiguous gain. | `sessionId`, `evidenceRefs: BoundedList<string, 100>` |
| `calibration.dark_flat_unsupported` | A dormant input receives dark-flat. | `sourceRecordId` |
| `reclassification.plan_not_found` | A plan ID is unknown. | `planId` |
| `reclassification.plan_not_open` | A plan is not open. | `planId`, `state` |
| `reclassification.plan_stale` | Evidence or an accepted group head changed. | `planId`, `staleRevisionCount`, `decisionSnapshotId` |
| `reclassification.invalid_partition` | Replacement frame membership is empty, overlaps, or is incomplete. | `planId`, `violationCount`, `decisionSnapshotId` |
| `reclassification.replacement_not_found` | A replacement key is unknown for the plan. | `planId`, `replacementKey` |
| `reclassification.panel_consequence_not_found` | The destination group ID is unknown in the plan-result snapshot. | `planId`, `planResultSnapshotId`, `proposedDestinationPanelGroupId` |
| `reclassification.result_snapshot_not_found` | The plan-result snapshot is unknown or does not belong to the plan revision. | `planId`, `planResultSnapshotId` |
| `reclassification.apply_result_snapshot_not_found` | The apply-result snapshot is unknown or does not belong to the applied plan revision. | `planId`, `applyResultSnapshotId` |

## Audit expectations

- Resolution decisions record candidate evidence and the selected equipment IDs.
- Unregulated-camera decisions record the warning and the actor's reason.
- Reclassification plans record correction fields without duplicating raw file paths.
- Reclassification apply records replacement, accepted revision, predecessor
  retirement, lineage, invalidated edge, and project-proposal counts with its
  immutable apply-result snapshot ID.
- Guard failure records one refused audit entry and emits no success event.
