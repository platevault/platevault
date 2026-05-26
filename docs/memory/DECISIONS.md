# Technical Decisions (`docs/memory/`)

This file stores durable technical and implementation decisions. For governance-level decisions or project standards, see `.specify/memory/DECISIONS.md`.

## Entry Lifecycle

Each decision follows this lifecycle:

```
Active → Needs Review → Superseded → (pruned)
```

- **Active**: The decision is current and must be honored by all features and AI agents.
- **Needs Review**: Implementation reality or new context suggests this decision may be outdated. It should still be honored until reviewed and explicitly changed.
- **Superseded**: A newer decision has replaced this one. Keep it for historical context until the next audit, then consider pruning.
- **Pruned**: During an audit, remove superseded entries that no longer provide historical value. This keeps the file focused.

---

### 2026-05-25 - Dotted Tauri command names via specta rename

**Status**: Active

**Why this is durable**: Every new Tauri command must follow this naming pattern. Affects all specs that add backend commands.

**Decision**: All Tauri commands use `#[specta(rename = "domain.action")]` dotted names (e.g., `roots.register`, `sessions.list`, `firstrun.complete`). Specta generates TypeScript bindings with these names.

**Tradeoffs**: Readable TS bindings and consistent namespace; requires remembering to add the rename attribute on every new command.

**Future mistake prevented**: Using underscore names (`roots_register`) or inconsistent naming across command groups.

**Evidence**: Spec 029 validated the pattern across 31 stub commands. All passed binding generation + integration tests.

**Where to look next**: `apps/desktop/src-tauri/src/commands/`, `apps/desktop/src/bindings/index.ts`

---

### 2026-05-26 - Client-side validation, server-side registration

**Status**: Active

**Why this is durable**: Any future wizard or form that registers sources must follow this pattern to avoid side-effect bugs.

**Decision**: During wizard flows, `validatePath()` performs client-side deduplication checks only. Registration (DB write) happens exclusively at flush time via `roots.register.batch`. Never use a create/register endpoint for validation purposes.

**Tradeoffs**: No server-side path existence check during add (deferred to flush). Simpler flow, no side effects. User sees path validation errors only at completion, not at add time.

**Future mistake prevented**: Calling `registerRoot()` in a "validate" function that silently persists data, causing double-registration at completion (code review finding C1, spec 003).

**Evidence**: Spec 003 code review, critical finding C1. Original `validatePath()` called `registerRoot()`, causing every source to fail at completion with `path.already_registered`.

**Where to look next**: `apps/desktop/src/features/setup/sources-store.ts`

---

### 2026-05-26 - DB-first with localStorage cache for first-run gate

**Status**: Active

**Why this is durable**: Any feature that gates on persistent state should follow this authority model.

**Decision**: Route gate reads `FirstRunState.completed_at` from SQLite via Tauri command, falls back to `setupCompleted` localStorage preference only if the DB read fails. DB is authority; localStorage is cache.

**Tradeoffs**: Async route guard adds a loading state flash on cold start. More robust than localStorage-only (survives browser storage clears).

**Future mistake prevented**: Using localStorage as the authority for durable state that should survive across installs or storage resets.

**Evidence**: Spec 003 clarification Q4. Implemented in `router.tsx` and `SetupPage.tsx`.

**Where to look next**: `apps/desktop/src/app/router.tsx`, `apps/desktop/src/features/setup/SetupPage.tsx`

---

### 2026-05-26 - Contract schemas match Tauri/specta pattern

**Status**: Active

**Why this is durable**: All future spec contracts must follow this pattern instead of the envelope pattern.

**Decision**: JSON Schema contracts document the actual Tauri/specta interface — typed response on success, `Err(String)` on failure. No `contractVersion`/`requestId`/`status` envelope wrappers.

**Tradeoffs**: Contracts are less portable to non-Tauri transports. If a future remote API is added, envelope fields would need to be reintroduced at that boundary.

**Future mistake prevented**: Writing contract schemas with envelope patterns that no command actually implements, causing perpetual spec-code drift.

**Evidence**: Spec 003 sync analysis finding D3. All pre-implementation contracts had envelopes; none of the Tauri commands implemented them.

**Where to look next**: `specs/*/contracts/*.json`

---

### 2026-05-25 - JsonAny wrapper for specta-annotated command parameters

**Status**: Active

**Why this is durable**: Any Tauri command that accepts untyped JSON must use this wrapper.

**Decision**: Use `contracts_core::JsonAny` (not raw `serde_json::Value`) for all specta-annotated command parameters. Raw `Value` causes infinite recursion in specta's TypeScript binding generation.

**Tradeoffs**: Extra wrapper type; `.0` access to get inner Value. Prevents stack overflow.

**Future mistake prevented**: Using `serde_json::Value` directly in a `#[tauri::command]` parameter, causing a stack overflow during `cargo build`.

**Evidence**: Spec 029 implementation. Discovered during PoC, documented in handover.

**Where to look next**: `crates/contracts/core/src/lib.rs` (JsonAny definition)
