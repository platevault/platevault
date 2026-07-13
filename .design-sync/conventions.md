# PlateVault design system — how to build with it

PlateVault is a local-first desktop app for astrophotography library management. Its UI
is a **token-driven, BEM-class** system: components are plain React styled entirely by CSS
custom properties and `.alm-*` classes. There is **no styling provider to wrap** — the
styles ship in `styles.css` (which `@import`s `_ds_bundle.css`); import that once and every
component and class is styled.

## Theming — set on `<html>`, not via a provider

The default `:root` scope is the light theme. Switch themes by setting a `data-theme`
attribute on the root element; switch density with a class:

- `data-theme` — `warm-slate`, `warm-clay`, `observatory-dark`, `espresso-dark`
- density class — `density-compact` or `density-spacious`

Each theme overrides only the raw palette tokens, so everything built with the tokens
below re-themes automatically. Prefer the two dark themes for a low-light imaging mood.

## Style with `--alm-*` tokens (this is the idiom — use these, don't invent values)

- **Text/ink**: `--alm-ink` (primary), `--alm-ink2`, `--alm-ink3`, `--alm-ink4` (faint)
- **Surfaces**: `--alm-bg`, `--alm-bg3`, `--alm-chip`, `--alm-hover-bg`, `--alm-selected-bg`
- **Lines**: `--alm-border`, `--alm-border-subtle`, `--alm-rule`, `--alm-rule2`
- **Accent**: `--alm-accent`, `--alm-accent-hover`, `--alm-accent-bg`, `--alm-accent-text`,
  `--alm-on-accent`
- **Status**: `--alm-ok` / `--alm-danger` / `--alm-info` each with `-bg` and `-border`
- **Type**: `--alm-font-sans`, `--alm-font-mono`; leading `--alm-leading-tight|normal|relaxed`
- **Space**: `--alm-sp-0` … `--alm-sp-6` (spacing scale)
- **Radius**: `--alm-radius-sm|md|lg|pill`
- **Depth/focus**: `--alm-shadow-sm`, `--alm-focus-ring`

## Component classes (BEM: `.alm-<block>` + `--modifier`)

Prefer the library components below; when writing your own layout glue, reuse these classes:

- `.alm-btn` → `--primary` `--accent` `--danger` `--sm`
- `.alm-pill` → `--accent` `--ok` `--warn` `--danger` `--info` `--neutral` `--ghost`
- `.alm-banner` → `--info` `--warn` `--danger`
- `.alm-toggle`, `.alm-seg`, `.alm-radio` (`.alm-radio-group`, `.alm-radio--active`)
- `.alm-box`, `.alm-section`, `.alm-kv`, `.alm-empty`, `.alm-coverage`

## Components — `window.PlateVault.*`

Btn, Pill, Banner, Toggle, SegControl, RadioGroup, Table, Box, Section, EmptyState,
CoverageBar, Lock, DirPicker, WizardShell, InfoTip, ToastContainer, KV. Each component's
props are in its `<Name>.d.ts` and usage in `<Name>.prompt.md` — read those before
composing. Data-driven ones (Table, RadioGroup, SegControl, WizardShell) take arrays
(`columns`/`rows`, `options`, `segments`, `steps`) — always pass real data.

## Where the truth lives

`styles.css` → `_ds_bundle.css` (all `--alm-*` tokens + `.alm-*` classes) is the styling
source; read it before adding custom CSS. Per-component contracts are the `.d.ts` files.

## Two tiers — primitives vs. layout scaffolds

The system is deliberately two-tier; **compose pages from Tier 2, not raw divs**:

- **Tier 1 — primitives** (leaf building blocks): Btn, Pill, Banner, Toggle, SegControl,
  RadioGroup, Table, Box, Section, EmptyState, CoverageBar, Lock, DirPicker, WizardShell,
  InfoTip, ToastContainer, KV, Tooltip, Skeleton.
- **Tier 2 — layout/composite scaffolds** (assemble a whole screen): `ListPageLayout`,
  `ListDetailLayout`, `PageShell`, `PageTopBar`, `TopActionBar`, `ListSidebar`, `FilterToolbar`,
  `SortHeader`, `ListItem`, `DetailPanel`, `DetailPane`, `DetailHeader`, `DetailGrid`/`Rail`/
  `RailCard`, `MetricLine`, `PropertyTable`, `Modal`, `ConfirmOverlay`, `StatusTag`, `Lifecycle`.

**Page shell contract:** a page is `.alm-page` with a pinned `.alm-page__bar` (action/filter
bars — ALWAYS visible, never scroll) over a `.alm-page__scroll` (the ONLY scrolling region).
Prefer `ListPageLayout`/`PageTopBar`/`ListDetailLayout` to get this for free; a master-detail
screen is a list (`Table` + `SortHeader`) beside a `DetailPanel`. Overlays use `Modal` (or
`ConfirmOverlay` for confirms) — never hand-roll a dialog. Status is `StatusTag` (dot + label).

## One idiomatic snippet

```tsx
import { Btn, Banner } from 'window.PlateVault'; // provided globally by the DS bundle

<div style={{ display: 'grid', gap: 'var(--alm-sp-3)', padding: 'var(--alm-sp-4)',
              background: 'var(--alm-bg)', color: 'var(--alm-ink)',
              fontFamily: 'var(--alm-font-sans)' }}>
  <Banner variant="info">Calibration frames matched for tonight's session.</Banner>
  <div style={{ display: 'flex', gap: 'var(--alm-sp-2)' }}>
    <Btn variant="primary">Review plan</Btn>
    <button className="alm-btn alm-btn--sm">Later</button>
  </div>
</div>
```
