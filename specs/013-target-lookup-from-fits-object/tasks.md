---
description: "Tasks for feature 013: Target Lookup From FITS OBJECT"
---

# Tasks: Target Lookup From FITS OBJECT

**Input**: Design documents from `/specs/013-target-lookup-from-fits-object/`
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, contracts/

## Implementation Status: IMPLEMENTED (2026-06-11)

All core tasks are complete. Deferred tasks are marked below with reasons.
Verification: `cargo test --workspace` (0 failures), `cargo clippy --workspace
--all-targets -- -D warnings` (clean), `cargo fmt --all --check` (clean),
`just typecheck` (clean).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies).
- **[Story]**: User story this task belongs to (US1, US1a, US2, US2a, US3).

## Phase 1: Setup (Shared Infrastructure)

- [x] **T001** Create the `crates/targeting/` crate skeleton (Cargo.toml,
  `src/lib.rs`, workspace registration) per `plan.md` Architecture.
  Evidence: `crates/targeting/Cargo.toml`, `src/lib.rs` expanded with full
  module tree; `strsim`, `uuid v5`, `unicode-normalization` added.
- [x] **T002** [P] Add SQLite table definitions for `targets`,
  `target_catalog_refs`, and `catalog_equivalences` to `crates/persistence/db`
  migration. Evidence: `crates/persistence/db/migrations/0017_targets.sql`.
- [x] **T003** [P] Generate Rust DTOs and TypeScript types from
  `contracts/target.lookup.json` and `contracts/target.resolve.json` into
  `crates/contracts/core/` and `packages/contracts/generated/`.
  Evidence: `crates/contracts/core/src/target_lookup.rs`;
  `packages/contracts/src/generated/target.lookup.d.ts`,
  `target.resolve.d.ts`; exported from `packages/contracts/src/index.ts`.

## Phase 2: Foundational (Catalog Reader)

- [x] **T004** Implement `TargetCatalog`, `CatalogRef`, and `CatalogEquivalence`
  types in `crates/targeting/src/catalog.rs` matching `data-model.md`.
  Evidence: `crates/targeting/src/catalog.rs`.
- [x] **T005** Implement the SQLite-backed catalog loader.
  Evidence: `crates/targeting/src/load.rs` (3 DB tests passing).
  DEFER: event-bus rebuild on `catalog.download.completed` — the event bus
  is not yet wired; the Tauri commands re-load from DB on each call as a
  safe default. Hot-reload integration deferred to a follow-up.
- [x] **T006** Implement query normalization (casefold, NFKC, whitespace,
  punctuation, prefix expansion) in `crates/targeting/src/normalize.rs`.
  Evidence: 13 normalize tests + 2 tokenize tests all passing.

## Phase 2b: Equivalence Seeding (Catalog Install Hook)

- [ ] **T010-eq** Implement the equivalence seeding handler (catalog install hook).
  DEFERRED: The `catalog.download.completed` event bus and the manifest
  equivalence sidecar format are not yet landed. The SQLite schema
  (`catalog_equivalences` table in 0017) and repository layer
  (`upsert_equivalence`) are in place for when this is wired.
- [x] **T011-eq** [P] Implement `Target.id` generation via UUIDv5.
  Evidence: `crates/targeting/src/identity.rs` (4 determinism tests passing).

## Phase 3: User Story US1 / US1a — Exact Catalog Resolution (P1)

**Goal**: Exact catalog designations and popular names in `OBJECT` resolve to
a single high-confidence target identity.

**Independent test**: Resolve `OBJECT=M31`, `OBJECT=NGC224`, and
`OBJECT=Andromeda Galaxy` to the same target identity with `confidence=high`.
All three pass in `app_core::target_lookup` tests.

- [x] **T007** [US1a] Implement the normalize-then-exact alias index lookup in
  `crates/targeting/src/lookup/exact.rs`. Emits `TargetMatch` with
  `strategy=exact`, `score=100`, `confidence=high`.
  Evidence: 7 unit tests passing in exact.rs.
- [x] **T008** [US1a] Implement the `target.resolve` use case.
  Evidence: `crates/targeting/src/resolve.rs` (all R3 truth-table tests),
  `crates/app/core/src/target_lookup.rs::resolve`.
- [ ] **T009** [US1] Wire `target.resolve` into ingestion via `crates/app/core/`.
  DEFERRED to spec 005: metadata extraction pipeline (`crates/metadata/fits/`)
  not yet built. Entry point is `app_core::target_lookup::resolve`; callers
  must treat non-`resolved` outcomes as non-blocking per FR-006.
- [x] **T010** [P] [US1a] Contract round-trip tests for `target.resolve` happy
  path (M31, NGC224, common name) in `app_core::target_lookup` tests
  (inline, no separate file needed since seeded catalog is in tests module).

## Phase 4: User Story US2 / US2a — Fuzzy Matching (P2)

**Goal**: Variant spellings (whitespace, punctuation, trailing tokens) still
resolve to the right target with `medium` or `low` confidence.

**Independent test**: `OBJECT=m 101`, `OBJECT=ngc-5457`, `OBJECT=pinwheel`,
`OBJECT=M101 LRGB` all surface the M101 target identity. Tests in fuzzy.rs
cover ngc-5457, pinwheel, M101 LRGB.

- [x] **T011** [US2a] Implement the token-set similarity matcher in
  `crates/targeting/src/lookup/fuzzy.rs` with thresholds from research.md R2.
  Evidence: 6 fuzzy tests passing.
- [x] **T012** [US2a] Implement the Damerau-Levenshtein tie-breaker pass in
  `crates/targeting/src/lookup/edit_distance.rs`.
  Evidence: 2 edit_distance tests passing.
- [x] **T013** [US2] Implement the `target.lookup` use case in
  `crates/app/core/src/target_lookup.rs::lookup`.
  Evidence: 6 lookup tests passing.
- [x] **T014** [P] [US2a] Fuzzy test coverage in `lookup::fuzzy::tests`.
  Evidence: 6 tests (m101 extra token, ngc hyphen, pinwheel, generic word,
  limit, confidence bucket) all passing.
- [x] **T015** [P] [US2] Surface `target.lookup` via `packages/contracts/` exports
  and Tauri commands. Evidence: `target.lookup.d.ts`, `TargetLookup` namespace
  exported; `target_lookup` Tauri command registered in `lib.rs`.

## Phase 5: User Story US3 — Ambiguous And Unresolved Fallback (P3)

**Goal**: Generic, ambiguous, or unavailable lookups never block ingestion.

**Independent test**: `OBJECT=Light` yields `unresolved`; a deliberately
ambiguous alias yields `ambiguous` with ranked candidates.

- [x] **T016** [US3] Implement the ambiguity policy from research.md R3 in
  `crates/targeting/src/resolve.rs` (15-point gap rule, multi-`high` rule).
  Evidence: 8 truth-table tests all passing.
- [x] **T017** [US3] Implement the discard threshold and the `query.empty` and
  `catalog.unavailable` error paths in `app_core::target_lookup`.
  Evidence: `query.empty` and `catalog.not_installed` tests passing.
- [ ] **T018** [US3] Ensure ingestion treats outcomes as non-blocking with audit.
  DEFERRED to spec 005: ingestion pipeline not yet built. The resolve use case
  returns non-panicking enum variants for all error outcomes; callers MUST
  treat non-`resolved` as non-blocking per the documented boundary.
- [x] **T019** [P] [US3] Fallback coverage: `query.empty`, empty catalog
  (`catalog.not_installed`), `unresolved` for generic words — all covered
  in `app_core::target_lookup` tests.

## Dependency Graph

- T001 precedes everything in `crates/targeting/`.
- T002, T003 may run in parallel after T001.
- T004 → T005 → T006 form the foundational chain.
- T010-eq, T011-eq depend on T002 (SQLite tables) and T004 (types).
- US1/US1a (T007–T010 original numbering) depends on T004–T006 and T010-eq.
- US2/US2a (T011–T015) depends on T007 (shares the alias index) and on
  `target.lookup` plumbing.
- US3 (T016–T019) depends on US1 and US2 being in place.
- Test tasks (T010-original, T014, T019) may run in parallel with each other
  once their respective implementation tasks land.

## Out Of Scope

- Online providers (Sesame/SIMBAD/VizieR) — deferred per `research.md` R4.
- Coordinates, magnitudes, or physical properties beyond identity — out of
  scope for v1.
- User-editable catalog overrides — tracked separately.
