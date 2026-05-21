---
description: "Task list for the desktop prototype design system (Base UI + tokens)"
---

# Tasks: Desktop Prototype Design System

**Input**: Design documents from `/specs/022-mantine-prototype-design-system/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/theme.get.json`, `contracts/theme.set.json`

**Tests**: Tests are OPTIONAL. The mockup is the source of truth for v1; future test tasks are marked optional and may be deferred.

**Mockup status**: A working mockup of this design system already exists under `apps/desktop/src/ui/`, `apps/desktop/src/styles/`, and `apps/desktop/src/app/theme.tsx`. Tasks below that map to existing mockup work are marked `[mockup-done]`. Remaining tasks formalize contracts, audits, and documentation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1..US4)
- **[mockup-done]**: Already implemented in the current desktop mockup; the task remains for traceability and review

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [mockup-done] Confirm `@base-ui-components/react`, `cmdk`, `react-resizable-panels`, `@tanstack/react-table`, and `@tanstack/react-router` are pinned in `apps/desktop/package.json`.
- [x] T002 [mockup-done] Confirm `apps/desktop/src/styles/reset.css` is loaded before `tokens.css` and `components.css` from the desktop entry.
- [ ] T003 [P] Verify no Tailwind, Mantine, or shadcn/ui dependencies are present (repo grep: `mantine`, `tailwind`, `shadcn`, `styled-components`). Document the audit in this spec's `research.md` if any are found.

---

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T004 [mockup-done] [US1] `apps/desktop/src/styles/tokens.css` declares all token categories from `data-model.md` (color, typography, spacing, density, radius, shadow, timing, z-index, shell metrics) with light, dark, and system-mode-dark scopes.
- [x] T005 [mockup-done] [US1] `apps/desktop/src/styles/components.css` exists and is the single home for `alm-*`-prefixed component rules.
- [x] T006 [mockup-done] [US4] `apps/desktop/src/app/theme.tsx` exposes `ThemeProvider`, `useTheme`, and the `ThemeMode` type, persists to `localStorage` under `alm.theme`, and reacts to OS appearance changes while mode is `system`.

**Checkpoint**: Foundation ready — primitive and page work can proceed.

---

## Phase 3: User Story 1 — Single Design Token Source (Priority: P1) 🎯 MVP

**Goal**: Every component visual decision resolves to a token in `tokens.css`.

**Independent Test**: Grep `apps/desktop/src/styles/components.css` for hardcoded hex codes, raw `px` values outside token definitions, and raw `ms` durations. Confirm exceptions are documented inline.

- [x] T010 [mockup-done] [US1] Author the token vocabulary in `apps/desktop/src/styles/tokens.css`.
- [ ] T011 [US1] Audit `apps/desktop/src/styles/components.css` to ensure every color, spacing, radius, shadow, and motion duration references a token. Document any justified exception inline with a comment.
- [ ] T012 [P] [US1] (Optional) Add a CI grep guard that fails the build if `components.css` introduces a hex color, raw px (outside token blocks), or raw ms value.
- [ ] T013 [P] [US1] (Optional) Generate `apps/desktop/src/styles/tokens.d.ts` (or `tokens.ts`) so TypeScript can autocomplete token names. Deferred until the domain question in `spec.md` is resolved.

**Checkpoint**: Token system is the single source of truth.

---

## Phase 4: User Story 2 — Headless Primitive Library (Priority: P2)

**Goal**: A complete primitive library under `apps/desktop/src/ui/` that wraps Base UI / cmdk / react-resizable-panels.

**Independent Test**: List `apps/desktop/src/ui/`; confirm each primitive imports a headless library where applicable, exposes `className`, and has a matching block in `components.css`.

- [x] T020 [mockup-done] [P] [US2] `Button`, `IconButton`, `Badge`, `StateLabel`, `EmptyState`, `PageHeader`, `Filters`, `Stepper`, `TextInput` use semantic elements + `alm-*` CSS.
- [x] T021 [mockup-done] [P] [US2] `Menu`, `Dialog`, `Tooltip`, `Accordion`, `Select`, `Switch` wrap Base UI primitives.
- [x] T022 [mockup-done] [US2] `CommandPalette` composes `cmdk` inside a Base UI dialog.
- [x] T023 [mockup-done] [US2] `DockedDrawer`/`DrawerShell` compose `react-resizable-panels` with `alm-drawer-*` visuals respecting `--drawer-min-w`/`-default-w`/`-max-w`.
- [x] T024 [mockup-done] [US2] `DataTable` renders `@tanstack/react-table` state through `alm-table-*` CSS.
- [x] T025 [mockup-done] [US2] `LogPanel` and `TokenPattern` host their feature surfaces (spec 019, spec 015) within the primitive vocabulary.
- [x] T026 [mockup-done] [US2] `apps/desktop/src/ui/index.ts` re-exports the public primitive API.
- [ ] T027 [US2] Verify every primitive accepts `className` and spreads remaining props onto its root element. Patch any primitive that violates the rule.
- [ ] T028 [P] [US2] (Optional) Add Vitest unit tests asserting that each primitive forwards `className` and `ref` to its root element.

**Checkpoint**: Feature pages can compose the primitive library without re-deriving accessibility.

---

## Phase 5: User Story 3 — Composable Component Vocabulary (Priority: P3)

**Goal**: Ledger pages compose primitives instead of inventing layout markup.

**Independent Test**: Open Inventory, Inbox, Projects, and Plans pages; each uses `PageHeader`, `Filters`, `DataTable`, and `DockedDrawer`/`DrawerShell` (where applicable).

- [x] T030 [mockup-done] [US3] Ledger pages adopt the page-shell composition.
- [ ] T031 [US3] Audit feature pages for ad-hoc layout markup that should be replaced by a primitive. Either extract the markup into a new primitive in `ui/` or refactor the page to use existing primitives.
- [ ] T032 [P] [US3] Write `DESIGN.md` per FR-015. Cover token taxonomy (link to `data-model.md`), primitive vocabulary, page composition rules, and the headless-library policy. Location to be resolved per the domain question in `spec.md` (default: `apps/desktop/DESIGN.md`).

**Checkpoint**: Pages follow one composition rulebook.

---

## Phase 6: User Story 4 — Theme Mode Switching (Priority: P4)

**Goal**: Users can switch between system / light / dark; the choice persists and reacts to OS changes.

**Independent Test**: In Playwright MCP, toggle the mode in Settings and reload; confirm `:root[data-theme]` reflects the chosen mode and persists.

- [x] T040 [mockup-done] [US4] `ThemeProvider` implements the resolution and persistence behavior described in `plan.md` and `data-model.md`.
- [ ] T041 [US4] Mirror `contracts/theme.get.json` and `contracts/theme.set.json` into `packages/contracts/theme/`.
- [ ] T042 [P] [US4] Wire the Settings page's theme toggle to call a thin adapter that satisfies the `theme.get`/`theme.set` contract shape, even though the implementation is local (so the desktop boundary already speaks the contract).
- [ ] T043 [P] [US4] (Optional) Implement `crates/app/core/usecases/theme.rs` as a stub that returns the persisted mode when a backend exists. Not required for v1.
- [ ] T044 [P] [US4] (Optional) Playwright MCP smoke: toggle each mode, reload, confirm `data-theme` and the visual change. May be added as part of the broader desktop test suite.

**Checkpoint**: Theme mode is observable, persistent, and contract-described.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T050 [P] Document the supersession of the Mantine direction in the project changelog (or equivalent) so historical references resolve.
- [ ] T051 [P] Update `PRODUCT.md` and other docs that still reference Mantine to point to this spec.
- [ ] T052 Run `just lint` and `just typecheck` to confirm no Mantine or Tailwind imports survive.
- [ ] T053 Visual regression spot check: open each ledger page in light and dark and confirm no token misses (regions that fail to swap).

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph]
T001 = { blocked_by = [] }
T002 = { blocked_by = [] }
T003 = { blocked_by = [] }
T004 = { blocked_by = ["T001", "T002"] }
T005 = { blocked_by = ["T002"] }
T006 = { blocked_by = ["T001"] }
T010 = { blocked_by = ["T004"] }
T011 = { blocked_by = ["T004", "T005"] }
T012 = { blocked_by = ["T011"] }
T013 = { blocked_by = ["T010"] }
T020 = { blocked_by = ["T004", "T005"] }
T021 = { blocked_by = ["T004", "T005"] }
T022 = { blocked_by = ["T021"] }
T023 = { blocked_by = ["T004", "T005"] }
T024 = { blocked_by = ["T004", "T005"] }
T025 = { blocked_by = ["T020", "T023"] }
T026 = { blocked_by = ["T020", "T021", "T022", "T023", "T024", "T025"] }
T027 = { blocked_by = ["T026"] }
T028 = { blocked_by = ["T026"] }
T030 = { blocked_by = ["T026"] }
T031 = { blocked_by = ["T030"] }
T032 = { blocked_by = ["T026", "T010"] }
T040 = { blocked_by = ["T006"] }
T041 = { blocked_by = [] }
T042 = { blocked_by = ["T041", "T040"] }
T043 = { blocked_by = ["T041"] }
T044 = { blocked_by = ["T040"] }
T050 = { blocked_by = ["T032"] }
T051 = { blocked_by = ["T032"] }
T052 = { blocked_by = ["T003", "T026"] }
T053 = { blocked_by = ["T030"] }
```

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup.
- **US1 (Phase 3)**: depends on Foundational.
- **US2 (Phase 4)**: depends on Foundational; partially overlaps US1 once tokens are in place.
- **US3 (Phase 5)**: depends on US2 primitives.
- **US4 (Phase 6)**: depends on Foundational (theme provider) and is independent of US3.
- **Polish (Phase 7)**: depends on US2/US3/US4 outcomes.

### Within Each User Story

- Token additions precede component CSS additions that consume them.
- Primitive APIs (Phase 4 T020–T026) precede page composition audits (Phase 5 T031).
- Contract mirroring (T041) precedes the contract-shaped adapter in T042.

### Parallel Opportunities

- T012 and T013 can run in parallel once T011 is done.
- T020, T021, T023, T024 can run in parallel (different files).
- T028 (optional primitive tests) runs in parallel with anything in Phase 5.
- T041, T042, T043, T044 are largely parallelizable within US4.

---

## Implementation Strategy

### MVP First (US1 + US2)

The token system plus the primitive library is the minimum that
unlocks every other spec's desktop work. US1 and US2 are both
"mockup-done" today; the remaining work is auditing and contract
mirroring.

### Incremental Delivery

1. Phase 1–2: confirm setup and foundational pieces (mostly done).
2. Phase 3: audit + optional CI guards.
3. Phase 4: complete primitive audit + optional tests.
4. Phase 5: compose-vocabulary audit + DESIGN.md.
5. Phase 6: contract mirroring and theme toggle adapter.
6. Phase 7: polish.

### Parallel Team Strategy

US3 and US4 can be picked up by different contributors once US1/US2
are signed off. The contract files (Phase 6) are independent of
US3 work.

---

## Notes

- The mockup is authoritative for v1 visual decisions; this spec
  formalizes the rules behind it.
- Avoid introducing new dependencies during these tasks; if a need
  arises, file a research addendum in `research.md` first.
- DESIGN.md location is deferred (see `spec.md` domain questions);
  pick `apps/desktop/DESIGN.md` as the default until the broader
  documentation pass decides.
