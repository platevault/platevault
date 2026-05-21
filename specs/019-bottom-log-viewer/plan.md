# Implementation Plan: Bottom Log Viewer

**Branch**: `019-bottom-log-viewer` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/019-bottom-log-viewer/spec.md`

## Summary

The bottom log viewer is a full-width fold-out panel that surfaces recent
operation and lifecycle events with a fixed level filter, a bounded ring
buffer, and a remembered follow-tail preference. The desktop mockup is the
working reference: `LogPanel.tsx` renders the panel; `store.ts` owns a
500-entry in-memory ring buffer fed by `appendLog`. The plan promotes the
mockup's session-only buffer to a backend-streamed projection of durable
audit events: `crates/audit/` is the canonical record, `crates/app/core`
exposes a cursor-based subscription and a JSON export use-case, and the
desktop hook subscribes through a Tauri stream channel while keeping the
ring buffer as a UI-side projection. No new persistence model is introduced;
the log viewer reads what audit already writes plus a small set of diagnostic
events that bypass audit on purpose (see research R2).

## Technical Context

**Language/Version**: Rust 1.75+ (backend), TypeScript 5.x (desktop)
**Primary Dependencies**: Tauri (desktop adapter with event streams),
`crates/app/core`, `crates/audit`, `crates/contracts/core`
**Storage**: None new. Durable history lives in the `crates/audit/` log
already backed by SQLite under `crates/persistence/db/`. The UI buffer is
in-memory only.
**Testing**: `cargo test --workspace` for the stream and export use-cases and
contract round-tripping; desktop unit tests for the ring buffer and level
filter; contract tests against `packages/contracts/log/`.
**Target Platform**: Desktop (Tauri on Windows/macOS/Linux).
**Project Type**: Desktop application with a layered Rust core.
**Performance Goals**: Streamed entries reach the UI in <100ms p95 from
emission; export of the full 500-entry buffer completes in <500ms p95.
**Constraints**: Single-window v1. No remote subscribers. No log streaming
across libraries.
**Scale/Scope**: Bounded UI buffer (500). Underlying audit table is the
durable bound; the viewer does not page into history in v1.

## Constitution Check

- **Local-first file custody**: PASS. The viewer reads metadata and audit
  events; it does not touch image files. Export writes a single JSON file at
  a user-chosen path.
- **Reviewable filesystem mutation**: PASS. The viewer surfaces plan create,
  apply progress, and discard events. It never performs filesystem mutation.
  Export to a path is governed by the same `path.write.denied` error surface
  used by other write contracts.
- **PixInsight boundary**: PASS. The viewer surfaces events about processing
  artifact observation but never runs processing.
- **Research-led domain modeling**: PASS. Ring vs append-only, severity
  partitioning, follow-tail behavior, color coding, and retention are
  recorded in `research.md`.
- **Portable contracts and durable records**: PASS. `log.stream` and
  `log.export` are language-neutral JSON Schemas. The audit table remains
  the canonical record; the viewer is a derived projection. The export
  artifact is reproducible from audit.

## Project Structure

### Documentation (this feature)

```text
specs/019-bottom-log-viewer/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── log.stream.json
│   └── log.export.json
└── tasks.md
```

### Source Code (repository root)

```text
apps/desktop/src/
├── ui/LogPanel.tsx                  # bottom fold-out, level filter, follow toggle
├── data/store.ts                    # appendLog, useLog, 500-entry ring buffer
└── data/logSubscription.ts          # future: Tauri stream subscriber

crates/
├── app/core/usecases/log_stream.rs  # future: cursor-based stream + export
├── audit/                           # canonical event source (existing)
├── contracts/core/src/log.rs        # future: Rust DTOs for log contracts
└── persistence/db/                  # audit table (existing)

packages/contracts/
└── log/                             # JSON Schemas mirrored from specs/.../contracts/
```

**Structure Decision**: Vertical slice. Desktop owns presentation, ring
buffer, and the cursor cache. Rust core owns the stream cursor and the
export use-case. Audit remains untouched as the canonical store.

## Architecture

### Canonical Source

Audit events in `crates/audit/` are canonical. The log viewer maps each
audit event to a `LogEntry` projection plus a small set of diagnostic events
that emit through the same channel but are not persisted (see research R2).
The mapping is one-way; the viewer never writes back into audit.

### Stream Channel

`log.stream` is a cursor-based subscription. The client opens with an
optional `cursor`; the backend responds with an initial `added: LogEntry[]`
window from the cursor forward and pushes subsequent `added` events as new
entries are emitted. A stale cursor returns `cursor.invalid` and the client
restarts with no cursor, which yields the most recent N entries up to the
configured window (500).

The Tauri adapter exposes the stream as a typed event channel. The desktop
subscriber writes entries through `appendLog`, which dedupes by `id` and
enforces the 500-entry ring.

### Ring Buffer (UI Projection)

The ring buffer lives in `apps/desktop/src/data/store.ts`. It is FIFO with
oldest-first eviction. The buffer is not persisted across app restarts;
restart re-subscribes with no cursor and rehydrates from the audit-backed
stream. The buffer size is a compile-time constant in v1 (`LOG_BUFFER_SIZE
= 500`).

### Follow-Tail State

Follow-tail is a per-device preference persisted under the existing
`rememberFollowLogs` settings key (already declared in
`specs/018-settings-configuration-model/data-model.md`). The panel reads it
on mount and writes it on toggle through `updateSettings`. The settings
write path applies the same no-op guard already in place, so toggling
follow during a busy stream does not flood audit.

### Level Filter

The level filter is a UI-only piece of state in v1. It defaults to `all` on
every panel open. The spec leaves persistence open; the plan chooses
session-only because persisting it interacts poorly with diagnostic
sessions where the user wants the next session to start with `all` visible.

### Export Use-Case

`log.export` materializes the current filtered window into a JSON file at a
user-chosen path. The request accepts an optional minimum level, an
optional `since` ISO-8601 timestamp, and an optional `until` ISO-8601
timestamp; the response returns the absolute file path and the entry
count. The format is fixed to `json` per FR-007; the request still carries
a `format` field to keep the contract forward-compatible without exposing
a user-facing format setting.

Export reads from audit, not from the UI ring buffer, so the file is
reproducible regardless of UI state. The optional `since`/`until` bounds
cap how much history is included. A future bound on absolute size is
deferred to research R5.

### Diagnostic Events

A small set of events emit through the same stream channel but are not
written to audit: log-viewer-internal diagnostics (`cursor.invalid`,
subscriber reconnect), reduced-motion preference reads, and pure render
warnings. These are tagged with `source = "diagnostic"` and `entity_type`
omitted so that downstream consumers can filter them out.

## Complexity Tracking

No constitution violations.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    |            |                                      |
