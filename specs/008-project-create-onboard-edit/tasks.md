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
  `create`, `update`, and `add_source` use cases. Wire to
  `crates/persistence/db` and `crates/audit`. Use-case tests pass through
  a fake repository and a fake inventory reader.
- F-4. Generate Rust DTOs in `crates/contracts/core/` and TS types in
  `packages/contracts/generated/` from the three JSON Schemas
  (`project.create`, `project.update`, `project.source.add`).
- F-5. Add Tauri command adapters that map each contract to its use case.
- F-6. Extend `apps/desktop/src/data/store.ts` with `useCreateProject`,
  `useUpdateProject`, and `useAddProjectSource` mutation hooks backed by
  the Tauri adapters. Preserve current `useProjects` shape.

## US 1 — Create A Project (P1)

- US1-1. `[mockup]` Page-header "New project" button is rendered
  (`ProjectsPage.tsx:87`). Currently no handler.
- US1-2. Build `CreateProjectWizard.tsx` with five steps: Identity → Tool →
  Sources → Channels → Confirm. URL state tracks the active step (spec
  020 router contract).
- US1-3. Identity step: name input with live duplicate-check (debounced
  call to `project.list` or a dedicated `project.name.check` helper);
  length and non-empty validation; library-root-relative path input.
- US1-4. Tool step: radio group seeded with `PixInsight` default
  (research R3). All three `ProcessingTool` values rendered.
- US1-5. Sources step: `AddSourcePicker.tsx` shared component renders
  Inventory sessions grouped by capture session; checkbox selection
  drives `initial_sources[]`. Empty Inventory shows an empty-state with
  a link to spec 003 source-setup.
- US1-6. Channels step: shows inferred channels from selected sources as
  removable chips; manual "Add channel" input. Persists `source` flag
  per channel.
- US1-7. Confirm step: review pane summarising all collected values; a
  Create primary action dispatches `project.create`.
- US1-8. Wire the page-header "New project" click handler to open the
  wizard. Replace the static button with a button that records the
  wizard open in URL state.
- US1-9. On success, navigate to the new project drawer and surface a
  toast linking to the generated `plan_id` (spec 025 plan review).
- US1-10. On error, render inline messages for each `ErrorCode`
  (`name.empty`, `name.duplicate`, `tool.unknown`, `source.not_found`,
  `path.collision`).
- US1-11. Tests: vitest for each step's validation; Playwright smoke
  covering create-from-empty and create-with-three-sources happy paths.

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
- US3-5. Wire source-remove to a future `project.source.remove`
  contract (out of scope for this spec; tracked under cross-cutting).
  For v1, the row's remove icon is disabled with a tooltip linking to
  the follow-up.
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
  between the three JSON Schemas and the Rust domain types.
- X-3. Coordinate with spec 010 (guided first project flow) to confirm
  the create wizard is invocable from an external orchestrator.
- X-4. Coordinate with spec 011 (tool launch) to ensure tool changes
  emit a `project_renamed` / `project_tool_changed` audit event that
  invalidates launcher path caches.
- X-5. File a follow-up spec for `project.source.remove` so US3-5 can
  be enabled.

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

- `project.source.remove` contract and UI (tracked as follow-up X-5).
- Multi-source bulk add (current contract is single-session per call;
  callers loop for batch add).
- Tool change after `prepared` lifecycle (blocked by `tool.locked`; a
  future spec defines the migration path).
- Templated name suggestions (research R5 alternative, deferred).
- Project rename → folder rename (current rename is metadata-only;
  filesystem rename is a follow-up plan).
