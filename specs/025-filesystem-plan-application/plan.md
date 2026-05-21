# Implementation Plan: Filesystem Plan Application

**Branch**: `025-filesystem-plan-application` | **Date**: 2026-05-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/025-filesystem-plan-application/spec.md`

## Summary

Implement the **apply executor** for reviewed filesystem plans. Plans arrive
from spec 017 (Cleanup And Archive Review Plans) in `approved` state with an
approval token. The executor walks items sequentially, performs the requested
filesystem operation (move, archive, remove generated source view, delete via
trash), writes audit events per item state transition, and computes a
terminal plan state (`applied`, `partially_applied`, `failed`, `cancelled`)
once all items resolve. Item-level retry, item-level skip, and run-level
cancellation are also owned here. Plan-level retry (creating a new plan from
failed items of a terminal one) belongs to 017.

## Technical Context

**Language/Version**: Rust 1.75+ (executor crate), TypeScript 5+ (Tauri command surface), shared via `packages/contracts/`.
**Primary Dependencies**: `tokio` (long-running operation), `serde`/`serde_json` (contracts), `thiserror` (failure taxonomy), `tracing` (audit instrumentation). No new heavy deps. Filesystem primitives via std::fs + `fs_extra` (cross-volume copy-then-delete) gated by research outcome.
**Storage**: SQLite via `crates/persistence/db/`. The `plans` and `plan_items` tables are shared with 017; this feature adds `plan_apply_events` for audit and may add a `plan_runs` row per apply attempt.
**Testing**: `cargo test --workspace` for crate logic; Vitest for the desktop adapter; Playwright MCP for the apply panel.
**Target Platform**: Tauri desktop (Windows, macOS, Linux).
**Project Type**: Monorepo (Rust workspace + Tauri/React app + language-neutral JSON Schemas).
**Performance Goals**: Plan with 10k items emits item progress events within 50 ms of state transition; idle-time CPU during apply <10% baseline outside of FS I/O.
**Constraints**: No image processing. No silent overwrite. Filesystem writes go through `crates/fs/planner/` primitives. Cancellation must halt within one item boundary.
**Scale/Scope**: Plans up to ~10k items; single active apply per plan at a time; one machine.

## Constitution Check

- **Local-first file custody**: Yes. Source files stay where the user put them. The apply executor only mutates paths the user approved in the reviewed plan. Library roots are referenced via the path model owned by `crates/fs/inventory/`.
- **Reviewable filesystem mutation**: Yes. Apply is gated by an approval token from 017. Every item attempt writes an audit event (`PlanApplyEvent`). Destructive items prefer trash/archive via the existing planner primitives.
- **PixInsight boundary**: Yes. The executor performs filesystem operations only — no calibration, debayer, stack, drizzle, or image edit.
- **Research-led domain modeling**: Cross-platform move semantics, archive vs trash by OS, failure taxonomy, partial-progress preservation, and per-item retry primitives are documented in `research.md`.
- **Portable contracts and durable records**: Apply, cancel, item-skip, and item-retry are JSON Schemas under `contracts/`. SQLite holds durable audit records; Tauri is the first adapter.
- **Cross-platform path safety**: Atomic same-volume rename where possible; copy-then-delete across volumes; explicit handling of permission, conflict, source-missing, removable-drive eject. See research.md.

No violations. No complexity tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/025-filesystem-plan-application/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── plan.apply.json
│   ├── plan.cancel.json
│   ├── plan.item.skip.json
│   └── plan.item.retry.json
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
crates/
├── fs/planner/                       # shared plan + plan-item shapes (already exists, used by 017 too)
├── fs/executor/                      # NEW: apply executor crate (sequential walker, cancellation, audit emit)
├── app/core/                         # use-case orchestration; adds usecases/plan_apply.rs
├── audit/                            # audit event model; adds PlanApplyEvent
├── persistence/db/                   # adds migration for plan_apply_events table
└── contracts/core/                   # Rust DTOs for plan.apply / cancel / item.skip / item.retry

apps/desktop/
├── src/data/store.ts                 # mockup (kept until real executor lands)
└── src/features/plans/PlanDetailPage.tsx
└── src-tauri/                        # Tauri command bindings for the four contracts

packages/contracts/                   # generated TS types from the four JSON Schemas

tests/
├── contract/plan_apply.spec.ts
├── integration/apply_partial.rs
└── integration/apply_cancel.rs
```

**Structure Decision**:

- The apply executor lives in a **new** crate `crates/fs/executor/` so it can be
  tested without pulling in the planner's generation logic or the persistence
  adapter. It depends on `crates/fs/planner/` (plan shapes), `crates/audit/`
  (events), and exposes a `tokio` async driver behind a trait so tests can
  substitute an in-memory filesystem.
- Use-case wiring lives in `crates/app/core/src/usecases/plan_apply.rs` and
  composes executor + persistence + audit + contracts DTOs.
- The four contracts are JSON Schema in `specs/025-.../contracts/` (this
  spec is the source of truth) and code-generated into Rust
  (`crates/contracts/core/`) and TypeScript (`packages/contracts/`).
- The mockup `simulateApply` in `apps/desktop/src/data/store.ts` remains the UI
  source until the real executor is wired through Tauri.

### Idempotency & transactionality

- Apply is **idempotent on re-apply for `approved` plans**: items in
  `succeeded` are skipped, items in `failed` are preserved (not retried
  automatically), items in `pending` are executed.
- Each item state transition is written inside a SQLite transaction along
  with its audit event row so the UI can never observe a state without the
  corresponding event.
- The plan terminal state row update is also transactional with the final
  audit event.

## Complexity Tracking

No constitutional violations. No entries.
