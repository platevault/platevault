# Implementation Plan: Tauri Backend Wiring

**Branch**: `029-tauri-backend-wiring` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/029-tauri-backend-wiring/spec.md`

## Summary

Wire the full Tauri 2 desktop shell so all 30+ frontend commands have matching
Rust command handlers (stubs returning fixture data), generated TypeScript
bindings replace hand-written types, and the SQLite database persists to a
platform-appropriate on-disk path. This establishes the transport layer that
domain specs (003-026) will fill with real implementations.

## Technical Context

**Language/Version**: Rust (workspace edition), TypeScript 5.x (frontend)

**Primary Dependencies**: tauri 2.x, tauri-specta, specta, specta-typescript,
sqlx (SQLite), serde, tracing; React 19, @tauri-apps/api 2.x (frontend)

**Storage**: SQLite via sqlx with migrations in `crates/persistence/db/migrations/`

**Testing**: `cargo test` (Rust, includes binding generation), `vitest` (frontend),
`just lint` / `just typecheck` (workspace)

**Target Platform**: Windows, macOS, Linux (Tauri desktop)

**Project Type**: Desktop app (Tauri + React monorepo)

**Performance Goals**: `tauri dev` launch < 30s; stub command response < 10ms

**Constraints**: No real business logic — stubs only. Must not break existing
spec 002 lifecycle commands. Must not break `VITE_USE_MOCKS=true` frontend-only
dev mode.

**Scale/Scope**: 30+ commands across 14 command groups, ~431 lines of types to
migrate, 5 existing migrations to preserve.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Local-First File Custody | Pass | No file copying or custody changes. Stubs return fixture data. |
| II. Reviewable Filesystem Mutation | Pass | No filesystem mutations. Database path creation is the only FS write. |
| III. PixInsight Boundary | Pass | No image processing. Transport layer only. |
| IV. Research-Led Domain Modeling | Pass | No domain modeling — stubs defer real modeling to domain specs. |
| V. Portable Contracts | Pass | Commands use language-neutral contract DTOs via specta. Generated bindings preserve portability. |
| Cross-platform paths | Pass | Database path uses Tauri `app_data_dir()` API, not hardcoded paths. |

No violations. No complexity justifications needed.

## Project Structure

### Documentation (this feature)

```text
specs/029-tauri-backend-wiring/
├── plan.md              # This file
├── research.md          # Phase 0: tauri-specta naming, DB path resolution
├── data-model.md        # Phase 1: Rust DTO types for stub surface
├── contracts/           # Phase 1: command surface contract
│   └── commands.md      # All 30+ command signatures
├── quickstart.md        # Phase 1: how to run tauri dev
└── tasks.md             # Phase 2: task breakdown
```

### Source Code (repository root)

```text
apps/desktop/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Updated: persistent DB path resolution
│   │   ├── lib.rs               # Updated: expanded specta_builder with all commands
│   │   └── commands/
│   │       ├── mod.rs            # Updated: re-export all command modules
│   │       ├── lifecycle.rs      # Existing: spec 002 commands (unchanged)
│   │       ├── envelope.rs       # Existing: legacy dispatcher (unchanged)
│   │       ├── sessions.rs       # New: stub sessions commands
│   │       ├── calibration.rs    # New: stub calibration commands
│   │       ├── targets.rs        # New: stub targets commands
│   │       ├── projects.rs       # New: stub projects commands
│   │       ├── plans.rs          # New: stub plans commands
│   │       ├── audit.rs          # New: stub audit commands
│   │       ├── settings.rs       # New: stub settings commands
│   │       ├── roots.rs          # New: stub roots/scan commands
│   │       ├── review.rs         # New: stub review commands
│   │       ├── search.rs         # New: stub search command
│   │       ├── preferences.rs    # New: stub preferences commands
│   │       └── tour.rs           # New: stub tour command
│   ├── tests/
│   │   └── bindings.rs           # Updated: assert all 30+ commands
│   └── Cargo.toml                # Updated: add tracing dependency
├── src/
│   ├── api/
│   │   ├── commands.ts           # Updated: imports from bindings, invoke wrapper
│   │   ├── mocks.ts              # Unchanged: mock layer preserved
│   │   └── types.ts              # Deleted: replaced by generated bindings
│   └── bindings/
│       └── index.ts              # Regenerated: all 30+ command types
└── vite.config.ts                # Unchanged

crates/contracts/core/src/         # May need new DTO modules for stub types
```

**Structure Decision**: Extends the existing `src-tauri/src/commands/` module
pattern established by spec 002. One file per command group. All new Rust types
live in `crates/contracts/core` to stay reusable across crates.

## Critique Findings (integrated)

Architectural review surfaced 7 findings. Resolutions integrated below:

1. **Specta emits `_Serialize`/`_Deserialize` suffixes** — the generated types
   won't match the frontend's plain names. Resolution: add a compatibility
   barrel (`bindings/types.ts`) that re-exports generated types under the names
   the frontend expects. Ensure `#[serde(rename_all = "camelCase")]` on all DTOs
   so field casing matches.

2. **`commands.ts` invoke wrapper vs generated binding functions** — the generated
   bindings use a `typedError` envelope, but the frontend expects raw `T`.
   Resolution: `commands.ts` remains a thin `invoke()` wrapper using generated
   types for type annotations only, not calling the generated binding functions
   at runtime. The generated `bindings/index.ts` is a type source, not a runtime
   call layer.

3. **Dotted names may not work in Tauri IPC dispatch** — `specta(rename)` may
   only control the TypeScript name, not the Tauri IPC command name. Resolution:
   build a single proof-of-concept command first (e.g., `sessions.list`) and
   verify end-to-end before implementing all 31. If dotted names don't work in
   Tauri's dispatcher, fall back to snake_case Tauri names with the frontend
   `commands.ts` updated to match.

4. **Async DB init in synchronous Tauri setup closure** — `Builder::setup()` is
   sync, so `block_on` inside it would deadlock on a single-threaded tokio
   runtime. Resolution: use `Builder::build()` to get the `App`, call
   `app.path().app_data_dir()` to resolve the path, then init DB in `main()`
   before calling `app.run()`. Keep DB init in the async `main` context.

5. **Premature AppState expansion** — adding 12+ `Option<Arc<dyn Trait>>` fields
   couples the shell to all domain crates. Resolution: do NOT expand AppState.
   Stubs return hardcoded data and don't need service references. Domain specs
   add their own fields to AppState when replacing stubs.

6. **PlanState enum variant divergence** — hand-written `types.ts` has 10
   variants, `data-model.md` lists 6, existing bindings have 9. Resolution:
   reconcile by auditing all three sources and making the Rust enum the canonical
   definition. The compatibility barrel re-exports the reconciled type.

7. **No rollback plan for `types.ts` deletion** — deleting 431 lines in one
   commit risks breaking all frontend files simultaneously. Resolution: phase
   the migration: (1) generate bindings, (2) create compatibility barrel with
   re-exports under old names, (3) migrate imports file-by-file with `tsc`
   verification, (4) delete `types.ts` last.

## Implementation Approach

### Phase 0: Proof of Concept (validate assumptions)

1. **Create one proof-of-concept stub** (`sessions.list`) with `#[specta(rename)]`
   and `#[tauri::command]`. Register it, regenerate bindings, and test end-to-end
   in `tauri dev` to verify:
   - Dotted command names work in Tauri IPC dispatch (or don't — fallback plan)
   - specta type generation produces usable types
   - The frontend `invoke('sessions.list')` resolves correctly
   - `tracing::debug!` output is visible with `RUST_LOG=debug`

2. **If dotted names fail in Tauri IPC**: switch to snake_case Tauri handler
   names and update the frontend `commands.ts` to use `invoke('sessions_list')`.
   Document the decision in research.md.

### Phase 1: Rust Stub Commands (backend)

1. **Define DTO types** in `crates/contracts/core/src/` for each command group's
   request/response shapes. All types derive `Serialize, Deserialize, Type, Clone`
   with `#[serde(rename_all = "camelCase")]`. Reconcile enum variants against
   existing generated bindings and hand-written `types.ts` — Rust is canonical.

2. **Create command modules** in `apps/desktop/src-tauri/src/commands/`, one per
   group. Each stub:
   - Accepts the expected argument types
   - Returns hardcoded fixture data matching the mock layer
   - Emits `tracing::debug!("stub: {command_name}")` on invocation
   - Uses the naming convention validated in Phase 0

3. **Register all commands** in `lib.rs` `specta_builder()` via `collect_commands!`.

4. **Do NOT expand AppState** — stubs don't need service references. Existing
   `AppState` fields (repo, bus, edge_table) are sufficient. Domain specs add
   fields when they replace stubs.

### Phase 2: Database Path Resolution (backend)

1. **Update `main.rs`** to resolve the database path:
   - If `ALM_DB_URL` is set, use it (existing behavior)
   - Otherwise, use `Builder::build()` to get the `App` handle, call
     `app.path().app_data_dir()` to get the platform path, construct
     `{data_dir}/alm.db`
   - Create the directory tree if it doesn't exist
   - Connect and run migrations in the async `main` context (before `app.run()`)

2. **Do NOT move DB init into the Tauri setup closure** — keep it in `main()`
   to avoid async/sync deadlock issues.

### Phase 3: Binding Generation & Frontend Migration (frontend)

1. **Regenerate bindings** via `cargo test -p desktop_shell`.

2. **Update `tests/bindings.rs`** to assert all 31 command names are present.

3. **Audit type names**: compare every type in `api/types.ts` against the
   generated output. Identify specta suffixes (`_Serialize`, `_Deserialize`),
   casing differences, and missing/extra enum variants.

4. **Create compatibility barrel** at `apps/desktop/src/bindings/types.ts` that
   re-exports generated types under the names the frontend expects (e.g.,
   `export type AcquisitionSession = Generated.AcquisitionSession_Serialize`).

5. **Migrate imports incrementally**: update frontend files to import from the
   compatibility barrel instead of `api/types.ts`, verifying with `tsc --noEmit`
   after each batch.

6. **Delete `api/types.ts`** once all imports are migrated and typecheck passes.

7. **Keep `api/commands.ts`** as a thin invoke wrapper. Update type annotations
   to reference the compatibility barrel types. Do NOT switch to calling the
   generated binding functions (they use `typedError` envelope).

### Phase 4: Integration & Verification

1. **Add `just tauri-dev`** command to the justfile.

2. **Run `tauri dev`** and verify all pages render with stub data.

3. **Run `just lint && just typecheck && just test`** to confirm nothing breaks.

4. **Verify mock mode** still works: `VITE_USE_MOCKS=true just dev`.
