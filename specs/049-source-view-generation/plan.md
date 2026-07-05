# Implementation Plan: Source View Generation

**Branch**: `049-source-view-generation` | **Date**: 2026-07-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/049-source-view-generation/spec.md`

## Summary

Restore the **generation** (first-materialization) path for prepared project
source views: produce a WBPP/PixInsight-ready input tree of the project's
selected light frames plus their matched calibration, laid out per the selected
workflow profile, as a **reviewable filesystem plan of link actions** (never
copies by default). This spec adds only the generation surface; it **reuses**
spec 026's `PreparedSourceView` / `PreparedSourceViewItem` entities and
remove/regenerate/stale machinery, the spec 017/025 plan review→approve→apply
pipeline, the `crates/patterns` token resolver (spec 015), and the workflow
profiles (spec 011). The link kind is resolved **deterministically per
drive-scope** from a settings pair (intra-drive / cross-drive defaults), recorded
per item, with a non-silent plan-time notice only on capability drift.

## Technical Context

**Language/Version**: Rust 1.75+ (workspace crates); TypeScript (React desktop
shell, generated contract types).

**Primary Dependencies**: existing workspace only — `crates/fs/planner`,
`crates/fs/inventory`, `crates/project/structure`, `crates/patterns`,
`crates/workflow/profiles`, `crates/calibration/core`, `crates/app/core`,
`crates/contracts/core`, `crates/persistence/db` (sqlx/SQLite), `crates/audit`,
`packages/contracts`. No new heavy dependencies (Constitution: deliberate deps).

**Storage**: SQLite canonical store. Reuses `prepared_source_views` /
`prepared_source_view_items` (migration 0029). New settings keys via the spec 018
KV `settings` table (migration 0013) — **no new table**. One migration `0061`
expands the `plans.origin` / `plan_type` CHECK constraints for the new
`prepared_view_generation` origin.

**Testing**: `cargo test --workspace` (unit + crate integration), package tests,
contract-schema validation in `packages/contracts/tests`.

**Target Platform**: Windows, macOS, Linux desktop (Tauri). Cross-platform link
semantics (symlink/junction/hardlink) are first-class.

**Project Type**: Local-first Tauri desktop app, granular Rust workspace + TS
contracts.

**Performance Goals**: Plan build over a few thousand selected frames within
interactive time; no image bytes read (links only, no hashing at generation).

**Constraints**: Never write outside the chosen destination; never overwrite
silently; no image processing; produce only the image tree (no `.xpsm`/`.xosm`).

**Scale/Scope**: Single project per generation; view membership up to tens of
thousands of items.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Assessment |
|-----------|------|------------|
| **I. Local-First File Custody** | Originals stay on disk; sources referenced by root + relative path; links recorded as app-created projections. | **PASS** — FR-002/FR-005/FR-020. Generation only creates links under the destination; sources resolved via root+relpath (never stale absolute); no image copied into an app store. |
| **II. Reviewable Filesystem Mutation** | Every mutation is a reviewable plan; explicit apply; per-item audit; no silent overwrite. | **PASS** — FR-001 (reviewable plan via spec 017/025), FR-007 (per-item audit), FR-016 (no silent overwrite), FR-004b (non-silent capability-drift notice), FR-009a (collision = validation error, never silent suffix). |
| **III. PixInsight Boundary** | No calibrate/register/integrate/edit; no tool-control files. | **PASS** — FR-011 + SC-002: image links and folders only; **zero** `.xpsm`/`.xosm`/process-icon/config files. Calibration is **consumed** (specs 007/040), never computed. |
| **IV. Research-Led Domain Modeling** | Layout/naming/reuse are research decisions with recorded tradeoffs. | **PASS** — layout is profile-driven token patterns (FR-008/FR-009); link-kind default pair + capability-constraint model is a recorded decision (research.md). No hardcoded structure. |
| **V. Portable Contracts & Durable Records** | Language-neutral contracts; DB canonical; views are reproducible projections. | **PASS** — new IPC commands are JSON-Schema contracts (FR-006); `PreparedSourceView` rows are canonical, the on-disk tree is a reproducible projection (FR-006); settings pair persisted as durable KV. |

**Result: PASS (no violations).** Complexity Tracking table below is empty — no
constitutional deviation to justify. Re-check after Phase 1: the migration `0061`
adds only an enum value to an existing constraint (no new durable entity), and no
new crate is introduced; PASS holds.

## Reuse Map (what this spec does NOT re-build)

| Concern | Owner (reused) | This spec adds |
|---------|----------------|----------------|
| `PreparedSourceView` / `PreparedSourceViewItem` entities + repo | spec 026 (`crates/project/structure`, `crates/persistence/db` 0029) | first-materialization write path; per-item recorded kind (column already exists) |
| View removal / regeneration-after-removal / stale detection | spec 026 (`prepared_view_removal` / `prepared_view_regeneration`) | nothing — reused unchanged (FR-013); US3 regeneration delegates to spec 026's `ViewRegenerationPlan` |
| Plan review → approve → apply → per-item revalidation → audit | specs 017/025 (`crates/fs/planner`, plan pipeline, `crates/audit`) | a new plan **origin** only (`prepared_view_generation`); no new executor |
| Token-pattern grouping (session/night → filter → exposure) | spec 015 (`crates/patterns`) | per-profile layout patterns resolved to destination relative paths |
| Workflow/processing profile → layout selection | spec 011 (`crates/workflow/profiles`) | WBPP layout pattern binding; profile-driven calibration placement |
| Calibration matches / masters | specs 007/040 (`crates/calibration/core`) | consume resolved matches (FR-010); warn when absent (FR-010a) |
| Project envelope destination | spec 024 (`crates/project/structure`) | `<project>/source-views/<view>/` default + per-project/per-generation override |
| Settings KV | spec 018 (`crates/domain/core/settings.rs`, `settings` table 0013) | two flat fields: `source_view_link_kind_intra_drive`, `source_view_link_kind_cross_drive` |
| Per-frame selection granularity | spec 048 (per-frame inventory) | consume per-frame where present; session-level fallback (FR/CL-9) |

## Crate Boundaries (changes)

- `crates/domain/core/`: add the two link-kind settings fields to `SettingsState`
  (+ defaults `hardlink` intra / `symlink` cross); add a `DriveScope` classifier
  and a `LinkKind` resolver rule (deterministic, pure).
- `crates/fs/inventory/`: add a **filesystem-capability probe** (symlink privilege,
  junction support, same-volume detection) and a **volume identity** helper used to
  classify each source's drive-scope relative to the destination.
- `crates/fs/planner/`: add the `prepared_view_generation` plan origin +
  `source_view_generation` plan type; a **GenerationPlan builder** that resolves
  layout paths via `crates/patterns`, classifies each item's drive-scope, chooses
  the recorded kind from the settings pair, detects collisions (validation error),
  detects capability drift (non-silent notice), and emits per-item `link` (or opt-in
  `copy`) actions.
- `crates/project/structure/`: first-materialization write of `PreparedSourceView`
  (state `current`) + items with recorded `materialization`; resolve default
  destination `<project>/source-views/<view>/`; persist per-project destination
  override.
- `crates/workflow/profiles/`: expose each profile's layout token pattern and
  calibration placement rule (WBPP first).
- `crates/app/core/`: use cases `GenerateSourceView` and `VerifySourceView`;
  `GenerateSourceView` consumes calibration matches (masters-when-available) and
  attaches the "no calibration applied" warning when unmatched.
- `crates/contracts/core/` + `packages/contracts/`: `sourceview.generate`,
  `sourceview.verify`, and the two settings keys (via existing `settings.*`).
- `crates/persistence/db/`: migration `0061` (enum expansion only).

## Plan Flow

1. User invokes `sourceview.generate { projectId, profileId?, destinationOverride?,
   copyOptIn? }`. Project lifecycle is validated per spec 026 FR-012.
2. App resolves the profile layout pattern (spec 011/015), the selected lights
   (per-frame where spec 048 exists, else session-level), and the resolved
   calibration matches / masters (specs 007/040). Missing/unmatched groups become
   plan warnings (FR-010a, FR-019) — generation is not blocked.
3. For each item, classify drive-scope vs destination volume, pick the recorded
   link kind from the settings pair (capability-constrained), and resolve the
   layout-relative destination path. Collisions → validation error (FR-009a).
   Capability drift → non-silent notice + documented fallback (FR-004b).
4. Emit a `FilesystemPlan` (origin `prepared_view_generation`) of per-item `link`
   (or opt-in `copy`) + `mkdir` actions. Return `planId`; it enters the standard
   spec 017/025 pipeline (approve → apply). Nothing touches disk before apply.
5. On successful apply, write the `PreparedSourceView` (state `current`) + items
   with recorded `materialization`; per-item audit is emitted by the executor hook.
6. `sourceview.verify { viewId }` is read-only: report every broken/missing/stale
   item; no mutation, no auto-repair (FR-014/FR-015). Repair is via spec 026
   regeneration.

## Project Structure

### Documentation (this feature)

```text
specs/049-source-view-generation/
├── spec.md              # amended (all 9 clarifications folded in)
├── plan.md              # this file
├── data-model.md        # entities reused + settings-pair + migration verdict
├── contracts/           # sourceview.generate.json, sourceview.verify.json, settings keys
└── tasks.md             # tasks grouped by US1..US4
```

### Source Code (repository root)

```text
crates/
├── domain/core/         # SettingsState link-kind pair, DriveScope, LinkKind resolver
├── fs/inventory/        # capability probe + volume identity
├── fs/planner/          # generation plan origin + GenerationPlan builder
├── project/structure/   # first-materialization write + destination resolution/override
├── workflow/profiles/   # WBPP layout pattern + calibration placement
├── app/core/            # GenerateSourceView, VerifySourceView use cases
├── contracts/core/      # DTOs for generate/verify
└── persistence/db/
    └── migrations/0061_source_view_generation_origin.sql
packages/contracts/schemas/  # sourceview.generate/verify schemas
apps/desktop/                # generation dialog + settings pane (capability-constrained)
```

**Structure Decision**: Reuse the established granular-crate layout; no new crate.
The only durable-schema change is a CHECK-constraint enum expansion (migration
0061). All new persistent state (settings pair) rides the existing spec 018 KV.

## Complexity Tracking

> No Constitution Check violations — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
