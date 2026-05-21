# Implementation Plan: Project Create, Onboard, And Edit

**Branch**: `008-project-create-onboard-edit` | **Date**: 2026-05-09 | **Spec**:
[spec.md](./spec.md)

## Summary

This feature owns three flows that share one project model: **create** a new
project from confirmed Inventory items, **onboard** an existing project folder
that already lives on disk, and **edit** project metadata after the fact. All
three converge on the same `Project` aggregate (see `data-model.md`) and emit
the same audit envelope. The create wizard is structurally analogous to the
first-run source-setup wizard from spec 003 but scoped to a single project:
identity → tool → sources → calibration → channels → confirm. Source picking
is scoped to **Inventory**, never an arbitrary disk path, because picking
arbitrary paths bypasses the scan/extract pipeline that downstream features
depend on. Channels are inferred from the filters present on the picked
sources, with manual override on the confirm step. Tool selection drives which
generated artifacts (PixInsight project file, Siril sequence, etc.) the
filesystem plan must create.

## Constitution Check

- **I. Local-First File Custody**: Source files are never copied into an
  app-private store. The project folder structure is created **on the user's
  chosen root** under a reviewable plan; sources remain referenced by their
  Inventory rows, which themselves only hold (libraryRoot, relativePath).
  Onboarding maps existing on-disk content into the same model without
  duplicating bytes.
- **II. Reviewable Filesystem Mutation**: Both create and onboard produce a
  FilesystemPlan (spec 025) covering folder creation, project marker write,
  and any generated workflow file. The plan is rendered before apply; failed
  applies route through the spec 002 rollback path (FR-008). Edit is
  metadata-only unless the user changes the project path, in which case a
  move plan is generated.
- **III. PixInsight Boundary**: The tool selector records *which* external
  tool the project targets; the app does not invoke processing, only writes
  tool-shaped scaffolding (e.g. an empty `.pi-project` marker) under the
  filesystem plan. "Open in {tool}" remains a launch action (spec 011).
- **IV. Research-Led Domain Modeling**: Wizard vs single-form, inventory-only
  source picking, channel inference, naming conventions, and onboarding
  marker reconciliation are each covered in `research.md`.
- **V. Portable Contracts and Durable Records**: Three JSON Schemas
  (`project.create`, `project.update`, `project.source.add`) define the
  transport surface. The Tauri adapter is the first implementation; future
  remote service implementations consume the same schemas.

## Architecture

### Layering

```
apps/desktop (Tauri + React)
  └─ features/projects/create/*        (wizard surface)
  └─ features/projects/onboard/*       (folder-pick + reconciliation)
  └─ features/projects/edit/*          (single-pane edit)
       └─ tauri commands:
            project.create
            project.update
            project.source.add
              └─ crates/app/core/usecases/project_setup.rs
                   ├─ crates/project/structure/       (folder/marker rules)
                   ├─ crates/domain/core/project/     (aggregate invariants)
                   ├─ crates/fs/planner/              (folder + marker plan)
                   ├─ crates/fs/inventory/            (source resolution)
                   ├─ crates/workflow/profiles/       (tool scaffold rules)
                   ├─ crates/persistence/db           (project + audit writes)
                   └─ crates/audit/                   (event emission)
```

### Domain Layer

`crates/domain/core/src/project/` (new module):

- `Project` aggregate matching `data-model.md` (id, name, tool, lifecycle,
  sources, calibrationSets, channels, notes, lastAction, blockedReason).
- `ProjectSource` value object with `(inventoryId, name, frames, filter,
  exposure)` snapshot fields. The snapshot fields are denormalized from
  Inventory at link time so the project drawer can render without joining
  to the inventory table; the inventory row remains the source of truth and
  drives `blocked(source_missing)` if it disappears.
- Pure `validate_name(name) -> Result<...>` and `infer_channels(sources)
  -> Vec<String>` functions, unit-testable in isolation.

### Use Case Layer

`crates/app/core/src/usecases/project_setup.rs`:

- `create(ProjectCreateRequest) -> Response`:
  1. Validate name (non-empty, not a duplicate within scope).
  2. Resolve `initial_sources[]` inventory IDs; reject on first miss.
  3. Build a FilesystemPlan for the folder + marker + tool scaffold under
     `crates/fs/planner/`. Stash the plan id on the response.
  4. Persist the `Project` in `setup_incomplete` and emit an audit event.
  5. Return `project_id` and `lifecycle = "setup_incomplete"`; the
     `setup_incomplete → ready` transition is left to spec 009 once the
     plan is applied.
- `update(ProjectUpdateRequest) -> Response`:
  - Whitelisted-field update (`name`, `tool`, `notes`). Other fields are
    edited through their own contracts (`project.source.add`,
    `project.lifecycle.transition`).
  - Refuse on `lifecycle == "archived"` with `lifecycle.read_only`.
- `add_source(ProjectSourceAddRequest) -> Response`:
  - Idempotency: refuse with `source.already.linked` if the
    `(project_id, inventory_session_id)` pair already exists.
  - Snapshot `name/frames/filter/exposure` from the inventory row at link
    time.
  - Recompute channel inference and persist; emit audit event.

### Contracts

Three new JSON Schemas under `contracts/`:

- `project.create.json` — full creation, with optional `initial_sources[]`.
- `project.update.json` — metadata-only patch on existing project.
- `project.source.add.json` — incremental source addition.

All three reuse the spec 002 `ErrorEnvelope` shape and contribute their
own project-scoped error codes (see each schema's `ErrorCode` enum).

### UI Layer

`apps/desktop/src/features/projects/`:

- `create/CreateProjectWizard.tsx`: multi-step modal opened from the
  page-header "New project" button (currently a stub at line 87 of
  `ProjectsPage.tsx`). Steps: Identity → Tool → Sources → Channels →
  Confirm. The Sources step renders an Inventory picker driven by
  `useInventory()` (spec 003); rows are checkboxes grouped by session.
- `onboard/OnboardProjectWizard.tsx`: opened from a secondary CTA on the
  same page header. Steps: Pick folder → Detect marker / metadata →
  Reconcile sources against Inventory → Confirm.
- `edit/EditProjectPane.tsx`: opened from the drawer overflow on any
  non-archived project. Single pane with name, tool, notes, sources list
  (with remove + Add source row), and channel inference preview.
- `AddSourcePicker.tsx`: shared by create wizard and drawer; renders the
  inventory rows scoped to the project's tool/target compatibility.

The page-header "New project" button gets a click handler dispatching the
`open create wizard` route action; URL state tracks the wizard step so
deep-links and back-button work (consistent with spec 020).

## Phasing

### Phase 0 — Research (this spec)

- Decide wizard vs single-form for create.
- Decide source-picking surface: inventory-only vs arbitrary disk.
- Decide tool default and tool selection UX.
- Decide channel detection: auto from filters, manual, or hybrid.
- Decide naming convention: free, templated, or guided.

### Phase 1 — Design

- Finalize `data-model.md` (this directory).
- Finalize all three contracts.
- Cross-reference with spec 009 lifecycle (the
  `setup_incomplete → ready` edge), spec 003 Inventory, and spec 025
  filesystem plan.

### Phase 2 — Implementation (deferred, gated by review)

1. Scaffold `crates/project/structure/` crate with the folder/marker rules
   and unit tests for layout per tool.
2. Add `crates/domain/core/src/project/` aggregate + invariants + tests.
3. Add `crates/app/core/src/usecases/project_setup.rs` with fake
   persistence + audit doubles.
4. Generate Rust DTOs and TS types from the three schemas.
5. Add Tauri command adapters.
6. Replace the stub `New project` button with the create wizard; wire
   `Add source` inline. Add an edit overflow entry.
7. Build the onboard wizard last (no current mockup surface).
8. Playwright smoke per US.

## Cross-Spec Links

- **Spec 002 (Data Lifecycle State Model)** owns the shared `ErrorEnvelope`
  and audit shape consumed by all three contracts here.
- **Spec 003 (First-Run Source Setup)** populates Inventory; the source
  picker in this feature is empty without it.
- **Spec 009 (Project Lifecycle Model)** owns the `setup_incomplete →
  ready` transition. Successful create returns `setup_incomplete`; the
  caller drives the next transition through 009 once the plan is applied.
- **Spec 010 (Guided First Project Flow)** wraps this feature for the very
  first project. The create wizard component MUST accept an external
  "guided" orchestrator without behavior change.
- **Spec 011 (Processing Tool Launch)** consumes `project.tool` to choose
  the launcher.
- **Spec 025 (Filesystem Plan Application)** owns the folder/marker write
  plan referenced from this feature's use cases.

## Risks

- **Hidden coupling to spec 003**: Until Inventory ships, the create
  wizard's Sources step has no input. Spec 010 will paper over this by
  forcing source setup before project create, but the contract MUST still
  accept `initial_sources = []` for the unhappy path.
- **Channel inference drift**: Inferred channels vs user-overridden
  channels must be distinguishable in audit; otherwise a later filter
  rename in Inventory silently overwrites a user choice. Decision recorded
  in research R4.
- **Onboard marker conflicts**: An existing folder may already contain a
  marker from an older app version or a sibling install. The onboard
  reconciliation step MUST refuse to silently rewrite a marker it did not
  create.
- **Edit during processing**: Renaming a project mid-`processing` could
  break tool launchers that cache paths. The update use case emits a
  `project_renamed` audit event so spec 011 can invalidate its caches.
