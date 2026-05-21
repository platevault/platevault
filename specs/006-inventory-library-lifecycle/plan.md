# Implementation Plan: Inventory Lifecycle

**Branch**: `006-inventory-library-lifecycle` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-inventory-library-lifecycle/spec.md`

## Summary

Inventory is the stable, reviewed working library that sits between Inbox and
project workflows. It groups discovered acquisition and calibration sessions
by source root, surfaces frame type and review state without ambiguous
"tags" or "handling" controls, and exposes a small set of action-bound CTAs
and overflow items tied to the lifecycle state machine defined in spec 002.

The current desktop mockup at `apps/desktop/src/features/inventory/InventoryPage.tsx`
already realises the visual shape of this surface against an in-process store
at `apps/desktop/src/data/store.ts`. This plan keeps the UI as-is and replaces
the in-process publisher with two Tauri commands that read from the canonical
record store in `crates/persistence/db/` via `crates/fs/inventory/` scan
records and `crates/sessions/` session aggregation. A future filesystem
watcher in `crates/fs/inventory/` will push delta updates on the same
contract; live updates are out of scope for v1.

State family alignment: the mockup uses three review states (`confirmed |
needs_review | rejected`) for `InventorySession`. The canonical state family
in spec 002 has six states (`discovered | candidate | needs_review |
confirmed | rejected | ignored`). The Tauri adapter projects `discovered`
and `candidate` into a presentational `needs_review` bucket for the ledger
and surfaces `ignored` only via filter; the underlying record keeps its full
state.

## Technical Context

**Language/Version**: Rust 1.83 (workspace), TypeScript 5.6 (apps/desktop),
JSON Schema Draft 2020-12 (`packages/contracts/`)
**Primary Dependencies**: `serde`, `thiserror`, `uuid`, `time`, `sqlx`,
Tauri 2.x command surface; React + Mantine on the UI side; reuses domain
types from spec 002 (`AcquisitionSession`, `CalibrationSession`,
`LibraryRoot`).
**Storage**: SQLite via `crates/persistence/db/`. Inventory rows are
projections of session aggregations joined to `FileRecord` and `LibraryRoot`
tables — not a separate physical store.
**Testing**: `cargo test --workspace` for unit + integration of the
inventory projection; JSON-Schema fixture tests for the two contracts;
Vitest for the Tauri adapter shape; Playwright MCP smoke test for the
grouped ledger and drawer once the Rust port lands.
**Target Platform**: Local desktop (Tauri shell). Contract is portable to a
future remote service.
**Project Type**: Tauri + React desktop app over a Rust workspace.
**Performance Goals**: `inventory.list` returns in <50ms p95 for a library
of 10k sessions / 100k files on local SQLite; filter changes do not
re-fetch from disk.
**Constraints**:
- No filesystem mutation from this surface (only review-state transitions).
- Review-state transitions go through `lifecycle.transition` (spec 002);
  this spec adds the session-scoped wrapper `inventory.session.review`.
- Ledger MUST NOT show confidence/evidence/provenance columns (spec 002
  FR-006); they live in the drawer.
- Source-state surfacing reads from `LibraryRoot.state` (spec 002) — this
  spec does not own that state machine.
**Scale/Scope**: 1 grouped ledger view, 3 filters, 1 drawer, 2 Tauri command
pairs, 0 new domain entities (re-uses spec 002).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Local-first file custody**: PASS. Inventory acts only on records; no
  source files are copied or moved by this surface.
- **Reviewable filesystem mutation**: PASS. The only mutation is the
  review-state transition on a session. No filesystem ops are triggered
  from this surface; "Reveal in OS" opens the native file browser only.
- **PixInsight boundary**: PASS. Inventory describes organisation and
  review of source material; it does not calibrate, register, integrate,
  or edit.
- **Research-led domain modeling**: PASS. Grouping strategy, frame-type
  vocabulary including the `mixed` sentinel, review-state projection from
  the spec-002 family, source-state surfacing, and drawer field ordering
  are documented in research.md before any Rust changes.
- **Portable contracts and durable records**: PASS. Two JSON-Schema
  contracts (`inventory.list`, `inventory.session.review`) are authored
  here and copied into `packages/contracts/` at build time. SQLite remains
  the durable record.
- **Cross-platform path safety**: PASS. Path display uses
  `LibraryRoot.current_path` + relative paths; the surface never mutates
  paths.

Re-check after Phase 1: gates remain green provided
`inventory.session.review` wraps `lifecycle.transition` with a pre-filled
`entity_type: "acquisition_session"` (or `calibration_session`) and refuses
review actions on a session whose owning `LibraryRoot` is `missing` —
mirrored as `state.unchanged` only when the request actually matches
current state.

## Project Structure

### Documentation (this feature)

```text
specs/006-inventory-library-lifecycle/
├── plan.md                              # This file
├── spec.md                              # FRs + implementation status
├── research.md                          # Phase 0 decisions
├── data-model.md                        # Inventory projection entities
├── contracts/
│   ├── inventory.list.json              # List + filter contract
│   └── inventory.session.review.json    # Review transition wrapper
└── tasks.md                             # Phase 2 task graph
```

### Source Code (repository root)

```text
crates/
├── fs/inventory/                        # Scan + FileRecord + LibraryRoot
│   └── src/projection.rs                # NEW: inventory list projection
├── sessions/                            # AcquisitionSession +
│   └── src/lib.rs                       #   CalibrationSession aggregation
├── domain/core/                         # State family lives in spec 002.
├── persistence/db/                      # Read repositories for the join.
├── contracts/core/                      # Rust DTO mirrors.
│   └── src/inventory.rs                 # NEW
└── app/core/                            # Use cases.
    └── src/usecases/inventory.rs        # NEW: list, review wrapper

packages/contracts/
├── inventory.list.json                  # Source-of-truth copy.
├── inventory.session.review.json        # Source-of-truth copy.
└── generated/                           # TS types.

apps/desktop/src/
├── features/inventory/                  # UNCHANGED — already mockup-done.
└── data/
    ├── store.ts                         # Replace publisher with Tauri.
    └── mock.ts                          # Keep as types-only fallback.
```

**Structure Decision**: Inventory is implemented as a read projection in
`crates/fs/inventory/` joined across `crates/sessions/` and
`crates/persistence/db/`. Review actions delegate to spec 002's
`lifecycle.transition` use case via a thin session-scoped wrapper in
`crates/app/core/`. The desktop UI keeps the component tree at
`apps/desktop/src/features/inventory/` intact; only `data/store.ts` is
replaced with a Tauri adapter that preserves the hook signatures
(`useInventorySources`, `setSessionReviewState`, `getInventorySources`).

## Complexity Tracking

> No constitution violations. Section intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Out of Scope

- Live filesystem watcher and push updates (deferred to a follow-up).
- Inventory-side cleanup/archive planning (covered by separate specs).
- Calibration master derivation (PixInsight boundary).
- Target catalog lookup and alias resolution.
