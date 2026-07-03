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
**Storage**: SQLite (migrations under `crates/persistence/db/migrations/`). Migration `0045` (this feature, applied) + the destination-model iteration; the single-type ingest iteration adds **`0048`** (`0046` + `0047` are already taken by `0046_session_canonical_target.sql` + `0047_target_constellation_magnitude.sql`; PR #317 renamed target_constellation to 0047 to resolve the dual-0046).
**Testing**: `just test` / `cargo test` per-crate (workspace test is red on `main` per known breakage — validate with `-p <crate>`); Vitest + RTL for frontend; real Windows app for E2E UI verification.
**Target Platform**: Cross-platform desktop (Windows primary verify target; WSL dev).
**Project Type**: Tauri desktop monorepo (Rust crates + React frontend + language-neutral contracts).
**Performance Goals**: Inbox list responsive at the existing cap (~500 items); grouping/stats must not require eager full-file hashing.
**Constraints**: Large-file hashing MUST stay optional/lazy (Constitution Product Constraints) — override identity uses cheap signals (path + size + mtime), **not** a content hash. No symlink/junction following. Overrides never modify user files.
**Scale/Scope**: Personal astrophotography libraries (thousands of files/session; many roots). **16 user stories (US1–US16)**, **FR-001–FR-054** across three increments: the base reviewable-plan surface (US1–US7), the destination-model iteration 2026-06-21 (US8–US9 / FR-025–FR-033), and the single-type ingest iteration 2026-06-23 (US10–US16 / FR-034–FR-054).

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

**Post-design re-check — iterations 2026-06-21 & 2026-06-23** (Constitution gate re-evaluated for US8–US16 / FR-025–FR-054):

| Principle | New-scope assessment | Verdict |
|---|---|---|
| **I. Local-First** | Generic per-file overrides (FR-044–FR-046) are app-side **index metadata only**, never written to FITS/XISF; source-groups keep root separate from relative path. | ✅ PASS |
| **II. Reviewable Mutation** | Single-type confirm still produces a reviewable, explicitly-applied, audited plan (item↔plan 1:1); destination-root selection + missing-mandatory gate happen **before** apply. | ✅ PASS |
| **III. PixInsight Boundary** | Coordinate target resolution, grouping, and extended extraction only read/derive metadata; no calibration/stacking/header rewriting. | ✅ PASS |
| **IV. Research-Led** | Each pivot decision (R-9–R-18) compares options, picks a default, keeps config; coordinate NN reuses the existing target/SIMBAD DB with no heavy dependency. | ✅ PASS |
| **V. Portable Contracts** | New ops (`inbox.property_registry`, `inbox.target_recommendations`) are language-neutral; SQLite stays the durable record; session lifecycle drop (FR-051) keeps the durable audit + reviewable plans. | ✅ PASS |

Extended extraction stays **lazy** (classify-time header reads, no eager hashing — Product Constraint). New migration `0048` is additive.

**Result**: No violations. Initial, post-design, and both iteration re-check gates pass; no Complexity Tracking entries required.

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

## Iteration 2026-06-21: Destination model

Builds on the merged 041 apply path (root_id now resolves via `registered_sources`).

- **Pattern resolver** (`crates/patterns`): add per-type pattern support + a selector keyed on the resolved type (incl. master-vs-raw), with built-in default fallback. (T049)
- **Settings** (`crates/persistence/db` + settings use-case + `apps/desktop` Settings UI): persist/edit per-type patterns using the shared token vocabulary; validate tokens; reset-to-default. (T050/T051)
- **`crates/app/core/src/inbox/confirm.rs`**: select pattern by resolved type (no target for calibration); replace unconditional `to_root_id = from_root_id` with destination-root resolution (in-place default / inbox-must-target / candidate enumeration by type / ambiguity → require caller `root_id`); build absolute destination. (T052/T053)
- **`crates/app/core/src/inbox/classify.rs` (+ contracts/bindings)**: compute per-file `missing_path_attributes`; confirm rejects with a typed error when required attributes are missing or the destination root is ambiguous and unselected; `inbox_confirm` request gains optional `root_id`; classify/plan responses carry candidate roots + absolute destination. (T054/T056)
- **Frontend** (`InboxDetail`/`PlanPanel`): destination-root picker (ambiguous/inbox only), absolute-path display, and a missing-attribute input gate mirroring the IMAGETYP needs-review flow. (T055/T057)
- **Tests**: Layer-1 (resolver/root/gate), vitest (picker/path/gate), Windows E2E via tauri MCP + coverage-matrix update. (T058–T060)

## Iteration 2026-06-23: Single-type ingest (US10–US16, FR-034–FR-054)

Structural pivot: the inbox unit of work becomes one **single-type sub-item per homogeneous group within a leaf folder** (item↔plan strictly 1:1), with source-group provenance, a field-agnostic reclassifier over a typed property registry, a generalized missing-mandatory gate + needs-review bucket, coordinate-based light target resolution, extended header extraction, and the session review lifecycle dropped in favour of derived sessions. Full decisions in research.md (R-9–R-18); schema in data-model.md (migration **0048**).

- **Foundational**: migration `0049_inbox_single_type.sql` (`inbox_source_groups`, sub-item identity `(root_id, relative_path, group_key)`, `inbox_file_overrides`, collapsed classification result, extended metadata incl. pixel size) — T061; extended FITS/XISF extraction — T062. (FR-034/FR-042/FR-046/FR-053/FR-054)
- **Grouping/classify/reclassify** (`crates/app/core/src/inbox/{scan,classify,reclassify,confirm}.rs` + a grouping engine + property-registry module): classify-then-split materialization, per-type recipes with bucketing/tolerances, flat↔light `ROTATANG` matching (T080), field-agnostic bulk reclassify, generalized gate + re-split loop, confirm simplification (delete split/mixed). (FR-035–FR-041/FR-044–FR-050)
- **Target resolution** (`crates/targeting` + `inbox.target_recommendations`): FOV-aware coordinate NN over the gen-3/SIMBAD target DB with a fixed-radius fallback; project propagation. (FR-052)
- **Sessions** (`crates/sessions` + spec 006/045 reconciliation): drop the review lifecycle; sessions are derived, already-confirmed inventory with an editable metadata view; migrate legacy `plan_open` items. (FR-051/FR-054) — cross-spec impact resolved via `/speckit.sync.conflicts` (T078), run early.
- **Contracts/bindings**: `inbox.list` (+sourceGroup/groupKey/frameType/missingMandatory), `inbox.confirm` (`action` removed), field-agnostic `inbox.reclassify`, `inbox.property_registry`, `inbox.target_recommendations`, extended metadata DTO. (T072)
- **Constitution**: re-checked above — PASS (overrides index-only; reviewable plans + durable audit retained; lazy extraction; no heavy dependency).
