# Implementation Plan: i18n Infrastructure & Unified Error-Code Translation

**Branch**: `046-i18n-error-codes` | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/046-i18n-error-codes/spec.md`

## Summary

Route **every** user-facing string in the desktop app — labels, buttons,
placeholders, tooltips, empty-states, toasts, names, terminology, validation,
and error messages — through a single, build-time-compiled, type-safe message
catalog (Paraglide JS), keyed by stable identifiers. English is the only shipped
language and is hard-pinned with no user-facing switcher, but the catalog is
structured so further languages need only new catalog entries, never component
edits.

Errors are unified onto the existing backend `ErrorCode` registry
(`contracts_core::error_code::ErrorCode`, already exported to TypeScript via
tauri-specta in spec 042). Each code translates to a friendly catalog message at
a **single** frontend translation point (`@/lib/errors` → catalog), with a safe
generic fallback and internal logging for unmapped codes. Raw codes and backend
exception strings are never shown to the user.

**Phasing** (per stakeholder decision):

1. **US1 infra** — stand up the Paraglide catalog (offline, sync, type-safe).
2. **US2 error half** — finish the code→message unification onto the catalog
   (most of the registry + single helper already exist from spec 042).
3. **Lint gate** — add a build/lint rule that forbids new hardcoded user-facing
   literals; this becomes the engine that drives the migration.
4. **Migration waves** — relocate existing strings into the catalog, page by
   page, driven by the lint gate, until zero violations remain (SC-001), folding
   in US3 vocabulary consistency along the way.

## Technical Context

**Language/Version**: TypeScript 5.8 (React 19), Rust (workspace, edition 2021),
Vite 7.

**Primary Dependencies**: `@inlang/paraglide-js` ^2.20 (vite plugin +
compiler); existing `@astro-plan/contracts` / generated `src/bindings/index.ts`
(tauri-specta) for the `ErrorCode` union; ESLint 10 + typescript-eslint 8 for
the literal gate.

**Storage**: N/A (catalog is compiled source; no runtime data store). Messages
live in `apps/desktop/messages/en.json`; compiled output in
`apps/desktop/src/paraglide/` (git-ignored, regenerated on build/dev).

**Testing**: vitest (frontend), `cargo test` (regenerates bindings + error-code
round-trips), ESLint (literal gate + token guard), `tsc --noEmit` (catalog key +
error-code exhaustiveness), Playwright (smoke render).

**Target Platform**: Tauri desktop (Windows/macOS/Linux), local-first, offline.

**Project Type**: Desktop app (Tauri + React frontend, Rust core), monorepo.

**Performance Goals**: No async/network for catalog access; no flash of missing
text; message resolution is a compiled function call (zero runtime lookup cost
beyond a property access).

**Constraints**: Fully offline; no language switcher; preserve current
post-cleanup English wording (FR-014); generated `src/bindings/index.ts` stays
the authoritative error-code contract; element-level inline styles remain
forbidden (existing spec 022/028 gate is unaffected).

**Scale/Scope**: ~208 component/TS modules under `apps/desktop/src`; every
user-facing literal across ~10 feature areas (inbox, sessions, calibration,
targets, projects, settings, setup/wizard, shell/nav, dialogs, toasts) plus the
error-code catalog (~95 codes in the `ErrorCode` enum).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Local-First File Custody** — N/A to file custody; the catalog is compiled
  source, touches no user image files. ✅
- **II. Reviewable Filesystem Mutation** — No filesystem plans/mutations are
  introduced; this is UI/contract plumbing only. The error-translation change
  does not alter what plans say or do. ✅
- **III. PixInsight Boundary** — Untouched; no processing behavior. ✅
- **IV. Research-Led Domain Modeling** — Catalog mechanism, key-naming scheme,
  and error-translation strategy are documented in `research.md` with options +
  rationale before implementation. ✅
- **V. Portable Contracts and Durable Records** — The error-code registry is the
  language-neutral contract (Rust enum → generated TS union); the frontend
  consumes the generated set, so the two cannot drift. The message catalog is a
  presentation projection over those codes, not a new transport. ✅

**No violations.** Complexity Tracking table omitted.

## Project Structure

### Documentation (this feature)

```text
specs/046-i18n-error-codes/
├── plan.md              # This file
├── research.md          # Phase 0 — library + strategy decisions
├── data-model.md        # Phase 1 — catalog key scheme, error-translation entities
├── quickstart.md        # Phase 1 — how to add/use a message, add a code
├── contracts/
│   └── error-code-registry.md  # The Rust↔TS error-code contract + translation map
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/desktop/
├── project.inlang/
│   └── settings.json            # baseLocale=en, locales=[en], paraglide plugin
├── messages/
│   └── en.json                  # THE catalog — stable keys → English text
├── src/
│   ├── paraglide/               # compiled message fns + runtime (git-ignored)
│   ├── lib/
│   │   ├── i18n.ts              # thin re-export of compiled `m` + helpers
│   │   ├── errors.ts           # single translation point (code → catalog)
│   │   └── error-messages.ts   # code → catalog-key map (+ generic fallback)
│   └── …                        # all feature components consume `m.*()`
├── vite.config.ts               # + paraglideVitePlugin
├── eslint.config.js             # + no-hardcoded-user-strings rule
└── tsconfig*.json               # `src/paraglide` resolvable

crates/contracts/core/src/error_code.rs   # ErrorCode enum (authoritative set)
apps/desktop/src/bindings/index.ts          # generated ErrorCode union (contract)
apps/desktop/src-tauri/                      # ContractError.code typed as ErrorCode
```

**Structure Decision**: Frontend-centric. The message catalog and lint gate live
entirely under `apps/desktop`. The only backend touchpoint is tightening
`ContractError.code` from `String` to the existing `ErrorCode` enum (the enum and
its TS export already exist from spec 042 T011); no new crate, no transport
change. The catalog is a presentation layer over the existing contract.

## Phase Sequencing & Risk

| Phase | Deliverable | Gate / proof |
|-------|-------------|--------------|
| US1 infra | Paraglide compiled catalog, `m.*` usable, offline sync render | `tsc` passes; dev/build compile catalog; missing key = build error |
| US2 error half | `ContractError.code: ErrorCode`; one translation point; fallback + log | `cargo test` (bindings + round-trips); vitest for `errMessage`; no raw code in UI |
| Lint gate | `no-hardcoded-user-strings` ESLint rule wired into `just lint` | rule flags a seeded literal; allowlist documented |
| Migration | All literals → catalog, US3 vocabulary canon | lint = 0 violations (SC-001); wording preserved (FR-014) |
| Verify | Multilingual proof (throwaway), full gate green | SC-001..SC-007 checked; speckit-verify |

**Top risks & mitigations**

- *Migration scale / regressions*: do it in lint-driven waves per feature area,
  each wave keeping `tsc`/vitest green; preserve exact wording (FR-014) so diffs
  are mechanical, not editorial (US3 wording changes are explicit + isolated).
- *Lint false positives* (non-user strings: keys, test ids, enum values): the
  rule targets JSX text nodes and a fixed set of user-facing attributes
  (`placeholder`, `title`, `aria-label`, `alt`, button/option children) with an
  inline-disable escape hatch and a documented allowlist.
- *Two-agents-one-checkout*: all work happens in the `046-i18n-error-codes`
  worktree on its own branch; SpecKit state is resolved from the worktree, not
  the shared main checkout.
- *Headroom literal corruption*: when authoring/auditing exact catalog strings,
  rely on real-byte tools (Edit/Read of the file), not grepped tool output.
```
