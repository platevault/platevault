# Tasks: Project Create, Onboard, And Edit

**Spec**: 008-project-create-onboard-edit | **Plan**: [plan.md](./plan.md)

Tasks are grouped by user story so each story can be developed and tested
independently. Mockup-done items are marked `[mockup]`; their post-mockup
counterparts (contract-backed, audited) are tracked separately.

## Foundations

- F-1. Scaffold `crates/project/structure/` with the folder-layout and
  marker-format rules per `ProcessingTool` (PixInsight, Siril, Planetary
  Suite). Unit-test each tool's expected on-disk layout.
- F-2. Add `crates/domain/core/src/project/` with the `Project` aggregate
  per `data-model.md`, plus pure `validate_name`,
  `infer_channels(sources)`, and `merge_channels(inferred, manual)`
  functions. Unit-test inference and merge semantics from research R4.
- F-3. Add `crates/app/core/src/usecases/project_setup.rs` exposing
  `create`, `update`, `add_source`, and `remove_source` use cases. Wire to
  `crates/persistence/db` and `crates/audit`. Use-case tests pass through
  a fake repository and a fake inventory reader.
  - `add_source` MUST check `inventory_session.state == "confirmed"`; reject
    with `source.not_confirmed` otherwise (R-Inventory-Confirmed).
  - `remove_source` MUST refuse with `lifecycle.read_only` when `lifecycle in
    {prepared, processing, completed, archived}`.
  - After every `create`, `update`, or `add_source`, fire the invariant check:
    if `tool != null AND ≥1 confirmed source mapped`, auto-transition
    `setup_incomplete → ready` via `actor=system` (R-Ready-Trigger).
- F-4. Generate Rust DTOs in `crates/contracts/core/` and TS types in
  `packages/contracts/generated/` from all seven JSON Schemas
  (`project.create`, `project.update`, `project.source.add`,
  `project.source.remove`, `project.get`, `project.channels.reinfer`,
  `project.channels.dismiss_drift`).
- F-5. Add Tauri command adapters that map each contract to its use case.
- F-6. Extend `apps/desktop/src/data/store.ts` with `useCreateProject`,
  `useUpdateProject`, `useAddProjectSource`, `useRemoveProjectSource`,
  `useReinferChannels`, and `useDismissChannelDrift` mutation hooks backed by
  the Tauri adapters. Preserve current `useProjects` shape.

## US 1 — Create A Project (P1)

- US1-1. `[mockup]` Page-header "New project" button is rendered
  (`ProjectsPage.tsx:87`). Currently no handler.
- US1-2. Build `CreateProjectDialog.tsx` as a single-form modal (A1 — wizard
  reversed). Fields: name (required, with live duplicate-check), tool (required,
  radio group, PixInsight default), optional Inventory source picker, optional
  notes. No step-based navigation; URL state records dialog open/close only.
- US1-3. Name field: debounced duplicate-check against `project.list`;
  non-empty and ≤120-char validation; library-root-relative path input.
- US1-4. Tool field: radio group seeded with `PixInsight` default (research R3).
  All three `ProcessingTool` values rendered. Tool is required; submit disabled
  until a tool is selected.
- US1-5. Optional sources field: `AddSourcePicker.tsx` shared component renders
  confirmed Inventory sessions grouped by capture session; checkbox selection
  drives `initial_sources[]`. Empty Inventory shows an empty-state with a link
  to spec 003 source-setup.
- US1-6. Wire the page-header "New project" click handler to open the dialog.
  Replace the static button with a button that records dialog-open in URL state.
- US1-7. On success, navigate to the new project drawer and surface a toast
  linking to the generated `plan_id` (spec 025 plan review).
- US1-8. On error, render inline messages for each `ErrorCode`
  (`name.empty`, `name.duplicate`, `tool.unknown`, `source.not_found`,
  `source.not_confirmed`, `path.collision`).
- US1-9. Tests: vitest for dialog field validation; Playwright smoke covering
  create-from-empty and create-with-three-sources happy paths.

## US 1b — Source Remove (P2)

- US1b-1. Wire source-remove rows in `EditProjectPane.tsx` to `useRemoveProjectSource`.
  Currently disabled with tooltip (US3-5).
- US1b-2. Remove icon is enabled when `lifecycle in {setup_incomplete, ready, blocked}`;
  disabled with tooltip "Cannot remove source in current lifecycle state" otherwise.
- US1b-3. When removal triggers a `ready → setup_incomplete` transition (server returns
  `newLifecycle = "setup_incomplete"`), surface a warning toast explaining the project
  returned to setup_incomplete.
- US1b-4. When removal would leave zero confirmed sources, surface a confirmation
  dialog before calling the contract (maps to `lifecycle.last_confirmed_source` error).
- US1b-5. Tests: vitest for enabled/disabled states; Playwright smoke for remove-last-source
  confirmation flow.

## US 1c — Channel Drift Detection (P3)

- US1c-1. `project.get` response includes `channelDrift`; render a drift banner in
  `EditProjectPane.tsx` and project drawer when `channelDrift.hasNewSources == true`.
- US1c-2. Banner shows `suggestedAction`: "Re-infer channels" (primary) or "Dismiss"
  (secondary). Wire primary to `useReinferChannels`; wire secondary to `useDismissChannelDrift`.
- US1c-3. Tests: vitest for banner render condition; Playwright smoke for re-infer and
  dismiss flows.

## US 2 — Onboard An Existing Project (P2)

- US2-1. (No mockup precedent.) Add a secondary "Onboard project" CTA
  next to "New project" in the page header.
- US2-2. Build `OnboardProjectWizard.tsx` with four steps: Pick folder →
  Detect marker / metadata → Reconcile sources → Confirm.
- US2-3. Pick folder step uses the spec 004 native folder picker scoped
  to a library root.
- US2-4. Detect step runs the three-way reconciliation from research R6:
  no marker → propose write; parsable marker → recover metadata;
  unparsable marker → refuse with explanation.
- US2-5. Reconcile step lists folder contents and asks the user to map
  each subfolder to an Inventory session (or skip with explicit "not a
  source" marker).
- US2-6. Confirm step dispatches `project.create` with the recovered
  identity and the reconciled `initial_sources[]`. The FilesystemPlan
  may be metadata-only when no marker write is needed.
- US2-7. Tests: vitest for the three marker branches; Playwright smoke
  for the parsable-marker recovery path.

## US 3 — Edit Project Settings (P3)

- US3-1. (No mockup precedent.) Add an "Edit" overflow entry to the
  project drawer header, visible when `lifecycle != "archived"`.
- US3-2. Build `EditProjectPane.tsx`: single pane with name, tool,
  notes, sources list (with remove + "Add source" row), and channel
  inference preview.
- US3-3. Wire name/tool/notes fields to `useUpdateProject`. Surface
  `name.duplicate`, `tool.locked`, and `lifecycle.read_only` errors
  inline.
- US3-4. Wire the inline "Add source" row (currently
  `<Plus size={12}/> Add source` at `ProjectsPage.tsx:277`) to the
  shared `AddSourcePicker.tsx` from US 1, dispatching
  `project.source.add` on selection.
- US3-5. Wire source-remove to `project.source.remove` (now available in v1 —
  US1b). Remove icon is lifecycle-gated per US1b-2.
- US3-6. Channel inference preview re-runs whenever the source list
  changes; manually added channels are visually distinguishable from
  inferred channels.
- US3-7. Tests: vitest for each field's validation; Playwright smoke
  for rename + add-source happy paths.

## US 4 — Channel Inference (P4)

- US4-1. Implement `infer_channels(sources)` in
  `crates/domain/core/src/project/channels.rs` (covered by F-2).
- US4-2. Implement `merge_channels(inferred, manual)` preserving manual
  removals and manual additions per research R4.
- US4-3. UI: render inferred channels with a subtle marker (e.g.
  "Auto") and manual channels with a different chip variant; both are
  removable.
- US4-4. "Re-infer channels" button on the edit pane resets the channel
  list to the pure inferred output, asking for confirmation first
  because manual additions and removals are discarded.
- US4-5. Tests: vitest for inference, merge, and re-infer flows.

## Cross-Cutting

- X-1. Update the steering index entry for `specs/008-` once tasks land.
- X-2. Generate a contract snapshot test that fails on enum drift
  between the seven JSON Schemas and the Rust domain types.
- X-3. Coordinate with spec 010 (guided first project flow) to confirm
  the create dialog is invocable from an external orchestrator without
  behavior change.
- X-4. Coordinate with spec 011 (tool launch) to ensure tool changes
  emit a `project_tool_changed` audit event that invalidates launcher path
  caches.
- X-5. `project.source.remove` is now in-scope (US1b). Remove cross-cutting
  follow-up note; tracker X-5 closed.

## Dependency Graph

```
F-1 ─► F-2 ─► F-3 ─► F-4 ─► F-5 ─► F-6
                                    │
                                    ├─► US1-2 ─► US1-3..US1-7 ─► US1-8 ─► US1-9, US1-10
                                    ├─► US2-2 ─► US2-3..US2-6
                                    ├─► US3-1 ─► US3-2 ─► US3-3, US3-4
                                    └─► US4-1 (via F-2) ─► US4-2 ─► US4-3, US4-4

US1-5 / US3-4 depend on the shared AddSourcePicker.tsx.
US2-3 depends on spec 004 (native filesystem controls).
US1-9 depends on spec 025 (filesystem plan application).
```

## Out of Scope

- Multi-source bulk add (current contract is single-session per call;
  callers loop for batch add).
- Tool change after `prepared` lifecycle (blocked by `tool.locked`;
  recovery is manual re-creation via `project.create` — R-NoDup; no
  `project.duplicate` in v1).
- Templated name suggestions (research R5 alternative, deferred).
- Project rename → folder rename (current rename is metadata-only;
  filesystem rename is a follow-up plan).
- `project.get` contract schema (detail read for channel drift and other
  fields; deferred to Phase 1 design alongside channel inference contracts).
