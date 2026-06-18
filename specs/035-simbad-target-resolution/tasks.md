---
description: "Task list for SIMBAD Target Resolution (spec 035)"
---

# Tasks: SIMBAD Target Resolution

**Input**: Design documents from `specs/035-simbad-target-resolution/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/
**Tests**: included — the design relies on a `FakeResolver` seam, contract↔wire parity, and quickstart scenarios.
**Organization**: by user story (US1–US5) for independent implementation/testing.

## Format: `[ID] [P?] [Story] Description with file path`

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Create `crates/targeting/src/resolver/` module (`mod.rs`, `simbad.rs`, `cache.rs`, `seed.rs`) and register `pub mod resolver;` in `crates/targeting/src/lib.rs`
- [X] T002 Add `reqwest` (+ `tokio`, `serde`, `serde_json` if missing) to `crates/targeting/Cargo.toml` for the SIMBAD client; behind the `Resolver` trait
- [X] T003 [P] Create a NEW append-only migration `crates/persistence/db/migrations/0031_target_resolution.sql` scaffold. Append-only: do NOT edit or delete the prior `0016_catalogs.sql`; `0031` both creates the resolution tables and (T006) drops the superseded catalog tables via `DROP TABLE IF EXISTS` so it is safe whether or not `0016` was ever applied.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shared model/contracts/cache that every story needs. MUST complete before US phases.

- [X] T004 Define `Resolver` trait + `ResolveError` + `FakeResolver` in `crates/targeting/src/resolver/mod.rs` (no-network test seam, mirrors retired `download::CatalogFetcher`)
- [X] T005 [P] Implement SIMBAD `otype` → closed `ObjectType` enum mapping in `crates/targeting/src/resolver/mod.rs`
- [X] T006 Implement the resolution-cache + resolver-settings schema in `0031_target_resolution.sql` (`canonical_target`, `target_alias`, `resolver_settings`, `ingest_resolution`) per data-model.md, and in the same forward migration `DROP TABLE IF EXISTS` the superseded `0016_catalogs.sql` tables (forward-only; never edit `0016`)
- [X] T007 [P] Add `target.search` / `target.resolve` / resolver-settings DTOs to `crates/contracts/core/src/targets.rs` (camelCase, `specta::Type`) and regenerate TS bindings (`apps/desktop/src/bindings/index.ts`)
- [X] T008 Implement cache read/write + dedupe-by-`simbad_oid` + source precedence (`user-override` > `resolved` > `seed`) in `crates/targeting/src/resolver/cache.rs`
- [X] T009 [P] Contract conformance test scaffold in `tests/contract/target_resolution_parity_test.rs` (DTO ↔ JSON-schema round-trip parity for the 3 contracts)

---

## Phase 3: US1 — Find a target while creating a project (Priority: P1)

**Goal**: instant local typeahead search for project-creation target selection.
**Independent test**: with cache seeded by a fixture, typing `androm`/`M3` returns ranked suggestions (designation + common name + type); selecting one associates the project to that canonical target.

- [X] T010 [P] [US1] Normalized-alias typeahead lookup (prefix/substring over `target_alias.normalized`) in `crates/targeting/src/resolver/cache.rs`
- [X] T011 [US1] `target.search` use-case (local seed+cache query, ranking) in `crates/app/core/src/`
- [ ] T012 [US1] `target_search` Tauri command in `apps/desktop/src-tauri/src/commands/targets.rs`
- [ ] T013 [US1] Project-creation target search UI (debounced input, suggestion list with type/catalogue badges) in `apps/desktop/src/components/`
- [ ] T014 [P] [US1] Unit test: `target.search` returns ranked local suggestions; respects `limit` (`crates/app/core` + `tests/contract`)

---

## Phase 4: US2 — Instant results for popular objects without network (Priority: P1)

**Goal**: bundled seed pre-populates the cache at first run; common objects resolve instantly offline.
**Independent test**: fresh install with network disabled → searching `M42`/`NGC 7000` returns results < 100 ms with no network call.

- [X] T015 [US2] One-time seed build script (offline; SIMBAD acronym map + OpenNGC for NGC/IC; CaldwellMap) → `assets/seed/` artifact, in `scripts/`
- [X] T016 [US2] Bundled-seed loader (load asset into cache at first run, `source=seed`) in `crates/targeting/src/resolver/seed.rs`
- [X] T017 [P] [US2] Commit the static C1–C109 → NGC/IC `CaldwellMap` + loader (Caldwell not in SIMBAD) in `crates/targeting/src/resolver/`
- [ ] T018 [P] [US2] Test: first-run seed load populates cache; offline typeahead for seeded objects works (`tests/contract` or crate test with bundled fixture). MUST assert SC-001: seeded typeahead returns suggestions in < 100 ms with no network call (measure against the seeded-cache fixture; resolver online path not invoked).

---

## Phase 5: US3 — Resolve any object beyond the seed (Priority: P2)

**Goal**: long-tail resolution against SIMBAD, cached after first resolve.
**Independent test**: online, search an unseeded designation → resolved via SIMBAD, merged into suggestions, written to cache; repeat offline → served from cache.

- [ ] T019 [US3] `SimbadResolver` (reqwest TAP `sim-tap/sync` + Sesame fallback; `basic ⋈ ident ⋈ ids` → canonical identity + aliases + common name) in `crates/targeting/src/resolver/simbad.rs`
- [ ] T020 [US3] `target.resolve` use-case (cache → SIMBAD on miss → upsert cache) in `crates/app/core/src/`
- [ ] T021 [US3] `target_resolve` Tauri command in `apps/desktop/src-tauri/src/commands/targets.rs`
- [ ] T022 [P] [US3] Debounced (~300 ms), min-length, cancel-in-flight long-tail query in the search UI; merge + de-dupe against local hits (`apps/desktop/src/components/`)
- [ ] T023 [P] [US3] Test: long-tail resolve via `FakeResolver`; cached after; cancel-in-flight discards stale results
- [ ] T024 [P] [US3] Gated online integration test against live SIMBAD (ignored by default) in `tests/`

---

## Phase 6: US4 — Group ingested images by resolved target (Priority: P1)

**Goal**: async background resolution of FITS `OBJECT`; group images under one canonical target.
**Independent test**: ingest `M31`/`NGC 224`/`Andromeda` images → all group under one target; unknown `OBJECT` → pending, not mis-assigned.

- [ ] T025 [US4] `ingest_resolution` pending-queue + background resolver task (async, retry) in `crates/app/core/src/`
- [ ] T026 [US4] Wire the scan→ingest pipeline to enqueue `OBJECT` resolution and associate image → canonical target (cache hit inline, miss enqueued pending)
- [ ] T027 [P] [US4] Register `target.resolved` / `target.resolve_batch.completed` event topics (replace `catalog.download.*`) in `apps/desktop/src/lib/events.ts` + the Rust event bus
- [ ] T028 [P] [US4] Test: alias-variant images group under one target; unknown/offline `OBJECT` → `unresolved`/pending, retryable, never fabricated

---

## Phase 7: US5 — Optional filter, settings toggle, manual override (Priority: P3)

**Goal**: optional catalogue/type filter; online-resolver enable toggle; persisted manual override.
**Independent test**: apply a type filter → only matching results; toggle online off → seed/cache only; override a resolution → override wins on re-resolve.

- [ ] T029 [US5] Optional catalogue/type filter in `target.search` use-case + a filter control in the search UI
- [ ] T030 [US5] `target.resolution.settings` get/update use-case + `target_resolution_settings` / `_update` Tauri commands (reads/writes `resolver_settings`)
- [ ] T031 [US5] Resolver settings UI (online toggle default-ON, endpoint, debounce/timeout) replacing the catalog manifest/minisign settings section in `apps/desktop/src/components/settings/`
- [ ] T032 [P] [US5] Manual override (`target.resolve` with `override` → `source=user-override`, precedence locked) + a "correct target" UI action (FR-014)
- [ ] T033 [P] [US5] Test: filter narrows results; online-off → seed/cache only (`resolver.disabled`); `user-override` wins over SIMBAD on re-resolve

---

## Phase 8: Polish & Cross-Cutting (retire superseded surface)

- [ ] T034 Remove the superseded catalog-download surface: `crates/targeting/catalogs/src/download.rs` + `loader.rs` machinery, the `catalog.*` Tauri commands, and `catalog.download.*` event topics (per the 002/003/013/014/018/033 reconciliation)
- [ ] T035 [P] Remove the spec-014 contracts (`catalog.manifest.fetch` / `catalog.download` / `catalog.entry-file`) + regenerate TS bindings. The `0016_catalogs.sql` tables are removed by the forward `DROP TABLE IF EXISTS` in `0031` (T006) — do NOT edit or delete the `0016` migration file itself.
- [ ] T036 [P] Attribution/NOTICE surface for CDS/SIMBAD + OpenNGC (FR-012) in the app's notices
- [ ] T039 [P] Emit audit events for resolution outcomes via `crates/audit`: a `target.resolved` audit record (source `resolved`) wired into the `target.resolve` use-case (T020) and a `target.user-override` audit record wired into the manual-override action (T032). Honors plan.md §II/§V and constitution §V (durable audit record for resolution + override). Test: resolving and overriding each write one audit row.
- [ ] T037 [P] `just lint` + `cargo clippy --workspace -D warnings` + `cargo fmt --all --check` + `just test` green; quickstart S1–S5 pass
- [ ] T038 Windows verify (push → pull → recompile → restart → exercise search/ingest/settings) per `spec-033-windows-verify-loop`

---

## Dependencies & Story Completion Order

- **Setup (T001–T003)** → **Foundational (T004–T009)** block everything.
- **US1 (T010–T014)** and **US2 (T015–T018)** are both P1 and the MVP; US1 is testable with a fixture-seeded cache, US2 delivers the real bundled seed. Recommended: US2 seed before/with US1 for a real demo.
- **US3 (T019–T024)** depends on Foundational + the `Resolver` trait; independent of US1/US2 UI.
- **US4 (T025–T028)** depends on `target.resolve` (T020) for the queue's resolve step; otherwise independent.
- **US5 (T029–T033)** depends on `target.search` (US1) for the filter and on settings/cache; override depends on cache (T008).
- **Polish (T034–T039)** runs after the resolver surface replaces the catalog-download surface. Audit emission (T039) depends on `target.resolve` (T020) and the override action (T032).

## Parallel Execution Examples

- Foundational: T005, T007, T009 are `[P]` (different files) once T004/T006 exist.
- US3: T022 (UI) ∥ T023/T024 (tests) after T019–T021.
- Polish: T035, T036, T037 are `[P]`.

## Implementation Strategy (MVP first)

- **MVP** = Setup + Foundational + **US1 + US2** (P1): instant local target search backed by the bundled seed. Delivers project-creation target selection without the network.
- **Increment 2** = US3 (long-tail SIMBAD) + US4 (ingest grouping) — the full resolve-on-demand value.
- **Increment 3** = US5 (filter/settings/override) + Polish (retire the old catalog-download surface, attribution, Windows verify).
