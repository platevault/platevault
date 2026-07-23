# Inbox Planning and Session Materialization Contracts

This surface reviews indexed frame evidence and creates immutable sessions.
Folder and library-root locations remain provenance. They never participate in
session identity, partitioning, retry identity, or relation matching.

## DTOs

### `InboxMaterializationPlan`

```text
InboxMaterializationPlan {
  planId: string,
  planRevision: uint64,
  state: "open" | "approved" | "applied" | "discarded" | "stale" | "refused",
  canonicalPlanDigest: Digest,
  inputEvidenceRevision: uint64,
  configurationRevisionId: string,
  acquisitionSiteResolutionCount: uint64,
  planResultSnapshotId: string,
  candidateFrameCount: uint64,
  proposedSessionCount: uint64,
  blockedFrameCount: uint64,
  warningCodes: BoundedList<string, 100>,
  createdAt: timestamp,
  createdBy: string,
  approvedAt?: timestamp,
  approvedBy?: string
}
```

`canonicalPlanDigest` covers the plan revision, exact input evidence revisions,
the complete ordered set of selected acquisition-site resolution IDs and
revisions, configuration revision, proposed partitions, and warnings. Approval
and application use this digest. A changed input produces a new plan revision
and digest.

### `AcquisitionSiteResolution`

```text
AcquisitionSiteResolution {
  resolutionId: string,
  revision: uint64,
  state: "needs_review" | "resolved" | "conflict",
  selectedSiteId?: string,
  selectedTimezone?: string,
  decision: "unresolved" | "accepted_candidate" | "corrected" |
            "reviewed_local_fallback",
  timestampDecision?: "canonical_instant_confirmed" |
                      "reviewed_local_fallback",
  canonicalExposureInstant?: timestamp,
  localExposureTimestamp?: timestamp,
  derivedObservingNight?: date,
  conflictCodes: BoundedList<string, 100>,
  evidenceRefs: BoundedList<string, 100>,
  decidedAt?: timestamp,
  decidedBy?: string
}

AcquisitionSiteCandidate {
  siteId: string,
  label: SafeText,
  timezone: string,
  confidence: "exact" | "review",
  basisCodes: BoundedList<string, 100>,
  evidenceRefs: BoundedList<string, 100>,
  derivedObservingNight: date,
  conflictCodes: BoundedList<string, 100>
}
```

Candidate ordering is deterministic. An automatic candidate remains a
candidate until a reviewer selects it. Materialization requires a resolved
selection.

Timestamp interpretation follows these rules:

- A profile-defined canonical UTC exposure instant, commonly `DATE-OBS`, is
  converted through the selected site's IANA timezone rules for the exposure
  date.
- A profile-defined local timestamp, commonly `DATE-LOC`, corroborates the
  converted local time. It does not replace a known canonical instant.
- A local timestamp may be the reviewed source only when the canonical instant
  or confirmed site timezone is unavailable.
- A disagreement that changes the local noon-to-noon observing-night bucket
  sets state `conflict`. A reviewer must correct the site, timezone, or
  timestamp evidence before approval.
- The machine timezone, fixed UTC offsets, sidereal time, and apparent solar
  noon are not fallback inputs.

### `SessionMaterializationOperation`

```text
SessionMaterializationOperation {
  operationId: string,
  kind: "inbox_ingestion" | "metadata_reclassification",
  state: "ready" | "applying" | "cancelling" | "cancelled" | "applied" | "failed",
  sourcePlanId: string,
  approvedPlanDigest: Digest,
  resultSnapshotId?: string,
  sessionCount: uint64,
  frameMembershipCount: uint64,
  singletonPanelGroupCount: uint64,
  blockedFrameCount: uint64,
  startedAt?: timestamp,
  finishedAt?: timestamp,
  failureCode?: string
}

MaterializationResultSession {
  ordinal: uint64,
  sessionId: string,
  frameKind: "light" | "dark" | "bias" | "flat",
  frameCount: uint64,
  singletonPanelGroupId?: string,
  singletonPanelRevisionId?: string
}

InboxProposedSession {
  ordinal: uint64,
  proposedSessionKey: string,
  frameKind: "light" | "dark" | "bias" | "flat",
  proposedIdentityDigest: Digest,
  proposedFrameCount: uint64,
  acquisitionSiteResolutionId: string,
  acquisitionSiteResolutionRevision: uint64,
  warningCodes: BoundedList<string, 100>
}

SessionMaterializationProgress {
  operationId: string,
  state: "ready" | "applying" | "cancelling" | "cancelled" | "applied" | "failed",
  processedSessionCount: uint64,
  totalSessionCount: uint64,
  processedFrameCount: uint64,
  totalFrameCount: uint64,
  cancelSafe: boolean,
  updatedAt: timestamp
}
```

The plan-result snapshot is immutable for one plan revision. It contains every
proposed partition and blocked frame reviewed before approval. Each proposed
session pins one acquisition-site resolution revision. Mixed-site or mixed-
timezone inputs use separate resolutions within the same plan; no plan-level
site choice applies across heterogeneous partitions.

The result snapshot is immutable and belongs to one terminal operation. Its
ordered child queries return the exact output without embedding a capped list
in a response, event, or audit record.

## Queries

### `inbox.materialization_plan.query`

- Type: read-only.
- Request: `{ planId, planRevision?: uint64 }`.
- Response: `InboxMaterializationPlan`.
- Errors: `inbox.plan_not_found`.

### `inbox.acquisition_site_resolution.query`

- Type: read-only.
- Request: `{ planId, resolutionId, resolutionRevision?: uint64 }`.
- Response: `AcquisitionSiteResolution`.
- Errors: `inbox.plan_not_found`, `inbox.site_resolution_not_found`.

### `inbox.acquisition_site_candidate.list`

- Type: read-only.
- Request: `{ planId, resolutionId, resolutionRevision, page }`.
- Response: `Page<AcquisitionSiteCandidate>`.
- Sort: confidence rank descending, normalized label ascending, then `siteId`
  ascending.
- Errors: `inbox.plan_not_found`, `inbox.site_resolution_not_found`.

### `inbox.materialization_plan.proposed_session.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, page }`.
- Response: `Page<InboxProposedSession>`.
- Sort: `ordinal` ascending, then `proposedSessionKey` ascending.
- Errors: `inbox.plan_not_found`, `inbox.plan_result_snapshot_not_found`.

### `inbox.materialization_plan.proposed_frame.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, proposedSessionKey, page }`.
- Response: `Page<{ ordinal: uint64, frameId: string }>`.
- Sort: `ordinal` ascending, then `frameId` ascending.
- Errors: `inbox.plan_not_found`, `inbox.plan_result_snapshot_not_found`, `inbox.proposed_session_not_found`.

### `inbox.materialization_plan.blocked_frame.list`

- Type: read-only.
- Request: `{ planId, planResultSnapshotId, page }`.
- Response: `Page<{ ordinal: uint64, frameId: string, reasonCodes: BoundedList<string, 100> }>`.
- Sort: `ordinal` ascending, then `frameId` ascending.
- Errors: `inbox.plan_not_found`, `inbox.plan_result_snapshot_not_found`.

### `session.materialization.query`

- Type: read-only.
- Request: `{ operationId }`.
- Response: `SessionMaterializationOperation`.
- Errors: `materialization.operation_not_found`.

### `session.materialization.result_session.list`

- Type: read-only.
- Request: `{ operationId, resultSnapshotId, page }`.
- Response: `Page<MaterializationResultSession>`.
- Sort: `ordinal` ascending, then `sessionId` ascending.
- Errors: `materialization.operation_not_found`, `materialization.result_snapshot_not_found`.

### `session.materialization.result_frame.list`

- Type: read-only.
- Request: `{ operationId, resultSnapshotId, sessionId, page }`.
- Response: `Page<{ ordinal: uint64, frameId: string }>`.
- Sort: `ordinal` ascending, then `frameId` ascending.
- Errors: `materialization.operation_not_found`, `materialization.result_snapshot_not_found`, `session.not_found`.

### `session.materialization.blocked_frame.list`

- Type: read-only.
- Request: `{ operationId, resultSnapshotId, page }`.
- Response: `Page<{ ordinal: uint64, frameId: string, reasonCodes: BoundedList<string, 100> }>`.
- Sort: `ordinal` ascending, then `frameId` ascending.
- Errors: `materialization.operation_not_found`, `materialization.result_snapshot_not_found`.

### `session.materialization.progress.query`

- Type: read-only execution query.
- Request: `{ operationId }`.
- Response: `SessionMaterializationProgress`.
- Guard: the caller has the same Inbox authorization required by the source plan.
- Cadence: progress is coalesced to at most ten updates per second and updates
  at least every 500 milliseconds outside the final transaction.

### `session.materialization.cancel`

- Type: authorized idempotent execution control.
- Request: `{ operationId, mutationContext }`.
- Response: `SessionMaterializationProgress`.
- Effect: requests cancellation under the current command fence. Work checks it
  at least every 256 frames and every 100 milliseconds outside commit.
- Effect: cancellation before commit produces `cancelled`, one audit entry, and
  no session, membership, group, result-snapshot, or success-event row.
- Deadline: cancellation reaches a terminal state within one second unless the
  bounded final transaction has begun. During that transaction `cancelSafe` is
  false, and the transaction completes or rolls back within the acceptance limit.

## Commands

### `inbox.acquisition_site_resolution.decide`

- Type: database mutation.
- Request: `{ planId, resolutionId, expectedPlanRevision, expectedResolutionRevision, decision: { selectedSiteId?, correctedTimezone?, timestampDecision, evidenceRefs: BoundedList<string, 100>, note: SafeText }, mutationContext }`.
- Response: `{ plan: InboxMaterializationPlan, resolution: AcquisitionSiteResolution, auditId }`.
- Guard: the selected site must exist and its timezone must be a valid IANA
  name effective on every candidate exposure date.
- Guard: local fallback requires explicit review, a local timestamp for every
  affected frame, no usable canonical instant, and a non-whitespace note.
- Guard: a canonical-instant decision requires the reviewer to acknowledge
  every conflicting local-timestamp evidence reference.
- Guard: unresolved timestamp conflicts cannot produce state `resolved`.
- Effect: the decision creates a new resolution and plan revision.
- Effect: the new plan digest binds the selected site and timestamp evidence.

### `inbox.materialization.approve`

- Type: atomic database mutation.
- Request: `{ planId, expectedPlanRevision, expectedInputEvidenceRevision, expectedSiteResolutionRevisionsDigest, mutationContext }`.
- Response: `{ planId, planRevision, approvedPlanDigest, approvedAt, auditId }`.
- Guard: `mutationContext.approvalDigest` must equal `canonicalPlanDigest`.
- Guard: the plan must be `open` and every proposed session's pinned site
  resolution must be `resolved`.
- Guard: every input evidence revision and configuration revision must still
  match the preview.
- Effect: approval freezes the exact plan revision and digest.

### `inbox.materialization.apply`

- Type: asynchronous database mutation with one final atomic commit.
- Request: `{ planId, expectedPlanRevision, mutationContext }`.
- Response: `{ operation: SessionMaterializationOperation, auditId }`.
- Guard: `mutationContext.approvalDigest` must equal the approved plan digest.
- Guard: the plan must be `approved` and all approval-bound revisions must
  remain unchanged.
- Effect: one `inbox_ingestion` materialization operation records the approved
  plan digest.
- Effect: sessions, exact frame memberships, the immutable result snapshot,
  audit success, and outbox events commit in one transaction.
- Effect: every materialized light session receives one singleton panel group
  and initial accepted revision in the same transaction.
- Effect: calibration sessions do not receive panel groups.
- Idempotency: repeating `commandId` with the same canonical request and actor
  returns the recorded operation and result snapshot.
- Failure: a validation, concurrency, or database failure creates no session,
  frame membership, group, result snapshot, success audit, or success event.
- Failure: an unexpected error may record the operation as `failed` with a
  safe failure code and failed audit entry.

### `inbox.materialization.discard`

- Type: database mutation.
- Request: `{ planId, expectedPlanRevision, mutationContext }`.
- Response: `{ planId, state: "discarded", auditId }`.
- Guard: only an `open` or `approved` plan with no applied operation may be
  discarded.
- Effect: no session or relation changes.

## Events

| Event | Payload |
|---|---|
| `inbox.acquisition_site_resolved` | `{ planId, resolutionId, revision, selectedSiteId?, selectedTimezone?, decision, derivedObservingNight }`; timezone is present only for a timezone-based decision |
| `inbox.materialization_approved` | `{ planId, planRevision, approvedPlanDigest }` |
| `session.materialization_progressed` | `{ operationId, processedSessionCount, totalSessionCount, processedFrameCount, totalFrameCount }` |
| `session.materialization_cancelled` | `{ operationId, sourcePlanId }` |
| `session.materialization_applied` | `{ operationId, kind, sourcePlanId, approvedPlanDigest, resultSnapshotId, sessionCount, frameMembershipCount, singletonPanelGroupCount, blockedFrameCount }` |
| `session.materialization_failed` | `{ operationId, kind, sourcePlanId, failureCode }` |
| `inbox.materialization_discarded` | `{ planId }` |

Per-session events may carry one session and its singleton identifiers. The
operation event remains bounded regardless of output size.

## Error codes

| Code | Condition | Required details |
|---|---|---|
| `inbox.plan_not_found` | The plan ID or requested revision is unknown. | `planId`, `planRevision` |
| `inbox.plan_not_open` | A decision or approval requires an open plan. | `planId`, `state` |
| `inbox.plan_not_approved` | Apply requires an approved plan. | `planId`, `state` |
| `inbox.plan_digest_mismatch` | The supplied approval digest differs from the plan digest. | `planId`, `expectedDigest`, `actualDigest` |
| `inbox.plan_stale` | Approval-bound input, configuration, or site evidence changed. | `planId`, `staleRevisionCount`, `decisionSnapshotId` |
| `inbox.site_resolution_not_found` | The site-resolution revision is unknown. | `planId`, `resolutionRevision` |
| `inbox.plan_result_snapshot_not_found` | The plan-result snapshot is unknown or does not belong to the plan revision. | `planId`, `planResultSnapshotId` |
| `inbox.proposed_session_not_found` | The proposed-session key is unknown in the plan-result snapshot. | `planId`, `planResultSnapshotId`, `proposedSessionKey` |
| `inbox.site_selection_required` | No reviewed acquisition-site decision exists. | `planId`, `resolutionId` |
| `inbox.site_timezone_invalid` | The selected timezone is absent or is not a valid IANA name. | `planId`, `siteId` |
| `inbox.timestamp_conflict` | UTC and local evidence produce different observing-night buckets. | `planId`, `conflictCount`, `decisionSnapshotId` |
| `materialization.operation_not_found` | The operation ID is unknown. | `operationId` |
| `materialization.result_snapshot_not_found` | The result snapshot is unknown or does not belong to the operation. | `operationId`, `resultSnapshotId` |

## Audit expectations

- Site decisions record the selected site, timezone, decision kind, evidence
  references, and actor reason.
- Approval records the plan revision and approved digest.
- Apply records the operation ID, result snapshot ID, and exact output counts.
- Refused and failed attempts record safe error codes without source paths or
  raw metadata.
- Result-child queries provide the exact ordered session, membership, group,
  and blocked-frame references named by the audit counts.
