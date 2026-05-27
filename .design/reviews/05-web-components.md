# Web Component Design Review

## Current Component Inventory

### Shared Components (`src/components/`)

| Component | Props | Purpose |
|-----------|-------|---------|
| `ListSidebar` | `searchPlaceholder`, `searchValue`, `onSearchChange`, `groupOptions`, `groupValue`, `onGroupChange`, `sortOptions`, `sortValue`, `onSortChange`, `filterPills?`, `onFilterToggle?`, `itemCount`, `children` | Left-column list panel with search, group, sort, filter pills, scrollable list, and footer count. |
| `EnhancedFilterBar` | `searchPlaceholder?`, `searchValue`, `onSearchChange`, `pills?`, `onPillToggle?`, `dropdowns?` | Horizontal filter toolbar with search, pills, and dropdowns. Only used by Inbox's `FilterSelect` area (not directly). |
| `TopActionBar` | `actions: ActionDef[]`, `title?`, `subtitle?` | Title+actions header bar for two-pane screens. |
| `PropertyTable` | `properties: PropertyDef[]`, `mode`, `showSource?`, `showConfirm?` | Key-value table with view/edit modes, source badges, confirm toggles. |
| `ConfirmOverlay` | `open`, `onClose`, `onConfirm`, `title`, `description?`, `confirmLabel?`, `confirmVariant?`, `children?` | Modal confirmation dialog using Base UI Dialog. |

### UI Primitives (`src/ui/`)

| Component | Purpose |
|-----------|---------|
| `Btn` | Button with variant/size props |
| `Pill` | Status/tag badge |
| `Confidence` | Confidence level indicator |
| `Provenance` | Data origin indicator |
| `Lock` | Lock/unlock toggle |
| `KV` | Key-value display pair |
| `Box` | Container with padding/border |
| `Section` | Collapsible section with header (Base UI Collapsible) |
| `EmptyState` | Centered empty placeholder with icon, title, description, action |
| `ThreePane` | Three-column layout with configurable widths |
| `FilterBar` | Basic filter pill bar (superseded by ListSidebar + EnhancedFilterBar) |
| `Toolbar` | Generic toolbar container |
| `DataTable` | Data table component |
| `DirPicker` | Directory picker (Tauri integration) |
| `WizardShell` | Multi-step wizard container |
| `ToastContainer` | Toast notification container |

---

## Duplicate Pattern Detection

### D1. `formatBytes()` -- 4 copies

Identical byte-formatting function duplicated across four files with trivial
variation.

| File | Line |
|------|------|
| `src/app/StatusBar.tsx` | 14 |
| `src/features/projects/CleanupPlan.tsx` | 16 |
| `src/features/projects/ProjectsList.tsx` | 44 |
| `src/features/sessions/SessionDetail.tsx` | 63 |

### D2. `formatIntegration()` / `formatIntegrationHours()` -- 6 copies

Seconds-to-hours formatting duplicated in five files plus a variant for hours
input.

| File | Line | Input |
|------|------|-------|
| `src/features/projects/wizard/StepSources.tsx` | 9 | seconds |
| `src/features/inbox/InboxList.tsx` | 12 | seconds |
| `src/features/sessions/SessionsList.tsx` | 50 | seconds |
| `src/features/inbox/SessionReview.tsx` | 19 | seconds |
| `src/features/sessions/SessionDetail.tsx` | 71 | seconds |
| `src/features/projects/ProjectsList.tsx` | 52 | hours |

### D3. `formatSize()` -- 3 copies

Bytes-to-human formatting (GB/MB variant) duplicated separately from
`formatBytes`.

| File | Line |
|------|------|
| `src/features/projects/PipelineStrip.tsx` | 10 |
| `src/features/inbox/InboxList.tsx` | 20 |
| `src/features/inbox/SessionReview.tsx` | 27 |

### D4. `stateVariant()` / `lifecycleVariant()` -- 5 copies

Maps session or project state strings to Pill variant colors. Three copies for
session state, three copies for project state (two named `stateVariant`, one
named `lifecycleVariant`).

| File | Line | Domain |
|------|------|--------|
| `src/features/sessions/SessionDetail.tsx` | 77 | session |
| `src/features/sessions/SessionsList.tsx` | 33 | session |
| `src/features/targets/TargetDetailPane.tsx` | 32 | session |
| `src/features/projects/ProjectDetail.tsx` | 23 | project |
| `src/features/projects/ProjectsList.tsx` | 27 | project |
| `src/features/projects/LifecycleSidebar.tsx` | 15 | project |

### D5. `stateLabel()` / `lifecycleLabel()` -- 5 copies

Maps state strings to display labels (`needs_review` -> `needs review`).
Identical pattern to D4.

| File | Line |
|------|------|
| `src/features/sessions/SessionsList.tsx` | 43 |
| `src/features/projects/ProjectDetail.tsx` | 36 |
| `src/features/projects/ProjectsList.tsx` | 40 |
| `src/features/projects/LifecycleSidebar.tsx` | 28 |
| (SessionDetail uses inline switch instead) | 77-84 |

### D6. Set toggle pattern -- 6 copies

The `setX(prev => { const next = new Set(prev); toggle; return next })` pattern
is copy-pasted in every list component's filter handler.

| File | Line |
|------|------|
| `src/features/calibration/MastersList.tsx` | 155 |
| `src/features/targets/TargetList.tsx` | 139 |
| `src/features/inbox/InboxPage.tsx` | 130 |
| `src/features/sessions/SessionsList.tsx` | 165 |
| `src/features/projects/ProjectsList.tsx` | 157 |
| `src/features/inbox/SessionReview.tsx` | 66 |

### D7. List-detail layout div structure -- 3 copies

The `alm-list-detail-layout` with `__list` and `__detail` children is
hand-assembled in every two-pane page. Same for the three-pane
`alm-hybrid-layout`.

| File | Lines |
|------|-------|
| `src/features/sessions/SessionsPage.tsx` | 105-123 |
| `src/features/calibration/CalibrationPage.tsx` | 27-47 |
| `src/features/targets/TargetsPage.tsx` | 49-65 |
| `src/features/projects/ProjectsPage.tsx` | 67-98 (hybrid variant) |

### D8. Loading / empty / error states -- 14 occurrences

Raw `<div className="alm-page__loading">` / `alm-page__empty` /
`alm-page__error` inline JSX with no shared component. Each file formats these
differently.

Notable locations:
- `SessionsPage.tsx:57`, `TargetsPage.tsx:22`, `CalibrationPage.tsx` (implicit),
  `ProjectsPage.tsx:36`, `ProjectDetail.tsx:125,137`,
  `SessionDetail.tsx:153-154`, `TargetDetailPane.tsx:102-103`

### D9. Native `<select>` vs Base UI `Select` inconsistency

`SessionsList` and `MastersList` use native `<select>` elements for group/sort
dropdowns (14 occurrences). `ListSidebar`, `EnhancedFilterBar`,
`PropertyTable`, `FilterSelect`, and Settings panes use Base UI
`Select.Root`. This breaks visual and accessibility consistency.

Native select locations:
- `src/features/sessions/SessionsList.tsx` lines 199, 212, 244, 255
- `src/features/calibration/MastersList.tsx` lines 190, 204
- `src/features/setup/steps/StepSourceFolders.tsx` lines 117, 156
- `src/features/settings/DataSources.tsx` line 93
- `src/features/settings/Equipment.tsx` lines 243, 255

### D10. SessionsList does NOT use ListSidebar

`SessionsList` (`src/features/sessions/SessionsList.tsx`) builds its own
search, group, sort, and filter chip UI from scratch (350 lines) instead of
using the shared `ListSidebar` component that `TargetList`, `ProjectsList`,
`InboxPage`, and `ArchivePage` all use. This is the single largest source of
layout inconsistency.

### D11. MastersList does NOT use ListSidebar

`MastersList` (`src/features/calibration/MastersList.tsx`) similarly builds its
own list chrome from scratch using native selects, custom CSS classes
(`alm-masters-list`, `alm-proj-list`), and a completely different HTML
structure.

---

## Missing Shared Components

### M1. `ListDetailLayout` -- two-pane layout component

Every two-pane page hand-assembles the same `alm-list-detail-layout` div
structure. This should be a single component.

```typescript
interface ListDetailLayoutProps {
  /** Content for the left list column */
  list: ReactNode;
  /** Content for the right detail column */
  detail: ReactNode;
  /** Optional CSS class for the root element */
  className?: string;
}
```

### M2. `HybridLayout` -- three-pane layout component (replaces inline divs)

ProjectsPage hand-assembles `alm-hybrid-layout` with list, content, and
sidebar columns. The existing `ThreePane` component exists but uses inline
styles and is only consumed by InboxPage. These two should be unified into a
single `ListDetailLayout` that accepts an optional `sidebar` slot.

```typescript
interface ListDetailLayoutProps {
  list: ReactNode;
  detail: ReactNode;
  /** Optional right sidebar for three-pane screens (Inbox, Projects) */
  sidebar?: ReactNode;
  /** Width of the list column in px. Default 280 */
  listWidth?: number;
  /** Width of the sidebar column in px. Default 220. Ignored if no sidebar */
  sidebarWidth?: number;
  className?: string;
}
```

### M3. `PageShell` -- page container with loading/empty/error states

14 occurrences of raw loading/empty/error divs. A single component should wrap
every feature page and handle these states consistently.

```typescript
interface PageShellProps {
  /** Test ID for the page root */
  testId: string;
  /** Whether the page is loading data */
  loading?: boolean;
  /** Loading message */
  loadingMessage?: string;
  /** Error to display */
  error?: Error | null;
  /** Shown when loading is false, error is null, and the page has no data */
  empty?: EmptyStateProps;
  /** Rendered when not loading and no error */
  children: ReactNode;
}
```

### M4. `ListItem` -- shared list item component

Every list (SessionsList, InboxList, TargetList, ProjectsList, MastersList,
ArchivePage) renders list items with the same pattern: a button/div with
`role="option"`, `aria-selected`, `onClick`, selected class toggle, and inner
rows of name + metadata. Each uses different BEM classes and slightly different
HTML structure.

```typescript
interface ListItemProps {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Primary label (target name, project name, etc.) */
  children: ReactNode;
  /** Optional data-* attributes */
  'data-tour'?: string;
}
```

### M5. Format utilities module

`formatBytes`, `formatSize`, `formatIntegration`, `formatIntegrationHours`
should all live in a single `src/lib/format.ts` utility module.

```typescript
// src/lib/format.ts
export function formatBytes(bytes: number): string;
export function formatIntegration(seconds: number): string;
export function formatIntegrationHours(hours: number): string;
```

### M6. State display utilities module

`stateVariant`, `stateLabel`, `lifecycleVariant`, `lifecycleLabel` should be
centralized per domain entity.

```typescript
// src/lib/display.ts
import type { ProjectState } from '@/bindings/types';

export type PillVariant = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'ghost';

export function sessionStateVariant(state: string): PillVariant;
export function sessionStateLabel(state: string): string;
export function projectStateVariant(state: ProjectState): PillVariant;
export function projectStateLabel(state: ProjectState): string;
```

### M7. `useSetToggle` hook

The set-toggle pattern appears 6 times. Extract to a custom hook.

```typescript
// src/hooks/useSetToggle.ts
export function useSetToggle<T>(
  initial?: Iterable<T>,
): [Set<T>, (value: T) => void, () => void];
```

---

## Component API Issues

### I1. ListSidebar requires group and sort even when pages do not need them

`ListSidebar` makes `groupOptions`, `groupValue`, `onGroupChange`,
`sortOptions`, `sortValue`, and `onSortChange` mandatory props. ArchivePage
must provide these even though all it needs is search + filter. These should
be optional -- if no options are provided, the dropdown is not rendered.

### I2. ListSidebar has no slot for action footer

`ProjectsList` injects a `+ New project` button inside `ListSidebar`'s
`children` slot, which places it after the list items. There is no dedicated
footer action slot, so the button scrolls with the list instead of staying
pinned.

Proposed fix: add an `actionFooter?: ReactNode` prop rendered below the scroll
area but above the count footer.

### I3. ThreePane uses inline styles

`ThreePane` (`src/ui/ThreePane.tsx`) uses raw `style={{ ... }}` objects
instead of CSS classes. Every other component in the codebase uses BEM class
names. This makes ThreePane visually inconsistent and impossible to theme.

### I4. TopActionBar has no `children` slot

`TopActionBar` only accepts an `actions` array of `ActionDef`. There is no way
to place arbitrary content (e.g., a view toggle button group, a filter select)
in the bar. InboxPage works around this by placing a separate `FilterSelect`
above the ThreePane.

### I5. EmptyState used inconsistently

Some pages use the shared `EmptyState` component, others use raw
`<div className="alm-page__empty">` with inline text. The `EmptyState`
component exists and is well-designed but is not used everywhere:
- CalibrationPage line 41: raw div
- ProjectsPage lines 83, 90: raw div
- TargetsPage line 61: raw div

### I6. ConfirmOverlay not used for all confirmations

`ConfirmOverlay` is used in `ArchivePage` but Inbox has its own
`InboxConfirmOverlay` component. These should compose from the same base or
the Inbox overlay should use `ConfirmOverlay` with custom `children`.

---

## Proposed Component Architecture

### Layer 1: Utilities (no JSX)

```typescript
// src/lib/format.ts
export function formatBytes(bytes: number): string;
export function formatSize(bytes: number): string;  // alias or merge with formatBytes
export function formatIntegration(seconds: number): string;
export function formatIntegrationHours(hours: number): string;

// src/lib/display.ts
export function sessionStateVariant(state: string): PillVariant;
export function sessionStateLabel(state: string): string;
export function projectStateVariant(state: ProjectState): PillVariant;
export function projectStateLabel(state: ProjectState): string;

// src/hooks/useSetToggle.ts
export function useSetToggle<T>(initial?: Iterable<T>): [Set<T>, (value: T) => void, () => void];
```

### Layer 2: UI Primitives (`src/ui/`) -- existing, no changes needed

`Btn`, `Pill`, `Section`, `EmptyState`, `KV`, `Box`, `Confidence`,
`Provenance`, `Lock`, `DirPicker`, `WizardShell`, `ToastContainer`

### Layer 3: Shared Layout Components (`src/components/`)

```typescript
// ── PageShell ──────────────────────────────────────────────────────────
// Wraps every feature page. Handles loading, error, and empty states.

interface PageShellProps {
  testId: string;
  loading?: boolean;
  loadingMessage?: string;
  error?: Error | null;
  empty?: {
    title: string;
    description?: string;
    action?: ReactNode;
  };
  /** true when there is data to show (prevents empty state when children exist) */
  hasData?: boolean;
  children: ReactNode;
}

// ── ListDetailLayout ───────────────────────────────────────────────────
// The single layout component for all list-detail screens.
// Two-pane when sidebar is omitted, three-pane when sidebar is provided.

interface ListDetailLayoutProps {
  list: ReactNode;
  detail: ReactNode;
  sidebar?: ReactNode;
  listWidth?: number;   // default 280
  sidebarWidth?: number; // default 220
}

// ── ListSidebar (enhanced) ─────────────────────────────────────────────
// Left column list panel. Group/sort now optional.

interface ListSidebarProps {
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (query: string) => void;

  groupOptions?: { value: string; label: string }[];
  groupValue?: string;
  onGroupChange?: (value: string) => void;

  sortOptions?: { value: string; label: string }[];
  sortValue?: string;
  onSortChange?: (value: string) => void;

  filterPills?: { value: string; label: string; active: boolean }[];
  onFilterToggle?: (value: string) => void;

  itemCount: number;

  /** Pinned footer action (e.g., "+ New project" button) */
  actionFooter?: ReactNode;

  children: ReactNode;
}

// ── TopActionBar (enhanced) ────────────────────────────────────────────
// Title + actions bar for two-pane screens. Adds children slot.

interface TopActionBarProps {
  title?: string;
  subtitle?: string;
  actions?: ActionDef[];
  /** Arbitrary content placed between title and actions */
  children?: ReactNode;
}

// ── ListItem ───────────────────────────────────────────────────────────
// Consistent selectable list row used inside ListSidebar.

interface ListItemProps {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  className?: string;
  'data-tour'?: string;
  children: ReactNode;
}
```

### Layer 4: Domain Display Components (`src/components/`)

These already exist and are well-designed:
- `PropertyTable` -- no changes needed
- `ConfirmOverlay` -- no changes needed
- `EnhancedFilterBar` -- keep for non-sidebar filter contexts

### Migration plan for existing list components

| Component | Current state | Target state |
|-----------|--------------|-------------|
| `TargetList` | Uses `ListSidebar` | Keep, already correct |
| `ProjectsList` | Uses `ListSidebar` | Keep, add `actionFooter` for new-project button |
| `InboxPage` | Uses `ListSidebar` + `ThreePane` | Replace `ThreePane` with `ListDetailLayout` sidebar slot |
| `ArchivePage` | Uses `ListSidebar` | Keep, already correct |
| **`SessionsList`** | **Builds own list chrome from scratch** | **Rewrite to use `ListSidebar`** |
| **`MastersList`** | **Builds own list chrome from scratch** | **Rewrite to use `ListSidebar`** |

---

## Composition Contracts

### Full composition tree

```
Shell
  Sidebar (nav)
  <main>
    Route → PageShell
      loading?  → loading indicator
      error?    → error display
      empty?    → EmptyState
      children  →
        TopActionBar (two-pane pages only)
        ListDetailLayout
          list:    → ListSidebar
                       search input
                       group/sort selects (optional)
                       filter pills (optional)
                       ListItem[] (children slot)
                       actionFooter (optional)
                       footer count
          detail:  → Feature-specific detail component
                       OR EmptyState (no selection)
          sidebar: → (Inbox: ActionSidebar, Projects: LifecycleSidebar)
                       (Sessions, Calibration, Targets, Archive: omitted)
  StatusBar
  LogPanel (conditional)
  CommandPalette
  ToastContainer
```

### Two-pane screen contract (Sessions, Calibration, Targets, Archive)

```
PageShell (testId, loading, error)
  TopActionBar (title, subtitle, actions)
  ListDetailLayout (list, detail)
    list  = ListSidebar(search, group?, sort?, pills?, children=ListItem[])
    detail = FeatureDetail | EmptyState
```

### Three-pane screen contract (Inbox, Projects)

```
PageShell (testId, loading, error)
  [optional: TopActionBar or inline toolbar]
  ListDetailLayout (list, detail, sidebar)
    list    = ListSidebar(...)
    detail  = FeatureDetail | EmptyState
    sidebar = ActionSidebar | LifecycleSidebar
```

### Settings screen contract (unique layout)

```
PageShell (testId)
  SettingsLayout (nav rail + content pane)
    nav = vertical button list
    content = pane header + pane body
```

---

## State Management Patterns

### Current state locations

| State | Current owner | Scope |
|-------|--------------|-------|
| Selected item ID | Each page component (`useState`) | Per-page, lost on navigation |
| Search query | Each list component (`useState`) | Per-list, lost on navigation |
| Group-by value | Each list component (`useState` or `usePreference`) | Mixed |
| Sort value | Each list component (`useState`) | Per-list, lost on navigation |
| Active filter set | Each list component (`useState<Set>`) | Per-list, lost on navigation |
| View mode (list/calendar) | `SessionsPage` via `usePreference` | Persisted |
| Overlay open state | Each page (`useState`) | Per-page |
| Data queries | Per-page `useQuery`/`useParameterizedQuery` | Cached in query store |

### Recommended patterns

**Selection state**: Keep in page component via `useState`. This is correct.
Selection does not need to survive navigation -- the URL can encode it when
needed (SessionsPage already reads `?selected` from the URL).

**Search/group/sort/filter state**: Keep inside the list component that
consumes `ListSidebar`. This is the correct boundary because different pages
have different filter options. However, `sessionsGroupBy` is persisted via
`usePreference` while other group-by values are not. Make this consistent:
either persist all group/sort preferences or none.

**Prop drilling assessment**: Prop drilling is minimal and appropriate. Pages
pass `selectedId` and `onSelect` to list components, and pass the selected
entity to detail components. No deeply nested prop chains exist. Context is
used only for cross-cutting concerns (LogPanel, OperationStatus, Preferences)
which is correct.

**Data fetching**: The `createQueryStore` / `useQuery` pattern is consistent
and well-encapsulated. Each page owns its own store instance. No changes
needed.

**Set toggle pattern**: Extract to `useSetToggle` hook to eliminate 6 copies
of the same state update logic. The hook returns `[set, toggle, clear]`.

### State that should NOT move to context

- Selected item ID: page-local, not shared
- Search/filter/sort: list-local, not shared
- Overlay open/close: page-local, not shared

### State that could benefit from URL sync

- Selected item ID on all list-detail pages (only SessionsPage does this
  currently)
- Active settings pane (SettingsPage reads from route params but does not
  update the URL on pane change)
