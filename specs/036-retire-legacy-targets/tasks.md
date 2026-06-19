# Tasks: Retire Legacy Target Tables

**Feature**: 036-retire-legacy-targets | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Note on ordering**: gen-3 commands reuse the gen-2 command *names* (`target.get`,
`target.alias.add/remove`), so gen-2 and gen-3 cannot coexist — each name is swapped, not
duplicated. Tasks are ordered to keep the workspace buildable in chunks: build the gen-3
backend module first, then swap the command surface, then delete gen-2, then frontend,
then tests. The phase gate is `cargo build`/`cargo test` green at each phase end.

## Phase 1: Setup

- [ ] T001 Confirm a clean baseline on a fresh DB: `cargo build --workspace` green on branch `036-retire-legacy-targets` before changes.

## Phase 2: Foundational — schema (blocks all user stories)

- [ ] T002 Edit `crates/persistence/db/migrations/0031_target_resolution.sql`: add nullable `display_alias TEXT` to the `canonical_target` CREATE, and extend the `target_alias.kind` CHECK to `('designation','common_name','user')`.
- [ ] T003 Edit `crates/persistence/db/migrations/0002_lifecycle.sql`: remove the `target` table CREATE and the `acquisition_session.target_id` column (and any index/FK referencing `target`); confirm nothing else in 0002 depends on them.
- [ ] T004 Delete `crates/persistence/db/migrations/0017_targets.sql` (entire gen-2 target schema).
- [ ] T005 Delete `crates/persistence/db/migrations/0027_target_identity.sql` (gen-2 extensions + legacy FK columns `acq_target_id`, `projects.target_id`, `project_sources.target_id`).
- [ ] T006 Grep all later migrations (0028–0035) for references to removed objects; fix/confirm none. Then delete the local DB and run migrations to confirm a fresh DB builds cleanly (`cargo build -p persistence_db`; migration smoke).

## Phase 3: User Story 1 — One source of target truth (P1)

**Goal**: legacy schema + code gone; only gen-3 remains; build/tests green on fresh DB.
**Independent test**: schema + `rg` show no legacy tables/columns/commands; gates pass.

- [ ] T007 [US1] Remove the `LEFT JOIN target` (and `target_name` derivation) from `crates/persistence/db/src/repositories/inventory.rs`, preserving the rest of the projection shape (emit no/empty target name).
- [ ] T008 [US1] Delete `crates/persistence/db/src/repositories/targets.rs` and remove its `mod`/`pub use` from `crates/persistence/db/src/repositories/mod.rs` (and any re-exports).
- [ ] T009 [US1] Delete `crates/targeting/src/load.rs` and remove its module wiring from `crates/targeting/src/lib.rs` (and any callers other than the spec-013 commands removed in T011).
- [ ] T010 [US1] Delete `crates/app/core/src/target_identity.rs` and remove its `mod`/exports from `crates/app/core/src/lib.rs`.
- [ ] T011 [US1] Remove the spec-013 `target.lookup` and `target.resolve.fits` commands from `apps/desktop/src-tauri/src/commands/target_lookup.rs` and unregister them in `apps/desktop/src-tauri/src/lib.rs` (both `specta_builder` blocks).
- [ ] T012 [US1] Remove gen-2 target DTOs from `crates/contracts/core/src/targets.rs` (keep gen-3 spec-035 DTOs); fix downstream compile errors.
- [ ] T013 [US1] `cargo build --workspace` (US1 deletions compile once US2 command swap lands — see note; if doing strictly in order, US1 + US2 backend land together). Verify with `rg` that no live references to `targets`/`target_aliases`/`target.lookup`/`target.note.update`/`target.primary.rename` remain in `crates/`+`apps/` (excluding spec docs).

## Phase 4: User Story 2 — View & manage a target on gen-3 (P1)

**Goal**: Targets page works on gen-3 — detail view + add/remove user aliases.
**Independent test**: open a resolved target; identity+aliases render; add/remove alias.

- [ ] T014 [US2] Add gen-3 management repo fns in `crates/targeting/src/resolver/cache.rs` (or a new `mgmt.rs`): `list_all`, detail-with-aliases (extend `get_by_id`), `insert_user_alias` (kind='user', normalized, duplicate-reject), `delete_user_alias` (only kind='user').
- [ ] T015 [US2] Create `crates/app/core/src/target_management.rs` use-cases: get detail, list, alias add, alias remove (map repo errors to contract errors `target.not_found`/`alias.duplicate`/`alias.invalid`/`alias.not_found`/`alias.not_user`). Wire `mod` in lib.rs.
- [ ] T016 [US2] Add gen-3 management DTOs to `crates/contracts/core/src/targets.rs`: `TargetDetail`, `TargetAliasDto` (kind incl. user), `TargetListItem`, request/response wrappers per `contracts/target-management.md`.
- [ ] T017 [US2] Create `apps/desktop/src-tauri/src/commands/target_management.rs` with commands `target.get`, `target.list`, `target.alias.add`, `target.alias.remove` (specta rename = invoke name); register in `lib.rs` (both builder blocks); remove the old `commands/target_identity.rs` module + its registrations.
- [ ] T018 [US2] Regenerate bindings (`cargo run -p contracts_core --bin generate-contracts` + `cargo test -p desktop_shell --test bindings`) and update `apps/desktop/src/api/commands.ts` wrappers.
- [ ] T019 [US2] Rebuild `apps/desktop/src/features/targets/TargetDetailV2.tsx` on gen-3 `target.get`: show effective label + primary designation, object type, coordinates, alias list with add/remove (user aliases only removable); remove the note box and primary-rename control.
- [ ] T020 [US2] Repoint `apps/desktop/src/features/targets/TargetList.tsx` / `TargetsPage.tsx` to `target.list`; keep `/targets`, `/targets/$id`, Cmd+K routing.
- [ ] T021 [US2] `cargo build --workspace` + `just typecheck` green; manual: open Targets page, add/remove alias works.

## Phase 5: User Story 3 — Display alias (P2)

**Goal**: optional display label that overrides presentation without touching identity.
**Independent test**: set display alias → UI shows it, canonical unchanged; clear → reverts.

- [ ] T022 [US3] Add repo fns `set_display_alias` / `clear_display_alias` in cache/mgmt; ensure `upsert_resolved`(_conn) preserves an existing `display_alias` on conflict (FR-012).
- [ ] T023 [US3] Add use-cases + DTOs + commands `target.display_alias.set` / `target.display_alias.clear` (empty input on set = clear); include `displayAlias`/`effectiveLabel` in `TargetDetail`/`TargetListItem`; regenerate bindings + wrappers.
- [ ] T024 [US3] Add the display-alias set/clear control to `TargetDetailV2.tsx`; surface `effectiveLabel` wherever the target label is shown (detail header, list, Cmd+K results).
- [ ] T025 [US3] `cargo build --workspace` + `just typecheck` green; manual: set/clear display alias, re-resolve preserves it.

## Phase 6: Polish & cross-cutting

- [ ] T026 [P] Replace gen-2 tests with gen-3 equivalents: delete/rewrite tests in `repositories/targets.rs`, `target_identity.rs`, `targeting/load.rs`; add unit tests for the new mgmt repo/use-cases (alias add/remove/dup, display-alias set/clear/preserve).
- [ ] T027 [P] Update frontend tests: `TargetDetailV2.test.tsx`, `TargetsPage.test.tsx`, target-identity tests, Cmd+K/palette target tests — to gen-3 commands/labels; remove note/rename assertions.
- [ ] T028 [P] Update any contract/e2e tests referencing removed commands/tables.
- [ ] T029 Full gate on a fresh DB: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `just typecheck`, `vitest`, bindings drift check.
- [ ] T030 Update docs: mark `docs/development/legacy-target-table-retirement-plan.md` executed; note spec-013/023 superseded where relevant; update `docs/development/simbad-target-resolution.md` if the target surface is referenced.

## Dependencies & order

- Phase 2 (schema) blocks all.
- US1 deletions and US2 backend command-swap are coupled (shared command names) — land T007–T013 together with T014–T018 so the workspace compiles; the phase gate is at end of Phase 4.
- US3 (Phase 5) depends on US2 (gen-3 detail surface).
- Polish (Phase 6) last.

## Parallel opportunities

- T026/T027/T028 (tests) are independent files → [P].
- Within US2, contracts (T016) and repo (T014) can start in parallel before wiring (T015/T017).
