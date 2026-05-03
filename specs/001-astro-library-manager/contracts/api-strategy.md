# Contract/API Strategy

## Decision

Astro Library Manager will define a language-neutral operation contract as the
source of truth. The initial Tauri backend exposes that contract through a small
adapter layer. A future HTTP, local service, Python, Node, or Rust backend can
reuse the same operation names, request/response schemas, error model, and
operation event stream.

## Source of Truth

Use versioned JSON Schema documents plus an operation catalog:

- JSON Schema defines request payloads, response payloads, events, domain DTOs,
  and error envelopes.
- The operation catalog defines operation IDs, transport behavior,
  authorization/safety requirements, idempotency expectations, long-running
  behavior, and emitted events.
- TypeScript validators/types and Rust serde types should be generated from or
  continuously checked against the schema source.
- Zod is allowed in the frontend as a runtime validation layer, but it is not
  the canonical contract source in v1.
- OpenAPI can be generated later as an HTTP projection, but HTTP is not required
  for the first desktop release.

## Frontend Coupling Rule

React components must not call Tauri commands directly. Components call feature
services or hooks that depend on an `AlmClient` interface:

```ts
interface AlmClient {
  execute<TRequest, TResponse>(
    operation: OperationId,
    request: TRequest,
  ): Promise<TResponse>;

  subscribe(operationId: OperationId): AsyncIterable<OperationEvent>;
}
```

The first implementation uses a Tauri adapter:

```text
React component -> feature service -> AlmClient -> Tauri adapter -> Rust command
```

Future remote implementation:

```text
React component -> feature service -> AlmClient -> HTTP/WebSocket adapter -> service
```

## Transport Shape

### Request Envelope

```json
{
  "contractVersion": "1.0.0",
  "operation": "library.scan.start",
  "requestId": "01HV...",
  "payload": {}
}
```

### Response Envelope

```json
{
  "contractVersion": "1.0.0",
  "requestId": "01HV...",
  "status": "ok",
  "payload": {}
}
```

### Error Envelope

```json
{
  "contractVersion": "1.0.0",
  "requestId": "01HV...",
  "status": "error",
  "error": {
    "code": "filesystem.destination_exists",
    "message": "Destination already exists.",
    "severity": "blocking",
    "retryable": false,
    "details": {}
  }
}
```

### Operation Event

```json
{
  "contractVersion": "1.0.0",
  "operationId": "01HV...",
  "eventType": "progress",
  "sequence": 42,
  "payload": {
    "status": "running",
    "current": 12800,
    "total": 100000,
    "message": "Extracting FITS headers"
  }
}
```

## Versioning

- Contract versions use semantic versioning.
- Additive fields are allowed in minor versions.
- Removing fields, changing enum semantics, or changing required safety
  behavior requires a major version.
- Each generated manifest includes the contract/schema version used to produce
  it, but manifests are exports, not canonical state.
- Database migrations are versioned separately from API contracts.

## Error Model

Required error fields:

- `code`: stable machine-readable code.
- `message`: short user-visible summary.
- `severity`: `info`, `warning`, `blocking`, `fatal`.
- `retryable`: boolean.
- `details`: structured object.
- `fieldErrors`: optional validation errors.
- `recoveryActions`: optional suggested user actions.

Initial code families:

- `validation.*`
- `filesystem.*`
- `path.*`
- `root.*`
- `scan.*`
- `metadata.*`
- `classification.*`
- `calibration.*`
- `project.*`
- `plan.*`
- `audit.*`
- `operation.*`

## Long-Running Operations

Scans, metadata extraction, calibration matching, workspace observation, plan
generation, plan application, and manifest generation return an operation handle.
Progress and results are streamed through operation events and persisted in
`OperationState`.

Rules:

- Operations must be resumable or recoverable where feasible.
- Cancellation is cooperative and only exposed where it cannot corrupt plan
  application.
- Plan application records per-item audit results even on failure or partial
  completion.

## Safety Semantics

The contract distinguishes read-only operations, plan-generation operations, and
mutation-applying operations.

- Read-only operations may scan, classify, and observe without mutating files.
- Plan-generation operations produce `FilesystemPlan` records and dry-run
  results only.
- Mutation-applying operations require a plan ID, approval record, current plan
  revision, and safety precondition checks.
- Direct delete operations are not exposed as primitive UI commands in v1.

## Contract Artifacts To Create During Implementation

```text
packages/contracts/
├── schemas/
│   ├── envelope.schema.json
│   ├── errors.schema.json
│   ├── domain/
│   └── operations/
├── src/
│   ├── client.ts
│   ├── generated/
│   └── validation.ts
└── package.json

crates/contracts/core/
├── src/
│   ├── envelope.rs
│   ├── error.rs
│   ├── operation.rs
│   └── generated/
└── Cargo.toml
```

Generation strategy should be selected in implementation tasks after evaluating
Rust and TypeScript generator quality. A manual first pass is acceptable only if
contract tests ensure both sides stay aligned.
