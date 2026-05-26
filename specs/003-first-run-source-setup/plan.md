# Implementation Plan: First-Run Source Setup

**Branch**: `003-first-run-source-setup` | **Date**: 2026-05-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-first-run-source-setup/spec.md`
**Reconciled**: Post specs 027 (frontend) and 029 (Tauri backend wiring)

## Summary

Replace the stub-backed first-run wizard with real persistence and refactor
the current 5-step wizard into an 8-step flow. A route gate at `/`
dispatches between `/setup` and `/sessions` based on a persisted completion
flag. The wizard is a sequential eight-step React component (Welcome → Raw →
Calibration → Project → Inbox → Detect Tools → Download Catalogs → Finish)
where Raw and Project steps are required to advance (A5, A6, R-Wiz-2).
Directory selection uses the existing `DirPicker` component already wired to
`@tauri-apps/plugin-dialog`; interim state lives in `localStorage` for
resilience. On Finish the working source list is promoted to SQLite via the
`roots.register.batch` Tauri command (R-Batch, A9) and the completion flag
is set via `firstrun.complete`.

The Download Catalogs step will be backed by `catalog.manifest.fetch` and
`catalog.download` contracts from spec 014 (R-1.4) when that spec lands.
Until then, the step renders with stub/placeholder UI and fixture data. The
step does not block Finish if the user skips it (A6); catalog download can
be retried from Settings → Catalogs. The Detect Tools step is similarly
stubbed until spec 011 lands.

**Observer location**: `observer_location` is NOT collected at first-run. It
is resolved at session-formation time (per-import, auto-extracted from FITS
keywords) and lives on `AcquisitionSession` in spec 002, not in settings
(R-Obs).

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
- **Portable contracts and durable records**: PASS. `contracts/roots.register.json`
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
│   ├── roots.register.json
│   └── firstrun.complete.json
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/desktop/
├── src/
│   ├── app/router.tsx                        # index gate, /setup route (EXISTS)
│   ├── features/setup/SetupPage.tsx          # setup page guard (EXISTS)
│   ├── features/setup/SetupWizard.tsx        # wizard component (EXISTS, refactor to 8 steps)
│   ├── features/setup/steps/                 # step components (EXISTS, refactor)
│   │   ├── StepWelcome.tsx                   # (EXISTS)
│   │   ├── StepRaw.tsx                       # NEW: raw sources step (split from StepSources)
│   │   ├── StepCalibration.tsx               # NEW: calibration step
│   │   ├── StepProject.tsx                   # NEW: project step
│   │   ├── StepInbox.tsx                     # NEW: inbox step
│   │   ├── StepDetectTools.tsx               # NEW: stub placeholder
│   │   ├── StepCatalogs.tsx                  # (EXISTS, update for stub mode)
│   │   ├── StepConfirm.tsx                   # (EXISTS, update for 8-step summary)
│   │   └── index.ts                          # (EXISTS, update exports)
│   ├── features/setup/sources-store.ts       # NEW: localStorage buffer + DB promote
│   └── features/settings/SettingsPage.tsx    # restart entry point (EXISTS, update)
├── src-tauri/
│   └── src/commands/
│       ├── roots.rs                          # roots.register stub (EXISTS, replace with real)
│       └── firstrun.rs                       # NEW: firstrun.complete, firstrun.restart

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
in `apps/desktop/src/features/setup/`, Tauri command handlers in
`apps/desktop/src-tauri/src/commands/`, domain orchestration in
`crates/app/core/`, persistence in `crates/persistence/db/`, and contracts
in `packages/contracts/` (canonical) plus `crates/contracts/core/` (Rust
mirror). The wizard currently uses a unified `StepSources` component; this
must be split into per-category steps (StepRaw, StepCalibration, StepProject,
StepInbox) and new stub steps added (StepDetectTools). The `DirPicker`
component and `sources-store` module are shared across the per-category steps.

## Architecture Notes

### Route Gate

The index route at `/` currently goes straight to `/sessions`. The setup
route at `/setup` is standalone (outside Shell chrome) and checks
`setupCompleted` in localStorage preferences. This spec upgrades the gate
to read `FirstRunState.completed_at` from the DB via a `firstrun.state`
Tauri command, falling back to the `setupCompleted` localStorage preference
only if the DB read fails (degraded mode). The index route must redirect to
`/setup` when the completion flag is absent.

### Wizard Component

`SetupWizard.tsx` is currently a 5-step wizard with a unified `StepSources`
component. The refactor MUST:

1. Split the unified `StepSources` into four per-category step components
   (`StepRaw`, `StepCalibration`, `StepProject`, `StepInbox`) each using
   the existing `DirPicker` component for directory selection.
2. Add `StepDetectTools` as a stub step with placeholder UI.
3. Update `StepCatalogs` to work as a stub step with fixture data.
4. Update the `STEPS` array to define the 8-step sequence: Welcome → Raw →
   Calibration → Project → Inbox → Detect Tools → Download Catalogs →
   Finish.
5. Update `canAdvance` to require entries for Raw (step 1) and Project
   (step 3) while allowing Calibration, Inbox, Detect Tools, and Catalogs
   to advance freely.
6. Replace direct `localStorage` writes with a `sources-store.ts` module
   that buffers in `localStorage` mid-wizard but flushes to SQLite on
   Finish via the `roots.register.batch` Tauri command.
7. Surface validation errors returned by `roots.register` inline next to
   the offending row (e.g. `path.not.exists`, `path.already.registered`).

### Persistence Boundary

- **During wizard**: `localStorage["alm-setup-wizard-state"]` holds the
  working wizard state including source categories, paths, and estimates.
  This survives accidental refresh but is treated as throwaway state, not
  durable. The DB `FirstRunState` row does NOT carry a `sources_buffer`
  column (R-Buf; research §8).
- **On Finish**: the wizard calls `roots.register.batch` with all buffered
  sources in a single request (R-Batch, A9). Rows with `path.already.registered`
  are treated as success (idempotent — D1). On partial failure, the wizard
  stays on the Finish step with per-row error indicators; the user can retry
  failed rows. On full success (or after retries clear all errors), the
  wizard calls `firstrun.complete`, sets the completion flag, clears the
  buffer, and navigates to `/sessions`. `firstrun.complete` emits
  `first_run.completed` audit event (R-E2).
- **`created_via` is server-derived** (R-Auth-1): the caller does NOT pass
  `created_via` in the request. The server sets it based on
  `FirstRunState.completed_at` context (`first_run` while null, `settings_add`
  or `settings_restart` otherwise).

### Restart Flow

- The Settings "Restart first-run wizard" button calls the `firstrun.restart`
  Tauri command (dotted name, R-E5).
- The server clears `FirstRunState.completed_at`, sets `last_step = welcome`,
  emits `audit.first_run.restarted`, and returns `prefilled_sources` (the
  current `RegisteredSource` rows).
- The desktop writes `prefilled_sources` to `localStorage["alm-setup-wizard-state"]`,
  clears the `setupCompleted` preference, and navigates to `/setup` (A7).
- Existing `RegisteredSource` rows are NOT deleted by restart; the user
  amends them during the re-run.

### Download Catalogs Wizard Step (Stubbed)

The Download Catalogs step (step 7, A6, R-1.4) will be backed by contracts
from spec 014 when that spec is implemented. Until then:

1. **Stub UI**: renders a placeholder list showing OpenNGC and common
   catalogs with a "Download" button and a "Skip for now" link. Clicking
   Download shows a simulated progress indicator that completes after a
   brief delay.
2. **Skip**: the step does not block Finish. A "Skip for now" action
   advances the wizard. The step explains that catalogs can be installed
   later from Settings → Catalogs.
3. **Future wiring**: when spec 014 lands, the stub is replaced with real
   `catalog.manifest.fetch` and `catalog.download` calls, per-row progress
   via event-bus topics, and retry on partial failure.

### Tauri Command Replacement

The `DirPicker` component and `@tauri-apps/plugin-dialog` are already wired
and working. The `roots.register` stub in `roots.rs` currently returns
fixture data. The replacement:

- Frontend calls `invoke('roots.register', { path, category, scan_settings })`
  after the user confirms the native dialog (already wired in `commands.ts`
  as `registerRoot()`).
- The Rust handler in `roots.rs` is replaced with a real implementation
  that validates path existence, directory-ness, and readability, then
  either inserts a `RegisteredSource` row or returns one of the contract
  errors.
- The Rust handler delegates to `crates/app/core/` so a future remote
  service can reuse the same use case.
- New commands `roots.register.batch`, `firstrun.complete`, and
  `firstrun.restart` are added in `firstrun.rs`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations to justify at this time. The plan reduces existing complexity
by removing the picker stub and the duplicate state representations.
