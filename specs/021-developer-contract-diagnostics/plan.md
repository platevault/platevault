# Implementation Plan: Developer Contract Diagnostics

**Branch**: `021-developer-contract-diagnostics` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/021-developer-contract-diagnostics/spec.md`

## Summary

Developer Contract Diagnostics is a hidden in-app surface at `/dev/contracts`,
reachable only through the command palette (Cmd+K / Ctrl+K) and only when
developer mode is enabled. It lists every registered UI-to-core contract with
its version and JSON Schema path, shows the last 100 contract calls captured
by an opt-in recording proxy, and renders the schema for each contract
inline. The original framework-review surface in the prototype has been
removed; this plan rebuilds the developer-only surface against the Base UI
design.

The recording proxy wraps the Tauri command dispatcher. When developer mode is
off, the proxy is bypassed at module load so there is no overhead in the hot
path (FR-008, SC-004). When developer mode is on, every dispatch captures the
contract name and version, the request and response (with declared sensitive
fields redacted), start time, and duration, and pushes the record into a
500-byte-bounded ring buffer of size 100. The buffer lives in the desktop
process and is not persisted across restarts.

## Technical Context

**Language/Version**: Rust 1.75+ (backend), TypeScript 5.x (desktop)  
**Primary Dependencies**: Tauri (command dispatcher and event channel), the
existing `crates/contracts/core` registry, the existing command palette  
**Storage**: None new. The recent-calls buffer is in-memory only; the
contract registry is generated at build time from `packages/contracts/`.  
**Testing**: `cargo test --workspace` for the registry exposure and the
redaction layer; desktop unit tests for the proxy ring buffer, route
gating, and command-palette filtering; contract tests for
`dev.contracts.list` and `dev.calls.list`.  
**Target Platform**: Desktop (Tauri on Windows/macOS/Linux).  
**Project Type**: Desktop application with a layered Rust core.  
**Performance Goals**: With developer mode off, zero added overhead on
contract dispatch. With developer mode on, recording adds no more than 1ms
p95 per call for payloads under 64 KB.  
**Constraints**: Single-window v1. Session-only buffer. Cmd+K is the only
navigation entry point.  
**Scale/Scope**: 100-entry ring buffer. Registry size grows with the number
of contracts but stays under a few hundred entries.

## Constitution Check

- **Local-first file custody**: PASS. The surface reads metadata and runtime
  state; it does not touch image files. Schema files are read-only.
- **Reviewable filesystem mutation**: PASS. The surface does not mutate the
  filesystem. Diagnostic export, when added, writes a single JSON file at a
  user-chosen path under the same `path.write.denied` envelope used by other
  write contracts.
- **PixInsight boundary**: PASS. The surface is debugging UI for contracts;
  it does not process images.
- **Research-led domain modeling**: PASS. Scope, exposure model, performance
  impact, and sensitive-field policy are recorded in `research.md`.
- **Portable contracts and durable records**: PASS. `dev.contracts.list` and
  `dev.calls.list` are language-neutral JSON Schemas. No durable record is
  introduced; the recent-calls buffer is intentionally ephemeral and is not
  a system of record.

## Project Structure

### Documentation (this feature)

```text
specs/021-developer-contract-diagnostics/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── dev.contracts.list.json
│   └── dev.calls.list.json
└── tasks.md
```

### Source Code (repository root)

```text
apps/desktop/src/
├── dev/
│   ├── ContractsPage.tsx           # /dev/contracts route, gated by devMode
│   ├── ContractList.tsx            # contract metadata table
│   ├── CallList.tsx                # recent-calls table
│   ├── SchemaViewer.tsx            # pretty-printed JSON Schema renderer
│   └── recorder.ts                 # ring buffer + dispatcher proxy
├── data/commandPalette.ts          # adds "Developer / Contracts" entry when devMode
└── routes.ts                       # registers /dev/contracts behind devMode

crates/
├── app/core/usecases/dev_contracts.rs   # list contracts + list calls
├── contracts/core/src/dev.rs            # Rust DTOs for the two contracts
└── contracts/core/src/registry.rs       # existing registry exposed to dev surface

packages/contracts/
└── dev/                                 # JSON Schemas mirrored from specs/.../contracts/
```

**Structure Decision**: Vertical slice. Desktop owns the proxy, the ring
buffer, route gating, and rendering. Rust core owns the contract registry
view and any audit-side concerns. No new persistence is introduced.

## Architecture

### Route Gating

`/dev/contracts` is registered unconditionally so deep links do not 404, but
the page component checks `devMode` from the settings store on mount. With
`devMode` off, the page renders a "developer mode disabled" stub and does
not subscribe to the call stream (FR-008 acceptance 2). With `devMode` on,
the page mounts the contract list, the recent-calls list, and the schema
viewer.

### Command Palette Entry

`apps/desktop/src/data/commandPalette.ts` filters its entry list by
`devMode`. The entry "Developer / Contracts" is appended only when `devMode`
is on. The palette is the single discoverable navigation entry (FR-010).
There is no top-nav or Settings link.

### Recording Proxy

`apps/desktop/src/dev/recorder.ts` exports a `wrap(dispatch)` higher-order
function. At app boot, the Tauri dispatcher is wrapped only when `devMode`
is on; otherwise the original dispatcher is used (FR-008, SC-004). The
wrapped dispatcher:

1. Reads the contract name and version from the call site.
2. Captures `started_at` with `performance.now()` and the wall-clock UTC.
3. Applies the redaction policy from `ContractMeta.sensitive_fields` to the
   request payload before storing.
4. Awaits the underlying dispatch.
5. Captures the response or error and the elapsed `duration_ms`.
6. Pushes a `ContractCall` into the ring buffer.

The ring buffer is FIFO with capacity 100 and oldest-first eviction.
Payloads larger than 64 KB are truncated with a marker preserved in the
stored record (`payload_truncated = true`).

### Contract Registry View

`crates/app/core/usecases/dev_contracts.rs` exposes a read-only view over
the existing `crates/contracts/core` registry. It returns one
`ContractMeta` per registered operation, including the absolute path to the
JSON Schema in `packages/contracts/`. The use-case is the only entry point
for the desktop layer to learn what contracts exist.

### Mismatch Detection

At startup, the desktop side compares the TypeScript-generated registry
hash to the Rust-side registry hash. A mismatch surfaces in the contract
list as an inline warning on the affected rows (FR-006). The mismatch
record is computed once and read from a settings-store-adjacent diagnostic
slot; it is not persisted across restarts.

### Schema Viewer

`SchemaViewer.tsx` reads the JSON Schema for the selected contract from
`packages/contracts/` via a Tauri file read, pretty-prints it with
two-space indentation, and exposes a copy-to-clipboard action. The viewer
is purely presentational and does no network work.

### Replay

The replay action on a call row re-dispatches the captured request through
the same wrapped dispatcher when `ContractMeta.replay_safe = true`.
Write-side contracts have `replay_safe = false` in v1 and the action is
disabled with a tooltip explaining why. The replay produces a new
`ContractCall` record; it does not mutate the original.

## Complexity Tracking

No constitution violations.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    |            |                                      |
