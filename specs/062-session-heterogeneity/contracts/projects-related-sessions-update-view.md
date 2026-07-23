# Project Related-Session and Update View Contracts

Projects pin exact session identities. Group membership and relation changes
may produce suggestions but never add, replace, or remove a project pin.

## DTOs

### `RelatedSession`

```text
RelatedSession {
  projectId: string,
  sessionId: string,
  relationKind: "panel_sibling" | "mosaic_panel" | "session_replacement" |
                "reviewed_cross_target",
  relatedThroughSessionIds: BoundedList<string, 100>,
  panelGroupId?: string,
  mosaicId?: string,
  replacementForSessionId?: string,
  evidenceId: string,
  evidenceSummary: {
    targetCompatibility: string,
    footprintCoveragePercent?: decimal,
    centerSeparationPercent?: decimal,
    residualSkyRotationDeg?: decimal,
    equipmentCompatibility?: string,
    warningCodes: BoundedList<string, 100>
  },
  firstAvailableAt: timestamp,
  alreadyPinned: boolean
}
```

### `ProjectSessionPin`

```text
ProjectSessionPin {
  projectId: string,
  sessionId: string,
  pinRevision: uint64,
  pinnedAt: timestamp,
  pinnedBy: string,
  source: "explicit_add" | "explicit_replacement" | "project_creation",
  relatedSessionEvidenceId?: string,
  replacesSessionId?: string
}
```

### `ProjectViewState`

```text
ProjectViewState {
  projectId: string,
  projectRevision: uint64,
  lifecycle: "setup_incomplete" | "ready" | "prepared" | "processing" |
             "blocked" | "completed" | "archived",
  pinnedSessionCount: uint64,
  materializedSnapshotId?: string,
  currentManifestId?: string,
  currentManifestVersion?: uint64,
  materializedSessionCount: uint64,
  unmaterializedSessionCount: uint64,
  stale: boolean,
  sourceViewRevision?: uint64
}

ProjectManifest {
  manifestId: string,
  version: uint64,
  predecessorManifestId?: string,
  materializedSnapshotId: string,
  activeEntryCount: uint64,
  activeCorrectionOverlayCount: uint64,
  createdAt: timestamp
}

CorrectionOverlay {
  overlayId: string,
  predecessorOverlayId?: string,
  appliedReclassificationPlanRevisionId: string,
  mappingCount: uint64,
  createdAt: timestamp
}
```

### `UpdateViewPlan`

```text
UpdateViewPlan {
  planId: string,
  planRevision: uint64,
  projectId: string,
  state: "open" | "approved" | "applying" | "stopped" | "applied" |
         "failed" | "stale" | "discarded",
  projectRevision: uint64,
  baseSnapshotId?: string,
  sourceViewRevision?: uint64,
  destinationRoot: DestinationRootIdentity,
  planDigest: Digest,
  pinnedSessionSnapshotCount: uint64,
  addedSessionCount: uint64,
  itemCount: uint64,
  sourceFrameCount: uint64,
  sourceByteCount: uint64,
  conflictCount: uint64,
  workLimits: {
    maximumSessions: 500,
    maximumItems: 100000,
    maximumSourceFrames: 100000,
    maximumSourceBytes: 17592186044416
  },
  continuation?: {
    remainingSessionCount: uint64,
    nextSessionId: string
  },
  correctionOverlayPreview?: {
    predecessorSessionId: string,
    appliedReclassificationPlanRevisionId: string,
    mappingCount: uint64
  },
  createdAt: timestamp,
  createdBy: string,
  approval?: {
    approvalId: string,
    approvedAt: timestamp,
    approvedBy: string,
    planRevision: uint64,
    approvedPlanDigest: Digest
  }
}

DestinationRootIdentity {
  rootId: string,
  canonicalRootKey: string,
  stableFileIdentity: string,
  platform: "linux" | "macos" | "windows"
}

PinnedSourceIdentity {
  fileRecordId: string,
  stableFileIdentity: string,
  sourceRootId: string,
  sourceRelativePath: CanonicalRelativePath,
  noFollow: true
}

UpdateViewItem {
  ordinal: uint64,
  itemId: string,
  sessionId: string,
  action: "create_directory" | "create_link" | "copy" | "write_manifest",
  destinationRelativePath: CanonicalRelativePath,
  destinationCollisionKey: string,
  source?: PinnedSourceIdentity,
  expectedDestinationState: "absent",
  approvedContentFingerprint: Digest
}

UpdateViewConflict {
  ordinal: uint64,
  code: "path_exists" | "incompatible_destination" | "source_unavailable",
  itemId: string,
  destinationRelativePath: CanonicalRelativePath,
  existingEntryFingerprint?: Digest
}

UpdateViewOverlayMapping {
  ordinal: uint64,
  predecessorEntryId: string,
  replacementEntryId?: string,
  exclusionReasonCode?: string
}

UpdateViewOperationProgress {
  operationId: string,
  planId: string,
  state: "applying" | "stopping" | "stopped" | "applied" | "failed",
  completedItems: uint64,
  totalItems: uint64,
  completedSourceBytes: uint64,
  totalSourceBytes: uint64,
  cancelSafe: boolean,
  updatedAt: timestamp
}
```

Every plan item belongs to a session in the paginated added-session snapshot.
Existing materialized session IDs and entries are absent from plan items.

The persisted plan is one deterministic whole-session work chunk. It contains
at most 500 sessions, 100,000 items, 100,000 source frames, and 16 TiB of source
bytes. Generation adds sessions in session-ID order while each complete session
fits all four limits.
It never splits one session across plans. When unmaterialized sessions remain,
`continuation` identifies the first session for the next plan after this plan
has been applied. A single session that exceeds any applicable work limit is
refused with `project.update_view_session_too_large`.

A correction plan stores the ordered overlay-mapping collection represented by
`correctionOverlayPreview`. Exactly one of `replacementEntryId` and
`exclusionReasonCode` is present in each mapping. The mapping count, ordinals,
entry identities, and exclusion codes are part of `planDigest`.

The trusted core creates every canonical path and collision key. Collision keys
apply the destination platform's Unicode normalization, case-folding, reserved
name, trailing-dot, trailing-space, and separator rules. Two distinct plan
paths with the same collision key are a conflict.

Each item carries a strong approved content fingerprint. Directory manifest
items fingerprint their canonical bytes. Link and copy items also pin the
indexed source root, relative path, and stable file identity. The core resolves
each source and destination component relative to its pinned root with no-follow
semantics and rejects symlinks, junctions, reparse points, mount escapes, and a
root identity change.

Every continuation binds the immutable revision or plan snapshot named by the
first page. The unique total orders are:

| Operation | Unique total order |
|---|---|
| `project.related_session.list` | `firstAvailableAt DESC, sessionId ASC` |
| `project.view_state.pin.list` | `sessionId ASC` |
| `project.view_state.materialized_session.list` | `sessionId ASC` |
| `project.view_state.unmaterialized_session.list` | `sessionId ASC` |
| `project.manifest.entry.list` | `ordinal ASC, entryId ASC` |
| `project.manifest.correction_overlay.list` | `ordinal ASC, overlayId ASC` |
| `project.correction_overlay.mapping.list` | `ordinal ASC, predecessorEntryId ASC` |
| `project.update_view.pinned_session.list` | `ordinal ASC, sessionId ASC` |
| `project.update_view.added_session.list` | `ordinal ASC, sessionId ASC` |
| `project.update_view.item.list` | `ordinal ASC, itemId ASC` |
| `project.update_view.conflict.list` | `ordinal ASC, itemId ASC` |
| `project.update_view.overlay_mapping.list` | `ordinal ASC, predecessorEntryId ASC` |

## Queries

### `project.related_session.list`

- Type: read-only.
- Request: `{ projectId, relationKinds?, includePinned?: boolean = false, page }`.
- Response: `Page<RelatedSession>`.
- Guard: the project must exist.
- Notes: results are informational and do not change project membership.
- Notes: a group-derived result expands once to the session IDs visible to this query response.
- Sort: `firstAvailableAt` descending, then `sessionId` ascending.

### `project.view_state.query`

- Type: read-only.
- Request: `{ projectId }`.
- Response: `ProjectViewState`.
- Errors: `project.not_found`.

### `project.view_state.pin.list`

- Type: read-only.
- Request: `{ projectId, projectRevision, page }`.
- Response: `Page<ProjectSessionPin>`.

### `project.view_state.materialized_session.list`

- Type: read-only.
- Request: `{ projectId, materializedSnapshotId, page }`.
- Response: `Page<{ sessionId: string }>`.
- Notes: results come from the snapshot's exact materialized-session set, not
  from the full project membership revision used as its planning basis.

### `project.view_state.unmaterialized_session.list`

- Type: read-only.
- Request: `{ projectId, projectRevision, materializedSnapshotId?, page }`.
- Response: `Page<{ sessionId: string }>`.
- Notes: results are the requested project membership revision minus the exact
  materialized-session set of `materializedSnapshotId`.

### `project.manifest.query`

- Type: read-only.
- Request: `{ projectId, manifestId?: string }`.
- Response: `{ currentManifest: ProjectManifest, requestedManifest?: ProjectManifest }`.

### `project.manifest.entry.list`

- Type: read-only.
- Request: `{ projectId, manifestId, page }`.
- Response: `Page<{ entryId: string, ordinal: uint64 }>`.

### `project.manifest.correction_overlay.list`

- Type: read-only.
- Request: `{ projectId, manifestId, page }`.
- Response: `Page<{ overlay: CorrectionOverlay, ordinal: uint64 }>`.

### `project.correction_overlay.mapping.list`

- Type: read-only.
- Request: `{ projectId, overlayId, page }`.
- Response: `Page<{ predecessorEntryId: string, replacementEntryId?: string, exclusionReasonCode?: string, ordinal: uint64 }>`.
- Notes: exactly one of `replacementEntryId` and `exclusionReasonCode` is
  present.

### `project.update_view.query`

- Type: read-only.
- Request: `{ planId }`.
- Response: `UpdateViewPlan`.
- Errors: `project.update_view_plan_not_found`.

### `project.update_view.pinned_session.list`

- Type: read-only.
- Request: `{ planId, page }`.
- Response: `Page<{ sessionId: string, pinRevision: uint64, ordinal: uint64 }>`.

### `project.update_view.added_session.list`

- Type: read-only.
- Request: `{ planId, page }`.
- Response: `Page<{ sessionId: string, ordinal: uint64 }>`.

### `project.update_view.item.list`

- Type: read-only.
- Request: `{ planId, page }`.
- Response: `Page<UpdateViewItem>`.

### `project.update_view.conflict.list`

- Type: read-only.
- Request: `{ planId, page }`.
- Response: `Page<UpdateViewConflict>`.

### `project.update_view.overlay_mapping.list`

- Type: read-only.
- Request: `{ planId, page }`.
- Response: `Page<UpdateViewOverlayMapping>`.
- Guard: the caller must be authorized to inspect the project and its
  materialized entries.
- Sort: immutable mapping ordinal ascending.
- Errors: `project.update_view_plan_not_found`.

### `project.update_view.operation.query`

- Type: read-only execution query.
- Request: `{ operationId }`.
- Response: `UpdateViewOperationProgress`.
- Guard: the caller must retain project and root authorization. Unauthorized and
  unknown operation IDs follow the shared anti-enumeration denial policy.

### `project.update_view.cancel`

- Type: authorized idempotent execution control.
- Request: `{ operationId, mutationContext }`.
- Response: `UpdateViewOperationProgress`.
- Guard: the operation is `applying` and the command fence is current.
- Effect: sets `stopping`, records the request in audit, and signals the fenced
  worker. The worker stops before its next irreversible install, persists
  `stopped`, and emits `project.update_view_stopped`.
- Deadline: cancellation is acknowledged within 500 milliseconds and reaches
  `stopped` within one second unless one atomic install plus its durability
  barrier is in flight. The progress response exposes `cancelSafe: false` during
  that bounded interval.
- Idempotency: replay returns the recorded cancellation state. A terminal
  operation is unchanged.

## Commands

### `project.session_pin.add`

- Type: atomic database mutation.
- Request: `{ projectId, sessionId, expectedProjectRevision, relatedSessionEvidenceId?, mutationContext }`.
- Response: `{ pin: ProjectSessionPin, viewState: ProjectViewState, auditId }`.
- Guard: lifecycle must be `setup_incomplete`, `ready`, `prepared`, `processing`, or `blocked`.
- Guard: the session must exist and must not already be pinned.
- Effect: the exact session identity is pinned.
- Effect: existing materialized content is not changed.
- Effect: a materialized view becomes stale and lists the session as unmaterialized.
- Idempotency: replay returns the existing pin created by the command.

### `project.session_pin.replace`

- Type: atomic database mutation.
- Request: `{ projectId, predecessorSessionId, replacementSessionIds: BoundedList<string, 500>, appliedReclassificationPlanRevisionId, expectedProjectRevision, mutationContext }`.
- Response: `{ removedPin: ProjectSessionPin, replacementPins: BoundedList<ProjectSessionPin, 500>, viewState: ProjectViewState, auditId }`.
- Guard: lifecycle must allow addition.
- Guard: the predecessor must be pinned.
- Guard: `replacementSessionIds` must be non-empty, contain no duplicates, and
  equal the complete replacement-session set authorized for the predecessor by
  `appliedReclassificationPlanRevisionId`.
- Guard: no replacement session may already be pinned.
- Effect: one transaction removes the predecessor pin and adds every authorized
  replacement pin. A stale revision or invalid replacement aborts the complete
  set without changing project membership.
- Effect: existing materialized entries remain unchanged.
- Effect: every replacement session is listed as unmaterialized.

### `project.update_view.plan`

- Type: preview-generating database mutation.
- Request: `{ projectId, expectedProjectRevision, expectedSourceViewRevision?, sessionIds?: BoundedList<string, 500>, replacementContext?: { predecessorSessionId, appliedReclassificationPlanRevisionId }, mutationContext }`.
- Response: `UpdateViewPlan`.
- Guard: the trusted actor must be authorized to inspect the project, every
  selected source root, and the destination root.
- Guard: the project must have at least one pinned session absent from the
  materialized snapshot's exact materialized-session set.
- Guard: supplied `sessionIds` must be pinned and unmaterialized.
- Guard: a replacement context must name an applied reclassification revision,
  and `sessionIds` must equal its complete non-empty replacement set for the
  predecessor.
- Guard: completed and archived projects may inspect stale state but may not generate an applyable plan.
- Effect: omitted `sessionIds` selects the next 500 sessions in session-ID
  order from the requested project revision minus the base snapshot's exact
  materialized-session set.
- Effect: generation takes the longest whole-session prefix that fits the
  persisted limits of 500 sessions, 100,000 items, 100,000 source frames, and
  17,592,186,044,416 source bytes.
- Effect: a plan with remaining unmaterialized sessions stores their count and
  the next session ID. After apply, a new plan continues from the successor
  snapshot and recomputes its complete work chunk against that new basis.
- Effect: if the first selected session alone exceeds 100,000 items or 100,000
  source frames, or source bytes, generation returns
  `project.update_view_session_too_large` and
  persists no partial plan.
- Effect: a replacement plan persists the complete ordered overlay-mapping
  preview and its count. The canonical plan digest binds that collection as
  well as the item, session, conflict, source, and destination snapshots.
- Effect: group-derived inputs are expanded once into the immutable paginated
  pinned-session snapshot.
- Effect: later group membership, labels, or relations cannot change the plan.
- Effect: every destination precondition is `absent`.
- Effect: any detected collision increments `conflictCount`, is exposed by the
  conflict query, and prevents approval.
- Effect: generation does not touch the filesystem.
- Idempotency: replay returns the same plan, item IDs, and pinned-session snapshot.

### `project.update_view.approve`

- Type: database mutation.
- Request: `{ planId, expectedPlanRevision, mutationContext: { commandId, reason?, approvalDigest: Digest } }`.
- Response: `{ plan: UpdateViewPlan, approvalId, auditId }`.
- Guard: the trusted actor must be authorized to approve project membership and
  materialized-view changes and to inspect every source and destination root
  named by the plan.
- Guard: plan state must be `open`.
- Guard: `conflictCount` must be zero.
- Guard: project and source-view revisions must still equal the plan basis.
- Guard: `approvalDigest` must equal `plan.planDigest`.
- Effect: approval authorizes only the listed items and, when present, the
  ordered correction-overlay mappings bound by the plan digest.
- Effect: approval stores the same digest as `approvedPlanDigest`.

### `project.update_view.apply`

- Type: long-running filesystem mutation.
- Request: `{ planId, approvalId, expectedPlanRevision, mutationContext: { commandId, reason?, approvalDigest: Digest } }`.
- Response: `{ operationId, planId, state: "applying" }`.
- Guard: plan state must be `approved` or recoverably `stopped`.
- Guard: the trusted actor must be authorized to mutate the project, read every
  selected source root, and write the destination root.
- Guard: approval must name the same plan revision.
- Guard: the request approval digest, stored approved digest, and recomputed
  canonical plan digest must match.
- Guard: lifecycle must not be `completed` or `archived`.
- Guard: project, pin, snapshot, and source-view revisions must still match the plan.
- Guard: the destination root identity must still match the plan.
- Guard: every source root, stable file identity, canonical path, and byte size
  must be revalidated before the first write.
- Guard: each source-bearing item is opened once through no-follow,
  root-relative resolution. The core hashes the bytes consumed through that
  handle and copies or installs from the same verified stream. It never hashes
  one open and materializes from a reopened path.
- Guard: `{ commandId, leaseGeneration }` must still be the current command
  owner immediately before every irreversible install, item-journal transition,
  heartbeat, and terminal publication. A stale generation stops before another
  filesystem effect.
- Guard: a complete preflight resolves every destination component with
  no-follow semantics and detects all known collisions before the first write.
- Guard: complete preflight covers every item and source frame in the persisted
  plan. Apply does not preflight or write a partial page or subchunk.
- Guard: preflight compares required temporary plus destination bytes with
  available capacity and warns or refuses according to the typed resource
  result. The persisted source-byte ceiling remains authoritative even when
  filesystem capacity reporting is unavailable.
- Guard: before a resumed write, the new fenced owner reconciles every completed
  journal and install intent, then repeats complete preflight for all remaining
  items. Ambiguous ownership or destination state stops as a collision.
- Effect: apply may create only the paths and manifest entries listed in `items`.
- Effect: apply never rewrites, removes, renames, or relocates an existing entry.
- Effect: each item uses an atomic no-clobber primitive. File data is written to
  a plan-owned temporary entry and installed with an atomic no-replace rename or
  platform equivalent.
- Effect: before install, the core durably records an install intent containing
  the item ID, destination collision key, expected fingerprint, command fence,
  and the plan-owned temporary entry's stable file identity or an equivalent
  unforgeable platform ownership token. It commits the intent and fsyncs the
  temporary entry and required containing-directory metadata before the atomic
  no-replace install.
- Effect: after the atomic no-replace install, the executor performs the
  platform durability barrier for the destination directory before marking the
  intent `installed` or committing the item journal.
- Effect: after a crash between atomic install and item-journal completion, a
  fenced owner may reconcile the destination only by opening it with no-follow
  semantics and matching the recorded stable identity or ownership token,
  canonical collision key, and strong approved fingerprint. It then adopts the
  item journal under its lease generation before continuing. Missing,
  contradictory, or platform-insufficient ownership evidence is a collision;
  byte equality alone never proves ownership.
- Effect: recovery distinguishes absence, a present but not yet durability-
  confirmed destination, and a durable installed destination. It repeats the
  destination-directory durability barrier before adopting a proven installed
  item. Ambiguous evidence remains a collision.
- Effect: a link item is allowed only when the platform can atomically bind the
  verified open source identity. Other platforms plan a copy item.
- Effect: an unexpected runtime collision or I/O failure stops remaining work.
  Earlier successful items remain and have durable per-item journal entries.
- Effect: a recoverable interruption, cancellation, or reconciled I/O stop
  moves the plan to `stopped`. A transaction may move `stopped` to `applying`
  only while claiming a new current lease generation and preserving the same
  approved plan revision and digest. `failed` is reserved for outcomes proven
  non-resumable without a new plan.
- Effect: resume recognizes an existing entry only when a journal or install
  intent binds it to the same `planId`, `planDigest`, `itemId`, collision key,
  verified fingerprint, and prior fenced operation in this plan's recovery
  chain. The new owner transactionally adopts each reconciled item under its
  command ID and lease generation before continuing. Every other existing entry
  is a collision.
- Effect: no completed snapshot, current manifest, or materialization head is
  published until every item and its journal entry succeeds.
- Effect: completion creates a successor snapshot whose exact
  materialized-session set is the union of the base set and applied plan set.
- Effect: completion clears staleness only when the membership head contains no
  session absent from that exact successor set.
- Effect: a replacement plan creates an immutable correction overlay and maps
  predecessor entries to replacement entries or exclusion reasons.
- Effect: the successor manifest, its active overlay linkage, the successor
  snapshot, manifest head, and materialization head publish in one transaction.
- Idempotency: replay of one command follows the shared command ledger. Resuming
  a stopped plan uses a new globally unique command ID, claims a new fence, and
  adopts only verified plan-owned work. The shared payload-mismatch rule rejects
  another plan or approval digest under an existing command ID.

### `project.update_view.discard`

- Type: database mutation.
- Request: `{ planId, expectedPlanRevision, mutationContext }`.
- Response: `{ planId, state: "discarded", auditId }`.
- Guard: only `open` or `stale` plans may be discarded.
- Effect: project pins and materialized entries remain unchanged.

## Apply events

| Event | Payload |
|---|---|
| `project.related_session_available` | `{ projectId, sessionId, relationKind, evidenceId }` |
| `project.session_pinned` | `{ projectId, sessionId, pinRevision, source }` |
| `project.session_pin_replaced` | `{ projectId, predecessorSessionId, replacementSessionIds: BoundedList<string, 500>, appliedReclassificationPlanRevisionId }` |
| `project.view_stale` | `{ projectId, unmaterializedSessionCount }` |
| `project.update_view_planned` | `{ projectId, planId, addedSessionCount, itemCount, sourceFrameCount, sourceByteCount, conflictCount, overlayMappingCount, remainingSessionCount }` |
| `project.update_view_approved` | `{ projectId, planId, approvalId, planRevision }` |
| `project.update_view_item_applied` | `{ operationId, planId, itemId, sessionId, destinationRelativePath }` |
| `project.update_view_stopped` | `{ operationId, planId, itemId?, errorCode }` |
| `project.update_view_failed` | `{ operationId, planId, itemId?, errorCode, resumable: false }` |
| `project.update_view_applied` | `{ operationId, planId, materializedSnapshotId, appliedItemCount }` |

Progress events include `{ operationId, completedItems, totalItems }`.
Cancellation stops before the next irreversible item install. It publishes no
snapshot, manifest, overlay, or materialization head. The operation remains
in `stopped` and remains resumable from verified item journals and install
intents under a new fencing generation.

## Review-surface accessibility

The Related Session and Update View surfaces use the same interaction contract
as Inbox plans, relation proposals, matching settings, calibration selection,
and metadata-correction review:

- Warning and error severity is conveyed by visible text and an
  accessibility-named icon in addition to color. Yellow and red styling alone
  never communicates severity, eligibility, or the required action.
- Every row, evidence disclosure, selection, approval, refusal, conflict, and
  cancellation control is operable by keyboard. Focus follows reading order,
  enters a modal review at its heading, remains inside while the modal is open,
  and returns to the invoking control when it closes.
- Validation errors and conflicts link to the affected control or item. On a
  failed submit, focus moves to an error summary before the linked details.
- Preview readiness, stale-plan changes, apply progress, cancellation, and
  terminal success are announced through a polite live region. Blocking errors
  use an assertive announcement. Per-item progress is coalesced so assistive
  technology does not announce every filesystem item.
- Long-running discovery, preview, and apply operations expose a named cancel
  control whenever cancellation is safe. The UI announces when cancellation
  is requested, when work has stopped, and whether the operation can resume.
- Surfaces honor the platform reduced-motion preference. Progress uses text,
  values, and live-region updates without continuous movement, flashing, or
  motion that is required to understand state.

## Versioned manifests and correction overlays

Each successful materialization publishes a new immutable manifest version and
makes it the project's current manifest in the same commit that advances the
materialization head. A manifest lists bounded pages of active entry IDs and
names its predecessor version.

A materialization that applies a session replacement creates an immutable
correction overlay:

- The overlay names its predecessor and applied reclassification-plan revision.
- Ordered mappings associate each affected predecessor entry with a replacement
  entry or exclusion reason.
- The successor manifest stores its complete active overlay set.
- Historical snapshots, manifests, overlays, mappings, and filesystem entries
  remain queryable.
- Current processing resolves only the current manifest and linked overlays.
- The successor manifest and overlay become visible in one commit. Failed or
  partial apply operations change neither head.

## Error codes

| Code | Condition | Required details |
|---|---|---|
| `project.not_found` | A project ID is unknown. | `projectId` |
| `project.session_not_found` | A session ID is unknown. | `sessionId` |
| `project.session_already_pinned` | The exact session is already pinned. | `projectId`, `sessionId` |
| `project.session_not_pinned` | A replacement predecessor is not pinned. | `projectId`, `sessionId` |
| `project.lifecycle_disallows_session_add` | Completed or archived lifecycle refuses addition or replacement. | `projectId`, `lifecycle` |
| `project.reclassification_revision_invalid` | The applied reclassification-plan revision is absent, not applied, or does not authorize the exact complete replacement set. | `appliedReclassificationPlanRevisionId`, `predecessorSessionId`, `replacementSessionIds: BoundedList<string, 500>` |
| `project.update_view_no_additions` | No pinned session is absent from the snapshot. | `projectId`, `materializedSnapshotId` |
| `project.update_view_plan_not_found` | A plan ID is unknown. | `planId` |
| `project.update_view_plan_not_open` | Approval requires an open plan. | `planId`, `state` |
| `project.update_view_plan_not_approved` | Apply requires an approved or recoverably stopped plan. | `planId`, `state` |
| `project.update_view_plan_stale` | Project, pin, source-view, or snapshot basis changed. | `planId`, `staleRefs: BoundedList<RevisionRef, 500>` |
| `project.update_view_path_conflict` | A destination exists or became incompatible. | `planId`, `itemId`, authorized `destinationRelativePath?` |
| `project.update_view_source_unavailable` | A pinned source identity cannot be revalidated. | `planId`, `itemId`, `fileRecordId` |
| `project.update_view_root_changed` | The destination root identity differs from the approved plan. | `planId`, `rootId` |
| `project.update_view_plan_digest_mismatch` | The plan, approval, or request digest differs. | `planId`, `approvalId` |
| `project.update_view_session_too_large` | One complete session exceeds a persisted Update View item, source-frame, or source-byte ceiling. | `projectId`, `sessionId`, `itemCount`, `sourceFrameCount`, `sourceByteCount`, `maximumItems`, `maximumSourceFrames`, `maximumSourceBytes` |
| `project.update_view_operation_not_cancellable` | The operation is terminal or inside its bounded atomic durability step. | `operationId`, `state`, `cancelSafe` |

## Audit expectations

- Pin addition records the exact session ID and related-session evidence ID.
- Replacement records the removed pin, every added pin, and the applied
  reclassification-plan revision.
- Plan generation records the immutable session snapshot and destination summary.
- Approval records the approved plan revision and conflict-free check.
- Apply records one audit entry per item and one terminal operation entry.
- A preflight collision or stale-basis refusal records the item and precondition
  before any filesystem write.
- A non-resumable runtime failure records successful item journals, unresolved
  install intents, and one failed terminal operation without publishing a new
  snapshot or manifest.
- A recoverable stop records the current fence, completed journals, unresolved
  install intents, and stop reason. A resume records the successor fence and
  each reconciled or refused intent.
