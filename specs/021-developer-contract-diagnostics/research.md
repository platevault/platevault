# Research: Developer Contract Diagnostics

## R1. Scope of contract diagnostics

**Question**: What does the developer surface actually expose?

**Options**:

1. **Registry + recent calls + schema viewer** (chosen). The minimum that
   answers "which contracts exist, what did the UI send, and what shape was
   declared?" in one place.
2. **Registry only**. Pros: trivial. Cons: leaves call inspection to
   external tooling; defeats the purpose of an in-app surface.
3. **Registry + calls + schemas + audit-style timeline + remote-export**.
   Pros: comprehensive. Cons: duplicates the audit timeline feature and
   pulls the surface toward becoming a second log viewer.

**Decision**: Option 1. The recent-calls view is the value-add over reading
the schemas on disk; the schema viewer closes the loop between a recorded
call and its declared shape. Cross-session history and remote export are
intentionally out of scope.

## R2. When to expose the surface

**Question**: Is the surface visible by default, behind a build flag, behind
a runtime toggle, or both?

**Options**:

1. **Visible by default in all builds**. Cons: violates FR-001 and SC-001;
   normal users discover developer plumbing.
2. **Build-flag only** (e.g., compiled into dev builds, stripped from
   production). Pros: zero overhead in production. Cons: developers running
   the production build cannot debug a user's report without a custom build.
3. **Runtime toggle, hidden by default** (chosen). The setting key
   `devMode` defaults to `false` and is toggled from a hidden settings
   page reachable only by typing the full URL. With `devMode` off the
   recording proxy is bypassed at module load.
4. **Combined: build flag gates the toggle**. Pros: belt-and-suspenders.
   Cons: more states than the value justifies; the runtime toggle is enough
   if the recording proxy is genuinely bypassed when off.

**Decision**: Runtime toggle (Option 3). Persisted per device. Production
builds ship with the surface present but disabled, so a developer reproducing
a user issue can opt in without a rebuild. The recording proxy is
short-circuited at module load when `devMode` is off; this is verified by
SC-004 (no proxy frame in flame charts with `devMode = false`).

## R3. Performance impact of call recording

**Question**: How expensive is the recording proxy and when is it
acceptable to pay that cost?

**Decision**:

- With `devMode = false`, the proxy is not installed. Calls go through the
  original dispatcher. Overhead is zero.
- With `devMode = true`, the proxy serializes the request payload twice —
  once for dispatch, once for storage after redaction. Serialization of
  payloads under 64 KB completes in well under 1ms on the target
  hardware; the proxy budget is 1ms p95 for that size class.
- Payloads larger than 64 KB are truncated with a `payload_truncated`
  marker stored on the record. The full payload is never copied into the
  buffer. The threshold is a compile-time constant in v1; a research
  decision is required to raise it because it affects worst-case memory
  use.
- The ring buffer is bounded at 100 entries. Worst-case memory footprint
  is therefore 100 entries times 64 KB per side (request + response),
  roughly 13 MB. This is acceptable for a developer-only surface.

## R4. Sensitive payload policy

**Question**: How are sensitive fields handled in the recorded payload?

**Decision**: Redaction is contract-declared. Each `ContractMeta` carries
an optional `sensitive_fields: string[]` of JSON Pointer paths into the
request and response shapes. The recorder replaces matched values with the
string `"<redacted>"` before storing. Defaults:

- Any field named `password`, `token`, `secret`, or `api_key` at any depth.
- Any path that contains a user-owned filesystem path under a
  privacy-flagged settings key (currently `librariesRootPath` is not
  flagged, so paths are stored verbatim; this is a deliberate choice
  because path debugging is a primary developer use case).

A future research decision can widen the default set if user feedback
shows recorded payloads leaking unexpected data. Contracts may extend the
default set per operation.

## R5. Cursor and reset semantics

**Question**: Does the recent-calls list have a cursor or is it always the
last 100?

**Decision**: Always the last 100. There is no cursor and no paging in v1.
The buffer is in-memory and resets on app restart; durable replay belongs
to a future audit-backed feature, not to this surface.

## R6. Replay safety

**Question**: Which contracts may be replayed from the developer surface?

**Decision**:

- Read-only contracts are `replay_safe = true` by default.
- Write contracts are `replay_safe = false` in v1. The replay action is
  rendered but disabled with a tooltip explaining why. This avoids
  re-running a plan apply or a settings write by accident from a
  diagnostic surface.
- A future research decision can introduce a confirmation flow that allows
  replaying write contracts with explicit consent.

## R7. Schema source of truth

**Question**: Does the viewer read schemas from disk or from a build-time
embedded copy?

**Decision**: From disk in v1. The schemas under `packages/contracts/`
are the source of truth and are read on demand. This keeps the surface
honest about which schema file backs which contract. In a production
build where the schemas are packaged as resources, the read goes through
the Tauri resource resolver. A missing schema is rendered as
`schema.missing` with the absolute path that was attempted.
