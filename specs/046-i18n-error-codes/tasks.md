# Tasks: i18n Infrastructure & Unified Error-Code Translation

**Input**: Design documents from `specs/046-i18n-error-codes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included where they are the acceptance mechanism (build-time key
checks, error-code exhaustiveness, `errMessage` behavior). Heavy UI test
authoring is out of scope; existing vitest/Playwright suites must stay green.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- All paths are under the repo root; frontend = `apps/desktop/`.

---

## Phase 1: Setup (US1 infra — catalog foundation)

**Purpose**: Stand up the Paraglide catalog so `m.*()` is usable, type-safe,
offline, and synchronous. Blocks all migration.

- [ ] T001 [US1] Add `@inlang/paraglide-js` (^2.20) to `apps/desktop/package.json`; run install; record version.
- [ ] T002 [US1] Create `apps/desktop/project.inlang/settings.json` — `baseLocale: "en"`, `locales: ["en"]`, paraglide plugin config, no locale-detection strategy (English hard-pinned, no switcher — FR-004).
- [ ] T003 [US1] Add `paraglideVitePlugin` to `apps/desktop/vite.config.ts` (project = `./project.inlang`, outdir = `./src/paraglide`).
- [ ] T004 [P] [US1] Git-ignore `apps/desktop/src/paraglide/` (compiled output); ensure `tsconfig` resolves `@/paraglide/messages` and the dir is created on dev/build.
- [ ] T005 [US1] Seed `apps/desktop/messages/en.json` with the taxonomy stub: `common_*`, `verb_archive`, `verb_trash`, `nav_*`, `err_generic_fallback` (R5 scheme).
- [ ] T006 [US1] Add `apps/desktop/src/lib/i18n.ts` — thin re-export of compiled `m` (+ any helper) so app code imports one path.
- [ ] T007 [US1] Wire catalog compilation into CI/build ordering: `paraglide` compile must run before `tsc --noEmit` / vitest (so missing-key checks have the generated types). Update `just typecheck`/lint scripts if needed.

**Checkpoint US1 infra**: `pnpm build` compiles the catalog; a deliberately
missing key fails the build (FR-002); a screen using one `m.*()` renders English
synchronously with no flash (US1 AS3). ✅ before migration.

---

## Phase 2: US2 — Unify error-code translation (P1)

**Purpose**: One shared code set, one translation point, friendly messages,
generic fallback + logging, no raw codes. Depends on US1 infra (catalog exists).

- [ ] T010 [US2] Tighten `ContractError.code` from `String` to `contracts_core::error_code::ErrorCode` at the Rust boundary; fix construction sites to use enum variants. (FR-006)
- [ ] T011 [US2] `cargo test -p desktop_shell` to regenerate `apps/desktop/src/bindings/index.ts`; commit the regenerated `ErrorCode` surface; confirm CI diff guard passes.
- [ ] T012 [US2] Move error wording into the catalog: add `err_<code>` entries in `messages/en.json` for every mapped code (lift current `ERROR_MESSAGES` literals verbatim — FR-014).
- [ ] T013 [US2] Repoint `apps/desktop/src/lib/error-messages.ts` values to catalog fns (`m.err_*`); type the map against `ErrorCode`; add a typed `err_generic_fallback`.
- [ ] T014 [US2] In `apps/desktop/src/lib/errors.ts` `errMessage()`: known code → catalog msg; unknown code → `m.err_generic_fallback()` AND `logUnmappedCode(code)` (FR-009/010/011, SC-005).
- [ ] T015 [P] [US2] Add `logUnmappedCode` (console + any existing diagnostic log sink); ensure every surfaced error records its code internally (FR-010).
- [ ] T016 [US2] Add an exhaustiveness check so an unmapped `ErrorCode` is caught pre-release: a unit test iterating the union, or a `satisfies` assertion. (FR-007, SC-003)
- [ ] T017 [US2] Sweep components for residual raw-error rendering (`String(err)`, `err.message`, inline code switches) and route through `errMessage`; verify the only translation point is `@/lib/errors`. (FR-008, SC-004)
- [ ] T018 [P] [US2] vitest for `errMessage`: known code → friendly text; unknown code → fallback + log; never returns the raw code or `[object Object]`. (SC-005)

**Checkpoint US2**: trigger a known failure (e.g. duplicate name) → friendly
message, no raw code in UI, code present in log; remove a code → frontend gap is a
type/test failure. ✅

---

## Phase 3: Lint gate (drives the migration)

**Purpose**: Make hardcoded user-facing literals a lint failure so migration is
"drive to zero" and regressions are blocked. Depends on US1 infra.

- [ ] T020 Implement local ESLint rule `alm/no-user-string` in `apps/desktop/eslint-rules/` — flag JSX text nodes with letters + user-facing attrs (`placeholder`, `title`, `aria-label`, `aria-description`, `alt`, label-style props) + toast/notify string args. (research R4)
- [ ] T021 Configure exclusions/allowlist in `eslint.config.js`: `bindings/`, `paraglide/`, `messages/`, tests, fixtures, mocks, `dev/`, machine-string attrs (`className`/`id`/`data-*`/`key`/`type`/`role`/`href`/`to`/enum values); document the `// eslint-disable-next-line alm/no-user-string` escape hatch with required reason.
- [ ] T022 Wire the rule into `just lint` (`apps/desktop` eslint run); enable it per-area via `files` globs so `just lint` stays green between migration waves (R4 rollout).
- [ ] T023 [P] Seed-test the rule: a deliberate literal in a migrated area fails lint; a catalog call + an allowlisted machine string pass.

**Checkpoint lint gate**: rule on for an already-clean area = green; introducing a
literal there = red. ✅

---

## Phase 4: US1 — Migration waves (all UI strings → catalog) + US3 vocabulary

**Purpose**: Relocate every user-facing string into the catalog, one feature area
per wave, enabling the lint gate for each area as it completes. Preserve wording
(FR-014); collapse synonyms to canonical keys (US3, FR-013) as explicit changes.

Each wave Wn: extract literals → `messages/en.json` (taxonomy keys) → replace with
`m.*()` → enable `alm/no-user-string` for that area → `tsc`/vitest green.

- [ ] T030 [P] [US1] Wave: **shell/nav/status bar** (`src/app/**`, Sidebar, LogPanel, window/title) → catalog.
- [ ] T031 [P] [US1] Wave: **common/shared UI** (`src/ui/**`, `src/components/**`, dialogs/ConfirmOverlay, toasts) → catalog; establish `common_*`/`verb_*` canonical keys.
- [ ] T032 [P] [US1] Wave: **inbox** (`src/features/inbox/**`) → catalog.
- [ ] T033 [P] [US1] Wave: **sessions** (`src/features/sessions/**`) → catalog.
- [ ] T034 [P] [US1] Wave: **calibration** (`src/features/calibration/**`) → catalog.
- [ ] T035 [P] [US1] Wave: **targets** (`src/features/targets/**`) → catalog.
- [ ] T036 [P] [US1] Wave: **projects** (`src/features/projects/**`) → catalog.
- [ ] T037 [P] [US1] Wave: **settings** (`src/features/settings/**`, all panes) → catalog.
- [ ] T038 [P] [US1] Wave: **setup/first-run wizard** (`src/features/setup/**`) → catalog.
- [ ] T039 [US3] Vocabulary consistency pass: audit catalog for synonyms; collapse destructive verbs (`verb_archive`/`verb_trash`), favourites/"My Targets" (`nav_my_targets`), section titles, ellipsis (`common_ellipsis`) to one canonical key each; repoint usages. (FR-013, SC-006)
- [ ] T040 [US1] Flip `alm/no-user-string` on for `src/**` (minus documented exclusions); resolve the final stragglers to **zero** violations. (SC-001)

**Checkpoint migration**: `just lint` = 0 literal violations across `src/**`;
every screen renders identical English to today (FR-014). ✅

---

## Phase 5: Polish & Verify

- [ ] T050 [US1] SC-007 proof (throwaway, NOT shipped): add `messages/de.json` + `"de"` locale, flip one screen with zero component edits, then revert. Record result in quickstart/verify notes.
- [ ] T051 Confirm FR-012: scan catalog + tooltips for STUB/MOCK/"pending"/"coming soon"/issue refs → zero (SC-002). The catalog is the review gate.
- [ ] T052 Full local gate: `just lint`, `just typecheck`, `just test`, `pnpm build` (catalog compiles) all green in the worktree.
- [ ] T053 `speckit-verify` against FR-001..014 / SC-001..007; resolve gaps.
- [ ] T054 Commit on `046-i18n-error-codes` (`-c commit.gpgsign=false`); update spec Status → ready.

---

## Dependency Graph

```
US1 infra (T001–T007)
        │
        ├────────────► US2 error half (T010–T018)        [needs catalog for err_* msgs]
        │
        └────────────► Lint gate (T020–T023)
                              │
                              ▼
                       Migration waves (T030–T038)  [P across areas, each needs catalog+gate]
                              │
                              ▼
                       US3 vocab (T039) ──► SC-001 flip (T040)
                              │
                              ▼
                       Polish & Verify (T050–T054)   [T052 also needs US2 green]
```

- **Foundational/blocking**: T001–T007 (catalog) block everything. T020–T022
  (gate) block the waves' lint-enable step but not the extraction itself.
- **Parallelizable**: T030–T038 are independent feature areas (different files) —
  can be assigned to parallel coders, each finishing `tsc`/vitest green before its
  lint-enable. T004/T015/T018/T023 marked [P] within their phases.
- **Serial gates**: T010→T011 (Rust type → regenerate bindings) is ordered;
  T039→T040 (canonicalize before the final zero-flip); T052/T053 last.

## Per-FR / SC coverage

| Req | Tasks |
|-----|-------|
| FR-001 / SC-001 | T030–T040 |
| FR-002 / SC-003 (keys) | T002–T007, T040 |
| FR-003 | T005, waves (interpolated entries) |
| FR-004 | T002 |
| FR-005 / SC-007 | T002, T050 |
| FR-006 / SC-004 | T010, T011 |
| FR-007 / SC-003 (codes) | T013, T016 |
| FR-008 | T013, T014, T017 |
| FR-009 / SC-005 | T014, T017, T018 |
| FR-010, FR-011 | T014, T015, T016 |
| FR-012 / SC-002 | T021, T051 |
| FR-013 / SC-006 | T031, T039 |
| FR-014 | T012, waves, T040 |
