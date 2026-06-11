# Implementation Plan: Frontend Quality Hardening (Spec 028)

**Created**: 2026-06-11
**Spec ref**: spec.md

## Approach

Spec 028 consolidates leftover quality/hardening work from specs 020 (router URL
state) and 022 (design system) plus new coverage needs from spec 027 (full
frontend rewrite). This plan describes what is genuinely missing vs what was
already completed by prior work.

## State audit (as of 2026-06-11)

### Already DONE by prior specs

| Item | Evidence |
|------|----------|
| Typed `RouteContract` / `makeValidateSearch` / parsers | `src/lib/route-contract.ts` exists with full typed search parsers |
| `useSearch` / `useNavigate` refactors | All routes use `validateSearch` + `makeValidateSearch`; no ad-hoc `URLSearchParams` |
| Deep-link resolution (`/targets/$id` → `/targets?selected=uuid`) | `beforeLoad` redirects in `router.tsx` for all entity detail routes |
| Back-button / history state | Hash history + `replace: true` for stale-id cleanup; tested |
| Vitest for route parsers and stale-selection | `route-contract.test.ts` + `use-stale-selection.test.tsx` cover these |
| Token CSS variable definitions (`tokens.css`) | 113-line token file with full palette, spacing, typography, radius, motion |
| Primitive prop audit (`className` + spread) | All `ui/` primitives (`Btn`, `Pill`, `Box`, `Section`, …) accept `className` and spread `...rest` |
| 460 vitest tests passing | Confirmed by `pnpm test` run |

### Genuinely missing — this spec implements

| Item | Finding |
|------|---------|
| **ESLint** | No `eslint.config.*` anywhere in `apps/desktop/`; no `lint` script in `package.json` |
| **Error boundary** | No `ErrorBoundary` component in `apps/desktop/src/`; render errors produce white screen |
| **Broken inline token refs** | ~30 inline style uses of `--alm-color-*`, `--mantine-color-*`, `--alm-error` — tokens that do not exist in `tokens.css`; correct tokens are `--alm-text-muted`, `--alm-warn`, `--alm-danger`, `--alm-accent-bg`, etc. |
| **CI token guard script** | No script exists to fail on raw hex / raw ms in component CSS |
| **`knip` / `madge`** | Neither present in lockfile or PATH; deferred |
| **`setState`-during-render** | No direct violation found in current source (uses `useEffect` / `useStaleSelectionCleanup` correctly); spec 027 regression note is a false alarm post-rewrite. |
| **DESIGN.md sync** | Out of scope — superseded note says spec 030 owns UI audit |

## Architecture decisions

1. **ESLint flat config** (`eslint.config.js`) in `apps/desktop/` using
   `@eslint/js`, `typescript-eslint`, and `eslint-plugin-react-hooks`. No
   additional installs needed as these are already present in the ecosystem or
   can be added as dev-only deps. Use `--no-install` flag to check first.
   Actually: none are in lockfile — install them as devDependencies.

2. **Error boundary** — class-based `AppErrorBoundary` (React class component,
   only viable way to implement error boundaries). Placed at the app shell root
   wrapping `RouterProvider`. Also exported for per-route use. Covered by a
   jsdom vitest that mounts a throwing child and asserts fallback renders.

3. **Broken token fixes** — mechanical search-and-replace of non-existent ALM
   tokens with their correct equivalents from `tokens.css`. Affects:
   `ProjectDetail.tsx`, `ProjectsList.tsx`, `ManifestsAccordion.tsx`,
   `ProjectNotesSection.tsx`, `ToolLaunchesAccordion.tsx`,
   `ActionSidebar.tsx`, `InboxDetail.tsx`, `InboxList.tsx`,
   `NamingStructure.tsx`.

4. **Token guard script** — a shell script at `scripts/check-tokens.sh` that:
   - Greps `apps/desktop/src/styles/components.css` for raw hex colors (fail on any)
   - Greps for raw `ms` values (fail on any)
   - Greps component TSX/TS source for `--mantine-*` or `--alm-color-*`
     (wrong/legacy token namespace that doesn't exist in tokens.css)
   Wired as a `check:tokens` npm script in `apps/desktop/package.json`.
   Must pass on the current tree post-fix.

5. **`knip` / `madge`** — deferred. Neither tool is in the pnpm lockfile or
   PATH. Adding them requires a pnpm install step that may fail in the sandbox
   and is not in scope for this autonomous run. Documented in tasks.md as
   deferred with reason.

## Token mapping reference

| Used (broken) | Correct ALM token |
|---------------|------------------|
| `--alm-color-muted` | `--alm-text-muted` |
| `--alm-color-fg-muted` | `--alm-text-muted` |
| `--alm-color-warn` | `--alm-warn` |
| `--alm-color-danger` | `--alm-danger` |
| `--alm-color-muted-bg` | `--alm-bg3` |
| `--alm-color-accent-bg` | `--alm-accent-bg` |
| `--alm-color-primary` | `--alm-accent` |
| `--alm-color-surface-2` | `--alm-bg3` |
| `--alm-error` | `--alm-danger` |
| `--mantine-color-red-6` | `--alm-danger` |
| `--mantine-color-blue-6` | `--alm-info` |
| `--mantine-color-gray-2` | `--alm-bg3` |
