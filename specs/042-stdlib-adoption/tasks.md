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
- [X] T116a (CB2 prereq, ITERATION) Upgraded `schemars` 0.8 → 1.2.1 in workspace `Cargo.toml`
  (schemars 1.x emits draft-2020-12, closing the dialect gap; `uuid1` feature name unchanged —
  still maps to uuid crate v1). Fixed the breaking `JsonSchema` derive API: the manual impl on
  `domain_core::Timestamp` (`schema_name` → `Cow<'static, str>`, `json_schema` →
  `&mut SchemaGenerator -> schemars::Schema` via the `json_schema!` macro); derive sites in
  `crates/domain/core`, `crates/audit`, `crates/contracts/core` and the
  `#[schemars(bound = …)]` attributes compiled unchanged. Regenerated the `.generated.json`
  snapshots to draft-2020-12 (the `schema_for!` snapshot tests are green). Residual schemars
  0.8.22 in the lock is transitive via `tauri`/`tauri-build` only (not our contract DTOs).
- [X] T116 (CB2, RE-SCOPED by ITERATION — supersedes the ba13cfd draft-07 stopgap; partial scope,
  documented) Added the FR-005/SC-004 **specta↔schemars agreement test**
  (`tests/contract/envelope_specta_schemars_agreement.rs`): derives the envelope enum schemas
  from the Rust `contracts_core` types via schemars and FAILS when they disagree with the
  specta-generated `apps/desktop/src/bindings/index.ts` union (validated by a perturbation —
  a Rust variant rename makes it red). Scoped to the envelope enums live on BOTH projections
  (`ErrorSeverity`, `OperationEventType`); `OperationStatus`/`ResponseStatus` are not emitted as
  named specta types (no live command references them) and are documented as excluded.
  Added `JsonSchema` derives to the envelope enums so the schemars projection exists.
  KEPT hand-authored (documented in the T116 report): `packages/contracts/schemas/envelope.schema.json`
  remains the json2ts/ajv input — its hand-curated `oneOf` of named `OkResponseEnvelope`/
  `ErrorResponseEnvelope` defs is a shape schemars will not reproduce from the generic
  `ResponseEnvelope<T>`, and replacing it would change `envelope.d.ts` and break
  `contract_schema_parity`'s interface-name expectations. The per-spec payload `*.json` contracts
  in the build-schemas.mjs allowlist likewise stay hand-authored. `ajv` runtime validation +
  `tests/contract/contract_schema_parity.rs` stay green. Blocked-by T116a (done).
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

- [X] T140 Replace ~28 `now_iso()` copies with the `domain_core` helper (add the
  `domain_core` dep to the ~13 crates that lack it — O2 completion).
  (byte-identical Rfc3339; repo uses `path =` deps, no [workspace.dependencies] entry.)
- [X] T141 Replace ×5 `new_id()` with the `domain_core` helper.
- [X] T142 Create `crates/app/core/src/errors.rs`: canonical `db_err`/`bus_err`
  (`DbError::NotFound` → recoverable, fixing the divergence) + `From<DbError> for
  ContractError`; collapse the 123 `.map_err(db_err)?` sites.
  (L2 fixed: blanket settings/protection mappers now map NotFound→recoverable Blocking,
  non-retryable. `From<DbError> for ContractError` is orphan-rule-impossible in app_core —
  both types foreign; deferred to after T254 inversion. Canonical `db_err` fn covers it.)
- [X] T143 Create `crates/app/core/src/target_dto.rs`: shared `map_object_type`/`map_source`.
- [X] T144 Settings descriptor table (`app/core/src/settings/descriptors.rs`) consumed by
  validate/default/hydrate (settings.rs → settings/mod.rs).
- [X] T145 Share `parse_basic_row` (`pub` in `targeting`, used by seed-builder).
  (NOTE: seed-builder now inherits US10's RA/Dec range validation — drops out-of-range coord
  rows it previously emitted; aligns with the cache DB CHECK invariant, intended by T145.)
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

- [X] T180 [P] `use-debounce` (TargetSearch, ProjectNotes autosave).
- [X] T181 [P] `date-fns` one shared formatter (`lib/datetime.ts`); replace the 3 formatters + date sorts.
  (NOTE: `manifests.ts` UTC formatter left as-is — date-fns core can't reproduce UTC output without date-fns-tz.)
- [X] T182 `@tanstack/react-table` for ProjectsList sort/filter (headless; base-ui Menu filter from US4 preserved).
- [X] T183 [P] `tinykeys` `useHotkeys` hook (`lib/useHotkeys.ts`); consolidate 3 keydown handlers.
- [X] T184 [P] `pathe` for path manipulation (`picker.ts`, ToolLaunches) — display/last-path only, no submitted paths.
- [X] T185 `lucide-react` sweep (replace inline SVG/entity icons; bespoke/CSS glyphs left).
- [ ] **US6 checkpoint**: commit `feat(042): US6 frontend utility libraries`.

## Phase 11 — US7 Frontend type-safety & dead-code (P3) — needs US2

- [x] T190 Typed mock fixtures (kill `mockInvoke<T>` `as T`). (re-opened 2026-06-21: phantom — SC/FR unmet)
- [x] T191 `useStatusSummary` generated types; concrete `SettingsData`. (re-opened 2026-06-21: phantom — SC/FR unmet)
- [x] T192 `satisfies` in fixtures; exhaustive state-label fns vs ProjectState/SessionState.
  (caught + fixed 4 genuine mock-contract drifts: firstrun_complete/restart/state, roots batch.) (re-opened 2026-06-21: phantom — SC/FR unmet)
- [x] T193 Triage ~30 empty `catch {}`; delete dead `lib/display.ts`.
  (26 found, all already commented intentional ignores; 3 in-scope upgraded; display.ts deleted, 0 importers.) (re-opened 2026-06-21: phantom — SC/FR unmet)
- [x] T268 [US7] Remove the hand-written struct universe from
  `apps/desktop/src/bindings/types.ts`: re-export each of the 14 interfaces
  (MetaValue, AppPreferences, SourceMap, SettingsData, CalibrationMaster, Target,
  SearchResult, TargetDetail, ProjectSource, ProjectSourceView, ProjectOutput,
  ProjectArtifactGroup, CalendarData, ProgressEvent) from the generated `_Serialize`
  types where a backend DTO exists; move genuinely frontend-only types to a labelled
  frontend-types module. End state: no hand-written `export interface` structs remain
  in `bindings/types.ts`.
- [x] T269 [US7] Migrate all field accesses in the ~19 importer files
  snake_case→camelCase, incrementally by feature area, each batch verified with
  `tsc --noEmit` + `vitest run <area>`; update fixtures/mocks to camelCase.
  (Depends on T268.)
- [ ] **US7 checkpoint**: commit `feat(042): US7 type-safety + dead-code cleanup`.

## Phase 12 — US10 Reinvented Rust utilities (P3)

- [X] T200 [P] `percent-encoding` (`simbad.rs` url_encode).
- [X] T201 [P] `time::Date::parse`/`to_julian_day` (`calibration/ranking.rs`).
- [X] T202 `globset` (`workflow/artifacts/rules.rs`) + pattern×input equivalence matrix.
  (matrix test added; surfaced + locked a latent trailing-`*` bug; no in-use rule uses Glob.)
- [X] T203 [P] `itertools` dedup helpers.
- [X] T204 `csv` for `parse_basic_row` tokenization (keep RA/Dec validation).
- [X] T205 `byteorder` for FITS header parsing — N/A (RESOLVED): FITS headers are pure ASCII
  80-byte cards; the extractor parses text only and never touches the binary array (Principle
  III), so there is NO byte-order decoding to replace. Existing 15 FITS tests remain green as
  the equivalence guard. No code added (adding byteorder would be dead code).
- [X] T206 [P] `path-clean` (`path_gate.rs` lexical_normalize; keep symlink safety).
- [X] T207 [P] `serde_json` (`project/structure` marker).
- [ ] **US10 checkpoint**: per-crate clippy/tests green; commit `feat(042): US10 Rust utility crates`.

## Phase 13 — US12 Rust caching/concurrency (P3)

- [X] T210 `moka` TTL for `project_health` DebounceTable.
- [X] T211 `dashmap` + RAII removal for `plan_apply` ACTIVE_RUNS.
- [X] T212 `spawn_blocking` for the sync fs executor reached from async (confirm threading).
- [X] T213 Sync-ify SkipSet/RetryQueue (`fs/executor/run.rs`).
- [ ] **US12 checkpoint**: commit `feat(042): US12 idiomatic caching/concurrency`.

## Phase 14 — US14 camino (P3)

- [X] T220 `camino::Utf8Path` across fs crates + IPC path serialization; remove lossy
  conversions. Verify on real Windows (long/UNC paths).
  (Non-UTF-8 OS paths now typed-skip with a diagnostic instead of lossy-convert; contract DTO
  path fields were already `String` so bindings + wire format are byte-identical; DB unchanged.
  fs_planner left untyped — it stores only DB-relative Strings. Windows UNC/long-path round-trip
  deferred to Phase E.)
- [ ] **US14 checkpoint**: commit `feat(042): US14 UTF-8 path types`.

## Phase 15 — US15 Tests (P3)

- [X] T230 `rstest` table-driven for sanitizer + settings validation; `proptest`
  invariants for the sanitizer.
- [ ] **US15 checkpoint**: commit `feat(042): US15 table-driven/property tests`.

## Phase 16 — US16 Long-operation contract (P3)

- [x] T240 Wire plan-apply through `OperationHandle` + `OperationEvent` over a
  `tauri::ipc::Channel`; UI subscribes/renders progress; retire the ad-hoc event path
  for this flow.
  (Backend emits Started→per-item→terminal OperationEvents over a Channel<OperationEvent>;
  DB audit append retained as the durable record; `applyPlan` wrapper + mocks + tests wired.
  NOTE: no progress-rendering React component added — `applyPlan` had zero callers and no
  existing plan-apply progress view existed to retire (old path was DB-poll). The contract/
  transport/wrapper/mocks are in place for a future consumer; adding a new progress view is
  net-new feature scope beyond this refactor spec.) (re-opened 2026-06-21: phantom — SC/FR unmet)
- [x] T270 [US16] Reconcile the `applyPlan` wrapper return type to the generated
  `PlanApplyResponse`; remove the `as unknown as OperationHandle` cast at
  `commands.ts:396`; update `commands.applyPlanChannel.test.ts` + any caller.
  End state: zero `as unknown as` in `commands.ts`.
- [x] T271 [US16] Wire a real plan-apply progress consumer in the UI over the
  `OperationEvent` channel (live per-item progress), exercising the long-op contract
  end-to-end (FR-021); add/extend a vitest for the consumer.
  (May depend on T270's corrected return type.)
- [ ] **US16 checkpoint**: commit `feat(042): US16 long-op contract end-to-end`.

## Phase 17 — US13 Workspace/crate restructuring (P3, highest risk — staged last)

- [X] T250 (O1) Split `targeting` → `targeting` (pure) + `targeting-resolver`
  (sqlx/reqwest/tokio move to the resolver crate); update consumers.
  (new crate `targeting_resolver` carries sqlx/reqwest/tokio + simbad/cache/seed; base
  `targeting` = uuid + unicode-normalization only; consumers app_core/seed-builder/desktop_shell updated.)
- [X] T251 (O5) Drop `tokio` from `project/structure` (move the async touch out).
  (notes/manifest IO now std::fs behind the same async trait seam; tokio → dev-dep only.)
- [X] T252 (O3a) Group `app/core`'s ~33 flat modules into `targets/ projects/ inbox/
  calibration/ lifecycle/` subdirs (internal, compiles green).
  (18 git-mv renames into targets/projects/calibration/lifecycle; public surface byte-identical
  via lib.rs `pub use` re-exports; zero consumer edits; calibration use-case → calibration/matching.rs.)
- [X] T253 (O3b) Split `app/core` into per-domain use-case crates incrementally, each
  preserving the public surface `desktop_shell` consumes.
  (COMPLETE at domain granularity: `errors.rs` decoupled into a standalone leaf (From impls
  moved to guided_flow/log_stream), then `app_core` split into the 6 T252 domains
  + the `errors` leaf kernel as crates: `app_core_{calibration,targets,projects,inbox,lifecycle,
  settings,errors}`. Cross-cutting singletons (plan_apply/plans/protection/first_run/guided_flow/
  log_stream/native/patterns/search/sessions/inventory/tool_launch/dev_contracts) stay as in-crate
  `pub mod`s — domain boundaries, not one-crate-per-file (Rust-idiomatic). Public surface
  byte-identical via re-exports, no consumer/desktop_shell edits, bindings empty-diff; app_core
  Cargo.toml dead deps pruned; acyclic DAG.)
- [X] T254 (O6) Fix `persistence/db → contracts/core` inversion: move the ~4 stored type
  clusters (equipment/settings/first_run/source-override) to domain; map DTOs at app/core.
  **DB byte-identity check + persistence tests green.** Own commit.
  (moved equipment/first_run/JsonAny + settings stored types to domain_core, re-exported from
  contracts_core → bindings byte-identical; persistence_db contracts_core dep removed (tree=0);
  7 byte-identity guard tests w/ frozen snapshots + real SQL roundtrip.)
- [x] T272 [US13] Verify crate restructuring (T250–T254) complete: split crates compile
  independently, no `app/core` god-crate regression; record verification (no code change
  expected). (Independent of T268–T271.)
- [ ] **US13 checkpoint**: commit `feat(042): US13 crate restructuring`.

## Phase 18 — Final verification

- [X] T260 Full repo gates: `just lint && just typecheck && just test`; per-crate clippy.
  (GREEN: cargo fmt --all, cargo clippy --workspace -D warnings, just typecheck (tsc 0),
  cargo test --workspace exit 0, frontend vitest 650/650, packages/contracts pnpm build+test.
  `pre-commit --all-files` still flags pre-existing repo-wide debt — domain-term typo
  false-positives (`gam`/`desig` not in .typos.toml) + EOF/whitespace on generated files —
  out of 042 scope, red on main too.)
- [X] T261 Confirm success criteria SC-001…SC-013 (grep counts: store.ts gone, 0
  `as unknown as`, single `now_iso`/`new_id`/`db_err`, etc.).
  (store.ts GONE; bindings/types.ts hand-written structs GONE (now a generated re-export
  barrel); mocks `as T` = 0 (only a comment); lib/display.ts GONE; now_iso/new_id/db_err
  consolidated (US11); SC-004 agreement test present; schemars 1.x. Residual: 2 `as unknown as`
  in the dead/deferred plan-approve/apply wrappers (no live approvePlan caller; tied to the
  out-of-scope Phase-4 plan-workflow teardown — documented in code).)
- [ ] T262 Real Windows Tauri build verification (push → pull → recompile → click-through
  per the project's Windows verify loop): lists virtualized, overlays close on
  outside-click/Escape, mutations refresh, paths correct, plan-apply progress streams.
  (Phase E — needs the user-driven Windows loop + Tauri MCP; not yet run.)
- [X] T263 Update `research.md` KEEP/DEFER notes if any decision changed during impl.
  (CB2 row updated by iteration-1; impl deltas documented inline in tasks.md: T205 byteorder
  N/A, T116 partial, T253 incremental + blocker, From<DbError> deferred post-T254,
  T145 seed-builder validation change.)

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

Reconcile additions (2026-06-21):
T268 (remove hand-written types.ts structs) ─> T269 (migrate ~19 importer files snake→camel)
T270 (fix applyPlan return type, remove cast) ─> T271 may depend on T270's corrected return type
T272 (verify US13 crate split) ─ independent of T268–T271
```

## Notes

- Commit per story (messages: `feat(042): USx …`, no AI attribution).
- Do not mark a story complete on green gates alone — confirm real behavior; final proof
  is the Windows build (T262).
- If US11's canonical `db_err` (T142) isn't ready when finishing US2's T114, use the
  `ErrorCode` enum directly in US2 and let T142 collapse the mappers; keep wire strings
  identical either way.
