# Astro Library Manager — Design System Specification

This document is the single source of truth for all UI implementation agents.
Every component, layout, token, and pattern decision is recorded here.

## 1. Design Tokens

### 1.1 Color Palette

```css
:root {
  /* Core palette — warm grays */
  --alm-ink: #1a1a1a;
  --alm-ink2: #3a3a3a;
  --alm-ink3: #6a6a6a;
  --alm-ink4: #767676;          /* CHANGED from #9a9a9a — WCAG AA minimum */
  --alm-rule: #d4d4d2;
  --alm-rule2: #e4e3e0;
  --alm-wf-bg: #fafaf8;
  --alm-wf-bg2: #f3f2ee;
  --alm-wf-bg3: #ebeae5;
  --alm-wf-chip: #ebeae5;

  /* Status colors */
  --alm-wf-warn: #7a5a1a;
  --alm-wf-danger: #8a2a1a;
  --alm-wf-ok: #1f5a3a;

  /* NEW — Status backgrounds (light tints for badges/banners) */
  --alm-ok-bg: #e8f5ed;
  --alm-ok-border: #b5d6c0;
  --alm-warn-bg: #fef8e8;
  --alm-warn-border: #e5d5a0;
  --alm-danger-bg: #fdf0ee;
  --alm-danger-border: #e5c0b8;
  --alm-info-bg: #edf2f7;
  --alm-info-border: #b8cfe0;

  /* Semantic mappings */
  --alm-bg: var(--alm-wf-bg);
  --alm-surface: var(--alm-wf-bg2);
  --alm-border: var(--alm-rule);
  --alm-border-subtle: var(--alm-rule2);
  --alm-text: var(--alm-ink);
  --alm-text-secondary: var(--alm-ink2);
  --alm-text-muted: var(--alm-ink3);
  --alm-text-faint: var(--alm-ink4);
  --alm-accent: #2563eb;
  --alm-accent-hover: #1d4ed8;
  --alm-ok: var(--alm-wf-ok);
  --alm-warn: var(--alm-wf-warn);
  --alm-danger: var(--alm-wf-danger);
  --alm-info: #345268;

  /* NEW — Interactive states */
  --alm-hover-bg: rgba(0, 0, 0, 0.04);
  --alm-selected-bg: #e8edf5;
  --alm-focus-ring: 0 0 0 2px var(--alm-accent);
}
```

### 1.2 Typography

```css
:root {
  --alm-font-sans: 'Inter', system-ui, sans-serif;
  --alm-font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Type scale — 7 steps, no fractional pixels */
  --alm-text-2xs: 10px;        /* NEW — captions, timestamps */
  --alm-text-xs: 11px;         /* CHANGED from 11.5px — no subpixel */
  --alm-text-sm: 12px;
  --alm-text-base: 13px;
  --alm-text-md: 14px;
  --alm-text-lg: 16px;
  --alm-text-xl: 18px;
  --alm-text-2xl: 22px;

  /* Font weights — use these, not raw numbers */
  --alm-weight-normal: 400;
  --alm-weight-medium: 500;
  --alm-weight-semibold: 600;

  /* Line heights */
  --alm-leading-tight: 1.2;
  --alm-leading-normal: 1.5;
  --alm-leading-relaxed: 1.6;
}
```

**Rules**: Use `--alm-weight-medium` for emphasis instead of semibold everywhere.
Reserve `--alm-weight-semibold` for page titles, section headers, and primary actions.
Never use hardcoded font sizes — always reference a `--alm-text-*` token.

### 1.3 Spacing Scale

```css
:root {
  --alm-space-0: 2px;          /* NEW — hairline gaps */
  --alm-space-1: 4px;
  --alm-space-2: 6px;
  --alm-space-3: 8px;
  --alm-space-4: 12px;         /* CHANGED from 10px — consistent 4px steps */
  --alm-space-5: 16px;         /* CHANGED from 12px */
  --alm-space-6: 20px;         /* CHANGED from 14px */
  --alm-space-7: 24px;         /* CHANGED from 16px */
  --alm-space-8: 32px;         /* CHANGED from 18px — NEW large step */
  --alm-space-9: 48px;         /* CHANGED from 24px — NEW XL step */
}
```

**Rules**: Never use hardcoded pixel spacing. Always reference `--alm-space-*`.

### 1.4 Transitions

```css
:root {
  --alm-transition-fast: 100ms ease;
  --alm-transition-base: 150ms ease;
  --alm-transition-slow: 250ms ease;
}
```

### 1.5 Layout Dimensions

```css
:root {
  --alm-sidebar-width: 184px;
  --alm-sidebar-collapsed: 44px;
  --alm-list-width: 280px;
  --alm-action-sidebar-width: 220px;
  --alm-list-min-width: 200px;
  --alm-detail-min-width: 300px;
  --alm-action-sidebar-min-width: 180px;
  --alm-statusbar-height: 26px;
}
```

---

## 2. Layout Patterns

The app has exactly TWO layout patterns. All feature pages MUST use one of these.

### 2.1 Two-Pane Layout (Sessions, Calibration, Targets, Archive)

```
+--TopActionBar (full width)---------------------+
+--------+----------------------------------------+
| List   |              Detail                    |
| Sidebar|                                        |
| 280px  |            flex: 1                     |
|        |                                        |
+--------+----------------------------------------+
```

**CSS Contract**:
```css
.alm-layout-two-pane { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
.alm-layout-two-pane__bar { flex-shrink: 0; }
.alm-layout-two-pane__body { display: flex; flex: 1; min-height: 0; }
.alm-layout-two-pane__list { width: var(--alm-list-width); min-width: var(--alm-list-min-width); flex-shrink: 0; overflow: hidden; display: flex; flex-direction: column; border-right: 1px solid var(--alm-border); }
.alm-layout-two-pane__detail { flex: 1; min-width: var(--alm-detail-min-width); overflow-y: auto; }
```

### 2.2 Three-Pane Layout (Inbox, Projects)

```
+--------+---------------------------+-----------+
| List   |         Content           | Action    |
| Sidebar|                           | Sidebar   |
| 280px  |        flex: 1            | 220px     |
|        |                           |           |
+--------+---------------------------+-----------+
```

**CSS Contract**:
```css
.alm-layout-three-pane { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.alm-layout-three-pane__list { width: var(--alm-list-width); min-width: var(--alm-list-min-width); flex-shrink: 0; overflow: hidden; display: flex; flex-direction: column; border-right: 1px solid var(--alm-border); }
.alm-layout-three-pane__content { flex: 1; min-width: var(--alm-detail-min-width); overflow-y: auto; }
.alm-layout-three-pane__sidebar { width: var(--alm-action-sidebar-width); min-width: var(--alm-action-sidebar-min-width); flex-shrink: 0; overflow-y: auto; border-left: 1px solid var(--alm-border); background: var(--alm-surface); }
```

---

## 3. Component Database

### 3.1 Layout Components (`src/components/`)

#### `ListDetailLayout`

Replaces ALL hand-assembled layout divs AND the inline-styled `ThreePane`.
When `sidebar` is omitted, renders two-pane; when provided, renders three-pane.

```typescript
interface ListDetailLayoutProps {
  /** TopActionBar or toolbar above the panel split (two-pane only) */
  topBar?: ReactNode;
  /** Left list panel content (always a ListSidebar) */
  list: ReactNode;
  /** Center detail panel content */
  detail: ReactNode;
  /** Optional right sidebar (ActionSidebar or LifecycleSidebar) */
  sidebar?: ReactNode;
}
```

**CSS classes**: `.alm-layout-two-pane` when no sidebar, `.alm-layout-three-pane` when sidebar present.
**Used by**: ALL feature pages (Sessions, Calibration, Targets, Projects, Inbox, Archive).

#### `PageShell`

Wraps every feature page with consistent loading/error/empty states.

```typescript
interface PageShellProps {
  testId: string;
  loading?: boolean;
  loadingMessage?: string;
  error?: Error | null;
  empty?: { title: string; description?: string; action?: ReactNode };
  hasData?: boolean;
  children: ReactNode;
}
```

**CSS classes**: `.alm-page` (existing), `.alm-page__loading`, `.alm-page__error` (existing).

#### `ListSidebar` (enhanced)

Left list panel with search, optional group/sort, optional filter pills, scrollable items, optional footer action, item count.

```typescript
interface ListSidebarProps {
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (query: string) => void;
  groupOptions?: SelectOption[];   // OPTIONAL now
  groupValue?: string;
  onGroupChange?: (v: string) => void;
  sortOptions?: SelectOption[];    // OPTIONAL now
  sortValue?: string;
  onSortChange?: (v: string) => void;
  filterPills?: FilterPill[];
  onFilterToggle?: (value: string) => void;
  dropdowns?: DropdownDef[];       // NEW — extra filter dropdowns
  itemCount: number;
  actionFooter?: ReactNode;        // NEW — pinned button below scroll
  children: ReactNode;
}
```

**CSS classes**: `.alm-list-sidebar`, `__search`, `__controls`, `__filters`, `__dropdowns`, `__list`, `__action-footer`, `__footer`.
**Used by**: ALL list screens. SessionsList and MastersList MUST be rewritten to use this.

#### `TopActionBar` (enhanced)

```typescript
interface TopActionBarProps {
  title?: string;
  subtitle?: string;
  actions?: ActionDef[];
  children?: ReactNode;            // NEW — arbitrary content slot
}
```

**CSS classes**: `.alm-top-action-bar`, `__heading`, `__title`, `__subtitle`, `__content`, `__actions`.
**Used by**: Sessions, Calibration, Targets, Archive (above list-detail split).

#### `ListItem`

Consistent selectable list row used inside ListSidebar.

```typescript
interface ListItemProps {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  className?: string;
  children: ReactNode;
}
```

**CSS classes**: `.alm-list-item`, `.alm-list-item--selected`.

### 3.2 Domain Display Components (`src/components/`)

These exist and are correct — no API changes needed:
- `PropertyTable` — key-value property grid with view/edit modes
- `ConfirmOverlay` — modal confirmation dialog (used for all confirmations)

`EnhancedFilterBar` — DELETE (unused, ListSidebar's `dropdowns` prop replaces it).

### 3.3 UI Primitives (`src/ui/`) — no changes needed

`Btn`, `Pill`, `Section`, `EmptyState`, `KV`, `Box`, `DirPicker`, `WizardShell`, `ToastContainer`

DELETE `ThreePane` — replaced by `ListDetailLayout` with sidebar.
DELETE `FilterBar` — superseded by ListSidebar.
DELETE `Confidence` — spec removes confidence display.

### 3.4 Utility Modules

#### `src/lib/format.ts` (NEW)

```typescript
export function formatBytes(bytes: number): string;
export function formatIntegration(seconds: number): string;
export function formatIntegrationHours(hours: number): string;
```

Consolidates from: StatusBar, CleanupPlan, ProjectsList, SessionDetail, InboxList, SessionReview, TargetDetailPane, SessionsList.

#### `src/lib/display.ts` (NEW)

```typescript
export type PillVariant = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'ghost';
export function sessionStateVariant(state: string): PillVariant;
export function sessionStateLabel(state: string): string;
export function projectStateVariant(state: string): PillVariant;
export function projectStateLabel(state: string): string;
```

Consolidates from: SessionsList, SessionDetail, TargetDetailPane, ProjectDetail, ProjectsList, LifecycleSidebar.

#### `src/hooks/useSetToggle.ts` (NEW)

```typescript
export function useSetToggle<T>(initial?: Iterable<T>): [Set<T>, (value: T) => void, () => void];
```

Replaces 6 copy-pasted set-toggle patterns across list components.

---

## 4. Page Composition Contracts

Every page MUST follow this composition tree exactly:

### 4.1 Two-Pane Pages

```
PageShell(testId, loading, error, empty, hasData)
  ListDetailLayout(topBar, list, detail)
    topBar  → TopActionBar(title, subtitle, actions)
    list    → ListSidebar(search, group?, sort?, pills?, dropdowns?, children, itemCount)
                ListItem[](id, selected, onSelect, children)
    detail  → FeatureDetail(entity) | EmptyState("Select an item")
```

**Pages**: Sessions, Calibration, Targets, Archive.

### 4.2 Three-Pane Pages

```
PageShell(testId, loading, error, empty, hasData)
  ListDetailLayout(list, detail, sidebar)
    list    → ListSidebar(...)
    detail  → FeatureDetail(entity) | EmptyState
    sidebar → ActionSidebar (Inbox) | LifecycleSidebar (Projects)
```

**Pages**: Inbox, Projects.

### 4.3 Per-Page Action Bars (per spec)

| Page | Actions (from spec) |
|------|---------------------|
| Sessions | Use in Project, Move to Inbox, Reveal in Explorer, Archive |
| Calibration | Use in Project, Reveal in Explorer, Archive |
| Targets | Edit aliases, Link plan, New project |
| Archive | Re-queue, Delete permanently |
| Inbox | Confirm (C), Reject (R), Split (S), Merge (M), Edit (E) — in ActionSidebar |
| Projects | Phase-specific actions — in LifecycleSidebar |

### 4.4 Settings (unique layout — already working)

Uses existing `.alm-settings` CSS. No changes needed.

### 4.5 Setup Wizard (unique layout — already working)

Uses existing `.alm-wizard-*` CSS. No changes beyond the "7 of 5" counter bug fix.

---

## 5. CSS Cleanup Plan

### 5.1 Dead CSS to DELETE (870+ lines)

| Block | Lines | Reason |
|-------|-------|--------|
| `.alm-review-queue__*` | 2224-2327 | Old Review Queue, replaced by Inbox |
| `.alm-evidence-pane__*` | 2328-2453 | Old evidence panel, replaced by SessionReview |
| `.alm-decision-panel__*` | 2455-2543 | Old decision panel, replaced by ActionSidebar |
| `.alm-list-pane__*` | 4372-4520 | Duplicates ListSidebar |
| `.alm-session-list__*` | 4042-4228 | SessionsList being rewritten to use ListSidebar |
| `.alm-proj-list__*` | 3750-3968 | Used by MastersList, being rewritten |
| Duplicate `.alm-view-toggle` | 3176-3204 | Duplicate of lines 2849-2879 |

### 5.2 New CSS to ADD

All CSS for the 35+ undefined class names listed in the reviews. The ui-designer
agent will write these following the token and BEM conventions in this document.

### 5.3 Hardcoded Values to FIX

- Replace all hardcoded hex colors with `var(--alm-*)` tokens
- Replace all hardcoded font sizes with `var(--alm-text-*)` tokens
- Replace all hardcoded spacing with `var(--alm-space-*)` tokens
- Replace all hardcoded transitions with `var(--alm-transition-*)` tokens
- Replace all inline styles in ThreePane, wizard steps with CSS classes

---

## 6. Validation Criteria

The UI is acceptable when ALL of these hold:

1. **Every page renders side-by-side panels** — no stacked layouts on list-detail screens
2. **Every list screen uses ListSidebar** — identical search/group/sort/filter controls
3. **No single-use components** that duplicate a shared component's function
4. **Zero hardcoded colors, font sizes, or spacing** in new/modified CSS
5. **All actions match spec** — no removed actions, no missing "Reveal in Explorer"
6. **WCAG AA contrast** on all text (minimum 4.5:1)
7. **Density modes work** — compact/comfortable/spacious affect all components
8. **Zero unused CSS** from pre-030 patterns
9. **Consistent empty states** — all use EmptyState component
10. **Consistent focus rings** — all interactive elements have `:focus-visible` styles
