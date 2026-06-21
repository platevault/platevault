# Implementation Plan: Inbox Confirmation & Reviewable Plan Surface

**Branch**: `041-inbox-plan-surface` | **Date**: 2026-06-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/041-inbox-plan-surface/spec.md`

## Summary

Rework the inbox confirmation surface and the file-organization plan model so that:
- confirming an item produces a **reviewable plan shown in-context** (planned items stay visible/greyed, explicit Apply, batch apply-all, audit, staleness refusal);
- the review list is **structured (no pills) with multi-level grouping** and the detail panel shows **persisted per-file FITS metadata** with **overrides beyond frame type** (filter/exposure/binning) and **multi-select apply-to-all**;
- whether files are **moved or catalogued in place** is keyed on a new **per-source organization state** (organized/unorganized), orthogonal to content `kind`, chosen at source-add time and explained in the wizard;
- confirming a mixed folder **auto-splits** into per-type actions; the queue shows **per-type stats**; and the **Archive-vs-Trash** destructive control is clearly placed.

Technically this requires: a new `registered_sources.organization_state` column; a **catalogue-in-place** plan action (record file without moving); **persisting per-file metadata** and **extending overrides** to non-type fields (content-identity-keyed for rescan survival); an **in-context plan panel** on the inbox surface reusing the existing plan/executor/audit machinery; a **per-type stats** aggregate; and source-add UX for the organization-state choice.

## Technical Context

**Language/Version**: Rust (workspace, edition 2021) for core/domain/persistence; TypeScript + React 19 (Vite) for `apps/desktop`; Tauri v2 desktop shell.
**Primary Dependencies**: SQLite via `sqlx`; `tauri-specta` (generated TS bindings — authoritative); `crates/patterns` (`resolve_v1` naming-pattern resolver); `crates/fs/planner` + `crates/fs/executor` (reviewable plan/apply, CAS staleness); `crates/metadata/{core,fits,xisf}` (header extraction); `crates/audit`.
**Storage**: SQLite (migrations under `crates/persistence/db/migrations/`, currently through 0044). New migration `0045` for this feature.
**Testing**: `just test` / `cargo test` per-crate (workspace test is red on `main` per known breakage — validate with `-p <crate>`); Vitest + RTL for frontend; real Windows app for E2E UI verification.
**Target Platform**: Cross-platform desktop (Windows primary verify target; WSL dev).
**Project Type**: Tauri desktop monorepo (Rust crates + React frontend + language-neutral contracts).
**Performance Goals**: Inbox list responsive at the existing cap (~500 items); grouping/stats must not require eager full-file hashing.
**Constraints**: Large-file hashing MUST stay optional/lazy (Constitution Product Constraints) — override identity uses cheap signals (path + size + mtime), **not** a content hash. No symlink/junction following. Overrides never modify user files.
**Scale/Scope**: Personal astrophotography libraries (thousands of files/session; many roots). 7 user stories (US1–US7), 28 functional requirements.

**Unknowns resolved in Phase 0** (research.md): catalogue-in-place action modeling; per-file metadata persistence; non-type override schema; override identity keying under lazy-hashing; in-context plan surface vs Archive reuse; per-type stats query; organization-state migration/default & wizard placement; auto-split + per-file provenance plan generation.

## Constitution Check

*Gate evaluated against `.specify/memory/constitution.md` v1.0.0.*

| Principle | Assessment | Verdict |
|---|---|---|
| **I. Local-First File Custody** | Adds organized→catalogue-in-place (files never moved) and unorganized→reviewable move plan; roots stay separate from relative paths. Strengthens custody. | ✅ PASS |
| **II. Reviewable Filesystem Mutation** | Every move stays a reviewable, explicitly-applied, audited plan; this feature makes plans *visible in-context* and never auto-applies. Catalogue-in-place writes a DB record + audit, no silent mutation. | ✅ PASS |
| **III. PixInsight Boundary** | No calibration/stacking/editing. Overrides are app-side metadata only (FR-016) — user files never modified. | ✅ PASS |
| **IV. Research-Led Domain Modeling** | Organization-state, override model, catalogue-in-place, override-identity treated as research questions with options + recommended defaults (research.md). | ✅ PASS |
| **V. Portable Contracts & Durable Records** | New/changed operations as language-neutral contracts; SQLite stays the durable record; destination previews are reproducible projections of the active pattern. | ✅ PASS |

**Product-constraint gates**: messy libraries without forced migration (organization-state) ✅; cross-platform paths (reuse root/relative-path + planner path-gate) ✅; large-file hashing optional/lazy (override identity = size+mtime, not hash — R-4) ✅; no symlink/junction following (unchanged) ✅; cleanup exclusions / destructive actions remain plan-reviewed, archive-preferred (US7) ✅.

**Result**: No violations. No Complexity Tracking entries required (initial and post-design gates both pass).

## Project Structure

### Documentation (this feature)

```
specs/041-inbox-plan-surface/
├── spec.md              # /speckit.specify output (done)
├── plan.md              # this file
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — entities & schema deltas (migration 0045)
├── contracts/
│   └── operations.md    # Phase 1 — operation contracts
├── quickstart.md        # Phase 1 — manual verification walkthrough
└── checklists/
    └── requirements.md  # spec quality checklist (done)
```

### Source code (affected paths)

```
crates/
├── contracts/core/src/
│   ├── first_run.rs          # + organization_state on source register/update DTOs
│   └── inbox.rs              # + per-file metadata DTO, non-type overrides, plan/stats DTOs
├── persistence/db/
│   ├── migrations/0045_*.sql # organization_state; inbox_file_metadata; evidence override cols
│   └── src/repositories/
│       ├── first_run.rs      # read/write organization_state
│       ├── inbox.rs          # metadata persistence, override read/write, per-type stats query
│       └── plans.rs          # catalogue-in-place item support; list-by-inbox-item
├── fs/planner/               # + Catalogue action kind
├── fs/executor/              # + catalogue op (DB record, no FS move) at apply
└── app/core/src/inbox/
    ├── classify.rs           # persist per-file metadata; carry non-type overrides
    ├── reclassify.rs         # apply non-type overrides; rebuild breakdown (done) + metadata
    └── confirm.rs            # organization-state branch (move vs catalogue); auto-split; per-file provenance

apps/desktop/src/
├── features/setup/           # organization-state choice at source-add + explainer/flow diagram
├── features/inbox/           # structured list (no pills), multi-level grouping, metadata detail,
│                             #   multi-select overrides, in-context plan panel, per-type stats
└── api/commands.ts           # wrappers for new/changed commands (generated bindings authoritative)
```

**Structure decision**: Existing monorepo layout suffices; no new crates. Changes are additive (one migration, additive contract fields, one new plan action, new frontend panels). Domain logic stays in `app/core`/`fs`; the inbox feature folder owns the UI.

## Phase 0: Research (→ research.md)

Resolve: (R-1) catalogue-in-place action modeling; (R-2) per-file metadata persistence shape; (R-3) non-type override schema; (R-4) override identity keying under lazy-hashing; (R-5) in-context plan surface vs Archive reuse; (R-6) per-type stats query; (R-7) organization-state migration/default & wizard placement; (R-8) auto-split + per-file provenance plan generation.

## Phase 1: Design & Contracts

- **data-model.md**: entities + concrete schema deltas (migration 0045) — `registered_sources.organization_state`; `inbox_file_metadata` table; evidence override columns + identity; planner Catalogue action; per-type stats.
- **contracts/operations.md**: source register/update (organization_state); inbox item detail (per-file metadata); reclassify/override (non-type fields, multi-file); confirm (organization-state-driven move vs catalogue, auto-split, per-file provenance); plan list/apply/cancel scoped to inbox item + batch apply; inbox stats.
- **quickstart.md**: end-to-end manual verification mapped to US1–US7 acceptance scenarios (real Windows app).
- **Agent context**: update the plan reference if SPECKIT markers exist in `CLAUDE.md` (APM-owned — do not hand-edit otherwise).

## Phase 2: Task generation approach (preview — produced by /speckit.tasks)

Tasks grouped by user story (independently testable), dependency-ordered: schema migration → contracts/DTOs → persistence repos → app/core use cases (organization-state, confirm move-vs-catalogue + auto-split, classify metadata persistence, reclassify non-type overrides) → planner/executor Catalogue action → Tauri commands + generated bindings → frontend (list/grouping, detail/metadata, overrides/multi-select, in-context plan panel, stats, source-add UX) → tests (Rust per-crate + Vitest + Windows E2E). **MVP = US1 (in-context reviewable plan) + US2 (structured list + metadata)**; **US4 (organization-state)** gates move-vs-catalogue and the source-add UX.

## Complexity Tracking

No constitutional violations; no complexity deviations to justify.
