# Design

> **Status (2026-05-21):** rewritten to match the current Base UI implementation. Supersedes the prior Mantine-era guidance. If you find this document and the running mockup disagree, the mockup is provisionally correct — file a doc fix or open a design review.

## Register

Product application UI. Design serves repeated source review, project setup, calibration matching, processing preparation, and safe filesystem planning. Not a marketing site.

## Intent

Astro Library Manager should feel precise, calm, technical, and safety-first. The interface is an expert workbench for source-of-truth decisions, not a marketing dashboard, not an astronomy showcase.

Primary user: an astrophotographer working at a desktop with Finder/Explorer, capture software exports, PixInsight/Siril/Planetary Suite, and local project folders open nearby. Dense but legible review surfaces, predictable actions, clear distinction between observed files, inferred metadata, reviewed decisions, generated projections, and planned mutations.

## Stack of record (mockup phase)

| Concern | Choice | Notes |
|---|---|---|
| UI framework | React 19 + Vite | Strict TypeScript |
| Routing | TanStack Router, hash mode | All filter/sort/selection state encoded in URL search params |
| Component library | **Base UI** (`@base-ui-components/react`) | Per ratified spec 022 (2026-05-21), supersedes earlier Mantine direction. |
| Command palette | `cmdk` | ⌘K opens, palette-driven entity search + global actions |
| Layout primitive | `react-resizable-panels` | Used for the docked-drawer pattern |
| Icons | `lucide-react` | One library, no mixing |
| Table primitive | App-local `DataTable` in `src/ui/DataTable.tsx` | Sortable columns, groups (static or collapsible), checkbox multi-select, density. Caller supplies sorted rows via the exported `sortRows<T>` helper. |
| State | `useSyncExternalStore` pub/sub in `src/data/store.ts` | Mock-only for now; backend-ready seam. |

If you need a primitive that doesn't exist, check Base UI first, then write a thin app-local component. Do not pull in a second component library.

## Tokens

All colors, sizes, and motion live in `src/styles/tokens.css`. Components MUST consume tokens, not literal values.

### Typography

```
--font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Inter, ...
--font-mono: ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, ...

--fs-micro:  11px   meta, badges, table sub-lines, log entries
--fs-dense:  12px   drawer body, dense list rows
--fs-small:  13px   default table cell, filter row, secondary copy
--fs-base:   14px   body copy, primary buttons, drawer fact values
--fs-md:     15px   drawer header subtitle, settings section subtitle
--fs-lg:     16px   drawer headers
--fs-xl:     18px   page subtitles (rare)
--fs-2xl:    20px   page titles (h1)
--fs-3xl:    24px   wizard / hero titles (welcome only)

--fw-regular: 400
--fw-medium:  500
--fw-semibold: 600
--fw-bold:    700
```

There are only nine font sizes. **Inline `fontSize: "Npx"` is banned.** Use a token via `var(--fs-*)` or a utility class. If the size you want doesn't exist as a token, add one and prefer reusing first.

### Spacing

```
--space-1: 4px    --space-6: 24px
--space-2: 8px    --space-7: 32px
--space-3: 12px   --space-8: 40px
--space-4: 16px   --space-9: 48px
--space-5: 20px   --space-10: 64px
```

Inline `style={{ padding: "Npx" }}` is banned. Use tokens.

### Radius

```
--r-xs: 3px    chips, inline pills
--r-sm: 5px    buttons, inputs, table-internal blocks
--r-md: 8px    drawer header surfaces, cards (sparingly)
--r-lg: 12px   modals
--r-full: 9999px  badges, dot indicators
```

### Surfaces & text

```
--bg            page background
--surface-1     panels, sidebar, drawer header
--surface-2     table group headers, hover backgrounds, code blocks

--text          primary text
--text-dim      secondary copy, table dim cells, meta
--text-faint    tertiary, table empty, inactive nav

--accent        primary action, selected nav, sortable active
--accent-soft   selected row tint, active badge background
--text-on-accent  text drawn on accent fills

--success / --warn / --danger  semantic only, never decorative
--border / --border-subtle     panel separators
```

Do not invent `border-left: 3px solid accent` "side stripe" accents. Use full borders, background tints, or leading icons.

### Density & rows

```
--row-h-dense: 30px        default for ledgers (Inventory, Inbox, Activity, Projects)
--row-h-comfortable: 38px  drawer fact lists, settings rows
--row-h: var(--row-h-dense)
--row-px: var(--space-3)
```

Tables always render at `--row-h-dense` unless `density="comfortable"` is explicitly set. Drawer fact rows use `--row-h-comfortable`. Wizard pages use bespoke spacing (centered, max-width 680px).

### Motion

```
--t-fast: 100ms cubic-bezier(0.2, 0, 0, 1)
--t-base: 160ms cubic-bezier(0.2, 0, 0, 1)
--t-slow: 240ms cubic-bezier(0.2, 0, 0, 1)
```

No bounce, no elastic, no `ease-in-out`. Hover / selection: `--t-fast`. Drawer / collapse / expand: `--t-base`. Wizard step transitions: `--t-slow`. Do not animate layout properties; use `transform` and `opacity`.

## App shell

```
+-----------------------------------------------------------------+
| ALM   > <breadcrumb>                       search   theme       |  header
+------+----------------------------------------------------------+
|      |                                                          |
| Nav  |  Main workspace                                          |
|      |                                                          |
|      |                                                          |
|  *   |                                                          |
|  *   |                                                          |
+------+----------------------------------------------------------+
| ^ Log . scan status / progress inline                           |
+-----------------------------------------------------------------+
```

- **Header:** ALM mark (left) . breadcrumb (mid) . search icon + theme toggle (right). No wordmark when sidebar is expanded.
- **Sidebar:** icons + labels, collapsible to icon-only via the footer toggle. Persisted in `localStorage` (`alm.sidebar.collapsed`). Order: **Inventory, Inbox, Projects, Activity** at top; Settings + collapse toggle at the footer. Active item shows a 2px accent rail on the left edge. Badges: red badge only on Activity when failed plans exist; numeric count badge on Inbox when items are queued.
- **Main workspace:** the route's page component, never wrapped in an extra card.
- **Log strip:** persistent bottom bar showing scan status inline. Idle: `Scans up to date . 1247 files indexed`. Running: spinner + counter + progress bar. Click to expand into the full log viewer.

During the first-run wizard, sidebar items are visually disabled (`data-disabled="true"`, opacity 0.45, pointer-events none) but visible. Settings remains clickable.

## Breadcrumb vs page header

Two affordances, one job each; do not duplicate.

- **Breadcrumb** (in the app shell): names current route + context. Top-level routes show one segment (`Inventory`). Drilled-in pages show two (`Activity > #41 Cleanup NGC 7000 Mosaic`). Plain text + `>` separator. `var(--fs-small)` / `--text-dim` for non-current, `--text` + `--fw-semibold` for current.
- **PageHeader** (in the workspace body): page title (`var(--fs-2xl)`, `--fw-semibold`) + a one-line subtitle of counts/state (`8 sessions . 797 frames`). Actions on the right (Add source, More menu). No paragraph descriptions.

If a page can communicate everything with the breadcrumb alone, drop the PageHeader. Otherwise PageHeader is required so the body has a hierarchical anchor.

## Filters row

Below the PageHeader, every list page has a `Filters` strip:

```
<label> <Select>   <label> <Select>   <label> <Select>      [chips on right]
```

- Labels: `var(--fs-small)` / `var(--text-dim)`.
- Selects: the `Select` primitive with explicit `minWidth`.
- Chips (state, origin, scope): right side via `flex: 1` spacer.
- Group-by toggles also live here when a page supports grouping (Inventory: Source / Target / Date).

Never inline-style padding in the Filters row.

## Tables

The `DataTable<T>` in `src/ui/DataTable.tsx` is the only ledger primitive. All list pages use it.

### Columns

- Provide `id`, `header`, `size?`, `className?`, `render`, `sortable?`, `accessor?`.
- **Sortable columns are the default for any sortable data.** Inbox, Inventory, Projects, Activity all wire `sortable: true` on every column whose data has a natural order. The Pending-plan chip column is the only consistent exception.
- Sort state lives in the URL search param `sort` (encoded `col:dir`). When at the page's default, omit the param.
- Visual: an inactive sortable header shows the chevron at 30% opacity on hover; the active column shows it at 100%. The active column header text bumps from `--text-dim` to `--text`.
- Cell content rules:
  - Numeric: `className="alm-table__cell--num"` (right-aligned, tabular-nums).
  - Mono (paths): `className="alm-table__cell--mono"`.
  - Dim (secondary data): `className="alm-table__cell--dim"`.
  - Two-line (e.g. `140 frames` / `4.7h Ha . 2.0h OIII`): `className="alm-table__cell--twolines"` plus a `--twolines-sub` span for the second line. No inline fontSize.
  - Center (icons, checkmarks): `className="alm-table__cell--center"`.
- Inline `style={{ fontSize: ... }}` in `render` functions is banned. Use a cell class.

### Groups

When a page renders rows grouped by a category, use `groups` not `rows`. Two group header styles exist:

- **Static** (Inventory grouped by source / target / date): flat group header, all rows visible. Good for short groups (≤ ~20 rows).
- **Collapsible** (Activity grouped by origin; future Audit log grouped by day): group header has a chevron + count. Click toggles. Default open for high-signal origins; user-collapse state is transient component state (not URL-persisted).

Use collapsible groups for long-tail history surfaces and static groups for short scan surfaces. Group headers use `var(--surface-2)`, `var(--fs-micro)` uppercase tracking-wide title, count meta in `--text-dim`.

### Selection model

Two independent selection systems can coexist on one table:

1. **Row click then drawer selection** (`onSelect` + `selectedId`). One row at a time. Drives the right-side drawer via URL `id=<rowId>`.
2. **Checkbox multi-select** (`selectedIds: Set<string>` + `onToggleRow` + `onToggleAll`). For bulk actions. When `selectedIds.size > 0`, render the **bulk action bar** below the table (sticky bottom, `.alm-bulkbar`) with action buttons + a Clear ghost button.

Tables that don't need bulk select omit the multi-select props (Projects, Audit log).

### Row interaction

- Hover: `var(--surface-2)` background, `var(--t-fast)` transition. No scale, no shadow.
- Selected (drawer): `var(--surface-2)` + left 2px accent rail.
- Checked (bulk): `var(--accent-soft)` tint.
- Click handlers inside cells (chips, links, menus) MUST `stopPropagation` so they don't double-trigger row selection.

## Drawers

Drawers are the canonical detail surface. Use `DockedDrawer` (resizable) + `DrawerShell` (header / body / footer).

### Anatomy

```
+-------------------------------------+
| <Title>                          X  |   header: title + close
| <Subtitle>                          |           subtitle, --text-dim
+-------------------------------------+
|  [Tab strip, optional]              |   tabs for multi-pane drawers
|                                     |
|  <Fact groups / content>            |   body, scrollable
|                                     |
+-------------------------------------+
|  [primary] [secondary] [secondary]  |   footer: actions
|                  [overflow menu]    |
+-------------------------------------+
```

### Tab strip

Multi-pane drawers (Projects, future Audit per-entity) use a tab strip below the header. Native buttons + `aria-selected`, styled in the tone of `.alm-statechips`. Tab state persists in the URL search param `tab`. Default tab is not encoded.

Single-pane drawers (Inventory session, Inbox folder, Activity plan) skip the tab strip.

### Fact groups

`FactGroup` + `Facts` from `src/ui/DrawerShell.tsx`. Facts render as label/value rows with `--row-h-comfortable`. Label `var(--fs-micro)` uppercase tracking-wide. Value `var(--fs-small)`. Values may be a `StateLabel`, a `Link`, raw text, or icon + text. Drawer body is a vertical stack of FactGroups; never wrap in a card.

### Footer

Buttons render left to right by priority. Primary first, then secondaries, then destructive (variant `danger`). An overflow menu sits on the right via `flex: 1` spacer.

When a drawer renders a plan inline (Inbox, Projects, Activity), the footer is state-dependent:

- No plan yet: `Generate plan` (primary) + `Reclassify...`.
- Draft: `Approve & apply` (primary) + `Edit destinations...` + `Discard plan` (danger).
- Validating before apply: a disabled `Verifying plan against current state...` button with a spinner.
- Stale (post-validation): the `Plan is stale` Dialog opens; drawer footer disabled while it's open.
- Applying: disabled `Applying N/M...` with a spinner.
- Applied / partially_applied / failed: `Done` (primary, closes) + `Retry failures` (if any) + `Discard plan`.

The HMAC token has no TTL (decided 2026-05-21). Freshness guarantee comes from per-apply FS revalidation, not a wall clock.

## Buttons

`src/ui/Button.tsx` variants: `default`, `primary`, `ghost`, `subtle`, `danger`. Sizes: `sm`, `md`.

- `primary` for the one most-likely-next action per surface. At most one per row / drawer footer / dialog.
- `default` for every other action that mutates state but isn't destructive.
- `ghost` for non-mutating (Cancel, Clear, Close).
- `danger` for destructive (Discard, Reject, Ignore).
- `subtle` for the topbar search and a few hover-affordance triggers. Avoid as a default action.

Raw `<button>` elements with inline styling are not allowed. Use `Button` or `IconButton`. The single exception is custom click targets inside table cells (e.g. the state pill `.alm-statebtn`), which must still consume tokens.

## Dialogs

`Dialog` from `src/ui/Dialog.tsx` (Base UI primitive). Use for:

- Destructive confirmations (Reject all, Ignore folder, Discard plan).
- Stale-plan recovery (when revalidation detects drift).
- Conflict resolution (per-item Skip / Rename / Overwrite on failed plan items).
- Source remap (point a disconnected source at a new mount path).
- Add source (path + kind), used in the wizard and Settings.

Dialogs have a title, optional subtitle, body (one column, max 480px for confirmation, 640px for forms), and footer with primary action on the right + Cancel ghost on the left. No illustrations. Drawers, not dialogs, are the default detail affordance.

## Empty states

Every list surface has an explicit empty state. Pattern:

- Centered, modest illustration: a single Lucide icon at 32–40px in `--text-faint`. No marketing illustration.
- Heading: `var(--fs-md)` `--fw-semibold` `var(--text)`. One short sentence.
- One-line description: `var(--fs-small)` `--text-dim`. Names the action to take.
- Single primary CTA. If empty is unrecoverable from this surface, the CTA links to where it IS recoverable (e.g. Inventory empty → Settings > Data Sources or Restart wizard).

Use `EmptyState` in `src/ui/EmptyState.tsx`. Do not inline empty-state copy.

## Status pills, chips, badges

- **StateLabel** — colored dot + plain text. Canonical state indicator in tables and drawer headers. Tones: `success`, `warn`, `danger`, `neutral`.
- **`.alm-statechip`** — pill with a leading dot. Two uses: filter chips (`data-active="true"` enables, faded otherwise) and inline pills (`Plan ready . 10 items`, `Confidence: 94%`).
- **`.alm-badge`** — small numeric pill on nav items. Red (`data-tone="danger"`) only.
- **`.alm-shell__nav-dot`** — collapsed-sidebar indicator dot when there's a notification.

Never use a chip plus a state pill for the same datum. Never use a badge as decoration. If a number doesn't drive a decision, do not badge it.

## Logs & scan status

Bottom log strip is persistent, owned by the app shell. Two states:

- **Idle:** `Scans up to date . N files indexed` in `--text-faint`, `--fs-micro`.
- **Running scan or plan apply:** spinner (Loader2 12px) + source path (mono, `--text-dim`) + counter `M / N files . X%` + 220px progress bar.

Click to expand. Expanded log: time (micro, mono) + level pill + source + message. Filter chips for `info`, `warn`, `error`, `debug`.

There is no toast/snackbar system. Status lives in the log strip and in the relevant drawer.

## Settings

Settings is a two-column layout: narrow left rail of section links + dense right pane.

- Rail has a search input at the top (filters sections by title + per-section tags), then a single flat list of sections.
- Each section is one route under `/settings/<section>`.
- Right pane uses `--row-h-comfortable` rows (label + control on one line where width allows; control below when not).
- **All settings autosave.** No global Save button. The one documented exception is the naming-pattern editor: pattern tokens autosave individually, but pattern strings have an explicit confirm step because they're structural.
- Each setting row gets an info hover (`Tooltip` on a small `Info` icon next to the label). The hover MUST explain what the setting does, what the options mean, and what workflow consequence follows from changing it. Tooltips that merely restate the label are banned.

### Per-section conventions

- **Data Sources:** four headed groups (Raw / Calibration / Project / Inbox). Each group has add/remove rows. Disconnected sources show a `Reconnect...` button.
- **Naming & Structure:** a single global pattern editor at the top. Below it, an override list per frame type (light / dark / flat / bias / dark_flat / mixed). The override list defaults to "inherit global"; toggling a row reveals the per-type editor. Tokens use the existing `TokenPattern` primitive.
- **Calibration:** matching rules per frame type (light / dark / flat / bias). Dark matching includes a *tolerance* control rendered as a numeric input with unit suffix (e.g. seconds for exposure tolerance, °C for set-temp tolerance), not a `Select` of preset values.
- **Source Protection:** "Protected categories" is a multiselect over the known category vocabulary (raw sessions / processed masters / archived projects / capture exports / ...). Free-text entry is not permitted (typos make these defaults unsafe).
- **Audit log:** chronological feed, filter chips per event kind, expandable detail per row.
- **Backup & export:** export to .zip + import from .zip. Mock-only.

## Wizard / first run

Three steps: **Sources → Tools & catalogs → Done**. Centered single-column layout, max-width ~680px. Sidebar nav is visible but disabled. Source addition uses a Dialog. Long ops (tool detection, catalog download) block the Next button until complete with foreground progress. Final step lists what was registered and CTAs to `/inventory`.

## Copy discipline

- No em dashes in product copy. Use commas, colons, periods, or parentheses.
- No restated headings. The breadcrumb already says "Inventory"; don't put "Inventory" again in a description.
- Status copy appears only when it confirms a completed action, explains a blocker, or changes the user's next decision.
- Object names use sentence case: "Plan", "Project", "Session", "Inbox", "Activity".
- No marketing voice. No "powerful", "crafted", "local-first" in user-visible copy.

## State concepts (data lifecycle vocabulary)

Per the constitution and ratified spec 002, the user-visible state vocabulary is:

| Concept | Meaning |
|---|---|
| Observed | Data read from filesystem or metadata headers. |
| Inferred | Value derived from observations (proposed token, confidence < 1). |
| Reviewed | User-confirmed or corrected value. |
| Generated | App-owned projection (source view, manifest, marker). |
| Planned | Proposed filesystem mutation awaiting review. |
| Applied | Mutation completed and audit-logged. |
| Blocked / Failed | Operation could not continue; needs user attention. |

Inventory session states are six canonical values: `discovered`, `candidate`, `needs_review`, `confirmed`, `rejected`, `ignored`. Plan states: `draft`, `ready_for_review`, `approved`, `applying`, `applied`, `partially_applied`, `failed`, `discarded`. Do not collapse into a single "status" field.

## Accessibility

Target WCAG AA. Concretely:

- Visible focus rings on every interactive element. `:focus-visible` not just `:focus`. The accent color is the focus ring.
- Keyboard-first review flows: rows are `role="option"` with `aria-selected`; sortable headers are `role="columnheader"` with `aria-sort`; menus, dialogs, tabs come from Base UI with ARIA wiring.
- Reduced motion: animations stay short (`--t-fast` / `--t-base`) and use transform/opacity only. `prefers-reduced-motion` respected.
- Color is never the only signal: state pills carry a dot plus a text label; cal-match icons are shape-distinct (check / warn / x / dash); the danger badge is also numeric.

## Banned patterns (don't reintroduce)

- Mantine. Replaced by Base UI. Per ratified spec 022.
- TanStack Table. Replaced by app-local `DataTable`.
- Inline `style={{ fontSize: "Npx" }}` / `padding: "Npx"`. Use tokens.
- Side-stripe `border-left` decorative accents on cards / rows.
- Gradient text.
- Marketing hero metric tiles.
- Identical card grids (icon + heading + paragraph, repeated). Use a table.
- Nested cards.
- Dialogs as the default detail affordance. Drawers are.
- Em dashes in product copy.
- Tooltips that restate the label without adding decision support.
- Free-text inputs for known-vocabulary settings (e.g. protected categories).
- Select dropdowns for numeric tolerances.

## Implementation discipline

This document is the source of truth for UI work. When the running app drifts from it, file an inconsistency note (PR description or a `DESIGN-DRIFT.md` line) before "fixing" the doc. Implementation subagents must read this file before editing UI and verify their result against it in their handoff.

If the design document and an implementation prompt disagree, the implementation prompt should call out the conflict rather than silently inventing a third direction.

---

*Replaces the Mantine-era DESIGN.md. Earlier guidance about Mantine components, TanStack Table, Aptos font stack, and decorative state bubbles is obsolete.*
