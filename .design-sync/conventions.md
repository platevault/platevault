# PlateVault design system — how to build with it

PlateVault is a local-first desktop app for astrophotography library management. Its UI
is a **token-driven, BEM-class** system: components are plain React styled entirely by CSS
custom properties and `.pv-*` classes. There is **no styling provider to wrap** — the
styles ship in `styles.css` (which `@import`s `_ds_bundle.css`); import that once and every
component and class is styled.

## Theming — set on `<html>`, not via a provider

The default `:root` scope is the light theme. Switch themes by setting a `data-theme`
attribute on the root element; switch density with a class:

- `data-theme` — light: `warm-slate`, `warm-clay`, `observatory-cool-light`;
  dark: `observatory-cool`, `observatory-dark`, `espresso-dark`
- density class — `density-compact` or `density-spacious`

`observatory-cool` is the canonical dark theme and the app's dark default;
`observatory-cool-light` is its light counterpart. Each theme overrides only the raw palette
tokens, so everything built with the tokens below re-themes automatically.

## Style with `--pv-*` tokens (this is the idiom — use these, don't invent values)

- **Text/ink**: `--pv-text` (primary), `--pv-text-secondary`, `--pv-text-muted`,
  `--pv-text-faint`; `--pv-ink` for maximum-contrast ink, `--pv-link` for links
- **Surfaces**: `--pv-bg`, `--pv-chip`, `--pv-hover-bg`, `--pv-input-recessed-bg`
- **Lines**: `--pv-border`, `--pv-border-subtle`, `--pv-rule`
- **Accent**: `--pv-accent`, `--pv-accent-bg`, `--pv-on-accent`
- **Status**: `--pv-ok` / `--pv-ok-bg`, `--pv-warn-bg`, `--pv-info-bg`, `--pv-danger-bg`
- **Destructive**: `--pv-destructive` (+ `-bg`, `-bg-hover`) — reserved for actions that
  actually delete, trash, or permanently discard. Reversible "danger" styling stays on the
  `danger` family.
- **Metrics**: `--pv-control-h` / `-sm`, `--pv-row-height`, `--pv-toolbar-height`,
  `--pv-statusbar-height`, `--pv-sidebar-width` / `--pv-sidebar-collapsed`,
  `--pv-action-sidebar-width`, `--pv-list-width`, `--pv-rail-width`
- **Depth/focus**: `--pv-shadow-sm`, `--pv-focus-ring`

Type, spacing, and radius tokens come from `packages/tokens/tokens-docs.css`, which
`tokens.css` `@import`s — use those rather than hard-coded values:

- **Type**: `--pv-font-sans`, `--pv-font-display`, `--pv-font-mono`;
  leading `--pv-leading-tight|normal|relaxed`
- **Space**: `--pv-sp-0` … `--pv-sp-7`
- **Radius**: `--pv-radius-sm|md|lg`

## Component classes (BEM: `.pv-<block>` + `--modifier`)

Prefer the library components below; when writing your own layout glue, reuse these classes:

- `.pv-btn` → `--primary` `--danger` `--destructive` `--sm`
- `.pv-pill` → `--accent` `--ok` `--warn` `--danger` `--info` `--neutral` `--ghost`
- `.pv-banner` → `--info` `--warn` `--danger`
- `.pv-toggle`, `.pv-seg`, `.pv-radio`
- `.pv-box`, `.pv-section`, `.pv-kv`, `.pv-empty`, `.pv-coverage`

## Components — `window.PlateVault.*`

Btn, Pill, Banner, Toggle, SegControl, RadioGroup, Table, Box, Section, EmptyState,
CoverageBar, Lock, DirPicker, WizardShell, InfoTip, ToastContainer, KV. Each component's
props are in its `<Name>.d.ts` and usage in `<Name>.prompt.md` — read those before
composing. Data-driven ones (Table, RadioGroup, SegControl, WizardShell) take arrays
(`columns`/`rows`, `options`, `segments`, `steps`) — always pass real data.

## Where the truth lives

`styles.css` → `_ds_bundle.css` (all `--pv-*` tokens + `.pv-*` classes) is the styling
source; read it before adding custom CSS. Per-component contracts are the `.d.ts` files.

## Two tiers — primitives vs. layout scaffolds

The system is deliberately two-tier; **compose pages from Tier 2, not raw divs**:

- **Tier 1 — primitives** (leaf building blocks): Btn, Pill, Banner, Toggle, SegControl,
  RadioGroup, Table, Box, Section, EmptyState, CoverageBar, Lock, DirPicker, WizardShell,
  InfoTip, ToastContainer, KV, Tooltip, Skeleton.
- **Tier 2 — layout/composite scaffolds** (assemble a whole screen): `ListPageLayout`,
  `ListDetailLayout`, `PageShell`, `PageTopBar`, `TopActionBar`, `ListSidebar`, `FilterToolbar`,
  `SortHeader`, `ListItem`, `DetailPanel`, `DetailPane`, `DetailHeader`, `FactsKV`,
  `MetricLine`, `PropertyTable`, `Modal`, `StatusTag`, `Lifecycle`.

**Page shell contract:** a page is `.pv-page` with a pinned `.pv-page__bar` (action/filter
bars — ALWAYS visible, never scroll) over a `.pv-page__scroll` (the ONLY scrolling region).
Prefer `ListPageLayout`/`PageTopBar`/`ListDetailLayout` to get this for free; a master-detail
screen is a list (`Table` + `SortHeader`) beside a `DetailPanel`. Overlays use `Modal` —
including confirmations, which `Modal` absorbed — never hand-roll a dialog. Status is
`StatusTag` (dot + label).

## One idiomatic snippet

```tsx
import { Btn, Banner } from 'window.PlateVault'; // provided globally by the DS bundle

<div style={{ display: 'grid', gap: 'var(--pv-sp-3)', padding: 'var(--pv-sp-4)',
              background: 'var(--pv-bg)', color: 'var(--pv-text)',
              fontFamily: 'var(--pv-font-sans)' }}>
  <Banner variant="info">Calibration frames matched for tonight's session.</Banner>
  <div style={{ display: 'flex', gap: 'var(--pv-sp-2)' }}>
    <Btn variant="primary">Review plan</Btn>
    <button className="pv-btn pv-btn--sm">Later</button>
  </div>
</div>
```
