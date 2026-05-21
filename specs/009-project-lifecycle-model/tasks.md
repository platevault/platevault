# Tasks: Project Lifecycle Model

**Spec**: 009-project-lifecycle-model | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story so each story can be developed and tested
independently. Mockup-done items are marked `[mockup]`; their post-mockup
counterparts (contract-backed, audited) are tracked separately.

## Foundations

- F-1. Move `ProjectLifecycle` enum from `apps/desktop/src/data/mock.ts` to a
  generated TS file produced from
  `contracts/project.lifecycle.transition.json`. Re-export from mock.ts to
  preserve current imports.
- F-2. Add `crates/domain/core/src/lifecycle/project.rs` with the
  `ProjectLifecycle` enum, the `ProjectTransition` table from
  `data-model.md`, and pure `transition(from, to) -> Result<…>` plus
  `default_label(from, to)` functions. Unit-test all 16 allowed edges and a
  representative set of forbidden combinations.
- F-3. Add `crates/app/core/src/usecases/project_lifecycle.rs` exposing
  `transition` and `list` use cases. Wire to `crates/persistence/db` (writes
  Project + appends audit) and `crates/audit` (event emission). Use case
  tests pass through a fake repository.
- F-4. Generate Rust DTOs in `crates/contracts/core/` and TS types in
  `packages/contracts/generated/` from the two JSON Schemas.
- F-5. Add a Tauri command adapter that maps `project.lifecycle.transition`
  and `project.list` to the use cases.

## US 1 — Project List with Lifecycle Filter (P1)

- US1-1. `[mockup]` Render lifecycle column with `StateLabel` +
  `lifecycleTone`; no ambiguous Plan column.
- US1-2. `[mockup]` Render `lastAction` cell in the row.
- US1-3. Implement multiselect `lifecycle_filter` UI control on the projects
  page header; persist selection in URL state.
- US1-4. Implement multiselect `tool_filter` control with the same pattern.
- US1-5. Replace `useProjects` publisher with a `project.list` query hook
  driven by the Tauri adapter. Preserve current sort order.
- US1-6. Add a "blocked" filter chip that, when active, surfaces
  `blockedReason.kind` as a row badge.
- US1-7. Tests: vitest unit covering filter composition; Playwright smoke
  covering multiselect + URL persistence.

## US 2 — Project Detail with Stepper (P2)

- US2-1. `[mockup]` Drawer renders project fields as structured table rows.
- US2-2. `[mockup]` Sources list links into Inventory.
- US2-3. `[mockup]` Stepper renders `projectLifecycleSteps` in the drawer
  header.
- US2-4. Render `blocked` as a banner above the stepper with reason text and
  the resolve primary action; stepper highlights the pre-block state.
- US2-5. Expandable sections for channels, plans, manifests, lifecycle
  events; no overlapping layout.
- US2-6. Lifecycle events section reads from the audit log via a
  `project.events.list` (deferred; tracked under spec 005). For v1 of this
  spec, show the manifest list with reason + timestamp.
- US2-7. Tests: vitest for stepper rendering across all seven states;
  Playwright snapshot of detail layout in `prepared`, `processing`,
  `blocked`, and `archived`.

## US 3 — Transition Actions (P3)

- US3-1. `[mockup]` Footer renders contextual primary + secondary + overflow
  via `projectFooter`.
- US3-2. `[mockup]` Row overflow uses `rowMenuGroupsForLifecycle`.
- US3-3. Replace direct `setProjectLifecycle` calls with dispatches against
  the `project.lifecycle.transition` Tauri command. Show inline error toasts
  for `transition.refused`, `prepared_source.required`, `plan.required`,
  `plan.not_approved`.
- US3-4. Wire `ready → prepared` to surface the spec 017 plan-create flow:
  if no approved plan exists, the primary action opens the plan drawer;
  otherwise it submits the transition referencing the plan id.
- US3-5. Wire `completed → archived` to the archive plan flow (spec 025);
  refuse without an approved plan.
- US3-6. Implement default action-label derivation in the use case
  (table in `data-model.md`); allow caller override and confirm the
  override is preserved in audit.
- US3-7. Tests: contract tests for every allowed edge; refusal tests for the
  forbidden edges; integration test for the plan-gated edges.

## US 4 — Blocked Banner + Resolution (P4)

- US4-1. `[mockup]` Footer renders Resolve blocker + Edit when
  `lifecycle == "blocked"`.
- US4-2. Render the blocked banner with structured `blockedReason` text:
  - `source_missing` → "Source missing: {inventory name}"
  - `prepared_source_stale` → "Prepared source out of date"
  - `tool_unconfigured` → "Tool path not configured: {tool}"
  - `calibration_unmatched` → "Calibration set missing"
  - `user` → "{note}"
- US4-3. Resolve action opens a guided flow that picks the resolution edge
  (`blocked → ready/prepared/processing/setup_incomplete`) based on the
  reason kind.
- US4-4. System-driven blocking: wire detectors in
  `crates/app/core/usecases/project_health.rs` that, on inventory or
  prepared-source events, dispatch `actor=system` block transitions.
- US4-5. Tests: each reason kind has an integration test covering both auto
  detection and manual resolution.

## Cross-Cutting

- X-1. Update the steering index entry for `specs/009-` once tasks land.
- X-2. Add ADR cross-link to spec 002 to record that 009 reuses the
  envelope without redefining it.
- X-3. Generate a contract snapshot test that fails on enum drift between
  `project.lifecycle.transition.json` and the Rust domain enum.

## Dependency Graph

```
F-1 ┐
F-2 ┼─► F-3 ─► F-4 ─► F-5 ─► US1-5
F-3 ┘                       ├─► US3-3 ─► US3-4 / US3-5 / US3-6
                            ├─► US2-6 (audit deps via spec 005)
                            └─► US4-4
US1-3 / US1-4 / US1-6 depend on F-5.
US2-4 / US2-5 depend on mockup parity (US2-1 .. US2-3).
US4-2 / US4-3 depend on US3-3 and the blocked_reason field on the contract.
```

## Out of Scope

- Auto-archive on inactivity (R1 alternative, rejected for v1).
- Direct `processing → ready` edge (R1 forbidden).
- Cloud sync of project state.
