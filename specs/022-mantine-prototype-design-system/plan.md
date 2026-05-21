# Implementation Plan: Desktop Prototype Design System

**Branch**: `022-mantine-prototype-design-system` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/022-mantine-prototype-design-system/spec.md`

## Summary

The desktop prototype uses `@base-ui-components/react` for headless
primitives (menu, dialog, tooltip, accordion, select, switch, popover),
`cmdk` for command-palette fuzzy matching, `react-resizable-panels` for
the docked drawer, and `@tanstack/react-table` rendered through an
`alm-table-*` CSS skin for ledger tables. Visual decisions resolve to
CSS custom properties defined in `apps/desktop/src/styles/tokens.css`,
applied via `alm-*`-prefixed rules in
`apps/desktop/src/styles/components.css`. Theme mode is controlled by a
`data-theme` attribute on the document root and a `ThemeProvider`
context (`apps/desktop/src/app/theme.tsx`). This plan ratifies the
existing mockup as the prototype's design system and locks the
`theme.get` / `theme.set` contracts for the UI-to-core boundary.

## Technical Context

**Language/Version**: TypeScript 5.x (desktop app), Rust 1.7x (future
backend contract implementation)
**Primary Dependencies**: `@base-ui-components/react`, `cmdk`,
`react-resizable-panels`, `@tanstack/react-table`,
`@tanstack/react-router`, React 18, Tauri 2.x.
**Storage**: `localStorage` key `alm.theme` for theme persistence in
the desktop prototype. A future backend may persist theme in the
settings store; the contracts already model that boundary.
**Testing**: Vitest for primitive prop shape and theme reducer logic;
Playwright MCP for in-app theme switching and primitive accessibility
smoke. No snapshot testing; styling is verified by token resolution.
**Target Platform**: Desktop (Tauri shell on Windows/macOS/Linux).
**Project Type**: Desktop application with a single SPA entry.
**Performance Goals**: Theme switch under 16ms (single attribute
write triggers CSS variable re-resolve, no React re-render of the
entire tree); primitives must not introduce a styled-component runtime.
**Constraints**: No Tailwind, no CSS-in-JS, no Mantine, no
shadcn/ui. All visuals must be expressible through CSS variables.
**Scale/Scope**: ~20 primitives under `apps/desktop/src/ui/`, one
tokens file, one components file, ~9 feature pages.

## Constitution Check

- **Local-first file custody**: PASS. The design system stores no user
  data; theme preference lives in localStorage on the desktop edge.
- **Reviewable filesystem mutation**: N/A. The design system does not
  mutate user files.
- **PixInsight boundary**: PASS. The design system does not touch
  image processing.
- **Research-led domain modeling**: PASS. Framework choice, token
  taxonomy, and headless-library composition are decided in
  `research.md`.
- **Portable contracts and durable records**: PASS. `theme.get` and
  `theme.set` are language-neutral JSON Schemas under `contracts/`,
  so a future backend-driven settings layer can implement them.
- **Cross-platform path safety**: N/A for the design system layer.

## Project Structure

### Documentation (this feature)

```text
specs/022-mantine-prototype-design-system/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── theme.get.json
│   └── theme.set.json
└── tasks.md
```

### Source Code (repository root)

```text
apps/desktop/src/
├── app/
│   ├── theme.tsx                 # ThemeProvider + useTheme + applyTheme
│   ├── Shell.tsx                 # Root layout (composes primitives)
│   ├── router.tsx                # TanStack Router definition (spec 020)
│   └── palette.tsx               # Command palette commands
├── ui/
│   ├── index.ts                  # Barrel export
│   ├── Accordion.tsx             # Base UI accordion
│   ├── Badge.tsx                 # Plain element + alm-badge-* CSS
│   ├── Button.tsx                # Plain button + alm-button-* CSS
│   ├── CommandPalette.tsx        # cmdk + Base UI dialog
│   ├── DataTable.tsx             # @tanstack/react-table renderer
│   ├── Dialog.tsx                # Base UI dialog
│   ├── DockedDrawer.tsx          # react-resizable-panels host
│   ├── DrawerShell.tsx           # Drawer layout primitive
│   ├── EmptyState.tsx
│   ├── Filters.tsx
│   ├── IconButton.tsx
│   ├── LogPanel.tsx              # Bottom log viewer surface (spec 019)
│   ├── Menu.tsx                  # Base UI menu
│   ├── PageHeader.tsx
│   ├── Select.tsx                # Base UI select
│   ├── StateLabel.tsx
│   ├── Stepper.tsx
│   ├── Switch.tsx                # Base UI switch
│   ├── TextInput.tsx
│   ├── TokenPattern.tsx          # Token-pattern builder surface (spec 015)
│   └── Tooltip.tsx               # Base UI tooltip
└── styles/
    ├── reset.css                 # Minimal reset
    ├── tokens.css                # The token system (color, type, spacing,
    │                             # density, shadow, radius, timing, z, shell)
    └── components.css            # alm-*-prefixed component rules

packages/contracts/
└── theme/
    ├── theme.get.json            # Mirrored from specs/.../contracts/
    └── theme.set.json            # Mirrored from specs/.../contracts/

crates/
└── app/core/usecases/theme.rs    # Future backend implementation of the
                                  # theme.get / theme.set contracts.
```

**Structure Decision**: The design system lives entirely under
`apps/desktop/src/`. The primitive layer is intentionally co-located
with the desktop app (not a separate package) because the prototype is
single-app and extraction would slow iteration. When a second consumer
appears, the `ui/` and `styles/` folders can be lifted into a shared
package without API changes — that is the explicit reason every
primitive accepts `className` and spreads remaining props.

## Architecture

### Token System

The token system in `apps/desktop/src/styles/tokens.css` is the
single source of truth for color, typography, spacing, density,
shadow, radius, timing, z-index, and app-shell metrics. Tokens are
declared on `:root` and overridden under `[data-theme="light"]` and
`[data-theme="dark"]` scopes. The `:root:not([data-theme])` selector
inside `@media (prefers-color-scheme: dark)` provides the
"system" mode behavior without JavaScript.

Component CSS files must reference tokens via `var(--…)` and must
not hardcode color, spacing, radius, shadow, or motion. New tokens
are added before new components use them; this is enforced by
review, not tooling, in v1.

### Headless Primitive Layer

Base UI (`@base-ui-components/react`) provides accessibility and
keyboard plumbing for menu, dialog, tooltip, accordion, select,
switch, and popover. Primitives in `apps/desktop/src/ui/` wrap a Base
UI element, attach `alm-*` class names, and forward unrecognized
props onto the root element. They do not introduce a styling runtime.

Headless companions:

- `cmdk` — command palette fuzzy matching and item navigation.
  Composed inside a Base UI dialog so focus and overlay behavior
  match the rest of the app.
- `react-resizable-panels` — docked drawer that respects
  `--drawer-min-w` / `--drawer-default-w` / `--drawer-max-w`.
- `@tanstack/react-table` — table state (rows, columns, sort, filter,
  selection). The `DataTable` primitive renders the headless table
  through `alm-table-*` CSS.

### Component Composition

Feature pages compose primitives rather than inventing layout markup:

- `PageHeader` for top-of-page title and actions.
- `Filters` for per-page filter affordances.
- `DataTable` for the ledger body.
- `DockedDrawer` + `DrawerShell` for the right-side detail pane.
- `EmptyState` for empty/error fallbacks.

A feature page that needs a layout primitive not in `ui/` must add
it to `ui/` rather than inline-styling at the page level.

### Theme Provider

`apps/desktop/src/app/theme.tsx` exports `ThemeProvider`, `useTheme`,
and a `ThemeMode` type (`"system" | "light" | "dark"`). The provider:

1. Reads `alm.theme` from `localStorage` (defaults to `"system"`).
2. Applies the mode by writing `data-theme` on
   `document.documentElement` (or removing the attribute for
   `"system"`).
3. Resolves the effective theme (`"light"` or `"dark"`) by checking
   the OS `(prefers-color-scheme: dark)` media query when mode is
   `"system"`.
4. Persists the chosen mode back to `localStorage` on every change.
5. Listens to the media-query change event while mode is `"system"`
   so the resolved theme follows the OS without user action.

### Theme Contracts

`theme.get` and `theme.set` describe the UI-to-core boundary. The
desktop prototype satisfies them with a localStorage implementation;
a future backend (e.g. the settings store from spec 018) can
implement them server-side without changing the UI. The contracts
intentionally split `mode` (user-chosen) from `resolved`
(observed effective theme) so callers can decide which one to act
on.

### Out-of-Scope Choices (Why Each Was Rejected)

- **Mantine**: dual source of truth with the existing token CSS, plus
  a larger styled runtime than the prototype warrants. See
  `research.md` R1.
- **shadcn/ui**: requires Tailwind. Rejected; see R1.
- **Park UI / Ark UI**: smaller community than Base UI and a Tailwind
  / Panda CSS expectation that we do not want.
- **Spotlight (Mantine) for the command palette**: tied to Mantine.
  `cmdk` keeps the command palette independent of any styling kit.

## Complexity Tracking

No constitution violations. The compositional approach is more code
than adopting a styled framework outright, but the cost is paid once
and recovered in token coherence and dependency control.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    |            |                                      |
