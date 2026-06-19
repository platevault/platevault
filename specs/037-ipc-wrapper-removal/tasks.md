# Tasks: IPC wrapper removal (adopt generated bindings)

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Tests run in mock mode; every task keeps `just lint`, `just typecheck`, and the full vitest
suite green (FR-005). Bindings regeneration uses `cargo test -p desktop-shell exports_typescript_bindings`
(or `just test`).

## Phase 1: Foundation — route generated dispatch through the switcher (US2, P1)

**Goal**: Generated `commands.*` inherit mock mode + the dev recorder; nothing else changes.
**Independent test**: full vitest suite green with no caller edits; a dev-tools build records calls.

- [ ] T001 Inventory wrappers that post-process responses (not pure pass-through) in `apps/desktop/src/api/commands.ts`; record them in research.md D6 so none are dropped.
- [ ] T002 Create `apps/desktop/src/api/ipc.ts` exporting `invoke<T>(cmd, args)` (the mock/`_invokeOverride`/real switcher moved verbatim from commands.ts) and `setInvokeOverride`.
- [ ] T003 Add `unwrap<T>(r): T` (in `apps/desktop/src/api/ipc.ts` or `unwrap.ts`) translating the generated `{status}` Result into return-data / throw-error.
- [ ] T004 In `apps/desktop/src-tauri/tests/bindings.rs`, after `export`, replace the invoke import (`from "@tauri-apps/api/core"` → `from "../api/ipc"`); FAIL generation loudly if the expected import string is not found (guards rc bumps).
- [ ] T005 Regenerate bindings; commit the redirected `apps/desktop/src/bindings/index.ts`.
- [ ] T006 Point `commands.ts`'s internal `invoke`/`setInvokeOverride` at `api/ipc.ts` (no duplicate switcher); verify mock mode + recorder via existing tests.

## Phase 2: Transitional delegation — drop invoke literals from commands.ts (US3, P2)

**Goal**: `commands.ts` contains no `invoke('...')` literals; public surface unchanged.
**Independent test**: suite green; `grep "invoke('" commands.ts` returns nothing.

- [ ] T007 Rewrite each `commands.ts` wrapper as `unwrap(await commands.<name>(...))`, preserving param mapping and any post-processing from T001.
- [ ] T008 Update/relax `commands.bindings-guard.test.ts` (its inline-payload scan no longer applies once literals are gone; keep the name-conformance idea or mark for removal in Phase 4).

## Phase 3: Caller migration — call generated bindings directly (US1, P1)

**Goal**: callers use `commands.*` + `unwrap`; per-area test mocks moved to the dispatch layer.
Migrate one feature area per PR (sessions, calibration, projects, plans, roots, inbox, targets,
settings, audit, …). For each area:

- [ ] T009 [P] Repoint imports in the area from `@/api/commands` to `@/bindings` (`commands.*`) + `unwrap`.
- [ ] T010 [P] Migrate that area's test mocks from `vi.mock('@/api/commands')` to dispatch-layer mocking (`setInvokeOverride` in `beforeEach`, or `vi.mock('@/bindings')`).
- [ ] T011 Run the suite + typecheck for the area; keep green.

(Repeat T009–T011 per area; one PR each.)

## Phase 4: Teardown (P1)

**Goal**: wrapper layer gone; bindings are the only IPC surface.
**Independent test**: SC-001 + SC-005 grep checks pass; suite + typecheck green.

- [ ] T012 Delete `apps/desktop/src/api/commands.ts` and remove `commands.bindings-guard.test.ts`.
- [ ] T013 Remove dead plumbing confirmed in research D6 (approvePlan; unused list filter args) — already gone if not re-created in delegations.
- [ ] T014 Assert SC-001 (no `invoke('...')` outside `api/ipc.ts`) and SC-005 (no `@/api/commands` imports) via a small test or CI grep.
- [ ] T015 Update `docs/development/ipc-wrapper-migration.md` to "done"; note the guard test retirement.

## Dependencies

- Phase 1 (T001–T006) blocks everything (the dispatch redirect must exist first).
- Phase 2 (T007–T008) depends on Phase 1; makes Phase 3 lower-risk but Phase 3 can also proceed
  area-by-area directly off Phase 1.
- Phase 4 depends on all of Phase 3 completing.

## MVP / first slice

Phase 1 alone is a shippable, de-risking slice: it proves FR-002 (mock mode + recorder survive a
redirected dispatch) without touching callers. Everything after is mechanical, incremental.
