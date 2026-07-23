# Implementation Plan: Project Create, Onboard, And Edit

**Branch**: `008-project-create-onboard-edit` | **Date**: 2026-05-09 | **Spec**:
[spec.md](./spec.md)

## Summary

This feature owns three flows that share one project model: **create** a new
project from confirmed Inventory items, **onboard** an existing project folder
that already lives on disk, and **edit** project metadata after the fact. All
three converge on the same `Project` aggregate (see `data-model.md`) and emit
the same audit envelope.

The create flow uses a **single-form dialog** (name, tool, optional initial
sources, optional notes) — not a multi-step wizard. This decision was ratified
in GRILL 2026-05-22 (A1), reversing the earlier five-step wizard design. The
dialog is reusable from spec 010's guided first-project flow. Source picking is
scoped to **Inventory**, never an arbitrary disk path, because picking arbitrary
paths bypasses the scan/extract pipeline that downstream features depend on.
Channels are inferred from the filters present on the picked sources. Tool
selection is mandatory at create and drives which generated artifacts (PixInsight
project file, Siril sequence, etc.) the filesystem plan must create.

**`project.duplicate` deferred**: There is no `project.duplicate` contract in
v1. The recovery path for tool-locked projects is manual re-creation via
`project.create`. The UI surfaces this in tool-lock messaging. Follow-up tracked
in GRILL amendment 2026-05-22 (R-NoDup).

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
  filesystem plan. "Open in {tool}" remains a launch action (spec 011). The
  **framing layer (Q27)** groups and prepares light sessions into
  co-registerable units and builds a per-framing source view (Q20) + manifest
  (Q10), but **never stitches, registers, or integrates** framings — that is
  PixInsight/WBPP's job. Framing clustering is a **suggestion** (§II); every
  merge/split/reassign is user-driven and reviewable, and attribution never
  auto-merges.
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

### Framing Layer (Q27)

The framing layer sits between the `Project` aggregate and spec-006 sessions
(`project → framing → session → frames`):

- **Clustering** (`crates/sessions/`): group a project's light sessions by
  target + optic-train + pointing + rotation within a **tunable tolerance**
  (never an exact key), reading the session-level geometry persisted at confirm
  (F-Framing-1; the Q12 strict-gate iterate — not yet applied — will guarantee
  presence on new ingests; NULL-geometry legacy sessions are excluded until
  backfilled via rescan, Q28). Semantics are pinned in research **R11a**
  (linkage rule, representative pointing, FOV source, concrete tolerance
  defaults). Triggers: **incremental at confirm** + **explicit bulk derive**
  (onboarding/rescan). Output is a **suggested** clustering the user can
  adjust; re-derivation never modifies `user_adjusted` framings; the app never
  treats its clustering as authoritative.
- **Adjustment use cases** (`crates/app/core/`): `framing.merge`,
  `framing.split`, `framing.reassign` — flip `Framing.clustering` to
  `user_adjusted`, mutate membership only (no filesystem, no image bytes), emit
  audit events.
- **Mosaic flag** (`project_setup.rs`): a minimal `is_mosaic` project flag; when
  set, framings inherit the project's declared target and per-frame
  OBJECT/coordinate resolution is suppressed. No panel entity, no OBJECT/panel-
  name string parsing anywhere.
- **Inbox-confirm attribution** (`crates/app/inbox/src/confirm.rs`): attribution
  is the **first** pre-ingest pass at the confirm gate; the **Q22
  duplicate-detection sweep does not exist yet** (no spec or code) and **joins
  this same pass when its iterate lands** — a documented composition point, not
  a prerequisite. The pass matches each new light session against existing
  framings/projects and returns ranked `IngestionAttributionCandidate`s
  (add-to-framing / new-framing / flag-optic-difference / new-project), with the
  FR-019 mosaic relaxation for `isMosaic` candidates. **Prefilter** candidates
  by optic-train key + a coarse sky bin before the tolerance math, so bulk Q28
  onboarding does not run O(sessions×framings) spherical trigonometry.
  Suggest-never-auto-merge; the user's pick is **persisted at confirm time via
  the `chosenAttribution` confirm-request extension** (FR-022 — membership is DB
  metadata, no §II plan); a completed-project match uses the spec-009
  `completed → processing` reopen edge (Q25 revoke/warn).
- **Per-framing projections**: a Q20 source view and a Q10 manifest per framing,
  both reproducible projections — never a stitch/integrate step (§III). These
  are **consumers** of the framing model, delivered when the Q20 (spec-026/049)
  and Q10 (spec-024) iterations land; Phase F does not block on them.

### Contracts

Seven JSON Schemas under `contracts/`:

- `project.create.json` — full creation, with optional `initial_sources[]` and required `tool`.
- `project.update.json` — metadata-only patch on existing project.
- `project.source.add.json` — incremental source addition. Use case verifies Inventory session `state == "confirmed"` (R-Inventory-Confirmed); rejects with `source.not_confirmed` otherwise.
- `project.source.remove.json` — source removal. Uses camelCase convention (A7 exception). Permitted in `{setup_incomplete, ready, blocked}`; refused in `{prepared, processing, completed, archived}`.
- `project.channels.reinfer.json` — triggers fresh channel inference; resets `hasNewSources` to false.
- `project.channels.dismiss_drift.json` — keeps manual overrides; resets `hasNewSources` to false; persists user's choice.
- `project.get.json` — project detail read. Response includes `channelDrift: { hasNewSources: boolean, suggestedAction: "re_infer" | "dismiss" }`.
- `project.list.json` — project list (in `009/contracts/`). Extended with cursor-based pagination: optional `cursor`, `limit` (default 50, max 200); response adds `nextCursor` (R-Pagination).

New contracts (`project.source.remove`, `project.channels.reinfer`, `project.channels.dismiss_drift`) use camelCase convention per A7 exception. Existing contracts stay snake_case pending the deferred envelope sweep.

**Framing contracts (Q27, Phase F — authored during implementation, camelCase):**

- `framing.list.json` — a project's `Framing[]`.
- `framing.merge.json` / `framing.split.json` / `framing.reassign.json` —
  user-driven adjustments; set `clustering = "user_adjusted"`, emit audit.
- `project.create` / `project.update` gain an `isMosaic` boolean (default
  false).
- The **Inbox confirm** contract (spec-041/006 surface) is extended
  additively in both directions: the **response** gains a ranked
  `IngestionAttributionCandidate[]`, and the **request** gains the per-item
  `chosenAttribution` field that persists the user's pick at confirm time
  (FR-022; see data-model.md §Apply-path). Neither is a new standalone
  contract. A cross-spec amendment note is recorded in spec-041, whose pending
  Q7 iteration reworks the same confirm/queue surface. The framing/mosaic
  JSON Schemas are authored in Phase F (gated implementation), consistent with
  how the seven project contracts above were authored during Phase 2.

All contracts reuse the spec 002 `ErrorEnvelope` shape and contribute their own project-scoped error codes (see each schema's `ErrorCode` enum).

### UI Layer

`apps/desktop/src/features/projects/`:

- `create/CreateProjectDialog.tsx`: single-form modal opened from the
  page-header "New project" button (currently a stub at line 87 of
  `ProjectsPage.tsx`). Fields: name (required), tool (required, radio group,
  default PixInsight), optional Inventory source picker, optional notes.
  The dialog is reusable from spec 010's guided first-project flow without
  behavior change.
- `onboard/OnboardProjectWizard.tsx`: opened from a secondary CTA on the
  same page header. Steps: Pick folder → Detect marker / metadata →
  Reconcile sources against Inventory → Confirm.
- `edit/EditProjectPane.tsx`: opened from the drawer overflow on any
  non-archived project. Single pane with name, tool, notes, sources list
  (with remove + Add source row), and channel inference preview. Channel
  drift banner surfaces when `channelDrift.hasNewSources == true`.
- `AddSourcePicker.tsx`: shared by create dialog and drawer; renders the
  inventory rows scoped to the project's tool/target compatibility.

The page-header "New project" button gets a click handler opening the
`CreateProjectDialog`; URL state records the open state so deep-links and
back-button work (consistent with spec 020).

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
   persistence + audit doubles. Use case enforces:
   - `source.add` checks `inventory_session.state == "confirmed"` (R-Inventory-Confirmed).
   - `source.remove` forbidden in `{prepared, processing, completed, archived}`.
   - Automatic `setup_incomplete → ready` invariant-check fires after every
     `project.update` or `project.source.add`; if `tool != null AND ≥1 confirmed
     source mapped`, the lifecycle service auto-transitions via `actor=system`
     (R-Ready-Trigger).
4. Generate Rust DTOs and TS types from all seven schemas.
5. Add Tauri command adapters.
6. Replace the stub `New project` button with `CreateProjectDialog`; wire
   `Add source` inline and source-remove; add an edit overflow entry.
7. Build the onboard wizard last (no current mockup surface).
8. Playwright smoke per US.

### Phase F — Framing layer (Q27, additive)

1. Add the `framing` table + `framing_session` join + `project.is_mosaic`
   column + session-level nullable geometry columns (pointing/rotation/
   optic-train, populated at confirm; legacy rows NULL). Backward-compatible;
   claim the next free migration version at merge (dup-check, PR #317
   precedent).
2. Add tolerance-based clustering in `crates/sessions/` per research R11a
   (linkage, representative, FOV source, defaults); triggers = incremental at
   confirm + explicit bulk derive; never modify `user_adjusted` framings;
   NULL-geometry sessions excluded.
3. Add `framing.list` + `framing.merge` / `framing.split` / `framing.reassign`
   use cases + contracts; flip `clustering` to `user_adjusted`; audit each.
4. Add the `is_mosaic` flag to `project.create` / `project.update`; suppress
   per-frame OBJECT/coordinate resolution when set. No panel entity, no OBJECT
   parsing.
5. Add the Inbox-confirm attribution pass (first pass; Q22 joins later): ranked
   `IngestionAttributionCandidate`s with the mosaic relaxation + optic-train/
   sky-bin prefilter; persist the user's pick via the `chosenAttribution`
   confirm-request extension (FR-022); completed-project match → add + reopen
   (Q25 revoke/warn).
6. Wire the per-framing source view (Q20) + per-framing manifest (Q10) once
   those iterations land (consumers, not prerequisites); assert §III (no
   stitch/integrate).
7. Add settings storage + surface for the clustering tunables (FR-014; R11a
   defaults).
8. Layer-1 + vitest tests per Phase F tasks; quickstart + Windows-E2E scenario;
   update the spec-037 coverage matrix.

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
- **Spec 006 (Inventory Lifecycle)** owns the light sessions that become framing
  members; the framing layer references session ids. Session-level geometry is
  persisted at confirm (F-Framing-1); the Q12 strict-gate iterate (spec-006/033/
  041 — **not yet applied**) will guarantee those attributes on new ingests.
  Cross-spec delta recorded in spec-006's iteration log.
- **Spec 009 (Project Lifecycle Model)** owns the `completed → processing`
  reopen edge used by the attribution add + reopen path (Q25). Framing is
  orthogonal to lifecycle. Cross-spec delta recorded in spec-009's iteration
  log.
- **Spec 041 (Inbox Plan Surface)** owns the Inbox confirm gate the attribution
  pass runs in. Q27 extends its confirm contract additively (candidates in the
  response, `chosenAttribution` in the request); the Q22 duplicate sweep joins
  the same pass when its iterate lands. A cross-spec amendment note is recorded
  in spec-041; its **pending Q7 iteration** reworks the same confirm/queue
  surface and must preserve the confirm-time membership write.
- **Spec 026/049 (Source Views)** and **Spec 024 (Manifests)** own the
  per-framing source view (Q20) and manifest (Q10) projections — consumers of
  the framing model delivered by their own iterations, not Phase F
  prerequisites.

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
