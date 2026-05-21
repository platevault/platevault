# Implementation Plan: Project Lifecycle Model

**Branch**: `009-project-lifecycle-model` | **Date**: 2026-05-09 | **Spec**:
[spec.md](./spec.md)

## Summary

The Project lifecycle model defines a seven-state machine
(`setup_incomplete → ready → prepared → processing → completed → archived`,
plus orthogonal `blocked`) with an explicit transition allow-list, derived
action labels, and contextual UI surfaces (row, stepper, footer, overflow,
detail). The state machine itself is local to Projects; the durable transition
contract is owned by spec 002 (`lifecycle.transition`). This feature wires the
project-specific rules, error envelopes, action-label policy, and surface
behaviors on top of that contract.

## Constitution Check

- **I. Local-First File Custody**: A lifecycle state change is metadata-only
  and never moves user files. Filesystem side effects (e.g. PreparedSource
  generation, cleanup archive) are routed through spec 017 plans; the
  lifecycle use case only references plan IDs and never opens file handles.
- **II. Reviewable Filesystem Mutation**: Edges that imply filesystem work
  (`ready → prepared`, `completed → archived` when cleanup is involved,
  `archived → processing` when files must be re-linked) MUST require an
  approved FilesystemPlan id. The use case rejects with `plan.required` /
  `plan.not_approved` otherwise.
- **III. PixInsight Boundary**: `Open in {tool}` is a launch action, never an
  in-app processing call. `processing → completed` is a user attestation that
  external processing finished; we do not inspect tool state.
- **IV. Research-Led Domain Modeling**: Transition graph, action-label
  derivation, and blocked-detection rules are captured in `research.md` with
  alternatives considered.
- **V. Portable Contracts and Durable Records**: The transport contract reuses
  spec 002's `lifecycle.transition` envelope. This spec adds a project-scoped
  wrapper contract (`project.lifecycle.transition`) and a list contract
  (`project.list`). All errors flow through the shared `ErrorEnvelope`.

## Architecture

### Layering

```
apps/desktop (Tauri + React)
  └─ features/projects/* hooks
       └─ tauri command: project.lifecycle.transition / project.list
            └─ crates/app/core/usecases/project_lifecycle.rs
                 ├─ crates/domain/core/lifecycle/project.rs  (state machine)
                 ├─ crates/contracts/core::lifecycle::transition  (spec 002)
                 ├─ crates/persistence/db  (project + audit writes)
                 └─ crates/audit  (event emission)
```

### Domain Layer

`crates/domain/core/src/lifecycle/project.rs`:

- `ProjectLifecycle` enum mirroring the seven mockup states.
- `ProjectTransition { from, to, default_label, side_effect }` table seeded
  with the 16 allowed edges (see `data-model.md` for the full table).
- Pure function `transition(from, to) -> Result<ProjectTransition,
  TransitionError>` consumed by the use case and unit-tested in isolation.
- `default_label(from, to)` mirrors the mockup precedent (e.g.
  `archived → processing` returns `"Unarchived"`; every other forward edge
  returns `"Marked {to-with-spaces}"`).

### Use Case Layer

`crates/app/core/src/usecases/project_lifecycle.rs`:

- `transition(ProjectLifecycleTransitionRequest) -> Response` wraps spec 002's
  `lifecycle::transition` with project-specific defaults:
  - Sets `entity_type = "project"`.
  - Derives `action_label` from the edge when caller omits it.
  - Sets `requires_plan` when the target state implies filesystem mutation
    (configured per edge in the transition table).
  - Maps domain errors to the project-scoped error codes
    (`project.not_found`, `transition.refused`,
    `prepared_source.required`).
- `list(ProjectListRequest) -> Response` returns project summaries with
  optional filters on `lifecycle` (multiselect) and `tool`.

### Contracts

- `project.lifecycle.transition` extends the spec 002 envelope. Accepts a
  project id and optional `action_label`. Server-side default-label fill is
  authoritative; clients MAY supply an override that survives audit.
- `project.list` is a thin read contract used by the project page hooks.

### UI Layer

`apps/desktop/src/features/projects/*`:

- `useProjects()` and `useProjectFilters()` consume `project.list` via the
  Tauri adapter. Mockup currently reads `projectsPub`; the migration replaces
  the publisher source with a query/subscribe pair that proxies the contract.
- `projectFooter(project)` keeps its current structure; the button click now
  dispatches a `project.lifecycle.transition` request instead of mutating the
  in-memory publisher directly.
- Stepper component renders `projectLifecycleSteps`; the `blocked` indicator
  is rendered as a top-of-drawer banner (see spec 002 banner pattern, US 4).

## Phasing

### Phase 0 — Research (this spec)

- Confirm transition graph.
- Confirm action-label policy.
- Decide `blocked` triggers (user vs system).
- Decide cross-spec edge: which edges require an approved FilesystemPlan.

### Phase 1 — Design

- Finalize `data-model.md` table.
- Finalize contracts (this directory).
- Cross-reference with spec 002 contract; ensure no enum drift.

### Phase 2 — Implementation (deferred, gated by review)

1. Add `crates/domain/core/lifecycle/project.rs` with unit tests for all 16
   allowed edges and the (49 - 16) = 33 forbidden combinations.
2. Add `crates/app/core/usecases/project_lifecycle.rs` with use-case-level
   tests using a fake persistence + audit double.
3. Generate TypeScript types from contracts; wire Tauri command.
4. Replace mockup publishers with contract-backed hooks; preserve URL/keyboard
   surfaces.
5. Wire stepper, footer, row overflow to dispatch transitions.
6. Add Playwright smoke covering each footer transition.

## Cross-Spec Links

- **Spec 002 (Data Lifecycle State Model)** owns the transport contract,
  audit envelope, and error vocabulary. This spec MUST NOT redefine the
  envelope; it may only add project-scoped error codes layered on top.
- **Spec 017 / 025 (Filesystem Plan / Cleanup)**: every edge whose
  `side_effect` is non-null routes through an approved plan before the
  lifecycle write commits.
- **Spec 003 (Inventory)**: `Project.sources[].inventoryId` is a hard link;
  deletion of an inventory item flips affected projects to `blocked` with
  reason `source_missing`.
- **Spec 005 (Audit)**: every transition writes one audit event; `lastAction`
  is denormalized onto the project row but the audit log is the durable
  record.

## Risks

- **Enum drift**: `ProjectLifecycle` lives in three places (Rust domain, JSON
  contract, TS mock). The Phase 2 task graph MUST make the JSON contract the
  generator source and remove the hand-typed TS union before merge.
- **Side-effect coupling**: Coupling `ready → prepared` to a FilesystemPlan
  approval means the UI must reflect the plan-pending state. Mockup currently
  short-circuits this; design must add an interstitial "Preparing…" view.
- **Blocked semantics**: System-detected blocked vs user-marked blocked share
  one state but have very different recovery flows. We will track this with a
  `Project.blockedReason` enum, not free text.
