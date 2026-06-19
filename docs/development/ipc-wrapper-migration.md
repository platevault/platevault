# IPC wrapper → generated-bindings migration (planned)

## Why

`apps/desktop/src/api/commands.ts` holds ~90 hand-written `invoke('<name>', <payload>)`
wrappers. The generated tauri-specta bindings (`apps/desktop/src/bindings/index.ts`,
`export const commands`) are the authoritative description of every command's name and
payload shape. The hand-written wrappers drift from them, and **mock mode hides the
drift** — bugs only surface on a real Windows build. Two classes have shipped:

1. **Dotted/renamed command names** → "command not found" (e.g. `target.get` vs `target_get`).
2. **snake_case payload keys** the camelCase backend rejects (e.g. `scan_depth` vs `scanDepth`),
   which makes the whole command argument fail to deserialize.

Fixed instances: PRs #263, #264 (8 commands). Regression guard: `commands.bindings-guard.test.ts`.

## Why it isn't a quick mechanical swap

The generated bindings import `invoke` **directly** from `@tauri-apps/api/core`:

```ts
// bindings/index.ts (generated — do not edit)
import { invoke as __TAURI_INVOKE } from "@tauri-apps/api/core";
```

The hand-written `invoke()` in `commands.ts` is a **switcher** that the rest of the app
depends on:

- routes to `mocks.ts` `mockInvoke` when `VITE_USE_MOCKS` (all mock-driven dev + most tests),
- routes through `_invokeOverride` for the spec-021 dev-tools recording proxy.

So naively deleting the wrappers and calling `commands.*` directly would **bypass mock mode
and the dev recorder** for all 56 caller files. That's an architectural change, not a rename.

## Proposed approach (own spec, after Windows validation)

1. Configure tauri-specta to emit its invoke import from our switcher instead of tauri core
   (e.g. generate `import { invoke as __TAURI_INVOKE } from "@/api/ipc"`), where `@/api/ipc`
   exports the mock/override/real switcher currently inside `commands.ts`. Verify on a real build.
2. With the switcher preserved, incrementally replace hand-written wrappers with re-exports of
   the generated `commands.*` (unwrapping the `Result`-style `typedError` return into the
   throw-on-error contract callers expect). Keep the `@/api/commands` public surface stable so
   callers and test mocks don't all have to change at once.
3. Once all wrappers delegate, optionally repoint callers directly at the generated bindings and
   retire the wrapper layer.

Until then: the guard test blocks the two known drift classes, and any new command should be
added by calling the generated binding, not by hand-writing a new `invoke('...')` string.

## Known dead plumbing (remove during the migration, not live bugs)

- `approvePlan` wrapper — no caller anywhere; its `delete_acknowledged` reaches nothing.
- `listSessions` / `listCalibrationMasters` `filters`/`sort`/`group_by` args — no caller passes
  them and `sessions_list` is still a fixture stub (real list + filtering is spec-029 work).
