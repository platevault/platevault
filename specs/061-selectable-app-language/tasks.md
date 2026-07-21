# Tasks: Selectable Application Language

**Feature**: 061-selectable-app-language | **Date**: 2026-07-20
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Grouped by independently testable user story. Phase 0 is a shared prerequisite
because its failure mode is invisible downstream (research D8).

`[P]` = parallelisable with siblings in the same group.

---

## Phase 0 — Settings key registration *(prerequisite, blocks everything)*

Ordered first because `settings_update` returns `Ok` for an unregistered key
and silently persists nothing. Any UI built before this appears to work and
loses the preference on restart.

- **T001** Register a `locale` descriptor in `crates/app/settings/src/keys.rs`
  so `is_valid_key("locale")` is true. Value validation accepts a BCP-47 tag
  from the shipped set; anything else is rejected.
- **T002** Add the `locale` case to `default_value_for_key` returning the base
  locale, so a store with no stored value answers `en-GB` rather than empty.
- **T003** Unit test in `crates/app/settings/src/tests.rs`: `is_valid_key`
  accepts `locale`; an unshipped tag is rejected.
- **T004** **Layer-1 round-trip test** (`crates/app/core/tests/`): write
  `locale` via the real settings use case against real SQLite, drop the
  handle, reopen, read it back. This is the gate — it must assert the *stored
  value*, never that the command returned `Ok`, which it does either way.

**Exit**: T004 green. Until then no frontend task may start.

---

## Phase 1 — Locale runtime (blocks US1, US2, US3)

- **T005** Add `pt-BR` to `project.inlang/settings.json` `locales`; set
  `baseLocale` to `en-GB` and rename `messages/en.json` → `messages/en-GB.json`
  in line with FR-001. Verify `pathPattern` still resolves.
- **T006** Change `vite.config.ts` strategy from `["baseLocale"]` to
  `["custom-almSettings", "preferredLanguage", "baseLocale"]`. Update the
  stale comment there that states English is hard-pinned per 046 FR-004.
- **T007** Implement the custom strategy (`defineCustomClientStrategy`,
  registered before first runtime use): synchronous `getLocale` from the
  localStorage mirror; async `setLocale` writing settings DB **and** mirror.
  Mirrors `apps/desktop/src/data/theme.ts`.
- **T008** Locale provider holding locale in React state; `changeLocale()`
  calls `setLocale(next, { reload: false })` then updates state to re-render
  the subtree. **`reload: false` is mandatory** (research D2).
- **T009** Startup hydration: read `locale` from the settings DB on mount; if
  it disagrees with the mirror, the DB wins and the mirror is corrected.
- **T010** [P] Locale metadata module: BCP-47 tag → native name + flag
  (`en-GB` → `🇬🇧 English (UK)`, `pt-BR` → `🇧🇷 Português (Brasil)`).
  Accessible name derives from the native name, never the flag (research D6).
- **T011** [P] Update `src/lib/i18n.ts` doc comment — it currently states
  English is hard-pinned with no switcher, which this feature supersedes.
- **T012** Unit tests: strategy precedence order; DB-wins reconciliation;
  missing key falls back to base locale without emitting a raw key.

**Exit**: locale changes re-render with no reload; choice survives restart.

---

## Phase 2 — US2: Change language later (P2)

Independently testable: ships value even if the wizard step does not exist.

- **T013** Language control in Settings → Appearance, matching the existing
  theme/density controls. Renders flag + native name per option (FR-007).
- **T014** Keyboard operability and assistive-technology naming: current
  selection exposed; options reachable and selectable by keyboard (FR-008).
- **T015** **Layer-2 E2E**: change language in Settings → UI re-renders live;
  scroll position and open panels survive (guards research D2); restart the
  app → choice persists (**guards D8** — the only check that catches a
  silently-dropped settings key).
- **T016** Amend **J10** (settings/appearance/i18n): new language control; the
  "fully localized" claim shifts from *no hardcoded strings* to *translated
  into a chosen language*. Add a delta entry.

---

## Phase 3 — US1: Choose a language before anything else (P1)

- **T017** Insert the language step as the wizard's first step, ahead of all
  existing steps. Existing step numbering shifts — update any step-count or
  progress copy that hardcodes a total.
- **T018** Scrollable card panel; keyboard-navigable including options below
  the fold (spec edge case).
- **T019** Selecting a language re-renders the wizard itself immediately,
  without losing wizard state.
- **T020** Back-navigation returns to the language step so a mistaken choice
  is recoverable without completing setup (US1 scenario 5, research D9).
- **T021** **Layer-2 E2E**: first run → select Português (Brasil) → every
  subsequent wizard step renders in Portuguese → completing setup opens the
  app in Portuguese.
- **T022** Amend **J01** (first-run setup): new first step, shifted numbering,
  back-navigation expectation. Add a delta entry.

---

## Phase 4 — US3: pt-BR catalog (P3)

- **T023** Generate `messages/pt-BR.json` covering all 1856 keys.
- **T024** Plural forms for the 30 keys interpolating `{count}` — singular is
  not free (`'{count} item'` vs `'{count} itens'`).
- **T025** Context-correct divergence for the 98 shared-value keys. `Archive`
  is the known case: `verb_archive` → *Arquivar*, `projects_lifecycle_archive`
  → *Arquivo*. **Do not consolidate keys on matching English** (FR-012).
- **T026** Review-status metadata marking pt-BR machine-generated pending
  native review (FR-013).
- **T027** Layout check at 1100×720 — Portuguese runs longer than English;
  confirm no clipping or overlap on the densest screens.
- **T028** Verify counts render correctly at 0, 1, and many in both locales
  (SC-006).

---

## Phase 5 — Drift guard

- **T029** CI check comparing key sets across locales. **Reports** the gap;
  does not fail the build — FR-013 accepts partial translation as a shipping
  state (research D5).
- **T030** Coverage-matrix update: add a row for 061; update the 046 row from
  single-locale to multi-locale.

---

## Dependency graph

```
T001 ─→ T002 ─→ T003 ─┐
                      ├─→ T004 (Layer-1 gate) ═══╗
                      ┘                          ║  blocks ALL frontend work
                                                 ║
        T005 ─→ T006 ─→ T007 ─→ T008 ─→ T009 ←═══╝
                          │       │
                 T010 [P] ┤       ├─→ T012
                 T011 [P] ┘       │
                                  ├─→ T013 ─→ T014 ─→ T015 ─→ T016   (US2)
                                  │
                                  └─→ T017 ─→ T018 ─→ T019 ─→ T020
                                                        └─→ T021 ─→ T022  (US1)

        T023 ─→ T024 ─→ T025 ─→ T026 ─→ T027 ─→ T028   (US3, needs T005)

        T029, T030 ─ after T023 exists
```

**Critical path**: T001→T004→T007→T008→T017→T021.

**Parallelisable**: T010/T011 alongside T008. US2 (T013–T016) and US1
(T017–T022) are independent once Phase 1 lands and may run concurrently — in
separate worktrees if worked by different agents, since both touch the locale
provider's consumers.

US3 (T023–T028) needs only T005, so translation can proceed in parallel with
all UI work.

## Definition of done

- All acceptance scenarios in spec.md pass.
- SC-002 verified by real restart on Windows and Linux, not mock mode.
- `just lint`, `just test`, `just typecheck` green.
- J01 and J10 amended with delta entries.
- Coverage matrix updated.
