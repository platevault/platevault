# Implementation Plan: Cleanup And Archive Review Plans

**Branch**: `017-cleanup-archive-review-plans` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-cleanup-archive-review-plans/spec.md`

## Summary

Reviewable filesystem plans are the gating surface between plan *generation*
(by per-origin generators) and plan *application* (by spec 025's executor).
This spec defines the review state machine, list/detail UX, approve gate,
discard rules, and retry-as-new-plan semantics. The current `apps/desktop/`
mockup already implements the surface end-to-end against an in-memory store;
this plan documents the architecture so the same surface can be backed by real
generators and the durable plan store.

## Technical Context

**Language/Version**: Rust 1.78 (workspace), TypeScript 5.5 (desktop shell).  
**Primary Dependencies**: Tauri 2 IPC, React 18, Mantine 7 (UI), serde + JSON
Schema for contracts, SQLite via the `crates/persistence/db/` boundary.  
**Storage**: SQLite is canonical for plans, plan items, and audit events.
Generated archive manifests and source views are reproducible projections.  
**Testing**: `cargo test --workspace` for crates, `pnpm test` (Vitest) for
desktop, contract-driven JSON Schema tests for the operation surface.  
**Target Platform**: Tauri desktop on Windows/macOS/Linux.  
**Project Type**: Desktop app + workspace crates.  
**Performance Goals**: List render under 100 ms for ≤200 plans; detail render
under 150 ms for ≤2000 items.  
**Constraints**: Plan generation MUST be read-only; review actions MUST be
durable and audited; retry MUST never mutate the parent plan.  
**Scale/Scope**: Single-user local libraries with plan histories of low
thousands; per-plan item counts up to ~10⁵ for restructure plans.

## Constitution Check

- **Local-first file custody**: Plans reference user-owned paths via library
  roots + relative paths. The plan store is metadata-only; no image files are
  copied or moved by review actions in this spec.
- **Reviewable filesystem mutation**: This *is* the review surface. No item
  mutation happens here; apply is owned by spec 025. Approve is the explicit
  gate; retry is a new plan with an audit trail.
- **PixInsight boundary**: No calibration/registration/integration is added.
- **Research-led domain modeling**: Plan state vocabulary, retry semantics,
  default ordering, cancellation semantics, and platform-specific trash/archive
  behavior are decided in `research.md` before implementation.
- **Portable contracts and durable records**: All review operations are
  defined as language-neutral JSON Schema contracts under `contracts/`. The
  durable record is in SQLite (`crates/persistence/db/`); manifests projected
  from the plan store are reproducible.
- **Cross-platform path safety**: Paths in the plan model are stored as
  `(root_id, relative_path)` pairs; review-side rendering MUST tolerate
  missing roots without losing plan history.

## Architecture

Plan generators per origin emit plans; this spec defines the review surface;
spec 025 defines the apply executor.

```
┌────────────────────────┐    plans    ┌────────────────────────┐    approved    ┌────────────────────────┐
│  Origin generators     ├────────────▶│  Review surface (017)  ├───────────────▶│  Apply executor (025)  │
│  inbox / restructure / │             │  list, detail, approve,│                │  per-item exec, log,   │
│  cleanup / archive /   │             │  discard, retry        │                │  partial/cancel, final │
│  project source-map    │             │                        │                │  state                 │
└────────────────────────┘             └──────────┬─────────────┘                └──────────┬─────────────┘
                                                  │                                          │
                                                  └───────────────► durable plan store ◄─────┘
                                                                  (crates/persistence/db/)
```

Boundaries:

- **Generators** live behind use cases in `crates/app/core/` and write only
  *new* plans + items. They never edit existing plans.
- **Review surface** (this spec) reads plans + items and writes only the
  review-side states (`draft`, `ready_for_review`, `approved`) plus discard.
- **Apply executor** (spec 025) writes only the apply-side states (`applying`,
  `applied`, `partially_applied`, `failed`, `cancelled`) and per-item state
  transitions.

Crate touchpoints:

- `crates/fs/planner/`: already models plans and items. This spec sharpens the
  review state machine and adds `parent_plan_id` to the entity.
- `crates/app/core/`: hosts the review use cases — `list_plans`, `get_plan`,
  `approve_plan`, `discard_plan`, `retry_plan`.
- `crates/contracts/core/`: Rust DTOs mirroring the JSON Schema contracts.
- `crates/audit/`: every review write emits an audit event.
- `crates/persistence/db/`: tables for plans, plan items, audit events.
- `packages/contracts/`: language-neutral JSON Schemas (the contracts in this
  spec).
- `apps/desktop/`: existing mockup pages migrate from the mock store to the
  Tauri command surface bound to the contracts.

## Project Structure

### Documentation (this feature)

```text
specs/017-cleanup-archive-review-plans/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── plan.list.json
│   ├── plan.get.json
│   ├── plan.approve.json
│   ├── plan.discard.json
│   └── plan.retry.json
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/desktop/
├── src/features/plans/
│   ├── PlansListPage.tsx        # implemented (mockup)
│   └── PlanDetailPage.tsx       # implemented (mockup)
└── src/data/store.ts            # mock plan store → migrate to Tauri IPC

crates/
├── fs/planner/                  # Plan + PlanItem entities, state machine
├── app/core/                    # review use cases
├── contracts/core/              # Rust DTOs for the review contracts
├── persistence/db/              # plan/plan_item/audit tables
└── audit/                       # audit event model

packages/contracts/
└── plans/                       # generated TS types from JSON Schema
```

**Structure Decision**: Reuse the existing monorepo layout. No new crates are
required; this spec sharpens behavior on already-bounded crates and adds
contracts to `packages/contracts/`. UI lives in the existing
`apps/desktop/src/features/plans/` folder.

## Complexity Tracking

No constitutional violations.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
