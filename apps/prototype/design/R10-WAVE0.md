# Round 10 · Wave 0 notes

Wave 0 of `design/R9-COMPOSITION-PLAN.md` §7.1 (bead astro-plan-3it3p). The census and lint counts are in `design/R10-CENSUS-BASELINE.json`.

## W0.2 Base commit and freeze

- **Base:** `7d1cc820e205f95daa3184444da8cd0803e6c92d` on `ui-harness-v5`, after W0.1 merged the R9 fix branches. Every W1 and W2 worktree is cut from this commit (FO-6).
- **Frozen** until the wave that owns them: `components/**`, `app/shell.tsx`, `routes.tsx`, `domain/types.ts` and `messages/*.json`. Feature files stay frozen through W1 and W2. In W3 each page unit owns its whole feature directory.
- **Owners** (plan §7.7). Anyone else who needs a change to one of these files messages its owner.

| Component / file | W1 owner | Owner from W3 |
|---|---|---|
| Tokens, `themes.mjs`, `index.css`, `themes.css` | U1 | lead |
| `button.tsx`, `actions.tsx`, `row-actions.tsx` | U2 | lead |
| `data-table.tsx`, `ui/table.tsx`, `filter-bar.tsx`, `data.tsx` | U3 | lead |
| `refusal.tsx`, `feedback.tsx`, `pill.tsx`, `status.tsx`, `tips.tsx`, `hover-card.tsx`, `toast.tsx`, `previews.tsx` | U4 | lead |
| `confirm-dialog.tsx`, `form-dialog.tsx`, `ui/dialog.tsx`, `ui/alert-dialog.tsx` | U5 | lead |
| `fields.tsx`, `settings.tsx`, `folder-picker.tsx` | U6 | lead |
| `step-flow.tsx` | U7 | lead |
| `pickers.tsx`, `display-menu.tsx`, `components/domain/*` | U8 | lead (domain visuals: P4 for review visuals, P7 for planning visuals, by message) |
| `components/templates/*`, `page.tsx`, `box.tsx` | U9 | lead |
| `nav-list.tsx`, `checklist.tsx`, `issue-row.tsx`, `theme-picker.tsx` | U10 | P1 |
| `contracts.ts`, `routes.tsx`, `app/catalogue/registry.ts`, `messages/*.json` merge | lead | lead |
| `domain/*`, `store/*` | U11 / U12 | lead |
| `eslint.composition.config.js`, `scripts/{report-composition-lint,check-copy,check-catalogue}.mjs`, `scripts/census.browser.js`, `design/R10-CENSUS-BASELINE.json` | lead | lead |

## W0.3 Contracts

`src/components/app/contracts.ts` holds the types only: `Action`, `ActionKind`, `MenuItem`, `Blocker`, `ConfirmSpec`, `FlowStep`, `StepFlow`, `Facet`, `Preset`, `FileRow` and `Column`. Nothing imports the file yet.

- `Blocker` and `Column` still live in `refusal.tsx` and `data-table.tsx`. U4 and U3 switch those files to the contracts and delete their local copies, with no re-export.
- `Column` adds `static` (P4). `sortValue` stays optional until W4.
- Two shapes have no sketch in the plan, so W0 derived them:
  - `ConfirmSpec` is the P8 `ConfirmDialog` props without `onConfirm`.
  - `Preset` is `{ id, label, source, unavailable? }`. It covers the Targets presets, built-in and saved (`targets-model.ts` `PresetDef`, `presetUnavailable`). The host applies a preset, so its filter values stay with the host.
- `Action.icon` is a `LucideIcon`, as P1 sketches it. This is the one non-`ReactNode` React type in the file, so §3.6 portability has one exception.

## W0.4 Enforcement, report mode

**Where the rules run.** The §8.1 and §8.2 rules live in `eslint.composition.config.js`. That file extends `eslint.config.js` and adds core `no-restricted-syntax` and `no-restricted-imports` blocks at `warn`. The gate (`eslint --max-warnings 0 src/`) reads only `eslint.config.js`, so it never sees these warnings. `pnpm lint:composition` (`scripts/report-composition-lint.mjs`) prints the count per rule and area, next to the baseline. It fails only when ESLint reports something other than a composition warning.

**Disable comments.** Until W4 nothing in `src/` may carry an `eslint-disable … no-restricted-syntax` comment, including the L7 `-- help:` form. The gate does not run that rule, and `reportUnusedDisableDirectives: "error"` reports the comment as unused. W4 moves the blocks into `eslint.config.js` as `error`, and kept HelpTips get their reasons then.

**Scope.** The rules cover `src/features/**` and `src/app/**`. Exempt are the i18n ignores (the simulation panel, the Prototype controls, the reference page, the seed and tests) plus `src/app/catalogue/**`. The import rules (§8.2) cover their globs.

**Where the selectors differ from §8.1.** W0 checked each selector against the code before switching it on.

- **L6.** `title` also counts on the components that pass it through to the DOM: `Button`, `Link`, `Pill`, `Badge`, `Toggle`, `ToggleGroupItem` and `TabsTrigger`. An element whose classes truncate it (`truncate`, `line-clamp-*`) is exempt. Heading props such as `PageHeader title` are not tooltips and do not count.
- **L8.** A size behind a variant prefix (`md:w-[…]`) also counts.
- **L2.** Every `pillClass` call counts, because W4 removes the public `pillClass`.
- **I6.** The plan's `["@/features/**", "!@/features/<area>/**"]` cannot work: a gitignore negation cannot re-include a path whose parent is excluded, so it flagged the area's own imports. A lookahead regex replaces it, plus a regex for relative paths that climb out of the area (`../d-review/review`).
- **L11 is new**, from the W0 brief: no feature-local `*Button`, `*Menu` or `*RowActions` components (the P1 and P2 delete lists).

**Counts** at the base, which W0's own stubs leave unchanged:

| Rule | Total | features | app |
|---|---|---|---|
| L1 raw interactive or table markup | 219 | 218 | 1 |
| L2 pill as a control | 17 | 17 | 0 |
| L3 restyled shared component | 71 | 55 | 16 |
| L4 secondary variant or a removed size | 17 | 13 | 4 |
| L5 `SheetContent` | 9 | 8 | 1 |
| L6 `title=` tooltip | 111 | 97 | 14 |
| L7 HelpTip | 22 | 22 | 0 |
| L8 arbitrary size | 109 | 98 | 11 |
| L9 inline style | 9 | 8 | 1 |
| L10 layout class on a plain element | 1160 | 1039 | 121 |
| L11 local Button or Menu wrapper | 15 | 11 | 4 |
| I1–I4 component boundaries, Base UI in features | 0 | – | – |
| I5 features import `components/ui` | 190 | 190 | – |
| I6 cross-feature import | 57 | 57 | – |

**Copy lint.** `scripts/check-copy.mjs` (§6.4) now runs at the end of `pnpm lint:i18n` and only reports. Its findings: slop-word 1, prototype-word 36, title-case 1, label-period 1, button-length 0, ellipsis 36. `--list <check>` names the keys, and `--enforce` makes it fail (from W4).

**Catalogue.** `pnpm lint:catalogue` (`scripts/check-catalogue.mjs`, §8.3) only reports. Of 207 component exports, 38 are catalogued in `app/design-system-page.tsx`. That page is the catalogue until `app/catalogue/registry.ts` exists. `--list` names the missing exports, and `--enforce` makes it fail (from W4).

**Census.** `scripts/census.browser.js` measures one route: run its text in the page with the browser tool. It reads a Button's variant and size, and whether DataTable rendered a table, from React's dev fibers, so it needs the Vite dev build. The baseline covers 44 routes at 1440 px in `#main`: the §4a list, the setup routes and the four stubs. Every route loaded with 0 page errors and no sideways scroll. Where the routes match, the numbers agree with §4a, for example Home 22/5 · 2/0 · 6/9 · 32, `/projects` 4/2 · 1/0 · 4/5 · 6, and the run Review step 13/7 · 70 ttl · 8 tip. Run the census again after each wave and compare against the baseline.

## W0.5 Route stubs

Each stub renders a `PageHeader` with a placeholder title and nothing else. Each sits in the feature area whose W3 unit fills it, so no page unit edits `routes.tsx`.

| Route | Component (file) | Title key |
|---|---|---|
| `/import?step=` | `ImportFlowPage` (`features/v5/a-home/import-flow.tsx`) | `import_flow_title` |
| `/sessions/$sessionId?step=` | `SessionIntakePage` (`features/v5/a-home/session-intake.tsx`) | `session_intake_title` |
| `/calibration/processes/$processId/$step` | `CalibrationProcessPage` (`features/v5/e-targets-plan-settings/calibration-process.tsx`) | `calibration_process_title` |
| `/settings/help` | `HelpPage` (`features/t1/settings/help-page.tsx`), a Settings child, not yet in the section menu | `settings_help` |

`routes.tsx` sends `?step=` to the flow component (`stepFlowOr`). Without `step`, `/import` and `/sessions/$sessionId` render as before.

## Gate

Every prototype unit runs these in `apps/prototype` before it delivers:

- `pnpm i18n:compile`
- `node_modules/.bin/tsc -p tsconfig.json --noEmit --incremental false` (`src/` and `.storybook/`)
- `node_modules/.bin/tsc -p tsconfig.node.json --noEmit` (`vite.config.ts`, `vitest.config.ts`, `vitest.globalSetup.ts`)
- `node_modules/.bin/eslint --max-warnings 0 src/`
- `node scripts/check-i18n-catalog.mjs`
- `node scripts/check-i18n-locale-drift.mjs`
- `node scripts/check-copy.mjs`
- `pnpm test`: the L2 contract tests (C12).
- `pnpm build-storybook`: the catalogue as stories (C12).
- `pnpm lint:composition`: report the deltas for your files; your files add no new warning.

**Tests (C12).** Vitest with Testing Library on jsdom, which is where Base UI runs its own suite, so its portals, focus management and pointer handling are proven there. `vitest.globalSetup.ts` runs `pnpm i18n:compile` once per run, and `src/test/setup.ts` sets the en-GB locale. Tests sit next to their component as `*.test.tsx` and find controls by role and catalogue copy (`m.verb_cancel()`). They test consumer-visible behaviour only: order, focus, keys, ARIA. `pnpm test` runs them once, and `pnpm test:watch` keeps vitest watching.

**Storybook (C12).** `pnpm storybook` (dev, port 6180) and `pnpm build-storybook` (static, `storybook-static/`). There is one story per `CATALOGUE` entry: `app/catalogue/<id>.stories.tsx` renders the registered entry component, so the demos exist once. `app/catalogue/stories.test.ts` fails when an entry has no story, so register an entry together with its story file. The toolbar switches the language (en-GB, pt-BR) and the theme through `setLocale` and `setTheme` in `app/preferences.ts`.
