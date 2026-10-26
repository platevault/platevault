# Desktop UI foundation checkpoint

The `@platevault/desktop-ui` package supplies the foundation for frontend feature work. This checkpoint uses the component catalogue merge on `main`. The table lists the immutable source merges.

## Immutable inputs

| Input | Merge SHA | Provides |
|---|---|---|
| #1892, desktop UI bootstrap | `a12c75a98c3947baeb9d15b0142086228cfe0261` | Package build with Vite and React. Test and typecheck setup. Lint entry points. |
| #1894, tokens | `f09fbc69e9c966f342783b30ac36782e5b17fb5b` | DTCG sources and theme generation. Contrast checks and the system UI font stack. Typography, spacing, geometry and colour tokens. |
| #1895, gates | `9e3b1866fcf4669b38e522586edc994f5cbcc057` | Error-level composition, import and copy rules. Catalogue and locale gates, census budgets, and rule tests. |
| #1893, runtime and IPC | `cd0e9be2528a2962f5b49dad9eba8753ca88d350` | `src/api` owns the generated client. It exports `ActionResult` and structured library failures. It also exports typed events and real runtime integration contracts. |
| #1896, component catalogue | `e67788fe5306adcd701a0e2c4a5f72a6b399c202` | Shared catalogue and stories. Both locales. Component behaviour and accessibility coverage. Feature-facing composition patterns. |

## Contracts for feature workers

### Actions and library results

The `src/api/ipc.ts` module header states that all frontend library calls pass through this boundary. The `library.<command>(...args)` call resolves to an `ActionResult`; it does not reject. `Action.run` returns that result unchanged. The failure has `source: "library"` for a structured library answer or `source: "ipc"` for transport and decoding failures. See `apps/desktop-ui/src/api/ipc.ts:1-36,65-81`.

For library errors, the `error.code` selects the active catalogue message. The UI never displays IPC `detail`. `apps/desktop-ui/src/components/app/run-result.ts:1-17,52-82` defines these display rules. `apps/desktop-ui/src/components/app/contracts.ts` defines `Action`. Existing hosts in `components/app/actions.tsx` render Actions as buttons, menu items, row actions, context-menu items and palette commands. Do not add a second runner or import the generated client directly. I7 reserves that client import for `src/api`.

### Components and catalogue

Reuse primitives and patterns from `src/components/ui`, `src/components/app`, `src/components/domain` and `src/components/templates`. Components read copy through `useMessages()` so they update when the locale changes. See `src/app/preferences.ts` and `src/lib/i18n.ts`.

`src/app/catalogue/registry.ts` is the component registry. Entry modules live in `src/app/catalogue/`. The `scripts/check-catalogue.mjs` gate checks that the registry covers each exported component name. Entries use the existing specimen patterns to show component variants and states. Stories live beside the entries. `src/test/catalogue.a11y.test.tsx` runs axe for each registered entry. Add entries through this registry, not through a second catalogue.

### Routes and injection

This checkpoint has no production router or route-injection API. `src/App.tsx` renders only the package name; `src/main.tsx` mounts `App`. Existing memory routers appear in tests only.

The route owner is bead `astro-plan-iczs2`, “Build the real library frontend shell and route composition”. It owns `apps/desktop-ui/src/main.tsx`, `routes.tsx` and app composition. Its scope assigns SessionReview injection to the router. Feature workers expose their screen contracts for that owner to compose. They must not create a parallel router.

### Data columns and census

`DataTable` marks selection, static and action headers with `data-column-kind`. Ordinary data headers stay unmarked or use `data`. Each data header must sort. The census counts the data headers described in `scripts/census.browser.js:19-21,61-64`. `src/components/app/data-table.test.tsx:74-89` checks the markers. `scripts/census.mjs:26-28` checks sortability. Do not mark a data column as static to avoid the sort contract.

### Lint, locales and imports

Run `pnpm lint` to invoke ESLint, copy checks, locale parity and catalogue completeness. `apps/desktop-ui/eslint.config.js` enables the composition rules in `apps/desktop-ui/eslint-rules/composition.js` at error level. I1-I7 include component-layer rules. I7 limits Tauri APIs and the generated client to `src/api`. It permits only the `library-index` generated-client escape from that boundary. It also rejects legacy bindings and mocks in runtime code, and package-escaping imports.

`project.inlang/settings.json` configures `en-GB` and `pt-BR`. Add visible copy to both locales. Keep the locale and copy gates enabled.

## Check results

The commands below ran in `apps/desktop-ui` at input head `e67788fe5306adcd701a0e2c4a5f72a6b399c202`, before the checkpoint changes.

| Command | Result |
|---|---|
| `pnpm lint` | PASS. ESLint passed. Catalogue lint passed. Locale parity: 3352 keys per locale. Copy lint: 0 findings. Directive checks passed. Catalogue: 264/264 exports registered. |
| `pnpm typecheck` | PASS. Paraglide compilation, package TypeScript check and Node TypeScript check completed. |
| `pnpm test` | PASS. 51/51 test files and 328/328 tests passed in two consecutive full runs. An earlier run failed the Columns menu keyboard test in `src/components/app/data-table.test.tsx`, which pressed ArrowDown before the menu focused its first item. The test now waits for that focus. |
| `pnpm build` | PASS. Production Vite build completed. |
| `pnpm test:lint-rules` | PASS. 35 tests passed. |
| `pnpm themes:check` | PASS. All 13 registered themes meet generated text and glyph contrast bounds. |
| `PV_CENSUS_URL=http://127.0.0.1:5194 PV_CENSUS_ROUTES=/ pnpm census` | BLOCKED. The route cannot find visible `#main` because the production shell and routes do not exist. Fixture census passed at 1440 px, 1280 px and 1280 px at 125% zoom. Vite PID 47935 was stopped. |

## Cutover acceptance stays open

This checkpoint does not complete final frontend or promotion acceptance. The beads retain their complete criteria:

- `astro-plan-hqkn5`: final token source, DTCG theme generation and contrast gate.
- `astro-plan-h1ozr`: composition, copy, catalogue and census gates.
- `astro-plan-qnv6v`: promotion to `apps/desktop`, default runtime and build selection, recovery preservation and real-runtime evidence.
