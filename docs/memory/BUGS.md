# Recurring Bug Patterns (`docs/memory/`)

This file stores durable implementation bug patterns and their mitigations. For systemic, high-risk, or governance-level patterns, see `.specify/memory/BUGS.md`.

---

### 2026-05-26 - Specta bindings return result wrapper, not raw response

**Status**: Active

**Symptoms**: TypeScript errors like `Property 'completedAt' does not exist on type '{ status: "error"; error: string; } | { status: "ok"; data: ... }'`.

**Root Cause**: Tauri-specta generates bindings that wrap all command results in `{ status: "ok", data: T } | { status: "error", error: E }`. Code that accesses response fields directly without checking `.status` and unwrapping `.data` will fail at compile time or runtime.

**Future mistake prevented**: Accessing `.completedAt` directly on the result instead of `result.data.completedAt` after checking `result.status === 'ok'`.

**Evidence**: Spec 003 implementation — three files (router.tsx, SetupPage.tsx, DataSources.tsx) all had this bug after initial implementation.

**Prevention / Detection**: TypeScript strict mode catches this at compile time. Always unwrap: `const result = await commands.foo(); if (result.status === 'ok') { use(result.data); }`.

**Where to look next**: `apps/desktop/src/bindings/index.ts` (typedError function), any file calling `commands.*`

---

### 2026-05-26 - Serde camelCase rename means DTO fields are camelCase in TS

**Status**: Active

**Symptoms**: TypeScript errors like `Did you mean 'completedAt'?` when using `completed_at`.

**Root Cause**: Rust DTOs in `crates/contracts/core/` use `#[serde(rename_all = "camelCase")]`. The generated specta bindings produce camelCase field names. Hand-written TypeScript code that uses snake_case field names won't compile.

**Future mistake prevented**: Writing `result.data.completed_at` when the field is actually `result.data.completedAt`.

**Evidence**: Spec 003 — three TS errors after initial Rust agent output.

**Prevention / Detection**: `npx tsc --noEmit` catches this. When in doubt, check `apps/desktop/src/bindings/index.ts` for the generated type shape.

**Where to look next**: `crates/contracts/core/src/`, `apps/desktop/src/bindings/index.ts`

---

### 2026-05-26 - localStorage shape mismatch between writer and reader

**Status**: Active

**Symptoms**: Prefilled data silently lost after wizard restart. No error, just empty state.

**Root Cause**: Settings restart wrote `{ categories: [...] }` to localStorage but the wizard's `loadSources()` expected `{ sources: { raw: [...] } }`. Different parts of the codebase wrote to the same localStorage key with incompatible shapes.

**Future mistake prevented**: Two components writing to the same localStorage key with different object shapes.

**Prevention / Detection**: Use a single module (`sources-store.ts`) as the authority for reading/writing wizard localStorage state. Never write to `alm-setup-wizard-state` from outside that module.

**Evidence**: Spec 003 code review finding C2 + verify finding FR-013/SC-004.

**Where to look next**: `apps/desktop/src/features/setup/sources-store.ts`

---

### 2026-05-25 - WSLg cannot render WebKitGTK / Tauri windows

**Status**: Active

**Symptoms**: Tauri dev window is blank or fails to open when running from WSL2.

**Root Cause**: WSLg does not support WebKitGTK rendering. Chrome/X11 apps work but Tauri's WebKitGTK webview does not.

**Future mistake prevented**: Trying to debug Tauri visual issues from WSL. Always test Tauri visually on native Windows.

**Evidence**: Spec 029 handover. Repeated across multiple sessions.

**Prevention / Detection**: Use `VITE_USE_MOCKS=true just dev` for browser-only frontend testing in WSL. For Tauri visual testing, clone repo on native Windows: `git pull && pnpm install && pnpm tauri dev`.

**Where to look next**: Native Windows clone, not WSL.
