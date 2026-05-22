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

**Options considered**:

1. **Visible by default in all builds**. Cons: violates FR-001 and SC-001;
   normal users discover developer plumbing.
2. **Build-flag only** (e.g., compiled into dev builds, stripped from
   production). Pros: zero overhead in production. Cons: developers running
   the production build cannot debug a user's report without a custom build.
3. **Runtime toggle, hidden by default**. The setting key `devMode` defaults
   to `false`; runtime toggle only. Recording proxy is bypassed at module load
   when `devMode` is off.
4. **Combined: compile-time `dev-tools` feature + runtime toggle** (chosen,
   A-021-2, R-DevFeature).

**Decision**: Option 4 — compile-time + runtime hybrid.

- **Compile-time gate** (`dev-tools` Cargo feature): Release builds are
  compiled WITHOUT `dev-tools`. This strips the `/dev/contracts` route, the
  recording proxy, and the `dev.contracts.list` / `dev.calls.list` Tauri
  commands from the binary entirely. Zero overhead, zero surface area in
  production.
- **Runtime toggle** (`devMode`, Settings store, boolean, default `false`):
  In `dev-tools` builds, the toggle controls whether the proxy is installed
  at app boot. Toggling off requires an app restart for full proxy uninstall.
  Route gating and the command-palette entry react immediately (no restart
  needed for the UI gate).
- **Restart requirement** (A-021-1): FR-008 acceptance scenario 4 documents
  the restart requirement for full proxy uninstall. Scenario 5 notes that
  recording continues until restart when toggled off mid-session (informational,
  not a fail condition).
- The `dev-tools` Cargo feature addition to `crates/app/core` and the root
  workspace `Cargo.toml` is deferred to the Rust implementation phase; do NOT
  edit `Cargo.toml` or `tauri.conf.json` in the spec session.

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

**Decision** (updated by A-021-3): Redaction is contract-declared AND paths
are REDACTED BY DEFAULT.

- Any field named `password`, `token`, `secret`, or `api_key` at any depth
  is replaced with `"<redacted>"`.
- **All filesystem paths are redacted by default.** Path values (any field
  whose value looks like an absolute filesystem path) are replaced with a
  sanitized placeholder of the form `${LIBRARY_ROOT}/Andromeda/Light/...`
  where the library root prefix is replaced by the `${LIBRARY_ROOT}` token
  and the remainder of the path is retained for readability.
- Per-export opt-in: the diagnostic export action accepts
  `includeVerbatimPaths: boolean` (default `false`). When `true`, paths are
  included verbatim in the export JSON. This toggle is per-export and NOT
  stored in the ring buffer (which always uses redacted paths).
- Contracts may extend the default sensitive-field set per operation via
  `ContractMeta.sensitive_fields`.
- **Settled decision (C-021-3 — `ts_hash` / `rust_hash` algorithm)**: Use
  SHA-256. Hash content is the canonical JSON serialization of the schema
  with deterministic key ordering. This is consistent with spec 014 catalog
  checksums.

## R5. Cursor and reset semantics

**Question**: Does the recent-calls list have a cursor or is it always the
last 100?

**Decision**: Always the last 100. There is no cursor and no paging in v1.
The buffer is in-memory and resets on app restart; durable replay belongs
to a future audit-backed feature, not to this surface.

## R6. Replay safety

**Question**: Which contracts may be replayed from the developer surface?

**Decision** (updated by A-021-4):

- `replay_safe` DEFAULTS TO `false`. All contracts are opt-out of replay
  unless they explicitly declare `replay_safe: true`.
- Read-only contracts MAY declare `replay_safe: true` if reviewed and
  appropriate.
- Write contracts MUST NOT set `replay_safe: true` unless present in an
  explicit allow-list entry (enforced by CI lint snapshot test, T037).
- The replay action is rendered but disabled with a tooltip ("Write contracts
  cannot be replayed from the developer surface") when `replay_safe = false`.
- A future research decision can introduce a confirmation flow that allows
  replaying write contracts with explicit consent.

**Rationale for default-false**: Opt-in is safer — it prevents accidental
re-execution of state-mutating contracts from a diagnostic surface. The
opt-in is explicit and reviewable at the contract level.

## R8. Ring buffer worst-case memory (settled, C-021-1)

**Question**: Is 13 MB ring buffer memory acceptable?

**Decision**: Accepted. 100 entries × 64 KB (request + response) = 13 MB
worst-case. This is acceptable for a developer-only surface. The threshold
is a compile-time constant in v1; a research decision is required to raise it.

## R9. `ts_hash` / `rust_hash` algorithm (settled, C-021-3)

**Decision**: SHA-256. Hash content = canonical JSON serialization of the
schema with deterministic (sorted) key ordering. Consistent with spec 014
catalog checksums. See also R4 above.

## R10. Export contract (C-021-4)

**Decision**: A new `dev.export.json` contract is defined for the diagnostic
export action. It accepts `includeVerbatimPaths: boolean` (default `false`)
in its request. The contract uses camelCase envelope. See
`contracts/dev.export.json` (new file, created in this pass).

## R7. Schema source of truth

**Question**: Does the viewer read schemas from disk or from a build-time
embedded copy?

**Decision**: From disk in v1. The schemas under `packages/contracts/`
are the source of truth and are read on demand. This keeps the surface
honest about which schema file backs which contract. In a production
build where the schemas are packaged as resources, the read goes through
the Tauri resource resolver. A missing schema is rendered as
`schema.missing` with the absolute path that was attempted.
