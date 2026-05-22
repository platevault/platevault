# Data Model: Desktop Prototype Design System

This feature does not introduce database entities. The "data model" is
the design vocabulary the prototype shares across primitives and
feature pages: token taxonomy, primitive vocabulary, and theme mode.

## Token Taxonomy

All tokens are CSS custom properties declared in
`apps/desktop/src/styles/tokens.css`. Tokens fall into categories with
defined naming conventions.

### Category: Color (theme-scoped)

Tokens that change between light and dark. Declared under
`:root, [data-theme="light"]` for light, `[data-theme="dark"]` for
dark, and inside `@media (prefers-color-scheme: dark)
:root:not([data-theme])` for system-mode-dark.

| Token                       | Purpose                                      |
|-----------------------------|----------------------------------------------|
| `--bg`                      | App background                               |
| `--surface-1`/`-2`/`-3`     | Layered surfaces, lowest to highest          |
| `--surface-hover`           | Hover overlay on surfaces                    |
| `--surface-pressed`         | Pressed overlay                              |
| `--surface-selected`        | Selected-row overlay (soft)                  |
| `--surface-selected-strong` | Selected-row overlay (strong)                |
| `--border`                  | Default border                               |
| `--border-strong`           | Emphasized border                            |
| `--border-subtle`           | De-emphasized border                         |
| `--text`                    | Primary text                                 |
| `--text-dim`                | Secondary text                               |
| `--text-faint`              | Tertiary/disabled text                       |
| `--text-on-accent`          | Text on accent backgrounds                   |
| `--accent`                  | Primary accent                               |
| `--accent-hover`/`-pressed` | Interactive accent states                    |
| `--accent-soft`             | Soft accent tint                             |
| `--success`/`-soft`         | Positive state + tint                        |
| `--warn`/`-soft`            | Warning state + tint                         |
| `--danger`/`-soft`          | Danger/destructive state + tint              |
| `--info`/`-soft`            | Informational state + tint                   |
| `--focus-ring`              | Outline color for focus                      |

### Category: Typography (theme-invariant)

| Token                 | Purpose                                    |
|-----------------------|--------------------------------------------|
| `--font-sans`         | UI font stack                              |
| `--font-mono`         | Monospaced font stack                      |
| `--fs-micro` .. `--fs-3xl` | Font sizes (11px .. 24px)             |
| `--lh-tight`/`-base`/`-loose` | Line heights                       |
| `--fw-regular`/`-medium`/`-semibold`/`-bold` | Font weights        |
| `--letter-tight`/`-wide` | Letter spacing                          |

### Category: Spacing (theme-invariant)

| Token              | Value                                         |
|--------------------|-----------------------------------------------|
| `--space-1` .. `--space-10` | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px |

A 4px base scale; intermediate values are explicit token names, not
arithmetic.

### Category: Density

| Token                 | Purpose                                    |
|-----------------------|--------------------------------------------|
| `--row-h-dense`       | Dense row height                           |
| `--row-h-comfortable` | Comfortable row height                     |
| `--row-h`             | Active row height (alias)                  |
| `--row-px`            | Default row horizontal padding             |

### Category: Radius

| Token       | Purpose                |
|-------------|------------------------|
| `--r-xs`    | 3px                    |
| `--r-sm`    | 5px                    |
| `--r-md`    | 8px                    |
| `--r-lg`    | 12px                   |
| `--r-full`  | Full pill              |

### Category: Shadow (theme-scoped)

| Token         | Purpose                          |
|---------------|----------------------------------|
| `--shadow-xs` | Hairline shadow                  |
| `--shadow-sm` | Card/button shadow               |
| `--shadow-md` | Popover/menu shadow              |
| `--shadow-lg` | Modal/floating-panel shadow      |

### Category: Timing (theme-invariant)

| Token       | Purpose                                     |
|-------------|---------------------------------------------|
| `--t-fast`  | 100ms ease-out — tactile feedback           |
| `--t-base`  | 160ms ease-out — default transition         |
| `--t-slow`  | 240ms ease-out — overlays and large motion  |

### Category: Z-Index

| Token         | Purpose                |
|---------------|------------------------|
| `--z-shell`   | Shell layout chrome    |
| `--z-drawer`  | Docked detail drawer   |
| `--z-log`     | Bottom log panel       |
| `--z-dialog`  | Modal dialog           |
| `--z-palette` | Command palette        |
| `--z-tooltip` | Tooltip                |

### Category: Shell Metrics

| Token                      | Purpose                          |
|----------------------------|----------------------------------|
| `--shell-header-h`         | Top header height                |
| `--shell-nav-h`            | Secondary navigation height      |
| `--shell-log-collapsed-h`  | Log panel collapsed height       |
| `--shell-log-expanded-h`   | Log panel expanded height        |
| `--drawer-min-w`           | Minimum drawer width             |
| `--drawer-default-w`       | Default drawer width             |
| `--drawer-max-w`           | Maximum drawer width             |

## Component Vocabulary

The prototype's reusable primitives, all under
`apps/desktop/src/ui/`. Each primitive wraps a headless library or
semantic HTML and is styled by an `alm-*` class block in
`apps/desktop/src/styles/components.css`.

| Primitive          | Headless source                              | Role                                       |
|--------------------|----------------------------------------------|--------------------------------------------|
| `Accordion`        | Base UI Accordion                            | Collapsible content groups                 |
| `Badge`            | Semantic `<span>` + `alm-badge-*`            | Status/identity chip                       |
| `Button`           | Semantic `<button>` + `alm-button-*`         | Primary action surface                     |
| `CommandPalette`   | `cmdk` + Base UI Dialog                      | Global command/search                      |
| `DataTable`        | `@tanstack/react-table`                      | Ledger table rendering                     |
| `Dialog`           | Base UI Dialog                               | Modal dialogs                              |
| `DockedDrawer`     | `react-resizable-panels`                     | Resizable side detail pane                 |
| `DrawerShell`      | Plain layout primitive                       | Drawer content scaffolding                 |
| `EmptyState`       | Semantic markup                              | Empty/error fallbacks                      |
| `Filters`          | Plain layout primitive                       | Filter row inside a page header            |
| `IconButton`       | Semantic `<button>` + `alm-icon-button-*`    | Icon-only action surface                   |
| `LogPanel`         | Plain layout primitive                       | Bottom log panel surface (spec 019)        |
| `Menu`             | Base UI Menu                                 | Context menus and dropdowns                |
| `PageHeader`       | Plain layout primitive                       | Page title + actions                       |
| `Select`           | Base UI Select                               | Single-select dropdown                     |
| `StateLabel`       | Plain element                                | Inline state label with status tint        |
| `Stepper`          | Plain layout primitive                       | Multi-step progress indicator              |
| `Switch`           | Base UI Switch                               | Boolean toggle                             |
| `TextInput`        | Semantic `<input>` + `alm-text-input-*`      | Text input                                 |
| `TokenPattern`     | Plain layout primitive                       | Token-pattern builder surface (spec 015)   |
| `Tooltip`          | Base UI Tooltip                              | Hover/focus tooltip                        |
| `FilterLabel`      | Plain element + `alm-filter-label-*`         | Label chip inside a `Filters` row (D-022-2, GRILL 2026-05-22) |
| `FactGroup`        | Plain layout primitive                       | Labelled group of fact rows in detail panes (D-022-2) |
| `Facts`            | Plain layout primitive                       | Ordered list of `FactGroup` / key–value rows (D-022-2) |
| `TokenPatternBuilder` | Composition of `TokenPattern` + form controls | Full token-pattern authoring surface; re-exports `TokenPattern` internals (D-022-2) |

## Theme Mode

A `ThemeMode` value is one of:

- `system` — follow the OS `prefers-color-scheme` setting. `data-theme`
  is absent on the document root.
- `light` — force light. `data-theme="light"`.
- `dark` — force dark. `data-theme="dark"`.

A `ResolvedTheme` is the observed effective theme after resolving
`system` against the OS preference. It is always one of `light` or
`dark`.

Persistence: `localStorage` key `alm.theme` stores the user's chosen
mode. The provider reads it on mount, applies it, and writes it on
every change.

Reactivity: while mode is `system`, the provider subscribes to
`window.matchMedia("(prefers-color-scheme: dark)")` and updates
`resolved` (but not `mode`) when the OS preference flips.

Public surface:

```ts
type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}
```

This shape matches the `theme.get` / `theme.set` JSON Schema contracts
under `contracts/`.
