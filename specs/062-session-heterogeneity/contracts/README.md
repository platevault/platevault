# Contracts: Immutable Sessions and Observation Groups

**Feature**: `062-session-heterogeneity` | **Date**: 2026-07-21

These language-neutral contracts define transport-independent operations and
DTOs. Adapters may project field names into their native casing. Generated
bindings and JSON Schema must come from the same contract definitions.

## Files

| File | Surface |
|---|---|
| [inbox-materialization.md](inbox-materialization.md) | Inbox planning, acquisition-site review, and immutable session materialization |
| [sessions-groups-proposals.md](sessions-groups-proposals.md) | Session, panel-group, mosaic, and reviewed relation-proposal operations |
| [metadata-equipment-reclassification.md](metadata-equipment-reclassification.md) | Metadata evidence, equipment resolution, and identity-changing reclassification |
| [matching-settings.md](matching-settings.md) | Matching thresholds, bounds, warnings, and versioned settings updates |
| [calibration-handoff.md](calibration-handoff.md) | Dark, bias, and flat candidates, reviewed selections, and immutable external-processor handoffs |
| [projects-related-sessions-update-view.md](projects-related-sessions-update-view.md) | Related-session discovery, project pins, and additive Update View plans |

## Shared scalar rules

| Scalar | Contract |
|---|---|
| `UUID` and `*Id` | Canonical lowercase hyphenated UUID text: exactly 36 ASCII bytes in `8-4-4-4-12` form. Public entity IDs are UUIDv7. |
| `commandId` | A globally unique UUID. It is never scoped to an actor, adapter, device, or command kind. |
| `*Revision` | Unsigned integer that increases after each accepted mutation of the entity. |
| `*At` | RFC 3339 timestamp with an offset. |
| Percentage | Decimal percentage in the inclusive range stated by the field. |
| Angle | Decimal degrees. |
| Duration | Integer milliseconds unless the field names another unit. |
| Date | ISO 8601 calendar date. |
| `Digest` | Exactly `sha256:` followed by 64 lowercase hexadecimal characters; 71 ASCII bytes. No other algorithm is accepted. |
| `Cursor` | Opaque UTF-8 text of 1–4,096 bytes. |
| `SafeText` | UTF-8 text with control characters removed; at most 4,096 Unicode scalar values and 16,384 UTF-8 bytes. |
| `CanonicalRelativePath` | A normalized, root-relative UTF-8 path with 1–64 non-empty segments, at most 255 bytes per segment, and at most 4,096 bytes total. It contains no root, drive, `.` segment, `..` segment, NUL, or platform separator inside a segment. |
| Stable file or root identity | Opaque value of 1–1,024 bytes. |
| Destination collision key | Canonical derived value of 1–4,096 bytes. |

All optional values are explicit nullable fields. Missing metadata uses a
documented state such as `absent`, `unknown`, or `unverified`; it is never
replaced with a neighboring value.

## Query envelope

List queries accept:

```text
PageRequest {
  cursor?: string,
  limit: uint32 = 100
}
```

`limit` must be between 1 and 500. List responses return
`Page<T>`. The first page fixes either an immutable `snapshotId` or a repository
watermark that all later pages reuse. A cursor binds the authorized principal,
query name, normalized filters, sort order, snapshot or watermark, and last
returned unique sort key. Reusing it with any other query context returns
`pagination.cursor_invalid`.

Every list contract defines a unique total order. A mutable projection ends its
sort key with a stable public entity ID. An immutable ordered child collection
ends its sort key with its persisted ordinal and child public ID. Implementations
must not rely on row insertion order or a non-unique timestamp. One traversal
therefore cannot skip or duplicate an item when concurrent writes advance the
live head.

An encoded request may contain at most 1 MiB. An encoded response may contain
at most 4 MiB. A list implementation reduces the returned item count below the
requested limit when needed to stay within the response budget and returns a
`nextCursor`. A single item that cannot fit is rejected with
`validation.payload_too_large`; it is never truncated.

## Shared DTOs

```text
EntityRef {
  entityType: string,
  entityId: string
}

RevisionRef {
  entityType: string,
  entityId: string,
  revisionId: string,
  revisionNumber: uint64
}

Range<T> {
  min: T,
  max: T,
  minInclusive: boolean,
  maxInclusive: boolean
}

Page<T> {
  items: BoundedList<T, 500>,
  snapshotId?: string,
  watermark?: string,
  nextCursor?: string
}

FieldError {
  field: string,
  reasonCode: string
}

Violation {
  code: string,
  field?: string,
  entityRef?: EntityRef,
  evidenceRef?: string
}

SafeErrorDetails =
  { kind: "field_errors", fields: BoundedList<FieldError, 100> } |
  { kind: "payload_limit", field: string, limitName: string, limit: uint64 } |
  { kind: "entity", entityType: string, entityId: string } |
  { kind: "stale_entity", entityType: string, entityId: string,
    expectedRevision: uint64, actualRevision: uint64 } |
  { kind: "stale_revisions", revisions: BoundedList<RevisionRef, 500>,
    totalCount: uint64, decisionSnapshotId?: string } |
  { kind: "violations", violations: BoundedList<Violation, 100>,
    totalCount: uint64, decisionSnapshotId?: string } |
  { kind: "idempotency", commandId: string } |
  { kind: "operation", commandId: string, operationId: string } |
  { kind: "authorized_path", itemId: string,
    relativePath?: CanonicalRelativePath } |
  { kind: "domain", code: string,
    values: BoundedList<{ name: string, value: SafeText | uint64 | boolean }, 100>,
    decisionSnapshotId?: string }
```

Exactly one of `snapshotId` or `watermark` is present on every non-empty page
and on an empty first page. Every later page repeats the same value.

`scalar` means boolean, integer, decimal, timestamp, or null. Metadata strings
use `SafeText`. Compound metadata values use a named DTO.

## Collection and payload bounds

`BoundedList<T, N>` contains at most `N` items. No request, response, event, or
error DTO contains an unbounded collection. `Page<T>` contains at most the
accepted `PageRequest.limit` items.

Unless a domain type declares a smaller limit, these bounds apply:

| Value | Limit |
|---|---:|
| Identifiers, references, warnings, and evidence references in one DTO | 500 items |
| Free-form reason or note | 4,096 Unicode scalar values |
| Metadata fields in one evidence revision | 256 fields |
| Metadata object depth | 8 levels |
| Properties in one metadata object | 128 properties |
| Items in one metadata array | 256 items |
| UTF-8 metadata payload after canonical encoding | 256 KiB |

The trusted core rejects an over-limit request before persistence. It truncates
only diagnostic projections, with an explicit `truncated: true` marker; it does
not silently truncate domain data.

## Mutation envelope

Every command request includes:

```text
MutationContext {
  commandId: string,
  reason?: SafeText,
  approvalDigest?: Digest
}
```

Adapters authenticate the caller and pass a local principal through a trusted,
non-serializable call boundary. The trusted core derives `actorId` from that
principal and binds it to the command, audit records, decisions, and events.
Transport input cannot assert or override `actorId`. An approval digest binds a
command to the exact approved artifact; commands that do not consume approval
omit it.

The trusted core also derives an authorization scope from that principal before
any query, preview, mutation, or retry lookup. It verifies access to every
referenced project, session, source library root, destination root, plan,
snapshot, and operation. Source and destination roots are resolved from
authorized stored identities rather than caller-supplied absolute paths.
Transport input cannot assert an authorization scope. A command replay returns
its recorded response only when the current principal remains authorized for
the command and every referenced resource.

Unauthorized and nonexistent protected resources are intentionally
indistinguishable at the transport boundary. Initial queries, mutations, cursor
continuations, progress or cancellation lookups, subscriptions, and idempotent
replay return `resource.unavailable` with no resource identifiers or revision
details. The trusted audit boundary records a bounded denial code and diagnostic
correlation ID without exposing roots, paths, stable identities, fingerprints,
or protected entity IDs to the caller.

Commands that change a revisioned entity also include `expectedRevision` or an
equivalent expected base revision. A stale expectation fails the whole command.
No related row, membership, edge, lineage record, project pin, or audit success
record may be committed on that failure.

`commandId` is the globally unique idempotency key across all actors and
commands. The canonical payload digest includes the command name, every
request field other than transport framing, and the trusted derived actor
identity. Repeating a completed command
with the same canonical payload returns the recorded response. Reusing it with
a different payload returns `idempotency.payload_mismatch`. Repeating an
in-progress command returns `operation.in_progress`.

Command execution uses a durable owner lease with a bounded expiry and
heartbeat. Another worker may reclaim an expired execution only after a
transactional reconciliation proves that no terminal command result, domain
commit, audit success record, or outbox event exists. A discovered terminal or
domain commit is reconciled into the ledger and returned. Ambiguous evidence
fails closed and does not execute the command again.

Each claim or reclaim produces a monotonically increasing `leaseGeneration`.
Long-running operations carry `{ commandId, leaseGeneration }` as a fencing
token. The trusted core verifies the current generation before every heartbeat,
irreversible filesystem install, item-journal transition, and terminal publish.
A former owner whose generation is stale stops before another external effect.

## Error envelope

Operations use the shared result envelope:

```text
ContractError {
  code: string,
  message: SafeText,
  details?: SafeErrorDetails
}
```

Error projection follows these rules:

- `message` comes from a bounded, user-safe template selected by `code`.
- `details.kind` and its fields are allowlisted for that exact error code.
- Dynamic values are escaped as text and are never interpreted as markup.
- The trusted core maps failures to one discriminated `SafeErrorDetails` case.
- Responses exclude stack traces, SQL, OS error text, absolute paths, source
  paths, credentials, and arbitrary exception messages.
- Path details contain a plan item ID or an authorized
  `CanonicalRelativePath`. Unauthorized callers receive only the item ID.
- Local logs may retain a diagnostic correlation ID under access controls.

Common codes:

| Code | Condition | Required details |
|---|---|---|
| `validation.request_invalid` | A field is missing, malformed, or outside its declared range. | `fields: BoundedList<FieldError, 100>` |
| `validation.payload_too_large` | A metadata or text payload exceeds a declared bound. | `field`, `limitName`, `limit` |
| `pagination.cursor_invalid` | A cursor does not match the query or cannot be decoded. | None |
| `entity.not_found` | A referenced entity does not exist. | `entityType`, `entityId` |
| `resource.unavailable` | A protected resource is nonexistent or the principal lacks any required authorization. | None |
| `concurrency.stale_revision` | An expected revision differs from the accepted revision. | `entityType`, `entityId`, `expectedRevision`, `actualRevision` |
| `idempotency.payload_mismatch` | A command ID was used with a different canonical payload. | `commandId` |
| `operation.in_progress` | The command ID names an operation that has not reached a terminal state. | `commandId`, `operationId` |

## Events and audit

Domain events report committed outcomes. Each event carries `{ eventId,
occurredAt, actorId, commandId, entityRefs: BoundedList<EntityRef, 500> }` in
addition to the payload listed in its domain file.

Every mutation attempt writes a durable audit entry with:

```text
AuditRecord {
  auditId: string,
  occurredAt: timestamp,
  actorId: string,
  commandId: string,
  operation: string,
  outcome: "applied" | "rejected" | "refused" | "failed",
  reason?: string,
  entityRefs: BoundedList<EntityRef, 500>,
  beforeRevisionCount: uint64,
  afterRevisionCount: uint64,
  decisionSnapshotId?: string,
  errorCode?: string,
  evidenceRef?: string
}
```

Rejected review decisions use outcome `rejected`. Lifecycle, validation, and
concurrency guards use outcome `refused`. Unexpected execution errors use
outcome `failed`. Audit entries contain identifiers and evidence references;
they do not duplicate file metadata or secret-bearing paths. When a result has
more references than fit in the audit envelope, the audit row stores counts
and one immutable `decisionSnapshotId`; the domain's paginated decision queries
return the complete ordered reference sets.

## Compatibility

Adding an optional response field or a new error code is additive. Removing a
field, changing a field meaning, or changing an enum value is breaking.
