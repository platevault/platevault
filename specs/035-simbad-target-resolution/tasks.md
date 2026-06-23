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
- [X] T012 [US1] `target_search` Tauri command in `apps/desktop/src-tauri/src/commands/target_lookup.rs` (sibling of target_lookup/target_resolve; spec said targets.rs but that is the spec-029 fixture stub)
- [X] T013 [US1] Project-creation target search UI (debounced input, suggestion list with type/catalogue badges) in `apps/desktop/src/components/`
- [X] T014 [P] [US1] Unit test: `target.search` returns ranked local suggestions; respects `limit` (`crates/app/core` + `tests/contract`)

---

## Phase 4: US2 — Instant results for popular objects without network (Priority: P1)

**Goal**: bundled seed pre-populates the cache at first run; common objects resolve instantly offline.
**Independent test**: fresh install with network disabled → searching `M42`/`NGC 7000` returns results < 100 ms with no network call.

- [X] T015 [US2] One-time seed build script (offline; SIMBAD acronym map + OpenNGC for NGC/IC; CaldwellMap) → `assets/seed/` artifact, in `scripts/`
- [X] T016 [US2] Bundled-seed loader (load asset into cache at first run, `source=seed`) in `crates/targeting/src/resolver/seed.rs`
- [X] T017 [P] [US2] Commit the static C1–C109 → NGC/IC `CaldwellMap` + loader (Caldwell not in SIMBAD) in `crates/targeting/src/resolver/`
- [X] T018 [P] [US2] Test: first-run seed load populates cache; offline typeahead for seeded objects works (`tests/contract` or crate test with bundled fixture). MUST assert SC-001: seeded typeahead returns suggestions in < 100 ms with no network call (measure against the seeded-cache fixture; resolver online path not invoked).

---

## Phase 5: US3 — Resolve any object beyond the seed (Priority: P2)

**Goal**: long-tail resolution against SIMBAD, cached after first resolve.
**Independent test**: online, search an unseeded designation → resolved via SIMBAD, merged into suggestions, written to cache; repeat offline → served from cache.

- [X] T019 [US3] `SimbadResolver` (reqwest TAP `sim-tap/sync` + Sesame fallback; `basic ⋈ ident ⋈ ids` → canonical identity + aliases + common name) in `crates/targeting/src/resolver/simbad.rs`
- [X] T020 [US3] `target.resolve` use-case (cache → SIMBAD on miss → upsert cache) in `crates/app/core/src/`
- [X] T021 [US3] `target_resolve` Tauri command in `apps/desktop/src-tauri/src/commands/targets.rs`
- [X] T022 [P] [US3] Debounced (~300 ms), min-length, cancel-in-flight long-tail query in the search UI; merge + de-dupe against local hits (`apps/desktop/src/components/`)
- [X] T023 [P] [US3] Test: long-tail resolve via `FakeResolver`; cached after; cancel-in-flight discards stale results
- [X] T024 [P] [US3] Gated online integration test against live SIMBAD (ignored by default) in `tests/`

---

## Phase 6: US4 — Group ingested images by resolved target (Priority: P1)

**Goal**: async background resolution of FITS `OBJECT`; group images under one canonical target.
**Independent test**: ingest `M31`/`NGC 224`/`Andromeda` images → all group under one target; unknown `OBJECT` → pending, not mis-assigned.

- [X] T025 [US4] `ingest_resolution` pending-queue + background resolver task (async, retry) in `crates/app/core/src/`
- [X] T026 [US4] Wire the scan→ingest pipeline to enqueue `OBJECT` resolution and associate image → canonical target (cache hit inline, miss enqueued pending) (re-opened 2026-06-21: was phantom; re-scoped to + delivered by T042 — `plan_listener` → `ingest_sessions::ingest_light_frames`)
- [X] T027 [P] [US4] Register `target.resolved` / `target.resolve_batch.completed` event topics (replace `catalog.download.*`) in `apps/desktop/src/lib/events.ts` + the Rust event bus
- [X] T028 [P] [US4] Test: alias-variant images group under one target; unknown/offline `OBJECT` → `unresolved`/pending, retryable, never fabricated (re-opened 2026-06-21: was phantom; superseded by + delivered as T045/T046)

### Phase 6b: US4 — Ingest→Session→Target pipeline (re-opened 2026-06-21)

*T026/T028 were phantom completions. The following tasks implement the actual US4 ingest pipeline.*

- [X] T040 [US4] Migration 0046: `ALTER TABLE acquisition_session ADD COLUMN canonical_target_id TEXT REFERENCES canonical_target(id)` + `has_observer_location INTEGER NOT NULL DEFAULT 0` + covering index `idx_acq_session_canonical_target` + non-unique lookup index `idx_acq_session_session_key` in `crates/persistence/db/migrations/` (additive, nullable; mirrors 0033). R12 idempotency is enforced in the use case (SELECT-by-key upsert), not a DB UNIQUE constraint — legacy fixtures share a placeholder key.
- [X] T041 [US4] Ingest module `crates/app/targets/src/ingest_sessions.rs` (implements FR-016): per applied light frame — upsert `file_record` (UNIQUE `(root_id, relative_path)`; R9 mirrors `registered_sources` → `library_root` row before insert), call `associate_or_enqueue` for FITS `OBJECT`, derive `session_key` (target/OBJECT, filter, binning, gain, observing-night; UTC fallback when observer location unset, `has_observer_location = 0`), upsert `acquisition_session` by `session_key` appending frame id to `frame_ids` (set-dedup), set `canonical_target_id` inline on cache hit else NULL.
- [X] T042 [US4] Wire ingest into `crates/app/inbox/src/plan_listener.rs::handle_plan_completed` as a sibling to `register_master_if_applicable`: `ingest_light_frames_if_applicable` processes `move`/`catalogue` succeeded items on `terminal_state == "applied"` (light frames only, by FITS IMAGETYP; calibration frames excluded); idempotent (R12); `EventBus` threaded through `start_inbox_plan_listener` for `target.resolved` events.
- [X] T043 [US4] Spawn background `resolve_pending` drain on a 30s interval in `apps/desktop/src-tauri/src/lib.rs::run_app`; rebuild resolver from `resolver_settings` (online→SimbadResolver, offline→OfflineResolver); after each drain, back-fill `acquisition_session.canonical_target_id` via `ingest_sessions::backfill_session_targets` (frame_ids → resolved `ingest_resolution` → target).
- [X] T044 [US4] Surface `canonical_target_id` → `canonical_target.primary_designation` in the Sessions read path (`app_core::sessions::list_sessions` + `get_session`); LEFT JOIN `canonical_target` on `canonical_target_id`, override `session_key.target` with the canonical name + add the id to `target_ids`. No new DTO field → no Specta regen.
- [X] T045 [P] [US4] Layer-1 integration test (`crates/app/core/tests/ingest_sessions_integration.rs::two_m31_frames_group_into_one_linked_session`): two M31-alias light frames → one `acquisition_session`, `frame_ids` length 2, `canonical_target_id` = seeded M31 id, `list_sessions` `frame_count = 2` with target name.
- [X] T046 [P] [US4] Layer-1 integration test (`crates/app/core/tests/ingest_sessions_integration.rs::unknown_object_session_backfills_after_resolve`): unknown `OBJECT` → session created, `canonical_target_id` NULL, `ingest_resolution` `pending`; `resolve_pending` (FakeResolver) + `backfill_session_targets` → `canonical_target_id` back-filled.
- [X] T047 [P] [US4] Updated `specs/037-e2e-integration-testing/contracts/coverage-matrix.md` mapping T045/T046 (new spec-035 US4 section).

---

## Phase 7: US5 — Optional filter, settings toggle, manual override (Priority: P3)

**Goal**: optional catalogue/type filter; online-resolver enable toggle; persisted manual override.
**Independent test**: apply a type filter → only matching results; toggle online off → seed/cache only; override a resolution → override wins on re-resolve.

- [X] T029 [US5] Optional catalogue/type filter in `target.search` use-case + a filter control in the search UI
- [X] T030 [US5] `target.resolution.settings` get/update use-case + `target_resolution_settings` / `_update` Tauri commands (reads/writes `resolver_settings`)
- [X] T031 [US5] Resolver settings UI (online toggle default-ON, endpoint, debounce/timeout) replacing the catalog manifest/minisign settings section in `apps/desktop/src/components/settings/`
- [X] T032 [P] [US5] Manual override (`target.resolve` with `override` → `source=user-override`, precedence locked) + a "correct target" UI action (FR-014)
- [X] T033 [P] [US5] Test: filter narrows results; online-off → seed/cache only (`resolver.disabled`); `user-override` wins over SIMBAD on re-resolve

---

## Phase 8: Polish & Cross-Cutting (retire superseded surface)

- [X] T034 Remove the superseded catalog-download surface: `crates/targeting/catalogs/src/download.rs` + `loader.rs` machinery, the `catalog.*` Tauri commands, and `catalog.download.*` event topics (per the 002/003/013/014/018/033 reconciliation)
- [X] T035 [P] Remove the spec-014 contracts (`catalog.manifest.fetch` / `catalog.download` / `catalog.entry-file`) + regenerate TS bindings. The `0016_catalogs.sql` tables are removed by the forward `DROP TABLE IF EXISTS` in `0031` (T006) — do NOT edit or delete the `0016` migration file itself.
- [X] T036 [P] Attribution/NOTICE surface for CDS/SIMBAD + OpenNGC (FR-012) in the app's notices
- [X] T039 [P] Emit audit events for resolution outcomes via `crates/audit`: a `target.resolved` audit record (source `resolved`) wired into the `target.resolve` use-case (T020) and a `target.user-override` audit record wired into the manual-override action (T032). Honors plan.md §II/§V and constitution §V (durable audit record for resolution + override). Test: resolving and overriding each write one audit row.
- [X] T037 [P] `just lint` + `cargo clippy --workspace -D warnings` + `cargo fmt --all --check` + `just test` green; quickstart S1–S5 pass
- [ ] T038 Windows verify (push → pull → recompile → restart → exercise search/ingest/settings) per `spec-033-windows-verify-loop`

---

## Dependencies & Story Completion Order

- **Setup (T001–T003)** → **Foundational (T004–T009)** block everything.
- **US1 (T010–T014)** and **US2 (T015–T018)** are both P1 and the MVP; US1 is testable with a fixture-seeded cache, US2 delivers the real bundled seed. Recommended: US2 seed before/with US1 for a real demo.
- **US3 (T019–T024)** depends on Foundational + the `Resolver` trait; independent of US1/US2 UI.
- **US4 (T025–T028, T040–T047)** depends on `target.resolve` (T020) for the queue's resolve step; otherwise independent.
  - T040 (migration 0046) is a prerequisite for T041 and T044.
  - T041 (ingest module) depends on T040; T042 (plan_listener hook) depends on T041.
  - T043 (background drain) depends on T041 and T025 (ingest_resolution queue).
  - T044 (Sessions read path) depends on T040.
  - T045 and T046 (Layer-1 tests) depend on T042 and T043.
  - T047 (coverage-matrix update) depends on T045 and T046.
- **US5 (T029–T033)** depends on `target.search` (US1) for the filter and on settings/cache; override depends on cache (T008).
- **Polish (T034–T039)** runs after the resolver surface replaces the catalog-download surface. Audit emission (T039) depends on `target.resolve` (T020) and the override action (T032).

## Parallel Execution Examples

- Foundational: T005, T007, T009 are `[P]` (different files) once T004/T006 exist.
- US3: T022 (UI) ∥ T023/T024 (tests) after T019–T021.
- Polish: T035, T036, T037 are `[P]`.
- US4 Phase 6b: T041 ∥ T044 (both depend only on T040); T045 ∥ T046 (both depend on T042 + T043).

## Implementation Strategy (MVP first)

- **MVP** = Setup + Foundational + **US1 + US2** (P1): instant local target search backed by the bundled seed. Delivers project-creation target selection without the network.
- **Increment 2** = US3 (long-tail SIMBAD) + US4 (ingest grouping) — the full resolve-on-demand value.
- **Increment 3** = US5 (filter/settings/override) + Polish (retire the old catalog-download surface, attribution, Windows verify).
