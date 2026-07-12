---
description: "Task list for 052-simbad-caching-dual-lookup-cone-search"
---

# Tasks: SIMBAD Resolver Caching, Dual-Lookup, and Cone-Search

**Input**: Design documents from `specs/052-simbad-caching-dual-lookup-cone-search/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/operations.md

**Tests**: Included. Persistence semantics and "never silent auto-apply" are correctness-critical, so targeted unit/integration/contract tests are part of each story.

**Organization**: Grouped by user story (US1/US2/US3 = P1/P2/P3) for independent implementation and testing. Each phase is independently shippable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency).
- Paths are repo-relative and reference real crates from plan.md.

---

## Phase 1: Setup

- [ ] T001 Confirm baseline on branch `052-simbad-caching-dual-lookup-cone-search` (worktree off `origin/main`); run `just lint` and per-crate `cargo test -p targeting-resolver -p app-targets -p app-inbox` to record the green/red baseline (workspace-test baseline is known-red — validate per crate).

---

## Phase 2: Foundational (Blocking Prerequisites for P1)

**⚠️ No user-story work begins until this phase is complete.**

- [ ] T002 [P] Bump `simbad-resolver` `0.1.3 → 0.2.0` in `crates/targeting/resolver/Cargo.toml`; update `Cargo.lock`; skim the 0.2.0 changelog for the `SimbadResolver` facade, `CacheBackend`, `ResolverConfig`, `ResolvedIdentity.v_mag`, and Sesame-fallback API surface used below.
- [ ] T003 [P] Fix `crates/tools/seed-builder/src/main.rs`: widen `parse_basic_row` 5-tuple → 6-tuple `(oid, main_id, ra, dec, otype, v_mag)`; add `f.V` + `LEFT OUTER JOIN allfluxes AS f ON f.oidref = b.oid` to both TAP `SELECT`s (~`:260`, `:297`); thread `v_mag` into `SeedEntry`/`insert_base`. Regenerate the bundled seed and assert magnitude is present where SIMBAD has it.
- [ ] T004 Establish the single normalization choke-point: make `simbad_resolver::normalize` the sole entry for every identity string before caching/persisting/matching in `crates/targeting/resolver/` (audit `cache.rs`, `seed.rs`, `simbad.rs`, `caldwell.rs`, `lib.rs` for any bypass). Unit test: TAP, Sesame, Caldwell, user-query, and seed inputs for one object all normalize identically and dedup to one identity (FR-007).

**Checkpoint**: 0.2.0 available, seed carries magnitude, normalization centralized.

---

## Phase 3: User Story 1 — Persistent cache + in-use persistence + enrichment (P1) 🎯 MVP

**Goal**: Search survives restart with no re-query; durable rows written only on adoption; adopted targets enriched.
**Independent Test**: spec US1 Independent Test.

### Tests (US1)
- [ ] T005 [P] [US1] Integration test: resolve an object, drop and rebuild the facade (simulate restart) pointing at the same redb file → second resolve issues zero network calls (SC-001). Use a spy/fake TAP that counts calls.
- [ ] T006 [P] [US1] Integration test: browse search results without adopting → assert zero `canonical_target` rows; then add to a project → assert exactly one durable row (SC-002, FR-004).
- [ ] T007 [P] [US1] Unit test: adopting a target populates `magnitude` (from `ResolvedIdentity.v_mag` / seed) and `constellation` (skymath) when the source has them; stays NULL when absent (FR-006, SC-003).
- [ ] T008 [P] [US1] Unit test: two alias variants of one physical object map to a single canonical identity via the choke-point dedup (FR-007, US1 scenario 5).

### Implementation (US1)
- [ ] T009 [US1] Refactor `crates/targeting/resolver/src/simbad.rs`: replace the direct `TapResolver` wrapper with `SimbadResolver::new(TapResolver, CacheBackend::File(<app_data>/simbad-cache.redb), ResolverConfig)`; expose the facade as the crate's resolver. (D1, D2)
- [ ] T010 [US1] Build the facade at startup with the File backend in `apps/desktop/src-tauri/src/lib.rs:~934-958` and `commands/target_lookup.rs:~49-74`, resolving the app-data path once (global, not per-library). (D2)
- [ ] T011 [US1] Replace the hand-rolled search in `crates/targeting/resolver/src/cache.rs` (`search_by_normalized` `:245`, `search_fuzzy` `:339`) with `facade.search()` over the unified store; remove the now-dead `token_set_similarity` path if the facade covers it. (D1, FR-001)
- [ ] T012 [US1] Warm the redb cache at first run from the bundled seed (`seed.rs`) and lazily from existing `canonical_target` rows (FR-005).
- [ ] T013 [US1] Move `canonical_target` persistence to the in-use gate in `crates/app/targets/src/target_resolve.rs`: write only on add-to-project / link-to-session / favourite / Inbox-confirm; pure search/typeahead writes cache only (FR-004, supersede spec-035 FR-006). Audit all current persist-on-resolve call sites and remove them.
- [ ] T014 [US1] Enrich on adoption: set `magnitude` from `ResolvedIdentity.v_mag` (online) or seed (offline) and `constellation` via skymath 0.3 IAU-from-coordinates, at the in-use write (FR-006). (D8)
- [ ] T015 [US1] Add the `target.cache.clear` local command (clears redb, never touches `canonical_target`, re-warms from seed + durable rows) + a settings action to invoke it (FR-002).

**Checkpoint**: SC-001, SC-002, SC-003 met; spec-035 FR-006 superseded in behaviour.

---

## Phase 4: User Story 2 — Dual lookup (P2)

**Goal**: TAP-first, Sesame fallback on TAP miss, explicit-resolve only, oid recovery.
**Independent Test**: spec US2 Independent Test. **Depends on US1 (facade + normalization + cache).**

### Tests (US2)
- [ ] T016 [P] [US2] Integration test: a designation the fake TAP misses but the fake Sesame carries resolves via fallback on explicit resolve; asserts it is cached and dedups across aliases (SC-004).
- [ ] T017 [P] [US2] Unit test: during typeahead, the Sesame fallback is NOT invoked (call-count spy) — only on the explicit-resolve entrypoint (FR-009).
- [ ] T018 [P] [US2] Unit test: a Sesame hit lacking `simbad_oid` is re-enriched via TAP to recover one; when unrecoverable, a UUIDv5-from-normalized-designation identity is assigned and dedups stably (FR-010).

### Implementation (US2)
- [ ] T019 [US2] Wire the facade's TAP-first / Sesame-fallback dual lookup in `crates/targeting/resolver/src/simbad.rs`; ensure the fallback runs only from the explicit-resolve path, never the typeahead path (FR-008, FR-009). (D5)
- [ ] T020 [US2] Implement oid recovery: Sesame hit without `simbad_oid` → TAP re-enrich by coordinates/main_id → else UUIDv5-from-designation; route all designations through the choke-point (FR-010, FR-007).
- [ ] T021 [US2] Confirm both online paths are gated by the online-resolve setting; offline degrades to seed + cache (FR-011, FR-018). Add/extend the offline-degradation test.

**Checkpoint**: SC-004 met; fallback is explicit-resolve-only and gated.

---

## Phase 5: User Story 3 — Cone-search suggestion at Inbox ingest (P3)

**Goal**: Per light-frameset, suggest a target from plate-solved/mount pointing with explicit confidence; confirm-only.
**Independent Test**: spec US3 Independent Test. **Depends on US1 (resolution/cache/enrichment); benefits from US2.**

> **Gate (Principle IV)**: Before P3 implementation, resolve research OQ-1 (catalogue-prominence ranking) and OQ-2 (default otype exclusion set) with the user; encode the confirmed values before T028/T029.

### Design gate (US3)
- [ ] T022 [US3] Resolve OQ-1 + OQ-2 with the user (proposed defaults in research.md); record the confirmed prominence ranking and exclusion set in research.md before implementing ranking.

### Tests (US3)
- [ ] T023 [P] [US3] Contract test: `target.cone_search.suggest` — plate-solved frameset → high-confidence `preselected: true`; mount-only → shown, `preselected: false`; filename-only / no pointing → `source: "none"`, empty suggestions (SC-005, FR-012, FR-014).
- [ ] T024 [P] [US3] Unit test: multi-object frame → primary = nearest-to-centre among non-excluded, tie-broken by prominence; excluded otypes flagged not pre-selected (FR-015).
- [ ] T025 [P] [US3] Integration test: `suggest` writes no `canonical_target` row; `confirm` writes exactly one (or reuses a dedup match) and links the frameset (SC-006, FR-016).
- [ ] T026 [P] [US3] Unit test: rotation-aware footprint includes an object inside the true rotated field that an axis-aligned box would drop; unknown optics → ~1° default radius (FR-013).

### Implementation (US3)
- [ ] T027 [US3] Pointing derivation (per light-frameset) in `crates/app/inbox/` / `crates/app/targets/`: WCS `CRVAL1/2` → mount `OBJCTRA/OBJCTDEC` → none; never filename; sub-disagreement beyond tolerance → none (FR-012). (D9)
- [ ] T028 [US3] Cone-search + ranking in `crates/targeting/`: FOV/footprint via target-match 0.3 (rotation-aware), radius from optics with ~1° default, top-N candidates; confidence = separation + source quality + prominence (OQ-1); exclusion set (OQ-2); nearest-to-centre primary (FR-013, FR-014, FR-015). (D9)
- [ ] T029 [US3] Contract DTOs in `crates/contracts/core/` for `target.cone_search.suggest` + `target.cone_search.confirm` (per contracts/operations.md); register Tauri commands (fn name == invoke target, no specta rename); regenerate `packages/contracts` bindings.
- [ ] T030 [US3] Wire cone-search at Inbox ingest per light-frameset (auto `reason: ingest`) and expose the on-demand re-run (`reason: on_demand`) (FR-017); gate on the online-resolve setting, degrade gracefully offline (`resolve.offline`, FR-018).
- [ ] T031 [US3] Inbox confirm-gate suggestion UI in `apps/desktop/src/features/inbox/`: show ranked suggestions, pre-select only high confidence, require explicit confirm; confirm calls `target.cone_search.confirm` (never auto-apply) (FR-014, FR-016, SC-006).

**Checkpoint**: SC-005, SC-006 met — coordinate-driven suggestions, confirm-only.

---

## Phase 6: Polish & Verification

- [ ] T032 Constitution re-check (custody, reviewable/confidence-carrying suggestion, PixInsight boundary, §V cache-projection vs canonical) against the built feature.
- [ ] T033 `just lint` / per-crate `cargo test` / `just typecheck` green; regenerate + commit bindings.
- [ ] T034 `speckit-verify` against FR-001..FR-018 and SC-001..SC-006; `speckit-verify-tasks` to catch phantom completions.
- [ ] T035 `verify-on-windows` scenario for US1 (persist-across-restart + in-use write) and US3 (Inbox suggestion) on the real Tauri app; add the matching tauri-driver Layer-2 journey + coverage-matrix update.

---

## Dependencies

- **Phase 2 (T002–T004)** blocks all user-story work.
- **US1 (T005–T015)** depends on T002/T003/T004. → MVP (P1).
- **US2 (T016–T021)** depends on US1 (facade + normalization + cache).
- **US3 (T022–T031)** depends on US1 (resolution/cache/enrichment); benefits from US2; T022 (OQ gate) blocks T028/T029.
- **Phase 6 (T032–T035)** depends on the targeted stories.

### Dependency graph

```
T001 ─▶ T002 ┐
        T003 ┼─▶ US1(T005–T015) ─▶ US2(T016–T021)
        T004 ┘         └─▶ T022(OQ gate) ─▶ US3(T023–T031)
US1..US3 ─▶ Phase 6 (T032–T035)
```

## Parallelization notes

- Foundational T002/T003 touch different files (resolver Cargo.toml vs seed-builder) → parallelizable; T004 is a focused refactor over the resolver crate.
- Within each story, [P] tests are independent; implementation tasks touching the same file (e.g. T009/T011/T019 all in `simbad.rs`/`cache.rs`) are serialized.
- P1 → P2 → P3 ship in order; each phase is an independently reviewable/mergeable slice.
