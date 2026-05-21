# Implementation Plan: First-Run Source Setup

**Branch**: `003-first-run-source-setup` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-first-run-source-setup/spec.md`

## Summary

Replace the mockup-only first-run wizard with a Tauri-backed flow that
registers source roots into the library database. A route gate at `/`
dispatches between `/welcome` and `/inventory` based on a persisted
completion flag. The wizard itself is a sequential six-step React component
(Welcome → Raw → Calibration → Project → Inbox → Finish) where only the Raw
step is required to advance. Directory selection uses
`@tauri-apps/plugin-dialog`; interim state lives in `localStorage` for
resilience, and on Finish the working source list is promoted to SQLite via
the `source.register` contract and the completion flag is set via
`firstrun.complete`.

## Technical Context

**Language/Version**: TypeScript 5.x (frontend) and Rust 1.75+ (Tauri core).  
**Primary Dependencies**: React 18, TanStack Router, `@tauri-apps/plugin-dialog`,
Tauri 2.x, `sqlx` (or repository equivalent in `crates/persistence/db`).  
**Storage**: SQLite (library database) for `RegisteredSource` and `FirstRunState`;
`localStorage` only as a volatile buffer during the wizard.  
**Testing**: Vitest + React Testing Library for the wizard component, Playwright
MCP for end-to-end first-run flow, `cargo test` for the contract handlers,
contract conformance tests in `tests/contract/`.  
**Target Platform**: Desktop (Windows, macOS, Linux) via Tauri.  
**Project Type**: Desktop app — `apps/desktop/` + Rust crates.  
**Performance Goals**: Wizard navigation within 100ms per step; Finish
persists in under 500ms p95 for up to 16 source roots.  
**Constraints**: No file scanning, hashing, or enumeration during the
wizard; native picker must run on the platform main thread per Tauri's
`plugin-dialog` requirements.  
**Scale/Scope**: Single-user, single-library, expected to register fewer than
20 source roots in 99% of cases.

## Constitution Check

- **Local-first file custody**: PASS. The wizard only registers absolute
  paths to user-owned directories; it does not copy or relocate files.
  Roots are stored separately from any relative paths, satisfying the
  "library roots modeled separately" principle.
- **Reviewable filesystem mutation**: PASS. The wizard performs zero
  filesystem mutations. Adding a source is a database-only operation; no
  move/copy/delete plans are generated here.
- **PixInsight boundary**: PASS. No calibration, debayer, registration,
  integration, drizzle, stacking, or editing happens in this feature.
- **Research-led domain modeling**: PARTIAL. `research.md` records open
  questions for picker library, persistence boundary, restart semantics,
  required-vs-optional gating, and category clarification UX. Several
  `[NEEDS DECISION]` markers remain in the spec.
- **Portable contracts and durable records**: PASS. `contracts/source.register.json`
  and `contracts/firstrun.complete.json` describe the boundary in
  language-neutral JSON Schema Draft 2020-12. SQLite is the durable record;
  `localStorage` is treated as a regenerable buffer.
- **Cross-platform path safety**: PARTIAL. The wizard delegates path
  validation to the Tauri picker plus a `path.not.exists` /
  `path.not.directory` / `path.permission.denied` error set in the
  contract. Symlink and junction policy is deferred to the inventory
  scanner per the Astro Library Manager constitution.

Re-check after Phase 1 design: confirm contract error set covers Windows
long-path failures and macOS sandbox prompt cancellations.

## Project Structure

### Documentation (this feature)

```text
specs/003-first-run-source-setup/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── source.register.json
│   └── firstrun.complete.json
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/desktop/
├── src/
│   ├── app/router.tsx                     # index gate, /welcome route
│   ├── features/welcome/WelcomePage.tsx   # sequential wizard
│   ├── features/welcome/picker.ts         # NEW: Tauri plugin-dialog wrapper
│   ├── features/welcome/sources-store.ts  # NEW: localStorage buffer + DB promote
│   └── features/settings/SettingsPage.tsx # restart entry point
├── src-tauri/
│   └── src/commands/firstrun.rs           # NEW: tauri commands wiring contracts

crates/
├── app/core/                              # use-case: register_source, complete_first_run
├── persistence/db/                        # repository for RegisteredSource, FirstRunState
└── contracts/core/                        # Rust DTOs matching JSON Schema

packages/contracts/                         # JSON Schemas + generated TS types

tests/
├── contract/first_run.rs                  # NEW: schema conformance
└── integration/first_run_flow.spec.ts     # NEW: Playwright end-to-end
```

**Structure Decision**: Follow the existing Astro monorepo split — UI lives
in `apps/desktop/src/features/welcome/`, Tauri command handlers in
`apps/desktop/src-tauri/`, domain orchestration in `crates/app/core/`,
persistence in `crates/persistence/db/`, and contracts in
`packages/contracts/` (canonical) plus `crates/contracts/core/` (Rust
mirror). The mockup currently lives entirely under
`apps/desktop/src/features/welcome/WelcomePage.tsx` and must be split into
a thinner component plus the picker and store modules listed above.

## Architecture Notes

### Route Gate

The index route at `/` already inspects `alm.first-run.completed` and
redirects to `/welcome` or `/inventory`. This continues to be the
authoritative gate. Once the library DB exists, the flag SHOULD migrate to
`FirstRunState.completed_at` so that the gate reads the DB-backed value
through a Tauri command, falling back to `localStorage` only if the DB read
fails (degraded mode).

### Wizard Component

`WelcomePage.tsx` stays a single sequential component. The `STEPS` array
defines step copy, kind, and empty-state messaging. Per-step gating is
expressed by `canAdvance`, which today is hardcoded to require Raw entries.
The refactor MUST:

1. Replace `pickFolderStub` with an import from `picker.ts` that calls
   `@tauri-apps/plugin-dialog` `open({ directory: true, multiple: false })`.
2. Replace direct `localStorage` writes with a `sources-store.ts` module
   that buffers in `localStorage` mid-wizard but flushes to SQLite on
   Finish via the `source.register` contract.
3. Surface validation errors returned by `source.register` inline next to
   the offending row (e.g. `path.not.exists`, `path.already.registered`).

### Persistence Boundary

- **During wizard**: `localStorage["alm.first-run.sources"]` holds the
  working `SourceEntry[]`. This survives accidental refresh but is treated
  as throwaway state, not durable.
- **On Finish**: the wizard iterates the buffer and calls
  `source.register` for each entry. If any call fails, the wizard stays on
  the Finish step with row-level errors. On full success it calls
  `firstrun.complete`, sets the completion flag, clears the buffer, and
  navigates to `/inventory`.
- **On Restart from Settings**: the wizard clears the completion flag.
  Whether previously registered sources are also wiped is the open
  question recorded in `research.md`. Mockup is destructive; spec leans
  toward prefill in a follow-up iteration.

### Tauri Picker Replacement

The current stub returns canned paths and writes a warn log when no more
suggestions remain. The replacement contract:

- Frontend calls `tauri.invoke("source_register", { kind, path })` after
  the user confirms the native dialog.
- The Rust handler validates path existence, directory-ness, and
  readability, then either inserts a row or returns one of the contract
  errors.
- The Rust handler is a thin Tauri command that delegates to
  `crates/app/core/` so a future remote service can reuse the same use case.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations to justify at this time. The plan reduces existing complexity
by removing the picker stub and the duplicate state representations.
