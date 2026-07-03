# Tasks: IPC wrapper removal (adopt generated bindings)

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Tests run in mock mode; every task keeps `just lint`, `just typecheck`, and the full vitest
suite green (FR-005). Bindings regeneration uses `cargo test -p desktop-shell exports_typescript_bindings`
(or `just test`).

## Phase 1: Foundation — route generated dispatch through the switcher (US2, P1)

**Goal**: Generated `commands.*` inherit mock mode + the dev recorder; nothing else changes.
**Independent test**: full vitest suite green with no caller edits; a dev-tools build records calls.

- [x] T001 Inventory wrappers that post-process responses (not pure pass-through) in `apps/desktop/src/api/commands.ts`; record them in research.md D6 so none are dropped.
- [x] T002 Create `apps/desktop/src/api/ipc.ts` exporting `invoke<T>(cmd, args)` (the mock/`_invokeOverride`/real switcher moved verbatim from commands.ts) and `setInvokeOverride`.
- [x] T003 Add `unwrap<T>(r): T` (in `apps/desktop/src/api/ipc.ts` or `unwrap.ts`) translating the generated `{status}` Result into return-data / throw-error.
- [x] T004 In `apps/desktop/src-tauri/tests/bindings.rs`, after `export`, replace the invoke import (`from "@tauri-apps/api/core"` → `from "../api/ipc"`); FAIL generation loudly if the expected import string is not found (guards rc bumps).
- [x] T005 Regenerate bindings; commit the redirected `apps/desktop/src/bindings/index.ts`.
- [x] T006 Point `commands.ts`'s internal `invoke`/`setInvokeOverride` at `api/ipc.ts` (no duplicate switcher); verify mock mode + recorder via existing tests.

## Phase 2: Transitional delegation — drop invoke literals from commands.ts (US3, P2)

**Goal**: `commands.ts` contains no `invoke('...')` literals; public surface unchanged.
**Independent test**: suite green; `grep "invoke('" commands.ts` returns nothing.

- [x] T007 Rewrite each `commands.ts` wrapper as `unwrap(await commands.<name>(...))`, preserving param mapping and any post-processing from T001.
- [x] T008 Update/relax `commands.bindings-guard.test.ts` (its inline-payload scan no longer applies once literals are gone; keep the name-conformance idea or mark for removal in Phase 4).

## Phase 3: Caller migration — call generated bindings directly (US1, P1)

**Goal**: callers use `commands.*` + `unwrap`; per-area test mocks moved to the dispatch layer.
Migrate one feature area per PR (sessions, calibration, projects, plans, roots, inbox, targets,
settings, audit, …). For each area:

- [x] T009 [P] Repoint imports in the area from `@/api/commands` to `@/bindings` (`commands.*`) + `unwrap`.
- [x] T010 [P] Migrate that area's test mocks from `vi.mock('@/api/commands')` to dispatch-layer mocking (`setInvokeOverride` in `beforeEach`, or `vi.mock('@/bindings')`).
- [x] T011 Run the suite + typecheck for the area; keep green.

(Repeat T009–T011 per area; one PR each.)

## Phase 4: Teardown (P1)

**Goal**: wrapper layer gone; bindings are the only IPC surface.
**Independent test**: SC-001 + SC-005 grep checks pass; suite + typecheck green.

- [x] T012 Delete `apps/desktop/src/api/commands.ts` and remove `commands.bindings-guard.test.ts` (also removed the obsolete `commands.applyPlanChannel.test.ts` / `commands.registerRootBatch.test.ts` — their glue moved to `features/plans/planApply.ts` + `features/setup/registerSources.ts` with coverage there).
- [x] T013 Remove dead plumbing confirmed in research D6 (approvePlan; unused list filter args) — already gone if not re-created in delegations.
- [x] T014 SC-001 + SC-005 enforced by `apps/desktop/src/api/ipc-boundary.guard.test.ts` (Vite `import.meta.glob` source scan; runs in CI via `pnpm test`). Surfaced + fixed two callers the area sweep missed: `features/guided/store.ts` (dotted `invoke('guided.state.get')` → `commands.guidedStateGet`, was silently falling back to Idle) and `features/projects/source-views.ts` (hand-rolled local `invoke` → `commands.preparedview*`; also fixed its 5 pre-existing test failures).
- [x] T015 Update `docs/development/ipc-wrapper-migration.md` to "done"; note the guard test retirement.

## Dependencies

- Phase 1 (T001–T006) blocks everything (the dispatch redirect must exist first).
- Phase 2 (T007–T008) depends on Phase 1; makes Phase 3 lower-risk but Phase 3 can also proceed
  area-by-area directly off Phase 1.
- Phase 4 depends on all of Phase 3 completing.

## MVP / first slice

Phase 1 alone is a shippable, de-risking slice: it proves FR-002 (mock mode + recorder survive a
redirected dispatch) without touching callers. Everything after is mechanical, incremental.
