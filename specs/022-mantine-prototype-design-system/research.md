# Research: Desktop Prototype Design System

## R1: Headless Primitive Framework

**Decision**: Use `@base-ui-components/react` (Base UI) as the headless
primitive layer.

**Options Considered**:

- **Mantine** (original spec direction): Comprehensive React component
  library with built-in theme, hooks, forms, and notifications.
  Rejected because (a) Mantine wants to own theming through its own
  `MantineProvider`/theme object, which would have created two sources
  of truth alongside the existing CSS variable token system in
  `apps/desktop/src/styles/tokens.css`; (b) the prototype already had
  a calibrated visual direction that Mantine's defaults would have
  partially overwritten or fought; (c) the library is sizable for a
  prototype that only needs primitive behavior, not opinionated
  visuals.
- **shadcn/ui**: A copy-paste primitive collection built on Radix +
  Tailwind. Rejected because it mandates Tailwind, which the team
  explicitly does not want to adopt. The constitution prefers
  reviewable, audit-friendly CSS files keyed to tokens over a utility
  class layer.
- **Radix UI primitives**: Mature headless primitive set. Plausible
  alternative; Base UI was chosen instead because it is maintained by
  the MUI team (who carry the same accessibility track record), is
  newer and actively developed for React 18+, and exposes a more
  consistent API for the primitives we actually use (popover, dialog,
  menu, tooltip, select). Radix remains a viable fallback if Base UI
  stalls.
- **Ark UI / Park UI**: Strong headless primitives from the Chakra
  team. Smaller ecosystem than Radix/Base UI, and Park UI's recipe
  layer leans on Panda CSS, which is another tokens runtime we would
  have to reconcile with our existing CSS variables.
- **Base UI (chosen)**: Headless, unstyled primitives with the MUI
  accessibility heritage. No theming runtime, no styling assumptions,
  works with plain CSS and CSS variables. Perfect fit for a token-led
  desktop prototype.

**Tradeoffs**: Base UI is younger than Radix; some primitives are
still labeled experimental. The prototype only uses primitives that
are stable (menu, dialog, tooltip, accordion, select, switch). The
swap to Radix is straightforward (the wrapper boundary is one file per
primitive) if a specific Base UI primitive proves unstable.

**Positioning engine**: Base UI uses
[Floating UI](https://github.com/floating-ui/floating-ui) internally for all
anchor-positioned primitives (Popover, Tooltip, Select, Menu, AutocompletePopup).
Floating UI is the de facto positioning library for React — it handles
collision detection, flip/shift middleware, arrow placement, virtual elements,
and scroll-aware repositioning. We do NOT depend on Floating UI directly; we
inherit it transitively through Base UI's Positioner components. Spec 010
(Guided First Project Flow) uses Shepherd for the product tour, which also
uses Floating UI internally — so the entire app shares one positioning runtime
without two competing implementations.

## R2: Tokens via CSS Variables vs Runtime Theme Object

**Decision**: CSS custom properties declared in `tokens.css` and
overridden by `[data-theme="light"]` / `[data-theme="dark"]` /
`@media (prefers-color-scheme: dark)`.

**Options Considered**:

- **Runtime theme object** (Mantine, MUI, styled-system): a JS object
  passed to a provider. Rejected because (a) theme changes require a
  React re-render across every consumer; (b) a future backend or CLI
  can't read theme values without parsing JS; (c) the token list is
  long-lived and audit-friendly when expressed in one CSS file.
- **Tailwind tokens via `tailwind.config`**: rejected with Tailwind.
- **CSS-in-JS theme**: rejected. Adds a styling runtime, hurts SSR
  capability for the future web adapter, and obscures the token
  surface during code review.
- **CSS custom properties (chosen)**: zero runtime cost, themable by
  a single `data-theme` attribute write, OS-level theme can be
  honored with `@media (prefers-color-scheme)` directly in CSS,
  and tokens are inspectable in DevTools without source maps.

**Tradeoffs**: TypeScript can't autocomplete CSS variable names by
default. If this becomes painful, a generated `tokens.ts` declaration
can mirror the CSS file (deferred — see domain question in the spec).

## R3: Command Palette

**Decision**: `cmdk` for fuzzy match and keyboard handling, wrapped in
a Base UI dialog for focus trap and overlay.

**Options Considered**:

- **Mantine Spotlight**: tied to Mantine. Rejected with Mantine.
- **Custom build** on top of Base UI alone: would re-implement fuzzy
  matching and keyboard item navigation. `cmdk` already does this
  well.
- **kbar**: capable, but more opinionated about action shape and less
  flexible about visual presentation. `cmdk` exposes a smaller
  surface and renders through plain markup we can style with
  `alm-palette-*` rules.
- **cmdk (chosen)**: Tiny, accessible, command-palette-only. Pairs
  cleanly with Base UI for the dialog wrapper.

**Tradeoffs**: Two libraries instead of one (Base UI dialog + cmdk
list). The boundary is in one file (`CommandPalette.tsx`) and the
combined surface is smaller than Mantine Spotlight.

## R4: Docked Drawer / Resizable Detail Pane

**Decision**: `react-resizable-panels` for the resizable docked
drawer; no Base UI primitive for this affordance.

**Options Considered**:

- **Base UI**: no resizable panel primitive (Base UI focuses on
  overlay/menu/form patterns).
- **Custom build** with `ResizeObserver` and pointer events: doable
  but reinvents accessibility-friendly resize handles and persistence.
- **Allotment / Split.js**: heavier; Split.js is non-React.
- **`react-resizable-panels` (chosen)**: small, keyboard-accessible,
  composable, no styling assumptions. Plays nicely with the
  `--drawer-min-w` / `--drawer-default-w` / `--drawer-max-w` tokens.

**Tradeoffs**: One more dependency, but it owns a non-trivial UI
contract (collapse, persist, keyboard, ARIA) that we do not want to
reimplement.

## R5: Data Table

**Decision**: `@tanstack/react-table` for state, rendered through an
`alm-table-*` CSS skin in `DataTable.tsx`.

**Options Considered**:

- **Mantine Table** (original spec): styled wrapper with manual state
  wiring. Rejected with Mantine.
- **AG Grid / Material React Table**: too heavy; brings opinionated
  visuals and licensing concerns.
- **TanStack Table (chosen)**: headless table state. Matches the
  approach taken by the router (spec 020) and gives feature pages a
  uniform `useReactTable` shape.

**Tradeoffs**: We hand-write the rendering, but the rendering is
small and lets every ledger page apply the same density and selection
treatment.

## R6: Theme Mode Resolution

**Decision**: Three-state `mode` (`system | light | dark`) plus a
derived `resolved` (`light | dark`); applied by `data-theme` on
`<html>` and persisted in `localStorage` under `alm.theme`.

**Options Considered**:

- **Two-state toggle (light/dark)**: rejected. Users who run their OS
  in dark prefer the app to follow without explicit configuration.
- **Class-based theming** (`.theme-dark` on `body`): functional but
  less ergonomic than `[data-theme]` for CSS variable overrides.
- **`prefers-color-scheme` only, no override**: rejected because
  users sometimes want to deviate from OS settings.
- **`data-theme` attribute + media-query fallback (chosen)**: CSS
  declares the truth, JS only flips a single attribute, persisting
  the user's choice is one localStorage write.

**Tradeoffs**: A user-set mode survives OS appearance changes by
design; this matches how most desktop applications behave. If a user
wants "always follow OS", they pick `system`.

## R7: DESIGN.md Location

**Decision**: Deferred (see domain question in spec). Likely
`docs/design/DESIGN.md` or `apps/desktop/DESIGN.md`. The location
choice does not block this spec; FR-015 captures the requirement.

**Tradeoffs**: `docs/design/` is more discoverable for cross-cutting
documentation, `apps/desktop/` is co-located with the prototype. A
future doc-organization pass will pick one.

## R8: Why No Migration Spec Instead of Revising This One

**Decision**: Revise spec 022 in place rather than mark it superseded
and open spec 027 (or similar).

**Context**: The branch name and feature directory match a SpecKit
convention where each numbered spec is a feature artifact. Mantine
was never adopted at runtime; the original spec described an intent
that was overridden during the design pass before any production
code shipped. Opening a new spec to document the choice would split
the history of a single decision across two artifacts.

**Tradeoffs**: Future readers must look at git history to see the
original Mantine direction. The "Supersession Notice" section at the
top of the spec makes the change visible without requiring history
spelunking. If the team later prefers separation, this spec can be
marked retired and a new `027-desktop-design-system` opened that
forwards to the same plan/research/contracts — the artifact bodies
are already structured to support that move.
