---
description: "Tasks for feature 013: Target Lookup From FITS OBJECT"
---

# Tasks: Target Lookup From FITS OBJECT

**Input**: Design documents from `/specs/013-target-lookup-from-fits-object/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/

## Implementation Status: NOT IMPLEMENTED

No tasks below have been started. All paths are planned locations under the
future `crates/targeting/` crate and the existing `packages/contracts/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies).
- **[Story]**: User story this task belongs to (US1, US1a, US2, US2a, US3).

## Phase 1: Setup (Shared Infrastructure)

- **T001** Create the `crates/targeting/` crate skeleton (Cargo.toml,
  `src/lib.rs`, workspace registration) per `plan.md` Architecture.
- **T002** [P] Add the bundled catalog data folder
  `crates/targeting/data/` containing Messier, OpenNGC/IC snapshots, and the
  curated common-names list, with `LICENSE`/`NOTICE` files per `research.md` R1.
- **T003** [P] Generate Rust DTOs and TypeScript types from
  `contracts/target.lookup.json` and `contracts/target.resolve.json` into
  `crates/contracts/core/` and `packages/contracts/generated/`.

## Phase 2: Foundational (Catalog Reader)

- **T004** Implement `TargetCatalog` and `CatalogRef` types in
  `crates/targeting/src/catalog.rs` matching `data-model.md`.
- **T005** Implement the bundled-catalog loader (Messier + OpenNGC + IC +
  common names) into an in-memory `TargetCatalog` with stable `Target.id`
  generation. Path: `crates/targeting/src/catalog/load.rs`.
- **T006** Implement query normalization (casefold, NFKC, whitespace,
  punctuation, prefix expansion) in
  `crates/targeting/src/normalize.rs` per `research.md` R2 stage 1.

## Phase 3: User Story US1 / US1a — Exact Catalog Resolution (P1)

**Goal**: Exact catalog designations and popular names in `OBJECT` resolve to
a single high-confidence target identity.

**Independent test**: Resolve `OBJECT=M31`, `OBJECT=NGC224`, and
`OBJECT=Andromeda Galaxy` to the same target identity with `confidence=high`.

- **T007** [US1a] Implement the normalize-then-exact alias index lookup in
  `crates/targeting/src/lookup/exact.rs`. Emits `TargetMatch` with
  `strategy=exact`, `score=100`, `confidence=high`.
- **T008** [US1a] Implement the `target.resolve` use case in
  `crates/targeting/src/resolve.rs`: collapse the single high-confidence
  match into a `Response`; return `unresolved` when no match.
- **T009** [US1] Wire `target.resolve` into ingestion via
  `crates/app/core/` so extracted FITS `OBJECT` values are routed through
  the operation contract.
- **T010** [P] [US1a] Contract round-trip tests for `target.resolve` happy
  path (M31, NGC224, common name) in
  `crates/targeting/tests/resolve_exact.rs`.

## Phase 4: User Story US2 / US2a — Fuzzy Matching (P2)

**Goal**: Variant spellings (whitespace, punctuation, trailing tokens) still
resolve to the right target with `medium` or `low` confidence.

**Independent test**: `OBJECT=m 101`, `OBJECT=ngc-5457`, `OBJECT=pinwheel`,
`OBJECT=M101 LRGB` all surface the M101 target identity with non-`high`
confidence and recorded evidence.

- **T011** [US2a] Implement the token-set similarity matcher in
  `crates/targeting/src/lookup/fuzzy.rs` with the thresholds from
  `research.md` R2 stage 2.
- **T012** [US2a] Implement the Damerau–Levenshtein tie-breaker pass on top
  scorers in `crates/targeting/src/lookup/edit_distance.rs`.
- **T013** [US2] Implement the `target.lookup` use case in
  `crates/targeting/src/lookup.rs`, returning a ranked
  `Vec<TargetMatch>` with evidence.
- **T014** [P] [US2a] Tests in
  `crates/targeting/tests/lookup_fuzzy.rs` covering variant-spelling
  scenarios from the spec.
- **T015** [P] [US2] Surface `target.lookup` to the desktop UI catalog
  picker via `packages/contracts/` exports.

## Phase 5: User Story US3 — Ambiguous And Unresolved Fallback (P3)

**Goal**: Generic, ambiguous, or unavailable lookups never block ingestion.

**Independent test**: `OBJECT=Light` yields `unresolved`; a deliberately
ambiguous alias yields `ambiguous` with ranked candidates; a corrupted
catalog yields `catalog.unavailable`.

- **T016** [US3] Implement the ambiguity policy from `research.md` R3 in
  `crates/targeting/src/resolve.rs` (15-point gap rule, multi-`high` rule).
- **T017** [US3] Implement the discard threshold and the `query.empty` and
  `catalog.unavailable` error paths in `crates/targeting/src/lookup.rs`.
- **T018** [US3] Ensure ingestion in `crates/app/core/` treats
  `unresolved`, `ambiguous`, and `catalog.unavailable` as non-blocking and
  records an audit event via `crates/audit/`.
- **T019** [P] [US3] Tests in
  `crates/targeting/tests/resolve_fallback.rs` covering generic OBJECT
  values, ambiguous aliases, empty queries, and catalog-load failure.

## Dependency Graph

- T001 precedes everything in `crates/targeting/`.
- T002, T003 may run in parallel after T001.
- T004 → T005 → T006 form the foundational chain.
- US1/US1a (T007–T010) depends on T004–T006.
- US2/US2a (T011–T015) depends on T007 (shares the alias index) and on
  `target.lookup` plumbing.
- US3 (T016–T019) depends on US1 and US2 being in place.
- Test tasks (T010, T014, T019) may run in parallel with each other once
  their respective implementation tasks land.

## Out Of Scope

- Online providers (Sesame/SIMBAD/VizieR) — deferred per `research.md` R4.
- Coordinates, magnitudes, or physical properties beyond identity — out of
  scope for v1.
- User-editable catalog overrides — tracked separately.
