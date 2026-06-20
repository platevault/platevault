# Tasks — Standard-Library Adoption & Structural Modernization (042)

**Branch**: `042-stdlib-adoption` (worktree) | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Execution mode**: story-by-story, sequential. Implement one user story, run its gates,
commit it (no AI attribution), then move on. `[P]` marks tasks that *could* run in
parallel but here are done in order. Each story is independently shippable.

**Per-task gate** (before checking a task done): see `plan.md` → "Verification per story".
Frontend: `cd apps/desktop && npx tsc --noEmit` + `npx vitest run <feature>`. Rust:
`cargo test -p <crate>` + `cargo clippy -p <crate> --all-targets -- -D warnings`
(+ `rustfmt --edition 2021` on touched `src-tauri` files). Repo at story boundaries:
`just lint && just typecheck && just test`.

---

## Phase 0 — Setup

- [X] T001 Add new npm deps to `apps/desktop/package.json` at pinned versions:
  `@tanstack/react-query@5.101.0`, `@tanstack/react-table@8.21.3`, `use-debounce@10.1.1`,
  `date-fns@4.4.0`, `tinykeys@4.0.0`, `pathe@2.0.3`, `zod@4.4.3`, `react-hook-form@7.80.0`,
  `@hookform/resolvers@5.4.0`; run install; `npx tsc --noEmit` clean.
- [X] T002 [P] Add new Rust deps to workspace `Cargo.toml` (pin to current via cargo):
  `anyhow`, `tracing-subscriber`, `strum`+`strum_macros`, `percent-encoding`, `globset`,
  `itertools`, `csv`, `byteorder`, `path-clean`, `camino`, `moka`, `dashmap`; dev-deps
  `rstest`, `proptest`. `cargo metadata` resolves clean (do not wire usage yet).

## Phase 1 — Foundational (blocking prerequisites)

- [X] T010 (O2 slice) Promote `domain_core` to base layer: add `now_iso`/timestamp-string
  and `new_id`/id-string helpers on `Timestamp`/`EntityId` in `crates/domain/core`. No
  consumer changes yet. Gate: `cargo test -p domain_core`.
- [X] T011 (CB1 scaffold) Add `ErrorCode` enum to `crates/contracts/core` (specta `Type`,
  serde renames preserving existing dotted wire strings — enumerate from the code audit).
  Regenerate bindings (`cargo test` runs the bindings export test). Gate: bindings diff
  shows the new union; `commands.bindings-guard.test.ts` green.

## Phase 2 — US1 Server-state store → TanStack Query (P1, ANCHOR) 🎯

- [X] T100 Add `QueryClientProvider` + a configured `QueryClient` at the app root
  (`apps/desktop/src/main.tsx` / app shell); `gcTime`/`staleTime` defaults.
- [X] T101 Create `apps/desktop/src/data/queryKeys.ts` (factory per `data-model.md` §1).
- [X] T102 Migrate projects: `useProjects`/`useProjectDetail` → `useQuery`; create/update/
  source/channel/lifecycle mutations → `useMutation` + `invalidateQueries` per the map.
- [X] T103 Migrate sessions (`useInventorySources`, review mutation) → Query.
- [X] T104 Migrate inbox (`inbox/store.ts` list/classify/confirm/reclassify) → Query.
- [X] T105 Migrate guided + setup (`sources-store`, wizard `sessionsStore`) → Query.
- [X] T106 Delete `apps/desktop/src/data/store.ts`; remove all imports; ensure no
  render-phase fetch remains.
- [X] T107 Tests: update/extend vitest for projects/sessions/inbox to assert single-fetch
  on mount + invalidation refresh. Gate: `vitest run` for touched features + `tsc`.
- [ ] **US1 checkpoint**: gates green; commit `feat(042): US1 store→TanStack Query`.

## Phase 3 — US2 Boundary type-safety & string/message (P1)

- [X] T110 Convert command results to `Result<T, ContractError>` (ContractError.code:
  ErrorCode) across `src-tauri` command handlers + app/core; regenerate bindings.
- [X] T111 Re-export generated `_Serialize` types from `bindings/types.ts`; delete the
  hand-written snake_case structs; migrate field access across the ~44 consumer files;
  remove all `as unknown as` at the boundary.
- [X] T112 `apps/desktop/src/lib/errors.ts` (`errMessage`/`asError`); replace the 15+
  inline idioms + unsafe `(err as Error)?.message`.
- [X] T113 Move `ERROR_MESSAGES` to `apps/desktop/src/lib/error-messages.ts`; key it by
  the generated `ErrorCode` union.
- [X] T114 Replace duplicated magic-string error codes on the Rust side with `ErrorCode`
  variants (use the canonical mapper from US11 once available; otherwise enum directly).
- [X] T115 Finish spec-037 tail: migrate `plans_list`/`plans_approve`/`plans_apply_real`
  (`commands.ts:170/322/328`) to `commands.*`; extend `commands.bindings-guard.test.ts`.
- [ ] T116a (CB2 prereq, ITERATION) Upgrade `schemars` 0.8 → 1.x in workspace `Cargo.toml`
  (resolves the draft-07 → draft-2020-12 dialect gap and the `uuid1` feature mapping); fix the
  breaking `JsonSchema` derive API across `crates/domain/core`, `crates/audit`,
  `crates/contracts/core`; keep existing `schema_for!` tests green. Blocks T116.
  Sequence with US13 (high-risk, last).
- [ ] T116 (CB2, RE-SCOPED by ITERATION — supersedes the ba13cfd draft-07 stopgap) Make
  `packages/contracts` + the allowlisted per-spec contracts derive their JSON-Schema
  (draft-2020-12) from the Rust reflection (schemars 1.x) via a generation step feeding
  `packages/contracts/scripts/build-schemas.mjs`; annotate contract DTOs with `#[schemars(...)]`
  to reproduce semantic richness (operation.name dotted-token regex, oneOf envelope, const
  version pins, examples, descriptions); retire the hand-authored canonical `*.schema.json`
  inputs; keep `ajv` runtime validation + `tests/contract/contract_schema_parity.rs` green;
  satisfy the FR-005/SC-004 agreement test. Blocked-by T116a; sequence after US3–US16 with US13.
- [X] T117 (CB4) Collapse `_Serialize`/`_Deserialize` aliasing into one generated module.
- [X] T118 (C5) Add zod IPC-seam validation for dynamic/drift-prone payloads.
- [ ] **US2 checkpoint**: gates green; commit `feat(042): US2 IPC boundary + ErrorCode + errMessage`.

## Phase 4 — US8 Rust error handling & logging (P2)

- [X] T120 `GuidedFlowError` manual `Display` → `thiserror` derive (`app/core/guided_flow.rs`).
- [X] T121 Introduce `anyhow` + `.context()` at the app boundary; convert `.to_string()`
  context-loss sites (`confirm.rs`, `prepared_views.rs`, `target_resolve.rs`, `simbad.rs`).
  (NOTE: `simbad.rs` is in the `targeting` crate, not `app_core`; the app-boundary SIMBAD
  path `target_resolve.rs` was converted. The targeting `simbad.rs` context tweak is folded
  into US10, which edits that file for percent-encoding.)
- [X] T122 Stray production `eprintln!` → `tracing` (`transition_use_case.rs`); add
  `tracing-subscriber` init in `src-tauri`. (`rustfmt --edition 2021` on src-tauri files.)
- [ ] **US8 checkpoint**: per-crate clippy/tests green; commit `feat(042): US8 thiserror/anyhow/tracing`.

## Phase 5 — US9 Rust string/enum typing (P2)

- [X] T130 `CalibrationKind` `TryFrom<&str>`/`FromStr` single fallback; replace inline
  parses (`sessions.rs:332`, `calibration.rs:594/666/907`); confirm canonical fallback
  vs stored values.
- [X] T131 Inventory state `TryFrom`/`From` (`inventory.rs:331`).
- [X] T132 `strum` for first_run + prepared_source enum↔string converters.
- [ ] **US9 checkpoint**: commit `feat(042): US9 typed enum conversions`.

## Phase 6 — US11 Rust duplication → shared homes (P2) — needs T010

- [ ] T140 Replace ~28 `now_iso()` copies with the `domain_core` helper (add the
  `domain_core` dep to the ~13 crates that lack it — O2 completion).
- [ ] T141 Replace ×5 `new_id()` with the `domain_core` helper.
- [ ] T142 Create `crates/app/core/src/errors.rs`: canonical `db_err`/`bus_err`
  (`DbError::NotFound` → recoverable, fixing the divergence) + `From<DbError> for
  ContractError`; collapse the 123 `.map_err(db_err)?` sites.
- [ ] T143 Create `crates/app/core/src/target_dto.rs`: shared `map_object_type`/`map_source`.
- [ ] T144 Settings descriptor table (`app/core/src/settings/`) consumed by
  validate/default/hydrate.
- [ ] T145 Share `parse_basic_row` (`pub` in `targeting`, used by seed-builder).
- [ ] **US11 checkpoint**: commit `feat(042): US11 consolidate duplicated helpers`.

## Phase 7 — US3 Virtualize long lists (P2)

- [X] T150 [P] Virtualize `LogPanel.tsx:332` (`useVirtualizer`, preserve follow-tail).
- [X] T151 [P] Virtualize `InboxList.tsx:120` + fix O(n²) `indexOf` at `:122`.
- [X] T152 [P] Virtualize `TargetList.tsx:38` and `TargetSearch.tsx:438` results.
- [ ] **US3 checkpoint**: vitest + tsc; commit `feat(042): US3 virtualize long lists`.

## Phase 8 — US4 base-ui primitives (P2)

- [X] T160 ProjectsList filter dropdown → base-ui `Select`/`Menu` (fixes click-outside/Escape).
- [X] T161 TargetSearch combobox → base-ui Combobox/Popover; delete hand-rolled mousedown/ARIA.
- [X] T162 Sweep for any other hand-rolled overlays → base-ui.
- [ ] **US4 checkpoint**: commit `feat(042): US4 base-ui overlays`.

## Phase 9 — US5 Forms (react-hook-form + zod) (P2)

- [X] T170 Introduce RHF + zod resolver; zod schemas aligned to generated contract types.
- [X] T171 Migrate create/edit-project + wizard-step forms; backend still validates.
- [ ] **US5 checkpoint**: commit `feat(042): US5 RHF + zod forms`.

## Phase 10 — US6 Reinvented frontend utilities (P3)

- [ ] T180 [P] `use-debounce` (TargetSearch, ProjectNotes autosave).
- [ ] T181 [P] `date-fns` one shared formatter; replace the 3 formatters + date sorts.
- [ ] T182 `@tanstack/react-table` for ProjectsList sort/filter.
- [ ] T183 [P] `tinykeys` `useHotkeys` hook; consolidate 3 keydown handlers.
- [ ] T184 [P] `pathe` for path manipulation (`picker.ts`, ToolLaunches).
- [ ] T185 `lucide-react` sweep (replace inline SVGs).
- [ ] **US6 checkpoint**: commit `feat(042): US6 frontend utility libraries`.

## Phase 11 — US7 Frontend type-safety & dead-code (P3) — needs US2

- [X] T190 Typed mock fixtures (kill `mockInvoke<T>` `as T`).
- [X] T191 `useStatusSummary` generated types; concrete `SettingsData`.
- [X] T192 `satisfies` in fixtures; exhaustive state-label fns vs ProjectState/SessionState.
  (caught + fixed 4 genuine mock-contract drifts: firstrun_complete/restart/state, roots batch.)
- [X] T193 Triage ~30 empty `catch {}`; delete dead `lib/display.ts`.
  (26 found, all already commented intentional ignores; 3 in-scope upgraded; display.ts deleted, 0 importers.)
- [ ] **US7 checkpoint**: commit `feat(042): US7 type-safety + dead-code cleanup`.

## Phase 12 — US10 Reinvented Rust utilities (P3)

- [ ] T200 [P] `percent-encoding` (`simbad.rs` url_encode).
- [ ] T201 [P] `time::Date::parse`/`to_julian_day` (`calibration/ranking.rs`).
- [ ] T202 `globset` (`workflow/artifacts/rules.rs`) + pattern×input equivalence matrix.
- [ ] T203 [P] `itertools` dedup helpers.
- [ ] T204 `csv` for `parse_basic_row` tokenization (keep RA/Dec validation).
- [ ] T205 `byteorder` for FITS header parsing (existing FITS tests as guard — equivalence).
- [ ] T206 [P] `path-clean` (`path_gate.rs` lexical_normalize; keep symlink safety).
- [ ] T207 [P] `serde_json` (`project/structure` marker).
- [ ] **US10 checkpoint**: per-crate clippy/tests green; commit `feat(042): US10 Rust utility crates`.

## Phase 13 — US12 Rust caching/concurrency (P3)

- [X] T210 `moka` TTL for `project_health` DebounceTable.
- [X] T211 `dashmap` + RAII removal for `plan_apply` ACTIVE_RUNS.
- [X] T212 `spawn_blocking` for the sync fs executor reached from async (confirm threading).
- [X] T213 Sync-ify SkipSet/RetryQueue (`fs/executor/run.rs`).
- [ ] **US12 checkpoint**: commit `feat(042): US12 idiomatic caching/concurrency`.

## Phase 14 — US14 camino (P3)

- [ ] T220 `camino::Utf8Path` across fs crates + IPC path serialization; remove lossy
  conversions. Verify on real Windows (long/UNC paths).
- [ ] **US14 checkpoint**: commit `feat(042): US14 UTF-8 path types`.

## Phase 15 — US15 Tests (P3)

- [ ] T230 `rstest` table-driven for sanitizer + settings validation; `proptest`
  invariants for the sanitizer.
- [ ] **US15 checkpoint**: commit `feat(042): US15 table-driven/property tests`.

## Phase 16 — US16 Long-operation contract (P3)

- [ ] T240 Wire plan-apply through `OperationHandle` + `OperationEvent` over a
  `tauri::ipc::Channel`; UI subscribes/renders progress; retire the ad-hoc event path
  for this flow.
- [ ] **US16 checkpoint**: commit `feat(042): US16 long-op contract end-to-end`.

## Phase 17 — US13 Workspace/crate restructuring (P3, highest risk — staged last)

- [ ] T250 (O1) Split `targeting` → `targeting` (pure) + `targeting-resolver`
  (sqlx/reqwest/tokio move to the resolver crate); update consumers.
- [ ] T251 (O5) Drop `tokio` from `project/structure` (move the async touch out).
- [ ] T252 (O3a) Group `app/core`'s ~33 flat modules into `targets/ projects/ inbox/
  calibration/ lifecycle/` subdirs (internal, compiles green).
- [ ] T253 (O3b) Split `app/core` into per-domain use-case crates incrementally, each
  preserving the public surface `desktop_shell` consumes.
- [ ] T254 (O6) Fix `persistence/db → contracts/core` inversion: move the ~4 stored type
  clusters (equipment/settings/first_run/source-override) to domain; map DTOs at app/core.
  **DB byte-identity check + persistence tests green.** Own commit.
- [ ] **US13 checkpoint**: commit `feat(042): US13 crate restructuring`.

## Phase 18 — Final verification

- [ ] T260 Full repo gates: `just lint && just typecheck && just test`; per-crate clippy.
- [ ] T261 Confirm success criteria SC-001…SC-013 (grep counts: store.ts gone, 0
  `as unknown as`, single `now_iso`/`new_id`/`db_err`, etc.).
- [ ] T262 Real Windows Tauri build verification (push → pull → recompile → click-through
  per the project's Windows verify loop): lists virtualized, overlays close on
  outside-click/Escape, mutations refresh, paths correct, plan-apply progress streams.
- [ ] T263 Update `research.md` KEEP/DEFER notes if any decision changed during impl.

---

## Dependency graph (between stories)

```
T001/T002 (setup) ─> everything
T010 (domain_core base) ─> US11 (T140/T141), US13-O2
T011 (ErrorCode scaffold) ─> US2 (T110/T114)
US1 (anchor) ── independent of US2 except both touch commands.ts; do US1 then US2
US2 ─> US7 (generated types must be source of truth first)
US2 (ErrorCode) <─ US11 (T142 canonical mapper feeds T114)  [land US11 errors.rs before finalizing T114, or use enum directly then refine]
US11 ─ needs T010
US13-O6 ─ needs O2 (T010 + T140 base promotion); own guarded commit
US13-O3b (app/core split) ─ LAST (highest risk)
US3/US4/US5/US6/US8/US9/US10/US12/US14/US15/US16 ─ mutually independent (sequential here)
```

## Notes

- Commit per story (messages: `feat(042): USx …`, no AI attribution).
- Do not mark a story complete on green gates alone — confirm real behavior; final proof
  is the Windows build (T262).
- If US11's canonical `db_err` (T142) isn't ready when finishing US2's T114, use the
  `ErrorCode` enum directly in US2 and let T142 collapse the mappers; keep wire strings
  identical either way.
