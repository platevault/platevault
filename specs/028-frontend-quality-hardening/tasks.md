# Tasks: Frontend Quality Hardening (Spec 028)

**Derived from**: spec.md | **Plan**: plan.md | **Generated**: 2026-06-11

Legend: [x] done-by-prior-work | [i] implemented this spec | [ ] deferred

---

## Group A — URL State & Router Contracts (from spec 020)

Dependency: none

- [x] **A1** Typed `RouteContract` per route with `validateSearch`/`parseSearch` helpers
  — DONE-BY-PRIOR-WORK: `src/lib/route-contract.ts` implements `makeValidateSearch`,
  `parseNumber`, `parseString`, `parseEnum`, `parseCsvEnum`; all routes use it.
- [x] **A2** `useSearch` / `useNavigate` refactors replacing ad-hoc URL manipulation
  — DONE-BY-PRIOR-WORK: all pages use `useSearch({ from: '/shell/...' })` and
  `useNavigate({ from: ... })` via TanStack Router typed hooks.
- [x] **A3** Deep-link resolution for entity refs (`?selected=session:uuid`)
  — DONE-BY-PRIOR-WORK: `/sessions/$id`, `/targets/$id`, `/calibration/$id`,
  `/projects/$id` all have `beforeLoad` redirects; tested in smoke suite.
- [x] **A4** Back-button and browser-history state correctness
  — DONE-BY-PRIOR-WORK: hash history; stale-id cleanup uses `replace: true`;
  `useStaleSelectionCleanup` covered by `use-stale-selection.test.tsx`.
- [x] **A5** Vitest coverage for route redirects, search parsing, unknown-route fallthrough
  — DONE-BY-PRIOR-WORK: `route-contract.test.ts` covers parsers (T050/T051/T054);
  unknown-route fallthrough tested via `router.defaultNotFoundComponent`.

---

## Group B — Design System Quality (from spec 022)

Dependency: none (independent of A/C/D)

- [x] **B1** Token completeness audit: every color/spacing/radius/shadow/motion in
  `components.css` references a `tokens.css` variable
  — DONE-BY-PRIOR-WORK: `components.css` has a policy comment (spec 022 T011)
  and inspection shows only correct `--alm-*` tokens in the CSS layer.
- [i] **B2** Fix broken/legacy inline token refs in component TSX files
  — Approximately 30 occurrences of `--alm-color-*`, `--mantine-color-*`,
  `--alm-error` in inline styles across 9 files. These are non-existent tokens
  (runtime CSS fallbacks apply, so visible only as degraded styling). Fixed by
  mapping to the correct `--alm-*` tokens. See plan.md token mapping table.
  Files: `ProjectDetail.tsx`, `ProjectsList.tsx`, `ManifestsAccordion.tsx`,
  `ProjectNotesSection.tsx`, `ToolLaunchesAccordion.tsx`, `ActionSidebar.tsx`,
  `InboxDetail.tsx`, `InboxList.tsx`, `NamingStructure.tsx`.
- [i] **B3** CI grep guard: `scripts/check-tokens.sh` — fail on raw hex in
  `components.css`, raw `ms` in `components.css`, or legacy/non-ALM token refs
  (`--mantine-*`, `--alm-color-*`, `--alm-error`) in TSX source.
  Wired as `check:tokens` npm script in `apps/desktop/package.json`.
- [i] **B4** TypeScript token type generation (`tokens.d.ts`)
  — `apps/desktop/scripts/gen-token-types.mjs` parses `tokens.css` for every
  `--alm-*` custom-property declaration and emits a sorted, deterministic
  `AlmTokenName` union (+ `AlmTokenVar` template-literal helper) to
  `src/styles/tokens.d.ts`. Wired as `pnpm tokens:types`. Generated file
  committed (79 token names as of this run).
- [x] **B5** Primitive prop audit: every `ui/` primitive accepts `className` and spreads
  remaining props onto root element
  — DONE-BY-PRIOR-WORK: `Btn`, `Pill`, `Box`, `Section`, `KV`, `EmptyState`,
  `Banner`, `Toggle`, `SegControl`, `RadioGroup`, `CoverageBar`, `Lock`,
  `DirPicker`, `WizardShell`, `Table` — all inspected and confirmed.
- [i] **B6** `DESIGN.md` sync: update root `/DESIGN.md` with current token taxonomy
  — Updated §3 "Color tokens" / "Token & class conventions" / "Spacing" only
  (rest of the doc untouched): documents the 4 themes (Warm Clay, Warm Slate,
  Observatory Dark, Espresso Dark) + System, the semantic aliases (`--alm-text`,
  `--alm-border`, `--alm-link`, `--alm-focus-ring`), and the `--alm-sp-*`
  base-4 spacing scale (2/4/8/12/16/24/32/48). Added a note pointing at
  `tokens.css` / `tokens.d.ts` as source of truth.

---

## Group C — Test Coverage (from spec 027)

Dependency: none

- [ ] **C1** Fix React setState-during-render warning in `ProjectDetailPane`
  — NOT-APPLICABLE / OBSOLETE. `ProjectDetailPane` no longer exists — it was
  removed in the spec 043 UI redesign (superseded by `ProjectDetailContent` /
  `ProjectsPage` + `ProjectDetail.tsx`). Re-checked on the current tree: no
  setState-during-render violation exists anywhere in the projects feature.
  `ProjectsPage` uses `useStaleSelectionCleanup` (wraps `navigate` in
  `useEffect`) and `ProjectDetailContent` has no render-phase state updates.
  No fix needed; task is obsolete rather than deferred.
- [i] **C2** Add `AppErrorBoundary` class component at the app shell root
  — Wraps `RouterProvider` in `main.tsx`. Shows a recoverable fallback (reload
  button) on uncaught render errors. Also usable per-route.
  Test: `AppErrorBoundary.test.tsx` — throws in child, asserts fallback mounts.
- [x] **C3** Vitest unit tests for UI primitives and utility modules
  — DONE-BY-PRIOR-WORK: `LogPanel.crosslink.test.tsx`, `LogPanel.followState.test.tsx`,
  `route-contract.test.ts`, `use-stale-selection.test.tsx`, `BlockedBanner.test.tsx`,
  `CalibrationMatchPanel.test.tsx`, `ProjectsList.test.tsx`, etc. — 460 tests total.
- [x] **C4** Component integration tests for critical flows (setup wizard, review queue,
  project wizard)
  — DONE-BY-PRIOR-WORK: `ProjectDetail.lifecycle.test.tsx`,
  `ProjectDetail.manifests.test.tsx`, `ProjectNotesSection.test.tsx`,
  `lifecycle-actions.test.ts`, `artifacts.test.ts`, etc.

---

## Group D — CI & Automation

Dependency: B2 must pass before B3 guard is meaningful

- [i] **D1** `scripts/check-tokens.sh` token guard script
  — see B3. Fails on: raw hex in `components.css`, raw `ms` in `components.css`,
  legacy token namespaces in TSX source.
- [i] **D2** Wire `check:tokens` npm script in `apps/desktop/package.json`
- [i] **D3** Unused export detection with `knip`
  — `knip@6.24.0` added as devDependency. `apps/desktop/knip.json` scopes
  `project` to `src/**/*.{ts,tsx}`, ignores `src/bindings/**` (generated Tauri
  bindings) and the `@tauri-apps/cli` dependency (used only via the `tauri`
  CLI, not imported). Wired as `pnpm knip`. Baseline on this run (NOT acted
  on — the 037 IPC migration is mid-flight and deletions would collide):
  19 unused files, 4 unused dependencies, 1 unresolved import, 135 unused
  exports, 198 unused exported types.
- [i] **D4** Circular import detection with `madge`
  — `madge@8.0.0` added as devDependency. Wired as
  `pnpm madge:circular` (`madge --circular --extensions ts,tsx src`). Run
  result: **no circular dependencies found** (340 files processed).
- [i] **D5** Bundle size baseline and regression guard
  — `size-limit@12.1.0` + `@size-limit/file@12.1.0` added as devDependencies
  (switched from `@size-limit/preset-app` because its Chrome-timing check
  fails to launch headless Chrome in this sandboxed env; `@size-limit/file`
  does pure gzip file-size measurement against the built `dist/` output,
  which is the right fit for a pre-built Vite bundle). Config in
  `apps/desktop/.size-limit.json`, wired as `pnpm size`. Real `vite build`
  baseline captured (`pnpm build`, no Tauri/cargo build involved):
  - all `dist/assets/*.js`, gzip: **393.58 kB** (limit set to 480 KB, ~22% headroom)
  - largest chunk `dist/assets/index-*.js`, gzip: **218.14 kB** (limit set to
    260 KB, ~19% headroom)
- [i] **D6** ESLint flat config for `apps/desktop/` (TypeScript + React rules)
  — `eslint.config.js` with `@eslint/js`, `typescript-eslint`,
  `eslint-plugin-react-hooks`. Wire `lint:eslint` script. Fix any errors found
  in app source (not generated bindings or archived source).

---

## Implementation order

1. D6 ESLint setup (so we can lint while fixing)
2. B2 Fix broken token refs (fixes underlying quality debt)
3. B3+D1+D2 Token guard script (validates B2 fix)
4. C2 Error boundary + test
5. Verify: `pnpm test`, typecheck, eslint, check:tokens all pass

---

## Deferred / not-applicable items summary

| ID | Item | Status |
|----|------|--------|
| C1 | setState-during-render fix | NOT-APPLICABLE/OBSOLETE — `ProjectDetailPane` removed in spec 043 redesign; no violation found on current tree |

B4, B6, D3, D4, D5 were implemented in this pass (see entries above); they are
no longer deferred. D3's `knip` and D4's `madge` findings are established as a
baseline only — no unused-export/file deletions were made, since the spec 037
IPC migration is mid-flight and deletions could collide with in-progress work.
