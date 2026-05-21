# Implementation Plan: Data Lifecycle State Model

**Branch**: `002-data-lifecycle-state-model` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-data-lifecycle-state-model/spec.md`

## Summary

Define and implement the data lifecycle state model — observed facts, inferred
metadata, reviewed decisions, generated projections, planned mutations, and
applied mutations — as an asset-first model with field-level provenance, gated
transitions, and audit-event emission. A UI mockup currently shadows a subset
of the model in `apps/desktop/src/data/`. Canonical implementation moves the
types into Rust workspace crates (`crates/domain/core/`, `crates/audit/`,
`crates/fs/planner/`, `crates/persistence/db/`), exposes a language-neutral
transition contract through `packages/contracts/`, and wires the desktop UI to
consume the contract via Tauri commands instead of the in-process mockup.

The state families come from Spec 001 research and are frozen by spec.md
§State Families. The transition graph for Project lifecycle is established by
the mockup's `PROJECT_TRANSITIONS` table; other families' transition graphs
are decided in research.md.

## Technical Context

**Language/Version**: Rust 1.83 (workspace), TypeScript 5.6 (apps/desktop), JSON
Schema Draft 2020-12 (`packages/contracts/`)
**Primary Dependencies**: `serde`, `thiserror`, `uuid`, `time`, `sqlx` (already
constitutionally chosen via toolchain defaults); Tauri 2.x command surface;
React + Mantine on the UI side
**Storage**: SQLite via `crates/persistence/db/` (canonical local store for
asset state, lifecycle events, plans, audit log). Generated manifests remain
projections; the database is the durable record.
**Testing**: `cargo test --workspace` for unit + integration; JSON-Schema
fixture tests for contracts; Vitest for TypeScript adapter shape; Playwright
MCP smoke for UI wiring after Rust port lands.
**Target Platform**: Local desktop (Tauri shell on Windows / macOS / Linux);
contract is portable to a future remote service.
**Project Type**: Tauri + React desktop app over a Rust workspace.
**Performance Goals**: Lifecycle transitions and audit writes complete in <50ms
p95 on a local SQLite store with 100k assets and 1M audit events.
**Constraints**: No silent overwrite of source files; lifecycle transitions
MUST be transactional with their audit-event write; same-state writes MUST be
no-ops; refused transitions MUST log without mutating; ledger rows MUST omit
confidence/evidence/provenance columns (FR-006).
**Scale/Scope**: 6 lifecycle state families, ~10 entities, 1 JSON-Schema
contract surface, 1 Tauri command pair (`lifecycle.transition.preview`,
`lifecycle.transition.apply`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Local-first file custody**: PASS. The lifecycle model never mandates
  copying or moving source files; transitions act on records about files.
  `LibraryRoot` is modeled separately from path relativity (data-model.md).
- **Reviewable filesystem mutation**: PASS. Every transition that implies a
  filesystem effect (e.g. project `prepared → processing` that creates a
  Prepared Source view) routes through `FilesystemPlan` (Spec 025) and emits
  audit events. The contract returns the resulting plan id when a plan is
  required and refuses the apply call until the plan is approved.
- **PixInsight boundary**: PASS. State families describe organization,
  preparation, and outcome tracking only. No state implies calibration,
  registration, integration, drizzle, or editing.
- **Research-led domain modeling**: PASS. State-name selection, transition
  graph, action-bound review semantics, provenance separation, no-op guards,
  and projection-staleness propagation are documented in research.md before
  Rust crates are touched.
- **Portable contracts and durable records**: PASS.
  `contracts/lifecycle.transition.json` is a language-neutral JSON Schema with
  versioning, error taxonomy, and long-running operation handle. SQLite is the
  durable record; manifests stay projections.
- **Cross-platform path safety**: PASS at this layer. Path concerns live in
  `crates/fs/inventory/` and the planner; this spec only references those
  records by id. Hashing remains lazy per Spec 001.

Re-check after Phase 1 design: gates remain green provided the
`lifecycle.transition.json` contract includes a `plan_id` discriminator for
transitions that imply filesystem effects and refuses to apply them without an
approved plan.

## Project Structure

### Documentation (this feature)

```text
specs/002-data-lifecycle-state-model/
├── plan.md                           # This file
├── spec.md                           # Frozen state families + FRs
├── research.md                       # Phase 0 decisions (this round)
├── data-model.md                     # Phase 1 entity + transition tables
├── contracts/
│   └── lifecycle.transition.json     # JSON-Schema contract
└── tasks.md                          # Phase 2 task graph
```

### Source Code (repository root)

```text
crates/
├── domain/core/                      # Canonical home for Data Asset, state
│   ├── src/lifecycle/                #   families, transition graphs, no-op
│   │   ├── project.rs                #   guards. Currently shadowed in
│   │   ├── plan.rs                   #   apps/desktop/src/data/mock.ts.
│   │   ├── session.rs
│   │   ├── inventory.rs
│   │   ├── data_source.rs
│   │   ├── prepared_source.rs
│   │   ├── provenance.rs             # Observed | Inferred | Reviewed tags
│   │   └── mod.rs
│   └── tests/transitions.rs
├── audit/                            # Audit-event model, persisted alongside
│   └── src/event.rs                  #   transitions; consumes domain types.
├── fs/planner/                       # FilesystemPlan model already; this
│   └── src/lib.rs                    #   feature adds `requires_plan` flag
│                                     #   to lifecycle transitions.
├── persistence/db/                   # SQLite schema for assets, events,
│   ├── migrations/                   #   plans. Tables in data-model.md.
│   └── src/repositories/lifecycle.rs
├── contracts/core/                   # Rust DTOs mirroring JSON Schema.
│   └── src/lifecycle.rs
└── app/core/                         # `transition_preview` and
    └── src/usecases/lifecycle.rs     #   `transition_apply` use cases.

packages/contracts/
├── lifecycle.transition.json         # Source-of-truth schema (copied from
│                                     #   specs/.../contracts/ at build time).
└── generated/                        # Generated TS surface.

apps/desktop/src/
├── data/store.ts                     # CURRENT mockup; replace with thin
├── data/mock.ts                      # adapter once Rust port lands.
└── features/                         # No structural change — components keep
                                      # consuming hooks; the hooks switch from
                                      # in-memory publisher to Tauri commands.
```

**Structure Decision**: Lifecycle domain types live in `crates/domain/core/`
behind a `lifecycle` module, audit events live in `crates/audit/`, persistence
lives in `crates/persistence/db/`, and the language-neutral contract is in
`packages/contracts/` (with the canonical authored copy under this spec's
`contracts/` directory). The desktop UI keeps its current component tree; only
`apps/desktop/src/data/store.ts` is replaced with a Tauri adapter that
preserves the existing hook signatures so component code (`ProjectsPage`,
`PlanDetailPage`, `InventoryPage`) is untouched by the migration.

## Complexity Tracking

> No constitution violations. Section intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
