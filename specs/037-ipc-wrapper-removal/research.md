# Research: IPC wrapper removal

## D1 — How to route generated-binding dispatch through the mock/recorder switcher

**Decision**: After `Builder::export(Typescript::default(), out_path)` in
`apps/desktop/src-tauri/tests/bindings.rs`, post-process the written file to replace the
generated invoke import

```ts
import { invoke as __TAURI_INVOKE } from "@tauri-apps/api/core";
```

with an import from an app-owned dispatch module

```ts
import { invoke as __TAURI_INVOKE } from "../api/ipc";
```

**Rationale**: `tauri-specta 2.0.0-rc.25` + `specta-typescript 0.0.12` emit that invoke import
unconditionally; there is no config knob for it. `specta_typescript::Typescript` exposes a
header prepend but not the invoke source. A deterministic string replacement performed as part
of the same generation step keeps the existing no-diff guard in `bindings.rs` valid (the
committed file is the post-processed file). Version-independent and small.

**Alternatives considered**:
- Hand-written re-export module that wraps `commands.*` bound to the switcher — rejected: keeps a
  parallel hand-maintained layer and does not remove `invoke('...')` literals (defeats SC-001).
- Fork/patch the specta-typescript formatter — rejected: heavy, brittle across rc bumps.

## D2 — Preserving the throw-on-error contract

**Decision**: Generated functions return `Result`-style `{ status: 'ok'; data } | { status:
'error'; error }` (`typedError`). Add one `unwrap<T>(r): T` helper that returns `data` on ok and
throws `error` otherwise. Every migrated call site uses `unwrap(await commands.foo(...))`.

**Rationale**: Today's wrappers reject (throw) on backend error; callers `try/catch`. Unwrapping
preserves that exact contract so caller error handling is unchanged.

## D3 — The dispatch module (`apps/desktop/src/api/ipc.ts`)

**Decision**: Extract the existing switcher from `commands.ts` into `api/ipc.ts`, exporting
`invoke<T>(cmd, args)` that: returns `_invokeOverride` result if installed (spec-021 recorder);
else `mockInvoke` when `VITE_USE_MOCKS`; else real `@tauri-apps/api/core` invoke. Also re-export
`setInvokeOverride`. The generated bindings import `invoke` from here; `commands.ts` (during
transition) imports from here too.

**Rationale**: Single dispatch point. Generated `commands.*` automatically inherit mock mode +
recorder (FR-002, US2). `mockInvoke(cmd, args)` is keyed by the snake_case command name, which is
exactly what the generated bindings pass — so mocks resolve unchanged.

## D4 — Migrating test mocks

**Decision**: Tests currently `vi.mock('@/api/commands', …)`. Migrate them to control IPC at the
dispatch layer instead — either `vi.mock('@/bindings', …)` returning a stub `commands` object, or
install a `setInvokeOverride` in `beforeEach` returning canned per-command responses. Prefer the
override approach for suites that exercise many commands; `vi.mock('@/bindings')` for narrow ones.

**Rationale**: Once callers use `commands.*`, mocking `@/api/commands` no longer intercepts them.

## D5 — Incremental delivery

**Decision**: (1) land the dispatch module + bindings redirect + `unwrap` helper first and prove
mock mode + recorder still work (no caller changes). (2) Convert `commands.ts` wrappers into thin
`unwrap(commands.*)` delegations so callers/tests keep working while the invoke literals leave
`commands.ts`. (3) Migrate callers + their test mocks feature-by-feature to call `commands.*`
directly. (4) Delete the wrapper layer + the now-obsolete `commands.bindings-guard.test.ts`.

**Rationale**: Keeps `main`/the branch green at every step (US3, FR-005); no 56-file big-bang.

## D6 — Dead plumbing to drop (not migrate)

`approvePlan` (no caller); `listSessions`/`listCalibrationMasters` `filters`/`sort`/`group_by`
args (no caller; `sessions_list` is a fixture stub — real filtering is spec-029).

## Open risks

- `specta-typescript` could change the invoke import string on an rc bump → the post-process
  replace must assert it matched (fail generation loudly if the expected import is absent).
- A few wrappers do response post-processing; inventory them before deleting (T-inventory).
